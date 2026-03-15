export interface ConnectionConfig {
  host: string
  port: number
  username: string
  authMethod: "key" | "password"
  privateKeyPath?: string
  password?: string
  controlPath: string
}

export interface ServerInfo {
  ubuntuVersion: string
  ubuntuCodename: string
  usesSocketActivation: boolean
  hasCloudInit: boolean
  isRoot: boolean
}

export interface HardeningOptions {
  createSudoUser: boolean
  sudoUsername?: string
  sudoPassword?: string
  addPersonalKey: boolean
  personalKeyPath?: string
  configureCoolify: boolean
  changeSshPort: boolean
  newSshPort?: number
  disablePasswordAuth: boolean
  installUfw: boolean
  ufwPorts: UfwPort[]
  installFail2ban: boolean
  enableAutoUpdates: boolean
}

export interface UfwPort {
  port: string
  protocol: "tcp" | "udp" | "both"
  comment: string
}

export interface TaskResult {
  name: string
  success: boolean
  message: string
  details?: string
}

export interface Report {
  serverIp: string
  connectionUser: string
  sudoUser?: string
  date: string
  ubuntuVersion: string
  results: TaskResult[]
  newSshPort?: number
}

export interface CommandResult {
  stdout: string
  stderr: string
  exitCode: number
}

export interface SshClient {
  exec(command: string): Promise<CommandResult>
  execWithStdin(command: string, stdin: string): Promise<CommandResult>
  writeFile(remotePath: string, content: string): Promise<void>
  readFile(remotePath: string): Promise<string>
  fileExists(remotePath: string): Promise<boolean>
  close(): void
  readonly isRoot: boolean
}

export type HardeningTask = (
  ssh: SshClient,
  options: HardeningOptions,
  server: ServerInfo,
) => Promise<TaskResult>
