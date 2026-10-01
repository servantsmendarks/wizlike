// UI-56 全滅の内訳（views/wipe.ts の formatWipeSummary）。PenaltyResult だけで描き、state を引かない。
// 帯（data/penalty-table.json）: 0 大災厄 2..3、1 災難 4..6、2 痛手 7..10、…、最後が奇跡。
import { describe, expect, test } from "vitest";
import { execute } from "../src/core/engine";
import type { GameEvent, PenaltyResult } from "../src/core/types";
import { formatWipeSummary } from "../src/presenter/views/wipe";
import { data, newGame } from "./helpers/core";

const S = data.strings;

describe("UI-56 全滅の内訳", () => {
  test("UI-56 行の順: 帯 → 出目 → 台帳 → 所持金 → 失った品 → 各人の EXP（Lv が下がった者は Lv の変化）", () => {
    const p: PenaltyResult = {
      dice: [2, 3],
      total: 5,
      bandIndex: 1,
      ledgerGold: 40,
      ledgerItems: ["薬草", "短剣？"],
      goldLost: 78,
      itemsLost: [
        { memberId: "c2", instanceId: "i9", itemId: "herb", name: "薬草", equipped: false },
        { memberId: "c1", instanceId: "i1", itemId: "long_sword", name: "長剣", equipped: true },
      ],
      expLost: [
        { id: "c1", name: "アルド", expBefore: 1200, lost: 180, levelFrom: 4, levelTo: 3 },
        { id: "c2", name: "ベルク", expBefore: 0, lost: 0, levelFrom: 1, levelTo: 1 },
      ],
      revived: ["c2"],
      leaderRule: true,
    };
    expect(data.penaltyTable.bands[1]!.name).toBe("災難");
    expect(formatWipeSummary(p, data, S)).toEqual([
      "全滅の代償　災難",
      "出目 2+3 ＝ 5",
      "持ち帰れなかった　40G・2品",
      "所持金　−78G",
      "失った品　薬草",
      "失った品　長剣",
      "アルド　−180EXP　Lv4→3",
      "ベルク　−0EXP",
    ]);
  });

  test("UI-56 奇跡（損失 0）・台帳が空: ledgerNone と itemsNone を出し、所持金は −0G", () => {
    const last = data.penaltyTable.bands.length - 1;
    const p: PenaltyResult = {
      dice: [10, 10],
      total: 20,
      bandIndex: last,
      ledgerGold: 0,
      ledgerItems: [],
      goldLost: 0,
      itemsLost: [],
      expLost: [{ id: "c1", name: "アルド", expBefore: 0, lost: 0, levelFrom: 1, levelTo: 1 }],
      revived: [],
      leaderRule: true,
    };
    expect(formatWipeSummary(p, data, S)).toEqual([
      `全滅の代償　${data.penaltyTable.bands[last]!.name}`,
      "出目 10+10 ＝ 20",
      "持ち帰るはずのものは無かった",
      "所持金　−0G",
      "失った品　なし",
      "アルド　−0EXP",
    ]);
  });

  test("UI-56 台帳の金が 0 でも品があれば ledger の行（0G・n品）", () => {
    const p: PenaltyResult = {
      dice: [5, 6],
      total: 11,
      bandIndex: 3,
      ledgerGold: 0,
      ledgerItems: ["薬草"],
      goldLost: 0,
      itemsLost: [],
      expLost: [],
      revived: [],
      leaderRule: false,
    };
    expect(formatWipeSummary(p, data, S)[2]).toBe("持ち帰れなかった　0G・1品");
  });

  test("UI-56 core の全滅（迷宮で行動可能な者がいない一行のコマンド。TW-20）の wipe イベントをそのまま描ける。内訳の行に未置換の {…} が残らない", () => {
    // 迷宮に入り、全員を dead にしてから 1 回向きを変える（engine の後処理で全滅処理になる）
    const s0 = execute(newGame(5), { type: "dungeon.enter", dungeonId: "d01" }, data).state;
    const s1 = structuredClone(s0);
    for (const ch of s1.party) {
      ch.life = "dead";
      ch.hp = 0;
    }
    const r = execute(s1, { type: "dungeon.turn", dir: "left" }, data);
    const w = r.events.find((e): e is Extract<GameEvent, { kind: "wipe" }> => e.kind === "wipe");
    expect(w).toBeDefined();
    const lines = formatWipeSummary(w!.penalty, data, S);
    expect(lines[0]).toBe(`全滅の代償　${data.penaltyTable.bands[w!.penalty.bandIndex]!.name}`);
    expect(lines[1]).toBe(`出目 ${w!.penalty.dice.join("+")} ＝ ${w!.penalty.total}`);
    expect(lines.length).toBe(4 + Math.max(1, w!.penalty.itemsLost.length) + w!.penalty.expLost.length);
    for (const l of lines) expect(l).not.toMatch(/[{}]/);
    expect(S["wipe.toTown"]).toBe("街へ");
  });
});
