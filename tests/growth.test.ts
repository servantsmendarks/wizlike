// 成長（CH-61〜65、MG-01）。levelUpOnce は HP のダイスを先に振り、その後に習得の d100 を振る。
// ルールのテストは expBase を RULE_EXP_BASE（1000）に固定したデータ（loadRuleData）で書く。実データの expBase（50【仮】）は表のテストだけで見る。
// 固定シードの出目（src/core/rng.ts の randInt で実測）:
//   seed 1: d10 = 9, 4, 2 / d4 = 1 / d8 = 5 → 続く d100 = 14 → 続く d8 = 4
import { describe, expect, test } from "vitest";
import { createRng, randInt, type RngState } from "../src/core/rng";
import {
  canLevelUp,
  expFor,
  initialHpMax,
  levelDownWhileBelow,
  levelUpOnce,
  levelUpWhilePossible,
  mpGainFor,
  mpStatFor,
  rollHpGain,
  vitBonus,
} from "../src/core/rules/growth";
import { classOf, cloneState, makeContext } from "../src/core/state";
import type { Character, GameEvent } from "../src/core/types";
import { data as realData, expectKnownStringKeys, loadRuleData, newGame, withChar } from "./helpers/core";

/** expBase 1000 に固定したデータ（CH-64 の調整値から手計算を切り離す） */
const data = loadRuleData();

const BERK = 1; // fighter, vit 14
const DONA = 3; // priest, vit 10, pie 15
const EL = 4; // mage, vit 7, iq 16

const cfg = data.config;

function setup(seed: number, idx: number, patch: Partial<Character> = {}) {
  const ctx = makeContext(cloneState(withChar(newGame(seed), idx, patch)), data);
  return { ctx, ch: ctx.state.party[idx]! };
}

function rngAfter(seed: number, specs: [number, number][]): RngState {
  const r = createRng(seed);
  for (const [a, b] of specs) randInt(r, a, b);
  return r;
}

function kinds(events: readonly GameEvent[]): string[] {
  return events.map((e) => e.kind);
}

/** ドナを L3 にした形（増分は手で決める）。hpMax = 12（CH-65 のレベル 1）+ 5 + 4、mpMax = 5 + 5 + 5。 */
const DONA_L3: Partial<Character> = {
  level: 3,
  maxLevelReached: 3,
  exp: 1500,
  levelHistory: [
    { level: 2, hpGain: 5, mpGain: 5 },
    { level: 3, hpGain: 4, mpGain: 5 },
  ],
  hpMax: 21,
  hp: 21,
  mpMax: 15,
  mp: 15,
  knownSpells: ["heal", "blessing"],
};

