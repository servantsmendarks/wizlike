import { describe, expect, test } from "vitest";
import type { GameData } from "../src/core/data/index";
import { createInitialState, execute } from "../src/core/engine";
import { cloneRng, createRng, nextUint32, randInt, rollDice, rollDie, weightedIndex, type RngState } from "../src/core/rng";
import {
  cellAt,
  edgeOf,
  FACINGS,
  generateDive,
  idx,
  inBounds,
  opposite,
  setEdge,
  step,
} from "../src/core/rules/dungeon-gen";
import { floorOf, mapView, visibleCells, visibleCellsOf } from "../src/core/rules/dungeon";
import { battleMenu } from "../src/core/rules/combat";
import { cloneState, dungeonOf, monsterOf } from "../src/core/state";
import type { Cell, Command, Edge, Facing, Floor, GameEvent, GameState, Pos } from "../src/core/types";
import { data, deepFreeze, expectKnownStringKeys, loadFreshData, newGame } from "./helpers/core";

// ---------------------------------------------------------------------------
// ヘルパー

const MOVE: Command = { type: "dungeon.move" };
const ENTER_D01: Command = { type: "dungeon.enter", dungeonId: "d01" };

function run(state: GameState, cmd: Command, d: GameData = data) {
  const r = execute(state, cmd, d);
  expectKnownStringKeys(r.events, d);
  return r;
}

/** newGame(seed) に dungeon.enter d01 を実行したもの */
function enterD01(seed: number): GameState {
  const r = execute(newGame(seed), ENTER_D01, data);
  if (r.events[0]?.kind === "rejected") throw new Error(JSON.stringify(r.events));
  return r.state;
}

/** cloneState して dive の位置・向き（と階）を書き換えたもの */
function placeAt(state: GameState, pos: Pos, facing: Facing, floor?: number): GameState {
  const s = cloneState(state);
  const dive = s.dive!;
  dive.pos = { x: pos.x, y: pos.y };
  dive.facing = facing;
  if (floor !== undefined) {
    dive.floor = floor;
    dive.deepestFloor = Math.max(dive.deepestFloor, floor); // その階にいるなら、そこまでは到達済み
  }
  return s;
}

/** encounterRate を書き換えた data（構造の生成には影響しない） */
function dataWithRate(room: number, corridor: number): GameData {
  const d = loadFreshData();
  for (const def of d.dungeons) def.encounterRate = { room, corridor };
  return d;
}
const DATA0 = dataWithRate(0, 0);

/** 遭遇の編成と先手判定の乱数を鏡の rng で進める（CB-03/04 の消費順。surpriseDiff 1000 の data で奇襲が起きない前提） */
function mirrorRandomEncounter(m: RngState, d: GameData, dungeonId: string, floor: number): void {
  const def = dungeonOf(d, dungeonId);
  const key = String(floor);
  const table = def.encounterTable[key]!;
  const n = weightedIndex(m, def.groupCountWeights[key]!) + 1;
  const specs: { monsterId: string; count: number }[] = [];
  for (let i = 0; i < n; i++) {
    const e = table[weightedIndex(m, table.map((x) => x.weight))]!;
    const count = Math.min(d.config.combat.maxPerGroup, Math.max(1, rollDice(m, monsterOf(d, e.monster).groupSize).total));
    specs.push({ monsterId: e.monster, count });
  }
  for (const sp of specs) for (let i = 0; i < sp.count; i++) rollDice(m, monsterOf(d, sp.monsterId).hp);
  rollDie(m, 10);
  rollDie(m, 10);
}

/** encounterRate を書き換え、奇襲が起きないようにした data（遭遇の execute が先手判定の 2 個で止まる） */
function dataEnc(room: number, corridor: number): GameData {
  const d = dataWithRate(room, corridor);
  d.config.combat.surpriseDiff = 1000;
  return d;
}

/** 戦闘中ならオートで終わるまで回す（auto が切れたら入れ直す）。出たイベントを events に足す */
function finishBattle(state: GameState, events: GameEvent[], d: GameData = data): GameState {
  let s = state;
  let k = 0;
  while (s.battle !== null) {
    if (k++ > 300) throw new Error("battle did not end");
    const cmd: Command = s.battle.auto ? { type: "battle.resolve" } : { type: "battle.auto", on: true };
    const r = execute(s, cmd, d);
    if (r.events[0]?.kind === "rejected") throw new Error(JSON.stringify(r.events[0]));
    events.push(...r.events);
    s = r.state;
  }
  return s;
}

type Approach = { pos: Pos; facing: Facing; target: Pos };

/** pred を満たすセルへ、edge が ok な辺を通って 1 歩で入れる立ち位置の一覧 */
function approaches(f: Floor, pred: (c: Cell, x: number, y: number) => boolean, ok: (e: Edge) => boolean = (e) => e === "open"): Approach[] {
  const out: Approach[] = [];
  for (let y = 0; y < f.height; y++) {
    for (let x = 0; x < f.width; x++) {
      const c = cellAt(f, x, y);
      if (!pred(c, x, y)) continue;
      for (const d of FACINGS) {
        const from = step({ x, y }, d);
        if (!inBounds(f, from.x, from.y) || !ok(edgeOf(c, d))) continue;
        out.push({ pos: from, facing: opposite(d), target: { x, y } });
      }
    }
  }
  return out;
}

/** シード 1 から順に enterD01 し、floorNo 階で pred を満たす立ち位置が最初に見つかったもの */
function findSituation(
  pred: (c: Cell, x: number, y: number) => boolean,
  opts: { floor?: number; ok?: (e: Edge) => boolean; base?: (seed: number) => GameState } = {},
): { state: GameState; a: Approach; f: Floor; seed: number } {
  const floorNo = opts.floor ?? 1;
  for (let seed = 1; seed <= 300; seed++) {
    const s0 = (opts.base ?? enterD01)(seed);
    const f = floorOf(s0.dive!, data, floorNo);
    const list = approaches(f, pred, opts.ok);
    const a = list[0];
    if (a !== undefined) return { state: placeAt(s0, a.pos, a.facing, floorNo), a, f, seed };
  }
  throw new Error("findSituation: not found");
}

function eventsOfKind<K extends GameEvent["kind"]>(events: readonly GameEvent[], kind: K): Extract<GameEvent, { kind: K }>[] {
  return events.filter((e): e is Extract<GameEvent, { kind: K }> => e.kind === kind);
}

function kinds(events: readonly GameEvent[]): string[] {
  return events.map((e) => (e.kind === "message" ? `message:${e.key}` : e.kind));
}

/** state.dive の現在の視野がすべて explored に入っていて、昇順・重複なしであること */
function expectExploredCovers(s: GameState, d: GameData = data): void {
  const dive = s.dive!;
  const list = dive.explored[String(dive.floor)] ?? [];
  for (let i = 1; i < list.length; i++) expect(list[i]!).toBeGreaterThan(list[i - 1]!);
  const f = floorOf(dive, d);
  for (const v of visibleCells(s, d)) expect(list).toContain(idx(f, v.x, v.y));
}

/** 生存者のうち trap の SAN 減少（CH-54。リーダー 3、慎重 floor(3*0.5)=1、ほか 3） */
function trapLoss(s: GameState, id: string): number {
  const ch = s.party.find((c) => c.id === id)!;
  return ch.personality === "cautious" ? 1 : data.config.san.trap;
}

// 手組みの Floor（全セル corridor、全辺 wall）
function makeFloor(w: number, h: number): Floor {
  const cells: Cell[] = [];
  for (let i = 0; i < w * h; i++) cells.push({ kind: "corridor", n: "wall", e: "wall", s: "wall", w: "wall", roomId: null, eventId: null, trapId: null });
  return { floor: 1, width: w, height: h, cells, rooms: [], stairsUp: { x: 0, y: 0 }, stairsDown: null, boss: null };
}

// ---------------------------------------------------------------------------

