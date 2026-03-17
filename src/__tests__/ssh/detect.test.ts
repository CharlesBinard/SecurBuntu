import { describe, expect, test } from "bun:test"
import {
  detectAllLocalKeys,
  detectDefaultKeyPath,
  detectDefaultPubKeyPath,
  detectServerInfo,
} from "../../ssh/detect.ts"
import { MockSystemClient } from "../helpers/mock-ssh.ts"

describe("detectAllLocalKeys", () => {
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

  test("key paths start with HOME/.ssh/", () => {
    const keys = detectAllLocalKeys()
    const home = process.env.HOME ?? ""
    for (const key of keys) {
      expect(key.path.startsWith(`${home}/.ssh/id_`)).toBe(true)
    }
  })

  test("only returns ed25519, ecdsa, and rsa key types", () => {
    const keys = detectAllLocalKeys()
    const validTypes = new Set(["ed25519", "ecdsa", "rsa"])
    for (const key of keys) {
      expect(validTypes.has(key.type)).toBe(true)
    }
  })

  test("each key path matches its type", () => {
    const keys = detectAllLocalKeys()
    for (const key of keys) {
      expect(key.path).toContain(`id_${key.type}`)
    }
  })

  test("returns at most 3 keys", () => {
    const keys = detectAllLocalKeys()
    expect(keys.length).toBeLessThanOrEqual(3)
  })
})

describe("detectDefaultKeyPath", () => {
  test("returns a string path if any key exists", () => {
    const result = detectDefaultKeyPath()
    if (result !== undefined) {
      expect(typeof result).toBe("string")
      expect(result).toContain("/.ssh/id_")
    }
  })

  test("returned path does not have .pub extension", () => {
    const result = detectDefaultKeyPath()
    if (result !== undefined) {
      expect(result.endsWith(".pub")).toBe(false)
    }
  })

  test("prefers ed25519 when available", () => {
    const result = detectDefaultKeyPath()
    // If ed25519 key exists at ~/.ssh/id_ed25519, it should be the default
    if (result?.includes("id_ed25519")) {
      expect(result).toMatch(/id_ed25519$/)
    }
  })
})

describe("detectDefaultPubKeyPath", () => {
  test("returns a path ending in .pub when a key exists", () => {
    const result = detectDefaultPubKeyPath()
    if (result !== undefined) {
      expect(result).toMatch(/\.pub$/)
    }
  })

  test("returned path contains .ssh directory", () => {
    const result = detectDefaultPubKeyPath()
    if (result !== undefined) {
      expect(result).toContain("/.ssh/")
    }
  })

  test("returned path matches a known key type", () => {
    const result = detectDefaultPubKeyPath()
    if (result !== undefined) {
      const knownPatterns = ["id_ed25519.pub", "id_ecdsa.pub", "id_rsa.pub"]
      const matchesKnown = knownPatterns.some((p) => result.endsWith(p))
      expect(matchesKnown).toBe(true)
    }
  })
})

