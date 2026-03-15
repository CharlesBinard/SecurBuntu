import * as p from "@clack/prompts"
import pc from "picocolors"
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

async function promptContinueOnFailure(taskLabel: string): Promise<boolean> {
  const action = await p.select({
    message: `${pc.yellow(taskLabel)} failed. What do you want to do?`,
    options: [
      { value: "continue" as const, label: "Continue with remaining tasks" },
      { value: "stop" as const, label: "Stop here (show partial report)" },
    ],
  })

  if (p.isCancel(action)) return false
  return action === "continue"
}

export async function executeTasks(
  ssh: SshClient,
  options: HardeningOptions,
  server: ServerInfo,
): Promise<TaskResult[]> {
  const results: TaskResult[] = []
  const s = p.spinner()

  for (const task of TASKS) {
    s.start(task.label)
    try {
      const result = await task.run(ssh, options, server)
      if (result.message.startsWith("Skipped")) {
        s.stop(`${task.label} — skipped`)
      } else if (result.success) {
        s.stop(`${task.label} — done`)
      } else {
        s.stop(`${task.label} — ${pc.red("failed")}: ${result.message}`)
      }
      results.push(result)

      // On failure (not skip), ask whether to continue
      if (!result.success && !result.message.startsWith("Skipped")) {
        const shouldContinue = await promptContinueOnFailure(task.label)
        if (!shouldContinue) {
          return results
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error"
      s.stop(`${task.label} — ${pc.red("error")}: ${message}`)
      results.push({
        name: task.label,
        success: false,
        message,
      })

      const shouldContinue = await promptContinueOnFailure(task.label)
      if (!shouldContinue) {
        return results
      }
    }
  }

  return results
}
