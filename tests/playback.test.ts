import { afterEach, describe, expect, test, vi } from "vitest";
import { beatWait, createPlayer, createTapLatch, townCarry, type PlayerDeps } from "../src/presenter/playback";
import { createNarrator, createTalkModel } from "../src/presenter/views/talk";
import { regions, townLayout } from "../src/presenter/layout";
import { returnToTown } from "../src/core/rules/town";
import { formatDiceInline, formatDiceSummary, type DiceEvent } from "../src/presenter/views/dice";
import { formatMessage } from "../src/presenter/views/message";
import { textUnits } from "../src/presenter/views/party-band";
import { STAT_KEYS } from "../src/core/data/index";
import type { PenaltyTableText } from "../src/presenter/views/penalty-table";
import type { Settings } from "../src/presenter/settings";
import type { Dive, EndingRecord, EnemyGroupView, GameEvent, GameState, PenaltyResult, ViewPoint } from "../src/core/types";
import { data, expectKnownStringKeys, loadFreshData, newGame, withChar } from "./helpers/core";
import { cloneState, createItemInstance, makeContext } from "../src/core/state";
import { startBattle } from "../src/core/rules/combat";
import { execute } from "../src/core/engine";
import { ALWAYS_HIT, allInputs, dataWith, dived, withBattle } from "./helpers/battle";
import { atEvent, dataEvents } from "./helpers/events";
import { INITIAL_SOUND_CONTEXT, nextSoundContext, soundsFor, startSoundPlayback, type SoundContext } from "../src/presenter/sound-cues";

