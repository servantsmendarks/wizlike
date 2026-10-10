import { describe, expect, test } from "vitest";
import config from "../data/config.json";
import races from "../data/races.json";
import classes from "../data/classes.json";
import spells from "../data/spells.json";
import monsters from "../data/monsters.json";
import unknownKinds from "../data/unknown-kinds.json";
import items from "../data/items.json";
import equipmentBases from "../data/equipment-bases.json";
import itemOptions from "../data/item-options.json";
import uniques from "../data/uniques.json";
import drops from "../data/drops.json";
import personalities from "../data/personalities.json";
import penaltyTable from "../data/penalty-table.json";
import dungeons from "../data/dungeons.json";
import events from "../data/events.json";
import tavern from "../data/tavern.json";
import chestTraps from "../data/chest-traps.json";
import rivalries from "../data/rivalries.json";
import strings from "../data/strings.json";
import wavetables from "../data/wavetables.json";
import audio from "../data/audio.json";
import type { Screen } from "../src/core/types";
import {
  AUDIO_SCREENS,
  DATA_FILES,
  GameDataError,
  loadGameData,
  OPTION_KINDS,
  optionAppliesTo,
  optionKindOf,
  type RawGameData,
} from "../src/core/data";
import { createRng, isDiceExpr, rollDice } from "../src/core/rng";
import { addPlaceholderDungeon, loadDataWithPlaceholder } from "./helpers/core";

// 生データを書き換えるテスト用。JSON なので any で自由に壊す。
type Mutable = { [K in keyof RawGameData]: any };

function rawData(): Mutable {
  return structuredClone({
    config,
    races,
    classes,
    spells,
    monsters,
    unknownKinds,
    items,
    equipmentBases,
    itemOptions,
    uniques,
    drops,
    personalities,
    penaltyTable,
    dungeons,
    events,
    tavern,
    chestTraps,
    rivalries,
    strings,
    wavetables,
    audio,
  }) as Mutable;
}

function issuesOf(mutate: (r: Mutable) => void): string[] {
  const r = rawData();
  mutate(r);
  try {
    loadGameData(r);
    return [];
  } catch (e) {
    if (e instanceof GameDataError) return [...e.issues];
    throw e;
  }
}

/** mutate の結果、file の issue に fragment を含むものがある。 */
function expectIssue(mutate: (r: Mutable) => void, file: string, fragment: string): string[] {
  const issues = issuesOf(mutate);
  const hit = issues.filter((s) => s.startsWith(`${file}: `) && s.includes(fragment));
  expect(hit, `issues were:\n${issues.join("\n")}`).not.toHaveLength(0);
  return issues;
}

describe("data: 実データ", () => {
  test("data: 実データが loadGameData を通る", () => {
    const data = loadGameData(rawData());
    expect(data.races).toHaveLength(5);
    expect(data.classes).toHaveLength(7);
    expect(data.spells).toHaveLength(14); // M9: 4 つ（MG-45〜48）を末尾に追加
    expect(data.monsters).toHaveLength(20); // M9: 8 種を追加。M12: d03 の 6 種
    expect(data.items).toHaveLength(6); // M7 の B2: 消耗品 3・魔法書 1（装備は equipment-bases.json。IT-01）。M9 で魔法書 2 冊
    expect(data.personalities.map((p) => p.id).sort()).toEqual(["cautious", "greedy", "normal", "reckless"]);
    expect(data.penaltyTable.bands).toHaveLength(7);
    expect(data.dungeons.map((d) => d.id)).toEqual(["d01", "d02", "d03"]); // d03 は M9 の準備中の枠（DG-35）から M12 で本物になった
    expect(data.events).toHaveLength(6); // M9: EV-53〜55 を追加
    expect(data.chestTraps.map((t) => t.id)).toEqual(["poison_needle", "crossbow", "bomb", "poison_gas", "paralysis_gas", "alarm", "teleport", "curse"]); // M11（CB-62）
    expect(data.rivalries.map((x) => x.id)).toEqual(["thief_chest"]); // M11（EV-70）
    expect(data.tavern.events.map((e) => e.id)).toEqual(["dropped_coin", "old_rumor", "spilled_wager", "drowned_bell_rumor"]); // M9 で 2 つ
    expect(data.tavern.lookTexts).toHaveLength(4);
    expect(data.config.prototypeParty.members).toHaveLength(6);
    expect(data.config.prototypeParty.members[0]?.isLeader).toBe(true);
    expect(data.strings["dungeon.trap.pit"]).toBeTypeOf("string");
  });

  test("data: DATA_FILES がファイル名と対応する", () => {
    expect(DATA_FILES.penaltyTable).toBe("penalty-table.json");
    expect(DATA_FILES.config).toBe("config.json");
    expect(DATA_FILES.tavern).toBe("tavern.json");
    // M7: IT の 4 ファイル
    expect(DATA_FILES.equipmentBases).toBe("equipment-bases.json");
    expect(DATA_FILES.itemOptions).toBe("item-options.json");
    expect(DATA_FILES.uniques).toBe("uniques.json");
    expect(DATA_FILES.drops).toBe("drops.json");
    // M7: 未鑑定の系統（CB-05 / UI-60）
    expect(DATA_FILES.unknownKinds).toBe("unknown-kinds.json");
    expect(DATA_FILES.wavetables).toBe("wavetables.json");
    expect(DATA_FILES.audio).toBe("audio.json");
    // M11: 宝箱の罠（CB-62）と職業の掛け合い（EV-70）
    expect(DATA_FILES.chestTraps).toBe("chest-traps.json");
    expect(DATA_FILES.rivalries).toBe("rivalries.json");
    expect(Object.keys(DATA_FILES)).toHaveLength(21);
  });

  test("data: 実データの定数形ダイス（gold \"0\"、groupSize \"1\"）が通る", () => {
    const raw = rawData();
    expect(raw.monsters.filter((m: any) => m.gold === "0").length).toBeGreaterThanOrEqual(1);
    expect(raw.monsters.filter((m: any) => m.groupSize === "1").length).toBeGreaterThanOrEqual(1);
    expect(() => loadGameData(raw)).not.toThrow();
    // 定数形は rng の isDiceExpr / parseDice / rollDice にそのまま渡せる
    for (const m of raw.monsters as { gold: string; groupSize: string }[]) {
      expect(isDiceExpr(m.gold)).toBe(true);
      expect(isDiceExpr(m.groupSize)).toBe(true);
    }
    expect(rollDice(createRng(1), "0").total).toBe(0);
    expect(rollDice(createRng(1), "1").total).toBe(1);
  });

  test("data: strings.json の地の文は常体（です・ます・ません・ました・でした・ください が無い。「」の中の台詞は除く。§3-10 の GM の語り口）", () => {
    // ます・ません・ました は漢字の直後を除く（「目を覚ました」の 覚ます は常体）
    const polite = /です|でした|ください|(?<![一-鿿])(?:ます|ません|ました)/;
    const bad = Object.entries(strings as Record<string, string>)
      .filter(([, v]) => polite.test(v.replace(/「[^」]*」/g, "")))
      .map(([k]) => k);
    expect(bad).toEqual([]);
  });
});

