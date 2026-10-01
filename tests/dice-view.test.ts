// UI-40: ダイス表示の段（src/presenter/views/dice.ts の純粋な部分）。
import { describe, expect, test } from "vitest";
import { DICE_BOX, DICE_BOX_TWO, diceFrames } from "../src/presenter/views/dice";
import { data } from "./helpers/core";

describe("UI-40 diceFrames", () => {
  test("UI-40 2 個: [?,?] → [3,?] → [3,5] → 合計", () => {
    expect(diceFrames({ dice: [3, 5], total: 8 }, false)).toEqual([
      { dice: [null, null], total: null },
      { dice: [3, null], total: null },
      { dice: [3, 5], total: null },
      { dice: [3, 5], total: 8 },
    ]);
  });

  test("UI-40 d100 は 1 個のダイス。total が出目と違ってもそのまま（先手判定の floor(平均)+出目）", () => {
    expect(diceFrames({ dice: [37], total: 37 }, false)).toEqual([
      { dice: [null], total: null },
      { dice: [37], total: null },
      { dice: [37], total: 37 },
    ]);
    expect(diceFrames({ dice: [4], total: 12 }, false).at(-1)).toEqual({ dice: [4], total: 12 });
  });

  test("§3-9/UI-40 skip は最終の 1 段だけ", () => {
    expect(diceFrames({ dice: [3, 5], total: 8 }, true)).toEqual([{ dice: [3, 5], total: 8 }]);
    expect(diceFrames({ dice: [], total: 0 }, true)).toEqual([{ dice: [], total: 0 }]);
  });

  test("UI-40 overlay はビュー（240×150）の内側で、2 行は下端を揃えて上へ 20 伸ばす。合計の文言は dice.total", () => {
    for (const r of [DICE_BOX, DICE_BOX_TWO]) expect(r.x >= 0 && r.y >= 0 && r.x + r.w <= 240 && r.y + r.h <= 150).toBe(true);
    expect(DICE_BOX).toEqual({ x: 20, y: 106, w: 200, h: 42 });
    expect(DICE_BOX_TWO.y + DICE_BOX_TWO.h).toBe(DICE_BOX.y + DICE_BOX.h);
    expect(DICE_BOX_TWO.h - DICE_BOX.h).toBe(20);
    expect(data.strings["dice.total"]).toContain("{total}");
  });
});
