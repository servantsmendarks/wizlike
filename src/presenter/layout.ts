// ui.md §2 の縦の区切りと、各画面のボタンの矩形（論理 px）。純粋なデータと関数だけ。
// 矩形は { x, y, w, h } で、占める画素は x..x+w-1、y..y+h-1（閉区間）。
// UI-10: 押せるものは一辺 TOUCH_MIN_LOGICAL 以上（scale 4/3 以上で 40 CSS px）。例外は TOUCH_EXCEPTIONS。
// 迷宮の画面（ヘッダー・ビュー・メッセージ・パーティ・操作）の矩形は、config.ui.layout から regions で作った
// 各領域の原点からの相対座標で持ち、dungeonLayout がステージ座標に直す（ui §2 の高さは【仮】で、config で動く）。
// タイトル・作成・debug パネルはステージ全面の画面なので、ステージ座標の定数のまま。
import type { Config } from "../core/data/index";

export type Rect = { x: number; y: number; w: number; h: number };
export type Regions = { header: Rect; view: Rect; message: Rect; party: Rect; controls: Rect };

const REGION_ORDER = ["header", "view", "message", "party", "controls"] as const;

/** 上から高さを累積して 5 領域の矩形を作る。既定値では top は 0 / 16 / 166 / 236 / 300 */
export function regions(l: Config["ui"]["layout"], width: number): Regions {
  let y = 0;
  const out = {} as Regions;
  for (const k of REGION_ORDER) {
    out[k] = { x: 0, y, w: width, h: l[k] };
    y += l[k];
  }
  return out;
}

/** UI-10 の最小の一辺（論理 px）。CSS px の 40 を scale 4/3 で満たす */
export const TOUCH_MIN_LOGICAL = 30;

/**
 * UI-10 の最小寸法を満たさなくてよい矩形の名前（dungeonLayout の header.settings、M8.5 の townLayout の header.log・
 * パーティの帯 town.band（40×22）・一覧の行 town.list（高さ 22）。添字付きの名前 "town.band[0]" なども含む）
 */
export const TOUCH_EXCEPTIONS: readonly string[] = ["header.settings", "header.log", "town.band", "town.list"];

/** UI-10: name が TOUCH_EXCEPTIONS の名前そのものか、その添字付き（"town.band[2]"） */
export function isTouchException(name: string): boolean {
  return TOUCH_EXCEPTIONS.some((e) => name === e || name.startsWith(`${e}[`));
}

// ---- 迷宮の画面（各領域の左上からの相対座標）

/** ヘッダーの設定ボタンの幅。右端に置き、高さはヘッダーの高さ（16 が上限なので UI-10 の例外。F2 でも開ける） */
const HEADER_SETTINGS_W = 40;
/** ヘッダーの文字の左右の余白 */
const HEADER_TEXT_PAD = 4;
/** UI-54（M5.5）: 戦闘のターン表示の幅。ヘッダーの文字領域の右端に右寄せで置く */
export const HEADER_TURN_W = 56;
/** UI-54（M5.5）: ターン表示を出している間、問いの文字領域をターン表示の幅とこの間だけ縮める */
export const HEADER_TURN_GAP = 4;

/** 迷宮の十字ボタン（UI-32）。操作領域からの相対 */
const DPAD_REL = {
  forward: { x: 40, y: 0, w: 32, h: 32 },
  left: { x: 6, y: 33, w: 32, h: 32 },
  right: { x: 74, y: 33, w: 32, h: 32 },
  around: { x: 40, y: 66, w: 32, h: 32 },
} as const satisfies Record<string, Rect>;
export type DpadKey = keyof typeof DPAD_REL;

/** 迷宮のメニュー（UI-53）。[0] キャンプ・[1] 地図。操作領域からの相対 */
const MENU_SLOTS_REL: readonly Rect[] = [
  { x: 124, y: 0, w: 56, h: 32 },
  { x: 182, y: 0, w: 56, h: 32 },
  { x: 124, y: 33, w: 56, h: 32 },
  { x: 182, y: 33, w: 56, h: 32 },
];

/** 街のメニューと選択肢の行。4 件以上は縦スクロール（UI-11）。操作領域からの相対 */
const LIST_ROWS_REL: readonly Rect[] = [
  { x: 8, y: 2, w: 224, h: 32 },
  { x: 8, y: 34, w: 224, h: 32 },
  { x: 8, y: 66, w: 224, h: 32 },
];

/**
 * UI-11: 末尾が戻る / やめるの一覧（街の各施設のページ・キャンプと酒場の一覧の段・戦闘の呪文・道具・対象）の行。
 * LIST_ROWS_REL と同じ 3 行で、幅を 168 に詰めて右下の LIST_BACK_REL と並べる（間 2）。操作領域からの相対
 */
const LIST_NARROW_REL: readonly Rect[] = LIST_ROWS_REL.map((r): Rect => ({ ...r, w: 168 }));

/** UI-11: 一覧の外に固定する戻る / やめる。戦闘のメンバーの戻る（BATTLE_MEMBER_REL[4]）・キャンプの [7] と同じ 56×40。操作領域からの相対 */
const LIST_BACK_REL: Rect = { x: 178, y: 54, w: 56, h: 40 };

/** 地図の overlay を閉じるボタン（UI-24）。操作領域からの相対 */
const MAP_CLOSE_REL: Rect = { x: 60, y: 34, w: 120, h: 32 };

