import { tool } from "@opencode-ai/plugin/tool"
import type { OpencodeClient } from "@opencode-ai/sdk"
import type { ResolvedOptions } from "../types.js"
import { getWorktreePath, ensureWorktreeRoot } from "../lib/paths.js"
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
import { createLogger } from "../lib/logger.js"
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
  readonly client: OpencodeClient
}

export const createWorktreeTool = (deps: CreateWorktreeDeps) =>
  tool({
    description:
      "You MUST use this tool instead of raw `git worktree add`. Creates a git " +
      "worktree under ${XDG_STATE_HOME}/opencode/worktrees/<repo_short>-<source_branch>, " +
      "branching off from the target branch (default: main). Do NOT run " +
      "`git worktree add` manually — this tool handles side effects that raw git " +
      "silently skips: (0) external_directory permission — the plugin's config " +
      "hook statically allows access to the entire worktree root, so you can " +
      "read and edit files in the worktree without permission prompts or denials. " +
      "With raw git, external_directory rules would block you from working in " +
      "the new worktree path. (1) .opencode/ copy — detects a gitignored/" +
      "untracked .opencode/ directory in the source repo and prompts the user " +
      "to copy it into the worktree. (2) worktree path tracking for cleanup on " +
      "merge/remove. Workflow: call worktree_create first, then work in the " +
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
      const worktreePath = getWorktreePath(args.repo_short, args.source_branch)
      const log = createLogger(deps.client, "opencode-worktree-plugin")

      context.metadata({ title: `Creating worktree ${args.repo_short}-${args.source_branch}` })
      await log.log(
        "info",
        `worktree_create: repo_short=${args.repo_short} source_branch=${args.source_branch} target_branch=${targetBranch} worktree_path=${worktreePath}`,
      )

      await ensureWorktreeRoot(deps.mkdir)

      const gitResult = await ensureGitAvailable(deps.options, deps.exists, deps.spawn)
      if (isLeft(gitResult)) {
        await log.log(
          "error",
          `worktree_create: git not available: ${toErrorMessage(gitResult.failure)}`,
        )
        return formatError(gitResult.failure)
      }

      const repoPath = context.directory

      const flakePresent = await hasFlakeNix(repoPath, deps.exists)
      const resolvedGitCmd: GitCommand = resolveGitCommand(deps.options, flakePresent)
      await log.log("info", `worktree_create: git command resolved: ${resolvedGitCmd.join(" ")}`)

      const createResult = await createWt(deps.spawn, {
        repoPath,
        worktreePath,
        sourceBranch: args.source_branch,
        targetBranch,
        gitCmd: resolvedGitCmd,
      })

      if (isLeft(createResult)) {
        await log.log(
          "warn",
          `worktree_create: git worktree add failed: ${toErrorMessage(createResult.failure)}`,
        )
        return formatError(createResult.failure)
      }

      await log.log(
        "info",
        `worktree_create: worktree created at ${worktreePath} on branch ${args.source_branch}`,
      )

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
            await log.log(
              "warn",
              `worktree_create: .opencode/ copy failed: ${toErrorMessage(copyResult.failure)}`,
            )
            return formatError(copyResult.failure)
          }
          await log.log("info", `worktree_create: .opencode/ directory copied to ${worktreePath}`)
        } catch {
          await log.log("info", `worktree_create: .opencode/ copy declined by user`)
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
      await log.log(
        "info",
        `worktree_create: worktree ${worktreePath} tracked (active worktrees: ${deps.activeWorktrees.size})`,
      )

      const listResult = await listWorktrees(deps.spawn, resolvedGitCmd, repoPath)
      const worktreeCount = isRight(listResult) ? listResult.success.length : "unknown"

      await log.log(
        "info",
        `worktree_create: completed successfully, total worktrees: ${worktreeCount}`,
      )

      return {
        title: `Worktree created: ${args.repo_short}-${args.source_branch}`,
        output:
          `Worktree created successfully.\n\n` +
          `  Path:   ${worktreePath}\n` +
          `  Branch: ${args.source_branch} (from ${targetBranch})\n` +
          `  Git:    ${resolvedGitCmd.join(" ")}\n` +
          `  Total worktrees: ${worktreeCount}\n\n` +
          `The agent can now work in ${worktreePath}. ` +
          `External_directory access is allowed via the plugin's config hook.\n` +
          `To merge the worktree back, use worktree_merge with the same repo_short and source_branch.`,
      }
    },
  })

const formatError = (error: WorktreeError): { title: string; output: string } => ({
  title: `Worktree error: ${error.kind}`,
  output: toErrorMessage(error),
})
