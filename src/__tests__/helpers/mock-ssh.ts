import type { CommandResult, ExecOptions, SystemClient } from "../../types.ts"

interface MockExecResponse {
  stdout?: string
  stderr?: string
  exitCode?: number
}

interface ResponseRule {
  pattern: string | RegExp
  response: MockExecResponse
}

export class MockSshClient implements SystemClient {
  readonly isRoot: boolean
  readonly commands: string[] = []
  readonly stdinData: Map<string, string> = new Map()
  readonly writtenFiles: Map<string, string> = new Map()

  private responses: ResponseRule[] = []
  private fileContents: Map<string, string> = new Map()

  constructor(isRoot: boolean = true) {
    this.isRoot = isRoot
  }

  onExec(pattern: string | RegExp, response: MockExecResponse): this {
    this.responses.push({ pattern, response })
    return this
  }

  setFile(path: string, content: string): this {
    this.fileContents.set(path, content)
    return this
  }

  async exec(command: string, _options?: ExecOptions): Promise<CommandResult> {
    this.commands.push(command)
    return this.findResponse(command)
  }

  async execWithStdin(command: string, stdin: string, _options?: ExecOptions): Promise<CommandResult> {
    this.commands.push(command)
    this.stdinData.set(command, stdin)
    return this.findResponse(command)
  }

  async writeFile(remotePath: string, content: string): Promise<void> {
    this.writtenFiles.set(remotePath, content)
  }

  async readFile(remotePath: string): Promise<string> {
    const content = this.fileContents.get(remotePath)
    if (content === undefined) throw new Error(`MockSshClient: no content for ${remotePath}`)
    return content
  }

  async fileExists(remotePath: string): Promise<boolean> {
    return this.fileContents.has(remotePath)
  }

  close(): void {
    /* noop */
  }

  private findResponse(command: string): CommandResult {
    for (const { pattern, response } of this.responses) {
      const matches = typeof pattern === "string" ? command.includes(pattern) : pattern.test(command)
      if (matches) {
        return {
          stdout: response.stdout ?? "",
          stderr: response.stderr ?? "",
          exitCode: response.exitCode ?? 0,
        }
      }
    }
    return { stdout: "", stderr: "", exitCode: 0 }
  }

  hasCommand(substring: string): boolean {
    return this.commands.some((cmd) => cmd.includes(substring))
  }

  commandCount(substring: string): number {
    return this.commands.filter((cmd) => cmd.includes(substring)).length
  }
}
