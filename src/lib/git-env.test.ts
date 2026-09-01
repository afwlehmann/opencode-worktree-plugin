import { describe, it, expect } from "vitest"
import {
  type SpawnFn,
  type SpawnResult,
  defaultSpawn,
  hasFlakeNix,
  resolveGitCommand,
  type GitEnvOptions,
} from "./git-env.js"

const mockSpawn =
  (responses: Record<string, SpawnResult>): SpawnFn =>
  async (command, _options) => {
    const key = command.join(" ")
    return responses[key] ?? { exitCode: 1, stdout: "", stderr: "not mocked" }
  }

const mockExists =
  (paths: Set<string>) =>
  async (path: string): Promise<boolean> =>
    paths.has(path)

describe("git-env", () => {
  describe("hasFlakeNix", () => {
    it("returns true when flake.nix exists in start dir", async () => {
      const exists = mockExists(new Set(["/repo/flake.nix"]))
      expect(await hasFlakeNix("/repo", exists)).toBe(true)
    })

    it("returns true when flake.nix exists in parent dir", async () => {
      const exists = mockExists(new Set(["/repo/flake.nix"]))
      expect(await hasFlakeNix("/repo/subdir", exists)).toBe(true)
    })

    it("returns false when no flake.nix found up to root", async () => {
      const exists = mockExists(new Set())
      expect(await hasFlakeNix("/repo/subdir", exists)).toBe(false)
    })
  })

  describe("resolveGitCommand", () => {
    it("returns nix develop prefix when preferNixDevelop and flake present", () => {
      const opts: GitEnvOptions = { preferNixDevelop: true }
      expect(resolveGitCommand(opts, true)).toEqual(["nix", "develop", "-c", "git"])
    })

    it("returns bare git when preferNixDevelop but no flake", () => {
      const opts: GitEnvOptions = { preferNixDevelop: true }
      expect(resolveGitCommand(opts, false)).toEqual(["git"])
    })

    it("returns bare git when preferNixDevelop is false", () => {
      const opts: GitEnvOptions = { preferNixDevelop: false }
      expect(resolveGitCommand(opts, true)).toEqual(["git"])
    })
  })

  describe("ensureGitAvailable", () => {
    it("returns right with git command when git --version succeeds", async () => {
      const spawn = mockSpawn({
        "git --version": { exitCode: 0, stdout: "git version 2.43.0", stderr: "" },
      })
      const exists = mockExists(new Set())
      const result = await (
        await import("./git-env.js")
      ).ensureGitAvailable({ preferNixDevelop: false }, exists, spawn)
      expect(result._tag).toBe("Success")
    })

    it("returns left with git-not-found when git not on path and spawn fails", async () => {
      const spawn = mockSpawn({
        "git --version": { exitCode: 127, stdout: "", stderr: "not found" },
      })
      const exists = mockExists(new Set())
      const result = await (
        await import("./git-env.js")
      ).ensureGitAvailable({ preferNixDevelop: false }, exists, spawn)
      expect(result._tag).toBe("Failure")
    })
  })
})

describe("defaultSpawn", () => {
  it("returns a failed result instead of throwing when the process cannot start", async () => {
    const result = await defaultSpawn(["definitely-not-a-command"], { cwd: "/does/not/exist" })

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain("spawn failed")
  })
})
