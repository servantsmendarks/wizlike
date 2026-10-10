// UI-77 用語の一覧（M16。2026-10-11。town.md TW-03 の酒場）。酒場の「用語」で開く。
// 部品・矩形・閉じ方は戦績の画面（UI-73。views/ending.ts。overlay ending）と同じ: 行の高さ 10 の縦スクロール、1 行目は見出し（accent）。
// - formatRules は純粋: 見出し rules.title → rules.line.1, 2, …（strings に続き番号のキーがある限り。途切れた先は使わない。
//   行の数はコードに持たない。opening.speech.N と同じ形）。値は strings だけ（state を引かない）。
// モジュールのトップレベルでは DOM に触れない。
import type { Strings } from "../../core/data/index";

/** UI-77 の行（純粋）。1 行目は見出し */
export function formatRules(strings: Strings): string[] {
  const out: string[] = [strings["rules.title"] ?? "rules.title"];
  for (let n = 1; strings[`rules.line.${n}`] !== undefined; n++) out.push(strings[`rules.line.${n}`]!);
  return out;
}
