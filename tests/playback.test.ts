import { afterEach, describe, expect, test, vi } from "vitest";
import { beatWait, createPlayer, createTapLatch, type PlayerDeps } from "../src/presenter/playback";
import { formatDiceSummary, type DiceEvent } from "../src/presenter/views/dice";
import { formatMessage } from "../src/presenter/views/message";
import type { Settings } from "../src/presenter/settings";
import type { Dive, EnemyGroupView, GameEvent, GameState, PenaltyResult, ViewPoint } from "../src/core/types";
import { data, expectKnownStringKeys, newGame } from "./helpers/core";

function diveAt(x: number, y: number, facing: Dive["facing"], floor = 1): Dive {
  return {
    dungeonId: data.dungeons[0]!.id,
    diveSeed: 1,
    floor,
    deepestFloor: floor,
    pos: { x, y },
    facing,
    explored: {},
    clearedCells: [],
    bossDefeated: false,
    ledger: { items: [], gold: 0 },
  };
}

function stateWith(dive: Dive | null): GameState {
  const s = newGame(1);
  return { ...s, screen: dive === null ? "town" : "dungeon", dive };
}

type Log = Array<{ m: string; a: unknown[] }>;

/** すべての呼び出しを順に記録する偽物の deps。fade は apply を同期で呼んで即座に解決する */
function fakeDeps(settings: Partial<Settings> = {}): { deps: PlayerDeps; log: Log } {
  // beat.waitTap は記録してすぐに解決する（タップを待つ試験は beat を外して player.tap() で解く）
  const log: Log = [];
  const rec =
    (m: string) =>
    (...a: unknown[]): void => {
      log.push({ m, a: JSON.parse(JSON.stringify(a)) as unknown[] });
    };
  const s: Settings = { skipAnimations: false, textSpeed: 30, inputMode: "both", swipeThreshold: 28, holdRepeatMs: 250, autoBeatMs: 400, ...settings };
  const deps: PlayerDeps = {
    data,
    strings: data.strings,
    settings: () => s,
    view: {
      fade(ms, apply) {
        log.push({ m: "view.fade", a: [ms] });
        apply();
        return Promise.resolve();
      },
      showAt: (_state, at) => rec("view.showAt")(at),
      shake(ms) {
        log.push({ m: "view.shake", a: [ms] });
        return Promise.resolve();
      },
    },
    header: { showAt: (_state, at) => rec("header.showAt")(at) },
    message: {
      say(text, instant) {
        log.push({ m: "message.say", a: [text, instant] });
        return Promise.resolve();
      },
      setMore: rec("message.setMore"),
      rush: rec("message.rush"),
      log: rec("message.log"),
      waitMs(ms) {
        log.push({ m: "message.waitMs", a: [ms] });
        return Promise.resolve();
      },
    },
    party: {
      setHp: rec("party.setHp"),
      setSan: rec("party.setSan"),
      setLife: rec("party.setLife"),
      setMp: rec("party.setMp"),
      setMax: rec("party.setMax"),
      setStatus: rec("party.setStatus"),
      flash(id, ms) {
        log.push({ m: "party.flash", a: [id, ms] });
        return Promise.resolve();
      },
    },
    battle: {
      setGroups: rec("battle.setGroups"),
      removeOne(g, ms) {
        log.push({ m: "battle.removeOne", a: [g, ms] });
        return Promise.resolve();
      },
      flash(g, ms) {
        log.push({ m: "battle.flash", a: [g, ms] });
        return Promise.resolve();
      },
      clear: rec("battle.clear"),
    },
    dice: {
      show(ev, skip, stepMs) {
        log.push({ m: "dice.show", a: [ev.label.key, skip(), stepMs] });
        return Promise.resolve();
      },
      hide: rec("dice.hide"),
    },
    screens: { show: (to) => rec("screens.show")(to), sync: (st) => log.push({ m: "screens.sync", a: [st] }) },
    wipe: { show: (p) => rec("wipe.show")(p) },
    beat: {
      waitTap() {
        log.push({ m: "beat.waitTap", a: [] });
        return Promise.resolve();
      },
      release: rec("beat.release"),
    },
  };
  return { deps, log };
}

const names = (log: Log): string[] => log.map((e) => e.m);

