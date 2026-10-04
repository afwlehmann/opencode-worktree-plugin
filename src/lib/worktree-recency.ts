import * as fs from "node:fs/promises"
import * as path from "node:path"
import type { Either, WorktreeError } from "../types.js"
import { isLeft, left, right } from "../types.js"
import type { GitCommand, GitEnvOptions, PathExistsFn, SpawnFn } from "./git-env.js"
import { ensureGitAvailable, runGit } from "./git-env.js"
import { isValidWorktreeName } from "./paths.js"
import { listWorktrees } from "./worktree.js"

export type StatFn = (filePath: string) => Promise<number | undefined>

export type RecencyProbe = {
  readonly stat: StatFn
  readonly exists: PathExistsFn
  readonly spawn: SpawnFn
}

const CREATION_WINDOW_MS = 5000

export const defaultStat: StatFn = async (filePath) => {
  try {
    const stats = await fs.stat(filePath)
    return stats.mtimeMs
  } catch {
    return undefined
  }
}

type WorktreeProbe = {
  readonly name: string
  readonly path: string
  readonly creationMs: number | undefined
  readonly indexMs: number | undefined
  readonly headMs: number
}

const isDirectChildUnderRoot = (candidate: string, worktreeRoot: string): boolean => {
  const relative = path.relative(worktreeRoot, candidate)
  return (
    relative !== "" &&
    !relative.startsWith("..") &&
    !path.isAbsolute(relative) &&
    !relative.includes(path.sep)
  )
}

const headTimeMs = async (gitCmd: GitCommand, spawn: SpawnFn, wtPath: string): Promise<number> => {
  const result = await runGit(gitCmd, spawn, ["log", "-1", "--format=%ct"], wtPath)
  const epoch = result.exitCode === 0 ? Number.parseInt(result.stdout.trim(), 10) : Number.NaN
  return Number.isFinite(epoch) ? epoch * 1000 : 0
}

const indexTimeMs = async (
  gitCmd: GitCommand,
  spawn: SpawnFn,
  stat: StatFn,
  wtPath: string,
): Promise<number | undefined> => {
  const result = await runGit(gitCmd, spawn, ["rev-parse", "--git-dir"], wtPath)
  if (result.exitCode !== 0) return undefined
  return stat(path.join(path.resolve(wtPath, result.stdout.trim()), "index"))
}

const probeWorktree = async (
  probe: RecencyProbe,
  gitCmd: GitCommand,
  wtPath: string,
): Promise<WorktreeProbe> => {
  const [creationMs, indexMs, headMs] = await Promise.all([
    probe.stat(path.join(wtPath, ".git")),
    indexTimeMs(gitCmd, probe.spawn, probe.stat, wtPath),
    headTimeMs(gitCmd, probe.spawn, wtPath),
  ])
  return { name: path.basename(wtPath), path: wtPath, creationMs, indexMs, headMs }
}

const hasBeenWorkedOn = (probe: WorktreeProbe): boolean =>
  probe.creationMs === undefined ||
  (probe.indexMs !== undefined && probe.indexMs > probe.creationMs + CREATION_WINDOW_MS) ||
  probe.headMs > probe.creationMs

const activityScore = (probe: WorktreeProbe): number => Math.max(probe.indexMs ?? 0, probe.headMs)

const byNameAsc = (a: WorktreeProbe, b: WorktreeProbe): number =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0

const byActivityDesc = (a: WorktreeProbe, b: WorktreeProbe): number =>
  activityScore(b) - activityScore(a) || byNameAsc(a, b)

const byHeadTimeDesc = (a: WorktreeProbe, b: WorktreeProbe): number =>
  b.headMs - a.headMs || byNameAsc(a, b)

export const latestWorktree = async (
  probe: RecencyProbe,
  opts: GitEnvOptions,
  worktreeRoot: string,
  repoPath: string,
): Promise<Either<WorktreeError, string | undefined>> => {
  const gitCmdOrError = await ensureGitAvailable(opts, probe.exists, probe.spawn)
  if (isLeft(gitCmdOrError)) return left(gitCmdOrError.failure)
  const gitCmd: GitCommand = gitCmdOrError.success

  const worktreesOrError = await listWorktrees(probe.spawn, gitCmd, repoPath)
  if (isLeft(worktreesOrError)) return left(worktreesOrError.failure)

  const candidates = worktreesOrError.success.filter(
    (wtPath) =>
      isDirectChildUnderRoot(wtPath, worktreeRoot) && isValidWorktreeName(path.basename(wtPath)),
  )
  if (candidates.length === 0) return right(undefined)

  const probes = await Promise.all(candidates.map((wtPath) => probeWorktree(probe, gitCmd, wtPath)))
  const qualifying = probes.filter(hasBeenWorkedOn)
  const ordered =
    qualifying.length > 0 ? [...qualifying].sort(byActivityDesc) : [...probes].sort(byHeadTimeDesc)
  return right(ordered[0]?.name)
}
