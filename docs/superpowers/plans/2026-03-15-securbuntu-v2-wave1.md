# SecurBuntu v2 — Wave 1: Security & Robustness Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden SecurBuntu CLI itself with input sanitization, SSH command timeouts, host key verification, and stop-on-failure for task execution.

**Architecture:** Four independent improvements to existing modules. No new files — all changes are in existing `src/` files. Each task is self-contained and can be reviewed independently.

**Tech Stack:** Bun, TypeScript (strict), `@clack/prompts`, `picocolors`, system `ssh`

**Spec:** `docs/superpowers/specs/2026-03-15-securbuntu-v2-improvements.md` (Wave 1 section)

---

## File Map

| File | Changes |
|------|---------|
| `src/types.ts` | Add optional `timeout` parameter to `SshClient.exec()` and `execWithStdin()` |
| `src/ssh.ts` | Add timeout to `spawnSsh()`/`spawnSshpass()`, add `fetchHostKeyFingerprint()` export, change `StrictHostKeyChecking` to `yes` |
| `src/prompts.ts` | Add validation to SSH username prompt, quote `targetHome` in shell command |
| `src/tasks/ufw.ts` | Add `escapeShellQuote()` helper, escape `rule.comment` in shell commands |
| `src/tasks/index.ts` | Add stop-on-failure prompt after task failure |
| `src/index.ts` | Add host key verification flow in connection loop, add timeout to system update |

---

## Chunk 1: Input Sanitization & Timeouts

### Task 1: Input Sanitization — SSH Username Validation

**Files:**
- Modify: `src/prompts.ts` (lines 40-44 — username prompt, line 215 — targetHome command)

- [ ] **Step 1: Add validation to SSH username prompt**

In `src/prompts.ts`, replace the username prompt (lines 40-44):

```typescript
  const username = unwrapText(await p.text({
    message: "Enter the SSH username",
    placeholder: "root",
    defaultValue: "root",
  }))
```

With:

```typescript
  const username = unwrapText(await p.text({
    message: "Enter the SSH username",
    placeholder: "root",
    defaultValue: "root",
    validate(value) {
      if (!value || !value.trim()) return "Username is required"
      if (!/^[a-z_][a-z0-9_-]*$/.test(value)) return "Invalid username format (lowercase letters, digits, hyphens, underscores)"
    },
  }))
```

- [ ] **Step 2: Quote targetHome in shell command**

In `src/prompts.ts`, replace line 215:

```typescript
  const existingKeysResult = await ssh.exec(`test -f ${targetHome}/.ssh/authorized_keys && grep -c 'ssh-' ${targetHome}/.ssh/authorized_keys || echo 0`)
```

With:

```typescript
  const existingKeysResult = await ssh.exec(`test -f '${targetHome}/.ssh/authorized_keys' && grep -c 'ssh-' '${targetHome}/.ssh/authorized_keys' || echo 0`)
```

- [ ] **Step 3: Run type check**

Run: `bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/prompts.ts
git commit -m "fix: add validation to SSH username prompt and quote targetHome in shell commands"
```

---

### Task 2: Input Sanitization — UFW Comment Escaping

**Files:**
- Modify: `src/tasks/ufw.ts` (lines 27-28, 35 — shell commands with `rule.comment`)

- [ ] **Step 1: Add `escapeShellQuote` helper**

In `src/tasks/ufw.ts`, add at the top after the import:

```typescript
import type { HardeningTask } from "../types.js"

function escapeShellQuote(s: string): string {
  return s.replace(/'/g, "'\\''")
}
```

- [ ] **Step 2: Use the helper in all UFW commands**

Replace lines 27-28:

```typescript
      const tcpResult = await ssh.exec(`ufw allow ${rule.port}/tcp comment '${rule.comment}'`)
      const udpResult = await ssh.exec(`ufw allow ${rule.port}/udp comment '${rule.comment}'`)
```

With:

```typescript
      const escapedComment = escapeShellQuote(rule.comment)
      const tcpResult = await ssh.exec(`ufw allow ${rule.port}/tcp comment '${escapedComment}'`)
      const udpResult = await ssh.exec(`ufw allow ${rule.port}/udp comment '${escapedComment}'`)
```

Replace line 35:

```typescript
      const ruleResult = await ssh.exec(`ufw allow ${rule.port}/${rule.protocol} comment '${rule.comment}'`)
```

With:

```typescript
      const ruleResult = await ssh.exec(`ufw allow ${rule.port}/${rule.protocol} comment '${escapeShellQuote(rule.comment)}'`)
```

- [ ] **Step 3: Run type check**

Run: `bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/tasks/ufw.ts
git commit -m "fix: escape single quotes in UFW rule comments to prevent shell injection"
```

---

### Task 3: SSH Command Timeout

