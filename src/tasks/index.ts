import { spinner } from "@clack/prompts"
import type { HardeningOptions, ServerInfo, SshClient, TaskResult } from "../types.js"
import { runCreateUser } from "./user.js"
import { runInjectSshKeys } from "./ssh-keys.js"
import { runConfigureUfw } from "./ufw.js"
import { runConfigureFail2ban } from "./fail2ban.js"
import { runConfigureUnattended } from "./unattended.js"
import { runHardenSshConfig } from "./ssh-config.js"

interface TaskEntry {
  label: string
  run: (ssh: SshClient, options: HardeningOptions, server: ServerInfo) => Promise<TaskResult>
}

// System update is NOT in this list — it runs before the questionnaire in index.ts
const TASKS: TaskEntry[] = [
  { label: "Creating sudo user", run: runCreateUser },
  { label: "Injecting SSH keys", run: runInjectSshKeys },
  { label: "Configuring UFW firewall", run: runConfigureUfw },
  { label: "Configuring Fail2ban", run: runConfigureFail2ban },
  { label: "Configuring automatic updates", run: runConfigureUnattended },
  { label: "Hardening SSH configuration", run: runHardenSshConfig },
]

export async function executeTasks(
  ssh: SshClient,
  options: HardeningOptions,
  server: ServerInfo,
): Promise<TaskResult[]> {
  const results: TaskResult[] = []
  const s = spinner()

  for (const task of TASKS) {
    s.start(task.label)
    try {
      const result = await task.run(ssh, options, server)
      if (result.message.startsWith("Skipped")) {
        s.stop(`${task.label} — skipped`)
      } else if (result.success) {
        s.stop(`${task.label} — done`)
      } else {
        s.stop(`${task.label} — failed: ${result.message}`)
      }
      results.push(result)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error"
      s.stop(`${task.label} — error: ${message}`)
      results.push({
        name: task.label,
        success: false,
        message,
      })
    }
  }

  return results
}
