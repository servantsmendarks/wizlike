// UI-40: 判定の箱（src/presenter/views/dice.ts の純粋な部分）。
import { describe, expect, test } from "vitest";
import type { GameEvent } from "../src/core/types";
import { diceBox, diceFrames, formatDiceSummary, type DiceEvent } from "../src/presenter/views/dice";
import { data, expectKnownStringKeys } from "./helpers/core";

const INITIATIVE: DiceEvent = {
  kind: "dice",
  label: { key: "dice.initiative" },
  rows: [
    { label: { key: "dice.side.party" }, base: 10, dice: [7], total: 17 },
    { label: { key: "dice.side.enemy" }, base: 8, dice: [3], total: 11 },
  ],
  rule: { key: "dice.initiative.rule", params: { diff: 6, need: 5, ambush: 5 } },
  result: { key: "dice.initiative.party" },
};

const FLEE: DiceEvent = {
  kind: "dice",
  label: { key: "dice.flee" },
  rows: [{ label: { key: "dice.row.roll" }, base: null, dice: [42], total: 42 }],
  rule: { key: "dice.rule.rate", params: { rate: 55 } },
  result: { key: "dice.flee.ok" },
};

const WIPE: DiceEvent = {
  kind: "dice",
  label: { key: "dice.wipe" },
  rows: [{ label: { key: "dice.row.roll" }, base: null, dice: [3, 5], total: 8 }],
  rule: { key: "dice.wipe.rule", params: { min: 7, max: 10 } },
  result: { key: "dice.wipe.result", params: { band: "痛手" } },
};

/** EV-21 / TW-15（M7）: 士気 +1 の補正の行を挟んだ制止判定（base = 値、dice 空） */
const RESTRAIN_MORALE: DiceEvent = {
  kind: "dice",
  label: { key: "dice.restrain" },
  rows: [
    { label: { key: "dice.restrain.stopper", params: { name: "フィン" } }, base: 9, dice: [6], total: 15 },
    { label: { key: "dice.bonus.morale", params: { value: 1 } }, base: 1, dice: [], total: 1 },
    { label: { key: "dice.restrain.actor", params: { name: "キリ" } }, base: 15, dice: [1], total: 16 },
  ],
  rule: { key: "dice.restrain.rule", params: { diff: 0 } },
  result: { key: "dice.restrain.ok" },
};

describe("UI-40 diceFrames", () => {
  test("UI-40 2 行 × 1 個: ? → 目 → 合計 → 次の行（目 → 合計）→ 基準 → 結果", () => {
    expect(diceFrames(INITIATIVE, false)).toEqual([
      { rows: [{ dice: [null], total: null }, { dice: [null], total: null }], rule: false, result: false },
      { rows: [{ dice: [7], total: null }, { dice: [null], total: null }], rule: false, result: false },
      { rows: [{ dice: [7], total: 17 }, { dice: [null], total: null }], rule: false, result: false },
      { rows: [{ dice: [7], total: 17 }, { dice: [3], total: null }], rule: false, result: false },
      { rows: [{ dice: [7], total: 17 }, { dice: [3], total: 11 }], rule: false, result: false },
      { rows: [{ dice: [7], total: 17 }, { dice: [3], total: 11 }], rule: true, result: false },
      { rows: [{ dice: [7], total: 17 }, { dice: [3], total: 11 }], rule: true, result: true },
    ]);
  });

  test("UI-40 1 行 × 2 個（2d10）: 目を 1 個ずつ → 合計 → 基準 → 結果", () => {
    expect(diceFrames(WIPE, false)).toEqual([
      { rows: [{ dice: [null, null], total: null }], rule: false, result: false },
      { rows: [{ dice: [3, null], total: null }], rule: false, result: false },
      { rows: [{ dice: [3, 5], total: null }], rule: false, result: false },
      { rows: [{ dice: [3, 5], total: 8 }], rule: false, result: false },
      { rows: [{ dice: [3, 5], total: 8 }], rule: true, result: false },
      { rows: [{ dice: [3, 5], total: 8 }], rule: true, result: true },
    ]);
  });

  test("UI-41/UI-40 skip は最終の 1 段だけ", () => {
    expect(diceFrames(INITIATIVE, true)).toEqual([
      { rows: [{ dice: [7], total: 17 }, { dice: [3], total: 11 }], rule: true, result: true },
    ]);
    expect(diceFrames({ rows: [] }, true)).toEqual([{ rows: [], rule: true, result: true }]);
  });
});

describe("UI-40 diceBox", () => {
  test("UI-40 x8 w224、下端 y146、高さ 8 + 10 ×（3 + 行数）。rows 1 で y98 h48、rows 2 で y88 h58。ビュー（240×150）の内側", () => {
    expect(diceBox(FLEE)).toEqual({ x: 8, y: 98, w: 224, h: 48 });
    expect(diceBox(INITIATIVE)).toEqual({ x: 8, y: 88, w: 224, h: 58 });
    for (const r of [diceBox(FLEE), diceBox(INITIATIVE)]) {
      expect(r.x >= 0 && r.y >= 0 && r.x + r.w <= 240 && r.y + r.h <= 150).toBe(true);
    }
  });
});

describe("UI-40/UI-46 formatDiceSummary", () => {
  test("UI-40 先手判定は「先手判定 味方 10+7=17 / 敵 8+3=11 / 差 6（5 以上で先手、-5 以下で不意打ち）→ 先手」", () => {
    expect(formatDiceSummary(INITIATIVE, data.strings)).toBe("先手判定 味方 10+7=17 / 敵 8+3=11 / 差 6（5 以上で先手、-5 以下で不意打ち）→ 先手");
  });

  test("UI-40 base が null で目が 1 個の行は「出目 42」（合計を繰り返さない）。2 個なら「出目 3+5=8」", () => {
    expect(formatDiceSummary(FLEE, data.strings)).toBe("逃走判定 出目 42 / 成功率 55（出目が 55 以下で成功）→ 逃げ切れる");
    expect(formatDiceSummary(WIPE, data.strings)).toBe("全滅の代償 出目 3+5=8 / 7〜10 の帯→ 痛手");
  });

  test("UI-40/EV-21/TW-15 補正の行（base が値で目が無い）は「士気 +1」だけ（base・目・合計を出さない）", () => {
    expect(formatDiceSummary(RESTRAIN_MORALE, data.strings)).toBe(
      "制止判定 フィンの知恵 9+6=15 / 士気 +1 / キリの素早さ 15+1=16 / 差 0（0 以上で制止）→ 制止",
    );
    // 3 行の箱は高さ 8 + 10 × 6 = 68、上端 146 − 68 = 78（ビューの内側）
    expect(diceBox(RESTRAIN_MORALE)).toEqual({ x: 8, y: 78, w: 224, h: 68 });
  });

  test("UI-40 使うキーはすべて strings.json にある", () => {
    const evs: GameEvent[] = [INITIATIVE, FLEE, WIPE, RESTRAIN_MORALE];
    expectKnownStringKeys(evs);
    for (const k of ["dice.plus", "dice.total", "dice.sep", "dice.arrow"]) expect(data.strings[k]).toBeDefined();
    expect(data.strings["dice.total"]).toContain("{total}");
  });
});
