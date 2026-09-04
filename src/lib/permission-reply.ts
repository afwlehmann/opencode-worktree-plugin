/**
 * Pure decision logic for pedantic permission mode: given a `permission.asked`
 * event's properties and the currently active plugin worktree paths (derived
 * from git), decide whether the plugin should transparently reply to the
 * request on the user's behalf.
 *
 * The reply is only produced when every asked `external_directory` pattern is
 * inside an active plugin worktree — never for paths that merely sit under the
 * worktree root but do not belong to a live worktree (e.g. after a
 * worktree_merge/worktree_remove, or a directory created by raw git).
 *
 * The suggested `always` patterns are only approved persistently ("always")
 * when they are themselves scoped inside active worktrees; otherwise the
 * approval is one-shot ("once") so nothing outside the worktrees is cached in
 * the session's approved ruleset.
 */
import { isInsideWorktreeRoot } from "./permissions.js"

export type PermissionAskedProperties = {
  readonly id?: unknown
  readonly sessionID?: unknown
  readonly permission?: unknown
  readonly type?: unknown
  readonly pattern?: unknown
  readonly patterns?: unknown
  readonly always?: unknown
}

export type PedanticReply = {
  readonly sessionID: string
  readonly requestID: string
  readonly response: "once" | "always"
  readonly patterns: readonly string[]
}

const asStrings = (value: readonly unknown[]): readonly string[] =>
  value.flatMap((item): readonly string[] =>
    typeof item === "string" && item !== "" ? [item] : [],
  )

const extractPatterns = (properties: PermissionAskedProperties): readonly string[] => {
  const fromPatterns = Array.isArray(properties.patterns) ? asStrings(properties.patterns) : []
  const fromPattern = Array.isArray(properties.pattern)
    ? asStrings(properties.pattern)
    : typeof properties.pattern === "string" && properties.pattern !== ""
      ? [properties.pattern]
      : []
  return [...fromPatterns, ...fromPattern]
}

const extractAlways = (properties: PermissionAskedProperties): readonly string[] =>
  Array.isArray(properties.always) ? asStrings(properties.always) : []

const isExternalDirectory = (properties: PermissionAskedProperties): boolean =>
  properties.permission === "external_directory" || properties.type === "external_directory"

const insideActiveWorktrees = (
  patterns: readonly string[],
  activeWorktreePaths: readonly string[],
): boolean =>
  patterns.length > 0 &&
  patterns.every((pattern) =>
    activeWorktreePaths.some((worktreePath) => isInsideWorktreeRoot(pattern, worktreePath)),
  )

export const pedanticReply = (
  properties: PermissionAskedProperties,
  activeWorktreePaths: readonly string[],
): PedanticReply | undefined => {
  if (!isExternalDirectory(properties)) return undefined
  const sessionID = typeof properties.sessionID === "string" ? properties.sessionID : undefined
  const requestID = typeof properties.id === "string" ? properties.id : undefined
  if (sessionID === undefined || requestID === undefined) return undefined
  if (activeWorktreePaths.length === 0) return undefined

  const patterns = extractPatterns(properties)
  if (!insideActiveWorktrees(patterns, activeWorktreePaths)) return undefined

  const always = extractAlways(properties)
  const response: "once" | "always" = insideActiveWorktrees(always, activeWorktreePaths)
    ? "always"
    : "once"

  return { sessionID, requestID, response, patterns }
}
