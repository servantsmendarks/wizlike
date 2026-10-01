// 潜行中のルール（DG-03, DG-10〜14, DG-20, DG-40, CB-01 の仮実装, CH-45/51/54）と、表示層向けの問い合わせ（visibleCells, mapView）。
// 迷宮の構造は state に入れず、dive.diveSeed から毎回作り直す（DG-03）。開けた扉と発動済みの罠は dive の記録を重ねる。
import type { GameData } from "../data/index";
import { chance, nextUint32, randInt, rollDice } from "../rng";
import { dungeonOf } from "../state";
import type {
  Character,
  Dive,
  Edge,
  Facing,
  Floor,
  GameState,
  MapCell,
  MapCellKind,
  MapView,
  Pos,
  RuleContext,
  ViewPoint,
  VisibleCell,
} from "../types";
import {
  cellAt,
  edgeOf,
  FACINGS,
  generateFloor,
  idx,
  inBounds,
  isPassable,
  opposite,
  setEdge,
  step,
  turnLeft,
  turnRight,
} from "./dungeon-gen";
import { loseSan } from "./san";

/**
 * 潜行中の階の実効の構造。generateDive(...)[floorNo-1] に、その階の openedDoors（open にする）と
 * clearedCells（kind を roomId !== null ? "room" : "corridor" に、eventId と trapId を null に）を重ねる。
 */
export function floorOf(dive: Dive, data: GameData, floorNo: number = dive.floor): Floor {
  const def = dungeonOf(data, dive.dungeonId);
  if (!Number.isInteger(floorNo) || floorNo < 1 || floorNo > def.floors) throw new Error(`floorOf: bad floor ${floorNo}`);
  // generateDive(...)[floorNo-1] と同じ。下の階は上の階に依存しない（DG-06 は上の階の stairsDown だけ）ので、floorNo までで止める
  let f = generateFloor(def, data.config.dungeon, dive.diveSeed, 1, null);
  for (let n = 2; n <= floorNo; n++) f = generateFloor(def, data.config.dungeon, dive.diveSeed, n, f.stairsDown);
  for (const d of dive.openedDoors) {
    if (d.floor === floorNo) setEdge(f, d.x, d.y, d.dir, "open");
  }
  for (const c of dive.clearedCells) {
    if (c.floor !== floorNo) continue;
    const cell = cellAt(f, c.x, c.y);
    cell.kind = cell.roomId !== null ? "room" : "corridor";
    cell.eventId = null;
    cell.trapId = null;
  }
  return f;
}

function relEdges(f: Floor, x: number, y: number, facing: Facing): { front: Edge; left: Edge; right: Edge } {
  const c = cellAt(f, x, y);
  return { front: edgeOf(c, facing), left: edgeOf(c, turnLeft(facing)), right: edgeOf(c, turnRight(facing)) };
}

/**
 * DG-12。正面の列は前の辺が open のときだけ奥へ進む（扉も遮る）。左右の列は、同じ奥行きの正面のセルの
 * 側の辺が open のときだけ返す。並びは depth の昇順、同じ depth の中は lane -1, 0, 1。
 */
export function visibleCellsOf(f: Floor, pos: Pos, facing: Facing, depth: number): VisibleCell[] {
  const out: VisibleCell[] = [];
  let c: Pos = { x: pos.x, y: pos.y };
  for (let d = 0; d <= depth; d++) {
    if (d > 0) {
      c = step(c, facing);
      if (!inBounds(f, c.x, c.y)) break;
    }
    const rel = relEdges(f, c.x, c.y, facing);
    if (rel.left === "open") {
      const l = step(c, turnLeft(facing));
      if (inBounds(f, l.x, l.y)) out.push({ depth: d, lane: -1, x: l.x, y: l.y, ...relEdges(f, l.x, l.y, facing) });
    }
    out.push({ depth: d, lane: 0, x: c.x, y: c.y, ...rel });
    if (rel.right === "open") {
      const r = step(c, turnRight(facing));
      if (inBounds(f, r.x, r.y)) out.push({ depth: d, lane: 1, x: r.x, y: r.y, ...relEdges(f, r.x, r.y, facing) });
    }
    if (rel.front !== "open") break;
  }
  return out;
}