/** UI-40 の dice（出目 1 行）。label と結果のキーだけを変える */
function rollDiceEv(label: string, dice: number[], total: number, result: string): GameEvent {
  return {
    kind: "dice",
    label: { key: label },
    rows: [{ label: { key: "dice.row.roll" }, base: null, dice, total }],
    rule: { key: "dice.rule.rate", params: { rate: 50 } },
    result: { key: result },
  };
}
/** UI-40 の先手判定（2 行） */
const INITIATIVE: GameEvent = {
  kind: "dice",
  label: { key: "dice.initiative" },
  rows: [
    { label: { key: "dice.side.party" }, base: 8, dice: [4], total: 12 },
    { label: { key: "dice.side.enemy" }, base: 9, dice: [2], total: 11 },
  ],
  rule: { key: "dice.initiative.rule", params: { diff: 1, need: 5, ambush: 5 } },
  result: { key: "dice.initiative.none" },
};

afterEach(() => {
  vi.useRealTimers();
});

describe("UI-41 playback", () => {
  test("UI-41 skipAnimations が真なら、[message, moved, turned, floorChanged, hpChanged] を fade(0) と say(instant) だけで解決する", async () => {
    vi.useFakeTimers();
    const { deps, log } = fakeDeps({ skipAnimations: true });
    const before = stateWith(diveAt(3, 3, "N"));
    const after = stateWith(diveAt(3, 2, "E", 2));
    const events: GameEvent[] = [
      { kind: "message", key: "dungeon.door" },
      { kind: "moved", pos: { x: 3, y: 2 }, facing: "N" },
      { kind: "turned", facing: "E" },
      { kind: "floorChanged", floor: 2, pos: { x: 3, y: 2 }, facing: "E" },
      { kind: "hpChanged", id: "c1", delta: -2, hp: 5 },
    ];
    // タイマーを 1 つも進めずに解決すること（setTimeout も待たない）
    await createPlayer(deps).play(events, before, after);
    expect(vi.getTimerCount()).toBe(0);
    const fades = log.filter((e) => e.m === "view.fade").map((e) => e.a[0]);
    expect(fades).toEqual([0, 0, 0]);
    const says = log.filter((e) => e.m === "message.say");
    expect(says).toEqual([{ m: "message.say", a: [data.strings["dungeon.door"], true] }]);
    expect(log.filter((e) => e.m === "party.setHp").map((e) => e.a)).toEqual([["c1", 5]]);
    // UI-42 の被弾のフラッシュも 0ms
    expect(log.filter((e) => e.m === "party.flash").map((e) => e.a)).toEqual([["c1", 0]]);
  });

  test("UI-41/UI-23 演出ありならフェードは config.ui.viewFadeMs、文字送りは instant=false", async () => {
    const { deps, log } = fakeDeps({ skipAnimations: false });
    const before = stateWith(diveAt(3, 3, "N"));
    await createPlayer(deps).play(
      [
        { kind: "moved", pos: { x: 3, y: 2 }, facing: "N" },
        { kind: "message", key: "dungeon.blocked" },
      ],
      before,
      before,
    );
    expect(log.filter((e) => e.m === "view.fade").map((e) => e.a[0])).toEqual([data.config.ui.viewFadeMs]);
    expect(log.filter((e) => e.m === "message.say").map((e) => e.a[1])).toEqual([false]);
  });

  test("UI-41 kind ごとのメソッドがイベントの順に呼ばれる", async () => {
    const { deps, log } = fakeDeps();
    const before = stateWith(null);
    const after = stateWith(diveAt(1, 1, "E"));
    const events: GameEvent[] = [
      { kind: "screen", to: "dungeon" },
      { kind: "message", key: "dungeon.enter", params: { dungeon: "D" } },
      { kind: "moved", pos: { x: 2, y: 1 }, facing: "E" },
      { kind: "hpChanged", id: "c2", delta: -3, hp: 4 },
      { kind: "lifeChanged", id: "c2", life: "dead" },
      { kind: "sanChanged", id: "c3", delta: -10, san: 40 },
      { kind: "blocked" },
      { kind: "turned", facing: "S" },
    ];
    await createPlayer(deps).play(events, before, after);
    expect(names(log)).toEqual([
      "screens.show",
      "view.fade",
      "view.showAt",
      "header.showAt",
      "message.setMore",
      "message.say",
      "view.fade",
      "view.showAt",
      "header.showAt",
      "party.setHp",
      "party.flash",
      "party.setLife",
      "party.setSan",
      "view.fade",
      "view.showAt",
      "header.showAt",
      "message.setMore",
      "screens.sync",
    ]);
    expect(log[0]!.a).toEqual(["dungeon"]);
    const say = log.find((e) => e.m === "message.say")!;
    expect(say.a[0]).toBe(formatMessage(data.strings["dungeon.enter"]!, { dungeon: "D" }));
    expect(log.find((e) => e.m === "party.setLife")!.a).toEqual(["c2", "dead"]);
    expect(log.find((e) => e.m === "party.setSan")!.a).toEqual(["c3", 40]);
  });

  test("UI-43 setMore は後ろに message が残っている間だけ真で、最後は偽に戻す", async () => {
    const { deps, log } = fakeDeps();
    const s = stateWith(diveAt(1, 1, "N"));
    await createPlayer(deps).play(
      [
        { kind: "message", key: "dungeon.door" },
        { kind: "moved", pos: { x: 1, y: 0 }, facing: "N" },
        { kind: "message", key: "battle.encounter" },
      ],
      s,
      s,
    );
    expect(log.filter((e) => e.m === "message.setMore").map((e) => e.a[0])).toEqual([true, false, false]);
  });

  test("UI-41 未登録の kind は何もしない", async () => {
    const { deps, log } = fakeDeps();
    const s = stateWith(diveAt(1, 1, "N"));
    const events: GameEvent[] = [
      { kind: "rejected", command: "dungeon.move", reason: "x" },
      { kind: "eventStarted", eventId: "x" },
    ];
    await createPlayer(deps).play(events, s, s);
    expect(names(log)).toEqual(["message.setMore", "screens.sync"]);
  });

  test("UI-41/CH-61/CH-62 levelUp・levelDown は setMax → setHp → setMp（イベントの値で）。spellLearned は何もしない", async () => {
    for (const skipAnimations of [false, true]) {
      const { deps, log } = fakeDeps({ skipAnimations });
      const s = stateWith(null);
      const events: GameEvent[] = [
        { kind: "levelUp", id: "c4", level: 3, hpGain: 4, mpGain: 2, hpMax: 20, mpMax: 9, hp: 17, mp: 8 },
        { kind: "spellLearned", id: "c4", spellId: "p_heal", via: "roll" },
        { kind: "levelDown", id: "c1", level: 2, hpMax: 15, mpMax: 0, hp: 15, mp: 0 },
      ];
      await createPlayer(deps).play(events, s, s);
      expect(log.filter((e) => e.m.startsWith("party."))).toEqual([
        { m: "party.setMax", a: ["c4", 20, 9] },
        { m: "party.setHp", a: ["c4", 17] },
        { m: "party.setMp", a: ["c4", 8] },
        { m: "party.setMax", a: ["c1", 15, 0] },
        { m: "party.setHp", a: ["c1", 15] },
        { m: "party.setMp", a: ["c1", 0] },
      ]);
      expect(names(log).filter((m) => !m.startsWith("party."))).toEqual(["message.setMore", "screens.sync"]);
    }
  });

  test("UI-41/UI-56 wipe は wipe.show を 1 回（PenaltyResult をそのまま）呼び、入力を待たずに後続を再生する（skip の真偽とも）", async () => {
    const penalty: PenaltyResult = {
      dice: [3, 4],
      total: 7,
      bandIndex: 2,
      ledgerGold: 0,
      ledgerItems: [],
      goldLost: 60,
      itemsLost: [],
      expLost: [],
      revived: [],
      leaderRule: true,
    };
    for (const skipAnimations of [false, true]) {
      vi.useFakeTimers();
      const { deps, log } = fakeDeps({ skipAnimations });
      const before = stateWith(diveAt(1, 1, "N"));
      const after = stateWith(null);
      const events: GameEvent[] = [
        {
          kind: "dice",
          label: { key: "dice.wipe" },
          rows: [{ label: { key: "dice.row.roll" }, base: null, dice: [3, 4], total: 7 }],
          rule: { key: "dice.wipe.rule", params: { min: 7, max: 10 } },
          result: { key: "dice.wipe.result", params: { band: "x" } },
        },
        { kind: "wipe", penalty },
        { kind: "message", key: "town.enter" },
        { kind: "screen", to: "town" },
      ];
      await createPlayer(deps).play(events, before, after);
      expect(vi.getTimerCount()).toBe(0);
      expect(log.filter((e) => e.m === "wipe.show")).toEqual([{ m: "wipe.show", a: [penalty] }]);
      // 内訳を開いた後に街の語りと画面の切り替えが続く（dice は wipe の前で消える）
      expect(names(log).filter((m) => ["dice.show", "dice.hide", "wipe.show", "message.say", "screens.show", "screens.sync"].includes(m))).toEqual([
        "dice.show",
        "dice.hide",
        "wipe.show",
        "message.say",
        "screens.show",
        "screens.sync",
      ]);
      vi.useRealTimers();
    }
  });

  test("UI-41 最後に sync が 1 回、最終の state で呼ばれる", async () => {
    const { deps, log } = fakeDeps();
    const before = stateWith(diveAt(1, 1, "N"));
    const after = stateWith(diveAt(1, 0, "N"));
    await createPlayer(deps).play([{ kind: "moved", pos: { x: 1, y: 0 }, facing: "N" }], before, after);
    const syncs = log.filter((e) => e.m === "screens.sync");
    expect(syncs).toHaveLength(1);
    expect(syncs[0]!.a[0]).toBe(after);
    expect(log[log.length - 1]!.m).toBe("screens.sync");
    // 空の再生でも 1 回
    const f2 = fakeDeps();
    await createPlayer(f2.deps).play([], before, after);
    expect(f2.log.filter((e) => e.m === "screens.sync")).toHaveLength(1);
  });

  test("UI-23 moved/turned の showAt は cursor の pos/facing で呼ばれる（spinner の 2 回目の turned の向き）", async () => {
    const { deps, log } = fakeDeps();
    // 再生前は (3,3) 北向き。最終の state は回転床の結果（(3,2) 南向き）
    const before = stateWith(diveAt(3, 3, "N", 2));
    const after = stateWith(diveAt(3, 2, "S", 2));
    const events: GameEvent[] = [
      { kind: "moved", pos: { x: 3, y: 2 }, facing: "N" },
      { kind: "message", key: "dungeon.trap.spinner" },
      { kind: "turned", facing: "E" },
      { kind: "turned", facing: "S" },
    ];
    await createPlayer(deps).play(events, before, after);
    const shows = log.filter((e) => e.m === "view.showAt").map((e) => e.a[0] as ViewPoint);
    expect(shows).toEqual([
      { floor: 2, pos: { x: 3, y: 2 }, facing: "N" },
      { floor: 2, pos: { x: 3, y: 2 }, facing: "E" },
      { floor: 2, pos: { x: 3, y: 2 }, facing: "S" },
    ]);
    // ヘッダーも同じ視点
    expect(log.filter((e) => e.m === "header.showAt").map((e) => e.a[0])).toEqual(shows);
  });

  test("UI-23 floorChanged は cursor を丸ごと入れ替える。screen dungeon は最終の dive から作る", async () => {
    const { deps, log } = fakeDeps();
    const before = stateWith(diveAt(5, 5, "W", 1));
    const after = stateWith(diveAt(5, 5, "W", 2));
    await createPlayer(deps).play([{ kind: "floorChanged", floor: 2, pos: { x: 5, y: 5 }, facing: "W" }], before, after);
    expect(log.filter((e) => e.m === "view.showAt").map((e) => e.a[0])).toEqual([{ floor: 2, pos: { x: 5, y: 5 }, facing: "W" }]);
  });

  test("UI-43 拍の外の tap(): 1 回目は今の文の即表示（rush）だけ、同じ再生の中の 2 回目で残りをすべて即時にし、次の再生では戻す", async () => {
    const { deps, log } = fakeDeps();
    const s = stateWith(diveAt(1, 1, "N"));
    const player = createPlayer(deps);
    let n = 0;
    const say = deps.message.say;
    deps.message.say = (text, instant) => {
      n++;
      if (n === 1) {
        player.tap(); // 1 文目の送り中に 1 回目のタップ
        player.tap(); // 2 回目のタップ
      }
      return say(text, instant);
    };
    const events: GameEvent[] = [
      { kind: "message", key: "dungeon.door" },
      { kind: "moved", pos: { x: 1, y: 0 }, facing: "N" },
      { kind: "message", key: "battle.encounter" },
    ];
    await player.play(events, s, s);
    expect(log.filter((e) => e.m === "message.rush")).toHaveLength(2);
    expect(log.filter((e) => e.m === "message.say").map((e) => e.a[1])).toEqual([false, true]);
    expect(log.filter((e) => e.m === "view.fade").map((e) => e.a[0])).toEqual([0]);
    // 1 回だけなら残りは即時にしない
    log.length = 0;
    n = 10;
    let once = true;
    deps.message.say = (text, instant) => {
      if (once) {
        once = false;
        player.tap();
      }
      return say(text, instant);
    };
    await player.play(events, s, s);
    expect(log.filter((e) => e.m === "message.say").map((e) => e.a[1])).toEqual([false, false]);
    expect(log.filter((e) => e.m === "view.fade").map((e) => e.a[0])).toEqual([data.config.ui.viewFadeMs]);
    // 拍の外では待たない
    expect(names(log)).not.toContain("beat.waitTap");
    expect(names(log)).not.toContain("message.waitMs");
  });
});

