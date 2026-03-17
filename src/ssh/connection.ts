import { createHash } from "crypto"
import type { CommandResult, ConnectionConfig, ExecOptions, SystemClient } from "../types.ts"
import { spawnSsh, spawnSshpass } from "./process.ts"

export function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`
}

export function hashControlPath(user: string, host: string, port: number): string {
  const hash = createHash("sha256").update(`${user}@${host}:${port}`).digest("hex").slice(0, 12)
  return `/tmp/securbuntu-${hash}`
}

export function buildSshArgs(config: ConnectionConfig): string[] {
  const args: string[] = [
    "-o",
    `ControlPath=${config.controlPath}`,
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    "ConnectTimeout=10",
    "-p",
    String(config.port),
  ]

  if (config.authMethod === "key" && config.privateKeyPath) {
    args.push("-i", config.privateKeyPath)
  }

  return args
}

export async function connect(config: ConnectionConfig): Promise<SystemClient> {
  const controlPath = hashControlPath(config.username, config.host, config.port)
  const fullConfig: ConnectionConfig = { ...config, controlPath }

  const masterArgs = [
    ...buildSshArgs(fullConfig),
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

  const execArgs = [
    "-o",
    `ControlPath=${controlPath}`,
    "-o",
    "ControlMaster=no",
    `${fullConfig.username}@${fullConfig.host}`,
  ]

  const whoamiResult = await spawnSsh([...execArgs, "whoami"])
  const rootUser = whoamiResult.stdout === "root"

  // Validate sudo access for non-root users
  let sudoPassword: string | undefined
  if (!rootUser) {
    const sudoCheck = await spawnSsh([...execArgs, "sudo -n true 2>&1"])
    if (sudoCheck.exitCode !== 0) {
      if (!config.sudoPassword) {
        cleanup()
        throw new Error("SUDO_PASSWORD_REQUIRED")
      }

      // Try with password
      const sudoCheckWithPw = await spawnSsh([...execArgs, "sudo -S -p '' true 2>&1"], `${config.sudoPassword}\n`)
      if (sudoCheckWithPw.exitCode !== 0) {
        cleanup()
        throw new Error("Invalid sudo password or user is not in sudoers.")
      }

      sudoPassword = config.sudoPassword
    }
  }

  function prefixSudo(command: string): string {
    if (rootUser) return command
    if (sudoPassword) return `sudo -S -p '' bash -c ${shellEscape(command)}`
    return `sudo -n ${command}`
  }

  function sudoStdin(data?: string): string | undefined {
    if (!sudoPassword || rootUser) return data
    return data !== undefined ? `${sudoPassword}\n${data}` : `${sudoPassword}\n`
  }

  const client: SystemClient = {
    isRoot: rootUser,

    async exec(command: string, options?: ExecOptions): Promise<CommandResult> {
      return spawnSsh([...execArgs, prefixSudo(command)], sudoStdin(), options?.timeout)
    },

    async execWithStdin(command: string, stdin: string, options?: ExecOptions): Promise<CommandResult> {
      return spawnSsh([...execArgs, prefixSudo(command)], sudoStdin(stdin), options?.timeout)
    },

    async writeFile(remotePath: string, content: string): Promise<void> {
      const writeResult = await spawnSsh(
        [...execArgs, prefixSudo(`tee ${shellEscape(remotePath)} > /dev/null`)],
        sudoStdin(content),
      )
      if (writeResult.exitCode !== 0) {
        throw new Error(`Failed to write ${remotePath}: ${writeResult.stderr}`)
      }
    },

    async readFile(remotePath: string): Promise<string> {
      const readResult = await spawnSsh([...execArgs, prefixSudo(`cat ${shellEscape(remotePath)}`)], sudoStdin())
      if (readResult.exitCode !== 0) {
        throw new Error(`Failed to read ${remotePath}: ${readResult.stderr}`)
      }
      return readResult.stdout
    },

    async fileExists(remotePath: string): Promise<boolean> {
      const existsResult = await spawnSsh(
        [...execArgs, prefixSudo(`test -f ${shellEscape(remotePath)} && echo yes`)],
        sudoStdin(),
      )
      return existsResult.stdout === "yes"
    },

    close(): void {
      process.removeListener("SIGINT", handleSignal)
      process.removeListener("SIGTERM", handleSignal)
      cleanup()
    },
  }

  return client
}
