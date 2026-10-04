# opencode-worktree-plugin

![](https://github.com/afwlehmann/opencode-worktree-plugin/actions/workflows/ci.yml/badge.svg)

Git worktree management for [opencode](https://opencode.ai) — **agent-driven, safe,** and **worktree permissions handled automatically**. The agent branches off, works in the worktree, and folds the result back into your target branch — all as tool calls inside the session you are already in. No extra terminals, no juggling sessions. And nothing happens you did not ask for: no auto-commits, no force, no file syncing, no tmux.

## Installation

Requires opencode 1.18 or newer.

Install the release tarball:

```bash
opencode plugin https://github.com/afwlehmann/opencode-worktree-plugin/releases/download/v0.7.0/opencode-worktree-plugin-0.7.0.tgz
```

Use the URL of the [latest release](https://github.com/afwlehmann/opencode-worktree-plugin/releases). The command registers both entry points automatically:

- **Server** — tools, permissions, agent directive
- **TUI** — worktree label

> [!WARNING]
> Do not install by the bare name `opencode-worktree-plugin`. That package on npm is an unrelated third-party project.

Or configure both entry points manually. The server registers in `opencode.json`:

```jsonc
// opencode.json
{
  "plugin": [
    [
      "https://github.com/afwlehmann/opencode-worktree-plugin/releases/download/v0.7.0/opencode-worktree-plugin-0.7.0.tgz",
      { "preferNixDevelop": true },
    ],
  ],
}
```

The TUI label registers in `tui.json` — the same directory, a separate file:

```jsonc
// tui.json
{
  "plugin": [
    [
      "https://github.com/afwlehmann/opencode-worktree-plugin/releases/download/v0.7.0/opencode-worktree-plugin-0.7.0.tgz",
      { "labelPlacement": "both" },
    ],
  ],
}
```

Use the project's `.opencode/` directory or `~/.config/opencode/` for a global setup. For local development, use a `file://` path to the repo instead of the URL.

## Options

| Option             | Default           | Description                                                                   |
| ------------------ | ----------------- | ----------------------------------------------------------------------------- |
| `preferNixDevelop` | `false`           | Run git via `nix develop -c git` when a `flake.nix` is present                |
| `mergeStrategy`    | `"ff-only"`       | `"ff-only"`: fast-forward only. `"repo-config"`: follow the repo's `merge.ff` |
| `permissionMode`   | `"all-worktrees"` | See [Permissions](#permissions)                                               |
| `labelPlacement`   | `"prompt"`        | See [TUI Worktree Label](#tui-worktree-label)                                 |

Unrecognized values fall back to the default.

```jsonc
// opencode.json
{
  "plugin": [["<tarball-url>", { "mergeStrategy": "repo-config", "permissionMode": "pedantic" }]],
}
```

Use the release tarball URL from [Installation](#installation). Server options go in `opencode.json`; `labelPlacement` goes in `tui.json`.

## Tools

| Tool              | Purpose                                                 |
| ----------------- | ------------------------------------------------------- |
| `worktree_create` | Create a worktree on a new branch                       |
| `worktree_merge`  | Fold the worktree branch back into the target branch    |
| `worktree_remove` | Remove a worktree and delete its branch                 |
| `worktree_list`   | List worktrees with branch and clean/uncommitted status |

Worktrees live under `${XDG_STATE_HOME:-~/.local/state}/opencode/worktrees/<repo>-<branch>`.

A system-prompt directive tells agents to use these tools instead of raw git.

## Safety

- Fast-forward-only merges by default; no surprise merge commits.
- A branch is deleted only after a verified merge.
- Worktrees with uncommitted changes are never removed.
- Never uses `--force`. The plugin refuses and explains instead.

## Permissions

`external_directory` access inside worktrees is granted in two ways:

- `"all-worktrees"` (default) — one static allow for the whole worktrees directory. The agent edits worktrees without prompts. Works even under a catch-all deny.
- `"pedantic"` — no static allow. The plugin approves requests automatically, but only for paths inside active worktrees. Everything else prompts as usual. Access ends automatically once a worktree is merged or removed.

Pedantic mode notes:

- Requires opencode ≥ 1.18.
- An explicit `deny` rule always wins; pedantic mode cannot rescue it.
- Interactive sessions only. `opencode run` answers permission asks itself.

## TUI Worktree Label

The TUI shows the worktree your session is working on, e.g. `config-fix (3)`.

| Value       | Prompt chip | Sidebar section |
| ----------- | ----------- | --------------- |
| `"prompt"`  | yes         | no              |
| `"sidebar"` | no          | yes             |
| `"both"`    | yes         | yes             |
| `"none"`    | no          | no              |

- **Prompt chip** — sits next to the prompt on session and home screens. Shows the latest worktree with a `(n)` count when several are active. Click to list all entries and copy a path to the clipboard. Long names truncate; they never grow the prompt.
- **Sidebar section** — a "Git Worktrees" section below todo and files. One clickable item per worktree; click to copy its path. Collapses behind a ▼/▶ toggle when there are more than two items.

Which worktree counts as current? Checked in this order:

1. Worktrees the session opened via tool calls and has not merged or removed yet.
2. The session directory, if you started opencode inside a worktree.
3. The repository's most recently touched worktree — covers a cold start.
4. None of the above — the label is hidden. There is no `<directory>:<branch>` fallback.

A worktree merged or removed in this session never reappears through steps 2 or 3. If git is unavailable, steps 1–2 still work and the recency scan gives up silently after one warning.

## Comparison to Other Worktree Plugins

Other worktree plugins for opencode take a different approach: they spawn a new terminal and a separate opencode session per worktree, often adding file syncing, snapshot auto-commits, or tmux integration on top. That is a good fit when you want several parallel, self-contained sessions you drive yourself.

This plugin is agent-driven instead. The agent manages the whole worktree lifecycle through tool calls in the session you are already in — safety guards and automatic worktree permissions included. You stay in one session.

## Development

```bash
nix develop -c npm ci
nix develop -c npm test        # unit + integration tests
nix develop -c npm run build   # dist/index.js + dist/tui.js
```

The devshell ships opencode v1.18.31. The npm SDK dependencies in `package.json` pin the same version, so integration tests always run against it.

Integration tests need a git-ignored `.env` in the repo root:

```bash
OPENAI_MODEL=<model id>
OPENAI_URL=<openai-compatible base url>
# API key: a file on disk (no clear-text secret) or the key itself.
# A directly set OPENAI_API_KEY (env or .env) wins over the file.
OPENAI_API_KEY_FILE=/path/to/key/file
```

## License

MIT
