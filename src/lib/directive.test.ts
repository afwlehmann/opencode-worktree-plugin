import { describe, it, expect } from "vitest"
import { WORKTREE_DIRECTIVE } from "./directive.js"

describe("WORKTREE_DIRECTIVE", () => {
  it("is a non-empty string", () => {
    expect(typeof WORKTREE_DIRECTIVE).toBe("string")
    expect(WORKTREE_DIRECTIVE.length).toBeGreaterThan(0)
  })

  it("names all four tools", () => {
    expect(WORKTREE_DIRECTIVE).toContain("worktree_create")
    expect(WORKTREE_DIRECTIVE).toContain("worktree_merge")
    expect(WORKTREE_DIRECTIVE).toContain("worktree_remove")
    expect(WORKTREE_DIRECTIVE).toContain("worktree_list")
  })

  it("forbids raw git worktree commands", () => {
    expect(WORKTREE_DIRECTIVE).toContain("git worktree add")
    expect(WORKTREE_DIRECTIVE).toContain("git worktree remove")
    expect(WORKTREE_DIRECTIVE).toContain("git merge <branch>")
    expect(WORKTREE_DIRECTIVE).toContain("git branch -d")
  })

  it("explains the merge safety handling", () => {
    expect(WORKTREE_DIRECTIVE).toContain("merge safety")
    expect(WORKTREE_DIRECTIVE).toContain("merge.ff")
  })

  it("explains the permission handling", () => {
    expect(WORKTREE_DIRECTIVE).toContain("external_directory")
    expect(WORKTREE_DIRECTIVE).toContain("config hook")
  })

  it("mentions the .opencode/ copy", () => {
    expect(WORKTREE_DIRECTIVE).toContain(".opencode/")
  })

  it("allows raw git fallback when plugin is not loaded", () => {
    expect(WORKTREE_DIRECTIVE).toContain("plugin not loaded")
    expect(WORKTREE_DIRECTIVE).toContain("fall back")
  })

  it("uses MUST for the strict directive", () => {
    expect(WORKTREE_DIRECTIVE).toContain("MUST")
  })
})
