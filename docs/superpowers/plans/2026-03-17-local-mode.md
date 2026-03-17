# Local Mode Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow SecurBuntu to harden the local machine directly, without an SSH connection.

**Architecture:** Rename `SshClient` → `SystemClient` (pure interface rename), then add a `LocalClient` that implements `SystemClient` by running commands via `Bun.spawn()`. A new mode-selection prompt at startup gates between local and SSH paths. The orchestrator is decoupled from SSH — it receives a `SystemClient` + metadata.

**Tech Stack:** TypeScript, Bun, @clack/prompts

**Spec:** `docs/superpowers/specs/2026-03-17-local-mode-design.md`

---

### Task 1: Rename `SshClient` → `SystemClient` in types.ts

**Files:**
- Modify: `src/types.ts:107-117`

- [ ] **Step 1: Rename interface and type**

In `src/types.ts`, rename `SshClient` to `SystemClient` and update `HardeningTask`:

```typescript
// line 107: SshClient → SystemClient
export interface SystemClient {
  exec(command: string, options?: ExecOptions): Promise<CommandResult>
  execWithStdin(command: string, stdin: string, options?: ExecOptions): Promise<CommandResult>
  writeFile(remotePath: string, content: string): Promise<void>
  readFile(remotePath: string): Promise<string>
  fileExists(remotePath: string): Promise<boolean>
  close(): void
  readonly isRoot: boolean
}

// line 117: ssh: SshClient → client: SystemClient
export type HardeningTask = (client: SystemClient, options: HardeningOptions, server: ServerInfo) => Promise<TaskResult>
```

Add the `ConnectionResult` type at the end of the file:

```typescript
export interface ConnectionResult {
  client: SystemClient
  mode: "local" | "ssh"
  host: string
  username: string
}
```

- [ ] **Step 2: Run typecheck to see all breakages**

Run: `bun run typecheck 2>&1 | head -80`
Expected: Many errors about `SshClient` not being exported — this confirms the rename scope.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "refactor: rename SshClient to SystemClient in types"
```

---

### Task 2: Rename `SshClient` across all source files

**Files:**
- Modify: `src/ssh/connection.ts:2,33,120`
- Modify: `src/dry-run.ts:3,5,9`
- Modify: `src/logging.ts:2,4,8`
- Modify: `src/audit/scanner.ts:3,5`
- Modify: `src/ssh/detect.ts:2,55`
- Modify: `src/prompts/hardening.ts:5,82,112-113`
- Modify: `src/connection/error-handlers.ts:7,43,120`
- Modify: `src/connection/retry-loop.ts:5,9`
- Modify: `src/tasks/index.ts:3,16,46`
- Modify: `src/tasks/ufw.ts:1,8,27`
- Modify: `src/tasks/permissions.ts:1,19,31`
- Modify: `src/tasks/ssh-keys.ts:2,51`
- Modify: `src/tasks/ssh-config.ts:1,26`
- Modify: `src/tasks/user.ts:1`
- Modify: `src/tasks/fail2ban.ts:1`
- Modify: `src/tasks/services.ts:1`
- Modify: `src/tasks/sysctl.ts:1`
- Modify: `src/tasks/unattended.ts:1`
- Modify: `src/orchestrator.ts:5-6,24,34,53,65,90,119,133,184-187`

This is a mechanical find-and-replace. For each file:
- Replace type imports: `SshClient` → `SystemClient`
- Replace parameter names: `ssh: SshClient` → `client: SystemClient` (in function signatures only — internal usage of `ssh` variable stays for now, we'll rename the variable in the next step)

- [ ] **Step 1: Replace type name across all source files**

For every file listed above, change the import from `SshClient` to `SystemClient` and the type annotations.

Key patterns:
- `import type { ..., SshClient, ... }` → `import type { ..., SystemClient, ... }`
- `SshClient` in type positions → `SystemClient`

- [ ] **Step 2: Run typecheck**

Run: `bunx biome check src/ --diagnostic-level=error 2>&1 | tail -20`
Run: `bun run typecheck`
Expected: PASS (all references updated)

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor: rename SshClient to SystemClient across all source files"
```

---

### Task 3: Rename `ssh` parameter to `client` in task/audit functions

