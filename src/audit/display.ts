import * as p from "@clack/prompts"
import pc from "picocolors"
import type { AuditResult } from "../types.js"

function colorizeStatus(status: string, isGood: boolean, isBad: boolean): string {
  if (isGood) return pc.green(status)
  if (isBad) return pc.yellow(status)
  return pc.cyan(status)
}

export function displayAudit(result: AuditResult): void {
  const lines = result.checks.map((check) => {
    const status = check.status
    const isGood =
      status.includes("active") ||
      status.includes("enabled") ||
      status.includes("hardened") ||
      status === "no" ||
      status === "prohibit-password"
    const isBad =
      status.includes("not installed") ||
      status.includes("not configured") ||
      status === "yes" ||
      status === "yes (default)" ||
      status === "default" ||
      status === "not set"

    const colored = colorizeStatus(status, isGood, isBad)

    return `  ${pc.bold(check.name)}: ${colored}${check.detail ? ` ${pc.dim(check.detail)}` : ""}`
  })

  p.note(lines.join("\n"), "Server Security Audit")
}
