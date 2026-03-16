import * as p from "@clack/prompts"
import pc from "picocolors"
import { readFileSync, existsSync } from "fs"
import { detectDefaultKeyPath, detectDefaultPubKeyPath, checkSshpassInstalled, checkSshCopyIdInstalled } from "./ssh.js"
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
      { value: "copy" as const, label: "Copy my SSH key to server", hint: "needs password" },
    ],
  })
  if (isCancel(authMethod)) handleCancel()

  let privateKeyPath: string | undefined
  let password: string | undefined

  if (authMethod === "key" || authMethod === "copy") {
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

    if (authMethod === "copy") {
      const pubKeyPath = privateKeyPath + ".pub"
      if (!existsSync(pubKeyPath)) {
        p.log.error(
          `${pc.red(`Public key not found at ${pubKeyPath}`)}\n` +
          `  ${pc.dim("Make sure the .pub file exists alongside your private key.")}`
        )
        throw new Error(`Public key not found at ${pubKeyPath}`)
      }

      const hasSshCopyId = await checkSshCopyIdInstalled()
      if (!hasSshCopyId) {
        p.log.error(
          `${pc.red("ssh-copy-id is required but is not installed.")}\n` +
          `  ${pc.dim("Install it with:")}\n` +
          `  ${pc.cyan("  Ubuntu/Debian: sudo apt install openssh-client")}\n` +
          `  ${pc.cyan("  macOS:         brew install ssh-copy-id")}`
        )
        throw new Error("ssh-copy-id is not installed")
      }
    }
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

  // SSH banner
  const enableBanner = unwrapBoolean(await p.confirm({
    message: "Do you want to add a security warning banner to SSH?",
    initialValue: false,
  }))
  options.enableSshBanner = enableBanner

  // 5. Root login policy
  p.log.info(pc.dim(
    "Controls whether root can log in via SSH.\n" +
    "  • 'no' = root cannot log in at all (most secure, but breaks Coolify/tools that need root)\n" +
    "  • 'key only' = root can log in with SSH key only (recommended for Coolify)\n" +
    "  • 'yes' = root can log in with password or key (least secure)"
  ))

  const rootLoginChoice = await p.select({
    message: "Root SSH login policy",
    options: [
      { value: "prohibit-password" as const, label: "Key only (prohibit-password)", hint: "recommended" },
      { value: "no" as const, label: "Disabled (no root login)" },
      { value: "yes" as const, label: "Allowed (keep as-is)", hint: "least secure" },
    ],
    initialValue: options.configureCoolify ? "prohibit-password" as const : "prohibit-password" as const,
  })
  if (isCancel(rootLoginChoice)) handleCancel()
  options.permitRootLogin = rootLoginChoice

  // 6. X11 Forwarding
  p.log.info(pc.dim(
    "X11 forwarding allows graphical apps from the server to display on your machine.\n" +
    "  Disabling it is recommended unless you specifically need remote GUI apps."
  ))
  const disableX11 = unwrapBoolean(await p.confirm({
    message: "Disable X11 forwarding?",
    initialValue: true,
  }))
  options.disableX11Forwarding = disableX11

  // 7. Max auth tries
  p.log.info(pc.dim(
    "Limits the number of authentication attempts per connection.\n" +
    "  Lower values protect against brute-force attacks. Default SSH is 6, we recommend 3-5."
  ))
  const maxTriesStr = unwrapText(await p.text({
    message: "Maximum authentication attempts per connection",
    placeholder: "5",
    defaultValue: "5",
    validate(value) {
      if (!value) return "Must be a number"
      const n = parseInt(value, 10)
      if (isNaN(n)) return "Must be a number"
      if (n < 1 || n > 10) return "Must be between 1 and 10"
    },
  }))
  options.maxAuthTries = parseInt(maxTriesStr, 10)

  // 8. Disable password auth (with hard gate)
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

  // 9. Kernel hardening (sysctl)
  const enableSysctl = unwrapBoolean(await p.confirm({
    message: "Do you want to apply kernel security parameters (sysctl)?",
    initialValue: false,
  }))

  if (enableSysctl) {
    options.enableSysctl = true

    const sysctlChoices: { value: string; label: string; hint?: string }[] = []

    if (!options.configureCoolify) {
      sysctlChoices.push({
        value: "blockForwarding",
        label: "Block traffic forwarding",
        hint: "recommended — prevents routing; disable if using Docker",
      })
    } else {
      p.log.info(pc.dim("IP forwarding is required for Docker/Coolify — this option has been removed."))
    }

    sysctlChoices.push(
      {
        value: "ignoreRedirects",
        label: "Ignore ICMP redirects",
        hint: "recommended — blocks fake routing messages",
      },
      {
        value: "disableSourceRouting",
        label: "Disable source routing",
        hint: "recommended — blocks packets with forced paths",
      },
      {
        value: "synFloodProtection",
        label: "SYN flood protection",
        hint: "recommended — limits connection saturation attacks",
      },
      {
        value: "disableIcmpBroadcast",
        label: "Disable ICMP broadcast replies",
        hint: "hides the server from ping scans",
      },
    )

    const defaultValues = sysctlChoices
      .filter(c => c.hint?.startsWith("recommended"))
      .map(c => c.value)

    const selected = unwrapStringArray(await p.multiselect({
      message: "Select the protections to apply",
      options: sysctlChoices,
      initialValues: defaultValues,
    }))

    options.sysctlOptions = {
      blockForwarding: selected.includes("blockForwarding"),
      ignoreRedirects: selected.includes("ignoreRedirects"),
      disableSourceRouting: selected.includes("disableSourceRouting"),
      synFloodProtection: selected.includes("synFloodProtection"),
      disableIcmpBroadcast: selected.includes("disableIcmpBroadcast"),
    }
  }

  return options
}

