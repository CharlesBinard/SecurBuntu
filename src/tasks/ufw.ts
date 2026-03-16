import type { HardeningTask, SshClient, UfwPort } from "../types.ts"

function escapeShellQuote(s: string): string {
  return s.replace(/'/g, "'\\''")
}

async function applyUfwRules(
  ssh: SshClient,
  ufwPorts: UfwPort[],
): Promise<{ addedRules: string[]; failedRules: string[] }> {
  const addedRules: string[] = []
  const failedRules: string[] = []

  for (const rule of ufwPorts) {
    const ruleLabel = rule.protocol === "both" ? `${rule.port}/tcp+udp` : `${rule.port}/${rule.protocol}`
    const success = await applyOneUfwRule(ssh, rule)
    if (success) {
      addedRules.push(ruleLabel)
    } else {
      failedRules.push(ruleLabel)
    }
  }

  return { addedRules, failedRules }
}

async function applyOneUfwRule(ssh: SshClient, rule: UfwPort): Promise<boolean> {
  const escapedComment = escapeShellQuote(rule.comment)

  if (rule.protocol === "both") {
    const tcpResult = await ssh.exec(`ufw allow ${rule.port}/tcp comment '${escapedComment}'`)
    const udpResult = await ssh.exec(`ufw allow ${rule.port}/udp comment '${escapedComment}'`)
    return tcpResult.exitCode === 0 && udpResult.exitCode === 0
  }

  const result = await ssh.exec(`ufw allow ${rule.port}/${rule.protocol} comment '${escapedComment}'`)
  return result.exitCode === 0
}

export const runConfigureUfw: HardeningTask = async (ssh, options) => {
  if (!options.installUfw) {
    return {
      name: "UFW Firewall",
      success: true,
      message: "Skipped (not requested)",
    }
  }

  const installResult = await ssh.exec("DEBIAN_FRONTEND=noninteractive apt install -y ufw")
  if (installResult.exitCode !== 0) {
    return {
      name: "UFW Firewall",
      success: false,
      message: "Failed to install UFW",
      details: installResult.stderr,
    }
  }

  const { addedRules, failedRules } = await applyUfwRules(ssh, options.ufwPorts)

  const enableResult = await ssh.exec("ufw --force enable")
  if (enableResult.exitCode !== 0) {
    return {
      name: "UFW Firewall",
      success: false,
      message: "Failed to enable UFW",
      details: enableResult.stderr,
    }
  }

  const details =
    failedRules.length > 0
      ? `Allowed: ${addedRules.join(", ")}. Failed: ${failedRules.join(", ")}`
      : `Allowed ports: ${addedRules.join(", ")}`

  return {
    name: "UFW Firewall",
    success: failedRules.length === 0,
    message: failedRules.length > 0 ? "UFW configured with some rule failures" : "UFW installed and configured",
    details,
  }
}
