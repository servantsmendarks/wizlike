import { afterEach, describe, expect, test, vi } from "vitest";
import { createPlayer, type PlayerDeps } from "../src/presenter/playback";
import { formatMessage } from "../src/presenter/views/message";
import type { Settings } from "../src/presenter/settings";
import type { Dive, GameEvent, GameState, ViewPoint } from "../src/core/types";
import { data, newGame } from "./helpers/core";

function diveAt(x: number, y: number, facing: Dive["facing"], floor = 1): Dive {
  return {
    dungeonId: data.dungeons[0]!.id,
    diveSeed: 1,
    floor,
    deepestFloor: floor,
    pos: { x, y },
    facing,
    explored: {},
    openedDoors: [],
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
    },
    header: { showAt: (_state, at) => rec("header.showAt")(at) },
    message: {
      say(text, instant) {
        log.push({ m: "message.say", a: [text, instant] });
        return Promise.resolve();
      },
      setMore: rec("message.setMore"),
    },
    party: { setHp: rec("party.setHp"), setSan: rec("party.setSan"), setLife: rec("party.setLife") },
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
      { kind: "dice", label: "x", dice: [3, 4], total: 7 },
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
