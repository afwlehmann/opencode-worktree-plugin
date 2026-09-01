import type { Plugin, PluginModule } from "@opencode-ai/plugin"
import type { PluginOptions } from "./types.js"
import { resolveOptions, isLeft } from "./types.js"
import { createWorktreeTool } from "./tools/create-worktree.js"
import { mergeWorktreeTool } from "./tools/merge-worktree.js"
import { removeWorktreeTool } from "./tools/remove-worktree.js"
import {
  defaultSpawn,
  defaultExists,
  ensureGitAvailable,
  findGitOnPath,
  hasFlakeNix,
} from "./lib/git-env.js"
import { isInsideWorktreeRoot, addWorktreeRootAllow } from "./lib/permissions.js"
import { getWorktreeRoot, resolveWorktreeRoot } from "./lib/paths.js"
import { WORKTREE_DIRECTIVE } from "./lib/directive.js"
import * as fs from "node:fs/promises"

const serverPlugin: Plugin = async ({ client, directory }, options) => {
  const opts = resolveOptions(options as PluginOptions | undefined)

  const unresolvedRoot = getWorktreeRoot()
  const resolvedRoot = await resolveWorktreeRoot(defaultExists)
  const worktreeRoots =
    unresolvedRoot === resolvedRoot ? [unresolvedRoot] : [unresolvedRoot, resolvedRoot]

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
        client,
      }),
      worktree_merge: mergeWorktreeTool({
        spawn: defaultSpawn,
        exists: defaultExists,
        options: opts,
        client,
      }),
      worktree_remove: removeWorktreeTool({
        spawn: defaultSpawn,
        exists: defaultExists,
        options: opts,
        client,
      }),
    },

    config: async (config) => {
      addWorktreeRootAllow(config, worktreeRoots)
    },

    "permission.ask": async (input, output) => {
      if (input.type !== "external_directory") return
      const patterns = Array.isArray(input.pattern) ? input.pattern : [input.pattern ?? ""]
      const insideRoot = patterns.some((pattern) =>
        worktreeRoots.some((root) => isInsideWorktreeRoot(pattern, root)),
      )
      if (insideRoot) output.status = "allow"
    },

    "shell.env": async (_input, output) => {
      if (!opts.preferNixDevelop) return

      let flakePresent = false
      try {
        flakePresent = await hasFlakeNix(directory, defaultExists)
      } catch {
        flakePresent = false
      }
      if (!flakePresent) return

      const nixDir = await findGitOnPath(defaultExists)
      if (nixDir) {
        const nixPath = `${nixDir}:${output.env["PATH"] ?? process.env["PATH"] ?? ""}`
        output.env = { ...output.env, PATH: nixPath }
      }
    },

    "experimental.chat.system.transform": async (_input, output) => {
      output.system = [...output.system, WORKTREE_DIRECTIVE]
    },

    event: async () => {},
  }
}

const serverModule: PluginModule = {
  id: "opencode-worktree-plugin",
  server: serverPlugin,
}

export default serverModule
