import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as os from "node:os"

export type WorktreeRoot = string

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/

export const isValidWorktreeName = (name: string): boolean => NAME_PATTERN.test(name)

export const getWorktreeRoot = (): WorktreeRoot => {
  const xdgStateHome = process.env["XDG_STATE_HOME"]
  const base = xdgStateHome ?? path.join(os.homedir(), ".local", "state")
  return path.join(base, "opencode", "worktrees")
}

export const getWorktreePath = (repoShort: string, branch: string): string =>
  path.join(getWorktreeRoot(), `${repoShort}-${branch}`)

type PathExistsFn = (path: string) => Promise<boolean>

const realpathAncestor = async (dir: string, exists: PathExistsFn): Promise<string> => {
  if (await exists(dir)) {
    try {
      return await fs.realpath(dir)
    } catch {
      return dir
    }
  }
  const parent = path.dirname(dir)
  if (parent === dir) return dir
  const resolvedParent = await realpathAncestor(parent, exists)
  return path.join(resolvedParent, path.basename(dir))
}

export const resolveWorktreeRoot = async (exists: PathExistsFn): Promise<WorktreeRoot> =>
  realpathAncestor(getWorktreeRoot(), exists)

export const resolveWorktreePath = async (
  exists: PathExistsFn,
  repoShort: string,
  branch: string,
): Promise<string> => path.join(await resolveWorktreeRoot(exists), `${repoShort}-${branch}`)

export const ensureWorktreeRoot = async (
  mkdir: (path: string, opts: { recursive: boolean }) => Promise<void>,
): Promise<void> => {
  await mkdir(getWorktreeRoot(), { recursive: true })
}
