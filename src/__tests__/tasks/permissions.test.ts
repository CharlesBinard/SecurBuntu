import { describe, expect, test } from "bun:test"
import { checkPermissions, runFixPermissions } from "../../tasks/permissions.ts"
import type { HardeningOptions, ServerInfo } from "../../types.ts"
import { MockSshClient } from "../helpers/mock-ssh.ts"

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
}

const defaultServer: ServerInfo = {
  ubuntuVersion: "24.04",
  ubuntuCodename: "noble",
  usesSocketActivation: false,
  hasCloudInit: false,
  isRoot: true,
}

describe("runFixPermissions", () => {
  test("skips when not requested", async () => {
    const ssh = new MockSshClient()
    const result = await runFixPermissions(ssh, defaultOptions, defaultServer)
    expect(result.success).toBe(true)
    expect(result.message).toStartWith("Skipped — not requested")
  })

  test("skips when all permissions are already correct", async () => {
    const ssh = new MockSshClient()
    ssh.onExec("ls /etc/ssh/ssh_host_*_key", { stdout: "", exitCode: 1 })
    ssh.onExec("stat -c '%a %U %G' '/etc/passwd'", { stdout: "644 root root" })
    ssh.onExec("stat -c '%a %U %G' '/etc/shadow'", { stdout: "640 root shadow" })
    ssh.onExec("stat -c '%a %U %G' '/etc/gshadow'", { stdout: "640 root shadow" })
    ssh.onExec("stat -c '%a %U %G' '/etc/group'", { stdout: "644 root root" })
    ssh.onExec("stat -c '%a %U %G' '/etc/ssh/sshd_config'", { stdout: "600 root root" })
    ssh.onExec("stat -c '%a %U %G' '/etc/crontab'", { stdout: "600 root root" })

    const options = { ...defaultOptions, fixFilePermissions: true }
    const result = await runFixPermissions(ssh, options, defaultServer)

    expect(result.success).toBe(true)
    expect(result.message).toContain("all permissions already correct")
  })

  test("fixes non-conforming permissions", async () => {
    const ssh = new MockSshClient()
    ssh.onExec("ls /etc/ssh/ssh_host_*_key", { exitCode: 1 })
    ssh.onExec("stat -c '%a %U %G' '/etc/passwd'", { stdout: "644 root root" })
    ssh.onExec("stat -c '%a %U %G' '/etc/shadow'", { stdout: "644 root root" }) // wrong
    ssh.onExec("stat -c '%a %U %G' '/etc/gshadow'", { stdout: "640 root shadow" })
    ssh.onExec("stat -c '%a %U %G' '/etc/group'", { stdout: "644 root root" })
    ssh.onExec("stat -c '%a %U %G' '/etc/ssh/sshd_config'", { stdout: "600 root root" })
    ssh.onExec("stat -c '%a %U %G' '/etc/crontab'", { stdout: "644 root root" }) // wrong

    const options = { ...defaultOptions, fixFilePermissions: true }
    const result = await runFixPermissions(ssh, options, defaultServer)

    expect(result.success).toBe(true)
    expect(result.message).toContain("2 file(s)")
    expect(ssh.hasCommand("chmod 640 '/etc/shadow'")).toBe(true)
    expect(ssh.hasCommand("chown root:shadow '/etc/shadow'")).toBe(true)
    expect(ssh.hasCommand("chmod 600 '/etc/crontab'")).toBe(true)
  })

  test("handles missing files gracefully", async () => {
    const ssh = new MockSshClient()
    ssh.onExec("ls /etc/ssh/ssh_host_*_key", { exitCode: 1 })
    ssh.onExec("stat -c '%a %U %G' '/etc/passwd'", { stdout: "644 root root" })
    ssh.onExec("stat -c '%a %U %G' '/etc/shadow'", { stdout: "640 root shadow" })
    ssh.onExec("stat -c '%a %U %G' '/etc/gshadow'", { stdout: "640 root shadow" })
    ssh.onExec("stat -c '%a %U %G' '/etc/group'", { stdout: "644 root root" })
    ssh.onExec("stat -c '%a %U %G' '/etc/ssh/sshd_config'", { stdout: "600 root root" })
    ssh.onExec("stat -c '%a %U %G' '/etc/crontab'", { exitCode: 1 }) // missing

    const options = { ...defaultOptions, fixFilePermissions: true }
    const result = await runFixPermissions(ssh, options, defaultServer)

    expect(result.success).toBe(true)
    expect(result.message).toContain("all permissions already correct")
  })

  test("includes SSH host keys in check", async () => {
    const ssh = new MockSshClient()
    ssh.onExec("ls /etc/ssh/ssh_host_*_key", {
      stdout: "/etc/ssh/ssh_host_ed25519_key\n/etc/ssh/ssh_host_rsa_key",
    })
    ssh.onExec("stat -c '%a %U %G' '/etc/passwd'", { stdout: "644 root root" })
    ssh.onExec("stat -c '%a %U %G' '/etc/shadow'", { stdout: "640 root shadow" })
    ssh.onExec("stat -c '%a %U %G' '/etc/gshadow'", { stdout: "640 root shadow" })
    ssh.onExec("stat -c '%a %U %G' '/etc/group'", { stdout: "644 root root" })
    ssh.onExec("stat -c '%a %U %G' '/etc/ssh/sshd_config'", { stdout: "600 root root" })
    ssh.onExec("stat -c '%a %U %G' '/etc/crontab'", { stdout: "600 root root" })
    ssh.onExec("stat -c '%a %U %G' '/etc/ssh/ssh_host_ed25519_key'", { stdout: "644 root root" }) // wrong
    ssh.onExec("stat -c '%a %U %G' '/etc/ssh/ssh_host_rsa_key'", { stdout: "600 root root" }) // ok

    const options = { ...defaultOptions, fixFilePermissions: true }
    const result = await runFixPermissions(ssh, options, defaultServer)

    expect(result.success).toBe(true)
    expect(result.message).toContain("1 file(s)")
    expect(ssh.hasCommand("chmod 600 '/etc/ssh/ssh_host_ed25519_key'")).toBe(true)
  })

  test("reports failure when chmod fails", async () => {
    const ssh = new MockSshClient()
    ssh.onExec("ls /etc/ssh/ssh_host_*_key", { exitCode: 1 })
    ssh.onExec("stat -c '%a %U %G' '/etc/passwd'", { stdout: "644 root root" })
    ssh.onExec("stat -c '%a %U %G' '/etc/shadow'", { stdout: "644 root root" }) // wrong
    ssh.onExec("stat -c '%a %U %G' '/etc/gshadow'", { stdout: "640 root shadow" })
    ssh.onExec("stat -c '%a %U %G' '/etc/group'", { stdout: "644 root root" })
    ssh.onExec("stat -c '%a %U %G' '/etc/ssh/sshd_config'", { stdout: "600 root root" })
    ssh.onExec("stat -c '%a %U %G' '/etc/crontab'", { stdout: "600 root root" })
    ssh.onExec("chmod 640", { exitCode: 1 })

    const options = { ...defaultOptions, fixFilePermissions: true }
    const result = await runFixPermissions(ssh, options, defaultServer)

    expect(result.success).toBe(false)
    expect(result.details).toContain("Failed: /etc/shadow")
  })
})

