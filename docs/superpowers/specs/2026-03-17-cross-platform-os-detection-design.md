# Cross-Platform Support & Host OS Detection

**Date:** 2026-03-17
**Status:** Draft

## Problem

SecurBuntu only validates the OS of the **target** machine (Ubuntu >= 22.04 on the remote server). It does not check the OS of the **host** machine (the one running the tool). This causes two issues:

1. **Incompatible local mode:** A user on macOS or Windows can select "This machine" and get a confusing failure deep in the pipeline instead of an upfront error.
2. **Windows cannot run SecurBuntu in SSH mode:** Commands like `ssh-copy-id`, `sshpass`, `ssh-keyscan`, and SSH ControlMaster are unavailable or behave differently on Windows. The tool crashes or shows Linux-only install instructions.

## Goal

Make SecurBuntu runnable from **Linux, macOS, and Windows** as an SSH client, while restricting local mode to compatible Ubuntu systems. Detect the host OS at startup, verify required commands are available, offer to install missing dependencies when possible, and provide TypeScript fallbacks when native commands don't exist on the platform.

## Non-Goals

- Hardening Windows or macOS machines (local mode remains Ubuntu-only).
- Replacing the system `ssh` binary with a pure-TS SSH implementation.
- Supporting exotic platforms beyond Linux/macOS/Windows.
- Special-casing WSL — it reports `process.platform === "linux"` and is treated as Linux.

## Design

### 1. Cross-Platform Home Directory Helper — `src/platform/home.ts`

The codebase uses `process.env.HOME` in 10+ locations to resolve `~/.ssh/` paths. On Windows, `HOME` is not set — the correct variable is `USERPROFILE`. This must be fixed for SSH mode to work on Windows.

**New shared helper:**

```typescript
import { homedir } from "os"

function resolveHome(): string {
  return homedir()
}
```

Uses Node's `os.homedir()` which works correctly on all three platforms.

**All call sites migrated:**
- `src/ssh/detect.ts` — `detectAllLocalKeys()`, `detectDefaultKeyPath()`, `detectDefaultPubKeyPath()` (3 occurrences)
- `src/ssh/host-keys.ts` — `fetchHostKeyFingerprint()`, `addToKnownHosts()` (2 occurrences)
- `src/prompts/connection.ts` — tilde expansion in key path validation (2 occurrences)
- `src/prompts/hardening.ts` — tilde expansion in pub key path (2 occurrences)

All `process.env.HOME ?? ""` usages in source code are replaced with `resolveHome()`. Test files that mock `process.env.HOME` are updated to mock `os.homedir()` instead.

### 2. Host Platform Detection — `src/platform/detect.ts`

New module that identifies the OS running SecurBuntu.

**Exported function:**

```typescript
function detectHostPlatform(): Promise<HostPlatform>
```

**New type in `src/types.ts`:**

```typescript
interface HostPlatform {
  os: "linux" | "macos" | "windows"
  distro: string | null        // "ubuntu", "debian", etc. — Linux only
  version: string | null       // "22.04", "24.04", etc. — Linux only
  codename: string | null      // "jammy", "noble", etc. — Linux only
  isCompatibleTarget: boolean  // true only if Ubuntu >= 22.04
}
```

**Logic:**
- Uses `process.platform` to map `"win32"` → `"windows"`, `"darwin"` → `"macos"`, `"linux"` → `"linux"`.
- On Linux: reads `/etc/os-release` to extract distro, version, and codename. Reuses the same parsing logic currently in `connection/mode.ts:validateLocalUbuntu()` and `ssh/detect.ts:detectServerInfo()` — this duplicate logic will be consolidated into `platform/detect.ts` and both call sites will import from there.
- `isCompatibleTarget` is `true` only when `os === "linux"` AND `distro === "ubuntu"` AND version >= 22.04.

**When called:** At the top of `index.ts`, before `selectMode()`. The result is passed to `selectMode()`.

### 3. Mode Selection Gate — changes to `src/connection/mode.ts`

`selectMode()` receives `HostPlatform` as a parameter.

**Behavior when local mode is selected on an incompatible host:**
- Displays a clear error via `p.log.error()`:
  > "Local mode requires Ubuntu 22.04+. Your system: {os} {version}. Use SSH mode to secure a remote server."
