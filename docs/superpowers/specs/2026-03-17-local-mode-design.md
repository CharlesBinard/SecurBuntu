# Local Mode — Run SecurBuntu Directly on the Machine

**Date:** 2026-03-17
**Status:** Draft

## Problem

SecurBuntu currently requires an SSH connection to harden a server. This means you can't run it directly on the machine you want to secure — a common scenario for fresh VPS provisioning, post-install scripts, containers, or when you're already logged into the server.

## Solution

Add a local execution mode where SecurBuntu runs commands directly on the host machine instead of over SSH. The entire hardening pipeline (audit, prompts, tasks, report) stays identical — only the command transport layer changes.

## Design

### 1. Rename Abstraction: `SshClient` → `SystemClient`

The existing `SshClient` interface is actually a generic command execution contract. Renaming it to `SystemClient` makes the abstraction honest and opens it to multiple backends.

**`src/types.ts` changes:**

```typescript
export interface SystemClient {
  exec(command: string, options?: ExecOptions): Promise<CommandResult>
  execWithStdin(command: string, stdin: string, options?: ExecOptions): Promise<CommandResult>
  writeFile(path: string, content: string): Promise<void>
  readFile(path: string): Promise<string>
  fileExists(path: string): Promise<boolean>
  close(): void
  readonly isRoot: boolean
}

export type HardeningTask = (
  client: SystemClient,
  options: HardeningOptions,
  server: ServerInfo,
) => Promise<TaskResult>
```

**Affected files (mechanical rename, zero logic changes):**
- `src/types.ts` — interface + `HardeningTask` type
- `src/ssh/connection.ts` — `connect()` return type
- `src/dry-run.ts` — `implements SystemClient`
- `src/logging.ts` — `implements SystemClient`
- `src/orchestrator.ts` — parameter types
- `src/tasks/*.ts` — parameter name `ssh` → `client`
- `src/audit/scanner.ts` — parameter type
- `src/ssh/detect.ts` — parameter type
- `src/prompts/hardening.ts` — parameter type
- `src/__tests__/helpers/mock-ssh.ts` — `MockSystemClient`
- All test files referencing the mock

### 2. New `LocalClient`

**New file: `src/local/client.ts`**

Implements `SystemClient` by executing commands locally via `Bun.spawn()`.

```typescript
export class LocalClient implements SystemClient {
  readonly isRoot: boolean
  private sudoPassword: string | undefined

  constructor(sudoPassword?: string) {
    this.isRoot = process.getuid?.() === 0
    this.sudoPassword = sudoPassword
  }
}
```

**Command execution:**
- Commands run via `Bun.spawn(["bash", "-c", command])` — this preserves compatibility with all existing task commands (pipes, redirections, shell features)
- If not root: prefix commands with `sudo -S -p ''` (password via stdin) or `sudo -n` (passwordless sudo), same pattern as the SSH client
- Timeout support via `AbortSignal.timeout()`

**File operations:**
- `writeFile()`: if root → `Bun.write()` directly; if not root → `sudo tee` (same pattern as SSH client)
- `readFile()`: `sudo cat` if needed
- `fileExists()`: `sudo test -f`

**Lifecycle:**
- `close()`: no-op (nothing to clean up locally)

**New file: `src/local/detect.ts`**

Detects local server info without SSH:
- Ubuntu version from `/etc/os-release`
- Hostname from `hostname` command
- Socket activation detection
- cloud-init presence

**New file: `src/local/index.ts`** — re-exports

### 3. Entry Flow: Mode Selection

**New file: `src/connection/mode.ts`**

At the very start, before any connection logic:

```
◆ What would you like to secure?
│ ○ This machine (local)
│ ○ A remote server (SSH)
```

**If "This machine":**
1. Verify Ubuntu 22.04+ (read `/etc/os-release`)
2. Check if running as root (`process.getuid()`)
3. If not root → prompt for sudo password, validate with `sudo -S -p '' true`
4. Return a `LocalClient` instance

**If "A remote server":**
- Existing `connectWithRetry()` flow, unchanged

**Return type:**

```typescript
interface ConnectionResult {
  client: SystemClient
  mode: "local" | "ssh"
  host: string        // "localhost" or SSH host
  username: string    // current user or SSH user
}
```

### 4. Orchestrator Changes

`run()` in `orchestrator.ts` is decoupled from SSH:

