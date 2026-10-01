// 呪文の習得（MG-20〜26）。rollSpellLearning を直接呼ぶので、最初の乱数は判定の d100。
// 固定シードの出目（src/core/rng.ts の randInt で実測）:
//   seed 1:  d100 = 49, 14, 92, ...
//   seed 4:  d100 = 39, 26, ...（続く randInt(0,0) は 2 回とも 0）
//   seed 5:  d100 = 100, 13, 23, ...
//   seed 7:  d100 = 4, 93, 21, ...（randInt(0,0) は常に 0）
//   seed 8:  d100 = 87, 32, ...
//   seed 13: d100 = 85, 84, 44, ... / d100 2 回の後の randInt(0,1) = 1
//   seed 16: d100 = 96, 52, ...     / d100 2 回の後の randInt(0,1) = 0
import { describe, expect, test } from "vitest";
import type { GameData } from "../src/core/data";
import { createRng, randInt, type RngState } from "../src/core/rng";
import {
  checkLearnFromBook,
  isLearnSuccess,
  learnCandidates,
  learnFromBook,
  learnRate,
  relatedStatKey,
  rollSpellLearning,
} from "../src/core/rules/learning";
import { classOf, cloneState, createItemInstance, makeContext, spellOf } from "../src/core/state";
import type { Character, GameEvent, RuleContext } from "../src/core/types";
import { ctxFor, data, expectKnownStringKeys, loadFreshData, newGame, withChar } from "./helpers/core";

// prototypeParty の添字
const ALDO = 0; // fighter
const BERK = 1; // fighter（侍に差し替えて使う）
const DONA = 3; // priest, pie 15
const EL = 4; // mage, iq 16

/** seed のゲームを作り、party[idx] に patch を当てた ctx と、その ctx 内のキャラを返す。 */
function setup(seed: number, idx: number, patch: Partial<Character> = {}, d: GameData = data) {
  const s = withChar(newGame(seed), idx, patch);
  const ctx: RuleContext = d === data ? ctxFor(s) : makeContext(cloneState(s), d);
  const ch = ctx.state.party[idx]!;
  return { ctx, ch };
}

/** createRng(seed) から randInt を specs の順に引いた後の状態。 */
function rngAfter(seed: number, specs: [number, number][]): RngState {
  const r = createRng(seed);
  for (const [a, b] of specs) randInt(r, a, b);
  return r;
}

const D100: [number, number] = [1, 100];

function diceOf(events: readonly GameEvent[]): number[] {
  return events.flatMap((e) => (e.kind === "dice" ? e.dice : []));
}

function learnedOf(events: readonly GameEvent[]): [string, string][] {
  return events.flatMap((e) => (e.kind === "spellLearned" ? [[e.spellId, e.via] as [string, string]] : []));
}

/** 司教（mage:1, priest:1）。iq 8、pie 8 なので、learnLevel = L の呪文の率は 35 + 0 − 6 − 10 = 19。 */
const BISHOP: Partial<Character> = {
  classId: "bishop",
  stats: { str: 8, iq: 8, pie: 8, vit: 10, agi: 10, luk: 8 },
};

const SAMURAI: Partial<Character> = {
  classId: "samurai",
  stats: { str: 15, iq: 9, pie: 10, vit: 14, agi: 10, luk: 6 },
  knownSpells: [],
};

