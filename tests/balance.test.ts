// H9 バランスの煙テスト（既定の npm test）: 200 シードの計測（npm run balance、tests/balance/campaign.sim.ts）と同じボットを
// 5 シード × 潜行 2 回だけ回し、不変条件（rejected が出ない、state の不変条件、全滅の内訳 = 差分、DG-43 など）だけを確かめる。
// M9: 進行ボット（d01 の 2 階とボス、d01 の踏破の後の d02）の煙テストを足した（数字は見ない）。
import { describe, expect, test } from "vitest";
import { expectStateInvariants } from "./helpers/core";
import { BOTS, Campaign, D02_DIVES, PROGRESS_BOT, PROGRESS_DIVES, progressReport, report, runCampaigns } from "./balance/bot";

const SEEDS = 5;
const DIVES = 2;

describe("バランス（H9 煙テスト）", () => {
  for (const kind of BOTS) {
    test(`H9 バランス煙テスト: ${kind.label}ボットで 潜行 → 街 を ${DIVES} 回 × ${SEEDS} シード、不変条件が崩れない`, () => {
      const { results, keys } = runCampaigns(kind, SEEDS, DIVES);
      expect(results).toHaveLength(SEEDS);
      for (const k of ["battle.encounter", "town.enter", "town.inn.stay"]) expect(keys.has(k), k).toBe(true);
      expect(report(kind, results, SEEDS, DIVES)).toContain(kind.label);
      expect(report(kind, results, SEEDS, DIVES)).toContain("M7-死因"); // M7-死因の集計が後ろに足されている
    }, 60_000);
  }

  test("H9/M9 進行ボットの煙テスト: 3 シード × 3 潜行で不変条件が崩れず、集計に M9-進行の節が出る", () => {
    const { results } = runCampaigns(PROGRESS_BOT, 3, 3);
    expect(results).toHaveLength(3);
    for (const r of results) for (const d of r.dives) expect(d.dungeonId).toBe("d01");
    expect(progressReport(results)).toContain("M9-進行");
  }, 60_000);

  test("H9/M9 進行ボットの煙テスト: 降りる・ボスの条件の level を 1 にすると、d01 の 1 階で下り階段へ歩いて 2 階に降り、ボスへ向かう（3 シード × 2 潜行）", () => {
    const kind = { ...PROGRESS_BOT, label: "進行（L1）", descendLevel: 1, bossLevel: 1 };
    const { results, keys } = runCampaigns(kind, 3, 2);
    expect(keys.has("dungeon.descend")).toBe(true);
    const ds = results.flatMap((r) => r.dives);
    expect(ds.some((d) => d.deepestFloor === 2)).toBe(true);
    for (const d of ds) {
      if (d.bossWin) expect(d.method).toBe("teleport");
      if (d.method === "teleport") expect(d.bossWin).toBe(true);
    }
  }, 60_000);

  test("H9/M9 進行ボットの煙テスト: シード 4 は d01 のボスを倒してテレポーターで帰り、その後は d02 に D02_DIVES 回潜って終わる（ボスへの経路の煙。データが変わってシード 4 が踏破しなくなったら、踏破するシードに替える）", () => {
    const c = new Campaign(4, PROGRESS_BOT);
    const r = c.campaign(PROGRESS_DIVES);
    const k = r.dives.findIndex((d) => d.bossWin);
    expect(k).toBeGreaterThanOrEqual(0);
    expect(r.dives[k]!.method).toBe("teleport");
    expect(r.dives[k]!.bossFight).toBe(true);
    expect(r.dives[k]!.deepestFloor).toBe(2);
    expect(r.dives.slice(0, k + 1).every((d) => d.dungeonId === "d01")).toBe(true);
    expect(r.dives.slice(k + 1).map((d) => d.dungeonId)).toEqual(Array.from({ length: D02_DIVES }, () => "d02"));
    expect(c.state.progress.clearedDungeons).toContain("d01");
    expectStateInvariants(c.state);
  }, 60_000);

  test("H9/M9 進行ボットの煙テスト: d01 を踏破済み（clearedDungeons・unlockedDungeons に d02）の state からは d02 の 1 階に 1 潜行する", () => {
    const c = new Campaign(1, PROGRESS_BOT);
    c.state.progress.clearedDungeons.push("d01");
    c.state.progress.unlockedDungeons.push("d02");
    const r = c.campaign(1);
    expect(r.dives).toHaveLength(1);
    expect(r.dives[0]!.dungeonId).toBe("d02");
    expect(r.dives[0]!.deepestFloor).toBe(1);
    expect(c.state.screen).toBe("town");
    expectStateInvariants(c.state);
  }, 60_000);
});
