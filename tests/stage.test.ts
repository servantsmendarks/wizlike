import { describe, expect, test } from "vitest";
import { computeStageLayout, type Insets, type StageLayoutInput } from "../src/presenter/stage";

const ZERO: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

function input(
  viewportWidth: number,
  viewportHeight: number,
  devicePixelRatio: number,
  insets: Insets = ZERO,
): StageLayoutInput {
  return { viewportWidth, viewportHeight, devicePixelRatio, insets, stageWidth: 240, stageHeight: 400 };
}

function expectOnDevicePixel(v: number, dpr: number): void {
  const d = v * dpr;
  expect(d).toBeCloseTo(Math.round(d), 6);
}

function expectInsideSafeArea(inp: StageLayoutInput): void {
  const l = computeStageLayout(inp);
  const w = inp.stageWidth * l.scale;
  const h = inp.stageHeight * l.scale;
  expect(l.scale).toBeGreaterThan(0);
  expect(l.left).toBeGreaterThanOrEqual(inp.insets.left - 1e-9);
  expect(l.top).toBeGreaterThanOrEqual(inp.insets.top - 1e-9);
  expect(l.left + w).toBeLessThanOrEqual(inp.viewportWidth - inp.insets.right + 1e-9);
  expect(l.top + h).toBeLessThanOrEqual(inp.viewportHeight - inp.insets.bottom + 1e-9);
}

