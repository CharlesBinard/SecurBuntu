# Design: UX Context Awareness

## Summary

Fix multiple UX issues where prompts, tasks, and reports ignore the actual server state. The tool should use audit data and connection config to show accurate information, adapt prompts, and configure tasks correctly.

## Bug 1: SSH port defaults to 22 everywhere

**Current behavior**: When the user connects on port 22012 and doesn't ask to change the port, the summary shows "SSH port: 22 (default)", Fail2ban configures on port 22, and SSH hardening writes "Port 22".

**Root cause**: `fail2ban.ts` and `ssh-config.ts` both compute the SSH port as `options.changeSshPort && options.newSshPort ? options.newSshPort : 22`. When the user doesn't change the port, it falls back to 22 instead of the current port.

**Fix**: Pass `currentSshPort` (from audit) through the system. When the user doesn't change the port, use the current port instead of 22.

### Files affected

**`src/types.ts`** — Add a `ServerAuditContext` interface:

```ts
export interface ServerAuditContext {
  currentSshPort: number
  ufwActive: boolean
  fail2banActive: boolean
  sshKeysInfo: string
  detectedServices: string[]
}
```

**`src/orchestrator.ts`** — Build `ServerAuditContext` from audit results and pass it to `promptHardeningOptions`. Replace the current `detectedServices` extraction with the full context object:

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
```

Update call: `promptHardeningOptions(serverInfo, ssh, auditContext)`

**`src/prompts/hardening.ts`** — Change signature to accept `ServerAuditContext` instead of `detectedServices: string[]`. Pass `auditContext.currentSshPort` to `promptSshOptions`. Pass `auditContext` to `promptUfwOptions`. Use `auditContext.detectedServices` for `promptServiceOptions`.

**`src/prompts/ssh-options.ts`** — Accept `currentSshPort: number` parameter. Change message from `"Do you want to change the default SSH port (22)?"` to `"Do you want to change the SSH port? (currently ${currentSshPort})"`. When user doesn't change the port, the `options.changeSshPort` stays false and the current port is preserved downstream.

**`src/prompts/confirmation.ts`** — Accept `currentSshPort: number`. In `buildSummaryLines`, compute SSH port as:
```ts
const sshPort = options.changeSshPort && options.newSshPort ? options.newSshPort : currentSshPort
```
Display the port correctly: if unchanged, show the current port without "(default)".

**`src/tasks/ssh-config.ts`** — Add `currentSshPort` to `HardeningOptions` (or pass via `ServerInfo`). Compute port as `options.changeSshPort && options.newSshPort ? options.newSshPort : currentSshPort` instead of falling back to 22.

**`src/tasks/fail2ban.ts`** — Same port computation fix.

**Approach for passing `currentSshPort` to tasks**: Add `currentSshPort: number` to `HardeningOptions` since tasks only receive `(ssh, options, server)`. Set it in `promptHardeningOptions` before returning.

## Bug 2: UFW default port should match current SSH port

**Current behavior**: UFW prompt pre-fills SSH port 22 in the firewall rules even if the server uses a different port.

**Fix**: `promptUfwOptions` already receives `sshPort` as parameter. The fix is in `prompts/hardening.ts` which computes `sshPort` — change the fallback from 22 to `auditContext.currentSshPort`:

```ts
const sshPort = options.changeSshPort && options.newSshPort ? options.newSshPort : auditContext.currentSshPort
```

## Bug 3: UFW/Fail2ban already installed — wording

**Current behavior**: "Do you want to install and configure UFW?" / "Do you want to install Fail2ban?" even when they're already active.

**Fix**:

**`src/prompts/ufw.ts`** — Accept `ufwActive: boolean` parameter. Change message:
- If active: `"UFW is already active. Do you want to update firewall rules?"`
- If not: `"Do you want to install and configure UFW (firewall)?"`

**`src/prompts/hardening.ts`** — Change Fail2ban prompt message:
- If `auditContext.fail2banActive`: `"Fail2ban is already active. Do you want to reconfigure it?"`
- If not: `"Do you want to install Fail2ban to protect against brute-force attacks?"`

Logic remains the same — install + configure regardless.

## Bug 4: Show SSH keys info before key prompt

**Current behavior**: "Do you want to add a personal SSH public key?" with no context about existing keys.

**Fix**: In `prompts/hardening.ts`, before the personal key question, display the server's SSH key info:

```ts
if (auditContext.sshKeysInfo !== "none found") {
  p.log.info(pc.dim(`SSH keys on server:\n  ${auditContext.sshKeysInfo.split("\n").join("\n  ")}`))
} else {
  p.log.info(pc.dim("No SSH keys found on this server"))
}
```

## Bug 5: List local SSH keys for connection

**Current behavior**: When choosing "SSH Key" or "Copy my SSH key", the user is asked to type the path manually.

**Fix**:

**`src/ssh/detect.ts`** — Add a new function `detectAllLocalKeys()`:

```ts
export interface LocalSshKey {
  path: string
  type: string // "ed25519", "rsa", "ecdsa"
}

