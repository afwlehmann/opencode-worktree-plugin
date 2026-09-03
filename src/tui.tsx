import { Show } from "solid-js"
import * as path from "node:path"
import type { Message, Part } from "@opencode-ai/sdk/v2"
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import type { PluginOptions } from "./types.js"
import { resolveOptions } from "./types.js"
import { hasFlakeNix } from "./lib/git-env.js"
import { copyToClipboard } from "./lib/clipboard.js"
import { isLeft, toErrorMessage } from "./types.js"
import { getWorktreeRoot } from "./lib/paths.js"
import {
  activeWorktreesFrom,
  collectWorktreeCalls,
  extractWorktreeCalls,
  recordWorktreeCall,
  type ActiveWorktree,
  type WorktreeToolCall,
} from "./lib/active-worktree.js"
import { formatSessionStatusLabel, formatSessionStatus } from "./lib/status-label.js"

const MAX_SEED_MESSAGES = 200

const defaultExists = async (filePath: string): Promise<boolean> => {
  try {
    const fs = await import("node:fs/promises")
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

const tuiPlugin: TuiPlugin = async (api, options) => {
  const opts = resolveOptions(options as PluginOptions | undefined)

  let flakePresent = false
  try {
    flakePresent = await hasFlakeNix(api.state.path.directory, defaultExists)
  } catch {
    flakePresent = false
  }

  const worktreeRoot = getWorktreeRoot()

  let seedCalls: readonly WorktreeToolCall[] = []
  let eventCalls: readonly WorktreeToolCall[] = []
  let seedSession: string | undefined = undefined
  let seedMessageCount = -1
  let eventSession: string | undefined = undefined

  const seedCallsForSession = (sid: string, messages: readonly Message[]): void => {
    seedCalls = collectWorktreeCalls(
      messages.slice(-MAX_SEED_MESSAGES),
      (messageID) => api.state.part(messageID) as readonly Part[],
    )
    seedSession = sid
    seedMessageCount = messages.length
  }

  const ensureWorktreeEntries = (sid: string | undefined): readonly ActiveWorktree[] => {
    if (sid === undefined) return []
    const messages: readonly Message[] = api.state.session.messages(sid)
    if (seedSession !== sid || messages.length !== seedMessageCount)
      seedCallsForSession(sid, messages)
    if (eventSession !== sid) {
      eventCalls = []
      eventSession = sid
    }
    return activeWorktreesFrom(seedCalls, eventCalls)
  }

  const currentSessionID = (): string | undefined => {
    const route = api.route.current
    if (route.name !== "session") return undefined
    return route.params?.sessionID
  }

  const currentStatusText = (): string => {
    const sid = currentSessionID()
    if (!sid) return ""
    return formatSessionStatus(api.state.session.status(sid))
  }

  const currentStatusLabel = (): string => {
    const entries = ensureWorktreeEntries(currentSessionID())
    return formatSessionStatusLabel(
      api.state.path.directory,
      api.state.vcs?.branch,
      worktreeRoot,
      entries,
    )
  }

  const handleWorktreeSelect = async (option: {
    readonly title: string
    readonly description?: string
  }): Promise<void> => {
    const target = option.description ?? option.title
    const result = await copyToClipboard(target)
    if (isLeft(result)) {
      api.ui.toast({
        variant: "warning",
        title: option.title,
        message: toErrorMessage(result.failure),
      })
    } else {
      api.ui.toast({
        variant: "success",
        title: option.title,
        message: `Copied to clipboard: ${target}`,
      })
    }
    api.ui.dialog.clear()
  }

  const openWorktreeDialog = (): void => {
    const entries = ensureWorktreeEntries(currentSessionID())
    const options =
      entries.length > 0
        ? entries.map((name) => ({
            title: name,
            value: name,
            description: path.join(worktreeRoot, name),
          }))
        : [
            {
              title: path.basename(api.state.path.directory),
              value: api.state.path.directory,
              description: api.state.path.directory,
            },
          ]
    api.ui.dialog.replace(() =>
      api.ui.DialogSelect<string>({
        title: "Active worktrees",
        placeholder: "worktrees",
        options,
        onSelect: (option) => void handleWorktreeSelect(option),
      }),
    )
  }

  api.slots.register({
    order: 100,
    slots: {
      app_bottom: () => {
        const t = api.theme.current
        return (
          <box
            width="100%"
            flexDirection="row"
            gap={2}
            paddingLeft={1}
            paddingRight={1}
            flexShrink={0}
          >
            <text fg={t.textMuted} onMouseUp={openWorktreeDialog}>
              {currentStatusLabel()} ▾
            </text>
            <Show when={currentStatusText()}>
              {(status) => <text fg={t.info}>[{status()}]</text>}
            </Show>
            <box flexGrow={1} />
            <Show when={opts.preferNixDevelop && flakePresent}>
              <text fg={t.accent}>nix</text>
            </Show>
          </box>
        )
      },
    },
  })

  api.event.on("message.part.updated", (event) => {
    const sid = currentSessionID()
    const partSessionID = (event.properties.part as { sessionID?: string }).sessionID
    if (sid === undefined || partSessionID !== sid) return
    const calls = extractWorktreeCalls([event.properties.part as Part])
    if (calls.length === 0) return
    if (eventSession !== sid) {
      eventCalls = []
      eventSession = sid
    }
    eventCalls = calls.reduce(recordWorktreeCall, eventCalls)
  })

  api.event.on("message.part.removed", (event) => {
    const sid = currentSessionID()
    if (sid === undefined || event.properties.sessionID !== sid) return
    if (seedSession === sid) seedSession = undefined
    if (eventSession === sid) {
      eventCalls = []
      eventSession = undefined
    }
  })
}

const tuiModule: TuiPluginModule = {
  id: "opencode-worktree-plugin",
  tui: tuiPlugin,
}

export default tuiModule
