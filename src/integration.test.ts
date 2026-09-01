import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs/promises"
import { existsSync } from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import { spawnSync } from "node:child_process"

const PLUGIN_ROOT = process.cwd()
const DIST_INDEX = path.join(PLUGIN_ROOT, "dist", "index.js")

const REQUIRED_ENV = ["OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_URL"] as const

const hasOpencode = (): boolean =>
  spawnSync("opencode", ["--version"], { stdio: "pipe" }).status === 0
const hasDist = (): boolean => existsSync(DIST_INDEX)
const hasRequiredEnv = (): boolean => REQUIRED_ENV.every((key) => !!process.env[key])

const canRun = hasOpencode() && hasDist() && hasRequiredEnv()

const initGitRepo = (repoPath: string): void => {
  spawnSync("git", ["init"], { cwd: repoPath, stdio: "pipe" })
  spawnSync("git", ["symbolic-ref", "HEAD", "refs/heads/main"], { cwd: repoPath, stdio: "pipe" })
  spawnSync("git", ["config", "user.email", "test@test.com"], { cwd: repoPath, stdio: "pipe" })
  spawnSync("git", ["config", "user.name", "Test"], { cwd: repoPath, stdio: "pipe" })
  spawnSync("git", ["add", "."], { cwd: repoPath, stdio: "pipe" })
  spawnSync("git", ["commit", "-m", "init"], { cwd: repoPath, stdio: "pipe" })
}

const git = (cwd: string, ...args: string[]) => spawnSync("git", args, { cwd, encoding: "utf-8" })

