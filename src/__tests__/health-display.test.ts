import { describe, expect, mock as bunMock, test, beforeEach } from "bun:test"

let logCalls: string[] = []

bunMock.module("@clack/prompts", () => ({
  log: {
    info: (msg: string) => { logCalls.push(msg) },
    success: (msg: string) => { logCalls.push(msg) },
    warning: (msg: string) => { logCalls.push(msg) },
    error: (msg: string) => { logCalls.push(msg) },
  },
}))

import { formatHealthCheck } from "../audit/health-display.ts"
import type { CheckResult, HealthCheckScore, ServerInfo } from "../types.ts"

describe("formatHealthCheck", () => {
  beforeEach(() => {
    logCalls = []
  })

  test("groups checks by category", () => {
    const checks: CheckResult[] = [
      { category: "SSH Configuration", label: "Root login disabled", status: "pass" },
      { category: "Firewall", label: "UFW active", status: "pass" },
      { category: "SSH Configuration", label: "Custom port", status: "warn" },
    ]
    const score: HealthCheckScore = { passed: 2, warned: 1, failed: 0, total: 3 }
    const serverInfo: ServerInfo = {
      ubuntuVersion: "24.04",
      ubuntuCodename: "noble",
      usesSocketActivation: false,
      hasCloudInit: false,
      isRoot: true,
    }
    const output = formatHealthCheck(serverInfo, checks, score)
    const sshSection = output.indexOf("SSH Configuration")
    const firewallSection = output.indexOf("Firewall")
    expect(sshSection).toBeLessThan(firewallSection)
  })

  test("includes server info header", () => {
    const checks: CheckResult[] = [
      { category: "SSH Configuration", label: "Root login", status: "pass" },
    ]
    const score: HealthCheckScore = { passed: 1, warned: 0, failed: 0, total: 1 }
    const serverInfo: ServerInfo = {
      ubuntuVersion: "24.04",
      ubuntuCodename: "noble",
      usesSocketActivation: false,
      hasCloudInit: false,
      isRoot: true,
    }
    const output = formatHealthCheck(serverInfo, checks, score)
    expect(output).toContain("Ubuntu 24.04")
  })

  test("includes score line", () => {
    const checks: CheckResult[] = [
      { category: "SSH Configuration", label: "Root login", status: "pass" },
      { category: "SSH Configuration", label: "Password", status: "fail" },
    ]
    const score: HealthCheckScore = { passed: 1, warned: 0, failed: 1, total: 2 }
    const serverInfo: ServerInfo = {
      ubuntuVersion: "22.04",
      ubuntuCodename: "jammy",
      usesSocketActivation: false,
      hasCloudInit: false,
      isRoot: true,
    }
    const output = formatHealthCheck(serverInfo, checks, score)
    expect(output).toContain("1/2")
    expect(output).toContain("50%")
  })

  test("uses correct indicators for each status", () => {
    const checks: CheckResult[] = [
      { category: "A", label: "Pass check", status: "pass" },
      { category: "B", label: "Warn check", status: "warn" },
      { category: "C", label: "Fail check", status: "fail" },
      { category: "D", label: "Info check", status: "info" },
    ]
    const score: HealthCheckScore = { passed: 1, warned: 1, failed: 1, total: 3 }
    const serverInfo: ServerInfo = {
      ubuntuVersion: "22.04",
      ubuntuCodename: "jammy",
      usesSocketActivation: false,
      hasCloudInit: false,
      isRoot: true,
    }
    const output = formatHealthCheck(serverInfo, checks, score)
    expect(output).toContain("Pass check")
    expect(output).toContain("Warn check")
    expect(output).toContain("Fail check")
    expect(output).toContain("Info check")
  })

  test("includes detail when present", () => {
    const checks: CheckResult[] = [
      { category: "A", label: "Check", status: "warn", detail: "some detail" },
    ]
    const score: HealthCheckScore = { passed: 0, warned: 1, failed: 0, total: 1 }
    const serverInfo: ServerInfo = {
      ubuntuVersion: "22.04",
      ubuntuCodename: "jammy",
      usesSocketActivation: false,
      hasCloudInit: false,
      isRoot: true,
    }
    const output = formatHealthCheck(serverInfo, checks, score)
    expect(output).toContain("some detail")
  })
})
