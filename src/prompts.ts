import * as p from "@clack/prompts"
import pc from "picocolors"
import { readFileSync, existsSync } from "fs"
import { detectDefaultKeyPath, detectDefaultPubKeyPath, checkSshpassInstalled } from "./ssh.js"
import type { ConnectionConfig, HardeningOptions, ServerInfo, SshClient, UfwPort } from "./types.js"

function isCancel(value: unknown): value is symbol {
  return p.isCancel(value)
}

function handleCancel(): never {
  p.cancel("Operation cancelled.")
  process.exit(0)
}

function unwrapText(value: string | symbol): string {
  if (isCancel(value)) handleCancel()
  return value
}

function unwrapBoolean(value: boolean | symbol): boolean {
  if (isCancel(value)) handleCancel()
  return value
}

function unwrapStringArray(value: string[] | symbol): string[] {
  if (isCancel(value)) handleCancel()
  return value
}

export async function promptConnection(): Promise<ConnectionConfig> {
  const host = unwrapText(await p.text({
    message: "Enter the server IP address or hostname",
    placeholder: "192.168.1.100",
    validate(value) {
      if (!value || !value.trim()) return "IP address is required"
    },
  }))

  const username = unwrapText(await p.text({
    message: "Enter the SSH username",
    placeholder: "root",
    defaultValue: "root",
    validate(value) {
      if (!value || !value.trim()) return "Username is required"
      if (!/^[a-z_][a-z0-9_-]*$/.test(value)) return "Invalid username format (lowercase letters, digits, hyphens, underscores)"
    },
  }))

  const authMethod = await p.select({
    message: "How do you want to authenticate?",
    options: [
      { value: "key" as const, label: "SSH Key", hint: "recommended" },
      { value: "password" as const, label: "Password" },
    ],
  })
  if (isCancel(authMethod)) handleCancel()

  let privateKeyPath: string | undefined
  let password: string | undefined

  if (authMethod === "key") {
    const defaultKey = detectDefaultKeyPath()
    const keyPath = unwrapText(await p.text({
      message: "Path to your private SSH key",
      placeholder: defaultKey ?? "~/.ssh/id_ed25519",
      defaultValue: defaultKey,
      validate(value) {
        if (!value || !value.trim()) return "Key path is required"
        const resolved = value.replace("~", process.env.HOME ?? "")
        if (!existsSync(resolved)) return `File not found: ${resolved}`
      },
    }))
    privateKeyPath = keyPath.replace("~", process.env.HOME ?? "")
  } else {
    const hasSshpass = await checkSshpassInstalled()
    if (!hasSshpass) {
      p.log.error(
        `${pc.red("sshpass is required for password authentication but is not installed.")}\n` +
        `  ${pc.dim("Install it with:")}\n` +
        `  ${pc.cyan("  Ubuntu/Debian: sudo apt install sshpass")}\n` +
        `  ${pc.cyan("  macOS:         brew install sshpass")}`
      )
      process.exit(1)
    }

    const pw = unwrapText(await p.password({
      message: "Enter the SSH password",
      validate(value) {
        if (!value) return "Password is required"
      },
    }))
    password = pw
  }

  return {
    host: host.trim(),
    port: 22,
    username: username.trim(),
    authMethod,
    privateKeyPath,
    password,
    controlPath: "",
  }
}

