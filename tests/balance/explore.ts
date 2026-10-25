// M25 計測の道具: 探索ボット（各階の「降り口を見つけるまでの歩数」と「未踏の口の数」を、プレイヤーが知りうることだけで歩いて測る）。
// 入口は tests/balance/explore.sim.ts（npm run balance）と tests/explore-bot.test.ts。scratch のスクリプトから import して変形の比較にも使う。
// vitest にも環境変数にも依存しない（import するのは src/core の関数と型だけ）。ゲームの規則・乱数・データは変えない
// （generateDive で今の潜行と同じ盤を作り、その上を純粋関数だけで歩く。execute は通さない）。
//
// 知識の決まり（M25 計画 §4。いちばん大事）:
// - 判断に使ってよいのは、自分の位置と向き、explored（見たマスの集合）、explored のマスの中身（kind・辺）だけ。
// - 盤の全体（Floor）を読むのは sight() だけ。visibleCellsOf（DG-12）で見えたマスを explored に足し（core の markExplored と同じ規則。DG-13）、
//   そのマスの中身を Known.fog に写す。判断の関数（goal の判定・未踏の口・nearest / random の選択・経路）は Known しか受け取らない。
//   Known.fog は未探索のマスを FOG（岩・4 辺 wall）にした盤で、未探索のマスの中身は入っていない。
// - 「見つけた」は explored のマスの kind で決める（座標の比較で近道しない。DG-46 / UI-78 の「見えただけで見つけた」）。
// - 盤の形の統計（boardStats）と探索率の分母は全知だが、集計だけに使い、歩きの判断には渡さない。
// 扱わないもの: 罠・遭遇・宝箱・イベント（revealFloor / revealStairs）・転移・方角の一言（盤を歩くだけ）。
import type { Config, DungeonDef, GameData } from "../../src/core/data/index";
import { cellAt, distancesFrom, edgeOf, FACINGS, generateDive, idx, inBounds, isDeadEnd, isPassable, opposite, step, turnLeft, turnRight } from "../../src/core/rules/dungeon-gen";
import { chestGenOf, visibleCellsOf } from "../../src/core/rules/floor";
import { routeOnFloor } from "../../src/core/rules/pathfind";
import { createRng, randInt, type RngState } from "../../src/core/rng";
import type { Cell, Facing, Floor, Pos, RouteStep } from "../../src/core/types";

/** nearest: 自分のマスから explored を通る BFS で最初に見つかる口。random: 全部の口から一様に 1 つ（道具の側の乱数） */
export type Policy = "nearest" | "random";
export const POLICIES: readonly Policy[] = ["nearest", "random"];
/** 1 階あたりの手（前進 + 旋回）の上限。超えたら失敗として数える（例外にしない） */
export const ACTION_CAP = 5000;

/** 探しているもの。最下層はボスのマス、それ以外は下り階段（階の数はプレイヤーが知っている） */
export type GoalKind = "stairsDown" | "boss";

/** 未踏の口: explored のマス pos の向き d の辺が通れて（open か door）、隣が盤内で explored に無い（mapView の exits と同じ規則。UI-78） */
export type Exit = { pos: Pos; d: Facing };

/**
 * プレイヤーの知識。fog は explored のマスだけ中身を写した盤（未探索は FOG）。判断の関数はこれだけを読む。
 * exits は未踏の口の数（マスを足すたびに差分で更新する）、goal は explored の中で最初に見えた goalKind のマス。
 */
export type Known = {
  readonly fog: Floor;
  readonly explored: Set<number>;
  /** explored と同じ集合（足した順）。routeOnFloor に渡す */
  readonly list: number[];
  readonly goalKind: GoalKind;
  exits: number;
  goal: Pos | null;
};

const FOG: Readonly<Cell> = { kind: "rock", n: "wall", e: "wall", s: "wall", w: "wall", roomId: null, eventId: null, trapId: null, chestTrapId: null };

function newKnown(width: number, height: number, start: Pos, goalKind: GoalKind): Known {
  const cells: Cell[] = [];
  for (let i = 0; i < width * height; i++) cells.push({ ...FOG });
  // fog の stairsUp は自分が立っている開始のマス（知っている）。下り階段・ボス・部屋の一覧は知らないので空
  const fog: Floor = { floor: 0, width, height, cells, rooms: [], stairsUp: { x: start.x, y: start.y }, stairsDown: null, boss: null };
  return { fog, explored: new Set(), list: [], goalKind, exits: 0, goal: null };
}

