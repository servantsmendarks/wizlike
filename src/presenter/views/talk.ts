// UI-47（M8.5。M10.5 で広げて溜める形に。M10.5 追補でログ形式に）: 街の会話の箱。絵の下端からステージの下端までを覆う箱（矩形は layout.ts の townLayout の talk。
// 帯・見出し・一覧・施設メニュー・戻るに被せる）。迷宮のキャラクター画面では M8.5 の 3 行の箱（talkCompact。setRect("compact")）。
// 全滅の内訳（UI-56）の間は、内訳の下・「街へ」の上の 3 行の箱（talkWipe。setRect("wipe")。M10.5 追補 2・未定-25）。
// - 語り（say）は呼ばれた時点で 1 回だけ全文の履歴（UI-46。log）に入れる。
// - 文は箱に溜める（M10.5。2026-10-07 ユーザーの指示）: 1 文ずつ文字送りで出し、終わったら改行して次の文を続ける（文ごとのタップ待ちは無い）。
// - ログ形式（M10.5 追補。2026-10-07 ユーザーの指示「多い場合はログ形式で、下、上に続きがある旨を示してください」。未定-24）:
//   箱が埋まっても空にせず、文を溜め続けてスクロールする（「埋まったら ▼ で空にする」はやめた）。DOM の層は、文字送り中は最新の行が
//   見えるよう下端に追従し、指（とホイール・↑↓ キー）で上下に読み返せる。読み返している間（下端にいない間）は追従しない。
//   上・下に隠れた行があれば、右の余白の列に続きの印（scroll-marks.ts。点滅しない）を出す。
//   say の Promise はその文の文字送りが終わったら解決する。溜める文の数は max（config.ui.messageHistory）まで（古い文から外す。全文はログ）。
// - 最後の文の後（控えている文が無く、文字送りも終わった）は ▼ を出し、タップで箱を閉じる（言い終わったら消える）。
// - タップ（tap）: 文字送り中なら即表示、そうでなく開いていれば閉じる。
//   rush は tap から「閉じる」を除いたもの（再生中のステージのタップ。playback の Player.tap → message.rush）。
//   閉じるタップで送りの音（advanced → page。UI-66）。文字送りの即表示・flush・say では鳴らさない。
// - hold（UI-47 / UI-66。M10.5）: playback が、語った文の後の次の出来事（とその音）の前に呼ぶ。控えている文の後ろに並び、
//   前の文の文字送りが終わった時点で解ける（M10.5 追補: 箱が埋まることが無くなったので、タップは待たない）。
// - cleared: 中身のある箱を閉じたとき。結線側が判定の箱（UI-40）を消す（文と一緒に出た箱は、箱が開いている間は見せる）。
// - 演出スキップ（UI-41 / CLAUDE.md §3-9）が省くのは文字送り（say の instant）と ▼ の点滅だけで、最後の文の ▼ のタップ待ちは省かない。
//   続きの印とスクロールは演出スキップによらない。
// - flush は控えている文をすべて解決して箱を閉じる（ログには入っている）。clear は flush に加えて外からの ▼ を下ろす（再開 SV-50）。
// - replay はログに入れずに出す（迷宮から持ち越した語り。playback の townCarry）。
// - pending（未定-19。M10.5）: 箱が開いているか、出す文が控えている間は真（箱は操作の欄に被さるので、最後の文の ▼ の間も含む）。
//   再生の外ではステージのどのタップも箱のタップにする（app と input/tap.ts）。街（広い箱）だけで使う。
// - waiting（未定-19 の M10 の規則。M10.5 の修正）: 出す文（と hold）が控えている間だけ真
//   （文字送り中の 1 文だけ・最後の文の ▼ の間は偽）。迷宮のキャラクター画面（3 行の箱。操作の欄に被らない）で使い、
//   項目は会話を打ち切ってから動き、最後の文の後は項目が効く。
// 純粋なモデル（createTalkModel）と、薄い DOM の層（createTalkBox）に分ける。
// 文字送りの setTimeout は DOM の層だけが使う（CLAUDE.md §2 の文字送りの例外）。モジュールのトップレベルでは DOM に触れない。
import type { Strings } from "../../core/data/index";
import type { TalkRect } from "../layout";
import { typewriterSteps } from "./message";
import { attachScrollMarks, marksAt, SCROLL_MARK_SIZE, scrolledToEnd, type ScrollMarkPos } from "./scroll-marks";
import { WRAP_STYLE } from "./wrap";