describe("learning: 判定の対象と成功率", () => {
  test("MG-22 relatedStatKey は系統で決まる（mage → iq、priest → pie）", () => {
    expect(relatedStatKey("mage")).toBe("iq");
    expect(relatedStatKey("priest")).toBe("pie");
  });

  test("MG-20 対象: ドナ L3（blessing 未知）は [blessing, cure_poison]、戦士は空、習得済みと bookOnly は除く", () => {
    const s = newGame(1);
    const dona = s.party[DONA]!;
    const priest = classOf(data, "priest");
    expect(learnCandidates(dona, priest, 3, data).map((x) => x.id)).toEqual(["blessing", "cure_poison"]);
    // heal は習得済みなので除く。L9 では resurrect（learnLevel 9）まで入る
    expect(learnCandidates(dona, priest, 9, data).map((x) => x.id)).toEqual([
      "blessing",
      "cure_poison",
      "identify",
      "return",
      "resurrect",
    ]);
    const aldo = s.party[ALDO]!;
    expect(learnCandidates(aldo, classOf(data, "fighter"), 9, data)).toEqual([]);
    // エル L5: fire_arrow, sleep_mist は習得済み、lightning_tome は bookOnly
    const el = s.party[EL]!;
    expect(learnCandidates(el, classOf(data, "mage"), 5, data).map((x) => x.id)).toEqual(["flame_burst"]);
  });

  test("MG-11 侍 L3 は空。L4 は [fire_arrow, sleep_mist, flame_burst]", () => {
    const { ch } = setup(1, BERK, SAMURAI);
    const sam = classOf(data, "samurai");
    expect(learnCandidates(ch, sam, 3, data)).toEqual([]);
    expect(learnCandidates(ch, sam, 4, data).map((x) => x.id)).toEqual(["fire_arrow", "sleep_mist", "flame_burst"]);
  });

  test("MG-21 isLearnSuccess: (70,70) は真、(71,70) は偽、(100,100) は真、(1,0) は偽", () => {
    expect(isLearnSuccess(70, 70)).toBe(true);
    expect(isLearnSuccess(71, 70)).toBe(false);
    expect(isLearnSuccess(100, 100)).toBe(true);
    expect(isLearnSuccess(1, 0)).toBe(false);
  });

  test("MG-22 learnRate の表（司教の learnMod −10、diff ≥ 4 なら 100、上限 100）", () => {
    const s = newGame(1);
    const dona = s.party[DONA]!;
    const el = s.party[EL]!;
    const cfg = data.config;
    const priest = classOf(data, "priest");
    const mage = classOf(data, "mage");
    // ドナ（pie 15）: 35 + 20*diff + (15-10)*3 + 0
    expect(learnRate(dona, priest, spellOf(data, "blessing"), 2, cfg)).toBe(70);
    expect(learnRate(dona, priest, spellOf(data, "cure_poison"), 3, cfg)).toBe(50);
    expect(learnRate(dona, priest, spellOf(data, "blessing"), 3, cfg)).toBe(90);
    expect(learnRate(dona, priest, spellOf(data, "identify"), 5, cfg)).toBe(50);
    expect(learnRate(dona, priest, spellOf(data, "return"), 5, cfg)).toBe(50);
    // L4 の blessing は 35+60+15 = 110 → 上限 100
    expect(learnRate(dona, priest, spellOf(data, "blessing"), 4, cfg)).toBe(100);
    // diff = 4 ≥ guaranteeDiff なら無条件で 100
    expect(learnRate(dona, priest, spellOf(data, "blessing"), 5, cfg)).toBe(100);
    // エル（iq 16）: L3 の flame_burst = 35 + 0 + 18 = 53。L2 の sleep_mist = 35 + 20 + 18 = 73
    expect(learnRate(el, mage, spellOf(data, "flame_burst"), 3, cfg)).toBe(53);
    expect(learnRate(el, mage, spellOf(data, "sleep_mist"), 2, cfg)).toBe(73);
    // 司教（iq 12, pie 14）: 関連能力値は呪文の系統で決まる。learnMod −10
    const bishopCh: Character = { ...dona, classId: "bishop", stats: { ...dona.stats, iq: 12, pie: 14 } };
    const bishop = classOf(data, "bishop");
    expect(learnRate(bishopCh, bishop, spellOf(data, "fire_arrow"), 1, cfg)).toBe(35 + 6 - 10);
    expect(learnRate(bishopCh, bishop, spellOf(data, "heal"), 1, cfg)).toBe(35 + 12 - 10);
    // 式どおりに能力値の補正が負にも効く（iq 3、learnMod −10、diff 0: 35 + 0 − 21 − 10 = 4）。下限は rate ≤ 0 のテストで確かめる
    const lowIq: Character = { ...dona, classId: "samurai", stats: { ...dona.stats, iq: 3 } };
    expect(learnRate(lowIq, classOf(data, "samurai"), spellOf(data, "flame_burst"), 3, cfg)).toBe(35 - 21 - 10);
  });
});

