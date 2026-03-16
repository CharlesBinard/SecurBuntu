import { log, spinner } from "@clack/prompts"
import pc from "picocolors"
import { promptConnection } from "../prompts/index.ts"
import { connect } from "../ssh/index.ts"
import type { ConnectionConfig, SshClient } from "../types.ts"
import { handleConnectionError, handleCopyAuthMethod } from "./error-handlers.ts"
import { verifyHostKey } from "./verify-host.ts"

export async function connectWithRetry(): Promise<{ ssh: SshClient; connectionConfig: ConnectionConfig }> {
  const s = spinner()

  while (true) {
    let connectionConfig: ConnectionConfig
    try {
      connectionConfig = await promptConnection()
    } catch {
      log.info(pc.cyan("Let's try again.\n"))
      continue
    }

    const hostKeyAction = await verifyHostKey(connectionConfig, s)
    if (hostKeyAction === "retry") {
      log.info(pc.cyan("Let's try again.\n"))
      continue
    }

    const copyAction = await handleCopyAuthMethod(connectionConfig)
    if (copyAction === "retry") continue

    s.start(`Connecting to ${connectionConfig.host}...`)

    try {
      const ssh = await connect(connectionConfig)
      s.stop(`Connected to ${pc.green(connectionConfig.host)}`)
      return { ssh, connectionConfig }
    } catch (error) {
      const result = await handleConnectionError(error, connectionConfig, s)
      if (result === "retry") continue
      return { ssh: result, connectionConfig }
    }
  }
}
