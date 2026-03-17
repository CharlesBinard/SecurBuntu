import * as p from "@clack/prompts"
import pc from "picocolors"
import type { HardeningOptions, ServerInfo, SystemClient, TaskResult } from "../types.ts"
import { runConfigureFail2ban } from "./fail2ban.ts"
import { runFixPermissions } from "./permissions.ts"
import { runDisableServices } from "./services.ts"
import { runHardenSshConfig } from "./ssh-config.ts"
import { runInjectSshKeys } from "./ssh-keys.ts"
import { runConfigureSysctl } from "./sysctl.ts"
import { runConfigureUfw } from "./ufw.ts"
import { runConfigureUnattended } from "./unattended.ts"
import { runCreateUser } from "./user.ts"

interface TaskEntry {
  label: string
  run: (client: SystemClient, options: HardeningOptions, server: ServerInfo) => Promise<TaskResult>
}

// System update is NOT in this list — it runs before the questionnaire in index.ts
const TASKS: TaskEntry[] = [
  { label: "Creating sudo user", run: runCreateUser },
  { label: "Injecting SSH keys", run: runInjectSshKeys },
  { label: "Configuring UFW firewall", run: runConfigureUfw },
  { label: "Configuring Fail2ban", run: runConfigureFail2ban },
  { label: "Configuring automatic updates", run: runConfigureUnattended },
  { label: "Disabling unnecessary services", run: runDisableServices },
  { label: "Fixing file permissions", run: runFixPermissions },
  { label: "Applying kernel hardening", run: runConfigureSysctl },
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
  client: SystemClient,
  options: HardeningOptions,
  server: ServerInfo,
): Promise<TaskResult[]> {
  const results: TaskResult[] = []
  const s = p.spinner()

  for (const task of TASKS) {
    s.start(task.label)
    try {
      const result = await task.run(client, options, server)
      if (result.message.startsWith("Skipped")) {
        s.stop(`${task.label} — skipped`)
      } else if (result.success) {
        s.stop(`${task.label} — done`)
      } else {
        s.stop(`${task.label} — ${pc.red("failed")}: ${result.message}`)
      }
      results.push(result)

      // On failure (not skip), ask whether to continue
      if (!(result.success || result.message.startsWith("Skipped"))) {
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
