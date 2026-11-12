import { describe, it, expect } from "vitest";
import { fmtAda, parseAda, shorten } from "./rpc";

describe("định dạng ADA", () => {
  it("fmtAda", () => {
    expect(fmtAda("0")).toBe("0");
    expect(fmtAda("1500000")).toBe("1.5");
    expect(fmtAda("1234567890123")).toBe("1,234,567.890123");
    expect(fmtAda("-2000000")).toBe("-2");
  });
  it("parseAda", () => {
    expect(parseAda("12.5")).toBe(12_500_000n);
    expect(parseAda("0.000001")).toBe(1n);
    expect(parseAda("1.1234567")).toBeNull();
    expect(parseAda("abc")).toBeNull();
    expect(parseAda("-1")).toBeNull();
    expect(parseAda("")).toBeNull();
  });
  it("shorten", () => {
    expect(shorten("abc")).toBe("abc");
    expect(shorten("a".repeat(100), 4)).toBe("aaaa…aaaa");
  });
});
