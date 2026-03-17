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
import type {
  AuditResult,
  ConnectionConfig,
  HardeningOptions,
  Report,
  ServerAuditContext,
  ServerInfo,
  SystemClient,
} from "./types.ts"

interface RunArgs {
  isDryRun: boolean
  wantLog: boolean
  isAuditOnly: boolean
}

async function detectAndAudit(
  client: SystemClient,
  s: ReturnType<typeof spinner>,
): Promise<{ serverInfo: ServerInfo; auditResult: AuditResult }> {
  s.start("Detecting server configuration...")
  const serverInfo = await detectServerInfo(client)
  s.stop(`Detected Ubuntu ${pc.cyan(serverInfo.ubuntuVersion)} (${serverInfo.ubuntuCodename})`)

  if (serverInfo.usesSocketActivation) {
    log.info(pc.dim("SSH socket activation detected (Ubuntu 24.04+ mode)"))
  }

  s.start("Scanning server security configuration...")
  const auditResult = await runAudit(client)
  s.stop("Security audit complete")
  displayAudit(auditResult)

  return { serverInfo, auditResult }
}

async function handleAuditOnlyMode(client: SystemClient, auditResult: AuditResult, host: string): Promise<void> {
  const wantExport = await promptExportAudit()
  if (wantExport) {
    const date = new Date().toISOString().split("T")[0] ?? ""
    const filename = exportAuditMarkdown(auditResult, host, date)
    log.success(`Audit report saved to ${pc.cyan(filename)}`)
  }
  outro(pc.green("Audit complete."))
  client.close()
}

async function runSystemUpdate(
  client: SystemClient,
  isDryRun: boolean,
  s: ReturnType<typeof spinner>,
): Promise<{ updateSuccess: boolean; updateMessage: string }> {
  if (isDryRun) {
    log.info(pc.yellow("[DRY-RUN] System update skipped"))
    return { updateSuccess: true, updateMessage: "System packages updated" }
  }

  s.start("Updating system packages (this may take a while)...")
  const updateResult = await client.exec(
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
  client: SystemClient,
  isDryRun: boolean,
  confirmation: "apply" | "simulate",
  options: HardeningOptions,
  serverInfo: ServerInfo,
): Promise<"abort" | "proceed"> {
  if (!isDryRun && confirmation !== "simulate") return "proceed"

  const dryRunClient = new DryRunSshClient(client)
  await executeTasks(dryRunClient, options, serverInfo)
  dryRunClient.displaySummary()

  if (isDryRun) {
    outro(pc.dim("Dry-run complete. No changes were made."))
    client.close()
    return "abort"
  }

  const applyForReal = await confirm({ message: "Apply these changes for real?" })
  if (isCancel(applyForReal) || !applyForReal) {
    outro(pc.dim("Aborted. No changes were made (except system update)."))
    client.close()
    return "abort"
  }

  return "proceed"
}

async function exportLogIfNeeded(loggingClient: LoggingSshClient, host: string, wantLog: boolean): Promise<void> {
  if (!loggingClient.hasEntries()) return

  const shouldSaveLog = wantLog || (await promptExportLog())
  if (!shouldSaveLog) return

  const sanitizedIp = host.replace(/:/g, "-")
  const date = new Date().toISOString().split("T")[0] ?? "unknown"
  const logFilename = `securbuntu-log-${sanitizedIp}-${date}.txt`
  loggingClient.flush(logFilename)
  log.success(`Log saved to ${pc.cyan(logFilename)}`)
}

async function executeAndReport(
  client: SystemClient,
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
  const loggingClient = new LoggingSshClient(client)
  const results = await executeTasks(loggingClient, options, serverInfo)

  if (!isDryRun) {
    results.unshift({
      name: "System Update",
      success: updateSuccess,
      message: updateMessage,
    })
  }

  s.start("Running post-hardening audit...")
  const postAudit = await runAudit(client)
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

  await exportLogIfNeeded(loggingClient, connectionConfig.host, wantLog)

  const wantExport = await promptExportReport()
  if (wantExport) {
    const filename = exportReportMarkdown(report)
    log.success(`Report saved to ${pc.cyan(filename)}`)
  }

  outro(pc.green(pc.bold("Server hardening complete!")))
}

export async function run(args: RunArgs): Promise<void> {
  const { isDryRun, wantLog, isAuditOnly } = args

  const { client, connectionConfig } = await connectWithRetry()
  const s = spinner()

  try {
    const { serverInfo, auditResult } = await detectAndAudit(client, s)

    if (isAuditOnly) {
      await handleAuditOnlyMode(client, auditResult, connectionConfig.host)
      return
    }

    const { updateSuccess, updateMessage } = await runSystemUpdate(client, isDryRun, s)

    const portCheck = auditResult.checks.find((c) => c.name === "SSH Port")
    const portStr = portCheck?.status?.replace(" (default)", "") ?? "22"
    const currentSshPort = parseInt(portStr, 10) || 22

    const ufwCheck = auditResult.checks.find((c) => c.name === "UFW Firewall")
    const ufwActive = ufwCheck?.status === "active"

    const f2bCheck = auditResult.checks.find((c) => c.name === "Fail2ban")
    const fail2banActive = f2bCheck?.status === "active"

    const sshKeysCheck = auditResult.checks.find((c) => c.name === "SSH Keys")
    const sshKeysInfo = sshKeysCheck?.status ?? "none found"

    const servicesCheck = auditResult.checks.find((c) => c.name === "Unnecessary Services")
    const detectedServices = servicesCheck?.detail?.split(", ") ?? []

    const auditContext: ServerAuditContext = {
      currentSshPort,
      ufwActive,
      fail2banActive,
      sshKeysInfo,
      detectedServices,
    }

    const options = await promptHardeningOptions(serverInfo, client, auditContext)

    const confirmation = await promptConfirmation(connectionConfig.host, options)
    if (!confirmation) {
      outro(pc.dim(`Aborted. No changes were made${isDryRun ? "." : " (except system update)."}`))
      client.close()
      return
    }

    const dryRunResult = await handleDryRunOrSimulate(client, isDryRun, confirmation, options, serverInfo)
    if (dryRunResult === "abort") return

    await executeAndReport(
      client,
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
    client.close()
  }
}
