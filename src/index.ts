#!/usr/bin/env bun
import { confirm, isCancel, log, outro, password as passwordPrompt, spinner } from "@clack/prompts"
import { existsSync } from "fs"
import pc from "picocolors"
import { displayAudit, runAudit } from "./audit.js"
import { DryRunSshClient } from "./dry-run.js"
import { LoggingSshClient } from "./logging.js"
import {
  promptConfirmation,
  promptConnection,
  promptCopyKeyOnFailure,
  promptExportAudit,
  promptExportLog,
  promptExportReport,
  promptHardeningOptions,
} from "./prompts.js"
import { displayReport, exportAuditMarkdown, exportReportMarkdown } from "./report.js"
import {
  addToKnownHosts,
  checkSshCopyIdInstalled,
  connect,
  copyKeyToServer,
  detectServerInfo,
  fetchHostKeyFingerprint,
} from "./ssh.js"
import { executeTasks } from "./tasks/index.js"
import type { AuditResult, ConnectionConfig, HardeningOptions, Report, ServerInfo, SshClient } from "./types.js"
import { initVersion, showBanner } from "./ui.js"

interface CliArgs {
  isDryRun: boolean
  wantLog: boolean
  isAuditOnly: boolean
}

function parseArgsAndShowBanner(): CliArgs | null {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(`SecurBuntu — Ubuntu server hardening tool

Usage: bun src/index.ts [options]

Options:
  --audit     Run security audit only (no hardening)
  --dry-run   Preview changes without applying them
  --log       Automatically save execution log
  -h, --help  Show this help message
`)
    process.exit(0)
  }

  showBanner()

  return {
    isDryRun: process.argv.includes("--dry-run"),
    wantLog: process.argv.includes("--log"),
    isAuditOnly: process.argv.includes("--audit"),
  }
}

async function verifyHostKey(config: ConnectionConfig, s: ReturnType<typeof spinner>): Promise<"continue" | "retry"> {
  s.start(`Checking host key for ${config.host}...`)
  const hostKeyResult = await fetchHostKeyFingerprint(config.host, config.port)

  if (hostKeyResult.known) {
    s.stop(`Host key verified for ${pc.green(config.host)}`)
    return "continue"
  }

  if (hostKeyResult.fingerprint) {
    s.stop("New host detected")
    log.info(`${pc.bold("Host key fingerprint:")}\n  ${pc.cyan(hostKeyResult.fingerprint)}`)

    const trust = await confirm({ message: "Do you trust this host?" })
    if (isCancel(trust) || !trust) {
      return "retry"
    }

    addToKnownHosts(hostKeyResult.rawKeys)
    return "continue"
  }

  s.stop(pc.yellow("Could not fetch host key"))
  log.warning("Unable to verify host key. The connection will proceed but the host is unverified.")
  return "continue"
}

async function handleCopyAuthMethod(config: ConnectionConfig): Promise<"continue" | "retry"> {
  if (config.authMethod !== "copy" || !config.privateKeyPath) {
    return "continue"
  }

  const pubKeyPath = `${config.privateKeyPath}.pub`
  log.info(pc.dim("Copying your SSH key to the server. You will be prompted for the password."))

  const result = await copyKeyToServer(config.host, config.username, pubKeyPath, config.port)

  if (result.success) {
    log.success("SSH key copied successfully. Connecting with key auth...")
    config.authMethod = "key"
    return "continue"
  }

  if (result.passwordAuthDisabled) {
    log.error(
      `${pc.red("The server does not accept password authentication.")}\n` +
        `  ${pc.dim("Password auth is disabled on this server, so ssh-copy-id cannot connect.")}\n` +
        `  ${pc.dim("To add your key, use the server console or cloud provider dashboard to add")}\n` +
        `  ${pc.dim("your public key to /root/.ssh/authorized_keys manually.")}`,
    )
  } else {
    log.error(pc.red("Failed to copy SSH key. Check the password and try again."))
  }

  log.info(pc.cyan("Let's try again.\n"))
  return "retry"
}

async function handleSudoPasswordPrompt(
  config: ConnectionConfig,
  s: ReturnType<typeof spinner>,
): Promise<SshClient | "retry"> {
  s.stop(pc.yellow("Sudo password required"))
  log.warning(
    `${pc.bold("User does not have passwordless sudo.")}\n` +
      `  ${pc.dim("For better security, consider configuring NOPASSWD sudo for this user.")}`,
  )

  const sudoPw = await passwordPrompt({
    message: "Enter the sudo password",
    validate(value) {
      if (!value) return "Password is required"
    },
  })
  if (isCancel(sudoPw)) {
    log.info(pc.cyan("Let's try again.\n"))
    return "retry"
  }

  config.sudoPassword = sudoPw

  s.start(`Reconnecting to ${config.host}...`)
  try {
    const ssh = await connect(config)
    s.stop(`Connected to ${pc.green(config.host)}`)
    return ssh
  } catch (retryError) {
    const retryMsg = retryError instanceof Error ? retryError.message : "Unknown error"
    s.stop(pc.red(`Connection failed: ${retryMsg}`))
    log.info(pc.cyan("Let's try again.\n"))
    return "retry"
  }
}

