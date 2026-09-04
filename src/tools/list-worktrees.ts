import { tool } from "@opencode-ai/plugin/tool"
import type { OpencodeClient } from "@opencode-ai/sdk"
import type { ResolvedOptions } from "../types.js"
import { getWorktreeRoot, resolveWorktreeRoot } from "../lib/paths.js"
import { isInsideWorktreeRoot } from "../lib/permissions.js"
import {
  type SpawnFn,
  type PathExistsFn,
  ensureGitAvailable,
  hasFlakeNix,
  resolveGitCommand,
  runGit,
} from "../lib/git-env.js"
import { parseWorktreeList, type WorktreeListEntry } from "../lib/worktree.js"
import { createLogger } from "../lib/logger.js"
import { toErrorMessage, type WorktreeError, isLeft } from "../types.js"

export type ListWorktreesDeps = {
  readonly spawn: SpawnFn
  readonly exists: PathExistsFn
  readonly options: ResolvedOptions
  readonly client: OpencodeClient
}

export type ListedWorktree = {
  readonly entry: WorktreeListEntry
  readonly status: "clean" | "uncommitted" | "unknown"
  readonly managed: boolean
  readonly main: boolean
}

const worktreeStatus = async (
  spawn: SpawnFn,
  gitCmd: readonly string[],
  path: string,
  bare: boolean,
): Promise<"clean" | "uncommitted" | "unknown"> => {
  if (bare) return "unknown"
  const result = await runGit(gitCmd, spawn, ["status", "--porcelain"], path)
  if (result.exitCode !== 0) return "unknown"
  return result.stdout.trim() === "" ? "clean" : "uncommitted"
}

const formatListedWorktree = (listed: ListedWorktree): string => {
  const flags = [
    listed.entry.bare === true ? "(bare)" : undefined,
    listed.entry.detached === true ? "(detached)" : undefined,
    listed.managed ? undefined : "(unmanaged)",
    listed.main ? "(main worktree)" : undefined,
  ].filter((flag): flag is string => flag !== undefined)
  const branch = listed.entry.branch ?? "(no branch)"
  return (
    `  ${listed.entry.path}\n` +
    `      Branch: ${branch}   Status: ${listed.status}` +
    (flags.length > 0 ? `   ${flags.join(" ")}` : "")
  )
}

export const listWorktreesTool = (deps: ListWorktreesDeps) =>
  tool({
    description:
      "Lists the git worktrees of this repository. Prefer this tool over running " +
      "`git worktree list` yourself: by default it shows only the plugin-managed " +
      "worktrees under ${XDG_STATE_HOME:-~/.local/state}/opencode/worktrees and " +
      "annotates each with its branch and clean/uncommitted status, so you can " +
      "decide whether to continue working, merge (worktree_merge), or discard " +
      "(worktree_remove). With all=true it lists every worktree of the " +
      "repository, marking ones outside the plugin root as unmanaged. " +
      "Read-only — it creates, modifies, and deletes nothing. Use it to " +
      "rediscover existing worktrees, e.g. after compaction or when resuming " +
      "in a fresh instance.",
    args: {
      all: tool.schema
        .boolean()
        .optional()
        .describe(
          "When true, list every worktree of the repository, including ones " +
            "outside the plugin's worktree root (marked unmanaged). " +
            "Default: only plugin-managed worktrees.",
        ),
    },
    async execute(args, context) {
      const log = createLogger(deps.client, "opencode-worktree-plugin")

      context.metadata({ title: "Listing worktrees" })

      const gitResult = await ensureGitAvailable(deps.options, deps.exists, deps.spawn)
      if (isLeft(gitResult)) {
        await log.log(
          "error",
          `worktree_list: git not available: ${toErrorMessage(gitResult.failure)}`,
        )
        return formatError(gitResult.failure)
      }

      const repoPath = context.directory
      const flakePresent = await hasFlakeNix(repoPath, deps.exists)
      const gitCmd = resolveGitCommand(deps.options, flakePresent)

      const unresolvedRoot = getWorktreeRoot()
      const resolvedRoot = await resolveWorktreeRoot(deps.exists)
      const roots =
        unresolvedRoot === resolvedRoot ? [unresolvedRoot] : [unresolvedRoot, resolvedRoot]

      const listResult = await runGit(
        gitCmd,
        deps.spawn,
        ["worktree", "list", "--porcelain"],
        repoPath,
      )
      if (listResult.exitCode !== 0) {
        const failure: WorktreeError = {
          kind: "git-error",
          command: [...gitCmd, "worktree", "list", "--porcelain"].join(" "),
          stderr: listResult.stderr.trim(),
          message: listResult.stderr.trim() || "git worktree list failed",
        }
        await log.log("warn", `worktree_list: ${toErrorMessage(failure)}`)
        return formatError(failure)
      }

      const entries = parseWorktreeList(listResult.stdout)
      const mainPath = entries[0]?.path
      const isManaged = (path: string): boolean =>
        roots.some((root) => isInsideWorktreeRoot(path, root))
      const listed: readonly ListedWorktree[] = await Promise.all(
        entries
          .filter((entry) => args.all === true || isManaged(entry.path))
          .map(
            async (entry): Promise<ListedWorktree> => ({
              entry,
              status: await worktreeStatus(deps.spawn, gitCmd, entry.path, entry.bare === true),
              managed: isManaged(entry.path),
              main: entry.path === mainPath,
            }),
          ),
      )

      await log.log(
        "info",
        `worktree_list: ${entries.length} worktrees total, ${listed.length} listed ` +
          `(all=${args.all === true})`,
      )

      if (listed.length === 0) {
        return {
          title: "No worktrees",
          output:
            `No plugin worktrees found.\n\n` +
            `Use worktree_create to create one under ${unresolvedRoot}.`,
        }
      }

      return {
        title: `Worktrees (${listed.length})`,
        output:
          `Worktrees (${listed.length}):\n\n` +
          listed.map(formatListedWorktree).join("\n") +
          `\n\nContinue work in a worktree, or fold it back with worktree_merge / discard it with worktree_remove.`,
      }
    },
  })

const formatError = (error: WorktreeError): { title: string; output: string } => ({
  title: `Worktree error: ${error.kind}`,
  output: toErrorMessage(error),
})
