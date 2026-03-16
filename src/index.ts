#!/usr/bin/env bun
import pc from "picocolors"
import { initVersion, parseArgs, showBanner } from "./cli/index.js"
import { run } from "./orchestrator.js"

async function main(): Promise<void> {
  await initVersion()
  const args = parseArgs()
  if (!args) return
  showBanner()
  await run(args)
}

main().catch((error) => {
  console.error(pc.red("Fatal error:"), error instanceof Error ? error.message : error)
  process.exit(1)
})
