import { describe, expect, test } from "bun:test"
import { resolveHome } from "../../platform/home.ts"

describe("resolveHome", () => {
  test("returns a non-empty string", () => {
    const home = resolveHome()
    expect(typeof home).toBe("string")
    expect(home.length).toBeGreaterThan(0)
  })

  test("returns the same value on repeated calls", () => {
    expect(resolveHome()).toBe(resolveHome())
  })
})
