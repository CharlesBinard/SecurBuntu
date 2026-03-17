import * as p from "@clack/prompts"
import pc from "picocolors"
import { spawnProcess } from "../ssh/process.ts"
import type { HostCapabilities, HostPlatform } from "../types.ts"

export async function commandExists(cmd: string, platform: HostPlatform): Promise<boolean> {
  const lookup = platform.os === "windows" ? ["where.exe", cmd] : ["which", cmd]
  try {
    const proc = Bun.spawn(lookup, { stdout: "pipe", stderr: "pipe" })
    await proc.exited
    return proc.exitCode === 0
  } catch {
    return false
  }
}

export async function detectCapabilities(platform: HostPlatform): Promise<HostCapabilities> {
  const [ssh, sshCopyId, sshpass, sshKeygen, sshKeyscan] = await Promise.all([
    commandExists("ssh", platform),
    commandExists("ssh-copy-id", platform),
    commandExists("sshpass", platform),
    commandExists("ssh-keygen", platform),
    commandExists("ssh-keyscan", platform),
  ])
  return { ssh, sshCopyId, sshpass, sshKeygen, sshKeyscan }
}

type InstallableCommand = "ssh" | "ssh-copy-id" | "sshpass" | "ssh-keygen" | "ssh-keyscan"

export function getInstallCommand(cmd: InstallableCommand, platform: HostPlatform): string | null {
  const matrix: Record<InstallableCommand, Record<"linux" | "macos" | "windows", string | null>> = {
    ssh: {
      linux: "sudo apt install openssh-client",
      macos: null,
      windows: null,
    },
    "ssh-copy-id": {
      linux: "sudo apt install openssh-client",
      macos: "brew install ssh-copy-id",
      windows: null,
    },
    sshpass: {
      linux: "sudo apt install sshpass",
      macos: null,
      windows: null,
    },
    "ssh-keygen": {
      linux: "sudo apt install openssh-client",
      macos: null,
      windows: null,
    },
    "ssh-keyscan": {
      linux: "sudo apt install openssh-client",
      macos: null,
      windows: null,
    },
  }
  return matrix[cmd]?.[platform.os] ?? null
}

export function getManualInstallHint(cmd: InstallableCommand, platform: HostPlatform): string | null {
  if (cmd === "ssh" && platform.os === "windows") {
    return "Install OpenSSH Client: Settings > Apps > Optional Features > OpenSSH Client"
  }
  if (cmd === "sshpass" && platform.os === "macos") {
    return "sshpass is not in the default Homebrew repository. Install manually: brew install esolitos/ipa/sshpass"
  }
  return null
}

async function installSshClient(platform: HostPlatform, capabilities: HostCapabilities): Promise<void> {
  const installCmd = getInstallCommand("ssh", platform)
  const hint = getManualInstallHint("ssh", platform)

  if (!installCmd) {
    p.log.error(
      `${pc.red("SSH client is required but is not installed.")}\n` +
        (hint ? `  ${pc.dim(hint)}` : `  ${pc.dim("Please install an SSH client manually.")}`),
    )
    process.exit(1)
  }

  const install = await p.confirm({
    message: `ssh is not installed. Install it now? (${installCmd})`,
  })
  if (p.isCancel(install) || !install) {
    p.log.error(pc.red("SSH client is required for remote mode. Exiting."))
    process.exit(1)
  }

  const result = await spawnProcess(installCmd.split(" "))
  if (result.exitCode !== 0) {
    p.log.error(pc.red(`Installation failed: ${result.stderr}`))
    process.exit(1)
  }
  capabilities.ssh = true
}

export async function ensureCapabilities(platform: HostPlatform, capabilities: HostCapabilities): Promise<void> {
  if (!capabilities.ssh) {
    await installSshClient(platform, capabilities)
  }

  if (!capabilities.sshpass) {
    p.log.info(pc.dim("sshpass not found — password authentication will not be available."))
  }

  if (!capabilities.sshCopyId) {
    p.log.info(pc.dim("ssh-copy-id not found — will use built-in fallback if needed."))
  }

  if (!capabilities.sshKeyscan) {
    p.log.warning(pc.yellow("ssh-keyscan not found — host key verification will be unavailable."))
  }

  if (!capabilities.sshKeygen) {
    p.log.warning(pc.yellow("ssh-keygen not found — key generation and fingerprint display unavailable."))
  }
}
