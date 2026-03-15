# SecurBuntu CLI Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a BunJS CLI that connects to a remote Ubuntu server via SSH to interactively harden its security.

**Architecture:** Modular TypeScript project — `ssh.ts` wraps system SSH via `Bun.spawn` + ControlMaster, `prompts.ts` handles all interactive questions via `@clack/prompts`, task modules in `src/tasks/` each handle one hardening concern, `index.ts` orchestrates the full workflow. No `any`, no `as`.

**Tech Stack:** Bun, TypeScript (strict), `@clack/prompts`, `picocolors`, system `ssh`/`sshpass`

**Spec:** `docs/superpowers/specs/2026-03-15-securbuntu-cli-design.md`

---

## File Map

| File | Responsibility |
|------|---------------|
| `package.json` | Project metadata, dependencies, `bin` entry |
| `tsconfig.json` | Strict TypeScript config for Bun |
| `src/types.ts` | All shared interfaces (`ConnectionConfig`, `ServerInfo`, `HardeningOptions`, `TaskResult`, etc.) |
| `src/ui.ts` | ASCII banner, styled output helpers |
| `src/ssh.ts` | SSH client: connect, exec, execWithStdin, writeFile, readFile, fileExists, close, signal cleanup |
| `src/prompts.ts` | All interactive questions (connection, questionnaire, confirmation) |
| `src/tasks/index.ts` | Task orchestrator: runs tasks in strict order with spinners |
| `src/tasks/update.ts` | `apt update && apt upgrade -y` (called directly from `index.ts` before questionnaire, NOT from orchestrator) |
| `src/tasks/user.ts` | Create sudo user with SSH directory setup |
| `src/tasks/ssh-keys.ts` | Inject SSH public keys into authorized_keys |
| `src/tasks/ufw.ts` | Install and configure UFW with commented rules |
| `src/tasks/fail2ban.ts` | Install and configure Fail2ban (version-adaptive) |
| `src/tasks/unattended.ts` | Configure unattended-upgrades |
| `src/tasks/ssh-config.ts` | Harden sshd_config, handle cloud-init, restart SSH with rollback |
| `src/report.ts` | Terminal summary display + Markdown file export |
| `src/index.ts` | Entry point: banner → connect → update → questionnaire → confirm → execute → report |

---

## Chunk 1: Project Setup & Foundation

### Task 1: Initialize Bun project and install dependencies

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`

- [ ] **Step 1: Initialize Bun project**

Run: `cd /home/carlito/Projects/Labs/SecurBuntu && bun init -y`

- [ ] **Step 2: Install dependencies**

Run: `bun add @clack/prompts@latest picocolors@latest`

- [ ] **Step 3: Configure tsconfig.json**

Write `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "types": ["bun-types"]
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 4: Update package.json with bin entry and metadata**

Add to `package.json`:
```json
{
  "name": "securbuntu",
  "version": "1.0.0",
  "type": "module",
  "bin": {
    "securbuntu": "./src/index.ts"
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json bun.lock
git commit -m "chore: initialize Bun project with dependencies"
```

---

### Task 2: Create shared types

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Write all shared interfaces**

Write `src/types.ts`:
```typescript
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
```

- [ ] **Step 2: Verify types compile**

Run: `bun build --no-bundle src/types.ts --outdir /tmp/typecheck 2>&1`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add shared TypeScript interfaces"
```

---

### Task 3: Create UI module (banner + helpers)

**Files:**
- Create: `src/ui.ts`

- [ ] **Step 1: Write UI module**

Write `src/ui.ts`:
```typescript
import pc from "picocolors"
import { intro, note } from "@clack/prompts"

export function showBanner(): void {
  const version = getVersion()
  const banner = `
${pc.cyan(pc.bold("   ____                       ____              _        "))}
${pc.cyan(pc.bold("  / ___|  ___  ___ _   _ _ __| __ ) _   _ _ __ | |_ _   _"))}
${pc.cyan(pc.bold("  \\___ \\ / _ \\/ __| | | | '__|  _ \\| | | | '_ \\| __| | | |"))}
${pc.cyan(pc.bold("   ___) |  __/ (__| |_| | |  | |_) | |_| | | | | |_| |_| |"))}
${pc.cyan(pc.bold("  |____/ \\___|\\___|\\__,_|_|  |____/ \\__,_|_| |_|\\__|\\__,_|"))}

  ${pc.dim(`v${version} — Ubuntu Server Hardening Tool`)}
`
  console.log(banner)
  intro(pc.bgCyan(pc.black(" SecurBuntu ")))
}

async function getVersionAsync(): Promise<string> {
  try {
    const file = Bun.file(import.meta.dir + "/../package.json")
    const pkg: { version: string } = await file.json()
    return pkg.version
  } catch {
    return "0.0.0"
  }
}

let cachedVersion = "0.0.0"

export async function initVersion(): Promise<void> {
  cachedVersion = await getVersionAsync()
}

function getVersion(): string {
  return cachedVersion
}

export function formatSuccess(message: string): string {
  return `${pc.green("✓")} ${message}`
}

export function formatError(message: string): string {
  return `${pc.red("✗")} ${message}`
}

export function formatWarning(message: string): string {
  return `${pc.yellow("!")} ${message}`
}

export function formatInfo(message: string): string {
  return `${pc.cyan("→")} ${message}`
}
```

- [ ] **Step 2: Test banner renders without errors**

Run: `bun -e "import { showBanner } from './src/ui.ts'; showBanner()"`
Expected: ASCII art banner displays in terminal

- [ ] **Step 3: Commit**

```bash
git add src/ui.ts
git commit -m "feat: add ASCII banner and UI helpers"
```

---

## Chunk 2: SSH Client

### Task 4: Implement SSH client wrapper

**Files:**
- Create: `src/ssh.ts`

- [ ] **Step 1: Write the SSH client module**

Write `src/ssh.ts`:
```typescript
import { createHash } from "crypto"
import { existsSync } from "fs"
import type { ConnectionConfig, CommandResult, ServerInfo, SshClient } from "./types.js"

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
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "ConnectTimeout=10",
    "-p", String(config.port),
  ]

  if (config.authMethod === "key" && config.privateKeyPath) {
    args.push("-i", config.privateKeyPath)
  }

  return args
}

