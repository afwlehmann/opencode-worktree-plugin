import { describe, it, expect } from "vitest"
import { worktreeDirective } from "./directive.js"

const allWorktrees = worktreeDirective("all-worktrees")
const pedantic = worktreeDirective("pedantic")

describe("worktreeDirective", () => {
  it("is a non-empty string for every mode", () => {
    for (const directive of [allWorktrees, pedantic]) {
      expect(typeof directive).toBe("string")
      expect(directive.length).toBeGreaterThan(0)
    }
  })

  it("names all four tools", () => {
    for (const directive of [allWorktrees, pedantic]) {
      expect(directive).toContain("worktree_create")
      expect(directive).toContain("worktree_merge")
      expect(directive).toContain("worktree_remove")
      expect(directive).toContain("worktree_list")
    }
  })

  it("forbids raw git worktree commands", () => {
    for (const directive of [allWorktrees, pedantic]) {
      expect(directive).toContain("git worktree add")
      expect(directive).toContain("git worktree remove")
      expect(directive).toContain("git merge <branch>")
      expect(directive).toContain("git branch -d")
    }
  })

  it("explains the merge safety handling", () => {
    for (const directive of [allWorktrees, pedantic]) {
      expect(directive).toContain("merge safety")
      expect(directive).toContain("merge.ff")
    }
  })

  it("explains the permission handling per mode", () => {
    expect(allWorktrees).toContain("external_directory")
    expect(allWorktrees).toContain("config hook")
    expect(pedantic).toContain("external_directory")
    expect(pedantic).toContain("auto-approves")
    expect(pedantic).toContain("active worktrees")
  })

  it("mentions the .opencode/ copy", () => {
    for (const directive of [allWorktrees, pedantic]) {
      expect(directive).toContain(".opencode/")
    }
  })

  it("allows raw git fallback when plugin is not loaded", () => {
    for (const directive of [allWorktrees, pedantic]) {
      expect(directive).toContain("plugin not loaded")
      expect(directive).toContain("fall back")
    }
  })

  it("uses MUST for the strict directive", () => {
    for (const directive of [allWorktrees, pedantic]) {
      expect(directive).toContain("MUST")
    }
  })
})