/**
 * 盤の全体を読むのはここだけ: 今の位置と向きから見えるマス（visibleCellsOf。DG-12）を explored に足し、中身を fog に写す。
 * 未踏の口の数は、足したマスに向いていた既知のマスの口を引き、足したマス自身の口を足して更新する（読むのは足したマスと既知のマスだけ）
 */
function sight(f: Floor, known: Known, pos: Pos, facing: Facing, depth: number): void {
  for (const v of visibleCellsOf(f, pos, facing, depth)) {
    const i = idx(f, v.x, v.y);
    if (known.explored.has(i)) continue;
    known.explored.add(i);
    known.list.push(i);
    const c: Cell = { ...f.cells[i]! };
    known.fog.cells[i] = c;
    for (const d of FACINGS) {
      const n = step(v, d);
      if (!inBounds(known.fog, n.x, n.y)) continue;
      const ni = idx(known.fog, n.x, n.y);
      if (known.explored.has(ni)) {
        // 隣の既知のマスからこのマスへの口が閉じる（隣の辺は隣のマスの中身。既知）
        if (isPassable(edgeOf(known.fog.cells[ni]!, opposite(d)))) known.exits -= 1;
      } else if (isPassable(edgeOf(c, d))) {
        known.exits += 1;
      }
    }
    if (known.goal === null && c.kind === known.goalKind) known.goal = { x: v.x, y: v.y };
  }
}

/** 未踏の口の一覧（explored の添字の昇順、各マスの中は FACINGS の順）。Known だけを読む */
export function exitsOf(known: Known): Exit[] {
  const f = known.fog;
  const out: Exit[] = [];
  for (const i of [...known.list].sort((a, b) => a - b)) {
    const x = i % f.width;
    const p = { x, y: (i - x) / f.width };
    const c = f.cells[i]!;
    for (const d of FACINGS) {
      if (!isPassable(edgeOf(c, d))) continue;
      const n = step(p, d);
      if (inBounds(f, n.x, n.y) && !known.explored.has(idx(f, n.x, n.y))) out.push({ pos: p, d });
    }
  }
  return out;
}

/** nearest: 自分のマスから explored のマスを通る BFS（マスの数の距離。向きは無視）で最初に見つかる口。BFS の順と FACINGS の順で決まる */
function nearestExit(known: Known, from: Pos): Exit | null {
  const f = known.fog;
  const seen = new Set<number>([idx(f, from.x, from.y)]);
  const queue: Pos[] = [from];
  for (let qi = 0; qi < queue.length; qi++) {
    const p = queue[qi]!;
    const c = cellAt(f, p.x, p.y);
    for (const d of FACINGS) {
      if (!isPassable(edgeOf(c, d))) continue;
      const n = step(p, d);
      if (!inBounds(f, n.x, n.y)) continue;
      const ni = idx(f, n.x, n.y);
      if (!known.explored.has(ni)) return { pos: p, d };
      if (!seen.has(ni)) {
        seen.add(ni);
        queue.push(n);
      }
    }
  }
  return null;
}

/** random: 全部の口から一様に 1 つ */
function randomExit(known: Known, rng: RngState): Exit | null {
  const list = exitsOf(known);
  return list.length === 0 ? null : list[randInt(rng, 0, list.length - 1)]!;
}

/** explored のマスだけを通る経路（DG-15 の routeOnFloor を fog の上で） */
function routeOnKnown(known: Known, pos: Pos, facing: Facing, target: Pos, targetFacing?: Facing): RouteStep[] | null {
  return routeOnFloor(known.fog, known.list, pos, facing, target, targetFacing);
}

/** ゲームの入場（enterDungeon）と同じ向き: 上り階段のマスで FACINGS の順に最初に通れる辺 */
export function enterFacing(f: Floor): Facing {
  const c = cellAt(f, f.stairsUp.x, f.stairsUp.y);
  const d = FACINGS.find((x) => isPassable(edgeOf(c, x)));
  if (d === undefined) throw new Error("enterFacing: no passable edge at stairsUp");
  return d;
}

