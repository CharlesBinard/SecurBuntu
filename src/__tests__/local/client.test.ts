import { describe, expect, test } from "bun:test"
import { LocalClient } from "../../local/client.ts"

describe("LocalClient", () => {
  test("exec runs a command and returns stdout", async () => {
    const client = new LocalClient()
    const result = await client.exec("echo hello")
    expect(result.stdout).toBe("hello")
    expect(result.exitCode).toBe(0)
  })

  test("exec returns non-zero exit code on failure", async () => {
    const client = new LocalClient()
    const result = await client.exec("false")
    expect(result.exitCode).not.toBe(0)
  })

  test("exec captures stderr", async () => {
    const client = new LocalClient()
    const result = await client.exec("echo error >&2")
    expect(result.stderr).toBe("error")
  })

  test("execWithStdin passes stdin to command", async () => {
    const client = new LocalClient()
    const result = await client.execWithStdin("cat", "hello from stdin")
    expect(result.stdout).toBe("hello from stdin")
  })

  test("writeFile and readFile round-trip", async () => {
    const tmpPath = `/tmp/securbuntu-test-${Date.now()}.txt`
    const client = new LocalClient()
    await client.writeFile(tmpPath, "test content")
    const content = await client.readFile(tmpPath)
    expect(content).toBe("test content")
    await client.exec(`rm -f '${tmpPath}'`)
  })

  test("fileExists returns true for existing file", async () => {
    const client = new LocalClient()
    expect(await client.fileExists("/etc/os-release")).toBe(true)
  })

  test("fileExists returns false for missing file", async () => {
    const client = new LocalClient()
    expect(await client.fileExists("/nonexistent/path")).toBe(false)
  })

  test("isRoot reflects current user", () => {
    const client = new LocalClient()
    const expected = process.getuid?.() === 0
    expect(client.isRoot).toBe(expected)
  })

  test("close is a safe no-op", () => {
    const client = new LocalClient()
    expect(() => client.close()).not.toThrow()
  })

  test("exec respects timeout", async () => {
    const client = new LocalClient()
    const result = await client.exec("sleep 10", { timeout: 500 })
    expect(result.exitCode).not.toBe(0)
  })
})
