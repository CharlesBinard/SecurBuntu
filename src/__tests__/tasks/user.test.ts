import { describe, expect, test } from "bun:test"
import { runCreateUser } from "../../tasks/user.ts"
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

describe("runCreateUser", () => {
  test("skips when not requested", async () => {
    const ssh = new MockSshClient()
    const result = await runCreateUser(ssh, defaultOptions, defaultServer)
    expect(result.success).toBe(true)
    expect(result.message).toStartWith("Skipped")
  })

  test("creates new user when not existing", async () => {
    const ssh = new MockSshClient()
    ssh.onExec("id deploy", { stdout: "missing" })

    const options = {
      ...defaultOptions,
      createSudoUser: true,
      sudoUsername: "deploy",
      sudoPassword: "securepass",
    }

    const result = await runCreateUser(ssh, options, defaultServer)

    expect(result.success).toBe(true)
    expect(result.message).toContain("deploy")
    expect(result.message).toContain("created")
    expect(ssh.hasCommand("adduser")).toBe(true)
    expect(ssh.hasCommand("chpasswd")).toBe(true)
    expect(ssh.hasCommand("usermod -aG sudo")).toBe(true)
  })

  test("updates existing user", async () => {
    const ssh = new MockSshClient()
    ssh.onExec("id deploy", { stdout: "exists" })

    const options = {
      ...defaultOptions,
      createSudoUser: true,
      sudoUsername: "deploy",
      sudoPassword: "securepass",
    }

    const result = await runCreateUser(ssh, options, defaultServer)

    expect(result.success).toBe(true)
    expect(result.message).toContain("already existed")
    expect(ssh.hasCommand("adduser")).toBe(false)
  })

  test("fails when adduser fails", async () => {
    const ssh = new MockSshClient()
    ssh.onExec("id deploy", { stdout: "missing" })
    ssh.onExec("adduser", { exitCode: 1, stderr: "adduser error" })

    const options = {
      ...defaultOptions,
      createSudoUser: true,
      sudoUsername: "deploy",
      sudoPassword: "securepass",
    }

    const result = await runCreateUser(ssh, options, defaultServer)

    expect(result.success).toBe(false)
    expect(result.message).toContain("Failed to create")
  })

  test("fails when chpasswd fails", async () => {
    const ssh = new MockSshClient()
    ssh.onExec("id deploy", { stdout: "missing" })
    ssh.onExec("chpasswd", { exitCode: 1, stderr: "chpasswd error" })

    const options = {
      ...defaultOptions,
      createSudoUser: true,
      sudoUsername: "deploy",
      sudoPassword: "securepass",
    }

    const result = await runCreateUser(ssh, options, defaultServer)

    expect(result.success).toBe(false)
    expect(result.message).toContain("Failed to set password")
  })

  test("sends correct stdin to chpasswd", async () => {
    const ssh = new MockSshClient()
    ssh.onExec("id deploy", { stdout: "missing" })

    const options = {
      ...defaultOptions,
      createSudoUser: true,
      sudoUsername: "deploy",
      sudoPassword: "MyP@ss123",
    }

    await runCreateUser(ssh, options, defaultServer)

    const stdinEntry = [...ssh.stdinData.entries()].find(([cmd]) => cmd.includes("chpasswd"))
    expect(stdinEntry?.[1]).toBe("deploy:MyP@ss123\n")
  })

  test("fails when usermod fails", async () => {
    const ssh = new MockSshClient()
    ssh.onExec("id deploy", { stdout: "missing" })
    ssh.onExec("usermod", { exitCode: 1, stderr: "usermod error" })

    const options = {
      ...defaultOptions,
      createSudoUser: true,
      sudoUsername: "deploy",
      sudoPassword: "securepass",
    }

    const result = await runCreateUser(ssh, options, defaultServer)

    expect(result.success).toBe(false)
    expect(result.message).toContain("sudo group")
  })

  test("fails when SSH directory setup fails", async () => {
    const ssh = new MockSshClient()
    ssh.onExec("id deploy", { stdout: "missing" })
    ssh.onExec("mkdir -p /home/deploy/.ssh", { exitCode: 1, stderr: "permission denied" })

    const options = {
      ...defaultOptions,
      createSudoUser: true,
      sudoUsername: "deploy",
      sudoPassword: "securepass",
    }

    const result = await runCreateUser(ssh, options, defaultServer)

    expect(result.success).toBe(false)
    expect(result.message).toContain("SSH directory")
  })
})
