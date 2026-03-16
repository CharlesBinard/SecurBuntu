import { confirm, isCancel, log, outro, spinner } from "@clack/prompts"
import pc from "picocolors"
import { displayAudit, runAudit } from "./audit/index.ts"
import { connectWithRetry } from "./connection/index.ts"
import { DryRunSshClient } from "./dry-run.ts"
import { LoggingSshClient } from "./logging.ts"
import {
  promptConfirmation,
  promptExportAudit,
  promptExportLog,
  promptExportReport,
  promptHardeningOptions,
} from "./prompts/index.ts"
import { displayReport, exportAuditMarkdown, exportReportMarkdown } from "./report/index.ts"
import { detectServerInfo } from "./ssh/index.ts"
import { executeTasks } from "./tasks/index.ts"
import type { AuditResult, ConnectionConfig, HardeningOptions, Report, ServerInfo, SshClient } from "./types.ts"

interface RunArgs {
  isDryRun: boolean
  wantLog: boolean
  isAuditOnly: boolean
}

async function detectAndAudit(
  ssh: SshClient,
  s: ReturnType<typeof spinner>,
): Promise<{ serverInfo: ServerInfo; auditResult: AuditResult }> {
  s.start("Detecting server configuration...")
  const serverInfo = await detectServerInfo(ssh)
  s.stop(`Detected Ubuntu ${pc.cyan(serverInfo.ubuntuVersion)} (${serverInfo.ubuntuCodename})`)

  if (serverInfo.usesSocketActivation) {
    log.info(pc.dim("SSH socket activation detected (Ubuntu 24.04+ mode)"))
  }

  s.start("Scanning server security configuration...")
  const auditResult = await runAudit(ssh)
  s.stop("Security audit complete")
  displayAudit(auditResult)

  return { serverInfo, auditResult }
}

async function handleAuditOnlyMode(ssh: SshClient, auditResult: AuditResult, host: string): Promise<void> {
  const wantExport = await promptExportAudit()
  if (wantExport) {
    const date = new Date().toISOString().split("T")[0] ?? ""
    const filename = exportAuditMarkdown(auditResult, host, date)
    log.success(`Audit report saved to ${pc.cyan(filename)}`)
  }
  outro(pc.green("Audit complete."))
  ssh.close()
}

async function runSystemUpdate(
  ssh: SshClient,
  isDryRun: boolean,
  s: ReturnType<typeof spinner>,
): Promise<{ updateSuccess: boolean; updateMessage: string }> {
  if (isDryRun) {
    log.info(pc.yellow("[DRY-RUN] System update skipped"))
    return { updateSuccess: true, updateMessage: "System packages updated" }
  }

  s.start("Updating system packages (this may take a while)...")
  const updateResult = await ssh.exec(
    "DEBIAN_FRONTEND=noninteractive apt update && DEBIAN_FRONTEND=noninteractive apt upgrade -y",
    { timeout: 900_000 },
  )

  if (updateResult.exitCode !== 0) {
    s.stop(pc.yellow("System update completed with warnings"))
    log.warning(pc.dim(updateResult.stderr))
    return { updateSuccess: false, updateMessage: "Completed with warnings" }
  }

  s.stop("System packages updated")
  return { updateSuccess: true, updateMessage: "System packages updated" }
}

async function handleDryRunOrSimulate(
  ssh: SshClient,
  isDryRun: boolean,
  confirmation: "apply" | "simulate",
  options: HardeningOptions,
  serverInfo: ServerInfo,
): Promise<"abort" | "proceed"> {
  if (!isDryRun && confirmation !== "simulate") return "proceed"

  const dryRunSsh = new DryRunSshClient(ssh)
  await executeTasks(dryRunSsh, options, serverInfo)
  dryRunSsh.displaySummary()

  if (isDryRun) {
    outro(pc.dim("Dry-run complete. No changes were made."))
    ssh.close()
    return "abort"
  }

  const applyForReal = await confirm({ message: "Apply these changes for real?" })
  if (isCancel(applyForReal) || !applyForReal) {
    outro(pc.dim("Aborted. No changes were made (except system update)."))
    ssh.close()
    return "abort"
  }

  return "proceed"
}

async function exportLogIfNeeded(loggingSsh: LoggingSshClient, host: string, wantLog: boolean): Promise<void> {
  if (!loggingSsh.hasEntries()) return

  const shouldSaveLog = wantLog || (await promptExportLog())
  if (!shouldSaveLog) return

  const sanitizedIp = host.replace(/:/g, "-")
  const date = new Date().toISOString().split("T")[0] ?? "unknown"
  const logFilename = `securbuntu-log-${sanitizedIp}-${date}.txt`
  loggingSsh.flush(logFilename)
  log.success(`Log saved to ${pc.cyan(logFilename)}`)
}

async function executeAndReport(
  ssh: SshClient,
  connectionConfig: ConnectionConfig,
  options: HardeningOptions,
  serverInfo: ServerInfo,
  auditResult: AuditResult,
  isDryRun: boolean,
  updateSuccess: boolean,
  updateMessage: string,
  wantLog: boolean,
  s: ReturnType<typeof spinner>,
): Promise<void> {
  const loggingSsh = new LoggingSshClient(ssh)
  const results = await executeTasks(loggingSsh, options, serverInfo)

  if (!isDryRun) {
    results.unshift({
      name: "System Update",
      success: updateSuccess,
      message: updateMessage,
    })
  }

  s.start("Running post-hardening audit...")
  const postAudit = await runAudit(ssh)
  s.stop("Post-hardening audit complete")

  const report: Report = {
    serverIp: connectionConfig.host,
    connectionUser: connectionConfig.username,
    sudoUser: options.createSudoUser ? options.sudoUsername : undefined,
    date: new Date().toISOString().split("T")[0] ?? "",
    ubuntuVersion: serverInfo.ubuntuVersion,
    results,
    newSshPort: options.changeSshPort ? options.newSshPort : undefined,
    audit: auditResult,
    postAudit,
  }

  displayReport(report)

  await exportLogIfNeeded(loggingSsh, connectionConfig.host, wantLog)

  const wantExport = await promptExportReport()
  if (wantExport) {
    const filename = exportReportMarkdown(report)
    log.success(`Report saved to ${pc.cyan(filename)}`)
  }

  outro(pc.green(pc.bold("Server hardening complete!")))
}

export async function run(args: RunArgs): Promise<void> {
  const { isDryRun, wantLog, isAuditOnly } = args

  const { ssh, connectionConfig } = await connectWithRetry()
  const s = spinner()

  try {
    const { serverInfo, auditResult } = await detectAndAudit(ssh, s)

    if (isAuditOnly) {
      await handleAuditOnlyMode(ssh, auditResult, connectionConfig.host)
      return
    }

    const { updateSuccess, updateMessage } = await runSystemUpdate(ssh, isDryRun, s)

    const options = await promptHardeningOptions(serverInfo, ssh)

    const confirmation = await promptConfirmation(connectionConfig.host, options)
    if (!confirmation) {
      outro(pc.dim(`Aborted. No changes were made${isDryRun ? "." : " (except system update)."}`))
      ssh.close()
      return
    }

    const dryRunResult = await handleDryRunOrSimulate(ssh, isDryRun, confirmation, options, serverInfo)
    if (dryRunResult === "abort") return

    await executeAndReport(
      ssh,
      connectionConfig,
      options,
      serverInfo,
      auditResult,
      isDryRun,
      updateSuccess,
      updateMessage,
      wantLog,
      s,
    )
  } finally {
    ssh.close()
  }
}