describe("growth: 必要経験値と増分の式", () => {
  test("CH-64 実データ（expBase 50【仮】、expGrowth 1.5）の表: floor(50 × 1.5^(L−2) × expMultiplier)（fighter L2 = 50、lord L8 = 797）", () => {
    // 手計算: 50 × 1.5^0..6 = 50, 75, 112.5, 168.75, 253.125, 379.6875, 569.53125 に
    // fighter 1.0 / thief 0.9 / samurai 1.3 / lord 1.4 / bishop 1.2 を掛けて切り捨て
    expect(realData.config.growth.expBase).toBe(50);
    const table: Record<string, number[]> = {
      fighter: [50, 75, 112, 168, 253, 379, 569],
      thief: [45, 67, 101, 151, 227, 341, 512],
      samurai: [65, 97, 146, 219, 329, 493, 740],
      lord: [70, 105, 157, 236, 354, 531, 797],
      bishop: [60, 90, 135, 202, 303, 455, 683],
    };
    for (const [id, want] of Object.entries(table)) {
      const cls = classOf(realData, id);
      expect(expFor(1, cls, realData.config)).toBe(0);
      expect([2, 3, 4, 5, 6, 7, 8].map((L) => expFor(L, cls, realData.config)), id).toEqual(want);
    }
  });

  test("CH-64 実データの canLevelUp の境界（fighter: exp 49 は偽、50 は真。L2 から 74 は偽、75 は真）", () => {
    const berk = newGame(1).party[BERK]!;
    expect(canLevelUp({ ...berk, exp: 49 }, realData)).toBe(false);
    expect(canLevelUp({ ...berk, exp: 50 }, realData)).toBe(true);
    expect(canLevelUp({ ...berk, level: 2, exp: 74 }, realData)).toBe(false);
    expect(canLevelUp({ ...berk, level: 2, exp: 75 }, realData)).toBe(true);
  });

  test("CH-64 式: expBase 1000 のデータで expFor(1)=0、職業ごとの L2..L8 の表（lord L8 = 15946）", () => {
    const table: Record<string, number[]> = {
      fighter: [1000, 1500, 2250, 3375, 5062, 7593, 11390],
      thief: [900, 1350, 2025, 3037, 4556, 6834, 10251],
      samurai: [1300, 1950, 2925, 4387, 6581, 9871, 14807],
      lord: [1400, 2100, 3150, 4725, 7087, 10631, 15946],
      bishop: [1200, 1800, 2700, 4050, 6075, 9112, 13668],
    };
    for (const [id, want] of Object.entries(table)) {
      const cls = classOf(data, id);
      expect(expFor(1, cls, cfg)).toBe(0);
      expect([2, 3, 4, 5, 6, 7, 8].map((L) => expFor(L, cls, cfg)), id).toEqual(want);
    }
    expect(expFor(0, classOf(data, "fighter"), cfg)).toBe(0);
  });

  test("CH-64 式: expBase 1000 のデータで canLevelUp の境界（fighter: exp 999 は偽、1000 は真）", () => {
    const s = newGame(1);
    const berk = s.party[BERK]!;
    expect(canLevelUp({ ...berk, exp: 999 }, data)).toBe(false);
    expect(canLevelUp({ ...berk, exp: 1000 }, data)).toBe(true);
    expect(canLevelUp({ ...berk, level: 2, exp: 1499 }, data)).toBe(false);
    expect(canLevelUp({ ...berk, level: 2, exp: 1500 }, data)).toBe(true);
  });

  test("CH-65 vitBonus は floor（7 は −2、8 と 9 は −1、10 は 0、12 は +1、14 は +2）", () => {
    expect([7, 8, 9, 10, 11, 12, 14].map((v) => vitBonus(v, cfg))).toEqual([-2, -1, -1, 0, 0, 1, 2]);
  });

  test("CH-65 レベル 1 の hpMax は hpDie + max(0, vitBonus) + level1Bonus（アルド 15、ベルク 16、キリ 10、ドナ 12、エル 8、フィン 10）", () => {
    // 手計算（level1Bonus 4）:
    //   アルド 戦士 d10・vit 12（+1）: 10 + 1 + 4 = 15   ベルク 戦士 d10・vit 14（+2）: 10 + 2 + 4 = 16
    //   キリ 盗賊 d6・vit 8（−1 → 0）: 6 + 0 + 4 = 10     ドナ 僧侶 d8・vit 10（0）: 8 + 0 + 4 = 12
    //   エル 魔術師 d4・vit 7（−2 → 0）: 4 + 0 + 4 = 8   フィン 盗賊 d6・vit 9（−1 → 0）: 6 + 0 + 4 = 10
    expect(cfg.growth.level1Bonus).toBe(4);
    const want = [15, 16, 10, 12, 8, 10];
    cfg.prototypeParty.members.forEach((m, i) => {
      expect(initialHpMax(classOf(data, m.classId), m.stats, cfg)).toBe(want[i]);
    });
    // 生命力補正が負でも引かない（vit 3 → −4 でも 0）: 魔術師 4 + 0 + 4 = 8、戦士 10 + 0 + 4 = 14
    const st = { ...cfg.prototypeParty.members[4]!.stats, vit: 3 };
    expect(vitBonus(3, cfg)).toBe(-4);
    expect(initialHpMax(classOf(data, "mage"), st, cfg)).toBe(8);
    expect(initialHpMax(classOf(data, "fighter"), st, cfg)).toBe(14);
    // 正の補正は足す（vit 18 → +4）: 戦士 10 + 4 + 4 = 18
    expect(initialHpMax(classOf(data, "fighter"), { ...st, vit: 18 }, cfg)).toBe(18);
    // hpGainMin は初期値に効かない。level1Bonus はそのまま足す（0 なら hpDie + 補正だけ、5 なら +5）
    expect(initialHpMax(classOf(data, "mage"), st, { ...cfg, growth: { ...cfg.growth, hpGainMin: 9 } })).toBe(8);
    expect(initialHpMax(classOf(data, "mage"), st, { ...cfg, growth: { ...cfg.growth, level1Bonus: 0 } })).toBe(4);
    expect(initialHpMax(classOf(data, "thief"), st, { ...cfg, growth: { ...cfg.growth, level1Bonus: 5 } })).toBe(11);
  });

  test("MG-01 mpGain: ドナ 5、エル 7、戦士 0。司教は iq と pie の高い方。開始レベル前の侍も伸びる。補正は 0 未満にならない", () => {
    const st = cfg.prototypeParty.members[0]!.stats;
    expect(mpGainFor(classOf(data, "priest"), cfg.prototypeParty.members[3]!.stats, cfg)).toBe(5);
    expect(mpGainFor(classOf(data, "mage"), cfg.prototypeParty.members[4]!.stats, cfg)).toBe(7);
    expect(mpGainFor(classOf(data, "fighter"), st, cfg)).toBe(0);
    expect(mpGainFor(classOf(data, "thief"), { ...st, iq: 18, pie: 18 }, cfg)).toBe(0);
    expect(mpStatFor(classOf(data, "fighter"), st)).toBeNull();
    // 司教（mpPerLevel 3）: iq 12 / pie 14 → 14 を使い +2。iq 16 / pie 12 → 16 を使い +3
    const bishop = classOf(data, "bishop");
    expect(mpStatFor(bishop, { ...st, iq: 12, pie: 14 })).toBe(14);
    expect(mpGainFor(bishop, { ...st, iq: 12, pie: 14 }, cfg)).toBe(5);
    expect(mpGainFor(bishop, { ...st, iq: 16, pie: 12 }, cfg)).toBe(6);
    // 侍（mpPerLevel 2、mage は L4 から）: iq 14 → +2
    expect(mpGainFor(classOf(data, "samurai"), { ...st, iq: 14 }, cfg)).toBe(4);
    // 関連能力値が pivot 未満でも補正は 0（mage iq 7 → 4）
    expect(mpGainFor(classOf(data, "mage"), { ...st, iq: 7 }, cfg)).toBe(4);
  });

  test("CH-65 rollHpGain は rng を 1 回だけ使う（seed 1: d10 = 9、ベルク vit 14 で +2 → 11）", () => {
    const { ctx, ch } = setup(1, BERK);
    expect(rollHpGain(ctx, ch)).toBe(11);
    expect(ctx.state.rng).toEqual(rngAfter(1, [[1, 10]]));
  });
});

