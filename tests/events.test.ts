// EV-10〜34（衝動判定・制止判定・結果・選択）と DG-22（イベントセル）。
// 既定の一行は [アルド(リーダー), ベルク(慎重 iq7 agi6), キリ(無鉄砲 iq9 agi15), ドナ(強欲 iq8 agi10), エル(普通 iq16 agi11), フィン(慎重 iq9 agi14)]。
// 光る石板（lure 未知 3・危険 1、stat iq）の誘いの積は 無鉄砲 3×3+2×1 = 11、強欲 1×3 = 3、慎重・普通 0（手で数えた値）。
// 宝袋（lure 宝 3・危険 1、stat agi）の積は 強欲 3×3 = 9、無鉄砲 2×1 = 2、慎重・普通 0。
// 期待値は鏡の rng（cloneRng に処理の順で同じ乱数を引く）で出目を求め、手で式に当てて作る。
import { describe, expect, test } from "vitest";
import type { GameData } from "../src/core/data/index";
import { LURE_TAGS } from "../src/core/data/index";
import { cloneRng, randInt, rollDice, rollDie, weightedIndex, type RngState } from "../src/core/rng";
import { floorOf } from "../src/core/rules/dungeon";
import { cellAt, idx } from "../src/core/rules/dungeon-gen";
import { applyEffects, decideImpulse, lureProduct, pickStopper, startEvent } from "../src/core/rules/events";
import { wipeIfNoneCanAct } from "../src/core/rules/wipe";
import { cloneState, createItemInstance, dungeonOf, eventOf, itemDisplayName, makeContext } from "../src/core/state";
import type { Character, Command, GameEvent, GameState, RuleContext } from "../src/core/types";
import { execute } from "../src/core/engine";
import { data, deepFreeze, expectKnownStringKeys, expectStateInvariants, newGame } from "./helpers/core";
import { dataWithRate, findSituation, MOVE, placeAt, run, withRng } from "./helpers/dungeon";
import { atEvent, dataEvents, enterDungeon, onEvent, outcomeOnly } from "./helpers/events";

const TABLET = "glowing_tablet";
const SACK = "abandoned_sack";

function ctxWith(s: GameState, d: GameData): RuleContext {
  return makeContext(cloneState(s), d);
}

function kinds(events: readonly GameEvent[]): string[] {
  return events.map((e) => (e.kind === "message" ? `message:${e.key}` : e.kind));
}

/** party[i] の欄を書き換える（ctx を作る前の state に当てる） */
function patch(s: GameState, i: number, p: Partial<Character>): GameState {
  const t = cloneState(s);
  Object.assign(t.party[i]!, structuredClone(p));
  return t;
}

/** 全員の SAN を v にする */
function sanAll(s: GameState, v: number): GameState {
  const t = cloneState(s);
  for (const c of t.party) c.san = v;
  return t;
}

/** startEvent を ctx で直接呼び、ctx を返す（f は dive.floor の実効の構造） */
function start(s: GameState, d: GameData, eventId: string): RuleContext {
  const ctx = ctxWith(s, d);
  startEvent(ctx, floorOf(ctx.state.dive!, d), eventId);
  expectKnownStringKeys(ctx.events, d);
  return ctx;
}

const tablet = () => onEvent(TABLET);
const sack = () => onEvent(SACK);

describe("衝動判定（EV-10〜14）", () => {
  test("EV-11 lureProduct は Σ lure×lure（光る石板: 無鉄砲 11・強欲 3・慎重 0・普通 0。宝袋: 強欲 9・無鉄砲 2・慎重 0・普通 0）", () => {
    const lure = (id: string) => data.personalities.find((p) => p.id === id)!.lure;
    const t = eventOf(data, TABLET).lure;
    const s = eventOf(data, SACK).lure;
    expect(["reckless", "greedy", "cautious", "normal"].map((p) => lureProduct(lure(p), t))).toEqual([11, 3, 0, 0]);
    expect(["reckless", "greedy", "cautious", "normal"].map((p) => lureProduct(lure(p), s))).toEqual([2, 9, 0, 0]);
  });

  test("EV-10/EV-11/A2 光る石板: 1d6 を振るのはキリ・ドナだけ（積 0 の慎重・普通とリーダーは振らない）", () => {
    const d = dataEvents((x) => (x.config.events.impulseThreshold = 1000));
    for (const id of [TABLET, SACK]) {
      const { state } = onEvent(id);
      const ctx = ctxWith(state, d);
      const m = cloneRng(state.rng);
      rollDie(m, 6); // キリ
      rollDie(m, 6); // ドナ
      expect(decideImpulse(ctx, eventOf(d, id)), id).toBeNull();
      expect(ctx.state.rng, id).toEqual(m);
      expect(ctx.events).toEqual([]);
    }
  });

  test("EV-10 行動不能の者（麻痺・SAN 0・死亡）は対象外で 1d6 も振らない", () => {
    const d = dataEvents((x) => (x.config.events.impulseThreshold = 1000));
    const { state } = tablet();
    const s = patch(patch(state, 2, { status: ["paralysis"] }), 3, { san: 0 });
    const ctx = ctxWith(s, d);
    expect(decideImpulse(ctx, eventOf(d, TABLET))).toBeNull();
    expect(ctx.state.rng).toEqual(s.rng); // キリもドナも振らない
    const s2 = patch(state, 2, { life: "dead", hp: 0 });
    const ctx2 = ctxWith(s2, d);
    const m = cloneRng(s2.rng);
    rollDie(m, 6); // ドナだけ
    decideImpulse(ctx2, eventOf(d, TABLET));
    expect(ctx2.state.rng).toEqual(m);
  });

  test("EV-11/EV-12 score = 積 + (stat − 10) + 1d6 ≥ 閾値の最大。同点は agi、次に並び順", () => {
    // 宝袋（agi）: キリ 2 + (15 − 10) + rK = 7 + rK、ドナ 9 + (10 − 10) + rD = 9 + rD。閾値 8
    const { state } = sack();
    const def = eventOf(data, SACK);
    let sawKiri = false;
    let sawDona = false;
    let sawTie = false;
    for (let k = 1; k <= 80; k++) {
      const s = withRng(state, k);
      const m = cloneRng(s.rng);
      const sK = 7 + rollDie(m, 6);
      const sD = 9 + rollDie(m, 6);
      // 同点はキリ（agi 15 > 10）
      const want = sK >= sD ? "c3" : "c4";
      if (sK === sD) sawTie = true;
      const ctx = ctxWith(s, data);
      expect(decideImpulse(ctx, def)?.id).toBe(want);
      expect(ctx.state.rng).toEqual(m);
      if (want === "c3") sawKiri = true;
      else sawDona = true;
    }
    expect([sawKiri, sawDona, sawTie]).toEqual([true, true, true]);
    // 光る石板（iq）: ドナの iq を 17 にすると キリ 11 + (9 − 10) + rK = 10 + rK、ドナ 3 + (17 − 10) + rD = 10 + rD。出目が同じなら同点
    const { state: st } = tablet();
    const tdef = eventOf(data, TABLET);
    const tie = (() => {
      for (let k = 1; k < 1000; k++) {
        const s = withRng(st, k);
        const m = cloneRng(s.rng);
        if (rollDie(m, 6) === rollDie(m, 6)) return s;
      }
      throw new Error("no tie");
    })();
    const dona = (agi: number) => patch(tie, 3, { stats: { ...tie.party[3]!.stats, iq: 17, agi } });
    expect(decideImpulse(ctxWith(dona(10), data), tdef)?.id).toBe("c3"); // agi 15 > 10 でキリ
    expect(decideImpulse(ctxWith(dona(16), data), tdef)?.id).toBe("c4"); // agi 16 > 15 でドナ
    expect(decideImpulse(ctxWith(dona(15), data), tdef)?.id).toBe("c3"); // agi も同じなら並び順が前のキリ
    // 閾値に届かなければ行動者にならない（閾値 = キリの score + 1、ドナは iq 8 のまま 3 − 2 + rD ≤ 7）
    const m = cloneRng(tie.rng);
    const sK = 10 + rollDie(m, 6);
    const high = dataEvents((x) => (x.config.events.impulseThreshold = sK + 1));
    expect(decideImpulse(ctxWith(tie, high), eventOf(high, TABLET))).toBeNull();
    const eq = dataEvents((x) => (x.config.events.impulseThreshold = sK));
    expect(decideImpulse(ctxWith(tie, eq), eventOf(eq, TABLET))?.id).toBe("c3"); // ちょうど閾値は届く
  });

  test("EV-14 錯乱の普通は randInt(0,3) のタグに重み 2 で衝動に乗る（性格の lure を置き換え）", () => {
    const { state } = tablet();
    const def = eventOf(data, TABLET);
    const base = patch(state, 4, { san: 20 }); // エル（普通）SAN 20 < 25 で錯乱
    let sawEl = false;
    let sawSkip = false;
    for (let k = 1; k <= 60; k++) {
      const s = withRng(base, k);
      const m = cloneRng(s.rng);
      const sK = 11 + (9 - 10) + rollDie(m, 6);
      const sD = 3 + (8 - 10) + rollDie(m, 6);
      const tag = LURE_TAGS[randInt(m, 0, 3)]!;
      const prodE = 2 * def.lure[tag]; // 未知 6、危険 2、宝・弱者 0
      let sE = -Infinity;
      if (prodE > 0) sE = prodE + (16 - 10) + rollDie(m, 6);
      else sawSkip = true;
      const cands: [string, number, number][] = [
        ["c3", sK, 15],
        ["c4", sD, 10],
        ["c5", sE, 11],
      ];
      let want: string | null = null;
      let best = -Infinity;
      let bestAgi = -Infinity;
      for (const [id, sc, agi] of cands) {
        if (sc < 8) continue;
        if (sc > best || (sc === best && agi > bestAgi)) {
          want = id;
          best = sc;
          bestAgi = agi;
        }
      }
      const ctx = ctxWith(s, data);
      expect(decideImpulse(ctx, def)?.id ?? null).toBe(want);
      expect(ctx.state.rng).toEqual(m);
      if (want === "c5") sawEl = true;
    }
    expect(sawEl).toBe(true);
    expect(sawSkip).toBe(true);
    // 置き換え（加算しない）: 錯乱のキリは無鉄砲の lure（未知 3）を失い、タグが宝・弱者なら積 0 で 1d6 を振らない
    const d = dataEvents((x) => (x.config.events.impulseThreshold = 1000));
    const kiri = patch(state, 2, { san: 20 });
    let sawZero = false;
    for (let k = 1; k <= 40; k++) {
      const s = withRng(kiri, k);
      const m = cloneRng(s.rng);
      const tag = LURE_TAGS[randInt(m, 0, 3)]!;
      if (def.lure[tag] > 0) rollDie(m, 6);
      else sawZero = true;
      rollDie(m, 6); // ドナ
      const ctx = ctxWith(s, d);
      decideImpulse(ctx, eventOf(d, TABLET));
      expect(ctx.state.rng).toEqual(m);
    }
    expect(sawZero).toBe(true);
  });
});

