// 酒場の見回すと酒場のイベント（TW-13 / TW-14。M5.5）。乱数は鏡の rng（cloneRng に同じ順で引く）で期待値を作る。
import { describe, expect, test } from "vitest";
import type { GameData } from "../src/core/data";
import { createInitialState, execute } from "../src/core/engine";
import { chance, cloneRng, createRng, randInt, rollDice, weightedIndex, type RngState } from "../src/core/rng";
import { tavernEventReady } from "../src/core/rules/tavern";
import { cloneState } from "../src/core/state";
import type { Command, GameEvent, GameState } from "../src/core/types";
import { dived, withBattle } from "./helpers/battle";
import { data, deepFreeze, expectKnownStringKeys, loadFreshData, newGame } from "./helpers/core";

const LOOK: Command = { type: "town.lookAround" };

function dataChance(pct: number): GameData {
  const d = loadFreshData();
  d.config.town.tavernEventChance = pct;
  return d;
}

/** 街の state で adventureTurns / tavernEventMark / rng を差し替えたもの */
function town(turns: number, mark = 0, seed = 1): GameState {
  const s = cloneState(newGame(1));
  s.adventureTurns = turns;
  s.tavernEventMark = mark;
  s.rng = createRng(seed);
  return s;
}

function look(s: GameState, d: GameData = data) {
  const r = execute(s, LOOK, d);
  expectKnownStringKeys(r.events, d);
  return r;
}

/** 鏡: 見回すの語り（randInt 1 回）の添字 */
function mirrorLook(m: RngState, d: GameData = data): string {
  return d.tavern.lookTexts[randInt(m, 0, d.tavern.lookTexts.length - 1)]!;
}

