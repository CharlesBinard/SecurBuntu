# UX Context Awareness — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix UX bugs where prompts, tasks, and summary ignore the actual server state — use audit data to show correct SSH port, adapt wording for installed services, list SSH keys.

**Architecture:** Extract a `ServerAuditContext` from audit results in the orchestrator, pass it through the prompt chain. Add `currentSshPort` to `HardeningOptions` so tasks use the real port. Add `detectAllLocalKeys()` for SSH key selection at connection time.

**Tech Stack:** TypeScript, Bun, @clack/prompts, picocolors, bun:test

---

## Chunk 1: Types, detectAllLocalKeys, and tests

### Task 1: Add ServerAuditContext and currentSshPort to types

**Files:**
- Modify: `src/types.ts:20-43`

- [ ] **Step 1: Add `ServerAuditContext` interface and `currentSshPort` field**

In `src/types.ts`, add the `ServerAuditContext` interface after the `ServerInfo` interface (after line 18):

```ts
export interface ServerAuditContext {
  currentSshPort: number
  ufwActive: boolean
  fail2banActive: boolean
  sshKeysInfo: string
  detectedServices: string[]
}
```

Then add `currentSshPort: number` to `HardeningOptions`, after `enableSshBanner: boolean`:

```ts
  currentSshPort: number
```

- [ ] **Step 2: Commit**

```bash
git add src/types.ts
git commit -m "feat: add ServerAuditContext interface and currentSshPort to HardeningOptions"
```

### Task 2: Add detectAllLocalKeys to ssh/detect.ts

**Files:**
- Modify: `src/ssh/detect.ts:1-28`
- Modify: `src/ssh/index.ts`

- [ ] **Step 1: Add `LocalSshKey` interface and `detectAllLocalKeys` function**

At the top of `src/ssh/detect.ts`, after the existing imports, add:

```ts
export interface LocalSshKey {
  path: string
  type: string
}

export function detectAllLocalKeys(): LocalSshKey[] {
  const home = process.env.HOME ?? ""
  if (!home) return []
  const sshDir = `${home}/.ssh`
  const patterns: Array<{ filename: string; type: string }> = [
    { filename: "id_ed25519", type: "ed25519" },
    { filename: "id_ecdsa", type: "ecdsa" },
    { filename: "id_rsa", type: "rsa" },
  ]

  const keys: LocalSshKey[] = []
  for (const { filename, type } of patterns) {
    const fullPath = `${sshDir}/${filename}`
    if (existsSync(fullPath)) {
      keys.push({ path: fullPath, type })
    }
  }
  return keys
}
```

- [ ] **Step 2: Re-export from ssh/index.ts**

In `src/ssh/index.ts`, change the detect.ts export line from:

```ts
export { detectDefaultKeyPath, detectDefaultPubKeyPath, detectServerInfo } from "./detect.ts"
```

to:

```ts
export { detectAllLocalKeys, detectDefaultKeyPath, detectDefaultPubKeyPath, detectServerInfo } from "./detect.ts"
export type { LocalSshKey } from "./detect.ts"
```

- [ ] **Step 3: Commit**

```bash
git add src/ssh/detect.ts src/ssh/index.ts
git commit -m "feat: add detectAllLocalKeys for listing local SSH keys"
```

### Task 3: Write tests for detectAllLocalKeys

**Files:**
- Create: `src/__tests__/ssh/detect.test.ts`

- [ ] **Step 1: Create `src/__tests__/ssh/detect.test.ts`**

```ts
import { afterEach, describe, expect, mock, test } from "bun:test"
import { existsSync } from "fs"
import { detectAllLocalKeys } from "../../ssh/detect.ts"

describe("detectAllLocalKeys", () => {
  const originalHome = process.env.HOME

  afterEach(() => {
    process.env.HOME = originalHome
  })

  test("returns empty array when HOME is unset", () => {
    process.env.HOME = ""
    const keys = detectAllLocalKeys()
    expect(keys).toEqual([])
  })

  test("returns empty array when no keys exist", () => {
    process.env.HOME = "/tmp/nonexistent-home-for-test"
    const keys = detectAllLocalKeys()
    expect(keys).toEqual([])
  })

  test("finds keys that exist on disk", () => {
    // Uses the real HOME — this test passes if the user has at least one SSH key
    const keys = detectAllLocalKeys()
    // Each key should have path and type
    for (const key of keys) {
      expect(key.path).toContain("/.ssh/")
      expect(["ed25519", "ecdsa", "rsa"]).toContain(key.type)
      expect(existsSync(key.path)).toBe(true)
    }
  })

  test("returns keys in priority order (ed25519, ecdsa, rsa)", () => {
    const keys = detectAllLocalKeys()
    if (keys.length >= 2) {
      const typeOrder = ["ed25519", "ecdsa", "rsa"]
      for (let i = 1; i < keys.length; i++) {
        const prevIdx = typeOrder.indexOf(keys[i - 1]?.type ?? "")
        const currIdx = typeOrder.indexOf(keys[i]?.type ?? "")
        expect(prevIdx).toBeLessThanOrEqual(currIdx)
      }
    }
  })
})
```

