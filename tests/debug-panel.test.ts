// debug パネル（M0 の確認画面と設定の仮 UI、UI-57 のポインタの記録）。純粋な部分と、偽の document の DOM の部分。
import { afterEach, describe, expect, test, vi } from "vitest";
import { tapSpecOf } from "../src/presenter/input/tap";
import { DEBUG_BUTTONS, DEBUG_BUTTONS_M10, DEBUG_BUTTONS_M11, DEBUG_BUTTONS_M5, DEBUG_BUTTONS_M7, DEBUG_POINTER, debugRow } from "../src/presenter/layout";
import { createSettingsStore, defaultSettings } from "../src/presenter/settings";
import type { StageLayout } from "../src/presenter/stage";
import { createDebugPanel, DEBUG_ROW_KEYS, debugRows, formatStageInfo, formatSwipeDebug, pointerRowsText, type StageInfoInput } from "../src/presenter/views/debug-panel";
import { formatMessage } from "../src/presenter/views/message";
import {
  attachPointerLog,
  createPointerLog,
  describeTarget,
  formatPointerRow,
  POINTER_KINDS,
  POINTER_LOG_MAX,
  POINTER_TARGET_MAX,
  type PointerEntry,
  type TargetLike,
} from "../src/presenter/input/pointer-log";
import { FakeNode, FakeStage } from "./helpers/dom";
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

  test("UI-57（M7）1 ページ目の計測値の右に「SAN+{n}」（DEBUG_BUTTONS_M7.sanOver。n は受け取った sanOver）。押すと onSanOver。1 ページ目の子で、line-height は内側の高さ（h−2）", () => {
    vi.stubGlobal("document", { createElement: () => new FakeEl(), createElementNS: () => new FakeEl() });
    const store = createSettingsStore(defaultSettings(data.config), () => {});
    const calls: string[] = [];
    const panel = createDebugPanel({
      strings: data.strings,
      store,
      defaults: defaultSettings(data.config),
      onClose: () => calls.push("close"),
      onHpOne: () => calls.push("hpOne"),
      onSanDown: () => calls.push("sanDown"),
      onWarp: (to) => calls.push(`warp:${to}`),
      onAddTurns: () => calls.push("addTurns"),
      addTurns: 200,
      onSanOver: () => calls.push("sanOver"),
      sanOver: 10,
      onGiveCursed: (wearable) => calls.push(`giveCursed:${wearable}`),
      onChest: (trapId) => calls.push(`chest:${trapId}`),
      chestTraps: data.chestTraps,
      pointers: () => [],
    });
    const root = panel.el as unknown as FakeEl;
    const [page1] = root.children.filter((c) => c.className === "debug-page") as [FakeEl];
    expect(data.strings["debug.sanOverButton"]).toBe("SAN+{n}");
    const b = page1.children.find((c) => c.className === "ui-button" && c.textContent === "SAN+10");
    expect(b).toBeDefined();
    const r = DEBUG_BUTTONS_M7.sanOver;
    expect([b!.style["left"], b!.style["top"], b!.style["width"], b!.style["height"], b!.style["lineHeight"]]).toEqual([`${r.x}px`, `${r.y}px`, `${r.w}px`, `${r.h}px`, `${r.h - 2}px`]);
    tapSpecOf(b!)!.onTap({ lx: 0, ly: 0 });
    expect(calls).toEqual(["sanOver"]);
    expect(root.children.includes(b!)).toBe(false);
  });

  test("UI-57（M10）1 ページ目の SAN+10 の下に「呪い:司可」「呪い:司否」（DEBUG_BUTTONS_M10）。押すと onGiveCursed(true / false)。1 ページ目の子で、計測値の長い行・設定の行・SAN+10 と重ならない", () => {
    vi.stubGlobal("document", { createElement: () => new FakeEl(), createElementNS: () => new FakeEl() });
    const store = createSettingsStore(defaultSettings(data.config), () => {});
    const calls: string[] = [];
    const panel = createDebugPanel({
      strings: data.strings,
      store,
      defaults: defaultSettings(data.config),
      onClose: () => calls.push("close"),
      onHpOne: () => calls.push("hpOne"),
      onSanDown: () => calls.push("sanDown"),
      onWarp: (to) => calls.push(`warp:${to}`),
      onAddTurns: () => calls.push("addTurns"),
      addTurns: 200,
      onSanOver: () => calls.push("sanOver"),
      sanOver: 10,
      onGiveCursed: (wearable) => calls.push(`giveCursed:${wearable}`),
      onChest: (trapId) => calls.push(`chest:${trapId}`),
      chestTraps: data.chestTraps,
      pointers: () => [],
    });
    const root = panel.el as unknown as FakeEl;
    const [page1] = root.children.filter((c) => c.className === "debug-page") as [FakeEl];
    for (const [key, r, call] of [
      ["debug.giveCursedWearButton", DEBUG_BUTTONS_M10.giveCursedWear, "giveCursed:true"],
      ["debug.giveCursedOtherButton", DEBUG_BUTTONS_M10.giveCursedOther, "giveCursed:false"],
    ] as const) {
      const b = page1.children.find((c) => c.className === "ui-button" && c.textContent === data.strings[key]);
      expect(b, key).toBeDefined();
      expect([b!.style["left"], b!.style["top"], b!.style["width"], b!.style["height"], b!.style["lineHeight"]]).toEqual([`${r.x}px`, `${r.y}px`, `${r.w}px`, `${r.h}px`, `${r.h - 2}px`]);
      calls.length = 0;
      tapSpecOf(b!)!.onTap({ lx: 0, ly: 0 });
      expect(calls, key).toEqual([call]);
      expect(root.children.includes(b!), key).toBe(false);
      // 計測値の行（x4 から、美咲の半角 4px。"viewport    411.4286 x 845.7143" の 31 字 = 124px）より右、SAN+10 より下、設定の行 0 より上
      expect(r.x).toBeGreaterThanOrEqual(4 + 31 * 4);
      expect(r.y).toBeGreaterThanOrEqual(DEBUG_BUTTONS_M7.sanOver.y + DEBUG_BUTTONS_M7.sanOver.h);
      expect(r.y + r.h).toBeLessThanOrEqual(debugRow(0).label.y);
      expect(r.x + r.w).toBeLessThanOrEqual(236);
    }
    const a = DEBUG_BUTTONS_M10.giveCursedWear;
    const b = DEBUG_BUTTONS_M10.giveCursedOther;
    expect(a.x + a.w <= b.x || b.x + b.w <= a.x).toBe(true);
  });

  test("UI-57（M11）1 ページ目の SAN+10 の左に「宝箱前」と「箱:{罠}」（DEBUG_BUTTONS_M11）。宝箱前は onWarp(chest)。箱は押すたびにラベルの罠で onChest を呼んでから次へ巡回する（なし → chest-traps.json の 8 種 → なし）。計測値の短い行・SAN+10・呪いのボタンと重ならない", () => {
    vi.stubGlobal("document", { createElement: () => new FakeEl(), createElementNS: () => new FakeEl() });
    const store = createSettingsStore(defaultSettings(data.config), () => {});
    const calls: string[] = [];
    const panel = createDebugPanel({
      strings: data.strings,
      store,
      defaults: defaultSettings(data.config),
      onClose: () => calls.push("close"),
      onHpOne: () => calls.push("hpOne"),
      onSanDown: () => calls.push("sanDown"),
      onWarp: (to) => calls.push(`warp:${to}`),
      onAddTurns: () => calls.push("addTurns"),
      addTurns: 200,
      onSanOver: () => calls.push("sanOver"),
      sanOver: 10,
      onGiveCursed: (wearable) => calls.push(`giveCursed:${wearable}`),
      onChest: (trapId) => calls.push(`chest:${trapId}`),
      chestTraps: data.chestTraps,
      pointers: () => [],
    });
    const root = panel.el as unknown as FakeEl;
    const [page1] = root.children.filter((c) => c.className === "debug-page") as [FakeEl];
    const at = (r: { x: number; y: number }) => page1.children.find((c) => c.className === "ui-button" && c.style["left"] === `${r.x}px` && c.style["top"] === `${r.y}px`);
    const shape = (b: FakeEl) => [b.style["left"], b.style["top"], b.style["width"], b.style["height"], b.style["lineHeight"]];
    const box = (r: { x: number; y: number; w: number; h: number }) => [`${r.x}px`, `${r.y}px`, `${r.w}px`, `${r.h}px`, `${r.h - 2}px`];

    expect(data.strings["debug.warpChestButton"]).toBe("宝箱前");
    const warp = at(DEBUG_BUTTONS_M11.warpChest)!;
    expect(warp.textContent).toBe("宝箱前");
    expect(shape(warp)).toEqual(box(DEBUG_BUTTONS_M11.warpChest));
    tapSpecOf(warp)!.onTap({ lx: 0, ly: 0 });
    expect(calls).toEqual(["warp:chest"]);

    const chest = at(DEBUG_BUTTONS_M11.chest)!;
    expect(shape(chest)).toEqual(box(DEBUG_BUTTONS_M11.chest));
    const label = (k: string | null) => formatMessage(data.strings["debug.chestButton"]!, { trap: k === null ? data.strings["debug.chestNone"]! : data.strings[`chest.trapName.${k}`]! });
    expect(label(null)).toBe("箱:なし");
    expect(label("paralysis_gas")).toBe("箱:麻痺ガス");
    const order = [null, ...data.chestTraps.map((c) => c.id), null];
    expect(order).toHaveLength(10);
    calls.length = 0;
    for (let i = 0; i < 9; i++) {
      expect(chest.textContent, `${i}`).toBe(label(order[i]!));
      tapSpecOf(chest)!.onTap({ lx: 0, ly: 0 });
      expect(chest.textContent, `${i}`).toBe(label(order[i + 1]!));
    }
    expect(calls).toEqual(order.slice(0, 9).map((k) => `chest:${k}`));
    expect(root.children.includes(chest)).toBe(false);

    // 計測値の 0〜2 行目（y42..71）は "deviceScale 1.7143" の 18 字（美咲の半角 4px で 72px、x4 から右端 76）まで
    const sanOver = DEBUG_BUTTONS_M7.sanOver;
    const rects = [DEBUG_BUTTONS_M11.warpChest, DEBUG_BUTTONS_M11.chest];
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(4 + 18 * 4);
      expect(r.y + r.h).toBeLessThanOrEqual(DEBUG_BUTTONS_M10.giveCursedWear.y);
      expect(r.x + r.w).toBeLessThanOrEqual(sanOver.x);
    }
    expect(DEBUG_BUTTONS_M11.warpChest.x + DEBUG_BUTTONS_M11.warpChest.w).toBeLessThanOrEqual(DEBUG_BUTTONS_M11.chest.x);
    // 最長のラベル（全角 8px・半角 4px）が内側の幅（枠 1px ×2 を除く）に入る
    const units = (s: string) => [...s].reduce((n, c) => n + (c.charCodeAt(0) < 0x80 ? 4 : 8), 0);
    const longest = Math.max(...order.map((k) => units(label(k))));
    expect(longest).toBe(44);
    expect(longest).toBeLessThanOrEqual(DEBUG_BUTTONS_M11.chest.w - 2);
    expect(units(data.strings["debug.warpChestButton"]!)).toBeLessThanOrEqual(DEBUG_BUTTONS_M11.warpChest.w - 2);
  });

  test("UI-57 1 ページ目の 2 段目（y376 の 44×22 ×5。M5・M5.5）: SAN段↓・イベント・罠の前・階段前・ターン+{n}。押すと onSanDown / onWarp(event|trap|stairsDown) / onAddTurns。1 ページ目の子なので 2 ページ目では見えない。line-height は内側の高さ（h−2）", () => {
    const created: FakeEl[] = [];
    vi.stubGlobal("document", {
      createElement: () => {
        const e = new FakeEl();
        created.push(e);
        return e;
      },
      createElementNS: () => new FakeEl(),
    });
    const store = createSettingsStore(defaultSettings(data.config), () => {});
    const calls: string[] = [];
    const panel = createDebugPanel({
      strings: data.strings,
      store,
      defaults: defaultSettings(data.config),
      onClose: () => calls.push("close"),
      onHpOne: () => calls.push("hpOne"),
      onSanDown: () => calls.push("sanDown"),
      onWarp: (to) => calls.push(`warp:${to}`),
      onAddTurns: () => calls.push("addTurns"),
      addTurns: data.config.town.tavernEventTurns,
      onSanOver: () => calls.push("sanOver"),
      sanOver: 10,
      onGiveCursed: (wearable) => calls.push(`giveCursed:${wearable}`),
      onChest: (trapId) => calls.push(`chest:${trapId}`),
      chestTraps: data.chestTraps,
      pointers: () => [],
    });
    const root = panel.el as unknown as FakeEl;
    const [page1] = root.children.filter((c) => c.className === "debug-page") as [FakeEl];
    const tap = (b: FakeEl): void => tapSpecOf(b)!.onTap({ lx: 0, ly: 0 });
    const want = [
      ["debug.sanDownButton", DEBUG_BUTTONS_M5.sanDown, "sanDown"],
      ["debug.warpEventButton", DEBUG_BUTTONS_M5.warpEvent, "warp:event"],
      ["debug.warpTrapButton", DEBUG_BUTTONS_M5.warpTrap, "warp:trap"],
      ["debug.warpStairsButton", DEBUG_BUTTONS_M5.warpStairs, "warp:stairsDown"],
      ["debug.addTurnsButton", DEBUG_BUTTONS_M5.addTurns, "addTurns"],
    ] as const;
    // ターン+ のラベルは debug.addTurnsButton「ターン+{n}」に config.town.tavernEventTurns（200）を入れたもの（美咲で 40px。内側の幅 42 に入る）
    const label = (k: string): string => (k === "debug.addTurnsButton" ? formatMessage(data.strings[k]!, { n: data.config.town.tavernEventTurns }) : data.strings[k]!);
    expect(want.map(([k]) => label(k))).toEqual(["SAN段↓", "イベント", "罠の前", "階段前", `ターン+${data.config.town.tavernEventTurns}`]);
    for (const [key, r, call] of want) {
      const b = page1.children.find((c) => c.className === "ui-button" && c.textContent === label(key));
      expect(b, key).toBeDefined();
      expect([b!.style["left"], b!.style["top"], b!.style["width"], b!.style["height"]]).toEqual([`${r.x}px`, `${r.y}px`, `${r.w}px`, `${r.h}px`]);
      // 高さ 22 では .ui-button の line-height 30px を内側の高さ 20（上下の枠 1px を除く）で上書きし、文字を縦の中央に置く
      // （実機(M5) で約 4.6px 下に寄っていた）
      expect(b!.style["lineHeight"], key).toBe(`${r.h - 2}px`);
      expect(b!.style["lineHeight"], key).toBe("20px");
      calls.length = 0;
      tap(b!);
      expect(calls, key).toEqual([call]);
      // パネルの直下（2 ページ目でも見えるもの）には置かない
      expect(root.children.includes(b!), key).toBe(false);
    }
  });

  test("UI-57/UI-36 ボタンの段は 全員HP1・既定に戻す・ポインタ・閉じる（DEBUG_BUTTONS の位置）。全員HP1 は onHpOne、オートの速さの行は 200 → 400 → 600 と巡回する。どれも onTap で登録する", () => {
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
    createDebugPanel({ strings: data.strings, store, defaults: defaultSettings(data.config), onClose: () => closed++, onHpOne: () => hpOne++, onSanDown: () => {}, onWarp: () => {}, onAddTurns: () => {}, addTurns: 200, onSanOver: () => {}, sanOver: 10, onGiveCursed: () => {}, onChest: () => {}, chestTraps: data.chestTraps, pointers: () => [] });
    const buttons = created.filter((e) => e.className === "ui-button");
    const byText = (t: string): FakeEl => buttons.find((b) => b.textContent === t)!;
    const tap = (b: FakeEl): void => tapSpecOf(b)!.onTap({ lx: 0, ly: 0 });
    const hp = byText(data.strings["debug.hpOneButton"]!);
    const reset = byText(data.strings["settings.reset"]!);
    const close = byText(data.strings["common.close"]!);
    const pointers = byText(data.strings["debug.pointersButton"]!);
    for (const [b, r] of [
      [hp, DEBUG_BUTTONS.hpOne],
      [reset, DEBUG_BUTTONS.reset],
      [pointers, DEBUG_BUTTONS.pointers],
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

  test("UI-57 「ポインタ」で 2 ページ目（題と 20 行、古い順）に切り替え、ボタンは「設定」になり 1 ページ目（全員HP1・既定に戻す を含む）を隠す。showSettings で 1 ページ目に戻る", () => {
    const created: FakeEl[] = [];
    vi.stubGlobal("document", {
      createElement: () => {
        const e = new FakeEl();
        created.push(e);
        return e;
      },
      createElementNS: () => new FakeEl(),
    });
    const store = createSettingsStore(defaultSettings(data.config), () => {});
    let entries: PointerEntry[] = [];
    const panel = createDebugPanel({ strings: data.strings, store, defaults: defaultSettings(data.config), onClose: () => {}, onHpOne: () => {}, onSanDown: () => {}, onWarp: () => {}, onAddTurns: () => {}, addTurns: 200, onSanOver: () => {}, sanOver: 10, onGiveCursed: () => {}, onChest: () => {}, chestTraps: data.chestTraps, pointers: () => entries });
    const root = panel.el as unknown as FakeEl;
    const pages = root.children.filter((c) => c.className === "debug-page");
    expect(pages).toHaveLength(2);
    const [page1, page2] = pages as [FakeEl, FakeEl];
    // 全員HP1・既定に戻す は 1 ページ目の中、ポインタ・閉じる はパネルの直下（どちらのページでも出る）
    expect(page1.children.map((c) => c.textContent)).toEqual(expect.arrayContaining([data.strings["debug.hpOneButton"], data.strings["settings.reset"]]));
    const toggle = root.children.find((c) => c.textContent === data.strings["debug.pointersButton"])!;
    expect(root.children.some((c) => c.textContent === data.strings["common.close"])).toBe(true);
    expect([page1.style["display"] ?? "", page2.style["display"]]).toEqual(["", "none"]);
    const rows = page2.children.filter((c) => c.className === "debug-pointer-row");
    expect(rows).toHaveLength(20);
    expect(rows.map((r) => r.style["top"])).toEqual(Array.from({ length: 20 }, (_, i) => `${DEBUG_POINTER.rowY + 10 * i}px`));
    expect(DEBUG_POINTER.rowY + 10 * 19 + 10).toBeLessThanOrEqual(DEBUG_BUTTONS.pointers.y);
    expect(page2.children.find((c) => c.className === "debug-pointer-title")!.textContent).toBe(data.strings["debug.pointer.title"]);
    entries = [
      { type: "pointerdown", x: 10, y: 20, t: 100, target: "button 前進" },
      { type: "pointerup", x: 10, y: 21, t: 900, target: "button 前進" },
    ];
    const tap = (b: FakeEl): void => tapSpecOf(b)!.onTap({ lx: 0, ly: 0 });
    tap(toggle);
    expect([page1.style["display"], page2.style["display"]]).toEqual(["none", ""]);
    expect(toggle.textContent).toBe(data.strings["debug.settingsButton"]);
    expect(rows.slice(0, 3).map((r) => r.textContent)).toEqual(["100 down 10,20 button 前進", "900 up 10,21 button 前進", ""]);
    tap(toggle);
    expect([page1.style["display"], page2.style["display"]]).toEqual(["", "none"]);
    expect(toggle.textContent).toBe(data.strings["debug.pointersButton"]);
    tap(toggle);
    panel.showSettings();
    expect([page1.style["display"], page2.style["display"]]).toEqual(["", "none"]);
  });
});

// ---------------------------------------------------------------- UI-57 ポインタの記録（input/pointer-log.ts）
class TextNode extends FakeNode {
  textContent: string | null = null;
}
const node = (tag: string, o: { parent?: FakeNode | null; attrs?: Record<string, string>; text?: string } = {}): TextNode => {
  const n = new TextNode(tag, o.parent ?? null);
  for (const [k, v] of Object.entries(o.attrs ?? {})) n.setAttribute(k, v);
  n.textContent = o.text ?? null;
  return n;
};
const entry = (i: number): PointerEntry => ({ type: "pointerdown", x: i, y: i, t: i, target: "div" });

describe("UI-57 ポインタの記録", () => {
  test("UI-57 pointer-log は 20 件の輪: 25 件 push すると 6..25 件目が古い順に残る。clear で空", () => {
    expect(POINTER_LOG_MAX).toBe(20);
    const log = createPointerLog();
    for (let i = 1; i <= 25; i++) log.push(entry(i));
    expect(log.entries().map((e) => e.t)).toEqual(Array.from({ length: 20 }, (_, i) => i + 6));
    log.clear();
    expect(log.entries()).toEqual([]);
  });

  test("UI-57 describeTarget: data-tap の祖先を優先し、aria-label > 文字 > tag.class の先頭。SVG（class 属性）も読む。16 文字で切る", () => {
    const btn = node("BUTTON", { attrs: { "data-tap": "", class: "ui-button is-pressed" }, text: "  前へ\n進む " });
    const inner = node("SPAN", { parent: btn, text: "x" });
    expect(describeTarget(inner as unknown as TargetLike)).toBe("button 前へ 進む");
    const dpad = node("BUTTON", { attrs: { "data-tap": "", "aria-label": "前進" }, text: "" });
    expect(describeTarget(dpad as unknown as TargetLike)).toBe("button 前進");
    const path = node("path", { attrs: { class: "map-cell wall" } });
    expect(describeTarget(path as unknown as TargetLike)).toBe("path.map-cell");
    expect(describeTarget(node("DIV") as unknown as TargetLike)).toBe("div");
    const long = node("DIV", { text: "abcdefghijklmnopqrstuvwxyz" });
    expect(describeTarget(long as unknown as TargetLike)).toBe("div abcdefghijkl");
    expect([...describeTarget(node("DIV", { text: "あいうえおかきくけこさしすせそ" }) as unknown as TargetLike)]).toHaveLength(POINTER_TARGET_MAX);
    expect(describeTarget(null)).toBe("-");
  });

  test("UI-57 attachPointerLog は capture で 4 種類を受け、pointermove は受けない。座標は (client - rect)/scale の四捨五入、時刻は整数。enabled が偽の間に始まった押下は up / lost も記録しない", () => {
    const stage = new FakeStage(10);
    stage.top = 20;
    const log = createPointerLog();
    let enabled = true;
    let now = 1234.6;
    const detach = attachPointerLog(stage as unknown as HTMLElement, { log, scale: () => 2, now: () => now, enabled: () => enabled });
    expect(Object.keys(stage.listeners).sort()).toEqual(["lostpointercapture", "pointercancel", "pointerdown", "pointerup"]);
    for (const l of Object.values(stage.listeners)) expect(l.map((x) => x.opt)).toEqual([{ capture: true }]);
    const btn = node("BUTTON", { attrs: { "data-tap": "" }, text: "設定" });
    const ev = (id: number, x: number, y: number) => ({ pointerId: id, clientX: x, clientY: y, target: btn });
    stage.emit("pointerdown", { type: "pointerdown", ...ev(1, 55, 41) });
    stage.emit("pointermove", { type: "pointermove", ...ev(1, 56, 41) });
    now = 1300.2;
    stage.emit("pointerup", { type: "pointerup", ...ev(1, 55, 41) });
    // ここで debug パネルが開いた: 開いたタップの lost、パネルの中の押下と、閉じたタップの後の lost は記録しない
    enabled = false;
    stage.emit("lostpointercapture", { type: "lostpointercapture", ...ev(1, 55, 41) });
    stage.emit("pointerdown", { type: "pointerdown", ...ev(2, 100, 100) });
    stage.emit("pointerup", { type: "pointerup", ...ev(2, 100, 100) });
    enabled = true;
    stage.emit("lostpointercapture", { type: "lostpointercapture", ...ev(2, 100, 100) });
    // 次の押下からはまた記録する（同じ pointerId でも）
    stage.emit("pointerdown", { type: "pointerdown", ...ev(2, 12, 22) });
    stage.emit("pointercancel", { type: "pointercancel", ...ev(2, 12, 22) });
    // x = (55 - 10) / 2 = 22.5 → 23、y = (41 - 20) / 2 = 10.5 → 11
    expect(log.entries()).toEqual([
      { type: "pointerdown", x: 23, y: 11, t: 1235, target: "button 設定" },
      { type: "pointerup", x: 23, y: 11, t: 1300, target: "button 設定" },
      { type: "pointerdown", x: 1, y: 1, t: 1300, target: "button 設定" },
      { type: "pointercancel", x: 1, y: 1, t: 1300, target: "button 設定" },
    ]);
    detach();
    expect(stage.count()).toBe(0);
  });

  test("UI-57 cancel / lost で clientX と clientY が両方 0（Chrome が座標を渡さない）なら座標は null で、行は「{t} {type} - {target}」。down / up の 0,0 と、片方だけ 0 の cancel は換算する", () => {
    const stage = new FakeStage(10);
    stage.top = 20;
    const log = createPointerLog();
    attachPointerLog(stage as unknown as HTMLElement, { log, scale: () => 2, now: () => 5, enabled: () => true });
    const btn = node("BUTTON", { attrs: { "data-tap": "" }, text: "前進" });
    const ev = (x: number, y: number) => ({ pointerId: 1, clientX: x, clientY: y, target: btn });
    stage.emit("pointerdown", { type: "pointerdown", ...ev(0, 0) });
    stage.emit("pointerup", { type: "pointerup", ...ev(0, 0) });
    stage.emit("pointercancel", { type: "pointercancel", ...ev(0, 0) });
    stage.emit("lostpointercapture", { type: "lostpointercapture", ...ev(0, 0) });
    stage.emit("pointercancel", { type: "pointercancel", ...ev(0, 40) });
    expect(log.entries().map((e) => [e.type, e.x, e.y])).toEqual([
      ["pointerdown", -5, -10],
      ["pointerup", -5, -10],
      ["pointercancel", null, null],
      ["lostpointercapture", null, null],
      ["pointercancel", -5, 10],
    ]);
    expect(data.strings["debug.pointer.rowNoPos"]).toBe("{t} {type} - {target}");
    expect(pointerRowsText(log.entries(), data.strings)).toEqual([
      "5 down -5,-10 button 前進",
      "5 up -5,-10 button 前進",
      "5 cancel - button 前進",
      "5 lost - button 前進",
      "5 cancel -5,10 button 前進",
    ]);
  });

  test("UI-57 formatPointerRow「{t} {type} {x},{y} {target}」（type は短い名前）。pointerRowsText は空なら「記録なし」の 1 行", () => {
    expect(formatPointerRow({ type: "lostpointercapture", x: 3, y: 390, t: 123456, target: "button 前進" }, data.strings)).toBe("123456 lost 3,390 button 前進");
    expect(POINTER_KINDS.map((k) => data.strings[`debug.pointer.${k}`])).toEqual(["down", "up", "cancel", "lost"]);
    expect(pointerRowsText([], data.strings)).toEqual([data.strings["debug.pointer.empty"]]);
    expect(pointerRowsText([entry(1), entry(2)], data.strings)).toEqual(["1 down 1,1 div", "2 down 2,2 div"]);
  });
});
