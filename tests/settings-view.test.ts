// UI-57 の設定画面（M6）。純粋な部分と、偽の document の DOM の部分。
import { afterEach, describe, expect, test, vi } from "vitest";
import { tapSpecOf } from "../src/presenter/input/tap";
import { regions, settingsLayout, TOUCH_MIN_LOGICAL, type Rect } from "../src/presenter/layout";
import { createSettingsStore, defaultSettings, type Settings } from "../src/presenter/settings";
import {
  createSettingsScreen,
  installGuideLines,
  SETTINGS_ROW_KEYS,
  settingsFileHint,
  settingsItems,
  settingsKeyIndex,
  settingsRows,
  settingsToggle,
  type SettingsContext,
} from "../src/presenter/views/settings";
import { data } from "./helpers/core";

const S = data.strings;
const D: Settings = defaultSettings(data.config);
const W = data.config.stage.width;
const H = data.config.stage.height;

const TITLE: SettingsContext = { canExport: false, canImport: true, where: "title", standalone: false };
const PLAY: SettingsContext = { canExport: true, canImport: false, where: "play", standalone: false };
const NONE: SettingsContext = { canExport: false, canImport: false, where: "none", standalone: false };

describe("設定画面の純粋な部分（UI-57）", () => {
  test("UI-57 settingsRows: 4 行（演出スキップ 入/切、文字速度 即時 / {ms}ms、オートの速さ {ms}ms、入力 両方など）", () => {
    const rows = settingsRows({ ...D, skipAnimations: false, textSpeed: 30, autoBeatMs: 400, inputMode: "both" }, S);
    expect(rows.map((r) => r.key)).toEqual(["skipAnimations", "textSpeed", "autoBeatMs", "inputMode"]);
    expect([...SETTINGS_ROW_KEYS]).toEqual(["skipAnimations", "textSpeed", "autoBeatMs", "inputMode"]);
    expect(rows).toEqual([
      { key: "skipAnimations", label: S["settings.skipAnimations"], value: S["settings.off"] },
      { key: "textSpeed", label: S["settings.textSpeed"], value: "30ms" },
      { key: "autoBeatMs", label: S["settings.autoBeatMs"], value: "400ms" },
      { key: "inputMode", label: S["settings.inputMode"], value: S["settings.inputMode.both"] },
    ]);
    const on = settingsRows({ ...D, skipAnimations: true, textSpeed: 0, autoBeatMs: 200, inputMode: "swipe" }, S);
    expect(on.map((r) => r.value)).toEqual([S["settings.on"], S["settings.textSpeed.instant"], "200ms", S["settings.inputMode.swipe"]]);
    // debug パネルの -/+ で入れた選択肢に無い値（50）もそのまま出す
    expect(settingsRows({ ...D, textSpeed: 50 }, S)[1]?.value).toBe("50ms");
  });

  test("UI-57 settingsToggle: skip は反転、textSpeed は nextTextSpeed、autoBeatMs は 200 → 400 → 600 → 200、inputMode は swipe → buttons → both", () => {
    expect(settingsToggle({ ...D, skipAnimations: false }, "skipAnimations")).toEqual({ skipAnimations: true });
    expect(settingsToggle({ ...D, skipAnimations: true }, "skipAnimations")).toEqual({ skipAnimations: false });
    expect([0, 15, 30, 60, 50].map((v) => settingsToggle({ ...D, textSpeed: v }, "textSpeed"))).toEqual([
      { textSpeed: 15 },
      { textSpeed: 30 },
      { textSpeed: 60 },
      { textSpeed: 0 },
      { textSpeed: 60 },
    ]);
    expect([200, 400, 600].map((v) => settingsToggle({ ...D, autoBeatMs: v }, "autoBeatMs"))).toEqual([{ autoBeatMs: 400 }, { autoBeatMs: 600 }, { autoBeatMs: 200 }]);
    expect((["swipe", "buttons", "both"] as const).map((m) => settingsToggle({ ...D, inputMode: m }, "inputMode"))).toEqual([
      { inputMode: "buttons" },
      { inputMode: "both" },
      { inputMode: "swipe" },
    ]);
  });

  test("UI-57/SV-31 settingsItems: title は 書き出し dim・読み込み 可、play は 書き出し 可・読み込み dim、none は両方 dim。並びは 4 行 → 書き出し → 読み込み → 開発用 → 閉じる", () => {
    const rows = SETTINGS_ROW_KEYS.map((key) => ({ kind: "row", key }));
    expect(settingsItems(TITLE)).toEqual([...rows, { kind: "export", disabled: true }, { kind: "import", disabled: false }, { kind: "debug" }, { kind: "close" }]);
    expect(settingsItems(PLAY)).toEqual([...rows, { kind: "export", disabled: false }, { kind: "import", disabled: true }, { kind: "debug" }, { kind: "close" }]);
    expect(settingsItems(NONE)).toEqual([...rows, { kind: "export", disabled: true }, { kind: "import", disabled: true }, { kind: "debug" }, { kind: "close" }]);
    // 遊んでいる途中でも current が無ければ（canExport 偽）書き出しは dim
    expect(settingsItems({ ...PLAY, canExport: false })[4]).toEqual({ kind: "export", disabled: true });
    // 案内の欄の既定の文
    expect(settingsFileHint(TITLE, S)).toBe(S["settings.fileHintTitle"]);
    expect(settingsFileHint(PLAY, S)).toBe(S["settings.fileHintPlay"]);
    expect(settingsFileHint(NONE, S)).toBe(S["settings.fileHintNone"]);
  });

  test("UI-33 settingsKeyIndex: 数字 n → n 番目、dim は null、Esc / Enter → 閉じる、範囲外は null", () => {
    const play = settingsItems(PLAY);
    expect(settingsKeyIndex({ menu: 0 }, play)).toBe(0);
    expect(settingsKeyIndex({ menu: 3 }, play)).toBe(3);
    expect(settingsKeyIndex({ menu: 4 }, play)).toBe(4); // 書き出し（可）
    expect(settingsKeyIndex({ menu: 5 }, play)).toBeNull(); // 読み込み（dim）
    expect(settingsKeyIndex({ menu: 6 }, play)).toBe(6); // 開発用
    expect(settingsKeyIndex({ menu: 7 }, play)).toBe(7); // 閉じる
    expect(settingsKeyIndex({ menu: 8 }, play)).toBeNull();
    expect(settingsKeyIndex("back", play)).toBe(7);
    expect(settingsKeyIndex("confirm", play)).toBe(7);
    const title = settingsItems(TITLE);
    expect(settingsKeyIndex({ menu: 4 }, title)).toBeNull();
    expect(settingsKeyIndex({ menu: 5 }, title)).toBe(5);
    for (const a of ["forward", "left", "right", "around", "map", "debug"] as const) expect(settingsKeyIndex(a, play), a).toBeNull();
  });

  test("UI-57/UI-11 settingsLayout: 閉じるは操作領域の x178・y54 の 56×40（既定 178,354）、全部の押せる矩形の一辺が TOUCH_MIN_LOGICAL 以上、ステージ（240×400）に収まり、互いに重ならない", () => {
    const g = regions(data.config.ui.layout, W);
    const L = settingsLayout(g);
    expect(L.close).toEqual({ x: g.controls.x + 178, y: g.controls.y + 54, w: 56, h: 40 });
    expect(L.close).toEqual({ x: 178, y: 354, w: 56, h: 40 });
    expect(L.debug).toEqual({ x: 4, y: 354, w: 80, h: 40 });
    expect(L.heading).toEqual({ x: 4, y: 4, w: 232, h: 12 });
    expect(L.rows).toEqual([0, 1, 2, 3].map((i) => ({ label: { x: 4, y: 20 + 34 * i, w: 128, h: 32 }, toggle: { x: 136, y: 20 + 34 * i, w: 100, h: 32 } })));
    expect(L.exportButton).toEqual({ x: 8, y: 158, w: 108, h: 32 });
    expect(L.importButton).toEqual({ x: 124, y: 158, w: 108, h: 32 });
    expect(L.notice).toEqual({ x: 4, y: 194, w: 232, h: 20 });
    expect(L.install).toEqual({ x: 4, y: 218, w: 232, h: 132 });
    const inside = (r: Rect): boolean => r.x >= 0 && r.y >= 0 && r.x + r.w <= W && r.y + r.h <= H;
    const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const pressable: Array<[string, Rect]> = [
      ...L.rows.map((r, i): [string, Rect] => [`toggle${i}`, r.toggle]),
      ["export", L.exportButton],
      ["import", L.importButton],
      ["debug", L.debug],
      ["close", L.close],
    ];
    for (const [name, r] of pressable) expect(Math.min(r.w, r.h), name).toBeGreaterThanOrEqual(TOUCH_MIN_LOGICAL);
    const all: Array<[string, Rect]> = [
      ["heading", L.heading],
      ...L.rows.map((r, i): [string, Rect] => [`label${i}`, r.label]),
      ...pressable,
      ["notice", L.notice],
      ["install", L.install],
    ];
    for (const [name, r] of all) expect(inside(r), name).toBe(true);
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) expect(overlaps(all[i]![1], all[j]![1]), `${all[i]![0]} ${all[j]![0]}`).toBe(false);
    // 区切りを変えても閉じるは操作領域に付いていく
    const g2 = regions({ header: 16, view: 140, message: 70, party: 64, controls: 110 }, W);
    expect(settingsLayout(g2).close).toEqual({ x: 178, y: 290 + 54, w: 56, h: 40 });
  });

  test("UI-57 設定画面の文言が strings にある（案内の欄は 2 行 = 全角 56 字以内）", () => {
    for (const k of [
      "settings.title",
      "settings.textSpeed.instant",
      "settings.debug",
      "settings.fileHintTitle",
      "settings.fileHintPlay",
      "settings.fileHintNone",
      "settings.exportDone",
      "settings.exportFailed",
      "settings.skipAnimations",
      "settings.textSpeed",
      "settings.autoBeatMs",
      "settings.inputMode",
      "title.export",
      "title.import",
      "common.close",
    ]) {
      expect(S[k], k).toBeTypeOf("string");
    }
    for (const k of ["settings.fileHintTitle", "settings.fileHintPlay", "settings.fileHintNone", "settings.exportDone", "settings.exportFailed"]) {
      expect([...S[k]!].length, k).toBeLessThanOrEqual(56);
    }
  });
});

