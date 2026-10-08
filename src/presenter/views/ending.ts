// UI-73 戦績の画面（M12。TW-34 / TW-35）。ending イベントの EndingRecord（と酒場の「戦績」の endingRecordView）で開く overlay。
// 矩形と作りは全滅の内訳（UI-56。views/wipe.ts）と同じ: layout の wipe の範囲、行の高さ 10 の縦スクロール、続きの印（UI-11）。
// - formatEndingRecord は純粋: 見出し → 潜行 → 戦闘 → 死者 → 灰 → 全滅 → 経過 → 敵の図鑑 → 品の図鑑。値は record だけ（state を引かない）。
// - 閉じる（操作領域の「閉じる」ending.dismiss・Enter / Esc / 1）は app が扱う。
// モジュールのトップレベルでは DOM に触れない。
import type { Strings } from "../../core/data/index";
import type { EndingRecord } from "../../core/types";
import type { Action } from "../input/swipe";
import type { Rect } from "../layout";
import { formatMessage } from "./message";
import { createWipeView, type WipeView } from "./wipe";

/** UI-73 の行（純粋）。1 行目は見出し（accent 色） */
export function formatEndingRecord(r: EndingRecord, strings: Strings): string[] {
  const s = (key: string, params?: Record<string, string | number>): string => formatMessage(strings[key] ?? key, params);
  return [
    s("ending.title"),
    s("ending.row.dives", { n: r.dives }),
    s("ending.row.battles", { n: r.battles }),
    s("ending.row.deaths", { n: r.deaths }),
    s("ending.row.ashes", { n: r.ashes }),
    s("ending.row.wipes", { n: r.wipes }),
    s("ending.row.turns", { n: r.turns }),
    s("ending.row.bestiary", { known: r.bestiary.known, total: r.bestiary.total }),
    s("ending.row.uniques", { known: r.uniques.known, total: r.uniques.total }),
  ];
}

/**
 * UI-33 / UI-73 戦績の画面の間のキー（純粋）。Enter / Esc / 1 は「閉じる」。
 * 下の会話の箱（3 行の箱。締めの語り）が開いていれば ↑ / ↓ で 3 行ずつ読み返す（全滅の内訳と同じ）
 */
export function endingKeyAction(a: Action, talkOpen: boolean): "close" | "scrollUp" | "scrollDown" | null {
  if (a === "back" || a === "confirm" || (typeof a === "object" && a.menu === 0)) return "close";
  if (talkOpen && a === "forward") return "scrollUp";
  if (talkOpen && a === "around") return "scrollDown";
  return null;
}

/** rect はステージ座標の overlay の範囲（layout の wipe）。部品は全滅の内訳と同じもの（class だけ替える） */
export function createEndingView(rect: Rect, strings: Strings): WipeView {
  const v = createWipeView(rect, strings);
  v.el.className = "ending-frame";
  return v;
}
