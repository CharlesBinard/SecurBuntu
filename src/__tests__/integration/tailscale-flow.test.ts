import { describe, expect, test } from "bun:test"
import { runConfigureTailscale } from "../../tasks/tailscale.ts"
import { runConfigureUfw } from "../../tasks/ufw.ts"
import type { HardeningOptions, ServerInfo } from "../../types.ts"
import { MockSystemClient } from "../helpers/mock-ssh.ts"

const server: ServerInfo = {
  ubuntuVersion: "24.04",
  ubuntuCodename: "noble",
  usesSocketActivation: false,
  hasCloudInit: false,
  isRoot: true,
}

describe("Tailscale + UFW integration", () => {
  test("UFW then Tailscale: adds tailscale0 and NFS rules", async () => {
    const ssh = new MockSystemClient()
    const options: HardeningOptions = {
      createSudoUser: false,
      addPersonalKey: false,
      configureCoolify: false,
      changeSshPort: false,
      disablePasswordAuth: false,
      installUfw: true,
      ufwPorts: [{ port: "22_012", protocol: "tcp", comment: "SSH" }],
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
      currentSshPort: 22_012,
      connectionUsername: "rywoox",
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

    const ufwResult = await runConfigureUfw(ssh, options, server)
    expect(ufwResult.success).toBe(true)

    const tsResult = await runConfigureTailscale(ssh, options, server)
    expect(tsResult.success).toBe(true)

    expect(ssh.hasCommand("apt install -y ufw")).toBe(true)
    expect(ssh.hasCommand("ufw allow 22_012/tcp")).toBe(true)
    expect(ssh.hasCommand("ufw --force enable")).toBe(true)
    expect(ssh.hasCommand("curl -fsSL https://tailscale.com/install.sh | sh")).toBe(true)
    expect(ssh.hasCommand("tailscale up")).toBe(true)
    expect(ssh.hasCommand("ufw allow in on tailscale0")).toBe(true)
    expect(ssh.hasCommand("ufw allow from 192.168.31.107 to any port 2049 proto tcp")).toBe(true)
  })

  test("Tailscale without UFW: skips UFW rules", async () => {
    const ssh = new MockSystemClient()
    const options: HardeningOptions = {
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
      installTailscale: true,
      tailscaleOptions: {
        hostname: "vm-test",
        authKey: "tskey-auth-abc123",
        acceptRoutes: false,
        advertiseExitNode: false,
        configureUfw: true,
        nfsSourceIp: null,
      },
    }

    const result = await runConfigureTailscale(ssh, options, server)
    expect(result.success).toBe(true)
    expect(ssh.hasCommand("ufw")).toBe(false)
  })
})
