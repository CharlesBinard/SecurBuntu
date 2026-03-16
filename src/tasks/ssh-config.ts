import type { HardeningOptions, HardeningTask, SshClient, TaskResult } from "../types.ts"

function buildSshConfig(options: HardeningOptions, sshPort: number, date: string): string {
  const permitRootLogin = options.permitRootLogin
  const passwordAuth = options.disablePasswordAuth ? "no" : "yes"

  const configLines = [
    `# SecurBuntu SSH Hardening - generated on ${date}`,
    `Port ${sshPort}`,
    `PermitRootLogin ${permitRootLogin}`,
    `PasswordAuthentication ${passwordAuth}`,
    "PubkeyAuthentication yes",
    "AuthorizedKeysFile .ssh/authorized_keys",
    `X11Forwarding ${options.disableX11Forwarding ? "no" : "yes"}`,
    `MaxAuthTries ${options.maxAuthTries}`,
  ]

  if (options.enableSshBanner) {
    configLines.push("Banner /etc/issue.net")
  }

  return configLines.join("\n")
}

async function rollbackSshConfig(
  ssh: SshClient,
  configPath: string,
  cloudInitPath: string,
  cloudInitBackedUp: boolean,
): Promise<void> {
  await ssh.exec(`rm -f '${configPath}'`)
  if (cloudInitBackedUp) {
    await ssh.exec(`mv '${cloudInitPath}.securbuntu-backup' '${cloudInitPath}'`)
  }
}

function buildDetailsSummary(options: HardeningOptions, sshPort: number): string {
  const permitRootLogin = options.permitRootLogin
  const passwordAuth = options.disablePasswordAuth ? "no" : "yes"

  const detailParts = [
    `Port: ${sshPort}`,
    `PermitRootLogin: ${permitRootLogin}`,
    `PasswordAuthentication: ${passwordAuth}`,
    `X11Forwarding: ${options.disableX11Forwarding ? "no" : "yes"}`,
    `MaxAuthTries: ${options.maxAuthTries}`,
  ]
  if (options.enableSshBanner) {
    detailParts.push("Banner: /etc/issue.net")
  }
  return detailParts.join(", ")
}

export const runHardenSshConfig: HardeningTask = async (ssh, options, server) => {
  const hasChanges =
    options.changeSshPort ||
    options.disablePasswordAuth ||
    options.enableSshBanner ||
    options.permitRootLogin !== "yes" ||
    options.disableX11Forwarding ||
    options.maxAuthTries !== 6
  if (!hasChanges) {
    return {
      name: "SSH Hardening",
      success: true,
      message: "Skipped (no SSH changes requested)",
    }
  }

  const sshPort = options.changeSshPort && options.newSshPort ? options.newSshPort : options.currentSshPort
  const date = new Date().toISOString().split("T")[0] ?? "unknown"

  // Write SSH banner if requested
  if (options.enableSshBanner) {
    const bannerContent = [
      "******************************************************************",
      "*  WARNING: Unauthorized access to this system is prohibited.    *",
      "*  All connections are monitored and recorded.                   *",
      "*  Disconnect IMMEDIATELY if you are not an authorized user.     *",
      "******************************************************************",
    ].join("\n")

    await ssh.writeFile("/etc/issue.net", bannerContent)
  }

  const configPath = "/etc/ssh/sshd_config.d/01-securbuntu.conf"
  const configContent = buildSshConfig(options, sshPort, date)
  await ssh.writeFile(configPath, configContent)

  const cloudInitPath = "/etc/ssh/sshd_config.d/50-cloud-init.conf"
  let cloudInitBackedUp = false

  if (server.hasCloudInit) {
    await ssh.exec(`cp '${cloudInitPath}' '${cloudInitPath}.securbuntu-backup'`)
    cloudInitBackedUp = true

    await ssh.exec(
      `sed -i 's/^\\(PasswordAuthentication\\)/# Disabled by SecurBuntu: \\1/' '${cloudInitPath}' && ` +
        `sed -i 's/^\\(PermitRootLogin\\)/# Disabled by SecurBuntu: \\1/' '${cloudInitPath}'`,
    )
  }

  const rollbackFailure = async (message: string, details: string): Promise<TaskResult> => {
    await rollbackSshConfig(ssh, configPath, cloudInitPath, cloudInitBackedUp)
    return { name: "SSH Hardening", success: false, message, details }
  }

  const validateResult = await ssh.exec("sshd -t -f /etc/ssh/sshd_config")
  if (validateResult.exitCode !== 0) {
    return rollbackFailure("SSH config validation failed — changes rolled back", validateResult.stderr)
  }

  const restartResult = await ssh.exec("systemctl restart ssh.service")
  if (restartResult.exitCode !== 0) {
    await rollbackSshConfig(ssh, configPath, cloudInitPath, cloudInitBackedUp)
    await ssh.exec("systemctl restart ssh.service")
    return {
      name: "SSH Hardening",
      success: false,
      message: "SSH restart failed — config rolled back",
      details: restartResult.stderr,
    }
  }

  if (server.usesSocketActivation && options.changeSshPort) {
    await ssh.exec("systemctl daemon-reload && systemctl restart ssh.socket")
  }

  const verifyResult = await ssh.exec("echo ok")
  if (verifyResult.stdout !== "ok") {
    return {
      name: "SSH Hardening",
      success: true,
      message: `SSH hardened but connection lost. Reconnect with: ssh -p ${sshPort} <user>@<host>`,
      details: "ControlMaster session may have ended after SSH restart.",
    }
  }

  // Keep cloud-init backup for manual recovery if needed later

  return {
    name: "SSH Hardening",
    success: true,
    message: "SSH configuration hardened",
    details: buildDetailsSummary(options, sshPort),
  }
}
