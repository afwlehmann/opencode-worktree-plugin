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
  "- external_directory permissions — the plugin's config hook statically allows",
  "  access to the entire worktree root, so you can read and edit files inside any",
  "  worktree without prompts or denials. Raw git skips this entirely, leaving you",
  "  unable to read or edit files inside the worktree.",
  "- `.opencode/` copy — the plugin detects a gitignored/untracked `.opencode/`",
  "  directory in the source repo and prompts the user to copy it into the",
  "  worktree.",
  "- branch-delete safety — `worktree_merge` verifies the source branch is fully",
  "  merged into the target before deleting it (`git branch -d`, falling back to",
  "  `git update-ref -d` when `-d` refuses for a target that is not checked out);",
  "  unmerged branches are never deleted.",
  "- uncommitted-changes guard — `worktree_remove` refuses if the worktree has",
  "  uncommitted changes.",
  "- permission tracking cleanup — `worktree_merge` and `worktree_remove` clean",
  "  up the worktree's external_directory permission tracking after removal.",
  "",
  "If the tools are absent from your toolset (plugin not loaded), fall back to",
  "raw git and handle the above manually — including requesting",
  "`external_directory` permission for the worktree path yourself.",
].join("\n")
