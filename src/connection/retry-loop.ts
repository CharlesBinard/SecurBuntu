import { log, spinner } from "@clack/prompts"
import { readFileSync } from "fs"
import pc from "picocolors"
import { copyKeyViaClient } from "../platform/ssh-copy.ts"
import { promptConnection } from "../prompts/index.ts"
import { connect } from "../ssh/index.ts"
import type { ConnectionConfig, HostCapabilities, HostPlatform, SystemClient } from "../types.ts"
import { handleConnectionError, handleCopyAuthMethod } from "./error-handlers.ts"
import { verifyHostKey } from "./verify-host.ts"

async function deferredKeyCopy(
  client: SystemClient,
  config: ConnectionConfig,
  platform: HostPlatform,
): Promise<SystemClient> {
  const pubKeyPath = `${config.privateKeyPath}.pub`
  const pubKeyContent = readFileSync(pubKeyPath, "utf8").trim()
  const result = await copyKeyViaClient(client, pubKeyContent, config.username)

  if (result.success) {
    log.success("SSH key copied successfully. Reconnecting with key auth...")
    config.authMethod = "key"
    client.close()
    return connect(config, platform)
  }

  log.warning(pc.yellow("Deferred key copy failed. Continuing with current auth method."))
  return client
}

export async function connectWithRetry(
  platform: HostPlatform,
  capabilities: HostCapabilities,
): Promise<{ client: SystemClient; connectionConfig: ConnectionConfig }> {
  const s = spinner()

  while (true) {
    let connectionConfig: ConnectionConfig
    try {
      connectionConfig = await promptConnection(capabilities)
    } catch {
      log.info(pc.cyan("Let's try again.\n"))
      continue
    }

    const hostKeyAction = await verifyHostKey(connectionConfig, s, platform, capabilities)
    if (hostKeyAction === "retry") {
      log.info(pc.cyan("Let's try again.\n"))
      continue
    }

    const copyAction = await handleCopyAuthMethod(connectionConfig, capabilities)
    if (copyAction === "retry") continue

    s.start(`Connecting to ${connectionConfig.host}...`)

    try {
      let client = await connect(connectionConfig, platform)
      s.stop(`Connected to ${pc.green(connectionConfig.host)}`)

      if (connectionConfig.authMethod === "copy" && !capabilities.sshCopyId && connectionConfig.privateKeyPath) {
        client = await deferredKeyCopy(client, connectionConfig, platform)
      }

      return { client, connectionConfig }
    } catch (error) {
      const result = await handleConnectionError(error, connectionConfig, s, platform, capabilities)
      if (result === "retry") continue
      return { client: result, connectionConfig }
    }
  }
}