describe("stage layout", () => {
  test("UI-01 iPhone 390x844 dpr3 は端末ピクセル基準で 4 倍（CSS 4/3 倍）", () => {
    const l = computeStageLayout(input(390, 844, 3, { top: 47, right: 0, bottom: 34, left: 0 }));
    expect(l.deviceScale).toBe(4);
    expect(l.scale).toBeCloseTo(4 / 3, 12);
    expect(l.integer).toBe(true);
  });

  test("UI-01 Android 412x915 dpr2.625 は 4 倍", () => {
    const l = computeStageLayout(input(412, 915, 2.625));
    expect(l.deviceScale).toBe(4);
    expect(l.scale).toBeCloseTo(4 / 2.625, 12);
    expect(l.integer).toBe(true);
  });

  test("UI-01 PC 1280x800 と 1920x1080（dpr1）は 2 倍", () => {
    for (const [w, h] of [
      [1280, 800],
      [1920, 1080],
    ] as const) {
      const l = computeStageLayout(input(w, h, 1));
      expect(l.deviceScale).toBe(2);
      expect(l.scale).toBe(2);
      expect(l.integer).toBe(true);
    }
  });

  test("UI-01 ちょうど割り切れる寸法でも浮動小数の誤差で 1 段下がらない", () => {
    // 960x1600 dpr1 → 4 倍ちょうど
    expect(computeStageLayout(input(960, 1600, 1)).deviceScale).toBe(4);
    // 320x533.333 dpr3 → 高さ方向 1600/400 = 4
    expect(computeStageLayout(input(320, 1600 / 3, 3)).deviceScale).toBe(4);
  });

  test("UI-01 収まらない小さい画面は小数倍", () => {
    const l = computeStageLayout(input(200, 300, 1));
    expect(l.integer).toBe(false);
    expect(l.scale).toBeCloseTo(Math.min(200 / 240, 300 / 400), 12);
    expect(l.deviceScale).toBeCloseTo(l.scale, 12);
    expectInsideSafeArea(input(200, 300, 1));
  });

  test("UI-01 中央寄せで、left/top は端末ピクセル境界にある", () => {
    const cases: Array<[StageLayoutInput, number, number]> = [
      // [入力, 期待 left, 期待 top]（丸め前の中央値と端末 px 1 個以内）
      [input(390, 844, 3, { top: 47, right: 0, bottom: 34, left: 0 }), 35, 47 + (763 - 1600 / 3) / 2],
      [input(412, 915, 2.625), (412 - 960 / 2.625) / 2, (915 - 1600 / 2.625) / 2],
      [input(1280, 800, 1), 400, 0],
      [input(1920, 1080, 1), 720, 140],
    ];
    for (const [inp, cx, cy] of cases) {
      const l = computeStageLayout(inp);
      const dpr = inp.devicePixelRatio;
      expectOnDevicePixel(l.left, dpr);
      expectOnDevicePixel(l.top, dpr);
      expect(Math.abs(l.left - cx)).toBeLessThanOrEqual(0.5 / dpr + 1e-9);
      expect(Math.abs(l.top - cy)).toBeLessThanOrEqual(0.5 / dpr + 1e-9);
    }
  });

  test("UI-01 PC 1280x800 はぴったり中央", () => {
    const l = computeStageLayout(input(1280, 800, 1));
    expect(l.left).toBe(400);
    expect(l.top).toBe(0);
  });

  test("UI-02 横持ち 844x390 dpr3 でも safe area に収まる", () => {
    const inp = input(844, 390, 3, { top: 0, right: 47, bottom: 21, left: 47 });
    const l = computeStageLayout(inp);
    // 高さ (390-21)*3 = 1107 / 400 → 2
    expect(l.deviceScale).toBe(2);
    expect(l.integer).toBe(true);
    expectInsideSafeArea(inp);
    expectInsideSafeArea(input(844, 390, 3));
  });

  test("UI-02 多数のビューポート・dpr・insets の組み合わせでステージは safe area の内側", () => {
    const viewports: Array<[number, number]> = [
      [320, 568], [375, 667], [390, 844], [393, 852], [414, 896], [430, 932],
      [360, 640], [360, 800], [412, 915], [384, 854], [768, 1024], [1024, 1366],
      [1280, 800], [1920, 1080], [2560, 1440], [200, 300], [100, 100], [241, 401],
      [844, 390], [667, 375], [915, 412], [239, 399], [240, 400], [480, 800],
    ];
    const dprs = [1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.625, 2.75, 3, 3.5, 4];
    const insetsList: Insets[] = [
      ZERO,
      { top: 47, right: 0, bottom: 34, left: 0 },
      { top: 59, right: 0, bottom: 34, left: 0 },
      { top: 0, right: 47, bottom: 21, left: 47 },
      { top: 24.5, right: 0, bottom: 16.333, left: 0 },
      { top: 0.4, right: 0.7, bottom: 0.2, left: 0.3 },
      { top: 33.3333, right: 11.1, bottom: 22.2222, left: 5.5 },
    ];
    let checked = 0;
    for (const [w, h] of viewports) {
      for (const dpr of dprs) {
        for (const ins of insetsList) {
          if (w - ins.left - ins.right <= 0 || h - ins.top - ins.bottom <= 0) continue;
          const inp = input(w, h, dpr, ins);
          expectInsideSafeArea(inp);
          const l = computeStageLayout(inp);
          const availW = w - ins.left - ins.right;
          const availH = h - ins.top - ins.bottom;
          if (l.integer) {
            expect(Number.isInteger(l.deviceScale)).toBe(true);
            expect(l.scale * dpr).toBeCloseTo(l.deviceScale, 9);
            // 1 段大きい整数倍は収まらない（最大の整数倍である）
            const k = l.deviceScale + 1;
            const fits = (240 * k) / dpr <= availW + 1e-9 && (400 * k) / dpr <= availH + 1e-9;
            expect(fits).toBe(false);
            // 余白が 1 端末 px 以上ある軸では、位置も端末ピクセル境界にある
            if ((availW - 240 * l.scale) * dpr >= 1) expectOnDevicePixel(l.left, dpr);
            if ((availH - 400 * l.scale) * dpr >= 1) expectOnDevicePixel(l.top, dpr);
          } else {
            // 小数倍になるのは、端末ピクセル基準の 1 倍が収まらないときだけ
            expect(240 / dpr > availW + 1e-9 || 400 / dpr > availH + 1e-9).toBe(true);
          }
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  test("UI-02 insets の分だけ利用可能領域が減る", () => {
    // 高さ方向で決まる: (844-47-34)*3 = 2289 / 400 = 5.72 → 5 だが幅 390*3/240 = 4.875 → 4
    // 上下 insets を大きくすると 3 に落ちる
    const l = computeStageLayout(input(390, 844, 3, { top: 200, right: 0, bottom: 200, left: 0 }));
    expect(l.deviceScale).toBe(3);
    expect(l.top).toBeGreaterThanOrEqual(200);
  });
});