/** 地図の「移動」ボタン（UI-25）。閉じるの真下に同じ幅で置く（下端 97）。操作領域からの相対 */
const MAP_GO_REL: Rect = { x: 60, y: 66, w: 120, h: 32 };

/**
 * 戦闘のパーティの選択（UI-54）。2 列 × 2 段の 114×40（戦う・前回と同じ / 逃げる・オート）。
 * 操作領域からの相対（コードの定数で、config には置かない）
 */
const BATTLE_PARTY_REL: readonly Rect[] = [
  { x: 4, y: 6, w: 114, h: 40 },
  { x: 122, y: 6, w: 114, h: 40 },
  { x: 4, y: 54, w: 114, h: 40 },
  { x: 122, y: 54, w: 114, h: 40 },
];

/**
 * 戦闘のメンバーの枠（UI-54）。56×40 の上段 4 つ（攻撃・呪文・防御・道具）と、下段の右端の戻る。
 * 呪文・道具・対象の一覧は LIST_NARROW_REL と LIST_BACK_REL（UI-11）を使う。操作領域からの相対
 */
const BATTLE_MEMBER_REL: readonly Rect[] = [
  ...[4, 62, 120, 178].map((x): Rect => ({ x, y: 6, w: 56, h: 40 })),
  { x: 178, y: 54, w: 56, h: 40 },
];

/**
 * キャンプの枠（UI-53 / UI-59）。4 列 × 2 段の 56×40 の 8 枠（[7] がやめる / 戻る）。
 * 列は戦闘のメンバーの枠と同じ x 4 / 62 / 120 / 178、段は y 6 / 54。操作領域からの相対
 */
const CAMP_GRID_REL: readonly Rect[] = [6, 54].flatMap((y) => [4, 62, 120, 178].map((x): Rect => ({ x, y, w: 56, h: 40 })));

/**
 * オート中の「オート解除」ボタン（UI-54）。操作領域からの相対。
 * パーティの選択の「戦う」（BATTLE_PARTY_REL[0]）と同じ矩形に置く。CB-43 でオートが解けると同じ場所にパーティの選択が出るので、
 * 解除のつもりの押し直しが コマンドを送る枠（前回と同じ・逃げる・オート）に当たらないようにする（戦うは段を移るだけで「戻る」で戻れる）
 */
const AUTO_STOP_REL: Rect = { ...BATTLE_PARTY_REL[0]! };

/** 操作領域の中身が収まる最小の高さ（相対矩形の下端の最大）。既定の layout では 98 */
export const CONTROLS_MIN_HEIGHT = Math.max(
  ...[...Object.values(DPAD_REL), ...MENU_SLOTS_REL, ...LIST_ROWS_REL, ...LIST_NARROW_REL, LIST_BACK_REL, MAP_CLOSE_REL, MAP_GO_REL, ...BATTLE_PARTY_REL, ...BATTLE_MEMBER_REL, ...CAMP_GRID_REL, AUTO_STOP_REL].map(
    (r) => r.y + r.h,
  ),
);

/** メッセージ窓（UI-43）。枠 1px、文字領域は左右 4px・上下 2px の内側、行間 10px。続きの三角は 8×8 で文字領域の右下 */
export const MESSAGE_LINE_H = 10;
const MESSAGE_PAD_X = 4;
const MESSAGE_PAD_Y = 2;
const MESSAGE_MORE = 8;

/**
 * UI-59（M10）: キャラクター画面の行数（10px の行。上の余白 4 を足した CHARACTER_MIN_HEIGHT が layout.character の高さに入ること）。
 * 行の中身は views/detail.ts
 */
export const CHARACTER_LINES = 27;
export const CHARACTER_MIN_HEIGHT = 4 + MESSAGE_LINE_H * CHARACTER_LINES;

/** パーティ欄（ui §2）。1 行 10px、上の余白は 2px（入らなければ詰める） */
export const PARTY_ROW_H = 10;
const PARTY_ROW_TOP = 2;

/** 地図の overlay（UI-24）の題の高さ。残りが地図本体 */
const MAP_TITLE_H = 12;

const shift = (r: Rect, o: Rect): Rect => ({ x: o.x + r.x, y: o.y + r.y, w: r.w, h: r.h });

