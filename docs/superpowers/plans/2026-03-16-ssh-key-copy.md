# SSH Key Copy Feature — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to copy their SSH public key to the server via `ssh-copy-id` when key auth fails, then reconnect automatically with key auth.

**Architecture:** Two entry points — a 3rd auth option in the menu and auto-proposal on key auth failure. A new `copyKeyToServer()` function in `src/ssh.ts` spawns `ssh-copy-id` with inherited stdio for interactive password entry. The existing connection retry loop in `src/index.ts` handles reconnection after successful key copy.

**Tech Stack:** BunJS, `Bun.spawn` with `inherit` stdio, `@clack/prompts` for UI, `ssh-copy-id` (ships with openssh-client).

**Testing note:** This feature lives in the connection/prompts layer which is inherently interactive (terminal prompts, SSH connections). No unit tests — verify with `bunx tsc --noEmit` and manual testing. This is consistent with the existing project: tests cover tasks/report/audit/wrappers, not prompts or connection logic.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/types.ts` | Modify | Widen `authMethod` union to include `"copy"` |
| `src/ssh.ts` | Modify | Add `copyKeyToServer()` and `checkSshCopyIdInstalled()` |
| `src/prompts.ts` | Modify | Add 3rd auth option + `promptCopyKeyOnFailure()` |
| `src/index.ts` | Modify | Wire key copy flow in connection loop |

---

## Task 1: Type Change + `copyKeyToServer()` Function

**Files:**
- Modify: `src/types.ts:5`
- Modify: `src/ssh.ts`

- [ ] **Step 1: Widen `authMethod` type**

In `src/types.ts`, change line 5:

```typescript
// Before
authMethod: "key" | "password"

// After
authMethod: "key" | "password" | "copy"
```

- [ ] **Step 2: Add `checkSshCopyIdInstalled()` to `src/ssh.ts`**

Add after the existing `checkSshpassInstalled()` function (after line 120):

```typescript
export async function checkSshCopyIdInstalled(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["which", "ssh-copy-id"], {
      stdout: "pipe",
      stderr: "pipe",
    })
    await proc.exited
    return proc.exitCode === 0
  } catch {
    return false
  }
}
```

- [ ] **Step 3: Add `copyKeyToServer()` to `src/ssh.ts`**

Add after `checkSshCopyIdInstalled()`:

```typescript
export async function copyKeyToServer(
  host: string,
  user: string,
  pubKeyPath: string,
  port: number = 22,
): Promise<boolean> {
  const hasCmd = await checkSshCopyIdInstalled()
  if (!hasCmd) {
    return false
  }

  const args = [
    "ssh-copy-id",
    "-i", pubKeyPath,
    "-p", String(port),
    "-o", "StrictHostKeyChecking=yes",
    `${user}@${host}`,
  ]

  const proc = Bun.spawn(args, {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })

  const exitCode = await proc.exited
  return exitCode === 0
}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `bunx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/ssh.ts
git commit -m "feat: add copyKeyToServer function and widen authMethod type"
```

---

## Task 2: Prompts Changes

**Files:**
- Modify: `src/prompts.ts`

- [ ] **Step 1: Add import for `checkSshCopyIdInstalled`**

In `src/prompts.ts`, line 4, add `checkSshCopyIdInstalled` to the import:

```typescript
// Before
import { detectDefaultKeyPath, detectDefaultPubKeyPath, checkSshpassInstalled } from "./ssh.js"

// After
import { detectDefaultKeyPath, detectDefaultPubKeyPath, checkSshpassInstalled, checkSshCopyIdInstalled } from "./ssh.js"
```

- [ ] **Step 2: Add 3rd auth option to `promptConnection()`**

In `src/prompts.ts`, replace the auth method select (lines 50-56):

```typescript
  // Before
  const authMethod = await p.select({
    message: "How do you want to authenticate?",
    options: [
      { value: "key" as const, label: "SSH Key", hint: "recommended" },
      { value: "password" as const, label: "Password" },
    ],
  })
  if (isCancel(authMethod)) handleCancel()

  // After
  const authMethod = await p.select({
    message: "How do you want to authenticate?",
    options: [
      { value: "key" as const, label: "SSH Key", hint: "recommended" },
      { value: "password" as const, label: "Password" },
      { value: "copy" as const, label: "Copy my SSH key to server", hint: "needs password" },
    ],
  })
  if (isCancel(authMethod)) handleCancel()
```

- [ ] **Step 3: Handle `"copy"` auth method in key path prompt**

The `"copy"` method needs a private key path (to derive the `.pub`). Update the `if (authMethod === "key")` block (lines 62-74) to also handle `"copy"`:

```typescript
  // Before
  if (authMethod === "key") {

  // After
  if (authMethod === "key" || authMethod === "copy") {
```

The `"copy"` path also needs to verify `.pub` exists and that `ssh-copy-id` is available. Add this right after the key path assignment (after line 74, inside the `if` block):

```typescript
    privateKeyPath = keyPath.replace("~", process.env.HOME ?? "")

    if (authMethod === "copy") {
      const pubKeyPath = privateKeyPath + ".pub"
      if (!existsSync(pubKeyPath)) {
        p.log.error(
          `${pc.red(`Public key not found at ${pubKeyPath}`)}\n` +
          `  ${pc.dim("Make sure the .pub file exists alongside your private key.")}`
        )
        process.exit(1)
      }

      const hasSshCopyId = await checkSshCopyIdInstalled()
      if (!hasSshCopyId) {
        p.log.error(
          `${pc.red("ssh-copy-id is required but is not installed.")}\n` +
          `  ${pc.dim("Install it with:")}\n` +
          `  ${pc.cyan("  Ubuntu/Debian: sudo apt install openssh-client")}\n` +
          `  ${pc.cyan("  macOS:         brew install ssh-copy-id")}`
        )
        process.exit(1)
      }
    }
```

