# SecurBuntu v2 — Improvements Design Specification

## Overview

Three waves of improvements to the existing SecurBuntu CLI:

- **Wave 1: Security & Robustness** — Input sanitization, SSH command timeouts, host key verification, stop-on-failure
- **Wave 2: New Features** — Dry-run mode, file logging, kernel hardening (sysctl), SSH banner, audit mode
- **Wave 3: Tests** — Complete unit test coverage with SSH mocks

This spec covers all three waves. Implementation proceeds wave by wave.

---

## Wave 1: Security & Robustness

### 1.1 Input Sanitization

**Problem:** The SSH connection username in `promptConnection()` has no validation. UFW rule comments could contain single quotes that break shell commands. The `targetHome` variable in `promptHardeningOptions()` is used unquoted in shell commands.

**Changes:**

- Add `validate` callback to the SSH username prompt with the same regex as sudo username: `/^[a-z_][a-z0-9_-]*$/`
- In `ufw.ts`, escape single quotes in `rule.comment` before interpolation into shell commands. Use the POSIX shell idiom: replace `'` with `'\''` (close quote, escaped literal quote, reopen quote). Add a helper `escapeShellQuote(s: string): string` in `ufw.ts`.
- In `promptHardeningOptions()`, quote `targetHome` in the shell command with single quotes.

**Files:** `src/prompts.ts`, `src/tasks/ufw.ts`

### 1.2 SSH Command Timeout

**Problem:** `spawnSsh()` and `spawnSshpass()` have no timeout. A hanging command blocks the CLI forever.

**Changes:**

- Add an optional `timeout` parameter (in ms) to `spawnSsh()` and `spawnSshpass()`.
- Default timeout: 300,000 ms (5 minutes).
- Implementation: use `setTimeout` to call `proc.kill()` after the deadline. On timeout, return a `CommandResult` with `exitCode: -1` and `stderr: "Command timed out after Xs"`.
- Update `SshClient` interface: `exec(command: string, options?: { timeout?: number })` and same for `execWithStdin`.
- `writeFile()` inherits the default timeout from its underlying `spawnSsh()` call — no separate parameter needed.
- In `index.ts`, the system update command uses a 15-minute timeout (900,000 ms).
- **Important:** All `SshClient` wrappers (`DryRunSshClient`, `LoggingSshClient` in Wave 2) must accept and forward the `options` parameter in their `exec()` and `execWithStdin()` signatures.

**Files:** `src/types.ts`, `src/ssh.ts`, `src/index.ts`

### 1.3 SSH Host Key Verification

**Problem:** `StrictHostKeyChecking=accept-new` silently trusts the server's host key on first connection.

**Changes:**

- `ssh.ts` stays non-interactive (no UI imports). Two new exports:
  - `fetchHostKeyFingerprint(host, port)` — pure data function returning `{ known: true }` or `{ known: false, fingerprint, rawKeys }`. Runs local `ssh-keygen -F` to check `known_hosts`, then `ssh-keyscan` + `ssh-keygen -lf` to get fingerprint.
  - `addToKnownHosts(rawKeys)` — appends raw keyscan output to `~/.ssh/known_hosts`.
- Change `StrictHostKeyChecking=accept-new` to `StrictHostKeyChecking=yes` in `buildSshArgs()`. SSH now enforces the `known_hosts` check — keys are explicitly added by our verification flow.
- In `index.ts`, the connection loop:
  1. Calls `fetchHostKeyFingerprint()` with a spinner.
  2. If `known: true`: spinner stops with "Host key verified", proceed to connect.
  3. If new host with fingerprint: stop spinner, display fingerprint, prompt with `p.confirm("Do you trust this host?")`. If trusted: call `addToKnownHosts()`, proceed. If refused: loop back.
  4. If fingerprint fetch failed: warn and proceed (best-effort).
- The spinner is always stopped before any interactive prompt to avoid clack rendering conflicts.

