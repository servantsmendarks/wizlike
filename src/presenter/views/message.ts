// UI-43 / UI-11: メッセージ窓。文字送り（setTimeout は文字送りにだけ使う）と履歴。
// 純粋な部分（formatMessage / typewriterSteps / trimHistory）を export し、node 環境のテストから試せるようにする。
// モジュールのトップレベルでは DOM に触れない。
//
// 窓は ui §2 の message 領域。el は region の位置と大きさに自分で置く。内側の矩形は layout.ts の dungeonLayout
// （message.text / message.more）。既定（240×70）では、窓の左上を原点にした論理 px で:
// - 枠 1px（0..239 × 0..69）
// - 文字領域 x4..235、y2..67 の 6 行（1 行 10px、全角 29 字）。履歴はこの中で縦スクロール（UI-11）
// - 続きの三角 x228..235、y60..67
import type { DungeonLayout, Rect } from "../layout";

/** {k} を params[k] で置き換える。params に無いものは {k} のまま残す */
export function formatMessage(tpl: string, params?: Record<string, string | number>): string {
  if (params === undefined) return tpl;
  return tpl.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (whole, name: string) => {
    const v = Object.prototype.hasOwnProperty.call(params, name) ? params[name] : undefined;
    return v === undefined ? whole : String(v);
  });
}

/** 文字送りの各段の表示文字列。コードポイント単位で累積する（サロゲートペアを分けない）。"" は [""] */
export function typewriterSteps(text: string): string[] {
  const chars = Array.from(text);
  if (chars.length === 0) return [""];
  const out: string[] = [];
  let acc = "";
  for (const c of chars) {
    acc += c;
    out.push(acc);
  }
  return out;
}

/** 末尾の max 件を残す（max が 0 以下なら空） */
export function trimHistory<T>(items: readonly T[], max: number): T[] {
  if (max <= 0) return [];
  return items.length > max ? items.slice(items.length - max) : items.slice();
}

export type MessageWindow = {
  el: HTMLElement;
  /** 1 文を履歴の末尾に足して表示する。instant か speed() が 0 以下なら即座に全文を出す */
  say(text: string, instant: boolean): Promise<void>;
  /** 文字送り中の文を即座に完了させる（UI-43 のタップ） */
  rush(): void;
  /** 履歴をすべて消す。文字送り中なら完了扱いで解決する */
  clear(): void;
  /** 続きの三角の表示 */
  setMore(on: boolean): void;
};

export function createMessageWindow(o: {
  speed(): number;
  historyMax: number;
  /** ui §2 の message 領域（ステージ座標） */
  region: Rect;
  layout: DungeonLayout["message"];
}): MessageWindow {
  const r = o.region;
  const t = o.layout.text;
  const mr = o.layout.more;
  // 子の left / top は枠 1px の内側が原点
  const BORDER = 1;
  const el = document.createElement("div");
  el.className = "message-window";
  Object.assign(el.style, {
    position: "absolute",
    left: `${r.x}px`,
    top: `${r.y}px`,
    width: `${r.w}px`,
    height: `${r.h}px`,
    border: "1px solid var(--c-frame)",
    background: "var(--c-bg)",
    color: "var(--c-text)",
  });

  // 履歴（スクロール容器）。この div 自身がスクロールするので body の touch-action:none の影響を受けない
  const history = document.createElement("div");
  history.className = "message-history";
  Object.assign(history.style, {
    position: "absolute",
    left: `${t.x - r.x - BORDER}px`, // 既定 3（枠 1px の内側から数えて x4）
    top: `${t.y - r.y - BORDER}px`, // 既定 1（y2）
    width: `${t.w}px`,
    height: `${t.h}px`,
    overflowY: "auto",
    overflowX: "hidden",
    touchAction: "pan-y",
    wordBreak: "break-all",
    lineBreak: "anywhere",
    whiteSpace: "pre-wrap",
    userSelect: "none",
  });
  el.appendChild(history);

  const SVG_NS = "http://www.w3.org/2000/svg";
  const more = document.createElementNS(SVG_NS, "svg");
  more.setAttribute("width", String(mr.w));
  more.setAttribute("height", String(mr.h));
  more.setAttribute("viewBox", "0 0 8 8");
  more.setAttribute("shape-rendering", "crispEdges");
  Object.assign(more.style, {
    position: "absolute",
    left: `${mr.x - r.x - BORDER}px`, // 既定 227
    top: `${mr.y - r.y - BORDER}px`, // 既定 59
    visibility: "hidden",
  });
  const tri = document.createElementNS(SVG_NS, "path");
  tri.setAttribute("d", "M0 1 H8 L4 7 Z");
  tri.setAttribute("fill", "var(--c-text)");
  more.appendChild(tri);
  el.appendChild(more);

  /** 進行中の文字送り。rush / clear で即座に完了させる */
  let current: { finish(): void } | null = null;

  const scrollToEnd = (): void => {
    history.scrollTop = history.scrollHeight;
  };

  const trimDom = (): void => {
    const excess = history.childElementCount - Math.max(0, o.historyMax);
    for (let i = 0; i < excess; i++) history.firstElementChild?.remove();
  };

  const say = (text: string, instant: boolean): Promise<void> => {
    // 前の文が送り途中なら完了させてから次へ
    current?.finish();
    const line = document.createElement("div");
    line.className = "message-line";
    history.appendChild(line);
    trimDom();

    const speed = o.speed();
    if (instant || !(speed > 0)) {
      line.textContent = text;
      scrollToEnd();
      return Promise.resolve();
    }

    const steps = typewriterSteps(text);
    return new Promise<void>((resolve) => {
      let i = 0;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const job = {
        finish(): void {
          if (timer !== null) clearTimeout(timer);
          timer = null;
          line.textContent = text;
          scrollToEnd();
          if (current === job) current = null;
          resolve();
        },
      };
      const tick = (): void => {
        line.textContent = steps[i] ?? text;
        scrollToEnd();
        i++;
        if (i >= steps.length) {
          job.finish();
          return;
        }
        timer = setTimeout(tick, speed);
      };
      current = job;
      tick();
    });
  };

  return {
    el,
    say,
    rush(): void {
      current?.finish();
    },
    clear(): void {
      current?.finish();
      history.replaceChildren();
    },
    setMore(on: boolean): void {
      more.style.visibility = on ? "visible" : "hidden";
    },
  };
}
