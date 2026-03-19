import { mkdirSync, writeFileSync } from "fs"
import { join } from "path"
import type { HardeningOptions, Preset, PresetOptions } from "../types.ts"
import { BUILT_IN_PRESETS } from "./built-in.ts"
import { getPresetsDir } from "./config-dir.ts"

export function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
}

function hardeningToPresetOptions(options: HardeningOptions): PresetOptions {
  return {
    changeSshPort: options.changeSshPort,
    newSshPort: options.newSshPort,
    permitRootLogin: options.permitRootLogin,
    disablePasswordAuth: options.disablePasswordAuth,
    disableX11Forwarding: options.disableX11Forwarding,
    maxAuthTries: options.maxAuthTries,
    enableSshBanner: options.enableSshBanner,
    installUfw: options.installUfw,
    ufwPorts: options.ufwPorts,
    installFail2ban: options.installFail2ban,
    enableAutoUpdates: options.enableAutoUpdates,
    enableSysctl: options.enableSysctl,
    sysctlOptions: options.sysctlOptions,
    disableServices: options.disableServices,
    servicesToDisable: options.servicesToDisable,
    fixFilePermissions: options.fixFilePermissions,
    installTailscale: options.installTailscale,
    tailscaleOptions: options.tailscaleOptions,
  }
}

export function savePreset(name: string, options: HardeningOptions, description: string, presetsDir?: string): string {
  const sanitized = sanitizeName(name)

  if (BUILT_IN_PRESETS[sanitized]) {
    throw new Error(`Cannot save preset: '${sanitized}' is a built-in preset name.`)
  }

  const dir = presetsDir ?? getPresetsDir()
  mkdirSync(dir, { recursive: true })

  const preset: Preset = {
    name: sanitized,
    description,
    version: 1,
    options: hardeningToPresetOptions(options),
  }

  const filePath = join(dir, `${sanitized}.json`)
  writeFileSync(filePath, JSON.stringify(preset, null, 2))
  return filePath
}
