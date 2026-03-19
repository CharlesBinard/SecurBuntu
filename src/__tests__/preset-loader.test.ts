import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { loadPreset, validatePreset, isFilePath } from "../presets/loader.ts"
import { BUILT_IN_PRESETS } from "../presets/built-in.ts"
import { mkdirSync, rmSync, writeFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

describe("isFilePath", () => {
  test("returns true for paths with /", () => {
    expect(isFilePath("./my-preset.json")).toBe(true)
    expect(isFilePath("/absolute/path.json")).toBe(true)
  })

  test("returns true for paths ending with .json", () => {
    expect(isFilePath("preset.json")).toBe(true)
  })

  test("returns false for plain names", () => {
    expect(isFilePath("web-server")).toBe(false)
    expect(isFilePath("my-preset")).toBe(false)
  })
})

describe("validatePreset", () => {
  test("accepts valid preset", () => {
    const preset = BUILT_IN_PRESETS["minimal"]
    expect(() => validatePreset(preset)).not.toThrow()
  })

  test("rejects missing name", () => {
    const bad = { version: 1, options: {} }
    expect(() => validatePreset(bad as any)).toThrow("name")
  })

  test("rejects wrong version", () => {
    const bad = { name: "test", description: "t", version: 2, options: BUILT_IN_PRESETS["minimal"].options }
    expect(() => validatePreset(bad as any)).toThrow("version")
  })

  test("rejects missing options field", () => {
    const bad = { name: "test", description: "t", version: 1 }
    expect(() => validatePreset(bad as any)).toThrow("options")
  })

  test("rejects missing required option field", () => {
    const bad = { name: "test", description: "t", version: 1, options: { changeSshPort: true } }
    expect(() => validatePreset(bad as any)).toThrow()
  })

  test("rejects invalid permitRootLogin value", () => {
    const opts = { ...BUILT_IN_PRESETS["minimal"].options, permitRootLogin: "invalid" }
    const bad = { name: "test", description: "t", version: 1, options: opts }
    expect(() => validatePreset(bad as any)).toThrow("permitRootLogin")
  })

  test("rejects changeSshPort true without newSshPort", () => {
    const opts = { ...BUILT_IN_PRESETS["minimal"].options, changeSshPort: true, newSshPort: undefined }
    const bad = { name: "test", description: "t", version: 1, options: opts }
    expect(() => validatePreset(bad as any)).toThrow("newSshPort")
  })
})

describe("loadPreset", () => {
  test("loads built-in preset by name", async () => {
    const preset = await loadPreset("minimal")
    expect(preset.name).toBe("minimal")
  })

  test("loads built-in presets: web-server, database, fortress", async () => {
    for (const name of ["web-server", "database", "fortress"]) {
      const preset = await loadPreset(name)
      expect(preset.name).toBe(name)
    }
  })

  test("throws for unknown preset name", async () => {
    expect(loadPreset("nonexistent")).rejects.toThrow()
  })

  test("loads preset from file path", async () => {
    const dir = join(tmpdir(), "securbuntu-test-" + Date.now())
    mkdirSync(dir, { recursive: true })
    const filePath = join(dir, "test-preset.json")
    writeFileSync(filePath, JSON.stringify(BUILT_IN_PRESETS["minimal"]))
    try {
      const preset = await loadPreset(filePath)
      expect(preset.name).toBe("minimal")
    } finally {
      rmSync(dir, { recursive: true })
    }
  })

  test("throws for invalid JSON file", async () => {
    const dir = join(tmpdir(), "securbuntu-test-" + Date.now())
    mkdirSync(dir, { recursive: true })
    const filePath = join(dir, "bad.json")
    writeFileSync(filePath, "not json{{{")
    try {
      expect(loadPreset(filePath)).rejects.toThrow()
    } finally {
      rmSync(dir, { recursive: true })
    }
  })
})

describe("listCustomPresetsFromDir", () => {
  test("returns empty array when dir does not exist", async () => {
    const { listCustomPresetsFromDir } = await import("../presets/loader.ts")
    const result = await listCustomPresetsFromDir("/nonexistent/path")
    expect(result).toEqual([])
  })

  test("lists valid JSON presets from directory", async () => {
    const { listCustomPresetsFromDir } = await import("../presets/loader.ts")
    const dir = join(tmpdir(), "securbuntu-list-test-" + Date.now())
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "my-preset.json"), JSON.stringify(BUILT_IN_PRESETS["minimal"]))
    writeFileSync(join(dir, ".DS_Store"), "junk")
    writeFileSync(join(dir, "bad.json"), "not json")
    try {
      const presets = await listCustomPresetsFromDir(dir)
      expect(presets).toHaveLength(1)
      expect(presets[0].name).toBe("minimal")
    } finally {
      rmSync(dir, { recursive: true })
    }
  })
})
