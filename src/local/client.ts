import type { CommandResult, ExecOptions, SystemClient } from "../types.ts"
import { shellEscape } from "../ssh/connection.ts"
import { DEFAULT_TIMEOUT, spawnProcess } from "../ssh/process.ts"

export class LocalClient implements SystemClient {
  readonly isRoot: boolean
  private readonly sudoPassword: string | undefined
  private readonly useSudo: boolean

  constructor(sudoPassword?: string, useSudo: boolean = false) {
    this.isRoot = process.getuid?.() === 0
    this.sudoPassword = sudoPassword
    this.useSudo = !this.isRoot && (useSudo || sudoPassword !== undefined)
  }

  private buildCommand(command: string): string[] {
    if (this.isRoot) return ["bash", "-c", command]
    if (this.sudoPassword) return ["sudo", "-S", "-p", "", "bash", "-c", command]
    if (this.useSudo) return ["sudo", "-n", "bash", "-c", command]
    return ["bash", "-c", command]
  }

  private prependSudoPassword(data?: string): string | undefined {
    if (!this.sudoPassword || this.isRoot) return data
    return data !== undefined ? `${this.sudoPassword}\n${data}` : `${this.sudoPassword}\n`
  }

  async exec(command: string, options?: ExecOptions): Promise<CommandResult> {
    const timeout = options?.timeout ?? DEFAULT_TIMEOUT
    return spawnProcess(this.buildCommand(command), this.prependSudoPassword(), timeout)
  }

  async execWithStdin(command: string, stdin: string, options?: ExecOptions): Promise<CommandResult> {
    const timeout = options?.timeout ?? DEFAULT_TIMEOUT
    return spawnProcess(this.buildCommand(command), this.prependSudoPassword(stdin), timeout)
  }

  private get useDirectFileIO(): boolean {
    return this.isRoot || !this.useSudo
  }

  async writeFile(path: string, content: string): Promise<void> {
    if (this.useDirectFileIO) {
      await Bun.write(path, content)
      return
    }
    const writeCmd = `tee ${shellEscape(path)} > /dev/null`
    const result = await spawnProcess(this.buildCommand(writeCmd), this.prependSudoPassword(content))
    if (result.exitCode !== 0) {
      throw new Error(`Failed to write ${path}: ${result.stderr}`)
    }
  }

  async readFile(path: string): Promise<string> {
    if (this.useDirectFileIO) {
      const file = Bun.file(path)
      const exists = await file.exists()
      if (!exists) throw new Error(`Failed to read ${path}: file not found`)
      const text = await file.text()
      return text.trimEnd()
    }
    const result = await this.exec(`cat ${shellEscape(path)}`)
    if (result.exitCode !== 0) {
      throw new Error(`Failed to read ${path}: ${result.stderr}`)
    }
    return result.stdout
  }

  async fileExists(path: string): Promise<boolean> {
    if (this.useDirectFileIO) {
      return Bun.file(path).exists()
    }
    const result = await this.exec(`test -f ${shellEscape(path)} && echo yes`)
    return result.stdout === "yes"
  }

  close(): void {
    // No-op — nothing to clean up locally
  }
}
