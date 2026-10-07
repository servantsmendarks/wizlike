import { afterEach, describe, expect, test, vi } from "vitest";
import { regions, townLayout } from "../src/presenter/layout";
import { createNarrator, createTalkBox, createTalkModel, type Narration, type TalkSink } from "../src/presenter/views/talk";
import { WRAP_STYLE } from "../src/presenter/views/wrap";
import { townMenu } from "../src/core/rules/town";
import { townPageIntro, type TownPage } from "../src/presenter/views/town";
import { data, newGame } from "./helpers/core";

/** 偽の表示先と手動のタイマー */
function setup(o: { speed?: number; blink?: boolean } = {}) {
  const logs: string[] = [];
  /** UI-66: 送りの音の回数 */
  const adv = { n: 0 };
  const sink = { open: false, text: "", more: { on: false, blink: false } };
  const timers: { fn: () => void; ms: number; dead: boolean }[] = [];
  const s: TalkSink = {
    open(on) {
      sink.open = on;
    },
    text(t) {
      sink.text = t;
    },
    more(on, blink) {
      sink.more = { on, blink };
    },
  };
  const m = createTalkModel({
    advanced: () => adv.n++,
    sink: s,
    log: (t) => logs.push(t),
    speed: () => o.speed ?? 0,
    blink: () => o.blink ?? true,
    schedule: (fn, ms) => {
      const t = { fn, ms, dead: false };
      timers.push(t);
      return () => {
        t.dead = true;
      };
    },
  });
  /** 生きているタイマーを 1 つ進める */
  const tick = (): boolean => {
    const t = timers.find((x) => !x.dead);
    if (t === undefined) return false;
    t.dead = true;
    t.fn();
    return true;
  };
  return { m, logs, sink, tick, timers, adv };
}

/** Promise が解決済みかを調べる */
async function settled(p: Promise<void>): Promise<boolean> {
  let done = false;
  void p.then(() => {
    done = true;
  });
  await new Promise<void>((r) => setTimeout(r, 0));
  return done;
}