describe("data: config.json", () => {
  test("data: 必須フィールドの欠落", () => {
    expectIssue((r) => delete r.config.combat.hitMin, "config.json", "combat.hitMin: missing required field");
  });
  test("data: 未知のキー（打ち間違い）", () => {
    expectIssue((r) => (r.config.combat.hitMaxx = 90), "config.json", "combat.hitMaxx: unknown field");
  });
  test("data: 型違い", () => {
    expectIssue((r) => (r.config.save.maxGames = "5"), "config.json", "save.maxGames: expected integer >= 1, got string");
  });
  test("data: CB-21 hitMin <= hitMax、百分率の範囲", () => {
    expectIssue((r) => (r.config.combat.hitMin = 96), "config.json", "CB-21");
    expectIssue((r) => (r.config.combat.hitMax = 101), "config.json", "combat.hitMax: expected integer in 0..100, got 101");
  });
  test("data: CH-77【仮】config.identify の既定値、希少度ごとの減点、min <= max、levelStep は 1 以上", () => {
    const d = loadGameData(rawData());
    expect(d.config.identify).toEqual({
      mpCost: 1, base: 60, iqPivot: 10, iqPerPoint: 3, levelStep: 10, perLevelStep: 10,
      rarityPenalty: { normal: 0, fine: 10, rare: 20, legendary: 30 }, uniquePenalty: 15,
      min: 5, max: 95, failSanDungeon: 3, possessChance: 50, possessSan: 10,
    });
    expectIssue((r) => delete r.config.identify.rarityPenalty.rare, "config.json", "identify.rarityPenalty.rare: missing required field");
    expectIssue((r) => (r.config.identify.min = 96), "config.json", "CH-77");
    expectIssue((r) => (r.config.identify.levelStep = 0), "config.json", "identify.levelStep: expected integer >= 1");
    expectIssue((r) => (r.config.identify.possessChance = 101), "config.json", "identify.possessChance: expected integer in 0..100, got 101");
  });
  test("data: TW-09 / CH-22【仮】config.classChange の料金は 0 以上の整数（既定 0）", () => {
    const d = loadGameData(rawData());
    expect(d.config.classChange).toEqual({ fee: 0 });
    expectIssue((r) => delete r.config.classChange.fee, "config.json", "classChange.fee: missing required field");
    expectIssue((r) => (r.config.classChange.fee = -1), "config.json", "classChange.fee: expected integer >= 0, got -1");
  });
  test("data: UI-75【仮】config.measure は計測用の拍の長さ（ms）で 11 欄とも正の整数", () => {
    const d = loadGameData(rawData());
    expect(d.config.measure).toEqual({
      stepMs: 135, turnMs: 136, encounterMs: 2660, actionMs: 1643, battleEndMs: 1103, chestCheckMs: 1359,
      chestOpenMs: 773, threadMs: 1887, sellMs: 864, identifyMs: 1238, innMs: 616,
    });
    expectIssue((r) => delete r.config.measure.actionMs, "config.json", "measure.actionMs: missing required field");
    expectIssue((r) => (r.config.measure.stepMs = 0), "config.json", "measure.stepMs: expected integer >= 1, got 0");
    expectIssue((r) => (r.config.measure.innMs = 1.5), "config.json", "measure.innMs: expected integer >= 1, got number");
  });
  test("data: CB-21/CB-26【仮】flyingHit は reach ごと（melee / long / ranged）の整数、rangedHitAgiMul・rangedHitLukPivot は整数", () => {
    const d = loadGameData(rawData());
    expect([d.config.combat.flyingHit, d.config.combat.rangedHitAgiMul, d.config.combat.rangedHitLukPivot]).toEqual([{ melee: -30, long: -15, ranged: 0 }, 2, 10]);
    expectIssue((r) => delete r.config.combat.flyingHit.long, "config.json", "combat.flyingHit.long: missing required field");
    expectIssue((r) => (r.config.combat.flyingHit.far = 0), "config.json", "combat.flyingHit.far: unknown field");
    expectIssue((r) => (r.config.combat.flyingHit.melee = -0.5), "config.json", "combat.flyingHit.melee: expected integer");
    expectIssue((r) => delete r.config.combat.rangedHitAgiMul, "config.json", "combat.rangedHitAgiMul: missing required field");
    expectIssue((r) => delete r.config.combat.rangedHitLukPivot, "config.json", "combat.rangedHitLukPivot: missing required field");
  });
  test("data: CB-32 combat.sleepNaturalWake は 0..100 の整数【仮】", () => {
    expect(config.combat.sleepNaturalWake).toBe(20);
    expectIssue((r) => (r.config.combat.sleepNaturalWake = -1), "config.json", "combat.sleepNaturalWake: expected integer in 0..100, got -1");
    expectIssue((r) => (r.config.combat.sleepNaturalWake = 101), "config.json", "combat.sleepNaturalWake: expected integer in 0..100, got 101");
    expectIssue((r) => (r.config.combat.sleepNaturalWake = 2.5), "config.json", "combat.sleepNaturalWake: expected integer");
    expectIssue((r) => delete r.config.combat.sleepNaturalWake, "config.json", "combat.sleepNaturalWake: missing required field");
    expect(issuesOf((r) => (r.config.combat.sleepNaturalWake = 0))).toEqual([]);
    expect(issuesOf((r) => (r.config.combat.sleepNaturalWake = 100))).toEqual([]);
  });
  test("data: CB-44 combat.autoDefendHpRatio は 0..1 の数【仮】", () => {
    expect(config.combat.autoDefendHpRatio).toBe(0.5);
    expectIssue((r) => (r.config.combat.autoDefendHpRatio = 1.5), "config.json", "combat.autoDefendHpRatio: expected number in 0..1, got 1.5");
    expectIssue((r) => (r.config.combat.autoDefendHpRatio = -0.1), "config.json", "combat.autoDefendHpRatio: expected number in 0..1, got -0.1");
    expectIssue((r) => delete r.config.combat.autoDefendHpRatio, "config.json", "combat.autoDefendHpRatio: missing required field");
    expect(issuesOf((r) => (r.config.combat.autoDefendHpRatio = 0))).toEqual([]);
    expect(issuesOf((r) => (r.config.combat.autoDefendHpRatio = 1))).toEqual([]);
  });
  test("data: TW-17 economy.upgrade*（料金 50・基礎 10・触媒 30・減衰 0.66・最大 3）【仮】の検証", () => {
    const e = config.economy;
    expect([e.upgradeBase, e.upgradeRateBase, e.upgradeRatePerCatalyst, e.upgradeDecay, e.upgradeMaxCatalysts]).toEqual([50, 10, 30, 0.66, 3]);
    expectIssue((r) => (r.config.economy.upgradeBase = -1), "config.json", "economy.upgradeBase: expected integer >= 0, got -1");
    expectIssue((r) => (r.config.economy.upgradeRateBase = 101), "config.json", "economy.upgradeRateBase: expected integer in 0..100, got 101");
    expectIssue((r) => (r.config.economy.upgradeRatePerCatalyst = 2.5), "config.json", "economy.upgradeRatePerCatalyst: expected integer");
    expectIssue((r) => (r.config.economy.upgradeDecay = 1.5), "config.json", "economy.upgradeDecay: expected number in 0..1, got 1.5");
    expectIssue((r) => (r.config.economy.upgradeMaxCatalysts = 0), "config.json", "economy.upgradeMaxCatalysts: expected integer >= 1, got 0");
    expectIssue((r) => delete r.config.economy.upgradeDecay, "config.json", "economy.upgradeDecay: missing required field");
  });
  test("data: CB-45/CH-53 san.randomDefendChance は 0..100 の整数【仮】", () => {
    expect(config.san.randomDefendChance).toBe(50);
    expectIssue((r) => (r.config.san.randomDefendChance = 101), "config.json", "san.randomDefendChance: expected integer in 0..100, got 101");
    expectIssue((r) => (r.config.san.randomDefendChance = -1), "config.json", "san.randomDefendChance: expected integer in 0..100, got -1");
    expectIssue((r) => (r.config.san.randomDefendChance = 2.5), "config.json", "san.randomDefendChance: expected integer");
    expectIssue((r) => delete r.config.san.randomDefendChance, "config.json", "san.randomDefendChance: missing required field");
    expect(issuesOf((r) => (r.config.san.randomDefendChance = 0))).toEqual([]);
    expect(issuesOf((r) => (r.config.san.randomDefendChance = 100))).toEqual([]);
  });
  test("data: EV-14 events.confusedLureWeight は 0..3 の整数【仮】", () => {
    expect(config.events.confusedLureWeight).toBe(2);
    expectIssue((r) => (r.config.events.confusedLureWeight = 4), "config.json", "events.confusedLureWeight: expected integer in 0..3, got 4");
    expectIssue((r) => (r.config.events.confusedLureWeight = -1), "config.json", "events.confusedLureWeight: expected integer in 0..3, got -1");
    expectIssue((r) => (r.config.events.confusedLureWeight = 1.5), "config.json", "events.confusedLureWeight: expected integer");
    expectIssue((r) => delete r.config.events.confusedLureWeight, "config.json", "events.confusedLureWeight: missing required field");
    expect(issuesOf((r) => (r.config.events.confusedLureWeight = 0))).toEqual([]);
    expect(issuesOf((r) => (r.config.events.confusedLureWeight = 3))).toEqual([]);
  });
  test("data: EV-11 events.lureMul は 0 以上、cap・floor は 0..100 の整数で floor ≤ cap【仮】。impulseThreshold は無い（M11）", () => {
    expect([config.events.lureMul, config.events.cap, config.events.floor]).toEqual([12, 60, 0]);
    expect("impulseThreshold" in config.events).toBe(false);
    expectIssue((r) => (r.config.events.impulseThreshold = 8), "config.json", "events.impulseThreshold: unknown field");
    expectIssue((r) => (r.config.events.lureMul = -1), "config.json", "events.lureMul: expected integer >= 0, got -1");
    expectIssue((r) => (r.config.events.lureMul = 1.5), "config.json", "events.lureMul: expected integer");
    expectIssue((r) => (r.config.events.cap = 101), "config.json", "events.cap: expected integer in 0..100, got 101");
    expectIssue((r) => (r.config.events.floor = -1), "config.json", "events.floor: expected integer in 0..100, got -1");
    expectIssue((r) => delete r.config.events.cap, "config.json", "events.cap: missing required field");
    expectIssue((r) => delete r.config.events.floor, "config.json", "events.floor: missing required field");
    expectIssue((r) => (r.config.events.floor = 61), "config.json", "events.floor: EV-11: floor 61 > cap 60");
    expect(issuesOf((r) => (r.config.events.floor = 60))).toEqual([]);
    expect(issuesOf((r) => (r.config.events.cap = 0))).toEqual([]);
    expect(issuesOf((r) => (r.config.events.lureMul = 0))).toEqual([]);
  });
  test("data: CB-61/CB-63/CB-64/IT-56/EV-16 config.chest の既定値【仮】と検証。combat.chestTrapChance は廃止（M11）", () => {
    const d = loadGameData(rawData());
    const rate = { statPivot: 10, thiefBonus: 30, agiMul: 2, lukMul: 2, dangerMul: 10, min: 5, max: 95 };
    expect(d.config.chest).toEqual({
      noTrapChance: 30,
      rarityUpPerDanger: 10,
      secondItemChance: 25,
      secondItemPerDanger: 15,
      inspect: { base: 40, ...rate },
      disarm: { base: 50, ...rate },
      triggerChance: 10,
      wrongNameChance: 50,
      disarmFailTrigger: 50,
      impulse: { lure: { treasure: 2, unknown: 0, danger: 1, weak: 0 }, stat: "agi", impulseClasses: ["thief"] },
    });
    expect("chestTrapChance" in config.combat).toBe(false);
    expectIssue((r) => (r.config.combat.chestTrapChance = 40), "config.json", "combat.chestTrapChance: unknown field");
    expectIssue((r) => delete r.config.chest.noTrapChance, "config.json", "chest.noTrapChance: missing required field");
    expectIssue((r) => (r.config.chest.noTrapChance = 101), "config.json", "chest.noTrapChance: expected integer in 0..100, got 101");
    expectIssue((r) => (r.config.chest.rarityUpPerDanger = -1), "config.json", "chest.rarityUpPerDanger: expected integer in 0..100, got -1");
    // CB-65 / IT-51（M14）: 2 個目の確率
    expectIssue((r) => delete r.config.chest.secondItemChance, "config.json", "chest.secondItemChance: missing required field");
    expectIssue((r) => (r.config.chest.secondItemChance = 101), "config.json", "chest.secondItemChance: expected integer in 0..100, got 101");
    expectIssue((r) => (r.config.chest.secondItemPerDanger = -1), "config.json", "chest.secondItemPerDanger: expected integer in 0..100, got -1");
    expectIssue((r) => delete r.config.chest.inspect.thiefBonus, "config.json", "chest.inspect.thiefBonus: missing required field");
    expectIssue((r) => (r.config.chest.disarm.dangerMul = 1.5), "config.json", "chest.disarm.dangerMul: expected integer");
    expectIssue((r) => (r.config.chest.inspect.min = 96), "config.json", "chest.inspect.min: CB-63: min 96 > max 95");
    expectIssue((r) => (r.config.chest.disarm.max = 4), "config.json", "chest.disarm.min: CB-64: min 5 > max 4");
    expectIssue((r) => (r.config.chest.disarm.max = 101), "config.json", "chest.disarm.max: expected integer in 0..100, got 101");
    expectIssue((r) => (r.config.chest.triggerChance = 51), "config.json", "chest.wrongNameChance: CB-63: triggerChance 51 + wrongNameChance 50 > 100");
    expectIssue((r) => (r.config.chest.disarmFailTrigger = 101), "config.json", "chest.disarmFailTrigger: expected integer in 0..100, got 101");
    expectIssue((r) => (r.config.chest.impulse.lure.treasure = 4), "config.json", "chest.impulse.lure.treasure: expected integer in 0..3, got 4");
    expectIssue((r) => (r.config.chest.impulse.stat = "spd"), "config.json", "chest.impulse.stat: expected one of");
    expectIssue((r) => (r.config.chest.impulse.impulseClasses = ["ninja"]), "config.json", 'chest.impulse.impulseClasses[0]: unknown class id "ninja"');
    expectIssue((r) => (r.config.chest.impulse.impulseClasses = ["thief", "thief"]), "config.json", 'chest.impulse.impulseClasses[1]: EV-04: duplicate class "thief"');
    expectIssue((r) => (r.config.chest.impulse.impulseClasses = []), "config.json", "chest.impulse.impulseClasses: expected at least 1 element(s), got 0");
    expect(issuesOf((r) => delete r.config.chest.impulse.impulseClasses)).toEqual([]);
    expect(issuesOf((r) => ((r.config.chest.triggerChance = 50), (r.config.chest.wrongNameChance = 50)))).toEqual([]);
  });
  test("data: CB-05 combat.identifyIqPerPoint は 0 以上の整数【仮】", () => {
    expectIssue((r) => (r.config.combat.identifyIqPerPoint = -1), "config.json", "combat.identifyIqPerPoint: expected integer >= 0, got -1");
    expectIssue((r) => (r.config.combat.identifyIqPerPoint = 0.5), "config.json", "combat.identifyIqPerPoint: expected integer");
    expectIssue((r) => delete r.config.combat.identifyIqPerPoint, "config.json", "combat.identifyIqPerPoint: missing required field");
    expect(issuesOf((r) => (r.config.combat.identifyIqPerPoint = 0))).toEqual([]);
  });
  test("data: CB-52 combat.chestGoldDice はダイス記法【仮】", () => {
    expectIssue((r) => (r.config.combat.chestGoldDice = "2d"), "config.json", 'combat.chestGoldDice: invalid dice expression "2d"');
    expectIssue((r) => delete r.config.combat.chestGoldDice, "config.json", "combat.chestGoldDice: missing required field");
    expect(issuesOf((r) => (r.config.combat.chestGoldDice = "0"))).toEqual([]);
  });
  test("data: IT-24 combat.acMin は撤廃した（M7。旧 CB-20 の下限 −10。残っていれば未知の欄で止める）", () => {
    expect(config.combat).not.toHaveProperty("acMin");
    expectIssue((r) => (r.config.combat.acMin = -10), "config.json", "combat.acMin: unknown field");
  });
  test("data: IT-30 config.items.rarities は normal / fine / rare / legendary の順で 4 件（73 / 22 / 5 / 0（M15。伝説の基礎の重みは 0）、個数 0〜3【仮】）", () => {
    expect(config.items.rarities.map((r) => [r.id, r.weight, r.options])).toEqual([
      ["normal", 73, 0],
      ["fine", 22, 1],
      ["rare", 5, 2],
      ["legendary", 0, 3],
    ]);
    expectIssue((r) => r.config.items.rarities.pop(), "config.json", "items.rarities: IT-30: expected 4 rarities");
    expectIssue((r) => (r.config.items.rarities[0].id = "fine"), "config.json", "items.rarities[0].id: IT-30");
    expectIssue((r) => r.config.items.rarities.forEach((x: { weight: number }) => (x.weight = 0)), "config.json", "items.rarities: IT-30: sum of weights");
    expectIssue((r) => (r.config.items.rarities[3].options = 4), "config.json", "items.rarities[3].options");
    expectIssue((r) => (r.config.items.rarities[1].weight = -1), "config.json", "items.rarities[1].weight");
    expect(issuesOf((r) => (r.config.items.rarities[0].weight = 0))).toEqual([]);
  });
  test("data: IT-56 config.items.legendaryMinDanger は整数 1〜4（M15。3【仮】）。欠落・範囲外で止める", () => {
    expect(config.items.legendaryMinDanger).toBe(3);
    expectIssue((r) => delete r.config.items.legendaryMinDanger, "config.json", "items.legendaryMinDanger: missing required field");
    expectIssue((r) => (r.config.items.legendaryMinDanger = 0), "config.json", "items.legendaryMinDanger: expected integer in 1..4, got 0");
    expectIssue((r) => (r.config.items.legendaryMinDanger = 5), "config.json", "items.legendaryMinDanger: expected integer in 1..4, got 5");
    expectIssue((r) => (r.config.items.legendaryMinDanger = 2.5), "config.json", "items.legendaryMinDanger: expected integer");
    expect(issuesOf((r) => (r.config.items.legendaryMinDanger = 1))).toEqual([]);
    expect(issuesOf((r) => (r.config.items.legendaryMinDanger = 4))).toEqual([]);
  });
  test("data: IT-20〜22・IT-32・IT-33・IT-53・IT-60〜64 config.items の数値【仮】と型", () => {
    const it = config.items;
    expect([it.curseChance, it.optionTierStep, it.weaponLvPerDamage, it.armorLvPerAc, it.casterLvPerPower]).toEqual([8, 4, 2, 3, 2]);
    expect(it.dropLevelUpWeights).toEqual([60, 30, 10]); // IT-53（M14）【仮】
    expect([it.levelPriceRatio, it.optionSellValue, it.warehouseSlots]).toEqual([0.5, [20, 40, 80], 40]);
    expectIssue((r) => delete r.config.items, "config.json", "items: missing required field");
    expectIssue((r) => (r.config.items.weaponLvPerDamage = 0), "config.json", "items.weaponLvPerDamage");
    expectIssue((r) => (r.config.items.armorLvPerAc = 0), "config.json", "items.armorLvPerAc");
    expectIssue((r) => (r.config.items.casterLvPerPower = 0), "config.json", "items.casterLvPerPower");
    expectIssue((r) => (r.config.items.optionTierStep = 0), "config.json", "items.optionTierStep");
    expectIssue((r) => (r.config.items.curseChance = 101), "config.json", "items.curseChance");
    // IT-53（M14）: 上乗せの重みは長さ 1 以上・非負の整数・合計 > 0。M13 までの dropLevelSpread は無くなった
    expectIssue((r) => (r.config.items.dropLevelUpWeights = []), "config.json", "items.dropLevelUpWeights");
    expectIssue((r) => (r.config.items.dropLevelUpWeights = [60, -1]), "config.json", "items.dropLevelUpWeights[1]");
    expectIssue((r) => (r.config.items.dropLevelUpWeights = [0, 0]), "config.json", "items.dropLevelUpWeights: IT-53: weights must sum to > 0");
    expectIssue((r) => (r.config.items.dropLevelSpread = 1), "config.json", "items.dropLevelSpread: unknown field");
    expect(issuesOf((r) => (r.config.items.dropLevelUpWeights = [0, 1]))).toEqual([]);
    expectIssue((r) => (r.config.items.levelPriceRatio = -0.5), "config.json", "items.levelPriceRatio");
    expectIssue((r) => (r.config.items.optionSellValue = [20, 40]), "config.json", "items.optionSellValue: IT-61: expected 3 values");
    expectIssue((r) => (r.config.items.optionSellValue = [20, -1, 80]), "config.json", "items.optionSellValue[1]");
    expectIssue((r) => (r.config.items.warehouseSlots = 0), "config.json", "items.warehouseSlots");
    expectIssue((r) => (r.config.items.extra = 1), "config.json", "items.extra: unknown field");
  });
  test("data: IT-30/IT-32 item-options の件数は rarities の個数の最大 + 1（呪いの余分）以上", () => {
    expectIssue((r) => (r.itemOptions.options = r.itemOptions.options.slice(0, 3)), "item-options.json", "options: IT-30/IT-32: expected at least 4 options");
    expect(issuesOf((r) => (r.itemOptions.options = r.itemOptions.options.slice(0, 4)))).toEqual([]);
    // 個数の最大を 2 にすれば 3 件で足りる
    expect(
      issuesOf((r) => {
        r.config.items.rarities[3].options = 2;
        r.itemOptions.options = r.itemOptions.options.slice(0, 3);
      }),
    ).toEqual([]);
  });
  test("data: DG-05 dungeon.defaultRooms は 1 以上の整数の [min, max]", () => {
    const p = "dungeon.defaultRooms";
    expectIssue((r) => (r.config.dungeon.defaultRooms = [6, 3]), "config.json", `${p}: min 6 > max 3`);
    expectIssue((r) => (r.config.dungeon.defaultRooms = [0, 6]), "config.json", `${p}[0]: expected integer >= 1, got 0`);
    expectIssue((r) => (r.config.dungeon.defaultRooms = [3, 6.5]), "config.json", `${p}[1]: expected integer`);
    expectIssue((r) => (r.config.dungeon.defaultRooms = [3]), "config.json", `${p}: expected [min, max] (2 elements), got 1 element(s)`);
    expectIssue((r) => (r.config.dungeon.defaultRooms = [3, 4, 6]), "config.json", `${p}: expected [min, max] (2 elements), got 3 element(s)`);
    expectIssue((r) => delete r.config.dungeon.defaultRooms, "config.json", `${p}: missing required field`);
  });
  test("data: DG-05 dungeon.roomSize / doorsPerRoom は 1 以上の整数の [min, max]", () => {
    for (const k of ["roomSize", "doorsPerRoom"]) {
      const p = `dungeon.${k}`;
      expectIssue((r) => (r.config.dungeon[k] = [3, 2]), "config.json", `${p}: min 3 > max 2`);
      expectIssue((r) => (r.config.dungeon[k] = [0, 2]), "config.json", `${p}[0]: expected integer >= 1, got 0`);
      expectIssue((r) => (r.config.dungeon[k] = [1, 2.5]), "config.json", `${p}[1]: expected integer`);
      expectIssue((r) => (r.config.dungeon[k] = [2]), "config.json", `${p}: expected [min, max] (2 elements), got 1 element(s)`);
      expectIssue((r) => delete r.config.dungeon[k], "config.json", `${p}: missing required field`);
      expect(issuesOf((r) => (r.config.dungeon[k] = [1, 1]))).toEqual([]);
    }
  });
  test("data: CH-65 growth.level1Bonus は 0 以上の整数【仮】。initialHpMinDieRatio は無くなった（未知キー）", () => {
    expect(config.growth.level1Bonus).toBe(4);
    expectIssue((r) => (r.config.growth.level1Bonus = -1), "config.json", "growth.level1Bonus: expected integer >= 0, got -1");
    expectIssue((r) => (r.config.growth.level1Bonus = 1.5), "config.json", "growth.level1Bonus: expected integer");
    expectIssue((r) => delete r.config.growth.level1Bonus, "config.json", "growth.level1Bonus: missing required field");
    expect(issuesOf((r) => (r.config.growth.level1Bonus = 0))).toEqual([]);
    expectIssue((r) => (r.config.growth.initialHpMinDieRatio = 0.5), "config.json", "growth.initialHpMinDieRatio: unknown field");
  });
  test("data: DG-05 dungeon.braidRatio は 0..1 の実数の [min, max]（min <= max）、straightBias は 0..1", () => {
    const p = "dungeon.braidRatio";
    expect(config.dungeon.braidRatio).toEqual([0.3, 0.5]);
    expectIssue((r) => (r.config.dungeon.braidRatio = [0.5, 0.3]), "config.json", `${p}: min 0.5 > max 0.3`);
    expectIssue((r) => (r.config.dungeon.braidRatio = [-0.1, 0.5]), "config.json", `${p}[0]: expected number in 0..1, got -0.1`);
    expectIssue((r) => (r.config.dungeon.braidRatio = [0.3, 1.5]), "config.json", `${p}[1]: expected number in 0..1, got 1.5`);
    expectIssue((r) => (r.config.dungeon.braidRatio = [0.3]), "config.json", `${p}: expected [min, max] (2 elements), got 1 element(s)`);
    expectIssue((r) => delete r.config.dungeon.braidRatio, "config.json", `${p}: missing required field`);
    expect(issuesOf((r) => (r.config.dungeon.braidRatio = [0, 0]))).toEqual([]);
    expect(issuesOf((r) => (r.config.dungeon.braidRatio = [0.4, 0.4]))).toEqual([]);
    expectIssue((r) => (r.config.dungeon.straightBias = 1.1), "config.json", "dungeon.straightBias: expected number in 0..1, got 1.1");
    expectIssue((r) => delete r.config.dungeon.straightBias, "config.json", "dungeon.straightBias: missing required field");
    expect(issuesOf((r) => (r.config.dungeon.straightBias = 0))).toEqual([]);
    expect(issuesOf((r) => (r.config.dungeon.straightBias = 1))).toEqual([]);
  });
  test("data: TW-04/MG-02 town.innRanks の HP は hpRatio（馬小屋 0 / 相部屋 1.0 / 個室 1.0【仮】。M7 で相部屋 0.5 → 1.0）。mpRatio は廃止（未知キー）", () => {
    expect(config.town.innRanks.map((r) => r.hpRatio)).toEqual([0, 1.0, 1.0]);
    expectIssue((r) => (r.config.town.innRanks[0].mpRatio = 0.25), "config.json", "town.innRanks[0].mpRatio: unknown field");
    expectIssue((r) => (r.config.town.innRanks[1].hpRatio = 1.5), "config.json", "town.innRanks[1].hpRatio: expected number in 0..1, got 1.5");
  });
  test("data: TW-04/TW-15 town.innRanks の sanOver / goodWeight / judgeBonus は 0 以上の整数、gossip は真偽値（馬小屋・相部屋 0/0/0/false、個室 10/1/1/true【仮】）", () => {
    expect(config.town.innRanks.map((r) => [r.id, r.sanOver, r.goodWeight, r.judgeBonus, r.gossip])).toEqual([
      ["stable", 0, 0, 0, false],
      ["cheap", 0, 0, 0, false],
      ["good", 10, 1, 1, true],
    ]);
    const p = "town.innRanks[2]";
    expectIssue((r) => (r.config.town.innRanks[2].sanOver = -1), "config.json", `${p}.sanOver: expected integer >= 0, got -1`);
    expectIssue((r) => (r.config.town.innRanks[2].sanOver = 2.5), "config.json", `${p}.sanOver: expected integer >= 0, got number`);
    expectIssue((r) => (r.config.town.innRanks[2].goodWeight = -1), "config.json", `${p}.goodWeight: expected integer >= 0, got -1`);
    expectIssue((r) => (r.config.town.innRanks[2].judgeBonus = "1"), "config.json", `${p}.judgeBonus: expected integer >= 0, got string`);
    expectIssue((r) => (r.config.town.innRanks[2].gossip = 1), "config.json", `${p}.gossip: expected boolean, got integer`);
    expectIssue((r) => delete r.config.town.innRanks[2].gossip, "config.json", `${p}.gossip: missing required field`);
    expectIssue((r) => delete r.config.town.innRanks[0].sanOver, "config.json", "town.innRanks[0].sanOver: missing required field");
    expectIssue((r) => (r.config.town.innRanks[2].morale = true), "config.json", `${p}.morale: unknown field`);
    expect(issuesOf((r) => (r.config.town.innRanks[0].judgeBonus = 3))).toEqual([]);
  });
  test("data: DG-05 dungeon.roomAttempts は 1 以上の整数", () => {
    expectIssue((r) => (r.config.dungeon.roomAttempts = 0), "config.json", "dungeon.roomAttempts: expected integer >= 1, got 0");
    expectIssue((r) => delete r.config.dungeon.roomAttempts, "config.json", "dungeon.roomAttempts: missing required field");
  });
  test("data: DG-12 dungeon.viewDepth は 1..3", () => {
    expectIssue((r) => (r.config.dungeon.viewDepth = 0), "config.json", "dungeon.viewDepth: expected integer in 1..3, got 0");
    expectIssue((r) => (r.config.dungeon.viewDepth = 4), "config.json", "dungeon.viewDepth: expected integer in 1..3, got 4");
    expect(issuesOf((r) => (r.config.dungeon.viewDepth = 1))).toEqual([]);
    expect(issuesOf((r) => (r.config.dungeon.viewDepth = 3))).toEqual([]);
  });
  test("data: DG-20 dungeon.trap.pitDice はダイス記法（既定 1d4【仮】）。旧 pitDamage は未知のキー", () => {
    expect(config.dungeon.trap.pitDice).toBe("1d4");
    expectIssue((r) => (r.config.dungeon.trap.pitDice = "d6"), "config.json", 'dungeon.trap.pitDice: invalid dice expression "d6"');
    expectIssue((r) => delete r.config.dungeon.trap.pitDice, "config.json", "dungeon.trap.pitDice: missing required field");
    expectIssue((r) => delete r.config.dungeon.trap, "config.json", "dungeon.trap: missing required field");
    expectIssue((r) => (r.config.dungeon.pitDamage = "1d6"), "config.json", "dungeon.pitDamage: unknown field");
    expect(issuesOf((r) => (r.config.dungeon.trap.pitDice = "2d4+1"))).toEqual([]);
    expect(isDiceExpr(config.dungeon.trap.pitDice)).toBe(true);
  });
  test("data: ui §2 ui.layout の合計が stage.height と違えば検証エラー", () => {
    const l = config.ui.layout;
    expect(l.header + l.view + l.message + l.party + l.controls).toBe(config.stage.height);
    expectIssue((r) => (r.config.ui.layout.view = 151), "config.json", "ui.layout: ui §2: sum of heights 401 must equal stage.height 400");
    expectIssue((r) => (r.config.ui.layout.header = 0), "config.json", "ui.layout.header: expected integer >= 1, got 0");
    expectIssue((r) => delete r.config.ui.layout.party, "config.json", "ui.layout.party: missing required field");
  });
  test("data: ui §2 ui.layout の区切りは【仮】。合計が stage.height で view 150・party が party.size×10 以上なら、表と違う値でも通る", () => {
    expect(issuesOf((r) => ((r.config.ui.layout.message = 80), (r.config.ui.layout.controls = 90)))).toEqual([]);
    expect(issuesOf((r) => ((r.config.ui.layout.party = 70), (r.config.ui.layout.message = 64)))).toEqual([]);
    // party はちょうど party.size × 10 でもよい
    expect(issuesOf((r) => ((r.config.ui.layout.party = 60), (r.config.ui.layout.controls = 104)))).toEqual([]);
  });
  test("data: UI-20 ui.layout.view は 150 でなければ検証エラー（合計が合っていても）", () => {
    expect(issuesOf((r) => ((r.config.ui.layout.view = 140), (r.config.ui.layout.message = 80)))).toEqual([
      "config.json: ui.layout.view: UI-20: view 140 must be 150 (svg viewBox 0 0 240 150)",
    ]);
  });
  test("data: ui §2 ui.layout.party が party.size×10 未満なら検証エラー（合計が合っていても）", () => {
    expect(issuesOf((r) => ((r.config.ui.layout.party = 59), (r.config.ui.layout.controls = 105)))).toEqual([
      "config.json: ui.layout.party: ui §2: party 59 must be >= party.size 6 x 10",
    ]);
    // 合計が違えば、それも出る
    expect(issuesOf((r) => ((r.config.ui.layout.message = 80), (r.config.ui.layout.controls = 100)))).toEqual([
      "config.json: ui.layout: ui §2: sum of heights 410 must equal stage.height 400",
    ]);
  });
  test("data: SV-23 ui.saveBannerHeight は 1 以上の整数", () => {
    expectIssue((r) => (r.config.ui.saveBannerHeight = 0), "config.json", "ui.saveBannerHeight: expected integer >= 1, got 0");
    expectIssue((r) => delete r.config.ui.saveBannerHeight, "config.json", "ui.saveBannerHeight: missing required field");
  });

  test("data: UI-25 ui.mapSnapPx は 1 以上の整数（必須。既定 12）", () => {
    expect(config.ui.mapSnapPx).toBe(12);
    expectIssue((r) => (r.config.ui.mapSnapPx = 0), "config.json", "ui.mapSnapPx: expected integer >= 1, got 0");
    expectIssue((r) => delete r.config.ui.mapSnapPx, "config.json", "ui.mapSnapPx: missing required field");
  });

  test("data: UI-43 ui.messageHistory は 1 以上の整数", () => {
    expectIssue((r) => (r.config.ui.messageHistory = 0), "config.json", "ui.messageHistory: expected integer >= 1, got 0");
    expectIssue((r) => delete r.config.ui.messageHistory, "config.json", "ui.messageHistory: missing required field");
  });
  test("data: UI-45 ui.autoBeatMs は 1 以上の整数（必須）", () => {
    expect(config.ui.autoBeatMs).toBe(400);
    expectIssue((r) => (r.config.ui.autoBeatMs = 0), "config.json", "ui.autoBeatMs: expected integer >= 1, got 0");
    expectIssue((r) => (r.config.ui.autoBeatMs = 2.5), "config.json", "ui.autoBeatMs: expected integer");
    expectIssue((r) => delete r.config.ui.autoBeatMs, "config.json", "ui.autoBeatMs: missing required field");
  });
  test("data: CH-51 san.trap は 0 以上の整数（必須）", () => {
    expectIssue((r) => (r.config.san.trap = -1), "config.json", "san.trap: expected integer >= 0, got -1");
    expectIssue((r) => (r.config.san.trap = 1.5), "config.json", "san.trap: expected integer");
    expectIssue((r) => (r.config.san.trap = "3"), "config.json", "san.trap: expected integer >= 0, got string");
    expectIssue((r) => delete r.config.san.trap, "config.json", "san.trap: missing required field");
    expect(issuesOf((r) => (r.config.san.trap = 0))).toEqual([]);
  });
  test("data: CH-53 confusedRatio < uneasyRatio", () => {
    expectIssue((r) => (r.config.san.confusedRatio = 0.6), "config.json", "CH-53");
  });
  test("data: CH-01 パーティは 6 人", () => {
    expectIssue((r) => r.config.prototypeParty.members.pop(), "config.json", "CH-01");
  });
  test("data: CH-02 リーダーは先頭の 1 人だけ", () => {
    expectIssue((r) => (r.config.prototypeParty.members[1].isLeader = true), "config.json", "CH-02");
    expectIssue((r) => (r.config.prototypeParty.members[0].isLeader = false), "config.json", "CH-02");
  });
  test("data: prototypeParty のぶら下がり参照", () => {
    const issues = issuesOf((r) => {
      r.config.prototypeParty.members[0].raceId = "orc";
      r.config.prototypeParty.members[1].inventory = ["herbb"];
    });
    expect(issues).toContain('config.json: prototypeParty.members[0].raceId: unknown race id "orc"');
    expect(issues).toContain('config.json: prototypeParty.members[1].inventory[0]: unknown item id "herbb"');
  });
  test("data: CH-70 CH-75 装備のスロットと職業", () => {
    expectIssue(
      (r) => (r.config.prototypeParty.members[0].equipment.helm = "leather_armor"),
      "config.json",
      "prototypeParty.members[0].equipment.helm: CH-70",
    );
    // エル（mage）は長剣を装備できない
    expectIssue(
      (r) => (r.config.prototypeParty.members[4].equipment.weapon = "long_sword"),
      "config.json",
      "prototypeParty.members[4].equipment.weapon: CH-75",
    );
  });
  test("data: CH-21 職業の能力値条件を満たす", () => {
    expectIssue((r) => (r.config.prototypeParty.members[0].stats.str = 10), "config.json", "CH-21");
  });
  test("data: CH-71 所持枠を超えない", () => {
    expectIssue((r) => (r.config.prototypeParty.members[0].inventory = Array(6).fill("herb")), "config.json", "CH-71");
  });
  test("data: MG-01 growth.mpStatPivot は整数、mpStatDivisor は 1 以上の整数", () => {
    expectIssue((r) => (r.config.growth.mpStatPivot = 10.5), "config.json", "growth.mpStatPivot: expected integer");
    expectIssue((r) => (r.config.growth.mpStatPivot = "10"), "config.json", "growth.mpStatPivot: expected integer");
    expectIssue((r) => delete r.config.growth.mpStatPivot, "config.json", "growth.mpStatPivot: missing required field");
    expectIssue((r) => (r.config.growth.mpStatDivisor = 0), "config.json", "growth.mpStatDivisor: expected integer >= 1, got 0");
    expectIssue((r) => (r.config.growth.mpStatDivisor = 1.5), "config.json", "growth.mpStatDivisor: expected integer");
    expectIssue((r) => delete r.config.growth.mpStatDivisor, "config.json", "growth.mpStatDivisor: missing required field");
  });
  test("data: CH-61 growth.statUpChance は 0..100 の整数、statCap は 1 以上の整数【仮】（既定 25 / 18）", () => {
    expect(config.growth.statUpChance).toBe(25);
    expect(config.growth.statCap).toBe(18);
    expectIssue((r) => (r.config.growth.statUpChance = 101), "config.json", "growth.statUpChance: expected integer in 0..100, got 101");
    expectIssue((r) => (r.config.growth.statUpChance = 2.5), "config.json", "growth.statUpChance: expected integer");
    expectIssue((r) => delete r.config.growth.statUpChance, "config.json", "growth.statUpChance: missing required field");
    expectIssue((r) => (r.config.growth.statCap = 0), "config.json", "growth.statCap: expected integer >= 1, got 0");
    expectIssue((r) => delete r.config.growth.statCap, "config.json", "growth.statCap: missing required field");
  });
  test("data: CH-05 creation.nameMaxLength は 1 以上の整数", () => {
    expectIssue((r) => (r.config.creation.nameMaxLength = 0), "config.json", "creation.nameMaxLength: expected integer >= 1, got 0");
    expectIssue((r) => (r.config.creation.nameMaxLength = "6"), "config.json", "creation.nameMaxLength: expected integer >= 1, got string");
    expectIssue((r) => delete r.config.creation.nameMaxLength, "config.json", "creation.nameMaxLength: missing required field");
  });
  test("data: MG-11 使えない系統の呪文を初期呪文に持たない", () => {
    expectIssue((r) => r.config.prototypeParty.members[4].knownSpells.push("heal"), "config.json", "MG-11");
  });
  test("data: UI-57 / SV-24 ui.musicVolume・ui.sfxVolume は 0..10 の整数（必須。既定 曲 3・効果音 2【仮】）", () => {
    expect([config.ui.musicVolume, config.ui.sfxVolume]).toEqual([3, 2]);
    for (const k of ["musicVolume", "sfxVolume"]) {
      expectIssue((r) => (r.config.ui[k] = 11), "config.json", `ui.${k}: expected integer in 0..10, got 11`);
      expectIssue((r) => (r.config.ui[k] = -1), "config.json", `ui.${k}: expected integer in 0..10, got -1`);
      expectIssue((r) => (r.config.ui[k] = 2.5), "config.json", `ui.${k}: expected integer in 0..10`);
      expectIssue((r) => delete r.config.ui[k], "config.json", `ui.${k}: missing required field`);
      expect(issuesOf((r) => (r.config.ui[k] = 0))).toEqual([]);
      expect(issuesOf((r) => (r.config.ui[k] = 10))).toEqual([]);
    }
  });
  test("data: UI-63 / UI-65 audio.musicGain・audio.sfxGain は 0..1 の数（必須。既定 0.3【仮】）", () => {
    // M9.5 で sampleRate・prefetchBars・keepSongs・startLeadMs を足したので 6 欄（musicGain・sfxGain の値と検証は変えていない）
    // sampleRate は 22050【仮】から 44100 に戻した（2026-10-06 ユーザーの判断。工房の render.py の WAV との一致を優先）
    // warmupSeconds 3【仮】を足した（2026-10-07 ユーザーの指示: 暖機を固定のダミー区間にする）ので 7 欄
    expect(config.audio).toEqual({ musicGain: 0.3, sfxGain: 0.3, sampleRate: 44100, prefetchBars: 2, keepSongs: 2, startLeadMs: 40, warmupSeconds: 3 });
    for (const k of ["musicGain", "sfxGain"]) {
      expectIssue((r) => (r.config.audio[k] = 1.5), "config.json", `audio.${k}: expected number in 0..1, got 1.5`);
      expectIssue((r) => (r.config.audio[k] = -0.1), "config.json", `audio.${k}: expected number in 0..1, got -0.1`);
      expectIssue((r) => delete r.config.audio[k], "config.json", `audio.${k}: missing required field`);
      expect(issuesOf((r) => (r.config.audio[k] = 0))).toEqual([]);
      expect(issuesOf((r) => (r.config.audio[k] = 1))).toEqual([]);
    }
    expectIssue((r) => (r.config.audio.masterGain = 1), "config.json", "audio.masterGain: unknown field");
  });
  test("data: UI-63 audio.sampleRate・prefetchBars・keepSongs・startLeadMs は範囲内の整数（必須。sampleRate 44100・startLeadMs 40【仮】、M9.5）", () => {
    const ranges: [string, number, number | null][] = [
      ["sampleRate", 8000, 96000],
      ["prefetchBars", 1, null],
      ["keepSongs", 1, null],
      ["startLeadMs", 0, 100],
    ];
    for (const [k, min, max] of ranges) {
      const text = max === null ? `>= ${min}` : `in ${min}..${max}`;
      expectIssue((r) => delete r.config.audio[k], "config.json", `audio.${k}: missing required field`);
      expectIssue((r) => (r.config.audio[k] = min - 1), "config.json", `audio.${k}: expected integer ${text}, got ${min - 1}`);
      if (max !== null) expectIssue((r) => (r.config.audio[k] = max + 1), "config.json", `audio.${k}: expected integer ${text}, got ${max + 1}`);
      expectIssue((r) => (r.config.audio[k] = min + 0.5), "config.json", `audio.${k}: expected integer ${text}`);
      expect(issuesOf((r) => (r.config.audio[k] = min))).toEqual([]);
      if (max !== null) expect(issuesOf((r) => (r.config.audio[k] = max))).toEqual([]);
    }
  });
  test("data: UI-63 audio.warmupSeconds は 0..10 の数（必須。3【仮】、小数可、M9.5）", () => {
    expectIssue((r) => delete r.config.audio.warmupSeconds, "config.json", "audio.warmupSeconds: missing required field");
    expectIssue((r) => (r.config.audio.warmupSeconds = -0.5), "config.json", "audio.warmupSeconds: expected number in 0..10, got -0.5");
    expectIssue((r) => (r.config.audio.warmupSeconds = 10.5), "config.json", "audio.warmupSeconds: expected number in 0..10, got 10.5");
    for (const v of [0, 1.5, 10]) expect(issuesOf((r) => (r.config.audio.warmupSeconds = v))).toEqual([]);
  });
});