**Files:** `src/ssh.ts`, `src/index.ts`

### 1.4 Stop on Task Failure

**Problem:** When a task fails in `tasks/index.ts`, subsequent tasks run anyway, potentially cascading failures.

**Changes:**

- After a task fails (not a skip), prompt the user with `p.select()`:
  - **Continue** — proceed with remaining tasks
  - **Stop** — halt execution, return partial results
- Skipped tasks (message starts with "Skipped") do not trigger this prompt.
- Caught exceptions also trigger the prompt.
- The returned `TaskResult[]` only includes tasks that actually ran.

**Files:** `src/tasks/index.ts`

---

## Wave 2: New Features

### 2.1 Dry-Run Mode

**Entry points:**
- CLI flag: `securbuntu --dry-run` (parsed via `Bun.argv` or `process.argv`)
- Interactive: after the confirmation summary, add a third option: "Simulate first (dry-run)"

**Behavior:**
- In dry-run mode, `SshClient.exec()` and `writeFile()` log what would be executed instead of running it.
- Implementation: a `DryRunSshClient` that wraps the real `SshClient`. It logs ALL `exec()` calls instead of executing them, and logs `writeFile()` calls with the content that would be written. Only `readFile()` and `fileExists()` pass through to the real client (these are pure reads needed for detection accuracy).
- Dry-run output uses `p.log.info()` with a `[DRY-RUN]` prefix.
- At the end, display a summary of all commands that would have been executed.
- **System update and dry-run timing:** When activated via `--dry-run` CLI flag, the system update is skipped entirely (checked in `index.ts` before the apt commands). When activated via the interactive "Simulate first" option at confirmation time, the system update has already run (it executes before the questionnaire) — only the post-confirmation tasks are simulated. The spec acknowledges this difference; the interactive dry-run is for previewing hardening changes, not the update.
- Detection commands (server info, existing keys check) still execute for accuracy via `readFile()` / `fileExists()` passthrough.

**Types:**
- New `DryRunSshClient` class implementing `SshClient` in a new file `src/dry-run.ts`.
- Add `dryRun: boolean` to the global options or pass it through the workflow.

**Files:** `src/dry-run.ts` (new), `src/index.ts`, `src/types.ts`

### 2.2 File Logging

**Entry points:**
- CLI flag: `securbuntu --log`
- Interactive: question at the end alongside the report export: "Do you want to save a detailed log file?"

**Behavior:**
- When enabled, write a log file with all commands executed, their stdout/stderr, exit codes, and timestamps.
- Log file path: `./securbuntu-log-<sanitized-ip>-<date>.txt`
- Implementation: a `LoggingSshClient` wrapper that intercepts all `exec()` / `writeFile()` calls, logs them to an in-memory buffer, and flushes to file at the end.
- The wrapper delegates to the real `SshClient` for actual execution.
- Log format:
  ```
  [2026-03-15T14:30:00Z] EXEC: apt update && apt upgrade -y
  [2026-03-15T14:30:45Z] EXIT: 0
  [2026-03-15T14:30:45Z] STDOUT: (truncated to 2000 chars)
  [2026-03-15T14:30:45Z] STDERR: (empty)
  ```

**Files:** `src/logging.ts` (new), `src/index.ts`, `src/prompts.ts` (add log question)

### 2.3 Kernel Hardening (sysctl)

**New questionnaire section** (after auto-updates, before confirmation):

```
◆ Kernel hardening (sysctl)
│ Do you want to apply kernel security parameters?
│
│ If yes:
◆ Select the protections to apply:
│
■ Block traffic forwarding (recommended)
│   Prevents the server from acting as a router.
│   ⚠ Disable this if using Docker/Coolify
│
■ Ignore ICMP redirects (recommended)
│   Blocks fake routing messages from the network
│
■ Disable source routing (recommended)
│   Blocks packets with a forced path through the network
│
■ SYN flood protection (recommended)
│   Limits connection saturation attacks
│
□ Disable ICMP broadcast replies
│   Hides the server from ping scans
```

