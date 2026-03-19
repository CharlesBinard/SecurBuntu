#!/usr/bin/env bun
import * as p from "@clack/prompts"
import pc from "picocolors"
import { computeScore, displayHealthCheck, getExitCode, runHealthCheck } from "./audit/index.ts"
import { initVersion, parseArgs, showBanner } from "./cli/index.ts"
import { selectMode } from "./connection/index.ts"
import { run } from "./orchestrator.ts"
import { detectHostPlatform } from "./platform/index.ts"
import { detectServerInfo } from "./ssh/index.ts"

async function promptAppMode(): Promise<"harden" | "audit"> {
  const mode = await p.select({
    message: "What would you like to do?",
    options: [
      { value: "harden" as const, label: "Harden a server", hint: "full security hardening" },
      { value: "audit" as const, label: "Audit a server", hint: "health check, read-only" },
    ],
  })

  if (p.isCancel(mode)) {
    p.outro(pc.dim("Cancelled."))
    process.exit(0)
  }

  return mode
}

async function runAuditMode(connection: Awaited<ReturnType<typeof selectMode>>): Promise<void> {
  const { client } = connection
  const s = p.spinner()

  try {
    s.start("Detecting server configuration...")
    const serverInfo = await detectServerInfo(client)
    s.stop(`Detected Ubuntu ${pc.cyan(serverInfo.ubuntuVersion)} (${serverInfo.ubuntuCodename})`)

    s.start("Running health check...")
    const checks = await runHealthCheck(client)
    s.stop("Health check complete")

    const score = computeScore(checks)
    displayHealthCheck(serverInfo, checks, score)

    const exitCode = getExitCode(score)
    client.close()
    process.exit(exitCode)
  } catch (error) {
    client.close()
    throw error
  }
}

async function main(): Promise<void> {
  await initVersion()
  const args = parseArgs()
  if (!args) return
  showBanner()

  const appMode: "harden" | "audit" = args.isAuditOnly ? "audit" : await promptAppMode()

  const platform = await detectHostPlatform()
  const connection = await selectMode(platform, appMode)

  if (appMode === "audit") {
    await runAuditMode(connection)
  } else {
    await run(args, connection)
  }
}

main().catch((error) => {
  console.error(pc.red("Fatal error:"), error instanceof Error ? error.message : error)
  process.exit(1)
})
