import { describe, it, expect } from "vitest"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as os from "node:os"
import {
  getWorktreeRoot,
  getWorktreePath,
  isValidWorktreeName,
  resolveWorktreePath,
  resolveWorktreeRoot,
} from "./paths.js"
const exists = async (p: string): Promise<boolean> =>
  fs
    .access(p)
    .then(() => true)
    .catch(() => false)

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
  })

  describe("isValidWorktreeName", () => {
    it("accepts lowercase kebab-case names", () => {
      expect(isValidWorktreeName("ocp")).toBe(true)
      expect(isValidWorktreeName("ocp-2")).toBe(true)
      expect(isValidWorktreeName("a")).toBe(true)
      expect(isValidWorktreeName("feat-auth")).toBe(true)
    })

    it("rejects traversal attempts and unsafe characters", () => {
      expect(isValidWorktreeName("../evil")).toBe(false)
      expect(isValidWorktreeName("..")).toBe(false)
      expect(isValidWorktreeName("feature/auth")).toBe(false)
      expect(isValidWorktreeName(".hidden")).toBe(false)
      expect(isValidWorktreeName("Feat")).toBe(false)
      expect(isValidWorktreeName("-leading")).toBe(false)
      expect(isValidWorktreeName("")).toBe(false)
      expect(isValidWorktreeName("a b")).toBe(false)
    })
  })

  describe("resolveWorktreePath", () => {
    it("resolves symlinked XDG_STATE_HOME to the real path", async () => {
      const original = process.env["XDG_STATE_HOME"]
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "wt-paths-"))
      const real = path.join(tmp, "state-real")
      const link = path.join(tmp, "state-link")
      await fs.mkdir(real)
      await fs.symlink(real, link)
      process.env["XDG_STATE_HOME"] = link
      try {
        const resolved = await resolveWorktreePath(exists, "ocp", "feat")
        const realTmp = await fs.realpath(tmp)
        expect(resolved).toBe(path.join(realTmp, "state-real", "opencode", "worktrees", "ocp-feat"))
      } finally {
        if (original === undefined) delete process.env["XDG_STATE_HOME"]
        else process.env["XDG_STATE_HOME"] = original
        await fs.rm(tmp, { recursive: true, force: true })
      }
    })

    it("preserves the non-existent suffix when nothing exists yet", async () => {
      const original = process.env["XDG_STATE_HOME"]
      process.env["XDG_STATE_HOME"] = path.join(os.tmpdir(), "wt-paths-nonexistent-xyz")
      try {
        const resolved = await resolveWorktreeRoot(exists)
        expect(resolved.endsWith("wt-paths-nonexistent-xyz/opencode/worktrees")).toBe(true)
      } finally {
        if (original === undefined) delete process.env["XDG_STATE_HOME"]
        else process.env["XDG_STATE_HOME"] = original
      }
    })
  })
})