describe("制止判定（EV-15, EV-20〜22）", () => {
  test("EV-20 制止者は canStop・行動可能・行動者以外の iq 最大、同値は並び順。stopCheck 偽なら null", () => {
    const { state } = tablet();
    const def = eventOf(data, TABLET);
    const kiri = (s: GameState) => s.party[2]!;
    expect(pickStopper(state, data, def, kiri(state))?.id).toBe("c6"); // フィン iq 9 > ベルク 7
    const same = patch(state, 1, { stats: { ...state.party[1]!.stats, iq: 9 } });
    expect(pickStopper(same, data, def, kiri(same))?.id).toBe("c2"); // 同値は並び順が前のベルク
    const finStop = patch(state, 5, { status: ["paralysis"] });
    expect(pickStopper(finStop, data, def, kiri(finStop))?.id).toBe("c2");
    const none = patch(patch(state, 5, { status: ["sleep"] }), 1, { san: 0 });
    expect(pickStopper(none, data, def, kiri(none))).toBeNull();
    expect(pickStopper(state, data, def, state.party[5]!)?.id).toBe("c2"); // 行動者自身は制止しない
    expect(pickStopper(state, data, { ...def, stopCheck: false }, kiri(state))).toBeNull();
    // 慎重でない者（canStop 偽）は iq が高くても制止しない（エル iq 16）
    expect(pickStopper(patch(state, 1, { personality: "normal" }), data, def, kiri(state))?.id).toBe("c6");
  });

  test("EV-15/EV-20 制止の dice は 1 件 2 行（フィン iq / キリ agi、diff）。衝動の 1d6 は dice を出さない", () => {
    const { state } = tablet();
    for (let k = 1; k <= 10; k++) {
      const s = withRng(state, k);
      const m = cloneRng(s.rng);
      rollDie(m, 6);
      rollDie(m, 6);
      const rS = rollDie(m, 10);
      const rA = rollDie(m, 10);
      const ok = 9 + rS >= 15 + rA;
      const ctx = start(s, dataEvents(), TABLET);
      const dice = ctx.events.filter((e) => e.kind === "dice");
      expect(dice).toEqual([
        {
          kind: "dice",
          label: { key: "dice.restrain" },
          rows: [
            { label: { key: "dice.restrain.stopper", params: { name: "フィン" } }, base: 9, dice: [rS], total: 9 + rS },
            { label: { key: "dice.restrain.actor", params: { name: "キリ" } }, base: 15, dice: [rA], total: 15 + rA },
          ],
          rule: { key: "dice.restrain.rule", params: { diff: 9 + rS - (15 + rA) } },
          result: { key: ok ? "dice.restrain.ok" : "dice.restrain.ng" },
        },
      ]);
      const ks = kinds(ctx.events);
      expect(ks.slice(0, 5)).toEqual(["eventStarted", "message:event.glowing_tablet.intro", "message:event.impulse.actor", "message:event.stop.roll", "dice"]);
      expect(ks[5]).toBe(ok ? "message:event.stop.success" : "message:event.stop.fail");
      expect(ctx.events.filter((e) => e.kind === "beat")).toEqual([]); // 拍は戦闘だけ（CB-55）
    }
  });

  test("EV-20 stopCheck 偽・慎重が行動不能なら判定しない（1d10 を引かない）", () => {
    const { state } = tablet();
    const noStop = dataEvents((x) => {
      eventOf(x, TABLET).stopCheck = false;
      outcomeOnly(x, TABLET, "good");
    });
    const good = dataEvents((x) => outcomeOnly(x, TABLET, "good"));
    const cases: [string, GameState, GameData][] = [
      ["stopCheck 偽", state, noStop],
      ["慎重が麻痺と睡眠", patch(patch(state, 1, { status: ["paralysis"] }), 5, { status: ["sleep"] }), good],
    ];
    for (const [name, s, d] of cases) {
      const m = cloneRng(s.rng);
      rollDie(m, 6);
      rollDie(m, 6);
      weightedIndex(m, [3, 0, 0]); // good の効果（revealFloor と SAN）は乱数を引かない
      const ctx = start(s, d, TABLET);
      expect(kinds(ctx.events), name).not.toContain("message:event.stop.roll");
      expect(kinds(ctx.events), name).not.toContain("dice");
      expect(ctx.state.rng, name).toEqual(m);
    }
  });

  test("EV-21 iq + 1d10 ≥ agi + 1d10 で成功（等しいとき成功、1 足りなければ失敗）", () => {
    const { state } = tablet();
    const s0 = patch(state, 1, { personality: "normal" }); // ベルクを外し、制止者をフィンに固定する
    const m = cloneRng(s0.rng);
    rollDie(m, 6);
    rollDie(m, 6);
    const rS = rollDie(m, 10);
    const rA = rollDie(m, 10);
    const iq = 15 + rA - rS; // フィンの合計 iq + rS がキリの合計 15 + rA とちょうど等しくなる iq
    for (const [v, ok, diff] of [
      [iq, true, 0],
      [iq - 1, false, -1],
    ] as const) {
      const s = patch(s0, 5, { stats: { ...s0.party[5]!.stats, iq: v } });
      const ctx = start(s, dataEvents(), TABLET);
      const dice = ctx.events.find((e) => e.kind === "dice")!;
      expect(dice.kind === "dice" && dice.result.key).toBe(ok ? "dice.restrain.ok" : "dice.restrain.ng");
      expect(dice.kind === "dice" && dice.rule.params).toEqual({ diff });
    }
  });

  test("EV-21/TW-15 士気（個室、judgeBonus 1）: 制止者の側に +1。判定の箱は [制止者, 士気 +1, 行動者] の 3 行で、差 −1 だった出目が差 0 で制止に変わる。乱数の消費は変わらない", () => {
    const { state } = tablet();
    const s0 = cloneState(patch(state, 1, { personality: "normal" })); // 制止者をフィンに固定する
    s0.morale = { rankId: "good" };
    const m = cloneRng(s0.rng);
    rollDie(m, 6);
    rollDie(m, 6);
    const rS = rollDie(m, 10);
    const rA = rollDie(m, 10);
    const iq = 15 + rA - rS - 1; // 士気なしなら フィンの iq + rS = キリの 15 + rA − 1（差 −1 で失敗）
    for (const [v, ok, diff] of [
      [iq, true, 0],
      [iq - 1, false, -1],
    ] as const) {
      const s = patch(s0, 5, { stats: { ...s0.party[5]!.stats, iq: v } });
      const ctx = start(s, dataEvents(), TABLET);
      const dice = ctx.events.find((e) => e.kind === "dice")!;
      expect(dice).toEqual({
        kind: "dice",
        label: { key: "dice.restrain" },
        rows: [
          { label: { key: "dice.restrain.stopper", params: { name: "フィン" } }, base: v, dice: [rS], total: v + rS },
          { label: { key: "dice.bonus.morale", params: { value: 1 } }, base: 1, dice: [], total: 1 },
          { label: { key: "dice.restrain.actor", params: { name: "キリ" } }, base: 15, dice: [rA], total: 15 + rA },
        ],
        rule: { key: "dice.restrain.rule", params: { diff } },
        result: { key: ok ? "dice.restrain.ok" : "dice.restrain.ng" },
      });
    }
    // 同じ出目で士気なしなら差 −1 で失敗（2 行のまま）
    const noMorale = patch(s0, 5, { stats: { ...s0.party[5]!.stats, iq } });
    noMorale.morale = null;
    const dice0 = start(noMorale, dataEvents(), TABLET).events.find((e) => e.kind === "dice")!;
    expect(dice0.kind === "dice" && dice0.rows.length).toBe(2);
    expect(dice0.kind === "dice" && dice0.rule.params).toEqual({ diff: -1 });
    // 士気のランクの judgeBonus が 0 なら補正の行は出さない（2 行・差 −1）
    const zero = patch(s0, 5, { stats: { ...s0.party[5]!.stats, iq } });
    const d0 = dataEvents((x) => (x.config.town.innRanks.find((r) => r.id === "good")!.judgeBonus = 0));
    const dice1 = start(zero, d0, TABLET).events.find((e) => e.kind === "dice")!;
    expect(dice1.kind === "dice" && dice1.rows.length).toBe(2);
    expect(dice1.kind === "dice" && dice1.rule.params).toEqual({ diff: -1 });
  });

  test("EV-21/IT-40 固有スキル judgeBonus（賽の目の盾 +1）は士気（+1）と足し合わせる（Q6）: 行は [制止者, 士気 +1, 盾 +1, 行動者] の 4 行で、差 −2 だった出目が差 0 で制止に変わる。乱数の消費は変わらない", () => {
    const { state } = tablet();
    const s0 = cloneState(patch(state, 1, { personality: "normal" })); // 制止者をフィンに固定する
    s0.morale = { rankId: "good" };
    const fin = s0.party[5]!;
    const shield = createItemInstance(s0, { itemId: "wooden_shield", uniqueId: "dice_eye_shield", identified: true });
    fin.equipment.shield = shield;
    const item = itemDisplayName(s0, data, shield);
    const m = cloneRng(s0.rng);
    rollDie(m, 6);
    rollDie(m, 6);
    const rS = rollDie(m, 10);
    const rA = rollDie(m, 10);
    const iq = 15 + rA - rS - 2; // 補正なしなら差 −2
    for (const [v, ok, diff] of [
      [iq, true, 0],
      [iq - 1, false, -1],
    ] as const) {
      const s = patch(s0, 5, { stats: { ...fin.stats, iq: v } });
      const ctx = start(s, dataEvents(), TABLET);
      const dice = ctx.events.find((e) => e.kind === "dice")!;
      expect(dice).toEqual({
        kind: "dice",
        label: { key: "dice.restrain" },
        rows: [
          { label: { key: "dice.restrain.stopper", params: { name: "フィン" } }, base: v, dice: [rS], total: v + rS },
          { label: { key: "dice.bonus.morale", params: { value: 1 } }, base: 1, dice: [], total: 1 },
          { label: { key: "dice.bonus.skill", params: { item, value: 1 } }, base: 1, dice: [], total: 1 },
          { label: { key: "dice.restrain.actor", params: { name: "キリ" } }, base: 15, dice: [rA], total: 15 + rA },
        ],
        rule: { key: "dice.restrain.rule", params: { diff } },
        result: { key: ok ? "dice.restrain.ok" : "dice.restrain.ng" },
      });
      if (ok) expect(ctx.state.rng).toEqual(m); // 1d6 × 2 と 1d10 × 2 だけ（補正の行は乱数を使わない。制止できたので結果の抽選も無い）
    }
    // 士気なしで盾だけなら 3 行（盾の行だけ）で差 −1
    const noMorale = patch(s0, 5, { stats: { ...fin.stats, iq } });
    noMorale.morale = null;
    const d1 = start(noMorale, dataEvents(), TABLET).events.find((e) => e.kind === "dice")!;
    expect(d1.kind === "dice" && d1.rows.map((r) => r.label.key)).toEqual(["dice.restrain.stopper", "dice.bonus.skill", "dice.restrain.actor"]);
    expect(d1.kind === "dice" && d1.rule.params).toEqual({ diff: -1 });
  });

  test("EV-22 制止成功: 不発、制止者 → 行動者の順に SAN +stopSanGain、mixed は選択型へ（screen{event} は SAN の後）", () => {
    const { state } = tablet();
    let s = patch(state, 5, { stats: { ...state.party[5]!.stats, iq: 100 }, san: 50 }); // フィンは必ず止める
    s = patch(s, 2, { san: 50 });
    const m = cloneRng(s.rng);
    rollDie(m, 6);
    rollDie(m, 6);
    const rS = rollDie(m, 10);
    const rA = rollDie(m, 10);
    const ctx = start(s, dataEvents(), TABLET);
    expect(ctx.events).toEqual([
      { kind: "eventStarted", eventId: TABLET, actorId: "c3" },
      { kind: "message", key: "event.glowing_tablet.intro" },
      { kind: "message", key: "event.impulse.actor", params: { actor: "キリ" } },
      { kind: "message", key: "event.stop.roll", params: { stopper: "フィン" } },
      {
        kind: "dice",
        label: { key: "dice.restrain" },
        rows: [
          { label: { key: "dice.restrain.stopper", params: { name: "フィン" } }, base: 100, dice: [rS], total: 100 + rS },
          { label: { key: "dice.restrain.actor", params: { name: "キリ" } }, base: 15, dice: [rA], total: 15 + rA },
        ],
        rule: { key: "dice.restrain.rule", params: { diff: 100 + rS - 15 - rA } },
        result: { key: "dice.restrain.ok" },
      },
      { kind: "message", key: "event.stop.success", params: { stopper: "フィン", actor: "キリ" } },
      { kind: "sanChanged", id: "c6", delta: 3, san: 53 },
      { kind: "sanChanged", id: "c3", delta: 3, san: 53 },
      { kind: "screen", to: "event" },
    ]);
    expect(ctx.state.rng).toEqual(m);
    expect(ctx.state.screen).toBe("event");
    expect(ctx.state.pendingChoice).toEqual({
      kind: "event",
      promptKey: "event.glowing_tablet.intro",
      options: [
        { id: "examine", labelKey: "event.glowing_tablet.choice.examine" },
        { id: "ignore", labelKey: "event.glowing_tablet.choice.ignore" },
      ],
      eventId: TABLET,
    });
    expect(ctx.state.dive!.clearedCells).toEqual([]); // B10: 選択の保留中はまだ通常セルにしない
    expectStateInvariants(ctx.state);
    // impulse 型は「何も起きない」で終わり、セルを通常にする
    const ctx2 = start(s, dataEvents((x) => (eventOf(x, TABLET).kind = "impulse")), TABLET);
    expect(kinds(ctx2.events).slice(-4)).toEqual(["message:event.stop.success", "sanChanged", "sanChanged", "message:event.nothing"]);
    expect(ctx2.state.screen).toBe("dungeon");
    expect(ctx2.state.pendingChoice).toBeNull();
    expect(ctx2.state.dive!.clearedCells).toEqual([{ floor: 1, ...ctx2.state.dive!.pos }]);
  });
});