describe("dungeon.enter", () => {
  test("DG-03/DG-40/TW-11 dungeon.enter: screen dungeon、dive の全欄、events は [screen dungeon, message dungeon.enter {dungeon:'試しの坑道'}]", () => {
    const s0 = newGame(1);
    const r = run(s0, ENTER_D01);
    const dive = r.state.dive!;
    const f1 = generateDive(data.dungeons[0]!, data.config.dungeon, dive.diveSeed)[0]!;
    // facing は N→E→S→W で最初の通れる辺
    const up = cellAt(f1, f1.stairsUp.x, f1.stairsUp.y);
    const facing = FACINGS.find((d) => edgeOf(up, d) !== "wall")!;
    expect(r.state.screen).toBe("dungeon");
    expect(r.state.pendingChoice).toBeNull();
    expect(dive).toEqual({
      dungeonId: "d01",
      diveSeed: dive.diveSeed,
      floor: 1,
      deepestFloor: 1,
      pos: f1.stairsUp,
      facing,
      explored: dive.explored,
      clearedCells: [],
      bossDefeated: false,
      ledger: { items: [], gold: 0 },
    });
    expect(Object.keys(dive.explored)).toEqual(["1"]);
    expectExploredCovers(r.state);
    expect(r.events).toEqual([
      { kind: "screen", to: "dungeon" },
      { kind: "message", key: "dungeon.enter", params: { dungeon: "試しの坑道" } },
    ]);
  });

  test("DG-03 dungeon.enter は state.rng を nextUint32 ちょうど 1 回だけ進め、diveSeed はその値", () => {
    for (const seed of [1, 2, 3, 99]) {
      const s0 = newGame(seed);
      const mirror = cloneRng(s0.rng);
      const expected = nextUint32(mirror);
      const r = run(s0, ENTER_D01);
      expect(r.state.dive!.diveSeed).toBe(expected);
      expect(r.state.rng).toEqual(mirror);
    }
  });

  test("DG-01/D2 dungeon.enter の rejected: 街以外、潜行中、未開放の d02、未知の id、dungeonId が文字列でない。いずれも同じ参照で、rng は変わらない", () => {
    const town = newGame(1);
    const title = createInitialState(1, data);
    const diving = enterD01(1);
    const cases: [GameState, unknown, string][] = [
      [title, "d01", "wrong screen"],
      [diving, "d01", "wrong screen"],
      [{ ...cloneState(diving), screen: "town" }, "d01", "already diving"],
      [town, "d02", "not unlocked"],
      [town, "d99", "unknown dungeon"],
      [town, 1, "unknown dungeon"],
      [town, undefined, "unknown dungeon"],
    ];
    for (const [s, id, reason] of cases) {
      const rng = cloneRng(s.rng);
      const r = execute(s, { type: "dungeon.enter", dungeonId: id } as Command, data);
      expect(r.state).toBe(s);
      expect(r.events).toEqual([{ kind: "rejected", command: "dungeon.enter", reason }]);
      expect(s.rng).toEqual(rng);
    }
    // d02 を開放すれば入れる
    const s2 = cloneState(town);
    s2.progress.unlockedDungeons.push("d02");
    const r2 = run(s2, { type: "dungeon.enter", dungeonId: "d02" });
    expect(r2.state.dive!.dungeonId).toBe("d02");
    expect(r2.events[1]).toEqual({ kind: "message", key: "dungeon.enter", params: { dungeon: "沈んだ聖堂" } });
  });
});

describe("移動と旋回", () => {
  test("DG-10 前進: 前が open なら moved{pos,facing}。wall なら [blocked, message dungeon.blocked] で、pos・rng・explored は変わらない", () => {
    const { state, a } = findSituation((c) => c.kind === "corridor" && c.roomId === null);
    const r = run(state, MOVE, DATA0);
    expect(r.events[0]).toEqual({ kind: "moved", pos: a.target, facing: a.facing });
    expect(r.state.dive!.pos).toEqual(a.target);
    expect(r.events).toHaveLength(1);
    expectExploredCovers(r.state);

    // 壁に向かって前進
    const s = enterD01(1);
    const f = floorOf(s.dive!, data);
    let wallState: GameState | null = null;
    outer: for (let y = 0; y < f.height; y++) {
      for (let x = 0; x < f.width; x++) {
        for (const d of FACINGS) {
          if (edgeOf(cellAt(f, x, y), d) === "wall") {
            wallState = placeAt(s, { x, y }, d);
            break outer;
          }
        }
      }
    }
    const w = wallState!;
    const rw = run(w, MOVE);
    expect(rw.events).toEqual([{ kind: "blocked" }, { kind: "message", key: "dungeon.blocked" }]);
    expect(rw.state.dive!.pos).toEqual(w.dive!.pos);
    expect(rw.state.rng).toEqual(w.rng);
    expect(rw.state.dive!.explored).toEqual(w.dive!.explored);
  });

  test("DG-10 扉: [message dungeon.door, moved, …] の順。扉は通り抜けても door のまま（両側から）で、戻って通っても同じ向きで通っても毎回 message dungeon.door。dive に扉の記録は無い", () => {
    const seen = new Set<Facing>();
    for (let seed = 1; seed <= 40 && seen.size < 4; seed++) {
      const s0 = enterD01(seed);
      const f = floorOf(s0.dive!, data);
      for (const a of approaches(f, (c) => c.kind === "corridor" || c.kind === "room", (e) => e === "door")) {
        if (seen.has(a.facing)) continue;
        seen.add(a.facing);
        const s = placeAt(s0, a.pos, a.facing);
        const r = run(s, MOVE, DATA0);
        expect(kinds(r.events).slice(0, 2)).toEqual(["message:dungeon.door", "moved"]);
        expect(r.state.dive!.pos).toEqual(a.target);
        expect(Object.keys(r.state.dive!).sort()).toEqual(Object.keys(s.dive!).sort());
        expect("openedDoors" in r.state.dive!).toBe(false);
        const f2 = floorOf(r.state.dive!, data);
        expect(edgeOf(cellAt(f2, a.pos.x, a.pos.y), a.facing)).toBe("door");
        expect(edgeOf(cellAt(f2, a.target.x, a.target.y), opposite(a.facing))).toBe("door");
        // 元の位置から見ても、その辺は door のまま見え、奥を遮る（DG-12）
        const back = placeAt(r.state, a.pos, a.facing);
        const vis = visibleCells(back, data);
        expect(vis.find((v) => v.depth === 0 && v.lane === 0)!.front).toBe("door");
        expect(vis.some((v) => v.depth === 1 && v.lane === 0)).toBe(false);
        // 反対側から戻って通っても、毎回 message dungeon.door
        const rev = placeAt(r.state, a.target, opposite(a.facing));
        const r2 = run(rev, MOVE, DATA0);
        expect(kinds(r2.events).slice(0, 2)).toEqual(["message:dungeon.door", "moved"]);
        expect(r2.state.dive!.pos).toEqual(a.pos);
        // 同じ向きで再び通っても同じ
        const r3 = run(back, MOVE, DATA0);
        expect(kinds(r3.events).slice(0, 2)).toEqual(["message:dungeon.door", "moved"]);
      }
    }
    expect([...seen].sort()).toEqual(["E", "N", "S", "W"]);
  });

  test("DG-10 旋回: left/right/around の 12 通りの表、turned イベント、rng は消費しない。不正な dir は rejected bad dir", () => {
    const table: Record<Facing, Record<"left" | "right" | "around", Facing>> = {
      N: { left: "W", right: "E", around: "S" },
      E: { left: "N", right: "S", around: "W" },
      S: { left: "E", right: "W", around: "N" },
      W: { left: "S", right: "N", around: "E" },
    };
    const s0 = enterD01(1);
    for (const from of FACINGS) {
      for (const dir of ["left", "right", "around"] as const) {
        const s = placeAt(s0, s0.dive!.pos, from);
        const r = run(s, { type: "dungeon.turn", dir });
        expect(r.events).toEqual([{ kind: "turned", facing: table[from][dir] }]);
        expect(r.state.dive!.facing).toBe(table[from][dir]);
        expect(r.state.dive!.pos).toEqual(s.dive!.pos);
        expect(r.state.rng).toEqual(s.rng);
      }
    }
    for (const dir of ["up", undefined, 1]) {
      const r = execute(s0, { type: "dungeon.turn", dir } as unknown as Command, data);
      expect(r.state).toBe(s0);
      expect(r.events).toEqual([{ kind: "rejected", command: "dungeon.turn", reason: "bad dir" }]);
    }
  });

  test("DG-10 dungeon.move / turn は screen が dungeon でないか dive が null なら rejected not in dungeon", () => {
    const town = newGame(1);
    const noDive: GameState = { ...cloneState(town), screen: "dungeon" };
    const otherScreen: GameState = { ...cloneState(enterD01(1)), screen: "town" };
    for (const s of [town, noDive, otherScreen, createInitialState(1, data)]) {
      for (const cmd of [MOVE, { type: "dungeon.turn", dir: "left" } as Command]) {
        const r = execute(s, cmd, data);
        expect(r.state).toBe(s);
        expect(r.events).toEqual([{ kind: "rejected", command: cmd.type, reason: "not in dungeon" }]);
      }
    }
  });
});

