import type { Message, Part } from "@opencode-ai/sdk/v2"
import { isValidWorktreeName } from "./paths.js"

export type WorktreeToolName = "worktree_create" | "worktree_merge" | "worktree_remove"

export type WorktreeToolCall = {
  readonly tool: WorktreeToolName
  readonly repoShort: string
  readonly sourceBranch: string
  readonly partID?: string
}

const TOOL_NAMES: ReadonlySet<string> = new Set<WorktreeToolName>([
  "worktree_create",
  "worktree_merge",
  "worktree_remove",
])

const readName = (value: unknown): string | undefined =>
  typeof value === "string" && isValidWorktreeName(value) ? value : undefined

const toolName = (value: string): WorktreeToolName | undefined =>
  TOOL_NAMES.has(value) ? (value as WorktreeToolName) : undefined

const fromPart = (part: Part): WorktreeToolCall | undefined => {
  if (part.type !== "tool") return undefined
  const name = toolName(part.tool)
  if (name === undefined) return undefined
  const input: unknown = (part.state as { input?: unknown }).input
  const record =
    typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {}
  const repoShort = readName(record["repo_short"])
  const sourceBranch = readName(record["source_branch"])
  return repoShort !== undefined && sourceBranch !== undefined
    ? { tool: name, repoShort, sourceBranch, partID: part.id }
    : undefined
}

export const extractWorktreeCalls = (parts: readonly Part[]): readonly WorktreeToolCall[] =>
  parts.flatMap((part) => {
    const call = fromPart(part)
    return call === undefined ? [] : [call]
  })

export const collectWorktreeCalls = (
  messages: readonly Message[],
  getParts: (messageID: string) => readonly Part[],
): readonly WorktreeToolCall[] =>
  messages.flatMap((message) => extractWorktreeCalls(getParts(message.id)))

export const stepActiveWorktrees = (
  active: readonly string[],
  call: WorktreeToolCall,
): readonly string[] => {
  const name = `${call.repoShort}-${call.sourceBranch}`
  const withoutName = active.filter((entry) => entry !== name)
  return call.tool === "worktree_create" ? [...withoutName, name] : withoutName
}

export const activeWorktrees = (calls: readonly WorktreeToolCall[]): readonly string[] =>
  calls.reduce(stepActiveWorktrees, [] as readonly string[])

const callKey = (call: WorktreeToolCall): string =>
  call.partID ?? `${call.tool}:${call.repoShort}:${call.sourceBranch}`

export const recordWorktreeCall = (
  recorded: readonly WorktreeToolCall[],
  call: WorktreeToolCall,
): readonly WorktreeToolCall[] =>
  recorded.some((existing) => callKey(existing) === callKey(call)) ? recorded : [...recorded, call]

export const activeWorktreesFrom = (
  history: readonly WorktreeToolCall[],
  recorded: readonly WorktreeToolCall[],
): readonly string[] => activeWorktrees([...history, ...recorded])