describe("learning: rollSpellLearning", () => {
  test("MG-22 rate ≤ 0 でも d100 を 1 回振り、失敗する（base −200、seed 1 の d100 = 49）", () => {
    const fresh = loadFreshData();
    fresh.config.learning.base = -200;
    const { ctx, ch } = setup(1, DONA, {}, fresh);
    expect(learnRate(ch, classOf(fresh, "priest"), spellOf(fresh, "blessing"), 2, fresh.config)).toBe(-165);
    expect(rollSpellLearning(ctx, ch, 2)).toEqual([]);
    expect(diceOf(ctx.events)).toEqual([49]);
    expect(ch.knownSpells).toEqual(["heal"]);
    expect(ctx.state.rng).toEqual(rngAfter(1, [D100]));
  });

  test("MG-24 1 呪文につき message learnRoll → dice{label:town.inn.learnRoll} → learned か notLearned（seed 7: ドナ L3、d100 = 4, 93、保証 randInt(0,0)）", () => {
    const { ctx, ch } = setup(7, DONA);
    const name = ch.name;
    expect(rollSpellLearning(ctx, ch, 3)).toEqual(["blessing", "cure_poison"]);
    expect(ctx.events).toEqual([
      { kind: "message", key: "town.inn.learnRoll", params: { name, spell: "加護" } },
      { kind: "dice", label: "town.inn.learnRoll", dice: [4], total: 4 },
      { kind: "spellLearned", id: "c4", spellId: "blessing", via: "roll" },
      { kind: "message", key: "town.inn.learned", params: { name, spell: "加護" } },
      { kind: "message", key: "town.inn.learnRoll", params: { name, spell: "解毒" } },
      { kind: "dice", label: "town.inn.learnRoll", dice: [93], total: 93 },
      { kind: "message", key: "town.inn.notLearned", params: { name, spell: "解毒" } },
      { kind: "spellLearned", id: "c4", spellId: "cure_poison", via: "guarantee" },
      { kind: "message", key: "town.inn.learned", params: { name, spell: "解毒" } },
    ]);
    expectKnownStringKeys(ctx.events);
  });

  test("MG-21 seed 8: ドナ L2 の blessing は 87 > 70 で失敗。learnLevel 2 の帯が無いので保証は無く、乱数の消費は 1 回", () => {
    const { ctx, ch } = setup(8, DONA);
    expect(rollSpellLearning(ctx, ch, 2)).toEqual([]);
    expect(diceOf(ctx.events)).toEqual([87]);
    expect(learnedOf(ctx.events)).toEqual([]);
    expect(ch.knownSpells).toEqual(["heal"]);
    expect(ctx.state.rng).toEqual(rngAfter(8, [D100]));
    expectKnownStringKeys(ctx.events);
  });

  test("MG-23 seed 8: ドナ L3（blessing は既知）の cure_poison は 87 > 50 で失敗し、保証 randInt(0,0) で習得（dice は 1 件）", () => {
    const { ctx, ch } = setup(8, DONA, { knownSpells: ["heal", "blessing"] });
    expect(rollSpellLearning(ctx, ch, 3)).toEqual(["cure_poison"]);
    expect(diceOf(ctx.events)).toEqual([87]);
    expect(learnedOf(ctx.events)).toEqual([["cure_poison", "guarantee"]]);
    expect(ch.knownSpells).toEqual(["heal", "blessing", "cure_poison"]);
    expect(ctx.state.rng).toEqual(rngAfter(8, [D100, [0, 0]]));
    expectKnownStringKeys(ctx.events);
  });

  test("MG-23 seed 1: ドナ L3（blessing は既知）の cure_poison は 49 ≤ 50 で習得し、保証の乱数は引かない", () => {
    const { ctx, ch } = setup(1, DONA, { knownSpells: ["heal", "blessing"] });
    expect(rollSpellLearning(ctx, ch, 3)).toEqual(["cure_poison"]);
    expect(diceOf(ctx.events)).toEqual([49]);
    expect(learnedOf(ctx.events)).toEqual([["cure_poison", "roll"]]);
    expect(ctx.state.rng).toEqual(rngAfter(1, [D100]));
    expectKnownStringKeys(ctx.events);
  });

  test("MG-23 seed 7: ドナ L3（blessing も未知）は blessing 4 ≤ 90 で習得、cure_poison 93 > 50 で失敗し、保証で cure_poison", () => {
    const { ctx, ch } = setup(7, DONA);
    rollSpellLearning(ctx, ch, 3);
    expect(diceOf(ctx.events)).toEqual([4, 93]);
    expect(learnedOf(ctx.events)).toEqual([
      ["blessing", "roll"],
      ["cure_poison", "guarantee"],
    ]);
    expect(ch.knownSpells).toEqual(["heal", "blessing", "cure_poison"]);
    expect(ctx.state.rng).toEqual(rngAfter(7, [D100, D100, [0, 0]]));
  });

  test("MG-23 seed 5: ドナ L3（blessing も未知）は blessing 100 > 90 で失敗、cure_poison 13 ≤ 50 で習得。帯 (priest,1) は保証の対象外", () => {
    const { ctx, ch } = setup(5, DONA);
    expect(rollSpellLearning(ctx, ch, 3)).toEqual(["cure_poison"]);
    expect(diceOf(ctx.events)).toEqual([100, 13]);
    expect(learnedOf(ctx.events)).toEqual([["cure_poison", "roll"]]);
    expect(ch.knownSpells).toEqual(["heal", "cure_poison"]);
    expect(ctx.state.rng).toEqual(rngAfter(5, [D100, D100]));
    expectKnownStringKeys(ctx.events);
  });

  test("MG-23 seed 13: ドナ L5（[heal, blessing, cure_poison]）は identify 85、return 84 で失敗し、randInt(0,1) = 1 で return", () => {
    const { ctx, ch } = setup(13, DONA, { knownSpells: ["heal", "blessing", "cure_poison"] });
    expect(rollSpellLearning(ctx, ch, 5)).toEqual(["return"]);
    expect(diceOf(ctx.events)).toEqual([85, 84]);
    expect(learnedOf(ctx.events)).toEqual([["return", "guarantee"]]);
    expect(ctx.state.rng).toEqual(rngAfter(13, [D100, D100, [0, 1]]));
    expectKnownStringKeys(ctx.events);
  });

  test("MG-23 seed 16: ドナ L5（[heal, blessing, cure_poison]）は identify 96、return 52 で失敗し、randInt(0,1) = 0 で identify", () => {
    const { ctx, ch } = setup(16, DONA, { knownSpells: ["heal", "blessing", "cure_poison"] });
    expect(rollSpellLearning(ctx, ch, 5)).toEqual(["identify"]);
    expect(diceOf(ctx.events)).toEqual([96, 52]);
    expect(learnedOf(ctx.events)).toEqual([["identify", "guarantee"]]);
    expect(ctx.state.rng).toEqual(rngAfter(16, [D100, D100, [0, 1]]));
  });

  test("MG-23 seed 4: 司教 L3 は mage:2 と priest:2 の 2 帯が保証に回る（flame_burst 39 > 19、cure_poison 26 > 19 で失敗）。帯の順は mage が先", () => {
    const { ctx, ch } = setup(4, EL, { ...BISHOP, knownSpells: ["fire_arrow", "sleep_mist", "heal", "blessing"] });
    const bishop = classOf(data, "bishop");
    expect(learnRate(ch, bishop, spellOf(data, "flame_burst"), 3, data.config)).toBe(19);
    expect(learnRate(ch, bishop, spellOf(data, "cure_poison"), 3, data.config)).toBe(19);
    expect(rollSpellLearning(ctx, ch, 3)).toEqual(["flame_burst", "cure_poison"]);
    expect(diceOf(ctx.events)).toEqual([39, 26]);
    expect(learnedOf(ctx.events)).toEqual([
      ["flame_burst", "guarantee"],
      ["cure_poison", "guarantee"],
    ]);
    expect(ch.knownSpells).toEqual(["fire_arrow", "sleep_mist", "heal", "blessing", "flame_burst", "cure_poison"]);
    // d100 × 2 の後に、帯ごとに randInt(0,0) を 1 回ずつ（幅 1 でも乱数を 1 つ消費する）
    expect(ctx.state.rng).toEqual(rngAfter(4, [D100, D100, [0, 0], [0, 0]]));
    expectKnownStringKeys(ctx.events);
  });

  test("MG-23 seed 13: 司教 L5 は lightning_tome が bookOnly なので帯は priest:3 だけ（identify 85、return 84 で失敗し、randInt(0,1) = 1 で return）", () => {
    const { ctx, ch } = setup(13, EL, {
      ...BISHOP,
      knownSpells: ["fire_arrow", "sleep_mist", "heal", "blessing", "flame_burst", "cure_poison"],
    });
    expect(learnCandidates(ch, classOf(data, "bishop"), 5, data).map((x) => x.id)).toEqual(["identify", "return"]);
    expect(rollSpellLearning(ctx, ch, 5)).toEqual(["return"]);
    expect(diceOf(ctx.events)).toEqual([85, 84]);
    expect(learnedOf(ctx.events)).toEqual([["return", "guarantee"]]);
    expect(ctx.state.rng).toEqual(rngAfter(13, [D100, D100, [0, 1]]));
  });

  test("MG-23 seed 7: mage（knownSpells []）L2 は fire_arrow 4 で習得、sleep_mist 93 > 73 で失敗。learnLevel 2 が無いので保証は無い", () => {
    const { ctx, ch } = setup(7, EL, { knownSpells: [] });
    expect(rollSpellLearning(ctx, ch, 2)).toEqual(["fire_arrow"]);
    expect(diceOf(ctx.events)).toEqual([4, 93]);
    expect(learnedOf(ctx.events)).toEqual([["fire_arrow", "roll"]]);
    expect(ctx.state.rng).toEqual(rngAfter(7, [D100, D100]));
  });

  test("MG-23 エル L5（flame_burst は既知）は対象が空で、イベントも乱数の消費も無い", () => {
    const { ctx, ch } = setup(1, EL, { knownSpells: ["fire_arrow", "sleep_mist", "flame_burst"] });
    expect(rollSpellLearning(ctx, ch, 5)).toEqual([]);
    expect(ctx.events).toEqual([]);
    expect(ctx.state.rng).toEqual(createRng(1));
  });

  test("MG-23 衝突 D7: 侍（iq 9）L4 は全部失敗しても保証しない（seed 13: 85 > 82、84 > 82、44 > 42）", () => {
    const { ctx, ch } = setup(13, BERK, SAMURAI);
    const sam = classOf(data, "samurai");
    const cfg = data.config;
    // 35 + 20*3 + (9−10)*3 − 10 = 82、flame_burst は 35 + 20 − 3 − 10 = 42
    expect(learnRate(ch, sam, spellOf(data, "fire_arrow"), 4, cfg)).toBe(82);
    expect(learnRate(ch, sam, spellOf(data, "sleep_mist"), 4, cfg)).toBe(82);
    expect(learnRate(ch, sam, spellOf(data, "flame_burst"), 4, cfg)).toBe(42);
    expect(rollSpellLearning(ctx, ch, 4)).toEqual([]);
    expect(diceOf(ctx.events)).toEqual([85, 84, 44]);
    expect(learnedOf(ctx.events)).toEqual([]);
    expect(ch.knownSpells).toEqual([]);
    // 保証の randInt を引いていない（d100 の 3 回だけ）
    expect(ctx.state.rng).toEqual(rngAfter(13, [D100, D100, D100]));
    expectKnownStringKeys(ctx.events);
  });
});

