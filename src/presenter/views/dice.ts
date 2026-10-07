// UI-40: 判定の箱。ビューの下部に重ねる overlay（ビューの左上が原点で x8..231、下端 y146。街では会話の箱 UI-47 の上の y148（M10.5）、迷宮のキャラクター画面では 3 行の箱の上の y110。setBottom）。
// 中身は上から 見出し（label）/ 各行「{label} {base}{dice.plus}{目…}{dice.total}」/ 基準（rule）/ {dice.arrow}{結果}。
// 補正の行（base が値で目が無い。EV-21 の士気 +1 など。M7）は「{label}」だけを出す（値は label の中にある）。
// 高さは 8 + 10 ×（rows + 3）。新しい dice が来たら前の箱を置き換える（積まない）。
// 演出: 行ごとに目を 1 個ずつ（translateY 0→−2→0、duration stepMs の finished で確定）→ その行の合計 → 次の行 → 基準 → 結果
// （合計・基準・結果は opacity の 1 往復）。skip か stepMs が 0 以下なら animate を呼ばずに最終の段だけを描く。
// settled は最終の段（結果の行まで）を描いたか（結果の点滅の間も真。UI-45 の拍の中のタップに見せる残りがあるかを playback が見る）。
// hide で消す（playback が呼ぶ）。formatDiceSummary は履歴に残す 1 行（UI-46）。
// モジュールのトップレベルでは DOM に触れない。
import type { Strings } from "../../core/data/index";
import type { DiceRow, GameEvent, TextRef } from "../../core/types";
import type { Rect } from "../layout";
import { formatMessage } from "./message";

export type DiceEvent = Extract<GameEvent, { kind: "dice" }>;

/** 演出の 1 段。null の目は "?"、total が null の間はその行の合計を出さない。rule / result が偽の間は出さない */
export type DiceFrame = { rows: { dice: (number | null)[]; total: number | null }[]; rule: boolean; result: boolean };

const BOX_X = 8;
const BOX_W = 224;
/** UI-40: 迷宮・戦闘の箱の下端（ビューの座標）。街は会話の箱（UI-47）の上（townLayout の diceBottom。迷宮のキャラクター画面は diceBottomCompact）に setBottom で置く */
export const DICE_BOX_BOTTOM = 146;
const LINE_H = 10;
const PAD = 4;

/** 純粋: 行ごとに目を 1 個ずつ → その行の合計 → 次の行 → 基準 → 結果。skip なら最終の 1 段だけ */
export function diceFrames(ev: Pick<DiceEvent, "rows">, skip: boolean): DiceFrame[] {
  const final: DiceFrame = { rows: ev.rows.map((r) => ({ dice: r.dice.slice(), total: r.total })), rule: true, result: true };
  if (skip) return [final];
  const cur = ev.rows.map((r) => ({ dice: r.dice.map((): number | null => null), total: null as number | null }));
  const snap = (rule: boolean, result: boolean): DiceFrame => ({
    rows: cur.map((r) => ({ dice: r.dice.slice(), total: r.total })),
    rule,
    result,
  });
  const out: DiceFrame[] = [snap(false, false)];
  ev.rows.forEach((r, i) => {
    const c = cur[i]!;
    r.dice.forEach((d, k) => {
      c.dice[k] = d;
      out.push(snap(false, false));
    });
    c.total = r.total;
    out.push(snap(false, false));
  });
  out.push(snap(true, false));
  out.push(final);
  return out;
}

/** 純粋: 箱の位置（ビューの左上が原点）。x8 w224、下端 bottom（既定 y146。街は y110）、高さ 8 + 10 ×（3 + rows.length） */
export function diceBox(ev: Pick<DiceEvent, "rows">, bottom: number = DICE_BOX_BOTTOM): Rect {
  const h = PAD * 2 + LINE_H * (3 + ev.rows.length);
  return { x: BOX_X, y: bottom - h, w: BOX_W, h };
}

function text(strings: Strings, ref: TextRef): string {
  return formatMessage(strings[ref.key] ?? ref.key, ref.params);
}

/** 補正の行か（UI-40 の M7: base が値で目が無い。label だけを出す） */
function isBonusRow(row: Pick<DiceRow, "base" | "dice">): boolean {
  return row.base !== null && row.dice.length === 0;
}

/** 行の合計を出すか（base が null で目が 1 個なら、合計は目と同じなので出さない。補正の行も出さない） */
function showsTotal(row: Pick<DiceRow, "base" | "dice">): boolean {
  if (isBonusRow(row)) return false;
  return row.base !== null || row.dice.length !== 1;
}

/** 行の頭（「{label} {base}{plus}」。base が null なら「{label} 」、補正の行は「{label}」） */
function rowHead(strings: Strings, row: DiceRow): string {
  if (isBonusRow(row)) return text(strings, row.label);
  const plus = strings["dice.plus"] ?? "+";
  return `${text(strings, row.label)} ${row.base === null ? "" : `${row.base}${plus}`}`;
}

/** 純粋: 履歴に残す 1 行。「{label} {row1}{sep}{row2}{sep}{rule}{arrow}{result}」。base が null で目が 1 個の行は「出目 42」、補正の行は「士気 +1」 */
export function formatDiceSummary(ev: DiceEvent, strings: Strings): string {
  const plus = strings["dice.plus"] ?? "+";
  const sep = strings["dice.sep"] ?? " / ";
  const arrow = strings["dice.arrow"] ?? "";
  const rows = ev.rows.map((r) => {
    const total = showsTotal(r) ? formatMessage(strings["dice.total"] ?? "dice.total", { total: r.total }) : "";
    return `${rowHead(strings, r)}${r.dice.join(plus)}${total}`;
  });
  return `${text(strings, ev.label)} ${[...rows, text(strings, ev.rule)].join(sep)}${arrow}${text(strings, ev.result)}`;
}