describe("遭遇（CB-01, DG-11）", () => {
  test("DG-11/CB-01 遭遇: rate 1 では毎歩 [moved, screen battle, encounter, message battle.encounter, …] で state.battle が立つ。0 では [moved] だけ。遭遇しない歩の rng は d100 の 1 回、遭遇した歩は編成の乱数が続く（鏡の rng）。旋回と blocked では 0 回", () => {
    const d1 = dataEnc(1, 1);
    for (let seed = 1; seed <= 10; seed++) {
      const s0 = enterD01(seed);
      const f = floorOf(s0.dive!, data);
      const list = approaches(f, (c) => c.kind === "corridor" || c.kind === "room").slice(0, 10);
      for (const a of list) {
        const s = placeAt(s0, a.pos, a.facing);
        const mirror = cloneRng(s.rng);
        randInt(mirror, 1, 100);
        const r0 = run(s, MOVE, DATA0);
        expect(kinds(r0.events)).toEqual(["moved"]);
        expect(r0.state.rng).toEqual(mirror);
        expect(r0.state.battle).toBeNull();
        const r1 = run(s, MOVE, d1);
        expect(kinds(r1.events).slice(0, 4)).toEqual(["moved", "screen", "encounter", "message:battle.encounter"]);
        expect(r1.events[1]).toEqual({ kind: "screen", to: "battle" });
        expect(r1.state.screen).toBe("battle");
        expect(r1.state.battle!.origin).toEqual({ kind: "random", inRoom: cellAt(f, a.target.x, a.target.y).roomId !== null });
        mirrorRandomEncounter(mirror, d1, "d01", 1);
        expect(r1.state.rng).toEqual(mirror);
        // 戦闘中は dungeon.move を受け付けない
        expect(execute(r1.state, MOVE, d1).events).toEqual([{ kind: "rejected", command: "dungeon.move", reason: "not in dungeon" }]);
      }
      // 旋回は乱数を使わない
      const rt = run(s0, { type: "dungeon.turn", dir: "around" }, d1);
      expect(rt.state.rng).toEqual(s0.rng);
    }
  });

  test("DG-11/CB-01 判定は d100 ≤ round(rate×100)（d01 corridor 0.05 → 5）。鏡の rng と一致する", () => {
    let hits = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const s0 = enterD01(seed);
      const f = floorOf(s0.dive!, data);
      const a = approaches(f, (c) => c.kind === "corridor" && c.roomId === null)[0]!;
      const s = placeAt(s0, a.pos, a.facing);
      const roll = randInt(cloneRng(s.rng), 1, 100);
      const r = run(s, MOVE);
      const enc = r.events.some((e) => e.kind === "message" && e.key === "battle.encounter");
      expect(enc).toBe(roll <= 5);
      expect(r.state.battle !== null).toBe(enc);
      if (enc) hits += 1;
    }
    expect(hits).toBeLessThan(30);
  });

  test("CB-01 部屋の中（roomId あり。部屋の中の罠・イベントも含む）は encounterRate.room、通路は corridor（room=1, corridor=0 で、部屋のセルでだけ出る）", () => {
    const dRoom = dataEnc(1, 0);
    const dCorr = dataEnc(0, 1);
    let roomSteps = 0;
    let corrSteps = 0;
    for (let seed = 1; seed <= 4; seed++) {
      const s0 = enterD01(seed);
      const f = floorOf(s0.dive!, data);
      for (const a of approaches(f, (c) => c.kind === "corridor" || c.kind === "room" || c.kind === "event", (e) => e !== "wall")) {
        const s = placeAt(s0, a.pos, a.facing);
        const inRoom = cellAt(f, a.target.x, a.target.y).roomId !== null;
        const enc = (d: GameData) => run(s, MOVE, d).state.battle !== null;
        expect(enc(dRoom)).toBe(inRoom);
        expect(enc(dCorr)).toBe(!inRoom);
        if (inRoom) roomSteps += 1;
        else corrSteps += 1;
      }
    }
    expect(roomSteps).toBeGreaterThan(0);
    expect(corrSteps).toBeGreaterThan(0);
    // 部屋の中の罠でも room の率（罠の処理の後に遭遇判定）。宝箱の判定用に inRoom が立つ
    const { state } = findSituation((c) => c.kind === "trap" && c.roomId !== null && c.trapId === "spinner");
    const r = run(state, MOVE, dRoom);
    const ks = kinds(r.events);
    expect(ks.indexOf("message:dungeon.trap.spinner")).toBeGreaterThan(-1);
    expect(ks.indexOf("message:dungeon.trap.spinner")).toBeLessThan(ks.indexOf("message:battle.encounter"));
    expect(r.state.battle!.origin).toEqual({ kind: "random", inRoom: true });
  });

  test("DG-11 行動可能な者がいなければ遭遇判定をしない（麻痺・睡眠・SAN 0 の混在で、rate 1 でも乱数を消費しない）", () => {
    const s0 = enterD01(1);
    const f = floorOf(s0.dive!, data);
    const a = approaches(f, (c) => c.kind === "corridor" || c.kind === "room")[0]!;
    const s = placeAt(s0, a.pos, a.facing);
    s.party.forEach((c, i) => {
      if (i % 3 === 0) c.status = ["paralysis"];
      else if (i % 3 === 1) c.status = ["sleep"];
      else c.san = 0;
    });
    const r = run(s, MOVE, dataEnc(1, 1));
    expect(r.events).toEqual([{ kind: "moved", pos: a.target, facing: a.facing }]);
    expect(r.state.rng).toEqual(s.rng);
    expect(r.state.battle).toBeNull();
    // 1 人でも行動できれば判定する
    s.party[2]!.san = 50;
    expect(run(s, MOVE, dataEnc(1, 1)).state.battle).not.toBeNull();
  });
});

describe("毒の 1 歩（CH-43）", () => {
  test("CH-43 毒の者は前進の 1 歩ごとに HP −1（moved の直後・罠の前、hpChanged だけ）。HP 1 で止まり hpChanged を出さない。旋回では減らない", () => {
    const sit = findSituation((c) => c.kind === "trap" && c.trapId === "pit");
    const s = cloneState(sit.state);
    s.party[0]!.status = ["poison"];
    s.party[0]!.hp = 5;
    s.party[1]!.status = ["poison"];
    s.party[1]!.hp = 1;
    s.party[2]!.status = ["poison"];
    s.party[2]!.life = "dead";
    s.party[2]!.hp = 0;
    const r = run(s, MOVE, DATA0);
    expect(r.events.slice(0, 3)).toEqual([
      { kind: "moved", pos: sit.a.target, facing: sit.a.facing },
      { kind: "hpChanged", id: "c1", delta: -1, hp: 4 },
      { kind: "message", key: "dungeon.trap.pit" },
    ]);
    expect(r.events.slice(0, 3).filter((e) => e.kind === "hpChanged" && e.id === "c2")).toEqual([]);
    const t = run(s, { type: "dungeon.turn", dir: "left" }, DATA0);
    expect(t.state.party[0]!.hp).toBe(5);
    // 通常の通路でも [moved, hpChanged]。HP 1 の者は減らない
    const s2 = enterD01(1);
    const f = floorOf(s2.dive!, data);
    const a = approaches(f, (c) => c.kind === "corridor")[0]!;
    const p = placeAt(s2, a.pos, a.facing);
    p.party[3]!.status = ["poison"];
    p.party[1]!.status = ["poison"];
    p.party[1]!.hp = 1;
    expect(run(p, MOVE, DATA0).events).toEqual([
      { kind: "moved", pos: a.target, facing: a.facing },
      { kind: "hpChanged", id: "c4", delta: -1, hp: 7 },
    ]);
  });
});

