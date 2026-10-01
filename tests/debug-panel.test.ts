// debug パネル（M0 の確認画面と設定の仮 UI）の純粋な部分。DOM の部分は実機で確かめる。
import { afterEach, describe, expect, test, vi } from "vitest";
import { tapSpecOf } from "../src/presenter/input/tap";
import { DEBUG_BUTTONS, debugRow } from "../src/presenter/layout";
import { createSettingsStore, defaultSettings } from "../src/presenter/settings";
import type { StageLayout } from "../src/presenter/stage";
import { createDebugPanel, DEBUG_ROW_KEYS, debugRows, formatStageInfo, formatSwipeDebug, type StageInfoInput } from "../src/presenter/views/debug-panel";
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
  test("UI-30/UI-31/UI-45/UI-57/SV-24 設定の仮 UI は 6 行（オートの速さは 5 行目）で、スワイプ閾値に CSS px の換算値（28 × 4/3 = 37.33 → 37css）を付ける", () => {
    const s = defaultSettings(data.config);
    const rows = debugRows(s, data.strings, 4 / 3);
    expect(rows.map((r) => r.key)).toEqual([...DEBUG_ROW_KEYS]);
    expect([...DEBUG_ROW_KEYS]).toEqual(["swipeThreshold", "holdRepeatMs", "textSpeed", "skipAnimations", "autoBeatMs", "inputMode"]);
    expect(rows.map((r) => r.kind)).toEqual(["number", "number", "number", "toggle", "toggle", "toggle"]);
    expect(rows[0]).toEqual({ key: "swipeThreshold", kind: "number", label: `${data.strings["settings.swipeThreshold"]} (37css)`, value: "28" });
    expect(rows[1]?.value).toBe("250");
    expect(rows[2]?.value).toBe(String(data.config.ui.textSpeedMs));
    expect(rows[3]?.value).toBe(data.strings["settings.off"]);
    expect(rows[4]).toEqual({ key: "autoBeatMs", kind: "toggle", label: data.strings["settings.autoBeatMs"], value: "400ms" });
    expect(rows[5]?.value).toBe(data.strings["settings.inputMode.both"]);
    const on = debugRows({ ...s, skipAnimations: true, inputMode: "swipe", autoBeatMs: 200 }, data.strings, 2);
    expect(on[0]?.label.endsWith("(56css)")).toBe(true);
    expect(on[3]?.value).toBe(data.strings["settings.on"]);
    expect(on[4]?.value).toBe("200ms");
    expect(on[5]?.value).toBe(data.strings["settings.inputMode.swipe"]);
  });

  test("UI-30 スワイプの確定値の表示は dx,dy,dir（丸めた CSS px）", () => {
    expect(formatSwipeDebug(-3.6, 41.2, "up")).toBe("-4,41,up");
  });
});

// ---------------------------------------------------------------- DOM（偽の document）
class FakeEl {
  style: Record<string, string> = {};
  className = "";
  textContent = "";
  type = "";
  children: FakeEl[] = [];
  setAttribute(): void {}
  appendChild(c: FakeEl): FakeEl {
    this.children.push(c);
    return c;
  }
}

describe("createDebugPanel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("UI-57/UI-36 ボタンの段は 全員HP1・既定に戻す・閉じる（DEBUG_BUTTONS の位置）。全員HP1 は onHpOne、オートの速さの行は 200 → 400 → 600 と巡回する。どれも onTap で登録する", () => {
    const created: FakeEl[] = [];
    vi.stubGlobal("document", {
      createElement: () => {
        const e = new FakeEl();
        created.push(e);
        return e;
      },
      createElementNS: () => new FakeEl(),
    });
    const persisted: number[] = [];
    const store = createSettingsStore(defaultSettings(data.config), (s) => persisted.push(s.autoBeatMs));
    let hpOne = 0;
    let closed = 0;
    createDebugPanel({ strings: data.strings, store, defaults: defaultSettings(data.config), onClose: () => closed++, onHpOne: () => hpOne++ });
    const buttons = created.filter((e) => e.className === "ui-button");
    const byText = (t: string): FakeEl => buttons.find((b) => b.textContent === t)!;
    const tap = (b: FakeEl): void => tapSpecOf(b)!.onTap({ lx: 0, ly: 0 });
    const hp = byText(data.strings["debug.hpOneButton"]!);
    const reset = byText(data.strings["settings.reset"]!);
    const close = byText(data.strings["common.close"]!);
    for (const [b, r] of [
      [hp, DEBUG_BUTTONS.hpOne],
      [reset, DEBUG_BUTTONS.reset],
      [close, DEBUG_BUTTONS.close],
    ] as const) {
      expect([b.style["left"], b.style["top"], b.style["width"], b.style["height"]]).toEqual([`${r.x}px`, `${r.y}px`, `${r.w}px`, `${r.h}px`]);
    }
    tap(hp);
    expect(hpOne).toBe(1);
    tap(close);
    expect(closed).toBe(1);
    // オートの速さの行（行 4 の toggle）
    const beat = byText("400ms");
    expect(beat.style["top"]).toBe(`${debugRow(4).toggle.y}px`);
    tap(beat);
    tap(beat);
    tap(beat);
    expect(persisted).toEqual([600, 200, 400]);
    // 既定に戻す
    tap(beat);
    tap(reset);
    expect(store.get().autoBeatMs).toBe(400);
    expect(buttons.every((b) => tapSpecOf(b) !== null)).toBe(true);
  });
});
