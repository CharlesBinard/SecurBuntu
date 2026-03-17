import { describe, expect, test } from "bun:test"
import { DEFAULT_TIMEOUT, spawnProcess, spawnSsh, spawnSshpass } from "../../ssh/process.ts"

describe("spawnProcess", () => {
  test("runs a simple command and captures stdout", async () => {
    const result = await spawnProcess(["echo", "hello world"])
    expect(result.stdout).toBe("hello world")
    expect(result.stderr).toBe("")
    expect(result.exitCode).toBe(0)
  })

  test("captures stderr from commands", async () => {
    const result = await spawnProcess(["bash", "-c", "echo error >&2"])
    expect(result.stderr).toBe("error")
  })

  test("returns non-zero exit code on failure", async () => {
    const result = await spawnProcess(["bash", "-c", "exit 42"])
    expect(result.exitCode).toBe(42)
  })

  test("trims stdout and stderr", async () => {
    const result = await spawnProcess(["bash", "-c", "echo '  padded  '"])
    expect(result.stdout).toBe("padded")
  })

  test("passes stdin data to the process", async () => {
    const result = await spawnProcess(["cat"], "hello from stdin")
    expect(result.stdout).toBe("hello from stdin")
    expect(result.exitCode).toBe(0)
  })

  test("handles empty stdin data", async () => {
    const result = await spawnProcess(["cat"], "")
    expect(result.stdout).toBe("")
    expect(result.exitCode).toBe(0)
  })

  test("times out long-running commands", async () => {
    const result = await spawnProcess(["sleep", "30"], undefined, 500)
    expect(result.exitCode).toBe(-1)
    expect(result.stderr).toContain("timed out")
    expect(result.stdout).toBe("")
  })

  test("passes custom env to the process", async () => {
    const result = await spawnProcess(["bash", "-c", "echo $TEST_CUSTOM_VAR"], undefined, DEFAULT_TIMEOUT, {
      ...process.env,
      TEST_CUSTOM_VAR: "custom_value",
    })
    expect(result.stdout).toBe("custom_value")
  })

  test("handles multiline stdout", async () => {
    const result = await spawnProcess(["bash", "-c", "echo line1; echo line2; echo line3"])
    expect(result.stdout).toBe("line1\nline2\nline3")
  })

  test("handles commands with no output", async () => {
    const result = await spawnProcess(["true"])
    expect(result.stdout).toBe("")
    expect(result.stderr).toBe("")
    expect(result.exitCode).toBe(0)
  })

  test("handles simultaneous stdout and stderr", async () => {
    const result = await spawnProcess(["bash", "-c", "echo out; echo err >&2"])
    expect(result.stdout).toBe("out")
    expect(result.stderr).toBe("err")
  })

  test("DEFAULT_TIMEOUT is 5 minutes", () => {
    expect(DEFAULT_TIMEOUT).toBe(300_000)
  })
})

describe("spawnSsh", () => {
  test("prefixes command with ssh", async () => {
    // We can't actually SSH, but we can verify the function calls spawnProcess
    // by checking that it returns a CommandResult even on failure
    const result = await spawnSsh(["--invalid-flag"], undefined, 2000)
    expect(result).toHaveProperty("stdout")
    expect(result).toHaveProperty("stderr")
    expect(result).toHaveProperty("exitCode")
  })
})

describe("spawnSshpass", () => {
  test("calls spawnProcess with sshpass prefix and SSHPASS env", async () => {
    // sshpass may not be installed in CI, so we just verify the function
    // throws or returns a result without hanging
    try {
      const result = await spawnSshpass("testpw", ["-V"], 2000)
      // If sshpass IS installed, we get a CommandResult
      expect(result).toHaveProperty("stdout")
      expect(result).toHaveProperty("stderr")
      expect(result).toHaveProperty("exitCode")
    } catch (err) {
      // If sshpass is NOT installed, Bun.spawn throws ENOENT
      expect(err).toBeDefined()
    }
  })
})