export async function promptConfirmation(
  host: string,
  options: HardeningOptions,
): Promise<"apply" | "simulate" | false> {
  const sshPort = options.changeSshPort && options.newSshPort ? options.newSshPort : 22
  const lines: string[] = []

  if (options.createSudoUser) lines.push(`  Create sudo user: ${pc.cyan(options.sudoUsername ?? "")}`)
  if (options.addPersonalKey) lines.push(`  Add SSH key: ${pc.cyan(options.personalKeyPath ?? "")}`)
  lines.push(`  Coolify: ${options.configureCoolify ? pc.green("Yes") : pc.dim("No")}`)
  lines.push(`  SSH port: ${options.changeSshPort ? pc.yellow(String(sshPort)) : pc.dim("22 (default)")}`)
  lines.push(`  Root login: ${options.permitRootLogin === "no" ? pc.green("disabled") : options.permitRootLogin === "prohibit-password" ? pc.cyan("key only") : pc.yellow("allowed")}`)
  lines.push(`  SSH banner: ${options.enableSshBanner ? pc.green("Yes") : pc.dim("No")}`)
  lines.push(`  Disable password auth: ${options.disablePasswordAuth ? pc.green("Yes") : pc.dim("No")}`)
  lines.push(`  X11 forwarding: ${options.disableX11Forwarding ? pc.green("disabled") : pc.dim("enabled")}`)
  lines.push(`  Max auth tries: ${pc.cyan(String(options.maxAuthTries))}`)

  if (options.installUfw) {
    const ports = options.ufwPorts.map(p => p.port).join(", ")
    lines.push(`  UFW: ${pc.green("Yes")} (ports: ${pc.cyan(ports)})`)
  } else {
    lines.push(`  UFW: ${pc.dim("No")}`)
  }

  lines.push(`  Fail2ban: ${options.installFail2ban ? pc.green("Yes") : pc.dim("No")}`)
  lines.push(`  Auto-updates: ${options.enableAutoUpdates ? pc.green("Yes") : pc.dim("No")}`)

  if (options.enableSysctl && options.sysctlOptions) {
    const count = Object.values(options.sysctlOptions).filter(Boolean).length
    lines.push(`  Kernel hardening: ${pc.green(`${count} parameter(s)`)}`)
  } else {
    lines.push(`  Kernel hardening: ${pc.dim("No")}`)
  }

  p.note(lines.join("\n"), "Summary of changes")

  const action = await p.select({
    message: `What do you want to do with ${pc.bold(host)}?`,
    options: [
      { value: "apply" as const, label: "Apply changes" },
      { value: "simulate" as const, label: "Simulate first (dry-run)", hint: "preview without modifying" },
      { value: "cancel" as const, label: "Cancel" },
    ],
  })

  if (p.isCancel(action) || action === "cancel") return false
  if (action === "apply" || action === "simulate") return action
  return false
}

export async function promptExportReport(): Promise<boolean> {
  const exportReport = unwrapBoolean(await p.confirm({
    message: "Do you want to export this report as a Markdown file?",
    initialValue: false,
  }))
  return exportReport
}

export async function promptExportLog(): Promise<boolean> {
  const exportLog = unwrapBoolean(await p.confirm({
    message: "Do you want to save a detailed log of all commands executed?",
    initialValue: false,
  }))
  return exportLog
}

export async function promptExportAudit(): Promise<boolean> {
  const exportAudit = unwrapBoolean(await p.confirm({
    message: "Do you want to export the audit report as a Markdown file?",
    initialValue: false,
  }))
  return exportAudit
}

export async function promptCopyKeyOnFailure(): Promise<boolean> {
  const action = await p.select({
    message: "Would you like to copy your SSH key to the server?",
    options: [
      { value: "yes" as const, label: "Yes, copy my key", hint: "needs password" },
      { value: "no" as const, label: "No, let me try different credentials" },
    ],
  })
  if (isCancel(action)) handleCancel()
  return action === "yes"
}
