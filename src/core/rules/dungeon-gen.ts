// 迷宮の構造の生成（DG-02〜06, DG-20, DG-22）。RuleContext を取らない純粋関数で、state.rng には触れない。
// 階 n の乱数は createRng(floorSeed(diveSeed, n)) だけから作る（DG-03）。キャッシュもモジュールの状態も持たない。
//
// generateFloor の乱数の消費順（この順を変えると同じ diveSeed から別の迷宮になる。tests/dungeon-gen.test.ts の回帰値も落ちる）:
//   (1) 部屋: want = randInt(rmin, rmax) を 1 回。続いて「配置の回」を最大 roomAttempts 回くり返す。
//       1 回の配置では、部屋ごとに最大 roomAttempts 回、w, h, x, y を randInt で引く（盤に入らない寸法なら x, y は引かずに諦める）。
//       置けた部屋が rmin 以上になった回で確定する。どの回も rmin に届かなければ、いちばん多く置けた回（同数なら先の回）を使う。
//   (2) 迷路: 開始セル randInt(0, nonRoom-1) を 1 回、以後、未訪問の隣（候補）が 1 つ以上ある段ごとに randInt(0, cand-1) を 1 回（候補が 1 つでも引く）。
//   (3) 扉: 部屋の順に、本数 randInt(doorsPerRoom) を 1 回、部分 Fisher-Yates で randInt(i, cand-1) を本数分。
//   (4) 上り階段: 1 階だけ randInt(0, nonRoom-1) を 1 回（2 階以降は前の階の stairsDown の座標で、乱数を使わない）。
//   (5) 下り階段 / ボス: BFS 距離が最大のセルから randInt(0, far-1) を 1 回。
//   (6) イベントと罠: 候補の shuffleInPlace（i = len-1..1 で randInt(0, i)）、罠の個数 randInt(trapsPerFloor) を 1 回、
//       罠ごとに種類 randInt(0, traps-1)（traps が空なら引かない）。
import type { Config, DungeonDef } from "../data/index";
import { createRng, randInt, type RngState } from "../rng";
import type { Cell, Edge, Facing, Floor, Pos, Room } from "../types";

/** 時計回り。randInt(0,3) の添字と対応する */
export const FACINGS: readonly Facing[] = ["N", "E", "S", "W"];
export const DX: Readonly<Record<Facing, number>> = { N: 0, E: 1, S: 0, W: -1 };
export const DY: Readonly<Record<Facing, number>> = { N: -1, E: 0, S: 1, W: 0 };

export function opposite(d: Facing): Facing {
  switch (d) {
    case "N":
      return "S";
    case "E":
      return "W";
    case "S":
      return "N";
    case "W":
      return "E";
  }
}

/** N→W→S→E→N */
export function turnLeft(d: Facing): Facing {
  switch (d) {
    case "N":
      return "W";
    case "W":
      return "S";
    case "S":
      return "E";
    case "E":
      return "N";
  }
}

/** N→E→S→W→N */
export function turnRight(d: Facing): Facing {
  switch (d) {
    case "N":
      return "E";
    case "E":
      return "S";
    case "S":
      return "W";
    case "W":
      return "N";
  }
}

export function step(p: Pos, d: Facing): Pos {
  return { x: p.x + DX[d], y: p.y + DY[d] };
}

export function inBounds(f: Floor, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < f.width && y < f.height;
}

export function idx(f: Floor, x: number, y: number): number {
  return y * f.width + x;
}

/** 盤外は Error */
export function cellAt(f: Floor, x: number, y: number): Cell {
  if (!inBounds(f, x, y)) throw new Error(`cellAt: out of bounds: ${x},${y}`);
  const c = f.cells[idx(f, x, y)];
  if (c === undefined) throw new Error(`cellAt: missing cell: ${x},${y}`);
  return c;
}

export function edgeOf(c: Cell, d: Facing): Edge {
  switch (d) {
    case "N":
      return c.n;
    case "E":
      return c.e;
    case "S":
      return c.s;
    case "W":
      return c.w;
  }
}

function writeEdge(c: Cell, d: Facing, e: Edge): void {
  switch (d) {
    case "N":
      c.n = e;
      return;
    case "E":
      c.e = e;
      return;
    case "S":
      c.s = e;
      return;
    case "W":
      c.w = e;
      return;
  }
}

