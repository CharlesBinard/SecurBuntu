import { createHash } from "crypto"
import { existsSync, appendFileSync, mkdirSync } from "fs"
import type { ConnectionConfig, CommandResult, ExecOptions, ServerInfo, SshClient } from "./types.js"

function hashControlPath(user: string, host: string, port: number): string {
  const hash = createHash("sha256")
    .update(`${user}@${host}:${port}`)
    .digest("hex")
    .slice(0, 12)
  return `/tmp/securbuntu-${hash}`
}

function buildSshArgs(config: ConnectionConfig): string[] {
  const args: string[] = [
    "-o", "ControlPath=" + config.controlPath,
    "-o", "StrictHostKeyChecking=yes",
    "-o", "ConnectTimeout=10",
    "-p", String(config.port),
  ]

  if (config.authMethod === "key" && config.privateKeyPath) {
    args.push("-i", config.privateKeyPath)
  }

  return args
}

const DEFAULT_TIMEOUT = 300_000 // 5 minutes

async function spawnSsh(
  args: string[],
  stdinData?: string,
  timeout: number = DEFAULT_TIMEOUT,
): Promise<CommandResult> {
  const proc = Bun.spawn(["ssh", ...args], {
    stdin: stdinData !== undefined ? Buffer.from(stdinData) : "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })

  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    proc.kill()
  }, timeout)

  try {
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])

    const exitCode = await proc.exited

    if (timedOut) {
      return {
        stdout: "",
        stderr: `Command timed out after ${Math.round(timeout / 1000)}s`,
        exitCode: -1,
      }
    }

    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode }
  } finally {
    clearTimeout(timer)
  }
}

async function spawnSshpass(
  password: string,
  args: string[],
  timeout: number = DEFAULT_TIMEOUT,
): Promise<CommandResult> {
  const proc = Bun.spawn(["sshpass", "-e", "ssh", ...args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, SSHPASS: password },
  })

  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    proc.kill()
  }, timeout)

  try {
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])

    const exitCode = await proc.exited

    if (timedOut) {
      return {
        stdout: "",
        stderr: `Command timed out after ${Math.round(timeout / 1000)}s`,
        exitCode: -1,
      }
    }

    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode }
  } finally {
    clearTimeout(timer)
  }
}

export async function checkSshpassInstalled(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["which", "sshpass"], {
      stdout: "pipe",
      stderr: "pipe",
    })
    await proc.exited
    return proc.exitCode === 0
  } catch {
    return false
  }
}

export async function checkSshCopyIdInstalled(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["which", "ssh-copy-id"], {
      stdout: "pipe",
      stderr: "pipe",
    })
    await proc.exited
    return proc.exitCode === 0
  } catch {
    return false
  }
}

export async function copyKeyToServer(
  host: string,
  user: string,
  pubKeyPath: string,
  port: number = 22,
): Promise<boolean> {
  const hasCmd = await checkSshCopyIdInstalled()
  if (!hasCmd) {
    return false
  }

  const args = [
    "ssh-copy-id",
    "-i", pubKeyPath,
    "-p", String(port),
    "-o", "StrictHostKeyChecking=yes",
    `${user}@${host}`,
  ]

  const proc = Bun.spawn(args, {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })

  const exitCode = await proc.exited
  return exitCode === 0
}

export type HostKeyResult =
  | { known: true }
  | { known: false; fingerprint: string; rawKeys: string }
  | { known: false; fingerprint: null; rawKeys: "" }

export async function fetchHostKeyFingerprint(host: string, port: number): Promise<HostKeyResult> {
  const home = process.env.HOME ?? ""
  const knownHostsPath = `${home}/.ssh/known_hosts`

  // Check if host is already in known_hosts
  if (existsSync(knownHostsPath)) {
    const hostLookup = port === 22 ? host : `[${host}]:${port}`
    const checkProc = Bun.spawn(["ssh-keygen", "-F", hostLookup, "-f", knownHostsPath], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const checkOutput = await new Response(checkProc.stdout).text()
    await checkProc.exited
    if (checkOutput.trim().length > 0) {
      return { known: true }
    }
  }

  // Fetch the server's host key via ssh-keyscan
  const keyscanProc = Bun.spawn(["ssh-keyscan", "-p", String(port), host], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const keyscanOutput = await new Response(keyscanProc.stdout).text()
  await keyscanProc.exited

  if (!keyscanOutput.trim()) {
    return { known: false, fingerprint: null, rawKeys: "" }
  }

  // Compute the SHA256 fingerprint
  const fingerprintProc = Bun.spawn(["ssh-keygen", "-lf", "/dev/stdin"], {
    stdin: Buffer.from(keyscanOutput),
    stdout: "pipe",
    stderr: "pipe",
  })
  const fingerprintOutput = await new Response(fingerprintProc.stdout).text()
  await fingerprintProc.exited

  const firstLine = fingerprintOutput.trim().split("\n")[0] ?? ""
  if (!firstLine) {
    return { known: false, fingerprint: null, rawKeys: "" }
  }

  return { known: false, fingerprint: firstLine, rawKeys: keyscanOutput.trim() }
}

export function addToKnownHosts(rawKeys: string): void {
  const home = process.env.HOME ?? ""
  const sshDir = `${home}/.ssh`
  const knownHostsPath = `${sshDir}/known_hosts`
  mkdirSync(sshDir, { recursive: true })
  appendFileSync(knownHostsPath, rawKeys + "\n", "utf-8")
}

export function detectDefaultKeyPath(): string | undefined {
  const home = process.env.HOME ?? ""
  const candidates = [
    `${home}/.ssh/id_ed25519`,
    `${home}/.ssh/id_ecdsa`,
    `${home}/.ssh/id_rsa`,
  ]
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return candidate
    } catch {
      continue
    }
  }
  return undefined
}

