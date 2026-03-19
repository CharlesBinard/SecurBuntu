import { describe, expect, test } from "bun:test"
import { computeScore, getExitCode } from "../audit/score.ts"
import type { CheckResult } from "../types.ts"

describe("computeScore", () => {
  test("counts pass/warn/fail correctly", () => {
    const checks: CheckResult[] = [
      { category: "SSH", label: "Root login", status: "pass" },
      { category: "SSH", label: "Port", status: "warn" },
      { category: "SSH", label: "Password", status: "fail" },
    ]
    const score = computeScore(checks)
    expect(score).toEqual({ passed: 1, warned: 1, failed: 1, total: 3 })
  })

  test("excludes info checks from total", () => {
    const checks: CheckResult[] = [
      { category: "SSH", label: "Root login", status: "pass" },
      { category: "Network", label: "Tailscale", status: "info" },
    ]
    const score = computeScore(checks)
    expect(score).toEqual({ passed: 1, warned: 0, failed: 0, total: 1 })
  })

  test("handles empty checks", () => {
    const score = computeScore([])
    expect(score).toEqual({ passed: 0, warned: 0, failed: 0, total: 0 })
  })

  test("all pass results in correct totals", () => {
    const checks: CheckResult[] = [
      { category: "SSH", label: "Root login", status: "pass" },
      { category: "SSH", label: "Port", status: "pass" },
      { category: "Firewall", label: "UFW", status: "pass" },
    ]
    const score = computeScore(checks)
    expect(score).toEqual({ passed: 3, warned: 0, failed: 0, total: 3 })
  })
})

describe("getExitCode", () => {
  test("returns 0 when no fails", () => {
    expect(getExitCode({ passed: 3, warned: 1, failed: 0, total: 4 })).toBe(0)
  })

  test("returns 1 when at least one fail", () => {
    expect(getExitCode({ passed: 2, warned: 0, failed: 1, total: 3 })).toBe(1)
  })

  test("returns 0 for all pass", () => {
    expect(getExitCode({ passed: 5, warned: 0, failed: 0, total: 5 })).toBe(0)
  })

  test("returns 0 for empty checks", () => {
    expect(getExitCode({ passed: 0, warned: 0, failed: 0, total: 0 })).toBe(0)
  })
})
