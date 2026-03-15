import * as p from "@clack/prompts"
import pc from "picocolors"
import type { SshClient, CommandResult, ExecOptions } from "./types.js"

export class DryRunSshClient implements SshClient {
  private commands: string[] = []
  readonly isRoot: boolean

  constructor(private readonly real: SshClient) {
    this.isRoot = real.isRoot
  }

  async exec(command: string, _options?: ExecOptions): Promise<CommandResult> {
    this.commands.push(command)
    p.log.info(`${pc.yellow("[DRY-RUN]")} exec: ${pc.dim(command)}`)
    return { stdout: "", stderr: "", exitCode: 0 }
  }

  async execWithStdin(command: string, stdin: string, _options?: ExecOptions): Promise<CommandResult> {
    this.commands.push(`${command} (${stdin.length} bytes stdin)`)
    p.log.info(`${pc.yellow("[DRY-RUN]")} exec: ${pc.dim(command)} (with ${stdin.length} bytes stdin)`)
    return { stdout: "", stderr: "", exitCode: 0 }
  }

  async writeFile(remotePath: string, content: string): Promise<void> {
    this.commands.push(`writeFile ${remotePath} (${content.length} bytes)`)
    p.log.info(`${pc.yellow("[DRY-RUN]")} write: ${pc.dim(remotePath)} (${content.length} bytes)`)
  }

  async readFile(remotePath: string): Promise<string> {
    return this.real.readFile(remotePath)
  }

  async fileExists(remotePath: string): Promise<boolean> {
    return this.real.fileExists(remotePath)
  }

  close(): void {
    // Don't close the real client — caller manages lifecycle
  }

  getCommandLog(): string[] {
    return [...this.commands]
  }

  displaySummary(): void {
    if (this.commands.length === 0) {
      p.log.info(pc.yellow("[DRY-RUN] No commands would be executed."))
      return
    }

    const lines = this.commands.map((cmd, i) => `  ${i + 1}. ${cmd}`)
    p.note(lines.join("\n"), pc.yellow("Dry-run summary — commands that would be executed"))
  }
}
