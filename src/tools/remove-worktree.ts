import { tool } from "@opencode-ai/plugin/tool"
import type { ResolvedOptions } from "../types.js"
import { isValidWorktreeName, resolveWorktreePath } from "../lib/paths.js"
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
      "Side effects that raw git would skip: (0) external_directory permissions " +
      "for the worktree path are revoked via the plugin's `permission.ask` hook — " +
      "the auto-allow granted at create time is removed; (1) the worktree is " +
      "untracked from the permission hook. The branch is NOT deleted — use " +
      "worktree_merge for the full merge + branch delete + cleanup flow.",
    args: {
      repo_short: tool.schema
        .string()
        .describe(
          "Short alias used to form the worktree directory name, same value " +
            "passed to worktree_create. The worktree path is " +
            "`<repo_short>-<source_branch>` under " +
            "${XDG_STATE_HOME:-~/.local/state}/opencode/worktrees/.",
        ),
      source_branch: tool.schema
        .string()
        .describe(
          "Name of the branch the worktree was created for (the source_branch " +
            "passed to worktree_create). The worktree at " +
            "`<repo_short>-<source_branch>` is removed. The branch itself is NOT " +
            "deleted — use worktree_merge for merge + branch delete + cleanup.",
        ),
    },
    async execute(args, context) {
      if (!isValidWorktreeName(args.repo_short) || !isValidWorktreeName(args.source_branch)) {
        const name = isValidWorktreeName(args.repo_short) ? args.source_branch : args.repo_short
        return formatError({ kind: "invalid-name", name })
      }

      const worktreePath = await resolveWorktreePath(deps.exists, args.repo_short, args.source_branch)

      context.metadata({ title: `Removing worktree ${args.repo_short}-${args.source_branch}` })

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
        title: `Worktree removed: ${args.repo_short}-${args.source_branch}`,
        output:
          `Worktree removed successfully.\n\n` +
          `  Path:   ${worktreePath} — removed\n` +
          `  Branch: ${args.source_branch} — NOT deleted (use worktree_merge for merge + delete)\n` +
          `  Permissions: access to ${worktreePath} revoked\n`,
      }
    },
  })

const formatError = (error: WorktreeError): { title: string; output: string } => ({
  title: `Worktree error: ${error.kind}`,
  output: toErrorMessage(error),
})