describe("視野（DG-12）", () => {
  test("DG-12 visibleCellsOf（手組みの Floor）: 正面が壁なら depth0 だけ。まっすぐな通路なら depth0..3。扉は front=door で奥を遮る", () => {
    const f = makeFloor(5, 6);
    expect(visibleCellsOf(f, { x: 2, y: 5 }, "N", 3)).toEqual([{ depth: 0, lane: 0, x: 2, y: 5, front: "wall", left: "wall", right: "wall", stairs: null }]);
    // (2,5)→(2,1) をまっすぐ北へ開ける
    for (let y = 5; y >= 1; y--) setEdge(f, 2, y, "N", "open");
    expect(visibleCellsOf(f, { x: 2, y: 5 }, "N", 3)).toEqual([
      { depth: 0, lane: 0, x: 2, y: 5, front: "open", left: "wall", right: "wall", stairs: null },
      { depth: 1, lane: 0, x: 2, y: 4, front: "open", left: "wall", right: "wall", stairs: null },
      { depth: 2, lane: 0, x: 2, y: 3, front: "open", left: "wall", right: "wall", stairs: null },
      { depth: 3, lane: 0, x: 2, y: 2, front: "open", left: "wall", right: "wall", stairs: null },
    ]);
    // 南を向けば自分のセルだけ（後ろの辺は wall）。front は s、left は e、right は w
    expect(visibleCellsOf(f, { x: 2, y: 5 }, "S", 3)).toEqual([{ depth: 0, lane: 0, x: 2, y: 5, front: "wall", left: "wall", right: "wall", stairs: null }]);
    // (2,4) の北を扉にすると depth1 で止まる
    setEdge(f, 2, 4, "N", "door");
    expect(visibleCellsOf(f, { x: 2, y: 5 }, "N", 3)).toEqual([
      { depth: 0, lane: 0, x: 2, y: 5, front: "open", left: "wall", right: "wall", stairs: null },
      { depth: 1, lane: 0, x: 2, y: 4, front: "door", left: "wall", right: "wall", stairs: null },
    ]);
  });

  test("DG-12 側の辺が open なら左右の列が見え、wall なら返らない。facing が E/S/W で相対の辺が回る。並びは depth の昇順、lane は -1,0,1", () => {
    const f = makeFloor(5, 5);
    // 北向きに (2,4)→(2,3)→(2,2)。(2,3) の西と東を開け、(1,3) の北を開ける、(3,3) の北は扉
    setEdge(f, 2, 4, "N", "open");
    setEdge(f, 2, 3, "N", "open");
    setEdge(f, 2, 3, "W", "open");
    setEdge(f, 2, 3, "E", "open");
    setEdge(f, 1, 3, "N", "open");
    setEdge(f, 3, 3, "N", "door");
    setEdge(f, 2, 2, "E", "wall");
    expect(visibleCellsOf(f, { x: 2, y: 4 }, "N", 3)).toEqual([
      { depth: 0, lane: 0, x: 2, y: 4, front: "open", left: "wall", right: "wall", stairs: null },
      { depth: 1, lane: -1, x: 1, y: 3, front: "open", left: "wall", right: "open", stairs: null },
      { depth: 1, lane: 0, x: 2, y: 3, front: "open", left: "open", right: "open", stairs: null },
      { depth: 1, lane: 1, x: 3, y: 3, front: "door", left: "open", right: "wall", stairs: null },
      { depth: 2, lane: 0, x: 2, y: 2, front: "wall", left: "wall", right: "wall", stairs: null },
    ]);
    // 同じ場所を東から（(1,3) から東向き）: front は e、left は n、right は s
    expect(visibleCellsOf(f, { x: 1, y: 3 }, "E", 3)).toEqual([
      // (1,3) の北（向きに対する左）が open なので、depth 0 の左の列 (1,2) も見える
      { depth: 0, lane: -1, x: 1, y: 2, front: "wall", left: "wall", right: "open", stairs: null },
      { depth: 0, lane: 0, x: 1, y: 3, front: "open", left: "open", right: "wall", stairs: null },
      { depth: 1, lane: -1, x: 2, y: 2, front: "wall", left: "wall", right: "open", stairs: null },
      { depth: 1, lane: 0, x: 2, y: 3, front: "open", left: "open", right: "open", stairs: null },
      { depth: 1, lane: 1, x: 2, y: 4, front: "wall", left: "open", right: "wall", stairs: null },
      { depth: 2, lane: 0, x: 3, y: 3, front: "wall", left: "door", right: "wall", stairs: null },
    ]);
    // 西向き（(3,3) から）: front は w、left は s、right は n
    expect(visibleCellsOf(f, { x: 3, y: 3 }, "W", 1)).toEqual([
      { depth: 0, lane: 0, x: 3, y: 3, front: "open", left: "wall", right: "door", stairs: null },
      { depth: 1, lane: -1, x: 2, y: 4, front: "wall", left: "wall", right: "open", stairs: null },
      { depth: 1, lane: 0, x: 2, y: 3, front: "open", left: "open", right: "open", stairs: null },
      { depth: 1, lane: 1, x: 2, y: 2, front: "wall", left: "open", right: "wall", stairs: null },
    ]);
    // 南向き（(2,2) から）: front は s、left は e、right は w。depth 0 の左右は wall なので返らない
    expect(visibleCellsOf(f, { x: 2, y: 2 }, "S", 3).map((v) => [v.depth, v.lane, v.x, v.y])).toEqual([
      [0, 0, 2, 2],
      [1, -1, 3, 3],
      [1, 0, 2, 3],
      [1, 1, 1, 3],
      [2, 0, 2, 4],
    ]);
  });

  test("DG-12/UI-20 visibleCellsOf の stairs（手組みの Floor）: 左中右のどのレーンでも、stairsUp は up、stairsDown は down。罠・イベント・ボス・部屋・通路は null", () => {
    // 3 列 × 4 行を全部 open にした広間を北向きに見る（自分は (2,4)、左の列 x=1、右の列 x=3）
    const f = makeFloor(5, 6);
    for (let y = 1; y <= 4; y++) {
      for (let x = 1; x <= 3; x++) {
        if (x < 3) setEdge(f, x, y, "E", "open");
        if (y > 1) setEdge(f, x, y, "N", "open");
      }
    }
    const kindAt: Record<string, Cell["kind"]> = { "1,3": "stairsUp", "3,2": "stairsDown", "2,1": "stairsUp", "1,1": "trap", "3,1": "boss", "2,3": "event", "3,4": "room" };
    for (const [k, kind] of Object.entries(kindAt)) {
      const [x, y] = k.split(",").map(Number) as [number, number];
      cellAt(f, x, y).kind = kind;
    }
    const got = visibleCellsOf(f, { x: 2, y: 4 }, "N", 3).map((v) => [v.depth, v.lane, v.stairs]);
    expect(got).toEqual([
      [0, -1, null],
      [0, 0, null],
      [0, 1, null], // room
      [1, -1, "up"],
      [1, 0, null], // event
      [1, 1, null],
      [2, -1, null],
      [2, 0, null],
      [2, 1, "down"],
      [3, -1, null], // trap
      [3, 0, "up"],
      [3, 1, null], // boss
    ]);
  });

  test("DG-12/UI-20 visibleCells の stairs は実データの全視点で、セルの kind が stairsUp なら up、stairsDown なら down、それ以外は null（1 階・2 階とも）", () => {
    const s0 = enterD01(1);
    let ups = 0;
    let downs = 0;
    for (const floorNo of [1, 2]) {
      const f = floorOf(s0.dive!, data, floorNo);
      for (let y = 0; y < f.height; y++) {
        for (let x = 0; x < f.width; x++) {
          for (const d of FACINGS) {
            for (const v of visibleCells(s0, data, { floor: floorNo, pos: { x, y }, facing: d })) {
              const kind = cellAt(f, v.x, v.y).kind;
              const want = kind === "stairsUp" ? "up" : kind === "stairsDown" ? "down" : null;
              expect(v.stairs).toBe(want);
              if (v.stairs === "up" && v.lane !== 0) ups += 1;
              if (v.stairs === "down" && v.lane !== 0) downs += 1;
            }
          }
        }
      }
    }
    // 左右のレーンからも見えていること
    expect(ups).toBeGreaterThan(0);
    expect(downs).toBeGreaterThan(0);
  });

  test("DG-10/DG-12 通り抜けた扉も視線を遮る（往復した後も、扉の手前からは扉の奥が見えない）", () => {
    const { state, a } = findSituation((c) => c.kind === "corridor" || c.kind === "room", { ok: (e) => e === "door" });
    const before = visibleCells(state, data);
    expect(before.find((v) => v.depth === 0 && v.lane === 0)!.front).toBe("door");
    expect(before.some((v) => v.x === a.target.x && v.y === a.target.y)).toBe(false);
    const through = run(state, MOVE, DATA0).state;
    const back = run(placeAt(through, a.target, opposite(a.facing)), MOVE, DATA0).state;
    const again = placeAt(back, a.pos, a.facing);
    expect(visibleCells(again, data)).toEqual(before);
  });

  test("DG-12 viewDepth は config.dungeon.viewDepth を使う（2 にすると depth3 が返らない）。visibleCells の at を渡すと、その視点で返る。dive が null なら []", () => {
    const d2 = loadFreshData();
    d2.config.dungeon.viewDepth = 2;
    let sawDepth3 = false;
    for (let seed = 1; seed <= 2; seed++) {
      const s0 = enterD01(seed);
      const f = floorOf(s0.dive!, data);
      for (let y = 0; y < f.height; y++) {
        for (let x = 0; x < f.width; x++) {
          for (const d of FACINGS) {
            const s = placeAt(s0, { x, y }, d);
            const v3 = visibleCells(s, data);
            const v2 = visibleCells(s, d2);
            if (v3.some((v) => v.depth === 3)) sawDepth3 = true;
            expect(v2).toEqual(v3.filter((v) => v.depth <= 2));
            // at を渡すと、その視点で返る（dive の現在値は別の場所）
            expect(visibleCells(s0, data, { floor: 1, pos: { x, y }, facing: d })).toEqual(v3);
            expect(v3).toEqual(visibleCellsOf(f, { x, y }, d, 3));
          }
        }
      }
    }
    expect(sawDepth3).toBe(true);
    expect(visibleCells(newGame(1), data)).toEqual([]);
    // 別の階の視点
    const s = enterD01(1);
    const f2 = floorOf(s.dive!, data, 2);
    expect(visibleCells(s, data, { floor: 2, pos: f2.stairsUp, facing: "N" })).toEqual(visibleCellsOf(f2, f2.stairsUp, "N", 3));
  });
});

