// H9 バランスの煙テスト（既定の npm test）: 200 シードの計測（npm run balance、tests/balance/campaign.sim.ts）と同じボットを
// 5 シード × 潜行 2 回だけ回し、不変条件（rejected が出ない、state の不変条件、全滅の内訳 = 差分、DG-43 など）だけを確かめる。
import { describe, expect, test } from "vitest";
import { BOTS, report, runCampaigns } from "./balance/bot";

const SEEDS = 5;
const DIVES = 2;

describe("バランス（H9 煙テスト）", () => {
  for (const kind of BOTS) {
    test(`H9 バランス煙テスト: ${kind.label}ボットで 潜行 → 街 を ${DIVES} 回 × ${SEEDS} シード、不変条件が崩れない`, () => {
      const { results, keys } = runCampaigns(kind, SEEDS, DIVES);
      expect(results).toHaveLength(SEEDS);
      for (const k of ["battle.encounter", "town.enter", "town.inn.stay"]) expect(keys.has(k), k).toBe(true);
      expect(report(kind, results, SEEDS, DIVES)).toContain(kind.label);
    }, 60_000);
  }
});
