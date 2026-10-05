// UI-46: 履歴の画面。ビューとメッセージの範囲（layout.history、既定 y16..235）を覆う overlay。
// 題の行（strings history.title）と、全文を古い順に並べた縦スクロールの一覧（touch-action: pan-y は style.css。UI-37）。
// 開いたら末尾を見せる。キーの ↑↓ は scrollBy で 3 行ずつ動かす（呼び出し側が決める）。操作領域には「閉じる」だけを置く（app）。
// モジュールのトップレベルでは DOM に触れない。
import type { Rect } from "../layout";
import { WRAP_STYLE } from "./wrap";

/** 1 行の高さ（論理 px。UI-03 の行間） */
export const HISTORY_LINE_H = 10;
/** 題と一覧の左右の余白 */
const PAD = 4;

export type HistoryView = {
  el: HTMLElement;
  /** 全文（古い順）と題を描き、末尾を見せる。el を表示してから呼ぶ（display:none の間は scrollTop が効かない） */
  render(lines: readonly string[], title: string): void;
  /** 一覧を lines 行ぶん動かす（負で上へ） */
  scrollBy(lines: number): void;
};

export function createHistoryView(r: { overlay: Rect; title: Rect; list: Rect }): HistoryView {
  const o = r.overlay;
  const el = document.createElement("div");
  el.className = "history-view";
  Object.assign(el.style, {
    position: "absolute",
    left: `${o.x}px`,
    top: `${o.y}px`,
    width: `${o.w}px`,
    height: `${o.h}px`,
    background: "var(--c-bg)",
    color: "var(--c-text)",
    border: "1px solid var(--c-frame)",
  });

  const title = document.createElement("div");
  title.className = "history-title";
  Object.assign(title.style, {
    position: "absolute",
    left: `${r.title.x - o.x + PAD - 1}px`,
    top: `${r.title.y - o.y}px`,
    width: `${r.title.w - 2 * PAD}px`,
    height: `${r.title.h}px`,
    lineHeight: `${r.title.h}px`,
    whiteSpace: "nowrap",
    overflow: "hidden",
    color: "var(--c-accent)",
  });

  // 見える高さを行の高さの整数倍にし、余りは上（題との間）の余白にする。末尾まで送ったときに最上段の行が途中で切れない
  // （既定: 一覧の領域 208 から枠の 2 を引いた 206 のうち、下詰めの 200 = 20 行を見せ、上に 6 の余白）
  const listSpace = r.list.h - 2;
  const listH = Math.max(0, Math.floor(listSpace / HISTORY_LINE_H) * HISTORY_LINE_H);
  const list = document.createElement("div");
  list.className = "history-list";
  Object.assign(list.style, {
    position: "absolute",
    left: `${r.list.x - o.x + PAD - 1}px`,
    top: `${r.list.y - o.y + (listSpace - listH)}px`,
    width: `${r.list.w - 2 * PAD}px`,
    height: `${listH}px`,
    overflowY: "auto",
    overflowX: "hidden",
    // UI-43 / UI-46: 禁則（。、」）などを行頭に置かない。wrap.ts）
    ...WRAP_STYLE,
  });
  el.append(title, list);

  return {
    el,
    render(lines, text): void {
      title.textContent = text;
      list.replaceChildren(
        ...lines.map((s) => {
          const d = document.createElement("div");
          d.className = "history-line";
          d.style.lineHeight = `${HISTORY_LINE_H}px`;
          d.textContent = s;
          return d;
        }),
      );
      list.scrollTop = list.scrollHeight;
    },
    scrollBy(n: number): void {
      list.scrollTop += n * HISTORY_LINE_H;
    },
  };
}
