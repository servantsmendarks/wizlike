// オートセーブ（SV-02）と保存できない帯の状態（SV-23）。src/presenter/autosave.ts は DOM を使わない。
// 保存先は tests/helpers/save.ts のメモリ実装。
import { describe, expect, test } from "vitest";
import { createInitialState, execute } from "../src/core/engine";
import type { Command, GameEvent, GameState } from "../src/core/types";
import { createAutosaver, createCommandExec, createSaveBannerState, type SaveStatus } from "../src/presenter/autosave";
import { createSaveService } from "../src/save/saves";
import type { GameRecord, GameStoreBackend, SaveService } from "../src/save/types";
import { data, defaultMembers, expectKnownStringKeys } from "./helpers/core";
import { createMemoryBackend, type MemoryBackend } from "./helpers/save";

const NEW_GAME: Command = { type: "game.new", party: { members: defaultMembers() } };
const ENTER: Command = { type: "dungeon.enter", dungeonId: "d01" };

function service(backend: GameStoreBackend | null): SaveService {
  let id = 0;
  let t = 1000;
  return createSaveService({
    backend,
    now: () => t++,
    newId: () => `g${++id}`,
    schemaVersion: data.config.save.schemaVersion,
    maxGames: data.config.save.maxGames,
  });
}

/** put を release() まで保留する保存先（中身は inner に書く） */
function gated(inner: MemoryBackend): { backend: GameStoreBackend; release(): void; pending(): number } {
  const queue: Array<() => void> = [];
  return {
    backend: {
      getAll: () => inner.getAll(),
      get: (id) => inner.get(id),
      delete: (id) => inner.delete(id),
      put: (r: GameRecord) =>
        new Promise<void>((resolve, reject) => {
          queue.push(() => {
            inner.put(r).then(resolve, reject);
          });
        }),
    },
    release() {
      const f = queue.shift();
      if (f === undefined) throw new Error("no pending put");
      f();
    },
    pending: () => queue.length,
  };
}

/** 保留中の Promise の連鎖を進める */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function recordOf(mem: MemoryBackend, id: string): GameRecord {
  return mem.dump().get(id) as GameRecord;
}

