import { describe, it, expect } from "vitest"
import type { Message, Part } from "@opencode-ai/sdk/v2"
import {
  activeWorktrees,
  activeWorktreesFrom,
  collectWorktreeCalls,
  extractWorktreeCalls,
  recordWorktreeCall,
  stepActiveWorktrees,
  type WorktreeToolCall,
} from "./active-worktree.js"

let callID = 0
let partID = 0

const toolPart = (tool: string, input: Record<string, unknown>): Part =>
  ({
    id: `p${++partID}`,
    sessionID: "s1",
    messageID: "m1",
    type: "tool",
    callID: `c${++callID}`,
    tool,
    state: { status: "completed", input, output: "" },
  }) as unknown as Part

const textPart = (text: string): Part =>
  ({ id: `p${++partID}`, sessionID: "s1", messageID: "m1", type: "text", text }) as unknown as Part

const createCall = (
  repoShort = "integ",
  sourceBranch = "feat",
  partID?: string,
): WorktreeToolCall => ({
  tool: "worktree_create",
  repoShort,
  sourceBranch,
  partID,
})

const mergeCall = (repoShort = "integ", sourceBranch = "feat"): WorktreeToolCall => ({
  tool: "worktree_merge",
  repoShort,
  sourceBranch,
})

const removeCall = (repoShort = "integ", sourceBranch = "feat"): WorktreeToolCall => ({
  tool: "worktree_remove",
  repoShort,
  sourceBranch,
})

const assistantMessage = (id: string): Message => ({ id, role: "assistant" }) as unknown as Message

const extractExpectation = (call: WorktreeToolCall): unknown =>
  expect.objectContaining({
    tool: call.tool,
    repoShort: call.repoShort,
    sourceBranch: call.sourceBranch,
  })

describe("extractWorktreeCalls", () => {
  it("extracts a valid worktree_create call", () => {
    const calls = extractWorktreeCalls([
      toolPart("worktree_create", { repo_short: "integ", source_branch: "feat" }),
    ])
    expect(calls).toEqual([extractExpectation(createCall())])
  })

  it("extracts worktree_merge and worktree_remove calls", () => {
    const calls = extractWorktreeCalls([
      toolPart("worktree_merge", { repo_short: "integ", source_branch: "feat" }),
      toolPart("worktree_remove", { repo_short: "integ", source_branch: "fix" }),
    ])
    expect(calls).toEqual([
      extractExpectation(mergeCall()),
      extractExpectation(removeCall("integ", "fix")),
    ])
  })

  it("ignores non-tool parts and unrelated tools", () => {
    const calls = extractWorktreeCalls([
      textPart("hello"),
      toolPart("bash", { command: "git worktree add ../x" }),
    ])
    expect(calls).toEqual([])
  })

  it("filters out invalid names", () => {
    const calls = extractWorktreeCalls([
      toolPart("worktree_create", { repo_short: "../evil", source_branch: "feat" }),
      toolPart("worktree_create", { repo_short: "integ", source_branch: "feat/with-slash" }),
      toolPart("worktree_create", { repo_short: 42, source_branch: "feat" }),
    ])
    expect(calls).toEqual([])
  })

  it("filters out parts with missing input", () => {
    const part = toolPart("worktree_create", {})
    const calls = extractWorktreeCalls([part])
    expect(calls).toEqual([])
  })
})

describe("stepActiveWorktrees", () => {
  it("adds an entry on create", () => {
    expect(stepActiveWorktrees([], createCall())).toEqual(["integ-feat"])
  })

  it("removes the matching entry on merge", () => {
    const active = stepActiveWorktrees([], createCall())
    expect(stepActiveWorktrees(active, mergeCall())).toEqual([])
  })

  it("removes the matching entry on remove", () => {
    const active = stepActiveWorktrees([], createCall())
    expect(stepActiveWorktrees(active, removeCall())).toEqual([])
  })

  it("keeps other entries when removing one", () => {
    const active = activeWorktrees([createCall("integ", "feat"), createCall("integ", "fix")])
    expect(stepActiveWorktrees(active, mergeCall("integ", "feat"))).toEqual(["integ-fix"])
  })

  it("re-creates an entry that was merged before", () => {
    const active = stepActiveWorktrees([], createCall())
    const afterMerge = stepActiveWorktrees(active, mergeCall())
    expect(stepActiveWorktrees(afterMerge, createCall())).toEqual(["integ-feat"])
  })

  it("collapses duplicate creates of the same worktree", () => {
    const active = stepActiveWorktrees([], createCall())
    expect(stepActiveWorktrees(active, createCall())).toEqual(["integ-feat"])
  })
})

