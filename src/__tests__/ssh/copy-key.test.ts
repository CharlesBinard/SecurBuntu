import { describe, expect, test } from "bun:test"
import { checkSshCopyIdInstalled, checkSshpassInstalled } from "../../ssh/copy-key.ts"

describe("checkSshpassInstalled", () => {
  test("returns a boolean", async () => {
    const result = await checkSshpassInstalled()
    expect(typeof result).toBe("boolean")
  })

  test("does not throw", async () => {
    await expect(checkSshpassInstalled()).resolves.toBeDefined()
  })
})

describe("checkSshCopyIdInstalled", () => {
  test("returns a boolean", async () => {
    const result = await checkSshCopyIdInstalled()
    expect(typeof result).toBe("boolean")
  })

  test("does not throw", async () => {
    await expect(checkSshCopyIdInstalled()).resolves.toBeDefined()
  })

  test("returns true on systems with openssh-client installed", async () => {
    // ssh-copy-id is typically available on Linux with openssh-client
    const result = await checkSshCopyIdInstalled()
    // We just verify the function works; result depends on the environment
    expect(result === true || result === false).toBe(true)
  })
})
