import { describe, expect, test } from "bun:test"
import { runDisableServices } from "../../tasks/services.ts"
import type { HardeningOptions, ServerInfo } from "../../types.ts"
import { MockSshClient } from "../helpers/mock-ssh.ts"

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
  permitRootLogin: "yes",
  disableX11Forwarding: true,
  maxAuthTries: 5,
  enableSshBanner: false,
  disableServices: false,
  servicesToDisable: [],
  fixFilePermissions: false,
  currentSshPort: 22,
}

const defaultServer: ServerInfo = {
  ubuntuVersion: "24.04",
  ubuntuCodename: "noble",
  usesSocketActivation: false,
  hasCloudInit: false,
  isRoot: true,
}

describe("runDisableServices", () => {
  test("skips when not requested", async () => {
    const ssh = new MockSshClient()
    const result = await runDisableServices(ssh, defaultOptions, defaultServer)
    expect(result.success).toBe(true)
    expect(result.message).toStartWith("Skipped")
  })

  test("skips when enabled but no services selected", async () => {
    const ssh = new MockSshClient()
    const options = { ...defaultOptions, disableServices: true, servicesToDisable: [] }
    const result = await runDisableServices(ssh, options, defaultServer)
    expect(result.success).toBe(true)
    expect(result.message).toStartWith("Skipped")
  })

  test("disables and masks selected services", async () => {
    const ssh = new MockSshClient()
    const options = {
      ...defaultOptions,
      disableServices: true,
      servicesToDisable: ["cups", "avahi-daemon"],
    }

    const result = await runDisableServices(ssh, options, defaultServer)

    expect(result.success).toBe(true)
    expect(result.message).toContain("2 service(s)")
    expect(ssh.hasCommand("systemctl disable --now cups")).toBe(true)
    expect(ssh.hasCommand("systemctl mask cups")).toBe(true)
    expect(ssh.hasCommand("systemctl disable --now avahi-daemon")).toBe(true)
    expect(ssh.hasCommand("systemctl mask avahi-daemon")).toBe(true)
  })

  test("reports partial failure", async () => {
    const ssh = new MockSshClient()
    ssh.onExec("systemctl disable --now avahi-daemon", { exitCode: 1 })

    const options = {
      ...defaultOptions,
      disableServices: true,
      servicesToDisable: ["cups", "avahi-daemon"],
    }

    const result = await runDisableServices(ssh, options, defaultServer)

    expect(result.success).toBe(false)
    expect(result.message).toContain("1/2")
    expect(result.details).toContain("Failed: avahi-daemon")
    expect(result.details).toContain("Disabled: cups")
  })

  test("reports total failure", async () => {
    const ssh = new MockSshClient()
    ssh.onExec("systemctl disable --now", { exitCode: 1 })

    const options = {
      ...defaultOptions,
      disableServices: true,
      servicesToDisable: ["cups"],
    }

    const result = await runDisableServices(ssh, options, defaultServer)

    expect(result.success).toBe(false)
    expect(result.message).toContain("Failed to disable all")
  })

  test("fails service when mask fails", async () => {
    const ssh = new MockSshClient()
    ssh.onExec("systemctl mask cups", { exitCode: 1 })

    const options = {
      ...defaultOptions,
      disableServices: true,
      servicesToDisable: ["cups"],
    }

    const result = await runDisableServices(ssh, options, defaultServer)

    expect(result.success).toBe(false)
    expect(result.details).toContain("Failed: cups")
  })
})