describe("growth: レベルアップ（CH-61、CH-63、CH-65）", () => {
  test("CH-65 seed 1 でベルクを L2 に: d10 = 9、+2 で hpGain 11。hpMax 16 → 27、hp も +11", () => {
    const { ctx, ch } = setup(1, BERK, { exp: 1000, hp: 5 });
    const rec = levelUpOnce(ctx, ch);
    expect(rec).toEqual({ level: 2, hpGain: 11, mpGain: 0 });
    expect(ch.level).toBe(2);
    expect(ch.hpMax).toBe(27);
    expect(ch.hp).toBe(16);
    expect(ch.mpMax).toBe(0);
    expect(ctx.state.rng).toEqual(rngAfter(1, [[1, 10]]));
  });

  test("CH-65 hpGainMin: seed 1 でエルを L2 に。d4 = 1、−2 で −1 → 1。対象の呪文が無いので d100 は振らない", () => {
    const { ctx, ch } = setup(1, EL, { exp: 1000 });
    const rec = levelUpOnce(ctx, ch);
    expect(rec).toEqual({ level: 2, hpGain: 1, mpGain: 7 });
    expect(ch.hpMax).toBe(9); // 8 + 1
    expect(ch.mpMax).toBe(14);
    expect(ch.mp).toBe(14);
    expect(ctx.events.some((e) => e.kind === "dice")).toBe(false);
    expect(ctx.state.rng).toEqual(rngAfter(1, [[1, 4]]));
  });

  test("CH-61 levelHistory に {level:2,hpGain,mpGain} を積み、levelUp に増分と新しい最大値と変化後の現在値を載せ、message town.inn.levelUp が続く（seed 1 ベルク d10 = 9、hp 16 + 11 = 27）", () => {
    const { ctx, ch } = setup(1, BERK, { exp: 1000 });
    levelUpOnce(ctx, ch);
    expect(ch.levelHistory).toEqual([{ level: 2, hpGain: 11, mpGain: 0 }]);
    expect(ch.maxLevelReached).toBe(2);
    expect(ctx.events).toEqual([
      { kind: "levelUp", id: "c2", level: 2, hpGain: 11, mpGain: 0, hpMax: 27, mpMax: 0, hp: 27, mp: 0 },
      { kind: "message", key: "town.inn.levelUp", params: { name: ch.name, level: 2 } },
    ]);
    expectKnownStringKeys(ctx.events);
  });

  test("CH-61 seed 1 でベルク exp 1500: d10 = 9, 4 で hpGain 11, 6。L3 になり levelUp は 2 件", () => {
    const { ctx, ch } = setup(1, BERK, { exp: 1500 });
    expect(levelUpWhilePossible(ctx, ch)).toBe(2);
    expect(ch.level).toBe(3);
    expect(ch.levelHistory).toEqual([
      { level: 2, hpGain: 11, mpGain: 0 },
      { level: 3, hpGain: 6, mpGain: 0 },
    ]);
    expect(ch.hpMax).toBe(33); // 16 + 11 + 6
    expect(ch.hp).toBe(33);
    expect(ctx.events.filter((e) => e.kind === "levelUp").map((e) => (e.kind === "levelUp" ? e.level : 0))).toEqual([
      2, 3,
    ]);
    expect(ctx.state.rng).toEqual(rngAfter(1, [[1, 10], [1, 10]]));
    // 注: exp 2250 なら expFor(4) = 2250 なので L4 まで 3 段（d10 = 9, 4, 2）
    const b = setup(1, BERK, { exp: 2250 });
    expect(levelUpWhilePossible(b.ctx, b.ch)).toBe(3);
    expect(b.ch.levelHistory.map((r) => r.hpGain)).toEqual([11, 6, 4]);
    // 上げられないときは何もしない
    const c = setup(1, BERK, { exp: 999 });
    expect(levelUpWhilePossible(c.ctx, c.ch)).toBe(0);
    expect(c.ctx.events).toEqual([]);
    expect(c.ctx.state.rng).toEqual(createRng(1));
  });

  test("MG-01 開始レベル前の侍も MP が伸び、習得判定は対象が空で d100 を振らない（seed 1: d8 = 5、vit 14 で +2 → 7）", () => {
    const { ctx, ch } = setup(1, BERK, {
      classId: "samurai",
      stats: { str: 15, iq: 14, pie: 10, vit: 14, agi: 10, luk: 6 },
      exp: 1300,
      mpMax: 4,
      mp: 4,
    });
    expect(levelUpOnce(ctx, ch)).toEqual({ level: 2, hpGain: 7, mpGain: 4 });
    expect(ch.mpMax).toBe(8);
    expect(ch.maxLevelReached).toBe(2);
    expect(kinds(ctx.events)).toEqual(["levelUp", "message"]);
    expect(ctx.state.rng).toEqual(rngAfter(1, [[1, 8]]));
  });

  test("CH-63 seed 1 でドナを L2 に: d8 = 5 で hpGain 5。続く d100 = 14 ≤ 70 で blessing を習得。maxLevelReached は 2", () => {
    const { ctx, ch } = setup(1, DONA, { exp: 1000 });
    expect(levelUpOnce(ctx, ch)).toEqual({ level: 2, hpGain: 5, mpGain: 5 });
    expect(ch.hpMax).toBe(17); // 12 + 5
    expect(ch.mpMax).toBe(10);
    expect(ch.knownSpells).toEqual(["heal", "blessing"]);
    expect(ch.maxLevelReached).toBe(2);
    expect(kinds(ctx.events)).toEqual(["levelUp", "message", "message", "dice", "spellLearned", "message"]);
    const dice = ctx.events.find((e) => e.kind === "dice");
    expect(dice).toEqual({
      kind: "dice",
      label: { key: "dice.learn", params: { spell: "加護" } },
      rows: [{ label: { key: "dice.row.roll" }, base: null, dice: [14], total: 14 }],
      rule: { key: "dice.rule.rate", params: { rate: 70 } }, // 35 + 20×1 + (15−10)×3 + 0
      result: { key: "dice.learn.ok" },
    });
    expect(ctx.state.rng).toEqual(rngAfter(1, [[1, 8], [1, 100]]));
    expectKnownStringKeys(ctx.events);
  });

  test("CH-63 再到達では判定しない: 上の後に exp 0 で下げ、1000 で上げ直すと d8 の 1 回だけ消費し、dice は出ない（2 回目の d8 = 4）", () => {
    const { ctx, ch } = setup(1, DONA, { exp: 1000 });
    levelUpOnce(ctx, ch);
    ch.exp = 0;
    expect(levelDownWhileBelow(ctx, ch)).toBe(1);
    expect(ch.level).toBe(1);
    expect(ch.maxLevelReached).toBe(2);
    ctx.events.length = 0;
    ch.exp = 1000;
    expect(levelUpWhilePossible(ctx, ch)).toBe(1);
    expect(ch.levelHistory).toEqual([{ level: 2, hpGain: 4, mpGain: 5 }]);
    expect(ch.hpMax).toBe(16); // 12 + 4
    expect(ch.knownSpells).toEqual(["heal", "blessing"]);
    expect(kinds(ctx.events)).toEqual(["levelUp", "message"]);
    expect(ctx.state.rng).toEqual(rngAfter(1, [[1, 8], [1, 100], [1, 8]]));
  });
});

