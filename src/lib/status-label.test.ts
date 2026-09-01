import { describe, it, expect } from "vitest"
import * as path from "node:path"
import * as os from "node:os"
import type { SessionStatus } from "@opencode-ai/sdk/v2"
import {
  formatSessionStatus,
  formatStatusLabel,
  formatWorktreeEntries,
  formatSessionStatusLabel,
} from "./status-label.js"

const home = os.homedir()

describe("formatSessionStatus", () => {
  it("hides undefined and idle sessions", () => {
    expect(formatSessionStatus(undefined)).toBe("")
    expect(formatSessionStatus({ type: "idle" })).toBe("")
  })

  it("shows busy as its type", () => {
    expect(formatSessionStatus({ type: "busy" })).toBe("busy")
  })

  it("shows retry with its attempt number", () => {
    const status: SessionStatus = { type: "retry", attempt: 2, message: "overloaded", next: 3000 }
    expect(formatSessionStatus(status)).toBe("retry 2")
  })
})

describe("formatStatusLabel", () => {
  const worktreeRoot = path.join(home, ".local", "state", "opencode", "worktrees")

  describe("inside a plugin worktree", () => {
    it("omits the branch while it matches the worktree name suffix", () => {
      const dir = path.join(worktreeRoot, "config-darwin")
      expect(formatStatusLabel(dir, "darwin", worktreeRoot)).toBe("config-darwin")
    })

    it("shows a nested relative path with a diverging branch", () => {
      const dir = path.join(worktreeRoot, "alpha", "beta-worktree")
      expect(formatStatusLabel(dir, "feat", worktreeRoot)).toBe("alpha/beta-worktree:feat")
    })

    it("reflects the live branch once it diverges from the name", () => {
      const dir = path.join(worktreeRoot, "config-darwin")
      expect(formatStatusLabel(dir, "main", worktreeRoot)).toBe("config-darwin:main")
    })

    it("does not suppress the branch on coincidental suffix matches", () => {
      const dir = path.join(worktreeRoot, "config-feat")
      expect(formatStatusLabel(dir, "eat", worktreeRoot)).toBe("config-feat:eat")
    })

    it("does not suppress the branch when the branch is unknown", () => {
      const dir = path.join(worktreeRoot, "config-darwin")
      expect(formatStatusLabel(dir, undefined, worktreeRoot)).toBe("config-darwin:unknown")
    })

    it("does not treat sibling directories of the root as worktrees", () => {
      const dir = path.join(home, ".local", "state", "opencode", "worktrees-sibling")
      expect(formatStatusLabel(dir, "main", worktreeRoot)).toBe("worktrees-sibling:main")
    })
  })

  describe("in the main repository", () => {
    it("shows the repository directory and branch", () => {
      const dir = path.join(home, "src", "git", "config")
      expect(formatStatusLabel(dir, "main", worktreeRoot)).toBe("config:main")
    })

    it("falls back to unknown as the branch", () => {
      const dir = path.join(home, "src", "git", "config")
      expect(formatStatusLabel(dir, undefined, worktreeRoot)).toBe("config:unknown")
    })
  })

  describe("edge cases", () => {
    it("treats a directory equal to the root as not a worktree", () => {
      expect(formatStatusLabel(worktreeRoot, "main", worktreeRoot)).toBe("worktrees:main")
    })
  })
})

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

describe("formatSessionStatusLabel", () => {
  const worktreeRoot = path.join(home, ".local", "state", "opencode", "worktrees")
  const repoDir = path.join(home, "src", "git", "config")

  it("prefers the active worktree entries over the directory derivation", () => {
    expect(formatSessionStatusLabel(repoDir, "main", worktreeRoot, ["config-feat"])).toBe(
      "config-feat",
    )
  })

  it("joins all active worktree entries", () => {
    expect(
      formatSessionStatusLabel(repoDir, "main", worktreeRoot, ["config-feat", "config-fix"]),
    ).toBe("config-fix (2)")
  })

  it("falls back to the directory derivation when no worktree is active", () => {
    expect(formatSessionStatusLabel(repoDir, "main", worktreeRoot, [])).toBe("config:main")
  })

  it("falls back with unknown branch when vcs has no branch", () => {
    expect(formatSessionStatusLabel(repoDir, undefined, worktreeRoot, [])).toBe("config:unknown")
  })
})
