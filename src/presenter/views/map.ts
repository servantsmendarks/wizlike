// UI-24: オートマップ。探索済みセル（core の mapView が返す MapView）だけを描く。
// イベント・ボスと察知していない罠は core が plain で返すので、表示層は区別しない（DG-13）。察知した罠は kind trap で × を描く（M5.5）。
// 開ける前の宝箱は kind chest で □ を描く（M11。UI-72。開けたり転移で失ったりしたセルは core が plain で返す）。
// 純粋な部分（mapLayout / mapPaths / mapSnapCell / mapPickPath）を export し、node 環境のテストから試せるようにする。
// 地図本体のタップ（UI-25）は探索済みのセルに吸着させて（mapSnapCell。表示のための座標の計算）onCell に渡すだけで、
// 経路は app が core の planRoute で探す。選んだセルの枠（setPick）は Element.animate の iterations Infinity で点滅させ、
// 解除・切り替え・render のたびに cancel する（常駐のループは持たない）。
// モジュールのトップレベルでは DOM に触れない。
//
// overlay はビュー・メッセージ・パーティ欄の領域を合わせた範囲（layout.ts の dungeonLayout の map。M19 から 240×284、y16..299。M18 まではパーティ欄を除く 240×220）。
// el はその位置と大きさに自分で置く。内側: 題（map.title。既定 y0..11）、注記の行（map.note。y12..21）、地図本体（map.area。y22..283 に viewBox 0 0 240 262 の SVG）。
// 座標は画素番号。床の塗りは素の座標、線と記号と現在位置は translate(0.5 0.5) の中で描く（crispEdges）。
// M16（UI-24 / UI-25）: 盤の上の余白に題の 2 行目（map.tapHint。選んでいない間だけ）、盤の下の余白に凡例（map.legend.*。
// 記号は盤と同じ path を cell 8 で描く）。位置は盤の大きさから mapNotes で決め、余白に入らなければ出さない。
// M18（UI-78）: 未踏の口（core の MapCell.exits）の辺の上に点線（accent。M19 で辺の外へ伸ばす破線から改めた）、凡例に「未踏」（4 列 × 2 行）、
// 題の下の 3 行目に「未踏の口 {n}」（n は core の MapView.unexploredExits。選んでいる間も出す）。
// M19（UI-24 / UI-72）: マスを 11px に（20×20 の盤は 221×221）、盤の外周に dim の枠線、題の 2 行目と 3 行目は 1 行（注記の行）にまとめ、
// tapHint は左寄せ・未踏の口は右寄せ（両方が入らなければ tapHint だけ）。凡例は操作領域の「凡例」で開閉し、開いている間は盤の外周の枠線の下（C-5 から。それまでは盤の下端に重ねた）に
// 半透明の地の上に 2 行で出す。選んだセルの枠は 2px の text 色（宝箱の □ と見分ける）。
import type { Facing, MapEdgeDir, MapView, Pos } from "../../core/types";
import { onTap } from "../input/tap";
import type { DungeonLayout } from "../layout";
import { formatMessage } from "./message";
import { textUnits } from "./party-band";

/** UI-24（M19）: 盤の 1 マスの最大（論理 px。M18 までは 8） */
const MAX_CELL = 11;
/** 記号の相対座標の基準のマスの大きさ（記号は 8 基準で作り、cell に合わせて丸める）。凡例の記号もこの大きさで描く */
const BASE_CELL = 8;

export type MapLayout = { cell: number; ox: number; oy: number };

/**
 * area は地図本体の寸法（論理 px。dungeonLayout の map.area、M19 から既定 240×262）。線を隣のセルと共有するので、
 * 幅 w のセルは w*cell+1 px を占める。cell = min(11, floor((area.w-1)/w), floor((area.h-1)/h))。原点は中央寄せ
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
 * 同じ距離なら y の小さい方、次に x の小さい方。無ければ null。
 * 二乗距離の差が SNAP_TIE_EPS 以下なら同じ距離として扱う（端末の座標から論理座標への換算の誤差で同順位の規則が崩れないように）
 */
