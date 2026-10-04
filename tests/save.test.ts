// セーブ（src/save の純粋な部分）。保存先は tests/helpers/save.ts のメモリ実装。
import { describe, expect, test } from "vitest";
import { createInitialState, execute } from "../src/core/engine";
import { cloneState } from "../src/core/state";
import type { BattleAction, Command, GameState } from "../src/core/types";
import { DB_NAME, DB_VERSION, openIdbBackend, STORE_GAMES, STORE_SETTINGS } from "../src/save/db";
import { newGameId } from "../src/save/id";
import { isGameStateShape, migrateState, MIGRATIONS } from "../src/save/migrate";
import { buildRecord, checkStoredRecord, summarize } from "../src/save/record";
import { createSaveService } from "../src/save/saves";
import { buildExportFile, parseExportFile, serializeExportFile } from "../src/save/transfer";
import type { GameRecord, GameStoreBackend, ImportPlan, Migration, SaveDeps } from "../src/save/types";
import { dived, exec, withBattle } from "./helpers/battle";
import { data, expectKnownStringKeys, loadFreshData, newGame, withChar } from "./helpers/core";
import { atEvent } from "./helpers/events";
import { createMemoryBackend } from "./helpers/save";

const SCHEMA = data.config.save.schemaVersion;
const MAX = data.config.save.maxGames;
const DEF: BattleAction = { type: "defend" };

/** 呼ばれるたびに g1, g2, ... を返す newId と、1000 から 1 ずつ進む now */
function service(backend: GameStoreBackend | null, over: Partial<SaveDeps> = {}) {
  let id = 0;
  let t = 1000;
  return createSaveService({
    backend,
    now: () => t++,
    newId: () => `g${++id}`,
    schemaVersion: SCHEMA,
    maxGames: MAX,
    ...over,
  });
}

function record(gameId: string, updatedAt: number, over: Partial<GameRecord> = {}): GameRecord {
  return { ...buildRecord(gameId, 1, updatedAt, SCHEMA, newGame(1)), ...over };
}

function json<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

describe("SV-21 summarize / buildRecord / checkStoredRecord", () => {
  test("SV-21 summarize: leaderName は isLeader の者、clearedCount は clearedDungeons の数、aliveCount は life alive の人数", () => {
    const s0 = newGame(1);
    const leader = s0.party.find((c) => c.isLeader)!;
    expect(summarize(s0)).toEqual({ leaderName: leader.name, clearedCount: 0, aliveCount: 6 });

    let s = withChar(s0, 2, { life: "dead" });
    s = withChar(s, 4, { life: "ash" });
    s.progress.clearedDungeons = ["d01", "d02"];
    expect(summarize(s)).toEqual({ leaderName: leader.name, clearedCount: 2, aliveCount: 4 });

    // リーダーが居なければ ""（形の上の保険）
    const noLeader = cloneState(s0);
    for (const c of noLeader.party) c.isLeader = false;
    expect(summarize(noLeader).leaderName).toBe("");
  });

  test("SV-21 buildRecord: 欄の集合がちょうど SV-21 のもので、state は複製しない。JSON 往復で等しい", () => {
    const s = newGame(1);
    const r = buildRecord("g1", 3, 12345, SCHEMA, s);
    expect(Object.keys(r).sort()).toEqual(["gameId", "schemaVersion", "state", "summary", "turn", "updatedAt"]);
    expect(Object.keys(r.summary).sort()).toEqual(["aliveCount", "clearedCount", "leaderName"]);
    expect(r.state).toBe(s);
    expect(r).toMatchObject({ gameId: "g1", turn: 3, updatedAt: 12345, schemaVersion: SCHEMA });
    expect(json(r)).toStrictEqual(r);
  });

  test("SV-21 checkStoredRecord: 正しいレコードは通り、欄の型が違うものは null", () => {
    const good = json(buildRecord("g1", 2, 99.5, SCHEMA, newGame(1)));
    expect(checkStoredRecord(good)).toEqual(good);
    const bad: unknown[] = [
      null,
      "x",
      [good],
      { ...good, gameId: "" },
      { ...good, gameId: 1 },
      { ...good, schemaVersion: 0 },
      { ...good, schemaVersion: 1.5 },
      { ...good, schemaVersion: "1" },
      { ...good, turn: 0 },
      { ...good, turn: 2.5 },
      { ...good, updatedAt: Number.NaN },
      { ...good, updatedAt: "2026" },
      { ...good, summary: null },
      { ...good, summary: { ...good.summary, leaderName: 1 } },
      { ...good, summary: { ...good.summary, clearedCount: -1 } },
      { ...good, summary: { ...good.summary, aliveCount: "6" } },
      { ...good, state: null },
      { ...good, state: [] },
      { ...good, state: "{}" },
    ];
    for (const b of bad) expect(checkStoredRecord(b), JSON.stringify(b)?.slice(0, 80)).toBeNull();
  });
});