export type DungeonLayout = {
  /** text は問い・現在地の文字領域、turn は戦闘のターン表示（UI-54。text の右端に右寄せ、設定ボタンと重ならない） */
  header: { text: Rect; settings: Rect; turn: Rect };
  dpad: Record<DpadKey, Rect>;
  menu: Rect[];
  list: Rect[];
  /** UI-11 末尾が戻る / やめるの一覧の行（list と同じ 3 行で幅 168）。末尾の項目は listBack に固定する */
  listNarrow: Rect[];
  /** UI-11 一覧の外に固定する戻る / やめる（battleMember[4] と同じ矩形） */
  listBack: Rect;
  mapClose: Rect;
  /** UI-25 地図の「移動」（mapClose の真下） */
  mapGo: Rect;
  /** 戦闘のパーティの選択の 4 枠（上段 0..1、下段 2..3） */
  battleParty: Rect[];
  /** 戦闘のメンバーの 5 枠（上段 0..3、下段の右端 4） */
  battleMember: Rect[];
  /** オート中の「オート解除」 */
  autoStop: Rect;
  /** UI-53 キャンプの 8 枠（上段 0..3、下段 4..7。[7] がやめる / 戻る） */
  campGrid: Rect[];
  /** text は文字領域（枠の内側）、lines はそこに入る行数、more は続きの三角 */
  message: { text: Rect; lines: number; more: Rect };
  /** パーティ欄の行 0..partySize-1 */
  partyRows: Rect[];
  /** overlay はビューとメッセージを合わせた範囲。title は題の行、area は地図本体（mapLayout に渡す寸法） */
  map: { overlay: Rect; title: Rect; area: Rect };
  /** UI-53 キャンプと酒場のパネル（= ビュー領域。メッセージ窓とパーティ欄は見えたまま） */
  camp: Rect;
  /**
   * UI-59（M10）: キャラクター画面（と酒場の図鑑）のパネル。ビューの上端から操作領域の上端まで（既定 y16..299 の 240×284）。
   * 開いている間はパーティ欄とメッセージ窓を隠す（dungeon.ts の setCharacterOpen）
   */
  character: Rect;
  /** UI-56 の全滅の内訳の overlay。地図と同じくビューとメッセージを合わせた範囲 */
  wipe: Rect;
  /** UI-46 の履歴の画面。地図と同じ範囲で、title は題の行、list は縦スクロールの一覧 */
  history: { overlay: Rect; title: Rect; list: Rect };
};

/** 迷宮の画面の矩形をすべてステージ座標で返す。既定の layout（16/150/70/64/100）では M2 の定数と同じ座標 */
export function dungeonLayout(g: Regions, partySize: number): DungeonLayout {
  const h = g.header;
  const settings: Rect = { x: h.x + h.w - HEADER_SETTINGS_W, y: h.y, w: HEADER_SETTINGS_W, h: h.h };
  const text: Rect = { x: h.x + HEADER_TEXT_PAD, y: h.y, w: settings.x - h.x - 2 * HEADER_TEXT_PAD, h: h.h };
  const turn: Rect = { x: text.x + text.w - HEADER_TURN_W, y: text.y, w: HEADER_TURN_W, h: text.h };

  const c = g.controls;
  const dpad = Object.fromEntries(Object.entries(DPAD_REL).map(([k, r]) => [k, shift(r, c)])) as Record<DpadKey, Rect>;

  const m = g.message;
  const mText: Rect = { x: m.x + MESSAGE_PAD_X, y: m.y + MESSAGE_PAD_Y, w: m.w - 2 * MESSAGE_PAD_X, h: m.h - 2 * MESSAGE_PAD_Y };
  const more: Rect = {
    x: mText.x + mText.w - MESSAGE_MORE,
    y: mText.y + mText.h - MESSAGE_MORE,
    w: MESSAGE_MORE,
    h: MESSAGE_MORE,
  };

  const p = g.party;
  const top = Math.max(0, Math.min(PARTY_ROW_TOP, p.h - partySize * PARTY_ROW_H));
  const partyRows = Array.from({ length: partySize }, (_, i): Rect => ({ x: p.x, y: p.y + top + PARTY_ROW_H * i, w: p.w, h: PARTY_ROW_H }));

  const v = g.view;
  const overlay: Rect = { x: v.x, y: v.y, w: v.w, h: v.h + m.h };
  return {
    header: { text, settings, turn },
    dpad,
    menu: MENU_SLOTS_REL.map((r) => shift(r, c)),
    list: LIST_ROWS_REL.map((r) => shift(r, c)),
    listNarrow: LIST_NARROW_REL.map((r) => shift(r, c)),
    listBack: shift(LIST_BACK_REL, c),
    mapClose: shift(MAP_CLOSE_REL, c),
    mapGo: shift(MAP_GO_REL, c),
    battleParty: BATTLE_PARTY_REL.map((r) => shift(r, c)),
    battleMember: BATTLE_MEMBER_REL.map((r) => shift(r, c)),
    autoStop: shift(AUTO_STOP_REL, c),
    campGrid: CAMP_GRID_REL.map((r) => shift(r, c)),
    message: { text: mText, lines: Math.max(0, Math.floor(mText.h / MESSAGE_LINE_H)), more },
    partyRows,
    map: {
      overlay,
      title: { x: overlay.x, y: overlay.y, w: overlay.w, h: MAP_TITLE_H },
      area: { x: overlay.x, y: overlay.y + MAP_TITLE_H, w: overlay.w, h: overlay.h - MAP_TITLE_H },
    },
    camp: { ...v },
    character: { x: v.x, y: v.y, w: v.w, h: c.y - v.y },
    wipe: { ...overlay },
    history: {
      overlay: { ...overlay },
      title: { x: overlay.x, y: overlay.y, w: overlay.w, h: MAP_TITLE_H },
      list: { x: overlay.x, y: overlay.y + MAP_TITLE_H, w: overlay.w, h: overlay.h - MAP_TITLE_H },
    },
  };
}

// ---- 街の画面（UI-13。M8.5）。ヘッダー 16 / 施設の絵 150 / パーティの帯 10 / 見出し / 一覧 / 戻る。数値は【仮】（decisions 2026-10-06）

