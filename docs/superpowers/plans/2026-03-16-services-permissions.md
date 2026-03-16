# Disable Unnecessary Services + Harden File Permissions — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two new audit checks and hardening tasks — disabling unnecessary services and fixing file permissions on remote Ubuntu servers.

**Architecture:** Both features follow the existing pattern: types in `types.ts`, audit checks in `audit/scanner.ts`, display coloring in `audit/display.ts`, hardening tasks in `tasks/`, prompts in `prompts/`, and registration in `tasks/index.ts`. The services feature uses a shared registry constant imported by both the prompt and the task. The permissions feature has no prompt (auto-fix).

**Tech Stack:** TypeScript, Bun, @clack/prompts, picocolors, bun:test

---

## Chunk 1: Types, Services Task, and Services Tests

### Task 1: Add new fields to HardeningOptions

**Files:**
- Modify: `src/types.ts:20-40`

- [ ] **Step 1: Add the three new fields to HardeningOptions**

In `src/types.ts`, add these fields inside the `HardeningOptions` interface, after `enableSshBanner`:

```ts
  disableServices: boolean
  servicesToDisable: string[]
  fixFilePermissions: boolean
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `bunx tsc --noEmit 2>&1 | head -30`

Expected: Compilation errors in files that construct `HardeningOptions` (prompts/hardening.ts, test files). This is expected — we'll fix them in later tasks.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add disableServices, servicesToDisable, fixFilePermissions to HardeningOptions"
```

### Task 2: Create the services task with registry

**Files:**
- Create: `src/tasks/services.ts`

- [ ] **Step 1: Create `src/tasks/services.ts`**

```ts
import type { HardeningTask } from "../types.ts"

interface ServiceDefinition {
  name: string
  description: string
}

export const UNNECESSARY_SERVICES: readonly ServiceDefinition[] = [
  { name: "cups", description: "Print server, unnecessary on headless servers" },
  { name: "avahi-daemon", description: "mDNS/DNS-SD discovery, not needed on servers" },
  { name: "bluetooth", description: "Bluetooth stack, useless on servers" },
  { name: "ModemManager", description: "Mobile broadband modem manager" },
  { name: "whoopsie", description: "Ubuntu error reporting daemon" },
  { name: "apport", description: "Crash report generator" },
  { name: "snapd", description: "Snap package manager, optional on servers" },
  { name: "rpcbind", description: "RPC port mapper (NFS), not needed unless using NFS" },
]

export const runDisableServices: HardeningTask = async (ssh, options) => {
  if (!options.disableServices || options.servicesToDisable.length === 0) {
    return {
      name: "Disable Services",
      success: true,
      message: "Skipped — no services selected",
    }
  }

  const disabled: string[] = []
  const failed: string[] = []

  for (const service of options.servicesToDisable) {
    const stopResult = await ssh.exec(`systemctl disable --now ${service}`)
    if (stopResult.exitCode !== 0) {
      failed.push(service)
      continue
    }
    const maskResult = await ssh.exec(`systemctl mask ${service}`)
    if (maskResult.exitCode !== 0) {
      failed.push(service)
      continue
    }
    disabled.push(service)
  }

  if (failed.length > 0 && disabled.length === 0) {
    return {
      name: "Disable Services",
      success: false,
      message: `Failed to disable all ${failed.length} service(s)`,
      details: `Failed: ${failed.join(", ")}`,
    }
  }

  if (failed.length > 0) {
    return {
      name: "Disable Services",
      success: false,
      message: `Disabled ${disabled.length}/${disabled.length + failed.length} service(s)`,
      details: `Disabled: ${disabled.join(", ")}. Failed: ${failed.join(", ")}`,
    }
  }

  return {
    name: "Disable Services",
    success: true,
    message: `Disabled ${disabled.length} service(s): ${disabled.join(", ")}`,
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/tasks/services.ts
git commit -m "feat: add services task with registry and disable logic"
```

### Task 3: Write tests for the services task

**Files:**
- Create: `src/__tests__/tasks/services.test.ts`

- [ ] **Step 1: Create `src/__tests__/tasks/services.test.ts`**