describe("SV-04 migrate", () => {
  test("SV-04 MIGRATIONS の長さは config.save.schemaVersion − 1", () => {
    expect(MIGRATIONS).toHaveLength(SCHEMA - 1);
  });

  test("SV-04 現在の版はそのまま通る（形の検査だけ）", () => {
    const s = json(newGame(1));
    const r = migrateState(s, SCHEMA, SCHEMA);
    expect(r).toEqual({ ok: true, state: s, fromVersion: SCHEMA });
  });

  test("SV-04 新しすぎる版は tooNew。版が 1 以上の整数でなければ broken", () => {
    const s = json(newGame(1));
    expect(migrateState(s, SCHEMA + 1, SCHEMA)).toEqual({ ok: false, reason: "tooNew" });
    for (const v of [0, -1, 1.5, "1", null, undefined, Number.NaN]) {
      expect(migrateState(s, v, SCHEMA), String(v)).toEqual({ ok: false, reason: "broken" });
    }
  });

  test("SV-04 差し替えた 2 段の移行を v1 から順に、v2 からは 2 段目だけ適用する。欠落と例外は broken", () => {
    // v1→v2: gold + 1、v2→v3: gold × 10。順番が逆なら値が変わる。
    const m1: Migration = (x) => ({ ...(x as GameState), gold: (x as GameState).gold + 1 });
    const m2: Migration = (x) => ({ ...(x as GameState), gold: (x as GameState).gold * 10 });
    const s = json(newGame(1));
    const g = s.gold;
    const from1 = migrateState(s, 1, 3, [m1, m2]);
    expect(from1.ok && from1.state.gold).toBe((g + 1) * 10);
    expect(from1.ok && from1.fromVersion).toBe(1);
    const from2 = migrateState(s, 2, 3, [m1, m2]);
    expect(from2.ok && from2.state.gold).toBe(g * 10);
    expect(s.gold).toBe(g); // 引数は書き換えない
    expect(migrateState(s, 1, 3, [m1])).toEqual({ ok: false, reason: "broken" });
    const boom: Migration = () => {
      throw new Error("boom");
    };
    expect(migrateState(s, 1, 3, [m1, boom])).toEqual({ ok: false, reason: "broken" });
    // 移行の結果が形の検査を通らなければ broken
    expect(migrateState(s, 2, 3, [m1, () => ({})])).toEqual({ ok: false, reason: "broken" });
  });

  test("SV-04 形の検査: town / dungeon / battle の正しい state は通り、screen・party・対応の崩れは broken", () => {
    const town = json(newGame(1));
    const dungeon = json(dived(1));
    const battle = json(withBattle(dived(1), [{ monsterId: "giant_rat", hps: [3] }]));
    for (const s of [town, dungeon, battle]) expect(isGameStateShape(s), s.screen).toBe(true);

    const broken: Array<[string, unknown]> = [
      ["not an object", "x"],
      ["array", [town]],
      ["screen title", { ...town, screen: "title", townVisit: null }],
      ["screen event", { ...dungeon, screen: "event" }],
      ["party empty", { ...town, party: [] }],
      ["party missing", { ...town, party: undefined }],
      ["rng null", { ...town, rng: null }],
      ["items array", { ...town, items: [] }],
      ["gold string", { ...town, gold: "0" }],
      ["dive missing", { ...town, dive: undefined }],
      ["pendingChoice number", { ...dungeon, pendingChoice: 1 }],
      ["battle with screen dungeon", { ...dungeon, battle: battle.battle }],
      ["screen battle without battle", { ...battle, battle: null }],
      ["town without townVisit", { ...town, townVisit: null }],
      ["dungeon with townVisit", { ...dungeon, townVisit: { mercyOffered: false } }],
      ["townVisit missing", { ...dungeon, townVisit: undefined }],
    ];
    for (const [name, s] of broken) {
      expect(isGameStateShape(s), name).toBe(false);
      expect(migrateState(s, SCHEMA, SCHEMA), name).toEqual({ ok: false, reason: "broken" });
    }
  });

  test("SV-04 形の検査: screen event（pendingChoice kind event・dive あり・battle null）は通り、pendingChoice が null・別の kind・screen dungeon で kind event なら broken", () => {
    const d = loadFreshData();
    d.config.events.impulseThreshold = 1000; // 衝動を起こさず選択を待たせる
    for (const def of d.dungeons) def.encounterRate = { room: 0, corridor: 0 };
    const ev = json(execute(atEvent("glowing_tablet").state, { type: "dungeon.move" }, d).state);
    expect(ev.screen).toBe("event");
    expect(isGameStateShape(ev)).toBe(true);
    expect(migrateState(ev, SCHEMA, SCHEMA)).toEqual({ ok: true, state: ev, fromVersion: SCHEMA });
    // 罠の察知の保留（kind trap）は screen dungeon のまま通る
    const dungeon = json(dived(1));
    const trapPc = { kind: "trap", promptKey: "dungeon.trap.prompt", options: [{ id: "retreat", labelKey: "dungeon.choice.retreat" }] };
    expect(isGameStateShape({ ...dungeon, pendingChoice: trapPc })).toBe(true);
    const battle = json(withBattle(dived(1), [{ monsterId: "giant_rat", hps: [3] }]));
    const broken: Array<[string, unknown]> = [
      ["screen event without pendingChoice", { ...ev, pendingChoice: null }],
      ["screen event with kind stairs", { ...ev, pendingChoice: { ...ev.pendingChoice!, kind: "stairs" } }],
      ["screen event with kind trap", { ...ev, pendingChoice: trapPc }],
      ["kind event with screen dungeon", { ...ev, screen: "dungeon" }],
      ["screen event without eventId", { ...ev, pendingChoice: { ...ev.pendingChoice!, eventId: undefined } }],
      ["screen event without dive", { ...ev, dive: null }],
      ["screen event with battle", { ...ev, battle: battle.battle }],
    ];
    for (const [name, s] of broken) {
      expect(isGameStateShape(s), name).toBe(false);
      expect(migrateState(s, SCHEMA, SCHEMA), name).toEqual({ ok: false, reason: "broken" });
    }
  });
});