export function detectDefaultPubKeyPath(): string | undefined {
  const home = process.env.HOME ?? ""
  const candidates = [
    `${home}/.ssh/id_ed25519.pub`,
    `${home}/.ssh/id_ecdsa.pub`,
    `${home}/.ssh/id_rsa.pub`,
  ]
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return candidate
    } catch {
      continue
    }
  }
  return undefined
}

export async function connect(config: ConnectionConfig): Promise<SshClient> {
  const controlPath = hashControlPath(config.username, config.host, config.port)
  const fullConfig: ConnectionConfig = { ...config, controlPath }

  const masterArgs = [
    ...buildSshArgs(fullConfig),
    "-o", "ControlMaster=yes",
    "-o", "ControlPersist=600",
    "-N", "-f",
    `${fullConfig.username}@${fullConfig.host}`,
  ]

  let result: CommandResult
  if (fullConfig.authMethod === "password" && fullConfig.password) {
    result = await spawnSshpass(fullConfig.password, masterArgs)
  } else {
    result = await spawnSsh(masterArgs)
  }

  if (result.exitCode !== 0) {
    throw new Error(`SSH connection failed: ${result.stderr}`)
  }

  const cleanup = () => {
    try {
      Bun.spawnSync([
        "ssh",
        "-o", "ControlPath=" + controlPath,
        "-O", "exit",
        `${fullConfig.username}@${fullConfig.host}`,
      ], { stdout: "ignore", stderr: "ignore" })
    } catch {
      // Best-effort cleanup
    }
  }

  const handleSignal = () => {
    cleanup()
    process.exit(1)
  }
  process.on("SIGINT", handleSignal)
  process.on("SIGTERM", handleSignal)

  const execArgs = [
    "-o", "ControlPath=" + controlPath,
    "-o", "ControlMaster=no",
    `${fullConfig.username}@${fullConfig.host}`,
  ]

  const whoamiResult = await spawnSsh([...execArgs, "whoami"])
  const rootUser = whoamiResult.stdout === "root"

  // Validate sudo access for non-root users
  if (!rootUser) {
    const sudoCheck = await spawnSsh([...execArgs, "sudo -n true 2>&1"])
    if (sudoCheck.exitCode !== 0) {
      cleanup()
      throw new Error(
        "Non-root user does not have passwordless sudo access. " +
        "Please connect as root or configure NOPASSWD sudo for this user."
      )
    }
  }

  function prefixSudo(command: string): string {
    return rootUser ? command : `sudo -n ${command}`
  }

  const client: SshClient = {
    isRoot: rootUser,

    async exec(command: string, options?: ExecOptions): Promise<CommandResult> {
      return spawnSsh([...execArgs, prefixSudo(command)], undefined, options?.timeout)
    },

    async execWithStdin(command: string, stdin: string, options?: ExecOptions): Promise<CommandResult> {
      return spawnSsh([...execArgs, prefixSudo(command)], stdin, options?.timeout)
    },

    async writeFile(remotePath: string, content: string): Promise<void> {
      const result = await spawnSsh(
        [...execArgs, prefixSudo(`tee '${remotePath}' > /dev/null`)],
        content,
      )
      if (result.exitCode !== 0) {
        throw new Error(`Failed to write ${remotePath}: ${result.stderr}`)
      }
    },

    async readFile(remotePath: string): Promise<string> {
      const result = await spawnSsh([...execArgs, prefixSudo(`cat '${remotePath}'`)])
      if (result.exitCode !== 0) {
        throw new Error(`Failed to read ${remotePath}: ${result.stderr}`)
      }
      return result.stdout
    },

    async fileExists(remotePath: string): Promise<boolean> {
      const result = await spawnSsh([...execArgs, prefixSudo(`test -f '${remotePath}' && echo yes`)])
      return result.stdout === "yes"
    },

    close(): void {
      process.removeListener("SIGINT", handleSignal)
      process.removeListener("SIGTERM", handleSignal)
      cleanup()
    },
  }

  return client
}

export async function detectServerInfo(ssh: SshClient): Promise<ServerInfo> {
  const osResult = await ssh.exec(". /etc/os-release && echo \"$ID|$VERSION_ID|$VERSION_CODENAME\"")
  if (osResult.exitCode !== 0) {
    throw new Error("Failed to detect OS: " + osResult.stderr)
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