describe("data: wavetables.json（UI-63。M8）", () => {
  const F = "wavetables.json";
  test("data: UI-63 wavetables.json は工房の形（CONV §1）で通る", () => {
    const d = loadGameData(rawData());
    expect([d.wavetables.samples, d.wavetables.depth]).toEqual([32, 4]);
    expect(Object.entries(d.wavetables.waves).map(([k, w]) => [k, w.program])).toEqual([
      ["pulse50", 0],
      ["pulse25", 1],
      ["pulse12", 2],
      ["triangle", 3],
      ["saw", 4],
      ["organ", 5],
    ]);
    expect(d.wavetables.noise).toEqual({
      kick: { note: 35, clock: 1200 },
      snare: { note: 38, clock: 6000 },
      hat: { note: 42, clock: 44100 },
      openhat: { note: 46, clock: 44100 },
    });
  });
  test("data: UI-63 samples は 32、depth は 4（CONV §1 の値に固定）", () => {
    expectIssue((r) => (r.wavetables.samples = 16), F, "samples: UI-63: samples must be 32");
    expectIssue((r) => (r.wavetables.depth = 8), F, "depth: UI-63: depth must be 4");
    expectIssue((r) => delete r.wavetables.samples, F, "samples: missing required field");
  });
  test("data: UI-63 波形の data は samples 個の 0..15 の整数", () => {
    expectIssue((r) => r.wavetables.waves.saw.data.pop(), F, "waves.saw.data: UI-63: expected 32 samples, got 31");
    expectIssue((r) => (r.wavetables.waves.saw.data[3] = 16), F, "waves.saw.data[3]: expected integer in 0..15, got 16");
    expectIssue((r) => (r.wavetables.waves.saw.data[3] = -1), F, "waves.saw.data[3]: expected integer in 0..15, got -1");
    expectIssue((r) => (r.wavetables.waves.saw.data[3] = 1.5), F, "waves.saw.data[3]: expected integer in 0..15");
  });
  test("data: UI-63 program は 0..127 の整数で波形間で重複しない", () => {
    expectIssue((r) => (r.wavetables.waves.saw.program = 0), F, "waves.saw.program: UI-63: duplicate program 0 (pulse50)");
    expectIssue((r) => (r.wavetables.waves.saw.program = 128), F, "waves.saw.program: expected integer in 0..127, got 128");
  });
  test("data: UI-63 noise の note は 0..127 の整数で重複しない、clock は 0 より大きい", () => {
    expectIssue((r) => (r.wavetables.noise.hat.note = 35), F, "noise.hat.note: UI-63: duplicate note 35 (kick)");
    expectIssue((r) => (r.wavetables.noise.hat.note = 200), F, "noise.hat.note: expected integer in 0..127, got 200");
    expectIssue((r) => (r.wavetables.noise.kick.clock = 0), F, "noise.kick.clock: expected number > 0, got 0");
  });
  test("data: UI-63 名前は [a-z0-9_] で noise は波形名にできない（CONV §1 の予約語）", () => {
    expectIssue((r) => (r.wavetables.waves.noise = { program: 9, data: Array(32).fill(0) }), F, 'waves.noise: UI-63: "noise" is reserved');
    expectIssue((r) => (r.wavetables.waves["Saw-2"] = { program: 9, data: Array(32).fill(0) }), F, 'waves.Saw-2: UI-63: name must match');
    expectIssue((r) => (r.wavetables.noise["Big"] = { note: 50, clock: 100 }), F, "noise.Big: UI-63: name must match");
  });
  test("data: UI-63 waves と noise は 1 個以上、未知の欄は止める", () => {
    expectIssue((r) => (r.wavetables.waves = {}), F, "waves: UI-63: expected at least 1 entry");
    expectIssue((r) => (r.wavetables.noise = {}), F, "noise: UI-63: expected at least 1 entry");
    expectIssue((r) => (r.wavetables.waves.saw.volume = 1), F, "waves.saw.volume: unknown field");
    expectIssue((r) => (r.wavetables.version = 2), F, "version: unknown field");
  });
});

describe("data: audio.json（UI-63 / UI-65 / UI-66。M8）", () => {
  const F = "audio.json";
  test("data: UI-63 / UI-65 / UI-66 実データが通る（工房の project.json の名前の写しと、ゲーム側が足した名前）", () => {
    const d = loadGameData(rawData());
    // 工房の project.json（2026-10-08、dungeon3 を追加）の 12 曲と同じ（ボスの曲 boss の提案はユーザーの判断 4（2026-10-06）で取り下げ。ボスは battle2）
    expect(d.audio.music.songs).toEqual(["title", "town", "dungeon1", "dungeon2", "dungeon3", "camp", "battle1", "battle2", "tavern", "shop", "temple", "dark"]);
    expect(d.audio.music.jingles).toEqual(["encounter", "victory", "wipe", "levelup", "inn", "clear", "rare"]);
    expect(d.audio.music.noteRange).toEqual([36, 96]);
    // 工房の 22 + learn・ailment・tent・page（工房への提案）
    expect(d.audio.sfx.names).toEqual([
      "ok", "cancel", "hit", "miss", "damage", "spell", "door", "stairs", "trap", "wall", "heal",
      "chest", "gold", "dice", "death", "flee", "san", "identify", "upgrade_ok", "upgrade_fail", "teleport", "stop",
      "learn", "ailment", "tent", "page",
    ]);
    expect(d.audio.screenSongs).toEqual({ title: "title", town: "town", dungeon: "dungeon1" });
    // ユーザーの判断 4（2026-10-06）: 通常の戦闘は battle1 だけ、ボス戦は battle2（工房の確定版の意味どおり）
    expect(d.audio.battleSongs).toEqual(["battle1"]);
    expect(d.audio.bossSong).toBe("battle2");
    expect(d.audio.facilitySongs).toEqual({ tavern: "tavern", shop: "shop", temple: "temple", dark: "dark" });
    expect(d.audio.campSong).toBe("camp");
    expect(d.audio.ui).toEqual({ ok: "ok", cancel: "cancel", facility: "door", camp: "tent", talk: "page" });
    expect(d.dungeons.map((x) => [x.id, x.song])).toEqual([
      ["d01", "dungeon1"],
      ["d02", "dungeon2"],
      ["d03", "dungeon3"], // M12（U-3）: 当面の dungeon2 → 2026-10-08 に工房から dungeon3 が届いた
    ]);
  });
  test("data: UI-63 screenSongs のキーの一覧 AUDIO_SCREENS は core/types の Screen と同じ値", () => {
    const all: Record<Screen, true> = { title: true, town: true, dungeon: true, battle: true, event: true };
    const screens: readonly Screen[] = AUDIO_SCREENS;
    expect([...screens].sort()).toEqual(Object.keys(all).sort());
  });
  test("data: UI-63 songs と jingles は名前の配列で全体で重複しない", () => {
    expectIssue((r) => r.audio.music.jingles.push("town"), F, 'music.jingles[7]: UI-63: duplicate name "town"');
    // 添字は実データの songs が 12 曲（判断 4 で boss を消して 11 曲、2026-10-08 に dungeon3 を足して 12 曲）なので [12]
    expectIssue((r) => r.audio.music.songs.push("title"), F, 'music.songs[12]: UI-63: duplicate name "title"');
    expectIssue((r) => r.audio.music.songs.push("Boss 2"), F, "music.songs[12]: UI-63: name must match");
    expectIssue((r) => r.audio.sfx.names.push("ok"), F, 'sfx.names[26]: UI-65: duplicate name "ok"');
  });
  test("data: UI-63 noteRange は 0 <= lo <= hi <= 127 の整数", () => {
    expectIssue((r) => (r.audio.music.noteRange = [96, 36]), F, "music.noteRange: min 96 > max 36");
    expectIssue((r) => (r.audio.music.noteRange = [0, 128]), F, "music.noteRange[1]: expected integer in 0..127, got 128");
  });
  test("data: UI-63 screenSongs のキーは画面、値は songs のどれか。bossSong も songs", () => {
    expectIssue((r) => (r.audio.screenSongs.town = "victory"), F, 'screenSongs.town: unknown song "victory"');
    expectIssue((r) => (r.audio.screenSongs.shop = "town"), F, "screenSongs.shop: unknown field");
    expectIssue((r) => (r.audio.bossSong = "inn"), F, 'bossSong: unknown song "inn"');
    // ユーザーの判断 4（2026-10-06）で曲 boss は songs から消えた
    expectIssue((r) => (r.audio.bossSong = "boss"), F, 'bossSong: unknown song "boss"');
  });
  test("data: UI-63（2026-10-06）battleSongs は songs の 1 つ以上、screenSongs.battle は置けない、facilitySongs のキーは施設で値は songs、campSong も songs", () => {
    expectIssue((r) => (r.audio.battleSongs = []), F, "battleSongs: expected at least 1");
    // 添字は実データの battleSongs が 1 件（判断 4）になったので [1]
    expectIssue((r) => r.audio.battleSongs.push("victory"), F, 'battleSongs[1]: unknown song "victory"');
    expectIssue((r) => delete r.audio.battleSongs, F, "battleSongs: missing required field");
    expectIssue((r) => (r.audio.screenSongs.battle = "battle1"), F, "screenSongs.battle: UI-63: use battleSongs / bossSong for battle");
    expectIssue((r) => (r.audio.facilitySongs.inn = "victory"), F, 'facilitySongs.inn: unknown song "victory"');
    expectIssue((r) => (r.audio.facilitySongs.town = "town"), F, "facilitySongs.town: unknown field");
    expectIssue((r) => delete r.audio.facilitySongs, F, "facilitySongs: missing required field");
    expectIssue((r) => (r.audio.campSong = "rare"), F, 'campSong: unknown song "rare"');
    expectIssue((r) => delete r.audio.campSong, F, "campSong: missing required field");
    // 省略できる施設（inn・gate）と空の facilitySongs は通る
    expect(issuesOf((r) => (r.audio.facilitySongs = {}))).toEqual([]);
  });
  test("data: UI-63（2026-10-06）dungeons[].song は任意で、audio.json の music.songs のどれか", () => {
    expectIssue((r) => (r.dungeons[0].song = "dungeon9"), "dungeons.json", '[0].song: UI-63: unknown song "dungeon9"');
    expectIssue((r) => (r.dungeons[0].song = "victory"), "dungeons.json", '[0].song: UI-63: unknown song "victory"');
    expect(issuesOf((r) => delete r.dungeons[1].song)).toEqual([]);
  });
  test("data: UI-66 cue は sfx と jingle のちょうど一方（sfx は sfx.names、jingle は jingles）", () => {
    expectIssue((r) => (r.audio.cues[0].sfx = "hit"), F, "cues[0]: UI-66: exactly one of sfx / jingle");
    expectIssue((r) => delete r.audio.cues[6].sfx, F, "cues[6]: UI-66: exactly one of sfx / jingle");
    expectIssue((r) => (r.audio.cues[6].sfx = "boom"), F, 'cues[6].sfx: unknown sfx "boom"');
    expectIssue((r) => (r.audio.cues[0].jingle = "town"), F, 'cues[0].jingle: unknown jingle "town"');
  });
  test("data: UI-66 message の cue は key が必須で strings.json のキー", () => {
    expectIssue((r) => delete r.audio.cues[3].key, F, "cues[3].key: UI-66: required for event message");
    expectIssue((r) => (r.audio.cues[3].key = "town.inn.nope"), F, 'cues[3].key: unknown strings.json key "town.inn.nope"');
  });
  test("data: UI-66 result・boss・hit・target・loss・key・rarity・status・on・life は決まった event にだけ付けられる", () => {
    expectIssue((r) => (r.audio.cues[4].result = "win"), F, "cues[4].result: UI-66: only for event battleEnd");
    expectIssue((r) => (r.audio.cues[4].boss = true), F, "cues[4].boss: UI-66: only for event battleEnd");
    expectIssue((r) => (r.audio.cues[6].hit = true), F, "cues[6].hit: UI-66: only for event attack");
    expectIssue((r) => (r.audio.cues[6].target = "enemy"), F, "cues[6].target: UI-66: only for event attack / hpChanged / statusChanged / sanChanged / lifeChanged");
    expectIssue((r) => (r.audio.cues[4].loss = true), F, "cues[4].loss: UI-66: only for event hpChanged / sanChanged");
    expectIssue((r) => (r.audio.cues[6].key = "dungeon.door"), F, "cues[6].key: UI-66: only for event message / dice");
    expectIssue((r) => (r.audio.cues[6].rarity = "legendary"), F, "cues[6].rarity: UI-66: only for event message");
    expectIssue((r) => (r.audio.cues[6].status = "poison"), F, "cues[6].status: UI-66: only for event statusChanged");
    expectIssue((r) => (r.audio.cues[6].on = true), F, "cues[6].on: UI-66: only for event statusChanged");
    expectIssue((r) => (r.audio.cues[6].life = "dead"), F, "cues[6].life: UI-66: only for event lifeChanged");
    expectIssue((r) => (r.audio.cues[3].rarity = "mythic"), F, "cues[3].rarity: expected one of normal|fine|rare|legendary");
    expectIssue((r) => r.audio.cues.push({ event: "statusChanged", status: "cursed", sfx: "ailment" }), F, ".status: expected one of");
    expectIssue((r) => r.audio.cues.push({ event: "lifeChanged", life: "lost", sfx: "death" }), F, ".life: expected one of alive|dead|ash");
    // dice の key は任意（無ければすべての判定の箱）で、あれば strings.json のキー
    expect(issuesOf((r) => r.audio.cues.push({ event: "dice", sfx: "dice" }))).toEqual([]);
    expectIssue((r) => r.audio.cues.push({ event: "dice", key: "dice.nope", sfx: "dice" }), F, '.key: unknown strings.json key "dice.nope"');
    expectIssue((r) => (r.audio.cues[0].result = "draw"), F, "cues[0].result: expected one of win|flee|wipe");
    expectIssue((r) => (r.audio.cues[0].event = "moved"), F, "cues[0].event: expected one of");
  });
  test("data: UI-65 ui.ok・ui.cancel・ui.facility・ui.camp・ui.talk は sfx.names のどれか（必須）、未知の欄は止める", () => {
    expectIssue((r) => (r.audio.ui.ok = "beep"), F, 'ui.ok: unknown sfx "beep"');
    for (const k of ["facility", "camp", "talk"]) {
      expectIssue((r) => (r.audio.ui[k] = "beep"), F, `ui.${k}: unknown sfx "beep"`);
      expectIssue((r) => delete r.audio.ui[k], F, `ui.${k}: missing required field`);
    }
    expectIssue((r) => (r.audio.ui.back = "cancel"), F, "ui.back: unknown field");
    expectIssue((r) => (r.audio.loops = {}), F, "loops: unknown field");
    expectIssue((r) => (r.audio.cues[0].volume = 1), F, "cues[0].volume: unknown field");
  });
});

