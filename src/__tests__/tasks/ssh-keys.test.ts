import { mock as bunMock, describe, expect, test } from "bun:test"
import type { HardeningOptions, ServerInfo } from "../../types.ts"
import { MockSshClient } from "../helpers/mock-ssh.ts"

// Mock fs.readFileSync for the public key
bunMock.module("fs", () => ({
  readFileSync: (path: string) => {
    if (path.includes("id_ed25519.pub")) return "ssh-ed25519 AAAA testkey"
    throw new Error(`Unexpected readFileSync: ${path}`)
  },
  existsSync: () => true,
  writeFileSync: () => {
    /* noop */
  },
  appendFileSync: () => {
    /* noop */
  },
  mkdirSync: () => {
    /* noop */
  },
}))

import { runInjectSshKeys } from "../../tasks/ssh-keys.ts"

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
  disableServices: false,
  servicesToDisable: [],
  fixFilePermissions: false,
  currentSshPort: 22,
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

  test("returns failure when mkdir fails for target user (lines 24-29, 58)", async () => {
    const ssh = new MockSshClient()
    ssh.onExec("whoami", { stdout: "deploy" })
    ssh.onExec("mkdir -p", { exitCode: 1, stderr: "permission denied" })

    const options = {
      ...defaultOptions,
      addPersonalKey: true,
      personalKeyPath: "/home/user/.ssh/id_ed25519.pub",
      createSudoUser: true,
      sudoUsername: "deploy",
    }

    const result = await runInjectSshKeys(ssh, options, defaultServer)

    expect(result.success).toBe(false)
    expect(result.name).toBe("SSH Keys")
    expect(result.message).toContain("Failed to create .ssh for deploy")
    expect(result.details).toContain("permission denied")
  })

  test("returns failure when tee append fails for target user (lines 24-29, 73)", async () => {
    const ssh = new MockSshClient()
    ssh.onExec("whoami", { stdout: "root" })
    ssh.onExec("grep -qxF", { stdout: "missing" })
    ssh.onExec("tee -a", { exitCode: 1, stderr: "write error" })

    const options = {
      ...defaultOptions,
      addPersonalKey: true,
      personalKeyPath: "/home/user/.ssh/id_ed25519.pub",
    }

    const result = await runInjectSshKeys(ssh, options, defaultServer)

    expect(result.success).toBe(false)
    expect(result.message).toContain("Failed to inject key for root")
    expect(result.details).toContain("write error")
  })

  test("returns failure when chmod/chown fails (line 73)", async () => {
    const ssh = new MockSshClient()
    ssh.onExec("whoami", { stdout: "root" })
    ssh.onExec("grep -qxF", { stdout: "missing" })
    ssh.onExec("chmod 600", { exitCode: 1, stderr: "chown failed" })

    const options = {
      ...defaultOptions,
      addPersonalKey: true,
      personalKeyPath: "/home/user/.ssh/id_ed25519.pub",
    }

    const result = await runInjectSshKeys(ssh, options, defaultServer)

    expect(result.success).toBe(false)
    expect(result.message).toContain("Failed to set permissions for root")
    expect(result.details).toContain("chown failed")
  })

  test("adds warning when coolify root injection fails (line 37)", async () => {
    const ssh = new MockSshClient()
    ssh.onExec("whoami", { stdout: "deploy" })
    // First mkdir succeeds (for deploy), second mkdir fails (for root)
    ssh.onExec(/mkdir -p \/home\/deploy/, { exitCode: 0 })
    ssh.onExec(/mkdir -p \/root/, { exitCode: 1, stderr: "root denied" })
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
    expect(result.message).toContain("injected")
    expect(result.details).toContain("Warning:")
    expect(result.details).toContain("Failed to create .ssh for root")
  })
})
