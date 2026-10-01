import { afterEach, describe, expect, test, vi } from "vitest";
import { createPlayer, type PlayerDeps } from "../src/presenter/playback";
import { formatMessage } from "../src/presenter/views/message";
import type { Settings } from "../src/presenter/settings";
import type { Dive, EnemyGroupView, GameEvent, GameState, ViewPoint } from "../src/core/types";
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
  const log: Log = [];
  const rec =
    (m: string) =>
    (...a: unknown[]): void => {
      log.push({ m, a: JSON.parse(JSON.stringify(a)) as unknown[] });
    };
  const s: Settings = { skipAnimations: false, textSpeed: 30, inputMode: "both", swipeThreshold: 28, holdRepeatMs: 250, ...settings };
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
    },
    party: {
      setHp: rec("party.setHp"),
      setSan: rec("party.setSan"),
      setLife: rec("party.setLife"),
      setMp: rec("party.setMp"),
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
        log.push({ m: "dice.show", a: [ev.label, skip, stepMs] });
        return Promise.resolve();
      },
      hide: rec("dice.hide"),
    },
    screens: { show: (to) => rec("screens.show")(to), sync: (st) => log.push({ m: "screens.sync", a: [st] }) },
  };
  return { deps, log };
}

const names = (log: Log): string[] => log.map((e) => e.m);

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
      { kind: "levelDown", id: "c1", level: 1, hpMax: 5, mpMax: 0 },
    ];
    await createPlayer(deps).play(events, s, s);
    expect(names(log)).toEqual(["message.setMore", "screens.sync"]);
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

  test("UI-43 rushAll の後は、同じ再生の残りの文を即時にし、次の再生では戻す", async () => {
    const { deps, log } = fakeDeps();
    const s = stateWith(diveAt(1, 1, "N"));
    const player = createPlayer(deps);
    let first = true;
    const say = deps.message.say;
    deps.message.say = (text, instant) => {
      if (first) {
        first = false;
        player.rushAll(); // 1 文目の送り中に 2 回目のタップ
      }
      return say(text, instant);
    };
    const events: GameEvent[] = [
      { kind: "message", key: "dungeon.door" },
      { kind: "moved", pos: { x: 1, y: 0 }, facing: "N" },
      { kind: "message", key: "battle.encounter" },
    ];
    await player.play(events, s, s);
    expect(log.filter((e) => e.m === "message.say").map((e) => e.a[1])).toEqual([false, true]);
    expect(log.filter((e) => e.m === "view.fade").map((e) => e.a[0])).toEqual([0]);
    log.length = 0;
    await player.play([{ kind: "message", key: "dungeon.door" }], s, s);
    expect(log.filter((e) => e.m === "message.say").map((e) => e.a[1])).toEqual([false]);
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
      { kind: "dice", label: "battle.fleeRoll", dice: [37], total: 37 },
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
      { m: "dice.show", a: ["battle.fleeRoll", false, ui.diceStepMs] },
      { m: "message.say", a: [data.strings["battle.fleeOk"], false] },
      { m: "dice.hide", a: [] },
      { m: "screens.show", a: ["dungeon"] },
      { m: "view.fade", a: [ui.viewFadeMs] },
      { m: "screens.sync", a: [JSON.parse(JSON.stringify(after))] },
    ]);
  });

  test("§3-9 skipAnimations なら flash / removeOne / shake / dice / fade の ms はすべて 0 で、タイマーを使わない", async () => {
    vi.useFakeTimers();
    const { deps, log } = fakeDeps({ skipAnimations: true });
    const s = battleState();
    const events: GameEvent[] = [
      { kind: "screen", to: "battle" },
      { kind: "encounter", groups },
      { kind: "dice", label: "battle.initiativeParty", dice: [4], total: 12 },
      { kind: "dice", label: "battle.initiativeEnemy", dice: [2], total: 11 },
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
      ["dice.show", 0],
      ["view.shake", 0],
      ["battle.flash", 0],
      ["battle.removeOne", 0],
      ["party.flash", 0],
    ]);
    // dice.show の skip は真
    expect(log.filter((e) => e.m === "dice.show").map((e) => e.a[1])).toEqual([true, true]);
  });

  test("UI-40 続けて来たダイスは消さずに積み、message の間も残し、次のイベント（と再生の終わり）で 1 回だけ消す", async () => {
    const { deps, log } = fakeDeps();
    const s = battleState();
    const events: GameEvent[] = [
      { kind: "dice", label: "battle.initiativeParty", dice: [4], total: 12 },
      { kind: "dice", label: "battle.initiativeEnemy", dice: [2], total: 11 },
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