/** UI-13: ヘッダーのログのボタンの幅（設定の左に並べる。高さはヘッダー。UI-10 の例外 header.log） */
const HEADER_LOG_W = 40;
/** UI-13: パーティの帯の高さ（1 行）と、押せる範囲の高さ（帯と見出しの行。UI-10 の例外 town.band） */
export const TOWN_BAND_H = 10;
const TOWN_BAND_HIT_H = 22;
/** UI-13: 一覧の行の高さ（UI-10 の 12 論理 px 以上。TOUCH_MIN_LOGICAL は満たさない例外 town.list。Pixel 3a で約 32 CSS px） */
export const TOWN_ROW_H = 22;
/** UI-13: 見出しと一覧の x と幅（一覧は固定の戻る LIST_BACK_REL の左に幅 168） */
const TOWN_LIST_X = 8;
const TOWN_HEADING_W = 224;
const TOWN_LIST_W = 168;
/** UI-13: 帯・見出し・一覧の間の余白 */
const TOWN_GAP = 2;
/**
 * UI-13 / UI-52（M10。2026-10-07 ユーザー判断 U3）: 施設メニューの正方形のボタン。一辺 48 を 3 列 × 2 段、間 8。
 * 列はステージの中央寄せ（x40 / 96 / 152）、段は一覧の欄の上端から（y190 / 246）。施設メニューには戻るが無いので一覧の幅 168 に縛らない
 */
const TOWN_GRID_SIZE = 48;
const TOWN_GRID_GAP = 8;
const TOWN_GRID_COLS = 3;
const TOWN_GRID_ROWS = 2;
/** UI-13 / UI-52（M10。U3）: 施設メニューのラベルの字数の上限（8px の字で 48×48 の内側 46 に収まる。town-view.test で strings を検査する） */
export const TOWN_GRID_LABEL_MAX = 4;
/**
 * UI-47（M10.5）: 街の会話の箱は絵の下端からステージの下端まで（帯・見出し・一覧・施設メニュー・戻るに被せる）。行数は矩形と行の高さから決める。
 * 迷宮のキャラクター画面の箱（compact）は M8.5 の 3 行のまま（行数と、箱の左右の余白・絵の下端との余白）
 */
const TALK_COMPACT_LINES = 3;
const TALK_MARGIN_X = 2;
const TALK_MARGIN_BOTTOM = 2;
/** UI-47: 会話の箱の文字の幅（全角 28 字。UI-43 の禁則で 1 行 28 字以下） */
const TALK_TEXT_W = 224;
/** UI-47（M10.5）: 会話の箱の文字の幅の単位（半角 1 字。8px の字で 4px。全角は 2 単位）。cols = 文字の幅 / これ */
const TALK_UNIT_PX = 4;
/** UI-40（M8.5）: 街の判定の箱の下端と会話の箱の上端の間 */
const TOWN_DICE_GAP = 2;

/** UI-47: 会話の箱の矩形。box は枠、text は文字領域（lines 行）、cols は 1 行の単位（半角 1・全角 2）、more は ▼ */
export type TalkRect = { box: Rect; text: Rect; lines: number; cols: number; more: Rect };

/**
 * UI-47 / UI-11（M10.5 追補。2026-10-07 レビュー）: 文字領域の右に空ける続きの印の列（印 8px = views/scroll-marks の SCROLL_MARK_SIZE と、
 * 文字・枠線との間の 1px ずつ）。layout.test で SCROLL_MARK_SIZE + 2 と一致することを検査する
 */
export const TALK_MARK_GUTTER = 10;

/**
 * UI-47: 枠 box の内側に文字領域（枠の内側から左 4・上下 2 の余白、右は続きの印の列 TALK_MARK_GUTTER、幅は TALK_TEXT_W まで）と
 * ▼（文字領域の右下）を置く。広い箱（w240）は 224 のまま、迷宮のキャラクター画面の 3 行の箱（w236）は 220
 */
function talkRect(box: Rect): TalkRect {
  const w = Math.min(TALK_TEXT_W, box.w - 2 - MESSAGE_PAD_X - TALK_MARK_GUTTER);
  const lines = Math.max(1, Math.floor((box.h - 2 * (1 + MESSAGE_PAD_Y)) / MESSAGE_LINE_H));
  const text: Rect = { x: box.x + 1 + MESSAGE_PAD_X, y: box.y + 1 + MESSAGE_PAD_Y, w, h: lines * MESSAGE_LINE_H };
  const more: Rect = { x: text.x + text.w - MESSAGE_MORE, y: text.y + text.h - MESSAGE_MORE, w: MESSAGE_MORE, h: MESSAGE_MORE };
  return { box, text, lines, cols: Math.floor(w / TALK_UNIT_PX), more };
}

