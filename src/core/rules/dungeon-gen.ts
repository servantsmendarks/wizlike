// 迷宮の構造の生成（DG-02〜06, DG-20, DG-22, DG-23）。RuleContext を取らない純粋関数で、state.rng には触れない。
// 階 n の乱数は createRng(floorSeed(diveSeed, n)) だけから作る（DG-03）。キャッシュもモジュールの状態も持たない。
//
// generateFloor の乱数の消費順（この順を変えると同じ diveSeed から別の迷宮になる。tests/dungeon-gen.test.ts の回帰値も落ちる）:
//   (1) 部屋: want = randInt(rmin, rmax) を 1 回。続いて「配置の回」を最大 roomAttempts 回くり返す。
//       1 回の配置では、部屋ごとに最大 roomAttempts 回、w, h, x, y を randInt で引く（盤に入らない寸法なら x, y は引かずに諦める）。
//       置けた部屋が rmin 以上になった回で確定する。どの回も rmin に届かなければ、いちばん多く置けた回（同数なら先の回）を使う。
//   (2) 迷路: 開始セル randInt(0, nonRoom-1) を 1 回。以後、未訪問の隣（候補）が 1 つ以上ある段ごとに:
//       直進（このセルに入ってきた向き）が候補にあれば nextFloat を 1 回引き、straightBias 未満なら直進（それ以上は引かない）。
//       直進が候補に無いか、nextFloat が straightBias 以上なら、randInt(0, cand-1) を 1 回（候補が 1 つでも引く。直進も候補に含む）。
//   (3) 扉: 部屋の順に、本数 randInt(doorsPerRoom) を 1 回、部分 Fisher-Yates で randInt(i, cand-1) を本数分。
//   (4) ループ化: 割合 randInt(round(braidRatio[0]*100), round(braidRatio[1]*100)) を 1 回（整数パーセント）。
//       行き止まり（扉の後の時点。添字の昇順）の shuffleInPlace、続いて先頭から、まだ行き止まりのものごとに
//       抜く壁 randInt(0, cand-1) を 1 回（cand は隣が盤内の非部屋セルの wall の辺。N→E→S→W の順）。round(行き止まり数 × 割合 / 100) 本抜いたら止める。
//   (5) 上り階段: 1 階だけ randInt(0, n-1) を 1 回（n は部屋の外の床のセル数。M21 から岩を除く。2 階以降は前の階の stairsDown の座標で、乱数を使わない）。
//   (6) 下り階段 / ボス: BFS 距離が最大のセルから randInt(0, far-1) を 1 回。
//   (7) イベントと罠: 候補の shuffleInPlace（i = len-1..1 で randInt(0, i)）、罠の個数 randInt(trapsPerFloor) を 1 回、
//       罠ごとに種類 randInt(0, traps-1)（traps が空なら引かない）。
//   (8) 宝箱のセル（DG-23。M11）: 個数 randInt(chestsPerFloor) を 1 回（[0,0] でも引く）、(7) の残りの候補の先頭から置く箱ごとに
//       drawChestTrap（chance(noTrapChance) →（罠ありなら）weightedIndex(危険度の重み) → randInt(その危険度の罠)。CB-61 と同じ順）。
//       候補が尽きたら、その分は置かず罠も引かない。(7) までの消費は変えない（既存の回帰値はそのまま）。
// (4) と (5) の間に DG-48（M21）の充填率の間引き（cullToFill）を挟む。乱数は引かない（(1)〜(4) の消費は fillRatio によらず同じ）。
//   (5) の 1 階の上り階段は、間引いた後の部屋の外の床から選ぶ（fillRatio 1 なら間引かないので M20 までと同じ盤）。
import type { Config, DungeonDef } from "../data/index";
import { chance, createRng, nextFloat, randInt, weightedIndex, type RngState } from "../rng";
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

/**
 * (2) 迷路。再帰的バックトラックを明示スタックで反復する。
 * straightBias（0..1）: 入ってきた向きに進める（未訪問の非部屋セルがある）とき、その確率で直進する（DG-05【仮】）
 */