describe("data: races.json / classes.json", () => {
  test("data: CH-10 能力値は 18 以下", () => {
    expectIssue((r) => (r.races[0].baseStats.str = 19), "races.json", "[0].baseStats.str: expected integer in 1..18, got 19");
  });
  test("data: 重複 id", () => {
    expectIssue((r) => (r.races[1].id = "human"), "races.json", '[1].id: duplicate id "human"');
  });
  test("data: classes の列挙と未知の系統キー", () => {
    const issues = expectIssue((r) => (r.classes[0].tier = "elite"), "classes.json", "[0].tier: expected one of basic|advanced");
    expect(issues).toHaveLength(1);
    expectIssue((r) => (r.classes[2].spells.druid = 1), "classes.json", "[2].spells.druid: unknown field");
  });
  test("data: classes[].abbr（ui §2 のパーティ欄）は必須・1〜3 文字の ASCII 英大文字", () => {
    const data = loadGameData(rawData());
    expect(data.classes.map((c) => [c.id, c.abbr])).toEqual([
      ["fighter", "WAR"],
      ["thief", "THI"],
      ["priest", "PRI"],
      ["mage", "MAG"],
      ["samurai", "SAM"],
      ["lord", "LOR"],
      ["bishop", "BIS"],
    ]);
    expectIssue((r) => delete r.classes[0].abbr, "classes.json", "[0].abbr: missing required field");
    expectIssue((r) => (r.classes[0].abbr = 3), "classes.json", "[0].abbr: expected string");
    expectIssue((r) => (r.classes[0].abbr = ""), "classes.json", "[0].abbr: expected non-empty string");
    for (const bad of ["war", "WARR", "ＷＡＲ", "W1", "W R"]) {
      const issues = expectIssue((r) => (r.classes[1].abbr = bad), "classes.json", "[1].abbr: expected 1-3 uppercase ASCII letters");
      expect(issues).toHaveLength(1);
    }
    for (const ok of ["W", "WA", "WAR"]) expect(issuesOf((r) => (r.classes[1].abbr = ok))).toEqual([]);
  });
  test("data: CH-24 classes[].start（開始の装備・所持品・呪文・所持金）の検証。所持金は全職業 1 人 50G（ユーザー決定 2026-10-04）", () => {
    const data = loadGameData(rawData());
    expect(data.classes.map((c) => c.start.gold)).toEqual([50, 50, 50, 50, 50, 50, 50]);
    expectIssue((r) => delete r.classes[0].start, "classes.json", "[0].start: missing required field");
    expectIssue((r) => (r.classes[0].start.gold = -1), "classes.json", "[0].start.gold: expected integer >= 0");
    expectIssue((r) => (r.classes[0].start.gold = 1.5), "classes.json", "[0].start.gold: expected integer");
    expectIssue((r) => (r.classes[0].start.equipment.ring = "charm"), "classes.json", "[0].start.equipment.ring: unknown field");
    // 装備枠と slot の不一致
    expectIssue((r) => (r.classes[0].start.equipment.helm = "leather_armor"), "classes.json", "[0].start.equipment.helm: CH-70");
    // 職業が装備できない品（魔術師に長剣）
    expectIssue((r) => (r.classes[3].start.equipment.weapon = "long_sword"), "classes.json", "[3].start.equipment.weapon: CH-75");
    expectIssue((r) => (r.classes[0].start.equipment.weapon = "sword_x"), "classes.json", '[0].start.equipment.weapon: unknown equipment base id "sword_x"'); // IT-04（M7）: 開始の装備は汎用ベース表の id
    expectIssue((r) => (r.classes[0].start.inventory = ["herbb"]), "classes.json", '[0].start.inventory[0]: unknown item id "herbb"');
    // 所持枠（装備 3 + 6 = 9 > 8）
    expectIssue((r) => (r.classes[0].start.inventory = Array(6).fill("herb")), "classes.json", "[0].start: CH-71");
    // 系統の無い呪文（戦士に治癒）、開始レベル 4 の系統（侍に火矢）
    expectIssue((r) => r.classes[0].start.knownSpells.push("heal"), "classes.json", "[0].start.knownSpells[0]: MG-11");
    expectIssue((r) => r.classes[4].start.knownSpells.push("fire_arrow"), "classes.json", "[4].start.knownSpells[0]: MG-11");
    // 重複・魔法書専用・learnLevel 2 以上
    expectIssue((r) => r.classes[2].start.knownSpells.push("heal"), "classes.json", '[2].start.knownSpells[1]: CH-24: duplicate spell "heal"');
    expectIssue((r) => r.classes[3].start.knownSpells.push("lightning_tome"), "classes.json", '[3].start.knownSpells[2]: CH-24: spell "lightning_tome" is bookOnly');
    expectIssue((r) => r.classes[3].start.knownSpells.push("flame_burst"), "classes.json", '[3].start.knownSpells[2]: CH-24: spell "flame_burst" has learnLevel 3, not 1');
    expectIssue((r) => r.classes[3].start.knownSpells.push("nope"), "classes.json", '[3].start.knownSpells[2]: unknown spell id "nope"');
  });
});

describe("data: spells.json", () => {
  test("data: MG-10 呪文レベルは 1..7", () => {
    expectIssue((r) => (r.spells[0].level = 8), "spells.json", "[0].level: expected integer in 1..7, got 8");
  });
  test("data: 効果の判別共用体", () => {
    expectIssue((r) => (r.spells[0].effect = { type: "explode" }), "spells.json", "[0].effect.type: expected one of");
    expectIssue((r) => delete r.spells[1].effect.chance, "spells.json", "[1].effect.chance: missing required field");
    expectIssue((r) => (r.spells[0].effect.status = "sleep"), "spells.json", "[0].effect.status: unknown field");
  });
  test("data: MG-12 習得レベルは 1 以上", () => {
    expectIssue((r) => (r.spells[0].learnLevel = 0), "spells.json", "[0].learnLevel: expected integer >= 1, got 0");
  });
  test("data: MG spells の tags は省略可（magic.md §6）", () => {
    expect(issuesOf((r) => delete r.spells[0].tags)).toEqual([]);
    expect(issuesOf((r) => r.spells.forEach((sp: { tags?: string[] }) => delete sp.tags))).toEqual([]);
    expectIssue((r) => (r.spells[0].tags = [""]), "spells.json", "[0].tags[0]: expected non-empty string");
  });
  test("data: 不正なダイス文字列", () => {
    expectIssue((r) => (r.spells[0].effect.dice = "d8"), "spells.json", '[0].effect.dice: invalid dice expression "d8"');
  });
  test("data: UI-68（M10）呪文の説明 description は必須で空でない（実データも全件）", () => {
    for (const sp of loadGameData(rawData()).spells) expect(sp.description.length, sp.id).toBeGreaterThan(0);
    expectIssue((r) => (r.spells[0].description = ""), "spells.json", "[0].description: expected non-empty string");
    expectIssue((r) => delete r.spells[0].description, "spells.json", "[0].description: missing required field");
  });
});

describe("data: monsters.json", () => {
  test("data: 型違いのメッセージにファイル名とパスが入る", () => {
    const issues = issuesOf((r) => (r.monsters[3].hp = 12));
    expect(issues).toEqual(["monsters.json: [3].hp: expected string, got integer"]);
  });
  test("data: 不正なダイス文字列", () => {
    expectIssue((r) => (r.monsters[0].gold = "1d4+"), "monsters.json", "[0].gold: invalid dice expression");
    for (const bad of ["0d6", "-1", "+5", "05", "10000", " 1", "1 ", "2x6"]) {
      expectIssue((r) => (r.monsters[0].gold = bad), "monsters.json", `[0].gold: invalid dice expression ${JSON.stringify(bad)}`);
    }
  });
  test("data: CB-03 グループの体数は maxPerGroup 以下", () => {
    expectIssue((r) => (r.monsters[0].groupSize = "3d4"), "monsters.json", "[0].groupSize: CB-03");
    expectIssue((r) => (r.monsters[0].groupSize = "0"), "monsters.json", "[0].groupSize: CB-03");
    expectIssue((r) => (r.monsters[0].groupSize = "1d4-1"), "monsters.json", "[0].groupSize: CB-03");
    expect(issuesOf((r) => (r.monsters[0].groupSize = "1"))).toEqual([]);
  });
  test("data: CB-24 status と chance は組", () => {
    expectIssue((r) => delete r.monsters[2].attacks[0].chance, "monsters.json", "[2].attacks[0]: CB-24");
  });
  test("data: CB-31 SAN 攻撃の sanDrain は 1 以上", () => {
    expectIssue((r) => (r.monsters[4].attacks[0].sanDrain = 0), "monsters.json", "[4].attacks[0].sanDrain: expected integer >= 1, got 0");
  });
  test("data: CB-03 出現場所は encounterTable のみが正で、monsters は floors を持たない", () => {
    expectIssue((r) => (r.monsters[0].floors = [1, 2]), "monsters.json", "[0].floors: unknown field");
  });
  test("data: attacks は 1 つ以上", () => {
    expectIssue((r) => (r.monsters[0].attacks = []), "monsters.json", "[0].attacks: expected at least 1");
  });
  test("data: CB-05 unknownKind は必須で unknown-kinds.json に定義済みの id。廃止した unidentifiedName が残っていれば未知の欄", () => {
    expectIssue((r) => (r.monsters[0].unknownKind = "dragon"), "monsters.json", '[0].unknownKind: unknown unknownKind id "dragon"');
    expectIssue((r) => delete r.monsters[1].unknownKind, "monsters.json", "[1].unknownKind: missing required field");
    expectIssue((r) => (r.monsters[2].unidentifiedName = "多脚の影"), "monsters.json", "[2].unidentifiedName: unknown field");
    // 系統の定義を消すと、その系統を使う敵が止まる（spirit は囁く影と歌う亡霊。M9）
    const issues = expectIssue((r) => (r.unknownKinds = r.unknownKinds.filter((k: { id: string }) => k.id !== "spirit")), "monsters.json", '[4].unknownKind: unknown unknownKind id "spirit"');
    expect(issues).toEqual([
      'monsters.json: [4].unknownKind: unknown unknownKind id "spirit"',
      'monsters.json: [10].unknownKind: unknown unknownKind id "spirit"',
    ]);
  });
});

describe("data: unknown-kinds.json（CB-05 / UI-60。M7）", () => {
  const F = "unknown-kinds.json";
  test("data: CB-05/UI-60 実データは 7 系統（beast / humanoid / spirit / construct / winged / ooze / undead）、sprite は unknown_<id>、色は系統ごとに別", () => {
    const d = loadGameData(rawData());
    expect(d.unknownKinds.map((k) => [k.id, k.name, k.sprite])).toEqual([
      ["beast", "何かの獣", "unknown_beast"],
      ["humanoid", "人の形をした影", "unknown_humanoid"],
      ["spirit", "声だけの何か", "unknown_spirit"],
      ["construct", "動く何か", "unknown_construct"],
      ["winged", "羽ばたく何か", "unknown_winged"],
      ["ooze", "ぬめる何か", "unknown_ooze"],
      ["undead", "何かの亡者", "unknown_undead"], // M12
    ]);
    expect(new Set(d.unknownKinds.map((k) => k.placeholderColor)).size).toBe(d.unknownKinds.length);
    // UI-54: 名前は全角 8 字以内（ラベルの 2 行に収まる。battle-view.test.ts で幅を確かめる）
    for (const k of d.unknownKinds) expect([...k.name].length, k.id).toBeLessThanOrEqual(8);
  });
  test("data: CB-05/UI-60 unknown-kinds.json の検証: 空の name、sprite が unknown_<id> でない、パレットに無い色・黒、id の重複、空の配列、未知の欄は起動を止める", () => {
    expectIssue((r) => (r.unknownKinds[0].name = ""), F, "[0].name: expected non-empty string");
    expectIssue((r) => (r.unknownKinds[1].sprite = "kobold_silhouette"), F, '[1].sprite: UI-60: sprite must be "unknown_humanoid"');
    expectIssue((r) => (r.unknownKinds[2].placeholderColor = "#123456"), F, "[2].placeholderColor: expected one of");
    expectIssue((r) => (r.unknownKinds[2].placeholderColor = "black"), F, "[2].placeholderColor: expected one of");
    expectIssue((r) => (r.unknownKinds[3].id = "beast"), F, "duplicate");
    expectIssue((r) => (r.unknownKinds = []), F, "expected at least 1");
    expectIssue((r) => (r.unknownKinds[0].foo = 1), F, "[0].foo: unknown field");
  });
  test("data: CB-05 unknown-kinds の name は 8 字以内、winged / ooze の色は violet / teal（M9）", () => {
    expectIssue((r) => (r.unknownKinds[0].name = "なにかとてもおおきい獣"), F, "[0].name: CB-05: name must be at most 8 characters");
    expect(issuesOf((r) => (r.unknownKinds[0].name = "八文字ちょうど獣")).filter((s) => s.startsWith(F))).toEqual([]);
    const d = loadGameData(rawData());
    expect(d.unknownKinds.filter((k) => k.id === "winged" || k.id === "ooze").map((k) => [k.id, k.placeholderColor])).toEqual([
      ["winged", "violet"],
      ["ooze", "teal"],
    ]);
  });
  test("data: CB-05/UI-60 系統 undead「何かの亡者」（M12）は薄い黄土 bone（#FCE0A8。U-4）で、spirit の緑・construct の白と違う。所属は d03 の死者 5 種だけ（既存の死者の系統は移さない）", () => {
    const d = loadGameData(rawData());
    const color = (id: string): string => d.unknownKinds.find((k) => k.id === id)!.placeholderColor;
    expect([color("undead"), color("spirit"), color("construct")]).toEqual(["bone", "darkGreen", "white"]); // 色の値は palette.test.ts
    expect(d.monsters.filter((m) => m.unknownKind === "undead").map((m) => m.id)).toEqual([
      "ash_shambler", "candle_mourner", "urn_bearer", "grave_sentinel", "ashcrown_lord",
    ]);
    // 既存の死者（M6〜M9）の系統はそのまま
    expect(["rotting_corpse", "drowned_acolyte", "sunken_bishop", "whispering_shadow", "choir_wraith"].map((id) => d.monsters.find((m) => m.id === id)!.unknownKind)).toEqual([
      "humanoid", "humanoid", "humanoid", "spirit", "spirit",
    ]);
  });
});

describe("data: items.json", () => {
  test("data: MG-25 魔法書は bookOnly の呪文を教える", () => {
    expectIssue(
      (r) => (r.items.find((i: { id: string }) => i.id === "tome_lightning").effect.spell = "fire_arrow"),
      "items.json",
      "MG-25",
    );
  });
  test("data: IT-01（M7）items.json は消耗品と魔法書だけ。装備の type・装備の欄・cursed は止める。cursed_dagger は無い（Q10）", () => {
    const d = loadGameData(rawData());
    expect(d.items.map((i) => i.id)).toEqual(["herb", "antidote_herb", "return_thread", "tome_lightning", "tome_ash_gale", "tome_sanctuary_hymn"]);
    expect(d.items.some((i) => i.id === "cursed_dagger")).toBe(false);
    expect(d.equipmentBases.some((b) => b.id === "cursed_dagger")).toBe(false);
    expectIssue((r) => (r.items[0].type = "weapon"), "items.json", "[0].type: expected one of consumable|book");
    expectIssue((r) => (r.items[0].cursed = false), "items.json", "[0].cursed: unknown field");
    expectIssue((r) => (r.items[0].slot = "weapon"), "items.json", "[0].slot: unknown field");
    expectIssue((r) => delete r.items[0].effect, "items.json", "[0].effect: missing required field");
  });
  test("data: IT-62/TW-05（M7 の B7）在庫制の items[].stock は廃止したので未知の欄として止める", () => {
    expect(loadGameData(rawData()).items.some((i) => "stock" in i)).toBe(false);
    expectIssue((r) => (r.items[0].stock = 0), "items.json", "[0].stock: unknown field");
  });
});

