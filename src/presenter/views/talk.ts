// UI-47（M8.5）: 街の会話の箱。施設の絵の下端に重なる 3 行の文字ボックス（矩形は layout.ts の townLayout の talk）。
// - 語り（say）は呼ばれた時点で 1 回だけ全文の履歴（UI-46。log）に入れ、表示は 1 文ずつ。
// - 文が出たまま次の文が来たら、▼ を点滅させて（演出スキップでは点滅しない）タップを待ち、タップの後に次の文を文字送りする。
//   say の Promise はその文の文字送りが終わったら解決する（再生の中では playback の message ハンドラがこれを待つ）。
// - タップ（tap）: 文字送り中なら即表示、待っていれば次の文へ、最後の文が出ているなら箱を閉じる（言い終わったら消える）。
//   rush は tap から「閉じる」を除いたもの（再生中のステージのタップ。playback の Player.tap → message.rush）。
// - hold（UI-47 / UI-66。2026-10-06）: 出ている文のタップまで、playback の次の出来事（とその音）を待たせる。
//   解けたら箱を閉じ、次の say はタップなしで出る（「タップで次」の 1 回のタップで、次の出来事と次の文が出る）。
// - 演出スキップ（UI-41 / CLAUDE.md §3-9）が省くのは文字送り（say の instant）と ▼ の点滅だけで、タップ待ちは省かない。
// - flush は待っている文をすべて解決して箱を閉じる（ログには入っている）。clear は flush に加えて外からの ▼ を下ろす（再開 SV-50）。
// - replay はログに入れずに出す（迷宮から持ち越した語り。playback の townCarry）。
// 純粋なモデル（createTalkModel。キュー・表示中・文字送り中・タップ待ち）と、薄い DOM の層（createTalkBox）に分ける。
// 文字送りの setTimeout は DOM の層だけが使う（CLAUDE.md §2 の文字送りの例外）。モジュールのトップレベルでは DOM に触れない。
import type { TownLayout } from "../layout";
import { typewriterSteps } from "./message";
import { WRAP_STYLE } from "./wrap";

/** 表示の先（DOM の層。テストでは記録するだけの偽物） */
export type TalkSink = {
  /** 箱の表示 */
  open(on: boolean): void;
  /** 箱に出す文（文字送りの途中の段も） */
  text(s: string): void;
  /** ▼ の表示。blink なら点滅 */
  more(on: boolean, blink: boolean): void;
};

export type TalkModelDeps = {
  sink: TalkSink;
  /** UI-66（2026-10-06）: tap で次の文へ進んだ・箱を閉じたとき（送りの音）。文字送りの即表示では呼ばない */
  advanced?(): void;
  /** UI-46: 全文の履歴に 1 行足す（メッセージ窓と同じ 1 本の配列） */
  log(text: string): void;
  /** 文字送りの 1 文字あたりの ms（settings.textSpeed）。0 以下なら即時 */
  speed(): number;
  /** タップ待ちの ▼ を点滅させるか（演出スキップでは偽） */
  blink(): boolean;
  /** ms 後に fn を呼ぶ。返り値で取り消す（DOM の層は setTimeout） */
  schedule(fn: () => void, ms: number): () => void;
};

export type TalkModel = {
  /** 1 文を語る。呼んだ時点でログに入れる。instant か speed() が 0 以下なら文字送りしない */
  say(text: string, instant: boolean): Promise<void>;
  /** ログに入れずに語る（迷宮から持ち越した語り）。最後の文の文字送りが終わったら解決する */
  replay(texts: readonly string[], instant: boolean): Promise<void>;
  /** 文字送り中なら即表示、タップ待ちなら次の文へ（閉じない） */
  rush(): void;
  /** rush に加えて、最後の文が出ているなら箱を閉じる */
  tap(): void;
  /** 文字送りの途中か */
  typing(): boolean;
  /** 箱が開いているか */
  isOpen(): boolean;
  /** 外からの ▼（playback の続きの三角と、判定の箱の待ち）。文字送りの間は出さない */
  setMore(on: boolean, blink?: boolean): void;
  /**
   * UI-47 / UI-66（2026-10-06）: 出ている文を読み終える（タップする）まで待つ。playback が、語った文の後の
   * 次の出来事（dice を除く）の再生と音の前に呼ぶ。文が出ていない（閉じている・文字送り中・次の文が待っている）なら
   * すぐ解決する。待つ間は ▼ を出し（点滅は blink()）、tap か rush で解いて箱を閉じる（次の say はタップなしで出る）
   */
  hold(): Promise<void>;
  /** 待っている文をすべて解決して箱を閉じる */
  flush(): void;
  /** flush に加えて外からの ▼ を下ろす */
  clear(): void;
};

