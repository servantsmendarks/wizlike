import { afterEach, describe, expect, test, vi } from "vitest";
import { regions, townLayout } from "../src/presenter/layout";
import { createNarrator, createTalkBox, createTalkModel, talkRows, type Narration, type TalkSink } from "../src/presenter/views/talk";
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

/** 偽の表示先と手動のタイマー。lines / cols は箱の行数と 1 行の単位（既定は街の箱 = townLayout の talk） */
function setup(o: { speed?: number; blink?: boolean; lines?: number; cols?: number } = {}) {
  const logs: string[] = [];
  /** UI-66: 送りの音の回数 */
  const adv = { n: 0 };
  /** UI-40（M10.5）: 中身のある箱を空にした・閉じた回数（判定の箱を消す契機） */
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
    lines: () => o.lines ?? T.talk.lines,
    cols: () => o.cols ?? T.talk.cols,
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

/** 全角 n 字の文（1 行 = 全角 28 字に収まる長さで使う） */
const zen = (n: number, c = "あ"): string => c.repeat(n);

describe("UI-47（M10.5）talkRows（文の行数の見積もり）", () => {
  test("UI-47 1 行の単位（半角 1・全角 2）に収まれば 1 行。収まらなければ禁則の送りの分（全角 1 字）を見込んで多めに数える。改行は段ごと", () => {
    expect(T.talk.cols).toBe(56);
    expect(talkRows("", 56)).toBe(1);
    expect(talkRows(zen(28), 56)).toBe(1);
    expect(talkRows("a".repeat(56), 56)).toBe(1);
    expect(talkRows(zen(29), 56)).toBe(2);
    // 全角 54 字 = 108 単位 → 1 行 54 単位で 2 行。55 字は 3 行（多めに数える）
    expect(talkRows(zen(54), 56)).toBe(2);
    expect(talkRows(zen(55), 56)).toBe(3);
    expect(talkRows(`${zen(3)}\n${zen(3)}`, 56)).toBe(2);
  });
});

describe("UI-47（M10.5）会話の箱（モデル）: 文を溜める", () => {
  test("UI-47 say は呼んだ時点でログに入る（表示される前でも、flush で打ち切られても）", async () => {
    const { m, logs, sink } = setup({ lines: 2 });
    void m.say("一", true);
    void m.say("二", true);
    void m.say("三", true);
    expect(logs).toEqual(["一", "二", "三"]);
    // 2 行の箱には 2 文まで
    expect(sink.text).toBe("一\n二");
    m.flush();
    expect(logs).toEqual(["一", "二", "三"]);
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

  test("UI-47（M10.5）次の文が箱に入らないときだけ ▼ を点滅させてタップを待ち、タップで箱を空にして続ける（送りの音 1 回）。前の文は消え、全文はログ", async () => {
    const { m, sink, adv, logs, cleared } = setup({ lines: 3 });
    void m.say("一", true);
    void m.say("二", true);
    void m.say("三", true);
    const p4 = m.say("四", true);
    expect(sink.text).toBe("一\n二\n三");
    expect(await settled(p4)).toBe(false);
    expect(sink.more).toEqual({ on: true, blink: true });
    expect(m.pending()).toBe(true);
    m.tap();
    expect(await settled(p4)).toBe(true);
    expect({ text: sink.text, open: sink.open, adv: adv.n, cleared: cleared.n }).toEqual({ text: "四", open: true, adv: 1, cleared: 1 });
    expect(logs).toEqual(["一", "二", "三", "四"]);
    // 2 行の文は 2 行と数える（残り 2 行の箱に入る）。次の 1 行は入らない
    const long = zen(40);
    void m.say(long, true);
    expect(sink.text).toBe(`四\n${long}`);
    const p6 = m.say("六", true);
    expect(await settled(p6)).toBe(false);
    m.rush();
    expect(await settled(p6)).toBe(true);
    expect({ text: sink.text, adv: adv.n }).toEqual({ text: "六", adv: 2 });
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

  test("UI-66（M10.5）送りの音（advanced）は箱を空にするタップと閉じるタップだけ（tap・rush で同じ）。箱が開くとき・文が続くとき・文字送りの即表示・flush では鳴らさない", async () => {
    const { m, tick, adv } = setup({ speed: 30, lines: 2 });
    void m.say("あいう", false);
    expect(adv.n).toBe(0); // 箱が開くときは鳴らさない
    m.tap(); // 即表示
    expect(adv.n).toBe(0);
    void m.say("えお", false);
    tick();
    tick();
    expect(adv.n).toBe(0); // 文が続くときは鳴らさない
    void m.say("かきく", false);
    m.rush(); // 埋まった箱を再生中のタップで空にする（送り）
    expect(adv.n).toBe(1);
    m.rush(); // 文字送り中の即表示（rush）
    expect(adv.n).toBe(1);
    m.rush(); // 最後の文は rush では閉じない
    expect(adv.n).toBe(1);
    expect(m.isOpen()).toBe(true);
    m.tap(); // 閉じる
    expect(adv.n).toBe(2);
    expect(m.isOpen()).toBe(false);
    m.tap(); // 閉じている箱のタップは何もしない
    expect(adv.n).toBe(2);
    void m.say("き", true);
    m.flush();
    expect(adv.n).toBe(2);
  });

  test("UI-47/UI-41 skip（instant）は文字送りだけ省き、▼ のタップ待ち（埋まったとき・最後の文）は残る。演出スキップの ▼ は点滅しない", async () => {
    const { m, sink, timers } = setup({ speed: 30, blink: false, lines: 1 });
    void m.say("一", true);
    const p2 = m.say("二", true);
    expect(timers).toHaveLength(0);
    expect(await settled(p2)).toBe(false);
    expect(sink.more).toEqual({ on: true, blink: false });
    m.tap();
    expect(await settled(p2)).toBe(true);
    // 最後の文の ▼ も残り、タップで閉じる
    expect({ open: sink.open, more: sink.more }).toEqual({ open: true, more: { on: true, blink: false } });
    m.tap();
    expect(sink.open).toBe(false);
  });

  test("UI-47 rush（再生中のタップ）は即表示か、埋まった箱を空にして続けるが、最後の文の箱は閉じない", async () => {
    const { m } = setup({ lines: 1 });
    void m.say("一", true);
    const p2 = m.say("二", true);
    m.rush();
    expect(await settled(p2)).toBe(true);
    m.rush();
    expect(m.isOpen()).toBe(true);
  });

  test("UI-47 flush で待っている say はすべて解決して閉じる。文字送り中の文も解決する。中身のある箱を閉じたら cleared", async () => {
    const { m, sink, cleared } = setup({ speed: 30, lines: 1 });
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

  test("UI-47/CH-61（M10.5）宿屋のレベルアップ 1 人分（レベル・HP・MP・能力値 6 つ・習得の判定と覚えた の 11 文。大きな値）が街の箱の 1 ページに収まる", async () => {
    const f = (key: string, p: Record<string, string | number>): string => formatMessage(data.strings[key]!, p);
    const name = "アアアアアア";
    const texts = [
      f("town.inn.levelUp", { name, level: 99 }),
      f("town.inn.hpUp", { gain: 99, max: 9999 }),
      f("town.inn.mpUp", { gain: 99, max: 9999 }),
      ...STAT_KEYS.map((k) => f(`town.inn.statUp.${k}`, { from: 17, to: 18 })),
      f("town.inn.learnRoll", { name, spell: "縛り言葉" }),
      f("town.inn.learned", { name, spell: "縛り言葉" }),
    ];
    expect(texts).toHaveLength(11);
    expect(T.talk.lines).toBe(22);
    expect(texts.reduce((n, t) => n + talkRows(t, T.talk.cols), 0)).toBeLessThanOrEqual(T.talk.lines);
    const { m, sink, adv } = setup({ speed: 30, blink: false });
    const done = texts.map((t) => m.say(t, true));
    expect(await settled(Promise.all(done).then(() => undefined))).toBe(true);
    expect(sink.text).toBe(texts.join("\n"));
    expect(adv.n).toBe(0);
  });
});

describe("UI-47/UI-66（M10.5）会話の箱の hold（文の後の出来事の前の待ち）", () => {
  test("UI-47 箱が閉じていれば hold はすぐ解決する（次の文があっても）", async () => {
    const { m } = setup();
    expect(await settled(m.hold())).toBe(true);
    expect(await settled(m.hold(zen(28)))).toBe(true);
  });

  test("UI-47（M10.5）次の文が今の箱に入る（次の文が無い）なら、前の文の文字送りが終わった時点で解ける（タップは要らない・送りの音なし）", async () => {
    const { m, tick, adv, sink } = setup({ speed: 30 });
    void m.say("あい", false);
    const h = m.hold("う");
    expect(await settled(h)).toBe(false);
    tick();
    expect(await settled(h)).toBe(true);
    expect(await settled(m.hold())).toBe(true);
    expect({ adv: adv.n, open: sink.open, text: sink.text }).toEqual({ adv: 0, open: true, text: "あい" });
  });

  test("UI-47/UI-66（M10.5）次の文が箱に入らなければ ▼ を点滅させてタップを待つ。rush で解け（送りの音を 1 回）、箱は空のまま開いていて、次の say は空の箱の 1 行目に出る", async () => {
    const { m, sink, adv, cleared } = setup({ lines: 2 });
    void m.say("一", true);
    void m.say("二", true);
    const h = m.hold("三");
    expect(await settled(h)).toBe(false);
    expect(sink.more).toEqual({ on: true, blink: true });
    expect(m.pending()).toBe(true);
    m.rush();
    expect(await settled(h)).toBe(true);
    expect({ adv: adv.n, cleared: cleared.n, open: sink.open, text: sink.text, more: sink.more.on }).toEqual({ adv: 1, cleared: 1, open: true, text: "", more: false });
    const p3 = m.say("三", true);
    expect(await settled(p3)).toBe(true);
    expect(sink.text).toBe("三");
  });

  test("UI-47/UI-66 tap でも解ける（送りの音を 1 回）。flush でも解ける。演出スキップの ▼ は点滅しない", async () => {
    const a = setup({ lines: 1 });
    void a.m.say("一", true);
    const h = a.m.hold("二");
    a.m.tap();
    expect(await settled(h)).toBe(true);
    expect(a.adv.n).toBe(1);
    const b = setup({ blink: false, lines: 1 });
    void b.m.say("一", true);
    const h2 = b.m.hold("二");
    expect(b.sink.more).toEqual({ on: true, blink: false });
    b.m.flush();
    expect(await settled(h2)).toBe(true);
    expect(b.sink.open).toBe(false);
  });

  test("UI-47 hold は控えている文の後ろに並ぶ（持ち越しの文が埋まって待つ間は、その後で判定する）", async () => {
    const { m, sink } = setup({ lines: 1 });
    void m.replay(["一", "二"], true);
    const h = m.hold();
    expect(await settled(h)).toBe(false);
    m.tap();
    expect(sink.text).toBe("二");
    expect(await settled(h)).toBe(true);
  });

  test("UI-47 語りの表示先の hold は、街なら会話の箱の hold（次の文を渡す）、それ以外は待たない。keepsDice は街なら真", async () => {
    const { m } = setup({ lines: 1 });
    let town = true;
    const win: Narration = { say: async () => {}, setMore: () => {}, rush: () => {}, typing: () => false, log: () => {}, waitMs: async () => {} };
    const n = createNarrator({ town: () => town, talk: m, window: win });
    await n.say("一", true);
    expect(n.keepsDice!()).toBe(true);
    const h = n.hold!("二");
    expect(await settled(h)).toBe(false);
    town = false;
    expect(n.keepsDice!()).toBe(false);
    expect(await settled(n.hold!("二"))).toBe(true);
    town = true;
    n.rush();
    expect(await settled(h)).toBe(true);
  });
});

describe("UI-66（M10.5）施設の会話の送りの音（page）", () => {
  // 施設に入ると語り（townPageIntro）で箱が開き（音は施設の項目の door / ok。会話の箱は鳴らさない）、
  // 項目（蘇生・泊まる・買うなど）の結果の文は再生中に出る（再生中のステージのタップは場所によらず Player.tap → narrator.rush）。
  // page は、箱が埋まって空にするタップ（再生の中の rush でも外の tap でも）と、閉じるタップ。施設による違いは無い。
  const FACILITIES: TownPage[] = ["temple", "tavern", "inn", "shop", "dark", "gate"];
  const menu = townMenu(newGame(1), data);
  if (menu === null) throw new Error("not in town");

  test.each(FACILITIES)("UI-66 %s: 箱を開くとき・文が続くとき・文字送りの即表示では鳴らさず、埋まった箱を空にするタップと閉じるタップで page", async (page) => {
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
    // 項目を選んで再生: 結果の文が箱を埋め、次の出来事の前の hold で ▼（再生中のタップで空にする → page）
    const filler = Array.from({ length: T.talk.lines }, (_, i) => `結果${i}`);
    for (const t of filler) void n.say(t, false);
    while (tick());
    expect(adv.n).toBe(1);
    const h = n.hold!("次の文");
    expect(await settled(h)).toBe(false);
    n.rush();
    expect(await settled(h)).toBe(true);
    expect(adv.n).toBe(2);
    // 再生の後に残った最後の文を再生の外のタップで閉じる → page
    void n.say("次の文", true);
    m.tap();
    expect(adv.n).toBe(3);
    expect(m.isOpen()).toBe(false);
  });
});

describe("UI-47/UI-66（未定-19。M10.5）箱が開いている間はどこのタップも文送り", () => {
  test("UI-47（M10.5）pending は箱が開いている間（文字送り中・▼ で待つ・最後の文の ▼）と、出す文や hold が控える間は真。閉じたら偽", async () => {
    const { m, tick } = setup({ speed: 30, lines: 1 });
    expect(m.pending()).toBe(false);
    void m.say("一", false);
    expect(m.pending()).toBe(true);
    void m.say("二", false);
    while (tick());
    // 一 が出て、二 が入らず ▼
    expect(m.pending()).toBe(true);
    m.tap();
    while (tick());
    // 最後の文（二）の ▼（M10.5: 箱は操作の欄に被さるので、これも文送りを待つ間）
    expect({ open: m.isOpen(), pending: m.pending() }).toEqual({ open: true, pending: true });
    m.tap();
    expect({ open: m.isOpen(), pending: m.pending() }).toEqual({ open: false, pending: false });
  });

  // M10.5: 箱が操作の欄に被さるので、最後の文の ▼ の間も一覧は効かない（以前の期待値は「2 文目が残ったら一覧が効く」。未定-19 の
  // 「最後の文だけなら一覧が効く」は M10.5 で、箱を閉じるタップの後に効く、に改めた）
  test("UI-66（M10.5）地上に戻ったときの持ち越しの文（replay）: 箱が開いている間は一覧の項目を押しても項目は動かず、page が鳴って箱が閉じる。閉じた後は一覧が効く", () => {
    const { m, sink, adv } = setup({ lines: 1 });
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
    expect({ text: sink.text, more: sink.more.on }).toEqual({ text: first, more: true });
    press(1);
    expect(out).toEqual([]);
    expect(adv.n).toBe(1);
    expect({ open: sink.open, text: sink.text, more: sink.more.on }).toEqual({ open: true, text: second, more: true });
    // 最後の文の ▼ の間も項目は動かず、箱が閉じる
    press(2);
    expect(out).toEqual([]);
    expect({ open: sink.open, adv: adv.n }).toEqual({ open: false, adv: 2 });
    // 閉じた後は一覧の項目が効く
    press(3);
    expect(out).toEqual(["facility"]);
  });

  test("UI-47/UI-59（未定-19。M10.5 の修正）waiting は箱が埋まって ▼ で待つか、文や hold が控える間だけ真。文字送り中の 1 文だけのときと最後の文の ▼ の間は偽（迷宮のキャラクター画面の 3 行の箱）", async () => {
    const { m, tick } = setup({ speed: 30, lines: T.talkCompact.lines, cols: T.talkCompact.cols });
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
    // 3 行の箱を埋めて、入らない文が ▼ で待つ
    void m.say("三", false);
    void m.say("四", false);
    while (tick());
    expect({ text: m.typing(), waiting: m.waiting() }).toEqual({ text: false, waiting: true });
    m.tap();
    while (tick());
    expect(m.waiting()).toBe(false);
  });

  // M10 の 実機(M10-閉) (5) の振る舞い（M10.5 で一時的に崩れた）を、app の talkWaits の迷宮の側（talk.waiting）で確かめる
  test("UI-47/UI-59（M10.5 の修正）迷宮のキャラクター画面（3 行の箱）: 文字送りの途中に dim の項目を押すと前の文を打ち切って理由を語り直し、最後の文の後は項目が効く（会話を打ち切ってから動く）", () => {
    const { m, sink, adv } = setup({ speed: 30, lines: T.talkCompact.lines, cols: T.talkCompact.cols });
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
  setAttribute(k: string, v: string): void {
    this.attrs[k] = v;
  }
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
    const box = createTalkBox({ layout: T.talk, compact: T.talkCompact, speed: () => 0, blink: () => true, log: () => {} });
    const el = box.el as unknown as FakeEl;
    const body = created.find((e) => e.className === "talk-text")!;
    const line = created.find((e) => e.className === "talk-line")!;
    const pos = (e: FakeEl) => ({ left: e.style["left"], top: e.style["top"], width: e.style["width"], height: e.style["height"] });
    return { box, el, body, line, pos };
  };

  test("UI-47/UI-13（M10.5）箱は townLayout の talk（x0..239・y166..399）。文字領域は 22 行の上詰めで WRAP_STYLE（UI-43 の禁則）、指でスクロールしない。最初は閉じている。文は改行でつなぐ", async () => {
    const { box, el, body, line, pos } = make();
    expect({ ...pos(el), display: el.style["display"] }).toEqual({ left: "0px", top: "166px", width: "240px", height: "234px", display: "none" });
    // 枠 1px の内側が原点（文字 x5・y169 → 4, 2）。224×220 = 22 行
    expect(pos(body)).toEqual({ left: "4px", top: "2px", width: "224px", height: "220px" });
    expect(T.talk.lines).toBe(22);
    expect(body.style["overflow"]).toBe("hidden");
    expect(body.style["touchAction"]).toBe("none");
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
    expect(pos(body)).toEqual({ left: "4px", top: "2px", width: "224px", height: "30px" });
    box.setCompact(false);
    expect(pos(el)).toEqual({ left: "0px", top: "166px", width: "240px", height: "234px" });
  });
});
