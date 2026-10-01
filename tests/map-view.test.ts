import { describe, expect, test } from "vitest";
import { execute } from "../src/core/engine";
import { floorOf, mapView } from "../src/core/rules/dungeon";
import { cloneState } from "../src/core/state";
import { mapLayout, mapPaths, playerTriangle } from "../src/presenter/views/map";
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
      const v = mapView(r.state, data)!;
      const here = v.cells.find((c) => c.x === to.x && c.y === to.y)!;
      const back = { N: "s", E: "w", S: "n", W: "e" } as const;
      expect(here[back[found.d.f]], `seed ${seed}`).toBe("door");
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
