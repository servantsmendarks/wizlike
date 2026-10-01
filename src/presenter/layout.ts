// ui.md §2 の縦の区切りと、各画面のボタンの矩形（論理 px）。純粋なデータと関数だけ。
// 矩形は { x, y, w, h } で、占める画素は x..x+w-1、y..y+h-1（閉区間）。
// UI-10: 押せるものは一辺 TOUCH_MIN_LOGICAL 以上（scale 4/3 以上で 40 CSS px）。例外は TOUCH_EXCEPTIONS。
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

/** ヘッダーの設定ボタン。ヘッダーの高さ 16 が上限なので UI-10 の例外（F2 でも開ける） */
export const HEADER_SETTINGS: Rect = { x: 200, y: 0, w: 40, h: 16 };
/** UI-10 の最小寸法を満たさなくてよい矩形の名前 */
export const TOUCH_EXCEPTIONS: readonly string[] = ["HEADER_SETTINGS"];

/** 迷宮の十字ボタン（UI-32） */
export const DPAD = {
  forward: { x: 40, y: 300, w: 32, h: 32 },
  left: { x: 6, y: 333, w: 32, h: 32 },
  right: { x: 74, y: 333, w: 32, h: 32 },
  around: { x: 40, y: 366, w: 32, h: 32 },
} as const satisfies Record<string, Rect>;

/** 迷宮のメニュー（UI-53）。M2 は [0] に「地図」だけ */
export const MENU_SLOTS: readonly Rect[] = [
  { x: 124, y: 300, w: 56, h: 32 },
  { x: 182, y: 300, w: 56, h: 32 },
  { x: 124, y: 333, w: 56, h: 32 },
  { x: 182, y: 333, w: 56, h: 32 },
];

/** 街のメニューと選択肢の行。4 件以上は縦スクロール（UI-11） */
export const LIST_ROWS: readonly Rect[] = [
  { x: 8, y: 302, w: 224, h: 32 },
  { x: 8, y: 334, w: 224, h: 32 },
  { x: 8, y: 366, w: 224, h: 32 },
];

/** タイトル（UI-50 の M2 版） */
export const TITLE_BUTTONS = {
  newGame: { x: 60, y: 240, w: 120, h: 32 },
  settings: { x: 60, y: 280, w: 120, h: 32 },
} as const satisfies Record<string, Rect>;

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

/** debug パネルの設定の行 i（0..4）。[-] 値 [+] か、toggle のどちらかを使う */
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

export const DEBUG_BUTTONS = {
  reset: { x: 8, y: 362, w: 108, h: 32 },
  close: { x: 124, y: 362, w: 108, h: 32 },
} as const satisfies Record<string, Rect>;

/** 地図の overlay を閉じるボタン（UI-24） */
export const MAP_CLOSE: Rect = { x: 60, y: 334, w: 120, h: 32 };
