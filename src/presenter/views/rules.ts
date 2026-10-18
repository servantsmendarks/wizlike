// UI-77 用語の一覧（M16。2026-10-11。town.md TW-03 の酒場）。酒場の「用語」で開く。
// 部品・矩形・閉じ方は戦績の画面（UI-73。views/ending.ts。overlay ending）と同じ: 行の高さ 10 の縦スクロール、1 行目は見出し（accent）。
// - formatRules は純粋: 見出し rules.title → rules.line.1, 2, …（strings に続き番号のキーがある限り。途切れた先は使わない。
//   行の数はコードに持たない。opening.speech.N と同じ形）。値は strings だけ（state を引かない）。
// - M16 追補 H-3（2026-10-11 ユーザーの判断「等幅で揃えられるなら直す」）: 用語の行は用語の列（幅 32px）と説明に分け、
//   説明の書き出しを揃える（splitRuleLine。表示のための字の切り分けだけ）。
// - M19（D-3）: 窓はプレイ画面の部品ではなく、ステージ直下の層（createRulesOverlay）に置く。タイトルの設定からも開けるように
//   （プレイ画面はタイトルで隠れている）。タイトルでは下を覆う幕と、操作領域の「閉じる」と同じ位置の「閉じる」も出す。
// モジュールのトップレベルでは DOM に触れない。
import type { Strings } from "../../core/data/index";
import { onTap } from "../input/tap";
import type { Rect } from "../layout";
import { createWipeView, type WipeLine } from "./wipe";

/** UI-77 の用語と説明の区切り（全角空白） */
const SEP = String.fromCharCode(0x3000);
/** UI-77 の用語の最大の字数（用語の列 32px = 全角 4 字に、用語 3 字 + 区切りが収まる） */
export const RULE_TERM_MAX = 3;

/**
 * UI-77（M16 追補 H-3）の行の切り分け（純粋）。最初の全角空白の前が RULE_TERM_MAX 字以内で空白を含まなければ用語、
 * 後ろが説明。全角空白で始まる行は用語の無い続きの行（term は空。説明の列に字下げ）。それ以外（職業の略称の一覧など）は文字列のまま
 */
export function splitRuleLine(text: string): WipeLine {
  const i = text.indexOf(SEP);
  if (i < 0) return text;
  const term = text.slice(0, i);
  if ([...term].length > RULE_TERM_MAX || /\s/.test(term)) return text;
  return { term, desc: text.slice(i + SEP.length) };
}

/**
 * UI-77（M22 D-6）: 1 本の strings の行を表示の行に切り分ける（純粋）。用語が RULE_TERM_MAX 字を超える行（空白を含まない）は、
 * 用語の列（32px）に入らないので、用語だけを 1 行（文字列）に置き、説明を次の行（用語なしの続きの行。説明の列に字下げ）にする。
 * ほかは splitRuleLine の 1 行。strings の書き方は「用語　説明」のまま（長い説明は全角空白で始まる次のキーに続ける）
 */
export function splitRuleEntry(text: string): WipeLine[] {
  const i = text.indexOf(SEP);
  if (i < 0) return [text];
  const term = text.slice(0, i);
  if ([...term].length > RULE_TERM_MAX && !/\s/.test(term) && !term.startsWith("■")) return [term, { term: "", desc: text.slice(i + SEP.length) }];
  return [splitRuleLine(text)];
}

/** UI-77 の行（純粋）。1 行目は見出し（文字列）。2 行目からは splitRuleEntry の結果 */
export function formatRules(strings: Strings): WipeLine[] {
  const out: WipeLine[] = [strings["rules.title"] ?? "rules.title"];
  for (let n = 1; strings[`rules.line.${n}`] !== undefined; n++) out.push(...splitRuleEntry(strings[`rules.line.${n}`]!));
  return out;
}

export type RulesOverlay = {
  /** ステージ直下の層（ステージ全面。自身は押せず、窓・幕・「閉じる」だけが押せる） */
  el: HTMLElement;
  /** 行を描いて出す。onTitle なら下（タイトル）を覆う幕と「閉じる」も出す（遊んでいる途中は操作領域の「閉じる」を使う） */
  show(lines: readonly WipeLine[], onTitle: boolean): void;
  hide(): void;
};

/**
 * UI-77 / UI-57（M19 D-3）: 用語の窓の層。rect は窓（layout の wipe。戦績・全滅の内訳と同じ範囲）、close は「閉じる」
 * （layout の mapClose。操作領域の close モードの「閉じる」と同じ位置）。onClose は「閉じる」を押したとき（タイトルだけ出す）
 */
export function createRulesOverlay(o: { rect: Rect; close: Rect; strings: Strings; onClose(): void }): RulesOverlay {
  const el = document.createElement("div");
  el.className = "rules-layer";
  Object.assign(el.style, { position: "absolute", left: "0px", top: "0px", width: "100%", height: "100%", pointerEvents: "none", display: "none" });
  // タイトルの間だけ下を覆う幕（タイトルの項目を押させない）
  const backdrop = document.createElement("div");
  backdrop.className = "rules-backdrop";
  Object.assign(backdrop.style, { position: "absolute", left: "0px", top: "0px", width: "100%", height: "100%", background: "var(--c-bg)", pointerEvents: "auto" });
  const frame = createWipeView(o.rect, o.strings);
  frame.el.className = "rules-frame";
  frame.el.style.pointerEvents = "auto";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "ui-button";
  close.textContent = o.strings["ending.dismiss"] ?? "ending.dismiss";
  Object.assign(close.style, {
    left: `${o.close.x}px`,
    top: `${o.close.y}px`,
    width: `${o.close.w}px`,
    height: `${o.close.h}px`,
    lineHeight: `${o.close.h - 2}px`,
    pointerEvents: "auto",
  });
  onTap(close, () => o.onClose());
  el.appendChild(backdrop);
  el.appendChild(frame.el);
  el.appendChild(close);
  return {
    el,
    show(lines, onTitle) {
      frame.render(lines);
      backdrop.style.display = onTitle ? "" : "none";
      close.style.display = onTitle ? "" : "none";
      el.style.display = "";
      // UI-11 / UI-77: 見えてから先頭へ戻し、続きの印を出し直す（隠れている間は scrollTop も寸法も効かない。開くたびに先頭から）
      frame.reveal();
    },
    hide() {
      el.style.display = "none";
    },
  };
}
