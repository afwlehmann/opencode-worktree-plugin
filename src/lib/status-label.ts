import * as path from "node:path"
import type { SessionStatus } from "@opencode-ai/sdk/v2"

export const formatSessionStatus = (status: SessionStatus | undefined): string => {
  if (status === undefined || status.type === "idle") return ""
  if (status.type === "retry") return `retry ${status.attempt}`
  return status.type
}

export const formatStatusLabel = (
  directory: string,
  branch: string | undefined,
  worktreeRoot: string,
): string => {
  const dir = path.relative(worktreeRoot, directory)
  const underRoot = dir !== "" && !dir.startsWith("..") && !path.isAbsolute(dir)
  const label = underRoot ? dir : path.basename(directory)
  const lastSegment = label.slice(label.lastIndexOf("-") + 1)
  const nameEncodesBranch = underRoot && branch !== undefined && lastSegment === branch
  return nameEncodesBranch ? label : `${label}:${branch ?? "unknown"}`
}

export const formatWorktreeEntries = (entries: readonly string[]): string => {
  if (entries.length === 0) return ""
  if (entries.length === 1) return entries[0] ?? ""
  const latest = entries[entries.length - 1] ?? ""
  return `${latest} (${entries.length})`
}

export const formatSessionStatusLabel = (
  directory: string,
  branch: string | undefined,
  worktreeRoot: string,
  worktreeEntries: readonly string[],
): string =>
  worktreeEntries.length > 0
    ? formatWorktreeEntries(worktreeEntries)
    : formatStatusLabel(directory, branch, worktreeRoot)
