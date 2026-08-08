import type { Either, WorktreeError, WorktreeInfo } from "../types.js"
import { isLeft, left, right } from "../types.js"
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

const isBranchMerged = async (
  gitCmd: GitCommand,
  spawn: SpawnFn,
  repoPath: string,
  branch: string,
  targetBranch: string,
): Promise<boolean> => {
  const result = await runGit(gitCmd, spawn, ["branch", "--merged", targetBranch], repoPath)
  if (result.exitCode !== 0) return false
  return result.stdout
    .split("\n")
    .map((line) => line.trim().replace(/^\*\s*/, ""))
    .includes(branch)
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

  if (isLeft(result)) {
    if (result.failure.kind === "git-error" && result.failure.stderr.includes("already exists")) {
      return left({ kind: "worktree-exists", path: worktreePath })
    }
    return left(result.failure)
  }

  return right({
    repoShort: "",
    sourceBranch,
    targetBranch,
    path: worktreePath,
    repoPath,
  })
}

export const mergeWorktree = async (
  spawn: SpawnFn,
  input: MergeWorktreeInput,
): Promise<Either<WorktreeError, void>> => {
  const { repoPath, worktreePath, sourceBranch, targetBranch, gitCmd } = input

  if (!(await worktreeExists(gitCmd, spawn, repoPath, worktreePath))) {
    return left({ kind: "worktree-not-found", path: worktreePath })
  }

  const checkoutResult = await runGitOrError(gitCmd, spawn, ["checkout", targetBranch], repoPath)
  if (isLeft(checkoutResult)) return left(checkoutResult.failure)

  const mergeResult = await runGit(gitCmd, spawn, ["merge", "--ff-only", sourceBranch], repoPath)

  if (mergeResult.exitCode !== 0) {
    return left({
      kind: "not-fast-forward",
      sourceBranch,
      targetBranch,
    })
  }

  return right(undefined)
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
  if (isLeft(result)) return left(result.failure)

  return right(undefined)
}

export const deleteBranch = async (
  spawn: SpawnFn,
  gitCmd: GitCommand,
  repoPath: string,
  branch: string,
  targetBranch: string,
): Promise<Either<WorktreeError, void>> => {
  if (!(await isBranchMerged(gitCmd, spawn, repoPath, branch, targetBranch))) {
    return left({ kind: "branch-not-merged", branch })
  }

  const result = await runGitOrError(gitCmd, spawn, ["branch", "-d", branch], repoPath)
  if (isLeft(result)) return left(result.failure)

  return right(undefined)
}

export const listWorktrees = async (
  spawn: SpawnFn,
  gitCmd: GitCommand,
  repoPath: string,
): Promise<Either<WorktreeError, readonly string[]>> => {
  const result = await runGitOrError(gitCmd, spawn, ["worktree", "list", "--porcelain"], repoPath)
  if (isLeft(result)) return left(result.failure)

  const paths = result.success
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length))

  return right(paths)
}

export type { SpawnResult }