- Returns to the mode selection prompt (does not crash or exit).

**`setupLocalClient()` changes:** Remove the call to `validateLocalUbuntu()`. Instead, use `platform.isCompatibleTarget` (already validated before reaching this point). The `version` and `codename` fields from `HostPlatform` flow into the `ServerInfo` struct that `detectServerInfo()` produces — since in local mode `detectServerInfo()` reads `/etc/os-release` via the `LocalClient`, and the platform gate already ensures we're on Ubuntu >= 22.04, no data is lost.

**No change** to SSH mode selection — it works from any OS.

### 4. Host Capabilities Detection — `src/platform/capabilities.ts`

Inventories which CLI commands are available on the host machine.

**Exported function:**

```typescript
function detectCapabilities(platform: HostPlatform): Promise<HostCapabilities>
```

**New type in `src/types.ts`:**

```typescript
interface HostCapabilities {
  ssh: boolean
  sshCopyId: boolean
  sshpass: boolean
  sshKeygen: boolean
  sshKeyscan: boolean
}
```

**Logic:**
- For each command, runs `which <cmd>` (Linux/macOS) or `where.exe <cmd>` (Windows) via `Bun.spawn()`.
- Returns booleans for each.

**When called:** After the user selects SSH mode, before initiating the connection.

### 5. Auto-Install Missing Dependencies

When a command is missing AND the platform supports automated installation, SecurBuntu prompts the user:

> "`ssh-copy-id` is not installed. Install it now? (sudo apt install openssh-client)" → yes/no via `@clack/prompts`

**Install matrix:**

| Command | Linux (apt) | macOS (brew) | Windows |
|---------|-------------|--------------|---------|
| `ssh` | `sudo apt install openssh-client` | Already included | Manual instructions (Settings > Apps > Optional Features > OpenSSH Client) |
| `ssh-copy-id` | `sudo apt install openssh-client` | `brew install ssh-copy-id` | N/A — use TS fallback |
| `sshpass` | `sudo apt install sshpass` | N/A (not in default Homebrew, requires third-party tap — too fragile to automate) | N/A — does not exist |
| `ssh-keygen` | Included with openssh-client | Already included | Included with OpenSSH |
| `ssh-keyscan` | Included with openssh-client | Already included | Included with OpenSSH |

**Note on macOS `sshpass`:** `sshpass` was removed from Homebrew's official repository for security reasons. It requires a third-party tap (`brew install esolitos/ipa/sshpass`). Rather than automate an unreliable tap, treat macOS the same as Windows for `sshpass`: password auth is unavailable unless the user has already installed it manually. The capability check still detects it if present.

**Behavior by severity:**
- **`ssh` missing → blocking.** Cannot proceed in SSH mode. Show install instructions or offer to install. If user declines, exit with clear message.
- **`sshpass` missing → non-blocking.** Password authentication won't be available. Inform the user; hide the "Password" auth method in the connection prompt.
- **`ssh-copy-id` missing → non-blocking.** Use the TypeScript fallback (see section 6).
- **`ssh-keygen` missing → non-blocking.** Warn that key generation and host key verification fingerprint display won't be possible.
- **`ssh-keyscan` missing → non-blocking.** Host key verification will be skipped with a warning. The connection still proceeds but the host is unverified (same behavior as when `ssh-keyscan` fails today).

**Consolidation:** The existing `checkSshCopyIdInstalled()` and `checkSshpassInstalled()` functions in `src/ssh/copy-key.ts` currently use `which` and are Linux/macOS-only. These will be replaced by `detectCapabilities()` which handles all platforms. The checks in `src/prompts/connection.ts` and `src/connection/error-handlers.ts` will use the capabilities result instead of calling these functions directly.

### 6. TypeScript Fallback for `ssh-copy-id` — `src/platform/ssh-copy.ts`

A pure-TypeScript implementation of `ssh-copy-id` that works on any OS.

**Exported function:**

```typescript
function copyKeyViaClient(client: SystemClient, pubKeyPath: string, targetUser: string): Promise<CopyKeyResult>
```

**Logic:**
1. Read the local public key file using `Bun.file()` with `resolveHome()` for cross-platform home directory resolution.
2. Via the already-established SSH connection (`SystemClient`), execute on the remote server:
   - `mkdir -p ~/.ssh && chmod 700 ~/.ssh`
   - Check if key already exists in `authorized_keys` (avoid duplicates)
   - Append key: `echo "<key>" >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`