describe("data: equipment-bases.json（IT-02。M7）", () => {
  test("data: IT-02 実データの汎用ベース 30 種（武器 15・防具 6・盾 2・兜 4・小手 2・装飾 1。M9 で 12 種、M12 で 4 種を足した）", () => {
    const d = loadGameData(rawData());
    expect(d.equipmentBases).toHaveLength(30);
    const count = (slot: string): number => d.equipmentBases.filter((b) => b.slot === slot).length;
    expect(["weapon", "armor", "shield", "helm", "gauntlet", "accessory"].map(count)).toEqual([15, 6, 2, 4, 2, 1]);
  });
  test("data: IT-62/IT-02/IT-25/IT-22 M12 のベース 4 種は shopMinLevel 6（d03 の踏破の流通レベル 6 で並ぶ。U-1）。重剣・角弓（ranged）・古樹の杖（caster、magicPower 3）・黒鉄の鎧（ac −7）", () => {
    const d = loadGameData(rawData());
    const M12 = ["heavy_blade", "horn_bow", "elder_staff", "blackiron_plate"];
    const got = M12.map((id) => {
      const b = d.equipmentBases.find((x) => x.id === id)!;
      return b.slot === "weapon" ? [id, b.damage, b.reach ?? "melee", b.caster, b.magicPower ?? 0, b.shopMinLevel] : [id, b.slot, b.ac, b.shopMinLevel];
    });
    expect(got).toEqual([
      ["heavy_blade", "1d10+1", "melee", false, 0, 6],
      ["horn_bow", "1d10", "ranged", false, 0, 6],
      ["elder_staff", "1d6", "melee", true, 3, 6],
      ["blackiron_plate", "armor", -7, 6],
    ]);
    // shopMinLevel 6 のベースはこの 4 種だけで、d03 の onClear.shopLevel（6）で初めて並ぶ（d02 の 4 では並ばない）
    expect(d.equipmentBases.filter((b) => b.shopMinLevel === 6).map((b) => b.id)).toEqual(M12);
    expect(Math.max(...d.equipmentBases.map((b) => b.shopMinLevel))).toBe(d.dungeons.find((x) => x.id === "d03")!.onClear.shopLevel);
  });
  test("data: IT-02/IT-25/CB-13/IT-22 M9 のベース 12 種: 長柄は reach long、投擲・弓は reach ranged、杖 2 種は caster で magicPower 1 / 2、shopMinLevel は 2 か 4（流通レベル）", () => {
    const d = loadGameData(rawData());
    const M9 = ["spear", "halberd", "throwing_knives", "long_bow", "oak_staff", "sigil_staff", "studded_leather", "warded_robe", "plate_armor", "iron_shield", "great_helm", "chain_coif"];
    const got = M9.map((id) => {
      const b = d.equipmentBases.find((x) => x.id === id)!;
      return b.slot === "weapon" ? [id, b.reach ?? "melee", b.caster, b.magicPower ?? 0, b.shopMinLevel] : [id, b.slot, b.ac, b.shopMinLevel];
    });
    expect(got).toEqual([
      ["spear", "long", false, 0, 2],
      ["halberd", "long", false, 0, 4],
      ["throwing_knives", "ranged", false, 0, 2],
      ["long_bow", "ranged", false, 0, 4],
      ["oak_staff", "melee", true, 1, 2],
      ["sigil_staff", "melee", true, 2, 4],
      ["studded_leather", "armor", -3, 2],
      ["warded_robe", "armor", -3, 2],
      ["plate_armor", "armor", -6, 4],
      ["iron_shield", "shield", -2, 2],
      ["great_helm", "helm", -3, 4],
      ["chain_coif", "helm", -2, 2],
    ]);
    // 後衛の術者（魔術師・司教）が持てる ranged の武器がある（投げナイフ）
    const knives = d.equipmentBases.find((x) => x.id === "throwing_knives")!;
    expect(knives.classes).toEqual(expect.arrayContaining(["mage", "bishop", "thief"]));
  });
  test("data: IT-02/IT-25 武器は damage / caster と任意の reach を持ち ac を持たない、それ以外は ac を持ち damage / reach / caster を持たない", () => {
    expectIssue((r) => delete r.equipmentBases[1].damage, "equipment-bases.json", "[1].damage: missing required field");
    expectIssue((r) => delete r.equipmentBases[1].caster, "equipment-bases.json", "[1].caster: missing required field");
    expectIssue((r) => (r.equipmentBases[1].ac = 0), "equipment-bases.json", "[1].ac: unknown field");
    expectIssue((r) => delete r.equipmentBases[15].ac, "equipment-bases.json", "[15].ac: missing required field");
    expectIssue((r) => (r.equipmentBases[15].damage = "1d4"), "equipment-bases.json", "[15].damage: unknown field");
    expectIssue((r) => (r.equipmentBases[15].reach = "melee"), "equipment-bases.json", "[15].reach: unknown field");
    // IT-25（2026-10-06）: 前の ranged の欄は武器でも未知の欄。reach は melee / long / ranged だけ。省略は melee
    expectIssue((r) => (r.equipmentBases[1].ranged = true), "equipment-bases.json", "[1].ranged: unknown field");
    expectIssue((r) => (r.equipmentBases[1].reach = "far"), "equipment-bases.json", "[1].reach: expected one of");
    expect(issuesOf((r) => (r.equipmentBases[1].reach = "long"))).toEqual([]);
    expect(loadGameData(rawData()).equipmentBases.filter((b) => b.slot === "weapon" && b.reach === undefined).map((b) => b.id)).toEqual([
      "dagger", "long_sword", "mace", "staff", "oak_staff", "sigil_staff", "heavy_blade", "elder_staff", // M12: 重剣・古樹の杖
    ]);
    expectIssue((r) => (r.equipmentBases[15].ac = 1.5), "equipment-bases.json", "[15].ac: expected integer");
    expectIssue((r) => (r.equipmentBases[0].slot = "ring"), "equipment-bases.json", "[0].slot: expected one of");
    expectIssue((r) => (r.equipmentBases[0].damage = "1x4"), "equipment-bases.json", "[0].damage: invalid dice expression");
  });
  test("data: IT-22/IT-25 術者用武器（caster）の reach は melee だけ（long / ranged は止める）", () => {
    expectIssue((r) => (r.equipmentBases[5].reach = "ranged"), "equipment-bases.json", "[5].caster: IT-22");
    expectIssue((r) => (r.equipmentBases[5].reach = "long"), "equipment-bases.json", "[5].caster: IT-22");
    expect(issuesOf((r) => (r.equipmentBases[5].reach = "melee"))).toEqual([]);
  });
  test("data: IT-22 ベースの magicPower（M9）は caster の武器だけで 0 以上の整数（caster でない武器・防具類には書けない）", () => {
    expect(issuesOf((r) => (r.equipmentBases[5].magicPower = 0))).toEqual([]);
    expect(issuesOf((r) => (r.equipmentBases[5].magicPower = 3))).toEqual([]);
    expectIssue((r) => (r.equipmentBases[5].magicPower = -1), "equipment-bases.json", "[5].magicPower: expected integer >= 0");
    expectIssue((r) => (r.equipmentBases[1].magicPower = 1), "equipment-bases.json", "[1].magicPower: IT-22: magicPower is only for caster weapons");
    expectIssue((r) => (r.equipmentBases[15].magicPower = 1), "equipment-bases.json", "[15].magicPower: unknown field");
  });
  test("data: IT-02 classes は実在の職業、price / shopMinLevel は 0 以上の整数、unidentifiedName は空でない、id は一意", () => {
    expectIssue((r) => r.equipmentBases[2].classes.push("ninja"), "equipment-bases.json", '[2].classes[5]: unknown class id "ninja"');
    expectIssue((r) => (r.equipmentBases[2].price = -1), "equipment-bases.json", "[2].price: expected integer >= 0");
    expectIssue((r) => (r.equipmentBases[2].shopMinLevel = -1), "equipment-bases.json", "[2].shopMinLevel: expected integer >= 0");
    expectIssue((r) => (r.equipmentBases[2].unidentifiedName = ""), "equipment-bases.json", "[2].unidentifiedName: expected non-empty string");
    expectIssue((r) => (r.equipmentBases[2].id = "dagger"), "equipment-bases.json", '[2].id: duplicate id "dagger"');
  });
  test("data: IT-10（M7 の B2）ベースの id は items.json の id と重ならない（実体の itemId が両方を指すため）", () => {
    expectIssue((r) => (r.equipmentBases[1].id = "herb"), "equipment-bases.json", '[1].id: IT-10: base id "herb" overlaps an items.json id');
  });
  test("data: CB-20 防具類のベースの ac は整数（正の ac も可。負のオプションと同じく AC が悪化しうる）", () => {
    expect(issuesOf((r) => (r.equipmentBases[15].ac = 2))).toEqual([]);
    expectIssue((r) => (r.equipmentBases[15].ac = 1.5), "equipment-bases.json", "[15].ac: expected integer, got number");
  });
  test("data: IT-04 開始の装備（prototypeParty / classes[].start）は汎用ベース表の id（items.json に無い鎚矛も可）", () => {
    // ベルク（fighter）に鎚矛。items.json には無く、ベース表にだけある
    expect(issuesOf((r) => (r.config.prototypeParty.members[1].equipment.weapon = "mace"))).toEqual([]);
    expect(issuesOf((r) => (r.classes[0].start.equipment.weapon = "mace"))).toEqual([]);
    expectIssue((r) => (r.config.prototypeParty.members[1].equipment.weapon = "herb"), "config.json", 'members[1].equipment.weapon: unknown equipment base id "herb"');
    // 魔術師（members[4]）は鎚矛を装備できない（CH-75 をベースの classes で見る）
    expectIssue((r) => (r.config.prototypeParty.members[4].equipment.weapon = "mace"), "config.json", "members[4].equipment.weapon: CH-75");
  });
});

describe("data: item-options.json（IT-33 / IT-34。M7）", () => {
  test("data: IT-33 実データのオプション 22 種（M10 で魔法攻撃力を足した）", () => {
    expect(loadGameData(rawData()).itemOptions.options).toHaveLength(22);
  });
  test("data: IT-36 魔法攻撃力（magic_power）は杖と装飾品だけ（appliesTo [caster, accessory]）。ほかの 21 種は appliesTo を省略（全品種）", () => {
    const opts = loadGameData(rawData()).itemOptions.options;
    const mp = opts.find((o) => o.id === "magic_power")!;
    expect(mp.effect).toEqual({ type: "magicPower" });
    expect(mp.values).toEqual([1, 2, 3]);
    expect(mp.appliesTo).toEqual(["caster", "accessory"]);
    expect(opts.filter((o) => o.appliesTo !== undefined).map((o) => o.id)).toEqual(["magic_power"]);
    // 実データの全品種に、引ける件数が希少度の個数の最大 + 1（4）以上ある
    for (const k of OPTION_KINDS) expect(opts.filter((o) => optionAppliesTo(o, k)).length).toBeGreaterThanOrEqual(4);
  });
  test("data: IT-36 appliesTo は空でない品種の配列で、未知の品種と重複で止まる", () => {
    expectIssue((r) => (r.itemOptions.options[0].appliesTo = []), "item-options.json", "options[0].appliesTo: expected at least 1 element(s)");
    expectIssue((r) => (r.itemOptions.options[0].appliesTo = ["staff"]), "item-options.json", "options[0].appliesTo[0]: expected one of");
    expectIssue((r) => (r.itemOptions.options[0].appliesTo = ["weapon", "weapon"]), "item-options.json", 'options[0].appliesTo[1]: IT-36: duplicate kind "weapon"');
    expectIssue((r) => (r.itemOptions.options[0].appliesTo = "weapon"), "item-options.json", "options[0].appliesTo: expected array");
    expect(issuesOf((r) => (r.itemOptions.options[0].appliesTo = ["weapon", "caster", "armor", "shield", "helm", "gauntlet", "accessory"]))).toEqual([]);
  });
  test("data: IT-36 品種ごとに引ける件数が希少度の個数の最大 + 1 以上。全体が足りないときは IT-30/IT-32 だけを出す", () => {
    // 全体は 5 件あるが、5 件目は杖だけ。ほかの品種は 3 件で足りない
    const five = (r: Mutable): void => {
      r.itemOptions.options = r.itemOptions.options.slice(0, 5);
      r.itemOptions.options[3].appliesTo = ["caster"];
      r.itemOptions.options[4].appliesTo = ["caster"];
    };
    const issues = issuesOf(five);
    expect(issues).toContain('item-options.json: options: IT-36: kind "weapon" has only 3 options (need 4)');
    expect(issues).toContain('item-options.json: options: IT-36: kind "accessory" has only 3 options (need 4)');
    expect(issues.some((x) => x.includes('kind "caster"'))).toBe(false);
    // 全体が 3 件なら IT-30/IT-32 のエラーだけ（品種ごとのエラーは重ねない）
    const short = issuesOf((r) => {
      r.itemOptions.options = r.itemOptions.options.slice(0, 3);
      r.itemOptions.options[0].appliesTo = ["caster"];
    });
    expect(short.filter((x) => x.includes("IT-36"))).toEqual([]);
    expect(short.some((x) => x.includes("IT-30/IT-32: expected at least 4 options"))).toBe(true);
  });
  test("data: IT-36 optionKindOf は slot と caster で品種を決める（杖は caster、ほかの武器は weapon）", () => {
    const d = loadGameData(rawData());
    const kind = (id: string): string => optionKindOf(d.equipmentBases.find((b) => b.id === id)!);
    expect(["long_sword", "short_bow", "staff", "oak_staff", "leather_armor", "wooden_shield", "leather_cap", "leather_gloves", "charm"].map(kind)).toEqual([
      "weapon",
      "weapon",
      "caster",
      "caster",
      "armor",
      "shield",
      "helm",
      "gauntlet",
      "accessory",
    ]);
  });
  test("data: IT-34 effect.type は列挙、stat は能力値、status は状態異常、それ以外は追加の欄を持たない", () => {
    expectIssue((r) => (r.itemOptions.options[0].effect.type = "luck"), "item-options.json", "options[0].effect.type: expected one of");
    expectIssue((r) => (r.itemOptions.options[0].effect.stat = "cha"), "item-options.json", "options[0].effect.stat: expected one of");
    expectIssue((r) => delete r.itemOptions.options[0].effect.stat, "item-options.json", "options[0].effect.stat: missing required field");
    expectIssue((r) => (r.itemOptions.options[14].effect.status = "curse"), "item-options.json", "options[14].effect.status: expected one of");
    expectIssue((r) => (r.itemOptions.options[6].effect.stat = "str"), "item-options.json", "options[6].effect.stat: unknown field");
  });
  test("data: IT-33 values は 3 件の正の整数で単調非減少、weight は正の整数、unit は \"\" か \"%\"、id は一意", () => {
    expectIssue((r) => r.itemOptions.options[0].values.pop(), "item-options.json", "options[0].values: IT-33: expected 3 values");
    expectIssue((r) => (r.itemOptions.options[0].values = [3, 2, 3]), "item-options.json", "options[0].values[1]: IT-33: values must be non-decreasing");
    expectIssue((r) => (r.itemOptions.options[0].values[0] = 0), "item-options.json", "options[0].values[0]: expected integer >= 1");
    // AC は 1 / 1 / 1（同じ値は可）
    expect(issuesOf((r) => (r.itemOptions.options[0].values = [2, 2, 2]))).toEqual([]);
    expectIssue((r) => (r.itemOptions.options[0].weight = 0), "item-options.json", "options[0].weight: expected integer >= 1");
    expectIssue((r) => (r.itemOptions.options[0].unit = "pt"), "item-options.json", "options[0].unit: expected one of");
    expectIssue((r) => (r.itemOptions.options[1].id = "str"), "item-options.json", 'options[1].id: duplicate id "str"');
    expectIssue((r) => (r.itemOptions.options = []), "item-options.json", "options: expected at least 1 element(s)");
  });
});

describe("data: uniques.json（IT-03 / IT-40。M7）", () => {
  test("data: IT-03 実データのユニーク 14 種（M9 で 4 種、M12 で 2 種）。M9・M12 の固有スキルは既存の 9 種から", () => {
    const d = loadGameData(rawData());
    expect(d.uniques).toHaveLength(14);
    expect(d.uniques.slice(8).map((u) => [u.id, u.base, u.skill.type, u.skill.value])).toEqual([
      ["tidewalker_spear", "spear", "walkRegen", 5],
      ["choir_robe", "warded_robe", "fearImmune", 0],
      ["abbot_sigil_staff", "sigil_staff", "mpCostDown", 2],
      ["gull_flock_knives", "throwing_knives", "extraAttack", 1],
      // M12: 弔いの面紗（眠りへの耐性の種類は無いので mpCostDown 1。choir_robe の fearImmune と重ねない）・墓守の両手剣（M12 のベース heavy_blade）
      ["mourner_veil", "warded_robe", "mpCostDown", 1],
      ["sentinel_blade", "heavy_blade", "extraAttack", 1],
    ]);
    expect(d.uniques.slice(12).map((u) => [u.id, u.ac ?? u.damage, u.optionTier, u.price])).toEqual([
      ["mourner_veil", -4, 3, 2000],
      ["sentinel_blade", "2d6+1", 3, 2600],
    ]);
  });
  test("data: IT-03 base は実在のベース。武器なら damage（caster なら magicPower も）、それ以外は ac", () => {
    expectIssue((r) => (r.uniques[1].base = "katana"), "uniques.json", '[1].base: unknown equipment base id "katana"');
    expectIssue((r) => delete r.uniques[1].damage, "uniques.json", "[1].damage: missing required field");
    expectIssue((r) => (r.uniques[1].ac = -1), "uniques.json", "[1].ac: unknown field");
    expectIssue((r) => (r.uniques[1].magicPower = 1), "uniques.json", "[1].magicPower: unknown field"); // 短剣は caster でない
    expectIssue((r) => delete r.uniques[0].magicPower, "uniques.json", "[0].magicPower: missing required field"); // 杖は caster
    expectIssue((r) => (r.uniques[0].magicPower = -1), "uniques.json", "[0].magicPower: expected integer >= 0");
    expectIssue((r) => delete r.uniques[3].ac, "uniques.json", "[3].ac: missing required field");
    expectIssue((r) => (r.uniques[3].damage = "1d4"), "uniques.json", "[3].damage: unknown field");
  });
  test("data: IT-40 skill.type は 9 種の列挙、value は整数（walkRegen ≥ 1、lifeSteal 0..100、value を使わない種類は 0）", () => {
    expectIssue((r) => (r.uniques[0].skill.type = "fly"), "uniques.json", "[0].skill.type: expected one of");
    expectIssue((r) => (r.uniques[0].skill.value = 1.5), "uniques.json", "[0].skill.value: expected integer");
    expectIssue((r) => (r.uniques[0].skill = { type: "walkRegen", value: 0 }), "uniques.json", "[0].skill.value: IT-40: walkRegen");
    expect(issuesOf((r) => (r.uniques[0].skill = { type: "walkRegen", value: 1 }))).toEqual([]);
    expectIssue((r) => (r.uniques[5].skill.value = 101), "uniques.json", "[5].skill.value: IT-40: lifeSteal");
    expect(issuesOf((r) => (r.uniques[5].skill.value = 100))).toEqual([]);
    expectIssue((r) => (r.uniques[2].skill.value = 1), "uniques.json", "[2].skill.value: IT-40: reachFromBack value must be 0");
  });
  test("data: IT-33 optionTier は 1..3、price は 0 以上、id は一意で汎用ベースの id と重ならない", () => {
    expectIssue((r) => (r.uniques[0].optionTier = 0), "uniques.json", "[0].optionTier: expected integer in 1..3");
    expectIssue((r) => (r.uniques[0].optionTier = 4), "uniques.json", "[0].optionTier: expected integer in 1..3");
    expectIssue((r) => (r.uniques[0].price = -1), "uniques.json", "[0].price: expected integer >= 0");
    expectIssue((r) => (r.uniques[1].id = "dawn_flint_staff"), "uniques.json", '[1].id: duplicate id "dawn_flint_staff"');
    expectIssue((r) => (r.uniques[1].id = "dagger"), "uniques.json", '[1].id: IT-03: unique id "dagger" overlaps');
  });
});

