import { describe, it, expect } from "vitest"
import type { Message, Part } from "@opencode-ai/sdk/v2"
import type { TuiPluginModule } from "@opencode-ai/plugin/tui"
import tuiModule from "./tui.js"

type RenderedNode = { tag?: unknown; props?: Record<string, unknown>; children?: unknown[] }
;(globalThis as Record<string, unknown>)["React"] = {
  createElement: (tag: unknown, props: unknown, ...children: unknown[]): RenderedNode => ({
    tag,
    props: props as Record<string, unknown> | undefined,
    children,
  }),
}

type SlotRegistration = { order: number; slots: Record<string, unknown> }

type MockApi = {
  theme: { current: Record<string, string> }
  route: { current: { name: string; params?: Record<string, unknown> } }
  state: {
    path: { directory: string }
    vcs: { branch?: string } | undefined
    session: {
      status: () => undefined
      messages: (sessionID: string) => readonly Message[]
    }
    part: (messageID: string) => readonly Part[]
  }
  slots: { register: (registration: SlotRegistration) => void }
  event: { on: (name: string, handler: (event: never) => void) => void }
}

type MockApiBundle = {
  api: MockApi
  registrations: SlotRegistration[]
  handlers: Record<string, (event: never) => void>
  parts: Part[]
}

type MockApiOptions = {
  branch?: string
  directory?: string
}

const mockApi = ({
  branch,
  directory = "/tmp/wt-wiring-does-not-exist",
}: MockApiOptions = {}): MockApiBundle => {
  const registrations: SlotRegistration[] = []
  const handlers: Record<string, (event: never) => void> = {}
  const parts: Part[] = []
  const sessionMessage: Message = { id: "m1", role: "assistant" } as unknown as Message
  const api: MockApi = {
    theme: { current: { textMuted: "#808080" } },
    route: { current: { name: "home" } },
    state: {
      path: { directory },
      vcs: branch === undefined ? undefined : { branch },
      session: {
        status: () => undefined,
        messages: (sessionID) => (sessionID === "s1" ? [sessionMessage] : []),
      },
      part: (messageID) => parts.filter((part) => part.messageID === messageID),
    },
    slots: { register: (registration) => registrations.push(registration) },
    event: { on: (name, handler) => (handlers[name] = handler) },
  }
  return { api, registrations, handlers, parts }
}

const activate = async (bundle: MockApiBundle): Promise<void> => {
  const module = tuiModule as TuiPluginModule
  await module.tui(bundle.api as never, undefined)
}

const enterSession = (bundle: MockApiBundle, sessionID: string): void => {
  bundle.api.route.current = { name: "session", params: { sessionID } }
}

let partCounter = 0

const worktreeToolPart = (
  tool: string,
  repoShort: string,
  sourceBranch: string,
  sessionID = "s1",
  messageID = "m1",
): Part =>
  ({
    id: `p${++partCounter}`,
    sessionID,
    messageID,
    type: "tool",
    callID: `c${partCounter}`,
    tool,
    state: { status: "completed", input: { repo_short: repoShort, source_branch: sourceBranch } },
  }) as unknown as Part

const dispatchPartUpdated = (bundle: MockApiBundle, part: Part, storeIt = true): void => {
  if (storeIt) bundle.parts.push(part)
  bundle.handlers["message.part.updated"]?.({ properties: { part } } as never)
}

const collectStrings = (node: unknown): readonly string[] => {
  if (typeof node === "string") return [node]
  if (typeof node === "number") return [String(node)]
  if (Array.isArray(node)) return node.flatMap(collectStrings)
  if (typeof node === "object" && node !== null) {
    const children = (node as { children?: unknown }).children
    return children === undefined ? [] : collectStrings(children)
  }
  return []
}

const renderSlotLabel = (bundle: MockApiBundle): string => {
  const registration = bundle.registrations[0]
  expect(registration).toBeDefined()
  const render = registration.slots["app_bottom"]
  expect(typeof render).toBe("function")
  const rendered = (render as () => unknown)()
  return collectStrings(rendered).join(" ")
}

