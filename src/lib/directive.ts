/**
 * System-prompt directive appended to every session via the
 * `experimental.chat.system.transform` hook.
 *
 * Agents MUST prefer the plugin's worktree tools over raw git when the plugin
 * is loaded. The directive explicitly lists the side effects raw git skips
 * (external_directory permissions, `.opencode/` copy, branch-delete safety,
 * uncommitted-changes guard) so the agent understands *why* the tools are
 * mandatory, not just that they are.
 */
export const WORKTREE_DIRECTIVE = [
  "opencode-worktree-plugin is loaded in this session. For any git worktree",
  "operation — creating, merging back, or removing — you MUST use the",
  "`worktree_create` / `worktree_merge` / `worktree_remove` tools. Do NOT run",
  "`git worktree add`, `git worktree remove`, `git merge --ff-only <branch>`",
  "(for folding a worktree branch back), or `git branch -d <branch>` (for a",
  "worktree branch) directly.",
  "",
  "The plugin tools handle things raw git silently skips:",
  "- external_directory permissions — the plugin auto-allows access to the",
  "  worktree path via the `permission.ask` hook on create, and revokes it on",
  "  merge/remove. With raw git you would hit permission prompts (or denials)",
  "  when trying to work in the new worktree path.",
  "- `.opencode/` copy — the plugin detects a gitignored/untracked `.opencode/`",
  "  directory in the source repo and prompts the user to copy it into the",
  "  worktree.",
  "- branch-delete safety — `worktree_merge` uses `git branch -d` only (never",
  "  `-D`), refusing unmerged branches.",
  "- uncommitted-changes guard — `worktree_remove` refuses if the worktree has",
  "  uncommitted changes.",
  "",
  "If the tools are absent from your toolset (plugin not loaded), fall back to",
  "raw git and handle the above manually — including requesting",
  "`external_directory` permission for the worktree path yourself.",
].join("\n")
