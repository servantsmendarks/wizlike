// rules/combat-calc.ts（純粋な判定と式）のテスト。手組みの state と表駆動。
import { describe, expect, test } from "vitest";
import {
  allyAc,
  attackCount,
  battleItemUsable,
  battleSpellUsable,
  canAct,
  canStrike,
  enemyId,
  expShare,
  fleePercent,
  frontLineIds,
  groupViews,
  hitPercent,
  identifyPercent,
  isIncapacitated,
  isSleepOnly,
  isVictory,
  isWipe,
  lowestAliveGroup,
  lowestHpRatioAlly,
  statusPercent,
  strBonus,
  targetMatches,
} from "../src/core/rules/combat-calc";
import { classOf, itemOf, memberById, spellOf } from "../src/core/state";
import type { Character, GameState } from "../src/core/types";
import { dived, withBattle } from "./helpers/battle";
import { data, withChar } from "./helpers/core";

const cfg = data.config;
const base = (): GameState => withBattle(dived(1), [{ monsterId: "giant_rat", hps: [3, 3] }]);
const ch = (s: GameState, id: string): Character => memberById(s, id)!;

describe("CH-44 行動不能", () => {
  test("CH-44 isIncapacitated: dead/ash/麻痺/睡眠/石化/SAN 0 で真、毒だけは偽", () => {
    const s = base();
    const c = ch(s, "c1");
    const cases: [Partial<Character>, boolean][] = [
      [{}, false],
      [{ status: ["poison"] }, false],
      [{ life: "dead" }, true],
      [{ life: "ash" }, true],
      [{ status: ["paralysis"] }, true],
      [{ status: ["sleep"] }, true],
      [{ status: ["stone"] }, true],
      [{ san: 0 }, true],
      [{ san: 1 }, false],
    ];
    for (const [patch, want] of cases) {
      const x = { ...c, ...patch };
      expect(isIncapacitated(x), JSON.stringify(patch)).toBe(want);
      expect(canAct(x)).toBe(!want);
    }
  });

  test("CB-53 isSleepOnly: alive・SAN>0・睡眠あり・麻痺と石化なしだけが真（毒との重複は真）", () => {
    const c = ch(base(), "c1");
    expect(isSleepOnly({ ...c, status: ["sleep"] })).toBe(true);
    expect(isSleepOnly({ ...c, status: ["sleep", "poison"] })).toBe(true);
    expect(isSleepOnly({ ...c, status: ["sleep", "paralysis"] })).toBe(false);
    expect(isSleepOnly({ ...c, status: ["sleep", "stone"] })).toBe(false);
    expect(isSleepOnly({ ...c, status: ["sleep"], san: 0 })).toBe(false);
    expect(isSleepOnly({ ...c, status: ["sleep"], life: "dead" })).toBe(false);
    expect(isSleepOnly({ ...c, status: [] })).toBe(false);
  });
});

describe("命中とダメージ", () => {
  test("CB-20 allyAc: prototypeParty は 7/6/7/8/10/8。acBonus −2 で 5、acMin で止まる", () => {
    const s = base();
    expect(s.party.map((c) => allyAc(s, data, c))).toEqual([7, 6, 7, 8, 10, 8]);
    s.battle!.acBonus["c1"] = -2;
    expect(allyAc(s, data, ch(s, "c1"))).toBe(5);
    s.battle!.acBonus["c1"] = -100;
    expect(allyAc(s, data, ch(s, "c1"))).toBe(cfg.combat.acMin);
    // 戦闘外では補正なし
    const out = dived(1);
    expect(allyAc(out, data, ch(out, "c1"))).toBe(7);
  });

  test("CB-21 hitPercent: アルド Lv1→大ネズミ AC9 = 61、大ネズミ Lv1→アルド AC7 = 53、clamp、睡眠 +30 は clamp の内側", () => {
    expect(hitPercent(cfg, 1, 9, false)).toBe(61);
    expect(hitPercent(cfg, 1, 7, false)).toBe(53);
    expect(hitPercent(cfg, 1, 9, true)).toBe(91);
    expect(hitPercent(cfg, 1, 9 + 2, true)).toBe(95); // 20+5+44+30=99 → hitMax
    expect(hitPercent(cfg, 1, -10, false)).toBe(5); // 20+5−40=−15 → hitMin
    expect(hitPercent(cfg, 1, -10, true)).toBe(15); // −15+30=15（clamp の内側に足す）
  });

  test("CB-22 strBonus: 14→2、15→2、10→0、8→−1、7→−2", () => {
    expect([14, 15, 10, 8, 7].map(strBonus)).toEqual([2, 2, 0, -1, -2]);
  });

  test("CB-23 attackCount: fighter Lv1=1・Lv4=1・Lv5=2・Lv10=3・Lv20=3、thief Lv20=1", () => {
    const f = classOf(data, "fighter");
    expect([1, 4, 5, 9, 10, 20].map((lv) => attackCount(f, lv))).toEqual([1, 1, 2, 2, 3, 3]);
    expect(attackCount(classOf(data, "thief"), 20)).toBe(1);
  });

  test("CB-30 statusPercent: 30/luk15=20、30/luk6=38、敵（luk10）は chance のまま", () => {
    expect(statusPercent(cfg, 30, 15)).toBe(20);
    expect(statusPercent(cfg, 30, 6)).toBe(38);
    expect(statusPercent(cfg, 60, 10)).toBe(60);
  });
});