/** 表示の先（DOM の層。テストでは記録するだけの偽物） */
export type TalkSink = {
  /** 箱の表示 */
  open(on: boolean): void;
  /** 箱に出す文（溜めた文を改行でつないだもの。末尾の文は文字送りの途中の段も） */
  text(s: string): void;
  /** ▼ の表示。blink なら点滅 */
  more(on: boolean, blink: boolean): void;
};

export type TalkModelDeps = {
  sink: TalkSink;
  /** UI-66（M10.5）: 文を送ったとき（送りの音）。tap で箱を閉じたとき。文字送りの即表示・flush・箱が開くとき（say）では呼ばない */
  advanced?(): void;
  /** UI-40 / UI-47（M10.5）: 中身のある箱を閉じたとき（判定の箱を消す） */
  cleared?(): void;
  /** UI-46: 全文の履歴に 1 行足す（メッセージ窓と同じ 1 本の配列） */
  log(text: string): void;
  /** 文字送りの 1 文字あたりの ms（settings.textSpeed）。0 以下なら即時 */
  speed(): number;
  /** タップ待ちの ▼ を点滅させるか（演出スキップでは偽） */
  blink(): boolean;
  /** ms 後に fn を呼ぶ。返り値で取り消す（DOM の層は setTimeout） */
  schedule(fn: () => void, ms: number): () => void;
  /** UI-47（M10.5 追補）: 箱に溜める文の数の上限（config.ui.messageHistory）。超えたら古い文から外す。省略は上限なし */
  max?(): number;
};

export type TalkModel = {
  /** 1 文を語る。呼んだ時点でログに入れる。instant か speed() が 0 以下なら文字送りしない */
  say(text: string, instant: boolean): Promise<void>;
  /** ログに入れずに語る（迷宮から持ち越した語り）。最後の文の文字送りが終わったら解決する */
  replay(texts: readonly string[], instant: boolean): Promise<void>;
  /** 文字送り中なら即表示（閉じない） */
  rush(): void;
  /** rush に加えて、文字送り中でなく箱が開いていれば閉じる */
  tap(): void;
  /** 文字送りの途中か */
  typing(): boolean;
  /** 箱が開いているか */
  isOpen(): boolean;
  /**
   * UI-47 / UI-66（未定-19。M10.5）: 文送りを待っているか。箱が開いている（文字送り中・最後の文の ▼）か、
   * 出す文（と hold）が控えている
   */
  pending(): boolean;
  /**
   * UI-47 / UI-59（未定-19。M10 の規則）: 出す文（と hold）が控えている間だけ真。
   * 文字送り中の 1 文だけのときと、最後の文の ▼ の間は偽（迷宮のキャラクター画面の 3 行の箱。操作の欄に被らない）
   */
  waiting(): boolean;
  /** 外からの ▼（playback の続きの三角と、判定の箱の待ち）。文字送りの間は出さない */
  setMore(on: boolean, blink?: boolean): void;
  /**
   * UI-47 / UI-66（M10.5）: playback が、語った文の後の次の出来事（dice を除く）の再生と音の前に呼ぶ。
   * 控えている文の文字送りが終わった時点で解決する（箱が閉じていればすぐ）
   */
  hold(): Promise<void>;
  /** 控えている文をすべて解決して箱を閉じる */
  flush(): void;
  /** flush に加えて外からの ▼ を下ろす */
  clear(): void;
};

type SayItem = { kind: "say"; text: string; instant: boolean; resolve: () => void };
type HoldItem = { kind: "hold"; resolve: () => void };
type Item = SayItem | HoldItem;

