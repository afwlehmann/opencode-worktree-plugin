import * as fs from "node:fs/promises"
import * as path from "node:path"
import type { Either, WorktreeError } from "../types.js"
import { left, right } from "../types.js"

export type GitCommand = readonly string[]

export type GitEnvOptions = {
  readonly preferNixDevelop: boolean
}

export type SpawnResult = {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

export type SpawnFn = (
  command: readonly string[],
  options: { readonly cwd: string },
) => Promise<SpawnResult>

export type PathExistsFn = (path: string) => Promise<boolean>

export const hasFlakeNix = async (startDir: string, exists: PathExistsFn): Promise<boolean> => {
  let current = path.resolve(startDir)
  while (true) {
    if (await exists(path.join(current, "flake.nix"))) return true
    const parent = path.dirname(current)
    if (parent === current) return false
    current = parent
  }
}

export const resolveGitCommand = (opts: GitEnvOptions, flakePresent: boolean): GitCommand => {
  if (opts.preferNixDevelop && flakePresent) {
    return ["nix", "develop", "-c", "git"]
  }
  return ["git"]
}

const GIT_SEARCH_PATHS = [
  "/usr/bin",
  "/usr/local/bin",
  "/opt/homebrew/bin",
  (() => {
    const user = process.env["USER"] ?? ""
    return `/etc/profiles/per-user/${user}/bin`
  })(),
  path.join(process.env["HOME"] ?? "", ".nix-profile", "bin"),
]

export const findGitOnPath = async (exists: PathExistsFn): Promise<string | undefined> => {
  const results = await Promise.all(
    GIT_SEARCH_PATHS.map(async (dir) => {
      const gitPath = path.join(dir, "git")
      return (await exists(gitPath)) ? dir : undefined
    }),
  )
  return results.find((r): r is string => r !== undefined)
}

export const ensureGitAvailable = async (
  opts: GitEnvOptions,
  exists: PathExistsFn,
  spawn: SpawnFn,
): Promise<Either<WorktreeError, GitCommand>> => {
  const flakePresent = await hasFlakeNix(process.cwd(), exists)
  const gitCmd = resolveGitCommand(opts, flakePresent)

  if (opts.preferNixDevelop && !flakePresent) {
    const nixOnPath = await findGitOnPath(exists)
    const nixBin = nixOnPath ? path.join(nixOnPath, "nix") : undefined
    if (!nixBin || !(await exists(nixBin))) {
      const gitDir = await findGitOnPath(exists)
      if (!gitDir) {
        return left({ kind: "git-not-found", searchedPaths: GIT_SEARCH_PATHS })
      }
      return right(["git"])
    }
  }

  try {
    const result = await spawn([...gitCmd, "--version"], { cwd: process.cwd() })
    if (result.exitCode !== 0) {
      const gitDir = await findGitOnPath(exists)
      if (!gitDir) {
        return left({ kind: "git-not-found", searchedPaths: GIT_SEARCH_PATHS })
      }
      return right(["git"])
    }
    return right(gitCmd)
  } catch {
    const gitDir = await findGitOnPath(exists)
    if (!gitDir) {
      return left({ kind: "git-not-found", searchedPaths: GIT_SEARCH_PATHS })
    }
    return right(["git"])
  }
}

export const runGit = async (
  gitCmd: GitCommand,
  spawn: SpawnFn,
  args: readonly string[],
  cwd: string,
): Promise<SpawnResult> => {
  return spawn([...gitCmd, ...args], { cwd })
}

export const runGitOrError = async (
  gitCmd: GitCommand,
  spawn: SpawnFn,
  args: readonly string[],
  cwd: string,
): Promise<Either<WorktreeError, string>> => {
  const result = await runGit(gitCmd, spawn, args, cwd)
  if (result.exitCode !== 0) {
    return left({
      kind: "git-error",
      command: [...gitCmd, ...args].join(" "),
      stderr: result.stderr.trim(),
      message: result.stderr.trim() || result.stdout.trim(),
    })
  }
  return right(result.stdout.trim())
}

export const defaultSpawn: SpawnFn = async (command, options) => {
  const proc = Bun.spawn([...command], {
    cwd: options.cwd,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  const exitCode = await proc.exited
  return { exitCode, stdout, stderr }
}

export const defaultExists: PathExistsFn = async (filePath) => {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}
