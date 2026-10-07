// 階の実効の構造と視野（DG-03 / DG-12 / DG-13）と転移（DG-25）。
// M11 の作業 5 で floorOf・visibleCellsOf・markExplored を dungeon.ts から移した（挙動は不変）。宝箱の転移の罠（chest.ts）がこれらを使うが、
// chest.ts は combat.ts から import され、dungeon.ts は combat.ts を import するので、chest.ts → dungeon.ts は循環になるため。
// import は dungeon-gen・field・rng・state と型だけ（循環を作らない）。dungeon.ts は同じ名前で再び export する。
import type { GameData } from "../data/index";
import { randInt } from "../rng";
import { dungeonOf } from "../state";
import type { Dive, Edge, Facing, Floor, Pos, RuleContext, VisibleCell } from "../types";
import { cellAt, edgeOf, generateFloor, idx, inBounds, step, turnLeft, turnRight } from "./dungeon-gen";
import { addExplored } from "./field";

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

/** DG-13: 視野のセルの添字を explored[階] に昇順・重複なしで足す。f は dive.floor の実効の構造 */
export function markExplored(dive: Dive, f: Floor, depth: number): void {
  addExplored(
    dive,
    dive.floor,
    visibleCellsOf(f, dive.pos, dive.facing, depth).map((v) => idx(f, v.x, v.y)),
  );
}

/**
 * DG-25（M11）: 転移。今の階の実効の構造（floorOf）で、kind が corridor かつ roomId が null の、今の位置ではないセルを添字の昇順に並べ、
 * randInt(0, n − 1)（state.rng）で 1 つ選んで pos を書き換える（向きはそのまま）→ 視野を explored に足す（markExplored）→ moved{pos, facing}。
 * 着地したセルでは歩の続き（遭遇・罠・イベント・階段）を起こさない。explored は階ごとに保つので、地図は転移の前後で続く（DG-13）。
 * 候補が無ければ何もしない（乱数も引かない）
 */
export function teleportParty(ctx: RuleContext): void {
  const { state, data } = ctx;
  const dive = state.dive;
  if (dive === null) throw new Error("teleportParty: not in dungeon");
  const f = floorOf(dive, data);
  const here = idx(f, dive.pos.x, dive.pos.y);
  const cands: Pos[] = [];
  f.cells.forEach((c, i) => {
    if (c.kind === "corridor" && c.roomId === null && i !== here) cands.push({ x: i % f.width, y: Math.floor(i / f.width) });
  });
  if (cands.length === 0) return;
  const to = cands[randInt(state.rng, 0, cands.length - 1)]!;
  dive.pos = { x: to.x, y: to.y };
  markExplored(dive, f, data.config.dungeon.viewDepth);
  ctx.events.push({ kind: "moved", pos: { x: to.x, y: to.y }, facing: dive.facing });
}
