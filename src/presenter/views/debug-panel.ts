// debug パネル（M0 の確認画面 stage-check を置き換える全面 overlay）。ユーザー決定の「デバッグ表示の隣に設定の仮 UI」。
// - y0..39: M0 の 1px 模様（Android の実機確認に使う）
// - y42..121: 計測値 8 行（formatStageInfo。M0 の書式を引き継ぐ）
// - debugRow(0..5): スワイプ閾値（CSS px の換算値も出す）、長押し間隔、文字速度、演出スキップ、オートの速さ（UI-45）、入力モード
// - DEBUG_SWIPE_Y（y328..337）: 最後に確定したスワイプの "dx,dy,dir"（ASCII）
// - DEBUG_BUTTONS（y342）: 既定に戻す、閉じる
// 値を変えたら、その場で store.set を呼ぶ（保存とすぐの反映は store の購読者が行う）。
// 計測ラベル（scale, dpr など）は前例どおり ASCII でコードに置く。モジュールのトップレベルでは DOM に触れない。
import type { Strings } from "../../core/data/index";
import { thresholdCss } from "../input/swipe";
import { DEBUG_BUTTONS, DEBUG_SWIPE_Y, debugRow, type Rect } from "../layout";
import type { Insets, StageLayout, StageLayoutInput } from "../stage";
import { nextAutoBeat, nextInputMode, stepSetting, type NumericSettingKey, type Settings, type SettingsStore } from "../settings";
import { formatMessage } from "./message";
import { onTap } from "../input/tap";

/** formatStageInfo の入力。insets は無いことがある（無ければ n/a） */
export type StageInfoInput = Omit<StageLayoutInput, "insets"> & { insets?: Insets };

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(4).replace(/0+$/, "");
}

/** UI-01 / UI-02 の計測値。M0 の確認画面と同じ書式で、常に 8 行。input が無い項目は n/a */
export function formatStageInfo(layout: StageLayout, input: StageInfoInput | null): string[] {
  const ins = input?.insets;
  return [
    `scale       ${fmt(layout.scale)}`,
    `deviceScale ${fmt(layout.deviceScale)}`,
    `integer     ${layout.integer}`,
    input ? `dpr         ${fmt(input.devicePixelRatio)}` : "dpr         n/a",
    input ? `viewport    ${fmt(input.viewportWidth)} x ${fmt(input.viewportHeight)}` : "viewport    n/a",
    ins ? `insets      t${fmt(ins.top)} r${fmt(ins.right)} b${fmt(ins.bottom)} l${fmt(ins.left)}` : "insets      n/a",
    `stage pos   ${fmt(layout.left)}, ${fmt(layout.top)}`,
    input ? `stage size  ${input.stageWidth} x ${input.stageHeight}` : "stage size  n/a",
  ];
}

export type DebugRowKind = "number" | "toggle";
export type DebugRowView = { key: keyof Settings; kind: DebugRowKind; label: string; value: string };

/** debugRow(0..5) の並び（固定） */
export const DEBUG_ROW_KEYS = ["swipeThreshold", "holdRepeatMs", "textSpeed", "skipAnimations", "autoBeatMs", "inputMode"] as const;

/** 各行のラベルと値の文字列（純粋）。スワイプ閾値のラベルの後ろに、scale で換算した CSS px を "(NNcss)" で付ける */
export function debugRows(s: Settings, strings: Strings, scale: number): DebugRowView[] {
  const t = (k: string): string => strings[k] ?? k;
  const css = Math.round(thresholdCss(s.swipeThreshold, scale));
  return [
    { key: "swipeThreshold", kind: "number", label: `${t("settings.swipeThreshold")} (${css}css)`, value: String(s.swipeThreshold) },
    { key: "holdRepeatMs", kind: "number", label: t("settings.holdRepeatMs"), value: String(s.holdRepeatMs) },
    { key: "textSpeed", kind: "number", label: t("settings.textSpeed"), value: String(s.textSpeed) },
    { key: "skipAnimations", kind: "toggle", label: t("settings.skipAnimations"), value: t(s.skipAnimations ? "settings.on" : "settings.off") },
    { key: "autoBeatMs", kind: "toggle", label: t("settings.autoBeatMs"), value: formatMessage(t("settings.ms"), { ms: s.autoBeatMs }) },
    { key: "inputMode", kind: "toggle", label: t("settings.inputMode"), value: t(`settings.inputMode.${s.inputMode}`) },
  ];
}

/** 最後に確定したスワイプの表示（ASCII）。dx, dy は CSS px */
export function formatSwipeDebug(dx: number, dy: number, dir: string): string {
  return `${Math.round(dx)},${Math.round(dy)},${dir}`;
}

export type DebugPanel = {
  el: HTMLElement;
  /** mountStage の onLayout から呼ぶ */
  update(layout: StageLayout, input: StageInfoInput | null): void;
  /** スワイプが確定したときに呼ぶ */
  setSwipe(dx: number, dy: number, dir: string): void;
  /** 設定の値を描き直す */
  refresh(): void;
};

const SVG_NS = "http://www.w3.org/2000/svg";

// M0 の模様ブロックの配置（論理 px）。
const BLOCK = 32;
const BLOCK_TOP = 4;
const BLOCK_GAP = 8;
const BLOCK_LEFT = 6;

