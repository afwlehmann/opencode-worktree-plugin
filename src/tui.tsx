import { createMemo, Show } from "solid-js"
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import type { PluginOptions } from "./types.js"
import { resolveOptions } from "./types.js"
import { isDefaultTitle } from "./lib/title.js"
import { hasFlakeNix } from "./lib/git-env.js"

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

  const theme = createMemo(() => api.theme.current)

  const sessionID = createMemo(() => {
    const route = api.route.current
    if (route.name !== "session") return undefined
    return route.params?.sessionID
  })

  const sessionTitle = createMemo(() => {
    const sid = sessionID()
    if (!sid) return undefined
    const session = api.state.session.get(sid)
    return session?.title && !isDefaultTitle(session.title) ? session.title : undefined
  })

  const branch = createMemo(() => api.state.vcs?.branch ?? "unknown")

  const dir = createMemo(() => api.state.path.directory)

  const worktreeName = createMemo(() => {
    const d = dir()
    const parts = d.split("/")
    return parts[parts.length - 1] ?? d
  })

  const statusText = createMemo(() => {
    const sid = sessionID()
    if (!sid) return ""
    const status = api.state.session.status(sid)
    return status ?? ""
  })

  api.slots.register({
    order: 100,
    slots: {
      app_bottom: () => {
        const t = theme()
        return (
          <box
            width="100%"
            flexDirection="row"
            gap={2}
            paddingLeft={1}
            paddingRight={1}
            flexShrink={0}
          >
            <text fg={t.textMuted}>
              {worktreeName()}-{branch()}
            </text>
            <text fg={t.textMuted}>::</text>
            <Show when={sessionTitle()} fallback={<text fg={t.textMuted}>Untitled session</text>}>
              {(title) => <text fg={t.text}>{title()}</text>}
            </Show>
            <Show when={statusText()}>{(status) => <text fg={t.info}>[{status()}]</text>}</Show>
            <box flexGrow={1} />
            <Show when={opts.preferNixDevelop && flakePresent}>
              <text fg={t.accent}>nix</text>
            </Show>
          </box>
        )
      },
    },
  })

  api.event.on("session.updated", () => {
    void sessionTitle()
  })
}

const tuiModule: TuiPluginModule = {
  id: "opencode-worktree-plugin",
  tui: tuiPlugin,
}

export default tuiModule
