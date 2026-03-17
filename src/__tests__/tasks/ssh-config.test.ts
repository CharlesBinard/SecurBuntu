import { describe, expect, test } from "bun:test"
import { runHardenSshConfig } from "../../tasks/ssh-config.ts"
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
  disableX11Forwarding: false,
  maxAuthTries: 6,
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

describe("runHardenSshConfig", () => {
  test("skips when no SSH changes requested", async () => {
    const ssh = new MockSystemClient()
    const result = await runHardenSshConfig(ssh, defaultOptions, defaultServer)
    expect(result.success).toBe(true)
    expect(result.message).toStartWith("Skipped")
  })

  test("writes SSH config with custom port", async () => {
    const ssh = new MockSystemClient()
    ssh.onExec("sshd -t", { exitCode: 0 })
    ssh.onExec("echo ok", { stdout: "ok" })

    const options = {
      ...defaultOptions,
      changeSshPort: true,
      newSshPort: 2222,
    }

    const result = await runHardenSshConfig(ssh, options, defaultServer)

    expect(result.success).toBe(true)
    const config = ssh.writtenFiles.get("/etc/ssh/sshd_config.d/01-securbuntu.conf")
    expect(config).toContain("Port 2222")
  })

  test("uses currentSshPort when port is not changed", async () => {
    const ssh = new MockSystemClient()
    ssh.onExec("sshd -t", { exitCode: 0 })
    ssh.onExec("echo ok", { stdout: "ok" })

    const options = {
      ...defaultOptions,
      currentSshPort: 22_012,
      permitRootLogin: "prohibit-password" as const,
    }

    const result = await runHardenSshConfig(ssh, options, defaultServer)

    expect(result.success).toBe(true)
    const config = ssh.writtenFiles.get("/etc/ssh/sshd_config.d/01-securbuntu.conf")
    expect(config).toContain("Port 22012")
  })

  test("sets PermitRootLogin to no when sudo user created", async () => {
    const ssh = new MockSystemClient()
    ssh.onExec("sshd -t", { exitCode: 0 })
    ssh.onExec("echo ok", { stdout: "ok" })

    const options = {
      ...defaultOptions,
      createSudoUser: true,
      sudoUsername: "deploy",
      permitRootLogin: "no" as const,
    }

    const result = await runHardenSshConfig(ssh, options, defaultServer)

    expect(result.success).toBe(true)
    const config = ssh.writtenFiles.get("/etc/ssh/sshd_config.d/01-securbuntu.conf")
    expect(config).toContain("PermitRootLogin no")
  })

  test("sets PermitRootLogin to prohibit-password for Coolify", async () => {
    const ssh = new MockSystemClient()
    ssh.onExec("sshd -t", { exitCode: 0 })
    ssh.onExec("echo ok", { stdout: "ok" })

    const options = {
      ...defaultOptions,
      configureCoolify: true,
      permitRootLogin: "prohibit-password" as const,
    }

    const result = await runHardenSshConfig(ssh, options, defaultServer)

    expect(result.success).toBe(true)
    const config = ssh.writtenFiles.get("/etc/ssh/sshd_config.d/01-securbuntu.conf")
    expect(config).toContain("PermitRootLogin prohibit-password")
  })

  test("disables password authentication", async () => {
    const ssh = new MockSystemClient()
    ssh.onExec("sshd -t", { exitCode: 0 })
    ssh.onExec("echo ok", { stdout: "ok" })

    const options = {
      ...defaultOptions,
      disablePasswordAuth: true,
    }

    const _result = await runHardenSshConfig(ssh, options, defaultServer)

    const config = ssh.writtenFiles.get("/etc/ssh/sshd_config.d/01-securbuntu.conf")
    expect(config).toContain("PasswordAuthentication no")
  })

  test("writes SSH banner when enabled", async () => {
    const ssh = new MockSystemClient()
    ssh.onExec("sshd -t", { exitCode: 0 })
    ssh.onExec("echo ok", { stdout: "ok" })

    const options = {
      ...defaultOptions,
      enableSshBanner: true,
    }

    const result = await runHardenSshConfig(ssh, options, defaultServer)

    expect(result.success).toBe(true)
    // Banner file written
    const bannerContent = ssh.writtenFiles.get("/etc/issue.net")
    expect(bannerContent).toContain("WARNING: Unauthorized access")
    // Banner directive in SSH config
    const config = ssh.writtenFiles.get("/etc/ssh/sshd_config.d/01-securbuntu.conf")
    expect(config).toContain("Banner /etc/issue.net")
    // Banner in details
    expect(result.details).toContain("Banner")
  })

  test("does not add Banner directive when banner disabled", async () => {
    const ssh = new MockSystemClient()
    ssh.onExec("sshd -t", { exitCode: 0 })
    ssh.onExec("echo ok", { stdout: "ok" })

    const options = {
      ...defaultOptions,
      changeSshPort: true,
      newSshPort: 2222,
    }

    await runHardenSshConfig(ssh, options, defaultServer)

    const config = ssh.writtenFiles.get("/etc/ssh/sshd_config.d/01-securbuntu.conf")
    expect(config).not.toContain("Banner")
  })

  test("handles cloud-init backup", async () => {
    const ssh = new MockSystemClient()
    ssh.onExec("sshd -t", { exitCode: 0 })
    ssh.onExec("echo ok", { stdout: "ok" })

    const server = { ...defaultServer, hasCloudInit: true }
    const options = { ...defaultOptions, changeSshPort: true, newSshPort: 2222 }

    await runHardenSshConfig(ssh, options, server)

    expect(ssh.hasCommand("cp '/etc/ssh/sshd_config.d/50-cloud-init.conf'")).toBe(true)
    expect(ssh.hasCommand("sed -i")).toBe(true)
  })

  test("rolls back on sshd -t validation failure", async () => {
    const ssh = new MockSystemClient()
    ssh.onExec("sshd -t", { exitCode: 1, stderr: "bad config" })

    const options = { ...defaultOptions, changeSshPort: true, newSshPort: 2222 }

    const result = await runHardenSshConfig(ssh, options, defaultServer)

    expect(result.success).toBe(false)
    expect(result.message).toContain("validation failed")
    expect(result.message).toContain("rolled back")
    expect(ssh.hasCommand("rm -f")).toBe(true)
  })

  test("rolls back cloud-init on validation failure", async () => {
    const ssh = new MockSystemClient()
    ssh.onExec("sshd -t", { exitCode: 1, stderr: "bad config" })

    const server = { ...defaultServer, hasCloudInit: true }
    const options = { ...defaultOptions, changeSshPort: true, newSshPort: 2222 }

    await runHardenSshConfig(ssh, options, server)

    expect(ssh.hasCommand("mv '/etc/ssh/sshd_config.d/50-cloud-init.conf.securbuntu-backup'")).toBe(true)
  })

  test("rolls back on SSH restart failure", async () => {
    const ssh = new MockSystemClient()
    ssh.onExec("sshd -t", { exitCode: 0 })
    ssh.onExec("systemctl restart ssh.service", { exitCode: 1, stderr: "restart failed" })

    const options = { ...defaultOptions, changeSshPort: true, newSshPort: 2222 }

    const result = await runHardenSshConfig(ssh, options, defaultServer)

    expect(result.success).toBe(false)
    expect(result.message).toContain("restart failed")
    expect(result.message).toContain("rolled back")
  })

  test("returns connection-lost message when verify fails", async () => {
    const ssh = new MockSystemClient()
    ssh.onExec("sshd -t", { exitCode: 0 })
    // echo ok NOT mocked — defaults to stdout: ""

    const options = { ...defaultOptions, changeSshPort: true, newSshPort: 2222 }

    const result = await runHardenSshConfig(ssh, options, defaultServer)

    expect(result.success).toBe(true)
    expect(result.message).toContain("connection lost")
    expect(result.details).toContain("ControlMaster")
  })

  test("handles socket activation for port change on Ubuntu 24.04+", async () => {
    const ssh = new MockSystemClient()
    ssh.onExec("sshd -t", { exitCode: 0 })
    ssh.onExec("echo ok", { stdout: "ok" })

    const server = { ...defaultServer, usesSocketActivation: true }
    const options = { ...defaultOptions, changeSshPort: true, newSshPort: 2222 }

    await runHardenSshConfig(ssh, options, server)

    expect(ssh.hasCommand("systemctl daemon-reload && systemctl restart ssh.socket")).toBe(true)
  })

  test("includes standard hardening directives", async () => {
    const ssh = new MockSystemClient()
    ssh.onExec("sshd -t", { exitCode: 0 })
    ssh.onExec("echo ok", { stdout: "ok" })

    const options = {
      ...defaultOptions,
      changeSshPort: true,
      newSshPort: 22,
      disableX11Forwarding: true,
      maxAuthTries: 5,
    }

    await runHardenSshConfig(ssh, options, defaultServer)

    const config = ssh.writtenFiles.get("/etc/ssh/sshd_config.d/01-securbuntu.conf")
    expect(config).toContain("PubkeyAuthentication yes")
    expect(config).toContain("X11Forwarding no")
    expect(config).toContain("MaxAuthTries 5")
  })
})
