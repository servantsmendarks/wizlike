// UI-56（M5.5）: 全滅の出目の表（views/penalty-table.ts の純粋な部分）。中身は core の penaltyTable イベント（wipe.ts の penaltyTableView）だけから作る。
import { describe, expect, test } from "vitest";
import { penaltyTableView } from "../src/core/rules/wipe";
import { diceBox } from "../src/presenter/views/dice";
import { formatPenaltyTable, penaltyTableBox } from "../src/presenter/views/penalty-table";
import { data } from "./helpers/core";

const S = data.strings;
const tableEv = (hit: number | null) => ({ ...penaltyTableView(data), hit });

/** 美咲ゴシックの幅（半角 4px・全角 8px） */
const widthOf = (t: string): number => [...t].reduce((w, ch) => w + (ch.charCodeAt(0) < 0x80 ? 4 : 8), 0);

describe("UI-56 出目の表", () => {
  test("UI-56 formatPenaltyTable: hit の行だけ wipe.table.mark、ほかは wipe.table.pad。hit null は全行 pad。見出しは wipe.table.title", () => {
    const n = data.penaltyTable.bands.length;
    const none = formatPenaltyTable(tableEv(null), S);
    expect(none.title).toBe(`出目の表（${data.penaltyTable.dice}）`);
    expect(none.lines).toHaveLength(n);
    for (const l of none.lines) {
      expect(l.hit).toBe(false);
      expect(l.text.startsWith(S["wipe.table.pad"]!)).toBe(true);
    }
    for (let h = 0; h < n; h++) {
      const v = formatPenaltyTable(tableEv(h), S);
      expect(v.lines.map((l) => l.hit)).toEqual(Array.from({ length: n }, (_, i) => i === h));
      v.lines.forEach((l, i) => expect(l.text.startsWith(S[i === h ? "wipe.table.mark" : "wipe.table.pad"]!)).toBe(true));
      // 頭の印を除けば hit の有無で同じ文
      expect(v.lines.map((l) => [...l.text].slice(1).join(""))).toEqual(none.lines.map((l) => [...l.text].slice(1).join("")));
    }
  });

  test("UI-56 formatPenaltyTable の行は帯の範囲・名前・割合を手で書いた期待値と一致する（実データの先頭と末尾の帯）", () => {
    const b = data.penaltyTable.bands;
    const first = b[0]!;
    const last = b[b.length - 1]!;
    const v = formatPenaltyTable(tableEv(null), S);
    const pct = (r: number) => Math.round(r * 100);
    expect(v.lines[0]!.text).toBe(`　${first.min}〜${first.max} ${first.name} 金−${pct(first.goldLossRatio)}% 品−${first.itemLoss} 経験−${pct(first.expLossRatio)}%`);
    // 末尾の帯は min === max（rowOne）
    expect(last.min).toBe(last.max);
    expect(v.lines.at(-1)!.text).toBe(`　${last.min} ${last.name} 金−${pct(last.goldLossRatio)}% 品−${last.itemLoss} 経験−${pct(last.expLossRatio)}%`);
    // どの行も箱の内側の幅（224 − 8 = 216px）に収まる
    for (const l of [v.title, ...v.lines.map((x) => x.text)]) expect(widthOf(l), l).toBeLessThanOrEqual(216);
  });

  test("UI-56 penaltyTableBox(7) は x8 w224 y4..91 で、全滅の 2d10 の箱（diceBox 1 行 = y98..145）と重ならない。8 行（core の検証の上限）でも上へ詰めて重ならない", () => {
    expect(penaltyTableBox(7)).toEqual({ x: 8, y: 4, w: 224, h: 88 });
    const wipeDice = diceBox({ rows: [{ label: { key: "dice.row.roll" }, base: null, dice: [3, 4], total: 7 }] });
    expect(wipeDice).toEqual({ x: 8, y: 98, w: 224, h: 48 });
    for (let n = 1; n <= 8; n++) {
      const r = penaltyTableBox(n);
      expect(r.h).toBe(8 + 10 * (1 + n));
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.y + r.h, String(n)).toBeLessThanOrEqual(wipeDice.y);
    }
    expect(penaltyTableBox(8).y).toBe(0);
    // 実データの帯の数は 7（y4 から）
    expect(penaltyTableBox(data.penaltyTable.bands.length).y).toBe(4);
  });
});