- [ ] **Step 4: Add `promptCopyKeyOnFailure()` function**

Add at the end of `src/prompts.ts`:

```typescript
export async function promptCopyKeyOnFailure(): Promise<boolean> {
  const action = await p.select({
    message: "Would you like to copy your SSH key to the server?",
    options: [
      { value: "yes" as const, label: "Yes, copy my key", hint: "needs password" },
      { value: "no" as const, label: "No, let me try different credentials" },
    ],
  })
  if (isCancel(action)) handleCancel()
  return action === "yes"
}
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `bunx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add src/prompts.ts
git commit -m "feat: add copy-key auth option and failure prompt"
```

---

## Task 3: Index Flow Wiring

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add imports**

In `src/index.ts`, update the imports:

```typescript
// Add at top
import { existsSync } from "fs"

// Before (line 5)
import { connect, detectServerInfo, fetchHostKeyFingerprint, addToKnownHosts } from "./ssh.js"

// After
import { connect, detectServerInfo, fetchHostKeyFingerprint, addToKnownHosts, copyKeyToServer, checkSshCopyIdInstalled } from "./ssh.js"

// Before (line 6)
import { promptConnection, promptHardeningOptions, promptConfirmation, promptExportReport, promptExportLog, promptExportAudit } from "./prompts.js"

// After
import { promptConnection, promptHardeningOptions, promptConfirmation, promptExportReport, promptExportLog, promptExportAudit, promptCopyKeyOnFailure } from "./prompts.js"
```

- [ ] **Step 2: Wire both entry points in the connection loop**

Replace the entire connection error handling block (lines 58-75) with the updated flow that handles both entry points:

```typescript
    // Handle "copy" auth method — copy key before attempting connection
    if (connectionConfig.authMethod === "copy" && connectionConfig.privateKeyPath) {
      const pubKeyPath = connectionConfig.privateKeyPath + ".pub"
      log.info(pc.dim("Copying your SSH key to the server..."))

      const copied = await copyKeyToServer(
        connectionConfig.host,
        connectionConfig.username,
        pubKeyPath,
        connectionConfig.port,
      )

      if (copied) {
        log.success("SSH key copied successfully. Connecting with key auth...")
        connectionConfig.authMethod = "key"
      } else {
        log.error(pc.red("Failed to copy SSH key. Check the password and try again."))
        log.info(pc.cyan("Let's try again.\n"))
        continue
      }
    }

    s.start(`Connecting to ${connectionConfig.host}...`)

    try {
      ssh = await connect(connectionConfig)
      s.stop(`Connected to ${pc.green(connectionConfig.host)}`)
      break
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error"
      s.stop(pc.red(`Connection failed: ${msg}`))

      // Entry point 2: auto-propose key copy on "Permission denied (publickey)"
      if (
        connectionConfig.authMethod === "key" &&
        connectionConfig.privateKeyPath &&
        msg.includes("Permission denied")
      ) {
        const wantCopy = await promptCopyKeyOnFailure()
        if (wantCopy) {
          const pubKeyPath = connectionConfig.privateKeyPath + ".pub"

          if (!existsSync(pubKeyPath)) {
            log.error(pc.red(`Public key not found at ${pubKeyPath}`))
            log.info(pc.cyan("Let's try again.\n"))
            continue
          }

          const hasSshCopyId = await checkSshCopyIdInstalled()
          if (!hasSshCopyId) {
            log.error(
              `${pc.red("ssh-copy-id is required but is not installed.")}\n` +
              `  ${pc.dim("Install it with:")}\n` +
              `  ${pc.cyan("  Ubuntu/Debian: sudo apt install openssh-client")}\n` +
              `  ${pc.cyan("  macOS:         brew install ssh-copy-id")}`
            )
            log.info(pc.cyan("Let's try again.\n"))
            continue
          }

          log.info(pc.dim("Copying your SSH key to the server..."))
          const copied = await copyKeyToServer(
            connectionConfig.host,
            connectionConfig.username,
            pubKeyPath,
            connectionConfig.port,
          )

          if (copied) {
            log.success("SSH key copied successfully. Reconnecting...")
            continue // retry the loop — authMethod is still "key"
          } else {
            log.error(pc.red("Failed to copy SSH key. Check the password and try again."))
          }
        }
      } else {
        log.warning(
          `${pc.bold("Troubleshooting:")}\n` +
          `  ${pc.dim("- Verify the IP address and port")}\n` +
          `  ${pc.dim("- Check that SSH is running on the server")}\n` +
          `  ${pc.dim("- Verify your credentials (key path or password)")}\n` +
          `  ${pc.dim("- Check network connectivity")}`,
        )
      }

      log.info(pc.cyan("Let's try again.\n"))
    }
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `bunx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 4: Run existing tests to check for regressions**

Run: `bun test`
Expected: All 95 tests PASS (no regressions — these changes only affect the connection layer which has no tests)

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire ssh-copy-id flow in connection loop"
```
