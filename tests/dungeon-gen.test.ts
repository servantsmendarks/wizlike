import { describe, expect, test } from "vitest";
import type { Config, DungeonDef } from "../src/core/data/index";
import { createRng, randInt } from "../src/core/rng";
import {
  cellAt,
  checkEdges,
  cullToFill,
  DX,
  DY,
  distancesFrom,
  edgeOf,
  FACINGS,
  floorSeed,
  generateDive,
  generateFloor,
  idx,
  inBounds,
  isDeadEnd,
  isPassable,
  opposite,
  setEdge,
  step,
  turnLeft,
  turnRight,
} from "../src/core/rules/dungeon-gen";
import type { CellKind, Dive, Floor } from "../src/core/types";
import { chestGenOf, floorOf } from "../src/core/rules/floor";
import { data } from "./helpers/core";

const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);
const CFG: Config["dungeon"] = data.config.dungeon;
const DEFS: DungeonDef[] = ["d01", "d02"].map((id) => data.dungeons.find((d) => d.id === id)!);
const KINDS: readonly CellKind[] = ["corridor", "room", "stairsUp", "stairsDown", "boss", "teleporter", "event", "trap", "chest", "rock"];
/** DG-23（M11）: 宝箱の罠の抽選の材料（id から実データで組む。盤の寸法を変えた def も id は d01 / d02 のまま） */
const GEN = (def: DungeonDef) => chestGenOf(data, def.id);

/** d01/d02 × 200 シードの生成結果（テスト間で共有。読むだけ） */
const ALL: { def: DungeonDef; seed: number; floors: Floor[] }[] = [];
for (const def of DEFS) for (const seed of SEEDS) ALL.push({ def, seed, floors: generateDive(def, CFG, seed, GEN(def)) });

function* eachFloor(): Generator<{ def: DungeonDef; seed: number; f: Floor; floors: Floor[] }> {
  for (const { def, seed, floors } of ALL) for (const f of floors) yield { def, seed, f, floors };
}

/** DG-48（M21）: 間引かない（fillRatio 1）def。M20 までの生成と同じ盤 */
const FULL = (def: DungeonDef): DungeonDef => ({ ...def, fillRatio: 1 });

/** ループ化しない設定（ループ化の前の迷路を見るため） */
const NO_BRAID: Config["dungeon"] = { ...CFG, braidRatio: [0, 0] };

function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y);
  const n = s.length;
  return n % 2 === 1 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

/** 非部屋セルの数と、非部屋セルどうしの open / door の辺の本数 */
function treeCounts(f: Floor): { nonRoom: number; edges: number; doors: number } {
  let edges = 0;
  let doors = 0;
  let nonRoom = 0;
  for (let y = 0; y < f.height; y++) {
    for (let x = 0; x < f.width; x++) {
      const c = cellAt(f, x, y);
      if (c.roomId !== null) continue;
      nonRoom += 1;
      for (const d of ["E", "S"] as const) {
        const nx = x + DX[d];
        const ny = y + DY[d];
        if (!inBounds(f, nx, ny) || cellAt(f, nx, ny).roomId !== null) continue;
        const e = edgeOf(c, d);
        if (e === "door") doors += 1;
        if (e === "open") edges += 1;
      }
    }
  }
  return { nonRoom, edges, doors };
}

function cellsOfKind(f: Floor, kind: CellKind): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  f.cells.forEach((c, i) => {
    if (c.kind === kind) out.push({ x: i % f.width, y: Math.floor(i / f.width) });
  });
  return out;
}

describe("dungeon-gen: 幾何の補助", () => {
  test("DG-04 opposite / turnLeft / turnRight / step の表", () => {
    expect(FACINGS.map(opposite)).toEqual(["S", "W", "N", "E"]);
    expect(FACINGS.map(turnLeft)).toEqual(["W", "N", "E", "S"]);
    expect(FACINGS.map(turnRight)).toEqual(["E", "S", "W", "N"]);
    expect(FACINGS.map((d) => step({ x: 5, y: 5 }, d))).toEqual([
      { x: 5, y: 4 },
      { x: 6, y: 5 },
      { x: 5, y: 6 },
      { x: 4, y: 5 },
    ]);
    expect(FACINGS.map((d) => [DX[d], DY[d]])).toEqual([
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ]);
  });

  test("DG-04 setEdge は両側を同時に書き、盤の外へは書かない。cellAt は盤外で Error", () => {
    const f = generateFloor({ ...DEFS[0]!, width: 5, height: 5, rooms: [0, 0], floors: 1, events: [], traps: [] }, CFG, 1, 1, null, GEN(DEFS[0]!));
    setEdge(f, 2, 2, "E", "door");
    expect(cellAt(f, 2, 2).e).toBe("door");
    expect(cellAt(f, 3, 2).w).toBe("door");
    setEdge(f, 0, 0, "N", "wall");
    expect(checkEdges(f)).toEqual([]);
    setEdge(f, 4, 4, "E", "open"); // 外周を open にすると checkEdges が検出する
    expect(checkEdges(f)).toEqual(["4,4 E: outer edge is open"]);
    expect(() => cellAt(f, 5, 0)).toThrow();
    expect(inBounds(f, -1, 0)).toBe(false);
    expect(idx(f, 3, 2)).toBe(13);
  });

  test("DG-04 floorSeed は階ごとに違い、0..2^32-1 の整数。式は (diveSeed ^ imul(floor, 0x9e3779b9)) >>> 0", () => {
    for (const s of [0, 1, 12345, 0xffffffff]) {
      const seeds = [1, 2, 3, 4, 5].map((n) => floorSeed(s, n));
      expect(new Set(seeds).size).toBe(5);
      for (const v of seeds) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(2 ** 32);
      }
    }
    // 手計算: imul(1, 0x9e3779b9) = 0x9e3779b9 を 32 bit 符号付きで読んだ値。0 ^ それ を >>> 0 で戻す
    expect(floorSeed(0, 1)).toBe(0x9e3779b9);
    // imul(2, 0x9e3779b9) = 0x13c6ef372 の下位 32 bit = 0x3c6ef372
    expect(floorSeed(0, 2)).toBe(0x3c6ef372);
    expect(floorSeed(0x3c6ef372, 2)).toBe(0);
  });
});

