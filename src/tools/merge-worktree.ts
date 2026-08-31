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
import {
  mergeWorktree as mergeWt,
  removeWorktree as removeWt,
  deleteBranch,
} from "../lib/worktree.js"
import { toErrorMessage, type WorktreeError, isLeft, getOrThrow } from "../types.js"

export type MergeWorktreeDeps = {
  readonly spawn: SpawnFn
  readonly exists: PathExistsFn
  readonly options: ResolvedOptions
  readonly activeWorktrees: Set<string>
}

export const mergeWorktreeTool = (deps: MergeWorktreeDeps) =>
  tool({
    description:
      "Prefer this tool over raw `git merge` + `git worktree remove`. Merges a " +
      "worktree's branch into the target branch using fast-forward merge only. On " +
      "success: the worktree is removed and the source branch is deleted (`-d` only, " +
      "never force-delete). Side effects that raw git would skip: (0) external_directory " +
      "permissions for the worktree path are revoked via the plugin's " +
      "`permission.ask` hook — the auto-allow granted at create time is removed; " +
      "(1) the worktree is untracked from the permission hook, (2) branch deletion is " +
      "`-d`-only (refuses if not fully merged). If the merge cannot fast-forward, " +
      "rebase the worktree branch onto the target first, then retry. Workflow: call " +
      "worktree_create first, then this to fold changes back.",
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
          "Name of the worktree branch to merge. MUST match the " +
            "source_branch used at worktree_create time. The worktree at " +
            "`<repo_short>-<source_branch>` is removed after a successful merge, " +
            "and this branch is deleted with `git branch -d` (never `-D`).",
        ),
      target_branch: tool.schema
        .string()
        .optional()
        .describe(
          "Target branch to merge into (default: main). The source_branch " +
            "is fast-forward-merged into this branch. If a fast-forward is not " +
            "possible, rebase the source_branch onto this target first, then retry.",
        ),
    },
    async execute(args, context) {
      const targetBranch = args.target_branch ?? "main"

      if (!isValidWorktreeName(args.repo_short) || !isValidWorktreeName(args.source_branch)) {
        const name = isValidWorktreeName(args.repo_short) ? args.source_branch : args.repo_short
        return formatError({ kind: "invalid-name", name })
      }

      const worktreePath = await resolveWorktreePath(
        deps.exists,
        args.repo_short,
        args.source_branch,
      )

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

      const mergeMode = getOrThrow(mergeResult)

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
          `  Merged:      ${args.source_branch} → ${targetBranch} (fast-forward, ` +
          `${mergeMode === "ref-only" ? "target ref updated — main working copy untouched" : "main working copy updated"})\n` +
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
