import { describe, expect, test } from "bun:test"
import { BUILT_IN_PRESETS } from "../presets/built-in.ts"
import { presetToHardeningOptions } from "../presets/converter.ts"
import type { HardeningOptions, Preset } from "../types.ts"

describe("presetToHardeningOptions", () => {
  test("sets excluded fields to defaults", () => {
    const preset = BUILT_IN_PRESETS.minimal as Preset
    const opts = presetToHardeningOptions(preset)
    expect(opts.createSudoUser).toBe(false)
    expect(opts.sudoUsername).toBeUndefined()
    expect(opts.sudoPassword).toBeUndefined()
    expect(opts.addPersonalKey).toBe(false)
    expect(opts.personalKeyPath).toBeUndefined()
    expect(opts.configureCoolify).toBe(false)
    expect(opts.currentSshPort).toBe(0)
    expect(opts.connectionUsername).toBe("")
  })

  test("copies all preset options", () => {
    const preset = BUILT_IN_PRESETS["web-server"] as Preset
    const opts = presetToHardeningOptions(preset)
    expect(opts.changeSshPort).toBe(true)
    expect(opts.newSshPort).toBe(2222)
    expect(opts.permitRootLogin).toBe("no")
    expect(opts.disablePasswordAuth).toBe(true)
    expect(opts.installUfw).toBe(true)
    expect(opts.ufwPorts).toHaveLength(2)
    expect(opts.installFail2ban).toBe(true)
    expect(opts.enableAutoUpdates).toBe(true)
  })

  test("preserves sysctlOptions when present", () => {
    const preset = BUILT_IN_PRESETS.fortress as Preset
    const opts = presetToHardeningOptions(preset)
    expect(opts.enableSysctl).toBe(true)
    expect(opts.sysctlOptions).toBeTruthy()
    expect(opts.sysctlOptions?.blockForwarding).toBe(true)
  })

  test("leaves sysctlOptions undefined when not in preset", () => {
    const preset = BUILT_IN_PRESETS.minimal as Preset
    const opts = presetToHardeningOptions(preset)
    expect(opts.enableSysctl).toBe(false)
    expect(opts.sysctlOptions).toBeUndefined()
  })

  test("result is a valid HardeningOptions", () => {
    const preset = BUILT_IN_PRESETS.fortress as Preset
    const opts: HardeningOptions = presetToHardeningOptions(preset)
    expect(opts).toBeTruthy()
  })
})