export type TownLayout = {
  /** text は場所と所持金、log はログのボタン（UI-46 の履歴を開く）、settings は設定のボタン */
  header: { text: Rect; log: Rect; settings: Rect };
  /** UI-61 施設の絵（= ビュー領域。240×150） */
  picture: Rect;
  /** UI-47 会話の箱（M10.5。絵の下端からステージの下端まで） */
  talk: TalkRect;
  /** UI-47 / UI-59 迷宮のキャラクター画面の会話の箱（M8.5 の 3 行。絵の下端に重なる） */
  talkCompact: TalkRect;
  /** UI-40 街の判定の箱の下端（ビューの座標。会話の箱の上 TOWN_DICE_GAP = 絵の下端の 2 上） */
  diceBottom: number;
  /** UI-40 / UI-59 迷宮のキャラクター画面の判定の箱の下端（ビューの座標。compact の箱の上 TOWN_DICE_GAP） */
  diceBottomCompact: number;
  /** パーティの帯。cells は見える 1 行の 6 セル（40×10）、hits は押せる範囲（帯と見出しの行の 40×22） */
  band: { row: Rect; cells: Rect[]; hits: Rect[] };
  /** 一覧の見出し（1 行。押せない） */
  heading: Rect;
  /** 一覧。area は縦スクロールの欄（行の高さの整数倍）、rows は見える行 */
  list: { area: Rect; rows: Rect[] };
  /** UI-13 / UI-52（M10）: 施設メニューの 6 枠（48×48 の 3 列 × 2 段。行の順に 酒場・宿屋・寺院 / 闇魔術・迷宮へ・店） */
  grid: Rect[];
  /** UI-11 の固定の戻る（操作領域の x178・y54 の 56×40） */
  back: Rect;
};

/** UI-13: 街の画面の矩形（ステージ座標）。既定の regions では ヘッダー y0..15、絵 y16..165、帯 y166..175、見出し y178..187、一覧 y190..387（22×9 行）、施設メニューの 6 枠 x40/96/152・y190/246 の 48×48（M10）、戻る 178,354。
 * 会話の箱（M10.5）は x0..239・y166..399（22 行。帯から戻るまでに被せる）、迷宮のキャラクター画面の箱は x2..237・y128..163（3 行） */
export function townLayout(g: Regions, partySize: number): TownLayout {
  const h = g.header;
  const settings: Rect = { x: h.x + h.w - HEADER_SETTINGS_W, y: h.y, w: HEADER_SETTINGS_W, h: h.h };
  const log: Rect = { x: settings.x - HEADER_LOG_W, y: h.y, w: HEADER_LOG_W, h: h.h };
  const text: Rect = { x: h.x + HEADER_TEXT_PAD, y: h.y, w: log.x - h.x - 2 * HEADER_TEXT_PAD, h: h.h };

  const v = g.view;
  const bandY = v.y + v.h;
  const stageBottom = g.controls.y + g.controls.h;
  const talk = talkRect({ x: v.x, y: bandY, w: v.w, h: stageBottom - bandY });
  const compactH = TALK_COMPACT_LINES * MESSAGE_LINE_H + 2 * (MESSAGE_PAD_Y + 1);
  const talkCompact = talkRect({ x: v.x + TALK_MARGIN_X, y: v.y + v.h - TALK_MARGIN_BOTTOM - compactH, w: v.w - 2 * TALK_MARGIN_X, h: compactH });

  const cellW = Math.floor(v.w / Math.max(1, partySize));
  const cells = Array.from({ length: partySize }, (_, i): Rect => ({ x: v.x + cellW * i, y: bandY, w: cellW, h: TOWN_BAND_H }));
  const hits = cells.map((r): Rect => ({ ...r, h: TOWN_BAND_HIT_H }));

  const heading: Rect = { x: TOWN_LIST_X, y: bandY + TOWN_BAND_H + TOWN_GAP, w: TOWN_HEADING_W, h: MESSAGE_LINE_H };
  const listY = heading.y + heading.h + TOWN_GAP;
  const bottom = g.controls.y + g.controls.h;
  const count = Math.max(1, Math.floor((bottom - listY) / TOWN_ROW_H));
  const area: Rect = { x: TOWN_LIST_X, y: listY, w: TOWN_LIST_W, h: count * TOWN_ROW_H };
  const back = shift(LIST_BACK_REL, g.controls);
  const gridW = TOWN_GRID_COLS * TOWN_GRID_SIZE + (TOWN_GRID_COLS - 1) * TOWN_GRID_GAP;
  const gridX = v.x + Math.floor((v.w - gridW) / 2);
  const grid = Array.from({ length: TOWN_GRID_COLS * TOWN_GRID_ROWS }, (_, i): Rect => ({
    x: gridX + (TOWN_GRID_SIZE + TOWN_GRID_GAP) * (i % TOWN_GRID_COLS),
    y: listY + (TOWN_GRID_SIZE + TOWN_GRID_GAP) * Math.floor(i / TOWN_GRID_COLS),
    w: TOWN_GRID_SIZE,
    h: TOWN_GRID_SIZE,
  }));
  return {
    header: { text, log, settings },
    picture: { ...v },
    talk,
    talkCompact,
    diceBottom: talk.box.y - v.y - TOWN_DICE_GAP,
    diceBottomCompact: talkCompact.box.y - v.y - TOWN_DICE_GAP,
    band: { row: { x: v.x, y: bandY, w: v.w, h: TOWN_BAND_H }, cells, hits },
    heading,
    list: { area, rows: Array.from({ length: count }, (_, i): Rect => ({ x: area.x, y: area.y + TOWN_ROW_H * i, w: area.w, h: TOWN_ROW_H })) },
    grid,
    back,
  };
}

function inside(r: Rect, outer: Rect): boolean {
  return r.x >= outer.x && r.y >= outer.y && r.x + r.w <= outer.x + outer.w && r.y + r.h <= outer.y + outer.h;
}

