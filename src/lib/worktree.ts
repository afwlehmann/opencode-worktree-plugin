import type { Either, WorktreeError, WorktreeInfo } from "../types.js"
import { left, right } from "../types.js"
import type { GitCommand, SpawnFn, SpawnResult } from "./git-env.js"
import { runGit, runGitOrError } from "./git-env.js"

export type CreateWorktreeInput = {
  readonly repoPath: string
  readonly worktreePath: string
  readonly sourceBranch: string
  readonly targetBranch: string
  readonly gitCmd: GitCommand
}

export type MergeWorktreeInput = {
  readonly repoPath: string
  readonly worktreePath: string
  readonly sourceBranch: string
  readonly targetBranch: string
  readonly gitCmd: GitCommand
}

export type RemoveWorktreeInput = {
  readonly repoPath: string
  readonly worktreePath: string
  readonly gitCmd: GitCommand
}

const branchExists = async (
  gitCmd: GitCommand,
  spawn: SpawnFn,
  repoPath: string,
  branch: string,
): Promise<boolean> => {
  const result = await runGit(gitCmd, spawn, ["rev-parse", "--verify", branch], repoPath)
  return result.exitCode === 0
}

const worktreeExists = async (
  gitCmd: GitCommand,
  spawn: SpawnFn,
  repoPath: string,
  worktreePath: string,
): Promise<boolean> => {
  const result = await runGit(gitCmd, spawn, ["worktree", "list", "--porcelain"], repoPath)
  if (result.exitCode !== 0) return false
  return result.stdout.split("\n").some((line) => line.startsWith(`worktree ${worktreePath}`))
}

const hasUncommittedChanges = async (
  gitCmd: GitCommand,
  spawn: SpawnFn,
  worktreePath: string,
): Promise<boolean> => {
  const result = await runGit(gitCmd, spawn, ["status", "--porcelain"], worktreePath)
  return result.exitCode === 0 && result.stdout.trim().length > 0
}

const isBranchAncestor = async (
  gitCmd: GitCommand,
  spawn: SpawnFn,
  repoPath: string,
  branch: string,
  targetBranch: string,
): Promise<boolean> => {
  const result = await runGit(
    gitCmd,
    spawn,
    ["merge-base", "--is-ancestor", branch, targetBranch],
    repoPath,
  )
  return result.exitCode === 0
}

const currentBranch = async (
  gitCmd: GitCommand,
  spawn: SpawnFn,
  repoPath: string,
): Promise<string> => {
  const result = await runGit(gitCmd, spawn, ["rev-parse", "--abbrev-ref", "HEAD"], repoPath)
  return result.exitCode === 0 ? result.stdout.trim() : ""
}

export const createWorktree = async (
  spawn: SpawnFn,
  input: CreateWorktreeInput,
): Promise<Either<WorktreeError, WorktreeInfo>> => {
  const { repoPath, worktreePath, sourceBranch, targetBranch, gitCmd } = input

  if (await branchExists(gitCmd, spawn, repoPath, sourceBranch)) {
    return left({ kind: "branch-exists", branch: sourceBranch })
  }

  const result = await runGitOrError(
    gitCmd,
    spawn,
    ["worktree", "add", "-b", sourceBranch, worktreePath, targetBranch],
    repoPath,
  )

  if (result._tag === "Left") {
    if (result.error.kind === "git-error" && result.error.stderr.includes("already exists")) {
      return left({ kind: "worktree-exists", path: worktreePath })
    }
    return result
  }

  return right({
    repoShort: "",
    sourceBranch,
    targetBranch,
    path: worktreePath,
    repoPath,
  })
}

export type MergeMode = "working-copy" | "ref-only"

export const mergeWorktree = async (
  spawn: SpawnFn,
  input: MergeWorktreeInput,
): Promise<Either<WorktreeError, MergeMode>> => {
  const { repoPath, worktreePath, sourceBranch, targetBranch, gitCmd } = input

  if (!(await worktreeExists(gitCmd, spawn, repoPath, worktreePath))) {
    return left({ kind: "worktree-not-found", path: worktreePath })
  }

  if (!(await branchExists(gitCmd, spawn, repoPath, `refs/heads/${sourceBranch}`))) {
    return left({ kind: "branch-not-found", branch: sourceBranch })
  }

  if (!(await branchExists(gitCmd, spawn, repoPath, `refs/heads/${targetBranch}`))) {
    return left({ kind: "branch-not-found", branch: targetBranch })
  }

  const onTarget = (await currentBranch(gitCmd, spawn, repoPath)) === targetBranch

  const result = onTarget
    ? await runGit(gitCmd, spawn, ["merge", "--ff-only", sourceBranch], repoPath)
    : await runGit(gitCmd, spawn, ["fetch", ".", `${sourceBranch}:${targetBranch}`], repoPath)

  if (result.exitCode !== 0) {
    return left({
      kind: "not-fast-forward",
      sourceBranch,
      targetBranch,
    })
  }

  return right(onTarget ? "working-copy" : "ref-only")
}

export const removeWorktree = async (
  spawn: SpawnFn,
  input: RemoveWorktreeInput,
): Promise<Either<WorktreeError, void>> => {
  const { repoPath, worktreePath, gitCmd } = input

  if (!(await worktreeExists(gitCmd, spawn, repoPath, worktreePath))) {
    return left({ kind: "worktree-not-found", path: worktreePath })
  }

  if (await hasUncommittedChanges(gitCmd, spawn, worktreePath)) {
    return left({ kind: "uncommitted-changes", path: worktreePath })
  }

  const result = await runGitOrError(gitCmd, spawn, ["worktree", "remove", worktreePath], repoPath)
  if (result._tag === "Left") return result

  return right(undefined)
}

export const deleteBranch = async (
  spawn: SpawnFn,
  gitCmd: GitCommand,
  repoPath: string,
  branch: string,
  targetBranch: string,
): Promise<Either<WorktreeError, void>> => {
  if (!(await isBranchAncestor(gitCmd, spawn, repoPath, branch, targetBranch))) {
    return left({ kind: "branch-not-merged", branch })
  }

  const result = await runGit(gitCmd, spawn, ["branch", "-d", branch], repoPath)
  if (result.exitCode === 0) return right(undefined)

  const fallback = await runGit(
    gitCmd,
    spawn,
    ["update-ref", "-d", `refs/heads/${branch}`],
    repoPath,
  )
  if (fallback.exitCode !== 0) {
    return left({
      kind: "git-error",
      command: `git branch -d ${branch}`,
      stderr: result.stderr.trim() || fallback.stderr.trim(),
      message:
        result.stderr.trim() ||
        fallback.stderr.trim() ||
        `git branch -d exited with code ${result.exitCode}`,
    })
  }

  return right(undefined)
}

export const listWorktrees = async (
  spawn: SpawnFn,
  gitCmd: GitCommand,
  repoPath: string,
): Promise<Either<WorktreeError, readonly string[]>> => {
  const result = await runGitOrError(gitCmd, spawn, ["worktree", "list", "--porcelain"], repoPath)
  if (result._tag === "Left") return result

  const paths = result.value
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length))

  return right(paths)
}

export type { SpawnResult }