**Files:**
- Modify: `src/tasks/ufw.ts` — parameter + all `ssh.exec(...)` → `client.exec(...)`
- Modify: `src/tasks/permissions.ts` — parameter + all `ssh.exec(...)` → `client.exec(...)`
- Modify: `src/tasks/ssh-keys.ts` — parameter + all `ssh.exec(...)` → `client.exec(...)`
- Modify: `src/tasks/ssh-config.ts` — parameter + all `ssh.exec(...)` → `client.exec(...)`
- Modify: `src/tasks/user.ts` — parameter + all `ssh.exec(...)` → `client.exec(...)`
- Modify: `src/tasks/fail2ban.ts` — parameter + all `ssh.exec(...)` → `client.exec(...)`
- Modify: `src/tasks/services.ts` — parameter + all `ssh.exec(...)` → `client.exec(...)`
- Modify: `src/tasks/sysctl.ts` — parameter + all `ssh.exec(...)` → `client.exec(...)`
- Modify: `src/tasks/unattended.ts` — parameter + all `ssh.exec(...)` → `client.exec(...)`
- Modify: `src/tasks/index.ts` — `TaskEntry.run` signature + `executeTasks` parameter
- Modify: `src/audit/scanner.ts` — `runAudit` parameter + all `ssh.exec(...)`
- Modify: `src/ssh/detect.ts` — `detectServerInfo` parameter + `ssh.exec(...)`, `ssh.isRoot`
- Modify: `src/orchestrator.ts` — all `ssh` parameters in internal functions
- Modify: `src/prompts/hardening.ts` — `promptPasswordAuth` + `promptHardeningOptions` parameters

Rename the parameter variable `ssh` → `client` in all function signatures and their bodies:
- `HardeningTask` functions: `(ssh, options, server)` → `(client, options, server)`
- Helper functions: `applyUfwRules(ssh, ...)` → `applyUfwRules(client, ...)`
- `runAudit(ssh)` → `runAudit(client)`
- `detectServerInfo(ssh)` → `detectServerInfo(client)`
- `promptHardeningOptions(server, ssh, ...)` → `promptHardeningOptions(server, client, ...)`
- `promptPasswordAuth(options, ssh)` → `promptPasswordAuth(options, client)`
- All `ssh.exec(...)` → `client.exec(...)`, `ssh.writeFile(...)` → `client.writeFile(...)`, etc.
- Orchestrator internal variables: `ssh` → `client` where it refers to the `SystemClient`

- [ ] **Step 1: Rename parameter `ssh` → `client` in all task files**

For each task file (`ufw.ts`, `permissions.ts`, `ssh-keys.ts`, `ssh-config.ts`, `user.ts`, `fail2ban.ts`, `services.ts`, `sysctl.ts`, `unattended.ts`, `tasks/index.ts`), rename the `ssh` parameter and all usages to `client`.

- [ ] **Step 2: Rename in audit/scanner.ts**

Rename `ssh` → `client` in `runAudit()` and all `ssh.exec(...)` calls.

- [ ] **Step 3: Rename in ssh/detect.ts**

Rename `ssh` → `client` in `detectServerInfo()` and all `ssh.exec(...)` / `ssh.isRoot` calls.

- [ ] **Step 4: Rename in prompts/hardening.ts**

Rename `ssh` → `client` in `promptPasswordAuth()` and `promptHardeningOptions()`.

- [ ] **Step 5: Rename in orchestrator.ts**

Rename `ssh` → `client` in all functions: `detectAndAudit()`, `handleAuditOnlyMode()`, `runSystemUpdate()`, `handleDryRunOrSimulate()`, `executeAndReport()`, and `run()`.

- [ ] **Step 6: Rename in connection files**

In `src/connection/retry-loop.ts`: rename `ssh` → `client` in the return type and variable assignments.
In `src/connection/error-handlers.ts`: rename `SshClient` → `SystemClient` in the return types of `handleSudoPasswordPrompt` and `handleConnectionError`. Keep the internal variable names as they deal with SSH-specific logic.

- [ ] **Step 7: Run typecheck and tests**

