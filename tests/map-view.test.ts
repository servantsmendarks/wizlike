import { afterEach, describe, expect, test, vi } from "vitest";
import { execute } from "../src/core/engine";
import { floorOf, mapView, visibleCells, visibleChests, visibleKnownTraps } from "../src/core/rules/dungeon";
import { slotsFor } from "../src/presenter/views/dungeon-geometry";
import { cloneState } from "../src/core/state";
import { tapSpecOf } from "../src/presenter/input/tap";
import {
  createMapView,
  exitD,
  LEGEND_COL_W,
  MAP_LEGEND_KEYS,
  MAP_PICK_BLINK_MS,
  mapLayout,
  mapLegendPaths,
  mapFramePath,
  mapNoteBothFit,
  mapNotes,
  mapPaths,
  mapPickPath,
  mapSnapCell,
  mapTapAction,
  playerTriangle,
} from "../src/presenter/views/map";
import type { Edge, Facing, MapCell, MapView } from "../src/core/types";
import { dungeonLayout, regions } from "../src/presenter/layout";
import { data, newGame } from "./helpers/core";

/** 既定の config.ui.layout での地図本体の寸法（M19 から 240×262。M18 までは 240×208） */
const MAP_AREA = dungeonLayout(regions(data.config.ui.layout, data.config.stage.width), data.config.party.size).map.area;
/** M18 までの 20×20 の配置（cell 8・ox 39・oy 23）。記号の形と吸着の規則を cell 8 の数で見るテストに使う（mapPaths・mapSnapCell は lay をそのまま使う） */
const LAY8 = { cell: 8, ox: 39, oy: 23 } as const;
/** cell 6 の配置（M18 までの 30×30）。8 基準の相対座標の丸めを見る */
const LAY6 = { cell: 6, ox: 29, oy: 13 } as const;

function cellOf(x: number, y: number, p: Partial<MapCell> = {}): MapCell {
  return { x, y, kind: "plain", n: "wall", e: "wall", s: "wall", w: "wall", exits: [], ...p };
}

function view(cells: MapCell[], o: Partial<MapView> = {}): MapView {
  const unexploredExits = cells.reduce((a, c) => a + c.exits.length, 0);
  return { dungeonId: "d01", floor: 1, width: 20, height: 20, pos: { x: 0, y: 0 }, facing: "N", cells, unexploredExits, ...o };
}

