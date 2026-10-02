// 潜行中のルール（DG-03, DG-10〜14, DG-20〜22, DG-31〜33, DG-40, CB-01, CH-43/45/51/54）と、表示層向けの問い合わせ（visibleCells, mapView）。
// 迷宮の構造は state に入れず、dive.diveSeed から毎回作り直す（DG-03）。発動済みの罠は dive の記録を重ねる。扉は通り抜けても扉のまま（DG-10）。
import type { GameData } from "../data/index";
import { chance, nextUint32, randInt } from "../rng";
import { dungeonOf, personalityOf } from "../state";
import type {
  Cell,
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
  step,
  turnLeft,
  turnRight,
} from "./dungeon-gen";
import { startBossEncounter, startRandomEncounter, tickPoisonStep } from "./combat";
import { canAct } from "./combat-calc";
import { offerExit, offerStairs, offerTeleporter, offerTrap } from "./choices";
import { chooseEventOption, startEvent } from "./events";
import { addExplored, aliveMembers, damageMembers } from "./field";
import { loseSan } from "./san";
import { enterBlockReason, returnToTown } from "./town";

/**
 * 潜行中の階の実効の構造。generateDive(...)[floorNo-1] に、その階の
 * clearedCells（kind を roomId !== null ? "room" : "corridor" に、eventId と trapId を null に）を重ねる。
 * 最下層でボスを倒していれば（dive.bossDefeated）、ボスのセルを teleporter に重ねる（DG-32。前進で入ると街へ戻るかを尋ねる）。
 * 辺は生成のまま（扉は通り抜けても door。DG-10）。
 */
export function floorOf(dive: Dive, data: GameData, floorNo: number = dive.floor): Floor {
  const def = dungeonOf(data, dive.dungeonId);
  if (!Number.isInteger(floorNo) || floorNo < 1 || floorNo > def.floors) throw new Error(`floorOf: bad floor ${floorNo}`);
  // generateDive(...)[floorNo-1] と同じ。下の階は上の階に依存しない（DG-06 は上の階の stairsDown だけ）ので、floorNo までで止める
  let f = generateFloor(def, data.config.dungeon, dive.diveSeed, 1, null);
  for (let n = 2; n <= floorNo; n++) f = generateFloor(def, data.config.dungeon, dive.diveSeed, n, f.stairsDown);
  for (const c of dive.clearedCells) {
    if (c.floor !== floorNo) continue;
    const cell = cellAt(f, c.x, c.y);
    cell.kind = cell.roomId !== null ? "room" : "corridor";
    cell.eventId = null;
    cell.trapId = null;
  }
  if (floorNo === def.floors && dive.bossDefeated && f.boss !== null) cellAt(f, f.boss.x, f.boss.y).kind = "teleporter";
  return f;
}

/** 向きに対する前・左・右の辺と、階段の記号（DG-12。罠・イベント・ボスは返さない） */
function relEdges(
  f: Floor,
  x: number,
  y: number,
  facing: Facing,
): { front: Edge; left: Edge; right: Edge; stairs: VisibleCell["stairs"] } {
  const c = cellAt(f, x, y);
  const stairs = c.kind === "stairsUp" ? "up" : c.kind === "stairsDown" ? "down" : null;
  return { front: edgeOf(c, facing), left: edgeOf(c, turnLeft(facing)), right: edgeOf(c, turnRight(facing)), stairs };
}

/**
 * DG-12。正面の列は前の辺が open のときだけ奥へ進む（扉も遮る）。左右の列は、同じ奥行きの正面のセルの
 * 側の辺が open のときだけ返す。並びは depth の昇順、同じ depth の中は lane -1, 0, 1。
 * どのレーンのセルでも、階段なら stairs に "up" / "down" を入れる（UI-20）。
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
  addExplored(
    dive,
    dive.floor,
    visibleCellsOf(f, dive.pos, dive.facing, depth).map((v) => idx(f, v.x, v.y)),
  );
}

/**
 * UI-57（開発用、M5）: debug.warp の行き先。dive.floor の実効の構造（floorOf。処理済みのイベント・発動済みの罠は消えている）で、
 * 目標のセルを添字順に、各セルについて FACINGS（N,E,S,W）の順に隣 n = step(セル, d) を見て、盤内・n の kind が corridor か room・
 * セルの辺 d が通れるものを探し、最初の { pos: n, facing: opposite(d) } を返す。無ければ null。
 * 目標: event は kind event かつ eventId 非 null、trap は kind trap かつ trapId が pit / spinner、stairsDown は f.stairsDown のセル
 */
