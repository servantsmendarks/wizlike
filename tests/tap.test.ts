// UI-36 / UI-30 / UI-34 / UI-37: ステージ全体の入力（input/tap.ts）。純粋な押下の状態機械と、偽の DOM での attachStageInput、
// style.css の touch-action の文字列検査。
import { afterEach, describe, expect, test, vi } from "vitest";
import { thresholdCss } from "../src/presenter/input/swipe";
import {
  attachStageInput,
  isTextInput,
  onTap,
  pressDown,
  pressHold,
  pressMove,
  pressUp,
  tapSpecOf,
  type StageInputOptions,
  type TapPoint,
} from "../src/presenter/input/tap";
import { data } from "./helpers/core";
import { FakeNode, FakeStage } from "./helpers/dom";

const W = data.config.stage.width;
const DEAD = data.config.input.edgeDeadZonePx;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("押下の状態機械（純粋）", () => {
  test("UI-36 閾値未満の移動で離すとタップ。閾値を越えたら取り消し（スワイプを受けないとき）。別の id の move / up は無視する", () => {
    let p = pressDown(1, 100, 100, null, 50, W, DEAD);
    expect(p).toEqual({ id: 1, sx: 100, sy: 100, target: null, moved: false, swiped: null, inDeadZone: false, held: false });
    // 閾値 28 未満（27.9）では何も起きない
    let r = pressMove(p, 1, 127.9, 100, 28, false);
    expect(r.out).toEqual({ kind: "none" });
    expect(r.next).toBe(p);
    expect(pressUp(p, 1)).toEqual({ next: null, tap: true, holdEnd: false, swipeEnd: false });
    // 別の id は無視
    r = pressMove(p, 2, 300, 300, 28, false);
    expect(r).toEqual({ next: p, out: { kind: "none" } });
    expect(pressUp(p, 2)).toEqual({ next: p, tap: false, holdEnd: false, swipeEnd: false });
    // 閾値ちょうどで取り消し
    r = pressMove(p, 1, 100, 128, 28, false);
    expect(r.out).toEqual({ kind: "cancel" });
    p = r.next;
    expect(p?.moved).toBe(true);
    // 取り消した後は何も返さず、離してもタップにしない
    expect(pressMove(p, 1, 100, 400, 28, true).out).toEqual({ kind: "none" });
    expect(pressUp(p, 1)).toEqual({ next: null, tap: false, holdEnd: false, swipeEnd: false });
  });

  test("UI-30 スワイプを受けるなら、閾値を越えた瞬間に主軸の方向で 1 回だけ swipe（同値なら縦）。離すと swipeEnd でタップにはしない", () => {
    let p = pressDown(1, 100, 100, null, 50, W, DEAD);
    let r = pressMove(p, 1, 130, 69, 31, true); // dx 30, dy -31 → up
    expect(r.out).toEqual({ kind: "swipe", dir: "up" });
    p = r.next;
    expect(p?.swiped).toBe("up");
    // 確定後は向きを変えても再発火しない
    expect(pressMove(p, 1, 0, 300, 31, true).out).toEqual({ kind: "none" });
    expect(pressUp(p, 1)).toEqual({ next: null, tap: false, holdEnd: false, swipeEnd: true });
    // |dx| = |dy| は縦
    expect(pressMove(pressDown(1, 0, 0, null, 50, W, DEAD), 1, -40, 40, 28, true).out).toEqual({ kind: "swipe", dir: "down" });
    expect(pressMove(pressDown(1, 0, 0, null, 50, W, DEAD), 1, -41, 40, 28, true).out).toEqual({ kind: "swipe", dir: "left" });
    // スワイプを受けないなら取り消し
    expect(pressMove(pressDown(1, 0, 0, null, 50, W, DEAD), 1, 0, -40, 28, false).out).toEqual({ kind: "cancel" });
  });

  test("UI-34 非反応帯（論理 x < 12 か > 228）で始まった押下はスワイプしないが、動かずに離せばタップ。境界ちょうどは反応する", () => {
    for (const lx of [0, 11.9, 228.1, 239]) {
      const p = pressDown(1, 0, 0, null, lx, W, DEAD);
      expect(p?.inDeadZone, String(lx)).toBe(true);
      expect(pressMove(p, 1, 0, -40, 28, true).out, String(lx)).toEqual({ kind: "cancel" });
      expect(pressUp(p, 1).tap, String(lx)).toBe(true);
    }
    for (const lx of [12, 228]) {
      const p = pressDown(1, 0, 0, null, lx, W, DEAD);
      expect(p?.inDeadZone, String(lx)).toBe(false);
      expect(pressMove(p, 1, 0, -40, 28, true).out, String(lx)).toEqual({ kind: "swipe", dir: "up" });
    }
  });

  test("UI-31/UI-36 長押しが始まった後の離しはタップにせず holdEnd。長押し中の移動はスワイプにしない（取り消しだけで holdEnd は残る）", () => {
    let p = pressHold(pressDown(1, 0, 0, null, 50, W, DEAD));
    expect(p?.held).toBe(true);
    expect(pressUp(p, 1)).toEqual({ next: null, tap: false, holdEnd: true, swipeEnd: false });
    const r = pressMove(p, 1, 0, -50, 28, true);
    expect(r.out).toEqual({ kind: "cancel" });
    p = r.next;
    expect(pressUp(p, 1)).toEqual({ next: null, tap: false, holdEnd: true, swipeEnd: false });
    // 動いた後には長押しにならない
    const moved = pressMove(pressDown(1, 0, 0, null, 50, W, DEAD), 1, 0, 50, 28, false).next;
    expect(pressHold(moved)).toBe(moved);
    expect(pressHold(null)).toBeNull();
  });

  test("UI-36 isTextInput: INPUT / TEXTAREA / SELECT / contenteditable", () => {
    expect(isTextInput({ tagName: "input" })).toBe(true);
    expect(isTextInput({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTextInput({ tagName: "SELECT" })).toBe(true);
    expect(isTextInput({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isTextInput({ tagName: "BUTTON" })).toBe(false);
    expect(isTextInput(null)).toBe(false);
    expect(isTextInput("INPUT")).toBe(false);
  });
});

// ---------------------------------------------------------------- attachStageInput（偽の DOM）

function setup(over: Partial<StageInputOptions> = {}, scale = 2) {
  const stage = new FakeStage(10);
  const out: string[] = [];
  let busy = false;
  let swipe = true;
  const o: StageInputOptions = {
    scale: () => scale,
    threshold: () => 28,
    deadZone: DEAD,
    width: W,
    swipeEnabled: () => swipe,
    busy: () => busy,
    onBusyTap: () => out.push("busyTap"),
    onAnyPress: () => {
      out.push("press");
    },
    onSwipe: (a) => out.push(`swipe ${JSON.stringify(a)}`),
    onSwipeRelease: () => out.push("swipeRelease"),
    onDebugSwipe: (dx, dy, d) => out.push(`debug ${dx},${dy},${d}`),
    ...over,
  };
  const detach = attachStageInput(stage as unknown as HTMLElement, o);
  /** 押せるボタン（中に子の span を持つ） */
  const button = (name: string, spec?: Parameters<typeof onTap>[1]): { btn: FakeNode; inner: FakeNode } => {
    const btn = new FakeNode("BUTTON", stage);
    btn.left = 20;
    btn.top = 600;
    onTap(btn as unknown as Element, spec ?? ((p: TapPoint) => out.push(`tap ${name} ${p.lx},${p.ly}`)));
    return { btn, inner: new FakeNode("SPAN", btn) };
  };
  const down = (id: number, x: number, y: number, target: FakeNode, extra: object = {}) =>
    stage.emit("pointerdown", { pointerId: id, clientX: x, clientY: y, target, pointerType: "touch", ...extra });
  const move = (id: number, x: number, y: number, target: FakeNode = stage) => stage.emit("pointermove", { pointerId: id, clientX: x, clientY: y, target });
  const up = (id: number, x: number, y: number, target: FakeNode = stage) => stage.emit("pointerup", { pointerId: id, clientX: x, clientY: y, target });
  return {
    stage,
    out,
    detach,
    button,
    down,
    move,
    up,
    setBusy: (b: boolean) => {
      busy = b;
    },
    setSwipe: (b: boolean) => {
      swipe = b;
    },
  };
}

describe("attachStageInput", () => {
  test("UI-36 動かずに離すと、押した要素（closest [data-tap]）の onTap を要素の左上からの論理 px で呼ぶ。押している間だけ is-pressed", () => {
    const t = setup();
    const a = t.button("a");
    // 子の span の上で押す。(40, 620) は要素の左上 (20, 600) から CSS 20px → 論理 10px（scale 2）
    t.down(1, 40, 620, a.inner);
    expect(a.btn.classList.contains("is-pressed")).toBe(true);
    t.move(1, 50, 620); // CSS 10px < 56（28 × 2）
    t.up(1, 50, 620);
    expect(a.btn.classList.contains("is-pressed")).toBe(false);
    expect(t.out).toEqual(["press", "tap a 10,10"]);
    // 押せないところは何もしない（押した瞬間の onAnyPress だけ）
    t.out.length = 0;
    t.down(2, 100, 100, t.stage);
    t.up(2, 100, 100);
    expect(t.out).toEqual(["press"]);
  });

  test("UI-36 閾値（論理 28 × CSS 倍率）以上動いたらタップを取り消す。スワイプを受けない画面ではスワイプにもならない", () => {
    const t = setup();
    t.setSwipe(false);
    const a = t.button("a");
    t.down(1, 40, 620, a.btn);
    t.move(1, 40, 620 - thresholdCss(28, 2)); // 56 CSS px
    expect(a.btn.classList.contains("is-pressed")).toBe(false);
    t.up(1, 40, 500);
    expect(t.out).toEqual(["press"]);
  });

  test("UI-30 スワイプを受ける間は、ボタンの上で始まっても閾値を越えた瞬間に 1 回だけスワイプにし、ボタンは反応しない。離すと onSwipeRelease", () => {
    const t = setup();
    const a = t.button("a");
    // 論理 x = (40 - 10) / 2 = 15（非反応帯の外）
    t.down(1, 40, 620, a.btn);
    t.move(1, 41, 565); // dy -55 < 56
    expect(t.out).toEqual(["press"]);
    t.move(1, 42, 564); // dy -56
    t.move(1, 42, 300);
    t.up(1, 42, 300);
    expect(t.out).toEqual(["press", "debug 2,-56,up", 'swipe "forward"', "swipeRelease"]);
  });

  test("UI-34 ステージの左右 12 論理 px で始まった押下はスワイプしない（タップは通す）。境界ちょうどは反応する", () => {
    const t = setup();
    const a = t.button("a");
    // 論理 x = (33 - 10) / 2 = 11.5
    t.down(1, 33, 620, a.btn);
    t.move(1, 33, 500);
    t.up(1, 33, 500);
    expect(t.out).toEqual(["press"]);
    // 非反応帯の中でも、動かずに離せばタップ（要素の左上 (20,600) から CSS 13px → 論理 6.5）
    t.out.length = 0;
    t.down(2, 33, 620, a.btn);
    t.up(2, 33, 620);
    expect(t.out).toEqual(["press", "tap a 6.5,10"]);
    // 論理 x = (467 - 10) / 2 = 228.5 は非反応帯、(466 - 10) / 2 = 228 は反応する
    t.out.length = 0;
    t.down(3, 467, 300, t.stage);
    t.move(3, 467, 200);
    t.up(3, 467, 200);
    t.down(4, 466, 300, t.stage);
    t.move(4, 466, 200);
    t.up(4, 466, 200);
    expect(t.out).toEqual(["press", "press", "debug 0,-100,up", 'swipe "forward"', "swipeRelease"]);
  });

  test("UI-44/UI-45 再生中のタップは whileBusy の要素（オート解除）以外すべて onBusyTap。押せないところも同じ", () => {
    const t = setup();
    const a = t.button("a");
    const stop = t.button("stop", { onTap: () => t.out.push("stop"), whileBusy: true });
    t.setBusy(true);
    t.down(1, 40, 620, a.btn);
    t.up(1, 40, 620);
    t.down(2, 40, 620, stop.inner);
    t.up(2, 40, 620);
    t.down(3, 100, 100, t.stage);
    t.up(3, 100, 100);
    expect(t.out).toEqual(["press", "busyTap", "press", "stop", "press", "busyTap"]);
    // 再生中でもスワイプは onSwipe に渡す（受けるかは呼び出し側の swipeEnabled と handleAction が決める）
    t.out.length = 0;
    t.down(4, 100, 300, t.stage);
    t.move(4, 100, 200);
    t.up(4, 100, 200);
    expect(t.out).toEqual(["press", "debug 0,-100,up", 'swipe "forward"', "swipeRelease"]);
  });

  test("UI-31 前進ボタン（hold）: 短く離すと onTap だけ。動かずに ms() 押し続けると onHoldStart、離すと onHoldEnd（onTap は呼ばない）。再生中に押したら長押しにしない", () => {
    vi.useFakeTimers();
    const t = setup();
    const fwd = t.button("fwd", {
      onTap: () => t.out.push("tap"),
      hold: { ms: () => 250, onHoldStart: () => t.out.push("holdStart"), onHoldEnd: () => t.out.push("holdEnd") },
    });
    t.down(1, 40, 620, fwd.btn);
    vi.advanceTimersByTime(249);
    t.up(1, 40, 620);
    vi.advanceTimersByTime(1000);
    expect(t.out).toEqual(["press", "tap"]);
    t.out.length = 0;
    t.down(2, 40, 620, fwd.btn);
    vi.advanceTimersByTime(250);
    expect(t.out).toEqual(["press", "holdStart"]);
    // 長押し中に動いてもスワイプにしない。離すと holdEnd
    t.move(2, 40, 400);
    t.up(2, 40, 400);
    expect(t.out).toEqual(["press", "holdStart", "holdEnd"]);
    // 動いたら長押しにならない
    t.out.length = 0;
    t.setSwipe(false);
    t.down(3, 40, 620, fwd.btn);
    t.move(3, 40, 500);
    vi.advanceTimersByTime(1000);
    t.up(3, 40, 500);
    expect(t.out).toEqual(["press"]);
    // 再生中に押したら長押しを始めない（離せば busyTap）
    t.out.length = 0;
    t.setBusy(true);
    t.down(4, 40, 620, fwd.btn);
    vi.advanceTimersByTime(1000);
    t.up(4, 40, 620);
    expect(t.out).toEqual(["press", "busyTap"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("UI-36 pointercancel / lostpointercapture は取り消し。ただしスワイプ中・長押し中なら離したものとして扱う", () => {
    vi.useFakeTimers();
    const t = setup();
    const fwd = t.button("fwd", {
      onTap: () => t.out.push("tap"),
      hold: { ms: () => 250, onHoldStart: () => t.out.push("holdStart"), onHoldEnd: () => t.out.push("holdEnd") },
    });
    t.down(1, 40, 620, fwd.btn);
    t.stage.emit("pointercancel", { pointerId: 1 });
    t.up(1, 40, 620);
    expect(t.out).toEqual(["press"]);
    t.out.length = 0;
    t.down(2, 40, 620, fwd.btn);
    vi.advanceTimersByTime(300);
    t.stage.emit("lostpointercapture", { pointerId: 2 });
    expect(t.out).toEqual(["press", "holdStart", "holdEnd"]);
    t.out.length = 0;
    t.down(3, 100, 300, t.stage);
    t.move(3, 100, 200);
    t.stage.emit("pointercancel", { pointerId: 3 });
    expect(t.out).toEqual(["press", "debug 0,-100,up", 'swipe "forward"', "swipeRelease"]);
  });

  test("UI-36 pointerup / pointercancel が届かなかった押下は、次の isPrimary の押下で古いものとして片付ける（2 本目の指 isPrimary:false は従来どおり無視）", () => {
    const t = setup();
    const a = t.button("a");
    t.down(1, 40, 620, a.btn, { isPrimary: true });
    expect(a.btn.classList.contains("is-pressed")).toBe(true);
    // id 1 の up は来ないまま、別の指の押下が続く
    t.down(2, 40, 620, a.btn, { isPrimary: false });
    t.up(2, 40, 620);
    expect(t.out).toEqual(["press"]);
    for (const id of [3, 4]) {
      t.down(id, 40, 620, a.btn, { isPrimary: true });
      t.up(id, 40, 620);
    }
    expect(t.out).toEqual(["press", "press", "tap a 10,10", "press", "tap a 10,10"]);
    expect(a.btn.classList.contains("is-pressed")).toBe(false);
    // 古い押下の up が後から来ても何もしない
    t.up(1, 40, 620);
    expect(t.out).toHaveLength(5);
  });

  test("UI-31/UI-36 reset(): 長押しの前ならタイマーを消して onHoldStart を呼ばない。長押し中なら onHoldEnd、スワイプ中なら onSwipeRelease。タップにはしない", () => {
    vi.useFakeTimers();
    const t = setup();
    const fwd = t.button("fwd", {
      onTap: () => t.out.push("tap"),
      hold: { ms: () => 250, onHoldStart: () => t.out.push("holdStart"), onHoldEnd: () => t.out.push("holdEnd") },
    });
    // 押して 100ms でページが隠れた
    t.down(1, 40, 620, fwd.btn);
    vi.advanceTimersByTime(100);
    t.detach.reset();
    vi.advanceTimersByTime(1000);
    t.up(1, 40, 620);
    expect(t.out).toEqual(["press"]);
    expect(fwd.btn.classList.contains("is-pressed")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    // 長押し中
    t.out.length = 0;
    t.down(2, 40, 620, fwd.btn);
    vi.advanceTimersByTime(300);
    t.detach.reset();
    t.up(2, 40, 620);
    expect(t.out).toEqual(["press", "holdStart", "holdEnd"]);
    // スワイプ中
    t.out.length = 0;
    t.down(3, 100, 300, t.stage);
    t.move(3, 100, 200);
    t.detach.reset();
    t.up(3, 100, 200);
    expect(t.out).toEqual(["press", "debug 0,-100,up", 'swipe "forward"', "swipeRelease"]);
    // 押下が無ければ何もしない。その後の押下は普通に受ける
    t.out.length = 0;
    t.detach.reset();
    t.down(4, 40, 620, fwd.btn);
    t.up(4, 40, 620);
    expect(t.out).toEqual(["press", "tap"]);
  });

  test("UI-36 2 本目の指・主ボタン以外のマウスは追わない。ポインタの捕捉はマウスのときだけ取る", () => {
    const t = setup();
    const a = t.button("a");
    t.down(1, 40, 620, a.btn);
    t.down(2, 40, 620, a.btn, { isPrimary: false });
    t.up(2, 40, 620);
    expect(t.out).toEqual(["press"]);
    t.up(1, 40, 620);
    expect(t.out).toEqual(["press", "tap a 10,10"]);
    expect(t.stage.captured).toEqual([]);
    t.out.length = 0;
    t.down(3, 40, 620, a.btn, { pointerType: "mouse", button: 2 });
    t.up(3, 40, 620);
    expect(t.out).toEqual([]);
    t.down(4, 40, 620, a.btn, { pointerType: "mouse", button: 0 });
    t.up(4, 40, 620);
    expect(t.out).toEqual(["press", "tap a 10,10"]);
    expect(t.stage.captured).toEqual([4]);
  });

  test("UI-36 押している間に描き直されて外れた要素（isConnected 偽）は押さない", () => {
    const t = setup();
    const a = t.button("a");
    t.down(1, 40, 620, a.btn);
    a.btn.isConnected = false;
    t.up(1, 40, 620);
    expect(t.out).toEqual(["press"]);
  });

  test("UI-36 click はキーボード由来（detail 0）だけを onTap に回す。ポインタの click（detail 1 以上）には反応しない", () => {
    const t = setup();
    const a = t.button("a");
    t.stage.emit("click", { detail: 1, target: a.inner });
    expect(t.out).toEqual([]);
    // キーボード由来の click も onAnyPress を先に呼ぶ（UI-25: 自動歩行を止める）
    const r = t.stage.emit("click", { detail: 0, target: a.inner });
    expect(r.prevented).toBe(true);
    expect(t.out).toEqual(["press", "tap a 0,0"]);
    t.setBusy(true);
    t.stage.emit("click", { detail: 0, target: a.btn });
    expect(t.out).toEqual(["press", "tap a 0,0", "press", "busyTap"]);
    // 押せないところの click は何もしない
    t.stage.emit("click", { detail: 0, target: t.stage });
    expect(t.out).toEqual(["press", "tap a 0,0", "press", "busyTap", "press"]);
  });

  test("UI-25 onAnyPress が true を返した押下（自動歩行を止めた押下）は捨てる: タップ・スワイプ・長押し・押下の見た目・再生中のタップのどれにもしない。キーボード由来の click も同じ", () => {
    let walking = true;
    const t = setup({
      onAnyPress: () => {
        if (!walking) return false;
        walking = false;
        return true;
      },
    });
    const a = t.button("a");
    // タップ（動かずに離す）
    t.down(1, 40, 620, a.inner);
    expect(a.btn.classList.contains("is-pressed")).toBe(false);
    t.up(1, 40, 620);
    expect(t.out).toEqual([]);
    // スワイプ（閾値を越える）
    walking = true;
    t.down(2, 40, 620, a.btn);
    t.move(2, 40, 300);
    t.up(2, 40, 300);
    expect(t.out).toEqual([]);
    // 再生中のタップ
    walking = true;
    t.setBusy(true);
    t.down(3, 40, 620, a.btn);
    t.up(3, 40, 620);
    expect(t.out).toEqual([]);
    t.setBusy(false);
    // キーボード由来の click
    walking = true;
    const r = t.stage.emit("click", { detail: 0, target: a.btn });
    expect(r.prevented).toBe(true);
    expect(t.out).toEqual([]);
    // 歩いていなければ、次の押下は普通のタップ
    t.down(4, 40, 620, a.inner);
    t.up(4, 40, 620);
    expect(t.out).toEqual(["tap a 10,10"]);
  });

  test("UI-37/UI-51 touchend は入力欄の上以外で preventDefault（passive:false）。入力欄の上の押下は追わず、入力欄の外を押したらフォーカスを外す", () => {
    const t = setup();
    const a = t.button("a");
    const input = new FakeNode("INPUT", t.stage);
    expect(t.stage.listeners["touchend"]?.[0]?.opt).toEqual({ passive: false });
    expect(t.stage.emit("touchend", { target: a.btn }).prevented).toBe(true);
    expect(t.stage.emit("touchend", { target: t.stage }).prevented).toBe(true);
    expect(t.stage.emit("touchend", { target: input }).prevented).toBe(false);
    // 入力欄の上の押下は追わない（onAnyPress も呼ばない）
    t.down(1, 40, 620, input);
    t.up(1, 40, 620);
    expect(t.out).toEqual([]);
    // 入力欄にフォーカスがあるときに外を押すと blur
    vi.stubGlobal("document", { activeElement: input });
    t.down(2, 40, 620, a.btn);
    expect(input.blurred).toBe(1);
    t.up(2, 40, 620);
    expect(t.out).toEqual(["press", "tap a 10,10"]);
    // ボタンにフォーカスがあるときは何もしない
    const other = new FakeNode("BUTTON", t.stage);
    vi.stubGlobal("document", { activeElement: other });
    t.down(3, 40, 620, a.btn);
    t.up(3, 40, 620);
    expect(other.blurred).toBe(0);
  });

  test("UI-36 onTap は data-tap を付けて spec を登録し、関数だけでも登録できる。detach で全リスナーが外れる", () => {
    const el = new FakeNode("DIV");
    const f = (): void => {};
    onTap(el as unknown as Element, f);
    expect(el.getAttribute("data-tap")).toBe("");
    expect(tapSpecOf(el)?.onTap).toBe(f);
    expect(tapSpecOf(new FakeNode("DIV"))).toBeNull();
    const t = setup();
    expect(Object.keys(t.stage.listeners).sort()).toEqual(["click", "lostpointercapture", "pointercancel", "pointerdown", "pointermove", "pointerup", "touchend"]);
    expect(t.stage.count()).toBe(7);
    t.detach();
    expect(t.stage.count()).toBe(0);
  });
});

// vitest は CSS の import（?raw を含む）を空にするので、node の fs で読む（@types/node は入れていないので型は手で書く）
const FS_MODULE = "node:fs";
const fs = (await import(/* @vite-ignore */ FS_MODULE)) as { readFileSync(p: URL, enc: "utf8"): string };
const STYLE_CSS = fs.readFileSync(new URL("../src/presenter/style.css", import.meta.url), "utf8");

describe("UI-37 style.css の touch-action", () => {
  const css = STYLE_CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  /** セレクタ（カンマ区切りの 1 つ）→ その規則の本文。同じセレクタが複数あれば連結 */
  const rules = new Map<string, string>();
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const sel of m[1]!.split(",").map((x: string) => x.trim().replace(/\s+/g, " "))) rules.set(sel, `${rules.get(sel) ?? ""}${m[2]!}`);
  }
  const touch = (sel: string): string | null => /touch-action:\s*([a-z-]+)/.exec(rules.get(sel) ?? "")?.[1] ?? null;

  test("UI-11/UI-37 #stage 以下は manipulation、迷宮でスワイプを受ける間（.screen-play.swipe-on）は none、スクロールの容器は pan-y。body の none（UI-05）は残す", () => {
    expect(touch("body")).toBe("none");
    expect(touch("#stage")).toBe("manipulation");
    expect(touch("#stage *")).toBe("manipulation");
    expect(touch("#stage .screen-play.swipe-on")).toBe("none");
    expect(touch("#stage .screen-play.swipe-on *")).toBe("none");
    for (const c of ["controls-list", "history-list", "wipe-view", "title-rows"]) {
      expect(touch(`#stage .screen .${c}`), c).toBe("pan-y");
      expect(touch(`#stage .screen .${c} *`), c).toBe("pan-y");
    }
    // 読めている（規則が 20 以上ある）。撤去したスワイプの層は残っていない
    expect(rules.size).toBeGreaterThan(20);
    expect(css).not.toContain(".play-swipe");
  });
});
