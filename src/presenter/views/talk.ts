// UI-47（M8.5。M10.5 で広げて溜める形に）: 街の会話の箱。絵の下端からステージの下端までを覆う箱（矩形は layout.ts の townLayout の talk。
// 帯・見出し・一覧・施設メニュー・戻るに被せる）。迷宮のキャラクター画面では M8.5 の 3 行の箱（talkCompact。setCompact）。
// - 語り（say）は呼ばれた時点で 1 回だけ全文の履歴（UI-46。log）に入れる。
// - 文は箱に溜める（M10.5。2026-10-07 ユーザーの指示）: 1 文ずつ文字送りで出し、終わったら改行して次の文を続ける（文ごとのタップ待ちは無い）。
//   次の文が箱に入らない（行が埋まる）ときだけ ▼ を点滅させて（演出スキップでは点滅しない）タップを待ち、タップで箱を空にして続ける。
//   文の行数は talkRows の見積もり。say の Promise はその文の文字送りが終わったら解決する。
// - 最後の文の後（控えている文が無く、文字送りも終わった）は ▼ を出し、タップで箱を閉じる（言い終わったら消える）。
// - タップ（tap）: 文字送り中なら即表示、箱が埋まって待っていれば空にして続ける、そうでなく開いていれば閉じる。
//   rush は tap から「閉じる」を除いたもの（再生中のステージのタップ。playback の Player.tap → message.rush）。
//   箱を空にするタップと閉じるタップで送りの音（advanced → page。UI-66）。tap と rush で同じ。文字送りの即表示・flush・say では鳴らさない。
// - hold（UI-47 / UI-66。M10.5）: playback が、語った文の後の次の出来事（とその音）の前に、次に語る文（next）を渡して呼ぶ。
//   控えている文の後ろに並び、前の文の文字送りが終わった時点で、next が今の箱に入るなら（next が無ければ）解ける。
//   入らなければ ▼ でタップを待ち、タップで箱を空にしてから解ける（次の出来事の音は空にした箱の上で鳴る）。
// - cleared: 中身のある箱を空にした・閉じたとき。結線側が判定の箱（UI-40）を消す（文と一緒に出た箱は、その文のページの間だけ見せる）。
// - 演出スキップ（UI-41 / CLAUDE.md §3-9）が省くのは文字送り（say の instant）と ▼ の点滅だけで、▼ のタップ待ち（埋まったとき・最後）は省かない。
// - flush は控えている文をすべて解決して箱を閉じる（ログには入っている）。clear は flush に加えて外からの ▼ を下ろす（再開 SV-50）。
// - replay はログに入れずに出す（迷宮から持ち越した語り。playback の townCarry）。
// - pending（未定-19。M10.5）: 箱が開いているか、出す文が控えている間は真（箱は操作の欄に被さるので、最後の文の ▼ の間も含む）。
//   再生の外ではステージのどのタップも箱のタップにする（app と input/tap.ts）。街（広い箱）だけで使う。
// - waiting（未定-19 の M10 の規則。M10.5 の修正）: 箱が埋まって ▼ で待つか、出す文（と hold）が控えている間だけ真
//   （文字送り中の 1 文だけ・最後の文の ▼ の間は偽）。迷宮のキャラクター画面（3 行の箱。操作の欄に被らない）で使い、
//   項目は会話を打ち切ってから動き、最後の文の後は項目が効く。
// 純粋なモデル（createTalkModel）と、薄い DOM の層（createTalkBox）に分ける。
// 文字送りの setTimeout は DOM の層だけが使う（CLAUDE.md §2 の文字送りの例外）。モジュールのトップレベルでは DOM に触れない。
import type { TalkRect } from "../layout";
import { typewriterSteps } from "./message";
import { textUnits } from "./party-band";
import { WRAP_STYLE } from "./wrap";

/** UI-47（M10.5）: 折り返しの見積もりで、禁則（行頭に置けない字の送り）に見込む 1 行あたりの単位（全角 1 字） */
const TALK_WRAP_SLACK = 2;

/**
 * UI-47（M10.5。純粋）: 文が会話の箱で占める行数の見積もり。改行で区切った段ごとに、cols 単位（半角 1・全角 2）に収まれば 1 行、
 * 収まらなければ 1 行あたり cols - TALK_WRAP_SLACK 単位で割った行数（禁則で字が次の行へ送られる分を多めに数える）
 */
export function talkRows(text: string, cols: number): number {
  let n = 0;
  for (const seg of text.split("\n")) {
    const u = textUnits(seg);
    n += u <= cols ? 1 : Math.ceil(u / Math.max(1, cols - TALK_WRAP_SLACK));
  }
  return n;
}

