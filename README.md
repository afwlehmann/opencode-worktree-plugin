# opencode-worktree-plugin

![CI](https://github.com/afwlehmann/opencode-worktree-plugin/actions/workflows/ci.yml/badge.svg)

Git worktree management plugin for [opencode](https://opencode.ai).

## Features

- **worktree_create** — creates a worktree under `${XDG_STATE_HOME:-~/.local/state}/opencode/worktrees/<repo>-<branch>`, branches off from a target branch (default: `main`), optionally copies a gitignored `.opencode/` directory
- **worktree_merge** — fast-forward merges the worktree branch back into the target branch, removes the worktree, and deletes the source branch (`git branch -d` only — never force-delete)
- **worktree_remove** — removes a worktree without merging; refuses if uncommitted changes exist
- **TUI status bar** — shows `<repo>-<branch> :: <session-title>` in the `app_bottom` slot, with a `nix` badge when `preferNixDevelop` is active
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
npm test             # run tests (50 tests)
npm run build        # build dist/index.js + dist/tui.js
```

## License

MIT