describe("data: drops.json（IT-50〜53。M7）", () => {
  test("data: IT-55 魔法書（M9）は d02 の 3 階の表（讃歌、低い重み 1）と d02 のボスの表（灰嵐、重み 2）、M12 は d03 の各表（既存の 3 冊を重み 1。新しい魔法書は無い）にある", () => {
    const d = loadGameData(rawData());
    const books = d.drops.tables.flatMap((t) => t.entries.flatMap((e) => ("item" in e ? [[t.id, e.item, e.weight]] : [])));
    expect(books).toEqual([
      ["d02_f3", "tome_sanctuary_hymn", 1],
      ["d02_boss", "tome_ash_gale", 2],
      ["d03_f1", "tome_lightning", 1],
      ["d03_f2", "tome_lightning", 1],
      ["d03_f2", "tome_sanctuary_hymn", 1],
      ["d03_f3", "tome_ash_gale", 1],
      ["d03_f4", "tome_ash_gale", 1],
      ["d03_f4", "tome_sanctuary_hymn", 1],
      ["d03_boss", "tome_ash_gale", 1],
      ["d03_boss", "tome_sanctuary_hymn", 1],
    ]);
  });
  test("data: IT-51 実データの表 12（M12 で d03 の 5 つ）。14 種のユニークはどれかの表に入る", () => {
    const d = loadGameData(rawData());
    expect(d.drops.tables.map((t) => t.id)).toEqual([
      "d01_f1", "d01_f2", "d01_boss", "d02_f1", "d02_f2", "d02_f3", "d02_boss", "d03_f1", "d03_f2", "d03_f3", "d03_f4", "d03_boss",
    ]);
    const inTables = new Set(d.drops.tables.flatMap((t) => t.entries.flatMap((e) => ("unique" in e ? [e.unique] : []))));
    expect([...inTables].sort()).toEqual(d.uniques.map((u) => u.id).sort());
  });
  test("data: IT-51/CB-65 itemChance / rolls はボスの表に必須、宝箱の表には置けない（M14。宝箱の個数は config.chest.secondItemChance / secondItemPerDanger）", () => {
    // tables[0] = d01_f1（chest.d01.1）、tables[2] = d01_boss（boss.d01）
    expect(issuesOf(() => {})).toEqual([]);
    expectIssue((r) => (r.drops.tables[0].rolls = 1), "drops.json", "tables[0].rolls: IT-51: not allowed in chest table (chest.d01.1");
    expectIssue((r) => (r.drops.tables[0].itemChance = 40), "drops.json", "tables[0].itemChance: IT-51: not allowed in chest table (chest.d01.1");
    expectIssue((r) => delete r.drops.tables[2].rolls, "drops.json", "tables[2].rolls: IT-51: required for boss table (boss.d01)");
    expectIssue((r) => delete r.drops.tables[2].itemChance, "drops.json", "tables[2].itemChance: IT-51: required for boss table (boss.d01)");
  });
  test("data: IT-51 表は itemChance 0..100、rolls ≥ 1、entries ≥ 1 で base / unique のどちらか一方（実在）と正の weight、id は一意", () => {
    // tables[2] は d01_boss（ボスの表。itemChance / rolls を持つ）
    expectIssue((r) => (r.drops.tables[2].itemChance = 101), "drops.json", "tables[2].itemChance: expected integer in 0..100");
    expectIssue((r) => (r.drops.tables[2].rolls = 0), "drops.json", "tables[2].rolls: expected integer >= 1");
    expectIssue((r) => (r.drops.tables[0].entries = []), "drops.json", "tables[0].entries: expected at least 1 element(s)");
    expectIssue((r) => (r.drops.tables[0].entries[0].unique = "twin_tongue_dagger"), "drops.json", "tables[0].entries[0]: IT-51: entry needs exactly one");
    expectIssue((r) => delete r.drops.tables[0].entries[0].base, "drops.json", "tables[0].entries[0]: IT-51: entry needs exactly one");
    expectIssue((r) => (r.drops.tables[0].entries[0].base = "katana"), "drops.json", 'tables[0].entries[0].base: unknown equipment base id "katana"');
    expectIssue((r) => (r.drops.tables[0].entries[9].unique = "excalibur"), "drops.json", 'tables[0].entries[9].unique: unknown unique id "excalibur"');
    expectIssue((r) => (r.drops.tables[0].entries[0].weight = 0), "drops.json", "tables[0].entries[0].weight: expected integer >= 1");
    expectIssue((r) => (r.drops.tables[1].id = "d01_f1"), "drops.json", 'tables[1].id: duplicate id "d01_f1"');
  });
  test("data: IT-51/IT-55 項目は base / unique / item のちょうど 1 つ。item は items.json の id で type book（M9）", () => {
    expect(issuesOf((r) => (r.drops.tables[0].entries[0] = { item: "tome_lightning", weight: 1 }))).toEqual([]);
    expectIssue((r) => (r.drops.tables[0].entries[0].item = "tome_lightning"), "drops.json", "tables[0].entries[0]: IT-51: entry needs exactly one of base, unique or item");
    expectIssue((r) => (r.drops.tables[0].entries[0] = { weight: 1 }), "drops.json", "tables[0].entries[0]: IT-51: entry needs exactly one of base, unique or item");
    expectIssue((r) => (r.drops.tables[0].entries[0] = { item: "herb", weight: 1 }), "drops.json", "tables[0].entries[0].item: IT-55: item must be a book");
    expectIssue((r) => (r.drops.tables[0].entries[0] = { item: "grimoire", weight: 1 }), "drops.json", 'tables[0].entries[0].item: unknown item id "grimoire"');
  });
  test("data: CB-57/IT-57 直接ドロップ（M14）: monsters[].dropKind は必須で DROP_KINDS のどれか。drops.direct.kinds は全種類に空でなく重複のない種別、consumables は消耗品で重みの合計 > 0", () => {
    const d = loadGameData(rawData());
    expect(Object.fromEntries(d.monsters.map((m) => [m.id, m.dropKind]))).toEqual({
      giant_rat: "beast", kobold: "humanoid", giant_spider: "beast", rotting_corpse: "undead", whispering_shadow: "spirit",
      gatekeeper_armor: "construct", dusk_bat: "beast", drowsy_slime: "beast", drowned_acolyte: "undead", glass_moth: "beast",
      choir_wraith: "spirit", font_mire: "beast", stone_gazer: "construct", sunken_bishop: "undead", ash_shambler: "undead",
      cinder_crow: "beast", candle_mourner: "spirit", urn_bearer: "undead", grave_sentinel: "undead", ashcrown_lord: "undead",
    });
    expect(d.drops.direct.kinds).toEqual({
      humanoid: ["weapon", "armor"], undead: ["accessory", "book"], beast: ["consumable", "gold"], construct: ["armor"], spirit: ["book", "accessory"],
    });
    expect(d.drops.direct.consumables).toEqual([{ item: "herb", weight: 3 }, { item: "antidote_herb", weight: 2 }, { item: "return_thread", weight: 1 }]);
    expectIssue((r) => delete r.monsters[0].dropKind, "monsters.json", "[0].dropKind: missing required field");
    expectIssue((r) => (r.monsters[0].dropKind = "dragon"), "monsters.json", "[0].dropKind: expected one of");
    expectIssue((r) => delete r.drops.direct, "drops.json", "direct: missing required field");
    expectIssue((r) => delete r.drops.direct.kinds.spirit, "drops.json", "direct.kinds.spirit: missing required field");
    expectIssue((r) => (r.drops.direct.kinds.dragon = ["gold"]), "drops.json", "direct.kinds.dragon: unknown field");
    expectIssue((r) => (r.drops.direct.kinds.beast = []), "drops.json", "direct.kinds.beast: expected at least 1 element(s)");
    expectIssue((r) => (r.drops.direct.kinds.beast = ["gold", "gem"]), "drops.json", "direct.kinds.beast[1]: expected one of");
    expectIssue((r) => (r.drops.direct.kinds.beast = ["gold", "gold"]), "drops.json", "direct.kinds.beast: IT-57: categories must not repeat");
    expectIssue((r) => (r.drops.direct.consumables[0].item = "tome_lightning"), "drops.json", "direct.consumables[0].item: IT-57: item must be a consumable");
    expectIssue((r) => (r.drops.direct.consumables[0].item = "elixir"), "drops.json", 'direct.consumables[0].item: unknown item id "elixir"');
    expectIssue((r) => (r.drops.direct.consumables = []), "drops.json", "direct.consumables: expected at least 1 element(s)");
    expectIssue((r) => (r.drops.direct.consumables[0].weight = -1), "drops.json", "direct.consumables[0].weight: expected integer >= 0");
    expectIssue((r) => {
      for (const c of r.drops.direct.consumables) c.weight = 0;
    }, "drops.json", "direct.consumables: IT-57: total weight must be positive");
    expect(issuesOf((r) => (r.drops.direct.consumables[0].weight = 0))).toEqual([]);
  });
  test("data: CB-57 combat.directDropChance は 0..100、directDropGoldDice はダイス記法【仮】（M14）", () => {
    const d = loadGameData(rawData());
    expect([d.config.combat.directDropChance, d.config.combat.directDropGoldDice]).toEqual([5, "2d10"]);
    expectIssue((r) => delete r.config.combat.directDropChance, "config.json", "combat.directDropChance: missing required field");
    expectIssue((r) => (r.config.combat.directDropChance = 101), "config.json", "combat.directDropChance: expected integer in 0..100, got 101");
    expectIssue((r) => (r.config.combat.directDropGoldDice = "2d"), "config.json", 'combat.directDropGoldDice: invalid dice expression "2d"');
    expectIssue((r) => delete r.config.combat.directDropGoldDice, "config.json", "combat.directDropGoldDice: missing required field");
  });
  test("data: IT-51 chest は全ダンジョンの全階（1..floors）に実在の表、boss は全ダンジョンに実在の表", () => {
    expectIssue((r) => delete r.drops.chest.d02, "drops.json", "chest.d02: missing required field");
    expectIssue((r) => delete r.drops.chest.d01["2"], "drops.json", "chest.d01.2: missing required field");
    expectIssue((r) => (r.drops.chest.d01["3"] = "d01_f2"), "drops.json", "chest.d01.3: IT-51: floor key must be 1..2");
    expectIssue((r) => (r.drops.chest.d09 = { "1": "d01_f1" }), "drops.json", 'chest.d09: unknown dungeon id "d09"');
    expectIssue((r) => (r.drops.chest.d01["1"] = "d09_f1"), "drops.json", 'chest.d01.1: unknown drop table id "d09_f1"');
    expectIssue((r) => delete r.drops.boss.d02, "drops.json", "boss.d02: missing required field");
    expectIssue((r) => (r.drops.boss.d01 = "nope"), "drops.json", 'boss.d01: unknown drop table id "nope"');
    expectIssue((r) => (r.drops.boss.d09 = "d01_boss"), "drops.json", 'boss.d09: unknown dungeon id "d09"');
  });
});

describe("data: personalities.json", () => {
  test("data: CH-30 4 つの性格がそろう", () => {
    expectIssue((r) => r.personalities.pop(), "personalities.json", 'CH-30: personality "normal" is missing');
  });
  test("data: EV-03 誘いの重みは 0..3", () => {
    expectIssue((r) => (r.personalities[1].lure.unknown = 4), "personalities.json", "[1].lure.unknown: expected integer in 0..3");
  });
  test("data: EV-14 普通の lure は 0", () => {
    expectIssue(
      (r) => (r.personalities.find((x: { id: string }) => x.id === "normal").lure.weak = 1),
      "personalities.json",
      "[3].lure.weak: EV-14: normal must have lure 0, got 1",
    );
  });
  test("data: EV-41 普通は恩恵も耐性も持たない", () => {
    expectIssue((r) => (r.personalities[3].benefits.damage = 1), "personalities.json", "EV-41");
    expectIssue((r) => (r.personalities[3].san.fearLossMul = 0.5), "personalities.json", "EV-41");
  });
  test("data: IT-31 benefits.chestQuality は 1 段上げる確率 0..100（M14。強欲 25（M15。M14 は 35）、ほかは 0）", () => {
    expect(personalities.map((p) => [p.id, p.benefits.chestQuality])).toEqual([
      ["cautious", 0],
      ["reckless", 0],
      ["greedy", 25],
      ["normal", 0],
    ]);
    expectIssue((r) => (r.personalities[2].benefits.chestQuality = 101), "personalities.json", "[2].benefits.chestQuality: expected integer in 0..100");
    expect(issuesOf((r) => (r.personalities[2].benefits.chestQuality = 100))).toEqual([]);
  });
  test("data: UI-62 性格の短い説明 shortDescription は 1〜27 字（自分で作るの行の 2 行目。中身 218px ÷ 全角 8px）", () => {
    expectIssue((r) => (r.personalities[0].shortDescription = "あ".repeat(28)), "personalities.json", "[0].shortDescription: UI-62: too long (28 > 27)");
    expectIssue((r) => (r.personalities[0].shortDescription = ""), "personalities.json", "[0].shortDescription");
    expect(issuesOf((r) => (r.personalities[0].shortDescription = "あ".repeat(27)))).toEqual([]);
  });
});

describe("data: penalty-table.json", () => {
  test("data: TW-22 ペナルティ表が 2..20 を網羅（隙間）", () => {
    expectIssue((r) => (r.penaltyTable.bands[1].max = 5), "penalty-table.json", "TW-22: rolls 6..6 are not covered");
  });
  test("data: TW-22 ペナルティ表の帯が重ならない", () => {
    expectIssue((r) => (r.penaltyTable.bands[1].min = 3), "penalty-table.json", "TW-22");
  });
  test("data: TW-22 ダイスは 2d10、比率は 0..1", () => {
    expectIssue((r) => (r.penaltyTable.dice = "3d6"), "penalty-table.json", "dice: TW-22");
    expectIssue((r) => (r.penaltyTable.bands[0].goldLossRatio = 1.5), "penalty-table.json", "bands[0].goldLossRatio: expected number in 0..1");
  });
  test("data: 帯の文言キーが strings.json にある", () => {
    expectIssue((r) => (r.penaltyTable.bands[0].text = "wipe.band.nope"), "penalty-table.json", 'unknown strings.json key "wipe.band.nope"');
  });
});

describe("data: dungeons.json", () => {
  test("data: ぶら下がり参照（敵・アイテム・イベント）", () => {
    const issues = issuesOf((r) => {
      r.dungeons[0].encounterTable["1"][0].monster = "dragon";
      r.dungeons[1].events.push("no_such_event");
      r.dungeons[0].boss.monster = "boss_x";
    });
    expect(issues).toEqual(
      expect.arrayContaining([
        'dungeons.json: [0].encounterTable.1[0].monster: unknown monster id "dragon"',
        'dungeons.json: [1].events[4]: unknown event id "no_such_event"',
        'dungeons.json: [0].boss.monster: unknown monster id "boss_x"',
      ]),
    );
  });
  test("data: IT-62 onClear.shopLevel は 0 以上の整数（d01 2 / d02 4 / d03 6【仮】）。TW-06 の onClear.shopStock は廃止したので未知の欄として止める（M7 の B7）", () => {
    expect(loadGameData(rawData()).dungeons.map((d) => d.onClear.shopLevel)).toEqual([2, 4, 6]); // M12: d03 は 6（U-1。M9 の準備中の枠では 4）
    expectIssue((r) => delete r.dungeons[0].onClear.shopLevel, "dungeons.json", "[0].onClear.shopLevel: missing required field");
    expectIssue((r) => (r.dungeons[0].onClear.shopLevel = -1), "dungeons.json", "[0].onClear.shopLevel: expected integer >= 0");
    expect(loadGameData(rawData()).dungeons.some((d) => "shopStock" in d.onClear)).toBe(false);
    expectIssue((r) => (r.dungeons[1].onClear.shopStock = ["mace"]), "dungeons.json", "[1].onClear.shopStock: unknown field");
  });
  test("data: DG-02 階ごとの表のキーは 1..floors", () => {
    expectIssue((r) => (r.dungeons[0].encounterTable["3"] = [{ monster: "kobold", weight: 1 }]), "dungeons.json", "[0].encounterTable.3: DG-02");
    expectIssue((r) => delete r.dungeons[1].groupCountWeights["3"], "dungeons.json", "[1].groupCountWeights.3: missing required field");
  });
  test("data: CB-03 グループ数の重みは maxEnemyGroups 個", () => {
    expectIssue((r) => (r.dungeons[0].groupCountWeights["1"] = [70, 30]), "dungeons.json", "[0].groupCountWeights.1: CB-03");
    expectIssue((r) => (r.dungeons[0].groupCountWeights["1"] = [0, 0, 0, 0]), "dungeons.json", "CB-03: weights must sum to > 0");
  });
  test("data: DG-01 配列の順に開放する", () => {
    expectIssue((r) => (r.dungeons[1].unlock = null), "dungeons.json", "[1].unlock: DG-01");
    expectIssue((r) => (r.dungeons[0].onClear.unlockDungeon = null), "dungeons.json", "[0].onClear.unlockDungeon: DG-01");
  });
  test("data: DG-01 ダンジョンは 1 件以上", () => {
    expectIssue((r) => (r.dungeons = []), "dungeons.json", "(root): expected at least 1 element(s), got 0");
  });
  test("data: DG-34 テレポーター階は floors 以下", () => {
    expectIssue((r) => (r.dungeons[0].teleporterFloors = [3]), "dungeons.json", "[0].teleporterFloors[0]: DG-34: floor 3 exceeds floors 2");
    expect(issuesOf((r) => (r.dungeons[0].teleporterFloors = [2]))).toEqual([]);
  });
  test("data: DG-38 floorLevels（M14【仮】）は d01 [1, 2]・d02 [3, 4, 5]・d03 [5, 6, 6, 7]。長さ ≠ floors・0 以下・欠落は起動を止める", () => {
    expect(dungeons.map((d) => d.floorLevels)).toEqual([[1, 2], [3, 4, 5], [5, 6, 6, 7]]);
    expectIssue((r) => (r.dungeons[0].floorLevels = [1]), "dungeons.json", "[0].floorLevels: DG-38: expected 2 levels (floors), got 1");
    expectIssue((r) => (r.dungeons[0].floorLevels = [1, 2, 3]), "dungeons.json", "[0].floorLevels: DG-38: expected 2 levels (floors), got 3");
    expectIssue((r) => (r.dungeons[1].floorLevels = [3, 0, 5]), "dungeons.json", "[1].floorLevels[1]");
    expectIssue((r) => delete r.dungeons[2].floorLevels, "dungeons.json", "[2].floorLevels: missing required field");
    expect(issuesOf((r) => (r.dungeons[0].floorLevels = [9, 1]))).toEqual([]);
  });
  test("data: DG-22 イベントは重複しない", () => {
    expectIssue((r) => r.dungeons[0].events.push("glowing_tablet"), "dungeons.json", "DG-22");
  });
  test("data: DG-20 罠の種類", () => {
    expectIssue((r) => r.dungeons[0].traps.push("arrow"), "dungeons.json", "[0].traps[2]: expected one of pit|spinner|teleport");
  });
  test("data: DG-02 dungeons の width/height が 5 未満なら検証エラー", () => {
    expectIssue((r) => (r.dungeons[0].width = 4), "dungeons.json", "[0].width: expected integer >= 5, got 4");
    expectIssue((r) => (r.dungeons[1].height = 1), "dungeons.json", "[1].height: expected integer >= 5, got 1");
    expect(issuesOf((r) => ((r.dungeons[0].width = 5), (r.dungeons[0].height = 5)))).toEqual([]);
  });
  test("data: DG-05 rooms は [min, max]", () => {
    expectIssue((r) => (r.dungeons[0].rooms = [6, 3]), "dungeons.json", "[0].rooms: min 6 > max 3");
  });
  test("data: DG-05 rooms は省略でき、既定値（config.dungeon.defaultRooms）を超える rooms も通る", () => {
    expect(issuesOf((r) => delete r.dungeons[0].rooms)).toEqual([]);
    expect(issuesOf((r) => (r.dungeons[0].rooms = [4, 7]))).toEqual([]);
  });
  test("data: DG-23/CB-61 chestsPerFloor・chestTrapMaxDanger・chestTrapDangerWeights の実データと検証（M11）", () => {
    const ds = loadGameData(rawData()).dungeons;
    expect(ds.map((d) => d.chestsPerFloor)).toEqual([[1, 3], [1, 3], [1, 3]]);
    expect(ds.map((d) => d.chestTrapMaxDanger)).toEqual([2, 3, 4]);
    expect(ds.map((d) => d.chestTrapDangerWeights)).toEqual([[60, 40, 0, 0], [40, 35, 25, 0], [30, 30, 25, 15]]);
    expectIssue((r) => delete r.dungeons[0].chestsPerFloor, "dungeons.json", "[0].chestsPerFloor: missing required field");
    expectIssue((r) => (r.dungeons[0].chestsPerFloor = [3, 1]), "dungeons.json", "[0].chestsPerFloor: min 3 > max 1");
    expectIssue((r) => (r.dungeons[0].chestTrapMaxDanger = 0), "dungeons.json", "[0].chestTrapMaxDanger: expected integer in 1..4, got 0");
    expectIssue((r) => (r.dungeons[0].chestTrapMaxDanger = 5), "dungeons.json", "[0].chestTrapMaxDanger: expected integer in 1..4, got 5");
    expectIssue((r) => (r.dungeons[0].chestTrapDangerWeights = [60, 40, 0]), "dungeons.json", "[0].chestTrapDangerWeights: CB-61: expected 4 weights (danger 1..4), got 3");
    expectIssue((r) => (r.dungeons[0].chestTrapDangerWeights = [60, -1, 0, 0]), "dungeons.json", "[0].chestTrapDangerWeights[1]: expected integer >= 0, got -1");
    expectIssue((r) => (r.dungeons[0].chestTrapDangerWeights = [60, 40, 10, 0]), "dungeons.json", "[0].chestTrapDangerWeights[2]: CB-61: danger 3 exceeds chestTrapMaxDanger 2 (weight must be 0)");
    expectIssue((r) => (r.dungeons[0].chestTrapDangerWeights = [0, 0, 0, 0]), "dungeons.json", "[0].chestTrapDangerWeights: CB-61: weights must sum to > 0");
    expect(issuesOf((r) => (r.dungeons[0].chestsPerFloor = [0, 0]))).toEqual([]);
    expect(issuesOf((r) => (r.dungeons[0].chestTrapDangerWeights = [0, 1, 0, 0]))).toEqual([]);
  });
});

describe("data: penalty-table.json の帯の数（UI-56。M5.5）", () => {
  /** 2..20 を n 帯に分ける（先頭の n−1 帯は 1 つずつ、最後が残り全部） */
  const bandsOf = (r: Mutable, n: number) => {
    const b0 = r.penaltyTable.bands[0];
    return Array.from({ length: n }, (_, i) => ({ ...b0, min: 2 + i, max: i === n - 1 ? 20 : 2 + i }));
  };
  test("UI-56 penalty-table の帯が 9 以上なら検証で止める（8 までは通る）", () => {
    expectIssue((r) => (r.penaltyTable.bands = bandsOf(r, 9)), "penalty-table.json", "bands: UI-56: too many bands (max 8)");
    expect(issuesOf((r) => (r.penaltyTable.bands = bandsOf(r, 8)))).toEqual([]);
  });
});

