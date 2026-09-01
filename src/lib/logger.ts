import type { OpencodeClient } from "@opencode-ai/sdk"

export type LogLevel = "debug" | "info" | "warn" | "error"

export type Logger = {
  readonly log: (level: LogLevel, message: string, extra?: Record<string, unknown>) => Promise<void>
}

export const createLogger = (client: OpencodeClient, service: string): Logger => ({
  async log(level, message, extra) {
    const body = {
      service,
      level,
      message,
      extra: extra ?? {},
    }
    try {
      await client.app.log({ body })
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      console.error(`[${service}] ${level}: ${message} (log delivery failed: ${reason})`)
    }
  },
})
