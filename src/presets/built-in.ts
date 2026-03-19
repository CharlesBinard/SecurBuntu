import type { Preset } from "../types.ts"

const SSH_DEFAULTS = {
  changeSshPort: true,
  newSshPort: 2222,
  permitRootLogin: "no" as const,
  disablePasswordAuth: true,
  disableX11Forwarding: true,
  maxAuthTries: 3,
  enableSshBanner: true,
}

const ALL_SYSCTL = {
  blockForwarding: true,
  ignoreRedirects: true,
  disableSourceRouting: true,
  synFloodProtection: true,
  disableIcmpBroadcast: true,
}

const ALL_SERVICES = ["cups", "avahi-daemon", "bluetooth", "ModemManager", "whoopsie", "apport", "snapd", "rpcbind"]

export const BUILT_IN_PRESETS: Record<string, Preset> = {
  minimal: {
    name: "minimal",
    description: "SSH hardening + basic firewall",
    version: 1,
    options: {
      ...SSH_DEFAULTS,
      installUfw: true,
      ufwPorts: [],
      installFail2ban: false,
      enableAutoUpdates: false,
      enableSysctl: false,
      disableServices: false,
      servicesToDisable: [],
      fixFilePermissions: false,
      installTailscale: false,
    },
  },
  "web-server": {
    name: "web-server",
    description: "SSH + HTTP/HTTPS + Fail2ban + auto-updates",
    version: 1,
    options: {
      ...SSH_DEFAULTS,
      installUfw: true,
      ufwPorts: [
        { port: "80", protocol: "tcp", comment: "HTTP" },
        { port: "443", protocol: "tcp", comment: "HTTPS" },
      ],
      installFail2ban: true,
      enableAutoUpdates: true,
      enableSysctl: false,
      disableServices: false,
      servicesToDisable: [],
      fixFilePermissions: false,
      installTailscale: false,
    },
  },
  database: {
    name: "database",
    description: "SSH + restrictive firewall + permissions + kernel hardening",
    version: 1,
    options: {
      ...SSH_DEFAULTS,
      installUfw: true,
      ufwPorts: [],
      installFail2ban: true,
      enableAutoUpdates: true,
      enableSysctl: true,
      sysctlOptions: ALL_SYSCTL,
      disableServices: false,
      servicesToDisable: [],
      fixFilePermissions: true,
      installTailscale: false,
    },
  },
  fortress: {
    name: "fortress",
    description: "Everything maxed out",
    version: 1,
    options: {
      ...SSH_DEFAULTS,
      installUfw: true,
      ufwPorts: [],
      installFail2ban: true,
      enableAutoUpdates: true,
      enableSysctl: true,
      sysctlOptions: ALL_SYSCTL,
      disableServices: true,
      servicesToDisable: [...ALL_SERVICES],
      fixFilePermissions: true,
      installTailscale: false,
    },
  },
}
