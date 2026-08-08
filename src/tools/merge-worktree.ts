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
import {
  mergeWorktree as mergeWt,
  removeWorktree as removeWt,
  deleteBranch,
} from "../lib/worktree.js"
import { toErrorMessage, type WorktreeError, isLeft } from "../types.js"

export type MergeWorktreeDeps = {
  readonly spawn: SpawnFn
  readonly exists: PathExistsFn
  readonly options: ResolvedOptions
  readonly activeWorktrees: Set<string>
}

export const mergeWorktreeTool = (deps: MergeWorktreeDeps) =>
  tool({
    description:
      "Merge a worktree's branch into the target branch using fast-forward merge only. " +
      "On success: the worktree is removed and the source branch is deleted (never force-delete). " +
      "If the merge cannot fast-forward, the tool returns an error — the agent must rebase " +
      "the worktree branch onto the target branch first, then retry. " +
      "Dynamic permissions are updated to deny access to the removed worktree.",
    args: {
      repo_short: tool.schema
        .string()
        .describe("Short alias for the repository (same as used in worktree_create)"),
      source_branch: tool.schema.string().describe("Name of the worktree branch to merge"),
      target_branch: tool.schema
        .string()
        .optional()
        .describe("Target branch to merge into (default: main)"),
    },
    async execute(args, context) {
      const targetBranch = args.target_branch ?? "main"
      const worktreePath = getWorktreePath(args.repo_short, args.source_branch)

      context.metadata({ title: `Merging ${args.source_branch} into ${targetBranch}` })

      const gitResult = await ensureGitAvailable(deps.options, deps.exists, deps.spawn)
      if (isLeft(gitResult)) {
        return formatError(gitResult.failure)
      }

      const repoPath = context.directory
      const flakePresent = await hasFlakeNix(repoPath, deps.exists)
      const gitCmd = resolveGitCommand(deps.options, flakePresent)

      const mergeResult = await mergeWt(deps.spawn, {
        repoPath,
        worktreePath,
        sourceBranch: args.source_branch,
        targetBranch,
        gitCmd,
      })

      if (isLeft(mergeResult)) {
        if (mergeResult.failure.kind === "not-fast-forward") {
          return {
            title: "Merge failed — not fast-forward",
            output:
              toErrorMessage(mergeResult.failure) +
              "\n\nTo fix this:\n" +
              `  1. cd ${worktreePath}\n` +
              `  2. ${gitCmd.join(" ")} rebase ${targetBranch}\n` +
              `  3. Resolve any conflicts and commit\n` +
              `  4. Retry worktree_merge\n\n` +
              `Alternatively, rebase non-interactively:\n` +
              `  ${gitCmd.join(" ")} rebase ${targetBranch} ${args.source_branch}`,
          }
        }
        return formatError(mergeResult.failure)
      }

      const removeResult = await removeWt(deps.spawn, {
        repoPath,
        worktreePath,
        gitCmd,
      })

      if (isLeft(removeResult)) {
        return {
          title: "Merged but worktree removal failed",
          output:
            `Branch ${args.source_branch} was merged into ${targetBranch} successfully, ` +
            `but the worktree could not be removed:\n\n${toErrorMessage(removeResult.failure)}\n\n` +
            `The merge is complete. You may need to manually run:\n` +
            `  ${gitCmd.join(" ")} worktree remove --force ${worktreePath}`,
        }
      }

      const deleteResult = await deleteBranch(
        deps.spawn,
        gitCmd,
        repoPath,
        args.source_branch,
        targetBranch,
      )
      if (isLeft(deleteResult)) {
        return {
          title: "Merged and worktree removed, branch deletion failed",
          output:
            `Worktree merged and removed successfully, but branch deletion failed:\n\n` +
            toErrorMessage(deleteResult.failure) +
            `\n\nYou may manually run: ${gitCmd.join(" ")} branch -d ${args.source_branch}`,
        }
      }

      deps.activeWorktrees.delete(worktreePath)

      return {
        title: `Merged: ${args.source_branch} → ${targetBranch}`,
        output:
          `Merge completed successfully.\n\n` +
          `  Merged:      ${args.source_branch} → ${targetBranch} (fast-forward)\n` +
          `  Worktree:    ${worktreePath} — removed\n` +
          `  Branch:      ${args.source_branch} — deleted\n` +
          `  Permissions: access to ${worktreePath} revoked\n`,
      }
    },
  })

const formatError = (error: WorktreeError): { title: string; output: string } => ({
  title: `Worktree error: ${error.kind}`,
  output: toErrorMessage(error),
})
