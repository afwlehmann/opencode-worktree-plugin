import type { Either, WorktreeError } from "../types.js"
import { left, right } from "../types.js"

export type StdinSpawn = (
  command: readonly string[],
  input: string,
) => Promise<{ readonly exitCode: number; readonly stderr: string }>

export const bunStdinSpawn: StdinSpawn = async (command, input) => {
  const proc = Bun.spawn([...command], {
    stdin: "pipe",
    stdout: "ignore",
    stderr: "pipe",
  })
  proc.stdin.write(input)
  proc.stdin.end()
  const stderr = await new Response(proc.stderr).text()
  const exitCode = await proc.exited
  return { exitCode, stderr }
}

const CLIPBOARD_COMMANDS: Readonly<Record<string, readonly (readonly string[])[]>> = {
  darwin: [["pbcopy"]],
  linux: [["wl-copy"], ["xclip", "-selection", "clipboard"], ["xsel", "--clipboard", "--input"]],
  win32: [["clip"]],
}

type Attempt = { readonly command: readonly string[]; readonly stderr: string }

const tryCommands = async (
  text: string,
  spawn: StdinSpawn,
  remaining: readonly (readonly string[])[],
  attempted: readonly Attempt[],
): Promise<Either<WorktreeError, void>> => {
  const command = remaining[0]
  if (command === undefined) {
    return left({
      kind: "clipboard-unavailable",
      tried: attempted.map((attempt) => attempt.command.join(" ")),
      stderr: attempted
        .map((attempt) => attempt.stderr)
        .filter((line) => line !== "")
        .join("; "),
    })
  }
  const result = await spawn(command, text)
  const attempts: readonly Attempt[] = [...attempted, { command, stderr: result.stderr.trim() }]
  if (result.exitCode === 0) return right(undefined)
  return tryCommands(text, spawn, remaining.slice(1), attempts)
}

export const copyToClipboard = async (
  text: string,
  spawn: StdinSpawn = bunStdinSpawn,
  platform: string = process.platform,
): Promise<Either<WorktreeError, void>> =>
  tryCommands(text, spawn, CLIPBOARD_COMMANDS[platform] ?? [], [])
