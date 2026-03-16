import { mock as bunMock, describe, expect, test } from "bun:test"
import type { HardeningOptions, ServerInfo } from "../../types.js"
import { MockSshClient } from "../helpers/mock-ssh.js"

// Mock fs.readFileSync for the public key
bunMock.module("fs", () => ({
  readFileSync: (path: string) => {
    if (path.includes("id_ed25519.pub")) return "ssh-ed25519 AAAA testkey"
    throw new Error(`Unexpected readFileSync: ${path}`)
  },
  existsSync: () => true,
  writeFileSync: () => {},
  appendFileSync: () => {},
  mkdirSync: () => {},
}))

import { runInjectSshKeys } from "../../tasks/ssh-keys.js"

const defaultOptions: HardeningOptions = {
  createSudoUser: false,
  addPersonalKey: false,
  configureCoolify: false,
  changeSshPort: false,
  disablePasswordAuth: false,
  installUfw: false,
  ufwPorts: [],
  installFail2ban: false,
  enableAutoUpdates: false,
  enableSysctl: false,
  permitRootLogin: "yes",
  disableX11Forwarding: true,
  maxAuthTries: 5,
  enableSshBanner: false,
}

const defaultServer: ServerInfo = {
  ubuntuVersion: "24.04",
  ubuntuCodename: "noble",
  usesSocketActivation: false,
  hasCloudInit: false,
  isRoot: true,
}

describe("runInjectSshKeys", () => {
  test("skips when no key to add", async () => {
    const ssh = new MockSshClient()
    const result = await runInjectSshKeys(ssh, defaultOptions, defaultServer)
    expect(result.success).toBe(true)
    expect(result.message).toStartWith("Skipped")
  })

  test("injects key for target user", async () => {
    const ssh = new MockSshClient()
    ssh.onExec("whoami", { stdout: "root" })
    ssh.onExec("grep -qxF", { stdout: "missing" })

    const options = {
      ...defaultOptions,
      addPersonalKey: true,
      personalKeyPath: "/home/user/.ssh/id_ed25519.pub",
    }

    const result = await runInjectSshKeys(ssh, options, defaultServer)

    expect(result.success).toBe(true)
    expect(result.message).toContain("injected")
    expect(ssh.hasCommand("mkdir -p")).toBe(true)
    expect(ssh.hasCommand("tee -a")).toBe(true)
  })

  test("skips injection when key already present", async () => {
    const ssh = new MockSshClient()
    ssh.onExec("whoami", { stdout: "root" })
    ssh.onExec("grep -qxF", { stdout: "found" })

    const options = {
      ...defaultOptions,
      addPersonalKey: true,
      personalKeyPath: "/home/user/.ssh/id_ed25519.pub",
    }

    const result = await runInjectSshKeys(ssh, options, defaultServer)

    expect(result.success).toBe(true)
    expect(ssh.hasCommand("tee -a")).toBe(false)
  })

  test("injects for root when coolify enabled and target is not root", async () => {
    const ssh = new MockSshClient()
    ssh.onExec("whoami", { stdout: "deploy" })
    ssh.onExec("grep -qxF", { stdout: "missing" })

    const options = {
      ...defaultOptions,
      addPersonalKey: true,
      personalKeyPath: "/home/user/.ssh/id_ed25519.pub",
      configureCoolify: true,
      createSudoUser: true,
      sudoUsername: "deploy",
    }

    const result = await runInjectSshKeys(ssh, options, defaultServer)

    expect(result.success).toBe(true)
    // Should have mkdir commands for both deploy and root
    expect(ssh.commandCount("mkdir -p")).toBeGreaterThanOrEqual(2)
  })
})
