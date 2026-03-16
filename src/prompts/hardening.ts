import * as p from "@clack/prompts"
import { existsSync, readFileSync } from "fs"
import pc from "picocolors"
import { detectDefaultPubKeyPath } from "../ssh/index.ts"
import type { HardeningOptions, ServerInfo, SshClient } from "../types.ts"
import { unwrapBoolean, unwrapText } from "./helpers.ts"
import { promptServiceOptions } from "./services.ts"
import { promptSshOptions } from "./ssh-options.ts"
import { promptSysctlOptions } from "./sysctl.ts"
import { promptUfwOptions } from "./ufw.ts"

async function promptSudoUser(server: ServerInfo, options: HardeningOptions): Promise<void> {
  if (!server.isRoot) return

  p.log.info(pc.dim("A dedicated sudo user is recommended for daily operations instead of using root directly."))
  const createUser = unwrapBoolean(
    await p.confirm({
      message: "You are connected as root. Do you want to create a new sudo user?",
    }),
  )

  if (!createUser) return

  options.createSudoUser = true

  const sudoUsername = unwrapText(
    await p.text({
      message: "Enter the new username",
      placeholder: "deploy",
      validate(value) {
        if (!value?.trim()) return "Username is required"
        if (!/^[a-z_][a-z0-9_-]*$/.test(value)) return "Invalid username format"
        return undefined
      },
    }),
  )
  options.sudoUsername = sudoUsername.trim()

  const sudoPassword = unwrapText(
    await p.password({
      message: `Enter password for ${sudoUsername}`,
      validate(value) {
        if (!value || value.length < 8) return "Password must be at least 8 characters"
        return undefined
      },
    }),
  )
  options.sudoPassword = sudoPassword
}

async function promptPersonalKey(options: HardeningOptions): Promise<boolean> {
  const addKey = unwrapBoolean(
    await p.confirm({
      message: "Do you want to add a personal SSH public key to the server?",
    }),
  )

  if (!addKey) return false

  options.addPersonalKey = true
  const defaultPubKey = detectDefaultPubKeyPath()

  const pubKeyPath = unwrapText(
    await p.text({
      message: "Path to your public SSH key",
      placeholder: defaultPubKey ?? "~/.ssh/id_ed25519.pub",
      defaultValue: defaultPubKey,
      validate(value) {
        if (!value?.trim()) return "Path is required"
        const resolved = value.replace("~", process.env.HOME ?? "")
        if (!existsSync(resolved)) return `File not found: ${resolved}`
        const content = readFileSync(resolved, "utf-8").trim()
        if (!content.startsWith("ssh-")) return "Invalid public key format (must start with ssh-)"
        return undefined
      },
    }),
  )
  options.personalKeyPath = pubKeyPath.replace("~", process.env.HOME ?? "")
  return true
}

async function promptPasswordAuth(options: HardeningOptions, ssh: SshClient): Promise<void> {
  const targetUser =
    options.createSudoUser && options.sudoUsername ? options.sudoUsername : (await ssh.exec("whoami")).stdout

  const targetHome = targetUser === "root" ? "/root" : `/home/${targetUser}`
  const existingKeysResult = await ssh.exec(
    `test -f '${targetHome}/.ssh/authorized_keys' && grep -c 'ssh-' '${targetHome}/.ssh/authorized_keys' || echo 0`,
  )
  const hasExistingKey = parseInt(existingKeysResult.stdout, 10) > 0
  const willHaveKey = options.addPersonalKey || hasExistingKey

  if (willHaveKey) {
    const disablePw = unwrapBoolean(
      await p.confirm({
        message: "Do you want to disable SSH password authentication?",
        initialValue: true,
      }),
    )
    options.disablePasswordAuth = disablePw
  } else {
    p.log.warning(
      pc.yellow("Cannot disable password authentication: no SSH key found or being added for ") +
        pc.bold(targetUser) +
        pc.yellow(". You would be locked out."),
    )
    options.disablePasswordAuth = false
  }
}

export async function promptHardeningOptions(
  server: ServerInfo,
  ssh: SshClient,
  detectedServices: string[],
): Promise<HardeningOptions> {
  const options: HardeningOptions = {
    createSudoUser: false,
    addPersonalKey: false,
    configureCoolify: false,
    changeSshPort: false,
    permitRootLogin: "yes",
    disablePasswordAuth: false,
    disableX11Forwarding: true,
    maxAuthTries: 5,
    installUfw: false,
    ufwPorts: [],
    installFail2ban: false,
    enableAutoUpdates: false,
    enableSysctl: false,
    enableSshBanner: false,
    disableServices: false,
    servicesToDisable: [],
    fixFilePermissions: false,
  }

  await promptSudoUser(server, options)

  const addedKey = await promptPersonalKey(options)

  // Configure for Coolify
  const coolify = unwrapBoolean(
    await p.confirm({
      message: "Do you want to configure this server for Coolify?",
      initialValue: false,
    }),
  )
  options.configureCoolify = coolify

  if (coolify) {
    p.log.info(pc.dim("Coolify requires root SSH access. Root login will be set to 'prohibit-password' (key-only)."))
    if (!addedKey) {
      p.log.warning(pc.yellow("You should add an SSH key for root access. Coolify will need it."))
    }
  }

  await promptSshOptions(options)
  await promptPasswordAuth(options, ssh)

  const sshPort = options.changeSshPort && options.newSshPort ? options.newSshPort : 22
  await promptUfwOptions(options, sshPort)

  // Fail2ban
  options.installFail2ban = unwrapBoolean(
    await p.confirm({
      message: "Do you want to install Fail2ban to protect against brute-force attacks?",
    }),
  )

  // Auto-updates
  options.enableAutoUpdates = unwrapBoolean(
    await p.confirm({
      message: "Do you want to enable automatic security updates (unattended-upgrades)?",
    }),
  )

  // Disable unnecessary services
  await promptServiceOptions(options, detectedServices)

  // Fix file permissions
  options.fixFilePermissions = unwrapBoolean(
    await p.confirm({
      message: "Do you want to fix permissions on sensitive system files?",
      initialValue: true,
    }),
  )

  await promptSysctlOptions(options)

  return options
}