**Files:**
- Modify: `src/types.ts` (lines 64-66 — SshClient interface)
- Modify: `src/ssh.ts` (lines 28-46 — spawnSsh, lines 48-67 — spawnSshpass, lines 187-193 — exec/execWithStdin)
- Modify: `src/index.ts` (line 55 — system update exec call)

- [ ] **Step 1: Update SshClient interface in types.ts**

In `src/types.ts`, replace lines 64-66:

```typescript
export interface SshClient {
  exec(command: string): Promise<CommandResult>
  execWithStdin(command: string, stdin: string): Promise<CommandResult>
```

With:

```typescript
export interface ExecOptions {
  timeout?: number
}

export interface SshClient {
  exec(command: string, options?: ExecOptions): Promise<CommandResult>
  execWithStdin(command: string, stdin: string, options?: ExecOptions): Promise<CommandResult>
```

Also update the `HardeningTask` type is fine as-is since tasks don't pass timeout options directly.

- [ ] **Step 2: Add timeout to spawnSsh()**

In `src/ssh.ts`, replace the `spawnSsh` function (lines 28-46):

```typescript
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
```

With:

```typescript
const DEFAULT_TIMEOUT = 300_000 // 5 minutes

async function spawnSsh(
  args: string[],
  stdinData?: string,
  timeout: number = DEFAULT_TIMEOUT,
): Promise<CommandResult> {
  const proc = Bun.spawn(["ssh", ...args], {
    stdin: stdinData !== undefined ? Buffer.from(stdinData) : "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })

  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    proc.kill()
  }, timeout)

  try {
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])

    const exitCode = await proc.exited

    if (timedOut) {
      return {
        stdout: "",
        stderr: `Command timed out after ${Math.round(timeout / 1000)}s`,
        exitCode: -1,
      }
    }

    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode }
  } finally {
    clearTimeout(timer)
  }
}
```

- [ ] **Step 3: Add timeout to spawnSshpass()**

In `src/ssh.ts`, replace the `spawnSshpass` function (lines 48-67):

```typescript
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
```

With:

```typescript
async function spawnSshpass(
  password: string,
  args: string[],
  timeout: number = DEFAULT_TIMEOUT,
): Promise<CommandResult> {
  const proc = Bun.spawn(["sshpass", "-e", "ssh", ...args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, SSHPASS: password },
  })

  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    proc.kill()
  }, timeout)

  try {
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])

    const exitCode = await proc.exited

    if (timedOut) {
      return {
        stdout: "",
        stderr: `Command timed out after ${Math.round(timeout / 1000)}s`,
        exitCode: -1,
      }
    }

    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode }
  } finally {
    clearTimeout(timer)
  }
}
```

- [ ] **Step 4: Update SshClient exec/execWithStdin to forward timeout**

In `src/ssh.ts`, update the import line to include `ExecOptions`:

```typescript
import type { ConnectionConfig, CommandResult, ExecOptions, ServerInfo, SshClient } from "./types.js"
```

Then replace the `exec` and `execWithStdin` methods inside `connect()` (lines 187-193):

```typescript
    async exec(command: string): Promise<CommandResult> {
      return spawnSsh([...execArgs, prefixSudo(command)])
    },

    async execWithStdin(command: string, stdin: string): Promise<CommandResult> {
      return spawnSsh([...execArgs, prefixSudo(command)], stdin)
    },
```

With:

```typescript
    async exec(command: string, options?: ExecOptions): Promise<CommandResult> {
      return spawnSsh([...execArgs, prefixSudo(command)], undefined, options?.timeout)
    },

    async execWithStdin(command: string, stdin: string, options?: ExecOptions): Promise<CommandResult> {
      return spawnSsh([...execArgs, prefixSudo(command)], stdin, options?.timeout)
    },
```

- [ ] **Step 5: Add 15-minute timeout to system update in index.ts**

In `src/index.ts`, replace line 55:

```typescript
    const updateResult = await ssh.exec("DEBIAN_FRONTEND=noninteractive apt update && DEBIAN_FRONTEND=noninteractive apt upgrade -y")
```

With:

```typescript
    const updateResult = await ssh.exec(
      "DEBIAN_FRONTEND=noninteractive apt update && DEBIAN_FRONTEND=noninteractive apt upgrade -y",
      { timeout: 900_000 },
    )
```

- [ ] **Step 6: Run type check**

Run: `bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/ssh.ts src/index.ts
git commit -m "feat: add timeout support to SSH commands (5min default, 15min for system update)"
```

---

## Chunk 2: Host Key Verification & Stop-on-Failure

### Task 4: SSH Host Key Verification

**Files:**
- Modify: `src/ssh.ts` (add `fetchHostKeyFingerprint()` export after `checkSshpassInstalled()`, change `StrictHostKeyChecking` to `yes`)
- Modify: `src/index.ts` (add host key verification flow in connection loop)

