import { existsSync } from "fs"
import type { ServerInfo, SshClient } from "../types.js"

export function detectDefaultKeyPath(): string | undefined {
  const home = process.env.HOME ?? ""
  const candidates = [`${home}/.ssh/id_ed25519`, `${home}/.ssh/id_ecdsa`, `${home}/.ssh/id_rsa`]
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return candidate
    } catch {
      /* ignored */
    }
  }
  return undefined
}

export function detectDefaultPubKeyPath(): string | undefined {
  const home = process.env.HOME ?? ""
  const candidates = [`${home}/.ssh/id_ed25519.pub`, `${home}/.ssh/id_ecdsa.pub`, `${home}/.ssh/id_rsa.pub`]
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return candidate
    } catch {
      /* ignored */
    }
  }
  return undefined
}

export async function detectServerInfo(ssh: SshClient): Promise<ServerInfo> {
  const osResult = await ssh.exec('. /etc/os-release && echo "$ID|$VERSION_ID|$VERSION_CODENAME"')
  if (osResult.exitCode !== 0) {
    throw new Error(`Failed to detect OS: ${osResult.stderr}`)
  }

  const parts = osResult.stdout.split("|")
  if (parts.length < 3 || parts[0] !== "ubuntu") {
    throw new Error(`Unsupported OS: ${parts[0] ?? "unknown"}. SecurBuntu only supports Ubuntu.`)
  }

  const versionId = parts[1] ?? ""
  const versionParts = versionId.split(".")
  const major = parseInt(versionParts[0] ?? "0", 10)
  const minor = parseInt(versionParts[1] ?? "0", 10)
  if (major < 22 || (major === 22 && minor < 4)) {
    throw new Error(`Ubuntu ${versionId} is not supported. Minimum required: 22.04`)
  }

  const socketResult = await ssh.exec("systemctl is-active ssh.socket 2>/dev/null || true")
  const cloudInitResult = await ssh.exec("test -f /etc/ssh/sshd_config.d/50-cloud-init.conf && echo yes || echo no")

  return {
    ubuntuVersion: versionId,
    ubuntuCodename: parts[2] ?? "",
    usesSocketActivation: socketResult.stdout === "active",
    hasCloudInit: cloudInitResult.stdout === "yes",
    isRoot: ssh.isRoot,
  }
}