/**
 * 迷宮の画面の矩形が対応する領域からはみ出すものの一覧（英語の診断文）。空なら問題なし。
 * config.ui.layout は【仮】で core は合計・view・party しか検証しないので、操作領域が CONTROLS_MIN_HEIGHT より低い、
 * メッセージが 1 行も入らないといった layout は起動を止めず、app が console.warn で知らせる。
 */
export function layoutWarnings(g: Regions, l: DungeonLayout): string[] {
  const out: string[] = [];
  const check = (name: string, r: Rect, region: keyof Regions): void => {
    if (!inside(r, g[region])) out.push(`ui.layout: ${name} does not fit in the ${region} region (height ${g[region].h})`);
  };
  check("header.settings", l.header.settings, "header");
  for (const [k, r] of Object.entries(l.dpad)) check(`dpad.${k}`, r, "controls");
  l.menu.forEach((r, i) => check(`menu[${i}]`, r, "controls"));
  l.list.forEach((r, i) => check(`list[${i}]`, r, "controls"));
  l.listNarrow.forEach((r, i) => check(`listNarrow[${i}]`, r, "controls"));
  check("listBack", l.listBack, "controls");
  check("mapClose", l.mapClose, "controls");
  check("mapGo", l.mapGo, "controls");
  l.battleParty.forEach((r, i) => check(`battleParty[${i}]`, r, "controls"));
  l.battleMember.forEach((r, i) => check(`battleMember[${i}]`, r, "controls"));
  check("autoStop", l.autoStop, "controls");
  l.campGrid.forEach((r, i) => check(`campGrid[${i}]`, r, "controls"));
  // UI-59（M10）: キャラクター画面の 27 行が入るか
  if (l.character.h < CHARACTER_MIN_HEIGHT) out.push(`ui.layout: character panel (height ${l.character.h}) is lower than ${CHARACTER_MIN_HEIGHT}`);
  if (l.message.lines < 1) out.push(`ui.layout: message region (height ${g.message.h}) has no text line`);
  l.partyRows.forEach((r, i) => check(`partyRows[${i}]`, r, "party"));
  return out;
}

/**
 * SV-23 の「保存できません」の帯（ステージ座標。押せない）。ヘッダーの直下に、高さ config.ui.saveBannerHeight【仮】で置き、
 * ヘッダーの設定ボタンを覆わない（既定の header 16・高さ 12 なら y16..27）
 */
export function saveBannerRect(g: Regions, height: number): Rect {
  return { x: 0, y: g.header.y + g.header.h, w: g.header.w, h: height };
}

// ---- タイトル（UI-50）。題字 → 一覧の行（最大 5 行が見え、それより多ければ縦スクロール）→ 案内の欄 → ボタン 4 枠

/**
 * UI-50（2026-10-06 ユーザー決定）: タイトルの絵（public/town/title.png、240×150）の矩形。ステージの上端から等倍で、
 * 題字・一覧の行の下の層に置く（どちらも隠さない。行のボタンは不透明なので行のある所では絵が隠れる）
 */
export const TITLE_PICTURE: Rect = { x: 0, y: 0, w: 240, h: 150 };

/** 題字の上端（論理 px）。中央寄せ。既定の SV-23 の帯（y16..27）の下に置く */
export const TITLE_HEADING_Y = 32;

/** 一覧の行の間隔（行の高さ 32 ＋ 間 2） */
export const TITLE_ROW_PITCH = 34;

/** 一覧の行 i（0..4）。y = 52 + 34i */
export const TITLE_ROWS: readonly Rect[] = [0, 1, 2, 3, 4].map((i): Rect => ({ x: 8, y: 52 + TITLE_ROW_PITCH * i, w: 224, h: 32 }));

/** 一覧の行を並べるスクロールの欄（TITLE_ROWS の 5 行がちょうど入る） */
export const TITLE_ROW_AREA: Rect = { x: 8, y: 52, w: 224, h: TITLE_ROW_PITCH * 4 + 32 };

/** 案内の欄（押せない）。一覧が空・行の要約・削除の確認・上限や読み込み失敗の知らせ */
export const TITLE_NOTICE: Rect = { x: 8, y: 226, w: 224, h: 22 };

/** ボタンの 4 枠（a 左上・b 右上・c 左下・d 右下）。一覧の行以外の項目をこの順に置く */
export const TITLE_BUTTONS: readonly Rect[] = [
  { x: 8, y: 256, w: 108, h: 32 },
  { x: 124, y: 256, w: 108, h: 32 },
  { x: 8, y: 296, w: 108, h: 32 },
  { x: 124, y: 296, w: 108, h: 32 },
];

/** SV-40: タイトルの下の案内（押せない。dim の 2 行）。TITLE_BUTTONS の下。standalone なら空 */
export const TITLE_HINT: Rect = { x: 8, y: 336, w: 224, h: 20 };

/** 簡易作成（UI-51）の行 i（0..5）。番号のラベル、名前の入力欄、性格のボタン */
export function creationRow(i: number): { name: Rect; personality: Rect; label: Rect } {
  const y = 34 + 34 * i;
  return {
    label: { x: 2, y, w: 8, h: 32 },
    name: { x: 12, y, w: 112, h: 32 },
    personality: { x: 128, y, w: 110, h: 32 },
  };
}

export const CREATION_BUTTONS = {
  random: { x: 8, y: 300, w: 108, h: 32 },
  start: { x: 124, y: 300, w: 108, h: 32 },
  back: { x: 8, y: 340, w: 108, h: 32 },
} as const satisfies Record<string, Rect>;

