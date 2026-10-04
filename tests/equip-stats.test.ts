// rules/equip-stats.ts（IT-34 / IT-35 の実効の値）と、それを読むルール（CH-13 / CH-14、IT-20〜24、CB-05 / 11 / 13 / 20〜22 / 30 / 31 / 42 / 51、
// MG-33、TW-02 / 04 / 07、MG-22、CH-65、EV-20）のテスト。M7 の B3。
// 期待値は prototypeParty の値（アルド 力 14・生命力 12・hpMax 15、ドナ 信仰心 15、エル 知恵 16 など）から手で数え、乱数は鏡の rng で数える。
import { describe, expect, test } from "vitest";
import type { EquipSlot } from "../src/core/data";
import { execute } from "../src/core/engine";
import { chance, cloneRng, createRng, randInt, rollDice, rollDie, type RngState } from "../src/core/rng";
import {
  allyAc,
  canStrike,
  hitPercent,
  identifyPercent,
  lowestHpRatioAlly,
  partyGoldLuck,
  withGoldLuck,
} from "../src/core/rules/combat-calc";
import { equipStats, spellCost } from "../src/core/rules/equip-stats";
import { battleMenu, startBattle } from "../src/core/rules/combat";
import { campMenu } from "../src/core/rules/camp";
import { pickStopper } from "../src/core/rules/events";
import { levelUpOnce, rollHpGain, vitBonus } from "../src/core/rules/growth";
import { learnRate } from "../src/core/rules/learning";
import { loseSan, restoreSan, sanCapOf, sanLossAmount } from "../src/core/rules/san";
import { resurrectRate, rollResurrect } from "../src/core/rules/town";
import { classOf, cloneState, createItemInstance, makeContext, memberById, spellOf, type ItemInstanceSpec } from "../src/core/state";
import type { BattleAction, Character, Command, GameEvent, GameState, ItemOptionRoll } from "../src/core/types";
import { ALWAYS_HIT, allInputs, dataWith, dived, eventsOf, exec, withBattle, type GroupSpec } from "./helpers/battle";
import { data, expectStateInvariants, loadFreshData, newGame } from "./helpers/core";
import { dataWithRate, findSituation } from "./helpers/dungeon";

const cfg = data.config;
const RESOLVE: Command = { type: "battle.resolve" };
const DEF: BattleAction = { type: "defend" };
const member = (s: GameState, id: string): Character => memberById(s, id)!;
const opt = (optionId: string, value: number, tier: 1 | 2 | 3 = 1): ItemOptionRoll => ({ optionId, tier, value });
const rolls = (m: RngState, n: number): number[] => Array.from({ length: n }, () => rollDie(m, 10));

/** memberId の slot に新しい実体を装備させる（元の品の実体は消す）。実体の id を返す */
function equipNew(s: GameState, memberId: string, slot: EquipSlot, spec: ItemInstanceSpec): string {
  const ch = member(s, memberId);
  const old = ch.equipment[slot];
  if (old !== null) delete s.items[old];
  const id = createItemInstance(s, spec);
  ch.equipment[slot] = id;
  return id;
}

/** memberId の装備を全部外して実体も消す（所持品はそのまま） */
function bare(s: GameState, memberId: string): void {
  const ch = member(s, memberId);
  for (const slot of Object.keys(ch.equipment) as EquipSlot[]) {
    const id = ch.equipment[slot];
    if (id !== null) delete s.items[id];
    ch.equipment[slot] = null;
  }
}

describe("IT-20〜23 レベルの効果（equipStats）", () => {
  test("IT-20 汎用の武器（長剣）のダメージ +floor(Lv ÷ 2): Lv 0/1/2/3/5/6 → 0/0/1/1/2/3。ダイスはベースの 1d8、魔法攻撃力は 0", () => {
    const got = [0, 1, 2, 3, 5, 6].map((level) => {
      const s = newGame(1);
      equipNew(s, "c1", "weapon", { itemId: "long_sword", identified: true, level });
      const es = equipStats(s, data, member(s, "c1"));
      return [es.damageBonus, es.magicPower, es.weaponDice];
    });
    expect(got).toEqual([
      [0, 0, "1d8"],
      [0, 0, "1d8"],
      [1, 0, "1d8"],
      [1, 0, "1d8"],
      [2, 0, "1d8"],
      [3, 0, "1d8"],
    ]);
  });

  test("IT-22 術者用武器（杖）の魔法攻撃力 +floor(Lv ÷ 2): Lv 0/1/2/3/5 → 0/0/1/1/2。ダメージは増えない（damageBonus 0）", () => {
    const got = [0, 1, 2, 3, 5].map((level) => {
      const s = newGame(1);
      equipNew(s, "c5", "weapon", { itemId: "staff", identified: true, level });
      const es = equipStats(s, data, member(s, "c5"));
      return [es.magicPower, es.damageBonus];
    });
    expect(got).toEqual([
      [0, 0],
      [0, 0],
      [1, 0],
      [1, 0],
      [2, 0],
    ]);
  });

  test("IT-21 防具・盾・兜・小手の AC −floor(Lv ÷ 3): 革鎧（−2）の Lv 0/2/3/5/6 → −2/−2/−3/−3/−4。IT-23 装飾（護符 0）は Lv 9 でも 0", () => {
    const acOf = (slot: EquipSlot, itemId: string, level: number): number => {
      const s = newGame(1);
      bare(s, "c1");
      equipNew(s, "c1", slot, { itemId, identified: true, level });
      return equipStats(s, data, member(s, "c1")).acEquip;
    };
    expect([0, 2, 3, 5, 6].map((lv) => acOf("armor", "leather_armor", lv))).toEqual([-2, -2, -3, -3, -4]);
    expect(acOf("shield", "wooden_shield", 3)).toBe(-2);
    expect(acOf("helm", "leather_cap", 6)).toBe(-3);
    expect(acOf("gauntlet", "leather_gloves", 9)).toBe(-4);
    expect(acOf("accessory", "charm", 9)).toBe(0);
  });

  test("IT-03 ユニーク: ダイス・AC・魔法攻撃力はユニークの値で、level を持たせてもレベルの効果は無い", () => {
    const s = newGame(1);
    bare(s, "c5");
    equipNew(s, "c5", "weapon", { itemId: "staff", uniqueId: "dawn_flint_staff", identified: true, level: 6 });
    equipNew(s, "c5", "helm", { itemId: "leather_cap", uniqueId: "alarm_bell_helm", identified: true, level: 6 });
    const es = equipStats(s, data, member(s, "c5"));
    expect([es.weaponDice, es.magicPower, es.damageBonus, es.acEquip]).toEqual(["1d6", 2, 0, -2]);
    // ユニークの長剣（影法師の剣）もダイスはユニークの damage
    const s2 = newGame(1);
    equipNew(s2, "c1", "weapon", { itemId: "long_sword", uniqueId: "shadowfolk_sword", identified: true, level: 4 });
    expect([equipStats(s2, data, member(s2, "c1")).weaponDice, equipStats(s2, data, member(s2, "c1")).damageBonus]).toEqual(["1d8", 0]);
  });

  test("CB-22 素手（武器なし）のダイスは combat.unarmedDice、ranged は偽", () => {
    const s = newGame(1);
    bare(s, "c1");
    const es = equipStats(s, data, member(s, "c1"));
    expect([es.weaponDice, es.ranged, es.acEquip]).toEqual([cfg.combat.unarmedDice, false, 0]);
  });
});

