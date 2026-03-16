import type { HardeningTask, SysctlOptions } from "../types.js"

interface SysctlParam {
  key: string
  value: string
}

function buildSysctlParams(opts: SysctlOptions): SysctlParam[] {
  const params: SysctlParam[] = []

  if (opts.blockForwarding) {
    params.push({ key: "net.ipv4.ip_forward", value: "0" })
    params.push({ key: "net.ipv6.conf.all.forwarding", value: "0" })
  }

  if (opts.ignoreRedirects) {
    params.push({ key: "net.ipv4.conf.all.accept_redirects", value: "0" })
    params.push({ key: "net.ipv4.conf.default.accept_redirects", value: "0" })
    params.push({ key: "net.ipv6.conf.all.accept_redirects", value: "0" })
  }

  if (opts.disableSourceRouting) {
    params.push({ key: "net.ipv4.conf.all.accept_source_route", value: "0" })
    params.push({ key: "net.ipv6.conf.all.accept_source_route", value: "0" })
  }

  if (opts.synFloodProtection) {
    params.push({ key: "net.ipv4.tcp_syncookies", value: "1" })
  }

  if (opts.disableIcmpBroadcast) {
    params.push({ key: "net.ipv4.icmp_echo_ignore_broadcasts", value: "1" })
  }

  return params
}

export const runConfigureSysctl: HardeningTask = async (ssh, options) => {
  if (!options.enableSysctl || !options.sysctlOptions) {
    return {
      name: "Kernel Hardening",
      success: true,
      message: "Skipped (not requested)",
    }
  }

  const params = buildSysctlParams(options.sysctlOptions)
  if (params.length === 0) {
    return {
      name: "Kernel Hardening",
      success: true,
      message: "Skipped (no parameters selected)",
    }
  }

  const date = new Date().toISOString().split("T")[0] ?? "unknown"
  const lines = [`# SecurBuntu Kernel Hardening - generated on ${date}`, ...params.map((p) => `${p.key}=${p.value}`)]

  await ssh.writeFile("/etc/sysctl.d/99-securbuntu.conf", lines.join("\n"))

  const applyResult = await ssh.exec("sysctl --system")
  if (applyResult.exitCode !== 0) {
    return {
      name: "Kernel Hardening",
      success: false,
      message: "Failed to apply sysctl parameters",
      details: applyResult.stderr,
    }
  }

  return {
    name: "Kernel Hardening",
    success: true,
    message: `Applied ${params.length} kernel security parameter(s)`,
    details: params.map((p) => `${p.key}=${p.value}`).join(", "),
  }
}
