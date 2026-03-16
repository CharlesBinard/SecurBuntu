import * as p from "@clack/prompts"
import pc from "picocolors"
import type { HardeningOptions } from "../types.ts"
import { handleCancel, isCancel, unwrapBoolean } from "./helpers.ts"

function formatRootLogin(policy: "no" | "prohibit-password" | "yes"): string {
  if (policy === "no") return pc.green("disabled")
  if (policy === "prohibit-password") return pc.cyan("key only")
  return pc.yellow("allowed")
}

function yesNo(value: boolean): string {
  return value ? pc.green("Yes") : pc.dim("No")
}

function formatServicesSummary(options: HardeningOptions): string {
  if (!options.disableServices || options.servicesToDisable.length === 0) return pc.dim("No")
  return `${pc.green("Yes")} (${pc.cyan(options.servicesToDisable.join(", "))})`
}

function buildSummaryLines(options: HardeningOptions): string[] {
  const sshPort = options.changeSshPort && options.newSshPort ? options.newSshPort : 22
  const lines: string[] = []

  if (options.createSudoUser) lines.push(`  Create sudo user: ${pc.cyan(options.sudoUsername ?? "")}`)
  if (options.addPersonalKey) lines.push(`  Add SSH key: ${pc.cyan(options.personalKeyPath ?? "")}`)
  lines.push(`  Coolify: ${yesNo(options.configureCoolify)}`)
  lines.push(`  SSH port: ${options.changeSshPort ? pc.yellow(String(sshPort)) : pc.dim("22 (default)")}`)
  lines.push(`  Root login: ${formatRootLogin(options.permitRootLogin)}`)
  lines.push(`  SSH banner: ${yesNo(options.enableSshBanner)}`)
  lines.push(`  Disable password auth: ${yesNo(options.disablePasswordAuth)}`)
  lines.push(`  X11 forwarding: ${options.disableX11Forwarding ? pc.green("disabled") : pc.dim("enabled")}`)
  lines.push(`  Max auth tries: ${pc.cyan(String(options.maxAuthTries))}`)
  lines.push(`  UFW: ${formatUfwSummary(options)}`)
  lines.push(`  Fail2ban: ${yesNo(options.installFail2ban)}`)
  lines.push(`  Auto-updates: ${yesNo(options.enableAutoUpdates)}`)
  lines.push(`  Kernel hardening: ${formatSysctlSummary(options)}`)
  lines.push(`  Disable services: ${formatServicesSummary(options)}`)
  lines.push(`  Fix file permissions: ${yesNo(options.fixFilePermissions)}`)

  return lines
}

function formatUfwSummary(options: HardeningOptions): string {
  if (!options.installUfw) return pc.dim("No")
  const ports = options.ufwPorts.map((ufw) => ufw.port).join(", ")
  return `${pc.green("Yes")} (ports: ${pc.cyan(ports)})`
}

function formatSysctlSummary(options: HardeningOptions): string {
  if (!(options.enableSysctl && options.sysctlOptions)) return pc.dim("No")
  const count = Object.values(options.sysctlOptions).filter(Boolean).length
  return pc.green(`${count} parameter(s)`)
}

export async function promptConfirmation(
  host: string,
  options: HardeningOptions,
): Promise<"apply" | "simulate" | false> {
  const lines = buildSummaryLines(options)
  p.note(lines.join("\n"), "Summary of changes")

  const action = await p.select({
    message: `What do you want to do with ${pc.bold(host)}?`,
    options: [
      { value: "apply" as const, label: "Apply changes" },
      { value: "simulate" as const, label: "Simulate first (dry-run)", hint: "preview without modifying" },
      { value: "cancel" as const, label: "Cancel" },
    ],
  })

  if (p.isCancel(action) || action === "cancel") return false
  if (action === "apply" || action === "simulate") return action
  return false
}

export async function promptExportReport(): Promise<boolean> {
  const exportReport = unwrapBoolean(
    await p.confirm({
      message: "Do you want to export this report as a Markdown file?",
      initialValue: false,
    }),
  )
  return exportReport
}

export async function promptExportLog(): Promise<boolean> {
  const exportLog = unwrapBoolean(
    await p.confirm({
      message: "Do you want to save a detailed log of all commands executed?",
      initialValue: false,
    }),
  )
  return exportLog
}

export async function promptExportAudit(): Promise<boolean> {
  const exportAudit = unwrapBoolean(
    await p.confirm({
      message: "Do you want to export the audit report as a Markdown file?",
      initialValue: false,
    }),
  )
  return exportAudit
}

export async function promptCopyKeyOnFailure(): Promise<boolean> {
  const action = await p.select({
    message: "Would you like to copy your SSH key to the server?",
    options: [
      { value: "yes" as const, label: "Yes, copy my key", hint: "needs password" },
      { value: "no" as const, label: "No, let me try different credentials" },
    ],
  })
  if (isCancel(action)) handleCancel()
  return action === "yes"
}