/** 自分の辺と、盤内なら隣の逆辺を同時に書く（辺の唯一の書き込み口。DG-04） */
export function setEdge(f: Floor, x: number, y: number, d: Facing, e: Edge): void {
  writeEdge(cellAt(f, x, y), d, e);
  const nx = x + DX[d];
  const ny = y + DY[d];
  if (inBounds(f, nx, ny)) writeEdge(cellAt(f, nx, ny), opposite(d), e);
}

/** open と door は通れる */
export function isPassable(e: Edge): boolean {
  return e === "open" || e === "door";
}

/** DG-03: 階ごとの乱数のシード。0..2^32-1 の整数 */
export function floorSeed(diveSeed: number, floor: number): number {
  return (diveSeed ^ Math.imul(floor, 0x9e3779b9)) >>> 0;
}

/** 通れる辺だけの BFS。未到達は -1。長さ width*height */
export function distancesFrom(f: Floor, start: Pos): number[] {
  const n = f.width * f.height;
  const dist: number[] = new Array<number>(n).fill(-1);
  const s = idx(f, start.x, start.y);
  dist[s] = 0;
  const queue: number[] = [s];
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi]!;
    const x = cur % f.width;
    const y = (cur - x) / f.width;
    const c = cellAt(f, x, y);
    const dc = dist[cur]!;
    for (const d of FACINGS) {
      if (!isPassable(edgeOf(c, d))) continue;
      const nx = x + DX[d];
      const ny = y + DY[d];
      if (!inBounds(f, nx, ny)) continue;
      const ni = idx(f, nx, ny);
      if (dist[ni] !== -1) continue;
      dist[ni] = dc + 1;
      queue.push(ni);
    }
  }
  return dist;
}

/** 部屋の外（roomId === null）で、通れる辺がちょうど 1 本 */
export function isDeadEnd(f: Floor, x: number, y: number): boolean {
  const c = cellAt(f, x, y);
  if (c.roomId !== null) return false;
  let k = 0;
  for (const d of FACINGS) if (isPassable(edgeOf(c, d))) k += 1;
  return k === 1;
}

/** DG-04 の不整合（隣の逆辺と違う、外周の辺が wall でない）を列挙する。空なら正常 */
export function checkEdges(f: Floor): string[] {
  const out: string[] = [];
  if (f.cells.length !== f.width * f.height) out.push(`cells.length ${f.cells.length} != ${f.width * f.height}`);
  for (let y = 0; y < f.height; y++) {
    for (let x = 0; x < f.width; x++) {
      const c = cellAt(f, x, y);
      for (const d of FACINGS) {
        const e = edgeOf(c, d);
        const nx = x + DX[d];
        const ny = y + DY[d];
        if (!inBounds(f, nx, ny)) {
          if (e !== "wall") out.push(`${x},${y} ${d}: outer edge is ${e}`);
          continue;
        }
        const o = edgeOf(cellAt(f, nx, ny), opposite(d));
        if (o !== e) out.push(`${x},${y} ${d}: ${e} vs neighbour ${o}`);
      }
    }
  }
  return out;
}

/** Fisher-Yates: i = len-1..1、j = randInt(0, i) */
function shuffleInPlace<T>(rng: RngState, a: T[]): void {
  for (let i = a.length - 1; i >= 1; i--) {
    const j = randInt(rng, 0, i);
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  }
}

/** 1 回分の配置。部屋の矩形だけを返し、セルには書かない */
function placeRoomsOnce(rng: RngState, W: number, H: number, want: number, cfg: Config["dungeon"]): Room[] {
  const [smin, smax] = cfg.roomSize;
  const rooms: Room[] = [];
  for (let r = 0; r < want; r++) {
    for (let t = 0; t < cfg.roomAttempts; t++) {
      const w = randInt(rng, smin, smax);
      const h = randInt(rng, smin, smax);
      if (W - 2 < w || H - 2 < h) break; // 盤に入らない寸法。この部屋は諦める
      const x = randInt(rng, 1, W - 1 - w);
      const y = randInt(rng, 1, H - 1 - h);
      // 外周から 1 セル空け、既存の部屋とは 8 近傍で接しない
      const clash = rooms.some((R) => x < R.x + R.w + 1 && R.x < x + w + 1 && y < R.y + R.h + 1 && R.y < y + h + 1);
      if (clash) continue;
      rooms.push({ x, y, w, h });
      break;
    }
  }
  return rooms;
}