describe("SV-04 v1 → v2 の移行（M5.5）", () => {
  /** v2 の state から M5.5 の欄（adventureTurns・tavernEventMark・dive.knownTraps）を消した v1 の形 */
  function toV1(s: GameState): Record<string, unknown> {
    const v1 = json(s) as unknown as Record<string, unknown>;
    delete v1["adventureTurns"];
    delete v1["tavernEventMark"];
    const dive = v1["dive"] as Record<string, unknown> | null;
    if (dive !== null) delete dive["knownTraps"];
    return v1;
  }
  function eventState(): GameState {
    const d = loadFreshData();
    d.config.events.impulseThreshold = 1000;
    for (const def of d.dungeons) def.encounterRate = { room: 0, corridor: 0 };
    return execute(atEvent("glowing_tablet").state, { type: "dungeon.move" }, d).state;
  }

  test("SV-04 v1 の保存（adventureTurns・tavernEventMark・knownTraps が無い）は v2 へ移行して 0 / 0 / {} が入り、街・迷宮・戦闘・イベント待ちのどれでも形の検査を通る。引数は書き換えない", () => {
    expect(SCHEMA).toBe(2);
    const cases: Array<[string, GameState]> = [
      ["town", newGame(1)],
      ["dungeon", dived(1)],
      ["battle", withBattle(dived(1), [{ monsterId: "giant_rat", hps: [3] }])],
      ["event", eventState()],
    ];
    for (const [name, s] of cases) {
      const v1 = toV1(s);
      const before = json(v1);
      expect(isGameStateShape(v1), name).toBe(false); // v1 のままでは v2 の形の検査を通らない
      const r = migrateState(v1, 1, SCHEMA);
      expect(r.ok, name).toBe(true);
      if (!r.ok) continue;
      expect(r.fromVersion).toBe(1);
      const want = json(s);
      want.adventureTurns = 0;
      want.tavernEventMark = 0;
      if (want.dive !== null) want.dive.knownTraps = {};
      expect(r.state, name).toEqual(want);
      expect(v1, name).toEqual(before); // 引数は書き換えない
    }
    // MIGRATIONS[0] 単体: オブジェクトでなければそのまま
    expect(MIGRATIONS[0]!("x")).toBe("x");
    expect(MIGRATIONS[0]!(null)).toBe(null);
  });

  test("SV-04 形の検査: adventureTurns / tavernEventMark が無い・負・小数・文字列、dive に knownTraps が無い・配列・null の v2 は broken", () => {
    const town = json(newGame(1));
    const dungeon = json(dived(1));
    const broken: Array<[string, unknown]> = [
      ["adventureTurns missing", { ...town, adventureTurns: undefined }],
      ["adventureTurns negative", { ...town, adventureTurns: -1 }],
      ["adventureTurns fraction", { ...town, adventureTurns: 1.5 }],
      ["adventureTurns string", { ...town, adventureTurns: "0" }],
      ["tavernEventMark missing", { ...town, tavernEventMark: undefined }],
      ["tavernEventMark negative", { ...town, tavernEventMark: -3 }],
      ["knownTraps missing", { ...dungeon, dive: { ...dungeon.dive!, knownTraps: undefined } }],
      ["knownTraps array", { ...dungeon, dive: { ...dungeon.dive!, knownTraps: [] } }],
      ["knownTraps null", { ...dungeon, dive: { ...dungeon.dive!, knownTraps: null } }],
    ];
    for (const [name, s] of broken) {
      expect(isGameStateShape(s), name).toBe(false);
      expect(migrateState(s, SCHEMA, SCHEMA), name).toEqual({ ok: false, reason: "broken" });
    }
    expect(isGameStateShape({ ...town, adventureTurns: 250, tavernEventMark: 200 })).toBe(true);
    expect(isGameStateShape({ ...dungeon, dive: { ...dungeon.dive!, knownTraps: { "1": [3, 7] } } })).toBe(true);
  });

  test("SV-04/SV-50 v1 のレコードを保存先（メモリ）に置くと、一覧で ok、続きからで読めて街から再開できる", async () => {
    const mem = createMemoryBackend();
    const s = newGame(1);
    mem.raw("g1", { ...buildRecord("g1", 4, 999, 1, s), state: toV1(s) });
    const svc = service(mem);
    const list = await svc.list();
    expect(list.ok && list.entries.map((e) => [e.gameId, e.status])).toEqual([["g1", "ok"]]);
    const r = await svc.load("g1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.screen).toBe("town");
    expect(r.state.adventureTurns).toBe(0);
    expect(r.state.tavernEventMark).toBe(0);
    // 迷宮の v1 でも同じ（knownTraps {}）
    const mem2 = createMemoryBackend();
    const dv = dived(1);
    mem2.raw("g2", { ...buildRecord("g2", 2, 999, 1, dv), state: toV1(dv) });
    const r2 = await service(mem2).load("g2");
    expect(r2.ok && r2.state.dive!.knownTraps).toEqual({});
  });
});

describe("SV-10 newGameId", () => {
  const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  test("SV-10 crypto.randomUUID があればそれを使う", () => {
    const c = { randomUUID: () => "11111111-2222-4333-8444-555555555555", getRandomValues: () => { throw new Error("unused"); } };
    expect(newGameId(c as unknown as Crypto)).toBe("11111111-2222-4333-8444-555555555555");
  });

  test("SV-10 randomUUID が無ければ getRandomValues の 16 バイトから v4 を組む（バイト 6 の上位 4 ビット = 4、バイト 8 の上位 2 ビット = 10）", () => {
    const fixed = (fill: (i: number) => number) => ({
      getRandomValues: <T extends ArrayBufferView>(a: T): T => {
        const u = a as unknown as Uint8Array;
        for (let i = 0; i < u.length; i++) u[i] = fill(i);
        return a;
      },
    });
    // 00..0f: b6 = (0x06 & 0x0f) | 0x40 = 0x46、b8 = (0x08 & 0x3f) | 0x80 = 0x88
    const a = newGameId(fixed((i) => i) as unknown as Crypto);
    expect(a).toBe("00010203-0405-4607-8809-0a0b0c0d0e0f");
    // ff: b6 = 0x4f、b8 = 0xbf
    const b = newGameId(fixed(() => 0xff) as unknown as Crypto);
    expect(b).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
    for (const s of [a, b]) expect(s).toMatch(V4);
  });

  test("SV-10 実環境の crypto でも v4 の形", () => {
    expect(newGameId(globalThis.crypto)).toMatch(V4);
  });
});

describe("SV-13/SV-21/SV-22 begin と save", () => {
  test("SV-21 SV-13 begin → save → save で turn 1, 2, 3。レコードは 1 件で gameId は変わらない。updatedAt は now()", async () => {
    const be = createMemoryBackend();
    const sv = service(be);
    expect(sv.current()).toBeNull();
    const s = newGame(1);
    expect(await sv.begin(s)).toEqual({ ok: true, turn: 1 });
    expect(sv.current()).toEqual({ gameId: "g1", turn: 1 });
    expect(await sv.save(s)).toEqual({ ok: true, turn: 2 });
    expect(await sv.save(s)).toEqual({ ok: true, turn: 3 });
    const dump = be.dump();
    expect([...dump.keys()]).toEqual(["g1"]);
    const rec = dump.get("g1") as GameRecord;
    expect(rec).toMatchObject({ gameId: "g1", turn: 3, updatedAt: 1002, schemaVersion: SCHEMA, summary: summarize(s) });
    expect(rec.state).toEqual(s);
    expect(sv.current()).toEqual({ gameId: "g1", turn: 3 });
  });

  test("SV-13 save は await せずに続けて呼んでも直列化され、turn が 1 ずつ進む", async () => {
    const be = createMemoryBackend();
    const sv = service(be);
    const s = newGame(1);
    const rs = await Promise.all([sv.begin(s), sv.save(s), sv.save(s), sv.save(s)]);
    expect(rs).toEqual([1, 2, 3, 4].map((turn) => ({ ok: true, turn })));
    expect((be.dump().get("g1") as GameRecord).turn).toBe(4);
  });

  test("SV-13 begin を 2 回呼ぶと別の gameId になり、前のゲームのレコードは残る", async () => {
    const be = createMemoryBackend();
    const sv = service(be);
    await sv.begin(newGame(1));
    await sv.begin(newGame(2));
    expect(sv.current()).toEqual({ gameId: "g2", turn: 1 });
    expect([...be.dump().keys()]).toEqual(["g1", "g2"]);
  });

  test("SV-22 上書きは丸ごと置き換え: 前の state にだけあった欄が残らない", async () => {
    const be = createMemoryBackend();
    const sv = service(be);
    const s1 = dived(1) as GameState & { extra?: number };
    s1.extra = 7;
    await sv.begin(s1);
    expect((be.dump().get("g1") as { state: { extra?: number } }).state.extra).toBe(7);
    const s2 = newGame(1);
    await sv.save(s2);
    const rec = be.dump().get("g1") as GameRecord;
    expect(rec.state).toStrictEqual(json(s2));
    expect("extra" in rec.state).toBe(false);
    expect(rec.summary).toEqual(summarize(s2));
  });

  test("SV-13 current が無い（begin も load もしていない）と save は失敗し、何も書かない", async () => {
    const be = createMemoryBackend();
    const sv = service(be);
    expect(await sv.save(newGame(1))).toEqual({ ok: false });
    expect(be.putCount).toBe(0);
  });
});

describe("SV-03 保存と読み込みで続きが同じになる", () => {
  async function roundTrip(s: GameState): Promise<GameState> {
    const be = createMemoryBackend();
    const writer = service(be);
    await writer.begin(s);
    const reader = service(be);
    const r = await reader.load("g1");
    if (!r.ok) throw new Error(`load failed: ${r.reason}`);
    expect(r).toMatchObject({ gameId: "g1", turn: 1 });
    expect(reader.current()).toEqual({ gameId: "g1", turn: 1 });
    return r.state;
  }

  function same(a: GameState, b: GameState, cmds: Command[]): void {
    let x = a;
    let y = b;
    for (const c of cmds) {
      const rx = execute(x, c, data);
      const ry = execute(y, c, data);
      expectKnownStringKeys(rx.events);
      expect(ry.events).toEqual(rx.events);
      expect(ry.state).toEqual(rx.state);
      x = rx.state;
      y = ry.state;
    }
  }

  test("SV-03 迷宮で数歩歩いた state を保存して読み込むと等しく、同じコマンドで同じ state と events になる", async () => {
    let s = dived(3);
    const walk: Command[] = [
      { type: "dungeon.move" },
      { type: "dungeon.turn", dir: "right" },
      { type: "dungeon.move" },
      { type: "dungeon.turn", dir: "left" },
    ];
    for (const c of walk) s = execute(s, c, data).state;
    const loaded = await roundTrip(s);
    expect(loaded).toEqual(s);
    expect(loaded.rng).toEqual(s.rng);
    same(s, loaded, [
      { type: "dungeon.move" },
      { type: "dungeon.move" },
      { type: "dungeon.turn", dir: "around" },
      { type: "dungeon.move" },
    ]);
  });

  test("SV-03 戦闘で一部だけ入力した state を保存して読み込むと等しく、残りの入力と解決が同じになる", async () => {
    let s = withBattle(dived(1), [{ monsterId: "giant_rat", hps: [3, 3] }]);
    s = exec(s, { type: "battle.input", memberId: "c1", action: { type: "attack", group: 0 } }).state;
    const loaded = await roundTrip(s);
    expect(loaded).toEqual(s);
    expect(loaded.battle?.inputs).toEqual({ c1: { type: "attack", group: 0 } });
    same(s, loaded, [
      ...["c2", "c3", "c4", "c5", "c6"].map((id): Command => ({ type: "battle.input", memberId: id, action: DEF })),
      { type: "battle.resolve" },
    ]);
  });
});

describe("SV-04 load", () => {
  test("SV-04 load: 無い id は missing、壊れたレコードは broken、新しすぎる版は tooNew。失敗では current を変えない", async () => {
    const be = createMemoryBackend();
    const sv = service(be);
    await sv.begin(newGame(1));
    be.raw("bad", { gameId: "bad", turn: "x" });
    await be.put(record("new", 5, { schemaVersion: SCHEMA + 1 }));
    await be.put(record("shape", 5, { state: { ...json(newGame(1)), screen: "title" } as unknown as GameState }));
    expect(await sv.load("none")).toEqual({ ok: false, reason: "missing" });
    expect(await sv.load("bad")).toEqual({ ok: false, reason: "broken" });
    expect(await sv.load("new")).toEqual({ ok: false, reason: "tooNew" });
    expect(await sv.load("shape")).toEqual({ ok: false, reason: "broken" });
    expect(sv.current()).toEqual({ gameId: "g1", turn: 1 });
  });

  test("SV-04 load の後の save は読み込んだレコードの turn + 1 で同じ gameId に書く", async () => {
    const be = createMemoryBackend();
    await be.put(record("old", 5, { turn: 41 }));
    const sv = service(be);
    const r = await sv.load("old");
    expect(r.ok && r.turn).toBe(41);
    expect(await sv.save(newGame(2))).toEqual({ ok: true, turn: 42 });
    expect([...be.dump().keys()]).toEqual(["old"]);
  });

  test("SV-04 古い版のレコードは移行して読み込み、書き戻さない", async () => {
    const be = createMemoryBackend();
    const s = newGame(1);
    await be.put({ ...buildRecord("v1", 7, 5, 1, s) });
    const putsBefore = be.putCount;
    const m1: Migration = (x) => ({ ...(x as GameState), gold: (x as GameState).gold + 100 });
    const sv = service(be, { schemaVersion: 2, migrations: [m1] });
    const r = await sv.load("v1");
    expect(r.ok && r.state.gold).toBe(s.gold + 100);
    expect(be.putCount).toBe(putsBefore);
    expect((be.dump().get("v1") as GameRecord).schemaVersion).toBe(1);
  });
});

describe("SV-11 SV-12 一覧と上限", () => {
  test("SV-12 list: updatedAt の降順（同値は gameId の昇順）。壊れた記録は broken、新しい版は tooNew、gameId が読めないものは除く", async () => {
    const be = createMemoryBackend();
    await be.put(record("b", 300));
    await be.put(record("a", 300));
    await be.put(record("c", 500));
    await be.put(record("d", 100, { schemaVersion: SCHEMA + 1 }));
    be.raw("e", { gameId: "e", schemaVersion: 1, turn: 0 });
    be.raw("x", { state: {} });
    be.raw("y", "garbage");
    const sv = service(be);
    const r = await sv.list();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entries.map((e) => [e.gameId, e.status])).toEqual([
      ["c", "ok"],
      ["a", "ok"],
      ["b", "ok"],
      ["d", "tooNew"],
      ["e", "broken"],
    ]);
    const leader = newGame(1).party.find((c) => c.isLeader)!.name;
    expect(r.entries[0]).toEqual({
      gameId: "c",
      turn: 1,
      updatedAt: 500,
      summary: { leaderName: leader, clearedCount: 0, aliveCount: 6 },
      status: "ok",
    });
    expect(r.entries[4]).toEqual({
      gameId: "e",
      turn: 0,
      updatedAt: 0,
      summary: { leaderName: "", clearedCount: 0, aliveCount: 0 },
      status: "broken",
    });
  });

  test("SV-12 list: backend null と getAll の失敗は {ok:false}", async () => {
    expect(await service(null).list()).toEqual({ ok: false });
    const be = createMemoryBackend({ fail: { getAll: true } });
    expect(await service(be).list()).toEqual({ ok: false });
  });

  test("SV-11 canCreate: maxGames − 1 件は ok、maxGames 件（broken / tooNew も数える）は full", async () => {
    expect(MAX).toBe(5);
    const be = createMemoryBackend();
    const sv = service(be);
    for (let i = 0; i < MAX - 1; i++) await be.put(record(`k${i}`, i));
    expect(await sv.canCreate()).toBe("ok");
    be.raw("k0", { gameId: "k0" }); // 壊す（件数は変わらない）
    await be.put(record("k1", 1, { schemaVersion: SCHEMA + 1 }));
    expect(await sv.canCreate()).toBe("ok");
    be.raw("broken", { gameId: "broken" });
    expect(await sv.canCreate()).toBe("full");
  });

  test("SV-11 canCreate: backend null と getAll の失敗は unavailable", async () => {
    expect(await service(null).canCreate()).toBe("unavailable");
    expect(await service(createMemoryBackend({ fail: { getAll: true } })).canCreate()).toBe("unavailable");
  });
});

