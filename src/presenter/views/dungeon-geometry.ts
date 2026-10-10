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
// 3 本とも最も手前の線（f=3/4）の y での帯を基準の幅にし、その中央に置く（両端を四捨五入し、左端は P_d.L+1 以上に切り詰める。
// 帯の縁 P_d.L は中央の側壁 cL と列の正面の壁 lF の縦線なので、線が壁に付かないように開区間に収める）。右の列は左の鏡像。
// 罠の印【仮】（M5.5。察知した罠 DG-21）: 奥行き d のセルの床に ×（2 本の斜線）。上下の端は床の奥の縁から f = 1/4, 3/4 の y（四捨五入）。
// 幅は f=3/4 の y で測った幅の 1/2。中央の列はその y の床（左端を四捨五入し、右端は 239 − 左端）、左の列は階段の記号と同じ帯
// P_d.L..L(y) の中央（両端を四捨五入し、左端は P_d.L+1 以上）。右の列は左の鏡像。
// 宝箱の印【仮】（M11。UI-72。開ける前の宝箱のセル DG-23）: 奥行き d のセルの床に立つ小さな箱（前面の矩形と、蓋の継ぎ目の横線 1 本。
// 奥行き 3 と左右の列の奥行き 2〜3 は小さいので継ぎ目なし）。中央の列は左右対称（x0 + x1 = 239）で、上端は P_{d+1}.B より下
// （正面の壁の下辺と交わらない）、下端は P_d.B より上。幅は奥ほど狭い（36・22・12・6）。左右の列は見えている床の三角形
// （(P_d.L, P_{d+1}.B)・(P_{d+1}.L, P_{d+1}.B)・(P_d.L, P_d.B)）の中に収め（左端は P_d.L+1 以上、右下の角は側壁の下辺より上、
// 上端は P_{d+1}.B より下）、右の列は左の鏡像。座標は手で置いた値で、テストは上の性質を確かめる。
// 開口側の床線（M16。UI-20）: 正面の列のセルの左（右）の辺が open のとき、側壁の台形の下辺（P_d の左下 → P_{d+1} の左下）だけを描く
// （cLO / cRO。床が横へ続く線。側壁 cL / cR とは同時に出ない）。
// 開口の印（M16。UI-20 / UI-21）: 線画の下端（y 145〜149。床の印の最下端 y143 から 1px 空ける）に左・前・右の小さな印。
// 自分のセル（depth 0 / lane 0）の left / front / right の Edge を写すだけ: open は向きの三角（◀ ▲ ▶）、door は小さな矩形、wall は描かない。
// 左右の印は x = 239 − x の鏡像、前の印は自分自身と左右対称。
import type { VisibleCell } from "../../core/types";

/** UI-20（M5.5）: 視野の中の察知した罠（core の visibleKnownTraps の値） */
export type TrapCell = { depth: number; lane: -1 | 0 | 1 };

/** UI-72（M11）: 視野の中の開ける前の宝箱のセル（core の visibleChests の値） */
export type ChestCell = { depth: number; lane: -1 | 0 | 1 };

export type Plane = { L: number; R: number; T: number; B: number };

/** P0..P4（UI-21） */
export const PLANES: readonly Plane[] = [
  { L: 0, R: 239, T: 0, B: 149 },
  { L: 40, R: 199, T: 25, B: 124 },
  { L: 80, R: 159, T: 50, B: 99 },
  { L: 100, R: 139, T: 62, B: 87 },
  { L: 110, R: 129, T: 69, B: 80 },
];

/** cSU / cSD / lSU / lSD / rSU / rSD は階段の記号（U = 上り、D = 下り）。cT / lT / rT は察知した罠の印（M5.5）。cC / lC / rC は宝箱の印（M11）。cLO / cRO は開口側の床線（M16）。ほかは壁と扉 */
export type SlotPart =
  | "cSU"
  | "cSD"
  | "lSU"
  | "lSD"
  | "rSU"
  | "rSD"
  | "cT"
  | "lT"
  | "rT"
  | "cC"
  | "lC"
  | "rC"
  | "cLO"
  | "cRO"
  | "cF"
  | "cD"
  | "cL"
  | "cR"
  | "cLD"
  | "cRD"
  | "lF"
  | "lD"
  | "rF"
  | "rD";
export type SlotDepth = 0 | 1 | 2 | 3;
export type SlotId = `${SlotPart}${SlotDepth}`;

