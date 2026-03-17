import { describe, expect, test } from "bun:test"
import { fetchHostKeyFingerprint } from "../../ssh/host-keys.ts"
import type { HostCapabilities, HostPlatform } from "../../types.ts"

const linuxPlatform: HostPlatform = {
  os: "linux",
  distro: "ubuntu",
  version: "24.04",
  codename: "noble",
  isCompatibleTarget: true,
}

const fullCapabilities: HostCapabilities = {
  ssh: true,
  sshCopyId: true,
  sshpass: true,
  sshKeygen: true,
  sshKeyscan: true,
}

const noKeyscanCapabilities: HostCapabilities = {
  ssh: true,
  sshCopyId: true,
  sshpass: true,
  sshKeygen: true,
  sshKeyscan: false,
}

describe("fetchHostKeyFingerprint", () => {
  test("returns a result object", async () => {
    const result = await fetchHostKeyFingerprint("localhost", 22, linuxPlatform, fullCapabilities)
    expect(result).toBeDefined()
    expect("known" in result).toBe(true)
  }, 10_000)

  test("skips verification when ssh-keyscan is unavailable", async () => {
    const result = await fetchHostKeyFingerprint("localhost", 22, linuxPlatform, noKeyscanCapabilities)
    expect(result).toEqual({ known: false, fingerprint: null, rawKeys: "" })
  })
})
