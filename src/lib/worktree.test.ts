import { describe, it, expect } from "vitest"
import {
  type SpawnFn,
  type SpawnResult,
  mergeWorktree,
  deleteBranch,
  createWorktree,
  parseWorktreeList,
  resolveDefaultBranch,
} from "./worktree.js"
import type { Either, WorktreeError } from "../types.js"
import { getOrThrow, isLeft } from "../types.js"

const ok = (stdout = ""): SpawnResult => ({ exitCode: 0, stdout, stderr: "" })
const fail = (stderr = "boom"): SpawnResult => ({ exitCode: 1, stdout: "", stderr })

const mockSpawn =
  (responses: Record<string, SpawnResult>): SpawnFn =>
  async (command, _options) => {
    const key = command.join(" ")
    return responses[key] ?? fail(`not mocked: ${key}`)
  }

const unwrapFailure = (either: Either<WorktreeError, unknown>): WorktreeError => {
  if (!isLeft(either)) throw new Error("expected failure")
  const record = either as unknown as Record<string, unknown>
  return (record["failure"] ?? record["error"]) as WorktreeError
}

const worktreeListResponse = (worktreePath: string): SpawnResult =>
  ok(`worktree /repo\n\nworktree ${worktreePath}\n`)

describe("mergeWorktree (mergeStrategy: ff-only)", () => {
  const mergeInput = {
    repoPath: "/repo",
    worktreePath: "/root/ocp-feat",
    sourceBranch: "feat",
    targetBranch: "main",
    mergeStrategy: "ff-only" as const,
    gitCmd: ["git"] as const,
  }

  it("fast-forwards in the working copy when the target is checked out", async () => {
    const calls: string[] = []
    const spawn: SpawnFn = async (command) => {
      const key = command.join(" ")
      calls.push(key)
      if (key === "git rev-parse --verify refs/heads/feat") return ok()
      if (key === "git rev-parse --verify refs/heads/main") return ok()
      if (key === "git rev-parse --abbrev-ref HEAD") return ok("main\n")
      if (key === "git status --porcelain -uall") return ok("")
      if (key === "git merge-base --is-ancestor main feat") return ok()
      if (key === "git merge --ff-only feat") return ok()
      return worktreeListResponse("/root/ocp-feat")
    }

    const result = await mergeWorktree(spawn, mergeInput)
    expect(getOrThrow(result)).toEqual({ mode: "working-copy", style: "fast-forward" })
    expect(calls).toContain("git merge --ff-only feat")
    expect(calls.some((c) => c.includes("checkout"))).toBe(false)
    expect(calls.some((c) => c.includes("config --get merge.ff"))).toBe(false)
  })

  it("refuses with target-dirty when uncommitted changes would be overwritten", async () => {
    const calls: string[] = []
    const spawn: SpawnFn = async (command) => {
      const key = command.join(" ")
      calls.push(key)
      if (key === "git rev-parse --verify refs/heads/feat") return ok()
      if (key === "git rev-parse --verify refs/heads/main") return ok()
      if (key === "git rev-parse --abbrev-ref HEAD") return ok("main\n")
      if (key === "git status --porcelain -uall")
        return ok(" M src/lib/worktree.ts\n?? notes.txt\n")
      if (key === "git diff --name-only HEAD feat") return ok("src/lib/worktree.ts\nsrc/index.ts\n")
      return worktreeListResponse("/root/ocp-feat")
    }

    const result = await mergeWorktree(spawn, mergeInput)
    const failure = unwrapFailure(result)
    expect(failure.kind).toBe("target-dirty")
    if (failure.kind === "target-dirty") {
      expect(failure.files).toEqual(["src/lib/worktree.ts"])
    }
    expect(calls).not.toContain("git merge --ff-only feat")
  })

  it("merges in the working copy when dirty files do not overlap the merge", async () => {
    const calls: string[] = []
    const spawn: SpawnFn = async (command) => {
      const key = command.join(" ")
      calls.push(key)
      if (key === "git rev-parse --verify refs/heads/feat") return ok()
      if (key === "git rev-parse --verify refs/heads/main") return ok()
      if (key === "git rev-parse --abbrev-ref HEAD") return ok("main\n")
      if (key === "git status --porcelain -uall") return ok(" M README.md\n")
      if (key === "git diff --name-only HEAD feat") return ok("src/lib/worktree.ts\n")
      if (key === "git merge --ff-only feat") return ok()
      return worktreeListResponse("/root/ocp-feat")
    }

    const result = await mergeWorktree(spawn, mergeInput)
    expect(getOrThrow(result)).toEqual({ mode: "working-copy", style: "fast-forward" })
    expect(calls).toContain("git merge --ff-only feat")
  })

  it("captures git stdout in the not-fast-forward failure when stderr is empty", async () => {
    const spawn = mockSpawn({
      "git worktree list --porcelain": worktreeListResponse("/root/ocp-feat"),
      "git rev-parse --verify refs/heads/feat": ok(),
      "git rev-parse --verify refs/heads/main": ok(),
      "git rev-parse --abbrev-ref HEAD": ok("develop\n"),
      "git merge-base --is-ancestor main feat": ok(),
      "git fetch . feat:main": {
        exitCode: 1,
        stdout: "error: cannot lock ref 'refs/heads/main'",
        stderr: "",
      },
    })

    const result = await mergeWorktree(spawn, mergeInput)
    const failure = unwrapFailure(result)
    expect(failure.kind).toBe("not-fast-forward")
    if (failure.kind === "not-fast-forward") {
      expect(failure.stderr).toContain("cannot lock ref")
    }
  })

  it("updates the ref without checkout when the target is not checked out", async () => {
    const calls: string[] = []
    const spawn: SpawnFn = async (command) => {
      const key = command.join(" ")
      calls.push(key)
      if (key === "git rev-parse --verify refs/heads/feat") return ok()
      if (key === "git rev-parse --verify refs/heads/main") return ok()
      if (key === "git rev-parse --abbrev-ref HEAD") return ok("develop\n")
      if (key === "git merge-base --is-ancestor main feat") return ok()
      if (key === "git fetch . feat:main") return ok()
      return worktreeListResponse("/root/ocp-feat")
    }

    const result = await mergeWorktree(spawn, mergeInput)
    expect(getOrThrow(result)).toEqual({ mode: "ref-only", style: "fast-forward" })
    expect(calls).toContain("git fetch . feat:main")
    expect(calls.some((c) => c.includes("checkout"))).toBe(false)
    expect(calls.some((c) => c.startsWith("git merge "))).toBe(false)
  })

  it("reports not-fast-forward when the branches have diverged", async () => {
    const calls: string[] = []
    const spawn: SpawnFn = async (command) => {
      const key = command.join(" ")
      calls.push(key)
      if (key === "git rev-parse --verify refs/heads/feat") return ok()
      if (key === "git rev-parse --verify refs/heads/main") return ok()
      if (key === "git rev-parse --abbrev-ref HEAD") return ok("develop\n")
      if (key === "git merge-base --is-ancestor main feat") return fail("not an ancestor")
      return worktreeListResponse("/root/ocp-feat")
    }

    const result = await mergeWorktree(spawn, mergeInput)
    expect(unwrapFailure(result).kind).toBe("not-fast-forward")
    expect(calls.some((c) => c.startsWith("git fetch"))).toBe(false)
  })

  it("propagates git stderr when the ref update is rejected", async () => {
    const spawn = mockSpawn({
      "git worktree list --porcelain": worktreeListResponse("/root/ocp-feat"),
      "git rev-parse --verify refs/heads/feat": ok(),
      "git rev-parse --verify refs/heads/main": ok(),
      "git rev-parse --abbrev-ref HEAD": ok("develop\n"),
      "git merge-base --is-ancestor main feat": ok(),
      "git fetch . feat:main": fail("! [rejected] (non-fast-forward)"),
    })

    const result = await mergeWorktree(spawn, mergeInput)
    const failure = unwrapFailure(result)
    expect(failure.kind).toBe("not-fast-forward")
    if (failure.kind === "not-fast-forward") {
      expect(failure.stderr).toContain("non-fast-forward")
    }
  })

  it("reports branch-not-found when the target branch is missing", async () => {
    const spawn = mockSpawn({
      "git worktree list --porcelain": worktreeListResponse("/root/ocp-feat"),
      "git rev-parse --verify refs/heads/feat": ok(),
      "git rev-parse --verify refs/heads/main": fail(),
    })

    const result = await mergeWorktree(spawn, mergeInput)
    expect(unwrapFailure(result).kind).toBe("branch-not-found")
  })

  it("reports worktree-not-found when the worktree is not registered", async () => {
    const spawn = mockSpawn({
      "git worktree list --porcelain": ok("worktree /repo\n"),
    })

    const result = await mergeWorktree(spawn, mergeInput)
    expect(unwrapFailure(result).kind).toBe("worktree-not-found")
  })

  it("does not match a sibling worktree sharing the path prefix", async () => {
    const spawn = mockSpawn({
      "git worktree list --porcelain": ok("worktree /repo\n\nworktree /root/ocp-feat-2\n"),
    })

    const result = await mergeWorktree(spawn, mergeInput)
    expect(unwrapFailure(result).kind).toBe("worktree-not-found")
  })
})

