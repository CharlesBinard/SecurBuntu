export interface ConnectionConfig {
  host: string
  port: number
  username: string
  authMethod: "key" | "password" | "copy"
  privateKeyPath?: string
  password?: string
  sudoPassword?: string
  controlPath: string
}

export interface ServerInfo {
  ubuntuVersion: string
  ubuntuCodename: string
  usesSocketActivation: boolean
  hasCloudInit: boolean
  isRoot: boolean
}

export interface ServerAuditContext {
  currentSshPort: number
  ufwActive: boolean
  fail2banActive: boolean
  sshKeysInfo: string
  detectedServices: string[]
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
  permitRootLogin: "no" | "prohibit-password" | "yes"
  disablePasswordAuth: boolean
  disableX11Forwarding: boolean
  maxAuthTries: number
  installUfw: boolean
  ufwPorts: UfwPort[]
  installFail2ban: boolean
  enableAutoUpdates: boolean
  enableSysctl: boolean
  sysctlOptions?: SysctlOptions
  enableSshBanner: boolean
  disableServices: boolean
  servicesToDisable: string[]
  fixFilePermissions: boolean
  currentSshPort: number
}

export interface UfwPort {
  port: string
  protocol: "tcp" | "udp" | "both"
  comment: string
}

export interface SysctlOptions {
  blockForwarding: boolean
  ignoreRedirects: boolean
  disableSourceRouting: boolean
  synFloodProtection: boolean
  disableIcmpBroadcast: boolean
}

export interface AuditCheck {
  name: string
  status: string
  detail?: string
}

export interface AuditResult {
  checks: AuditCheck[]
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
  audit?: AuditResult
  postAudit?: AuditResult
}

export interface CommandResult {
  stdout: string
  stderr: string
  exitCode: number
}

export interface ExecOptions {
  timeout?: number
}

export interface SystemClient {
  exec(command: string, options?: ExecOptions): Promise<CommandResult>
  execWithStdin(command: string, stdin: string, options?: ExecOptions): Promise<CommandResult>
  writeFile(remotePath: string, content: string): Promise<void>
  readFile(remotePath: string): Promise<string>
  fileExists(remotePath: string): Promise<boolean>
  close(): void
  readonly isRoot: boolean
}

export type HardeningTask = (client: SystemClient, options: HardeningOptions, server: ServerInfo) => Promise<TaskResult>

export interface ConnectionResult {
  client: SystemClient
  mode: "local" | "ssh"
  host: string
  username: string
}