describe("衝動の実行（EV-23, EV-24, EV-30）", () => {
  /** ベルクを普通にし、フィン（慎重）の iq を −100 にして必ず制止に失敗させる。全員 SAN 80、キリの HP 30/30 */
  function failing(s0: GameState): GameState {
    let s = sanAll(s0, 80);
    s = patch(s, 1, { personality: "normal" });
    s = patch(s, 5, { stats: { ...s.party[5]!.stats, iq: -100 } });
    return patch(s, 2, { hp: 30, hpMax: 30 });
  }
  /** 失敗までの乱数（1d6 ×2、1d10 ×2）を引いた鏡 */
  function mirrorToFail(s: GameState): RngState {
    const m = cloneRng(s.rng);
    rollDie(m, 6);
    rollDie(m, 6);
    rollDie(m, 10);
    rollDie(m, 10);
    return m;
  }
  /** stop.fail より後のイベント */
  const afterFail = (ctx: RuleContext) => ctx.events.slice(kinds(ctx.events).indexOf("message:event.stop.fail") + 1);

  test("EV-23 失敗 good: impulseBonus（石板 SAN +4 / 宝袋 2d10 金）。revealFloor は全セル", () => {
    const { state } = tablet();
    const s = failing(state);
    const m = mirrorToFail(s);
    weightedIndex(m, [3, 0, 0]);
    const ctx = start(s, dataEvents((x) => outcomeOnly(x, TABLET, "good")), TABLET);
    expect(afterFail(ctx)).toEqual([
      { kind: "message", key: "event.glowing_tablet.impulse", params: { actor: "キリ" } },
      { kind: "message", key: "event.glowing_tablet.good", params: { actor: "キリ" } },
      { kind: "sanChanged", id: "c3", delta: -2, san: 78 },
      { kind: "sanChanged", id: "c3", delta: 4, san: 82 }, // impulseBonus
    ]);
    expect(ctx.state.rng).toEqual(m);
    const f = floorOf(ctx.state.dive!, data);
    expect(ctx.state.dive!.explored["1"]).toEqual(Array.from({ length: f.width * f.height }, (_, i) => i));
    expect(ctx.state.dive!.clearedCells).toEqual([{ floor: 1, ...ctx.state.dive!.pos }]);
    expect(ctx.state.screen).toBe("dungeon");
    // 宝袋: 5d10 と bonus の 2d10 で event.gold が 2 回、強欲のドナ +2 が 2 回（CH-52）。所持金と台帳に足す
    const { state: st2 } = sack();
    const s2 = failing(st2);
    const m2 = mirrorToFail(s2);
    weightedIndex(m2, [5, 0]);
    const g1 = rollDice(m2, "5d10").total;
    const g2 = rollDice(m2, "2d10").total;
    const ctx2 = start(s2, dataEvents((x) => outcomeOnly(x, SACK, "good")), SACK);
    const actor = ctx2.events.find((e) => e.kind === "eventStarted");
    const name = s2.party.find((c) => actor?.kind === "eventStarted" && c.id === actor.actorId)!.name;
    expect(afterFail(ctx2)).toEqual([
      { kind: "message", key: "event.abandoned_sack.impulse", params: { actor: name } },
      { kind: "message", key: "event.abandoned_sack.good", params: { actor: name } },
      { kind: "message", key: "event.gold", params: { gold: g1 } },
      { kind: "sanChanged", id: "c4", delta: 2, san: 82 },
      { kind: "message", key: "event.gold", params: { gold: g2 } },
      { kind: "sanChanged", id: "c4", delta: 2, san: 84 },
    ]);
    expect(ctx2.state.gold).toBe(s2.gold + g1 + g2);
    expect(ctx2.state.dive!.ledger.gold).toBe(s2.dive!.ledger.gold + g1 + g2);
    expect(ctx2.state.rng).toEqual(m2);
  });

  test("EV-23 失敗 bad: 効果の後に event.stop.told と制止者 +3。neutral: bonus も told も無し", () => {
    const { state } = tablet();
    const s = failing(state);
    const m = mirrorToFail(s);
    weightedIndex(m, [0, 0, 4]);
    const dmg = rollDice(m, "1d6").total;
    const ctx = start(s, dataEvents((x) => outcomeOnly(x, TABLET, "bad")), TABLET);
    expect(afterFail(ctx)).toEqual([
      { kind: "message", key: "event.glowing_tablet.impulse", params: { actor: "キリ" } },
      { kind: "message", key: "event.glowing_tablet.bad", params: { actor: "キリ" } },
      ...s.party.map((c) => ({ kind: "sanChanged", id: c.id, delta: -5, san: 75 })), // 耐性なし（慎重も −5。CH-54）
      { kind: "hpChanged", id: "c3", delta: -dmg, hp: 30 - dmg },
      { kind: "message", key: "event.stop.told", params: { stopper: "フィン" } },
      { kind: "sanChanged", id: "c6", delta: 3, san: 78 },
    ]);
    expect(ctx.state.rng).toEqual(m);
    // neutral: 2d6 の金、強欲 +2。bonus も told も無い
    const mn = mirrorToFail(s);
    weightedIndex(mn, [0, 3, 0]);
    const g = rollDice(mn, "2d6").total;
    const ctxN = start(s, dataEvents((x) => outcomeOnly(x, TABLET, "neutral")), TABLET);
    expect(afterFail(ctxN)).toEqual([
      { kind: "message", key: "event.glowing_tablet.impulse", params: { actor: "キリ" } },
      { kind: "message", key: "event.glowing_tablet.neutral", params: { actor: "キリ" } },
      { kind: "message", key: "event.gold", params: { gold: g } },
      { kind: "sanChanged", id: "c4", delta: 2, san: 82 },
    ]);
    expect(ctxN.state.rng).toEqual(mn);
  });

  test("EV-24 制止者なし（stopCheck 偽・慎重がいない）: bonus も told も無い", () => {
    const { state } = tablet();
    let s = sanAll(state, 80);
    s = patch(patch(s, 1, { personality: "normal" }), 5, { personality: "normal" });
    s = patch(s, 2, { hp: 30, hpMax: 30 });
    const good = start(s, dataEvents((x) => outcomeOnly(x, TABLET, "good")), TABLET);
    expect(kinds(good.events)).toEqual([
      "eventStarted",
      "message:event.glowing_tablet.intro",
      "message:event.impulse.actor",
      "message:event.glowing_tablet.impulse",
      "message:event.glowing_tablet.good",
      "sanChanged", // −2 だけ（+4 の bonus は無い）
    ]);
    const bad = start(s, dataEvents((x) => outcomeOnly(x, TABLET, "bad")), TABLET);
    expect(kinds(bad.events)).not.toContain("message:event.stop.told");
    // stopCheck 偽（慎重はいる）でも同じ
    const noStop = start(failing(state), dataEvents((x) => {
      eventOf(x, TABLET).stopCheck = false;
      outcomeOnly(x, TABLET, "good");
    }), TABLET);
    expect(kinds(noStop.events).filter((k) => k === "sanChanged")).toHaveLength(1);
  });

  test("EV-30 結果は weightedIndex 1 回（鏡の rng と一致）", () => {
    const { state } = tablet();
    let s0 = patch(patch(state, 1, { personality: "normal" }), 5, { personality: "normal" }); // 制止なし
    s0 = patch(sanAll(s0, 80), 2, { hp: 30, hpMax: 30 });
    const def = eventOf(data, TABLET);
    const seen = new Set<string>();
    for (let k = 1; k <= 40; k++) {
      const s = withRng(s0, k);
      const m = cloneRng(s.rng);
      rollDie(m, 6);
      rollDie(m, 6);
      const o = def.impulseOutcomes[weightedIndex(m, [3, 3, 4])]!;
      if (o.quality === "neutral") rollDice(m, "2d6");
      if (o.quality === "bad") rollDice(m, "1d6");
      const ctx = start(s, dataEvents(), TABLET);
      expect(kinds(ctx.events)).toContain(`message:${o.text}`);
      expect(ctx.state.rng).toEqual(m);
      seen.add(o.quality);
    }
    expect([...seen].sort()).toEqual(["bad", "good", "neutral"]);
  });

  test("EV-30/TW-15 士気（個室、goodWeight 1）があれば good の結果の重みに +1（光る石板 [3, 3, 4] → [4, 3, 4]）。weightedIndex は 1 回（鏡の rng と一致）", () => {
    const { state } = tablet();
    let s0 = patch(patch(state, 1, { personality: "normal" }), 5, { personality: "normal" }); // 制止なし
    s0 = patch(sanAll(s0, 80), 2, { hp: 30, hpMax: 30 });
    s0.morale = { rankId: "good" };
    const def = eventOf(data, TABLET);
    expect(def.impulseOutcomes.map((o) => [o.quality, o.weight])).toEqual([
      ["good", 3],
      ["neutral", 3],
      ["bad", 4],
    ]);
    const seen = new Set<string>();
    for (let k = 1; k <= 40; k++) {
      const s = withRng(s0, k);
      const m = cloneRng(s.rng);
      rollDie(m, 6);
      rollDie(m, 6);
      const o = def.impulseOutcomes[weightedIndex(m, [4, 3, 4])]!;
      if (o.quality === "neutral") rollDice(m, "2d6");
      if (o.quality === "bad") rollDice(m, "1d6");
      const ctx = start(s, dataEvents(), TABLET);
      expect(kinds(ctx.events), String(k)).toContain(`message:${o.text}`);
      expect(ctx.state.rng, String(k)).toEqual(m);
      seen.add(o.quality);
    }
    expect([...seen].sort()).toEqual(["bad", "good", "neutral"]);
  });
});