describe("オートマップ（DG-13）", () => {
  test("DG-13 explored: enter・move・turn で、visibleCells の座標の添字が足される。昇順・重複なし・階ごとのキー。blocked では変わらない", () => {
    let s = enterD01(3);
    expectExploredCovers(s);
    const walker = createRng(77);
    for (let i = 0; i < 200; i++) {
      const before = cloneState(s);
      const k = randInt(walker, 0, 3);
      const cmd: Command = k <= 1 ? MOVE : { type: "dungeon.turn", dir: k === 2 ? "left" : "right" };
      if (s.pendingChoice !== null) {
        s = run(s, { type: "event.choose", optionId: "stay" }).state;
        continue;
      }
      const r = run(s, cmd, DATA0);
      s = r.state;
      if (r.events[0]?.kind === "blocked") {
        expect(s.dive!.explored).toEqual(before.dive!.explored);
        continue;
      }
      expectExploredCovers(s);
      // 以前の記録は消えない
      for (const [key, list] of Object.entries(before.dive!.explored)) {
        for (const i2 of list) expect(s.dive!.explored[key]).toContain(i2);
      }
    }
    expect(Object.keys(s.dive!.explored)).toEqual(["1"]);
  });

  test("DG-13/UI-24 mapView: 探索済みセルだけ、辺は生成のまま（通った扉も door）、trap/event/boss/room は plain、stairsUp/stairsDown は記号。dive が null なら null", () => {
    expect(mapView(newGame(1), data)).toBeNull();
    const s0 = enterD01(1);
    const mv0 = mapView(s0, data)!;
    expect(mv0.cells.map((c) => c.y * 20 + c.x)).toEqual(s0.dive!.explored["1"]);
    expect(mv0).toMatchObject({ dungeonId: "d01", floor: 1, width: 20, height: 20, pos: s0.dive!.pos, facing: s0.dive!.facing });
    expect(mv0.cells.find((c) => c.x === s0.dive!.pos.x && c.y === s0.dive!.pos.y)!.kind).toBe("stairsUp");
    for (const floorNo of [1, 2]) {
      // 全セルを探索済みにして、記号と辺を確かめる
      const s = cloneState(s0);
      s.dive!.floor = floorNo;
      s.dive!.explored[String(floorNo)] = Array.from({ length: 400 }, (_, i) => i);
      const f = floorOf(s.dive!, data);
      const mv = mapView(s, data)!;
      expect(mv.floor).toBe(floorNo);
      expect(mv.cells).toHaveLength(400);
      const seenKinds = new Set<string>();
      for (const c of mv.cells) {
        const cell = cellAt(f, c.x, c.y);
        seenKinds.add(cell.kind);
        const expected = cell.kind === "stairsUp" || cell.kind === "stairsDown" ? cell.kind : "plain";
        expect(c.kind).toBe(expected);
        expect([c.n, c.e, c.s, c.w]).toEqual([cell.n, cell.e, cell.s, cell.w]);
      }
      expect(seenKinds.has("trap")).toBe(true);
      expect(seenKinds.has(floorNo === 1 ? "stairsDown" : "boss")).toBe(true);
    }
    // 通り抜けた扉も door のまま描く（UI-24）
    const { state, a } = findSituation((c) => c.kind === "corridor" || c.kind === "room", { ok: (e) => e === "door" });
    const r = run(state, MOVE, DATA0);
    const mv = mapView(r.state, data)!;
    const here = mv.cells.find((c) => c.x === a.target.x && c.y === a.target.y)!;
    const back = opposite(a.facing);
    const edge = back === "N" ? here.n : back === "E" ? here.e : back === "S" ? here.s : here.w;
    expect(edge).toBe("door");
  });
});

describe("階段（DG-14, E3）", () => {
  function atStairsDown() {
    return findSituation((c) => c.kind === "stairsDown");
  }

  test("DG-14/E3 下り階段に入ると pendingChoice {kind:stairs, promptKey:dungeon.stairsDown, options:[descend, stay]} と message dungeon.stairsDown。遭遇判定はしない", () => {
    const { state, a } = atStairsDown();
    const r = run(state, MOVE, dataWithRate(1, 1));
    expect(r.events).toEqual([
      { kind: "moved", pos: a.target, facing: a.facing },
      { kind: "message", key: "dungeon.stairsDown" },
    ]);
    expect(r.state.pendingChoice).toEqual({
      kind: "stairs",
      promptKey: "dungeon.stairsDown",
      options: [
        { id: "descend", labelKey: "dungeon.choice.descend" },
        { id: "stay", labelKey: "dungeon.choice.stay" },
      ],
    });
    expect(r.state.rng).toEqual(state.rng);
  });

  test("DG-14/E3 保留中は dungeon.move / turn / enter が rejected choice pending。存在しない optionId は unknown option、保留が無いときの event.choose は no pending choice", () => {
    const { state } = atStairsDown();
    const s = run(state, MOVE).state;
    for (const cmd of [MOVE, { type: "dungeon.turn", dir: "left" }, ENTER_D01, { type: "town.inn", rank: 0 }] as Command[]) {
      const r = execute(s, cmd, data);
      expect(r.state).toBe(s);
      expect(r.events).toEqual([{ kind: "rejected", command: cmd.type, reason: "choice pending" }]);
    }
    for (const optionId of ["ascend", "x", 1, undefined]) {
      const r = execute(s, { type: "event.choose", optionId } as Command, data);
      expect(r.state).toBe(s);
      expect(r.events).toEqual([{ kind: "rejected", command: "event.choose", reason: "unknown option" }]);
    }
    const r2 = execute(state, { type: "event.choose", optionId: "stay" }, data);
    expect(r2.state).toBe(state);
    expect(r2.events).toEqual([{ kind: "rejected", command: "event.choose", reason: "no pending choice" }]);
  });

  test("DG-14/CH-51/CH-54 descend: floor 2、pos・facing は変わらず、pos は 2 階の stairsUp と一致。events は [floorChanged, message dungeon.descend, sanChanged×生存者]。慎重も −5（耐性なし）、dead のメンバーは減らない", () => {
    const { state } = atStairsDown();
    const s1 = cloneState(run(state, MOVE).state);
    s1.party[2]!.life = "dead";
    s1.party[2]!.hp = 0;
    const r = run(s1, { type: "event.choose", optionId: "descend" }, dataWithRate(1, 1));
    const dive = r.state.dive!;
    const floors = generateDive(data.dungeons[0]!, data.config.dungeon, dive.diveSeed);
    expect(dive.floor).toBe(2);
    expect(dive.deepestFloor).toBe(2);
    expect(dive.pos).toEqual(s1.dive!.pos);
    expect(dive.facing).toBe(s1.dive!.facing);
    expect(dive.pos).toEqual(floors[1]!.stairsUp);
    expect(r.state.pendingChoice).toBeNull();
    const n = data.config.san.floorDescend;
    expect(r.events).toEqual([
      { kind: "floorChanged", floor: 2, pos: dive.pos, facing: dive.facing },
      { kind: "message", key: "dungeon.descend" },
      ...s1.party.filter((c) => c.life === "alive").map((c) => ({ kind: "sanChanged", id: c.id, delta: -n, san: c.san - n })),
    ]);
    expect(r.state.party[2]!.san).toBe(s1.party[2]!.san);
    expect(r.state.rng).toEqual(s1.rng);
    expect(Object.keys(dive.explored).sort()).toEqual(["1", "2"]);
    expectExploredCovers(r.state);
  });

  test("DG-14/CH-51 その潜行で初めて到達した階に降りたときだけ SAN が減る。2 階へ降り→上る→また降りると、2 回目は [floorChanged, message dungeon.descend] だけで SAN は変わらない", () => {
    const { state } = atStairsDown();
    expect(state.dive!.deepestFloor).toBe(1);
    const d1 = run(run(state, MOVE, DATA0).state, { type: "event.choose", optionId: "descend" }, DATA0);
    expect(kinds(d1.events).filter((k) => k === "sanChanged")).toHaveLength(6);
    expect(d1.state.dive!.deepestFloor).toBe(2);
    // 2 階の上り階段（降りた直後のセル）から一歩出て戻り、上る
    const dive = d1.state.dive!;
    const f2 = floorOf(dive, data);
    const out = FACINGS.find((d) => edgeOf(cellAt(f2, dive.pos.x, dive.pos.y), d) === "open")!;
    const away = run(placeAt(d1.state, dive.pos, out), MOVE, DATA0).state;
    const backTurn = run(away, { type: "dungeon.turn", dir: "around" }, DATA0).state;
    const atUp = run(backTurn, MOVE, DATA0);
    expect(atUp.state.pendingChoice?.promptKey).toBe("dungeon.stairsUpFloor");
    const up = run(atUp.state, { type: "event.choose", optionId: "ascend" }, DATA0);
    expect(up.state.dive!.floor).toBe(1);
    expect(up.state.dive!.deepestFloor).toBe(2);
    // 1 階の下り階段（上った直後のセル）から一歩出て戻り、降り直す
    const dive1 = up.state.dive!;
    const f1 = floorOf(dive1, data);
    const out1 = FACINGS.find((d) => edgeOf(cellAt(f1, dive1.pos.x, dive1.pos.y), d) === "open")!;
    const away1 = run(placeAt(up.state, dive1.pos, out1), MOVE, DATA0).state;
    const atDown = run(run(away1, { type: "dungeon.turn", dir: "around" }, DATA0).state, MOVE, DATA0);
    expect(atDown.state.pendingChoice?.promptKey).toBe("dungeon.stairsDown");
    const d2 = run(atDown.state, { type: "event.choose", optionId: "descend" }, DATA0);
    expect(d2.events).toEqual([
      { kind: "floorChanged", floor: 2, pos: d2.state.dive!.pos, facing: d2.state.dive!.facing },
      { kind: "message", key: "dungeon.descend" },
    ]);
    expect(d2.state.party.map((c) => c.san)).toEqual(atDown.state.party.map((c) => c.san));
    expect(d2.state.dive!.deepestFloor).toBe(2);
    expect(d2.state.rng).toEqual(atDown.state.rng);
  });

  test("DG-14/CH-51 再入場では deepestFloor が 1 に戻り、2 階へ降りるとまた SAN が減る", () => {
    const { state } = atStairsDown();
    const d1 = run(run(state, MOVE, DATA0).state, { type: "event.choose", optionId: "descend" }, DATA0);
    expect(d1.state.dive!.deepestFloor).toBe(2);
    // 帰還（M4）の代わりに、潜行を終えて街にいる状態を作る
    const town = cloneState(d1.state);
    town.dive = null;
    town.screen = "town";
    const again = run(town, ENTER_D01, DATA0).state;
    expect(again.dive!.deepestFloor).toBe(1);
    const f1 = floorOf(again.dive!, data);
    const a = approaches(f1, (c) => c.kind === "stairsDown")[0]!;
    const atDown = run(placeAt(again, a.pos, a.facing), MOVE, DATA0);
    const d2 = run(atDown.state, { type: "event.choose", optionId: "descend" }, DATA0);
    const n = data.config.san.floorDescend;
    expect(d2.events.filter((e) => e.kind === "sanChanged")).toEqual(
      atDown.state.party.map((c) => ({ kind: "sanChanged", id: c.id, delta: -n, san: c.san - n })),
    );
    expect(d2.state.dive!.deepestFloor).toBe(2);
  });

  test("DG-14 ascend（2 階の上り階段）: floor 1、pos は 1 階の stairsDown、SAN は変わらない。stay: pendingChoice null、events []。昇降の直後・stay の直後に、同じセルで確認は出ない", () => {
    const { state, a } = findSituation((c) => c.kind === "stairsUp", { floor: 2 });
    const r1 = run(state, MOVE, dataWithRate(1, 1));
    expect(r1.events).toEqual([
      { kind: "moved", pos: a.target, facing: a.facing },
      { kind: "message", key: "dungeon.stairsUpFloor" },
    ]);
    expect(r1.state.pendingChoice).toEqual({
      kind: "stairs",
      promptKey: "dungeon.stairsUpFloor",
      options: [
        { id: "ascend", labelKey: "dungeon.choice.ascend" },
        { id: "stay", labelKey: "dungeon.choice.stay" },
      ],
    });
    // stay
    const rs = run(r1.state, { type: "event.choose", optionId: "stay" });
    expect(rs.events).toEqual([]);
    expect(rs.state.pendingChoice).toBeNull();
    expect(rs.state.dive).toEqual(r1.state.dive);
    const rt = run(rs.state, { type: "dungeon.turn", dir: "left" });
    expect(kinds(rt.events)).toEqual(["turned"]);
    expect(rt.state.pendingChoice).toBeNull();
    // ascend
    const ra = run(r1.state, { type: "event.choose", optionId: "ascend" }, dataWithRate(1, 1));
    const floors = generateDive(data.dungeons[0]!, data.config.dungeon, ra.state.dive!.diveSeed);
    expect(ra.state.dive!.floor).toBe(1);
    expect(ra.state.dive!.pos).toEqual(floors[0]!.stairsDown);
    expect(ra.events).toEqual([
      { kind: "floorChanged", floor: 1, pos: floors[0]!.stairsDown, facing: a.facing },
      { kind: "message", key: "dungeon.ascend" },
    ]);
    expect(ra.state.party.map((c) => c.san)).toEqual(r1.state.party.map((c) => c.san));
    expect(ra.state.pendingChoice).toBeNull();
    expect(ra.state.rng).toEqual(r1.state.rng);
    // 昇降の直後、同じセルで旋回しても確認は出ない
    const rt2 = run(ra.state, { type: "dungeon.turn", dir: "around" });
    expect(kinds(rt2.events)).toEqual(["turned"]);
  });

  test("DG-06/E3 1 階の上り階段に入ると message dungeon.exitNotYet だけで、pendingChoice は null。遭遇判定もしない", () => {
    const { state, a } = findSituation((c) => c.kind === "stairsUp");
    const r = run(state, MOVE, dataWithRate(1, 1));
    expect(r.events).toEqual([
      { kind: "moved", pos: a.target, facing: a.facing },
      { kind: "message", key: "dungeon.exitNotYet" },
    ]);
    expect(r.state.pendingChoice).toBeNull();
    expect(r.state.rng).toEqual(state.rng);
  });
});