3. Return `CopyKeyResult` (same interface as existing `copyKeyToServer()`).

**Integration with the "Copy my SSH key to server" auth method:**

The current flow for the "copy" auth method:
1. `ssh-copy-id` runs interactively (`stdin: "inherit"`) — user types the server password.
2. Key is copied. Connection switches to key auth.

The new flow depends on what's available:

| `ssh-copy-id` | `sshpass` | Flow |
|----------------|-----------|------|
| Available | Any | Use `ssh-copy-id` interactively as today (unchanged) |
| Missing | Available | Connect via `sshpass` + password, then `copyKeyViaClient()` through the established connection |
| Missing | Missing | Connect via `ssh` with `stdin: "inherit"` (user types password once into the SSH prompt). Then use `copyKeyViaClient()` through the established connection. On Windows without ControlMaster, this means the initial interactive SSH session establishes the connection, copies the key, then subsequent commands use key auth. |

**Windows "copy" flow detail (no `ssh-copy-id`, no `sshpass`):**
1. User selects "Copy my SSH key to server" and provides a key path.
2. SecurBuntu connects to the server via `ssh` with `stdin: "inherit"` — the user types their password into the native SSH prompt.
3. Once connected, `copyKeyViaClient()` injects the public key via `SystemClient.exec()`.
4. Connection closes. SecurBuntu reconnects using key auth (no more password needed).
5. All subsequent commands use key auth.