export const SLOT_PARTS: readonly SlotPart[] = [
  "cSU",
  "cSD",
  "lSU",
  "lSD",
  "rSU",
  "rSD",
  "cT",
  "lT",
  "rT",
  "cC",
  "lC",
  "rC",
  "cLO",
  "cRO",
  "cF",
  "cD",
  "cL",
  "cR",
  "cLD",
  "cRD",
  "lF",
  "lD",
  "rF",
  "rD",
];
export const SLOT_DEPTHS: readonly SlotDepth[] = [0, 1, 2, 3];
const STAIRS_PARTS: readonly SlotPart[] = ["cSU", "cSD", "lSU", "lSD", "rSU", "rSD"];
const TRAP_PARTS: readonly SlotPart[] = ["cT", "lT", "rT"];
const CHEST_PARTS: readonly SlotPart[] = ["cC", "lC", "rC"];

/** 階段の記号のスロットか（描画側が線の色を変える） */
export function isStairsSlot(id: SlotId): boolean {
  return STAIRS_PARTS.includes(id.slice(0, -1) as SlotPart);
}

/** 察知した罠の印のスロットか（描画側が線の色を danger にする。M5.5） */
export function isTrapSlot(id: SlotId): boolean {
  return TRAP_PARTS.includes(id.slice(0, -1) as SlotPart);
}

/** 宝箱の印のスロットか（描画側が線の色を accent にする。地図の宝箱の □ と同じ。M11） */
export function isChestSlot(id: SlotId): boolean {
  return CHEST_PARTS.includes(id.slice(0, -1) as SlotPart);
}

/** 96 個（M5.5 で罠の印 12、M11 で宝箱の印 12、M16 で開口側の床線 8 を足した）。描画順（後ろほど上）は、奥から手前、同じ奥行きでは床の印（階段・罠・宝箱）→ 床線 → 壁 → 扉 */
export const SLOT_IDS: readonly SlotId[] = SLOT_DEPTHS.slice()
  .reverse()
  .flatMap((d) => SLOT_PARTS.map((p): SlotId => `${p}${d}`));

const TABLE: Readonly<Record<SlotPart, readonly [string, string, string, string]>> = {
  // 階段の記号（床の横線 3 本。幅の広い順）。U = 上り、D = 下り
  cSU: ["M37 143H202 M69 137H170 M97 130H142", "M67 118H172 M89 112H150 M107 105H132", "M94 96H145 M105 93H134 M113 90H126", "M107 85H132 M112 84H127 M116 82H123"],
  cSD: ["M53 130H186 M69 137H170 M92 143H147", "M83 105H156 M89 112H150 M102 118H137", "M101 90H138 M105 93H134 M111 96H128", "M110 82H129 M112 84H127 M115 85H124"],
  lSU: ["M1 143H8 M2 137H7 M4 130H6", "M41 118H48 M42 112H47 M44 105H46", "M81 96H84 M81 93H84 M82 90H83", "M101 85H103 M101 84H102 M101 82H102"],
  lSD: ["M1 130H8 M2 137H7 M4 143H6", "M41 105H48 M42 112H47 M44 118H46", "M81 90H84 M81 93H84 M82 96H83", "M101 82H103 M101 84H102 M101 85H102"],
  rSU: ["M238 143H231 M237 137H232 M235 130H233", "M198 118H191 M197 112H192 M195 105H193", "M158 96H155 M158 93H155 M157 90H156", "M138 85H136 M138 84H137 M138 82H137"],
  rSD: ["M238 130H231 M237 137H232 M235 143H233", "M198 105H191 M197 112H192 M195 118H193", "M158 90H155 M158 93H155 M157 96H156", "M138 82H136 M138 84H137 M138 85H137"],
  // 察知した罠の印（床の ×。M5.5）
  cT: ["M65 130L174 143M174 130L65 143", "M85 105L154 118M154 105L85 118", "M102 90L137 96M137 90L102 96", "M111 82L128 85M128 82L111 85"],
  lT: ["M2 130L7 143M7 130L2 143", "M42 105L47 118M47 105L42 118", "M81 90L84 96M84 90L81 96", "M101 82L102 85M102 82L101 85"],
  rT: ["M237 130L232 143M232 130L237 143", "M197 105L192 118M192 105L197 118", "M158 90L155 96M155 90L158 96", "M138 82L137 85M137 82L138 85"],
  // 宝箱の印（床に立つ箱の前面と蓋の継ぎ目。M11）
  cC: ["M102 127H137V143H102Z M102 132H137", "M109 108H130V118H109Z M109 111H130", "M114 90H125V96H114Z M114 92H125", "M117 82H122V85H117Z"],
  lC: ["M4 126H22V135H4Z M4 129H22", "M44 101H62V110H44Z M44 104H62", "M82 88H90V92H82Z", "M101 81H105V83H101Z"],
  rC: ["M235 126H217V135H235Z M235 129H217", "M195 101H177V110H195Z M195 104H177", "M157 88H149V92H157Z", "M138 81H134V83H138Z"],
  // 開口側の床線（側壁の台形の下辺と同じ。M16）
  cLO: ["M0 149 L40 124", "M40 124 L80 99", "M80 99 L100 87", "M100 87 L110 80"],
  cRO: ["M239 149 L199 124", "M199 124 L159 99", "M159 99 L139 87", "M139 87 L129 80"],
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
 * lane 0: front / left / right の wall は壁、door は壁と扉。left / right が open なら開口側の床線（cLO / cRO。M16）。lane ±1: front だけを使う。depth が 0..3 の外は無視。
 * stairs が up / down なら、その列の階段の記号（cSU / cSD、lSU / lSD、rSU / rSD）も出す（UI-20）。
 * traps（core の visibleKnownTraps）の各セルには、その列の罠の印（cT / lT / rT）を出す。壁・階段とは独立。depth が 0..3 の外は無視（M5.5）。
 * chests（core の visibleChests）の各セルには、その列の宝箱の印（cC / lC / rC）を出す。罠と同じく独立で、depth が 0..3 の外は無視（M11。UI-72）。
 */
export function slotsFor(cells: readonly VisibleCell[], traps: readonly TrapCell[] = [], chests: readonly ChestCell[] = []): Set<SlotId> {
  const out = new Set<SlotId>();
  const put = (edge: VisibleCell["front"], wall: SlotPart, door: SlotPart, d: SlotDepth, open?: SlotPart): void => {
    if (edge === "open") {
      if (open !== undefined) out.add(`${open}${d}`);
      return;
    }
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
      put(c.left, "cL", "cLD", d, "cLO");
      put(c.right, "cR", "cRD", d, "cRO");
    } else if (c.lane === -1) {
      put(c.front, "lF", "lD", d);
    } else {
      put(c.front, "rF", "rD", d);
    }
  }
  for (const tr of traps) {
    const d = tr.depth;
    if (!isSlotDepth(d)) continue;
    out.add(`${tr.lane === 0 ? "c" : tr.lane === -1 ? "l" : "r"}T${d}`);
  }
  for (const ch of chests) {
    const d = ch.depth;
    if (!isSlotDepth(d)) continue;
    out.add(`${ch.lane === 0 ? "c" : ch.lane === -1 ? "l" : "r"}C${d}`);
  }
  return out;
}