/** 1 手の記録（単体テスト用）。phase: route = 口へ向かう経路、enter = 口に着いて 1 歩入る前進、goal = 見えた降り口へ向かう経路 */
export type WalkMove = {
  command: "move" | "left" | "right" | "around";
  phase: "route" | "enter" | "goal";
  /** 手の後の位置と向き */
  pos: Pos;
  facing: Facing;
  /** move だけ: 前進の先のマスが前進の前に explored に入っていたか */
  targetKnownBefore?: boolean;
  /** enter だけ: 前進の先のマスが、その口を選んだ時点で explored に入っていたか（口の定義から必ず false） */
  targetKnownAtChoice?: boolean;
};

/** 視野を足した直後の様子（単体テスト用。開始時と毎手の後） */
export type WalkObservation = {
  actions: number;
  steps: number;
  pos: Pos;
  facing: Facing;
  explored: ReadonlySet<number>;
  exits: number;
  found: boolean;
};

export type WalkOptions = {
  goal: GoalKind;
  policy: Policy;
  /** config.dungeon.viewDepth */
  depth: number;
  /** config.dungeon.lostHintSteps（DG-46） */
  hintSteps: number;
  /** random の方針の乱数（ゲームの乱数とは無関係） */
  rng?: RngState;
  cap?: number;
  trace?: WalkMove[];
  observe?: (o: WalkObservation) => void;
};

/** 1 階の歩き。歩数 = 前進の回数（ゲームの floorSteps と同じ）、手数 = 前進 + 旋回 */
export type FloorWalk = {
  /** 見つけた時点の歩数（見つける前に失敗したら null） */
  found: number | null;
  foundActions: number | null;
  /** 降り口（ボス）のマスに着いた時点の歩数 */
  reached: number | null;
  steps: number;
  actions: number;
  /** 前進のたびに数えた未踏の口の数の、見つけるまで（見つけた前進を含む）の平均。前進が無ければ開始時の値 */
  exitsMean: number;
  exitsPeak: number;
  exitsAtFound: number | null;
  /** 見つけた時点の explored のマス数 */
  exploredAtFound: number | null;
  /** DG-46: 前進の後に歩数 ≥ hintSteps かつ降り口が見えていない、が一度でも起きたか（最下層は null） */
  hintFired: boolean | null;
  endPos: Pos;
  endFacing: Facing;
  failed: boolean;
  failReason: string | null;
};

const TURN: Readonly<Record<"left" | "right" | "around", (d: Facing) => Facing>> = { left: turnLeft, right: turnRight, around: opposite };

/**
 * 1 階を歩く。f は盤（sight だけが読む）、start / facing は開始の位置と向き。
 * 繰り返し: (1) 降り口が見えていれば explored だけを通る経路で歩いて終える。(2) 見えていなければ方針で口を 1 つ選び、
 * (3) 口の向きで止まる経路を 1 手ずつ実行して（途中で降り口が見えたら (1) へ）、着いたら 1 歩前進して口の先へ入る。
 */
