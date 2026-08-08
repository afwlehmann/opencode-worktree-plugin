import { describe, it, expect } from "vitest"
import {
  left,
  right,
  isLeft,
  isRight,
  map,
  flatMap,
  mapError,
  toErrorMessage,
  type WorktreeError,
} from "./types.js"

describe("either", () => {
  it("left creates a Left either", () => {
    const result = left("error")
    expect(result._tag).toBe("Failure")
    expect(isLeft(result)).toBe(true)
    expect(isRight(result)).toBe(false)
  })

  it("right creates a Right either", () => {
    const result = right(42)
    expect(result._tag).toBe("Success")
    expect(isRight(result)).toBe(true)
    expect(isLeft(result)).toBe(false)
  })

  it("map transforms Right value", () => {
    const result = map(right(5), (n) => n * 2)
    expect(isRight(result)).toBe(true)
    if (isRight(result)) expect(result.success).toBe(10)
  })

  it("map does not transform Left", () => {
    const result = map(left("err"), (n: number) => n * 2)
    expect(isLeft(result)).toBe(true)
  })

  it("flatMap chains Right", () => {
    const result = flatMap(right(5), (n) => right(n + 1))
    expect(isRight(result)).toBe(true)
    if (isRight(result)) expect(result.success).toBe(6)
  })

  it("flatMap propagates Left", () => {
    const result = flatMap(left("err"), (n: number) => right(n + 1))
    expect(isLeft(result)).toBe(true)
  })

  it("mapError transforms Left error", () => {
    const result = mapError(left("err"), (e) => e.toUpperCase())
    expect(isLeft(result)).toBe(true)
    if (isLeft(result)) expect(result.failure).toBe("ERR")
  })
})

describe("toErrorMessage", () => {
  it("formats git-error", () => {
    const error: WorktreeError = {
      kind: "git-error",
      command: "git worktree add",
      stderr: "fatal: already exists",
      message: "fatal: already exists",
    }
    expect(toErrorMessage(error)).toContain("git worktree add")
    expect(toErrorMessage(error)).toContain("fatal: already exists")
  })

  it("formats worktree-exists", () => {
    const error: WorktreeError = { kind: "worktree-exists", path: "/tmp/wt" }
    expect(toErrorMessage(error)).toContain("/tmp/wt")
  })

  it("formats not-fast-forward with rebase hint", () => {
    const error: WorktreeError = {
      kind: "not-fast-forward",
      sourceBranch: "feature",
      targetBranch: "main",
    }
    expect(toErrorMessage(error)).toContain("feature")
    expect(toErrorMessage(error)).toContain("main")
    expect(toErrorMessage(error)).toContain("Rebase")
  })

  it("formats git-not-found", () => {
    const error: WorktreeError = {
      kind: "git-not-found",
      searchedPaths: ["/usr/bin", "/usr/local/bin"],
    }
    expect(toErrorMessage(error)).toContain("/usr/bin")
    expect(toErrorMessage(error)).toContain("/usr/local/bin")
  })

  it("formats branch-not-merged", () => {
    const error: WorktreeError = { kind: "branch-not-merged", branch: "feature" }
    expect(toErrorMessage(error)).toContain("feature")
    expect(toErrorMessage(error)).toContain("not merged")
  })
})
