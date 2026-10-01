// UI-46: 履歴の画面。ビューとメッセージの範囲（layout.history、既定 y16..235）を覆う overlay。
// 題の行（strings history.title）と、全文を古い順に並べた縦スクロールの一覧（touch-action: pan-y は style.css。UI-37）。
// 開いたら末尾を見せる。キーの ↑↓ は scrollBy で 3 行ずつ動かす（呼び出し側が決める）。操作領域には「閉じる」だけを置く（app）。
// モジュールのトップレベルでは DOM に触れない。
import type { Rect } from "../layout";

/** 1 行の高さ（論理 px。UI-03 の行間） */
const LINE_H = 10;
/** 題と一覧の左右の余白 */
const PAD = 4;

export type HistoryView = {
  el: HTMLElement;
  /** 全文（古い順）と題を描き、末尾を見せる */
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

  const list = document.createElement("div");
  list.className = "history-list";
  Object.assign(list.style, {
    position: "absolute",
    left: `${r.list.x - o.x + PAD - 1}px`,
    top: `${r.list.y - o.y}px`,
    width: `${r.list.w - 2 * PAD}px`,
    height: `${r.list.h - 2}px`,
    overflowY: "auto",
    overflowX: "hidden",
    wordBreak: "break-all",
    lineBreak: "anywhere",
    whiteSpace: "pre-wrap",
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
          d.style.lineHeight = `${LINE_H}px`;
          d.textContent = s;
          return d;
        }),
      );
      list.scrollTop = list.scrollHeight;
    },
    scrollBy(n: number): void {
      list.scrollTop += n * LINE_H;
    },
  };
}
