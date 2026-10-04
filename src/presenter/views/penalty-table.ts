// UI-56（M5.5）: 全滅の出目の表。ビューの上部に重ねる overlay（ビューの左上が原点で x8..231、上端 y4）。
// 中身は core の penaltyTable イベント（見出しと、penalty-table.json の帯の順の行。どれも strings のキーと params）だけで作る
// （表示層は penalty-table.json を読んで判定しない）。当たった行（hit）は wipe.table.mark を頭に付けて accent 色、
// それ以外（hit null なら全行）は wipe.table.pad を頭に付ける。
// 箱の高さは 8 + 10 ×（1 + 行数）。全滅の 2d10 の箱（views/dice.ts の diceBox。1 行で y98..145）と重ならないよう、
// 上端は y4 で、収まらなければ上へ詰める（帯は core の検証で 8 以下）。
// show / hide は playback が呼ぶ。モジュールのトップレベルでは DOM に触れない。
import type { Strings } from "../../core/data/index";
import type { GameEvent, TextRef } from "../../core/types";
import type { Rect } from "../layout";
import { formatMessage } from "./message";

export type PenaltyTableEvent = Extract<GameEvent, { kind: "penaltyTable" }>;
/** 描く文字列。lines は帯の順で、hit はその行が当たった帯か */
export type PenaltyTableText = { title: string; lines: { text: string; hit: boolean }[] };

const BOX_X = 8;
const BOX_W = 224;
const BOX_TOP = 4;
const LINE_H = 10;
const PAD = 4;
/** 全滅の 2d10 の箱（1 行）の上端。diceBox と同じ式（下端 146 − (8 + 10 × 4)） */
const WIPE_DICE_TOP = 146 - (PAD * 2 + LINE_H * 4);

function text(strings: Strings, ref: TextRef): string {
  return formatMessage(strings[ref.key] ?? ref.key, ref.params);
}

/** 純粋: 見出しと行の文字列。hit の行は wipe.table.mark、それ以外（hit null なら全行）は wipe.table.pad を頭に付ける */
export function formatPenaltyTable(ev: Pick<PenaltyTableEvent, "title" | "rows" | "hit">, strings: Strings): PenaltyTableText {
  const mark = strings["wipe.table.mark"] ?? "";
  const pad = strings["wipe.table.pad"] ?? "";
  return {
    title: text(strings, ev.title),
    lines: ev.rows.map((r, i) => {
      const hit = ev.hit === i;
      return { text: `${hit ? mark : pad}${text(strings, r)}`, hit };
    }),
  };
}

/**
 * 純粋: 箱（ビューの左上が原点）。x8 w224、高さ 8 + 10 ×（1 + rows）、上端 y4（7 行で y4..91）。
 * 全滅の 2d10 の箱（上端 y98）に届くなら、届かない所まで上へ詰める（0 未満にはしない。8 行で y0..97）
 */
export function penaltyTableBox(rows: number): Rect {
  const h = PAD * 2 + LINE_H * (1 + rows);
  return { x: BOX_X, y: Math.max(0, Math.min(BOX_TOP, WIPE_DICE_TOP - h)), w: BOX_W, h };
}

export type PenaltyTableView = {
  el: HTMLElement;
  show(v: PenaltyTableText): void;
  hide(): void;
};

export function createPenaltyTableView(): PenaltyTableView {
  const el = document.createElement("div");
  el.className = "play-penalty-table";
  Object.assign(el.style, {
    position: "absolute",
    border: "1px solid var(--c-frame)",
    background: "var(--c-bg)",
    color: "var(--c-text)",
    display: "none",
    pointerEvents: "none",
  });
  const line = (j: number, t: string, color?: string): HTMLElement => {
    const d = document.createElement("div");
    Object.assign(d.style, {
      position: "absolute",
      left: `${PAD - 1}px`,
      top: `${PAD - 1 + j * LINE_H}px`,
      width: `${BOX_W - 2 * PAD}px`,
      height: `${LINE_H}px`,
      lineHeight: `${LINE_H}px`,
      whiteSpace: "nowrap",
      overflow: "hidden",
    });
    if (color !== undefined) d.style.color = color;
    d.textContent = t;
    return d;
  };
  return {
    el,
    show(v: PenaltyTableText): void {
      const r = penaltyTableBox(v.lines.length);
      Object.assign(el.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px`, display: "" });
      el.replaceChildren(line(0, v.title), ...v.lines.map((l, i) => line(i + 1, l.text, l.hit ? "var(--c-accent)" : undefined)));
    },
    hide(): void {
      el.replaceChildren();
      el.style.display = "none";
    },
  };
}
