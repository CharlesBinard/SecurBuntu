import { readFileSync } from "fs"
import type { HardeningTask, SshClient } from "../types.js"

export const runInjectSshKeys: HardeningTask = async (ssh, options) => {
  if (!(options.addPersonalKey && options.personalKeyPath)) {
    return {
      name: "SSH Keys",
      success: true,
      message: "Skipped (no key to add)",
    }
  }

  const pubKeyContent = readFileSync(options.personalKeyPath, "utf-8").trim()
  const details: string[] = []

  const targetUser =
    options.createSudoUser && options.sudoUsername ? options.sudoUsername : (await ssh.exec("whoami")).stdout

  const targetHome = targetUser === "root" ? "/root" : `/home/${targetUser}`

  const injected = await injectKey(ssh, pubKeyContent, targetHome, targetUser)
  if (injected.success) {
    details.push(injected.message)
  } else {
    return {
      name: "SSH Keys",
      success: false,
      message: injected.message,
      details: injected.details,
    }
  }

  if (options.configureCoolify && targetUser !== "root") {
    const rootInjected = await injectKey(ssh, pubKeyContent, "/root", "root")
    if (rootInjected.success) {
      details.push(rootInjected.message)
    } else {
      details.push(`Warning: ${rootInjected.message}`)
    }
  }

  return {
    name: "SSH Keys",
    success: true,
    message: "SSH public key(s) injected",
    details: details.join("\n"),
  }
}

async function injectKey(
  ssh: SshClient,
  pubKey: string,
  homeDir: string,
  user: string,
): Promise<{ success: boolean; message: string; details?: string }> {
  const mkdirResult = await ssh.exec(`mkdir -p ${homeDir}/.ssh && chmod 700 ${homeDir}/.ssh`)
  if (mkdirResult.exitCode !== 0) {
    return { success: false, message: `Failed to create .ssh for ${user}`, details: mkdirResult.stderr }
  }

  const authKeysPath = `${homeDir}/.ssh/authorized_keys`

  const grepResult = await ssh.execWithStdin(
    `grep -qxF -f /dev/stdin '${authKeysPath}' 2>/dev/null && echo found || echo missing`,
    pubKey,
  )
  if (grepResult.stdout.includes("found")) {
    return { success: true, message: `Key already present for ${user}` }
  }

  const appendResult = await ssh.execWithStdin(`tee -a '${authKeysPath}' > /dev/null`, `${pubKey}\n`)
  if (appendResult.exitCode !== 0) {
    return { success: false, message: `Failed to inject key for ${user}`, details: appendResult.stderr }
  }

  const chmodResult = await ssh.exec(`chmod 600 '${authKeysPath}' && chown ${user}:${user} '${authKeysPath}'`)
  if (chmodResult.exitCode !== 0) {
    return { success: false, message: `Failed to set permissions for ${user}`, details: chmodResult.stderr }
  }

  return { success: true, message: `Key added to ${authKeysPath}` }
}