**Implementation:**
- New task file `src/tasks/sysctl.ts`.
- Writes `/etc/sysctl.d/99-securbuntu.conf` with selected parameters.
- Applies immediately with `sysctl --system`.
- If Coolify is selected, remove "Block traffic forwarding" from the multiselect choices entirely and show an info message: "IP forwarding is required for Docker/Coolify — this option has been removed." This is cleaner UX than showing it and auto-deselecting.

**Sysctl parameters map:**

| Option | Parameters |
|--------|-----------|
| Block traffic forwarding | `net.ipv4.ip_forward=0`, `net.ipv6.conf.all.forwarding=0` |
| Ignore ICMP redirects | `net.ipv4.conf.all.accept_redirects=0`, `net.ipv4.conf.default.accept_redirects=0`, `net.ipv6.conf.all.accept_redirects=0` |
| Disable source routing | `net.ipv4.conf.all.accept_source_route=0`, `net.ipv6.conf.all.accept_source_route=0` |
| SYN flood protection | `net.ipv4.tcp_syncookies=1` |
| Disable ICMP broadcast | `net.ipv4.icmp_echo_ignore_broadcasts=1` |

**Types:** Add to `HardeningOptions`:
```typescript
enableSysctl: boolean
sysctlOptions?: {
  blockForwarding: boolean
  ignoreRedirects: boolean
  disableSourceRouting: boolean
  synFloodProtection: boolean
  disableIcmpBroadcast: boolean
}
```

**Execution order:** Sysctl runs between `unattended` and `ssh-config` in the task orchestrator (before SSH config which must remain last).

**Files:** `src/tasks/sysctl.ts` (new), `src/types.ts`, `src/prompts.ts`, `src/tasks/index.ts`, `src/report.ts`

### 2.4 SSH Warning Banner

**New questionnaire option** (after SSH port question):
> "Do you want to add a security warning banner to SSH?"
> Hint: "Displays a legal warning before login"

