import type { TuiPluginModule } from "@opencode-ai/plugin/tui"

/**
 * Static declaration for the TUI entry point. `tsc` and the dts build exclude
 * `src/tui.tsx` (solid-js vs @opencode-ai/plugin JSX namespace conflict), so
 * the package's `./tui` export types resolve to this hand-written declaration.
 */
declare const tuiModule: TuiPluginModule

export default tuiModule