/** 作成の入力エラーの表示欄（押せない） */
export const CREATION_ERROR: Rect = { x: 4, y: 240, w: 232, h: 50 };

// ---- 自分で作る（UI-62。M5.5）。数値は【仮】。見出し → 要約 → 一覧の行（最大 7 行）か能力値の 6 行 → 残り → 誤り → ボタン 3 枠

/** 見出し（{n}人目　{段}） */
export const CUSTOM_HEADING: Rect = { x: 4, y: 4, w: 232, h: 12 };
/** 要約（決まった種族・職業・性格） */
export const CUSTOM_SUMMARY: Rect = { x: 4, y: 18, w: 232, h: 10 };

/** 一覧の行 i（0..6。2 行の行。y = 34 + 34i、7 行目は y238..269）。確認の段の 6 行もここ */
export function customRow(i: number): Rect {
  return { x: 8, y: 34 + 34 * i, w: 224, h: 32 };
}

/** 能力値の行 i（0..5。y = 34 + 34i）。名前 [-] 値 [+]（debugRow と同じ横の割り付け） */
export function customStatRow(i: number): { label: Rect; minus: Rect; value: Rect; plus: Rect } {
  const y = 34 + 34 * i;
  return {
    label: { x: 8, y, w: 124, h: 32 },
    minus: { x: 136, y, w: 32, h: 32 },
    value: { x: 170, y, w: 32, h: 32 },
    plus: { x: 204, y, w: 32, h: 32 },
  };
}

/** 能力値の段の「残り」の行（押せない） */
export const CUSTOM_REMAINING: Rect = { x: 8, y: 240, w: 224, h: 32 };
/** 名前の入力欄（見た目の大きさ。DOM は 2 倍で作って scale(0.5)） */
export const CUSTOM_NAME: Rect = { x: 8, y: 34, w: 224, h: 32 };
/** 誤りの欄（押せない） */
export const CUSTOM_ERROR: Rect = { x: 4, y: 276, w: 232, h: 20 };
/** 下のボタン a（左上）・b（右上）・c（左下 = 戻る） */
export const CUSTOM_BUTTONS = {
  a: { x: 8, y: 300, w: 108, h: 32 },
  b: { x: 124, y: 300, w: 108, h: 32 },
  c: { x: 8, y: 340, w: 108, h: 32 },
} as const satisfies Record<string, Rect>;
/**
 * 名前の段のボタン b（次へ）・c（戻る）と誤りの欄。ソフトキーボードが出ても隠れないように、入力欄（y34..66）のすぐ下に置く
 * （ステージの上 1/3 に収める。M6）
 */
export const CUSTOM_NAME_BUTTONS = {
  b: { x: 124, y: 72, w: 108, h: 32 },
  c: { x: 8, y: 72, w: 108, h: 32 },
} as const satisfies Record<string, Rect>;
export const CUSTOM_NAME_ERROR: Rect = { x: 4, y: 108, w: 232, h: 20 };

/** debug パネルの設定の行 i（0..5。y = 124 + 34i、最後の行は y294..325）。[-] 値 [+] か、toggle のどちらかを使う */
export function debugRow(i: number): { label: Rect; minus: Rect; value: Rect; plus: Rect; toggle: Rect } {
  const y = 124 + 34 * i;
  return {
    label: { x: 4, y, w: 128, h: 32 },
    minus: { x: 136, y, w: 32, h: 32 },
    value: { x: 170, y, w: 32, h: 32 },
    plus: { x: 204, y, w: 32, h: 32 },
    toggle: { x: 136, y, w: 100, h: 32 },
  };
}

/** debug パネルの最後に確定したスワイプの表示（押せない 1 行）の上端。設定の行 5 の下 */
export const DEBUG_SWIPE_Y = 328;

/** debug パネルのボタン（y342 の 56×32 を 4 つ並べる。全員HP1（UI-57）・既定に戻す・ポインタ（2 ページ目との切り替え）・閉じる） */
export const DEBUG_BUTTONS = {
  hpOne: { x: 4, y: 342, w: 56, h: 32 },
  reset: { x: 62, y: 342, w: 56, h: 32 },
  pointers: { x: 120, y: 342, w: 56, h: 32 },
  close: { x: 178, y: 342, w: 56, h: 32 },
} as const satisfies Record<string, Rect>;

/**
 * debug パネルの 1 ページ目の 2 段目（M5。開発用、UI-57）: y376 の 44×22 を SAN段↓・イベント・罠の前・階段前・ターン+ の順に 5 つ
 * （間 2 で x 4 / 50 / 96 / 142 / 188、右端 231、下端 397。M5.5 でターン+ を足して幅 56 の 4 つから詰めた）。
 * 1 段目（DEBUG_BUTTONS）の下に収めるため高さは 22 で、UI-10 の 12 論理 px 以上（Pixel 3a で 32 CSS px・88 端末 px）。
 * TOUCH_MIN_LOGICAL（30）は満たさない（開発用のボタンだけの例外。decisions）
 */
