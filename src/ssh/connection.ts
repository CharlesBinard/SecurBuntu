import { createHash } from "crypto"
import type { CommandResult, ConnectionConfig, ExecOptions, HostPlatform, SystemClient } from "../types.ts"
import { spawnSsh, spawnSshpass } from "./process.ts"

export function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`
}

export function hashControlPath(user: string, host: string, port: number): string {
  const hash = createHash("sha256").update(`${user}@${host}:${port}`).digest("hex").slice(0, 12)
  return `/tmp/securbuntu-${hash}`
}

export function buildSshArgs(config: ConnectionConfig, platform: HostPlatform): string[] {
  const args: string[] = []

  if (platform.os !== "windows" && config.controlPath) {
    args.push("-o", `ControlPath=${config.controlPath}`)
  }

  args.push("-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=10", "-p", String(config.port))

  if (config.authMethod === "key" && config.privateKeyPath) {
    args.push("-i", config.privateKeyPath, "-o", "PreferredAuthentications=publickey")
  }

  return args
}

function makeSudoHelpers(
  rootUser: boolean,
  sudoPassword: string | undefined,
): {
  prefixSudo: (command: string) => string
  sudoStdin: (data?: string) => string | undefined
} {
  function prefixSudo(command: string): string {
    if (rootUser) return command
    if (sudoPassword) return `sudo -S -p '' bash -c ${shellEscape(command)}`
    return `sudo -n ${command}`
  }

  function sudoStdin(data?: string): string | undefined {
    if (!sudoPassword || rootUser) return data
    return data !== undefined ? `${sudoPassword}\n${data}` : `${sudoPassword}\n`
  }

  return { prefixSudo, sudoStdin }
}

function buildSystemClient(
  execArgs: () => string[],
  prefixSudo: (command: string) => string,
  sudoStdin: (data?: string) => string | undefined,
  rootUser: boolean,
  onClose: () => void,
  handleSignal: () => void,
): SystemClient {
  return {
    isRoot: rootUser,

    async exec(command: string, options?: ExecOptions): Promise<CommandResult> {
      return spawnSsh([...execArgs(), prefixSudo(command)], sudoStdin(), options?.timeout)
    },

    async execWithStdin(command: string, stdin: string, options?: ExecOptions): Promise<CommandResult> {
      return spawnSsh([...execArgs(), prefixSudo(command)], sudoStdin(stdin), options?.timeout)
    },

    async writeFile(remotePath: string, content: string): Promise<void> {
      const writeResult = await spawnSsh(
        [...execArgs(), prefixSudo(`tee ${shellEscape(remotePath)} > /dev/null`)],
        sudoStdin(content),
      )
      if (writeResult.exitCode !== 0) {
        throw new Error(`Failed to write ${remotePath}: ${writeResult.stderr}`)
      }
    },

    async readFile(remotePath: string): Promise<string> {
      const readResult = await spawnSsh([...execArgs(), prefixSudo(`cat ${shellEscape(remotePath)}`)], sudoStdin())
      if (readResult.exitCode !== 0) {
        throw new Error(`Failed to read ${remotePath}: ${readResult.stderr}`)
      }
      return readResult.stdout
    },

    async fileExists(remotePath: string): Promise<boolean> {
      const existsResult = await spawnSsh(
        [...execArgs(), prefixSudo(`test -f ${shellEscape(remotePath)} && echo yes`)],
        sudoStdin(),
      )
      return existsResult.stdout === "yes"
    },

    close(): void {
      process.removeListener("SIGINT", handleSignal)
      process.removeListener("SIGTERM", handleSignal)
      onClose()
    },
  }
}

async function resolveSudoPassword(
  execArgs: () => string[],
  config: ConnectionConfig,
  cleanup: () => void,
): Promise<string | undefined> {
  const sudoCheck = await spawnSsh([...execArgs(), "sudo -n true 2>&1"])
  if (sudoCheck.exitCode === 0) return undefined

  if (!config.sudoPassword) {
    cleanup()
    throw new Error("SUDO_PASSWORD_REQUIRED")
  }

  const sudoCheckWithPw = await spawnSsh([...execArgs(), "sudo -S -p '' true 2>&1"], `${config.sudoPassword}\n`)
  if (sudoCheckWithPw.exitCode !== 0) {
    cleanup()
    throw new Error("Invalid sudo password or user is not in sudoers.")
  }

  return config.sudoPassword
}

async function connectWindows(config: ConnectionConfig, platform: HostPlatform): Promise<SystemClient> {
  const checkArgs = [...buildSshArgs(config, platform), `${config.username}@${config.host}`, "true"]

  let checkResult: CommandResult
  if (config.authMethod === "password" && config.password) {
    checkResult = await spawnSshpass(config.password, checkArgs)
  } else {
    checkResult = await spawnSsh(checkArgs)
  }

  if (checkResult.exitCode !== 0) {
    throw new Error(`SSH connection failed: ${checkResult.stderr}`)
  }

  const cleanup = () => {
    // no-op on Windows (no ControlMaster socket to clean up)
  }
  const handleSignal = () => {
    cleanup()
    process.exit(1)
  }
  process.on("SIGINT", handleSignal)
  process.on("SIGTERM", handleSignal)

  const execArgs = () => [...buildSshArgs(config, platform), `${config.username}@${config.host}`]

  const whoamiResult = await spawnSsh([...execArgs(), "whoami"])
  const rootUser = whoamiResult.stdout === "root"

  let sudoPassword: string | undefined
  if (!rootUser) {
    sudoPassword = await resolveSudoPassword(execArgs, config, cleanup)
  }

  const { prefixSudo, sudoStdin } = makeSudoHelpers(rootUser, sudoPassword)
  return buildSystemClient(execArgs, prefixSudo, sudoStdin, rootUser, cleanup, handleSignal)
}

async function connectUnix(config: ConnectionConfig, platform: HostPlatform): Promise<SystemClient> {
  const controlPath = hashControlPath(config.username, config.host, config.port)
  const fullConfig: ConnectionConfig = { ...config, controlPath }

  const masterArgs = [
    ...buildSshArgs(fullConfig, platform),
    "-o",
    "ControlMaster=yes",
    "-o",
    "ControlPersist=600",
    "-N",
    "-f",
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
      Bun.spawnSync(
        ["ssh", "-o", `ControlPath=${controlPath}`, "-O", "exit", `${fullConfig.username}@${fullConfig.host}`],
        { stdout: "ignore", stderr: "ignore" },
      )
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

  const execArgs = () => [
    "-o",
    `ControlPath=${controlPath}`,
    "-o",
    "ControlMaster=no",
    `${fullConfig.username}@${fullConfig.host}`,
  ]

  const whoamiResult = await spawnSsh([...execArgs(), "whoami"])
  const rootUser = whoamiResult.stdout === "root"

  let sudoPassword: string | undefined
  if (!rootUser) {
    sudoPassword = await resolveSudoPassword(execArgs, config, cleanup)
  }

  const { prefixSudo, sudoStdin } = makeSudoHelpers(rootUser, sudoPassword)
  return buildSystemClient(execArgs, prefixSudo, sudoStdin, rootUser, cleanup, handleSignal)
}

export async function connect(config: ConnectionConfig, platform: HostPlatform): Promise<SystemClient> {
  if (platform.os === "windows") {
    return connectWindows(config, platform)
  }
  return connectUnix(config, platform)
}
