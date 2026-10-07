// UI-36 / UI-30 / UI-34 / UI-37: ステージ全体の入力を 1 か所で受ける（Pointer Events）。
// - 押せるものは onTap(el, spec) で登録する（data-tap 属性と WeakMap）。押せるものは「動かずに離した」ときだけ反応する。
//   移動が swipeThreshold（論理 px × ステージの CSS 倍率）を越えたら取り消し。click には反応しない。
//   例外は、ここの click リスナーで detail === 0 のもの（キーボードの Enter）を onTap に回す 1 か所だけ。
// - 迷宮でスワイプを受ける間（swipeEnabled）は、ボタンの上で始まっても閾値を越えた瞬間に 1 回だけスワイプにする（UI-30）。
//   左右の非反応帯（UI-34。ステージの左右の全高）で始まった押下はスワイプにしないが、タップは通す。
// - 前進ボタン（spec.hold）は、動かずに hold.ms() 押し続けたら onHoldStart、離したら onHoldEnd（onTap は呼ばない。UI-31）。
// - 再生中（busy）のタップは、whileBusy の要素（オート解除）以外はすべて onBusyTap（player.tap()）に回す（UI-44 / UI-45）。
// - 再生の外で会話の箱が文送りを待つ間（talkWaits。未定-19）は、押した要素によらずタップを onTalkTap（箱のタップ）に回す。
// - 名前の入力欄（INPUT / TEXTAREA）の上の押下は追わず、touchend の preventDefault もしない。入力欄の外を押したら入力欄の
//   フォーカスを外す（touchend の preventDefault で合成のフォーカス移動が起きないため）。
// - touchend は passive:false で受けて preventDefault する（UI-37: ダブルタップの拡大と、合成の click を止める）。
// 純粋な部分（pressDown / pressMove / pressUp）を export して node 環境で試す。setTimeout は長押しの判定にだけ使う。
// モジュールのトップレベルでは DOM に触れない。
import { classifySwipe, inDeadZone, swipeAction, thresholdCss, type Action, type Dir } from "./swipe";

/** 押した要素の左上からの論理 px */
export type TapPoint = { lx: number; ly: number };

export type TapSpec = {
  onTap(p: TapPoint): void;
  /** 再生中でも onTap を呼ぶ（オート解除の枠だけ） */
  whileBusy?: boolean;
  /** 前進ボタンだけ: 動かずに ms() 押し続けたら onHoldStart、離したら onHoldEnd（onTap は呼ばない） */
  hold?: { ms(): number; onHoldStart(): void; onHoldEnd(): void };
};

/** 追っている押下 1 つ。sx / sy は押した位置（CSS px）、target は押した要素（closest('[data-tap]')） */
export type PressState = {
  id: number;
  sx: number;
  sy: number;
  target: Element | null;
  /** 閾値を越えて動いた（タップを取り消した） */
  moved: boolean;
  /** スワイプとして確定した方向（離すまで再発火しない） */
  swiped: Dir | null;
  /** 非反応帯で始まった（スワイプの起点にしない） */
  inDeadZone: boolean;
  /** 長押しが始まった */
  held: boolean;
} | null;

export type PressResult = { kind: "none" } | { kind: "swipe"; dir: Dir } | { kind: "cancel" };

/** 押下を始める。lx はステージの左端からの論理 px（非反応帯の判定だけに使う） */
export function pressDown(id: number, x: number, y: number, target: Element | null, lx: number, width: number, deadZone: number): PressState {
  return { id, sx: x, sy: y, target, moved: false, swiped: null, inDeadZone: inDeadZone(lx, width, deadZone), held: false };
}

/**
 * 移動。別の id・動いた後・閾値（CSS px）未満は何もしない。閾値を越えた瞬間に、swipe が真で非反応帯の外で始まり
 * 長押しが始まっていなければ主軸の方向で 1 回だけ swipe、それ以外は cancel（タップの取り消し）を返す
 */
export function pressMove(p: PressState, id: number, x: number, y: number, thrCss: number, swipe: boolean): { next: PressState; out: PressResult } {
  if (p === null || p.id !== id || p.moved) return { next: p, out: { kind: "none" } };
  const d = classifySwipe(x - p.sx, y - p.sy, thrCss);
  if (d === null) return { next: p, out: { kind: "none" } };
  if (swipe && !p.inDeadZone && !p.held) return { next: { ...p, moved: true, swiped: d }, out: { kind: "swipe", dir: d } };
  return { next: { ...p, moved: true }, out: { kind: "cancel" } };
}

