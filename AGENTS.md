# AGENTS.md

## Commands

All commands should be run via `nix develop -c` to use the pinned dev environment.

| Task       | Command                            |
| ---------- | ---------------------------------- |
| Install    | `nix develop -c npm ci`            |
| Build      | `nix develop -c npm run build`     |
| Test       | `nix develop -c npm test`          |
| Unit tests | `nix develop -c npm run test:unit` |
| Typecheck  | `nix develop -c npm run typecheck` |
| Lint       | `nix develop -c npm run lint`      |
| Format     | `nix develop -c npm run format`    |
| Lockfile   | `npm install --package-lock-only`  |
| Nix build  | `nix build .#default`              |
| Dev shell  | `nix develop`                      |

## Architecture

Two entry points (SDK enforces `server?: never` / `tui?: never`):

- **Server plugin** (`src/index.ts` → `dist/index.js`): three tools (`worktree_create`, `worktree_merge`, `worktree_remove`), `config` hook (injects a static `external_directory` allow rule for the worktree root), `permission.ask` hook (future-proof), `shell.env` hook, `experimental.chat.system.transform` hook (injects the agent directive from `src/lib/directive.ts` into every session's system prompt). Dependencies (`@opencode-ai/plugin`, `effect`) are bundled into `dist/index.js` so the plugin loads without a `node_modules` tree.
- **TUI plugin** (`src/tui.tsx` → `dist/tui.js`): `app_bottom` status bar slot. Tracks the worktrees the agent works on by folding the session's `worktree_*` tool-call parts (`src/lib/active-worktree.ts`: create adds, merge/remove removes; multiple concurrent worktrees join with `+`). Two tagged call sources are folded together — a history seed (last 200 messages per session switch) and calls recorded live from `message.part.updated` events (deduped by part ID) — so the seed never wipes event-derived state when the store lags or a re-scan follows `message.part.removed`. State is read via plain functions at slot-render time — do NOT wrap TUI state reads in `createMemo`, they are not reactive and memos cache stale values.

### Key modules

- `src/lib/paths.ts` — XDG state dir resolution (`${XDG_STATE_HOME:-~/.local/state}/opencode/worktrees/<repo>-<branch>`)
- `src/lib/git-env.ts` — git command resolution (`git` vs `nix develop -c git`), PATH enforcement, flake detection
- `src/lib/worktree.ts` — pure git operations (create, FF-only merge, remove, branch delete after verified merge into target)
- `src/lib/permissions.ts` — `external_directory` permission rule management: static `config`-hook allow for the worktree root (`addWorktreeRootAllow`) and the `permission.ask` hook helper (`isActiveWorktreePath`)
- `src/lib/opencode-dir.ts` — gitignored `.opencode/` detection and copy
- `src/lib/directive.ts` — system-prompt directive injected via `experimental.chat.system.transform`
- `src/lib/logger.ts` — `createLogger` helper: wraps `client.app.log` for structured info/warn/error logging from tools
- `src/lib/active-worktree.ts` — pure extraction/fold of the session's `worktree_*` tool-call parts into the currently active worktrees; branch comes from the tool call (live `vcs.branch` belongs to the session's cwd, not the worktree)
- `src/lib/status-label.ts` — `app_bottom` label formatting: the latest active worktree name with a total count (`config-fix (3)`); the branch is only appended when the live branch diverges from the worktree name's last dash-segment (fallback `<directory>:<branch>` outside tracked worktrees). Clicking the label opens a `DialogSelect` via `api.ui.dialog.replace` listing all active worktrees with their absolute paths.
- `src/tools/` — tool definitions with Zod args (all three tools share `repo_short` + `source_branch` arg names for consistency)
- `src/types.ts` — `Either<E, T>`, `WorktreeError` union

## Conventions

- **Functional style**: `const` only, no imperative loops, no exceptions for control flow. Fallible functions return `Either<Error, T>`.
- **Error handling**: `Either<WorktreeError, T>` from `src/types.ts`. Use `isLeft`/`isRight`/`flatMap`/`map`.
- **Git safety**: fast-forward only (`--ff-only`), branch delete only after verified merge into target (`git branch -d` with `git update-ref -d` fallback for non-checked-out targets), refuse uncommitted changes on remove, `worktree_merge` never checks out another branch in the main working copy.
- **Name validation**: `repo_short` and `source_branch` must match `^[a-z0-9][a-z0-9-]*$` (prevents path traversal and repo/branch name collisions). Worktree paths are symlink-resolved to match git's porcelain output.
- **Tool descriptions**: agents MUST use the plugin tools instead of raw git worktree commands. Descriptions explicitly say "You MUST use this tool" and "Do NOT run `git worktree add/remove`/`git merge`/`git branch -d` manually".
- **Logging**: tools log all interesting operations at info level via `createLogger` (`src/lib/logger.ts`), warnings for recoverable failures, errors for git-unavailable. Operations are infrequent so info-level logging won't spam.
- **Permission lifecycle**: `config` hook statically allows `${worktreeRoot}/**` at init. `worktree_create` adds the worktree path to `activeWorktrees`. `worktree_merge`/`worktree_remove` remove it from `activeWorktrees` after worktree removal but before branch deletion.
- **`preferNixDevelop` option**: when `true` and `flake.nix` is present, git runs via `nix develop -c git`.
- **npmDepsHash**: must match `package-lock.json`. Whenever the lockfile changes (dependency updates, version bumps — run `npm install --package-lock-only` to sync the version), recompute it: run `nix build .#default`, copy the `got:` sha256 from the hash-mismatch error into `flake.nix`, rebuild to confirm. CI builds the nix package, so a stale hash fails CI. The package `version` is read from `package.json` via `lib.importJSON` — never hardcode it in `flake.nix`.
- **Tests**: co-located `*.test.ts` files, run with `nix develop -c npm test`.

## TUI typecheck note

`tsc --noEmit` excludes `src/tui.tsx` due to a `solid-js` vs `@opentui/solid` JSX namespace conflict. The TUI file is typechecked by Vite at build time.
