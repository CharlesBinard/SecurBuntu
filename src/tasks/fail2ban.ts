import type { HardeningTask } from "../types.js"

export const runConfigureFail2ban: HardeningTask = async (ssh, options, server) => {
  if (!options.installFail2ban) {
    return {
      name: "Fail2ban",
      success: true,
      message: "Skipped (not requested)",
    }
  }

  const installResult = await ssh.exec("DEBIAN_FRONTEND=noninteractive apt install -y fail2ban")
  if (installResult.exitCode !== 0) {
    return {
      name: "Fail2ban",
      success: false,
      message: "Failed to install Fail2ban",
      details: installResult.stderr,
    }
  }

  const sshPort = options.changeSshPort && options.newSshPort ? options.newSshPort : 22
  const isModernUbuntu = isVersionGte(server.ubuntuVersion, "24.04")

  let jailConfig: string

  if (isModernUbuntu) {
    jailConfig = [
      "[sshd]",
      "enabled = true",
      `port = ${sshPort}`,
      "maxretry = 5",
      "findtime = 600",
      "bantime = 3600",
      "backend = systemd",
      "banaction = nftables",
      "journalmatch = _SYSTEMD_UNIT=ssh.service + _COMM=sshd",
    ].join("\n")
  } else {
    jailConfig = [
      "[sshd]",
      "enabled = true",
      `port = ${sshPort}`,
      "maxretry = 5",
      "findtime = 600",
      "bantime = 3600",
      "backend = auto",
      "banaction = iptables-multiport",
    ].join("\n")
  }

  await ssh.writeFile("/etc/fail2ban/jail.d/securbuntu.local", jailConfig)

  const restartResult = await ssh.exec("systemctl enable fail2ban && systemctl restart fail2ban")
  if (restartResult.exitCode !== 0) {
    return {
      name: "Fail2ban",
      success: false,
      message: "Failed to start Fail2ban",
      details: restartResult.stderr,
    }
  }

  return {
    name: "Fail2ban",
    success: true,
    message: `Fail2ban configured for SSH on port ${sshPort}`,
    details: `Backend: ${isModernUbuntu ? "systemd" : "auto"}, Banaction: ${isModernUbuntu ? "nftables" : "iptables-multiport"}`,
  }
}

function parseVersionPart(parts: number[], idx: number): number {
  const v = parts[idx]
  return v !== undefined && Number.isFinite(v) ? v : 0
}

function isVersionGte(version: string, target: string): boolean {
  const vParts = version.split(".").map(Number)
  const tParts = target.split(".").map(Number)
  const vMajor = parseVersionPart(vParts, 0)
  const vMinor = parseVersionPart(vParts, 1)
  const tMajor = parseVersionPart(tParts, 0)
  const tMinor = parseVersionPart(tParts, 1)
  return vMajor > tMajor || (vMajor === tMajor && vMinor >= tMinor)
}
