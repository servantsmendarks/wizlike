// UI-30〜34: スワイプの分類・tracker・非反応帯・キー表・連打の可否と、長押しの連打（偽のタイマー）、
// attachSwipe / attachKeyboard（偽の要素と window）。
import { afterEach, describe, expect, test, vi } from "vitest";
import type { GameEvent, PendingChoice } from "../src/core/types";
import {
  attachKeyboard,
  attachSwipe,
  canRepeat,
  classifySwipe,
  createHoldRepeater,
  inDeadZone,
  keyToAction,
  swipeAction,
  thresholdCss,
  trackerDown,
  trackerMove,
  trackerUp,
  type Action,
  type Tracker,
} from "../src/presenter/input/swipe";
import { data } from "./helpers/core";

describe("スワイプの分類", () => {
  test("UI-30 thresholdCss(28, 4/3) ≈ 37.33（論理 px × ステージの CSS 倍率）", () => {
    expect(thresholdCss(28, 4 / 3)).toBeCloseTo(37.333, 3);
    expect(thresholdCss(data.config.input.swipeThresholdPx, 1)).toBe(28);
    expect(thresholdCss(28, 2)).toBe(56);
  });

  test("UI-30 classifySwipe は閾値ちょうどで発火し、−0.01 では null", () => {
    expect(classifySwipe(0, -28, 28)).toBe("up");
    expect(classifySwipe(0, -27.99, 28)).toBeNull();
    expect(classifySwipe(28, 0, 28)).toBe("right");
    expect(classifySwipe(-27.99, 5, 28)).toBeNull();
    expect(classifySwipe(0, 0, 28)).toBeNull();
  });

  test("UI-30 主軸の選択（dx 30, dy −31 → up）、同値なら縦", () => {
    expect(classifySwipe(30, -31, 28)).toBe("up");
    expect(classifySwipe(31, -30, 28)).toBe("right");
    expect(classifySwipe(-40, 39, 28)).toBe("left");
    expect(classifySwipe(30, 30, 28)).toBe("down");
    expect(classifySwipe(-30, -30, 28)).toBe("up");
  });

  test("UI-30 4 方向と Action の対応（上 = 前進、下 = 反転、左右 = 旋回）", () => {
    expect(swipeAction("up")).toBe("forward");
    expect(swipeAction("down")).toBe("around");
    expect(swipeAction("left")).toBe("left");
    expect(swipeAction("right")).toBe("right");
  });

  test("UI-30 tracker は 1 回だけ発火し、up まで再発火しない。別の pointerId は無視", () => {
    let t: Tracker = trackerDown(null, 1, 100, 100, true);
    expect(t).toEqual({ id: 1, sx: 100, sy: 100, fired: null });
    // 2 本目は無視
    expect(trackerDown(t, 2, 0, 0, true)).toBe(t);
    // 別の pointerId の move は無視
    let r = trackerMove(t, 2, 100, 0, 28);
    expect(r).toEqual({ next: t, fire: null });
    r = trackerMove(t, 1, 100, 80, 28);
    expect(r.fire).toBeNull();
    t = r.next;
    r = trackerMove(t, 1, 100, 72, 28);
    expect(r.fire).toBe("up");
    t = r.next;
    // 確定後は、どれだけ動かしても（向きを変えても）発火しない
    expect(trackerMove(t, 1, 100, 0, 28).fire).toBeNull();
    expect(trackerMove(t, 1, 0, 72, 28).fire).toBeNull();
    // 別の id の up では外れない
    expect(trackerUp(t, 2)).toBe(t);
    t = trackerUp(t, 1);
    expect(t).toBeNull();
    // 次のジェスチャーは新しく発火する
    t = trackerDown(t, 3, 50, 50, true);
    expect(trackerMove(t, 3, 50, 90, 28).fire).toBe("down");
  });

  test("UI-34 非反応帯で始まったジェスチャーは追わない", () => {
    const t = trackerDown(null, 1, 5, 100, false);
    expect(t).toBeNull();
    expect(trackerMove(t, 1, 5, 0, 28)).toEqual({ next: null, fire: null });
  });

  test("UI-34 inDeadZone の境界（11.9 は真、12 と 228 は偽、228.1 は真）", () => {
    const w = 240;
    const dead = data.config.input.edgeDeadZonePx;
    expect(dead).toBe(12);
    expect(inDeadZone(11.9, w, dead)).toBe(true);
    expect(inDeadZone(12, w, dead)).toBe(false);
    expect(inDeadZone(120, w, dead)).toBe(false);
    expect(inDeadZone(228, w, dead)).toBe(false);
    expect(inDeadZone(228.1, w, dead)).toBe(true);
    expect(inDeadZone(0, w, dead)).toBe(true);
  });
});

