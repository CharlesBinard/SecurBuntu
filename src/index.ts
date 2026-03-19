#!/usr/bin/env bun
import * as p from "@clack/prompts"
import pc from "picocolors"
import { computeScore, displayHealthCheck, getExitCode, runHealthCheck } from "./audit/index.ts"
import { initVersion, parseArgs, showBanner } from "./cli/index.ts"
import { selectMode } from "./connection/index.ts"
import { run } from "./orchestrator.ts"
import { detectHostPlatform } from "./platform/index.ts"
import { BUILT_IN_PRESETS, listCustomPresets, loadPreset, presetToHardeningOptions } from "./presets/index.ts"
import { detectServerInfo } from "./ssh/index.ts"
import type { HardeningOptions, Preset } from "./types.ts"

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

async function promptPresetOrCustom(): Promise<Preset | null> {
  const configMode = await p.select({
    message: "How would you like to configure hardening?",
    options: [
      { value: "preset" as const, label: "Use a preset", hint: "pre-configured profile" },
      { value: "custom" as const, label: "Custom", hint: "interactive questionnaire" },
    ],
  })

  if (p.isCancel(configMode)) {
    p.outro(pc.dim("Cancelled."))
    process.exit(0)
  }

  if (configMode === "custom") return null

  // Build preset list: built-in first, then custom
  const builtInOptions = Object.values(BUILT_IN_PRESETS).map((preset) => ({
    value: preset.name,
    label: preset.name,
    hint: preset.description,
  }))

  const customPresets = await listCustomPresets()
  const customOptions = customPresets.map((preset) => ({
    value: preset.name,
    label: `${preset.name} ${pc.dim("(custom)")}`,
    hint: preset.description,
  }))

  const selected = await p.select({
    message: "Choose a preset:",
    options: [...builtInOptions, ...customOptions],
  })

  if (p.isCancel(selected)) {
    p.outro(pc.dim("Cancelled."))
    process.exit(0)
  }

  return loadPreset(selected)
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

  // Determine app mode and load preset if specified via flag
  let appMode: "harden" | "audit"
  let flagPreset: Preset | undefined

  if (args.presetName) {
    appMode = "harden"
    flagPreset = await loadPreset(args.presetName)
    p.log.info(`Using preset: ${pc.cyan(flagPreset.name)} — ${flagPreset.description}`)
  } else if (args.isAuditOnly) {
    appMode = "audit"
  } else {
    appMode = await promptAppMode()
  }

  const platform = await detectHostPlatform()
  const connection = await selectMode(platform, appMode)

  if (appMode === "audit") {
    await runAuditMode(connection)
    return
  }

  // Harden mode: resolve preset (from flag or interactive selection)
  let presetOptions: HardeningOptions | undefined

  if (flagPreset) {
    // Preset already loaded from --preset flag
    presetOptions = presetToHardeningOptions(flagPreset)
  } else {
    // Interactive: ask preset or custom
    const selectedPreset = await promptPresetOrCustom()
    if (selectedPreset) {
      presetOptions = presetToHardeningOptions(selectedPreset)
    }
    // If null, proceed with custom flow (presetOptions stays undefined)
  }

  await run(args, connection, presetOptions)
}

main().catch((error) => {
  console.error(pc.red("Fatal error:"), error instanceof Error ? error.message : error)
  process.exit(1)
})
