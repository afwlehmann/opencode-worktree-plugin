import * as path from "node:path"

export const isInsideWorktreeRoot = (candidate: string, root: string): boolean => {
  const relative = path.relative(root, candidate)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

export const isInsideAnyRoot = (candidate: string, roots: readonly string[]): boolean =>
  roots.some((root) => isInsideWorktreeRoot(candidate, root))

export const activeWorktreePaths = (
  worktreePaths: readonly string[],
  roots: readonly string[],
): readonly string[] => worktreePaths.filter((worktreePath) => isInsideAnyRoot(worktreePath, roots))

export const addWorktreeRootAllow = (
  config: { permission?: Record<string, unknown> },
  worktreeRoots: readonly string[],
): void => {
  const permission = config.permission ?? (config.permission = {})
  const extDir = permission["external_directory"]
  if (typeof extDir === "string") {
    const rules: Record<string, string> = { "*": extDir }
    for (const root of worktreeRoots) rules[`${root}/**`] = "allow"
    permission["external_directory"] = rules
  } else if (extDir && typeof extDir === "object") {
    for (const root of worktreeRoots) {
      ;(extDir as Record<string, string>)[`${root}/**`] = "allow"
    }
  } else {
    const rules: Record<string, string> = {}
    for (const root of worktreeRoots) rules[`${root}/**`] = "allow"
    permission["external_directory"] = rules
  }
}
