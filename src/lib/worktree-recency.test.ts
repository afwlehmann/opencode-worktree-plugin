import { describe, it, expect } from "vitest"
import * as path from "node:path"
import type { SpawnFn } from "./git-env.js"
import type { StatFn } from "./worktree-recency.js"
import { latestWorktree, type RecencyProbe } from "./worktree-recency.js"
import { isLeft, isRight } from "../types.js"

const root = path.join(path.sep, "wt", "root")
const repo = path.join(path.sep, "repo")

const wt = (name: string): string => path.join(root, name)

const gitdirOf = (name: string): string => path.join(wt(name), ".git", "worktrees", name, "index")

type SpawnConfig = {
  readonly porcelain?: string
  readonly porcelainExit?: number
  readonly versionExit?: number
}

const makeSpawn =
  (config: SpawnConfig): SpawnFn =>
  async (command, options) => {
    const args = command.slice(1)
    if (args[0] === "--version") {
      return { exitCode: config.versionExit ?? 0, stdout: "git version 2.x", stderr: "" }
    }
    if (args[0] === "worktree" && args[1] === "list") {
      return {
        exitCode: config.porcelainExit ?? 0,
        stdout: config.porcelain ?? "",
        stderr: config.porcelainExit !== undefined ? "boom" : "",
      }
    }
    if (args[0] === "rev-parse") {
      const name = path.basename(options.cwd)
      return {
        exitCode: 0,
        stdout: path.join(wt(name), ".git", "worktrees", name),
        stderr: "",
      }
    }
    if (args[0] === "log") {
      return { exitCode: 0, stdout: "0", stderr: "" }
    }
    return { exitCode: 1, stdout: "", stderr: "unexpected command" }
  }

const makeProbe = (spawn: SpawnFn, mtimes: Record<string, number>): RecencyProbe => ({
  spawn,
  exists: async () => true,
  stat: (async (filePath: string) => mtimes[filePath]) as StatFn,
})

const probeWith = (mtimes: Record<string, number>, spawnConfig: SpawnConfig = {}): RecencyProbe =>
  makeProbe(makeSpawn(spawnConfig), mtimes)

const porcelainFor = (...names: readonly string[]): string =>
  [
    `worktree ${repo}`,
    "HEAD 111",
    "branch refs/heads/main",
    ...names.map((name) => `worktree ${wt(name)}`),
  ].join("\n")

