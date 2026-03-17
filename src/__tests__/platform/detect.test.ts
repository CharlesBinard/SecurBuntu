import { describe, expect, test } from "bun:test"
import { detectHostPlatform, isVersionAtLeast, parseOsRelease } from "../../platform/detect.ts"

describe("parseOsRelease", () => {
  test("parses valid Ubuntu 24.04", () => {
    const result = parseOsRelease("ubuntu|24.04|noble")
    expect(result).toEqual({ distro: "ubuntu", version: "24.04", codename: "noble" })
  })

  test("parses valid Ubuntu 22.04", () => {
    const result = parseOsRelease("ubuntu|22.04|jammy")
    expect(result).toEqual({ distro: "ubuntu", version: "22.04", codename: "jammy" })
  })

  test("parses Debian", () => {
    const result = parseOsRelease("debian|12|bookworm")
    expect(result).toEqual({ distro: "debian", version: "12", codename: "bookworm" })
  })

  test("returns empty fields for malformed input", () => {
    const result = parseOsRelease("garbage")
    expect(result).toEqual({ distro: "garbage", version: "", codename: "" })
  })

  test("handles empty string", () => {
    const result = parseOsRelease("")
    expect(result).toEqual({ distro: "", version: "", codename: "" })
  })

  test("handles pipe-only string", () => {
    const result = parseOsRelease("||")
    expect(result).toEqual({ distro: "", version: "", codename: "" })
  })
})

describe("isVersionAtLeast", () => {
  test("22.04 meets 22.04", () => {
    expect(isVersionAtLeast("22.04", 22, 4)).toBe(true)
  })

  test("24.04 meets 22.04", () => {
    expect(isVersionAtLeast("24.04", 22, 4)).toBe(true)
  })

  test("20.04 does not meet 22.04", () => {
    expect(isVersionAtLeast("20.04", 22, 4)).toBe(false)
  })

  test("22.03 does not meet 22.04", () => {
    expect(isVersionAtLeast("22.03", 22, 4)).toBe(false)
  })

  test("23.10 meets 22.04", () => {
    expect(isVersionAtLeast("23.10", 22, 4)).toBe(true)
  })

  test("handles major-only version string", () => {
    expect(isVersionAtLeast("24", 22, 4)).toBe(true)
  })

  test("returns false for empty string", () => {
    expect(isVersionAtLeast("", 22, 4)).toBe(false)
  })
})

describe("detectHostPlatform", () => {
  test("returns a valid HostPlatform object", async () => {
    const platform = await detectHostPlatform()
    expect(["linux", "macos", "windows"]).toContain(platform.os)
    expect(typeof platform.isCompatibleTarget).toBe("boolean")
  })

  test("on Linux, populates distro and version", async () => {
    const platform = await detectHostPlatform()
    if (platform.os === "linux") {
      expect(platform.distro).not.toBeNull()
      expect(platform.version).not.toBeNull()
    }
  })

  test("on non-Linux, distro and version are null", async () => {
    const platform = await detectHostPlatform()
    if (platform.os !== "linux") {
      expect(platform.distro).toBeNull()
      expect(platform.version).toBeNull()
      expect(platform.codename).toBeNull()
      expect(platform.isCompatibleTarget).toBe(false)
    }
  })
})
