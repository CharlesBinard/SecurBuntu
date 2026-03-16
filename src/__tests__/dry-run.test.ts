import { mock as bunMock, describe, expect, test } from "bun:test"
import { MockSshClient } from "./helpers/mock-ssh.js"

// Mock @clack/prompts (hoisted before imports by Bun)
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
  isCancel: () => false,
}))

import { DryRunSshClient } from "../dry-run.js"

describe("DryRunSshClient", () => {
  test("exec records command and returns empty success", async () => {
    const ssh = new MockSshClient()
    const dryRun = new DryRunSshClient(ssh)

    const result = await dryRun.exec("apt update")

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe("")
    expect(result.stderr).toBe("")
    expect(dryRun.getCommandLog()).toEqual(["apt update"])
    expect(ssh.commands).toHaveLength(0) // real client NOT called
  })

  test("execWithStdin records command with stdin size", async () => {
    const ssh = new MockSshClient()
    const dryRun = new DryRunSshClient(ssh)

    await dryRun.execWithStdin("chpasswd", "user:pass\n")

    expect(dryRun.getCommandLog()).toEqual(["chpasswd (10 bytes stdin)"])
    expect(ssh.commands).toHaveLength(0)
  })

  test("writeFile records write operation", async () => {
    const ssh = new MockSshClient()
    const dryRun = new DryRunSshClient(ssh)

    await dryRun.writeFile("/etc/test.conf", "content here")

    expect(dryRun.getCommandLog()).toEqual(["writeFile /etc/test.conf (12 bytes)"])
    expect(ssh.writtenFiles.size).toBe(0) // real client NOT called
  })

  test("readFile passes through to real client", async () => {
    const ssh = new MockSshClient()
    ssh.setFile("/etc/hostname", "myserver")
    const dryRun = new DryRunSshClient(ssh)

    const content = await dryRun.readFile("/etc/hostname")

    expect(content).toBe("myserver")
  })

  test("fileExists passes through to real client", async () => {
    const ssh = new MockSshClient()
    ssh.setFile("/etc/test", "exists")
    const dryRun = new DryRunSshClient(ssh)

    expect(await dryRun.fileExists("/etc/test")).toBe(true)
    expect(await dryRun.fileExists("/etc/missing")).toBe(false)
  })

  test("isRoot delegates from real client", () => {
    const rootMock = new MockSshClient(true)
    const nonRootMock = new MockSshClient(false)

    expect(new DryRunSshClient(rootMock).isRoot).toBe(true)
    expect(new DryRunSshClient(nonRootMock).isRoot).toBe(false)
  })

  test("getCommandLog returns a copy", async () => {
    const ssh = new MockSshClient()
    const dryRun = new DryRunSshClient(ssh)

    await dryRun.exec("cmd1")
    const log = dryRun.getCommandLog()
    await dryRun.exec("cmd2")

    expect(log).toEqual(["cmd1"]) // copy, not reference
    expect(dryRun.getCommandLog()).toEqual(["cmd1", "cmd2"])
  })

  test("close is a no-op", () => {
    const ssh = new MockSshClient()
    const dryRun = new DryRunSshClient(ssh)
    dryRun.close() // should not throw
  })
})