describe("data: tavern.json（TW-13 / TW-14。M5.5）", () => {
  test("data: TW-14 tavern.json の検証: damage / revealFloor 等の効果、san の target が party 以外、差し込みのある text / lookTexts、未知の strings キー、weight 0、空の events / lookTexts、id の重複は起動を止める", () => {
    const F = "tavern.json";
    expectIssue((r) => (r.tavern.events[0].effects[0] = { type: "damage", dice: "1d4", target: "party" }), F, 'events[0].effects[0]: TW-14: tavern effect type "damage" is not allowed');
    expectIssue((r) => (r.tavern.events[0].effects[0] = { type: "revealFloor" }), F, 'TW-14: tavern effect type "revealFloor" is not allowed');
    expectIssue((r) => (r.tavern.events[0].effects[0] = { type: "revealStairs" }), F, 'TW-14: tavern effect type "revealStairs" is not allowed');
    expectIssue((r) => (r.tavern.events[0].effects[0] = { type: "consumeItem", itemId: "herb", target: "party" }), F, "TW-14: tavern effect type");
    expectIssue((r) => (r.tavern.events[0].effects[0] = { type: "san", value: -3, target: "actor" }), F, "events[0].effects[0].target: expected one of party");
    expectIssue((r) => (r.tavern.events[0].effects[0] = { type: "gold", dice: "2x6" }), F, "events[0].effects[0].dice");
    expectIssue((r) => (r.strings["tavern.dropped_coin.text"] = "{name}が拾った"), F, "events[0].text: TW-13/TW-14: strings");
    expectIssue((r) => (r.strings["town.look.quiet"] = "{gold}の音"), F, "lookTexts[1]: TW-13/TW-14: strings");
    expectIssue((r) => (r.tavern.lookTexts[0] = "town.look.nope"), F, 'lookTexts[0]: unknown strings.json key "town.look.nope"');
    expectIssue((r) => (r.tavern.events[1].effects[0].key = "tavern.nope"), F, 'events[1].effects[0].key: unknown strings.json key "tavern.nope"');
    expectIssue((r) => (r.tavern.events[0].weight = 0), F, "events[0].weight: expected integer >= 1");
    expectIssue((r) => (r.tavern.events = []), F, "events");
    expectIssue((r) => (r.tavern.lookTexts = []), F, "lookTexts");
    expectIssue((r) => (r.tavern.events[1].id = "dropped_coin"), F, 'duplicate id "dropped_coin"');
    // 許される効果（gold / san party / message / nothing）だけなら通る
    expect(
      issuesOf((r) => {
        r.tavern.events[0].effects = [
          { type: "gold", dice: "1d6" },
          { type: "san", value: 2, target: "party" },
          { type: "message", key: "tavern.old_rumor.more" },
          { type: "nothing" },
        ];
      }),
    ).toEqual([]);
  });

  test("data: TW-14 config.town.tavernEventTurns は正の整数、tavernEventChance は 0..100 の整数", () => {
    expectIssue((r) => (r.config.town.tavernEventTurns = 0), "config.json", "town.tavernEventTurns");
    expectIssue((r) => (r.config.town.tavernEventTurns = 1.5), "config.json", "town.tavernEventTurns");
    expectIssue((r) => (r.config.town.tavernEventChance = 101), "config.json", "town.tavernEventChance");
    expectIssue((r) => (r.config.town.tavernEventChance = -1), "config.json", "town.tavernEventChance");
    expect(issuesOf((r) => (r.config.town.tavernEventChance = 0))).toEqual([]);
  });
});

describe("data: events.json", () => {
  test("data: EV-34 文言キーが strings.json にある", () => {
    expectIssue((r) => (r.events[0].text.intro = "event.nope"), "events.json", '[0].text.intro: unknown strings.json key "event.nope"');
    expectIssue((r) => (r.events[1].choices[0].text = "event.nope2"), "events.json", "[1].choices[0].text: unknown strings.json key");
  });
  test("data: EV-04 impulseClasses は省略可。あれば職業の id の 1 件以上の重複なしの一覧（M11）", () => {
    expect(issuesOf((r) => (r.events[0].impulseClasses = ["thief"]))).toEqual([]);
    expect(issuesOf((r) => (r.events[0].impulseClasses = ["thief", "priest"]))).toEqual([]);
    expectIssue((r) => (r.events[0].impulseClasses = ["ninja"]), "events.json", '[0].impulseClasses[0]: unknown class id "ninja"');
    expectIssue((r) => (r.events[0].impulseClasses = []), "events.json", "[0].impulseClasses: expected at least 1 element(s), got 0");
    expectIssue((r) => (r.events[0].impulseClasses = ["thief", "thief"]), "events.json", '[0].impulseClasses[1]: EV-04: duplicate class "thief"');
    expectIssue((r) => (r.events[0].impulseClasses = "thief"), "events.json", "[0].impulseClasses: expected array");
  });
  test("data: EV-32 効果の型と参照", () => {
    expectIssue((r) => (r.events[2].choices[0].effects[0].itemId = "herbx"), "events.json", '[2].choices[0].effects[0].itemId: unknown item id "herbx"');
    expectIssue((r) => (r.events[0].impulseOutcomes[2].effects[0].target = "enemy"), "events.json", "[0].impulseOutcomes[2].effects[0].target: expected one of actor|party|others");
    expectIssue((r) => (r.events[0].impulseOutcomes[0].impulseBonus[0].type = "fly"), "events.json", "[0].impulseOutcomes[0].impulseBonus[0].type");
  });
  test("data: EV-32 item 効果は itemId と table のどちらか一方", () => {
    const msg = "[0].choices[0].effects[0]: EV-32: item effect needs exactly one of itemId or table";
    expectIssue((r) => (r.events[0].choices[0].effects[0] = { type: "item", itemId: "herb", table: "t1" }), "events.json", msg);
    expectIssue((r) => (r.events[0].choices[0].effects[0] = { type: "item" }), "events.json", msg);
    // 形が正しい item 効果でも、プロトタイプでは実装しないので「not implemented」の 1 件だけになる（EV-32 / M5）
    const notImpl = `events.json: [0].choices[0].effects[0]: EV-32: effect type "item" is not implemented in the prototype (M5)`;
    expect(issuesOf((r) => (r.events[0].choices[0].effects[0] = { type: "item", itemId: "herb" }))).toEqual([notImpl]);
    expect(issuesOf((r) => (r.events[0].choices[0].effects[0] = { type: "item", table: "t1" }))).toEqual([notImpl]);
  });
  test("data: EV-32 item / encounter / status の効果は検証で止める（効果・impulseBonus・選択肢のどこでも）", () => {
    const msg = (t: string) => `EV-32: effect type "${t}" is not implemented in the prototype (M5)`;
    expectIssue((r) => (r.events[0].choices[0].effects[0] = { type: "encounter", monster: r.monsters[0].id, count: 1 }), "events.json", "[0].choices[0].effects[0]: " + msg("encounter"));
    expectIssue((r) => (r.events[0].impulseOutcomes[0].effects[0] = { type: "status", status: "poison", target: "actor" }), "events.json", "[0].impulseOutcomes[0].effects[0]: " + msg("status"));
    expectIssue((r) => (r.events[0].impulseOutcomes[0].impulseBonus[0] = { type: "item", itemId: "herb" }), "events.json", "[0].impulseOutcomes[0].impulseBonus[0]: " + msg("item"));
  });
  test("data: EV-31/A9 choices[].labelKey は必須で strings に実在（規約 event.<eventId>.choice.<choiceId>）", () => {
    for (const e of events) for (const c of e.choices) expect(c.labelKey).toBe(`event.${e.id}.choice.${c.id}`);
    expectIssue((r) => (r.events[0].choices[0].labelKey = "event.nope"), "events.json", `[0].choices[0].labelKey: unknown strings.json key "event.nope"`);
    expectIssue((r) => delete r.events[1].choices[1].labelKey, "events.json", "[1].choices[1].labelKey: missing required field");
  });
  test("data: EV-34/E3 intro・labelKey・choice text に {…} が無い、impulse / outcome text は {actor} だけ", () => {
    expectIssue((r) => (r.strings["event.glowing_tablet.intro"] = "{actor}が見た"), "events.json", "[0].text.intro: EV-34/E3");
    expectIssue((r) => (r.strings["event.glowing_tablet.choice.examine"] = "{name}が調べる"), "events.json", "[0].choices[0].labelKey: EV-34/E3");
    expectIssue((r) => (r.strings["event.glowing_tablet.examine"] = "{actor}は眺めた"), "events.json", "[0].choices[0].text: EV-34/E3");
    expectIssue((r) => (r.strings["event.glowing_tablet.impulse"] = "{stopper}が見た"), "events.json", "[0].text.impulse: EV-34: strings");
    expectIssue((r) => (r.strings["event.glowing_tablet.bad"] = "{actor}と{gold}"), "events.json", "[0].impulseOutcomes[2].text: EV-34: strings");
    expect(issuesOf((r) => (r.strings["event.glowing_tablet.good"] = "{actor}の頭に流れ込んだ"))).toEqual([]);
  });
  test("data: EV-30 EV-31 衝動の結果", () => {
    expectIssue((r) => (r.events[0].impulseOutcomes[0].weight = 0), "events.json", "[0].impulseOutcomes[0].weight: expected integer >= 1");
    expectIssue((r) => (r.events[0].impulseOutcomes[0].requires = "choice"), "events.json", "[0].impulseOutcomes[0].requires");
  });
  test("data: 選択肢の id はイベント内で一意", () => {
    expectIssue((r) => (r.events[0].choices[1].id = "examine"), "events.json", '[0].choices[1].id: duplicate id "examine"');
  });
  test("data: EV-01 mixed には選択肢が要る", () => {
    expectIssue((r) => (r.events[0].choices = []), "events.json", "EV-01");
  });
  test("data: EV-01 impulse と mixed には衝動の結果が要り、choice は空でよい", () => {
    expect(issuesOf((r) => {
      r.events[0].kind = "choice";
      r.events[0].impulseOutcomes = [];
    })).toEqual([]);
    expectIssue(
      (r) => {
        r.events[0].kind = "impulse";
        r.events[0].impulseOutcomes = [];
      },
      "events.json",
      '[0].impulseOutcomes: EV-01: kind "impulse" needs at least 1 impulse outcome',
    );
    expectIssue((r) => (r.events[0].impulseOutcomes = []), "events.json", '[0].impulseOutcomes: EV-01: kind "mixed" needs at least 1 impulse outcome');
    // choice でも impulseOutcomes 自体は必須（空配列を書く）
    expectIssue((r) => {
      r.events[0].kind = "choice";
      delete r.events[0].impulseOutcomes;
    }, "events.json", "[0].impulseOutcomes: missing required field");
  });
});

describe("data: chest-traps.json（CB-62。M11）", () => {
  const F = "chest-traps.json";
  test("data: CB-62 実データの 8 種（危険度・効果）", () => {
    const ts = loadGameData(rawData()).chestTraps;
    expect(ts.map((t) => [t.id, t.danger, t.effect.kind])).toEqual([
      ["poison_needle", 1, "damage"],
      ["crossbow", 1, "damage"],
      ["bomb", 2, "damage"],
      ["poison_gas", 2, "status"],
      ["paralysis_gas", 3, "status"],
      ["alarm", 3, "alarm"],
      ["teleport", 4, "teleport"],
      ["curse", 4, "san"],
    ]);
    expect(ts.map((t) => t.name)).toEqual(ts.map((t) => `chest.trapName.${t.id}`));
    expect(ts[0]!.effect).toEqual({ kind: "damage", target: "one", dice: "1d4", status: "poison" });
    expect(ts[3]!.effect).toEqual({ kind: "status", target: "all", status: "poison", chance: 60 });
    expect(ts[7]!.effect).toEqual({ kind: "san", target: "all", amount: 8 });
  });
  test("data: CB-62 検証: id の重複、danger 1..4、効果の kind と欄、ダイス、状態、確率、文言の鍵", () => {
    expectIssue((r) => (r.chestTraps[1].id = "poison_needle"), F, '[1].id: duplicate id "poison_needle"');
    expectIssue((r) => (r.chestTraps[0].danger = 0), F, "[0].danger: expected integer in 1..4, got 0");
    expectIssue((r) => (r.chestTraps[0].danger = 5), F, "[0].danger: expected integer in 1..4, got 5");
    expectIssue((r) => (r.chestTraps[0].effect.kind = "fire"), F, "[0].effect.kind: expected one of damage|status|alarm|teleport|san");
    expectIssue((r) => (r.chestTraps[0].effect.target = "row"), F, "[0].effect.target: expected one of one|all");
    expectIssue((r) => (r.chestTraps[0].effect.dice = "d4"), F, "[0].effect.dice");
    expectIssue((r) => (r.chestTraps[0].effect.status = "curse"), F, "[0].effect.status: expected one of");
    expectIssue((r) => (r.chestTraps[3].effect.chance = 101), F, "[3].effect.chance: expected integer in 0..100, got 101");
    expectIssue((r) => (r.chestTraps[3].effect.target = "one"), F, "[3].effect.target: expected one of all");
    expectIssue((r) => (r.chestTraps[5].effect.dice = "1d6"), F, "[5].effect.dice: unknown field");
    expectIssue((r) => (r.chestTraps[7].effect.amount = -1), F, "[7].effect.amount: expected integer >= 0, got -1");
    expectIssue((r) => (r.chestTraps[0].name = "chest.trapName.nope"), F, '[0].name: unknown strings.json key "chest.trapName.nope"');
    expectIssue((r) => delete r.strings["chest.trap.bomb"], F, '[2]: unknown strings.json key "chest.trap.bomb"');
    expect(issuesOf((r) => delete r.chestTraps[1].effect.status)).toEqual([]);
  });
  test("data: CB-61 危険度 1〜4 のそれぞれに 1 件以上ある", () => {
    expectIssue((r) => (r.chestTraps = r.chestTraps.filter((t: any) => t.danger !== 3)), F, "(root): CB-61: no trap with danger 3");
    expectIssue((r) => (r.chestTraps = []), F, "(root): CB-61: no trap with danger 1");
  });
  test("data: CB-62 語り chest.trap.<id> は {actor} だけを差し込む", () => {
    expectIssue((r) => (r.strings["chest.trap.bomb"] = "{name}の手元で爆ぜた。"), F, '[2]: CB-62: strings "chest.trap.bomb" may only use {actor} (found {name})');
  });
});

describe("data: rivalries.json（EV-70〜76。M11）", () => {
  const F = "rivalries.json";
  test("data: EV-70 実データの thief_chest", () => {
    expect(loadGameData(rawData()).rivalries).toEqual([
      {
        id: "thief_chest",
        trigger: "chest",
        classId: "thief",
        chance: 50,
        contest: { stats: ["agi", "luk"], dice: "1d6" },
        bonus: { inspect: 10 },
        loserSan: 1,
        failSan: 3,
        text: { start: "rivalry.thief_chest.start", win: "rivalry.thief_chest.win", fail: "rivalry.thief_chest.fail" },
      },
    ]);
  });
  test("data: EV-70〜76 検証: id の重複、trigger、職業、確率、競り合いの能力値とダイス、補正、SAN、文言の鍵と差し込み", () => {
    expectIssue((r) => r.rivalries.push(structuredClone(r.rivalries[0])), F, '[1].id: duplicate id "thief_chest"');
    expectIssue((r) => (r.rivalries[0].trigger = "event"), F, "[0].trigger: expected one of chest");
    expectIssue((r) => (r.rivalries[0].classId = "ninja"), F, '[0].classId: unknown class id "ninja"');
    expectIssue((r) => (r.rivalries[0].chance = 101), F, "[0].chance: expected integer in 0..100, got 101");
    expectIssue((r) => (r.rivalries[0].contest.stats = []), F, "[0].contest.stats: expected at least 1 element(s), got 0");
    expectIssue((r) => (r.rivalries[0].contest.stats = ["agi", "spd"]), F, "[0].contest.stats[1]: expected one of");
    expectIssue((r) => (r.rivalries[0].contest.stats = ["agi", "agi"]), F, '[0].contest.stats[1]: EV-72: duplicate stat "agi"');
    expectIssue((r) => (r.rivalries[0].contest.dice = "x"), F, "[0].contest.dice");
    expectIssue((r) => (r.rivalries[0].bonus.inspect = -1), F, "[0].bonus.inspect: expected integer >= 0, got -1");
    expectIssue((r) => (r.rivalries[0].loserSan = -1), F, "[0].loserSan: expected integer >= 0, got -1");
    expectIssue((r) => (r.rivalries[0].failSan = 1.5), F, "[0].failSan: expected integer");
    expectIssue((r) => (r.rivalries[0].text.win = "rivalry.nope"), F, '[0].text.win: unknown strings.json key "rivalry.nope"');
    expectIssue((r) => (r.strings["rivalry.thief_chest.fail"] = "{actor}は唇を噛んだ。"), F, '[0].text.fail: EV-73: strings "rivalry.thief_chest.fail" may only use {name} (found {actor})');
    expectIssue((r) => (r.strings["rivalry.thief_chest.start"] = "{winner}と{b}が箱を見た。"), F, "[0].text.start: EV-73");
    expect(issuesOf((r) => (r.rivalries = []))).toEqual([]);
  });
});

describe("data: strings.json", () => {
  test("data: 値は空でない文字列", () => {
    expectIssue((r) => (r.strings["gm.test"] = 3), "strings.json", "gm.test: expected string, got integer");
  });
  test("data: プレースホルダの書式", () => {
    expectIssue((r) => (r.strings["gm.test"] = "{name さん"), "strings.json", "gm.test: malformed placeholder");
  });
  test("data: battle.status.<StatusId> がそろう", () => {
    expectIssue((r) => delete r.strings["battle.status.stone"], "strings.json", "battle.status.stone");
  });
  test("data: party.status.<StatusId>（パーティ欄の短い名前）がそろう", () => {
    expectIssue((r) => delete r.strings["party.status.sleep"], "strings.json", "party.status.sleep");
  });
  test("data: IT-11 表示名の部品 item.rarity.fine / rare / legendary と item.plus（{n} を 1 つだけ）がそろう", () => {
    expectIssue((r) => delete r.strings["item.rarity.rare"], "strings.json", "item.rarity.rare");
    expectIssue((r) => delete r.strings["item.plus"], "strings.json", "item.plus");
    expectIssue((r) => (r.strings["item.plus"] = " +{level}"), "strings.json", "item.plus: IT-11: must have exactly one placeholder {n} (found {level})");
    expectIssue((r) => (r.strings["item.plus"] = "+"), "strings.json", "item.plus: IT-11: must have exactly one placeholder {n} (found none)");
  });
  test("data: TW-34 結末の締めの語りの 1 行目 ending.speech.1 は必須（2 行目以降は任意。続き番号の数はデータで決まる）", () => {
    expectIssue((r) => delete r.strings["ending.speech.1"], "strings.json", "ending.speech.1");
    expect(issuesOf((r) => {
      delete r.strings["ending.speech.3"];
      delete r.strings["ending.speech.4"];
    })).toEqual([]);
  });
  test("data: TW-36 開始の語りの 1 行目 opening.speech.1 は必須（2 行目以降は任意。続き番号の数はデータで決まる）", () => {
    expectIssue((r) => delete r.strings["opening.speech.1"], "strings.json", "opening.speech.1");
    expect(issuesOf((r) => {
      for (const n of [2, 3, 4, 5]) delete r.strings[`opening.speech.${n}`];
    })).toEqual([]);
  });
  test("data: UI-76 一度きりの GM の一言 hint.dungeonFirst / hint.sanUnknown / hint.levelUpMark は必須で、差し込みを持たない（M16）", () => {
    for (const id of ["dungeonFirst", "sanUnknown", "levelUpMark"]) {
      expectIssue((r) => delete r.strings[`hint.${id}`], "strings.json", `hint.${id}`);
      expectIssue((r) => (r.strings[`hint.${id}`] = "{name}は覚えた。"), "strings.json", "UI-76");
    }
  });
  test("data: UI-74 能力値の説明の文言（stat.short.<k>・stat.desc.<k> の 6 つずつ、custom.statReq / statReqNone / classReq）は必須", () => {
    for (const k of ["str", "iq", "pie", "vit", "agi", "luk"]) {
      expectIssue((r) => delete r.strings[`stat.short.${k}`], "strings.json", `stat.short.${k}`);
      expectIssue((r) => delete r.strings[`stat.desc.${k}`], "strings.json", `stat.desc.${k}`);
    }
    for (const k of ["custom.statReq", "custom.statReqNone", "custom.classReq"]) expectIssue((r) => delete r.strings[k], "strings.json", k);
  });
  test("data: UI-74 stat.short.<k> は 1〜12 字（自分で作るの能力値の札の 2 行目。中身 118px ÷ 全角 8px = 14 字に余裕をみて）", () => {
    expectIssue((r) => (r.strings["stat.short.agi"] = "あ".repeat(13)), "strings.json", "stat.short.agi: UI-74: too long (13 > 12)");
    expectIssue((r) => (r.strings["stat.short.str"] = ""), "strings.json", "stat.short.str: expected non-empty string");
    expect(issuesOf((r) => (r.strings["stat.short.luk"] = "あ".repeat(12)))).toEqual([]);
  });
});