export function exploreFloorWalk(f: Floor, start: Pos, facing: Facing, opt: WalkOptions): FloorWalk {
  const cap = opt.cap ?? ACTION_CAP;
  const known = newKnown(f.width, f.height, start, opt.goal);
  let pos: Pos = { x: start.x, y: start.y };
  let dir: Facing = facing;
  let steps = 0;
  let actions = 0;
  let found: number | null = null;
  let foundActions: number | null = null;
  let exitsAtFound: number | null = null;
  let exploredAtFound: number | null = null;
  let hint = false;
  const samples: number[] = [];

  const look = (): void => {
    sight(f, known, pos, dir, opt.depth);
    if (found === null && known.goal !== null) {
      found = steps;
      foundActions = actions;
      exitsAtFound = known.exits;
      exploredAtFound = known.explored.size;
    }
    opt.observe?.({ actions, steps, pos: { x: pos.x, y: pos.y }, facing: dir, explored: known.explored, exits: known.exits, found: found !== null });
  };
  const forward = (phase: WalkMove["phase"], knownAtChoice?: boolean): void => {
    const here = cellAt(known.fog, pos.x, pos.y);
    if (!isPassable(edgeOf(here, dir))) throw new Error(`exploreFloorWalk: forward into a wall at ${pos.x},${pos.y} ${dir}`);
    const n = step(pos, dir);
    const before = known.explored.has(idx(known.fog, n.x, n.y));
    const wasFound = found !== null;
    pos = n;
    steps += 1;
    actions += 1;
    look();
    if (opt.goal === "stairsDown" && steps >= opt.hintSteps && known.goal === null) hint = true;
    if (!wasFound) samples.push(known.exits);
    const m: WalkMove = { command: "move", phase, pos: { x: pos.x, y: pos.y }, facing: dir, targetKnownBefore: before };
    if (knownAtChoice !== undefined) m.targetKnownAtChoice = knownAtChoice;
    opt.trace?.push(m);
  };
  const act = (s: RouteStep, phase: WalkMove["phase"]): void => {
    if (s.command.type === "dungeon.move") {
      forward(phase);
    } else {
      dir = TURN[s.command.dir](dir);
      actions += 1;
      look();
      opt.trace?.push({ command: s.command.dir, phase, pos: { x: pos.x, y: pos.y }, facing: dir });
    }
    if (pos.x !== s.pos.x || pos.y !== s.pos.y || dir !== s.facing) throw new Error("exploreFloorWalk: route step mismatch");
  };

  look();
  let failReason: string | null = null;
  let reached: number | null = null;
  outer: while (failReason === null) {
    const g = known.goal;
    if (g !== null) {
      const r = routeOnKnown(known, pos, dir, g);
      if (r === null) {
        failReason = "no route to goal";
        break;
      }
      for (const s of r) {
        act(s, "goal");
        if (actions > cap) {
          failReason = "cap";
          break outer;
        }
      }
      reached = steps;
      break;
    }
    let ex: Exit | null;
    if (opt.policy === "nearest") ex = nearestExit(known, pos);
    else {
      if (opt.rng === undefined) throw new Error("exploreFloorWalk: random policy needs rng");
      ex = randomExit(known, opt.rng);
    }
    if (ex === null) {
      failReason = "no exit";
      break;
    }
    const into = step(ex.pos, ex.d);
    const knownAtChoice = known.explored.has(idx(known.fog, into.x, into.y));
    const r = routeOnKnown(known, pos, dir, ex.pos, ex.d);
    if (r === null) {
      failReason = "no route to exit";
      break;
    }
    for (const s of r) {
      act(s, "route");
      if (actions > cap) {
        failReason = "cap";
        break outer;
      }
      if (known.goal !== null) continue outer; // 途中で降り口が見えたら経路をやめる
    }
    forward("enter", knownAtChoice);
    if (actions > cap) failReason = "cap";
  }
  const fallback = exitsAtFound ?? known.exits;
  return {
    found,
    foundActions,
    reached,
    steps,
    actions,
    exitsMean: samples.length === 0 ? fallback : samples.reduce((a, b) => a + b, 0) / samples.length,
    exitsPeak: samples.length === 0 ? fallback : Math.max(...samples),
    exitsAtFound,
    exploredAtFound,
    hintFired: opt.goal === "stairsDown" ? hint : null,
    endPos: pos,
    endFacing: dir,
    failed: failReason !== null,
    failReason,
  };
}

// ===================== 盤の形（全知。集計だけに使い、歩きの判断には渡さない） =====================

export type BoardStats = {
  /** 床（岩でない）のマス数 */
  floorCells: number;
  rooms: number;
  /** door の辺の数（1 辺を 1 回） */
  doorEdges: number;
  /** 行き止まりのマス数（isDeadEnd） */
  deadEnds: number;
  /** 行き止まりの枝の本数と長さ（行き止まりのマスから、通れる辺がちょうど 2 つで部屋でないマスをたどった、止まるマスの手前までのマス数） */
  branches: number;
  branchLengths: number[];
  /** 床のマスの間の通れる辺の数 − 床のマス数 + 1 */
  loops: number;
  /** 上り階段から降り口（ボス）までの最短の歩数（DG-05 と同じ BFS） */
  upToGoal: number;
  /** 部屋の外へ通れる辺（扉）がちょうど 1 つの部屋、1 つも無い部屋 */
  rooms1Door: number;
  rooms0Door: number;
};

function degree(c: Cell): number {
  let k = 0;
  for (const d of FACINGS) if (isPassable(edgeOf(c, d))) k += 1;
  return k;
}

