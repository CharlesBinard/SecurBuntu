import { describe, expect, test } from "bun:test"
import { runConfigureTailscale } from "../../tasks/tailscale.ts"
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
  installTailscale: false,
}

const defaultServer: ServerInfo = {
  ubuntuVersion: "24.04",
  ubuntuCodename: "noble",
  usesSocketActivation: false,
  hasCloudInit: false,
  isRoot: true,
}

describe("runConfigureTailscale", () => {
  test("skips when not requested", async () => {
    const ssh = new MockSystemClient()
    const result = await runConfigureTailscale(ssh, defaultOptions, defaultServer)
    expect(result.success).toBe(true)
    expect(result.message).toStartWith("Skipped")
  })

  test("installs Tailscale and runs tailscale up", async () => {
    const ssh = new MockSystemClient()
    const options = {
      ...defaultOptions,
      installTailscale: true,
      tailscaleOptions: {
        hostname: "vm-media",
        authKey: "tskey-auth-abc123",
        acceptRoutes: true,
        advertiseExitNode: false,
        configureUfw: false,
        nfsSourceIp: null,
      },
    }

    const result = await runConfigureTailscale(ssh, options, defaultServer)

    expect(result.success).toBe(true)
    expect(ssh.hasCommand("curl -fsSL https://tailscale.com/install.sh | sh")).toBe(true)
    expect(ssh.hasCommand("tailscale up")).toBe(true)
    expect(ssh.hasCommand("--hostname=vm-media")).toBe(true)
    expect(ssh.hasCommand("--authkey=tskey-auth-abc123")).toBe(true)
    expect(ssh.hasCommand("--accept-routes")).toBe(true)
  })

  test("includes --advertise-exit-node when enabled", async () => {
    const ssh = new MockSystemClient()
    const options = {
      ...defaultOptions,
      installTailscale: true,
      tailscaleOptions: {
        hostname: "vm-exit",
        authKey: "tskey-auth-abc123",
        acceptRoutes: false,
        advertiseExitNode: true,
        configureUfw: false,
        nfsSourceIp: null,
      },
    }

    const result = await runConfigureTailscale(ssh, options, defaultServer)

    expect(result.success).toBe(true)
    expect(ssh.hasCommand("--advertise-exit-node")).toBe(true)
  })

  test("configures UFW for Tailscale when enabled", async () => {
    const ssh = new MockSystemClient()
    const options = {
      ...defaultOptions,
      installUfw: true,
      installTailscale: true,
      tailscaleOptions: {
        hostname: "vm-media",
        authKey: "tskey-auth-abc123",
        acceptRoutes: true,
        advertiseExitNode: false,
        configureUfw: true,
        nfsSourceIp: null,
      },
    }

    const result = await runConfigureTailscale(ssh, options, defaultServer)

    expect(result.success).toBe(true)
    expect(ssh.hasCommand("ufw allow in on tailscale0")).toBe(true)
  })

  test("adds NFS UFW rule when nfsSourceIp is set", async () => {
    const ssh = new MockSystemClient()
    const options = {
      ...defaultOptions,
      installUfw: true,
      installTailscale: true,
      tailscaleOptions: {
        hostname: "vm-media",
        authKey: "tskey-auth-abc123",
        acceptRoutes: true,
        advertiseExitNode: false,
        configureUfw: true,
        nfsSourceIp: "192.168.31.107",
      },
    }

    const result = await runConfigureTailscale(ssh, options, defaultServer)

    expect(result.success).toBe(true)
    expect(ssh.hasCommand("ufw allow from 192.168.31.107 to any port 2049 proto tcp")).toBe(true)
  })

  test("fails when Tailscale install fails", async () => {
    const ssh = new MockSystemClient()
    ssh.onExec("curl -fsSL https://tailscale.com/install.sh", {
      exitCode: 1,
      stderr: "download failed",
    })

    const options = {
      ...defaultOptions,
      installTailscale: true,
      tailscaleOptions: {
        hostname: "vm-test",
        authKey: "tskey-auth-abc123",
        acceptRoutes: false,
        advertiseExitNode: false,
        configureUfw: false,
        nfsSourceIp: null,
      },
    }

    const result = await runConfigureTailscale(ssh, options, defaultServer)
    expect(result.success).toBe(false)
    expect(result.message).toContain("Failed to install")
  })

  test("fails when tailscale up fails", async () => {
    const ssh = new MockSystemClient()
    ssh.onExec("tailscale up", { exitCode: 1, stderr: "auth failed" })

    const options = {
      ...defaultOptions,
      installTailscale: true,
      tailscaleOptions: {
        hostname: "vm-test",
        authKey: "tskey-auth-bad",
        acceptRoutes: false,
        advertiseExitNode: false,
        configureUfw: false,
        nfsSourceIp: null,
      },
    }

    const result = await runConfigureTailscale(ssh, options, defaultServer)
    expect(result.success).toBe(false)
    expect(result.message).toContain("Failed to connect")
  })

  test("enables IP forwarding when advertiseExitNode is true", async () => {
    const ssh = new MockSystemClient()
    const options = {
      ...defaultOptions,
      installTailscale: true,
      tailscaleOptions: {
        hostname: "vm-exit",
        authKey: "tskey-auth-abc123",
        acceptRoutes: false,
        advertiseExitNode: true,
        configureUfw: false,
        nfsSourceIp: null,
      },
    }

    await runConfigureTailscale(ssh, options, defaultServer)

    expect(ssh.hasCommand("sysctl -w net.ipv4.ip_forward=1")).toBe(true)
    expect(ssh.hasCommand("sysctl -w net.ipv6.conf.all.forwarding=1")).toBe(true)
  })
})