describe("効果（EV-32）", () => {
  /** 光る石板のセルの上の ctx と、その時点の行動者（ctx.state の中の Character） */
  function fx(mut?: (s: GameState) => void, d: GameData = dataEvents()) {
    const { state } = tablet();
    const s = cloneState(state);
    mut?.(s);
    const ctx = ctxWith(s, d);
    return { ctx, f: floorOf(ctx.state.dive!, d), actor: (i: number) => ctx.state.party[i]! };
  }

  test("EV-32/DG-40 gold は所持金と台帳と event.gold。0 なら何も出さない", () => {
    const { ctx, f, actor } = fx();
    const m = cloneRng(ctx.state.rng);
    const g = rollDice(m, "2d6").total;
    const gold0 = ctx.state.gold;
    applyEffects(ctx, f, [{ type: "gold", dice: "2d6" }], actor(2));
    expect(ctx.events).toEqual([{ kind: "message", key: "event.gold", params: { gold: g } }]); // ドナは SAN 100 なので sanChanged は出ない
    expect(ctx.state.gold).toBe(gold0 + g);
    expect(ctx.state.dive!.ledger.gold).toBe(g);
    const z = fx();
    applyEffects(z.ctx, z.f, [{ type: "gold", dice: "0" }, { type: "gold", dice: "1d4-10" }], z.actor(2));
    expect(z.ctx.events).toEqual([]);
    expect(z.ctx.state.gold).toBe(gold0);
  });

  test("EV-32/CH-45 damage: 生存者ごと max(0, 出目)、HP 0 で lifeChanged → dungeon.dead → allyDeath（慎重 −5）", () => {
    const { ctx, f, actor } = fx((s) => {
      s.party[2]!.hp = 1; // 1d6 は 1 以上なので必ず倒れる
    });
    const m = cloneRng(ctx.state.rng);
    const r = rollDice(m, "1d6").total;
    applyEffects(ctx, f, [{ type: "damage", dice: "1d6", target: "actor" }], actor(2));
    const ally = (c: Character) => (c.personality === "cautious" ? 5 : 10);
    const others = ctx.state.party.filter((c) => c.id !== "c3");
    expect(ctx.events).toEqual([
      { kind: "hpChanged", id: "c3", delta: -1, hp: 0 },
      { kind: "lifeChanged", id: "c3", life: "dead" },
      { kind: "message", key: "dungeon.dead", params: { name: "キリ" } },
      ...others.map((c) => ({ kind: "sanChanged", id: c.id, delta: -ally(c), san: 100 - ally(c) })),
    ]);
    expect(r).toBeGreaterThanOrEqual(1);
    expect(ctx.state.rng).toEqual(m);
    // party は生存者ごとに振る（死者は振らない）
    const p = fx((s) => {
      s.party[5]!.life = "dead";
      s.party[5]!.hp = 0;
    });
    const mp = cloneRng(p.ctx.state.rng);
    for (let i = 0; i < 5; i++) rollDice(mp, "1d6-3");
    applyEffects(p.ctx, p.f, [{ type: "damage", dice: "1d6-3", target: "party" }], p.actor(2));
    expect(p.ctx.state.rng).toEqual(mp);
    expect(p.ctx.events.every((e) => e.kind === "hpChanged" && e.delta < 0 && e.id !== "c6")).toBe(true);
  });

  test("EV-32/CH-54 san は耐性なし（慎重も −5）、others は行動者を除く", () => {
    const { ctx, f, actor } = fx((s) => {
      for (const c of s.party) c.san = 80;
      s.party[4]!.life = "dead";
    });
    applyEffects(ctx, f, [{ type: "san", value: -5, target: "party" }], actor(2));
    expect(ctx.events).toEqual(["c1", "c2", "c3", "c4", "c6"].map((id) => ({ kind: "sanChanged", id, delta: -5, san: 75 })));
    ctx.events.length = 0;
    applyEffects(ctx, f, [{ type: "san", value: 3, target: "others" }], actor(2));
    expect(ctx.events).toEqual(["c1", "c2", "c4", "c6"].map((id) => ({ kind: "sanChanged", id, delta: 3, san: 78 })));
    ctx.events.length = 0;
    applyEffects(ctx, f, [{ type: "san", value: -2, target: "actor" }], actor(2));
    expect(ctx.events).toEqual([{ kind: "sanChanged", id: "c3", delta: -2, san: 73 }]);
    ctx.events.length = 0;
    applyEffects(ctx, f, [{ type: "san", value: -2, target: "actor" }], actor(4)); // 行動者が死んでいれば対象なし
    expect(ctx.events).toEqual([]);
  });

  test("EV-32 revealFloor は全セルを explored に、revealStairs は下り階段、最下層ではボスのセル（B9）", () => {
    const { ctx, f, actor } = fx();
    const before = [...(ctx.state.dive!.explored["1"] ?? [])];
    applyEffects(ctx, f, [{ type: "revealStairs" }], actor(0));
    expect(ctx.state.dive!.explored["1"]).toEqual([...new Set([...before, idx(f, f.stairsDown!.x, f.stairsDown!.y)])].sort((a, b) => a - b));
    applyEffects(ctx, f, [{ type: "revealFloor" }], actor(0));
    expect(ctx.state.dive!.explored["1"]).toEqual(Array.from({ length: f.width * f.height }, (_, i) => i));
    expect(ctx.events).toEqual([]); // GameEvent は出さない（語りは結果の text）
    // d02 の 3 階（最下層。下り階段が無い）ではボスのセル
    const s0 = cloneState(newGame(3));
    s0.progress.unlockedDungeons.push("d02");
    const entered = execute(s0, { type: "dungeon.enter", dungeonId: "d02" }, data).state;
    const s3 = placeAt(entered, entered.dive!.pos, entered.dive!.facing, 3);
    const c3 = ctxWith(s3, data);
    const f3 = floorOf(c3.state.dive!, data);
    expect(f3.stairsDown).toBeNull();
    applyEffects(c3, f3, [{ type: "revealStairs" }], c3.state.party[0]!);
    expect(c3.state.dive!.explored["3"]).toEqual([idx(f3, f3.boss!.x, f3.boss!.y)]);
  });

  test("EV-32/TW-14 applyEffects は f が null（酒場）のとき revealFloor / revealStairs で Error。gold / san / message / nothing は f が null でも使え、dive が無ければ台帳には入れない", () => {
    const { ctx, actor } = fx();
    expect(() => applyEffects(ctx, null, [{ type: "revealFloor" }], actor(0))).toThrow("EV-32: no floor");
    expect(() => applyEffects(ctx, null, [{ type: "revealStairs" }], actor(0))).toThrow("EV-32: no floor");
    // 街（dive null）
    const t = ctxWith(cloneState(newGame(1)), data);
    const m = cloneRng(t.state.rng);
    const g = rollDice(m, "1d4").total;
    const gold0 = t.state.gold;
    applyEffects(t, null, [{ type: "gold", dice: "1d4" }, { type: "message", key: "tavern.old_rumor.more" }, { type: "nothing" }], t.state.party[0]!);
    expect(t.events).toEqual([
      { kind: "message", key: "event.gold", params: { gold: g } },
      { kind: "message", key: "tavern.old_rumor.more" },
    ]);
    expect(t.state.gold).toBe(gold0 + g);
    expect(t.state.dive).toBeNull();
    expect(t.state.rng).toEqual(m);
  });

  test("EV-32 consumeItem: 実体を消し台帳からも外し event.consume。無ければ optional なら語らず続行、そうでなければ event.noItem で以降を飛ばす", () => {
    const wounded = eventOf(data, "wounded_adventurer");
    const help = wounded.choices.find((c) => c.id === "help")!.effects;
    const impulse = wounded.impulseOutcomes[0]!.effects; // consumeItem actor optional → revealStairs
    // party: 並び順で最初に薬草を持つ alive の者（リーダーのアルド）。台帳に入っていれば台帳からも外れる
    const { ctx, f, actor } = fx((s) => {
      s.dive!.ledger.items.push(s.party[0]!.inventory[0]!);
    });
    const herbId = ctx.state.party[0]!.inventory[0]!;
    expect(ctx.state.items[herbId]!.itemId).toBe("herb");
    applyEffects(ctx, f, help, actor(0));
    expect(ctx.events).toEqual([
      { kind: "message", key: "event.consume", params: { name: "アルド", item: "薬草" } },
      { kind: "message", key: "event.wounded_adventurer.good" },
    ]);
    expect(ctx.state.items[herbId]).toBeUndefined();
    expect(ctx.state.party[0]!.inventory).not.toContain(herbId);
    expect(ctx.state.dive!.ledger.items).not.toContain(herbId);
    expect(ctx.state.dive!.explored["1"]).toContain(idx(f, f.stairsDown!.x, f.stairsDown!.y));
    expectStateInvariants(ctx.state);
    // 誰も持っていない: event.noItem で止まり、good も revealStairs も起きない
    const noHerb = (s: GameState) => {
      for (const c of s.party) {
        for (const id of c.inventory.filter((x) => s.items[x]!.itemId === "herb")) delete s.items[id];
        c.inventory = c.inventory.filter((x) => s.items[x] !== undefined);
      }
    };
    const n = fx(noHerb);
    const explored = [...n.ctx.state.dive!.explored["1"]!];
    applyEffects(n.ctx, n.f, help, n.actor(0));
    expect(n.ctx.events).toEqual([{ kind: "message", key: "event.noItem", params: { item: "薬草" } }]);
    expect(n.ctx.state.dive!.explored["1"]).toEqual(explored);
    // optional（衝動の結果）: 持っていなくても語らずに続き、revealStairs は起きる
    const o = fx(noHerb);
    applyEffects(o.ctx, o.f, impulse, o.actor(2));
    expect(o.ctx.events).toEqual([]);
    expect(o.ctx.state.dive!.explored["1"]).toContain(idx(o.f, o.f.stairsDown!.x, o.f.stairsDown!.y));
    // actor の consumeItem は行動者の持ち物だけ（キリの薬草）
    const a = fx();
    const kiriHerb = a.ctx.state.party[2]!.inventory[0]!;
    applyEffects(a.ctx, a.f, impulse, a.actor(2));
    expect(a.ctx.events).toEqual([{ kind: "message", key: "event.consume", params: { name: "キリ", item: "薬草" } }]);
    expect(a.ctx.state.items[kiriHerb]).toBeUndefined();
  });

  test("EV-32 message は key だけ（params なし）、nothing は何もしない。未実装の種類は Error", () => {
    const { ctx, f, actor } = fx();
    applyEffects(ctx, f, [{ type: "message", key: "event.common.ignore" }, { type: "nothing" }], actor(0));
    expect(ctx.events).toEqual([{ kind: "message", key: "event.common.ignore" }]);
    expect(() => applyEffects(ctx, f, [{ type: "status", status: "poison", target: "actor" }], actor(0))).toThrow("EV-32: not implemented: status");
  });
});

