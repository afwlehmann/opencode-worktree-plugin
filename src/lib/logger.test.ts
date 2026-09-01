import { describe, it, expect, vi, afterEach } from "vitest"
import type { OpencodeClient } from "@opencode-ai/sdk"
import { createLogger } from "./logger.js"

const recordingClient = (delivered: unknown[]) =>
  ({
    app: {
      log: async (input: unknown) => {
        delivered.push(input)
      },
    },
  }) as unknown as OpencodeClient

const failingClient = (): OpencodeClient =>
  ({
    app: {
      log: async () => {
        throw new Error("network down")
      },
    },
  }) as unknown as OpencodeClient

describe("createLogger", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("delivers structured log entries to the client", async () => {
    const delivered: unknown[] = []
    const logger = createLogger(recordingClient(delivered), "test-service")

    await logger.log("info", "hello", { key: "value" })

    expect(delivered).toEqual([
      {
        body: { service: "test-service", level: "info", message: "hello", extra: { key: "value" } },
      },
    ])
  })

  it("defaults extra to an empty object", async () => {
    const delivered: unknown[] = []
    const logger = createLogger(recordingClient(delivered), "test-service")

    await logger.log("warn", "hello")

    expect(delivered).toEqual([
      { body: { service: "test-service", level: "warn", message: "hello", extra: {} } },
    ])
  })

  it("does not throw when log delivery fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const logger = createLogger(failingClient(), "test-service")

    await logger.log("error", "important message")

    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy.mock.calls[0]?.[0]).toContain("important message")
    expect(errorSpy.mock.calls[0]?.[0]).toContain("network down")
  })
})
