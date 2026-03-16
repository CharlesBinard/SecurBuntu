import * as p from "@clack/prompts"
import type { HardeningOptions } from "../types.ts"
import { handleCancel, isCancel, unwrapBoolean, unwrapStringArray, unwrapText } from "./helpers.ts"

export function parseUfwPortChoice(choice: string): {
  port: string
  protocol: "tcp" | "udp" | "both"
  comment: string
} {
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
}

function validatePortInput(value: string | undefined): string | undefined {
  if (!value?.trim()) return "Port is required"
  if (!/^\d+(?::\d+)?$/.test(value)) return "Invalid format. Use: 8080 or 6000:6100"
  const parts = value.split(":")
  for (const part of parts) {
    const n = parseInt(part, 10)
    if (n < 1 || n > 65_535) return "Port must be between 1 and 65535"
  }
  if (parts.length === 2 && parseInt(parts[0] ?? "0", 10) >= parseInt(parts[1] ?? "0", 10)) {
    return "Range start must be less than range end"
  }
  return undefined
}

async function promptCustomUfwPorts(): Promise<{ port: string; protocol: "tcp" | "udp" | "both"; comment: string }[]> {
  const customPorts: { port: string; protocol: "tcp" | "udp" | "both"; comment: string }[] = []

  let addMore = unwrapBoolean(
    await p.confirm({
      message: "Do you want to add a custom port?",
      initialValue: false,
    }),
  )

  while (addMore) {
    const customPort = unwrapText(
      await p.text({
        message: "Enter port or range (e.g., 8080 or 6000:6100)",
        validate: validatePortInput,
      }),
    )

    const customProto = await p.select({
      message: "Protocol for this port?",
      options: [
        { value: "tcp" as const, label: "TCP" },
        { value: "udp" as const, label: "UDP" },
        { value: "both" as const, label: "Both" },
      ],
    })
    if (isCancel(customProto)) handleCancel()

    customPorts.push({
      port: customPort.trim(),
      protocol: customProto,
      comment: `SecurBuntu: Custom port ${customPort}`,
    })

    addMore = unwrapBoolean(
      await p.confirm({
        message: "Add another custom port?",
        initialValue: false,
      }),
    )
  }

  return customPorts
}

export async function promptUfwOptions(options: HardeningOptions, sshPort: number, ufwActive: boolean): Promise<void> {
  const ufwMessage = ufwActive
    ? "UFW is already active. Do you want to update firewall rules?"
    : "Do you want to install and configure UFW (firewall)?"
  const installUfw = unwrapBoolean(
    await p.confirm({
      message: ufwMessage,
    }),
  )

  if (!installUfw) return

  options.installUfw = true
  const sshPortStr = String(sshPort)

  const portChoices = unwrapStringArray(
    await p.multiselect({
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
    }),
  )

  options.ufwPorts = portChoices.map(parseUfwPortChoice)

  const customPorts = await promptCustomUfwPorts()
  options.ufwPorts.push(...customPorts)
}