describe("連打の可否とキーボード", () => {
  const moved: GameEvent = { kind: "moved", pos: { x: 1, y: 2 }, facing: "N" };
  const pending: PendingChoice = {
    kind: "stairs",
    promptKey: "dungeon.stairsDown",
    options: [{ id: "descend", labelKey: "dungeon.choice.descend" }],
  };

  test("UI-31 canRepeat は [moved] だけなら真。blocked、message+moved、pending あり、overlay ありでは偽", () => {
    expect(canRepeat([moved], null, false)).toBe(true);
    expect(canRepeat([{ kind: "blocked" }], null, false)).toBe(false);
    expect(canRepeat([{ kind: "message", key: "dungeon.door" }, moved], null, false)).toBe(false);
    expect(canRepeat([moved, { kind: "message", key: "dungeon.stairsDown" }], pending, false)).toBe(false);
    expect(canRepeat([moved], pending, false)).toBe(false);
    expect(canRepeat([moved], null, true)).toBe(false);
    expect(canRepeat([], null, false)).toBe(false);
    expect(canRepeat([{ kind: "turned", facing: "E" }], null, false)).toBe(false);
  });

  test("UI-33 keyToAction の表どおり。repeat と input 上は null", () => {
    const table: [string, Action][] = [
      ["ArrowUp", "forward"],
      ["ArrowLeft", "left"],
      ["ArrowRight", "right"],
      ["ArrowDown", "around"],
      ["Enter", "confirm"],
      ["Escape", "back"],
      ["m", "map"],
      ["M", "map"],
      ["F2", "debug"],
      ["1", { menu: 0 }],
      ["5", { menu: 4 }],
      ["9", { menu: 8 }],
    ];
    for (const [k, a] of table) {
      expect(keyToAction(k, false, false), k).toEqual(a);
      expect(keyToAction(k, true, false), `${k} repeat`).toBeNull();
      expect(keyToAction(k, false, true), `${k} on input`).toBeNull();
    }
    for (const k of ["0", "a", "x", " ", "Tab", "F1", "10", "toString", "constructor", ""]) {
      expect(keyToAction(k, false, false), k).toBeNull();
    }
  });
});