describe("オートセーブ（SV-02）", () => {
  test("SV-02 before と after が同じ参照（rejected など状態が変わらない）なら保存しない", async () => {
    const mem = createMemoryBackend();
    const saves = service(mem);
    const statuses: SaveStatus[] = [];
    const a = createAutosaver({ saves, onStatus: (s) => statuses.push(s) });
    const st = createInitialState(1, data);
    await a.afterCommand(NEW_GAME, st, st);
    await a.afterCommand(ENTER, st, st);
    expect(mem.putCount).toBe(0);
    expect(statuses).toEqual([]);
    expect(saves.current()).toBeNull();
  });

  test("SV-02/SV-13 game.new は begin（新しい gameId で turn 1）、それ以外は同じ gameId へ save（turn 2, 3）", async () => {
    const mem = createMemoryBackend();
    const saves = service(mem);
    const statuses: SaveStatus[] = [];
    const a = createAutosaver({ saves, onStatus: (s) => statuses.push(s) });
    const s0 = createInitialState(3, data);
    const r1 = execute(s0, NEW_GAME, data);
    await a.afterCommand(NEW_GAME, s0, r1.state);
    expect(saves.current()).toEqual({ gameId: "g1", turn: 1 });
    expect(recordOf(mem, "g1").state).toEqual(JSON.parse(JSON.stringify(r1.state)));
    const r2 = execute(r1.state, ENTER, data);
    await a.afterCommand(ENTER, r1.state, r2.state);
    const r3 = execute(r2.state, { type: "dungeon.turn", dir: "left" }, data);
    await a.afterCommand({ type: "dungeon.turn", dir: "left" }, r2.state, r3.state);
    expect(saves.current()).toEqual({ gameId: "g1", turn: 3 });
    expect([...mem.dump().keys()]).toEqual(["g1"]);
    expect(recordOf(mem, "g1").turn).toBe(3);
    expect(recordOf(mem, "g1").state.screen).toBe("dungeon");
    expect(statuses).toEqual(["ok", "ok", "ok"]);
    // もう一度 game.new なら別のゲーム（g2）を作る
    const r4 = execute(createInitialState(4, data), NEW_GAME, data);
    await a.afterCommand(NEW_GAME, createInitialState(4, data), r4.state);
    expect(saves.current()).toEqual({ gameId: "g2", turn: 1 });
    expect([...mem.dump().keys()]).toEqual(["g1", "g2"]);
  });

  test("SV-02 put が解決するまで afterCommand は解決しない", async () => {
    const mem = createMemoryBackend();
    const g = gated(mem);
    const saves = service(g.backend);
    const a = createAutosaver({ saves, onStatus: () => {} });
    const s0 = createInitialState(2, data);
    const r1 = execute(s0, NEW_GAME, data);
    let done = false;
    const p = a.afterCommand(NEW_GAME, s0, r1.state).then(() => {
      done = true;
    });
    await flush();
    expect(g.pending()).toBe(1);
    expect(done).toBe(false);
    expect(mem.putCount).toBe(0);
    g.release();
    await p;
    expect(done).toBe(true);
    expect(mem.putCount).toBe(1);
  });

  test("SV-02 createCommandExec: execute → state の差し替え → 保存の完了 → 再生 の順。rejected は保存も再生もしない", async () => {
    const mem = createMemoryBackend();
    const g = gated(mem);
    const saves = service(g.backend);
    let state: GameState = createInitialState(6, data);
    const log: string[] = [];
    const played: { events: readonly GameEvent[]; before: GameState; after: GameState }[] = [];
    const exec = createCommandExec({
      execute: (st, cmd) => execute(st, cmd, data),
      getState: () => state,
      setState: (st) => {
        log.push("setState");
        state = st;
      },
      autosaver: createAutosaver({ saves, onStatus: (s) => log.push(`status:${s}`) }),
      play: async (events, before, after) => {
        // 再生が始まった時点で、この state の保存は終わっている
        log.push(`play:turn${(saves.current() ?? { turn: -1 }).turn}:saved${mem.putCount}`);
        played.push({ events, before, after });
      },
      onRejected: (ev) => log.push(`rejected:${ev.reason}`),
    });
    const s0 = state;
    const p1 = exec(NEW_GAME);
    await flush();
    // 保存が終わるまで再生しない（state は差し替え済み）
    expect(log).toEqual(["setState"]);
    expect(state.screen).toBe("town");
    g.release();
    const r1 = await p1;
    expect(r1.rejected).toBe(false);
    expect(log).toEqual(["setState", "status:ok", "play:turn1:saved1"]);
    expect(played[0]!.before).toBe(s0);
    expect(played[0]!.after).toBe(state);
    expect(played[0]!.events).toBe(r1.events);
    expectKnownStringKeys(r1.events);
    expect(recordOf(mem, "g1").state).toEqual(JSON.parse(JSON.stringify(state)));

    // rejected（town で dungeon.turn → wrong screen 系）: state も保存も再生も変わらない
    const before = state;
    log.length = 0;
    const r2 = await exec({ type: "dungeon.turn", dir: "left" });
    expect(r2.rejected).toBe(true);
    expect(r2.events).toHaveLength(1);
    expect(log).toEqual([`rejected:${(r2.events[0] as Extract<GameEvent, { kind: "rejected" }>).reason}`]);
    expect(state).toBe(before);
    expect(g.pending()).toBe(0);
    expect(mem.putCount).toBe(1);

    // 次のコマンドは同じゲームに turn 2
    log.length = 0;
    const p3 = exec(ENTER);
    await flush();
    g.release();
    await p3;
    expect(log).toEqual(["setState", "status:ok", "play:turn2:saved2"]);
    expect(recordOf(mem, "g1").state.screen).toBe("dungeon");
  });

  test("UI-25/SV-02 createCommandExec の beforePlay は state を差し替えた直後（保存と再生の前）に events を受けて 1 回呼ぶ。rejected では呼ばない", async () => {
    const mem = createMemoryBackend();
    const saves = service(mem);
    let state: GameState = createInitialState(9, data);
    const log: string[] = [];
    const exec = createCommandExec({
      execute: (st, cmd) => execute(st, cmd, data),
      getState: () => state,
      setState: (st) => {
        log.push("setState");
        state = st;
      },
      autosaver: createAutosaver({ saves, onStatus: (s) => log.push(`status:${s}`) }),
      play: async () => {
        log.push("play");
      },
    });
    let seen: readonly GameEvent[] | null = null;
    const r1 = await exec(NEW_GAME, {
      beforePlay: (events) => {
        log.push(`beforePlay:${state.screen}`);
        seen = events;
      },
    });
    expect(log).toEqual(["setState", "beforePlay:town", "status:ok", "play"]);
    expect(seen).toBe(r1.events);
    log.length = 0;
    const r2 = await exec({ type: "dungeon.turn", dir: "left" }, { beforePlay: () => log.push("beforePlay") });
    expect(r2.rejected).toBe(true);
    expect(log).toEqual([]);
  });

  test("SV-02/SV-23 保存に失敗しても state は巻き戻さず再生する。onStatus は failed", async () => {
    const mem = createMemoryBackend({ fail: { put: true } });
    const saves = service(mem);
    let state: GameState = createInitialState(8, data);
    const log: string[] = [];
    const exec = createCommandExec({
      execute: (st, cmd) => execute(st, cmd, data),
      getState: () => state,
      setState: (st) => {
        state = st;
      },
      autosaver: createAutosaver({ saves, onStatus: (s) => log.push(s) }),
      play: async () => {
        log.push("play");
      },
    });
    await exec(NEW_GAME);
    expect(state.screen).toBe("town");
    expect(log).toEqual(["failed", "play"]);
    expect(mem.putCount).toBe(0);
  });
});