describe("酒場の見回す（TW-13）", () => {
  test("TW-13 town.lookAround は街でだけ受け付ける（迷宮・戦闘・title は rejected wrong screen。state は同じ参照で乱数も変えない）", () => {
    const cases: Array<[string, GameState]> = [
      ["dungeon", dived(1)],
      ["battle", withBattle(dived(1), [{ monsterId: "giant_rat", hps: [3] }])],
      ["title", createInitialState(1, data)],
    ];
    for (const [name, s] of cases) {
      const r = execute(s, LOOK, data);
      expect(r.state, name).toBe(s);
      expect(r.events, name).toEqual([{ kind: "rejected", command: "town.lookAround", reason: "wrong screen" }]);
    }
    // 選択の保留中（E3）は choice pending
    const pending = cloneState(dived(1));
    pending.pendingChoice = { kind: "stairs", promptKey: "dungeon.stairsUp", options: [{ id: "stay", labelKey: "dungeon.choice.stay" }] };
    expect(execute(pending, LOOK, data).events).toEqual([{ kind: "rejected", command: "town.lookAround", reason: "choice pending" }]);
  });

  test("TW-13 条件外（adventureTurns − tavernEventMark < tavernEventTurns）は lookTexts[randInt(0, n−1)] の message 1 件だけ（鏡の rng: randInt を 1 回だけ消費）", () => {
    expect(data.config.town.tavernEventTurns).toBe(200);
    expect(data.tavern.lookTexts).toHaveLength(4);
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const s = town(0, 0, seed);
      const m = cloneRng(s.rng);
      const key = mirrorLook(m);
      seen.add(key);
      const r = look(s, dataChance(100)); // 確率 100 でも条件外なら起きない
      expect(r.events).toEqual([{ kind: "message", key }]);
      expect(r.state.rng).toEqual(m);
      expect(r.state.tavernEventMark).toBe(0);
      expect(r.state.gold).toBe(s.gold);
      expect(r.state.screen).toBe("town");
    }
    expect(seen.size).toBe(4); // どの語りも出うる
  });

  test("TW-14 境界: 差がちょうど tavernEventTurns なら chance を引き、1 少なければ引かない（鏡の rng の消費数で確かめる）", () => {
    const d = dataChance(0); // 外れ（chance(0) でも乱数は 1 回引く）
    const s1 = town(250, 50); // 差 200
    expect(tavernEventReady(s1, d)).toBe(true);
    const m1 = cloneRng(s1.rng);
    mirrorLook(m1, d);
    expect(chance(m1, 0)).toBe(false);
    expect(look(s1, d).state.rng).toEqual(m1);
    const s0 = town(249, 50); // 差 199
    expect(tavernEventReady(s0, d)).toBe(false);
    const m0 = cloneRng(s0.rng);
    mirrorLook(m0, d);
    expect(look(s0, d).state.rng).toEqual(m0);
    expect(m0).not.toEqual(m1);
  });

  test("TW-14 外れ（tavernEventChance 0 の data）は何も起きず tavernEventMark は変わらない（chance は 1 回消費する）", () => {
    const d = dataChance(0);
    const s = town(500, 100, 7);
    const m = cloneRng(s.rng);
    const key = mirrorLook(m, d);
    chance(m, 0);
    const r = look(s, d);
    expect(r.events).toEqual([{ kind: "message", key }]);
    expect(r.state.rng).toEqual(m);
    expect(r.state.tavernEventMark).toBe(100);
    expect(r.state.adventureTurns).toBe(500);
    expect(r.state.gold).toBe(s.gold);
  });

  test("TW-14 当たり（tavernEventChance 100 の data）: weightedIndex で選んだイベントの text → 効果。tavernEventMark = adventureTurns。dropped_coin は 2d6 を所持金に足して event.gold（台帳は無い）。続けて見回すと差 0 なので起きない", () => {
    const d = dataChance(100);
    expect(d.tavern.events.map((e) => [e.id, e.weight])).toEqual([
      ["dropped_coin", 2],
      ["old_rumor", 1],
    ]);
    const seen = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      const s = town(300, 0, seed);
      const m = cloneRng(s.rng);
      const key = mirrorLook(m, d);
      chance(m, 100);
      const ev = d.tavern.events[weightedIndex(m, d.tavern.events.map((e) => e.weight))]!;
      seen.add(ev.id);
      const want: GameEvent[] = [
        { kind: "message", key },
        { kind: "message", key: ev.text },
      ];
      let gold = s.gold;
      if (ev.id === "dropped_coin") {
        const g = rollDice(m, "2d6").total;
        gold += g;
        want.push({ kind: "message", key: "event.gold", params: { gold: g } }); // 街では SAN が満タンなので強欲の SAN は動かない
      } else {
        want.push({ kind: "message", key: "tavern.old_rumor.more" });
      }
      const r = look(s, d);
      expect(r.events, `seed ${seed}`).toEqual(want);
      expect(r.state.rng).toEqual(m);
      expect(r.state.gold).toBe(gold);
      expect(r.state.tavernEventMark).toBe(300);
      expect(r.state.dive).toBeNull();
      expect(r.state.screen).toBe("town");
      // 続けて見回すと差 0 なので起きない（randInt 1 回だけ）
      const m2 = cloneRng(r.state.rng);
      const key2 = mirrorLook(m2, d);
      const r2 = look(r.state, d);
      expect(r2.events).toEqual([{ kind: "message", key: key2 }]);
      expect(r2.state.rng).toEqual(m2);
    }
    expect([...seen].sort()).toEqual(["dropped_coin", "old_rumor"]);
  });

  test("TW-14 san（party）と nothing の効果: san は生存者全員に耐性なしで足し引き、nothing は何もしない", () => {
    const d = dataChance(100);
    d.tavern.events = [{ id: "chill", name: "冷えた風", weight: 1, text: "tavern.old_rumor.text", effects: [{ type: "san", value: -4, target: "party" }, { type: "nothing" }] }];
    const s = town(200, 0, 3);
    s.party[2]!.life = "dead";
    s.party[2]!.hp = 0;
    const r = look(s, d);
    const sc = r.events.filter((e) => e.kind === "sanChanged");
    expect(sc.map((e) => (e as { id: string }).id)).toEqual(s.party.filter((c) => c.life === "alive").map((c) => c.id));
    for (const e of sc) expect((e as { delta: number }).delta).toBe(-4);
    expect(r.state.tavernEventMark).toBe(200);
  });
});

describe("酒場の見回すの §3-2", () => {
  test("§3-2/TW-13/TW-14 town.lookAround は決定的で引数を書き換えず、返る state は JSON 往復で等しい（語りだけ・イベントが当たるの両方）", () => {
    const cases: Array<[string, GameData]> = [
      ["語りだけ（chance 0）", deepFreeze(dataChance(0))],
      ["当たり（chance 100）", deepFreeze(dataChance(100))],
    ];
    for (const [name, d] of cases) {
      for (let seed = 1; seed <= 10; seed++) {
        const s = deepFreeze(town(1000, 0, seed)); // 差 1000 ≥ tavernEventTurns
        const before = JSON.stringify(s);
        const r1 = execute(s, LOOK, d);
        const r2 = execute(s, LOOK, d);
        expect(JSON.stringify(s), `${name} seed ${seed}`).toBe(before);
        expect(r2.state, `${name} seed ${seed}`).toEqual(r1.state);
        expect(r2.events, `${name} seed ${seed}`).toEqual(r1.events);
        expect(JSON.parse(JSON.stringify(r1.state)), `${name} seed ${seed}`).toStrictEqual(r1.state);
        // 当たりの data では tavernEventMark が進む（受理経路を通っていることの確認）
        expect(r1.state.tavernEventMark, `${name} seed ${seed}`).toBe(name.startsWith("当たり") ? 1000 : 0);
      }
    }
  });
});
