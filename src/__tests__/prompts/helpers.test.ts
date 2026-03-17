import { describe, expect, test } from "bun:test"
import { isCancel, unwrapBoolean, unwrapStringArray, unwrapText } from "../../prompts/helpers.ts"

describe("isCancel", () => {
  test("returns false for strings", () => {
    expect(isCancel("hello")).toBe(false)
  })

  test("returns false for empty string", () => {
    expect(isCancel("")).toBe(false)
  })

  test("returns false for numbers", () => {
    expect(isCancel(42)).toBe(false)
  })

  test("returns false for booleans", () => {
    expect(isCancel(true)).toBe(false)
    expect(isCancel(false)).toBe(false)
  })

  test("returns false for null", () => {
    expect(isCancel(null)).toBe(false)
  })

  test("returns false for undefined", () => {
    expect(isCancel(undefined)).toBe(false)
  })

  test("returns false for objects", () => {
    expect(isCancel({})).toBe(false)
  })

  test("returns false for arrays", () => {
    expect(isCancel([])).toBe(false)
  })

  test("returns false for arbitrary symbols (not clack cancel symbol)", () => {
    // clack uses a private module-scoped Symbol("clack:cancel")
    // arbitrary symbols should not be recognized as cancel
    expect(isCancel(Symbol("something"))).toBe(false)
  })
})

describe("unwrapText", () => {
  test("returns the string when given a string", () => {
    expect(unwrapText("hello")).toBe("hello")
  })

  test("returns empty string when given empty string", () => {
    expect(unwrapText("")).toBe("")
  })

  test("returns string with special characters", () => {
    expect(unwrapText("hello world! @#$%")).toBe("hello world! @#$%")
  })

  test("returns string with whitespace preserved", () => {
    expect(unwrapText("  spaced  ")).toBe("  spaced  ")
  })

  test("returns multiline string", () => {
    expect(unwrapText("line1\nline2")).toBe("line1\nline2")
  })
})

describe("unwrapBoolean", () => {
  test("returns true when given true", () => {
    expect(unwrapBoolean(true)).toBe(true)
  })

  test("returns false when given false", () => {
    expect(unwrapBoolean(false)).toBe(false)
  })
})

describe("unwrapStringArray", () => {
  test("returns the array when given an array", () => {
    const arr = ["a", "b", "c"]
    expect(unwrapStringArray(arr)).toEqual(["a", "b", "c"])
  })

  test("returns empty array when given empty array", () => {
    expect(unwrapStringArray([])).toEqual([])
  })

  test("returns array with single element", () => {
    expect(unwrapStringArray(["only"])).toEqual(["only"])
  })

  test("preserves order", () => {
    expect(unwrapStringArray(["z", "a", "m"])).toEqual(["z", "a", "m"])
  })
})
