import { checkPermissions } from "../tasks/permissions.ts"
import { UNNECESSARY_SERVICES } from "../tasks/services.ts"
import type { CheckResult, SystemClient } from "../types.ts"

async function sshGrep(client: SystemClient, directive: string): Promise<string> {
  const result = await client.exec(
    `grep -h '^${directive} ' /etc/ssh/sshd_config.d/*.conf /etc/ssh/sshd_config 2>/dev/null | tail -1`,
  )
  return result.stdout.replace(`${directive} `, "").trim()
}

async function checkSsh(client: SystemClient): Promise<CheckResult[]> {
  const checks: CheckResult[] = []

  const rootLogin = (await sshGrep(client, "PermitRootLogin")) || "yes"
  const rootLoginSecure = rootLogin === "no" || rootLogin === "prohibit-password"
  checks.push({
    category: "SSH Configuration",
    label: "Root login disabled",
    status: rootLoginSecure ? "pass" : "fail",
    detail: rootLoginSecure ? undefined : `currently: ${rootLogin}`,
  })

  const pwAuth = (await sshGrep(client, "PasswordAuthentication")) || "yes"
  checks.push({
    category: "SSH Configuration",
    label: "Password authentication disabled",
    status: pwAuth === "no" ? "pass" : "fail",
    detail: pwAuth === "no" ? undefined : "password login enabled",
  })

  const portStr = (await sshGrep(client, "Port")) || "22"
  const port = parseInt(portStr, 10) || 22
  checks.push({
    category: "SSH Configuration",
    label: "Custom SSH port",
    status: port !== 22 ? "pass" : "warn",
    detail: port !== 22 ? `port ${port}` : "port 22 (default)",
  })

  const maxAuthStr = (await sshGrep(client, "MaxAuthTries")) || ""
  const maxAuth = parseInt(maxAuthStr, 10) || 6
  if (maxAuth <= 3) {
    checks.push({ category: "SSH Configuration", label: "MaxAuthTries", status: "pass", detail: `${maxAuth}` })
  } else {
    const detail = maxAuthStr ? `${maxAuth} (recommended: 3)` : "6 (default, recommended: 3)"
    checks.push({ category: "SSH Configuration", label: "MaxAuthTries", status: "warn", detail })
  }

  const x11 = (await sshGrep(client, "X11Forwarding")) || "yes"
  checks.push({
    category: "SSH Configuration",
    label: "X11 forwarding disabled",
    status: x11 === "no" ? "pass" : "fail",
  })

  const banner = await sshGrep(client, "Banner")
  checks.push({
    category: "SSH Configuration",
    label: "SSH banner configured",
    status: banner ? "pass" : "warn",
  })

  return checks
}

async function checkFirewall(client: SystemClient): Promise<CheckResult[]> {
  const checks: CheckResult[] = []

  const ufwResult = await client.exec("which ufw > /dev/null 2>&1 && ufw status | head -1 || echo 'not installed'")
  const ufwStatus = ufwResult.stdout.replace("Status: ", "").trim()
  const ufwActive = ufwStatus === "active"

  if (ufwStatus === "not installed") {
    checks.push({ category: "Firewall", label: "UFW firewall active", status: "fail", detail: "not installed" })
  } else if (ufwActive) {
    checks.push({ category: "Firewall", label: "UFW firewall active", status: "pass" })
  } else {
    checks.push({
      category: "Firewall",
      label: "UFW firewall active",
      status: "warn",
      detail: "installed but inactive",
    })
  }

  if (ufwActive) {
    const rulesResult = await client.exec("ufw status numbered 2>/dev/null | grep -c '^\\['")
    const ruleCount = parseInt(rulesResult.stdout.trim(), 10) || 0
    checks.push({
      category: "Firewall",
      label: "UFW rules configured",
      status: ruleCount > 0 ? "pass" : "warn",
      detail: `${ruleCount} rule${ruleCount !== 1 ? "s" : ""}`,
    })
  } else {
    checks.push({ category: "Firewall", label: "UFW rules configured", status: "warn", detail: "UFW not active" })
  }

  return checks
}

