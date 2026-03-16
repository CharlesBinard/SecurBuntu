import * as p from "@clack/prompts"
import { UNNECESSARY_SERVICES } from "../tasks/services.ts"
import type { HardeningOptions } from "../types.ts"
import { unwrapStringArray } from "./helpers.ts"

export async function promptServiceOptions(options: HardeningOptions, detectedServices: string[]): Promise<void> {
  if (detectedServices.length === 0) return

  const choices = UNNECESSARY_SERVICES.filter((s) => detectedServices.includes(s.name)).map((s) => ({
    value: s.name,
    label: `${s.name} — ${s.description}`,
  }))

  const selected = unwrapStringArray(
    await p.multiselect({
      message: "Select unnecessary services to disable",
      options: choices,
      initialValues: choices.map((c) => c.value),
      required: false,
    }),
  )

  if (selected.length > 0) {
    options.disableServices = true
    options.servicesToDisable = selected
  }
}
