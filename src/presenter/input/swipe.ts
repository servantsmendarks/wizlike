// UI-30〜34: スワイプの分類、長押しの連打、キーボード。入力を Action に変えるだけで、意味の解釈（前進できるか等）はしない（UI-35）。
// ポインタの押下・スワイプ・タップはステージ 1 か所で受ける（input/tap.ts の attachStageInput。UI-36）。
// 純粋な部分（分類・キー表・canRepeat・walkStep）を export して node 環境で試す。DOM に触れるのは attach* と createHoldRepeater の中だけ。
// setTimeout を使うのは長押しの連打（createHoldRepeater）だけ。
import type { GameEvent, PendingChoice, RouteCommand, RouteStep } from "../../core/types";

export type Dir = "up" | "down" | "left" | "right";
export type Action = "forward" | "left" | "right" | "around" | "map" | "back" | "confirm" | "debug" | { menu: number };

/**
 * UI-30: 閾値は論理 px で持ち、PointerEvent の座標（CSS px）と比べるためにステージの CSS 倍率を掛ける。
 * （仕様の「端末 px に換算」は CSS px と読む。decisions 参照）
 */
export function thresholdCss(thresholdLogical: number, scale: number): number {
  return thresholdLogical * scale;
}

/** UI-30: max(|dx|,|dy|) が thr 以上で方向を確定する。主軸は大きい方で、同値なら縦。画面座標なので dy < 0 が上 */
export function classifySwipe(dx: number, dy: number, thr: number): Dir | null {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (!(Math.max(ax, ay) >= thr)) return null;
  if (ay >= ax) return dy < 0 ? "up" : "down";
  return dx < 0 ? "left" : "right";
}

/** UI-30: 上 = 前進、下 = 反転、左右 = 指を動かした方へ旋回【仮】 */
export function swipeAction(d: Dir): Action {
  switch (d) {
    case "up":
      return "forward";
    case "down":
      return "around";
    case "left":
      return "left";
    case "right":
      return "right";
  }
}

/** UI-34: ステージの左右の端から dead 論理 px は非反応帯（境界ちょうどは反応する。スワイプの起点だけに効く） */
export function inDeadZone(lx: number, width: number, dead: number): boolean {
  return lx < dead || lx > width - dead;
}

const KEY_TABLE: Readonly<Record<string, Action>> = {
  ArrowUp: "forward",
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowDown: "around",
  Enter: "confirm",
  " ": "confirm",
  Escape: "back",
  m: "map",
  M: "map",
  F2: "debug",
};

/** UI-33: キー → Action。押しっぱなしの自動リピートと、入力欄の上のキーは null */
export function keyToAction(key: string, repeat: boolean, onInput: boolean): Action | null {
  if (repeat || onInput) return null;
  if (/^[1-9]$/.test(key)) return { menu: Number(key) - 1 };
  return Object.prototype.hasOwnProperty.call(KEY_TABLE, key) ? (KEY_TABLE[key] ?? null) : null;
}

/**
 * UI-31: 連打を続けてよいか。直前の前進のイベントが moved で始まり、その後ろが hpChanged だけ（迷宮の毒の 1 歩。CH-43）で、
 * 選択の保留も overlay も無いときだけ。壁（blocked）、扉・階段・罠の message、遭遇（screen など）は余計なイベントを伴うので止まる。
 */
export function canRepeat(events: readonly GameEvent[], pending: PendingChoice | null, overlayOpen: boolean): boolean {
  return (
    events[0]?.kind === "moved" && events.slice(1).every((e) => e.kind === "hpChanged") && pending === null && !overlayOpen
  );
}

/**
 * UI-33 / UI-54: 戦闘中のキー（Action）→ 選ぶもの。grid はパーティの選択・メンバーの枠、list は呪文・道具の一覧、
 * target は対象の一覧、autoStop はオート中の「オート解除」だけの画面。数字 n は n−1 番目、Enter は 0 番目、Esc は戻る。
 * target では ↑ が "up"、↓ が "down"（注目を動かす）、Enter が "focused"（注目している項目を選ぶ）。
 * autoStop では Esc / Enter / 1 が "stop"。それ以外の矢印・地図・debug などは null（呼び出し側が別に扱う）
 */
