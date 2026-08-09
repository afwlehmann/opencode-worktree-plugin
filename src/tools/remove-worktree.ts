import { tool } from "@opencode-ai/plugin/tool"
import type { ResolvedOptions } from "../types.js"
import { getWorktreePath } from "../lib/paths.js"
import {
  type SpawnFn,
  type PathExistsFn,
  ensureGitAvailable,
  hasFlakeNix,
  resolveGitCommand,
} from "../lib/git-env.js"
import { removeWorktree as removeWt } from "../lib/worktree.js"
import { toErrorMessage, type WorktreeError, isLeft } from "../types.js"

export type RemoveWorktreeDeps = {
  readonly spawn: SpawnFn
  readonly exists: PathExistsFn
  readonly options: ResolvedOptions
  readonly activeWorktrees: Set<string>
}

export const removeWorktreeTool = (deps: RemoveWorktreeDeps) =>
  tool({
    description:
      "Prefer this tool over raw `git worktree remove`. Removes a worktree without " +
      "merging. Refuses if uncommitted changes exist (safety check raw git skips). " +
      "Side effects that raw git would skip: (1) external_directory permissions are " +
      "revoked for the worktree path, (2) the worktree is untracked from the " +
      "permission hook. The branch is NOT deleted — use worktree_merge for the full " +
      "merge + branch delete + cleanup flow.",
    args: {
      repo_short: tool.schema
        .string()
        .describe("Short alias for the repository (same as used in worktree_create)"),
      branch: tool.schema.string().describe("Name of the branch the worktree was created for"),
    },
    async execute(args, context) {
      const worktreePath = getWorktreePath(args.repo_short, args.branch)

      context.metadata({ title: `Removing worktree ${args.repo_short}-${args.branch}` })

      const gitResult = await ensureGitAvailable(deps.options, deps.exists, deps.spawn)
      if (isLeft(gitResult)) {
        return formatError(gitResult.failure)
      }

      const repoPath = context.directory
      const flakePresent = await hasFlakeNix(repoPath, deps.exists)
      const gitCmd = resolveGitCommand(deps.options, flakePresent)

      const removeResult = await removeWt(deps.spawn, {
        repoPath,
        worktreePath,
        gitCmd,
      })

      if (isLeft(removeResult)) {
        return formatError(removeResult.failure)
      }

      deps.activeWorktrees.delete(worktreePath)

      return {
        title: `Worktree removed: ${args.repo_short}-${args.branch}`,
        output:
          `Worktree removed successfully.\n\n` +
          `  Path:   ${worktreePath} — removed\n` +
          `  Branch: ${args.branch} — NOT deleted (use worktree_merge for merge + delete)\n` +
          `  Permissions: access to ${worktreePath} revoked\n`,
      }
    },
  })

const formatError = (error: WorktreeError): { title: string; output: string } => ({
  title: `Worktree error: ${error.kind}`,
  output: toErrorMessage(error),
})
