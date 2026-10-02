// DG-15: 地図のタップ移動の経路探索（planRoute / routeOnFloor）と、自動歩行を続けてよいかの判定（routeStepOk）。
// 手組みの Floor の期待値は手で数えた手数（前進・旋回とも 1 手）。turnLeft は N→W→S→E、turnRight は N→E→S→W。
import { describe, expect, test } from "vitest";
import type { GameData } from "../src/core/data/index";
import { execute } from "../src/core/engine";
import { cellAt, edgeOf, idx, setEdge } from "../src/core/rules/dungeon-gen";
import { floorOf } from "../src/core/rules/dungeon";
import { planRoute, routeOnFloor, routeStepOk } from "../src/core/rules/pathfind";
import { cloneState } from "../src/core/state";
import type { Cell, Command, Facing, Floor, GameEvent, GameState, Pos, RouteStep } from "../src/core/types";
import { dived, withBattle } from "./helpers/battle";
import { data, expectKnownStringKeys, loadFreshData, newGame } from "./helpers/core";
import { findSituation, withRng } from "./helpers/dungeon";

// 手組みの Floor（全セル corridor、全辺 wall）
function makeFloor(w: number, h: number): Floor {
  const cells: Cell[] = [];
  for (let i = 0; i < w * h; i++) cells.push({ kind: "corridor", n: "wall", e: "wall", s: "wall", w: "wall", roomId: null, eventId: null, trapId: null });
  return { floor: 1, width: w, height: h, cells, rooms: [], stairsUp: { x: 0, y: 0 }, stairsDown: null, boss: null };
}

const all = (f: Floor): number[] => f.cells.map((_, i) => i);
const MOVE = { type: "dungeon.move" } as const;
const LEFT = { type: "dungeon.turn", dir: "left" } as const;
const RIGHT = { type: "dungeon.turn", dir: "right" } as const;
const AROUND = { type: "dungeon.turn", dir: "around" } as const;
const st = (command: RouteStep["command"], x: number, y: number, facing: Facing): RouteStep => ({ command, pos: { x, y }, facing });

/**
 * 3×3 の輪（中央 (1,1) は孤立）:
 *   (0,0)-(1,0)-(2,0)
 *     |           |
 *   (0,1)       (2,1)
 *     |           |
 *   (0,2)-(1,2)-(2,2)
 */
function ring(): Floor {
  const f = makeFloor(3, 3);
  setEdge(f, 0, 0, "E", "open");
  setEdge(f, 1, 0, "E", "open");
  setEdge(f, 0, 2, "E", "open");
  setEdge(f, 1, 2, "E", "open");
  setEdge(f, 0, 0, "S", "open");
  setEdge(f, 0, 1, "S", "open");
  setEdge(f, 2, 0, "S", "open");
  setEdge(f, 2, 1, "S", "open");
  return f;
}