describe("UI-47 会話の箱（モデル）", () => {
  test("UI-47 say は呼んだ時点でログに入る（表示される前でも、flush で打ち切られても）", async () => {
    const { m, logs, sink } = setup();
    void m.say("一", true);
    void m.say("二", true);
    void m.say("三", true);
    expect(logs).toEqual(["一", "二", "三"]);
    // 表示は 1 文目だけ
    expect(sink.text).toBe("一");
    m.flush();
    expect(logs).toEqual(["一", "二", "三"]);
    expect(sink.open).toBe(false);
  });

  test("UI-47 表示中に次の say が来たらタップまで待つ（▼ を点滅）。タップで次の文、最後の文は ▼ なしで残り、次のタップで閉じる", async () => {
    const { m, sink } = setup();
    const p1 = m.say("一", true);
    expect(await settled(p1)).toBe(true);
    expect({ open: sink.open, text: sink.text, more: sink.more.on }).toEqual({ open: true, text: "一", more: false });
    const p2 = m.say("二", true);
    expect(await settled(p2)).toBe(false);
    expect(sink.text).toBe("一");
    expect(sink.more).toEqual({ on: true, blink: true });
    m.tap();
    expect(await settled(p2)).toBe(true);
    expect(sink.text).toBe("二");
    expect(sink.more.on).toBe(false);
    expect(m.isOpen()).toBe(true);
    m.tap();
    expect(m.isOpen()).toBe(false);
    expect(sink.open).toBe(false);
  });

  test("UI-47/UI-43 文字送り中のタップは即表示（閉じない）。待ちのタップで次の文の文字送りを始め、その文の say は文字送りの後に解決する", async () => {
    const { m, sink, tick } = setup({ speed: 30 });
    const p1 = m.say("あいう", false);
    expect(sink.text).toBe("あ");
    expect(m.typing()).toBe(true);
    tick();
    expect(sink.text).toBe("あい");
    m.tap();
    expect(sink.text).toBe("あいう");
    expect(m.typing()).toBe(false);
    expect(await settled(p1)).toBe(true);
    expect(m.isOpen()).toBe(true);
    const p2 = m.say("えお", false);
    expect(sink.text).toBe("あいう");
    m.tap();
    expect(sink.text).toBe("え");
    expect(await settled(p2)).toBe(false);
    tick();
    expect(sink.text).toBe("えお");
    expect(await settled(p2)).toBe(true);
  });

  // 2026-10-07 未定-17: 再生中のタップ（rush）で次の文へ進んだときも鳴らすようにした（以前の期待値は rush で 1 のまま）
  test("UI-66/UI-47（2026-10-07）送りの音（advanced）は文を送ったとき（tap・rush で次の文へ、tap で閉じる）。箱が開くとき・文字送りの即表示・flush では鳴らさない", async () => {
    const { m, tick, adv } = setup({ speed: 30 });
    void m.say("あいう", false);
    expect(adv.n).toBe(0); // 箱が開くときは鳴らさない
    m.tap(); // 即表示
    expect(adv.n).toBe(0);
    void m.say("えお", false);
    m.tap(); // 次の文へ
    expect(adv.n).toBe(1);
    tick();
    tick();
    void m.say("かきく", false);
    m.rush(); // 再生中のタップで次の文へ（送り）
    expect(adv.n).toBe(2);
    m.rush(); // 文字送り中の即表示（rush）
    expect(adv.n).toBe(2);
    m.rush(); // 最後の文は rush では閉じない
    expect(adv.n).toBe(2);
    expect(m.isOpen()).toBe(true);
    m.tap(); // 閉じる
    expect(adv.n).toBe(3);
    expect(m.isOpen()).toBe(false);
    void m.say("けこ", false);
    m.tap(); // 文字送り中の即表示（tap）は送りではない
    expect(adv.n).toBe(3);
    m.tap(); // 閉じる
    expect(adv.n).toBe(4);
    m.tap(); // 閉じている箱のタップは何もしない
    expect(adv.n).toBe(4);
    void m.say("き", true);
    m.flush();
    expect(adv.n).toBe(4);
  });

  test("UI-47/UI-41 skip（instant）は文字送りだけ省き、タップ待ちは残る。演出スキップの ▼ は点滅しない", async () => {
    const { m, sink, timers } = setup({ speed: 30, blink: false });
    void m.say("一", true);
    const p2 = m.say("二", true);
    expect(timers).toHaveLength(0);
    expect(await settled(p2)).toBe(false);
    expect(sink.more).toEqual({ on: true, blink: false });
    m.tap();
    expect(await settled(p2)).toBe(true);
  });

  test("UI-47 rush（再生中のタップ）は即表示か次の文へ進めるが、最後の文の箱は閉じない", async () => {
    const { m } = setup();
    void m.say("一", true);
    const p2 = m.say("二", true);
    m.rush();
    expect(await settled(p2)).toBe(true);
    m.rush();
    expect(m.isOpen()).toBe(true);
  });

  test("UI-47 flush で待っている say はすべて解決して閉じる。文字送り中の文も解決する", async () => {
    const { m, sink } = setup({ speed: 30 });
    const p1 = m.say("あいう", false);
    const p2 = m.say("二", false);
    const p3 = m.say("三", false);
    m.flush();
    expect(await settled(Promise.all([p1, p2, p3]).then(() => undefined))).toBe(true);
    expect({ open: sink.open, more: sink.more.on, typing: m.typing() }).toEqual({ open: false, more: false, typing: false });
    // 閉じた後の say は待たずに出る
    const p4 = m.say("四", true);
    expect(await settled(p4)).toBe(true);
    expect(sink.text).toBe("四");
  });

  test("UI-47 replay はログに入れない（迷宮から持ち越した語り）。文ごとのタップ待ちは say と同じ", async () => {
    const { m, logs, sink } = setup();
    const p = m.replay(["帰った", "街だ"], true);
    expect(logs).toEqual([]);
    expect(sink.text).toBe("帰った");
    expect(await settled(p)).toBe(false);
    m.tap();
    expect(await settled(p)).toBe(true);
    expect(sink.text).toBe("街だ");
    // 空なら何も出さない
    const { m: m2, sink: s2 } = setup();
    expect(await settled(m2.replay([], true))).toBe(true);
    expect(s2.open).toBe(false);
  });

  test("UI-47/UI-40 外からの ▼（setMore）は文が出ている間だけ出し、文字送り中は出さない。clear で下ろす", async () => {
    const { m, sink, tick } = setup({ speed: 30 });
    m.setMore(true, true);
    // 箱が閉じていれば出さない
    expect(sink.more.on).toBe(false);
    void m.say("あい", false);
    expect(sink.more.on).toBe(false);
    tick();
    expect(sink.more).toEqual({ on: true, blink: true });
    m.setMore(false);
    expect(sink.more.on).toBe(false);
    m.setMore(true, false);
    expect(sink.more).toEqual({ on: true, blink: false });
    m.clear();
    expect({ open: sink.open, more: sink.more.on }).toEqual({ open: false, more: false });
    void m.say("う", true);
    expect(sink.more.on).toBe(false);
  });
});