describe("罠（DG-20, DG-21, E4, E5）", () => {
  /** HP を 30/30 にそろえた状態で pit の手前に立つ */
  function atPit(mut?: (s: GameState) => void) {
    const sit = findSituation((c) => c.kind === "trap" && c.trapId === "pit");
    const s = cloneState(sit.state);
    for (const c of s.party) {
      c.hp = 30;
      c.hpMax = 30;
    }
    mut?.(s);
    return { ...sit, state: s };
  }

  test("DG-20/CH-51/CH-54 pit: message dungeon.trap.pit。生存者に並び順で config.dungeon.trap.pitDice（1d4。鏡の rng と一致）、hpChanged の delta と hp。dead のメンバーには振らない。罠の SAN はリーダー・普通 −3、慎重 −1（tags trap）", () => {
    const { state, a } = atPit((s) => {
      s.party[5]!.life = "dead";
      s.party[5]!.hp = 0;
    });
    const mirror = cloneRng(state.rng);
    const alive = state.party.filter((c) => c.life === "alive");
    const rolls = alive.map(() => rollDice(mirror, data.config.dungeon.trap.pitDice).total);
    randInt(mirror, 1, 100); // その後の遭遇判定
    const r = run(state, MOVE, DATA0);
    expect(r.events).toEqual([
      { kind: "moved", pos: a.target, facing: a.facing },
      { kind: "message", key: "dungeon.trap.pit" },
      ...alive.map((c, i) => ({ kind: "hpChanged", id: c.id, delta: -rolls[i]!, hp: 30 - rolls[i]! })),
      ...alive.map((c) => ({ kind: "sanChanged", id: c.id, delta: -trapLoss(state, c.id), san: c.san - trapLoss(state, c.id) })),
    ]);
    // リーダー −3、慎重（c2）−1、無鉄砲・強欲・普通 −3
    expect(alive.map((c) => trapLoss(state, c.id))).toEqual([3, 1, 3, 3, 3]);
    expect(r.state.rng).toEqual(mirror);
    expect(r.state.party[5]!.hp).toBe(0);
    expect(r.state.dive!.clearedCells).toEqual([{ floor: 1, ...a.target }]);
  });

  test("DG-20/E5/CH-45/CH-51 pit で HP 0: lifeChanged dead、message dungeon.dead {name}、本人以外の生存者に allyDeath −10（慎重は −5）。その後の罠の SAN は死者に掛からない", () => {
    const { state, a } = atPit((s) => {
      s.party[2]!.hp = 1; // 1d4 は 1 以上なので必ず倒れる
    });
    const mirror = cloneRng(state.rng);
    const rolls = state.party.map(() => rollDice(mirror, data.config.dungeon.trap.pitDice).total);
    randInt(mirror, 1, 100);
    const r = run(state, MOVE, DATA0);
    const victim = state.party[2]!;
    const others = state.party.filter((c) => c.id !== victim.id);
    const ally = (id: string) => (state.party.find((c) => c.id === id)!.personality === "cautious" ? 5 : 10);
    expect(r.events).toEqual([
      { kind: "moved", pos: a.target, facing: a.facing },
      { kind: "message", key: "dungeon.trap.pit" },
      ...state.party.map((c, i) => ({ kind: "hpChanged", id: c.id, delta: -(c.hp - Math.max(0, c.hp - rolls[i]!)), hp: Math.max(0, c.hp - rolls[i]!) })),
      { kind: "lifeChanged", id: victim.id, life: "dead" },
      { kind: "message", key: "dungeon.dead", params: { name: victim.name } },
      ...others.map((c) => ({ kind: "sanChanged", id: c.id, delta: -ally(c.id), san: c.san - ally(c.id) })),
      ...others.map((c) => ({ kind: "sanChanged", id: c.id, delta: -trapLoss(state, c.id), san: c.san - ally(c.id) - trapLoss(state, c.id) })),
    ]);
    expect(r.state.party[2]!.life).toBe("dead");
    expect(r.state.party[2]!.san).toBe(victim.san);
    expect(r.state.rng).toEqual(mirror);
  });

  test("DG-20/E5 pit で全員死亡: message dungeon.allDead が 1 回。その歩では階段と遭遇を起こさない。その後も dungeon.move は受け付ける", () => {
    const { state } = atPit((s) => {
      for (const c of s.party) c.hp = 1;
    });
    const mirror = cloneRng(state.rng);
    for (let i = 0; i < 6; i++) rollDice(mirror, data.config.dungeon.trap.pitDice);
    const r = run(state, MOVE, dataWithRate(1, 1));
    const ks = kinds(r.events);
    expect(ks.filter((k) => k === "message:dungeon.allDead")).toHaveLength(1);
    expect(ks.at(-1)).toBe("message:dungeon.allDead");
    expect(ks.filter((k) => k === "lifeChanged")).toHaveLength(6);
    expect(ks).not.toContain("sanChanged");
    expect(ks).not.toContain("message:battle.encounter");
    expect(r.state.rng).toEqual(mirror); // 遭遇の d100 を引いていない
    expect(r.state.party.every((c) => c.life === "dead")).toBe(true);
    // その後も前進と旋回は受け付ける。allDead はもう出さず、遭遇もしない
    let s = r.state;
    for (let i = 0; i < 20; i++) {
      const rr = run(s, i % 3 === 0 ? { type: "dungeon.turn", dir: "right" } : MOVE, dataWithRate(1, 1));
      expect(rr.events[0]?.kind).not.toBe("rejected");
      expect(kinds(rr.events)).not.toContain("message:dungeon.allDead");
      expect(kinds(rr.events)).not.toContain("message:battle.encounter");
      s = rr.state;
    }
  });

  test("DG-20/E5 全員死亡の後に罠のセルへ入っても、罠は発動しない（message・SAN・spinner の乱数・clearedCells のどれも無い）", () => {
    for (const trapId of ["pit", "spinner"] as const) {
      const sit = findSituation((c) => c.kind === "trap" && c.trapId === trapId);
      const s = cloneState(sit.state);
      for (const c of s.party) {
        c.hp = 0;
        c.life = "dead";
      }
      const r = run(s, MOVE, dataWithRate(1, 1));
      expect(r.events).toEqual([{ kind: "moved", pos: sit.a.target, facing: sit.a.facing }]);
      expect(r.state.dive!.clearedCells).toEqual([]);
      expect(r.state.dive!.facing).toBe(sit.a.facing);
      expect(r.state.rng).toEqual(s.rng); // 罠のダイス・spinner の向き・遭遇の d100 のどれも引かない
    }
  });

  test("DG-20 pitDice に負の修正値があっても回復しない。ダメージは max(0, 出目) で、0 なら hpChanged を出さない", () => {
    for (const expr of ["1d6-3", "0"]) {
      const d = loadFreshData();
      d.config.dungeon.trap.pitDice = expr;
      for (const def of d.dungeons) def.encounterRate = { room: 0, corridor: 0 };
      const { state } = atPit((s) => {
        for (const c of s.party) c.hp = 20; // hpMax 30
      });
      const mirror = cloneRng(state.rng);
      // 1d6-3 の出目は -2..3。0 以下は 0 ダメージ
      const dmg = state.party.map(() => Math.max(0, rollDice(mirror, expr).total));
      const r = run(state, MOVE, d);
      const hp = r.events.filter((e) => e.kind === "hpChanged");
      expect(hp).toEqual(
        state.party.flatMap((c, i) => (dmg[i]! > 0 ? [{ kind: "hpChanged", id: c.id, delta: -dmg[i]!, hp: 20 - dmg[i]! }] : [])),
      );
      r.state.party.forEach((c, i) => {
        expect(c.hp).toBe(20 - dmg[i]!);
        expect(c.hp).toBeLessThanOrEqual(c.hpMax);
      });
      if (expr === "0") expect(hp).toEqual([]);
      else expect(dmg.some((x) => x === 0)).toBe(true); // 負の出目が実際に起きたことを確かめる
    }
  });

  test("DG-20 spinner: 向きは FACINGS[randInt(0,3)]（鏡の rng と一致）、turned を出し、罠の SAN、explored の更新", () => {
    const seen = new Set<Facing>();
    for (let seed = 1; seed <= 60; seed++) {
      const s0 = enterD01(seed);
      const f = floorOf(s0.dive!, data);
      const a = approaches(f, (c) => c.kind === "trap" && c.trapId === "spinner")[0];
      if (a === undefined) continue;
      const state = placeAt(s0, a.pos, a.facing);
      const mirror = cloneRng(state.rng);
      const facing = FACINGS[randInt(mirror, 0, 3)]!;
      randInt(mirror, 1, 100);
      seen.add(facing);
      const r = run(state, MOVE, DATA0);
      expect(r.events).toEqual([
        { kind: "moved", pos: a.target, facing: a.facing },
        { kind: "message", key: "dungeon.trap.spinner" },
        { kind: "turned", facing },
        ...state.party.map((c) => ({ kind: "sanChanged", id: c.id, delta: -trapLoss(state, c.id), san: c.san - trapLoss(state, c.id) })),
      ]);
      expect(r.state.dive!.facing).toBe(facing);
      expect(r.state.rng).toEqual(mirror);
      expectExploredCovers(r.state);
    }
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });

  test("DG-21 M2 では察知が無く、罠は常に発動する（慎重が何人いても）", () => {
    const sit = findSituation((c) => c.kind === "trap" && c.trapId === "spinner");
    const s = cloneState(sit.state);
    for (const c of s.party) if (!c.isLeader) c.personality = "cautious";
    for (let k = 0; k < 20; k++) {
      const st = cloneState(s);
      st.rng = createRng(k);
      const r = run(st, MOVE, DATA0);
      expect(kinds(r.events)).toContain("message:dungeon.trap.spinner");
      expect(kinds(r.events)).not.toContain("message:dungeon.trap.detected");
    }
  });

  test("DG-20/E4 発動した罠は clearedCells に入り、同じセルに戻っても発動しない（mapView でも plain）", () => {
    const { state, a } = atPit();
    const r1 = run(state, MOVE, DATA0);
    expect(r1.state.dive!.clearedCells).toEqual([{ floor: 1, ...a.target }]);
    const f = floorOf(r1.state.dive!, data);
    const cell = cellAt(f, a.target.x, a.target.y);
    expect(cell.kind).toBe(cell.roomId !== null ? "room" : "corridor");
    expect(cell.trapId).toBeNull();
    // 戻ってもう一度入る
    const again = placeAt(r1.state, a.pos, a.facing);
    const r2 = run(again, MOVE, DATA0);
    expect(kinds(r2.events)).toEqual(["moved"]);
    expect(r2.state.dive!.clearedCells).toHaveLength(1);
    const mc = mapView(r2.state, data)!.cells.find((c) => c.x === a.target.x && c.y === a.target.y)!;
    expect(mc.kind).toBe("plain");
  });

  test("DG-20/E4 teleport の罠（d02）は踏んでも何も起きず、clearedCells にも入らない", () => {
    const base = (seed: number) => {
      const s = cloneState(newGame(seed));
      s.progress.unlockedDungeons.push("d02");
      return execute(s, { type: "dungeon.enter", dungeonId: "d02" }, data).state;
    };
    const { state } = findSituation((c) => c.kind === "trap" && c.trapId === "teleport", { base });
    const mirror = cloneRng(state.rng);
    randInt(mirror, 1, 100);
    const r = run(state, MOVE, DATA0);
    expect(kinds(r.events)).toEqual(["moved"]);
    expect(r.state.dive!.clearedCells).toEqual([]);
    expect(r.state.party).toEqual(state.party);
    expect(r.state.rng).toEqual(mirror);
  });

  test("DG-22 event セルを踏んでも、遭遇判定のほかは何も起きない", () => {
    for (const floor of [1, 2]) {
      const { state } = findSituation((c) => c.kind === "event", { floor });
      const mirror = cloneRng(state.rng);
      randInt(mirror, 1, 100);
      const r = run(state, MOVE, DATA0);
      expect(kinds(r.events)).toEqual(["moved"]);
      expect(r.state.rng).toEqual(mirror);
      expect(r.state.pendingChoice).toBeNull();
      expect(r.state.party).toEqual(state.party);
      expect(r.state.dive!.clearedCells).toEqual([]);
      const r1 = run(state, MOVE, dataEnc(1, 1));
      expect(kinds(r1.events).slice(0, 4)).toEqual(["moved", "screen", "encounter", "message:battle.encounter"]);
    }
  });
});