describe("IT-34 オプションと CH-13 / CH-14 の実効の値", () => {
  test("IT-34 各オプションを全部位の分だけ足す（武器と鎧に分けても合計）", () => {
    const s = newGame(1);
    bare(s, "c1");
    equipNew(s, "c1", "weapon", {
      itemId: "long_sword",
      identified: true,
      options: [opt("str", 2), opt("hp_max", 6), opt("hit", 5), opt("damage", 1), opt("initiative", 2), opt("resist_poison", 10)],
    });
    equipNew(s, "c1", "armor", {
      itemId: "leather_armor",
      identified: true,
      options: [opt("str", 1), opt("agi", 3), opt("mp_max", 2), opt("san_max", 10), opt("ac", 1), opt("fear_loss", 20)],
    });
    equipNew(s, "c1", "accessory", {
      itemId: "charm",
      identified: true,
      options: [opt("trap_detect", 15), opt("identify_rate", 10), opt("gold_luck", 4), opt("resist_poison", 20), opt("resist_sleep", 30)],
    });
    const c1 = member(s, "c1");
    const es = equipStats(s, data, c1);
    expect(es.stats).toEqual({ str: 14 + 3, iq: 8, pie: 6, vit: 12, agi: 9 + 3, luk: 9 });
    // CH-14: c1 は戦士で素の mpMax が 0 なので、mp_max +2 は足さず 0 のまま（足し合わせは下の CH-14 のテストの魔術師で見る）
    expect(c1.mpMax).toBe(0);
    expect([es.hpMax, es.mpMax, es.sanMax]).toEqual([c1.hpMax + 6, 0, c1.sanMax + 10]);
    expect(es.acEquip).toBe(-2 - 1); // 革鎧 −2、オプション ac 1（AC を下げる量）
    expect([es.hit, es.damageBonus, es.initiative, es.fearLossPct, es.trapDetect, es.identifyRate, es.goldLuck]).toEqual([5, 1, 2, 20, 15, 10, 4]);
    expect(es.statusResist).toEqual({ poison: 30, paralysis: 0, sleep: 30, stone: 0 });
    // 素の値（保存する値）は変わらない
    expect(c1.stats.str).toBe(14);
  });

  test("CH-13 実効の能力値は 18 を超えてよい。IT-34 未鑑定でも効き、所持品（inventory）の品は効かない", () => {
    const s = newGame(1);
    equipNew(s, "c1", "accessory", { itemId: "charm", identified: false, options: [opt("str", 6)] });
    member(s, "c1").inventory.push(createItemInstance(s, { itemId: "charm", identified: true, options: [opt("str", 3)] }));
    expect(equipStats(s, data, member(s, "c1")).stats.str).toBe(20);
    expectStateInvariants(s);
  });

  test("IT-34 / CH-13 / CH-14 負のオプション: 能力値・hpMax は 1 未満にしない、sanMax は 0 未満にしない。mpMax は素が 0 なら 0、1 以上なら 1 で止める。割合の合計は負のまま", () => {
    const s = newGame(1);
    const neg = [opt("str", -30), opt("hp_max", -100), opt("mp_max", -100), opt("san_max", -200), opt("hit", -15), opt("gold_luck", -6)];
    equipNew(s, "c1", "accessory", { itemId: "charm", identified: true, options: neg });
    equipNew(s, "c5", "accessory", { itemId: "charm", identified: true, options: neg });
    const a = equipStats(s, data, member(s, "c1"));
    expect(member(s, "c1").mpMax).toBe(0); // 戦士
    expect([a.stats.str, a.hpMax, a.mpMax, a.sanMax, a.hit, a.goldLuck]).toEqual([1, 1, 0, 0, -15, -6]);
    expect(member(s, "c5").mpMax).toBeGreaterThan(0); // 魔術師
    expect(equipStats(s, data, member(s, "c5")).mpMax).toBe(1);
  });

  test("CH-14 素の mpMax が 0（戦士 c1）なら、mp_max の正のオプション（+6）でも実効の mpMax は 0。素が 1 以上（魔術師 c5）なら +6 が足される", () => {
    const s = newGame(1);
    equipNew(s, "c1", "accessory", { itemId: "charm", identified: true, options: [opt("mp_max", 6, 3)] });
    equipNew(s, "c5", "accessory", { itemId: "charm", identified: true, options: [opt("mp_max", 6, 3)] });
    expect(member(s, "c1").mpMax).toBe(0); // 戦士
    expect(equipStats(s, data, member(s, "c1")).mpMax).toBe(0);
    const base5 = member(s, "c5").mpMax;
    expect(base5).toBeGreaterThan(0); // 魔術師
    expect(equipStats(s, data, member(s, "c5")).mpMax).toBe(base5 + 6);
  });

  test("CH-14 / TW-15 sanCapOf は実効の sanMax。TW-02 restoreSan はそこまで戻す", () => {
    const s = newGame(1);
    equipNew(s, "c1", "accessory", { itemId: "charm", identified: true, options: [opt("san_max", 10)] });
    expect(sanCapOf(s, data, member(s, "c1"))).toBe(110);
    member(s, "c1").san = 50;
    const ctx = makeContext(s, data);
    restoreSan(ctx, member(s, "c1"));
    expect(member(s, "c1").san).toBe(110);
    expect(ctx.events).toEqual([{ kind: "sanChanged", id: "c1", delta: 60, san: 110 }]);
  });

  test("CH-14 装備を外して実効の最大値が下がったら hp / mp / san を止める（hpChanged / mpChanged / sanChanged）。付けて増えたときは変えない", () => {
    const s = newGame(1);
    const c5 = member(s, "c5");
    const armor = createItemInstance(s, { itemId: "leather_armor", identified: true, options: [opt("hp_max", 6), opt("mp_max", 4), opt("san_max", 10)] });
    c5.inventory.push(armor);
    const hp = c5.hpMax;
    const mp = c5.mpMax;
    // 付けても現在値は変わらない
    const e1 = execute(s, { type: "party.equip", memberId: "c5", instanceId: armor }, data);
    expect(e1.events).toEqual([{ kind: "message", key: "camp.equipped", params: { name: "エル", item: "革鎧" } }]);
    expect([member(e1.state, "c5").hp, member(e1.state, "c5").mp, member(e1.state, "c5").san]).toEqual([hp, mp, 100]);
    // 最大値まで満たしてから外す
    const full = cloneState(e1.state);
    Object.assign(member(full, "c5"), { hp: hp + 6, mp: mp + 4, san: 110 });
    const e2 = execute(full, { type: "party.unequip", memberId: "c5", slot: "armor" }, data);
    expect(e2.events).toEqual([
      { kind: "message", key: "camp.unequipped", params: { name: "エル", item: "革鎧" } },
      { kind: "hpChanged", id: "c5", delta: -6, hp },
      { kind: "mpChanged", id: "c5", delta: -4, mp },
      { kind: "sanChanged", id: "c5", delta: -10, san: 100 },
    ]);
    expectStateInvariants(e2.state);
    // 宿の士気（個室 sanOver 10）の間は sanCap + 10 まで残す
    const morale = cloneState(full);
    morale.morale = { rankId: "good" };
    member(morale, "c5").san = 120;
    const e3 = execute(morale, { type: "party.unequip", memberId: "c5", slot: "armor" }, data);
    expect(member(e3.state, "c5").san).toBe(110);
  });

  test("TW-04 / CH-14 宿は実効の hpMax まで HP を、実効の mpMax まで MP を戻す", () => {
    const s = newGame(1);
    equipNew(s, "c5", "accessory", { itemId: "charm", identified: true, options: [opt("hp_max", 3), opt("mp_max", 2)] });
    const c5 = member(s, "c5");
    const r = execute(s, { type: "town.inn", rank: 1 }, data);
    expect([member(r.state, "c5").hp, member(r.state, "c5").mp]).toEqual([c5.hpMax + 3, c5.mpMax + 2]);
    expect(r.events).toContainEqual({ kind: "hpChanged", id: "c5", delta: 3, hp: c5.hpMax + 3 });
    expect(r.events).toContainEqual({ kind: "mpChanged", id: "c5", delta: 2, mp: c5.mpMax + 2 });
  });
});

