export interface CopyKeyResult {
  success: boolean
  passwordAuthDisabled: boolean
}

export async function copyKeyToServer(
  host: string,
  user: string,
  pubKeyPath: string,
  port: number = 22,
): Promise<CopyKeyResult> {
  const args = [
    "ssh-copy-id",
    "-i",
    pubKeyPath,
    "-p",
    String(port),
    "-o",
    "StrictHostKeyChecking=yes",
    `${user}@${host}`,
  ]

  const proc = Bun.spawn(args, {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "pipe",
  })

  const stderr = await new Response(proc.stderr).text()
  const exitCode = await proc.exited

  if (exitCode === 0) {
    return { success: true, passwordAuthDisabled: false }
  }

  const passwordAuthDisabled = stderr.includes("Permission denied (publickey)")
  return { success: false, passwordAuthDisabled }
}
