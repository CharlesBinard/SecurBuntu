# SecurBuntu CLI - Design Specification

## Overview

A BunJS CLI application that runs locally and connects to a remote Ubuntu server via SSH to audit and harden its security. The application features an interactive questionnaire, adaptive hardening based on Ubuntu version, and a detailed report.

**All CLI text is in English.** Code comments may be in English.

## Stack

- **Runtime:** Bun
- **Dependencies:** `@clack/prompts@latest`, `picocolors@latest`
- **SSH:** System `ssh` command via `Bun.spawn` with ControlMaster for persistent connections
- **Password auth:** `sshpass` via `sshpass -e` (reads password from `SSHPASS` env var, avoids leaking password in process args). Must be installed locally if user chooses password auth.
- **TypeScript:** `strict: true`, no `any`, no `as` assertions. Use type guards and `satisfies` for narrowing.

## Supported Ubuntu Versions

- **Ubuntu 22.04 LTS** (Jammy) — OpenSSH 8.9, traditional ssh.service
- **Ubuntu 24.04 LTS** (Noble) — OpenSSH 9.6, ssh.socket activation
- **Ubuntu 24.10+** — same model as 24.04

If the detected OS is not Ubuntu or the version is below 22.04, abort with a clear error message. Version comparison uses numeric parsing of `VERSION_ID` (split on `.`, compare major then minor).

## Project Structure

```
SecurBuntu/
├── src/
│   ├── index.ts          # Entry point, orchestrates the full workflow
│   ├── ssh.ts            # SSH wrapper: Bun.spawn + ControlMaster, connect/exec/cleanup
│   ├── prompts.ts        # All interactive questions (clack)
│   ├── ui.ts             # ASCII banner, display helpers
│   ├── report.ts         # Terminal summary + Markdown export
│   ├── types.ts          # Shared interfaces and types
│   └── tasks/
│       ├── index.ts      # Task orchestrator: runs tasks in explicit order
│       ├── update.ts     # apt update && apt upgrade
│       ├── user.ts       # Create sudo user
│       ├── ssh-keys.ts   # Inject SSH keys (personal + Coolify)
│       ├── ssh-config.ts # Harden sshd_config (port, root login, password auth)
│       ├── ufw.ts        # Install and configure UFW
│       ├── fail2ban.ts   # Install and configure Fail2ban
│       └── unattended.ts # Configure unattended-upgrades
├── package.json
├── tsconfig.json
└── bunfig.toml
```

## Types

```typescript
interface ConnectionConfig {
  host: string
  port: number
  username: string
  authMethod: "key" | "password"
  privateKeyPath?: string
  password?: string
  controlPath: string  // e.g. /tmp/securbuntu-<user>@<host>:<port>
}

interface ServerInfo {
  ubuntuVersion: string          // "22.04", "24.04"
  ubuntuCodename: string         // "jammy", "noble"
  usesSocketActivation: boolean  // true if ssh.socket is active
  hasCloudInit: boolean          // true if 50-cloud-init.conf exists
  isRoot: boolean                // true if connected as root
}

interface HardeningOptions {
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

interface UfwPort {
  port: string  // string to support ranges like "6000:6100"
  protocol: "tcp" | "udp" | "both"
  comment: string
}

interface TaskResult {
  name: string
  success: boolean
  message: string
  details?: string
}

interface Report {
  serverIp: string
  connectionUser: string
  sudoUser?: string
  date: string
  ubuntuVersion: string
  results: TaskResult[]
  newSshPort?: number
}

interface SshClient {
  exec(command: string): Promise<CommandResult>
  execWithStdin(command: string, stdin: string): Promise<CommandResult>
  writeFile(remotePath: string, content: string): Promise<void>
  readFile(remotePath: string): Promise<string>
  fileExists(remotePath: string): Promise<boolean>
  close(): void
  readonly isRoot: boolean  // if false, exec() auto-prefixes commands with sudo
}

interface CommandResult {
  stdout: string
  stderr: string
  exitCode: number
}
```

Each task module exports a single function with the signature:
```typescript
(ssh: SshClient, options: HardeningOptions, server: ServerInfo) => Promise<TaskResult>
```

## Workflow

### 1. ASCII Banner
Display "SecurBuntu" ASCII art with version number (read from `package.json`) using picocolors.

### 2. SSH Connection
- Prompt for server IP
- Prompt for username (default: `root`)
- Prompt for auth method: SSH key or password
  - SSH key: prompt for private key path. Auto-detect default key in priority order: `~/.ssh/id_ed25519` > `~/.ssh/id_ecdsa` > `~/.ssh/id_rsa`. If none found, prompt for manual path.
  - Password: masked input, verify `sshpass` is installed locally. If not, display install instructions and abort.