// ---------------------------------------------------------------- DOM（偽の document）
class FakeEl {
  style: Record<string, string> = {};
  className = "";
  textContent = "";
  type = "";
  accept = "";
  disabled = false;
  value = "";
  files: unknown[] | null = null;
  clicks = 0;
  readonly attrs = new Map<string, string>();
  readonly listeners = new Map<string, Array<() => void>>();
  children: FakeEl[] = [];
  constructor(public tagName: string) {}
  setAttribute(k: string, v: string): void {
    this.attrs.set(k, v);
  }
  removeAttribute(k: string): void {
    this.attrs.delete(k);
  }
  replaceChildren(...cs: FakeEl[]): void {
    this.children = [...cs];
  }
  appendChild(c: FakeEl): FakeEl {
    this.children.push(c);
    return c;
  }
  addEventListener(t: string, f: () => void): void {
    this.listeners.set(t, [...(this.listeners.get(t) ?? []), f]);
  }
  emit(t: string): void {
    for (const f of this.listeners.get(t) ?? []) f();
  }
  click(): void {
    this.clicks++;
  }
  blur(): void {}
}

describe("createSettingsScreen（UI-57 / UI-36）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const setup = () => {
    vi.stubGlobal("document", { createElement: (tag: string) => new FakeEl(tag.toUpperCase()) });
    const persisted: Settings[] = [];
    const store = createSettingsStore({ ...D, textSpeed: 30 }, (s) => persisted.push(s));
    const calls: string[] = [];
    const files: unknown[] = [];
    const L = settingsLayout(regions(data.config.ui.layout, W));
    const view = createSettingsScreen({
      strings: S,
      store,
      layout: L,
      onExport: () => calls.push("export"),
      onImportFile: (f) => files.push(f),
      onDebug: () => calls.push("debug"),
      onClose: () => calls.push("close"),
    });
    const root = view.el as unknown as FakeEl;
    const at = (r: Rect): FakeEl[] => root.children.filter((c) => c.style["left"] === `${r.x}px` && c.style["top"] === `${r.y}px`);
    const buttonAt = (r: Rect): FakeEl => at(r).find((c) => c.tagName === "BUTTON" || c.className === "ui-button")!;
    const tap = (b: FakeEl): void => tapSpecOf(b)!.onTap({ lx: 0, ly: 0 });
    return { store, persisted, calls, files, L, view, root, at, buttonAt, tap };
  };

  test("UI-57/UI-36 createSettingsScreen: 行の toggle を押すと store が変わり（文字速度 30 → 60）、開発用で onDebug、閉じるで onClose、書き出しで onExport。dim の項目は押しても呼ばない。どれも onTap で登録（読み込みを除く）", () => {
    const { store, persisted, calls, files, L, view, root, buttonAt, tap } = setup();
    expect(root.className).toBe("settings-screen");
    view.render(PLAY, null);
    // 見出し
    expect(root.children.some((c) => c.textContent === S["settings.title"])).toBe(true);
    // 4 行の値
    const toggles = L.rows.map((r) => buttonAt(r.toggle));
    expect(toggles.map((b) => b.textContent)).toEqual([S["settings.off"], "30ms", "400ms", S["settings.inputMode.both"]]);
    for (const b of toggles) expect(tapSpecOf(b)).not.toBeNull();
    // 文字速度 30 → 60（store.set → persist。値の描き直しは app の store 購読者が refresh を呼ぶ）
    tap(toggles[1]!);
    expect(store.get().textSpeed).toBe(60);
    expect(persisted.at(-1)?.textSpeed).toBe(60);
    view.refresh();
    expect(toggles[1]!.textContent).toBe("60ms");
    tap(toggles[1]!);
    view.refresh();
    expect(toggles[1]!.textContent).toBe(S["settings.textSpeed.instant"]);
    tap(toggles[0]!);
    expect(store.get().skipAnimations).toBe(true);
    tap(toggles[2]!);
    expect(store.get().autoBeatMs).toBe(600);
    tap(toggles[3]!);
    expect(store.get().inputMode).toBe("swipe");
    // 書き出し（play では押せる）・開発用・閉じる
    const exp = buttonAt(L.exportButton);
    expect(exp.textContent).toBe(S["title.export"]);
    tap(exp);
    const dbg = buttonAt(L.debug);
    expect(dbg.textContent).toBe(S["settings.debug"]);
    // 高さ 40 のボタンは内側の高さ（h − 2）で縦の中央
    expect(dbg.style["lineHeight"]).toBe("38px");
    tap(dbg);
    const close = buttonAt(L.close);
    expect(close.textContent).toBe(S["common.close"]);
    expect([close.style["left"], close.style["top"], close.style["width"], close.style["height"]]).toEqual(["178px", "354px", "56px", "40px"]);
    tap(close);
    expect(calls).toEqual(["export", "debug", "close"]);
    // 読み込み（play では dim）: onTap を付けない、input は disabled
    const imp = buttonAt(L.importButton);
    expect(tapSpecOf(imp)).toBeNull();
    const input = imp.children.find((c) => c.tagName === "INPUT")!;
    expect(input.type).toBe("file");
    expect(tapSpecOf(input)).toBeNull();
    expect(input.disabled).toBe(true);
    expect(imp.attrs.get("aria-disabled")).toBe("true");
    // 案内の欄（既定は fileHintPlay、上書きはその文）
    expect(root.children.some((c) => c.textContent === S["settings.fileHintPlay"])).toBe(true);
    view.render(PLAY, S["settings.exportDone"]!);
    expect(root.children.some((c) => c.textContent === S["settings.exportDone"])).toBe(true);
    // タイトルから: 書き出しは dim で押しても呼ばない、読み込みは押せて change でファイルを渡す
    calls.length = 0;
    view.render(TITLE, null);
    expect(exp.attrs.get("aria-disabled")).toBe("true");
    expect(exp.style["color"]).toBe("var(--c-dim)");
    tap(exp);
    expect(calls).toEqual([]);
    expect(input.disabled).toBe(false);
    const file = { name: "x.json" };
    input.files = [file];
    input.emit("change");
    expect(files).toEqual([file]);
    expect(root.children.some((c) => c.textContent === S["settings.fileHintTitle"])).toBe(true);
  });

  test("UI-33 select(i): 行は巡回、書き出し・開発用・閉じるはそれぞれを呼び、読み込みは input.click()。dim の項目は何もしない", () => {
    const { store, calls, L, view, buttonAt } = setup();
    view.render(TITLE, null);
    const input = buttonAt(L.importButton).children.find((c) => c.tagName === "INPUT")!;
    view.select(1);
    expect(store.get().textSpeed).toBe(60);
    view.select(4); // 書き出し（title では dim）
    expect(calls).toEqual([]);
    view.select(5); // 読み込み
    expect(input.clicks).toBe(1);
    view.select(6);
    view.select(7);
    view.select(99);
    expect(calls).toEqual(["debug", "close"]);
    view.render(PLAY, null);
    view.select(4);
    view.select(5); // 読み込み（play では dim）
    expect(calls).toEqual(["debug", "close", "export"]);
    expect(input.clicks).toBe(1);
  });
});

