// rules/item-view.ts（表示層向けの装備の問い合わせ。UI-59 の品の詳細と状態の値、IT-66 の図鑑）。M7 の B10。
// 期待値はデータの値（equipment-bases / uniques / item-options、config.items と economy.sellRatio 0.5、combat.acBase 10）から手で数える。乱数は使わない。
import { describe, expect, test } from "vitest";
import { equipStats } from "../src/core/rules/equip-stats";
import { createInitialState, execute } from "../src/core/engine";
import { spellCost } from "../src/core/rules/equip-stats";
import { canLevelUp, expFor, levelUpReady } from "../src/core/rules/growth";
import { endingRecordView } from "../src/core/rules/progress";
import { bestiaryView, equipPreview, itemDetail, memberSheet, shopEquipCompare, spellInfo, uniqueBookView, weaponDamageDice } from "../src/core/rules/item-view";
import { cloneState, createItemInstance, memberById } from "../src/core/state";
import type { Character, Command, GameState } from "../src/core/types";
import { data, newGame } from "./helpers/core";
import { cursedDagger } from "./helpers/items";

const town = (): GameState => cloneState(newGame(1));
const member = (s: GameState, id: string): Character => memberById(s, id)!;

describe("UI-59/IT-11/IT-12 itemDetail（品の詳細）", () => {
  test("IT-11/IT-20/IT-34/IT-61 鑑定済みの汎用武器: 表示名・部位・Lv・希少度・性能（Lv5 の長剣はダメージ +floor(5/1) = 5。M18）・オプション（ac は −値）・売値", () => {
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
      power: { kind: "weapon", dice: "1d8", damageBonus: 5, magicPower: 0, reach: "melee", caster: false },
      damageDice: "1d8+5", // 2026-10-06（実機(M9-飛行) B3）: 表示用のダイス（定数と Lv の分を合算）の項目を足した
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

  test("IT-21/IT-22/IT-23 性能: 汎用の防具は ac − floor(Lv/2)、装飾は Lv の効果なし、術者用武器は魔法攻撃力 floor(Lv/1) でダメージ +0（M18）", () => {
    const s = town();
    const armor = createItemInstance(s, { itemId: "leather_armor", level: 6, identified: true });
    const charm = createItemInstance(s, { itemId: "charm", level: 6, identified: true });
    const staff = createItemInstance(s, { itemId: "staff", level: 5, identified: true });
    const bow = createItemInstance(s, { itemId: "short_bow", level: 3, identified: true });
    expect(itemDetail(s, data, armor)!.power).toEqual({ kind: "armor", ac: -5 }); // −2 − floor(6/2)
    expect(itemDetail(s, data, charm)!.power).toEqual({ kind: "armor", ac: 0 });
    expect(itemDetail(s, data, staff)!.power).toEqual({ kind: "weapon", dice: "1d4", damageBonus: 0, magicPower: 5, reach: "melee", caster: true });
    expect(itemDetail(s, data, bow)!.power).toEqual({ kind: "weapon", dice: "1d6", damageBonus: 3, magicPower: 0, reach: "ranged", caster: false });
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
      power: { kind: "weapon", dice: "1d6", damageBonus: 0, magicPower: 2, reach: "melee", caster: true },
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
      damageDice: null, // 2026-10-06: 新しい項目（未鑑定は null）
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

  // 2026-10-06: 実機(M9-飛行) の B3（投げナイフ Lv2 が「1d4+1+1」と出た）
  test("UI-59/IT-20 damageDice はダイスの定数と Lv の分を 1 つの定数に合算する（合計 0 は省き、負は -）。武器でなければ null", () => {
    expect(weaponDamageDice("1d4+1", 1)).toBe("1d4+2");
    expect(weaponDamageDice("1d4", 2)).toBe("1d4+2");
    expect(weaponDamageDice("1d8", 0)).toBe("1d8");
    expect(weaponDamageDice("1d4+1", -1)).toBe("1d4");
    expect(weaponDamageDice("1d4+1", -2)).toBe("1d4-1");
    expect(weaponDamageDice("2d6-1", 0)).toBe("2d6-1");
    const s = town();
    const knives = createItemInstance(s, { itemId: "throwing_knives", level: 2, identified: true });
    const armor = createItemInstance(s, { itemId: "leather_armor", level: 6, identified: true });
    expect(itemDetail(s, data, knives)).toMatchObject({ power: { kind: "weapon", dice: "1d4+1", damageBonus: 2 }, damageDice: "1d4+3" });
    expect(itemDetail(s, data, armor)!.damageDice).toBeNull();
  });
});

describe("UI-59/CH-13/CH-14/MG-33 memberSheet（状態の実効の値）", () => {
  test("CH-13/CH-14/CB-20/MG-33 実効の能力値・最大値、AC = acBase + 装備の ac（Lv とオプションを含む）、魔法攻撃力", () => {
    const s = town();
    const c1 = member(s, "c1");
    // 装備を外してから付け直す（初期装備の実体は残っても参照されないので equipStats は見ない）
    c1.equipment = { weapon: null, armor: null, shield: null, helm: null, gauntlet: null, accessory: null };
    c1.equipment.weapon = createItemInstance(s, { itemId: "staff", level: 5, identified: true }); // 魔法攻撃力 floor(5/1) = 5
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
    expect(sheet.magicPower).toBe(5);
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
    // 2 + 1 + floor(4 ÷ weaponLvPerDamage 1) = 4 + オプション 1 → 8
    expect(memberSheet(s, data, c1)).toMatchObject({ attackDice: "1d8", attackBonus: 8 });
    // 素手（combat.unarmedDice 1d2）・力 9（floor(−1 ÷ 2) = −1）・性格なし（リーダーと同じ 0）→ 1d2 と −1（最低 1 の丸めは攻撃の出目の側）
    c1.equipment.weapon = null;
    c1.stats.str = 9;
    c1.personality = null;
    expect(memberSheet(s, data, c1)).toMatchObject({ attackDice: "1d2", attackBonus: -1 });
  });

  test("CB-22/UI-59 C-2 memberSheet の attackParts: 武器ダイス・武器 Lv の分・力補正・性格恩恵・オプション damage。内訳の合計 = attackBonus", () => {
    const s = cloneState(newGame(1));
    const c1 = s.party[0]!;
    const sumOf = (p: ReturnType<typeof memberSheet>["attackParts"]): number => p.weaponBonus + p.strBonus + p.traitBonus + p.optionBonus;
    c1.stats.str = 14; // 力補正 2
    c1.personality = "reckless"; // 恩恵 damage 1
    c1.equipment.weapon = createItemInstance(s, { itemId: "long_sword", level: 4, options: [{ optionId: "damage", tier: 1, value: 1 }], identified: true });
    // 兜にもオプション damage 2（オプションは全部位の合計）
    c1.equipment.helm = createItemInstance(s, { itemId: "leather_cap", options: [{ optionId: "damage", tier: 2, value: 2 }], identified: true });
    let sheet = memberSheet(s, data, c1);
    expect(sheet.attackParts).toEqual({ weaponDice: "1d8", weaponBonus: 4, strBonus: 2, traitBonus: 1, optionBonus: 3 });
    expect(sumOf(sheet.attackParts)).toBe(sheet.attackBonus);
    expect(sheet.attackBonus).toBe(10);
    // 投げナイフ 1d4+1 Lv2: ダイスの定数 1 は weaponDice の側（内訳の合計には入らない）
    c1.equipment.helm = null;
    c1.equipment.weapon = createItemInstance(s, { itemId: "throwing_knives", level: 2, identified: true });
    sheet = memberSheet(s, data, c1);
    expect(sheet.attackParts).toEqual({ weaponDice: "1d4+1", weaponBonus: 2, strBonus: 2, traitBonus: 1, optionBonus: 0 });
    expect(sumOf(sheet.attackParts)).toBe(sheet.attackBonus);
    // 杖（術者用）は Lv の分が 0、素手・力 9・性格なしは力 −1 だけ
    c1.equipment.weapon = createItemInstance(s, { itemId: "staff", level: 5, identified: true });
    sheet = memberSheet(s, data, c1);
    expect(sheet.attackParts.weaponBonus).toBe(0);
    expect(sumOf(sheet.attackParts)).toBe(sheet.attackBonus);
    c1.equipment.weapon = null;
    c1.stats.str = 9;
    c1.personality = null;
    sheet = memberSheet(s, data, c1);
    expect(sheet.attackParts).toEqual({ weaponDice: data.config.combat.unarmedDice, weaponBonus: 0, strBonus: -1, traitBonus: 0, optionBonus: 0 });
    expect(sumOf(sheet.attackParts)).toBe(sheet.attackBonus);
  });

  // 2026-10-06（ユーザーの指示）: キャンプの状態画面の攻撃の行に出す実効値（オプションまで合算）
  test("CB-22/UI-59 memberSheet の attackDamageDice: 武器ダイスの定数と足し分（力補正 + 性格恩恵 + Lv の効果 + オプション damage）を 1 つの定数に合算", () => {
    const s = cloneState(newGame(1));
    const c1 = s.party[0]!;
    c1.stats.str = 14; // 力補正 2
    c1.personality = "reckless"; // 恩恵 damage 1
    c1.equipment.weapon = createItemInstance(s, { itemId: "throwing_knives", level: 2, options: [{ optionId: "damage", tier: 1, value: 1 }], identified: true });
    // 1d4+1 の定数 1 + 2 + 1 + Lv2 の 2 + オプション 1 = 7。足し分は 6（attackDice / attackBonus は今までどおり）
    expect(memberSheet(s, data, c1)).toMatchObject({ attackDice: "1d4+1", attackBonus: 6, attackDamageDice: "1d4+7" });
    // 品の詳細（判断 7 (a)）はオプションを足さない
    expect(itemDetail(s, data, c1.equipment.weapon)?.damageDice).toBe("1d4+3");
    c1.equipment.weapon = null;
    c1.stats.str = 10;
    c1.personality = null;
    expect(memberSheet(s, data, c1).attackDamageDice).toBe("1d2"); // 合計 0 は定数を省く
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

describe("UI-79 bestiaryView（敵の図鑑。M18）", () => {
  test("UI-79/CB-06 識別済みの敵だけを monsters.json の順で（id・名前・倒した数）。遭遇しただけ（identified 偽）・記録の無い敵は載せず、total は全種類の数", () => {
    const s = town();
    // 記録の順を monsters.json と逆にしても monsters.json の順で出る
    s.bestiary["kobold"] = { kills: 7, identified: true };
    s.bestiary["giant_spider"] = { kills: 3, identified: false }; // 遭遇しただけ
    s.bestiary["giant_rat"] = { kills: 0, identified: true }; // 噂話（TW-15）で識別しただけ（倒していない）
    const before = JSON.stringify(s);
    const v = bestiaryView(s, data);
    const name = (id: string) => data.monsters.find((m) => m.id === id)!.name;
    expect(v).toEqual({
      known: 2,
      total: data.monsters.length,
      rows: [
        { monsterId: "giant_rat", name: name("giant_rat"), unknownName: "何かの獣", kills: 0 },
        { monsterId: "kobold", name: name("kobold"), unknownName: "人の形をした影", kills: 7 },
      ],
    });
    expect(data.monsters.findIndex((m) => m.id === "giant_rat")).toBeLessThan(data.monsters.findIndex((m) => m.id === "kobold"));
    expect(JSON.stringify(s)).toBe(before); // state を変えない
    // 何も識別していなければ空（分母はそのまま）
    expect(bestiaryView(town(), data)).toEqual({ known: 0, total: data.monsters.length, rows: [] });
  });

  test("UI-79/UI-73 known は戦績の敵の図鑑（endingRecordView の bestiary）と同じ数え方: 全種類を識別すれば known = total", () => {
    const s = town();
    for (const m of data.monsters) s.bestiary[m.id] = { kills: 1, identified: true };
    const v = bestiaryView(s, data);
    expect(v.known).toBe(data.monsters.length);
    expect({ known: v.known, total: v.total }).toEqual(endingRecordView(s, data).bestiary);
    const some = town();
    some.bestiary["kobold"] = { kills: 2, identified: true };
    some.bestiary["giant_rat"] = { kills: 1, identified: false };
    const w = bestiaryView(some, data);
    expect({ known: w.known, total: w.total }).toEqual(endingRecordView(some, data).bestiary);
    expect(v.rows.map((r) => r.monsterId)).toEqual(data.monsters.map((m) => m.id));
  });

  test("UI-79/CB-05 unknownName（M19。D-7）は正体の分からないときの呼び名（unknownKind の系統の name）。全種類で系統の name と一致し、同じ系統の敵は同じ呼び名", () => {
    const s = town();
    for (const m of data.monsters) s.bestiary[m.id] = { kills: 1, identified: true };
    const v = bestiaryView(s, data);
    for (const r of v.rows) {
      const m = data.monsters.find((x) => x.id === r.monsterId)!;
      expect(r.unknownName, r.monsterId).toBe(data.unknownKinds.find((k) => k.id === m.unknownKind)!.name);
    }
    expect(v.rows.find((r) => r.monsterId === "kobold")!.unknownName).toBe("人の形をした影");
    expect(v.rows.find((r) => r.monsterId === "rotting_corpse")!.unknownName).toBe("人の形をした影");
    expect(v.rows.find((r) => r.monsterId === "giant_rat")!.unknownName).toBe("何かの獣");
  });
});

// ---------------------------------------------------------------------------
// M10: UI-67 equipPreview・UI-68 spellInfo・CH-80 memberSheet のレベルアップ可

/** party.equip / party.unequip を実際に送った後の memberSheet（equipPreview の to の鏡） */
function sheetAfter(s: GameState, cmd: Command, memberId: string) {
  const r = execute(s, cmd, data);
  expect(r.events.find((e) => e.kind === "rejected")).toBeUndefined();
  return memberSheet(r.state, data, member(r.state, memberId));
}

describe("UI-67 equipPreview（装備の差分）", () => {
  test("UI-67 武器の入れ替え: attack は長剣 1d8 系 → 短剣 1d4 系、AC・魔法攻撃力は変わらず changed 偽。値は party.equip を送った後の memberSheet と一致", () => {
    const s = town();
    const dagger = createItemInstance(s, { itemId: "dagger", identified: true });
    member(s, "c1").inventory.push(dagger);
    const before = memberSheet(s, data, member(s, "c1"));
    const p = equipPreview(s, data, "c1", "weapon", dagger)!;
    const after = sheetAfter(s, { type: "party.equip", memberId: "c1", instanceId: dagger }, "c1");
    expect(p.attack).toEqual({ from: before.attackDamageDice, to: after.attackDamageDice, changed: true, verdict: "worse" });
    expect(p.attack.from.startsWith("1d8")).toBe(true);
    expect(p.attack.to.startsWith("1d4")).toBe(true);
    expect(p.ac).toEqual({ from: before.ac, to: before.ac, changed: false, verdict: "same" });
    expect(p.magicPower).toEqual({ from: 0, to: 0, changed: false, verdict: "same" });
    expect(p.cursedWarning).toBe(false);
  });

  test("UI-67 鎧の入れ替え: 革鎧（−2）→ 鎖帷子（−4）で AC は 2 下がる（7 → 5 の形）。値は party.equip の後と一致", () => {
    const s = town();
    const mail = createItemInstance(s, { itemId: "chain_mail", identified: true });
    member(s, "c1").inventory.push(mail);
    const p = equipPreview(s, data, "c1", "armor", mail)!;
    expect(p.ac.to).toBe(p.ac.from - 2);
    expect(p.ac.changed).toBe(true);
    expect(p.ac.to).toBe(sheetAfter(s, { type: "party.equip", memberId: "c1", instanceId: mail }, "c1").ac);
    expect(p.attack.changed).toBe(false);
  });

  test("UI-67/IT-34/MG-33 外す（instanceId null）と魔法攻撃力: 杖 Lv4（floor(4/1) = 4）を外すと 4 → 0。オプション magic_power +2 の護符を着けると 0 → 2", () => {
    const s = town();
    const c5 = member(s, "c5");
    const staff = createItemInstance(s, { itemId: "staff", level: 4, identified: true });
    c5.equipment.weapon = staff;
    const off = equipPreview(s, data, "c5", "weapon", null)!;
    expect(off.magicPower).toEqual({ from: 4, to: 0, changed: true, verdict: "worse" });
    expect(off.magicPower.to).toBe(sheetAfter(s, { type: "party.unequip", memberId: "c5", slot: "weapon" }, "c5").magicPower);
    expect(off.cursedWarning).toBe(false);
    const charm = createItemInstance(s, { itemId: "charm", options: [{ optionId: "magic_power", tier: 2, value: 2 }], identified: true });
    member(s, "c1").inventory.push(charm);
    expect(equipPreview(s, data, "c1", "accessory", charm)!.magicPower).toEqual({ from: 0, to: 2, changed: true, verdict: "better" });
  });

  test("UI-67 呪いの警告は鑑定済みの呪われた品だけ（cursedWarning）。未鑑定の品は CH-76 で装備できないので null", () => {
    const s = town();
    const known = cursedDagger(s, true);
    const hidden = cursedDagger(s, false);
    member(s, "c1").inventory.push(known, hidden);
    expect(equipPreview(s, data, "c1", "weapon", known)!.cursedWarning).toBe(true);
    expect(equipPreview(s, data, "c1", "weapon", hidden)).toBeNull();
  });

  test("UI-67 checkEquip / checkUnequip が拒むとき・部位が違うとき・知らない者は null", () => {
    const s = town();
    const bow = createItemInstance(s, { itemId: "short_bow", identified: true });
    member(s, "c5").inventory.push(bow); // 魔術師は短弓を装備できない（class cannot equip）
    expect(equipPreview(s, data, "c5", "weapon", bow)).toBeNull();
    const mail = createItemInstance(s, { itemId: "chain_mail", identified: true });
    member(s, "c1").inventory.push(mail);
    expect(equipPreview(s, data, "c1", "weapon", mail)).toBeNull(); // 部位が違う
    expect(equipPreview(s, data, "c1", "helm", null)).toBeNull(); // slot empty
    expect(equipPreview(s, data, "c9", "weapon", null)).toBeNull();
    const cursedOn = cloneState(s);
    member(cursedOn, "c1").equipment.weapon = cursedDagger(cursedOn, true);
    expect(equipPreview(cursedOn, data, "c1", "weapon", null)).toBeNull(); // cursed
    expect(equipPreview(createInitialState(1, data), data, "c1", "weapon", null)).toBeNull(); // wrong screen
  });

  test("UI-67 元の state と乱数は変えない", () => {
    const s = town();
    const mail = createItemInstance(s, { itemId: "chain_mail", identified: true });
    member(s, "c1").inventory.push(mail);
    const before = JSON.stringify(s);
    equipPreview(s, data, "c1", "armor", mail);
    equipPreview(s, data, "c1", "shield", null);
    expect(JSON.stringify(s)).toBe(before);
  });
});

// M19（C-3）: TW-05 / UI-52 / UI-67 店の比較（shopEquipCompare）と差分の良し悪し（verdict）
describe("TW-05/UI-67 shopEquipCompare（店の品と今の装備の比較。M19 C-3）", () => {
  test("TW-05/UI-67 M19 C-3 長剣 Lv2 を戦士 c1（長剣 Lv0）に: 攻撃 1d8+2 → 1d8+4 で better。値は実際に買って装備したときの equipPreview と一致し、current は今の装備の名前", () => {
    const s = town();
    s.gold = 100000;
    s.progress.shopLevel = 2;
    const c = shopEquipCompare(s, data, "c1", "long_sword", 2)!;
    expect(c).toEqual({
      memberId: "c1",
      slot: "weapon",
      current: { plainName: "長剣", name: "長剣" },
      ac: { from: 7, to: 7, changed: false, verdict: "same" },
      attack: { from: "1d8+2", to: "1d8+4", changed: true, verdict: "better" },
      magicPower: { from: 0, to: 0, changed: false, verdict: "same" },
      verdict: "better",
    });
    // 鏡: 店で買った実体を装備したときの差分（UI-67 の equipPreview。party.equip の処理を当てた値）と同じ
    const r = execute(s, { type: "town.shop", action: { kind: "buy", memberId: "c1", itemId: "long_sword" } }, data);
    expect(r.events.find((e) => e.kind === "rejected")).toBeUndefined();
    const bought = member(r.state, "c1").inventory.at(-1)!;
    const p = equipPreview(r.state, data, "c1", "weapon", bought)!;
    expect({ ac: c.ac, attack: c.attack, magicPower: c.magicPower }).toEqual({ ac: p.ac, attack: p.attack, magicPower: p.magicPower });
  });

  test("TW-05/UI-67 M19 C-3 verdict: 攻撃は期待値（1d4+4 と 1d8+2 はどちらも 6.5 で same）、AC は小さいほど良い、魔法攻撃力は大きいほど良い。良くなる行と悪くなる行が両方あれば mixed", () => {
    const s = town();
    // 短剣 Lv2: 1d4+4（平均 6.5）と長剣の 1d8+2（平均 6.5）。文字列は違う（changed）が良し悪しは same
    const dagger = shopEquipCompare(s, data, "c1", "dagger", 2)!;
    expect(dagger.attack).toEqual({ from: "1d8+2", to: "1d4+4", changed: true, verdict: "same" });
    expect(dagger.verdict).toBe("same");
    // 短剣 Lv0: 1d4+2（平均 4.5）は悪くなる
    expect(shopEquipCompare(s, data, "c1", "dagger", 0)!.verdict).toBe("worse");
    // 鎖帷子（−4）は革鎧（−2）より AC が 2 下がる（7 → 5。木の盾はそのまま）→ better
    const mail = shopEquipCompare(s, data, "c1", "chain_mail", 0)!;
    expect(mail.ac).toEqual({ from: 7, to: 5, changed: true, verdict: "better" });
    expect(mail.current).toEqual({ plainName: "革鎧", name: "革鎧" });
    // 樫の杖 Lv2 を戦士に: 攻撃 1d8+2 → 1d6+2（術者用は Lv の分なし）で悪く、魔法攻撃力 0 → 3 で良い → mixed
    const oak = shopEquipCompare(s, data, "c1", "oak_staff", 2)!;
    expect([oak.attack.verdict, oak.magicPower.verdict, oak.verdict]).toEqual(["worse", "better", "mixed"]);
    // 魔術師 c5（杖 Lv0）には樫の杖 Lv2 は攻撃も魔法攻撃力も良くなる → better
    expect(shopEquipCompare(s, data, "c5", "oak_staff", 2)!.verdict).toBe("better");
  });

  test("TW-05 M19 C-3 枠が空なら current は null（革兜を兜の無い c1 に: AC 7 → 6 で better）。希少度の付いた今の装備は plainName が接頭辞 + 名前（Lv なし）、name が表示名", () => {
    const s = town();
    const cap = shopEquipCompare(s, data, "c1", "leather_cap", 0)!;
    expect(cap.current).toBeNull();
    expect(cap.slot).toBe("helm");
    expect(cap.ac).toEqual({ from: 7, to: 6, changed: true, verdict: "better" });
    member(s, "c1").equipment.weapon = createItemInstance(s, { itemId: "long_sword", level: 3, rarity: "rare", identified: true });
    expect(shopEquipCompare(s, data, "c1", "long_sword", 0)!.current).toEqual({ plainName: "希少な長剣", name: "希少な長剣 +3" });
  });

  test("TW-05 M19 C-3 職業で装備できない品・消耗品・知らない者は null。元の state と乱数は変えない", () => {
    const s = town();
    const before = JSON.stringify(s);
    expect(shopEquipCompare(s, data, "c5", "long_sword", 0)).toBeNull(); // 魔術師は長剣を装備できない
    expect(shopEquipCompare(s, data, "c1", "herb", 0)).toBeNull();
    expect(shopEquipCompare(s, data, "c9", "dagger", 0)).toBeNull();
    shopEquipCompare(s, data, "c1", "long_sword", 2);
    shopEquipCompare(s, data, "c1", "leather_cap", 0);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("UI-68 spellInfo（呪文の説明）", () => {
  test("UI-68 MP・対象・使える場面・説明は spells.json の値（mp は唱える者の消費）", () => {
    const s = town();
    const heal = data.spells.find((x) => x.id === "heal")!;
    expect(spellInfo(s, data, "c4", "heal")).toEqual({
      spellId: "heal",
      name: heal.name,
      mp: heal.mp,
      target: "ally",
      usableIn: "both",
      description: heal.description,
    });
    expect(spellInfo(s, data, "c5", "sleep_mist")).toMatchObject({ target: "enemyGroup", usableIn: "battle" });
  });

  test("UI-68/IT-40 mp は spellCost（固有スキル mpCostDown の後）。覚えていない呪文でも返す。知らない者・呪文は null", () => {
    const s = town();
    const c4 = member(s, "c4");
    const sp = data.spells.find((x) => x.id === "heal")!;
    expect(spellInfo(s, data, "c4", "heal")!.mp).toBe(spellCost(s, data, c4, sp));
    expect(spellInfo(s, data, "c1", "fire_arrow")!.spellId).toBe("fire_arrow");
    expect(spellInfo(s, data, "c9", "heal")).toBeNull();
    expect(spellInfo(s, data, "c4", "no_such_spell")).toBeNull();
  });
});

describe("CH-80 memberSheet のレベルアップ可（expNext / expToNext / canLevelUp / levelUpView）", () => {
  const fighterNext = (): number => expFor(2, data.classes.find((c) => c.id === "fighter")!, data.config);

  test("CH-80/CH-64 戦士 L1: exp が必要値の 1 手前なら残り 1・next・不可、ちょうどなら残り 0・ready、何段分あっても ready", () => {
    const need = fighterNext();
    expect(need).toBe(50); // expBase 50 × 戦士の倍率 1.0
    const at = (exp: number) => {
      const s = town();
      const c1 = member(s, "c1");
      c1.exp = exp;
      return memberSheet(s, data, c1);
    };
    expect(at(need - 1)).toMatchObject({ expNext: need, expToNext: 1, canLevelUp: false, levelUpView: "next" });
    expect(at(need)).toMatchObject({ expNext: need, expToNext: 0, canLevelUp: true, levelUpView: "ready" });
    expect(at(200)).toMatchObject({ expToNext: 0, canLevelUp: true, levelUpView: "ready" });
  });

  test("CH-80/U9 死亡・灰で exp が足りるなら blocked・不可・残り 0。足りなければ next", () => {
    const need = fighterNext();
    for (const life of ["dead", "ash"] as const) {
      const s = town();
      const c1 = member(s, "c1");
      c1.life = life;
      c1.hp = 0;
      c1.exp = need;
      expect(memberSheet(s, data, c1)).toMatchObject({ expToNext: 0, canLevelUp: false, levelUpView: "blocked" });
      c1.exp = need - 5;
      expect(memberSheet(s, data, c1)).toMatchObject({ expToNext: 5, canLevelUp: false, levelUpView: "next" });
    }
  });

  test("CH-80/CH-64 expNext は職業の倍率込みの expFor（侍 1.3 で 65）。state と乱数は変えない", () => {
    const s = town();
    const c1 = member(s, "c1");
    c1.classId = "samurai";
    const before = JSON.stringify(s);
    const sheet = memberSheet(s, data, c1);
    expect(sheet.expNext).toBe(expFor(2, data.classes.find((c) => c.id === "samurai")!, data.config));
    expect(sheet.expNext).toBe(65);
    expect(JSON.stringify(s)).toBe(before);
  });

  test("CH-80 levelUpReady は alive かつ canLevelUp（canLevelUp 自体は life を見ない）", () => {
    const s = town();
    const c1 = member(s, "c1");
    c1.exp = fighterNext();
    expect(levelUpReady(c1, data)).toBe(true);
    expect(canLevelUp(c1, data)).toBe(true);
    c1.life = "dead";
    expect(levelUpReady(c1, data)).toBe(false);
    expect(canLevelUp(c1, data)).toBe(true); // 宿のループの条件は life を見ない（呼び出し側が alive を選ぶ）
  });
});