describe.skipIf(!canRun)("integration (opencode run)", () => {
  let tmpDir: string
  let repoPath: string
  let xdgStateHome: string
  let xdgConfigHome: string
  let xdgDataHome: string
  let originalEnv: Record<string, string | undefined>

  beforeAll(() => {
    originalEnv = {
      XDG_STATE_HOME: process.env["XDG_STATE_HOME"],
      XDG_CONFIG_HOME: process.env["XDG_CONFIG_HOME"],
      XDG_DATA_HOME: process.env["XDG_DATA_HOME"],
      OPENCODE_CONFIG: process.env["OPENCODE_CONFIG"],
      OPENCODE_CONFIG_CONTENT: process.env["OPENCODE_CONFIG_CONTENT"],
      OPENCODE_TUI_CONFIG: process.env["OPENCODE_TUI_CONFIG"],
    }
  })

  afterAll(() => {
    if (originalEnv["XDG_STATE_HOME"] !== undefined) {
      process.env["XDG_STATE_HOME"] = originalEnv["XDG_STATE_HOME"]
    } else {
      delete process.env["XDG_STATE_HOME"]
    }
    if (originalEnv["XDG_CONFIG_HOME"] !== undefined) {
      process.env["XDG_CONFIG_HOME"] = originalEnv["XDG_CONFIG_HOME"]
    } else {
      delete process.env["XDG_CONFIG_HOME"]
    }
    if (originalEnv["XDG_DATA_HOME"] !== undefined) {
      process.env["XDG_DATA_HOME"] = originalEnv["XDG_DATA_HOME"]
    } else {
      delete process.env["XDG_DATA_HOME"]
    }
    if (originalEnv["OPENCODE_CONFIG"] !== undefined) {
      process.env["OPENCODE_CONFIG"] = originalEnv["OPENCODE_CONFIG"]
    } else {
      delete process.env["OPENCODE_CONFIG"]
    }
    if (originalEnv["OPENCODE_CONFIG_CONTENT"] !== undefined) {
      process.env["OPENCODE_CONFIG_CONTENT"] = originalEnv["OPENCODE_CONFIG_CONTENT"]
    } else {
      delete process.env["OPENCODE_CONFIG_CONTENT"]
    }
    if (originalEnv["OPENCODE_TUI_CONFIG"] !== undefined) {
      process.env["OPENCODE_TUI_CONFIG"] = originalEnv["OPENCODE_TUI_CONFIG"]
    } else {
      delete process.env["OPENCODE_TUI_CONFIG"]
    }
  })

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wt-int-"))
    xdgStateHome = path.join(tmpDir, "state")
    xdgConfigHome = path.join(tmpDir, "config")
    xdgDataHome = path.join(tmpDir, "data")
    repoPath = path.join(tmpDir, "repo")
    await fs.mkdir(repoPath, { recursive: true })
    await fs.writeFile(path.join(repoPath, "README.md"), "hello\n")
    initGitRepo(repoPath)
    await fs.writeFile(
      path.join(repoPath, "opencode.json"),
      JSON.stringify({
        $schema: "https://opencode.ai/config.json",
        plugin: [`file://${PLUGIN_ROOT}`],
        default_agent: "build",
        permission: {
          "*": "allow",
          bash: { "*": "allow" },
          edit: { "*": "allow" },
          external_directory: { "/**": "deny" },
        },
        provider: {
          "openai-compatible": {
            name: "Integration Test",
            npm: "@ai-sdk/openai-compatible",
            options: {
              apiKey: "{env:OPENAI_API_KEY}",
              baseURL: "{env:OPENAI_URL}",
            },
            models: {
              model: { id: "{env:OPENAI_MODEL}" },
            },
          },
        },
        model: "openai-compatible/model",
      }),
    )
  })

  afterEach(async () => {
    git(repoPath, "worktree", "prune")
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  })

  const runOpencode = (prompt: string, timeoutMs = 120000) => {
    const env: NodeJS.ProcessEnv = { ...process.env }
    delete env["XDG_STATE_HOME"]
    delete env["XDG_CONFIG_HOME"]
    delete env["XDG_DATA_HOME"]
    delete env["OPENCODE_CONFIG"]
    delete env["OPENCODE_CONFIG_CONTENT"]
    delete env["OPENCODE_TUI_CONFIG"]
    env["XDG_STATE_HOME"] = xdgStateHome
    env["XDG_CONFIG_HOME"] = xdgConfigHome
    env["XDG_DATA_HOME"] = xdgDataHome
    env["OPENCODE_DISABLE_AUTOUPDATE"] = "1"

    const result = spawnSync(
      "opencode",
      ["run", "--auto", "--print-logs", "--log-level", "INFO", prompt],
      {
        cwd: repoPath,
        encoding: "utf-8",
        timeout: timeoutMs,
        env,
      },
    )
    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      exitCode: result.status ?? 1,
      output: (result.stdout ?? "") + (result.stderr ?? ""),
    }
  }

  const wtPath = (repoShort: string, branch: string) =>
    path.join(xdgStateHome, "opencode", "worktrees", `${repoShort}-${branch}`)

  it("create → write → list (uncommitted) → commit → merge", { timeout: 120000 }, async () => {
    const { output, exitCode } = runOpencode(
      `Do these steps in order:
1. Call worktree_create with repo_short='integ', source_branch='feat-e2e', target_branch='main'.
2. Use the Write tool to create a file at the returned worktree path plus '/feature.txt' with content 'test feature'. Do NOT commit yet.
3. Call worktree_list with no arguments and report whether the worktree shows as uncommitted.
4. Use the Bash tool to run: cd <worktree_path> && git add -A && git commit -m 'add feature'.
5. Call worktree_merge with repo_short='integ', source_branch='feat-e2e', target_branch='main'.
6. Report whether each step succeeded.`,
    )

    expect(exitCode).toBe(0)

    expect(output).toContain("Worktree created")
    expect(output).toContain("uncommitted")
    expect(output).toContain("Merged")

    expect(existsSync(wtPath("integ", "feat-e2e"))).toBe(false)
    expect(git(repoPath, "rev-parse", "--verify", "feat-e2e").status).not.toBe(0)

    expect(existsSync(path.join(repoPath, "feature.txt"))).toBe(true)
    const content = await fs.readFile(path.join(repoPath, "feature.txt"), "utf-8")
    expect(content.trim()).toBe("test feature")

    expect(git(repoPath, "log", "--oneline").stdout).toContain("add feature")

    expect(output).toContain("worktree_create:")
    expect(output).toContain("worktree_list:")
    expect(output).toContain("worktree_merge:")
    expect(output).toContain("fast-forward merged")
    expect(output).toContain("worktree removed")
  })

  it("create → remove (discard without merge)", { timeout: 120000 }, async () => {
    const { output, exitCode } = runOpencode(
      `Do these steps in order:
1. Call worktree_create with repo_short='integ', source_branch='feat-discard', target_branch='main'.
2. Call worktree_remove with repo_short='integ', source_branch='feat-discard'.
3. Report whether each step succeeded.`,
    )

    expect(exitCode).toBe(0)

    expect(output).toContain("Worktree created")
    expect(output).toContain("Worktree removed")

    expect(existsSync(wtPath("integ", "feat-discard"))).toBe(false)
    expect(git(repoPath, "rev-parse", "--verify", "feat-discard").status).toBe(0)

    expect(output).toContain("worktree_create:")
    expect(output).toContain("worktree_remove:")
    expect(output).toContain("worktree removed")
  })

  it("create → write (uncommitted) → remove refuses", { timeout: 120000 }, async () => {
    const { output, exitCode } = runOpencode(
      `Do these steps in order:
1. Call worktree_create with repo_short='integ', source_branch='feat-dirty', target_branch='main'.
2. Use the Write tool to create a file at the returned worktree path plus '/dirty.txt' with content 'dirty'. Do NOT commit.
3. Call worktree_remove with repo_short='integ', source_branch='feat-dirty'.
4. Report whether each step succeeded, especially whether worktree_remove refused.`,
    )

    expect(exitCode).toBe(0)

    expect(output).toContain("Worktree created")
    expect(output).toContain("uncommitted")

    expect(existsSync(wtPath("integ", "feat-dirty"))).toBe(true)
    expect(git(repoPath, "rev-parse", "--verify", "feat-dirty").status).toBe(0)
  })

  it("rejects invalid names (path traversal and slashes)", { timeout: 120000 }, async () => {
    const { output, exitCode } = runOpencode(
      `Call worktree_create twice and report the exact tool error messages:
1. First call with repo_short='integ', source_branch='../escape', target_branch='main'.
2. Then call with repo_short='../evil', source_branch='feat', target_branch='main'.
Do not fix or work around the arguments — call the tool exactly as instructed.`,
    )

    expect(exitCode).toBe(0)

    expect(output).toContain("invalid-name")
    expect(output).toContain("^[a-z0-9][a-z0-9-]*$")

    expect(existsSync(wtPath("integ", "feat"))).toBe(false)
    expect(existsSync(path.join(tmpDir, "evil-feat"))).toBe(false)
  })

  it(
    "merge into a non-checked-out target updates the ref without touching the working copy",
    { timeout: 120000 },
    async () => {
      const { output, exitCode } = runOpencode(
        `Do these steps in order:
1. Call worktree_create with repo_short='integ', source_branch='feat-ref', target_branch='main'.
2. Use the Write tool to create a file at the returned worktree path plus '/refonly.txt' with content 'ref merge'.
3. Use the Bash tool to run: cd <worktree_path> && git add -A && git commit -m 'add refonly'.
4. Use the Bash tool to run: git branch integration main
5. Call worktree_merge with repo_short='integ', source_branch='feat-ref', target_branch='integration'.
6. Report whether each step succeeded.`,
      )

      expect(exitCode).toBe(0)

      expect(output).toContain("Merged")
      expect(output).toContain("ref-only")

      expect(git(repoPath, "rev-parse", "--abbrev-ref", "HEAD").stdout.trim()).toBe("main")
      expect(existsSync(path.join(repoPath, "refonly.txt"))).toBe(false)

      const integrationLog = git(repoPath, "log", "--oneline", "integration")
      expect(integrationLog.stdout).toContain("add refonly")

      expect(existsSync(wtPath("integ", "feat-ref"))).toBe(false)
      expect(git(repoPath, "rev-parse", "--verify", "feat-ref").status).not.toBe(0)
    },
  )
})

describe.skipIf(canRun)("integration (opencode run) — skipped", () => {
  it("explains why integration tests are skipped", () => {
    const missing: string[] = []
    if (!hasOpencode()) missing.push("opencode binary on PATH")
    if (!hasDist()) missing.push("dist/index.js (run npm run build)")
    for (const key of REQUIRED_ENV) {
      if (!process.env[key]) missing.push(`${key} env var`)
    }
    expect(missing).toEqual([])
    console.log(`Integration tests skipped. Missing: ${missing.join(", ")}`)
  })
})