- [ ] **Step 2: Run tests**

Run: `bun test src/__tests__/ssh/detect.test.ts`

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/ssh/detect.test.ts
git commit -m "test: add detectAllLocalKeys tests"
```

## Chunk 2: Fix tasks (fail2ban + ssh-config port fallback)

### Task 4: Fix fail2ban port fallback

**Files:**
- Modify: `src/tasks/fail2ban.ts:22`

- [ ] **Step 1: Change the port computation**

In `src/tasks/fail2ban.ts`, change line 22 from:

```ts
  const sshPort = options.changeSshPort && options.newSshPort ? options.newSshPort : 22
```

to:

```ts
  const sshPort = options.changeSshPort && options.newSshPort ? options.newSshPort : options.currentSshPort
```

- [ ] **Step 2: Commit**

```bash
git add src/tasks/fail2ban.ts
git commit -m "fix: fail2ban uses currentSshPort instead of hardcoded 22"
```

### Task 5: Fix ssh-config port fallback

**Files:**
- Modify: `src/tasks/ssh-config.ts:70`

- [ ] **Step 1: Change the port computation**

In `src/tasks/ssh-config.ts`, change line 70 from:

```ts
  const sshPort = options.changeSshPort && options.newSshPort ? options.newSshPort : 22
```

to:

```ts
  const sshPort = options.changeSshPort && options.newSshPort ? options.newSshPort : options.currentSshPort
```

- [ ] **Step 2: Commit**

```bash
git add src/tasks/ssh-config.ts
git commit -m "fix: ssh-config uses currentSshPort instead of hardcoded 22"
```

### Task 6: Update fail2ban and ssh-config tests

**Files:**
- Modify: `src/__tests__/tasks/fail2ban.test.ts`
- Modify: `src/__tests__/tasks/ssh-config.test.ts`

- [ ] **Step 1: Add `currentSshPort: 22` to defaultOptions in fail2ban.test.ts**

In `src/__tests__/tasks/fail2ban.test.ts`, add after `fixFilePermissions: false,`:

```ts
  currentSshPort: 22,
```

- [ ] **Step 2: Add test for currentSshPort usage in fail2ban.test.ts**

Add after the existing "uses custom SSH port" test:

```ts
  test("uses currentSshPort when port is not changed", async () => {
    const ssh = new MockSshClient()
    const options = {
      ...defaultOptions,
      installFail2ban: true,
      currentSshPort: 22012,
    }

    await runConfigureFail2ban(ssh, options, makeServer("24.04"))

    const config = ssh.writtenFiles.get("/etc/fail2ban/jail.d/securbuntu.local")
    expect(config).toContain("port = 22012")
  })
```

- [ ] **Step 3: Add `currentSshPort: 22` to defaultOptions in ssh-config.test.ts**

In `src/__tests__/tasks/ssh-config.test.ts`, add after `fixFilePermissions: false,`:

```ts
  currentSshPort: 22,
```

- [ ] **Step 4: Add test for currentSshPort usage in ssh-config.test.ts**

Add after the existing "writes SSH config with custom port" test:

```ts
  test("uses currentSshPort when port is not changed", async () => {
    const ssh = new MockSshClient()
    ssh.onExec("sshd -t", { exitCode: 0 })
    ssh.onExec("echo ok", { stdout: "ok" })

    const options = {
      ...defaultOptions,
      currentSshPort: 22012,
      permitRootLogin: "prohibit-password" as const,
    }

    const result = await runHardenSshConfig(ssh, options, defaultServer)

    expect(result.success).toBe(true)
    const config = ssh.writtenFiles.get("/etc/ssh/sshd_config.d/01-securbuntu.conf")
    expect(config).toContain("Port 22012")
  })
