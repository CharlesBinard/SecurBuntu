# Design: Disable Unnecessary Services + Harden File Permissions

## Summary

Two new features for SecurBuntu that extend both the audit scanner and the hardening pipeline:

1. **Unnecessary services detection & disabling** — detect active services that are unnecessary on a headless Ubuntu server and let the user choose which to disable.
2. **File permissions hardening** — audit critical system files for incorrect permissions/ownership and automatically fix them.

Both features follow the existing architecture: new audit checks in `audit/scanner.ts`, new hardening tasks, and integration into the existing prompt/task flow.

## Feature 1: Unnecessary Services

### Service Registry

A shared constant `UNNECESSARY_SERVICES` defined in `tasks/services.ts` and imported by `prompts/services.ts`:

```ts
interface ServiceDefinition {
  name: string
  description: string
}

const UNNECESSARY_SERVICES: ServiceDefinition[] = [
  { name: "cups", description: "Print server, unnecessary on headless servers" },
  { name: "avahi-daemon", description: "mDNS/DNS-SD discovery, not needed on servers" },
  { name: "bluetooth", description: "Bluetooth stack, useless on servers" },
  { name: "ModemManager", description: "Mobile broadband modem manager" },
  { name: "whoopsie", description: "Ubuntu error reporting daemon" },
  { name: "apport", description: "Crash report generator" },
  { name: "snapd", description: "Snap package manager, optional on servers" },
  { name: "rpcbind", description: "RPC port mapper (NFS), not needed unless using NFS" },
]
```

Note on `snapd`: disabling it may leave snap-based packages unpatched. The description makes this tradeoff visible to the user.

### Audit

A new check in `audit/scanner.ts` runs `systemctl list-units --type=service --state=active --no-legend` and matches against `UNNECESSARY_SERVICES` names.

Audit result format:
- **Good state**: `{ name: "Unnecessary Services", status: "none detected" }`
- **Bad state**: `{ name: "Unnecessary Services", status: "found", detail: "cups, avahi-daemon, snapd" }`

Display integration: add `"none detected"` to the `isGood` conditions and `"found"` to the `isBad` conditions in `audit/display.ts`.

### Prompt

New file `prompts/services.ts` with a multiselect prompt showing each detected service with its description. Only shown if unnecessary services are detected. Users see exactly what they are disabling and why.

The prompt needs the list of *detected* services (from the audit) to filter `UNNECESSARY_SERVICES` to only those actually running. This list is passed from the orchestrator after the audit phase.

Example:

```
◻ cups — Print server, unnecessary on headless servers
◻ avahi-daemon — mDNS/DNS-SD discovery, not needed on servers
```

### Hardening Task

New file `tasks/services.ts`:

- For each selected service: `systemctl disable --now <service>` then `systemctl mask <service>`
- **Partial failure handling**: track disabled/failed services separately (like `tasks/ufw.ts` tracks `addedRules`/`failedRules`). If some services fail to disable, continue with remaining ones and return `{ success: false, message: "Disabled N/M services", details: "Failed: <list>" }`.
- On full success: `{ success: true, message: "Disabled N service(s): <list>" }`
- If `disableServices` is false or `servicesToDisable` is empty: `{ success: true, message: "Skipped — no services selected" }`

### Types

Add to `HardeningOptions`:

- `disableServices: boolean`
- `servicesToDisable: string[]`

## Feature 2: File Permissions Hardening

### Permissions Registry

A constant defining expected permissions, used by both the audit check and the hardening task:

```ts
interface FilePermission {
  path: string
  mode: string
  owner: string
  group: string
}

const EXPECTED_PERMISSIONS: FilePermission[] = [
  { path: "/etc/passwd", mode: "644", owner: "root", group: "root" },
  { path: "/etc/shadow", mode: "640", owner: "root", group: "shadow" },
  { path: "/etc/gshadow", mode: "640", owner: "root", group: "shadow" },
  { path: "/etc/group", mode: "644", owner: "root", group: "root" },
  { path: "/etc/ssh/sshd_config", mode: "600", owner: "root", group: "root" },
  { path: "/etc/crontab", mode: "600", owner: "root", group: "root" },
]
```

