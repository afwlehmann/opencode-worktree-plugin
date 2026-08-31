import type { Plugin, PluginModule } from "@opencode-ai/plugin"
import type { PluginOptions } from "./types.js"
import { resolveOptions, isLeft } from "./types.js"
import { createWorktreeTool } from "./tools/create-worktree.js"
import { mergeWorktreeTool } from "./tools/merge-worktree.js"
import { removeWorktreeTool } from "./tools/remove-worktree.js"
import { defaultSpawn, defaultExists, ensureGitAvailable, findGitOnPath } from "./lib/git-env.js"
import { isActiveWorktreePath } from "./lib/permissions.js"
import * as fs from "node:fs/promises"

const activeWorktrees = new Set<string>()

const serverPlugin: Plugin = async ({ client }, options) => {
  const opts = resolveOptions(options as PluginOptions | undefined)

  const gitCheck = await ensureGitAvailable(opts, defaultExists, defaultSpawn)
  if (isLeft(gitCheck)) {
    await client.app.log({
      body: {
        service: "opencode-worktree-plugin",
        level: "error",
        message: `git not found: ${
          gitCheck.failure.kind === "git-not-found"
            ? gitCheck.failure.searchedPaths.join(", ")
            : "unknown error"
        }`,
        extra: {},
      },
    })
  }

  return {
    tool: {
      worktree_create: createWorktreeTool({
        spawn: defaultSpawn,
        exists: defaultExists,
        mkdir: async (path, mkdirOpts) => {
          await fs.mkdir(path, { recursive: mkdirOpts.recursive })
        },
        options: opts,
        activeWorktrees,
      }),
      worktree_merge: mergeWorktreeTool({
        spawn: defaultSpawn,
        exists: defaultExists,
        options: opts,
        activeWorktrees,
      }),
      worktree_remove: removeWorktreeTool({
        spawn: defaultSpawn,
        exists: defaultExists,
        options: opts,
        activeWorktrees,
      }),
    },

    "permission.ask": async (input, output) => {
      if (input.type !== "external_directory") return
      const patterns = Array.isArray(input.pattern) ? input.pattern : [input.pattern ?? ""]
      if (patterns.some((p) => isActiveWorktreePath(p, activeWorktrees))) {
        output.status = "allow"
      }
    },

    "shell.env": async (_input, output) => {
      if (!opts.preferNixDevelop) return

      const nixDir = await findGitOnPath(defaultExists)
      if (nixDir) {
        const nixPath = `${nixDir}:${output.env["PATH"] ?? process.env["PATH"] ?? ""}`
        output.env = { ...output.env, PATH: nixPath }
      }
    },

    event: async () => {},
  }
}

const serverModule: PluginModule = {
  id: "opencode-worktree-plugin",
  server: serverPlugin,
}

export default serverModule