/** DG-12。dive が null なら []。at を省くと dive の現在値。奥行きは config.dungeon.viewDepth */
export function visibleCells(state: GameState, data: GameData, at?: ViewPoint): VisibleCell[] {
  const dive = state.dive;
  if (dive === null) return [];
  const vp: ViewPoint = at ?? { floor: dive.floor, pos: dive.pos, facing: dive.facing };
  const f = floorOf(dive, data, vp.floor);
  return visibleCellsOf(f, vp.pos, vp.facing, data.config.dungeon.viewDepth);
}

/** DG-13 / UI-24。探索済みセルだけを、実効の 4 辺で返す。記号は上り・下り階段だけ。dive が null なら null */
export function mapView(state: GameState, data: GameData): MapView | null {
  const dive = state.dive;
  if (dive === null) return null;
  const f = floorOf(dive, data);
  const cells: MapCell[] = [];
  for (const i of dive.explored[String(dive.floor)] ?? []) {
    const x = i % f.width;
    const y = (i - x) / f.width;
    const c = cellAt(f, x, y);
    const kind: MapCellKind = c.kind === "stairsUp" ? "stairsUp" : c.kind === "stairsDown" ? "stairsDown" : "plain";
    cells.push({ x, y, kind, n: c.n, e: c.e, s: c.s, w: c.w });
  }
  return {
    dungeonId: dive.dungeonId,
    floor: dive.floor,
    width: f.width,
    height: f.height,
    pos: { x: dive.pos.x, y: dive.pos.y },
    facing: dive.facing,
    cells,
  };
}

/** DG-13: 視野のセルの添字を explored[階] に昇順・重複なしで足す。f は dive.floor の実効の構造 */
export function markExplored(dive: Dive, f: Floor, depth: number): void {
  const key = String(dive.floor);
  const list = dive.explored[key] ?? [];
  for (const v of visibleCellsOf(f, dive.pos, dive.facing, depth)) {
    const i = idx(f, v.x, v.y);
    // 昇順の位置に挿入する（重複は足さない）
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (list[mid]! < i) lo = mid + 1;
      else hi = mid;
    }
    if (list[lo] !== i) list.splice(lo, 0, i);
  }
  dive.explored[key] = list;
}

function explore(ctx: RuleContext, dive: Dive, f: Floor): void {
  markExplored(dive, f, ctx.data.config.dungeon.viewDepth);
}

function aliveMembers(state: GameState): Character[] {
  return state.party.filter((c) => c.life === "alive");
}

// ---------------------------------------------------------------------------
// 入場（DG-03, DG-40, TW-11）

/** dungeon.enter を受け付けない理由。受け付けるなら null */
export function checkEnter(state: GameState, dungeonId: unknown, data: GameData): string | null {
  if (state.screen !== "town") return "wrong screen";
  if (state.dive !== null) return "already diving";
  if (typeof dungeonId !== "string" || !data.dungeons.some((d) => d.id === dungeonId)) return "unknown dungeon";
  if (!state.progress.unlockedDungeons.includes(dungeonId)) return "not unlocked";
  return null;
}

export function enterDungeon(ctx: RuleContext, dungeonId: string): void {
  const { state, data } = ctx;
  const def = dungeonOf(data, dungeonId);
  const diveSeed = nextUint32(state.rng); // 乱数の消費はこの 1 回だけ（DG-03）
  const f = generateFloor(def, data.config.dungeon, diveSeed, 1, null);
  const upCell = cellAt(f, f.stairsUp.x, f.stairsUp.y);
  const facing = FACINGS.find((d) => isPassable(edgeOf(upCell, d)));
  if (facing === undefined) throw new Error("enterDungeon: stairsUp has no exit");
  const dive: Dive = {
    dungeonId,
    diveSeed,
    floor: 1,
    pos: { x: f.stairsUp.x, y: f.stairsUp.y },
    facing,
    explored: {},
    openedDoors: [],
    clearedCells: [],
    bossDefeated: false,
    ledger: { items: [], gold: 0 },
  };
  state.dive = dive;
  state.screen = "dungeon";
  explore(ctx, dive, f);
  ctx.events.push({ kind: "screen", to: "dungeon" });
  ctx.events.push({ kind: "message", key: "dungeon.enter", params: { dungeon: def.name } });
}