SSH host private keys (`/etc/ssh/ssh_host_*_key`) are handled separately: the audit first expands the glob via `ls /etc/ssh/ssh_host_*_key 2>/dev/null`, then checks each existing file individually. Missing files are silently skipped.

### Audit

A new check in `audit/scanner.ts` that verifies permissions and ownership via `stat -c '%a %U %G'` for each file in the registry.

Audit result format:
- **Good state**: `{ name: "File Permissions", status: "all correct" }`
- **Bad state**: `{ name: "File Permissions", status: "non-conforming", detail: "/etc/shadow 644 (expected 640)" }`

Display integration: add `"all correct"` to the `isGood` conditions and `"non-conforming"` to the `isBad` conditions in `audit/display.ts`.

Missing files are silently skipped — they are not treated as permission violations.

### Hardening Task

New file `tasks/permissions.ts`:

- Automatically corrects non-conforming permissions via `chmod` and `chown`
- No interactive prompt needed — there is no valid reason to keep overly permissive permissions on these files
- Returns a `TaskResult` with the list of corrected files
- If all files are already correct: `{ success: true, message: "Skipped — all permissions already correct" }`
- If `fixFilePermissions` is false: `{ success: true, message: "Skipped — not requested" }`

### Types

Add to `HardeningOptions`:

- `fixFilePermissions: boolean`

## Integration

### Task Execution Order (in `tasks/index.ts`)

```
1. Creating sudo user
2. Injecting SSH keys
3. Configuring UFW firewall
4. Configuring Fail2ban
5. Configuring automatic updates
6. Disabling unnecessary services  ← new
7. Fixing file permissions          ← new
8. Applying kernel hardening
9. Hardening SSH configuration
```

Services and permissions run before sysctl/SSH — reducing attack surface goes from coarse-grained (services, files) to fine-grained (kernel, SSH config).

### Prompt Flow

The services question is added in `prompts/hardening.ts`, after the auto-updates question and before the sysctl question. File permissions hardening gets a simple yes/no toggle in the same location.

### Confirmation Summary

Add two new lines in `prompts/confirmation.ts` `buildSummaryLines()`:
- `Disable services: cups, avahi-daemon` (or `No`)
- `Fix file permissions: Yes` (or `No`)

### Dry-Run

The audit runs against the real SSH connection before the `DryRunSshClient` wrapper is applied (see `orchestrator.ts`), so both new audit checks execute against the real server. The hardening tasks go through `DryRunSshClient` which returns success without executing — no changes needed.

### Audit Display

Both new checks appear in the audit table (before and after hardening). Update `audit/display.ts` coloring:
- Add `"none detected"` and `"all correct"` to `isGood` conditions
- Add `"found"` and `"non-conforming"` to `isBad` conditions

## Files to Create

- `src/prompts/services.ts` — multiselect prompt for service disabling
- `src/tasks/services.ts` — service registry + disabling task
- `src/tasks/permissions.ts` — permissions registry + correction task
- `src/__tests__/tasks/services.test.ts` — tests for services task (skip when not requested, successful disable, partial failure, command failure)
- `src/__tests__/tasks/permissions.test.ts` — tests for permissions task (skip when not requested, all correct, corrections applied, missing files handled)

## Files to Modify

- `src/types.ts` — add new fields to `HardeningOptions`
- `src/audit/scanner.ts` — add two new audit checks
- `src/audit/display.ts` — add coloring for new status values
- `src/tasks/index.ts` — register the two new tasks
- `src/prompts/hardening.ts` — add prompts for both features
- `src/prompts/confirmation.ts` — add summary lines for new options
- `src/prompts/index.ts` — re-export new prompt
- `src/__tests__/tasks/*.test.ts` — update `defaultOptions` in existing test files to include new `HardeningOptions` fields
