import type { HardeningTask } from "../types.js"

export const runConfigureUnattended: HardeningTask = async (ssh, options) => {
  if (!options.enableAutoUpdates) {
    return {
      name: "Automatic Updates",
      success: true,
      message: "Skipped (not requested)",
    }
  }

  const installResult = await ssh.exec("DEBIAN_FRONTEND=noninteractive apt install -y unattended-upgrades")
  if (installResult.exitCode !== 0) {
    return {
      name: "Automatic Updates",
      success: false,
      message: "Failed to install unattended-upgrades",
      details: installResult.stderr,
    }
  }

  const has50 = await ssh.fileExists("/etc/apt/apt.conf.d/50unattended-upgrades")
  const warning = has50
    ? undefined
    : "Warning: /etc/apt/apt.conf.d/50unattended-upgrades not found. Security origins may not be configured."

  const autoUpgradesConfig = [
    'APT::Periodic::Update-Package-Lists "1";',
    'APT::Periodic::Unattended-Upgrade "1";',
    'APT::Periodic::AutocleanInterval "7";',
  ].join("\n")

  await ssh.writeFile("/etc/apt/apt.conf.d/20auto-upgrades", autoUpgradesConfig)

  return {
    name: "Automatic Updates",
    success: true,
    message: "Unattended-upgrades enabled",
    details: warning,
  }
}
