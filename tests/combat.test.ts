// rules/combat.ts（遭遇・入力・ラウンドの解決・勝敗）のテスト。RuleContext と execute 経由、固定シード。
// 乱数は「鏡の rng」: cloneRng(state.rng) に設計の消費順どおり randInt / rollDie / rollDice / weightedIndex を呼び、
// 期待の出目と最終の rng を作って execute 後の state.rng と toEqual する。
// 出目に依存させたくない検証は config を上書きした data（必中・必ず外れ・奇襲なし等）を使う。
import { describe, expect, test } from "vitest";
import type { GameData } from "../src/core/data";
import { execute } from "../src/core/engine";
import { chance, cloneRng, randInt, rollDice, rollDie, weightedIndex, type RngState } from "../src/core/rng";
import { allyAc, canAct, statusPercent } from "../src/core/rules/combat-calc";
import { autoInput } from "../src/core/rules/combat-plan";
import { battleMenu, beatSwitchForTests, startBattle, startBossEncounter, startRandomEncounter } from "../src/core/rules/combat";
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
  withoutBeats,
  type BattleOpts,
  type GroupSpec,
} from "./helpers/battle";
import { data, expectKnownStringKeys, noAmbushAvoid, noBenefits, noSanOverride } from "./helpers/core";

const RESOLVE: Command = { type: "battle.resolve" };
const DEF: BattleAction = { type: "defend" };
const AUTO_ON: Command = { type: "battle.auto", on: true };
const FLEE: Command = { type: "battle.flee" };
const REPEAT: Command = { type: "battle.repeat" };
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
/** 生存しているが敵の対象にならない（CB-15: 石化は除く）。対象を 1 人に絞るのに使う */
const STONE = { status: ["stone" as const] };
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
      expect(dice.map((x) => x.label.key)).toEqual(["dice.initiative"]);
      expect(dice.flatMap((x) => x.rows.map((row) => row.dice))).toEqual([[rP], [rE]]);
      expect(kindsOf(ctx.events).slice(0, 4)).toEqual(["screen", "beat", "encounter", "message:battle.encounter"]);
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

  test("CB-04/UI-40 先手判定の dice は 1 件 2 行（base = floor(平均)、total = base + 出目）。rule は {diff: tP−tE, need, ambush: need}。差が surpriseDiff に届かなければ互角", () => {
    const d = dataWith({ combat: { surpriseDiff: 1000 } });
    const s0 = dived(3);
    const ctx = runCtx(s0, d, (c) => startBattle(c, { kind: "random", inRoom: false }, [{ monsterId: "giant_rat", count: 2 }]));
    const m = cloneRng(s0.rng);
    rollDice(m, "1d6");
    rollDice(m, "1d6");
    const [rP, rE] = rolls(m, 2);
    expect(eventsOf(ctx.events, "dice")).toEqual([
      {
        kind: "dice",
        label: { key: "dice.initiative" },
        rows: [
          { label: { key: "dice.side.party" }, base: 10, dice: [rP], total: 10 + rP! }, // 65/6 = 10.83
          { label: { key: "dice.side.enemy" }, base: 9, dice: [rE], total: 9 + rE! },
        ],
        rule: { key: "dice.initiative.rule", params: { diff: 10 + rP! - (9 + rE!), need: 1000, ambush: 1000 } },
        result: { key: "dice.initiative.none" },
      },
    ]);
    expect(ctx.state.battle!.partySurprise).toBe(false);
    expect(kindsOf(ctx.events)).not.toContain("message:battle.surpriseParty");
    expect(kindsOf(ctx.events)).not.toContain("message:battle.surpriseEnemy");
    expect(ctx.state.rng).toEqual(m);
  });

  test("CB-04 境界: 整数の合計の差で比べる。diff = need で先手、diff = −need で不意打ち、|diff| = need − 1 なら互角（乱数の消費は同じ）", () => {
    // 味方の agi 平均 65/6 = 10.83 → 10、giant_rat の agi 9 → 9。鏡の rng で diff = (10 + rP) − (9 + rE) を求め、
    // 正と負の diff（|diff| ≥ 2）が出るシードを探して、そこに surpriseDiff を合わせる
    const start = (seed: number, need: number) =>
      // noAmbushAvoid: 敵の奇襲の境界を見るので、慎重の取り消し（A1）の d100 を引かない
      runCtx(dived(seed), dataWith({ combat: { surpriseDiff: need } }, noAmbushAvoid), (c) =>
        startBattle(c, { kind: "random", inRoom: false }, [{ monsterId: "giant_rat", count: 2 }]),
      );
    const diffOf = (seed: number): number => {
      const m = cloneRng(dived(seed).rng);
      rollDice(m, "1d6");
      rollDice(m, "1d6");
      const [rP, rE] = rolls(m, 2);
      return 10 + rP! - (9 + rE!);
    };
    const seeds = Array.from({ length: 60 }, (_, i) => i + 1);
    const pos = seeds.find((x) => diffOf(x) >= 2)!;
    const neg = seeds.find((x) => diffOf(x) <= -2)!;
    expect(pos).toBeDefined();
    expect(neg).toBeDefined();
    const resultOf = (ctx: ReturnType<typeof start>) => eventsOf(ctx.events, "dice")[0]!.result.key;

    const dp = diffOf(pos);
    const p1 = start(pos, dp);
    expect(resultOf(p1)).toBe("dice.initiative.party");
    expect(eventsOf(p1.events, "dice")[0]!.rule.params).toEqual({ diff: dp, need: dp, ambush: dp });
    expect(p1.state.battle!.partySurprise).toBe(true);
    expect(kindsOf(p1.events)).toContain("message:battle.surpriseParty");
    const p0 = start(pos, dp + 1);
    expect(resultOf(p0)).toBe("dice.initiative.none");
    expect(p0.state.battle!.partySurprise).toBe(false);
    expect(kindsOf(p0.events).filter((k) => k.startsWith("message:battle.surprise"))).toEqual([]);

    // 小数のまま比べると (10.83 + rP) − (9 + rE) = diff + 0.83 > −need なので不意打ちにならなかった境界
    const dn = diffOf(neg);
    const n1 = start(neg, -dn);
    expect(resultOf(n1)).toBe("dice.initiative.enemy");
    expect(kindsOf(n1.events)).toContain("message:battle.surpriseEnemy");
    expect(n1.state.battle!.round).toBe(1);
    const n0 = start(neg, -dn + 1);
    expect(resultOf(n0)).toBe("dice.initiative.none");
    expect(n0.state.battle!.round).toBe(0);
    // 判定までの乱数の消費は need に依らない（互角なら先手判定で止まる）
    const m = cloneRng(dived(pos).rng);
    rollDice(m, "1d6");
    rollDice(m, "1d6");
    rolls(m, 2);
    expect(p0.state.rng).toEqual(m);
    expect(p1.state.rng).toEqual(m);
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
    const rf = exec(s, FLEE, d);
    expect(kindsOf(rf.events)).toContain("message:battle.fleeFail");
    expect(eventsOf(rf.events, "attack").filter((e) => e.actorId.startsWith("e"))).toHaveLength(2);
    expect(rf.state.battle!.partySurprise).toBe(false);
  });

  test("CB-04 敵の奇襲: 遭遇の execute の中で敵だけのラウンドを解決する（round 1、味方の attack なし、inputs は {}）", () => {
    // noAmbushAvoid: 慎重の取り消し（A1）を外して敵の奇襲ラウンドを見る（取り消しは CB-04/EV-42 のテスト）
    const d = dataWith({ combat: ALWAYS_HIT }, (x) => {
      x.monsters.find((m) => m.id === "giant_rat")!.agi = 1000;
      noAmbushAvoid(x);
    });
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

  /** 敵の奇襲が必ず成立する data（大ネズミ agi 1000、必中）。mut でさらに書き換える */
  const ambushD = (mut?: (x: GameData) => void) =>
    dataWith({ combat: ALWAYS_HIT }, (x) => {
      x.monsters.find((m) => m.id === "giant_rat")!.agi = 1000;
      mut?.(x);
    });
  const ambushStart = (s0: GameState, d: GameData) =>
    runCtx(s0, d, (c) => startBattle(c, { kind: "random", inRoom: false }, [{ monsterId: "giant_rat", count: 2 }]));
  /** 鏡: 大ネズミ 2 体の HP（1d6×2）→ 先手の 1d10×2 まで進めた rng */
  const afterInitiative = (s0: GameState): RngState => {
    const m = cloneRng(s0.rng);
    rollDice(m, "1d6");
    rollDice(m, "1d6");
    rolls(m, 2);
    return m;
  };

  test("CB-04/EV-42 敵の奇襲が成立し慎重が行動可能なら d100 を 1 回、≤ 20 で取り消し（dice.ambushAvoid{ベルク}・battle.ambushAvoided・round 0）、> 20 なら敵だけのラウンド（鏡の rng）", () => {
    const d = ambushD();
    const d100Of = (seed: number) => randInt(afterInitiative(dived(seed)), 1, 100);
    const seeds = Array.from({ length: 200 }, (_, i) => i + 1);
    const okSeed = seeds.find((x) => d100Of(x) <= 20)!;
    const ngSeed = seeds.find((x) => d100Of(x) > 20)!;
    expect(okSeed).toBeDefined();
    expect(ngSeed).toBeDefined();
    const diceOf = (roll: number, ok: boolean) => ({
      kind: "dice",
      label: { key: "dice.ambushAvoid", params: { name: "ベルク" } },
      rows: [{ label: { key: "dice.row.roll" }, base: null, dice: [roll], total: roll }],
      rule: { key: "dice.rule.rate", params: { rate: 20 } },
      result: { key: ok ? "dice.ambushAvoid.ok" : "dice.ambushAvoid.ng" },
    });

    // 取り消し: 先手の dice は不意打ちのまま、続けて取り消しの dice と battle.ambushAvoided。敵は行動せず round 0
    const s1 = dived(okSeed);
    const m1 = afterInitiative(s1);
    const r1 = randInt(m1, 1, 100);
    const ok = ambushStart(s1, d);
    expect(ok.state.rng).toEqual(m1);
    const dice1 = eventsOf(ok.events, "dice");
    expect(dice1.map((x) => x.result.key)).toEqual(["dice.initiative.enemy", "dice.ambushAvoid.ok"]);
    expect(dice1[1]).toEqual(diceOf(r1, true));
    expect(dice1[0]!.rule.params).toMatchObject({ ambush: data.config.combat.surpriseDiff }); // A1: ambush = need
    expect(ok.events.at(-1)).toEqual({ kind: "message", key: "battle.ambushAvoided", params: { name: "ベルク" } });
    expect(kindsOf(ok.events)).toContain("message:battle.surpriseEnemy");
    expect(ok.state.battle!.round).toBe(0);
    expect(ok.state.battle!.partySurprise).toBe(false);
    expect(eventsOf(ok.events, "attack")).toEqual([]);

    // 失敗: 取り消しの dice（ng）だけで、その後に敵だけのラウンド
    const s2 = dived(ngSeed);
    const m2 = afterInitiative(s2);
    const r2 = randInt(m2, 1, 100);
    const ng = ambushStart(s2, d);
    expect(eventsOf(ng.events, "dice")[1]).toEqual(diceOf(r2, false));
    expect(kindsOf(ng.events)).not.toContain("message:battle.ambushAvoided");
    expect(ng.state.battle!.round).toBe(1);
    expect(eventsOf(ng.events, "attack").map((a) => a.actorId).sort()).toEqual(["e0-0", "e0-1"]); // 順は敵の initiative 次第
    // 取り消しの d100 は先手の 2 個の直後、敵の initiative より前（noAmbushAvoid の列と比べて 1 個だけ多い）
    const plain = ambushStart(s2, ambushD(noAmbushAvoid));
    expect(eventsOf(plain.events, "dice")).toHaveLength(1);
    expect(eventsOf(plain.events, "attack").length).toBeGreaterThan(0);
  });

  test("CB-04 ambushAvoid は行動可能な者の最大（合計しない）、名前は並び順の先。慎重が行動不能・先手・互角では振らない", () => {
    const s0 = dived(1);
    const avoidDice = (ctx: ReturnType<typeof ambushStart>) => eventsOf(ctx.events, "dice").filter((x) => x.label.key === "dice.ambushAvoid");
    const greedy = (v: number) => (x: GameData) => (x.personalities.find((p) => p.id === "greedy")!.benefits.ambushAvoid = v);
    // 強欲 30・慎重 20 ×2 → 最大の 30（合計の 70 ではない）、名前はドナ
    const g30 = avoidDice(ambushStart(s0, ambushD(greedy(30))));
    expect(g30).toHaveLength(1);
    expect(g30[0]!.label.params).toEqual({ name: "ドナ" });
    expect(g30[0]!.rule.params).toEqual({ rate: 30 });
    // 同値（強欲 20・慎重 20）は並び順が前のベルク（c2）
    expect(avoidDice(ambushStart(s0, ambushD(greedy(20))))[0]!.label.params).toEqual({ name: "ベルク" });
    // ベルクが行動不能ならフィン（c6）
    const bergPara = patchParty(s0, { c2: PARA });
    expect(avoidDice(ambushStart(bergPara, ambushD()))[0]!.label.params).toEqual({ name: "フィン" });
    // 慎重が 2 人とも行動不能: 振らない（d100 を引かず、そのまま敵の奇襲ラウンド）
    const bothPara = patchParty(s0, { c2: PARA, c6: PARA });
    const none = ambushStart(bothPara, ambushD());
    expect(avoidDice(none)).toEqual([]);
    expect(none.state.rng).toEqual(ambushStart(bothPara, ambushD(noAmbushAvoid)).state.rng);
    expect(none.state.battle!.round).toBe(1);
    // 先手・互角では振らない（rng は先手の 2 個まで）
    for (const surpriseDiff of [-1000, 1000]) {
      const ctx = runCtx(s0, dataWith({ combat: { surpriseDiff } }), (c) =>
        startBattle(c, { kind: "random", inRoom: false }, [{ monsterId: "giant_rat", count: 2 }]),
      );
      expect(avoidDice(ctx)).toEqual([]);
      expect(ctx.state.rng).toEqual(afterInitiative(s0));
    }
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
    const out = exec(r.state, FLEE, d);
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
    expect(ks.slice(at, at + 6)).toEqual(["lifeChanged", "message:battle.dead", "message:battle.identified", "enemyGroups", "beat", "battleEnd"]);
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

  test("CB-10 未入力が残ると battle.resolve は inputs incomplete（同じ参照・乱数なし）", () => {
    let s = base();
    expectRejected(s, RESOLVE, "inputs incomplete");
    for (const id of ["c1", "c2", "c3", "c4", "c5"]) s = exec(s, input(id, DEF)).state;
    expectRejected(s, RESOLVE, "inputs incomplete");
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

  test("CB-12 battle.input の rejected: 知らない呪文、MP 不足、field の呪文、他人の道具、全滅したグループ、死んだ味方への heal、行動不能、オート中、不正な形（flee は BattleAction に無い）", () => {
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
      [input("c1", { type: "flee" } as unknown as BattleAction), "bad action"], // CB-12: 逃走は battle.flee
    ];
    for (const [cmd, reason] of cases) expectRejected(s, cmd, reason);
    const auto = setup([{ monsterId: "giant_rat", hps: [5] }], { auto: true, inputs: {} });
    expectRejected(auto, input("c1", DEF), "auto on");
  });

  test("CB-12/40 再入力は上書き。lastBattleInput は手入力だけ保存する。イベントは出さない", () => {
    let s = base();
    const r1 = exec(s, input("c1", atk(0)));
    expect(r1.events).toEqual([]);
    s = r1.state;
    expect(member(s, "c1").lastBattleInput).toEqual(atk(0));
    s = exec(s, input("c1", DEF)).state;
    expect(s.battle!.inputs["c1"]).toEqual(DEF);
    expect(member(s, "c1").lastBattleInput).toEqual(DEF);
    // 余計な欄は保存しない
    s = exec(s, input("c5", { type: "cast", spellId: "fire_arrow", target: { side: "enemy", group: 0, x: 1 } } as unknown as BattleAction)).state;
    expect(member(s, "c5").lastBattleInput).toEqual({ type: "cast", spellId: "fire_arrow", target: { side: "enemy", group: 0 } });
    // オートの入力は lastBattleInput を変えない
    const a = exec(exec(base(), AUTO_ON).state, RESOLVE);
    expect(a.state.party.map((c) => c.lastBattleInput)).toEqual(base().party.map((c) => c.lastBattleInput));
  });

  test("CB-12 group に -0 を渡しても inputs と lastBattleInput には 0 で保存する（JSON の往復で同値。-0 を state に入れない）", () => {
    let s = exec(base(), input("c1", { type: "attack", group: -0 })).state;
    s = exec(s, input("c5", { type: "cast", spellId: "fire_arrow", target: { side: "enemy", group: -0 } })).state;
    const b = s.battle!;
    const a1 = b.inputs["c1"]!;
    const a5 = b.inputs["c5"]!;
    expect(a1.type === "attack" && Object.is(a1.group, 0)).toBe(true);
    expect(a5.type === "cast" && a5.target.side === "enemy" && Object.is(a5.target.group, 0)).toBe(true);
    const l1 = member(s, "c1").lastBattleInput!;
    expect(l1.type === "attack" && Object.is(l1.group, 0)).toBe(true);
    expect(JSON.parse(JSON.stringify(s))).toStrictEqual(s);
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
        patches: { c2: STONE, c3: STONE },
        inputs: { c1: DEF, c4: atk(0), c5: DEF, c6: DEF },
      });
      const m = cloneRng(s.rng);
      rolls(m, 5); // 味方 4 人（c1,c4,c5,c6）+ コボルド 1 体
      randInt(m, 0, 0); // 対象（候補は c1 だけ）
      chance(m, 100);
      const dmg = Math.max(1, rollDice(m, "1d4").total); // コボルドの攻撃 1d4【仮】
      const r = exec(s, RESOLVE, d);
      expect(r.state.rng).toEqual(m);
      expect(eventsOf(r.events, "attack")).toEqual([{ kind: "attack", actorId: "e0-0", targetId: "c1", hit: true, damage: Math.ceil(dmg / 2) }]);
      expect(r.events).toContainEqual({ kind: "message", key: "battle.backRowCannotAttack", params: { actor: "ドナ" } });
      expect(member(r.state, "c1").hp).toBe(15 - Math.ceil(dmg / 2)); // アルドの hpMax 15（CH-65）
    }
  });

  test("CB-13 フィン（short_bow）は後衛でも攻撃する（命中判定が走り attack が出る）", () => {
    const s = setup([{ monsterId: "giant_rat", hps: [50], status: [["paralysis"]] }], { identified: ["giant_rat"] });
    s.battle!.inputs["c6"] = atk(0);
    const r = exec(s, RESOLVE);
    expect(eventsOf(r.events, "attack").map((e) => e.actorId)).toEqual(["c6"]);
  });

  test("CB-14 前衛 3 人が行動不能（石化 2・麻痺 1）なら敵の対象は後衛だけで、ドナの attack は攻撃として解決する。前衛 1 人の麻痺を外すと戻る", () => {
    const d = dataWith({ combat: ALWAYS_HIT });
    const targets = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const s = setup([{ monsterId: "kobold", hps: [80] }], {
        seed,
        identified: ["kobold"],
        patches: { c1: STONE, c2: PARA, c3: STONE, c4: { hp: 50, hpMax: 50 }, c5: { hp: 50, hpMax: 50 }, c6: { hp: 50, hpMax: 50 } },
        inputs: { c4: atk(0), c5: DEF, c6: DEF },
      });
      const r = exec(s, RESOLVE, d);
      const as = eventsOf(r.events, "attack");
      expect(as.filter((a) => a.actorId === "c4")).toHaveLength(1);
      for (const a of as.filter((x) => x.actorId === "e0-0")) targets.add(a.targetId);
      expect(kindsOf(r.events)).not.toContain("message:battle.backRowCannotAttack");
      // 前衛 1 人（ベルク）の麻痺を外すと元に戻る（石化のアルドとキリは CB-15 で除くので対象はベルクだけ）
      const back = patchParty(s, { c2: { status: [] } });
      back.battle!.inputs["c2"] = DEF;
      const rb = exec(back, RESOLVE, d);
      expect(eventsOf(rb.events, "attack").filter((a) => a.actorId === "e0-0").map((a) => a.targetId)).toEqual(["c2"]);
      expect(rb.events).toContainEqual({ kind: "message", key: "battle.backRowCannotAttack", params: { actor: "ドナ" } });
    }
    expect([...targets].sort()).toEqual(["c4", "c5", "c6"]);
  });

  test("CB-15 眠った前衛も狙われる（前衛の生存者から randInt。鏡の rng）。前衛扱いの全員が睡眠でも狙われ、被弾で覚醒判定（CB-32 の味方側）", () => {
    const d = dataWith({ combat: { ...ALWAYS_HIT, sleepWakeChance: 100 } });
    const seen = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const s = setup([{ monsterId: "giant_rat", hps: [80] }], {
        seed,
        identified: ["giant_rat"],
        patches: { c2: { status: ["sleep"], hp: 50, hpMax: 50 }, c1: { hp: 50, hpMax: 50 }, c3: { hp: 50, hpMax: 50 } },
        inputs: { c1: DEF, c3: DEF, c4: DEF, c5: DEF, c6: DEF },
      });
      const m = cloneRng(s.rng);
      rolls(m, 6); // 味方 5 人（眠ったベルクは振らない）+ 大ネズミ 1 体
      const want = ["c1", "c2", "c3"][randInt(m, 0, 2)]!; // 候補は前衛の生存者 3 人（睡眠を含む）
      chance(m, 100); // 必中
      rollDice(m, "1d3");
      if (want === "c2") chance(m, 100); // 被弾の覚醒判定（sleepWakeChance 100）で必ず覚める
      else chance(m, d.config.combat.sleepNaturalWake); // 眠ったままならラウンド終了の自然覚醒（CB-32）
      const r = exec(s, RESOLVE, d);
      expect(r.state.rng).toEqual(m);
      const as = eventsOf(r.events, "attack");
      expect(as.map((x) => x.targetId)).toEqual([want]);
      seen.add(want);
    }
    expect([...seen].sort()).toEqual(["c1", "c2", "c3"]);
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

  test("CB-15 対象の候補が空なら敵は何もしない（対象の乱数も消費しない）。眠った前衛だけが生き残り、前衛扱いが後衛（全員死亡）に移った場合", () => {
    const d = dataWith({ combat: ALWAYS_HIT });
    const s = setup([{ monsterId: "giant_rat", hps: [80] }], {
      identified: ["giant_rat"],
      patches: { c1: { status: ["sleep"] }, c2: DEAD, c3: DEAD, c4: DEAD, c5: DEAD, c6: DEAD },
      inputs: {},
    });
    const m = cloneRng(s.rng);
    rolls(m, 1); // 大ネズミの initiative だけ（行動可能な味方はいない）
    chance(m, d.config.combat.sleepNaturalWake); // ラウンド終了の自然覚醒（CB-32）: 眠ったアルド
    const r = exec(s, RESOLVE, d);
    expect(r.state.rng).toEqual(m);
    expect(eventsOf(r.events, "attack")).toEqual([]);
    expect(r.state.battle).not.toBeNull(); // 睡眠だけなので全滅ではない（CB-53）
  });

  test("CB-16 行動の時点で行動不能（先に死んだ）なら飛ばす。倒された敵の個体も行動しない", () => {
    const fast = dataWith({ combat: ALWAYS_HIT }, (x) => (x.monsters.find((m) => m.id === "kobold")!.agi = 1000));
    // コボルドが先に動いてアルド（HP 1、唯一の前衛の行動可能者）を倒す → アルドの攻撃は出ない
    const s = setup([{ monsterId: "kobold", hps: [80] }], {
      identified: ["kobold"],
      patches: { c1: { hp: 1 }, c2: STONE, c3: STONE },
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

describe("行動順（CB-11）", () => {
  test("CB-11 ラウンド開始時に眠っている（麻痺の）敵の個体は initiative の 1d10 を振らない（鏡の rng: 味方 6 人分だけ）", () => {
    const s = setup(
      [
        { monsterId: "kobold", hps: [80, 80], status: [["sleep"], ["paralysis"]] },
        { monsterId: "giant_rat", hps: [80], status: [["sleep"]] },
      ],
      { identified: ["kobold", "giant_rat"] },
    );
    const m = cloneRng(s.rng);
    rolls(m, 6); // 味方 6 人（全員 defend）。敵 3 体は行動不能なので振らない
    chance(m, data.config.combat.sleepNaturalWake); // ラウンド終了の自然覚醒（CB-32）: 眠った e0-0
    chance(m, data.config.combat.sleepNaturalWake); // 同: 眠った e1-0（麻痺だけの e0-1 は振らない）
    const r = exec(s, RESOLVE);
    expect(r.state.rng).toEqual(m);
    expect(eventsOf(r.events, "attack")).toEqual([]);
  });

  test("CB-11/CB-32 眠った敵は、同じラウンドの中で被弾して覚めても、そのラウンドは行動しない", () => {
    const d = dataWith({ combat: { ...ALWAYS_HIT, sleepWakeChance: 100 } }, (x) => (x.monsters.find((m) => m.id === "kobold")!.agi = -1000));
    const s = setup([{ monsterId: "kobold", hps: [80], status: [["sleep"]] }], {
      identified: ["kobold"],
      patches: { c2: PARA, c3: PARA },
      inputs: { c1: atk(0), c4: DEF, c5: DEF, c6: DEF },
    });
    const r = exec(s, RESOLVE, d);
    expect(r.events).toContainEqual({ kind: "statusChanged", id: "e0-0", status: "sleep", on: false });
    expect(r.state.battle!.groups[0]!.units[0]!.status).toEqual([]);
    const actors = eventsOf(r.events, "attack").map((e) => e.actorId);
    expect(actors.length).toBeGreaterThan(0);
    expect(actors.every((a) => a === "c1")).toBe(true);
    // 次のラウンドでは行動する（agi −1000 なので最後）
    const next = exec(r.state, { type: "battle.input", memberId: "c1", action: DEF }, d).state;
    let n = next;
    for (const id of ["c4", "c5", "c6"]) n = exec(n, { type: "battle.input", memberId: id, action: DEF }, d).state;
    const r2 = exec(n, RESOLVE, d);
    expect(eventsOf(r2.events, "attack").map((e) => e.actorId)).toEqual(["e0-0"]);
  });

  test("CB-11/EV-42 無鉄砲（キリ c3）の initiative は agi + 1d10 + 2。敵の init がキリの恩恵なしの値 +1 なら、恩恵ありはキリが先、noBenefits では敵が先", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const s = setup([{ monsterId: "kobold", hps: [80] }], {
        seed,
        identified: ["kobold"],
        patches: { c1: PARA, c2: PARA, c4: PARA, c5: PARA, c6: PARA },
        inputs: { c3: atk(0) },
      });
      const m = cloneRng(s.rng);
      const rK = rollDie(m, 10); // キリ
      const rE = rollDie(m, 10); // コボルド
      // 敵の init = agi + rE = (15 + rK) + 1（キリの恩恵なしの init より 1 大きく、恩恵込み 15 + rK + 2 より 1 小さい）
      const enemyAgi = 15 + rK + 1 - rE;
      const setAgi = (x: GameData) => (x.monsters.find((mm) => mm.id === "kobold")!.agi = enemyAgi);
      const first = (d: GameData) => eventsOf(exec(s, RESOLVE, d).events, "attack")[0]!.actorId;
      expect(first(dataWith({ combat: ALWAYS_HIT }, setAgi))).toBe("c3");
      expect(
        first(
          dataWith({ combat: ALWAYS_HIT }, (x) => {
            setAgi(x);
            noBenefits(x);
          }),
        ),
      ).toBe("e0-0");
    }
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
      // CB-55: 宣言（attackDeclare{actor}）と結果（hit{target, damage}）に分けた文言
      expect(h.events).toContainEqual({ kind: "message", key: "battle.attackDeclare", params: { actor: "アルド" } });
      expect(h.events).toContainEqual({ kind: "message", key: "battle.hit", params: { target: "大ネズミ", damage: dmg } });
      expect(h.state.rng).toEqual(afterHit);
      // 命中率 = r − 1
      const missData = dataWith({ combat: { hitMin: 0, hitMax: 100, hitBase: r - 42 } });
      const mi = exec(s, RESOLVE, missData);
      expect(eventsOf(mi.events, "attack")).toEqual([{ kind: "attack", actorId: "c1", targetId: "e0-0", hit: false, damage: 0 }]);
      expect(mi.events).toContainEqual({ kind: "message", key: "battle.attackDeclare", params: { actor: "アルド" } });
      expect(mi.events).toContainEqual({ kind: "message", key: "battle.miss", params: { target: "大ネズミ" } });
      expect(mi.state.rng).toEqual(m);
    }
  });

  test("CB-22/EV-42 無鉄砲（キリ c3、短剣 1d4、力 8 で補正 −1）のダメージは 1d4 − 1 + 1、最低 1。noBenefits では 1d4 − 1（最低 1）。リーダーは +0（CB-21/22 のアルドの式のまま）", () => {
    const seen = new Set<number>();
    for (let seed = 1; seed <= 12; seed++) {
      const s = setup([{ monsterId: "giant_rat", hps: [50], status: [["paralysis"]] }], {
        seed,
        identified: ["giant_rat"],
        patches: { c1: PARA, c2: PARA, c4: PARA, c5: PARA, c6: PARA },
        inputs: { c3: atk(0) },
      });
      const m = cloneRng(s.rng);
      rolls(m, 1); // キリだけ（麻痺のネズミは振らない）
      chance(m, 100);
      const raw = rollDice(m, "1d4").total;
      seen.add(raw);
      const r = exec(s, RESOLVE, dataWith({ combat: ALWAYS_HIT }));
      expect(r.state.rng).toEqual(m);
      expect(eventsOf(r.events, "attack")).toEqual([{ kind: "attack", actorId: "c3", targetId: "e0-0", hit: true, damage: Math.max(1, raw - 1 + 1) }]);
      const n = exec(s, RESOLVE, dataWith({ combat: ALWAYS_HIT }, noBenefits));
      expect(eventsOf(n.events, "attack")[0]!.damage).toBe(Math.max(1, raw - 1));
    }
    expect(seen.has(1)).toBe(true); // 出目 1 で恩恵なしは最低 1 に切り上がる場合を含む
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
      patches: { c1, c2: STONE, c3: STONE },
      inputs: { c1: DEF, c4: DEF, c5: DEF, c6: DEF },
    });

  test("CB-30/F8 大蜘蛛の毒: 出目 ≤ 20 − (9 − 10) × 2 = 22 で付与（鏡の rng）。毒はラウンド終了で −1", () => {
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
      const poisoned = roll <= statusPercent(data.config, 20, 9);
      const r = exec(s, RESOLVE, d);
      expect(r.state.rng).toEqual(m);
      expect(member(r.state, "c1").status).toEqual(poisoned ? ["poison"] : []);
      expect(member(r.state, "c1").hp).toBe(15 - dmg - (poisoned ? 1 : 0)); // アルドの hpMax 15（CH-65）
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
    // ラウンド終了の自然覚醒（CB-32）: 眠っている個体ごとに添字順で 1 回
    const asleep = [...(a ? ["e0-0"] : []), "e0-1", ...(b ? ["e0-2"] : [])];
    const woke = asleep.filter(() => chance(m2, data.config.combat.sleepNaturalWake));
    const r2 = exec(rats, RESOLVE);
    expect(r2.state.rng).toEqual(m2);
    const on = eventsOf(r2.events, "statusChanged").filter((e) => e.on).map((e) => e.id);
    expect(on).toEqual([...(a ? ["e0-0"] : []), ...(b ? ["e0-2"] : [])]);
    expect(eventsOf(r2.events, "statusChanged").filter((e) => !e.on).map((e) => e.id)).toEqual(woke);
    expect(kindsOf(r2.events)).toContain(a || b ? "message:battle.status.sleep" : "message:battle.noEffect");
  });

  test("CB-31 囁く影の sanDrain 4（battle.sanDrain）、無鉄砲は fear 耐性で 2。SAN 0 で行動不能", () => {
    // noSanOverride: SAN 2（錯乱）のキリの防御が CB-45 で置き換わらないようにする（耐性の量だけを見る）
    const d = dataWith({ combat: ALWAYS_HIT }, noSanOverride);
    const shadow = (patches: Record<string, Partial<Character>>, inputs: Record<string, BattleAction>) =>
      setup([{ monsterId: "whispering_shadow", hps: [50] }], { identified: ["whispering_shadow"], patches, inputs });
    const lead = exec(shadow({ c2: STONE, c3: STONE }, { c1: DEF, c4: DEF, c5: DEF, c6: DEF }), RESOLVE, d);
    expect(eventsOf(lead.events, "sanChanged")).toEqual([{ kind: "sanChanged", id: "c1", delta: -4, san: 96 }]);
    expect(lead.events).toContainEqual({ kind: "message", key: "battle.sanDrain", params: { target: "アルド" } });
    const reck = exec(shadow({ c1: STONE, c2: STONE, c3: { san: 2 } }, { c3: DEF, c4: DEF, c5: DEF, c6: DEF }), RESOLVE, d);
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
    const stay = exec(s, RESOLVE, dataWith({ combat: { ...base, sleepWakeChance: 0, sleepNaturalWake: 0 } })); // 自然覚醒（CB-32）も 0 にして眠ったままにする
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
    chance(m, 0); // CB-51: 通路の遭遇の宝箱の判定（chestChanceCorridor 0 で外れ）
    const k = exec(kill, RESOLVE, dataWith({ combat: { ...base, sleepWakeChance: 100, chestChanceCorridor: 0 } }));
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

  test("CB-32 ラウンド終了の自然覚醒: 並び順の味方 → グループ → 個体の順に、眠っている者ごとに sleepNaturalWake% を 1 回（鏡の rng）。死者と倒れた個体は振らない", () => {
    const mk = () =>
      setup(
        [
          { monsterId: "giant_rat", hps: [30, 30, 0], status: [["sleep"], ["paralysis"], ["sleep"]] },
          { monsterId: "kobold", hps: [30], status: [["sleep", "paralysis"]] },
        ],
        {
          identified: ["giant_rat", "kobold"],
          patches: { c2: { status: ["sleep"] }, c5: { status: ["sleep"] }, c6: { ...DEAD, status: ["sleep"] } },
          inputs: { c1: DEF, c3: DEF, c4: DEF },
        },
      );
    const s = mk();
    expect(data.config.combat.sleepNaturalWake).toBe(20);
    // 100%: 全員覚める。順は c2 → c5 → e0-0 → e1-0（死んだ c6 と hp 0 の e0-2 は対象外）
    const m = cloneRng(s.rng);
    rolls(m, 3); // 味方 3 人（c1,c3,c4）。敵は全員行動不能なので振らない
    for (let i = 0; i < 4; i++) chance(m, 100);
    const r = exec(s, RESOLVE, dataWith({ combat: { sleepNaturalWake: 100 } }));
    expect(r.state.rng).toEqual(m);
    expect(r.events.filter((e) => e.kind === "statusChanged" || (e.kind === "message" && e.key === "battle.wake"))).toEqual([
      { kind: "statusChanged", id: "c2", status: "sleep", on: false },
      { kind: "message", key: "battle.wake", params: { target: "ベルク" } },
      { kind: "statusChanged", id: "c5", status: "sleep", on: false },
      { kind: "message", key: "battle.wake", params: { target: "エル" } },
      { kind: "statusChanged", id: "e0-0", status: "sleep", on: false },
      { kind: "message", key: "battle.wake", params: { target: "大ネズミ" } },
      { kind: "statusChanged", id: "e1-0", status: "sleep", on: false },
      { kind: "message", key: "battle.wake", params: { target: "コボルド" } },
    ]);
    expect(member(r.state, "c2").status).toEqual([]);
    expect(member(r.state, "c6").status).toEqual(["sleep"]);
    expect(r.state.battle!.groups[0]!.units.map((u) => u.status)).toEqual([[], ["paralysis"], ["sleep"]]);
    expect(r.state.battle!.groups[1]!.units[0]!.status).toEqual(["paralysis"]);
    // 0%: 同じ回数だけ振って誰も覚めない
    const r0 = exec(mk(), RESOLVE, dataWith({ combat: { sleepNaturalWake: 0 } }));
    expect(r0.state.rng).toEqual(m);
    expect(eventsOf(r0.events, "statusChanged")).toEqual([]);
    expect(member(r0.state, "c2").status).toEqual(["sleep"]);
    // 既定の 20%: 出目 ≤ 20 で覚める（鏡の rng で 1 人ずつ）
    for (let seed = 1; seed <= 10; seed++) {
      const t = setup([{ monsterId: "giant_rat", hps: [30], status: [["paralysis"]] }], {
        seed,
        identified: ["giant_rat"],
        patches: { c2: { status: ["sleep"] } },
        inputs: { c1: DEF, c3: DEF, c4: DEF, c5: DEF, c6: DEF },
      });
      const mm = cloneRng(t.rng);
      rolls(mm, 5);
      const woke = randInt(mm, 1, 100) <= 20;
      const rt = exec(t, RESOLVE);
      expect(rt.state.rng).toEqual(mm);
      expect(member(rt.state, "c2").status).toEqual(woke ? [] : ["sleep"]);
    }
  });

  test("CB-32/CB-33/CB-05 ラウンド終了の順は 毒 → 自然覚醒 → 確率鑑定。決着したラウンドでは自然覚醒を振らない", () => {
    const d = dataWith({ combat: { sleepNaturalWake: 100, identifyChancePerRound: 100 } });
    const s = setup([{ monsterId: "giant_rat", hps: [30], status: [["paralysis"]] }], {
      patches: { c1: { status: ["poison"] }, c2: { status: ["sleep"] } },
      inputs: { c1: DEF, c3: DEF, c4: DEF, c5: DEF, c6: DEF },
    });
    const r = exec(s, RESOLVE, d);
    const ks = kindsOf(r.events);
    const iPoison = ks.indexOf("hpChanged");
    const iWake = ks.indexOf("statusChanged");
    const iIdent = ks.indexOf("message:battle.identified");
    expect(iPoison).toBeGreaterThanOrEqual(0);
    expect(iPoison).toBeLessThan(iWake);
    expect(iWake).toBeLessThan(iIdent);
    // 勝利したラウンド: 眠ったベルクの自然覚醒は振らない（戦闘の終わりで睡眠が外れる）
    const win = setup([{ monsterId: "giant_rat", hps: [1], status: [["paralysis"]] }], {
      identified: ["giant_rat"],
      patches: { c2: { status: ["sleep"] } },
      inputs: { c1: atk(0), c3: DEF, c4: DEF, c5: DEF, c6: DEF },
    });
    const dw = dataWith({ combat: { ...ALWAYS_HIT, sleepNaturalWake: 100, chestChanceCorridor: 0 } });
    const m = cloneRng(win.rng);
    rolls(m, 5);
    chance(m, 100);
    rollDice(m, "1d8");
    rollDice(m, "1d4"); // 金
    chance(m, 0); // CB-51: 通路の遭遇の宝箱の判定（外れ）
    const rw = exec(win, RESOLVE, dw);
    expect(rw.state.rng).toEqual(m);
    expect(kindsOf(rw.events)).not.toContain("message:battle.wake");
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
    // CB-55: 宣言（mpChanged → battle.cast → spell）の後に、個体ごとの結果の拍
    expect(ks.slice(at, at + 6)).toEqual(["mpChanged", "message:battle.cast", "spell", "beat", "hpChanged", "message:battle.spellDamage"]);
    expect(r.events[at - 1]).toEqual({ kind: "beat", phase: "declare", auto: false });
    expect(r.events[at + 3]).toEqual({ kind: "beat", phase: "result", auto: false });
    expect(r.events[at]).toEqual({ kind: "mpChanged", id: "c5", delta: -2, mp: 5 });
    expect(r.events[at + 1]).toEqual({ kind: "message", key: "battle.cast", params: { actor: "エル", spell: "火矢" } });
    expect(r.events[at + 4]).toEqual({ kind: "hpChanged", id: "e0-0", delta: -dmg, hp: 50 - dmg });
    expect(member(r.state, "c5").mp).toBe(5);
  });

  test("F9 heal は hpMax を超えない（hpChanged の delta は実際の増分）。cure_poison で毒が外れ、毒の無い対象には battle.noEffect", () => {
    const s = patchParty(target(), { c1: { hp: 14, status: ["poison"] }, c4: { knownSpells: ["heal", "cure_poison"] } });
    s.battle!.inputs["c4"] = { type: "cast", spellId: "heal", target: { side: "ally", memberId: "c1" } };
    const r = exec(s, RESOLVE);
    expect(r.events).toContainEqual({ kind: "hpChanged", id: "c1", delta: 1, hp: 15 }); // hpMax 15（CH-65）で止まる
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
    ["hp", "giant_rat", { c1: { hp: 30, hpMax: 100 }, c2: STONE, c3: STONE }],
    ["status", "giant_spider", { c1: { hp: 100, hpMax: 100 }, c2: STONE, c3: STONE }],
    ["dead", "giant_rat", { c1: { hp: 1 }, c2: STONE, c3: STONE }],
    ["san", "whispering_shadow", { c1: { hp: 100, hpMax: 100, san: 52 }, c2: STONE, c3: STONE }],
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

  test("CB-12/CB-40/CB-41/CB-42 battle.repeat は、行動可能な各メンバーに autoInput を入れて battle.resolve したのと同じ（手入力は上書き、lastBattleInput は変えない）", () => {
    // グループ 0 は全滅、1 が生存。c3 は麻痺（入力を作らない）
    const heal: BattleAction = { type: "cast", spellId: "heal", target: { side: "ally", memberId: "c2" } };
    const fire0: BattleAction = { type: "cast", spellId: "fire_arrow", target: { side: "enemy", group: 0 } };
    const s = setup(
      [
        { monsterId: "giant_rat", hps: [0] },
        { monsterId: "kobold", hps: [60, 60] },
      ],
      {
        identified: ["giant_rat", "kobold"],
        inputs: { c1: DEF, c2: DEF, c4: DEF }, // lastBattleInput と違う手入力（上書きされる）
        patches: {
          c1: { lastBattleInput: atk(0) }, // CB-42: 全滅したグループ 0 → 1 へ振り替え
          c2: { lastBattleInput: null }, // CB-40: 前衛の既定は最小の生存グループへの攻撃
          c3: { ...PARA, lastBattleInput: DEF },
          c4: { lastBattleInput: heal }, // ally の対象はそのまま
          c5: { mp: 1, lastBattleInput: fire0 }, // CB-41: MP 不足（2 必要）の後衛は防御（noMp）
          c6: { lastBattleInput: DEF },
        },
      },
    );
    // autoInput が作る入力（CB-40〜42 を手で当てた期待値）
    const expected: Record<string, BattleAction> = {
      c1: atk(1),
      c2: atk(1),
      c4: heal,
      c5: { type: "cast", spellId: "fire_arrow", target: { side: "enemy", group: 1 } },
      c6: DEF,
    };
    const manual = cloneState(s);
    for (const c of manual.party) if (canAct(c)) manual.battle!.inputs[c.id] = autoInput(manual, data, c);
    expect(manual.battle!.inputs).toEqual(expected);
    const want = exec(manual, RESOLVE);
    const got = exec(s, REPEAT);
    expect(got.events).toEqual(want.events);
    expect(got.state.rng).toEqual(want.state.rng);
    expect(got.state.battle).toEqual(want.state.battle);
    expect(got.state.party).toEqual(want.state.party);
    expect(got.state.party.map((c) => c.lastBattleInput)).toEqual(s.party.map((c) => c.lastBattleInput));
    expect(got.events).toContainEqual({ kind: "message", key: "battle.noMp", params: { actor: "エル" } });
    expect(got.state.battle!.auto).toBe(false);
    expect(got.state.battle!.round).toBe(1);
    expect(got.state.battle!.inputs).toEqual({});
  });

  test("CB-12/CB-43 battle.repeat はオートにしない: HP が hpRatio を割っても auto は false のまま battle.autoOff は出ない。lastBattleInput も変えない。オート中は auto on で rejected", () => {
    const d = dataWith({ combat: ALWAYS_HIT });
    const s = setup([{ monsterId: "giant_rat", hps: [200] }], {
      identified: ["giant_rat"],
      inputs: {},
      patches: { c1: { hp: 30, hpMax: 100 }, c2: STONE, c3: STONE },
    });
    const r = exec(s, REPEAT, d);
    expect(member(r.state, "c1").hp).toBeLessThan(30); // CB-43 の hp 条件の遷移は起きている
    expect(r.state.battle!.auto).toBe(false);
    expect(kindsOf(r.events)).not.toContain("message:battle.autoOff");
    expect(r.state.party.map((c) => c.lastBattleInput)).toEqual(s.party.map((c) => c.lastBattleInput));
    expectRejected(r.state, RESOLVE, "inputs incomplete", d); // 次のラウンドは手入力（パーティの選択）に戻る
    const auto = setup([{ monsterId: "giant_rat", hps: [5] }], { auto: true, inputs: {} });
    expectRejected(auto, REPEAT, "auto on");
  });

  test("CB-44/CB-12 battle.repeat にも傾向が効く: 前回が防御の無鉄砲（キリ）は攻撃し、HP が半分未満の慎重（ベルク）は前回の攻撃でも防御。lastBattleInput は変えない", () => {
    const d = dataWith({ combat: ALWAYS_HIT });
    const s = setup([{ monsterId: "giant_rat", hps: [200], status: [["paralysis"]] }], {
      identified: ["giant_rat"],
      inputs: {},
      patches: {
        c1: PARA,
        c2: { hp: 4, hpMax: 10, lastBattleInput: atk(0) },
        c3: { lastBattleInput: DEF },
        c4: PARA,
        c5: PARA,
        c6: PARA,
      },
    });
    const r = exec(s, REPEAT, d);
    expect(eventsOf(r.events, "attack").map((e) => e.actorId)).toEqual(["c3"]);
    expect(r.events).toContainEqual({ kind: "message", key: "battle.defend", params: { actor: "ベルク" } });
    expect(member(r.state, "c3").lastBattleInput).toEqual(DEF);
    expect(member(r.state, "c2").lastBattleInput).toEqual(atk(0));
  });

  test("CB-12/CB-40 battle.repeat は行動可能な味方 0 人（麻痺と睡眠だけ）でも受け付け、battle.resolve と同じ events・rng・battle になる", () => {
    // battle.flee（no actor で rejected）と違い、repeat は auto だけを拒否する（decisions の Y1）
    const s = setup([{ monsterId: "giant_rat", hps: [50] }], {
      identified: ["giant_rat"],
      inputs: {},
      patches: { c1: { status: ["sleep"] }, c2: PARA, c3: PARA, c4: PARA, c5: PARA, c6: PARA },
    });
    const got = exec(s, REPEAT);
    expect(got.events[0]?.kind).not.toBe("rejected");
    const want = exec(cloneState(s), RESOLVE);
    expect(want.events[0]?.kind).not.toBe("rejected");
    expect(got.events).toEqual(want.events);
    expect(got.state.rng).toEqual(want.state.rng);
    expect(got.state.battle).toEqual(want.state.battle);
    // 味方は誰も行動しない（敵だけのラウンド）
    expect(eventsOf(got.events, "attack").every((e) => e.actorId.startsWith("e"))).toBe(true);
  });

  test("CB-04/CB-12 battle.repeat でも味方の奇襲のラウンドでは敵が行動しない（消費して false に戻る）", () => {
    const d = dataWith({ combat: { surpriseDiff: -1000, ...ALWAYS_HIT } });
    const ctx = runCtx(dived(1), d, (c) => startBattle(c, { kind: "random", inRoom: false }, [{ monsterId: "kobold", count: 2 }]));
    expect(ctx.state.battle!.partySurprise).toBe(true);
    const r = exec(ctx.state, REPEAT, d);
    expect(eventsOf(r.events, "attack").filter((e) => e.actorId.startsWith("e"))).toEqual([]);
    expect(eventsOf(r.events, "attack").some((e) => e.actorId.startsWith("c"))).toBe(true);
    expect(r.state.battle?.partySurprise ?? false).toBe(false);
  });
});

describe("逃走・勝利・全滅（CB-50〜54）", () => {
  test("CB-50/CB-12 battle.flee: 出目 ≤ 成功率で battleEnd(flee)（出目 = 成功率で成功、−1 で失敗）。EXP は増えず、図鑑の撃破数は残る。UI-40 dice は dice.flee（出目 1 行、rule.params.rate = fleePercent、result ok / ng）。入力済みの行動は捨てる", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const s = setup([{ monsterId: "giant_rat", hps: [50] }], { seed, identified: ["giant_rat"], inputs: { c1: atk(0) } });
      s.bestiary["giant_rat"]!.kills = 3;
      const m = cloneRng(s.rng);
      const roll = randInt(m, 1, 100);
      // fleePercent = floor(fleeBase + 1.8333×3) = fleeBase + 5
      const fleeDice = (rate: number, res: string) => ({
        kind: "dice",
        label: { key: "dice.flee" },
        rows: [{ label: { key: "dice.row.roll" }, base: null, dice: [roll], total: roll }],
        rule: { key: "dice.rule.rate", params: { rate } },
        result: { key: res },
      });
      const ok = exec(s, FLEE, dataWith({ combat: { fleeBase: roll - 5 } }));
      expect(ok.events[0]).toEqual({ kind: "beat", phase: "system", auto: false });
      expect(withoutBeats(ok.events).slice(0, 3)).toEqual([
        fleeDice(roll, "dice.flee.ok"),
        { kind: "battleEnd", result: "flee" },
        { kind: "message", key: "battle.fleeOk" },
      ]);
      expect(ok.state.battle).toBeNull();
      expect(ok.state.screen).toBe("dungeon");
      expect(ok.state.party.map((c) => c.exp)).toEqual(s.party.map((c) => c.exp));
      expect(ok.state.bestiary["giant_rat"]!.kills).toBe(3);
      expect(ok.state.rng).toEqual(m);
      // 失敗: fleeFail → 敵だけのラウンド（アルドの攻撃は捨てる）
      const ng = exec(s, FLEE, dataWith({ combat: { fleeBase: roll - 6 } }));
      expect(ng.events[1]).toEqual(fleeDice(roll - 1, "dice.flee.ng"));
      expect(kindsOf(ng.events).slice(0, 3)).toEqual(["beat", "dice", "message:battle.fleeFail"]);
      expect(eventsOf(ng.events, "attack").map((e) => e.actorId)).toEqual(["e0-0"]);
      expect(ng.state.battle!.round).toBe(1);
      expect(ng.state.battle!.inputs).toEqual({});
      expect(ng.state.battle!.auto).toBe(false);
    }
  });

  test("CB-12/CB-50 battle.flee の rejected: 逃走できない戦闘（ボス）は cannot flee、オート中は auto on、行動可能な味方が 0 人（麻痺と睡眠だけ）は no actor。同じ参照で乱数も消費しない", () => {
    const boss = setup([{ monsterId: "gatekeeper_armor", hps: [50] }], { origin: { kind: "boss" }, inputs: {} });
    expectRejected(boss, FLEE, "cannot flee");
    const auto = setup([{ monsterId: "giant_rat", hps: [5] }], { auto: true, inputs: {} });
    expectRejected(auto, FLEE, "auto on");
    // 判定順: auto on → cannot flee → no actor
    const bossAuto = setup([{ monsterId: "gatekeeper_armor", hps: [50] }], { origin: { kind: "boss" }, auto: true, inputs: {} });
    expectRejected(bossAuto, FLEE, "auto on");
    const asleep = patchParty(setup([{ monsterId: "giant_rat", hps: [5] }], { inputs: {} }), {
      c1: { status: ["sleep"] },
      c2: PARA,
      c3: PARA,
      c4: PARA,
      c5: PARA,
      c6: PARA,
    });
    expectRejected(asleep, FLEE, "no actor");
    const bossAsleep = patchParty(boss, { c1: PARA, c2: PARA, c3: PARA, c4: PARA, c5: PARA, c6: PARA });
    expectRejected(bossAsleep, FLEE, "cannot flee");
  });

  test("CB-51/DG-40/CH-60 勝利: EXP は生存者で等分（死者は受け取らない、端数切り捨て）、金は個体ごとに振って state.gold と ledger.gold の両方へ（鏡の rng）", () => {
    const d = dataWith({ combat: { ...ALWAYS_HIT, chestChanceCorridor: 0 } });
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
    const gold = rollDice(m, "1d4+1").total + rollDice(m, "1d4+1").total; // giant_rat の gold【仮】
    chance(m, 0); // CB-51: 通路の遭遇の宝箱の判定（外れ）
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

  test("CB-51/CB-52【仮】宝箱: 部屋の遭遇で chestChance 100 なら chestGoldDice の金。通路の遭遇は chestChanceCorridor で同じ手順（0 なら chance を 1 回振って出ない）", () => {
    const mk = (origin: BattleOpts["origin"], monsterId = "rotting_corpse") => {
      const s = setup([{ monsterId, hps: [1], status: [["paralysis"]] }], { identified: [monsterId], origin });
      s.battle!.inputs["c1"] = atk(0);
      return s;
    };
    // M7（IT-50 / IT-52）: 宝箱の金の後に品の chance(itemChance) を 1 回引く。ここでは金だけを見るので表の itemChance を 0 にする
    // （品の生成は tests/loot.test.ts）
    const d = dataWith({ combat: { ...ALWAYS_HIT, chestChance: 100 } }, (x) => {
      for (const t of x.drops.tables) t.itemChance = 0;
    });
    const room = mk({ kind: "random", inRoom: true });
    const m = cloneRng(room.rng);
    rolls(m, 6);
    chance(m, 100);
    rollDice(m, "1d8");
    chance(m, 100);
    const cg = rollDice(m, "2d10").total;
    chance(m, 0); // d01 1 階の表（rolls 1）の品の chance。外れ
    const r = exec(room, RESOLVE, d);
    expect(r.state.rng).toEqual(m);
    expect(r.events).toContainEqual({ kind: "message", key: "battle.chest", params: { gold: cg } });
    expect(r.state.gold).toBe(room.gold + cg);
    expect(r.state.dive!.ledger.gold).toBe(cg);
    // 通路: chestChanceCorridor 0 なら chance を 1 回振って出ない（部屋の chestChance 100 は効かない）
    const noItems = (x: GameData) => {
      for (const t of x.drops.tables) t.itemChance = 0;
    };
    const corr = mk({ kind: "random", inRoom: false });
    const m2 = cloneRng(corr.rng);
    rolls(m2, 6);
    chance(m2, 100);
    rollDice(m2, "1d8");
    chance(m2, 0);
    const rc = exec(corr, RESOLVE, dataWith({ combat: { ...ALWAYS_HIT, chestChance: 100, chestChanceCorridor: 0 } }, noItems));
    expect(rc.state.rng).toEqual(m2);
    expect(kindsOf(rc.events)).not.toContain("message:battle.chest");
    // 通路: chestChanceCorridor 100 なら部屋と同じ手順で金（部屋の chestChance 0 は効かない）
    const corr2 = mk({ kind: "random", inRoom: false });
    const m3 = cloneRng(corr2.rng);
    rolls(m3, 6);
    chance(m3, 100);
    rollDice(m3, "1d8");
    chance(m3, 100);
    const cg3 = rollDice(m3, "2d10").total;
    chance(m3, 0); // d01 1 階の表の品の chance。外れ
    const r3 = exec(corr2, RESOLVE, dataWith({ combat: { ...ALWAYS_HIT, chestChance: 0, chestChanceCorridor: 100 } }, noItems));
    expect(r3.state.rng).toEqual(m3);
    expect(r3.events).toContainEqual({ kind: "message", key: "battle.chest", params: { gold: cg3 } });
    expect(r3.state.gold).toBe(corr2.gold + cg3);
    expect(r3.state.dive!.ledger.gold).toBe(cg3);
  });

  test("CB-51/CB-52【仮】宝箱の既定の確率: 部屋 chestChance 60・通路 chestChanceCorridor 15。勝利の金の後の chance 1 回の出目で決まる（鏡の rng、シード 1〜20）", () => {
    expect(data.config.combat.chestChance).toBe(60);
    expect(data.config.combat.chestChanceCorridor).toBe(15);
    const d = dataWith({ combat: ALWAYS_HIT }); // 宝箱の確率は既定のまま
    const seen = { room: [0, 0], corridor: [0, 0] };
    for (let seed = 1; seed <= 20; seed++) {
      for (const inRoom of [true, false]) {
        const s = setup([{ monsterId: "rotting_corpse", hps: [1], status: [["paralysis"]] }], {
          seed,
          identified: ["rotting_corpse"],
          origin: { kind: "random", inRoom },
        });
        s.battle!.inputs["c1"] = atk(0);
        const m = cloneRng(s.rng);
        rolls(m, 6);
        chance(m, 100);
        rollDice(m, "1d8");
        const want = randInt(m, 1, 100) <= (inRoom ? 60 : 15);
        const r = exec(s, RESOLVE, d);
        expect(kindsOf(r.events).includes("message:battle.chest"), `seed ${seed} inRoom ${String(inRoom)}`).toBe(want);
        seen[inRoom ? "room" : "corridor"][want ? 1 : 0]! += 1;
      }
    }
    // 20 シードで部屋・通路とも、出る場合と出ない場合の両方を通る
    expect(seen.room.every((n) => n > 0)).toBe(true);
    expect(seen.corridor.every((n) => n > 0)).toBe(true);
  });

  test("CH-52/A8 強欲の treasureGain: 戦闘の金・宝箱の金ごとに、金のメッセージの直後で強欲（ドナ c4）の SAN +2。死者・虚脱・金 0 では増えない", () => {
    const d = dataWith({ combat: { ...ALWAYS_HIT, chestChance: 100 } });
    const mk = (patches: Record<string, Partial<Character>>, monsterId = "giant_rat") => {
      const s = setup([{ monsterId, hps: [1], status: [["paralysis"]] }], {
        identified: [monsterId],
        origin: { kind: "random", inRoom: true },
        patches,
      });
      s.battle!.inputs["c1"] = atk(0);
      return s;
    };
    // ドナ SAN 50: battle.gold（giant_rat の 1d4+1 > 0）→ +2、battle.chest（2d10 > 0）→ +2 の 2 回
    const r = exec(mk({ c4: { san: 50 } }), RESOLVE, d);
    const ks = kindsOf(r.events);
    const iGold = ks.indexOf("message:battle.gold");
    const iChest = ks.indexOf("message:battle.chest");
    expect(r.events[iGold + 1]).toEqual({ kind: "sanChanged", id: "c4", delta: 2, san: 52 });
    expect(r.events[iChest + 1]).toEqual({ kind: "sanChanged", id: "c4", delta: 2, san: 54 });
    expect(eventsOf(r.events, "sanChanged")).toHaveLength(2); // 強欲以外（treasureGain 0）は増えない
    expect(member(r.state, "c4").san).toBe(54);
    // SAN 100（上限）なら sanChanged は出ない（delta 0）
    expect(eventsOf(exec(mk({}), RESOLVE, d).events, "sanChanged")).toEqual([]);
    // 死んだ強欲・虚脱（SAN 0）の強欲は増えない
    expect(member(exec(mk({ c4: { ...DEAD, san: 50 } }), RESOLVE, d).state, "c4").san).toBe(50);
    expect(member(exec(mk({ c4: { san: 0 } }), RESOLVE, d).state, "c4").san).toBe(0);
    // gold "0" の敵（battle.gold なし）で宝箱の金が 0 なら 1 回も増えない（宝箱の message は出る）
    const d0 = dataWith({ combat: { ...ALWAYS_HIT, chestChance: 100, chestGoldDice: "0" } });
    const r0 = exec(mk({ c4: { san: 50 } }, "rotting_corpse"), RESOLVE, d0);
    expect(r0.events).toContainEqual({ kind: "message", key: "battle.chest", params: { gold: 0 } });
    expect(eventsOf(r0.events, "sanChanged")).toEqual([]);
  });

  test("CB-53/TW-20 全滅: 最後の行動可能者が倒れると battleEnd(wipe) → battle.wipe → 全滅処理（wipe.intro … wipe イベント → town.enter … screen town）。screen dungeon は出さない。睡眠だけが残るなら続行", () => {
    const d = dataWith({ combat: ALWAYS_HIT });
    const s = setup([{ monsterId: "kobold", hps: [50] }], {
      identified: ["kobold"],
      patches: { c1: { hp: 1 }, c2: STONE, c3: STONE, c4: PARA, c5: PARA, c6: PARA },
      inputs: { c1: DEF },
    });
    const r = exec(s, RESOLVE, d);
    const ks = kindsOf(r.events);
    const end = ks.indexOf("battleEnd");
    expect(ks.slice(end, end + 2)).toEqual(["battleEnd", "message:battle.wipe"]);
    // 睡眠の解除（ここでは眠っている者はいない）の後に、CB-55 の system の拍を挟んで全滅処理が続く
    expect(r.events[end + 2]).toEqual({ kind: "beat", phase: "system", auto: false });
    expect(ks[end + 3]).toBe("message:wipe.intro");
    expect(ks.indexOf("wipe")).toBeGreaterThan(end);
    expect(ks.indexOf("message:town.enter")).toBeGreaterThan(ks.indexOf("wipe"));
    expect(r.events.at(-1)).toEqual({ kind: "screen", to: "town" });
    expect(eventsOf(r.events, "screen")).toEqual([{ kind: "screen", to: "town" }]);
    expect(eventsOf(r.events, "battleEnd")).toEqual([{ kind: "battleEnd", result: "wipe" }]);
    expect(r.state.battle).toBeNull();
    expect(r.state.dive).toBeNull();
    expect(r.state.screen).toBe("town");
    expect(r.state.townVisit).not.toBeNull();
    expect(execute(r.state, { type: "dungeon.turn", dir: "left" }, d).events).toEqual([
      { kind: "rejected", command: "dungeon.turn", reason: "not in dungeon" },
    ]);
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
      patches: { c1: { hp: 1 }, c2: STONE, c3: STONE },
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
    const out = exec(r.state, FLEE, dataWith({ combat: { fleeBase: 1000 } }));
    expect(out.state.battle).toBeNull();
    expect(member(out.state, "c1").life).toBe("dead");
  });

  test("CB-54/CH-45 死亡した時点で状態異常をすべて外す: lifeChanged dead の直後に status の順で statusChanged off、その後に battle.dead。逃げた後も status は空", () => {
    // 2026-10-05 ユーザー決定で 95f5fef の「死亡しても状態異常は外さない」を撤回し、このテストを書き直した
    // （旧: 死者に poison が残り statusChanged を出さないことを固定していた）
    const d = dataWith({ combat: ALWAYS_HIT });
    const s = setup([{ monsterId: "kobold", hps: [80] }], {
      identified: ["kobold"],
      // 配置は旧テストと同じ（c2・c3 は石化、必中のコボルドが HP 1 の c1 を倒す）
      patches: { c1: { hp: 1, status: ["poison"] }, c2: STONE, c3: STONE },
      inputs: { c1: DEF, c4: DEF, c5: DEF, c6: DEF },
    });
    const r = exec(s, RESOLVE, d);
    expect(member(r.state, "c1").life).toBe("dead");
    expect(member(r.state, "c1").status).toEqual([]);
    const i = r.events.findIndex((e) => e.kind === "lifeChanged" && e.id === "c1");
    expect(r.events.slice(i, i + 3)).toEqual([
      { kind: "lifeChanged", id: "c1", life: "dead" },
      { kind: "statusChanged", id: "c1", status: "poison", on: false },
      { kind: "message", key: "battle.dead", params: { target: "アルド" } },
    ]);
    const out = exec(r.state, FLEE, dataWith({ combat: { fleeBase: 1000 } }));
    expect(member(out.state, "c1").status).toEqual([]);
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

  test.each([
    ["battle.resolve（オート）", RESOLVE, true],
    ["battle.repeat", REPEAT, false],
    ["battle.flee", FLEE, false],
  ] as const)("§3-2 決定性: %s を同じ state で 2 回呼ぶと deep-equal、引数の state を書き換えない、JSON 往復で変わらない", (_name, cmd, auto) => {
    const s = setup([{ monsterId: "giant_rat", hps: [5, 5] }, { monsterId: "kobold", hps: [4] }], { inputs: {}, auto });
    const before = JSON.stringify(s);
    const a = execute(s, cmd, data);
    const b = execute(s, cmd, data);
    expectKnownStringKeys(a.events);
    expect(a.events[0]?.kind).not.toBe("rejected");
    expect(a).toEqual(b);
    expect(JSON.stringify(s)).toBe(before);
    expect(JSON.parse(JSON.stringify(a.state))).toStrictEqual(a.state);
  });
});

describe("SAN の閾値効果（CB-45、CH-53）", () => {
  // 麻痺の大ネズミ（行動しない）。only に書いた者以外は麻痺
  const san = (
    only: Record<string, Partial<Character>>,
    inputs: Record<string, BattleAction>,
    groups: GroupSpec[] = [{ monsterId: "giant_rat", hps: [50], status: [["paralysis"]] }],
    seed = 1,
  ) =>
    setup(groups, {
      seed,
      identified: groups.map((g) => g.monsterId),
      inputs,
      patches: { c1: PARA, c2: PARA, c3: PARA, c4: PARA, c5: PARA, c6: PARA, ...only },
    });
  const declareOf = (events: readonly GameEvent[]) =>
    phasesOf(events)
      .filter(([p]) => p === "declare")
      .map(([, body]) => body);

  test("CB-45/CH-53 SAN 50% 以上の者は置き換えの乱数を引かない（50 / 100 は initiative の 1d10 だけ。49 は chance が 1 つ増える）", () => {
    for (const v of [50, 100]) {
      const s = san({ c1: { san: v } }, { c1: DEF });
      const m = cloneRng(s.rng);
      rolls(m, 1);
      expect(exec(s, RESOLVE).state.rng).toEqual(m);
    }
    // 49（不安）: 置き換えないとき（uneasyChance 0 と比べ）rng が 1 つ進む。uneasyChance 100 で必ず置き換える
    const s49 = san({ c1: { san: 49 } }, { c1: DEF });
    const m = cloneRng(s49.rng);
    expect(chance(m, 1)).toBe(false); // シード 1 の最初の d100 は 1 より大きい（置き換えない）
    rolls(m, 1);
    const r1 = exec(s49, RESOLVE, dataWith({ san: { uneasyChance: 1 } }));
    expect(r1.state.rng).toEqual(m);
    expect(kindsOf(r1.events)).not.toContain("message:battle.disobey");
    expect(kindsOf(exec(s49, RESOLVE, dataWith({ san: { uneasyChance: 100, randomDefendChance: 100 } })).events)).toContain("message:battle.disobey");
  });

  test("CB-45/A5 不安: 確率は disobeyBelowHalf（普通）か uneasyChance、成功で性格傾向 + declare の先頭に battle.disobey。lastBattleInput は変えない", () => {
    // 慎重（ベルク SAN 40、攻撃の入力）: uneasyChance 100 → 傾向（防御）。語りは declare の先頭
    const always = dataWith({ san: { uneasyChance: 100 } });
    const berg = san({ c2: { san: 40, lastBattleInput: atk(0) } }, { c2: atk(0) });
    const m = cloneRng(berg.rng);
    expect(chance(m, 100)).toBe(true);
    rolls(m, 1);
    const r = exec(berg, RESOLVE, always);
    expect(r.state.rng).toEqual(m); // 傾向の防御は乱数を引かない
    expect(declareOf(r.events)).toEqual([["message:battle.disobey", "message:battle.defend"]]);
    expect(r.events).toContainEqual({ kind: "message", key: "battle.disobey", params: { actor: "ベルク" } });
    expect(eventsOf(r.events, "attack")).toEqual([]);
    expect(member(r.state, "c2").lastBattleInput).toEqual(atk(0));
    // 置き換え後が元と同じ（防御 → 防御）でも語りは出す
    const bergDef = san({ c2: { san: 40 } }, { c2: DEF });
    expect(declareOf(exec(bergDef, RESOLVE, always).events)).toEqual([["message:battle.disobey", "message:battle.defend"]]);
    // 慎重は disobeyBelowHalf 0 なので uneasyChance を使う: 0 なら乱数を引かず置き換えない
    const r0 = exec(berg, RESOLVE, dataWith({ san: { uneasyChance: 0 } }));
    expect(kindsOf(r0.events)).not.toContain("message:battle.disobey");
    expect(eventsOf(r0.events, "attack").map((e) => e.actorId)).toEqual(["c2"]);
    // 普通（エル SAN 40）は disobeyBelowHalf が正ならその値を使う: uneasyChance 0 でも disobeyBelowHalf 100 で置き換わる
    const own = dataWith({ san: { uneasyChance: 0 } }, (x) => (x.personalities.find((p) => p.id === "normal")!.san.disobeyBelowHalf = 100));
    const el = san({ c1: {}, c5: { san: 40 } }, { c1: DEF, c5: DEF });
    expect(exec(el, RESOLVE, own).events).toContainEqual({ kind: "message", key: "battle.disobey", params: { actor: "エル" } });
    // 無鉄砲（キリ SAN 40、防御の入力）: 最小の生存グループへの攻撃
    const kiri = san({ c3: { san: 40 } }, { c3: DEF }, [
      { monsterId: "giant_rat", hps: [0] },
      { monsterId: "giant_rat", hps: [50], status: [["paralysis"]] },
    ]);
    const rk = exec(kiri, RESOLVE, dataWith({ combat: ALWAYS_HIT, san: { uneasyChance: 100 } }));
    expect(declareOf(rk.events)[0]).toEqual(["message:battle.disobey", "message:battle.attackDeclare"]);
    expect(eventsOf(rk.events, "attack").map((e) => e.targetId)).toEqual(["e1-0"]);
    // 強欲（ドナ SAN 40。前衛 3 人が麻痺なので前衛扱い）: gold の期待値 × 生存数が最大のグループ（kobold 21 > rat 7）
    const dona = san({ c4: { san: 40 } }, { c4: DEF }, [
      { monsterId: "giant_rat", hps: [50], status: [["paralysis"]] },
      { monsterId: "kobold", hps: [50], status: [["paralysis"]] },
    ]);
    const rd = exec(dona, RESOLVE, dataWith({ combat: ALWAYS_HIT, san: { uneasyChance: 100 } }));
    expect(eventsOf(rd.events, "attack").map((e) => e.targetId)).toEqual(["e1-0"]);
  });

  test("CB-45 錯乱: confusedChance でランダム行動（randomDefendChance で防御、でなければ randInt の生存グループ）+ declare の先頭に battle.confused", () => {
    const groups: GroupSpec[] = [
      { monsterId: "giant_rat", hps: [50], status: [["paralysis"]] },
      { monsterId: "giant_rat", hps: [0] },
      { monsterId: "giant_rat", hps: [50], status: [["paralysis"]] },
    ];
    // 防御（randomDefendChance 100）: 攻撃の入力でも防御
    const s = san({ c1: { san: 20 } }, { c1: atk(0) }, groups);
    const md = cloneRng(s.rng);
    chance(md, 100); // 錯乱の置き換え
    chance(md, 100); // 防御
    rolls(md, 1);
    const rDef = exec(s, RESOLVE, dataWith({ san: { confusedChance: 100, randomDefendChance: 100 } }));
    expect(rDef.state.rng).toEqual(md);
    expect(declareOf(rDef.events)).toEqual([["message:battle.confused", "message:battle.defend"]]);
    expect(rDef.events).toContainEqual({ kind: "message", key: "battle.confused", params: { actor: "アルド" } });
    // 攻撃（randomDefendChance 0）: 生存グループ [0, 2] から randInt(0, 1)。防御の入力でも攻撃
    const toAtk = dataWith({ combat: ALWAYS_HIT, san: { confusedChance: 100, randomDefendChance: 0 } });
    const seen = new Set<number>();
    for (let seed = 1; seed <= 10; seed++) {
      const s2 = san({ c1: { san: 20 } }, { c1: DEF }, groups, seed);
      const m = cloneRng(s2.rng);
      chance(m, 100);
      chance(m, 0);
      const g = [0, 2][randInt(m, 0, 1)]!;
      seen.add(g);
      rolls(m, 1);
      chance(m, 100);
      rollDice(m, "1d8");
      const r = exec(s2, RESOLVE, toAtk);
      expect(r.state.rng).toEqual(m);
      expect(eventsOf(r.events, "attack").map((e) => e.targetId)).toEqual([`e${g}-0`]);
      expect(declareOf(r.events)[0]).toEqual(["message:battle.confused", "message:battle.attackDeclare"]);
    }
    expect(seen.size).toBe(2);
  });

  test("CB-45 確率 0 なら乱数を引かない（錯乱の confusedChance 0、不安の uneasyChance 0 と disobeyBelowHalf 0）", () => {
    const s = san({ c1: { san: 20 }, c2: { san: 40 }, c5: { san: 40 } }, { c1: DEF, c2: DEF, c5: DEF });
    const m = cloneRng(s.rng);
    rolls(m, 3);
    const r = exec(s, RESOLVE, dataWith({}, noSanOverride));
    expect(r.state.rng).toEqual(m);
    expect(kindsOf(r.events).filter((k) => k === "message:battle.disobey" || k === "message:battle.confused")).toEqual([]);
  });

  test("CB-45/CB-13 後衛の置き換えの攻撃は防御（disobey → backRowCannotAttack）", () => {
    // ドナ（強欲・後衛・杖、SAN 40）: 傾向は最も金のあるグループへの攻撃だが、前衛のアルドが行動可能なので後衛の防御（backRow）
    const s = san({ c1: {}, c4: { san: 40 } }, { c1: DEF, c4: DEF });
    const r = exec(s, RESOLVE, dataWith({ san: { uneasyChance: 100 } }));
    expect(declareOf(r.events)).toContainEqual(["message:battle.disobey", "message:battle.backRowCannotAttack"]);
    expect(r.events).toContainEqual({ kind: "message", key: "battle.backRowCannotAttack", params: { actor: "ドナ" } });
  });
});

// ---------------------------------------------------------------------------
// CB-55: 拍（beat）

type BeatEv = Extract<GameEvent, { kind: "beat" }>;
/** 拍で区切った列。head は最初の拍より前、segs は各拍とその中身（kindsOf の文字列） */
function segmentsOf(events: readonly GameEvent[]): { head: string[]; segs: { beat: BeatEv; body: string[] }[] } {
  const head: string[] = [];
  const segs: { beat: BeatEv; body: string[] }[] = [];
  for (const e of events) {
    if (e.kind === "beat") segs.push({ beat: e, body: [] });
    else (segs.at(-1)?.body ?? head).push(kindsOf([e])[0]!);
  }
  return { head, segs };
}
/** [phase, 中身] の列（auto は別に確かめる） */
const phasesOf = (events: readonly GameEvent[]) => segmentsOf(events).segs.map((s) => [s.beat.phase, s.body] as const);

/** CB-55 (b): 拍は連続せず、末尾にも来ない */
function expectBeatShape(events: readonly GameEvent[]): void {
  events.forEach((e, i) => {
    if (e.kind !== "beat") return;
    const next = events[i + 1];
    expect(next, "beat must be followed by an event").toBeDefined();
    expect(next!.kind).not.toBe("beat");
  });
}

/** c1 だけが行動する（他は麻痺。敵の対象にはなる） */
const ONLY_C1 = { c2: PARA, c3: PARA, c4: PARA, c5: PARA, c6: PARA };
/** c1 以外は石化（敵の対象にならない） */
const STONE_BUT_C1 = { c2: STONE, c3: STONE, c4: STONE, c5: STONE, c6: STONE };

describe("拍（CB-55）", () => {
  test("CB-55 味方の攻撃 1 振りで撃破: declare（attackDeclare）→ result（hpChanged → attack → battle.hit）→ aftermath（lifeChanged → battle.dead）→ system（戦闘の終わり）", () => {
    const d = dataWith({ combat: ALWAYS_HIT });
    const s = setup([{ monsterId: "giant_rat", hps: [1], status: [["paralysis"]] }], {
      patches: ONLY_C1,
      inputs: { c1: atk(0) },
      identified: ["giant_rat"],
    });
    const r = exec(s, RESOLVE, d);
    expectBeatShape(r.events);
    const { head, segs } = segmentsOf(r.events);
    expect(head).toEqual([]);
    expect(phasesOf(r.events)).toEqual([
      ["declare", ["message:battle.attackDeclare"]],
      ["result", ["hpChanged", "attack", "message:battle.hit"]],
      ["aftermath", ["lifeChanged", "message:battle.dead"]],
      ["system", ["battleEnd", "message:battle.win", "message:battle.exp", "message:battle.gold", "screen"]],
    ]);
    expect(segs.every((x) => x.beat.auto === false)).toBe(true);
    const dmg = eventsOf(r.events, "attack")[0]!.damage;
    expect(r.events).toContainEqual({ kind: "message", key: "battle.attackDeclare", params: { actor: "アルド" } });
    expect(r.events).toContainEqual({ kind: "message", key: "battle.hit", params: { target: "大ネズミ", damage: dmg } });
  });

  test("CB-55 外れ: result（attack(false) → battle.miss{target}）だけで aftermath は無い。何も起きないラウンドの終わりには拍が無い", () => {
    const d = dataWith({ combat: { hitMin: 0, hitMax: 0 } });
    const s = setup([{ monsterId: "giant_rat", hps: [50], status: [["paralysis"]] }], {
      patches: ONLY_C1,
      inputs: { c1: atk(0) },
      identified: ["giant_rat"],
    });
    const r = exec(s, RESOLVE, d);
    expect(r.events).toEqual([
      { kind: "beat", phase: "declare", auto: false },
      { kind: "message", key: "battle.attackDeclare", params: { actor: "アルド" } },
      { kind: "beat", phase: "result", auto: false },
      { kind: "attack", actorId: "c1", targetId: "e0-0", hit: false, damage: 0 },
      { kind: "message", key: "battle.miss", params: { target: "大ネズミ" } },
    ]);
  });

  test("CB-55 攻撃回数 2（戦士 Lv5）: declare は 1 回、result は振りごとに 2 回、覚醒した振りにだけ aftermath", () => {
    const d = dataWith({ combat: { ...ALWAYS_HIT, sleepWakeChance: 100 } });
    const s = setup([{ monsterId: "giant_rat", hps: [50], status: [["sleep"]] }], {
      patches: { ...ONLY_C1, c1: { level: 5 } },
      inputs: { c1: atk(0) },
      identified: ["giant_rat"],
    });
    const r = exec(s, RESOLVE, d);
    expectBeatShape(r.events);
    expect(phasesOf(r.events)).toEqual([
      ["declare", ["message:battle.attackDeclare"]],
      ["result", ["hpChanged", "attack", "message:battle.hit"]],
      ["aftermath", ["statusChanged", "message:battle.wake"]],
      ["result", ["hpChanged", "attack", "message:battle.hit"]],
    ]);
  });

  test("CB-55 敵: declare（attackDeclare{グループ名}）→ 攻撃要素ごとに result（hpChanged → attack → battle.hit{味方の名前}）と aftermath（状態付与 / SAN 吸収）。防御は declare だけ", () => {
    // 大蜘蛛の毒（chance を 1000 にして必ず付与）
    const d = dataWith({ combat: ALWAYS_HIT }, (x) => (x.monsters.find((m) => m.id === "giant_spider")!.attacks[0]!.chance = 1000));
    const s = setup([{ monsterId: "giant_spider", hps: [50] }], { patches: STONE_BUT_C1, inputs: { c1: DEF }, identified: ["giant_spider"] });
    const r = exec(s, RESOLVE, d);
    expectBeatShape(r.events);
    const ph = phasesOf(r.events);
    const at = ph.findIndex(([p, body]) => p === "declare" && body[0] === "message:battle.attackDeclare");
    expect(ph.slice(at, at + 3)).toEqual([
      ["declare", ["message:battle.attackDeclare"]],
      ["result", ["hpChanged", "attack", "message:battle.hit"]],
      ["aftermath", ["statusChanged", "message:battle.status.poison"]],
    ]);
    expect(r.events).toContainEqual({ kind: "message", key: "battle.attackDeclare", params: { actor: "大蜘蛛" } });
    const dmg = eventsOf(r.events, "attack")[0]!.damage;
    expect(r.events).toContainEqual({ kind: "message", key: "battle.hit", params: { target: "アルド", damage: dmg } });
    expect(ph).toContainEqual(["declare", ["message:battle.defend"]]);

    // 囁く影の SAN 吸収は aftermath に入る
    const s2 = setup([{ monsterId: "whispering_shadow", hps: [50] }], { patches: STONE_BUT_C1, inputs: { c1: DEF }, identified: ["whispering_shadow"] });
    const ph2 = phasesOf(exec(s2, RESOLVE, dataWith({ combat: ALWAYS_HIT })).events);
    const at2 = ph2.findIndex(([p, body]) => p === "declare" && body[0] === "message:battle.attackDeclare");
    expect(ph2.slice(at2, at2 + 3)).toEqual([
      ["declare", ["message:battle.attackDeclare"]],
      ["result", ["hpChanged", "attack", "message:battle.hit"]],
      ["aftermath", ["sanChanged", "message:battle.sanDrain"]],
    ]);
  });

  test("CB-55 敵の攻撃で味方が倒れると、死亡と他の生存者の SAN が aftermath の 1 拍に入る。全滅なら system の拍が 2 つ（戦闘の終わり / 全滅処理）続く", () => {
    const s = setup([{ monsterId: "kobold", hps: [50] }], {
      patches: { ...STONE_BUT_C1, c1: { hp: 1 } },
      inputs: { c1: DEF },
      identified: ["kobold"],
    });
    const r = exec(s, RESOLVE, dataWith({ combat: ALWAYS_HIT }));
    expectBeatShape(r.events);
    const ph = phasesOf(r.events);
    const after = ph.find(([p]) => p === "aftermath")!;
    expect(after[1].slice(0, 2)).toEqual(["lifeChanged", "message:battle.dead"]);
    expect(after[1].filter((k) => k === "sanChanged")).toHaveLength(5); // 石化の 5 人は alive
    expect(ph.at(-2)![0]).toBe("system");
    expect(ph.at(-2)![1].slice(0, 2)).toEqual(["battleEnd", "message:battle.wipe"]);
    expect(ph.at(-1)![0]).toBe("system");
    expect(ph.at(-1)![1][0]).toBe("message:wipe.intro");
    expect(ph.at(-1)![1].at(-1)).toBe("screen");
    // 全滅処理の拍は battle が null になった後に始まるので auto は false
    expect(segmentsOf(r.events).segs.at(-1)!.beat.auto).toBe(false);
  });

  test("CB-55 呪文 damage（flame_burst）は個体ごとに result と aftermath（撃破）。heal / blessing / identify は result が 1 拍だけ。道具は declare が battle.useItem。後衛の攻撃不可は declare だけ", () => {
    const d = dataWith({ combat: ALWAYS_HIT });
    const only = (id: string, patch: Partial<Character>) => {
      const p: Record<string, Partial<Character>> = { c1: PARA, c2: PARA, c3: PARA, c4: PARA, c5: PARA, c6: PARA };
      p[id] = patch;
      return p;
    };
    const rat = (hps: number[]): GroupSpec => ({ monsterId: "giant_rat", hps, status: hps.map(() => ["paralysis" as const]) });
    // flame_burst: 1 体目（hp 1）は撃破、2 体目（hp 50）は生き残り、眠っていないので覚醒もしない
    const sDmg = setup([rat([1, 50])], {
      patches: only("c5", { knownSpells: ["flame_burst"], mp: 20 }),
      inputs: { c5: { type: "cast", spellId: "flame_burst", target: { side: "enemy", group: 0 } } },
      identified: ["giant_rat"],
    });
    expect(phasesOf(exec(sDmg, RESOLVE, d).events)).toEqual([
      ["declare", ["mpChanged", "message:battle.cast", "spell"]],
      ["result", ["hpChanged", "message:battle.spellDamage"]],
      ["aftermath", ["lifeChanged", "message:battle.dead"]],
      ["result", ["hpChanged", "message:battle.spellDamage"]],
    ]);
    // heal
    const sHeal = setup([rat([50])], {
      patches: { ...only("c4", {}), c1: { ...PARA, hp: 1 } },
      inputs: { c4: { type: "cast", spellId: "heal", target: { side: "ally", memberId: "c1" } } },
      identified: ["giant_rat"],
    });
    expect(phasesOf(exec(sHeal, RESOLVE, d).events)).toEqual([
      ["declare", ["mpChanged", "message:battle.cast", "spell"]],
      ["result", ["hpChanged", "message:battle.heal"]],
    ]);
    // blessing（party の acBonus。alive の 6 人に 1 文ずつ、拍は 1 つ）
    const sBless = setup([rat([50])], {
      patches: only("c4", { knownSpells: ["heal", "blessing"] }),
      inputs: { c4: { type: "cast", spellId: "blessing", target: { side: "none" } } },
      identified: ["giant_rat"],
    });
    expect(phasesOf(exec(sBless, RESOLVE, d).events)).toEqual([
      ["declare", ["mpChanged", "message:battle.cast", "spell"]],
      ["result", Array(6).fill("message:battle.acBonus")],
    ]);
    // identify（未鑑定の 2 グループ）
    const sId = setup([rat([50]), { monsterId: "kobold", hps: [50], status: [["paralysis"]] }], {
      patches: only("c5", { knownSpells: ["identify"], mp: 20 }),
      inputs: { c5: { type: "cast", spellId: "identify", target: { side: "none" } } },
    });
    expect(phasesOf(exec(sId, RESOLVE, d).events)).toEqual([
      ["declare", ["mpChanged", "message:battle.cast", "spell"]],
      ["result", ["message:battle.identified", "message:battle.identified", "enemyGroups"]],
    ]);
    // 道具（アルドの薬草を自分に）
    const sItem0 = setup([rat([50])], { patches: only("c1", { hp: 1 }), identified: ["giant_rat"] });
    const herb = member(sItem0, "c1").inventory[0]!;
    const sItem = setup([rat([50])], {
      patches: only("c1", { hp: 1 }),
      inputs: { c1: { type: "item", instanceId: herb, target: { side: "ally", memberId: "c1" } } },
      identified: ["giant_rat"],
    });
    expect(phasesOf(exec(sItem, RESOLVE, d).events)).toEqual([
      ["declare", ["message:battle.useItem"]],
      ["result", ["hpChanged", "message:battle.heal"]],
    ]);
    // 後衛（ドナ、杖）の攻撃不可。前衛に行動可能な者（防御のアルド）がいないと後衛が前に出るので、アルドも動ける状態にする
    const sBack = setup([rat([50])], { patches: { ...only("c4", {}), c1: {} }, inputs: { c1: DEF, c4: atk(0) }, identified: ["giant_rat"] });
    const back = phasesOf(exec(sBack, RESOLVE, d).events);
    expect(back).toHaveLength(2);
    expect(back).toContainEqual(["declare", ["message:battle.backRowCannotAttack"]]);
    expect(back).toContainEqual(["declare", ["message:battle.defend"]]);
  });

  test("CB-55 遭遇: screen{battle} の直後に system（encounter・語り・未鑑定の SAN）、次に system（先手の dice）。敵の奇襲ではその中に surpriseEnemy、続けて各 declare", () => {
    const d = dataWith({ combat: { surpriseDiff: 1000 } });
    const ctx = runCtx(dived(1), d, (c) => startBattle(c, { kind: "random", inRoom: false }, [{ monsterId: "giant_rat", count: 2 }]));
    expectBeatShape(ctx.events);
    expect(segmentsOf(ctx.events).head).toEqual(["screen"]);
    expect(phasesOf(ctx.events)).toEqual([
      ["system", ["encounter", "message:battle.encounter", "message:battle.unidentified", ...Array(6).fill("sanChanged")]],
      ["system", ["dice"]],
    ]);
    // 敵の奇襲（agi 1000）。noAmbushAvoid: 取り消し（A1）の拍は CB-55/CB-04 のテストで見る
    const da = dataWith({ combat: ALWAYS_HIT }, (x) => {
      x.monsters.find((m) => m.id === "giant_rat")!.agi = 1000;
      noAmbushAvoid(x);
    });
    const amb = runCtx(dived(1), da, (c) => startBattle(c, { kind: "random", inRoom: false }, [{ monsterId: "giant_rat", count: 2 }]));
    expectBeatShape(amb.events);
    const ph = phasesOf(amb.events);
    expect(ph[1]).toEqual(["system", ["dice", "message:battle.surpriseEnemy"]]);
    expect(ph[2]).toEqual(["declare", ["message:battle.attackDeclare"]]);
    expect(ph.filter(([p]) => p === "declare")).toHaveLength(2);
  });

  test("CB-55/CB-04 取り消しの dice は先手の dice と別の system の拍（成功なら battle.ambushAvoided も同じ拍、失敗なら dice だけで続けて敵の declare）", () => {
    const d = dataWith({ combat: ALWAYS_HIT }, (x) => (x.monsters.find((m) => m.id === "giant_rat")!.agi = 1000));
    const d100Of = (seed: number) => {
      const m = cloneRng(dived(seed).rng);
      rollDice(m, "1d6");
      rollDice(m, "1d6");
      rolls(m, 2);
      return randInt(m, 1, 100);
    };
    const seeds = Array.from({ length: 200 }, (_, i) => i + 1);
    const start = (seed: number) =>
      runCtx(dived(seed), d, (c) => startBattle(c, { kind: "random", inRoom: false }, [{ monsterId: "giant_rat", count: 2 }]));
    const ok = start(seeds.find((x) => d100Of(x) <= 20)!);
    expectBeatShape(ok.events);
    expect(phasesOf(ok.events).slice(1)).toEqual([
      ["system", ["dice", "message:battle.surpriseEnemy"]],
      ["system", ["dice", "message:battle.ambushAvoided"]],
    ]);
    const ng = start(seeds.find((x) => d100Of(x) > 20)!);
    expectBeatShape(ng.events);
    const ph = phasesOf(ng.events);
    expect(ph[1]).toEqual(["system", ["dice", "message:battle.surpriseEnemy"]]);
    expect(ph[2]).toEqual(["system", ["dice"]]);
    expect(ph[3]).toEqual(["declare", ["message:battle.attackDeclare"]]);
  });

  test("CB-55 ラウンドの終わり: 毒が効けば system の拍が 1 つ（中身は hpChanged）。何も起きなければ拍は無い（外れのテスト）", () => {
    const s = setup([{ monsterId: "giant_rat", hps: [50], status: [["paralysis"]] }], {
      patches: { ...ONLY_C1, c1: { status: ["poison"] } },
      inputs: { c1: DEF },
      identified: ["giant_rat"],
    });
    expect(phasesOf(exec(s, RESOLVE).events)).toEqual([
      ["declare", ["message:battle.defend"]],
      ["system", ["hpChanged"]],
    ]);
  });

  test("CB-55 逃走: system（dice → [fleeFail]）。成功なら続けて system（戦闘の終わり）", () => {
    const s = setup([{ monsterId: "giant_rat", hps: [50], status: [["paralysis"]] }], { patches: ONLY_C1, identified: ["giant_rat"] });
    const ok = exec(s, FLEE, dataWith({ combat: { fleeBase: 1000 } }));
    expectBeatShape(ok.events);
    expect(phasesOf(ok.events)).toEqual([
      ["system", ["dice"]],
      ["system", ["battleEnd", "message:battle.fleeOk", "screen"]],
    ]);
    const ng = exec(s, FLEE, dataWith({ combat: { fleeBase: -1000 } }));
    expect(phasesOf(ng.events)).toEqual([["system", ["dice", "message:battle.fleeFail"]]]);
  });

  test("CB-55 auto: battle.auto on の resolve の拍はすべて auto true、battle.repeat は false。ラウンドの終わりでオートが解除されるときは、その system の拍が true", () => {
    const d = dataWith({ combat: ALWAYS_HIT });
    const s = setup([{ monsterId: "giant_rat", hps: [50, 50] }], { identified: ["giant_rat"] });
    const on = exec(exec(s, AUTO_ON, d).state, RESOLVE, d);
    const beats = eventsOf(on.events, "beat");
    expect(beats.length).toBeGreaterThan(0);
    expect(beats.every((b) => b.auto)).toBe(true);
    const rep = exec(s, REPEAT, d);
    const rb = eventsOf(rep.events, "beat");
    expect(rb.length).toBeGreaterThan(0);
    expect(rb.every((b) => !b.auto)).toBe(true);
    // 大蜘蛛の毒（必ず付与）でオート解除（status）。解除の message が入る system の拍は auto true
    const dp = dataWith({ combat: ALWAYS_HIT }, (x) => (x.monsters.find((m) => m.id === "giant_spider")!.attacks[0]!.chance = 1000));
    const sp = setup([{ monsterId: "giant_spider", hps: [200] }], { patches: STONE_BUT_C1, identified: ["giant_spider"], auto: true, inputs: {} });
    const r = exec(sp, RESOLVE, dp);
    expect(r.state.battle!.auto).toBe(false);
    const last = segmentsOf(r.events).segs.at(-1)!;
    expect(last.beat).toEqual({ kind: "beat", phase: "system", auto: true });
    expect(last.body.slice(-2)).toEqual(["message:battle.autoOff", "message:battle.autoReason.status"]);
  });

  test("CB-55 不変条件: (a) 戦闘の外の迷宮・戦闘外の全滅には拍が無い (b) 拍は連続せず末尾に無い (c) 拍を取り除いた列・最終の state と rng は拍を入れない場合と同じ（30 シード × 遭遇から決着まで）", () => {
    const LOW_SAN = { c1: { san: 20 }, c2: { san: 20 }, c3: { san: 20 }, c4: { san: 20 }, c5: { san: 20 }, c6: { san: 20 } };
    const run = (enabled: boolean, seed: number, low = false) => {
      beatSwitchForTests.enabled = enabled;
      try {
        const out: GameEvent[][] = [];
        // low: 全員 SAN 20（錯乱）で CB-45 の置き換えを起こす
        const ctx = makeContext(cloneState(low ? patchParty(dived(seed), LOW_SAN) : dived(seed)), data);
        startRandomEncounter(ctx, seed % 3 === 0);
        out.push(ctx.events);
        let s = ctx.state;
        for (let i = 0; i < 80 && s.battle !== null; i++) {
          let cmd: Command;
          if (i === 0 && seed % 2 === 0) cmd = FLEE;
          else if (!s.battle.auto) cmd = AUTO_ON;
          else cmd = RESOLVE;
          const r = execute(s, cmd, data);
          out.push(r.events);
          s = r.state;
        }
        return { out, state: s };
      } finally {
        beatSwitchForTests.enabled = true;
      }
    };
    let withBeats = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const a = run(true, seed);
      const b = run(false, seed);
      expect(a.state).toEqual(b.state);
      expect(a.out.map(withoutBeats)).toEqual(b.out);
      for (const evs of a.out) {
        expectBeatShape(evs);
        expectKnownStringKeys(evs);
        if (eventsOf(evs, "beat").length > 0) withBeats += 1;
      }
    }
    expect(withBeats).toBeGreaterThan(30);
    // 低 SAN（20）の一行: CB-45 の置き換えと語り（declare の拍の先頭）でも (b)(c) が成り立つ
    let confused = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const a = run(true, seed, true);
      const b = run(false, seed, true);
      expect(a.state).toEqual(b.state);
      expect(a.out.map(withoutBeats)).toEqual(b.out);
      for (const evs of a.out) {
        expectBeatShape(evs);
        expectKnownStringKeys(evs);
        confused += kindsOf(evs).filter((k) => k === "message:battle.confused").length;
      }
    }
    expect(confused).toBeGreaterThan(0);

    // (a) 迷宮の歩行・旋回（遭遇率 0）と、戦闘外の全滅（全員麻痺で旋回）には拍が無い
    const quiet = dataWith({}, (x) => {
      for (const dg of x.dungeons) dg.encounterRate = { room: 0, corridor: 0 };
    });
    let s = dived(1);
    const walk: Command[] = [{ type: "dungeon.turn", dir: "left" }, { type: "dungeon.move" }, { type: "dungeon.turn", dir: "around" }, { type: "dungeon.move" }];
    for (const cmd of walk) {
      const r = execute(s, cmd, quiet);
      expect(eventsOf(r.events, "beat")).toEqual([]);
      s = r.state;
    }
    const allPara = patchParty(dived(1), { c1: PARA, c2: PARA, c3: PARA, c4: PARA, c5: PARA, c6: PARA });
    const w = execute(allPara, { type: "dungeon.turn", dir: "left" }, quiet);
    expect(kindsOf(w.events)).toContain("message:wipe.intro");
    expect(eventsOf(w.events, "beat")).toEqual([]);
  });
});

describe("冒険のターン数（TW-12。M5.5）", () => {
  test("TW-12 battle.resolve・battle.repeat・逃走の失敗・敵の奇襲のラウンドでは battle.round と同じだけ増え、逃走の成功では増えない", () => {
    const base = (): GameState => {
      const s = setup([{ monsterId: "giant_rat", hps: [500] }], { identified: ["giant_rat"] });
      s.adventureTurns = 10;
      return s;
    };
    // resolve: ラウンド 1 つで +1（round 0 → 1）
    const r1 = exec(base(), RESOLVE);
    expect(r1.state.battle!.round).toBe(1);
    expect(r1.state.adventureTurns).toBe(11);
    // 続けて repeat: もう 1 つ
    const r2 = exec(r1.state, REPEAT);
    expect(r2.state.battle!.round).toBe(2);
    expect(r2.state.adventureTurns).toBe(12);
    // 逃走の失敗: 敵だけのラウンドで +1
    const ng = exec(base(), FLEE, dataWith({ combat: { fleeBase: -1000 } }));
    expect(kindsOf(ng.events)).toContain("message:battle.fleeFail");
    expect(ng.state.battle!.round).toBe(1);
    expect(ng.state.adventureTurns).toBe(11);
    // 逃走の成功: ラウンドを解決しないので増えない
    const ok = exec(base(), FLEE, dataWith({ combat: { fleeBase: 1000 } }));
    expect(ok.state.battle).toBeNull();
    expect(ok.state.adventureTurns).toBe(10);
    // 敵の奇襲（遭遇の execute の中の敵だけのラウンド）で +1
    const d = dataWith({ combat: ALWAYS_HIT }, (x) => {
      x.monsters.find((m) => m.id === "giant_rat")!.agi = 1000;
      noAmbushAvoid(x);
    });
    const s0 = cloneState(dived(1));
    s0.adventureTurns = 5;
    const ctx = runCtx(s0, d, (c) => startBattle(c, { kind: "random", inRoom: false }, [{ monsterId: "giant_rat", count: 2 }]));
    expect(ctx.state.battle!.round).toBe(1);
    expect(ctx.state.adventureTurns).toBe(6);
  });

  test("TW-12 オートで決着まで回すと、増えた数は解決したラウンドの数（battle.round の最後の値）と同じ。乱数の消費は変えない", () => {
    const s = setup([{ monsterId: "giant_rat", hps: [3, 3] }], { identified: ["giant_rat"], inputs: {} });
    const on = exec(s, AUTO_ON).state;
    let cur = on;
    let rounds = 0;
    for (let k = 0; k < 50 && cur.battle !== null; k++) {
      cur = exec(cur, RESOLVE).state;
      rounds += 1;
    }
    expect(cur.battle).toBeNull();
    expect(cur.adventureTurns).toBe(rounds);
    // 乱数: adventureTurns を変えても同じ resolve の rng は同じ
    const t = cloneState(on);
    t.adventureTurns = 999;
    expect(exec(t, RESOLVE).state.rng).toEqual(exec(on, RESOLVE).state.rng);
  });
});
