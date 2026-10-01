// UI-43 / UI-46: メッセージ窓。文字送り（setTimeout は文字送りにだけ使う）と全文の履歴。
// 純粋な部分（formatMessage / typewriterSteps / trimHistory）を export し、node 環境のテストから試せるようにする。
// モジュールのトップレベルでは DOM に触れない。
//
// 窓は ui §2 の message 領域。el は region の位置と大きさに自分で置く。内側の矩形は layout.ts の dungeonLayout
// （message.text / message.more）。既定（240×70）では、窓の左上を原点にした論理 px で:
// - 枠 1px（0..239 × 0..69）
// - 文字領域 x4..235、y2..67 の 6 行（1 行 10px、全角 29 字）。指ではスクロールしない（overflow hidden・touch-action none）。
//   DOM には直近の lines × 2 文だけを残し、いつも末尾を見せる。全文は配列に持ち、履歴の画面（UI-46）で見せる
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

/** UI-45: タップ待ちの続きの三角の点滅の 1 周期（ms。表示層のコード定数。battle.ts の FOCUS_BLINK_MS と同じ扱い） */
const MORE_BLINK_MS = 600;

export type MessageWindow = {
  el: HTMLElement;
  /** 1 文を履歴の末尾に足して表示する。instant か speed() が 0 以下なら即座に全文を出す */
  say(text: string, instant: boolean): Promise<void>;
  /** 文字送り中の文を即座に完了させる（UI-43 のタップ） */
  rush(): void;
  /** 文字送りの途中か */
  typing(): boolean;
  /** UI-46: 窓には出さず、全文の履歴にだけ 1 行足す（ダイスの要約） */
  log(text: string): void;
  /** UI-46: 全文の履歴（古い順。historyMax 件で切る） */
  history(): readonly string[];
  /**
   * UI-45: ms 待つ（オートの拍の待ち）。窓の中の不可視の 1×1 の要素の animate(opacity 1→1).finished で測り、
   * setTimeout は使わない。ms が 0 以下なら即座に解決する。cancel されても先へ進む
   */
  waitMs(ms: number): Promise<void>;
  /** 履歴をすべて消す。文字送り中なら完了扱いで解決する */
  clear(): void;
  /** 続きの三角の表示。blink なら点滅させる（UI-45 のタップ待ち。演出スキップでは点滅しない） */
  setMore(on: boolean, blink?: boolean): void;
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

  // 直近の文（指ではスクロールしない。末尾を見せる）
  const history = document.createElement("div");
  history.className = "message-history";
  Object.assign(history.style, {
    position: "absolute",
    left: `${t.x - r.x - BORDER}px`, // 既定 3（枠 1px の内側から数えて x4）
    top: `${t.y - r.y - BORDER}px`, // 既定 1（y2）
    width: `${t.w}px`,
    height: `${t.h}px`,
    overflow: "hidden",
    touchAction: "none",
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

  // UI-45 の待ちを測る不可視の要素
  const clock = document.createElement("div");
  Object.assign(clock.style, { position: "absolute", left: "0px", top: "0px", width: "1px", height: "1px", opacity: "0", pointerEvents: "none" });
  el.appendChild(clock);

  /** 進行中の文字送り。rush / clear で即座に完了させる */
  let current: { finish(): void } | null = null;
  /** UI-46: 全文の履歴 */
  let all: string[] = [];
  const remember = (text: string): void => {
    all.push(text);
    if (all.length > o.historyMax) all = trimHistory(all, o.historyMax);
  };
  /** 続きの三角の点滅 */
  let moreBlink: Animation | null = null;

  const scrollToEnd = (): void => {
    history.scrollTop = history.scrollHeight;
  };

  /** 窓の DOM に残す文の数（文字領域の行数の 2 倍。1 文が 2 行以上に折り返しても窓が埋まる） */
  const domMax = Math.max(1, o.layout.lines * 2);
  const trimDom = (): void => {
    const excess = history.childElementCount - domMax;
    for (let i = 0; i < excess; i++) history.firstElementChild?.remove();
  };

  const say = (text: string, instant: boolean): Promise<void> => {
    // 前の文が送り途中なら完了させてから次へ
    current?.finish();
    remember(text);
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
    typing(): boolean {
      return current !== null;
    },
    log(text: string): void {
      remember(text);
    },
    history(): readonly string[] {
      return all.slice();
    },
    async waitMs(ms: number): Promise<void> {
      if (!(ms > 0)) return;
      try {
        await clock.animate([{ opacity: 0 }, { opacity: 0 }], { duration: ms }).finished;
      } catch {
        // cancel。そのまま先へ進む
      }
    },
    clear(): void {
      current?.finish();
      history.replaceChildren();
      all = [];
    },
    setMore(on: boolean, blink = false): void {
      more.style.visibility = on ? "visible" : "hidden";
      moreBlink?.cancel();
      moreBlink = null;
      if (on && blink) {
        moreBlink = more.animate(
          [
            { opacity: 1, offset: 0 },
            { opacity: 1, offset: 0.5 },
            { opacity: 0, offset: 0.5 },
            { opacity: 0, offset: 1 },
          ],
          { duration: MORE_BLINK_MS, iterations: Infinity },
        );
      }
    },
  };
}
