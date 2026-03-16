import { afterEach, mock as bunMock, describe, expect, test } from "bun:test"
import { readFileSync, unlinkSync } from "fs"

let noteCalls: { message: string; title?: string }[] = []

bunMock.module("@clack/prompts", () => ({
  note: (message: string, title?: string) => {
    noteCalls.push({ message, title })
  },
  log: {
    info: () => {
      /* noop */
    },
    warning: () => {
      /* noop */
    },
  },
  isCancel: () => false,
}))

import { displayReport, exportAuditMarkdown, exportReportMarkdown } from "../report/index.ts"
import type { AuditResult, Report } from "../types.ts"

const cleanupFiles: string[] = []

afterEach(() => {
  for (const f of cleanupFiles) {
    try {
      unlinkSync(f)
    } catch {
      /* ignored */
    }
  }
  cleanupFiles.length = 0
})

function makeReport(overrides: Partial<Report> = {}): Report {
  return {
    serverIp: "192.168.1.100",
    connectionUser: "root",
    date: "2026-03-15",
    ubuntuVersion: "24.04",
    results: [
      { name: "System Update", success: true, message: "System packages updated" },
      {
        name: "UFW Firewall",
        success: true,
        message: "UFW installed and configured",
        details: "Allowed: 22/tcp, 80/tcp",
      },
    ],
    ...overrides,
  }
}