describe("CB-20 / CB-21 / IT-24 AC と命中", () => {
  test("CB-20/IT-21/IT-34 allyAc = 10 + 装備（革鎧 Lv3 で −3、木の盾 −1）− オプション ac 1 = 5", () => {
    const s = newGame(1);
    equipNew(s, "c1", "armor", { itemId: "leather_armor", identified: true, level: 3 });
    equipNew(s, "c1", "accessory", { itemId: "charm", identified: true, options: [opt("ac", 1)] });
    expect(allyAc(s, data, member(s, "c1"))).toBe(10 - 3 - 1 - 1);
  });

  test("IT-24/CB-21 AC の下限は無い: AC −15 の対象への命中率は 20 + 5 − 60 = −35 → hitMin 5", () => {
    const s = withBattle(dived(1), [{ monsterId: "giant_rat", hps: [3] }]);
    s.battle!.acBonus["c1"] = -22; // 7 − 22 = −15（旧 acMin では −10 で止まっていた）
    expect(allyAc(s, data, member(s, "c1"))).toBe(-15);
    expect(hitPercent(cfg, 1, -15, false)).toBe(cfg.combat.hitMin);
    expect(hitPercent(cfg, 1, -10, false)).toBe(cfg.combat.hitMin); // −15 → 5
  });

  test("CB-21/IT-34 hitPercent の bonus（オプション hit）は clamp の内側: 61 + 10 = 71、−15 + 15 = 0 → 5、91 + 10 → 95", () => {
    expect(hitPercent(cfg, 1, 9, false, 10)).toBe(71);
    expect(hitPercent(cfg, 1, -10, false, 15)).toBe(5);
    expect(hitPercent(cfg, 1, 9, true, 10)).toBe(95);
    expect(hitPercent(cfg, 1, 9, false, -100)).toBe(5);
  });

  test("CB-13/14 canStrike: 後衛（ドナ c4）は杖では打てず、短弓（ranged）を持たせると打てる", () => {
    const s = withBattle(dived(1), [{ monsterId: "giant_rat", hps: [3] }]);
    expect(canStrike(s, data, member(s, "c4"))).toBe(false);
    equipNew(s, "c4", "weapon", { itemId: "short_bow", identified: true });
    expect(canStrike(s, data, member(s, "c4"))).toBe(true);
  });
});

