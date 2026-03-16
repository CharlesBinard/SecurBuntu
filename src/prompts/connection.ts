import * as p from "@clack/prompts"
import { existsSync } from "fs"
import pc from "picocolors"
import { checkSshCopyIdInstalled, checkSshpassInstalled, detectDefaultKeyPath } from "../ssh/index.ts"
import type { ConnectionConfig } from "../types.ts"
import { handleCancel, isCancel, unwrapText } from "./helpers.ts"

async function promptAuthCredentials(
  authMethod: "key" | "password" | "copy",
): Promise<{ privateKeyPath?: string; password?: string }> {
  if (authMethod === "key" || authMethod === "copy") {
    const defaultKey = detectDefaultKeyPath()
    const keyPath = unwrapText(
      await p.text({
        message: "Path to your private SSH key",
        placeholder: defaultKey ?? "~/.ssh/id_ed25519",
        defaultValue: defaultKey,
        validate(value) {
          if (!value?.trim()) return "Key path is required"
          const resolved = value.replace("~", process.env.HOME ?? "")
          if (!existsSync(resolved)) return `File not found: ${resolved}`
        },
      }),
    )
    const privateKeyPath = keyPath.replace("~", process.env.HOME ?? "")

    if (authMethod === "copy") {
      await validateCopyKeyPrerequisites(privateKeyPath)
    }

    return { privateKeyPath }
  }

  const hasSshpass = await checkSshpassInstalled()
  if (!hasSshpass) {
    p.log.error(
      `${pc.red("sshpass is required for password authentication but is not installed.")}\n` +
        `  ${pc.dim("Install it with:")}\n` +
        `  ${pc.cyan("  Ubuntu/Debian: sudo apt install sshpass")}\n` +
        `  ${pc.cyan("  macOS:         brew install sshpass")}`,
    )
    process.exit(1)
  }

  const password = unwrapText(
    await p.password({
      message: "Enter the SSH password",
      validate(value) {
        if (!value) return "Password is required"
      },
    }),
  )

  return { password }
}

async function validateCopyKeyPrerequisites(privateKeyPath: string): Promise<void> {
  const pubKeyPath = `${privateKeyPath}.pub`
  if (!existsSync(pubKeyPath)) {
    p.log.error(
      `${pc.red(`Public key not found at ${pubKeyPath}`)}\n` +
        `  ${pc.dim("Make sure the .pub file exists alongside your private key.")}`,
    )
    throw new Error(`Public key not found at ${pubKeyPath}`)
  }

  const hasSshCopyId = await checkSshCopyIdInstalled()
  if (!hasSshCopyId) {
    p.log.error(
      `${pc.red("ssh-copy-id is required but is not installed.")}\n` +
        `  ${pc.dim("Install it with:")}\n` +
        `  ${pc.cyan("  Ubuntu/Debian: sudo apt install openssh-client")}\n` +
        `  ${pc.cyan("  macOS:         brew install ssh-copy-id")}`,
    )
    throw new Error("ssh-copy-id is not installed")
  }
}

export async function promptConnection(): Promise<ConnectionConfig> {
  const host = unwrapText(
    await p.text({
      message: "Enter the server IP address or hostname",
      placeholder: "192.168.1.100",
      validate(value) {
        if (!value?.trim()) return "IP address is required"
      },
    }),
  )

  const username = unwrapText(
    await p.text({
      message: "Enter the SSH username",
      placeholder: "root",
      defaultValue: "root",
      validate(value) {
        if (!value?.trim()) return "Username is required"
        if (!/^[a-z_][a-z0-9_-]*$/.test(value))
          return "Invalid username format (lowercase letters, digits, hyphens, underscores)"
      },
    }),
  )

  const portStr = unwrapText(
    await p.text({
      message: "SSH port",
      placeholder: "22",
      defaultValue: "22",
      validate(value) {
        if (!value) return "Port is required"
        const port = parseInt(value, 10)
        if (Number.isNaN(port) || port < 1 || port > 65_535) return "Port must be between 1 and 65535"
      },
    }),
  )
  const port = parseInt(portStr, 10)

  const authMethod = await p.select({
    message: "How do you want to authenticate?",
    options: [
      { value: "key" as const, label: "SSH Key", hint: "recommended" },
      { value: "password" as const, label: "Password" },
      { value: "copy" as const, label: "Copy my SSH key to server", hint: "needs password" },
    ],
  })
  if (isCancel(authMethod)) handleCancel()

  const { privateKeyPath, password } = await promptAuthCredentials(authMethod)

  return {
    host: host.trim(),
    port,
    username: username.trim(),
    authMethod,
    privateKeyPath,
    password,
    controlPath: "",
  }
}
