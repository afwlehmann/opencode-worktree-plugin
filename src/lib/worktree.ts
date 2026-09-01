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
  return result.stdout.split("\n").some((line) => line === `worktree ${worktreePath}`)
}

const hasUncommittedChanges = async (
  gitCmd: GitCommand,
  spawn: SpawnFn,
  worktreePath: string,
): Promise<boolean> => {
  const result = await runGit(gitCmd, spawn, ["status", "--porcelain"], worktreePath)
  return result.exitCode === 0 && result.stdout.trim().length > 0
}

export const createWorktree = async (
  spawn: SpawnFn,
  input: CreateWorktreeInput,
): Promise<Either<WorktreeError, WorktreeInfo>> => {
  const { repoPath, worktreePath, sourceBranch, targetBranch, gitCmd } = input

  if (await branchExists(gitCmd, spawn, repoPath, `refs/heads/${sourceBranch}`)) {
    return left({ kind: "branch-exists", branch: sourceBranch })
  }

  const result = await runGitOrError(
    gitCmd,
    spawn,
    ["worktree", "add", "-b", sourceBranch, worktreePath, targetBranch],
    repoPath,
  )

  if (isLeft(result)) {
    const failureText =
      result.failure.kind === "git-error"
        ? `${result.failure.stderr}\n${result.failure.message}`
        : ""
    if (failureText.includes("already exists")) {
      return left({ kind: "worktree-exists", path: worktreePath })
    }
    return left(result.failure)
  }

  return right({
    sourceBranch,
    targetBranch,
    path: worktreePath,
    repoPath,
  })
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

export const resolveDefaultBranch = async (
  gitCmd: GitCommand,
  spawn: SpawnFn,
  repoPath: string,
): Promise<string> => {
  const remoteHead = await runGit(
    gitCmd,
    spawn,
    ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
    repoPath,
  )
  if (remoteHead.exitCode === 0) {
    const remoteBranch = remoteHead.stdout.trim().replace(/^[^/]*\//, "")
    if (remoteBranch !== "") return remoteBranch
  }
  const configured = await runGit(
    gitCmd,
    spawn,
    ["config", "--get", "init.defaultBranch"],
    repoPath,
  )
  if (configured.exitCode === 0 && configured.stdout.trim() !== "") {
    return configured.stdout.trim()
  }
  return "main"
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
      stderr: result.stderr.trim(),
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
  if (isLeft(result)) return left(result.failure)

  return right(undefined)
}

const branchIsCheckedOut = async (
  gitCmd: GitCommand,
  spawn: SpawnFn,
  repoPath: string,
  branch: string,
): Promise<Either<WorktreeError, boolean>> => {
  const result = await runGit(gitCmd, spawn, ["worktree", "list", "--porcelain"], repoPath)
  if (result.exitCode !== 0) {
    return left({
      kind: "git-error",
      command: [...gitCmd, "worktree", "list", "--porcelain"].join(" "),
      stderr: result.stderr.trim(),
      message: "git worktree list failed",
    })
  }
  return right(result.stdout.split("\n").some((line) => line === `branch refs/heads/${branch}`))
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

  const checkedOut = await branchIsCheckedOut(gitCmd, spawn, repoPath, branch)
  if (isLeft(checkedOut)) return left(checkedOut.failure)
  if (checkedOut.success) {
    return left({
      kind: "git-error",
      command: `git branch -d ${branch}`,
      stderr: result.stderr.trim(),
      message: `Branch ${branch} is checked out in another worktree — refusing to delete the ref. Remove that worktree first.`,
    })
  }

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

export type WorktreeListEntry = {
  readonly path: string
  readonly head?: string
  readonly branch?: string
  readonly bare?: boolean
  readonly detached?: boolean
}

export const parseWorktreeList = (porcelain: string): readonly WorktreeListEntry[] =>
  porcelain.split("\n").reduce<readonly WorktreeListEntry[]>((entries, line) => {
    const current = entries[entries.length - 1]
    if (line.startsWith("worktree ")) {
      return [...entries, { path: line.slice("worktree ".length) }]
    }
    if (current === undefined) return entries
    const replace = (updated: WorktreeListEntry): readonly WorktreeListEntry[] => [
      ...entries.slice(0, -1),
      updated,
    ]
    if (line.startsWith("HEAD ")) return replace({ ...current, head: line.slice("HEAD ".length) })
    if (line.startsWith("branch ")) {
      return replace({
        ...current,
        branch: line.slice("branch ".length).replace(/^refs\/heads\//, ""),
      })
    }
    if (line === "bare") return replace({ ...current, bare: true })
    if (line === "detached") return replace({ ...current, detached: true })
    return entries
  }, [])

export const listWorktrees = async (
  spawn: SpawnFn,
  gitCmd: GitCommand,
  repoPath: string,
): Promise<Either<WorktreeError, readonly string[]>> => {
  const result = await runGitOrError(gitCmd, spawn, ["worktree", "list", "--porcelain"], repoPath)
  if (isLeft(result)) return left(result.failure)

  return right(parseWorktreeList(result.success).map((entry) => entry.path))
}

export type { SpawnResult }