describe("detectServerInfo", () => {
  test("returns server info for valid Ubuntu 24.04", async () => {
    const client = new MockSystemClient()
    client.onExec("os-release", { stdout: "ubuntu|24.04|noble" })
    client.onExec("ssh.socket", { stdout: "active" })
    client.onExec("cloud-init", { stdout: "yes" })

    const info = await detectServerInfo(client)
    expect(info.ubuntuVersion).toBe("24.04")
    expect(info.ubuntuCodename).toBe("noble")
    expect(info.usesSocketActivation).toBe(true)
    expect(info.hasCloudInit).toBe(true)
    expect(info.isRoot).toBe(true)
  })

  test("returns server info for Ubuntu 22.04", async () => {
    const client = new MockSystemClient()
    client.onExec("os-release", { stdout: "ubuntu|22.04|jammy" })
    client.onExec("ssh.socket", { stdout: "inactive" })
    client.onExec("cloud-init", { stdout: "no" })

    const info = await detectServerInfo(client)
    expect(info.ubuntuVersion).toBe("22.04")
    expect(info.ubuntuCodename).toBe("jammy")
    expect(info.usesSocketActivation).toBe(false)
    expect(info.hasCloudInit).toBe(false)
  })

  test("throws for non-Ubuntu OS", async () => {
    const client = new MockSystemClient()
    client.onExec("os-release", { stdout: "debian|12|bookworm" })

    await expect(detectServerInfo(client)).rejects.toThrow("Unsupported OS: debian")
  })

  test("throws for old Ubuntu version", async () => {
    const client = new MockSystemClient()
    client.onExec("os-release", { stdout: "ubuntu|20.04|focal" })

    await expect(detectServerInfo(client)).rejects.toThrow("Ubuntu 20.04 is not supported")
  })

  test("throws when OS detection command fails", async () => {
    const client = new MockSystemClient()
    client.onExec("os-release", { exitCode: 1, stderr: "permission denied" })

    await expect(detectServerInfo(client)).rejects.toThrow("Failed to detect OS")
  })

  test("throws for Ubuntu 22.03 (just below minimum)", async () => {
    const client = new MockSystemClient()
    client.onExec("os-release", { stdout: "ubuntu|22.03|pre-jammy" })

    await expect(detectServerInfo(client)).rejects.toThrow("not supported")
  })

  test("accepts Ubuntu 22.04 (minimum)", async () => {
    const client = new MockSystemClient()
    client.onExec("os-release", { stdout: "ubuntu|22.04|jammy" })
    client.onExec("ssh.socket", { stdout: "" })
    client.onExec("cloud-init", { stdout: "no" })

    const info = await detectServerInfo(client)
    expect(info.ubuntuVersion).toBe("22.04")
  })

  test("accepts Ubuntu 23.10", async () => {
    const client = new MockSystemClient()
    client.onExec("os-release", { stdout: "ubuntu|23.10|mantic" })
    client.onExec("ssh.socket", { stdout: "" })
    client.onExec("cloud-init", { stdout: "no" })

    const info = await detectServerInfo(client)
    expect(info.ubuntuVersion).toBe("23.10")
  })

  test("throws for unknown OS with malformed output", async () => {
    const client = new MockSystemClient()
    client.onExec("os-release", { stdout: "unknown" })

    await expect(detectServerInfo(client)).rejects.toThrow("Unsupported OS")
  })

  test("reflects isRoot from client", async () => {
    const rootClient = new MockSystemClient(true)
    rootClient.onExec("os-release", { stdout: "ubuntu|24.04|noble" })
    rootClient.onExec("ssh.socket", { stdout: "" })
    rootClient.onExec("cloud-init", { stdout: "no" })

    const rootInfo = await detectServerInfo(rootClient)
    expect(rootInfo.isRoot).toBe(true)

    const nonRootClient = new MockSystemClient(false)
    nonRootClient.onExec("os-release", { stdout: "ubuntu|24.04|noble" })
    nonRootClient.onExec("ssh.socket", { stdout: "" })
    nonRootClient.onExec("cloud-init", { stdout: "no" })

    const nonRootInfo = await detectServerInfo(nonRootClient)
    expect(nonRootInfo.isRoot).toBe(false)
  })

  test("throws for Ubuntu 18.04", async () => {
    const client = new MockSystemClient()
    client.onExec("os-release", { stdout: "ubuntu|18.04|bionic" })

    await expect(detectServerInfo(client)).rejects.toThrow("not supported")
  })

  test("handles empty OS output as unsupported", async () => {
    const client = new MockSystemClient()
    client.onExec("os-release", { stdout: "||" })

    await expect(detectServerInfo(client)).rejects.toThrow("Unsupported OS")
  })

  test("socket activation is false when not active", async () => {
    const client = new MockSystemClient()
    client.onExec("os-release", { stdout: "ubuntu|24.04|noble" })
    client.onExec("ssh.socket", { stdout: "inactive" })
    client.onExec("cloud-init", { stdout: "yes" })

    const info = await detectServerInfo(client)
    expect(info.usesSocketActivation).toBe(false)
  })

  test("cloud init is false when file is missing", async () => {
    const client = new MockSystemClient()
    client.onExec("os-release", { stdout: "ubuntu|24.04|noble" })
    client.onExec("ssh.socket", { stdout: "active" })
    client.onExec("cloud-init", { stdout: "no" })

    const info = await detectServerInfo(client)
    expect(info.hasCloudInit).toBe(false)
  })

  test("throws for CentOS", async () => {
    const client = new MockSystemClient()
    client.onExec("os-release", { stdout: "centos|9|stream" })

    await expect(detectServerInfo(client)).rejects.toThrow("Unsupported OS: centos")
  })

  test("includes minimum version in error for old Ubuntu", async () => {
    const client = new MockSystemClient()
    client.onExec("os-release", { stdout: "ubuntu|16.04|xenial" })

    await expect(detectServerInfo(client)).rejects.toThrow("Minimum required: 22.04")
  })
})