describe("mergeWorktree (mergeStrategy: repo-config)", () => {
  const mergeInput = {
    repoPath: "/repo",
    worktreePath: "/root/ocp-feat",
    sourceBranch: "feat",
    targetBranch: "main",
    mergeStrategy: "repo-config" as const,
    gitCmd: ["git"] as const,
  }

  it("merges without flags in the working copy when merge.ff is unset", async () => {
    const calls: string[] = []
    const spawn: SpawnFn = async (command) => {
      const key = command.join(" ")
      calls.push(key)
      if (key === "git rev-parse --verify refs/heads/feat") return ok()
      if (key === "git rev-parse --verify refs/heads/main") return ok()
      if (key === "git rev-parse --abbrev-ref HEAD") return ok("main\n")
      if (key === "git config --get merge.ff") return fail("exit code 1")
      if (key === "git merge-base --is-ancestor main feat") return ok()
      if (key === "git merge feat") return ok()
      return worktreeListResponse("/root/ocp-feat")
    }

    const result = await mergeWorktree(spawn, mergeInput)
    expect(getOrThrow(result)).toEqual({ mode: "working-copy", style: "fast-forward" })
    expect(calls).toContain("git merge feat")
    expect(calls.some((c) => c.includes("--ff-only"))).toBe(false)
  })

  it("passes --ff-only when the repository configures merge.ff=only", async () => {
    const spawn = mockSpawn({
      "git worktree list --porcelain": worktreeListResponse("/root/ocp-feat"),
      "git rev-parse --verify refs/heads/feat": ok(),
      "git rev-parse --verify refs/heads/main": ok(),
      "git rev-parse --abbrev-ref HEAD": ok("main\n"),
      "git config --get merge.ff": ok("only\n"),
      "git merge-base --is-ancestor main feat": ok(),
      "git merge --ff-only feat": ok(),
    })

    const result = await mergeWorktree(spawn, mergeInput)
    expect(getOrThrow(result)).toEqual({ mode: "working-copy", style: "fast-forward" })
  })

  it("passes --no-ff and reports a merge commit when merge.ff=false", async () => {
    const calls: string[] = []
    const spawn: SpawnFn = async (command) => {
      const key = command.join(" ")
      calls.push(key)
      if (key === "git rev-parse --verify refs/heads/feat") return ok()
      if (key === "git rev-parse --verify refs/heads/main") return ok()
      if (key === "git rev-parse --abbrev-ref HEAD") return ok("main\n")
      if (key === "git config --get merge.ff") return ok("false\n")
      if (key === "git merge-base --is-ancestor main feat") return ok()
      if (key === "git merge --no-ff feat") return ok()
      return worktreeListResponse("/root/ocp-feat")
    }

    const result = await mergeWorktree(spawn, mergeInput)
    expect(getOrThrow(result)).toEqual({ mode: "working-copy", style: "merge-commit" })
    expect(calls).toContain("git merge --no-ff feat")
  })

  it("rolls back and reports merge-conflict when a working-copy merge conflicts", async () => {
    const calls: string[] = []
    const spawn: SpawnFn = async (command) => {
      const key = command.join(" ")
      calls.push(key)
      if (key === "git rev-parse --verify refs/heads/feat") return ok()
      if (key === "git rev-parse --verify refs/heads/main") return ok()
      if (key === "git rev-parse --abbrev-ref HEAD") return ok("main\n")
      if (key === "git config --get merge.ff") return fail("exit code 1")
      if (key === "git merge-base --is-ancestor main feat") return fail("not an ancestor")
      if (key === "git status --porcelain -uall") return ok("")
      if (key === "git merge feat")
        return fail("Automatic merge failed; fix conflicts and then commit the result.")
      if (key === "git merge --abort") return ok()
      return worktreeListResponse("/root/ocp-feat")
    }

    const result = await mergeWorktree(spawn, mergeInput)
    expect(unwrapFailure(result).kind).toBe("merge-conflict")
    expect(calls).toContain("git merge --abort")
  })

  it("updates the ref without checkout when merge.ff is unset and a fast-forward is possible", async () => {
    const spawn = mockSpawn({
      "git worktree list --porcelain": worktreeListResponse("/root/ocp-feat"),
      "git rev-parse --verify refs/heads/feat": ok(),
      "git rev-parse --verify refs/heads/main": ok(),
      "git rev-parse --abbrev-ref HEAD": ok("develop\n"),
      "git config --get merge.ff": fail("exit code 1"),
      "git merge-base --is-ancestor main feat": ok(),
      "git fetch . feat:main": ok(),
    })

    const result = await mergeWorktree(spawn, mergeInput)
    expect(getOrThrow(result)).toEqual({ mode: "ref-only", style: "fast-forward" })
  })

  it("creates a merge commit via plumbing when the branches have diverged", async () => {
    const calls: string[] = []
    const spawn: SpawnFn = async (command) => {
      const key = command.join(" ")
      calls.push(key)
      if (key === "git rev-parse --verify refs/heads/feat") return ok()
      if (key === "git rev-parse --verify refs/heads/main") return ok()
      if (key === "git rev-parse --abbrev-ref HEAD") return ok("develop\n")
      if (key === "git config --get merge.ff") return fail("exit code 1")
      if (key === "git merge-base --is-ancestor main feat") return fail("not an ancestor")
      if (key === "git rev-parse refs/heads/main") return ok("OLD\n")
      if (key === "git merge-tree --write-tree main feat") return ok("TREE\n")
      if (key === "git commit-tree TREE -p main -p feat -m Merge branch 'feat' into main")
        return ok("COMMIT\n")
      if (key === "git update-ref refs/heads/main COMMIT OLD") return ok()
      return worktreeListResponse("/root/ocp-feat")
    }

    const result = await mergeWorktree(spawn, mergeInput)
    expect(getOrThrow(result)).toEqual({ mode: "ref-only", style: "merge-commit" })
    expect(calls).toContain("git update-ref refs/heads/main COMMIT OLD")
    expect(calls.some((c) => c.startsWith("git fetch"))).toBe(false)
    expect(calls.some((c) => c.startsWith("git checkout"))).toBe(false)
  })

  it("creates a merge commit even when a fast-forward is possible if merge.ff=false", async () => {
    const calls: string[] = []
    const spawn: SpawnFn = async (command) => {
      const key = command.join(" ")
      calls.push(key)
      if (key === "git rev-parse --verify refs/heads/feat") return ok()
      if (key === "git rev-parse --verify refs/heads/main") return ok()
      if (key === "git rev-parse --abbrev-ref HEAD") return ok("develop\n")
      if (key === "git config --get merge.ff") return ok("false\n")
      if (key === "git merge-base --is-ancestor main feat") return ok()
      if (key === "git rev-parse refs/heads/main") return ok("OLD\n")
      if (key === "git merge-tree --write-tree main feat") return ok("TREE\n")
      if (key === "git commit-tree TREE -p main -p feat -m Merge branch 'feat' into main")
        return ok("COMMIT\n")
      if (key === "git update-ref refs/heads/main COMMIT OLD") return ok()
      return worktreeListResponse("/root/ocp-feat")
    }

    const result = await mergeWorktree(spawn, mergeInput)
    expect(getOrThrow(result)).toEqual({ mode: "ref-only", style: "merge-commit" })
    expect(calls.some((c) => c.startsWith("git fetch"))).toBe(false)
  })

  it("reports not-fast-forward when merge.ff=only and the branches have diverged", async () => {
    const spawn = mockSpawn({
      "git worktree list --porcelain": worktreeListResponse("/root/ocp-feat"),
      "git rev-parse --verify refs/heads/feat": ok(),
      "git rev-parse --verify refs/heads/main": ok(),
      "git rev-parse --abbrev-ref HEAD": ok("develop\n"),
      "git config --get merge.ff": ok("only\n"),
      "git merge-base --is-ancestor main feat": fail("not an ancestor"),
    })

    const result = await mergeWorktree(spawn, mergeInput)
    expect(unwrapFailure(result).kind).toBe("not-fast-forward")
  })

  it("reports merge-conflict when the plumbing merge detects conflicts", async () => {
    const spawn = mockSpawn({
      "git worktree list --porcelain": worktreeListResponse("/root/ocp-feat"),
      "git rev-parse --verify refs/heads/feat": ok(),
      "git rev-parse --verify refs/heads/main": ok(),
      "git rev-parse --abbrev-ref HEAD": ok("develop\n"),
      "git config --get merge.ff": fail("exit code 1"),
      "git merge-base --is-ancestor main feat": fail("not an ancestor"),
      "git rev-parse refs/heads/main": ok("OLD\n"),
      "git merge-tree --write-tree main feat": {
        exitCode: 1,
        stdout: "CONFLICT (content): Merge conflict in file.txt",
        stderr: "",
      },
    })

    const result = await mergeWorktree(spawn, mergeInput)
    const failure = unwrapFailure(result)
    expect(failure.kind).toBe("merge-conflict")
    if (failure.kind === "merge-conflict") {
      expect(failure.detail).toContain("CONFLICT")
    }
  })

  it("refuses to update a target branch that is checked out in another worktree", async () => {
    const spawn = mockSpawn({
      "git worktree list --porcelain": ok(
        "worktree /repo\n\nworktree /root/ocp-feat\n\nbranch refs/heads/main\n",
      ),
      "git rev-parse --verify refs/heads/feat": ok(),
      "git rev-parse --verify refs/heads/main": ok(),
      "git rev-parse --abbrev-ref HEAD": ok("develop\n"),
      "git config --get merge.ff": fail("exit code 1"),
      "git merge-base --is-ancestor main feat": ok(),
    })

    const result = await mergeWorktree(spawn, mergeInput)
    expect(unwrapFailure(result).kind).toBe("target-checked-out")
  })
})