describe("SV-14 remove", () => {
  test("SV-14 remove は指定した id だけを消す。今のゲームを消すと current は null", async () => {
    const be = createMemoryBackend();
    const sv = service(be);
    await sv.begin(newGame(1));
    await be.put(record("other", 1));
    expect(await sv.remove("other")).toBe(true);
    expect([...be.dump().keys()]).toEqual(["g1"]);
    expect(sv.current()).toEqual({ gameId: "g1", turn: 1 });
    expect(await sv.remove("g1")).toBe(true);
    expect([...be.dump().keys()]).toEqual([]);
    expect(sv.current()).toBeNull();
  });

  test("SV-14 delete の失敗は false で、current も消さない", async () => {
    const be = createMemoryBackend();
    const sv = service(be);
    await sv.begin(newGame(1));
    be.setFail({ delete: true });
    expect(await sv.remove("g1")).toBe(false);
    expect(sv.current()).toEqual({ gameId: "g1", turn: 1 });
    expect([...be.dump().keys()]).toEqual(["g1"]);
  });
});

describe("SV-23 保存できないとき", () => {
  test("SV-23 put の失敗は {ok:false} で turn を進めない。回復後は前の成功 + 1", async () => {
    const be = createMemoryBackend();
    const sv = service(be);
    const s = newGame(1);
    await sv.begin(s);
    await sv.save(s);
    be.setFail({ put: true });
    expect(await sv.save(s)).toEqual({ ok: false });
    expect(await sv.save(s)).toEqual({ ok: false });
    expect(sv.current()).toEqual({ gameId: "g1", turn: 2 });
    be.setFail({});
    expect(await sv.save(s)).toEqual({ ok: true, turn: 3 });
    expect((be.dump().get("g1") as GameRecord).turn).toBe(3);
  });

  test("SV-23 begin の put が失敗しても current は残り、次の save が turn 1 を書く", async () => {
    const be = createMemoryBackend({ fail: { put: true } });
    const sv = service(be);
    expect(await sv.begin(newGame(1))).toEqual({ ok: false });
    expect(sv.current()).toEqual({ gameId: "g1", turn: 0 });
    be.setFail({});
    expect(await sv.save(newGame(1))).toEqual({ ok: true, turn: 1 });
  });

  test("SV-23 backend null: available は偽で、全操作が例外なしに失敗を返す", async () => {
    const sv = service(null);
    const s = newGame(1);
    expect(sv.available).toBe(false);
    expect(await sv.list()).toEqual({ ok: false });
    expect(await sv.canCreate()).toBe("unavailable");
    expect(await sv.begin(s)).toEqual({ ok: false });
    expect(await sv.save(s)).toEqual({ ok: false });
    expect(await sv.load("g1")).toEqual({ ok: false, reason: "unavailable" });
    expect(await sv.remove("g1")).toBe(false);
    expect(service(createMemoryBackend()).available).toBe(true);
  });

  test("SV-23 get の失敗と newId の例外も外に出さない", async () => {
    const be = createMemoryBackend({ fail: { get: true } });
    expect(await service(be).load("g1")).toEqual({ ok: false, reason: "unavailable" });
    const sv = service(createMemoryBackend(), {
      newId: () => {
        throw new Error("no crypto");
      },
    });
    expect(await sv.begin(createInitialState(1, data))).toEqual({ ok: false });
    expect(sv.current()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SV-20 db.ts（実 IndexedDB は node に無いので、定数と、最小限の偽の IDBFactory で手順だけを確かめる）

type Outcome = "complete" | "abort" | "throw";

/** open の結果と、書き込みのトランザクションの終わり方を選べる偽の IDBFactory */
function fakeIdb(opts: { openThrows?: boolean; openFails?: boolean; existing?: string[]; write?: Outcome } = {}) {
  const log: string[] = [];
  const stores = new Set(opts.existing ?? []);
  const data = new Map<string, unknown>();
  const later = (f: () => void) => void Promise.resolve().then(f);
  const db = {
    objectStoreNames: { contains: (n: string) => stores.has(n) },
    createObjectStore(name: string, o?: { keyPath?: string }) {
      log.push(`create ${name} ${o?.keyPath ?? "-"}`);
      stores.add(name);
    },
    onversionchange: null as null | (() => void),
    onclose: null as null | (() => void),
    /** 閉じた接続の transaction は同期に InvalidStateError を投げる（実物と同じ） */
    closed: false,
    close() {
      log.push("close");
      db.closed = true;
    },
    transaction(name: string, mode: string) {
      log.push(`tx ${name} ${mode}`);
      if (db.closed) {
        const e = new Error("InvalidStateError");
        e.name = "InvalidStateError";
        throw e;
      }
      const tx = {
        oncomplete: null as null | (() => void),
        onerror: null as null | (() => void),
        onabort: null as null | (() => void),
        error: null as Error | null,
        abort() {
          log.push("abort");
        },
        objectStore: () => store,
      };
      const finish = () =>
        later(() => {
          const how = opts.write ?? "complete";
          if (how === "complete") tx.oncomplete?.();
          else {
            tx.error = new Error("QuotaExceededError");
            tx.onerror?.();
            tx.onabort?.();
          }
        });
      const request = (result: unknown) => {
        const req = { result, error: null, onsuccess: null as null | (() => void), onerror: null as null | (() => void) };
        later(() => req.onsuccess?.());
        return req;
      };
      const store = {
        put(rec: { gameId: string }) {
          if (opts.write === "throw") throw new Error("DataCloneError");
          data.set(rec.gameId, rec);
          finish();
          return request(rec.gameId);
        },
        delete(id: string) {
          data.delete(id);
          finish();
          return request(undefined);
        },
        get: (id: string) => request(data.get(id)),
        getAll: () => request([...data.values()]),
      };
      return tx;
    },
  };
  const factory = {
    open(name: string, version: number) {
      log.push(`open ${name} ${version}`);
      if (opts.openThrows === true) throw new Error("SecurityError");
      const req = {
        result: db,
        error: null as Error | null,
        onupgradeneeded: null as null | (() => void),
        onsuccess: null as null | (() => void),
        onerror: null as null | (() => void),
      };
      later(() => {
        if (opts.openFails === true) {
          req.error = new Error("UnknownError");
          req.onerror?.();
          return;
        }
        if (!stores.has(STORE_GAMES) || !stores.has(STORE_SETTINGS)) req.onupgradeneeded?.();
        db.closed = false;
        req.onsuccess?.();
      });
      return req;
    },
  };
  return { factory: factory as unknown as IDBFactory, log, db };
}

describe("SV-20 db.ts", () => {
  test("SV-20 定数: データベース wizlike、版 1（schemaVersion とは別）、ストア games と settings", () => {
    expect(DB_NAME).toBe("wizlike");
    expect(DB_VERSION).toBe(1);
    expect(STORE_GAMES).toBe("games");
    expect(STORE_SETTINGS).toBe("settings");
  });

  test("SV-20 SV-23 openIdbBackend: factory が undefined、open の同期例外、open の失敗は reject", async () => {
    await expect(openIdbBackend(undefined)).rejects.toThrow();
    await expect(openIdbBackend(fakeIdb({ openThrows: true }).factory)).rejects.toThrow("SecurityError");
    await expect(openIdbBackend(fakeIdb({ openFails: true }).factory)).rejects.toThrow("UnknownError");
  });

  test("SV-20 初回は games（keyPath gameId）と settings を作る。既にあれば作らない。versionchange で閉じる", async () => {
    const first = fakeIdb();
    await openIdbBackend(first.factory);
    expect(first.log).toEqual(["open wizlike 1", "create games gameId", "create settings -"]);
    first.db.onversionchange?.();
    expect(first.log.at(-1)).toBe("close");

    const half = fakeIdb({ existing: ["games"] });
    await openIdbBackend(half.factory);
    expect(half.log).toEqual(["open wizlike 1", "create settings -"]);
  });

  test("SV-22 put / delete は readwrite の complete で解決し、get / getAll は readonly", async () => {
    const f = fakeIdb();
    const be = await openIdbBackend(f.factory);
    const rec = record("g1", 1);
    await be.put(rec);
    expect(await be.get("g1")).toBe(rec);
    expect(await be.getAll()).toEqual([rec]);
    await be.delete("g1");
    expect(await be.get("g1")).toBeUndefined();
    expect(f.log.filter((l) => l.startsWith("tx"))).toEqual([
      "tx games readwrite",
      "tx games readonly",
      "tx games readonly",
      "tx games readwrite",
      "tx games readonly",
    ]);
  });

  test("SV-23 put はトランザクションの abort（QuotaExceeded など）と同期例外（DataCloneError など）で reject", async () => {
    const aborted = await openIdbBackend(fakeIdb({ write: "abort" }).factory);
    await expect(aborted.put(record("g1", 1))).rejects.toThrow("QuotaExceededError");
    const f = fakeIdb({ write: "throw" });
    const thrown = await openIdbBackend(f.factory);
    await expect(thrown.put(record("g1", 1))).rejects.toThrow("DataCloneError");
    expect(f.log.at(-1)).toBe("abort");
  });

  test("SV-23 ブラウザが接続を切ったら（onclose）、次の読み書きで開き直す", async () => {
    const f = fakeIdb();
    const be = await openIdbBackend(f.factory);
    await be.put(record("g1", 1));
    f.db.closed = true;
    f.db.onclose?.();
    await be.put(record("g1", 2));
    expect(f.log.filter((l) => l.startsWith("open"))).toHaveLength(2);
    expect(((await be.get("g1")) as GameRecord).updatedAt).toBe(2);
  });

  test("SV-23 versionchange で閉じた後も、次の読み書きで開き直す", async () => {
    const f = fakeIdb();
    const be = await openIdbBackend(f.factory);
    f.db.onversionchange?.();
    await be.put(record("g1", 1));
    expect(f.log.filter((l) => l.startsWith("open"))).toHaveLength(2);
  });

  test("SV-23 通知なしに閉じていた接続（InvalidStateError）はその回は reject し、次の読み書きで開き直す", async () => {
    const f = fakeIdb();
    const be = await openIdbBackend(f.factory);
    f.db.closed = true;
    await expect(be.put(record("g1", 1))).rejects.toThrow("InvalidStateError");
    await be.put(record("g1", 1));
    expect(f.log.filter((l) => l.startsWith("open"))).toHaveLength(2);
    // 自動の再試行はしない（失敗した回の中では開き直さない）
    expect(f.log.filter((l) => l.startsWith("tx"))).toHaveLength(2);
  });

  test("SV-23 開き直しに失敗した回は reject し、その次の読み書きでまた開き直す", async () => {
    const opts: { openFails?: boolean } = {};
    const f = fakeIdb(opts);
    const be = await openIdbBackend(f.factory);
    f.db.close();
    f.db.onclose?.();
    opts.openFails = true;
    await expect(be.put(record("g1", 1))).rejects.toThrow("UnknownError");
    opts.openFails = false;
    await be.put(record("g1", 1));
    expect(f.log.filter((l) => l.startsWith("open"))).toHaveLength(3);
  });
});

describe("SV-30〜33 書き出しと読み込み（SaveService）", () => {
  /** v2 の state から M5.5 の欄を消した v1 の形 */
  function toV1(s: GameState): Record<string, unknown> {
    const v1 = json(s) as unknown as Record<string, unknown>;
    delete v1["adventureTurns"];
    delete v1["tavernEventMark"];
    const dive = v1["dive"] as Record<string, unknown> | null;
    if (dive !== null) delete dive["knownTraps"];
    return v1;
  }
  /** 今の版の書き出しファイルの文字列 */
  function fileOf(gameId: string, turn: number, state: GameState = newGame(1)): string {
    return serializeExportFile(buildExportFile({ gameId, schemaVersion: SCHEMA, turn, state }, 42));
  }
  async function planOf(sv: ReturnType<typeof service>, text: string): Promise<ImportPlan> {
    const r = await sv.prepareImport(text);
    if (!r.ok) throw new Error(`prepareImport failed: ${r.reason}`);
    return r.plan;
  }

  test("SV-30 exportGame: 保存先のレコード（turn 3）を書き出し、exportedAt は now()、parseExportFile で読める", async () => {
    const be = createMemoryBackend();
    const sv = service(be);
    const s = dived(1);
    await sv.begin(s);
    await sv.save(s);
    await sv.save(s); // turn 3、now は 1000〜1002
    const r = await sv.exportGame("g1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect([r.gameId, r.turn, r.exportedAt]).toEqual(["g1", 3, 1003]);
    const p = parseExportFile(r.text, SCHEMA);
    expect(p).toEqual({ ok: true, gameId: "g1", turn: 3, exportedAt: 1003, state: json(s), fromVersion: SCHEMA });
    expect(JSON.parse(r.text)).toMatchObject({ format: "wizlike-save", schemaVersion: SCHEMA });
  });

  test("SV-30 exportGame: 無い id は missing、壊れたレコードは broken、新しすぎる版は tooNew、backend null と get の失敗は unavailable", async () => {
    const be = createMemoryBackend();
    const sv = service(be);
    expect(await sv.exportGame("nope")).toEqual({ ok: false, reason: "missing" });
    be.raw("bad", { gameId: "bad", schemaVersion: "x" });
    expect(await sv.exportGame("bad")).toEqual({ ok: false, reason: "broken" });
    // 別の gameId を持つレコード・state が形の検査に落ちるレコードも broken
    be.raw("other", json(record("zzz", 1)));
    expect(await sv.exportGame("other")).toEqual({ ok: false, reason: "broken" });
    be.raw("shape", { ...json(record("shape", 1)), state: { screen: "town" } });
    expect(await sv.exportGame("shape")).toEqual({ ok: false, reason: "broken" });
    be.raw("new", json(record("new", 1, { schemaVersion: SCHEMA + 1 })));
    expect(await sv.exportGame("new")).toEqual({ ok: false, reason: "tooNew" });
    expect(await service(null).exportGame("g1")).toEqual({ ok: false, reason: "unavailable" });
    be.raw("ok", json(record("ok", 1)));
    be.setFail({ get: true });
    expect(await sv.exportGame("ok")).toEqual({ ok: false, reason: "unavailable" });
  });

  test("SV-30/SV-04 exportGame: v1 のレコードは今の schemaVersion で書き出し、保存先は書き換えない（putCount 0）", async () => {
    const be = createMemoryBackend();
    const s = newGame(1);
    be.raw("v1", { ...json(buildRecord("v1", 4, 999, 1, s)), state: toV1(s) });
    const sv = service(be);
    const r = await sv.exportGame("v1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const f = JSON.parse(r.text) as { schemaVersion: number; turn: number; state: GameState };
    expect(f.schemaVersion).toBe(SCHEMA);
    expect(f.turn).toBe(4);
    expect(f.state.adventureTurns).toBe(0);
    expect(parseExportFile(r.text, SCHEMA).ok).toBe(true);
    expect(be.putCount).toBe(0);
    expect((be.dump().get("v1") as GameRecord).schemaVersion).toBe(1);
  });

  test("SV-30 exportGame は書き込みの鎖に並ぶ: await しない save の直後に呼ぶと、その save の後の turn を書き出す", async () => {
    const be = createMemoryBackend();
    const sv = service(be);
    const s = newGame(1);
    await sv.begin(s);
    const moved = { ...s, gold: s.gold + 5 };
    const pSave = sv.save(moved);
    const pExport = sv.exportGame("g1");
    const r = await pExport;
    expect(await pSave).toEqual({ ok: true, turn: 2 });
    expect(r.ok && r.turn).toBe(2);
    expect(r.ok && (JSON.parse(r.text) as { state: GameState }).state.gold).toBe(s.gold + 5);
  });

  test("SV-31 prepareImport: 記録が無ければ restore（existingTurn null）。件数が maxGames なら full（broken / tooNew も数える）", async () => {
    const be = createMemoryBackend();
    const sv = service(be);
    const s = newGame(1);
    const plan = await planOf(sv, fileOf("lost", 6, s));
    expect(plan).toEqual({ kind: "restore", gameId: "lost", turn: 6, existingTurn: null, summary: summarize(s), state: json(s) });
    expect(MAX).toBe(5);
    be.raw("b1", { gameId: "b1", schemaVersion: "x" });
    be.raw("n1", json(record("n1", 1, { schemaVersion: SCHEMA + 1 })));
    for (const id of ["a1", "a2", "a3"]) be.raw(id, json(record(id, 1)));
    expect(await sv.prepareImport(fileOf("lost", 6))).toEqual({ ok: false, reason: "full" });
    // 既存の gameId への上書きは上限に関係しない
    expect((await planOf(sv, fileOf("a1", 2))).kind).toBe("overwrite");
    // 一覧が読めなければ unavailable
    be.setFail({ getAll: true });
    expect(await sv.prepareImport(fileOf("lost", 6))).toEqual({ ok: false, reason: "unavailable" });
  });

  test("SV-31/SV-32 prepareImport: 既存 turn 5 に turn 7 は overwrite、turn 5 は overwrite、turn 3 は older（existingTurn 5）", async () => {
    const be = createMemoryBackend();
    be.raw("g", json(record("g", 1, { turn: 5 })));
    const sv = service(be);
    expect(await planOf(sv, fileOf("g", 7))).toMatchObject({ kind: "overwrite", turn: 7, existingTurn: 5 });
    expect(await planOf(sv, fileOf("g", 5))).toMatchObject({ kind: "overwrite", turn: 5, existingTurn: 5 });
    expect(await planOf(sv, fileOf("g", 3))).toMatchObject({ kind: "older", turn: 3, existingTurn: 5 });
    expect(be.putCount).toBe(0);
  });

  test("SV-31 prepareImport: 既存が壊れていれば turn を比べず overwrite（existingTurn null）", async () => {
    const be = createMemoryBackend();
    be.raw("g", { gameId: "g", turn: 99, schemaVersion: "x" });
    const sv = service(be);
    expect(await planOf(sv, fileOf("g", 1))).toMatchObject({ kind: "overwrite", turn: 1, existingTurn: null });
  });

  test("SV-31 prepareImport: 同じ gameId の既存が新しすぎる版なら turn に関係なく existingTooNew で拒否し、保存先に書かない", async () => {
    const be = createMemoryBackend();
    be.raw("g", json(record("g", 1, { turn: 5, schemaVersion: SCHEMA + 1 })));
    const sv = service(be);
    expect(await sv.prepareImport(fileOf("g", 7))).toEqual({ ok: false, reason: "existingTooNew" });
    expect(await sv.prepareImport(fileOf("g", 5))).toEqual({ ok: false, reason: "existingTooNew" });
    expect(await sv.prepareImport(fileOf("g", 3))).toEqual({ ok: false, reason: "existingTooNew" });
    expect(be.putCount).toBe(0);
    expect((be.dump().get("g") as GameRecord).schemaVersion).toBe(SCHEMA + 1);
  });

  test("SV-33 prepareImport: format / broken / tooNew / checksum をそのまま返し、保存先に触れない（putCount 0）。backend null と get の失敗は unavailable", async () => {
    const be = createMemoryBackend();
    const sv = service(be);
    const good = JSON.parse(fileOf("g", 2)) as Record<string, unknown>;
    expect(await sv.prepareImport("nope")).toEqual({ ok: false, reason: "format" });
    expect(await sv.prepareImport(JSON.stringify({ ...good, turn: 0 }))).toEqual({ ok: false, reason: "broken" });
    expect(await sv.prepareImport(JSON.stringify({ ...good, schemaVersion: SCHEMA + 1 }))).toEqual({ ok: false, reason: "tooNew" });
    expect(await sv.prepareImport(JSON.stringify({ ...good, checksum: "0".repeat(64) }))).toEqual({ ok: false, reason: "checksum" });
    expect(be.putCount).toBe(0);
    expect(be.dump().size).toBe(0);
    expect(await service(null).prepareImport(fileOf("g", 2))).toEqual({ ok: false, reason: "unavailable" });
    be.setFail({ get: true });
    expect(await sv.prepareImport(fileOf("g", 2))).toEqual({ ok: false, reason: "unavailable" });
  });

  test("SV-31 applyImport: レコードを turn = ファイルの turn、updatedAt = now()、schemaVersion = 今の版で書き、一覧に出る。summary は state から作る", async () => {
    const be = createMemoryBackend();
    const sv = service(be);
    const s = withChar(newGame(2), 1, { life: "dead", hp: 0 });
    const plan = await planOf(sv, fileOf("lost", 8, s));
    expect(await sv.applyImport(plan)).toEqual({ ok: true, kind: "restore" });
    const rec = be.dump().get("lost") as GameRecord;
    expect(rec).toMatchObject({ gameId: "lost", turn: 8, updatedAt: 1000, schemaVersion: SCHEMA, summary: summarize(s) });
    expect(rec.state).toEqual(json(s));
    const l = await sv.list();
    expect(l.ok && l.entries.map((e) => [e.gameId, e.turn, e.status])).toEqual([["lost", 8, "ok"]]);
    // older も確認の後なら同じく書く（巻き戻す）
    const older = await planOf(sv, fileOf("lost", 2, s));
    expect(older.kind).toBe("older");
    expect(await sv.applyImport(older)).toEqual({ ok: true, kind: "older" });
    expect((be.dump().get("lost") as GameRecord).turn).toBe(2);
  });

  test("SV-31 applyImport: restore の直前に件数が maxGames に達していたら full で書かない", async () => {
    const be = createMemoryBackend();
    const sv = service(be);
    const plan = await planOf(sv, fileOf("lost", 3));
    for (let i = 0; i < MAX; i++) be.raw(`x${i}`, json(record(`x${i}`, 1)));
    expect(await sv.applyImport(plan)).toEqual({ ok: false, reason: "full" });
    expect(be.dump().has("lost")).toBe(false);
    expect(be.putCount).toBe(0);
    // 計画の後に同じ gameId が作られていたら（上書きになるので）上限を見ずに書く
    be.raw("lost", json(record("lost", 1)));
    expect(await sv.applyImport(plan)).toEqual({ ok: true, kind: "restore" });
  });

  test("SV-31 applyImport: put の失敗は failed、restore の数え直しの失敗と backend null は unavailable", async () => {
    const be = createMemoryBackend();
    const sv = service(be);
    const plan = await planOf(sv, fileOf("lost", 3));
    be.setFail({ put: true });
    expect(await sv.applyImport(plan)).toEqual({ ok: false, reason: "failed" });
    be.setFail({ get: true });
    expect(await sv.applyImport(plan)).toEqual({ ok: false, reason: "unavailable" });
    be.setFail({ getAll: true });
    expect(await sv.applyImport(plan)).toEqual({ ok: false, reason: "unavailable" });
    expect(await service(null).applyImport(plan)).toEqual({ ok: false, reason: "unavailable" });
    expect(be.putCount).toBe(0);
  });

  test("SV-31 applyImport: current と同じ gameId に書いたら current.turn がファイルの turn になり、次の save は turn + 1", async () => {
    const be = createMemoryBackend();
    const sv = service(be);
    const s = newGame(1);
    await sv.begin(s);
    await sv.save(s);
    expect(sv.current()).toEqual({ gameId: "g1", turn: 2 });
    const plan = await planOf(sv, fileOf("g1", 10, s));
    expect(await sv.applyImport(plan)).toEqual({ ok: true, kind: "overwrite" });
    expect(sv.current()).toEqual({ gameId: "g1", turn: 10 });
    expect(await sv.save(s)).toEqual({ ok: true, turn: 11 });
    // 別の gameId に書いても current は変わらない
    await sv.applyImport(await planOf(sv, fileOf("other", 4, s)));
    expect(sv.current()).toEqual({ gameId: "g1", turn: 11 });
  });
});
