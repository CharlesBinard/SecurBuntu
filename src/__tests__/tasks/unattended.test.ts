import { describe, expect, test } from "bun:test"
import { runConfigureUnattended } from "../../tasks/unattended.ts"
import type { HardeningOptions, ServerInfo } from "../../types.ts"
import { MockSystemClient } from "../helpers/mock-ssh.ts"

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
  connectionUsername: "root",
}

const defaultServer: ServerInfo = {
  ubuntuVersion: "24.04",
  ubuntuCodename: "noble",
  usesSocketActivation: false,
  hasCloudInit: false,
  isRoot: true,
}

describe("runConfigureUnattended", () => {
  test("skips when not requested", async () => {
    const ssh = new MockSystemClient()
    const result = await runConfigureUnattended(ssh, defaultOptions, defaultServer)
    expect(result.success).toBe(true)
    expect(result.message).toStartWith("Skipped")
  })

  test("installs and configures auto-upgrades", async () => {
    const ssh = new MockSystemClient()
    ssh.setFile("/etc/apt/apt.conf.d/50unattended-upgrades", "exists")

    const options = { ...defaultOptions, enableAutoUpdates: true }
    const result = await runConfigureUnattended(ssh, options, defaultServer)

    expect(result.success).toBe(true)
    expect(ssh.hasCommand("apt install -y unattended-upgrades")).toBe(true)

    const config = ssh.writtenFiles.get("/etc/apt/apt.conf.d/20auto-upgrades")
    expect(config).toContain('APT::Periodic::Unattended-Upgrade "1"')
    expect(config).toContain('APT::Periodic::Update-Package-Lists "1"')
  })

  test("warns when 50unattended-upgrades missing", async () => {
    const ssh = new MockSystemClient()
    // Don't set the file — fileExists will return false

    const options = { ...defaultOptions, enableAutoUpdates: true }
    const result = await runConfigureUnattended(ssh, options, defaultServer)

    expect(result.success).toBe(true)
    expect(result.details).toContain("Warning")
  })

  test("fails when install fails", async () => {
    const ssh = new MockSystemClient()
    ssh.onExec("apt install -y unattended-upgrades", { exitCode: 1, stderr: "error" })

    const options = { ...defaultOptions, enableAutoUpdates: true }
    const result = await runConfigureUnattended(ssh, options, defaultServer)

    expect(result.success).toBe(false)
  })
})