function requireDive(state: GameState): Dive {
  if (state.dive === null) throw new Error("not in dungeon");
  return state.dive;
}

// ---------------------------------------------------------------------------
// 旋回（DG-10, DG-11）。乱数は使わない

export function turn(ctx: RuleContext, dir: "left" | "right" | "around"): void {
  const dive = requireDive(ctx.state);
  dive.facing = dir === "left" ? turnLeft(dive.facing) : dir === "right" ? turnRight(dive.facing) : opposite(dive.facing);
  ctx.events.push({ kind: "turned", facing: dive.facing });
  explore(ctx, dive, floorOf(dive, ctx.data));
}

// ---------------------------------------------------------------------------
// 前進（DG-10, DG-11, DG-13, DG-14, DG-20, CB-01）

/** 共有辺を N / W に正規化して記録する（重複は足さない） */
function addOpenedDoor(dive: Dive, pos: Pos, facing: Facing): void {
  let ref: { floor: number; x: number; y: number; dir: "N" | "W" };
  switch (facing) {
    case "N":
      ref = { floor: dive.floor, x: pos.x, y: pos.y, dir: "N" };
      break;
    case "W":
      ref = { floor: dive.floor, x: pos.x, y: pos.y, dir: "W" };
      break;
    case "S":
      ref = { floor: dive.floor, x: pos.x, y: pos.y + 1, dir: "N" };
      break;
    case "E":
      ref = { floor: dive.floor, x: pos.x + 1, y: pos.y, dir: "W" };
      break;
  }
  const dup = dive.openedDoors.some((d) => d.floor === ref.floor && d.x === ref.x && d.y === ref.y && d.dir === ref.dir);
  if (!dup) dive.openedDoors.push(ref);
}

export function moveForward(ctx: RuleContext): void {
  const { state, data } = ctx;
  const dive = requireDive(state);
  const f = floorOf(dive, data);
  const here = cellAt(f, dive.pos.x, dive.pos.y);
  const e = edgeOf(here, dive.facing);
  if (e === "wall") {
    ctx.events.push({ kind: "blocked" });
    ctx.events.push({ kind: "message", key: "dungeon.blocked" });
    return;
  }
  if (e === "door") {
    ctx.events.push({ kind: "message", key: "dungeon.door" });
    addOpenedDoor(dive, dive.pos, dive.facing);
    setEdge(f, dive.pos.x, dive.pos.y, dive.facing, "open");
  }
  dive.pos = step(dive.pos, dive.facing);
  ctx.events.push({ kind: "moved", pos: { x: dive.pos.x, y: dive.pos.y }, facing: dive.facing });
  explore(ctx, dive, f);
  const cell = cellAt(f, dive.pos.x, dive.pos.y);
  if (cell.kind === "trap") triggerTrap(ctx, f, dive.pos);
  if (aliveMembers(state).length === 0) return; // E5: 全滅処理は M4。階段と遭遇は起こさない
  if (cell.kind === "stairsDown") {
    offerStairs(ctx, "down");
    return; // 階段セルでは遭遇判定をしない
  }
  if (cell.kind === "stairsUp") {
    if (dive.floor >= 2) offerStairs(ctx, "up");
    else ctx.events.push({ kind: "message", key: "dungeon.exitNotYet" });
    return;
  }
  rollEncounter(ctx, cell.roomId !== null);
}

/** CB-01 の仮実装（E6）。前進が成立した 1 歩につき d100 をちょうど 1 回消費する */
function rollEncounter(ctx: RuleContext, inRoom: boolean): void {
  const dive = requireDive(ctx.state);
  const def = dungeonOf(ctx.data, dive.dungeonId);
  const rate = inRoom ? def.encounterRate.room : def.encounterRate.corridor;
  if (chance(ctx.state.rng, Math.round(rate * 100))) {
    ctx.events.push({ kind: "message", key: "battle.encounter" });
  }
}