/** 離した。tap = 動かず長押しにもならなかった。holdEnd = 長押しを終える。swipeEnd = スワイプを離した。別の id は無視 */
export function pressUp(p: PressState, id: number): { next: PressState; tap: boolean; holdEnd: boolean; swipeEnd: boolean } {
  if (p === null || p.id !== id) return { next: p, tap: false, holdEnd: false, swipeEnd: false };
  return { next: null, tap: !p.moved && !p.held, holdEnd: p.held, swipeEnd: p.swiped !== null };
}

/** 長押しが始まった（動いていなければ） */
export function pressHold(p: PressState): PressState {
  if (p === null || p.moved || p.held) return p;
  return { ...p, held: true };
}

// ---------------------------------------------------------------------------
// 登録

const specs = new WeakMap<object, TapSpec>();

/** UI-36: el を押せるものとして登録する（同じ el に 2 回呼べば置き換える） */
export function onTap(el: Element, spec: TapSpec | ((p: TapPoint) => void)): void {
  specs.set(el, typeof spec === "function" ? { onTap: spec } : spec);
  el.setAttribute("data-tap", "");
}

/** 登録した spec（無ければ null）。テストと attachStageInput が使う */
export function tapSpecOf(el: object | null): TapSpec | null {
  return el === null ? null : (specs.get(el) ?? null);
}

/** INPUT / TEXTAREA / SELECT / contenteditable */
export function isTextInput(target: unknown): boolean {
  if (typeof target !== "object" || target === null) return false;
  const t = target as { tagName?: unknown; isContentEditable?: unknown };
  if (typeof t.tagName !== "string") return false;
  const tag = t.tagName.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable === true;
}

/** target から上へたどって最初の [data-tap]（無ければ null） */
function closestTap(target: unknown): Element | null {
  const t = target as { closest?: (s: string) => Element | null } | null;
  if (t === null || typeof t !== "object" || typeof t.closest !== "function") return null;
  return t.closest("[data-tap]");
}

function setPressed(el: Element | null, on: boolean): void {
  const cl = (el as { classList?: DOMTokenList } | null)?.classList;
  if (cl === undefined) return;
  if (on) cl.add("is-pressed");
  else cl.remove("is-pressed");
}

/**
 * UI-37（M6）: 押した要素そのものに、次の touchend を 1 回だけ preventDefault するリスナーを付ける。
 * タップは pointerup で反応し、その場で画面を描き直すと押した要素が DOM から外れる。外れた要素の touchend はステージまで
 * 伝わらないので、ステージの touchend では止められず、合成の click とフォーカス移動が同じ位置に新しく出た要素
 * （名前の入力欄など）に入る。要素に直接付けたリスナーは、外れた後でも届く。
 */
function preventTouchEndOn(target: EventTarget | null): void {
  const t = target as { addEventListener?: (type: string, f: (e: Event) => void, opt?: AddEventListenerOptions) => void } | null;
  if (t === null || typeof t !== "object" || typeof t.addEventListener !== "function") return;
  t.addEventListener("touchend", (ev) => ev.preventDefault(), { once: true, passive: false });
}

// ---------------------------------------------------------------------------
// ステージ

export type StageInputOptions = {
  /** ステージの CSS 倍率（論理 1px あたりの CSS px） */
  scale(): number;
  /** タップの取り消しとスワイプの閾値（論理 px。settings.swipeThreshold） */
  threshold(): number;
  /** 非反応帯（論理 px。config.input.edgeDeadZonePx） */
  deadZone: number;
  /** ステージの論理幅（config.stage.width） */
  width: number;
  /** スワイプを受けるか（迷宮・overlay なし・保留なし・inputMode が buttons でない） */
  swipeEnabled(): boolean;
  /** 再生中か（whileBusy でない要素のタップは onBusyTap に回す） */
  busy(): boolean;
  /** 再生中のタップ（player.tap()） */
  onBusyTap(): void;
  /**
   * UI-47 / UI-66（2026-10-07 未定-19）: 再生の外で会話の箱が文送りを待っているか（▼ か続きの文がある）。
   * 真の間は、どの要素のタップ（whileBusy・キーボードの click も）も onTalkTap に回し、長押しも始めない。省略すると偽
   */
  talkWaits?(): boolean;
  /** talkWaits の間のタップ（会話の箱のタップ） */
  onTalkTap?(): void;
  /**
   * どこかを押した瞬間（入力欄の上を除く）。地図のタップ移動の自動歩行を止めるのに使う（UI-25）。
   * true を返したら、その押下は捨てる（タップ・スワイプ・長押し・押下の見た目のどれにもしない）
   */
  onAnyPress?(): boolean | void;
  onSwipe(a: Action): void;
  /** スワイプしていた指を離した（長押しの連打を止める） */
  onSwipeRelease(): void;
  /** debug パネル用。確定したときの CSS px の移動量と方向 */
  onDebugSwipe?(dx: number, dy: number, d: Dir): void;
};

