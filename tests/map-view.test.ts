import { afterEach, describe, expect, test, vi } from "vitest";
import { execute } from "../src/core/engine";
import { floorOf, mapView, visibleCells, visibleChests, visibleKnownTraps } from "../src/core/rules/dungeon";
import { slotsFor } from "../src/presenter/views/dungeon-geometry";
import { cloneState } from "../src/core/state";
import { tapSpecOf } from "../src/presenter/input/tap";
import { createMapView, MAP_PICK_BLINK_MS, mapLayout, mapPaths, mapPickPath, mapSnapCell, mapTapAction, playerTriangle } from "../src/presenter/views/map";
import type { Edge, Facing, MapCell, MapView } from "../src/core/types";
import { dungeonLayout, regions } from "../src/presenter/layout";
import { data, newGame } from "./helpers/core";

/** 既定の config.ui.layout での地図本体の寸法（240×208） */
const MAP_AREA = dungeonLayout(regions(data.config.ui.layout, data.config.stage.width), data.config.party.size).map.area;

function cellOf(x: number, y: number, p: Partial<MapCell> = {}): MapCell {
  return { x, y, kind: "plain", n: "wall", e: "wall", s: "wall", w: "wall", ...p };
}

function view(cells: MapCell[], o: Partial<MapView> = {}): MapView {
  return { dungeonId: "d01", floor: 1, width: 20, height: 20, pos: { x: 0, y: 0 }, facing: "N", cells, ...o };
}

/** "M x y H x2" / "M x y V y2" の線分に分解する（mapPaths の walls の書式） */
type Seg = { x1: number; y1: number; x2: number; y2: number };
function segments(d: string): Seg[] {
  const out: Seg[] = [];
  const re = /M(-?\d+) (-?\d+)([HV])(-?\d+)/g;
  for (const m of d.matchAll(re)) {
    const x = Number(m[1]);
    const y = Number(m[2]);
    const t = Number(m[4]);
    out.push(m[3] === "H" ? { x1: x, y1: y, x2: t, y2: y } : { x1: x, y1: y, x2: x, y2: t });
  }
  return out;
}

/** path の数値の組（x, y）をすべて取り出す（相対の h/v を含まない path 用） */
function points(d: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const m of d.matchAll(/[ML](-?\d+) (-?\d+)/g)) out.push([Number(m[1]), Number(m[2])]);
  return out;
}

