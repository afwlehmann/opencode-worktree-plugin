import * as path from "node:path"

export type PermissionRule = {
  readonly pattern: string
  readonly action: "allow" | "deny" | "ask"
}

export type ExternalDirectoryRules = {
  readonly [pattern: string]: "allow" | "deny" | "ask"
}

export type ActiveWorktrees = ReadonlySet<string>

export const createWorktreePermissionPattern = (worktreePath: string): string =>
  `${worktreePath}/**`

export const isActiveWorktreePath = (
  pattern: string,
  activeWorktrees: ActiveWorktrees,
): boolean => {
  const normalizedPattern = pattern.replace(/\/\*+$/, "")
  return Array.from(activeWorktrees).some((wt) => {
    const wtPattern = createWorktreePermissionPattern(wt)
    const normalizedWt = wtPattern.replace(/\/\*+$/, "")
    return (
      pattern === wtPattern ||
      normalizedPattern === normalizedWt ||
      normalizedPattern.startsWith(wt)
    )
  })
}

export const addWorktreePermission = (
  current: ExternalDirectoryRules | undefined,
  worktreePath: string,
): ExternalDirectoryRules => {
  const pattern = createWorktreePermissionPattern(worktreePath)
  return {
    ...(current ?? {}),
    "*": "deny",
    [pattern]: "allow",
  }
}

export const removeWorktreePermission = (
  current: ExternalDirectoryRules | undefined,
  worktreePath: string,
): ExternalDirectoryRules => {
  const pattern = createWorktreePermissionPattern(worktreePath)
  const entries = Object.entries(current ?? {}).filter(([k]) => k !== pattern)
  return Object.fromEntries(entries) as ExternalDirectoryRules
}

export const normalizePath = (filePath: string): string => path.resolve(filePath)

export const addWorktreeRootAllow = (
  config: { permission?: Record<string, unknown> },
  worktreeRoot: string,
): void => {
  const allowPattern = `${worktreeRoot}/**`
  const permission = config.permission ?? (config.permission = {})
  const extDir = permission["external_directory"]
  if (typeof extDir === "string") {
    permission["external_directory"] = { "*": extDir, [allowPattern]: "allow" }
  } else if (extDir && typeof extDir === "object") {
    ;(extDir as Record<string, string>)[allowPattern] = "allow"
  } else {
    permission["external_directory"] = { [allowPattern]: "allow" }
  }
}
