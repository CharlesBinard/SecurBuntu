import { describe, expect, test } from "bun:test"
import { copyKeyViaClient } from "../../platform/ssh-copy.ts"
import { MockSystemClient } from "../helpers/mock-ssh.ts"

describe("copyKeyViaClient", () => {
  test("creates .ssh directory with correct permissions", async () => {
    const client = new MockSystemClient()
    client.onExec("mkdir -p", { exitCode: 0 })
    client.onExec("grep", { stdout: "missing" })
    client.onExec("tee -a", { exitCode: 0 })
    client.onExec("chmod 600", { exitCode: 0 })

    await copyKeyViaClient(client, "ssh-ed25519 AAAA testkey", "deploy")
    expect(client.hasCommand("mkdir -p /home/deploy/.ssh")).toBe(true)
    expect(client.hasCommand("chmod 700")).toBe(true)
  })

  test("skips injection if key already exists", async () => {
    const client = new MockSystemClient()
    client.onExec("mkdir -p", { exitCode: 0 })
    client.onExec("grep", { stdout: "found" })

    const result = await copyKeyViaClient(client, "ssh-ed25519 AAAA testkey", "deploy")
    expect(result.success).toBe(true)
    expect(client.hasCommand("tee")).toBe(false)
  })

  test("appends key to authorized_keys", async () => {
    const client = new MockSystemClient()
    client.onExec("mkdir -p", { exitCode: 0 })
    client.onExec("grep", { stdout: "missing" })
    client.onExec("tee -a", { exitCode: 0 })
    client.onExec("chmod 600", { exitCode: 0 })

    const result = await copyKeyViaClient(client, "ssh-ed25519 AAAA testkey", "deploy")
    expect(result.success).toBe(true)
    expect(client.hasCommand("tee -a")).toBe(true)
  })

  test("returns failure if mkdir fails", async () => {
    const client = new MockSystemClient()
    client.onExec("mkdir -p", { exitCode: 1, stderr: "permission denied" })

    const result = await copyKeyViaClient(client, "ssh-ed25519 AAAA testkey", "deploy")
    expect(result.success).toBe(false)
  })

  test("returns failure if append fails", async () => {
    const client = new MockSystemClient()
    client.onExec("mkdir -p", { exitCode: 0 })
    client.onExec("grep", { stdout: "missing" })
    client.onExec("tee -a", { exitCode: 1, stderr: "disk full" })

    const result = await copyKeyViaClient(client, "ssh-ed25519 AAAA testkey", "deploy")
    expect(result.success).toBe(false)
  })

  test("uses /root for root user", async () => {
    const client = new MockSystemClient()
    client.onExec("mkdir -p", { exitCode: 0 })
    client.onExec("grep", { stdout: "missing" })
    client.onExec("tee -a", { exitCode: 0 })
    client.onExec("chmod 600", { exitCode: 0 })

    await copyKeyViaClient(client, "ssh-ed25519 AAAA testkey", "root")
    expect(client.hasCommand("/root/.ssh")).toBe(true)
  })
})