describe("逃走・鑑定・EXP", () => {
  test("CB-50 fleePercent: prototypeParty（agi 平均 65/6）vs 大ネズミ（9）= floor(50 + 1.8333×3) = 55。行動不能の味方と死んだ個体は平均に入れない", () => {
    const s = base();
    expect(fleePercent(s, data)).toBe(55);
    // キリ（agi 15）を麻痺させると (9+6+10+11+14)/5 = 10 → 50 + 3 = 53
    const s2 = withChar(s, 2, { status: ["paralysis"] });
    expect(fleePercent(s2, data)).toBe(53);
    // 死んだ個体は数えない（コボルド agi 8 が死んでいれば大ネズミだけ）
    const s3 = withBattle(dived(1), [
      { monsterId: "kobold", hps: [0] },
      { monsterId: "giant_rat", hps: [3] },
    ]);
    expect(fleePercent(s3, data)).toBe(55);
  });

  test("CB-05 identifyPercent: エル iq16 → 15 + 6 = 21。行動可能な味方の iq 最大が 10 以下なら 15", () => {
    const s = base();
    expect(identifyPercent(s, data)).toBe(21);
    const s2 = withChar(s, 4, { status: ["sleep"] }); // エルが眠る → 残りの iq 最大 9
    expect(identifyPercent(s2, data)).toBe(15);
  });

  test("CH-60 expShare: 64/5 = 12、alive 0 なら 0", () => {
    expect(expShare(64, 5)).toBe(12);
    expect(expShare(64, 0)).toBe(0);
  });
});

describe("前衛と後衛", () => {
  test("CB-13 canStrike: 前衛は真、フィン（short_bow）は真、ドナ・エル（staff）は偽", () => {
    const s = base();
    expect(s.party.map((c) => canStrike(s, data, c))).toEqual([true, true, true, false, false, true]);
  });

  test("CB-14 frontLineIds: 前衛 3 人が行動不能（麻痺・死亡・睡眠の混在）なら後衛 3 人、1 人回復で前衛に戻る", () => {
    let s = base();
    expect(frontLineIds(s, data)).toEqual(["c1", "c2", "c3"]);
    s = withChar(s, 0, { status: ["paralysis"] });
    s = withChar(s, 1, { life: "dead", hp: 0 });
    s = withChar(s, 2, { status: ["sleep"] });
    expect(frontLineIds(s, data)).toEqual(["c4", "c5", "c6"]);
    expect(canStrike(s, data, ch(s, "c4"))).toBe(true);
    const back = withChar(s, 2, { status: [] });
    expect(frontLineIds(back, data)).toEqual(["c1", "c2", "c3"]);
    expect(canStrike(back, data, ch(back, "c4"))).toBe(false);
  });
});

