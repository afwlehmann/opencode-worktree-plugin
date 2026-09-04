import { describe, it, expect } from "vitest"
import { pedanticReply } from "./permission-reply.js"

const worktreesRoot = "/home/user/.local/state/opencode/worktrees"
const active = [`${worktreesRoot}/ocp-feat-auth`]
const sessionID = "ses_123"
const requestID = "per_456"

describe("pedanticReply", () => {
  it("approves an external_directory ask inside an active worktree", () => {
    const reply = pedanticReply(
      {
        id: requestID,
        sessionID,
        permission: "external_directory",
        patterns: [`${worktreesRoot}/ocp-feat-auth`],
        always: [`${worktreesRoot}/ocp-feat-auth`],
      },
      active,
    )
    expect(reply).toEqual({
      sessionID,
      requestID,
      response: "always",
      patterns: [`${worktreesRoot}/ocp-feat-auth`],
    })
  })

  it("accepts the legacy `type`/`pattern` event shape", () => {
    const reply = pedanticReply(
      {
        id: requestID,
        sessionID,
        type: "external_directory",
        pattern: `${worktreesRoot}/ocp-feat-auth/src`,
      },
      active,
    )
    expect(reply?.requestID).toBe(requestID)
    expect(reply?.response).toBe("once")
  })

  it("approves persistently only when every suggested always pattern is worktree-scoped", () => {
    const reply = pedanticReply(
      {
        id: requestID,
        sessionID,
        permission: "external_directory",
        patterns: [`${worktreesRoot}/ocp-feat-auth`],
        always: [`${worktreesRoot}/ocp-feat-auth`, "git add*"],
      },
      active,
    )
    expect(reply?.response).toBe("once")
  })

  it("does not approve a path under the worktrees root that is not an active worktree", () => {
    const reply = pedanticReply(
      {
        id: requestID,
        sessionID,
        permission: "external_directory",
        patterns: [`${worktreesRoot}/ocp-gone`],
        always: [`${worktreesRoot}/ocp-gone`],
      },
      active,
    )
    expect(reply).toBeUndefined()
  })

  it("does not approve when any pattern leaves the active worktrees", () => {
    const reply = pedanticReply(
      {
        id: requestID,
        sessionID,
        permission: "external_directory",
        patterns: [`${worktreesRoot}/ocp-feat-auth`, "/etc/passwd"],
        always: [`${worktreesRoot}/ocp-feat-auth`],
      },
      active,
    )
    expect(reply).toBeUndefined()
  })

  it("rejects sibling directories that only share the string prefix", () => {
    const reply = pedanticReply(
      {
        id: requestID,
        sessionID,
        permission: "external_directory",
        patterns: [`${worktreesRoot}-evil/ocp-feat-auth`],
      },
      active,
    )
    expect(reply).toBeUndefined()
  })

  it("ignores non-external_directory permissions", () => {
    const reply = pedanticReply(
      {
        id: requestID,
        sessionID,
        permission: "bash",
        patterns: ["git status*"],
      },
      active,
    )
    expect(reply).toBeUndefined()
  })

  it("ignores events without a session id, request id, or patterns", () => {
    expect(
      pedanticReply(
        { permission: "external_directory", patterns: [`${worktreesRoot}/ocp-feat-auth`] },
        active,
      ),
    ).toBeUndefined()
    expect(
      pedanticReply({ id: requestID, permission: "external_directory" }, active),
    ).toBeUndefined()
    expect(
      pedanticReply(
        { id: requestID, sessionID, permission: "external_directory", patterns: [] },
        active,
      ),
    ).toBeUndefined()
  })

  it("ignores everything when there are no active worktrees", () => {
    const reply = pedanticReply(
      {
        id: requestID,
        sessionID,
        permission: "external_directory",
        patterns: [`${worktreesRoot}/ocp-feat-auth`],
      },
      [],
    )
    expect(reply).toBeUndefined()
  })
})