export async function promptHardeningOptions(
  server: ServerInfo,
  ssh: SshClient,
): Promise<HardeningOptions> {
  const options: HardeningOptions = {
    createSudoUser: false,
    addPersonalKey: false,
    configureCoolify: false,
    changeSshPort: false,
    disablePasswordAuth: false,
    installUfw: false,
    ufwPorts: [],
    installFail2ban: false,
    enableAutoUpdates: false,
  }

  // 1. Create sudo user (only if root)
  if (server.isRoot) {
    p.log.info(pc.dim("A dedicated sudo user is recommended for daily operations instead of using root directly."))
    const createUser = unwrapBoolean(await p.confirm({
      message: "You are connected as root. Do you want to create a new sudo user?",
    }))

    if (createUser) {
      options.createSudoUser = true

      const sudoUsername = unwrapText(await p.text({
        message: "Enter the new username",
        placeholder: "deploy",
        validate(value) {
          if (!value || !value.trim()) return "Username is required"
          if (!/^[a-z_][a-z0-9_-]*$/.test(value)) return "Invalid username format"
        },
      }))
      options.sudoUsername = sudoUsername.trim()

      const sudoPassword = unwrapText(await p.password({
        message: `Enter password for ${sudoUsername}`,
        validate(value) {
          if (!value || value.length < 8) return "Password must be at least 8 characters"
        },
      }))
      options.sudoPassword = sudoPassword
    }
  }

  // 2. Add personal SSH key
  const addKey = unwrapBoolean(await p.confirm({
    message: "Do you want to add a personal SSH public key to the server?",
  }))

  if (addKey) {
    options.addPersonalKey = true
    const defaultPubKey = detectDefaultPubKeyPath()

    const pubKeyPath = unwrapText(await p.text({
      message: "Path to your public SSH key",
      placeholder: defaultPubKey ?? "~/.ssh/id_ed25519.pub",
      defaultValue: defaultPubKey,
      validate(value) {
        if (!value || !value.trim()) return "Path is required"
        const resolved = value.replace("~", process.env.HOME ?? "")
        if (!existsSync(resolved)) return `File not found: ${resolved}`
        const content = readFileSync(resolved, "utf-8").trim()
        if (!content.startsWith("ssh-")) return "Invalid public key format (must start with ssh-)"
      },
    }))
    options.personalKeyPath = pubKeyPath.replace("~", process.env.HOME ?? "")
  }

  // 3. Configure for Coolify
  const coolify = unwrapBoolean(await p.confirm({
    message: "Do you want to configure this server for Coolify?",
    initialValue: false,
  }))
  options.configureCoolify = coolify

  if (coolify) {
    p.log.info(pc.dim("Coolify requires root SSH access. Root login will be set to 'prohibit-password' (key-only)."))
    if (!addKey) {
      p.log.warning(pc.yellow("You should add an SSH key for root access. Coolify will need it."))
    }
  }

  // 4. Change SSH port
  const changePort = unwrapBoolean(await p.confirm({
    message: "Do you want to change the default SSH port (22)?",
    initialValue: false,
  }))

  if (changePort) {
    options.changeSshPort = true
    const newPort = unwrapText(await p.text({
      message: "Enter the new SSH port",
      placeholder: "2222",
      validate(value) {
        if (!value) return "Must be a number"
        const port = parseInt(value, 10)
        if (isNaN(port)) return "Must be a number"
        if (port < 1024 || port > 65535) return "Port must be between 1024 and 65535"
      },
    }))
    options.newSshPort = parseInt(newPort, 10)
  }

  // 5. Disable password auth (with hard gate)
  const sshPort = options.changeSshPort && options.newSshPort ? options.newSshPort : 22
  const targetUser = options.createSudoUser && options.sudoUsername
    ? options.sudoUsername
    : (await ssh.exec("whoami")).stdout

  const targetHome = targetUser === "root" ? "/root" : `/home/${targetUser}`
  const existingKeysResult = await ssh.exec(`test -f '${targetHome}/.ssh/authorized_keys' && grep -c 'ssh-' '${targetHome}/.ssh/authorized_keys' || echo 0`)
  const hasExistingKey = parseInt(existingKeysResult.stdout, 10) > 0

  const willHaveKey = options.addPersonalKey || hasExistingKey

  if (willHaveKey) {
    const disablePw = unwrapBoolean(await p.confirm({
      message: "Do you want to disable SSH password authentication?",
      initialValue: true,
    }))
    options.disablePasswordAuth = disablePw
  } else {
    p.log.warning(
      pc.yellow("Cannot disable password authentication: no SSH key found or being added for ") +
      pc.bold(targetUser) +
      pc.yellow(". You would be locked out.")
    )
    options.disablePasswordAuth = false
  }

  // 6. Install UFW
  const installUfw = unwrapBoolean(await p.confirm({
    message: "Do you want to install and configure UFW (firewall)?",
  }))

  if (installUfw) {
    options.installUfw = true
    const sshPortStr = String(sshPort)

    const portChoices = unwrapStringArray(await p.multiselect({
      message: "Select ports to allow through the firewall",
      options: [
        { value: `${sshPortStr}/tcp|SecurBuntu: SSH access`, label: `SSH (${sshPortStr}/tcp)`, hint: "required" },
        { value: "80/tcp|SecurBuntu: HTTP web traffic", label: "HTTP (80/tcp)" },
        { value: "443/tcp|SecurBuntu: HTTPS web traffic", label: "HTTPS (443/tcp)" },
        { value: "8000/tcp|SecurBuntu: Development server", label: "Dev server (8000/tcp)" },
        { value: "3000/tcp|SecurBuntu: Node.js / Coolify UI", label: "Node.js / Coolify (3000/tcp)" },
      ],
      required: true,
      initialValues: [`${sshPortStr}/tcp|SecurBuntu: SSH access`],
    }))

    options.ufwPorts = portChoices.map((choice) => {
      const pipeIdx = choice.indexOf("|")
      const portProto = choice.slice(0, pipeIdx)
      const comment = choice.slice(pipeIdx + 1)
      const slashIdx = portProto.indexOf("/")
      const port = portProto.slice(0, slashIdx)
      const protocol = portProto.slice(slashIdx + 1)

      if (protocol !== "tcp" && protocol !== "udp" && protocol !== "both") {
        throw new Error(`Invalid protocol: ${protocol}`)
      }

      return { port, protocol, comment }
    })

    // Custom port option
    const addCustom = unwrapBoolean(await p.confirm({
      message: "Do you want to add a custom port?",
      initialValue: false,
    }))

    if (addCustom) {
      const customPort = unwrapText(await p.text({
        message: "Enter port or range (e.g., 8080 or 6000:6100)",
        validate(value) {
          if (!value || !value.trim()) return "Port is required"
          if (!/^\d+(?::\d+)?$/.test(value)) return "Invalid format. Use: 8080 or 6000:6100"
        },
      }))

      const customProto = await p.select({
        message: "Protocol for this port?",
        options: [
          { value: "tcp" as const, label: "TCP" },
          { value: "udp" as const, label: "UDP" },
          { value: "both" as const, label: "Both" },
        ],
      })
      if (isCancel(customProto)) handleCancel()

      options.ufwPorts.push({
        port: customPort.trim(),
        protocol: customProto,
        comment: `SecurBuntu: Custom port ${customPort}`,
      })
    }
  }

  // 7. Fail2ban
  const installFail2ban = unwrapBoolean(await p.confirm({
    message: "Do you want to install Fail2ban to protect against brute-force attacks?",
  }))
  options.installFail2ban = installFail2ban

  // 8. Auto-updates
  const autoUpdates = unwrapBoolean(await p.confirm({
    message: "Do you want to enable automatic security updates (unattended-upgrades)?",
  }))
  options.enableAutoUpdates = autoUpdates

  return options
}

