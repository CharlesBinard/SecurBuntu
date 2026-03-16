<div align="center">

```
   ____                       ____              _
  / ___|  ___  ___ _   _ _ __| __ ) _   _ _ __ | |_ _   _
  \___ \ / _ \/ __| | | | '__|  _ \| | | | '_ \| __| | | |
   ___) |  __/ (__| |_| | |  | |_) | |_| | | | | |_| |_| |
  |____/ \___|\___|\__,_|_|  |____/ \__,_|_| |_|\__|\__,_|
```

**Harden your Ubuntu server in minutes, not hours.**

[![Bun](https://img.shields.io/badge/runtime-Bun-f9a8d4?style=for-the-badge&logo=bun&logoColor=white)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/lang-TypeScript-3178c6?style=for-the-badge&logo=typescript&logoColor=white)](https://typescriptlang.org)
[![Ubuntu](https://img.shields.io/badge/target-Ubuntu_22.04+-E95420?style=for-the-badge&logo=ubuntu&logoColor=white)](https://ubuntu.com)
[![License](https://img.shields.io/badge/license-MIT-green?style=for-the-badge)](#license)

---

An interactive CLI that connects to your Ubuntu server via SSH and walks you through a complete security hardening — from creating a sudo user to locking down the kernel. No Ansible, no YAML, no headaches.

</div>

## Features

| | Feature | What it does |
|---|---------|-------------|
| :bust_in_silhouette: | **Sudo user creation** | Create a dedicated non-root user with sudo privileges |
| :key: | **SSH key injection** | Deploy your public key + optional Coolify root access |
| :lock: | **SSH hardening** | Custom port, disable root/password login, MaxAuthTries, X11, banner |
| :shield: | **UFW firewall** | Install & configure with preset + custom port rules |
| :cop: | **Fail2ban** | Brute-force protection with auto-configured jails |
| :arrows_counterclockwise: | **Auto-updates** | Unattended security upgrades via `apt` |
| :gear: | **Kernel hardening** | Sysctl tweaks: SYN flood, ICMP, source routing, forwarding |
| :mag: | **Security audit** | Before & after scan with visual diff of what changed |
| :test_tube: | **Dry-run mode** | Preview every command without touching the server |
| :page_facing_up: | **Reports & logs** | Export Markdown reports and full command logs |

## Quick Start

```bash
# Install dependencies
bun install

# Run SecurBuntu
bun src/index.ts
```

That's it. The interactive wizard handles the rest.

## CLI Options

```
Usage: bun src/index.ts [options]

Options:
  --audit     Run security audit only (no hardening)
  --dry-run   Preview changes without applying them
  --log       Automatically save execution log
  -h, --help  Show this help message
```

### Examples

```bash
# Full interactive hardening
bun src/index.ts

# Just scan — see what needs fixing
bun src/index.ts --audit

# Preview what would happen (safe to run anytime)
bun src/index.ts --dry-run

# Harden + auto-save the command log
bun src/index.ts --log
```

## How It Works

```
┌─────────────┐    ┌──────────────┐    ┌────────────────┐    ┌──────────────┐
│  Connect     │───>│  Audit       │───>│  Questionnaire  │───>│  Execute     │
│  via SSH     │    │  (before)    │    │  (pick options) │    │  tasks       │
└─────────────┘    └──────────────┘    └────────────────┘    └──────┬───────┘
                                                                    │
                   ┌──────────────┐    ┌────────────────┐           │
                   │  Export      │<───│  Audit         │<──────────┘
                   │  report/log  │    │  (after)       │
                   └──────────────┘    └────────────────┘
```

1. **Connect** — SSH into your server (key, password, or copy-key auth)
2. **Audit** — Scan current security posture
3. **Choose** — Pick what to harden via interactive prompts
4. **Preview or Apply** — Simulate first or go live
5. **Audit again** — See the before/after diff
6. **Report** — Get a summary + optional Markdown export

## Authentication

SecurBuntu supports three ways to connect:

| Method | Description |
|--------|-------------|
| **SSH Key** | Uses your existing key pair (recommended) |
| **Password** | Authenticates with `sshpass` |
| **Copy Key** | Deploys your key via `ssh-copy-id`, then connects with it |

It also handles non-root users with sudo password prompts, and verifies host key fingerprints before connecting.

## Requirements

- [Bun](https://bun.sh) v1.0+
- A target server running **Ubuntu 22.04** or later
- SSH access to the server (root or sudo user)

Optional (for password-based auth):
- `sshpass` — `brew install sshpass` / `apt install sshpass`
- `ssh-copy-id` — usually included with OpenSSH

## Project Structure

```
src/
├── index.ts          # Main orchestrator
├── ssh.ts            # SSH connection (ControlMaster-based)
├── prompts.ts        # Interactive questionnaire
├── audit.ts          # Security audit scanner
├── report.ts         # Report display & Markdown export
├── logging.ts        # Command logging wrapper
├── dry-run.ts        # Dry-run simulation wrapper
├── ui.ts             # Banner & version
├── types.ts          # TypeScript interfaces
└── tasks/
    ├── index.ts      # Task runner with stop-on-failure
    ├── user.ts       # Create sudo user
    ├── ssh-keys.ts   # SSH key injection
    ├── ssh-config.ts # SSH hardening + rollback
    ├── ufw.ts        # UFW firewall setup
    ├── fail2ban.ts   # Fail2ban configuration
    ├── unattended.ts # Automatic updates
    └── sysctl.ts     # Kernel parameter hardening
```

## Testing

```bash
bun test
```

95 tests covering audit, tasks, dry-run, logging, and reporting.

## Safety First

SecurBuntu is built with safety in mind:

- **Host key verification** — fingerprint check before any connection
- **SSH config rollback** — if `sshd -t` validation fails, changes are automatically reverted
- **Lockout prevention** — won't let you disable password auth without a key in place
- **Input validation** — shell injection prevention, port range checks, username format validation
- **Dry-run mode** — preview everything before committing
- **Stop-on-failure** — choose to continue or abort when a task fails

## License

MIT

---

<div align="center">

Built with :purple_heart: and [Bun](https://bun.sh)

</div>
