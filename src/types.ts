import { Result } from "effect"

export type MergeStrategy = "ff-only" | "repo-config"

export type PluginOptions = {
  readonly preferNixDevelop?: boolean
  readonly mergeStrategy?: MergeStrategy
}

export type ResolvedOptions = {
  readonly preferNixDevelop: boolean
  readonly mergeStrategy: MergeStrategy
}

export const resolveOptions = (options?: PluginOptions): ResolvedOptions => ({
  preferNixDevelop: options?.preferNixDevelop ?? false,
  mergeStrategy: options?.mergeStrategy === "repo-config" ? "repo-config" : "ff-only",
})

export type WorktreeInfo = {
  readonly sourceBranch: string
  readonly targetBranch: string
  readonly path: string
  readonly repoPath: string
}

export type GitError = {
  readonly kind: "git-error"
  readonly message: string
  readonly stderr: string
  readonly command: string
}

export type WorktreeError =
  | GitError
  | { readonly kind: "worktree-exists"; readonly path: string }
  | { readonly kind: "worktree-not-found"; readonly path: string }
  | { readonly kind: "branch-exists"; readonly branch: string }
  | {
      readonly kind: "not-fast-forward"
      readonly sourceBranch: string
      readonly targetBranch: string
      readonly stderr?: string
    }
  | {
      readonly kind: "target-dirty"
      readonly path: string
      readonly files: readonly string[]
    }
  | { readonly kind: "branch-not-merged"; readonly branch: string }
  | {
      readonly kind: "branch-not-found"
      readonly branch: string
    }
  | { readonly kind: "target-checked-out"; readonly branch: string }
  | {
      readonly kind: "merge-conflict"
      readonly sourceBranch: string
      readonly targetBranch: string
      readonly detail?: string
    }
  | { readonly kind: "invalid-name"; readonly name: string }
  | { readonly kind: "git-not-found"; readonly searchedPaths: readonly string[] }
  | { readonly kind: "uncommitted-changes"; readonly path: string }
  | {
      readonly kind: "clipboard-unavailable"
      readonly tried: readonly string[]
      readonly stderr: string
    }
  | {
      readonly kind: "copy-failed"
      readonly src: string
      readonly dest: string
      readonly message: string
    }

export type Either<E, T> = Result.Result<T, E>

export const left: <E>(error: E) => Either<E, never> = Result.fail

export const right: <T>(value: T) => Either<never, T> = Result.succeed

export function isLeft<E, T>(either: Either<E, T>): either is Result.Failure<T, E>
export function isLeft<E, T>(either: Either<E, T>): either is Result.Failure<T, E> {
  return Result.isFailure(either)
}

export function isRight<E, T>(either: Either<E, T>): either is Result.Success<T, E>
export function isRight<E, T>(either: Either<E, T>): either is Result.Success<T, E> {
  return Result.isSuccess(either)
}

export const map = <E, T, U>(either: Either<E, T>, fn: (value: T) => U): Either<E, U> =>
  Result.map(either, fn)

export const flatMap = <E, T, U>(
  either: Either<E, T>,
  fn: (value: T) => Either<E, U>,
): Either<E, U> => Result.flatMap(either, fn)

export const mapError = <E, F, T>(either: Either<E, T>, fn: (error: E) => F): Either<F, T> =>
  Result.mapError(either, fn)

export const getOrThrow: <E, T>(either: Either<E, T>) => T = Result.getOrThrow

export const toErrorMessage = (error: WorktreeError): string => {
  switch (error.kind) {
    case "git-error":
      return `Git command failed: ${error.command}\n${error.stderr}`
    case "worktree-exists":
      return `Worktree already exists at ${error.path}`
    case "worktree-not-found":
      return `Worktree not found at ${error.path}`
    case "branch-exists":
      return `Branch already exists: ${error.branch}`
    case "not-fast-forward": {
      const hint =
        `Cannot fast-forward merge ${error.sourceBranch} into ${error.targetBranch} — ` +
        `fast-forward-only merges are required (plugin default or the repository's ` +
        `merge.ff=only). Rebase the worktree branch onto ${error.targetBranch} first, then retry.`
      return error.stderr && error.stderr !== "" ? `${hint}\ngit output: ${error.stderr}` : hint
    }
    case "target-dirty":
      return (
        `The main working copy at ${error.path} has uncommitted changes to files that ` +
        `the fast-forward merge would update: ${error.files.join(", ")}. ` +
        `Commit or stash them first — they may belong to another session, so do not discard them.`
      )
    case "branch-not-merged":
      return `Branch ${error.branch} is not merged into the target. Refusing to delete (use -D would be required, which is not allowed).`
    case "branch-not-found":
      return `Branch not found: ${error.branch}`
    case "target-checked-out":
      return (
        `Target branch ${error.branch} is checked out in another worktree — refusing to ` +
        `update its ref behind that working copy. Merge from the working copy that has ` +
        `${error.branch} checked out instead.`
      )
    case "merge-conflict": {
      const hint =
        `Merging ${error.sourceBranch} into ${error.targetBranch} produced conflicts; ` +
        `the merge was rolled back and nothing was changed. Rebase the worktree branch ` +
        `onto ${error.targetBranch} and resolve the conflicts in the worktree, then retry.`
      return error.detail && error.detail !== "" ? `${hint}\ngit output: ${error.detail}` : hint
    }
    case "invalid-name":
      return (
        `Invalid name '${error.name}': repo_short and source_branch must be lowercase ` +
        `kebab-case (letters, digits, and dashes) matching ^[a-z0-9][a-z0-9-]*$ — ` +
        `no slashes, dots, or uppercase.`
      )
    case "git-not-found":
      return `git not found on PATH. Searched: ${error.searchedPaths.join(", ")}`
    case "uncommitted-changes":
      return `Worktree at ${error.path} has uncommitted changes. Commit or stash before removing.`
    case "copy-failed":
      return `Failed to copy ${error.src} to ${error.dest}: ${error.message}`
    case "clipboard-unavailable":
      return (
        `Clipboard unavailable (tried: ${error.tried.join(", ") || "no candidates for this platform"}).` +
        (error.stderr !== "" ? ` ${error.stderr}` : "")
      )
  }
}