export const DEBUG_BUTTONS_M5 = {
  sanDown: { x: 4, y: 376, w: 44, h: 22 },
  warpEvent: { x: 50, y: 376, w: 44, h: 22 },
  warpTrap: { x: 96, y: 376, w: 44, h: 22 },
  warpStairs: { x: 142, y: 376, w: 44, h: 22 },
  addTurns: { x: 188, y: 376, w: 44, h: 22 },
} as const satisfies Record<string, Rect>;

/**
 * debug パネルの 1 ページ目の「SAN+10」（M7。開発用、UI-57。debug.sanOver）: 計測値（x4・y42 の 232×80、1 行 10px）の右の x188・y42 の 44×30。
 * 計測値の 0〜2 行目（scale / deviceScale / integer）は「deviceScale 1.7143」の 18 字（美咲の半角 4px で 72px）までなので重ならない。
 * 1 段目・2 段目は空きが無いため（2 段目に 6 つ並べるとターン+200 の 40px が入らない）
 */
export const DEBUG_BUTTONS_M7 = {
  sanOver: { x: 188, y: 42, w: 44, h: 30 },
} as const satisfies Record<string, Rect>;

/**
 * debug パネルの 1 ページ目の「呪い:司可」「呪い:司否」（M10。開発用、UI-57。debug.giveCursed{wearable}）: SAN+10 の下の y74 の 44×30 を x142 / x188 に 2 つ
 * （下端 104 は設定の行 0（y124）より上）。計測値の 3〜5 行目（y72..101）は最長でも「viewport    411.4286 x 845.7143」の 31 字（124px、右端 128）なので重ならない
 */
export const DEBUG_BUTTONS_M10 = {
  giveCursedWear: { x: 142, y: 74, w: 44, h: 30 },
  giveCursedOther: { x: 188, y: 74, w: 44, h: 30 },
} as const satisfies Record<string, Rect>;

/** debug パネルの 2 ページ目（UI-57 のポインタの記録）: 題 y4、行 i は y16+10i（i=0..19、最後の行は y206..215）、x4・幅 232 */
export const DEBUG_POINTER = { x: 4, w: 232, titleY: 4, rowY: 16, rowH: 10 } as const;

// ---- 設定画面（UI-57。M6）。ステージ全面の画面。数値は【仮】（decisions 2026-10-04 の settingsLayout の行）

/** UI-57: 設定画面の矩形。閉じるだけは UI-11 の固定の位置（操作領域の x178・y54 の 56×40）で、操作領域からの相対で決める */
export type SettingsLayout = {
  /** 見出し（押せない） */
  heading: Rect;
  /** i=0..3（演出スキップ・文字速度・オートの速さ・入力）。label は押せない、toggle は押せる */
  rows: readonly { label: Rect; toggle: Rect }[];
  /** UI-57（M8）: 音量の 1 行。label は押せない、music・sfx は押せる（0〜10 を巡回） */
  volume: { label: Rect; music: Rect; sfx: Rect };
  exportButton: Rect;
  importButton: Rect;
  /** 書き出し・読み込みの案内の欄（2 行。押せない） */
  notice: Rect;
  /** ホーム画面への追加の案内（SV-40。押せない）。下端は閉じるの 4 上 */
  install: Rect;
  /** 開発用（debug パネルを開く） */
  debug: Rect;
  /** UI-11 の固定の閉じる */
  close: Rect;
};

/** UI-57: 設定画面の配置。既定の regions では 閉じる 178,354（56×40）、開発用 4,354（80×40）、音量の行 y156（M8）、ホーム画面の案内 y252..349 */
export function settingsLayout(g: Regions): SettingsLayout {
  const close: Rect = { x: g.controls.x + LIST_BACK_REL.x, y: g.controls.y + LIST_BACK_REL.y, w: LIST_BACK_REL.w, h: LIST_BACK_REL.h };
  const installY = 252;
  return {
    heading: { x: 4, y: 4, w: 232, h: 12 },
    rows: [0, 1, 2, 3].map((i) => ({ label: { x: 4, y: 20 + 34 * i, w: 128, h: 32 }, toggle: { x: 136, y: 20 + 34 * i, w: 100, h: 32 } })),
    volume: { label: { x: 4, y: 156, w: 64, h: 32 }, music: { x: 72, y: 156, w: 80, h: 32 }, sfx: { x: 156, y: 156, w: 80, h: 32 } },
    exportButton: { x: 8, y: 192, w: 108, h: 32 },
    importButton: { x: 124, y: 192, w: 108, h: 32 },
    notice: { x: 4, y: 228, w: 232, h: 20 },
    install: { x: 4, y: installY, w: 232, h: close.y - 4 - installY },
    debug: { x: 4, y: close.y, w: 80, h: close.h },
    close,
  };
}

// ---- SV-42 更新の案内（新しい版の Service Worker が待機に入ったとき。全画面の最前面）

/**
 * 案内の枠・文言の欄・「閉じる」（左）・「読み込み直す」（右）。既定の SV-23 の帯（y16..27）の下、ヘッダー（設定ボタン）にかからない位置【仮】。
 * 案内の間はステージ全面を幕で覆い、下の要素は押せない（views/update-notice.ts）
 */
export const UPDATE_NOTICE = {
  box: { x: 4, y: 30, w: 232, h: 76 },
  text: { x: 8, y: 34, w: 224, h: 28 },
  close: { x: 8, y: 68, w: 80, h: 32 },
  reload: { x: 96, y: 68, w: 136, h: 32 },
} as const satisfies Record<string, Rect>;
