import { describe, expect, test } from "bun:test"
import { buildSshArgs, hashControlPath, shellEscape } from "../../ssh/connection.ts"
import type { ConnectionConfig, HostPlatform } from "../../types.ts"

const linuxPlatform: HostPlatform = {
  os: "linux",
  distro: "ubuntu",
  version: "24.04",
  codename: "noble",
  isCompatibleTarget: true,
}

const windowsPlatform: HostPlatform = {
  os: "windows",
  distro: null,
  version: null,
  codename: null,
  isCompatibleTarget: false,
}

describe("shellEscape", () => {
  test("wraps simple string in single quotes", () => {
    expect(shellEscape("hello")).toBe("'hello'")
  })

  test("escapes single quotes within string", () => {
    expect(shellEscape("it's")).toBe("'it'\\''s'")
  })

  test("handles empty string", () => {
    expect(shellEscape("")).toBe("''")
  })

  test("handles string with multiple single quotes", () => {
    expect(shellEscape("a'b'c")).toBe("'a'\\''b'\\''c'")
  })

  test("handles string with spaces", () => {
    expect(shellEscape("hello world")).toBe("'hello world'")
  })

  test("handles string with special characters", () => {
    expect(shellEscape("$HOME")).toBe("'$HOME'")
  })

  test("handles string with backslash", () => {
    expect(shellEscape("back\\slash")).toBe("'back\\slash'")
  })

  test("handles string with double quotes", () => {
    expect(shellEscape('say "hi"')).toBe("'say \"hi\"'")
  })

  test("handles string with newlines", () => {
    expect(shellEscape("line1\nline2")).toBe("'line1\nline2'")
  })

  test("handles path-like strings", () => {
    expect(shellEscape("/etc/ssh/sshd_config")).toBe("'/etc/ssh/sshd_config'")
  })
})

describe("hashControlPath", () => {
  test("returns a path starting with /tmp/securbuntu-", () => {
    const result = hashControlPath("root", "example.com", 22)
    expect(result).toMatch(/^\/tmp\/securbuntu-[a-f0-9]{12}$/)
  })

  test("returns deterministic output for same input", () => {
    const a = hashControlPath("user", "host.com", 22)
    const b = hashControlPath("user", "host.com", 22)
    expect(a).toBe(b)
  })

  test("produces different hashes for different users", () => {
    const a = hashControlPath("alice", "host.com", 22)
    const b = hashControlPath("bob", "host.com", 22)
    expect(a).not.toBe(b)
  })

  test("produces different hashes for different hosts", () => {
    const a = hashControlPath("root", "host1.com", 22)
    const b = hashControlPath("root", "host2.com", 22)
    expect(a).not.toBe(b)
  })

  test("produces different hashes for different ports", () => {
    const a = hashControlPath("root", "host.com", 22)
    const b = hashControlPath("root", "host.com", 2222)
    expect(a).not.toBe(b)
  })

  test("hash is 12 hex characters", () => {
    const result = hashControlPath("test", "test.com", 22)
    const hash = result.replace("/tmp/securbuntu-", "")
    expect(hash).toHaveLength(12)
    expect(hash).toMatch(/^[a-f0-9]+$/)
  })
})

describe("buildSshArgs", () => {
  const baseConfig: ConnectionConfig = {
    host: "example.com",
    port: 22,
    username: "root",
    authMethod: "password",
    controlPath: "/tmp/securbuntu-abc123",
  }

  test("includes ControlPath from config", () => {
    const args = buildSshArgs(baseConfig, linuxPlatform)
    const idx = args.indexOf("ControlPath=/tmp/securbuntu-abc123")
    expect(idx).toBeGreaterThan(-1)
  })

  test("includes StrictHostKeyChecking=yes", () => {
    const args = buildSshArgs(baseConfig, linuxPlatform)
    expect(args).toContain("StrictHostKeyChecking=yes")
  })

  test("includes ConnectTimeout=10", () => {
    const args = buildSshArgs(baseConfig, linuxPlatform)
    expect(args).toContain("ConnectTimeout=10")
  })

  test("includes port as string", () => {
    const args = buildSshArgs(baseConfig, linuxPlatform)
    const portIdx = args.indexOf("-p")
    expect(portIdx).toBeGreaterThan(-1)
    expect(args[portIdx + 1]).toBe("22")
  })

  test("uses custom port", () => {
    const config: ConnectionConfig = { ...baseConfig, port: 2222 }
    const args = buildSshArgs(config, linuxPlatform)
    const portIdx = args.indexOf("-p")
    expect(args[portIdx + 1]).toBe("2222")
  })

  test("includes -i flag and PreferredAuthentications=publickey for key-based auth", () => {
    const config: ConnectionConfig = {
      ...baseConfig,
      authMethod: "key",
      privateKeyPath: "/home/user/.ssh/id_ed25519",
    }
    const args = buildSshArgs(config, linuxPlatform)
    expect(args).toContain("-i")
    expect(args).toContain("/home/user/.ssh/id_ed25519")
    expect(args).toContain("PreferredAuthentications=publickey")
  })

  test("does not include -i flag or PreferredAuthentications for password auth", () => {
    const args = buildSshArgs(baseConfig, linuxPlatform)
    expect(args).not.toContain("-i")
    const hasPrefAuth = args.some((a) => a.startsWith("PreferredAuthentications="))
    expect(hasPrefAuth).toBe(false)
  })

  test("does not include -i when authMethod is key but no privateKeyPath", () => {
    const config: ConnectionConfig = { ...baseConfig, authMethod: "key" }
    const args = buildSshArgs(config, linuxPlatform)
    expect(args).not.toContain("-i")
  })

  test("all -o flags are paired correctly", () => {
    const args = buildSshArgs(baseConfig, linuxPlatform)
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "-o") {
        const next = args[i + 1]
        expect(next).toBeDefined()
        expect(typeof next).toBe("string")
        expect(next?.length).toBeGreaterThan(0)
      }
    }
  })

  test("includes ControlPath on Linux", () => {
    const args = buildSshArgs(baseConfig, linuxPlatform)
    const hasControlPath = args.some((a) => a.startsWith("ControlPath="))
    expect(hasControlPath).toBe(true)
  })

  test("excludes ControlPath on Windows", () => {
    const args = buildSshArgs(baseConfig, windowsPlatform)
    const hasControlPath = args.some((a) => a.startsWith("ControlPath="))
    expect(hasControlPath).toBe(false)
  })

  test("still includes StrictHostKeyChecking on Windows", () => {
    const args = buildSshArgs(baseConfig, windowsPlatform)
    expect(args).toContain("StrictHostKeyChecking=yes")
  })

  test("still includes port on Windows", () => {
    const args = buildSshArgs(baseConfig, windowsPlatform)
    const portIdx = args.indexOf("-p")
    expect(portIdx).toBeGreaterThan(-1)
    expect(args[portIdx + 1]).toBe("22")
  })
})
