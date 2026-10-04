import { describe, it, expect } from "vitest"
import { formatWorktreeEntries } from "./status-label.js"

describe("formatWorktreeEntries", () => {
  it("formats a single active worktree", () => {
    expect(formatWorktreeEntries(["config-feat"])).toBe("config-feat")
  })

  it("shows the latest worktree with the total count", () => {
    expect(formatWorktreeEntries(["config-feat", "config-fix"])).toBe("config-fix (2)")
    expect(formatWorktreeEntries(["config-feat", "config-fix", "config-x"])).toBe("config-x (3)")
  })

  it("returns empty for no active worktrees", () => {
    expect(formatWorktreeEntries([])).toBe("")
  })
})
