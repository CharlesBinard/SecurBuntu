import type { CheckResult, HealthCheckScore } from "../types.ts"

export function computeScore(checks: CheckResult[]): HealthCheckScore {
  let passed = 0
  let warned = 0
  let failed = 0

  for (const check of checks) {
    switch (check.status) {
      case "pass":
        passed++
        break
      case "warn":
        warned++
        break
      case "fail":
        failed++
        break
      // "info" is excluded from score
    }
  }

  return { passed, warned, failed, total: passed + warned + failed }
}

export function getExitCode(score: HealthCheckScore): number {
  return score.failed > 0 ? 1 : 0
}