describe("exportReportMarkdown", () => {
  test("generates correct filename", () => {
    const filename = exportReportMarkdown(makeReport())
    cleanupFiles.push(filename)
    expect(filename).toBe("securbuntu-report-192.168.1.100-2026-03-15.md")
  })

  test("sanitizes IPv6 colons in filename", () => {
    const filename = exportReportMarkdown(makeReport({ serverIp: "::1" }))
    cleanupFiles.push(filename)
    expect(filename).toBe("securbuntu-report---1-2026-03-15.md")
  })

  test("includes server metadata", () => {
    const filename = exportReportMarkdown(makeReport())
    cleanupFiles.push(filename)
    const content = readFileSync(filename, "utf-8")
    expect(content).toContain("# SecurBuntu Hardening Report")
    expect(content).toContain("| Server | 192.168.1.100 |")
    expect(content).toContain("| User | root |")
    expect(content).toContain("| Ubuntu | 24.04 |")
  })

  test("includes sudo user when present", () => {
    const filename = exportReportMarkdown(makeReport({ sudoUser: "deploy" }))
    cleanupFiles.push(filename)
    const content = readFileSync(filename, "utf-8")
    expect(content).toContain("| New Sudo User | deploy |")
  })

  test("omits sudo user when absent", () => {
    const filename = exportReportMarkdown(makeReport())
    cleanupFiles.push(filename)
    const content = readFileSync(filename, "utf-8")
    expect(content).not.toContain("New Sudo User")
  })

  test("includes task results with icons", () => {
    const filename = exportReportMarkdown(makeReport())
    cleanupFiles.push(filename)
    const content = readFileSync(filename, "utf-8")
    expect(content).toContain("### + System Update")
    expect(content).toContain("### + UFW Firewall")
  })

  test("includes failed task with minus icon", () => {
    const filename = exportReportMarkdown(
      makeReport({
        results: [{ name: "Test", success: false, message: "Failed" }],
      }),
    )
    cleanupFiles.push(filename)
    const content = readFileSync(filename, "utf-8")
    expect(content).toContain("### - Test")
  })

  test("includes task details as blockquote", () => {
    const filename = exportReportMarkdown(makeReport())
    cleanupFiles.push(filename)
    const content = readFileSync(filename, "utf-8")
    expect(content).toContain("> Allowed: 22/tcp, 80/tcp")
  })

  test("includes SSH port warning when changed", () => {
    const filename = exportReportMarkdown(makeReport({ newSshPort: 2222 }))
    cleanupFiles.push(filename)
    const content = readFileSync(filename, "utf-8")
    expect(content).toContain("## Important")
    expect(content).toContain("ssh -p 2222 root@192.168.1.100")
  })

  test("SSH port warning uses sudo user when available", () => {
    const filename = exportReportMarkdown(makeReport({ newSshPort: 2222, sudoUser: "deploy" }))
    cleanupFiles.push(filename)
    const content = readFileSync(filename, "utf-8")
    expect(content).toContain("ssh -p 2222 deploy@192.168.1.100")
  })

  test("includes audit section when present", () => {
    const audit: AuditResult = {
      checks: [
        { name: "SSH Port", status: "22 (default)" },
        { name: "UFW Firewall", status: "active" },
      ],
    }
    const filename = exportReportMarkdown(makeReport({ audit }))
    cleanupFiles.push(filename)
    const content = readFileSync(filename, "utf-8")
    expect(content).toContain("## Pre-Hardening Audit")
    expect(content).toContain("| SSH Port | 22 (default) |")
    expect(content).toContain("| UFW Firewall | active |")
  })

  test("includes footer", () => {
    const filename = exportReportMarkdown(makeReport())
    cleanupFiles.push(filename)
    const content = readFileSync(filename, "utf-8")
    expect(content).toContain("*Generated by SecurBuntu*")
  })

  test("includes before/after table when both audit and postAudit are present", () => {
    const audit: AuditResult = {
      checks: [
        { name: "SSH Port", status: "22 (default)" },
        { name: "UFW Firewall", status: "inactive" },
      ],
    }
    const postAudit: AuditResult = {
      checks: [
        { name: "SSH Port", status: "2222" },
        { name: "UFW Firewall", status: "active" },
      ],
    }
    const filename = exportReportMarkdown(makeReport({ audit, postAudit }))
    cleanupFiles.push(filename)
    const content = readFileSync(filename, "utf-8")
    expect(content).toContain("## Before / After")
    expect(content).toContain("| Check | Before | After |")
    expect(content).toContain("|-------|--------|-------|")
    expect(content).toContain("| SSH Port | 22 (default) | 2222 **changed** |")
    expect(content).toContain("| UFW Firewall | inactive | active **changed** |")
    expect(content).not.toContain("## Pre-Hardening Audit")
  })

  test("before/after table omits changed marker when status is unchanged", () => {
    const audit: AuditResult = {
      checks: [{ name: "Fail2ban", status: "active" }],
    }
    const postAudit: AuditResult = {
      checks: [{ name: "Fail2ban", status: "active" }],
    }
    const filename = exportReportMarkdown(makeReport({ audit, postAudit }))
    cleanupFiles.push(filename)
    const content = readFileSync(filename, "utf-8")
    expect(content).toContain("| Fail2ban | active | active |")
    expect(content).not.toContain("**changed**")
  })

  test("before/after table uses dash fallback when postAudit has fewer checks", () => {
    const audit: AuditResult = {
      checks: [
        { name: "SSH Port", status: "22" },
        { name: "Extra Check", status: "on" },
      ],
    }
    const postAudit: AuditResult = {
      checks: [{ name: "SSH Port", status: "2222" }],
    }
    const filename = exportReportMarkdown(makeReport({ audit, postAudit }))
    cleanupFiles.push(filename)
    const content = readFileSync(filename, "utf-8")
    expect(content).toContain("## Before / After")
    expect(content).toContain("| Extra Check | on | \u2014 **changed** |")
  })
})

describe("exportAuditMarkdown", () => {
  test("generates correct filename", () => {
    const audit: AuditResult = { checks: [{ name: "Test", status: "ok" }] }
    const filename = exportAuditMarkdown(audit, "10.0.0.1", "2026-03-15")
    cleanupFiles.push(filename)
    expect(filename).toBe("securbuntu-audit-10.0.0.1-2026-03-15.md")
  })

  test("includes audit checks table", () => {
    const audit: AuditResult = {
      checks: [
        { name: "Fail2ban", status: "active" },
        { name: "Sysctl", status: "default" },
      ],
    }
    const filename = exportAuditMarkdown(audit, "10.0.0.1", "2026-03-15")
    cleanupFiles.push(filename)
    const content = readFileSync(filename, "utf-8")
    expect(content).toContain("# SecurBuntu Security Audit")
    expect(content).toContain("| Server | 10.0.0.1 |")
    expect(content).toContain("| Fail2ban | active |")
    expect(content).toContain("| Sysctl | default |")
  })
})

