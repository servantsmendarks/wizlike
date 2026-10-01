// UI-20〜22: 一人称の線画の座標表（すべて【仮】）と、DG-12 の視野からどの path を見せるかの規則。純粋。
// 座標は論理 px の画素番号。描画側は <g transform="translate(0.5 0.5)"> と crispEdges で 1px の線にする。
//
// 面 P_d は奥行き d のセルの手前の面（P0 は画面いっぱい、P1 が奥行き 0 の正面の壁）。どの面も L+R=239、T+B=149 で左右上下対称。
// 奥行き d のセルは P_d と P_{d+1} の間。正面の壁は P_{d+1}、側壁は P_d と P_{d+1} の角を結ぶ台形。
// 扉の比率【仮】: 正面と列の扉は幅 1/2・高さ 3/4 で床に接する（四捨五入、.5 は切り上げ）。
// 側壁の扉は台形の横 1/4〜3/4 に置き、その x での壁の高さの 3/4、床に接する。
// 左右の列（lane ±1）の正面の壁は、見えている帯（P_d.L..P_{d+1}.L、右は鏡像）だけを描き、その扉は帯の中央に描く目印とする。
// 階段の記号【仮】: 奥行き d のセルの床（y = P_{d+1}.B..P_d.B）に横線 3 本。y は床の奥の縁から f = 1/4, 1/2, 3/4（四捨五入）。
// 線の幅は、その y での床の幅の 3/4, 1/2, 1/4（幅の広い順）。下りは広い線が f=1/4（画面の上）で、画面の下ほど狭い（地図の V。
// 横線が奥へ下がっていく穴に見える）。上りは逆で、広い線が f=3/4（画面の下）で、画面の上ほど狭い（地図の ^）。床の幅は、中央の列は側壁の下辺の間（L(y)..239−L(y)。
// 左端を四捨五入し、右端は 239 − 左端で左右対称）。左の列は列の壁と同じ見えている帯 P_d.L..L(y) を使うが、帯は手前ほど細るので、
// 3 本とも最も手前の線（f=3/4）の y での帯を基準の幅にし、その中央に置く（両端を四捨五入）。右の列は左の鏡像。
import type { VisibleCell } from "../../core/types";

export type Plane = { L: number; R: number; T: number; B: number };

/** P0..P4（UI-21） */
export const PLANES: readonly Plane[] = [
  { L: 0, R: 239, T: 0, B: 149 },
  { L: 40, R: 199, T: 25, B: 124 },
  { L: 80, R: 159, T: 50, B: 99 },
  { L: 100, R: 139, T: 62, B: 87 },
  { L: 110, R: 129, T: 69, B: 80 },
];

/** cSU / cSD / lSU / lSD / rSU / rSD は階段の記号（U = 上り、D = 下り）。ほかは壁と扉 */
export type SlotPart = "cSU" | "cSD" | "lSU" | "lSD" | "rSU" | "rSD" | "cF" | "cD" | "cL" | "cR" | "cLD" | "cRD" | "lF" | "lD" | "rF" | "rD";
export type SlotDepth = 0 | 1 | 2 | 3;
export type SlotId = `${SlotPart}${SlotDepth}`;

export const SLOT_PARTS: readonly SlotPart[] = ["cSU", "cSD", "lSU", "lSD", "rSU", "rSD", "cF", "cD", "cL", "cR", "cLD", "cRD", "lF", "lD", "rF", "rD"];
export const SLOT_DEPTHS: readonly SlotDepth[] = [0, 1, 2, 3];
const STAIRS_PARTS: readonly SlotPart[] = ["cSU", "cSD", "lSU", "lSD", "rSU", "rSD"];

/** 階段の記号のスロットか（描画側が線の色を変える） */
export function isStairsSlot(id: SlotId): boolean {
  return STAIRS_PARTS.includes(id.slice(0, -1) as SlotPart);
}

/** 64 個。描画順（後ろほど上）は、奥から手前、同じ奥行きでは床の階段の記号 → 壁 → 扉 */
export const SLOT_IDS: readonly SlotId[] = SLOT_DEPTHS.slice()
  .reverse()
  .flatMap((d) => SLOT_PARTS.map((p): SlotId => `${p}${d}`));

