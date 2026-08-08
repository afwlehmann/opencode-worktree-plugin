import { describe, it, expect } from "vitest"
import { type OpencodeDirStatus, NO_OPENCODE_DIR, shouldPromptForCopy } from "./opencode-dir.js"

describe("opencode-dir", () => {
  describe("shouldPromptForCopy", () => {
    it("returns true when exists and gitignored", () => {
      const status: OpencodeDirStatus = { exists: true, gitignored: true, untracked: false }
      expect(shouldPromptForCopy(status)).toBe(true)
    })

    it("returns true when exists and untracked", () => {
      const status: OpencodeDirStatus = { exists: true, gitignored: false, untracked: true }
      expect(shouldPromptForCopy(status)).toBe(true)
    })

    it("returns false when not exists", () => {
      expect(shouldPromptForCopy(NO_OPENCODE_DIR)).toBe(false)
    })

    it("returns false when exists but tracked", () => {
      const status: OpencodeDirStatus = { exists: true, gitignored: false, untracked: false }
      expect(shouldPromptForCopy(status)).toBe(false)
    })
  })
})
