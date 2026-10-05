// rules/item-view.ts（表示層向けの装備の問い合わせ。UI-59 の品の詳細と状態の値、IT-66 の図鑑）。M7 の B10。
// 期待値はデータの値（equipment-bases / uniques / item-options、config.items と economy.sellRatio 0.5、combat.acBase 10）から手で数える。乱数は使わない。
import { describe, expect, test } from "vitest";
import { equipStats } from "../src/core/rules/equip-stats";
import { itemDetail, memberSheet, uniqueBookView } from "../src/core/rules/item-view";
import { cloneState, createItemInstance, memberById } from "../src/core/state";
import type { Character, GameState } from "../src/core/types";
import { data, newGame } from "./helpers/core";
import { cursedDagger } from "./helpers/items";

const town = (): GameState => cloneState(newGame(1));
const member = (s: GameState, id: string): Character => memberById(s, id)!;

describe("UI-59/IT-11/IT-12 itemDetail（品の詳細）", () => {
  test("IT-11/IT-20/IT-34/IT-61 鑑定済みの汎用武器: 表示名・部位・Lv・希少度・性能（Lv5 の長剣はダメージ +floor(5/2) = 2）・オプション（ac は −値）・売値", () => {
    const s = town();
    const id = createItemInstance(s, {
      itemId: "long_sword",
      level: 5,
      rarity: "rare",
      options: [
        { optionId: "str", tier: 2, value: 2 },
        { optionId: "ac", tier: 2, value: 1 },
      ],
      identified: true,
      foundIn: "d01",
    });
    expect(itemDetail(s, data, id)).toEqual({
      instanceId: id,
      name: "希少な長剣 +5",
      slot: "weapon",
      identified: true,
      level: 5,
      rarity: "rare",
      unique: false,
      power: { kind: "weapon", dice: "1d8", damageBonus: 2, magicPower: 0, ranged: false, caster: false },
      options: [
        { name: "力", value: 2, unit: "", bad: false },
        { name: "AC", value: -1, unit: "", bad: false },
      ],
      skill: null,
      cursed: false,
      // IT-61: floor(100 × 0.5 × (1 + 0.5 × 5)) = floor(175) = 175 + 段階 2 の 40 × 2 = 255
      sellPrice: 255,
      description: null,
    });
  });

  test("IT-21/IT-22/IT-23 性能: 汎用の防具は ac − floor(Lv/3)、装飾は Lv の効果なし、術者用武器は魔法攻撃力 floor(Lv/2) でダメージ +0", () => {
    const s = town();
    const armor = createItemInstance(s, { itemId: "leather_armor", level: 6, identified: true });
    const charm = createItemInstance(s, { itemId: "charm", level: 6, identified: true });
    const staff = createItemInstance(s, { itemId: "staff", level: 5, identified: true });
    const bow = createItemInstance(s, { itemId: "short_bow", level: 3, identified: true });
    expect(itemDetail(s, data, armor)!.power).toEqual({ kind: "armor", ac: -4 }); // −2 − floor(6/3)
    expect(itemDetail(s, data, charm)!.power).toEqual({ kind: "armor", ac: 0 });
    expect(itemDetail(s, data, staff)!.power).toEqual({ kind: "weapon", dice: "1d4", damageBonus: 0, magicPower: 2, ranged: false, caster: true });
    expect(itemDetail(s, data, bow)!.power).toEqual({ kind: "weapon", dice: "1d6", damageBonus: 1, magicPower: 0, ranged: true, caster: false });
    expect(itemDetail(s, data, armor)!.name).toBe("革鎧 +6");
    expect(itemDetail(s, data, armor)!.level).toBe(6);
  });

  test("IT-03/IT-40 鑑定済みのユニーク: ユニークの名前・Lv なし・ユニークの性能・固有スキル・説明・固定の売値（price × 0.5）", () => {
    const s = town();
    const id = createItemInstance(s, {
      itemId: "staff",
      uniqueId: "dawn_flint_staff",
      rarity: "fine",
      options: [{ optionId: "mp_max", tier: 2, value: 4 }],
      identified: true,
    });
    const d = itemDetail(s, data, id)!;
    expect(d).toMatchObject({
      name: "上質な夜明けの火打ち杖",
      slot: "weapon",
      level: null,
      rarity: "fine",
      unique: true,
      power: { kind: "weapon", dice: "1d6", damageBonus: 0, magicPower: 2, ranged: false, caster: true },
      options: [{ name: "最大MP", value: 4, unit: "", bad: false }],
      skill: { type: "mpCostDown", value: 1 },
      cursed: false,
      sellPrice: 450, // floor(900 × 0.5)
    });
    expect(d.description).toBe(data.uniques.find((u) => u.id === "dawn_flint_staff")!.description);
    const helm = createItemInstance(s, { itemId: "leather_cap", uniqueId: "alarm_bell_helm", identified: true });
    expect(itemDetail(s, data, helm)!.power).toEqual({ kind: "armor", ac: -2 });
  });

  test("IT-32/CH-73 呪いは鑑定済みなら cursed と負のオプション（bad）。未鑑定（IT-12）は名前と部位と見た目の品種の売値だけで、呪いは見せない", () => {
    const s = town();
    const known = cursedDagger(s, true);
    expect(itemDetail(s, data, known)).toMatchObject({
      name: "短剣",
      cursed: true,
      options: [{ name: "力", value: -1, unit: "", bad: true }],
      sellPrice: 7, // floor(15 × 0.5)。負のオプションは 0
    });
    const hidden = cursedDagger(s, false);
    expect(itemDetail(s, data, hidden)).toEqual({
      instanceId: hidden,
      name: "短い刃？",
      slot: "weapon",
      identified: false,
      level: null,
      rarity: null,
      unique: false,
      power: null,
      options: [],
      skill: null,
      cursed: false,
      sellPrice: 7, // 2026-10-05 から未鑑定も見た目の品種（短剣 Lv0）の売値 floor(15 × 0.5) = 7 で売れる（以前は売れないので null）
      description: null,
    });
    // 未鑑定のユニークもユニークであることを見せない（売値も見た目の短剣の 7。ユニークの floor(price × 0.5) は出さない）
    const u = createItemInstance(s, { itemId: "dagger", uniqueId: "twin_tongue_dagger", identified: false });
    expect(itemDetail(s, data, u)).toMatchObject({ name: "短い刃？", unique: false, skill: null, description: null, sellPrice: 7 });
  });

  test("UI-59 消耗品は slot null・性能なし・売値（薬草 floor(10 × 0.5) = 5）。実体が無ければ null", () => {
    const s = town();
    const herb = createItemInstance(s, { itemId: "herb", identified: true });
    expect(itemDetail(s, data, herb)).toMatchObject({ name: "薬草", slot: null, identified: true, level: null, power: null, sellPrice: 5 });
    expect(itemDetail(s, data, "i9999")).toBeNull();
  });
});

