import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs/promises"
import { existsSync } from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import { spawnSync } from "node:child_process"

const PLUGIN_ROOT = process.cwd()
const DIST_INDEX = path.join(PLUGIN_ROOT, "dist", "index.js")

const hasOpencode = (): boolean =>
  spawnSync("opencode", ["--version"], { stdio: "pipe" }).status === 0
const canRun = hasOpencode() && existsSync(DIST_INDEX)

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
  let originalXdgStateHome: string | undefined

  beforeAll(() => {
    originalXdgStateHome = process.env["XDG_STATE_HOME"]
  })

  afterAll(() => {
    if (originalXdgStateHome !== undefined) {
      process.env["XDG_STATE_HOME"] = originalXdgStateHome
    } else {
      delete process.env["XDG_STATE_HOME"]
    }
  })

  beforeEach(async () => {
    tmpDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "wt-int-")))
    xdgStateHome = path.join(tmpDir, "state")
    repoPath = path.join(tmpDir, "repo")
    await fs.mkdir(repoPath, { recursive: true })
    await fs.writeFile(path.join(repoPath, "README.md"), "hello\n")
    initGitRepo(repoPath)
    await fs.writeFile(
      path.join(repoPath, "opencode.json"),
      JSON.stringify({
        $schema: "https://opencode.ai/config.json",
        plugin: [`file://${PLUGIN_ROOT}`],
      }),
    )
  })

  afterEach(async () => {
    git(repoPath, "worktree", "prune")
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  })

  const runOpencode = (prompt: string, timeoutMs = 120000) => {
    const result = spawnSync(
      "opencode",
      ["run", "--auto", "--print-logs", "--log-level", "INFO", "--agent", "build", prompt],
      {
        cwd: repoPath,
        encoding: "utf-8",
        timeout: timeoutMs,
        env: { ...process.env, XDG_STATE_HOME: xdgStateHome },
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

  it("create → write → commit → merge", { timeout: 120000 }, async () => {
    const { output, exitCode } = runOpencode(
      `Do these steps in order:
1. Call worktree_create with repo_short='integ', source_branch='feat-e2e', target_branch='main'.
2. Use the Write tool to create a file at the returned worktree path plus '/feature.txt' with content 'test feature'.
3. Use the Bash tool to run: cd <worktree_path> && git add -A && git commit -m 'add feature'.
4. Call worktree_merge with repo_short='integ', source_branch='feat-e2e', target_branch='main'.
5. Report whether each step succeeded.`,
    )

    expect(exitCode).toBe(0)

    expect(output).toContain("Worktree created")
    expect(output).toContain("Merged")

    expect(existsSync(wtPath("integ", "feat-e2e"))).toBe(false)
    expect(git(repoPath, "rev-parse", "--verify", "feat-e2e").status).not.toBe(0)

    expect(existsSync(path.join(repoPath, "feature.txt"))).toBe(true)
    const content = await fs.readFile(path.join(repoPath, "feature.txt"), "utf-8")
    expect(content.trim()).toBe("test feature")

    expect(git(repoPath, "log", "--oneline").stdout).toContain("add feature")

    expect(output).toContain("worktree_create:")
    expect(output).toContain("worktree_merge:")
    expect(output).toContain("fast-forward merged")
    expect(output).toContain("permission tracking cleaned up")
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
    expect(output).toContain("permission tracking cleaned up")
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
})
