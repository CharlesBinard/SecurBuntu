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
- `src/dry-run.ts` — rename to `DryRunClient`, `implements SystemClient`
- `src/logging.ts` — rename to `LoggingClient`, `implements SystemClient`
- `src/orchestrator.ts` — parameter types
- `src/tasks/ufw.ts` — imports `SshClient` directly in `applyUfwRules` and `applyOneUfwRule` helpers
- `src/tasks/permissions.ts` — imports `SshClient` directly in `getSshHostKeyPaths` and `checkPermissions` helpers
- `src/tasks/ssh-keys.ts` — imports `SshClient` directly in `injectKey` helper
- `src/tasks/ssh-config.ts` — imports `SshClient` directly in `rollbackSshConfig` helper
- `src/tasks/*.ts` (remaining) — parameter name `ssh` → `client` in task functions
- `src/audit/scanner.ts` — parameter type
- `src/ssh/detect.ts` — parameter type
- `src/prompts/hardening.ts` — parameter type
- `src/connection/error-handlers.ts` — imports `SshClient` in `handleSudoPasswordPrompt` and `handleConnectionError` return types (SSH-mode-only module, not called from local code path)
- `src/prompts/connection.ts` — not modified, but skipped entirely in local mode
- `src/__tests__/helpers/mock-ssh.ts` — rename to `MockSystemClient`
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
- Commands run via `Bun.spawn(["bash", "-c", command])` with `stdout: "pipe"` and `stderr: "pipe"`. Output is read via `.text()` on the readable streams and trimmed of trailing newlines to match the SSH client's behavior (callers rely on exact string comparisons like `=== "yes"`, `=== "active"`)
- If not root: prefix commands with `sudo -S -p ''` (password via stdin) or `sudo -n` (passwordless sudo), same pattern as the SSH client's `prefixSudo()` function
- The sudo prefix wraps commands in `bash -c` with shell escaping, mirroring `src/ssh/connection.ts` line 111
- Timeout support via `AbortSignal.timeout()`
- `sudoStdin()` helper mirrors the SSH client's pattern: prepends the sudo password to any stdin data when needed

**File operations:**
- `writeFile()`: if root → `Bun.write()` directly; if not root → `sudo tee` with password piped via stdin (same pattern as `sudoStdin()` from `src/ssh/connection.ts`)
- `readFile()`: `sudo cat` if needed
- `fileExists()`: `sudo test -f`

**Lifecycle:**
- `close()`: no-op (nothing to clean up locally)

**New file: `src/local/index.ts`** — re-exports

**Note:** `src/local/detect.ts` is NOT needed. The existing `detectServerInfo()` in `src/ssh/detect.ts` works entirely via the `SystemClient` interface (runs `. /etc/os-release`, `systemctl is-active ssh.socket`, etc.). It will work identically with a `LocalClient` — no duplication needed.

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

The `connectWithRetry()` function is updated to return a `ConnectionResult` instead of `{ ssh, connectionConfig }`, so both paths produce the same type.

### 4. Orchestrator Changes

`run()` in `orchestrator.ts` is decoupled from SSH:

- Receives a `ConnectionResult` (which contains the `SystemClient` + metadata) instead of calling `connectWithRetry()` internally
- `executeAndReport()` is refactored to accept `ConnectionResult` metadata (`host`, `username`, `mode`) instead of a full `ConnectionConfig`. Currently it uses `connectionConfig.host` and `connectionConfig.username` for reports and log exports — these are replaced by the fields from `ConnectionResult`
- Report uses `host` from the connection result (`"localhost"` or the SSH host)
- All downstream task/audit functions already work with the `SystemClient` interface

### 5. SSH Lockout Prevention (Local Mode)

When running locally and the user chooses to disable SSH password authentication:

1. Check if `~/.ssh/authorized_keys` exists for the current user (or target sudo user)
2. Count the number of keys present
3. **If no keys found → block the option** with a clear message:
   > "Cannot disable password authentication: no SSH keys found in authorized_keys. Add a key first to avoid losing remote access."
4. **If keys found → show a warning** and require explicit confirmation:
   > "You're about to disable SSH password authentication on this machine. Make sure your SSH key is correctly configured. Continue?"

This is stricter than the SSH mode (where we can verify the key is deployed), because in local mode we can't test remote access from the machine itself.

### 6. `whoami` via Sudo Issue

In `src/prompts/hardening.ts`, `promptPasswordAuth` calls `(await ssh.exec("whoami")).stdout` to determine the target user for the `authorized_keys` check. When commands are prefixed with sudo, `whoami` returns `"root"` even for non-root users.

**Fix:** The `LocalClient` must not prefix `whoami` with sudo. More broadly, the `isRoot` property already tracks the real user's identity. The lockout prevention logic (Section 5) should use `process.env.USER` or the `ConnectionResult.username` to determine the actual user's home directory, rather than relying on `whoami` through the client.

### 7. SSH Key Deployment in Local Mode

`src/tasks/ssh-keys.ts` reads the public key from the local filesystem with `readFileSync(options.personalKeyPath)`. In SSH mode, this reads from the operator's workstation. In local mode, this reads from the same machine being hardened — which is correct when the user has their public key file present locally.

The SSH key prompt in local mode should clarify: "Path to the public key file on this machine". The user is expected to have the `.pub` file available (e.g., `~/.ssh/id_ed25519.pub`). This is the natural case since auto-detection of local keys (`detectAllLocalKeys()` in `src/ssh/detect.ts`) already scans the local `~/.ssh/` directory.

