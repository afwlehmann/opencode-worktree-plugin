import type { Either, MergeStrategy, WorktreeError, WorktreeInfo } from "../types.js"
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
  readonly mergeStrategy: MergeStrategy
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

export type MergeStyle = "fast-forward" | "merge-commit"

export type MergeResult = {
  readonly mode: MergeMode
  readonly style: MergeStyle
}

type MergeFfConfig = "default" | "no-ff" | "ff-only"

const combinedOutput = (result: SpawnResult): string =>
  [result.stderr.trim(), result.stdout.trim()].filter((text) => text !== "").join("\n")

const statusPaths = async (
  gitCmd: GitCommand,
  spawn: SpawnFn,
  repoPath: string,
): Promise<readonly string[]> => {
  const result = await runGit(gitCmd, spawn, ["status", "--porcelain", "-uall"], repoPath)
  if (result.exitCode !== 0) return []
  return result.stdout.split("\n").flatMap((line) => {
    if (line === "" || line.length < 4) return []
    return line.slice(3).split(" -> ")
  })
}

const pathsChangedByMerge = async (
  gitCmd: GitCommand,
  spawn: SpawnFn,
  repoPath: string,
  sourceBranch: string,
): Promise<readonly string[]> => {
  const result = await runGit(
    gitCmd,
    spawn,
    ["diff", "--name-only", "HEAD", sourceBranch],
    repoPath,
  )
  if (result.exitCode !== 0) return []
  return result.stdout.split("\n").filter((line) => line !== "")
}

const readMergeFfConfig = async (
  gitCmd: GitCommand,
  spawn: SpawnFn,
  repoPath: string,
): Promise<MergeFfConfig> => {
  const result = await runGit(gitCmd, spawn, ["config", "--get", "merge.ff"], repoPath)
  if (result.exitCode !== 0) return "default"
  const value = result.stdout.trim()
  if (value === "only") return "ff-only"
  if (value === "false" || value === "no" || value === "off" || value === "0") return "no-ff"
  return "default"
}

const effectiveFfConfig = async (
  mergeStrategy: MergeStrategy,
  gitCmd: GitCommand,
  spawn: SpawnFn,
  repoPath: string,
): Promise<MergeFfConfig> =>
  mergeStrategy === "repo-config" ? await readMergeFfConfig(gitCmd, spawn, repoPath) : "ff-only"

const canFastForward = async (
  gitCmd: GitCommand,
  spawn: SpawnFn,
  repoPath: string,
  sourceBranch: string,
  targetBranch: string,
): Promise<boolean> => {
  const result = await runGit(
    gitCmd,
    spawn,
    ["merge-base", "--is-ancestor", targetBranch, sourceBranch],
    repoPath,
  )
  return result.exitCode === 0
}

const mergeArgs = (ffConfig: MergeFfConfig, sourceBranch: string): readonly string[] =>
  ffConfig === "ff-only"
    ? ["merge", "--ff-only", sourceBranch]
    : ffConfig === "no-ff"
      ? ["merge", "--no-ff", sourceBranch]
      : ["merge", sourceBranch]

const mergeInWorkingCopy = async (
  gitCmd: GitCommand,
  spawn: SpawnFn,
  repoPath: string,
  sourceBranch: string,
  targetBranch: string,
  ffConfig: MergeFfConfig,
  fastForwardPossible: boolean,
): Promise<Either<WorktreeError, MergeStyle>> => {
  const result = await runGit(gitCmd, spawn, mergeArgs(ffConfig, sourceBranch), repoPath)
  if (result.exitCode === 0) {
    return right(
      ffConfig === "no-ff"
        ? "merge-commit"
        : ffConfig === "ff-only" || fastForwardPossible
          ? "fast-forward"
          : "merge-commit",
    )
  }
  if (ffConfig === "ff-only") {
    return left({
      kind: "not-fast-forward",
      sourceBranch,
      targetBranch,
      stderr: combinedOutput(result),
    })
  }
  await runGit(gitCmd, spawn, ["merge", "--abort"], repoPath)
  return left({
    kind: "merge-conflict",
    sourceBranch,
    targetBranch,
    detail: combinedOutput(result),
  })
}