describe("dungeon-gen: d01/d02 × 200 シード × 全階", () => {
  test("DG-04 辺の整合性: checkEdges が空（隣の逆辺と一致し、外周はすべて wall）", () => {
    for (const { def, seed, f } of eachFloor()) {
      expect(checkEdges(f), `${def.id} seed ${seed} floor ${f.floor}`).toEqual([]);
      expect(f.cells.length).toBe(def.width * def.height);
    }
  });

  // M19（UI-78 の点線の調査）: 上の d01/d02 に加えて、data.dungeons のすべて（d03 以降も）× 200 シード × 全階で辺の対称性を見る
  test("DG-04/UI-78 辺の整合性（全ダンジョン）: data.dungeons のすべて × 200 シード × 全階で checkEdges が空", () => {
    expect(data.dungeons.length).toBeGreaterThanOrEqual(3);
    const bad: string[] = [];
    let floors = 0;
    for (const def of data.dungeons) {
      const pre = ALL.filter((a) => a.def.id === def.id);
      for (const seed of SEEDS) {
        const dive = pre.find((a) => a.seed === seed)?.floors ?? generateDive(def, CFG, seed, GEN(def));
        expect(dive.length).toBe(def.floors);
        for (const f of dive) {
          floors++;
          for (const e of checkEdges(f)) bad.push(`${def.id} seed ${seed} floor ${f.floor}: ${e}`);
        }
      }
    }
    expect(floors).toBe(data.dungeons.reduce((a, d) => a + d.floors, 0) * SEEDS.length);
    expect(bad).toEqual([]);
  });

  // M11（DG-04 改）: kind に chest を足して 9 種（旧 8 種）。chestTrapId は kind=chest のときだけ非 null になりうる（罠なしの箱は null）
  // M21（DG-48）: kind に rock（岩）を足して 10 種
  test("DG-04/DG-48 kind は 10 種のどれか。eventId は kind=event のときだけ、trapId は kind=trap のときだけ非 null、chestTrapId は kind=chest 以外では null", () => {
    const bad: string[] = [];
    for (const { def, seed, f } of eachFloor()) {
      f.cells.forEach((c, i) => {
        const ok =
          KINDS.includes(c.kind) &&
          (c.eventId !== null) === (c.kind === "event") &&
          (c.trapId !== null) === (c.kind === "trap") &&
          (c.kind === "chest" || c.chestTrapId === null);
        if (!ok) bad.push(`${def.id} seed ${seed} floor ${f.floor} cell ${i}`);
      });
    }
    expect(bad).toEqual([]);
  });

  // M21（DG-48）: 到達性は床（岩でないセル）のすべて。岩は到達の対象外（4 辺 wall なので届かない）
  test("DG-05/DG-48 到達性: stairsUp からの BFS（open/door）が床（岩でない）の全セルに届き、岩には届かない。stairsDown（最下層は boss）にも届く", () => {
    for (const { def, seed, f } of eachFloor()) {
      const dist = distancesFrom(f, f.stairsUp);
      expect(dist.filter((d, i) => (d < 0) !== (f.cells[i]!.kind === "rock")).length, `${def.id} seed ${seed} floor ${f.floor}`).toBe(0);
      const goal = f.floor === def.floors ? f.boss : f.stairsDown;
      expect(goal).not.toBeNull();
      expect(dist[idx(f, goal!.x, goal!.y)]).toBeGreaterThan(0);
    }
  });

  test("DG-05 部屋: 個数は dungeons[].rooms の [min, max]、外周から 1 セル離れ、互いに 8 近傍で接しない、寸法は config.dungeon.roomSize の範囲", () => {
    const [smin, smax] = CFG.roomSize;
    for (const { def, seed, f } of eachFloor()) {
      const [rmin, rmax] = def.rooms ?? CFG.defaultRooms;
      const where = `${def.id} seed ${seed} floor ${f.floor}`;
      expect(f.rooms.length, where).toBeGreaterThanOrEqual(rmin);
      expect(f.rooms.length, where).toBeLessThanOrEqual(rmax);
      f.rooms.forEach((R, i) => {
        expect(R.w).toBeGreaterThanOrEqual(smin);
        expect(R.w).toBeLessThanOrEqual(smax);
        expect(R.h).toBeGreaterThanOrEqual(smin);
        expect(R.h).toBeLessThanOrEqual(smax);
        expect(R.x).toBeGreaterThanOrEqual(1);
        expect(R.y).toBeGreaterThanOrEqual(1);
        expect(R.x + R.w).toBeLessThanOrEqual(f.width - 1);
        expect(R.y + R.h).toBeLessThanOrEqual(f.height - 1);
        for (let j = i + 1; j < f.rooms.length; j++) {
          const S = f.rooms[j]!;
          // 8 近傍で接しない = 1 セル膨らませた矩形どうしが重ならない
          const touch = R.x < S.x + S.w + 1 && S.x < R.x + R.w + 1 && R.y < S.y + S.h + 1 && S.y < R.y + R.h + 1;
          expect(touch, where).toBe(false);
        }
        // 中のセルの roomId は i、外のセルは i ではない
        let mismatch = 0;
        for (let y = 0; y < f.height; y++) {
          for (let x = 0; x < f.width; x++) {
            const inside = x >= R.x && x < R.x + R.w && y >= R.y && y < R.y + R.h;
            if ((cellAt(f, x, y).roomId === i) !== inside) mismatch += 1;
          }
        }
        expect(mismatch, where).toBe(0);
      });
    }
  });

  test("DG-05 部屋の内側の辺はすべて open、外周の辺は wall か door。door は部屋と非部屋の境界にだけあり、部屋ごとの本数は doorsPerRoom の範囲", () => {
    const [dmin, dmax] = CFG.doorsPerRoom;
    const bad: string[] = [];
    for (const { def, seed, f } of eachFloor()) {
      const where = `${def.id} seed ${seed} floor ${f.floor}`;
      const doorsPerRoom = new Array<number>(f.rooms.length).fill(0);
      for (let y = 0; y < f.height; y++) {
        for (let x = 0; x < f.width; x++) {
          const c = cellAt(f, x, y);
          for (const d of ["E", "S"] as const) {
            const nx = x + DX[d];
            const ny = y + DY[d];
            if (!inBounds(f, nx, ny)) continue;
            const o = cellAt(f, nx, ny);
            const e = edgeOf(c, d);
            if (c.roomId !== null && o.roomId === c.roomId) {
              if (e !== "open") bad.push(`${where} ${x},${y} ${d}: inner edge ${e}`);
            } else if (c.roomId !== null || o.roomId !== null) {
              if (e === "open") bad.push(`${where} ${x},${y} ${d}: room boundary is open`);
            }
            if (e === "door") {
              // 片方だけが部屋
              if ((c.roomId === null) === (o.roomId === null)) bad.push(`${where} ${x},${y} ${d}: door not on a room boundary`);
              const rid = (c.roomId ?? o.roomId)!;
              doorsPerRoom[rid] = (doorsPerRoom[rid] ?? 0) + 1;
            }
          }
        }
      }
      doorsPerRoom.forEach((n, i) => {
        if (n < dmin || n > dmax) bad.push(`${where} room ${i}: ${n} doors`);
      });
    }
    expect(bad).toEqual([]);
  });

  test("DG-05 迷路とループ化: braidRatio [0,0] なら非部屋セルどうしの open 辺は非部屋セル数 − 1（全域木）。実際の設定では、ループの本数（余分な辺）= round(行き止まり数 × p / 100) となる整数 p が braidRatio の範囲（30..50）にある。非部屋セルどうしに door は無い", () => {
    const [pmin, pmax] = CFG.braidRatio.map((r) => Math.round(r * 100)) as [number, number];
    const bad: string[] = [];
    let loopsTotal = 0;
    for (const { def, seed, f } of eachFloor()) {
      const where = `${def.id} seed ${seed} floor ${f.floor}`;
      // ループ化の前（部屋・迷路・扉）までは乱数の消費が同じなので、[0,0] で作った階の行き止まりがループ化の直前の行き止まり
      // M21（DG-48）: 間引くと行き止まりとループの数が変わるので、間引かない盤（fillRatio 1）どうしで比べる
      const full = generateFloor(FULL(def), CFG, seed, f.floor, f.floor === 1 ? null : f.stairsUp, GEN(def));
      const f0 = generateFloor(FULL(def), NO_BRAID, seed, f.floor, f.floor === 1 ? null : f.stairsUp, GEN(def));
      const t = treeCounts(full);
      const t0 = treeCounts(f0);
      if (t.doors !== 0 || t0.doors !== 0) bad.push(`${where}: door between corridors`);
      if (t0.edges !== t0.nonRoom - 1) bad.push(`${where}: not a spanning tree without braid (${t0.edges} / ${t0.nonRoom})`);
      let dead0 = 0;
      for (let y = 0; y < f0.height; y++) for (let x = 0; x < f0.width; x++) if (isDeadEnd(f0, x, y)) dead0 += 1;
      const loops = t.edges - (t.nonRoom - 1);
      loopsTotal += loops;
      let ok = false;
      for (let p = pmin; p <= pmax; p++) if (Math.round((dead0 * p) / 100) === loops) ok = true;
      if (!ok) bad.push(`${where}: ${loops} loops for ${dead0} dead ends`);
    }
    expect(bad).toEqual([]);
    expect(loopsTotal).toBeGreaterThan(0);
  });

  test("DG-05 統計: d01 の 200 シードで、階ごとの上り階段から下り階段（最下層はボス）までの最短路の中央値が 40〜80 歩（braidRatio [0.3,0.5]・roomSize [4,8] はユーザー決定の範囲）", () => {
    expect(CFG.braidRatio).toEqual([0.3, 0.5]);
    expect(CFG.roomSize).toEqual([4, 8]);
    const d01 = DEFS[0]!;
    const perFloor: number[][] = Array.from({ length: d01.floors }, () => []);
    for (const { def, f } of eachFloor()) {
      if (def !== d01) continue;
      const goal = (f.floor === def.floors ? f.boss : f.stairsDown)!;
      perFloor[f.floor - 1]!.push(distancesFrom(f, f.stairsUp)[idx(f, goal.x, goal.y)]!);
    }
    for (const list of perFloor) {
      expect(list).toHaveLength(SEEDS.length);
      const m = median(list);
      expect(m).toBeGreaterThanOrEqual(40);
      expect(m).toBeLessThanOrEqual(80);
    }
  });

  test("DG-05 straightBias: 1 にすると 0 より直進の通路（向かい合う 2 辺だけが通れる非部屋セル）が増える", () => {
    const straightCells = (bias: number): number => {
      let n = 0;
      for (const seed of SEEDS.slice(0, 50)) {
        for (const f of generateDive(DEFS[0]!, { ...NO_BRAID, straightBias: bias }, seed, GEN(DEFS[0]!))) {
          for (const c of f.cells) {
            if (c.roomId !== null) continue;
            const open = FACINGS.filter((d) => isPassable(edgeOf(c, d))).join("");
            if (open === "NS" || open === "EW") n += 1;
          }
        }
      }
      return n;
    };
    const s0 = straightCells(0);
    const s1 = straightCells(1);
    expect(s1).toBeGreaterThan(s0 * 1.2);
  });

  test("DG-05 階段: stairsUp は各階に 1 つ。最下層以外は stairsDown が 1 つで boss なし、最下層は boss が 1 つで stairsDown なし。下り/ボスの BFS 距離はその階の最大値", () => {
    for (const { def, f } of eachFloor()) {
      expect(cellsOfKind(f, "stairsUp")).toEqual([f.stairsUp]);
      const last = f.floor === def.floors;
      if (last) {
        expect(f.stairsDown).toBeNull();
        expect(cellsOfKind(f, "stairsDown")).toEqual([]);
        expect(cellsOfKind(f, "boss")).toEqual([f.boss]);
      } else {
        expect(f.boss).toBeNull();
        expect(cellsOfKind(f, "boss")).toEqual([]);
        expect(cellsOfKind(f, "stairsDown")).toEqual([f.stairsDown]);
      }
      const goal = (last ? f.boss : f.stairsDown)!;
      const dist = distancesFrom(f, f.stairsUp);
      expect(dist[idx(f, goal.x, goal.y)]).toBe(Math.max(...dist));
      expect(cellsOfKind(f, "teleporter")).toEqual([]);
    }
  });

  test("DG-05/DG-06 1 階の上り階段は部屋の外。2 階以降の stairsUp は、前の階の stairsDown と同じ座標", () => {
    for (const { floors } of ALL) {
      const f1 = floors[0]!;
      expect(cellAt(f1, f1.stairsUp.x, f1.stairsUp.y).roomId).toBeNull();
      for (let n = 1; n < floors.length; n++) {
        expect(floors[n]!.stairsUp).toEqual(floors[n - 1]!.stairsDown);
      }
    }
  });

  test("DG-05/DG-22 イベント: 潜行全体で各 id は高々 1 回、i 番目は (i mod floors)+1 階、20×20 では全イベントが置かれる。置き場所は非部屋の行き止まりか部屋の中", () => {
    for (const { def, seed, floors } of ALL) {
      const seen: string[] = [];
      for (const f of floors) {
        f.cells.forEach((c, i) => {
          if (c.kind !== "event") return;
          const x = i % f.width;
          const y = Math.floor(i / f.width);
          seen.push(c.eventId!);
          const k = def.events.indexOf(c.eventId!);
          expect(k).toBeGreaterThanOrEqual(0);
          expect((k % def.floors) + 1).toBe(f.floor);
          expect(c.roomId !== null || isDeadEnd(f, x, y)).toBe(true);
        });
      }
      expect([...seen].sort(), `${def.id} seed ${seed}`).toEqual([...def.events].sort());
    }
  });

  test("DG-05/DG-20 罠: 階ごとの個数は trapsPerFloor の範囲、trapId は dungeons[].traps のどれか、置き場所は行き止まりか部屋の中で、階段・ボス・イベントと重ならない", () => {
    for (const { def, f } of eachFloor()) {
      const traps = cellsOfKind(f, "trap");
      expect(traps.length).toBeGreaterThanOrEqual(def.trapsPerFloor[0]);
      expect(traps.length).toBeLessThanOrEqual(def.trapsPerFloor[1]);
      for (const p of traps) {
        const c = cellAt(f, p.x, p.y);
        expect(def.traps).toContain(c.trapId);
        expect(c.roomId !== null || isDeadEnd(f, p.x, p.y)).toBe(true);
        // kind は 1 つだけなので、階段・ボス・イベントとは重ならない。座標でも確かめる
        expect(p).not.toEqual(f.stairsUp);
        expect(p).not.toEqual(f.stairsDown);
        expect(p).not.toEqual(f.boss);
      }
    }
  });

  test("DG-03 200 シードで 1 階の stairsUp の座標が 2 種類以上ある（シードが効いている）", () => {
    for (const def of DEFS) {
      const ups = new Set(ALL.filter((a) => a.def === def).map((a) => `${a.floors[0]!.stairsUp.x},${a.floors[0]!.stairsUp.y}`));
      expect(ups.size).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("dungeon-gen: 決定性と境界", () => {
  test("DG-03 決定性: 同じ diveSeed で generateDive は deep-equal。JSON 往復でも toEqual。generateFloor(…, 2, floors[0].stairsDown) を単独で呼んでも generateDive の [1] と等しい", () => {
    for (const def of DEFS) {
      for (const seed of [1, 7, 12345, 0xffffffff]) {
        const a = generateDive(def, CFG, seed, GEN(def));
        const b = generateDive(def, CFG, seed, GEN(def));
        expect(a).toEqual(b);
        expect(JSON.parse(JSON.stringify(a))).toEqual(a);
        expect(generateFloor(def, CFG, seed, 2, a[0]!.stairsDown, GEN(def))).toEqual(a[1]);
        expect(generateFloor(def, CFG, seed, 1, null, GEN(def))).toEqual(a[0]);
      }
    }
  });

  test("DG-03 1 階の部屋の数は createRng(floorSeed(diveSeed, 1)) の最初の randInt(rooms) で決まる（state.rng を使わない）", () => {
    // 消費順の先頭は want = randInt(rmin, rmax)。部屋の数は want 以下（置けた分）。
    // 一辺 2 の部屋なら 20×20 には最初の配置で want 個すべて置けるので、部屋の数は want に一致する
    const small: Config["dungeon"] = { ...CFG, roomSize: [2, 2] };
    for (const def of DEFS) {
      const [rmin, rmax] = def.rooms!;
      let equal = 0;
      for (let seed = 1; seed <= 20; seed++) {
        const want = randInt(createRng(floorSeed(seed, 1)), rmin, rmax);
        expect(generateDive(def, small, seed, GEN(def))[0]!.rooms.length).toBe(want);
        const n = generateDive(def, CFG, seed, GEN(def))[0]!.rooms.length;
        expect(n).toBeLessThanOrEqual(want);
        if (n === want) equal += 1;
      }
      expect(equal).toBeGreaterThan(0);
    }
  });

  // M21（DG-48）: fillRatio 1（間引かない）では M20 までの値のまま（生成が同じであることの回帰）。d01 の既定（0.45）の値は取り直した
  test("DG-03/DG-48 回帰: d01・diveSeed 12345 の 1 階の stairsUp・stairsDown・rooms.length と 2 階の boss（fillRatio 1 は M20 までの値、既定 0.45 は取り直した値と床の数）", () => {
    const pick = (fs: Floor[]) => ({
      up: fs[0]!.stairsUp,
      down: fs[0]!.stairsDown,
      rooms: fs[0]!.rooms.length,
      boss: fs[1]!.boss,
      floors: fs.map((f) => f.cells.filter((c) => c.kind !== "rock").length),
    });
    expect(DEFS[0]!.fillRatio).toBe(0.45);
    expect(pick(generateDive(FULL(DEFS[0]!), CFG, 12345, GEN(DEFS[0]!)))).toEqual({ up: { x: 8, y: 14 }, down: { x: 17, y: 7 }, rooms: 3, boss: { x: 3, y: 14 }, floors: [400, 400] });
    expect(pick(generateDive(DEFS[0]!, CFG, 12345, GEN(DEFS[0]!)))).toEqual({ up: { x: 1, y: 9 }, down: { x: 11, y: 9 }, rooms: 3, boss: { x: 1, y: 4 }, floors: [180, 225] });
  });

  test("DG-02 width 5・height 5・rooms [0,0] の def でも生成でき、全セルに到達できる。roomSize が盤より大きくても Error にならない（fillRatio 1。M21）", () => {
    // イベントは置かない（5×5 ではループ化で行き止まりが無くなり、DG-22 の Error になる盤がある。DG-05）
    const tiny: DungeonDef = { ...DEFS[0]!, width: 5, height: 5, rooms: [0, 0], events: [], fillRatio: 1 };
    const big: DungeonDef = { ...DEFS[0]!, width: 5, height: 5, rooms: [1, 2], events: [], fillRatio: 1 };
    const hugeRooms: Config["dungeon"] = { ...CFG, roomSize: [6, 9] };
    for (const seed of SEEDS) {
      for (const [def, cfg] of [
        [tiny, CFG],
        [big, CFG],
        [big, hugeRooms],
      ] as const) {
        const fs = generateDive(def, cfg, seed, GEN(def));
        for (const f of fs) {
          expect(checkEdges(f)).toEqual([]);
          expect(distancesFrom(f, f.stairsUp).every((d) => d >= 0)).toBe(true);
        }
      }
      expect(generateDive(tiny, CFG, seed, GEN(tiny))[0]!.rooms).toEqual([]);
      expect(generateDive(big, hugeRooms, seed, GEN(big))[0]!.rooms).toEqual([]);
    }
  });

  test("DG-22 置き場所の候補が足りずにイベントを置けない盤（5×5 にイベント 30 個）は Error。罠の不足は置ける分だけ置いて続ける", () => {
    const events = Array.from({ length: 30 }, (_, i) => `ev${i}`);
    const crowded: DungeonDef = { ...DEFS[0]!, width: 5, height: 5, rooms: [0, 0], floors: 1, events };
    expect(() => generateFloor(crowded, CFG, 1, 1, null, GEN(crowded))).toThrow(/no cell for event/);
    const manyTraps: DungeonDef = { ...DEFS[0]!, width: 5, height: 5, rooms: [0, 0], floors: 1, events: [], trapsPerFloor: [30, 30] };
    let total = 0;
    for (const seed of SEEDS) {
      const f = generateFloor(manyTraps, CFG, seed, 1, null, GEN(manyTraps));
      const n = f.cells.filter((c) => c.kind === "trap").length;
      expect(n).toBeLessThan(30);
      total += n;
    }
    // ループ化で行き止まりが残らない盤では 0 個のこともある（Error にはしない）
    expect(total).toBeGreaterThan(0);
  });

  test("DG-05 最初の配置で rooms の min に届かなくても、配置をやり直して min を満たす（9×9、一辺 3 の部屋 2 つ）", () => {
    // 内側 7×7 に 3×3 を 2 つ置くには、1 つ目が端の列か行（x か y が 1 か 5）に来る必要がある。
    // 1 つ目が中央寄り（x, y とも 2..4。9/25）だと 2 つ目は置けないので、最初の配置は一定の割合で失敗する
    const def: DungeonDef = { ...DEFS[0]!, width: 9, height: 9, rooms: [2, 2], floors: 1, events: [], traps: [] };
    const cfg: Config["dungeon"] = { ...CFG, roomSize: [3, 3] };
    let firstFailed = 0;
    for (const seed of SEEDS) {
      const f = generateFloor(def, cfg, seed, 1, null, GEN(def));
      expect(f.rooms.length).toBe(2);
      // 最初の配置（want を引いた直後の 1 つ目の部屋）が中央寄りだった数を数える
      const rng = createRng(floorSeed(seed, 1));
      randInt(rng, 2, 2); // want
      randInt(rng, 3, 3); // w
      randInt(rng, 3, 3); // h
      const x = randInt(rng, 1, 5);
      const y = randInt(rng, 1, 5);
      if (x >= 2 && x <= 4 && y >= 2 && y <= 4) firstFailed += 1;
    }
    expect(firstFailed).toBeGreaterThan(0);
  });

  test("DG-04 isPassable は open と door だけ。isDeadEnd は部屋の外で通れる辺がちょうど 1 本", () => {
    expect(isPassable("open")).toBe(true);
    expect(isPassable("door")).toBe(true);
    expect(isPassable("wall")).toBe(false);
    for (const { f } of ALL.slice(0, 5).flatMap((a) => a.floors.map((f) => ({ f })))) {
      for (let y = 0; y < f.height; y++) {
        for (let x = 0; x < f.width; x++) {
          const c = cellAt(f, x, y);
          const k = FACINGS.filter((d) => isPassable(edgeOf(c, d))).length;
          expect(isDeadEnd(f, x, y)).toBe(c.roomId === null && k === 1);
        }
      }
    }
  });
});

describe("dungeon-gen: 宝箱のセル（DG-23。M11）", () => {
  /** 宝箱のセルの位置（添字の昇順）と罠 */
  const chestsOf = (f: Floor): { i: number; trap: string | null }[] =>
    f.cells.flatMap((c, i) => (c.kind === "chest" ? [{ i, trap: c.chestTrapId }] : []));

  test("DG-23 個数は chestsPerFloor（[1,3]）の範囲で、ボスの階にも置く。置き場所は行き止まりか部屋の中（階段・ボス・イベント・罠と重ならない）。罠は chest-traps.json の id か null で、危険度は chestTrapMaxDanger 以下（d01・d02 × 200 シード）", () => {
    const trapDanger = new Map(data.chestTraps.map((t) => [t.id, t.danger]));
    const seen = new Map<string, Set<string>>();
    for (const { def, seed, f } of eachFloor()) {
      const where = `${def.id} seed ${seed} floor ${f.floor}`;
      const cs = chestsOf(f);
      expect(cs.length, where).toBeGreaterThanOrEqual(def.chestsPerFloor[0]);
      expect(cs.length, where).toBeLessThanOrEqual(def.chestsPerFloor[1]);
      for (const { i, trap } of cs) {
        const x = i % f.width;
        const y = Math.floor(i / f.width);
        const c = cellAt(f, x, y);
        expect(c.roomId !== null || isDeadEnd(f, x, y), where).toBe(true);
        expect(c.eventId).toBeNull();
        expect(c.trapId).toBeNull();
        if (trap !== null) {
          expect(trapDanger.get(trap), `${where} ${trap}`).toBeLessThanOrEqual(def.chestTrapMaxDanger);
          expect(def.chestTrapDangerWeights[trapDanger.get(trap)! - 1]).toBeGreaterThan(0);
        }
        const set = seen.get(def.id) ?? new Set<string>();
        set.add(String(trap));
        seen.set(def.id, set);
      }
    }
    // 罠なし（noTrapChance 30）と、上限までの各危険度が実際に出る
    for (const def of DEFS) {
      const s = seen.get(def.id)!;
      expect(s.has("null"), def.id).toBe(true);
      for (let d = 1; d <= def.chestTrapMaxDanger; d++) {
        expect(data.chestTraps.some((t) => t.danger === d && s.has(t.id)), `${def.id} danger ${d}`).toBe(true);
      }
    }
  });

  test("DG-23 (8) は (7) までの生成を変えない: chestsPerFloor [0,0] なら宝箱のセルは無く、[1,3] の階の宝箱のセルを部屋・通路に戻したものと一致する（既存の回帰値はそのまま）", () => {
    for (const def of DEFS) {
      const none: DungeonDef = { ...def, chestsPerFloor: [0, 0] };
      for (const seed of SEEDS.slice(0, 50)) {
        const a = generateDive(def, CFG, seed, GEN(def));
        const b = generateDive(none, CFG, seed, GEN(none));
        a.forEach((f, n) => {
          expect(chestsOf(b[n]!)).toEqual([]);
          const back = structuredClone(f);
          for (const c of back.cells) {
            if (c.kind !== "chest") continue;
            c.kind = c.roomId !== null ? "room" : "corridor";
            c.chestTrapId = null;
          }
          expect(back, `${def.id} seed ${seed} floor ${n + 1}`).toEqual(b[n]);
        });
      }
    }
  });

  test("DG-23 消費順: 個数 randInt(chestsPerFloor) の 1 回の後に、(7) の残りの候補の先頭から箱ごとに CB-61 の罠。個数だけを変えると、少ない方の箱は多い方の箱の先頭と同じ位置・同じ罠（[1,1] ⊂ [2,2] ⊂ [3,3]）", () => {
    const with_ = (n: number): DungeonDef => ({ ...DEFS[1]!, chestsPerFloor: [n, n] });
    let differs = 0;
    for (const seed of SEEDS.slice(0, 50)) {
      const [f1, f2, f3] = [1, 2, 3].map((n) => generateFloor(with_(n), CFG, seed, 1, null, GEN(DEFS[1]!)));
      const c1 = chestsOf(f1!);
      const c2 = chestsOf(f2!);
      const c3 = chestsOf(f3!);
      expect([c1.length, c2.length, c3.length]).toEqual([1, 2, 3]);
      for (const c of c1) expect(c2).toContainEqual(c);
      for (const c of c2) expect(c3).toContainEqual(c);
      if (c3[0]!.trap !== c3[1]!.trap || c3[1]!.trap !== c3[2]!.trap) differs += 1;
    }
    expect(differs).toBeGreaterThan(0);
  });

  test("DG-23/CB-61 罠の抽選の材料は chestGen: noTrapChance 100 なら全部罠なし。noTrapChance 0・重み [0,1,0,0] なら全部が危険度 2 の罠（データの順から randInt）", () => {
    const d2 = data.chestTraps.filter((t) => t.danger === 2).map((t) => t.id);
    const allNull = { ...GEN(DEFS[0]!), noTrapChance: 100 };
    const onlyTwo = { ...GEN(DEFS[0]!), noTrapChance: 0, weights: [0, 1, 0, 0] };
    const got = new Set<string | null>();
    for (const seed of SEEDS.slice(0, 50)) {
      for (const f of generateDive(DEFS[0]!, CFG, seed, allNull)) for (const c of chestsOf(f)) expect(c.trap).toBeNull();
      for (const f of generateDive(DEFS[0]!, CFG, seed, onlyTwo)) for (const c of chestsOf(f)) got.add(c.trap);
    }
    expect([...got].sort()).toEqual([...d2].sort());
  });
});

describe("dungeon-gen: 階の充填率（DG-48。M21）", () => {
  const ALL_DEFS: DungeonDef[] = data.dungeons;
  /** 全ダンジョン × 200 シードの生成結果（d01 / d02 は上の ALL を使う） */
  const EVERY: { def: DungeonDef; seed: number; floors: Floor[] }[] = [];
  for (const def of ALL_DEFS) {
    for (const seed of SEEDS) EVERY.push(ALL.find((a) => a.def.id === def.id && a.seed === seed) ?? { def, seed, floors: generateDive(def, CFG, seed, GEN(def)) });
  }
  const floorCount = (f: Floor): number => f.cells.filter((c) => c.kind !== "rock").length;
  const hasDoor = (f: Floor, i: number): boolean => FACINGS.some((d) => edgeOf(f.cells[i]!, d) === "door");
  /** cullToFill がまだ間引ける行き止まり（部屋の外・通れる辺 1 本・door なし・keep でない） */
  const cullableDeadEnds = (f: Floor, keep: number): number[] =>
    f.cells.flatMap((c, i) => (c.kind !== "rock" && i !== keep && isDeadEnd(f, i % f.width, Math.floor(i / f.width)) && !hasDoor(f, i) ? [i] : []));
  /** 通路のセルどうしの open の辺で、閉じても床の連結が保たれるもの（総当たり。f は一時的に書き換えて戻す） */
  const closableLoopEdges = (f: Floor): string[] => {
    const out: string[] = [];
    const total = floorCount(f);
    for (let i = 0; i < f.cells.length; i++) {
      const c = f.cells[i]!;
      if (c.roomId !== null || c.kind === "rock") continue;
      const x = i % f.width;
      const y = Math.floor(i / f.width);
      for (const d of ["E", "S"] as const) {
        if (edgeOf(c, d) !== "open" || !inBounds(f, x + DX[d], y + DY[d]) || cellAt(f, x + DX[d], y + DY[d]).roomId !== null) continue;
        setEdge(f, x, y, d, "wall"); // 一時的に閉じて数え、open に戻す
        if (distancesFrom(f, { x, y }).filter((v) => v >= 0).length === total) out.push(`${x},${y} ${d}`);
        setEdge(f, x, y, d, "open");
      }
    }
    return out;
  };

  test("DG-48 data: fillRatio は各ダンジョンにある（d01 0.45 / d02 0.6 / d03 0.75）", () => {
    expect(Object.fromEntries(ALL_DEFS.map((d) => [d.id, d.fillRatio]))).toEqual({ d01: 0.45, d02: 0.6, d03: 0.75 });
  });

  test("DG-48 岩: 辺はすべて wall、部屋の外（roomId null）、eventId・trapId・chestTrapId は null。部屋のセルは岩にならず、door の辺は残る。階段・ボスは岩に置かれない（全ダンジョン × 200 シード × 全階）", () => {
    const [dmin] = CFG.doorsPerRoom;
    const bad: string[] = [];
    let rocks = 0;
    for (const { def, seed, floors } of EVERY) {
      for (const f of floors) {
        const where = `${def.id} seed ${seed} floor ${f.floor}`;
        f.cells.forEach((c, i) => {
          if (c.kind !== "rock") return;
          rocks += 1;
          if (FACINGS.some((d) => edgeOf(c, d) !== "wall")) bad.push(`${where} cell ${i}: edge not wall`);
          if (c.roomId !== null || c.eventId !== null || c.trapId !== null || c.chestTrapId !== null) bad.push(`${where} cell ${i}: room or content`);
        });
        f.rooms.forEach((R, id) => {
          let doors = 0;
          for (let y = R.y; y < R.y + R.h; y++) {
            for (let x = R.x; x < R.x + R.w; x++) {
              const c = cellAt(f, x, y);
              if (c.kind === "rock") bad.push(`${where}: room cell ${x},${y} is rock`);
              doors += FACINGS.filter((d) => edgeOf(c, d) === "door").length;
            }
          }
          if (doors < dmin) bad.push(`${where}: room ${id} has ${doors} doors`);
        });
        for (const p of [f.stairsUp, f.stairsDown, f.boss]) if (p !== null && cellAt(f, p.x, p.y).kind === "rock") bad.push(`${where}: stairs on rock`);
      }
    }
    expect(bad).toEqual([]);
    expect(rocks).toBeGreaterThan(0);
  });

  test("DG-48 床の数: floor(fillRatio × 盤のセル数) 以下か、間引ける行き止まりも閉じられるループの辺も尽きている（d01・d02 × 200 シード × 全階）。fillRatio 1 なら岩は 0", () => {
    const bad: string[] = [];
    for (const { def, seed, floors } of ALL) {
      for (const f of floors) {
        const target = Math.floor(def.fillRatio * f.width * f.height);
        if (floorCount(f) <= target) continue;
        const keep = f.floor === 1 ? -1 : idx(f, f.stairsUp.x, f.stairsUp.y);
        const where = `${def.id} seed ${seed} floor ${f.floor}`;
        if (cullableDeadEnds(f, keep).length > 0) bad.push(`${where}: dead end left`);
        if (closableLoopEdges(f).length > 0) bad.push(`${where}: loop left`);
      }
    }
    expect(bad).toEqual([]);
    for (const def of DEFS) for (const seed of SEEDS.slice(0, 50)) for (const f of generateDive(FULL(def), CFG, seed, GEN(def))) expect(floorCount(f)).toBe(400);
  });

  test("DG-48 決定性: 同じ diveSeed で generateDive は deep-equal（全ダンジョン）。間引きは乱数を引かない: 生成した階は「fillRatio 1 の同じ階を部屋・通路に戻して cullToFill(fillRatio, 2 階以降は上り階段)」と同じ辺と岩（(1)〜(4) の乱数の消費が fillRatio によらず同じ）", () => {
    for (const def of ALL_DEFS) {
      for (const seed of SEEDS.slice(0, 40)) {
        const a = generateDive(def, CFG, seed, GEN(def));
        expect(generateDive(def, CFG, seed, GEN(def))).toEqual(a);
        a.forEach((f) => {
          const upPos = f.floor === 1 ? null : f.stairsUp;
          const full = generateFloor(FULL(def), CFG, seed, f.floor, upPos, GEN(def));
          expect(full.rooms).toEqual(f.rooms);
          const g = structuredClone(full);
          for (const c of g.cells) c.kind = c.roomId !== null ? "room" : "corridor";
          cullToFill(g, def.fillRatio, upPos);
          const shape = (h: Floor) => h.cells.map((c) => [c.n, c.e, c.s, c.w, c.kind === "rock"].join(","));
          expect(shape(g), `${def.id} seed ${seed} floor ${f.floor}`).toEqual(shape(f));
        });
      }
    }
  });

  test("DG-48 cullToFill: 行き止まりから添字の昇順に岩にする。行き止まりが尽きたら橋でないループの辺を閉じて続ける。keep は岩にしない。届かなければ止まる（Error にしない）。fillRatio 1 なら何もしない", () => {
    // 7×3 の盤。床は 1 行目の 0-1-2-3-4 の通路と、2 行目の 7・8（0-1-8-7 で輪）。ほかのセルは先に岩にしておく
    const used = (i: number): boolean => i < 5 || i === 7 || i === 8;
    const make = (): Floor => {
      const cells: Floor["cells"] = [];
      for (let i = 0; i < 21; i++) cells.push({ kind: used(i) ? "corridor" : "rock", n: "wall", e: "wall", s: "wall", w: "wall", roomId: null, eventId: null, trapId: null, chestTrapId: null });
      const f: Floor = { floor: 1, width: 7, height: 3, cells, rooms: [], stairsUp: { x: 0, y: 0 }, stairsDown: null, boss: null };
      for (let x = 0; x < 4; x++) setEdge(f, x, 0, "E", "open");
      setEdge(f, 0, 0, "S", "open");
      setEdge(f, 1, 0, "S", "open");
      setEdge(f, 0, 1, "E", "open");
      return f;
    };
    const rocksOf = (f: Floor) => f.cells.flatMap((c, i) => (c.kind === "rock" && used(i) ? [i] : []));
    // 床 7、目標 floor(0.2 × 21) = 4。行き止まりは 4 だけ → 次の回で 3 → 2 で床 4 になって止まる
    const f = make();
    expect(cullToFill(f, 0.2, null)).toBe(3);
    expect(rocksOf(f)).toEqual([2, 3, 4]);
    expect(checkEdges(f)).toEqual([]);
    // 目標 1: 行き止まりが尽きたら輪の辺（0 の E。閉じると 0 が間引ける）を閉じて続け、床 1 で止まる
    const g = make();
    cullToFill(g, 1 / 21, null);
    expect(g.cells.filter((c) => c.kind !== "rock").length).toBe(1);
    expect(g.cells[8]!.kind).toBe("corridor");
    expect(checkEdges(g)).toEqual([]);
    // keep（4,0）は岩にしない。輪を閉じて反対側から間引き、keep だけが残る
    const h = make();
    cullToFill(h, 1 / 21, { x: 4, y: 0 });
    expect(rocksOf(h)).toEqual([0, 1, 2, 3, 7, 8]);
    // 目標 0 でも、床が 1 セルになれば行き止まりも閉じる辺も無いので止まる
    const z = make();
    cullToFill(z, 0.0001, null);
    expect(z.cells.filter((c) => c.kind !== "rock").length).toBe(1);
    // fillRatio 1 は何もしない
    const k = make();
    expect(cullToFill(k, 1, null)).toBe(0);
    expect(k).toEqual(make());
  });

  test("DG-05/DG-48 統計: d01 の 1 階の床の数（200 シード）の最小・中央値・最大（docs/balance.md に記録した値）", () => {
    const d01 = ALL.filter((a) => a.def.id === "d01").map((a) => floorCount(a.floors[0]!));
    expect(d01).toHaveLength(200);
    expect([Math.min(...d01), median(d01), Math.max(...d01)]).toEqual([180, 203, 288]);
  });
});

// M21 D-1b: floorOf の生成のメモ（src/core/rules/floor.ts の genCache）。盤は変えない
describe("dungeon-gen: 生成の盤の固定と floorOf のメモ（DG-03 / DG-48。M21 D-1b）", () => {
  /**
   * 3 ダンジョン × diveSeed 1〜200 の generateDive の JSON（シードの順に連結）の sha256。
   * 出どころ: このテストの viaGen の連結（generateDive の JSON をシードの順に連結）を sha256 したもの。D-1b の変更の前の HEAD 71c6b60（と 49229d2）で同じ手順で出した値。
   * 生成の手順（DG-03 の乱数の消費・DG-48 の間引き）を速くしても、この値が変わったら盤が変わっている
   */
  const DIVE_HASH: Record<string, string> = {
    d01: "cc0d27caee86fe0b176dad727bdf2d1232c2481134077557fd0dce9073f5df49",
    d02: "1fab810c7eddf501182ce26ac104207820ab4db11e99d4cbf0678ac0362d566f",
    d03: "f88d3a9de563408ce4c0b6d9294becd885ff004f4bd6f35cbe7131cd89d159c3",
  };
  const sha256 = async (s: string): Promise<string> =>
    [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const diveOf = (dungeonId: string, diveSeed: number, extra: Partial<Dive> = {}): Dive =>
    ({ dungeonId, diveSeed, floor: 1, culled: true, clearedCells: [], bossDefeated: false, ...extra }) as unknown as Dive;
  const defOf = (id: string): DungeonDef => data.dungeons.find((d) => d.id === id)!;

  test("DG-03/DG-48 盤の固定: 3 ダンジョン × 200 シードの generateDive の JSON の sha256 が変更の前の値と同じ。floorOf（culled、処理済みなし）の全階を並べた JSON も同じ値", async () => {
    for (const id of ["d01", "d02", "d03"]) {
      const def = defOf(id);
      let viaGen = "";
      let viaFloorOf = "";
      for (const seed of SEEDS) {
        viaGen += JSON.stringify(generateDive(def, CFG, seed, GEN(def)));
        const dive = diveOf(id, seed);
        const last = floorOf(dive, data, def.floors); // 下の階から呼んで、上の階はメモから出す
        const fs = Array.from({ length: def.floors - 1 }, (_, i) => floorOf(dive, data, i + 1));
        viaFloorOf += JSON.stringify([...fs, last]);
      }
      expect(await sha256(viaGen), id).toBe(DIVE_HASH[id]);
      expect(await sha256(viaFloorOf), id).toBe(DIVE_HASH[id]);
    }
  });

  test("DG-03/DG-48 floorOf のメモ: 返した盤を書き換えても次の floorOf は生成のまま。処理済みのセル・ボスの撃破は呼ぶたびに重ねる。def の値（fillRatio）や culled が違えば別の盤。9 潜行以上を巡っても generateDive と同じ", () => {
    const def = defOf("d01");
    const gen = generateDive(def, CFG, 777, GEN(def));
    const dive = diveOf("d01", 777);
    const a = floorOf(dive, data, 1);
    expect(a).toEqual(gen[0]);
    a.cells[0]!.kind = "trap";
    a.cells[0]!.n = "open";
    a.rooms.length = 0;
    a.stairsUp.x = 99;
    expect(floorOf(dive, data, 1)).toEqual(gen[0]);
    // 処理済みのセルとボスの撃破は dive から重ねる（メモの盤は変えない）
    const boss = gen[1]!.boss!;
    const done = diveOf("d01", 777, { bossDefeated: true, clearedCells: [{ floor: 1, x: gen[0]!.stairsUp.x, y: gen[0]!.stairsUp.y }] });
    expect(cellAt(floorOf(done, data, 1), gen[0]!.stairsUp.x, gen[0]!.stairsUp.y).kind).not.toBe("stairsUp");
    expect(cellAt(floorOf(done, data, 2), boss.x, boss.y).kind).toBe("teleporter");
    expect(floorOf(dive, data, 2)).toEqual(gen[1]);
    // culled の無い潜行は fillRatio 1。data の fillRatio を変えた写しでは、その値の盤
    expect(floorOf(diveOf("d01", 777, { culled: undefined }), data, 1)).toEqual(generateDive(FULL(def), CFG, 777, GEN(def))[0]);
    const other = { ...data, dungeons: data.dungeons.map((d) => (d.id === "d01" ? { ...d, fillRatio: 0.6 } : d)) };
    expect(floorOf(dive, other, 1)).toEqual(generateDive({ ...def, fillRatio: 0.6 }, CFG, 777, GEN(def))[0]);
    // メモの数（8）より多い潜行を 2 巡しても同じ
    for (let round = 0; round < 2; round++) {
      for (let seed = 1000; seed < 1012; seed++) expect(floorOf(diveOf("d01", seed), data, 2)).toEqual(generateDive(def, CFG, seed, GEN(def))[1]);
    }
  });
});