### 8. Prompt Adjustments

Minimal changes to prompts in local mode:

- **SSH key deployment prompt**: Reworded to "Add an SSH key to authorized_keys" instead of "Deploy your SSH key to the server"
- **Coolify prompt**: Unchanged — still relevant when running locally on a server that will use Coolify
- **Create sudo user**: Unchanged — still only shown when running as root
- **Connection prompt** (`src/prompts/connection.ts`): Skipped entirely in local mode (gated by `src/connection/mode.ts`)

### 9. Report Adjustments

- `Report.serverIp` → `"localhost"` in local mode (or actual hostname)
- `Report.connectionUser` → current system user
- Markdown export header: "Local hardening" instead of "Remote hardening via SSH"
- Everything else (results, audit diff, export) unchanged

### 10. DryRun and Logging

`DryRunSshClient` → `DryRunClient`, `LoggingSshClient` → `LoggingClient`. These already wrap the `SystemClient` interface via the decorator pattern. After the rename, they work identically with both `LocalClient` and the SSH client. Zero logic changes.

### 11. SSH Config Task — Behavioral Note

`src/tasks/ssh-config.ts` validates SSH config with `sshd -t` and restarts `ssh.service`. The post-restart verification (`echo ok` to check the connection is alive) is meaningful in SSH mode (an SSH restart can break the active session) but is a no-op in local mode (a local shell session is unaffected by SSH restarts). This is harmless — the `echo ok` will succeed — so no code change is needed. The task works correctly in both modes.

### 12. Testing

**Rename:**
- `MockSshClient` → `MockSystemClient` in `src/__tests__/helpers/mock-ssh.ts`
- All test files updated to use new name

**New tests for `LocalClient`:**
- `src/__tests__/local/client.test.ts`
  - `exec()` runs commands via bash and returns trimmed stdout/stderr
  - `execWithStdin()` passes stdin correctly
  - `writeFile()` / `readFile()` / `fileExists()` work
  - sudo prefixing when not root
  - `isRoot` detection
  - `close()` is safe no-op
  - timeout behavior with long-running commands

**New tests for mode selection:**
- `src/__tests__/connection/mode.test.ts`
  - Returns `LocalClient` when local mode chosen
  - Returns SSH client when SSH mode chosen
  - Validates Ubuntu version in local mode
  - Validates sudo access in local mode

**Integration smoke test:**
- Run the full pipeline in `--dry-run` mode with a `LocalClient` on an Ubuntu system
- Verify that the audit scanner and all task modules produce correct dry-run output
- Validates end-to-end compatibility of the `LocalClient` with the existing pipeline

**Existing tests:**
- All existing tests pass after rename (mechanical change only)

## What Does NOT Change

- The 12 hardening modules — zero logic modifications (only type/param renames)
- The audit scanner — works via `SystemClient`, transparent
- The dry-run and logging decorators — wrap `SystemClient`, transparent
- The pipeline: audit → prompts → execute → report
- CLI flags (`--dry-run`, `--audit`, `--log`, `--help`)
- `detectServerInfo()` — already transport-agnostic, reused as-is

## Future Enhancement

A `--local` CLI flag could be added for non-interactive/scripting use cases (post-install scripts, automation). Out of scope for this iteration but naturally supported by the `ConnectionResult` abstraction.

## File Summary

| Action | File | Description |
|--------|------|-------------|
| **New** | `src/local/client.ts` | `LocalClient` implementing `SystemClient` |
| **New** | `src/local/index.ts` | Re-exports |
| **New** | `src/connection/mode.ts` | Mode selection prompt + client factory |
| **Rename** | `src/types.ts` | `SshClient` → `SystemClient`, `HardeningTask` param |
| **Rename** | `src/ssh/connection.ts` | Return type |
| **Rename** | `src/dry-run.ts` | `DryRunClient`, `implements SystemClient` |
| **Rename** | `src/logging.ts` | `LoggingClient`, `implements SystemClient` |
| **Rename** | `src/tasks/ufw.ts` | Type import + helper param types |
| **Rename** | `src/tasks/permissions.ts` | Type import + helper param types |
| **Rename** | `src/tasks/ssh-keys.ts` | Type import + helper param type |
| **Rename** | `src/tasks/ssh-config.ts` | Type import + helper param type |
| **Rename** | `src/tasks/*.ts` (remaining) | Param name `ssh` → `client` |
| **Rename** | `src/audit/scanner.ts` | Param type |
| **Rename** | `src/ssh/detect.ts` | Param type |
| **Rename** | `src/connection/error-handlers.ts` | Type imports (SSH-mode-only) |
| **Modify** | `src/orchestrator.ts` | Accept `ConnectionResult`, refactor `executeAndReport` |
| **Modify** | `src/index.ts` | Call mode selection before orchestrator |
| **Modify** | `src/prompts/hardening.ts` | Lockout guard for local mode, `whoami` fix |
| **Modify** | `src/prompts/ssh-options.ts` | Lockout warning for local mode |
| **Modify** | `src/report/export.ts` | "localhost" support |
| **Rename** | `src/__tests__/helpers/mock-ssh.ts` | `MockSystemClient` |
| **Rename** | All test files | Updated mock references |
| **New** | `src/__tests__/local/client.test.ts` | LocalClient tests |
| **New** | `src/__tests__/connection/mode.test.ts` | Mode selection tests |
