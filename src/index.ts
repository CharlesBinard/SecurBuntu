#!/usr/bin/env bun
import { outro, log, spinner, confirm, isCancel } from "@clack/prompts"
import pc from "picocolors"
import { showBanner, initVersion } from "./ui.js"
import { connect, detectServerInfo, fetchHostKeyFingerprint, addToKnownHosts } from "./ssh.js"
import { promptConnection, promptHardeningOptions, promptConfirmation, promptExportReport } from "./prompts.js"
import { executeTasks } from "./tasks/index.js"
import { displayReport, exportReportMarkdown } from "./report.js"
import { DryRunSshClient } from "./dry-run.js"
import type { Report } from "./types.js"

async function main(): Promise<void> {
  await initVersion()
  const isDryRun = process.argv.includes("--dry-run")
  showBanner()

  // 1. Connection loop — retry until connected
  const s = spinner()
  let ssh
  let connectionConfig

  while (true) {
    connectionConfig = await promptConnection()

    // Verify host key before connecting
    s.start(`Checking host key for ${connectionConfig.host}...`)
    const hostKeyResult = await fetchHostKeyFingerprint(connectionConfig.host, connectionConfig.port)

    if (hostKeyResult.known) {
      s.stop(`Host key verified for ${pc.green(connectionConfig.host)}`)
    } else if (hostKeyResult.fingerprint) {
      // Stop spinner BEFORE showing interactive prompt
      s.stop("New host detected")
      log.info(
        `${pc.bold("Host key fingerprint:")}\n` +
        `  ${pc.cyan(hostKeyResult.fingerprint)}`
      )

      const trust = await confirm({
        message: "Do you trust this host?",
      })

      if (isCancel(trust) || !trust) {
        log.info(pc.cyan("Let's try again.\n"))
        continue
      }

      addToKnownHosts(hostKeyResult.rawKeys)
    } else {
      s.stop(pc.yellow("Could not fetch host key"))
      log.warning("Unable to verify host key. The connection will proceed but the host is unverified.")
    }

    s.start(`Connecting to ${connectionConfig.host}...`)

    try {
      ssh = await connect(connectionConfig)
      s.stop(`Connected to ${pc.green(connectionConfig.host)}`)
      break
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error"
      s.stop(pc.red(`Connection failed: ${msg}`))
      log.warning(
        `${pc.bold("Troubleshooting:")}\n` +
        `  ${pc.dim("- Verify the IP address and port")}\n` +
        `  ${pc.dim("- Check that SSH is running on the server")}\n` +
        `  ${pc.dim("- Verify your credentials (key path or password)")}\n` +
        `  ${pc.dim("- Check network connectivity")}`,
      )
      log.info(pc.cyan("Let's try again.\n"))
    }
  }

  try {
    // 3. Detect server info
    s.start("Detecting server configuration...")
    const serverInfo = await detectServerInfo(ssh)
    s.stop(`Detected Ubuntu ${pc.cyan(serverInfo.ubuntuVersion)} (${serverInfo.ubuntuCodename})`)

    if (serverInfo.usesSocketActivation) {
      log.info(pc.dim("SSH socket activation detected (Ubuntu 24.04+ mode)"))
    }

    // 4. System update (unconditional, unless --dry-run)
    let updateSuccess = true
    let updateMessage = "System packages updated"

    if (!isDryRun) {
      s.start("Updating system packages (this may take a while)...")
      const updateResult = await ssh.exec(
        "DEBIAN_FRONTEND=noninteractive apt update && DEBIAN_FRONTEND=noninteractive apt upgrade -y",
        { timeout: 900_000 },
      )
      if (updateResult.exitCode !== 0) {
        s.stop(pc.yellow("System update completed with warnings"))
        log.warning(pc.dim(updateResult.stderr))
        updateSuccess = false
        updateMessage = "Completed with warnings"
      } else {
        s.stop("System packages updated")
      }
    } else {
      log.info(pc.yellow("[DRY-RUN] System update skipped"))
    }

    // 5. Interactive questionnaire
    const options = await promptHardeningOptions(serverInfo, ssh)

    // 6. Confirmation (3-way: apply / simulate / cancel)
    const confirmation = await promptConfirmation(connectionConfig.host, options)
    if (!confirmation) {
      outro(pc.dim("Aborted. No changes were made" + (isDryRun ? "." : " (except system update).")))
      ssh.close()
      return
    }

    // 7. Handle dry-run (CLI flag or interactive simulate)
    if (isDryRun || confirmation === "simulate") {
      const dryRunSsh = new DryRunSshClient(ssh)
      await executeTasks(dryRunSsh, options, serverInfo)
      dryRunSsh.displaySummary()

      if (isDryRun) {
        outro(pc.dim("Dry-run complete. No changes were made."))
        ssh.close()
        return
      }

      // Interactive simulate: offer to apply for real
      const applyForReal = await confirm({
        message: "Apply these changes for real?",
      })
      if (isCancel(applyForReal) || !applyForReal) {
        outro(pc.dim("Aborted. No changes were made (except system update)."))
        ssh.close()
        return
      }
    }

    // 8. Execute hardening tasks for real
    const results = await executeTasks(ssh, options, serverInfo)

    if (!isDryRun) {
      results.unshift({
        name: "System Update",
        success: updateSuccess,
        message: updateMessage,
      })
    }

    // 8. Report
    const report: Report = {
      serverIp: connectionConfig.host,
      connectionUser: connectionConfig.username,
      sudoUser: options.createSudoUser ? options.sudoUsername : undefined,
      date: new Date().toISOString().split("T")[0] ?? "",
      ubuntuVersion: serverInfo.ubuntuVersion,
      results,
      newSshPort: options.changeSshPort ? options.newSshPort : undefined,
    }

    displayReport(report)

    const wantExport = await promptExportReport()
    if (wantExport) {
      const filename = exportReportMarkdown(report)
      log.success(`Report saved to ${pc.cyan(filename)}`)
    }

    outro(pc.green(pc.bold("Server hardening complete!")))
  } finally {
    ssh.close()
  }
}

main().catch((error) => {
  console.error(pc.red("Fatal error:"), error instanceof Error ? error.message : error)
  process.exit(1)
})
