import { defineConfig } from "vite"
import dts from "vite-plugin-dts"

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: "src/index.ts",
        tui: "src/tui.tsx",
      },
      formats: ["es"],
    },
    rollupOptions: {
      external: [
        "node:fs/promises",
        "node:path",
        "node:os",
        "@opencode-ai/plugin",
        "@opencode-ai/plugin/tool",
        "@opencode-ai/plugin/tui",
        "@opencode-ai/sdk",
        "@opentui/core",
        "@opentui/solid",
        "solid-js",
        "bun",
      ],
    },
    minify: false,
    sourcemap: true,
  },
  plugins: [
    dts({
      rollupTypes: false,
      include: ["src"],
      exclude: ["src/**/*.test.ts", "src/tui.tsx"],
    }),
  ],
})
