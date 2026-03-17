import { afterEach, mock as bunMock, describe, expect, test } from "bun:test"
import { MockSystemClient } from "./helpers/mock-ssh.ts"

let logInfoCalls: string[] = []
let noteCalls: { message: string; title: string }[] = []

// Mock @clack/prompts (hoisted before imports by Bun)
bunMock.module("@clack/prompts", () => ({
  log: {
    info: (msg: string) => {
      logInfoCalls.push(msg)
    },
    warning: () => {
      /* noop */
    },
  },
  note: (message: string, title: string) => {
    noteCalls.push({ message, title })
  },
  isCancel: () => false,
}))

import { DryRunClient } from "../dry-run.ts"

describe("DryRunClient", () => {
  test("exec records command and returns empty success", async () => {
    const ssh = new MockSystemClient()
    const dryRun = new DryRunClient(ssh)

    const result = await dryRun.exec("apt update")

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe("")
    expect(result.stderr).toBe("")
    expect(dryRun.getCommandLog()).toEqual(["apt update"])
    expect(ssh.commands).toHaveLength(0) // real client NOT called
  })

  test("execWithStdin records command with stdin size", async () => {
    const ssh = new MockSystemClient()
    const dryRun = new DryRunClient(ssh)

    await dryRun.execWithStdin("chpasswd", "user:pass\n")

    expect(dryRun.getCommandLog()).toEqual(["chpasswd (10 bytes stdin)"])
    expect(ssh.commands).toHaveLength(0)
  })

  test("writeFile records write operation", async () => {
    const ssh = new MockSystemClient()
    const dryRun = new DryRunClient(ssh)

    await dryRun.writeFile("/etc/test.conf", "content here")

    expect(dryRun.getCommandLog()).toEqual(["writeFile /etc/test.conf (12 bytes)"])
    expect(ssh.writtenFiles.size).toBe(0) // real client NOT called
  })

  test("readFile passes through to real client", async () => {
    const ssh = new MockSystemClient()
    ssh.setFile("/etc/hostname", "myserver")
    const dryRun = new DryRunClient(ssh)

    const content = await dryRun.readFile("/etc/hostname")

    expect(content).toBe("myserver")
  })

  test("fileExists passes through to real client", async () => {
    const ssh = new MockSystemClient()
    ssh.setFile("/etc/test", "exists")
    const dryRun = new DryRunClient(ssh)

    expect(await dryRun.fileExists("/etc/test")).toBe(true)
    expect(await dryRun.fileExists("/etc/missing")).toBe(false)
  })

  test("isRoot delegates from real client", () => {
    const rootMock = new MockSystemClient(true)
    const nonRootMock = new MockSystemClient(false)

    expect(new DryRunClient(rootMock).isRoot).toBe(true)
    expect(new DryRunClient(nonRootMock).isRoot).toBe(false)
  })

  test("getCommandLog returns a copy", async () => {
    const ssh = new MockSystemClient()
    const dryRun = new DryRunClient(ssh)

    await dryRun.exec("cmd1")
    const log = dryRun.getCommandLog()
    await dryRun.exec("cmd2")

    expect(log).toEqual(["cmd1"]) // copy, not reference
    expect(dryRun.getCommandLog()).toEqual(["cmd1", "cmd2"])
  })

  test("close is a no-op", () => {
    const ssh = new MockSystemClient()
    const dryRun = new DryRunClient(ssh)
    dryRun.close() // should not throw
  })
})

describe("DryRunClient.displaySummary", () => {
  afterEach(() => {
    logInfoCalls = []
    noteCalls = []
  })

  test("logs message when no commands were recorded", () => {
    const ssh = new MockSystemClient()
    const dryRun = new DryRunClient(ssh)

    dryRun.displaySummary()

    expect(logInfoCalls.length).toBeGreaterThan(0)
    const combined = logInfoCalls.join(" ")
    expect(combined).toContain("No commands would be executed")
    expect(noteCalls).toHaveLength(0)
  })

  test("displays numbered command list via note when commands exist", async () => {
    const ssh = new MockSystemClient()
    const dryRun = new DryRunClient(ssh)

    await dryRun.exec("apt update")
    await dryRun.exec("systemctl restart sshd")

    logInfoCalls = []
    noteCalls = []

    dryRun.displaySummary()

    expect(noteCalls).toHaveLength(1)
    expect(noteCalls[0]?.message).toContain("1. apt update")
    expect(noteCalls[0]?.message).toContain("2. systemctl restart sshd")
    expect(noteCalls[0]?.title).toContain("Dry-run summary")
  })
})
