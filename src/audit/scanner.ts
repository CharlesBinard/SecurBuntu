import type { AuditResult, SshClient } from "../types.ts"

export async function runAudit(ssh: SshClient): Promise<AuditResult> {
  const checks: AuditResult["checks"] = []

  // SSH Port
  const portResult = await ssh.exec(
    "grep -h '^Port ' /etc/ssh/sshd_config.d/*.conf /etc/ssh/sshd_config 2>/dev/null | tail -1",
  )
  const port = portResult.stdout.replace("Port ", "").trim() || "22 (default)"
  checks.push({ name: "SSH Port", status: port })

  // Root login
  const rootResult = await ssh.exec(
    "grep -h '^PermitRootLogin ' /etc/ssh/sshd_config.d/*.conf /etc/ssh/sshd_config 2>/dev/null | tail -1",
  )
  const rootLogin = rootResult.stdout.replace("PermitRootLogin ", "").trim() || "yes (default)"
  checks.push({ name: "Root Login", status: rootLogin })

  // Password auth
  const pwResult = await ssh.exec(
    "grep -h '^PasswordAuthentication ' /etc/ssh/sshd_config.d/*.conf /etc/ssh/sshd_config 2>/dev/null | tail -1",
  )
  const pwAuth = pwResult.stdout.replace("PasswordAuthentication ", "").trim() || "yes (default)"
  checks.push({ name: "Password Auth", status: pwAuth })

  // UFW
  const ufwResult = await ssh.exec("which ufw > /dev/null 2>&1 && ufw status | head -1 || echo 'not installed'")
  checks.push({ name: "UFW Firewall", status: ufwResult.stdout.replace("Status: ", "").trim() })

  // Fail2ban
  const f2bResult = await ssh.exec("systemctl is-active fail2ban 2>/dev/null || echo 'not installed'")
  checks.push({ name: "Fail2ban", status: f2bResult.stdout.trim() })

  // Auto-updates
  const autoResult = await ssh.exec(
    "test -f /etc/apt/apt.conf.d/20auto-upgrades && grep -q 'Unattended-Upgrade \"1\"' /etc/apt/apt.conf.d/20auto-upgrades && echo enabled || echo 'not configured'",
  )
  checks.push({ name: "Auto-updates", status: autoResult.stdout.trim() })

  // Sudo users
  const sudoResult = await ssh.exec("grep -Po '^sudo:.*:\\K.*' /etc/group 2>/dev/null || echo 'none'")
  checks.push({ name: "Sudo Users", status: sudoResult.stdout.trim() || "none" })

  // SSH keys
  const keysResult = await ssh.exec(
    "for f in /home/*/.ssh/authorized_keys /root/.ssh/authorized_keys; do " +
      'test -f "$f" && echo "$(grep -c \'ssh-\' "$f" 2>/dev/null || echo 0) key(s) in $f"; ' +
      "done 2>/dev/null || echo 'none found'",
  )
  checks.push({ name: "SSH Keys", status: keysResult.stdout.trim() || "none found" })

  // Sysctl hardening
  const sysctlResult = await ssh.exec("test -f /etc/sysctl.d/99-securbuntu.conf && echo hardened || echo default")
  checks.push({ name: "Sysctl Hardening", status: sysctlResult.stdout.trim() })

  // SSH banner
  const bannerResult = await ssh.exec(
    "grep -h '^Banner ' /etc/ssh/sshd_config.d/*.conf /etc/ssh/sshd_config 2>/dev/null | tail -1",
  )
  checks.push({ name: "SSH Banner", status: bannerResult.stdout.trim() || "not set" })

  return { checks }
}
