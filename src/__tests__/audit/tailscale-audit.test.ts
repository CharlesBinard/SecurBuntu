import { describe, expect, test } from "bun:test"
import { runAudit } from "../../audit/scanner.ts"
import { MockSystemClient } from "../helpers/mock-ssh.ts"

describe("Tailscale audit", () => {
  test("detects Tailscale as active with hostname", async () => {
    const ssh = new MockSystemClient()
    ssh.onExec("tailscale status --json", {
      stdout: '{"Self":{"HostName":"vm-media","Online":true}}',
      exitCode: 0,
    })

    const result = await runAudit(ssh)
    const tsCheck = result.checks.find((c) => c.name === "Tailscale")
    expect(tsCheck).toBeDefined()
    expect(tsCheck!.status).toBe("active")
    expect(tsCheck!.detail).toContain("vm-media")
  })

  test("detects Tailscale as not installed", async () => {
    const ssh = new MockSystemClient()
    ssh.onExec("tailscale status --json", { exitCode: 1, stderr: "command not found" })

    const result = await runAudit(ssh)
    const tsCheck = result.checks.find((c) => c.name === "Tailscale")
    expect(tsCheck).toBeDefined()
    expect(tsCheck!.status).toBe("not installed")
  })
})