export function warpTarget(
  state: GameState,
  data: GameData,
  to: "event" | "trap" | "stairsDown",
): { pos: Pos; facing: Facing } | null {
  const f = floorOf(requireDive(state), data);
  const isTarget = (c: Cell, x: number, y: number): boolean => {
    switch (to) {
      case "event":
        return c.kind === "event" && c.eventId !== null;
      case "trap":
        return c.kind === "trap" && (c.trapId === "pit" || c.trapId === "spinner");
      case "stairsDown":
        return f.stairsDown !== null && f.stairsDown.x === x && f.stairsDown.y === y;
    }
  };
  for (let y = 0; y < f.height; y++) {
    for (let x = 0; x < f.width; x++) {
      const c = cellAt(f, x, y);
      if (!isTarget(c, x, y)) continue;
      for (const d of FACINGS) {
        const n = step({ x, y }, d);
        if (!inBounds(f, n.x, n.y) || !isPassable(edgeOf(c, d))) continue;
        const k = cellAt(f, n.x, n.y).kind;
        if (k !== "corridor" && k !== "room") continue;
        return { pos: n, facing: opposite(d) };
      }
    }
  }
  return null;
}

function explore(ctx: RuleContext, dive: Dive, f: Floor): void {
  markExplored(dive, f, ctx.data.config.dungeon.viewDepth);
}

// ---------------------------------------------------------------------------
// 入場（DG-03, DG-40, TW-11）

/** dungeon.enter を受け付けない理由。受け付けるなら null（実体は town.ts の enterBlockReason。townMenu の canEnter と同じ判定） */
export function checkEnter(state: GameState, dungeonId: unknown, data: GameData): string | null {
  return enterBlockReason(state, dungeonId, data);
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
    deepestFloor: 1,
    pos: { x: f.stairsUp.x, y: f.stairsUp.y },
    facing,
    explored: {},
    clearedCells: [],
    bossDefeated: false,
    ledger: { items: [], gold: 0 },
  };
  state.dive = dive;
  state.townVisit = null; // TW-32: 来訪の終わり（救済の申し出も下ろす）
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
// 前進（DG-10, DG-11, DG-13, DG-14, DG-20, DG-31, CB-01, CH-43）

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
  // DG-10: 扉は通り抜けるたびに語る。辺は door のまま（開けた記録を持たない。ユーザー決定）
  if (e === "door") ctx.events.push({ kind: "message", key: "dungeon.door" });
  dive.pos = step(dive.pos, dive.facing);
  ctx.events.push({ kind: "moved", pos: { x: dive.pos.x, y: dive.pos.y }, facing: dive.facing });
  explore(ctx, dive, f);
  const cell = cellAt(f, dive.pos.x, dive.pos.y);
  // CH-43: 毒の 1 歩ごとのダメージ（HP 1 で止まるので、これで死ぬことはない）
  tickPoisonStep(ctx);
  if (cell.kind === "trap") {
    if (detectTrap(ctx, cell)) return; // DG-21: 察知したら確認を立てて終わる（階段・遭遇なし）
    triggerTrap(ctx, f, dive.pos);
  }
  continueStep(ctx, f, cell);
}

/**
 * 前進の 1 歩の続き（罠の後）。罠の察知で「進む」を選んだときもここから続ける。f は dive.floor の実効の構造。
 * 行動可能な者がいなければ何もしない → 階段・出口・テレポーター・ボス → イベント（DG-22）→ 遭遇判定。
 */
function continueStep(ctx: RuleContext, f: Floor, cell: Cell): void {
  const { state } = ctx;
  const dive = requireDive(state);
  // DG-11 / DG-20: 行動可能な者（CH-44）がいなければ階段・遭遇を起こさずに返る（全滅処理は engine の後処理 wipeIfNoneCanAct）
  if (!state.party.some(canAct)) return;
  if (cell.kind === "stairsDown") {
    offerStairs(ctx, "down");
    return; // 階段セルでは遭遇判定をしない
  }
  if (cell.kind === "stairsUp") {
    if (dive.floor >= 2) offerStairs(ctx, "up");
    else offerExit(ctx); // DG-06: 1 階の上り階段は街への出口
    return;
  }
  // DG-32: ボス撃破後のテレポーター（floorOf が重ねる）。遭遇の d100 は振らない
  if (cell.kind === "teleporter") {
    offerTeleporter(ctx);
    return;
  }
  // DG-31: ボスのセルは遭遇の d100 を振らずに固定遭遇（倒した後は floorOf が teleporter に重ねる）
  if (cell.kind === "boss" && !dive.bossDefeated) {
    startBossEncounter(ctx);
    return;
  }
  // DG-22 / B11: イベントのセルは events.ts の手順で処理し、遭遇の d100 は振らない（処理後は floorOf が通常のセルに戻す）
  if (cell.kind === "event" && cell.eventId !== null) {
    startEvent(ctx, f, cell.eventId);
    return;
  }
  rollEncounter(ctx, cell.roomId !== null);
}

/** CB-01。前進が成立した 1 歩につき d100 をちょうど 1 回消費し、当たれば CB-03 の編成で戦闘を始める */
function rollEncounter(ctx: RuleContext, inRoom: boolean): void {
  const dive = requireDive(ctx.state);
  const def = dungeonOf(ctx.data, dive.dungeonId);
  const rate = inRoom ? def.encounterRate.room : def.encounterRate.corridor;
  if (chance(ctx.state.rng, Math.round(rate * 100))) startRandomEncounter(ctx, inRoom);
}

