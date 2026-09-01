import { defineConfig } from "vite"
import dts from "vite-plugin-dts"

export default defineConfig({
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "@opentui/solid",
  },
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
        "@opentui/core",
        "@opentui/solid",
        "@opentui/solid/jsx-runtime",
        "solid-js",
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
