// 酒場の見回すと酒場のイベント（TW-13 / TW-14。M5.5）。乱数は鏡の rng（cloneRng に同じ順で引く）で期待値を作る。
import { describe, expect, test } from "vitest";
import type { GameData } from "../src/core/data";
import { createInitialState, execute } from "../src/core/engine";
import { chance, cloneRng, createRng, randInt, rollDice, weightedIndex, type RngState } from "../src/core/rng";
import { tavernEventReady } from "../src/core/rules/tavern";
import { cloneState } from "../src/core/state";
import type { Command, GameEvent, GameState } from "../src/core/types";
import { dived, withBattle } from "./helpers/battle";
import { kinsokuLines } from "./helpers/wrap";
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

/** 鏡: 見回すの語り key の message と、それが掲示板（rumor.look）なら続く噂の message（M19 D-2。乱数は引かない） */
function lookEvents(key: string, s: GameState, d: GameData = data): GameEvent[] {
  const out: GameEvent[] = [{ kind: "message", key }];
  if (key !== d.tavern.rumor.look) return out;
  for (const id of s.progress.unlockedDungeons) {
    const g = d.dungeons.find((x) => x.id === id)!;
    if (g.placeholder === true) continue;
    out.push({ kind: "message", key: d.tavern.rumor.text, params: { name: g.name, floors: g.floors, description: g.description } });
  }
  return out;
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
      expect(r.events).toEqual(lookEvents(key, s));
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
    expect(r.events).toEqual(lookEvents(key, s, d));
    expect(r.state.rng).toEqual(m);
    expect(r.state.tavernEventMark).toBe(100);
    expect(r.state.adventureTurns).toBe(500);
    expect(r.state.gold).toBe(s.gold);
  });

  test("TW-14 当たり（tavernEventChance 100 の data）: weightedIndex で選んだイベントの text → 効果。tavernEventMark = adventureTurns。dropped_coin は 2d6・spilled_wager は 3d6 を所持金に足して event.gold（台帳は無い）、old_rumor・drowned_bell_rumor は message。続けて見回すと差 0 なので起きない（M9 で 4 つ: 重み 2 / 1 / 2 / 1）", () => {
    const d = dataChance(100);
    expect(d.tavern.events.map((e) => [e.id, e.weight])).toEqual([
      ["dropped_coin", 2],
      ["old_rumor", 1],
      ["spilled_wager", 2],
      ["drowned_bell_rumor", 1],
    ]);
    const seen = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      const s = town(300, 0, seed);
      const m = cloneRng(s.rng);
      const key = mirrorLook(m, d);
      chance(m, 100);
      const ev = d.tavern.events[weightedIndex(m, d.tavern.events.map((e) => e.weight))]!;
      seen.add(ev.id);
      const want: GameEvent[] = [
        ...lookEvents(key, s, d), // M19 D-2: 掲示板なら噂がイベントの text より前
        { kind: "message", key: ev.text },
      ];
      let gold = s.gold;
      if (ev.id === "dropped_coin" || ev.id === "spilled_wager") {
        const g = rollDice(m, ev.id === "dropped_coin" ? "2d6" : "3d6").total;
        gold += g;
        want.push({ kind: "message", key: "event.gold", params: { gold: g } }); // 街では SAN が満タンなので強欲の SAN は動かない
      } else {
        want.push({ kind: "message", key: `tavern.${ev.id}.more` });
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
      expect(r2.events).toEqual(lookEvents(key2, r.state, d));
      expect(r2.state.rng).toEqual(m2);
    }
    expect([...seen].sort()).toEqual(["dropped_coin", "drowned_bell_rumor", "old_rumor", "spilled_wager"]);
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

describe("掲示板の噂（TW-13。M19 D-2）", () => {
  const fill = (t: string, p: Record<string, string | number>): string => t.replace(/\{(\w+)\}/g, (_, k: string) => String(p[k]));

  /** 見回すの randInt が掲示板（rumor.look）を引く最初のシード */
  function boardSeed(d: GameData = data): number {
    for (let seed = 1; seed <= 200; seed++) if (mirrorLook(createRng(seed), d) === d.tavern.rumor.look) return seed;
    throw new Error("no board seed");
  }

  test("TW-13（M19 D-2）データ: 噂は掲示板（town.look.board）の後に town.look.rumor「{name}（{floors}F）: {description}」。掲示板の文は依頼書を約束しない", () => {
    expect(data.tavern.rumor).toEqual({ look: "town.look.board", text: "town.look.rumor" });
    expect(data.tavern.lookTexts).toContain("town.look.board");
    expect(data.strings["town.look.rumor"]).toBe("{name}（{floors}F）: {description}");
    expect(data.strings["town.look.board"]).toBe("壁の掲示板には、迷宮の噂が書き付けてある。");
  });

  test("TW-13（M19 D-2）掲示板を引くと、開放済みの迷宮ごとに unlockedDungeons の順で噂を 1 文ずつ語る（params は name / floors / description）。乱数は randInt 1 回のまま", () => {
    const seed = boardSeed();
    // 開始時（d01 だけ）
    const s1 = town(0, 0, seed);
    expect(s1.progress.unlockedDungeons).toEqual(["d01"]);
    const m1 = cloneRng(s1.rng);
    expect(mirrorLook(m1)).toBe("town.look.board");
    const r1 = look(s1);
    expect(r1.events).toEqual([
      { kind: "message", key: "town.look.board" },
      { kind: "message", key: "town.look.rumor", params: { name: "試しの坑道", floors: 2, description: "冒険者の腕試しに使われる浅い坑道。最下層に門番がいる。" } },
    ]);
    expect(r1.state.rng).toEqual(m1);
    // 3 つ開放（順は unlockedDungeons のまま）
    const s3 = town(0, 0, seed);
    s3.progress.unlockedDungeons = ["d01", "d03", "d02"];
    const m3 = cloneRng(s3.rng);
    mirrorLook(m3);
    const r3 = look(s3);
    expect(r3.events.map((e) => (e.kind === "message" ? [e.key, e.params?.name, e.params?.floors] : null))).toEqual([
      ["town.look.board", undefined, undefined],
      ["town.look.rumor", "試しの坑道", 2],
      ["town.look.rumor", "灰の地下墓所", 4],
      ["town.look.rumor", "沈んだ聖堂", 3],
    ]);
    expect(r3.state.rng).toEqual(m3);
    expect(r3.state.progress).toEqual(s3.progress);
  });

  test("TW-13（M19 D-2）掲示板以外の語りには噂が付かない。準備中（DG-35）の迷宮の噂は語らない", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const s = town(0, 0, seed);
      s.progress.unlockedDungeons = ["d01", "d02"];
      const key = mirrorLook(cloneRng(s.rng));
      const r = look(s);
      if (key !== "town.look.board") expect(r.events, `seed ${seed}`).toEqual([{ kind: "message", key }]);
      else expect(r.events.length, `seed ${seed}`).toBe(3);
    }
    const d = loadFreshData();
    d.dungeons.find((x) => x.id === "d02")!.placeholder = true;
    const s = town(0, 0, boardSeed(d));
    s.progress.unlockedDungeons = ["d01", "d02", "d03"];
    const r = look(s, d);
    expect(r.events.map((e) => (e.kind === "message" ? e.params?.name ?? e.key : null))).toEqual(["town.look.board", "試しの坑道", "灰の地下墓所"]);
  });

  test("TW-13/TW-14（M19 D-2）イベントが当たるときも乱数の順は randInt → chance → weightedIndex のまま、噂はイベントの text より前", () => {
    const d = dataChance(100);
    const s = town(300, 0, boardSeed(d));
    s.progress.unlockedDungeons = ["d01", "d02"];
    const m = cloneRng(s.rng);
    expect(mirrorLook(m, d)).toBe("town.look.board");
    chance(m, 100);
    const ev = d.tavern.events[weightedIndex(m, d.tavern.events.map((e) => e.weight))]!;
    const r = look(s, d);
    expect(r.events.slice(0, 4).map((e) => (e.kind === "message" ? e.key : e.kind))).toEqual(["town.look.board", "town.look.rumor", "town.look.rumor", ev.text]);
    expect(r.state.tavernEventMark).toBe(300);
  });

  test("TW-13（M19 D-2）最悪の値: 全迷宮の噂の文と掲示板の文は会話の箱の 28 字 × 2 行（禁則つき）に収まる", () => {
    const t = data.strings["town.look.rumor"]!;
    for (const g of data.dungeons) {
      const line = fill(t, { name: g.name, floors: g.floors, description: g.description });
      expect(kinsokuLines(line, 28).length, `${g.id}: ${line}`).toBeLessThanOrEqual(2);
    }
    expect(kinsokuLines(data.strings["town.look.board"]!, 28).length).toBeLessThanOrEqual(2);
  });
});
