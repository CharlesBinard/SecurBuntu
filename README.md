<div align="center">

<br>

<img src="https://img.shields.io/badge/SecurBuntu-000000?style=for-the-badge&logoColor=white" alt="SecurBuntu" height="40">

<br><br>

### Harden your Ubuntu server in minutes, not hours.

An interactive CLI that connects via SSH and walks you through a complete security hardening.<br>No Ansible. No YAML. No headaches.

<br>

[![CI](https://github.com/CharlesBinard/SecurBuntu/actions/workflows/ci.yml/badge.svg)](https://github.com/CharlesBinard/SecurBuntu/actions/workflows/ci.yml)
[![Coverage](https://coveralls.io/repos/github/CharlesBinard/SecurBuntu/badge.svg?branch=main)](https://coveralls.io/github/CharlesBinard/SecurBuntu?branch=main)
[![Bun](https://img.shields.io/badge/Bun-f9a8d4?logo=bun&logoColor=white)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178c6?logo=typescript&logoColor=white)](https://typescriptlang.org)
[![Ubuntu](https://img.shields.io/badge/Ubuntu_22.04+-E95420?logo=ubuntu&logoColor=white)](https://ubuntu.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

</div>

<br>

## What it does

> Connect &rarr; Audit &rarr; Choose &rarr; Harden &rarr; Report

```
 SSH in ──> Security Scan ──> Interactive Prompts ──> Execute Tasks ──> Before/After Diff
```

SecurBuntu scans your server's security posture, lets you pick what to fix through a guided questionnaire, applies the changes, and shows you a before/after comparison.

<br>

## Features

| | Feature | Description |
|:--:|---------|-------------|
| **1** | **Sudo user** | Create a dedicated non-root user with sudo privileges |
| **2** | **SSH keys** | Auto-detect local keys, deploy to server, optional Coolify root access |
| **3** | **SSH hardening** | Custom port, disable root/password login, MaxAuthTries, X11, banner |
| **4** | **UFW firewall** | Install & configure with preset + custom port rules |
| **5** | **Fail2ban** | Brute-force protection with auto-configured jails |
| **6** | **Auto-updates** | Unattended security upgrades via `apt` |
| **7** | **Disable services** | Detect & remove unnecessary services (cups, avahi, snapd...) |
| **8** | **File permissions** | Audit & fix permissions on /etc/shadow, sshd_config, crontab... |
| **9** | **Kernel hardening** | Sysctl tweaks: SYN flood, ICMP, source routing, forwarding |
| **10** | **Security audit** | Before & after scan with visual diff of what changed |
| **11** | **Dry-run mode** | Preview every command without touching the server |
| **12** | **Reports** | Export Markdown reports and full command logs |

<br>

## Quick start

```bash
bun install
bun src/index.ts
```

The interactive wizard handles the rest.

<br>

## Usage

```
Usage: bun src/index.ts [options]

Options:
  --audit     Security audit only (no changes)
  --dry-run   Preview changes without applying
  --log       Auto-save execution log
  -h, --help  Show help
```

```bash
bun src/index.ts              # Full interactive hardening
bun src/index.ts --audit      # Just scan
bun src/index.ts --dry-run    # Preview mode
bun src/index.ts --log        # Harden + save log
```

<br>

## How it works

```
  1. Connect         2. Audit            3. Choose           4. Execute
 ┌──────────┐     ┌──────────┐      ┌──────────────┐     ┌──────────┐
 │  SSH in   │────>│  Scan    │─────>│  Interactive  │────>│  Apply   │
 │  (key/pw) │     │  server  │      │  prompts     │     │  tasks   │
 └──────────┘     └──────────┘      └──────────────┘     └─────┬────┘
                                                               │
                    5. Report           6. Compare             │
                  ┌──────────┐      ┌──────────────┐          │
                  │  Export   │<────│  Before/After │<─────────┘
                  │  MD/log   │     │  audit diff   │
                  └──────────┘     └──────────────┘
```

<br>

## Context-aware prompts

SecurBuntu reads the server state before asking questions:

- Detects the **current SSH port** and uses it everywhere (prompts, Fail2ban, UFW, summary)
- Shows **"already active"** for UFW/Fail2ban instead of asking to install
- Lists **existing SSH keys** on the server before asking to add one
- Auto-detects **local SSH keys** (~/.ssh/) and lets you pick from a list

<br>

## Authentication

| Method | Description |
|:------:|-------------|
| **SSH Key** | Auto-detects local keys, select from list (recommended) |
| **Password** | Authenticates with `sshpass` |
| **Copy Key** | Deploys your key via `ssh-copy-id`, then connects |

Handles non-root users with sudo password prompts. Verifies host key fingerprints before connecting.

<br>

## Safety

- **Host key verification** before any connection
- **SSH config rollback** if `sshd -t` validation fails
- **Lockout prevention** won't disable password auth without a key in place
- **Input validation** shell injection prevention, port range checks
- **Dry-run mode** preview everything before committing
- **Stop-on-failure** choose to continue or abort when a task fails

<br>

## Requirements

- [Bun](https://bun.sh) v1.0+
- Target server: **Ubuntu 22.04+**
- SSH access (root or sudo user)

Optional: `sshpass` (for password auth), `ssh-copy-id` (for key copy)

<br>

## Testing

```bash
bun test             # 156 tests
bun test --coverage  # With coverage report
bun run check        # Lint + type check
```

<br>

## Project structure

```
src/
├── index.ts              # Entry point
├── orchestrator.ts       # Main flow
├── types.ts              # Interfaces
├── audit/                # Security scanner + display
├── cli/                  # Args parsing + banner
├── connection/           # SSH connection + retry
├── prompts/              # Interactive questionnaire
│   ├── hardening.ts      #   Main flow
│   ├── connection.ts     #   SSH key selection
│   ├── services.ts       #   Service disabling
│   ├── ufw.ts            #   Firewall rules
│   └── confirmation.ts   #   Summary + confirm
├── report/               # Display + Markdown export
├── ssh/                  # Connection, keys, host verification
└── tasks/                # Hardening tasks
    ├── user.ts           #   Sudo user
    ├── ssh-keys.ts       #   Key injection
    ├── ssh-config.ts     #   SSH hardening + rollback
    ├── ufw.ts            #   Firewall
    ├── fail2ban.ts       #   Brute-force protection
    ├── unattended.ts     #   Auto-updates
    ├── services.ts       #   Disable services
    ├── permissions.ts    #   File permissions
    └── sysctl.ts         #   Kernel hardening
```

<br>

## License

[MIT](LICENSE)

<br>

<div align="center">
<sub>Built with <a href="https://bun.sh">Bun</a> + TypeScript</sub>
</div>
