# Cross-Platform Support & Host OS Detection — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make SecurBuntu runnable from Linux, macOS, and Windows as an SSH client, while gating local mode to Ubuntu 22.04+.

**Architecture:** A new `src/platform/` module centralizes all host-side concerns: OS detection, command availability, home directory resolution, and a TS fallback for `ssh-copy-id`. Existing connection/SSH modules are updated to receive platform info and conditionally disable ControlMaster on Windows. All `process.env.HOME` usages are replaced with a cross-platform `resolveHome()` helper.

**Tech Stack:** TypeScript, Bun, `@clack/prompts`, `os.homedir()`, `path.join()`

**Spec:** `docs/superpowers/specs/2026-03-17-cross-platform-os-detection-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/platform/home.ts` | Cross-platform home directory resolution via `os.homedir()` |
| `src/platform/detect.ts` | Host OS detection + shared `parseOsRelease()` helper |
| `src/platform/capabilities.ts` | Command availability check (`ssh`, `sshpass`, etc.) + auto-install prompts |
| `src/platform/ssh-copy.ts` | TS fallback for `ssh-copy-id` via `SystemClient` |
| `src/platform/index.ts` | Re-exports |
| `src/types.ts` | New `HostPlatform` + `HostCapabilities` interfaces |
| `src/index.ts` | Wire `detectHostPlatform()` into startup |
| `src/connection/mode.ts` | Accept `HostPlatform`, gate local mode, remove `validateLocalUbuntu()` |
| `src/connection/retry-loop.ts` | Thread `HostPlatform` + `HostCapabilities` through |
| `src/connection/verify-host.ts` | Thread platform/capabilities to `fetchHostKeyFingerprint()` |
| `src/connection/index.ts` | Update re-exports |
| `src/ssh/connection.ts` | Conditional ControlMaster/ControlPath on Windows |
| `src/ssh/detect.ts` | Use shared `parseOsRelease()`, replace `process.env.HOME` |
| `src/ssh/host-keys.ts` | Windows temp file for `ssh-keygen`, skip if no `ssh-keyscan` |
| `src/ssh/copy-key.ts` | Remove old check functions, integrate TS fallback |
| `src/ssh/index.ts` | Update re-exports |
| `src/prompts/connection.ts` | Accept capabilities, hide password auth if no `sshpass` |
| `src/prompts/hardening.ts` | Replace `process.env.HOME` |
| `src/connection/error-handlers.ts` | Thread capabilities, use capabilities instead of `which` checks |

---

### Task 1: Add `HostPlatform` and `HostCapabilities` types

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add the two new interfaces to `src/types.ts`**

Add after the `ConnectionResult` interface (line 126):

```typescript
export interface HostPlatform {
  os: "linux" | "macos" | "windows"
  distro: string | null
  version: string | null
  codename: string | null
  isCompatibleTarget: boolean
}

export interface HostCapabilities {
  ssh: boolean
  sshCopyId: boolean
  sshpass: boolean
  sshKeygen: boolean
  sshKeyscan: boolean
}
```

- [ ] **Step 2: Run type check**

Run: `bun run check`
Expected: PASS (new types are unused — no errors)

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add HostPlatform and HostCapabilities types"
```

---

### Task 2: Create `src/platform/home.ts` — cross-platform home directory

**Files:**
- Create: `src/platform/home.ts`
- Create: `src/__tests__/platform/home.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/platform/home.test.ts`:

```typescript
import { describe, expect, test } from "bun:test"
import { resolveHome } from "../../platform/home.ts"