const mergeCommitRefOnly = async (
  gitCmd: GitCommand,
  spawn: SpawnFn,
  repoPath: string,
  sourceBranch: string,
  targetBranch: string,
): Promise<Either<WorktreeError, void>> => {
  const oldRef = await runGit(gitCmd, spawn, ["rev-parse", `refs/heads/${targetBranch}`], repoPath)
  if (oldRef.exitCode !== 0) {
    return left({
      kind: "git-error",
      command: [...gitCmd, "rev-parse", `refs/heads/${targetBranch}`].join(" "),
      stderr: oldRef.stderr.trim(),
      message: `git rev-parse failed for target branch ${targetBranch}`,
    })
  }

  const mergedTree = await runGit(
    gitCmd,
    spawn,
    ["merge-tree", "--write-tree", targetBranch, sourceBranch],
    repoPath,
  )
  if (mergedTree.exitCode === 1) {
    return left({
      kind: "merge-conflict",
      sourceBranch,
      targetBranch,
      detail: mergedTree.stdout.trim(),
    })
  }
  if (mergedTree.exitCode !== 0) {
    return left({
      kind: "git-error",
      command: [...gitCmd, "merge-tree", "--write-tree", targetBranch, sourceBranch].join(" "),
      stderr: mergedTree.stderr.trim(),
      message: "git merge-tree failed",
    })
  }

  const tree = mergedTree.stdout.split("\n")[0]?.trim() ?? ""
  if (tree === "") {
    return left({
      kind: "git-error",
      command: [...gitCmd, "merge-tree", "--write-tree", targetBranch, sourceBranch].join(" "),
      stderr: mergedTree.stderr.trim(),
      message: "git merge-tree did not output a merged tree",
    })
  }

  const commit = await runGit(
    gitCmd,
    spawn,
    [
      "commit-tree",
      tree,
      "-p",
      targetBranch,
      "-p",
      sourceBranch,
      "-m",
      `Merge branch '${sourceBranch}' into ${targetBranch}`,
    ],
    repoPath,
  )
  if (commit.exitCode !== 0) {
    return left({
      kind: "git-error",
      command: [...gitCmd, "commit-tree", tree].join(" "),
      stderr: commit.stderr.trim(),
      message: "git commit-tree failed",
    })
  }

  const update = await runGit(
    gitCmd,
    spawn,
    ["update-ref", `refs/heads/${targetBranch}`, commit.stdout.trim(), oldRef.stdout.trim()],
    repoPath,
  )
  if (update.exitCode !== 0) {
    return left({
      kind: "git-error",
      command: [...gitCmd, "update-ref", `refs/heads/${targetBranch}`].join(" "),
      stderr: update.stderr.trim(),
      message: "git update-ref failed — the target branch moved during the merge; retry",
    })
  }
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

export const mergeWorktree = async (
  spawn: SpawnFn,
  input: MergeWorktreeInput,
): Promise<Either<WorktreeError, MergeResult>> => {
  const { repoPath, worktreePath, sourceBranch, targetBranch, mergeStrategy, gitCmd } = input

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
  const ffConfig = await effectiveFfConfig(mergeStrategy, gitCmd, spawn, repoPath)
  const fastForwardPossible = await canFastForward(
    gitCmd,
    spawn,
    repoPath,
    sourceBranch,
    targetBranch,
  )

  if (onTarget) {
    const dirty = await statusPaths(gitCmd, spawn, repoPath)
    if (dirty.length > 0) {
      const changed = await pathsChangedByMerge(gitCmd, spawn, repoPath, sourceBranch)
      const blocking = dirty.filter((path) => changed.includes(path))
      if (blocking.length > 0) {
        return left({ kind: "target-dirty", path: repoPath, files: blocking })
      }
    }
    const merged = await mergeInWorkingCopy(
      gitCmd,
      spawn,
      repoPath,
      sourceBranch,
      targetBranch,
      ffConfig,
      fastForwardPossible,
    )
    if (isLeft(merged)) return left(merged.failure)
    return right({ mode: "working-copy", style: merged.success })
  }

  const targetCheckedOut = await branchIsCheckedOut(gitCmd, spawn, repoPath, targetBranch)
  if (isLeft(targetCheckedOut)) return left(targetCheckedOut.failure)
  if (targetCheckedOut.success) {
    return left({ kind: "target-checked-out", branch: targetBranch })
  }

  if (ffConfig === "ff-only" && !fastForwardPossible) {
    return left({
      kind: "not-fast-forward",
      sourceBranch,
      targetBranch,
      stderr:
        "fast-forward is not possible and the merge strategy requires fast-forward-only merges",
    })
  }

  if (ffConfig !== "no-ff" && fastForwardPossible) {
    const result = await runGit(
      gitCmd,
      spawn,
      ["fetch", ".", `${sourceBranch}:${targetBranch}`],
      repoPath,
    )
    if (result.exitCode !== 0) {
      return left({
        kind: "not-fast-forward",
        sourceBranch,
        targetBranch,
        stderr: combinedOutput(result),
      })
    }
    return right({ mode: "ref-only", style: "fast-forward" })
  }

  const merged = await mergeCommitRefOnly(gitCmd, spawn, repoPath, sourceBranch, targetBranch)
  if (isLeft(merged)) return left(merged.failure)
  return right({ mode: "ref-only", style: "merge-commit" })
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
