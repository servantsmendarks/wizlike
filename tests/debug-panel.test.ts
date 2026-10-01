// debug パネル（M0 の確認画面と設定の仮 UI）の純粋な部分。DOM の部分は実機で確かめる。
import { describe, expect, test } from "vitest";
import { defaultSettings } from "../src/presenter/settings";
import type { StageLayout } from "../src/presenter/stage";
import { DEBUG_ROW_KEYS, debugRows, formatStageInfo, formatSwipeDebug, type StageInfoInput } from "../src/presenter/views/debug-panel";
import { data } from "./helpers/core";

const layout: StageLayout = { scale: 4 / 3, deviceScale: 4, integer: true, left: 0.5, top: 12 };
const input: StageInfoInput = {
  viewportWidth: 390,
  viewportHeight: 844,
  devicePixelRatio: 3,
  insets: { top: 47, right: 0, bottom: 34, left: 0 },
  stageWidth: 240,
  stageHeight: 400,
};

describe("formatStageInfo", () => {
  test("UI-01 formatStageInfo は 8 行で、insets が無ければ n/a", () => {
    // M0 の確認画面と同じ書式（ラベル 12 桁、端数は 4 桁で末尾の 0 を落とす）
    expect(formatStageInfo(layout, input)).toEqual([
      "scale       1.3333",
      "deviceScale 4",
      "integer     true",
      "dpr         3",
      "viewport    390 x 844",
      "insets      t47 r0 b34 l0",
      "stage pos   0.5, 12",
      "stage size  240 x 400",
    ]);
    const { insets: _omit, ...noInsets } = input;
    const lines = formatStageInfo(layout, noInsets);
    expect(lines).toHaveLength(8);
    expect(lines[5]).toBe("insets      n/a");
    const none = formatStageInfo(layout, null);
    expect(none).toHaveLength(8);
    expect(none.filter((l) => l.endsWith("n/a"))).toEqual(["dpr         n/a", "viewport    n/a", "insets      n/a", "stage size  n/a"]);
  });

  test("UI-02 計測値は ASCII だけ（表示層の日本語リテラル禁止）", () => {
    for (const l of formatStageInfo(layout, input)) expect(l).toMatch(/^[\x20-\x7e]*$/);
  });
});

describe("debugRows", () => {
  test("UI-30/UI-31/SV-24 設定の仮 UI は 5 行で、スワイプ閾値に CSS px の換算値（28 × 4/3 = 37.33 → 37css）を付ける", () => {
    const s = defaultSettings(data.config);
    const rows = debugRows(s, data.strings, 4 / 3);
    expect(rows.map((r) => r.key)).toEqual([...DEBUG_ROW_KEYS]);
    expect(rows.map((r) => r.kind)).toEqual(["number", "number", "number", "toggle", "toggle"]);
    expect(rows[0]).toEqual({ key: "swipeThreshold", kind: "number", label: `${data.strings["settings.swipeThreshold"]} (37css)`, value: "28" });
    expect(rows[1]?.value).toBe("250");
    expect(rows[2]?.value).toBe(String(data.config.ui.textSpeedMs));
    expect(rows[3]?.value).toBe(data.strings["settings.off"]);
    expect(rows[4]?.value).toBe(data.strings["settings.inputMode.both"]);
    const on = debugRows({ ...s, skipAnimations: true, inputMode: "swipe" }, data.strings, 2);
    expect(on[0]?.label.endsWith("(56css)")).toBe(true);
    expect(on[3]?.value).toBe(data.strings["settings.on"]);
    expect(on[4]?.value).toBe(data.strings["settings.inputMode.swipe"]);
  });

  test("UI-30 スワイプの確定値の表示は dx,dy,dir（丸めた CSS px）", () => {
    expect(formatSwipeDebug(-3.6, 41.2, "up")).toBe("-4,41,up");
  });
});
