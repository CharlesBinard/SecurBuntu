import { appendFileSync, existsSync, mkdirSync } from "fs"
import { resolveHome } from "../platform/home.ts"

export type HostKeyResult =
  | { known: true }
  | { known: false; fingerprint: string; rawKeys: string }
  | { known: false; fingerprint: null; rawKeys: "" }

export async function fetchHostKeyFingerprint(host: string, port: number): Promise<HostKeyResult> {
  const home = resolveHome()
  const knownHostsPath = `${home}/.ssh/known_hosts`

  // Check if host is already in known_hosts
  if (existsSync(knownHostsPath)) {
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

  if (!keyscanOutput.trim()) {
    return { known: false, fingerprint: null, rawKeys: "" }
  }

  // Compute the SHA256 fingerprint
  const fingerprintProc = Bun.spawn(["ssh-keygen", "-lf", "/dev/stdin"], {
    stdin: Buffer.from(keyscanOutput),
    stdout: "pipe",
    stderr: "pipe",
  })
  const fingerprintOutput = await new Response(fingerprintProc.stdout).text()
  await fingerprintProc.exited

  const firstLine = fingerprintOutput.trim().split("\n")[0] ?? ""
  if (!firstLine) {
    return { known: false, fingerprint: null, rawKeys: "" }
  }

  return { known: false, fingerprint: firstLine, rawKeys: keyscanOutput.trim() }
}

export function addToKnownHosts(rawKeys: string): void {
  const home = resolveHome()
  const sshDir = `${home}/.ssh`
  const knownHostsPath = `${sshDir}/known_hosts`
  mkdirSync(sshDir, { recursive: true })
  appendFileSync(knownHostsPath, `${rawKeys}\n`, "utf-8")
}
