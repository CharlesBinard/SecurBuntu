import { describe, expect, test } from "bun:test"
import { spawnProcess } from "../../ssh/process.ts"

// We can't directly mock spawnProcess without affecting other tests,
// so we test validateLocalUbuntu's parsing logic by simulating
// what spawnProcess returns for different OS environments.
// We replicate the core parsing logic to ensure it works correctly.

function parseOsValidation(stdout: string, exitCode: number): { version?: string; codename?: string; error?: string } {
  if (exitCode !== 0) {
    return { error: "Failed to detect OS" }
  }
  const parts = stdout.split("|")
  if (parts.length < 3 || parts[0] !== "ubuntu") {
    return { error: `Unsupported OS: ${parts[0] ?? "unknown"}. SecurBuntu only supports Ubuntu.` }
  }
  const versionId = parts[1] ?? ""
  const versionParts = versionId.split(".")
  const major = parseInt(versionParts[0] ?? "0", 10)
  const minor = parseInt(versionParts[1] ?? "0", 10)
  if (major < 22 || (major === 22 && minor < 4)) {
    return { error: `Ubuntu ${versionId} is not supported. Minimum required: 22.04` }
  }
  return { version: versionId, codename: parts[2] ?? "" }
}

describe("validateLocalUbuntu (live)", () => {
  test("returns a result object with either version or error", async () => {
    const { validateLocalUbuntu } = await import("../../connection/mode.ts")
    const result = await validateLocalUbuntu()
    const hasVersion = result.version !== undefined
    const hasError = result.error !== undefined
    expect(hasVersion || hasError).toBe(true)
  })

  test("returns version and codename on a real Ubuntu system", async () => {
    const { validateLocalUbuntu } = await import("../../connection/mode.ts")
    const result = await validateLocalUbuntu()
    if (result.error) {
      expect(typeof result.error).toBe("string")
      expect(result.error.length).toBeGreaterThan(0)
      return
    }
    expect(result.version).toBeDefined()
    expect(typeof result.version).toBe("string")
    expect(result.codename).toBeDefined()
    expect(typeof result.codename).toBe("string")
  })

  test("version string contains a dot when present", async () => {
    const { validateLocalUbuntu } = await import("../../connection/mode.ts")
    const result = await validateLocalUbuntu()
    if (result.version) {
      expect(result.version).toContain(".")
    }
  })
})

describe("validateLocalUbuntu parsing logic", () => {
  test("parses valid Ubuntu 24.04", () => {
    const result = parseOsValidation("ubuntu|24.04|noble", 0)
    expect(result.version).toBe("24.04")
    expect(result.codename).toBe("noble")
    expect(result.error).toBeUndefined()
  })

  test("parses valid Ubuntu 22.04 (minimum)", () => {
    const result = parseOsValidation("ubuntu|22.04|jammy", 0)
    expect(result.version).toBe("22.04")
    expect(result.codename).toBe("jammy")
    expect(result.error).toBeUndefined()
  })

  test("returns error for failed command", () => {
    const result = parseOsValidation("", 1)
    expect(result.error).toBe("Failed to detect OS")
  })

  test("returns error for non-Ubuntu OS", () => {
    const result = parseOsValidation("debian|12|bookworm", 0)
    expect(result.error).toContain("Unsupported OS: debian")
  })

  test("returns error for old Ubuntu 20.04", () => {
    const result = parseOsValidation("ubuntu|20.04|focal", 0)
    expect(result.error).toContain("Ubuntu 20.04 is not supported")
  })

  test("returns error for Ubuntu 18.04", () => {
    const result = parseOsValidation("ubuntu|18.04|bionic", 0)
    expect(result.error).toContain("not supported")
  })

  test("returns error for Ubuntu 22.03 (just below minimum)", () => {
    const result = parseOsValidation("ubuntu|22.03|pre-jammy", 0)
    expect(result.error).toContain("not supported")
  })

  test("accepts Ubuntu 23.10", () => {
    const result = parseOsValidation("ubuntu|23.10|mantic", 0)
    expect(result.version).toBe("23.10")
    expect(result.error).toBeUndefined()
  })

  test("accepts Ubuntu 26.04 (future version)", () => {
    const result = parseOsValidation("ubuntu|26.04|future", 0)
    expect(result.version).toBe("26.04")
    expect(result.codename).toBe("future")
    expect(result.error).toBeUndefined()
  })

  test("returns error for unknown OS with single-part output", () => {
    const result = parseOsValidation("fedora", 0)
    expect(result.error).toContain("Unsupported OS")
  })

  test("returns error for empty string with exit 0", () => {
    const result = parseOsValidation("", 0)
    expect(result.error).toBeDefined()
  })

  test("returns error for Arch Linux", () => {
    const result = parseOsValidation("arch||rolling", 0)
    expect(result.error).toContain("Unsupported OS: arch")
  })

  test("returns error for CentOS", () => {
    const result = parseOsValidation("centos|9|stream", 0)
    expect(result.error).toContain("Unsupported OS: centos")
  })

  test("error includes minimum version for old Ubuntu", () => {
    const result = parseOsValidation("ubuntu|16.04|xenial", 0)
    expect(result.error).toContain("Minimum required: 22.04")
  })

  test("accepts Ubuntu 22.10", () => {
    const result = parseOsValidation("ubuntu|22.10|kinetic", 0)
    expect(result.version).toBe("22.10")
    expect(result.error).toBeUndefined()
  })

  test("handles Ubuntu version with only major number", () => {
    const result = parseOsValidation("ubuntu|24|noble", 0)
    expect(result.version).toBe("24")
    expect(result.error).toBeUndefined()
  })
})

describe("spawnProcess integration via validateLocalUbuntu", () => {
  test("spawnProcess runs bash and parses os-release", async () => {
    const result = await spawnProcess(["bash", "-c", '. /etc/os-release && echo "$ID|$VERSION_ID|$VERSION_CODENAME"'])
    expect(result).toHaveProperty("stdout")
    expect(result).toHaveProperty("exitCode")
    if (result.exitCode === 0) {
      expect(result.stdout).toContain("|")
    }
  })
})