const TABLE: Readonly<Record<SlotPart, readonly [string, string, string, string]>> = {
  // 階段の記号（床の横線 3 本。幅の広い順）。U = 上り、D = 下り
  cSU: ["M37 143H202 M69 137H170 M97 130H142", "M67 118H172 M89 112H150 M107 105H132", "M94 96H145 M105 93H134 M113 90H126", "M107 85H132 M112 84H127 M116 82H123"],
  cSD: ["M53 130H186 M69 137H170 M92 143H147", "M83 105H156 M89 112H150 M102 118H137", "M101 90H138 M105 93H134 M111 96H128", "M110 82H129 M112 84H127 M115 85H124"],
  lSU: ["M1 143H8 M2 137H7 M4 130H6", "M41 118H48 M42 112H47 M44 105H46", "M81 96H84 M81 93H84 M82 90H83", "M100 85H103 M101 84H102 M101 82H102"],
  lSD: ["M1 130H8 M2 137H7 M4 143H6", "M41 105H48 M42 112H47 M44 118H46", "M81 90H84 M81 93H84 M82 96H83", "M100 82H103 M101 84H102 M101 85H102"],
  rSU: ["M238 143H231 M237 137H232 M235 130H233", "M198 118H191 M197 112H192 M195 105H193", "M158 96H155 M158 93H155 M157 90H156", "M139 85H136 M138 84H137 M138 82H137"],
  rSD: ["M238 130H231 M237 137H232 M235 143H233", "M198 105H191 M197 112H192 M195 118H193", "M158 90H155 M158 93H155 M157 96H156", "M139 82H136 M138 84H137 M138 85H137"],
  // 正面の壁 = P_{d+1}
  cF: ["M40 25 H199 V124 H40 Z", "M80 50 H159 V99 H80 Z", "M100 62 H139 V87 H100 Z", "M110 69 H129 V80 H110 Z"],
  // 正面の扉（下辺は床なので描かない）
  cD: ["M80 124 V50 H159 V124", "M100 99 V62 H139 V99", "M110 87 V68 H129 V87", "M115 80 V72 H124 V80"],
  // 側壁: P_d の角 → P_{d+1} の角
  cL: ["M0 0 L40 25 V124 L0 149 Z", "M40 25 L80 50 V99 L40 124 Z", "M80 50 L100 62 V87 L80 99 Z", "M100 62 L110 69 V80 L100 87 Z"],
  cR: [
    "M239 0 L199 25 V124 L239 149 Z",
    "M199 25 L159 50 V99 L199 124 Z",
    "M159 50 L139 62 V87 L159 99 Z",
    "M139 62 L129 69 V80 L139 87 Z",
  ],
  cLD: ["M10 143 V40 L30 47 V130", "M50 118 V53 L70 59 V105", "M85 96 V64 L95 67 V90", "M103 85 V69 L108 71 V81"],
  cRD: ["M229 143 V40 L209 47 V130", "M189 118 V53 L169 59 V105", "M154 96 V64 L144 67 V90", "M136 85 V69 L131 71 V81"],
  // 左右の列の正面の壁（見えている帯だけ）
  lF: ["M0 25 H40 V124 H0 Z", "M40 50 H80 V99 H40 Z", "M80 62 H100 V87 H80 Z", "M100 69 H110 V80 H100 Z"],
  lD: ["M10 124 V50 H30 V124", "M50 99 V62 H70 V99", "M85 87 V68 H95 V87", "M103 80 V72 H108 V80"],
  rF: ["M239 25 H199 V124 H239 Z", "M199 50 H159 V99 H199 Z", "M159 62 H139 V87 H159 Z", "M139 69 H129 V80 H139 Z"],
  rD: ["M229 124 V50 H209 V124", "M189 99 V62 H169 V99", "M154 87 V68 H144 V87", "M136 80 V72 H131 V80"],
};

export const SLOT_PATHS: Readonly<Record<SlotId, string>> = Object.fromEntries(
  SLOT_PARTS.flatMap((p) => SLOT_DEPTHS.map((d) => [`${p}${d}`, TABLE[p][d]] as const)),
) as Record<SlotId, string>;

function isSlotDepth(d: number): d is SlotDepth {
  return d === 0 || d === 1 || d === 2 || d === 3;
}

/**
 * 見えるセル（DG-12）から、見せる path の集合を作る。返ってこなかったセルは描かない（闇）。
 * lane 0: front / left / right の wall は壁、door は壁と扉。lane ±1: front だけを使う。depth が 0..3 の外は無視。
 * stairs が up / down なら、その列の階段の記号（cSU / cSD、lSU / lSD、rSU / rSD）も出す（UI-20）。
 */
export function slotsFor(cells: readonly VisibleCell[]): Set<SlotId> {
  const out = new Set<SlotId>();
  const put = (edge: VisibleCell["front"], wall: SlotPart, door: SlotPart, d: SlotDepth): void => {
    if (edge === "open") return;
    out.add(`${wall}${d}`);
    if (edge === "door") out.add(`${door}${d}`);
  };
  for (const c of cells) {
    const d = c.depth;
    if (!isSlotDepth(d)) continue;
    if (c.stairs !== null) {
      const lane = c.lane === 0 ? "c" : c.lane === -1 ? "l" : "r";
      out.add(`${lane}S${c.stairs === "up" ? "U" : "D"}${d}`);
    }
    if (c.lane === 0) {
      put(c.front, "cF", "cD", d);
      put(c.left, "cL", "cLD", d);
      put(c.right, "cR", "cRD", d);
    } else if (c.lane === -1) {
      put(c.front, "lF", "lD", d);
    } else {
      put(c.front, "rF", "rD", d);
    }
  }
  return out;
}
