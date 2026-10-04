import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest"
import * as path from "node:path"
import * as os from "node:os"
import type { Message, Part } from "@opencode-ai/sdk/v2"
import type { TuiPluginModule } from "@opencode-ai/plugin/tui"
import { copyToClipboard } from "./lib/clipboard.js"
import { latestWorktree } from "./lib/worktree-recency.js"
import { defaultExists } from "./lib/git-env.js"
import { resolveWorktreeRoot } from "./lib/paths.js"
import type { PluginOptions } from "./types.js"
import { left, right } from "./types.js"
import tuiModule from "./tui.js"

vi.mock("./lib/clipboard.js", () => ({ copyToClipboard: vi.fn() }))
vi.mock("./lib/worktree-recency.js", () => ({ latestWorktree: vi.fn(), defaultStat: vi.fn() }))

const mockedCopy = vi.mocked(copyToClipboard)
const mockedLatest = vi.mocked(latestWorktree)

const TEST_STATE_HOME = path.join(os.tmpdir(), "wt-tui-test-state")
let worktreeRoot = ""

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

type MockSession = { directory: string }

type MockApi = {
  theme: { current: Record<string, string> }
  state: {
    path: { directory: string }
    session: {
      get: (sessionID: string) => MockSession | undefined
      messages: (sessionID: string) => readonly Message[]
    }
    part: (messageID: string) => readonly Part[]
  }
  slots: { register: (registration: SlotRegistration) => void }
  event: { on: (name: string, handler: (event: never) => void) => void }
  client: { app: { log: (input: unknown) => Promise<void> } }
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
  sessionMessages: Message[]
  replacements: Array<{ render: () => unknown; onClose?: () => void }>
  toasts: ToastInput[]
  logInputs: unknown[]
}

type MockApiOptions = {
  directory?: string
  sessions?: Record<string, MockSession>
}

const mockApi = ({
  directory = "/tmp/wt-wiring-does-not-exist",
  sessions = {},
}: MockApiOptions = {}): MockApiBundle => {
  const registrations: SlotRegistration[] = []
  const handlers: Record<string, (event: never) => void> = {}
  const parts: Part[] = []
  const replacements: Array<{ render: () => unknown; onClose?: () => void }> = []
  const toasts: ToastInput[] = []
  const logInputs: unknown[] = []
  const sessionMessage: Message = { id: "m1", role: "assistant" } as unknown as Message
  const sessionMessages: Message[] = [sessionMessage]
  const api: MockApi = {
    theme: { current: { accent: "#00aaff", text: "#eeeeee" } },
    state: {
      path: { directory },
      session: {
        get: (sessionID: string) => sessions[sessionID],
        messages: (sessionID: string) => (sessionID === "s1" ? sessionMessages : []),
      },
      part: (messageID: string) => parts.filter((part) => part.messageID === messageID),
    },
    slots: { register: (registration: SlotRegistration) => registrations.push(registration) },
    event: { on: (name: string, handler: (event: never) => void) => (handlers[name] = handler) },
    client: {
      app: {
        log: (input: unknown) => {
          logInputs.push(input)
          return Promise.resolve()
        },
      },
    },
    ui: {
      dialog: {
        replace: (render: () => unknown, onClose?: () => void) => {
          replacements.push({ render, onClose })
        },
        clear: () => {
          replacements.length = 0
        },
      },
      toast: (input: ToastInput) => {
        toasts.push(input)
      },
      DialogSelect: (props: {
        title: string
        options: Array<DialogOption & { onSelect?: () => void }>
        onSelect?: (option: DialogOption) => void
      }) => ({ props }) as never,
    },
  }
  return { api, registrations, handlers, parts, sessionMessages, replacements, toasts, logInputs }
}

