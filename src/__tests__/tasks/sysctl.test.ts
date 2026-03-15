import { describe, test, expect } from "bun:test"
import { MockSshClient } from "../helpers/mock-ssh.js"
import { runConfigureSysctl } from "../../tasks/sysctl.js"
import type { HardeningOptions, ServerInfo, SysctlOptions } from "../../types.js"

const defaultOptions: HardeningOptions = {
  createSudoUser: false,
  addPersonalKey: false,
  configureCoolify: false,
  changeSshPort: false,
  disablePasswordAuth: false,
  installUfw: false,
  ufwPorts: [],
  installFail2ban: false,
  enableAutoUpdates: false,
  enableSysctl: false,
  enableSshBanner: false,
}

const defaultServer: ServerInfo = {
  ubuntuVersion: "24.04",
  ubuntuCodename: "noble",
  usesSocketActivation: false,
  hasCloudInit: false,
  isRoot: true,
}

const allSysctl: SysctlOptions = {
  blockForwarding: true,
  ignoreRedirects: true,
  disableSourceRouting: true,
  synFloodProtection: true,
  disableIcmpBroadcast: true,
}

describe("runConfigureSysctl", () => {
  test("skips when not requested", async () => {
    const ssh = new MockSshClient()
    const result = await runConfigureSysctl(ssh, defaultOptions, defaultServer)
    expect(result.success).toBe(true)
    expect(result.message).toStartWith("Skipped")
  })

  test("skips when all options are false", async () => {
    const ssh = new MockSshClient()
    const options = {
      ...defaultOptions,
      enableSysctl: true,
      sysctlOptions: {
        blockForwarding: false,
        ignoreRedirects: false,
        disableSourceRouting: false,
        synFloodProtection: false,
        disableIcmpBroadcast: false,
      },
    }

    const result = await runConfigureSysctl(ssh, options, defaultServer)
    expect(result.success).toBe(true)
    expect(result.message).toContain("no parameters selected")
  })

  test("writes correct config with all options enabled", async () => {
    const ssh = new MockSshClient()
    const options = {
      ...defaultOptions,
      enableSysctl: true,
      sysctlOptions: allSysctl,
    }

    const result = await runConfigureSysctl(ssh, options, defaultServer)

    expect(result.success).toBe(true)
    const config = ssh.writtenFiles.get("/etc/sysctl.d/99-securbuntu.conf")
    expect(config).toBeDefined()
    expect(config).toContain("net.ipv4.ip_forward=0")
    expect(config).toContain("net.ipv6.conf.all.forwarding=0")
    expect(config).toContain("net.ipv4.conf.all.accept_redirects=0")
    expect(config).toContain("net.ipv4.conf.default.accept_redirects=0")
    expect(config).toContain("net.ipv6.conf.all.accept_redirects=0")
    expect(config).toContain("net.ipv4.conf.all.accept_source_route=0")
    expect(config).toContain("net.ipv6.conf.all.accept_source_route=0")
    expect(config).toContain("net.ipv4.tcp_syncookies=1")
    expect(config).toContain("net.ipv4.icmp_echo_ignore_broadcasts=1")
  })

  test("writes only selected parameters", async () => {
    const ssh = new MockSshClient()
    const options = {
      ...defaultOptions,
      enableSysctl: true,
      sysctlOptions: {
        blockForwarding: false,
        ignoreRedirects: false,
        disableSourceRouting: false,
        synFloodProtection: true,
        disableIcmpBroadcast: false,
      },
    }

    const result = await runConfigureSysctl(ssh, options, defaultServer)

    expect(result.success).toBe(true)
    const config = ssh.writtenFiles.get("/etc/sysctl.d/99-securbuntu.conf")
    expect(config).toContain("net.ipv4.tcp_syncookies=1")
    expect(config).not.toContain("net.ipv4.ip_forward")
    expect(result.message).toContain("1 kernel security parameter")
  })

  test("applies with sysctl --system", async () => {
    const ssh = new MockSshClient()
    const options = {
      ...defaultOptions,
      enableSysctl: true,
      sysctlOptions: allSysctl,
    }

    await runConfigureSysctl(ssh, options, defaultServer)
    expect(ssh.hasCommand("sysctl --system")).toBe(true)
  })

  test("fails when sysctl --system fails", async () => {
    const ssh = new MockSshClient()
    ssh.onExec("sysctl --system", { exitCode: 1, stderr: "sysctl error" })

    const options = {
      ...defaultOptions,
      enableSysctl: true,
      sysctlOptions: allSysctl,
    }

    const result = await runConfigureSysctl(ssh, options, defaultServer)
    expect(result.success).toBe(false)
    expect(result.message).toContain("Failed to apply")
  })

  test("config file has date header", async () => {
    const ssh = new MockSshClient()
    const options = {
      ...defaultOptions,
      enableSysctl: true,
      sysctlOptions: { ...allSysctl, blockForwarding: false, ignoreRedirects: false, disableSourceRouting: false, disableIcmpBroadcast: false },
    }

    await runConfigureSysctl(ssh, options, defaultServer)
    const config = ssh.writtenFiles.get("/etc/sysctl.d/99-securbuntu.conf")
    expect(config).toMatch(/^# SecurBuntu Kernel Hardening - generated on \d{4}-\d{2}-\d{2}/)
  })
})