- Use `StrictHostKeyChecking=accept-new` to handle first-time connections without hanging.
- Use `ConnectTimeout=10` to fail fast on unreachable hosts.
- Establish ControlMaster connection with spinner. ControlPath: `/tmp/securbuntu-<hash>` where `<hash>` is a short hash of `<user>@<host>:<port>` (avoids issues with IPv6 colons and long paths).
- Register SIGINT/SIGTERM handlers to clean up ControlMaster socket on unexpected exit.
- Detect server info immediately after connection:
  ```bash
  . /etc/os-release && echo "$ID|$VERSION_ID|$VERSION_CODENAME"
  systemctl is-active ssh.socket 2>/dev/null
  test -f /etc/ssh/sshd_config.d/50-cloud-init.conf && echo "cloud-init"
  whoami
  ```
- Abort with clear error if `$ID` is not `ubuntu` or `VERSION_ID` < 22.04

### 3. Privilege Handling
- If connected as root: all commands run directly.
- If connected as non-root user: all privileged commands are prefixed with `sudo`. The SSH wrapper provides a `sudoExec()` method that auto-prefixes. Since the user provided their password (or has key-based sudo), handle the sudo prompt via `SUDO_ASKPASS` or assume `NOPASSWD` sudo. If sudo fails, abort with a clear message explaining that root or passwordless-sudo is required.

### 4. System Update (automatic, unconditional)
Run `apt update && apt upgrade -y` with spinner. This is a security baseline and runs before the questionnaire. It is NOT subject to the confirmation gate in step 6 — system updates are always applied regardless of the user's other choices.

### 5. Interactive Questionnaire
All questions in English using `@clack/prompts`:

1. **Create sudo user** (only if connected as root):
   > "You are connected as root. Do you want to create a new sudo user?"
   - If yes: prompt for username and password
   - Explain: "A dedicated sudo user is recommended for daily operations instead of using root directly."

2. **Add personal SSH public key:**
   > "Do you want to add a personal SSH public key to the server?"
   - If yes: propose default public key path (auto-detect `~/.ssh/id_ed25519.pub` > `~/.ssh/id_ecdsa.pub` > `~/.ssh/id_rsa.pub`), with option to specify another path.
   - Read and validate the local `.pub` file content (must start with `ssh-` prefix).

