import { join } from "path"
import { resolveHome } from "../platform/home.ts"

export function getConfigDir(): string {
  const home = resolveHome()
  switch (process.platform) {
    case "darwin":
      return join(home, "Library", "Application Support", "securbuntu")
    case "win32":
      return join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "securbuntu")
    default:
      return join(home, ".config", "securbuntu")
  }
}

export function getPresetsDir(): string {
  return join(getConfigDir(), "presets")
}
