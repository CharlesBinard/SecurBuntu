import * as p from "@clack/prompts"
import pc from "picocolors"
import type { HardeningOptions } from "../types.ts"
import { unwrapBoolean, unwrapText } from "./helpers.ts"

export async function promptTailscaleOptions(
  options: HardeningOptions,
  tailscaleActive: boolean,
  tailscaleHostname: string | null,
): Promise<void> {
  if (tailscaleActive) {
    p.log.info(
      pc.dim(`Tailscale is already active${tailscaleHostname ? ` (hostname: ${tailscaleHostname})` : ""}.`),
    )
    const reconfigure = unwrapBoolean(
      await p.confirm({
        message: "Tailscale is already installed. Do you want to reconfigure it?",
        initialValue: false,
      }),
    )
    if (!reconfigure) return
  } else {
    const install = unwrapBoolean(
      await p.confirm({
        message: "Do you want to install and configure Tailscale (private mesh VPN)?",
        initialValue: false,
      }),
    )
    if (!install) return
  }

  options.installTailscale = true

  const hostname = unwrapText(
    await p.text({
      message: "Tailscale hostname for this machine",
      placeholder: "vm-media",
      initialValue: tailscaleHostname ?? undefined,
      validate(value) {
        if (!value?.trim()) return "Hostname is required"
        if (!/^[a-z0-9][a-z0-9-]*$/.test(value)) return "Invalid hostname (lowercase letters, numbers, hyphens)"
        return undefined
      },
    }),
  )

  const authKey = unwrapText(
    await p.text({
      message: "Tailscale auth key (from admin console)",
      placeholder: "tskey-auth-...",
      validate(value) {
        if (!value?.trim()) return "Auth key is required"
        if (!value.startsWith("tskey-auth-")) return "Auth key must start with tskey-auth-"
        return undefined
      },
    }),
  )

  const acceptRoutes = unwrapBoolean(
    await p.confirm({
      message: "Accept routes from other Tailscale nodes?",
      initialValue: true,
    }),
  )

  const advertiseExitNode = unwrapBoolean(
    await p.confirm({
      message: "Advertise this node as an exit node?",
      initialValue: false,
    }),
  )

  let configureUfw = false
  let nfsSourceIp: string | null = null

  if (options.installUfw) {
    configureUfw = unwrapBoolean(
      await p.confirm({
        message: "Add UFW rules for Tailscale? (allow all traffic on tailscale0 interface)",
        initialValue: true,
      }),
    )

    if (configureUfw) {
      const hasNfs = unwrapBoolean(
        await p.confirm({
          message: "Does this machine use NFS mounts from a specific server?",
          initialValue: false,
        }),
      )

      if (hasNfs) {
        nfsSourceIp = unwrapText(
          await p.text({
            message: "NFS server IP (to allow NFS traffic through UFW)",
            placeholder: "192.168.31.107",
            validate(value) {
              if (!value?.trim()) return "IP is required"
              if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value)) return "Invalid IP format"
              return undefined
            },
          }),
        )
      }
    }
  }

  options.tailscaleOptions = {
    hostname: hostname.trim(),
    authKey: authKey.trim(),
    acceptRoutes,
    advertiseExitNode,
    configureUfw,
    nfsSourceIp,
  }
}