describe("deleteBranch", () => {
  it("deletes with git branch -d when it succeeds", async () => {
    const calls: string[] = []
    const spawn: SpawnFn = async (command) => {
      const key = command.join(" ")
      calls.push(key)
      if (key === "git merge-base --is-ancestor feat main") return ok()
      if (key === "git branch -d feat") return ok()
      return fail(`not mocked: ${key}`)
    }

    const result = await deleteBranch(spawn, ["git"], "/repo", "feat", "main")
    expect(isLeft(result)).toBe(false)
    expect(calls).toContain("git branch -d feat")
    expect(calls).not.toContain("git update-ref -d refs/heads/feat")
  })

  it("falls back to git update-ref -d when -d refuses and the branch is not checked out", async () => {
    const calls: string[] = []
    const spawn: SpawnFn = async (command) => {
      const key = command.join(" ")
      calls.push(key)
      if (key === "git merge-base --is-ancestor feat integration") return ok()
      if (key === "git branch -d feat") {
        return fail("error: the branch 'feat' is not fully merged")
      }
      if (key === "git worktree list --porcelain") {
        return ok("worktree /repo\n\nbranch refs/heads/main\n")
      }
      if (key === "git update-ref -d refs/heads/feat") return ok()
      return fail(`not mocked: ${key}`)
    }

    const result = await deleteBranch(spawn, ["git"], "/repo", "feat", "integration")
    expect(isLeft(result)).toBe(false)
    expect(calls).toContain("git update-ref -d refs/heads/feat")
  })

  it("refuses to delete a branch that is checked out in another worktree", async () => {
    const calls: string[] = []
    const spawn: SpawnFn = async (command) => {
      const key = command.join(" ")
      calls.push(key)
      if (key === "git merge-base --is-ancestor feat main") return ok()
      if (key === "git branch -d feat")
        return fail("error: Cannot delete branch 'feat' checked out at '/root/ocp-feat'")
      if (key === "git worktree list --porcelain") {
        return ok("worktree /repo\n\nworktree /root/ocp-feat\n\nbranch refs/heads/feat\n")
      }
      return fail(`not mocked: ${key}`)
    }

    const result = await deleteBranch(spawn, ["git"], "/repo", "feat", "main")
    const failure = unwrapFailure(result)
    expect(failure.kind).toBe("git-error")
    if (failure.kind === "git-error") {
      expect(failure.message).toContain("checked out in another worktree")
    }
    expect(calls).not.toContain("git update-ref -d refs/heads/feat")
  })

  it("refuses the force-delete fallback when the worktree list cannot be read", async () => {
    const calls: string[] = []
    const spawn: SpawnFn = async (command) => {
      const key = command.join(" ")
      calls.push(key)
      if (key === "git merge-base --is-ancestor feat main") return ok()
      if (key === "git branch -d feat") return fail("error: the branch 'feat' is not fully merged")
      if (key === "git worktree list --porcelain") return fail("fatal: not a git repository")
      return fail(`not mocked: ${key}`)
    }

    const result = await deleteBranch(spawn, ["git"], "/repo", "feat", "main")
    expect(unwrapFailure(result).kind).toBe("git-error")
    expect(calls).not.toContain("git update-ref -d refs/heads/feat")
  })

  it("refuses to delete a branch that is not merged into the target", async () => {
    const spawn = mockSpawn({
      "git merge-base --is-ancestor feat main": fail(),
    })

    const result = await deleteBranch(spawn, ["git"], "/repo", "feat", "main")
    expect(unwrapFailure(result).kind).toBe("branch-not-merged")
  })
})

