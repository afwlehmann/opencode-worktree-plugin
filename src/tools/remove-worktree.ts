import { tool } from "@opencode-ai/plugin/tool"
import type { OpencodeClient } from "@opencode-ai/sdk"
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
import { createLogger } from "../lib/logger.js"
import { toErrorMessage, type WorktreeError, isLeft } from "../types.js"

export type RemoveWorktreeDeps = {
  readonly spawn: SpawnFn
  readonly exists: PathExistsFn
  readonly options: ResolvedOptions
  readonly activeWorktrees: Set<string>
  readonly client: OpencodeClient
}

export const removeWorktreeTool = (deps: RemoveWorktreeDeps) =>
  tool({
    description:
      "You MUST use this tool instead of raw `git worktree remove`. Removes a " +
      "worktree without merging, then cleans up the worktree's external_directory " +
      "permission tracking. Refuses if uncommitted changes exist (a safety check " +
      "raw git skips). Do NOT run `git worktree remove` manually — this tool " +
      "handles the permission tracking cleanup that raw git skips. The branch " +
      "is NOT deleted — use worktree_merge for the full merge + branch delete + " +
      "cleanup flow.",
    args: {
      repo_short: tool.schema
        .string()
        .describe(
          "Short alias used to form the worktree directory name, same value " +
            "passed to worktree_create. The worktree path is " +
            "`<repo_short>-<source_branch>` under " +
            "${XDG_STATE_HOME:-~/.local/state}/opencode/worktrees/. " +
            "MUST match ^[a-z0-9][a-z0-9-]*$.",
        ),
      source_branch: tool.schema
        .string()
        .describe(
          "Name of the branch the worktree was created for (the source_branch " +
            "passed to worktree_create; lowercase kebab-case matching " +
            "^[a-z0-9][a-z0-9-]*$). The worktree at " +
            "`<repo_short>-<source_branch>` is removed. The branch itself is NOT " +
            "deleted — use worktree_merge for merge + branch delete + cleanup.",
        ),
    },
    async execute(args, context) {
      const log = createLogger(deps.client, "opencode-worktree-plugin")

      if (!isValidWorktreeName(args.repo_short) || !isValidWorktreeName(args.source_branch)) {
        const name = isValidWorktreeName(args.repo_short) ? args.source_branch : args.repo_short
        await log.log("warn", `worktree_remove: invalid name rejected: '${name}'`)
        return formatError({ kind: "invalid-name", name })
      }

      const worktreePath = await resolveWorktreePath(
        deps.exists,
        args.repo_short,
        args.source_branch,
      )

      context.metadata({ title: `Removing worktree ${args.repo_short}-${args.source_branch}` })
      await log.log(
        "info",
        `worktree_remove: repo_short=${args.repo_short} source_branch=${args.source_branch} worktree_path=${worktreePath}`,
      )

      const gitResult = await ensureGitAvailable(deps.options, deps.exists, deps.spawn)
      if (isLeft(gitResult)) {
        await log.log(
          "error",
          `worktree_remove: git not available: ${toErrorMessage(gitResult.failure)}`,
        )
        return formatError(gitResult.failure)
      }

      const repoPath = context.directory
      const flakePresent = await hasFlakeNix(repoPath, deps.exists)
      const gitCmd = resolveGitCommand(deps.options, flakePresent)
      await log.log("info", `worktree_remove: git command resolved: ${gitCmd.join(" ")}`)

      const removeResult = await removeWt(deps.spawn, {
        repoPath,
        worktreePath,
        gitCmd,
      })

      if (isLeft(removeResult)) {
        await log.log(
          "warn",
          `worktree_remove: removal failed: ${toErrorMessage(removeResult.failure)}`,
        )
        return formatError(removeResult.failure)
      }

      await log.log("info", `worktree_remove: worktree removed at ${worktreePath}`)

      deps.activeWorktrees.delete(worktreePath)
      await log.log(
        "info",
        `worktree_remove: external_directory permission tracking cleaned up for ${worktreePath} (active worktrees: ${deps.activeWorktrees.size})`,
      )

      await log.log("info", `worktree_remove: completed successfully`)

      return {
        title: `Worktree removed: ${args.repo_short}-${args.source_branch}`,
        output:
          `Worktree removed successfully.\n\n` +
          `  Path:   ${worktreePath} — removed\n` +
          `  Branch: ${args.source_branch} — NOT deleted (use worktree_merge for merge + delete)\n` +
          `  Permissions: tracking cleaned up\n`,
      }
    },
  })

const formatError = (error: WorktreeError): { title: string; output: string } => ({
  title: `Worktree error: ${error.kind}`,
  output: toErrorMessage(error),
})
