export type PluginOptions = {
  readonly preferNixDevelop?: boolean
}

export type ResolvedOptions = {
  readonly preferNixDevelop: boolean
}

export const resolveOptions = (options?: PluginOptions): ResolvedOptions => ({
  preferNixDevelop: options?.preferNixDevelop ?? false,
})

export type WorktreeInfo = {
  readonly repoShort: string
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
    }
  | { readonly kind: "branch-not-merged"; readonly branch: string }
  | { readonly kind: "branch-not-found"; readonly branch: string }
  | { readonly kind: "invalid-name"; readonly name: string }
  | { readonly kind: "git-not-found"; readonly searchedPaths: readonly string[] }
  | { readonly kind: "uncommitted-changes"; readonly path: string }
  | {
      readonly kind: "copy-failed"
      readonly src: string
      readonly dest: string
      readonly message: string
    }

export type Either<E, T> =
  { readonly _tag: "Left"; readonly error: E } | { readonly _tag: "Right"; readonly value: T }

export const left = <E>(error: E): Either<E, never> => ({ _tag: "Left", error })

export const right = <T>(value: T): Either<never, T> => ({ _tag: "Right", value })

export const isLeft = <E, T>(either: Either<E, T>): either is { _tag: "Left"; error: E } =>
  either._tag === "Left"

export const isRight = <E, T>(either: Either<E, T>): either is { _tag: "Right"; value: T } =>
  either._tag === "Right"

export const map = <E, T, U>(either: Either<E, T>, fn: (value: T) => U): Either<E, U> =>
  either._tag === "Right" ? right(fn(either.value)) : (either as Either<E, U>)

export const flatMap = <E, T, U>(
  either: Either<E, T>,
  fn: (value: T) => Either<E, U>,
): Either<E, U> => (either._tag === "Right" ? fn(either.value) : (either as Either<E, U>))

export const mapError = <E, F, T>(either: Either<E, T>, fn: (error: E) => F): Either<F, T> =>
  either._tag === "Left" ? left(fn(either.error)) : (either as Either<F, T>)

export const getOrThrow = <E, T>(either: Either<E, T>): T => {
  if (either._tag === "Left") throw either.error
  return either.value
}

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
    case "not-fast-forward":
      return `Cannot fast-forward merge ${error.sourceBranch} into ${error.targetBranch}. Rebase the worktree branch onto ${error.targetBranch} first, then retry.`
    case "branch-not-merged":
      return `Branch ${error.branch} is not merged into the target. Refusing to delete (use -D would be required, which is not allowed).`
    case "branch-not-found":
      return `Branch not found: ${error.branch}`
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
  }
}