describe("activeWorktrees (fold)", () => {
  it("returns empty for an empty call list", () => {
    expect(activeWorktrees([])).toEqual([])
  })

  it("folds a sequential create → merge → create lifecycle", () => {
    const calls = [createCall("integ", "feat"), mergeCall(), createCall("integ", "fix")]
    expect(activeWorktrees(calls)).toEqual(["integ-fix"])
  })

  it("tracks multiple concurrently active worktrees", () => {
    const calls = [createCall("integ", "feat"), createCall("integ", "fix")]
    expect(activeWorktrees(calls)).toEqual(["integ-feat", "integ-fix"])
  })

  it("leaves the last worktree active when others are merged", () => {
    const calls = [
      createCall("integ", "feat"),
      createCall("integ", "fix"),
      mergeCall("integ", "feat"),
    ]
    expect(activeWorktrees(calls)).toEqual(["integ-fix"])
  })
})

describe("collectWorktreeCalls", () => {
  it("scans messages in order via the injected part getter", () => {
    const messages = [assistantMessage("m1"), assistantMessage("m2")]
    const partsByMessage: Record<string, readonly Part[]> = {
      m1: [toolPart("worktree_create", { repo_short: "integ", source_branch: "feat" })],
      m2: [toolPart("worktree_merge", { repo_short: "integ", source_branch: "feat" })],
    }
    const calls = collectWorktreeCalls(messages, (id) => partsByMessage[id] ?? [])
    expect(calls).toEqual([extractExpectation(createCall()), extractExpectation(mergeCall())])
  })

  it("skips messages without parts", () => {
    const messages = [assistantMessage("m1"), assistantMessage("m2")]
    const calls = collectWorktreeCalls(messages, () => [])
    expect(calls).toEqual([])
  })
})

describe("recordWorktreeCall", () => {
  it("appends a new call", () => {
    expect(recordWorktreeCall([], createCall())).toEqual([createCall()])
  })

  it("does not duplicate a call with the same tool and names", () => {
    const recorded = recordWorktreeCall([], createCall())
    expect(recordWorktreeCall(recorded, createCall())).toEqual([createCall()])
  })

  it("keeps distinct transitions of the same worktree", () => {
    const recorded = recordWorktreeCall([], createCall())
    expect(recordWorktreeCall(recorded, mergeCall())).toEqual([createCall(), mergeCall()])
  })

  it("keeps a re-created worktree (distinct part) as a distinct call", () => {
    const recorded = [createCall("integ", "feat", "p1"), mergeCall()]
    expect(recordWorktreeCall(recorded, createCall("integ", "feat", "p2"))).toEqual([
      createCall("integ", "feat", "p1"),
      mergeCall(),
      createCall("integ", "feat", "p2"),
    ])
  })

  it("collapses repeated events for the same part by key fallback", () => {
    const recorded = recordWorktreeCall([], createCall())
    expect(recordWorktreeCall(recorded, createCall())).toEqual([createCall()])
  })
})

describe("activeWorktreesFrom", () => {
  it("replays recorded calls after the history so later events win", () => {
    const history = [createCall("integ", "feat")]
    const recorded = [mergeCall("integ", "feat")]
    expect(activeWorktreesFrom(history, recorded)).toEqual([])
  })

  it("preserves event-derived entries missing from a lagging history", () => {
    const history: readonly WorktreeToolCall[] = []
    const recorded = [createCall("integ", "lag")]
    expect(activeWorktreesFrom(history, recorded)).toEqual(["integ-lag"])
  })

  it("is idempotent when history and recorded contain the same create", () => {
    const history = [createCall("integ", "feat")]
    const recorded = [createCall("integ", "feat")]
    expect(activeWorktreesFrom(history, recorded)).toEqual(["integ-feat"])
  })

  it("resolves a merge seen only in the recorded stream after a stale history", () => {
    const history = [createCall("integ", "feat")]
    const recorded = [createCall("integ", "feat"), mergeCall("integ", "feat")]
    expect(activeWorktreesFrom(history, recorded)).toEqual([])
  })
})