describe("data: エラー報告", () => {
  test("data: 複数ファイルの問題が一度にすべて報告される", () => {
    const issues = issuesOf((r) => {
      r.config.ui.flashMs = -1;
      r.races[0].name = 1;
      r.spells[0].mp = 1.5;
      r.monsters[0].hp = "zz";
      r.items[0].price = -1;
      r.dungeons[0].floors = "2";
      r.events[0].stat = "wis";
    });
    for (const file of ["config.json", "races.json", "spells.json", "monsters.json", "items.json", "dungeons.json", "events.json"]) {
      expect(issues.some((s) => s.startsWith(`${file}: `)), file).toBe(true);
    }
    expect(issues.length).toBeGreaterThanOrEqual(7);
  });

  test("data: GameDataError のメッセージに件数と先頭の問題が入る", () => {
    const r = rawData();
    r.monsters[3].hp = 12;
    r.spells[0].mp = -1;
    let err: unknown;
    try {
      loadGameData(r);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(GameDataError);
    const ge = err as GameDataError;
    expect(ge.name).toBe("GameDataError");
    expect(ge.issues).toHaveLength(2);
    expect(ge.message).toContain("2 issue(s)");
    expect(ge.message).toContain("monsters.json: [3].hp");
  });

  test("data: 問題が多いときメッセージは先頭だけで、issues は全件", () => {
    // 20 体 × 2 フィールド = 40 件（M9 で 8 種、M12 で 6 種を追加）
    const r = rawData();
    for (const m of r.monsters) {
      m.hp = 0;
      m.gold = 0;
    }
    let err: GameDataError | undefined;
    try {
      loadGameData(r);
    } catch (e) {
      err = e as GameDataError;
    }
    expect(err?.issues).toHaveLength(40);
    expect(err?.message).toContain("40 issue(s)");
    expect(err?.message).toContain("... and 30 more");
    expect(err?.message).not.toContain("monsters.json: [5].gold");
  });

  test("data: トップレベルが壊れていても GameDataError になる", () => {
    const nulls = Object.fromEntries(Object.keys(DATA_FILES).map((k) => [k, null])) as unknown as RawGameData;
    expect(() => loadGameData(nulls)).toThrow(GameDataError);
    const wrong = { ...rawData(), config: [], races: {}, penaltyTable: [], strings: [] as unknown[], dungeons: "x" };
    const issues = issuesOf((r) => Object.assign(r, wrong));
    expect(issues).toEqual(
      expect.arrayContaining([
        "config.json: (root): expected object, got array",
        "races.json: (root): expected array, got object",
        "penalty-table.json: (root): expected object, got array",
        "strings.json: (root): expected object, got array",
        "dungeons.json: (root): expected array, got string",
      ]),
    );
    expect(() => loadGameData(null as unknown as RawGameData)).toThrow(GameDataError);
    // 要素が null や配列でも落ちない
    expect(() => loadGameData({ ...rawData(), items: [null, [], 1], events: [null], monsters: [{}] })).toThrow(GameDataError);
  });
});

// ---------------------------------------------------------------------------
// 検証の網羅性（恒久テスト）。実データのすべての値（葉と、配列・オブジェクト自身）を別の JSON 型に
// 差し替えると検出されること、すべてのオブジェクトに未知のキーを足すと検出されることを機械的に確かめる。

type Path = (string | number)[];

/** v 以下のすべての値のパス（v 自身の [] を含む）。 */
function allPaths(v: unknown, base: Path = []): Path[] {
  const out: Path[] = [base];
  if (Array.isArray(v)) v.forEach((e, i) => out.push(...allPaths(e, [...base, i])));
  else if (typeof v === "object" && v !== null) for (const [k, e] of Object.entries(v)) out.push(...allPaths(e, [...base, k]));
  return out;
}

function getAt(v: any, path: Path): any {
  return path.reduce((cur, k) => cur[k], v);
}

/** 別の JSON 型の値。数値→"x"、文字列→123、真偽→"x"、null→123、配列→"x"、オブジェクト→"x"。 */
function otherType(v: unknown): unknown {
  if (typeof v === "string" || v === null) return 123;
  return "x";
}

function showPath(file: string, path: Path): string {
  return file + path.map((k) => (typeof k === "number" ? `[${k}]` : `.${k}`)).join("");
}

/** 型を変えても正当なままの値。キーは showPath() の形。除外は最小限にし、理由を書く。 */
const TYPE_SWAP_EXEMPT: ReadonlyMap<string, string> = new Map<string, string>([]);

describe("data: 検証の網羅性", () => {
  const files = Object.keys(DATA_FILES) as (keyof RawGameData)[];

  test("data: 実データの全ての値を別の JSON 型に差し替えると、そのファイルの issue になる", () => {
    const missed: string[] = [];
    let checked = 0;
    for (const key of files) {
      const file = DATA_FILES[key];
      const src = rawData();
      for (const path of allPaths(src[key])) {
        const name = showPath(file, path);
        if (TYPE_SWAP_EXEMPT.has(name)) continue;
        const before = getAt(src[key], path);
        const after = otherType(before);
        const issues = issuesOf((r) => {
          if (path.length === 0) r[key] = after;
          else getAt(r[key], path.slice(0, -1))[path[path.length - 1]!] = after;
        });
        checked++;
        if (!issues.some((s) => s.startsWith(`${file}: `)))
          missed.push(`${name} (${JSON.stringify(before)} -> ${JSON.stringify(after)})`);
      }
    }
    expect(checked).toBeGreaterThan(1000);
    expect(missed, `not detected:\n${missed.join("\n")}`).toEqual([]);
  });

  test("data: 実データの全てのオブジェクトに未知のキーを足すと、そのファイルの issue になる", () => {
    const missed: string[] = [];
    let checked = 0;
    for (const key of files) {
      const file = DATA_FILES[key];
      const src = rawData();
      for (const path of allPaths(src[key])) {
        const v = getAt(src[key], path);
        if (typeof v !== "object" || v === null || Array.isArray(v)) continue;
        // strings.json のトップレベルは任意のキーを持てる（キー自体が文言の id）
        if (key === "strings" && path.length === 0) continue;
        const issues = issuesOf((r) => {
          getAt(r[key], path).__unknownKey__ = 1;
        });
        checked++;
        if (!issues.some((s) => s.startsWith(`${file}: `) && s.includes("__unknownKey__")))
          missed.push(showPath(file, path));
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect(missed, `not detected:\n${missed.join("\n")}`).toEqual([]);
  });

  test("data: 網羅性テストの除外リストは実データに存在するパスだけを指す", () => {
    const all = new Set<string>();
    const raw = rawData();
    for (const key of Object.keys(DATA_FILES) as (keyof RawGameData)[])
      for (const path of allPaths(raw[key])) all.add(showPath(DATA_FILES[key], path));
    expect([...TYPE_SWAP_EXEMPT.keys()].filter((k) => !all.has(k))).toEqual([]);
  });
});

describe("data: CB-26 飛行（M9）", () => {
  test("data: CB-26 special.flying は真偽値", () => {
    expect(issuesOf((r) => (r.monsters[0].special.flying = true))).toEqual([]);
    expectIssue((r) => (r.monsters[0].special.flying = 1), "monsters.json", "[0].special.flying: expected boolean");
  });
});

describe("data: M9 の敵（工房の同期）とボス（DG-31）", () => {
  const M9 = ["dusk_bat", "drowsy_slime", "drowned_acolyte", "glass_moth", "choir_wraith", "font_mire", "stone_gazer", "sunken_bishop"];
  test("data: M9 の敵 8 種の sprite は id と同じ・unknownKind が定義済み・ボスは tags に boss（工房の同期）。Lv 3〜5、名前は 7 字以内、description は空でない", () => {
    const d = loadGameData(rawData());
    const kinds = new Set(d.unknownKinds.map((k) => k.id));
    const ms = M9.map((id) => d.monsters.find((m) => m.id === id)!);
    expect(ms.every((m) => m !== undefined)).toBe(true);
    for (const m of ms) {
      expect(m.sprite, m.id).toBe(m.id);
      expect(kinds.has(m.unknownKind), m.id).toBe(true);
      expect(m.level, m.id).toBeGreaterThanOrEqual(3);
      expect(m.level, m.id).toBeLessThanOrEqual(5);
      expect([...m.name].length, m.id).toBeLessThanOrEqual(7);
      expect(m.description.length, m.id).toBeGreaterThan(0);
      expect(m.tags.includes("boss"), m.id).toBe(m.special.boss === true);
    }
    expect(ms.filter((m) => m.special.boss === true).map((m) => m.id)).toEqual(["sunken_bishop"]);
    expect(ms.filter((m) => m.special.flying === true).map((m) => m.id)).toEqual(["dusk_bat", "glass_moth"]);
    // 工房の unknown_<kind> の合成（所属 2 種以上）: ooze は 2 種、winged は M12 の燠火の鴉で 3 種、undead（M12）は 5 種
    expect((["winged", "ooze", "undead"] as const).map((k) => d.monsters.filter((m) => m.unknownKind === k).length)).toEqual([3, 2, 5]);
    // d02 のボスは沈鐘の大司祭
    expect(d.dungeons.find((x) => x.id === "d02")!.boss.monster).toBe("sunken_bishop");
  });
  test("data: DG-31 dungeons[].boss の敵は special.boss", () => {
    expectIssue((r) => (r.dungeons[0].boss.monster = "kobold"), "dungeons.json", '[0].boss.monster: DG-31: boss monster "kobold" must have special.boss');
    expectIssue((r) => delete r.monsters.find((m: { id: string }) => m.id === "sunken_bishop").special.boss, "dungeons.json", "[1].boss.monster: DG-31");
  });
});

describe("data: DG-35 準備中のダンジョン（M9。M12 から合成データ）", () => {
  test("data: DG-35 実データには準備中の枠が無い（M12 で d03 が本物になった）。合成データの準備中の枠 d04 は検証を通る", () => {
    const d = loadGameData(rawData());
    expect(d.dungeons.map((x) => [x.id, x.placeholder === true])).toEqual([
      ["d01", false],
      ["d02", false],
      ["d03", false],
    ]);
    expect(d.dungeons[2]!.onClear.unlockDungeon).toBeNull();
    expect(issuesOf(addPlaceholderDungeon)).toEqual([]);
    const p = loadDataWithPlaceholder();
    expect(p.dungeons.map((x) => [x.id, x.placeholder === true])).toEqual([
      ["d01", false],
      ["d02", false],
      ["d03", false],
      ["d04", true],
    ]);
    expect(p.dungeons[2]!.onClear.unlockDungeon).toBe("d04");
  });
  test("data: DG-35 placeholder は末尾・floors 1・unlockDungeon null（合成データの d04）。準備中でも drops の chest / boss は要る", () => {
    const withD04 = (mutate: (r: Mutable) => void) => (r: Mutable) => {
      addPlaceholderDungeon(r);
      mutate(r);
    };
    expectIssue(withD04((r) => (r.dungeons[3].placeholder = "yes")), "dungeons.json", "[3].placeholder: expected boolean");
    expectIssue(withD04((r) => (r.dungeons[3].floors = 2)), "dungeons.json", "[3].floors: DG-35: a placeholder dungeon must have floors 1");
    expectIssue(withD04((r) => (r.dungeons[3].onClear.unlockDungeon = "d01")), "dungeons.json", "[3].onClear.unlockDungeon: DG-35: a placeholder dungeon cannot unlock another");
    // 準備中の後ろに遊べるダンジョンは置けない（d03 を準備中・d04 を遊べるにする）
    expectIssue(
      withD04((r) => ((r.dungeons[2].placeholder = true), (r.dungeons[3].placeholder = false))),
      "dungeons.json",
      "[3]: DG-35: a playable dungeon cannot follow a placeholder",
    );
    // 準備中でも drops の表は要る（IT-51）
    expectIssue(withD04((r) => delete r.drops.chest.d04), "drops.json", "chest.d04: missing required field");
    expectIssue(withD04((r) => delete r.drops.boss.d04), "drops.json", "boss.d04: missing required field");
  });
});

describe("data: d03 灰の地下墓所（M12）", () => {
  const D03_MONSTERS = ["ash_shambler", "cinder_crow", "candle_mourner", "urn_bearer", "grave_sentinel", "ashcrown_lord"];
  test("data: DG-02/DG-35 d03 は準備中でない 4 階・20×20・部屋 [4,7]。最後のダンジョン（次を開かない）で、曲は dungeon3（U-3 の当面の dungeon2 は 2026-10-08 に解消）、イベント 3 つ・床の罠 3 種は既存のもの", () => {
    const d = loadGameData(rawData()).dungeons.find((x) => x.id === "d03")!;
    expect([d.placeholder, d.floors, d.width, d.height, d.rooms, d.unlock, d.onClear]).toEqual([
      undefined, 4, 20, 20, [4, 7], "d02", { unlockDungeon: null, shopLevel: 6 },
    ]);
    expect(d.song).toBe("dungeon3");
    expect(d.events).toEqual(["wounded_adventurer", "pinned_pilgrim", "abandoned_sack"]);
    expect([d.traps, d.trapsPerFloor]).toEqual([["pit", "spinner", "teleport"], [2, 4]]);
    expect(Object.keys(d.encounterTable)).toEqual(["1", "2", "3", "4"]);
    expect(Object.keys(d.groupCountWeights)).toEqual(["1", "2", "3", "4"]);
  });
  test("data: CB-03 d03 の出現表は実在の敵で、Lv は 4〜7（1F は d02 の 2〜3 階の敵を残す）。ボスは出現表に入らない。M12 の 5 種（ボスを除く）はどれかの階に出る", () => {
    const g = loadGameData(rawData());
    const d = g.dungeons.find((x) => x.id === "d03")!;
    const level = (id: string): number => g.monsters.find((m) => m.id === id)!.level;
    const all = Object.values(d.encounterTable).flat();
    for (const e of all) expect(level(e.monster), e.monster).toBeGreaterThanOrEqual(4);
    for (const e of all) expect(level(e.monster), e.monster).toBeLessThanOrEqual(7);
    expect(all.some((e) => e.monster === d.boss.monster)).toBe(false);
    expect(new Set(all.map((e) => e.monster))).toEqual(new Set([...D03_MONSTERS.slice(0, 5), "choir_wraith", "font_mire", "stone_gazer"]));
    // 1F の主力 ash_shambler・cinder_crow、4F の壁 grave_sentinel
    expect(d.encounterTable["1"]!.map((e) => [e.monster, e.weight])).toEqual([
      ["ash_shambler", 3], ["cinder_crow", 3], ["choir_wraith", 2], ["font_mire", 2], ["stone_gazer", 1],
    ]);
    expect(d.encounterTable["4"]!.map((e) => [e.monster, e.weight])).toEqual([
      ["ash_shambler", 2], ["candle_mourner", 2], ["urn_bearer", 3], ["grave_sentinel", 3],
    ]);
    expect(d.groupCountWeights).toEqual({ "1": [50, 35, 12, 3], "2": [45, 35, 15, 5], "3": [40, 35, 18, 7], "4": [40, 35, 18, 7] });
  });
  test("data: DG-31/CB-05 d03 の敵 6 種: sprite は id、Lv 5〜7、名前は 7 字以内、ボスは灰冠の墓所主（special.boss・tags boss・全耐性）。系統は undead（鴉だけ winged、飛行）", () => {
    const g = loadGameData(rawData());
    const ms = D03_MONSTERS.map((id) => g.monsters.find((m) => m.id === id)!);
    for (const m of ms) {
      expect(m.sprite, m.id).toBe(m.id);
      expect(m.level, m.id).toBeGreaterThanOrEqual(5);
      expect(m.level, m.id).toBeLessThanOrEqual(7);
      expect([...m.name].length, m.id).toBeLessThanOrEqual(7);
      expect(m.description.length, m.id).toBeGreaterThan(0);
      expect(m.tags.includes("boss"), m.id).toBe(m.special.boss === true);
    }
    expect(ms.map((m) => [m.id, m.name, m.unknownKind, m.level])).toEqual([
      ["ash_shambler", "灰まみれの骸", "undead", 5],
      ["cinder_crow", "燠火の鴉", "winged", 5],
      ["candle_mourner", "弔い蝋燭の女", "undead", 6],
      ["urn_bearer", "骨壺運び", "undead", 6],
      ["grave_sentinel", "錆びた墓守", "undead", 7],
      ["ashcrown_lord", "灰冠の墓所主", "undead", 7],
    ]);
    expect(ms.filter((m) => m.special.flying === true).map((m) => m.id)).toEqual(["cinder_crow"]);
    expect(ms.filter((m) => m.special.undead === true).map((m) => m.id)).toEqual(D03_MONSTERS.filter((id) => id !== "cinder_crow"));
    const d03 = g.dungeons.find((x) => x.id === "d03")!;
    expect(d03.boss.monster).toBe("ashcrown_lord");
    const boss = ms[5]!;
    expect(boss.special.boss).toBe(true);
    expect(boss.resist).toEqual({ sleep: true, poison: true, paralysis: true, stone: true });
    // 石化への耐性はボスだけ
    expect(ms.filter((m) => m.resist.stone === true).map((m) => m.id)).toEqual(["ashcrown_lord"]);
  });
  test("data: IT-51/CB-61 d03 の宝箱は階ごとに d03_f1〜f4、ボスは d03_boss。罠の危険度は 4 まで（重みは 4 個）", () => {
    const g = loadGameData(rawData());
    expect(g.drops.chest["d03"]).toEqual({ "1": "d03_f1", "2": "d03_f2", "3": "d03_f3", "4": "d03_f4" });
    expect(g.drops.boss["d03"]).toBe("d03_boss");
    expect(["d03_f1", "d03_f2", "d03_f3", "d03_f4", "d03_boss"].map((id) => {
      const t = g.drops.tables.find((x) => x.id === id)!;
      return [id, t.itemChance, t.rolls];
    })).toEqual([
      // M14（CB-65 / IT-51）: 宝箱の表は itemChance / rolls を持たない（個数は config.chest）
      ["d03_f1", undefined, undefined], ["d03_f2", undefined, undefined], ["d03_f3", undefined, undefined], ["d03_f4", undefined, undefined], ["d03_boss", 100, 2],
    ]);
    // M12 のベース 4 種とユニーク 2 種は d03 の 3 階以降とボスの表にだけある
    const NEW = new Set(["heavy_blade", "horn_bow", "elder_staff", "blackiron_plate", "mourner_veil", "sentinel_blade"]);
    const withNew = g.drops.tables.filter((t) => t.entries.some((e) => NEW.has("base" in e ? e.base : "unique" in e ? e.unique : ""))).map((t) => t.id);
    expect(withNew).toEqual(["d03_f3", "d03_f4", "d03_boss"]);
    const d = g.dungeons.find((x) => x.id === "d03")!;
    expect([d.chestsPerFloor, d.chestTrapMaxDanger, d.chestTrapDangerWeights]).toEqual([[1, 3], 4, [30, 30, 25, 15]]);
    expectIssue((r) => (r.dungeons[2].chestTrapDangerWeights = [30, 30, 25]), "dungeons.json", "[2].chestTrapDangerWeights: CB-61: expected 4 weights");
    expectIssue((r) => delete r.drops.chest.d03["4"], "drops.json", "chest.d03.4: missing required field");
    expectIssue((r) => (r.drops.chest.d03["5"] = "d03_f4"), "drops.json", "chest.d03.5: IT-51: floor key must be 1..4");
    expectIssue((r) => delete r.dungeons[2].encounterTable["4"], "dungeons.json", "[2].encounterTable.4: missing required field");
  });
  test("data: DG-37 enterSpeech（U-5）は任意で d03 にだけあり、strings にあるキーでプレースホルダーを持たない。無いキー・プレースホルダー付きは起動を止める", () => {
    const g = loadGameData(rawData());
    expect(g.dungeons.map((x) => [x.id, x.enterSpeech])).toEqual([
      ["d01", undefined],
      ["d02", undefined],
      ["d03", "dungeon.enterSpeech.d03"],
    ]);
    expect(g.strings["dungeon.enterSpeech.d03"]!.length).toBeGreaterThan(0);
    expectIssue((r) => (r.dungeons[2].enterSpeech = "dungeon.enterSpeech.nope"), "dungeons.json", '[2].enterSpeech: unknown strings.json key "dungeon.enterSpeech.nope"');
    expectIssue((r) => (r.dungeons[2].enterSpeech = 1), "dungeons.json", "[2].enterSpeech: expected");
    expectIssue((r) => (r.dungeons[0].enterSpeech = "dungeon.enter"), "dungeons.json", '[0].enterSpeech: DG-37: strings "dungeon.enter" must not have placeholders (found {dungeon})');
    expect(issuesOf((r) => (r.dungeons[0].enterSpeech = "dungeon.enterSpeech.d03"))).toEqual([]);
  });
});
