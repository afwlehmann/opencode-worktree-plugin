# opencode-worktree-plugin

![CI](https://github.com/afwlehmann/opencode-worktree-plugin/actions/workflows/ci.yml/badge.svg)

Git worktree management plugin for [opencode](https://opencode.ai).

## Features

- **worktree_create** — creates a worktree under `${XDG_STATE_HOME:-~/.local/state}/opencode/worktrees/<repo>-<source_branch>`, creates a new branch from the target branch (default: `main`), optionally copies a gitignored `.opencode/` directory. External_directory access is allowed via the plugin's `config` hook (static allow rule for the entire worktree root).
- **worktree_merge** — fast-forward merges the worktree branch back into the target branch — without checking out the target in the main working copy when it isn't already checked out — removes the worktree, cleans up permission tracking, and deletes the source branch only after verifying it is fully merged into the target.
- **worktree_remove** — removes a worktree without merging; refuses if uncommitted changes exist. Cleans up permission tracking. The branch is NOT deleted — use `worktree_merge` for the full merge + branch delete + cleanup flow.
- **System-prompt directive** — injects a strict MUST directive into every session via the `experimental.chat.system.transform` hook, instructing agents to use the plugin's tools instead of raw `git worktree …` commands and explaining the side effects raw git skips (permissions, `.opencode/` copy, branch-delete safety, uncommitted-changes guard, permission cleanup).
- **`external_directory` permission adaptation** — the `config` hook adds a static allow rule for the worktree root (`${XDG_STATE_HOME}/opencode/worktrees/**`) so agents can immediately read and edit files in any worktree without prompts or denials, even when the user's config has a catch-all `/**` deny.
- **Structured logging** — all tools log interesting operations at info level via `client.app.log` (warnings for recoverable failures, errors for git-unavailable).
- **TUI status bar** — shows `<repo>-<source_branch> :: <session-title>` in the `app_bottom` slot, with a `nix` badge when `preferNixDevelop` is active
- **`preferNixDevelop` option** — when `true` and a `flake.nix` is present, all git commands run via `nix develop -c git`

## Installation

```jsonc
// opencode.json
{
  "plugin": [["opencode-worktree-plugin", { "preferNixDevelop": true }]],
}
```

The plugin ships as two entry points — `opencode-worktree-plugin` (server) and `opencode-worktree-plugin/tui` (TUI). Register both in your opencode config.

## Development

```bash
nix develop          # enter dev shell (Node.js 22, git, nixfmt, hooks)
npm ci               # install dependencies
npm test             # run tests (60 tests)
npm run build        # build dist/index.js + dist/tui.js
```

## License

MIT
