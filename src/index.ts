#!/usr/bin/env bun
import pc from "picocolors"
import { initVersion, parseArgs, showBanner } from "./cli/index.ts"
import { selectMode } from "./connection/index.ts"
import { run } from "./orchestrator.ts"
import { detectHostPlatform } from "./platform/index.ts"

async function main(): Promise<void> {
  await initVersion()
  const args = parseArgs()
  if (!args) return
  showBanner()
  const platform = await detectHostPlatform()
  const connection = await selectMode(platform)
  await run(args, connection)
}

main().catch((error) => {
  console.error(pc.red("Fatal error:"), error instanceof Error ? error.message : error)
  process.exit(1)
})