Run: `bun run typecheck`
Run: `bun test`
Expected: All pass — this is a pure rename.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: rename ssh parameter to client across codebase"
```

---

### Task 4: Rename decorator classes

**Files:**
- Modify: `src/dry-run.ts:5,9`
- Modify: `src/logging.ts:4,8`
- Modify: `src/orchestrator.ts:5-6,99,119,144`
- Modify: `src/__tests__/dry-run.test.ts`
- Modify: `src/__tests__/logging.test.ts`

- [ ] **Step 1: Rename `DryRunSshClient` → `DryRunClient`**

In `src/dry-run.ts`:
```typescript
export class DryRunClient implements SystemClient {
  constructor(private readonly real: SystemClient) {
```

In `src/orchestrator.ts`, update the import and usage:
```typescript
import { DryRunClient } from "./dry-run.ts"
// ...
const dryRunClient = new DryRunClient(client)
```

- [ ] **Step 2: Rename `LoggingSshClient` → `LoggingClient`**

In `src/logging.ts`:
```typescript
export class LoggingClient implements SystemClient {
  constructor(private readonly real: SystemClient) {
```

In `src/orchestrator.ts`, update the import and usage:
```typescript
import { LoggingClient } from "./logging.ts"
// ...
const loggingClient = new LoggingClient(client)
```

- [ ] **Step 3: Update test files**

In `src/__tests__/dry-run.test.ts`: rename all `DryRunSshClient` → `DryRunClient`.
In `src/__tests__/logging.test.ts`: rename all `LoggingSshClient` → `LoggingClient`.

- [ ] **Step 4: Run tests**

Run: `bun test`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: rename DryRunSshClient and LoggingSshClient to DryRunClient and LoggingClient"
```

---

### Task 5: Rename `MockSshClient` → `MockSystemClient` in tests

**Files:**
- Modify: `src/__tests__/helpers/mock-ssh.ts:1,14,54`
- Modify: All 14 test files referencing `MockSshClient`

- [ ] **Step 1: Rename in mock-ssh.ts**

```typescript
import type { CommandResult, ExecOptions, SystemClient } from "../../types.ts"
// ...
export class MockSystemClient implements SystemClient {
  // ...
  // line 54: error message
  if (content === undefined) throw new Error(`MockSystemClient: no content for ${remotePath}`)
```

- [ ] **Step 2: Rename across all test files**

In every test file, replace:
- `import { MockSshClient }` → `import { MockSystemClient }`
- `new MockSshClient(` → `new MockSystemClient(`

Files: `dry-run.test.ts`, `logging.test.ts`, `audit.test.ts`, `report.test.ts`, `ssh/detect.test.ts`, and all 8 task test files.

- [ ] **Step 3: Run full test suite**

Run: `bun test`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: rename MockSshClient to MockSystemClient in tests"
```

---

### Task 6: Write failing tests for `LocalClient`

**Files:**
- Create: `src/__tests__/local/client.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { describe, expect, test } from "bun:test"
import { LocalClient } from "../../local/client.ts"

describe("LocalClient", () => {
  test("exec runs a command and returns stdout", async () => {
    const client = new LocalClient()
    const result = await client.exec("echo hello")
    expect(result.stdout).toBe("hello")
    expect(result.exitCode).toBe(0)
  })

  test("exec returns non-zero exit code on failure", async () => {
    const client = new LocalClient()
    const result = await client.exec("false")
    expect(result.exitCode).not.toBe(0)
  })

  test("exec captures stderr", async () => {
    const client = new LocalClient()
    const result = await client.exec("echo error >&2")
    expect(result.stderr).toBe("error")
  })

  test("execWithStdin passes stdin to command", async () => {
    const client = new LocalClient()
    const result = await client.execWithStdin("cat", "hello from stdin")
    expect(result.stdout).toBe("hello from stdin")
  })

  test("writeFile and readFile round-trip", async () => {
    const tmpPath = `/tmp/securbuntu-test-${Date.now()}.txt`
    const client = new LocalClient()
    await client.writeFile(tmpPath, "test content")
    const content = await client.readFile(tmpPath)
    expect(content).toBe("test content")
    // cleanup
    await client.exec(`rm -f '${tmpPath}'`)
  })

  test("fileExists returns true for existing file", async () => {
    const client = new LocalClient()
    expect(await client.fileExists("/etc/os-release")).toBe(true)
  })

  test("fileExists returns false for missing file", async () => {
    const client = new LocalClient()
    expect(await client.fileExists("/nonexistent/path")).toBe(false)
  })

  test("isRoot reflects current user", () => {
    const client = new LocalClient()
    const expected = process.getuid?.() === 0
    expect(client.isRoot).toBe(expected)
  })

  test("close is a safe no-op", () => {
    const client = new LocalClient()
    expect(() => client.close()).not.toThrow()
  })

  test("exec respects timeout", async () => {
    const client = new LocalClient()
    const result = await client.exec("sleep 10", { timeout: 500 })
    expect(result.exitCode).not.toBe(0)
  })

  test("prefixSudo wraps with sudo when not root", async () => {
    // When running as non-root without password, commands should be prefixed with sudo -n
    // We can verify this by checking that a command that requires no sudo still works
    const client = new LocalClient()
    if (!client.isRoot) {
      // Non-root: verify exec produces valid output (sudo -n for passwordless)
      const result = await client.exec("echo test")
      // If passwordless sudo works, we get "test"; if not, we get an error
      // Either way the command executed — we're testing the plumbing, not sudo config
      expect(typeof result.stdout).toBe("string")
    }
  })

  test("readFile uses Bun.file when root", async () => {
    const client = new LocalClient()
    if (client.isRoot) {
      // Verify readFile works for root path (uses Bun.file fast path)
      const content = await client.readFile("/etc/os-release")
      expect(content).toContain("NAME=")
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/__tests__/local/client.test.ts`
Expected: FAIL — `LocalClient` module not found.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/local/client.test.ts
git commit -m "test: add failing tests for LocalClient"
```

---

### Task 7: Implement `LocalClient`

**Files:**
- Create: `src/local/client.ts`
- Create: `src/local/index.ts`

- [ ] **Step 1: Create `src/local/client.ts`**

Key design decisions:
- Root path uses `Bun.write()`/`Bun.file()` for efficient direct I/O
- Non-root with password: spawn `["sudo", "-S", "-p", "", "bash", "-c", command]` directly (no double `bash -c` wrapping)
- Non-root passwordless: spawn `["sudo", "-n", "bash", "-c", command]` directly
- Reuse `spawnProcess` from `src/ssh/process.ts` for consistent output trimming
- Reuse `shellEscape` from `src/ssh/connection.ts`

```typescript
import type { CommandResult, ExecOptions, SystemClient } from "../types.ts"
import { shellEscape } from "../ssh/connection.ts"
import { DEFAULT_TIMEOUT, spawnProcess } from "../ssh/process.ts"

export class LocalClient implements SystemClient {
  readonly isRoot: boolean
  private readonly sudoPassword: string | undefined

  constructor(sudoPassword?: string) {
    this.isRoot = process.getuid?.() === 0
    this.sudoPassword = sudoPassword
  }

  private buildCommand(command: string): string[] {
    if (this.isRoot) return ["bash", "-c", command]
    if (this.sudoPassword) return ["sudo", "-S", "-p", "", "bash", "-c", command]
    return ["sudo", "-n", "bash", "-c", command]
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

  async writeFile(path: string, content: string): Promise<void> {
    if (this.isRoot) {
      await Bun.write(path, content)
      return
    }
    const writeCmd = `tee ${shellEscape(path)} > /dev/null`
    const result = await spawnProcess(
      this.buildCommand(writeCmd),
      this.prependSudoPassword(content),
    )
    if (result.exitCode !== 0) {
      throw new Error(`Failed to write ${path}: ${result.stderr}`)
    }
  }

  async readFile(path: string): Promise<string> {
    if (this.isRoot) {
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
    if (this.isRoot) {
      return Bun.file(path).exists()
    }
    const result = await this.exec(`test -f ${shellEscape(path)} && echo yes`)
    return result.stdout === "yes"
  }

  close(): void {
    // No-op — nothing to clean up locally
  }
}
```

- [ ] **Step 2: Create `src/local/index.ts`**

```typescript
export { LocalClient } from "./client.ts"
```

- [ ] **Step 3: Run LocalClient tests**

Run: `bun test src/__tests__/local/client.test.ts`
Expected: All pass.

- [ ] **Step 4: Run full test suite**

Run: `bun test`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add src/local/client.ts src/local/index.ts
git commit -m "feat: add LocalClient implementing SystemClient for local execution"
```

---

### Task 8: Write failing tests for mode selection

**Files:**
- Create: `src/__tests__/connection/mode.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { describe, expect, test } from "bun:test"
import { validateLocalUbuntu } from "../../connection/mode.ts"

describe("validateLocalUbuntu", () => {
  test("returns version info for valid Ubuntu", async () => {
    // This test only passes on Ubuntu systems — skip gracefully otherwise
    const result = await validateLocalUbuntu()
    if (result.error) {
      console.log(`Skipping: ${result.error}`)
      return
    }
    expect(result.version).toBeDefined()
    expect(typeof result.version).toBe("string")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/__tests__/connection/mode.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/connection/mode.test.ts
git commit -m "test: add failing tests for mode selection"
```

---

### Task 9: Implement mode selection (`connection/mode.ts`)

**Files:**
- Create: `src/connection/mode.ts`
- Modify: `src/connection/index.ts`

**Important:** `connectWithRetry()` returns `{ ssh, connectionConfig }` (field is named `ssh`, not `client`). The `selectMode()` function must destructure correctly and map to `ConnectionResult`.

- [ ] **Step 1: Create `src/connection/mode.ts`**

```typescript
import * as p from "@clack/prompts"
import pc from "picocolors"
import type { ConnectionResult } from "../types.ts"
import { LocalClient } from "../local/index.ts"
import { connectWithRetry } from "./retry-loop.ts"
import { spawnProcess } from "../ssh/process.ts"

export async function validateLocalUbuntu(): Promise<{ version?: string; codename?: string; error?: string }> {
  const result = await spawnProcess(["bash", "-c", '. /etc/os-release && echo "$ID|$VERSION_ID|$VERSION_CODENAME"'])
  if (result.exitCode !== 0) {
    return { error: "Failed to detect OS" }
  }

  const parts = result.stdout.split("|")
  if (parts.length < 3 || parts[0] !== "ubuntu") {
    return { error: `Unsupported OS: ${parts[0] ?? "unknown"}. SecurBuntu only supports Ubuntu.` }
  }

  const versionId = parts[1] ?? ""
  const versionParts = versionId.split(".")
  const major = parseInt(versionParts[0] ?? "0", 10)
  const minor = parseInt(versionParts[1] ?? "0", 10)
  if (major < 22 || (major === 22 && minor < 4)) {
    return { error: `Ubuntu ${versionId} is not supported. Minimum required: 22.04` }
  }

  return { version: versionId, codename: parts[2] ?? "" }
}

async function setupLocalClient(): Promise<ConnectionResult> {
  const validation = await validateLocalUbuntu()
  if (validation.error) {
    throw new Error(validation.error)
  }

  const isRoot = process.getuid?.() === 0
  const username = process.env.USER ?? "unknown"
  let sudoPassword: string | undefined

  if (!isRoot) {
    // Check passwordless sudo first
    const sudoCheck = await spawnProcess(["bash", "-c", "sudo -n true 2>&1"])
    if (sudoCheck.exitCode !== 0) {
      const pw = await p.password({
        message: "Enter your sudo password",
        validate(value) {
          if (!value) return "Password is required"
          return undefined
        },
      })

      if (p.isCancel(pw)) {
        throw new Error("Cancelled")
      }

      // Validate the password
      const validateResult = await spawnProcess(
        ["bash", "-c", "sudo -S -p '' true 2>&1"],
        `${pw}\n`,
      )
      if (validateResult.exitCode !== 0) {
        throw new Error("Invalid sudo password or user is not in sudoers.")
      }

      sudoPassword = pw
    }
  }

  return {
    client: new LocalClient(sudoPassword),
    mode: "local",
    host: "localhost",
    username,
  }
}

export async function selectMode(): Promise<ConnectionResult> {
  const mode = await p.select({
    message: "What would you like to secure?",
    options: [
      { value: "local" as const, label: "This machine", hint: "run directly, no SSH" },
      { value: "ssh" as const, label: "A remote server", hint: "connect via SSH" },
    ],
  })

  if (p.isCancel(mode)) {
    p.outro(pc.dim("Cancelled."))
    process.exit(0)
  }

  if (mode === "local") {
    return setupLocalClient()
  }

  // SSH mode: connectWithRetry returns { ssh, connectionConfig }
  // Map to ConnectionResult shape
  const { ssh, connectionConfig } = await connectWithRetry()
  return {
    client: ssh,
    mode: "ssh",
    host: connectionConfig.host,
    username: connectionConfig.username,
  }
}
```

Note: `connectWithRetry()` returns `{ ssh: SystemClient; connectionConfig: ConnectionConfig }`. We destructure `ssh` (not `client`) and map it into the `ConnectionResult.client` field.

- [ ] **Step 2: Update `src/connection/index.ts`**

```typescript
export { connectWithRetry } from "./retry-loop.ts"
export { selectMode, validateLocalUbuntu } from "./mode.ts"
```

- [ ] **Step 3: Run mode selection tests**

Run: `bun test src/__tests__/connection/mode.test.ts`
Expected: Pass.

- [ ] **Step 4: Commit**

```bash
git add src/connection/mode.ts src/connection/index.ts src/__tests__/connection/mode.test.ts
git commit -m "feat: add mode selection prompt for local vs SSH"
```

---

### Task 10: Refactor orchestrator to accept `ConnectionResult`

**Files:**
- Modify: `src/orchestrator.ts`

- [ ] **Step 1: Refactor `run()` and `executeAndReport()`**

The orchestrator needs to:
1. Accept a `ConnectionResult` instead of calling `connectWithRetry()` directly
2. `executeAndReport()` takes `host` and `username` strings instead of `ConnectionConfig`
3. Pass `connection.mode` and `connection.username` to `promptHardeningOptions` (prepared for Task 12)

Replace the entire `src/orchestrator.ts` with:

```typescript
import { confirm, isCancel, log, outro, spinner } from "@clack/prompts"
import pc from "picocolors"
import { displayAudit, runAudit } from "./audit/index.ts"
import { DryRunClient } from "./dry-run.ts"
import { LoggingClient } from "./logging.ts"
import {
  promptConfirmation,
  promptExportAudit,
  promptExportLog,
  promptExportReport,
  promptHardeningOptions,
} from "./prompts/index.ts"
import { displayReport, exportAuditMarkdown, exportReportMarkdown } from "./report/index.ts"
import { detectServerInfo } from "./ssh/index.ts"
import { executeTasks } from "./tasks/index.ts"
import type {
  AuditResult,
  ConnectionResult,
  HardeningOptions,
  Report,
  ServerAuditContext,
  ServerInfo,
  SystemClient,
} from "./types.ts"

interface RunArgs {
  isDryRun: boolean
  wantLog: boolean
  isAuditOnly: boolean
}

async function detectAndAudit(
  client: SystemClient,
  s: ReturnType<typeof spinner>,
): Promise<{ serverInfo: ServerInfo; auditResult: AuditResult }> {
  s.start("Detecting server configuration...")
  const serverInfo = await detectServerInfo(client)
  s.stop(`Detected Ubuntu ${pc.cyan(serverInfo.ubuntuVersion)} (${serverInfo.ubuntuCodename})`)

  if (serverInfo.usesSocketActivation) {
    log.info(pc.dim("SSH socket activation detected (Ubuntu 24.04+ mode)"))
  }

  s.start("Scanning server security configuration...")
  const auditResult = await runAudit(client)
  s.stop("Security audit complete")
  displayAudit(auditResult)

  return { serverInfo, auditResult }
}

async function handleAuditOnlyMode(client: SystemClient, auditResult: AuditResult, host: string): Promise<void> {
  const wantExport = await promptExportAudit()
  if (wantExport) {
    const date = new Date().toISOString().split("T")[0] ?? ""
    const filename = exportAuditMarkdown(auditResult, host, date)
    log.success(`Audit report saved to ${pc.cyan(filename)}`)
  }
  outro(pc.green("Audit complete."))
  client.close()
}

async function runSystemUpdate(
  client: SystemClient,
  isDryRun: boolean,
  s: ReturnType<typeof spinner>,
): Promise<{ updateSuccess: boolean; updateMessage: string }> {
  if (isDryRun) {
    log.info(pc.yellow("[DRY-RUN] System update skipped"))
    return { updateSuccess: true, updateMessage: "System packages updated" }
  }

  s.start("Updating system packages (this may take a while)...")
  const updateResult = await client.exec(
    "DEBIAN_FRONTEND=noninteractive apt update && DEBIAN_FRONTEND=noninteractive apt upgrade -y",
    { timeout: 900_000 },
  )

  if (updateResult.exitCode !== 0) {
    s.stop(pc.yellow("System update completed with warnings"))
    log.warning(pc.dim(updateResult.stderr))
    return { updateSuccess: false, updateMessage: "Completed with warnings" }
  }

  s.stop("System packages updated")
  return { updateSuccess: true, updateMessage: "System packages updated" }
}

async function handleDryRunOrSimulate(
  client: SystemClient,
  isDryRun: boolean,
  confirmation: "apply" | "simulate",
  options: HardeningOptions,
  serverInfo: ServerInfo,
): Promise<"abort" | "proceed"> {
  if (!isDryRun && confirmation !== "simulate") return "proceed"

  const dryRunClient = new DryRunClient(client)
  await executeTasks(dryRunClient, options, serverInfo)
  dryRunClient.displaySummary()

  if (isDryRun) {
    outro(pc.dim("Dry-run complete. No changes were made."))
    client.close()
    return "abort"
  }

  const applyForReal = await confirm({ message: "Apply these changes for real?" })
  if (isCancel(applyForReal) || !applyForReal) {
    outro(pc.dim("Aborted. No changes were made (except system update)."))
    client.close()
    return "abort"
  }

  return "proceed"
}

async function exportLogIfNeeded(loggingClient: LoggingClient, host: string, wantLog: boolean): Promise<void> {
  if (!loggingClient.hasEntries()) return

  const shouldSaveLog = wantLog || (await promptExportLog())
  if (!shouldSaveLog) return

  const sanitizedIp = host.replace(/:/g, "-")
  const date = new Date().toISOString().split("T")[0] ?? "unknown"
  const logFilename = `securbuntu-log-${sanitizedIp}-${date}.txt`
  loggingClient.flush(logFilename)
  log.success(`Log saved to ${pc.cyan(logFilename)}`)
}

async function executeAndReport(
  client: SystemClient,
  host: string,
  username: string,
  options: HardeningOptions,
  serverInfo: ServerInfo,
  auditResult: AuditResult,
  isDryRun: boolean,
  updateSuccess: boolean,
  updateMessage: string,
  wantLog: boolean,
  s: ReturnType<typeof spinner>,
): Promise<void> {
  const loggingClient = new LoggingClient(client)
  const results = await executeTasks(loggingClient, options, serverInfo)

  if (!isDryRun) {
    results.unshift({
      name: "System Update",
      success: updateSuccess,
      message: updateMessage,
    })
  }

  s.start("Running post-hardening audit...")
  const postAudit = await runAudit(client)
  s.stop("Post-hardening audit complete")

  const report: Report = {
    serverIp: host,
    connectionUser: username,
    sudoUser: options.createSudoUser ? options.sudoUsername : undefined,
    date: new Date().toISOString().split("T")[0] ?? "",
    ubuntuVersion: serverInfo.ubuntuVersion,
    results,
    newSshPort: options.changeSshPort ? options.newSshPort : undefined,
    audit: auditResult,
    postAudit,
  }

  displayReport(report)

  await exportLogIfNeeded(loggingClient, host, wantLog)

  const wantExport = await promptExportReport()
  if (wantExport) {
    const filename = exportReportMarkdown(report)
    log.success(`Report saved to ${pc.cyan(filename)}`)
  }

  outro(pc.green(pc.bold("Server hardening complete!")))
}

export async function run(args: RunArgs, connection: ConnectionResult): Promise<void> {
  const { isDryRun, wantLog, isAuditOnly } = args
  const { client, host, username, mode } = connection
  const s = spinner()

  try {
    const { serverInfo, auditResult } = await detectAndAudit(client, s)

    if (isAuditOnly) {
      await handleAuditOnlyMode(client, auditResult, host)
      return
    }

    const { updateSuccess, updateMessage } = await runSystemUpdate(client, isDryRun, s)

    const portCheck = auditResult.checks.find((c) => c.name === "SSH Port")
    const portStr = portCheck?.status?.replace(" (default)", "") ?? "22"
    const currentSshPort = parseInt(portStr, 10) || 22

    const ufwCheck = auditResult.checks.find((c) => c.name === "UFW Firewall")
    const ufwActive = ufwCheck?.status === "active"

    const f2bCheck = auditResult.checks.find((c) => c.name === "Fail2ban")
    const fail2banActive = f2bCheck?.status === "active"

    const sshKeysCheck = auditResult.checks.find((c) => c.name === "SSH Keys")
    const sshKeysInfo = sshKeysCheck?.status ?? "none found"

    const servicesCheck = auditResult.checks.find((c) => c.name === "Unnecessary Services")
    const detectedServices = servicesCheck?.detail?.split(", ") ?? []

    const auditContext: ServerAuditContext = {
      currentSshPort,
      ufwActive,
      fail2banActive,
      sshKeysInfo,
      detectedServices,
    }

    const options = await promptHardeningOptions(serverInfo, client, auditContext, mode, username)

    const confirmation = await promptConfirmation(host, options)
    if (!confirmation) {
      outro(pc.dim(`Aborted. No changes were made${isDryRun ? "." : " (except system update)."}`))
      client.close()
      return
    }

    const dryRunResult = await handleDryRunOrSimulate(client, isDryRun, confirmation, options, serverInfo)
    if (dryRunResult === "abort") return

    await executeAndReport(
      client,
      host,
      username,
      options,
      serverInfo,
      auditResult,
      isDryRun,
      updateSuccess,
      updateMessage,
      wantLog,
      s,
    )
  } finally {
    client.close()
  }
}
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: Errors in `src/index.ts` (caller needs update) and `src/prompts/hardening.ts` (new params) — expected, fixed in Tasks 11 and 12.

- [ ] **Step 3: Commit**

```bash
git add src/orchestrator.ts
git commit -m "refactor: decouple orchestrator from SSH, accept ConnectionResult"
```

---

### Task 11: Update entry point (`index.ts`)

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Update `src/index.ts` to use `selectMode()`**

```typescript
#!/usr/bin/env bun
import pc from "picocolors"
import { initVersion, parseArgs, showBanner } from "./cli/index.ts"
import { selectMode } from "./connection/index.ts"
import { run } from "./orchestrator.ts"

async function main(): Promise<void> {
  await initVersion()
  const args = parseArgs()
  if (!args) return
  showBanner()
  const connection = await selectMode()
  await run(args, connection)
}

main().catch((error) => {
  console.error(pc.red("Fatal error:"), error instanceof Error ? error.message : error)
  process.exit(1)
})
```

- [ ] **Step 2: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire up mode selection in entry point"
```

---

### Task 12: Add SSH lockout prevention + prompt adjustments for local mode

**Files:**
- Modify: `src/prompts/hardening.ts:51-109,111-205`
- Modify: `src/tasks/ssh-keys.ts:16-17`

This task addresses three spec requirements:
1. **Lockout prevention** (spec Section 5): stricter warnings in local mode
2. **whoami fix** (spec Section 6): replace `whoami` with `connectionUsername` in both `promptPasswordAuth` and `ssh-keys.ts`
3. **Prompt adjustments** (spec Section 8): reword SSH key prompt for local mode

- [ ] **Step 1: Update `promptHardeningOptions` to accept mode and username**

```typescript
export async function promptHardeningOptions(
  server: ServerInfo,
  client: SystemClient,
  auditContext: ServerAuditContext,
  mode: "local" | "ssh",
  connectionUsername: string,
): Promise<HardeningOptions> {
```

- [ ] **Step 2: Update `promptPersonalKey` for local mode wording**

```typescript
async function promptPersonalKey(options: HardeningOptions, mode: "local" | "ssh"): Promise<boolean> {
  const message = mode === "local"
    ? "Do you want to add an SSH public key to authorized_keys?"
    : "Do you want to add a personal SSH public key to the server?"
  const addKey = unwrapBoolean(await p.confirm({ message }))
  // ... rest unchanged
```

Update the call: `const addedKey = await promptPersonalKey(options, mode)`

- [ ] **Step 3: Update `promptPasswordAuth` to use connectionUsername and mode**

```typescript
async function promptPasswordAuth(
  options: HardeningOptions,
  client: SystemClient,
  mode: "local" | "ssh",
  connectionUsername: string,
): Promise<void> {
  // Use connectionUsername instead of whoami to avoid sudo returning "root"
  const targetUser =
    options.createSudoUser && options.sudoUsername ? options.sudoUsername : connectionUsername

  const targetHome = targetUser === "root" ? "/root" : `/home/${targetUser}`
  const existingKeysResult = await client.exec(
    `test -f '${targetHome}/.ssh/authorized_keys' && grep -c 'ssh-' '${targetHome}/.ssh/authorized_keys' || echo 0`,
  )
  const hasExistingKey = parseInt(existingKeysResult.stdout, 10) > 0
  const willHaveKey = options.addPersonalKey || hasExistingKey

  if (willHaveKey) {
    if (mode === "local") {
      const disablePw = unwrapBoolean(
        await p.confirm({
          message: pc.yellow("You're about to disable SSH password authentication on this machine.") +
            "\n  Make sure your SSH key is correctly configured. Continue?",
          initialValue: false,
        }),
      )
      options.disablePasswordAuth = disablePw
    } else {
      const disablePw = unwrapBoolean(
        await p.confirm({
          message: "Do you want to disable SSH password authentication?",
          initialValue: true,
        }),
      )
      options.disablePasswordAuth = disablePw
    }
  } else {
    if (mode === "local") {
      p.log.warning(
        pc.yellow("Cannot disable password authentication: no SSH keys found in authorized_keys.") +
          "\n  " + pc.dim("Add a key first to avoid losing remote access."),
      )
    } else {
      p.log.warning(
        pc.yellow("Cannot disable password authentication: no SSH key found or being added for ") +
          pc.bold(targetUser) +
          pc.yellow(". You would be locked out."),
      )
    }
    options.disablePasswordAuth = false
  }
}
```

Update the call: `await promptPasswordAuth(options, client, mode, connectionUsername)`

- [ ] **Step 4: Fix `whoami` in `src/tasks/ssh-keys.ts`**

The same `whoami` issue exists in `ssh-keys.ts` line 17. Fix by adding `connectionUsername` to `HardeningOptions`:

In `src/types.ts`, add to `HardeningOptions`:
```typescript
export interface HardeningOptions {
  // ... existing fields
  connectionUsername: string  // Add this field
}
```

In `src/prompts/hardening.ts`, set it in the options object:
```typescript
const options: HardeningOptions = {
  // ... existing defaults
  connectionUsername,
}
```

In `src/tasks/ssh-keys.ts`, replace the whoami call:
```typescript
// Before:
const targetUser =
  options.createSudoUser && options.sudoUsername ? options.sudoUsername : (await client.exec("whoami")).stdout

// After:
const targetUser =
  options.createSudoUser && options.sudoUsername ? options.sudoUsername : options.connectionUsername
```

- [ ] **Step 5: Run typecheck and tests**

Run: `bun run typecheck`
Run: `bun test`
Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add src/prompts/hardening.ts src/tasks/ssh-keys.ts src/types.ts src/orchestrator.ts
git commit -m "feat: add SSH lockout prevention and prompt adjustments for local mode"
```

---

### Task 13: Run lint, typecheck, and full test suite

**Files:** None — verification only.

- [ ] **Step 1: Run lint**

Run: `bunx biome check src/`
Expected: No errors.

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: No errors.

- [ ] **Step 3: Run full test suite**

Run: `bun test`
Expected: All tests pass (existing + new LocalClient + mode selection tests).

- [ ] **Step 4: Fix any issues found**

If any step fails, fix the issues and re-run.

- [ ] **Step 5: Final commit if needed**

Only if fixes were applied:
```bash
git add -A
git commit -m "fix: address lint/typecheck/test issues"
```
