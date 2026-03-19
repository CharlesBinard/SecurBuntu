export interface CliArgs {
  isDryRun: boolean
  wantLog: boolean
  isAuditOnly: boolean
}

export function parseArgs(): CliArgs | null {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(`SecurBuntu — Ubuntu server hardening tool

Usage: bun src/index.ts [options]

Options:
  --check     Run health check audit (read-only, no hardening)
  --audit     Alias for --check
  --dry-run   Preview changes without applying them
  --log       Automatically save execution log
  -h, --help  Show this help message
`)
    process.exit(0)
  }

  return {
    isDryRun: process.argv.includes("--dry-run"),
    wantLog: process.argv.includes("--log"),
    isAuditOnly: process.argv.includes("--audit") || process.argv.includes("--check"),
  }
}
