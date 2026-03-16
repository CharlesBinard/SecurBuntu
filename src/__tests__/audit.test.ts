import { mock as bunMock, describe, expect, test } from "bun:test"
import { MockSshClient } from "./helpers/mock-ssh.js"

bunMock.module("@clack/prompts", () => ({
  log: {
    info: () => {
      /* noop */
    },
    warning: () => {
      /* noop */
    },
  },
  note: () => {
    /* noop */
  },
}))

import { runAudit } from "../audit/index.js"

describe("runAudit", () => {
  test("returns exactly 10 checks", async () => {
    const ssh = new MockSshClient()
    const result = await runAudit(ssh)
    expect(result.checks).toHaveLength(10)
  })

  test("check names match expected list", async () => {
    const ssh = new MockSshClient()
    const result = await runAudit(ssh)
    const names = result.checks.map((c) => c.name)
    expect(names).toEqual([
      "SSH Port",
      "Root Login",
      "Password Auth",
      "UFW Firewall",
      "Fail2ban",
      "Auto-updates",
      "Sudo Users",
      "SSH Keys",
      "Sysctl Hardening",
      "SSH Banner",
    ])
  })

  test("parses SSH port from stdout", async () => {
    const ssh = new MockSshClient()
    ssh.onExec("grep -h '^Port '", { stdout: "Port 2222" })
    const result = await runAudit(ssh)
    const portCheck = result.checks.find((c) => c.name === "SSH Port")
    expect(portCheck?.status).toBe("2222")
  })

  test("defaults SSH port to 22 when not configured", async () => {
    const ssh = new MockSshClient()
    const result = await runAudit(ssh)
    const portCheck = result.checks.find((c) => c.name === "SSH Port")
    expect(portCheck?.status).toBe("22 (default)")
  })

  test("parses PermitRootLogin", async () => {
    const ssh = new MockSshClient()
    ssh.onExec("grep -h '^PermitRootLogin '", { stdout: "PermitRootLogin prohibit-password" })
    const result = await runAudit(ssh)
    const check = result.checks.find((c) => c.name === "Root Login")
    expect(check?.status).toBe("prohibit-password")
  })

  test("detects UFW active", async () => {
    const ssh = new MockSshClient()
    ssh.onExec("which ufw", { stdout: "Status: active" })
    const result = await runAudit(ssh)
    const check = result.checks.find((c) => c.name === "UFW Firewall")
    expect(check?.status).toBe("active")
  })

  test("detects UFW not installed", async () => {
    const ssh = new MockSshClient()
    ssh.onExec("which ufw", { stdout: "not installed" })
    const result = await runAudit(ssh)
    const check = result.checks.find((c) => c.name === "UFW Firewall")
    expect(check?.status).toBe("not installed")
  })

  test("detects fail2ban active", async () => {
    const ssh = new MockSshClient()
    ssh.onExec("systemctl is-active fail2ban", { stdout: "active" })
    const result = await runAudit(ssh)
    const check = result.checks.find((c) => c.name === "Fail2ban")
    expect(check?.status).toBe("active")
  })

  test("detects sysctl hardened", async () => {
    const ssh = new MockSshClient()
    ssh.onExec("test -f /etc/sysctl.d/99-securbuntu.conf", { stdout: "hardened" })
    const result = await runAudit(ssh)
    const check = result.checks.find((c) => c.name === "Sysctl Hardening")
    expect(check?.status).toBe("hardened")
  })

  test("detects SSH banner not set", async () => {
    const ssh = new MockSshClient()
    const result = await runAudit(ssh)
    const check = result.checks.find((c) => c.name === "SSH Banner")
    expect(check?.status).toBe("not set")
  })

  test("detects SSH banner configured", async () => {
    const ssh = new MockSshClient()
    ssh.onExec("grep -h '^Banner '", { stdout: "Banner /etc/issue.net" })
    const result = await runAudit(ssh)
    const check = result.checks.find((c) => c.name === "SSH Banner")
    expect(check?.status).toBe("Banner /etc/issue.net")
  })
})
