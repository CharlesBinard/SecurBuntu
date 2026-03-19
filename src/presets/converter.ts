import type { HardeningOptions, Preset } from "../types.ts"

/**
 * Converts a Preset into HardeningOptions.
 * Sets currentSshPort=0 and connectionUsername="" as placeholders.
 * The orchestrator overrides these with real values after server detection.
 */
export function presetToHardeningOptions(preset: Preset): HardeningOptions {
  return {
    // Runtime fields — placeholders, overridden by orchestrator
    createSudoUser: false,
    sudoUsername: undefined,
    sudoPassword: undefined,
    addPersonalKey: false,
    personalKeyPath: undefined,
    configureCoolify: false,
    currentSshPort: 0,
    connectionUsername: "",
    // Preset options
    ...preset.options,
  }
}