export function boardStats(f: Floor): BoardStats {
  let floorCells = 0;
  let doorEdges = 0;
  let passEdges = 0;
  let deadEnds = 0;
  const branchLengths: number[] = [];
  for (let y = 0; y < f.height; y++) {
    for (let x = 0; x < f.width; x++) {
      const c = cellAt(f, x, y);
      if (c.kind === "rock") continue;
      floorCells += 1;
      for (const d of ["E", "S"] as const) {
        const n = step({ x, y }, d);
        if (!inBounds(f, n.x, n.y)) continue;
        const e = edgeOf(c, d);
        if (e === "door") doorEdges += 1;
        if (isPassable(e)) passEdges += 1;
      }
      if (!isDeadEnd(f, x, y)) continue;
      deadEnds += 1;
      let prev: Pos | null = null;
      let cur: Pos = { x, y };
      let len = 1;
      for (;;) {
        const cc = cellAt(f, cur.x, cur.y);
        const nextDir: Facing | undefined = FACINGS.find((d) => {
          if (!isPassable(edgeOf(cc, d))) return false;
          const n = step(cur, d);
          return inBounds(f, n.x, n.y) && (prev === null || n.x !== prev.x || n.y !== prev.y);
        });
        if (nextDir === undefined) break;
        const n = step(cur, nextDir);
        const nc = cellAt(f, n.x, n.y);
        if (nc.roomId !== null || degree(nc) !== 2) break;
        prev = cur;
        cur = n;
        len += 1;
      }
      branchLengths.push(len);
    }
  }
  let rooms1Door = 0;
  let rooms0Door = 0;
  f.rooms.forEach((_, r) => {
    let doors = 0;
    for (let i = 0; i < f.cells.length; i++) {
      const c = f.cells[i]!;
      if (c.roomId !== r) continue;
      const x = i % f.width;
      const p = { x, y: (i - x) / f.width };
      for (const d of FACINGS) {
        const n = step(p, d);
        if (inBounds(f, n.x, n.y) && cellAt(f, n.x, n.y).roomId !== r && isPassable(edgeOf(c, d))) doors += 1;
      }
    }
    if (doors === 1) rooms1Door += 1;
    if (doors === 0) rooms0Door += 1;
  });
  const goal = f.stairsDown ?? f.boss;
  if (goal === null) throw new Error("boardStats: no goal");
  return {
    floorCells,
    rooms: f.rooms.length,
    doorEdges,
    deadEnds,
    branches: branchLengths.length,
    branchLengths,
    loops: passEdges - floorCells + 1,
    upToGoal: distancesFrom(f, f.stairsUp)[idx(f, goal.x, goal.y)]!,
    rooms1Door,
    rooms0Door,
  };
}

// ===================== 計測（ダンジョン × diveSeed 1..N × 方針） =====================

export type ExploreVariant = {
  /** 変形の名前（random の方針の乱数のシードにも入る） */
  label: string;
  dungeonIds: readonly string[];
  /** diveSeed 1..seeds（DG-05 の統計テスト・M21 の迷宮の統計と同じ。ゲームの seed から引く形ではない） */
  seeds: number;
  policies?: readonly Policy[];
  /** def の上書き（width / height / rooms / fillRatio など。data のファイルは書き換えない） */
  defOverride?: Readonly<Record<string, Partial<DungeonDef>>>;
  /** config.dungeon の上書き（doorsPerRoom / braidRatio / straightBias / roomSize など） */
  cfgOverride?: Partial<Config["dungeon"]>;
};

export type FloorRecord = {
  floor: number;
  goal: GoalKind;
  /** 生成できた潜行ごと（walks の各列と同じ並び） */
  boards: BoardStats[];
  walks: { policy: Policy; list: FloorWalk[] }[];
};

export type DungeonRecord = {
  id: string;
  width: number;
  height: number;
  floors: number;
  /** 生成できた潜行の数 */
  dives: number;
  genErrors: number;
  genErrorSamples: string[];
  floorRecords: FloorRecord[];
};

export type ExploreResult = {
  label: string;
  seeds: number;
  policies: readonly Policy[];
  dungeons: DungeonRecord[];
  ms: { gen: number; walk: number };
};

