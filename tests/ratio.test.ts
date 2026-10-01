import { describe, expect, it } from "vitest";
import { ceilRatio, floorRatio } from "../src/core/rules/ratio";

describe("rules/ratio（TW-04 / TW-22 / TW-23 の比率の丸め）", () => {
  it("TW-22 floorRatio は誤差で 1 小さくならない（100 × 0.29 = 28.999999999999996）", () => {
    expect(Math.floor(100 * 0.29)).toBe(28); // 素の floor は 28 になる
    expect(floorRatio(100, 0.29)).toBe(29);
    expect(floorRatio(100, 0.07)).toBe(7); // 100 × 0.07 = 7.000000000000001
    expect(floorRatio(29, 0.1)).toBe(2);
    expect(floorRatio(0, 0.5)).toBe(0);
    expect(floorRatio(999, 0)).toBe(0);
  });
  it("TW-04/TW-23 ceilRatio は誤差で 1 大きくならない（100 × 0.07 = 7.000000000000001）", () => {
    expect(Math.ceil(100 * 0.07)).toBe(8); // 素の ceil は 8 になる
    expect(ceilRatio(100, 0.07)).toBe(7);
    expect(ceilRatio(13, 0.5)).toBe(7);
    expect(ceilRatio(6, 0.25)).toBe(2);
    expect(ceilRatio(1, 0.25)).toBe(1);
    expect(ceilRatio(0, 1)).toBe(0);
  });
});