describe("UI-24 地図", () => {
  test("UI-24 mapLayout(20,20) = {cell 8, ox 39, oy 23} で、240×208 に収まる。mapLayout(30,30) = {6, 29, 13}", () => {
    expect(MAP_AREA).toMatchObject({ w: 240, h: 208 });
    // 20×20: cell = min(8, floor(239/20)=11, floor(207/20)=10) = 8。幅 20*8+1 = 161。ox = floor(79/2) = 39、oy = floor(47/2) = 23
    expect(mapLayout(20, 20, MAP_AREA)).toEqual({ cell: 8, ox: 39, oy: 23 });
    // 30×30: cell = min(8, 7, 6) = 6。幅 181。ox = floor(59/2) = 29、oy = floor(27/2) = 13
    expect(mapLayout(30, 30, MAP_AREA)).toEqual({ cell: 6, ox: 29, oy: 13 });
    for (const [w, h] of [
      [5, 5],
      [20, 20],
      [30, 30],
      [40, 25],
      [60, 60],
    ] as const) {
      const l = mapLayout(w, h, MAP_AREA);
      expect(l.ox).toBeGreaterThanOrEqual(0);
      expect(l.oy).toBeGreaterThanOrEqual(0);
      // 右端と下端の線の画素番号が領域の内側
      expect(l.ox + w * l.cell).toBeLessThanOrEqual(MAP_AREA.w - 1);
      expect(l.oy + h * l.cell).toBeLessThanOrEqual(MAP_AREA.h - 1);
      expect(l.cell).toBeLessThanOrEqual(8);
    }
  });

  test("UI-24 mapLayout は渡した領域の寸法に合わせる（ui §2 の区切りで地図本体の高さが変わる）", () => {
    // 240×218（message 80）: 30×30 は cell = min(8, 7, floor(217/30)=7) = 7。幅 211。ox = floor(29/2) = 14、oy = floor(7/2) = 3
    expect(mapLayout(30, 30, { w: 240, h: 218 })).toEqual({ cell: 7, ox: 14, oy: 3 });
    // 240×202（message 64）: 20×20 は cell = min(8, 11, 10) = 8。高さ 161。oy = floor(41/2) = 20
    expect(mapLayout(20, 20, { w: 240, h: 202 })).toEqual({ cell: 8, ox: 39, oy: 20 });
  });

  test("UI-24 wall の辺は全長、door の辺は中央 4px を空け、open は描かない", () => {
    const lay = { cell: 8, ox: 0, oy: 0 };
    const v = view([cellOf(1, 1, { n: "door", e: "open", s: "wall", w: "door" })]);
    const segs = segments(mapPaths(v, lay).walls);
    // セル (1,1) の原点は (8,8)。北の扉: x8..10 と x14..16（隙間は 10..14 の 4px）
    const north = segs.filter((s) => s.y1 === 8 && s.y2 === 8);
    expect(north).toEqual([
      { x1: 8, y1: 8, x2: 10, y2: 8 },
      { x1: 14, y1: 8, x2: 16, y2: 8 },
    ]);
    expect(north[1]!.x1 - north[0]!.x2).toBe(4);
    // 西の扉も同じ（縦）
    const west = segs.filter((s) => s.x1 === 8 && s.x2 === 8);
    expect(west).toEqual([
      { x1: 8, y1: 8, x2: 8, y2: 10 },
      { x1: 8, y1: 14, x2: 8, y2: 16 },
    ]);
    // 南の壁は全長
    expect(segs.filter((s) => s.y1 === 16 && s.y2 === 16)).toEqual([{ x1: 8, y1: 16, x2: 16, y2: 16 }]);
    // 東は open なので x=16 の縦線は無い
    expect(segs.filter((s) => s.x1 === 16 && s.x2 === 16)).toEqual([]);
  });

  test("UI-24 隣り合う 2 セルの共有辺は 1 回だけ描く", () => {
    const lay = { cell: 8, ox: 0, oy: 0 };
    const edges: Record<"a" | "b", Edge> = { a: "door", b: "door" };
    const v = view([cellOf(0, 0, { e: edges.a }), cellOf(1, 0, { w: edges.b })]);
    const segs = segments(mapPaths(v, lay).walls);
    expect(segs.filter((s) => s.x1 === 8 && s.x2 === 8)).toHaveLength(2); // 扉の両端の 2 本だけ
  });

  test("UI-24 4 方向の三角形は 90° の回転の関係", () => {
    // cell 8 の表（設計の値）
    expect(playerTriangle("N", 8)).toEqual([
      [4, 1],
      [7, 6],
      [1, 6],
    ]);
    expect(playerTriangle("E", 8)).toEqual([
      [7, 4],
      [2, 7],
      [2, 1],
    ]);
    expect(playerTriangle("S", 8)).toEqual([
      [4, 7],
      [1, 2],
      [7, 2],
    ]);
    expect(playerTriangle("W", 8)).toEqual([
      [1, 4],
      [6, 1],
      [6, 7],
    ]);
    // どの cell でも、セル中心まわりの時計回り 90°（y 下向きで (dx,dy) → (-dy,dx)）で次の向きになる
    const order: Facing[] = ["N", "E", "S", "W"];
    for (const cell of [4, 5, 6, 7, 8]) {
      const c = cell / 2;
      for (let i = 0; i < 4; i++) {
        const cur = playerTriangle(order[i]!, cell);
        const next = playerTriangle(order[(i + 1) % 4]!, cell);
        const rotated = cur.map(([x, y]) => [-(y - c) + c, x - c + c]);
        expect(rotated).toEqual(next);
        for (const [x, y] of cur) {
          expect(Number.isInteger(x) && Number.isInteger(y)).toBe(true);
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(cell);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(cell);
        }
      }
    }
  });

  test("UI-24 現在位置と階段の記号はセル原点からの相対で描く", () => {
    const lay = mapLayout(20, 20, MAP_AREA);
    const v = view([cellOf(2, 3, { kind: "stairsDown" }), cellOf(3, 3, { kind: "stairsUp" })], { pos: { x: 2, y: 3 }, facing: "E" });
    const p = mapPaths(v, lay);
    const px = 39 + 2 * 8;
    const py = 23 + 3 * 8;
    expect(p.player).toBe(`M${px + 7} ${py + 4}L${px + 2} ${py + 7}L${px + 2} ${py + 1}Z`);
    expect(p.stairs).toBe(`M${px + 2} ${py + 3}L${px + 4} ${py + 5}L${px + 6} ${py + 3}` + `M${px + 8 + 2} ${py + 5}L${px + 8 + 4} ${py + 3}L${px + 8 + 6} ${py + 5}`);
  });

  test("UI-24 kind trap のセル（察知した罠）は traps に × の 2 本（cell 8 で M2 2L6 6M6 2L2 6 を原点に足したもの）を出し、stairs には出さない。plain・階段のセルは traps に出さない", () => {
    const lay = mapLayout(20, 20, MAP_AREA);
    const v = view([cellOf(2, 3, { kind: "trap" }), cellOf(3, 3, { kind: "stairsDown" }), cellOf(4, 3)], { pos: { x: 4, y: 3 } });
    const p = mapPaths(v, lay);
    const px = 39 + 2 * 8;
    const py = 23 + 3 * 8;
    expect(p.traps).toBe(`M${px + 2} ${py + 2}L${px + 6} ${py + 6}M${px + 6} ${py + 2}L${px + 2} ${py + 6}`);
    // 階段の V は (3,3) の 1 つだけ
    expect(p.stairs).toBe(`M${px + 8 + 2} ${py + 3}L${px + 8 + 4} ${py + 5}L${px + 8 + 6} ${py + 3}`);
    expect(mapPaths(view([cellOf(2, 3), cellOf(3, 3, { kind: "stairsUp" })]), lay).traps).toBe("");
    // cell 6（30×30）でも 8 基準の相対座標を丸めて使う（sc(2)=2・sc(6)=5）
    const lay6 = mapLayout(30, 30, MAP_AREA);
    const p6 = mapPaths(view([cellOf(0, 0, { kind: "trap" })], { width: 30, height: 30 }), lay6);
    const o = { x: lay6.ox, y: lay6.oy };
    expect(p6.traps).toBe(`M${o.x + 2} ${o.y + 2}L${o.x + 5} ${o.y + 5}M${o.x + 5} ${o.y + 2}L${o.x + 2} ${o.y + 5}`);
  });

  test("UI-72 kind chest のセル（開ける前の宝箱）は chests に □ の枠（cell 8 で M2 2H6V6H2Z を原点に足したもの）を出し、traps・stairs には出さない。ほかのセルは chests に出さない", () => {
    const lay = mapLayout(20, 20, MAP_AREA);
    const v = view([cellOf(2, 3, { kind: "chest" }), cellOf(3, 3, { kind: "trap" }), cellOf(4, 3, { kind: "stairsUp" }), cellOf(5, 3)], { pos: { x: 5, y: 3 } });
    const p = mapPaths(v, lay);
    const px = 39 + 2 * 8;
    const py = 23 + 3 * 8;
    expect(p.chests).toBe(`M${px + 2} ${py + 2}H${px + 6}V${py + 6}H${px + 2}Z`);
    expect(p.traps).toBe(`M${px + 8 + 2} ${py + 2}L${px + 8 + 6} ${py + 6}M${px + 8 + 6} ${py + 2}L${px + 8 + 2} ${py + 6}`);
    expect(p.stairs).toBe(`M${px + 16 + 2} ${py + 5}L${px + 16 + 4} ${py + 3}L${px + 16 + 6} ${py + 5}`);
    expect(mapPaths(view([cellOf(2, 3), cellOf(3, 3, { kind: "trap" })]), lay).chests).toBe("");
    // cell 6（30×30）でも 8 基準の相対座標を丸めて使う（sc(2)=2・sc(6)=5）
    const lay6 = mapLayout(30, 30, MAP_AREA);
    const p6 = mapPaths(view([cellOf(0, 0, { kind: "chest" })], { width: 30, height: 30 }), lay6);
    const o = { x: lay6.ox, y: lay6.oy };
    expect(p6.chests).toBe(`M${o.x + 2} ${o.y + 2}H${o.x + 5}V${o.y + 5}H${o.x + 2}Z`);
  });

  test("UI-24 cells に無いセルは描かない", () => {
    const lay = mapLayout(20, 20, MAP_AREA);
    const v = view([cellOf(5, 7)], { pos: { x: 5, y: 7 } });
    const p = mapPaths(v, lay);
    const x0 = lay.ox + 5 * lay.cell;
    const y0 = lay.oy + 7 * lay.cell;
    // 床は 1 枚だけ（px+1..px+cell-1）
    expect(p.floor).toBe(`M${x0 + 1} ${y0 + 1}h7v7h-7Z`);
    // 線はすべてセル (5,7) の枠の上
    const segs = segments(p.walls);
    expect(segs).toHaveLength(4);
    for (const s of segs) {
      for (const [x, y] of [
        [s.x1, s.y1],
        [s.x2, s.y2],
      ] as const) {
        expect(x).toBeGreaterThanOrEqual(x0);
        expect(x).toBeLessThanOrEqual(x0 + 8);
        expect(y).toBeGreaterThanOrEqual(y0);
        expect(y).toBeLessThanOrEqual(y0 + 8);
      }
    }
    expect(p.stairs).toBe("");
    // 空の cells なら床も線も無い
    const empty = mapPaths(view([]), lay);
    expect(empty.floor).toBe("");
    expect(empty.walls).toBe("");
    expect(points(empty.player)).toHaveLength(3);
  });
});