// ---------------------------------------------------------------------------
// 迷宮から（execute 経由）。DG-22 / EV-13 / EV-33 / A4

describe("イベントのセル（DG-22, EV-13, EV-33）", () => {
  /** 衝動が起きない data（閾値 1000）。遭遇率は room / corridor とも rate */
  const calm = (rate = 0) =>
    dataEvents((x) => {
      x.config.events.impulseThreshold = 1000;
      for (const def of x.dungeons) def.encounterRate = { room: rate, corridor: rate };
    });
  const choiceOf = (id: string) => ({
    kind: "event",
    promptKey: `event.${id}.intro`,
    options: eventOf(data, id).choices.map((c) => ({ id: c.id, labelKey: `event.${id}.choice.${c.id}` })),
    eventId: id,
  });

  test("EV-13 衝動なしの mixed は選択型: screen{event}、pendingChoice kind event（promptKey = intro、labelKey = event.<id>.choice.<id>、eventId）、遭遇の d100 を振らない", () => {
    for (const id of [TABLET, SACK]) {
      const { state, a } = atEvent(id);
      const m = cloneRng(state.rng);
      rollDie(m, 6); // キリ
      rollDie(m, 6); // ドナ（遭遇の d100 は振らない）
      const r = run(state, MOVE, calm(1)); // 遭遇率 1 でも戦闘にならない
      expect(r.events).toEqual([
        { kind: "moved", pos: a.target, facing: a.facing },
        { kind: "eventStarted", eventId: id },
        { kind: "message", key: `event.${id}.intro` },
        { kind: "screen", to: "event" },
      ]);
      expect(r.state.rng).toEqual(m);
      expect(r.state.screen).toBe("event");
      expect(r.state.battle).toBeNull();
      expect(r.state.pendingChoice).toEqual(choiceOf(id));
      expect(r.state.dive!.clearedCells).toEqual([]);
      expectStateInvariants(r.state);
    }
  });

  test("EV-33 event.choose: screen{dungeon} が先頭、選択の text、効果、clearedCells。保留中は move / turn / useItem が choice pending", () => {
    const { state, a } = atEvent(TABLET);
    const r1 = run(state, MOVE, calm());
    const rejects: Command[] = [
      MOVE,
      { type: "dungeon.turn", dir: "left" },
      { type: "dungeon.useItem", memberId: "c1", itemId: r1.state.party[0]!.inventory[0]! },
    ];
    for (const cmd of rejects) {
      const rj = execute(r1.state, cmd, data);
      expect(rj.events).toEqual([{ kind: "rejected", command: cmd.type, reason: "choice pending" }]);
      expect(rj.state).toBe(r1.state);
    }
    expect(execute(r1.state, { type: "event.choose", optionId: "descend" }, data).events[0]).toEqual({
      kind: "rejected",
      command: "event.choose",
      reason: "unknown option",
    });
    const r2 = run(r1.state, { type: "event.choose", optionId: "examine" }, calm());
    expect(r2.events).toEqual([
      { kind: "screen", to: "dungeon", dungeonId: "d01" },
      { kind: "message", key: "event.glowing_tablet.examine" },
    ]);
    expect(r2.state.rng).toEqual(r1.state.rng); // 乱数なし
    expect(r2.state.screen).toBe("dungeon");
    expect(r2.state.pendingChoice).toBeNull();
    expect(r2.state.dive!.clearedCells).toEqual([{ floor: 1, ...a.target }]);
    expectStateInvariants(r2.state);
    const ig = run(r1.state, { type: "event.choose", optionId: "ignore" }, calm());
    expect(kinds(ig.events)).toEqual(["screen", "message:event.common.ignore"]);
    // 宝袋の search: 2d10 の金と強欲の +2（ドナの SAN を 50 にしてから）
    const sk = atEvent(SACK);
    const s1 = run(patch(sk.state, 3, { san: 50 }), MOVE, calm()).state;
    const m = cloneRng(s1.rng);
    const g = rollDice(m, "2d10").total;
    const r3 = run(s1, { type: "event.choose", optionId: "search" }, calm());
    expect(r3.events).toEqual([
      { kind: "screen", to: "dungeon", dungeonId: "d01" },
      { kind: "message", key: "event.abandoned_sack.search" },
      { kind: "message", key: "event.gold", params: { gold: g } },
      { kind: "sanChanged", id: "c4", delta: 2, san: 52 },
    ]);
    expect(r3.state.rng).toEqual(m);
    expect(r3.state.gold).toBe(s1.gold + g);
    expect(r3.state.dive!.ledger.gold).toBe(s1.dive!.ledger.gold + g);
    expect(r3.state.dive!.clearedCells).toEqual([{ floor: 2, ...sk.a.target }]);
  });

  test("EV-33/DG-22 処理後はセルが通常（floorOf・clearedCells）。保留中はまだ入らない。もう一度入ると遭遇判定だけ", () => {
    const { state, a } = atEvent(TABLET);
    const r1 = run(state, MOVE, calm());
    expect(cellAt(floorOf(r1.state.dive!, data), a.target.x, a.target.y).kind).toBe("event"); // 保留中はまだイベント
    const r2 = run(r1.state, { type: "event.choose", optionId: "ignore" }, calm());
    const cell = cellAt(floorOf(r2.state.dive!, data), a.target.x, a.target.y);
    expect(cell.kind).toBe(cell.roomId !== null ? "room" : "corridor");
    expect(cell.eventId).toBeNull();
    // 戻ってもう一度入ると、遭遇の d100 だけ（イベントは起きない）
    const again = placeAt(r2.state, a.pos, a.facing);
    const m = cloneRng(again.rng);
    randInt(m, 1, 100);
    const r3 = run(again, MOVE, calm());
    expect(r3.events).toEqual([{ kind: "moved", pos: a.target, facing: a.facing }]);
    expect(r3.state.rng).toEqual(m);
    // 衝動で決着した場合も同じ（制止なし・good）
    const imp = dataEvents((x) => {
      eventOf(x, TABLET).stopCheck = false;
      outcomeOnly(x, TABLET, "good");
    });
    const r4 = run(state, MOVE, imp);
    expect(r4.state.screen).toBe("dungeon"); // A4: 衝動だけで決着したら screen event を立てない
    expect(kinds(r4.events)).not.toContain("screen");
    expect(r4.state.dive!.clearedCells).toEqual([{ floor: 1, ...a.target }]);
    expectStateInvariants(r4.state);
  });

  test("DG-22/CB-01 イベントセルでは遭遇の d100 を振らない（rate 1 でも戦闘にならない。衝動で決着する歩も）", () => {
    const { state } = atEvent(TABLET);
    const d1 = dataEvents((x) => {
      for (const def of x.dungeons) def.encounterRate = { room: 1, corridor: 1 };
      eventOf(x, TABLET).stopCheck = false;
      outcomeOnly(x, TABLET, "good");
    });
    const m = cloneRng(state.rng);
    rollDie(m, 6);
    rollDie(m, 6);
    weightedIndex(m, [3, 0, 0]);
    const r = run(state, MOVE, d1);
    expect(r.state.battle).toBeNull();
    expect(r.state.rng).toEqual(m);
  });

  test("TW-20/EV-32 イベントのダメージ・SAN で全員行動不能なら同じ execute で全滅処理（screen town）", () => {
    const { state } = atEvent(TABLET);
    const s = sanAll(state, 5);
    for (const c of s.party) c.hp = 1;
    const d = dataEvents((x) => {
      x.config.san.confusedRatio = 0.01; // SAN 5 を不安（錯乱でない）にして、衝動の乱数を既定の 2 人の 1d6 に保つ
      eventOf(x, TABLET).stopCheck = false;
      outcomeOnly(x, TABLET, "bad");
    });
    const r = run(s, MOVE, d);
    const ks = kinds(r.events);
    expect(ks.slice(0, 6)).toEqual([
      "moved",
      "eventStarted",
      "message:event.glowing_tablet.intro",
      "message:event.impulse.actor",
      "message:event.glowing_tablet.impulse",
      "message:event.glowing_tablet.bad",
    ]);
    expect(ks).toContain("wipe");
    expect(ks.indexOf("message:wipe.intro")).toBeGreaterThan(ks.indexOf("message:event.glowing_tablet.bad"));
    expect(ks).not.toContain("message:battle.encounter");
    expect(r.events.at(-1)).toEqual({ kind: "screen", to: "town" });
    expect(r.state.screen).toBe("town");
    expect(r.state.dive).toBeNull();
    expect(r.state.pendingChoice).toBeNull();
    expectStateInvariants(r.state);
  });

  test("TW-20/A4 wipeIfNoneCanAct は screen event でも全滅処理（pendingChoice を下ろし screen town）", () => {
    const { state } = atEvent(TABLET);
    const r1 = run(state, MOVE, calm());
    expect(r1.state.screen).toBe("event");
    const ctx = ctxWith(r1.state, data);
    for (const c of ctx.state.party) c.san = 0;
    wipeIfNoneCanAct(ctx);
    expect(kinds(ctx.events)).toContain("wipe");
    expect(ctx.events.filter((e) => e.kind === "screen")).toEqual([{ kind: "screen", to: "town" }]); // screen{dungeon} は出さない
    expect(ctx.state.screen).toBe("town");
    expect(ctx.state.pendingChoice).toBeNull();
    expect(ctx.state.dive).toBeNull();
    expectStateInvariants(ctx.state);
    // 行動可能な者がいれば何もしない
    const ok = ctxWith(r1.state, data);
    wipeIfNoneCanAct(ok);
    expect(ok.events).toEqual([]);
    expect(ok.state.screen).toBe("event");
  });

  test("CH-52/A8 イベントの金ごとに強欲 +2（宝袋の search）。ドナが死亡・虚脱なら増えない", () => {
    const sk = atEvent(SACK);
    const cases: [string, Partial<Character>, GameEvent[]][] = [
      ["SAN 50", { san: 50 }, [{ kind: "sanChanged", id: "c4", delta: 2, san: 52 }]],
      ["死亡", { san: 50, life: "dead", hp: 0 }, []],
      ["虚脱", { san: 0 }, []],
    ];
    for (const [name, p, want] of cases) {
      const s1 = run(patch(sk.state, 3, p), MOVE, calm()).state;
      const r = run(s1, { type: "event.choose", optionId: "search" }, calm());
      expect(r.events.filter((e) => e.kind === "sanChanged"), name).toEqual(want);
    }
  });

  test("E3/SV-50 イベント・察知の保留は同じ events に key === promptKey（params なし）の message", () => {
    const check = (r: { events: GameEvent[]; state: GameState }) => {
      const pc = r.state.pendingChoice!;
      expect(r.events.filter((e) => e.kind === "message" && e.key === pc.promptKey && e.params === undefined)).toHaveLength(1);
      expect(data.strings[pc.promptKey]).not.toContain("{");
      for (const o of pc.options) expect(data.strings[o.labelKey], o.labelKey).not.toContain("{");
    };
    // 衝動なし
    check(run(atEvent(TABLET).state, MOVE, calm()));
    check(run(atEvent(SACK).state, MOVE, calm()));
    // 制止成功から選択へ
    const st = atEvent(TABLET).state;
    const s = patch(st, 5, { stats: { ...st.party[5]!.stats, iq: 100 } });
    const r = run(s, MOVE, dataEvents());
    expect(r.state.pendingChoice?.kind).toBe("event");
    check(r);
    // 罠の察知
    const pit = findSituation((c) => c.kind === "trap" && c.trapId === "pit").state;
    let k = 1;
    let rt = run(withRng(pit, k), MOVE, dataWithRate(0, 0));
    while (rt.state.pendingChoice === null) rt = run(withRng(pit, ++k), MOVE, dataWithRate(0, 0));
    expect(rt.state.pendingChoice.kind).toBe("trap");
    check(rt);
  });

  test("§3-2 イベントの execute は決定的で引数を書き換えない（JSON 往復で等しい）", () => {
    const frozen = deepFreeze(dataEvents());
    const calmFrozen = deepFreeze(calm());
    const t = atEvent(TABLET).state;
    const offered = run(t, MOVE, calmFrozen).state;
    const cases: [GameState, Command, GameData][] = [
      [t, MOVE, frozen],
      [t, MOVE, calmFrozen],
      [offered, { type: "event.choose", optionId: "examine" }, calmFrozen],
      [run(atEvent(SACK).state, MOVE, calmFrozen).state, { type: "event.choose", optionId: "search" }, calmFrozen],
    ];
    for (const [s, cmd, d] of cases) {
      const fz = deepFreeze(cloneState(s));
      const before = JSON.stringify(fz);
      const a = execute(fz, cmd, d);
      const b = execute(fz, cmd, d);
      expect(a.events[0]?.kind).not.toBe("rejected");
      expect(a).toEqual(b);
      expect(JSON.stringify(fz)).toBe(before);
      expect(JSON.parse(JSON.stringify(a.state))).toStrictEqual(a.state);
      expectStateInvariants(a.state);
    }
  });
});

