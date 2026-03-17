import * as p from "@clack/prompts"
import pc from "picocolors"
import { LocalClient } from "../local/index.ts"
import { detectCapabilities, ensureCapabilities } from "../platform/capabilities.ts"
import { spawnProcess } from "../ssh/process.ts"
import type { ConnectionResult, HostPlatform } from "../types.ts"
import { connectWithRetry } from "./retry-loop.ts"

async function setupLocalClient(): Promise<ConnectionResult> {
  const isRoot = process.getuid?.() === 0
  const username = process.env.USER ?? "unknown"
  let sudoPassword: string | undefined

  if (!isRoot) {
    const sudoCheck = await spawnProcess(["bash", "-c", "sudo -n true 2>&1"])
    if (sudoCheck.exitCode !== 0) {
      const pw = await p.password({
        message: "Enter your sudo password",
        validate(value) {
          if (!value) return "Password is required"
          return undefined
        },
      })

      if (p.isCancel(pw)) {
        throw new Error("Cancelled")
      }

      const validateResult = await spawnProcess(["bash", "-c", "sudo -S -p '' true 2>&1"], `${pw}\n`)
      if (validateResult.exitCode !== 0) {
        throw new Error("Invalid sudo password or user is not in sudoers.")
      }

      sudoPassword = pw
    }
  }

  return {
    client: sudoPassword ? new LocalClient(sudoPassword) : new LocalClient(undefined, !isRoot),
    mode: "local",
    host: "localhost",
    username,
  }
}

function formatOsLabel(platform: HostPlatform): string {
  if (platform.distro && platform.version) {
    return `${platform.distro} ${platform.version}`
  }
  return platform.os
}

export async function selectMode(platform: HostPlatform): Promise<ConnectionResult> {
  while (true) {
    const mode = await p.select({
      message: "What would you like to secure?",
      options: [
        { value: "local" as const, label: "This machine", hint: "run directly, no SSH" },
        { value: "ssh" as const, label: "A remote server", hint: "connect via SSH" },
      ],
    })

    if (p.isCancel(mode)) {
      p.outro(pc.dim("Cancelled."))
      process.exit(0)
    }

    if (mode === "local") {
      if (!platform.isCompatibleTarget) {
        p.log.error(
          `Local mode requires Ubuntu 22.04+. Your system: ${formatOsLabel(platform)}. Use SSH mode to secure a remote server.`,
        )
        continue
      }
      return setupLocalClient()
    }

    const capabilities = await detectCapabilities(platform)
    await ensureCapabilities(platform, capabilities)
    const { client, connectionConfig } = await connectWithRetry(platform, capabilities)
    return {
      client,
      mode: "ssh",
      host: connectionConfig.host,
      username: connectionConfig.username,
    }
  }
}