describe("UI-47/UI-66（2026-10-06）会話の箱の hold（文の後の出来事の前の待ち）", () => {
  test("UI-47 箱が閉じていれば hold はすぐ解決する", async () => {
    const { m } = setup();
    expect(await settled(m.hold())).toBe(true);
  });

  // 2026-10-07 未定-17: rush で解いたときも送りの音を鳴らすようにした（以前の期待値は 0）
  test("UI-47/UI-66 文が出ていれば ▼ を点滅させてタップを待つ。rush で解け（送りの音を 1 回）、箱を閉じ、次の say はタップなしで出る", async () => {
    const { m, sink, adv } = setup();
    void m.say("一", true);
    const h = m.hold();
    expect(await settled(h)).toBe(false);
    expect(sink.more).toEqual({ on: true, blink: true });
    m.rush();
    expect(await settled(h)).toBe(true);
    expect(adv.n).toBe(1);
    expect({ open: sink.open, more: sink.more.on }).toEqual({ open: false, more: false });
    const p2 = m.say("二", true);
    expect(await settled(p2)).toBe(true);
    expect({ open: sink.open, text: sink.text }).toEqual({ open: true, text: "二" });
  });

  test("UI-47/UI-66 tap でも解ける（送りの音を 1 回）。flush でも解ける。演出スキップの ▼ は点滅しない", async () => {
    const a = setup();
    void a.m.say("一", true);
    const h = a.m.hold();
    a.m.tap();
    expect(await settled(h)).toBe(true);
    expect(a.adv.n).toBe(1);
    const b = setup({ blink: false });
    void b.m.say("一", true);
    const h2 = b.m.hold();
    expect(b.sink.more).toEqual({ on: true, blink: false });
    b.m.flush();
    expect(await settled(h2)).toBe(true);
    expect(b.sink.open).toBe(false);
  });

  test("UI-47 語りの表示先の hold は、街なら会話の箱の hold、それ以外は待たない", async () => {
    const { m } = setup();
    let town = true;
    const win: Narration = { say: async () => {}, setMore: () => {}, rush: () => {}, typing: () => false, log: () => {}, waitMs: async () => {} };
    const n = createNarrator({ town: () => town, talk: m, window: win });
    await n.say("一", true);
    const h = n.hold!();
    expect(await settled(h)).toBe(false);
    town = false;
    expect(await settled(n.hold!())).toBe(true);
    town = true;
    n.rush();
    expect(await settled(h)).toBe(true);
  });
});

describe("UI-66（2026-10-07 未定-17）施設の会話の送りの音（page）", () => {
  // 施設に入ると語り（townPageIntro）で箱が開き（音は施設の項目の door / ok。会話の箱は鳴らさない）、
  // 項目（蘇生・泊まる・買うなど）の結果の文は再生中に出る（再生中のステージのタップは場所によらず Player.tap → narrator.rush）。
  // 文を送るタップは、再生の中（rush）でも外（tap）でも page。施設による違いは無い。
  const FACILITIES: TownPage[] = ["temple", "tavern", "inn", "shop", "dark", "gate"];
  const menu = townMenu(newGame(1), data);
  if (menu === null) throw new Error("not in town");

  test.each(FACILITIES)("UI-66 %s: 箱を開くときは鳴らさず、再生中・再生の外とも文を送るタップで page。文字送りの即表示では鳴らさない", async (page) => {
    const { m, tick, adv } = setup({ speed: 30 });
    const win: Narration = { say: async () => {}, setMore: () => {}, rush: () => {}, typing: () => false, log: () => {}, waitMs: async () => {} };
    const n = createNarrator({ town: () => true, talk: m, window: win });
    const intro = townPageIntro(page, menu).map((k) => data.strings[k]!);
    expect(intro.length).toBeGreaterThan(0);
    // 施設に入る: 語りで箱が開く（送りの音なし）
    for (const t of intro) void n.say(t, false);
    expect(adv.n).toBe(0);
    // 文字送り中のタップは即表示（送りではない）
    m.tap();
    expect(adv.n).toBe(0);
    while (tick());
    // 項目を選んで再生: 出ている入場の文の後に結果の文が 2 つ来る
    void n.say("結果一", false);
    void n.say("結果二", false);
    while (tick());
    let base = adv.n;
    // 再生中の最初のタップ（どこを押しても narrator.rush）で入場の文から次の文へ送る → page
    n.rush();
    expect(adv.n).toBe(base + 1);
    while (tick());
    base = adv.n;
    n.rush(); // 結果一 → 結果二
    expect(adv.n).toBe(base + 1);
    while (tick());
    // 文の後の出来事の前の待ち（hold）を再生中のタップで解く → page
    const h = n.hold!();
    expect(await settled(h)).toBe(false);
    n.rush();
    expect(await settled(h)).toBe(true);
    expect(adv.n).toBe(base + 2);
    // 再生の後に残った最後の文を再生の外のタップで閉じる → page
    void n.say("結果三", true);
    m.tap();
    expect(adv.n).toBe(base + 3);
    expect(m.isOpen()).toBe(false);
  });
});