describe("latestWorktree", () => {
  it("returns undefined when the repo has no worktrees under the plugin root", async () => {
    const result = await latestWorktree(
      probeWith({}, { porcelain: `worktree ${repo}\nbranch refs/heads/main` }),
      { preferNixDevelop: false },
      root,
      repo,
    )
    expect(isRight(result)).toBe(true)
    if (isRight(result)) expect(result.success).toBeUndefined()
  })

  it("picks the worktree whose index shows recent activity past the creation window", async () => {
    const result = await latestWorktree(
      probeWith(
        {
          [path.join(wt("integ-feat"), ".git")]: 1000,
          [gitdirOf("integ-feat")]: 20000,
          [path.join(wt("integ-fix"), ".git")]: 1000,
          [gitdirOf("integ-fix")]: 2000,
        },
        { porcelain: porcelainFor("integ-feat", "integ-fix") },
      ),
      { preferNixDevelop: false },
      root,
      repo,
    )
    expect(isRight(result)).toBe(true)
    if (isRight(result)) expect(result.success).toBe("integ-feat")
  })

  it("treats an index write inside the creation window as never worked on", async () => {
    const result = await latestWorktree(
      probeWith(
        {
          [path.join(wt("integ-feat"), ".git")]: 1000,
          [gitdirOf("integ-feat")]: 6000,
          [path.join(wt("integ-fix"), ".git")]: 1000,
          [gitdirOf("integ-fix")]: 6001,
        },
        { porcelain: porcelainFor("integ-feat", "integ-fix") },
      ),
      { preferNixDevelop: false },
      root,
      repo,
    )
    expect(isRight(result)).toBe(true)
    if (isRight(result)) expect(result.success).toBe("integ-fix")
  })

  it("ranks head commit time as activity when the index is missing", async () => {
    const spawn: SpawnFn = async (command, options) => {
      const args = command.slice(1)
      if (args[0] === "--version") return { exitCode: 0, stdout: "git version 2.x", stderr: "" }
      if (args[0] === "worktree") {
        return { exitCode: 0, stdout: porcelainFor("integ-feat", "integ-fix"), stderr: "" }
      }
      if (args[0] === "rev-parse") return { exitCode: 1, stdout: "", stderr: "no gitdir" }
      if (args[0] === "log") {
        const name = path.basename(options.cwd)
        return { exitCode: 0, stdout: name === "integ-fix" ? "6000" : "5000", stderr: "" }
      }
      return { exitCode: 1, stdout: "", stderr: "unexpected command" }
    }
    const probe = makeProbe(spawn, {
      [path.join(wt("integ-feat"), ".git")]: 1000,
      [path.join(wt("integ-fix"), ".git")]: 1000,
    })

    const result = await latestWorktree(probe, { preferNixDevelop: false }, root, repo)

    expect(isRight(result)).toBe(true)
    if (isRight(result)) expect(result.success).toBe("integ-fix")
  })

  it("demotes a worktree whose only activity is its own creation", async () => {
    const spawn: SpawnFn = async (command, options) => {
      const args = command.slice(1)
      if (args[0] === "--version") return { exitCode: 0, stdout: "git version 2.x", stderr: "" }
      if (args[0] === "worktree") {
        return { exitCode: 0, stdout: porcelainFor("integ-feat", "integ-fix"), stderr: "" }
      }
      if (args[0] === "rev-parse") return { exitCode: 1, stdout: "", stderr: "no gitdir" }
      if (args[0] === "log") {
        const name = path.basename(options.cwd)
        return { exitCode: 0, stdout: name === "integ-fix" ? "2" : "0", stderr: "" }
      }
      return { exitCode: 1, stdout: "", stderr: "unexpected command" }
    }
    const probe = makeProbe(spawn, {
      [path.join(wt("integ-feat"), ".git")]: 1000,
      [path.join(wt("integ-fix"), ".git")]: 1000,
    })

    const result = await latestWorktree(probe, { preferNixDevelop: false }, root, repo)

    expect(isRight(result)).toBe(true)
    if (isRight(result)) expect(result.success).toBe("integ-fix")
  })

  it("breaks score ties by name ascending", async () => {
    const result = await latestWorktree(
      probeWith(
        {
          [path.join(wt("integ-fix"), ".git")]: 1000,
          [gitdirOf("integ-fix")]: 9000,
          [path.join(wt("integ-feat"), ".git")]: 1000,
          [gitdirOf("integ-feat")]: 9000,
        },
        { porcelain: porcelainFor("integ-fix", "integ-feat") },
      ),
      { preferNixDevelop: false },
      root,
      repo,
    )
    expect(isRight(result)).toBe(true)
    if (isRight(result)) expect(result.success).toBe("integ-feat")
  })

  it("falls back to head-time ordering when no worktree was ever worked on", async () => {
    const spawn: SpawnFn = async (command, options) => {
      const args = command.slice(1)
      if (args[0] === "--version") return { exitCode: 0, stdout: "git version 2.x", stderr: "" }
      if (args[0] === "worktree") {
        return { exitCode: 0, stdout: porcelainFor("integ-feat", "integ-fix"), stderr: "" }
      }
      if (args[0] === "rev-parse") return { exitCode: 1, stdout: "", stderr: "no gitdir" }
      if (args[0] === "log") {
        const name = path.basename(options.cwd)
        return { exitCode: 0, stdout: name === "integ-fix" ? "2000" : "1000", stderr: "" }
      }
      return { exitCode: 1, stdout: "", stderr: "unexpected command" }
    }
    const probe = makeProbe(spawn, {
      [path.join(wt("integ-feat"), ".git")]: 5_000_000,
      [path.join(wt("integ-fix"), ".git")]: 5_000_000,
    })

    const result = await latestWorktree(probe, { preferNixDevelop: false }, root, repo)

    expect(isRight(result)).toBe(true)
    if (isRight(result)) expect(result.success).toBe("integ-fix")
  })

  it("ignores paths that are not direct children with valid worktree names", async () => {
    const porcelain = [
      `worktree ${repo}`,
      "branch refs/heads/main",
      `worktree ${path.join(root, "nested", "inner")}`,
      `worktree ${path.join(root, ".config")}`,
      `worktree ${root}-sibling`,
    ].join("\n")
    const result = await latestWorktree(
      probeWith({}, { porcelain }),
      { preferNixDevelop: false },
      root,
      repo,
    )
    expect(isRight(result)).toBe(true)
    if (isRight(result)) expect(result.success).toBeUndefined()
  })

  it("propagates the git-not-found error when git is unavailable", async () => {
    const probe: RecencyProbe = {
      spawn: makeSpawn({ versionExit: 1 }),
      exists: async () => false,
      stat: (async () => undefined) as StatFn,
    }
    const result = await latestWorktree(probe, { preferNixDevelop: false }, root, repo)
    expect(isLeft(result)).toBe(true)
    if (isLeft(result)) expect(result.failure.kind).toBe("git-not-found")
  })

  it("propagates the git error when the worktree list cannot be read", async () => {
    const result = await latestWorktree(
      probeWith({}, { porcelainExit: 1 }),
      { preferNixDevelop: false },
      root,
      repo,
    )
    expect(isLeft(result)).toBe(true)
    if (isLeft(result)) expect(result.failure.kind).toBe("git-error")
  })
})