/** 麻痺した大ネズミ 1 体（鑑定済み）と、アルドだけが攻撃し他は防御の戦闘 */
function solo(seed: number, hps = [50], mut?: (s: GameState) => void): GameState {
  const s0 = dived(seed);
  mut?.(s0);
  const groups: GroupSpec[] = [{ monsterId: "giant_rat", hps, status: hps.map(() => ["paralysis" as const]) }];
  const s = withBattle(s0, groups, { identified: ["giant_rat"], inputs: allInputs(s0, DEF) });
  s.battle!.inputs["c1"] = { type: "attack", group: 0 };
  return s;
}

describe("戦闘の読み替え（CB-11 / 21 / 22 / 30 / 31 / 05 / 42 / 51）", () => {
  test("CB-22/IT-20/IT-34 アルドの攻撃: 長剣 Lv4（+2）とオプション damage +1 で 1d8 + 力補正 2 + 3（鏡の rng。initiative のオプションは乱数を変えない）", () => {
    const d = dataWith({ combat: ALWAYS_HIT });
    for (let seed = 1; seed <= 6; seed++) {
      const s = solo(seed, [50], (x) =>
        equipNew(x, "c1", "weapon", { itemId: "long_sword", identified: true, level: 4, options: [opt("damage", 1), opt("initiative", 3)] }),
      );
      const m = cloneRng(s.rng);
      rolls(m, 6); // 味方 6 人の initiative（麻痺のネズミは振らない）
      chance(m, 100);
      const dmg = rollDice(m, "1d8").total + 2 + 2 + 1;
      const r = exec(s, RESOLVE, d);
      expect(eventsOf(r.events, "attack")).toEqual([{ kind: "attack", actorId: "c1", targetId: "e0-0", hit: true, damage: dmg }]);
      expect(r.state.rng).toEqual(m);
    }
  });

  test("CB-22/CH-13 力のオプションは力補正に効く（力 14 + 4 = 18 で補正 4）", () => {
    const d = dataWith({ combat: ALWAYS_HIT });
    const s = solo(3, [50], (x) => equipNew(x, "c1", "accessory", { itemId: "charm", identified: true, options: [opt("str", 4)] }));
    const m = cloneRng(s.rng);
    rolls(m, 6);
    chance(m, 100);
    const dmg = rollDice(m, "1d8").total + 4;
    expect(eventsOf(exec(s, RESOLVE, d).events, "attack")[0]!.damage).toBe(dmg);
  });

  test("CB-21/IT-34 オプション hit は命中率に足す: 命中率 = 出目 − 1 なら外れ、hit +1 なら当たる（鏡の rng）", () => {
    let checked = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const s = solo(seed);
      const m = cloneRng(s.rng);
      rolls(m, 6);
      const r = randInt(m, 1, 100);
      if (r === 1) continue;
      // 命中率 = hitBase + 5×1 + 4×9 = r − 1
      const d = dataWith({ combat: { hitMin: 0, hitMax: 100, hitBase: r - 42 } });
      expect(eventsOf(exec(s, RESOLVE, d).events, "attack")[0]!.hit).toBe(false);
      const s2 = cloneState(s);
      equipNew(s2, "c1", "accessory", { itemId: "charm", identified: true, options: [opt("hit", 1)] });
      expect(eventsOf(exec(s2, RESOLVE, d).events, "attack")[0]!.hit).toBe(true);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  test("CB-11/CH-13/IT-34 initiative = 実効の agi + 1d10 + 性格 + オプション initiative: アルド（agi 9）に agi +20 と initiative +20 を付けると必ず先に動く", () => {
    // 大ネズミ（agi 9、麻痺していない）より先に、味方の中でも最初に動く
    const s0 = dived(2);
    equipNew(s0, "c1", "accessory", { itemId: "charm", identified: true, options: [opt("agi", 20), opt("initiative", 20)] });
    const s = withBattle(s0, [{ monsterId: "giant_rat", hps: [50] }], { identified: ["giant_rat"], inputs: allInputs(s0, DEF) });
    s.battle!.inputs["c1"] = { type: "attack", group: 0 };
    const r = exec(s, RESOLVE, dataWith({ combat: ALWAYS_HIT }));
    const first = r.events.find((e): e is Extract<GameEvent, { kind: "message" }> => e.kind === "message" && (e.key === "battle.attackDeclare" || e.key === "battle.defend"));
    expect(first?.params).toEqual({ actor: "アルド" });
  });

  test("CB-30/IT-34 状態異常の付与率から statusResist を引き、luk は実効の値: 大蜘蛛の毒 30% は luk 9 で 32、luk +5 で 22、resist_poison 100 なら付かない（乱数の消費は同じ）", () => {
    const d = dataWith({ combat: ALWAYS_HIT });
    const spider = (seed: number, options: ItemOptionRoll[]): GameState => {
      const s0 = dived(seed);
      equipNew(s0, "c1", "accessory", { itemId: "charm", identified: true, options });
      for (const id of ["c2", "c3"]) member(s0, id).status = ["stone"]; // 対象をアルドに絞る
      return withBattle(s0, [{ monsterId: "giant_spider", hps: [80] }], { identified: ["giant_spider"], inputs: allInputs(s0, DEF) });
    };
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const m = cloneRng(spider(seed, []).rng);
      rolls(m, 5); // 味方 4 人（石化の 2 人は行動しない）+ 大蜘蛛
      randInt(m, 0, 0);
      chance(m, 100);
      rollDice(m, "1d4");
      const roll = randInt(m, 1, 100);
      const luk = exec(spider(seed, [opt("luk", 5)]), RESOLVE, d);
      expect(member(luk.state, "c1").status.includes("poison")).toBe(roll <= 30 - (14 - 10) * 2);
      expect(luk.state.rng).toEqual(m);
      const resist = exec(spider(seed, [opt("resist_poison", 100)]), RESOLVE, d);
      expect(member(resist.state, "c1").status).toEqual([]);
      expect(resist.state.rng).toEqual(m);
      seen.add(`${roll <= 22}`);
    }
    expect(seen).toEqual(new Set(["true", "false"]));
  });

  test("CB-31/CH-54/IT-34 fear の SAN 減少に (1 − fearLoss ÷ 100) を掛け、最後に 1 回切り捨て（fear 以外のタグには効かない。倍率は 0 未満にしない）", () => {
    expect(sanLossAmount(10, null, ["fear"], 30)).toBe(7);
    expect(sanLossAmount(10, null, ["trap"], 30)).toBe(10);
    expect(sanLossAmount(10, null, ["fear"], 150)).toBe(0);
    expect(sanLossAmount(10, null, ["fear"], -50)).toBe(15);
    const reckless = data.personalities.find((p) => p.id === "reckless")!;
    expect(sanLossAmount(10, reckless, ["fear"], 30)).toBe(3); // 10 × 0.5 × 0.7 = 3.5 → 3
    // loseSan は装備者の fearLoss を読む（無鉄砲のキリ c3）
    const s = newGame(1);
    equipNew(s, "c3", "accessory", { itemId: "charm", identified: true, options: [opt("fear_loss", 30)] });
    const ctx = makeContext(s, data);
    expect(loseSan(ctx, member(s, "c3"), 10, ["fear"]).delta).toBe(-3);
    expect(loseSan(ctx, member(s, "c1"), 10, ["fear"]).delta).toBe(-10);
  });

  test("CB-05/IT-34 ラウンド終了の鑑定率に行動可能な味方の identifyRate を足す（エル iq 16 で 21、アルドに +10 で 31、アルドが麻痺なら 21）。iq も実効の値", () => {
    const s = withBattle(dived(1), [{ monsterId: "giant_rat", hps: [3] }]);
    expect(identifyPercent(s, data)).toBe(21);
    equipNew(s, "c1", "accessory", { itemId: "charm", identified: true, options: [opt("identify_rate", 10)] });
    expect(identifyPercent(s, data)).toBe(31);
    member(s, "c1").status = ["paralysis"];
    expect(identifyPercent(s, data)).toBe(21);
    equipNew(s, "c5", "accessory", { itemId: "charm", identified: true, options: [opt("iq", 2)] });
    expect(identifyPercent(s, data)).toBe(15 + 8);
  });

  test("CB-42/CH-14 lowestHpRatioAlly は実効の hpMax 比（ベルク 8/16 と ドナ 6/12 は同率でベルク、ドナに hpMax +6 で 6/18 のドナ）", () => {
    const s = withBattle(dived(1), [{ monsterId: "giant_rat", hps: [3] }]);
    member(s, "c2").hp = 8;
    member(s, "c4").hp = 6;
    expect(lowestHpRatioAlly(s, data)!.id).toBe("c2");
    equipNew(s, "c4", "accessory", { itemId: "charm", identified: true, options: [opt("hp_max", 6)] });
    expect(lowestHpRatioAlly(s, data)!.id).toBe("c4");
  });

  test("CB-51/IT-34 金運: withGoldLuck = floor(金 × (100 + 合計) ÷ 100)（0 未満にしない）。partyGoldLuck は行動可能な者の合計", () => {
    expect([withGoldLuck(37, 6), withGoldLuck(37, 0), withGoldLuck(10, -200), withGoldLuck(0, 50)]).toEqual([39, 37, 0, 0]);
    const s = withBattle(dived(1), [{ monsterId: "giant_rat", hps: [3] }]);
    equipNew(s, "c1", "accessory", { itemId: "charm", identified: true, options: [opt("gold_luck", 4)] });
    equipNew(s, "c2", "accessory", { itemId: "charm", identified: true, options: [opt("gold_luck", 6)] });
    expect(partyGoldLuck(s, data)).toBe(10);
    member(s, "c2").status = ["sleep"];
    expect(partyGoldLuck(s, data)).toBe(4);
  });

  test("CB-51/IT-34 勝利の金は金運の合計 % だけ増える（同じシードで金運 50 なら floor(金 × 1.5)。乱数の消費は同じ）", () => {
    const d = dataWith({ combat: ALWAYS_HIT });
    let checked = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const plain = exec(solo(seed, [1]), RESOLVE, d);
      const msg = plain.events.find((e): e is Extract<GameEvent, { kind: "message" }> => e.kind === "message" && e.key === "battle.gold");
      if (msg === undefined) continue; // 金 0 の勝利は語りが無い
      const gold = msg.params!["gold"] as number;
      const lucky = exec(
        solo(seed, [1], (x) => equipNew(x, "c1", "accessory", { itemId: "charm", identified: true, options: [opt("gold_luck", 50)] })),
        RESOLVE,
        d,
      );
      expect(lucky.events).toContainEqual({ kind: "message", key: "battle.gold", params: { gold: Math.floor((gold * 150) / 100) } });
      expect(lucky.state.gold - plain.state.gold).toBe(Math.floor((gold * 150) / 100) - gold);
      expect(lucky.state.rng).toEqual(plain.state.rng);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe("MG-33 魔法攻撃力", () => {
  test("MG-33 戦闘の damage の呪文: エルの杖 Lv4（魔法攻撃力 2）で出目 + 2（同じシードの Lv0 との差。乱数の消費は同じ）", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const at = (level: number): ReturnType<typeof exec> => {
        const s0 = dived(seed);
        equipNew(s0, "c5", "weapon", { itemId: "staff", identified: true, level });
        const s = withBattle(s0, [{ monsterId: "giant_rat", hps: [50], status: [["paralysis"]] }], {
          identified: ["giant_rat"],
          inputs: allInputs(s0, DEF),
        });
        s.battle!.inputs["c5"] = { type: "cast", spellId: "fire_arrow", target: { side: "enemy", group: 0 } };
        return exec(s, RESOLVE);
      };
      const dmgOf = (r: ReturnType<typeof exec>): number => eventsOf(r.events, "hpChanged").find((e) => e.id === "e0-0")!.delta;
      const lv0 = at(0);
      const lv4 = at(4);
      expect(dmgOf(lv4)).toBe(dmgOf(lv0) - 2);
      expect(lv4.state.rng).toEqual(lv0.state.rng);
    }
  });

  test("MG-33 戦闘外の heal（dungeon.cast）: ドナの杖 Lv2（+1）で回復量 + 1、実効の hpMax（オプション hp_max）で止める。道具（薬草）には足さない", () => {
    const heal = (level: number, hp: number, hpMaxOpt: number, cmd: "cast" | "herb"): { amount: number; hp: number } => {
      const s = newGame(5);
      equipNew(s, "c4", "weapon", { itemId: "staff", identified: true, level });
      if (hpMaxOpt > 0) equipNew(s, "c1", "accessory", { itemId: "charm", identified: true, options: [opt("hp_max", hpMaxOpt)] });
      member(s, "c1").hp = hp;
      let c: Command = { type: "dungeon.cast", memberId: "c4", spellId: "heal", targetId: "c1" };
      if (cmd === "herb") {
        const herb = createItemInstance(s, { itemId: "herb", identified: true });
        member(s, "c4").inventory.push(herb);
        c = { type: "dungeon.useItem", memberId: "c4", itemId: herb, targetId: "c1" };
      }
      const r = exec(s, c);
      const m = r.events.find((e): e is Extract<GameEvent, { kind: "message" }> => e.kind === "message" && e.key === "battle.heal")!;
      return { amount: m.params!["amount"] as number, hp: member(r.state, "c1").hp };
    };
    const base = heal(0, 1, 0, "cast").amount;
    expect(heal(2, 1, 0, "cast").amount).toBe(base + 1);
    expect(heal(8, 1, 0, "herb").amount).toBe(heal(0, 1, 0, "herb").amount);
    // アルド hpMax 15 + 10 = 25 まで回復する（素の 15 を超える）
    expect(heal(2, 24, 10, "cast")).toEqual({ amount: 1, hp: 25 });
    expect(heal(2, 15, 0, "cast")).toEqual({ amount: 0, hp: 15 });
  });
});

describe("CH-13 能力値を読むほかのルール（成長・習得・寺院・制止）", () => {
  test("CH-65/CH-13 レベルアップの HP の増分は実効の生命力の補正（生命力 12 + 6 = 18 で補正 4。鏡の rng）", () => {
    const s = newGame(1);
    equipNew(s, "c1", "accessory", { itemId: "charm", identified: true, options: [opt("vit", 6)] });
    const ctx = makeContext(s, data);
    const m = cloneRng(s.rng);
    const want = Math.max(cfg.growth.hpGainMin, rollDie(m, classOf(data, "fighter").hpDie) + vitBonus(18, cfg));
    expect(vitBonus(18, cfg)).toBe(4);
    expect(rollHpGain(ctx, member(s, "c1"))).toBe(want);
  });

  test("CH-14 levelUp の hpMax / mpMax は実効の値（オプション hp_max +5）", () => {
    const s = newGame(1);
    equipNew(s, "c1", "accessory", { itemId: "charm", identified: true, options: [opt("hp_max", 5)] });
    const ctx = makeContext(s, data);
    const c1 = member(s, "c1");
    const rec = levelUpOnce(ctx, c1);
    const ev = eventsOf(ctx.events, "levelUp")[0]!;
    expect(ev.hpMax).toBe(c1.hpMax + 5);
    expect(c1.hpMax).toBe(15 + rec.hpGain); // 保存するのは素の値
  });

  test("MG-22/CH-13 習得の成功率は実効の能力値（ドナの信仰心 15 + 3 = 18 で +9）", () => {
    const s = newGame(1);
    equipNew(s, "c4", "accessory", { itemId: "charm", identified: true, options: [opt("pie", 3)] });
    const c4 = member(s, "c4");
    const priest = classOf(data, "priest");
    const blessing = spellOf(data, "blessing");
    const eff = equipStats(s, data, c4).stats;
    expect(learnRate(c4, priest, blessing, 2, cfg, eff) - learnRate(c4, priest, blessing, 2, cfg)).toBe(3 * cfg.learning.statPerPoint);
    // levelUpOnce が出す習得の箱の率は実効の値で計算したもの
    const ctx = makeContext(s, data);
    levelUpOnce(ctx, c4);
    const box = eventsOf(ctx.events, "dice").find((e) => e.label.key === "dice.learn" && e.label.params?.["spell"] === blessing.name);
    expect(box?.rule.params?.["rate"]).toBe(learnRate(c4, priest, blessing, 2, cfg, eff));
  });

  test("TW-07/MG-42/CH-13 蘇生の成功率は実効の生命力（ベルク 14 → 78%、生命力 +4 で 86%。出目 79〜86 で成否が分かれる）", () => {
    const s = newGame(1);
    const c2 = member(s, "c2");
    Object.assign(c2, { life: "dead", hp: 0 });
    expect(resurrectRate(c2, data)).toBe(78);
    equipNew(s, "c2", "accessory", { itemId: "charm", identified: true, options: [opt("vit", 4)] });
    expect(resurrectRate(c2, data, equipStats(s, data, c2).stats)).toBe(86);
    let k = 1;
    while (!(randInt(createRng(k), 1, 100) > 78 && randInt(createRng(k), 1, 100) <= 86)) k++;
    s.rng = createRng(k);
    const ctx = makeContext(s, data);
    expect(rollResurrect(ctx, c2)).toBe(true);
    expect(c2.life).toBe("alive");
  });

  test("EV-20/CH-13 制止者は実効の iq の最大（慎重のベルク 7 とフィン 9 ならフィン、ベルクに iq +3 でベルク）", () => {
    const s = newGame(1);
    const def = data.events.find((e) => e.stopCheck)!;
    const actor = member(s, "c3");
    expect(pickStopper(s, data, def, actor)!.id).toBe("c6");
    equipNew(s, "c2", "accessory", { itemId: "charm", identified: true, options: [opt("iq", 3)] });
    expect(pickStopper(s, data, def, actor)!.id).toBe("c2");
  });
});

describe("IT-40 固有スキル", () => {
  test("MG-30/IT-40 mpCostDown: 夜明けの火打ち杖（−1）で火の矢 2 → 1。入力の検査（mp 1 で受け付け、0 で no mp）・battleMenu の mp と usable も同じ値。最低 1", () => {
    const s0 = dived(1);
    equipNew(s0, "c5", "weapon", { itemId: "staff", uniqueId: "dawn_flint_staff", identified: true });
    member(s0, "c5").mp = 1;
    const s = withBattle(s0, [{ monsterId: "giant_rat", hps: [50], status: [["paralysis"]] }], { identified: ["giant_rat"], inputs: allInputs(s0, DEF) });
    const castCmd: Command = { type: "battle.input", memberId: "c5", action: { type: "cast", spellId: "fire_arrow", target: { side: "enemy", group: 0 } } };
    const menuSpell = (st: GameState) => battleMenu(st, data)!.members.find((x) => x.id === "c5")!.spells.find((x) => x.spellId === "fire_arrow")!;
    expect([menuSpell(s).mp, menuSpell(s).usable]).toEqual([1, true]);
    const r1 = exec(s, castCmd);
    const r2 = exec(r1.state, RESOLVE);
    expect(r2.events).toContainEqual({ kind: "mpChanged", id: "c5", delta: -1, mp: 0 });
    // mp 0 では no mp
    const empty = cloneState(s);
    member(empty, "c5").mp = 0;
    expect(execute(empty, castCmd, data).events).toEqual([{ kind: "rejected", command: "battle.input", reason: "no mp" }]);
    expect(menuSpell(empty).usable).toBe(false);
    // 杖が無ければ 2（mp 1 では no mp）
    const plain = cloneState(s);
    equipNew(plain, "c5", "weapon", { itemId: "staff", identified: true });
    expect(execute(plain, castCmd, data).events).toEqual([{ kind: "rejected", command: "battle.input", reason: "no mp" }]);
    // 値が消費を超えても 1
    const d = loadFreshData();
    d.uniques.find((u) => u.id === "dawn_flint_staff")!.skill.value = 5;
    expect(spellCost(s, d, member(s, "c5"), spellOf(d, "fire_arrow"))).toBe(1);
  });

  test("MG-30/IT-40 mpCostDown は dungeon.cast（戦闘外の heal）と campMenu の mp にも効く", () => {
    const s = newGame(1);
    equipNew(s, "c4", "weapon", { itemId: "staff", uniqueId: "dawn_flint_staff", identified: true });
    member(s, "c1").hp = 1;
    expect(campMenu(s, data)!.members.find((x) => x.id === "c4")!.spells.find((x) => x.spellId === "heal")!.mp).toBe(1);
    const mp = member(s, "c4").mp;
    const r = exec(s, { type: "dungeon.cast", memberId: "c4", spellId: "heal", targetId: "c1" });
    expect(r.events[0]).toEqual({ kind: "mpChanged", id: "c4", delta: -1, mp: mp - 1 });
    member(s, "c4").mp = 1;
    expect(execute(s, { type: "dungeon.cast", memberId: "c4", spellId: "heal", targetId: "c1" }, data).events[0]!.kind).toBe("mpChanged");
  });

  test("CB-23/IT-40 extraAttack: 二枚舌の短剣（+1）でアルド Lv1 は 2 振り（1d4 + 力補正 2 を 2 回。鏡の rng）", () => {
    const d = dataWith({ combat: ALWAYS_HIT });
    const s = solo(4, [50], (x) => equipNew(x, "c1", "weapon", { itemId: "dagger", uniqueId: "twin_tongue_dagger", identified: true }));
    const m = cloneRng(s.rng);
    rolls(m, 6);
    chance(m, 100);
    const d1 = rollDice(m, "1d4").total + 2;
    chance(m, 100);
    const d2 = rollDice(m, "1d4").total + 2;
    const r = exec(s, RESOLVE, d);
    expect(eventsOf(r.events, "attack").map((e) => e.damage)).toEqual([d1, d2]);
    expect(r.state.rng).toEqual(m);
  });

  test("CB-13/IT-40 reachFromBack: 後衛（ドナ c4）でも影法師の剣なら近接攻撃できる", () => {
    const s = withBattle(dived(1), [{ monsterId: "giant_rat", hps: [3] }]);
    expect(canStrike(s, data, member(s, "c4"))).toBe(false);
    equipNew(s, "c4", "weapon", { itemId: "long_sword", uniqueId: "shadowfolk_sword", identified: true });
    expect(canStrike(s, data, member(s, "c4"))).toBe(true);
    expect(equipStats(s, data, member(s, "c4")).ranged).toBe(true);
  });

  test("CB-04/IT-40 initiativeUp: 行動可能な装備者がいれば先手判定の味方の行の base に +2（2 人いても最大の 2）。装備者が麻痺なら足さない。乱数は同じ", () => {
    const d = dataWith({ combat: { surpriseDiff: 1000 } }); // 奇襲なし（先手判定の 2 個で止まる）
    const base = (s0: GameState) => {
      const ctx = makeContext(cloneState(s0), d);
      startBattle(ctx, { kind: "random", inRoom: false }, [{ monsterId: "giant_rat", count: 1 }]);
      const box = eventsOf(ctx.events, "dice").find((e) => e.label.key === "dice.initiative")!;
      return { party: box.rows[0]!.base, rng: ctx.state.rng };
    };
    const s0 = dived(1);
    const plain = base(s0);
    const one = cloneState(s0);
    equipNew(one, "c3", "helm", { itemId: "leather_cap", uniqueId: "alarm_bell_helm", identified: true });
    expect(base(one).party).toBe(plain.party! + 2);
    expect(base(one).rng).toEqual(plain.rng);
    const two = cloneState(one);
    equipNew(two, "c1", "helm", { itemId: "leather_cap", uniqueId: "alarm_bell_helm", identified: true });
    expect(base(two).party).toBe(plain.party! + 2);
    const para = cloneState(one);
    member(para, "c3").status = ["paralysis"];
    const paraPlain = cloneState(s0);
    member(paraPlain, "c3").status = ["paralysis"];
    expect(base(para).party).toBe(base(paraPlain).party);
  });

  test("CB-31/IT-40 fearImmune: 凪の護符の装備者は fear のタグの SAN 減少が 0（fear 以外は今どおり）", () => {
    const s = newGame(1);
    equipNew(s, "c1", "accessory", { itemId: "charm", uniqueId: "calm_sea_charm", identified: true });
    const ctx = makeContext(s, data);
    expect(loseSan(ctx, member(s, "c1"), 4, ["fear"]).delta).toBe(0);
    expect(loseSan(ctx, member(s, "c1"), 10, ["allyInjury"]).delta).toBe(-10);
    expect(loseSan(ctx, member(s, "c2"), 4, ["fear"]).delta).toBe(-4);
    expect(ctx.events).toEqual([
      { kind: "sanChanged", id: "c1", delta: -10, san: 90 },
      { kind: "sanChanged", id: "c2", delta: -4, san: 96 },
    ]);
  });

  test("CB-22/IT-40 lifeSteal: 血吸いの小手（25%）で当たるたびに floor(ダメージ × 25 ÷ 100) を戻す（hpChanged → battle.lifeSteal。0 なら何も出さない。実効の hpMax で止める）", () => {
    const d = dataWith({ combat: ALWAYS_HIT });
    const seen = new Set<boolean>();
    for (let seed = 1; seed <= 16; seed++) {
      const s = solo(seed, [50], (x) => {
        equipNew(x, "c1", "gauntlet", { itemId: "leather_gloves", uniqueId: "bloodsucker_gloves", identified: true });
        member(x, "c1").hp = 5;
      });
      const m = cloneRng(s.rng);
      rolls(m, 6);
      chance(m, 100);
      const dmg = rollDice(m, "1d8").total + 2;
      const gain = Math.floor((dmg * 25) / 100);
      const r = exec(s, RESOLVE, d);
      const at = r.events.findIndex((e) => e.kind === "message" && e.key === "battle.hit");
      const after = r.events.slice(at + 1, at + 3);
      if (gain > 0) {
        expect(after).toEqual([
          { kind: "hpChanged", id: "c1", delta: gain, hp: 5 + gain },
          { kind: "message", key: "battle.lifeSteal", params: { name: "アルド", hp: gain } },
        ]);
      } else {
        expect(r.events.some((e) => e.kind === "message" && e.key === "battle.lifeSteal")).toBe(false);
      }
      expect(member(r.state, "c1").hp).toBe(5 + gain);
      expect(r.state.rng).toEqual(m);
      seen.add(gain > 0);
    }
    expect(seen).toEqual(new Set([true, false]));
    // 満タン（15/15）なら何も出さない
    const full = solo(1, [50], (x) => equipNew(x, "c1", "gauntlet", { itemId: "leather_gloves", uniqueId: "bloodsucker_gloves", identified: true }));
    expect(exec(full, RESOLVE, d).events.some((e) => e.kind === "message" && e.key === "battle.lifeSteal")).toBe(false);
  });

  test("CB-05/IT-40 autoIdentify: 行動可能な装備者がいれば遭遇の時点で全グループを鑑定（battle.identified → enemyGroups。CB-06 の SAN は減らない）。装備者が麻痺なら今どおり", () => {
    const d = dataWith({ combat: { surpriseDiff: 1000 } });
    const run1 = (s0: GameState) => {
      const ctx = makeContext(cloneState(s0), d);
      startBattle(ctx, { kind: "random", inRoom: false }, [
        { monsterId: "giant_rat", count: 2 },
        { monsterId: "kobold", count: 1 },
      ]);
      return ctx;
    };
    const s0 = dived(1);
    equipNew(s0, "c2", "accessory", { itemId: "charm", uniqueId: "farsight_monocle", identified: true });
    const ctx = run1(s0);
    const keys = ctx.events.flatMap((e) => (e.kind === "message" ? [e.key] : e.kind === "beat" ? [] : [e.kind]));
    expect(keys.slice(0, 6)).toEqual(["screen", "encounter", "battle.encounter", "battle.identified", "battle.identified", "enemyGroups"]);
    expect(ctx.events.some((e) => e.kind === "sanChanged")).toBe(false);
    expect(ctx.state.bestiary["giant_rat"]!.identified && ctx.state.bestiary["kobold"]!.identified).toBe(true);
    const para = cloneState(s0);
    member(para, "c2").status = ["paralysis"];
    const p = run1(para);
    expect(p.events).toContainEqual({ kind: "message", key: "battle.unidentified" });
    expect(p.state.bestiary["giant_rat"]!.identified).toBe(false);
  });

  test("CH-43/IT-40 walkRegen: 前進が成立した歩で adventureTurns が value（3）の倍数なら装備者の HP +1（毒の後。hpChanged だけ）。倍数でない歩・満タンでは何も出さない", () => {
    const d = dataWithRate(0, 0);
    d.uniques.find((u) => u.id === "bloodsucker_gloves")!.skill = { type: "walkRegen", value: 3 };
    const { state } = findSituation((c) => c.kind === "corridor");
    const at = (turns: number, hp: number, poison: boolean) => {
      const s = cloneState(state);
      equipNew(s, "c1", "gauntlet", { itemId: "leather_gloves", uniqueId: "bloodsucker_gloves", identified: true });
      s.adventureTurns = turns;
      Object.assign(member(s, "c1"), { hp, status: poison ? ["poison"] : [] });
      return execute(s, { type: "dungeon.move" }, d);
    };
    const r = at(2, 5, false); // 前進で 3
    expect(r.events[0]!.kind).toBe("moved");
    expect(eventsOf(r.events, "hpChanged")).toEqual([{ kind: "hpChanged", id: "c1", delta: 1, hp: 6 }]);
    expect(at(3, 5, false).events.some((e) => e.kind === "hpChanged")).toBe(false); // 4 は倍数でない
    expect(at(2, 15, false).events.some((e) => e.kind === "hpChanged")).toBe(false); // 満タン
    // 毒（−1）の後に +1
    expect(eventsOf(at(5, 5, true).events, "hpChanged")).toEqual([
      { kind: "hpChanged", id: "c1", delta: -1, hp: 4 },
      { kind: "hpChanged", id: "c1", delta: 1, hp: 5 },
    ]);
  });
});
