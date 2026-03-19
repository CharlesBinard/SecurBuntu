import pc from "picocolors"
import type { CheckResult, HealthCheckScore, ServerInfo } from "../types.ts"

const INDICATORS: Record<string, string> = {
  pass: pc.green("✓"),
  warn: pc.yellow("⚠"),
  fail: pc.red("✗"),
  info: pc.blue("ℹ"),
}

export function formatHealthCheck(serverInfo: ServerInfo, checks: CheckResult[], score: HealthCheckScore): string {
  const lines: string[] = []

  lines.push(pc.bold("━━━ SecurBuntu Health Check ━━━━━━━━━━━━━━━━━━"))
  lines.push(`  Server: Ubuntu ${serverInfo.ubuntuVersion} (${serverInfo.ubuntuCodename})`)
  lines.push("")

  // Group checks by category, preserving order
  const categories: Map<string, CheckResult[]> = new Map()
  for (const check of checks) {
    const group = categories.get(check.category) ?? []
    group.push(check)
    categories.set(check.category, group)
  }

  for (const [category, categoryChecks] of categories) {
    lines.push(pc.bold(category))
    for (const check of categoryChecks) {
      const indicator = INDICATORS[check.status] ?? "?"
      const detail = check.detail ? ` ${pc.dim(`(${check.detail})`)}` : ""
      lines.push(`  ${indicator} ${check.label}${detail}`)
    }
    lines.push("")
  }

  const pct = score.total > 0 ? Math.round((score.passed / score.total) * 100) : 100
  lines.push(pc.bold(`━━━ Score: ${score.passed}/${score.total} (${pct}%) ━━━━━━━━━━━━━━━━━━━━━━━`))

  const parts: string[] = []
  parts.push(pc.green(`✓ ${score.passed} passed`))
  if (score.warned > 0) parts.push(pc.yellow(`⚠ ${score.warned} warnings`))
  if (score.failed > 0) parts.push(pc.red(`✗ ${score.failed} critical`))
  lines.push(`  ${parts.join("  ")}`)

  return lines.join("\n")
}

export function displayHealthCheck(serverInfo: ServerInfo, checks: CheckResult[], score: HealthCheckScore): void {
  console.log()
  console.log(formatHealthCheck(serverInfo, checks, score))
  console.log()
}
