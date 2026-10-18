// 階の実効の構造と視野（DG-03 / DG-12 / DG-13）と転移（DG-25）。
// M11 の作業 5 で floorOf・visibleCellsOf・markExplored を dungeon.ts から移した（挙動は不変）。宝箱の転移の罠（chest.ts）がこれらを使うが、
// chest.ts は combat.ts から import され、dungeon.ts は combat.ts を import するので、chest.ts → dungeon.ts は循環になるため。
// import は dungeon-gen・field・rng・state と型だけ（循環を作らない）。dungeon.ts は同じ名前で再び export する。
import type { DungeonDef, GameData } from "../data/index";
import { randInt } from "../rng";
import { dungeonOf } from "../state";
import type { Dive, Edge, Facing, Floor, Pos, RuleContext, VisibleCell } from "../types";
import { cellAt, type ChestGen, edgeOf, generateFloor, idx, inBounds, step, turnLeft, turnRight } from "./dungeon-gen";
import { addExplored } from "./field";

/**
 * DG-23 / CB-61（M11）: 宝箱の罠の抽選の材料（generateFloor の chestGen と、ドロップの箱の rollChestTrap が使う）。
 * noTrapChance は config.chest、weights はそのダンジョンの chestTrapDangerWeights、trapsByDanger は chest-traps.json を危険度 1..4 ごとにデータの順で
 */
export function chestGenOf(data: GameData, dungeonId: string): ChestGen {
  const def = dungeonOf(data, dungeonId);
  return {
    noTrapChance: data.config.chest.noTrapChance,
    weights: def.chestTrapDangerWeights,
    trapsByDanger: def.chestTrapDangerWeights.map((_, i) => data.chestTraps.filter((t) => t.danger === i + 1).map((t) => t.id)),
  };
}

/**
 * 潜行中の階の実効の構造。generateDive(...)[floorNo-1] に、その階の
 * clearedCells（kind を roomId !== null ? "room" : "corridor" に、eventId・trapId・chestTrapId を null に）を重ねる。
 * 宝箱のセル（DG-23）は、開けた・転移で失ったものが clearedCells に入って消える。罠が無くなった箱（disarmedChests）は重ねない
 * （chestTrapId は生成のまま。箱を置くとき DG-24 が disarmedChests を見て罠なしにし、危険度は生成の罠の値を残す）。
 * DG-48（M21）: dive.culled が true のときだけ dungeons[].fillRatio で間引く（無ければ fillRatio 1）。
 * 最下層でボスを倒していれば（dive.bossDefeated）、ボスのセルを teleporter に重ねる（DG-32。前進で入ると街へ戻るかを尋ねる）。
 * 辺は生成のまま（扉は通り抜けても door。DG-10）。
 */
export function floorOf(dive: Dive, data: GameData, floorNo: number = dive.floor): Floor {
  // DG-48（M21）: culled の無い潜行（M20 までのセーブの途中の潜行）は間引かない（fillRatio 1）
  const def0 = dungeonOf(data, dive.dungeonId);
  const def = dive.culled === true ? def0 : { ...def0, fillRatio: 1 };
  if (!Number.isInteger(floorNo) || floorNo < 1 || floorNo > def.floors) throw new Error(`floorOf: bad floor ${floorNo}`);
  const f = copyFloor(generatedFloor(def, data.config.dungeon, dive.diveSeed, floorNo, chestGenOf(data, dive.dungeonId)));
  for (const c of dive.clearedCells) {
    if (c.floor !== floorNo) continue;
    const cell = cellAt(f, c.x, c.y);
    cell.kind = cell.roomId !== null ? "room" : "corridor";
    cell.eventId = null;
    cell.trapId = null;
    cell.chestTrapId = null;
  }
  if (floorNo === def.floors && dive.bossDefeated && f.boss !== null) cellAt(f, f.boss.x, f.boss.y).kind = "teleporter";
  return f;
}

/**
 * D-1b（M21）: 生成した盤（clearedCells などを重ねる前）のモジュール内のメモ。DG-48 の間引きで生成が重くなり（PC で 1 階あたり約 1ms）、
 * floorOf はコマンドのたびに呼ばれるため。鍵は生成の入力のすべて（実効の def・config.dungeon・chestGen・diveSeed）を JSON にした文字列なので、
 * 同じ鍵からは必ず同じ盤になる（generateFloor は純粋）。GameState には入れない。値は外へ渡さず、floorOf は copyFloor の写しを返す
 * （呼び出し側が盤を書き換えてもメモは変わらない）。直近 GEN_CACHE_MAX 個の潜行だけを持つ
 */
const GEN_CACHE_MAX = 8;
const genCache = new Map<string, Floor[]>();

/** generateDive(...)[floorNo-1] と同じ盤（メモ）。上の階は下の階に依存しない（下の階は上の階の stairsDown だけを使う。DG-06）ので、floorNo までだけ作る */
function generatedFloor(def: DungeonDef, cfg: GameData["config"]["dungeon"], diveSeed: number, floorNo: number, gen: ChestGen): Floor {
  const key = JSON.stringify([def, cfg, gen, diveSeed]);
  let chain = genCache.get(key);
  if (chain === undefined) {
    chain = [];
    if (genCache.size >= GEN_CACHE_MAX) genCache.delete(genCache.keys().next().value!);
  } else genCache.delete(key); // 使った鍵を末尾へ（古いものから捨てる）
  genCache.set(key, chain);
  for (let n = chain.length + 1; n <= floorNo; n++) chain.push(generateFloor(def, cfg, diveSeed, n, n === 1 ? null : chain[n - 2]!.stairsDown, gen));
  return chain[floorNo - 1]!;
}

/** 盤の深い写し（Floor は平たいオブジェクトの入れ子だけ） */
function copyFloor(f: Floor): Floor {
  return {
    ...f,
    cells: f.cells.map((c) => ({ ...c })),
    rooms: f.rooms.map((r) => ({ ...r })),
    stairsUp: { ...f.stairsUp },
    stairsDown: f.stairsDown === null ? null : { ...f.stairsDown },
    boss: f.boss === null ? null : { ...f.boss },
  };
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
 * randInt(0, n − 1)（state.rng）で 1 つ選んで pos を書き換える（向きはそのまま。DG-46 の floorSteps は 0）→ 視野を explored に足す（markExplored）→ moved{pos, facing}。
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
  dive.floorSteps = 0; // DG-46（M18）: 転移で今の階の歩数を数え直す
  markExplored(dive, f, data.config.dungeon.viewDepth);
  ctx.events.push({ kind: "moved", pos: { x: to.x, y: to.y }, facing: dive.facing });
}
