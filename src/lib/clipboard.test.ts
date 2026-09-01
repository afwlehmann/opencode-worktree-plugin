import { describe, it, expect } from "vitest"
import { copyToClipboard, type StdinSpawn } from "./clipboard.js"
import { isLeft, isRight } from "../types.js"

type Call = { readonly command: readonly string[]; readonly input: string }

const recordingSpawn =
  (
    outcomes: Readonly<Record<string, { readonly exitCode: number; readonly stderr: string }>>,
    calls: Call[],
  ): StdinSpawn =>
  async (command, input) => {
    calls.push({ command, input })
    return outcomes[command.join(" ")] ?? { exitCode: 0, stderr: "" }
  }

describe("copyToClipboard", () => {
  it("pipes the text to pbcopy on darwin", async () => {
    const calls: Call[] = []
    const result = await copyToClipboard("/tmp/repo", recordingSpawn({}, calls), "darwin")
    expect(isRight(result)).toBe(true)
    expect(calls).toEqual([{ command: ["pbcopy"], input: "/tmp/repo" }])
  })

  it("succeeds with wl-copy on linux", async () => {
    const calls: Call[] = []
    const result = await copyToClipboard("/tmp/repo", recordingSpawn({}, calls), "linux")
    expect(isRight(result)).toBe(true)
    expect(calls).toEqual([{ command: ["wl-copy"], input: "/tmp/repo" }])
  })

  it("falls back to xclip when wl-copy fails on linux", async () => {
    const calls: Call[] = []
    const spawn = recordingSpawn({ "wl-copy": { exitCode: 127, stderr: "not found" } }, calls)
    const result = await copyToClipboard("/tmp/repo", spawn, "linux")
    expect(isRight(result)).toBe(true)
    expect(calls.map((call) => call.command.join(" "))).toEqual([
      "wl-copy",
      "xclip -selection clipboard",
    ])
  })

  it("fails after all platform candidates are exhausted", async () => {
    const spawn = recordingSpawn(
      {
        "wl-copy": { exitCode: 127, stderr: "wl-copy: not found" },
        "xclip -selection clipboard": { exitCode: 1, stderr: "xclip: no display" },
        "xsel --clipboard --input": { exitCode: 127, stderr: "xsel: not found" },
      },
      [],
    )
    const result = await copyToClipboard("/tmp/repo", spawn, "linux")
    expect(isLeft(result)).toBe(true)
    if (isLeft(result)) {
      expect(result.failure.kind).toBe("clipboard-unavailable")
      if (result.failure.kind === "clipboard-unavailable") {
        expect(result.failure.tried).toEqual([
          "wl-copy",
          "xclip -selection clipboard",
          "xsel --clipboard --input",
        ])
        expect(result.failure.stderr).toContain("xclip: no display")
      }
    }
  })

  it("fails without spawning on platforms without candidates", async () => {
    const calls: Call[] = []
    const result = await copyToClipboard("/tmp/repo", recordingSpawn({}, calls), "sunos")
    expect(isLeft(result)).toBe(true)
    expect(calls).toEqual([])
  })
})