/** 表示の先（DOM の層。テストでは記録するだけの偽物） */
export type TalkSink = {
  /** 箱の表示 */
  open(on: boolean): void;
  /** 箱に出す文（今のページの文を改行でつないだもの。末尾の文は文字送りの途中の段も） */
  text(s: string): void;
  /** ▼ の表示。blink なら点滅 */
  more(on: boolean, blink: boolean): void;
};

export type TalkModelDeps = {
  sink: TalkSink;
  /**
   * UI-66（M10.5）: 文を送ったとき（送りの音）。tap・rush で埋まった箱を空にしたとき（hold を解いたときも）と、tap で箱を閉じたとき。
   * 文字送りの即表示・flush・箱が開くとき（say）では呼ばない
   */
  advanced?(): void;
  /** UI-40 / UI-47（M10.5）: 中身のある箱を空にした・閉じたとき（判定の箱を消す） */
  cleared?(): void;
  /** UI-46: 全文の履歴に 1 行足す（メッセージ窓と同じ 1 本の配列） */
  log(text: string): void;
  /** 文字送りの 1 文字あたりの ms（settings.textSpeed）。0 以下なら即時 */
  speed(): number;
  /** タップ待ちの ▼ を点滅させるか（演出スキップでは偽） */
  blink(): boolean;
  /** ms 後に fn を呼ぶ。返り値で取り消す（DOM の層は setTimeout） */
  schedule(fn: () => void, ms: number): () => void;
  /** UI-47（M10.5）: 箱の行数（townLayout の talk.lines。迷宮のキャラクター画面では talkCompact.lines） */
  lines(): number;
  /** UI-47（M10.5）: 1 行の単位（半角 1・全角 2。talk.cols） */
  cols(): number;
};

export type TalkModel = {
  /** 1 文を語る。呼んだ時点でログに入れる。instant か speed() が 0 以下なら文字送りしない */
  say(text: string, instant: boolean): Promise<void>;
  /** ログに入れずに語る（迷宮から持ち越した語り）。最後の文の文字送りが終わったら解決する */
  replay(texts: readonly string[], instant: boolean): Promise<void>;
  /** 文字送り中なら即表示、箱が埋まって待っていれば空にして続ける（閉じない） */
  rush(): void;
  /** rush に加えて、そのどちらでもなく箱が開いていれば閉じる */
  tap(): void;
  /** 文字送りの途中か */
  typing(): boolean;
  /** 箱が開いているか */
  isOpen(): boolean;
  /**
   * UI-47 / UI-66（未定-19。M10.5）: 文送りを待っているか。箱が開いている（文字送り中・▼ で待つ・最後の文の ▼）か、
   * 出す文（と hold）が控えている
   */
  pending(): boolean;
  /**
   * UI-47 / UI-59（未定-19。M10 の規則）: 箱が埋まって ▼ で待つか、出す文（と hold）が控えている間だけ真。
   * 文字送り中の 1 文だけのときと、最後の文の ▼ の間は偽（迷宮のキャラクター画面の 3 行の箱。操作の欄に被らない）
   */
  waiting(): boolean;
  /** 外からの ▼（playback の続きの三角と、判定の箱の待ち）。文字送りの間と箱が埋まって待つ間は出さない */
  setMore(on: boolean, blink?: boolean): void;
  /**
   * UI-47 / UI-66（M10.5）: playback が、語った文の後の次の出来事（dice を除く）の再生と音の前に、次に語る文 next を渡して呼ぶ。
   * 控えている文の文字送りが終わった時点で、next が今の箱に入る（next が無い・箱が空）ならすぐ解決する。
   * 入らなければ ▼（点滅は blink()）でタップを待ち、tap か rush で箱を空にしてから解決する
   */
  hold(next?: string): Promise<void>;
  /** 控えている文をすべて解決して箱を閉じる */
  flush(): void;
  /** flush に加えて外からの ▼ を下ろす */
  clear(): void;
};

type SayItem = { kind: "say"; text: string; instant: boolean; resolve: () => void };
type HoldItem = { kind: "hold"; next: string | undefined; resolve: () => void };
type Item = SayItem | HoldItem;

