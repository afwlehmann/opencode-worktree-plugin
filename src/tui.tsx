import { createSignal } from "solid-js"
import type { JSX } from "@opentui/solid"
import * as path from "node:path"
import type { Message, Part } from "@opencode-ai/sdk/v2"
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import type { PluginOptions } from "./types.js"
import { isLeft, resolveOptions, toErrorMessage } from "./types.js"
import { copyToClipboard } from "./lib/clipboard.js"
import { createLogger } from "./lib/logger.js"
import { resolveWorktreeRoot } from "./lib/paths.js"
import { defaultExists, defaultSpawn } from "./lib/git-env.js"
import { defaultStat, latestWorktree } from "./lib/worktree-recency.js"
import { currentWorktreeEntries } from "./lib/current-worktree.js"
import { formatWorktreeEntries } from "./lib/status-label.js"
import {
  activeWorktrees,
  closedWorktreeNames,
  collectWorktreeCalls,
  extractWorktreeCalls,
  recordWorktreeCall,
  type WorktreeToolCall,
} from "./lib/active-worktree.js"

const MAX_SEED_MESSAGES = 200

const tuiPlugin: TuiPlugin = async (api, options) => {
  const opts = resolveOptions(options as PluginOptions | undefined)
  const worktreeRoot = await resolveWorktreeRoot(defaultExists)
  const logger = createLogger(
    {
      app: {
        log: (input) => api.client.app.log(input.body),
      },
    },
    "opencode-worktree-plugin",
  )

  const showPrompt = opts.labelPlacement === "prompt" || opts.labelPlacement === "both"
  const showSidebar = opts.labelPlacement === "sidebar" || opts.labelPlacement === "both"

  const seedCache = new Map<
    string,
    { readonly calls: readonly WorktreeToolCall[]; readonly messageCount: number }
  >()
  const eventCallsBySession = new Map<string, readonly WorktreeToolCall[]>()

  const reseedCalls = (sid: string, messages: readonly Message[]): readonly WorktreeToolCall[] => {
    const calls = collectWorktreeCalls(
      messages.slice(-MAX_SEED_MESSAGES),
      (messageID) => api.state.part(messageID) as readonly Part[],
    )
    seedCache.set(sid, { calls, messageCount: messages.length })
    return calls
  }

  const sessionCalls = (sid: string | undefined): readonly WorktreeToolCall[] => {
    if (sid === undefined) return []
    const messages: readonly Message[] = api.state.session.messages(sid)
    const cached = seedCache.get(sid)
    const seed =
      cached !== undefined && cached.messageCount === messages.length
        ? cached.calls
        : reseedCalls(sid, messages)
    return [...seed, ...(eventCallsBySession.get(sid) ?? [])]
  }

  const [recencyByRepo, setRecencyByRepo] = createSignal<ReadonlyMap<string, string | undefined>>(
    new Map(),
  )
  let scanKey: string | undefined = undefined

  const ensureRecency = (repoPath: string): void => {
    if (scanKey === repoPath || recencyByRepo().has(repoPath)) return
    scanKey = repoPath
    void latestWorktree(
      { stat: defaultStat, exists: defaultExists, spawn: defaultSpawn },
      { preferNixDevelop: opts.preferNixDevelop },
      worktreeRoot,
      repoPath,
    ).then((result) => {
      if (scanKey !== repoPath) return
      if (isLeft(result)) {
        void logger.log("warn", `Worktree recency scan failed: ${toErrorMessage(result.failure)}`)
      }
      const next = new Map(recencyByRepo())
      next.set(repoPath, isLeft(result) ? undefined : result.success)
      setRecencyByRepo(next)
    })
  }

  const labelEntries = (sid: string | undefined): readonly string[] => {
    const calls = sessionCalls(sid)
    const sessionDirectory = sid === undefined ? undefined : api.state.session.get(sid)?.directory
    const repoPath = sessionDirectory ?? api.state.path.directory
    ensureRecency(repoPath)
    return currentWorktreeEntries({
      active: activeWorktrees(calls),
      closedNames: closedWorktreeNames(calls),
      sessionDirectory,
      worktreeRoot,
      recencyName: recencyByRepo().get(repoPath),
    })
  }

  const copyWorktreePath = async (name: string, target: string): Promise<void> => {
    const result = await copyToClipboard(target)
    if (isLeft(result)) {
      api.ui.toast({
        variant: "warning",
        title: name,
        message: toErrorMessage(result.failure),
      })
    } else {
      api.ui.toast({
        variant: "success",
        title: name,
        message: `Copied to clipboard: ${target}`,
      })
    }
  }

  const handleWorktreeSelect = async (option: {
    readonly title: string
    readonly description?: string
  }): Promise<void> => {
    await copyWorktreePath(option.title, option.description ?? option.title)
    api.ui.dialog.clear()
  }

  const openWorktreeDialog = (sid: string | undefined): void => {
    const entries = labelEntries(sid)
    if (entries.length === 0) return
    const options = entries.map((name) => ({
      title: name,
      value: name,
      description: path.join(worktreeRoot, name),
    }))
    api.ui.dialog.replace(() =>
      api.ui.DialogSelect<string>({
        title: "Active worktrees",
        placeholder: "worktrees",
        options,
        onSelect: (option) => void handleWorktreeSelect(option),
      }),
    )
  }

  const [collapsed, setCollapsed] = createSignal(false)
  const toggleCollapsed = (): void => {
    setCollapsed(!collapsed())
  }

  const renderPromptChip = (sid: string | undefined): JSX.Element => {
    const entries = labelEntries(sid)
    if (entries.length === 0) return null
    const t = api.theme.current
    return (
      <text fg={t.accent} wrapMode="none" truncate onMouseUp={() => openWorktreeDialog(sid)}>
        {formatWorktreeEntries(entries)}
      </text>
    )
  }

  const renderSidebarSection = (sid: string | undefined): JSX.Element => {
    const entries = labelEntries(sid)
    if (entries.length === 0) return null
    const t = api.theme.current
    const collapsible = entries.length > 2
    const isCollapsed = collapsible && collapsed()
    const headerText = collapsible ? `Git Worktrees ${isCollapsed ? "▶" : "▼"}` : "Git Worktrees"
    const header = collapsible ? (
      <text fg={t.text} onMouseUp={toggleCollapsed}>
        <b>{headerText}</b>
      </text>
    ) : (
      <text fg={t.text}>
        <b>Git Worktrees</b>
      </text>
    )
    return (
      <box flexDirection="column">
        {header}
        {isCollapsed
          ? null
          : entries.map((name) => (
              <text
                fg={t.accent}
                onMouseUp={() => void copyWorktreePath(name, path.join(worktreeRoot, name))}
              >
                {name}
              </text>
            ))}
      </box>
    )
  }

  if (showPrompt) {
    api.slots.register({
      order: 100,
      slots: {
        session_prompt_right: (_ctx, props) => renderPromptChip(props.session_id),
        home_prompt_right: () => renderPromptChip(undefined),
      },
    })
  }

  if (showSidebar) {
    api.slots.register({
      order: 550,
      slots: {
        sidebar_content: (_ctx, props) => renderSidebarSection(props.session_id),
      },
    })
  }

  api.event.on("message.part.updated", (event) => {
    const part = event.properties.part as Part & { sessionID?: string }
    const sid = part.sessionID
    if (sid === undefined) return
    const calls = extractWorktreeCalls([part])
    if (calls.length === 0) return
    const recorded = eventCallsBySession.get(sid) ?? []
    eventCallsBySession.set(sid, calls.reduce(recordWorktreeCall, recorded))
  })

  api.event.on("message.part.removed", (event) => {
    const sid = (event.properties as { sessionID?: string }).sessionID
    if (sid === undefined) return
    seedCache.delete(sid)
    eventCallsBySession.delete(sid)
  })
}

const tuiModule: TuiPluginModule = {
  id: "opencode-worktree-plugin",
  tui: tuiPlugin,
}

export default tuiModule