describe("ボス（DG-31〜33, DG-01）", () => {
  const D0 = dataEnc(0, 0);
  const atBoss = (base?: (seed: number) => GameState) => findSituation((c) => c.kind === "boss", { floor: 2, ...(base ? { base } : {}) });

  /** ボス戦の state で、ボスを HP 1 の麻痺にしてアルドが必中で倒す */
  function defeatBoss(state: GameState): ReturnType<typeof run> {
    const s = cloneState(state);
    const u = s.battle!.groups[0]!.units[0]!;
    u.hp = 1;
    u.status = ["paralysis"];
    for (const c of s.party) s.battle!.inputs[c.id] = { type: "defend" };
    s.battle!.inputs["c1"] = { type: "attack", group: 0 };
    const d = loadFreshData();
    d.config.combat.hitMin = 100;
    d.config.combat.hitMax = 100;
    return run(s, { type: "battle.resolve" }, d);
  }

  test("DG-31/CB-02 ボスのセルは rate 0 でも遭遇の d100 を振らずに固定遭遇（門番の甲冑 1 体、origin boss、逃走不可）。鏡の rng", () => {
    const { state } = atBoss();
    const mirror = cloneRng(state.rng);
    const boss = monsterOf(data, dungeonOf(data, "d01").boss.monster);
    rollDice(mirror, boss.groupSize); // "1" は消費なし
    rollDice(mirror, boss.hp);
    rollDie(mirror, 10);
    rollDie(mirror, 10);
    const r = run(state, MOVE, D0);
    expect(kinds(r.events).slice(0, 4)).toEqual(["moved", "screen", "encounter", "message:battle.encounter"]);
    expect(r.state.rng).toEqual(mirror);
    expect(r.state.battle!.origin).toEqual({ kind: "boss" });
    expect(r.state.battle!.groups.map((g) => [g.monsterId, g.units.length])).toEqual([["gatekeeper_armor", 1]]);
    expect(battleMenu(r.state, D0)!.canFlee).toBe(false);
    expect(execute(r.state, { type: "battle.input", memberId: "c1", action: { type: "flee" } }, D0).events).toEqual([
      { kind: "rejected", command: "battle.input", reason: "cannot flee" },
    ]);
  });

  test("DG-32/DG-01 ボスを倒すと bossDefeated、clearedDungeons と unlockedDungeons に d02（message 付き）、floorOf のボスのセルが teleporter（踏んでも何も起きない）", () => {
    const { state, a } = atBoss();
    const fought = run(state, MOVE, D0).state;
    const r = defeatBoss(fought);
    expect(eventsOfKind(r.events, "battleEnd")).toEqual([{ kind: "battleEnd", result: "win" }]);
    const ks = kinds(r.events);
    expect(ks).toContain("message:battle.bossDefeated");
    expect(ks).toContain("message:battle.dungeonCleared");
    expect(r.events).toContainEqual({ kind: "message", key: "dungeon.unlocked", params: { dungeon: "沈んだ聖堂" } });
    expect(ks).not.toContain("message:battle.chest");
    const s = r.state;
    expect(s.dive!.bossDefeated).toBe(true);
    expect(s.progress.clearedDungeons).toEqual(["d01"]);
    expect(s.progress.unlockedDungeons).toEqual(["d01", "d02"]);
    expect(s.screen).toBe("dungeon");
    const f = floorOf(s.dive!, data);
    expect(cellAt(f, a.target.x, a.target.y).kind).toBe("teleporter");
    expect(f.boss).toEqual(a.target);
    expect(floorOf(s.dive!, data, 1).cells.some((c) => c.kind === "teleporter")).toBe(false);
    // 一度離れて戻っても、もう固定遭遇は起きない（rate 0 なら [moved] と d100 の 1 回だけ）
    const back = placeAt(s, a.pos, a.facing);
    const mirror = cloneRng(back.rng);
    randInt(mirror, 1, 100);
    const again = run(back, MOVE, D0);
    expect(kinds(again.events)).toEqual(["moved"]);
    expect(again.state.rng).toEqual(mirror);
  });

  test("DG-33 新しい潜行ではボスが再出現し、再撃破でも clearedDungeons・unlockedDungeons は重複せず、dungeonCleared・unlocked の message も出ない", () => {
    const first = defeatBoss(run(atBoss().state, MOVE, D0).state).state;
    // 帰還は M4 なので、街に戻した state を手で作って入り直す
    const town = cloneState(first);
    town.dive = null;
    town.screen = "town";
    const base = (seed: number): GameState => {
      const t = cloneState(town);
      t.rng = createRng(seed);
      return execute(t, ENTER_D01, data).state;
    };
    const sit = atBoss(base);
    expect(sit.state.dive!.bossDefeated).toBe(false);
    expect(cellAt(floorOf(sit.state.dive!, data), sit.a.target.x, sit.a.target.y).kind).toBe("boss");
    const fought = run(sit.state, MOVE, D0);
    expect(fought.state.battle!.origin).toEqual({ kind: "boss" });
    const r = defeatBoss(fought.state);
    const ks = kinds(r.events);
    expect(ks).toContain("message:battle.bossDefeated");
    expect(ks).not.toContain("message:battle.dungeonCleared");
    expect(ks).not.toContain("message:dungeon.unlocked");
    expect(r.state.progress.clearedDungeons).toEqual(["d01"]);
    expect(r.state.progress.unlockedDungeons).toEqual(["d01", "d02"]);
    expect(r.state.dive!.bossDefeated).toBe(true);
  });
});