describe("M9 のイベント（EV-53〜55, DG-22）", () => {
  const BOX = "sunken_offering_box";
  const FONT = "murmuring_font";
  const PILGRIM = "pinned_pilgrim";
  /** 衝動が起きない data（閾値 1000、遭遇率 0） */
  const calm = () => dataEvents((x) => (x.config.events.impulseThreshold = 1000));
  /** ベルクを普通にし、フィン（慎重）の iq を −100 にして必ず制止に失敗させる。全員 SAN 80 */
  function failing(s0: GameState): GameState {
    let s = sanAll(s0, 80);
    s = patch(s, 1, { personality: "normal" });
    return patch(s, 5, { stats: { ...s.party[5]!.stats, iq: -100 } });
  }
  const afterFail = (ctx: RuleContext) => ctx.events.slice(kinds(ctx.events).indexOf("message:event.stop.fail") + 1);

  test("EV-11/EV-53〜55 lureProduct（献金箱: 強欲 9・無鉄砲 2。洗礼盤: 無鉄砲 11・強欲 3。巡礼者: 慎重 3。普通はどれも 0）。EV-41 good は衝動でしか出ない", () => {
    const lure = (id: string) => data.personalities.find((p) => p.id === id)!.lure;
    const prod = (ev: string) =>
      ["cautious", "reckless", "greedy", "normal"].map((p) => lureProduct(lure(p), eventOf(data, ev).lure));
    expect(prod(BOX)).toEqual([0, 2, 9, 0]);
    expect(prod(FONT)).toEqual([0, 11, 3, 0]);
    expect(prod(PILGRIM)).toEqual([3, 0, 0, 0]);
    for (const id of [BOX, FONT, PILGRIM]) {
      expect(eventOf(data, id).impulseOutcomes.filter((o) => o.quality === "good").map((o) => o.requires)).toEqual(["impulse"]);
    }
  });

  test("DG-22 d02 の events の配置: 1 階に献金箱と傷ついた冒険者、2 階に洗礼盤、3 階に巡礼者（各 1 回）", () => {
    expect(dungeonOf(data, "d02").events).toEqual([BOX, FONT, PILGRIM, "wounded_adventurer"]);
    for (const seed of [1, 2, 3]) {
      const s = enterDungeon(seed, "d02");
      const byFloor = [1, 2, 3].map((n) => {
        const f = floorOf(s.dive!, data, n);
        return f.cells.filter((c) => c.kind === "event").map((c) => c.eventId).sort();
      });
      expect(byFloor).toEqual([[BOX, "wounded_adventurer"].sort(), [FONT], [PILGRIM]]);
    }
  });

  test("EV-53 沈んだ献金箱: 強欲のドナが衝動で掴み、制止に失敗すると good の 6d10 と impulseBonus の 3d10（金ごとに強欲 +2）。bad は 2d4 と SAN −3 と言わんこっちゃない", () => {
    const { state } = onEvent(BOX, "d02");
    const s = patch(failing(state), 2, { personality: "normal" }); // キリを普通にして 1d6 はドナだけ
    const m = cloneRng(s.rng);
    rollDie(m, 6); // ドナ
    rollDie(m, 10); // フィン（制止者）
    rollDie(m, 10); // ドナ
    weightedIndex(m, [4, 0, 0]);
    const g1 = rollDice(m, "6d10").total;
    const g2 = rollDice(m, "3d10").total;
    const ctx = start(s, dataEvents((x) => outcomeOnly(x, BOX, "good")), BOX);
    expect(ctx.events.find((e) => e.kind === "eventStarted")).toEqual({ kind: "eventStarted", eventId: BOX, actorId: "c4" });
    expect(afterFail(ctx)).toEqual([
      { kind: "message", key: "event.sunken_offering_box.impulse", params: { actor: "ドナ" } },
      { kind: "message", key: "event.sunken_offering_box.good", params: { actor: "ドナ" } },
      { kind: "message", key: "event.gold", params: { gold: g1 } },
      { kind: "sanChanged", id: "c4", delta: 2, san: 82 },
      { kind: "message", key: "event.gold", params: { gold: g2 } },
      { kind: "sanChanged", id: "c4", delta: 2, san: 84 },
    ]);
    expect(ctx.state.gold).toBe(s.gold + g1 + g2);
    expect(ctx.state.rng).toEqual(m);
    const mb = cloneRng(s.rng);
    rollDie(mb, 6);
    rollDie(mb, 10);
    rollDie(mb, 10);
    weightedIndex(mb, [0, 0, 4]);
    const dmg = rollDice(mb, "2d4").total;
    const bad = start(s, dataEvents((x) => outcomeOnly(x, BOX, "bad")), BOX);
    const hp = s.party[3]!.hp;
    expect(afterFail(bad)).toEqual([
      { kind: "message", key: "event.sunken_offering_box.impulse", params: { actor: "ドナ" } },
      { kind: "message", key: "event.sunken_offering_box.bad", params: { actor: "ドナ" } },
      { kind: "hpChanged", id: "c4", delta: -Math.min(hp, dmg), hp: Math.max(0, hp - dmg) },
      { kind: "sanChanged", id: "c4", delta: -3, san: 77 },
      { kind: "message", key: "event.stop.told", params: { stopper: "フィン" } },
      { kind: "sanChanged", id: "c6", delta: 3, san: 83 },
    ]);
    expect(bad.state.rng).toEqual(mb);
  });

  test("EV-53 選択 pry は gold 2d10（強欲 +2）、leave は何もしない", () => {
    const { state, a } = atEvent(BOX, "d02");
    const s1 = run(patch(state, 3, { san: 50 }), MOVE, calm()).state;
    expect(s1.pendingChoice?.kind).toBe("event");
    const m = cloneRng(s1.rng);
    const g = rollDice(m, "2d10").total;
    const r = run(s1, { type: "event.choose", optionId: "pry" }, calm());
    expect(r.events).toEqual([
      { kind: "screen", to: "dungeon", dungeonId: "d02" },
      { kind: "message", key: "event.sunken_offering_box.pry" },
      { kind: "message", key: "event.gold", params: { gold: g } },
      { kind: "sanChanged", id: "c4", delta: 2, san: 52 },
    ]);
    expect(r.state.rng).toEqual(m);
    expect(r.state.gold).toBe(s1.gold + g);
    expect(r.state.dive!.ledger.gold).toBe(s1.dive!.ledger.gold + g);
    expect(r.state.dive!.clearedCells).toEqual([{ floor: 1, ...a.target }]);
    const lv = run(s1, { type: "event.choose", optionId: "leave" }, calm());
    expect(kinds(lv.events)).toEqual(["screen", "message:event.common.ignore"]);
    expect(lv.state.rng).toEqual(s1.rng);
  });

  test("EV-54 囁く洗礼盤: good は revealStairs（2 階の下り階段のセルが explored に入る）と SAN −2、impulseBonus +4。bad は全員 SAN −6", () => {
    const { state } = onEvent(FONT, "d02");
    const s = failing(state);
    const m = cloneRng(s.rng);
    rollDie(m, 6); // キリ
    rollDie(m, 6); // ドナ
    rollDie(m, 10);
    rollDie(m, 10);
    weightedIndex(m, [3, 0, 0]);
    const ctx = start(s, dataEvents((x) => outcomeOnly(x, FONT, "good")), FONT);
    expect(afterFail(ctx)).toEqual([
      { kind: "message", key: "event.murmuring_font.impulse", params: { actor: "キリ" } },
      { kind: "message", key: "event.murmuring_font.good", params: { actor: "キリ" } },
      { kind: "sanChanged", id: "c3", delta: -2, san: 78 },
      { kind: "sanChanged", id: "c3", delta: 4, san: 82 },
    ]);
    expect(ctx.state.rng).toEqual(m);
    expect(ctx.state.dive!.floor).toBe(2);
    const f = floorOf(ctx.state.dive!, data);
    expect(ctx.state.dive!.explored["2"]).toContain(idx(f, f.stairsDown!.x, f.stairsDown!.y));
    expect(ctx.state.dive!.explored["2"]!.length).toBeLessThan(f.width * f.height); // 全景ではない
    const mb = cloneRng(s.rng);
    rollDie(mb, 6);
    rollDie(mb, 6);
    rollDie(mb, 10);
    rollDie(mb, 10);
    weightedIndex(mb, [0, 0, 4]);
    const bad = start(s, dataEvents((x) => outcomeOnly(x, FONT, "bad")), FONT);
    expect(afterFail(bad).slice(2, 8)).toEqual(s.party.map((c) => ({ kind: "sanChanged", id: c.id, delta: -6, san: 74 })));
    expect(bad.state.rng).toEqual(mb);
  });

  test("EV-54 pray は全員 SAN +2（sanMax で止まる）、乱数を引かない", () => {
    const { state } = atEvent(FONT, "d02");
    const s0 = patch(sanAll(state, 80), 0, { san: 99 });
    const s1 = run(s0, MOVE, calm()).state;
    expect(s1.pendingChoice?.kind).toBe("event");
    const r = run(s1, { type: "event.choose", optionId: "pray" }, calm());
    expect(r.events).toEqual([
      { kind: "screen", to: "dungeon", dungeonId: "d02" },
      { kind: "message", key: "event.murmuring_font.pray" },
      { kind: "sanChanged", id: "c1", delta: 1, san: 100 },
      ...["c2", "c3", "c4", "c5", "c6"].map((id) => ({ kind: "sanChanged", id, delta: 2, san: 82 })),
    ]);
    expect(r.state.rng).toEqual(s1.rng);
  });

  test("EV-55 瓦礫の下の巡礼者: stopCheck 偽で制止判定をしない（慎重のフィンがいても）。good は 3d10 の金と行動者の SAN +4", () => {
    expect(eventOf(data, PILGRIM).stopCheck).toBe(false);
    const { state } = onEvent(PILGRIM, "d02");
    let s = sanAll(state, 80);
    s = patch(s, 5, { stats: { ...s.party[5]!.stats, str: -100 } }); // フィンは 1d6 を振るが閾値に届かない → 行動者はベルク
    const m = cloneRng(s.rng);
    rollDie(m, 6); // ベルク
    rollDie(m, 6); // フィン（制止の 1d10 は振らない）
    weightedIndex(m, [3, 0]);
    const g = rollDice(m, "3d10").total;
    const ctx = start(s, dataEvents((x) => outcomeOnly(x, PILGRIM, "good")), PILGRIM);
    expect(ctx.events).toEqual([
      { kind: "eventStarted", eventId: PILGRIM, actorId: "c2" },
      { kind: "message", key: "event.pinned_pilgrim.intro" },
      { kind: "message", key: "event.impulse.actor", params: { actor: "ベルク" } },
      { kind: "message", key: "event.pinned_pilgrim.impulse", params: { actor: "ベルク" } },
      { kind: "message", key: "event.pinned_pilgrim.good", params: { actor: "ベルク" } },
      { kind: "message", key: "event.gold", params: { gold: g } },
      { kind: "sanChanged", id: "c4", delta: 2, san: 82 }, // 強欲の財宝入手（CH-52）
      { kind: "sanChanged", id: "c2", delta: 4, san: 84 },
    ]);
    expect(ctx.state.rng).toEqual(m);
    // 対照: stopCheck を真にすると制止判定が起きる
    const withStop = start(s, dataEvents((x) => {
      eventOf(x, PILGRIM).stopCheck = true;
      outcomeOnly(x, PILGRIM, "good");
    }), PILGRIM);
    expect(kinds(withStop.events)).toContain("message:event.stop.roll");
  });

  test("EV-55 lift は全員に 1d2 のダメージ（並び順）と gold 1d10、abandon は全員 SAN −3", () => {
    const { state } = atEvent(PILGRIM, "d02");
    const s1 = run(state, MOVE, calm()).state;
    expect(s1.pendingChoice?.kind).toBe("event");
    const m = cloneRng(s1.rng);
    const dmg = s1.party.map(() => rollDice(m, "1d2").total);
    const g = rollDice(m, "1d10").total;
    const r = run(s1, { type: "event.choose", optionId: "lift" }, calm());
    expect(r.events).toEqual([
      { kind: "screen", to: "dungeon", dungeonId: "d02" },
      { kind: "message", key: "event.pinned_pilgrim.lift" },
      ...s1.party.map((c, i) => ({ kind: "hpChanged", id: c.id, delta: -dmg[i]!, hp: c.hp - dmg[i]! })),
      { kind: "message", key: "event.gold", params: { gold: g } },
    ]);
    expect(r.state.rng).toEqual(m);
    expect(r.state.gold).toBe(s1.gold + g);
    const ab = run(s1, { type: "event.choose", optionId: "abandon" }, calm());
    expect(ab.events).toEqual([
      { kind: "screen", to: "dungeon", dungeonId: "d02" },
      { kind: "message", key: "event.pinned_pilgrim.abandon" },
      ...s1.party.map((c) => ({ kind: "sanChanged", id: c.id, delta: -3, san: c.san - 3 })),
    ]);
    expect(ab.state.rng).toEqual(s1.rng);
  });
});