type Item = { text: string; instant: boolean; resolve: () => void };

export function createTalkModel(d: TalkModelDeps): TalkModel {
  const queue: Item[] = [];
  /** 出ている文（null なら箱は閉じている） */
  let shown: string | null = null;
  /** 文字送り中の文（終えると解決する） */
  let job: { item: Item; cancel: () => void } | null = null;
  /** 出ている文の後に次の文が来て、タップを待っている */
  let waiting = false;
  /** 外からの ▼ */
  let ext: { blink: boolean } | null = null;
  /** hold の待ち（出ている文のタップを待っている） */
  let held: (() => void) | null = null;

  const refreshMore = (): void => {
    if (waiting || held !== null) {
      d.sink.more(true, d.blink());
      return;
    }
    if (ext !== null && job === null && shown !== null) {
      d.sink.more(true, ext.blink);
      return;
    }
    d.sink.more(false, false);
  };

  const finish = (): void => {
    const j = job;
    if (j === null) return;
    j.cancel();
    job = null;
    d.sink.text(j.item.text);
    j.item.resolve();
    pump();
  };

  const start = (): void => {
    const item = queue.shift();
    if (item === undefined) return;
    waiting = false;
    shown = item.text;
    d.sink.open(true);
    const speed = d.speed();
    if (item.instant || !(speed > 0)) {
      d.sink.text(item.text);
      refreshMore();
      item.resolve();
      pump();
      return;
    }
    const steps = typewriterSteps(item.text);
    let i = 0;
    let cancelTimer: () => void = () => {};
    const tick = (): void => {
      d.sink.text(steps[i] ?? item.text);
      i++;
      if (i >= steps.length) {
        finish();
        return;
      }
      cancelTimer = d.schedule(tick, speed);
    };
    job = { item, cancel: () => cancelTimer() };
    refreshMore();
    tick();
  };

  /** 次の文へ進めるなら進める（出ている文があればタップを待つ） */
  const pump = (): void => {
    if (job !== null || waiting) return;
    if (queue.length === 0) {
      refreshMore();
      return;
    }
    if (shown !== null) {
      waiting = true;
      refreshMore();
      return;
    }
    start();
  };

  const enqueue = (text: string, instant: boolean): Promise<void> =>
    new Promise<void>((resolve) => {
      queue.push({ text, instant, resolve });
      pump();
    });

  const close = (): void => {
    shown = null;
    d.sink.text("");
    d.sink.open(false);
    refreshMore();
  };

  /** hold を解いて箱を閉じ、待っている文があれば出す */
  const release = (): void => {
    const r = held;
    held = null;
    close();
    r?.();
    pump();
  };

  const rush = (): boolean => {
    if (held !== null) {
      release();
      return true;
    }
    if (job !== null) {
      finish();
      return true;
    }
    if (waiting) {
      start();
      return true;
    }
    return false;
  };

  const flush = (): void => {
    const j = job;
    job = null;
    j?.cancel();
    j?.item.resolve();
    waiting = false;
    for (const it of queue.splice(0)) it.resolve();
    const h = held;
    held = null;
    close();
    h?.();
  };

  return {
    say(text: string, instant: boolean): Promise<void> {
      d.log(text);
      return enqueue(text, instant);
    },
    replay(texts: readonly string[], instant: boolean): Promise<void> {
      return Promise.all(texts.map((x) => enqueue(x, instant))).then(() => undefined);
    },
    rush(): void {
      rush();
    },
    tap(): void {
      if (held !== null) {
        d.advanced?.();
        release();
        return;
      }
      if (job !== null) {
        finish();
        return;
      }
      if (waiting) {
        d.advanced?.();
        start();
        return;
      }
      if (shown !== null) {
        d.advanced?.();
        close();
      }
    },
    typing(): boolean {
      return job !== null;
    },
    isOpen(): boolean {
      return shown !== null;
    },
    setMore(on: boolean, blink = false): void {
      ext = on ? { blink } : null;
      refreshMore();
    },
    hold(): Promise<void> {
      if (shown === null || job !== null || waiting || queue.length > 0 || held !== null) return Promise.resolve();
      return new Promise<void>((resolve) => {
        held = resolve;
        refreshMore();
      });
    },
    flush,
    clear(): void {
      ext = null;
      flush();
    },
  };
}

/** UI-45 / UI-47: ▼ の点滅の 1 周期（ms。message.ts の MORE_BLINK_MS と同じ） */
const MORE_BLINK_MS = 600;

export type TalkBox = TalkModel & { el: HTMLElement };

