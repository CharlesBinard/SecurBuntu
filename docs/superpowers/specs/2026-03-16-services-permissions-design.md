# Design: Disable Unnecessary Services + Harden File Permissions

## Summary

Two new features for SecurBuntu that extend both the audit scanner and the hardening pipeline:

1. **Unnecessary services detection & disabling** — detect active services that are unnecessary on a headless Ubuntu server and let the user choose which to disable.
2. **File permissions hardening** — audit critical system files for incorrect permissions/ownership and automatically fix them.

Both features follow the existing architecture: new audit checks in `audit/scanner.ts`, new hardening tasks, and integration into the existing prompt/task flow.

## Feature 1: Unnecessary Services

### Audit

A new check in `audit/scanner.ts` runs `systemctl list-units --type=service --state=active --no-legend` and matches against a known list of services that are unnecessary on a headless server.

Known unnecessary services:

| Service | Description |
|---|---|
| `cups` | Print server, unnecessary on headless servers |
| `avahi-daemon` | mDNS/DNS-SD discovery, not needed on servers |
| `bluetooth` | Bluetooth stack, useless on servers |
| `ModemManager` | Mobile broadband modem manager |
| `whoopsie` | Ubuntu error reporting daemon |
| `apport` | Crash report generator |
| `snapd` | Snap package manager, optional on servers |
| `rpcbind` | RPC port mapper (NFS), not needed unless using NFS |

Audit result: a check named `"Unnecessary Services"` with status listing detected services (e.g., `"cups, avahi-daemon, snapd"`) or `"none detected"`.

### Prompt

New file `prompts/services.ts` with a multiselect prompt showing each detected service with its description. Only shown if unnecessary services are detected. Users see exactly what they are disabling and why.

Example:

```
◻ cups — Print server, unnecessary on headless servers
◻ avahi-daemon — mDNS/DNS-SD discovery, not needed on servers
```

### Hardening Task

New file `tasks/services.ts`:

- For each selected service: `systemctl disable --now <service>` then `systemctl mask <service>`
- Returns a `TaskResult` with the list of disabled services

### Types

Add to `HardeningOptions`:

- `disableServices: boolean`
- `servicesToDisable: string[]`

## Feature 2: File Permissions Hardening

### Audit

A new check in `audit/scanner.ts` that verifies permissions and ownership of critical system files via `stat -c '%a %U %G'`.

Expected permissions:

| File | Permissions | Owner |
|---|---|---|
| `/etc/passwd` | 644 | root:root |
| `/etc/shadow` | 640 | root:shadow |
| `/etc/gshadow` | 640 | root:shadow |
| `/etc/group` | 644 | root:root |
| `/etc/ssh/sshd_config` | 600 | root:root |
| `/etc/crontab` | 600 | root:root |
| `/etc/ssh/ssh_host_*_key` (private keys) | 600 | root:root |

Audit result: a check named `"File Permissions"` with status `"all correct"` or listing non-conforming files (e.g., `"/etc/shadow 644 (expected 640)"`).

### Hardening Task

New file `tasks/permissions.ts`:

- Automatically corrects non-conforming permissions via `chmod` and `chown`
- No interactive prompt needed — there is no valid reason to keep overly permissive permissions on these files
- Returns a `TaskResult` with the list of corrected files

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

### Dry-Run

Both features work automatically with the existing `DryRunSshClient` — no changes needed.

### Audit Display

Both new checks appear in the audit table (before and after hardening), using the existing `audit/display.ts` formatting.

## Files to Create

- `src/prompts/services.ts` — multiselect prompt for service disabling
- `src/tasks/services.ts` — service disabling task
- `src/tasks/permissions.ts` — file permissions correction task

## Files to Modify

- `src/types.ts` — add new fields to `HardeningOptions`
- `src/audit/scanner.ts` — add two new audit checks
- `src/tasks/index.ts` — register the two new tasks
- `src/prompts/hardening.ts` — add prompts for both features
- `src/prompts/index.ts` — re-export new prompt
