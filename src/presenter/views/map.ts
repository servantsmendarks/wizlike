// UI-24: オートマップ。探索済みセル（core の mapView が返す MapView）だけを描く。
// 罠・イベント・ボスは core が plain で返すので、表示層は区別しない（DG-13）。
// 純粋な部分（mapLayout / mapPaths / mapSnapCell / mapPickPath）を export し、node 環境のテストから試せるようにする。
// 地図本体のタップ（UI-25）は探索済みのセルに吸着させて（mapSnapCell。表示のための座標の計算）onCell に渡すだけで、
// 経路は app が core の planRoute で探す。選んだセルの枠（setPick）は Element.animate の iterations Infinity で点滅させ、
// 解除・切り替え・render のたびに cancel する（常駐のループは持たない）。
// モジュールのトップレベルでは DOM に触れない。
//
// overlay はビューとメッセージの領域を合わせた範囲（layout.ts の dungeonLayout の map。既定 240×220、y16..235）。
// el はその位置と大きさに自分で置く。内側: 題（map.title。既定 y0..11）、地図本体（map.area。既定 y12..219 に viewBox 0 0 240 208 の SVG）。
// 座標は画素番号。床の塗りは素の座標、線と記号と現在位置は translate(0.5 0.5) の中で描く（crispEdges）。
import type { Facing, MapView, Pos } from "../../core/types";
import { onTap } from "../input/tap";
import type { DungeonLayout } from "../layout";

const MAX_CELL = 8;

export type MapLayout = { cell: number; ox: number; oy: number };

/**
 * area は地図本体の寸法（論理 px。dungeonLayout の map.area、既定 240×208）。線を隣のセルと共有するので、
 * 幅 w のセルは w*cell+1 px を占める。cell = min(8, floor((area.w-1)/w), floor((area.h-1)/h))。原点は中央寄せ
 */
export function mapLayout(w: number, h: number, area: { w: number; h: number }): MapLayout {
  const cell = Math.max(1, Math.min(MAX_CELL, Math.floor((area.w - 1) / w), Math.floor((area.h - 1) / h)));
  return {
    cell,
    ox: Math.floor((area.w - (w * cell + 1)) / 2),
    oy: Math.floor((area.h - (h * cell + 1)) / 2),
  };
}

/**
 * UI-25: タップの吸着。地図本体の SVG の左上からの論理 px（lx, ly）から、探索済みのセル（v.cells）のうち
 * 中心 (ox + x*cell + cell/2, oy + y*cell + cell/2) までの距離が maxPx 以下で一番近いもの。
 * 同じ距離なら y の小さい方、次に x の小さい方。無ければ null
 */
export function mapSnapCell(v: Pick<MapView, "cells">, lay: MapLayout, lx: number, ly: number, maxPx: number): Pos | null {
  if (!Number.isFinite(lx) || !Number.isFinite(ly)) return null;
  const lim = maxPx * maxPx;
  let best: Pos | null = null;
  let bestD = Infinity;
  for (const c of v.cells) {
    const dx = lx - (lay.ox + c.x * lay.cell + lay.cell / 2);
    const dy = ly - (lay.oy + c.y * lay.cell + lay.cell / 2);
    const d = dx * dx + dy * dy;
    if (d > lim) continue;
    if (best === null || d < bestD || (d === bestD && (c.y < best.y || (c.y === best.y && c.x < best.x)))) {
      best = { x: c.x, y: c.y };
      bestD = d;
    }
  }
  return best;
}

/** UI-25: 選んだセルの外形（translate(0.5 0.5) の中で描く 1px の線。壁の線と同じ位置） */
export function mapPickPath(p: Pos, lay: MapLayout): string {
  const px = lay.ox + p.x * lay.cell;
  const py = lay.oy + p.y * lay.cell;
  return `M${px} ${py}h${lay.cell}v${lay.cell}h${-lay.cell}Z`;
}

/**
 * UI-25: 吸着したセル p のタップをどう扱うか（app の分岐。経路の有無は core の planRoute の結果 route をそのまま渡す）。
 * - go: 選んでいるセル（pick）と同じ → 歩き出す（route は見ない。歩き出すときに引き直す）
 * - noRoute: 経路が無い → 題を「道が分からない。」にして選択を解く
 * - none: 現在位置（route が []）→ 何もしない（選択も変えない）
 * - pick: それ以外 → そのセルを選ぶ
 */
export function mapTapAction(pick: Pos | null, p: Pos, route: readonly unknown[] | null): "go" | "noRoute" | "none" | "pick" {
  if (pick !== null && pick.x === p.x && pick.y === p.y) return "go";
  if (route === null) return "noRoute";
  if (route.length === 0) return "none";
  return "pick";
}