describe("UI-24/DG-10 通り抜けた扉の地図（core の mapView との結合）", () => {
  test("UI-24/DG-10 扉を通り抜けた後も、mapView はその辺を door で返し、地図は両側どちらから見ても中央 4px の隙間で描く（全長の壁にも open にもならない）", () => {
    const DIRS: Array<{ f: Facing; key: "n" | "e" | "s" | "w"; dx: number; dy: number }> = [
      { f: "N", key: "n", dx: 0, dy: -1 },
      { f: "E", key: "e", dx: 1, dy: 0 },
      { f: "S", key: "s", dx: 0, dy: 1 },
      { f: "W", key: "w", dx: -1, dy: 0 },
    ];
    let checked = 0;
    for (let seed = 1; seed <= 20 && checked < 3; seed++) {
      const s0 = execute(newGame(seed), { type: "dungeon.enter", dungeonId: "d01" }, data).state;
      const f = floorOf(s0.dive!, data);
      // 扉の手前（扉のある辺を向いて立つ位置）を 1 つ探す
      let found: { x: number; y: number; d: (typeof DIRS)[number] } | null = null;
      for (let i = 0; i < f.cells.length && found === null; i++) {
        const c = f.cells[i]!;
        for (const d of DIRS) if (c[d.key] === "door") found = { x: i % f.width, y: Math.floor(i / f.width), d };
      }
      if (found === null) continue;
      const placed = cloneState(s0);
      placed.dive!.pos = { x: found.x, y: found.y };
      placed.dive!.facing = found.d.f;
      const r = execute(placed, { type: "dungeon.move" }, data);
      const to = { x: found.x + found.d.dx, y: found.y + found.d.dy };
      if (r.state.dive?.pos.x !== to.x || r.state.dive?.pos.y !== to.y) continue; // 遭遇などで止まった場合は別のシード
      // 反転して扉を通って戻る。これで扉の両側のセルが探索済みになり、地図は両側のセルの値から描かれうる
      const turned = execute(r.state, { type: "dungeon.turn", dir: "around" }, data);
      const r2 = execute(turned.state, { type: "dungeon.move" }, data);
      if (r2.state.dive?.pos.x !== found.x || r2.state.dive?.pos.y !== found.y) continue; // 遭遇などで止まった場合は別のシード
      const v = mapView(r2.state, data)!;
      const here = v.cells.find((c) => c.x === to.x && c.y === to.y);
      const there = v.cells.find((c) => c.x === found.x && c.y === found.y);
      expect(here, `seed ${seed} 行き先のセルが探索済み`).toBeDefined();
      expect(there, `seed ${seed} 元のセルが探索済み`).toBeDefined();
      const back = { N: "s", E: "w", S: "n", W: "e" } as const;
      expect(here![back[found.d.f]], `seed ${seed} 行き先の側`).toBe("door");
      expect(there![found.d.key], `seed ${seed} 元の側`).toBe("door");
      const lay = mapLayout(v.width, v.height, MAP_AREA);
      const segs = segments(mapPaths(v, lay).walls);
      // 共有辺の位置（扉の向きで横の辺か縦の辺か）
      const vertical = found.d.f === "E" || found.d.f === "W";
      const ex = lay.ox + Math.max(found.x, to.x) * lay.cell;
      const ey = lay.oy + Math.max(found.y, to.y) * lay.cell;
      const onEdge = vertical
        ? segs.filter((g) => g.x1 === ex && g.x2 === ex && g.y1 >= lay.oy + to.y * lay.cell && g.y2 <= lay.oy + (to.y + 1) * lay.cell)
        : segs.filter((g) => g.y1 === ey && g.y2 === ey && g.x1 >= lay.ox + to.x * lay.cell && g.x2 <= lay.ox + (to.x + 1) * lay.cell);
      expect(onEdge, `seed ${seed}`).toHaveLength(2);
      const len = (g: Seg): number => Math.abs(g.x2 - g.x1) + Math.abs(g.y2 - g.y1);
      expect(onEdge.map(len), `seed ${seed}`).toEqual([2, 2]);
      checked++;
    }
    expect(checked).toBe(3);
  });
});

