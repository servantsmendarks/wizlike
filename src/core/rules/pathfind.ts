// DG-15: 地図のタップ移動（UI-25）の経路探索と、自動歩行を続けてよいかの判定。乱数は使わず、state を書き換えない。
// 経路は探索済みのセル（dive.explored）と、その実効の辺（floorOf）だけで探す。扉は通れる。
// 階段・罠・ボス・イベントのセルは特別扱いしない（踏めば core のイベントで止まる。routeStepOk が偽になる）。
import type { GameData } from "../data/index";
import type { Facing, Floor, GameEvent, GameState, Pos, RouteCommand, RouteStep } from "../types";
import { floorOf } from "./dungeon";
import { cellAt, edgeOf, idx, inBounds, isPassable, opposite, step, turnLeft, turnRight } from "./dungeon-gen";

/** 展開の順（同じ手数なら、この順に先に見つかった経路を採る） */
const MOVES: readonly { command: RouteCommand; next(p: Pos, d: Facing): { pos: Pos; facing: Facing } }[] = [
  { command: { type: "dungeon.move" }, next: (p, d) => ({ pos: step(p, d), facing: d }) },
  { command: { type: "dungeon.turn", dir: "left" }, next: (p, d) => ({ pos: p, facing: turnLeft(d) }) },
  { command: { type: "dungeon.turn", dir: "right" }, next: (p, d) => ({ pos: p, facing: turnRight(d) }) },
  { command: { type: "dungeon.turn", dir: "around" }, next: (p, d) => ({ pos: p, facing: opposite(d) }) },
];
const FACING_NO: Readonly<Record<Facing, number>> = { N: 0, E: 1, S: 2, W: 3 };

/**
 * DG-15 の本体（手組みの Floor でも確かめられるように Floor を直接取る）。
 * explored は探索済みのセルの添字。(x, y, 向き) を状態にした幅優先探索で、前進と旋回の手数の合計を最短にする。
 * target が現在位置なら []。target が盤の外・未探索、または探索済みのセルと辺だけでは届かなければ null。
 */
export function routeOnFloor(f: Floor, explored: readonly number[], pos: Pos, facing: Facing, target: Pos): RouteStep[] | null {
  if (!Number.isInteger(target.x) || !Number.isInteger(target.y) || !inBounds(f, target.x, target.y)) return null;
  const known: boolean[] = new Array<boolean>(f.width * f.height).fill(false);
  for (const i of explored) known[i] = true;
  if (!known[idx(f, target.x, target.y)]) return null;
  if (pos.x === target.x && pos.y === target.y) return [];
  const key = (p: Pos, d: Facing) => idx(f, p.x, p.y) * 4 + FACING_NO[d];
  // 状態ごとに、来た状態のキーと手（復元用）
  const from: (null | { prev: number; step: RouteStep })[] = new Array(f.width * f.height * 4).fill(null);
  const seen: boolean[] = new Array<boolean>(f.width * f.height * 4).fill(false);
  const queue: { pos: Pos; facing: Facing }[] = [{ pos, facing }];
  seen[key(pos, facing)] = true;
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head]!;
    const curKey = key(cur.pos, cur.facing);
    for (const m of MOVES) {
      if (m.command.type === "dungeon.move") {
        if (!isPassable(edgeOf(cellAt(f, cur.pos.x, cur.pos.y), cur.facing))) continue;
      }
      const n = m.next(cur.pos, cur.facing);
      if (!inBounds(f, n.pos.x, n.pos.y) || !known[idx(f, n.pos.x, n.pos.y)]) continue;
      const k = key(n.pos, n.facing);
      if (seen[k]) continue;
      seen[k] = true;
      from[k] = { prev: curKey, step: { command: m.command, pos: { x: n.pos.x, y: n.pos.y }, facing: n.facing } };
      if (n.pos.x === target.x && n.pos.y === target.y) {
        // 目標のセルに最初に着いた状態（向きは問わない）から手を復元する
        const out: RouteStep[] = [];
        let at = k;
        const startKey = key(pos, facing);
        while (at !== startKey) {
          const link = from[at]!;
          out.push({ command: { ...link.step.command }, pos: { ...link.step.pos }, facing: link.step.facing });
          at = link.prev;
        }
        return out.reverse();
      }
      queue.push(n);
    }
  }
  return null;
}

/**
 * DG-15 / UI-25。迷宮の戦闘外・保留なしのときだけ探す（それ以外は null）。
 * []   = target が現在位置
 * null = 上のとき以外に、盤の外 / target が未探索 / 探索済みのセルと辺だけでは届かない
 */
export function planRoute(state: GameState, data: GameData, target: Pos): RouteStep[] | null {
  const dive = state.dive;
  if (dive === null || state.battle !== null || state.pendingChoice !== null || state.screen !== "dungeon") return null;
  const f = floorOf(dive, data);
  return routeOnFloor(f, dive.explored[String(dive.floor)] ?? [], dive.pos, dive.facing, target);
}

/**
 * DG-15: 経路の 1 手を送った結果（events と、その後の state）で、自動歩行を続けてよいか。
 * 真になるのは次をすべて満たすときだけ:
 * - events から、move のときだけ先頭の message dungeon.door を 1 件除いた残りの [0] が、move なら moved、turn なら turned
 * - その後ろが hpChanged（毒の 1 歩）だけ
 * - after が迷宮（screen dungeon）で、戦闘なし・保留なし・dive あり
 * - dive の pos と facing が step の予定値と一致する
 * 遭遇・罠の語り・スピナー（向きが違う）・階段などの確認（pendingChoice）・壁（blocked）・rejected では偽。扉では止まらない。
 */
export function routeStepOk(step: RouteStep, events: readonly GameEvent[], after: GameState): boolean {
  const isMove = step.command.type === "dungeon.move";
  let rest = events;
  const first = rest[0];
  if (isMove && first !== undefined && first.kind === "message" && first.key === "dungeon.door") rest = rest.slice(1);
  const head = rest[0];
  if (head === undefined || head.kind !== (isMove ? "moved" : "turned")) return false;
  if (!rest.slice(1).every((e) => e.kind === "hpChanged")) return false;
  const dive = after.dive;
  if (after.screen !== "dungeon" || after.battle !== null || after.pendingChoice !== null || dive === null) return false;
  return dive.pos.x === step.pos.x && dive.pos.y === step.pos.y && dive.facing === step.facing;
}