// ---------------------------------------------------------------------------
// 罠（DG-20, CH-45, CH-51, CH-54, E4, E5）。DG-21 の察知は M5 なので、M2 では常に発動する

function triggerTrap(ctx: RuleContext, f: Floor, p: Pos): void {
  const { state, data } = ctx;
  const dive = requireDive(state);
  const cell = cellAt(f, p.x, p.y);
  const trapId = cell.trapId;
  if (trapId === null || trapId === "teleport") return; // teleport は M2 では何もしない（clearedCells にも入れない）
  dive.clearedCells.push({ floor: dive.floor, x: p.x, y: p.y });
  ctx.events.push({ kind: "message", key: `dungeon.trap.${trapId}` });
  const cfg = data.config;
  if (trapId === "pit") {
    const alive0 = aliveMembers(state);
    for (const ch of alive0) {
      const r = rollDice(state.rng, cfg.dungeon.pitDamage).total;
      const next = Math.max(0, ch.hp - r);
      ctx.events.push({ kind: "hpChanged", id: ch.id, delta: next - ch.hp, hp: next });
      ch.hp = next;
    }
    const died = alive0.filter((ch) => ch.hp === 0);
    for (const ch of died) {
      ch.life = "dead";
      ctx.events.push({ kind: "lifeChanged", id: ch.id, life: "dead" });
      ctx.events.push({ kind: "message", key: "dungeon.dead", params: { name: ch.name } });
    }
    for (let k = 0; k < died.length; k++) {
      for (const o of aliveMembers(state)) loseSan(ctx, o, cfg.san.allyDeath, ["allyInjury"]);
    }
    if (died.length > 0 && aliveMembers(state).length === 0) {
      ctx.events.push({ kind: "message", key: "dungeon.allDead" });
    }
  } else if (trapId === "spinner") {
    dive.facing = FACINGS[randInt(state.rng, 0, 3)]!;
    ctx.events.push({ kind: "turned", facing: dive.facing });
    explore(ctx, dive, f);
  }
  for (const ch of aliveMembers(state)) loseSan(ctx, ch, cfg.san.trap, ["trap"]);
}

// ---------------------------------------------------------------------------
// 階段（DG-14, E3）

function offerStairs(ctx: RuleContext, dir: "down" | "up"): void {
  const key = dir === "down" ? "dungeon.stairsDown" : "dungeon.stairsUpFloor";
  ctx.state.pendingChoice = {
    kind: "stairs",
    promptKey: key,
    options:
      dir === "down"
        ? [
            { id: "descend", labelKey: "dungeon.choice.descend" },
            { id: "stay", labelKey: "dungeon.choice.stay" },
          ]
        : [
            { id: "ascend", labelKey: "dungeon.choice.ascend" },
            { id: "stay", labelKey: "dungeon.choice.stay" },
          ],
  };
  ctx.events.push({ kind: "message", key });
}

/** event.choose。optionId は pendingChoice.options にあることを呼び出し側で確かめ済み */
export function chooseOption(ctx: RuleContext, optionId: string): void {
  const { state, data } = ctx;
  const pc = state.pendingChoice;
  if (pc === null) throw new Error("chooseOption: no pending choice");
  state.pendingChoice = null;
  // M2 は kind "stairs" だけ
  if (optionId === "stay") return;
  const dive = requireDive(state);
  if (optionId === "descend") {
    dive.floor += 1;
    explore(ctx, dive, floorOf(dive, data));
    ctx.events.push({ kind: "floorChanged", floor: dive.floor, pos: { x: dive.pos.x, y: dive.pos.y }, facing: dive.facing });
    ctx.events.push({ kind: "message", key: "dungeon.descend" });
    for (const ch of aliveMembers(state)) loseSan(ctx, ch, data.config.san.floorDescend, []);
    return;
  }
  if (optionId === "ascend") {
    dive.floor -= 1;
    explore(ctx, dive, floorOf(dive, data));
    ctx.events.push({ kind: "floorChanged", floor: dive.floor, pos: { x: dive.pos.x, y: dive.pos.y }, facing: dive.facing });
    ctx.events.push({ kind: "message", key: "dungeon.ascend" });
    return;
  }
  throw new Error(`chooseOption: unknown option ${optionId}`);
}
