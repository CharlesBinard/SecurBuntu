import { appendFileSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { resolveHome } from "../platform/home.ts"
import type { HostCapabilities, HostPlatform } from "../types.ts"

export type HostKeyResult =
  | { known: true }
  | { known: false; fingerprint: string; rawKeys: string }
  | { known: false; fingerprint: null; rawKeys: "" }

async function computeFingerprint(keyscanOutput: string, platform: HostPlatform): Promise<string> {
  if (platform.os === "windows") {
    // On Windows: write to a temp file because /dev/stdin is unavailable
    const tempFile = join(tmpdir(), `securbuntu-keyscan-${Date.now()}.txt`)
    try {
      writeFileSync(tempFile, keyscanOutput, "utf-8")
      const proc = Bun.spawn(["ssh-keygen", "-lf", tempFile], { stdout: "pipe", stderr: "pipe" })
      const output = await new Response(proc.stdout).text()
      await proc.exited
      return output
    } finally {
      try {
        unlinkSync(tempFile)
      } catch {
        // Best-effort cleanup
      }
    }
  }

  const proc = Bun.spawn(["ssh-keygen", "-lf", "/dev/stdin"], {
    stdin: Buffer.from(keyscanOutput),
    stdout: "pipe",
    stderr: "pipe",
  })
  const output = await new Response(proc.stdout).text()
  await proc.exited
  return output
}

export async function fetchHostKeyFingerprint(
  host: string,
  port: number,
  platform: HostPlatform,
  capabilities: HostCapabilities,
): Promise<HostKeyResult> {
  if (!capabilities.sshKeyscan) {
    return { known: false, fingerprint: null, rawKeys: "" }
  }

  const home = resolveHome()
  const sshDir = join(home, ".ssh")
  const knownHostsPath = join(sshDir, "known_hosts")

  // Check if host is already in known_hosts (only when ssh-keygen is available)
  if (capabilities.sshKeygen && existsSync(knownHostsPath)) {
    const hostLookup = port === 22 ? host : `[${host}]:${port}`
    const checkProc = Bun.spawn(["ssh-keygen", "-F", hostLookup, "-f", knownHostsPath], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const checkOutput = await new Response(checkProc.stdout).text()
    await checkProc.exited
    if (checkOutput.trim().length > 0) {
      return { known: true }
    }
  }

  // Fetch the server's host key via ssh-keyscan
  const keyscanProc = Bun.spawn(["ssh-keyscan", "-T", "5", "-p", String(port), host], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const keyscanOutput = await new Response(keyscanProc.stdout).text()
  await keyscanProc.exited

  if (!(keyscanOutput.trim() && capabilities.sshKeygen)) {
    return { known: false, fingerprint: null, rawKeys: "" }
  }

  const fingerprintOutput = await computeFingerprint(keyscanOutput, platform)
  const firstLine = fingerprintOutput.trim().split("\n")[0] ?? ""
  if (!firstLine) {
    return { known: false, fingerprint: null, rawKeys: "" }
  }

  return { known: false, fingerprint: firstLine, rawKeys: keyscanOutput.trim() }
}

export function addToKnownHosts(rawKeys: string): void {
  const home = resolveHome()
  const sshDir = join(home, ".ssh")
  const knownHostsPath = join(sshDir, "known_hosts")
  mkdirSync(sshDir, { recursive: true })
  appendFileSync(knownHostsPath, `${rawKeys}\n`, "utf-8")
}