// ---------------------------------------------------------------------------
// 罠（DG-20, DG-21, CH-45, CH-51, CH-54, E4）。踏んだときに察知（DG-21）を判定し、察知しなければ発動する

/**
 * DG-21 / A6: 罠の察知。teleport（未実装の罠）は対象外。行動可能で benefits.trapDetect > 0 の者を並び順に
 * d100 ≤ trapDetect で振り、最初の成功者で止める（dungeon.trap.detected{name} と確認 kind trap）。dice は出さない。
 * 誰も成功しなければ何も出さずに false（罠は通常どおり発動する）。
 */
function detectTrap(ctx: RuleContext, cell: Cell): boolean {
  const { state, data } = ctx;
  if (cell.trapId === null || cell.trapId === "teleport") return false;
  for (const ch of state.party) {
    const v = personalityOf(data, ch.personality)?.benefits.trapDetect ?? 0;
    if (!canAct(ch) || v <= 0) continue;
    if (chance(state.rng, v)) {
      ctx.events.push({ kind: "message", key: "dungeon.trap.detected", params: { name: ch.name } });
      offerTrap(ctx);
      return true;
    }
  }
  return false;
}

/**
 * DG-21 / A6: 察知の確認の選択。retreat は 1 歩前のセルへ戻る（向きはそのまま。遭遇・毒・SAN なし、罠は残る）。
 * proceed はその場で罠が通常どおり発動し、その後は普段の歩の続き（行動可能チェック・遭遇判定）。
 */
function chooseTrapOption(ctx: RuleContext, optionId: string): void {
  const { state, data } = ctx;
  const dive = requireDive(state);
  if (optionId === "retreat") {
    dive.pos = step(dive.pos, opposite(dive.facing));
    ctx.events.push({ kind: "moved", pos: { x: dive.pos.x, y: dive.pos.y }, facing: dive.facing });
    explore(ctx, dive, floorOf(dive, data));
    ctx.events.push({ kind: "message", key: "dungeon.trap.retreat" });
    return;
  }
  if (optionId === "proceed") {
    const f = floorOf(dive, data);
    const cell = cellAt(f, dive.pos.x, dive.pos.y); // clearedCells にまだ無いので kind trap のまま
    triggerTrap(ctx, f, dive.pos);
    continueStep(ctx, f, cell);
    return;
  }
  throw new Error(`chooseTrapOption: unknown option ${optionId}`);
}

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
    damageMembers(ctx, aliveMembers(state), cfg.dungeon.trap.pitDice);
  } else if (trapId === "spinner") {
    dive.facing = FACINGS[randInt(state.rng, 0, 3)]!;
    ctx.events.push({ kind: "turned", facing: dive.facing });
    explore(ctx, dive, f);
  }
  for (const ch of aliveMembers(state)) loseSan(ctx, ch, cfg.san.trap, ["trap"]);
}

// ---------------------------------------------------------------------------
// 階段・出口・テレポーター（DG-06, DG-14, DG-32, E3）。確認を立てるのは choices.ts

/**
 * event.choose。optionId は pendingChoice.options にあることを呼び出し側で確かめ済み。
 * kind event は chooseEventOption（EV-31/33）、kind trap は chooseTrapOption（DG-21）。以下は階段・出口・テレポーター:
 * stay は何もしない。exit（DG-06 徒歩）と teleport（DG-32）は returnToTown で街へ（DG-43 で台帳を確定）。
 */
export function chooseOption(ctx: RuleContext, optionId: string): void {
  const { state, data } = ctx;
  const pc = state.pendingChoice;
  if (pc === null) throw new Error("chooseOption: no pending choice");
  state.pendingChoice = null;
  if (pc.kind === "event") {
    chooseEventOption(ctx, floorOf(requireDive(state), data), pc, optionId); // EV-31 / EV-33
    return;
  }
  if (pc.kind === "trap") {
    chooseTrapOption(ctx, optionId);
    return;
  }
  if (optionId === "stay") return;
  if (optionId === "exit") {
    returnToTown(ctx, "dungeon.exit");
    return;
  }
  if (optionId === "teleport") {
    returnToTown(ctx, "dungeon.teleport");
    return;
  }
  const dive = requireDive(state);
  if (optionId === "descend") {
    dive.floor += 1;
    explore(ctx, dive, floorOf(dive, data));
    ctx.events.push({ kind: "floorChanged", floor: dive.floor, pos: { x: dive.pos.x, y: dive.pos.y }, facing: dive.facing });
    ctx.events.push({ kind: "message", key: "dungeon.descend" });
    // DG-14 / CH-51: この潜行で初めて到達した階に降りたときだけ減る（上って降り直しても減らない。ユーザー決定）
    if (dive.floor > dive.deepestFloor) {
      dive.deepestFloor = dive.floor;
      for (const ch of aliveMembers(state)) loseSan(ctx, ch, data.config.san.floorDescend, []);
    }
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
