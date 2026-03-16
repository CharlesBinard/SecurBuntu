import type { HardeningTask } from "../types.js"

function escapeShellQuote(s: string): string {
  return s.replace(/'/g, "'\\''")
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

  const addedRules: string[] = []
  const failedRules: string[] = []

  for (const rule of options.ufwPorts) {
    if (rule.protocol === "both") {
      const escapedComment = escapeShellQuote(rule.comment)
      const tcpResult = await ssh.exec(`ufw allow ${rule.port}/tcp comment '${escapedComment}'`)
      const udpResult = await ssh.exec(`ufw allow ${rule.port}/udp comment '${escapedComment}'`)
      if (tcpResult.exitCode !== 0 || udpResult.exitCode !== 0) {
        failedRules.push(`${rule.port}/tcp+udp`)
      } else {
        addedRules.push(`${rule.port}/tcp+udp`)
      }
    } else {
      const ruleResult = await ssh.exec(
        `ufw allow ${rule.port}/${rule.protocol} comment '${escapeShellQuote(rule.comment)}'`,
      )
      if (ruleResult.exitCode !== 0) {
        failedRules.push(`${rule.port}/${rule.protocol}`)
      } else {
        addedRules.push(`${rule.port}/${rule.protocol}`)
      }
    }
  }

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