export function battleKeyChoice(
  a: Action,
  mode: "grid" | "list" | "target" | "autoStop",
): number | "back" | "stop" | "up" | "down" | "focused" | null {
  if (mode === "autoStop") {
    if (a === "back" || a === "confirm" || (typeof a === "object" && a.menu === 0)) return "stop";
    return null;
  }
  if (typeof a === "object") return a.menu;
  if (mode === "target") {
    if (a === "forward") return "up";
    if (a === "around") return "down";
    if (a === "confirm") return "focused";
  }
  if (a === "confirm") return 0;
  if (a === "back") return "back";
  return null;
}

/**
 * UI-31: 長押しの 1 歩（createHoldRepeater の fire）。ready が偽なら送らずに止まる。move は run の門を通した dungeon.move で、
 * 門に捨てられた（null）・rejected・canRepeat が偽なら false（止まる）を返す。app.ts の結線をここに切り出して node で試す。
 */
export async function forwardStep(o: {
  ready(): boolean;
  move(): Promise<{ events: readonly GameEvent[]; rejected: boolean } | null>;
  pending(): PendingChoice | null;
  overlayOpen(): boolean;
}): Promise<boolean> {
  if (!o.ready()) return false;
  const r = await o.move();
  if (r === null || r.rejected) return false;
  return canRepeat(r.events, o.pending(), o.overlayOpen());
}

/** UI-25: 地図のタップ移動の自動歩行。steps は core の planRoute の結果、i は次に送る手の添字 */
export type RouteWalk = { steps: readonly RouteStep[]; i: number };

/**
 * UI-25: 自動歩行の 1 手（createHoldRepeater の fire）。次も続けるなら true。
 * - 今の歩行（walk()）が無いか、ready が偽（迷宮・overlay なし・保留なしでない）なら送らずに false
 * - 送った後に歩行が止められていた（walk() が別物）なら false
 * - 門に捨てられた（null）・rejected・ok（core の routeStepOk）が偽なら false
 * - そうでなければ i を進め、まだ手が残っていれば true（最後の手を送り終えたら false）
 * 続けてよいかの判定は ok（core）に任せ、ここでは event の中身を見ない（§3-4）
 */
export async function walkStep(o: {
  walk(): RouteWalk | null;
  ready(): boolean;
  send(cmd: RouteCommand): Promise<{ events: readonly GameEvent[]; rejected: boolean } | null>;
  ok(step: RouteStep, events: readonly GameEvent[]): boolean;
}): Promise<boolean> {
  const w = o.walk();
  if (w === null || !o.ready()) return false;
  const s = w.steps[w.i];
  if (s === undefined) return false;
  const r = await o.send(s.command);
  if (o.walk() !== w) return false;
  if (r === null || r.rejected || !o.ok(s, r.events)) return false;
  w.i++;
  return w.i < w.steps.length;
}

// ---------------------------------------------------------------------------
// DOM（呼ばれたときだけ触れる）

function isTextInput(target: EventTarget | null): boolean {
  if (target === null || typeof (target as { tagName?: unknown }).tagName !== "string") return false;
  const el = target as HTMLElement;
  const tag = el.tagName.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true;
}

/**
 * Enter を既定の click に任せるボタンか。button か role=button で、タブ順から外していない（tabIndex >= 0）もの。
 * 十字ボタンは click に意味が無く矢印キーと重複するので tabIndex -1 にしてあり、その上の Enter は従来どおり confirm にする。
 */
function isButton(target: EventTarget | null): boolean {
  if (target === null || typeof (target as { tagName?: unknown }).tagName !== "string") return false;
  const el = target as HTMLElement;
  if (typeof el.tabIndex === "number" && el.tabIndex < 0) return false;
  return el.tagName.toUpperCase() === "BUTTON" || (typeof el.getAttribute === "function" && el.getAttribute("role") === "button");
}

function sameAction(a: Action, b: Action): boolean {
  if (typeof a === "string" || typeof b === "string") return a === b;
  return a.menu === b.menu;
}

export type KeyboardOptions = {
  onAction(a: Action): void;
  /** 押していたキーを離した。窓のフォーカスが外れた・タブが隠れたときは、押したままのキーすべてについて呼ぶ */
  onRelease(a: Action): void;
};