function carveMaze(f: Floor, rng: RngState, nonRoom: number[], straightBias: number): void {
  if (nonRoom.length === 0) throw new Error("carveMaze: no corridor cell");
  const visited: boolean[] = new Array<boolean>(f.cells.length).fill(false);
  /** そのセルに入ってきた向き（開始セルは null） */
  const inDir: (Facing | null)[] = new Array<Facing | null>(f.cells.length).fill(null);
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
    const straight = inDir[cur] ?? null;
    const d = straight !== null && cand.includes(straight) && nextFloat(rng) < straightBias ? straight : cand[randInt(rng, 0, cand.length - 1)]!;
    setEdge(f, x, y, d, "open");
    const ni = idx(f, x + DX[d], y + DY[d]);
    visited[ni] = true;
    inDir[ni] = d;
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

/**
 * (4) ループ化（DG-05【仮】）。行き止まりのうち braidRatio の範囲で引いた割合を、隣の非部屋セルへの壁を抜いてループにする。
 * 部屋への壁は抜かない（扉の本数 doorsPerRoom を保つ）。抜いた本数を返す。
 * 行き止まりは非部屋セルなので、盤内の非部屋の隣が 2 つ以上あり（部屋は外周から 1 セル離れ、互いに 8 近傍で接しない）、
 * 通れる辺は 1 本だけなので、抜ける壁は必ずある。1 本抜くと行き止まりは高々 2 つ減るので、割合が 1/2 以下なら必ず目標の本数に届く。
 */
function braid(f: Floor, rng: RngState, cfg: Config["dungeon"]): number {
  const pct = randInt(rng, Math.round(cfg.braidRatio[0] * 100), Math.round(cfg.braidRatio[1] * 100));
  const deadEnds: number[] = [];
  for (let i = 0; i < f.cells.length; i++) {
    const p = posOf(f, i);
    if (isDeadEnd(f, p.x, p.y)) deadEnds.push(i);
  }
  shuffleInPlace(rng, deadEnds);
  const want = Math.round((deadEnds.length * pct) / 100);
  let done = 0;
  for (const i of deadEnds) {
    if (done >= want) break;
    const p = posOf(f, i);
    if (!isDeadEnd(f, p.x, p.y)) continue; // 先に抜いた壁で行き止まりでなくなった
    const c = cellAt(f, p.x, p.y);
    const cand = FACINGS.filter((d) => {
      const nx = p.x + DX[d];
      const ny = p.y + DY[d];
      return edgeOf(c, d) === "wall" && inBounds(f, nx, ny) && cellAt(f, nx, ny).roomId === null;
    });
    if (cand.length === 0) continue;
    const d = cand[randInt(rng, 0, cand.length - 1)]!;
    setEdge(f, p.x, p.y, d, "open");
    done += 1;
  }
  return done;
}

/**
 * DG-48（M21）: 充填率の間引き。乱数を引かない決まった手順で床（岩でないセル）を減らし、floor(fillRatio × 盤のセル数) 以下になったら止める。
 * (a) 行き止まりの通路のセル（部屋の外で通れる辺が 1 本、どの辺も door でない。keep の座標は除く）を、1 回ごとに添字の昇順（行優先）に集め、
 *     先頭から 1 つずつ（まだ行き止まりなら）岩（kind rock、4 辺 wall）にする。新しくできた行き止まりは次の回で拾う。
 * (b) 行き止まりが尽きても届かなければ、ループを 1 本閉じる: 通路のセルどうしの open の辺（橋でない = 閉じても連結が保たれる）を、
 *     セルの添字の昇順・E→S の順に見て、閉じると端のどちらかが (a) で間引けるようになる最初の辺を wall にする（無ければ最初の橋でない辺）。
 *     閉じたら (a) に戻る。閉じられる辺も尽きたら届かなくても止める（Error にしない）。
 * 行き止まりを除いても橋でない辺を閉じても、残りの床の連結は保たれる。岩にした数を返す
 */
export function cullToFill(f: Floor, fillRatio: number, keep: Pos | null): number {
  const target = Math.floor(fillRatio * f.width * f.height);
  let floorCount = f.cells.filter((c) => c.kind !== "rock").length;
  const keepIdx = keep === null ? -1 : idx(f, keep.x, keep.y);
  const noDoor = (c: Cell): boolean => FACINGS.every((d) => edgeOf(c, d) !== "door");
  const cullable = (i: number): boolean => {
    if (i === keepIdx) return false;
    const p = posOf(f, i);
    const c = cellAt(f, p.x, p.y);
    if (c.kind === "rock" || !isDeadEnd(f, p.x, p.y)) return false;
    return noDoor(c);
  };
  let culled = 0;
  while (floorCount > target) {
    const list: number[] = [];
    for (let i = 0; i < f.cells.length; i++) if (cullable(i)) list.push(i);
    if (list.length > 0) {
      for (const i of list) {
        if (floorCount <= target) break;
        if (!cullable(i)) continue;
        const p = posOf(f, i);
        const c = cellAt(f, p.x, p.y);
        for (const d of FACINGS) if (edgeOf(c, d) !== "wall") setEdge(f, p.x, p.y, d, "wall");
        c.kind = "rock";
        floorCount -= 1;
        culled += 1;
      }
      continue;
    }
    // (b) ループを 1 本閉じる
    const bridges = bridgesOf(f);
    /** 閉じたあと (a) で間引けるようになる端か（通れる辺がちょうど 2 本で、door が無く、keep でない通路のセル） */
    const opens = (i: number): boolean => {
      if (i === keepIdx) return false;
      const c = f.cells[i]!;
      return c.roomId === null && noDoor(c) && FACINGS.filter((d) => isPassable(edgeOf(c, d))).length === 2;
    };
    let pick: EdgeRef | null = null;
    let fallback: EdgeRef | null = null;
    for (let i = 0; i < f.cells.length && pick === null; i++) {
      const p = posOf(f, i);
      const c = f.cells[i]!;
      if (c.roomId !== null || c.kind === "rock") continue;
      for (const d of ["E", "S"] as const) {
        if (edgeOf(c, d) !== "open") continue;
        const nx = p.x + DX[d];
        const ny = p.y + DY[d];
        if (!inBounds(f, nx, ny)) continue;
        const ni = idx(f, nx, ny);
        if (f.cells[ni]!.roomId !== null || bridges.has(i * 4 + FACINGS.indexOf(d))) continue;
        fallback ??= { x: p.x, y: p.y, d };
        if (opens(i) || opens(ni)) {
          pick = { x: p.x, y: p.y, d };
          break;
        }
      }
    }
    const e = pick ?? fallback;
    if (e === null) break;
    setEdge(f, e.x, e.y, e.d, "wall");
  }
  return culled;
}

/**
 * DG-48: 通れる辺（open / door）の橋（閉じると床が 2 つに分かれる辺）。キーは「セルの添字 × 4 + FACINGS の添字」で、両側の向きを入れる。
 * 岩のセルは辺がすべて wall なので自然に外れる。再帰を使わない Tarjan の lowlink
 */
function bridgesOf(f: Floor): Set<number> {
  const n = f.cells.length;
  const order: number[] = new Array<number>(n).fill(-1);
  const low: number[] = new Array<number>(n).fill(0);
  const out = new Set<number>();
  let t = 0;
  for (let s = 0; s < n; s++) {
    if (order[s] !== -1 || f.cells[s]!.kind === "rock") continue;
    // スタックの要素: [セル, 来た辺の向きの添字（根は -1）, 次に見る向きの添字]
    const stack: [number, number, number][] = [[s, -1, 0]];
    order[s] = low[s] = t++;
    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      const [v, fromDir] = top;
      if (top[2] < 4) {
        const di = top[2]++;
        const d = FACINGS[di]!;
        const p = posOf(f, v);
        if (!isPassable(edgeOf(f.cells[v]!, d))) continue;
        const nx = p.x + DX[d];
        const ny = p.y + DY[d];
        if (!inBounds(f, nx, ny)) continue;
        if (fromDir !== -1 && di === (fromDir + 2) % 4) continue; // 来た辺は戻らない（2 セルの間の辺は 1 本だけ）
        const w = idx(f, nx, ny);
        if (order[w] === -1) {
          order[w] = low[w] = t++;
          stack.push([w, di, 0]);
        } else {
          low[v] = Math.min(low[v]!, order[w]!);
        }
        continue;
      }
      stack.pop();
      if (fromDir === -1) continue;
      const parent = idx(f, posOf(f, v).x - DX[FACINGS[fromDir]!], posOf(f, v).y - DY[FACINGS[fromDir]!]);
      low[parent] = Math.min(low[parent]!, low[v]!);
      if (low[v]! > order[parent]!) {
        out.add(parent * 4 + fromDir);
        out.add(v * 4 + ((fromDir + 2) % 4));
      }
    }
  }
  return out;
}