/** UI-25: 選んだセルの枠の点滅の周期（ms。戦闘の対象の注目 FOCUS_BLINK_MS と同じ矩形波） */
export const MAP_PICK_BLINK_MS = 400;

/** cell 8 のときの現在位置の三角形（北向き）。セル原点からの相対座標 */
const PLAYER_N_8: ReadonlyArray<readonly [number, number]> = [
  [4, 1],
  [7, 6],
  [1, 6],
];
const ROTATIONS: Readonly<Record<Facing, number>> = { N: 0, E: 1, S: 2, W: 3 };

/** 8 基準の相対座標を cell に合わせる（×cell/8 して四捨五入） */
function sc(v: number, cell: number): number {
  return Math.round((v * cell) / MAX_CELL);
}

/**
 * 現在位置の三角形の頂点（セル原点からの相対）。北向きを cell に合わせて丸めてから、
 * セルの中心 (cell/2, cell/2) のまわりに 90° ずつ時計回りに回す（y が下向きなので (dx,dy) → (-dy,dx)）。
 * cell 8 では N (4,1)(7,6)(1,6)、E (7,4)(2,7)(2,1)、S (4,7)(1,2)(7,2)、W (1,4)(6,1)(6,7)。
 */
export function playerTriangle(facing: Facing, cell: number): Array<[number, number]> {
  const c = cell / 2;
  return PLAYER_N_8.map(([x, y]) => {
    let dx = sc(x, cell) - c;
    let dy = sc(y, cell) - c;
    for (let i = 0; i < ROTATIONS[facing]; i++) [dx, dy] = [-dy, dx];
    return [dx + c, dy + c];
  });
}

export type MapPaths = { floor: string; walls: string; stairs: string; player: string };

/**
 * 地図の 4 本の path。
 * - floor: 探索済みセルの床（px+1..px+cell-1 の正方形。素の座標）
 * - walls: wall の辺は全長、door の辺は両端の 2px だけ（中央が隙間）。open は描かない。共有辺は 1 回だけ
 * - stairs: 下りは「V」、上りは「^」
 * - player: 現在位置の三角形（塗り）
 */
export function mapPaths(v: MapView, lay: MapLayout): MapPaths {
  const { cell, ox, oy } = lay;
  const floor: string[] = [];
  const walls: string[] = [];
  const stairs: string[] = [];
  const seen = new Set<string>();

  const hLine = (px: number, py: number, door: boolean): string =>
    door ? `M${px} ${py}H${px + 2}M${px + cell - 2} ${py}H${px + cell}` : `M${px} ${py}H${px + cell}`;
  const vLine = (px: number, py: number, door: boolean): string =>
    door ? `M${px} ${py}V${py + 2}M${px} ${py + cell - 2}V${py + cell}` : `M${px} ${py}V${py + cell}`;

  for (const c of v.cells) {
    const px = ox + c.x * cell;
    const py = oy + c.y * cell;
    const inner = cell - 1;
    floor.push(`M${px + 1} ${py + 1}h${inner}v${inner}h${-inner}Z`);

    // 辺の鍵は共有辺で一意（横の辺は "h,x,y" の上端の y、縦の辺は "v,x,y" の左端の x）
    const edges: Array<{ key: string; e: string; d: () => string }> = [
      { key: `h,${c.x},${c.y}`, e: c.n, d: () => hLine(px, py, c.n === "door") },
      { key: `h,${c.x},${c.y + 1}`, e: c.s, d: () => hLine(px, py + cell, c.s === "door") },
      { key: `v,${c.x},${c.y}`, e: c.w, d: () => vLine(px, py, c.w === "door") },
      { key: `v,${c.x + 1},${c.y}`, e: c.e, d: () => vLine(px + cell, py, c.e === "door") },
    ];
    for (const ed of edges) {
      if (ed.e === "open" || seen.has(ed.key)) continue;
      seen.add(ed.key);
      walls.push(ed.d());
    }

    if (c.kind === "stairsDown") {
      stairs.push(`M${px + sc(2, cell)} ${py + sc(3, cell)}L${px + sc(4, cell)} ${py + sc(5, cell)}L${px + sc(6, cell)} ${py + sc(3, cell)}`);
    } else if (c.kind === "stairsUp") {
      stairs.push(`M${px + sc(2, cell)} ${py + sc(5, cell)}L${px + sc(4, cell)} ${py + sc(3, cell)}L${px + sc(6, cell)} ${py + sc(5, cell)}`);
    }
  }

  const ppx = ox + v.pos.x * cell;
  const ppy = oy + v.pos.y * cell;
  const tri = playerTriangle(v.facing, cell);
  const player = tri.map(([x, y], i) => `${i === 0 ? "M" : "L"}${ppx + x} ${ppy + y}`).join("") + "Z";

  return { floor: floor.join(""), walls: walls.join(""), stairs: stairs.join(""), player };
}

