import * as path from "node:path"
import type { Either, WorktreeError } from "../types.js"
import { left, right } from "../types.js"
import type { GitCommand, SpawnFn } from "./git-env.js"
import { runGit } from "./git-env.js"

export type OpencodeDirStatus = {
  readonly exists: boolean
  readonly gitignored: boolean
  readonly untracked: boolean
}

export const NO_OPENCODE_DIR: OpencodeDirStatus = {
  exists: false,
  gitignored: false,
  untracked: false,
}

export const detectOpencodeDir = async (
  spawn: SpawnFn,
  gitCmd: GitCommand,
  repoPath: string,
): Promise<OpencodeDirStatus> => {
  const opencodePath = path.join(repoPath, ".opencode")

  const fs = await import("node:fs/promises")
  try {
    await fs.access(opencodePath)
  } catch {
    return NO_OPENCODE_DIR
  }

  const checkIgnoreResult = await runGit(gitCmd, spawn, ["check-ignore", ".opencode"], repoPath)
  const gitignored = checkIgnoreResult.exitCode === 0

  const statusResult = await runGit(gitCmd, spawn, ["status", "--porcelain", ".opencode"], repoPath)
  const untracked =
    statusResult.exitCode === 0 &&
    statusResult.stdout.split("\n").some((line) => line.startsWith("??"))

  return { exists: true, gitignored, untracked }
}

export const shouldPromptForCopy = (status: OpencodeDirStatus): boolean =>
  status.exists && (status.gitignored || status.untracked)

export const copyOpencodeDir = async (
  repoPath: string,
  worktreePath: string,
): Promise<Either<WorktreeError, void>> => {
  const src = path.join(repoPath, ".opencode")
  const dest = path.join(worktreePath, ".opencode")

  try {
    const result = Bun.spawn(["cp", "-R", src, dest], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stderr] = await Promise.all([new Response(result.stderr).text()])
    const exitCode = await result.exited

    if (exitCode !== 0) {
      return left({
        kind: "copy-failed",
        src,
        dest,
        message: stderr.trim() || `cp exited with code ${exitCode}`,
      })
    }

    return right(undefined)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return left({ kind: "copy-failed", src, dest, message })
  }
}
