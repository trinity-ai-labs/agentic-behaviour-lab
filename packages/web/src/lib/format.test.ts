import { describe, expect, it } from "vitest"
import { failRateOf, formatDuration, formatFailRate, formatRate, shortenHarness } from "./format"

describe("formatRate", () => {
  it("always shows the N alongside the percentage", () => {
    expect(formatRate(3, 8)).toBe("38% (3/8)")
  })

  it("renders a dash rather than dividing by zero", () => {
    expect(formatRate(0, 0)).toBe("— (0/0)")
  })
})

describe("failRateOf", () => {
  it("is null until a pass or fail trial exists", () => {
    expect(failRateOf(0, 0)).toBeNull()
  })

  it("is fail/(pass+fail) once graded trials exist", () => {
    expect(failRateOf(6, 2)).toBe(0.25)
  })
})

describe("formatFailRate", () => {
  it("renders the dash state before any pass/fail trial has graded", () => {
    expect(formatFailRate(null, 0, 0)).toBe("— (0 graded)")
  })

  it("renders fail/(pass+fail) once graded trials exist", () => {
    expect(formatFailRate(0.25, 6, 2)).toBe("25% (2/8)")
  })
})

describe("formatDuration", () => {
  it("reports running while there is no end timestamp", () => {
    expect(formatDuration("2026-01-01T00:00:00.000Z", undefined)).toBe("running")
  })

  it("formats sub-second durations in milliseconds", () => {
    expect(formatDuration("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.500Z")).toBe("500ms")
  })

  it("formats multi-minute durations as Xm Ys", () => {
    expect(formatDuration("2026-01-01T00:00:00.000Z", "2026-01-01T00:02:05.000Z")).toBe("2m 5s")
  })
})

describe("shortenHarness", () => {
  it("keeps only the id/version segment, dropping the parenthetical", () => {
    expect(shortenHarness("claude-code/2.1.206 (headless -p)")).toBe("claude-code/2.1.206")
  })
})
