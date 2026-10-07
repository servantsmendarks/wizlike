import { afterEach, describe, expect, test, vi } from "vitest";
import { beatWait, createPlayer, createTapLatch, nextSaid, townCarry, type PlayerDeps } from "../src/presenter/playback";
import { createNarrator, createTalkModel, talkRows } from "../src/presenter/views/talk";
import { regions, townLayout } from "../src/presenter/layout";
import { returnToTown } from "../src/core/rules/town";
import { formatDiceSummary, type DiceEvent } from "../src/presenter/views/dice";
import { formatMessage } from "../src/presenter/views/message";
import { textUnits } from "../src/presenter/views/party-band";
import { STAT_KEYS } from "../src/core/data/index";
import type { PenaltyTableText } from "../src/presenter/views/penalty-table";
import type { Settings } from "../src/presenter/settings";
import type { Dive, EnemyGroupView, GameEvent, GameState, PenaltyResult, ViewPoint } from "../src/core/types";
import { data, expectKnownStringKeys, newGame, withChar } from "./helpers/core";
import { cloneState, createItemInstance, makeContext } from "../src/core/state";
import { startBattle } from "../src/core/rules/combat";
import { execute } from "../src/core/engine";
import { ALWAYS_HIT, dataWith, dived, withBattle } from "./helpers/battle";
import { atEvent, dataEvents } from "./helpers/events";

