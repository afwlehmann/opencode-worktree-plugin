import { describe, it, expect, vi, beforeEach } from "vitest"
import * as path from "node:path"
import * as os from "node:os"
import type { Message, Part } from "@opencode-ai/sdk/v2"
import type { TuiPluginModule } from "@opencode-ai/plugin/tui"
import { copyToClipboard } from "./lib/clipboard.js"
import { left, right } from "./types.js"
import tuiModule from "./tui.js"

vi.mock("./lib/clipboard.js", () => ({ copyToClipboard: vi.fn() }))

const mockedCopy = vi.mocked(copyToClipboard)

type RenderedNode = { tag?: unknown; props?: Record<string, unknown>; children?: unknown[] }
;(globalThis as Record<string, unknown>)["React"] = {
  createElement: (tag: unknown, props: unknown, ...children: unknown[]): RenderedNode => ({
    tag,
    props: props as Record<string, unknown> | undefined,
    children,
  }),
}

type SlotRegistration = { order: number; slots: Record<string, unknown> }

type DialogOption = { title: string; value: string; description: string }

type ToastInput = { variant?: string; title?: string; message: string }

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
  ui: {
    dialog: { replace: (render: () => unknown, onClose?: () => void) => void; clear: () => void }
    toast: (input: ToastInput) => void
    DialogSelect: (props: {
      title: string
      placeholder?: string
      options: Array<DialogOption & { onSelect?: () => void }>
      onSelect?: (option: DialogOption) => void
    }) => never
  }
}

type MockApiBundle = {
  api: MockApi
  registrations: SlotRegistration[]
  handlers: Record<string, (event: never) => void>
  parts: Part[]
  replacements: Array<{ render: () => unknown; onClose?: () => void }>
  toasts: ToastInput[]
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
  const replacements: Array<{ render: () => unknown; onClose?: () => void }> = []
  const toasts: ToastInput[] = []
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
    ui: {
      dialog: {
        replace: (render, onClose) => {
          replacements.push({ render, onClose })
        },
        clear: () => {
          replacements.length = 0
        },
      },
      toast: (input) => {
        toasts.push(input)
      },
      DialogSelect: (props: {
        title: string
        options: Array<DialogOption & { onSelect?: () => void }>
        onSelect?: (option: DialogOption) => void
      }) => ({ props }) as never,
    },
  }
  return { api, registrations, handlers, parts, replacements, toasts }
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

const findNode = (node: unknown, predicate: (node: object) => boolean): object | undefined => {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findNode(child, predicate)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (typeof node === "object" && node !== null) {
    if (predicate(node)) return node
    const children = (node as { children?: unknown }).children
    return children === undefined ? undefined : findNode(children, predicate)
  }
  return undefined
}

const clickWorktreeLabel = (bundle: MockApiBundle): void => {
  const registration = bundle.registrations[0]
  expect(registration).toBeDefined()
  const rendered = (registration.slots["app_bottom"] as () => unknown)()
  const label = findNode(rendered, (node) => {
    const props = (node as { props?: Record<string, unknown> }).props
    return typeof props?.["onMouseDown"] === "function"
  })
  expect(label).toBeDefined()
  const props = (label as { props: Record<string, unknown> }).props
  ;(props["onMouseDown"] as () => void)()
}

describe("tui plugin wiring (mock api)", () => {
  beforeEach(() => {
    mockedCopy.mockReset()
    mockedCopy.mockResolvedValue(right(undefined))
  })

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

  it("renders the latest worktree with a count for several concurrently active ones", async () => {
    const bundle = mockApi({ branch: "main" })
    await activate(bundle)
    enterSession(bundle, "s1")

    dispatchPartUpdated(bundle, worktreeToolPart("worktree_create", "integ", "feat"))
    dispatchPartUpdated(bundle, worktreeToolPart("worktree_create", "integ", "fix"))

    expect(renderSlotLabel(bundle)).toContain("integ-fix (2)")
  })

  it("opens a worktree dialog with absolute paths when the label is clicked", async () => {
    const bundle = mockApi({ branch: "main" })
    await activate(bundle)
    enterSession(bundle, "s1")

    dispatchPartUpdated(bundle, worktreeToolPart("worktree_create", "integ", "feat"))
    dispatchPartUpdated(bundle, worktreeToolPart("worktree_create", "integ", "fix"))

    clickWorktreeLabel(bundle)

    expect(bundle.replacements).toHaveLength(1)
    const dialog = bundle.replacements[0].render() as {
      props: { title: string; options: DialogOption[] }
    }
    expect(dialog.props.title).toBe("Active worktrees")
    const worktreeRoot = path.join(os.homedir(), ".local", "state", "opencode", "worktrees")
    expect(dialog.props.options).toEqual([
      {
        title: "integ-feat",
        value: "integ-feat",
        description: path.join(worktreeRoot, "integ-feat"),
      },
      { title: "integ-fix", value: "integ-fix", description: path.join(worktreeRoot, "integ-fix") },
    ])
  })

  it("opens a dialog with the session directory when no worktree is active", async () => {
    const bundle = mockApi({ branch: "main", directory: "/Users/test/src/git/config" })
    await activate(bundle)
    enterSession(bundle, "s1")

    clickWorktreeLabel(bundle)

    const dialog = bundle.replacements[0].render() as {
      props: { title: string; options: DialogOption[] }
    }
    expect(dialog.props.options).toEqual([
      {
        title: "config",
        value: "/Users/test/src/git/config",
        description: "/Users/test/src/git/config",
      },
    ])
  })

  it("copies the selected worktree path to the clipboard, confirms via toast, and closes the dialog", async () => {
    const bundle = mockApi({ branch: "main" })
    await activate(bundle)
    enterSession(bundle, "s1")

    dispatchPartUpdated(bundle, worktreeToolPart("worktree_create", "integ", "feat"))
    clickWorktreeLabel(bundle)
    expect(bundle.replacements).toHaveLength(1)

    const worktreePath = path.join(
      os.homedir(),
      ".local",
      "state",
      "opencode",
      "worktrees",
      "integ-feat",
    )
    const dialog = bundle.replacements[0].render() as {
      props: { onSelect?: (option: DialogOption) => void }
    }
    dialog.props.onSelect?.({
      title: "integ-feat",
      value: "integ-feat",
      description: worktreePath,
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mockedCopy).toHaveBeenCalledWith(worktreePath)
    expect(bundle.toasts).toEqual([
      {
        variant: "success",
        title: "integ-feat",
        message: `Copied to clipboard: ${worktreePath}`,
      },
    ])
    expect(bundle.replacements).toHaveLength(0)
  })

  it("warns via toast when the clipboard copy fails", async () => {
    const bundle = mockApi({ branch: "main" })
    await activate(bundle)
    enterSession(bundle, "s1")

    dispatchPartUpdated(bundle, worktreeToolPart("worktree_create", "integ", "feat"))
    clickWorktreeLabel(bundle)

    mockedCopy.mockResolvedValue(
      left({ kind: "clipboard-unavailable", tried: ["pbcopy"], stderr: "boom" }),
    )
    const dialog = bundle.replacements[0].render() as {
      props: { onSelect?: (option: DialogOption) => void }
    }
    dialog.props.onSelect?.({
      title: "integ-feat",
      value: "integ-feat",
      description: "/tmp/wt/integ-feat",
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(bundle.toasts[0]?.variant).toBe("warning")
    expect(bundle.toasts[0]?.message).toContain("pbcopy")
    expect(bundle.replacements).toHaveLength(0)
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