async function checkFail2ban(client: SystemClient): Promise<CheckResult[]> {
  const f2bResult = await client.exec("systemctl is-active fail2ban 2>/dev/null || echo 'not installed'")
  const f2bStatus = f2bResult.stdout.trim()

  if (f2bStatus === "active") {
    return [{ category: "Fail2ban", label: "Fail2ban active", status: "pass" }]
  }
  if (f2bStatus === "not installed") {
    return [{ category: "Fail2ban", label: "Fail2ban active", status: "fail", detail: "not installed" }]
  }
  return [{ category: "Fail2ban", label: "Fail2ban active", status: "warn", detail: f2bStatus }]
}

async function checkUsers(client: SystemClient): Promise<CheckResult[]> {
  const sudoResult = await client.exec("grep -Po '^sudo:.*:\\K.*' /etc/group 2>/dev/null || echo 'none'")
  const sudoUsers = sudoResult.stdout.trim()
  const hasSudoUser = sudoUsers !== "" && sudoUsers !== "none"
  return [
    {
      category: "Users",
      label: "Non-root sudo user exists",
      status: hasSudoUser ? "pass" : "warn",
      detail: hasSudoUser ? sudoUsers : "root only",
    },
  ]
}

async function checkUpdates(client: SystemClient): Promise<CheckResult[]> {
  const autoResult = await client.exec(
    "test -f /etc/apt/apt.conf.d/20auto-upgrades && grep -q 'Unattended-Upgrade \"1\"' /etc/apt/apt.conf.d/20auto-upgrades && echo enabled || echo 'not configured'",
  )
  return [
    {
      category: "Updates",
      label: "Unattended-upgrades enabled",
      status: autoResult.stdout.trim() === "enabled" ? "pass" : "fail",
    },
  ]
}

async function checkServices(client: SystemClient): Promise<CheckResult[]> {
  const servicesResult = await client.exec("systemctl list-units --type=service --state=active --no-legend")
  const activeServices = servicesResult.stdout
  const detectedServices = UNNECESSARY_SERVICES.filter((s) => activeServices.includes(`${s.name}.service`)).map(
    (s) => s.name,
  )
  return [
    {
      category: "Services",
      label: "No unnecessary services",
      status: detectedServices.length === 0 ? "pass" : "warn",
      detail: detectedServices.length > 0 ? detectedServices.join(", ") : undefined,
    },
  ]
}

async function checkFilePermissions(client: SystemClient): Promise<CheckResult[]> {
  const violations = await checkPermissions(client)
  return [
    {
      category: "Permissions",
      label: "File permissions correct",
      status: violations.length === 0 ? "pass" : "fail",
      detail:
        violations.length > 0
          ? violations.map((v) => `${v.path} ${v.actual.mode} (expected ${v.expected.mode})`).join(", ")
          : undefined,
    },
  ]
}

async function checkKernel(client: SystemClient): Promise<CheckResult[]> {
  const sysctlResult = await client.exec("test -f /etc/sysctl.d/99-securbuntu.conf && echo hardened || echo default")
  return [
    {
      category: "Kernel",
      label: "Sysctl hardening applied",
      status: sysctlResult.stdout.trim() === "hardened" ? "pass" : "warn",
    },
  ]
}

async function checkNetwork(client: SystemClient): Promise<CheckResult[]> {
  const tsResult = await client.exec("tailscale status --json 2>/dev/null")
  if (tsResult.exitCode === 0 && tsResult.stdout.trim() !== "") {
    try {
      const tsStatus = JSON.parse(tsResult.stdout)
      const hostname = tsStatus?.Self?.HostName ?? "unknown"
      return [{ category: "Network", label: "Tailscale VPN", status: "info", detail: `active (${hostname})` }]
    } catch {
      return [{ category: "Network", label: "Tailscale VPN", status: "info", detail: "active" }]
    }
  }
  return [{ category: "Network", label: "Tailscale VPN", status: "info", detail: "not installed" }]
}

export async function runHealthCheck(client: SystemClient): Promise<CheckResult[]> {
  return [
    ...(await checkSsh(client)),
    ...(await checkFirewall(client)),
    ...(await checkFail2ban(client)),
    ...(await checkUsers(client)),
    ...(await checkUpdates(client)),
    ...(await checkServices(client)),
    ...(await checkFilePermissions(client)),
    ...(await checkKernel(client)),
    ...(await checkNetwork(client)),
  ]
}
