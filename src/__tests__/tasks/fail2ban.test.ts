import { describe, expect, test } from "bun:test"
import { runConfigureFail2ban } from "../../tasks/fail2ban.ts"
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

const makeServer = (version: string): ServerInfo => ({
  ubuntuVersion: version,
  ubuntuCodename: version === "24.04" ? "noble" : "jammy",
  usesSocketActivation: version === "24.04",
  hasCloudInit: false,
  isRoot: true,
})

describe("runConfigureFail2ban", () => {
  test("skips when not requested", async () => {
    const ssh = new MockSshClient()
    const result = await runConfigureFail2ban(ssh, defaultOptions, makeServer("24.04"))
    expect(result.success).toBe(true)
    expect(result.message).toStartWith("Skipped")
  })

  test("installs fail2ban", async () => {
    const ssh = new MockSshClient()
    const options = { ...defaultOptions, installFail2ban: true }

    const result = await runConfigureFail2ban(ssh, options, makeServer("24.04"))

    expect(result.success).toBe(true)
    expect(ssh.hasCommand("apt install -y fail2ban")).toBe(true)
  })

  test("uses systemd backend + nftables for Ubuntu 24.04", async () => {
    const ssh = new MockSshClient()
    const options = { ...defaultOptions, installFail2ban: true }

    await runConfigureFail2ban(ssh, options, makeServer("24.04"))

    const config = ssh.writtenFiles.get("/etc/fail2ban/jail.d/securbuntu.local")
    expect(config).toContain("backend = systemd")
    expect(config).toContain("banaction = nftables")
    expect(config).toContain("journalmatch")
  })

  test("uses auto backend + iptables for Ubuntu 22.04", async () => {
    const ssh = new MockSshClient()
    const options = { ...defaultOptions, installFail2ban: true }

    await runConfigureFail2ban(ssh, options, makeServer("22.04"))

    const config = ssh.writtenFiles.get("/etc/fail2ban/jail.d/securbuntu.local")
    expect(config).toContain("backend = auto")
    expect(config).toContain("banaction = iptables-multiport")
    expect(config).not.toContain("journalmatch")
  })

  test("uses custom SSH port", async () => {
    const ssh = new MockSshClient()
    const options = {
      ...defaultOptions,
      installFail2ban: true,
      changeSshPort: true,
      newSshPort: 2222,
    }

    await runConfigureFail2ban(ssh, options, makeServer("24.04"))

    const config = ssh.writtenFiles.get("/etc/fail2ban/jail.d/securbuntu.local")
    expect(config).toContain("port = 2222")
  })

  test("uses currentSshPort when port is not changed", async () => {
    const ssh = new MockSshClient()
    const options = {
      ...defaultOptions,
      installFail2ban: true,
      currentSshPort: 22012,
    }

    await runConfigureFail2ban(ssh, options, makeServer("24.04"))

    const config = ssh.writtenFiles.get("/etc/fail2ban/jail.d/securbuntu.local")
    expect(config).toContain("port = 22012")
  })

  test("fails when install fails", async () => {
    const ssh = new MockSshClient()
    ssh.onExec("apt install -y fail2ban", { exitCode: 1, stderr: "error" })
    const options = { ...defaultOptions, installFail2ban: true }

    const result = await runConfigureFail2ban(ssh, options, makeServer("24.04"))

    expect(result.success).toBe(false)
    expect(result.message).toContain("Failed to install")
  })

  test("fails when restart fails", async () => {
    const ssh = new MockSshClient()
    ssh.onExec("systemctl enable fail2ban", { exitCode: 1, stderr: "restart error" })
    const options = { ...defaultOptions, installFail2ban: true }

    const result = await runConfigureFail2ban(ssh, options, makeServer("24.04"))

    expect(result.success).toBe(false)
    expect(result.message).toContain("Failed to start")
  })
})
