import { describe, expect, test, afterEach } from "bun:test"
import { getConfigDir, getPresetsDir } from "../presets/config-dir.ts"

describe("getConfigDir", () => {
  const originalPlatform = process.platform

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform })
  })

  test("returns ~/.config/securbuntu on linux", () => {
    Object.defineProperty(process, "platform", { value: "linux" })
    const dir = getConfigDir()
    expect(dir).toContain(".config")
    expect(dir).toContain("securbuntu")
  })

  test("returns Library/Application Support/securbuntu on darwin", () => {
    Object.defineProperty(process, "platform", { value: "darwin" })
    const dir = getConfigDir()
    expect(dir).toContain("Library/Application Support/securbuntu")
  })

  test("returns securbuntu in APPDATA on win32", () => {
    Object.defineProperty(process, "platform", { value: "win32" })
    const dir = getConfigDir()
    expect(dir).toContain("securbuntu")
  })
})

describe("getPresetsDir", () => {
  test("appends /presets to config dir", () => {
    const dir = getPresetsDir()
    expect(dir).toEndWith("/presets")
    expect(dir).toContain("securbuntu")
  })
})