function posOf(f: Floor, i: number): Pos {
  const x = i % f.width;
  return { x, y: (i - x) / f.width };
}

/**
 * DG-23 / CB-61（M11）: 宝箱の罠の抽選の材料。組み立ては floor.ts の chestGenOf(data, dungeonId) の 1 か所。
 * - noTrapChance: config.chest.noTrapChance
 * - weights: dungeons[].chestTrapDangerWeights（危険度 1..4。上限より上の段は 0）
 * - trapsByDanger: 危険度 d の罠の id（chest-traps.json のデータの順）を [d − 1] に
 */
export type ChestGen = { noTrapChance: number; weights: readonly number[]; trapsByDanger: readonly (readonly string[])[] };

/**
 * CB-61: 宝箱の罠の抽選（ドロップの箱は state.rng、宝箱のセルは階の rng）。chance(noTrapChance) が当たれば罠なし（危険度 0）。
 * 外れたら weightedIndex(weights) で危険度、その危険度の罠から randInt で 1 つ
 */
export function drawChestTrap(rng: RngState, gen: ChestGen): { trapId: string | null; danger: number } {
  if (chance(rng, gen.noTrapChance)) return { trapId: null, danger: 0 };
  const di = weightedIndex(rng, gen.weights);
  const list = gen.trapsByDanger[di] ?? [];
  if (list.length === 0) throw new Error(`drawChestTrap: no trap of danger ${di + 1}`);
  return { trapId: list[randInt(rng, 0, list.length - 1)]!, danger: di + 1 };
}