**Design:** `ssh.ts` stays non-interactive (no UI imports). It exports a pure data function `fetchHostKeyFingerprint()` that returns `{ known: true }` or `{ known: false, fingerprint, rawKeys }`. The caller (`index.ts`) handles the user prompt, writes to `known_hosts` if trusted, and controls the spinner lifecycle to avoid spinner/confirm conflicts.

**Note:** The existing `import { existsSync } from "fs"` in `ssh.ts` must be updated to also import `appendFileSync` and `mkdirSync` for the `addToKnownHosts` function:

```typescript
import { existsSync, appendFileSync, mkdirSync } from "fs"
```

- [ ] **Step 1: Add HostKeyResult type and fetchHostKeyFingerprint to ssh.ts**

In `src/ssh.ts`, add after the `checkSshpassInstalled()` function (after line 80):

```typescript
export type HostKeyResult =
  | { known: true }
  | { known: false; fingerprint: string; rawKeys: string }
  | { known: false; fingerprint: null; rawKeys: "" }

export async function fetchHostKeyFingerprint(host: string, port: number): Promise<HostKeyResult> {
  const home = process.env.HOME ?? ""
  const knownHostsPath = `${home}/.ssh/known_hosts`

  // Check if host is already in known_hosts
  if (existsSync(knownHostsPath)) {
    const hostLookup = port === 22 ? host : `[${host}]:${port}`
    const checkProc = Bun.spawn(["ssh-keygen", "-F", hostLookup, "-f", knownHostsPath], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const checkOutput = await new Response(checkProc.stdout).text()
    await checkProc.exited
    if (checkOutput.trim().length > 0) {
      return { known: true }
    }
  }

  // Fetch the server's host key via ssh-keyscan
  const keyscanProc = Bun.spawn(["ssh-keyscan", "-p", String(port), host], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const keyscanOutput = await new Response(keyscanProc.stdout).text()
  await keyscanProc.exited

  if (!keyscanOutput.trim()) {
    return { known: false, fingerprint: null, rawKeys: "" }
  }

  // Compute the SHA256 fingerprint
  const fingerprintProc = Bun.spawn(["ssh-keygen", "-lf", "/dev/stdin"], {
    stdin: Buffer.from(keyscanOutput),
    stdout: "pipe",
    stderr: "pipe",
  })
  const fingerprintOutput = await new Response(fingerprintProc.stdout).text()
  await fingerprintProc.exited

  const firstLine = fingerprintOutput.trim().split("\n")[0] ?? ""
  if (!firstLine) {
    return { known: false, fingerprint: null, rawKeys: "" }
  }

  return { known: false, fingerprint: firstLine, rawKeys: keyscanOutput.trim() }
}

export function addToKnownHosts(rawKeys: string): void {
  const home = process.env.HOME ?? ""
  const sshDir = `${home}/.ssh`
  const knownHostsPath = `${sshDir}/known_hosts`
  mkdirSync(sshDir, { recursive: true })
  appendFileSync(knownHostsPath, rawKeys + "\n", "utf-8")
}
```

- [ ] **Step 2: Change StrictHostKeyChecking from accept-new to yes**

In `src/ssh.ts`, in the `buildSshArgs` function (line 16), replace:

```typescript
    "-o", "StrictHostKeyChecking=accept-new",
```

With:

```typescript
    "-o", "StrictHostKeyChecking=yes",
```

This ensures SSH enforces the known_hosts check. The key is now explicitly added by our verification flow.

- [ ] **Step 3: Update index.ts connection loop with host key verification**

In `src/index.ts`, update the import from ssh.ts (line 5):

```typescript
import { connect, detectServerInfo } from "./ssh.js"
```

To:

```typescript
import { connect, detectServerInfo, fetchHostKeyFingerprint, addToKnownHosts } from "./ssh.js"
```

Then replace lines 20-41 (the entire `while (true)` loop):

```typescript
  while (true) {
    connectionConfig = await promptConnection()

    s.start(`Connecting to ${connectionConfig.host}...`)

    try {
      ssh = await connect(connectionConfig)
      s.stop(`Connected to ${pc.green(connectionConfig.host)}`)
      break
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error"
      s.stop(pc.red(`Connection failed: ${msg}`))
      log.warning(
        `${pc.bold("Troubleshooting:")}\n` +
        `  ${pc.dim("- Verify the IP address and port")}\n` +
        `  ${pc.dim("- Check that SSH is running on the server")}\n` +
        `  ${pc.dim("- Verify your credentials (key path or password)")}\n` +
        `  ${pc.dim("- Check network connectivity")}`,
      )
      log.info(pc.cyan("Let's try again.\n"))
    }
  }
```

With:

```typescript
  while (true) {
    connectionConfig = await promptConnection()

    // Verify host key before connecting
    s.start(`Checking host key for ${connectionConfig.host}...`)
    const hostKeyResult = await fetchHostKeyFingerprint(connectionConfig.host, connectionConfig.port)

    if (hostKeyResult.known) {
      s.stop(`Host key verified for ${pc.green(connectionConfig.host)}`)
    } else if (hostKeyResult.fingerprint) {
      // Stop spinner BEFORE showing interactive prompt
      s.stop("New host detected")
      log.info(
        `${pc.bold("Host key fingerprint:")}\n` +
        `  ${pc.cyan(hostKeyResult.fingerprint)}`
      )

      const trust = await p.confirm({
        message: "Do you trust this host?",
      })

      if (p.isCancel(trust) || !trust) {
        log.info(pc.cyan("Let's try again.\n"))
        continue
      }

      addToKnownHosts(hostKeyResult.rawKeys)
    } else {
      s.stop(pc.yellow("Could not fetch host key"))
      log.warning("Unable to verify host key. The connection will proceed but the host is unverified.")
    }

    s.start(`Connecting to ${connectionConfig.host}...`)

    try {
      ssh = await connect(connectionConfig)
      s.stop(`Connected to ${pc.green(connectionConfig.host)}`)
      break
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error"
      s.stop(pc.red(`Connection failed: ${msg}`))
      log.warning(
        `${pc.bold("Troubleshooting:")}\n` +
        `  ${pc.dim("- Verify the IP address and port")}\n` +
        `  ${pc.dim("- Check that SSH is running on the server")}\n` +
        `  ${pc.dim("- Verify your credentials (key path or password)")}\n` +
        `  ${pc.dim("- Check network connectivity")}`,
      )
      log.info(pc.cyan("Let's try again.\n"))
    }
  }
```

Also add the `p` import — update line 2:

```typescript
import { outro, log, spinner } from "@clack/prompts"
```

To:

```typescript
import * as p from "@clack/prompts"
```

And update references to use `p.` prefix:
- `const s = p.spinner()` (line 16)
- `p.log` instead of `log`
- `p.outro` instead of `outro`

Or alternatively, keep the destructured import and add `confirm` and `isCancel`:

```typescript
import { outro, log, spinner, confirm, isCancel } from "@clack/prompts"
```

Then use `confirm` and `isCancel` directly in the host key flow. This is the cleaner approach — keeps consistency with the existing destructured import style.

- [ ] **Step 4: Run type check**

Run: `bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/ssh.ts src/index.ts
git commit -m "feat: verify SSH host key fingerprint before connecting and add to known_hosts"
```

---

### Task 5: Stop on Task Failure

**Files:**
- Modify: `src/tasks/index.ts` (add failure prompt in task loop)

- [ ] **Step 1: Add clack prompts import and failure handling**

In `src/tasks/index.ts`, replace the entire file:

```typescript
import * as p from "@clack/prompts"
import pc from "picocolors"
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

async function promptContinueOnFailure(taskLabel: string): Promise<boolean> {
  const action = await p.select({
    message: `${pc.yellow(taskLabel)} failed. What do you want to do?`,
    options: [
      { value: "continue" as const, label: "Continue with remaining tasks" },
      { value: "stop" as const, label: "Stop here (show partial report)" },
    ],
  })

  if (p.isCancel(action)) return false
  return action === "continue"
}

export async function executeTasks(
  ssh: SshClient,
  options: HardeningOptions,
  server: ServerInfo,
): Promise<TaskResult[]> {
  const results: TaskResult[] = []
  const s = p.spinner()

  for (const task of TASKS) {
    s.start(task.label)
    try {
      const result = await task.run(ssh, options, server)
      if (result.message.startsWith("Skipped")) {
        s.stop(`${task.label} — skipped`)
      } else if (result.success) {
        s.stop(`${task.label} — done`)
      } else {
        s.stop(`${task.label} — ${pc.red("failed")}: ${result.message}`)
      }
      results.push(result)

      // On failure (not skip), ask whether to continue
      if (!result.success && !result.message.startsWith("Skipped")) {
        const shouldContinue = await promptContinueOnFailure(task.label)
        if (!shouldContinue) {
          return results
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error"
      s.stop(`${task.label} — ${pc.red("error")}: ${message}`)
      results.push({
        name: task.label,
        success: false,
        message,
      })

      const shouldContinue = await promptContinueOnFailure(task.label)
      if (!shouldContinue) {
        return results
      }
    }
  }

  return results
}
```

- [ ] **Step 2: Run type check**

Run: `bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/tasks/index.ts
git commit -m "feat: prompt user to continue or stop when a task fails"
```

---

## Final Verification

- [ ] **Step 1: Run full type check**

Run: `bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Verify the CLI runs**

Run: `bun src/index.ts --help 2>&1 || true`
Expected: The CLI starts without import errors (it will show the banner or a prompt)