function buildPatterns(): SVGSVGElement {
  const svgEl = <K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] => {
    const el = document.createElementNS(SVG_NS, name);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    return el;
  };
  const blocks: Array<{ id: string; w: number; h: number; cells: Array<[number, number, number, number]> }> = [
    // 1px 市松
    { id: "dbg-checker1", w: 2, h: 2, cells: [[0, 0, 1, 1], [1, 1, 1, 1]] },
    // 1px 間隔の縦線
    { id: "dbg-vlines", w: 2, h: 1, cells: [[0, 0, 1, 1]] },
    // 1px 間隔の横線
    { id: "dbg-hlines", w: 1, h: 2, cells: [[0, 0, 1, 1]] },
    // 2px 市松（参考用）
    { id: "dbg-checker2", w: 4, h: 4, cells: [[0, 0, 2, 2], [2, 2, 2, 2]] },
  ];
  const width = BLOCK_LEFT * 2 + blocks.length * BLOCK + (blocks.length - 1) * BLOCK_GAP;
  const height = BLOCK_TOP + BLOCK + 1;
  const svg = svgEl("svg", { width, height, viewBox: `0 0 ${width} ${height}`, "shape-rendering": "crispEdges" });
  svg.setAttribute("class", "debug-patterns");
  const defs = svgEl("defs", {});
  svg.appendChild(defs);
  blocks.forEach((b, i) => {
    const p = svgEl("pattern", { id: b.id, width: b.w, height: b.h, patternUnits: "userSpaceOnUse" });
    for (const [x, y, cw, ch] of b.cells) {
      const r = svgEl("rect", { x, y, width: cw, height: ch });
      r.style.fill = "var(--c-text)";
      p.appendChild(r);
    }
    defs.appendChild(p);
    const x = BLOCK_LEFT + i * (BLOCK + BLOCK_GAP);
    svg.appendChild(svgEl("rect", { x, y: BLOCK_TOP, width: BLOCK, height: BLOCK, fill: `url(#${b.id})` }));
  });
  return svg;
}

function place(el: HTMLElement, r: Rect): void {
  el.style.left = `${r.x}px`;
  el.style.top = `${r.y}px`;
  el.style.width = `${r.w}px`;
  el.style.height = `${r.h}px`;
}

function button(text: string, r: Rect, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "ui-button";
  b.textContent = text;
  place(b, r);
  onTap(b, () => onClick());
  return b;
}

export function createDebugPanel(o: {
  strings: Strings;
  store: SettingsStore;
  /** 「既定に戻す」で入れる値 */
  defaults: Settings;
  onClose(): void;
}): DebugPanel {
  const t = (k: string): string => o.strings[k] ?? k;
  let scale = 1;

  const el = document.createElement("div");
  el.className = "debug-panel";

  // ステージ外周の 1px 枠（M0 と同じ。寸法に依存しないよう DOM の枠線で描く）
  const frame = document.createElement("div");
  frame.className = "debug-frame";
  el.appendChild(frame);
  el.appendChild(buildPatterns());

  const info = document.createElement("pre");
  info.className = "debug-info";
  el.appendChild(info);

  // 設定の行
  const rowEls: Array<{ label: HTMLElement; value: HTMLElement; toggle: HTMLButtonElement | null }> = [];
  DEBUG_ROW_KEYS.forEach((key, i) => {
    const r = debugRow(i);
    const label = document.createElement("div");
    label.className = "debug-label";
    place(label, r.label);
    el.appendChild(label);
    if (key === "skipAnimations" || key === "autoBeatMs" || key === "inputMode") {
      const toggle = button("", r.toggle, () => {
        const s = o.store.get();
        if (key === "skipAnimations") o.store.set({ skipAnimations: !s.skipAnimations });
        else if (key === "autoBeatMs") o.store.set({ autoBeatMs: nextAutoBeat(s.autoBeatMs) });
        else o.store.set({ inputMode: nextInputMode(s.inputMode) });
      });
      el.appendChild(toggle);
      rowEls.push({ label, value: toggle, toggle });
    } else {
      const k: NumericSettingKey = key;
      el.appendChild(button("-", r.minus, () => o.store.set(stepSetting(o.store.get(), k, -1))));
      const value = document.createElement("div");
      value.className = "debug-value";
      place(value, r.value);
      el.appendChild(value);
      el.appendChild(button("+", r.plus, () => o.store.set(stepSetting(o.store.get(), k, 1))));
      rowEls.push({ label, value, toggle: null });
    }
  });

  const swipe = document.createElement("div");
  swipe.className = "debug-swipe";
  swipe.style.top = `${DEBUG_SWIPE_Y}px`;
  swipe.textContent = "swipe -";
  el.appendChild(swipe);

  el.appendChild(button(t("settings.reset"), DEBUG_BUTTONS.reset, () => o.store.set({ ...o.defaults })));
  el.appendChild(button(t("common.close"), DEBUG_BUTTONS.close, () => o.onClose()));

  const refresh = (): void => {
    const rows = debugRows(o.store.get(), o.strings, scale);
    rows.forEach((row, i) => {
      const e = rowEls[i];
      if (e === undefined) return;
      e.label.textContent = row.label;
      e.value.textContent = row.value;
    });
  };
  refresh();

  return {
    el,
    update(layout: StageLayout, input: StageInfoInput | null): void {
      scale = layout.scale;
      info.textContent = formatStageInfo(layout, input).join("\n");
      refresh();
    },
    setSwipe(dx: number, dy: number, dir: string): void {
      swipe.textContent = `swipe ${formatSwipeDebug(dx, dy, dir)}`;
    },
    refresh,
  };
}