export function createTalkModel(d: TalkModelDeps): TalkModel {
  const queue: Item[] = [];
  /** 箱に溜めた文（文字送り中の文も末尾に入っている） */
  const page: string[] = [];
  /** 箱が開いているか */
  let opened = false;
  /** 文字送り中の文（終えると解決する） */
  let job: { item: SayItem; cancel: () => void } | null = null;
  /** 外からの ▼ */
  let ext: { blink: boolean } | null = null;
  /** pump の中か（文字送りの即時の終わりから入れ子で呼ばれても 1 本で進める） */
  let pumping = false;

  /** 溜めた文を出す。last は末尾の文の文字送りの途中の段 */
  const render = (last?: string): void => {
    d.sink.text(last === undefined ? page.join("\n") : [...page.slice(0, -1), last].join("\n"));
  };

  const refreshMore = (): void => {
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

  /** 文を溜めた文の末尾に足して出す（instant なら即時に解決）。上限を超えたら古い文から外す */
  const start = (item: SayItem): void => {
    page.push(item.text);
    const max = d.max?.() ?? Infinity;
    if (max >= 1) while (page.length > max) page.shift();
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

  /** 控えている文と hold を順に進める（文字送り中は待つ） */
  const pump = (): void => {
    if (pumping) return;
    pumping = true;
    try {
      while (job === null) {
        const it = queue.shift();
        if (it === undefined) break;
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

  /** 箱を閉じる。中身があったなら cleared */
  const close = (): void => {
    const had = page.length > 0;
    page.length = 0;
    d.sink.text("");
    if (had) d.cleared?.();
    opened = false;
    d.sink.open(false);
    refreshMore();
  };

  /** UI-43: 文字送り中なら即表示（送りではないので鳴らさない）。tap と再生中の rush で同じ（どこを押したかによらない） */
  const rush = (): boolean => {
    if (job !== null) {
      finish();
      return true;
    }
    return false;
  };

  const flush = (): void => {
    const j = job;
    job = null;
    j?.cancel();
    j?.item.resolve();
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
      return opened || queue.length > 0;
    },
    waiting(): boolean {
      return queue.length > 0;
    },
    setMore(on: boolean, blink = false): void {
      ext = on ? { blink } : null;
      refreshMore();
    },
    hold(): Promise<void> {
      return new Promise<void>((resolve) => enqueue({ kind: "hold", resolve }));
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

/** UI-47（M10.5 追補）: ↑↓ キーで動かす行数（履歴の画面と同じ 3 行） */
export const TALK_KEY_LINES = 3;
/** UI-03: 1 行の高さ（論理 px） */
const TALK_LINE_H = 10;

/**
 * UI-47: 会話の箱の矩形の種類。town は街の広い箱、compact は迷宮のキャラクター画面の 3 行の箱（UI-59。M10.5）、
 * wipe は全滅の内訳の間の 3 行の箱（UI-56。M10.5 追補 2・未定-25）
 */
export type TalkRectKind = "town" | "compact" | "wipe";

export type TalkBox = TalkModel & {
  el: HTMLElement;
  /** UI-47: 箱の矩形を切り替える（開いている箱の文はそのまま） */
  setRect(kind: TalkRectKind): void;
  /** UI-47 / UI-33（M10.5 追補）: 文字領域を lines 行ぶん動かす（負で上へ。↑↓ キー）。下端まで戻れば追従に戻る */
  scrollBy(lines: number): void;
};

/**
 * UI-47（M10.5 追補。純粋）: 続きの印の位置（枠の内側が原点の座標）。右の余白の列（枠の内側の右端から 8px。
 * ただし文字領域の右端の 1px 右より左には置かない）に、文字領域の上端と下端に揃えて置く
 */
export function talkMarkPos(rect: TalkRect): ScrollMarkPos {
  const BORDER = 1;
  const r = rect.box;
  const t = rect.text;
  const x = Math.min(t.x + t.w + 1, r.x + r.w - BORDER - SCROLL_MARK_SIZE + 1);
  return marksAt(x - r.x - BORDER, { y: t.y - r.y - BORDER, h: t.h });
}

/**
 * UI-47: 会話の箱の DOM。layout は townLayout の talk、compact は talkCompact、wipe は talkWipe（ステージ座標）。log はメッセージ窓の log（同じ 1 本の履歴）。
 * cleared は中身のある箱を閉じたとき（判定の箱を消す）。strings は続きの印の字（scroll.up / scroll.down）。max は溜める文の数の上限
 */
export function createTalkBox(o: {
  layout: TalkRect;
  compact?: TalkRect;
  /** UI-56（M10.5 追補 2）: 全滅の内訳の間の箱（townLayout の talkWipe） */
  wipe?: TalkRect;
  strings: Strings;
  speed(): number;
  blink(): boolean;
  log(text: string): void;
  max?: number;
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

  // 文字領域（lines 行が見える）。上詰めで、文は改行でつないで溜め、あふれたら縦にスクロールする（M10.5 追補。pan-y は style.css）
  const body = document.createElement("div");
  body.className = "talk-text";
  Object.assign(body.style, {
    position: "absolute",
    overflowX: "hidden",
    overflowY: "auto",
    touchAction: "pan-y",
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

  /** 最新の行（下端）に追従するか。利用者が上へスクロールしている間は偽。箱を開き直すと真 */
  let follow = true;
  const metrics = () => ({ scrollTop: body.scrollTop || 0, scrollHeight: body.scrollHeight || 0, clientHeight: body.clientHeight || 0 });
  /** toEnd で送った位置（scroll は後から届くので、その間に文が伸びても自分の送りを利用者のスクロールと取り違えない） */
  let autoTop = -1;
  /** 指が触れた時点の位置と追従（離すまで。下の onGrab） */
  let grab: { top: number; follow: boolean } | null = null;
  /** 最新の行（下端）を見せる */
  const toEnd = (): void => {
    const m = metrics();
    const over = m.scrollHeight - m.clientHeight;
    body.scrollTop = over > 0 ? over : 0;
    autoTop = body.scrollTop || 0;
  };
  const marks = attachScrollMarks({
    scroller: body,
    host: el,
    strings: o.strings,
    pos: talkMarkPos(rect),
    // 利用者のスクロールで下端を離れたら追従をやめ、下端に戻ったら追従する（toEnd の送りの scroll は追従のまま）
    onScroll: () => {
      // 指が触れている間は、遅れて届いた送りの scroll でも追従に戻さない（離したときに決める）
      if (grab !== null) {
        follow = false;
        return;
      }
      if (autoTop >= 0 && Math.abs((body.scrollTop || 0) - autoTop) <= 1) {
        follow = true;
        return;
      }
      autoTop = -1;
      follow = scrolledToEnd(metrics());
    },
  });

  /**
   * UI-47（M10.5 追補。レビュー）: 指（ポインタ）が文字領域に触れた時点で追従をやめる（scroll は後から届くので、それを待つと
   * その間の文字送りの送りが利用者の読み返しを下端へ引き戻す）。離したときに、触れてから動いていなければ触れる前の追従に戻し
   * （タップ）、動いていれば下端にいるときだけ追従に戻す。ホイールは上へ回したときだけやめる（下端に戻れば onScroll で戻る）
   */
  const onGrab = (): void => {
    if (grab === null) grab = { top: body.scrollTop || 0, follow };
    follow = false;
    autoTop = -1;
  };
  const onRelease = (): void => {
    if (grab === null) return;
    const g = grab;
    grab = null;
    const still = Math.abs((body.scrollTop || 0) - g.top) <= 1;
    follow = still ? g.follow : scrolledToEnd(metrics());
    if (follow) toEnd();
    marks.refresh();
  };
  body.addEventListener("pointerdown", onGrab);
  body.addEventListener("touchstart", onGrab, { passive: true });
  // pointercancel（ブラウザがパンを引き取った）の後も touchend は届くので、離したときの判定は pointerup と touchend
  body.addEventListener("pointerup", onRelease);
  body.addEventListener("touchend", onRelease);
  body.addEventListener("touchcancel", onRelease);
  body.addEventListener(
    "wheel",
    (e: WheelEvent) => {
      if (e.deltaY < 0 && (body.scrollTop || 0) > 0) {
        follow = false;
        autoTop = -1;
      }
    },
    { passive: true },
  );

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
    marks.place(talkMarkPos(rect));
  };
  place();

  let moreBlink: Animation | null = null;
  const model = createTalkModel({
    ...(o.advanced !== undefined ? { advanced: o.advanced } : {}),
    ...(o.cleared !== undefined ? { cleared: o.cleared } : {}),
    ...(o.max !== undefined ? { max: () => o.max! } : {}),
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
        if (!on) {
          follow = true;
          grab = null;
        }
        marks.refresh();
      },
      text(s: string): void {
        line.textContent = s;
        if (s === "") follow = true;
        if (follow) toEnd();
        marks.refresh();
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
    setRect(kind: TalkRectKind): void {
      const next = (kind === "compact" ? o.compact : kind === "wipe" ? o.wipe : undefined) ?? o.layout;
      if (next === rect) return;
      rect = next;
      place();
      if (follow) toEnd();
      marks.refresh();
    },
    scrollBy(lines: number): void {
      body.scrollTop = (body.scrollTop || 0) + lines * TALK_LINE_H;
      autoTop = -1;
      follow = scrolledToEnd(metrics());
      marks.refresh();
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
  /** UI-47 / UI-66（M10.5）: 語った文の後の出来事の前の待ち（TalkModel.hold。前の文の文字送りの終わりまで）。メッセージ窓には無い（待たない） */
  hold?(): Promise<void>;
  /** UI-40 / UI-47（M10.5）: 判定の箱を会話の箱と一緒に消すか（街なら真。消すのは箱の cleared）。省略すると偽 */
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
    hold: () => (o.town() ? (o.talk.hold?.() ?? Promise.resolve()) : Promise.resolve()),
    keepsDice: () => o.town(),
  };
}