describe("UI-47 語りの表示先（createNarrator）", () => {
  const fake = (name: string, calls: string[]): Narration => ({
    say: async (t) => {
      calls.push(`${name}.say:${t}`);
    },
    setMore: (on) => calls.push(`${name}.more:${on}`),
    rush: () => calls.push(`${name}.rush`),
    typing: () => name === "talk",
    log: (t) => calls.push(`${name}.log:${t}`),
    waitMs: async () => {
      calls.push(`${name}.wait`);
    },
  });

  test("UI-47 route が街なら会話の箱、それ以外はメッセージ窓。ログと拍の待ちはいつもメッセージ窓。▼ を下ろすときは両方", async () => {
    const calls: string[] = [];
    let town = true;
    const n = createNarrator({ town: () => town, talk: fake("talk", calls), window: fake("win", calls) });
    await n.say("a", true);
    n.rush();
    n.setMore(true, true);
    expect(n.typing()).toBe(true);
    n.log("d");
    await n.waitMs(10);
    town = false;
    await n.say("b", true);
    n.rush();
    expect(n.typing()).toBe(false);
    n.setMore(false);
    expect(calls).toEqual([
      "talk.say:a",
      "talk.rush",
      "talk.more:true",
      "win.log:d",
      "win.wait",
      "win.say:b",
      "win.rush",
      "talk.more:false",
      "win.more:false",
    ]);
  });
});

// ---------------------------------------------------------------- DOM の層（偽の document）
class FakeEl {
  style: Record<string, string> = {};
  className = "";
  textContent = "";
  children: FakeEl[] = [];
  setAttribute(): void {}
  appendChild(c: FakeEl): FakeEl {
    this.children.push(c);
    return c;
  }
  animate(): { finished: Promise<void>; cancel(): void } {
    return { finished: Promise.resolve(), cancel() {} };
  }
}

describe("UI-47 会話の箱（DOM）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("UI-47/UI-13 箱は townLayout の talk の位置。文字領域は 3 行の下詰めで WRAP_STYLE（UI-43 の禁則）、指でスクロールしない。最初は閉じている", () => {
    const created: FakeEl[] = [];
    vi.stubGlobal("document", {
      createElement: () => {
        const e = new FakeEl();
        created.push(e);
        return e;
      },
      createElementNS: () => new FakeEl(),
    });
    const g = regions(data.config.ui.layout, data.config.stage.width);
    const T = townLayout(g, data.config.party.size);
    const box = createTalkBox({ layout: T.talk, speed: () => 0, blink: () => true, log: () => {} });
    const el = box.el as unknown as FakeEl;
    expect({ left: el.style["left"], top: el.style["top"], width: el.style["width"], height: el.style["height"], display: el.style["display"] }).toEqual({
      left: "2px",
      top: "128px",
      width: "236px",
      height: "36px",
      display: "none",
    });
    const body = created.find((e) => e.className === "talk-text")!;
    // 枠 1px の内側が原点（文字 x7・y131 → 4, 2）。224×30 = 3 行
    expect({ left: body.style["left"], top: body.style["top"], width: body.style["width"], height: body.style["height"] }).toEqual({
      left: "4px",
      top: "2px",
      width: "224px",
      height: "30px",
    });
    expect(T.talk.lines).toBe(3);
    expect(body.style["overflow"]).toBe("hidden");
    expect(body.style["touchAction"]).toBe("none");
    expect(body.style["justifyContent"]).toBe("flex-end");
    for (const [k, v] of Object.entries(WRAP_STYLE)) expect(body.style[k], k).toBe(v);
  });
});
