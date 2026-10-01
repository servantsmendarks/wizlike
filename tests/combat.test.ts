// rules/combat.ts（遭遇・入力・ラウンドの解決・勝敗）のテスト。RuleContext と execute 経由、固定シード。
// 乱数は「鏡の rng」: cloneRng(state.rng) に設計の消費順どおり randInt / rollDie / rollDice / weightedIndex を呼び、
// 期待の出目と最終の rng を作って execute 後の state.rng と toEqual する。
// 出目に依存させたくない検証は config を上書きした data（必中・必ず外れ・奇襲なし等）を使う。
import { describe, expect, test } from "vitest";
import type { GameData } from "../src/core/data";
import { execute } from "../src/core/engine";
import { chance, cloneRng, randInt, rollDice, rollDie, weightedIndex, type RngState } from "../src/core/rng";
import { allyAc, canAct, statusPercent } from "../src/core/rules/combat-calc";
import { battleMenu, startBattle, startBossEncounter, startRandomEncounter } from "../src/core/rules/combat";
import { cloneState, makeContext, memberById, monsterOf } from "../src/core/state";
import type { BattleAction, Character, Command, GameEvent, GameState } from "../src/core/types";
import {
  allInputs,
  ALWAYS_HIT,
  dataWith,
  dived,
  eventsOf,
  exec,
  expectRejected,
  kindsOf,
  withBattle,
  type BattleOpts,
  type GroupSpec,
} from "./helpers/battle";
import { data, expectKnownStringKeys } from "./helpers/core";

const RESOLVE: Command = { type: "battle.resolve" };
const DEF: BattleAction = { type: "defend" };
const AUTO_ON: Command = { type: "battle.auto", on: true };
const atk = (group: number): BattleAction => ({ type: "attack", group });
const input = (memberId: string, action: BattleAction): Command => ({ type: "battle.input", memberId, action });

/** party の id ごとに patch を当てた state（元は変えない） */
function patchParty(state: GameState, patches: Record<string, Partial<Character>>): GameState {
  const s = cloneState(state);
  s.party = s.party.map((c) => (patches[c.id] === undefined ? c : { ...c, ...structuredClone(patches[c.id]) }));
  return s;
}

/** dived(seed) に patch を当て、withBattle で戦闘を組む。inputs を省くと全員 defend */
function setup(
  groups: GroupSpec[],
  opts: BattleOpts & { seed?: number; patches?: Record<string, Partial<Character>> } = {},
): GameState {
  const s0 = patchParty(dived(opts.seed ?? 1), opts.patches ?? {});
  const inputs = opts.inputs ?? allInputs(s0, DEF);
  return withBattle(s0, groups, { ...opts, inputs });
}

const member = (s: GameState, id: string): Character => memberById(s, id)!;
const rolls = (m: RngState, n: number): number[] => Array.from({ length: n }, () => rollDie(m, 10));
const PARA = { status: ["paralysis" as const] };
const DEAD = { life: "dead" as const, hp: 0 };

/** startBattle / startRandomEncounter を ctx で呼んだ結果 */
function runCtx(state: GameState, d: GameData, f: (ctx: ReturnType<typeof makeContext>) => void) {
  const ctx = makeContext(cloneState(state), d);
  f(ctx);
  expectKnownStringKeys(ctx.events, d);
  return ctx;
}

// ---------------------------------------------------------------------------