describe("勝敗", () => {
  test("CB-53 isWipe: 全員死亡で真、死者 5 + 睡眠 1 は偽、麻痺 5 + 睡眠 1 は偽、全員麻痺は真、SAN 0 だけ残るのは真", () => {
    const set = (patches: Partial<Character>[]): GameState => {
      let s = base();
      patches.forEach((p, i) => (s = withChar(s, i, p)));
      return s;
    };
    const dead = { life: "dead" as const, hp: 0 };
    const par = { status: ["paralysis" as const] };
    expect(isWipe(set([dead, dead, dead, dead, dead, dead]))).toBe(true);
    expect(isWipe(set([dead, dead, dead, dead, dead, { status: ["sleep"] }]))).toBe(false);
    expect(isWipe(set([par, par, par, par, par, { status: ["sleep"] }]))).toBe(false);
    expect(isWipe(set([par, par, par, par, par, par]))).toBe(true);
    expect(isWipe(set([dead, dead, dead, dead, dead, { san: 0 }]))).toBe(true);
    expect(isWipe(set([dead, dead, dead, dead, dead, { status: ["sleep"], san: 0 }]))).toBe(true);
    expect(isWipe(base())).toBe(false);
  });

  test("CB-25/42 isVictory・lowestAliveGroup・lowestHpRatioAlly（同率は並び順）", () => {
    const s = withBattle(dived(1), [
      { monsterId: "giant_rat", hps: [0, 0] },
      { monsterId: "kobold", hps: [0, 2] },
    ]);
    expect(isVictory(s.battle!)).toBe(false);
    expect(lowestAliveGroup(s.battle!)).toBe(1);
    s.battle!.groups[1]!.units[1]!.hp = 0;
    expect(isVictory(s.battle!)).toBe(true);
    expect(lowestAliveGroup(s.battle!)).toBeNull();
    let p = withChar(base(), 1, { hp: 6 }); // ベルク 6/12 = 0.5
    p = withChar(p, 3, { hp: 4 }); // ドナ 4/8 = 0.5（同率は並び順でベルク）
    expect(lowestHpRatioAlly(p)!.id).toBe("c2");
    p = withChar(p, 1, { life: "dead", hp: 0 }); // 死者は候補にしない
    expect(lowestHpRatioAlly(p)!.id).toBe("c4");
  });

  test("§7 groupViews と enemyId: 表示名は鑑定で切り替わり、体数は生存個体の数（0 も残す）", () => {
    const s = withBattle(dived(1), [
      { monsterId: "giant_rat", hps: [0, 0] },
      { monsterId: "kobold", hps: [2, 0, 3] },
    ], { identified: ["kobold"] });
    expect(groupViews(s, data)).toEqual([
      { index: 0, monsterId: "giant_rat", name: "小さな獣", identified: false, count: 0 },
      { index: 1, monsterId: "kobold", name: "コボルド", identified: true, count: 2 },
    ]);
    expect(enemyId(2, 0)).toBe("e2-0");
  });
});

describe("F9 戦闘で使える呪文と道具", () => {
  test("F9 battleSpellUsable: fire_arrow・sleep_mist・flame_burst・lightning_tome・heal・blessing・cure_poison・identify は真、return・resurrect は偽", () => {
    const yes = ["fire_arrow", "sleep_mist", "flame_burst", "lightning_tome", "heal", "blessing", "cure_poison", "identify"];
    for (const id of yes) expect(battleSpellUsable(spellOf(data, id)), id).toBe(true);
    for (const id of ["return", "resurrect"]) expect(battleSpellUsable(spellOf(data, id)), id).toBe(false);
    // 組み合わせが合わないもの（damage を味方に）は偽
    expect(battleSpellUsable({ ...spellOf(data, "fire_arrow"), target: "ally" })).toBe(false);
    expect(battleSpellUsable({ ...spellOf(data, "heal"), target: "enemy" })).toBe(false);
  });

  test("F9 battleItemUsable: herb・antidote_herb は真、return_thread・tome・武器は偽", () => {
    expect(battleItemUsable(itemOf(data, "herb"))).toBe(true);
    expect(battleItemUsable(itemOf(data, "antidote_herb"))).toBe(true);
    for (const id of ["return_thread", "tome_lightning", "long_sword", "leather_armor"]) {
      expect(battleItemUsable(itemOf(data, id)), id).toBe(false);
    }
  });

  test("CB-12 targetMatches: enemy は生存個体のあるグループ、ally は life alive の味方、それ以外は side none", () => {
    let s = withBattle(dived(1), [
      { monsterId: "giant_rat", hps: [0] },
      { monsterId: "kobold", hps: [2] },
    ]);
    s = withChar(s, 1, { life: "dead", hp: 0 });
    expect(targetMatches(s, data, "enemy", { side: "enemy", group: 1 })).toBe(true);
    expect(targetMatches(s, data, "enemyGroup", { side: "enemy", group: 0 })).toBe(false); // 全滅したグループ
    expect(targetMatches(s, data, "enemy", { side: "enemy", group: 2 })).toBe(false);
    expect(targetMatches(s, data, "enemy", { side: "enemy", group: 0.5 })).toBe(false);
    expect(targetMatches(s, data, "enemy", { side: "none" })).toBe(false);
    expect(targetMatches(s, data, "ally", { side: "ally", memberId: "c1" })).toBe(true);
    expect(targetMatches(s, data, "ally", { side: "ally", memberId: "c2" })).toBe(false); // 死者
    expect(targetMatches(s, data, "ally", { side: "ally", memberId: "c9" })).toBe(false);
    for (const k of ["allEnemies", "party", "self", "none"] as const) {
      expect(targetMatches(s, data, k, { side: "none" })).toBe(true);
      expect(targetMatches(s, data, k, { side: "enemy", group: 1 })).toBe(false);
    }
    expect(targetMatches(s, data, "none", null)).toBe(false);
  });
});
