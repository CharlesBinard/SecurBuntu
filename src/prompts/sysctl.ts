import * as p from "@clack/prompts"
import pc from "picocolors"
import type { HardeningOptions } from "../types.ts"
import { unwrapBoolean, unwrapStringArray } from "./helpers.ts"

export async function promptSysctlOptions(options: HardeningOptions): Promise<void> {
  const enableSysctl = unwrapBoolean(
    await p.confirm({
      message: "Do you want to apply kernel security parameters (sysctl)?",
      initialValue: false,
    }),
  )

  if (!enableSysctl) return

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

  const defaultValues = sysctlChoices.filter((c) => c.hint?.startsWith("recommended")).map((c) => c.value)

  const selected = unwrapStringArray(
    await p.multiselect({
      message: "Select the protections to apply",
      options: sysctlChoices,
      initialValues: defaultValues,
    }),
  )

  options.sysctlOptions = {
    blockForwarding: selected.includes("blockForwarding"),
    ignoreRedirects: selected.includes("ignoreRedirects"),
    disableSourceRouting: selected.includes("disableSourceRouting"),
    synFloodProtection: selected.includes("synFloodProtection"),
    disableIcmpBroadcast: selected.includes("disableIcmpBroadcast"),
  }
}
