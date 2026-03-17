import { writeFileSync } from "fs"
import type { CommandResult, ExecOptions, SystemClient } from "./types.ts"

export class LoggingSshClient implements SystemClient {
  private entries: string[] = []
  readonly isRoot: boolean

  constructor(private readonly real: SystemClient) {
    this.isRoot = real.isRoot
  }

  private timestamp(): string {
    return new Date().toISOString()
  }

  private log(entry: string): void {
    this.entries.push(`[${this.timestamp()}] ${entry}`)
  }

  async exec(command: string, options?: ExecOptions): Promise<CommandResult> {
    this.log(`EXEC: ${command}`)
    const result = await this.real.exec(command, options)
    this.log(`EXIT: ${result.exitCode}`)
    if (result.stdout) {
      const truncated = result.stdout.length > 2000 ? `${result.stdout.slice(0, 2000)}... (truncated)` : result.stdout
      this.log(`STDOUT: ${truncated}`)
    }
    if (result.stderr) {
      this.log(`STDERR: ${result.stderr}`)
    }
    return result
  }

  async execWithStdin(command: string, stdin: string, options?: ExecOptions): Promise<CommandResult> {
    this.log(`EXEC: ${command} (with ${stdin.length} bytes stdin)`)
    const result = await this.real.execWithStdin(command, stdin, options)
    this.log(`EXIT: ${result.exitCode}`)
    if (result.stdout) {
      const truncated = result.stdout.length > 2000 ? `${result.stdout.slice(0, 2000)}... (truncated)` : result.stdout
      this.log(`STDOUT: ${truncated}`)
    }
    if (result.stderr) {
      this.log(`STDERR: ${result.stderr}`)
    }
    return result
  }

  async writeFile(remotePath: string, content: string): Promise<void> {
    this.log(`WRITE: ${remotePath} (${content.length} bytes)`)
    await this.real.writeFile(remotePath, content)
    this.log(`WRITE OK: ${remotePath}`)
  }

  async readFile(remotePath: string): Promise<string> {
    this.log(`READ: ${remotePath}`)
    const result = await this.real.readFile(remotePath)
    this.log(`READ OK: ${remotePath} (${result.length} bytes)`)
    return result
  }

  async fileExists(remotePath: string): Promise<boolean> {
    this.log(`EXISTS: ${remotePath}`)
    const result = await this.real.fileExists(remotePath)
    this.log(`EXISTS: ${remotePath} → ${result}`)
    return result
  }

  close(): void {
    // Don't close the real client — caller manages lifecycle
  }

  flush(filePath: string): void {
    if (this.entries.length === 0) return
    writeFileSync(filePath, `${this.entries.join("\n")}\n`, "utf-8")
  }

  hasEntries(): boolean {
    return this.entries.length > 0
  }
}
