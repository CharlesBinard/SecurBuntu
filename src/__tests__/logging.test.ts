import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, readFileSync, unlinkSync } from "fs"
import { LoggingClient } from "../logging.ts"
import { MockSystemClient } from "./helpers/mock-ssh.ts"

const TEST_LOG_PATH = "/tmp/securbuntu-test-log.txt"

afterEach(() => {
  try {
    unlinkSync(TEST_LOG_PATH)
  } catch {
    /* ignored */
  }
})

describe("LoggingClient", () => {
  test("exec delegates to real client and logs", async () => {
    const mock = new MockSystemClient()
    mock.onExec("whoami", { stdout: "root" })
    const logging = new LoggingClient(mock)

    const result = await logging.exec("whoami")

    expect(result.stdout).toBe("root")
    expect(mock.hasCommand("whoami")).toBe(true)
    expect(logging.hasEntries()).toBe(true)
  })

  test("exec logs stdout and stderr", async () => {
    const mock = new MockSystemClient()
    mock.onExec("fail", { stdout: "out", stderr: "err", exitCode: 1 })
    const logging = new LoggingClient(mock)

    await logging.exec("fail")
    logging.flush(TEST_LOG_PATH)

    const logContent = readFileSync(TEST_LOG_PATH, "utf-8")
    expect(logContent).toContain("EXEC: fail")
    expect(logContent).toContain("EXIT: 1")
    expect(logContent).toContain("STDOUT: out")
    expect(logContent).toContain("STDERR: err")
  })

  test("exec truncates stdout over 2000 chars", async () => {
    const mock = new MockSystemClient()
    const longOutput = "x".repeat(3000)
    mock.onExec("big", { stdout: longOutput })
    const logging = new LoggingClient(mock)

    await logging.exec("big")
    logging.flush(TEST_LOG_PATH)

    const logContent = readFileSync(TEST_LOG_PATH, "utf-8")
    expect(logContent).toContain("... (truncated)")
    expect(logContent).not.toContain("x".repeat(3000))
  })

  test("execWithStdin delegates and logs stdin size", async () => {
    const mock = new MockSystemClient()
    const logging = new LoggingClient(mock)

    await logging.execWithStdin("chpasswd", "user:pass\n")
    logging.flush(TEST_LOG_PATH)

    const logContent = readFileSync(TEST_LOG_PATH, "utf-8")
    expect(logContent).toContain("EXEC: chpasswd (with 10 bytes stdin)")
    expect(mock.hasCommand("chpasswd")).toBe(true)
  })

  test("writeFile delegates and logs", async () => {
    const mock = new MockSystemClient()
    const logging = new LoggingClient(mock)

    await logging.writeFile("/etc/test.conf", "hello")
    logging.flush(TEST_LOG_PATH)

    expect(mock.writtenFiles.get("/etc/test.conf")).toBe("hello")
    const logContent = readFileSync(TEST_LOG_PATH, "utf-8")
    expect(logContent).toContain("WRITE: /etc/test.conf (5 bytes)")
    expect(logContent).toContain("WRITE OK: /etc/test.conf")
  })

  test("readFile delegates and logs", async () => {
    const mock = new MockSystemClient()
    mock.setFile("/etc/hostname", "myhost")
    const logging = new LoggingClient(mock)

    const result = await logging.readFile("/etc/hostname")
    logging.flush(TEST_LOG_PATH)

    expect(result).toBe("myhost")
    const logContent = readFileSync(TEST_LOG_PATH, "utf-8")
    expect(logContent).toContain("READ: /etc/hostname")
    expect(logContent).toContain("READ OK: /etc/hostname (6 bytes)")
  })

  test("fileExists delegates and logs", async () => {
    const mock = new MockSystemClient()
    mock.setFile("/etc/test", "content")
    const logging = new LoggingClient(mock)

    const exists = await logging.fileExists("/etc/test")
    logging.flush(TEST_LOG_PATH)

    expect(exists).toBe(true)
    const logContent = readFileSync(TEST_LOG_PATH, "utf-8")
    expect(logContent).toContain("EXISTS: /etc/test")
  })

  test("hasEntries returns false when empty", () => {
    const mock = new MockSystemClient()
    const logging = new LoggingClient(mock)
    expect(logging.hasEntries()).toBe(false)
  })

  test("flush does nothing when no entries", () => {
    const mock = new MockSystemClient()
    const logging = new LoggingClient(mock)
    logging.flush(TEST_LOG_PATH)
    expect(existsSync(TEST_LOG_PATH)).toBe(false)
  })

  test("isRoot delegates from real client", () => {
    expect(new LoggingClient(new MockSystemClient(true)).isRoot).toBe(true)
    expect(new LoggingClient(new MockSystemClient(false)).isRoot).toBe(false)
  })

  test("entries have ISO timestamps", async () => {
    const mock = new MockSystemClient()
    const logging = new LoggingClient(mock)

    await logging.exec("test")
    logging.flush(TEST_LOG_PATH)

    const logContent = readFileSync(TEST_LOG_PATH, "utf-8")
    expect(logContent).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })
})
