// 迷宮のテスト用の共通部品（dungeon.test.ts から移した。events.test.ts などからも使う）。
import type { GameData } from "../../src/core/data/index";
import { execute } from "../../src/core/engine";
import { createRng } from "../../src/core/rng";
import { cellAt, edgeOf, FACINGS, inBounds, opposite, step } from "../../src/core/rules/dungeon-gen";
import { floorOf } from "../../src/core/rules/dungeon";
import { cloneState } from "../../src/core/state";
import type { Cell, Command, Edge, Facing, Floor, GameState, Pos } from "../../src/core/types";
import { data, expectKnownStringKeys, loadFreshData, newGame } from "./core";

export const MOVE: Command = { type: "dungeon.move" };
export const ENTER_D01: Command = { type: "dungeon.enter", dungeonId: "d01" };

/** execute して、events の message / dice のキーが strings に実在することを確かめる */
export function run(state: GameState, cmd: Command, d: GameData = data) {
  const r = execute(state, cmd, d);
  expectKnownStringKeys(r.events, d);
  return r;
}

/** newGame(seed) に dungeon.enter d01 を実行したもの */
export function enterD01(seed: number): GameState {
  const r = execute(newGame(seed), ENTER_D01, data);
  if (r.events[0]?.kind === "rejected") throw new Error(JSON.stringify(r.events));
  return r.state;
}

/** cloneState して dive の位置・向き（と階）を書き換えたもの */
export function placeAt(state: GameState, pos: Pos, facing: Facing, floor?: number): GameState {
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
export function dataWithRate(room: number, corridor: number): GameData {
  const d = loadFreshData();
  for (const def of d.dungeons) def.encounterRate = { room, corridor };
  return d;
}

/** state の rng を createRng(k) に替えた複製（状況を固定して出目だけを振る） */
export function withRng(state: GameState, k: number): GameState {
  const s = cloneState(state);
  s.rng = createRng(k);
  return s;
}

export type Approach = { pos: Pos; facing: Facing; target: Pos };

/** pred を満たすセルへ、edge が ok な辺を通って 1 歩で入れる立ち位置の一覧 */
export function approaches(
  f: Floor,
  pred: (c: Cell, x: number, y: number) => boolean,
  ok: (e: Edge) => boolean = (e) => e === "open",
): Approach[] {
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
export function findSituation(
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