/** (1) 部屋（DG-05）。rmin に届くまで配置をやり直す（最大 roomAttempts 回）。届かなければ最多の回を使う */
function placeRooms(f: Floor, rng: RngState, rmin: number, rmax: number, cfg: Config["dungeon"]): void {
  const want = randInt(rng, rmin, rmax);
  let best: Room[] = [];
  for (let pass = 0; pass < cfg.roomAttempts; pass++) {
    const rooms = placeRoomsOnce(rng, f.width, f.height, want, cfg);
    if (rooms.length > best.length) best = rooms;
    if (rooms.length >= rmin) break;
  }
  best.forEach((R, id) => {
    f.rooms.push(R);
    for (let y = R.y; y < R.y + R.h; y++) {
      for (let x = R.x; x < R.x + R.w; x++) {
        const c = cellAt(f, x, y);
        c.kind = "room";
        c.roomId = id;
        if (x + 1 < R.x + R.w) setEdge(f, x, y, "E", "open");
        if (y + 1 < R.y + R.h) setEdge(f, x, y, "S", "open");
      }
    }
  });
}

/** (2) 迷路。再帰的バックトラックを明示スタックで反復する */
function carveMaze(f: Floor, rng: RngState, nonRoom: number[]): void {
  if (nonRoom.length === 0) throw new Error("carveMaze: no corridor cell");
  const visited: boolean[] = new Array<boolean>(f.cells.length).fill(false);
  const start = nonRoom[randInt(rng, 0, nonRoom.length - 1)]!;
  visited[start] = true;
  let count = 1;
  const stack: number[] = [start];
  while (stack.length > 0) {
    const cur = stack[stack.length - 1]!;
    const x = cur % f.width;
    const y = (cur - x) / f.width;
    const cand: Facing[] = [];
    for (const d of FACINGS) {
      const nx = x + DX[d];
      const ny = y + DY[d];
      if (!inBounds(f, nx, ny)) continue;
      const ni = idx(f, nx, ny);
      if (visited[ni] === true || cellAt(f, nx, ny).roomId !== null) continue;
      cand.push(d);
    }
    if (cand.length === 0) {
      stack.pop();
      continue;
    }
    const d = cand[randInt(rng, 0, cand.length - 1)]!;
    setEdge(f, x, y, d, "open");
    const ni = idx(f, x + DX[d], y + DY[d]);
    visited[ni] = true;
    count += 1;
    stack.push(ni);
  }
  if (count !== nonRoom.length) throw new Error(`carveMaze: corridor is not connected (${count}/${nonRoom.length})`);
}

type EdgeRef = { x: number; y: number; d: Facing };

/** (3) 扉。部屋の外周の外向きの辺のうち、隣が部屋でないものから選ぶ */
function placeDoors(f: Floor, rng: RngState, cfg: Config["dungeon"]): void {
  for (const R of f.rooms) {
    const cand: EdgeRef[] = [];
    const push = (x: number, y: number, d: Facing): void => {
      const nx = x + DX[d];
      const ny = y + DY[d];
      if (inBounds(f, nx, ny) && cellAt(f, nx, ny).roomId === null) cand.push({ x, y, d });
    };
    for (let x = R.x; x < R.x + R.w; x++) push(x, R.y, "N"); // 上辺 左→右
    for (let y = R.y; y < R.y + R.h; y++) push(R.x + R.w - 1, y, "E"); // 右辺 上→下
    for (let x = R.x; x < R.x + R.w; x++) push(x, R.y + R.h - 1, "S"); // 下辺 左→右
    for (let y = R.y; y < R.y + R.h; y++) push(R.x, y, "W"); // 左辺 上→下
    const k = Math.min(randInt(rng, cfg.doorsPerRoom[0], cfg.doorsPerRoom[1]), cand.length);
    for (let i = 0; i < k; i++) {
      const j = randInt(rng, i, cand.length - 1);
      const t = cand[i]!;
      const door = cand[j]!;
      cand[i] = door;
      cand[j] = t;
      setEdge(f, door.x, door.y, door.d, "door");
    }
  }
}

function posOf(f: Floor, i: number): Pos {
  const x = i % f.width;
  return { x, y: (i - x) / f.width };
}