**Implementation:**
- New section in `src/tasks/ssh-config.ts` (not a separate task file — it's part of SSH config).
- The skip condition in `ssh-config.ts` must be updated to also check `options.enableSshBanner`.
- Writes `/etc/issue.net` with a standard warning banner:
  ```
  ******************************************************************
  *  WARNING: Unauthorized access to this system is prohibited.    *
  *  All connections are monitored and recorded.                   *
  *  Disconnect IMMEDIATELY if you are not an authorized user.     *
  ******************************************************************
  ```
- Adds `Banner /etc/issue.net` to the SSH config drop-in.

**Types:** Add `enableSshBanner: boolean` to `HardeningOptions`.

**Files:** `src/types.ts`, `src/prompts.ts`, `src/tasks/ssh-config.ts`, `src/report.ts`

### 2.5 Audit Mode

**Two entry points:**

1. **Pre-questionnaire scan** — Runs automatically after connection/detection. Scans the server and shows current state before asking questions. Pre-checks what's already in place so the user knows what to change.

2. **Standalone command** — `securbuntu --audit` generates only the audit report without modifying anything.

**Audit checks:**

| Check | Command | Status |
|-------|---------|--------|
| SSH port | Parse sshd config for `Port` | `Port 22` / `Port 2222` |
| Root login | Parse sshd config for `PermitRootLogin` | `yes` / `no` / `prohibit-password` |
| Password auth | Parse sshd config for `PasswordAuthentication` | `yes` / `no` |
| UFW status | `ufw status` | `active` / `inactive` / `not installed` |
| Fail2ban | `systemctl is-active fail2ban` | `active` / `inactive` / `not installed` |
| Auto-updates | Check `/etc/apt/apt.conf.d/20auto-upgrades` | `enabled` / `disabled` / `not configured` |
| Sudo users | `grep -Po '^sudo:.*:\K.*' /etc/group` | List of sudo users |
| SSH keys | `ls /home/*/.ssh/authorized_keys /root/.ssh/authorized_keys 2>/dev/null` | Count per user |
| Sysctl hardening | Check `/etc/sysctl.d/99-securbuntu.conf` or read current values | `hardened` / `default` |
| SSH banner | Check `Banner` in sshd config | `enabled` / `not set` |

**Implementation:**
- New file `src/audit.ts` with `runAudit(ssh: SshClient): Promise<AuditResult>` and `displayAudit(result: AuditResult): void`.
- `AuditResult` contains structured status for each check (see Types below).
- Display uses `p.note()` with a formatted table.
- In normal mode: run audit after detection, display results, then proceed to questionnaire.
- In `--audit` mode: follows the same flow as normal mode up to audit display (banner → connection prompts → detect server info → run audit → display), then optionally exports and exits. No questionnaire, no hardening.

**Types:** New `AuditResult` interface in `types.ts`:
```typescript
interface AuditCheck {
  name: string
  status: string
  detail?: string
}

interface AuditResult {
  checks: AuditCheck[]
}
```

The existing `Report` interface gains an optional `audit?: AuditResult` field for inclusion in exported reports. A new `exportAuditMarkdown(audit: AuditResult, serverIp: string, date: string): string` function is added to `report.ts`.

**Files:** `src/audit.ts` (new), `src/types.ts`, `src/index.ts`, `src/report.ts`

---

## Wave 3: Complete Test Coverage

### Test Framework

Use Bun's built-in test runner (`bun test`). No additional test framework needed.

### Test Structure

```
src/
├── __tests__/
│   ├── ssh.test.ts          # SSH client tests with mock spawn
│   ├── prompts.test.ts      # Prompt validation logic tests
│   ├── report.test.ts       # Report generation tests
│   ├── audit.test.ts        # Audit checks tests
│   ├── dry-run.test.ts      # Dry-run client tests
│   ├── logging.test.ts      # Logging client tests
│   └── tasks/
│       ├── index.test.ts     # Task orchestrator tests (stop-on-failure)
│       ├── user.test.ts
│       ├── ssh-keys.test.ts
│       ├── ssh-config.test.ts
│       ├── ufw.test.ts
│       ├── fail2ban.test.ts
│       ├── unattended.test.ts
│       └── sysctl.test.ts
```

### Mock Strategy

Create a `MockSshClient` implementing `SshClient` that:
- Records all commands executed (for assertion)
- Returns configurable responses per command pattern (regex matching)
- Supports configurable `isRoot` state
- Tracks files written via `writeFile()`
- Returns preset content for `readFile()`

This mock lives in `src/__tests__/helpers/mock-ssh.ts`.

### Coverage Targets

Every module gets tests for:
- **Happy path** — normal operation with expected inputs
- **Edge cases** — empty inputs, boundary values, missing files
- **Error paths** — command failures, timeouts, invalid data
- **Idempotency** — running the same task twice produces the same result

### Key Test Scenarios

**SSH client (`ssh.test.ts`):**
- Timeout triggers kill and returns error
- Host key verification flow (known host, new host, refused)
- ControlMaster lifecycle

**Tasks:**
- Each task tested with mock SSH client
- Verify correct commands are executed in correct order
- Verify rollback on failure (ssh-config)
- Verify skip conditions
- Verify version-adaptive behavior (fail2ban 22.04 vs 24.04)

**Audit (`audit.test.ts`):**
- Each check returns correct status for various server states
- Handles missing tools gracefully

**Dry-run (`dry-run.test.ts`):**
- Read operations pass through to real client
- Write operations are logged, not executed
- System update is skipped

**Report (`report.test.ts`):**
- Markdown generation correctness
- Filename sanitization (IPv6, special chars)
- All task results displayed correctly

**Files:** All files in `src/__tests__/` (new)
