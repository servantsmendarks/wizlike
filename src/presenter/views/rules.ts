// UI-77 用語の一覧（M16。2026-10-11。town.md TW-03 の酒場）。酒場の「用語」で開く。
// 部品・矩形・閉じ方は戦績の画面（UI-73。views/ending.ts。overlay ending）と同じ: 行の高さ 10 の縦スクロール、1 行目は見出し（accent）。
// - formatRules は純粋: 見出し rules.title → rules.line.1, 2, …（strings に続き番号のキーがある限り。途切れた先は使わない。
//   行の数はコードに持たない。opening.speech.N と同じ形）。値は strings だけ（state を引かない）。
// - M16 追補 H-3（2026-10-11 ユーザーの判断「等幅で揃えられるなら直す」）: 用語の行は用語の列（幅 32px）と説明に分け、
//   説明の書き出しを揃える（splitRuleLine。表示のための字の切り分けだけ）。
// モジュールのトップレベルでは DOM に触れない。
import type { Strings } from "../../core/data/index";
import type { WipeLine } from "./wipe";

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

/** UI-77 の行（純粋）。1 行目は見出し（文字列）。2 行目からは splitRuleLine の結果 */
export function formatRules(strings: Strings): WipeLine[] {
  const out: WipeLine[] = [strings["rules.title"] ?? "rules.title"];
  for (let n = 1; strings[`rules.line.${n}`] !== undefined; n++) out.push(splitRuleLine(strings[`rules.line.${n}`]!));
  return out;
}