- Receives a `SystemClient` + metadata (mode, host, username) instead of calling `connectWithRetry()` internally
- The `ConnectionConfig` is only used in SSH mode
- Report uses `host` from the connection result (`"localhost"` or the SSH host)
- All downstream functions already work with the `SystemClient` interface — zero changes needed

### 5. SSH Lockout Prevention (Local Mode)

When running locally and the user chooses to disable SSH password authentication:

1. Check if `~/.ssh/authorized_keys` exists for the current user (or target sudo user)
2. Count the number of keys present
3. **If no keys found → block the option** with a clear message:
   > "Cannot disable password authentication: no SSH keys found in authorized_keys. Add a key first to avoid losing remote access."
4. **If keys found → show a warning** and require explicit confirmation:
   > "You're about to disable SSH password authentication on this machine. Make sure your SSH key is correctly configured. Continue?"

This is stricter than the SSH mode (where we can verify the key is deployed), because in local mode we can't test remote access from the machine itself.

### 6. Prompt Adjustments

Minimal changes to prompts in local mode:

- **SSH key deployment prompt**: Reworded to "Add an SSH key to authorized_keys" instead of "Deploy your SSH key to the server"
- **Coolify prompt**: Unchanged — still relevant when running locally on a server that will use Coolify
- **Create sudo user**: Unchanged — still only shown when running as root
- **Connection prompt**: Skipped entirely in local mode

### 7. Report Adjustments

- `Report.serverIp` → `"localhost"` in local mode (or actual hostname)
- `Report.connectionUser` → current system user
- Markdown export header: "Local hardening" instead of "Remote hardening via SSH"
- Everything else (results, audit diff, export) unchanged

### 8. DryRun and Logging

`DryRunSshClient` and `LoggingSshClient` already wrap the `SystemClient` interface via the decorator pattern. After the rename, they work identically with both `LocalClient` and the SSH client. Zero logic changes.

### 9. Testing

**Rename:**
- `MockSshClient` → `MockSystemClient` in `src/__tests__/helpers/mock-ssh.ts`
- All test files updated to use new name

**New tests for `LocalClient`:**
- `src/__tests__/local/client.test.ts`
  - `exec()` runs commands via bash
  - `execWithStdin()` passes stdin correctly
  - `writeFile()` / `readFile()` / `fileExists()` work
  - sudo prefixing when not root
  - `isRoot` detection
  - `close()` is safe no-op

**New tests for mode selection:**
- `src/__tests__/connection/mode.test.ts`
  - Returns `LocalClient` when local mode chosen
  - Returns SSH client when SSH mode chosen
  - Validates Ubuntu version in local mode
  - Validates sudo access in local mode

**Existing tests:**
- All 156+ existing tests pass after rename (mechanical change only)

## What Does NOT Change

- The 12 hardening modules — zero logic modifications
- The audit scanner — works via `SystemClient`, transparent
- The dry-run and logging decorators — wrap `SystemClient`, transparent
- The pipeline: audit → prompts → execute → report
- CLI flags (`--dry-run`, `--audit`, `--log`, `--help`)

## File Summary

| Action | File | Description |
|--------|------|-------------|
| **New** | `src/local/client.ts` | `LocalClient` implementing `SystemClient` |
| **New** | `src/local/detect.ts` | Local server info detection |
| **New** | `src/local/index.ts` | Re-exports |
| **New** | `src/connection/mode.ts` | Mode selection prompt + client factory |
| **Rename** | `src/types.ts` | `SshClient` → `SystemClient`, `HardeningTask` param |
| **Rename** | `src/ssh/connection.ts` | Return type |
| **Rename** | `src/dry-run.ts` | `implements SystemClient` |
| **Rename** | `src/logging.ts` | `implements SystemClient` |
| **Modify** | `src/orchestrator.ts` | Accept `SystemClient` + metadata |
| **Modify** | `src/index.ts` | Call mode selection before orchestrator |
| **Modify** | `src/connection/mode.ts` | Integrate mode prompt |
| **Modify** | `src/prompts/ssh-options.ts` | Lockout guard for local mode |
| **Modify** | `src/report/export.ts` | "localhost" support |
| **Rename** | `src/__tests__/helpers/mock-ssh.ts` | `MockSystemClient` |
| **Rename** | All test files | Updated mock references |
| **New** | `src/__tests__/local/client.test.ts` | LocalClient tests |
| **New** | `src/__tests__/connection/mode.test.ts` | Mode selection tests |