const activate = async (bundle: MockApiBundle, options?: PluginOptions): Promise<void> => {
  const module = tuiModule as TuiPluginModule
  await module.tui(bundle.api as never, (options ?? undefined) as never)
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

const dispatchPartRemoved = (bundle: MockApiBundle, sessionID: string): void => {
  bundle.handlers["message.part.removed"]?.({ properties: { sessionID } } as never)
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

const findAllNodes = (node: unknown, predicate: (node: object) => boolean): object[] => {
  if (Array.isArray(node)) return node.flatMap((child) => findAllNodes(child, predicate))
  if (typeof node === "object" && node !== null) {
    const self = predicate(node) ? [node] : []
    const children = (node as { children?: unknown }).children
    return [...self, ...(children === undefined ? [] : findAllNodes(children, predicate))]
  }
  return []
}

const findNode = (node: unknown, predicate: (node: object) => boolean): object | undefined =>
  findAllNodes(node, predicate)[0]

const registrationWith = (bundle: MockApiBundle, slot: string): SlotRegistration => {
  const registration = bundle.registrations.find((candidate) => slot in candidate.slots)
  expect(registration).toBeDefined()
  return registration as SlotRegistration
}

const renderSessionChip = (bundle: MockApiBundle, sessionID = "s1"): unknown =>
  (
    registrationWith(bundle, "session_prompt_right").slots["session_prompt_right"] as (
      ctx: unknown,
      props: { session_id: string },
    ) => unknown
  )(undefined, { session_id: sessionID })

const renderHomeChip = (bundle: MockApiBundle): unknown =>
  (registrationWith(bundle, "home_prompt_right").slots["home_prompt_right"] as () => unknown)()

const renderSidebarSection = (bundle: MockApiBundle, sessionID = "s1"): unknown =>
  (
    registrationWith(bundle, "sidebar_content").slots["sidebar_content"] as (
      ctx: unknown,
      props: { session_id: string },
    ) => unknown
  )(undefined, { session_id: sessionID })

const chipLabel = (bundle: MockApiBundle, sessionID = "s1"): string =>
  collectStrings(renderSessionChip(bundle, sessionID)).join(" ")

const sidebarLabel = (bundle: MockApiBundle, sessionID = "s1"): string =>
  collectStrings(renderSidebarSection(bundle, sessionID)).join(" ")

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

const clickNode = (
  bundle: MockApiBundle,
  rendered: unknown,
  predicate: (node: object) => boolean,
): void => {
  const node = findNode(rendered, predicate)
  expect(node).toBeDefined()
  const props = (node as { props: Record<string, unknown> }).props
  ;(props?.["onMouseUp"] as () => void)()
}

const clickWorktreeChip = (bundle: MockApiBundle, sessionID = "s1"): void => {
  clickNode(bundle, renderSessionChip(bundle, sessionID), (node) => {
    const props = (node as { props?: Record<string, unknown> }).props
    return typeof props?.["onMouseUp"] === "function"
  })
}

describe("tui plugin wiring (mock api)", () => {
  beforeAll(async () => {
    process.env["XDG_STATE_HOME"] = TEST_STATE_HOME
    worktreeRoot = await resolveWorktreeRoot(defaultExists)
  })

  beforeEach(() => {
    process.env["XDG_STATE_HOME"] = TEST_STATE_HOME
    mockedCopy.mockReset()
    mockedCopy.mockResolvedValue(right(undefined))
    mockedLatest.mockReset()
    mockedLatest.mockResolvedValue(right(undefined))
  })

  afterEach(() => {
    delete process.env["XDG_STATE_HOME"]
  })

  describe("slot registration by label placement", () => {
    it("registers the prompt slots by default", async () => {
      const bundle = mockApi()
      await activate(bundle)

      expect(bundle.registrations).toHaveLength(1)
      expect(bundle.registrations[0]?.order).toBe(100)
      expect(Object.keys(bundle.registrations[0]?.slots ?? {})).toEqual([
        "session_prompt_right",
        "home_prompt_right",
      ])
    })

    it("registers only the sidebar slot for the sidebar placement", async () => {
      const bundle = mockApi()
      await activate(bundle, { labelPlacement: "sidebar" })

      expect(bundle.registrations).toHaveLength(1)
      expect(bundle.registrations[0]?.order).toBe(550)
      expect(Object.keys(bundle.registrations[0]?.slots ?? {})).toEqual(["sidebar_content"])
    })

    it("registers both prompt and sidebar slots for the both placement", async () => {
      const bundle = mockApi()
      await activate(bundle, { labelPlacement: "both" })

      expect(bundle.registrations).toHaveLength(2)
      expect(bundle.registrations[0]?.order).toBe(100)
      expect(Object.keys(bundle.registrations[0]?.slots ?? {})).toEqual([
        "session_prompt_right",
        "home_prompt_right",
      ])
      expect(bundle.registrations[1]?.order).toBe(550)
      expect(Object.keys(bundle.registrations[1]?.slots ?? {})).toEqual(["sidebar_content"])
    })

    it("registers nothing for the none placement", async () => {
      const bundle = mockApi()
      await activate(bundle, { labelPlacement: "none" })

      expect(bundle.registrations).toHaveLength(0)
    })
  })

  describe("event subscriptions", () => {
    it("subscribes to the events driving worktree state", async () => {
      const bundle = mockApi()
      await activate(bundle)

      expect(bundle.handlers["message.part.updated"]).toBeDefined()
      expect(bundle.handlers["message.part.removed"]).toBeDefined()
    })
  })

  describe("prompt chip", () => {
    it("renders nothing when no worktree qualifies", async () => {
      const bundle = mockApi({ directory: "/Users/test/src/git/config" })
      await activate(bundle)

      expect(renderSessionChip(bundle)).toBeNull()
      expect(renderHomeChip(bundle)).toBeNull()
    })

    it("renders the worktree name after a worktree_create tool call", async () => {
      const bundle = mockApi()
      await activate(bundle)

      dispatchPartUpdated(bundle, worktreeToolPart("worktree_create", "integ", "feat-e2e"))

      const rendered = renderSessionChip(bundle)
      expect(chipLabel(bundle)).toContain("integ-feat-e2e")
      const chip = findNode(rendered, (node) => {
        const props = (node as { props?: Record<string, unknown> }).props
        return typeof props?.["onMouseUp"] === "function"
      })
      const props = (chip as { props: Record<string, unknown> }).props
      expect(props["wrapMode"]).toBe("none")
      expect(props["truncate"]).toBe(true)
    })

    it("renders the latest worktree with a count for several concurrently active ones", async () => {
      const bundle = mockApi()
      await activate(bundle)

      dispatchPartUpdated(bundle, worktreeToolPart("worktree_create", "integ", "feat"))
      dispatchPartUpdated(bundle, worktreeToolPart("worktree_create", "integ", "fix"))

      expect(chipLabel(bundle)).toContain("integ-fix (2)")
    })

    it("renders nothing after the last worktree was merged", async () => {
      const bundle = mockApi({ directory: "/Users/test/src/git/config" })
      await activate(bundle)

      dispatchPartUpdated(bundle, worktreeToolPart("worktree_create", "integ", "feat"))
      dispatchPartUpdated(bundle, worktreeToolPart("worktree_merge", "integ", "feat"))

      expect(renderSessionChip(bundle)).toBeNull()
    })

    it("derives the label from history when the part predates the first render", async () => {
      const bundle = mockApi()
      await activate(bundle)
      bundle.parts.push(worktreeToolPart("worktree_create", "integ", "older"))

      expect(chipLabel(bundle)).toContain("integ-older")
    })

    it("keeps event-derived entries when the seed scan lags behind the event", async () => {
      const bundle = mockApi()
      await activate(bundle)

      dispatchPartUpdated(bundle, worktreeToolPart("worktree_create", "integ", "lag"), false)

      expect(chipLabel(bundle)).toContain("integ-lag")
    })

    it("keeps event-derived entries across repeated events for the same part", async () => {
      const bundle = mockApi()
      await activate(bundle)

      dispatchPartUpdated(bundle, worktreeToolPart("worktree_create", "integ", "feat"), false)
      dispatchPartUpdated(bundle, worktreeToolPart("worktree_create", "integ", "feat"), false)

      expect(chipLabel(bundle)).toContain("integ-feat")
      expect(chipLabel(bundle)).not.toContain("(")
    })

    it("re-seeds the label when the session history syncs after the first render", async () => {
      const bundle = mockApi()
      await activate(bundle)

      bundle.sessionMessages.length = 0
      expect(renderSessionChip(bundle)).toBeNull()

      bundle.parts.push(worktreeToolPart("worktree_create", "integ", "feat"))
      bundle.sessionMessages.push({ id: "m1", role: "assistant" } as unknown as Message)
      expect(chipLabel(bundle)).toContain("integ-feat")
    })

    it("ignores tool parts belonging to other sessions", async () => {
      const bundle = mockApi()
      await activate(bundle)

      dispatchPartUpdated(
        bundle,
        worktreeToolPart("worktree_create", "integ", "feat", "s-other", "m-other"),
      )

      expect(renderSessionChip(bundle)).toBeNull()
    })

    it("drops all cached state when parts are removed", async () => {
      const bundle = mockApi()
      await activate(bundle)

      dispatchPartUpdated(bundle, worktreeToolPart("worktree_create", "integ", "feat"), false)
      expect(chipLabel(bundle)).toContain("integ-feat")

      dispatchPartRemoved(bundle, "s1")
      expect(renderSessionChip(bundle)).toBeNull()
    })

    it("shows the session directory when the session lives inside a plugin worktree", async () => {
      const bundle = mockApi({
        sessions: { s1: { directory: path.join(worktreeRoot, "integ-session") } },
      })
      await activate(bundle)

      expect(chipLabel(bundle)).toContain("integ-session")
    })

    it("does not resurrect a merged session worktree via the session directory", async () => {
      const bundle = mockApi({
        sessions: { s1: { directory: path.join(worktreeRoot, "integ-feat") } },
      })
      await activate(bundle)

      dispatchPartUpdated(bundle, worktreeToolPart("worktree_merge", "integ", "feat"))

      expect(renderSessionChip(bundle)).toBeNull()
    })
  })

  describe("recency tier", () => {
    it("renders the recency pick once the scan resolves", async () => {
      const bundle = mockApi({ directory: "/Users/test/src/git/config" })
      mockedLatest.mockResolvedValue(right("integ-recency"))
      await activate(bundle)

      expect(renderSessionChip(bundle)).toBeNull()
      await flush()

      expect(chipLabel(bundle)).toContain("integ-recency")
      expect(renderHomeChip(bundle) !== null).toBe(true)
      expect(collectStrings(renderHomeChip(bundle)).join(" ")).toContain("integ-recency")
    })

    it("scans with the session directory and the plugin root", async () => {
      const bundle = mockApi({
        directory: "/Users/test/src/git/config",
        sessions: { s1: { directory: "/Users/test/src/git/integ" } },
      })
      await activate(bundle)

      renderSessionChip(bundle)
      expect(mockedLatest).toHaveBeenCalledTimes(1)
      expect(mockedLatest).toHaveBeenCalledWith(
        expect.objectContaining({
          stat: expect.any(Function),
          exists: expect.any(Function),
          spawn: expect.any(Function),
        }),
        { preferNixDevelop: false },
        worktreeRoot,
        "/Users/test/src/git/integ",
      )
    })

    it("scans once per repo path across renders", async () => {
      const bundle = mockApi()
      await activate(bundle)

      renderSessionChip(bundle)
      renderSessionChip(bundle)
      await flush()
      renderSessionChip(bundle)
      expect(mockedLatest).toHaveBeenCalledTimes(1)
    })

    it("rescans when the repo path changes", async () => {
      const bundle = mockApi({
        sessions: {
          s1: { directory: "/Users/test/src/git/integ" },
          s2: { directory: "/Users/test/src/git/other" },
        },
      })
      await activate(bundle)

      renderSessionChip(bundle, "s1")
      renderSessionChip(bundle, "s2")
      expect(mockedLatest).toHaveBeenCalledTimes(2)
    })

    it("keeps the chip empty, logs a warning, and never rescans when the scan fails", async () => {
      const bundle = mockApi()
      mockedLatest.mockResolvedValue(left({ kind: "git-not-found", searchedPaths: ["/usr/bin"] }))
      await activate(bundle)

      renderSessionChip(bundle)
      await flush()
      renderSessionChip(bundle)

      expect(renderSessionChip(bundle)).toBeNull()
      expect(mockedLatest).toHaveBeenCalledTimes(1)
      expect(bundle.logInputs).toHaveLength(1)
      const logInput = bundle.logInputs[0] as {
        level: string
        message: string
      }
      expect(logInput.level).toBe("warn")
      expect(logInput.message).toContain("git not found")
    })

    it("excludes a recency pick for a worktree merged in this session", async () => {
      const bundle = mockApi({ directory: "/Users/test/src/git/config" })
      mockedLatest.mockResolvedValue(right("integ-feat"))
      await activate(bundle)

      dispatchPartUpdated(bundle, worktreeToolPart("worktree_merge", "integ", "feat"))
      renderSessionChip(bundle)
      await flush()

      expect(renderSessionChip(bundle)).toBeNull()
    })
  })

  describe("worktree dialog", () => {
    it("opens a worktree dialog with absolute paths when the chip is clicked", async () => {
      const bundle = mockApi()
      await activate(bundle)

      dispatchPartUpdated(bundle, worktreeToolPart("worktree_create", "integ", "feat"))
      dispatchPartUpdated(bundle, worktreeToolPart("worktree_create", "integ", "fix"))

      clickWorktreeChip(bundle)

      expect(bundle.replacements).toHaveLength(1)
      const dialog = bundle.replacements[0]?.render() as {
        props: { title: string; options: DialogOption[] }
      }
      expect(dialog.props.title).toBe("Active worktrees")
      expect(dialog.props.options).toEqual([
        {
          title: "integ-feat",
          value: "integ-feat",
          description: path.join(worktreeRoot, "integ-feat"),
        },
        {
          title: "integ-fix",
          value: "integ-fix",
          description: path.join(worktreeRoot, "integ-fix"),
        },
      ])
    })

    it("copies the selected worktree path to the clipboard, confirms via toast, and closes the dialog", async () => {
      const bundle = mockApi()
      await activate(bundle)

      dispatchPartUpdated(bundle, worktreeToolPart("worktree_create", "integ", "feat"))
      clickWorktreeChip(bundle)
      expect(bundle.replacements).toHaveLength(1)

      const worktreePath = path.join(worktreeRoot, "integ-feat")
      const dialog = bundle.replacements[0]?.render() as {
        props: { onSelect?: (option: DialogOption) => void }
      }
      dialog.props.onSelect?.({
        title: "integ-feat",
        value: "integ-feat",
        description: worktreePath,
      })
      await flush()

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
      const bundle = mockApi()
      await activate(bundle)

      dispatchPartUpdated(bundle, worktreeToolPart("worktree_create", "integ", "feat"))
      clickWorktreeChip(bundle)

      mockedCopy.mockResolvedValue(
        left({ kind: "clipboard-unavailable", tried: ["pbcopy"], stderr: "boom" }),
      )
      const dialog = bundle.replacements[0]?.render() as {
        props: { onSelect?: (option: DialogOption) => void }
      }
      dialog.props.onSelect?.({
        title: "integ-feat",
        value: "integ-feat",
        description: path.join(worktreeRoot, "integ-feat"),
      })
      await flush()

      expect(bundle.toasts[0]?.variant).toBe("warning")
      expect(bundle.toasts[0]?.message).toContain("pbcopy")
      expect(bundle.replacements).toHaveLength(0)
    })
  })

  describe("sidebar section", () => {
    it("renders a header and one clickable item per worktree", async () => {
      const bundle = mockApi()
      await activate(bundle, { labelPlacement: "sidebar" })

      dispatchPartUpdated(bundle, worktreeToolPart("worktree_create", "integ", "feat"))
      dispatchPartUpdated(bundle, worktreeToolPart("worktree_create", "integ", "fix"))

      const rendered = renderSidebarSection(bundle)
      expect(collectStrings(rendered).join(" ")).toContain("Git Worktrees")
      expect(collectStrings(rendered).join(" ")).toContain("integ-feat")
      expect(collectStrings(rendered).join(" ")).toContain("integ-fix")
      expect(collectStrings(rendered).join(" ")).not.toContain("▼")
    })

    it("renders nothing when no worktree qualifies", async () => {
      const bundle = mockApi({ directory: "/Users/test/src/git/config" })
      await activate(bundle, { labelPlacement: "sidebar" })

      expect(renderSidebarSection(bundle)).toBeNull()
    })

    it("copies the clicked worktree's path and confirms via toast without a dialog", async () => {
      const bundle = mockApi()
      await activate(bundle, { labelPlacement: "sidebar" })

      dispatchPartUpdated(bundle, worktreeToolPart("worktree_create", "integ", "feat"))
      clickNode(bundle, renderSidebarSection(bundle), (node) => {
        const props = (node as { props?: Record<string, unknown> }).props
        return typeof props?.["onMouseUp"] === "function"
      })
      await flush()

      expect(mockedCopy).toHaveBeenCalledWith(path.join(worktreeRoot, "integ-feat"))
      expect(bundle.toasts).toEqual([
        {
          variant: "success",
          title: "integ-feat",
          message: `Copied to clipboard: ${path.join(worktreeRoot, "integ-feat")}`,
        },
      ])
      expect(bundle.replacements).toHaveLength(0)
    })

    it("collapses and expands the item list via the header when there are more than two items", async () => {
      const bundle = mockApi()
      await activate(bundle, { labelPlacement: "sidebar" })

      dispatchPartUpdated(bundle, worktreeToolPart("worktree_create", "integ", "feat"))
      dispatchPartUpdated(bundle, worktreeToolPart("worktree_create", "integ", "fix"))
      dispatchPartUpdated(bundle, worktreeToolPart("worktree_create", "integ", "chore"))

      const header = (node: object): boolean => {
        const props = (node as { props?: Record<string, unknown> }).props
        return typeof props?.["onMouseUp"] === "function" && props["fg"] === "#eeeeee"
      }
      expect(sidebarLabel(bundle)).toContain("▼")

      clickNode(bundle, renderSidebarSection(bundle), header)
      const collapsedLabel = sidebarLabel(bundle)
      expect(collapsedLabel).toContain("▶")
      expect(collapsedLabel).not.toContain("integ-fix")

      clickNode(bundle, renderSidebarSection(bundle), header)
      const expandedLabel = sidebarLabel(bundle)
      expect(expandedLabel).toContain("▼")
      expect(expandedLabel).toContain("integ-fix")
    })

    it("does not offer a collapse toggle for two or fewer items", async () => {
      const bundle = mockApi()
      await activate(bundle, { labelPlacement: "sidebar" })

      dispatchPartUpdated(bundle, worktreeToolPart("worktree_create", "integ", "feat"))
      dispatchPartUpdated(bundle, worktreeToolPart("worktree_create", "integ", "fix"))

      const clickable = findAllNodes(renderSidebarSection(bundle), (node) => {
        const props = (node as { props?: Record<string, unknown> }).props
        return typeof props?.["onMouseUp"] === "function"
      })
      expect(clickable).toHaveLength(2)
      expect(sidebarLabel(bundle)).not.toContain("▶")
    })
  })
})