/** 開口の印（M16。UI-20 / UI-21）。xL / xF / xR は open の印（◀ ▲ ▶）、xLD / xFD / xRD は door の印（小さな矩形） */
export type ExitMarkId = "xL" | "xF" | "xR" | "xLD" | "xFD" | "xRD";

/** 描画順（すべてのスロットの後に置く） */
export const EXIT_MARK_IDS: readonly ExitMarkId[] = ["xL", "xF", "xR", "xLD", "xFD", "xRD"];

/** 線画の下端の y 145〜149。左は x100〜104、前は x117〜122、右は x135〜139（左右は鏡像） */
export const EXIT_MARK_PATHS: Readonly<Record<ExitMarkId, string>> = {
  xL: "M104 145 L100 147 L104 149 Z",
  xF: "M117 149 L119 145 H120 L122 149 Z",
  xR: "M135 145 L139 147 L135 149 Z",
  xLD: "M100 145 H104 V149 H100 Z",
  xFD: "M117 145 H122 V149 H117 Z",
  xRD: "M139 145 H135 V149 H139 Z",
};

/**
 * 自分のセル（depth 0 / lane 0）の left / front / right の Edge を写す（M16。UI-20 / UI-21）。open は xL / xF / xR、door は xLD / xFD / xRD、wall は何も出さない。
 * 自分のセルが cells に無ければ空。判定はしない（どこが道かは core の Edge のまま）。
 */
export function exitMarksFor(cells: readonly VisibleCell[]): Set<ExitMarkId> {
  const out = new Set<ExitMarkId>();
  const me = cells.find((c) => c.depth === 0 && c.lane === 0);
  if (me === undefined) return out;
  const put = (edge: VisibleCell["front"], open: ExitMarkId, door: ExitMarkId): void => {
    if (edge === "open") out.add(open);
    else if (edge === "door") out.add(door);
  };
  put(me.left, "xL", "xLD");
  put(me.front, "xF", "xFD");
  put(me.right, "xR", "xRD");
  return out;
}