describe("growth: 複数段の上昇と習得判定（CH-61、CH-63、MG-20）", () => {
  // seed 1 の列: d8 = 5 → d100 = 14 → d8 = 4 → d100 = 83 → randInt(0,0)。
  // blessing（L2）の率は 35 + 20 + (15−10)×3 = 70、cure_poison（L3）は 35 + 0 + 15 = 50（ドナ pie 15、priest learnMod 0）。
  const L1_TO_L3: [number, number][] = [
    [1, 8],
    [1, 100],
    [1, 8],
    [1, 100],
    [0, 0],
  ];

  test("CH-61/MG-20 ドナ exp 1500 で L1→L3: 段ごとに d8 → d100 の順（L2 blessing 14 ≤ 70、L3 cure_poison 83 > 50 で保証）", () => {
    const { ctx, ch } = setup(1, DONA, { exp: 1500 });
    expect(levelUpWhilePossible(ctx, ch)).toBe(2);
    expect(ch.level).toBe(3);
    expect(ch.maxLevelReached).toBe(3);
    expect(ch.levelHistory).toEqual([
      { level: 2, hpGain: 5, mpGain: 5 },
      { level: 3, hpGain: 4, mpGain: 5 },
    ]);
    expect(ch.knownSpells).toEqual(["heal", "blessing", "cure_poison"]);
    expect(kinds(ctx.events)).toEqual([
      "levelUp",
      "message",
      "message",
      "dice",
      "spellLearned",
      "message",
      "levelUp",
      "message",
      "message",
      "dice",
      "message",
      "spellLearned",
      "message",
    ]);
    expect(ctx.events.flatMap((e) => (e.kind === "dice" ? e.rows.flatMap((row) => row.dice) : []))).toEqual([14, 83]);
    expect(
      ctx.events.flatMap((e) => (e.kind === "spellLearned" ? [[e.spellId, e.via]] : [])),
    ).toEqual([
      ["blessing", "roll"],
      ["cure_poison", "guarantee"],
    ]);
    expect(ctx.state.rng).toEqual(rngAfter(1, L1_TO_L3));
    expectKnownStringKeys(ctx.events);
  });

  test("CH-63 2 段下げてから maxLevelReached を越えて上げ直すと、新しいレベルだけを判定する", () => {
    const { ctx, ch } = setup(1, DONA, { exp: 1500 });
    levelUpWhilePossible(ctx, ch);
    ch.exp = 0;
    expect(levelDownWhileBelow(ctx, ch)).toBe(2);
    expect(ch.level).toBe(1);
    expect(ch.maxLevelReached).toBe(3);
    ctx.events.length = 0;
    // expFor(4) = 2250（priest）。L2、L3 は再到達、L4 だけが初到達。L4 の判定対象は無い（learnLevel 4 の priest 呪文が無い）
    ch.exp = 2250;
    expect(levelUpWhilePossible(ctx, ch)).toBe(3);
    expect(ch.level).toBe(4);
    expect(ch.maxLevelReached).toBe(4);
    expect(ch.levelHistory.map((r) => r.level)).toEqual([2, 3, 4]);
    expect(ctx.events.filter((e) => e.kind === "dice")).toEqual([]);
    expect(ctx.events.filter((e) => e.kind === "spellLearned")).toEqual([]);
    expect(ch.knownSpells).toEqual(["heal", "blessing", "cure_poison"]);
    // 上げ直しで消費するのは HP の d8 を 3 回だけ
    expect(ctx.state.rng).toEqual(rngAfter(1, [...L1_TO_L3, [1, 8], [1, 8], [1, 8]]));
  });
});