export function detectAllLocalKeys(): LocalSshKey[] {
  const home = process.env.HOME ?? ""
  const sshDir = `${home}/.ssh`
  const patterns: Array<{ filename: string; type: string }> = [
    { filename: "id_ed25519", type: "ed25519" },
    { filename: "id_ecdsa", type: "ecdsa" },
    { filename: "id_rsa", type: "rsa" },
  ]

  const keys: LocalSshKey[] = []
  for (const { filename, type } of patterns) {
    const path = `${sshDir}/${filename}`
    if (existsSync(path)) {
      keys.push({ path, type })
    }
  }
  return keys
}
```

**`src/prompts/connection.ts`** — In `promptAuthCredentials`, when `authMethod` is `"key"` or `"copy"`:

1. Call `detectAllLocalKeys()` to find available keys
2. If keys found: show a select with the detected keys + "Other (enter path manually)"
3. If no keys found: fall back to manual text input (current behavior)
4. For `"copy"` mode: check for corresponding `.pub` file

```ts
const localKeys = detectAllLocalKeys()

if (localKeys.length > 0) {
  const options = [
    ...localKeys.map((k) => ({
      value: k.path,
      label: `~/.ssh/${k.path.split("/").pop()} (${k.type})`,
    })),
    { value: "manual" as const, label: "Other (enter path manually)" },
  ]

  const choice = await p.select({
    message: "Select your SSH key",
    options,
  })

  if (choice === "manual") {
    // existing manual text input
  } else {
    privateKeyPath = choice
  }
} else {
  // existing manual text input
}
```

**`src/ssh/index.ts`** — Re-export `detectAllLocalKeys` and `LocalSshKey`.

## Files to modify

- `src/types.ts` — add `ServerAuditContext` interface, add `currentSshPort` to `HardeningOptions`
- `src/orchestrator.ts` — build `ServerAuditContext`, pass to prompts
- `src/prompts/hardening.ts` — accept `ServerAuditContext`, propagate to sub-prompts, show SSH keys info, adapt Fail2ban wording
- `src/prompts/ssh-options.ts` — accept and display `currentSshPort`
- `src/prompts/ufw.ts` — accept `ufwActive`, adapt wording
- `src/prompts/confirmation.ts` — accept `currentSshPort`, fix summary port display
- `src/prompts/connection.ts` — list local SSH keys for selection
- `src/ssh/detect.ts` — add `detectAllLocalKeys()` and `LocalSshKey`
- `src/ssh/index.ts` — re-export new function and type
- `src/tasks/ssh-config.ts` — use `currentSshPort` instead of 22 fallback
- `src/tasks/fail2ban.ts` — use `currentSshPort` instead of 22 fallback
- `src/__tests__/tasks/ssh-config.test.ts` — update tests for new port behavior
- `src/__tests__/tasks/fail2ban.test.ts` — update tests for new port behavior
- `src/__tests__/tasks/*.test.ts` — add `currentSshPort` to `defaultOptions`