describe("createWorktree", () => {
  it("refuses to create a worktree when the branch already exists", async () => {
    const spawn = mockSpawn({
      "git rev-parse --verify refs/heads/feat": ok(),
    })

    const result = await createWorktree(spawn, {
      repoPath: "/repo",
      worktreePath: "/root/ocp-feat",
      sourceBranch: "feat",
      targetBranch: "main",
      gitCmd: ["git"],
    })
    expect(unwrapFailure(result).kind).toBe("branch-exists")
  })

  it("does not treat a tag name collision as an existing branch", async () => {
    const spawn = mockSpawn({
      "git rev-parse --verify refs/heads/feat": fail("fatal: Needed a single revision"),
      "git worktree add -b feat /root/ocp-feat main": ok(),
    })

    const result = await createWorktree(spawn, {
      repoPath: "/repo",
      worktreePath: "/root/ocp-feat",
      sourceBranch: "feat",
      targetBranch: "main",
      gitCmd: ["git"],
    })
    expect(getOrThrow(result)).toEqual({
      sourceBranch: "feat",
      targetBranch: "main",
      path: "/root/ocp-feat",
      repoPath: "/repo",
    })
  })
})

describe("resolveDefaultBranch", () => {
  it("uses the remote HEAD short name", async () => {
    const spawn = mockSpawn({
      "git symbolic-ref --short refs/remotes/origin/HEAD": ok("origin/main\n"),
    })
    expect(await resolveDefaultBranch(["git"], spawn, "/repo")).toBe("main")
  })

  it("strips only the remote name from namespaced remote branches", async () => {
    const spawn = mockSpawn({
      "git symbolic-ref --short refs/remotes/origin/HEAD": ok("origin/release/1.2\n"),
    })
    expect(await resolveDefaultBranch(["git"], spawn, "/repo")).toBe("release/1.2")
  })

  it("falls back to init.defaultBranch when no remote HEAD exists", async () => {
    const spawn = mockSpawn({
      "git symbolic-ref --short refs/remotes/origin/HEAD": fail(
        "fatal: refs/remotes/origin/HEAD is not a valid ref",
      ),
      "git config --get init.defaultBranch": ok("master\n"),
    })
    expect(await resolveDefaultBranch(["git"], spawn, "/repo")).toBe("master")
  })

  it("falls back to main when nothing is configured", async () => {
    const spawn = mockSpawn({
      "git symbolic-ref --short refs/remotes/origin/HEAD": fail(),
      "git config --get init.defaultBranch": fail(),
    })
    expect(await resolveDefaultBranch(["git"], spawn, "/repo")).toBe("main")
  })
})

describe("parseWorktreeList", () => {
  it("parses branch, detached, and bare entries", () => {
    const porcelain = [
      "worktree /repo",
      "HEAD 111",
      "branch refs/heads/main",
      "",
      "worktree /root/ocp-feat",
      "HEAD 222",
      "branch refs/heads/feat",
      "",
      "worktree /other",
      "HEAD 333",
      "detached",
      "",
      "worktree /bare-repo",
      "bare",
    ].join("\n")

    expect(parseWorktreeList(porcelain)).toEqual([
      { path: "/repo", head: "111", branch: "main" },
      { path: "/root/ocp-feat", head: "222", branch: "feat" },
      { path: "/other", head: "333", detached: true },
      { path: "/bare-repo", bare: true },
    ])
  })

  it("strips the refs/heads prefix from branch names", () => {
    const porcelain = "worktree /repo\nbranch refs/heads/release/1.2\n"
    expect(parseWorktreeList(porcelain)[0]?.branch).toBe("release/1.2")
  })

  it("returns empty for empty porcelain output", () => {
    expect(parseWorktreeList("")).toEqual([])
  })

  it("ignores lines before the first worktree line", () => {
    expect(parseWorktreeList("junk\nHEAD 111\n")).toEqual([])
  })
})