describe("長押しの連打", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** fire を手動で解決できる偽物 */
  function harness(ms = 250) {
    const calls: ((ok: boolean) => void)[] = [];
    const rep = createHoldRepeater({
      ms: () => ms,
      fire: () => new Promise<boolean>((res) => calls.push(res)),
    });
    return { rep, calls };
  }
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  test("UI-31 press で即 1 回、再生が終わってから holdRepeatMs 後に次の 1 回（待ちは再生の終わりから数える）", async () => {
    vi.useFakeTimers();
    const { rep, calls } = harness(250);
    rep.press();
    expect(calls).toHaveLength(1);
    // 再生（fire の解決）が長引いている間は次を呼ばない
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toHaveLength(1);
    calls[0]!(true);
    await flush();
    await vi.advanceTimersByTimeAsync(249);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(2);
    calls[1]!(true);
    await flush();
    await vi.advanceTimersByTimeAsync(250);
    expect(calls).toHaveLength(3);
  });

  test("UI-31 fire が false（壁・扉・遭遇・選択の保留など）なら止まる", async () => {
    vi.useFakeTimers();
    const { rep, calls } = harness();
    rep.press();
    calls[0]!(false);
    await flush();
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls).toHaveLength(1);
    // もう一度押せばまた動く
    rep.press();
    expect(calls).toHaveLength(2);
  });

  test("UI-31 release で止まる（待ちの途中でも、再生の途中でも）", async () => {
    vi.useFakeTimers();
    const a = harness();
    a.rep.press();
    a.calls[0]!(true);
    await flush();
    await vi.advanceTimersByTimeAsync(100);
    a.rep.release();
    await vi.advanceTimersByTimeAsync(2000);
    expect(a.calls).toHaveLength(1);

    const b = harness();
    b.rep.press();
    b.rep.release();
    b.calls[0]!(true);
    await flush();
    await vi.advanceTimersByTimeAsync(2000);
    expect(b.calls).toHaveLength(1);
  });

  test("UI-31 再生の途中の二度押しは二重に fire しない", async () => {
    vi.useFakeTimers();
    const { rep, calls } = harness();
    rep.press();
    rep.press();
    expect(calls).toHaveLength(1);
    calls[0]!(true);
    await flush();
    await vi.advanceTimersByTimeAsync(250);
    expect(calls).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// attachSwipe / attachKeyboard（偽の DOM）

type Listener = (e: never) => void;
class FakeTarget {
  listeners: Record<string, Listener[]> = {};
  addEventListener(t: string, f: Listener): void {
    (this.listeners[t] ??= []).push(f);
  }
  removeEventListener(t: string, f: Listener): void {
    this.listeners[t] = (this.listeners[t] ?? []).filter((g) => g !== f);
  }
  emit(t: string, e: object): void {
    for (const f of this.listeners[t] ?? []) (f as (e: object) => void)(e);
  }
  count(): number {
    return Object.values(this.listeners).reduce((n, l) => n + l.length, 0);
  }
}
class FakeView extends FakeTarget {
  captured: number[] = [];
  constructor(private readonly left: number) {
    super();
  }
  getBoundingClientRect(): { left: number } {
    return { left: this.left };
  }
  setPointerCapture(id: number): void {
    this.captured.push(id);
  }
}

describe("attachSwipe", () => {
  function setup(scale = 2, enabled = true) {
    const el = new FakeView(10);
    const out: string[] = [];
    const detach = attachSwipe(el as unknown as HTMLElement, {
      scale: () => scale,
      threshold: () => 28,
      deadZone: 12,
      width: 240,
      enabled: () => enabled,
      onAction: (a) => out.push(`action ${JSON.stringify(a)}`),
      onRelease: () => out.push("release"),
      onDebug: (dx, dy, d) => out.push(`debug ${dx},${dy},${d}`),
    });
    return { el, out, detach };
  }

  test("UI-30 CSS px の閾値（28 × scale）を越えた瞬間に 1 回だけ発火し、up で release", () => {
    const { el, out } = setup(2);
    // 論理 x = (210 - 10) / 2 = 100
    el.emit("pointerdown", { pointerId: 7, clientX: 210, clientY: 300 });
    expect(el.captured).toEqual([7]);
    el.emit("pointermove", { pointerId: 7, clientX: 210, clientY: 245 }); // dy -55 < 56
    expect(out).toEqual([]);
    el.emit("pointermove", { pointerId: 7, clientX: 212, clientY: 244 }); // dy -56
    el.emit("pointermove", { pointerId: 7, clientX: 212, clientY: 100 });
    expect(out).toEqual(['debug 2,-56,up', 'action "forward"']);
    el.emit("pointerup", { pointerId: 8 });
    el.emit("pointerup", { pointerId: 7 });
    el.emit("lostpointercapture", { pointerId: 7 });
    expect(out).toEqual(['debug 2,-56,up', 'action "forward"', "release"]);
  });

  test("UI-34 非反応帯（論理 x < 12 か > 228）で始まったジェスチャーは丸ごと無視", () => {
    const { el, out } = setup(2);
    // 論理 x = (33 - 10) / 2 = 11.5
    el.emit("pointerdown", { pointerId: 1, clientX: 33, clientY: 300 });
    el.emit("pointermove", { pointerId: 1, clientX: 200, clientY: 300 });
    el.emit("pointerup", { pointerId: 1 });
    // 論理 x = (467 - 10) / 2 = 228.5
    el.emit("pointerdown", { pointerId: 2, clientX: 467, clientY: 300 });
    el.emit("pointermove", { pointerId: 2, clientX: 300, clientY: 300 });
    expect(out).toEqual([]);
    expect(el.captured).toEqual([]);
    // 論理 x = 12 ちょうどは受ける
    el.emit("pointerdown", { pointerId: 3, clientX: 34, clientY: 300 });
    el.emit("pointermove", { pointerId: 3, clientX: 90, clientY: 300 });
    expect(out).toEqual(["debug 56,0,right", 'action "right"']);
  });

  test("UI-32 enabled が偽なら受けない。detach で外れる", () => {
    const off = setup(1, false);
    off.el.emit("pointerdown", { pointerId: 1, clientX: 100, clientY: 100 });
    off.el.emit("pointermove", { pointerId: 1, clientX: 100, clientY: 0 });
    expect(off.out).toEqual([]);
    const on = setup(1);
    expect(on.el.count()).toBe(5);
    on.detach();
    expect(on.el.count()).toBe(0);
  });
});

describe("attachKeyboard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function setup() {
    const win = new FakeTarget();
    const doc = Object.assign(new FakeTarget(), { visibilityState: "visible" });
    vi.stubGlobal("window", win);
    vi.stubGlobal("document", doc);
    const out: string[] = [];
    const detach = attachKeyboard({
      onAction: (a) => out.push(`down ${JSON.stringify(a)}`),
      onRelease: (a) => out.push(`up ${JSON.stringify(a)}`),
    });
    const key = (type: string, k: string, repeat = false, target: object | null = null) => {
      const ev = { key: k, repeat, target, prevented: false, preventDefault() { this.prevented = true; } };
      win.emit(type, ev);
      return ev.prevented;
    };
    return { win, doc, out, detach, key };
  }

  test("UI-33 処理したキーは preventDefault、自動リピートは既定動作だけ止めて発火しない、入力欄では何もしない", () => {
    const { out, key } = setup();
    expect(key("keydown", "ArrowUp")).toBe(true);
    expect(key("keydown", "ArrowUp", true)).toBe(true);
    expect(key("keydown", "a")).toBe(false);
    expect(key("keydown", "1", false, { tagName: "input" })).toBe(false);
    key("keyup", "ArrowUp");
    expect(out).toEqual(['down "forward"', 'up "forward"']);
  });

  test("UI-31 blur と visibilitychange（hidden）で押したままのキーを離す", () => {
    const { win, doc, out, key, detach } = setup();
    key("keydown", "ArrowUp");
    win.emit("blur", {});
    expect(out).toEqual(['down "forward"', 'up "forward"']);
    key("keydown", "ArrowUp");
    doc.visibilityState = "hidden";
    doc.emit("visibilitychange", {});
    expect(out.slice(2)).toEqual(['down "forward"', 'up "forward"']);
    // 離した後の keyup は二重に呼ばない
    key("keyup", "ArrowUp");
    expect(out).toHaveLength(4);
    detach();
    expect(win.count() + doc.count()).toBe(0);
  });
});