describe("UI-25 地図のタップ（吸着）", () => {
  // 20×20 は cell 8・ox 39・oy 23。セル (x, y) の中心は (43+8x, 27+8y)
  test("UI-25 mapSnapCell: 中心まで maxPx 以内の探索済みのセルのうち一番近いもの。同じ距離なら y、次に x の小さい方。境界ちょうどは含む", () => {
    const lay = mapLayout(20, 20, MAP_AREA);
    expect(lay).toEqual({ cell: 8, ox: 39, oy: 23 });
    const two = view([cellOf(0, 0), cellOf(1, 0)]);
    // (55,27): (1,0) の中心 (51,27) まで 4、(0,0) の中心 (43,27) まで 12 → (1,0)
    expect(mapSnapCell(two, lay, 55, 27, 12)).toEqual({ x: 1, y: 0 });
    // (47,27): どちらも距離 4 → x の小さい (0,0)
    expect(mapSnapCell(two, lay, 47, 27, 12)).toEqual({ x: 0, y: 0 });
    const one = view([cellOf(0, 0)]);
    // (55,27) は (0,0) の中心から 12 ちょうど → 吸着する。(56,27) は 13 → null
    expect(mapSnapCell(one, lay, 55, 27, 12)).toEqual({ x: 0, y: 0 });
    expect(mapSnapCell(one, lay, 56, 27, 12)).toBeNull();
    // 斜め: (43+8, 27+9) は sqrt(64+81) ≈ 12.04 > 12 → null。(43+8, 27+8) は ≈ 11.31 → 吸着
    expect(mapSnapCell(one, lay, 51, 36, 12)).toBeNull();
    expect(mapSnapCell(one, lay, 51, 35, 12)).toEqual({ x: 0, y: 0 });
    // 縦の同距離: (0,0) と (0,1) の中心 (43,27)・(43,35) から等距離の (43,31) → y の小さい (0,0)
    const col = view([cellOf(0, 1), cellOf(0, 0)]);
    expect(mapSnapCell(col, lay, 43, 31, 12)).toEqual({ x: 0, y: 0 });
    // 盤の外（地図本体の左上の余白）でも、12 以内に探索済みのセルがあれば吸着する
    expect(mapSnapCell(one, lay, 35, 20, 12)).toEqual({ x: 0, y: 0 });
    expect(mapSnapCell(one, lay, Number.NaN, 27, 12)).toBeNull();
  });

  test("UI-25 mapSnapCell: 座標の換算の誤差（1e-9 程度）で片方がわずかに近くなっても、ほぼ同じ距離は同順位として y、次に x の小さい方を選ぶ。はっきり近い方（0.01px）は近い方", () => {
    const lay = mapLayout(20, 20, MAP_AREA);
    // (11,5) と (11,6) の中心は (131,67)・(131,75)。実機の (131.5, 71) 相当に、(11,6) 寄りの誤差を足す
    const col = view([cellOf(11, 6), cellOf(11, 5)]);
    expect(mapSnapCell(col, lay, 131.5, 71 + 1e-9, 12)).toEqual({ x: 11, y: 5 });
    expect(mapSnapCell(col, lay, 131.5, 71 - 1e-9, 12)).toEqual({ x: 11, y: 5 });
    expect(mapSnapCell(col, lay, 131.5, 71.01, 12)).toEqual({ x: 11, y: 6 });
    // 横: (3,2) と (4,2) の中心 (67,43)・(75,43) の中ほど。(4,2) 寄りの誤差でも x の小さい (3,2)
    const row = view([cellOf(4, 2), cellOf(3, 2)]);
    expect(mapSnapCell(row, lay, 71 + 3e-10, 44, 12)).toEqual({ x: 3, y: 2 });
    expect(mapSnapCell(row, lay, 71.01, 44, 12)).toEqual({ x: 4, y: 2 });
  });

  test("UI-25 mapSnapCell は探索済みでないセルには吸着しない（すぐ上のセルが未探索なら、離れた探索済みのセルか null）", () => {
    const lay = mapLayout(20, 20, MAP_AREA);
    // (5,5) の中心 (83,67) の真上をタップ。探索済みは (5,6)（中心 (83,75)、距離 8）だけ
    expect(mapSnapCell(view([cellOf(5, 6)]), lay, 83, 67, 12)).toEqual({ x: 5, y: 6 });
    // 探索済みが (5,7)（中心 (83,83)、距離 16）だけなら null
    expect(mapSnapCell(view([cellOf(5, 7)]), lay, 83, 67, 12)).toBeNull();
    expect(mapSnapCell(view([]), lay, 83, 67, 12)).toBeNull();
  });

  test("UI-25 mapSnapCell は mapPaths の床の正方形の内側の点を、すべての探索済みのセルの中からそのセルに吸着させる（30×30、cell 6）", () => {
    const lay = mapLayout(30, 30, MAP_AREA);
    const cells: MapCell[] = [];
    for (let y = 10; y <= 12; y++) for (let x = 6; x <= 8; x++) cells.push(cellOf(x, y));
    const v = view(cells, { width: 30, height: 30 });
    const target = view([cellOf(7, 11)], { width: 30, height: 30 });
    const [[fx, fy]] = points(mapPaths(target, lay).floor) as [[number, number]];
    for (let dx = 0; dx < lay.cell - 1; dx++) {
      for (let dy = 0; dy < lay.cell - 1; dy++) expect(mapSnapCell(v, lay, fx + dx + 0.5, fy + dy + 0.5, 12)).toEqual({ x: 7, y: 11 });
    }
  });

  test("UI-25 mapTapAction: 選んでいるセルの再タップは go、経路 null は noRoute、[]（現在位置）は none、それ以外は pick", () => {
    const a = { x: 3, y: 4 };
    const b = { x: 5, y: 4 };
    const route = [{ type: "dungeon.move" }];
    expect(mapTapAction(null, a, route)).toBe("pick");
    expect(mapTapAction(a, { x: 3, y: 4 }, route)).toBe("go");
    // 同じセルなら経路を見ない（歩き出すときに引き直す）
    expect(mapTapAction(a, { x: 3, y: 4 }, null)).toBe("go");
    expect(mapTapAction(a, b, route)).toBe("pick");
    expect(mapTapAction(a, b, null)).toBe("noRoute");
    expect(mapTapAction(null, b, null)).toBe("noRoute");
    expect(mapTapAction(a, b, [])).toBe("none");
    expect(mapTapAction(null, b, [])).toBe("none");
  });

  test("UI-25 mapPickPath は選んだセルの外形（壁の線と同じ位置の cell 角の正方形）", () => {
    const lay = mapLayout(20, 20, MAP_AREA);
    // (5,12): px = 39+40 = 79、py = 23+96 = 119
    expect(mapPickPath({ x: 5, y: 12 }, lay)).toBe("M79 119h8v8h-8Z");
  });
});