describe("遭遇（CB-03/04/05/06）", () => {
  test("CB-03 startRandomEncounter: 鏡の rng で グループ数 → (種類 → 体数)×グループ → HP（g→u）→ 味方 1d10 → 敵 1d10 の順", () => {
    const d = dataWith({ combat: { surpriseDiff: 1000 } }); // 奇襲なし（先手判定の 2 個で止まる）
    const def = d.dungeons[0]!;
    const seen = new Set<number>();
    for (let seed = 1; seed <= 30; seed++) {
      const s0 = dived(seed);
      const ctx = runCtx(s0, d, (c) => startRandomEncounter(c, false));
      const m = cloneRng(s0.rng);
      const table = def.encounterTable["1"]!;
      const n = weightedIndex(m, def.groupCountWeights["1"]!) + 1;
      const specs: { monsterId: string; count: number }[] = [];
      for (let i = 0; i < n; i++) {
        const e = table[weightedIndex(m, table.map((x) => x.weight))]!;
        const count = Math.min(9, Math.max(1, rollDice(m, monsterOf(d, e.monster).groupSize).total));
        specs.push({ monsterId: e.monster, count });
      }
      const groups = specs.map((sp) => ({
        monsterId: sp.monsterId,
        units: Array.from({ length: sp.count }, () => {
          const hp = Math.max(1, rollDice(m, monsterOf(d, sp.monsterId).hp).total);
          return { hp, hpMax: hp, status: [] };
        }),
      }));
      const rP = rollDie(m, 10);
      const rE = rollDie(m, 10);
      const b = ctx.state.battle!;
      expect(b.groups).toEqual(groups);
      expect(b.origin).toEqual({ kind: "random", inRoom: false });
      expect(b.round).toBe(0);
      expect(ctx.state.rng).toEqual(m);
      expect(ctx.state.screen).toBe("battle");
      const dice = eventsOf(ctx.events, "dice");
      expect(dice.map((x) => x.label)).toEqual(["battle.initiativeParty", "battle.initiativeEnemy"]);
      expect(dice.map((x) => x.dice)).toEqual([[rP], [rE]]);
      expect(kindsOf(ctx.events).slice(0, 3)).toEqual(["screen", "encounter", "message:battle.encounter"]);
      seen.add(n);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  test("CB-03 groupCountWeights の上書き [0,0,0,1] で 4 グループ、[1,0,0,0] で 1。groupSize \"20\" は maxPerGroup 9 にクランプ。重み 0 の種類は出ない（200 シード）", () => {
    const d4 = dataWith({ combat: { surpriseDiff: 1000 } }, (d) => (d.dungeons[0]!.groupCountWeights["1"] = [0, 0, 0, 1]));
    const d1 = dataWith({ combat: { surpriseDiff: 1000 } }, (d) => {
      d.dungeons[0]!.groupCountWeights["1"] = [1, 0, 0, 0];
      for (const m of d.monsters) m.groupSize = "20";
    });
    const dz = dataWith({ combat: { surpriseDiff: 1000 } }, (d) => {
      d.dungeons[0]!.groupCountWeights["1"] = [0, 0, 0, 1];
      d.dungeons[0]!.encounterTable["1"]![0]!.weight = 0; // giant_rat
    });
    const s0 = dived(1);
    expect(runCtx(s0, d4, (c) => startRandomEncounter(c, false)).state.battle!.groups).toHaveLength(4);
    const one = runCtx(s0, d1, (c) => startRandomEncounter(c, false)).state.battle!;
    expect(one.groups).toHaveLength(1);
    expect(one.groups[0]!.units).toHaveLength(9);
    for (let seed = 1; seed <= 200; seed++) {
      const b = runCtx(dived(seed), dz, (c) => startRandomEncounter(c, true)).state.battle!;
      expect(b.groups.some((g) => g.monsterId === "giant_rat")).toBe(false);
    }
  });

  test("CB-04 先手判定の dice は total = floor(平均) + 出目。差が surpriseDiff に届かなければ奇襲なし", () => {
    const d = dataWith({ combat: { surpriseDiff: 1000 } });
    const s0 = dived(3);
    const ctx = runCtx(s0, d, (c) => startBattle(c, { kind: "random", inRoom: false }, [{ monsterId: "giant_rat", count: 2 }]));
    const m = cloneRng(s0.rng);
    rollDice(m, "1d6");
    rollDice(m, "1d6");
    const [rP, rE] = rolls(m, 2);
    expect(eventsOf(ctx.events, "dice")).toEqual([
      { kind: "dice", label: "battle.initiativeParty", dice: [rP], total: 10 + rP! }, // 65/6 = 10.83
      { kind: "dice", label: "battle.initiativeEnemy", dice: [rE], total: 9 + rE! },
    ]);
    expect(ctx.state.battle!.partySurprise).toBe(false);
    expect(kindsOf(ctx.events)).not.toContain("message:battle.surpriseParty");
    expect(kindsOf(ctx.events)).not.toContain("message:battle.surpriseEnemy");
    expect(ctx.state.rng).toEqual(m);
  });

  test("CB-04 味方の奇襲: partySurprise が立ち、次の resolve で敵は行動しない（消費して false に戻る）。逃走に失敗したときは敵が行動する", () => {
    const d = dataWith({ combat: { surpriseDiff: -1000, ...ALWAYS_HIT, fleeBase: -1000 } });
    const ctx = runCtx(dived(1), d, (c) => startBattle(c, { kind: "random", inRoom: false }, [{ monsterId: "kobold", count: 2 }]));
    expect(ctx.state.battle!.partySurprise).toBe(true);
    expect(kindsOf(ctx.events).at(-1)).toBe("message:battle.surpriseParty");
    let s = ctx.state;
    for (const c of s.party) s = exec(s, input(c.id, DEF), d).state;
    const r = exec(s, RESOLVE, d);
    expect(eventsOf(r.events, "attack")).toEqual([]);
    expect(r.state.battle!.partySurprise).toBe(false);
    expect(r.state.battle!.round).toBe(1);
    // 次のラウンドは敵が行動する
    let s2 = r.state;
    for (const c of s2.party) s2 = exec(s2, input(c.id, DEF), d).state;
    const r2 = exec(s2, RESOLVE, d);
    expect(eventsOf(r2.events, "attack").filter((e) => e.actorId.startsWith("e"))).toHaveLength(2);
    // 逃走の失敗では、味方の奇襲でも敵が行動する
    const rf = exec(exec(s, input("c1", { type: "flee" }), d).state, RESOLVE, d);
    expect(kindsOf(rf.events)).toContain("message:battle.fleeFail");
    expect(eventsOf(rf.events, "attack").filter((e) => e.actorId.startsWith("e"))).toHaveLength(2);
    expect(rf.state.battle!.partySurprise).toBe(false);
  });

  test("CB-04 敵の奇襲: 遭遇の execute の中で敵だけのラウンドを解決する（round 1、味方の attack なし、inputs は {}）", () => {
    const d = dataWith({ combat: ALWAYS_HIT }, (x) => (x.monsters.find((m) => m.id === "giant_rat")!.agi = 1000));
    const ctx = runCtx(dived(1), d, (c) => startBattle(c, { kind: "random", inRoom: false }, [{ monsterId: "giant_rat", count: 2 }]));
    const ks = kindsOf(ctx.events);
    const at = ks.indexOf("message:battle.surpriseEnemy");
    expect(at).toBeGreaterThan(ks.lastIndexOf("dice"));
    const attacks = eventsOf(ctx.events, "attack");
    expect(attacks.map((a) => a.actorId)).toEqual(["e0-0", "e0-1"]);
    expect(attacks.every((a) => ["c1", "c2", "c3"].includes(a.targetId))).toBe(true);
    expect(ctx.state.battle!.round).toBe(1);
    expect(ctx.state.battle!.inputs).toEqual({});
    expect(ctx.state.battle!.partySurprise).toBe(false);
  });

  test("CB-05/CB-06 未鑑定 2 グループで生存者全員の SAN −4（無鉄砲・慎重でも −4、死者は減らない）。encounter の name は unidentifiedName", () => {
    const d = dataWith({ combat: { surpriseDiff: 1000 } });
    const s0 = patchParty(dived(1), { c6: DEAD });
    const ctx = runCtx(s0, d, (c) =>
      startBattle(c, { kind: "random", inRoom: false }, [
        { monsterId: "giant_rat", count: 1 },
        { monsterId: "kobold", count: 1 },
      ]),
    );
    expect(eventsOf(ctx.events, "encounter")[0]!.groups).toEqual([
      { index: 0, monsterId: "giant_rat", name: "小さな獣", identified: false, count: 1 },
      { index: 1, monsterId: "kobold", name: "小柄な人影", identified: false, count: 1 },
    ]);
    expect(kindsOf(ctx.events)).toContain("message:battle.unidentified");
    expect(eventsOf(ctx.events, "sanChanged")).toEqual(
      ["c1", "c2", "c3", "c4", "c5"].map((id) => ({ kind: "sanChanged", id, delta: -4, san: 96 })),
    );
    expect(ctx.state.bestiary).toEqual({ giant_rat: { kills: 0, identified: false }, kobold: { kills: 0, identified: false } });
    // 1 種類が鑑定済みなら −2、全部鑑定済みなら減らず battle.unidentified も出ない
    const s1 = cloneState(s0);
    s1.bestiary = { giant_rat: { kills: 9, identified: true } };
    const c1 = runCtx(s1, d, (c) =>
      startBattle(c, { kind: "random", inRoom: false }, [
        { monsterId: "giant_rat", count: 1 },
        { monsterId: "kobold", count: 1 },
      ]),
    );
    expect(eventsOf(c1.events, "sanChanged").map((e) => e.delta)).toEqual([-2, -2, -2, -2, -2]);
    expect(eventsOf(c1.events, "encounter")[0]!.groups[0]!.name).toBe("大ネズミ");
    const c2 = runCtx(s1, d, (c) => startBattle(c, { kind: "random", inRoom: false }, [{ monsterId: "giant_rat", count: 3 }]));
    expect(eventsOf(c2.events, "sanChanged")).toEqual([]);
    expect(kindsOf(c2.events)).not.toContain("message:battle.unidentified");
  });

  test("CB-05/MG-41 識別の呪文で全グループが鑑定され、enemyGroups が 1 件、spell の targets は []。図鑑は戦闘の後も残る", () => {
    const d = dataWith({ combat: { identifyChancePerRound: 0, identifyIqPerPoint: 0, fleeBase: 1000 } });
    const s = setup(
      [
        { monsterId: "giant_rat", hps: [50], status: [["paralysis"]] },
        { monsterId: "kobold", hps: [50], status: [["paralysis"]] },
        { monsterId: "giant_rat", hps: [50], status: [["paralysis"]] },
      ],
      { patches: { c4: { knownSpells: ["heal", "identify"] } } },
    );
    s.battle!.inputs["c4"] = { type: "cast", spellId: "identify", target: { side: "none" } };
    const r = exec(s, RESOLVE, d);
    expect(eventsOf(r.events, "spell")).toEqual([{ kind: "spell", actorId: "c4", spellId: "identify", targets: [] }]);
    const ids = r.events.filter((e) => e.kind === "message" && e.key === "battle.identified");
    expect(ids.map((e) => (e as { params?: Record<string, unknown> }).params?.["name"])).toEqual(["大ネズミ", "コボルド"]);
    const eg = eventsOf(r.events, "enemyGroups");
    expect(eg).toHaveLength(1);
    expect(eg[0]!.groups.map((g) => [g.name, g.identified])).toEqual([
      ["大ネズミ", true],
      ["コボルド", true],
      ["大ネズミ", true],
    ]);
    expect(eventsOf(r.events, "mpChanged")).toEqual([{ kind: "mpChanged", id: "c4", delta: -4, mp: 1 }]);
    // 逃げた後も図鑑は残る
    const out = exec(exec(r.state, input("c1", { type: "flee" }), d).state, RESOLVE, d);
    expect(out.state.battle).toBeNull();
    expect(out.state.bestiary).toEqual({ giant_rat: { kills: 0, identified: true }, kobold: { kills: 0, identified: true } });
  });

  test("CB-05 通算撃破数が identifyKills に届いた撃破の瞬間に鑑定する（勝利のラウンドでも）", () => {
    const d = dataWith({ combat: ALWAYS_HIT });
    const s = setup([{ monsterId: "giant_rat", hps: [1], status: [["paralysis"]] }], { inputs: undefined });
    s.bestiary["giant_rat"] = { kills: 4, identified: false };
    s.battle!.inputs["c1"] = atk(0);
    const r = exec(s, RESOLVE, d);
    const ks = kindsOf(r.events);
    const at = ks.indexOf("lifeChanged");
    expect(ks.slice(at, at + 5)).toEqual(["lifeChanged", "message:battle.dead", "message:battle.identified", "enemyGroups", "battleEnd"]);
    expect(r.state.bestiary["giant_rat"]).toEqual({ kills: 5, identified: true });
  });

  test("CB-05 ラウンド終了の確率鑑定: 生存個体のある未鑑定グループを添字順に 1 回ずつ。100 なら鑑定、iq 補正（エル iq16 → +6）は出目 ≤ 6 で鑑定", () => {
    const groups: GroupSpec[] = [
      { monsterId: "giant_rat", hps: [50], status: [["paralysis"]] },
      { monsterId: "kobold", hps: [0] }, // 全滅したグループは判定しない
      { monsterId: "giant_spider", hps: [50], status: [["paralysis"]] },
    ];
    const s = setup(groups);
    const r100 = exec(s, RESOLVE, dataWith({ combat: { identifyChancePerRound: 100 } }));
    expect(r100.state.bestiary).toEqual({
      giant_rat: { kills: 0, identified: true },
      kobold: { kills: 0, identified: false },
      giant_spider: { kills: 0, identified: true },
    });
    expect(eventsOf(r100.events, "enemyGroups")).toHaveLength(1);
    // 0% + iq 補正 6%: 鏡の出目で決まる
    for (let seed = 1; seed <= 20; seed++) {
      const ss = setup(groups, { seed });
      const m = cloneRng(ss.rng);
      rolls(m, 6);
      const a = randInt(m, 1, 100);
      const b = randInt(m, 1, 100);
      const r = exec(ss, RESOLVE, dataWith({ combat: { identifyChancePerRound: 0 } }));
      expect(r.state.bestiary["giant_rat"]!.identified).toBe(a <= 6);
      expect(r.state.bestiary["giant_spider"]!.identified).toBe(b <= 6);
      expect(r.state.rng).toEqual(m);
    }
  });
});

describe("入力（CB-10/12、F2）", () => {
  const base = () => setup([{ monsterId: "giant_rat", hps: [5, 5] }, { monsterId: "kobold", hps: [0] }], { inputs: {} });

  test("CB-10 未入力が残ると battle.resolve は inputs incomplete（同じ参照・乱数なし）。flee が 1 件あれば受け付ける", () => {
    let s = base();
    expectRejected(s, RESOLVE, "inputs incomplete");
    for (const id of ["c1", "c2", "c3", "c4", "c5"]) s = exec(s, input(id, DEF)).state;
    expectRejected(s, RESOLVE, "inputs incomplete");
    const fled = exec(base(), input("c3", { type: "flee" })).state;
    expect(exec(fled, RESOLVE).events.some((e) => e.kind === "dice" && e.label === "battle.fleeRoll")).toBe(true);
    // 行動不能の者の入力は要らない
    let p = patchParty(base(), { c6: PARA });
    for (const id of ["c1", "c2", "c3", "c4", "c5"]) p = exec(p, input(id, DEF)).state;
    expect(exec(p, RESOLVE).events[0]?.kind).not.toBe("rejected");
  });

  test("CB-10/53 睡眠だけで行動可能な者が 0 人なら、空の入力で battle.resolve を受け付ける", () => {
    const s = patchParty(base(), { c1: { status: ["sleep"] }, c2: PARA, c3: PARA, c4: PARA, c5: PARA, c6: PARA });
    const r = exec(s, RESOLVE);
    expect(r.state.battle).not.toBeNull();
    expect(r.state.battle!.round).toBe(1);
  });

  test("CB-12 battle.input の rejected: 知らない呪文、MP 不足、field の呪文、他人の道具、全滅したグループ、死んだ味方への heal、行動不能、ボス戦の flee、オート中、不正な形", () => {
    const s = patchParty(base(), { c5: { mp: 1 }, c4: { knownSpells: ["heal", "return"] }, c6: DEAD, c2: PARA });
    const cases: [Command, string][] = [
      [input("c1", { type: "cast", spellId: "fire_arrow", target: { side: "enemy", group: 0 } }), "unknown spell"],
      [input("c5", { type: "cast", spellId: "fire_arrow", target: { side: "enemy", group: 0 } }), "no mp"],
      [input("c4", { type: "cast", spellId: "return", target: { side: "none" } }), "not usable"],
      [input("c1", { type: "item", instanceId: "i13", target: { side: "ally", memberId: "c1" } }), "no item"],
      [input("c5", { type: "item", instanceId: "i15", target: { side: "none" } }), "not usable"], // 帰還の糸
      [input("c1", atk(1)), "bad target"],
      [input("c1", atk(5)), "bad target"],
      [input("c4", { type: "cast", spellId: "heal", target: { side: "ally", memberId: "c6" } }), "bad target"],
      [input("c4", { type: "cast", spellId: "heal", target: { side: "enemy", group: 0 } }), "bad target"],
      [input("c2", DEF), "cannot act"],
      [input("c6", DEF), "cannot act"],
      [input("c9", DEF), "unknown member"],
      [{ type: "battle.input", memberId: 1, action: DEF } as unknown as Command, "unknown member"],
      [input("c1", { type: "dance" } as unknown as BattleAction), "bad action"],
      [input("c1", null as unknown as BattleAction), "bad action"],
      [input("c1", { type: "attack", group: "0" } as unknown as BattleAction), "bad action"],
      [input("c1", { type: "cast", spellId: "heal" } as unknown as BattleAction), "bad action"],
    ];
    for (const [cmd, reason] of cases) expectRejected(s, cmd, reason);
    const boss = setup([{ monsterId: "gatekeeper_armor", hps: [50] }], { origin: { kind: "boss" }, inputs: {} });
    expectRejected(boss, input("c1", { type: "flee" }), "cannot flee");
    const auto = setup([{ monsterId: "giant_rat", hps: [5] }], { auto: true, inputs: {} });
    expectRejected(auto, input("c1", DEF), "auto on");
  });

  test("CB-12/40 再入力は上書き。lastBattleInput は手入力だけ保存し、flee は保存しない。イベントは出さない", () => {
    let s = base();
    const r1 = exec(s, input("c1", atk(0)));
    expect(r1.events).toEqual([]);
    s = r1.state;
    expect(member(s, "c1").lastBattleInput).toEqual(atk(0));
    s = exec(s, input("c1", DEF)).state;
    expect(s.battle!.inputs["c1"]).toEqual(DEF);
    expect(member(s, "c1").lastBattleInput).toEqual(DEF);
    s = exec(s, input("c1", { type: "flee" })).state;
    expect(s.battle!.inputs["c1"]).toEqual({ type: "flee" });
    expect(member(s, "c1").lastBattleInput).toEqual(DEF);
    // 余計な欄は保存しない
    s = exec(s, input("c5", { type: "cast", spellId: "fire_arrow", target: { side: "enemy", group: 0, x: 1 } } as unknown as BattleAction)).state;
    expect(member(s, "c5").lastBattleInput).toEqual({ type: "cast", spellId: "fire_arrow", target: { side: "enemy", group: 0 } });
    // オートの入力は lastBattleInput を変えない
    const a = exec(exec(base(), AUTO_ON).state, RESOLVE);
    expect(a.state.party.map((c) => c.lastBattleInput)).toEqual(base().party.map((c) => c.lastBattleInput));
  });

  test("F2 battle.auto: bad on / no change は rejected、受け付けてもイベントは出さず inputs は触らない", () => {
    const s = exec(base(), input("c1", DEF)).state;
    expectRejected(s, { type: "battle.auto", on: "yes" } as unknown as Command, "bad on");
    expectRejected(s, { type: "battle.auto", on: false }, "no change");
    const r = exec(s, AUTO_ON);
    expect(r.events).toEqual([]);
    expect(r.state.battle!.auto).toBe(true);
    expect(r.state.battle!.inputs).toEqual({ c1: DEF });
    expectRejected(r.state, AUTO_ON, "no change");
    expect(exec(r.state, { type: "battle.auto", on: false }).state.battle!.auto).toBe(false);
  });
});

describe("前衛と後衛・敵の対象（CB-13/14/15/16）", () => {
  test("CB-13 ドナの attack は battle.backRowCannotAttack（攻撃しない）。防御中の味方への敵のダメージは ceil 半減（鏡の rng）", () => {
    const d = dataWith({ combat: ALWAYS_HIT });
    for (let seed = 1; seed <= 10; seed++) {
      const s = setup([{ monsterId: "kobold", hps: [50] }], {
        seed,
        identified: ["kobold"],
        patches: { c2: PARA, c3: PARA },
        inputs: { c1: DEF, c4: atk(0), c5: DEF, c6: DEF },
      });
      const m = cloneRng(s.rng);
      rolls(m, 5); // 味方 4 人（c1,c4,c5,c6）+ コボルド 1 体
      randInt(m, 0, 0); // 対象（候補は c1 だけ）
      chance(m, 100);
      const dmg = Math.max(1, rollDice(m, "1d6").total);
      const r = exec(s, RESOLVE, d);
      expect(r.state.rng).toEqual(m);
      expect(eventsOf(r.events, "attack")).toEqual([{ kind: "attack", actorId: "e0-0", targetId: "c1", hit: true, damage: Math.ceil(dmg / 2) }]);
      expect(r.events).toContainEqual({ kind: "message", key: "battle.backRowCannotAttack", params: { actor: "ドナ" } });
      expect(member(r.state, "c1").hp).toBe(11 - Math.ceil(dmg / 2));
    }
  });

  test("CB-13 フィン（short_bow）は後衛でも攻撃する（命中判定が走り attack が出る）", () => {
    const s = setup([{ monsterId: "giant_rat", hps: [50], status: [["paralysis"]] }], { identified: ["giant_rat"] });
    s.battle!.inputs["c6"] = atk(0);
    const r = exec(s, RESOLVE);
    expect(eventsOf(r.events, "attack").map((e) => e.actorId)).toEqual(["c6"]);
  });

  test("CB-14 前衛 3 人が麻痺なら敵の対象は後衛の行動可能者だけで、ドナの attack は攻撃として解決する。前衛 1 人の麻痺を外すと戻る", () => {
    const d = dataWith({ combat: ALWAYS_HIT });
    const targets = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const s = setup([{ monsterId: "kobold", hps: [80] }], {
        seed,
        identified: ["kobold"],
        patches: { c1: PARA, c2: PARA, c3: PARA, c4: { hp: 50, hpMax: 50 }, c5: { hp: 50, hpMax: 50 }, c6: { hp: 50, hpMax: 50 } },
        inputs: { c4: atk(0), c5: DEF, c6: DEF },
      });
      const r = exec(s, RESOLVE, d);
      const as = eventsOf(r.events, "attack");
      expect(as.filter((a) => a.actorId === "c4")).toHaveLength(1);
      for (const a of as.filter((x) => x.actorId === "e0-0")) targets.add(a.targetId);
      expect(kindsOf(r.events)).not.toContain("message:battle.backRowCannotAttack");
      // 前衛 1 人（ベルク）の麻痺を外すと元に戻る
      const back = patchParty(s, { c2: { status: [] } });
      back.battle!.inputs["c2"] = DEF;
      const rb = exec(back, RESOLVE, d);
      expect(eventsOf(rb.events, "attack").filter((a) => a.actorId === "e0-0").map((a) => a.targetId)).toEqual(["c2"]);
      expect(rb.events).toContainEqual({ kind: "message", key: "battle.backRowCannotAttack", params: { actor: "ドナ" } });
    }
    expect([...targets].sort()).toEqual(["c4", "c5", "c6"]);
  });

  test("CB-15 眠った前衛は狙われない。前衛扱いの全員が睡眠なら【衝突】のフォールバックで狙われ、被弾で覚醒判定（CB-32 の味方側）", () => {
    const d = dataWith({ combat: { ...ALWAYS_HIT, sleepWakeChance: 100 } });
    const seen = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const s = setup([{ monsterId: "giant_rat", hps: [80] }], {
        seed,
        identified: ["giant_rat"],
        patches: { c2: { status: ["sleep"], hp: 50, hpMax: 50 }, c1: { hp: 50, hpMax: 50 }, c3: { hp: 50, hpMax: 50 } },
        inputs: { c1: DEF, c3: DEF, c4: DEF, c5: DEF, c6: DEF },
      });
      const r = exec(s, RESOLVE, d);
      for (const a of eventsOf(r.events, "attack")) seen.add(a.targetId);
    }
    expect([...seen].sort()).toEqual(["c1", "c3"]);
    // 前衛は死亡・麻痺、後衛は全員睡眠 → 行動可能 0（全滅ではない）。敵は眠った後衛を狙い、当たると起こす
    const s = setup([{ monsterId: "giant_rat", hps: [80] }], {
      identified: ["giant_rat"],
      patches: {
        c1: DEAD,
        c2: PARA,
        c3: DEAD,
        c4: { status: ["sleep"], hp: 50, hpMax: 50 },
        c5: { status: ["sleep"], hp: 50, hpMax: 50 },
        c6: { status: ["sleep"], hp: 50, hpMax: 50 },
      },
      inputs: {},
    });
    const r = exec(s, RESOLVE, d);
    const a = eventsOf(r.events, "attack")[0]!;
    expect(["c4", "c5", "c6"]).toContain(a.targetId);
    expect(r.events).toContainEqual({ kind: "statusChanged", id: a.targetId, status: "sleep", on: false });
    const name = member(s, a.targetId).name;
    expect(r.events).toContainEqual({ kind: "message", key: "battle.wake", params: { target: name } });
    expect(r.state.battle).not.toBeNull();
  });

  test("CB-16 行動の時点で行動不能（先に死んだ）なら飛ばす。倒された敵の個体も行動しない", () => {
    const fast = dataWith({ combat: ALWAYS_HIT }, (x) => (x.monsters.find((m) => m.id === "kobold")!.agi = 1000));
    // コボルドが先に動いてアルド（HP 1、唯一の前衛の行動可能者）を倒す → アルドの攻撃は出ない
    const s = setup([{ monsterId: "kobold", hps: [80] }], {
      identified: ["kobold"],
      patches: { c1: { hp: 1 }, c2: PARA, c3: PARA },
      inputs: { c1: atk(0), c4: DEF, c5: DEF, c6: DEF },
    });
    const r = exec(s, RESOLVE, fast);
    expect(member(r.state, "c1").life).toBe("dead");
    expect(eventsOf(r.events, "attack").map((e) => e.actorId)).toEqual(["e0-0"]);
    // 味方が先に倒した個体は行動しない
    const slow = dataWith({ combat: ALWAYS_HIT }, (x) => (x.monsters.find((m) => m.id === "kobold")!.agi = -1000));
    const s2 = setup(
      [
        { monsterId: "kobold", hps: [1] },
        { monsterId: "kobold", hps: [80] },
      ],
      { identified: ["kobold"], patches: { c1: { hp: 50, hpMax: 50 }, c2: { hp: 50, hpMax: 50 }, c3: { hp: 50, hpMax: 50 } } },
    );
    s2.battle!.inputs["c1"] = atk(0);
    const r2 = exec(s2, RESOLVE, slow);
    expect(eventsOf(r2.events, "attack").map((e) => e.actorId)).toEqual(["c1", "e1-0"]);
  });
});

describe("命中とダメージ（CB-21〜25）", () => {
  const solo = (seed: number, patches: Record<string, Partial<Character>> = {}, hps = [50]) => {
    const s = setup([{ monsterId: "giant_rat", hps, status: hps.map(() => ["paralysis" as const]) }], {
      seed,
      identified: ["giant_rat"],
      patches,
    });
    s.battle!.inputs["c1"] = atk(0);
    return s;
  };

  test("CB-21/22 アルドの 1 振り: 命中の出目 ≤ 命中率で命中（出目 = 命中率で命中、命中率 = 出目 −1 で外れ）。ダメージは 1d8 + 力補正 2", () => {
    for (let seed = 1; seed <= 8; seed++) {
      const s = solo(seed);
      const m = cloneRng(s.rng);
      rolls(m, 6);
      const r = randInt(m, 1, 100);
      if (r === 1) continue;
      const afterHit = cloneRng(m);
      const dmg = rollDice(afterHit, "1d8").total + 2;
      // 命中率 = r（hitBase + 5×1 + 4×9 = r）
      const hitData = dataWith({ combat: { hitMin: 0, hitMax: 100, hitBase: r - 41 } });
      const h = exec(s, RESOLVE, hitData);
      expect(eventsOf(h.events, "attack")).toEqual([{ kind: "attack", actorId: "c1", targetId: "e0-0", hit: true, damage: dmg }]);
      expect(h.events).toContainEqual({ kind: "hpChanged", id: "e0-0", delta: -dmg, hp: 50 - dmg });
      expect(h.events).toContainEqual({ kind: "message", key: "battle.attackHit", params: { actor: "アルド", target: "大ネズミ", damage: dmg } });
      expect(h.state.rng).toEqual(afterHit);
      // 命中率 = r − 1
      const missData = dataWith({ combat: { hitMin: 0, hitMax: 100, hitBase: r - 42 } });
      const mi = exec(s, RESOLVE, missData);
      expect(eventsOf(mi.events, "attack")).toEqual([{ kind: "attack", actorId: "c1", targetId: "e0-0", hit: false, damage: 0 }]);
      expect(mi.events).toContainEqual({ kind: "message", key: "battle.attackMiss", params: { actor: "アルド" } });
      expect(mi.state.rng).toEqual(m);
    }
  });

  test("CB-23/25 戦士 Lv5 は 2 振り。1 振り目で先頭の個体を倒すと 2 振り目は次の個体、グループが全滅したら打ち切る（他のグループへ移らない）", () => {
    const d = dataWith({ combat: ALWAYS_HIT });
    const s = solo(1, { c1: { level: 5 } }, [1, 50]);
    const m = cloneRng(s.rng);
    rolls(m, 6);
    chance(m, 100);
    const d1 = rollDice(m, "1d8").total + 2;
    chance(m, 100);
    const d2 = rollDice(m, "1d8").total + 2;
    const r = exec(s, RESOLVE, d);
    expect(eventsOf(r.events, "attack")).toEqual([
      { kind: "attack", actorId: "c1", targetId: "e0-0", hit: true, damage: d1 },
      { kind: "attack", actorId: "c1", targetId: "e0-1", hit: true, damage: d2 },
    ]);
    expect(r.state.rng).toEqual(m);
    // 1 体だけのグループは 1 振り目で全滅 → 2 振り目は無い（もう 1 つのグループは無傷）
    const s2 = setup(
      [
        { monsterId: "giant_rat", hps: [1], status: [["paralysis"]] },
        { monsterId: "giant_rat", hps: [50], status: [["paralysis"]] },
      ],
      { identified: ["giant_rat"], patches: { c1: { level: 5 } } },
    );
    s2.battle!.inputs["c1"] = atk(0);
    const r2 = exec(s2, RESOLVE, d);
    expect(eventsOf(r2.events, "attack").map((e) => e.targetId)).toEqual(["e0-0"]);
    expect(r2.state.battle!.groups[1]!.units[0]!.hp).toBe(50);
  });

  test("CB-24 門番の甲冑は攻撃要素 2 つで 2 回、要素ごとに対象を選び直す（鏡の rng）", () => {
    const d = dataWith({ combat: ALWAYS_HIT });
    const big = { hp: 100, hpMax: 100 };
    for (let seed = 1; seed <= 6; seed++) {
      const s = setup([{ monsterId: "gatekeeper_armor", hps: [100] }], {
        seed,
        origin: { kind: "boss" },
        identified: ["gatekeeper_armor"],
        patches: { c1: big, c2: big, c3: big },
      });
      const m = cloneRng(s.rng);
      rolls(m, 7);
      const ids = ["c1", "c2", "c3"];
      const t1 = ids[randInt(m, 0, 2)]!;
      chance(m, 100);
      const a1 = Math.ceil(Math.max(1, rollDice(m, "2d6").total) / 2);
      const t2 = ids[randInt(m, 0, 2)]!;
      chance(m, 100);
      const a2 = Math.ceil(Math.max(1, rollDice(m, "1d8").total) / 2);
      const r = exec(s, RESOLVE, d);
      expect(eventsOf(r.events, "attack")).toEqual([
        { kind: "attack", actorId: "e0-0", targetId: t1, hit: true, damage: a1 },
        { kind: "attack", actorId: "e0-0", targetId: t2, hit: true, damage: a2 },
      ]);
      expect(r.state.rng).toEqual(m);
    }
  });
});

describe("状態異常と SAN 攻撃（CB-30〜33）", () => {
  const spider = (seed: number, c1: Partial<Character> = {}) =>
    setup([{ monsterId: "giant_spider", hps: [80] }], {
      seed,
      identified: ["giant_spider"],
      patches: { c1, c2: PARA, c3: PARA },
      inputs: { c1: DEF, c4: DEF, c5: DEF, c6: DEF },
    });

  test("CB-30/F8 大蜘蛛の毒: 出目 ≤ 30 − (9 − 10) × 2 = 32 で付与（鏡の rng）。毒はラウンド終了で −1", () => {
    const d = dataWith({ combat: ALWAYS_HIT });
    const outcomes = new Set<boolean>();
    for (let seed = 1; seed <= 30; seed++) {
      const s = spider(seed);
      const m = cloneRng(s.rng);
      rolls(m, 5);
      randInt(m, 0, 0);
      chance(m, 100);
      const dmg = Math.ceil(Math.max(1, rollDice(m, "1d4").total) / 2);
      const roll = randInt(m, 1, 100);
      const poisoned = roll <= statusPercent(data.config, 30, 9);
      const r = exec(s, RESOLVE, d);
      expect(r.state.rng).toEqual(m);
      expect(member(r.state, "c1").status).toEqual(poisoned ? ["poison"] : []);
      expect(member(r.state, "c1").hp).toBe(11 - dmg - (poisoned ? 1 : 0));
      if (poisoned) {
        expect(r.events).toContainEqual({ kind: "statusChanged", id: "c1", status: "poison", on: true });
        expect(r.events).toContainEqual({ kind: "message", key: "battle.status.poison", params: { target: "アルド" } });
      }
      outcomes.add(poisoned);
    }
    expect(outcomes.size).toBe(2);
  });

  test("CB-30/F8 既に毒なら付与の乱数を消費しない", () => {
    const d = dataWith({ combat: ALWAYS_HIT });
    const s = spider(1, { status: ["poison"] });
    const m = cloneRng(s.rng);
    rolls(m, 5);
    randInt(m, 0, 0);
    chance(m, 100);
    rollDice(m, "1d4");
    const r = exec(s, RESOLVE, d);
    expect(r.state.rng).toEqual(m);
    expect(eventsOf(r.events, "statusChanged")).toEqual([]);
  });

  test("CB-30/F8 腐った死体（resist sleep）に sleep_mist は乱数を消費せず battle.noEffect。大ネズミには個体ごとに出目 ≤ 60", () => {
    const s = setup([{ monsterId: "rotting_corpse", hps: [30, 30], status: [["paralysis"], ["paralysis"]] }], { identified: ["rotting_corpse"] });
    s.battle!.inputs["c5"] = { type: "cast", spellId: "sleep_mist", target: { side: "enemy", group: 0 } };
    const m = cloneRng(s.rng);
    rolls(m, 6);
    const r = exec(s, RESOLVE);
    expect(r.state.rng).toEqual(m);
    expect(r.events).toContainEqual({ kind: "message", key: "battle.noEffect", params: { target: "腐った死体" } });
    expect(eventsOf(r.events, "spell")).toEqual([{ kind: "spell", actorId: "c5", spellId: "sleep_mist", targets: ["e0-0", "e0-1"] }]);
    expect(member(r.state, "c5").mp).toBe(4);

    const rats = setup([{ monsterId: "giant_rat", hps: [30, 30, 30], status: [["paralysis"], ["paralysis", "sleep"], ["paralysis"]] }], { identified: ["giant_rat"] });
    rats.battle!.inputs["c5"] = { type: "cast", spellId: "sleep_mist", target: { side: "enemy", group: 0 } };
    const m2 = cloneRng(rats.rng);
    rolls(m2, 6);
    const a = randInt(m2, 1, 100) <= 60;
    const b = randInt(m2, 1, 100) <= 60; // 2 体目は既に眠っているので振らない → 3 体目
    const r2 = exec(rats, RESOLVE);
    expect(r2.state.rng).toEqual(m2);
    const on = eventsOf(r2.events, "statusChanged").map((e) => e.id);
    expect(on).toEqual([...(a ? ["e0-0"] : []), ...(b ? ["e0-2"] : [])]);
    expect(kindsOf(r2.events)).toContain(a || b ? "message:battle.status.sleep" : "message:battle.noEffect");
  });

  test("CB-31 囁く影の sanDrain 4（battle.sanDrain）、無鉄砲は fear 耐性で 2。SAN 0 で行動不能", () => {
    const d = dataWith({ combat: ALWAYS_HIT });
    const shadow = (patches: Record<string, Partial<Character>>, inputs: Record<string, BattleAction>) =>
      setup([{ monsterId: "whispering_shadow", hps: [50] }], { identified: ["whispering_shadow"], patches, inputs });
    const lead = exec(shadow({ c2: PARA, c3: PARA }, { c1: DEF, c4: DEF, c5: DEF, c6: DEF }), RESOLVE, d);
    expect(eventsOf(lead.events, "sanChanged")).toEqual([{ kind: "sanChanged", id: "c1", delta: -4, san: 96 }]);
    expect(lead.events).toContainEqual({ kind: "message", key: "battle.sanDrain", params: { target: "アルド" } });
    const reck = exec(shadow({ c1: PARA, c2: PARA, c3: { san: 2 } }, { c3: DEF, c4: DEF, c5: DEF, c6: DEF }), RESOLVE, d);
    expect(eventsOf(reck.events, "sanChanged")[0]).toEqual({ kind: "sanChanged", id: "c3", delta: -2, san: 0 });
    expect(canAct(member(reck.state, "c3"))).toBe(false);
    expect(battleMenu(reck.state, d)!.members[2]!.canAct).toBe(false);
  });

  test("CB-32 睡眠中の敵への命中 +sleepHitBonus、被弾で覚醒判定（覚めたら statusChanged off と battle.wake）。倒したら判定しない", () => {
    // 命中率の基礎を 0 にして、睡眠の補正だけで命中させる
    const base = { hitMin: 0, hitMax: 100, hitBase: -41, sleepHitBonus: 100 };
    const s = setup([{ monsterId: "giant_rat", hps: [50], status: [["sleep"]] }], { identified: ["giant_rat"] });
    s.battle!.inputs["c1"] = atk(0);
    const wake = exec(s, RESOLVE, dataWith({ combat: { ...base, sleepWakeChance: 100 } }));
    expect(eventsOf(wake.events, "attack")[0]!.hit).toBe(true);
    expect(wake.events).toContainEqual({ kind: "statusChanged", id: "e0-0", status: "sleep", on: false });
    expect(wake.events).toContainEqual({ kind: "message", key: "battle.wake", params: { target: "大ネズミ" } });
    const stay = exec(s, RESOLVE, dataWith({ combat: { ...base, sleepWakeChance: 0 } }));
    expect(stay.state.battle!.groups[0]!.units[0]!.status).toEqual(["sleep"]);
    // 起きていれば当たらない
    const awake = setup([{ monsterId: "giant_rat", hps: [50], status: [["paralysis"]] }], { identified: ["giant_rat"] });
    awake.battle!.inputs["c1"] = atk(0);
    expect(eventsOf(exec(awake, RESOLVE, dataWith({ combat: base })).events, "attack")[0]!.hit).toBe(false);
    // 倒したら覚醒の乱数を振らない（勝利 → 金 1d4）
    const kill = setup([{ monsterId: "giant_rat", hps: [1], status: [["sleep"]] }], { identified: ["giant_rat"] });
    kill.battle!.inputs["c1"] = atk(0);
    const m = cloneRng(kill.rng);
    rolls(m, 6);
    chance(m, 100);
    rollDice(m, "1d8");
    rollDice(m, "1d4");
    const k = exec(kill, RESOLVE, dataWith({ combat: { ...base, sleepWakeChance: 100 } }));
    expect(k.state.rng).toEqual(m);
  });

  test("CB-32 戦闘が終わると味方の睡眠が外れる（statusChanged off の後に screen dungeon）", () => {
    const s = setup([{ monsterId: "giant_rat", hps: [1], status: [["paralysis"]] }], {
      identified: ["giant_rat"],
      patches: { c2: { status: ["sleep", "poison"] } },
      inputs: { c1: atk(0), c3: DEF, c4: DEF, c5: DEF, c6: DEF },
    });
    const r = exec(s, RESOLVE, dataWith({ combat: ALWAYS_HIT }));
    const ks = kindsOf(r.events);
    expect(ks.slice(-2)).toEqual(["statusChanged", "screen"]);
    expect(r.events.at(-2)).toEqual({ kind: "statusChanged", id: "c2", status: "sleep", on: false });
    expect(member(r.state, "c2").status).toEqual(["poison"]);
  });

  test("CB-33 ラウンド終了で毒 −1（hpChanged だけ、message なし）。HP 1 で止まり hpChanged を出さない", () => {
    const s = setup([{ monsterId: "giant_rat", hps: [50], status: [["paralysis"]] }], {
      identified: ["giant_rat"],
      patches: { c1: { status: ["poison"], hp: 5 }, c2: { status: ["poison"], hp: 1 } },
    });
    const r = exec(s, RESOLVE);
    expect(eventsOf(r.events, "hpChanged")).toEqual([{ kind: "hpChanged", id: "c1", delta: -1, hp: 4 }]);
    expect(member(r.state, "c2").hp).toBe(1);
    expect(kindsOf(r.events).filter((k) => k.startsWith("message:")).every((k) => k === "message:battle.defend")).toBe(true);
  });
});

describe("呪文と道具（MG-30、F9）", () => {
  const target = (hps = [50]) => setup([{ monsterId: "giant_rat", hps, status: hps.map(() => ["paralysis" as const]) }], { identified: ["giant_rat"] });

  test("MG-30/F9 fire_arrow: MP −2 と mpChanged、命中判定なしの 1d8（鏡の rng）", () => {
    const s = target();
    s.battle!.inputs["c5"] = { type: "cast", spellId: "fire_arrow", target: { side: "enemy", group: 0 } };
    const m = cloneRng(s.rng);
    rolls(m, 6);
    const dmg = Math.max(1, rollDice(m, "1d8").total);
    const r = exec(s, RESOLVE);
    expect(r.state.rng).toEqual(m);
    const ks = kindsOf(r.events);
    const at = ks.indexOf("mpChanged");
    expect(ks.slice(at, at + 5)).toEqual(["mpChanged", "message:battle.cast", "spell", "hpChanged", "message:battle.spellDamage"]);
    expect(r.events[at]).toEqual({ kind: "mpChanged", id: "c5", delta: -2, mp: 5 });
    expect(r.events[at + 1]).toEqual({ kind: "message", key: "battle.cast", params: { actor: "エル", spell: "火矢" } });
    expect(r.events[at + 3]).toEqual({ kind: "hpChanged", id: "e0-0", delta: -dmg, hp: 50 - dmg });
    expect(member(r.state, "c5").mp).toBe(5);
  });

  test("F9 heal は hpMax を超えない（hpChanged の delta は実際の増分）。cure_poison で毒が外れ、毒の無い対象には battle.noEffect", () => {
    const s = patchParty(target(), { c1: { hp: 10, status: ["poison"] }, c4: { knownSpells: ["heal", "cure_poison"] } });
    s.battle!.inputs["c4"] = { type: "cast", spellId: "heal", target: { side: "ally", memberId: "c1" } };
    const r = exec(s, RESOLVE);
    expect(r.events).toContainEqual({ kind: "hpChanged", id: "c1", delta: 1, hp: 11 });
    expect(r.events).toContainEqual({ kind: "message", key: "battle.heal", params: { target: "アルド", amount: 1 } });
    const c = cloneState(s);
    c.battle!.inputs["c4"] = { type: "cast", spellId: "cure_poison", target: { side: "ally", memberId: "c1" } };
    const rc = exec(c, RESOLVE);
    expect(rc.events).toContainEqual({ kind: "statusChanged", id: "c1", status: "poison", on: false });
    expect(member(rc.state, "c1").status).toEqual([]);
    c.battle!.inputs["c4"] = { type: "cast", spellId: "cure_poison", target: { side: "ally", memberId: "c2" } };
    expect(exec(c, RESOLVE).events).toContainEqual({ kind: "message", key: "battle.noEffect", params: { target: "ベルク" } });
  });

  test("CB-20/F9 blessing で生存者全員の acBonus −2、AC が 2 下がる（戦闘中だけ）", () => {
    const s = patchParty(target(), { c4: { knownSpells: ["blessing"] }, c6: DEAD });
    s.battle!.inputs["c4"] = { type: "cast", spellId: "blessing", target: { side: "none" } };
    const r = exec(s, RESOLVE);
    expect(r.state.battle!.acBonus).toEqual({ c1: -2, c2: -2, c3: -2, c4: -2, c5: -2 });
    expect(allyAc(r.state, data, member(r.state, "c1"))).toBe(5);
    expect(eventsOf(r.events, "spell")[0]!.targets).toEqual(["c1", "c2", "c3", "c4", "c5"]);
  });

  test("DG-41/F9 薬草・解毒草の使用: inventory・state.items・dive.ledger.items から消える", () => {
    const s = patchParty(target(), { c1: { hp: 3, status: ["poison"] } });
    s.dive!.ledger.items.push("i4", "i13");
    s.battle!.inputs["c1"] = { type: "item", instanceId: "i4", target: { side: "ally", memberId: "c1" } };
    s.battle!.inputs["c4"] = { type: "item", instanceId: "i13", target: { side: "ally", memberId: "c1" } };
    const r = exec(s, RESOLVE);
    expect(member(r.state, "c1").inventory).toEqual([]);
    expect(member(r.state, "c4").inventory).toEqual([]);
    expect(r.state.items["i4"]).toBeUndefined();
    expect(r.state.items["i13"]).toBeUndefined();
    expect(r.state.dive!.ledger.items).toEqual([]);
    expect(r.events).toContainEqual({ kind: "message", key: "battle.useItem", params: { actor: "アルド", item: "薬草" } });
    expect(r.events).toContainEqual({ kind: "message", key: "battle.useItem", params: { actor: "ドナ", item: "解毒草" } });
    expect(member(r.state, "c1").status).toEqual([]);
    expect(member(r.state, "c1").hp).toBeGreaterThan(3);
  });
});

/** オートで battle が null になるまで resolve する（auto が切れたら入れ直す）。返り値は最後の state と全イベントとラウンド数 */
function autoUntilEnd(state: GameState, d: GameData, limit: number) {
  let s = state;
  const events: GameEvent[] = [];
  let rounds = 0;
  if (!s.battle!.auto) s = exec(s, AUTO_ON, d).state;
  while (s.battle !== null && rounds < limit) {
    if (!s.battle.auto) s = exec(s, AUTO_ON, d).state;
    const r = exec(s, RESOLVE, d);
    events.push(...r.events);
    s = r.state;
    rounds += 1;
  }
  return { state: s, events, rounds };
}

describe("オート（CB-40〜43、F2）", () => {
  test("CB-40/F2 オートで 1 戦闘が終わる（完了条件）: d01 の大ネズミ 1 グループ、battleEnd(win)・EXP・金", () => {
    const s = setup([{ monsterId: "giant_rat", hps: [6, 5, 6] }], { inputs: {} });
    const { state, events, rounds } = autoUntilEnd(s, data, 50);
    expect(state.battle).toBeNull();
    expect(state.screen).toBe("dungeon");
    expect(eventsOf(events, "battleEnd")).toEqual([{ kind: "battleEnd", result: "win" }]);
    expect(events).toContainEqual({ kind: "message", key: "battle.exp", params: { exp: 6 } }); // 36 / 6
    expect(state.party.every((c) => c.exp === 6)).toBe(true);
    expect(state.gold).toBeGreaterThan(s.gold);
    expect(state.dive!.ledger.gold).toBe(state.gold - s.gold);
    expect(rounds).toBe(2); // 回帰値（シード 1、編成 [6,5,6]、既定の config）
    expect(kindsOf(events)).not.toContain("message:battle.autoOff"); // 途中でオートが切れずに終わる
  });

  const autoCase = (groups: GroupSpec[], patches: Record<string, Partial<Character>>) =>
    setup(groups, { identified: groups.map((g) => g.monsterId), auto: true, inputs: {}, patches });

  test.each([
    ["hp", "giant_rat", { c1: { hp: 30, hpMax: 100 }, c2: PARA, c3: PARA }],
    ["status", "giant_spider", { c1: { hp: 100, hpMax: 100 }, c2: PARA, c3: PARA }],
    ["dead", "giant_rat", { c1: { hp: 1 }, c2: PARA, c3: PARA }],
    ["san", "whispering_shadow", { c1: { hp: 100, hpMax: 100, san: 52 }, c2: PARA, c3: PARA }],
  ] as const)("CB-43（完了条件）理由 %s: その execute の中で auto=false、battle.autoOff と battle.autoReason.<r>、inputs {}、次の resolve は inputs incomplete", (reason, monsterId, patches) => {
    const d = dataWith({ combat: ALWAYS_HIT }, (x) => {
      x.monsters.find((m) => m.id === "giant_spider")!.attacks[0]!.chance = 100;
    });
    const s = autoCase([{ monsterId, hps: [200] }], patches as Record<string, Partial<Character>>);
    const r = exec(s, RESOLVE, d);
    expect(r.state.battle!.auto).toBe(false);
    const ks = kindsOf(r.events);
    expect(ks.slice(-2)).toEqual(["message:battle.autoOff", `message:battle.autoReason.${reason}`]);
    expect(r.state.battle!.inputs).toEqual({});
    expectRejected(r.state, RESOLVE, "inputs incomplete", d);
  });

  test("CB-43 条件を満たさなければオートは続く", () => {
    const s = setup([{ monsterId: "giant_rat", hps: [200], status: [["paralysis"]] }], { identified: ["giant_rat"], auto: true, inputs: {} });
    const r = exec(s, RESOLVE);
    expect(r.state.battle!.auto).toBe(true);
    expect(kindsOf(r.events)).not.toContain("message:battle.autoOff");
    expect(exec(r.state, RESOLVE).events[0]?.kind).not.toBe("rejected");
  });
});

describe("逃走・勝利・全滅（CB-50〜54）", () => {
  test("CB-50 逃走: 出目 ≤ 成功率で battleEnd(flee)（出目 = 成功率で成功、−1 で失敗）。EXP は増えず、図鑑の撃破数は残る。dice battle.fleeRoll", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const s = setup([{ monsterId: "giant_rat", hps: [50] }], { seed, identified: ["giant_rat"], inputs: { c2: { type: "flee" }, c1: atk(0) } });
      s.bestiary["giant_rat"]!.kills = 3;
      const m = cloneRng(s.rng);
      const roll = randInt(m, 1, 100);
      // fleePercent = floor(fleeBase + 1.8333×3) = fleeBase + 5
      const ok = exec(s, RESOLVE, dataWith({ combat: { fleeBase: roll - 5 } }));
      expect(ok.events.slice(0, 3)).toEqual([
        { kind: "dice", label: "battle.fleeRoll", dice: [roll], total: roll },
        { kind: "battleEnd", result: "flee" },
        { kind: "message", key: "battle.fleeOk" },
      ]);
      expect(ok.state.battle).toBeNull();
      expect(ok.state.screen).toBe("dungeon");
      expect(ok.state.party.map((c) => c.exp)).toEqual(s.party.map((c) => c.exp));
      expect(ok.state.bestiary["giant_rat"]!.kills).toBe(3);
      expect(ok.state.rng).toEqual(m);
      // 失敗: fleeFail → 敵だけのラウンド（アルドの攻撃は捨てる）
      const ng = exec(s, RESOLVE, dataWith({ combat: { fleeBase: roll - 6 } }));
      expect(kindsOf(ng.events).slice(0, 2)).toEqual(["dice", "message:battle.fleeFail"]);
      expect(eventsOf(ng.events, "attack").map((e) => e.actorId)).toEqual(["e0-0"]);
      expect(ng.state.battle!.round).toBe(1);
      expect(ng.state.battle!.inputs).toEqual({});
    }
  });

  test("CB-51/DG-40/CH-60 勝利: EXP は生存者で等分（死者は受け取らない、端数切り捨て）、金は個体ごとに振って state.gold と ledger.gold の両方へ（鏡の rng）", () => {
    const d = dataWith({ combat: ALWAYS_HIT });
    const s = setup([{ monsterId: "giant_rat", hps: [1, 1], status: [["paralysis"], ["paralysis"]] }], {
      identified: ["giant_rat"],
      patches: { c1: { level: 5 }, c6: DEAD },
    });
    s.battle!.inputs["c1"] = atk(0);
    const m = cloneRng(s.rng);
    rolls(m, 5);
    chance(m, 100);
    rollDice(m, "1d8");
    chance(m, 100);
    rollDice(m, "1d8");
    const gold = rollDice(m, "1d4").total + rollDice(m, "1d4").total;
    const r = exec(s, RESOLVE, d);
    expect(r.state.rng).toEqual(m);
    expect(r.events).toContainEqual({ kind: "message", key: "battle.exp", params: { exp: 4 } }); // 24 / 5
    expect(r.state.party.map((c) => c.exp)).toEqual([4, 4, 4, 4, 4, 0]);
    expect(r.state.gold).toBe(s.gold + gold);
    expect(r.state.dive!.ledger.gold).toBe(gold);
    expect(r.events).toContainEqual({ kind: "message", key: "battle.gold", params: { gold } });
    expect(kindsOf(r.events).indexOf("battleEnd")).toBeLessThan(kindsOf(r.events).indexOf("message:battle.win"));
    // gold "0" の敵では battle.gold を出さない
    const c = setup([{ monsterId: "rotting_corpse", hps: [1], status: [["paralysis"]] }], { identified: ["rotting_corpse"] });
    c.battle!.inputs["c1"] = atk(0);
    const rc = exec(c, RESOLVE, d);
    expect(kindsOf(rc.events)).not.toContain("message:battle.gold");
    expect(rc.state.gold).toBe(c.gold);
  });

  test("CB-52【仮】宝箱: 部屋の遭遇で chestChance 100 なら chestGoldDice の金。通路とボスでは乱数を消費しない", () => {
    const mk = (origin: BattleOpts["origin"], monsterId = "rotting_corpse") => {
      const s = setup([{ monsterId, hps: [1], status: [["paralysis"]] }], { identified: [monsterId], origin });
      s.battle!.inputs["c1"] = atk(0);
      return s;
    };
    const d = dataWith({ combat: { ...ALWAYS_HIT, chestChance: 100 } });
    const room = mk({ kind: "random", inRoom: true });
    const m = cloneRng(room.rng);
    rolls(m, 6);
    chance(m, 100);
    rollDice(m, "1d8");
    chance(m, 100);
    const cg = rollDice(m, "2d10").total;
    const r = exec(room, RESOLVE, d);
    expect(r.state.rng).toEqual(m);
    expect(r.events).toContainEqual({ kind: "message", key: "battle.chest", params: { gold: cg } });
    expect(r.state.gold).toBe(room.gold + cg);
    expect(r.state.dive!.ledger.gold).toBe(cg);
    const corr = mk({ kind: "random", inRoom: false });
    const m2 = cloneRng(corr.rng);
    rolls(m2, 6);
    chance(m2, 100);
    rollDice(m2, "1d8");
    const rc = exec(corr, RESOLVE, d);
    expect(rc.state.rng).toEqual(m2);
    expect(kindsOf(rc.events)).not.toContain("message:battle.chest");
  });

  test("CB-53 全滅: 最後の行動可能者が倒れると battleEnd(wipe)・battle.wipe・battle null・screen dungeon。睡眠だけが残るなら続行", () => {
    const d = dataWith({ combat: ALWAYS_HIT });
    const s = setup([{ monsterId: "kobold", hps: [50] }], {
      identified: ["kobold"],
      patches: { c1: { hp: 1 }, c2: PARA, c3: PARA, c4: PARA, c5: PARA, c6: PARA },
      inputs: { c1: DEF },
    });
    const r = exec(s, RESOLVE, d);
    expect(kindsOf(r.events).slice(-3)).toEqual(["battleEnd", "message:battle.wipe", "screen"]);
    expect(eventsOf(r.events, "battleEnd")).toEqual([{ kind: "battleEnd", result: "wipe" }]);
    expect(r.state.battle).toBeNull();
    expect(r.state.screen).toBe("dungeon");
    expect(exec(r.state, { type: "dungeon.turn", dir: "left" }, d).events[0]?.kind).toBe("turned");
    // 睡眠だけの者が残れば続く
    const sl = patchParty(s, { c2: { status: ["sleep"] } });
    const rs = exec(sl, RESOLVE, d);
    expect(rs.state.battle).not.toBeNull();
    expect(eventsOf(rs.events, "battleEnd")).toEqual([]);
  });

  test("CB-54/CH-45 戦闘中の死亡は即 dead、他の生存者に SAN −10（慎重は −5）。戦闘後も dead のまま", () => {
    const d = dataWith({ combat: ALWAYS_HIT });
    const s = setup([{ monsterId: "kobold", hps: [1], status: [["paralysis"]] }], {
      identified: ["kobold"],
      patches: { c1: { hp: 1 }, c2: PARA, c3: PARA },
      inputs: { c1: DEF, c4: DEF, c5: DEF, c6: DEF },
    });
    s.battle!.groups[0]!.units[0]!.status = [];
    s.battle!.groups[0]!.units[0]!.hp = 80;
    const r = exec(s, RESOLVE, d);
    expect(r.events).toContainEqual({ kind: "lifeChanged", id: "c1", life: "dead" });
    expect(r.events).toContainEqual({ kind: "message", key: "battle.dead", params: { target: "アルド" } });
    expect(eventsOf(r.events, "sanChanged")).toEqual([
      { kind: "sanChanged", id: "c2", delta: -5, san: 95 },
      { kind: "sanChanged", id: "c3", delta: -10, san: 90 },
      { kind: "sanChanged", id: "c4", delta: -10, san: 90 },
      { kind: "sanChanged", id: "c5", delta: -10, san: 90 },
      { kind: "sanChanged", id: "c6", delta: -5, san: 95 },
    ]);
    // 逃げた後も dead
    const out = exec(exec(r.state, input("c4", { type: "flee" }), d).state, RESOLVE, dataWith({ combat: { fleeBase: 1000 } }));
    expect(out.state.battle).toBeNull();
    expect(member(out.state, "c1").life).toBe("dead");
  });
});

