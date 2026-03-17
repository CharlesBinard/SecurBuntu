import { describe, expect, test } from "bun:test"
import type { CopyKeyResult } from "../../ssh/copy-key.ts"

describe("CopyKeyResult type", () => {
  test("has expected shape", () => {
    const result: CopyKeyResult = { success: true, passwordAuthDisabled: false }
    expect(result.success).toBe(true)
    expect(result.passwordAuthDisabled).toBe(false)
  })
})
