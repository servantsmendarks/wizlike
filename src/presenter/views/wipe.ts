// UI-56 全滅の内訳。wipe イベント（PenaltyResult）で開く overlay（ビューとメッセージの範囲。layout の wipe。地図と同じ矩形）。
// - formatWipeSummary は純粋: 帯の名前 → 出目 → 台帳で失ったもの → 所持金 → 失った品 → 各人の EXP（と Lv の変化）。
//   state は引かない（名前は PenaltyResult の中にある）。帯の名前だけ data.penaltyTable を表示のために引く。
// - 閉じる（「街へ」・Enter / Esc / 1）は app が扱う。行が溢れたら縦スクロール。
// モジュールのトップレベルでは DOM に触れない。
import type { GameData, Strings } from "../../core/data/index";
import type { PenaltyResult } from "../../core/types";
import type { Rect } from "../layout";
import { formatMessage } from "./message";

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
};

/** rect はステージ座標の overlay の範囲（layout の wipe） */
export function createWipeView(rect: Rect): WipeView {
  const el = document.createElement("div");
  el.className = "wipe-view";
  Object.assign(el.style, {
    position: "absolute",
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.w}px`,
    height: `${rect.h}px`,
    boxSizing: "border-box",
    padding: `${PAD}px`,
    background: "var(--c-bg)",
    color: "var(--c-text)",
    border: "1px solid var(--c-frame)",
    overflowY: "auto",
    overflowX: "hidden",
  });
  return {
    el,
    render(lines: readonly string[]): void {
      el.scrollTop = 0;
      el.replaceChildren(
        ...lines.map((text, i) => {
          const t = document.createElement("div");
          t.className = i === 0 ? "wipe-title" : "wipe-line";
          Object.assign(t.style, { height: `${LINE_H}px`, lineHeight: `${LINE_H}px`, whiteSpace: "nowrap", overflow: "hidden" });
          if (i === 0) t.style.color = "var(--c-accent)";
          t.textContent = text;
          return t;
        }),
      );
    },
  };
}
