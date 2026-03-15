#!/usr/bin/env bun
import { outro, log, spinner } from "@clack/prompts"
import pc from "picocolors"
import { showBanner, initVersion } from "./ui.js"
import { connect, detectServerInfo } from "./ssh.js"
import { promptConnection, promptHardeningOptions, promptConfirmation, promptExportReport } from "./prompts.js"
import { executeTasks } from "./tasks/index.js"
import { displayReport, exportReportMarkdown } from "./report.js"
import type { Report } from "./types.js"

async function main(): Promise<void> {
  await initVersion()
  showBanner()

  // 1. Connection loop — retry until connected
  const s = spinner()
  let ssh
  let connectionConfig

  while (true) {
    connectionConfig = await promptConnection()

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

    // 4. System update (unconditional)
    s.start("Updating system packages (this may take a while)...")
    const updateResult = await ssh.exec(
      "DEBIAN_FRONTEND=noninteractive apt update && DEBIAN_FRONTEND=noninteractive apt upgrade -y",
      { timeout: 900_000 },
    )
    if (updateResult.exitCode !== 0) {
      s.stop(pc.yellow("System update completed with warnings"))
      log.warning(pc.dim(updateResult.stderr))
    } else {
      s.stop("System packages updated")
    }

    // 5. Interactive questionnaire
    const options = await promptHardeningOptions(serverInfo, ssh)

    // 6. Confirmation
    const confirmed = await promptConfirmation(connectionConfig.host, options)
    if (!confirmed) {
      outro(pc.dim("Aborted. No changes were made (except system update)."))
      ssh.close()
      return
    }

    // 7. Execute hardening tasks
    const results = await executeTasks(ssh, options, serverInfo)

    // Add the update result to the beginning
    results.unshift({
      name: "System Update",
      success: updateResult.exitCode === 0,
      message: updateResult.exitCode === 0 ? "System packages updated" : "Completed with warnings",
    })

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