/** random の方針の乱数のシード: (変形・ダンジョン・diveSeed・階) の FNV-1a */
export function walkSeed(label: string, dungeonId: string, diveSeed: number, floor: number): number {
  let h = 0x811c9dc5;
  for (const ch of `${label}|${dungeonId}|${diveSeed}|${floor}`) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function measureExplore(data: GameData, v: ExploreVariant): ExploreResult {
  const policies = v.policies ?? POLICIES;
  const cfg: Config["dungeon"] = { ...data.config.dungeon, ...v.cfgOverride };
  let genMs = 0;
  let walkMs = 0;
  const dungeons: DungeonRecord[] = [];
  for (const id of v.dungeonIds) {
    const base = data.dungeons.find((d) => d.id === id);
    if (base === undefined) throw new Error(`measureExplore: unknown dungeon ${id}`);
    const def: DungeonDef = { ...base, ...v.defOverride?.[id] };
    const chestGen = chestGenOf(data, id);
    const rec: DungeonRecord = { id, width: def.width, height: def.height, floors: def.floors, dives: 0, genErrors: 0, genErrorSamples: [], floorRecords: [] };
    for (let n = 1; n <= def.floors; n++) {
      rec.floorRecords.push({ floor: n, goal: n === def.floors ? "boss" : "stairsDown", boards: [], walks: policies.map((policy) => ({ policy, list: [] })) });
    }
    for (let seed = 1; seed <= v.seeds; seed++) {
      const t0 = performance.now();
      let floors: Floor[];
      try {
        floors = generateDive(def, cfg, seed, chestGen);
      } catch (e) {
        genMs += performance.now() - t0;
        rec.genErrors += 1;
        if (rec.genErrorSamples.length < 3) rec.genErrorSamples.push(`seed ${seed}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      const t1 = performance.now();
      genMs += t1 - t0;
      rec.dives += 1;
      floors.forEach((f, k) => rec.floorRecords[k]!.boards.push(boardStats(f)));
      for (const [pi, policy] of policies.entries()) {
        let facing: Facing | null = null;
        floors.forEach((f, k) => {
          const fr = rec.floorRecords[k]!;
          // 2 階以降は前の階の降り口（= この階の上り階段）で、降り口に踏み込んだときの向きのまま（descend は pos と facing を保つ）
          const start = f.stairsUp;
          const w = exploreFloorWalk(f, start, facing ?? enterFacing(f), {
            goal: fr.goal,
            policy,
            depth: cfg.viewDepth,
            hintSteps: cfg.lostHintSteps,
            rng: policy === "random" ? createRng(walkSeed(v.label, id, seed, f.floor)) : undefined,
          });
          fr.walks[pi]!.list.push(w);
          facing = w.failed ? null : w.endFacing;
        });
      }
      walkMs += performance.now() - t1;
    }
    dungeons.push(rec);
  }
  return { label: v.label, seeds: v.seeds, policies, dungeons, ms: { gen: genMs, walk: walkMs } };
}

// ===================== 表 =====================

function sorted(a: readonly number[]): number[] {
  return [...a].sort((x, y) => x - y);
}
export function median(a: readonly number[]): number {
  if (a.length === 0) return NaN;
  const s = sorted(a);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
export function mean(a: readonly number[]): number {
  return a.length === 0 ? NaN : a.reduce((x, y) => x + y, 0) / a.length;
}
/** nearest-rank */
export function percentile(a: readonly number[], p: number): number {
  if (a.length === 0) return NaN;
  const s = sorted(a);
  return s[Math.max(0, Math.ceil((p / 100) * s.length) - 1)]!;
}
function fmt(x: number, digits = 1): string {
  if (!Number.isFinite(x)) return "—"; // 空の列（NaN、Math.min / max の ±Infinity）
  return Number.isInteger(x) ? String(x) : x.toFixed(digits);
}
function nums<T>(a: readonly T[], f: (t: T) => number | null): number[] {
  const out: number[] = [];
  for (const t of a) {
    const v = f(t);
    if (v !== null) out.push(v);
  }
  return out;
}

/** 失敗の数（全ダンジョン・全階・全方針） */
export function failuresOf(r: ExploreResult): number {
  let k = 0;
  for (const d of r.dungeons) for (const fr of d.floorRecords) for (const w of fr.walks) k += w.list.filter((x) => x.failed).length;
  return k;
}

/** markdown の表（歩きの表と盤の形の表。balance.md にそのまま貼れる形） */
export function formatExploreReport(r: ExploreResult, title: string): string {
  const lines: string[] = [];
  lines.push(`### ${title}`, "");
  const gens = r.dungeons.map((d) => `${d.id} ${d.width}×${d.height} 生成 ${d.dives}/${r.seeds}（Error ${d.genErrors}${d.genErrorSamples.length > 0 ? `: ${d.genErrorSamples.join(" / ")}` : ""}）`);
  lines.push(
    `条件: diveSeed 1..${r.seeds}。${gens.join("、")}。方針 ${r.policies.join(" / ")}。所要 生成 ${(r.ms.gen / 1000).toFixed(2)} 秒・歩き ${(r.ms.walk / 1000).toFixed(2)} 秒。ボットの失敗 ${failuresOf(r)}。`,
    "歩数は前進の回数（floorSteps と同じ）。「見つける」は explored に降り口（最下層はボス）のマスが入った時点。罠・遭遇・宝箱・イベント（revealFloor / revealStairs）・転移・方角の一言は扱わない。一言の割合は「ゲームで 1 回」を無視して毎回出ると仮定（最下層は —）。未踏の口は前進のたびに数えた値の見つけるまでの平均（の平均）・1 回の歩きの最大（の中央値）・見つけた時点（の中央値）。",
    "",
    "| ダンジョン | 階 | 方針 | 見つけるまで 最小 / 中央値 / 平均 / p90 / 最大 | 着くまで 中央値 | 見つけた時の探索率 | 一言の割合 | 未踏の口 平均 / 最大の中央値 / 見つけた時 | 失敗 |",
    "|---|---|---|---|---|---|---|---|---|",
  );
  for (const d of r.dungeons) {
    for (const fr of d.floorRecords) {
      for (const { policy, list } of fr.walks) {
        const found = nums(list, (w) => w.found);
        const reached = nums(list, (w) => w.reached);
        const ratio: number[] = [];
        list.forEach((w, i) => {
          if (w.exploredAtFound !== null) ratio.push((100 * w.exploredAtFound) / fr.boards[i]!.floorCells);
        });
        const hints = list.filter((w) => w.hintFired !== null);
        const hintPct = hints.length === 0 ? "—" : `${fmt((100 * hints.filter((w) => w.hintFired === true).length) / hints.length)}%`;
        lines.push(
          `| ${d.id} | ${fr.floor}F${fr.goal === "boss" ? "（ボス）" : ""} | ${policy} | ${fmt(Math.min(...found))} / ${fmt(median(found))} / ${fmt(mean(found))} / ${fmt(percentile(found, 90))} / ${fmt(Math.max(...found))} | ${fmt(median(reached))} | ${fmt(mean(ratio))}% | ${hintPct} | ${fmt(mean(list.map((w) => w.exitsMean)))} / ${fmt(median(list.map((w) => w.exitsPeak)))} / ${fmt(median(nums(list, (w) => w.exitsAtFound)))} | ${list.filter((w) => w.failed).length} |`,
        );
      }
    }
  }
  lines.push(
    "",
    "盤の形（全知の統計。歩きの判断には使わない。値は潜行の平均、階段間は中央値）:",
    "",
    "| ダンジョン | 階 | 床 | 部屋 | 扉の辺 | 行き止まり | 枝 本数 / 平均の長さ | ループ | 階段間（中央値） | 扉 1 の部屋 | 扉 0 の部屋 |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
  );
  for (const d of r.dungeons) {
    for (const fr of d.floorRecords) {
      const b = fr.boards;
      const m = (f: (s: BoardStats) => number): string => fmt(mean(b.map(f)));
      lines.push(
        `| ${d.id} | ${fr.floor}F | ${m((s) => s.floorCells)} | ${m((s) => s.rooms)} | ${m((s) => s.doorEdges)} | ${m((s) => s.deadEnds)} | ${m((s) => s.branches)} / ${fmt(mean(b.flatMap((s) => s.branchLengths)))} | ${m((s) => s.loops)} | ${fmt(median(b.map((s) => s.upToGoal)))} | ${m((s) => s.rooms1Door)} | ${m((s) => s.rooms0Door)} |`,
      );
    }
  }
  return lines.join("\n");
}
