import { describe, it, expect } from "vitest"
import {
  addWorktreeRootAllow,
  isInsideWorktreeRoot,
  isInsideAnyRoot,
  activeWorktreePaths,
} from "./permissions.js"

const root = "/home/user/.local/state/opencode/worktrees"

describe("isInsideWorktreeRoot", () => {
  it("accepts the root itself", () => {
    expect(isInsideWorktreeRoot(root, root)).toBe(true)
  })

  it("accepts a worktree under the root", () => {
    expect(isInsideWorktreeRoot(`${root}/config-feat`, root)).toBe(true)
  })

  it("accepts a nested path under the root", () => {
    expect(isInsideWorktreeRoot(`${root}/config-feat/src/index.ts`, root)).toBe(true)
  })

  it("accepts glob patterns under the root", () => {
    expect(isInsideWorktreeRoot(`${root}/**`, root)).toBe(true)
    expect(isInsideWorktreeRoot(`${root}/config-feat/**`, root)).toBe(true)
  })

  it("rejects a sibling sharing the string prefix", () => {
    expect(isInsideWorktreeRoot(`${root}-evil/config-feat`, root)).toBe(false)
  })

  it("rejects the parent directory of the root", () => {
    expect(isInsideWorktreeRoot("/home/user/.local/state/opencode", root)).toBe(false)
  })

  it("rejects unrelated paths", () => {
    expect(isInsideWorktreeRoot("/home/user/src/git/config", root)).toBe(false)
    expect(isInsideWorktreeRoot("", root)).toBe(false)
  })
})

describe("isInsideAnyRoot", () => {
  it("matches when any root contains the candidate", () => {
    expect(isInsideAnyRoot(`${root}/config-feat`, ["/unrelated", root])).toBe(true)
  })

  it("rejects when no root contains the candidate", () => {
    expect(isInsideAnyRoot(`${root}-evil/config-feat`, [root, "/resolved/root"])).toBe(false)
  })
})

describe("activeWorktreePaths", () => {
  it("keeps only paths inside the plugin roots", () => {
    const repoPath = "/home/user/src/git/config"
    expect(
      activeWorktreePaths([repoPath, `${root}/config-feat`, "/tmp/elsewhere"], [root]),
    ).toEqual([`${root}/config-feat`])
  })

  it("returns an empty list when nothing matches", () => {
    expect(activeWorktreePaths(["/home/user/src/git/config"], [root])).toEqual([])
  })
})

describe("addWorktreeRootAllow", () => {
  it("creates allow rules when external_directory is absent", () => {
    const config: { permission?: Record<string, unknown> } = {}
    addWorktreeRootAllow(config, [root])
    expect(config.permission?.["external_directory"]).toEqual({ [`${root}/**`]: "allow" })
  })

  it("promotes a scalar external_directory rule to a rule map and keeps the user default", () => {
    const config: { permission?: Record<string, unknown> } = {
      permission: { external_directory: "ask" },
    }
    addWorktreeRootAllow(config, [root])
    expect(config.permission?.["external_directory"]).toEqual({
      "*": "ask",
      [`${root}/**`]: "allow",
    })
  })

  it("merges allow rules into an existing rule map", () => {
    const config: { permission?: Record<string, unknown> } = {
      permission: { external_directory: { "/some/where": "deny", "*": "deny" } },
    }
    addWorktreeRootAllow(config, [root, "/resolved/root"])
    expect(config.permission?.["external_directory"]).toEqual({
      "*": "deny",
      "/some/where": "deny",
      [`${root}/**`]: "allow",
      "/resolved/root/**": "allow",
    })
  })
})