```ts
import { describe, expect, test } from "bun:test"
import { runDisableServices } from "../../tasks/services.ts"
import type { HardeningOptions, ServerInfo } from "../../types.ts"
import { MockSshClient } from "../helpers/mock-ssh.ts"

const defaultOptions: HardeningOptions = {
  createSudoUser: false,
  addPersonalKey: false,
  configureCoolify: false,
  changeSshPort: false,
  disablePasswordAuth: false,
  installUfw: false,
  ufwPorts: [],
  installFail2ban: false,
  enableAutoUpdates: false,
  enableSysctl: false,
  permitRootLogin: "yes",
  disableX11Forwarding: true,
  maxAuthTries: 5,
  enableSshBanner: false,
  disableServices: false,
  servicesToDisable: [],
  fixFilePermissions: false,
}

const defaultServer: ServerInfo = {
  ubuntuVersion: "24.04",
  ubuntuCodename: "noble",
  usesSocketActivation: false,
  hasCloudInit: false,
  isRoot: true,
}

describe("runDisableServices", () => {
  test("skips when not requested", async () => {
    const ssh = new MockSshClient()
    const result = await runDisableServices(ssh, defaultOptions, defaultServer)
    expect(result.success).toBe(true)
    expect(result.message).toStartWith("Skipped")
  })

  test("skips when enabled but no services selected", async () => {
    const ssh = new MockSshClient()
    const options = { ...defaultOptions, disableServices: true, servicesToDisable: [] }
    const result = await runDisableServices(ssh, options, defaultServer)
    expect(result.success).toBe(true)
    expect(result.message).toStartWith("Skipped")
  })

  test("disables and masks selected services", async () => {
    const ssh = new MockSshClient()
    const options = {
      ...defaultOptions,
      disableServices: true,
      servicesToDisable: ["cups", "avahi-daemon"],
    }

    const result = await runDisableServices(ssh, options, defaultServer)

    expect(result.success).toBe(true)
    expect(result.message).toContain("2 service(s)")
    expect(ssh.hasCommand("systemctl disable --now cups")).toBe(true)
    expect(ssh.hasCommand("systemctl mask cups")).toBe(true)
    expect(ssh.hasCommand("systemctl disable --now avahi-daemon")).toBe(true)
    expect(ssh.hasCommand("systemctl mask avahi-daemon")).toBe(true)
  })

  test("reports partial failure", async () => {
    const ssh = new MockSshClient()
    ssh.onExec("systemctl disable --now avahi-daemon", { exitCode: 1 })

    const options = {
      ...defaultOptions,
      disableServices: true,
      servicesToDisable: ["cups", "avahi-daemon"],
    }

    const result = await runDisableServices(ssh, options, defaultServer)

    expect(result.success).toBe(false)
    expect(result.message).toContain("1/2")
    expect(result.details).toContain("Failed: avahi-daemon")
    expect(result.details).toContain("Disabled: cups")
  })

  test("reports total failure", async () => {
    const ssh = new MockSshClient()
    ssh.onExec("systemctl disable --now", { exitCode: 1 })

    const options = {
      ...defaultOptions,
      disableServices: true,
      servicesToDisable: ["cups"],
    }

    const result = await runDisableServices(ssh, options, defaultServer)

    expect(result.success).toBe(false)
    expect(result.message).toContain("Failed to disable all")
  })

  test("fails service when mask fails", async () => {
    const ssh = new MockSshClient()
    ssh.onExec("systemctl mask cups", { exitCode: 1 })

    const options = {
      ...defaultOptions,
      disableServices: true,
      servicesToDisable: ["cups"],
    }

    const result = await runDisableServices(ssh, options, defaultServer)

    expect(result.success).toBe(false)
    expect(result.details).toContain("Failed: cups")
  })
})
```

- [ ] **Step 2: Run the tests**

Run: `bun test src/__tests__/tasks/services.test.ts`

Expected: All 6 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/tasks/services.test.ts
git commit -m "test: add services task tests"
```

## Chunk 2: Permissions Task and Tests

### Task 4: Create the permissions task

**Files:**
- Create: `src/tasks/permissions.ts`

- [ ] **Step 1: Create `src/tasks/permissions.ts`**

```ts
import type { HardeningTask, SshClient } from "../types.ts"

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

async function getSshHostKeyPaths(ssh: SshClient): Promise<string[]> {
  const result = await ssh.exec("ls /etc/ssh/ssh_host_*_key 2>/dev/null")
  if (result.exitCode !== 0 || result.stdout.trim() === "") return []
  return result.stdout.trim().split("\n")
}

export interface PermissionViolation {
  path: string
  actual: { mode: string; owner: string; group: string }
  expected: FilePermission
}

