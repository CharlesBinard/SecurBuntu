import type { CopyKeyResult } from "../ssh/copy-key.ts"
import type { SystemClient } from "../types.ts"

export async function copyKeyViaClient(
  client: SystemClient,
  pubKeyContent: string,
  targetUser: string,
): Promise<CopyKeyResult> {
  const targetHome = targetUser === "root" ? "/root" : `/home/${targetUser}`
  const sshDir = `${targetHome}/.ssh`
  const authKeysPath = `${sshDir}/authorized_keys`

  const mkdirResult = await client.exec(`mkdir -p ${sshDir} && chmod 700 ${sshDir}`)
  if (mkdirResult.exitCode !== 0) {
    return { success: false, passwordAuthDisabled: false }
  }

  const grepResult = await client.execWithStdin(
    `grep -qxF -f /dev/stdin '${authKeysPath}' 2>/dev/null && echo found || echo missing`,
    pubKeyContent,
  )
  if (grepResult.stdout.includes("found")) {
    return { success: true, passwordAuthDisabled: false }
  }

  const appendResult = await client.execWithStdin(`tee -a '${authKeysPath}' > /dev/null`, `${pubKeyContent}\n`)
  if (appendResult.exitCode !== 0) {
    return { success: false, passwordAuthDisabled: false }
  }

  await client.exec(`chmod 600 '${authKeysPath}' && chown ${targetUser}:${targetUser} '${authKeysPath}'`)

  return { success: true, passwordAuthDisabled: false }
}