describe("保存できない帯（SV-23）", () => {
  test("SV-23 put の失敗 → 回復で onStatus は failed → ok。turn は回復後に前の成功 + 1", async () => {
    const mem = createMemoryBackend();
    const saves = service(mem);
    const statuses: SaveStatus[] = [];
    const a = createAutosaver({ saves, onStatus: (s) => statuses.push(s) });
    const s0 = createInitialState(9, data);
    const r1 = execute(s0, NEW_GAME, data);
    await a.afterCommand(NEW_GAME, s0, r1.state);
    mem.setFail({ put: true });
    const r2 = execute(r1.state, ENTER, data);
    await a.afterCommand(ENTER, r1.state, r2.state);
    const r3 = execute(r2.state, { type: "dungeon.turn", dir: "right" }, data);
    await a.afterCommand({ type: "dungeon.turn", dir: "right" }, r2.state, r3.state);
    mem.setFail({});
    const r4 = execute(r3.state, { type: "dungeon.turn", dir: "right" }, data);
    await a.afterCommand({ type: "dungeon.turn", dir: "right" }, r3.state, r4.state);
    expect(statuses).toEqual(["ok", "failed", "failed", "ok"]);
    expect(saves.current()).toEqual({ gameId: "g1", turn: 2 });
    expect(recordOf(mem, "g1").turn).toBe(2);
    expect(recordOf(mem, "g1").state).toEqual(JSON.parse(JSON.stringify(r4.state)));
  });

  test("SV-23 backend が null（IndexedDB を開けない）なら毎回 failed で例外を出さない", async () => {
    const saves = service(null);
    expect(saves.available).toBe(false);
    const statuses: SaveStatus[] = [];
    const a = createAutosaver({ saves, onStatus: (s) => statuses.push(s) });
    const s0 = createInitialState(1, data);
    const r1 = execute(s0, NEW_GAME, data);
    await a.afterCommand(NEW_GAME, s0, r1.state);
    const r2 = execute(r1.state, ENTER, data);
    await a.afterCommand(ENTER, r1.state, r2.state);
    expect(statuses).toEqual(["failed", "failed"]);
  });

  test("SV-23 begin / save が reject しても failed にする（例外を外に出さない）", async () => {
    const statuses: SaveStatus[] = [];
    const a = createAutosaver({
      saves: { begin: () => Promise.reject(new Error("x")), save: () => Promise.reject(new Error("y")) },
      onStatus: (s) => statuses.push(s),
    });
    const s0 = createInitialState(1, data);
    const r1 = execute(s0, NEW_GAME, data);
    await expect(a.afterCommand(NEW_GAME, s0, r1.state)).resolves.toBeUndefined();
    await expect(a.afterCommand(ENTER, r1.state, execute(r1.state, ENTER, data).state)).resolves.toBeUndefined();
    expect(statuses).toEqual(["failed", "failed"]);
  });

  test("SV-23 帯: 使えるときは失敗している間だけ出し、save.failed は失敗に変わった最初の 1 回だけ", () => {
    const b = createSaveBannerState(true);
    expect(b.visible()).toBe(false);
    expect(b.update("ok")).toEqual({ visible: false, announce: false });
    expect(b.update("failed")).toEqual({ visible: true, announce: true });
    expect(b.update("failed")).toEqual({ visible: true, announce: false });
    expect(b.visible()).toBe(true);
    expect(b.update("ok")).toEqual({ visible: false, announce: false });
    // 回復の後にまた失敗したら、もう一度知らせる
    expect(b.update("failed")).toEqual({ visible: true, announce: true });
  });

  test("SV-23 帯: IndexedDB を開けなかったら起動からずっと出し、成功は来ないが save.failed は最初の失敗で 1 回だけ", () => {
    const b = createSaveBannerState(false);
    expect(b.visible()).toBe(true);
    expect(b.update("failed")).toEqual({ visible: true, announce: true });
    expect(b.update("failed")).toEqual({ visible: true, announce: false });
    // （来ないはずだが）ok でも帯は消えない
    expect(b.update("ok")).toEqual({ visible: true, announce: false });
  });

  test("SV-23 帯と全文の文言が strings にある", () => {
    expect(data.strings["save.failedBanner"]).toBeTypeOf("string");
    expect(data.strings["save.failed"]).toBeTypeOf("string");
  });
});
