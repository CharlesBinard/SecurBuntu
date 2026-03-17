import { existsSync } from "fs"
import { isVersionAtLeast, parseOsRelease } from "../platform/detect.ts"
import { resolveHome } from "../platform/home.ts"
import type { ServerInfo, SystemClient } from "../types.ts"

export interface LocalSshKey {
  path: string
  type: string
}

export function detectAllLocalKeys(): LocalSshKey[] {
  const home = resolveHome()
  const sshDir = `${home}/.ssh`
  const patterns: Array<{ filename: string; type: string }> = [
    { filename: "id_ed25519", type: "ed25519" },
    { filename: "id_ecdsa", type: "ecdsa" },
    { filename: "id_rsa", type: "rsa" },
  ]

  const keys: LocalSshKey[] = []
  for (const { filename, type } of patterns) {
    const fullPath = `${sshDir}/${filename}`
    if (existsSync(fullPath)) {
      keys.push({ path: fullPath, type })
    }
  }
  return keys
}

export function detectDefaultKeyPath(): string | undefined {
  const home = resolveHome()
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
  const home = resolveHome()
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

export async function detectServerInfo(client: SystemClient): Promise<ServerInfo> {
  const osResult = await client.exec('. /etc/os-release && echo "$ID|$VERSION_ID|$VERSION_CODENAME"')
  if (osResult.exitCode !== 0) {
    throw new Error(`Failed to detect OS: ${osResult.stderr}`)
  }

  const { distro, version: versionId, codename } = parseOsRelease(osResult.stdout)
  if (distro !== "ubuntu") {
    throw new Error(`Unsupported OS: ${distro || "unknown"}. SecurBuntu only supports Ubuntu.`)
  }

  if (!isVersionAtLeast(versionId, 22, 4)) {
    throw new Error(`Ubuntu ${versionId} is not supported. Minimum required: 22.04`)
  }

  const socketResult = await client.exec("systemctl is-active ssh.socket 2>/dev/null || true")
  const cloudInitResult = await client.exec("test -f /etc/ssh/sshd_config.d/50-cloud-init.conf && echo yes || echo no")

  return {
    ubuntuVersion: versionId,
    ubuntuCodename: codename,
    usesSocketActivation: socketResult.stdout === "active",
    hasCloudInit: cloudInitResult.stdout === "yes",
    isRoot: client.isRoot,
  }
}