type Ev = {
  pointerId: number;
  clientX: number;
  clientY: number;
  target: EventTarget | null;
  pointerType?: string;
  button?: number;
  isPrimary?: boolean;
};

/** attachStageInput の戻り値。呼ぶと外す。reset は追っている押下を「離した」として片付ける（タップにはしない） */
export type StageInput = (() => void) & { reset(): void };

/**
 * UI-36: stage で Pointer Events・click（キーボード由来だけ）・touchend を受ける。戻り値で外す。
 * 戻り値の reset() は、ページが隠れた・窓のフォーカスが外れたときに呼ぶ（pointerup / pointercancel が届かないことがある）
 */
export function attachStageInput(stage: HTMLElement, o: StageInputOptions): StageInput {
  let p: PressState = null;
  let spec: TapSpec | null = null;
  let holdTimer: ReturnType<typeof setTimeout> | null = null;

  const clearHold = (): void => {
    if (holdTimer !== null) clearTimeout(holdTimer);
    holdTimer = null;
  };

  /** 押下を終える（見た目と長押しの判定を片付ける） */
  const end = (): void => {
    clearHold();
    setPressed(p?.target ?? null, false);
    p = null;
    spec = null;
  };

  /** 入力欄にフォーカスがあれば外す */
  const blurInput = (): void => {
    const doc = (globalThis as { document?: Document }).document;
    const a = doc?.activeElement as (Element & { blur?: () => void }) | null | undefined;
    if (a !== null && a !== undefined && isTextInput(a) && typeof a.blur === "function") a.blur();
  };

  /** 未定-19: 会話の箱が文送りを待っているか */
  const talkWaits = (): boolean => o.talkWaits?.() === true;

  const fireTap = (pressed: NonNullable<PressState>, s: TapSpec | null): void => {
    if (talkWaits()) {
      o.onTalkTap?.();
      return;
    }
    if (o.busy() && s?.whileBusy !== true) {
      o.onBusyTap();
      return;
    }
    const el = pressed.target;
    if (s === null || el === null) return;
    // 押している間に描き直されて外れた要素は押さない
    if ((el as { isConnected?: boolean }).isConnected === false) return;
    const r = el.getBoundingClientRect();
    const sc = o.scale();
    s.onTap({ lx: (pressed.sx - r.left) / sc, ly: (pressed.sy - r.top) / sc });
  };

  /**
   * 追っている押下を「離した」として片付ける（長押しのタイマーも消す）。長押し中なら onHoldEnd、スワイプ中なら onSwipeRelease。
   * タップにはしない
   */
  const reset = (): void => {
    if (p === null) {
      clearHold();
      return;
    }
    const s = spec;
    const r = pressUp(p, p.id);
    end();
    if (r.holdEnd) s?.hold?.onHoldEnd();
    if (r.swipeEnd) o.onSwipeRelease();
  };

  const down = (e: Ev): void => {
    if (p !== null) {
      // 2 本目以降の指（isPrimary が偽）は追わない。isPrimary が真の押下が来たら、ほかに触れている指は無いので、
      // 前の押下は pointerup / pointercancel が届かなかった古いものとみなして片付け、新しい押下を受ける
      if (e.isPrimary !== true) return;
      reset();
    }
    if (e.isPrimary === false) return;
    if (e.pointerType === "mouse" && e.button !== undefined && e.button !== 0) return;
    if (isTextInput(e.target)) return;
    if (e.pointerType === "touch") preventTouchEndOn(e.target);
    blurInput();
    // UI-25: 自動歩行を止めた押下は、離しても何もしない（p を作らないので move / up も無視される）
    if (o.onAnyPress?.() === true) return;
    const target = closestTap(e.target);
    const lx = (e.clientX - stage.getBoundingClientRect().left) / o.scale();
    p = pressDown(e.pointerId, e.clientX, e.clientY, target, lx, o.width, o.deadZone);
    spec = tapSpecOf(target);
    setPressed(target, true);
    if (e.pointerType === "mouse") {
      try {
        stage.setPointerCapture(e.pointerId);
      } catch {
        // 取れなくても move はステージの上にある間は届く
      }
    }
    const hold = spec?.hold;
    if (hold !== undefined && !o.busy() && !talkWaits()) {
      const id = e.pointerId;
      holdTimer = setTimeout(() => {
        holdTimer = null;
        if (p === null || p.id !== id || p.moved) return;
        p = pressHold(p);
        hold.onHoldStart();
      }, hold.ms());
    }
  };

  const move = (e: Ev): void => {
    if (p === null || p.id !== e.pointerId) return;
    const before = p;
    const r = pressMove(p, e.pointerId, e.clientX, e.clientY, thresholdCss(o.threshold(), o.scale()), o.swipeEnabled());
    p = r.next;
    if (r.out.kind === "none") return;
    clearHold();
    setPressed(before.target, false);
    if (r.out.kind === "swipe") {
      o.onDebugSwipe?.(e.clientX - before.sx, e.clientY - before.sy, r.out.dir);
      o.onSwipe(swipeAction(r.out.dir));
    }
  };

  const up = (e: Ev): void => {
    if (p === null || p.id !== e.pointerId) return;
    const pressed = p;
    const s = spec;
    const r = pressUp(p, e.pointerId);
    end();
    if (r.holdEnd) s?.hold?.onHoldEnd();
    if (r.swipeEnd) o.onSwipeRelease();
    if (r.tap) fireTap(pressed, s);
  };

  /** pointercancel / lostpointercapture: 取り消し。ただしスワイプ中・長押し中なら「離した」として扱う */
  const cancel = (e: Ev): void => {
    if (p === null || p.id !== e.pointerId) return;
    const s = spec;
    const r = pressUp(p, e.pointerId);
    end();
    if (r.holdEnd) s?.hold?.onHoldEnd();
    if (r.swipeEnd) o.onSwipeRelease();
  };

  /** キーボードの Enter / Space で起きた click（detail 0）だけを onTap に回す。ポインタの click には反応しない */
  const click = (e: Ev & { detail?: number; preventDefault?: () => void }): void => {
    if (e.detail !== 0) return;
    // UI-25: 自動歩行中のキーボードの Enter（フォーカス中のボタン）も、歩行を止めるだけにする
    if (o.onAnyPress?.() === true) {
      e.preventDefault?.();
      return;
    }
    const el = closestTap(e.target);
    const s = tapSpecOf(el);
    if (el === null || s === null) return;
    e.preventDefault?.();
    if (talkWaits()) {
      o.onTalkTap?.();
      return;
    }
    if (o.busy() && s.whileBusy !== true) {
      o.onBusyTap();
      return;
    }
    s.onTap({ lx: 0, ly: 0 });
  };

  /** UI-37: 入力欄の上以外の touchend を止める（ダブルタップの拡大と、合成の click・フォーカス移動） */
  const touchend = (e: { target: EventTarget | null; preventDefault(): void }): void => {
    if (!isTextInput(e.target)) e.preventDefault();
  };

  const on = (f: (e: never) => void): EventListener => f as unknown as EventListener;
  const passiveFalse: AddEventListenerOptions = { passive: false };
  stage.addEventListener("pointerdown", on(down));
  stage.addEventListener("pointermove", on(move));
  stage.addEventListener("pointerup", on(up));
  stage.addEventListener("pointercancel", on(cancel));
  stage.addEventListener("lostpointercapture", on(cancel));
  stage.addEventListener("click", on(click));
  stage.addEventListener("touchend", on(touchend), passiveFalse);
  const detach = (): void => {
    end();
    stage.removeEventListener("pointerdown", on(down));
    stage.removeEventListener("pointermove", on(move));
    stage.removeEventListener("pointerup", on(up));
    stage.removeEventListener("pointercancel", on(cancel));
    stage.removeEventListener("lostpointercapture", on(cancel));
    stage.removeEventListener("click", on(click));
    stage.removeEventListener("touchend", on(touchend), passiveFalse);
  };
  return Object.assign(detach, { reset });
}
