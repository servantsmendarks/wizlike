// H9 バランスの計測（npm run balance。既定の npm test には含めない）: 2 つのボットで 潜行 → 街 を 5 回 × 200 シード。
// 数字は console.log に出すだけで、合否は不変条件。
import { describe, expect, test } from "vitest";
import { BOTS, report, runCampaigns } from "./bot";

const SEEDS = 200;
const DIVES = 5;

describe("バランス（H9 計測）", () => {
  for (const kind of BOTS) {
    test(`H9 バランス: ${kind.label}ボットで 潜行 → 救済・寺院・闇魔術 → 相部屋 → 店 を ${DIVES} 回 × ${SEEDS} シード（数字は出力するだけで、合否は不変条件）`, () => {
      const { results, keys } = runCampaigns(kind, SEEDS, DIVES);
      for (const k of ["battle.encounter", "battle.win", "town.enter", "town.inn.stay", "town.shop.bought"]) expect(keys.has(k), k).toBe(true);
      console.log(report(kind, results, SEEDS, DIVES));
    }, 600_000);
  }
});
