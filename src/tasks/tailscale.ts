import type { HardeningTask, SystemClient, TailscaleOptions, TaskResult } from "../types.ts"

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

function buildUpArgs(tsOptions: TailscaleOptions): string[] {
  const args = [`--hostname=${tsOptions.hostname}`, `--authkey=${tsOptions.authKey}`]
  if (tsOptions.acceptRoutes) args.push("--accept-routes")
  if (tsOptions.advertiseExitNode) args.push("--advertise-exit-node")
  return args
}

function buildDetails(tsOptions: TailscaleOptions, ufwResult?: { rules: string[]; errors: string[] }): string {
  const details: string[] = [`hostname: ${tsOptions.hostname}`]

  if (ufwResult) {
    if (ufwResult.rules.length > 0) details.push(`UFW rules added: ${ufwResult.rules.join(", ")}`)
    if (ufwResult.errors.length > 0) details.push(`UFW rule failures: ${ufwResult.errors.join(", ")}`)
  }

  if (tsOptions.acceptRoutes) details.push("accepting routes")
  if (tsOptions.advertiseExitNode) details.push("exit node enabled")

  return details.join("; ")
}

function fail(message: string, details?: string): TaskResult {
  return { name: "Tailscale", success: false, message, details }
}

export const runConfigureTailscale: HardeningTask = async (client, options) => {
  if (!(options.installTailscale && options.tailscaleOptions)) {
    return { name: "Tailscale", success: true, message: "Skipped (not requested)" }
  }

  const tsOptions = options.tailscaleOptions

  const installResult = await client.exec("curl -fsSL https://tailscale.com/install.sh | sh")
  if (installResult.exitCode !== 0) {
    return fail("Failed to install Tailscale", installResult.stderr)
  }

  if (tsOptions.advertiseExitNode) {
    const forwardingOk = await enableIpForwarding(client)
    if (!forwardingOk) return fail("Failed to enable IP forwarding for exit node")
  }

  const upResult = await client.exec(`tailscale up ${buildUpArgs(tsOptions).join(" ")}`)
  if (upResult.exitCode !== 0) {
    return fail("Failed to connect to Tailscale", upResult.stderr)
  }

  const ufwResult =
    tsOptions.configureUfw && options.installUfw
      ? await configureUfwForTailscale(client, tsOptions.nfsSourceIp)
      : undefined

  return {
    name: "Tailscale",
    success: true,
    message: "Tailscale installed and connected",
    details: buildDetails(tsOptions, ufwResult),
  }
}
