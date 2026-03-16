import { note } from "@clack/prompts"
import pc from "picocolors"
import type { Report } from "../types.ts"

function formatAuditSection(report: Report): string[] {
  const lines: string[] = []

  if (report.audit && report.postAudit) {
    lines.push("")
    lines.push(pc.bold("Before / After:"))
    for (const [i, before] of report.audit.checks.entries()) {
      const after = report.postAudit.checks[i]
      const afterStatus = after?.status ?? "—"
      const changed = before.status !== afterStatus
      const arrow = changed ? pc.green("→") : pc.dim("→")
      const afterColored = changed ? pc.green(afterStatus) : pc.dim(afterStatus)
      lines.push(`  ${pc.dim(before.name)}: ${before.status} ${arrow} ${afterColored}`)
    }
  } else if (report.audit) {
    lines.push("")
    lines.push(pc.bold("Audit (pre-hardening):"))
    for (const check of report.audit.checks) {
      lines.push(`  ${pc.dim(check.name)}: ${check.status}`)
    }
  }

  return lines
}

export function displayReport(report: Report): void {
  const lines: string[] = []

  lines.push(`${pc.bold("Server:")} ${report.serverIp}`)
  lines.push(`${pc.bold("User:")} ${report.connectionUser}`)
  if (report.sudoUser) {
    lines.push(`${pc.bold("New sudo user:")} ${pc.cyan(report.sudoUser)}`)
  }
  lines.push(`${pc.bold("Ubuntu:")} ${report.ubuntuVersion}`)
  lines.push(`${pc.bold("Date:")} ${report.date}`)
  lines.push("")

  for (const result of report.results) {
    const icon = result.success ? pc.green("✓") : pc.red("✗")
    lines.push(`${icon} ${pc.bold(result.name)}: ${result.message}`)
    if (result.details) {
      lines.push(`  ${pc.dim(result.details)}`)
    }
  }

  lines.push(...formatAuditSection(report))

  if (report.newSshPort) {
    lines.push("")
    lines.push(pc.yellow(pc.bold(`⚠  SSH port changed to ${report.newSshPort}`)))
    const user = report.sudoUser ?? report.connectionUser
    lines.push(pc.cyan(`   ssh -p ${report.newSshPort} ${user}@${report.serverIp}`))
  }

  note(lines.join("\n"), "SecurBuntu Report")
}
