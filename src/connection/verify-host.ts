import type { spinner } from "@clack/prompts"
import { confirm, isCancel, log } from "@clack/prompts"
import pc from "picocolors"
import { addToKnownHosts, fetchHostKeyFingerprint } from "../ssh/index.js"
import type { ConnectionConfig } from "../types.js"

export async function verifyHostKey(
  config: ConnectionConfig,
  s: ReturnType<typeof spinner>,
): Promise<"continue" | "retry"> {
  s.start(`Checking host key for ${config.host}...`)
  const hostKeyResult = await fetchHostKeyFingerprint(config.host, config.port)

  if (hostKeyResult.known) {
    s.stop(`Host key verified for ${pc.green(config.host)}`)
    return "continue"
  }

  if (hostKeyResult.fingerprint) {
    s.stop("New host detected")
    log.info(`${pc.bold("Host key fingerprint:")}\n  ${pc.cyan(hostKeyResult.fingerprint)}`)

    const trust = await confirm({ message: "Do you trust this host?" })
    if (isCancel(trust) || !trust) {
      return "retry"
    }

    addToKnownHosts(hostKeyResult.rawKeys)
    return "continue"
  }

  s.stop(pc.yellow("Could not fetch host key"))
  log.warning("Unable to verify host key. The connection will proceed but the host is unverified.")
  return "continue"
}
