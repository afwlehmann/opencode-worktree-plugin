import { describe, it, expect } from "vitest"
import * as path from "node:path"
import * as os from "node:os"
import { currentWorktreeEntries } from "./current-worktree.js"

const worktreeRoot = path.join(os.homedir(), ".local", "state", "opencode", "worktrees")
const repoDir = path.join(os.homedir(), "src", "git", "config")

const input = (overrides: Partial<Parameters<typeof currentWorktreeEntries>[0]> = {}) => ({
  active: [],
  closedNames: [],
  sessionDirectory: undefined,
  worktreeRoot,
  recencyName: undefined,
  ...overrides,
})

describe("currentWorktreeEntries", () => {
  it("returns the active entries when the session has worktree calls", () => {
    expect(currentWorktreeEntries(input({ active: ["integ-feat", "integ-fix"] }))).toEqual([
      "integ-feat",
      "integ-fix",
    ])
  })

  it("prefers the active entries over session directory and recency", () => {
    expect(
      currentWorktreeEntries(
        input({
          active: ["integ-feat"],
          sessionDirectory: path.join(worktreeRoot, "integ-other"),
          recencyName: "integ-stale",
        }),
      ),
    ).toEqual(["integ-feat"])
  })

  it("derives a single name when the session directory is inside the worktree root", () => {
    expect(
      currentWorktreeEntries(
        input({ sessionDirectory: path.join(worktreeRoot, "integ-feat", "src") }),
      ),
    ).toEqual(["integ-feat"])
  })

  it("excludes a session-derived name that was merged or removed in this session", () => {
    expect(
      currentWorktreeEntries(
        input({
          sessionDirectory: path.join(worktreeRoot, "integ-feat"),
          closedNames: ["integ-feat"],
        }),
      ),
    ).toEqual([])
  })

  it("falls back to the recency pick when the session directory is outside the root", () => {
    expect(
      currentWorktreeEntries(input({ sessionDirectory: repoDir, recencyName: "integ-feat" })),
    ).toEqual(["integ-feat"])
  })

  it("excludes the recency pick when that worktree was merged or removed", () => {
    expect(
      currentWorktreeEntries(input({ recencyName: "integ-feat", closedNames: ["integ-feat"] })),
    ).toEqual([])
  })

  it("prefers the session directory over the recency pick", () => {
    expect(
      currentWorktreeEntries(
        input({
          sessionDirectory: path.join(worktreeRoot, "integ-here"),
          recencyName: "integ-there",
        }),
      ),
    ).toEqual(["integ-here"])
  })

  it("returns empty when nothing qualifies", () => {
    expect(currentWorktreeEntries(input({ sessionDirectory: repoDir }))).toEqual([])
  })

  it("treats the worktree root itself as not a worktree", () => {
    expect(currentWorktreeEntries(input({ sessionDirectory: worktreeRoot }))).toEqual([])
  })

  it("rejects an invalid first segment as a worktree name", () => {
    expect(
      currentWorktreeEntries(
        input({ sessionDirectory: path.join(worktreeRoot, ".hidden", "nested") }),
      ),
    ).toEqual([])
  })

  it("does not treat a sibling of the worktree root as a worktree", () => {
    expect(
      currentWorktreeEntries(
        input({ sessionDirectory: path.join(worktreeRoot + "-sibling", "integ-feat") }),
      ),
    ).toEqual([])
  })
})