describe("UI-59/CH-13/CH-14/MG-33 memberSheet（状態の実効の値）", () => {
  test("CH-13/CH-14/CB-20/MG-33 実効の能力値・最大値、AC = acBase + 装備の ac（Lv とオプションを含む）、魔法攻撃力", () => {
    const s = town();
    const c1 = member(s, "c1");
    // 装備を外してから付け直す（初期装備の実体は残っても参照されないので equipStats は見ない）
    c1.equipment = { weapon: null, armor: null, shield: null, helm: null, gauntlet: null, accessory: null };
    c1.equipment.weapon = createItemInstance(s, { itemId: "staff", level: 5, identified: true }); // 魔法攻撃力 floor(5/2) = 2
    c1.equipment.armor = createItemInstance(s, { itemId: "leather_armor", level: 3, identified: true }); // −2 − 1 = −3
    c1.equipment.helm = createItemInstance(s, { itemId: "leather_cap", uniqueId: "alarm_bell_helm", identified: true }); // −2
    c1.equipment.accessory = createItemInstance(s, {
      itemId: "charm",
      options: [
        { optionId: "str", tier: 2, value: 2 },
        { optionId: "hp_max", tier: 2, value: 6 },
        { optionId: "san_max", tier: 2, value: 10 },
        { optionId: "ac", tier: 1, value: 1 },
      ],
      identified: true,
    });
    const sheet = memberSheet(s, data, c1);
    // アルド: 力 14 → 16、hpMax 15 → 21、sanMax 100 → 110。AC = 10 − 3 − 2 + 0 − 1 = 4
    expect(sheet.stats.str).toBe(c1.stats.str + 2);
    expect(sheet.stats.iq).toBe(c1.stats.iq);
    expect(sheet.hpMax).toBe(c1.hpMax + 6);
    expect(sheet.mpMax).toBe(c1.mpMax);
    expect(sheet.sanMax).toBe(c1.sanMax + 10);
    expect(sheet.ac).toBe(data.config.combat.acBase - 3 - 2 - 1);
    expect(sheet.ac).toBe(4);
    expect(sheet.magicPower).toBe(2);
    // equipStats と同じ値を写している
    const es = equipStats(s, data, c1);
    expect(sheet).toMatchObject({ stats: es.stats, hpMax: es.hpMax, mpMax: es.mpMax, sanMax: es.sanMax, magicPower: es.magicPower });
  });

  test("CB-22/UI-59 memberSheet の attackDice / attackBonus: 武器ダイスと、力補正 + 性格恩恵 damage + Lv の効果 + オプション damage（戦闘と同じ式）", () => {
    const s = cloneState(newGame(1));
    const c1 = s.party[0]!;
    c1.stats.str = 14; // 力補正 floor((14 − 10) / 2) = 2
    c1.personality = "reckless"; // EV-42: 無鉄砲の benefits.damage = 1
    c1.equipment.weapon = createItemInstance(s, { itemId: "long_sword", level: 4, options: [{ optionId: "damage", tier: 1, value: 1 }], identified: true });
    // 2 + 1 + floor(4 ÷ weaponLvPerDamage 2) = 2 + オプション 1 → 6
    expect(memberSheet(s, data, c1)).toMatchObject({ attackDice: "1d8", attackBonus: 6 });
    // 素手（combat.unarmedDice 1d2）・力 9（floor(−1 ÷ 2) = −1）・性格なし（リーダーと同じ 0）→ 1d2 と −1（最低 1 の丸めは攻撃の出目の側）
    c1.equipment.weapon = null;
    c1.stats.str = 9;
    c1.personality = null;
    expect(memberSheet(s, data, c1)).toMatchObject({ attackDice: "1d2", attackBonus: -1 });
  });
});

