export {
  commandExists,
  detectCapabilities,
  ensureCapabilities,
  getInstallCommand,
  getManualInstallHint,
} from "./capabilities.ts"
export { detectHostPlatform, isVersionAtLeast, parseOsRelease } from "./detect.ts"
export { resolveHome } from "./home.ts"
export { copyKeyViaClient } from "./ssh-copy.ts"
