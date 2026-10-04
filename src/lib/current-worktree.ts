import * as path from "node:path"
import { isInsideWorktreeRoot } from "./permissions.js"
import { isValidWorktreeName } from "./paths.js"

export type CurrentWorktreeInput = {
  readonly active: readonly string[]
  readonly closedNames: readonly string[]
  readonly sessionDirectory: string | undefined
  readonly worktreeRoot: string
  readonly recencyName: string | undefined
}

const sessionWorktreeName = (
  sessionDirectory: string,
  worktreeRoot: string,
): string | undefined => {
  if (!isInsideWorktreeRoot(sessionDirectory, worktreeRoot)) return undefined
  const firstSegment = path.relative(worktreeRoot, sessionDirectory).split(path.sep)[0] ?? ""
  return isValidWorktreeName(firstSegment) ? firstSegment : undefined
}

export const currentWorktreeEntries = (input: CurrentWorktreeInput): readonly string[] => {
  if (input.active.length > 0) return input.active
  const closed = new Set(input.closedNames)
  const sessionName =
    input.sessionDirectory === undefined
      ? undefined
      : sessionWorktreeName(input.sessionDirectory, input.worktreeRoot)
  if (sessionName !== undefined && !closed.has(sessionName)) return [sessionName]
  if (input.recencyName !== undefined && !closed.has(input.recencyName)) return [input.recencyName]
  return []
}
