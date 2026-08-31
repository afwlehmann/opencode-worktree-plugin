# AGENTS.md

## Commands

All commands should be run via `nix develop -c` to use the pinned dev environment.

| Task      | Command                            |
| --------- | ---------------------------------- |
| Install   | `nix develop -c npm ci`            |
| Build     | `nix develop -c npm run build`     |
| Test      | `nix develop -c npm test`          |
| Typecheck | `nix develop -c npm run typecheck` |
| Lint      | `nix develop -c npm run lint`      |
| Format    | `nix develop -c npm run format`    |
| Dev shell | `nix develop`                      |

## Architecture

Two entry points (SDK enforces `server?: never` / `tui?: never`):

- **Server plugin** (`src/index.ts` → `dist/index.js`): three tools (`worktree_create`, `worktree_merge`, `worktree_remove`), `permission.ask` hook, `shell.env` hook
- **TUI plugin** (`src/tui.tsx` → `dist/tui.js`): `app_bottom` status bar slot

### Key modules

- `src/lib/paths.ts` — XDG state dir resolution (`${XDG_STATE_HOME:-~/.local/state}/opencode/worktrees/<repo>-<branch>`)
- `src/lib/git-env.ts` — git command resolution (`git` vs `nix develop -c git`), PATH enforcement, flake detection
- `src/lib/worktree.ts` — pure git operations (create, FF-only merge, remove, branch delete with `-d` only)
- `src/lib/permissions.ts` — external_directory permission rule management
- `src/lib/opencode-dir.ts` — gitignored `.opencode/` detection and copy
- `src/lib/title.ts` — session title formatting
- `src/tools/` — tool definitions with Zod args
- `src/types.ts` — `Either<E, T>`, `WorktreeError` union

## Conventions

- **Functional style**: `const` only, no imperative loops, no exceptions for control flow. Fallible functions return `Either<Error, T>`.
- **Error handling**: `Either<WorktreeError, T>` from `src/types.ts`. Use `isLeft`/`isRight`/`flatMap`/`map`.
- **Git safety**: fast-forward only (`--ff-only`), branch delete with `-d` only (never `-D`), refuse uncommitted changes on remove.
- **`preferNixDevelop` option**: when `true` and `flake.nix` is present, git runs via `nix develop -c git`.
- **Tests**: co-located `*.test.ts` files, run with `nix develop -c npm test`.

## TUI typecheck note

`tsc --noEmit` excludes `src/tui.tsx` due to a `solid-js` vs `@opentui/solid` JSX namespace conflict. The TUI file is typechecked by Vite at build time.