describe("決定性と網羅", () => {
  test("§3-2 決定性: 同じ state と command で execute を 2 回呼ぶと deep-equal。引数の state を書き換えない。返る state（dive・pendingChoice を含む）は JSON 往復で toEqual", () => {
    const frozenData = deepFreeze(loadFreshData());
    const pit = findSituation((c) => c.kind === "trap" && c.trapId === "pit").state;
    const stairs = run(findSituation((c) => c.kind === "stairsDown").state, MOVE).state;
    const cases: [GameState, Command][] = [
      [newGame(5), ENTER_D01],
      [enterD01(5), MOVE],
      [enterD01(5), { type: "dungeon.turn", dir: "around" }],
      [pit, MOVE],
      [stairs, { type: "event.choose", optionId: "descend" }],
      [stairs, { type: "event.choose", optionId: "stay" }],
    ];
    for (const [s, cmd] of cases) {
      const frozen = deepFreeze(cloneState(s));
      const before = JSON.stringify(frozen);
      const a = execute(frozen, cmd, frozenData);
      const b = execute(frozen, cmd, frozenData);
      expect(a.events[0]?.kind).not.toBe("rejected");
      expect(a).toEqual(b);
      expect(JSON.stringify(frozen)).toBe(before);
      expect(JSON.parse(JSON.stringify(a.state))).toEqual(a.state);
    }
  });

  test("UI-43/§3-10 200 シード × 300 歩のランダムウォーク（move/turn/choose）で出た message の key がすべて strings に実在し、例外が出ない", () => {
    const keys = new Set<string>();
    const kindsSeen = new Set<string>();
    for (let seed = 1; seed <= 200; seed++) {
      const walker = createRng(seed + 10_000);
      let s = enterD01(seed);
      // 偶数シードは 1 階の任意の位置から歩き始める（迷路が長く、入口からだけでは階段に届きにくいため）
      if (seed % 2 === 0) {
        s = placeAt(s, { x: randInt(walker, 0, 19), y: randInt(walker, 0, 19) }, FACINGS[randInt(walker, 0, 3)]!);
      }
      const events: GameEvent[] = [];
      for (let i = 0; i < 300; i++) {
        let cmd: Command;
        if (s.pendingChoice !== null) {
          const opts = s.pendingChoice.options;
          cmd = { type: "event.choose", optionId: opts[randInt(walker, 0, opts.length - 1)]!.id };
        } else {
          const k = randInt(walker, 0, 9);
          cmd = k < 6 ? MOVE : { type: "dungeon.turn", dir: k < 8 ? "left" : k < 9 ? "right" : "around" };
        }
        const r = execute(s, cmd, data);
        if (r.events[0]?.kind === "rejected") throw new Error(`seed ${seed} step ${i}: ${JSON.stringify(r.events[0])}`);
        events.push(...r.events);
        s = r.state;
        // 遭遇したらオートで戦闘を終わらせてから歩き続ける（全滅なら迷宮に戻る。M4 までの仮）
        if (s.screen === "battle") s = finishBattle(s, events);
      }
      expectKnownStringKeys(events);
      for (const e of events) {
        kindsSeen.add(e.kind);
        if (e.kind === "message") keys.add(e.key);
      }
    }
    // ウォークが主要な経路を通ったこと
    for (const k of ["dungeon.blocked", "dungeon.door", "dungeon.stairsDown", "dungeon.descend", "battle.encounter", "battle.win"]) {
      expect(keys.has(k), k).toBe(true);
    }
    expect(kindsSeen.has("floorChanged")).toBe(true);
  }, 120_000);
});
