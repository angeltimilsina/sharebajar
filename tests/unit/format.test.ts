import { describe, expect, it } from "vitest";
import { formatPct, formatPrice, formatUsd, shortAddress, timeAgo, toNum } from "@/lib/format";

describe("formatPrice", () => {
  it("formats large and regular prices", () => {
    expect(formatPrice(96428.2)).toBe("$96,428.20");
    expect(formatPrice(2.29)).toBe("$2.29");
    expect(formatPrice(0.3271)).toBe("$0.3271");
  });
  it("compresses leading zeros for micro prices", () => {
    expect(formatPrice(0.000002798)).toBe("$0.0₅2798");
    expect(formatPrice(0.0000123)).toBe("$0.0₄123");
  });
  it("handles missing values", () => {
    expect(formatPrice(null)).toBe("—");
    expect(formatPrice(NaN)).toBe("—");
  });
});

describe("formatUsd / formatPct", () => {
  it("uses compact suffixes", () => {
    expect(formatUsd(3.48e12)).toBe("$3.48T");
    expect(formatUsd(178.26e9)).toBe("$178.26B");
    expect(formatUsd(842.1e6)).toBe("$842.10M");
    expect(formatUsd(12_300)).toBe("$12.30K");
  });
  it("signs percentages", () => {
    expect(formatPct(1.756)).toBe("+1.76%");
    expect(formatPct(-0.5)).toBe("-0.50%");
    expect(formatPct(undefined)).toBe("—");
  });
});

describe("misc", () => {
  it("shortens addresses", () => expect(shortAddress("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263")).toBe("DezX…B263"));
  it("formats relative time", () => {
    const now = 1_000_000_000;
    expect(timeAgo(now - 42_000, now)).toBe("42s ago");
    expect(timeAgo(now - 12 * 60_000, now)).toBe("12m ago");
    expect(timeAgo(now - 3 * 3600_000, now)).toBe("3h ago");
  });
  it("parses numbers safely", () => {
    expect(toNum("1.5")).toBe(1.5);
    expect(toNum("")).toBeNull();
    expect(toNum("abc")).toBeNull();
  });
});
