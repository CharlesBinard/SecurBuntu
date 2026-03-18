import type { HardeningTask, SystemClient } from "../types.ts"

async function enableIpForwarding(client: SystemClient): Promise<boolean> {
  const v4 = await client.exec("sysctl -w net.ipv4.ip_forward=1")
  const v6 = await client.exec("sysctl -w net.ipv6.conf.all.forwarding=1")

  await client.writeFile(
    "/etc/sysctl.d/99-zz-tailscale-forwarding.conf",
    "net.ipv4.ip_forward=1\nnet.ipv6.conf.all.forwarding=1\n",
  )

  return v4.exitCode === 0 && v6.exitCode === 0
}

async function configureUfwForTailscale(
  client: SystemClient,
  nfsSourceIp: string | null,
): Promise<{ rules: string[]; errors: string[] }> {
  const rules: string[] = []
  const errors: string[] = []

  const tsRule = await client.exec("ufw allow in on tailscale0 comment 'SecurBuntu: Tailscale mesh traffic'")
  if (tsRule.exitCode === 0) {
    rules.push("tailscale0 interface")
  } else {
    errors.push("tailscale0 interface rule")
  }

  if (nfsSourceIp) {
    const nfsRule = await client.exec(
      `ufw allow from ${nfsSourceIp} to any port 2049 proto tcp comment 'SecurBuntu: NFS from ${nfsSourceIp}'`,
    )
    if (nfsRule.exitCode === 0) {
      rules.push(`NFS from ${nfsSourceIp}`)
    } else {
      errors.push(`NFS from ${nfsSourceIp}`)
    }
  }

  return { rules, errors }
}

export const runConfigureTailscale: HardeningTask = async (client, options) => {
  if (!(options.installTailscale && options.tailscaleOptions)) {
    return {
      name: "Tailscale",
      success: true,
      message: "Skipped (not requested)",
    }
  }

  const { hostname, authKey, acceptRoutes, advertiseExitNode, configureUfw, nfsSourceIp } = options.tailscaleOptions

  const installResult = await client.exec("curl -fsSL https://tailscale.com/install.sh | sh")
  if (installResult.exitCode !== 0) {
    return {
      name: "Tailscale",
      success: false,
      message: "Failed to install Tailscale",
      details: installResult.stderr,
    }
  }

  if (advertiseExitNode) {
    const forwardingOk = await enableIpForwarding(client)
    if (!forwardingOk) {
      return {
        name: "Tailscale",
        success: false,
        message: "Failed to enable IP forwarding for exit node",
      }
    }
  }

  const upArgs = [
    `--hostname=${hostname}`,
    `--authkey=${authKey}`,
  ]
  if (acceptRoutes) upArgs.push("--accept-routes")
  if (advertiseExitNode) upArgs.push("--advertise-exit-node")

  const upResult = await client.exec(`tailscale up ${upArgs.join(" ")}`)
  if (upResult.exitCode !== 0) {
    return {
      name: "Tailscale",
      success: false,
      message: "Failed to connect to Tailscale",
      details: upResult.stderr,
    }
  }

  const details: string[] = [`hostname: ${hostname}`]

  if (configureUfw && options.installUfw) {
    const { rules, errors } = await configureUfwForTailscale(client, nfsSourceIp)
    if (rules.length > 0) details.push(`UFW rules added: ${rules.join(", ")}`)
    if (errors.length > 0) details.push(`UFW rule failures: ${errors.join(", ")}`)
  }

  if (acceptRoutes) details.push("accepting routes")
  if (advertiseExitNode) details.push("exit node enabled")

  return {
    name: "Tailscale",
    success: true,
    message: "Tailscale installed and connected",
    details: details.join("; "),
  }
}
