import { afterEach, beforeEach, describe, expect, test } from "bun:test"

describe("parseArgs", () => {
  let originalArgv: string[]

  beforeEach(() => {
    originalArgv = [...process.argv]
  })

  afterEach(() => {
    process.argv = originalArgv
  })

  test("--check sets isAuditOnly to true", async () => {
    process.argv = ["bun", "src/index.ts", "--check"]
    const { parseArgs } = await import("../cli/args.ts")
    const args = parseArgs()
    expect(args?.isAuditOnly).toBe(true)
  })

  test("--audit sets isAuditOnly to true", async () => {
    process.argv = ["bun", "src/index.ts", "--audit"]
    const { parseArgs } = await import("../cli/args.ts")
    const args = parseArgs()
    expect(args?.isAuditOnly).toBe(true)
  })

  test("no flags sets isAuditOnly to false", async () => {
    process.argv = ["bun", "src/index.ts"]
    const { parseArgs } = await import("../cli/args.ts")
    const args = parseArgs()
    expect(args?.isAuditOnly).toBe(false)
  })
})