describe("displayReport", () => {
  afterEach(() => {
    noteCalls = []
  })

  test("basic report shows server metadata and results", () => {
    displayReport(makeReport())
    expect(noteCalls).toHaveLength(1)
    const msg = noteCalls[0]?.message
    expect(noteCalls[0]?.title).toBe("SecurBuntu Report")
    expect(msg).toContain("192.168.1.100")
    expect(msg).toContain("root")
    expect(msg).toContain("24.04")
    expect(msg).toContain("2026-03-15")
    expect(msg).toContain("System Update")
    expect(msg).toContain("System packages updated")
    expect(msg).toContain("UFW Firewall")
  })

  test("report with sudoUser includes new sudo user line", () => {
    displayReport(makeReport({ sudoUser: "deploy" }))
    const msg = noteCalls[0]?.message
    expect(msg).toContain("deploy")
    expect(msg).toContain("New sudo user")
  })

  test("report with details includes detail lines", () => {
    displayReport(makeReport())
    const msg = noteCalls[0]?.message
    expect(msg).toContain("Allowed: 22/tcp, 80/tcp")
  })

  test("report with newSshPort shows SSH warning", () => {
    displayReport(makeReport({ newSshPort: 2222 }))
    const msg = noteCalls[0]?.message
    expect(msg).toContain("SSH port changed to 2222")
    expect(msg).toContain("ssh -p 2222 root@192.168.1.100")
  })

  test("newSshPort uses sudoUser when available", () => {
    displayReport(makeReport({ newSshPort: 2222, sudoUser: "deploy" }))
    const msg = noteCalls[0]?.message
    expect(msg).toContain("ssh -p 2222 deploy@192.168.1.100")
  })

  test("report with audit only shows pre-hardening section", () => {
    const audit: AuditResult = {
      checks: [
        { name: "SSH Port", status: "22 (default)" },
        { name: "UFW", status: "inactive" },
      ],
    }
    displayReport(makeReport({ audit }))
    const msg = noteCalls[0]?.message
    expect(msg).toContain("Audit (pre-hardening):")
    expect(msg).toContain("SSH Port")
    expect(msg).toContain("22 (default)")
    expect(msg).toContain("UFW")
    expect(msg).toContain("inactive")
  })

  test("report with audit and postAudit shows before/after", () => {
    const audit: AuditResult = {
      checks: [
        { name: "SSH Port", status: "22 (default)" },
        { name: "UFW", status: "inactive" },
      ],
    }
    const postAudit: AuditResult = {
      checks: [
        { name: "SSH Port", status: "2222" },
        { name: "UFW", status: "inactive" },
      ],
    }
    displayReport(makeReport({ audit, postAudit }))
    const msg = noteCalls[0]?.message
    expect(msg).toContain("Before / After:")
    expect(msg).toContain("SSH Port")
    expect(msg).toContain("22 (default)")
    expect(msg).toContain("2222")
    expect(msg).toContain("UFW")
    // Should not contain "Audit (pre-hardening)" when postAudit is present
    expect(msg).not.toContain("Audit (pre-hardening):")
  })

  test("postAudit with fewer checks than audit uses dash fallback", () => {
    const audit: AuditResult = {
      checks: [
        { name: "SSH Port", status: "22" },
        { name: "Extra", status: "on" },
      ],
    }
    const postAudit: AuditResult = {
      checks: [{ name: "SSH Port", status: "2222" }],
    }
    displayReport(makeReport({ audit, postAudit }))
    const msg = noteCalls[0]?.message
    // The second check should use the "—" fallback for missing postAudit entry
    expect(msg).toContain("—")
  })

  test("failed result shows failure icon context", () => {
    displayReport(
      makeReport({
        results: [{ name: "Fail2ban", success: false, message: "Install failed" }],
      }),
    )
    const msg = noteCalls[0]?.message
    expect(msg).toContain("Fail2ban")
    expect(msg).toContain("Install failed")
  })
})