/**
 * UI-25: 吸着の同順位とみなす二乗距離の差（論理 px²）。換算（client px − 原点）/ scale の浮動小数の誤差は、
 * 二乗距離（144 程度まで）で 1e-12 程度にとどまる。一方、指の位置が実際に違えば最小でも 1 デバイス px
 * （論理で 0.2px 前後）ずれ、二乗距離の差は 1e-2 のけたになる。その間の 1e-6 を取る
 */
export const SNAP_TIE_EPS = 1e-6;

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
    const tie = Math.abs(d - bestD) <= SNAP_TIE_EPS;
    if (best === null || (!tie && d < bestD) || (tie && (c.y < best.y || (c.y === best.y && c.x < best.x)))) {
      best = { x: c.x, y: c.y };
      bestD = d;
    }
  }
  return best;
}

/**
 * UI-25 / UI-72（M19）: 選んだセルの枠（translate(0.5 0.5) の中で描く 1px の線を 2 重にした太さ 2px の枠）。外側は壁の線と同じ位置、
 * 内側はその 1px 内側。宝箱の □（1px・accent・セルの内側の小さな四角）と太さ・大きさ・色（text）で見分ける
 */
export function mapPickPath(p: Pos, lay: MapLayout): string {
  const px = lay.ox + p.x * lay.cell;
  const py = lay.oy + p.y * lay.cell;
  const c = lay.cell;
  const i = c - 2;
  return `M${px} ${py}h${c}v${c}h${-c}ZM${px + 1} ${py + 1}h${i}v${i}h${-i}Z`;
}

