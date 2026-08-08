import { describe, it, expect } from "vitest"
import { getWorktreeRoot, getWorktreePath } from "./paths.js"

describe("paths", () => {
  describe("getWorktreeRoot", () => {
    it("uses XDG_STATE_HOME when set", () => {
      const original = process.env["XDG_STATE_HOME"]
      process.env["XDG_STATE_HOME"] = "/custom/state"
      try {
        const result = getWorktreeRoot()
        expect(result).toBe("/custom/state/opencode/worktrees")
      } finally {
        if (original === undefined) delete process.env["XDG_STATE_HOME"]
        else process.env["XDG_STATE_HOME"] = original
      }
    })

    it("falls back to ~/.local/state when XDG_STATE_HOME unset", () => {
      const original = process.env["XDG_STATE_HOME"]
      delete process.env["XDG_STATE_HOME"]
      try {
        const result = getWorktreeRoot()
        expect(result).toContain(".local/state/opencode/worktrees")
      } finally {
        if (original !== undefined) process.env["XDG_STATE_HOME"] = original
      }
    })
  })

  describe("getWorktreePath", () => {
    it("combines repo short and branch", () => {
      const original = process.env["XDG_STATE_HOME"]
      process.env["XDG_STATE_HOME"] = "/custom/state"
      try {
        const result = getWorktreePath("ocp", "feature-x")
        expect(result).toBe("/custom/state/opencode/worktrees/ocp-feature-x")
      } finally {
        if (original === undefined) delete process.env["XDG_STATE_HOME"]
        else process.env["XDG_STATE_HOME"] = original
      }
    })

    it("handles branch names with slashes", () => {
      const original = process.env["XDG_STATE_HOME"]
      process.env["XDG_STATE_HOME"] = "/custom/state"
      try {
        const result = getWorktreePath("ocp", "feature/x")
        expect(result).toBe("/custom/state/opencode/worktrees/ocp-feature/x")
      } finally {
        if (original === undefined) delete process.env["XDG_STATE_HOME"]
        else process.env["XDG_STATE_HOME"] = original
      }
    })
  })
})
