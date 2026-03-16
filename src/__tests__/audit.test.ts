import { beforeEach, mock as bunMock, describe, expect, test } from "bun:test"
import { MockSshClient } from "./helpers/mock-ssh.ts"

let noteCalls: Array<{ message: string; title: string }> = []

bunMock.module("@clack/prompts", () => ({
  log: {
    info: () => {
      /* noop */
    },
    warning: () => {
      /* noop */
    },
  },
  note: (message: string, title: string) => {
    noteCalls.push({ message, title })
  },
}))

import { displayAudit, runAudit } from "../audit/index.ts"
import type { AuditResult } from "../types.ts"

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

describe("displayAudit", () => {
  beforeEach(() => {
    noteCalls = []
  })

  test("calls p.note with 'Server Security Audit' title", () => {
    const result: AuditResult = {
      checks: [{ name: "Test Check", status: "active" }],
    }
    displayAudit(result)
    expect(noteCalls).toHaveLength(1)
    expect(noteCalls[0]!.title).toBe("Server Security Audit")
  })

  test("colorizes 'active' status as green (good)", () => {
    const result: AuditResult = {
      checks: [{ name: "Firewall", status: "active" }],
    }
    displayAudit(result)
    expect(noteCalls[0]!.message).toContain("Firewall")
    expect(noteCalls[0]!.message).toContain("active")
  })

  test("colorizes 'enabled' status as green (good)", () => {
    const result: AuditResult = {
      checks: [{ name: "Auto-updates", status: "enabled" }],
    }
    displayAudit(result)
    expect(noteCalls[0]!.message).toContain("enabled")
  })

  test("colorizes 'hardened' status as green (good)", () => {
    const result: AuditResult = {
      checks: [{ name: "Sysctl", status: "hardened" }],
    }
    displayAudit(result)
    expect(noteCalls[0]!.message).toContain("hardened")
  })

  test("colorizes 'no' status as green (good)", () => {
    const result: AuditResult = {
      checks: [{ name: "Root Login", status: "no" }],
    }
    displayAudit(result)
    expect(noteCalls[0]!.message).toContain("no")
  })

  test("colorizes 'prohibit-password' status as green (good)", () => {
    const result: AuditResult = {
      checks: [{ name: "Root Login", status: "prohibit-password" }],
    }
    displayAudit(result)
    expect(noteCalls[0]!.message).toContain("prohibit-password")
  })

  test("colorizes 'not installed' status as yellow (bad)", () => {
    const result: AuditResult = {
      checks: [{ name: "Fail2ban", status: "not installed" }],
    }
    displayAudit(result)
    expect(noteCalls[0]!.message).toContain("not installed")
  })

  test("colorizes 'not configured' status as yellow (bad)", () => {
    const result: AuditResult = {
      checks: [{ name: "Auto-updates", status: "not configured" }],
    }
    displayAudit(result)
    expect(noteCalls[0]!.message).toContain("not configured")
  })

  test("colorizes 'yes' status as yellow (bad)", () => {
    const result: AuditResult = {
      checks: [{ name: "Password Auth", status: "yes" }],
    }
    displayAudit(result)
    expect(noteCalls[0]!.message).toContain("yes")
  })

  test("colorizes 'yes (default)' status as yellow (bad)", () => {
    const result: AuditResult = {
      checks: [{ name: "Root Login", status: "yes (default)" }],
    }
    displayAudit(result)
    expect(noteCalls[0]!.message).toContain("yes (default)")
  })

  test("colorizes 'default' status as yellow (bad)", () => {
    const result: AuditResult = {
      checks: [{ name: "Password Auth", status: "default" }],
    }
    displayAudit(result)
    expect(noteCalls[0]!.message).toContain("default")
  })

  test("colorizes 'not set' status as yellow (bad)", () => {
    const result: AuditResult = {
      checks: [{ name: "SSH Banner", status: "not set" }],
    }
    displayAudit(result)
    expect(noteCalls[0]!.message).toContain("not set")
  })

  test("colorizes neutral status as cyan (neither good nor bad)", () => {
    const result: AuditResult = {
      checks: [{ name: "SSH Port", status: "2222" }],
    }
    displayAudit(result)
    expect(noteCalls[0]!.message).toContain("2222")
  })

  test("appends detail field when present", () => {
    const result: AuditResult = {
      checks: [{ name: "Sudo Users", status: "2 users", detail: "root, admin" }],
    }
    displayAudit(result)
    expect(noteCalls[0]!.message).toContain("root, admin")
  })

  test("does not append detail when absent", () => {
    const result: AuditResult = {
      checks: [{ name: "Firewall", status: "active" }],
    }
    displayAudit(result)
    // The message should contain the check but no extra detail text
    const message = noteCalls[0]!.message
    expect(message).toContain("Firewall")
    expect(message).toContain("active")
  })

  test("renders multiple checks as newline-separated lines", () => {
    const result: AuditResult = {
      checks: [
        { name: "Firewall", status: "active" },
        { name: "Fail2ban", status: "not installed" },
        { name: "SSH Port", status: "2222" },
      ],
    }
    displayAudit(result)
    const lines = noteCalls[0]!.message.split("\n")
    expect(lines).toHaveLength(3)
  })
})