export type MapViewEl = {
  el: HTMLElement;
  render(v: MapView, title: string): void;
  /** UI-25: 題の行だけを差し替える（経路が無いときの「道が分からない。」。次の render で戻る） */
  setTitle(title: string): void;
  /** UI-25: 選んだセルの枠（null で消す）。blink なら点滅、偽なら静的な枠だけ（演出スキップ） */
  setPick(p: Pos | null, blink: boolean): void;
};

/**
 * onCell は地図本体のタップ（UI-25）。探索済みのセルの中心から snapPx 以内のタップだけを、一番近いセルに吸着させて呼ぶ
 * （範囲外のタップでは呼ばない）
 */
export function createMapView(lay: DungeonLayout["map"], onCell?: (p: Pos) => void, snapPx = 12): MapViewEl {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const { overlay, title: tr, area } = lay;
  const el = document.createElement("div");
  el.className = "map-view";
  Object.assign(el.style, {
    position: "absolute",
    left: `${overlay.x}px`,
    top: `${overlay.y}px`,
    width: `${overlay.w}px`,
    height: `${overlay.h}px`,
    background: "var(--c-bg)",
    color: "var(--c-text)",
  });

  const title = document.createElement("div");
  title.className = "map-title";
  Object.assign(title.style, {
    position: "absolute",
    left: `${tr.x - overlay.x}px`,
    top: `${tr.y - overlay.y}px`,
    width: `${tr.w}px`,
    height: `${tr.h}px`,
    lineHeight: `${tr.h}px`,
    textAlign: "center",
    whiteSpace: "nowrap",
    overflow: "hidden",
  });
  el.appendChild(title);

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${area.w} ${area.h}`);
  svg.setAttribute("width", String(area.w));
  svg.setAttribute("height", String(area.h));
  svg.setAttribute("shape-rendering", "crispEdges");
  Object.assign(svg.style, { position: "absolute", left: `${area.x - overlay.x}px`, top: `${area.y - overlay.y}px` });
  el.appendChild(svg);

  const path = (attrs: Record<string, string>): SVGPathElement => {
    const p = document.createElementNS(SVG_NS, "path");
    for (const [k, val] of Object.entries(attrs)) p.setAttribute(k, val);
    return p;
  };
  const floorPath = path({ fill: "var(--c-mapFloor)", stroke: "none" });
  svg.appendChild(floorPath);
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("transform", "translate(0.5 0.5)");
  svg.appendChild(g);
  const wallPath = path({ fill: "none", stroke: "var(--c-line)", "stroke-width": "1" });
  const stairsPath = path({ fill: "none", stroke: "var(--c-stairs)", "stroke-width": "1" });
  // 現在位置は階段より後に描く
  const playerPath = path({ fill: "var(--c-player)", stroke: "none" });
  // UI-25: 選んだセルの枠（壁と現在位置の上に描く）
  const pickPath = path({ fill: "none", stroke: "var(--c-accent)", "stroke-width": "1", d: "" });
  g.append(wallPath, stairsPath, playerPath, pickPath);
  let blinking: Animation | null = null;
  const stopBlink = (): void => {
    if (blinking !== null) blinking.cancel();
    blinking = null;
  };

  // UI-25: 地図本体のタップ。座標は SVG の左上からの論理 px（viewBox は area と同じ寸法）
  let shown: MapView | null = null;
  onTap(svg, (pt) => {
    if (shown === null || onCell === undefined) return;
    const c = mapSnapCell(shown, mapLayout(shown.width, shown.height, area), pt.lx, pt.ly, snapPx);
    if (c !== null) onCell(c);
  });

  return {
    el,
    setTitle(t: string): void {
      title.textContent = t;
    },
    setPick(p: Pos | null, blink: boolean): void {
      stopBlink();
      if (p === null || shown === null) {
        pickPath.setAttribute("d", "");
        return;
      }
      pickPath.setAttribute("d", mapPickPath(p, mapLayout(shown.width, shown.height, area)));
      if (!blink) return;
      blinking = pickPath.animate(
        [
          { opacity: 1, offset: 0 },
          { opacity: 1, offset: 0.5 },
          { opacity: 0, offset: 0.5 },
          { opacity: 0, offset: 1 },
        ],
        { duration: MAP_PICK_BLINK_MS, iterations: Infinity },
      );
    },
    render(v: MapView, t: string): void {
      // 描き直すと選択は消える（app は地図を開くたびに選択を解く）
      stopBlink();
      pickPath.setAttribute("d", "");
      shown = v;
      title.textContent = t;
      const p = mapPaths(v, mapLayout(v.width, v.height, area));
      floorPath.setAttribute("d", p.floor);
      wallPath.setAttribute("d", p.walls);
      stairsPath.setAttribute("d", p.stairs);
      playerPath.setAttribute("d", p.player);
    },
  };
}