describe("growth: レベルダウン（CH-62、MG-26）", () => {
  test("CH-62 末尾を取り消し、hpMax/mpMax を戻し、hp/mp を最大値に丸める（L3 → L2、乱数なし）", () => {
    const { ctx, ch } = setup(1, DONA, { ...DONA_L3, exp: 1000, mp: 3 });
    expect(levelDownWhileBelow(ctx, ch)).toBe(1);
    expect(ch.level).toBe(2);
    expect(ch.levelHistory).toEqual([{ level: 2, hpGain: 5, mpGain: 5 }]);
    expect(ch.hpMax).toBe(17); // 21 − 4
    expect(ch.hp).toBe(17);
    expect(ch.mpMax).toBe(10);
    expect(ch.mp).toBe(3);
    expect(ctx.events).toEqual([{ kind: "levelDown", id: "c4", level: 2, hpMax: 17, mpMax: 10, hp: 17, mp: 3 }]);
    expect(ctx.state.rng).toEqual(createRng(1));
  });

  test("CH-62 exp 0 で複数段下がり、levelDown が段数分出る。レベル 1 の初期値は取り消さない", () => {
    const { ctx, ch } = setup(1, DONA, { ...DONA_L3, exp: 0 });
    expect(levelDownWhileBelow(ctx, ch)).toBe(2);
    expect(ch.level).toBe(1);
    expect(ch.levelHistory).toEqual([]);
    expect(ch.hpMax).toBe(12); // 21 − 4 − 5 = レベル 1 の値
    expect(ch.mpMax).toBe(5);
    expect(ctx.events).toEqual([
      // hp / mp は各段の後の現在値（21 → min(21, 17) = 17 → min(17, 12) = 12、15 → 10 → 5）
      { kind: "levelDown", id: "c4", level: 2, hpMax: 17, mpMax: 10, hp: 17, mp: 10 },
      { kind: "levelDown", id: "c4", level: 1, hpMax: 12, mpMax: 5, hp: 12, mp: 5 },
    ]);
    // L1 ではそれ以上下がらない
    expect(levelDownWhileBelow(ctx, ch)).toBe(0);
    // 閾値ちょうど（exp 1500 = expFor(3)）なら下がらない
    const b = setup(1, DONA, { ...DONA_L3, exp: 1500 });
    expect(levelDownWhileBelow(b.ctx, b.ch)).toBe(0);
  });

  test("CH-62 dead にも適用し、hp 0 のまま", () => {
    const { ctx, ch } = setup(1, DONA, { ...DONA_L3, exp: 0, life: "dead", hp: 0 });
    expect(levelDownWhileBelow(ctx, ch)).toBe(2);
    expect(ch.life).toBe("dead");
    expect(ch.hp).toBe(0);
    expect(ch.hpMax).toBe(12);
  });

  test("CH-62/MG-26 knownSpells は変わらない", () => {
    const { ctx, ch } = setup(1, DONA, { ...DONA_L3, exp: 0, knownSpells: ["heal", "blessing", "cure_poison"] });
    levelDownWhileBelow(ctx, ch);
    expect(ch.knownSpells).toEqual(["heal", "blessing", "cure_poison"]);
  });

  test("CH-63 maxLevelReached は下がらない", () => {
    const { ctx, ch } = setup(1, DONA, { ...DONA_L3, exp: 0 });
    levelDownWhileBelow(ctx, ch);
    expect(ch.level).toBe(1);
    expect(ch.maxLevelReached).toBe(3);
  });

  test("CH-62 不変条件が崩れていれば Error（履歴が空、末尾の level が現在の level と違う）", () => {
    const a = setup(1, DONA, { level: 2, exp: 0, levelHistory: [] });
    expect(() => levelDownWhileBelow(a.ctx, a.ch)).toThrow(Error);
    const b = setup(1, DONA, { level: 3, exp: 0, levelHistory: [{ level: 2, hpGain: 5, mpGain: 5 }] });
    expect(() => levelDownWhileBelow(b.ctx, b.ch)).toThrow(Error);
  });
});
