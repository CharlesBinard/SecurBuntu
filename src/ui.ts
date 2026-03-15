import pc from "picocolors"
import { intro } from "@clack/prompts"

async function getVersionAsync(): Promise<string> {
  try {
    const file = Bun.file(import.meta.dir + "/../package.json")
    const pkg: { version: string } = await file.json()
    return pkg.version
  } catch {
    return "0.0.0"
  }
}

let cachedVersion = "0.0.0"

export async function initVersion(): Promise<void> {
  cachedVersion = await getVersionAsync()
}

function getVersion(): string {
  return cachedVersion
}

export function showBanner(): void {
  const version = getVersion()
  const banner = `
${pc.cyan(pc.bold("   ____                       ____              _        "))}
${pc.cyan(pc.bold("  / ___|  ___  ___ _   _ _ __| __ ) _   _ _ __ | |_ _   _"))}
${pc.cyan(pc.bold("  \\___ \\ / _ \\/ __| | | | '__|  _ \\| | | | '_ \\| __| | | |"))}
${pc.cyan(pc.bold("   ___) |  __/ (__| |_| | |  | |_) | |_| | | | | |_| |_| |"))}
${pc.cyan(pc.bold("  |____/ \\___|\\___|\\__,_|_|  |____/ \\__,_|_| |_|\\__|\\__,_|"))}

  ${pc.dim(`v${version} — Ubuntu Server Hardening Tool`)}
`
  console.log(banner)
  intro(pc.bgCyan(pc.black(" SecurBuntu ")))
}

export function formatSuccess(message: string): string {
  return `${pc.green("✓")} ${message}`
}

export function formatError(message: string): string {
  return `${pc.red("✗")} ${message}`
}

export function formatWarning(message: string): string {
  return `${pc.yellow("!")} ${message}`
}

export function formatInfo(message: string): string {
  return `${pc.cyan("→")} ${message}`
}