export async function checkPermissions(ssh: SshClient): Promise<PermissionViolation[]> {
  const hostKeys = await getSshHostKeyPaths(ssh)
  const allFiles: FilePermission[] = [
    ...EXPECTED_PERMISSIONS,
    ...hostKeys.map((path) => ({ path, mode: "600", owner: "root", group: "root" })),
  ]

  const violations: PermissionViolation[] = []

  for (const expected of allFiles) {
    const result = await ssh.exec(`stat -c '%a %U %G' '${expected.path}' 2>/dev/null`)
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

export const runFixPermissions: HardeningTask = async (ssh, options) => {
  if (!options.fixFilePermissions) {
    return {
      name: "File Permissions",
      success: true,
      message: "Skipped — not requested",
    }
  }

  const violations = await checkPermissions(ssh)

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
    const chownResult = await ssh.exec(`chown ${expected.owner}:${expected.group} '${path}'`)
    const chmodResult = await ssh.exec(`chmod ${expected.mode} '${path}'`)

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
```

- [ ] **Step 2: Commit**

```bash
git add src/tasks/permissions.ts
git commit -m "feat: add permissions task with registry and fix logic"
```

### Task 5: Write tests for the permissions task

**Files:**
- Create: `src/__tests__/tasks/permissions.test.ts`

- [ ] **Step 1: Create `src/__tests__/tasks/permissions.test.ts`**

```ts
import { describe, expect, test } from "bun:test"
import { checkPermissions, runFixPermissions } from "../../tasks/permissions.ts"
import type { HardeningOptions, ServerInfo } from "../../types.ts"
import { MockSshClient } from "../helpers/mock-ssh.ts"

const defaultOptions: HardeningOptions = {
  createSudoUser: false,
  addPersonalKey: false,
  configureCoolify: false,
  changeSshPort: false,
  disablePasswordAuth: false,
  installUfw: false,
  ufwPorts: [],
  installFail2ban: false,
  enableAutoUpdates: false,
  enableSysctl: false,
  permitRootLogin: "yes",
  disableX11Forwarding: true,
  maxAuthTries: 5,
  enableSshBanner: false,
  disableServices: false,
  servicesToDisable: [],
  fixFilePermissions: false,
}

const defaultServer: ServerInfo = {
  ubuntuVersion: "24.04",
  ubuntuCodename: "noble",
  usesSocketActivation: false,
  hasCloudInit: false,
  isRoot: true,
}

describe("runFixPermissions", () => {
  test("skips when not requested", async () => {
    const ssh = new MockSshClient()
    const result = await runFixPermissions(ssh, defaultOptions, defaultServer)
    expect(result.success).toBe(true)
    expect(result.message).toStartWith("Skipped — not requested")
  })

  test("skips when all permissions are already correct", async () => {
    const ssh = new MockSshClient()
    ssh.onExec("ls /etc/ssh/ssh_host_*_key", { stdout: "" , exitCode: 1 })
    ssh.onExec("stat -c '%a %U %G' '/etc/passwd'", { stdout: "644 root root" })
    ssh.onExec("stat -c '%a %U %G' '/etc/shadow'", { stdout: "640 root shadow" })
    ssh.onExec("stat -c '%a %U %G' '/etc/gshadow'", { stdout: "640 root shadow" })
    ssh.onExec("stat -c '%a %U %G' '/etc/group'", { stdout: "644 root root" })
    ssh.onExec("stat -c '%a %U %G' '/etc/ssh/sshd_config'", { stdout: "600 root root" })
    ssh.onExec("stat -c '%a %U %G' '/etc/crontab'", { stdout: "600 root root" })

    const options = { ...defaultOptions, fixFilePermissions: true }
    const result = await runFixPermissions(ssh, options, defaultServer)

    expect(result.success).toBe(true)
    expect(result.message).toContain("all permissions already correct")
  })

  test("fixes non-conforming permissions", async () => {
    const ssh = new MockSshClient()
    ssh.onExec("ls /etc/ssh/ssh_host_*_key", { exitCode: 1 })
    ssh.onExec("stat -c '%a %U %G' '/etc/passwd'", { stdout: "644 root root" })
    ssh.onExec("stat -c '%a %U %G' '/etc/shadow'", { stdout: "644 root root" }) // wrong
    ssh.onExec("stat -c '%a %U %G' '/etc/gshadow'", { stdout: "640 root shadow" })
    ssh.onExec("stat -c '%a %U %G' '/etc/group'", { stdout: "644 root root" })
    ssh.onExec("stat -c '%a %U %G' '/etc/ssh/sshd_config'", { stdout: "600 root root" })
    ssh.onExec("stat -c '%a %U %G' '/etc/crontab'", { stdout: "644 root root" }) // wrong

    const options = { ...defaultOptions, fixFilePermissions: true }
    const result = await runFixPermissions(ssh, options, defaultServer)

    expect(result.success).toBe(true)
    expect(result.message).toContain("2 file(s)")
    expect(ssh.hasCommand("chmod 640 '/etc/shadow'")).toBe(true)
    expect(ssh.hasCommand("chown root:shadow '/etc/shadow'")).toBe(true)
    expect(ssh.hasCommand("chmod 600 '/etc/crontab'")).toBe(true)
  })

  test("handles missing files gracefully", async () => {
    const ssh = new MockSshClient()
    ssh.onExec("ls /etc/ssh/ssh_host_*_key", { exitCode: 1 })
    // All stat commands return exitCode: 0 by default (empty stdout)
    // but /etc/crontab doesn't exist
    ssh.onExec("stat -c '%a %U %G' '/etc/passwd'", { stdout: "644 root root" })
    ssh.onExec("stat -c '%a %U %G' '/etc/shadow'", { stdout: "640 root shadow" })
    ssh.onExec("stat -c '%a %U %G' '/etc/gshadow'", { stdout: "640 root shadow" })
    ssh.onExec("stat -c '%a %U %G' '/etc/group'", { stdout: "644 root root" })
    ssh.onExec("stat -c '%a %U %G' '/etc/ssh/sshd_config'", { stdout: "600 root root" })
    ssh.onExec("stat -c '%a %U %G' '/etc/crontab'", { exitCode: 1 }) // missing

    const options = { ...defaultOptions, fixFilePermissions: true }
    const result = await runFixPermissions(ssh, options, defaultServer)

    expect(result.success).toBe(true)
    expect(result.message).toContain("all permissions already correct")
  })

  test("includes SSH host keys in check", async () => {
    const ssh = new MockSshClient()
    ssh.onExec("ls /etc/ssh/ssh_host_*_key", {
      stdout: "/etc/ssh/ssh_host_ed25519_key\n/etc/ssh/ssh_host_rsa_key",
    })
    ssh.onExec("stat -c '%a %U %G' '/etc/passwd'", { stdout: "644 root root" })
    ssh.onExec("stat -c '%a %U %G' '/etc/shadow'", { stdout: "640 root shadow" })
    ssh.onExec("stat -c '%a %U %G' '/etc/gshadow'", { stdout: "640 root shadow" })
    ssh.onExec("stat -c '%a %U %G' '/etc/group'", { stdout: "644 root root" })
    ssh.onExec("stat -c '%a %U %G' '/etc/ssh/sshd_config'", { stdout: "600 root root" })
    ssh.onExec("stat -c '%a %U %G' '/etc/crontab'", { stdout: "600 root root" })
    ssh.onExec("stat -c '%a %U %G' '/etc/ssh/ssh_host_ed25519_key'", { stdout: "644 root root" }) // wrong
    ssh.onExec("stat -c '%a %U %G' '/etc/ssh/ssh_host_rsa_key'", { stdout: "600 root root" }) // ok

    const options = { ...defaultOptions, fixFilePermissions: true }
    const result = await runFixPermissions(ssh, options, defaultServer)

    expect(result.success).toBe(true)
    expect(result.message).toContain("1 file(s)")
    expect(ssh.hasCommand("chmod 600 '/etc/ssh/ssh_host_ed25519_key'")).toBe(true)
  })

  test("reports failure when chmod fails", async () => {
    const ssh = new MockSshClient()
    ssh.onExec("ls /etc/ssh/ssh_host_*_key", { exitCode: 1 })
    ssh.onExec("stat -c '%a %U %G' '/etc/passwd'", { stdout: "644 root root" })
    ssh.onExec("stat -c '%a %U %G' '/etc/shadow'", { stdout: "644 root root" }) // wrong
    ssh.onExec("stat -c '%a %U %G' '/etc/gshadow'", { stdout: "640 root shadow" })
    ssh.onExec("stat -c '%a %U %G' '/etc/group'", { stdout: "644 root root" })
    ssh.onExec("stat -c '%a %U %G' '/etc/ssh/sshd_config'", { stdout: "600 root root" })
    ssh.onExec("stat -c '%a %U %G' '/etc/crontab'", { stdout: "600 root root" })
    ssh.onExec("chmod 640", { exitCode: 1 })

    const options = { ...defaultOptions, fixFilePermissions: true }
    const result = await runFixPermissions(ssh, options, defaultServer)

    expect(result.success).toBe(false)
    expect(result.details).toContain("Failed: /etc/shadow")
  })
})

describe("checkPermissions", () => {
  test("returns empty array when all correct", async () => {
    const ssh = new MockSshClient()
    ssh.onExec("ls /etc/ssh/ssh_host_*_key", { exitCode: 1 })
    ssh.onExec("stat -c '%a %U %G' '/etc/passwd'", { stdout: "644 root root" })
    ssh.onExec("stat -c '%a %U %G' '/etc/shadow'", { stdout: "640 root shadow" })
    ssh.onExec("stat -c '%a %U %G' '/etc/gshadow'", { stdout: "640 root shadow" })
    ssh.onExec("stat -c '%a %U %G' '/etc/group'", { stdout: "644 root root" })
    ssh.onExec("stat -c '%a %U %G' '/etc/ssh/sshd_config'", { stdout: "600 root root" })
    ssh.onExec("stat -c '%a %U %G' '/etc/crontab'", { stdout: "600 root root" })

    const violations = await checkPermissions(ssh)
    expect(violations).toHaveLength(0)
  })

  test("detects wrong permissions", async () => {
    const ssh = new MockSshClient()
    ssh.onExec("ls /etc/ssh/ssh_host_*_key", { exitCode: 1 })
    ssh.onExec("stat -c '%a %U %G' '/etc/passwd'", { stdout: "644 root root" })
    ssh.onExec("stat -c '%a %U %G' '/etc/shadow'", { stdout: "644 root root" }) // wrong mode + group
    ssh.onExec("stat -c '%a %U %G' '/etc/gshadow'", { stdout: "640 root shadow" })
    ssh.onExec("stat -c '%a %U %G' '/etc/group'", { stdout: "644 root root" })
    ssh.onExec("stat -c '%a %U %G' '/etc/ssh/sshd_config'", { stdout: "600 root root" })
    ssh.onExec("stat -c '%a %U %G' '/etc/crontab'", { stdout: "600 root root" })

    const violations = await checkPermissions(ssh)
    expect(violations).toHaveLength(1)
    expect(violations[0]?.path).toBe("/etc/shadow")
  })
})
```

- [ ] **Step 2: Run the tests**

Run: `bun test src/__tests__/tasks/permissions.test.ts`

Expected: All 8 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/tasks/permissions.test.ts
git commit -m "test: add permissions task tests"
```

## Chunk 3: Audit Scanner, Display, and Audit Tests

### Task 6: Add audit checks for services and permissions

**Files:**
- Modify: `src/audit/scanner.ts:1-64`

- [ ] **Step 1: Add the services audit check**

At the top of `src/audit/scanner.ts`, add the import for the services registry:

```ts
import { UNNECESSARY_SERVICES } from "../tasks/services.ts"
```

Then at the end of the `runAudit` function, before `return { checks }`, add:

```ts
  // Unnecessary services
  const servicesResult = await ssh.exec("systemctl list-units --type=service --state=active --no-legend")
  const activeServices = servicesResult.stdout
  const detectedServices = UNNECESSARY_SERVICES
    .filter((s) => activeServices.includes(`${s.name}.service`))
    .map((s) => s.name)
  if (detectedServices.length > 0) {
    checks.push({ name: "Unnecessary Services", status: "found", detail: detectedServices.join(", ") })
  } else {
    checks.push({ name: "Unnecessary Services", status: "none detected" })
  }
```

- [ ] **Step 2: Add the file permissions audit check**

Still in `runAudit`, after the services check and before `return { checks }`, add the import at the top:

```ts
import { checkPermissions } from "../tasks/permissions.ts"
```

And the check:

```ts
  // File permissions
  const violations = await checkPermissions(ssh)
  if (violations.length > 0) {
    const detail = violations
      .map((v) => `${v.path} ${v.actual.mode} (expected ${v.expected.mode})`)
      .join(", ")
    checks.push({ name: "File Permissions", status: "non-conforming", detail })
  } else {
    checks.push({ name: "File Permissions", status: "all correct" })
  }
```

The final imports at top of scanner.ts should be:

```ts
import type { AuditResult, SshClient } from "../types.ts"
import { checkPermissions } from "../tasks/permissions.ts"
import { UNNECESSARY_SERVICES } from "../tasks/services.ts"
```

- [ ] **Step 3: Commit**

```bash
git add src/audit/scanner.ts
git commit -m "feat: add unnecessary services and file permissions audit checks"
```

### Task 7: Update display coloring

**Files:**
- Modify: `src/audit/display.ts:14-26`

- [ ] **Step 1: Add new status values to color conditions**

In `src/audit/display.ts`, update the `isGood` condition to add `"none detected"` and `"all correct"`:

```ts
    const isGood =
      status.includes("active") ||
      status.includes("enabled") ||
      status.includes("hardened") ||
      status === "no" ||
      status === "prohibit-password" ||
      status === "none detected" ||
      status === "all correct"
```

Update the `isBad` condition to add `"found"` and `"non-conforming"`:

```ts
    const isBad =
      status.includes("not installed") ||
      status.includes("not configured") ||
      status === "yes" ||
      status === "yes (default)" ||
      status === "default" ||
      status === "not set" ||
      status === "found" ||
      status === "non-conforming"
```

- [ ] **Step 2: Commit**

```bash
git add src/audit/display.ts
git commit -m "feat: add display coloring for services and permissions audit statuses"
```

### Task 8: Update audit tests

**Files:**
- Modify: `src/__tests__/audit.test.ts`

- [ ] **Step 1: Update the check count and names list**

In `src/__tests__/audit.test.ts`, update the `runAudit` tests:

Change `expect(result.checks).toHaveLength(10)` to `expect(result.checks).toHaveLength(12)`.

Update the `check names match expected list` test to add the two new names at the end:

```ts
    expect(names).toEqual([
      "SSH Port",
      "Root Login",
      "Password Auth",
      "UFW Firewall",
      "Fail2ban",
      "Auto-updates",
      "Sudo Users",
      "SSH Keys",
      "Sysctl Hardening",
      "SSH Banner",
      "Unnecessary Services",
      "File Permissions",
    ])
```

- [ ] **Step 2: Add new test cases for services audit**

Add after the existing `runAudit` tests:

```ts
  test("detects unnecessary services", async () => {
    const ssh = new MockSshClient()
    ssh.onExec("systemctl list-units --type=service --state=active", {
      stdout: "cups.service loaded active running CUPS Scheduler\navahi-daemon.service loaded active running Avahi mDNS",
    })
    const result = await runAudit(ssh)
    const check = result.checks.find((c) => c.name === "Unnecessary Services")
    expect(check?.status).toBe("found")
    expect(check?.detail).toContain("cups")
    expect(check?.detail).toContain("avahi-daemon")
  })

  test("reports no unnecessary services when clean", async () => {
    const ssh = new MockSshClient()
    ssh.onExec("systemctl list-units --type=service --state=active", {
      stdout: "ssh.service loaded active running OpenBSD Secure Shell server",
    })
    const result = await runAudit(ssh)
    const check = result.checks.find((c) => c.name === "Unnecessary Services")
    expect(check?.status).toBe("none detected")
  })
```

- [ ] **Step 3: Add new test cases for file permissions audit**

Add after the services audit tests:

```ts
  test("reports all correct file permissions", async () => {
    const ssh = new MockSshClient()
    ssh.onExec("ls /etc/ssh/ssh_host_*_key", { exitCode: 1 })
    ssh.onExec("stat -c '%a %U %G' '/etc/passwd'", { stdout: "644 root root" })
    ssh.onExec("stat -c '%a %U %G' '/etc/shadow'", { stdout: "640 root shadow" })
    ssh.onExec("stat -c '%a %U %G' '/etc/gshadow'", { stdout: "640 root shadow" })
    ssh.onExec("stat -c '%a %U %G' '/etc/group'", { stdout: "644 root root" })
    ssh.onExec("stat -c '%a %U %G' '/etc/ssh/sshd_config'", { stdout: "600 root root" })
    ssh.onExec("stat -c '%a %U %G' '/etc/crontab'", { stdout: "600 root root" })
    const result = await runAudit(ssh)
    const check = result.checks.find((c) => c.name === "File Permissions")
    expect(check?.status).toBe("all correct")
  })

  test("reports non-conforming file permissions", async () => {
    const ssh = new MockSshClient()
    ssh.onExec("ls /etc/ssh/ssh_host_*_key", { exitCode: 1 })
    ssh.onExec("stat -c '%a %U %G' '/etc/passwd'", { stdout: "644 root root" })
    ssh.onExec("stat -c '%a %U %G' '/etc/shadow'", { stdout: "644 root root" }) // wrong
    ssh.onExec("stat -c '%a %U %G' '/etc/gshadow'", { stdout: "640 root shadow" })
    ssh.onExec("stat -c '%a %U %G' '/etc/group'", { stdout: "644 root root" })
    ssh.onExec("stat -c '%a %U %G' '/etc/ssh/sshd_config'", { stdout: "600 root root" })
    ssh.onExec("stat -c '%a %U %G' '/etc/crontab'", { stdout: "600 root root" })
    const result = await runAudit(ssh)
    const check = result.checks.find((c) => c.name === "File Permissions")
    expect(check?.status).toBe("non-conforming")
    expect(check?.detail).toContain("/etc/shadow 644 (expected 640)")
  })
```

- [ ] **Step 4: Add display tests for new statuses**

In the `displayAudit` describe block, add:

```ts
  test("colorizes 'none detected' status as green (good)", () => {
    const result: AuditResult = {
      checks: [{ name: "Unnecessary Services", status: "none detected" }],
    }
    displayAudit(result)
    expect(noteCalls[0]?.message).toContain("none detected")
  })

  test("colorizes 'all correct' status as green (good)", () => {
    const result: AuditResult = {
      checks: [{ name: "File Permissions", status: "all correct" }],
    }
    displayAudit(result)
    expect(noteCalls[0]?.message).toContain("all correct")
  })

  test("colorizes 'found' status as yellow (bad)", () => {
    const result: AuditResult = {
      checks: [{ name: "Unnecessary Services", status: "found", detail: "cups, avahi-daemon" }],
    }
    displayAudit(result)
    expect(noteCalls[0]?.message).toContain("found")
    expect(noteCalls[0]?.message).toContain("cups, avahi-daemon")
  })

  test("colorizes 'non-conforming' status as yellow (bad)", () => {
    const result: AuditResult = {
      checks: [{ name: "File Permissions", status: "non-conforming", detail: "/etc/shadow" }],
    }
    displayAudit(result)
    expect(noteCalls[0]?.message).toContain("non-conforming")
    expect(noteCalls[0]?.message).toContain("/etc/shadow")
  })
```

- [ ] **Step 5: Run audit tests**

Run: `bun test src/__tests__/audit.test.ts`

Expected: All tests pass (original + 8 new ones).

- [ ] **Step 6: Commit**

```bash
git add src/__tests__/audit.test.ts
git commit -m "test: update audit tests for services and permissions checks"
```

## Chunk 4: Prompts, Confirmation, and Task Registration

### Task 9: Create the services prompt

**Files:**
- Create: `src/prompts/services.ts`

- [ ] **Step 1: Create `src/prompts/services.ts`**

```ts
import * as p from "@clack/prompts"
import type { HardeningOptions } from "../types.ts"
import { UNNECESSARY_SERVICES } from "../tasks/services.ts"
import { unwrapStringArray } from "./helpers.ts"

export async function promptServiceOptions(
  options: HardeningOptions,
  detectedServices: string[],
): Promise<void> {
  if (detectedServices.length === 0) return

  const choices = UNNECESSARY_SERVICES
    .filter((s) => detectedServices.includes(s.name))
    .map((s) => ({
      value: s.name,
      label: `${s.name} — ${s.description}`,
    }))

  const selected = unwrapStringArray(
    await p.multiselect({
      message: "Select unnecessary services to disable",
      options: choices,
      initialValues: choices.map((c) => c.value),
      required: false,
    }),
  )

  if (selected.length > 0) {
    options.disableServices = true
    options.servicesToDisable = selected
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/prompts/services.ts
git commit -m "feat: add services multiselect prompt"
```

### Task 10: Integrate prompts into hardening flow

**Files:**
- Modify: `src/prompts/hardening.ts:110-171`

- [ ] **Step 1: Add import for promptServiceOptions**

At the top of `src/prompts/hardening.ts`, add:

```ts
import { promptServiceOptions } from "./services.ts"
```

- [ ] **Step 2: Add new default values to the options object**

In the `promptHardeningOptions` function, add these three fields to the initial `options` object, after `enableSshBanner: false,`:

```ts
    disableServices: false,
    servicesToDisable: [],
    fixFilePermissions: false,
```

- [ ] **Step 3: Update the function signature to accept detectedServices**

Change the function signature from:

```ts
export async function promptHardeningOptions(server: ServerInfo, ssh: SshClient): Promise<HardeningOptions> {
```

to:

```ts
export async function promptHardeningOptions(
  server: ServerInfo,
  ssh: SshClient,
  detectedServices: string[],
): Promise<HardeningOptions> {
```

- [ ] **Step 4: Add service and permission prompts after auto-updates**

After the auto-updates confirm block (after `options.enableAutoUpdates = ...`) and before `await promptSysctlOptions(options)`, add:

```ts
  // Disable unnecessary services
  await promptServiceOptions(options, detectedServices)

  // Fix file permissions
  options.fixFilePermissions = unwrapBoolean(
    await p.confirm({
      message: "Do you want to fix permissions on sensitive system files?",
      initialValue: true,
    }),
  )
```

- [ ] **Step 5: Commit**

```bash
git add src/prompts/hardening.ts
git commit -m "feat: integrate service and permission prompts into hardening flow"
```

### Task 11: Update confirmation summary

**Files:**
- Modify: `src/prompts/confirmation.ts:16-35`

- [ ] **Step 1: Add summary lines for new options**

In `buildSummaryLines()`, after the `Kernel hardening` line (`lines.push(\`  Kernel hardening: ...\``), add:

```ts
  lines.push(`  Disable services: ${formatServicesSummary(options)}`)
  lines.push(`  Fix file permissions: ${yesNo(options.fixFilePermissions)}`)
```

Add the helper function before `buildSummaryLines`:

```ts
function formatServicesSummary(options: HardeningOptions): string {
  if (!options.disableServices || options.servicesToDisable.length === 0) return pc.dim("No")
  return `${pc.green("Yes")} (${pc.cyan(options.servicesToDisable.join(", "))})`
}
```

- [ ] **Step 2: Commit**

```bash
git add src/prompts/confirmation.ts
git commit -m "feat: add services and permissions to confirmation summary"
```

### Task 12: Re-export from prompts index

**Files:**
- Modify: `src/prompts/index.ts`

- [ ] **Step 1: Add the new export**

Add to `src/prompts/index.ts`:

```ts
export { promptServiceOptions } from "./services.ts"
```

- [ ] **Step 2: Commit**

```bash
git add src/prompts/index.ts
git commit -m "feat: re-export promptServiceOptions from prompts index"
```

### Task 13: Register new tasks and update orchestrator

**Files:**
- Modify: `src/tasks/index.ts:1-26`
- Modify: `src/orchestrator.ts`

- [ ] **Step 1: Register the two new tasks in `tasks/index.ts`**

Add imports at the top:

```ts
import { runFixPermissions } from "./permissions.ts"
import { runDisableServices } from "./services.ts"
```

In the `TASKS` array, add the two new entries after `runConfigureUnattended` and before `runConfigureSysctl`:

```ts
  { label: "Disabling unnecessary services", run: runDisableServices },
  { label: "Fixing file permissions", run: runFixPermissions },
```

- [ ] **Step 2: Update orchestrator to pass detectedServices**

In `src/orchestrator.ts`, the audit result contains the detected services info. We need to extract the detected services list and pass it to `promptHardeningOptions`.

After `const { serverInfo, auditResult } = await detectAndAudit(ssh, s)` and before `const options = await promptHardeningOptions(...)`, add:

```ts
    const servicesCheck = auditResult.checks.find((c) => c.name === "Unnecessary Services")
    const detectedServices = servicesCheck?.detail?.split(", ") ?? []
```

Then update the call:

```ts
    const options = await promptHardeningOptions(serverInfo, ssh, detectedServices)
```

- [ ] **Step 3: Commit**

```bash
git add src/tasks/index.ts src/orchestrator.ts
git commit -m "feat: register new tasks and pass detected services to prompts"
```

### Task 14: Update defaultOptions in existing test files

**Files:**
- Modify: `src/__tests__/tasks/ufw.test.ts:6-21`
- Modify: `src/__tests__/tasks/sysctl.test.ts:6-21`
- Modify: `src/__tests__/tasks/fail2ban.test.ts`
- Modify: `src/__tests__/tasks/ssh-keys.test.ts`
- Modify: `src/__tests__/tasks/ssh-config.test.ts`
- Modify: `src/__tests__/tasks/unattended.test.ts`
- Modify: `src/__tests__/tasks/user.test.ts`

- [ ] **Step 1: Add three new fields to every `defaultOptions` object**

In each of the test files listed above, find the `defaultOptions` object and add these three fields after `enableSshBanner: false,`:

```ts
  disableServices: false,
  servicesToDisable: [],
  fixFilePermissions: false,
```

- [ ] **Step 2: Run all tests**

Run: `bun test`

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/tasks/
git commit -m "test: update defaultOptions in all test files for new HardeningOptions fields"
```

### Task 15: Final verification

- [ ] **Step 1: Run the full test suite**

Run: `bun test`

Expected: All tests pass.

- [ ] **Step 2: Run the linter**

Run: `bun run lint`

Expected: No errors.

- [ ] **Step 3: Run the type checker**

Run: `bun run check`

Expected: No errors.
