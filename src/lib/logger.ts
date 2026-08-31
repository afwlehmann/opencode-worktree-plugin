import type { OpencodeClient } from "@opencode-ai/sdk"

export type LogLevel = "debug" | "info" | "warn" | "error"

export type Logger = {
  readonly log: (level: LogLevel, message: string, extra?: Record<string, unknown>) => Promise<void>
}

export const createLogger = (client: OpencodeClient, service: string): Logger => ({
  async log(level, message, extra) {
    await client.app.log({
      body: {
        service,
        level,
        message,
        extra: extra ?? {},
      },
    })
  },
})
