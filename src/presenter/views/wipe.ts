// UI-56 全滅の内訳。wipe イベント（PenaltyResult）で開く overlay（ビューとメッセージの範囲。layout の wipe。地図と同じ矩形）。
// - formatWipeSummary は純粋: 帯の名前 → 出目 → 台帳で失ったもの → 所持金 → 失った品 → 各人の EXP（と Lv の変化）。
//   state は引かない（名前は PenaltyResult の中にある）。帯の名前だけ data.penaltyTable を表示のために引く。
// - 閉じる（「街へ」・Enter / Esc / 1）は app が扱う。行が溢れたら縦スクロール。
//   M10.5 追補（未定-24）: 枠（el）の中にスクロールする窓（wipe-view）を置き、右の 8px の列に続きの印（scroll-marks.ts）を出す。
// モジュールのトップレベルでは DOM に触れない。
import type { GameData, Strings } from "../../core/data/index";
import type { PenaltyResult } from "../../core/types";
import type { Rect } from "../layout";
import { formatMessage } from "./message";
import { attachScrollMarks, marksAt, SCROLL_MARK_SIZE } from "./scroll-marks";

/** UI-56 の内訳の行（純粋） */
export function formatWipeSummary(p: PenaltyResult, data: Pick<GameData, "penaltyTable">, strings: Strings): string[] {
  const s = (key: string, params?: Record<string, string | number>): string => formatMessage(strings[key] ?? key, params);
  const band = data.penaltyTable.bands[p.bandIndex]?.name ?? "";
  const out: string[] = [s("wipe.summary.title", { band }), s("wipe.summary.dice", { dice: p.dice.join("+"), total: p.total })];
  if (p.ledgerGold === 0 && p.ledgerItems.length === 0) out.push(s("wipe.summary.ledgerNone"));
  else out.push(s("wipe.summary.ledger", { gold: p.ledgerGold, items: p.ledgerItems.length }));
  out.push(s("wipe.summary.gold", { gold: p.goldLost }));
  if (p.itemsLost.length === 0) out.push(s("wipe.summary.itemsNone"));
  else for (const it of p.itemsLost) out.push(s("wipe.summary.item", { name: it.name }));
  for (const e of p.expLost) {
    if (e.levelTo < e.levelFrom) out.push(s("wipe.summary.expLevel", { name: e.name, exp: e.lost, from: e.levelFrom, to: e.levelTo }));
    else out.push(s("wipe.summary.exp", { name: e.name, exp: e.lost }));
  }
  return out;
}

const LINE_H = 10;
const PAD = 4;

export type WipeView = {
  el: HTMLElement;
  render(lines: readonly string[]): void;
  /** UI-11（M10.5 追補）: 続きの印を出し直す（el を表示した後） */
  refresh(): void;
};

/** rect はステージ座標の overlay の範囲（layout の wipe）。strings は続きの印の字（scroll.up / scroll.down） */
export function createWipeView(rect: Rect, strings: Strings): WipeView {
  const BORDER = 1;
  const el = document.createElement("div");
  el.className = "wipe-frame";
  Object.assign(el.style, {
    position: "absolute",
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.w}px`,
    height: `${rect.h}px`,
    boxSizing: "border-box",
    background: "var(--c-bg)",
    color: "var(--c-text)",
    border: `${BORDER}px solid var(--c-frame)`,
  });
  // スクロールする窓（枠の内側いっぱい。上下左の余白 PAD、右は余白 PAD と印の列）
  const innerW = rect.w - 2 * BORDER;
  const innerH = rect.h - 2 * BORDER;
  const view = document.createElement("div");
  view.className = "wipe-view";
  Object.assign(view.style, {
    position: "absolute",
    left: "0px",
    top: "0px",
    width: `${innerW}px`,
    height: `${innerH}px`,
    boxSizing: "border-box",
    padding: `${PAD}px ${PAD + SCROLL_MARK_SIZE}px ${PAD}px ${PAD}px`,
    overflowY: "auto",
    overflowX: "hidden",
  });
  el.appendChild(view);
  const marks = attachScrollMarks({
    scroller: view,
    host: el,
    strings,
    pos: marksAt(innerW - PAD - SCROLL_MARK_SIZE, { y: PAD, h: innerH - 2 * PAD }),
  });
  return {
    el,
    render(lines: readonly string[]): void {
      view.scrollTop = 0;
      view.replaceChildren(
        ...lines.map((text, i) => {
          const t = document.createElement("div");
          t.className = i === 0 ? "wipe-title" : "wipe-line";
          Object.assign(t.style, { height: `${LINE_H}px`, lineHeight: `${LINE_H}px`, whiteSpace: "nowrap", overflow: "hidden" });
          if (i === 0) t.style.color = "var(--c-accent)";
          t.textContent = text;
          return t;
        }),
      );
      marks.refresh();
    },
    refresh: () => marks.refresh(),
  };
}
