import { describe, expect, test } from "bun:test"
import { detectHostPlatform, isVersionAtLeast, parseOsRelease } from "../../platform/detect.ts"

describe("detectHostPlatform (live)", () => {
  test("returns a valid HostPlatform object", async () => {
    const platform = await detectHostPlatform()
    expect(typeof platform.os).toBe("string")
    expect(["linux", "macos", "windows"]).toContain(platform.os)
    expect(typeof platform.isCompatibleTarget).toBe("boolean")
  })

  test("distro and version are strings or null", async () => {
    const platform = await detectHostPlatform()
    expect(platform.distro === null || typeof platform.distro === "string").toBe(true)
    expect(platform.version === null || typeof platform.version === "string").toBe(true)
    expect(platform.codename === null || typeof platform.codename === "string").toBe(true)
  })

  test("isCompatibleTarget is false on non-linux platforms or non-Ubuntu", async () => {
    const platform = await detectHostPlatform()
    if (platform.os !== "linux" || platform.distro !== "ubuntu") {
      expect(platform.isCompatibleTarget).toBe(false)
    }
  })
})

describe("parseOsRelease", () => {
  test("parses valid pipe-separated os-release output", () => {
    const result = parseOsRelease("ubuntu|24.04|noble")
    expect(result.distro).toBe("ubuntu")
    expect(result.version).toBe("24.04")
    expect(result.codename).toBe("noble")
  })

  test("returns empty strings for missing parts", () => {
    const result = parseOsRelease("")
    expect(result.distro).toBe("")
    expect(result.version).toBe("")
    expect(result.codename).toBe("")
  })

  test("handles single-part input", () => {
    const result = parseOsRelease("fedora")
    expect(result.distro).toBe("fedora")
    expect(result.version).toBe("")
    expect(result.codename).toBe("")
  })

  test("parses debian entry", () => {
    const result = parseOsRelease("debian|12|bookworm")
    expect(result.distro).toBe("debian")
    expect(result.version).toBe("12")
    expect(result.codename).toBe("bookworm")
  })
})

describe("isVersionAtLeast", () => {
  test("Ubuntu 24.04 is at least 22.04", () => {
    expect(isVersionAtLeast("24.04", 22, 4)).toBe(true)
  })

  test("Ubuntu 22.04 meets the 22.04 minimum exactly", () => {
    expect(isVersionAtLeast("22.04", 22, 4)).toBe(true)
  })

  test("Ubuntu 20.04 does not meet 22.04 minimum", () => {
    expect(isVersionAtLeast("20.04", 22, 4)).toBe(false)
  })

  test("Ubuntu 22.03 does not meet 22.04 minimum", () => {
    expect(isVersionAtLeast("22.03", 22, 4)).toBe(false)
  })

  test("Ubuntu 22.10 meets 22.04 minimum", () => {
    expect(isVersionAtLeast("22.10", 22, 4)).toBe(true)
  })

  test("Ubuntu 23.10 meets 22.04 minimum", () => {
    expect(isVersionAtLeast("23.10", 22, 4)).toBe(true)
  })

  test("Ubuntu 26.04 meets 22.04 minimum", () => {
    expect(isVersionAtLeast("26.04", 22, 4)).toBe(true)
  })

  test("Ubuntu 18.04 does not meet 22.04 minimum", () => {
    expect(isVersionAtLeast("18.04", 22, 4)).toBe(false)
  })

  test("Ubuntu 16.04 does not meet 22.04 minimum", () => {
    expect(isVersionAtLeast("16.04", 22, 4)).toBe(false)
  })

  test("version with only major number (>= 24) meets 22.04", () => {
    expect(isVersionAtLeast("24", 22, 4)).toBe(true)
  })

  test("returns false for non-numeric version", () => {
    expect(isVersionAtLeast("rolling", 22, 4)).toBe(false)
  })
})
