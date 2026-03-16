import { afterEach, describe, expect, test } from "bun:test"
import { detectAllLocalKeys } from "../../ssh/detect.ts"

describe("detectAllLocalKeys", () => {
  const originalHome = process.env.HOME

  afterEach(() => {
    process.env.HOME = originalHome
  })

  test("returns empty array when HOME is unset", () => {
    process.env.HOME = ""
    const keys = detectAllLocalKeys()
    expect(keys).toEqual([])
  })

  test("finds keys with correct structure", () => {
    const keys = detectAllLocalKeys()
    for (const key of keys) {
      expect(key.path).toContain("/.ssh/")
      expect(["ed25519", "ecdsa", "rsa"]).toContain(key.type)
    }
  })

  test("returns keys in priority order (ed25519, ecdsa, rsa)", () => {
    const keys = detectAllLocalKeys()
    if (keys.length >= 2) {
      const typeOrder = ["ed25519", "ecdsa", "rsa"]
      for (let i = 1; i < keys.length; i++) {
        const prevIdx = typeOrder.indexOf(keys[i - 1]?.type ?? "")
        const currIdx = typeOrder.indexOf(keys[i]?.type ?? "")
        expect(prevIdx).toBeLessThanOrEqual(currIdx)
      }
    }
  })
})
