import type { HardeningTask, SystemClient } from "../types.ts"

interface FilePermission {
  path: string
  mode: string
  owner: string
  group: string
}

const EXPECTED_PERMISSIONS: readonly FilePermission[] = [
  { path: "/etc/passwd", mode: "644", owner: "root", group: "root" },
  { path: "/etc/shadow", mode: "640", owner: "root", group: "shadow" },
  { path: "/etc/gshadow", mode: "640", owner: "root", group: "shadow" },
  { path: "/etc/group", mode: "644", owner: "root", group: "root" },
  { path: "/etc/ssh/sshd_config", mode: "600", owner: "root", group: "root" },
  { path: "/etc/crontab", mode: "600", owner: "root", group: "root" },
]

async function getSshHostKeyPaths(client: SystemClient): Promise<string[]> {
  const result = await client.exec("ls /etc/ssh/ssh_host_*_key 2>/dev/null")
  if (result.exitCode !== 0 || result.stdout.trim() === "") return []
  return result.stdout.trim().split("\n")
}

export interface PermissionViolation {
  path: string
  actual: { mode: string; owner: string; group: string }
  expected: FilePermission
}

export async function checkPermissions(client: SystemClient): Promise<PermissionViolation[]> {
  const hostKeys = await getSshHostKeyPaths(client)
  const allFiles: FilePermission[] = [
    ...EXPECTED_PERMISSIONS,
    ...hostKeys.map((path) => ({ path, mode: "600", owner: "root", group: "root" })),
  ]

  const violations: PermissionViolation[] = []

  for (const expected of allFiles) {
    const result = await client.exec(`stat -c '%a %U %G' '${expected.path}' 2>/dev/null`)
    if (result.exitCode !== 0 || result.stdout.trim() === "") continue

    const parts = result.stdout.trim().split(" ")
    const mode = parts[0] ?? ""
    const owner = parts[1] ?? ""
    const group = parts[2] ?? ""
    if (mode !== expected.mode || owner !== expected.owner || group !== expected.group) {
      violations.push({ path: expected.path, actual: { mode, owner, group }, expected })
    }
  }

  return violations
}

export const runFixPermissions: HardeningTask = async (client, options) => {
  if (!options.fixFilePermissions) {
    return {
      name: "File Permissions",
      success: true,
      message: "Skipped — not requested",
    }
  }

  const violations = await checkPermissions(client)

  if (violations.length === 0) {
    return {
      name: "File Permissions",
      success: true,
      message: "Skipped — all permissions already correct",
    }
  }

  const fixed: string[] = []
  const failed: string[] = []

  for (const { path, expected } of violations) {
    const chownResult = await client.exec(`chown ${expected.owner}:${expected.group} '${path}'`)
    const chmodResult = await client.exec(`chmod ${expected.mode} '${path}'`)

    if (chownResult.exitCode === 0 && chmodResult.exitCode === 0) {
      fixed.push(path)
    } else {
      failed.push(path)
    }
  }

  if (failed.length > 0) {
    return {
      name: "File Permissions",
      success: false,
      message: `Fixed ${fixed.length}/${fixed.length + failed.length} file(s)`,
      details: `Fixed: ${fixed.join(", ")}. Failed: ${failed.join(", ")}`,
    }
  }

  return {
    name: "File Permissions",
    success: true,
    message: `Fixed ${fixed.length} file(s): ${fixed.join(", ")}`,
  }
}