```

- [ ] **Step 5: Run tests**

Run: `bun test src/__tests__/tasks/fail2ban.test.ts src/__tests__/tasks/ssh-config.test.ts`

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/__tests__/tasks/fail2ban.test.ts src/__tests__/tasks/ssh-config.test.ts
git commit -m "test: add currentSshPort tests for fail2ban and ssh-config"
```

## Chunk 3: Update prompts (ssh-options, ufw, confirmation, hardening, connection)

### Task 7: Update ssh-options prompt to show current port

**Files:**
- Modify: `src/prompts/ssh-options.ts:6`

- [ ] **Step 1: Add `currentSshPort` parameter**

Change the function signature from:

```ts
export async function promptSshOptions(options: HardeningOptions): Promise<void> {
```

to:

```ts
export async function promptSshOptions(options: HardeningOptions, currentSshPort: number): Promise<void> {
```

- [ ] **Step 2: Update the port change message**

Change the message on line 10 from:

```ts
      message: "Do you want to change the default SSH port (22)?",
```

to:

```ts
      message: `Do you want to change the SSH port? (currently ${currentSshPort})`,
```

- [ ] **Step 3: Commit**

```bash
git add src/prompts/ssh-options.ts
git commit -m "fix: ssh-options prompt shows current port instead of hardcoded 22"
```

### Task 8: Update UFW prompt wording for already-active

**Files:**
- Modify: `src/prompts/ufw.ts:83-88`

- [ ] **Step 1: Add `ufwActive` parameter**

Change the function signature from:

```ts
export async function promptUfwOptions(options: HardeningOptions, sshPort: number): Promise<void> {
```

to:

```ts
export async function promptUfwOptions(options: HardeningOptions, sshPort: number, ufwActive: boolean): Promise<void> {
```

- [ ] **Step 2: Update the install message**

Change lines 84-87 from:

```ts
  const installUfw = unwrapBoolean(
    await p.confirm({
      message: "Do you want to install and configure UFW (firewall)?",
    }),
  )
```

to:

```ts
  const ufwMessage = ufwActive
    ? "UFW is already active. Do you want to update firewall rules?"
    : "Do you want to install and configure UFW (firewall)?"
  const installUfw = unwrapBoolean(
    await p.confirm({
      message: ufwMessage,
    }),
  )
```

- [ ] **Step 3: Commit**

```bash
git add src/prompts/ufw.ts
git commit -m "fix: UFW prompt adapts wording when already active"
```

### Task 9: Update confirmation summary port display

**Files:**
- Modify: `src/prompts/confirmation.ts:21-28`

- [ ] **Step 1: Fix the port computation and display**

In `src/prompts/confirmation.ts`, replace lines 22 and 28:

Change line 22 from:

```ts
  const sshPort = options.changeSshPort && options.newSshPort ? options.newSshPort : 22
```

to:

```ts
  const sshPort = options.changeSshPort && options.newSshPort ? options.newSshPort : options.currentSshPort
```

Change line 28 from:

```ts
  lines.push(`  SSH port: ${options.changeSshPort ? pc.yellow(String(sshPort)) : pc.dim("22 (default)")}`)
```

to:

```ts
  lines.push(`  SSH port: ${options.changeSshPort ? pc.yellow(String(sshPort)) : pc.dim(String(options.currentSshPort))}`)
```

- [ ] **Step 2: Commit**

```bash
git add src/prompts/confirmation.ts
git commit -m "fix: confirmation summary shows actual SSH port instead of 22"
```

### Task 10: Update hardening prompt to use ServerAuditContext

**Files:**
- Modify: `src/prompts/hardening.ts`

- [ ] **Step 1: Update import to include ServerAuditContext**

Change line 5 from:

```ts
import type { HardeningOptions, ServerInfo, SshClient } from "../types.ts"
```

to:

```ts
import type { HardeningOptions, ServerAuditContext, ServerInfo, SshClient } from "../types.ts"
```

- [ ] **Step 2: Update function signature**

Change lines 111-114 from:

```ts
export async function promptHardeningOptions(
  server: ServerInfo,
  ssh: SshClient,
  detectedServices: string[],
): Promise<HardeningOptions> {
```

