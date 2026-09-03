# AGENTS.md

## Commands

All commands should be run via `nix develop -c` to use the pinned dev environment.

| Task       | Command                                          |
| ---------- | ------------------------------------------------ |
| Install    | `nix develop -c npm ci`                          |
| Build      | `nix develop -c npm run build`                   |
| Test       | `nix develop -c npm test`                        |
| Unit tests | `nix develop -c npm run test:unit`               |
| Typecheck  | `nix develop -c npm run typecheck`               |
| Lint       | `nix develop -c npm run lint`                    |
| Format     | `nix develop -c npm run format`                  |
| Lockfile   | `nix develop -c npm install --package-lock-only` |
| Nix build  | `nix build .#default`                            |
| Dev shell  | `nix develop`                                    |

## Architecture

Two entry points (SDK enforces `server?: never` / `tui?: never`):

- **Server plugin** (`src/index.ts` → `dist/index.js`): four tools (`worktree_create`, `worktree_merge`, `worktree_remove`, `worktree_list`), `config` hook (injects a static `external_directory` allow rule for the worktree root), `permission.ask` backstop (root-prefix allow via `isInsideWorktreeRoot`), `shell.env` hook, `experimental.chat.system.transform` hook (injects the agent directive from `src/lib/directive.ts` into every session's system prompt). Dependencies (`@opencode-ai/plugin`, `effect`) are bundled into `dist/index.js` so the plugin loads without a `node_modules` tree.
- **TUI plugin** (`src/tui.tsx` → `dist/tui.js`): `app_bottom` status bar slot. Tracks the worktrees the agent works on by folding the session's `worktree_*` tool-call parts (`src/lib/active-worktree.ts`: create adds, merge/remove removes; multiple concurrent worktrees join with `+`). Two tagged call sources are folded together — a history seed (last 200 messages, refreshed when the session switches or its message count changes, because the TUI's sync store hydrates a session's history asynchronously after the route has already rendered) and calls recorded live from `message.part.updated` events (deduped by part ID) — so the seed never wipes event-derived state when the store lags or a re-scan follows `message.part.removed`. State is read via plain functions at slot-render time — do NOT wrap TUI state reads in `createMemo`, they are not reactive and memos cache stale values.

### Key modules

- `src/lib/paths.ts` — XDG state dir resolution (`${XDG_STATE_HOME:-~/.local/state}/opencode/worktrees/<repo>-<branch>`)
- `src/lib/git-env.ts` — git command resolution (`git` vs `nix develop -c git`), PATH enforcement, flake detection
- `src/lib/worktree.ts` — pure git operations (create, strategy-aware merge, remove, default-branch resolution, branch delete after verified merge into target; the `update-ref -d` fallback is guarded by a checked-out-in-any-worktree check and never force-deletes a checked-out branch)
- `src/lib/permissions.ts` — `external_directory` permission management: static `config`-hook allow for the worktree root (`addWorktreeRootAllow`) and the boundary-safe root check the `permission.ask` backstop uses (`isInsideWorktreeRoot`)
- `src/lib/opencode-dir.ts` — gitignored `.opencode/` detection and copy
- `src/lib/directive.ts` — system-prompt directive injected via `experimental.chat.system.transform`
- `src/lib/logger.ts` — `createLogger` helper: wraps `client.app.log` for structured info/warn/error logging from tools
- `src/lib/active-worktree.ts` — pure extraction/fold of the session's `worktree_*` tool-call parts into the currently active worktree names; branch display is derived in `status-label.ts` from the worktree name's last dash-segment or the session's live `vcs` state (which belongs to the session's cwd, not the worktree)
- `src/lib/status-label.ts` — `app_bottom` label formatting: the latest active worktree name with a total count (`config-fix (3)`); the branch is only appended when the live branch diverges from the worktree name's last dash-segment (fallback `<directory>:<branch>` outside tracked worktrees). Clicking the label opens a `DialogSelect` via `api.ui.dialog.replace` listing all active worktrees with their absolute paths; selecting an option copies the path to the clipboard (`src/lib/clipboard.ts`: `pbcopy` on darwin, `wl-copy`/`xclip`/`xsel` on linux) and confirms via a success toast (warning toast on failure).
- `src/lib/clipboard.ts` — clipboard copy via platform stdin commands, returning `Either<WorktreeError, void>` with `clipboard-unavailable` after all candidates fail.
- `src/tools/` — tool definitions with Zod args (create/merge/remove share `repo_short` + `source_branch` arg names for consistency; list takes only `all?`)
- `src/types.ts` — `Either<E, T>`, `WorktreeError` union