This avoids the chicken-and-egg problem: the initial password-authenticated connection is established interactively (the user types the password into ssh's own prompt), not via `sshpass`.

**Path resolution:**
- Uses `resolveHome()` + `path.join()` for local paths (handles `\` on Windows vs `/` on Unix).
- Remote paths always use `/` (target is always Ubuntu).

### 7. Windows-Specific SSH Adaptations

#### 7a. ControlMaster — changes to `src/ssh/connection.ts`

OpenSSH on Windows does not support `ControlMaster` / `ControlPath` (connection multiplexing). On Windows:
- Skip ControlMaster setup entirely — no `-o ControlMaster=yes`, no `-o ControlPersist`, no `-o ControlPath`.
- `buildSshArgs()` must also omit the `ControlPath` option, since it is currently unconditionally included in all SSH args (master and per-command).
- Each command opens a fresh SSH connection.
- Performance impact: slightly slower due to per-command connection setup, but fully functional.
- Cleanup function becomes a no-op (no control socket to close).

**Implementation:** `connect()` and `buildSshArgs()` in `ssh/connection.ts` receive `platform.os` and conditionally include ControlMaster/ControlPath args. The `HostPlatform` is threaded through the call chain: `selectMode(platform)` → `connectWithRetry(platform, capabilities)` → `connect(config, platform)`.

#### 7b. Host Key Verification — changes to `src/ssh/host-keys.ts`

Two issues on Windows:
1. **`/dev/stdin` does not exist on Windows.** The `ssh-keygen -lf /dev/stdin` call (line 39) passes keyscan output via stdin and reads from `/dev/stdin`. On Windows, use a temporary file instead: write the keyscan output to a temp file, run `ssh-keygen -lf <tempfile>`, then delete the temp file.
2. **`ssh-keyscan` may be missing.** If `capabilities.sshKeyscan` is `false`, skip host key verification entirely and warn the user: "Host key verification unavailable (ssh-keyscan not found). Proceeding without verification."

**Implementation:** `fetchHostKeyFingerprint()` receives `HostPlatform` and `HostCapabilities`. On Windows, it uses a temp file for `ssh-keygen`. If `ssh-keyscan` is unavailable, it returns `{ known: false, fingerprint: null, rawKeys: "" }` (same as current failure path).

#### 7c. Signal Handling — changes to `src/ssh/connection.ts`

`SIGINT` and `SIGTERM` listeners (lines 74-75) are POSIX concepts. On Windows, `SIGINT` is partially supported by Node/Bun (Ctrl+C works), but `SIGTERM` may not fire reliably. The cleanup handler should be registered regardless (best-effort), but on Windows the cleanup is a no-op anyway (no control socket), so this is low risk.

#### 7d. `which` vs `where.exe`

`src/ssh/copy-key.ts` currently uses `which` to find commands. On Windows, the equivalent is `where.exe`. This logic is centralized in `capabilities.ts` as a helper:

```typescript
function commandExists(cmd: string, platform: HostPlatform): Promise<boolean> {
  const lookup = platform.os === "windows" ? ["where.exe", cmd] : ["which", cmd]
  // ...
}
```

All existing `which`-based checks are replaced by `detectCapabilities()`.

### 8. Consolidated OS-Release Parsing

Currently, `/etc/os-release` parsing exists in two places:
- `connection/mode.ts:validateLocalUbuntu()` — validates local Ubuntu for local mode
- `ssh/detect.ts:detectServerInfo()` — validates remote Ubuntu for SSH mode

Both will be refactored:
- Extract the parsing logic into `platform/detect.ts` as a shared helper: `parseOsRelease(raw: string): { distro: string; version: string; codename: string }`.
- `detectHostPlatform()` calls this for the local machine.
- `detectServerInfo()` calls this for the remote machine (via `client.exec()`).
- `validateLocalUbuntu()` is removed — `detectHostPlatform()` replaces it. The `version` and `codename` data it returned is available from `HostPlatform` and doesn't need to be re-fetched.

### 9. Parameter Threading

The `HostPlatform` and `HostCapabilities` must be threaded through the call chain. Here are the signature changes:

| Function | Current Signature | New Signature |
|----------|-------------------|---------------|
| `selectMode()` | `() → Promise<ConnectionResult>` | `(platform: HostPlatform) → Promise<ConnectionResult>` |
| `connectWithRetry()` | `() → Promise<{client, connectionConfig}>` | `(platform: HostPlatform, capabilities: HostCapabilities) → Promise<{client, connectionConfig}>` |
| `connect()` | `(config: ConnectionConfig) → Promise<SystemClient>` | `(config: ConnectionConfig, platform: HostPlatform) → Promise<SystemClient>` |
| `buildSshArgs()` | `(config: ConnectionConfig) → string[]` | `(config: ConnectionConfig, platform: HostPlatform) → string[]` |
| `promptConnection()` | `() → Promise<ConnectionConfig>` | `(capabilities: HostCapabilities) → Promise<ConnectionConfig>` |
| `verifyHostKey()` | `(config, spinner) → Promise<"continue"\|"retry">` | `(config, spinner, platform, capabilities) → Promise<"continue"\|"retry">` |
| `fetchHostKeyFingerprint()` | `(host, port) → Promise<HostKeyResult>` | `(host, port, platform, capabilities) → Promise<HostKeyResult>` |
| `handleConnectionError()` | `(error, config, s) → Promise<SystemClient\|"retry">` | `(error, config, s, platform, capabilities) → Promise<SystemClient\|"retry">` |
| `handleSudoPasswordPrompt()` | `(config, s) → Promise<SystemClient\|"retry">` | `(config, s, platform) → Promise<SystemClient\|"retry">` |
| `handlePermissionDenied()` | `(config) → Promise<void>` | `(config, capabilities) → Promise<void>` |
| `handleCopyAuthMethod()` | `(config) → Promise<"continue"\|"retry">` | `(config, capabilities) → Promise<"continue"\|"retry">` |

### 10. Updated Flow

```
1.  Parse CLI args                          (existing, unchanged)
2.  Display banner                          (existing, unchanged)
3.  detectHostPlatform()                    (NEW)
4.  selectMode(platform)                    (modified — receives HostPlatform)
    ├─ "This machine" + !isCompatibleTarget → error message + retry
    └─ "Remote server" → continue
5.  detectCapabilities(platform)            (NEW — SSH mode only)
    ├─ ssh missing → offer install or exit
    ├─ sshpass missing → note: password auth unavailable
    ├─ ssh-copy-id missing → note: will use TS fallback
    ├─ ssh-keyscan missing → note: host key verification unavailable
    └─ ssh-keygen missing → note: key gen unavailable
6.  promptConnection(capabilities)          (modified — hide password auth if sshpass unavailable)
7.  verifyHostKey(config, s, platform, cap) (modified — skip if ssh-keyscan unavailable, temp file on Windows)
8.  SSH connect(config, platform)           (modified — no ControlMaster on Windows)
9.  detectServerInfo()                      (modified — uses shared parseOsRelease)
10. Orchestrator pipeline                   (existing, unchanged)
```

## Files Changed

| File | Change |
|------|--------|
| `src/platform/detect.ts` | **New** — `detectHostPlatform()`, shared `parseOsRelease()` |
| `src/platform/capabilities.ts` | **New** — `detectCapabilities()`, `commandExists()`, auto-install prompts |
| `src/platform/ssh-copy.ts` | **New** — TS fallback for `ssh-copy-id` |
| `src/platform/home.ts` | **New** — `resolveHome()` cross-platform helper |
| `src/platform/index.ts` | **New** — re-exports |
| `src/types.ts` | Add `HostPlatform`, `HostCapabilities` interfaces |
| `src/index.ts` | Call `detectHostPlatform()`, pass to `selectMode()` |
| `src/connection/mode.ts` | Accept `HostPlatform`, gate local mode, remove `validateLocalUbuntu()`, call `detectCapabilities()` in SSH path |
| `src/connection/retry-loop.ts` | Accept `HostPlatform` + `HostCapabilities`, pass through to `connect()`, `promptConnection()`, `verifyHostKey()` |
| `src/connection/verify-host.ts` | Pass `platform` + `capabilities` to `fetchHostKeyFingerprint()` |
| `src/ssh/connection.ts` | Accept `HostPlatform`, conditionally disable ControlMaster + ControlPath on Windows, update `buildSshArgs()` |
| `src/ssh/detect.ts` | Use shared `parseOsRelease()` from `platform/detect.ts`, replace `process.env.HOME` with `resolveHome()` |
| `src/ssh/host-keys.ts` | Accept `HostPlatform` + `HostCapabilities`, use temp file on Windows for `ssh-keygen`, skip if `ssh-keyscan` unavailable, replace `process.env.HOME` with `resolveHome()` |
| `src/ssh/copy-key.ts` | Remove `checkSshCopyIdInstalled()` / `checkSshpassInstalled()` (moved to capabilities), integrate TS fallback |
| `src/prompts/connection.ts` | Accept `HostCapabilities`, hide password auth if `sshpass` unavailable, replace `process.env.HOME` with `resolveHome()` |
| `src/prompts/hardening.ts` | Replace `process.env.HOME` with `resolveHome()` |
| `src/connection/error-handlers.ts` | Accept `HostCapabilities`, use capabilities instead of inline `which` checks |

## Files Unchanged

- All `src/tasks/*.ts` — hardening tasks run on the remote server, always Ubuntu
- `src/audit/scanner.ts` — runs on the target, not the host
- `src/report/` — no platform dependency
- `src/orchestrator.ts` — receives `SystemClient`, transport-agnostic
- `src/local/client.ts` — only used when local mode is selected (already gated)

## Testing Strategy

- **Unit tests for `platform/detect.ts`:** Mock `process.platform` and `/etc/os-release` content for all OS variants (Linux Ubuntu, Linux non-Ubuntu, macOS, Windows).
- **Unit tests for `platform/capabilities.ts`:** Mock `Bun.spawn()` for `which`/`where.exe` results. Test install prompts per platform. Test that `sshpass` install is not offered on macOS.
- **Unit tests for `platform/ssh-copy.ts`:** Use `MockSystemClient` to verify the key injection sequence (mkdir, grep, append, chmod).
- **Unit tests for `platform/home.ts`:** Verify `resolveHome()` returns a non-empty string (delegates to `os.homedir()`).
- **Unit tests for `ssh/connection.ts`:** Verify ControlMaster and ControlPath args are excluded when `platform.os === "windows"`. Update existing `buildSshArgs` tests in `src/__tests__/ssh/connection.test.ts` that currently assert `ControlPath` is always present.
- **Unit tests for `ssh/host-keys.ts`:** Test temp file path on Windows for `ssh-keygen`, test skip behavior when `ssh-keyscan` is unavailable.
- **Update existing tests** in `src/__tests__/ssh/copy-key.test.ts` to reflect moved functions.
- **Update existing tests** in `src/__tests__/ssh/detect.test.ts` to use `os.homedir()` mock instead of `process.env.HOME`.
- **Integration testing:** Manual testing on Linux, macOS, and Windows (native Bun) against a real Ubuntu server.
