import type { CommandResult } from "../types.ts"

export const DEFAULT_TIMEOUT = 300_000 // 5 minutes

export async function spawnProcess(
  command: string[],
  stdinData?: string,
  timeout: number = DEFAULT_TIMEOUT,
  env?: Record<string, string | undefined>,
): Promise<CommandResult> {
  const proc = Bun.spawn(command, {
    stdin: stdinData !== undefined ? Buffer.from(stdinData) : "ignore",
    stdout: "pipe",
    stderr: "pipe",
    ...(env && { env }),
  })

  let timedOut = false
  let interrupted = false

  const timer = setTimeout(() => {
    timedOut = true
    proc.kill()
  }, timeout)

  const handleSignal = () => {
    interrupted = true
    proc.kill()
  }
  process.on("SIGINT", handleSignal)
  process.on("SIGTERM", handleSignal)

  try {
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])

    const exitCode = await proc.exited

    if (interrupted) {
      return {
        stdout: "",
        stderr: "Connection interrupted",
        exitCode: -1,
      }
    }

    if (timedOut) {
      return {
        stdout: "",
        stderr: `Command timed out after ${Math.round(timeout / 1000)}s`,
        exitCode: -1,
      }
    }

    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode }
  } finally {
    clearTimeout(timer)
    process.removeListener("SIGINT", handleSignal)
    process.removeListener("SIGTERM", handleSignal)
  }
}

export async function spawnSsh(
  args: string[],
  stdinData?: string,
  timeout: number = DEFAULT_TIMEOUT,
): Promise<CommandResult> {
  return spawnProcess(["ssh", ...args], stdinData, timeout)
}

export async function spawnSshpass(
  password: string,
  args: string[],
  timeout: number = DEFAULT_TIMEOUT,
): Promise<CommandResult> {
  return spawnProcess(["sshpass", "-e", "ssh", ...args], undefined, timeout, { ...process.env, SSHPASS: password })
}
