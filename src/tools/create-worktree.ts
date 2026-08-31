import { tool } from "@opencode-ai/plugin/tool"
import type { ResolvedOptions } from "../types.js"
import { isValidWorktreeName, resolveWorktreePath, ensureWorktreeRoot } from "../lib/paths.js"
import {
  type GitCommand,
  type SpawnFn,
  type PathExistsFn,
  ensureGitAvailable,
  hasFlakeNix,
  resolveGitCommand,
} from "../lib/git-env.js"
import { createWorktree as createWt, listWorktrees } from "../lib/worktree.js"
import { detectOpencodeDir, shouldPromptForCopy, copyOpencodeDir } from "../lib/opencode-dir.js"
import { toErrorMessage, type WorktreeError, isLeft, isRight } from "../types.js"

export type ToolContext = {
  readonly sessionID: string
  readonly messageID: string
  readonly agent: string
  readonly directory: string
  readonly worktree: string
  readonly abort: AbortSignal
  readonly metadata: (input: { title?: string; metadata?: Record<string, unknown> }) => void
  readonly ask: (input: {
    permission: string
    patterns: string[]
    always: string[]
    metadata: Record<string, unknown>
  }) => Promise<void>
}

export type CreateWorktreeDeps = {
  readonly spawn: SpawnFn
  readonly exists: PathExistsFn
  readonly mkdir: (path: string, opts: { recursive: boolean }) => Promise<void>
  readonly options: ResolvedOptions
  readonly activeWorktrees: Set<string>
}

export const createWorktreeTool = (deps: CreateWorktreeDeps) =>
  tool({
    description:
      "Prefer this tool over raw `git worktree add`. Create a git worktree for a " +
      "repository, created under ${XDG_STATE_HOME}/opencode/worktrees/<repo_short>-<source_branch>. " +
      "Creates a new branch from the target branch (default: main). Side effects " +
      "that raw git would skip: (0) external_directory permission for the worktree " +
      "path is auto-allowed via the plugin's `permission.ask` hook — without this, " +
      "working in the worktree path will prompt/deny; (1) external_directory " +
      "permissions are updated so the agent can access the worktree path, (2) a " +
      "gitignored/untracked .opencode/ directory is detected and the user is " +
      "prompted to copy it into the worktree, (3) the worktree path is tracked " +
      "for the permission hook. Workflow: call this first, then work in the " +
      "returned path, then call worktree_merge (to fold back) or worktree_remove " +
      "(to discard).",
    args: {
      repo_short: tool.schema
        .string()
        .describe(
          "Short alias used to form the worktree directory name " +
            "`<repo_short>-<source_branch>` under " +
            "${XDG_STATE_HOME:-~/.local/state}/opencode/worktrees/. " +
            "Pick any short, lowercase, kebab-case identifier for the repo " +
            "(e.g. 'ocp' for opencode-worktree-plugin). MUST be the same value " +
            "across worktree_create / worktree_merge / worktree_remove.",
        ),
      source_branch: tool.schema
        .string()
        .describe(
          "Name of the new branch to create in the worktree. The worktree " +
            "path is derived from this: `<repo_short>-<source_branch>`. MUST " +
            "match the branch used at creation time when calling worktree_merge " +
            "or worktree_remove later.",
        ),
      target_branch: tool.schema
        .string()
        .optional()
        .describe(
          "Existing branch to branch off from (default: main). The new " +
            "source_branch is created from this branch. For worktree_merge, " +
            "this is the branch the source_branch is merged back into.",
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

      context.metadata({ title: `Creating worktree ${args.repo_short}-${args.source_branch}` })

      await ensureWorktreeRoot(deps.mkdir)

      const gitResult = await ensureGitAvailable(deps.options, deps.exists, deps.spawn)
      if (isLeft(gitResult)) {
        return formatError(gitResult.failure)
      }

      const repoPath = context.directory

      const flakePresent = await hasFlakeNix(repoPath, deps.exists)
      const resolvedGitCmd: GitCommand = resolveGitCommand(deps.options, flakePresent)

      const createResult = await createWt(deps.spawn, {
        repoPath,
        worktreePath,
        sourceBranch: args.source_branch,
        targetBranch,
        gitCmd: resolvedGitCmd,
      })

      if (isLeft(createResult)) {
        return formatError(createResult.failure)
      }

      const opencodeStatus = await detectOpencodeDir(deps.spawn, resolvedGitCmd, repoPath)
      if (shouldPromptForCopy(opencodeStatus)) {
        try {
          await context.ask({
            permission: "bash",
            patterns: [`cp -R .opencode ${worktreePath}/.opencode`],
            always: [],
            metadata: {
              prompt:
                `A gitignored/untracked .opencode/ directory was found in the source repo.\n` +
                `Copy it to the worktree at ${worktreePath}?`,
            },
          })

          const copyResult = await copyOpencodeDir(repoPath, worktreePath)
          if (isLeft(copyResult)) {
            return formatError(copyResult.failure)
          }
        } catch {
          return {
            title: "Worktree created (copy declined)",
            output:
              `Worktree created at ${worktreePath} on branch ${args.source_branch} ` +
              `(from ${targetBranch}). .opencode/ copy was declined by user.\n\n` +
              `Use this path for working in the worktree: ${worktreePath}`,
          }
        }
      }

      deps.activeWorktrees.add(worktreePath)

      const listResult = await listWorktrees(deps.spawn, resolvedGitCmd, repoPath)
      const worktreeCount = isRight(listResult) ? listResult.success.length : "unknown"

      return {
        title: `Worktree created: ${args.repo_short}-${args.source_branch}`,
        output:
          `Worktree created successfully.\n\n` +
          `  Path:   ${worktreePath}\n` +
          `  Branch: ${args.source_branch} (from ${targetBranch})\n` +
          `  Git:    ${resolvedGitCmd.join(" ")}\n` +
          `  Total worktrees: ${worktreeCount}\n\n` +
          `The agent can now work in ${worktreePath}. ` +
          `Permissions have been updated to allow access.\n` +
          `To merge the worktree back, use worktree_merge with the same repo_short and source_branch.`,
      }
    },
  })

const formatError = (error: WorktreeError): { title: string; output: string } => ({
  title: `Worktree error: ${error.kind}`,
  output: toErrorMessage(error),
})