describe("UI-41/UI-42/UI-40 戦闘の再生", () => {
  const groups: EnemyGroupView[] = [
    { index: 0, monsterId: "giant_rat", name: "小さな獣", identified: false, count: 2 },
    { index: 1, monsterId: "kobold", name: "コボルド", identified: true, count: 1 },
  ];
  const battleState = (): GameState => ({ ...stateWith(diveAt(1, 1, "N")), screen: "battle" });

  test("UI-41 遭遇から勝利まで: screen battle → setGroups → 敵の被弾 → 味方の被弾 → 撃破 → ダイス → message → ダイスを消す → screen dungeon → sync", async () => {
    const { deps, log } = fakeDeps();
    const before = stateWith(diveAt(1, 1, "N"));
    const after = stateWith(diveAt(1, 1, "N"));
    const events: GameEvent[] = [
      { kind: "screen", to: "battle" },
      { kind: "encounter", groups },
      { kind: "attack", actorId: "c1", targetId: "e0-0", hit: true, damage: 3 },
      { kind: "hpChanged", id: "e0-0", delta: -3, hp: 0 },
      { kind: "attack", actorId: "e1-0", targetId: "c2", hit: true, damage: 2 },
      { kind: "hpChanged", id: "c2", delta: -2, hp: 5 },
      { kind: "lifeChanged", id: "e0-0", life: "dead" },
      rollDiceEv("dice.flee", [37], 37, "dice.flee.ok"),
      { kind: "message", key: "battle.fleeOk" },
      { kind: "battleEnd", result: "flee" },
      { kind: "screen", to: "dungeon" },
    ];
    expectKnownStringKeys(events);
    await createPlayer(deps).play(events, before, after);
    const ui = data.config.ui;
    expect(log.filter((e) => !e.m.startsWith("message.setMore") && e.m !== "view.showAt" && e.m !== "header.showAt")).toEqual([
      { m: "view.fade", a: [ui.viewFadeMs] },
      { m: "screens.show", a: ["battle"] },
      { m: "battle.clear", a: [] },
      { m: "battle.setGroups", a: [groups] },
      { m: "battle.flash", a: [0, ui.flashMs] },
      { m: "party.setHp", a: ["c2", 5] },
      { m: "party.flash", a: ["c2", ui.flashMs] },
      { m: "battle.removeOne", a: [0, ui.flashMs] },
      { m: "message.log", a: [formatDiceSummary(events[7] as DiceEvent, data.strings)] },
      { m: "dice.show", a: ["dice.flee", false, ui.diceStepMs] },
      { m: "message.say", a: [data.strings["battle.fleeOk"], false] },
      { m: "dice.hide", a: [] },
      { m: "screens.show", a: ["dungeon"] },
      { m: "view.fade", a: [ui.viewFadeMs] },
      { m: "screens.sync", a: [JSON.parse(JSON.stringify(after))] },
    ]);
  });

  test("UI-41 skipAnimations なら flash / removeOne / shake / dice / fade の ms はすべて 0 で、タイマーを使わない", async () => {
    vi.useFakeTimers();
    const { deps, log } = fakeDeps({ skipAnimations: true });
    const s = battleState();
    const events: GameEvent[] = [
      { kind: "screen", to: "battle" },
      { kind: "encounter", groups },
      INITIATIVE,
      { kind: "spell", actorId: "c5", spellId: "flame_burst", targets: ["e0-0", "e0-1"] },
      { kind: "hpChanged", id: "e0-0", delta: -4, hp: 0 },
      { kind: "lifeChanged", id: "e0-0", life: "dead" },
      { kind: "hpChanged", id: "c1", delta: -1, hp: 6 },
    ];
    expectKnownStringKeys(events);
    await createPlayer(deps).play(events, s, s);
    expect(vi.getTimerCount()).toBe(0);
    const ms = log
      .filter((e) => ["view.fade", "view.shake", "battle.flash", "battle.removeOne", "party.flash", "dice.show"].includes(e.m))
      .map((e) => [e.m, e.a[e.a.length - 1]]);
    expect(ms).toEqual([
      ["view.fade", 0],
      ["dice.show", 0],
      ["view.shake", 0],
      ["battle.flash", 0],
      ["battle.removeOne", 0],
      ["party.flash", 0],
    ]);
    // dice.show の skip は真
    expect(log.filter((e) => e.m === "dice.show").map((e) => e.a[1])).toEqual([true]);
  });

  test("UI-40 続けて来たダイスは間で消さず（箱の置き換えは views/dice.ts）、message の間も残し、次のイベント（と再生の終わり）で 1 回だけ消す", async () => {
    const { deps, log } = fakeDeps();
    const s = battleState();
    const events: GameEvent[] = [
      INITIATIVE,
      rollDiceEv("dice.flee", [37], 37, "dice.flee.ng"),
      { kind: "message", key: "battle.surpriseParty" },
    ];
    expectKnownStringKeys(events);
    await createPlayer(deps).play(events, s, s);
    expect(names(log).filter((m) => m.startsWith("dice.") || m === "message.say")).toEqual(["dice.show", "dice.show", "message.say", "dice.hide"]);
    // ダイスが出ていなければ hide は呼ばない
    const f2 = fakeDeps();
    await createPlayer(f2.deps).play([{ kind: "message", key: "battle.win" }, { kind: "battleEnd", result: "win" }], s, s);
    expect(names(f2.log)).not.toContain("dice.hide");
  });

  test("UI-42 全体攻撃（enemyGroup / allEnemies の damage）だけ揺らす。fire_arrow・sleep_mist・heal・blessing・identify は揺らさない", async () => {
    const shaken: string[] = [];
    for (const spellId of ["fire_arrow", "sleep_mist", "flame_burst", "lightning_tome", "heal", "blessing", "identify"]) {
      const { deps, log } = fakeDeps();
      const s = battleState();
      await createPlayer(deps).play([{ kind: "spell", actorId: "c5", spellId, targets: [] }], s, s);
      if (log.some((e) => e.m === "view.shake")) shaken.push(spellId);
      expect(log.filter((e) => e.m === "view.shake").map((e) => e.a[0])).toEqual(shaken.at(-1) === spellId ? [data.config.ui.shakeMs] : []);
    }
    expect(shaken).toEqual(["flame_burst", "lightning_tome"]);
  });

  test("UI-42 回復（delta > 0）ではフラッシュしない。敵の hpChanged は party に触れない", async () => {
    const { deps, log } = fakeDeps();
    const s = battleState();
    const events: GameEvent[] = [
      { kind: "hpChanged", id: "c3", delta: 4, hp: 8 },
      { kind: "hpChanged", id: "e1-0", delta: 0, hp: 3 },
    ];
    await createPlayer(deps).play(events, s, s);
    expect(names(log)).toEqual(["party.setHp", "message.setMore", "screens.sync"]);
  });

  test("UI-41 statusChanged は味方だけ setStatus（敵は無視）、mpChanged → setMp、enemyGroups → setGroups、敵の lifeChanged は dead だけ removeOne", async () => {
    const { deps, log } = fakeDeps();
    const s = battleState();
    const events: GameEvent[] = [
      { kind: "statusChanged", id: "e0-1", status: "sleep", on: true },
      { kind: "statusChanged", id: "c2", status: "poison", on: true },
      { kind: "mpChanged", id: "c5", delta: -2, mp: 3 },
      { kind: "enemyGroups", groups },
      { kind: "lifeChanged", id: "e1-0", life: "dead" },
      { kind: "lifeChanged", id: "c4", life: "dead" },
    ];
    await createPlayer(deps).play(events, s, s);
    expect(log.filter((e) => e.m !== "message.setMore" && e.m !== "screens.sync")).toEqual([
      { m: "party.setStatus", a: ["c2", "poison", true] },
      { m: "party.setMp", a: ["c5", 3] },
      { m: "battle.setGroups", a: [groups] },
      { m: "battle.removeOne", a: [1, data.config.ui.flashMs] },
      { m: "party.setLife", a: ["c4", "dead"] },
    ]);
  });
});