export type DiceView = {
  el: HTMLElement;
  /** skip は段ごとに読み直す。途中で真になったら最終の段を描いて終える（UI-45 の拍の中のタップ） */
  show(ev: DiceEvent, skip: () => boolean, stepMs: number): Promise<void>;
  hide(): void;
  /** 最終の段（結果の行まで）を描いたか。結果の点滅の間も真。hide と次の show で偽に戻る */
  settled(): boolean;
  /** UI-40 / UI-47（M8.5）: 箱の下端（ビューの座標）。次の show から効く */
  setBottom(bottom: number): void;
};

async function settle(a: Animation): Promise<void> {
  try {
    await a.finished;
  } catch {
    // cancel（hide など）。そのまま先へ進む
  }
}

type RowEls = { dice: HTMLElement[]; total: HTMLElement; showsTotal: boolean };

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
  /** 表示中の箱の世代（hide や次の show で古い show の描画を止める） */
  let gen = 0;
  /** 今の箱の最終の段を描いたか */
  let final = false;
  /** 箱の下端（ビューの座標） */
  let bottom = DICE_BOX_BOTTOM;

  const line = (j: number): HTMLElement => {
    const d = document.createElement("div");
    Object.assign(d.style, {
      position: "absolute",
      left: `${PAD - 1}px`,
      top: `${PAD - 1 + j * LINE_H}px`,
      width: `${BOX_W - 2 * PAD}px`,
      height: `${LINE_H}px`,
      whiteSpace: "nowrap",
    });
    return d;
  };
  const span = (t: string, inline: boolean): HTMLElement => {
    const s = document.createElement("span");
    if (inline) s.style.display = "inline-block";
    s.textContent = t;
    return s;
  };
  const blink = (e: HTMLElement, ms: number): Promise<void> =>
    settle(e.animate([{ opacity: 1 }, { opacity: 0 }, { opacity: 1 }], { duration: ms, easing: "steps(2, end)" }));
  const jump = (e: HTMLElement, ms: number): Promise<void> =>
    settle(e.animate([{ transform: "translateY(0px)" }, { transform: "translateY(-2px)" }, { transform: "translateY(0px)" }], { duration: ms }));

  return {
    el,
    async show(ev, skip, stepMs): Promise<void> {
      const my = ++gen;
      final = false;
      const plus = strings["dice.plus"] ?? "+";
      const r = diceBox(ev, bottom);
      Object.assign(el.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px`, display: "" });

      const head = line(0);
      head.textContent = text(strings, ev.label);
      const rowEls: RowEls[] = [];
      const lines: HTMLElement[] = [head];
      ev.rows.forEach((row, i) => {
        const ln = line(i + 1);
        ln.append(span(rowHead(strings, row), false));
        const dice = row.dice.map((_, k) => {
          if (k > 0) ln.append(span(plus, false));
          const d = span("?", true);
          ln.append(d);
          return d;
        });
        const total = span("", false);
        ln.append(total);
        rowEls.push({ dice, total, showsTotal: showsTotal(row) });
        lines.push(ln);
      });
      const rule = line(ev.rows.length + 1);
      const result = line(ev.rows.length + 2);
      lines.push(rule, result);
      el.replaceChildren(...lines);

      const ruleText = text(strings, ev.rule);
      const resultText = `${strings["dice.arrow"] ?? ""}${text(strings, ev.result)}`;
      const draw = (f: DiceFrame): void => {
        f.rows.forEach((fr, i) => {
          const re = rowEls[i];
          if (re === undefined) return;
          fr.dice.forEach((d, k) => {
            const e = re.dice[k];
            if (e !== undefined) e.textContent = d === null ? "?" : String(d);
          });
          re.total.textContent =
            fr.total === null || !re.showsTotal ? "" : formatMessage(strings["dice.total"] ?? "dice.total", { total: fr.total });
        });
        rule.textContent = f.rule ? ruleText : "";
        result.textContent = f.result ? resultText : "";
      };

      const fast = skip() || !(stepMs > 0);
      const frames = diceFrames(ev, fast);
      const first = frames[0];
      if (first !== undefined) draw(first);
      if (fast) {
        final = true;
        return;
      }
      const last = frames[frames.length - 1];
      // 段 i（1 以降）で変わった要素を 1 つ動かす（diceFrames の順と同じ並び）
      const moves: (() => Promise<void>)[] = [];
      rowEls.forEach((re) => {
        for (const d of re.dice) moves.push(() => jump(d, stepMs));
        moves.push(() => (re.showsTotal ? blink(re.total, stepMs) : Promise.resolve()));
      });
      moves.push(() => blink(rule, stepMs), () => blink(result, stepMs));
      for (let i = 1; i < frames.length; i++) {
        if (my !== gen) return;
        if (skip()) {
          if (last !== undefined) draw(last);
          final = true;
          return;
        }
        const f = frames[i];
        if (f !== undefined) draw(f);
        if (i === frames.length - 1) final = true;
        const m = moves[i - 1];
        if (m !== undefined) await m();
      }
    },
    settled(): boolean {
      return final;
    },
    setBottom(b: number): void {
      bottom = b;
    },
    hide(): void {
      gen++;
      final = false;
      el.replaceChildren();
      el.style.display = "none";
    },
  };
}