/** UI-47（M10.5）: 街の会話の箱の矩形（行数と 1 行の単位） */
const T = townLayout(regions(data.config.ui.layout, data.config.stage.width), data.config.party.size);

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
    chest: null,
    disarmedChests: [],
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
    ending: { show: (r) => rec("ending.show")(r) },
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

  // M10.5: 結果の文の後に残る ▼ は、閉じるタップを待つ最後の ▼（以前の期待値は「最後の文は ▼ なし」）。
  // M10.5 の修正（F3）: 以前の期待値は「再生が ▼ でタップを 1 回待って判定の箱を消し、さらに閉じるタップ」（見た目が同じ ▼ のタップが 2 回）。
  // 街（keepsDice）では列の終わりの待ちを会話の箱の最後の ▼ に任せ、閉じるタップ 1 回で箱と判定の箱を消す
  test("UI-47/UI-40/TW-17/CH-77 街の強化・鑑定の箱: 会話の箱（実物のモデル）に結果を出したら再生は終わり、最後の ▼ の 1 回のタップで会話の箱を閉じて判定の箱を消す（演出スキップでも ▼ のタップ待ちは残り、▼ は点滅しない）", async () => {
    const st = cloneState(newGame(1));
    st.gold = 1000;
    const c5 = st.party.find((c) => c.id === "c5")!;
    c5.classId = "bishop";
    c5.maxLevelReached = { bishop: 1 };
    const id = createItemInstance(st, { itemId: "dagger", identified: false });
    st.party.find((c) => c.id === "c1")!.inventory.push(id);
    const cases = [
      execute(st, { type: "town.upgrade", memberId: "c1", slot: "weapon", catalysts: [] }, data),
      execute(st, { type: "party.identify", memberId: "c5", instanceId: id }, data),
    ];
    for (const [i, r] of cases.entries()) {
      const m = r.events[r.events.length - 1]!;
      if (m.kind !== "message") throw new Error("message expected");
      for (const skipAnimations of [false, true]) {
        const tag = `${i}:${String(skipAnimations)}`;
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
          // dungeon.ts の結線と同じ（中身のある箱を閉じたら判定の箱を消す）
          cleared: () => deps.dice.hide(),
        });
        deps.message = createNarrator({ town: () => true, talk, window: deps.message });
        const latch = createTapLatch();
        deps.beat = latch;
        const player = createPlayer(deps);
        const p = player.play(r.events, st, r.state);
        let done = false;
        void p.then(() => {
          done = true;
        });
        await new Promise<void>((res) => setTimeout(res, 0));
        // 再生はタップを待たずに終わる
        expect(done, tag).toBe(true);
        // 結果の文と最後の ▼。判定の箱は残っている
        expect(sink.text, tag).toBe(formatMessage(data.strings[m.key]!, m.params));
        expect({ open: sink.open, more: sink.more }, tag).toEqual({ open: true, more: { on: true, blink: !skipAnimations } });
        expect(names(log), tag).toContain("dice.show");
        expect(names(log), tag).not.toContain("dice.hide");
        expect(logs, tag).toEqual([formatMessage(data.strings[m.key]!, m.params)]);
        // 1 回のタップで会話の箱を閉じ、判定の箱も消える
        talk.tap();
        expect(sink.open, tag).toBe(false);
        expect(names(log).filter((x) => x === "dice.hide"), tag).toHaveLength(1);
      }
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
    });
    deps.message = createNarrator({ town: () => true, talk, window: deps.message });
    const player = createPlayer(deps);
    await player.play([{ kind: "message", key: "town.enter" }, { kind: "message", key: "town.inn.intro" }], stateWith(null), stateWith(null));
    expect(sink.text).toBe(`${data.strings["town.enter"]}\n${data.strings["town.inn.intro"]}`);
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

  test("UI-47/UI-66（M10.5）街の会話の箱: 文の後の出来事（spellLearned）の音は、その文の文字送りが終わった後（早く鳴らない）。タップは待たず、判定の箱は箱を閉じるまで残る", async () => {
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
      // タップなしで再生が終わり、2 文が並ぶ。
      // M10.5 追補 2（未定-23）: 演出スキップ ON では間に判定の箱の内訳の 2 行も溜まる（以前の期待値は ON でも 2 文だけ）
      const inl = skipAnimations ? formatDiceInline(events[1] as DiceEvent, data.strings) : [];
      expect(sink.text, String(skipAnimations)).toBe([fmt(roll), ...inl, fmt(learned)].join("\n"));
      const seq = names(log);
      expect(seq.indexOf("sound:spellLearned")).toBeGreaterThan(seq.indexOf("dice.show"));
      expect(seq).not.toContain("dice.hide");
    }
  });

  // M10.5 追補（未定-24。2026-10-07 ログ形式）: 以前の期待値は「箱が埋まると ▼ でタップを待ち、空にした箱の上で learn が鳴る」。
  // 箱を空にしなくなったので、埋まっても待たずに溜め続け、learn は 掴もうとしている の文の文字送りの後に鳴る
  test("UI-47/UI-66（M10.5 追補）箱が埋まっても空にせず溜め続け、learn は 掴もうとしている の文の後・覚えた の文の前に鳴る。再生はタップなしで終わる（演出スキップでも同じ）", async () => {
    const p = { name: "アル", spell: "灯火" };
    const roll = msg("town.inn.learnRoll", p);
    const learned = msg("town.inn.learned", p);
    const filler = fill(T.talk.lines - 1);
    const events: GameEvent[] = [...filler, roll, rollDiceEv("dice.learn", [12], 12, "dice.learn.ok"), { kind: "spellLearned", id: "c1", spellId: "x", via: "roll" }, learned];
    for (const skipAnimations of [false, true]) {
      const { deps, log, sink, talk } = townTalk(skipAnimations);
      await createPlayer(deps).play(events, stateWith(null), stateWith(null));
      // M10.5 追補 2（未定-23）: 演出スキップ ON では判定の箱の内訳の 2 行も溜まる（以前の期待値は ON でも文だけ）
      const inl = skipAnimations ? formatDiceInline(events[filler.length + 1] as DiceEvent, data.strings) : [];
      const all = [...[...filler, roll].map(fmt), ...inl, fmt(learned)];
      // 22 行を超えても空にせず、全文が溜まっている（タップは 0 回）
      expect(sink.text.split("\n"), String(skipAnimations)).toEqual(all);
      expect(all.length).toBeGreaterThan(T.talk.lines);
      const at = log.find((e) => e.m === "sound:spellLearned")!;
      expect(at.a[1]).toBe(all.slice(0, -1).join("\n"));
      // 判定の箱は再生の終わりでも残り、閉じるタップで消える
      expect(names(log)).not.toContain("dice.hide");
      expect(sink.more).toEqual({ on: true, blink: !skipAnimations });
      talk.tap();
      expect(talk.isOpen()).toBe(false);
      expect(names(log)).toContain("dice.hide");
    }
  });

  test("UI-47/UI-66（M10.5）街の会話の箱: levelUp のジングルとパーティ欄の描き直し、message の音（resurrectOk）は、前の文の文字送りの後・その文が出る前（M10.5 追補: 箱が埋まっても待たない）", async () => {
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
      // M10.5 追補（ログ形式）: 箱が埋まった後も待たず、ジングルは溜めた文の後・レベルアップの文の前（以前の期待値は「空にするタップの後」）
      const { deps, log, sink } = townTalk(false);
      const filler = fill(T.talk.lines);
      await createPlayer(deps).play([...filler, lvEv, lv, ok], stateWith(null), stateWith(null));
      expect(log.find((e) => e.m === "sound:levelUp")!.a[1]).toBe(filler.map(fmt).join("\n"));
      expect(sink.text).toBe([...filler, lv, ok].map(fmt).join("\n"));
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
    });
    deps.message = createNarrator({ town: () => true, talk, window: deps.message });
    deps.beat = createTapLatch();
    return { deps, log, sink, talk, pages };
  };

  // M10.5: 文を溜めるので、蘇生の語りは 1 ページに並び、page は閉じるタップの 1 回（以前の期待値は page の回数 = 文の数）
  test("UI-66（M10.5）寺院の蘇生（実際の execute の出来事を Player で再生）: 語りは箱に並び、再生はタップなしで終わる。page は閉じるタップの 1 回", async () => {
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

  // M10.5 の修正（F3）: 以前の期待値は「判定の箱を消す 1 回目のタップ（無音）と、結果の文を閉じる 2 回目のタップ（page）」。
  // 街では列の終わりの判定の箱の待ちを会話の箱の最後の ▼ に任せたので、閉じるタップ 1 回（page 1 回）で判定の箱も消える
  test("UI-66/UI-40/TW-17（2026-10-07 未定-17。M10.5）闇魔術の強化（実際の execute の出来事を Player で再生）: 再生はタップなしで終わり、結果の文を閉じる 1 回のタップで page が 1 回鳴って判定の箱も消える", async () => {
    const st = cloneState(newGame(1));
    st.gold = 1000;
    const r = execute(st, { type: "town.upgrade", memberId: "c1", slot: "weapon", catalysts: [] }, data);
    expect(r.events.map((e) => e.kind).slice(0, 2)).toEqual(["dice", "message"]);
    const { deps, log, sink, talk, pages } = pagedTalk();
    await createPlayer(deps).play(r.events, st, r.state);
    const text = sink.text;
    // 判定の箱は残り、結果の文が出ている（送っていない）ので鳴らない
    expect(names(log)).not.toContain("dice.hide");
    expect({ open: sink.open, pages: pages.n }).toEqual({ open: true, pages: 0 });
    expect(text).not.toBe("");
    talk.tap();
    expect({ open: sink.open, pages: pages.n }).toEqual({ open: false, pages: 1 });
    expect(names(log).filter((x) => x === "dice.hide")).toHaveLength(1);
  });

  // M10.5: 文ごとのタップをやめ、箱が埋まったときだけタップで次のページ（以前の期待値は 1 文ずつタップで送り、page の回数 = 文の数）。
  // M10.5 追補（未定-24。ログ形式）: 箱が埋まっても空にしないので、ページの区切りのタップも無くなった（以前の期待値は「埋まったら ▼ でタップ、次のページ」）。
  // M10.5 追補 2（2026-10-07 ユーザーの指示「レベルアップはキャラクターごとに内容をクリア」）: core がメンバーごとに section を出すので、
  // 区切りごとに ▼ のタップを 1 回待って箱を空にする（以前の期待値は「全文が 1 つの箱に溜まり、再生はタップなしで終わる」）
  test("UI-47/CH-61/TW-04（M10.5 追補 2）宿屋のレベルアップの内訳（実際の execute の出来事を Player で再生）: 区切り（section）ごとに ▼ のタップを待って箱を空にし、その人の文だけが箱に並ぶ。ジングルはその人の levelUp の文の直前（前の文の文字送りの後）", async () => {
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
    // 区切り（section）で分けた文の塊。0 番は宿の語り、1 番からはメンバーごと。
    // M10.5 追補 2（未定-23）: 演出スキップ ON では習得判定（dice.learn）の内訳の 2 行も塊に入る（以前の期待値は ON でも文だけ）
    const segmentsOf = (inline: boolean): string[][] => {
      const out: string[][] = [[]];
      for (const e of r.events) {
        if (e.kind === "section") out.push([]);
        else if (e.kind === "message") out[out.length - 1]!.push(fmt(e));
        else if (e.kind === "dice" && inline) out[out.length - 1]!.push(...formatDiceInline(e, data.strings));
      }
      return out;
    };
    expect(segmentsOf(false)).toHaveLength(3); // 宿の語り・ベルク・ドナ
    expect(segmentsOf(false)[1]!.slice(0, 4)).toEqual(r.events.slice(lvAt[0]! + 1, lvAt[0]! + 5).map(fmt));
    expect(r.events.some((e) => e.kind === "dice" && e.label.key === "dice.learn")).toBe(true);
    const lvTexts = r.events.flatMap((e) => (e.kind === "message" && e.key === "town.inn.levelUp" ? [fmt(e)] : []));
    for (const skipAnimations of [false, true]) {
      const segments = segmentsOf(skipAnimations);
      const { deps, log, sink, talk } = townTalk(skipAnimations);
      // 区切りのタップ待ち（演出スキップでも待つ）の時点の箱の中身と ▼ を記録して、すぐ解く
      const waits: Array<{ text: string; more: { on: boolean; blink: boolean } }> = [];
      deps.beat = {
        waitTap() {
          waits.push({ text: sink.text, more: { ...sink.more } });
          return Promise.resolve();
        },
        release() {},
      };
      await createPlayer(deps).play(r.events, st, r.state);
      // 区切りごとに 1 回待ち、その時点の箱はその塊の文だけ（▼ は演出ありなら点滅）
      expect(waits).toEqual([
        { text: segments[0]!.join("\n"), more: { on: true, blink: !skipAnimations } },
        { text: segments[1]!.join("\n"), more: { on: true, blink: !skipAnimations } },
      ]);
      // 最後の塊（ドナ）だけが箱に残る
      expect(sink.text.split("\n")).toEqual(segments[2]);
      // ジングルは levelUp の数だけ鳴り、鳴った時点の箱の中身は、その塊のうち levelUp の文の直前までの文（前の文の文字送りの後・その文の前）
      const jingles = log.filter((e) => e.m === "sound:levelUp");
      expect(jingles).toHaveLength(lvs.length);
      let seg = 1;
      let from = 0;
      jingles.forEach((j, k) => {
        let idx = segments[seg]!.indexOf(lvTexts[k]!, from);
        if (idx < 0) {
          seg++;
          from = 0;
          idx = segments[seg]!.indexOf(lvTexts[k]!);
        }
        expect(idx, `${k}`).toBeGreaterThanOrEqual(0);
        expect(j.a[1], `${k}`).toBe(segments[seg]!.slice(0, idx).join("\n"));
        from = idx + 1;
      });
      // 最後の文の ▼ で残り、再生の外のタップで閉じる
      expect(sink.more).toEqual({ on: true, blink: !skipAnimations });
      expect(sink.open).toBe(true);
      talk.tap();
      expect(sink.open).toBe(false);
    }
  });

  // M10.5 追補 2: section の後はその人の文だけ（以前の期待値は「宿の文と一緒に箱に並び、再生はタップなしで終わる」）
  test("UI-47/CH-61/TW-04（M10.5 追補 2）宿屋のレベルアップ 1 人分（実際の execute。ベルク L2）は、宿の文を ▼ のタップ 1 回で空にした後に箱に並ぶ", async () => {
    const st = withChar(newGame(1), 1, { exp: 50 });
    const r = execute(st, { type: "town.inn", rank: 0 }, data);
    const at = r.events.findIndex((e) => e.kind === "section");
    expect(at).toBeGreaterThan(0);
    const before = r.events.slice(0, at).filter((e) => e.kind === "message").map(fmt);
    const after = r.events.slice(at).filter((e) => e.kind === "message").map(fmt);
    expect(after[0]).toBe(formatMessage(data.strings["town.inn.levelUp"]!, { name: st.party[1]!.name, level: 2 }));
    const { deps, sink, log } = townTalk(true);
    await createPlayer(deps).play(r.events, st, r.state);
    expect(names(log).filter((m) => m === "beat.waitTap")).toHaveLength(1);
    expect(before.length).toBeGreaterThan(0);
    expect(sink.text).toBe(after.join("\n"));
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

describe("UI-66（未定-21。2026-10-07）街の再生は文（message）ごとに 1 拍", () => {
  /** app と同じ結線（soundStart → startSoundPlayback、sound → soundsFor と nextSoundContext）で、鳴らした効果音の名前を集める */
  const wire = (deps: PlayerDeps): string[] => {
    let ctx: SoundContext = INITIAL_SOUND_CONTEXT;
    const heard: string[] = [];
    deps.soundStart = () => {
      ctx = startSoundPlayback(ctx);
    };
    deps.sound = (ev) => {
      for (const x of soundsFor(ev, data, ctx)) if (x.type === "sfx") heard.push(x.name);
      ctx = nextSoundContext(ev, data, ctx);
    };
    return heard;
  };
  const townDeps = (skipAnimations: boolean): PlayerDeps => {
    const { deps } = fakeDeps({ skipAnimations });
    const talk = createTalkModel({
      sink: { open: () => {}, text: () => {}, more: () => {} },
      log: () => {},
      speed: () => 0,
      blink: () => false,
      schedule: () => () => {},
      cleared: () => deps.dice.hide(),
    });
    deps.message = createNarrator({ town: () => true, talk, window: deps.message });
    return deps;
  };
  const learnOf = (id: string, name: string, spell: string): GameEvent[] => [
    msg("town.inn.learnRoll", { name, spell }),
    rollDiceEv("dice.learn", [12], 12, "dice.learn.ok"),
    { kind: "spellLearned", id, spellId: spell, via: "roll" },
    msg("town.inn.learned", { name, spell }),
  ];
  const ids = ["c1", "c2", "c3", "c4", "c5", "c6"];
  const sanAll = (): GameEvent[] => ids.map((id) => ({ kind: "sanChanged", id, delta: -2, san: 40 }));

  test("UI-66 宿屋で 2 人が覚えると learn は 2 回鳴る（1 回の再生でも、文ごとに拍が変わる）。救済の習得・転職の続けての習得も文ごとに鳴る", async () => {
    for (const skipAnimations of [false, true]) {
      const deps = townDeps(skipAnimations);
      const heard = wire(deps);
      const events: GameEvent[] = [
        ...learnOf("c1", "アル", "灯火"),
        ...learnOf("c2", "ドナ", "解毒"),
        msg("town.inn.guaranteed", { name: "エル" }),
        { kind: "spellLearned", id: "c3", spellId: "s1", via: "guarantee" },
        msg("town.inn.learned", { name: "エル", spell: "縛り言葉" }),
        { kind: "spellLearned", id: "c3", spellId: "s2", via: "classChange" },
        msg("town.inn.learned", { name: "エル", spell: "炎裂" }),
      ];
      await createPlayer(deps).play(events, stateWith(null), stateWith(null));
      expect(heard.filter((n) => n === "learn"), String(skipAnimations)).toHaveLength(4);
    }
  });

  test("UI-66 街でも、文を挟まない出来事の重なり（sanChanged × 6）は 1 回のまま", async () => {
    const deps = townDeps(true);
    const heard = wire(deps);
    await createPlayer(deps).play([msg("town.inn.morale"), ...sanAll(), msg("town.inn.morale")], stateWith(null), stateWith(null));
    expect(heard.filter((n) => n === "san")).toEqual(["san"]);
  });

  test("UI-66 遭遇（拍の中）の sanChanged × 6 は、間に段の文（san.uneasy）が挟まっても 1 回のまま。戦闘の拍の規則は変えない（拍をまたげばまた鳴る）", async () => {
    const { deps } = fakeDeps({ skipAnimations: true });
    const heard = wire(deps);
    const s = stateWith(diveAt(3, 3, "N"));
    const beat: GameEvent = { kind: "beat", phase: "system", auto: true };
    const evs = sanAll();
    const mixed: GameEvent[] = [evs[0]!, msg("san.uneasy", { name: "アル" }), ...evs.slice(1, 3), msg("san.uneasy", { name: "ベルク" }), ...evs.slice(3)];
    await createPlayer(deps).play([beat, msg("battle.unidentified"), ...mixed, beat, ...sanAll()], { ...s, screen: "battle" }, { ...s, screen: "battle" });
    expect(heard.filter((n) => n === "san")).toEqual(["san", "san"]);
  });

  test("UI-66 迷宮の拍の外（罠など）は今までどおり 1 回の再生が 1 拍（段の文が挟まっても san は 1 回）", async () => {
    const { deps } = fakeDeps({ skipAnimations: true });
    const heard = wire(deps);
    const s = stateWith(diveAt(3, 3, "N"));
    const evs = sanAll();
    await createPlayer(deps).play([msg("dungeon.trap.pit"), evs[0]!, msg("san.uneasy", { name: "アル" }), ...evs.slice(1)], s, s);
    expect(heard.filter((n) => n === "san")).toEqual(["san"]);
  });
});

describe("UI-45/UI-47（M10.5 追補 2）区切りで窓を空にする", () => {
  const fmt = (ev: GameEvent): string => (ev.kind === "message" ? formatMessage(data.strings[ev.key]!, ev.params) : "");
  const flushMicro = async (): Promise<void> => {
    for (let i = 0; i < 200; i++) await Promise.resolve();
  };

  /** 実物の会話の箱（文字送りなし）と、その全文の履歴（UI-46。say がログに入れる） */
  const townBox = (skipAnimations: boolean) => {
    const { deps, log } = fakeDeps({ skipAnimations });
    delete deps.beat; // 既定の掛け金（Player.tap() が解く）
    const sink = { open: false, text: "", more: { on: false, blink: false } };
    const history: string[] = [];
    const pages = { n: 0 };
    const talk = createTalkModel({
      sink: { open: (on) => (sink.open = on), text: (t) => (sink.text = t), more: (on, blink) => (sink.more = { on, blink }) },
      advanced: () => pages.n++,
      cleared: () => deps.dice.hide(),
      log: (t) => history.push(t),
      speed: () => 0,
      blink: () => !skipAnimations,
      schedule: () => () => {},
    });
    deps.message = createNarrator({ town: () => true, talk, window: deps.message });
    return { deps, log, sink, talk, history, pages };
  };

  for (const skipAnimations of [false, true]) {
    test(`UI-47/TW-04 section: 会話の箱に文が出ていれば ▼ を出して Player.tap() まで待ち（演出スキップ ${skipAnimations ? "ON でも" : "OFF"}）、箱を空にして続ける。空にした文は履歴に残り、判定の箱も消える`, async () => {
      const { deps, log, sink, history, pages } = townBox(skipAnimations);
      const p1 = { name: "アル", spell: "灯火" };
      const events: GameEvent[] = [
        msg("town.inn.morale"),
        msg("town.inn.learnRoll", p1),
        rollDiceEv("dice.learn", [12], 12, "dice.learn.ok"),
        msg("town.inn.learned", p1),
        { kind: "section" },
        { kind: "levelUp", id: "c2", level: 2, hpGain: 3, mpGain: 0, hpMax: 13, mpMax: 0, hp: 13, mp: 0, statGains: [] },
        msg("town.inn.levelUp", { name: "ベルク", level: 2 }),
      ];
      const texts = events.map(fmt).filter((t) => t !== "");
      // M10.5 追補 2（未定-23）: 演出スキップ ON では判定の箱の内訳の 2 行も箱に溜まる（履歴には入れない）。以前の期待値は ON でも文だけ
      const inl = skipAnimations ? formatDiceInline(events[2] as DiceEvent, data.strings) : [];
      const player = createPlayer(deps);
      let done = false;
      const p = player.play(events, stateWith(null), stateWith(null)).then(() => {
        done = true;
      });
      await flushMicro();
      // 区切りで止まり、前の文はそのまま・▼（演出ありなら点滅）・判定の箱も出たまま。次の出来事（levelUp）はまだ
      expect(done).toBe(false);
      expect(sink.text).toBe([...texts.slice(0, 2), ...inl, texts[2]].join("\n"));
      expect(sink.more).toEqual({ on: true, blink: !skipAnimations });
      expect(names(log)).not.toContain("dice.hide");
      expect(names(log)).not.toContain("party.setMax");
      player.tap();
      await p;
      // 空にしてから続け、箱には区切りの後の文だけ。判定の箱は空にしたときに消え（1 回）、送りの音は 1 回
      expect(sink.text).toBe(texts[3]);
      expect(names(log).filter((m) => m === "dice.hide")).toHaveLength(1);
      expect(pages.n).toBe(1);
      // 空にした文も含めて、すべて履歴に入っている
      expect(history).toEqual(texts);
    });
  }

  test("UI-47 section: 会話の箱に何も出ていなければ（列の先頭など）待たずに続ける。メッセージ窓（迷宮）でも待たない", async () => {
    const t = townBox(false);
    await createPlayer(t.deps).play([{ kind: "section" }, msg("town.inn.morale")], stateWith(null), stateWith(null));
    expect(t.sink.text).toBe(data.strings["town.inn.morale"]);
    const { deps, log } = fakeDeps();
    delete deps.beat;
    const s = stateWith(diveAt(3, 3, "N"));
    await createPlayer(deps).play([msg("dungeon.door"), { kind: "section" }, msg("dungeon.door")], s, s);
    expect(log.filter((e) => e.m === "message.say")).toHaveLength(2);
  });

  /** 記録する deps に clearView を足したもの（メッセージ窓） */
  const windowDeps = () => {
    const f = fakeDeps({ skipAnimations: true });
    f.deps.message.clearView = () => f.log.push({ m: "message.clearView", a: [] });
    return f;
  };

  test("UI-45 遭遇（encounter）で探索中の行を空にする。戦闘中の拍（beat）ごとには空にしない", async () => {
    const { deps, log } = windowDeps();
    const s = stateWith(diveAt(3, 3, "N"));
    const beat = (auto: boolean): GameEvent => ({ kind: "beat", phase: "system", auto });
    const events: GameEvent[] = [
      msg("dungeon.door"),
      { kind: "screen", to: "battle" },
      beat(false),
      { kind: "encounter", groups: [] },
      msg("battle.encounter"),
      beat(false),
      msg("battle.unidentified"),
      beat(false),
      msg("battle.unidentified"),
    ];
    await createPlayer(deps).play(events, s, { ...s, screen: "battle" });
    const ms = names(log).filter((m) => m === "message.say" || m === "message.clearView" || m === "battle.setGroups");
    expect(ms).toEqual(["message.say", "message.clearView", "battle.setGroups", "message.say", "message.say", "message.say"]);
  });

  test("UI-45 戦闘を終えて探索に戻る screen{dungeon} で、結果の文を読ませた（leave の待ちの）後に戦闘の行を空にする。その後の文は空の窓に出る", async () => {
    const { deps, log } = windowDeps();
    const s = stateWith(diveAt(3, 3, "N"));
    const events: GameEvent[] = [
      { kind: "beat", phase: "system", auto: false },
      { kind: "battleEnd", result: "win" },
      msg("battle.win"),
      { kind: "screen", to: "dungeon" },
      msg("dungeon.door"),
    ];
    await createPlayer(deps).play(events, { ...s, screen: "battle" }, s);
    const ms = names(log).filter((m) => ["message.say", "message.clearView", "beat.waitTap", "screens.show"].includes(m));
    expect(ms).toEqual(["message.say", "beat.waitTap", "screens.show", "message.clearView", "message.say"]);
  });

  test("UI-45 迷宮に入る screen{dungeon} と階の移動（floorChanged）で空にする。イベントから戻る screen{dungeon} では空にしない（UI-55）", async () => {
    const { deps, log } = windowDeps();
    const s = stateWith(diveAt(3, 3, "N"));
    await createPlayer(deps).play([{ kind: "screen", to: "dungeon" }, msg("dungeon.door")], stateWith(null), s);
    expect(names(log).filter((m) => m === "message.clearView" || m === "message.say")).toEqual(["message.clearView", "message.say"]);
    log.length = 0;
    await createPlayer(deps).play([msg("dungeon.door"), { kind: "floorChanged", floor: 2, pos: { x: 1, y: 1 }, facing: "N" }, msg("dungeon.door")], s, s);
    expect(names(log).filter((m) => m === "message.clearView" || m === "message.say")).toEqual(["message.say", "message.clearView", "message.say"]);
    log.length = 0;
    await createPlayer(deps).play([{ kind: "screen", to: "event" }, msg("dungeon.door"), { kind: "screen", to: "dungeon" }], s, s);
    expect(names(log)).not.toContain("message.clearView");
  });

  test("UI-45/UI-47 実際の execute: 遭遇の列（startBattle）は encounter で 1 回だけ空にし、宿のレベルアップ（2 人）は section が 2 回", () => {
    const s = cloneState(dived(1));
    const ctx = makeContext(s, data);
    startBattle(ctx, { kind: "random", inRoom: false }, [{ monsterId: "giant_rat", count: 1 }]);
    const ks = ctx.events.map((e) => e.kind);
    expect(ks.filter((k) => k === "encounter")).toHaveLength(1);
    expect(ks.indexOf("encounter")).toBeGreaterThan(ks.indexOf("screen"));
    const st = withChar(withChar(newGame(1), 1, { exp: 50 }), 3, { exp: 200 });
    const r = execute(st, { type: "town.inn", rank: 0 }, data);
    expect(r.events.filter((e) => e.kind === "section")).toHaveLength(2);
  });
});

describe("UI-40/UI-47（M10.5 追補 2・未定-23）演出スキップ ON の街では、タップを待たない判定の箱の内訳を会話の箱の行として溜める", () => {
  const fmt = (ev: GameEvent): string => (ev.kind === "message" ? formatMessage(data.strings[ev.key]!, ev.params) : "");
  const p1 = { name: "アル", spell: "灯火" };
  const LEARN = rollDiceEv("dice.learn", [12], 12, "dice.learn.ok");
  const learnEvents: GameEvent[] = [msg("town.inn.learnRoll", p1), { ...LEARN, label: { key: "dice.learn", params: { spell: "灯火" } } } as GameEvent, msg("town.inn.learned", p1)];
  const learnDice = learnEvents[1] as DiceEvent;

  /** 実物の会話の箱（文字送りなし）。town で街かを切り替える */
  const box = (skipAnimations: boolean, town = true) => {
    const { deps, log } = fakeDeps({ skipAnimations });
    const window = deps.message;
    const sink = { open: false, text: "", more: { on: false, blink: false } };
    const history: string[] = [];
    const talk = createTalkModel({
      sink: { open: (on) => (sink.open = on), text: (t) => (sink.text = t), more: (on, blink) => (sink.more = { on, blink }) },
      cleared: () => deps.dice.hide(),
      log: (t) => history.push(t),
      speed: () => 0,
      blink: () => !skipAnimations,
      schedule: () => () => {},
    });
    deps.message = createNarrator({ town: () => town, talk, window });
    return { deps, log, sink, history, talk };
  };

  test("UI-40 formatDiceInline: 見出しと各行（dice.inline.head）、基準と結果（dice.inline.result）の 2 行。文言は strings の鍵", () => {
    expect(formatDiceInline(learnDice, data.strings)).toEqual(["習得判定 灯火：出目 12", "　成功率 50（出目が 50 以下で成功） → 習得"]);
    expect(formatDiceInline(INITIATIVE as DiceEvent, data.strings)).toEqual(["先手判定：味方 8+4=12 / 敵 9+2=11", "　差 1（5 以上で先手、-5 以下で不意打ち） → 互角"]);
    for (const k of ["dice.inline.head", "dice.inline.result"]) expect(data.strings[k]).toBeDefined();
  });

  test("UI-40/UI-47 習得判定の内訳の 2 行は、大きな値（6 字の呪文名・出目 100・成功率 100・習得できず）でも会話の箱の 1 行（224px = 全角 28 字）に収まる", () => {
    const ev: DiceEvent = { ...learnDice, label: { key: "dice.learn", params: { spell: "アアアアアア" } }, rows: [{ label: { key: "dice.row.roll" }, base: null, dice: [100], total: 100 }], rule: { key: "dice.rule.rate", params: { rate: 100 } }, result: { key: "dice.learn.ng" } };
    for (const line of formatDiceInline(ev, data.strings)) expect(textUnits(line), line).toBeLessThanOrEqual(56);
  });

  test("UI-40/UI-47 演出スキップ ON の街: 習得判定（dice.learn）の内訳の 2 行が、語りの文の間に会話の箱の行として溜まる。履歴は判定の要約 1 行だけ（行は二重に入れない）。判定の箱も出す", async () => {
    const { deps, log, sink, history } = box(true);
    await createPlayer(deps).play(learnEvents, stateWith(null), stateWith(null));
    const inline = formatDiceInline(learnDice, data.strings);
    expect(sink.text).toBe([fmt(learnEvents[0]!), ...inline, fmt(learnEvents[2]!)].join("\n"));
    // 語りの文だけが会話の箱から履歴に入り、判定は要約 1 行（message.log）
    expect(history).toEqual([fmt(learnEvents[0]!), fmt(learnEvents[2]!)]);
    expect(log.filter((e) => e.m === "message.log").map((e) => e.a[0])).toEqual([formatDiceSummary(learnDice, data.strings)]);
    expect(names(log)).toContain("dice.show");
  });

  test("UI-40/UI-47 演出スキップ OFF の街では内訳の行を溜めない（今までどおり）", async () => {
    const { deps, sink } = box(false);
    await createPlayer(deps).play(learnEvents, stateWith(null), stateWith(null));
    expect(sink.text).toBe([fmt(learnEvents[0]!), fmt(learnEvents[2]!)].join("\n"));
  });

  test("UI-40/UI-55 タップを待つ判定の箱（HOLD_DICE_KEYS: 強化・鑑定・制止）は、演出スキップ ON の街でも行を溜めない", async () => {
    for (const key of ["dice.upgrade", "dice.identify", "dice.restrain"]) {
      const { deps, sink } = box(true);
      const evs: GameEvent[] = [msg("town.inn.morale"), rollDiceEv(key, [12], 12, "dice.upgrade.ok"), msg("town.inn.morale")];
      await createPlayer(deps).play(evs, stateWith(null), stateWith(null));
      expect(sink.text, key).toBe([fmt(evs[0]!), fmt(evs[2]!)].join("\n"));
    }
  });

  test("UI-40/UI-45 迷宮・戦闘のメッセージ窓（街の外）では、演出スキップ ON でも行を溜めない", async () => {
    const { deps, log } = box(true, false);
    const s = stateWith(diveAt(3, 3, "N"));
    await createPlayer(deps).play(learnEvents, s, s);
    expect(log.filter((e) => e.m === "message.say").map((e) => e.a[0])).toEqual([fmt(learnEvents[0]!), fmt(learnEvents[2]!)]);
  });

  test("UI-66/UI-47 行を溜めても、音（soundStart・sound）と hold と判定の箱の時機は変わらない（行を溜めない結線と同じ列）", async () => {
    const run = async (withInline: boolean): Promise<string[]> => {
      const { deps, log } = box(true);
      if (!withInline) delete deps.message.aside;
      deps.soundStart = () => log.push({ m: "soundStart", a: [] });
      deps.sound = (ev) => log.push({ m: `sound:${ev.kind}`, a: [] });
      const hold = deps.message.hold!;
      deps.message.hold = () => {
        log.push({ m: "hold", a: [] });
        return hold();
      };
      await createPlayer(deps).play(learnEvents, stateWith(null), stateWith(null));
      return names(log).filter((m) => m === "soundStart" || m.startsWith("sound:") || m === "hold" || m.startsWith("dice."));
    };
    const a = await run(true);
    expect(a).toEqual(await run(false));
    expect(a).toEqual(["soundStart", "hold", "soundStart", "sound:message", "sound:dice", "dice.show", "hold", "soundStart", "sound:message"]);
  });
});

describe("UI-70 宝箱の再生（M11 作業 4b）", () => {
  const s = (): GameState => stateWith(diveAt(1, 1, "N"));
  /** 箱・語り・待ち・消す・画面の切り替えの順だけを見る */
  const span = (log: Log): string[] =>
    log
      .filter((e) => ["dice.show", "dice.hide", "beat.waitTap", "message.say"].includes(e.m))
      .map((e) => (e.m === "message.say" ? `say:${String(e.a[0])}` : e.m));
  const say = (key: string, params?: Record<string, string | number>): string => `say:${formatMessage(data.strings[key]!, params)}`;
  const shownAt = (log: Log): unknown[] => log.filter((e) => e.m === "view.showAt").map((e) => e.a[0]);

  test("UI-70/A2 screen{dungeon} に at があれば、その位置と向き（階は最終の dive）で視点を作り、続く moved（転移）で移る。at が無ければ今どおり最終の dive", async () => {
    const before: GameState = { ...stateWith(diveAt(1, 1, "N")), screen: "battle" };
    const after = stateWith(diveAt(5, 3, "N"));
    const at = { pos: { x: 1, y: 1 }, facing: "N" as const };
    const events: GameEvent[] = [
      { kind: "screen", to: "dungeon", dungeonId: "d01", at },
      { kind: "chestFound", source: "drop" },
      msg("chest.found.drop"),
      { kind: "chestImpulse", actorId: "c3" },
      msg("chest.impulse.actor", { actor: "キリ" }),
      msg("chest.impulse.open", { actor: "キリ" }),
      { kind: "chestTrap", trapId: "teleport", actorId: "c3" },
      msg("chest.trap.teleport"),
      { kind: "chestEnd", result: "lost" },
      { kind: "moved", pos: { x: 5, y: 3 }, facing: "N" },
    ];
    expectKnownStringKeys(events);
    const { deps, log } = fakeDeps({ skipAnimations: true });
    await createPlayer(deps).play(events, before, after);
    expect(shownAt(log)).toEqual([
      { floor: 1, pos: { x: 1, y: 1 }, facing: "N" },
      { floor: 1, pos: { x: 5, y: 3 }, facing: "N" },
    ]);
    // at が無い screen{dungeon} は最終の dive の位置
    const f2 = fakeDeps({ skipAnimations: true });
    await createPlayer(f2.deps).play([{ kind: "screen", to: "dungeon" }], before, after);
    expect(shownAt(f2.log)).toEqual([{ floor: 1, pos: { x: 5, y: 3 }, facing: "N" }]);
  });

  test("UI-70/A2/EV-16/DG-25 core の実際の列（勝利 → 衝動 → 転移）: 再生はまず戦った位置を描き、moved で転移先へ移る", async () => {
    const d = loadFreshData();
    for (const t of d.drops.tables) t.itemChance = 0;
    d.config.combat.hitMin = d.config.combat.hitMax = 100;
    d.config.combat.chestChance = 100;
    d.config.chest.noTrapChance = 0;
    d.config.events.floor = d.config.events.cap = 100;
    d.chestTraps = d.chestTraps.filter((t) => t.danger !== 1 && t.id !== "teleport").concat(d.chestTraps.filter((t) => t.id === "teleport").map((t) => ({ ...t, danger: 1 })));
    d.dungeons.find((y) => y.id === "d01")!.chestTrapDangerWeights = [1, 0];
    // 制止者（ベルク・フィン）を行動不能にし、麻痺した大ネズミ 1 匹をアルドが倒す勝利の直前
    const base = withChar(withChar(dived(1), 1, { status: ["paralysis"] }), 5, { status: ["paralysis"] });
    const s0 = withBattle(base, [{ monsterId: "giant_rat", hps: [1], status: [["paralysis"]] }], {
      origin: { kind: "random", inRoom: true },
      identified: ["giant_rat"],
      inputs: allInputs(base, { type: "defend" }, { c1: { type: "attack", group: 0 } }),
    });
    const r = execute(s0, { type: "battle.resolve" }, d);
    expect(r.events.map((e) => e.kind)).toContain("chestImpulse");
    const moved = r.events.find((e) => e.kind === "moved") as Extract<GameEvent, { kind: "moved" }>;
    expect(moved.pos).not.toEqual(s0.dive!.pos);
    const { deps, log } = fakeDeps({ skipAnimations: true });
    await createPlayer({ ...deps, data: d, strings: d.strings }).play(r.events, s0, r.state);
    const fl = s0.dive!.floor;
    expect(shownAt(log)).toEqual([
      { floor: fl, pos: s0.dive!.pos, facing: s0.dive!.facing },
      { floor: fl, pos: moved.pos, facing: moved.facing },
    ]);
    // 衝動の行動者（キリ c3）に印、再生の終わりで外す
    expect(log.filter((e) => e.m === "party.markActor").map((e) => e.a)).toEqual([
      ["c3", false],
      [null, false],
    ]);
  });

  test("UI-70/EV-16 chestImpulse は eventStarted と同じ印（迷宮の操作を下げ、行動者に markActor(id, 点滅は演出スキップでなければ)）。再生の終わり（sync の前）に外す。chestFound も迷宮の操作を下げる", async () => {
    for (const skipAnimations of [false, true]) {
      const { deps, log } = fakeDeps({ skipAnimations });
      const events: GameEvent[] = [
        { kind: "chestFound", source: "cell" },
        msg("chest.found.cell"),
        { kind: "chestImpulse", actorId: "c3" },
        msg("chest.impulse.actor", { actor: "キリ" }),
      ];
      await createPlayer(deps).play(events, s(), s());
      const ms = names(log);
      expect(ms.indexOf("eventStarted")).toBeGreaterThanOrEqual(0);
      expect(ms.indexOf("eventStarted")).toBeLessThan(ms.indexOf("message.say"));
      expect(log.filter((e) => e.m === "party.markActor").map((e) => e.a)).toEqual([
        ["c3", !skipAnimations],
        [null, false],
      ]);
      expect(ms.slice(-2)).toEqual(["party.markActor", "screens.sync"]);
    }
    // chestFound だけ（衝動なし）でも操作を下げ、印は付けない
    const f = fakeDeps();
    await createPlayer(f.deps).play([{ kind: "chestFound", source: "drop" }, msg("chest.found.drop"), msg("chest.prompt")], s(), s());
    expect(names(f.log)).toContain("eventStarted");
    expect(names(f.log)).not.toContain("party.markActor");
  });

  test("UI-70/UI-40 宝箱の判定の箱（調べる dice.chestInspect・解除 dice.chestDisarm・掛け合い dice.rivalry）は拍の外で、続く message を 1 件出した後でタップを待ってから消す（演出スキップでも）", async () => {
    for (const key of ["dice.chestInspect", "dice.chestDisarm", "dice.rivalry"]) {
      for (const skipAnimations of [false, true]) {
        const { deps, log } = fakeDeps({ skipAnimations });
        await createPlayer(deps).play([rollDiceEv(key, [42], 42, "dice.chestDisarm.ok"), msg("chest.disarm.ok"), msg("chest.prompt")], s(), s());
        expect(span(log), `${key} ${skipAnimations}`).toEqual(["dice.show", say("chest.disarm.ok"), "beat.waitTap", "dice.hide", say("chest.prompt")]);
      }
    }
  });

  test("UI-70 chestTrap・chestEnd は表示を変えない（語りは message、移動は moved で来る）", async () => {
    const { deps, log } = fakeDeps({ skipAnimations: true });
    await createPlayer(deps).play([{ kind: "chestTrap", trapId: "bomb", actorId: null }, { kind: "chestEnd", result: "opened" }], s(), s());
    expect(names(log).filter((m) => !["message.setMore", "screens.sync"].includes(m))).toEqual([]);
  });
});

describe("UI-70/UI-71 宝箱の判定の箱と衝動の流れの再生（M11 作業 8。core の実際の列）", () => {
  /** 判定の箱・語り・待ち・消す・画面の切り替え・視点・敵の群れの順 */
  const flow = (log: Log): string[] =>
    log
      .filter((e) => ["dice.show", "dice.hide", "beat.waitTap", "message.say", "screens.show", "battle.setGroups", "view.showAt"].includes(e.m))
      .map((e) =>
        e.m === "message.say" ? `say:${String(e.a[0])}` : e.m === "dice.show" ? `dice.show:${String(e.a[0])}` : e.m === "screens.show" ? `screens.show:${String(e.a[0])}` : e.m,
      );
  const sayOf = (d: typeof data, key: string, params?: Record<string, string | number>): string => `say:${formatMessage(d.strings[key]!, params)}`;
  /** 箱から箱の後の語り 1 件までの再生の期待（HOLD: 語り → タップ待ち → 消す） */
  const holdSpan = (d: typeof data, events: readonly GameEvent[], label: string): string[] => {
    const i = events.findIndex((e) => e.kind === "dice" && e.label.key === label);
    const next = events.slice(i + 1).find((e) => e.kind === "message") as Extract<GameEvent, { kind: "message" }>;
    return [`dice.show:${label}`, sayOf(d, next.key, next.params), "beat.waitTap", "dice.hide"];
  };
  /** 再生して、記録と、描いた判定の箱（label・行の数・hidden）を返す */
  const play = async (events: readonly GameEvent[], before: GameState, after: GameState, d: typeof data, skipAnimations = true) => {
    const { deps, log } = fakeDeps({ skipAnimations });
    const boxes: { label: string; rows: number; hidden: boolean }[] = [];
    const show = deps.dice.show;
    deps.dice.show = (ev, skip, stepMs) => {
      boxes.push({ label: ev.label.key, rows: ev.rows.length, hidden: ev.hidden === true });
      return show(ev, skip, stepMs);
    };
    await createPlayer({ ...deps, data: d, strings: d.strings }).play(events, before, after);
    return { log, boxes };
  };
  /** 麻痺した大ネズミ 1 匹をアルドが倒す勝利の直前 */
  const winning = (base: GameState): GameState =>
    withBattle(base, [{ monsterId: "giant_rat", hps: [1], status: [["paralysis"]] }], {
      origin: { kind: "random", inRoom: true },
      identified: ["giant_rat"],
      inputs: allInputs(base, { type: "defend" }, { c1: { type: "attack", group: 0 } }),
    });

  test("UI-71/CB-63（U-2）調べる: 伏せた箱（hidden。内訳と計だけで出目の行が無い）を出し、結果の文（GM が告げた名前）を箱の後に語ってからタップを待って消す。その後に chest.prompt（演出スキップでも待つ）", async () => {
    const d = loadFreshData();
    d.config.chest.inspect.min = d.config.chest.inspect.max = 100;
    const s0 = execute(dived(1), { type: "debug.chest", trapId: "bomb" }, d).state;
    const r = execute(s0, { type: "chest.inspect", memberId: "c3" }, d);
    expectKnownStringKeys(r.events, d);
    const ev = r.events.find((e) => e.kind === "dice") as DiceEvent;
    expect(ev.hidden).toBe(true);
    expect(ev.rows.every((x) => x.dice.length === 0)).toBe(true);
    for (const skipAnimations of [true, false]) {
      const { log, boxes } = await play(r.events, s0, r.state, d, skipAnimations);
      expect(flow(log)).toEqual([...holdSpan(d, r.events, "dice.chestInspect"), sayOf(d, "chest.prompt")]);
      expect(flow(log)[1]).toBe(sayOf(d, "chest.inspect.found", { trap: "爆弾" }));
      expect(boxes).toEqual([{ label: "dice.chestInspect", rows: ev.rows.length, hidden: true }]);
    }
  });

  test("UI-71/CB-64 解除: 全行の箱（内訳・危険度・上下限・出目）→ 結果の文 chest.disarm.ok → タップ → 消す → chest.prompt", async () => {
    const d = loadFreshData();
    d.config.chest.disarm.min = d.config.chest.disarm.max = 100;
    const s0 = execute(dived(1), { type: "debug.chest", trapId: "bomb" }, d).state;
    const r = execute(s0, { type: "chest.disarm", memberId: "c6", trapId: "bomb" }, d);
    expectKnownStringKeys(r.events, d);
    const ev = r.events.find((e) => e.kind === "dice") as DiceEvent;
    expect(ev.hidden).toBeUndefined();
    expect(ev.rows.at(-1)!.dice).toHaveLength(1);
    const { log, boxes } = await play(r.events, s0, r.state, d);
    expect(flow(log)).toEqual(["dice.show:dice.chestDisarm", sayOf(d, "chest.disarm.ok"), "beat.waitTap", "dice.hide", sayOf(d, "chest.prompt")]);
    expect(boxes).toEqual([{ label: "dice.chestDisarm", rows: ev.rows.length, hidden: false }]);
  });

  test("UI-71/EV-73 職業の掛け合い（勝利の後の箱）: start → 両者の行の箱（キリ・フィン）→ win を語ってタップ → 消す → chest.prompt。履歴の要約にも両者の内訳", async () => {
    const d = loadFreshData();
    for (const t of d.drops.tables) t.itemChance = 0;
    d.config.combat.hitMin = d.config.combat.hitMax = 100;
    d.config.combat.chestChance = 100;
    d.config.events.cap = 0;
    d.rivalries[0]!.chance = 100;
    const s0 = winning(dived(1));
    const r = execute(s0, { type: "battle.resolve" }, d);
    expectKnownStringKeys(r.events, d);
    const ev = r.events.find((e) => e.kind === "dice" && e.label.key === "dice.rivalry") as DiceEvent;
    expect(ev.rows.map((x) => x.label.params?.name)).toEqual(["キリ", "フィン"]);
    const { log, boxes } = await play(r.events, s0, r.state, d);
    const f = flow(log);
    const i = f.indexOf("dice.show:dice.rivalry");
    expect(f[i - 1]).toBe(sayOf(d, "rivalry.thief_chest.start", { a: "キリ", b: "フィン" }));
    expect(f.slice(i)).toEqual([...holdSpan(d, r.events, "dice.rivalry"), sayOf(d, "chest.prompt")]);
    expect(f[i + 1]).toBe(sayOf(d, "rivalry.thief_chest.win", { winner: "キリ", loser: "フィン" }));
    expect(boxes.find((b) => b.label === "dice.rivalry")).toEqual({ label: "dice.rivalry", rows: 2, hidden: false });
    const sum = formatDiceSummary(ev, d.strings);
    expect(sum).toContain("キリ（素早さ 15・運 15）");
    expect(sum).toContain("フィン（素早さ 14・運 11）");
  });

  test("UI-70/A2/EV-16/EV-25/CB-67 勝利 → 衝動 → 制止の箱（失敗）→ 開けて警報 → 同じ再生で 2 回目の戦闘: 戦った位置を描き、制止の箱は語りの後でタップを待ち、screen{battle} の後に警報の敵の群れ（encounter の値）を描く", async () => {
    const d = loadFreshData();
    for (const t of d.drops.tables) t.itemChance = 0;
    d.config.combat.hitMin = d.config.combat.hitMax = 100;
    d.config.combat.chestChance = 100;
    d.config.chest.noTrapChance = 0;
    d.config.events.floor = d.config.events.cap = 100;
    d.rivalries[0]!.chance = 0;
    d.chestTraps = d.chestTraps.filter((t) => t.danger !== 1 && t.id !== "alarm").concat(d.chestTraps.filter((t) => t.id === "alarm").map((t) => ({ ...t, danger: 1 })));
    d.dungeons.find((y) => y.id === "d01")!.chestTrapDangerWeights = [1, 0];
    // 制止者はフィンだけ（ベルクは麻痺）。フィンの知恵を 1 にして制止を必ず失敗させる
    const b0 = withChar(dived(1), 1, { status: ["paralysis"] });
    const s0 = winning(withChar(b0, 5, { stats: { ...b0.party[5]!.stats, iq: 1 } }));
    const r = execute(s0, { type: "battle.resolve" }, d);
    expectKnownStringKeys(r.events, d);
    const restrain = r.events.find((e) => e.kind === "dice" && e.label.key === "dice.restrain") as DiceEvent;
    expect(restrain.result.key).toBe("dice.restrain.ng");
    expect(r.state.battle!.origin).toEqual({ kind: "alarm", inRoom: true });
    const enc = r.events.filter((e): e is Extract<GameEvent, { kind: "encounter" }> => e.kind === "encounter");
    expect(enc).toHaveLength(1);
    const { log } = await play(r.events, s0, r.state, d);
    const f = flow(log);
    const tail = f.slice(f.indexOf("screens.show:dungeon"));
    const iBattle = tail.indexOf("screens.show:battle");
    expect(tail.slice(0, iBattle + 1)).toEqual([
      "screens.show:dungeon",
      "view.showAt",
      sayOf(d, "chest.found.drop"),
      sayOf(d, "chest.impulse.actor", { actor: "キリ" }),
      sayOf(d, "event.stop.roll", { stopper: "フィン" }),
      ...holdSpan(d, r.events, "dice.restrain"),
      sayOf(d, "chest.impulse.open", { actor: "キリ" }),
      sayOf(d, "chest.trap.alarm"),
      "screens.show:battle",
    ]);
    // 2 回目の戦闘: 迷宮は描き直さず、群れは encounter の値（警報の敵）
    expect(tail.slice(iBattle + 1)).not.toContain("view.showAt");
    expect(tail.slice(iBattle + 1)).toContain("battle.setGroups");
    expect(log.filter((e) => e.m === "view.showAt").map((e) => e.a[0])).toEqual([{ floor: s0.dive!.floor, pos: s0.dive!.pos, facing: s0.dive!.facing }]);
    expect(log.filter((e) => e.m === "battle.setGroups").at(-1)!.a[0]).toEqual(JSON.parse(JSON.stringify(enc[0]!.groups)));
    // 衝動の行動者（キリ）に印、再生の終わりで外す
    expect(log.filter((e) => e.m === "party.markActor").map((e) => e.a)).toEqual([
      ["c3", false],
      [null, false],
    ]);
  });
});

describe("UI-73 戦績の画面の再生（M12）", () => {
  const record: EndingRecord = {
    dives: 12,
    battles: 80,
    deaths: 5,
    ashes: 1,
    wipes: 2,
    turns: 4321,
    bestiary: { known: 15, total: 20 },
    uniques: { known: 3, total: 14 },
  };
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

  test("UI-73/TW-34 ending は record を預かるだけで、締めの語りと街の画面の後、再生の終わり（screens.sync の後）に ending.show を 1 回（record をそのまま）呼ぶ（演出スキップの真偽とも）", async () => {
    for (const skipAnimations of [false, true]) {
      vi.useFakeTimers();
      const { deps, log } = fakeDeps({ skipAnimations });
      const events: GameEvent[] = [
        { kind: "message", key: "town.enter" },
        { kind: "message", key: "ending.speech.1" },
        { kind: "message", key: "ending.speech.2" },
        { kind: "ending", record },
        { kind: "screen", to: "town" },
      ];
      const p = createPlayer(deps).play(events, stateWith(diveAt(1, 1, "N")), stateWith(null));
      await vi.runAllTimersAsync();
      await p;
      expect(log.filter((e) => e.m === "ending.show"), String(skipAnimations)).toEqual([{ m: "ending.show", a: [record] }]);
      const ms = names(log).filter((m) => ["message.say", "screens.show", "screens.sync", "ending.show"].includes(m));
      expect(ms, String(skipAnimations)).toEqual(["message.say", "message.say", "message.say", "screens.show", "screens.sync", "ending.show"]);
      vi.useRealTimers();
    }
  });

  test("UI-73 ending の無い再生では ending.show を呼ばない。次の再生に前の record を持ち越さない", async () => {
    vi.useFakeTimers();
    const { deps, log } = fakeDeps({ skipAnimations: true });
    const player = createPlayer(deps);
    const first = player.play([{ kind: "ending", record }, { kind: "screen", to: "town" }], stateWith(diveAt(1, 1, "N")), stateWith(null));
    await vi.runAllTimersAsync();
    await first;
    const second = player.play([{ kind: "message", key: "town.enter" }], stateWith(null), stateWith(null));
    await vi.runAllTimersAsync();
    await second;
    expect(names(log).filter((m) => m === "ending.show")).toEqual(["ending.show"]);
    vi.useRealTimers();
  });

  test("UI-73/UI-56 全滅で帰って結末を語る列: 内訳（wipe.show）が先に開き、戦績（ending.show）は再生の終わり（内訳を閉じた後に開くかは app が決める）", async () => {
    vi.useFakeTimers();
    const { deps, log } = fakeDeps({ skipAnimations: true });
    const events: GameEvent[] = [
      { kind: "wipe", penalty },
      { kind: "message", key: "town.enter" },
      { kind: "message", key: "ending.speech.1" },
      { kind: "ending", record },
      { kind: "screen", to: "town" },
    ];
    const p = createPlayer(deps).play(events, stateWith(diveAt(1, 1, "N")), stateWith(null));
    await vi.runAllTimersAsync();
    await p;
    expect(names(log).filter((m) => ["wipe.show", "screens.sync", "ending.show"].includes(m))).toEqual(["wipe.show", "screens.sync", "ending.show"]);
    vi.useRealTimers();
  });
});
