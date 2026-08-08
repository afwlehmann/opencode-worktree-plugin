import { describe, it, expect } from "vitest"
import {
  type ExternalDirectoryRules,
  createWorktreePermissionPattern,
  isActiveWorktreePath,
  addWorktreePermission,
  removeWorktreePermission,
} from "./permissions.js"

describe("permissions", () => {
  describe("createWorktreePermissionPattern", () => {
    it("appends glob pattern to path", () => {
      expect(createWorktreePermissionPattern("/foo/bar")).toBe("/foo/bar/**")
    })
  })

  describe("isActiveWorktreePath", () => {
    it("returns true when pattern matches active worktree", () => {
      const active = new Set(["/state/ocp-feature"])
      expect(isActiveWorktreePath("/state/ocp-feature/**", active)).toBe(true)
    })

    it("returns false when pattern does not match any active worktree", () => {
      const active = new Set(["/state/ocp-feature"])
      expect(isActiveWorktreePath("/state/other-branch/**", active)).toBe(false)
    })

    it("returns false for empty active set", () => {
      const active = new Set<string>()
      expect(isActiveWorktreePath("/state/ocp-feature/**", active)).toBe(false)
    })

    it("handles pattern without glob suffix", () => {
      const active = new Set(["/state/ocp-feature"])
      expect(isActiveWorktreePath("/state/ocp-feature", active)).toBe(true)
    })
  })

  describe("addWorktreePermission", () => {
    it("adds allow rule for worktree path with deny catch-all", () => {
      const current: ExternalDirectoryRules = { "*": "deny" }
      const result = addWorktreePermission(current, "/state/ocp-feature")
      expect(result["/state/ocp-feature/**"]).toBe("allow")
      expect(result["*"]).toBe("deny")
    })

    it("works with undefined current rules", () => {
      const result = addWorktreePermission(undefined, "/state/ocp-feature")
      expect(result["/state/ocp-feature/**"]).toBe("allow")
      expect(result["*"]).toBe("deny")
    })

    it("preserves existing rules", () => {
      const current: ExternalDirectoryRules = {
        "*": "deny",
        "/other/path/**": "allow",
      }
      const result = addWorktreePermission(current, "/state/ocp-feature")
      expect(result["/other/path/**"]).toBe("allow")
      expect(result["/state/ocp-feature/**"]).toBe("allow")
    })
  })

  describe("removeWorktreePermission", () => {
    it("removes the worktree pattern", () => {
      const current: ExternalDirectoryRules = {
        "*": "deny",
        "/state/ocp-feature/**": "allow",
      }
      const result = removeWorktreePermission(current, "/state/ocp-feature")
      expect(result["/state/ocp-feature/**"]).toBeUndefined()
      expect(result["*"]).toBe("deny")
    })

    it("works with undefined current rules", () => {
      const result = removeWorktreePermission(undefined, "/state/ocp-feature")
      expect(Object.keys(result)).toEqual([])
    })
  })
})