/** UI-33: window の keydown / keyup。処理したキーは preventDefault する（自動リピートも既定動作だけ止める） */
export function attachKeyboard(o: KeyboardOptions): () => void {
  const held: Action[] = [];

  const releaseAll = (): void => {
    const list = held.splice(0);
    for (const a of list) o.onRelease(a);
  };

  const keydown = (e: KeyboardEvent): void => {
    // フォーカス中のボタンの Enter は既定動作（click）に任せる。変換も preventDefault もしない
    if (e.key === "Enter" && isButton(e.target)) return;
    const onInput = isTextInput(e.target);
    const base = keyToAction(e.key, false, onInput);
    if (base === null) return;
    e.preventDefault();
    if (keyToAction(e.key, e.repeat, onInput) === null) return;
    if (!held.some((h) => sameAction(h, base))) held.push(base);
    o.onAction(base);
  };

  const keyup = (e: KeyboardEvent): void => {
    const a = keyToAction(e.key, false, false);
    if (a === null) return;
    const i = held.findIndex((h) => sameAction(h, a));
    if (i < 0) return;
    held.splice(i, 1);
    o.onRelease(a);
  };

  const visibility = (): void => {
    if (document.visibilityState === "hidden") releaseAll();
  };

  window.addEventListener("keydown", keydown);
  window.addEventListener("keyup", keyup);
  window.addEventListener("blur", releaseAll);
  document.addEventListener("visibilitychange", visibility);
  return () => {
    window.removeEventListener("keydown", keydown);
    window.removeEventListener("keyup", keyup);
    window.removeEventListener("blur", releaseAll);
    document.removeEventListener("visibilitychange", visibility);
  };
}

/**
 * UI-31: 窓のフォーカスが外れた（window の blur）・ページが隠れた（pagehide、visibilitychange で hidden）ときに
 * onRelease を呼ぶ。ポインタの長押しは指を置いたままアプリを切り替えると pointercancel が届かないことがあるため。
 */
export function attachReleaseOnHide(onRelease: () => void): () => void {
  const release = (): void => onRelease();
  const visibility = (): void => {
    if (document.visibilityState === "hidden") onRelease();
  };
  window.addEventListener("blur", release);
  window.addEventListener("pagehide", release);
  document.addEventListener("visibilitychange", visibility);
  return () => {
    window.removeEventListener("blur", release);
    window.removeEventListener("pagehide", release);
    document.removeEventListener("visibilitychange", visibility);
  };
}

export type HoldRepeater = { press(): void; release(): void };

/**
 * UI-31: 前進の長押し。press で fire を 1 回呼び、その再生が終わって true が返り、まだ押されていれば
 * ms() 待ってから次の fire を呼ぶ（待ちは再生の終わりから数える）。false が返るか release で止まる。
 * fire の途中でもう一度 press されたら、同じ連打を続ける（二重に fire しない）。
 * fire が false で止まった（壁・扉・遭遇など）ときにまだ押されていれば、release まではその長押しの続きとみなし、
 * 重ねて届く press（2 本目の指、スワイプと十字ボタンの併用、repeat が偽で届くキーの自動リピートなど）を無視する。
 * 同じ長押しの中で壁に当たり直して「壁だ。」が何度も出ないようにするため。離して押し直せば新しい長押しとして動く。
 */
export function createHoldRepeater(o: { ms(): number; fire(): Promise<boolean> }): HoldRepeater {
  let pressed = false;
  let running = false;
  /** fire が false で止まった後、まだ release されていない（同じ長押しの続き） */
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let wake: (() => void) | null = null;

  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      wake = resolve;
      timer = setTimeout(() => {
        timer = null;
        wake = null;
        resolve();
      }, ms);
    });

  const loop = async (): Promise<void> => {
    running = true;
    try {
      while (pressed) {
        let ok = false;
        try {
          ok = await o.fire();
        } catch {
          ok = false;
        }
        if (!ok && pressed) stopped = true;
        if (!ok || !pressed) break;
        await sleep(o.ms());
      }
    } finally {
      running = false;
      pressed = false;
    }
  };

  return {
    press(): void {
      if (stopped) return;
      pressed = true;
      if (!running) void loop();
    },
    release(): void {
      pressed = false;
      stopped = false;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      const w = wake;
      wake = null;
      w?.();
    },
  };
}