describe("ホーム画面への追加の案内（SV-40）", () => {
  /** 全角 1 字 = 8px（1 単位）、半角（ASCII）= 4px（0.5 単位）で、幅 w 単位で字単位に折り返した行数（break-all と同じ） */
  const wrappedLines = (text: string, w: number): number => {
    let lines = 1;
    let cur = 0;
    for (const ch of text) {
      const cw = (ch.codePointAt(0) ?? 0) < 0x80 ? 0.5 : 1;
      if (cur + cw > w) {
        lines++;
        cur = 0;
      }
      cur += cw;
    }
    return lines;
  };

  test("SV-40 installGuideLines: standalone なら done の 1 行、そうでなければ 見出し・理由・iPhone・Android・保存が別 の 5 項目", () => {
    expect(installGuideLines(true, S)).toEqual([S["settings.install.done"]]);
    expect(installGuideLines(false, S)).toEqual([
      S["settings.install.heading"],
      S["settings.install.why"],
      S["settings.install.ios"],
      S["settings.install.android"],
      S["settings.install.move"],
    ]);
    for (const k of ["settings.install.heading", "settings.install.why", "settings.install.ios", "settings.install.android", "settings.install.move", "settings.install.done"]) {
      expect(S[k], k).toBeTypeOf("string");
    }
    // 理由には iPhone の端のスワイプの「戻る」が無くなる旨を含める（ユーザー決定 2026-10-04）
    expect(S["settings.install.why"]).toContain("スワイプ");
  });

  test("SV-40 installGuideLines を 29 字で折り返した行数が settingsLayout の install の高さ / 10 以下", () => {
    const L = settingsLayout(regions(data.config.ui.layout, W));
    const cols = L.install.w / 8;
    expect(cols).toBe(29);
    const total = installGuideLines(false, S).reduce((n, l) => n + wrappedLines(l, cols), 0);
    expect(total).toBeLessThanOrEqual(L.install.h / 10);
    expect(installGuideLines(true, S).reduce((n, l) => n + wrappedLines(l, cols), 0)).toBeLessThanOrEqual(L.install.h / 10);
  });

  test("SV-40 createSettingsScreen: standalone でなければ install の欄に 5 項目（見出しは accent）、standalone なら done の 1 行", () => {
    vi.stubGlobal("document", { createElement: (tag: string) => new FakeEl(tag.toUpperCase()) });
    const L = settingsLayout(regions(data.config.ui.layout, W));
    const view = createSettingsScreen({
      strings: S,
      store: createSettingsStore(D, () => {}),
      layout: L,
      onExport: () => {},
      onImportFile: () => {},
      onDebug: () => {},
      onClose: () => {},
    });
    const root = view.el as unknown as FakeEl;
    const install = root.children.find((c) => c.className === "settings-install")!;
    expect([install.style["left"], install.style["top"], install.style["width"], install.style["height"]]).toEqual(["4px", "218px", "232px", "132px"]);
    view.render(TITLE, null);
    expect(install.children.map((c) => c.textContent)).toEqual(installGuideLines(false, S));
    expect(install.children[0]!.style["color"]).toBe("var(--c-accent)");
    expect(tapSpecOf(install)).toBeNull();
    view.render({ ...TITLE, standalone: true }, null);
    expect(install.children.map((c) => c.textContent)).toEqual([S["settings.install.done"]]);
  });
});