export async function promptConfirmation(
  host: string,
  options: HardeningOptions,
): Promise<boolean> {
  const sshPort = options.changeSshPort && options.newSshPort ? options.newSshPort : 22
  const lines: string[] = []

  if (options.createSudoUser) lines.push(`  Create sudo user: ${pc.cyan(options.sudoUsername ?? "")}`)
  if (options.addPersonalKey) lines.push(`  Add SSH key: ${pc.cyan(options.personalKeyPath ?? "")}`)
  lines.push(`  Coolify: ${options.configureCoolify ? pc.green("Yes") : pc.dim("No")}`)
  lines.push(`  SSH port: ${options.changeSshPort ? pc.yellow(String(sshPort)) : pc.dim("22 (default)")}`)
  lines.push(`  Disable password auth: ${options.disablePasswordAuth ? pc.green("Yes") : pc.dim("No")}`)

  if (options.installUfw) {
    const ports = options.ufwPorts.map(p => p.port).join(", ")
    lines.push(`  UFW: ${pc.green("Yes")} (ports: ${pc.cyan(ports)})`)
  } else {
    lines.push(`  UFW: ${pc.dim("No")}`)
  }

  lines.push(`  Fail2ban: ${options.installFail2ban ? pc.green("Yes") : pc.dim("No")}`)
  lines.push(`  Auto-updates: ${options.enableAutoUpdates ? pc.green("Yes") : pc.dim("No")}`)

  p.note(lines.join("\n"), "Summary of changes")

  const confirm = unwrapBoolean(await p.confirm({
    message: `Apply these changes to ${pc.bold(host)}?`,
  }))

  return confirm
}

export async function promptExportReport(): Promise<boolean> {
  const exportReport = unwrapBoolean(await p.confirm({
    message: "Do you want to export this report as a Markdown file?",
    initialValue: false,
  }))
  return exportReport
}
