// UI-57 の設定画面（M6）。純粋な部分と、偽の document の DOM の部分。
import { afterEach, describe, expect, test, vi } from "vitest";
import { tapSpecOf } from "../src/presenter/input/tap";
import { isTouchException, regions, settingsLayout, TOUCH_MIN_LOGICAL, type Rect } from "../src/presenter/layout";
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
  settingsVolumeText,
  BUILD_ID,
  settingsBuildText,
  VOLUME_KEYS,
  type SettingsContext,
} from "../src/presenter/views/settings";
import { data } from "./helpers/core";
import { kinsokuLines } from "./helpers/wrap";
import { textUnits } from "../src/presenter/views/party-band";

const S = data.strings;
const D: Settings = defaultSettings(data.config);
const W = data.config.stage.width;
const H = data.config.stage.height;

// M19 D-3: タイトルからも用語を開ける（以前は canRules 偽）
const TITLE: SettingsContext = { canExport: false, canImport: true, where: "title", standalone: false, canRules: true };
const PLAY: SettingsContext = { canExport: true, canImport: false, where: "play", standalone: false, canRules: true };
const NONE: SettingsContext = { canExport: false, canImport: false, where: "none", standalone: false, canRules: false };

describe("設定画面の純粋な部分（UI-57）", () => {
  test("UI-57 settingsRows: 7 行（演出スキップ 入/切、文字速度 即時 / {ms}ms、オートの速さ {ms}ms、入力 両方など、再生の進め方 タップで送る / 自動で流す（M16）、GM の助言 多め / 少なめ / なし（M20 D-7）、オートの呪文 使う / 使わない（M21 CB-47））", () => {
    const rows = settingsRows({ ...D, skipAnimations: false, textSpeed: 30, autoBeatMs: 400, inputMode: "both", beatAdvance: "tap", hints: "more" }, S);
    expect(rows.map((r) => r.key)).toEqual(["skipAnimations", "textSpeed", "autoBeatMs", "inputMode", "beatAdvance", "hints", "autoSpells"]);
    expect([...SETTINGS_ROW_KEYS]).toEqual(["skipAnimations", "textSpeed", "autoBeatMs", "inputMode", "beatAdvance", "hints", "autoSpells"]);
    expect(rows).toEqual([
      { key: "skipAnimations", label: S["settings.skipAnimations"], value: S["settings.off"] },
      { key: "textSpeed", label: S["settings.textSpeed"], value: S["settings.textSpeed.normal"] },
      { key: "autoBeatMs", label: S["settings.autoBeatMs"], value: "400ms" },
      { key: "inputMode", label: S["settings.inputMode"], value: S["settings.inputMode.both"] },
      { key: "beatAdvance", label: S["settings.beatAdvance"], value: S["settings.beatAdvance.tap"] },
      { key: "hints", label: S["settings.hints"], value: S["settings.hints.more"] },
      { key: "autoSpells", label: S["settings.autoSpells"], value: S["settings.autoSpells.on"] },
    ]);
    expect([S["settings.autoSpells"], S["settings.autoSpells.on"], S["settings.autoSpells.off"]]).toEqual(["オートの呪文", "使う", "使わない"]);
    expect([S["settings.hints"], S["settings.hints.more"], S["settings.hints.less"], S["settings.hints.none"]]).toEqual(["GM の助言", "多め", "少なめ", "なし"]);
    expect([S["settings.beatAdvance"], S["settings.beatAdvance.tap"], S["settings.beatAdvance.timed"]]).toEqual(["再生の進め方", "タップで送る", "自動で流す"]);
    const on = settingsRows({ ...D, skipAnimations: true, textSpeed: 0, autoBeatMs: 200, inputMode: "swipe", beatAdvance: "timed", hints: "none", autoSpells: false }, S);
    expect(on.map((r) => r.value)).toEqual([S["settings.on"], S["settings.textSpeed.instant"], "200ms", S["settings.inputMode.swipe"], S["settings.beatAdvance.timed"], S["settings.hints.none"], S["settings.autoSpells.off"]]);
    expect(settingsRows({ ...D, hints: "less" }, S)[5]?.value).toBe(S["settings.hints.less"]);
    // ラベルの枠（128px = 全角 16 字 = 32 単位）と値の枠（22 単位）に収まる
    for (const h of ["more", "less", "none"] as const) {
      const row = settingsRows({ ...D, hints: h }, S)[5]!;
      expect(textUnits(row.label)).toBeLessThanOrEqual(32);
      expect(textUnits(row.value)).toBeLessThanOrEqual(22);
    }
    // M21: オートの呪文の行も同じ枠に収まる（最悪は「使わない」）
    for (const v of [true, false]) {
      const row = settingsRows({ ...D, autoSpells: v }, S)[6]!;
      expect(textUnits(row.label)).toBeLessThanOrEqual(32);
      expect(textUnits(row.value)).toBeLessThanOrEqual(22);
    }
    // debug パネルの -/+ で入れた選択肢に無い値（50）もそのまま出す
    expect(settingsRows({ ...D, textSpeed: 50 }, S)[1]?.value).toBe("50ms");
  });

  test("UI-57（M18 設計 5-7）文字速度は 即時 0 / 速い 15 / 普通 30 / 遅い 60 の言葉で出し（値は ms のまま。選択肢に無い値は {ms}ms）、入力の both は「スワイプとボタン」。値はトグルの枠（100px = 余白込みで全角 11 字 = 22 単位）に収まる", () => {
    const speed = (n: number): string | undefined => settingsRows({ ...D, textSpeed: n }, S)[1]?.value;
    expect([0, 15, 30, 60].map(speed)).toEqual(["即時", "速い", "普通", "遅い"]);
    expect([S["settings.textSpeed.instant"], S["settings.textSpeed.fast"], S["settings.textSpeed.normal"], S["settings.textSpeed.slow"]]).toEqual(["即時", "速い", "普通", "遅い"]);
    expect([10, 50, 100].map(speed)).toEqual(["10ms", "50ms", "100ms"]);
    // 巡回の順と保存の値は変えない（0 → 15 → 30 → 60 → 0）
    expect([0, 15, 30, 60].map((v) => settingsToggle({ ...D, textSpeed: v }, "textSpeed"))).toEqual([{ textSpeed: 15 }, { textSpeed: 30 }, { textSpeed: 60 }, { textSpeed: 0 }]);
    expect(S["settings.inputMode.both"]).toBe("スワイプとボタン");
    expect(settingsRows({ ...D, inputMode: "both" }, S)[3]?.value).toBe("スワイプとボタン");
    for (const m of ["swipe", "buttons", "both"] as const) for (const n of [0, 15, 30, 60, 100]) {
      for (const r of settingsRows({ ...D, inputMode: m, textSpeed: n }, S)) expect(textUnits(r.value), r.value).toBeLessThanOrEqual(22);
    }
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
    expect(settingsToggle({ ...D, beatAdvance: "tap" }, "beatAdvance")).toEqual({ beatAdvance: "timed" });
    expect(settingsToggle({ ...D, beatAdvance: "timed" }, "beatAdvance")).toEqual({ beatAdvance: "tap" });
    // M20（D-7）: GM の助言は more → less → none → more
    expect((["more", "less", "none"] as const).map((h) => settingsToggle({ ...D, hints: h }, "hints"))).toEqual([{ hints: "less" }, { hints: "none" }, { hints: "more" }]);
    // M21（CB-47）: オートの呪文は反転
    expect(settingsToggle({ ...D, autoSpells: true }, "autoSpells")).toEqual({ autoSpells: false });
    expect(settingsToggle({ ...D, autoSpells: false }, "autoSpells")).toEqual({ autoSpells: true });
  });

  test("UI-57/SV-31 settingsItems: title は 書き出し dim・読み込み 可、play は 書き出し 可・読み込み dim、none は両方 dim。並びは 7 行（M21）→ 曲 → 効果音 → 書き出し → 読み込み → 開発用 → 閉じる", () => {
    const rows = [
      ...SETTINGS_ROW_KEYS.map((key) => ({ kind: "row", key })),
      { kind: "volume", key: "musicVolume" },
      { kind: "volume", key: "sfxVolume" },
    ];
    expect([...VOLUME_KEYS]).toEqual(["musicVolume", "sfxVolume"]);
    expect(settingsItems(TITLE)).toEqual([...rows, { kind: "export", disabled: true }, { kind: "import", disabled: false }, { kind: "debug" }, { kind: "close" }]);
    expect(settingsItems(PLAY)).toEqual([...rows, { kind: "export", disabled: false }, { kind: "import", disabled: true }, { kind: "debug" }, { kind: "close" }]);
    expect(settingsItems(NONE)).toEqual([...rows, { kind: "export", disabled: true }, { kind: "import", disabled: true }, { kind: "debug" }, { kind: "close" }]);
    // 遊んでいる途中でも current が無ければ（canExport 偽）書き出しは dim
    expect(settingsItems({ ...PLAY, canExport: false })[9]).toEqual({ kind: "export", disabled: true });
    // 案内の欄の既定の文
    expect(settingsFileHint(TITLE, S)).toBe(S["settings.fileHintTitle"]);
    expect(settingsFileHint(PLAY, S)).toBe(S["settings.fileHintPlay"]);
    expect(settingsFileHint(NONE, S)).toBe(S["settings.fileHintNone"]);
  });

  test("UI-33 settingsKeyIndex: 数字 n → n 番目（5 が再生の進め方、6 が GM の助言（M20）、7 がオートの呪文（M21）、8・9 が曲・効果音）、dim は null、Esc / Enter → 閉じる（13 番目。書き出しは 10 番目・読み込みは 11 番目・開発用は 12 番目で数字では届かない）、範囲外は null", () => {
    const play = settingsItems(PLAY);
    expect(play).toHaveLength(13);
    expect(settingsKeyIndex({ menu: 0 }, play)).toBe(0);
    expect(settingsKeyIndex({ menu: 3 }, play)).toBe(3);
    expect(settingsKeyIndex({ menu: 4 }, play)).toBe(4); // 再生の進め方（数字キー 5）
    expect(play[4]).toEqual({ kind: "row", key: "beatAdvance" });
    expect(settingsKeyIndex({ menu: 5 }, play)).toBe(5); // GM の助言（数字キー 6）
    expect(play[5]).toEqual({ kind: "row", key: "hints" });
    expect(settingsKeyIndex({ menu: 6 }, play)).toBe(6); // オートの呪文（数字キー 7。M21）
    expect(play[6]).toEqual({ kind: "row", key: "autoSpells" });
    expect(settingsKeyIndex({ menu: 7 }, play)).toBe(7); // 曲
    expect(play[7]).toEqual({ kind: "volume", key: "musicVolume" });
    expect(settingsKeyIndex({ menu: 8 }, play)).toBe(8); // 効果音（数字キー 9）
    expect(play[8]).toEqual({ kind: "volume", key: "sfxVolume" });
    expect(settingsKeyIndex({ menu: 9 }, play)).toBe(9); // 書き出し（可。10 番目。数字キーでは届かず、押すだけ）
    expect(play[9]).toEqual({ kind: "export", disabled: false });
    expect(settingsKeyIndex({ menu: 10 }, play)).toBeNull(); // 読み込み（dim）
    expect(play[11]).toEqual({ kind: "debug" }); // 開発用（12 番目。F2 で開く）
    expect(settingsKeyIndex({ menu: 12 }, play)).toBe(12); // 閉じる
    expect(settingsKeyIndex({ menu: 13 }, play)).toBeNull();
    expect(settingsKeyIndex("back", play)).toBe(12);
    expect(settingsKeyIndex("confirm", play)).toBe(12);
    const title = settingsItems(TITLE);
    expect(settingsKeyIndex({ menu: 9 }, title)).toBeNull();
    expect(settingsKeyIndex({ menu: 10 }, title)).toBe(10); // 読み込み（11 番目。数字キーでは届かず、押すだけ）
    for (const a of ["forward", "left", "right", "around", "map", "debug"] as const) expect(settingsKeyIndex(a, play), a).toBeNull();
  });

  test("UI-57/UI-11 settingsLayout: 閉じるは操作領域の x178・y54 の 56×40（既定 178,354）、全部の押せる矩形の一辺が TOUCH_MIN_LOGICAL 以上、ステージ（240×400）に収まり、互いに重ならない", () => {
    const g = regions(data.config.ui.layout, W);
    const L = settingsLayout(g);
    expect(L.close).toEqual({ x: g.controls.x + 178, y: g.controls.y + 54, w: 56, h: 40 });
    expect(L.close).toEqual({ x: 178, y: 354, w: 56, h: 40 });
    expect(L.debug).toEqual({ x: 4, y: 354, w: 80, h: 40 });
    // M18: 用語は開発用と閉じるの間（x88..174）の中央の 56×40
    expect(L.rules).toEqual({ x: 103, y: 354, w: 56, h: 40 });
    expect(L.rules.x).toBeGreaterThanOrEqual(L.debug.x + L.debug.w + 4);
    expect(L.rules.x + L.rules.w).toBeLessThanOrEqual(L.close.x - 4);
    expect(L.heading).toEqual({ x: 4, y: 4, w: 232, h: 12 });
    // M21（B-3）: 7 行（高さ 26 で y16+26i、i=0..6。UI-10 の例外 settings.row）。音量 y198、書き出し・読み込み y228（高さ 30）、案内 y259（1 行）、ホーム画面の案内 y270..349（8 行）のまま
    expect(L.rows).toEqual([0, 1, 2, 3, 4, 5, 6].map((i) => ({ label: { x: 4, y: 16 + 26 * i, w: 128, h: 26 }, toggle: { x: 136, y: 16 + 26 * i, w: 100, h: 26 } })));
    expect(L.volume).toEqual({ label: { x: 4, y: 198, w: 64, h: 30 }, music: { x: 72, y: 198, w: 80, h: 30 }, sfx: { x: 156, y: 198, w: 80, h: 30 } });
    expect(L.exportButton).toEqual({ x: 8, y: 228, w: 108, h: 30 });
    expect(L.importButton).toEqual({ x: 124, y: 228, w: 108, h: 30 });
    expect(L.notice).toEqual({ x: 4, y: 259, w: 232, h: 10 });
    expect(L.rows).toHaveLength(SETTINGS_ROW_KEYS.length);
    expect(L.install).toEqual({ x: 4, y: 270, w: 232, h: 80 });
    const inside = (r: Rect): boolean => r.x >= 0 && r.y >= 0 && r.x + r.w <= W && r.y + r.h <= H;
    const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const pressable: Array<[string, Rect]> = [
      ...L.rows.map((r, i): [string, Rect] => [`settings.row[${i}]`, r.toggle]),
      ["music", L.volume.music],
      ["sfx", L.volume.sfx],
      ["export", L.exportButton],
      ["import", L.importButton],
      ["debug", L.debug],
      ["rules", L.rules],
      ["close", L.close],
    ];
    // UI-10: 例外（M21 の settings.row。高さ 26）以外は TOUCH_MIN_LOGICAL 以上。例外は行の高さ 26 以上
    for (const [name, r] of pressable) expect(Math.min(r.w, r.h), name).toBeGreaterThanOrEqual(isTouchException(name) ? 26 : TOUCH_MIN_LOGICAL);
    expect(pressable.filter(([n]) => isTouchException(n)).map(([n]) => n)).toEqual([0, 1, 2, 3, 4, 5, 6].map((i) => `settings.row[${i}]`));
    const all: Array<[string, Rect]> = [
      ["heading", L.heading],
      ...L.rows.map((r, i): [string, Rect] => [`label${i}`, r.label]),
      ["volumeLabel", L.volume.label],
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

  test("UI-57 設定画面の文言が strings にある（案内の欄は 1 行 = 29 字で折り返して 1 行。M16 で 2 行から縮めた）", () => {
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
      "settings.beatAdvance",
      "settings.beatAdvance.tap",
      "settings.beatAdvance.timed",
      "settings.volume",
      "settings.volume.music",
      "settings.volume.sfx",
      "title.export",
      "title.import",
      "common.close",
    ]) {
      expect(S[k], k).toBeTypeOf("string");
    }
    for (const k of ["settings.fileHintTitle", "settings.fileHintPlay", "settings.fileHintNone", "settings.exportDone", "settings.exportFailed"]) {
      expect(kinsokuLines(S[k]!, 29), k).toHaveLength(1);
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
      onRules: () => calls.push("rules"),
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
    // 7 行の値（M20: 6 行目は GM の助言。既定 more。M21: 7 行目はオートの呪文。既定 使う）
    const toggles = L.rows.map((r) => buttonAt(r.toggle));
    expect(toggles.map((b) => b.textContent)).toEqual([S["settings.off"], S["settings.textSpeed.normal"], "400ms", S["settings.inputMode.both"], S["settings.beatAdvance.timed"], S["settings.hints.more"], S["settings.autoSpells.on"]]);
    // M21: 高さ 26 の行の toggle は内側の高さ（h − 2）で縦の中央、ラベルは行の高さ
    expect(toggles[0]!.style["lineHeight"]).toBe("24px");
    const labels = L.rows.map((r) => root.children.find((c) => c.className === "settings-label" && c.style["top"] === `${r.label.y}px` && c.style["left"] === `${r.label.x}px`)!);
    expect(labels.map((c) => c.style["lineHeight"])).toEqual(L.rows.map(() => "26px"));
    for (const b of toggles) expect(tapSpecOf(b)).not.toBeNull();
    // 文字速度 30 → 60（store.set → persist。値の描き直しは app の store 購読者が refresh を呼ぶ）
    tap(toggles[1]!);
    expect(store.get().textSpeed).toBe(60);
    expect(persisted.at(-1)?.textSpeed).toBe(60);
    view.refresh();
    expect(toggles[1]!.textContent).toBe(S["settings.textSpeed.slow"]);
    tap(toggles[1]!);
    view.refresh();
    expect(toggles[1]!.textContent).toBe(S["settings.textSpeed.instant"]);
    tap(toggles[0]!);
    expect(store.get().skipAnimations).toBe(true);
    tap(toggles[2]!);
    expect(store.get().autoBeatMs).toBe(600);
    tap(toggles[3]!);
    expect(store.get().inputMode).toBe("swipe");
    tap(toggles[4]!); // M18: 既定は timed。押すと tap
    expect(store.get().beatAdvance).toBe("tap");
    expect(persisted.at(-1)?.beatAdvance).toBe("tap");
    view.refresh();
    expect(toggles[4]!.textContent).toBe(S["settings.beatAdvance.tap"]);
    tap(toggles[5]!); // M20（D-7）: GM の助言 more → less
    expect(store.get().hints).toBe("less");
    expect(persisted.at(-1)?.hints).toBe("less");
    view.refresh();
    expect(toggles[5]!.textContent).toBe(S["settings.hints.less"]);
    tap(toggles[6]!); // M21（CB-47）: オートの呪文 使う → 使わない
    expect(store.get().autoSpells).toBe(false);
    expect(persisted.at(-1)?.autoSpells).toBe(false);
    view.refresh();
    expect(toggles[6]!.textContent).toBe(S["settings.autoSpells.off"]);
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

  test("UI-57/UI-77（M18。M19 D-3）「用語」のボタン: settings.rules「用語」が L.rules に（onTap。高さ 40 の行の高さ 38px）。canRules なら見えて押すと onRules（M19 からタイトルでも）、canRules 偽（設定の下に預けているとき）は隠れて押しても呼ばない。数字キーの並び（settingsItems）は変わらない", () => {
    const { calls, L, view, buttonAt, tap } = setup();
    expect(S["settings.rules"]).toBe("用語");
    const b = buttonAt(L.rules);
    expect(b.textContent).toBe(S["settings.rules"]);
    expect(tapSpecOf(b)).not.toBeNull();
    expect(b.style["lineHeight"]).toBe("38px");
    // 枠（56 − 枠と余白 8）に 8px の字で収まる
    expect([...S["settings.rules"]!].length * 8).toBeLessThanOrEqual(L.rules.w - 8);
    expect(b.style["display"]).toBe("none"); // 描く前は出さない
    view.render(PLAY, null);
    expect(b.style["display"]).toBe("");
    tap(b);
    expect(calls).toEqual(["rules"]);
    view.render(TITLE, null);
    expect(b.style["display"]).toBe("");
    tap(b);
    expect(calls).toEqual(["rules", "rules"]);
    view.render({ ...TITLE, canRules: false }, null);
    expect(b.style["display"]).toBe("none");
    tap(b);
    view.render({ ...PLAY, canRules: false }, null);
    expect(b.style["display"]).toBe("none");
    tap(b);
    expect(calls).toEqual(["rules", "rules"]);
    expect(settingsItems(TITLE)).toEqual(settingsItems({ ...TITLE, canRules: false }));
    expect(settingsItems(PLAY).some((it) => (it.kind as string) === "rules")).toBe(false);
    expect(settingsItems(PLAY)).toEqual(settingsItems({ ...PLAY, canRules: false }));
  });

  test("UI-57 音量の行: ラベル「音量」、トグル「曲 3」「効果音 2」（既定。onTap）。押すと 1 上がり、10 の次は 0（0 のときも数字のまま）", () => {
    const { store, persisted, L, view, at, buttonAt, tap } = setup();
    view.render(PLAY, null);
    expect(S["settings.volume"]).toBe("音量");
    expect(at(L.volume.label).map((e) => e.textContent)).toEqual([S["settings.volume"]]);
    const music = buttonAt(L.volume.music);
    const sfx = buttonAt(L.volume.sfx);
    expect([music.textContent, sfx.textContent]).toEqual(["曲 3", "効果音 2"]);
    expect(settingsVolumeText(store.get(), S)).toEqual({ musicVolume: "曲 3", sfxVolume: "効果音 2" });
    expect(tapSpecOf(music)).not.toBeNull();
    expect(tapSpecOf(sfx)).not.toBeNull();
    tap(music);
    expect(store.get().musicVolume).toBe(4);
    expect(persisted.at(-1)?.musicVolume).toBe(4);
    view.refresh();
    expect(music.textContent).toBe("曲 4");
    for (let i = 0; i < 6; i++) tap(music); // 5 → … → 10
    view.refresh();
    expect(music.textContent).toBe("曲 10");
    tap(music);
    view.refresh();
    expect(store.get().musicVolume).toBe(0);
    expect(music.textContent).toBe("曲 0");
    tap(sfx);
    view.refresh();
    expect(sfx.textContent).toBe("効果音 3");
  });

  test("UI-33 select(i): 行は巡回、書き出し・開発用・閉じるはそれぞれを呼び、読み込みは input.click()。dim の項目は何もしない", () => {
    const { store, calls, L, view, buttonAt } = setup();
    view.render(TITLE, null);
    const input = buttonAt(L.importButton).children.find((c) => c.tagName === "INPUT")!;
    view.select(1);
    expect(store.get().textSpeed).toBe(60);
    view.select(4); // 再生の進め方（M18: 既定 timed → tap）
    expect(store.get().beatAdvance).toBe("tap");
    view.select(5); // GM の助言（M20: 既定 more → less）
    expect(store.get().hints).toBe("less");
    view.select(6); // オートの呪文（M21: 既定 使う → 使わない）
    expect(store.get().autoSpells).toBe(false);
    view.select(7); // 曲
    expect(store.get().musicVolume).toBe(D.musicVolume + 1);
    view.select(8); // 効果音
    expect(store.get().sfxVolume).toBe(D.sfxVolume + 1);
    view.select(9); // 書き出し（title では dim）
    expect(calls).toEqual([]);
    view.select(10); // 読み込み
    expect(input.clicks).toBe(1);
    view.select(11);
    view.select(12);
    view.select(99);
    expect(calls).toEqual(["debug", "close"]);
    view.render(PLAY, null);
    view.select(9);
    view.select(10); // 読み込み（play では dim）
    expect(calls).toEqual(["debug", "close", "export"]);
    expect(input.clicks).toBe(1);
  });
});

describe("UI-57 / SV-40 設定の見出しの右端のビルドの版（M18。設計 5-11）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("UI-57 settingsBuildText は settings.build「版 {hash}」。vitest（serve）では define の値が \"dev\"", () => {
    expect(S["settings.build"]).toBe("版 {hash}");
    expect(settingsBuildText("abcdef0", S)).toBe("版 abcdef0");
    expect(BUILD_ID).toBe("dev");
    expect(settingsBuildText(BUILD_ID, S)).toBe("版 dev");
  });

  test("UI-57 見出しと版が見出しの行（x4 y4 232×12）の 1 行に重ならずに収まる（7 字の hex。1 単位 4px）", () => {
    const L = settingsLayout(regions(data.config.ui.layout, W));
    const title = textUnits(S["settings.title"]!) * 4;
    for (const b of ["0123456789abcdef".slice(0, 7), "fffffff", "dev"]) {
      const w = textUnits(settingsBuildText(b, S)) * 4;
      expect(title + 8 + w, b).toBeLessThanOrEqual(L.heading.w);
    }
  });

  test("UI-57 createSettingsScreen: 見出しと同じ矩形に settings-build の要素を置き、文は「版 {hash}」（タイトルから開いても遊んでいる途中でも同じ）。省けば BUILD_ID", () => {
    vi.stubGlobal("document", { createElement: (tag: string) => new FakeEl(tag.toUpperCase()) });
    const L = settingsLayout(regions(data.config.ui.layout, W));
    const make = (build?: string) =>
      createSettingsScreen({
        strings: S,
        store: createSettingsStore(D, () => {}),
        layout: L,
        onExport: () => {},
        onImportFile: () => {},
        onDebug: () => {},
        onRules: () => {},
        onClose: () => {},
        ...(build === undefined ? {} : { build }),
      });
    for (const ctx of [TITLE, PLAY]) {
      const view = make("1a2b3c4");
      view.render(ctx, null);
      const el = (view.el as unknown as FakeEl).children.find((c) => c.className === "settings-build")!;
      expect(el.textContent).toBe("版 1a2b3c4");
      expect([el.style["left"], el.style["top"], el.style["width"], el.style["height"]]).toEqual([`${L.heading.x}px`, `${L.heading.y}px`, `${L.heading.w}px`, `${L.heading.h}px`]);
    }
    expect((make().el as unknown as FakeEl).children.find((c) => c.className === "settings-build")!.textContent).toBe("版 dev");
  });

  test("UI-57 style.css の .settings-build は右寄せ・dim・押せない", async () => {
    // vitest は CSS の import を空にするので node の fs で読む（@types/node は入れていないので型は手で書く。message.test.ts と同じ）
    const FS_MODULE = "node:fs";
    const fs = (await import(/* @vite-ignore */ FS_MODULE)) as { readFileSync(p: URL, enc: "utf8"): string };
    const styleCss = fs.readFileSync(new URL("../src/presenter/style.css", import.meta.url), "utf8");
    const css = styleCss.slice(styleCss.indexOf(".settings-build {"));
    const block = css.slice(0, css.indexOf("}"));
    expect(block).toContain("text-align: right;");
    expect(block).toContain("color: var(--c-dim);");
    expect(block).toContain("pointer-events: none;");
  });
});

describe("ホーム画面への追加の案内（SV-40）", () => {
  /** 全角 1 字 = 8px（1 単位）、半角（ASCII）= 4px（0.5 単位）で、幅 w 単位で禁則つきで折り返した行数（UI-43 の WRAP_STYLE。helpers/wrap.ts） */
  const wrappedLines = (text: string, w: number): number => kinsokuLines(text, w).length;

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
      onRules: () => {},
      onClose: () => {},
    });
    const root = view.el as unknown as FakeEl;
    const install = root.children.find((c) => c.className === "settings-install")!;
    expect([install.style["left"], install.style["top"], install.style["width"], install.style["height"]]).toEqual(["4px", "270px", "232px", "80px"]);
    view.render(TITLE, null);
    expect(install.children.map((c) => c.textContent)).toEqual(installGuideLines(false, S));
    expect(install.children[0]!.style["color"]).toBe("var(--c-accent)");
    expect(tapSpecOf(install)).toBeNull();
    view.render({ ...TITLE, standalone: true }, null);
    expect(install.children.map((c) => c.textContent)).toEqual([S["settings.install.done"]]);
  });
});
