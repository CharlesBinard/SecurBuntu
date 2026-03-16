import type { HardeningTask } from "../types.ts"

interface ServiceDefinition {
  name: string
  description: string
}

export const UNNECESSARY_SERVICES: readonly ServiceDefinition[] = [
  { name: "cups", description: "Print server, unnecessary on headless servers" },
  { name: "avahi-daemon", description: "mDNS/DNS-SD discovery, not needed on servers" },
  { name: "bluetooth", description: "Bluetooth stack, useless on servers" },
  { name: "ModemManager", description: "Mobile broadband modem manager" },
  { name: "whoopsie", description: "Ubuntu error reporting daemon" },
  { name: "apport", description: "Crash report generator" },
  { name: "snapd", description: "Snap package manager, optional on servers" },
  { name: "rpcbind", description: "RPC port mapper (NFS), not needed unless using NFS" },
]

export const runDisableServices: HardeningTask = async (ssh, options) => {
  if (!options.disableServices || options.servicesToDisable.length === 0) {
    return {
      name: "Disable Services",
      success: true,
      message: "Skipped — no services selected",
    }
  }

  const disabled: string[] = []
  const failed: string[] = []

  for (const service of options.servicesToDisable) {
    const stopResult = await ssh.exec(`systemctl disable --now ${service}`)
    if (stopResult.exitCode !== 0) {
      failed.push(service)
      continue
    }
    const maskResult = await ssh.exec(`systemctl mask ${service}`)
    if (maskResult.exitCode !== 0) {
      failed.push(service)
      continue
    }
    disabled.push(service)
  }

  if (failed.length > 0 && disabled.length === 0) {
    return {
      name: "Disable Services",
      success: false,
      message: `Failed to disable all ${failed.length} service(s)`,
      details: `Failed: ${failed.join(", ")}`,
    }
  }

  if (failed.length > 0) {
    return {
      name: "Disable Services",
      success: false,
      message: `Disabled ${disabled.length}/${disabled.length + failed.length} service(s)`,
      details: `Disabled: ${disabled.join(", ")}. Failed: ${failed.join(", ")}`,
    }
  }

  return {
    name: "Disable Services",
    success: true,
    message: `Disabled ${disabled.length} service(s): ${disabled.join(", ")}`,
  }
}
