import { existsSync } from "fs"
import { join } from "path"
import type { Preset } from "../types.ts"
import { BUILT_IN_PRESETS } from "./built-in.ts"
import { getPresetsDir } from "./config-dir.ts"

export function isFilePath(nameOrPath: string): boolean {
  return nameOrPath.includes("/") || nameOrPath.includes("\\") || nameOrPath.endsWith(".json")
}

const REQUIRED_OPTION_FIELDS = [
  "changeSshPort",
  "permitRootLogin",
  "disablePasswordAuth",
  "disableX11Forwarding",
  "maxAuthTries",
  "enableSshBanner",
  "installUfw",
  "ufwPorts",
  "installFail2ban",
  "enableAutoUpdates",
  "enableSysctl",
  "disableServices",
  "servicesToDisable",
  "fixFilePermissions",
  "installTailscale",
] as const

const VALID_ROOT_LOGIN = ["no", "prohibit-password", "yes"]

export function validatePreset(data: unknown): asserts data is Preset {
  if (!data || typeof data !== "object") {
    throw new Error("Preset must be a JSON object")
  }

  const obj = data as Record<string, unknown>

  if (!obj.name || typeof obj.name !== "string") {
    throw new Error("Preset is invalid: 'name' must be a non-empty string")
  }

  if (obj.version !== 1) {
    throw new Error(`Preset '${obj.name}' is invalid: 'version' must be 1, got ${obj.version}`)
  }

  if (!obj.options || typeof obj.options !== "object") {
    throw new Error(`Preset '${obj.name}' is invalid: missing 'options' object`)
  }

  if (!obj.description || typeof obj.description !== "string") {
    throw new Error(`Preset '${obj.name}' is invalid: 'description' must be a non-empty string`)
  }

  const options = obj.options as Record<string, unknown>

  for (const field of REQUIRED_OPTION_FIELDS) {
    if (options[field] === undefined) {
      throw new Error(`Preset '${obj.name}' is invalid: missing field '${field}'`)
    }
  }

  if (!Array.isArray(options.ufwPorts)) {
    throw new Error(`Preset '${obj.name}' is invalid: 'ufwPorts' must be an array`)
  }
  for (const entry of options.ufwPorts as unknown[]) {
    const port = entry as Record<string, unknown>
    if (!(port.port && port.protocol && port.comment)) {
      throw new Error(`Preset '${obj.name}' is invalid: each ufwPorts entry must have port, protocol, and comment`)
    }
    if (!["tcp", "udp", "both"].includes(port.protocol as string)) {
      throw new Error(`Preset '${obj.name}' is invalid: ufwPorts protocol must be tcp, udp, or both`)
    }
  }

  if (!VALID_ROOT_LOGIN.includes(options.permitRootLogin as string)) {
    throw new Error(`Preset '${obj.name}' is invalid: 'permitRootLogin' must be one of: ${VALID_ROOT_LOGIN.join(", ")}`)
  }

  if (options.changeSshPort === true && (options.newSshPort === undefined || options.newSshPort === null)) {
    throw new Error(`Preset '${obj.name}' is invalid: 'newSshPort' is required when 'changeSshPort' is true`)
  }

  if (options.enableSysctl === true && !options.sysctlOptions) {
    throw new Error(`Preset '${obj.name}' is invalid: 'sysctlOptions' is required when 'enableSysctl' is true`)
  }
}

export async function loadPreset(nameOrPath: string): Promise<Preset> {
  // Built-in preset
  if (!isFilePath(nameOrPath) && BUILT_IN_PRESETS[nameOrPath]) {
    return BUILT_IN_PRESETS[nameOrPath]
  }

  // File path
  if (isFilePath(nameOrPath)) {
    if (!existsSync(nameOrPath)) {
      throw new Error(`Preset file not found: ${nameOrPath}`)
    }
    const file = Bun.file(nameOrPath)
    const text = await file.text()
    let data: unknown
    try {
      data = JSON.parse(text)
    } catch {
      throw new Error(`Preset file is not valid JSON: ${nameOrPath}`)
    }
    validatePreset(data)
    return data
  }

  // Custom preset by name
  const presetsDir = getPresetsDir()
  const filePath = join(presetsDir, `${nameOrPath}.json`)
  if (!existsSync(filePath)) {
    throw new Error(`Preset '${nameOrPath}' not found. Not a built-in preset and no file at ${filePath}`)
  }

  const file = Bun.file(filePath)
  const text = await file.text()
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(`Custom preset '${nameOrPath}' is not valid JSON: ${filePath}`)
  }
  validatePreset(data)
  return data
}

export async function listCustomPresetsFromDir(dir: string): Promise<Preset[]> {
  if (!existsSync(dir)) return []

  const { readdirSync } = await import("fs")
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"))
  const presets: Preset[] = []

  for (const file of files) {
    try {
      const filePath = join(dir, file)
      const content = await Bun.file(filePath).text()
      const data = JSON.parse(content)
      validatePreset(data)
      presets.push(data)
    } catch {
      // Skip invalid preset files
    }
  }

  return presets
}

export async function listCustomPresets(): Promise<Preset[]> {
  return listCustomPresetsFromDir(getPresetsDir())
}
