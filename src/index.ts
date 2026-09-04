import type { Plugin, PluginModule } from "@opencode-ai/plugin"
import type { PluginOptions } from "./types.js"
import { resolveOptions, isLeft, toErrorMessage } from "./types.js"
import { createWorktreeTool } from "./tools/create-worktree.js"
import { mergeWorktreeTool } from "./tools/merge-worktree.js"
import { removeWorktreeTool } from "./tools/remove-worktree.js"
import { listWorktreesTool } from "./tools/list-worktrees.js"
import { listWorktrees } from "./lib/worktree.js"
import {
  defaultSpawn,
  defaultExists,
  ensureGitAvailable,
  findGitOnPath,
  hasFlakeNix,
  resolveGitCommand,
} from "./lib/git-env.js"
import {
  isInsideWorktreeRoot,
  isInsideAnyRoot,
  activeWorktreePaths,
  addWorktreeRootAllow,
} from "./lib/permissions.js"
import { pedanticReply, type PermissionAskedProperties } from "./lib/permission-reply.js"
import { getWorktreeRoot, resolveWorktreeRoot } from "./lib/paths.js"
import { worktreeDirective } from "./lib/directive.js"
import { createLogger } from "./lib/logger.js"
import * as fs from "node:fs/promises"

type BusEvent = {
  readonly id?: string
  readonly type?: string
  readonly properties?: unknown
}

const serverPlugin: Plugin = async ({ client, directory }, options) => {
  const opts = resolveOptions(options as PluginOptions | undefined)
  const log = createLogger(client, "opencode-worktree-plugin")

  const unresolvedRoot = getWorktreeRoot()
  const resolvedRoot = await resolveWorktreeRoot(defaultExists)
  const worktreeRoots =
    unresolvedRoot === resolvedRoot ? [unresolvedRoot] : [unresolvedRoot, resolvedRoot]

  const gitCheck = await ensureGitAvailable(opts, defaultExists, defaultSpawn)
  if (isLeft(gitCheck)) {
    await log.log(
      "error",
      `git not found: ${
        gitCheck.failure.kind === "git-not-found"
          ? gitCheck.failure.searchedPaths.join(", ")
          : "unknown error"
      }`,
    )
  }

  const flakePresent = await hasFlakeNix(directory, defaultExists)
  const gitCmd = resolveGitCommand(opts, flakePresent)

  const activeWorktreePathsForRepo = async (): Promise<readonly string[]> => {
    const listResult = await listWorktrees(defaultSpawn, gitCmd, directory)
    if (isLeft(listResult)) return []
    return activeWorktreePaths(listResult.success, worktreeRoots)
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
      worktree_list: listWorktreesTool({
        spawn: defaultSpawn,
        exists: defaultExists,
        options: opts,
        client,
      }),
    },

    config: async (config) => {
      if (opts.permissionMode !== "all-worktrees") return
      addWorktreeRootAllow(config, worktreeRoots)
    },

    "permission.ask": async (input, output) => {
      if (input.type !== "external_directory") return
      const patterns = Array.isArray(input.pattern) ? input.pattern : [input.pattern ?? ""]
      if (patterns.length === 0) return
      if (opts.permissionMode === "all-worktrees") {
        const insideRoot = patterns.some((pattern) => isInsideAnyRoot(pattern, worktreeRoots))
        if (insideRoot) output.status = "allow"
        return
      }
      const active = await activeWorktreePathsForRepo()
      const insideActive = patterns.every((pattern) =>
        active.some((worktreePath) => isInsideWorktreeRoot(pattern, worktreePath)),
      )
      if (insideActive) output.status = "allow"
    },

    event: async (input) => {
      if (opts.permissionMode !== "pedantic") return
      const event = (input as { event?: BusEvent }).event
      if (event?.type !== "permission.asked") return
      const properties = (event.properties ?? undefined) as PermissionAskedProperties | undefined
      if (properties === undefined) {
        await log.log("warn", "pedantic: permission.asked event without properties")
        return
      }

      const listResult = await listWorktrees(defaultSpawn, gitCmd, directory)
      if (isLeft(listResult)) {
        await log.log(
          "warn",
          `pedantic: worktree list unavailable, leaving external_directory request to the user: ${toErrorMessage(listResult.failure)}`,
        )
        return
      }
      const active = activeWorktreePaths(listResult.success, worktreeRoots)
      const reply = pedanticReply(properties, active)
      if (reply === undefined) return

      try {
        const result = await client.postSessionIdPermissionsPermissionId({
          body: { response: reply.response },
          path: { id: reply.sessionID, permissionID: reply.requestID },
        })
        if (result.error) {
          await log.log(
            "warn",
            `pedantic: auto-approval of external_directory (${reply.patterns.join(", ")}) failed: ${String(result.error)}`,
          )
          return
        }
        await log.log(
          "info",
          `pedantic: auto-approved external_directory ${reply.patterns.join(", ")} (${reply.response}) for active worktree`,
        )
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        await log.log(
          "warn",
          `pedantic: auto-approval of external_directory (${reply.patterns.join(", ")}) failed: ${reason}`,
        )
      }
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
      output.system = [...output.system, worktreeDirective(opts.permissionMode)]
    },
  }
}

const serverModule: PluginModule = {
  id: "opencode-worktree-plugin",
  server: serverPlugin,
}

export default serverModule