/** 1 階分を生成する。upPos は 2 階以降の上り階段の座標（前の階の stairsDown。DG-06）、1 階は null */
export function generateFloor(def: DungeonDef, cfg: Config["dungeon"], diveSeed: number, floor: number, upPos: Pos | null): Floor {
  const rng = createRng(floorSeed(diveSeed, floor));
  const W = def.width;
  const H = def.height;
  if (!Number.isInteger(W) || !Number.isInteger(H) || W < 5 || H < 5) throw new Error(`generateFloor: board too small: ${W}x${H}`);
  if (!Number.isInteger(floor) || floor < 1 || floor > def.floors) throw new Error(`generateFloor: bad floor ${floor}`);
  const cells: Cell[] = [];
  for (let i = 0; i < W * H; i++) {
    cells.push({ kind: "corridor", n: "wall", e: "wall", s: "wall", w: "wall", roomId: null, eventId: null, trapId: null });
  }
  const f: Floor = { floor, width: W, height: H, cells, rooms: [], stairsUp: { x: 0, y: 0 }, stairsDown: null, boss: null };
  const [rmin, rmax] = def.rooms ?? cfg.defaultRooms;

  // (1) 部屋
  placeRooms(f, rng, rmin, rmax, cfg);

  // (2) 迷路
  const nonRoom: number[] = [];
  cells.forEach((c, i) => {
    if (c.roomId === null) nonRoom.push(i);
  });
  carveMaze(f, rng, nonRoom);

  // (3) 扉
  placeDoors(f, rng, cfg);

  // (4) 上り階段（DG-05, DG-06）
  const up: Pos = upPos === null ? posOf(f, nonRoom[randInt(rng, 0, nonRoom.length - 1)]!) : { x: upPos.x, y: upPos.y };
  cellAt(f, up.x, up.y).kind = "stairsUp";
  f.stairsUp = up;

  // (5) 下り階段 / ボス
  const dist = distancesFrom(f, up);
  if (dist.includes(-1)) throw new Error("generateFloor: unreachable cell");
  let maxD = 0;
  for (const d of dist) if (d > maxD) maxD = d;
  const far: number[] = [];
  dist.forEach((d, i) => {
    if (d === maxD) far.push(i);
  });
  const p = posOf(f, far[randInt(rng, 0, far.length - 1)]!);
  if (floor === def.floors) {
    cellAt(f, p.x, p.y).kind = "boss";
    f.boss = p;
  } else {
    cellAt(f, p.x, p.y).kind = "stairsDown";
    f.stairsDown = p;
  }

  // (6) イベントと罠（DG-05, DG-20, DG-22）
  const cand: Cell[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = cellAt(f, x, y);
      if ((c.kind === "corridor" || c.kind === "room") && (c.roomId !== null || isDeadEnd(f, x, y))) cand.push(c);
    }
  }
  shuffleInPlace(rng, cand);
  // 潜行全体で各イベント 1 回。i 番目を (i mod floors)+1 階に置く（乱数を使わない割り振り）
  const myEvents = def.events.filter((_, i) => (i % def.floors) + 1 === floor);
  for (const ev of myEvents) {
    const c = cand.shift();
    if (c === undefined) break;
    c.kind = "event";
    c.eventId = ev;
  }
  const nTraps = randInt(rng, def.trapsPerFloor[0], def.trapsPerFloor[1]);
  for (let i = 0; i < nTraps; i++) {
    if (def.traps.length === 0) break;
    const t = def.traps[randInt(rng, 0, def.traps.length - 1)]!;
    const c = cand.shift();
    if (c === undefined) break;
    c.kind = "trap";
    c.trapId = t;
  }

  const bad = checkEdges(f);
  if (bad.length > 0) throw new Error(`generateFloor: inconsistent edges: ${bad.slice(0, 5).join("; ")}`);
  return f;
}

/** 1..floors を順に生成する。階 n の upPos は階 n-1 の stairsDown */
export function generateDive(def: DungeonDef, cfg: Config["dungeon"], diveSeed: number): Floor[] {
  const out: Floor[] = [];
  let up: Pos | null = null;
  for (let n = 1; n <= def.floors; n++) {
    const f = generateFloor(def, cfg, diveSeed, n, up);
    out.push(f);
    up = f.stairsDown;
  }
  return out;
}
