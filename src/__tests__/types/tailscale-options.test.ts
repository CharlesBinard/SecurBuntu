import { describe, expect, test } from "bun:test"
import type { HardeningOptions, TailscaleOptions } from "../../types.ts"

describe("Tailscale types", () => {
  test("HardeningOptions includes tailscale fields", () => {
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
      installTailscale: false,
    }
    expect(options.installTailscale).toBe(false)
    expect(options.tailscaleOptions).toBeUndefined()
  })

  test("TailscaleOptions shape", () => {
    const tsOpts: TailscaleOptions = {
      hostname: "vm-media",
      authKey: "tskey-auth-abc123",
      acceptRoutes: true,
      advertiseExitNode: false,
      configureUfw: true,
      nfsSourceIp: "192.168.31.107",
    }
    expect(tsOpts.hostname).toBe("vm-media")
    expect(tsOpts.authKey).toBe("tskey-auth-abc123")
  })
})