to:

```ts
export async function promptHardeningOptions(
  server: ServerInfo,
  ssh: SshClient,
  auditContext: ServerAuditContext,
): Promise<HardeningOptions> {
```

- [ ] **Step 3: Add `currentSshPort` to options default and show SSH keys info**

Add `currentSshPort: auditContext.currentSshPort,` to the initial options object, after `fixFilePermissions: false,`.

Before the `promptPersonalKey` call (line 138), add the SSH keys info display:

```ts
  // Show existing SSH keys on server
  if (auditContext.sshKeysInfo !== "none found") {
    p.log.info(pc.dim(`SSH keys on server:\n  ${auditContext.sshKeysInfo.split("\n").join("\n  ")}`))
  } else {
    p.log.info(pc.dim("No SSH keys found on this server"))
  }
```

- [ ] **Step 4: Pass currentSshPort to promptSshOptions**

Change line 156 from:

```ts
  await promptSshOptions(options)
```

to:

```ts
  await promptSshOptions(options, auditContext.currentSshPort)
```

- [ ] **Step 5: Fix sshPort computation and pass ufwActive to promptUfwOptions**

Change lines 159-160 from:

```ts
  const sshPort = options.changeSshPort && options.newSshPort ? options.newSshPort : 22
  await promptUfwOptions(options, sshPort)
```

to:

```ts
  const sshPort = options.changeSshPort && options.newSshPort ? options.newSshPort : auditContext.currentSshPort
  await promptUfwOptions(options, sshPort, auditContext.ufwActive)
```

- [ ] **Step 6: Update Fail2ban prompt wording**

Change lines 163-166 from:

```ts
  options.installFail2ban = unwrapBoolean(
    await p.confirm({
      message: "Do you want to install Fail2ban to protect against brute-force attacks?",
    }),
  )
```

to:

```ts
  const fail2banMessage = auditContext.fail2banActive
    ? "Fail2ban is already active. Do you want to reconfigure it?"
    : "Do you want to install Fail2ban to protect against brute-force attacks?"
  options.installFail2ban = unwrapBoolean(
    await p.confirm({
      message: fail2banMessage,
    }),
  )
```

- [ ] **Step 7: Update detectedServices reference**

Change line 177 from:

```ts
  await promptServiceOptions(options, detectedServices)
```

to:

```ts
  await promptServiceOptions(options, auditContext.detectedServices)
```

- [ ] **Step 8: Commit**

```bash
git add src/prompts/hardening.ts
git commit -m "feat: hardening prompt uses ServerAuditContext for port, wording, and SSH keys info"
```

### Task 11: Update connection prompt to list local SSH keys

**Files:**
- Modify: `src/prompts/connection.ts:1-33`

- [ ] **Step 1: Add import for detectAllLocalKeys**

Change line 4 from:

```ts
import { checkSshCopyIdInstalled, checkSshpassInstalled, detectDefaultKeyPath } from "../ssh/index.ts"
```

to:

```ts
import { checkSshCopyIdInstalled, checkSshpassInstalled, detectAllLocalKeys, detectDefaultKeyPath } from "../ssh/index.ts"
```

- [ ] **Step 2: Replace the key path prompt with a select**

Replace the entire `if (authMethod === "key" || authMethod === "copy")` block (lines 11-32) with:

```ts
  if (authMethod === "key" || authMethod === "copy") {
    const localKeys = detectAllLocalKeys()
    let privateKeyPath: string

    if (localKeys.length > 0) {
      const keyOptions = [
        ...localKeys.map((k) => ({
          value: k.path,
          label: `~/.ssh/${k.path.split("/").pop()} (${k.type})`,
        })),
        { value: "manual", label: "Other (enter path manually)" },
      ]

      const choice = await p.select({
        message: "Select your SSH key",
        options: keyOptions,
      })
      if (isCancel(choice)) handleCancel()

      if (choice === "manual") {
        privateKeyPath = await promptManualKeyPath()
      } else {
        privateKeyPath = choice
      }
    } else {
      privateKeyPath = await promptManualKeyPath()
    }

    if (authMethod === "copy") {
      await validateCopyKeyPrerequisites(privateKeyPath)
    }

    return { privateKeyPath }
  }
```

- [ ] **Step 3: Extract the manual key prompt into a helper function**

Add this function before `promptAuthCredentials`:

```ts
async function promptManualKeyPath(): Promise<string> {
  const defaultKey = detectDefaultKeyPath()
  const keyPath = unwrapText(
    await p.text({
      message: "Path to your private SSH key",
      placeholder: defaultKey ?? "~/.ssh/id_ed25519",
      defaultValue: defaultKey,
      validate(value) {
        if (!value?.trim()) return "Key path is required"
        const resolved = value.replace("~", process.env.HOME ?? "")
        if (!existsSync(resolved)) return `File not found: ${resolved}`
        return undefined
      },
    }),
  )
  return keyPath.replace("~", process.env.HOME ?? "")
}
```

- [ ] **Step 4: Commit**

```bash
git add src/prompts/connection.ts
git commit -m "feat: list local SSH keys for selection at connection time"
```

## Chunk 4: Orchestrator update and test fixes

### Task 12: Update orchestrator to build ServerAuditContext

**Files:**
- Modify: `src/orchestrator.ts:17,192-195`

- [ ] **Step 1: Add import for ServerAuditContext**

Change line 17 from:

```ts
import type { AuditResult, ConnectionConfig, HardeningOptions, Report, ServerInfo, SshClient } from "./types.ts"
```

to:

```ts
import type { AuditResult, ConnectionConfig, HardeningOptions, Report, ServerAuditContext, ServerInfo, SshClient } from "./types.ts"
```

- [ ] **Step 2: Replace detectedServices extraction with full audit context**

Replace lines 192-195:

```ts
    const servicesCheck = auditResult.checks.find((c) => c.name === "Unnecessary Services")
    const detectedServices = servicesCheck?.detail?.split(", ") ?? []

    const options = await promptHardeningOptions(serverInfo, ssh, detectedServices)
```

with:

```ts
    const portCheck = auditResult.checks.find((c) => c.name === "SSH Port")
    const portStr = portCheck?.status?.replace(" (default)", "") ?? "22"
    const currentSshPort = parseInt(portStr, 10) || 22

    const ufwCheck = auditResult.checks.find((c) => c.name === "UFW Firewall")
    const ufwActive = ufwCheck?.status === "active"

    const f2bCheck = auditResult.checks.find((c) => c.name === "Fail2ban")
    const fail2banActive = f2bCheck?.status === "active"

    const sshKeysCheck = auditResult.checks.find((c) => c.name === "SSH Keys")
    const sshKeysInfo = sshKeysCheck?.status ?? "none found"

    const servicesCheck = auditResult.checks.find((c) => c.name === "Unnecessary Services")
    const detectedServices = servicesCheck?.detail?.split(", ") ?? []

    const auditContext: ServerAuditContext = {
      currentSshPort,
      ufwActive,
      fail2banActive,
      sshKeysInfo,
      detectedServices,
    }

    const options = await promptHardeningOptions(serverInfo, ssh, auditContext)
```

- [ ] **Step 3: Commit**

```bash
git add src/orchestrator.ts
git commit -m "feat: orchestrator builds ServerAuditContext from audit results"
```

### Task 13: Update defaultOptions in all remaining test files

**Files:**
- Modify: `src/__tests__/tasks/ufw.test.ts`
- Modify: `src/__tests__/tasks/sysctl.test.ts`
- Modify: `src/__tests__/tasks/unattended.test.ts`
- Modify: `src/__tests__/tasks/user.test.ts`
- Modify: `src/__tests__/tasks/ssh-keys.test.ts`
- Modify: `src/__tests__/tasks/services.test.ts`
- Modify: `src/__tests__/tasks/permissions.test.ts`

- [ ] **Step 1: Add `currentSshPort: 22` to every `defaultOptions`**

In each of the 7 test files listed above, find the `defaultOptions` object and add after `fixFilePermissions: false,`:

```ts
  currentSshPort: 22,
```

- [ ] **Step 2: Run all tests**

Run: `bun test`

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/tasks/
git commit -m "test: add currentSshPort to defaultOptions in all test files"
```

### Task 14: Final verification

- [ ] **Step 1: Run the full test suite**

Run: `bun test`

Expected: All tests pass.

- [ ] **Step 2: Run the linter**

Run: `bunx biome check ./src`

Expected: No errors.

- [ ] **Step 3: Run the type checker**

Run: `bunx tsc --noEmit`

Expected: No errors.