describe("網羅（完了条件「6 種と戦える」、敵の id、battleMenu）", () => {
  test("完了条件: d01 の 2 階の encounterTable とボスで、monsters.json の 6 種すべてが出うる", () => {
    const def = data.dungeons.find((x) => x.id === "d01")!;
    const ids = new Set([...def.encounterTable["2"]!.filter((e) => e.weight > 0).map((e) => e.monster), def.boss.monster]);
    expect([...ids].sort()).toEqual(data.monsters.map((m) => m.id).sort());
    expect(data.monsters).toHaveLength(6);
  });

  test.each(data.monsters.map((m) => m.id))("完了条件「6 種と戦える」%s: 1 グループで戦闘を始め、オートで battleEnd（win か wipe）まで例外なく回る。敵の id は e{g}-{u}", (monsterId) => {
    for (let seed = 1; seed <= 5; seed++) {
      const s0 = dived(seed);
      const m = monsterOf(data, monsterId);
      const ctx = runCtx(s0, data, (c) =>
        m.special.boss === true ? startBossEncounter(c) : startBattle(c, { kind: "random", inRoom: true }, [{ monsterId, count: 2 }]),
      );
      const all: GameEvent[] = [...ctx.events];
      let s = ctx.state;
      if (s.battle !== null) {
        const res = autoUntilEnd(s, data, 200);
        all.push(...res.events);
        s = res.state;
      }
      expect(s.battle).toBeNull();
      const ends = eventsOf(all, "battleEnd");
      expect(ends).toHaveLength(1);
      expect(["win", "wipe"]).toContain(ends[0]!.result);
      for (const e of all) {
        const ids =
          e.kind === "attack" ? [e.actorId, e.targetId] : e.kind === "hpChanged" || e.kind === "lifeChanged" || e.kind === "statusChanged" ? [e.id] : [];
        for (const id of ids) expect(id).toMatch(/^(c[1-6]|e\d+-\d+)$/);
      }
      expect(eventsOf(all, "lifeChanged").some((e) => /^e\d+-\d+$/.test(e.id)) || ends[0]!.result === "wipe").toBe(true);
    }
  });

  test("UI-54 battleMenu: pending・ready・canFlee・spells の usable・items・allies。オート中は pending []、戦闘外は null", () => {
    let s = setup([{ monsterId: "giant_rat", hps: [5] }, { monsterId: "kobold", hps: [0] }], {
      inputs: {},
      patches: { c5: { mp: 2 }, c6: DEAD, c3: PARA },
    });
    let menu = battleMenu(s, data)!;
    expect(menu.round).toBe(0);
    expect(menu.auto).toBe(false);
    expect(menu.canFlee).toBe(true);
    expect(menu.ready).toBe(false);
    expect(menu.pending).toEqual(["c1", "c2", "c4", "c5"]);
    expect(menu.groups.map((g) => g.count)).toEqual([1, 0]);
    expect(menu.members.map((x) => [x.id, x.canAct, x.canStrike])).toEqual([
      ["c1", true, true],
      ["c2", true, true],
      ["c3", false, true],
      ["c4", true, false],
      ["c5", true, false],
      ["c6", false, true],
    ]);
    expect(menu.members[4]!.spells).toEqual([
      { spellId: "fire_arrow", name: "火矢", mp: 2, target: "enemy", usable: true },
      { spellId: "sleep_mist", name: "眠りの霧", mp: 3, target: "enemyGroup", usable: false },
    ]);
    expect(menu.members[4]!.items).toEqual([]); // 帰還の糸は戦闘で使えない
    expect(menu.members[0]!.items).toEqual([{ instanceId: "i4", itemId: "herb", name: "薬草", target: "ally" }]);
    expect(menu.allies.map((a) => a.id)).toEqual(["c1", "c2", "c3", "c4", "c5"]);
    expect(menu.members[0]!.input).toBeNull();
    for (const id of ["c1", "c2", "c4", "c5"]) s = exec(s, input(id, DEF)).state;
    menu = battleMenu(s, data)!;
    expect(menu.ready).toBe(true);
    expect(menu.pending).toEqual([]);
    expect(menu.members[0]!.input).toEqual(DEF);
    const auto = exec(setup([{ monsterId: "giant_rat", hps: [5] }], { inputs: {} }), AUTO_ON).state;
    expect(battleMenu(auto, data)!.pending).toEqual([]);
    expect(battleMenu(auto, data)!.ready).toBe(true);
    const boss = setup([{ monsterId: "gatekeeper_armor", hps: [50] }], { origin: { kind: "boss" }, inputs: {} });
    expect(battleMenu(boss, data)!.canFlee).toBe(false);
    expect(battleMenu(dived(1), data)).toBeNull();
  });

  test("§3-2 決定性: battle.resolve を同じ state で 2 回呼ぶと deep-equal、引数の state を書き換えない、JSON 往復で変わらない", () => {
    const s = setup([{ monsterId: "giant_rat", hps: [5, 5] }, { monsterId: "kobold", hps: [4] }], { inputs: {}, auto: true });
    const before = JSON.stringify(s);
    const a = execute(s, RESOLVE, data);
    const b = execute(s, RESOLVE, data);
    expectKnownStringKeys(a.events);
    expect(a.events[0]?.kind).not.toBe("rejected");
    expect(a).toEqual(b);
    expect(JSON.stringify(s)).toBe(before);
    expect(JSON.parse(JSON.stringify(a.state))).toEqual(a.state);
  });
});