describe("resolveHome", () => {
  test("returns a non-empty string", () => {
    const home = resolveHome()
    expect(typeof home).toBe("string")
    expect(home.length).toBeGreaterThan(0)
  })

  test("does not end with a path separator", () => {
    const home = resolveHome()
    expect(home.endsWith("/")).toBe(false)
    expect(home.endsWith("\\")).toBe(false)
  })

  test("returns the same value on repeated calls", () => {
    expect(resolveHome()).toBe(resolveHome())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/platform/home.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `src/platform/home.ts`:

```typescript
import { homedir } from "os"

export function resolveHome(): string {
  return homedir()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/__tests__/platform/home.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/platform/home.ts src/__tests__/platform/home.test.ts
git commit -m "feat: add resolveHome() cross-platform helper"
```

---

### Task 3: Create `src/platform/detect.ts` — host OS detection + shared parser

**Files:**
- Create: `src/platform/detect.ts`
- Create: `src/__tests__/platform/detect.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/platform/detect.test.ts`:

```typescript
import { describe, expect, test } from "bun:test"
import { parseOsRelease, isVersionAtLeast, detectHostPlatform } from "../../platform/detect.ts"
import type { HostPlatform } from "../../types.ts"

describe("parseOsRelease", () => {
  test("parses valid Ubuntu 24.04", () => {
    const result = parseOsRelease("ubuntu|24.04|noble")
    expect(result).toEqual({ distro: "ubuntu", version: "24.04", codename: "noble" })
  })

  test("parses valid Ubuntu 22.04", () => {
    const result = parseOsRelease("ubuntu|22.04|jammy")
    expect(result).toEqual({ distro: "ubuntu", version: "22.04", codename: "jammy" })
  })

  test("parses Debian", () => {
    const result = parseOsRelease("debian|12|bookworm")
    expect(result).toEqual({ distro: "debian", version: "12", codename: "bookworm" })
  })

  test("returns null fields for malformed input", () => {
    const result = parseOsRelease("garbage")
    expect(result).toEqual({ distro: "garbage", version: "", codename: "" })
  })

  test("handles empty string", () => {
    const result = parseOsRelease("")
    expect(result).toEqual({ distro: "", version: "", codename: "" })
  })

  test("handles pipe-only string", () => {
    const result = parseOsRelease("||")
    expect(result).toEqual({ distro: "", version: "", codename: "" })
  })
})

describe("isVersionAtLeast", () => {
  test("22.04 meets 22.04", () => {
    expect(isVersionAtLeast("22.04", 22, 4)).toBe(true)
  })

  test("24.04 meets 22.04", () => {
    expect(isVersionAtLeast("24.04", 22, 4)).toBe(true)
  })

  test("20.04 does not meet 22.04", () => {
    expect(isVersionAtLeast("20.04", 22, 4)).toBe(false)
  })

  test("22.03 does not meet 22.04", () => {
    expect(isVersionAtLeast("22.03", 22, 4)).toBe(false)
  })

  test("23.10 meets 22.04", () => {
    expect(isVersionAtLeast("23.10", 22, 4)).toBe(true)
  })

  test("handles major-only version string", () => {
    expect(isVersionAtLeast("24", 22, 4)).toBe(true)
  })

  test("returns false for empty string", () => {
    expect(isVersionAtLeast("", 22, 4)).toBe(false)
  })
})

describe("detectHostPlatform", () => {
  test("returns a valid HostPlatform object", async () => {
    const platform = await detectHostPlatform()
    expect(["linux", "macos", "windows"]).toContain(platform.os)
    expect(typeof platform.isCompatibleTarget).toBe("boolean")
  })

  test("on Linux, populates distro and version", async () => {
    const platform = await detectHostPlatform()
    if (platform.os === "linux") {
      expect(platform.distro).not.toBeNull()
      expect(platform.version).not.toBeNull()
    }
  })

  test("on non-Linux, distro and version are null", async () => {
    const platform = await detectHostPlatform()
    if (platform.os !== "linux") {
      expect(platform.distro).toBeNull()
      expect(platform.version).toBeNull()
      expect(platform.codename).toBeNull()
      expect(platform.isCompatibleTarget).toBe(false)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/platform/detect.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `src/platform/detect.ts`:

```typescript
import type { HostPlatform } from "../types.ts"
import { spawnProcess } from "../ssh/process.ts"

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/__tests__/platform/detect.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/platform/detect.ts src/__tests__/platform/detect.test.ts
git commit -m "feat: add host platform detection and shared OS parser"
```

---

### Task 4: Create `src/platform/capabilities.ts` — command availability + auto-install

**Files:**
- Create: `src/platform/capabilities.ts`
- Create: `src/__tests__/platform/capabilities.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/platform/capabilities.test.ts`:

```typescript
import { describe, expect, test } from "bun:test"
import { commandExists, detectCapabilities, getInstallCommand } from "../../platform/capabilities.ts"
import type { HostPlatform } from "../../types.ts"

const linuxPlatform: HostPlatform = {
  os: "linux",
  distro: "ubuntu",
  version: "24.04",
  codename: "noble",
  isCompatibleTarget: true,
}

const macosPlatform: HostPlatform = {
  os: "macos",
  distro: null,
  version: null,
  codename: null,
  isCompatibleTarget: false,
}

const windowsPlatform: HostPlatform = {
  os: "windows",
  distro: null,
  version: null,
  codename: null,
  isCompatibleTarget: false,
}

describe("commandExists", () => {
  test("returns true for a command that exists (bash)", async () => {
    const result = await commandExists("bash", linuxPlatform)
    expect(result).toBe(true)
  })

  test("returns false for a command that does not exist", async () => {
    const result = await commandExists("definitely-not-a-real-command-xyz", linuxPlatform)
    expect(result).toBe(false)
  })
})

describe("detectCapabilities", () => {
  test("returns an object with all required fields", async () => {
    const caps = await detectCapabilities(linuxPlatform)
    expect(typeof caps.ssh).toBe("boolean")
    expect(typeof caps.sshCopyId).toBe("boolean")
    expect(typeof caps.sshpass).toBe("boolean")
    expect(typeof caps.sshKeygen).toBe("boolean")
    expect(typeof caps.sshKeyscan).toBe("boolean")
  })

  test("ssh is typically available on Linux", async () => {
    const caps = await detectCapabilities(linuxPlatform)
    expect(caps.ssh).toBe(true)
  })
})

describe("getInstallCommand", () => {
  test("returns apt command for ssh on Linux", () => {
    const cmd = getInstallCommand("ssh", linuxPlatform)
    expect(cmd).toBe("sudo apt install openssh-client")
  })

  test("returns null for ssh on macOS (already included)", () => {
    const cmd = getInstallCommand("ssh", macosPlatform)
    expect(cmd).toBeNull()
  })

  test("returns null for ssh on Windows (manual install)", () => {
    const cmd = getInstallCommand("ssh", windowsPlatform)
    expect(cmd).toBeNull()
  })

  test("returns apt command for sshpass on Linux", () => {
    const cmd = getInstallCommand("sshpass", linuxPlatform)
    expect(cmd).toBe("sudo apt install sshpass")
  })

  test("returns null for sshpass on macOS (not in default brew)", () => {
    const cmd = getInstallCommand("sshpass", macosPlatform)
    expect(cmd).toBeNull()
  })

  test("returns null for sshpass on Windows (does not exist)", () => {
    const cmd = getInstallCommand("sshpass", windowsPlatform)
    expect(cmd).toBeNull()
  })

  test("returns brew command for ssh-copy-id on macOS", () => {
    const cmd = getInstallCommand("ssh-copy-id", macosPlatform)
    expect(cmd).toBe("brew install ssh-copy-id")
  })

  test("returns null for ssh-copy-id on Windows (TS fallback used)", () => {
    const cmd = getInstallCommand("ssh-copy-id", windowsPlatform)
    expect(cmd).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/platform/capabilities.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `src/platform/capabilities.ts`:

```typescript
import type { HostCapabilities, HostPlatform } from "../types.ts"

export async function commandExists(cmd: string, platform: HostPlatform): Promise<boolean> {
  const lookup = platform.os === "windows" ? ["where.exe", cmd] : ["which", cmd]
  try {
    const proc = Bun.spawn(lookup, { stdout: "pipe", stderr: "pipe" })
    await proc.exited
    return proc.exitCode === 0
  } catch {
    return false
  }
}

export async function detectCapabilities(platform: HostPlatform): Promise<HostCapabilities> {
  const [ssh, sshCopyId, sshpass, sshKeygen, sshKeyscan] = await Promise.all([
    commandExists("ssh", platform),
    commandExists("ssh-copy-id", platform),
    commandExists("sshpass", platform),
    commandExists("ssh-keygen", platform),
    commandExists("ssh-keyscan", platform),
  ])
  return { ssh, sshCopyId, sshpass, sshKeygen, sshKeyscan }
}

type InstallableCommand = "ssh" | "ssh-copy-id" | "sshpass" | "ssh-keygen" | "ssh-keyscan"

export function getInstallCommand(cmd: InstallableCommand, platform: HostPlatform): string | null {
  const matrix: Record<InstallableCommand, Record<"linux" | "macos" | "windows", string | null>> = {
    ssh: {
      linux: "sudo apt install openssh-client",
      macos: null,
      windows: null,
    },
    "ssh-copy-id": {
      linux: "sudo apt install openssh-client",
      macos: "brew install ssh-copy-id",
      windows: null,
    },
    sshpass: {
      linux: "sudo apt install sshpass",
      macos: null,
      windows: null,
    },
    "ssh-keygen": {
      linux: "sudo apt install openssh-client",
      macos: null,
      windows: null,
    },
    "ssh-keyscan": {
      linux: "sudo apt install openssh-client",
      macos: null,
      windows: null,
    },
  }
  return matrix[cmd]?.[platform.os] ?? null
}

export function getManualInstallHint(cmd: InstallableCommand, platform: HostPlatform): string | null {
  if (cmd === "ssh" && platform.os === "windows") {
    return "Install OpenSSH Client: Settings > Apps > Optional Features > OpenSSH Client"
  }
  if (cmd === "sshpass" && platform.os === "macos") {
    return "sshpass is not in the default Homebrew repository. Install manually: brew install esolitos/ipa/sshpass"
  }
  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/__tests__/platform/capabilities.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/platform/capabilities.ts src/__tests__/platform/capabilities.test.ts
git commit -m "feat: add host capabilities detection and install helpers"
```

---

### Task 5: Add `ensureCapabilities()` — auto-install prompts

**Files:**
- Modify: `src/platform/capabilities.ts`
- Create: `src/__tests__/platform/ensure-capabilities.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/platform/ensure-capabilities.test.ts`:

```typescript
import { describe, expect, test } from "bun:test"
import { getInstallCommand, getManualInstallHint } from "../../platform/capabilities.ts"
import type { HostCapabilities, HostPlatform } from "../../types.ts"

const linuxPlatform: HostPlatform = {
  os: "linux", distro: "ubuntu", version: "24.04", codename: "noble", isCompatibleTarget: true,
}

const windowsPlatform: HostPlatform = {
  os: "windows", distro: null, version: null, codename: null, isCompatibleTarget: false,
}

describe("getInstallCommand", () => {
  test("returns apt command for ssh on Linux", () => {
    expect(getInstallCommand("ssh", linuxPlatform)).toBe("sudo apt install openssh-client")
  })

  test("returns null for sshpass on macOS (not in default brew)", () => {
    const macos: HostPlatform = { os: "macos", distro: null, version: null, codename: null, isCompatibleTarget: false }
    expect(getInstallCommand("sshpass", macos)).toBeNull()
  })

  test("returns null for ssh-copy-id on Windows", () => {
    expect(getInstallCommand("ssh-copy-id", windowsPlatform)).toBeNull()
  })
})

describe("getManualInstallHint", () => {
  test("returns Windows SSH install hint", () => {
    const hint = getManualInstallHint("ssh", windowsPlatform)
    expect(hint).toContain("Settings")
    expect(hint).toContain("OpenSSH")
  })

  test("returns macOS sshpass hint about third-party tap", () => {
    const macos: HostPlatform = { os: "macos", distro: null, version: null, codename: null, isCompatibleTarget: false }
    const hint = getManualInstallHint("sshpass", macos)
    expect(hint).toContain("esolitos")
  })

  test("returns null when no hint available", () => {
    expect(getManualInstallHint("ssh", linuxPlatform)).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they pass (functions already exist from Task 4)**

Run: `bun test src/__tests__/platform/ensure-capabilities.test.ts`
Expected: PASS

- [ ] **Step 3: Add `ensureCapabilities()` to `src/platform/capabilities.ts`**

Add to the end of `src/platform/capabilities.ts`:

```typescript
import * as p from "@clack/prompts"
import pc from "picocolors"
import { spawnProcess } from "../ssh/process.ts"

export async function ensureCapabilities(
  platform: HostPlatform,
  capabilities: HostCapabilities,
): Promise<void> {
  if (!capabilities.ssh) {
    const installCmd = getInstallCommand("ssh", platform)
    const hint = getManualInstallHint("ssh", platform)

    if (installCmd) {
      const install = await p.confirm({
        message: `ssh is not installed. Install it now? (${installCmd})`,
      })
      if (p.isCancel(install) || !install) {
        p.log.error(pc.red("SSH client is required for remote mode. Exiting."))
        process.exit(1)
      }
      const result = await spawnProcess(installCmd.split(" "))
      if (result.exitCode !== 0) {
        p.log.error(pc.red(`Installation failed: ${result.stderr}`))
        process.exit(1)
      }
      capabilities.ssh = true
    } else {
      p.log.error(
        `${pc.red("SSH client is required but is not installed.")}\n` +
          (hint ? `  ${pc.dim(hint)}` : `  ${pc.dim("Please install an SSH client manually.")}`),
      )
      process.exit(1)
    }
  }

  if (!capabilities.sshpass) {
    p.log.info(pc.dim("sshpass not found — password authentication will not be available."))
  }

  if (!capabilities.sshCopyId) {
    p.log.info(pc.dim("ssh-copy-id not found — will use built-in fallback if needed."))
  }

  if (!capabilities.sshKeyscan) {
    p.log.warning(pc.yellow("ssh-keyscan not found — host key verification will be unavailable."))
  }

  if (!capabilities.sshKeygen) {
    p.log.warning(pc.yellow("ssh-keygen not found — key generation and fingerprint display unavailable."))
  }
}
```

- [ ] **Step 4: Export `ensureCapabilities` from `src/platform/index.ts`**

Add to the capabilities export line:
```typescript
export { commandExists, detectCapabilities, ensureCapabilities, getInstallCommand, getManualInstallHint } from "./capabilities.ts"
```

- [ ] **Step 5: Run tests**

Run: `bun test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/platform/capabilities.ts src/platform/index.ts src/__tests__/platform/ensure-capabilities.test.ts
git commit -m "feat: add ensureCapabilities() with auto-install prompts"
```

---

### Task 6: Create `src/platform/ssh-copy.ts` — TS fallback for `ssh-copy-id`

**Files:**
- Create: `src/platform/ssh-copy.ts`
- Create: `src/__tests__/platform/ssh-copy.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/platform/ssh-copy.test.ts`:

```typescript
import { describe, expect, test } from "bun:test"
import { copyKeyViaClient } from "../../platform/ssh-copy.ts"
import { MockSystemClient } from "../helpers/mock-ssh.ts"

describe("copyKeyViaClient", () => {
  test("creates .ssh directory with correct permissions", async () => {
    const client = new MockSystemClient()
    client.onExec("mkdir -p", { exitCode: 0 })
    client.onExec("grep", { stdout: "missing" })
    client.onExec("tee -a", { exitCode: 0 })
    client.onExec("chmod 600", { exitCode: 0 })

    await copyKeyViaClient(client, "ssh-ed25519 AAAA testkey", "deploy")
    expect(client.hasCommand("mkdir -p /home/deploy/.ssh")).toBe(true)
    expect(client.hasCommand("chmod 700")).toBe(true)
  })

  test("skips injection if key already exists", async () => {
    const client = new MockSystemClient()
    client.onExec("mkdir -p", { exitCode: 0 })
    client.onExec("grep", { stdout: "found" })

    const result = await copyKeyViaClient(client, "ssh-ed25519 AAAA testkey", "deploy")
    expect(result.success).toBe(true)
    expect(client.hasCommand("tee")).toBe(false)
  })

  test("appends key to authorized_keys", async () => {
    const client = new MockSystemClient()
    client.onExec("mkdir -p", { exitCode: 0 })
    client.onExec("grep", { stdout: "missing" })
    client.onExec("tee -a", { exitCode: 0 })
    client.onExec("chmod 600", { exitCode: 0 })

    const result = await copyKeyViaClient(client, "ssh-ed25519 AAAA testkey", "deploy")
    expect(result.success).toBe(true)
    expect(client.hasCommand("tee -a")).toBe(true)
  })

  test("returns failure if mkdir fails", async () => {
    const client = new MockSystemClient()
    client.onExec("mkdir -p", { exitCode: 1, stderr: "permission denied" })

    const result = await copyKeyViaClient(client, "ssh-ed25519 AAAA testkey", "deploy")
    expect(result.success).toBe(false)
  })

  test("returns failure if append fails", async () => {
    const client = new MockSystemClient()
    client.onExec("mkdir -p", { exitCode: 0 })
    client.onExec("grep", { stdout: "missing" })
    client.onExec("tee -a", { exitCode: 1, stderr: "disk full" })

    const result = await copyKeyViaClient(client, "ssh-ed25519 AAAA testkey", "deploy")
    expect(result.success).toBe(false)
  })

  test("uses /root for root user", async () => {
    const client = new MockSystemClient()
    client.onExec("mkdir -p", { exitCode: 0 })
    client.onExec("grep", { stdout: "missing" })
    client.onExec("tee -a", { exitCode: 0 })
    client.onExec("chmod 600", { exitCode: 0 })

    await copyKeyViaClient(client, "ssh-ed25519 AAAA testkey", "root")
    expect(client.hasCommand("/root/.ssh")).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/platform/ssh-copy.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `src/platform/ssh-copy.ts`:

```typescript
import type { CopyKeyResult } from "../ssh/copy-key.ts"
import type { SystemClient } from "../types.ts"

export async function copyKeyViaClient(
  client: SystemClient,
  pubKeyContent: string,
  targetUser: string,
): Promise<CopyKeyResult> {
  const targetHome = targetUser === "root" ? "/root" : `/home/${targetUser}`
  const sshDir = `${targetHome}/.ssh`
  const authKeysPath = `${sshDir}/authorized_keys`

  const mkdirResult = await client.exec(`mkdir -p ${sshDir} && chmod 700 ${sshDir}`)
  if (mkdirResult.exitCode !== 0) {
    return { success: false, passwordAuthDisabled: false }
  }

  const grepResult = await client.execWithStdin(
    `grep -qxF -f /dev/stdin '${authKeysPath}' 2>/dev/null && echo found || echo missing`,
    pubKeyContent,
  )
  if (grepResult.stdout.includes("found")) {
    return { success: true, passwordAuthDisabled: false }
  }

  const appendResult = await client.execWithStdin(`tee -a '${authKeysPath}' > /dev/null`, `${pubKeyContent}\n`)
  if (appendResult.exitCode !== 0) {
    return { success: false, passwordAuthDisabled: false }
  }

  await client.exec(`chmod 600 '${authKeysPath}' && chown ${targetUser}:${targetUser} '${authKeysPath}'`)

  return { success: true, passwordAuthDisabled: false }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/__tests__/platform/ssh-copy.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/platform/ssh-copy.ts src/__tests__/platform/ssh-copy.test.ts
git commit -m "feat: add TS fallback for ssh-copy-id via SystemClient"
```

---

### Task 7: Create `src/platform/index.ts` and run full test suite

**Files:**
- Create: `src/platform/index.ts`

- [ ] **Step 1: Create the re-export barrel**

Create `src/platform/index.ts`:

```typescript
export { resolveHome } from "./home.ts"
export { detectHostPlatform, isVersionAtLeast, parseOsRelease } from "./detect.ts"
export { commandExists, detectCapabilities, getInstallCommand, getManualInstallHint } from "./capabilities.ts"
export { copyKeyViaClient } from "./ssh-copy.ts"
```

- [ ] **Step 2: Run full test suite to verify nothing is broken**

Run: `bun test`
Expected: All existing 278+ tests PASS, plus new platform tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/platform/index.ts
git commit -m "feat: add platform module barrel export"
```

---

### Task 8: Migrate `process.env.HOME` to `resolveHome()` in `src/ssh/detect.ts`

**Files:**
- Modify: `src/ssh/detect.ts`
- Modify: `src/__tests__/ssh/detect.test.ts`

- [ ] **Step 1: Update `src/ssh/detect.ts`**

Replace the import section (line 1) to add `resolveHome`:

```typescript
import { existsSync } from "fs"
import { resolveHome } from "../platform/home.ts"
import type { ServerInfo, SystemClient } from "../types.ts"
```

Replace all three `const home = process.env.HOME ?? ""` (lines 10, 30, 43) with:

```typescript
const home = resolveHome()
```

Also refactor `detectServerInfo` (lines 55-84) to use the shared `parseOsRelease` and `isVersionAtLeast`:

```typescript
import { isVersionAtLeast, parseOsRelease } from "../platform/detect.ts"
```

Replace lines 56-72 of `detectServerInfo` with:

```typescript
export async function detectServerInfo(client: SystemClient): Promise<ServerInfo> {
  const osResult = await client.exec('. /etc/os-release && echo "$ID|$VERSION_ID|$VERSION_CODENAME"')
  if (osResult.exitCode !== 0) {
    throw new Error(`Failed to detect OS: ${osResult.stderr}`)
  }

  const { distro, version, codename } = parseOsRelease(osResult.stdout)
  if (distro !== "ubuntu") {
    throw new Error(`Unsupported OS: ${distro || "unknown"}. SecurBuntu only supports Ubuntu.`)
  }
  if (!isVersionAtLeast(version, 22, 4)) {
    throw new Error(`Ubuntu ${version} is not supported. Minimum required: 22.04`)
  }

  const socketResult = await client.exec("systemctl is-active ssh.socket 2>/dev/null || true")
  const cloudInitResult = await client.exec("test -f /etc/ssh/sshd_config.d/50-cloud-init.conf && echo yes || echo no")

  return {
    ubuntuVersion: version,
    ubuntuCodename: codename,
    usesSocketActivation: socketResult.stdout === "active",
    hasCloudInit: cloudInitResult.stdout === "yes",
    isRoot: client.isRoot,
  }
}
```

- [ ] **Step 2: Update detect tests to not rely on `process.env.HOME`**

In `src/__tests__/ssh/detect.test.ts`, the tests for `detectAllLocalKeys`, `detectDefaultKeyPath`, and `detectDefaultPubKeyPath` set `process.env.HOME = ""` to test edge cases. These tests still work because `resolveHome()` uses `os.homedir()` which doesn't depend on `process.env.HOME`. However, the "returns empty when HOME is unset" tests will no longer trigger the empty-home path since `os.homedir()` always returns something.

Update the `detectAllLocalKeys` test "returns empty array when HOME is unset" (line 17-20):
Remove this test — `resolveHome()` always returns a valid directory. The function no longer has an empty-home code path.

Update the `detectDefaultKeyPath` test "returns undefined when HOME is empty" (line 94-100):
Remove this test — same reason.

Update the `detectDefaultPubKeyPath` test "returns undefined when HOME is empty" (line 132-135):
Remove this test — same reason.

Remove all `const originalHome = process.env.HOME` and `afterEach` blocks that restore `process.env.HOME` — no longer needed.

- [ ] **Step 3: Run detect tests**

Run: `bun test src/__tests__/ssh/detect.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/ssh/detect.ts src/__tests__/ssh/detect.test.ts
git commit -m "refactor: migrate ssh/detect.ts to resolveHome() and shared parser"
```

---

### Task 9: Migrate `process.env.HOME` in `src/ssh/host-keys.ts`

**Files:**
- Modify: `src/ssh/host-keys.ts`

- [ ] **Step 1: Update the imports**

Replace line 1 of `src/ssh/host-keys.ts`:

```typescript
import { appendFileSync, existsSync, mkdirSync } from "fs"
import { resolveHome } from "../platform/home.ts"
```

- [ ] **Step 2: Replace `process.env.HOME` usages**

In `fetchHostKeyFingerprint` (line 9), replace:
```typescript
const home = process.env.HOME ?? ""
```
with:
```typescript
const home = resolveHome()
```

In `addToKnownHosts` (line 56), replace:
```typescript
const home = process.env.HOME ?? ""
```
with:
```typescript
const home = resolveHome()
```

- [ ] **Step 3: Run tests**

Run: `bun test`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/ssh/host-keys.ts
git commit -m "refactor: migrate ssh/host-keys.ts to resolveHome()"
```

---

### Task 10: Migrate `process.env.HOME` in prompts

**Files:**
- Modify: `src/prompts/connection.ts`
- Modify: `src/prompts/hardening.ts`

- [ ] **Step 1: Update `src/prompts/connection.ts`**

Add import at the top:
```typescript
import { resolveHome } from "../platform/home.ts"
```

Replace both `process.env.HOME ?? ""` occurrences (lines 22, 28):

Line 22: `const resolved = value.replace("~", resolveHome())`
Line 28: `return keyPath.replace("~", resolveHome())`

- [ ] **Step 2: Update `src/prompts/hardening.ts`**

Add import at the top:
```typescript
import { resolveHome } from "../platform/home.ts"
```

Replace both `process.env.HOME ?? ""` occurrences (lines 70, 78):

Line 70: `const resolved = value.replace("~", resolveHome())`
Line 78: `options.personalKeyPath = pubKeyPath.replace("~", resolveHome())`

- [ ] **Step 3: Run tests**

Run: `bun test`
Expected: All tests PASS

- [ ] **Step 4: Verify no `process.env.HOME` remain in source code**

Run: `grep -r "process.env.HOME" src/ --include="*.ts" | grep -v __tests__`
Expected: No results (all migrated)

- [ ] **Step 5: Commit**

```bash
git add src/prompts/connection.ts src/prompts/hardening.ts
git commit -m "refactor: migrate prompts to resolveHome()"
```

---

### Task 11: Update `src/ssh/connection.ts` — conditional ControlMaster on Windows

**Files:**
- Modify: `src/ssh/connection.ts`
- Modify: `src/__tests__/ssh/connection.test.ts`

- [ ] **Step 1: Write failing tests for Windows ControlMaster skip**

Add to `src/__tests__/ssh/connection.test.ts` after the existing `buildSshArgs` describe block:

```typescript
import type { HostPlatform } from "../../types.ts"

const linuxPlatform: HostPlatform = {
  os: "linux", distro: "ubuntu", version: "24.04", codename: "noble", isCompatibleTarget: true,
}

const windowsPlatform: HostPlatform = {
  os: "windows", distro: null, version: null, codename: null, isCompatibleTarget: false,
}

describe("buildSshArgs with platform", () => {
  const config: ConnectionConfig = {
    host: "example.com",
    port: 22,
    username: "root",
    authMethod: "key",
    privateKeyPath: "/home/user/.ssh/id_ed25519",
    controlPath: "/tmp/securbuntu-abc123",
  }

  test("includes ControlPath on Linux", () => {
    const args = buildSshArgs(config, linuxPlatform)
    expect(args.some(a => a.includes("ControlPath"))).toBe(true)
  })

  test("excludes ControlPath on Windows", () => {
    const args = buildSshArgs(config, windowsPlatform)
    expect(args.some(a => a.includes("ControlPath"))).toBe(false)
  })

  test("still includes StrictHostKeyChecking on Windows", () => {
    const args = buildSshArgs(config, windowsPlatform)
    expect(args).toContain("StrictHostKeyChecking=yes")
  })

  test("still includes port on Windows", () => {
    const args = buildSshArgs(config, windowsPlatform)
    expect(args).toContain("22")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/__tests__/ssh/connection.test.ts`
Expected: FAIL — `buildSshArgs` doesn't accept a second argument yet

- [ ] **Step 3: Update `buildSshArgs` to accept `HostPlatform`**

In `src/ssh/connection.ts`, update the import and function signature:

```typescript
import type { CommandResult, ConnectionConfig, ExecOptions, HostPlatform, SystemClient } from "../types.ts"
```

Change `buildSshArgs` (line 14-31):

```typescript
export function buildSshArgs(config: ConnectionConfig, platform: HostPlatform): string[] {
  const args: string[] = [
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    "ConnectTimeout=10",
    "-p",
    String(config.port),
  ]

  if (platform.os !== "windows" && config.controlPath) {
    args.unshift("-o", `ControlPath=${config.controlPath}`)
  }

  if (config.authMethod === "key" && config.privateKeyPath) {
    args.push("-i", config.privateKeyPath)
  }

  return args
}
```

- [ ] **Step 4: Update `connect()` to accept and use `HostPlatform`**

Change the signature of `connect` (line 33):

```typescript
export async function connect(config: ConnectionConfig, platform: HostPlatform): Promise<SystemClient> {
```

Conditionally set up ControlMaster. Replace lines 34-53:

```typescript
  const controlPath = platform.os !== "windows" ? hashControlPath(config.username, config.host, config.port) : ""
  const fullConfig: ConnectionConfig = { ...config, controlPath }

  let result: CommandResult
  if (platform.os === "windows") {
    // No ControlMaster on Windows — connect directly for the initial check
    const checkArgs = [...buildSshArgs(fullConfig, platform), `${fullConfig.username}@${fullConfig.host}`, "true"]
    if (fullConfig.authMethod === "password" && fullConfig.password) {
      result = await spawnSshpass(fullConfig.password, checkArgs)
    } else {
      result = await spawnSsh(checkArgs)
    }
  } else {
    const masterArgs = [
      ...buildSshArgs(fullConfig, platform),
      "-o", "ControlMaster=yes",
      "-o", "ControlPersist=600",
      "-N", "-f",
      `${fullConfig.username}@${fullConfig.host}`,
    ]
    if (fullConfig.authMethod === "password" && fullConfig.password) {
      result = await spawnSshpass(fullConfig.password, masterArgs)
    } else {
      result = await spawnSsh(masterArgs)
    }
  }

  if (result.exitCode !== 0) {
    throw new Error(`SSH connection failed: ${result.stderr}`)
  }
```

Update the cleanup function to be a no-op on Windows (replace lines 59-68):

```typescript
  const cleanup = () => {
    if (platform.os === "windows") return
    try {
      Bun.spawnSync(
        ["ssh", "-o", `ControlPath=${controlPath}`, "-O", "exit", `${fullConfig.username}@${fullConfig.host}`],
        { stdout: "ignore", stderr: "ignore" },
      )
    } catch {
      // Best-effort cleanup
    }
  }
```

Update execArgs to conditionally include ControlPath (replace lines 77-83):

```typescript
  const execArgs = platform.os !== "windows"
    ? ["-o", `ControlPath=${controlPath}`, "-o", "ControlMaster=no", `${fullConfig.username}@${fullConfig.host}`]
    : [
        "-o", "StrictHostKeyChecking=yes",
        "-o", "ConnectTimeout=10",
        "-p", String(fullConfig.port),
        ...(fullConfig.authMethod === "key" && fullConfig.privateKeyPath ? ["-i", fullConfig.privateKeyPath] : []),
        `${fullConfig.username}@${fullConfig.host}`,
      ]
```

- [ ] **Step 5: Update existing `buildSshArgs` tests to pass platform**

In `src/__tests__/ssh/connection.test.ts`, update the existing `buildSshArgs` describe block. All existing calls to `buildSshArgs(config)` become `buildSshArgs(config, linuxPlatform)` to preserve existing behavior:

Add at the top of the file after the imports:

```typescript
import type { HostPlatform } from "../../types.ts"

const linuxPlatform: HostPlatform = {
  os: "linux", distro: "ubuntu", version: "24.04", codename: "noble", isCompatibleTarget: true,
}
```

Then update each `buildSshArgs(baseConfig)` call to `buildSshArgs(baseConfig, linuxPlatform)`, and each `buildSshArgs(config)` to `buildSshArgs(config, linuxPlatform)`.

- [ ] **Step 6: Run tests**

Run: `bun test src/__tests__/ssh/connection.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/ssh/connection.ts src/__tests__/ssh/connection.test.ts
git commit -m "feat: conditional ControlMaster/ControlPath based on host OS"
```

---

### Task 12: Update `src/ssh/host-keys.ts` — Windows temp file + capability gating

**Files:**
- Modify: `src/ssh/host-keys.ts`
- Create: `src/__tests__/ssh/host-keys.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/ssh/host-keys.test.ts`:

```typescript
import { describe, expect, test } from "bun:test"
import { fetchHostKeyFingerprint } from "../../ssh/host-keys.ts"
import type { HostCapabilities, HostPlatform } from "../../types.ts"

const linuxPlatform: HostPlatform = {
  os: "linux", distro: "ubuntu", version: "24.04", codename: "noble", isCompatibleTarget: true,
}

const fullCapabilities: HostCapabilities = {
  ssh: true, sshCopyId: true, sshpass: true, sshKeygen: true, sshKeyscan: true,
}

const noKeyscanCapabilities: HostCapabilities = {
  ssh: true, sshCopyId: true, sshpass: true, sshKeygen: true, sshKeyscan: false,
}

describe("fetchHostKeyFingerprint", () => {
  test("returns a result object", async () => {
    const result = await fetchHostKeyFingerprint("localhost", 22, linuxPlatform, fullCapabilities)
    expect(result).toBeDefined()
    expect("known" in result).toBe(true)
  })

  test("skips verification when ssh-keyscan is unavailable", async () => {
    const result = await fetchHostKeyFingerprint("localhost", 22, linuxPlatform, noKeyscanCapabilities)
    expect(result).toEqual({ known: false, fingerprint: null, rawKeys: "" })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/__tests__/ssh/host-keys.test.ts`
Expected: FAIL — wrong number of arguments

- [ ] **Step 3: Update `fetchHostKeyFingerprint`**

In `src/ssh/host-keys.ts`, update the imports:

```typescript
import { appendFileSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { resolveHome } from "../platform/home.ts"
import type { HostCapabilities, HostPlatform } from "../types.ts"
```

Update `fetchHostKeyFingerprint` signature and add capability/platform handling:

```typescript
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
  const knownHostsPath = join(home, ".ssh", "known_hosts")

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

  const keyscanProc = Bun.spawn(["ssh-keyscan", "-T", "5", "-p", String(port), host], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const keyscanOutput = await new Response(keyscanProc.stdout).text()
  await keyscanProc.exited

  if (!keyscanOutput.trim()) {
    return { known: false, fingerprint: null, rawKeys: "" }
  }

  if (!capabilities.sshKeygen) {
    return { known: false, fingerprint: null, rawKeys: keyscanOutput.trim() }
  }

  let fingerprintOutput: string
  if (platform.os === "windows") {
    const tempFile = join(tmpdir(), `securbuntu-hostkey-${Date.now()}.tmp`)
    try {
      writeFileSync(tempFile, keyscanOutput)
      const fingerprintProc = Bun.spawn(["ssh-keygen", "-lf", tempFile], {
        stdout: "pipe",
        stderr: "pipe",
      })
      fingerprintOutput = await new Response(fingerprintProc.stdout).text()
      await fingerprintProc.exited
    } finally {
      try { unlinkSync(tempFile) } catch { /* best effort */ }
    }
  } else {
    const fingerprintProc = Bun.spawn(["ssh-keygen", "-lf", "/dev/stdin"], {
      stdin: Buffer.from(keyscanOutput),
      stdout: "pipe",
      stderr: "pipe",
    })
    fingerprintOutput = await new Response(fingerprintProc.stdout).text()
    await fingerprintProc.exited
  }

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
```

- [ ] **Step 4: Run tests**

Run: `bun test src/__tests__/ssh/host-keys.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ssh/host-keys.ts src/__tests__/ssh/host-keys.test.ts
git commit -m "feat: cross-platform host key verification with capability gating"
```

---

### Task 13: Update `src/ssh/copy-key.ts` — remove old checks, update re-exports

**Files:**
- Modify: `src/ssh/copy-key.ts`
- Modify: `src/ssh/index.ts`
- Modify: `src/__tests__/ssh/copy-key.test.ts`

- [ ] **Step 1: Remove `checkSshpassInstalled` and `checkSshCopyIdInstalled` from `src/ssh/copy-key.ts`**

Keep only the `CopyKeyResult` interface and `copyKeyToServer` function. Remove lines 6-30 entirely (both `check*` functions).

- [ ] **Step 2: Update `src/ssh/index.ts` to remove old exports**

Replace line 3:
```typescript
export { checkSshCopyIdInstalled, checkSshpassInstalled, copyKeyToServer } from "./copy-key.ts"
```
with:
```typescript
export { copyKeyToServer } from "./copy-key.ts"
```

Also update the `fetchHostKeyFingerprint` export — it now needs `HostPlatform` and `HostCapabilities` in its callers but the export itself stays the same.

- [ ] **Step 3: Update `src/__tests__/ssh/copy-key.test.ts`**

Remove the tests for `checkSshpassInstalled` and `checkSshCopyIdInstalled` (the whole file's tests are about these functions). Replace with a test for `copyKeyToServer`:

```typescript
import { describe, expect, test } from "bun:test"
import type { CopyKeyResult } from "../../ssh/copy-key.ts"

describe("CopyKeyResult type", () => {
  test("has expected shape", () => {
    const result: CopyKeyResult = { success: true, passwordAuthDisabled: false }
    expect(result.success).toBe(true)
    expect(result.passwordAuthDisabled).toBe(false)
  })
})
```

- [ ] **Step 4: Run tests**

Run: `bun test`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/ssh/copy-key.ts src/ssh/index.ts src/__tests__/ssh/copy-key.test.ts
git commit -m "refactor: remove old check functions, use capabilities instead"
```

---

### Task 14: Update `src/connection/mode.ts` — accept platform, gate local mode

**Files:**
- Modify: `src/connection/mode.ts`
- Modify: `src/connection/index.ts`
- Modify: `src/__tests__/connection/mode.test.ts`

- [ ] **Step 1: Update `src/connection/mode.ts`**

Replace the full file:

```typescript
import * as p from "@clack/prompts"
import pc from "picocolors"
import { detectCapabilities, ensureCapabilities } from "../platform/capabilities.ts"
import { LocalClient } from "../local/index.ts"
import { spawnProcess } from "../ssh/process.ts"
import type { ConnectionResult, HostPlatform } from "../types.ts"
import { connectWithRetry } from "./retry-loop.ts"

async function setupLocalClient(): Promise<ConnectionResult> {
  const isRoot = process.getuid?.() === 0
  const username = process.env.USER ?? "unknown"
  let sudoPassword: string | undefined

  if (!isRoot) {
    const sudoCheck = await spawnProcess(["bash", "-c", "sudo -n true 2>&1"])
    if (sudoCheck.exitCode !== 0) {
      const pw = await p.password({
        message: "Enter your sudo password",
        validate(value) {
          if (!value) return "Password is required"
          return undefined
        },
      })

      if (p.isCancel(pw)) {
        throw new Error("Cancelled")
      }

      const validateResult = await spawnProcess(["bash", "-c", "sudo -S -p '' true 2>&1"], `${pw}\n`)
      if (validateResult.exitCode !== 0) {
        throw new Error("Invalid sudo password or user is not in sudoers.")
      }

      sudoPassword = pw
    }
  }

  return {
    client: sudoPassword ? new LocalClient(sudoPassword) : new LocalClient(undefined, !isRoot),
    mode: "local",
    host: "localhost",
    username,
  }
}

export async function selectMode(platform: HostPlatform): Promise<ConnectionResult> {
  while (true) {
    const mode = await p.select({
      message: "What would you like to secure?",
      options: [
        { value: "local" as const, label: "This machine", hint: "run directly, no SSH" },
        { value: "ssh" as const, label: "A remote server", hint: "connect via SSH" },
      ],
    })

    if (p.isCancel(mode)) {
      p.outro(pc.dim("Cancelled."))
      process.exit(0)
    }

    if (mode === "local") {
      if (!platform.isCompatibleTarget) {
        const osLabel = platform.distro && platform.version
          ? `${platform.distro} ${platform.version}`
          : platform.os
        p.log.error(
          `${pc.red("Local mode requires Ubuntu 22.04+.")}\n` +
            `  ${pc.dim(`Your system: ${osLabel}`)}\n` +
            `  ${pc.dim("Use SSH mode to secure a remote server.")}`,
        )
        continue
      }
      return setupLocalClient()
    }

    const capabilities = await detectCapabilities(platform)
    await ensureCapabilities(platform, capabilities)
    const { client, connectionConfig } = await connectWithRetry(platform, capabilities)
    return {
      client,
      mode: "ssh",
      host: connectionConfig.host,
      username: connectionConfig.username,
    }
  }
}
```

- [ ] **Step 2: Update `src/connection/index.ts`**

Replace with:

```typescript
export { selectMode } from "./mode.ts"
export { connectWithRetry } from "./retry-loop.ts"
```

(Remove `validateLocalUbuntu` export — the function is removed.)

- [ ] **Step 3: Update `src/__tests__/connection/mode.test.ts`**

The existing tests import and call `validateLocalUbuntu` directly. Since that function is removed, replace the test file:

```typescript
import { describe, expect, test } from "bun:test"
import { detectHostPlatform, parseOsRelease, isVersionAtLeast } from "../../platform/detect.ts"

describe("detectHostPlatform (live)", () => {
  test("returns a valid HostPlatform for the current system", async () => {
    const platform = await detectHostPlatform()
    expect(["linux", "macos", "windows"]).toContain(platform.os)
    expect(typeof platform.isCompatibleTarget).toBe("boolean")
  })

  test("populates distro on Linux", async () => {
    const platform = await detectHostPlatform()
    if (platform.os === "linux") {
      expect(platform.distro).not.toBeNull()
      expect(typeof platform.distro).toBe("string")
    }
  })
})

describe("OS release parsing (formerly validateLocalUbuntu)", () => {
  test("parses valid Ubuntu 24.04", () => {
    const result = parseOsRelease("ubuntu|24.04|noble")
    expect(result.distro).toBe("ubuntu")
    expect(result.version).toBe("24.04")
    expect(result.codename).toBe("noble")
  })

  test("parses valid Ubuntu 22.04 (minimum)", () => {
    const result = parseOsRelease("ubuntu|22.04|jammy")
    expect(isVersionAtLeast(result.version, 22, 4)).toBe(true)
  })

  test("rejects old Ubuntu 20.04", () => {
    const result = parseOsRelease("ubuntu|20.04|focal")
    expect(isVersionAtLeast(result.version, 22, 4)).toBe(false)
  })

  test("rejects Ubuntu 22.03 (just below minimum)", () => {
    const result = parseOsRelease("ubuntu|22.03|pre-jammy")
    expect(isVersionAtLeast(result.version, 22, 4)).toBe(false)
  })

  test("accepts Ubuntu 23.10", () => {
    const result = parseOsRelease("ubuntu|23.10|mantic")
    expect(isVersionAtLeast(result.version, 22, 4)).toBe(true)
  })

  test("accepts Ubuntu 26.04 (future version)", () => {
    const result = parseOsRelease("ubuntu|26.04|future")
    expect(isVersionAtLeast(result.version, 22, 4)).toBe(true)
  })

  test("detects non-Ubuntu OS", () => {
    const result = parseOsRelease("debian|12|bookworm")
    expect(result.distro).toBe("debian")
    expect(result.distro === "ubuntu").toBe(false)
  })

  test("handles empty string", () => {
    const result = parseOsRelease("")
    expect(result.distro).toBe("")
    expect(isVersionAtLeast(result.version, 22, 4)).toBe(false)
  })
})
```

- [ ] **Step 4: Run tests**

Run: `bun test src/__tests__/connection/mode.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/connection/mode.ts src/connection/index.ts src/__tests__/connection/mode.test.ts
git commit -m "feat: gate local mode by host platform, remove validateLocalUbuntu"
```

---

### Task 15: Update `src/prompts/connection.ts` — accept capabilities, hide password auth

**Files:**
- Modify: `src/prompts/connection.ts`

- [ ] **Step 1: Update `src/prompts/connection.ts`**

Replace the import block (lines 1-11):

```typescript
import * as p from "@clack/prompts"
import { existsSync } from "fs"
import pc from "picocolors"
import { resolveHome } from "../platform/home.ts"
import { detectAllLocalKeys, detectDefaultKeyPath } from "../ssh/index.ts"
import type { ConnectionConfig, HostCapabilities } from "../types.ts"
import { handleCancel, isCancel, unwrapText } from "./helpers.ts"
```

Update `promptManualKeyPath` (lines 13-29) to use `resolveHome()`:

```typescript
async function promptManualKeyPath(): Promise<string> {
  const defaultKey = detectDefaultKeyPath()
  const keyPath = unwrapText(
    await p.text({
      message: "Path to your private SSH key",
      placeholder: defaultKey ?? "~/.ssh/id_ed25519",
      defaultValue: defaultKey,
      validate(value) {
        if (!value?.trim()) return "Key path is required"
        const resolved = value.replace("~", resolveHome())
        if (!existsSync(resolved)) return `File not found: ${resolved}`
        return undefined
      },
    }),
  )
  return keyPath.replace("~", resolveHome())
}
```

Update `promptAuthCredentials` to accept capabilities (lines 31-91). The function signature becomes `async function promptAuthCredentials(authMethod, capabilities)`:

```typescript
async function promptAuthCredentials(
  authMethod: "key" | "password" | "copy",
  capabilities: HostCapabilities,
): Promise<{ privateKeyPath?: string; password?: string }> {
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

  const password = unwrapText(
    await p.password({
      message: "Enter the SSH password",
      validate(value) {
        if (!value) return "Password is required"
        return undefined
      },
    }),
  )

  return { password }
}
```

Update `validateCopyKeyPrerequisites` — remove the `ssh-copy-id` check since we have the TS fallback. Remove the `capabilities` parameter since it's no longer needed:

```typescript
async function validateCopyKeyPrerequisites(privateKeyPath: string): Promise<void> {
  const pubKeyPath = `${privateKeyPath}.pub`
  if (!existsSync(pubKeyPath)) {
    p.log.error(
      `${pc.red(`Public key not found at ${pubKeyPath}`)}\n` +
        `  ${pc.dim("Make sure the .pub file exists alongside your private key.")}`,
    )
    throw new Error(`Public key not found at ${pubKeyPath}`)
  }
}
```

Update `promptConnection` to accept capabilities and conditionally hide password auth:

```typescript
export async function promptConnection(capabilities: HostCapabilities): Promise<ConnectionConfig> {
  const host = unwrapText(
    await p.text({
      message: "Enter the server IP address or hostname",
      placeholder: "192.168.1.100",
      validate(value) {
        if (!value?.trim()) return "IP address is required"
        return undefined
      },
    }),
  )

  const username = unwrapText(
    await p.text({
      message: "Enter the SSH username",
      placeholder: "root",
      defaultValue: "root",
      validate(value) {
        if (!value?.trim()) return "Username is required"
        if (!/^[a-z_][a-z0-9_-]*$/.test(value))
          return "Invalid username format (lowercase letters, digits, hyphens, underscores)"
        return undefined
      },
    }),
  )

  const portStr = unwrapText(
    await p.text({
      message: "SSH port",
      placeholder: "22",
      defaultValue: "22",
      validate(value) {
        if (!value) return "Port is required"
        const port = parseInt(value, 10)
        if (Number.isNaN(port) || port < 1 || port > 65_535) return "Port must be between 1 and 65535"
        return undefined
      },
    }),
  )
  const port = parseInt(portStr, 10)

  const authOptions: Array<{ value: "key" | "password" | "copy"; label: string; hint?: string }> = [
    { value: "key", label: "SSH Key", hint: "recommended" },
  ]
  if (capabilities.sshpass) {
    authOptions.push({ value: "password", label: "Password" })
  }
  authOptions.push({ value: "copy", label: "Copy my SSH key to server", hint: "needs password" })

  const authMethod = await p.select({
    message: "How do you want to authenticate?",
    options: authOptions,
  })
  if (isCancel(authMethod)) handleCancel()

  const { privateKeyPath, password } = await promptAuthCredentials(authMethod, capabilities)

  return {
    host: host.trim(),
    port,
    username: username.trim(),
    authMethod,
    privateKeyPath,
    password,
    controlPath: "",
  }
}
```

- [ ] **Step 2: Run type check**

Run: `bun run check`
Expected: Type errors in callers (retry-loop, error-handlers) — expected, will fix in next tasks

- [ ] **Step 3: Commit**

```bash
git add src/prompts/connection.ts
git commit -m "feat: accept capabilities in connection prompts, hide password auth if no sshpass"
```

---

### Task 16: Update `src/connection/error-handlers.ts` — thread capabilities + platform

**Files:**
- Modify: `src/connection/error-handlers.ts`

- [ ] **Step 1: Update `src/connection/error-handlers.ts`**

Replace the full file:

```typescript
import type { spinner } from "@clack/prompts"
import { isCancel, log, password as passwordPrompt } from "@clack/prompts"
import { existsSync } from "fs"
import pc from "picocolors"
import { copyKeyViaClient } from "../platform/ssh-copy.ts"
import { promptCopyKeyOnFailure } from "../prompts/index.ts"
import { connect, copyKeyToServer } from "../ssh/index.ts"
import type { ConnectionConfig, HostCapabilities, HostPlatform, SystemClient } from "../types.ts"

export async function handleCopyAuthMethod(
  config: ConnectionConfig,
  capabilities: HostCapabilities,
): Promise<"continue" | "retry"> {
  if (config.authMethod !== "copy" || !config.privateKeyPath) {
    return "continue"
  }

  const pubKeyPath = `${config.privateKeyPath}.pub`

  if (capabilities.sshCopyId) {
    log.info(pc.dim("Copying your SSH key to the server. You will be prompted for the password."))
    const result = await copyKeyToServer(config.host, config.username, pubKeyPath, config.port)

    if (result.success) {
      log.success("SSH key copied successfully. Connecting with key auth...")
      config.authMethod = "key"
      return "continue"
    }

    if (result.passwordAuthDisabled) {
      log.error(
        `${pc.red("The server does not accept password authentication.")}\n` +
          `  ${pc.dim("Password auth is disabled on this server, so ssh-copy-id cannot connect.")}\n` +
          `  ${pc.dim("To add your key, use the server console or cloud provider dashboard to add")}\n` +
          `  ${pc.dim("your public key to /root/.ssh/authorized_keys manually.")}`,
      )
    } else {
      log.error(pc.red("Failed to copy SSH key. Check the password and try again."))
    }

    log.info(pc.cyan("Let's try again.\n"))
    return "retry"
  }

  // No ssh-copy-id: defer key copy to after connection is established
  log.info(pc.dim("ssh-copy-id not available. Key will be copied after connection is established."))
  return "continue"
}

export async function handleSudoPasswordPrompt(
  config: ConnectionConfig,
  s: ReturnType<typeof spinner>,
  platform: HostPlatform,
): Promise<SystemClient | "retry"> {
  s.stop(pc.yellow("Sudo password required"))
  log.warning(
    `${pc.bold("User does not have passwordless sudo.")}\n` +
      `  ${pc.dim("For better security, consider configuring NOPASSWD sudo for this user.")}`,
  )

  const sudoPw = await passwordPrompt({
    message: "Enter the sudo password",
    validate(value) {
      if (!value) return "Password is required"
      return undefined
    },
  })
  if (isCancel(sudoPw)) {
    log.info(pc.cyan("Let's try again.\n"))
    return "retry"
  }

  config.sudoPassword = sudoPw

  s.start(`Reconnecting to ${config.host}...`)
  try {
    const ssh = await connect(config, platform)
    s.stop(`Connected to ${pc.green(config.host)}`)
    return ssh
  } catch (retryError) {
    const retryMsg = retryError instanceof Error ? retryError.message : "Unknown error"
    s.stop(pc.red(`Connection failed: ${retryMsg}`))
    log.info(pc.cyan("Let's try again.\n"))
    return "retry"
  }
}

export async function handlePermissionDenied(
  config: ConnectionConfig,
  capabilities: HostCapabilities,
): Promise<void> {
  const wantCopy = await promptCopyKeyOnFailure()
  if (!wantCopy) return

  const pubKeyPath = `${config.privateKeyPath}.pub`

  if (!existsSync(pubKeyPath)) {
    log.error(pc.red(`Public key not found at ${pubKeyPath}`))
    return
  }

  if (capabilities.sshCopyId) {
    log.info(pc.dim("Copying your SSH key to the server. You will be prompted for the password."))
    const copyResult = await copyKeyToServer(config.host, config.username, pubKeyPath, config.port)

    if (copyResult.success) {
      log.success("SSH key copied successfully. Reconnecting...")
    } else if (copyResult.passwordAuthDisabled) {
      log.error(
        `${pc.red("The server does not accept password authentication.")}\n` +
          `  ${pc.dim("Password auth is disabled on this server, so ssh-copy-id cannot connect.")}\n` +
          `  ${pc.dim("To add your key, use the server console or cloud provider dashboard to add")}\n` +
          `  ${pc.dim("your public key to /root/.ssh/authorized_keys manually.")}`,
      )
    } else {
      log.error(pc.red("Failed to copy SSH key. Check the password and try again."))
    }
  } else {
    log.error(
      `${pc.red("Cannot copy SSH key: ssh-copy-id is not available and no active connection for fallback.")}\n` +
        `  ${pc.dim("Add your public key manually to the server's ~/.ssh/authorized_keys.")}`,
    )
  }
}

export async function handleConnectionError(
  error: unknown,
  config: ConnectionConfig,
  s: ReturnType<typeof spinner>,
  platform: HostPlatform,
  capabilities: HostCapabilities,
): Promise<SystemClient | "retry"> {
  const msg = error instanceof Error ? error.message : "Unknown error"

  if (msg === "SUDO_PASSWORD_REQUIRED") {
    return handleSudoPasswordPrompt(config, s, platform)
  }

  s.stop(pc.red(`Connection failed: ${msg}`))

  if (config.authMethod === "key" && config.privateKeyPath && msg.includes("Permission denied")) {
    await handlePermissionDenied(config, capabilities)
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
  return "retry"
}
```

- [ ] **Step 2: Run type check**

Run: `bun run check`
Expected: Errors in retry-loop.ts (caller not yet updated) — expected

- [ ] **Step 3: Commit**

```bash
git add src/connection/error-handlers.ts
git commit -m "feat: thread platform and capabilities through error handlers"
```

---

### Task 17: Update `src/connection/verify-host.ts` + `src/connection/retry-loop.ts`

**Files:**
- Modify: `src/connection/verify-host.ts`
- Modify: `src/connection/retry-loop.ts`

- [ ] **Step 1: Update `src/connection/verify-host.ts`**

Replace the full file:

```typescript
import type { spinner } from "@clack/prompts"
import { confirm, isCancel, log } from "@clack/prompts"
import pc from "picocolors"
import { addToKnownHosts, fetchHostKeyFingerprint } from "../ssh/index.ts"
import type { ConnectionConfig, HostCapabilities, HostPlatform } from "../types.ts"

export async function verifyHostKey(
  config: ConnectionConfig,
  s: ReturnType<typeof spinner>,
  platform: HostPlatform,
  capabilities: HostCapabilities,
): Promise<"continue" | "retry"> {
  if (!capabilities.sshKeyscan) {
    log.warning(
      pc.yellow("Host key verification unavailable (ssh-keyscan not found). Proceeding without verification."),
    )
    return "continue"
  }

  s.start(`Checking host key for ${config.host}...`)
  const hostKeyResult = await fetchHostKeyFingerprint(config.host, config.port, platform, capabilities)

  if (hostKeyResult.known) {
    s.stop(`Host key verified for ${pc.green(config.host)}`)
    return "continue"
  }

  if (hostKeyResult.fingerprint) {
    s.stop("New host detected")
    log.info(`${pc.bold("Host key fingerprint:")}\n  ${pc.cyan(hostKeyResult.fingerprint)}`)

    const trust = await confirm({ message: "Do you trust this host?" })
    if (isCancel(trust) || !trust) {
      return "retry"
    }

    addToKnownHosts(hostKeyResult.rawKeys)
    return "continue"
  }

  s.stop(pc.yellow("Could not fetch host key"))
  log.warning("Unable to verify host key. The connection will proceed but the host is unverified.")
  return "continue"
}
```

- [ ] **Step 2: Update `src/connection/retry-loop.ts`**

Replace the full file:

```typescript
import { log, spinner } from "@clack/prompts"
import { readFileSync } from "fs"
import pc from "picocolors"
import { copyKeyViaClient } from "../platform/ssh-copy.ts"
import { promptConnection } from "../prompts/index.ts"
import { connect } from "../ssh/index.ts"
import type { ConnectionConfig, HostCapabilities, HostPlatform, SystemClient } from "../types.ts"
import { handleConnectionError, handleCopyAuthMethod } from "./error-handlers.ts"
import { verifyHostKey } from "./verify-host.ts"

async function performDeferredKeyCopy(
  client: SystemClient,
  config: ConnectionConfig,
): Promise<void> {
  if (config.authMethod !== "copy" || !config.privateKeyPath) return

  const pubKeyPath = `${config.privateKeyPath}.pub`
  const pubKeyContent = readFileSync(pubKeyPath, "utf-8").trim()

  log.info(pc.dim("Copying SSH key to the server via fallback method..."))
  const result = await copyKeyViaClient(client, pubKeyContent, config.username)

  if (result.success) {
    log.success("SSH key copied successfully.")
    config.authMethod = "key"
  } else {
    log.error(pc.red("Failed to copy SSH key to the server."))
  }
}

export async function connectWithRetry(
  platform: HostPlatform,
  capabilities: HostCapabilities,
): Promise<{ client: SystemClient; connectionConfig: ConnectionConfig }> {
  const s = spinner()

  while (true) {
    let connectionConfig: ConnectionConfig
    try {
      connectionConfig = await promptConnection(capabilities)
    } catch {
      log.info(pc.cyan("Let's try again.\n"))
      continue
    }

    const hostKeyAction = await verifyHostKey(connectionConfig, s, platform, capabilities)
    if (hostKeyAction === "retry") {
      log.info(pc.cyan("Let's try again.\n"))
      continue
    }

    const copyAction = await handleCopyAuthMethod(connectionConfig, capabilities)
    if (copyAction === "retry") continue

    s.start(`Connecting to ${connectionConfig.host}...`)

    try {
      const client = await connect(connectionConfig, platform)
      s.stop(`Connected to ${pc.green(connectionConfig.host)}`)

      // Deferred key copy: when ssh-copy-id was unavailable, copy key via the established connection
      if (connectionConfig.authMethod === "copy" && !capabilities.sshCopyId) {
        await performDeferredKeyCopy(client, connectionConfig)
        if (connectionConfig.authMethod === "key") {
          // Reconnect with key auth for a clean connection
          client.close()
          s.start(`Reconnecting with key auth to ${connectionConfig.host}...`)
          const keyClient = await connect(connectionConfig, platform)
          s.stop(`Connected to ${pc.green(connectionConfig.host)}`)
          return { client: keyClient, connectionConfig }
        }
      }

      return { client, connectionConfig }
    } catch (error) {
      const result = await handleConnectionError(error, connectionConfig, s, platform, capabilities)
      if (result === "retry") continue
      return { client: result, connectionConfig }
    }
  }
}
```

- [ ] **Step 3: Run type check**

Run: `bun run check`
Expected: Only remaining error should be in `src/index.ts` (not yet updated)

- [ ] **Step 4: Commit**

```bash
git add src/connection/verify-host.ts src/connection/retry-loop.ts
git commit -m "feat: thread platform and capabilities through connection pipeline"
```

---

### Task 18: Wire up `src/index.ts` — the entry point

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Update `src/index.ts`**

Replace the full file:

```typescript
#!/usr/bin/env bun
import pc from "picocolors"
import { initVersion, parseArgs, showBanner } from "./cli/index.ts"
import { selectMode } from "./connection/index.ts"
import { run } from "./orchestrator.ts"
import { detectHostPlatform } from "./platform/index.ts"

async function main(): Promise<void> {
  await initVersion()
  const args = parseArgs()
  if (!args) return
  showBanner()
  const platform = await detectHostPlatform()
  const connection = await selectMode(platform)
  await run(args, connection)
}

main().catch((error) => {
  console.error(pc.red("Fatal error:"), error instanceof Error ? error.message : error)
  process.exit(1)
})
```

- [ ] **Step 2: Run type check**

Run: `bun run check`
Expected: PASS — all types resolve

- [ ] **Step 3: Run full test suite**

Run: `bun test`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire host platform detection into startup flow"
```

---

### Task 19: Final verification — lint, types, all tests

**Files:** None (verification only)

- [ ] **Step 1: Run linter**

Run: `bun run lint`
Expected: PASS

- [ ] **Step 2: Run type checker**

Run: `bun run check`
Expected: PASS

- [ ] **Step 3: Run full test suite**

Run: `bun test`
Expected: All tests PASS (278+ existing + ~30 new)

- [ ] **Step 4: Verify no `process.env.HOME` in source (excluding tests)**

Run: `grep -r "process.env.HOME" src/ --include="*.ts" | grep -v __tests__`
Expected: No results

- [ ] **Step 5: Verify no leftover `which` calls in source**

Run: `grep -rn '"which"' src/ --include="*.ts" | grep -v __tests__ | grep -v platform/capabilities`
Expected: No results

- [ ] **Step 6: Verify no `checkSshCopyIdInstalled` or `checkSshpassInstalled` references**

Run: `grep -rn "checkSshCopyIdInstalled\|checkSshpassInstalled" src/ --include="*.ts"`
Expected: No results

- [ ] **Step 7: Commit (if any lint fixes were needed)**

```bash
git add -A
git commit -m "chore: lint fixes for cross-platform support"
```