async function spawnSsh(
  args: string[],
  stdinData?: string,
): Promise<CommandResult> {
  const proc = Bun.spawn(["ssh", ...args], {
    stdin: stdinData !== undefined ? Buffer.from(stdinData) : "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])

  const exitCode = await proc.exited

  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode }
}

async function spawnSshpass(
  password: string,
  args: string[],
): Promise<CommandResult> {
  const proc = Bun.spawn(["sshpass", "-e", "ssh", ...args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, SSHPASS: password },
  })

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])

  const exitCode = await proc.exited

  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode }
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

    async exec(command: string): Promise<CommandResult> {
      return spawnSsh([...execArgs, prefixSudo(command)])
    },

    async execWithStdin(command: string, stdin: string): Promise<CommandResult> {
      return spawnSsh([...execArgs, prefixSudo(command)], stdin)
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

export async function reconnect(
  config: ConnectionConfig,
  newPort: number,
): Promise<SshClient> {
  return connect({ ...config, port: newPort })
}
```

- [ ] **Step 2: Verify it compiles**

Run: `bun build --no-bundle src/ssh.ts --outdir /tmp/typecheck 2>&1`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/ssh.ts
git commit -m "feat: add SSH client wrapper with ControlMaster"
```

---

## Chunk 3: Prompts Module

### Task 5: Implement connection prompts

**Files:**
- Create: `src/prompts.ts`

- [ ] **Step 1: Write prompts module**

Write `src/prompts.ts`:
```typescript
import * as p from "@clack/prompts"
import pc from "picocolors"
import { readFileSync, existsSync } from "fs"
import { detectDefaultKeyPath, detectDefaultPubKeyPath, checkSshpassInstalled } from "./ssh.js"
import type { ConnectionConfig, HardeningOptions, ServerInfo, SshClient, UfwPort } from "./types.js"

function isCancel(value: unknown): value is symbol {
  return p.isCancel(value)
}

function handleCancel(): never {
  p.cancel("Operation cancelled.")
  process.exit(0)
}

export async function promptConnection(): Promise<ConnectionConfig> {
  const host = await p.text({
    message: "Enter the server IP address or hostname",
    placeholder: "192.168.1.100",
    validate(value) {
      if (!value.trim()) return "IP address is required"
    },
  })
  if (isCancel(host)) handleCancel()

  const username = await p.text({
    message: "Enter the SSH username",
    placeholder: "root",
    defaultValue: "root",
  })
  if (isCancel(username)) handleCancel()

  const authMethod = await p.select({
    message: "How do you want to authenticate?",
    options: [
      { value: "key" as const, label: "SSH Key", hint: "recommended" },
      { value: "password" as const, label: "Password" },
    ],
  })
  if (isCancel(authMethod)) handleCancel()

  let privateKeyPath: string | undefined
  let password: string | undefined

  if (authMethod === "key") {
    const defaultKey = detectDefaultKeyPath()
    const keyPath = await p.text({
      message: "Path to your private SSH key",
      placeholder: defaultKey ?? "~/.ssh/id_ed25519",
      defaultValue: defaultKey,
      validate(value) {
        if (!value.trim()) return "Key path is required"
        const resolved = value.replace("~", process.env.HOME ?? "")
        if (!existsSync(resolved)) return `File not found: ${resolved}`
      },
    })
    if (isCancel(keyPath)) handleCancel()
    privateKeyPath = keyPath.replace("~", process.env.HOME ?? "")
  } else {
    const hasSshpass = await checkSshpassInstalled()
    if (!hasSshpass) {
      p.log.error(
        `${pc.red("sshpass is required for password authentication but is not installed.")}\n` +
        `  ${pc.dim("Install it with:")}\n` +
        `  ${pc.cyan("  Ubuntu/Debian: sudo apt install sshpass")}\n` +
        `  ${pc.cyan("  macOS:         brew install sshpass")}`
      )
      process.exit(1)
    }

    const pw = await p.password({
      message: "Enter the SSH password",
      validate(value) {
        if (!value) return "Password is required"
      },
    })
    if (isCancel(pw)) handleCancel()
    password = pw
  }

  return {
    host: host.trim(),
    port: 22,
    username: username.trim(),
    authMethod,
    privateKeyPath,
    password,
    controlPath: "", // Will be set by connect()
  }
}

export async function promptHardeningOptions(
  server: ServerInfo,
  ssh: SshClient,
): Promise<HardeningOptions> {
  const options: HardeningOptions = {
    createSudoUser: false,
    addPersonalKey: false,
    configureCoolify: false,
    changeSshPort: false,
    disablePasswordAuth: false,
    installUfw: false,
    ufwPorts: [],
    installFail2ban: false,
    enableAutoUpdates: false,
  }

  // 1. Create sudo user (only if root)
  if (server.isRoot) {
    p.log.info(pc.dim("A dedicated sudo user is recommended for daily operations instead of using root directly."))
    const createUser = await p.confirm({
      message: "You are connected as root. Do you want to create a new sudo user?",
    })
    if (isCancel(createUser)) handleCancel()

    if (createUser) {
      options.createSudoUser = true

      const sudoUsername = await p.text({
        message: "Enter the new username",
        placeholder: "deploy",
        validate(value) {
          if (!value.trim()) return "Username is required"
          if (!/^[a-z_][a-z0-9_-]*$/.test(value)) return "Invalid username format"
        },
      })
      if (isCancel(sudoUsername)) handleCancel()
      options.sudoUsername = sudoUsername.trim()

      const sudoPassword = await p.password({
        message: `Enter password for ${sudoUsername}`,
        validate(value) {
          if (!value || value.length < 8) return "Password must be at least 8 characters"
        },
      })
      if (isCancel(sudoPassword)) handleCancel()
      options.sudoPassword = sudoPassword
    }
  }

  // 2. Add personal SSH key
  const addKey = await p.confirm({
    message: "Do you want to add a personal SSH public key to the server?",
  })
  if (isCancel(addKey)) handleCancel()

  if (addKey) {
    options.addPersonalKey = true
    const defaultPubKey = detectDefaultPubKeyPath()

    const pubKeyPath = await p.text({
      message: "Path to your public SSH key",
      placeholder: defaultPubKey ?? "~/.ssh/id_ed25519.pub",
      defaultValue: defaultPubKey,
      validate(value) {
        if (!value.trim()) return "Path is required"
        const resolved = value.replace("~", process.env.HOME ?? "")
        if (!existsSync(resolved)) return `File not found: ${resolved}`
        const content = readFileSync(resolved, "utf-8").trim()
        if (!content.startsWith("ssh-")) return "Invalid public key format (must start with ssh-)"
      },
    })
    if (isCancel(pubKeyPath)) handleCancel()
    options.personalKeyPath = pubKeyPath.replace("~", process.env.HOME ?? "")
  }

  // 3. Configure for Coolify
  const coolify = await p.confirm({
    message: "Do you want to configure this server for Coolify?",
    initialValue: false,
  })
  if (isCancel(coolify)) handleCancel()
  options.configureCoolify = coolify

  if (coolify) {
    p.log.info(pc.dim("Coolify requires root SSH access. Root login will be set to 'prohibit-password' (key-only)."))
    if (!addKey) {
      p.log.warning(pc.yellow("You should add an SSH key for root access. Coolify will need it."))
    }
  }

  // 4. Change SSH port
  const changePort = await p.confirm({
    message: "Do you want to change the default SSH port (22)?",
    initialValue: false,
  })
  if (isCancel(changePort)) handleCancel()

  if (changePort) {
    options.changeSshPort = true
    const newPort = await p.text({
      message: "Enter the new SSH port",
      placeholder: "2222",
      validate(value) {
        const port = parseInt(value, 10)
        if (isNaN(port)) return "Must be a number"
        if (port < 1024 || port > 65535) return "Port must be between 1024 and 65535"
      },
    })
    if (isCancel(newPort)) handleCancel()
    options.newSshPort = parseInt(newPort, 10)
  }

  // 5. Disable password auth (with hard gate)
  const sshPort = options.changeSshPort && options.newSshPort ? options.newSshPort : 22
  const targetUser = options.createSudoUser && options.sudoUsername
    ? options.sudoUsername
    : (await ssh.exec("whoami")).stdout

  let hasExistingKey = false
  const targetHome = targetUser === "root" ? "/root" : `/home/${targetUser}`
  const existingKeysResult = await ssh.exec(`test -f ${targetHome}/.ssh/authorized_keys && grep -c 'ssh-' ${targetHome}/.ssh/authorized_keys || echo 0`)
  hasExistingKey = parseInt(existingKeysResult.stdout, 10) > 0

  const willHaveKey = options.addPersonalKey || hasExistingKey

  if (willHaveKey) {
    const disablePw = await p.confirm({
      message: "Do you want to disable SSH password authentication?",
      initialValue: true,
    })
    if (isCancel(disablePw)) handleCancel()
    options.disablePasswordAuth = disablePw
  } else {
    p.log.warning(
      pc.yellow("Cannot disable password authentication: no SSH key found or being added for ") +
      pc.bold(targetUser) +
      pc.yellow(". You would be locked out.")
    )
    options.disablePasswordAuth = false
  }

  // 6. Install UFW
  const installUfw = await p.confirm({
    message: "Do you want to install and configure UFW (firewall)?",
  })
  if (isCancel(installUfw)) handleCancel()

  if (installUfw) {
    options.installUfw = true
    const sshPortStr = String(sshPort)

    const portChoices = await p.multiselect({
      message: "Select ports to allow through the firewall",
      options: [
        { value: `${sshPortStr}/tcp|SecurBuntu: SSH access`, label: `SSH (${sshPortStr}/tcp)`, hint: "required" },
        { value: "80/tcp|SecurBuntu: HTTP web traffic", label: "HTTP (80/tcp)" },
        { value: "443/tcp|SecurBuntu: HTTPS web traffic", label: "HTTPS (443/tcp)" },
        { value: "8000/tcp|SecurBuntu: Development server", label: "Dev server (8000/tcp)" },
        { value: "3000/tcp|SecurBuntu: Node.js / Coolify UI", label: "Node.js / Coolify (3000/tcp)" },
      ],
      required: true,
      initialValues: [`${sshPortStr}/tcp|SecurBuntu: SSH access`],
    })
    if (isCancel(portChoices)) handleCancel()

    options.ufwPorts = portChoices.map((choice) => {
      const pipeIdx = choice.indexOf("|")
      const portProto = choice.slice(0, pipeIdx)
      const comment = choice.slice(pipeIdx + 1)
      const slashIdx = portProto.indexOf("/")
      const port = portProto.slice(0, slashIdx)
      const protocol = portProto.slice(slashIdx + 1)

      if (protocol !== "tcp" && protocol !== "udp" && protocol !== "both") {
        throw new Error(`Invalid protocol: ${protocol}`)
      }

      return { port, protocol, comment }
    })

    // Custom port option
    const addCustom = await p.confirm({
      message: "Do you want to add a custom port?",
      initialValue: false,
    })
    if (isCancel(addCustom)) handleCancel()

    if (addCustom) {
      const customPort = await p.text({
        message: "Enter port or range (e.g., 8080 or 6000:6100)",
        validate(value) {
          if (!value.trim()) return "Port is required"
          if (!/^\d+(?::\d+)?$/.test(value)) return "Invalid format. Use: 8080 or 6000:6100"
        },
      })
      if (isCancel(customPort)) handleCancel()

      const customProto = await p.select({
        message: "Protocol for this port?",
        options: [
          { value: "tcp" as const, label: "TCP" },
          { value: "udp" as const, label: "UDP" },
          { value: "both" as const, label: "Both" },
        ],
      })
      if (isCancel(customProto)) handleCancel()

      options.ufwPorts.push({
        port: customPort.trim(),
        protocol: customProto,
        comment: `SecurBuntu: Custom port ${customPort}`,
      })
    }
  }

  // 7. Fail2ban
  const installFail2ban = await p.confirm({
    message: "Do you want to install Fail2ban to protect against brute-force attacks?",
  })
  if (isCancel(installFail2ban)) handleCancel()
  options.installFail2ban = installFail2ban

  // 8. Auto-updates
  const autoUpdates = await p.confirm({
    message: "Do you want to enable automatic security updates (unattended-upgrades)?",
  })
  if (isCancel(autoUpdates)) handleCancel()
  options.enableAutoUpdates = autoUpdates

  return options
}

export async function promptConfirmation(
  host: string,
  options: HardeningOptions,
): Promise<boolean> {
  const sshPort = options.changeSshPort && options.newSshPort ? options.newSshPort : 22
  const lines: string[] = []

  if (options.createSudoUser) lines.push(`  Create sudo user: ${pc.cyan(options.sudoUsername ?? "")}`)
  if (options.addPersonalKey) lines.push(`  Add SSH key: ${pc.cyan(options.personalKeyPath ?? "")}`)
  lines.push(`  Coolify: ${options.configureCoolify ? pc.green("Yes") : pc.dim("No")}`)
  lines.push(`  SSH port: ${options.changeSshPort ? pc.yellow(String(sshPort)) : pc.dim("22 (default)")}`)
  lines.push(`  Disable password auth: ${options.disablePasswordAuth ? pc.green("Yes") : pc.dim("No")}`)

  if (options.installUfw) {
    const ports = options.ufwPorts.map(p => p.port).join(", ")
    lines.push(`  UFW: ${pc.green("Yes")} (ports: ${pc.cyan(ports)})`)
  } else {
    lines.push(`  UFW: ${pc.dim("No")}`)
  }

  lines.push(`  Fail2ban: ${options.installFail2ban ? pc.green("Yes") : pc.dim("No")}`)
  lines.push(`  Auto-updates: ${options.enableAutoUpdates ? pc.green("Yes") : pc.dim("No")}`)

  p.note(lines.join("\n"), "Summary of changes")

  const confirm = await p.confirm({
    message: `Apply these changes to ${pc.bold(host)}?`,
  })
  if (isCancel(confirm)) handleCancel()

  return confirm
}

export async function promptExportReport(): Promise<boolean> {
  const exportReport = await p.confirm({
    message: "Do you want to export this report as a Markdown file?",
    initialValue: false,
  })
  if (isCancel(exportReport)) handleCancel()
  return exportReport
}
```

- [ ] **Step 2: Verify it compiles**

Run: `bun build --no-bundle src/prompts.ts --outdir /tmp/typecheck 2>&1`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/prompts.ts
git commit -m "feat: add interactive prompts for connection and hardening options"
```

---

## Chunk 4: Hardening Tasks

### Task 6: Implement system update task

**Files:**
- Create: `src/tasks/update.ts`

- [ ] **Step 1: Write update task**

Write `src/tasks/update.ts`:
```typescript
import type { HardeningTask } from "../types.js"

export const runUpdate: HardeningTask = async (ssh) => {
  const result = await ssh.exec("DEBIAN_FRONTEND=noninteractive apt update && DEBIAN_FRONTEND=noninteractive apt upgrade -y")

  if (result.exitCode !== 0) {
    return {
      name: "System Update",
      success: false,
      message: "Failed to update system packages",
      details: result.stderr,
    }
  }

  return {
    name: "System Update",
    success: true,
    message: "System packages updated successfully",
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/tasks/update.ts
git commit -m "feat: add system update task"
```

---

### Task 7: Implement sudo user creation task

**Files:**
- Create: `src/tasks/user.ts`

- [ ] **Step 1: Write user task**

Write `src/tasks/user.ts`:
```typescript
import type { HardeningTask } from "../types.js"

export const runCreateUser: HardeningTask = async (ssh, options) => {
  if (!options.createSudoUser || !options.sudoUsername || !options.sudoPassword) {
    return {
      name: "Create Sudo User",
      success: true,
      message: "Skipped (not requested)",
    }
  }

  const username = options.sudoUsername

  // Check if user already exists
  const checkResult = await ssh.exec(`id ${username} 2>/dev/null && echo exists || echo missing`)
  const userExists = checkResult.stdout === "exists"

  if (!userExists) {
    const addResult = await ssh.exec(`adduser --disabled-password --gecos "" ${username}`)
    if (addResult.exitCode !== 0) {
      return {
        name: "Create Sudo User",
        success: false,
        message: `Failed to create user ${username}`,
        details: addResult.stderr,
      }
    }
  }

  // Set password via stdin (never in command string)
  const pwResult = await ssh.execWithStdin(
    "chpasswd",
    `${username}:${options.sudoPassword}\n`,
  )
  if (pwResult.exitCode !== 0) {
    return {
      name: "Create Sudo User",
      success: false,
      message: `Failed to set password for ${username}`,
      details: pwResult.stderr,
    }
  }

  // Add to sudo group
  const sudoResult = await ssh.exec(`usermod -aG sudo ${username}`)
  if (sudoResult.exitCode !== 0) {
    return {
      name: "Create Sudo User",
      success: false,
      message: `Failed to add ${username} to sudo group`,
      details: sudoResult.stderr,
    }
  }

  // Setup SSH directory
  const setupResult = await ssh.exec(
    `mkdir -p /home/${username}/.ssh && ` +
    `chmod 700 /home/${username}/.ssh && ` +
    `touch /home/${username}/.ssh/authorized_keys && ` +
    `chmod 600 /home/${username}/.ssh/authorized_keys && ` +
    `chown -R ${username}:${username} /home/${username}/.ssh`,
  )
  if (setupResult.exitCode !== 0) {
    return {
      name: "Create Sudo User",
      success: false,
      message: `Failed to setup SSH directory for ${username}`,
      details: setupResult.stderr,
    }
  }

  return {
    name: "Create Sudo User",
    success: true,
    message: userExists
      ? `User ${username} already existed, password and sudo updated`
      : `User ${username} created with sudo privileges`,
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/tasks/user.ts
git commit -m "feat: add sudo user creation task"
```

---

### Task 8: Implement SSH keys injection task

**Files:**
- Create: `src/tasks/ssh-keys.ts`

- [ ] **Step 1: Write SSH keys task**

Write `src/tasks/ssh-keys.ts`:
```typescript
import { readFileSync } from "fs"
import type { HardeningTask, SshClient } from "../types.js"

export const runInjectSshKeys: HardeningTask = async (ssh, options) => {
  if (!options.addPersonalKey || !options.personalKeyPath) {
    return {
      name: "SSH Keys",
      success: true,
      message: "Skipped (no key to add)",
    }
  }

  const pubKeyContent = readFileSync(options.personalKeyPath, "utf-8").trim()
  const details: string[] = []

  // Determine target user
  const targetUser = options.createSudoUser && options.sudoUsername
    ? options.sudoUsername
    : (await ssh.exec("whoami")).stdout

  const targetHome = targetUser === "root" ? "/root" : `/home/${targetUser}`

  // Inject key for target user
  const injected = await injectKey(ssh, pubKeyContent, targetHome, targetUser)
  if (injected.success) {
    details.push(injected.message)
  } else {
    return {
      name: "SSH Keys",
      success: false,
      message: injected.message,
      details: injected.details,
    }
  }

  // If Coolify, also inject for root
  if (options.configureCoolify && targetUser !== "root") {
    const rootInjected = await injectKey(ssh, pubKeyContent, "/root", "root")
    if (rootInjected.success) {
      details.push(rootInjected.message)
    } else {
      details.push(`Warning: ${rootInjected.message}`)
    }
  }

  return {
    name: "SSH Keys",
    success: true,
    message: "SSH public key(s) injected",
    details: details.join("\n"),
  }
}

async function injectKey(
  ssh: SshClient,
  pubKey: string,
  homeDir: string,
  user: string,
): Promise<{ success: boolean; message: string; details?: string }> {
  // Ensure .ssh directory exists
  const mkdirResult = await ssh.exec(
    `mkdir -p ${homeDir}/.ssh && chmod 700 ${homeDir}/.ssh`,
  )
  if (mkdirResult.exitCode !== 0) {
    return { success: false, message: `Failed to create .ssh for ${user}`, details: mkdirResult.stderr }
  }

  const authKeysPath = `${homeDir}/.ssh/authorized_keys`

  // Check if key already exists (pipe key via stdin to avoid shell escaping)
  const grepResult = await ssh.execWithStdin(
    `grep -qxF -f /dev/stdin '${authKeysPath}' 2>/dev/null && echo found || echo missing`,
    pubKey,
  )
  if (grepResult.stdout.includes("found")) {
    return { success: true, message: `Key already present for ${user}` }
  }

  // Append key via stdin (never in command string)
  const appendResult = await ssh.execWithStdin(
    `tee -a '${authKeysPath}' > /dev/null`,
    pubKey + "\n",
  )
  if (appendResult.exitCode !== 0) {
    return { success: false, message: `Failed to inject key for ${user}`, details: appendResult.stderr }
  }

  // Fix permissions
  const chmodResult = await ssh.exec(
    `chmod 600 '${authKeysPath}' && chown ${user}:${user} '${authKeysPath}'`,
  )
  if (chmodResult.exitCode !== 0) {
    return { success: false, message: `Failed to set permissions for ${user}`, details: chmodResult.stderr }
  }

  return { success: true, message: `Key added to ${authKeysPath}` }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/tasks/ssh-keys.ts
git commit -m "feat: add SSH key injection task"
```

---

### Task 9: Implement UFW task

**Files:**
- Create: `src/tasks/ufw.ts`

- [ ] **Step 1: Write UFW task**

Write `src/tasks/ufw.ts`:
```typescript
import type { HardeningTask } from "../types.js"

export const runConfigureUfw: HardeningTask = async (ssh, options) => {
  if (!options.installUfw) {
    return {
      name: "UFW Firewall",
      success: true,
      message: "Skipped (not requested)",
    }
  }

  // Install UFW
  const installResult = await ssh.exec("DEBIAN_FRONTEND=noninteractive apt install -y ufw")
  if (installResult.exitCode !== 0) {
    return {
      name: "UFW Firewall",
      success: false,
      message: "Failed to install UFW",
      details: installResult.stderr,
    }
  }

  // Add rules with comments — SSH port first
  const addedRules: string[] = []
  const failedRules: string[] = []

  for (const rule of options.ufwPorts) {
    if (rule.protocol === "both") {
      const tcpResult = await ssh.exec(`ufw allow ${rule.port}/tcp comment '${rule.comment}'`)
      const udpResult = await ssh.exec(`ufw allow ${rule.port}/udp comment '${rule.comment}'`)
      if (tcpResult.exitCode !== 0 || udpResult.exitCode !== 0) {
        failedRules.push(`${rule.port}/tcp+udp`)
      } else {
        addedRules.push(`${rule.port}/tcp+udp`)
      }
    } else {
      const ruleResult = await ssh.exec(`ufw allow ${rule.port}/${rule.protocol} comment '${rule.comment}'`)
      if (ruleResult.exitCode !== 0) {
        failedRules.push(`${rule.port}/${rule.protocol}`)
      } else {
        addedRules.push(`${rule.port}/${rule.protocol}`)
      }
    }
  }

  // Enable UFW
  const enableResult = await ssh.exec("ufw --force enable")
  if (enableResult.exitCode !== 0) {
    return {
      name: "UFW Firewall",
      success: false,
      message: "Failed to enable UFW",
      details: enableResult.stderr,
    }
  }

  const details = failedRules.length > 0
    ? `Allowed: ${addedRules.join(", ")}. Failed: ${failedRules.join(", ")}`
    : `Allowed ports: ${addedRules.join(", ")}`

  return {
    name: "UFW Firewall",
    success: failedRules.length === 0,
    message: failedRules.length > 0 ? "UFW configured with some rule failures" : "UFW installed and configured",
    details,
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/tasks/ufw.ts
git commit -m "feat: add UFW firewall configuration task"
```

---

### Task 10: Implement Fail2ban task

**Files:**
- Create: `src/tasks/fail2ban.ts`

- [ ] **Step 1: Write Fail2ban task**

Write `src/tasks/fail2ban.ts`:
```typescript
import type { HardeningTask } from "../types.js"

export const runConfigureFail2ban: HardeningTask = async (ssh, options, server) => {
  if (!options.installFail2ban) {
    return {
      name: "Fail2ban",
      success: true,
      message: "Skipped (not requested)",
    }
  }

  // Install Fail2ban
  const installResult = await ssh.exec("DEBIAN_FRONTEND=noninteractive apt install -y fail2ban")
  if (installResult.exitCode !== 0) {
    return {
      name: "Fail2ban",
      success: false,
      message: "Failed to install Fail2ban",
      details: installResult.stderr,
    }
  }

  const sshPort = options.changeSshPort && options.newSshPort ? options.newSshPort : 22
  const isModernUbuntu = isVersionGte(server.ubuntuVersion, "24.04")

  let jailConfig: string

  if (isModernUbuntu) {
    jailConfig = [
      "[sshd]",
      "enabled = true",
      `port = ${sshPort}`,
      "maxretry = 5",
      "findtime = 600",
      "bantime = 3600",
      "backend = systemd",
      "banaction = nftables",
      "journalmatch = _SYSTEMD_UNIT=ssh.service + _COMM=sshd",
    ].join("\n")
  } else {
    jailConfig = [
      "[sshd]",
      "enabled = true",
      `port = ${sshPort}`,
      "maxretry = 5",
      "findtime = 600",
      "bantime = 3600",
      "backend = auto",
      "banaction = iptables-multiport",
    ].join("\n")
  }

  await ssh.writeFile("/etc/fail2ban/jail.d/securbuntu.local", jailConfig)

  // Enable and restart
  const restartResult = await ssh.exec("systemctl enable fail2ban && systemctl restart fail2ban")
  if (restartResult.exitCode !== 0) {
    return {
      name: "Fail2ban",
      success: false,
      message: "Failed to start Fail2ban",
      details: restartResult.stderr,
    }
  }

  return {
    name: "Fail2ban",
    success: true,
    message: `Fail2ban configured for SSH on port ${sshPort}`,
    details: `Backend: ${isModernUbuntu ? "systemd" : "auto"}, Banaction: ${isModernUbuntu ? "nftables" : "iptables-multiport"}`,
  }
}

function isVersionGte(version: string, target: string): boolean {
  const [vMajor = 0, vMinor = 0] = version.split(".").map(Number)
  const [tMajor = 0, tMinor = 0] = target.split(".").map(Number)
  return vMajor > tMajor || (vMajor === tMajor && vMinor >= tMinor)
}
```

- [ ] **Step 2: Commit**

```bash
git add src/tasks/fail2ban.ts
git commit -m "feat: add Fail2ban configuration task with Ubuntu version adaptation"
```

---

### Task 11: Implement unattended-upgrades task

**Files:**
- Create: `src/tasks/unattended.ts`

- [ ] **Step 1: Write unattended-upgrades task**

Write `src/tasks/unattended.ts`:
```typescript
import type { HardeningTask } from "../types.js"

export const runConfigureUnattended: HardeningTask = async (ssh, options) => {
  if (!options.enableAutoUpdates) {
    return {
      name: "Automatic Updates",
      success: true,
      message: "Skipped (not requested)",
    }
  }

  // Install unattended-upgrades
  const installResult = await ssh.exec("DEBIAN_FRONTEND=noninteractive apt install -y unattended-upgrades")
  if (installResult.exitCode !== 0) {
    return {
      name: "Automatic Updates",
      success: false,
      message: "Failed to install unattended-upgrades",
      details: installResult.stderr,
    }
  }

  // Check 50unattended-upgrades exists
  const has50 = await ssh.fileExists("/etc/apt/apt.conf.d/50unattended-upgrades")
  const warning = has50 ? undefined : "Warning: /etc/apt/apt.conf.d/50unattended-upgrades not found. Security origins may not be configured."

  // Write 20auto-upgrades
  const autoUpgradesConfig = [
    'APT::Periodic::Update-Package-Lists "1";',
    'APT::Periodic::Unattended-Upgrade "1";',
    'APT::Periodic::AutocleanInterval "7";',
  ].join("\n")

  await ssh.writeFile("/etc/apt/apt.conf.d/20auto-upgrades", autoUpgradesConfig)

  return {
    name: "Automatic Updates",
    success: true,
    message: "Unattended-upgrades enabled",
    details: warning,
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/tasks/unattended.ts
git commit -m "feat: add unattended-upgrades configuration task"
```

---

### Task 12: Implement SSH config hardening task (critical, runs last)

**Files:**
- Create: `src/tasks/ssh-config.ts`

- [ ] **Step 1: Write SSH config task**

Write `src/tasks/ssh-config.ts`:
```typescript
import type { HardeningTask } from "../types.js"

export const runHardenSshConfig: HardeningTask = async (ssh, options, server) => {
  const hasChanges = options.changeSshPort || options.disablePasswordAuth || options.configureCoolify || options.createSudoUser
  if (!hasChanges) {
    return {
      name: "SSH Hardening",
      success: true,
      message: "Skipped (no SSH changes requested)",
    }
  }

  const sshPort = options.changeSshPort && options.newSshPort ? options.newSshPort : 22
  const date = new Date().toISOString().split("T")[0] ?? "unknown"

  // Determine PermitRootLogin value
  let permitRootLogin: string
  if (options.configureCoolify) {
    permitRootLogin = "prohibit-password"
  } else if (options.createSudoUser) {
    permitRootLogin = "no"
  } else if (server.isRoot) {
    permitRootLogin = "prohibit-password"
  } else {
    permitRootLogin = "no"
  }

  const passwordAuth = options.disablePasswordAuth ? "no" : "yes"

  // Step 1: Write config
  const configContent = [
    `# SecurBuntu SSH Hardening - generated on ${date}`,
    `Port ${sshPort}`,
    `PermitRootLogin ${permitRootLogin}`,
    `PasswordAuthentication ${passwordAuth}`,
    "PubkeyAuthentication yes",
    "AuthorizedKeysFile .ssh/authorized_keys",
    "X11Forwarding no",
    "MaxAuthTries 5",
  ].join("\n")

  const configPath = "/etc/ssh/sshd_config.d/01-securbuntu.conf"
  await ssh.writeFile(configPath, configContent)

  // Step 2: Handle cloud-init conflict
  const cloudInitPath = "/etc/ssh/sshd_config.d/50-cloud-init.conf"
  let cloudInitBackedUp = false

  if (server.hasCloudInit) {
    // Backup first
    await ssh.exec(`cp '${cloudInitPath}' '${cloudInitPath}.securbuntu-backup'`)
    cloudInitBackedUp = true

    // Comment out conflicting directives
    await ssh.exec(
      `sed -i 's/^\\(PasswordAuthentication\\)/# Disabled by SecurBuntu: \\1/' '${cloudInitPath}' && ` +
      `sed -i 's/^\\(PermitRootLogin\\)/# Disabled by SecurBuntu: \\1/' '${cloudInitPath}'`,
    )
  }

  // Step 3: Validate config
  const validateResult = await ssh.exec("sshd -t -f /etc/ssh/sshd_config")
  if (validateResult.exitCode !== 0) {
    // Rollback
    await ssh.exec(`rm -f '${configPath}'`)
    if (cloudInitBackedUp) {
      await ssh.exec(`mv '${cloudInitPath}.securbuntu-backup' '${cloudInitPath}'`)
    }
    return {
      name: "SSH Hardening",
      success: false,
      message: "SSH config validation failed — changes rolled back",
      details: validateResult.stderr,
    }
  }

  // Step 4: Restart SSH
  const restartResult = await ssh.exec("systemctl restart ssh.service")
  if (restartResult.exitCode !== 0) {
    // Try rollback and restart
    await ssh.exec(`rm -f '${configPath}'`)
    if (cloudInitBackedUp) {
      await ssh.exec(`mv '${cloudInitPath}.securbuntu-backup' '${cloudInitPath}'`)
    }
    await ssh.exec("systemctl restart ssh.service")
    return {
      name: "SSH Hardening",
      success: false,
      message: "SSH restart failed — config rolled back",
      details: restartResult.stderr,
    }
  }

  // If socket activation and port changed, also reload socket
  if (server.usesSocketActivation && options.changeSshPort) {
    await ssh.exec("systemctl daemon-reload && systemctl restart ssh.socket")
  }

  // Step 5: Verify connectivity
  const verifyResult = await ssh.exec("echo ok")
  if (verifyResult.stdout !== "ok") {
    return {
      name: "SSH Hardening",
      success: true,
      message: `SSH hardened but connection lost. Reconnect with: ssh -p ${sshPort} <user>@<host>`,
      details: "ControlMaster session may have ended after SSH restart.",
    }
  }

  // Clean up cloud-init backup only after everything succeeded
  if (cloudInitBackedUp) {
    await ssh.exec(`rm -f '${cloudInitPath}.securbuntu-backup'`)
  }

  const details = [
    `Port: ${sshPort}`,
    `PermitRootLogin: ${permitRootLogin}`,
    `PasswordAuthentication: ${passwordAuth}`,
  ].join(", ")

  return {
    name: "SSH Hardening",
    success: true,
    message: "SSH configuration hardened",
    details,
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/tasks/ssh-config.ts
git commit -m "feat: add SSH config hardening task with rollback and version adaptation"
```

---

## Chunk 5: Task Orchestrator, Report, and Entry Point

### Task 13: Implement task orchestrator

**Files:**
- Create: `src/tasks/index.ts`

- [ ] **Step 1: Write task orchestrator**

Write `src/tasks/index.ts`:
```typescript
import { spinner } from "@clack/prompts"
import type { HardeningOptions, ServerInfo, SshClient, TaskResult } from "../types.js"
import { runCreateUser } from "./user.js"
import { runInjectSshKeys } from "./ssh-keys.js"
import { runConfigureUfw } from "./ufw.js"
import { runConfigureFail2ban } from "./fail2ban.js"
import { runConfigureUnattended } from "./unattended.js"
import { runHardenSshConfig } from "./ssh-config.js"

interface TaskEntry {
  label: string
  run: (ssh: SshClient, options: HardeningOptions, server: ServerInfo) => Promise<TaskResult>
}

// System update is NOT in this list — it runs before the questionnaire in index.ts
const TASKS: TaskEntry[] = [
  { label: "Creating sudo user", run: runCreateUser },
  { label: "Injecting SSH keys", run: runInjectSshKeys },
  { label: "Configuring UFW firewall", run: runConfigureUfw },
  { label: "Configuring Fail2ban", run: runConfigureFail2ban },
  { label: "Configuring automatic updates", run: runConfigureUnattended },
  { label: "Hardening SSH configuration", run: runHardenSshConfig },
]

export async function executeTasks(
  ssh: SshClient,
  options: HardeningOptions,
  server: ServerInfo,
): Promise<TaskResult[]> {
  const results: TaskResult[] = []
  const s = spinner()

  for (const task of TASKS) {
    s.start(task.label)
    try {
      const result = await task.run(ssh, options, server)
      if (result.message.startsWith("Skipped")) {
        s.stop(`${task.label} — skipped`)
      } else if (result.success) {
        s.stop(`${task.label} — done`)
      } else {
        s.stop(`${task.label} — failed: ${result.message}`)
      }
      results.push(result)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error"
      s.stop(`${task.label} — error: ${message}`)
      results.push({
        name: task.label,
        success: false,
        message,
      })
    }
  }

  return results
}
```

- [ ] **Step 2: Commit**

```bash
git add src/tasks/index.ts
git commit -m "feat: add task orchestrator with sequential spinner execution"
```

---

### Task 14: Implement report module

**Files:**
- Create: `src/report.ts`

- [ ] **Step 1: Write report module**

Write `src/report.ts`:
```typescript
import pc from "picocolors"
import { note } from "@clack/prompts"
import { writeFileSync } from "fs"
import type { Report } from "./types.js"

export function displayReport(report: Report): void {
  const lines: string[] = []

  lines.push(`${pc.bold("Server:")} ${report.serverIp}`)
  lines.push(`${pc.bold("User:")} ${report.connectionUser}`)
  if (report.sudoUser) {
    lines.push(`${pc.bold("New sudo user:")} ${pc.cyan(report.sudoUser)}`)
  }
  lines.push(`${pc.bold("Ubuntu:")} ${report.ubuntuVersion}`)
  lines.push(`${pc.bold("Date:")} ${report.date}`)
  lines.push("")

  for (const result of report.results) {
    const icon = result.success ? pc.green("✓") : pc.red("✗")
    lines.push(`${icon} ${pc.bold(result.name)}: ${result.message}`)
    if (result.details) {
      lines.push(`  ${pc.dim(result.details)}`)
    }
  }

  if (report.newSshPort) {
    lines.push("")
    lines.push(pc.yellow(pc.bold(`⚠  SSH port changed to ${report.newSshPort}`)))
    const user = report.sudoUser ?? report.connectionUser
    lines.push(pc.cyan(`   ssh -p ${report.newSshPort} ${user}@${report.serverIp}`))
  }

  note(lines.join("\n"), "SecurBuntu Report")
}

export function exportReportMarkdown(report: Report): string {
  const sanitizedIp = report.serverIp.replace(/:/g, "-")
  const filename = `securbuntu-report-${sanitizedIp}-${report.date}.md`

  const lines: string[] = []
  lines.push("# SecurBuntu Hardening Report")
  lines.push("")
  lines.push(`| Field | Value |`)
  lines.push(`|-------|-------|`)
  lines.push(`| Server | ${report.serverIp} |`)
  lines.push(`| User | ${report.connectionUser} |`)
  if (report.sudoUser) {
    lines.push(`| New Sudo User | ${report.sudoUser} |`)
  }
  lines.push(`| Ubuntu | ${report.ubuntuVersion} |`)
  lines.push(`| Date | ${report.date} |`)
  if (report.newSshPort) {
    lines.push(`| New SSH Port | ${report.newSshPort} |`)
  }
  lines.push("")
  lines.push("## Tasks")
  lines.push("")

  for (const result of report.results) {
    const icon = result.success ? "✅" : "❌"
    lines.push(`### ${icon} ${result.name}`)
    lines.push("")
    lines.push(result.message)
    if (result.details) {
      lines.push("")
      lines.push(`> ${result.details}`)
    }
    lines.push("")
  }

  if (report.newSshPort) {
    lines.push("## Important")
    lines.push("")
    const user = report.sudoUser ?? report.connectionUser
    lines.push(`SSH port has been changed. Use this command to connect:`)
    lines.push("")
    lines.push("```bash")
    lines.push(`ssh -p ${report.newSshPort} ${user}@${report.serverIp}`)
    lines.push("```")
    lines.push("")
  }

  lines.push("---")
  lines.push("*Generated by SecurBuntu*")

  const content = lines.join("\n")
  writeFileSync(filename, content, "utf-8")
  return filename
}
```

- [ ] **Step 2: Commit**

```bash
git add src/report.ts
git commit -m "feat: add terminal report display and Markdown export"
```

---

### Task 15: Implement main entry point

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Write entry point**

Write `src/index.ts`:
```typescript
#!/usr/bin/env bun
import { outro, log, spinner } from "@clack/prompts"
import pc from "picocolors"
import { showBanner, initVersion } from "./ui.js"
import { connect, detectServerInfo } from "./ssh.js"
import { promptConnection, promptHardeningOptions, promptConfirmation, promptExportReport } from "./prompts.js"
import { executeTasks } from "./tasks/index.js"
import { displayReport, exportReportMarkdown } from "./report.js"
import type { Report } from "./types.js"

async function main(): Promise<void> {
  await initVersion()
  showBanner()

  // 1. Connection prompts
  const connectionConfig = await promptConnection()

  // 2. Connect via SSH
  const s = spinner()
  s.start(`Connecting to ${connectionConfig.host}...`)

  let ssh
  try {
    ssh = await connect(connectionConfig)
    s.stop(`Connected to ${pc.green(connectionConfig.host)}`)
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error"
    s.stop(pc.red(`Connection failed: ${msg}`))
    log.error(
      `${pc.bold("Troubleshooting:")}\n` +
      `  ${pc.dim("• Verify the IP address and port")}\n` +
      `  ${pc.dim("• Check that SSH is running on the server")}\n` +
      `  ${pc.dim("• Verify your credentials (key path or password)")}\n` +
      `  ${pc.dim("• Check network connectivity")}`,
    )
    process.exit(1)
  }

  try {
    // 3. Detect server info
    s.start("Detecting server configuration...")
    const serverInfo = await detectServerInfo(ssh)
    s.stop(`Detected Ubuntu ${pc.cyan(serverInfo.ubuntuVersion)} (${serverInfo.ubuntuCodename})`)

    if (serverInfo.usesSocketActivation) {
      log.info(pc.dim("SSH socket activation detected (Ubuntu 24.04+ mode)"))
    }

    // 4. System update (unconditional)
    s.start("Updating system packages (this may take a while)...")
    const updateResult = await ssh.exec("DEBIAN_FRONTEND=noninteractive apt update && DEBIAN_FRONTEND=noninteractive apt upgrade -y")
    if (updateResult.exitCode !== 0) {
      s.stop(pc.yellow("System update completed with warnings"))
      log.warning(pc.dim(updateResult.stderr))
    } else {
      s.stop("System packages updated")
    }

    // 5. Interactive questionnaire
    const options = await promptHardeningOptions(serverInfo, ssh)

    // 6. Confirmation
    const confirmed = await promptConfirmation(connectionConfig.host, options)
    if (!confirmed) {
      outro(pc.dim("Aborted. No changes were made (except system update)."))
      ssh.close()
      return
    }

    // 7. Execute hardening tasks (skip update — already done)
    const skipUpdateOptions = { ...options }
    const results = await executeTasks(ssh, skipUpdateOptions, serverInfo)

    // Add the update result to the beginning
    results.unshift({
      name: "System Update",
      success: updateResult.exitCode === 0,
      message: updateResult.exitCode === 0 ? "System packages updated" : "Completed with warnings",
    })

    // 8. Report
    const report: Report = {
      serverIp: connectionConfig.host,
      connectionUser: connectionConfig.username,
      sudoUser: options.createSudoUser ? options.sudoUsername : undefined,
      date: new Date().toISOString().split("T")[0] ?? "",
      ubuntuVersion: serverInfo.ubuntuVersion,
      results,
      newSshPort: options.changeSshPort ? options.newSshPort : undefined,
    }

    displayReport(report)

    const wantExport = await promptExportReport()
    if (wantExport) {
      const filename = exportReportMarkdown(report)
      log.success(`Report saved to ${pc.cyan(filename)}`)
    }

    outro(pc.green(pc.bold("Server hardening complete!")))
  } finally {
    ssh.close()
  }
}

main().catch((error) => {
  console.error(pc.red("Fatal error:"), error instanceof Error ? error.message : error)
  process.exit(1)
})
```

- [ ] **Step 2: Make entry point executable**

Run: `chmod +x src/index.ts`

- [ ] **Step 3: Verify full project compiles**

Run: `bun build --no-bundle src/index.ts --outdir /tmp/typecheck 2>&1`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: add main entry point orchestrating full SecurBuntu workflow"
```

---

## Chunk 6: Final Verification

### Task 16: Final verification and run

- [ ] **Step 1: Verify all files exist**

Run: `ls -la src/ src/tasks/`
Expected: all planned files present

- [ ] **Step 2: Verify project compiles cleanly**

Run: `bun build --no-bundle src/index.ts --outdir /tmp/typecheck 2>&1`
Expected: no errors

- [ ] **Step 3: Test dry run (no server needed)**

Run: `bun run src/index.ts`
Expected: banner displays, connection prompts appear. Ctrl+C to exit.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: finalize SecurBuntu CLI v1.0.0"
```