/** UI-47（M10.5）: 街の会話の箱の矩形（行数と 1 行の単位） */
const T = townLayout(regions(data.config.ui.layout, data.config.stage.width), data.config.party.size);
const TALK_DIMS = { lines: () => T.talk.lines, cols: () => T.talk.cols };

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
    knownTraps: {},
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
  const s: Settings = { skipAnimations: false, textSpeed: 30, inputMode: "both", swipeThreshold: 28, holdRepeatMs: 250, autoBeatMs: 400, musicVolume: 7, sfxVolume: 7, ...settings };
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
      typing: () => false,
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
      markActor: rec("party.markActor"),
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
      settled: () => true,
    },
    screens: { show: (to) => rec("screens.show")(to), sync: (st) => log.push({ m: "screens.sync", a: [st] }) },
    wipe: { show: (p) => rec("wipe.show")(p) },
    penaltyTable: { show: (v) => rec("penaltyTable.show")(v), hide: rec("penaltyTable.hide") },
    battleEnded: rec("battleEnded"),
    inputClosed: rec("inputClosed"),
    eventStarted: rec("eventStarted"),
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
    // M5 で eventStarted は UI-55 のハンドラを持つようになったので、この列から外した（UI-55 の describe で見る）
    const events: GameEvent[] = [{ kind: "rejected", command: "dungeon.move", reason: "x" }];
    await createPlayer(deps).play(events, s, s);
    expect(names(log)).toEqual(["message.setMore", "screens.sync"]);
  });

  test("UI-41/CH-61/CH-62 levelUp・levelDown は setMax → setHp → setMp（イベントの値で）。spellLearned は何もしない", async () => {
    for (const skipAnimations of [false, true]) {
      const { deps, log } = fakeDeps({ skipAnimations });
      const s = stateWith(null);
      const events: GameEvent[] = [
        { kind: "levelUp", id: "c4", level: 3, hpGain: 4, mpGain: 2, hpMax: 20, mpMax: 9, hp: 17, mp: 8, statGains: [] },
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

  test("UI-41/UI-56 wipe は wipe.show を 1 回（PenaltyResult をそのまま）呼ぶ。拍の外（beat の無い列）でも全滅の 2d10 を出したままタップを 1 回待ってから開き、開いた後は入力を待たずに後続を再生する（skip の真偽とも）", async () => {
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
      // 箱を出したまま 1 回待ち、待ちの後に消してから内訳を開く。内訳を開いた後に街の語りと画面の切り替えが続く（待たない）
      expect(
        names(log).filter((m) => ["dice.show", "dice.hide", "beat.waitTap", "wipe.show", "message.say", "screens.show", "screens.sync"].includes(m)),
      ).toEqual([
        "dice.show",
        "beat.waitTap",
        "dice.hide",
        "wipe.show",
        "message.say",
        "screens.show",
        "screens.sync",
      ]);
      vi.useRealTimers();
    }
  });

  test("UI-45/UI-56 戦闘の全滅（core の実際の列。system の拍を含む）: 内訳を開く前に 1 回だけ待ち（手動・オートとも system の拍は auto 偽でタップ待ち）、開いた後は街の画面まで待たない", async () => {
    // wipe.test の CB-53 と同じ全滅: c1 だけ動けて hp 1、ほかは麻痺。敵は必ず当てる
    const PARA = { status: ["paralysis" as const] };
    const s0 = structuredClone(dived(1));
    for (const c of s0.party) Object.assign(c, c.id === "c1" ? { hp: 1 } : PARA);
    const d = dataWith({ combat: ALWAYS_HIT });
    for (const auto of [false, true]) {
      const s = withBattle(s0, [{ monsterId: "kobold", hps: [50] }], { identified: ["kobold"], inputs: { c1: { type: "defend" } }, auto });
      const r = execute(s, { type: "battle.resolve" }, d);
      expect(r.state.screen).toBe("town");
      expect(r.events.some((e) => e.kind === "wipe")).toBe(true);
      const { deps, log } = fakeDeps();
      await createPlayer(deps).play(r.events, s, r.state);
      const ms = names(log).filter((m) => ["beat.waitTap", "message.waitMs", "dice.show", "wipe.show", "screens.show", "screens.sync"].includes(m));
      const w = ms.indexOf("wipe.show");
      expect(w, String(auto)).toBeGreaterThan(0);
      // 全滅の 2d10 を見せ、待ってから内訳を開く
      expect(ms.slice(w - 2, w + 1), String(auto)).toEqual(["dice.show", "beat.waitTap", "wipe.show"]);
      // 内訳の後は待たない（街の画面と最後の同期だけ）
      expect(ms.slice(w + 1), String(auto)).toEqual(["screens.show", "screens.sync"]);
    }
  });

  /** 全滅の 2d10（dice.wipe）の dice.show から wipe.show までの記録。間で dice.hide が呼ばれていないこと、待ちが箱を出したまま起きることを見る */
  const wipeSpan = (log: Log): string[] => {
    const d = log.findIndex((e) => e.m === "dice.show" && e.a[0] === "dice.wipe");
    const w = log.findIndex((e) => e.m === "wipe.show");
    expect(d).toBeGreaterThanOrEqual(0);
    expect(w).toBeGreaterThan(d);
    return names(log.slice(d, w + 1)).filter((m) => ["dice.show", "dice.hide", "beat.waitTap", "message.waitMs", "party.setLife", "wipe.show"].includes(m));
  };

  test("UI-40/UI-56/CB-53/TW-24 戦闘の全滅（core の実際の列。全員倒れてリーダーが戻され、dice の後・wipe の前に lifeChanged が出る）: 全滅の 2d10 の箱は復活の更新では消えず、箱を出したままタップを待ち、待ちの後に消してから内訳を開く（手動・オート、演出スキップの真偽とも）", async () => {
    // wipe.test の CB-53 と同じ形: c1（リーダー）だけ動けて hp 1、ほかは麻痺。敵は必ず当てる → c1 が倒れ、生存者（麻痺）とリーダーを戻す
    const PARA = { status: ["paralysis" as const] };
    const s0 = structuredClone(dived(1));
    for (const c of s0.party) Object.assign(c, c.id === "c1" ? { hp: 1 } : PARA);
    expect(s0.party.find((c) => c.id === "c1")?.isLeader).toBe(true);
    const d = dataWith({ combat: ALWAYS_HIT });
    for (const auto of [false, true]) {
      const s = withBattle(s0, [{ monsterId: "kobold", hps: [50] }], { identified: ["kobold"], inputs: { c1: { type: "defend" } }, auto });
      const r = execute(s, { type: "battle.resolve" }, d);
      // 前提: dice{dice.wipe} の後・wipe の前に、リーダーの lifeChanged（alive）と、message でない更新が出る
      const di = r.events.findIndex((e) => e.kind === "dice" && e.label.key === "dice.wipe");
      const wi = r.events.findIndex((e) => e.kind === "wipe");
      const between = r.events.slice(di + 1, wi);
      expect(between.some((e) => e.kind === "lifeChanged" && e.id === "c1" && e.life === "alive"), String(auto)).toBe(true);
      expect(between.some((e) => e.kind === "statusChanged"), String(auto)).toBe(true);
      for (const skipAnimations of [false, true]) {
        const { deps, log } = fakeDeps({ skipAnimations });
        await createPlayer(deps).play(r.events, s, r.state);
        // パーティ欄の更新はそのまま行い、箱は wipe の待ちの後まで消さない
        const span = wipeSpan(log);
        expect(span.slice(-3), `${auto} ${skipAnimations}`).toEqual(["beat.waitTap", "dice.hide", "wipe.show"]);
        expect(span.filter((m) => m === "dice.hide"), `${auto} ${skipAnimations}`).toEqual(["dice.hide"]);
        expect(span, `${auto} ${skipAnimations}`).toContain("party.setLife");
        expect(span.indexOf("party.setLife")).toBeLessThan(span.indexOf("beat.waitTap"));
      }
    }
  });

  test("UI-40/UI-56/TW-23 戦闘の外の全滅（wipeIfNoneCanAct。全員麻痺で dungeon.turn）: 拍が無くても、全滅の 2d10 の箱を出したままタップを 1 回待ってから内訳を開く。復活の更新では箱を消さない（演出スキップの真偽とも）", async () => {
    const s = structuredClone(dived(1));
    for (const c of s.party) c.status = ["paralysis"];
    const r = execute(s, { type: "dungeon.turn", dir: "left" }, data);
    expect(r.state.screen).toBe("town");
    expect(r.events.some((e) => e.kind === "beat")).toBe(false);
    const di = r.events.findIndex((e) => e.kind === "dice" && e.label.key === "dice.wipe");
    const wi = r.events.findIndex((e) => e.kind === "wipe");
    expect(r.events.slice(di + 1, wi).some((e) => e.kind === "statusChanged")).toBe(true);
    for (const skipAnimations of [false, true]) {
      const { deps, log } = fakeDeps({ skipAnimations });
      await createPlayer(deps).play(r.events, s, r.state);
      expect(wipeSpan(log), String(skipAnimations)).toEqual(["dice.show", "beat.waitTap", "dice.hide", "wipe.show"]);
      // 待ちは 2 回だけ（M5.5: 出目の表の後の 1 回と 2d10 の後の 1 回。旧は 2d10 の後の 1 回。内訳を開いた後の街の処理では待たない）
      expect(log.filter((e) => e.m === "beat.waitTap")).toHaveLength(2);
      // 続きの三角は演出スキップでは点滅しない
      const w = log.findIndex((e) => e.m === "beat.waitTap");
      expect(log.slice(0, w).filter((e) => e.m === "message.setMore").at(-1)?.a).toEqual([true, !skipAnimations]);
    }
  });

  test("UI-45/UI-56 戦闘の外の全滅のタップ待ちは、Player.tap() で解くまで内訳を開かない（箱は出たまま）", async () => {
    const s = structuredClone(dived(1));
    for (const c of s.party) c.status = ["paralysis"];
    const r = execute(s, { type: "dungeon.turn", dir: "left" }, data);
    const { deps, log } = fakeDeps({ skipAnimations: true });
    delete deps.beat; // 既定の掛け金（Player.tap() が解く）
    const player = createPlayer(deps);
    let done = false;
    const p = player.play(r.events, s, r.state).then(() => {
      done = true;
    });
    // M5.5: 2d10 の前に出目の表のタップ待ちがある。表が出て待ちに入ったら 1 回解く
    const tableWaiting = (): boolean => {
      const t = log.findIndex((e) => e.m === "penaltyTable.show");
      return t >= 0 && log.slice(t).some((e) => e.m === "message.setMore" && e.a.length === 2 && e.a[0] === true);
    };
    for (let i = 0; i < 1000 && !tableWaiting(); i++) await Promise.resolve();
    expect(tableWaiting()).toBe(true);
    expect(names(log)).not.toContain("dice.show");
    player.tap();
    // タップ待ちに入る（dice.show の後に setMore(true, blink) が呼ばれる）まで進める
    const waiting = (): boolean => {
      const d = log.findIndex((e) => e.m === "dice.show");
      return d >= 0 && log.slice(d).some((e) => e.m === "message.setMore" && e.a.length === 2 && e.a[0] === true);
    };
    for (let i = 0; i < 1000 && !waiting(); i++) await Promise.resolve();
    expect(waiting()).toBe(true);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(done).toBe(false);
    expect(names(log)).toContain("dice.show");
    expect(names(log)).not.toContain("dice.hide");
    expect(names(log)).not.toContain("wipe.show");
    player.tap();
    await p;
    expect(names(log).filter((m) => m === "dice.hide" || m === "wipe.show")).toEqual(["dice.hide", "wipe.show"]);
  });

  test("UI-44/UI-56 戦闘の外の全滅（wipeIfNoneCanAct）: 全滅の 2d10 を出したら inputClosed を呼び（迷宮のヘッダー・操作を下げる）、それは内訳を開く前のタップ待ちより前（演出スキップの真偽とも）", async () => {
    const s = structuredClone(dived(1));
    for (const c of s.party) c.status = ["paralysis"];
    const r = execute(s, { type: "dungeon.turn", dir: "left" }, data);
    for (const skipAnimations of [false, true]) {
      const { deps, log } = fakeDeps({ skipAnimations });
      await createPlayer(deps).play(r.events, s, r.state);
      const ms = names(log).filter((m) => m === "inputClosed" || m === "dice.show" || m === "beat.waitTap" || m === "wipe.show");
      // M5.5: 2d10 の前の出目の表でも inputClosed → タップ待ち（旧は ["inputClosed", "dice.show", "beat.waitTap", "wipe.show"]）
      expect(ms, String(skipAnimations)).toEqual(["inputClosed", "beat.waitTap", "inputClosed", "dice.show", "beat.waitTap", "wipe.show"]);
    }
  });

  /** 出目の表の記録（penaltyTable.show の引数） */
  const tableShows = (log: Log): PenaltyTableText[] => log.filter((e) => e.m === "penaltyTable.show").map((e) => e.a[0] as PenaltyTableText);

  test("UI-56 penaltyTable{hit null} で表を出し、入力の UI を下げてタップを 1 回待ってから 2d10 へ進む。演出スキップでも待つ。penaltyTable{hit} は当たった行を強調し、待たない（戦闘の外の全滅。core の実際の列）", async () => {
    const s = structuredClone(dived(1));
    for (const c of s.party) c.status = ["paralysis"];
    const r = execute(s, { type: "dungeon.turn", dir: "left" }, data);
    const tables = r.events.filter((e) => e.kind === "penaltyTable");
    expect(tables.map((e) => e.hit)).toEqual([null, r.events.find((e) => e.kind === "wipe")!.penalty.bandIndex]);
    for (const skipAnimations of [false, true]) {
      const { deps, log } = fakeDeps({ skipAnimations });
      await createPlayer(deps).play(r.events, s, r.state);
      const ms = names(log).filter((m) => ["penaltyTable.show", "penaltyTable.hide", "inputClosed", "beat.waitTap", "dice.show", "dice.hide", "wipe.show"].includes(m));
      expect(ms, String(skipAnimations)).toEqual([
        "penaltyTable.show",
        "inputClosed",
        "beat.waitTap",
        "inputClosed",
        "dice.show",
        "penaltyTable.show",
        "beat.waitTap",
        "dice.hide",
        "penaltyTable.hide",
        "wipe.show",
      ]);
      const [first, second] = tableShows(log);
      // 1 回目は全行 pad、2 回目は当たった帯の行だけ mark で強調
      expect(first!.lines.every((l) => !l.hit && l.text.startsWith(data.strings["wipe.table.pad"]!))).toBe(true);
      const hit = (tables[1] as Extract<GameEvent, { kind: "penaltyTable" }>).hit!;
      expect(second!.lines.map((l) => l.hit)).toEqual(data.penaltyTable.bands.map((_, i) => i === hit));
      expect(second!.lines[hit]!.text.startsWith(data.strings["wipe.table.mark"]!)).toBe(true);
      // 表のタップ待ちの続きの三角は演出スキップでは点滅しない
      const w = log.findIndex((e) => e.m === "beat.waitTap");
      expect(log.slice(0, w).filter((e) => e.m === "message.setMore").at(-1)?.a).toEqual([true, !skipAnimations]);
    }
  });

  test("UI-56 出目の表のタップ待ちは Player.tap() で解くまで 2d10 を出さない（演出スキップでも）", async () => {
    const s = structuredClone(dived(1));
    for (const c of s.party) c.status = ["paralysis"];
    const r = execute(s, { type: "dungeon.turn", dir: "left" }, data);
    const { deps, log } = fakeDeps({ skipAnimations: true });
    delete deps.beat;
    const player = createPlayer(deps);
    const p = player.play(r.events, s, r.state);
    for (let i = 0; i < 200; i++) await Promise.resolve();
    expect(names(log)).toContain("penaltyTable.show");
    expect(names(log)).not.toContain("dice.show");
    player.tap();
    // 2d10 の後の待ち（dice.show の後の setMore(true, blink)）に入るまで進めてから、もう 1 回解く
    const diceWaiting = (): boolean => {
      const d = log.findIndex((e) => e.m === "dice.show");
      return d >= 0 && log.slice(d).some((e) => e.m === "message.setMore" && e.a.length === 2 && e.a[0] === true);
    };
    for (let i = 0; i < 1000 && !diceWaiting(); i++) await Promise.resolve();
    expect(diceWaiting()).toBe(true);
    player.tap();
    await p;
    expect(names(log).at(-1)).toBe("screens.sync");
  });

  test("UI-56/CB-53 戦闘の中の全滅（system の拍の中）でも、表 → タップ → 2d10 → 強調 → 最後の拍の待ち → 表と 2d10 を消して内訳（手動・オート、演出スキップの真偽とも）。2 回目の表で 2d10 の箱は消えない", async () => {
    const PARA = { status: ["paralysis" as const] };
    const s0 = structuredClone(dived(1));
    for (const c of s0.party) Object.assign(c, c.id === "c1" ? { hp: 1 } : PARA);
    const d = dataWith({ combat: ALWAYS_HIT });
    for (const auto of [false, true]) {
      const s = withBattle(s0, [{ monsterId: "kobold", hps: [50] }], { identified: ["kobold"], inputs: { c1: { type: "defend" } }, auto });
      const r = execute(s, { type: "battle.resolve" }, d);
      expect(r.events.filter((e) => e.kind === "penaltyTable")).toHaveLength(2);
      for (const skipAnimations of [false, true]) {
        const { deps, log } = fakeDeps({ skipAnimations });
        await createPlayer(deps).play(r.events, s, r.state);
        const t0 = log.findIndex((e) => e.m === "penaltyTable.show");
        const w = log.findIndex((e) => e.m === "wipe.show");
        const ms = names(log.slice(t0, w + 1)).filter((m) =>
          ["penaltyTable.show", "penaltyTable.hide", "beat.waitTap", "message.waitMs", "dice.show", "dice.hide", "wipe.show"].includes(m),
        );
        const tag = `${auto} ${skipAnimations}`;
        expect(ms, tag).toEqual(["penaltyTable.show", "beat.waitTap", "dice.show", "penaltyTable.show", "beat.waitTap", "dice.hide", "penaltyTable.hide", "wipe.show"]);
      }
    }
  });

  test("UI-56 表と 2d10 は再生の終わりにも消す（wipe の無い列でも残さない）", async () => {
    const { deps, log } = fakeDeps();
    const s = stateWith(diveAt(1, 1, "N"));
    const ev: GameEvent = { kind: "penaltyTable", title: { key: "wipe.table.title", params: { dice: "2d10" } }, rows: [{ key: "wipe.table.rowOne", params: { roll: 20, name: "x", gold: 0, items: 0, exp: 0 } }], hit: 0 };
    await createPlayer(deps).play([ev], s, s);
    expect(names(log).filter((m) => m.startsWith("penaltyTable"))).toEqual(["penaltyTable.show", "penaltyTable.hide"]);
    // hit があれば待たない
    expect(names(log)).not.toContain("beat.waitTap");
  });

  test("UI-44 全滅でないダイス（逃走の判定など）では inputClosed を呼ばない", async () => {
    const { deps, log } = fakeDeps();
    const s = stateWith(diveAt(1, 1, "N"));
    await createPlayer(deps).play([rollDiceEv("dice.flee", [37], 37, "dice.flee.ok"), { kind: "message", key: "battle.fleeOk" }], s, s);
    expect(names(log)).toContain("dice.show");
    expect(names(log)).not.toContain("inputClosed");
  });

  test("UI-44/UI-54 battleEnd を受けたら battleEnded を 1 回呼ぶ（戦闘の入力の UI を下げる）。戦闘の外への screen と全滅の内訳より前", async () => {
    const PARA = { status: ["paralysis" as const] };
    const s0 = structuredClone(dived(1));
    for (const c of s0.party) Object.assign(c, c.id === "c1" ? { hp: 1 } : PARA);
    const s = withBattle(s0, [{ monsterId: "kobold", hps: [50] }], { identified: ["kobold"], inputs: { c1: { type: "defend" } } });
    const r = execute(s, { type: "battle.resolve" }, dataWith({ combat: ALWAYS_HIT }));
    const { deps, log } = fakeDeps();
    await createPlayer(deps).play(r.events, s, r.state);
    const ms = names(log).filter((m) => m === "battleEnded" || m === "wipe.show" || m === "screens.show");
    expect(ms).toEqual(["battleEnded", "wipe.show", "screens.show"]);
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
    { index: 0, monsterId: "giant_rat", name: "何かの獣", identified: false, count: 2 },
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
      { m: "battleEnded", a: [] },
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

  /**
   * 遭遇の再生（何かが現れた！ → 拍 → 先手判定）を既定の掛け金で流す。dice.show は finish() まで解決せず、
   * settled（最終の段まで描いたか）と typing（文字送り中か）は試験が決める
   */
  const encounterRun = (tail: GameEvent[]) => {
    const { deps, log } = fakeDeps();
    delete deps.beat; // 既定の掛け金（Player.tap() が解く）
    const s = battleState();
    const player = createPlayer(deps);
    const st = { settled: false, typing: false };
    let finish: () => void = () => undefined;
    deps.dice.show = (ev, skip, stepMs) => {
      log.push({ m: "dice.show", a: [ev.label.key, skip(), stepMs] });
      return new Promise<void>((r) => {
        finish = r;
      });
    };
    deps.dice.settled = () => st.settled;
    deps.message.typing = () => st.typing;
    /** message.say の頭で呼ぶ（文字送りの最中のタップを作る） */
    const hook: { onSay: ((text: string) => void) | null } = { onSay: null };
    const sayFn = deps.message.say;
    deps.message.say = (text, instant) => {
      hook.onSay?.(text);
      return sayFn(text, instant);
    };
    let done = false;
    const events: GameEvent[] = [{ kind: "screen", to: "battle" }, beat("system", false), { kind: "encounter", groups: [] }, msg("battle.encounter"), beat("system", false), ...tail];
    expectKnownStringKeys(events);
    const p = player
      .play(events, s, s)
      .then(() => {
        done = true;
      });
    const flush = async (): Promise<void> => {
      for (let i = 0; i < 20; i++) await Promise.resolve();
    };
    return { log, player, st, hook, p, flush, finishDice: () => finish(), isDone: () => done };
  };
  const INITIATIVE_PARTY: GameEvent = { ...(INITIATIVE as DiceEvent), result: { key: "dice.initiative.party" } };

  test("UI-45/UI-40 拍の中で見せる残りが無い（ダイスが最終の段まで出て、文字送り中でない）ときのタップは、その拍の待ちのタップになる（互角: 1 回で進む）", async () => {
    const r = encounterRun([INITIATIVE]);
    await r.flush();
    // 「何かが現れた！」の後の拍の待ち
    r.player.tap();
    await r.flush();
    expect(r.log.filter((e) => e.m === "dice.show")).toHaveLength(1);
    // 結果の行を描いた後の点滅の最中（dice.show はまだ解決していない）にタップ
    r.st.settled = true;
    r.player.tap();
    r.finishDice();
    await r.flush();
    // 再生の終わりの待ち（ダイスが出ている）を、さっきのタップで抜けている
    expect(r.isDone()).toBe(true);
    await r.p;
    // 続きの三角は「何かが現れた！」の後の 1 回だけ
    expect(r.log.filter((e) => e.m === "message.setMore" && e.a[0] === true)).toHaveLength(1);
  });

  test("UI-45/UI-40 ダイスの動きの途中（最終の段の前）のタップは残りを即時にするだけで、待ちは 1 回残る", async () => {
    const r = encounterRun([INITIATIVE]);
    await r.flush();
    r.player.tap();
    await r.flush();
    r.st.settled = false;
    r.player.tap();
    r.finishDice();
    await r.flush();
    expect(r.isDone()).toBe(false);
    expect(r.log.filter((e) => e.m === "message.setMore" && e.a[0] === true)).toHaveLength(2);
    r.player.tap();
    await r.p;
    expect(r.isDone()).toBe(true);
  });

  test("UI-45/UI-43 文字送り中のタップは文の即表示だけで、待ちは 1 回残る", async () => {
    const r = encounterRun([INITIATIVE, msg("battle.surpriseParty")]);
    await r.flush();
    r.player.tap();
    await r.flush();
    r.st.settled = true;
    // 「こちらが先手を取った！」の文字送り中にタップ
    r.hook.onSay = () => {
      r.st.typing = true;
      r.player.tap();
      r.st.typing = false;
    };
    r.finishDice();
    await r.flush();
    expect(r.log.filter((e) => e.m === "message.rush")).toHaveLength(1);
    expect(r.isDone()).toBe(false);
    r.player.tap();
    await r.p;
  });

  test("UI-45/UI-40 見せる残りが無いときのタップの後に文が来たら、そのタップは取り消す（文は即表示し、待ちは 1 回残る。先手）", async () => {
    const r = encounterRun([INITIATIVE_PARTY, msg("battle.surpriseParty")]);
    await r.flush();
    r.player.tap();
    await r.flush();
    r.st.settled = true;
    r.player.tap();
    r.finishDice();
    await r.flush();
    expect(r.log.filter((e) => e.m === "message.say").map((e) => e.a)).toEqual([
      [formatMessage(data.strings["battle.encounter"]!), false],
      [formatMessage(data.strings["battle.surpriseParty"]!), true],
    ]);
    expect(r.isDone()).toBe(false);
    r.player.tap();
    await r.p;
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

describe("UI-55 イベントの再生（M5）", () => {
  const dungeonState = (): GameState => stateWith(diveAt(1, 1, "N"));
  const eventState = (): GameState => ({
    ...dungeonState(),
    screen: "event",
    pendingChoice: {
      kind: "event",
      promptKey: "event.glowing_tablet.intro",
      options: [{ id: "examine", labelKey: "event.glowing_tablet.choice.examine" }],
      eventId: "glowing_tablet",
    },
  });

  test("UI-55 eventStarted に actorId があれば markActor(id, true)、演出スキップでは (id, false)。actorId が無ければ呼ばない。再生の終わり（sync の前）に markActor(null, false)", async () => {
    for (const skipAnimations of [false, true]) {
      const { deps, log } = fakeDeps({ skipAnimations });
      const s = dungeonState();
      await createPlayer(deps).play(
        [{ kind: "eventStarted", eventId: "glowing_tablet", actorId: "c3" }, msg("event.glowing_tablet.intro"), msg("event.impulse.actor", { actor: "キリ" })],
        s,
        s,
      );
      const marks = log.filter((e) => e.m === "party.markActor").map((e) => e.a);
      expect(marks, String(skipAnimations)).toEqual([
        ["c3", !skipAnimations],
        [null, false],
      ]);
      // 外すのは文を出し終えた後、sync の直前
      const ms = names(log);
      expect(ms.slice(-2)).toEqual(["party.markActor", "screens.sync"]);
      expect(ms.indexOf("party.markActor")).toBeLessThan(ms.indexOf("message.say"));
    }
    const { deps, log } = fakeDeps();
    const s = dungeonState();
    await createPlayer(deps).play([{ kind: "eventStarted", eventId: "glowing_tablet" }, msg("event.glowing_tablet.intro")], s, s);
    expect(names(log)).not.toContain("party.markActor");
  });

  test("UI-55 eventStarted で deps.eventStarted を 1 回（迷宮の操作を下げる。actorId の有無とも）", async () => {
    for (const ev of [
      { kind: "eventStarted", eventId: "glowing_tablet" },
      { kind: "eventStarted", eventId: "glowing_tablet", actorId: "c3" },
    ] as GameEvent[]) {
      const { deps, log } = fakeDeps();
      const s = dungeonState();
      await createPlayer(deps).play([{ kind: "moved", pos: { x: 1, y: 0 }, facing: "N" }, ev], s, s);
      expect(names(log).filter((m) => m === "eventStarted")).toHaveLength(1);
      // 次の再生では印を引き継がない
      const f2 = fakeDeps();
      await createPlayer(f2.deps).play([msg("dungeon.door")], s, s);
      expect(names(f2.log)).not.toContain("party.markActor");
    }
  });

  test("UI-55 screen{event} は screens.show('event') でフェードしない。event → dungeon もフェード・描き直しをしない。dungeon → dungeon は今どおりフェード", async () => {
    const ui = data.config.ui;
    // 迷宮 → イベント（選択を待つ）
    {
      const { deps, log } = fakeDeps();
      const before = dungeonState();
      await createPlayer(deps).play([{ kind: "eventStarted", eventId: "glowing_tablet" }, msg("event.glowing_tablet.intro"), { kind: "screen", to: "event" }], before, eventState());
      expect(log.filter((e) => e.m === "screens.show").map((e) => e.a)).toEqual([["event"]]);
      expect(names(log)).not.toContain("view.fade");
      expect(names(log)).not.toContain("view.showAt");
    }
    // イベント → 迷宮（選択の後）。その後の moved は最終の dive の視点から進める
    {
      const { deps, log } = fakeDeps();
      const after = stateWith(diveAt(1, 1, "N"));
      await createPlayer(deps).play(
        [{ kind: "screen", to: "dungeon" }, msg("event.glowing_tablet.examine"), { kind: "moved", pos: { x: 1, y: 0 }, facing: "N" }],
        eventState(),
        after,
      );
      expect(log.filter((e) => e.m === "screens.show").map((e) => e.a)).toEqual([["dungeon"]]);
      // フェードは moved の 1 回だけ（screen dungeon では描き直さない）
      expect(log.filter((e) => e.m === "view.fade").map((e) => e.a)).toEqual([[ui.viewFadeMs]]);
      expect(log.filter((e) => e.m === "view.showAt").map((e) => e.a[0])).toEqual([{ floor: 1, pos: { x: 1, y: 0 }, facing: "N" }]);
    }
    // 迷宮 → 迷宮（入場など）は今どおりフェードして描き直す
    {
      const { deps, log } = fakeDeps();
      const s = dungeonState();
      await createPlayer(deps).play([{ kind: "screen", to: "dungeon" }], s, s);
      expect(log.filter((e) => e.m === "view.fade").map((e) => e.a)).toEqual([[ui.viewFadeMs]]);
    }
  });

  test("UI-55/EV-23 core の実際の列（光る石板の衝動。シード固定）: eventStarted の後に行動者 c3 の印、再生の終わりで外す", async () => {
    const d = dataEvents();
    const s = atEvent("glowing_tablet").state;
    const r = execute(s, { type: "dungeon.move" }, d);
    const st = r.events.find((e) => e.kind === "eventStarted");
    expect(st).toEqual({ kind: "eventStarted", eventId: "glowing_tablet", actorId: "c3" });
    for (const skipAnimations of [false, true]) {
      const { deps, log } = fakeDeps({ skipAnimations });
      await createPlayer(deps).play(r.events, s, r.state);
      const ms = names(log);
      expect(ms.indexOf("eventStarted")).toBeLessThan(ms.indexOf("party.markActor"));
      expect(log.filter((e) => e.m === "party.markActor").map((e) => e.a)).toEqual([
        ["c3", !skipAnimations],
        [null, false],
      ]);
      expect(ms.at(-1)).toBe("screens.sync");
      expect(ms.at(-2)).toBe("party.markActor");
    }
  });
});

describe("UI-55/UI-40 制止の箱のタップ待ち（M5）", () => {
  const s = (): GameState => stateWith(diveAt(1, 1, "N"));
  /** 制止の dice（1 件 2 行。値は表示の確認用） */
  const restrain = (ok: boolean): GameEvent => ({
    kind: "dice",
    label: { key: "dice.restrain" },
    rows: [
      { label: { key: "dice.restrain.stopper", params: { name: "フィン" } }, base: 9, dice: [7], total: 16 },
      { label: { key: "dice.restrain.actor", params: { name: "キリ" } }, base: 15, dice: [3], total: 18 },
    ],
    rule: { key: "dice.restrain.rule", params: { diff: -2 } },
    result: { key: ok ? "dice.restrain.ok" : "dice.restrain.ng" },
  });
  const learn: GameEvent = {
    kind: "dice",
    label: { key: "dice.learn", params: { spell: "x" } },
    rows: [{ label: { key: "dice.row.roll" }, base: null, dice: [12], total: 12 }],
    rule: { key: "dice.rule.rate", params: { rate: 50 } },
    result: { key: "dice.learn.ok" },
  };
  /** 箱・語り・待ち・消す・画面の切り替えの順だけを見る */
  const span = (log: Log): string[] =>
    log
      .filter((e) => ["dice.show", "dice.hide", "beat.waitTap", "message.say", "screens.show", "party.setSan"].includes(e.m))
      .map((e) => (e.m === "message.say" ? `say:${String(e.a[0])}` : e.m === "screens.show" ? `screens.show:${String(e.a[0])}` : e.m));
  const say = (key: string, params?: Record<string, string | number>): string => `say:${formatMessage(data.strings[key]!, params)}`;

  test("UI-55/UI-40 拍の外の制止の箱: 続く message を 1 件出した後でタップを待ち、待ちの後に消す（演出スキップの真偽とも）", async () => {
    for (const skipAnimations of [false, true]) {
      const { deps, log } = fakeDeps({ skipAnimations });
      const events: GameEvent[] = [
        msg("event.stop.roll", { stopper: "フィン" }),
        restrain(false),
        msg("event.stop.fail", { stopper: "フィン" }),
        msg("event.glowing_tablet.impulse", { actor: "キリ" }),
      ];
      expectKnownStringKeys(events);
      await createPlayer(deps).play(events, s(), s());
      expect(span(log), String(skipAnimations)).toEqual([
        say("event.stop.roll", { stopper: "フィン" }),
        "dice.show",
        say("event.stop.fail", { stopper: "フィン" }),
        "beat.waitTap",
        "dice.hide",
        say("event.glowing_tablet.impulse", { actor: "キリ" }),
      ]);
      // 続きの三角は演出スキップでは点滅しない
      const w = log.findIndex((e) => e.m === "beat.waitTap");
      expect(log.slice(0, w).filter((e) => e.m === "message.setMore").at(-1)?.a).toEqual([true, !skipAnimations]);
    }
  });

  test("UI-55 制止の箱のタップ待ちは Player.tap() で解くまで先へ進まない（箱は出たまま）", async () => {
    const { deps, log } = fakeDeps();
    delete deps.beat; // 既定の掛け金（Player.tap() が解く）
    const player = createPlayer(deps);
    let done = false;
    const p = player.play([restrain(true), msg("event.stop.success", { stopper: "フィン", actor: "キリ" }), msg("event.nothing")], s(), s()).then(() => {
      done = true;
    });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(done).toBe(false);
    expect(log.filter((e) => e.m === "message.say")).toHaveLength(1);
    expect(names(log)).not.toContain("dice.hide");
    player.tap();
    await p;
    expect(done).toBe(true);
    expect(log.filter((e) => e.m === "message.say")).toHaveLength(2);
    expect(names(log).filter((m) => m === "dice.hide")).toHaveLength(1);
    expect(names(log)).not.toContain("message.rush"); // 待ちを解くだけ
  });

  test("UI-55 制止の箱の後に message が無く sanChanged / screen が来たらその前で待つ。箱で列が終わるなら終わりで待つ。成否の語りが最後の文なら終わりで待つ", async () => {
    {
      const { deps, log } = fakeDeps();
      await createPlayer(deps).play([restrain(true), { kind: "sanChanged", id: "c6", delta: 3, san: 53 }, { kind: "screen", to: "event" }], s(), s());
      expect(span(log)).toEqual(["dice.show", "beat.waitTap", "dice.hide", "party.setSan", "screens.show:event"]);
    }
    {
      const { deps, log } = fakeDeps();
      await createPlayer(deps).play([restrain(true)], s(), s());
      expect(span(log)).toEqual(["dice.show", "beat.waitTap", "dice.hide"]);
    }
    {
      const { deps, log } = fakeDeps();
      await createPlayer(deps).play([restrain(false), msg("event.stop.fail", { stopper: "フィン" })], s(), s());
      expect(span(log)).toEqual(["dice.show", say("event.stop.fail", { stopper: "フィン" }), "beat.waitTap", "dice.hide"]);
      expect(log.filter((e) => e.m === "beat.waitTap")).toHaveLength(1);
    }
  });

  test("UI-40/TW-17 強化の箱（core の実際の town.upgrade の列）も制止の箱と同じく、成否の語りを出した後でタップを 1 回待ってから消す（演出スキップの真偽とも）", async () => {
    const st = cloneState(newGame(1));
    st.gold = 1000;
    const r = execute(st, { type: "town.upgrade", memberId: "c1", slot: "weapon", catalysts: [] }, data);
    expect(r.events.map((e) => e.kind)).toEqual(["dice", "message"]);
    const m = r.events[1]!;
    if (m.kind !== "message") throw new Error("message expected");
    for (const skipAnimations of [false, true]) {
      const { deps, log } = fakeDeps({ skipAnimations });
      await createPlayer(deps).play(r.events, st, r.state);
      expect(span(log), String(skipAnimations)).toEqual(["dice.show", say(m.key, m.params), "beat.waitTap", "dice.hide"]);
    }
  });

  test("UI-40/CH-77 司教の鑑定の箱（core の実際の party.identify の列）も、続く語りを出した後でタップを 1 回待ってから消す（演出スキップの真偽とも）", async () => {
    const st = cloneState(newGame(1));
    const c5 = st.party.find((c) => c.id === "c5")!;
    c5.classId = "bishop";
    c5.maxLevelReached = { bishop: 1 };
    const id = createItemInstance(st, { itemId: "dagger", identified: false });
    st.party.find((c) => c.id === "c1")!.inventory.push(id);
    const r = execute(st, { type: "party.identify", memberId: "c5", instanceId: id }, data);
    expect(r.events.map((e) => e.kind)).toEqual(["mpChanged", "dice", "message"]);
    const m = r.events[2]!;
    if (m.kind !== "message") throw new Error("message expected");
    for (const skipAnimations of [false, true]) {
      const { deps, log } = fakeDeps({ skipAnimations });
      await createPlayer(deps).play(r.events, st, r.state);
      expect(span(log), String(skipAnimations)).toEqual(["dice.show", say(m.key, m.params), "beat.waitTap", "dice.hide"]);
    }
  });

  test("UI-40 拍の外の dice.learn は待たない（続く message の間だけ残し、次のイベントで消す）", async () => {
    const { deps, log } = fakeDeps();
    await createPlayer(deps).play([learn, msg("event.nothing"), { kind: "sanChanged", id: "c2", delta: -1, san: 99 }], s(), s());
    expect(span(log)).toEqual(["dice.show", say("event.nothing"), "dice.hide", "party.setSan"]);
    expect(names(log)).not.toContain("beat.waitTap");
  });

  test("UI-55/EV-22 core の実際の列（光る石板。フィンの iq 100 で制止成功 → 選択。シード固定）: 箱 → 成否 → 待ち → 消す → screen{event}", async () => {
    const d = dataEvents();
    const base = atEvent("glowing_tablet").state;
    const fin = base.party[5]!;
    const st = withChar(base, 5, { stats: { ...fin.stats, iq: 100 } });
    const r = execute(st, { type: "dungeon.move" }, d);
    expect(r.state.screen).toBe("event");
    const ks = r.events.filter((e) => e.kind === "dice" || e.kind === "message" || e.kind === "screen").map((e) => (e.kind === "message" ? e.key : e.kind));
    expect(ks.slice(-4)).toEqual(["event.stop.roll", "dice", "event.stop.success", "screen"]);
    for (const skipAnimations of [false, true]) {
      const { deps, log } = fakeDeps({ skipAnimations });
      await createPlayer(deps).play(r.events, st, r.state);
      const sp = span(log);
      const at = sp.indexOf("dice.show");
      expect(sp.slice(at), String(skipAnimations)).toEqual([
        "dice.show",
        say("event.stop.success", { stopper: fin.name, actor: st.party[2]!.name }),
        "beat.waitTap",
        "dice.hide",
        "screens.show:event",
      ]);
      expect(log.filter((e) => e.m === "beat.waitTap")).toHaveLength(1);
    }
  });

  test("CB-04/UI-45 不意打ちの察知の箱は別の拍。手動では先手の箱の後でタップを待ってから替わる（core の実際の列）", async () => {
    const d = dataWith({ combat: ALWAYS_HIT }, (x) => (x.monsters.find((m) => m.id === "giant_rat")!.agi = 1000));
    let found: { before: GameState; events: GameEvent[]; after: GameState } | null = null;
    for (let seed = 1; seed <= 200 && found === null; seed++) {
      const before = dived(seed);
      const ctx = makeContext(cloneState(before), d);
      startBattle(ctx, { kind: "random", inRoom: false }, [{ monsterId: "giant_rat", count: 2 }]);
      if (ctx.events.some((e) => e.kind === "dice" && e.result.key === "dice.ambushAvoid.ok")) found = { before, events: ctx.events, after: ctx.state };
    }
    expect(found).not.toBeNull();
    const { deps, log } = fakeDeps();
    await createPlayer(deps).play(found!.events, found!.before, found!.after);
    const sp = log
      .filter((e) => ["dice.show", "dice.hide", "beat.waitTap", "message.say"].includes(e.m))
      .map((e) => (e.m === "dice.show" ? `show:${String(e.a[0])}` : e.m === "message.say" ? "say" : e.m));
    const i = sp.indexOf("show:dice.initiative");
    // 先手の箱 → 不意を突かれた → タップ待ち → 箱を消す → 察知の箱 → 免れた → 再生の終わりの待ち（手動・ダイスあり）→ 消す
    expect(sp.slice(i)).toEqual(["show:dice.initiative", "say", "beat.waitTap", "dice.hide", "show:dice.ambushAvoid", "say", "beat.waitTap", "dice.hide"]);
  });
});

describe("UI-66 playback の音の契機", () => {
  test("UI-66 deps.sound は各イベントのハンドラの前に 1 回ずつ呼ばれる（演出スキップでも同じ）", async () => {
    const run = async (skipAnimations: boolean): Promise<string[]> => {
      const { deps, log } = fakeDeps({ skipAnimations });
      deps.sound = (ev) => log.push({ m: `sound:${ev.kind}`, a: [] });
      const before = stateWith(diveAt(3, 3, "N"));
      const after = stateWith(diveAt(3, 2, "E", 2));
      const events: GameEvent[] = [
        { kind: "message", key: "dungeon.door" },
        { kind: "moved", pos: { x: 3, y: 2 }, facing: "N" },
        { kind: "floorChanged", floor: 2, pos: { x: 3, y: 2 }, facing: "E" },
        { kind: "beat", phase: "system", auto: false },
        { kind: "hpChanged", id: "c1", delta: -2, hp: 5 },
      ];
      await createPlayer(deps).play(events, before, after);
      const seq = names(log);
      // 音はハンドラの描画より前
      expect(seq.indexOf("sound:message")).toBeLessThan(seq.indexOf("message.say"));
      expect(seq.indexOf("sound:hpChanged")).toBeLessThan(seq.indexOf("party.setHp"));
      return seq.filter((m) => m.startsWith("sound:"));
    };
    const want = ["sound:message", "sound:moved", "sound:floorChanged", "sound:beat", "sound:hpChanged"];
    expect(await run(false)).toEqual(want);
    expect(await run(true)).toEqual(want);
  });

  test("UI-66（2026-10-07）deps.soundStart は再生の開始に 1 回、最初の deps.sound より前に呼ばれる（同じ拍の効果音の記録を空にする契機）", async () => {
    const { deps, log } = fakeDeps({ skipAnimations: true });
    deps.sound = (ev) => log.push({ m: `sound:${ev.kind}`, a: [] });
    deps.soundStart = () => log.push({ m: "soundStart", a: [] });
    const s = stateWith(diveAt(3, 3, "N"));
    const p = createPlayer(deps);
    await p.play([{ kind: "blocked" }, { kind: "beat", phase: "system", auto: true }, { kind: "blocked" }], s, s);
    await p.play([{ kind: "blocked" }], s, s);
    const seq = names(log).filter((m) => m === "soundStart" || m.startsWith("sound:"));
    expect(seq).toEqual(["soundStart", "sound:blocked", "sound:beat", "sound:blocked", "soundStart", "sound:blocked"]);
  });

  test("UI-66 deps.sound が例外を投げても再生は続く", async () => {
    const { deps, log } = fakeDeps({ skipAnimations: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    deps.sound = () => {
      throw new Error("boom");
    };
    const s = stateWith(diveAt(3, 3, "N"));
    await createPlayer(deps).play([{ kind: "message", key: "dungeon.door" }], s, s);
    expect(names(log)).toContain("message.say");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

// ---------------------------------------------------------------- UI-47（M8.5）街の会話の箱
describe("UI-47 街の会話の箱と再生", () => {
  test("UI-47 townCarry: 帰還（core の returnToTown）は screen{town} の前の dungeon.return・town.enter（と救済）を整形して返す", () => {
    const base = stateWith(diveAt(1, 1, "N"));
    const ctx = makeContext(cloneState(base), data);
    returnToTown(ctx, "dungeon.return");
    const evs = ctx.events;
    const i = evs.findIndex((e) => e.kind === "screen" && e.to === "town");
    expect(i).toBeGreaterThan(0);
    expect(townCarry(evs, i, data.strings)).toEqual([data.strings["dungeon.return"], data.strings["town.enter"]]);
    // 救済の申し出も（leader 以外が全員死亡で、金が足りない）
    const dead = cloneState(base);
    dead.gold = 0;
    dead.bank = 0;
    for (const c of dead.party) if (!c.isLeader) Object.assign(c, { life: "dead", hp: 0 });
    const ctx2 = makeContext(dead, data);
    returnToTown(ctx2, "dungeon.return");
    const j = ctx2.events.findIndex((e) => e.kind === "screen" && e.to === "town");
    expect(townCarry(ctx2.events, j, data.strings)).toEqual([data.strings["dungeon.return"], data.strings["town.enter"], data.strings["town.mercy.offer"]]);
  });

  test("UI-47 townCarry: 全滅は wipe より後の語りだけ、game.new（前に message が無い）は空、params は整形する", () => {
    const evs: GameEvent[] = [
      { kind: "message", key: "wipe.intro" },
      { kind: "wipe", penalty: { roll: 2, bandIndex: 0, goldLost: 0, itemsLost: [], expLost: [], levelDowns: [], revived: [] } as unknown as PenaltyResult },
      { kind: "message", key: "town.enter" },
      { kind: "sanChanged", id: "c1", delta: 1, san: 100 },
      { kind: "screen", to: "town" },
    ];
    expect(townCarry(evs, 4, data.strings)).toEqual([data.strings["town.enter"]]);
    expect(townCarry([{ kind: "screen", to: "town" }], 0, data.strings)).toEqual([]);
    const withParams: GameEvent[] = [{ kind: "message", key: "dungeon.enter", params: { dungeon: "D" } }, { kind: "screen", to: "town" }];
    expect(townCarry(withParams, 1, data.strings)).toEqual([formatMessage(data.strings["dungeon.enter"]!, { dungeon: "D" })]);
    // 拍（戦闘）の語りは持ち越さない
    const beat: GameEvent[] = [{ kind: "message", key: "town.enter" }, { kind: "beat", phase: "system", auto: false } as GameEvent, { kind: "screen", to: "town" }];
    expect(townCarry(beat, 2, data.strings)).toEqual([]);
  });

  test("UI-47 screen{town} では carry を screens.show に渡し、他の画面では渡さない", async () => {
    const { deps } = fakeDeps();
    const shown: Array<{ to: string; carry: readonly string[] | undefined }> = [];
    deps.screens.show = (to, _st, carry) => {
      shown.push({ to, carry });
    };
    const base = stateWith(diveAt(1, 1, "N"));
    const ctx = makeContext(cloneState(base), data);
    returnToTown(ctx, "dungeon.return");
    await createPlayer(deps).play(ctx.events, base, ctx.state);
    expect(shown).toEqual([{ to: "town", carry: [data.strings["dungeon.return"], data.strings["town.enter"]] }]);
    const shown2: Array<{ to: string; n: number }> = [];
    deps.screens.show = (to, _st, ...rest: unknown[]) => {
      shown2.push({ to, n: rest.length });
    };
    await createPlayer(deps).play([{ kind: "screen", to: "dungeon" }], stateWith(null), base);
    expect(shown2).toEqual([{ to: "dungeon", n: 0 }]);
  });

  // M10.5: 文を溜めるので、持ち越しの 2 文は 1 回で出る（以前の期待値は「1 文目が ▼ で待ち、タップで 2 文目」）
  test("UI-47/UI-66（M10.5）階段で地上へ: 再生が終わった後、持ち越しの 2 文が箱に並び、最後の ▼ で待つ（pending）。箱のタップで page とともに閉じる", async () => {
    const { deps } = fakeDeps({ skipAnimations: true });
    const sink = { open: false, text: "", more: { on: false, blink: false } };
    const adv = { n: 0 };
    const talk = createTalkModel({
      advanced: () => adv.n++,
      sink: {
        open: (on) => (sink.open = on),
        text: (t) => (sink.text = t),
        more: (on, blink) => (sink.more = { on, blink }),
      },
      log: () => {},
      speed: () => 0,
      blink: () => false,
      schedule: () => () => {},
      ...TALK_DIMS,
    });
    // app の onScreen と同じく、街に入るときに carry を会話の箱に出し直す（再生は待たない）
    deps.screens.show = (to, _st, carry) => {
      if (to === "town" && carry !== undefined && carry.length > 0) void talk.replay(carry, true);
    };
    const base = stateWith(diveAt(1, 1, "N"));
    const ctx = makeContext(cloneState(base), data);
    returnToTown(ctx, "dungeon.exit");
    await createPlayer(deps).play(ctx.events, base, ctx.state);
    expect({ text: sink.text, more: sink.more.on, pending: talk.pending() }).toEqual({
      text: `${data.strings["dungeon.exit"]}\n${data.strings["town.enter"]}`,
      more: true,
      pending: true,
    });
    talk.tap();
    expect(adv.n).toBe(1);
    expect({ open: sink.open, more: sink.more.on, pending: talk.pending() }).toEqual({ open: false, more: false, pending: false });
  });

  // M10.5: 結果の文の後に残る ▼ は、閉じるタップを待つ最後の ▼（以前の期待値は「最後の文は ▼ なし」）
  test("UI-47/UI-40/TW-17 街の強化の箱: 会話の箱（実物のモデル）に結果を出した後、▼ を出してタップを 1 回待ってから箱を消す。結果の文は残る（演出スキップでも待ち、▼ は点滅しない）", async () => {
    const st = cloneState(newGame(1));
    st.gold = 1000;
    const r = execute(st, { type: "town.upgrade", memberId: "c1", slot: "weapon", catalysts: [] }, data);
    const m = r.events[1]!;
    if (m.kind !== "message") throw new Error("message expected");
    for (const skipAnimations of [false, true]) {
      const { deps, log } = fakeDeps({ skipAnimations });
      const sink = { open: false, text: "", more: { on: false, blink: false } };
      const logs: string[] = [];
      const talk = createTalkModel({
        sink: {
          open: (on) => (sink.open = on),
          text: (t) => (sink.text = t),
          more: (on, blink) => (sink.more = { on, blink }),
        },
        log: (t) => logs.push(t),
        speed: () => 0,
        blink: () => !skipAnimations,
        schedule: () => () => {},
        ...TALK_DIMS,
      });
      deps.message = createNarrator({ town: () => true, talk, window: deps.message });
      const latch = createTapLatch();
      deps.beat = latch;
      const player = createPlayer(deps);
      const p = player.play(r.events, st, r.state);
      await new Promise<void>((res) => setTimeout(res, 0));
      // 結果を出し、▼ を出して待っている（箱はまだ消していない）
      expect(sink.text, String(skipAnimations)).toBe(formatMessage(data.strings[m.key]!, m.params));
      expect(sink.more).toEqual({ on: true, blink: !skipAnimations });
      expect(names(log)).not.toContain("dice.hide");
      player.tap();
      await p;
      expect(names(log)).toContain("dice.hide");
      // 結果の文は残り（閉じるタップを待つ最後の ▼）、次のタップで閉じる
      expect({ open: sink.open, more: sink.more }).toEqual({ open: true, more: { on: true, blink: !skipAnimations } });
      expect(logs).toEqual([formatMessage(data.strings[m.key]!, m.params)]);
      talk.tap();
      expect(sink.open).toBe(false);
    }
  });

  // M10.5: 文ごとのタップ待ちをやめた（以前の期待値は「2 文目からタップを待つ」）
  test("UI-47（M10.5）再生の中の街の語りは箱に溜まり、文ごとのタップは待たない（再生はタップなしで終わる）", async () => {
    const { deps } = fakeDeps({ skipAnimations: true });
    const sink = { text: "" };
    const talk = createTalkModel({
      sink: { open: () => {}, text: (t) => (sink.text = t), more: () => {} },
      log: () => {},
      speed: () => 0,
      blink: () => false,
      schedule: () => () => {},
      ...TALK_DIMS,
    });
    deps.message = createNarrator({ town: () => true, talk, window: deps.message });
    const player = createPlayer(deps);
    await player.play([{ kind: "message", key: "town.enter" }, { kind: "message", key: "town.inn.intro" }], stateWith(null), stateWith(null));
    expect(sink.text).toBe(`${data.strings["town.enter"]}\n${data.strings["town.inn.intro"]}`);
  });

  test("UI-47（M10.5）nextSaid: 添字以降で最初の message の整形済みの文。先に screen / wipe / beat が来たら undefined", () => {
    const evs: GameEvent[] = [
      { kind: "levelUp", id: "c1", level: 2, hpGain: 3, mpGain: 0, hpMax: 13, mpMax: 0, hp: 13, mp: 0, statGains: [] },
      msg("town.inn.levelUp", { name: "アル", level: 2 }),
      { kind: "screen", to: "dungeon" },
      msg("dungeon.door"),
    ];
    expect(nextSaid(evs, 0, data.strings)).toBe(formatMessage(data.strings["town.inn.levelUp"]!, { name: "アル", level: 2 }));
    expect(nextSaid(evs, 2, data.strings)).toBeUndefined();
    expect(nextSaid(evs, 3, data.strings)).toBe(data.strings["dungeon.door"]);
    expect(nextSaid(evs, 4, data.strings)).toBeUndefined();
  });

  /**
   * UI-47 / UI-66（M10.5）: 実物の会話の箱と音の記録。cleared は app と同じく判定の箱を消す。
   * 音の記録の a[1] は、その音が鳴った時点で箱に出ている文（文字送りの途中の段を含む）
   */
  const townTalk = (skipAnimations: boolean, speed = 0) => {
    const { deps, log } = fakeDeps({ skipAnimations });
    const sink = { open: false, text: "", more: { on: false, blink: false } };
    const timers: Array<{ fn: () => void; dead: boolean }> = [];
    const talk = createTalkModel({
      sink: {
        open: (on) => (sink.open = on),
        text: (t) => (sink.text = t),
        more: (on, blink) => (sink.more = { on, blink }),
      },
      log: () => {},
      speed: () => speed,
      blink: () => !skipAnimations,
      schedule: (fn) => {
        const t = { fn, dead: false };
        timers.push(t);
        return () => {
          t.dead = true;
        };
      },
      cleared: () => deps.dice.hide(),
      ...TALK_DIMS,
    });
    deps.message = createNarrator({ town: () => true, talk, window: deps.message });
    deps.sound = (ev) => log.push({ m: `sound:${ev.kind}`, a: [ev.kind === "message" ? ev.key : "", sink.text] });
    /** 生きている文字送りのタイマーを 1 つ進める */
    const step = (): boolean => {
      const t = timers.find((x) => !x.dead);
      if (t === undefined) return false;
      t.dead = true;
      t.fn();
      return true;
    };
    return { deps, log, sink, talk, step };
  };
  const tick = (): Promise<void> => new Promise<void>((res) => setTimeout(res, 0));
  const fmt = (ev: GameEvent): string => (ev.kind === "message" ? formatMessage(data.strings[ev.key]!, ev.params) : "");
  /** 箱をちょうど n 行埋める文（士気の文。1 行） */
  const fill = (n: number): GameEvent[] => Array.from({ length: n }, () => msg("town.inn.morale"));

  test("UI-47/UI-66（M10.5）街の会話の箱: 文の後の出来事（spellLearned）の音は、その文の文字送りが終わった後（早く鳴らない）。箱に入れば待たず、判定の箱はページを閉じるまで残る", async () => {
    const p = { name: "アル", spell: "灯火" };
    const roll = msg("town.inn.learnRoll", p);
    const learned = msg("town.inn.learned", p);
    const events: GameEvent[] = [
      roll,
      rollDiceEv("dice.learn", [12], 12, "dice.learn.ok"),
      { kind: "spellLearned", id: "c1", spellId: "x", via: "roll" },
      learned,
    ];
    // 文字送りあり: 掴もうとしている の文の文字送りが終わるまで、判定の箱も learn も出ない
    {
      const { deps, log, sink, talk, step } = townTalk(false, 30);
      let done = false;
      const run = createPlayer(deps)
        .play(events, stateWith(null), stateWith(null))
        .then(() => {
          done = true;
        });
      await tick();
      expect(sink.text.length).toBeLessThan(fmt(roll).length);
      expect(names(log)).not.toContain("dice.show");
      expect(names(log)).not.toContain("sound:spellLearned");
      for (let i = 0; i < 200 && !done; i++) {
        step();
        await tick();
      }
      await run;
      const at = log.find((e) => e.m === "sound:spellLearned")!;
      // learn は、掴もうとしている の文が出終わり、覚えた の文が出る前に鳴る
      expect(at.a[1]).toBe(fmt(roll));
      expect(sink.text).toBe(`${fmt(roll)}\n${fmt(learned)}`);
      // 判定の箱は再生の終わりでも消さず、箱を閉じるタップで消す
      expect(names(log)).not.toContain("dice.hide");
      talk.tap();
      expect(names(log)).toContain("dice.hide");
    }
    for (const skipAnimations of [false, true]) {
      const { deps, log, sink } = townTalk(skipAnimations);
      await createPlayer(deps).play(events, stateWith(null), stateWith(null));
      // タップなしで再生が終わり、2 文が並ぶ
      expect(sink.text, String(skipAnimations)).toBe(`${fmt(roll)}\n${fmt(learned)}`);
      const seq = names(log);
      expect(seq.indexOf("sound:spellLearned")).toBeGreaterThan(seq.indexOf("dice.show"));
      expect(seq).not.toContain("dice.hide");
    }
  });

  test("UI-47/UI-66（M10.5）箱が埋まって次の文が入らなければ、learn は箱を空にするタップの後に空の箱の上で鳴る（前のページの間に鳴らない。演出スキップでも ▼ のタップを待つ）", async () => {
    const p = { name: "アル", spell: "灯火" };
    const roll = msg("town.inn.learnRoll", p);
    const learned = msg("town.inn.learned", p);
    const events: GameEvent[] = [
      ...fill(T.talk.lines - 1),
      roll,
      rollDiceEv("dice.learn", [12], 12, "dice.learn.ok"),
      { kind: "spellLearned", id: "c1", spellId: "x", via: "roll" },
      learned,
    ];
    for (const skipAnimations of [false, true]) {
      const { deps, log, sink, talk } = townTalk(skipAnimations);
      const player = createPlayer(deps);
      let done = false;
      const run = player.play(events, stateWith(null), stateWith(null)).then(() => {
        done = true;
      });
      await tick();
      // 箱が埋まり（22 行目が 掴もうとしている）、判定の箱を出したまま ▼ でタップを待つ。learn はまだ鳴らない
      expect(sink.text.split("\n"), String(skipAnimations)).toHaveLength(T.talk.lines);
      expect(sink.text.endsWith(fmt(roll))).toBe(true);
      expect(sink.more).toEqual({ on: true, blink: !skipAnimations });
      expect(names(log)).toContain("dice.show");
      expect(names(log)).not.toContain("dice.hide");
      expect(names(log)).not.toContain("sound:spellLearned");
      expect(done).toBe(false);
      player.tap();
      await run;
      // タップで箱を空にし（判定の箱も消える）、learn が鳴ってから 覚えた の文が 1 行目に出る
      const at = log.find((e) => e.m === "sound:spellLearned")!;
      expect(at.a[1]).toBe("");
      expect(names(log).indexOf("dice.hide")).toBeLessThan(names(log).indexOf("sound:spellLearned"));
      expect(sink.text).toBe(fmt(learned));
      expect(talk.isOpen()).toBe(true);
    }
  });

  test("UI-47/UI-66（M10.5）街の会話の箱: levelUp のジングルとパーティ欄の描き直し、message の音（resurrectOk）は、前の文の文字送りの後・その文が出る前。箱が埋まれば空にするタップの後", async () => {
    const before = msg("town.inn.morale");
    const lv = msg("town.inn.levelUp", { name: "アル", level: 2 });
    const ok = msg("town.temple.resurrectOk", { name: "アル" });
    const lvEv: GameEvent = { kind: "levelUp", id: "c1", level: 2, hpGain: 3, mpGain: 0, hpMax: 13, mpMax: 0, hp: 13, mp: 0, statGains: [] };
    {
      const { deps, log, sink, talk } = townTalk(false);
      await createPlayer(deps).play([before, lvEv, lv, ok], stateWith(null), stateWith(null));
      expect(log.find((e) => e.m === "sound:levelUp")!.a[1]).toBe(fmt(before));
      expect(log.find((e) => e.m === "sound:message" && e.a[0] === "town.temple.resurrectOk")!.a[1]).toBe(`${fmt(before)}\n${fmt(lv)}`);
      expect(names(log).indexOf("party.setMax")).toBeGreaterThan(names(log).indexOf("sound:levelUp"));
      expect(sink.text).toBe([before, lv, ok].map(fmt).join("\n"));
      // 最後の文は残り、次のタップで閉じる
      expect(sink.open).toBe(true);
      talk.tap();
      expect(sink.open).toBe(false);
    }
    {
      // 箱が埋まった後のジングルと文の音は、空にするタップの後
      const { deps, log, sink } = townTalk(false);
      const player = createPlayer(deps);
      const run = player.play([...fill(T.talk.lines), lvEv, lv, ok], stateWith(null), stateWith(null));
      await tick();
      expect(names(log)).not.toContain("sound:levelUp");
      expect(names(log)).not.toContain("party.setMax");
      player.tap();
      await run;
      expect(log.find((e) => e.m === "sound:levelUp")!.a[1]).toBe("");
      expect(sink.text).toBe(`${fmt(lv)}\n${fmt(ok)}`);
    }
  });

  test("UI-47（2026-10-06）前の再生で残った文では待たない（この再生で語った文の後だけ待つ）。メッセージ窓（迷宮）では待たない", async () => {
    const { deps, log, sink, talk } = townTalk(true);
    void talk.say("前の文", true);
    const player = createPlayer(deps);
    await player.play([{ kind: "levelUp", id: "c1", level: 2, hpGain: 3, mpGain: 0, hpMax: 13, mpMax: 0, hp: 13, mp: 0, statGains: [] }], stateWith(null), stateWith(null));
    expect(names(log)).toContain("sound:levelUp");
    expect(sink.text).toBe("前の文");
    const w = fakeDeps({ skipAnimations: true });
    w.deps.message = createNarrator({ town: () => false, talk, window: w.deps.message });
    await createPlayer(w.deps).play(
      [msg("town.inn.morale"), { kind: "levelUp", id: "c1", level: 2, hpGain: 3, mpGain: 0, hpMax: 13, mpMax: 0, hp: 13, mp: 0, statGains: [] }],
      stateWith(null),
      stateWith(null),
    );
    expect(names(w.log)).toContain("party.setMax");
  });

  /** UI-66（M10.5）: 実物の会話の箱に送りの音（advanced → page）の回数の記録を付けたもの */
  const pagedTalk = () => {
    const { deps, log } = fakeDeps({ skipAnimations: false });
    const sink = { open: false, text: "" };
    const pages = { n: 0 };
    const talk = createTalkModel({
      sink: { open: (on) => (sink.open = on), text: (t) => (sink.text = t), more: () => {} },
      advanced: () => pages.n++,
      cleared: () => deps.dice.hide(),
      log: () => {},
      speed: () => 0,
      blink: () => true,
      schedule: () => () => {},
      ...TALK_DIMS,
    });
    deps.message = createNarrator({ town: () => true, talk, window: deps.message });
    deps.beat = createTapLatch();
    return { deps, log, sink, talk, pages };
  };

  // M10.5: 文を溜めるので、蘇生の語りは 1 ページに並び、page は閉じるタップの 1 回（以前の期待値は page の回数 = 文の数）
  test("UI-66（M10.5）寺院の蘇生（実際の execute の出来事を Player で再生）: 語りは 1 ページに並び、再生はタップなしで終わる。page は閉じるタップの 1 回", async () => {
    const st = withChar(newGame(1), 1, { life: "dead", hp: 0 });
    st.gold = 100000;
    const id = st.party[1]!.id;
    const r = execute(st, { type: "town.temple", memberId: id, service: "resurrect" }, data);
    expect(r.events.some((e) => e.kind === "rejected")).toBe(false);
    const texts = r.events.filter((e) => e.kind === "message").map(fmt);
    expect(texts.length).toBeGreaterThanOrEqual(1);
    const { deps, sink, talk, pages } = pagedTalk();
    await createPlayer(deps).play(r.events, st, r.state);
    expect(sink.text).toBe(texts.join("\n"));
    expect(pages.n).toBe(0);
    talk.tap();
    expect(sink.open).toBe(false);
    expect(pages.n).toBe(1);
  });

  test("UI-66/UI-40/TW-17（2026-10-07 未定-17）闇魔術の強化（実際の execute の出来事を Player で再生）: 判定の箱を消す 1 回目のタップは文を送らないので無音、結果の文を閉じる 2 回目のタップで page が 1 回", async () => {
    const st = cloneState(newGame(1));
    st.gold = 1000;
    const r = execute(st, { type: "town.upgrade", memberId: "c1", slot: "weapon", catalysts: [] }, data);
    expect(r.events.map((e) => e.kind).slice(0, 2)).toEqual(["dice", "message"]);
    const { deps, log, sink, talk, pages } = pagedTalk();
    const player = createPlayer(deps);
    const p = player.play(r.events, st, r.state);
    await tick();
    const text = sink.text;
    expect(pages.n).toBe(0);
    player.tap();
    await p;
    // 判定の箱は消え、結果の文は残る（送っていない）ので鳴らない
    expect(names(log)).toContain("dice.hide");
    expect({ open: sink.open, text: sink.text, pages: pages.n }).toEqual({ open: true, text, pages: 0 });
    talk.tap();
    expect({ open: sink.open, pages: pages.n }).toEqual({ open: false, pages: 1 });
  });

  // M10.5: 文ごとのタップをやめ、箱が埋まったときだけタップで次のページ（以前の期待値は 1 文ずつタップで送り、page の回数 = 文の数）
  test("UI-47/CH-61（M10.5）宿屋のレベルアップの内訳（実際の execute の出来事を Player で再生）: 文は箱に溜まり、箱が埋まったときだけタップで次のページ。ジングルはその人の levelUp の文の直前（前のページの間には鳴らない）", async () => {
    // seed 1: ベルク（戦士）exp 50 → L2、ドナ（僧侶）exp 200 → L5（L4 の段は能力値が 1 つも上がらない）
    const st = withChar(withChar(newGame(1), 1, { exp: 50 }), 3, { exp: 200 });
    const r = execute(st, { type: "town.inn", rank: 0 }, data);
    expectKnownStringKeys(r.events);
    const lvs = r.events.flatMap((e) => (e.kind === "levelUp" ? [e] : []));
    expect(lvs.map((e) => [e.id, e.level, e.statGains.length])).toEqual([
      ["c2", 2, 2],
      ["c4", 2, 2],
      ["c4", 3, 1],
      ["c4", 4, 0],
      ["c4", 5, 2],
    ]);
    // 各 levelUp の直後の文の並び（習得の文の手前まで）
    const breakdown = (at: number): string[] => {
      const out: string[] = [];
      for (const e of r.events.slice(at + 1)) {
        if (e.kind !== "message" || !e.key.startsWith("town.inn.") || e.key.startsWith("town.inn.learn") || e.key === "town.inn.notLearned") break;
        out.push(e.key);
      }
      return out;
    };
    const lvAt = r.events.flatMap((e, i) => (e.kind === "levelUp" ? [i] : []));
    expect(lvAt.map(breakdown)).toEqual([
      ["town.inn.levelUp", "town.inn.hpUp", "town.inn.statUp.str", "town.inn.statUp.vit"],
      ["town.inn.levelUp", "town.inn.hpUp", "town.inn.mpUp", "town.inn.statUp.str", "town.inn.statUp.agi"],
      ["town.inn.levelUp", "town.inn.hpUp", "town.inn.mpUp", "town.inn.statUp.luk"],
      ["town.inn.levelUp", "town.inn.hpUp", "town.inn.mpUp"],
      ["town.inn.levelUp", "town.inn.hpUp", "town.inn.mpUp", "town.inn.statUp.vit", "town.inn.statUp.luk"],
    ]);
    const texts = r.events.filter((e) => e.kind === "message").map(fmt);
    const lvTexts = r.events.flatMap((e) => (e.kind === "message" && e.key === "town.inn.levelUp" ? [fmt(e)] : []));
    for (const skipAnimations of [false, true]) {
      const { deps, log, sink, talk } = townTalk(skipAnimations);
      /** ▼ で待つ間のタップ（箱を空にする）の回数 */
      const taps = { n: 0 };
      const player = createPlayer(deps);
      let done = false;
      const run = player.play(r.events, st, r.state).then(() => {
        done = true;
      });
      await tick();
      const pagesSeen: string[] = [];
      for (let i = 0; i < 40 && !done; i++) {
        // 再生が止まっているのは、箱が埋まって ▼ で待つときだけ
        expect(sink.more, `${skipAnimations} ${i}`).toEqual({ on: true, blink: !skipAnimations });
        pagesSeen.push(sink.text);
        player.tap();
        taps.n++;
        await tick();
      }
      await run;
      pagesSeen.push(sink.text);
      // ページをつなぐと全文。どのページも箱の行数以内
      expect(pagesSeen.join("\n").split("\n")).toEqual(texts);
      for (const pg of pagesSeen) expect(pg.split("\n").length).toBeLessThanOrEqual(T.talk.lines);
      expect(pagesSeen.length).toBeGreaterThan(1);
      expect(taps.n).toBe(pagesSeen.length - 1);
      // ページを替えるのは、次のページの最初の文が前のページに入らないときだけ
      const rowsOf = (pg: string): number => pg.split("\n").reduce((n, t) => n + talkRows(t, T.talk.cols), 0);
      for (let i = 0; i + 1 < pagesSeen.length; i++) {
        const head = pagesSeen[i + 1]!.split("\n")[0]!;
        expect(rowsOf(pagesSeen[i]!) + talkRows(head, T.talk.cols), `page ${i}`).toBeGreaterThan(T.talk.lines);
      }
      // 最初のページには、宿の文とベルクの内訳（レベル・HP・能力値 2 つ）が並ぶ
      const firstLv = lvAt[0]!;
      const berk = r.events.slice(firstLv + 1, firstLv + 1 + breakdown(firstLv).length).map(fmt);
      expect(berk).toHaveLength(4);
      for (const t of berk) expect(pagesSeen[0]!.split("\n")).toContain(t);
      // ジングルは levelUp の数だけ鳴り、鳴った時点の箱の中身は、その levelUp の文が足されるページの先頭部分（前のページの上では鳴らない）
      const jingles = log.filter((e) => e.m === "sound:levelUp");
      expect(jingles).toHaveLength(lvs.length);
      jingles.forEach((j, k) => {
        const snap = j.a[1] as string;
        const lvText = lvTexts[k]!;
        expect(snap.includes(lvText)).toBe(false);
        const page = pagesSeen.find((pg) => pg.includes(lvText))!;
        expect(page.startsWith(snap), `${k}: ${snap}`).toBe(true);
      });
      // 最後のページは残り、再生の外のタップで閉じる
      expect(sink.open).toBe(true);
      talk.tap();
      expect(sink.open).toBe(false);
    }
  });

  test("UI-47/CH-61（M10.5）宿屋のレベルアップ 1 人分（実際の execute。ベルク L2）は、宿の文と一緒に 1 ページに出て、再生はタップなしで終わる", async () => {
    const st = withChar(newGame(1), 1, { exp: 50 });
    const r = execute(st, { type: "town.inn", rank: 0 }, data);
    const texts = r.events.filter((e) => e.kind === "message").map(fmt);
    expect(texts.some((t) => t === formatMessage(data.strings["town.inn.levelUp"]!, { name: st.party[1]!.name, level: 2 }))).toBe(true);
    const { deps, sink, log } = townTalk(true);
    await createPlayer(deps).play(r.events, st, r.state);
    expect(sink.text).toBe(texts.join("\n"));
    expect(names(log)).toContain("sound:levelUp");
  });

  test("UI-47/CH-61（M10）内訳の文は大きな値（6 字の名前・Lv 99・増分 99・最大 9999・能力値 17 → 18）でも会話の箱の 1 行（224px = 全角 28 字）に収まる", () => {
    const one = (key: string, params: Record<string, string | number>): number => textUnits(formatMessage(data.strings[key]!, params));
    expect(one("town.inn.levelUp", { name: "アアアアアア", level: 99 })).toBeLessThanOrEqual(56);
    expect(one("town.inn.hpUp", { gain: 99, max: 9999 })).toBeLessThanOrEqual(56);
    expect(one("town.inn.mpUp", { gain: 99, max: 9999 })).toBeLessThanOrEqual(56);
    for (const k of STAT_KEYS) expect(one(`town.inn.statUp.${k}`, { from: 17, to: 18 }), k).toBeLessThanOrEqual(56);
  });
});
