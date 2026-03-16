import type { spinner } from "@clack/prompts"
import { isCancel, log, password as passwordPrompt } from "@clack/prompts"
import { existsSync } from "fs"
import pc from "picocolors"
import { promptCopyKeyOnFailure } from "../prompts/index.js"
import { checkSshCopyIdInstalled, connect, copyKeyToServer } from "../ssh/index.js"
import type { ConnectionConfig, SshClient } from "../types.js"

export async function handleCopyAuthMethod(config: ConnectionConfig): Promise<"continue" | "retry"> {
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

export async function handleSudoPasswordPrompt(
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

export async function handlePermissionDenied(config: ConnectionConfig): Promise<void> {
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

export async function handleConnectionError(
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