## Conventions

- **Functional style**: `const` only, no imperative loops, no exceptions for control flow. Fallible functions return `Either<Error, T>`. The only sanctioned `try/catch` is at the impure boundary (`defaultSpawn`, `bunStdinSpawn`, injected spawns in `clipboard`'s `tryCommands`, and the logger): thrown errors from the outside world are converted into values there, never allowed to escape into pure code.
- **Error handling**: `Either<WorktreeError, T>` from `src/types.ts`. Use `isLeft`/`isRight`/`flatMap`/`map`.
- **Spawn boundary**: all default spawns return `{ exitCode: 127, stderr: "spawn failed: ..." }` instead of throwing when a process cannot start (missing cwd/binary). Pure functions take `spawn`/`exists`/`realpath` as injected parameters and never touch `process` or the filesystem directly.
- **Git safety**: merges follow the configured `mergeStrategy` — `ff-only` (default) enforces `--ff-only` with no merge commits; `repo-config` follows the repository's `merge.ff` (default flags, `--no-ff` for `false`, `--ff-only` for `only`), building off-target merge commits ref-only via `merge-tree --write-tree` + `commit-tree` + `update-ref` (guarded by a checked-out-in-any-worktree check for the target branch, race-safe via the update-ref old-value check); conflicted working-copy merges are rolled back with `git merge --abort`. `worktree_merge` refuses with `target-dirty` when the main working copy has uncommitted changes the merge would overwrite (multi-instance safety — the changes may belong to another session and must never be discarded). Branch delete only after verified merge into target (`git branch -d` with `git update-ref -d` fallback that is refused when the branch is checked out in any worktree or the worktree list cannot be read), refuse uncommitted changes on remove, `worktree_merge` never checks out another branch in the main working copy, and tool guidance never suggests destructive manual git (`--force`).
- **Name validation**: `repo_short` and `source_branch` must match `^[a-z0-9][a-z0-9-]*$` (prevents path traversal and repo/branch name collisions). Worktree paths are symlink-resolved to match git's porcelain output.
- **Tool descriptions**: agents MUST use the plugin tools instead of raw git worktree commands. Descriptions explicitly say "You MUST use this tool" and "Do NOT run `git worktree add/remove`/`git merge`/`git branch -d` manually".
- **Logging**: tools log all interesting operations at info level via `createLogger` (`src/lib/logger.ts`), warnings for recoverable failures, errors for git-unavailable. Operations are infrequent so info-level logging won't spam.
- **Permission model**: the `config` hook statically allows `${worktreeRoot}/**` (unresolved + realpath roots) at init; the `permission.ask` hook allows any path inside the same roots via `isInsideWorktreeRoot`. No process-local tracking — several opencode instances sharing a project stay consistent because permissions derive from the durable static allow and all worktree/branch state from git itself. The only in-memory state in the plugin is the TUI plugin's render closures.
- **`preferNixDevelop` option**: when `true` and `flake.nix` is present, git runs via `nix develop -c git`.
- **`mergeStrategy` option**: `"ff-only"` (default) keeps the opinionated fast-forward-only behavior; `"repo-config"` makes `worktree_merge` follow the repository's `merge.ff` configuration. Unrecognized values fall back to `ff-only` in `resolveOptions`.
- **npmDepsHash**: must match `package-lock.json`. Whenever the lockfile changes (dependency updates, version bumps — run `nix develop -c npm install --package-lock-only` to sync the version; an unpinned system npm also strips `"dev": true` markers from optional platform packages and pollutes the diff), recompute it: run `nix build .#default`, copy the `got:` sha256 from the hash-mismatch error into `flake.nix`, rebuild to confirm. CI builds the nix package, so a stale hash fails CI. The package `version` is read from `package.json` via `lib.importJSON` — never hardcode it in `flake.nix`.
- **Releases**: version bumps are committed as `chore(release): vX.Y.Z` and always tagged with an annotated tag `vX.Y.Z` (`git tag -a vX.Y.Z -m "vX.Y.Z"`) on the release commit — never a lightweight tag.
- **Tests**: co-located `*.test.ts` files, run with `nix develop -c npm test`.

## TUI typecheck note

`tsc --noEmit` excludes `src/tui.tsx` due to a `solid-js` vs `@opentui/solid` JSX namespace conflict. The TUI file is typechecked by Vite at build time. Because the dts build cannot emit declarations for it, the package's `./tui` export resolves its `types` field to the hand-written `types/tui.d.ts`.
