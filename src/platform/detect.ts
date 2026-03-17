import { spawnProcess } from "../ssh/process.ts"
import type { HostPlatform } from "../types.ts"

export function parseOsRelease(raw: string): { distro: string; version: string; codename: string } {
  const parts = raw.split("|")
  return {
    distro: parts[0] ?? "",
    version: parts[1] ?? "",
    codename: parts[2] ?? "",
  }
}

export function isVersionAtLeast(version: string, minMajor: number, minMinor: number): boolean {
  const parts = version.split(".")
  const major = parseInt(parts[0] ?? "0", 10)
  const minor = parseInt(parts[1] ?? "0", 10)
  if (Number.isNaN(major)) return false
  return major > minMajor || (major === minMajor && minor >= minMinor)
}

function mapPlatform(nodePlatform: string): "linux" | "macos" | "windows" {
  switch (nodePlatform) {
    case "win32":
      return "windows"
    case "darwin":
      return "macos"
    default:
      return "linux"
  }
}

export async function detectHostPlatform(): Promise<HostPlatform> {
  const os = mapPlatform(process.platform)

  if (os !== "linux") {
    return { os, distro: null, version: null, codename: null, isCompatibleTarget: false }
  }

  const result = await spawnProcess(["bash", "-c", '. /etc/os-release && echo "$ID|$VERSION_ID|$VERSION_CODENAME"'])
  if (result.exitCode !== 0) {
    return { os, distro: null, version: null, codename: null, isCompatibleTarget: false }
  }

  const { distro, version, codename } = parseOsRelease(result.stdout)
  const isCompatibleTarget = distro === "ubuntu" && isVersionAtLeast(version, 22, 4)

  return { os, distro, version, codename, isCompatibleTarget }
}
