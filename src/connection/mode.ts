import * as p from "@clack/prompts"
import pc from "picocolors"
import { LocalClient } from "../local/index.ts"
import { spawnProcess } from "../ssh/process.ts"
import type { ConnectionResult } from "../types.ts"
import { connectWithRetry } from "./retry-loop.ts"

export async function validateLocalUbuntu(): Promise<{ version?: string; codename?: string; error?: string }> {
  const result = await spawnProcess(["bash", "-c", '. /etc/os-release && echo "$ID|$VERSION_ID|$VERSION_CODENAME"'])
  if (result.exitCode !== 0) {
    return { error: "Failed to detect OS" }
  }

  const parts = result.stdout.split("|")
  if (parts.length < 3 || parts[0] !== "ubuntu") {
    return { error: `Unsupported OS: ${parts[0] ?? "unknown"}. SecurBuntu only supports Ubuntu.` }
  }

  const versionId = parts[1] ?? ""
  const versionParts = versionId.split(".")
  const major = parseInt(versionParts[0] ?? "0", 10)
  const minor = parseInt(versionParts[1] ?? "0", 10)
  if (major < 22 || (major === 22 && minor < 4)) {
    return { error: `Ubuntu ${versionId} is not supported. Minimum required: 22.04` }
  }

  return { version: versionId, codename: parts[2] ?? "" }
}

async function setupLocalClient(): Promise<ConnectionResult> {
  const validation = await validateLocalUbuntu()
  if (validation.error) {
    throw new Error(validation.error)
  }

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

export async function selectMode(): Promise<ConnectionResult> {
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
    return setupLocalClient()
  }

  const { client, connectionConfig } = await connectWithRetry()
  return {
    client,
    mode: "ssh",
    host: connectionConfig.host,
    username: connectionConfig.username,
  }
}
