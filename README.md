# opencode-worktree-plugin

![CI](https://github.com/afwlehmann/opencode-worktree-plugin/actions/workflows/ci.yml/badge.svg)

Git worktree management for [opencode](https://opencode.ai) — completely agent-driven, safe, and permission-aware.

The main point: the agent drives the whole worktree lifecycle itself — it decides when to branch off, works in the worktree with full file access, and folds the work back into your target branch, all as tool calls inside its own session. You never spawn terminals, open extra opencode instances, or juggle sessions; guards make destructive accidents hard.

## What it is

- **Four agent tools** — `worktree_create`, `worktree_merge`, `worktree_remove`, and `worktree_list` (rediscover existing worktrees with their branch and clean/uncommitted status, e.g. after compaction). Worktrees live under `${XDG_STATE_HOME:-~/.local/state}/opencode/worktrees/<repo>-<branch>`.
- **Safety-first git** — fast-forward-only merges by default (or the repository's own `merge.ff` config via the `mergeStrategy` option), branch deletion only after a verified merge, refusal to remove worktrees with uncommitted changes, never `--force`.
- **Permission-aware** — two `permissionMode` strategies for `external_directory` access inside the managed worktrees:
  - `"all-worktrees"` (default) — at plugin init the `config` hook adds a single static allow for the entire worktrees parent directory (`${XDG_STATE_HOME:-~/.local/state}/opencode/worktrees/**`). There are no per-worktree permission entries that come and go — every managed worktree sits under that one prefix rule, so the agent can read and edit inside worktrees without prompts, even under a catch-all deny. A `permission.ask` hook backstop allows any path inside the same roots should a prompt still occur.
  - `"pedantic"` — no static allow is added. Instead the plugin watches every `external_directory` permission request and transparently approves it — without prompting the user — only when the requested paths are inside a currently **active** plugin worktree (derived from git at ask time). Access is revoked automatically once a worktree is merged or removed. This keeps `external_directory` at `ask` (or stricter except a deny) for everything else, so unrelated directories outside the managed worktrees still prompt normally. Notes: requires opencode ≥ 1.18 (the permission-reply API the plugin uses); an explicit config `deny` rule always short-circuits before the plugin sees the request, so pedantic mode cannot rescue a catch-all deny — use `all-worktrees` for that; and transparent approval applies to interactive sessions — `opencode run` resolves permission asks itself (approves with `--auto`, auto-rejects otherwise) before the plugin can.
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
- `permissionMode` (default `"all-worktrees"`) — how `external_directory` access inside the managed worktrees is granted:
  - `"all-worktrees"` — a static `external_directory` allow for the entire worktrees parent directory (see above). Works even under a catch-all deny, but also covers stale directories under the root that are no longer active worktrees.
  - `"pedantic"` — no static allow; the plugin transparently auto-approves `external_directory` requests (no user prompts) only when every requested path lies inside a currently active plugin worktree, and approves persistently ("always") only when the suggested persistent patterns are worktree-scoped as well. Anything else — including directories that merely sit under the worktrees root but are not live worktrees — falls back to the normal prompt/ask behavior.

To opt in, pass it where the plugin is registered:

```jsonc
// opencode.json
{
  "plugin": [
    ["opencode-worktree-plugin", { "mergeStrategy": "repo-config", "permissionMode": "pedantic" }],
  ],
}
```

## Development

```bash
nix develop -c npm ci
nix develop -c npm test        # unit + integration tests
nix develop -c npm run build   # dist/index.js + dist/tui.js
```

The devshell ships a pinned, unwrapped opencode binary (currently v1.18.25), so
integration tests run against the same version the plugin targets — and any
global config a custom wrapper might inject stays out. Outside nix, `opencode`
on PATH must be the real binary, not a wrapper.

Integration tests also need a git-ignored `.env` in the repo root:

```bash
OPENAI_MODEL=<model id>
OPENAI_URL=<openai-compatible base url>
# API key: a file on disk (no clear-text secret) or the key itself.
# A directly set OPENAI_API_KEY (env or .env) wins over the file.
OPENAI_API_KEY_FILE=/path/to/key/file
```

## License

MIT
