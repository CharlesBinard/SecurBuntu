import { describe, expect, test } from "bun:test"
import { validateLocalUbuntu } from "../../connection/mode.ts"

describe("validateLocalUbuntu", () => {
  test("returns version info for valid Ubuntu", async () => {
    const result = await validateLocalUbuntu()
    if (result.error) {
      console.log(`Skipping: ${result.error}`)
      return
    }
    expect(result.version).toBeDefined()
    expect(typeof result.version).toBe("string")
  })
})