/**
 * 1 階分を生成する。upPos は 2 階以降の上り階段の座標（前の階の stairsDown。DG-06）、1 階は null。
 * chestGen は宝箱のセルの罠の抽選の材料（DG-23。個数は def.chestsPerFloor）
 */
export function generateFloor(
  def: DungeonDef,
  cfg: Config["dungeon"],
  diveSeed: number,
  floor: number,
  upPos: Pos | null,
  chestGen: ChestGen,
): Floor {
  const rng = createRng(floorSeed(diveSeed, floor));
  const W = def.width;
  const H = def.height;
  if (!Number.isInteger(W) || !Number.isInteger(H) || W < 5 || H < 5) throw new Error(`generateFloor: board too small: ${W}x${H}`);
  if (!Number.isInteger(floor) || floor < 1 || floor > def.floors) throw new Error(`generateFloor: bad floor ${floor}`);
  const cells: Cell[] = [];
  for (let i = 0; i < W * H; i++) {
    cells.push({ kind: "corridor", n: "wall", e: "wall", s: "wall", w: "wall", roomId: null, eventId: null, trapId: null, chestTrapId: null });
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
  carveMaze(f, rng, nonRoom, cfg.straightBias);

  // (3) 扉
  placeDoors(f, rng, cfg);

  // (4) ループ化
  braid(f, rng, cfg);

  // (4b) 充填率（DG-48。M21）。乱数を引かない。2 階以降の上り階段の座標（前の階の下り階段）は岩にしない
  cullToFill(f, def.fillRatio, upPos);

  // (5) 上り階段（DG-05, DG-06）。1 階は部屋の外の床（岩でない）から
  const openNonRoom = nonRoom.filter((i) => cells[i]!.kind !== "rock");
  const up: Pos = upPos === null ? posOf(f, openNonRoom[randInt(rng, 0, openNonRoom.length - 1)]!) : { x: upPos.x, y: upPos.y };
  cellAt(f, up.x, up.y).kind = "stairsUp";
  f.stairsUp = up;

  // (6) 下り階段 / ボス
  const dist = distancesFrom(f, up);
  // DG-05 / DG-48: 床（岩でない）のセルはすべて上り階段から届く
  if (dist.some((d, i) => d < 0 && cells[i]!.kind !== "rock")) throw new Error("generateFloor: unreachable cell");
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

  // (7) イベントと罠（DG-05, DG-20, DG-22）
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
    // DG-22 は各イベント 1 回を定めるので、置けなければ Error（実データの盤〔d01 16×16・d02 / d03 20×20〕では起きない。DG-05）
    if (c === undefined) throw new Error(`generateFloor: no cell for event ${ev} on floor ${floor}`);
    c.kind = "event";
    c.eventId = ev;
  }
  const nTraps = randInt(rng, def.trapsPerFloor[0], def.trapsPerFloor[1]);
  for (let i = 0; i < nTraps; i++) {
    if (def.traps.length === 0) break;
    const t = def.traps[randInt(rng, 0, def.traps.length - 1)]!;
    const c = cand.shift();
    if (c === undefined) break; // 候補が尽きた分の罠は置かない（小さな盤。DG-05）
    c.kind = "trap";
    c.trapId = t;
  }

  // (8) 宝箱のセル（DG-23。M11）。ボスの階も対象。候補が尽きた分は置かない（罠も引かない）
  const nChests = randInt(rng, def.chestsPerFloor[0], def.chestsPerFloor[1]);
  for (let i = 0; i < nChests; i++) {
    const c = cand.shift();
    if (c === undefined) break;
    c.kind = "chest";
    c.chestTrapId = drawChestTrap(rng, chestGen).trapId;
  }

  const bad = checkEdges(f);
  if (bad.length > 0) throw new Error(`generateFloor: inconsistent edges: ${bad.slice(0, 5).join("; ")}`);
  return f;
}

/** 1..floors を順に生成する。階 n の upPos は階 n-1 の stairsDown */
export function generateDive(def: DungeonDef, cfg: Config["dungeon"], diveSeed: number, chestGen: ChestGen): Floor[] {
  const out: Floor[] = [];
  let up: Pos | null = null;
  for (let n = 1; n <= def.floors; n++) {
    const f = generateFloor(def, cfg, diveSeed, n, up, chestGen);
    out.push(f);
    up = f.stairsDown;
  }
  return out;
}
