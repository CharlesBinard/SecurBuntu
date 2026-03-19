import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, readFileSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { BUILT_IN_PRESETS } from "../presets/built-in.ts"
import { presetToHardeningOptions } from "../presets/converter.ts"
import { sanitizeName, savePreset } from "../presets/saver.ts"
import type { Preset } from "../types.ts"

describe("sanitizeName", () => {
  test("lowercases", () => {
    expect(sanitizeName("MyPreset")).toBe("mypreset")
  })

  test("replaces spaces with hyphens", () => {
    expect(sanitizeName("my preset")).toBe("my-preset")
  })

  test("removes special chars", () => {
    expect(sanitizeName("my@preset!")).toBe("mypreset")
  })

  test("collapses multiple hyphens", () => {
    expect(sanitizeName("my--preset")).toBe("my-preset")
  })

  test("trims leading/trailing hyphens", () => {
    expect(sanitizeName("-my-preset-")).toBe("my-preset")
  })
})

describe("savePreset", () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `securbuntu-save-test-${Date.now()}`)
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true })
    }
  })

  test("saves preset as JSON file", () => {
    const opts = presetToHardeningOptions(BUILT_IN_PRESETS.minimal as Preset)
    const path = savePreset("my-vps", opts, "Test preset", testDir)
    expect(existsSync(path)).toBe(true)
    const content = JSON.parse(readFileSync(path, "utf-8"))
    expect(content.name).toBe("my-vps")
    expect(content.version).toBe(1)
    expect(content.options.changeSshPort).toBe(true)
  })

  test("creates directory if it does not exist", () => {
    const dir = join(testDir, "nested", "presets")
    const opts = presetToHardeningOptions(BUILT_IN_PRESETS.minimal as Preset)
    savePreset("test", opts, "Test", dir)
    expect(existsSync(dir)).toBe(true)
  })

  test("rejects built-in preset names", () => {
    const opts = presetToHardeningOptions(BUILT_IN_PRESETS.minimal as Preset)
    expect(() => savePreset("minimal", opts, "Test", testDir)).toThrow("built-in")
    expect(() => savePreset("web-server", opts, "Test", testDir)).toThrow("built-in")
    expect(() => savePreset("database", opts, "Test", testDir)).toThrow("built-in")
    expect(() => savePreset("fortress", opts, "Test", testDir)).toThrow("built-in")
  })

  test("sanitizes the name for the filename", () => {
    const opts = presetToHardeningOptions(BUILT_IN_PRESETS.minimal as Preset)
    const path = savePreset("My VPS!", opts, "Test", testDir)
    expect(path).toContain("my-vps.json")
  })
})