/** UI-47: 会話の箱の DOM。layout は townLayout の talk（ステージ座標）。log はメッセージ窓の log（同じ 1 本の履歴） */
export function createTalkBox(o: {
  layout: TownLayout["talk"];
  speed(): number;
  blink(): boolean;
  log(text: string): void;
  /** UI-66: 送りの音（TalkModelDeps の advanced） */
  advanced?(): void;
}): TalkBox {
  const r = o.layout.box;
  const t = o.layout.text;
  const mr = o.layout.more;
  // 子の left / top は枠 1px の内側が原点
  const BORDER = 1;
  const el = document.createElement("div");
  el.className = "talk-box";
  Object.assign(el.style, {
    position: "absolute",
    left: `${r.x}px`,
    top: `${r.y}px`,
    width: `${r.w}px`,
    height: `${r.h}px`,
    border: "1px solid var(--c-frame)",
    background: "var(--c-bg)",
    color: "var(--c-text)",
    display: "none",
  });

  // 文字領域（3 行）。下詰めで、3 行を超える文は最新の 3 行を見せる（全文はログ）
  const body = document.createElement("div");
  body.className = "talk-text";
  Object.assign(body.style, {
    position: "absolute",
    left: `${t.x - r.x - BORDER}px`,
    top: `${t.y - r.y - BORDER}px`,
    width: `${t.w}px`,
    height: `${t.h}px`,
    overflow: "hidden",
    touchAction: "none",
    ...WRAP_STYLE,
    userSelect: "none",
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-end",
  });
  const line = document.createElement("div");
  line.className = "talk-line";
  line.style.flexShrink = "0";
  body.appendChild(line);
  el.appendChild(body);

  const SVG_NS = "http://www.w3.org/2000/svg";
  const more = document.createElementNS(SVG_NS, "svg");
  more.setAttribute("width", String(mr.w));
  more.setAttribute("height", String(mr.h));
  more.setAttribute("viewBox", "0 0 8 8");
  more.setAttribute("shape-rendering", "crispEdges");
  Object.assign(more.style, {
    position: "absolute",
    left: `${mr.x - r.x - BORDER}px`,
    top: `${mr.y - r.y - BORDER}px`,
    visibility: "hidden",
  });
  const tri = document.createElementNS(SVG_NS, "path");
  tri.setAttribute("d", "M0 1 H8 L4 7 Z");
  tri.setAttribute("fill", "var(--c-text)");
  more.appendChild(tri);
  el.appendChild(more);

  let moreBlink: Animation | null = null;
  const model = createTalkModel({
    ...(o.advanced !== undefined ? { advanced: o.advanced } : {}),
    log: o.log,
    speed: o.speed,
    blink: o.blink,
    schedule: (fn, ms) => {
      const id = setTimeout(fn, ms);
      return () => clearTimeout(id);
    },
    sink: {
      open(on: boolean): void {
        el.style.display = on ? "" : "none";
      },
      text(s: string): void {
        line.textContent = s;
      },
      more(on: boolean, blink: boolean): void {
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
    },
  });
  return { ...model, el };
}

/** UI-47: 語りの表示先。route が街なら会話の箱、それ以外はメッセージ窓。ログはどちらもメッセージ窓の 1 本の配列 */
export type Narration = {
  say(text: string, instant: boolean): Promise<void>;
  setMore(on: boolean, blink?: boolean): void;
  rush(): void;
  typing(): boolean;
  log(text: string): void;
  waitMs(ms: number): Promise<void>;
  /** UI-47 / UI-66（2026-10-06）: 語った文の後の出来事の前の待ち（TalkModel.hold）。メッセージ窓には無い（待たない） */
  hold?(): Promise<void>;
};

export function createNarrator(o: {
  /** 今の route が街か */
  town(): boolean;
  talk: Pick<TalkModel, "say" | "setMore" | "rush" | "typing"> & Partial<Pick<TalkModel, "hold">>;
  window: Narration;
}): Narration {
  const to = (): Pick<Narration, "say" | "setMore" | "rush" | "typing"> => (o.town() ? o.talk : o.window);
  return {
    say: (text, instant) => to().say(text, instant),
    setMore(on: boolean, blink?: boolean): void {
      if (!on) {
        // 下ろすのは両方（再生の途中で街と迷宮を行き来しても残さない）
        o.talk.setMore(false);
        o.window.setMore(false);
        return;
      }
      to().setMore(on, blink);
    },
    rush: () => to().rush(),
    typing: () => to().typing(),
    log: (text) => o.window.log(text),
    waitMs: (ms) => o.window.waitMs(ms),
    // 街なら会話の箱の hold。メッセージ窓（迷宮・戦闘）は待たない（拍の待ちは playback の beat が受け持つ）
    hold: () => (o.town() ? (o.talk.hold?.() ?? Promise.resolve()) : Promise.resolve()),
  };
}
