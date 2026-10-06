// H9 バランスの煙テスト（既定の npm test）: 200 シードの計測（npm run balance、tests/balance/campaign.sim.ts）と同じボットを
// 5 シード × 潜行 2 回だけ回し、不変条件（rejected が出ない、state の不変条件、全滅の内訳 = 差分、DG-43 など）だけを確かめる。
// M9: 進行ボット（d01 の 2 階とボス、d01 の踏破の後の d02）の煙テストを足した（数字は見ない）。
import { describe, expect, test } from "vitest";
import { expectStateInvariants } from "./helpers/core";
import { BOTS, Campaign, D02_DIVES, PROGRESS_BOT, PROGRESS_DIVES, progressReport, report, RESERVE_MUL, runCampaigns } from "./balance/bot";

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

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
    // M9-装備: d01 の踏破で流通レベル 2 になり、その帰還の街で後衛の魔術師（エル）に投げナイフを買い与える。d02 では飛行だけの遭遇で逃走を選ぶ
    expect(r.dives[k]!.rangedBought).toBe(1);
    expect(c.state.items[c.state.party[4]!.equipment.weapon!]!.itemId).toBe("throwing_knives");
    expect(sum(r.dives.slice(k + 1).map((d) => d.fleeTries))).toBeGreaterThan(0);
    // 逃走を選んだ戦闘の数は戦闘ごとに 1 回だけ数える（試みのラウンド数以下で、逃げ切った戦闘の数以上）
    for (const d of r.dives) {
      expect(d.fleeBattles).toBeLessThanOrEqual(d.fleeTries);
      expect(d.fleeOk).toBeLessThanOrEqual(d.fleeBattles);
      expect(d.fleeBattles).toBeLessThanOrEqual(d.battles);
    }
    expect(sum(r.dives.slice(k + 1).map((d) => d.fleeBattles))).toBeGreaterThan(0);
  }, 60_000);

  test("H9/M9 M9-装備: 所持金 5000・流通レベル 2 で 1 潜行すると、街で前衛の防具を流通レベルの品に替え（実効の AC が下がるものだけ）、後衛に ranged を買い、蘇生費 × RESERVE_MUL を残す", () => {
    const c = new Campaign(1, PROGRESS_BOT);
    c.state.gold = 5000;
    c.state.progress.shopLevel = 2;
    const r = c.campaign(1);
    const d = r.dives[0]!;
    expect(d.method).not.toBe("wipe");
    const eq = (i: number, slot: "weapon" | "armor" | "shield" | "helm" | "gauntlet") => {
      const id = c.state.party[i]!.equipment[slot];
      return id === null ? null : `${c.state.items[id]!.itemId}+${c.state.items[id]!.level}`;
    };
    // アルド（戦士）: 革鎧 → 鎖帷子、木の盾 → 鉄の盾、空の兜 → 鉄兜、空の小手 → 革小手（鉄の小手は流通レベル 4）
    expect([eq(0, "armor"), eq(0, "shield"), eq(0, "helm"), eq(0, "gauntlet")]).toEqual(["chain_mail+2", "iron_shield+2", "iron_helm+2", "leather_gloves+2"]);
    // ベルク（戦士）: 鎖帷子 +0 は AC が同じなので替えない
    expect(eq(1, "armor")).toBe("chain_mail+0");
    // キリ（盗賊）: 革鎧 → 鋲打ち革鎧、革兜 → 鎖頭巾、盾は使えない
    expect([eq(2, "armor"), eq(2, "shield"), eq(2, "helm")]).toEqual(["studded_leather+2", null, "chain_coif+2"]);
    // 後衛: 僧侶（ドナ）は投げナイフも短弓も使えない、魔術師（エル）は投げナイフ、短弓のフィンはそのまま
    expect([eq(3, "weapon"), eq(4, "weapon"), eq(5, "weapon")]).toEqual(["staff+0", "throwing_knives+2", "short_bow+0"]);
    expect(d.rangedBought).toBe(1);
    expect(d.armorBought).toBe(10); // アルド 4・ベルク 3（盾・兜・小手）・キリ 3（鎧・兜・小手）
    expect(d.unsold).toBe(0); // 外した品は売った
    expect(c.state.gold).toBeGreaterThanOrEqual(c.reviveCost() * RESERVE_MUL);
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