/** "M x y H x2" / "M x y V y2" の線分に分解する（mapPaths の walls の書式） */
type Seg = { x1: number; y1: number; x2: number; y2: number };
function segments(d: string): Seg[] {
  const out: Seg[] = [];
  const re = /M(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)([HV])(-?\d+(?:\.\d+)?)/g;
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
  test("UI-24（M19）mapLayout(20,20, 地図本体 240×262) = {cell 11, ox 9, oy 20}（盤 221×221）。mapLayout(30,30) = {7, 14, 25}。どの寸法でも領域に収まり cell ≤ 11", () => {
    expect(MAP_AREA).toMatchObject({ w: 240, h: 262 });
    // 20×20: cell = min(11, floor(239/20)=11, floor(261/20)=13) = 11。幅 20*11+1 = 221。ox = floor(19/2) = 9、oy = floor(41/2) = 20
    expect(mapLayout(20, 20, MAP_AREA)).toEqual({ cell: 11, ox: 9, oy: 20 });
    // 30×30: cell = min(11, 7, 8) = 7。幅 211。ox = floor(29/2) = 14、oy = floor(51/2) = 25
    expect(mapLayout(30, 30, MAP_AREA)).toEqual({ cell: 7, ox: 14, oy: 25 });
    // M18 までの地図本体 240×208 では 20×20 は cell 10（M18 の上限 8 を 11 に上げたので）
    expect(mapLayout(20, 20, { w: 240, h: 208 }).cell).toBe(10);
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
      expect(l.cell).toBeLessThanOrEqual(11);
    }
  });

  test("UI-24（M19）mapFramePath は盤の外周の枠線（外周の壁の線と同じ位置）。20×20 は (9,20) から 220 四方", () => {
    const lay = mapLayout(20, 20, MAP_AREA);
    expect(mapFramePath(20, 20, lay)).toBe("M9 20h220v220h-220Z");
    expect(mapFramePath(30, 20, LAY6)).toBe("M29 13h180v120h-180Z");
    // 外周の壁（(0,0) の北と西、(19,19) の南と東）は枠線の上に乗る
    const segs = segments(mapPaths(view([cellOf(0, 0), cellOf(19, 19)]), lay).walls);
    expect(segs).toContainEqual({ x1: 9, y1: 20, x2: 20, y2: 20 });
    expect(segs).toContainEqual({ x1: 9, y1: 20, x2: 9, y2: 31 });
    expect(segs).toContainEqual({ x1: 218, y1: 240, x2: 229, y2: 240 });
    expect(segs).toContainEqual({ x1: 229, y1: 229, x2: 229, y2: 240 });
  });

  test("UI-24（M19）mapNotes: 凡例は盤の下端に重ねる。20×20 は盤の下端の線 240 の 2px 上を下端に 2 行 × 4 列（列幅 58。x 4・62・120・178、y 218・228）、地は x2..237・y216..239。順は MAP_LEGEND_KEYS", () => {
    expect(MAP_LEGEND_KEYS).toEqual(["self", "up", "down", "chest", "trap", "wall", "exit"]);
    expect(LEGEND_COL_W).toBe(58);
    const n = mapNotes(20, 20, MAP_AREA);
    expect(n.legend).toEqual([
      { key: "self", x: 4, y: 218 },
      { key: "up", x: 62, y: 218 },
      { key: "down", x: 120, y: 218 },
      { key: "chest", x: 178, y: 218 },
      { key: "trap", x: 4, y: 228 },
      { key: "wall", x: 62, y: 228 },
      { key: "exit", x: 120, y: 228 },
    ]);
    expect(n.legendBox).toEqual({ x: 2, y: 216, w: 236, h: 24 });
  });

  test("UI-24（M19）mapNotes は盤の大きさから計算し、どの寸法でも凡例と地は地図本体の内側で、盤の下端の線より上。入らなければ（盤が低すぎる）出さない", () => {
    for (let w = 1; w <= 60; w++) {
      for (const h of [1, 2, 3, 5, 10, 19, 20, 21, 22, 23, 24, 25, 26, 30, 40, 60]) {
        const l = mapLayout(w, h, MAP_AREA);
        const n = mapNotes(w, h, MAP_AREA);
        const boardBottom = l.oy + h * l.cell; // 下端の線の画素番号
        expect(n.legend === null).toBe(n.legendBox === null);
        if (n.legend === null || n.legendBox === null) continue;
        const b = n.legendBox;
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.y).toBeGreaterThanOrEqual(0);
        expect(b.x + b.w).toBeLessThanOrEqual(MAP_AREA.w);
        expect(b.y + b.h).toBeLessThanOrEqual(boardBottom);
        for (const it of n.legend) {
          expect(it.y).toBeGreaterThanOrEqual(b.y);
          expect(it.y + 10).toBeLessThanOrEqual(b.y + b.h);
          expect(it.x).toBeGreaterThanOrEqual(b.x);
          expect(it.x + LEGEND_COL_W).toBeLessThanOrEqual(b.x + b.w);
        }
      }
    }
    // 地（24px）が地図本体に入らない（盤の下端の線が y22 未満）なら出さない
    expect(mapNotes(1, 1, { w: 240, h: 20 })).toEqual({ legend: null, legendBox: null });
    expect(mapNotes(4, 2, { w: 232, h: 262 })).toEqual({ legend: null, legendBox: null });
    expect(mapNotes(20, 20, MAP_AREA).legend).not.toBeNull();
  });

  test("UI-24/UI-25/UI-78（M19）mapNoteBothFit: 注記の行（幅 240、左右 4）に tapHint と「未踏の口 {n}」が間 8 で入るか。今の文は n が 3 けたまで入る", () => {
    const hint = data.strings["map.tapHint"]!;
    const un = (n: number): string => data.strings["map.unexplored"]!.replace("{n}", String(n));
    expect(mapNoteBothFit(hint, un(0), MAP_AREA.w)).toBe(true);
    expect(mapNoteBothFit(hint, un(999), MAP_AREA.w)).toBe(true);
    // 境界: 単位 × 4 + 8 ≤ 232
    expect(mapNoteBothFit("あ".repeat(28), "", 240)).toBe(true);
    expect(mapNoteBothFit("あ".repeat(28), "1", 240)).toBe(false);
    expect(mapNoteBothFit("あ".repeat(28), "1", 244)).toBe(true);
    expect(mapNoteBothFit("あ".repeat(20), "1".repeat(16), 240)).toBe(true);
    expect(mapNoteBothFit("あ".repeat(20), "1".repeat(17), 240)).toBe(false);
  });

  test("UI-24（M16）凡例の記号は盤と同じ path（cell 8）を記号の箱 (x, y+1) に描く。wall は箱の中ほどの横線", () => {
    const n = mapNotes(20, 20, MAP_AREA);
    const p = mapLegendPaths(n.legend!);
    // 盤の (px, py) = (x, y+1) に置いた各記号と同じ
    const at = (key: string): { x: number; y: number } => n.legend!.find((it) => it.key === key)!;
    const same = (cell: MapCell, ox: number, oy: number): ReturnType<typeof mapPaths> =>
      mapPaths(view([cell], { width: 1, height: 1, pos: { x: 0, y: 0 } }), { cell: 8, ox, oy });
    const up = at("up");
    const down = at("down");
    expect(p.stairs).toBe(same(cellOf(0, 0, { kind: "stairsUp" }), up.x, up.y + 1).stairs + same(cellOf(0, 0, { kind: "stairsDown" }), down.x, down.y + 1).stairs);
    const chest = at("chest");
    expect(p.chests).toBe(same(cellOf(0, 0, { kind: "chest" }), chest.x, chest.y + 1).chests);
    const trap = at("trap");
    expect(p.traps).toBe(same(cellOf(0, 0, { kind: "trap" }), trap.x, trap.y + 1).traps);
    const self = at("self");
    expect(p.player).toBe(same(cellOf(0, 0), self.x, self.y + 1).player);
    const wall = at("wall");
    expect(p.walls).toBe(`M${wall.x} ${wall.y + 5}H${wall.x + 8}`);
    // UI-78（M18。M19 で点線に）: 未踏は wall と同じ高さ（y+5）の横の辺に沿った点線（盤の open の辺と同じ 1〜2・3.5〜4.5・6〜7）
    const exit = at("exit");
    expect(p.exits).toBe(`M${exit.x + 1} ${exit.y + 5}H${exit.x + 2}M${exit.x + 3.5} ${exit.y + 5}H${exit.x + 4.5}M${exit.x + 6} ${exit.y + 5}H${exit.x + 7}`);
    expect(p.exits).toBe(exitD(exit.x, exit.y + 5, "n", 8));
  });

  test("UI-78（M18・M19）exits は口の辺の上に辺に沿った長さ 1 の点線 3 本（cell 8 で 1〜2・3.5〜4.5・6〜7）。door の辺は中央の 1 本だけ。4 方向、exits が空なら描かない。色は accent", () => {
    const lay = LAY8;
    const px = lay.ox + 5 * 8;
    const py = lay.oy + 7 * 8;
    const p = mapPaths(view([cellOf(5, 7, { n: "open", e: "door", s: "open", w: "open", exits: ["n", "e", "s", "w"] })]), lay);
    expect(p.exits).toBe(
      `M${px + 1} ${py}H${px + 2}M${px + 3.5} ${py}H${px + 4.5}M${px + 6} ${py}H${px + 7}` +
        `M${px + 8} ${py + 3.5}V${py + 4.5}` +
        `M${px + 1} ${py + 8}H${px + 2}M${px + 3.5} ${py + 8}H${px + 4.5}M${px + 6} ${py + 8}H${px + 7}` +
        `M${px} ${py + 1}V${py + 2}M${px} ${py + 3.5}V${py + 4.5}M${px} ${py + 6}V${py + 7}`,
    );
    expect(mapPaths(view([cellOf(5, 7, { n: "open" })]), lay).exits).toBe("");
    // cell 6 では端の 2 本を sc(1)=1 から（1〜2・4〜5）、中央は 2.5〜3.5
    expect(exitD(0, 10, "n", 6)).toBe("M1 10H2M2.5 10H3.5M4 10H5");
    expect(exitD(0, 10, "w", 6, true)).toBe("M0 12.5V13.5");
    // cell 11（M19 の 20×20）では sc(1)=1 から（1〜2・9〜10）、中央は 5〜6
    expect(exitD(0, 10, "n", 11)).toBe("M1 10H2M5 10H6M9 10H10");
  });

  test("UI-78（M19）点線の線分はすべて口のあるセルの矩形（辺を含む）の中にあり、ほかのセルの内側に入らない。辺の上に乗り、辺の両端（角）には届かない。door の 1 本は扉の線（両端 2px）と重ならない", () => {
    const lay = mapLayout(20, 20, MAP_AREA);
    const edges: Edge[] = ["open", "door"];
    for (const cell of [11, 10, 8, 7, 6]) {
      const l = { ...lay, cell };
      for (const e of edges) {
        for (const d of ["n", "e", "s", "w"] as const) {
          const c = cellOf(5, 7, { [d]: e, exits: [d] });
          const px = l.ox + 5 * cell;
          const py = l.oy + 7 * cell;
          const segs = segments(mapPaths(view([c]), l).exits);
          expect(segs.length).toBe(e === "door" ? 1 : 3);
          for (const sg of segs) {
            // 口のあるセルの矩形（辺を含む）の中
            for (const [x, y] of [[sg.x1, sg.y1], [sg.x2, sg.y2]] as const) {
              expect(x >= px && x <= px + cell && y >= py && y <= py + cell).toBe(true);
            }
            // 辺の上（n は y = py、s は y = py+cell、w は x = px、e は x = px+cell）で、辺に沿う
            const on = d === "n" ? sg.y1 === py && sg.y2 === py : d === "s" ? sg.y1 === py + cell && sg.y2 === py + cell : d === "w" ? sg.x1 === px && sg.x2 === px : sg.x1 === px + cell && sg.x2 === px + cell;
            expect(on).toBe(true);
            // 長さ 1、角（辺の両端）に届かない
            const [lo, hi] = d === "n" || d === "s" ? [Math.min(sg.x1, sg.x2) - px, Math.max(sg.x1, sg.x2) - px] : [Math.min(sg.y1, sg.y2) - py, Math.max(sg.y1, sg.y2) - py];
            expect(hi - lo).toBe(1);
            expect(lo > 0 && hi < cell).toBe(true);
            // door の扉の線（0〜2 と cell-2〜cell）と重ならない
            if (e === "door") expect(lo >= 2 && hi <= cell - 2).toBe(true);
          }
        }
      }
    }
  });

  test("UI-24 mapLayout は渡した領域の寸法に合わせる（ui §2 の区切りで地図本体の高さが変わる）", () => {
    // 240×218: 30×30 は cell = min(11, 7, floor(217/30)=7) = 7。幅 211。ox = floor(29/2) = 14、oy = floor(7/2) = 3
    expect(mapLayout(30, 30, { w: 240, h: 218 })).toEqual({ cell: 7, ox: 14, oy: 3 });
    // 240×202: 20×20 は cell = min(11, 11, floor(201/20)=10) = 10。幅・高さ 201。ox = floor(39/2) = 19、oy = floor(1/2) = 0
    expect(mapLayout(20, 20, { w: 240, h: 202 })).toEqual({ cell: 10, ox: 19, oy: 0 });
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
    const lay = LAY8;
    const v = view([cellOf(2, 3, { kind: "stairsDown" }), cellOf(3, 3, { kind: "stairsUp" })], { pos: { x: 2, y: 3 }, facing: "E" });
    const p = mapPaths(v, lay);
    const px = 39 + 2 * 8;
    const py = 23 + 3 * 8;
    expect(p.player).toBe(`M${px + 7} ${py + 4}L${px + 2} ${py + 7}L${px + 2} ${py + 1}Z`);
    expect(p.stairs).toBe(`M${px + 2} ${py + 3}L${px + 4} ${py + 5}L${px + 6} ${py + 3}` + `M${px + 8 + 2} ${py + 5}L${px + 8 + 4} ${py + 3}L${px + 8 + 6} ${py + 5}`);
  });

  test("UI-24 kind trap のセル（察知した罠）は traps に × の 2 本（cell 8 で M2 2L6 6M6 2L2 6 を原点に足したもの）を出し、stairs には出さない。plain・階段のセルは traps に出さない", () => {
    const lay = LAY8;
    const v = view([cellOf(2, 3, { kind: "trap" }), cellOf(3, 3, { kind: "stairsDown" }), cellOf(4, 3)], { pos: { x: 4, y: 3 } });
    const p = mapPaths(v, lay);
    const px = 39 + 2 * 8;
    const py = 23 + 3 * 8;
    expect(p.traps).toBe(`M${px + 2} ${py + 2}L${px + 6} ${py + 6}M${px + 6} ${py + 2}L${px + 2} ${py + 6}`);
    // 階段の V は (3,3) の 1 つだけ
    expect(p.stairs).toBe(`M${px + 8 + 2} ${py + 3}L${px + 8 + 4} ${py + 5}L${px + 8 + 6} ${py + 3}`);
    expect(mapPaths(view([cellOf(2, 3), cellOf(3, 3, { kind: "stairsUp" })]), lay).traps).toBe("");
    // cell 6（30×30）でも 8 基準の相対座標を丸めて使う（sc(2)=2・sc(6)=5）
    const lay6 = LAY6;
    const p6 = mapPaths(view([cellOf(0, 0, { kind: "trap" })], { width: 30, height: 30 }), lay6);
    const o = { x: lay6.ox, y: lay6.oy };
    expect(p6.traps).toBe(`M${o.x + 2} ${o.y + 2}L${o.x + 5} ${o.y + 5}M${o.x + 5} ${o.y + 2}L${o.x + 2} ${o.y + 5}`);
  });

  test("UI-72 kind chest のセル（開ける前の宝箱）は chests に □ の枠（cell 8 で M2 2H6V6H2Z を原点に足したもの）を出し、traps・stairs には出さない。ほかのセルは chests に出さない", () => {
    const lay = LAY8;
    const v = view([cellOf(2, 3, { kind: "chest" }), cellOf(3, 3, { kind: "trap" }), cellOf(4, 3, { kind: "stairsUp" }), cellOf(5, 3)], { pos: { x: 5, y: 3 } });
    const p = mapPaths(v, lay);
    const px = 39 + 2 * 8;
    const py = 23 + 3 * 8;
    expect(p.chests).toBe(`M${px + 2} ${py + 2}H${px + 6}V${py + 6}H${px + 2}Z`);
    expect(p.traps).toBe(`M${px + 8 + 2} ${py + 2}L${px + 8 + 6} ${py + 6}M${px + 8 + 6} ${py + 2}L${px + 8 + 2} ${py + 6}`);
    expect(p.stairs).toBe(`M${px + 16 + 2} ${py + 5}L${px + 16 + 4} ${py + 3}L${px + 16 + 6} ${py + 5}`);
    expect(mapPaths(view([cellOf(2, 3), cellOf(3, 3, { kind: "trap" })]), lay).chests).toBe("");
    // cell 6（30×30）でも 8 基準の相対座標を丸めて使う（sc(2)=2・sc(6)=5）
    const lay6 = LAY6;
    const p6 = mapPaths(view([cellOf(0, 0, { kind: "chest" })], { width: 30, height: 30 }), lay6);
    const o = { x: lay6.ox, y: lay6.oy };
    expect(p6.chests).toBe(`M${o.x + 2} ${o.y + 2}H${o.x + 5}V${o.y + 5}H${o.x + 2}Z`);
  });

  test("UI-24 cells に無いセルは描かない", () => {
    const lay = LAY8;
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
  // LAY8（M18 までの 20×20）は cell 8・ox 39・oy 23。セル (x, y) の中心は (43+8x, 27+8y)
  test("UI-25 mapSnapCell: 中心まで maxPx 以内の探索済みのセルのうち一番近いもの。同じ距離なら y、次に x の小さい方。境界ちょうどは含む", () => {
    const lay = LAY8;
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
    const lay = LAY8;
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
    const lay = LAY8;
    // (5,5) の中心 (83,67) の真上をタップ。探索済みは (5,6)（中心 (83,75)、距離 8）だけ
    expect(mapSnapCell(view([cellOf(5, 6)]), lay, 83, 67, 12)).toEqual({ x: 5, y: 6 });
    // 探索済みが (5,7)（中心 (83,83)、距離 16）だけなら null
    expect(mapSnapCell(view([cellOf(5, 7)]), lay, 83, 67, 12)).toBeNull();
    expect(mapSnapCell(view([]), lay, 83, 67, 12)).toBeNull();
  });

  test("UI-25 mapSnapCell は mapPaths の床の正方形の内側の点を、すべての探索済みのセルの中からそのセルに吸着させる（30×30、cell 6）", () => {
    const lay = LAY6;
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

  test("UI-25/UI-72（M19）mapPickPath は選んだセルの太さ 2px の枠（外側は壁の線と同じ位置の cell 角、内側はその 1px 内側）。宝箱の □（セルの内側の小さな 1px の四角）と形が違う", () => {
    // (5,12): px = 39+40 = 79、py = 23+96 = 119
    expect(mapPickPath({ x: 5, y: 12 }, LAY8)).toBe("M79 119h8v8h-8ZM80 120h6v6h-6Z");
    // M19 の 20×20（cell 11・ox 9・oy 20）: px = 9+55 = 64、py = 20+132 = 152
    const lay = mapLayout(20, 20, MAP_AREA);
    expect(mapPickPath({ x: 5, y: 12 }, lay)).toBe("M64 152h11v11h-11ZM65 153h9v9h-9Z");
    // 宝箱の □ は (2,2)-(8,8)（cell 11 で sc(2)=3・sc(6)=8。3..8）で、選んだ枠（0..11 と 1..10）とは重ならない
    expect(mapPaths(view([cellOf(5, 12, { kind: "chest" })]), lay).chests).toBe("M67 155H72V160H67Z");
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

function fakeDocument(): { svgs: FakeEl[]; paths: FakeEl[]; divs: FakeEl[] } {
  const svgs: FakeEl[] = [];
  const paths: FakeEl[] = [];
  const divs: FakeEl[] = [];
  vi.stubGlobal("document", {
    createElement: (): FakeEl => {
      const e = new FakeEl();
      divs.push(e);
      return e;
    },
    createElementNS: (_ns: string, tag: string): FakeEl => {
      const e = new FakeEl();
      if (tag === "svg") svgs.push(e);
      if (tag === "path") paths.push(e);
      return e;
    },
  });
  return { svgs, paths, divs };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("UI-25 地図のビュー（偽の DOM）", () => {
  const L = dungeonLayout(regions(data.config.ui.layout, data.config.stage.width), data.config.party.size);
  /** 選んだセルの枠の path（class map-pick。M11 で宝箱の □、M16 で凡例の □ も accent になったので、色ではなく class で取る） */
  const pickOf = (paths: FakeEl[]): FakeEl => paths.find((p) => p.attrs["class"] === "map-pick")!;

  test("UI-72 render は宝箱の □（mapPaths の chests）を accent の線の path に入れる。重ね順は罠の × の後・現在位置の前", () => {
    const { svgs, paths } = fakeDocument();
    const m = createMapView(L.map, () => {}, data.config.ui.mapSnapPx, data.strings);
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
    const m = createMapView(L.map, (p) => got.push(p), data.config.ui.mapSnapPx, data.strings);
    m.render(view([cellOf(0, 0), cellOf(1, 0)]), "t");
    const tap = tapSpecOf(svgs[0]!)!;
    // M19: 20×20 は cell 11・ox 9・oy 20。(0,0) の中心 (14.5,25.5)、(1,0) の中心 (25.5,25.5)
    tap.onTap({ lx: 29.5, ly: 25.5 }); // (1,0) に距離 4
    tap.onTap({ lx: 20, ly: 36.5 }); // どちらの中心からも sqrt(5.5² + 11²) ≈ 12.3 → 範囲外
    tap.onTap({ lx: 37.5, ly: 25.5 }); // (1,0) の中心から 12 ちょうど
    tap.onTap({ lx: 38.5, ly: 25.5 }); // 13 → 範囲外
    expect(got).toEqual([
      { x: 1, y: 0 },
      { x: 1, y: 0 },
    ]);
  });

  test("UI-24/UI-25/UI-78（M19）render は注記の行（題の下 y12..21）に tapHint を左寄せ（選んでいない間だけ）・「未踏の口 {n}」を右寄せ（選んでいる間も）で出し、盤の外周に dim の枠線を描く。凡例は閉じて始まり、toggleLegend で盤の下端に重ねて開閉する", () => {
    const { divs, paths } = fakeDocument();
    const m = createMapView(L.map, () => {}, data.config.ui.mapSnapPx, data.strings);
    const hint = divs.find((d) => d.className === "map-hint")!;
    const labels = divs.filter((d) => d.className === "map-legend-label");
    expect(hint.textContent).toBe(data.strings["map.tapHint"]);
    expect(labels.map((d) => d.textContent)).toEqual(MAP_LEGEND_KEYS.map((k) => data.strings[`map.legend.${k}`]));
    const unexplored = divs.find((d) => d.className === "map-unexplored")!;
    // タップは地図本体に通す
    expect(unexplored.style["pointerEvents"]).toBe("none");
    expect(hint.style["pointerEvents"]).toBe("none");
    expect(labels.every((d) => d.style["pointerEvents"] === "none")).toBe(true);
    // 注記の行は題の下（overlay の y12）。左右 4 の余白で、tapHint は左寄せ・未踏の口は右寄せ
    const noteTop = `${L.map.note.y - L.map.overlay.y}px`;
    expect(noteTop).toBe("12px");
    expect([hint.style["top"], hint.style["left"], hint.style["width"], hint.style["textAlign"]]).toEqual([noteTop, "4px", "232px", "left"]);
    expect([unexplored.style["top"], unexplored.style["left"], unexplored.style["width"], unexplored.style["textAlign"]]).toEqual([noteTop, "4px", "232px", "right"]);
    m.render(view([cellOf(0, 0), cellOf(1, 0)]), "t");
    expect(hint.style["display"]).toBe("");
    // UI-78（M18）: 「未踏の口 {n}」（n は MapView.unexploredExits。0 も数字のまま）
    expect(unexplored.style["display"]).toBe("");
    expect(unexplored.textContent).toBe("未踏の口 0");
    // 外周の枠線（dim。壁の線の前に描く）
    const frame = paths.find((p) => p.attrs["class"] === "map-frame")!;
    expect(frame.attrs["d"]).toBe(mapFramePath(20, 20, mapLayout(20, 20, L.map.area)));
    expect(frame.attrs["stroke"]).toBe("var(--c-dim)");
    expect(frame.attrs["fill"]).toBe("none");
    // 凡例は閉じて始まる（語も記号も地も出さない）
    const ay = L.map.area.y - L.map.overlay.y;
    const n = mapNotes(20, 20, L.map.area);
    const box = paths.find((p) => p.attrs["class"] === "map-legend-box")!;
    const legendChest = paths.filter((p) => p.attrs["stroke"] === "var(--c-accent)" && p.attrs["class"] === undefined);
    expect(m.legendOpen()).toBe(false);
    expect(labels.every((d) => d.style["display"] === "none")).toBe(true);
    expect(box.attrs["d"]).toBe("");
    // 開く: 盤の下端に重ねた 2 行と半透明の地
    expect(m.toggleLegend()).toBe(true);
    expect(m.legendOpen()).toBe(true);
    expect(labels.map((d) => [d.style["display"], d.style["left"], d.style["top"]])).toEqual(n.legend!.map((it) => ["", `${it.x + 10}px`, `${ay + it.y}px`]));
    expect(box.attrs["d"]).toBe("M2 216h236v24h-236Z");
    expect(box.attrs["fill"]).toBe("var(--c-bg)");
    expect(Number(box.attrs["fill-opacity"])).toBeLessThan(1);
    expect(paths.filter((p) => p.attrs["d"] === mapLegendPaths(n.legend!).chests)).toHaveLength(1);
    // 選ぶと tapHint は隠れ、未踏の口は出たまま。解くと戻る
    m.setPick({ x: 1, y: 0 }, false);
    expect(hint.style["display"]).toBe("none");
    expect(unexplored.style["display"]).toBe("");
    m.setPick(null, false);
    expect(hint.style["display"]).toBe("");
    // 点線（map-exits）と数。描き直しても凡例は開いたまま（表示だけの値）
    m.render(view([cellOf(0, 0, { e: "open", exits: [] }), cellOf(1, 0, { w: "open", s: "door", e: "open", exits: ["e", "s"] })]), "t");
    expect(unexplored.textContent).toBe("未踏の口 2");
    const exitsEl = paths.find((p) => p.attrs["class"] === "map-exits")!;
    expect(exitsEl.attrs["stroke"]).toBe("var(--c-accent)");
    expect(exitsEl.attrs["d"]).toBe(mapPaths(view([cellOf(1, 0, { w: "open", s: "door", e: "open", exits: ["e", "s"] })]), mapLayout(20, 20, L.map.area)).exits);
    expect(m.legendOpen()).toBe(true);
    expect(labels.filter((d) => d.style["display"] === "")).toHaveLength(MAP_LEGEND_KEYS.length);
    // 閉じる: 語・記号・地を消す
    expect(m.toggleLegend()).toBe(false);
    expect(labels.every((d) => d.style["display"] === "none")).toBe(true);
    expect(box.attrs["d"]).toBe("");
    expect(legendChest.length).toBeGreaterThan(0);
  });

  test("UI-25（M19）注記の行に tapHint と未踏の口の数が入らないときは、選んでいない間は tapHint だけ（未踏の口を隠す）。選んでいる間は未踏の口を出す", () => {
    const { divs } = fakeDocument();
    const long = { ...data.strings, "map.tapHint": "あ".repeat(28) };
    const m = createMapView(L.map, () => {}, data.config.ui.mapSnapPx, long);
    const hint = divs.find((d) => d.className === "map-hint")!;
    const unexplored = divs.find((d) => d.className === "map-unexplored")!;
    m.render(view([cellOf(0, 0), cellOf(1, 0)]), "t");
    expect(hint.style["display"]).toBe("");
    expect(unexplored.style["display"]).toBe("none");
    m.setPick({ x: 1, y: 0 }, false);
    expect(hint.style["display"]).toBe("none");
    expect(unexplored.style["display"]).toBe("");
  });

  test("UI-25/UI-72（M19）選んだセルの枠は text 色の 2px（mapPickPath の 2 重の線）で、宝箱の □（accent）と色も形も違う。凡例の地と記号は選んだ枠より上の層", () => {
    const { svgs, paths } = fakeDocument();
    createMapView(L.map, () => {}, data.config.ui.mapSnapPx, data.strings);
    const pick = pickOf(paths);
    expect(pick.attrs["stroke"]).toBe("var(--c-text)");
    expect(pick.attrs["fill"]).toBe("none");
    const top = svgs[0]!.children;
    const g = top.find((c) => c.children.includes(pick))!;
    const box = paths.find((p) => p.attrs["class"] === "map-legend-box")!;
    const legend = top.find((c) => c.attrs["class"] === "map-legend")!;
    expect(top.indexOf(g)).toBeLessThan(top.indexOf(box));
    expect(top.indexOf(box)).toBeLessThan(top.indexOf(legend));
  });

  test("UI-25 setPick: blink なら枠を点滅（iterations Infinity・周期 MAP_PICK_BLINK_MS）。切り替え・null・render で cancel。blink 偽では animate を呼ばず枠だけ", () => {
    const { paths } = fakeDocument();
    const m = createMapView(L.map, () => {}, data.config.ui.mapSnapPx, data.strings);
    m.render(view([cellOf(0, 0), cellOf(5, 12)]), "t");
    const pick = pickOf(paths);
    expect(pick.attrs["d"]).toBe("");
    m.setPick({ x: 5, y: 12 }, true);
    expect(pick.attrs["d"]).toBe("M64 152h11v11h-11ZM65 153h9v9h-9Z");
    expect(pick.anims).toHaveLength(1);
    expect(pick.anims[0]!.options).toEqual({ duration: MAP_PICK_BLINK_MS, iterations: Infinity });
    // 切り替え: 前の点滅を止めて新しい点滅
    m.setPick({ x: 0, y: 0 }, true);
    expect(pick.anims[0]!.cancelled).toBe(true);
    expect(pick.anims).toHaveLength(2);
    expect(pick.attrs["d"]).toBe("M9 20h11v11h-11ZM10 21h9v9h-9Z");
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
    expect(pick.attrs["d"]).toBe("M9 20h11v11h-11ZM10 21h9v9h-9Z");
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
    // 記号の位置は cell 8 の数で見る（LAY8。sc(2) = 2）
    const lay1 = LAY8;
    const at = s1.dive!.pos;
    expect(mapPaths(v1, lay1).chests).toContain(`M${lay1.ox + at.x * lay1.cell + 2} ${lay1.oy + at.y * lay1.cell + 2}H`);
    expect(slotsFor(visibleCells(s1, data), visibleKnownTraps(s1, data), visibleChests(s1, data)).has("cC0")).toBe(true);
    const s2 = run(s1, { type: "chest.open" });
    expect(s2.dive!.chest).toBeNull();
    const v2 = mapView(s2, data)!;
    expect(v2.cells.find((c) => c.x === at.x && c.y === at.y)!.kind).toBe("plain");
    expect(mapPaths(v2, lay1).chests).not.toContain(`M${lay1.ox + at.x * lay1.cell + 2} ${lay1.oy + at.y * lay1.cell + 2}H`);
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
