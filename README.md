# opencode-worktree-plugin

![CI](https://github.com/afwlehmann/opencode-worktree-plugin/actions/workflows/ci.yml/badge.svg)

Git worktree management for [opencode](https://opencode.ai) — completely agent-driven, safe, and permission-aware.

The main point: the agent drives the whole worktree lifecycle itself — it decides when to branch off, works in the worktree with full file access, and folds the work back into your target branch, all as tool calls inside its own session. You never spawn terminals, open extra opencode instances, or juggle sessions; guards make destructive accidents hard.

## What it is

- **Four agent tools** — `worktree_create`, `worktree_merge`, `worktree_remove`, and `worktree_list` (rediscover existing worktrees with their branch and clean/uncommitted status, e.g. after compaction). Worktrees live under `${XDG_STATE_HOME:-~/.local/state}/opencode/worktrees/<repo>-<branch>`.
- **Safety-first git** — fast-forward-only merges by default (or the repository's own `merge.ff` config via the `mergeStrategy` option), branch deletion only after a verified merge, refusal to remove worktrees with uncommitted changes, never `--force`.
- **Permission-aware** — the worktree root is statically allowed for `external_directory`, so the agent can read and edit inside worktrees without prompts, even under a catch-all deny.
- **Single-session** — the agent keeps working in _your_ session; worktrees are just directories it edits. A TUI status bar tracks the active worktrees (e.g. `config-fix (3)`); clicking it lists their absolute paths with clipboard copy.
- **Agent directive** — a system-prompt hook tells agents to prefer these tools over raw git and explains what raw git skips.

## What it is not

- **No terminal spawning** — it does not open new terminals or start separate opencode sessions per worktree; the agent does all of it in the session you are already in.
- **No auto-commit, no force** — it never commits, merges, or deletes anything you did not ask for; it refuses and explains instead of force-cleaning.
- **No lifecycle hooks or file syncing** — beyond an optional `.opencode/` copy prompt, it does not sync `node_modules`, run hooks, or manage dependencies.
- **No multiplexer integration** — no tmux/cmux workflows.

## Compared to [opencode-worktree](https://github.com/kdcokenny/opencode-worktree)

Both wrap `git worktree` for agents, but differ in who does the driving:

| Aspect   | opencode-worktree                    | this plugin                              |
| -------- | ------------------------------------ | ---------------------------------------- |
| Driver   | New terminal + session per worktree  | Agent tool calls, same session           |
| Delete   | Snapshot auto-commit, then `--force` | Refuses uncommitted, never force         |
| Merge    | Manual                               | `worktree_merge` (configurable strategy) |
| Extras   | File sync, hooks, tmux/cmux          | Permissions, TUI bar, nix git            |
| Location | `~/.local/share/opencode/worktree/…` | `${XDG_STATE_HOME}/opencode/worktrees/…` |

Use theirs if you want each worktree to be a self-contained terminal session that cleans up after itself. Use this one if you want the agent to manage the whole worktree lifecycle on its own — several concurrent worktrees, merged and cleaned up when it decides the work is done — with you staying in one session.

## Installation

```jsonc
// opencode.json
{
  "plugin": [["opencode-worktree-plugin", { "preferNixDevelop": true }]],
}
```

The plugin ships as two entry points — `opencode-worktree-plugin` (server) and `opencode-worktree-plugin/tui` (TUI status bar). Register both in your opencode config.

## Options

- `preferNixDevelop` (default `false`) — run git via `nix develop -c git` when a `flake.nix` is present.
- `mergeStrategy` (default `"ff-only"`) — how `worktree_merge` folds a worktree branch back:
  - `"ff-only"` — fast-forward only, no merge commits; if the branches have diverged, rebase the worktree branch onto the target first.
  - `"repo-config"` — follow the respective git repository's `merge.ff` configuration: unset/`true` fast-forwards when possible and creates a merge commit otherwise, `false` always creates a merge commit, `only` requires a fast-forward. Merge commits for a target branch that is not checked out are built ref-only via git plumbing (`merge-tree`/`commit-tree`/`update-ref`), so no working copy is touched; conflicted working-copy merges are rolled back with `git merge --abort`.

To opt in, pass it where the plugin is registered:

```jsonc
// opencode.json
{
  "plugin": [["opencode-worktree-plugin", { "mergeStrategy": "repo-config" }]],
}
```

## Development

```bash
nix develop -c npm ci
nix develop -c npm test        # unit + integration tests
nix develop -c npm run build   # dist/index.js + dist/tui.js
```

## License

MIT
