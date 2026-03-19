export interface CliArgs {
  isDryRun: boolean
  wantLog: boolean
  isAuditOnly: boolean
  presetName?: string
}

export function parseArgs(): CliArgs | null {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(`SecurBuntu — Ubuntu server hardening tool

Usage: bun src/index.ts [options]

Options:
  --preset <name|path>  Apply a hardening preset (skip interactive prompts)
  --check               Run health check audit (read-only, no hardening)
  --audit               Alias for --check
  --dry-run             Preview changes without applying them
  --log                 Automatically save execution log
  -h, --help            Show this help message
`)
    process.exit(0)
  }

  const isAuditOnly = process.argv.includes("--audit") || process.argv.includes("--check")

  let presetName: string | undefined
  const presetIndex = process.argv.indexOf("--preset")
  if (presetIndex !== -1) {
    presetName = process.argv[presetIndex + 1]
    if (!presetName || presetName.startsWith("--")) {
      console.error("Error: --preset requires a value (preset name or file path)")
      process.exit(1)
    }
  }

  if (presetName && isAuditOnly) {
    console.error("Error: --preset and --check/--audit are mutually exclusive")
    process.exit(1)
  }

  return {
    isDryRun: process.argv.includes("--dry-run"),
    wantLog: process.argv.includes("--log"),
    isAuditOnly,
    presetName,
  }
}
