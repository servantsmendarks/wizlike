// UI-11 / UI-46 / UI-47（M10.5 追補。2026-10-07 ユーザーの指示「下、上に続きがある旨を示してください。（他のスワイプできるウィンドウにも同様の仕組みを入れてほしいです）」。未定-24）:
// 指でスクロールする窓の「続きの印」。上に隠れた行があれば上端の印（strings の scroll.up）、下に隠れた行があれば下端の印（scroll.down）を出し、
// 端までスクロールしたらその側の印を消す。印は点滅させない（会話の箱の点滅する ▼ はタップ待ちで、別のもの）。色は accent。押せない。
// 純粋な判定（scrollMarkState）と、薄い DOM の層（attachScrollMarks）に分ける。印は窓（scroller）の外の親（host）に置く
// （窓の中に置くと一緒にスクロールして見えなくなるため）。窓の scroll で描き直し、中身を替えたときは呼び出し側が refresh する。
// モジュールのトップレベルでは DOM に触れない。
import type { Strings } from "../../core/data/index";

/** 印の大きさ（論理 px。8px の字 1 字） */
export const SCROLL_MARK_SIZE = 8;
/** 端の判定の許容（px）。ステージの scale で scrollTop に端数が出ても端とみなす */
const EDGE_SLACK = 1;

/** 窓のスクロールの寸法（DOM の scrollTop / scrollHeight / clientHeight） */
export type ScrollMetrics = { scrollTop: number; scrollHeight: number; clientHeight: number };

/** UI-11（純粋）: 上・下に続きがあるか。中身が窓に収まる（または窓が隠れていて寸法が 0）なら両方とも偽 */
export function scrollMarkState(m: ScrollMetrics): { up: boolean; down: boolean } {
  const top = Number.isFinite(m.scrollTop) ? m.scrollTop : 0;
  const client = Number.isFinite(m.clientHeight) ? m.clientHeight : 0;
  const over = (Number.isFinite(m.scrollHeight) ? m.scrollHeight : 0) - client;
  // 見える高さが 0（窓かその親が display:none）なら印も出さない
  if (!(client > 0) || !(over > EDGE_SLACK)) return { up: false, down: false };
  return { up: top > EDGE_SLACK, down: top < over - EDGE_SLACK };
}

/** UI-11（純粋）: 窓が下端にあるか（会話の箱が最新の行に追従するかの判断） */
export function scrolledToEnd(m: ScrollMetrics): boolean {
  return !scrollMarkState(m).down;
}

/** 印の左上（host の座標。host の枠の内側が原点） */
export type ScrollMarkPos = { up: { x: number; y: number }; down: { x: number; y: number } };

/** UI-11（純粋）: 窓の矩形 r の左の 8px の列に置く印の位置（一覧。上端の行の左と下端の行の左）。座標は r と同じ系 */
export function marksLeftOf(r: { x: number; y: number; h: number }): ScrollMarkPos {
  return { up: { x: r.x - SCROLL_MARK_SIZE, y: r.y }, down: { x: r.x - SCROLL_MARK_SIZE, y: r.y + r.h - SCROLL_MARK_SIZE } };
}

/** UI-11（純粋）: x の列に、窓の矩形 r の上端と下端に揃えて置く印の位置（会話の箱・履歴・全滅の内訳。右の余白の列） */
export function marksAt(x: number, r: { y: number; h: number }): ScrollMarkPos {
  return { up: { x, y: r.y }, down: { x, y: r.y + r.h - SCROLL_MARK_SIZE } };
}

export type ScrollMarks = {
  /** 窓の寸法から印を出し直す（中身を替えた・窓を出し入れした後に呼ぶ） */
  refresh(): void;
  /** 印の位置を替える（窓の矩形が変わったとき） */
  place(pos: ScrollMarkPos): void;
  /** 印の要素（テスト用） */
  up: HTMLElement;
  down: HTMLElement;
};

type Scroller = HTMLElement & Partial<ScrollMetrics>;

/**
 * UI-11: scroller（縦スクロールの窓）の続きの印を host に足す。strings の scroll.up / scroll.down が印の字。
 * onScroll は scroll のたびに印を出し直した後で呼ぶ（会話の箱の追従の判断）
 */
export function attachScrollMarks(o: { scroller: HTMLElement; host: HTMLElement; strings: Strings; pos: ScrollMarkPos; onScroll?(): void }): ScrollMarks {
  const make = (key: string, cls: string): HTMLElement => {
    const m = document.createElement("div");
    m.className = `scroll-mark ${cls}`;
    Object.assign(m.style, {
      position: "absolute",
      width: `${SCROLL_MARK_SIZE}px`,
      height: `${SCROLL_MARK_SIZE}px`,
      lineHeight: `${SCROLL_MARK_SIZE}px`,
      overflow: "hidden",
      whiteSpace: "nowrap",
      color: "var(--c-accent)",
      pointerEvents: "none",
      visibility: "hidden",
    });
    m.textContent = o.strings[key] ?? key;
    o.host.appendChild(m);
    return m;
  };
  const up = make("scroll.up", "scroll-mark-up");
  const down = make("scroll.down", "scroll-mark-down");
  const place = (p: ScrollMarkPos): void => {
    Object.assign(up.style, { left: `${p.up.x}px`, top: `${p.up.y}px` });
    Object.assign(down.style, { left: `${p.down.x}px`, top: `${p.down.y}px` });
  };
  place(o.pos);
  const s = o.scroller as Scroller;
  const refresh = (): void => {
    const st = scrollMarkState({ scrollTop: s.scrollTop ?? 0, scrollHeight: s.scrollHeight ?? 0, clientHeight: s.clientHeight ?? 0 });
    up.style.visibility = st.up ? "visible" : "hidden";
    down.style.visibility = st.down ? "visible" : "hidden";
  };
  if (typeof s.addEventListener === "function")
    s.addEventListener(
      "scroll",
      () => {
        refresh();
        o.onScroll?.();
      },
      { passive: true },
    );
  // 窓の出し入れ（display）や大きさの変化でも出し直す（ResizeObserver の無い環境では呼び出し側の refresh だけ）
  const RO = (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
  if (RO !== undefined) new RO(() => refresh()).observe(o.scroller);
  refresh();
  return { refresh, place, up, down };
}
