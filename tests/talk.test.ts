import { afterEach, describe, expect, test, vi } from "vitest";
import { regions, TALK_MARK_GUTTER, townLayout } from "../src/presenter/layout";
import { SCROLL_MARK_SIZE } from "../src/presenter/views/scroll-marks";
import { createNarrator, createTalkBox, createTalkModel, talkMarkPos, TALK_KEY_LINES, type Narration, type TalkSink } from "../src/presenter/views/talk";
import { formatMessage } from "../src/presenter/views/message";
import { WRAP_STYLE } from "../src/presenter/views/wrap";
import { STAT_KEYS } from "../src/core/data/index";
import { townMenu } from "../src/core/rules/town";
import { townPageIntro, type TownPage } from "../src/presenter/views/town";
import { data, newGame } from "./helpers/core";
import { FakeNode, FakeStage } from "./helpers/dom";
import { attachStageInput, onTap } from "../src/presenter/input/tap";

const G = regions(data.config.ui.layout, data.config.stage.width);
const T = townLayout(G, data.config.party.size);

/** 偽の表示先と手動のタイマー。max は溜める文の数の上限 */
function setup(o: { speed?: number; blink?: boolean; max?: number } = {}) {
  const logs: string[] = [];
  /** UI-66: 送りの音の回数 */
  const adv = { n: 0 };
  /** UI-40（M10.5）: 中身のある箱を閉じた回数（判定の箱を消す契機） */
  const cleared = { n: 0 };
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
    cleared: () => cleared.n++,
    sink: s,
    log: (t) => logs.push(t),
    speed: () => o.speed ?? 0,
    blink: () => o.blink ?? true,
    ...(o.max !== undefined ? { max: () => o.max! } : {}),
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
  return { m, logs, sink, tick, timers, adv, cleared };
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

/** 0..n-1 の番号付きの文 */
const nums = (n: number, head = "文"): string[] => Array.from({ length: n }, (_, i) => `${head}${i}`);

describe("UI-47（M10.5）会話の箱（モデル）: 文を溜める", () => {
  test("UI-47 say は呼んだ時点でログに入る（表示される前でも、flush で打ち切られても）", async () => {
    const { m, logs, sink } = setup({ speed: 30 });
    void m.say("一つ目", false);
    void m.say("二つ目", false);
    void m.say("三つ目", false);
    expect(logs).toEqual(["一つ目", "二つ目", "三つ目"]);
    // 一つ目 の文字送りの途中（二つ目・三つ目 は控えている）
    expect(sink.text).toBe("一");
    m.flush();
    expect(logs).toEqual(["一つ目", "二つ目", "三つ目"]);
    expect(sink.open).toBe(false);
  });

  test("UI-47（M10.5）文字送りが終わったら改行して次の文を続ける（文ごとのタップは待たない）。最後の文の後は ▼ を点滅させ、タップで箱を閉じる", async () => {
    const { m, sink, adv } = setup();
    const p1 = m.say("一", true);
    expect(await settled(p1)).toBe(true);
    expect({ open: sink.open, text: sink.text, more: sink.more }).toEqual({ open: true, text: "一", more: { on: true, blink: true } });
    const p2 = m.say("二", true);
    expect(await settled(p2)).toBe(true);
    expect(sink.text).toBe("一\n二");
    expect(adv.n).toBe(0);
    expect(m.isOpen()).toBe(true);
    m.tap();
    expect({ open: m.isOpen(), sinkOpen: sink.open, text: sink.text, more: sink.more.on, adv: adv.n }).toEqual({ open: false, sinkOpen: false, text: "", more: false, adv: 1 });
  });

  // M10.5 追補（未定-24。2026-10-07 ユーザーの指示「多い場合はログ形式で」）: 以前の期待値は「次の文が箱に入らないときは ▼ でタップを待ち、
  // タップで箱を空にして続ける（送りの音 1 回、cleared 1 回）」。ログ形式では箱を空にせず溜め続ける（読み返しは DOM の層のスクロール）
  test("UI-47（M10.5 追補）箱の行数（22）を超えても空にせず溜め続ける。▼ で待たず、どの say もタップなしで解決し、送りの音も cleared も無い。▼ は最後の文の後だけ", async () => {
    const { m, sink, adv, cleared, logs } = setup({ speed: 30 });
    const texts = nums(T.talk.lines + 8);
    const done = texts.map((t) => m.say(t, true));
    expect(await settled(Promise.all(done).then(() => undefined))).toBe(true);
    expect(sink.text.split("\n")).toEqual(texts);
    expect({ adv: adv.n, cleared: cleared.n, open: sink.open, more: sink.more }).toEqual({ adv: 0, cleared: 0, open: true, more: { on: true, blink: true } });
    expect(logs).toEqual(texts);
    // 長い文（複数行）が続いても同じ
    const long = "あ".repeat(80);
    expect(await settled(m.say(long, true))).toBe(true);
    expect(sink.text.endsWith(`\n${long}`)).toBe(true);
    m.tap();
    expect({ open: sink.open, adv: adv.n, cleared: cleared.n }).toEqual({ open: false, adv: 1, cleared: 1 });
  });

  test("UI-47（M10.5 追補）溜める文は max（config.ui.messageHistory）まで。超えたら古い文から外す（全文はログ）", async () => {
    const { m, sink, logs } = setup({ max: 3 });
    for (const t of nums(5)) void m.say(t, true);
    expect(sink.text).toBe("文2\n文3\n文4");
    expect(logs).toEqual(nums(5));
    expect(data.config.ui.messageHistory).toBeGreaterThan(T.talk.lines);
  });

  test("UI-47/UI-43 文字送り中のタップは即表示（閉じない・鳴らさない）。続く文は前の文の下に文字送りし、その文の say は文字送りの後に解決する", async () => {
    const { m, sink, tick, adv } = setup({ speed: 30 });
    const p1 = m.say("あいう", false);
    expect(sink.text).toBe("あ");
    expect(m.typing()).toBe(true);
    expect(sink.more.on).toBe(false);
    tick();
    expect(sink.text).toBe("あい");
    m.tap();
    expect(sink.text).toBe("あいう");
    expect(m.typing()).toBe(false);
    expect(await settled(p1)).toBe(true);
    expect({ open: m.isOpen(), adv: adv.n }).toEqual({ open: true, adv: 0 });
    const p2 = m.say("えお", false);
    expect(sink.text).toBe("あいう\nえ");
    expect(await settled(p2)).toBe(false);
    tick();
    expect(sink.text).toBe("あいう\nえお");
    expect(await settled(p2)).toBe(true);
    // 文字送り中に次の文が来たら、文字送りが終わってから続ける
    const p3 = m.say("かき", false);
    const p4 = m.say("く", false);
    expect(sink.text).toBe("あいう\nえお\nか");
    tick();
    expect(await settled(p3)).toBe(true);
    expect(sink.text).toBe("あいう\nえお\nかき\nく");
    expect(await settled(p4)).toBe(true);
  });

  // M10.5 追補: 以前の期待値は「送りの音は箱を空にするタップと閉じるタップ」。箱を空にすることが無くなったので、閉じるタップだけ
  test("UI-66（M10.5 追補）送りの音（advanced）は閉じるタップだけ。箱が開くとき・文が続くとき・箱の行数を超えたとき・文字送りの即表示（tap・rush）・flush では鳴らさない", async () => {
    const { m, tick, adv } = setup({ speed: 30 });
    void m.say("あいう", false);
    expect(adv.n).toBe(0); // 箱が開くときは鳴らさない
    m.tap(); // 即表示
    expect(adv.n).toBe(0);
    for (const t of nums(T.talk.lines + 2)) void m.say(t, false);
    while (tick());
    expect(adv.n).toBe(0); // 文が続く・行数を超えるときは鳴らさない
    void m.say("かきく", false);
    m.rush(); // 文字送り中の即表示（rush）
    expect(adv.n).toBe(0);
    m.rush(); // 最後の文は rush では閉じない
    expect(adv.n).toBe(0);
    expect(m.isOpen()).toBe(true);
    m.tap(); // 閉じる
    expect(adv.n).toBe(1);
    expect(m.isOpen()).toBe(false);
    m.tap(); // 閉じている箱のタップは何もしない
    expect(adv.n).toBe(1);
    void m.say("き", true);
    m.flush();
    expect(adv.n).toBe(1);
  });

  test("UI-47/UI-41 skip（instant）は文字送りだけ省き、最後の文の ▼ のタップ待ちは残る。演出スキップの ▼ は点滅しない", async () => {
    const { m, sink, timers } = setup({ speed: 30, blink: false });
    for (const t of nums(T.talk.lines + 3)) void m.say(t, true);
    const last = m.say("最後", true);
    expect(timers).toHaveLength(0);
    expect(await settled(last)).toBe(true);
    expect({ open: sink.open, more: sink.more }).toEqual({ open: true, more: { on: true, blink: false } });
    m.tap();
    expect(sink.open).toBe(false);
  });

  test("UI-47 rush（再生中のタップ）は即表示だけで、最後の文の箱は閉じない", async () => {
    const { m, sink } = setup({ speed: 30 });
    const p1 = m.say("あいう", false);
    m.rush();
    expect(await settled(p1)).toBe(true);
    expect(sink.text).toBe("あいう");
    m.rush();
    expect(m.isOpen()).toBe(true);
  });

  test("UI-47 flush で待っている say はすべて解決して閉じる。文字送り中の文も解決する。中身のある箱を閉じたら cleared", async () => {
    const { m, sink, cleared } = setup({ speed: 30 });
    const p1 = m.say("あいう", false);
    const p2 = m.say("二", false);
    const p3 = m.say("三", false);
    m.flush();
    expect(await settled(Promise.all([p1, p2, p3]).then(() => undefined))).toBe(true);
    expect({ open: sink.open, more: sink.more.on, typing: m.typing(), cleared: cleared.n }).toEqual({ open: false, more: false, typing: false, cleared: 1 });
    // 閉じた箱の flush では cleared を呼ばない
    m.flush();
    expect(cleared.n).toBe(1);
    // 閉じた後の say は待たずに出る
    const p4 = m.say("四", true);
    expect(await settled(p4)).toBe(true);
    expect(sink.text).toBe("四");
  });

  test("UI-47 replay はログに入れない（迷宮から持ち越した語り）。溜め方は say と同じ", async () => {
    const { m, logs, sink } = setup();
    const p = m.replay(["帰った", "街だ"], true);
    expect(logs).toEqual([]);
    expect(await settled(p)).toBe(true);
    expect(sink.text).toBe("帰った\n街だ");
    // 空なら何も出さない
    const { m: m2, sink: s2 } = setup();
    expect(await settled(m2.replay([], true))).toBe(true);
    expect(s2.open).toBe(false);
  });

  test("UI-47/UI-40 外からの ▼（setMore）は文が出ている間だけ、文字送り中は出さない。下ろすと最後の文の ▼（点滅は blink()）に戻る。clear で下ろす", async () => {
    const { m, sink, tick } = setup({ speed: 30, blink: true });
    m.setMore(true, false);
    // 箱が閉じていれば出さない
    expect(sink.more.on).toBe(false);
    void m.say("あい", false);
    expect(sink.more.on).toBe(false);
    tick();
    expect(sink.more).toEqual({ on: true, blink: false });
    m.setMore(false);
    expect(sink.more).toEqual({ on: true, blink: true });
    m.setMore(true, false);
    expect(sink.more).toEqual({ on: true, blink: false });
    m.clear();
    expect({ open: sink.open, more: sink.more.on }).toEqual({ open: false, more: false });
    void m.say("う", true);
    expect(sink.more).toEqual({ on: true, blink: true });
  });

  // M10.5 追補: 以前は「1 人分（11 文）が 1 ページに収まる」を確かめた。ログ形式ではページが無いので、何人分でもタップなしで溜まることを確かめる
  test("UI-47/CH-61（M10.5 追補）宿屋のレベルアップ 6 人分（1 人 11 文。大きな値）は、タップなしで全部が箱に溜まる（送りの音なし）", async () => {
    const f = (key: string, p: Record<string, string | number>): string => formatMessage(data.strings[key]!, p);
    const name = "アアアアアア";
    const one = [
      f("town.inn.levelUp", { name, level: 99 }),
      f("town.inn.hpUp", { gain: 99, max: 9999 }),
      f("town.inn.mpUp", { gain: 99, max: 9999 }),
      ...STAT_KEYS.map((k) => f(`town.inn.statUp.${k}`, { from: 17, to: 18 })),
      f("town.inn.learnRoll", { name, spell: "縛り言葉" }),
      f("town.inn.learned", { name, spell: "縛り言葉" }),
    ];
    expect(one).toHaveLength(11);
    const texts = Array.from({ length: 6 }, () => one).flat();
    const { m, sink, adv } = setup({ speed: 30, blink: false, max: data.config.ui.messageHistory });
    const done = texts.map((t) => m.say(t, true));
    expect(await settled(Promise.all(done).then(() => undefined))).toBe(true);
    expect(sink.text).toBe(texts.join("\n"));
    expect(adv.n).toBe(0);
  });
});

describe("UI-47/UI-66（M10.5）会話の箱の hold（文の後の出来事の前の待ち）", () => {
  test("UI-47 箱が閉じていれば hold はすぐ解決する", async () => {
    const { m } = setup();
    expect(await settled(m.hold())).toBe(true);
  });

  test("UI-47（M10.5）前の文の文字送りが終わった時点で解ける（タップは要らない・送りの音なし）", async () => {
    const { m, tick, adv, sink } = setup({ speed: 30 });
    void m.say("あい", false);
    const h = m.hold();
    expect(await settled(h)).toBe(false);
    tick();
    expect(await settled(h)).toBe(true);
    expect(await settled(m.hold())).toBe(true);
    expect({ adv: adv.n, open: sink.open, text: sink.text }).toEqual({ adv: 0, open: true, text: "あい" });
  });

  // M10.5 追補: 以前の期待値は「次の文が箱に入らなければ ▼ でタップを待ち、rush で箱を空にしてから解ける」
  test("UI-47/UI-66（M10.5 追補）箱が埋まっていても hold はタップを待たない（前の文の文字送りの終わりで解け、箱は空にしない）。演出スキップでも同じ", async () => {
    for (const blink of [true, false]) {
      const { m, sink, adv, cleared, tick } = setup({ speed: 30, blink });
      const texts = nums(T.talk.lines);
      for (const t of texts) void m.say(t, true);
      void m.say("あい", false);
      const h = m.hold();
      expect(await settled(h)).toBe(false);
      tick();
      expect(await settled(h)).toBe(true);
      expect({ adv: adv.n, cleared: cleared.n, open: sink.open, text: sink.text }).toEqual({ adv: 0, cleared: 0, open: true, text: [...texts, "あい"].join("\n") });
    }
  });

  test("UI-47/UI-66 tap（即表示）でも解ける（送りの音なし）。flush でも解ける", async () => {
    const a = setup({ speed: 30 });
    void a.m.say("あいう", false);
    const h = a.m.hold();
    a.m.tap();
    expect(await settled(h)).toBe(true);
    expect({ adv: a.adv.n, open: a.m.isOpen() }).toEqual({ adv: 0, open: true });
    const b = setup({ speed: 30 });
    void b.m.say("あいう", false);
    const h2 = b.m.hold();
    b.m.flush();
    expect(await settled(h2)).toBe(true);
    expect(b.sink.open).toBe(false);
  });

  test("UI-47 hold は控えている文の後ろに並ぶ（持ち越しの文の文字送りが終わってから解ける）", async () => {
    const { m, sink, tick } = setup({ speed: 30 });
    void m.replay(["一つ目", "二つ目"], false);
    const h = m.hold();
    expect(await settled(h)).toBe(false);
    while (tick());
    expect(sink.text).toBe("一つ目\n二つ目");
    expect(await settled(h)).toBe(true);
  });

  test("UI-47 語りの表示先の hold は、街なら会話の箱の hold、それ以外は待たない。keepsDice は街なら真", async () => {
    const { m } = setup({ speed: 30 });
    let town = true;
    const win: Narration = { say: async () => {}, setMore: () => {}, rush: () => {}, typing: () => false, log: () => {}, waitMs: async () => {} };
    const n = createNarrator({ town: () => town, talk: m, window: win });
    void n.say("あい", false);
    expect(n.keepsDice!()).toBe(true);
    const h = n.hold!();
    expect(await settled(h)).toBe(false);
    town = false;
    expect(n.keepsDice!()).toBe(false);
    expect(await settled(n.hold!())).toBe(true);
    town = true;
    n.rush();
    expect(await settled(h)).toBe(true);
  });
});

describe("UI-66（M10.5）施設の会話の送りの音（page）", () => {
  // 施設に入ると語り（townPageIntro）で箱が開き（音は施設の項目の door / ok。会話の箱は鳴らさない）、
  // 項目（蘇生・泊まる・買うなど）の結果の文は再生中に出る（再生中のステージのタップは場所によらず Player.tap → narrator.rush）。
  // M10.5 追補: page は閉じるタップだけ（箱を空にすることは無くなった）。施設による違いは無い。
  const FACILITIES: TownPage[] = ["temple", "tavern", "inn", "shop", "dark", "gate"];
  const menu = townMenu(newGame(1), data);
  if (menu === null) throw new Error("not in town");

  test.each(FACILITIES)("UI-66 %s: 箱を開くとき・文が続くとき・箱の行数を超えたとき・文字送りの即表示では鳴らさず、閉じるタップで page", async (page) => {
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
    expect(adv.n).toBe(0);
    // 入場の語りの ▼ をタップで閉じる → page
    m.tap();
    expect(adv.n).toBe(1);
    // 項目を選んで再生: 結果の文が箱の行数を超えても、次の出来事の前の hold はタップを待たない
    for (const t of nums(T.talk.lines + 4, "結果")) void n.say(t, false);
    const h = n.hold!();
    while (tick());
    expect(await settled(h)).toBe(true);
    expect(adv.n).toBe(1);
    // 再生の後に残った最後の文を再生の外のタップで閉じる → page
    m.tap();
    expect(adv.n).toBe(2);
    expect(m.isOpen()).toBe(false);
  });
});

describe("UI-47/UI-66（未定-19。M10.5）箱が開いている間はどこのタップも文送り", () => {
  test("UI-47（M10.5）pending は箱が開いている間（文字送り中・最後の文の ▼）と、出す文や hold が控える間は真。閉じたら偽", async () => {
    const { m, tick } = setup({ speed: 30 });
    expect(m.pending()).toBe(false);
    void m.say("一", false);
    expect(m.pending()).toBe(true);
    void m.say("二", false);
    while (tick());
    // 最後の文（二）の ▼（M10.5: 箱は操作の欄に被さるので、これも文送りを待つ間）
    expect({ open: m.isOpen(), pending: m.pending() }).toEqual({ open: true, pending: true });
    m.tap();
    expect({ open: m.isOpen(), pending: m.pending() }).toEqual({ open: false, pending: false });
  });

  // M10.5: 箱が操作の欄に被さるので、最後の文の ▼ の間も一覧は効かない（以前の期待値は「2 文目が残ったら一覧が効く」）。
  // M10.5 追補: 以前は 1 行の箱で 1 回目のタップが「空にして 2 文目」だった。ログ形式では 2 文が溜まり、1 回目のタップで閉じる
  test("UI-66（M10.5 追補）地上に戻ったときの持ち越しの文（replay）: 2 文が箱に溜まり、箱が開いている間は一覧の項目を押しても項目は動かず、page が鳴って箱が閉じる。閉じた後は一覧が効く", () => {
    const { m, sink, adv } = setup();
    const stage = new FakeStage(10);
    const out: string[] = [];
    attachStageInput(stage as unknown as HTMLElement, {
      scale: () => 2,
      threshold: () => 28,
      deadZone: data.config.input.edgeDeadZonePx,
      width: data.config.stage.width,
      swipeEnabled: () => false,
      busy: () => false,
      onBusyTap: () => out.push("busyTap"),
      // app の talkWaits / tapTalk と同じ（再生の外の街で overlay なし）
      talkWaits: () => m.pending(),
      onTalkTap: () => m.tap(),
      onSwipe: () => {},
      onSwipeRelease: () => {},
    });
    const item = new FakeNode("BUTTON", stage);
    item.left = 20;
    item.top = 600;
    onTap(item as unknown as Element, () => {
      // 施設の項目は会話を打ち切ってから施設に入る（app の townItem）
      m.flush();
      out.push("facility");
    });
    const press = (id: number): void => {
      stage.emit("pointerdown", { pointerId: id, clientX: 40, clientY: 620, target: item, pointerType: "touch" });
      stage.emit("pointerup", { pointerId: id, clientX: 40, clientY: 620, target: item });
    };
    const first = data.strings["dungeon.exit"]!;
    const second = data.strings["town.enter"]!;
    void m.replay([first, second], true);
    expect({ text: sink.text, more: sink.more.on }).toEqual({ text: `${first}\n${second}`, more: true });
    // 最後の文の ▼ の間は項目は動かず、箱が閉じる
    press(1);
    expect(out).toEqual([]);
    expect({ open: sink.open, adv: adv.n }).toEqual({ open: false, adv: 1 });
    // 閉じた後は一覧の項目が効く
    press(2);
    expect(out).toEqual(["facility"]);
  });

  // M10.5 追補: 以前は「3 行の箱を埋めて入らない文が ▼ で待つ間も真」を確かめた。ログ形式ではその待ちが無い
  test("UI-47/UI-59（未定-19。M10.5 追補）waiting は文や hold が控える間だけ真。文字送り中の 1 文だけのとき、最後の文の ▼ の間、3 行を超えて溜まった後は偽（迷宮のキャラクター画面の 3 行の箱）", async () => {
    const { m, tick } = setup({ speed: 30 });
    expect(m.waiting()).toBe(false);
    void m.say("一つ目の文", false);
    // 文字送り中の 1 文だけ
    expect({ typing: m.typing(), waiting: m.waiting() }).toEqual({ typing: true, waiting: false });
    void m.say("二つ目の文", false);
    // 続きの文が控えている
    expect(m.waiting()).toBe(true);
    const h = m.hold();
    while (tick());
    expect(await settled(h)).toBe(true);
    // 最後の文の ▼（箱は開いたまま。pending は真）
    expect({ open: m.isOpen(), pending: m.pending(), waiting: m.waiting() }).toEqual({ open: true, pending: true, waiting: false });
    // 3 行の箱を超えて溜めても待たない
    void m.say("三", false);
    void m.say("四", false);
    while (tick());
    expect({ typing: m.typing(), waiting: m.waiting() }).toEqual({ typing: false, waiting: false });
  });

  // M10 の 実機(M10-閉) (5) の振る舞い（M10.5 で一時的に崩れた）を、app の talkWaits の迷宮の側（talk.waiting）で確かめる
  test("UI-47/UI-59（M10.5 の修正）迷宮のキャラクター画面（3 行の箱）: 文字送りの途中に dim の項目を押すと前の文を打ち切って理由を語り直し、最後の文の後は項目が効く（会話を打ち切ってから動く）", () => {
    const { m, sink, adv } = setup({ speed: 30 });
    const stage = new FakeStage(10);
    const out: string[] = [];
    attachStageInput(stage as unknown as HTMLElement, {
      scale: () => 2,
      threshold: () => 28,
      deadZone: data.config.input.edgeDeadZonePx,
      width: data.config.stage.width,
      swipeEnabled: () => false,
      busy: () => false,
      onBusyTap: () => out.push("busyTap"),
      // app の talkWaits の迷宮のキャラクター画面（route が街でない）と同じ
      talkWaits: () => m.waiting(),
      onTalkTap: () => {
        out.push("talkTap");
        m.tap();
      },
      onSwipe: () => {},
      onSwipeRelease: () => {},
    });
    const reason = data.strings["camp.equipReason.cannotAct"]!;
    const item = new FakeNode("BUTTON", stage);
    item.left = 20;
    item.top = 700;
    onTap(item as unknown as Element, () => {
      // app の campReason / item と同じ: 会話の箱を打ち切ってから動く
      m.flush();
      out.push("item");
      void m.say(reason, false);
    });
    const press = (id: number): void => {
      stage.emit("pointerdown", { pointerId: id, clientX: 40, clientY: 720, target: item, pointerType: "touch" });
      stage.emit("pointerup", { pointerId: id, clientX: 40, clientY: 720, target: item });
    };
    press(1);
    expect(out).toEqual(["item"]);
    expect({ open: sink.open, typing: m.typing() }).toEqual({ open: true, typing: true });
    // 文字送りの途中にもう一度押すと、項目が動いて語り直す（箱のタップにはならない）
    press(2);
    expect(out).toEqual(["item", "item"]);
    expect(m.typing()).toBe(true);
    m.rush();
    // 最後の文の ▼ の間も項目が効く（閉じるだけにならない）
    expect({ open: sink.open, more: sink.more.on, text: sink.text }).toEqual({ open: true, more: true, text: reason });
    press(3);
    expect(out).toEqual(["item", "item", "item"]);
    expect(adv.n).toBe(0);
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
  attrs: Record<string, string> = {};
  scrollTop = 0;
  listeners = new Map<string, Array<(e?: unknown) => void>>();
  setAttribute(k: string, v: string): void {
    this.attrs[k] = v;
  }
  appendChild(c: FakeEl): FakeEl {
    this.children.push(c);
    return c;
  }
  addEventListener(type: string, f: (e?: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), f]);
  }
  emit(type: string, e?: unknown): void {
    for (const f of this.listeners.get(type) ?? []) f(e);
  }
  animate(): { finished: Promise<void>; cancel(): void } {
    return { finished: Promise.resolve(), cancel() {} };
  }
}

describe("UI-47 会話の箱（DOM）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const make = () => {
    const created: FakeEl[] = [];
    vi.stubGlobal("document", {
      createElement: () => {
        const e = new FakeEl();
        created.push(e);
        return e;
      },
      createElementNS: () => {
        const e = new FakeEl();
        created.push(e);
        return e;
      },
    });
    const box = createTalkBox({ layout: T.talk, compact: T.talkCompact, strings: data.strings, speed: () => 0, blink: () => true, log: () => {} });
    const el = box.el as unknown as FakeEl;
    const body = created.find((e) => e.className === "talk-text")!;
    const line = created.find((e) => e.className === "talk-line")!;
    const up = created.find((e) => e.className.includes("scroll-mark-up"))!;
    const down = created.find((e) => e.className.includes("scroll-mark-down"))!;
    const pos = (e: FakeEl) => ({ left: e.style["left"], top: e.style["top"], width: e.style["width"], height: e.style["height"] });
    // 文字領域の寸法の偽物: 見える高さは開いている間 22 行（220px）、中身の高さは改行の数 × 10px
    Object.defineProperty(body, "clientHeight", { get: () => (el.style["display"] === "none" ? 0 : 220) });
    Object.defineProperty(body, "scrollHeight", { get: () => (line.textContent === "" ? 0 : line.textContent.split("\n").length * 10) });
    /** 指で scrollTop まで動かした（scroll が届く） */
    const swipeTo = (top: number): void => {
      body.scrollTop = top;
      body.emit("scroll");
    };
    const marks = () => ({ up: up.style["visibility"], down: down.style["visibility"] });
    return { box, el, body, line, up, down, pos, swipeTo, marks };
  };

  // M10.5 追補（未定-24）: 以前の期待値は overflow hidden・touchAction none（指でスクロールしない）
  test("UI-47/UI-13（M10.5 追補）箱は townLayout の talk（x0..239・y166..399）。文字領域は 22 行の上詰めで WRAP_STYLE（UI-43 の禁則）、縦にスクロールし指でも動かせる（pan-y）。最初は閉じている。文は改行でつなぐ", async () => {
    const { box, el, body, line, pos } = make();
    expect({ ...pos(el), display: el.style["display"] }).toEqual({ left: "0px", top: "166px", width: "240px", height: "234px", display: "none" });
    // 枠 1px の内側が原点（文字 x5・y169 → 4, 2）。224×220 = 22 行
    expect(pos(body)).toEqual({ left: "4px", top: "2px", width: "224px", height: "220px" });
    expect(T.talk.lines).toBe(22);
    expect({ x: body.style["overflowX"], y: body.style["overflowY"], touch: body.style["touchAction"] }).toEqual({ x: "hidden", y: "auto", touch: "pan-y" });
    expect(body.style["justifyContent"]).toBe("flex-start");
    for (const [k, v] of Object.entries(WRAP_STYLE)) expect(body.style[k], k).toBe(v);
    await box.say("一", true);
    await box.say("二", true);
    expect({ text: line.textContent, display: el.style["display"] }).toEqual({ text: "一\n二", display: "" });
  });

  test("UI-47/UI-59（M10.5）setCompact で迷宮のキャラクター画面の 3 行の箱（x2..237・y128..163）に切り替え、戻せる", () => {
    const { box, el, body, pos } = make();
    box.setCompact(true);
    expect(pos(el)).toEqual({ left: "2px", top: "128px", width: "236px", height: "36px" });
    expect(pos(body)).toEqual({ left: "4px", top: "2px", width: "220px", height: "30px" });
    box.setCompact(false);
    expect(pos(el)).toEqual({ left: "0px", top: "166px", width: "240px", height: "234px" });
  });

  test("UI-47/UI-11（M10.5 追補）続きの印は右の余白の列に置く（広い箱 x230・y169 と y381、3 行の箱 x228・y131 と y153。字は strings の scroll.up / scroll.down、accent 色、押せない、点滅しない）", () => {
    const { box, up, down, pos } = make();
    expect(talkMarkPos(T.talk)).toEqual({ up: { x: 229, y: 2 }, down: { x: 229, y: 214 } });
    expect([pos(up), pos(down)]).toEqual([
      { left: "229px", top: "2px", width: "8px", height: "8px" },
      { left: "229px", top: "214px", width: "8px", height: "8px" },
    ]);
    // ステージ座標: 枠の x0 + 枠 1 + 229 = x230（文字 x5..228 と ▼ x221..228 の右）。y166 + 1 + 2 = y169、y166 + 1 + 214 = y381
    expect({ up: up.textContent, down: down.textContent }).toEqual({ up: data.strings["scroll.up"], down: data.strings["scroll.down"] });
    expect([data.strings["scroll.up"], data.strings["scroll.down"]]).toEqual(["▲", "▼"]);
    for (const m of [up, down]) expect({ color: m.style["color"], pe: m.style["pointerEvents"] }).toEqual({ color: "var(--c-accent)", pe: "none" });
    box.setCompact(true);
    // 3 行の箱（2026-10-07 レビューで文字の幅を 224 → 220 にした。以前は印が x230..237 で文字の最後の列 x230・▼・枠線 x237 に重なった）:
    // 枠 x2 + 1 + 225 = x228..235（文字 x7..226 と ▼ x219..226 の右に 1px、枠線 x237 の左に 1px）。y128 + 1 + 2 = y131、y128 + 1 + 24 = y153
    expect([pos(up).left, pos(up).top, pos(down).top]).toEqual(["225px", "2px", "24px"]);
  });

  test("UI-47/UI-11（M10.5 追補）続きの印は、どちらの箱でも文字領域・▼・枠線と重ならない（間に 1px ずつ）", () => {
    for (const r of [T.talk, T.talkCompact]) {
      const p = talkMarkPos(r);
      const left = r.box.x + 1 + p.up.x;
      const right = left + SCROLL_MARK_SIZE - 1;
      expect(left, JSON.stringify(r.box)).toBe(r.text.x + r.text.w + 1);
      expect(left).toBeGreaterThan(r.more.x + r.more.w - 1);
      expect(right, JSON.stringify(r.box)).toBe(r.box.x + r.box.w - 1 - 2);
    }
    expect(TALK_MARK_GUTTER).toBe(SCROLL_MARK_SIZE + 2);
  });

  test("UI-47/UI-11（M10.5 追補）ログ形式: 22 行を超えたら最新の行に追従し、上に続きの印。指で上へ戻すと追従をやめて下に続きの印、下端に戻すと追従に戻る。閉じると印は消える", async () => {
    const { box, body, line, swipeTo, marks } = make();
    for (const t of nums(20)) await box.say(t, true);
    expect({ top: body.scrollTop, ...marks() }).toEqual({ top: 0, up: "hidden", down: "hidden" });
    for (const t of nums(10, "続")) await box.say(t, true);
    // 30 行 = 300px、見える 220px → 下端の 80 に追従。上に続きがある
    expect({ top: body.scrollTop, ...marks() }).toEqual({ top: 80, up: "visible", down: "hidden" });
    // 追従の送り自身の scroll（遅れて届く）は、その間に中身だけが伸びても（字の読み込みで折り返しが増えたなど）利用者のスクロールとみなさない
    line.textContent += "\n伸びた";
    body.emit("scroll");
    await box.say("次", true);
    expect(body.scrollTop).toBe(90);
    // 指で先頭へ: 上の印は消え、下の印が出る。新しい文が来ても追従しない
    swipeTo(0);
    expect(marks()).toEqual({ up: "hidden", down: "visible" });
    await box.say("さらに", true);
    expect({ top: body.scrollTop, ...marks() }).toEqual({ top: 0, up: "hidden", down: "visible" });
    // 途中は両方
    swipeTo(40);
    expect(marks()).toEqual({ up: "visible", down: "visible" });
    // 下端（320 − 220 = 100）に戻すと追従に戻る
    swipeTo(100);
    expect(marks()).toEqual({ up: "visible", down: "hidden" });
    await box.say("最後", true);
    expect({ top: body.scrollTop, ...marks() }).toEqual({ top: 110, up: "visible", down: "hidden" });
    // ↑↓ キー（scrollBy）は 3 行ずつ
    box.scrollBy(-TALK_KEY_LINES);
    expect({ top: body.scrollTop, ...marks() }).toEqual({ top: 80, up: "visible", down: "visible" });
    box.scrollBy(TALK_KEY_LINES);
    expect(marks()).toEqual({ up: "visible", down: "hidden" });
    // 閉じると印は消え、次に開いたときは追従から始める
    box.scrollBy(-TALK_KEY_LINES);
    box.tap();
    expect(marks()).toEqual({ up: "hidden", down: "hidden" });
    for (const t of nums(25)) await box.say(t, true);
    expect({ top: body.scrollTop, ...marks() }).toEqual({ top: 30, up: "visible", down: "hidden" });
  });

  // レビュー（2026-10-07）: 追従をやめる判断を scroll（後から届く）だけで行うと、その前に来た文字送りの送りが読み返しを下端へ引き戻す
  test("UI-47（M10.5 追補）文字送りの途中で指が触れたら、scroll が届く前の送りでも下端へ引き戻さない。動かさずに離せば（タップ）追従に戻る。ホイールを上へ回しても引き戻さない", async () => {
    const { box, body, marks } = make();
    for (const t of nums(30)) await box.say(t, true);
    expect(body.scrollTop).toBe(80);
    // 指が触れて上へ動かした（scroll はまだ届かない）ところに次の文
    body.emit("pointerdown");
    body.emit("touchstart");
    body.scrollTop = 40;
    await box.say("次", true);
    expect(body.scrollTop).toBe(40);
    // 遅れて scroll が届き、指を離しても（動いていて下端でない）追従しない
    body.emit("scroll");
    body.emit("pointerup");
    body.emit("touchend");
    await box.say("また", true);
    expect({ top: body.scrollTop, ...marks() }).toEqual({ top: 40, up: "visible", down: "visible" });
    // 下端（32 行 − 22 = 100）へ戻して追従に戻ってから、動かさずに触れて離す（タップ）間に文が来ても、離せば下端へ
    body.scrollTop = 100;
    body.emit("scroll");
    body.emit("pointerdown");
    await box.say("触れている間", true);
    expect(body.scrollTop).toBe(100);
    body.emit("pointerup");
    expect({ top: body.scrollTop, ...marks() }).toEqual({ top: 110, up: "visible", down: "hidden" });
    await box.say("追従", true);
    expect(body.scrollTop).toBe(120);
    // ホイールを上へ回した時点でやめる（scroll が届く前の送りでも引き戻さない）
    body.emit("wheel", { deltaY: -10 });
    body.scrollTop = 90;
    await box.say("ホイール", true);
    expect(body.scrollTop).toBe(90);
  });
});
