import { describe, test, expect } from "bun:test"
import { MockSshClient } from "../helpers/mock-ssh.js"
import { runConfigureUfw } from "../../tasks/ufw.js"
import type { HardeningOptions, ServerInfo } from "../../types.js"

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

describe("runConfigureUfw", () => {
  test("skips when not requested", async () => {
    const ssh = new MockSshClient()
    const result = await runConfigureUfw(ssh, defaultOptions, defaultServer)
    expect(result.success).toBe(true)
    expect(result.message).toStartWith("Skipped")
  })

  test("installs and configures UFW with TCP rule", async () => {
    const ssh = new MockSshClient()
    const options = {
      ...defaultOptions,
      installUfw: true,
      ufwPorts: [{ port: "22", protocol: "tcp" as const, comment: "SSH" }],
    }

    const result = await runConfigureUfw(ssh, options, defaultServer)

    expect(result.success).toBe(true)
    expect(ssh.hasCommand("apt install -y ufw")).toBe(true)
    expect(ssh.hasCommand("ufw allow 22/tcp")).toBe(true)
    expect(ssh.hasCommand("ufw --force enable")).toBe(true)
  })

  test("handles both protocol with TCP+UDP rules", async () => {
    const ssh = new MockSshClient()
    const options = {
      ...defaultOptions,
      installUfw: true,
      ufwPorts: [{ port: "53", protocol: "both" as const, comment: "DNS" }],
    }

    const result = await runConfigureUfw(ssh, options, defaultServer)

    expect(result.success).toBe(true)
    expect(ssh.hasCommand("ufw allow 53/tcp")).toBe(true)
    expect(ssh.hasCommand("ufw allow 53/udp")).toBe(true)
  })

  test("reports failed rules", async () => {
    const ssh = new MockSshClient()
    ssh.onExec("ufw allow 8080", { exitCode: 1 })

    const options = {
      ...defaultOptions,
      installUfw: true,
      ufwPorts: [
        { port: "22", protocol: "tcp" as const, comment: "SSH" },
        { port: "8080", protocol: "tcp" as const, comment: "App" },
      ],
    }

    const result = await runConfigureUfw(ssh, options, defaultServer)

    expect(result.success).toBe(false)
    expect(result.details).toContain("Failed")
  })

  test("fails when UFW install fails", async () => {
    const ssh = new MockSshClient()
    ssh.onExec("apt install -y ufw", { exitCode: 1, stderr: "install error" })

    const options = {
      ...defaultOptions,
      installUfw: true,
      ufwPorts: [{ port: "22", protocol: "tcp" as const, comment: "SSH" }],
    }

    const result = await runConfigureUfw(ssh, options, defaultServer)

    expect(result.success).toBe(false)
    expect(result.message).toContain("Failed to install")
  })

  test("fails when ufw enable fails", async () => {
    const ssh = new MockSshClient()
    ssh.onExec("ufw --force enable", { exitCode: 1, stderr: "enable error" })

    const options = {
      ...defaultOptions,
      installUfw: true,
      ufwPorts: [{ port: "22", protocol: "tcp" as const, comment: "SSH" }],
    }

    const result = await runConfigureUfw(ssh, options, defaultServer)

    expect(result.success).toBe(false)
    expect(result.message).toContain("Failed to enable UFW")
  })

  test("escapes single quotes in comments", async () => {
    const ssh = new MockSshClient()
    const options = {
      ...defaultOptions,
      installUfw: true,
      ufwPorts: [{ port: "22", protocol: "tcp" as const, comment: "Tom's SSH" }],
    }

    await runConfigureUfw(ssh, options, defaultServer)

    const ufwCmd = ssh.commands.find(c => c.includes("ufw allow 22/tcp"))
    expect(ufwCmd).toBeDefined()
    expect(ufwCmd).toContain("'\\''") // escaped single quote
  })
})
