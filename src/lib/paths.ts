import * as path from "node:path"
import * as os from "node:os"

export type WorktreeRoot = string

export const getWorktreeRoot = (): WorktreeRoot => {
  const xdgStateHome = process.env["XDG_STATE_HOME"]
  const base = xdgStateHome ?? path.join(os.homedir(), ".local", "state")
  return path.join(base, "opencode", "worktrees")
}

export const getWorktreePath = (repoShort: string, branch: string): string =>
  path.join(getWorktreeRoot(), `${repoShort}-${branch}`)

export const ensureWorktreeRoot = async (
  mkdir: (path: string, opts: { recursive: boolean }) => Promise<void>,
): Promise<void> => {
  await mkdir(getWorktreeRoot(), { recursive: true })
}