describe("DG-15 routeOnFloor（手組みの Floor）", () => {
  test("DG-15 最短手数: (0,2) 北向きから (2,0) へは 前進・前進・右・前進・前進 の 5 手（右・前進 2・左・前進 2 の 6 手は採らない）", () => {
    const f = ring();
    expect(routeOnFloor(f, all(f), { x: 0, y: 2 }, "N", { x: 2, y: 0 })).toEqual([
      st(MOVE, 0, 1, "N"),
      st(MOVE, 0, 0, "N"),
      st(RIGHT, 0, 0, "E"),
      st(MOVE, 1, 0, "E"),
      st(MOVE, 2, 0, "E"),
    ]);
  });

  test("DG-15 同じ手数なら move → left → right → around の順: (1,0) 南向き（正面は壁）から (1,2) へは左回りも右回りも 7 手で、left から始まる東回りを採る", () => {
    const f = ring();
    expect(routeOnFloor(f, all(f), { x: 1, y: 0 }, "S", { x: 1, y: 2 })).toEqual([
      st(LEFT, 1, 0, "E"),
      st(MOVE, 2, 0, "E"),
      st(RIGHT, 2, 0, "S"),
      st(MOVE, 2, 1, "S"),
      st(MOVE, 2, 2, "S"),
      st(RIGHT, 2, 2, "W"),
      st(MOVE, 1, 2, "W"),
    ]);
  });

  test("DG-15 真後ろは around の 1 手（left 2 回ではない）。目標のセルに着いた時点で止め、向きは問わない", () => {
    const f = makeFloor(1, 3);
    setEdge(f, 0, 0, "S", "open");
    setEdge(f, 0, 1, "S", "open");
    expect(routeOnFloor(f, all(f), { x: 0, y: 0 }, "N", { x: 0, y: 2 })).toEqual([st(AROUND, 0, 0, "S"), st(MOVE, 0, 1, "S"), st(MOVE, 0, 2, "S")]);
  });

  test("DG-15 扉は通れる（door の辺も前進の候補）", () => {
    const f = makeFloor(3, 1);
    setEdge(f, 0, 0, "E", "door");
    setEdge(f, 1, 0, "E", "open");
    expect(routeOnFloor(f, all(f), { x: 0, y: 0 }, "E", { x: 2, y: 0 })).toEqual([st(MOVE, 1, 0, "E"), st(MOVE, 2, 0, "E")]);
  });

  test("DG-15 未探索のセルは通らない: 近道が未探索なら遠回り、未探索を挟まないと届かなければ null。target が未探索・盤外・整数でないなら null、現在位置なら []", () => {
    const f = ring();
    // (0,1) を未探索にすると、(0,2) 北向きから (2,0) へは東回り: 右・前進 2・左・前進 2 の 6 手
    const noWest = all(f).filter((i) => i !== idx(f, 0, 1));
    expect(routeOnFloor(f, noWest, { x: 0, y: 2 }, "N", { x: 2, y: 0 })).toEqual([
      st(RIGHT, 0, 2, "E"),
      st(MOVE, 1, 2, "E"),
      st(MOVE, 2, 2, "E"),
      st(LEFT, 2, 2, "N"),
      st(MOVE, 2, 1, "N"),
      st(MOVE, 2, 0, "N"),
    ]);
    // (0,1) と (2,1) の両方が未探索なら届かない
    const cut = noWest.filter((i) => i !== idx(f, 2, 1));
    expect(routeOnFloor(f, cut, { x: 0, y: 2 }, "N", { x: 2, y: 0 })).toBeNull();
    // target が未探索
    expect(routeOnFloor(f, noWest, { x: 0, y: 2 }, "N", { x: 0, y: 1 })).toBeNull();
    // 盤外・整数でない
    expect(routeOnFloor(f, all(f), { x: 0, y: 2 }, "N", { x: 3, y: 0 })).toBeNull();
    expect(routeOnFloor(f, all(f), { x: 0, y: 2 }, "N", { x: -1, y: 0 })).toBeNull();
    expect(routeOnFloor(f, all(f), { x: 0, y: 2 }, "N", { x: 0.5, y: 0 })).toBeNull();
    // 探索済みでも壁で囲まれた (1,1) へは届かない
    expect(routeOnFloor(f, all(f), { x: 0, y: 2 }, "N", { x: 1, y: 1 })).toBeNull();
    // 現在位置
    expect(routeOnFloor(f, all(f), { x: 0, y: 2 }, "N", { x: 0, y: 2 })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 実データ

/** encounterRate を 0 にした data（構造の生成には影響しない） */
function dataNoEncounter(): GameData {
  const d = loadFreshData();
  for (const def of d.dungeons) def.encounterRate = { room: 0, corridor: 0 };
  return d;
}
const DATA0 = dataNoEncounter();

/** dived(seed) の 1 階を全部探索済みにしたもの */
function fullyExplored(seed: number): GameState {
  const s = cloneState(dived(seed));
  const f = floorOf(s.dive!, data);
  s.dive!.explored["1"] = all(f);
  return s;
}

describe("DG-15 planRoute（state）", () => {
  test("DG-15 planRoute: 迷宮の戦闘外・保留なしでなければ null（title、街、戦闘中、保留中）。現在位置なら []", () => {
    const s = fullyExplored(1);
    const here = s.dive!.pos;
    expect(planRoute(s, data, here)).toEqual([]);
    expect(planRoute(newGame(1), data, { x: 0, y: 0 })).toBeNull();
    expect(planRoute(withBattle(s, [{ monsterId: data.monsters[0]!.id, hps: [3] }]), data, here)).toBeNull();
    const pending = cloneState(s);
    pending.pendingChoice = { kind: "stairs", promptKey: "dungeon.stairsUp", options: [{ id: "exit", labelKey: "dungeon.choice.exit" }] };
    expect(planRoute(pending, data, here)).toBeNull();
    const town = cloneState(s);
    town.screen = "town";
    expect(planRoute(town, data, here)).toBeNull();
  });

  test("DG-15 planRoute は state を書き換えず、乱数も進めない。探索済みの範囲だけ（入場直後の explored の外は null）", () => {
    const s0 = dived(1);
    const snapshot = structuredClone(s0);
    const f = floorOf(s0.dive!, data);
    const explored = new Set(s0.dive!.explored["1"]!);
    for (let i = 0; i < f.width * f.height; i++) {
      const p = { x: i % f.width, y: Math.floor(i / f.width) };
      const r = planRoute(s0, data, p);
      if (!explored.has(i)) expect(r).toBeNull();
    }
    expect(s0).toEqual(snapshot);
  });

  test("DG-15 遭遇率 0 の data で steps を順に execute すると、どの手でも routeStepOk が真で、最後に目標に着く（扉を通る経路と毒の hpChanged を含む）", () => {
    const s0 = fullyExplored(1);
    // 毒の 1 歩（hpChanged）が出ても止まらないことを見るため、c1 を毒にする（hp は十分にある）
    const c1 = s0.party[0]!;
    c1.status = ["poison"];
    c1.hp = c1.hpMax = 999;
    const f = floorOf(s0.dive!, DATA0);
    const plain = (p: Pos) => {
      const k = cellAt(f, p.x, p.y).kind;
      return k === "corridor" || k === "room";
    };
    // 前進で入るセルがすべて通路か部屋の目標だけを使う（階段・罠・イベント・ボスでは core が止める。旋回は今のセルのまま）
    const candidates: { target: Pos; steps: RouteStep[] }[] = [];
    for (let i = 0; i < f.width * f.height; i++) {
      const target = { x: i % f.width, y: Math.floor(i / f.width) };
      const steps = planRoute(s0, DATA0, target);
      if (steps === null || steps.length === 0) continue;
      if (steps.every((x) => x.command.type !== "dungeon.move" || plain(x.pos))) candidates.push({ target, steps });
    }
    const crossesDoor = (steps: RouteStep[]) => {
      let p = s0.dive!.pos;
      let d = s0.dive!.facing;
      for (const x of steps) {
        if (x.command.type === "dungeon.move" && edgeOf(cellAt(f, p.x, p.y), d) === "door") return true;
        p = x.pos;
        d = x.facing;
      }
      return false;
    };
    const picked = candidates.filter((_, i) => i % 15 === 0);
    const withDoor = candidates.find((c) => crossesDoor(c.steps));
    expect(withDoor).toBeDefined();
    picked.push(withDoor!);
    let doors = 0;
    let poisonTicks = 0;
    for (const { target, steps } of picked) {
      let s = s0;
      for (const x of steps) {
        const r = execute(s, x.command as Command, DATA0);
        expectKnownStringKeys(r.events, DATA0);
        expect(routeStepOk(x, r.events, r.state)).toBe(true);
        doors += r.events.filter((e) => e.kind === "message" && e.key === "dungeon.door").length;
        poisonTicks += r.events.filter((e) => e.kind === "hpChanged").length;
        s = r.state;
      }
      expect(s.dive!.pos).toEqual(target);
    }
    expect(picked.length).toBeGreaterThan(5);
    expect(doors).toBeGreaterThan(0);
    expect(poisonTicks).toBeGreaterThan(0);
  });
});

describe("DG-15 routeStepOk", () => {
  const base = dived(1);
  /** base の dive を pos / facing に置いたもの */
  const at = (pos: Pos, facing: Facing, patch: (s: GameState) => void = () => {}): GameState => {
    const s = cloneState(base);
    s.dive!.pos = { ...pos };
    s.dive!.facing = facing;
    patch(s);
    return s;
  };
  const step = st(MOVE, 3, 4, "N");
  const turnStep = st(LEFT, 3, 4, "W");
  const moved: GameEvent = { kind: "moved", pos: { x: 3, y: 4 }, facing: "N" };
  const door: GameEvent = { kind: "message", key: "dungeon.door" };
  const poison: GameEvent = { kind: "hpChanged", id: "c1", delta: -1, hp: 5 };

  test("DG-15 routeStepOk 真: moved だけ、扉の message 付きの moved、毒の hpChanged 付き。turn では turned", () => {
    const after = at({ x: 3, y: 4 }, "N");
    expect(routeStepOk(step, [moved], after)).toBe(true);
    expect(routeStepOk(step, [door, moved], after)).toBe(true);
    expect(routeStepOk(step, [door, moved, poison, { ...poison, id: "c2" }], after)).toBe(true);
    expect(routeStepOk(turnStep, [{ kind: "turned", facing: "W" }], at({ x: 3, y: 4 }, "W"))).toBe(true);
  });

  test("DG-15 routeStepOk 偽: 扉の message は move のときだけ・先頭の 1 件だけ許す。turn に moved、move に turned、空の events", () => {
    const after = at({ x: 3, y: 4 }, "N");
    expect(routeStepOk(step, [door, door, moved], after)).toBe(false);
    expect(routeStepOk(step, [moved, door], after)).toBe(false);
    expect(routeStepOk(turnStep, [door, { kind: "turned", facing: "W" }], at({ x: 3, y: 4 }, "W"))).toBe(false);
    expect(routeStepOk(turnStep, [moved], at({ x: 3, y: 4 }, "W"))).toBe(false);
    expect(routeStepOk(step, [{ kind: "turned", facing: "N" }], after)).toBe(false);
    expect(routeStepOk(step, [], after)).toBe(false);
  });

  test("DG-15 routeStepOk 偽: 罠の message、スピナー（turned が続き向きが違う）、pos が違う、向きが違う", () => {
    expect(routeStepOk(step, [moved, { kind: "message", key: "dungeon.trap.pit" }, poison], at({ x: 3, y: 4 }, "N"))).toBe(false);
    expect(routeStepOk(step, [moved, { kind: "message", key: "dungeon.trap.spinner" }, { kind: "turned", facing: "E" }], at({ x: 3, y: 4 }, "E"))).toBe(false);
    // events が正しく見えても、着いた位置・向きが予定と違えば偽
    expect(routeStepOk(step, [moved], at({ x: 3, y: 3 }, "N"))).toBe(false);
    expect(routeStepOk(step, [moved], at({ x: 3, y: 4 }, "E"))).toBe(false);
  });

  test("DG-15 routeStepOk 偽: 実際の execute で、壁（blocked）・rejected・遭遇（戦闘）・階段の確認（pendingChoice）", () => {
    const s0 = fullyExplored(1);
    const f = floorOf(s0.dive!, data);
    // 壁: 現在のセルで wall の向きを向いて前進
    const wallDir = (["N", "E", "S", "W"] as const).find((d) => edgeOf(cellAt(f, s0.dive!.pos.x, s0.dive!.pos.y), d) === "wall")!;
    const sWall = cloneState(s0);
    sWall.dive!.facing = wallDir;
    const rWall = execute(sWall, MOVE, data);
    expectKnownStringKeys(rWall.events, data);
    expect(rWall.events[0]!.kind).toBe("blocked");
    expect(routeStepOk(st(MOVE, s0.dive!.pos.x, s0.dive!.pos.y, wallDir), rWall.events, rWall.state)).toBe(false);

    // 遭遇: 遭遇率 1 の data で、通路か部屋のセルへ 1 歩
    const d1 = loadFreshData();
    for (const def of d1.dungeons) def.encounterRate = { room: 1, corridor: 1 };
    const plan = (() => {
      for (let i = 0; i < f.width * f.height; i++) {
        const t = { x: i % f.width, y: Math.floor(i / f.width) };
        const r = planRoute(s0, data, t);
        if (r !== null && r.length === 1 && r[0]!.command.type === "dungeon.move") {
          const k = cellAt(f, t.x, t.y).kind;
          if (k === "corridor" || k === "room") return r[0]!;
        }
      }
      // 1 手で行けるセルが無ければ、向きを変えてから 1 歩のもの
      for (let i = 0; i < f.width * f.height; i++) {
        const t = { x: i % f.width, y: Math.floor(i / f.width) };
        const r = planRoute(s0, data, t);
        if (r !== null && r.length === 2 && r[1]!.command.type === "dungeon.move") {
          const k = cellAt(f, t.x, t.y).kind;
          if (k === "corridor" || k === "room") return { ...r[1]!, from: r[0]! };
        }
      }
      throw new Error("no adjacent cell");
    })();
    let sEnc = s0;
    if ("from" in plan) {
      const rt = execute(s0, plan.from.command as Command, d1);
      expect(routeStepOk(plan.from, rt.events, rt.state)).toBe(true);
      sEnc = rt.state;
    }
    const rEnc = execute(sEnc, MOVE, d1);
    expectKnownStringKeys(rEnc.events, d1);
    expect(rEnc.state.battle).not.toBeNull();
    expect(routeStepOk(plan, rEnc.events, rEnc.state)).toBe(false);

    // rejected: 戦闘中に前進を送る
    const rRej = execute(rEnc.state, MOVE, d1);
    expect(rRej.events[0]!.kind).toBe("rejected");
    expect(routeStepOk(plan, rRej.events, rRej.state)).toBe(false);

  });

  test("DG-15 routeStepOk 偽: 経路が階段を踏むと、その手で確認（pendingChoice）が立って止まる。それまでの手は真", () => {
    // 下り階段までの経路の途中が通路か部屋だけのシードを探す（途中の罠・イベントでは別の理由で止まるため）
    for (let seed = 1; seed <= 50; seed++) {
      const s0 = fullyExplored(seed);
      const f = floorOf(s0.dive!, DATA0);
      const toDown = planRoute(s0, DATA0, f.stairsDown!)!;
      const mid = toDown.slice(0, -1);
      if (!mid.every((x) => x.command.type !== "dungeon.move" || ["corridor", "room"].includes(cellAt(f, x.pos.x, x.pos.y).kind))) continue;
      let s = s0;
      for (let i = 0; i < toDown.length; i++) {
        const r = execute(s, toDown[i]!.command as Command, DATA0);
        expectKnownStringKeys(r.events, DATA0);
        const last = i === toDown.length - 1;
        expect(r.state.pendingChoice !== null).toBe(last);
        expect(routeStepOk(toDown[i]!, r.events, r.state)).toBe(!last);
        s = r.state;
      }
      expect(s.dive!.pos).toEqual(f.stairsDown);
      return;
    }
    throw new Error("no seed found");
  });

  test("DG-15/DG-21/DG-22 察知・イベントの手では routeStepOk が偽（moved の後に語りと確認・eventStarted が続く）", () => {
    const { state, a } = findSituation((c) => c.kind === "trap" && c.trapId === "pit");
    const d0 = loadFreshData();
    for (const def of d0.dungeons) def.encounterRate = { room: 0, corridor: 0 };
    const stepToTrap = st(MOVE, a.target.x, a.target.y, a.facing);
    let checked = 0;
    for (let k = 1; k <= 20; k++) {
      const r = execute(withRng(state, k), MOVE, d0);
      expectKnownStringKeys(r.events, d0);
      if (r.state.pendingChoice?.kind !== "trap") continue;
      expect(r.events[0]).toEqual({ kind: "moved", pos: a.target, facing: a.facing });
      expect(routeStepOk(stepToTrap, r.events, r.state)).toBe(false);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
    // DG-22: イベントのセルへの手（衝動で決着しても、選択を待っても偽）
    const ev = findSituation((c) => c.kind === "event");
    const stepToEvent = st(MOVE, ev.a.target.x, ev.a.target.y, ev.a.facing);
    for (let k = 1; k <= 10; k++) {
      const r = execute(withRng(ev.state, k), MOVE, d0);
      expectKnownStringKeys(r.events, d0);
      expect(r.events[1]?.kind).toBe("eventStarted");
      expect(routeStepOk(stepToEvent, r.events, r.state)).toBe(false);
    }
  });
});