// ---------------------------------------------------------------- DOM（偽の document）
type FakeAnim = { options: Record<string, unknown>; cancelled: boolean; cancel(): void };

class FakeEl {
  style: Record<string, string> = {};
  className = "";
  textContent = "";
  children: FakeEl[] = [];
  attrs: Record<string, string> = {};
  anims: FakeAnim[] = [];
  appendChild(c: FakeEl): FakeEl {
    this.children.push(c);
    return c;
  }
  append(...c: FakeEl[]): void {
    this.children.push(...c);
  }
  setAttribute(k: string, v: string): void {
    this.attrs[k] = v;
  }
  addEventListener(): void {}
  animate(_k: unknown, options: Record<string, unknown>): FakeAnim {
    const a: FakeAnim = {
      options,
      cancelled: false,
      cancel() {
        a.cancelled = true;
      },
    };
    this.anims.push(a);
    return a;
  }
}

function fakeDocument(): { svgs: FakeEl[]; paths: FakeEl[] } {
  const svgs: FakeEl[] = [];
  const paths: FakeEl[] = [];
  vi.stubGlobal("document", {
    createElement: (): FakeEl => new FakeEl(),
    createElementNS: (_ns: string, tag: string): FakeEl => {
      const e = new FakeEl();
      if (tag === "svg") svgs.push(e);
      if (tag === "path") paths.push(e);
      return e;
    },
  });
  return { svgs, paths };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("UI-25 地図のビュー（偽の DOM）", () => {
  const L = dungeonLayout(regions(data.config.ui.layout, data.config.stage.width), data.config.party.size);
  /** 選んだセルの枠の path（stroke が accent の最後の path。M11 で宝箱の □ も accent になったので、最初ではなく最後に作る枠を取る） */
  const pickOf = (paths: FakeEl[]): FakeEl => [...paths].reverse().find((p) => p.attrs["stroke"] === "var(--c-accent)")!;

  test("UI-72 render は宝箱の □（mapPaths の chests）を accent の線の path に入れる。重ね順は罠の × の後・現在位置の前", () => {
    const { svgs, paths } = fakeDocument();
    const m = createMapView(L.map, () => {}, data.config.ui.mapSnapPx);
    const v = view([cellOf(0, 0, { kind: "chest" }), cellOf(1, 0, { kind: "trap" }), cellOf(2, 0)], { pos: { x: 2, y: 0 } });
    m.render(v, "t");
    const p = mapPaths(v, mapLayout(v.width, v.height, L.map.area));
    expect(p.chests).not.toBe("");
    const chests = paths.filter((e) => e.attrs["d"] === p.chests);
    expect(chests).toHaveLength(1);
    expect(chests[0]!.attrs["stroke"]).toBe("var(--c-accent)");
    expect(chests[0]!.attrs["fill"]).toBe("none");
    const g = svgs[0]!.children.find((c) => c.children.length > 0)!;
    const order = g.children;
    const traps = order.findIndex((e) => e.attrs["d"] === p.traps);
    const chest = order.indexOf(chests[0]!);
    const player = order.findIndex((e) => e.attrs["d"] === p.player);
    expect(traps).toBeGreaterThanOrEqual(0);
    expect(traps).toBeLessThan(chest);
    expect(chest).toBeLessThan(player);
    // 選んだ枠は宝箱の □ とは別の path
    expect(pickOf(paths)).not.toBe(chests[0]);
  });

  test("UI-25 地図本体のタップは config.ui.mapSnapPx 以内の探索済みのセルに吸着したときだけ onCell を呼ぶ（範囲外は呼ばない）", () => {
    const { svgs } = fakeDocument();
    const got: unknown[] = [];
    const m = createMapView(L.map, (p) => got.push(p), data.config.ui.mapSnapPx);
    m.render(view([cellOf(0, 0), cellOf(1, 0)]), "t");
    const tap = tapSpecOf(svgs[0]!)!;
    tap.onTap({ lx: 55, ly: 27 }); // (1,0) に距離 4
    tap.onTap({ lx: 47, ly: 40 }); // (0,0) の中心 (43,27) から sqrt(16+169) ≈ 13.6、(1,0) からも同じ → 範囲外
    tap.onTap({ lx: 63, ly: 27 }); // (1,0) の中心 (51,27) から 12 ちょうど
    tap.onTap({ lx: 64, ly: 27 }); // 13 → 範囲外
    expect(got).toEqual([
      { x: 1, y: 0 },
      { x: 1, y: 0 },
    ]);
  });

  test("UI-25 setPick: blink なら枠を点滅（iterations Infinity・周期 MAP_PICK_BLINK_MS）。切り替え・null・render で cancel。blink 偽では animate を呼ばず枠だけ", () => {
    const { paths } = fakeDocument();
    const m = createMapView(L.map, () => {}, data.config.ui.mapSnapPx);
    m.render(view([cellOf(0, 0), cellOf(5, 12)]), "t");
    const pick = pickOf(paths);
    expect(pick.attrs["d"]).toBe("");
    m.setPick({ x: 5, y: 12 }, true);
    expect(pick.attrs["d"]).toBe("M79 119h8v8h-8Z");
    expect(pick.anims).toHaveLength(1);
    expect(pick.anims[0]!.options).toEqual({ duration: MAP_PICK_BLINK_MS, iterations: Infinity });
    // 切り替え: 前の点滅を止めて新しい点滅
    m.setPick({ x: 0, y: 0 }, true);
    expect(pick.anims[0]!.cancelled).toBe(true);
    expect(pick.anims).toHaveLength(2);
    expect(pick.attrs["d"]).toBe("M39 23h8v8h-8Z");
    // null: 止めて消す
    m.setPick(null, true);
    expect(pick.anims[1]!.cancelled).toBe(true);
    expect(pick.attrs["d"]).toBe("");
    // render: 止めて消す
    m.setPick({ x: 0, y: 0 }, true);
    m.render(view([cellOf(0, 0)]), "t");
    expect(pick.anims[2]!.cancelled).toBe(true);
    expect(pick.attrs["d"]).toBe("");
    // 演出スキップ（blink 偽）: 枠だけで animate を呼ばない
    m.setPick({ x: 0, y: 0 }, false);
    expect(pick.attrs["d"]).toBe("M39 23h8v8h-8Z");
    expect(pick.anims).toHaveLength(3);
  });
});

// UI-72 / DG-25（M11）: core の実際の state から描く（宝箱のセルの印の出入りと、転移の後の地図の連続）
describe("UI-72 宝箱の印と転移の後の地図（core の state から）", () => {
  const run = (s: ReturnType<typeof newGame>, cmd: Parameters<typeof execute>[1]) => {
    const r = execute(s, cmd, data);
    expect(r.events[0]?.kind, JSON.stringify(r.events[0])).not.toBe("rejected");
    return r.state;
  };
  const dived = (seed: number) => run(newGame(seed), { type: "dungeon.enter", dungeonId: "d01" });
  const floorSquare = (v: MapView, x: number, y: number): string => {
    const lay = mapLayout(v.width, v.height, MAP_AREA);
    const px = lay.ox + x * lay.cell;
    const py = lay.oy + y * lay.cell;
    return `M${px + 1} ${py + 1}h${lay.cell - 1}v${lay.cell - 1}h${-(lay.cell - 1)}Z`;
  };

  test("UI-72 宝箱の前（debug.warp chest）では線画の正面の奥行き 1 に cC1、踏むと足元に cC0 と地図にそのセルの □。開けた後は線画にも地図にも出ない", () => {
    // 踏んだときに衝動で開けてしまわない（箱が残る）最初のシード
    const seed = Array.from({ length: 30 }, (_, i) => i + 1).find((k) => {
      const w = run(dived(k), { type: "debug.warp", to: "chest" });
      return run(w, { type: "dungeon.move" }).dive!.chest !== null;
    })!;
    expect(seed).toBeDefined();
    const s0 = run(dived(seed), { type: "debug.warp", to: "chest" });
    expect(visibleChests(s0, data)).toContainEqual({ depth: 1, lane: 0 });
    expect(slotsFor(visibleCells(s0, data), visibleKnownTraps(s0, data), visibleChests(s0, data)).has("cC1")).toBe(true);
    const s1 = run(s0, { type: "dungeon.move" });
    expect(s1.dive!.chest).not.toBeNull();
    const v1 = mapView(s1, data)!;
    const lay1 = mapLayout(v1.width, v1.height, MAP_AREA);
    const at = s1.dive!.pos;
    expect(mapPaths(v1, lay1).chests).toContain(`M${lay1.ox + at.x * lay1.cell + 2} ${lay1.oy + at.y * lay1.cell + 2}H`);
    expect(slotsFor(visibleCells(s1, data), visibleKnownTraps(s1, data), visibleChests(s1, data)).has("cC0")).toBe(true);
    const s2 = run(s1, { type: "chest.open" });
    expect(s2.dive!.chest).toBeNull();
    const v2 = mapView(s2, data)!;
    expect(v2.cells.find((c) => c.x === at.x && c.y === at.y)!.kind).toBe("plain");
    expect(mapPaths(v2, mapLayout(v2.width, v2.height, MAP_AREA)).chests).not.toContain(`M${lay1.ox + at.x * lay1.cell + 2} ${lay1.oy + at.y * lay1.cell + 2}H`);
    expect([...slotsFor(visibleCells(s2, data), visibleKnownTraps(s2, data), visibleChests(s2, data))].filter((id) => id === "cC0")).toEqual([]);
  });

  test("UI-72/DG-25 転移の罠で移った後の地図は、転移の前の区画と行き先の区画の床を両方描き、現在位置の三角形は行き先にある", () => {
    const s0 = run(dived(1), { type: "debug.chest", trapId: "teleport" });
    const from = s0.dive!.pos;
    const s1 = run(s0, { type: "chest.open" });
    const to = s1.dive!.pos;
    expect(to).not.toEqual(from);
    const v = mapView(s1, data)!;
    const p = mapPaths(v, mapLayout(v.width, v.height, MAP_AREA));
    expect(p.floor).toContain(floorSquare(v, from.x, from.y));
    expect(p.floor).toContain(floorSquare(v, to.x, to.y));
    const lay = mapLayout(v.width, v.height, MAP_AREA);
    const tri = playerTriangle(v.facing, lay.cell);
    expect(p.player.startsWith(`M${lay.ox + to.x * lay.cell + tri[0]![0]} ${lay.oy + to.y * lay.cell + tri[0]![1]}`)).toBe(true);
  });
});