async function handlePermissionDenied(config: ConnectionConfig): Promise<void> {
  const wantCopy = await promptCopyKeyOnFailure()
  if (!wantCopy) return

  const pubKeyPath = `${config.privateKeyPath}.pub`

  if (!existsSync(pubKeyPath)) {
    log.error(pc.red(`Public key not found at ${pubKeyPath}`))
    return
  }

  const hasSshCopyId = await checkSshCopyIdInstalled()
  if (!hasSshCopyId) {
    log.error(
      `${pc.red("ssh-copy-id is required but is not installed.")}\n` +
        `  ${pc.dim("Install it with:")}\n` +
        `  ${pc.cyan("  Ubuntu/Debian: sudo apt install openssh-client")}\n` +
        `  ${pc.cyan("  macOS:         brew install ssh-copy-id")}`,
    )
    return
  }

  log.info(pc.dim("Copying your SSH key to the server. You will be prompted for the password."))
  const copyResult = await copyKeyToServer(config.host, config.username, pubKeyPath, config.port)

  if (copyResult.success) {
    log.success("SSH key copied successfully. Reconnecting...")
  } else if (copyResult.passwordAuthDisabled) {
    log.error(
      `${pc.red("The server does not accept password authentication.")}\n` +
        `  ${pc.dim("Password auth is disabled on this server, so ssh-copy-id cannot connect.")}\n` +
        `  ${pc.dim("To add your key, use the server console or cloud provider dashboard to add")}\n` +
        `  ${pc.dim("your public key to /root/.ssh/authorized_keys manually.")}`,
    )
  } else {
    log.error(pc.red("Failed to copy SSH key. Check the password and try again."))
  }
}

async function handleConnectionError(
  error: unknown,
  config: ConnectionConfig,
  s: ReturnType<typeof spinner>,
): Promise<SshClient | "retry"> {
  const msg = error instanceof Error ? error.message : "Unknown error"

  if (msg === "SUDO_PASSWORD_REQUIRED") {
    return handleSudoPasswordPrompt(config, s)
  }

  s.stop(pc.red(`Connection failed: ${msg}`))

  if (config.authMethod === "key" && config.privateKeyPath && msg.includes("Permission denied")) {
    await handlePermissionDenied(config)
  } else {
    log.warning(
      `${pc.bold("Troubleshooting:")}\n` +
        `  ${pc.dim("- Verify the IP address and port")}\n` +
        `  ${pc.dim("- Check that SSH is running on the server")}\n` +
        `  ${pc.dim("- Verify your credentials (key path or password)")}\n` +
        `  ${pc.dim("- Check network connectivity")}`,
    )
  }

  log.info(pc.cyan("Let's try again.\n"))
  return "retry"
}

async function connectWithRetry(): Promise<{ ssh: SshClient; connectionConfig: ConnectionConfig }> {
  const s = spinner()

  while (true) {
    let connectionConfig: ConnectionConfig
    try {
      connectionConfig = await promptConnection()
    } catch {
      log.info(pc.cyan("Let's try again.\n"))
      continue
    }

    const hostKeyAction = await verifyHostKey(connectionConfig, s)
    if (hostKeyAction === "retry") {
      log.info(pc.cyan("Let's try again.\n"))
      continue
    }

    const copyAction = await handleCopyAuthMethod(connectionConfig)
    if (copyAction === "retry") continue

    s.start(`Connecting to ${connectionConfig.host}...`)

    try {
      const ssh = await connect(connectionConfig)
      s.stop(`Connected to ${pc.green(connectionConfig.host)}`)
      return { ssh, connectionConfig }
    } catch (error) {
      const result = await handleConnectionError(error, connectionConfig, s)
      if (result === "retry") continue
      return { ssh: result, connectionConfig }
    }
  }
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

async function main(): Promise<void> {
  await initVersion()
  const args = parseArgsAndShowBanner()
  if (!args) return
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

main().catch((error) => {
  console.error(pc.red("Fatal error:"), error instanceof Error ? error.message : error)
  process.exit(1)
})