/** UI-24（M19）: 盤の外周の枠線（translate(0.5 0.5) の中で描く 1px。外周の壁の線と同じ位置。dim 色で壁の線の下に描く） */
export function mapFramePath(w: number, h: number, lay: MapLayout): string {
  return `M${lay.ox} ${lay.oy}h${w * lay.cell}v${h * lay.cell}h${-w * lay.cell}Z`;
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
  return Math.round((v * cell) / BASE_CELL);
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

/** 記号の path（セル原点 (px, py)、セルの大きさ cell）。盤（mapPaths）と凡例（mapLegendPaths）で同じものを使う */
const stairsDownD = (px: number, py: number, cell: number): string =>
  `M${px + sc(2, cell)} ${py + sc(3, cell)}L${px + sc(4, cell)} ${py + sc(5, cell)}L${px + sc(6, cell)} ${py + sc(3, cell)}`;
const stairsUpD = (px: number, py: number, cell: number): string =>
  `M${px + sc(2, cell)} ${py + sc(5, cell)}L${px + sc(4, cell)} ${py + sc(3, cell)}L${px + sc(6, cell)} ${py + sc(5, cell)}`;
const trapD = (px: number, py: number, cell: number): string => {
  const a = sc(2, cell);
  const b = sc(6, cell);
  return `M${px + a} ${py + a}L${px + b} ${py + b}M${px + b} ${py + a}L${px + a} ${py + b}`;
};
const chestD = (px: number, py: number, cell: number): string => {
  const a = sc(2, cell);
  const b = sc(6, cell);
  return `M${px + a} ${py + a}H${px + b}V${py + b}H${px + a}Z`;
};
/** 扉の辺の両端の線の長さ（mapPaths の hLine / vLine の 2px） */
const DOOR_END = 2;
/**
 * UI-78（M18。M19 で形を変えた）: 未踏の口の点線。セル原点 (px, py) の辺 dir の上（open の辺には線が無いので辺の位置そのもの）に、
 * 辺に沿った長さ 1 の線を 3 本（cell 8 で辺の 1〜2・3.5〜4.5・6〜7。端の 2 本は a = sc(1) から a〜a+1 と cell-a-1〜cell-a、中央は cell/2±0.5）。
 * door の辺は両端の 2px に扉の線があるので、辺の中央に辺の半分の長さの線を 1 本（M19 の C-5 から。cell 8 で 2〜6 で、扉の線 0〜2・6〜8 に接して重ならない。
 * 始まりは max(2, cell/4)、終わりは cell − 始まり。cell 11 は 2.75〜8.25。扉の隙間が 1 未満（cell 4 以下）のときは M19 の C-5 までの中央の長さ 1 の 1 本）。
 * 線は口のあるセルの辺の上に収まり、隣のセルの内側には入らない。盤の外へ向く辺は core が exits に入れない
 */
export const exitD = (px: number, py: number, dir: MapEdgeDir, cell: number, door = false): string => {
  const a = sc(1, cell);
  const m = cell / 2;
  const ds = Math.max(DOOR_END, cell / 4);
  const spans: Array<[number, number]> = door
    ? [cell - 2 * ds >= 1 ? [ds, cell - ds] : [m - 0.5, m + 0.5]]
    : [
        [a, a + 1],
        [m - 0.5, m + 0.5],
        [cell - a - 1, cell - a],
      ];
  if (dir === "n" || dir === "s") {
    const y = dir === "n" ? py : py + cell;
    return spans.map(([s, e]) => `M${px + s} ${y}H${px + e}`).join("");
  }
  const x = dir === "w" ? px : px + cell;
  return spans.map(([s, e]) => `M${x} ${py + s}V${py + e}`).join("");
};
const playerD = (px: number, py: number, facing: Facing, cell: number): string =>
  playerTriangle(facing, cell)
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${px + x} ${py + y}`)
    .join("") + "Z";

/** UI-24（M16）/ UI-78（M18）: 凡例の項目（strings の map.legend.<key>）。2 行 × 4 列に、左上から行の順に並べる */
export const MAP_LEGEND_KEYS = ["self", "up", "down", "chest", "trap", "wall", "exit"] as const;
export type MapLegendKey = (typeof MAP_LEGEND_KEYS)[number];

/** 凡例の行の高さ（メッセージ窓の行と同じ 10。8px の字） */
const NOTE_LINE_H = 10;
/** 凡例の 1 列の幅（記号 8 + 間 2 + 語。語は全角 6 字まで。M18 で 72 → 58 にして 4 列） */
export const LEGEND_COL_W = 58;
const LEGEND_COLS = 4;
/** 凡例と地の縁の間（論理 px。地図本体の下端を越えるときは詰める） */
const NOTE_GAP = 2;
/** UI-24 / UI-78（M19）: 注記の行の左右の余白と、tapHint と未踏の口の数の間の最小の空き（論理 px） */
const NOTE_PAD_X = 4;
const NOTE_SEP = 8;
/** 1 単位（textUnits。全角 2・半角 1）の幅（8px の字で全角 8px） */
const UNIT_PX = 4;

export type MapNotes = {
  /** 凡例の各項目の左上（記号の 8×8 の箱は (x, y+1)、語は x+10 から。地図本体の SVG の座標）。地図本体に入らなければ null */
  legend: Array<{ key: MapLegendKey; x: number; y: number }> | null;
  /** 凡例の半透明の地の矩形（地図本体の SVG の座標。legend と同時に null） */
  legendBox: { x: number; y: number; w: number; h: number } | null;
};

/**
 * UI-24（M19。C-5 で盤の下へ）: 凡例の位置。半透明の地は盤（mapLayout）の外周の枠線の下端の線（画素 oy + h*cell）の 1 つ下の画素から始め、
 * 枠線を覆わない。その中に 2 行 × 4 列（行の高さ 10、列幅 58。中央寄せ）を、地の上端から NOTE_GAP 下に置く。
 * 地は上下左右 NOTE_GAP の余白を取るが、地図本体の下端を越えるなら字の行の高さを保ったまま地の余白だけを詰める（上の余白も 1 まで詰める）。
 * それでも 2 行が地図本体に入らない（盤の下の余白が字の行の高さ + 1 未満）か、地が左右にはみ出すなら出さない。
 * 例: 20×20 は盤 y20..240（area 240×262）で、地 x2..237・y241..261（h 21）、凡例 y242・252 の 2 行（x 4・62・120・178）
 */
export function mapNotes(w: number, h: number, area: { w: number; h: number }): MapNotes {
  const lay = mapLayout(w, h, area);
  const rows = Math.ceil(MAP_LEGEND_KEYS.length / LEGEND_COLS);
  const textH = rows * NOTE_LINE_H;
  const boxY = lay.oy + h * lay.cell + 1;
  const room = area.h - boxY;
  const padTop = Math.min(NOTE_GAP, room - textH);
  const blockW = LEGEND_COL_W * LEGEND_COLS;
  const x0 = Math.floor((area.w - blockW) / 2);
  const box = { x: x0 - NOTE_GAP, y: boxY, w: blockW + 2 * NOTE_GAP, h: Math.min(textH + 2 * NOTE_GAP, room) };
  if (padTop < 1 || box.x < 0 || box.x + box.w > area.w) return { legend: null, legendBox: null };
  const top = boxY + padTop;
  return {
    legend: MAP_LEGEND_KEYS.map((key, i) => ({ key, x: x0 + (i % LEGEND_COLS) * LEGEND_COL_W, y: top + Math.floor(i / LEGEND_COLS) * NOTE_LINE_H })),
    legendBox: box,
  };
}

/**
 * UI-24 / UI-25 / UI-78（M19）: 注記の行（幅 width）に tapHint（左寄せ）と未踏の口の数（右寄せ）の両方が入るか。
 * 字の幅（textUnits × 4px）と左右の余白 4・間 8 で見る（表示のための計算）。入らなければ tapHint を優先して未踏の口の数を隠す
 */
export function mapNoteBothFit(hint: string, unexplored: string, width: number): boolean {
  return (textUnits(hint) + textUnits(unexplored)) * UNIT_PX + NOTE_SEP <= width - 2 * NOTE_PAD_X;
}

export type MapLegendPaths = { walls: string; stairs: string; traps: string; chests: string; exits: string; player: string };

/**
 * UI-24（M16）: 凡例の記号。盤と同じ path（cell 8。M19 で盤は 11 になったが凡例は 8 のまま）を各項目の記号の箱 (x, y+1) に描く。
 * self は北向きの現在位置、up / down は階段、chest は □、trap は ×、wall は箱の中ほどの横線 1 本（盤の壁の線と同じ色）、
 * exit（UI-78。M18。M19 で点線に）は wall と同じ箱の中ほどの横の辺に沿った点線（盤の open の辺の exitD と同じ。箱の y+5 の x+1..x+7）
 */
export function mapLegendPaths(legend: NonNullable<MapNotes["legend"]>): MapLegendPaths {
  const out: MapLegendPaths = { walls: "", stairs: "", traps: "", chests: "", exits: "", player: "" };
  for (const it of legend) {
    const px = it.x;
    const py = it.y + 1;
    if (it.key === "self") out.player += playerD(px, py, "N", BASE_CELL);
    else if (it.key === "up") out.stairs += stairsUpD(px, py, BASE_CELL);
    else if (it.key === "down") out.stairs += stairsDownD(px, py, BASE_CELL);
    else if (it.key === "chest") out.chests += chestD(px, py, BASE_CELL);
    else if (it.key === "trap") out.traps += trapD(px, py, BASE_CELL);
    else if (it.key === "exit") out.exits += exitD(px, py + BASE_CELL / 2, "n", BASE_CELL);
    else out.walls += `M${px} ${py + BASE_CELL / 2}H${px + BASE_CELL}`;
  }
  return out;
}

export type MapPaths = { floor: string; walls: string; stairs: string; traps: string; chests: string; exits: string; player: string };

/**
 * 地図の path。
 * - floor: 探索済みセルの床（px+1..px+cell-1 の正方形。素の座標）
 * - walls: wall の辺は全長、door の辺は両端の 2px だけ（中央が隙間）。open は描かない。共有辺は 1 回だけ
 * - stairs: 下りは「V」、上りは「^」
 * - traps: 察知した罠（kind trap）は「×」（cell 8 で (2,2)-(6,6) と (6,2)-(2,6)。M5.5）。色は danger で、階段とは形も色も違う
 * - chests: 開ける前の宝箱（kind chest）は「□」（cell 8 で (2,2)-(6,6) の正方形の枠。M11。UI-72）。色は accent
 * - exits: 未踏の口（MapCell.exits。UI-78。M18）の辺の上の点線（exitD。M19 から。door の辺は中央に辺の半分の長さの 1 本）。色は accent
 * - player: 現在位置の三角形（塗り）
 */
export function mapPaths(v: MapView, lay: MapLayout): MapPaths {
  const { cell, ox, oy } = lay;
  const floor: string[] = [];
  const walls: string[] = [];
  const stairs: string[] = [];
  const traps: string[] = [];
  const chests: string[] = [];
  const exits: string[] = [];
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

    if (c.kind === "stairsDown") stairs.push(stairsDownD(px, py, cell));
    else if (c.kind === "stairsUp") stairs.push(stairsUpD(px, py, cell));
    else if (c.kind === "trap") traps.push(trapD(px, py, cell));
    else if (c.kind === "chest") chests.push(chestD(px, py, cell));
    for (const d of c.exits) exits.push(exitD(px, py, d, cell, c[d] === "door"));
  }

  const player = playerD(ox + v.pos.x * cell, oy + v.pos.y * cell, v.facing, cell);

  return { floor: floor.join(""), walls: walls.join(""), stairs: stairs.join(""), traps: traps.join(""), chests: chests.join(""), exits: exits.join(""), player };
}

export type MapViewEl = {
  el: HTMLElement;
  render(v: MapView, title: string): void;
  /** UI-25: 題の行だけを差し替える（経路が無いときの「道が分からない。」。次の render で戻る） */
  setTitle(title: string): void;
  /**
   * UI-25: 選んだセルの枠（null で消す）。blink なら点滅、偽なら静的な枠だけ（演出スキップ）。
   * 注記の行の tapHint（map.tapHint。M16。M19 から左寄せ）は選んでいない間だけ出す
   */
  setPick(p: Pos | null, blink: boolean): void;
  /** UI-24（M19）: 凡例を開閉する（表示だけの値。保存しない。地図を閉じても、ページを読み直すまで保つ）。開いたら真を返す */
  toggleLegend(): boolean;
  /** UI-24（M19）: 凡例が開いているか */
  legendOpen(): boolean;
};

/**
 * onCell は地図本体のタップ（UI-25）。探索済みのセルの中心から snapPx 以内のタップだけを、一番近いセルに吸着させて呼ぶ
 * （範囲外のタップでは呼ばない）。strings は注記の行（map.tapHint・map.unexplored）と凡例の語（map.legend.*）を引く（M16）
 */
export function createMapView(
  lay: DungeonLayout["map"],
  onCell: ((p: Pos) => void) | undefined,
  snapPx: number,
  strings: Readonly<Record<string, string>>,
): MapViewEl {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const { overlay, title: tr, note: nr, area } = lay;
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
  // UI-24（M19）: 盤の外周の枠線（dim。壁の線の下に描く。外周の壁はその上に壁の色で重なる）
  const framePath = path({ class: "map-frame", fill: "none", stroke: "var(--c-dim)", "stroke-width": "1" });
  const wallPath = path({ fill: "none", stroke: "var(--c-line)", "stroke-width": "1" });
  const stairsPath = path({ fill: "none", stroke: "var(--c-stairs)", "stroke-width": "1" });
  // 察知した罠の ×（M5.5）。階段の後、現在位置の前
  const trapsPath = path({ fill: "none", stroke: "var(--c-danger)", "stroke-width": "1" });
  // 開ける前の宝箱の □（M11。UI-72）。罠の後、現在位置の前（宝箱のセルに立つと三角形が上に重なる）
  const chestsPath = path({ fill: "none", stroke: "var(--c-accent)", "stroke-width": "1" });
  // 未踏の口の点線（UI-78。M18）。宝箱の後、現在位置の前
  const exitsPath = path({ class: "map-exits", fill: "none", stroke: "var(--c-accent)", "stroke-width": "1" });
  // 現在位置は階段・罠より後に描く
  const playerPath = path({ fill: "var(--c-player)", stroke: "none" });
  // UI-25: 選んだセルの枠（壁と現在位置の上に描く）。M19 から 2px の text 色（mapPickPath の 2 重の 1px の線。UI-72 の宝箱の □ と見分ける）
  const pickPath = path({ class: "map-pick", fill: "none", stroke: "var(--c-text)", "stroke-width": "1", d: "" });
  g.append(framePath, wallPath, stairsPath, trapsPath, chestsPath, exitsPath, playerPath, pickPath);

  // UI-24（M16。M19 から開閉）: 凡例の地（半透明）と記号（盤と同じ色と path）。選択の枠より上の層に描く（C-5 から盤の下に出すので重ならないが、層の順は保つ）。
  // 語は el の上の div（タップは地図本体に通す）
  const legendBox = path({ class: "map-legend-box", fill: "var(--c-bg)", "fill-opacity": "0.85", stroke: "none" });
  svg.appendChild(legendBox);
  const legendWalls = path({ fill: "none", stroke: "var(--c-line)", "stroke-width": "1" });
  const legendStairs = path({ fill: "none", stroke: "var(--c-stairs)", "stroke-width": "1" });
  const legendTraps = path({ fill: "none", stroke: "var(--c-danger)", "stroke-width": "1" });
  const legendChests = path({ fill: "none", stroke: "var(--c-accent)", "stroke-width": "1" });
  const legendExits = path({ fill: "none", stroke: "var(--c-accent)", "stroke-width": "1" });
  const legendPlayer = path({ fill: "var(--c-player)", stroke: "none" });
  const legendG = document.createElementNS(SVG_NS, "g");
  legendG.setAttribute("class", "map-legend");
  legendG.setAttribute("transform", "translate(0.5 0.5)");
  legendG.append(legendWalls, legendStairs, legendTraps, legendChests, legendExits, legendPlayer);
  svg.appendChild(legendG);
  const ax = area.x - overlay.x;
  const ay = area.y - overlay.y;
  const note = (className: string): HTMLDivElement => {
    const d = document.createElement("div");
    d.className = className;
    Object.assign(d.style, { position: "absolute", height: `${NOTE_LINE_H}px`, lineHeight: `${NOTE_LINE_H}px`, whiteSpace: "nowrap", overflow: "hidden", pointerEvents: "none" });
    return d;
  };
  // UI-25 / UI-78（M19）: 注記の行。左に tapHint（選んでいない間だけ）、右に「未踏の口 {n}」（選んでいる間も出す）。
  // 両方が入らないときは、tapHint が出ている間だけ未踏の口の数を隠す（mapNoteBothFit）
  const noteX = nr.x - overlay.x + NOTE_PAD_X;
  const noteW = nr.w - 2 * NOTE_PAD_X;
  const hint = note("map-hint");
  Object.assign(hint.style, { left: `${noteX}px`, top: `${nr.y - overlay.y}px`, width: `${noteW}px`, textAlign: "left", display: "none" });
  hint.textContent = strings["map.tapHint"] ?? "";
  el.appendChild(hint);
  const unexplored = note("map-unexplored");
  Object.assign(unexplored.style, { left: `${noteX}px`, top: `${nr.y - overlay.y}px`, width: `${noteW}px`, textAlign: "right", display: "none" });
  el.appendChild(unexplored);
  let shown: MapView | null = null;
  let picked = false;
  const paintNote = (): void => {
    hint.style.display = shown === null || picked ? "none" : "";
    const both = mapNoteBothFit(hint.textContent ?? "", unexplored.textContent ?? "", nr.w);
    unexplored.style.display = shown === null || (!picked && !both) ? "none" : "";
  };
  const legendLabels = MAP_LEGEND_KEYS.map((key) => {
    const d = note("map-legend-label");
    Object.assign(d.style, { width: `${LEGEND_COL_W - (BASE_CELL + 2)}px`, display: "none" });
    d.textContent = strings[`map.legend.${key}`] ?? "";
    el.appendChild(d);
    return d;
  });
  let legendOn = false;
  let notes: MapNotes = { legend: null, legendBox: null };
  const paintLegend = (): void => {
    const legend = legendOn ? notes.legend : null;
    const b = legendOn ? notes.legendBox : null;
    legendBox.setAttribute("d", b === null ? "" : `M${b.x} ${b.y}h${b.w}v${b.h}h${-b.w}Z`);
    const p = legend === null ? { walls: "", stairs: "", traps: "", chests: "", exits: "", player: "" } : mapLegendPaths(legend);
    legendWalls.setAttribute("d", p.walls);
    legendStairs.setAttribute("d", p.stairs);
    legendTraps.setAttribute("d", p.traps);
    legendChests.setAttribute("d", p.chests);
    legendExits.setAttribute("d", p.exits);
    legendPlayer.setAttribute("d", p.player);
    legendLabels.forEach((d, i) => {
      const it = legend?.[i];
      if (it === undefined) {
        d.style.display = "none";
        return;
      }
      d.style.left = `${ax + it.x + BASE_CELL + 2}px`;
      d.style.top = `${ay + it.y}px`;
      d.style.display = "";
    });
  };
  let blinking: Animation | null = null;
  const stopBlink = (): void => {
    if (blinking !== null) blinking.cancel();
    blinking = null;
  };

  // UI-25: 地図本体のタップ。座標は SVG の左上からの論理 px（viewBox は area と同じ寸法）
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
        picked = false;
        paintNote();
        return;
      }
      picked = true;
      paintNote();
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
    toggleLegend(): boolean {
      legendOn = !legendOn;
      paintLegend();
      return legendOn;
    },
    legendOpen(): boolean {
      return legendOn;
    },
    render(v: MapView, t: string): void {
      // 描き直すと選択は消える（app は地図を開くたびに選択を解く）
      stopBlink();
      pickPath.setAttribute("d", "");
      shown = v;
      title.textContent = t;
      const lay = mapLayout(v.width, v.height, area);
      const p = mapPaths(v, lay);
      framePath.setAttribute("d", mapFramePath(v.width, v.height, lay));
      floorPath.setAttribute("d", p.floor);
      wallPath.setAttribute("d", p.walls);
      stairsPath.setAttribute("d", p.stairs);
      trapsPath.setAttribute("d", p.traps);
      chestsPath.setAttribute("d", p.chests);
      exitsPath.setAttribute("d", p.exits);
      playerPath.setAttribute("d", p.player);
      // M19: 注記の行と凡例（凡例の位置は盤の大きさから。開いているときだけ描く）
      unexplored.textContent = formatMessage(strings["map.unexplored"] ?? "", { n: v.unexploredExits });
      picked = false;
      paintNote();
      notes = mapNotes(v.width, v.height, area);
      paintLegend();
    },
  };
}
