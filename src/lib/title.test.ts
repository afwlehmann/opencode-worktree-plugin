import { describe, it, expect } from "vitest"
import { isDefaultTitle, formatStatusBar, formatWindowTitle, type StatusBarData } from "./title.js"

describe("title", () => {
  describe("isDefaultTitle", () => {
    it("returns true for default parent session title", () => {
      expect(isDefaultTitle("New session - 2026-08-08T14:23:45.123Z")).toBe(true)
    })

    it("returns true for default child session title", () => {
      expect(isDefaultTitle("Child session - 2026-08-08T14:23:45.123Z")).toBe(true)
    })

    it("returns false for real session title", () => {
      expect(isDefaultTitle("Implement worktree plugin")).toBe(false)
    })

    it("returns false for empty string", () => {
      expect(isDefaultTitle("")).toBe(false)
    })

    it("returns false for partially matching string", () => {
      expect(isDefaultTitle("New session - not-a-timestamp")).toBe(false)
    })
  })

  describe("formatStatusBar", () => {
    const baseData: StatusBarData = {
      repoShort: "ocp",
      branch: "main",
      sessionTitle: "Implement feature X",
      preferNixDevelop: false,
      hasFlake: false,
    }

    it("formats with repo, branch, and session title", () => {
      expect(formatStatusBar(baseData)).toBe("ocp-main :: Implement feature X")
    })

    it("shows Untitled for default session title", () => {
      const data: StatusBarData = {
        ...baseData,
        sessionTitle: "New session - 2026-08-08T14:23:45.123Z",
      }
      expect(formatStatusBar(data)).toBe("ocp-main :: Untitled session")
    })

    it("shows Untitled for undefined session title", () => {
      const data: StatusBarData = { ...baseData, sessionTitle: undefined }
      expect(formatStatusBar(data)).toBe("ocp-main :: Untitled session")
    })

    it("shows nix badge when preferNixDevelop and hasFlake", () => {
      const data: StatusBarData = { ...baseData, preferNixDevelop: true, hasFlake: true }
      expect(formatStatusBar(data)).toContain("[nix]")
    })

    it("hides nix badge when preferNixDevelop but no flake", () => {
      const data: StatusBarData = { ...baseData, preferNixDevelop: true, hasFlake: false }
      expect(formatStatusBar(data)).not.toContain("[nix]")
    })

    it("truncates long session titles", () => {
      const longTitle = "A".repeat(50)
      const data: StatusBarData = { ...baseData, sessionTitle: longTitle }
      const result = formatStatusBar(data)
      expect(result).toContain("...")
      expect(result.length).toBeLessThan(longTitle.length + 30)
    })
  })

  describe("formatWindowTitle", () => {
    it("formats with OC prefix", () => {
      const data: StatusBarData = {
        repoShort: "ocp",
        branch: "main",
        sessionTitle: "Implement feature X",
        preferNixDevelop: false,
        hasFlake: false,
      }
      expect(formatWindowTitle(data)).toBe(":: OC :: ocp-main :: Implement feature X")
    })
  })
})