describe("learning: 魔法書（MG-25）", () => {
  /** party[idx] の inventory に tome_lightning の実体を足した ctx。 */
  function withTome(idx: number, patch: Partial<Character> = {}) {
    const { ctx, ch } = setup(1, idx, patch);
    const inst = createItemInstance(ctx.state, "tome_lightning", true);
    ch.inventory.push(inst);
    return { ctx, ch, inst };
  }

  test("MG-25 エルが tome_lightning を使うと lightning_tome を覚え、実体は items と inventory から消える（via book）", () => {
    const { ctx, ch, inst } = withTome(EL);
    expect(checkLearnFromBook(ctx.state, ch.id, inst, data)).toBeNull();
    const rng0 = structuredClone(ctx.state.rng);
    learnFromBook(ctx, ch, inst);
    expect(ch.knownSpells).toEqual(["fire_arrow", "sleep_mist", "lightning_tome"]);
    expect(ctx.state.items[inst]).toBeUndefined();
    expect(ch.inventory).not.toContain(inst);
    expect(ctx.events).toEqual([
      { kind: "spellLearned", id: "c5", spellId: "lightning_tome", via: "book" },
      { kind: "message", key: "town.inn.learned", params: { name: ch.name, spell: "雷光" } },
    ]);
    expect(ctx.state.rng).toEqual(rng0);
    expectKnownStringKeys(ctx.events);
  });

  test("MG-25 戦士は class cannot learn this school、既知なら spell already known。どちらも実体は残る", () => {
    const a = withTome(ALDO);
    expect(checkLearnFromBook(a.ctx.state, a.ch.id, a.inst, data)).toBe("class cannot learn this school");
    expect(a.ctx.state.items[a.inst]).toBeDefined();
    expect(a.ch.inventory).toContain(a.inst);

    const e = withTome(EL, { knownSpells: ["fire_arrow", "sleep_mist", "lightning_tome"] });
    expect(checkLearnFromBook(e.ctx.state, e.ch.id, e.inst, data)).toBe("spell already known");
    expect(e.ctx.state.items[e.inst]).toBeDefined();
    expect(e.ch.inventory).toContain(e.inst);
  });

  test("MG-25 侍 L1 でも mage の魔法書は使える（開始レベルは問わない）", () => {
    const { ctx, ch, inst } = withTome(BERK, SAMURAI);
    expect(ch.level).toBe(1);
    expect(checkLearnFromBook(ctx.state, ch.id, inst, data)).toBeNull();
    learnFromBook(ctx, ch, inst);
    expect(ch.knownSpells).toEqual(["lightning_tome"]);
  });

  test("MG-25 inventory に無い実体は item not in inventory。魔法書でなければ not a book。メンバーが無ければ no such member", () => {
    const { ctx, inst } = withTome(EL);
    // アルド（c1）の inventory には tome が無い
    expect(checkLearnFromBook(ctx.state, "c1", inst, data)).toBe("item not in inventory");
    // 装備中の品（エルの staff）も inventory には無い
    const staff = ctx.state.party[EL]!.equipment.weapon!;
    expect(checkLearnFromBook(ctx.state, "c5", staff, data)).toBe("item not in inventory");
    expect(checkLearnFromBook(ctx.state, "c5", "i999", data)).toBe("item not in inventory");
    // エルの return_thread は消耗品
    const thread = ctx.state.party[EL]!.inventory[0]!;
    expect(checkLearnFromBook(ctx.state, "c5", thread, data)).toBe("not a book");
    expect(checkLearnFromBook(ctx.state, "c9", inst, data)).toBe("no such member");
  });
});