describe("tui plugin wiring (mock api)", () => {
  it("registers exactly one slot group targeting app_bottom", async () => {
    const bundle = mockApi()
    await activate(bundle)

    expect(bundle.registrations).toHaveLength(1)
    expect(bundle.registrations[0]).toBeDefined()
    expect(bundle.registrations[0].order).toBe(100)
    expect(Object.keys(bundle.registrations[0].slots)).toEqual(["app_bottom"])
  })

  it("subscribes to the events driving worktree state", async () => {
    const bundle = mockApi()
    await activate(bundle)

    expect(bundle.handlers["message.part.updated"]).toBeDefined()
    expect(bundle.handlers["message.part.removed"]).toBeDefined()
  })

  it("activates without vcs state (branch unknown until TUI populates it)", async () => {
    const bundle = mockApi()
    await activate(bundle)

    expect(bundle.registrations).toHaveLength(1)
  })

  it("renders the fallback label outside any session", async () => {
    const bundle = mockApi({ branch: "main", directory: "/Users/test/src/git/config" })
    await activate(bundle)

    expect(renderSlotLabel(bundle)).toContain("config:main")
  })

  it("renders the worktree label after a worktree_create tool call", async () => {
    const bundle = mockApi({ branch: "main" })
    await activate(bundle)
    enterSession(bundle, "s1")

    dispatchPartUpdated(bundle, worktreeToolPart("worktree_create", "integ", "feat-e2e"))

    expect(renderSlotLabel(bundle)).toContain("integ-feat-e2e")
  })

  it("renders multiple concurrently active worktrees joined", async () => {
    const bundle = mockApi({ branch: "main" })
    await activate(bundle)
    enterSession(bundle, "s1")

    dispatchPartUpdated(bundle, worktreeToolPart("worktree_create", "integ", "feat"))
    dispatchPartUpdated(bundle, worktreeToolPart("worktree_create", "integ", "fix"))

    expect(renderSlotLabel(bundle)).toContain("integ-feat + integ-fix")
  })

  it("falls back to the directory label after worktree_merge", async () => {
    const bundle = mockApi({ branch: "main", directory: "/Users/test/src/git/config" })
    await activate(bundle)
    enterSession(bundle, "s1")

    dispatchPartUpdated(bundle, worktreeToolPart("worktree_create", "integ", "feat"))
    dispatchPartUpdated(bundle, worktreeToolPart("worktree_merge", "integ", "feat"))

    expect(renderSlotLabel(bundle)).toContain("config:main")
  })

  it("derives the label from history when the part predates the first render", async () => {
    const bundle = mockApi({ branch: "main" })
    await activate(bundle)
    enterSession(bundle, "s1")
    bundle.parts.push(worktreeToolPart("worktree_create", "integ", "older"))

    expect(renderSlotLabel(bundle)).toContain("integ-older")
  })

  it("keeps event-derived entries when the seed scan lags behind the event", async () => {
    const bundle = mockApi({ branch: "main" })
    await activate(bundle)
    enterSession(bundle, "s1")

    dispatchPartUpdated(bundle, worktreeToolPart("worktree_create", "integ", "lag"), false)

    expect(renderSlotLabel(bundle)).toContain("integ-lag")
  })

  it("keeps event-derived entries across repeated events for the same part", async () => {
    const bundle = mockApi({ branch: "main", directory: "/Users/test/src/git/config" })
    await activate(bundle)
    enterSession(bundle, "s1")

    dispatchPartUpdated(bundle, worktreeToolPart("worktree_create", "integ", "feat"), false)
    dispatchPartUpdated(bundle, worktreeToolPart("worktree_create", "integ", "feat"), false)

    expect(renderSlotLabel(bundle)).toContain("integ-feat")
    expect(renderSlotLabel(bundle)).not.toContain("+")
  })

  it("ignores tool parts belonging to other sessions", async () => {
    const bundle = mockApi({ branch: "main", directory: "/Users/test/src/git/config" })
    await activate(bundle)
    enterSession(bundle, "s1")

    dispatchPartUpdated(
      bundle,
      worktreeToolPart("worktree_create", "integ", "feat", "s-other", "m-other"),
    )

    expect(renderSlotLabel(bundle)).toContain("config:main")
  })
})