describe("checkPermissions", () => {
  test("returns empty array when all correct", async () => {
    const ssh = new MockSshClient()
    ssh.onExec("ls /etc/ssh/ssh_host_*_key", { exitCode: 1 })
    ssh.onExec("stat -c '%a %U %G' '/etc/passwd'", { stdout: "644 root root" })
    ssh.onExec("stat -c '%a %U %G' '/etc/shadow'", { stdout: "640 root shadow" })
    ssh.onExec("stat -c '%a %U %G' '/etc/gshadow'", { stdout: "640 root shadow" })
    ssh.onExec("stat -c '%a %U %G' '/etc/group'", { stdout: "644 root root" })
    ssh.onExec("stat -c '%a %U %G' '/etc/ssh/sshd_config'", { stdout: "600 root root" })
    ssh.onExec("stat -c '%a %U %G' '/etc/crontab'", { stdout: "600 root root" })

    const violations = await checkPermissions(ssh)
    expect(violations).toHaveLength(0)
  })

  test("detects wrong permissions", async () => {
    const ssh = new MockSshClient()
    ssh.onExec("ls /etc/ssh/ssh_host_*_key", { exitCode: 1 })
    ssh.onExec("stat -c '%a %U %G' '/etc/passwd'", { stdout: "644 root root" })
    ssh.onExec("stat -c '%a %U %G' '/etc/shadow'", { stdout: "644 root root" }) // wrong mode + group
    ssh.onExec("stat -c '%a %U %G' '/etc/gshadow'", { stdout: "640 root shadow" })
    ssh.onExec("stat -c '%a %U %G' '/etc/group'", { stdout: "644 root root" })
    ssh.onExec("stat -c '%a %U %G' '/etc/ssh/sshd_config'", { stdout: "600 root root" })
    ssh.onExec("stat -c '%a %U %G' '/etc/crontab'", { stdout: "600 root root" })

    const violations = await checkPermissions(ssh)
    expect(violations).toHaveLength(1)
    expect(violations[0]?.path).toBe("/etc/shadow")
  })
})
