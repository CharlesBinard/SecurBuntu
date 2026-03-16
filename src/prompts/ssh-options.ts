import * as p from "@clack/prompts"
import pc from "picocolors"
import type { HardeningOptions } from "../types.ts"
import { handleCancel, isCancel, unwrapBoolean, unwrapText } from "./helpers.ts"

export async function promptSshOptions(options: HardeningOptions, currentSshPort: number): Promise<void> {
  // Change SSH port
  const changePort = unwrapBoolean(
    await p.confirm({
      message: `Do you want to change the SSH port? (currently ${currentSshPort})`,
      initialValue: false,
    }),
  )

  if (changePort) {
    options.changeSshPort = true
    const newPort = unwrapText(
      await p.text({
        message: "Enter the new SSH port",
        placeholder: "2222",
        validate(value) {
          if (!value) return "Must be a number"
          const port = parseInt(value, 10)
          if (Number.isNaN(port)) return "Must be a number"
          if (port < 1024 || port > 65_535) return "Port must be between 1024 and 65535"
          return undefined
        },
      }),
    )
    options.newSshPort = parseInt(newPort, 10)
  }

  // SSH banner
  const enableBanner = unwrapBoolean(
    await p.confirm({
      message: "Do you want to add a security warning banner to SSH?",
      initialValue: false,
    }),
  )
  options.enableSshBanner = enableBanner

  // Root login policy
  p.log.info(
    pc.dim(
      "Controls whether root can log in via SSH.\n" +
        "  • 'no' = root cannot log in at all (most secure, but breaks Coolify/tools that need root)\n" +
        "  • 'key only' = root can log in with SSH key only (recommended for Coolify)\n" +
        "  • 'yes' = root can log in with password or key (least secure)",
    ),
  )

  const rootLoginChoice = await p.select({
    message: "Root SSH login policy",
    options: [
      { value: "prohibit-password" as const, label: "Key only (prohibit-password)", hint: "recommended" },
      { value: "no" as const, label: "Disabled (no root login)" },
      { value: "yes" as const, label: "Allowed (keep as-is)", hint: "least secure" },
    ],
    initialValue: options.configureCoolify ? ("prohibit-password" as const) : ("prohibit-password" as const),
  })
  if (isCancel(rootLoginChoice)) handleCancel()
  options.permitRootLogin = rootLoginChoice

  // X11 Forwarding
  p.log.info(
    pc.dim(
      "X11 forwarding allows graphical apps from the server to display on your machine.\n" +
        "  Disabling it is recommended unless you specifically need remote GUI apps.",
    ),
  )
  const disableX11 = unwrapBoolean(
    await p.confirm({
      message: "Disable X11 forwarding?",
      initialValue: true,
    }),
  )
  options.disableX11Forwarding = disableX11

  // Max auth tries
  p.log.info(
    pc.dim(
      "Limits the number of authentication attempts per connection.\n" +
        "  Lower values protect against brute-force attacks. Default SSH is 6, we recommend 3-5.",
    ),
  )
  const maxTriesStr = unwrapText(
    await p.text({
      message: "Maximum authentication attempts per connection",
      placeholder: "5",
      defaultValue: "5",
      validate(value) {
        if (!value) return "Must be a number"
        const n = parseInt(value, 10)
        if (Number.isNaN(n)) return "Must be a number"
        if (n < 1 || n > 10) return "Must be between 1 and 10"
        return undefined
      },
    }),
  )
  options.maxAuthTries = parseInt(maxTriesStr, 10)
}