3. **Configure for Coolify:**
   > "Do you want to configure this server for Coolify?"
   - If yes: info that root will remain accessible via SSH key only (`PermitRootLogin prohibit-password`). User must provide a public key for root access (personal key or separate key).
   - If no AND sudo user exists/will be created: propose `PermitRootLogin no`
   - If no AND no sudo user AND connected as root: keep `PermitRootLogin prohibit-password` (cannot disable root if it's the only access)

4. **Change SSH port:**
   > "Do you want to change the default SSH port (22)?"
   - If yes: prompt for new port (validate range 1024-65535)

5. **Disable password authentication:**
   > "Do you want to disable SSH password authentication?"
   - **Hard gate:** If yes, verify that at least one SSH key will be present in `authorized_keys` for the **target user** — i.e., the new sudo user if one is being created, otherwise the connection user. Check both: (a) a key is being added in step 2, and/or (b) an existing key is already on the server (query remote `authorized_keys`). If no key exists or will be injected for the target user, BLOCK this option and explain why: "Cannot disable password authentication: no SSH key found or being added for <target-user>. You would be locked out."

6. **Install UFW:**
   > "Do you want to install and configure UFW (firewall)?"
   - If yes: multi-select checklist with common ports:
     - SSH (current port, auto-selected, cannot uncheck)
     - HTTP (80/tcp) - "Web server traffic"
     - HTTPS (443/tcp) - "Secure web server traffic"
     - 8000/tcp - "Common development server"
     - 3000/tcp - "Node.js / Coolify UI"
     - Custom port (free input, supports ranges like `6000:6100`)
   - Each rule gets a descriptive UFW comment

7. **Install Fail2ban:**
   > "Do you want to install Fail2ban to protect against brute-force attacks?"

8. **Enable automatic security updates:**
   > "Do you want to enable automatic security updates (unattended-upgrades)?"

### 6. Confirmation Before Execution

Display a summary of all selected options using a styled clack note/box:
```
  Summary of changes:
  - Create sudo user: deploy
  - Add SSH key: ~/.ssh/id_ed25519.pub
  - Coolify: No
  - SSH port: 2222
  - Disable password auth: Yes
  - UFW: Yes (ports: 2222, 80, 443)
  - Fail2ban: Yes
  - Auto-updates: Yes
```

Prompt: "Apply these changes to <host>?"
- If no: abort gracefully.

### 7. Execution

Tasks run sequentially in this **strict order** (order matters for safety):

1. **`update.ts`** — System update (apt update && upgrade)
2. **`user.ts`** — Create sudo user (if requested)
3. **`ssh-keys.ts`** — Inject SSH keys into authorized_keys
4. **`ufw.ts`** — Install and configure UFW (before SSH config change, so the new port is allowed)
5. **`fail2ban.ts`** — Install and configure Fail2ban
6. **`unattended.ts`** — Configure unattended-upgrades
7. **`ssh-config.ts`** — Harden sshd_config (**LAST**, because it may change port/restart SSH)

Each task shows a spinner during execution.

#### Idempotency

All tasks must be safe to run multiple times:
- `user.ts`: check if user exists (`id <username>`) before creating
- `ssh-keys.ts`: check if key already in `authorized_keys` before appending
- `ssh-config.ts`: overwrite `01-securbuntu.conf` (it's ours to manage)
- `ufw.ts`: `ufw allow` is idempotent by nature; check if already enabled before enabling
- `fail2ban.ts`: overwrite `securbuntu.local` (it's ours to manage)
- `unattended.ts`: overwrite `20auto-upgrades` (standard file)

#### Task: Create sudo user (`user.ts`)
```bash
id <username> 2>/dev/null || adduser --disabled-password --gecos "" <username>
printf '%s:%s' '<username>' '<password>' | chpasswd
usermod -aG sudo <username>
mkdir -p /home/<username>/.ssh
chmod 700 /home/<username>/.ssh
touch /home/<username>/.ssh/authorized_keys
chmod 600 /home/<username>/.ssh/authorized_keys
chown -R <username>:<username> /home/<username>/.ssh
```

**Password safety:** Never interpolate the password into the remote command string (visible in `ps`). Instead, pipe the credential pair directly through `Bun.spawn`'s stdin into the SSH process:
```typescript
// The password never appears in any command string or process argument list
const proc = Bun.spawn(["ssh", ...sshArgs, "chpasswd"], {
  stdin: Buffer.from(`${username}:${password}\n`)
});
```
This ensures the password travels only through the SSH encrypted channel's stdin pipe.

#### Task: Inject SSH keys (`ssh-keys.ts`)
- Read local `.pub` file content
- Append to `~/.ssh/authorized_keys` of target user (sudo user if created, otherwise connection user)
- If Coolify: also inject into `/root/.ssh/authorized_keys`
- Check if key already exists before appending (grep for the key content)
- Set correct permissions (600 for authorized_keys, 700 for .ssh directory)

#### Task: Configure UFW (`ufw.ts`)
```bash
apt install -y ufw
# Add rules with comments — SSH port FIRST
ufw allow <ssh-port>/tcp comment 'SecurBuntu: SSH access'
ufw allow 80/tcp comment 'SecurBuntu: HTTP web traffic'
ufw allow 443/tcp comment 'SecurBuntu: HTTPS web traffic'
# ... additional selected ports
ufw --force enable
```

Always add the SSH port rule FIRST before enabling UFW to prevent lockout.

#### Task: Configure Fail2ban (`fail2ban.ts`)
```bash
apt install -y fail2ban
```

Write `/etc/fail2ban/jail.d/securbuntu.local` — version-adaptive:

**Ubuntu 22.04:**
```ini
[sshd]
enabled = true
port = <ssh-port>
maxretry = 5
findtime = 600
bantime = 3600
backend = auto
banaction = iptables-multiport
```

**Ubuntu 24.04+:**
```ini
[sshd]
enabled = true
port = <ssh-port>
maxretry = 5
findtime = 600
bantime = 3600
backend = systemd
banaction = nftables
journalmatch = _SYSTEMD_UNIT=ssh.service + _COMM=sshd
```

Then: `systemctl enable fail2ban && systemctl restart fail2ban`

#### Task: Configure unattended-upgrades (`unattended.ts`)
```bash
apt install -y unattended-upgrades
```

Verify `/etc/apt/apt.conf.d/50unattended-upgrades` exists. If not, warn in the report.

Write `/etc/apt/apt.conf.d/20auto-upgrades`:
```
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
```

#### Task: Harden SSH config (`ssh-config.ts`) — RUNS LAST

This task is the most critical and runs last because it may change the SSH port and restart the service.

**Step 1:** Write `/etc/ssh/sshd_config.d/01-securbuntu.conf`:
```
# SecurBuntu SSH Hardening - generated on <date>
Port <port>
PermitRootLogin <prohibit-password|no>
PasswordAuthentication <yes|no>
PubkeyAuthentication yes
AuthorizedKeysFile .ssh/authorized_keys
X11Forwarding no
MaxAuthTries 5
```

**Step 2:** Handle cloud-init conflict:
- If `/etc/ssh/sshd_config.d/50-cloud-init.conf` exists and contains conflicting directives (`PasswordAuthentication`, `PermitRootLogin`):
  1. Back up the file to `50-cloud-init.conf.securbuntu-backup` before modification.
  2. Comment out conflicting lines with `# Disabled by SecurBuntu:` prefix.
  3. On rollback, restore from the `.securbuntu-backup` file.

**Step 3:** Validate config with `sshd -t -f /etc/ssh/sshd_config` (validates full config chain including `sshd_config.d/`).
- If validation fails: rollback (remove `01-securbuntu.conf`, restore `50-cloud-init.conf`), report error, skip restart.

**Step 4:** Restart SSH (version-adaptive):
- `systemctl restart ssh.service` — works on both 22.04 and 24.04+
- If `ssh.socket` is active AND port was changed: also run `systemctl daemon-reload && systemctl restart ssh.socket` to update the socket listener.

**Step 5:** Verify connectivity after restart:
- The existing ControlMaster socket survives the SSH service restart (it's a local process, not killed by remote sshd restart).
- After restart, exec a simple test command (`echo ok`) through the existing ControlMaster to verify the session is still alive.
- If the session died (port change edge case), attempt to reconnect on the new port.
- If reconnection fails, display emergency message: "SSH configuration was applied but connection was lost. Connect manually with: ssh -p <new-port> <user>@<host>"

### 8. Final Report

Display a colored terminal summary using picocolors:
- Server IP and connection user
- New sudo user (if created)
- Ubuntu version detected
- Each task result with success/failure indicator
- New SSH port (highlighted if changed)
- Warning if password auth was disabled (remind about SSH key access)
- New SSH connection command: `ssh -p <port> <user>@<host>`

Prompt: "Do you want to export this report as a Markdown file?"
- If yes: save to `./securbuntu-report-<sanitized-ip>-<date>.md` locally (replace `:` with `-` for IPv6 safety)

## Ubuntu Version Compatibility

| Feature | Ubuntu 22.04 | Ubuntu 24.04+ |
|---------|-------------|---------------|
| SSH restart | `systemctl restart ssh.service` | `systemctl restart ssh.service` + `daemon-reload && restart ssh.socket` if port changed |
| SSH config location | `/etc/ssh/sshd_config.d/01-securbuntu.conf` | Same |
| cloud-init override | Check `50-cloud-init.conf` | Same |
| Fail2ban backend | `auto` | `systemd` |
| Fail2ban banaction | `iptables-multiport` | `nftables` |
| Fail2ban journalmatch | Not needed | `_SYSTEMD_UNIT=ssh.service + _COMM=sshd` |
| UFW | Same across versions | Same |
| unattended-upgrades | Same across versions | Same |

Detection strategy:
1. Read `/etc/os-release` for `ID` and `VERSION_ID`
2. Check `systemctl is-active ssh.socket` for runtime state
3. Check existence of `50-cloud-init.conf`
4. Adapt behavior based on all three signals

## Safety Protocol

### Lockout Prevention
1. **Password auth disable gate:** Never disable `PasswordAuthentication` unless at least one SSH key is confirmed present (or being injected) in the target user's `authorized_keys`.
2. **UFW SSH gate:** Always add the SSH port to UFW rules before enabling the firewall.
3. **SSH config last:** Run SSH config hardening as the last task so all other changes (keys, UFW, Fail2ban) are already in place.
4. **Config validation:** Always run `sshd -t -f /etc/ssh/sshd_config` before restarting SSH.

### Rollback Procedures
- **SSH config failure (`sshd -t` fails):** Remove `/etc/ssh/sshd_config.d/01-securbuntu.conf`, restore any commented lines in `50-cloud-init.conf`, do not restart SSH.
- **SSH restart failure:** Attempt to remove `01-securbuntu.conf` and restart SSH again. If that also fails, display manual recovery instructions.
- **UFW lockout (shouldn't happen due to SSH gate):** `ufw disable` as emergency fallback.

### Cleanup on Exit
- Register `process.on("SIGINT")` and `process.on("SIGTERM")` handlers.
- Close ControlMaster socket (`ssh -O exit`) on any exit path.
- If interrupted mid-execution, display which tasks completed and which didn't.

## Error Handling

- SSH connection failure: clear error message with troubleshooting hints
- Command execution failure: log stderr, mark task as failed, continue with remaining tasks (except: SSH config task failure should not proceed to restart)
- Config validation failure (`sshd -t`): rollback changes, report error
- Missing `sshpass`: display platform-specific install instructions, abort
- Non-Ubuntu system: abort with clear message after detection
- Unsupported Ubuntu version (<22.04): abort with clear message