export function createTalkModel(d: TalkModelDeps): TalkModel {
  const queue: Item[] = [];
  /** 箱に出ている文（今のページ。文字送り中の文も末尾に入っている） */
  const page: string[] = [];
  /** page の行数の見積もり */
  let used = 0;
  /** 箱が開いているか（埋まった箱を空にした直後は、空のまま開いている） */
  let opened = false;
  /** 文字送り中の文（終えると解決する） */
  let job: { item: SayItem; cancel: () => void } | null = null;
  /** 箱が埋まって、空にするタップを待っている項目（入らない次の文か、入らない文を控えた hold） */
  let full: Item | null = null;
  /** 外からの ▼ */
  let ext: { blink: boolean } | null = null;
  /** pump の中か（文字送りの即時の終わりから入れ子で呼ばれても 1 本で進める） */
  let pumping = false;

  const rows = (text: string): number => talkRows(text, d.cols());
  const fits = (text: string): boolean => page.length === 0 || used + rows(text) <= d.lines();
  /** 今のページを出す。last は末尾の文の文字送りの途中の段 */
  const render = (last?: string): void => {
    d.sink.text(last === undefined ? page.join("\n") : [...page.slice(0, -1), last].join("\n"));
  };

  const refreshMore = (): void => {
    if (full !== null) {
      d.sink.more(true, d.blink());
      return;
    }
    if (job !== null || page.length === 0) {
      d.sink.more(false, false);
      return;
    }
    if (ext !== null) {
      d.sink.more(true, ext.blink);
      return;
    }
    // 最後の文の ▼（タップで閉じる）
    d.sink.more(true, d.blink());
  };

  const finish = (): void => {
    const j = job;
    if (j === null) return;
    j.cancel();
    job = null;
    render();
    j.item.resolve();
    pump();
  };

  /** 文をページの末尾に足して出す（instant なら即時に解決） */
  const start = (item: SayItem): void => {
    page.push(item.text);
    used += rows(item.text);
    opened = true;
    d.sink.open(true);
    const speed = d.speed();
    if (item.instant || !(speed > 0)) {
      render();
      item.resolve();
      return;
    }
    const steps = typewriterSteps(item.text);
    let i = 0;
    let cancelTimer: () => void = () => {};
    const tick = (): void => {
      render(steps[i] ?? item.text);
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

  /** 控えている文と hold を、箱に入る限り進める（入らなければ ▼ で待つ） */
  const pump = (): void => {
    if (pumping) return;
    pumping = true;
    try {
      while (job === null && full === null) {
        const it = queue[0];
        if (it === undefined) break;
        queue.shift();
        const text = it.kind === "say" ? it.text : it.next;
        if (text !== undefined && !fits(text)) {
          full = it;
          break;
        }
        if (it.kind === "say") start(it);
        else it.resolve();
      }
    } finally {
      pumping = false;
    }
    refreshMore();
  };

  const enqueue = (item: Item): void => {
    queue.push(item);
    pump();
  };
  const sayItem = (text: string, instant: boolean): Promise<void> =>
    new Promise<void>((resolve) => enqueue({ kind: "say", text, instant, resolve }));

  /** 箱を空にする（開いたまま）。中身があったなら cleared */
  const emptyPage = (): void => {
    const had = page.length > 0;
    page.length = 0;
    used = 0;
    d.sink.text("");
    if (had) d.cleared?.();
  };

  const close = (): void => {
    emptyPage();
    opened = false;
    d.sink.open(false);
    refreshMore();
  };

  /**
   * UI-66（M10.5）: 文字送り中なら即表示（送りではないので鳴らさない）。箱が埋まって待っていれば、送りの音（advanced）とともに
   * 箱を空にし、待っていた文を出す（hold なら解く）。tap と再生中の rush で同じ（どこを押したかによらない）
   */
  const rush = (): boolean => {
    if (job !== null) {
      finish();
      return true;
    }
    const it = full;
    if (it !== null) {
      full = null;
      d.advanced?.();
      emptyPage();
      queue.unshift(it);
      pump();
      return true;
    }
    return false;
  };

  const flush = (): void => {
    const j = job;
    job = null;
    j?.cancel();
    j?.item.resolve();
    const f = full;
    full = null;
    f?.resolve();
    for (const it of queue.splice(0)) it.resolve();
    close();
  };

  return {
    say(text: string, instant: boolean): Promise<void> {
      d.log(text);
      return sayItem(text, instant);
    },
    replay(texts: readonly string[], instant: boolean): Promise<void> {
      return Promise.all(texts.map((x) => sayItem(x, instant))).then(() => undefined);
    },
    rush(): void {
      rush();
    },
    tap(): void {
      if (rush()) return;
      if (opened) {
        d.advanced?.();
        close();
      }
    },
    typing(): boolean {
      return job !== null;
    },
    isOpen(): boolean {
      return opened;
    },
    pending(): boolean {
      return opened || queue.length > 0 || full !== null;
    },
    waiting(): boolean {
      return queue.length > 0 || full !== null;
    },
    setMore(on: boolean, blink = false): void {
      ext = on ? { blink } : null;
      refreshMore();
    },
    hold(next?: string): Promise<void> {
      return new Promise<void>((resolve) => enqueue({ kind: "hold", next, resolve }));
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

export type TalkBox = TalkModel & {
  el: HTMLElement;
  /** UI-47 / UI-59（M10.5）: 迷宮のキャラクター画面の 3 行の箱（compact）に切り替える。偽なら街の箱 */
  setCompact(on: boolean): void;
};

/**
 * UI-47: 会話の箱の DOM。layout は townLayout の talk、compact は talkCompact（ステージ座標）。log はメッセージ窓の log（同じ 1 本の履歴）。
 * cleared は中身のある箱を空にした・閉じたとき（判定の箱を消す）
 */
export function createTalkBox(o: {
  layout: TalkRect;
  compact?: TalkRect;
  speed(): number;
  blink(): boolean;
  log(text: string): void;
  /** UI-66: 送りの音（TalkModelDeps の advanced） */
  advanced?(): void;
  /** UI-40（M10.5）: TalkModelDeps の cleared */
  cleared?(): void;
}): TalkBox {
  // 子の left / top は枠 1px の内側が原点
  const BORDER = 1;
  let rect = o.layout;
  const el = document.createElement("div");
  el.className = "talk-box";
  Object.assign(el.style, {
    position: "absolute",
    border: "1px solid var(--c-frame)",
    background: "var(--c-bg)",
    color: "var(--c-text)",
    display: "none",
  });

  // 文字領域（lines 行）。上詰めで、文は改行でつないで溜める。見積もりより行が増えてあふれたら最新の行を見せる（全文はログ）
  const body = document.createElement("div");
  body.className = "talk-text";
  Object.assign(body.style, {
    position: "absolute",
    overflow: "hidden",
    touchAction: "none",
    ...WRAP_STYLE,
    userSelect: "none",
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-start",
  });
  const line = document.createElement("div");
  line.className = "talk-line";
  line.style.flexShrink = "0";
  body.appendChild(line);
  el.appendChild(body);

  const SVG_NS = "http://www.w3.org/2000/svg";
  const more = document.createElementNS(SVG_NS, "svg");
  more.setAttribute("viewBox", "0 0 8 8");
  more.setAttribute("shape-rendering", "crispEdges");
  Object.assign(more.style, { position: "absolute", visibility: "hidden" });
  const tri = document.createElementNS(SVG_NS, "path");
  tri.setAttribute("d", "M0 1 H8 L4 7 Z");
  tri.setAttribute("fill", "var(--c-text)");
  more.appendChild(tri);
  el.appendChild(more);

  /** 矩形を当てる */
  const place = (): void => {
    const r = rect.box;
    const t = rect.text;
    const mr = rect.more;
    Object.assign(el.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
    Object.assign(body.style, { left: `${t.x - r.x - BORDER}px`, top: `${t.y - r.y - BORDER}px`, width: `${t.w}px`, height: `${t.h}px` });
    more.setAttribute("width", String(mr.w));
    more.setAttribute("height", String(mr.h));
    Object.assign(more.style, { left: `${mr.x - r.x - BORDER}px`, top: `${mr.y - r.y - BORDER}px` });
  };
  place();

  /** 見積もりより行が増えてあふれたら、最新の行（下端）を見せる */
  const keepTail = (): void => {
    const over = (body.scrollHeight || 0) - (body.clientHeight || 0);
    body.scrollTop = over > 0 ? over : 0;
  };

  let moreBlink: Animation | null = null;
  const model = createTalkModel({
    ...(o.advanced !== undefined ? { advanced: o.advanced } : {}),
    ...(o.cleared !== undefined ? { cleared: o.cleared } : {}),
    log: o.log,
    speed: o.speed,
    blink: o.blink,
    lines: () => rect.lines,
    cols: () => rect.cols,
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
        keepTail();
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
  return {
    ...model,
    el,
    setCompact(on: boolean): void {
      const next = on && o.compact !== undefined ? o.compact : o.layout;
      if (next === rect) return;
      rect = next;
      place();
      keepTail();
    },
  };
}

/** UI-47: 語りの表示先。route が街なら会話の箱、それ以外はメッセージ窓。ログはどちらもメッセージ窓の 1 本の配列 */
export type Narration = {
  say(text: string, instant: boolean): Promise<void>;
  setMore(on: boolean, blink?: boolean): void;
  rush(): void;
  typing(): boolean;
  log(text: string): void;
  waitMs(ms: number): Promise<void>;
  /** UI-47 / UI-66（M10.5）: 語った文の後の出来事の前の待ち（TalkModel.hold。next は次に語る文）。メッセージ窓には無い（待たない） */
  hold?(next?: string): Promise<void>;
  /** UI-40 / UI-47（M10.5）: 判定の箱を会話の箱のページと一緒に消すか（街なら真。消すのは箱の cleared）。省略すると偽 */
  keepsDice?(): boolean;
};

export function createNarrator(o: {
  /** 今の route が街か（キャラクター画面を含む） */
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
    hold: (next) => (o.town() ? (o.talk.hold?.(next) ?? Promise.resolve()) : Promise.resolve()),
    keepsDice: () => o.town(),
  };
}
