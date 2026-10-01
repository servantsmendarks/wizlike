// UI-30〜34: スワイプの分類・非反応帯・キー表・連打の可否と、長押しの連打（偽のタイマー）、
// attachKeyboard（偽の window）。ステージの押下・スワイプ・タップ（attachStageInput）は tap.test.ts。
import { afterEach, describe, expect, test, vi } from "vitest";
import { execute } from "../src/core/engine";
import { floorOf } from "../src/core/rules/dungeon";
import { cloneState } from "../src/core/state";
import type { Command, GameEvent, GameState, PendingChoice } from "../src/core/types";
import { createRunGate } from "../src/presenter/run-gate";
import {
  attachKeyboard,
  attachReleaseOnHide,
  battleKeyChoice,
  canRepeat,
  classifySwipe,
  createHoldRepeater,
  forwardStep,
  inDeadZone,
  keyToAction,
  swipeAction,
  thresholdCss,
  type Action,
} from "../src/presenter/input/swipe";
import { attachStageInput, onTap } from "../src/presenter/input/tap";
import { FakeNode, FakeStage } from "./helpers/dom";
import { data, newGame } from "./helpers/core";

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

  test("UI-31/CH-43 canRepeat は moved の後が hpChanged だけ（迷宮の毒の 1 歩）なら真。message・screen・lifeChanged が混じれば偽", () => {
    const hp: GameEvent = { kind: "hpChanged", id: "c1", delta: -1, hp: 5 };
    const hp2: GameEvent = { kind: "hpChanged", id: "c2", delta: -1, hp: 3 };
    expect(canRepeat([moved, hp], null, false)).toBe(true);
    expect(canRepeat([moved, hp, hp2], null, false)).toBe(true);
    expect(canRepeat([moved, hp, { kind: "message", key: "dungeon.door" }], null, false)).toBe(false);
    expect(canRepeat([moved, { kind: "message", key: "battle.encounter" }], null, false)).toBe(false);
    expect(canRepeat([moved, hp, { kind: "screen", to: "battle" }], null, false)).toBe(false);
    expect(canRepeat([moved, { kind: "lifeChanged", id: "c1", life: "dead" }], null, false)).toBe(false);
    expect(canRepeat([hp, moved], null, false)).toBe(false);
    expect(canRepeat([moved, hp], pending, false)).toBe(false);
    expect(canRepeat([moved, hp], null, true)).toBe(false);
  });

  test("UI-33/UI-54 battleKeyChoice: 数字 n → n−1、Enter → 0、Esc → back。autoStop では Esc / Enter / 1 → stop。矢印・地図は null", () => {
    for (const mode of ["grid", "list"] as const) {
      expect(battleKeyChoice({ menu: 0 }, mode), mode).toBe(0);
      expect(battleKeyChoice({ menu: 6 }, mode), mode).toBe(6);
      expect(battleKeyChoice("confirm", mode), mode).toBe(0);
      expect(battleKeyChoice("back", mode), mode).toBe("back");
      for (const a of ["forward", "left", "right", "around", "map", "debug"] as const) expect(battleKeyChoice(a, mode), `${mode} ${a}`).toBeNull();
    }
    expect(battleKeyChoice("back", "autoStop")).toBe("stop");
    expect(battleKeyChoice("confirm", "autoStop")).toBe("stop");
    expect(battleKeyChoice({ menu: 0 }, "autoStop")).toBe("stop");
    expect(battleKeyChoice({ menu: 1 }, "autoStop")).toBeNull();
    expect(battleKeyChoice("forward", "autoStop")).toBeNull();
    // keyToAction と合わせた表（UI-33）
    expect(battleKeyChoice(keyToAction("3", false, false)!, "grid")).toBe(2);
    expect(battleKeyChoice(keyToAction("Escape", false, false)!, "list")).toBe("back");
    expect(battleKeyChoice(keyToAction("Enter", false, false)!, "autoStop")).toBe("stop");
  });

  test("UI-33/UI-54 battleKeyChoice の target（対象の一覧）: ↑ → up、↓ → down、Enter → focused、数字 n → n−1、Esc → back。←→・地図は null", () => {
    expect(battleKeyChoice(keyToAction("ArrowUp", false, false)!, "target")).toBe("up");
    expect(battleKeyChoice(keyToAction("ArrowDown", false, false)!, "target")).toBe("down");
    expect(battleKeyChoice(keyToAction("Enter", false, false)!, "target")).toBe("focused");
    expect(battleKeyChoice(keyToAction("2", false, false)!, "target")).toBe(1);
    expect(battleKeyChoice(keyToAction("Escape", false, false)!, "target")).toBe("back");
    for (const a of ["left", "right", "map", "debug"] as const) expect(battleKeyChoice(a, "target"), a).toBeNull();
    // grid / list では ↑↓ は null のまま、Enter は 0
    for (const mode of ["grid", "list"] as const) {
      expect(battleKeyChoice("forward", mode)).toBeNull();
      expect(battleKeyChoice("around", mode)).toBeNull();
      expect(battleKeyChoice("confirm", mode)).toBe(0);
    }
  });

  test("UI-33 keyToAction の表どおり（Space は confirm）。repeat と input 上は null", () => {
    const table: [string, Action][] = [
      ["ArrowUp", "forward"],
      ["ArrowLeft", "left"],
      ["ArrowRight", "right"],
      ["ArrowDown", "around"],
      ["Enter", "confirm"],
      [" ", "confirm"],
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
    for (const k of ["0", "a", "x", "Spacebar", "Tab", "F1", "10", "toString", "constructor", ""]) {
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

  test("UI-31 fire が false（壁・扉・遭遇・選択の保留など）なら止まり、release までの press は同じ長押しの続きとして無視する", async () => {
    vi.useFakeTimers();
    const { rep, calls } = harness();
    rep.press();
    calls[0]!(false);
    await flush();
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls).toHaveLength(1);
    // 離さずに届いた press は無視する（同じ長押しの中で壁に当たり直さない）
    rep.press();
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls).toHaveLength(1);
    // 離して押し直せばまた動く
    rep.release();
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

  test("UI-31 再生の途中で離してから壁（false）が返った場合は止まるだけで、次の press は新しい長押しとして動く", async () => {
    vi.useFakeTimers();
    const { rep, calls } = harness();
    rep.press();
    rep.release();
    calls[0]!(false);
    await flush();
    rep.press();
    expect(calls).toHaveLength(2);
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
// attachKeyboard（偽の DOM）

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

  test("UI-33 フォーカス中のボタン（button / role=button）の Enter は変換せず、preventDefault もしない（既定の click に任せる）。ボタン以外の Enter は confirm", () => {
    const { out, key } = setup();
    expect(key("keydown", "Enter", false, { tagName: "BUTTON" })).toBe(false);
    expect(key("keydown", "Enter", false, { tagName: "DIV", getAttribute: (n: string) => (n === "role" ? "button" : null) })).toBe(false);
    expect(out).toEqual([]);
    // ボタンの上でも矢印キーは従来どおり
    expect(key("keydown", "ArrowLeft", false, { tagName: "BUTTON" })).toBe(true);
    expect(key("keydown", "Enter", false, { tagName: "DIV", getAttribute: () => null })).toBe(true);
    // タブ順から外したボタン（十字ボタン。tabIndex -1）の上の Enter は confirm のまま
    expect(key("keydown", "Enter", false, { tagName: "BUTTON", tabIndex: -1 })).toBe(true);
    expect(out).toEqual(['down "left"', 'down "confirm"', 'down "confirm"']);
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

describe("attachReleaseOnHide", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("UI-31 ポインタの長押しも、window の blur・pagehide と visibilitychange（hidden）で離す。visible では離さない", () => {
    const win = new FakeTarget();
    const doc = Object.assign(new FakeTarget(), { visibilityState: "visible" });
    vi.stubGlobal("window", win);
    vi.stubGlobal("document", doc);
    let n = 0;
    const detach = attachReleaseOnHide(() => n++);
    win.emit("blur", {});
    expect(n).toBe(1);
    win.emit("pagehide", {});
    expect(n).toBe(2);
    doc.emit("visibilitychange", {});
    expect(n).toBe(2);
    doc.visibilityState = "hidden";
    doc.emit("visibilitychange", {});
    expect(n).toBe(3);
    detach();
    expect(win.count() + doc.count()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// UI-31: 長押し中に同じ壁へ連続で当たったとき（core の execute・run の門・forwardStep・createHoldRepeater を app と同じに結線）

describe("長押しと壁（結合）", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** d01 に入り、正面が壁のセルに立たせた state（遭遇なし） */
  function facingWall(): GameState {
    const s0 = execute(newGame(1), { type: "dungeon.enter", dungeonId: "d01" }, data).state;
    const f = floorOf(s0.dive!, data);
    const keys = { N: "n", E: "e", S: "s", W: "w" } as const;
    for (let i = 0; i < f.cells.length; i++) {
      const c = f.cells[i]!;
      for (const d of ["N", "E", "S", "W"] as const) {
        if (c[keys[d]] !== "wall") continue;
        const s = cloneState(s0);
        s.dive!.pos = { x: i % f.width, y: Math.floor(i / f.width) };
        s.dive!.facing = d;
        return s;
      }
    }
    throw new Error("no wall");
  }

  /** app と同じ結線。再生は PLAY_MS かかる（偽のタイマー）。execute の回数と、再生した message のキーを数える */
  const PLAY_MS = 120;
  function wire() {
    let state = facingWall();
    let executes = 0;
    const said: string[] = [];
    const gate = createRunGate<Command, { events: readonly GameEvent[]; rejected: boolean }>({
      exec: async (cmd) => {
        executes++;
        const r = execute(state, cmd, data);
        state = r.state;
        for (const e of r.events) if (e.kind === "message") said.push(e.key);
        await new Promise<void>((res) => setTimeout(res, PLAY_MS));
        return { events: r.events, rejected: false };
      },
    });
    const rep = createHoldRepeater({
      ms: () => 250,
      fire: () =>
        forwardStep({
          ready: () => true,
          move: () => gate.run({ type: "dungeon.move" }),
          pending: () => state.pendingChoice,
          overlayOpen: () => false,
        }),
    });
    const blocked = (): number => said.filter((k) => k === "dungeon.blocked").length;
    return { rep, gate, blocked, executes: () => executes, said };
  }

  test("UI-31 押し続けて壁に当たったら「壁だ。」は 1 回で、その長押しの間は次の move を送らない", async () => {
    vi.useFakeTimers();
    const w = wire();
    w.rep.press();
    await vi.advanceTimersByTimeAsync(5000);
    expect(w.executes()).toBe(1);
    expect(w.blocked()).toBe(1);
    expect(w.said).toEqual(["dungeon.blocked"]);
  });

  test("UI-31 同じ長押しの中で press が重ねて届いても（2 本目の指、スワイプと十字ボタン、repeat が偽の自動リピート）、壁で止まった後は release まで送らない", async () => {
    vi.useFakeTimers();
    const w = wire();
    w.rep.press();
    // 再生中の重複
    w.rep.press();
    await vi.advanceTimersByTimeAsync(PLAY_MS + 10);
    expect(w.executes()).toBe(1);
    // 止まった後の重複（離していない）
    for (let i = 0; i < 6; i++) {
      w.rep.press();
      await vi.advanceTimersByTimeAsync(300);
    }
    expect(w.executes()).toBe(1);
    expect(w.blocked()).toBe(1);
    // 離して押し直すのは新しい長押し。そのたびに 1 回出てよい
    w.rep.release();
    w.rep.press();
    await vi.advanceTimersByTimeAsync(2000);
    expect(w.executes()).toBe(2);
    expect(w.blocked()).toBe(2);
  });

  test("UI-31/UI-33 キー: 押したままの ArrowUp の keydown が repeat 偽で届き続けても、keyup までは「壁だ。」は 1 回", async () => {
    vi.useFakeTimers();
    const win = new FakeTarget();
    const doc = Object.assign(new FakeTarget(), { visibilityState: "visible" });
    vi.stubGlobal("window", win);
    vi.stubGlobal("document", doc);
    const w = wire();
    attachKeyboard({
      onAction: (a) => {
        if (a === "forward") w.rep.press();
      },
      onRelease: (a) => {
        if (a === "forward") w.rep.release();
      },
    });
    const key = (type: string, repeat: boolean) => win.emit(type, { key: "ArrowUp", repeat, target: null, preventDefault() {} });
    key("keydown", false);
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(50);
      key("keydown", i % 2 === 0); // 自動リピート（repeat 真と、環境によっては偽）
    }
    await vi.advanceTimersByTimeAsync(1000);
    expect(w.blocked()).toBe(1);
    expect(w.executes()).toBe(1);
    key("keyup", false);
    key("keydown", false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(w.blocked()).toBe(2);
  });

  test("UI-31/UI-36 前進ボタンの長押しと 2 本目の指のスワイプ: 長押しで壁に当たったら 1 回。2 本目の指は無視し、離して押し直せば動く", async () => {
    vi.useFakeTimers();
    const w = wire();
    const stage = new FakeStage(0);
    const fwd = new FakeNode("BUTTON", stage);
    onTap(fwd as unknown as Element, {
      onTap: () => {
        w.rep.press();
        w.rep.release();
      },
      hold: { ms: () => 250, onHoldStart: () => w.rep.press(), onHoldEnd: () => w.rep.release() },
    });
    attachStageInput(stage as unknown as HTMLElement, {
      scale: () => 1,
      threshold: () => 28,
      deadZone: 12,
      width: 240,
      swipeEnabled: () => true,
      busy: () => w.gate.busy(),
      onBusyTap: () => {},
      onSwipe: (a) => {
        if (a === "forward") w.rep.press();
      },
      onSwipeRelease: () => w.rep.release(),
    });
    // 前進ボタンを押したまま 250ms で連打が始まり、壁に当たって止まる
    stage.emit("pointerdown", { pointerId: 1, clientX: 50, clientY: 330, target: fwd, pointerType: "touch" });
    await vi.advanceTimersByTimeAsync(250 + PLAY_MS + 300);
    expect(w.executes()).toBe(1);
    expect(w.blocked()).toBe(1);
    // 2 本目の指でビューを上へスワイプしても無視（追う押下は 1 本だけ）
    stage.emit("pointerdown", { pointerId: 2, clientX: 100, clientY: 100, target: stage, pointerType: "touch", isPrimary: false });
    stage.emit("pointermove", { pointerId: 2, clientX: 100, clientY: 40, target: stage });
    await vi.advanceTimersByTimeAsync(2000);
    expect(w.executes()).toBe(1);
    // 離して、もう一度スワイプで前進すれば新しい長押しとして動く
    stage.emit("pointerup", { pointerId: 1, clientX: 50, clientY: 330, target: fwd });
    stage.emit("pointerdown", { pointerId: 3, clientX: 100, clientY: 100, target: stage, pointerType: "touch" });
    stage.emit("pointermove", { pointerId: 3, clientX: 100, clientY: 40, target: stage });
    await vi.advanceTimersByTimeAsync(2000);
    expect(w.executes()).toBe(2);
    expect(w.blocked()).toBe(2);
  });
});
