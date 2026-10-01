// UI-40: ダイスの表示。ビューの下部に重ねる overlay（ビューの左上が原点で x20..219、y106..147）。
// 行はラベル（strings のキー）と、ダイスの目と合計。続けて 2 件来たとき（先手判定）は上へ伸ばして（y86..147）行を積む。
// 演出: 1 個ずつ translateY 0→−2→0（duration stepMs）の finished で目を確定し、最後に合計（dice.total）を opacity 1 往復。
// ms が 0 以下（skip）なら animate を呼ばずに最終の段だけを描く。hide で消す（playback が次のイベントの前に呼ぶ）。
// モジュールのトップレベルでは DOM に触れない。
import type { Strings } from "../../core/data/index";
import type { Rect } from "../layout";
import { formatMessage } from "./message";

/** 演出の 1 段。null の目は "?"、total が null の間は合計を出さない */
export type DiceFrame = { dice: (number | null)[]; total: number | null };

/** 純粋: [?,?] → [3,?] → [3,5] → 合計。skip なら最終の 1 段だけ */
export function diceFrames(ev: { dice: readonly number[]; total: number }, skip: boolean): DiceFrame[] {
  const final: DiceFrame = { dice: ev.dice.slice(), total: ev.total };
  if (skip) return [final];
  const out: DiceFrame[] = [];
  for (let k = 0; k <= ev.dice.length; k++) out.push({ dice: ev.dice.map((d, i) => (i < k ? d : null)), total: null });
  out.push(final);
  return out;
}

/** 1 行の overlay と、2 行積んだときの overlay（ビューの左上が原点） */
export const DICE_BOX: Rect = { x: 20, y: 106, w: 200, h: 42 };
export const DICE_BOX_TWO: Rect = { x: 20, y: 86, w: 200, h: 62 };
const ROW_H = 20;
const PAD_Y = 10;
const PAD_X = 6;
const DIE_W = 16;
const MAX_ROWS = 2;

export type DiceView = {
  el: HTMLElement;
  show(ev: { label: string; dice: readonly number[]; total: number }, skip: boolean, stepMs: number): Promise<void>;
  hide(): void;
};

async function settle(a: Animation): Promise<void> {
  try {
    await a.finished;
  } catch {
    // cancel（hide など）。そのまま先へ進む
  }
}

export function createDiceView(strings: Strings): DiceView {
  const el = document.createElement("div");
  el.className = "play-dice";
  Object.assign(el.style, {
    position: "absolute",
    border: "1px solid var(--c-frame)",
    background: "var(--c-bg)",
    color: "var(--c-text)",
    display: "none",
    pointerEvents: "none",
  });
  let rows: HTMLElement[] = [];

  const placeBox = (): void => {
    const r = rows.length >= 2 ? DICE_BOX_TWO : DICE_BOX;
    Object.assign(el.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
    rows.forEach((row, i) => {
      row.style.top = `${PAD_Y - 1 + i * ROW_H}px`;
    });
  };

  const draw = (dieEls: HTMLElement[], total: HTMLElement, f: DiceFrame): void => {
    f.dice.forEach((d, i) => {
      const e = dieEls[i];
      if (e !== undefined) e.textContent = d === null ? "?" : String(d);
    });
    total.textContent = f.total === null ? "" : formatMessage(strings["dice.total"] ?? "dice.total", { total: f.total });
  };

  return {
    el,
    async show(ev, skip, stepMs): Promise<void> {
      const row = document.createElement("div");
      row.className = "dice-row";
      Object.assign(row.style, { position: "absolute", left: `${PAD_X - 1}px`, width: `${200 - 2 * PAD_X}px`, height: `${ROW_H}px` });
      const label = document.createElement("div");
      Object.assign(label.style, { position: "absolute", left: "0px", top: "0px", height: "10px", whiteSpace: "nowrap" });
      label.textContent = strings[ev.label] ?? ev.label;
      const dieEls = ev.dice.map((_, i) => {
        const d = document.createElement("span");
        Object.assign(d.style, { position: "absolute", left: `${i * DIE_W}px`, top: "10px", width: `${DIE_W - 2}px`, textAlign: "center" });
        return d;
      });
      const total = document.createElement("span");
      Object.assign(total.style, { position: "absolute", left: `${ev.dice.length * DIE_W + 4}px`, top: "10px", whiteSpace: "nowrap" });
      row.append(label, ...dieEls, total);
      rows = [...rows, row].slice(-MAX_ROWS);
      el.replaceChildren(...rows);
      el.style.display = "";
      placeBox();

      const fast = skip || !(stepMs > 0);
      const frames = diceFrames(ev, fast);
      const last = frames[frames.length - 1];
      if (fast) {
        if (last !== undefined) draw(dieEls, total, last);
        return;
      }
      const first = frames[0];
      if (first !== undefined) draw(dieEls, total, first);
      for (let i = 0; i < dieEls.length; i++) {
        const d = dieEls[i];
        if (d !== undefined) {
          await settle(
            d.animate([{ transform: "translateY(0px)" }, { transform: "translateY(-2px)" }, { transform: "translateY(0px)" }], {
              duration: stepMs,
            }),
          );
        }
        const f = frames[i + 1];
        if (f !== undefined) draw(dieEls, total, f);
      }
      if (last !== undefined) draw(dieEls, total, last);
      await settle(total.animate([{ opacity: 1 }, { opacity: 0 }, { opacity: 1 }], { duration: stepMs, easing: "steps(2, end)" }));
    },
    hide(): void {
      rows = [];
      el.replaceChildren();
      el.style.display = "none";
    },
  };
}
