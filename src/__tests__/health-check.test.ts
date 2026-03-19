import { describe, expect, test } from "bun:test"
import { MockSystemClient } from "./helpers/mock-ssh.ts"
import { runHealthCheck } from "../audit/health-check.ts"

describe("runHealthCheck", () => {
  test("returns 15 checks total", async () => {
    const client = new MockSystemClient()
    const checks = await runHealthCheck(client)
    expect(checks).toHaveLength(15)
  })

  test("all checks have category, label, and status", async () => {
    const client = new MockSystemClient()
    const checks = await runHealthCheck(client)
    for (const check of checks) {
      expect(check.category).toBeTruthy()
      expect(check.label).toBeTruthy()
      expect(["pass", "warn", "fail", "info"]).toContain(check.status)
    }
  })

  // SSH Root Login
  test("root login 'no' is pass", async () => {
    const client = new MockSystemClient()
    client.onExec("grep -h '^PermitRootLogin '", { stdout: "PermitRootLogin no" })
    const checks = await runHealthCheck(client)
    const check = checks.find((c) => c.label === "Root login disabled")
    expect(check?.status).toBe("pass")
  })

  test("root login 'prohibit-password' is pass", async () => {
    const client = new MockSystemClient()
    client.onExec("grep -h '^PermitRootLogin '", { stdout: "PermitRootLogin prohibit-password" })
    const checks = await runHealthCheck(client)
    const check = checks.find((c) => c.label === "Root login disabled")
    expect(check?.status).toBe("pass")
  })

  test("root login default is fail", async () => {
    const client = new MockSystemClient()
    const checks = await runHealthCheck(client)
    const check = checks.find((c) => c.label === "Root login disabled")
    expect(check?.status).toBe("fail")
  })

  // SSH Password Auth
  test("password auth 'no' is pass", async () => {
    const client = new MockSystemClient()
    client.onExec("grep -h '^PasswordAuthentication '", { stdout: "PasswordAuthentication no" })
    const checks = await runHealthCheck(client)
    const check = checks.find((c) => c.label === "Password authentication disabled")
    expect(check?.status).toBe("pass")
  })

  test("password auth default is fail", async () => {
    const client = new MockSystemClient()
    const checks = await runHealthCheck(client)
    const check = checks.find((c) => c.label === "Password authentication disabled")
    expect(check?.status).toBe("fail")
  })

  // SSH Port
  test("custom SSH port is pass", async () => {
    const client = new MockSystemClient()
    client.onExec("grep -h '^Port '", { stdout: "Port 2222" })
    const checks = await runHealthCheck(client)
    const check = checks.find((c) => c.label === "Custom SSH port")
    expect(check?.status).toBe("pass")
    expect(check?.detail).toBe("port 2222")
  })

  test("default SSH port 22 is warn", async () => {
    const client = new MockSystemClient()
    const checks = await runHealthCheck(client)
    const check = checks.find((c) => c.label === "Custom SSH port")
    expect(check?.status).toBe("warn")
    expect(check?.detail).toBe("port 22 (default)")
  })

  // MaxAuthTries
  test("MaxAuthTries 3 is pass", async () => {
    const client = new MockSystemClient()
    client.onExec("grep -h '^MaxAuthTries '", { stdout: "MaxAuthTries 3" })
    const checks = await runHealthCheck(client)
    const check = checks.find((c) => c.label === "MaxAuthTries")
    expect(check?.status).toBe("pass")
  })

  test("MaxAuthTries 5 is warn", async () => {
    const client = new MockSystemClient()
    client.onExec("grep -h '^MaxAuthTries '", { stdout: "MaxAuthTries 5" })
    const checks = await runHealthCheck(client)
    const check = checks.find((c) => c.label === "MaxAuthTries")
    expect(check?.status).toBe("warn")
  })

  test("MaxAuthTries default (6) is warn", async () => {
    const client = new MockSystemClient()
    const checks = await runHealthCheck(client)
    const check = checks.find((c) => c.label === "MaxAuthTries")
    expect(check?.status).toBe("warn")
    expect(check?.detail).toBe("6 (default, recommended: 3)")
  })

  // X11 Forwarding
  test("X11Forwarding 'no' is pass", async () => {
    const client = new MockSystemClient()
    client.onExec("grep -h '^X11Forwarding '", { stdout: "X11Forwarding no" })
    const checks = await runHealthCheck(client)
    const check = checks.find((c) => c.label === "X11 forwarding disabled")
    expect(check?.status).toBe("pass")
  })

  test("X11Forwarding default is fail", async () => {
    const client = new MockSystemClient()
    const checks = await runHealthCheck(client)
    const check = checks.find((c) => c.label === "X11 forwarding disabled")
    expect(check?.status).toBe("fail")
  })

  // SSH Banner
  test("SSH banner set is pass", async () => {
    const client = new MockSystemClient()
    client.onExec("grep -h '^Banner '", { stdout: "Banner /etc/issue.net" })
    const checks = await runHealthCheck(client)
    const check = checks.find((c) => c.label === "SSH banner configured")
    expect(check?.status).toBe("pass")
  })

  test("SSH banner not set is warn", async () => {
    const client = new MockSystemClient()
    const checks = await runHealthCheck(client)
    const check = checks.find((c) => c.label === "SSH banner configured")
    expect(check?.status).toBe("warn")
  })

  // UFW
  test("UFW active is pass", async () => {
    const client = new MockSystemClient()
    client.onExec("which ufw", { stdout: "Status: active" })
    const checks = await runHealthCheck(client)
    const check = checks.find((c) => c.label === "UFW firewall active")
    expect(check?.status).toBe("pass")
  })

  test("UFW not installed is fail", async () => {
    const client = new MockSystemClient()
    client.onExec("which ufw", { stdout: "not installed" })
    const checks = await runHealthCheck(client)
    const check = checks.find((c) => c.label === "UFW firewall active")
    expect(check?.status).toBe("fail")
  })

  test("UFW inactive is warn", async () => {
    const client = new MockSystemClient()
    client.onExec("which ufw", { stdout: "inactive" })
    const checks = await runHealthCheck(client)
    const check = checks.find((c) => c.label === "UFW firewall active")
    expect(check?.status).toBe("warn")
  })

  // UFW Rules (mock returns what grep -c produces: a count string)
  test("UFW with rules is pass", async () => {
    const client = new MockSystemClient()
    client.onExec("which ufw", { stdout: "Status: active" })
    client.onExec("ufw status numbered", { stdout: "2" })
    const checks = await runHealthCheck(client)
    const check = checks.find((c) => c.label === "UFW rules configured")
    expect(check?.status).toBe("pass")
    expect(check?.detail).toBe("2 rules")
  })

  test("UFW with zero rules is warn", async () => {
    const client = new MockSystemClient()
    client.onExec("which ufw", { stdout: "Status: active" })
    client.onExec("ufw status numbered", { stdout: "0" })
    const checks = await runHealthCheck(client)
    const check = checks.find((c) => c.label === "UFW rules configured")
    expect(check?.status).toBe("warn")
    expect(check?.detail).toBe("0 rules")
  })

  // Fail2ban
  test("fail2ban active is pass", async () => {
    const client = new MockSystemClient()
    client.onExec("systemctl is-active fail2ban", { stdout: "active" })
    const checks = await runHealthCheck(client)
    const check = checks.find((c) => c.label === "Fail2ban active")
    expect(check?.status).toBe("pass")
  })

  test("fail2ban not installed is fail", async () => {
    const client = new MockSystemClient()
    client.onExec("systemctl is-active fail2ban", { stdout: "not installed" })
    const checks = await runHealthCheck(client)
    const check = checks.find((c) => c.label === "Fail2ban active")
    expect(check?.status).toBe("fail")
  })

  test("fail2ban inactive is warn", async () => {
    const client = new MockSystemClient()
    client.onExec("systemctl is-active fail2ban", { stdout: "inactive" })
    const checks = await runHealthCheck(client)
    const check = checks.find((c) => c.label === "Fail2ban active")
    expect(check?.status).toBe("warn")
  })

  // Sudo users
  test("sudo user present is pass", async () => {
    const client = new MockSystemClient()
    client.onExec("grep -Po '^sudo:.*:\\K.*'", { stdout: "deploy" })
    const checks = await runHealthCheck(client)
    const check = checks.find((c) => c.label === "Non-root sudo user exists")
    expect(check?.status).toBe("pass")
    expect(check?.detail).toBe("deploy")
  })

  test("no sudo users is warn", async () => {
    const client = new MockSystemClient()
    client.onExec("grep -Po '^sudo:.*:\\K.*'", { stdout: "none" })
    const checks = await runHealthCheck(client)
    const check = checks.find((c) => c.label === "Non-root sudo user exists")
    expect(check?.status).toBe("warn")
  })

  // Auto-updates
  test("auto-updates enabled is pass", async () => {
    const client = new MockSystemClient()
    client.onExec("test -f /etc/apt/apt.conf.d/20auto-upgrades", { stdout: "enabled" })
    const checks = await runHealthCheck(client)
    const check = checks.find((c) => c.label === "Unattended-upgrades enabled")
    expect(check?.status).toBe("pass")
  })

  test("auto-updates not configured is fail", async () => {
    const client = new MockSystemClient()
    client.onExec("test -f /etc/apt/apt.conf.d/20auto-upgrades", { stdout: "not configured" })
    const checks = await runHealthCheck(client)
    const check = checks.find((c) => c.label === "Unattended-upgrades enabled")
    expect(check?.status).toBe("fail")
  })

  // Services
  test("no unnecessary services is pass", async () => {
    const client = new MockSystemClient()
    client.onExec("systemctl list-units --type=service --state=active", {
      stdout: "ssh.service loaded active running OpenBSD Secure Shell server",
    })
    const checks = await runHealthCheck(client)
    const check = checks.find((c) => c.label === "No unnecessary services")
    expect(check?.status).toBe("pass")
  })

  test("unnecessary services found is warn", async () => {
    const client = new MockSystemClient()
    client.onExec("systemctl list-units --type=service --state=active", {
      stdout: "cups.service loaded active running CUPS\navahi-daemon.service loaded active running Avahi",
    })
    const checks = await runHealthCheck(client)
    const check = checks.find((c) => c.label === "No unnecessary services")
    expect(check?.status).toBe("warn")
    expect(check?.detail).toContain("cups")
  })

  // File permissions
  test("all permissions correct is pass", async () => {
    const client = new MockSystemClient()
    client.onExec("ls /etc/ssh/ssh_host_*_key", { exitCode: 1 })
    client.onExec("stat -c '%a %U %G' '/etc/passwd'", { stdout: "644 root root" })
    client.onExec("stat -c '%a %U %G' '/etc/shadow'", { stdout: "640 root shadow" })
    client.onExec("stat -c '%a %U %G' '/etc/gshadow'", { stdout: "640 root shadow" })
    client.onExec("stat -c '%a %U %G' '/etc/group'", { stdout: "644 root root" })
    client.onExec("stat -c '%a %U %G' '/etc/ssh/sshd_config'", { stdout: "600 root root" })
    client.onExec("stat -c '%a %U %G' '/etc/crontab'", { stdout: "600 root root" })
    const checks = await runHealthCheck(client)
    const check = checks.find((c) => c.label === "File permissions correct")
    expect(check?.status).toBe("pass")
  })

  test("non-conforming permissions is fail", async () => {
    const client = new MockSystemClient()
    client.onExec("ls /etc/ssh/ssh_host_*_key", { exitCode: 1 })
    client.onExec("stat -c '%a %U %G' '/etc/passwd'", { stdout: "644 root root" })
    client.onExec("stat -c '%a %U %G' '/etc/shadow'", { stdout: "644 root root" }) // wrong
    client.onExec("stat -c '%a %U %G' '/etc/gshadow'", { stdout: "640 root shadow" })
    client.onExec("stat -c '%a %U %G' '/etc/group'", { stdout: "644 root root" })
    client.onExec("stat -c '%a %U %G' '/etc/ssh/sshd_config'", { stdout: "600 root root" })
    client.onExec("stat -c '%a %U %G' '/etc/crontab'", { stdout: "600 root root" })
    const checks = await runHealthCheck(client)
    const check = checks.find((c) => c.label === "File permissions correct")
    expect(check?.status).toBe("fail")
  })

  // Sysctl
  test("sysctl hardened is pass", async () => {
    const client = new MockSystemClient()
    client.onExec("test -f /etc/sysctl.d/99-securbuntu.conf", { stdout: "hardened" })
    const checks = await runHealthCheck(client)
    const check = checks.find((c) => c.label === "Sysctl hardening applied")
    expect(check?.status).toBe("pass")
  })

  test("sysctl default is warn", async () => {
    const client = new MockSystemClient()
    const checks = await runHealthCheck(client)
    const check = checks.find((c) => c.label === "Sysctl hardening applied")
    expect(check?.status).toBe("warn")
  })

  // Tailscale
  test("tailscale active is info", async () => {
    const client = new MockSystemClient()
    client.onExec("tailscale status --json", { stdout: '{"Self":{"HostName":"myserver"}}' })
    const checks = await runHealthCheck(client)
    const check = checks.find((c) => c.label === "Tailscale VPN")
    expect(check?.status).toBe("info")
    expect(check?.detail).toBe("active (myserver)")
  })

  test("tailscale not installed is info", async () => {
    const client = new MockSystemClient()
    const checks = await runHealthCheck(client)
    const check = checks.find((c) => c.label === "Tailscale VPN")
    expect(check?.status).toBe("info")
    expect(check?.detail).toBe("not installed")
  })

  // Edge case: command failures fall back to insecure defaults
  test("SSH grep returning non-zero exit uses default values", async () => {
    const client = new MockSystemClient()
    const checks = await runHealthCheck(client)
    const rootCheck = checks.find((c) => c.label === "Root login disabled")
    const pwCheck = checks.find((c) => c.label === "Password authentication disabled")
    const portCheck = checks.find((c) => c.label === "Custom SSH port")
    const x11Check = checks.find((c) => c.label === "X11 forwarding disabled")
    expect(rootCheck?.status).toBe("fail")
    expect(pwCheck?.status).toBe("fail")
    expect(portCheck?.status).toBe("warn")
    expect(x11Check?.status).toBe("fail")
  })
})
