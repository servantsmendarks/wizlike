// テスト用: 美咲フォント（全角 8px = 1 単位、半角 ASCII 4px = 0.5 単位）で、WRAP_STYLE（views/wrap.ts。line-break: strict）の
// 折り返しを近似した行。ブラウザと同じく、行頭に来てはいけない字（句読点・閉じ括弧・！？…・ー・小書きの仮名・半角の ) ] ! ? , . など）が
// 次の行の先頭になるときと、開き括弧が行末に残るときは、前の字ごと次の行へ送る（追い出し）。半角の英数字の語の途中では、語の頭に戻せれば戻す。
// 2026-10-05 に headless Chrome（美咲・幅 232px）で、29 字 +「。」など 10 通りが「28 字 / へ。次」になることを確かめた形。
export const NOT_AT_LINE_START = new Set(
  Array.from("。、，．」』）】〕〉》｝］！？…‥ー・：；ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ々)]},.!?:;"),
);
export const NOT_AT_LINE_END = new Set(Array.from("「『（【〔〈《｛［([{"));

const unit = (c: string): number => ((c.codePointAt(0) ?? 0) < 0x80 || c === "\u00a0" ? 0.5 : 1);
const isWordChar = (c: string | undefined): boolean => c !== undefined && /^[A-Za-z0-9_ ]$/.test(c);

/** text（\n で段落を分ける）を幅 cols 単位で折り返した行 */
export function kinsokuLines(text: string, cols: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    const cs = Array.from(para);
    if (cs.length === 0) {
      out.push("");
      continue;
    }
    let start = 0;
    while (start < cs.length) {
      let cur = 0;
      let i = start;
      while (i < cs.length && cur + unit(cs[i]!) <= cols) cur += unit(cs[i++]!);
      if (i >= cs.length) {
        out.push(cs.slice(start).join(""));
        break;
      }
      let b = i;
      // 半角の語の途中なら語の頭へ（行の頭まで語なら overflow-wrap: anywhere で字の途中で折る）
      if (isWordChar(cs[b]) && isWordChar(cs[b - 1])) {
        let k = b;
        while (k > start && isWordChar(cs[k - 1])) k--;
        if (k > start) b = k;
      }
      // 金額（「400 G」）は NBSP でつながった 1 語（isWordChar）なので、G だけが行頭に来ない。禁則の追い出しは語の頭より前で行う
      for (;;) {
        while (b > start + 1 && (NOT_AT_LINE_START.has(cs[b]!) || NOT_AT_LINE_END.has(cs[b - 1]!))) b--;
        // 追い出しで語の途中に来たら、語の頭へ戻す（「400 G。」の「。」を追い出すと G で切れるので、400 ごと送る）
        if (isWordChar(cs[b]) && isWordChar(cs[b - 1])) {
          let k = b;
          while (k > start && isWordChar(cs[k - 1])) k--;
          if (k > start) {
            b = k;
            continue;
          }
        }
        break;
      }
      out.push(cs.slice(start, b).join(""));
      start = b;
    }
  }
  return out;
}