describe("IT-66 uniqueBookView（図鑑）", () => {
  test("IT-66 uniques.json の順で全種類。記録のあるユニークは名前・入手ダンジョンの名前・最良の希少度、無いものは known false で null", () => {
    const s = town();
    s.uniqueBook["dawn_flint_staff"] = { foundIn: "d01", bestRarity: "rare" };
    s.uniqueBook["alarm_bell_helm"] = { foundIn: null, bestRarity: "normal" };
    const rows = uniqueBookView(s, data);
    expect(rows.map((r) => r.uniqueId)).toEqual(data.uniques.map((u) => u.id));
    const d01 = data.dungeons.find((d) => d.id === "d01")!.name;
    expect(rows.find((r) => r.uniqueId === "dawn_flint_staff")).toEqual({
      uniqueId: "dawn_flint_staff",
      known: true,
      name: "夜明けの火打ち杖",
      foundIn: d01,
      bestRarity: "rare",
    });
    expect(rows.find((r) => r.uniqueId === "alarm_bell_helm")).toEqual({ uniqueId: "alarm_bell_helm", known: true, name: "早鐘の兜", foundIn: null, bestRarity: "normal" });
    expect(rows.find((r) => r.uniqueId === "twin_tongue_dagger")).toEqual({ uniqueId: "twin_tongue_dagger", known: false, name: null, foundIn: null, bestRarity: null });
    expect(rows.filter((r) => r.known)).toHaveLength(2);
  });
});