// ---------------------------------------------------------------- UI-45 拍の再生
const beat = (phase: "declare" | "result" | "aftermath" | "system", auto: boolean): GameEvent => ({ kind: "beat", phase, auto });
const msg = (key: string, params?: Record<string, string | number>): GameEvent => (params === undefined ? { kind: "message", key } : { kind: "message", key, params });

describe("UI-45 拍の再生", () => {
  const battleState = (): GameState => ({ ...stateWith(diveAt(1, 1, "N")), screen: "battle" });
  /** 待ち（タップ・時間）と、その前後の目印になる呼び出しだけを抜き出す */
  const waits = (log: Log): string[] =>
    log
      .filter((e) => ["beat.waitTap", "message.waitMs", "message.say", "dice.show", "dice.hide", "screens.show", "screens.sync"].includes(e.m))
      .map((e) => (e.m === "message.waitMs" ? `waitMs ${String(e.a[0])}` : e.m === "message.say" ? `say ${String(e.a[0])}` : e.m));
  const say = (key: string, p?: Record<string, string | number>): string => `say ${formatMessage(data.strings[key]!, p)}`;

  test("UI-45 beatWait: 拍の中で文かダイスが出ていれば待つ。再生の終わりの手動はダイスが出ているときだけ。拍の外と、何も出ていない拍では待たない", () => {
    for (const at of ["beat", "leave", "end"] as const) {
      for (const diceShown of [false, true]) {
        expect(beatWait({ mode: null, pending: true, diceShown, at })).toBeNull();
        expect(beatWait({ mode: "tap", pending: false, diceShown, at })).toBeNull();
        expect(beatWait({ mode: "timed", pending: false, diceShown, at })).toBeNull();
        expect(beatWait({ mode: "timed", pending: true, diceShown, at })).toBe("timed");
      }
      expect(beatWait({ mode: "tap", pending: true, diceShown: true, at })).toBe("tap");
    }
    expect(beatWait({ mode: "tap", pending: true, diceShown: false, at: "beat" })).toBe("tap");
    expect(beatWait({ mode: "tap", pending: true, diceShown: false, at: "leave" })).toBe("tap");
    expect(beatWait({ mode: "tap", pending: true, diceShown: false, at: "end" })).toBeNull();
  });

  test("UI-45/UI-41 手動の拍（auto 偽）の後に文があれば次の拍の前でタップを 1 回待ち、オート（auto 真）は waitMs(autoBeatMs)。演出スキップでも待つ（フラッシュは 0）", async () => {
    const events: GameEvent[] = [
      beat("declare", false),
      msg("battle.attackDeclare", { actor: "A" }),
      beat("result", false),
      { kind: "hpChanged", id: "c1", delta: -2, hp: 5 },
      msg("battle.hit", { target: "A", damage: 2 }),
      beat("declare", true),
      msg("battle.attackDeclare", { actor: "B" }),
      beat("result", true),
      msg("battle.miss", { target: "B" }),
    ];
    expectKnownStringKeys(events);
    for (const skipAnimations of [false, true]) {
      vi.useFakeTimers();
      const { deps, log } = fakeDeps({ skipAnimations, autoBeatMs: 200 });
      const s = battleState();
      await createPlayer(deps).play(events, s, s);
      expect(vi.getTimerCount()).toBe(0);
      expect(waits(log)).toEqual([
        say("battle.attackDeclare", { actor: "A" }),
        "beat.waitTap",
        say("battle.hit", { target: "A", damage: 2 }),
        "beat.waitTap",
        say("battle.attackDeclare", { actor: "B" }),
        "waitMs 200",
        say("battle.miss", { target: "B" }),
        // 再生の終わり: オートは待つ
        "waitMs 200",
        "screens.sync",
      ]);
      // タップ待ちの間だけ続きの三角を出す（演出スキップでは点滅しない）。拍の中の文では三角を出さない
      expect(log.filter((e) => e.m === "message.setMore").map((e) => e.a)).toEqual([[true, !skipAnimations], [false], [true, !skipAnimations], [false], [false]]);
      expect(log.filter((e) => e.m === "party.flash").map((e) => e.a)).toEqual([["c1", skipAnimations ? 0 : data.config.ui.flashMs]]);
      vi.useRealTimers();
    }
  });

  test("UI-45 中身に文もダイスも無い拍の後は待たない。拍の外の再生（迷宮の歩行）では待たない", async () => {
    const { deps, log } = fakeDeps();
    const s = battleState();
    await createPlayer(deps).play([beat("result", false), { kind: "hpChanged", id: "c1", delta: -1, hp: 6 }, beat("aftermath", false), msg("battle.win")], s, s);
    expect(names(log)).not.toContain("beat.waitTap");
    const f2 = fakeDeps();
    const d = stateWith(diveAt(1, 1, "N"));
    await createPlayer(f2.deps).play([msg("dungeon.door"), { kind: "moved", pos: { x: 1, y: 0 }, facing: "N" }, msg("dungeon.blocked")], d, d);
    expect(names(f2.log)).not.toContain("beat.waitTap");
    expect(names(f2.log)).not.toContain("message.waitMs");
  });

  test("UI-45 戦闘の外への screen（dungeon / town）の前で待ってから切り替え、その後は拍の外として流す", async () => {
    const { deps, log } = fakeDeps();
    const s = battleState();
    const after = stateWith(diveAt(1, 1, "N"));
    const events: GameEvent[] = [
      beat("system", false),
      rollDiceEv("dice.flee", [12], 12, "dice.flee.ok"),
      msg("battle.fleeOk"),
      { kind: "battleEnd", result: "flee" },
      { kind: "screen", to: "dungeon" },
      msg("dungeon.door"),
    ];
    expectKnownStringKeys(events);
    await createPlayer(deps).play(events, s, after);
    // battleEnd（message でも dice でもない）の前でダイスは消える。screen の前でタップを待つ
    expect(waits(log)).toEqual(["dice.show", say("battle.fleeOk"), "dice.hide", "beat.waitTap", "screens.show", say("dungeon.door"), "screens.sync"]);
    // 全滅（town）・オート（timed）でも同じ位置で待つ
    const f2 = fakeDeps();
    await createPlayer(f2.deps).play([beat("system", true), msg("battle.win"), { kind: "screen", to: "town" }], s, stateWith(null));
    expect(waits(f2.log)).toEqual([say("battle.win"), "waitMs 400", "screens.show", "screens.sync"]);
  });

  test("UI-45/UI-40 再生の終わり: 手動はダイスが出ているときだけ待つ（遭遇の先手判定）。拍の待ちの後で dice.hide を呼ぶ", async () => {
    const { deps, log } = fakeDeps();
    const s = battleState();
    const events: GameEvent[] = [
      { kind: "screen", to: "battle" },
      beat("system", false),
      { kind: "encounter", groups: [] },
      msg("battle.encounter"),
      beat("system", false),
      INITIATIVE,
    ];
    expectKnownStringKeys(events);
    await createPlayer(deps).play(events, s, s);
    expect(waits(log)).toEqual(["screens.show", say("battle.encounter"), "beat.waitTap", "dice.show", "beat.waitTap", "dice.hide", "screens.sync"]);
    // 手動の拍の文で終われば待たない
    const f2 = fakeDeps();
    await createPlayer(f2.deps).play([beat("declare", false), msg("battle.attackDeclare", { actor: "A" })], s, s);
    expect(names(f2.log)).not.toContain("beat.waitTap");
    // 拍の中でダイスに続いて文が来ても、ダイスは次の拍の待ちの後に消す
    const f3 = fakeDeps();
    await createPlayer(f3.deps).play([beat("system", false), INITIATIVE, msg("battle.surpriseParty"), beat("declare", false), msg("battle.attackDeclare", { actor: "A" })], s, s);
    expect(waits(f3.log)).toEqual(["dice.show", say("battle.surpriseParty"), "beat.waitTap", "dice.hide", say("battle.attackDeclare", { actor: "A" }), "screens.sync"]);
  });

  test("UI-46 dice を受けたら履歴に要約を 1 回だけ残す（message.log）", async () => {
    const { deps, log } = fakeDeps();
    const s = battleState();
    await createPlayer(deps).play([beat("system", false), INITIATIVE, msg("battle.surpriseParty")], s, s);
    expect(log.filter((e) => e.m === "message.log").map((e) => e.a)).toEqual([[formatDiceSummary(INITIATIVE as DiceEvent, data.strings)]]);
  });

  test("UI-45 tap(): タップ待ちを解く。解くまでは再生が先へ進まない", async () => {
    const { deps, log } = fakeDeps();
    delete deps.beat; // 既定の掛け金（Player.tap() が解く）
    const s = battleState();
    const player = createPlayer(deps);
    let done = false;
    const p = player.play([beat("declare", false), msg("battle.attackDeclare", { actor: "A" }), beat("result", false), msg("battle.miss", { target: "B" })], s, s).then(() => {
      done = true;
    });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(done).toBe(false);
    expect(log.filter((e) => e.m === "message.say")).toHaveLength(1);
    expect(log.filter((e) => e.m === "message.setMore").map((e) => e.a)).toEqual([[true, true]]);
    player.tap();
    await p;
    expect(done).toBe(true);
    expect(log.filter((e) => e.m === "message.say")).toHaveLength(2);
    // 待っている間のタップは rush を呼ばない（待ちを解くだけ）
    expect(names(log)).not.toContain("message.rush");
  });

  test("UI-45 拍の中の tap(): 今の拍の残りを即時にする（rush）が、拍は飛ばさない。次の拍では戻す", async () => {
    const { deps, log } = fakeDeps();
    const s = battleState();
    const player = createPlayer(deps);
    let first = true;
    const sayFn = deps.message.say;
    deps.message.say = (text, instant) => {
      if (first) {
        first = false;
        player.tap();
      }
      return sayFn(text, instant);
    };
    await player.play(
      [beat("declare", false), msg("battle.attackDeclare", { actor: "A" }), msg("battle.miss", { target: "B" }), beat("result", false), msg("battle.miss", { target: "C" })],
      s,
      s,
    );
    expect(log.filter((e) => e.m === "message.rush")).toHaveLength(1);
    expect(log.filter((e) => e.m === "message.say").map((e) => e.a[1])).toEqual([false, true, false]);
    // 拍は飛ばさない（タップ待ちは 1 回ある）
    expect(log.filter((e) => e.m === "beat.waitTap")).toHaveLength(1);
  });

  test("UI-45 createTapLatch: release で待ちを解く。待っていない間の release は次の待ちを解かない", async () => {
    const l = createTapLatch();
    l.release();
    let done = false;
    const p = l.waitTap().then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    l.release();
    await p;
    expect(done).toBe(true);
  });
});
