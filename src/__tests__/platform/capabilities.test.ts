import { describe, expect, test } from "bun:test"
import {
  commandExists,
  detectCapabilities,
  getInstallCommand,
  getManualInstallHint,
} from "../../platform/capabilities.ts"
import type { HostPlatform } from "../../types.ts"

const linuxPlatform: HostPlatform = {
  os: "linux",
  distro: "ubuntu",
  version: "24.04",
  codename: "noble",
  isCompatibleTarget: true,
}

const macosPlatform: HostPlatform = {
  os: "macos",
  distro: null,
  version: null,
  codename: null,
  isCompatibleTarget: false,
}

const windowsPlatform: HostPlatform = {
  os: "windows",
  distro: null,
  version: null,
  codename: null,
  isCompatibleTarget: false,
}

describe("commandExists", () => {
  test("returns true for a command that exists (bash)", async () => {
    const result = await commandExists("bash", linuxPlatform)
    expect(result).toBe(true)
  })

  test("returns false for a command that does not exist", async () => {
    const result = await commandExists("definitely-not-a-real-command-xyz", linuxPlatform)
    expect(result).toBe(false)
  })
})

describe("detectCapabilities", () => {
  test("returns an object with all required fields", async () => {
    const caps = await detectCapabilities(linuxPlatform)
    expect(typeof caps.ssh).toBe("boolean")
    expect(typeof caps.sshCopyId).toBe("boolean")
    expect(typeof caps.sshpass).toBe("boolean")
    expect(typeof caps.sshKeygen).toBe("boolean")
    expect(typeof caps.sshKeyscan).toBe("boolean")
  })

  test("ssh is typically available on Linux", async () => {
    const caps = await detectCapabilities(linuxPlatform)
    expect(caps.ssh).toBe(true)
  })
})

describe("getInstallCommand", () => {
  test("returns apt command for ssh on Linux", () => {
    expect(getInstallCommand("ssh", linuxPlatform)).toBe("sudo apt install openssh-client")
  })

  test("returns null for ssh on macOS (already included)", () => {
    expect(getInstallCommand("ssh", macosPlatform)).toBeNull()
  })

  test("returns null for ssh on Windows (manual install)", () => {
    expect(getInstallCommand("ssh", windowsPlatform)).toBeNull()
  })

  test("returns apt command for sshpass on Linux", () => {
    expect(getInstallCommand("sshpass", linuxPlatform)).toBe("sudo apt install sshpass")
  })

  test("returns null for sshpass on macOS (not in default brew)", () => {
    expect(getInstallCommand("sshpass", macosPlatform)).toBeNull()
  })

  test("returns null for sshpass on Windows (does not exist)", () => {
    expect(getInstallCommand("sshpass", windowsPlatform)).toBeNull()
  })

  test("returns brew command for ssh-copy-id on macOS", () => {
    expect(getInstallCommand("ssh-copy-id", macosPlatform)).toBe("brew install ssh-copy-id")
  })

  test("returns null for ssh-copy-id on Windows (TS fallback used)", () => {
    expect(getInstallCommand("ssh-copy-id", windowsPlatform)).toBeNull()
  })
})

describe("getManualInstallHint", () => {
  test("returns Windows SSH install hint", () => {
    const hint = getManualInstallHint("ssh", windowsPlatform)
    expect(hint).toContain("Settings")
    expect(hint).toContain("OpenSSH")
  })

  test("returns macOS sshpass hint about third-party tap", () => {
    const hint = getManualInstallHint("sshpass", macosPlatform)
    expect(hint).toContain("esolitos")
  })

  test("returns null when no hint available", () => {
    expect(getManualInstallHint("ssh", linuxPlatform)).toBeNull()
  })
})
