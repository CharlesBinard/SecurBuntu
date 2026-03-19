import { describe, expect, test } from "bun:test"
import { BUILT_IN_PRESETS } from "../presets/built-in.ts"

describe("BUILT_IN_PRESETS", () => {
  test("contains exactly 4 presets", () => {
    expect(Object.keys(BUILT_IN_PRESETS)).toHaveLength(4)
  })

  test("has minimal, web-server, database, fortress", () => {
    expect(BUILT_IN_PRESETS).toHaveProperty("minimal")
    expect(BUILT_IN_PRESETS).toHaveProperty("web-server")
    expect(BUILT_IN_PRESETS).toHaveProperty("database")
    expect(BUILT_IN_PRESETS).toHaveProperty("fortress")
  })

  test("all presets have required fields", () => {
    for (const [name, preset] of Object.entries(BUILT_IN_PRESETS)) {
      expect(preset.name).toBe(name)
      expect(preset.description).toBeTruthy()
      expect(preset.version).toBe(1)
      expect(preset.options).toBeTruthy()
      expect(typeof preset.options.changeSshPort).toBe("boolean")
      expect(typeof preset.options.disablePasswordAuth).toBe("boolean")
      expect(typeof preset.options.installUfw).toBe("boolean")
      expect(Array.isArray(preset.options.ufwPorts)).toBe(true)
    }
  })

  test("all presets enable SSH port change with port 2222", () => {
    for (const preset of Object.values(BUILT_IN_PRESETS)) {
      expect(preset.options.changeSshPort).toBe(true)
      expect(preset.options.newSshPort).toBe(2222)
    }
  })

  test("minimal has UFW with SSH only", () => {
    const m = BUILT_IN_PRESETS["minimal"]!
    expect(m.options.installUfw).toBe(true)
    expect(m.options.ufwPorts).toEqual([])
    expect(m.options.installFail2ban).toBe(false)
    expect(m.options.enableAutoUpdates).toBe(false)
  })

  test("web-server has HTTP/HTTPS ports and Fail2ban", () => {
    const ws = BUILT_IN_PRESETS["web-server"]!
    expect(ws.options.ufwPorts).toEqual([
      { port: "80", protocol: "tcp", comment: "HTTP" },
      { port: "443", protocol: "tcp", comment: "HTTPS" },
    ])
    expect(ws.options.installFail2ban).toBe(true)
    expect(ws.options.enableAutoUpdates).toBe(true)
  })

  test("database has kernel hardening and file permissions", () => {
    const db = BUILT_IN_PRESETS["database"]!
    expect(db.options.enableSysctl).toBe(true)
    expect(db.options.sysctlOptions).toBeTruthy()
    expect(db.options.fixFilePermissions).toBe(true)
  })

  test("fortress has everything enabled", () => {
    const f = BUILT_IN_PRESETS["fortress"]!
    expect(f.options.enableSysctl).toBe(true)
    expect(f.options.disableServices).toBe(true)
    expect(f.options.servicesToDisable.length).toBeGreaterThan(0)
    expect(f.options.fixFilePermissions).toBe(true)
    expect(f.options.installFail2ban).toBe(true)
    expect(f.options.enableAutoUpdates).toBe(true)
  })
})
