// UI-56 全滅の内訳。wipe イベント（PenaltyResult）で開く overlay（ビューとメッセージの範囲。layout の wipe。地図と同じ矩形）。
// - formatWipeSummary は純粋: 帯の名前 → 出目 → 台帳で失ったもの → 所持金 → 失った品 → 各人の EXP（と Lv の変化）。
//   state は引かない（名前は PenaltyResult の中にある）。帯の名前だけ data.penaltyTable を表示のために引く。
// - 閉じる（「街へ」・Enter / Esc / 1）は app が扱う。行が溢れたら縦スクロール。
//   M10.5 追補（未定-24）: 枠（el）の中にスクロールする窓（wipe-view）を置き、右の 8px の列に続きの印（scroll-marks.ts）を出す。
//   M18（UI-11 / UI-77。テストプレイ v2 の A-2 #4）: 窓の下端・上端の帯（余白 4 + 印 8 = 12px）のタップで 1 頁（見える行 − 1 行）送る・戻す
//   （wipePageTap / wipePageLines は純粋。印そのものは押せないまま。窓の他の所のタップと指のスクロールは今どおり）。
// モジュールのトップレベルでは DOM に触れない。
import type { GameData, Strings } from "../../core/data/index";
import type { PenaltyResult } from "../../core/types";
import type { Action } from "../input/swipe";
import { onTap } from "../input/tap";
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

/**
 * UI-33 / UI-56 全滅の内訳の間のキー（純粋）。Enter / Esc / 1 は「街へ」。
 * 内訳の下の会話の箱（3 行の箱）が開いていれば ↑ / ↓ で 3 行ずつ読み返す（街・キャンプの箱と同じ。2026-10-07 レビュー）。
 */
export function wipeKeyAction(a: Action, talkOpen: boolean): "toTown" | "scrollUp" | "scrollDown" | null {
  if (a === "back" || a === "confirm" || (typeof a === "object" && a.menu === 0)) return "toTown";
  if (talkOpen && a === "forward") return "scrollUp";
  if (talkOpen && a === "around") return "scrollDown";
  return null;
}

const LINE_H = 10;
const PAD = 4;
/** UI-11 / UI-77（M18）: 頁送りの帯の高さ（窓の上端・下端から。余白 PAD + 続きの印 8 = 12px） */
export const WIPE_PAGE_BAND = PAD + SCROLL_MARK_SIZE;

/** UI-11 / UI-77（M18。純粋）: 窓の中の押した高さ ly（窓の上端から。論理 px）と窓の内側の高さ innerH から、1 = 下へ 1 頁、-1 = 上へ 1 頁、0 = 何もしない */
export function wipePageTap(ly: number, innerH: number): -1 | 0 | 1 {
  if (!Number.isFinite(ly) || ly < 0 || ly >= innerH) return 0;
  if (ly >= innerH - WIPE_PAGE_BAND) return 1;
  if (ly < WIPE_PAGE_BAND) return -1;
  return 0;
}

/** UI-11 / UI-77（M18。純粋）: 1 頁で送る行数 = 見える行数 − 1（前の頁の最後の行を上端に残す）。既定の窓（内側 218）は 21 行が見えて 20 行 */
export function wipePageLines(innerH: number): number {
  return Math.max(1, Math.floor((innerH - 2 * PAD) / LINE_H) - 1);
}

/** UI-77（M16 追補 H-3）: 用語の列の幅（全角 4 字 = 32px。用語は 3 字まで + 区切り）。説明はこの x から始める */
export const TERM_COL_W = 32;

/** UI-77（M16 追補 H-3）: 用語の列の行。term は幅 TERM_COL_W の列（空なら字下げだけ。続きの行）、desc は列の右から */
export type WipeTermLine = { term: string; desc: string };
/** 窓の 1 行。文字列はそのまま 1 行（全滅の内訳・戦績・用語の一覧の見出しと一覧の行） */
export type WipeLine = string | WipeTermLine;

export type WipeView = {
  el: HTMLElement;
  render(lines: readonly WipeLine[]): void;
  /**
   * UI-11 / UI-77（M19 実機の気づき (a)）: el を表示した後に呼ぶ。窓を先頭へ戻し、続きの印を出し直す。
   * 隠れている（祖先が display:none）間は scrollTop の設定も寸法も効かないので、render の中の先頭へ戻すだけでは
   * 前に開いたときの位置で開いてしまう。開くたびに先頭から
   */
  reveal(): void;
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
  // UI-11 / UI-77（M18）: 下端・上端の帯のタップで 1 頁。端を越える分はブラウザが止める（scrollTop は 0..scrollHeight − clientHeight）
  onTap(view, (pt) => {
    const dir = wipePageTap(pt.ly, innerH);
    if (dir === 0) return;
    view.scrollTop += dir * wipePageLines(innerH) * LINE_H;
    marks.refresh();
  });
  return {
    el,
    render(lines: readonly WipeLine[]): void {
      view.scrollTop = 0;
      view.replaceChildren(
        ...lines.map((line, i) => {
          const t = document.createElement("div");
          t.className = i === 0 ? "wipe-title" : "wipe-line";
          Object.assign(t.style, { height: `${LINE_H}px`, lineHeight: `${LINE_H}px`, whiteSpace: "nowrap", overflow: "hidden" });
          if (i === 0) t.style.color = "var(--c-accent)";
          if (typeof line === "string") {
            t.textContent = line;
            return t;
          }
          // UI-77（M16 追補 H-3）: 用語は幅 TERM_COL_W の列に置き、説明はどの行も同じ x から（字の幅によらず揃う）
          const term = document.createElement("span");
          term.className = "wipe-term";
          Object.assign(term.style, { display: "inline-block", width: `${TERM_COL_W}px`, overflow: "hidden", verticalAlign: "top" });
          term.textContent = line.term;
          const desc = document.createElement("span");
          desc.className = "wipe-desc";
          desc.textContent = line.desc;
          t.append(term, desc);
          return t;
        }),
      );
      marks.refresh();
    },
    reveal(): void {
      view.scrollTop = 0;
      marks.refresh();
    },
  };
}
