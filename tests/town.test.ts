// 街（TW-02, TW-04, TW-05 の消耗品の購入, TW-07, TW-08, TW-11, TW-30〜32）。rules/town.ts と engine の town.* の配線。
// 既定のパーティ（newGame）: c1 アルド 戦士 HP 15（リーダー）、c2 ベルク 戦士 HP 16 vit 14、c3 キリ 盗賊 HP 10、
// c4 ドナ 僧侶 HP 12 MP 5、c5 エル 魔術師 HP 8 MP 7、c6 フィン 盗賊 HP 10。所持金 300。
// 宿のランク: 0 馬小屋 0G HP ×0、1 相部屋 20G HP ×1.0、2 個室 60G HP ×1.0 と士気（MP はどのランクでも全回復）。寺院: 蘇生 level × 100、
// 成功率 min(95, 50 + vit × 2)、治療 毒 50 / 麻痺 150 / 石化 300、解呪 200。闇魔術 level × 1000。
import { describe, expect, test } from "vitest";
import { createInitialState, execute } from "../src/core/engine";
import { createRng, randInt, type RngState } from "../src/core/rng";
import { checkEnter } from "../src/core/rules/dungeon";
import { sellPrice, shopPrice } from "../src/core/rules/shop";
import { arriveTown, mercyEligible, resurrectCostOf, returnToTown, townMenu } from "../src/core/rules/town";
import { cloneState, createItemInstance, makeContext } from "../src/core/state";
import type { Character, Command, GameEvent, GameState } from "../src/core/types";
import { ctxFor, data, expectKnownStringKeys, expectStateInvariants, loadFreshData, loadRuleData, newGame, seedWithFirstD100 } from "./helpers/core";
import { cursedDagger } from "./helpers/items";

/** newGame(1) の複製に、id → patch を浅くマージしたもの */
function town(patches: Record<string, Partial<Character>> = {}, gold = 300): GameState {
  const s = cloneState(newGame(1));
  for (const [id, p] of Object.entries(patches)) {
    const i = s.party.findIndex((c) => c.id === id);
    if (i < 0) throw new Error(`no member ${id}`);
    s.party[i] = { ...s.party[i]!, ...structuredClone(p) };
  }
  s.gold = gold;
  return s;
}

/** town の state に dungeon.enter d01 を実行してから patches を当てたもの（screen dungeon） */
function diving(patches: Record<string, Partial<Character>> = {}, gold = 300): GameState {
  const r = execute(newGame(1), { type: "dungeon.enter", dungeonId: "d01" }, data);
  const s = cloneState(r.state);
  for (const [id, p] of Object.entries(patches)) {
    const i = s.party.findIndex((c) => c.id === id);
    s.party[i] = { ...s.party[i]!, ...structuredClone(p) };
  }
  s.gold = gold;
  return s;
}

function ok(s: GameState, cmd: Command): { state: GameState; events: GameEvent[] } {
  const r = execute(s, cmd, data);
  const rej = r.events.find((e) => e.kind === "rejected");
  if (rej !== undefined) throw new Error(`rejected: ${JSON.stringify(rej)}`);
  expectKnownStringKeys(r.events);
  return r;
}

function expectRejected(s: GameState, cmd: Command, reason: string): void {
  const rng = structuredClone(s.rng);
  const r = execute(s, cmd, data);
  expect(r.state).toBe(s);
  expect(r.events).toEqual([{ kind: "rejected", command: cmd.type, reason }]);
  expect(s.rng).toEqual(rng);
}

function member(s: GameState, id: string): Character {
  const c = s.party.find((x) => x.id === id);
  if (c === undefined) throw new Error(`no member ${id}`);
  return c;
}

function rngAfter(seed: number, specs: [number, number][]): RngState {
  const r = createRng(seed);
  for (const [a, b] of specs) randInt(r, a, b);
  return r;
}

const DEAD: Partial<Character> = { life: "dead", hp: 0 };
const ASH: Partial<Character> = { life: "ash", hp: 0 };

// ---------------------------------------------------------------------------

describe("TW-02/TW-26 街に入る処理（arriveTown / returnToTown）", () => {
  test("TW-02 帰還で全員（dead・SAN 0 を含む）の SAN が sanMax に戻る。順は 帰還の語り → town.enter → sanChanged（並び順）→ screen town。乱数なし", () => {
    const s = diving({ c1: { san: 40 }, c2: { ...DEAD, san: 10 }, c4: { san: 0 } });
    const ctx = ctxFor(s);
    returnToTown(ctx, "dungeon.return");
    expect(ctx.events).toEqual([
      { kind: "message", key: "dungeon.return" },
      { kind: "message", key: "town.enter" },
      { kind: "sanChanged", id: "c1", delta: 60, san: 100 },
      { kind: "sanChanged", id: "c2", delta: 90, san: 100 },
      { kind: "sanChanged", id: "c4", delta: 100, san: 100 },
      { kind: "screen", to: "town" },
    ]);
    expectKnownStringKeys(ctx.events);
    expect(ctx.state.screen).toBe("town");
    expect(ctx.state.dive).toBeNull();
    expect(ctx.state.pendingChoice).toBeNull();
    expect(ctx.state.townVisit).toEqual({ mercyOffered: false });
    expect(ctx.state.party.map((c) => c.san)).toEqual([100, 100, 100, 100, 100, 100]);
    expect(member(ctx.state, "c2").life).toBe("dead"); // 帰還では生き返らない
    expect(ctx.state.rng).toEqual(s.rng);
  });

  test("TW-02 config.san.restoreOnTown が false なら SAN は変わらず sanChanged も出ない", () => {
    const d = loadFreshData();
    d.config.san.restoreOnTown = false;
    const s = diving({ c1: { san: 40 } });
    const ctx = makeContext(cloneState(s), d);
    returnToTown(ctx, "dungeon.return");
    expect(ctx.events.map((e) => e.kind)).toEqual(["message", "message", "screen"]);
    expect(member(ctx.state, "c1").san).toBe(40);
  });

  test("DG-43 帰還で台帳ごと dive を捨て、所持金と所持品はそのまま残る", () => {
    const s = diving({}, 420);
    s.dive!.ledger = { items: ["i4"], gold: 120 };
    const ctx = ctxFor(s);
    returnToTown(ctx, "dungeon.return");
    expect(ctx.state.gold).toBe(420);
    expect(ctx.state.items["i4"]).toEqual(s.items["i4"]);
    expect(member(ctx.state, "c1").inventory).toEqual(["i4"]);
  });

  test("戦闘中・迷宮外の returnToTown と、dive が残っている arriveTown は Error（前提の崩れ）", () => {
    const inBattle = diving();
    inBattle.screen = "battle";
    inBattle.battle = { origin: { kind: "boss" }, round: 0, partySurprise: false, groups: [], inputs: {}, auto: false, acBonus: {} };
    expect(() => returnToTown(ctxFor(inBattle), "dungeon.return")).toThrow(Error);
    expect(() => returnToTown(ctxFor(town()), "dungeon.return")).toThrow(Error);
    expect(() => arriveTown(ctxFor(diving()))).toThrow(Error);
  });
});

// ---------------------------------------------------------------------------

describe("TW-15 士気（宿の個室。M7）", () => {
  test("TW-15/TW-04 個室: 払う → stay → HP・MP → alive の者を並び順に SAN を sanMax + 10 = 110 へ（dead は変えない）→ town.inn.morale。morale = { rankId: good }、乱数なし", () => {
    // c1 HP 1/15 → 15（+14）、c2 dead（SAN 100 のまま）、c3 SAN 40 → 110（+70）、ほかは 100 → 110（+10）
    const s = town({ c1: { hp: 1 }, c2: { ...DEAD }, c3: { san: 40 } });
    const r = ok(s, { type: "town.inn", rank: 2 });
    expect(r.events).toEqual([
      { kind: "message", key: "town.inn.stay", params: { room: "個室", cost: 60 } },
      { kind: "hpChanged", id: "c1", delta: 14, hp: 15 },
      { kind: "sanChanged", id: "c1", delta: 10, san: 110 },
      { kind: "sanChanged", id: "c3", delta: 70, san: 110 },
      { kind: "sanChanged", id: "c4", delta: 10, san: 110 },
      { kind: "sanChanged", id: "c5", delta: 10, san: 110 },
      { kind: "sanChanged", id: "c6", delta: 10, san: 110 },
      { kind: "message", key: "town.inn.morale" },
    ]);
    expect(r.state.morale).toEqual({ rankId: "good" });
    expect(r.state.gold).toBe(240);
    expect(r.state.party.map((c) => c.san)).toEqual([110, 100, 110, 110, 110, 110]);
    expect(r.state.rng).toEqual(s.rng);
    expect(s.morale).toBeNull(); // 引数は書き換えない
  });

  test("TW-15 士気の立たないランク（馬小屋・相部屋）に泊まり直しても morale は残り SAN 110 も変わらない。個室に泊まり直すと上書き（同じ値）し town.inn.morale を語る", () => {
    const a = ok(town(), { type: "town.inn", rank: 2 }).state;
    const b = ok(a, { type: "town.inn", rank: 0 });
    expect(b.state.morale).toEqual({ rankId: "good" });
    expect(b.events).toEqual([{ kind: "message", key: "town.inn.stay", params: { room: "馬小屋", cost: 0 } }]);
    const c = ok(b.state, { type: "town.inn", rank: 1 });
    expect(c.state.morale).toEqual({ rankId: "good" });
    expect(c.state.party.map((x) => x.san)).toEqual([110, 110, 110, 110, 110, 110]);
    const d = ok(c.state, { type: "town.inn", rank: 2 });
    expect(d.events).toEqual([
      { kind: "message", key: "town.inn.stay", params: { room: "個室", cost: 60 } },
      { kind: "message", key: "town.inn.morale" },
    ]);
    expect(d.state.morale).toEqual({ rankId: "good" });
  });

  test("TW-15 士気の後にレベルアップ（stay → SAN → town.inn.morale → levelUp の順）", () => {
    const r = ok(town({ c2: { exp: 50 } }), { type: "town.inn", rank: 2 });
    const kinds = r.events.map((e) => (e.kind === "message" ? e.key : e.kind));
    const moraleAt = kinds.indexOf("town.inn.morale");
    expect(moraleAt).toBeGreaterThan(kinds.lastIndexOf("sanChanged"));
    expect(kinds.indexOf("levelUp")).toBeGreaterThan(moraleAt);
  });

  test("TW-15/TW-02 街に入ると morale が null に戻り、超過分（110）は sanMax（100）に丸める（restoreOnTown が偽でも丸めだけはする）", () => {
    const stayed = ok(town(), { type: "town.inn", rank: 2 }).state;
    const dv = ok(stayed, { type: "dungeon.enter", dungeonId: "d01" }).state;
    expect(dv.morale).toEqual({ rankId: "good" }); // 迷宮の中では残る
    const s = cloneState(dv);
    s.party[2]!.san = 104;
    s.party[3]!.san = 60;
    const ctx = ctxFor(s);
    returnToTown(ctx, "dungeon.return");
    expect(ctx.state.morale).toBeNull();
    expect(ctx.state.party.map((c) => c.san)).toEqual([100, 100, 100, 100, 100, 100]);
    const d = loadFreshData();
    d.config.san.restoreOnTown = false;
    const ctx2 = makeContext(cloneState(s), d);
    returnToTown(ctx2, "dungeon.return");
    expect(ctx2.state.morale).toBeNull();
    expect(ctx2.state.party.map((c) => c.san)).toEqual([100, 100, 100, 60, 100, 100]);
    expect(ctx2.events.filter((e) => e.kind === "sanChanged")).toEqual([
      { kind: "sanChanged", id: "c1", delta: -10, san: 100 },
      { kind: "sanChanged", id: "c2", delta: -10, san: 100 },
      { kind: "sanChanged", id: "c3", delta: -4, san: 100 },
      { kind: "sanChanged", id: "c5", delta: -10, san: 100 },
      { kind: "sanChanged", id: "c6", delta: -10, san: 100 },
    ]);
  });

  test("TW-15 townMenu.morale は今の士気のランク（id と名前）。rankId がデータに無ければ null（効果なし）", () => {
    const stayed = ok(town(), { type: "town.inn", rank: 2 }).state;
    expect(townMenu(stayed, data)!.morale).toEqual({ rankId: "good", name: "個室" });
    const unknown = cloneState(stayed);
    unknown.morale = { rankId: "suite" };
    expect(townMenu(unknown, data)!.morale).toBeNull();
  });
});

describe("TW-04 宿屋（town.inn）", () => {
  test("TW-04/MG-02 馬小屋（0G、HP ×0）: HP は増えず、alive の MP は mpMax に戻る（1 人ずつ HP → MP）。dead は不変、状態異常は残る", () => {
    // c1 HP 1/15 → +ceil(15 × 0)=0 で 1 のまま、c4 MP 0/5 → 5、c5 HP 5/8 は 5 のまま・MP 3/7 → 7、c2 dead は MP 0 のまま
    const s = town({ c1: { hp: 1, status: ["poison"] }, c2: { ...DEAD, mp: 0 }, c4: { mp: 0 }, c5: { hp: 5, mp: 3 } });
    const r = ok(s, { type: "town.inn", rank: 0 });
    expect(r.events).toEqual([
      { kind: "message", key: "town.inn.stay", params: { room: "馬小屋", cost: 0 } },
      { kind: "mpChanged", id: "c4", delta: 5, mp: 5 },
      { kind: "mpChanged", id: "c5", delta: 4, mp: 7 },
    ]);
    expect(member(r.state, "c1").hp).toBe(1);
    expect(member(r.state, "c5").hp).toBe(5);
    expect(r.state.gold).toBe(300);
    expect(member(r.state, "c1").status).toEqual(["poison"]);
    expect(member(r.state, "c2")).toEqual(member(s, "c2"));
    expect(r.state.rng).toEqual(s.rng);
  });

  test("TW-04/MG-02 相部屋（20G、HP ×1.0。M7 で 0.5 から）と個室（60G、HP ×1.0）: 料金を 1 回払い、HP は ceil(hpMax × hpRatio) 増えて hpMax で止まり、MP は全回復", () => {
    const s = town({ c1: { hp: 1 }, c4: { mp: 0 } });
    const a = ok(s, { type: "town.inn", rank: 1 });
    // c1 +ceil(15 × 1.0)=15 → min(15, 16) = 15（全回復）、c4 MP 0 → 5（ランクに関わらず mpMax）
    expect(a.state.gold).toBe(280);
    expect(member(a.state, "c1").hp).toBe(15);
    expect(member(a.state, "c4").mp).toBe(5);
    const b = ok(s, { type: "town.inn", rank: 2 });
    expect(b.state.gold).toBe(240);
    expect(member(b.state, "c1").hp).toBe(15);
    expect(member(b.state, "c4").mp).toBe(5);
  });

  test("TW-04 満タンでも泊まれる（料金を払い、回復のイベントは出ない。相部屋は士気が立たない）", () => {
    const s = town();
    const r = ok(s, { type: "town.inn", rank: 1 });
    expect(r.events).toEqual([{ kind: "message", key: "town.inn.stay", params: { room: "相部屋", cost: 20 } }]);
    expect(r.state.gold).toBe(280);
    expect(r.state.morale).toBeNull();
  });

  test("TW-04 rank が範囲外・整数でない・数でない、所持金不足、街の外は rejected（同じ参照・乱数不変）", () => {
    const s = town({}, 59);
    expectRejected(s, { type: "town.inn", rank: -1 }, "bad rank");
    expectRejected(s, { type: "town.inn", rank: 3 }, "bad rank");
    expectRejected(s, { type: "town.inn", rank: 1.5 }, "bad rank");
    expectRejected(s, { type: "town.inn", rank: "0" } as unknown as Command, "bad rank");
    expectRejected(s, { type: "town.inn", rank: 2 }, "not enough gold");
    expect(execute(s, { type: "town.inn", rank: 1 }, data).state.gold).toBe(39);
    expectRejected(diving(), { type: "town.inn", rank: 0 }, "wrong screen");
    expectRejected(createInitialState(1, data), { type: "town.inn", rank: 0 }, "wrong screen");
  });

  test("TW-04/CH-64 実データ（expBase 50【仮】）: 0G の馬小屋でもレベルアップする（ベルク exp 50 → L2、d10 を 1 回。戦士なので習得判定なし）", () => {
    const s = town({ c2: { exp: 50 } });
    const r = ok(s, { type: "town.inn", rank: 0 });
    const mirror = createRng(1);
    const g = Math.max(1, randInt(mirror, 1, 10) + 2);
    expect(r.state.rng).toEqual(mirror);
    expect(r.state.gold).toBe(300);
    expect(r.events.filter((e) => e.kind === "levelUp")).toEqual([
      { kind: "levelUp", id: "c2", level: 2, hpGain: g, mpGain: 0, hpMax: 16 + g, mpMax: 0, hp: 16 + g, mp: 0 },
    ]);
  });

  test("TW-04/CH-61 回復の後に alive の者を並び順にレベルアップ（複数段）。dead は上がらない。乱数は鏡の rng どおり、習得の dice は dice.learn（UI-40）", () => {
    // expBase 1000 に固定したデータ（CH-64 の調整値から手計算を切り離す）で、戦士・僧侶の閾値は L2 1000 / L3 1500 / L4 2250。
    // c2 ベルク exp 1500 → L3（d10 を 2 回、+2 は vit 14）、c3 キリ dead exp 5000 は上がらない、
    // c4 ドナ exp 1000 → L2（d8、vit 10 で +0。L2 の判定対象は blessing だけで d100 を 1 回。L2 で開く帯は無いので保証なし）
    const d = loadRuleData();
    const s = town({ c2: { exp: 1500 }, c3: { ...DEAD, exp: 5000 }, c4: { exp: 1000 } });
    const r = execute(s, { type: "town.inn", rank: 0 }, d);
    expectKnownStringKeys(r.events);
    const mirror = createRng(1);
    const g1 = Math.max(1, randInt(mirror, 1, 10) + 2);
    const g2 = Math.max(1, randInt(mirror, 1, 10) + 2);
    const g3 = Math.max(1, randInt(mirror, 1, 8) + 0);
    const roll = randInt(mirror, 1, 100);
    expect(r.state.rng).toEqual(mirror);
    expect(r.events.filter((e) => e.kind === "levelUp")).toEqual([
      { kind: "levelUp", id: "c2", level: 2, hpGain: g1, mpGain: 0, hpMax: 16 + g1, mpMax: 0, hp: 16 + g1, mp: 0 },
      { kind: "levelUp", id: "c2", level: 3, hpGain: g2, mpGain: 0, hpMax: 16 + g1 + g2, mpMax: 0, hp: 16 + g1 + g2, mp: 0 },
      { kind: "levelUp", id: "c4", level: 2, hpGain: g3, mpGain: 5, hpMax: 12 + g3, mpMax: 10, hp: 12 + g3, mp: 10 },
    ]);
    expect(r.events.filter((e) => e.kind === "dice")).toEqual([
      {
        kind: "dice",
        label: { key: "dice.learn", params: { spell: "加護" } },
        rows: [{ label: { key: "dice.row.roll" }, base: null, dice: [roll], total: roll }],
        rule: { key: "dice.rule.rate", params: { rate: 70 } }, // ドナ L2 の blessing: 35 + 20×1 + (15−10)×3 + 0
        result: { key: roll <= 70 ? "dice.learn.ok" : "dice.learn.ng" },
      },
    ]);
    expect(member(r.state, "c3").level).toBe(1);
    expect(member(r.state, "c2").level).toBe(3);
    // 宿の語りが先、レベルアップは後
    expect(r.events[0]).toEqual({ kind: "message", key: "town.inn.stay", params: { room: "馬小屋", cost: 0 } });
  });
});

// ---------------------------------------------------------------------------

describe("TW-07 寺院（town.temple）", () => {
  test("TW-07 蘇生の成功: level × 100 を払い、d100 ≤ 50 + vit × 2（ベルク vit 14 → 78）で alive・HP 1。dice イベントは出さない", () => {
    const { seed, roll } = seedWithFirstD100((x) => x <= 78);
    const s = town({ c2: { ...DEAD, level: 2, levelHistory: [{ level: 2, hpGain: 5, mpGain: 0 }], hpMax: 19 } }, 600);
    s.rng = createRng(seed);
    const r = ok(s, { type: "town.temple", memberId: "c2", service: "resurrect" });
    expect(roll).toBeLessThanOrEqual(78);
    expect(r.events).toEqual([
      { kind: "message", key: "town.temple.resurrectRoll", params: { name: "ベルク" } },
      { kind: "lifeChanged", id: "c2", life: "alive" },
      { kind: "hpChanged", id: "c2", delta: 1, hp: 1 },
      { kind: "message", key: "town.temple.resurrectOk", params: { name: "ベルク" } },
    ]);
    expect(r.state.gold).toBe(400);
    expect(member(r.state, "c2").life).toBe("alive");
    expect(member(r.state, "c2").hp).toBe(1);
    expect(r.state.rng).toEqual(rngAfter(seed, [[1, 100]]));
  });

  test("TW-07/CH-45 蘇生の失敗: 成否に関わらず払い、d100 > 78 で ash。灰は状態異常を持たない（古い保存の死者に毒が残っていても外す）", () => {
    // 2026-10-05 ユーザー決定（CH-45）で期待値を変えた: 旧は ash でも status ["poison"] が残り statusChanged を出さなかった
    const { seed } = seedWithFirstD100((x) => x > 78);
    const s = town({ c2: { ...DEAD, mp: 0, san: 30, status: ["poison"] } });
    s.rng = createRng(seed);
    const r = ok(s, { type: "town.temple", memberId: "c2", service: "resurrect" });
    expect(r.events).toEqual([
      { kind: "message", key: "town.temple.resurrectRoll", params: { name: "ベルク" } },
      { kind: "lifeChanged", id: "c2", life: "ash" },
      { kind: "statusChanged", id: "c2", status: "poison", on: false },
      { kind: "message", key: "town.temple.resurrectFail", params: { name: "ベルク" } },
    ]);
    expect(r.state.gold).toBe(200);
    expect(member(r.state, "c2")).toMatchObject({ life: "ash", hp: 0, san: 30, status: [] });
  });

  test("TW-07/CH-45 蘇生の成功は常に状態異常なしで戻る: 古い保存の死者に毒・麻痺が残っていても lifeChanged → hpChanged → statusChanged off（status の順）。MP・SAN はそのまま", () => {
    const { seed } = seedWithFirstD100((x) => x <= 78);
    const s = town({ c2: { ...DEAD, mp: 0, san: 30, status: ["poison", "paralysis"] } });
    s.rng = createRng(seed);
    const r = ok(s, { type: "town.temple", memberId: "c2", service: "resurrect" });
    expect(r.events).toEqual([
      { kind: "message", key: "town.temple.resurrectRoll", params: { name: "ベルク" } },
      { kind: "lifeChanged", id: "c2", life: "alive" },
      { kind: "hpChanged", id: "c2", delta: 1, hp: 1 },
      { kind: "statusChanged", id: "c2", status: "poison", on: false },
      { kind: "statusChanged", id: "c2", status: "paralysis", on: false },
      { kind: "message", key: "town.temple.resurrectOk", params: { name: "ベルク" } },
    ]);
    expect(member(r.state, "c2")).toMatchObject({ life: "alive", hp: 1, mp: 0, san: 30, status: [] });
  });

  test("TW-07 成功率の上限は 95: vit 30（50 + 60 = 110）でも d100 = 96 は失敗、95 は成功", () => {
    for (const [target, life] of [
      [96, "ash"],
      [95, "alive"],
    ] as const) {
      const { seed } = seedWithFirstD100((x) => x === target);
      const s = town({ c2: { ...DEAD, stats: { ...member(newGame(1), "c2").stats, vit: 30 } } });
      s.rng = createRng(seed);
      const r = ok(s, { type: "town.temple", memberId: "c2", service: "resurrect" });
      expect(member(r.state, "c2").life).toBe(life);
    }
  });

  test("TW-07 蘇生の rejected: alive・ash は not dead、所持金不足、未知のメンバー、未知のサービス、街の外", () => {
    const s = town({ c2: DEAD, c3: ASH }, 99);
    expectRejected(s, { type: "town.temple", memberId: "c1", service: "resurrect" }, "not dead");
    expectRejected(s, { type: "town.temple", memberId: "c3", service: "resurrect" }, "not dead");
    expectRejected(s, { type: "town.temple", memberId: "c2", service: "resurrect" }, "not enough gold");
    expectRejected(s, { type: "town.temple", memberId: "c9", service: "resurrect" }, "no such member");
    expectRejected(s, { type: "town.temple", memberId: "c2", service: "dark" } as unknown as Command, "bad service");
    expectRejected(diving({ c2: DEAD }), { type: "town.temple", memberId: "c2", service: "resurrect" }, "wrong screen");
  });

  test("TW-07 治療: 毒・麻痺・石化を status の順にすべて外し、cureCost の合計を払う（毒 50 + 麻痺 150 = 200）。睡眠は対象外", () => {
    const s = town({ c3: { status: ["paralysis", "sleep", "poison"] } });
    const r = ok(s, { type: "town.temple", memberId: "c3", service: "cure" });
    expect(r.events).toEqual([
      { kind: "statusChanged", id: "c3", status: "paralysis", on: false },
      { kind: "statusChanged", id: "c3", status: "poison", on: false },
      { kind: "message", key: "town.temple.cured", params: { name: "キリ" } },
    ]);
    expect(r.state.gold).toBe(100);
    expect(member(r.state, "c3").status).toEqual(["sleep"]);
    expect(r.state.rng).toEqual(s.rng);
  });

  test("TW-07 治療の rejected: 治すものが無い、dead、所持金不足", () => {
    expectRejected(town({ c3: { status: ["sleep"] } }), { type: "town.temple", memberId: "c3", service: "cure" }, "nothing to cure");
    expectRejected(town({ c3: { ...DEAD, status: ["poison"] } }), { type: "town.temple", memberId: "c3", service: "cure" }, "not alive");
    expectRejected(town({ c3: { status: ["stone"] } }, 299), { type: "town.temple", memberId: "c3", service: "cure" }, "not enough gold");
  });

  /** c2 に呪いの短剣を装備させる（元の長剣は inventory へ） */
  function withCursed(s: GameState, id = "c2"): { s: GameState; inst: string } {
    const inst = cursedDagger(s, true);
    const ch = member(s, id);
    if (ch.equipment.weapon !== null) ch.inventory.push(ch.equipment.weapon);
    ch.equipment.weapon = inst;
    return { s, inst };
  }

  test("TW-07 解呪: 装備中の呪われた品を失い、uncurseCost 200 を 1 回払う（dead の者も受けられる）", () => {
    for (const patch of [{}, DEAD]) {
      const { s, inst } = withCursed(town({ c2: patch }));
      const r = ok(s, { type: "town.temple", memberId: "c2", service: "uncurse" });
      expect(r.events).toEqual([
        { kind: "message", key: "town.temple.uncursed", params: { name: "ベルク", item: "短剣" } },
      ]);
      expect(r.state.gold).toBe(100);
      expect(r.state.items[inst]).toBeUndefined();
      expect(member(r.state, "c2").equipment.weapon).toBeNull();
      expect(member(r.state, "c2").inventory).toEqual(["i5"]);
    }
  });

  test("TW-07/IT-32 解呪の対象は実体の cursed で決まる（M7。同じ短剣のベースでも呪われていない実体は対象外）", () => {
    const s = town();
    const dagger = createItemInstance(s, { itemId: "dagger", identified: true });
    const c2 = member(s, "c2");
    c2.inventory.push(c2.equipment.weapon!);
    c2.equipment.weapon = dagger;
    expectRejected(s, { type: "town.temple", memberId: "c2", service: "uncurse" }, "nothing cursed");
    s.items[dagger]!.cursed = true;
    const r = ok(s, { type: "town.temple", memberId: "c2", service: "uncurse" });
    expect(r.state.items[dagger]).toBeUndefined();
  });

  test("TW-07 解呪の rejected: 呪われた品を装備していない（inventory にあるだけでも）、所持金不足", () => {
    expectRejected(town(), { type: "town.temple", memberId: "c2", service: "uncurse" }, "nothing cursed");
    const s = town();
    member(s, "c2").inventory.push(cursedDagger(s, true));
    expectRejected(s, { type: "town.temple", memberId: "c2", service: "uncurse" }, "nothing cursed");
    expectRejected(withCursed(town({}, 199)).s, { type: "town.temple", memberId: "c2", service: "uncurse" }, "not enough gold");
  });

});

// ---------------------------------------------------------------------------

describe("TW-08 闇魔術（town.dark）", () => {
  test("TW-08/CH-45 ash の者が level × 1000 を払って alive・HP 1 に戻る（確定。乱数なし）。状態異常はすべて外し、MP・SAN はそのまま", () => {
    // 2026-10-05 ユーザー決定（CH-45）で期待値を変えた: 旧は status ["poison"] が残った
    // ベルク L2 → 2 × 1000 = 2000。所持金 2500 → 500
    const s = town(
      { c2: { ...ASH, level: 2, levelHistory: [{ level: 2, hpGain: 5, mpGain: 0 }], hpMax: 19, mp: 0, san: 30, status: ["poison"] } },
      2500,
    );
    const r = ok(s, { type: "town.dark", memberId: "c2" });
    expect(r.events).toEqual([
      { kind: "lifeChanged", id: "c2", life: "alive" },
      { kind: "hpChanged", id: "c2", delta: 1, hp: 1 },
      { kind: "statusChanged", id: "c2", status: "poison", on: false },
      { kind: "message", key: "town.dark.done", params: { name: "ベルク" } },
    ]);
    expect(r.state.gold).toBe(500);
    expect(member(r.state, "c2")).toMatchObject({ life: "alive", hp: 1, hpMax: 19, mp: 0, san: 30, status: [], level: 2 });
    expect(r.state.rng).toEqual(s.rng);
    expect(r.state.townVisit).toEqual(s.townVisit);
  });

  test("TW-08 所持金ちょうど（L1 で 1000）なら払えて 0 になる", () => {
    const r = ok(town({ c3: ASH }, 1000), { type: "town.dark", memberId: "c3" });
    expect(r.state.gold).toBe(0);
    expect(member(r.state, "c3").life).toBe("alive");
  });

  test("TW-08 rejected: alive・dead は not ash、所持金不足（L1 で 999）、未知のメンバー・文字列でない id、街の外（同じ参照・乱数不変）", () => {
    const s = town({ c2: DEAD, c3: ASH }, 999);
    expectRejected(s, { type: "town.dark", memberId: "c1" }, "not ash");
    expectRejected(s, { type: "town.dark", memberId: "c2" }, "not ash");
    expectRejected(s, { type: "town.dark", memberId: "c3" }, "not enough gold");
    expectRejected(s, { type: "town.dark", memberId: "c9" }, "no such member");
    expectRejected(s, { type: "town.dark", memberId: 3 } as unknown as Command, "no such member");
    expectRejected(diving({ c3: ASH }, 5000), { type: "town.dark", memberId: "c3" }, "wrong screen");
    expectRejected(createInitialState(1, data), { type: "town.dark", memberId: "c3" }, "wrong screen");
  });

  test("TW-08 銀行の残高は使わない（所持金だけで払う）", () => {
    const s = town({ c3: ASH }, 500);
    s.bank = 5000;
    expectRejected(s, { type: "town.dark", memberId: "c3" }, "not enough gold");
  });
});

// ---------------------------------------------------------------------------

describe("TW-11 迷宮入口", () => {
  test("TW-11 行動可能な者（CH-44）がいなければ dungeon.enter は no one can act（checkEnter も同じ）", () => {
    const s = town({ c1: { status: ["paralysis"] }, c2: DEAD, c3: ASH, c4: { san: 0 }, c5: { status: ["stone"] }, c6: DEAD });
    expectRejected(s, { type: "dungeon.enter", dungeonId: "d01" }, "no one can act");
    expect(checkEnter(s, "d01", data)).toBe("no one can act");
    // 1 人でも行動できれば入れ、来訪は終わる（townVisit null）
    const t = town({ c2: DEAD, c3: ASH, c4: { san: 0 }, c5: { status: ["stone"] }, c6: DEAD });
    const r = ok(t, { type: "dungeon.enter", dungeonId: "d01" });
    expect(r.state.townVisit).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("TW-30〜32 GM の救済", () => {
  test("TW-30 リーダー以外が全員 dead / ash で、所持金 + 銀行 < 最安の蘇生費なら申し出る（sanChanged の後、screen town の前）", () => {
    const s = diving({ c2: DEAD, c3: DEAD, c4: ASH, c5: DEAD, c6: DEAD }, 99);
    const ctx = ctxFor(s);
    returnToTown(ctx, "dungeon.return");
    const keys = ctx.events.map((e) => (e.kind === "message" ? e.key : e.kind));
    expect(keys).toEqual(["dungeon.return", "town.enter", "town.mercy.offer", "screen"]);
    expect(ctx.state.townVisit).toEqual({ mercyOffered: true });
  });

  test("TW-30 所持金 + 銀行が最安の蘇生費以上、または生存者がいれば申し出ない（銀行も数える）", () => {
    const allDead = { c2: DEAD, c3: DEAD, c4: DEAD, c5: DEAD, c6: DEAD };
    expect(mercyEligible(diving(allDead, 99), data)).toBe(true);
    expect(mercyEligible(diving(allDead, 100), data)).toBe(false);
    const banked = diving(allDead, 50);
    banked.bank = 50;
    expect(mercyEligible(banked, data)).toBe(false);
    expect(mercyEligible(diving({ c2: DEAD, c3: DEAD, c4: DEAD, c5: DEAD }, 0), data)).toBe(false);
  });

  test("TW-30 ash の費用は level × 1000（闇魔術）: 全員 ash の L1 なら所持金 999 で申し出、dead が混じれば 100 が最安", () => {
    const allAsh = { c2: ASH, c3: ASH, c4: ASH, c5: ASH, c6: ASH };
    expect(resurrectCostOf({ ...member(newGame(1), "c2"), ...ASH, level: 3 }, data)).toBe(3000);
    expect(resurrectCostOf({ ...member(newGame(1), "c2"), ...DEAD, level: 3 }, data)).toBe(300);
    expect(mercyEligible(diving(allAsh, 999), data)).toBe(true);
    expect(mercyEligible(diving(allAsh, 1000), data)).toBe(false);
    expect(mercyEligible(diving({ ...allAsh, c6: DEAD }, 999), data)).toBe(false);
  });

  /** 救済の申し出がある街の state（c1 だけ alive、c2..c6 は dead / ash、所持金 0） */
  function offered(): GameState {
    const ctx = ctxFor(diving({ c2: DEAD, c3: ASH, c4: DEAD, c5: DEAD, c6: DEAD }, 0));
    returnToTown(ctx, "dungeon.return");
    expect(ctx.state.townVisit).toEqual({ mercyOffered: true });
    return ctx.state;
  }

  test("TW-31 town.mercy で dead / ash の者が HP 1 の alive に戻り、申し出が下りる。乱数なし", () => {
    for (const id of ["c2", "c3"]) {
      const s = offered();
      const r = ok(s, { type: "town.mercy", memberId: id });
      const name = member(s, id).name;
      expect(r.events).toEqual([
        { kind: "lifeChanged", id, life: "alive" },
        { kind: "hpChanged", id, delta: 1, hp: 1 },
        { kind: "message", key: "town.mercy.done", params: { name } },
      ]);
      expect(member(r.state, id)).toMatchObject({ life: "alive", hp: 1 });
      expect(r.state.townVisit).toEqual({ mercyOffered: false });
      expect(r.state.rng).toEqual(s.rng);
    }
  });

  test("TW-31/CH-45 救済で戻る者は常に状態異常なし（古い保存の死者・灰に毒・石化が残っていても hpChanged の後に statusChanged off）", () => {
    for (const id of ["c2", "c3"]) {
      const s = offered();
      member(s, id).status = ["poison", "stone"];
      const r = ok(s, { type: "town.mercy", memberId: id });
      const name = member(s, id).name;
      expect(r.events).toEqual([
        { kind: "lifeChanged", id, life: "alive" },
        { kind: "hpChanged", id, delta: 1, hp: 1 },
        { kind: "statusChanged", id, status: "poison", on: false },
        { kind: "statusChanged", id, status: "stone", on: false },
        { kind: "message", key: "town.mercy.done", params: { name } },
      ]);
      expect(member(r.state, id).status).toEqual([]);
    }
  });

  test("TW-31 リーダーも選べる（リーダーが dead のとき）", () => {
    const ctx = ctxFor(diving({ c1: DEAD, c2: DEAD, c3: DEAD, c4: DEAD, c5: DEAD, c6: DEAD }, 0));
    returnToTown(ctx, "dungeon.return");
    const r = ok(ctx.state, { type: "town.mercy", memberId: "c1" });
    expect(member(r.state, "c1").life).toBe("alive");
  });

  test("TW-31 alive の者・未知のメンバー・申し出なし・街の外は rejected", () => {
    const s = offered();
    expectRejected(s, { type: "town.mercy", memberId: "c1" }, "not dead");
    expectRejected(s, { type: "town.mercy", memberId: "c9" }, "no such member");
    expectRejected(town({ c2: DEAD }), { type: "town.mercy", memberId: "c2" }, "no mercy");
    expectRejected(diving({ c2: DEAD }), { type: "town.mercy", memberId: "c2" }, "wrong screen");
  });

  test("TW-32 1 回の来訪で 1 人（2 回目は no mercy）。条件が続けば次の来訪で再び申し出る", () => {
    const s = offered();
    const a = ok(s, { type: "town.mercy", memberId: "c2" });
    expectRejected(a.state, { type: "town.mercy", memberId: "c4" }, "no mercy");
    // 申し出の間も宿屋は使える（救済は pendingChoice ではない）
    ok(s, { type: "town.inn", rank: 0 });
    // c2 が戻っても c2 は非リーダーで alive なので次の来訪では条件を満たさない。c2 を再び dead にして入り直す
    const b = ok(a.state, { type: "dungeon.enter", dungeonId: "d01" });
    expect(b.state.townVisit).toBeNull();
    const again = cloneState(b.state);
    member(again, "c2").life = "dead";
    member(again, "c2").hp = 0;
    const ctx = ctxFor(again);
    returnToTown(ctx, "dungeon.return");
    expect(ctx.state.townVisit).toEqual({ mercyOffered: true });
    expect(ctx.events.some((e) => e.kind === "message" && e.key === "town.mercy.offer")).toBe(true);
  });

  test("TW-32 申し出の間も闇魔術（town.dark）は使え、申し出は下りない（mercyOffered は true のまま）", () => {
    // c2..c6 が ash（L1 で 1000）、所持金 999 → 最安の蘇生費 1000 に届かないので申し出る
    const ctx = ctxFor(diving({ c2: ASH, c3: ASH, c4: ASH, c5: ASH, c6: ASH }, 999));
    returnToTown(ctx, "dungeon.exit");
    expect(ctx.state.townVisit).toEqual({ mercyOffered: true });
    const s = cloneState(ctx.state);
    s.gold = 1000;
    const r = ok(s, { type: "town.dark", memberId: "c2" });
    expect(r.events).toEqual([
      { kind: "lifeChanged", id: "c2", life: "alive" },
      { kind: "hpChanged", id: "c2", delta: 1, hp: 1 },
      { kind: "message", key: "town.dark.done", params: { name: member(s, "c2").name } },
    ]);
    expect(r.state.gold).toBe(0);
    expect(r.state.townVisit).toEqual({ mercyOffered: true });
    expect(townMenu(r.state, data)!.mercy!.map((m) => m.memberId)).toEqual(["c3", "c4", "c5", "c6"]);
  });
});

// ---------------------------------------------------------------------------

describe("UI-52/TW-11 townMenu（表示層向けの問い合わせ）", () => {
  test("screen が town 以外なら null", () => {
    expect(townMenu(createInitialState(1, data), data)).toBeNull();
    expect(townMenu(diving(), data)).toBeNull();
  });

  test("TW-04/TW-07 料金・affordable・候補（所持金 200）", () => {
    const { s } = (() => {
      const base = town(
        {
          c2: { ...DEAD, level: 2, levelHistory: [{ level: 2, hpGain: 5, mpGain: 0 }] },
          c3: { status: ["poison", "paralysis"] },
          c5: { ...ASH },
          c6: { status: ["stone"] },
        },
        200,
      );
      const inst = cursedDagger(base, true);
      member(base, "c4").inventory.push(member(base, "c4").equipment.weapon!);
      member(base, "c4").equipment.weapon = inst;
      return { s: base };
    })();
    const m = townMenu(s, data)!;
    expect(m.gold).toBe(200);
    expect(m.inn).toEqual([
      { rank: 0, id: "stable", name: "馬小屋", cost: 0, affordable: true, morale: false },
      { rank: 1, id: "cheap", name: "相部屋", cost: 20, affordable: true, morale: false },
      { rank: 2, id: "good", name: "個室", cost: 60, affordable: true, morale: true },
    ]);
    expect(m.morale).toBeNull();
    expect(m.temple.resurrect).toEqual([{ memberId: "c2", name: "ベルク", cost: 200, affordable: true }]);
    expect(m.temple.cure).toEqual([
      { memberId: "c3", name: "キリ", cost: 200, affordable: true },
      { memberId: "c6", name: "フィン", cost: 300, affordable: false },
    ]);
    expect(m.temple.uncurse).toEqual([{ memberId: "c4", name: "ドナ", cost: 200, affordable: true }]);
    // TW-08: ash の c5 エル（L1）だけ。1 × 1000 > 200
    expect(m.dark).toEqual([{ memberId: "c5", name: "エル", cost: 1000, affordable: false }]);
    expect(m.mercy).toBeNull();
    expect(m.dungeons).toEqual([{ id: "d01", name: data.dungeons[0]!.name, canEnter: true }]);
  });

  test("TW-08 dark は ash の者を並び順に、cost = level × 1000、affordable = 所持金 ≥ cost（dead は入らない）", () => {
    const s = town({ c2: { ...ASH, level: 3 }, c4: DEAD, c6: ASH }, 1500);
    expect(townMenu(s, data)!.dark).toEqual([
      { memberId: "c2", name: "ベルク", cost: 3000, affordable: false },
      { memberId: "c6", name: "フィン", cost: 1000, affordable: true },
    ]);
    expect(townMenu(town(), data)!.dark).toEqual([]);
  });

  test("TW-31 申し出があれば mercy に dead / ash の全員（並び順）。TW-11 行動可能な者がいなければ canEnter は偽", () => {
    const ctx = ctxFor(diving({ c1: { status: ["paralysis"] }, c2: DEAD, c3: ASH, c4: DEAD, c5: DEAD, c6: DEAD }, 0));
    returnToTown(ctx, "dungeon.return");
    const m = townMenu(ctx.state, data)!;
    expect(m.mercy).toEqual([
      { memberId: "c2", name: "ベルク", life: "dead" },
      { memberId: "c3", name: "キリ", life: "ash" },
      { memberId: "c4", name: "ドナ", life: "dead" },
      { memberId: "c5", name: "エル", life: "dead" },
      { memberId: "c6", name: "フィン", life: "dead" },
    ]);
    expect(m.dungeons.map((d) => d.canEnter)).toEqual([false]);
    expect(m.inn.map((r) => r.affordable)).toEqual([true, false, false]);
  });
});

// ---------------------------------------------------------------------------

describe("TW-05 店（town.shop。消耗品の購入だけ）", () => {
  // 既定のパーティの所持枠（CH-71、slotsPerCharacter 8）: c1 装備 3 + 薬草 1 = 4、c2 装備 2、c3 装備 3 + 薬草 1 = 4、
  // c4 装備 2 + 解毒草 1 = 3、c5 装備 1 + 帰還の糸 1 = 2、c6 装備 2 + 薬草 1 = 3。実体は i1..i18 で、次は i19。
  const buy = (memberId: unknown, itemId: unknown): Command =>
    ({ type: "town.shop", action: { kind: "buy", memberId, itemId } }) as unknown as Command;

  test("TW-05 buy: price を払い、鑑定済みの実体を本人の inventory の末尾に入れ、town.shop.bought を語る。乱数なし", () => {
    const s = town();
    expect(s.nextItemSeq).toBe(19);
    const r = ok(s, buy("c3", "herb"));
    expect(r.events).toEqual([{ kind: "message", key: "town.shop.bought", params: { name: "キリ", item: "薬草", cost: 10 } }]);
    expect(r.state.gold).toBe(290);
    expect(member(r.state, "c3").inventory).toEqual([...member(s, "c3").inventory, "i19"]);
    // IT-10（M7）: 実体の欄は Lv0・通常・オプションなし・ユニークでない・呪いなし・foundIn null（店で買った品）
    expect(r.state.items["i19"]).toEqual({
      id: "i19",
      itemId: "herb",
      level: 0,
      rarity: "normal",
      options: [],
      uniqueId: null,
      identified: true,
      cursed: false,
      foundIn: null,
    });
    expect(r.state.nextItemSeq).toBe(20);
    expect(r.state.rng).toEqual(s.rng);
    expect(r.state.townVisit).toEqual(s.townVisit);
    // 解毒草 15G、帰還の糸 50G
    const a = ok(r.state, buy("c5", "antidote_herb"));
    expect(a.state.gold).toBe(275);
    const t = ok(a.state, buy("c5", "return_thread"));
    expect(t.state.gold).toBe(225);
    expect(member(t.state, "c5").inventory.slice(-2).map((id) => t.state.items[id]!.itemId)).toEqual(["antidote_herb", "return_thread"]);
    // 買った品は街を出てもそのまま（台帳に入らない。DG-40）
    const d = ok(t.state, { type: "dungeon.enter", dungeonId: "d01" });
    expect(d.state.dive!.ledger).toEqual({ items: [], gold: 0 });
  });

  test("TW-05 所持金ちょうど（帰還の糸 50G を 50G で）なら買えて 0 になり、49G なら not enough gold", () => {
    const r = ok(town({}, 50), buy("c1", "return_thread"));
    expect(r.state.gold).toBe(0);
    expectRejected(town({}, 49), buy("c1", "return_thread"), "not enough gold");
  });

  test("TW-05/CH-71 所持枠: 使用 7 なら買えて 8 になり、8 なら inventory full（所持金より先に判定）", () => {
    const s = town();
    const c2 = member(s, "c2");
    for (let i = 0; i < 5; i++) c2.inventory.push(createItemInstance(s, { itemId: "herb", identified: true })); // 装備 2 + 5 = 7
    const r = ok(s, buy("c2", "herb"));
    expect(member(r.state, "c2").inventory).toHaveLength(6);
    expectRejected(r.state, buy("c2", "herb"), "inventory full");
    const poor = cloneState(r.state);
    poor.gold = 0;
    expectRejected(poor, buy("c2", "herb"), "inventory full");
  });

  test("TW-05 rejected の理由と順（M7 の順）: wrong screen → bad action → no such member → not alive → not for sale → inventory full → not enough gold（同じ参照・乱数不変）", () => {
    const s = town({ c2: DEAD, c3: ASH }, 5);
    expectRejected(diving(), buy("c1", "herb"), "wrong screen");
    expectRejected(createInitialState(1, data), buy("c1", "herb"), "wrong screen");
    expectRejected(s, { type: "town.shop" } as unknown as Command, "bad action");
    expectRejected(s, { type: "town.shop", action: "buy" } as unknown as Command, "bad action");
    expectRejected(s, { type: "town.shop", action: { kind: "steal", memberId: "c1", itemId: "herb" } } as unknown as Command, "bad action");
    expectRejected(s, buy(1, "herb"), "bad action");
    expectRejected(s, buy("c1", null), "bad action");
    expectRejected(s, { type: "town.shop", action: { kind: "sell", memberId: "c1", instanceId: 4 } } as unknown as Command, "bad action");
    expectRejected(s, { type: "town.shop", action: { kind: "buyback", memberId: "c1", itemId: "i4" } } as unknown as Command, "bad action");
    // TW-05 の M7 の順: メンバーと生死を売り物より先に見る（M6 までは not for sale が先だった）
    expectRejected(s, buy("c9", "nope"), "no such member");
    expectRejected(s, buy("c2", "nope"), "not alive");
    expectRejected(s, buy("c3", "herb"), "not alive");
    // 売り物は consumable かつ infinite の品と、shopMinLevel ≤ shopLevel（0）の汎用ベース（IT-62）だけ。
    // 魔法書（infinite でない）・shopMinLevel 2 の鎚矛・ユニークの id・未知の id は売らない
    for (const itemId of ["tome_lightning", "mace", "shadowfolk_sword", "nope"]) {
      expectRejected(s, buy("c1", itemId), "not for sale");
    }
    expectRejected(s, buy("c1", "herb"), "not enough gold");
    expectRejected(s, buy("c1", "dagger"), "not enough gold"); // 短剣 Lv0 は 15G（IT-60）
  });

  test("TW-05/TW-32 救済の申し出の間も店は使え、申し出は下りない", () => {
    const ctx = ctxFor(diving({ c2: DEAD, c3: DEAD, c4: DEAD, c5: DEAD, c6: DEAD }, 99));
    returnToTown(ctx, "dungeon.exit");
    expect(ctx.state.townVisit).toEqual({ mercyOffered: true });
    const r = ok(ctx.state, buy("c1", "herb"));
    expect(r.state.gold).toBe(89);
    expect(r.state.townVisit).toEqual({ mercyOffered: true });
  });

  test("UI-52/TW-05/IT-60〜65 townMenu.shop: 消耗品（items.json の順）・流通レベルの装備・持たせる候補（alive の者、slotsFree）・売れる品・買い戻し・鑑定", () => {
    // 初期の実体: c1 i1〜i3 装備・i4 薬草、c2 i5 / i6 装備、c3 i7〜i9 装備・i10 薬草、c4 i11 / i12 装備・i13 解毒草、c5 i14 装備・i15 帰還の糸、c6 i16 / i17 装備・i18 薬草
    expect(townMenu(town(), data)!.shop).toEqual({
      items: [
        { itemId: "herb", name: "薬草", price: 10, affordable: true },
        { itemId: "antidote_herb", name: "解毒草", price: 15, affordable: true },
        { itemId: "return_thread", name: "帰還の糸", price: 50, affordable: true },
      ],
      // shopLevel 0: shopMinLevel 0 のベース（equipment-bases.json の順）を Lv0 の基本額で
      equipment: [
        { itemId: "dagger", name: "短剣", level: 0, price: 15, affordable: true },
        { itemId: "long_sword", name: "長剣", level: 0, price: 100, affordable: true },
        { itemId: "short_bow", name: "短弓", level: 0, price: 80, affordable: true },
        { itemId: "sling", name: "投石紐", level: 0, price: 20, affordable: true },
        { itemId: "staff", name: "杖", level: 0, price: 10, affordable: true },
        { itemId: "leather_armor", name: "革鎧", level: 0, price: 50, affordable: true },
        { itemId: "wooden_shield", name: "木の盾", level: 0, price: 40, affordable: true },
        { itemId: "leather_cap", name: "革兜", level: 0, price: 30, affordable: true },
        { itemId: "leather_gloves", name: "革小手", level: 0, price: 30, affordable: true },
      ],
      members: [
        { memberId: "c1", name: "アルド", slotsFree: 4 },
        { memberId: "c2", name: "ベルク", slotsFree: 6 },
        { memberId: "c3", name: "キリ", slotsFree: 4 },
        { memberId: "c4", name: "ドナ", slotsFree: 5 },
        { memberId: "c5", name: "エル", slotsFree: 6 },
        { memberId: "c6", name: "フィン", slotsFree: 5 },
      ],
      // IT-61: 消耗品は floor(price × 0.5)（薬草 5・解毒草 7・帰還の糸 25）。装備中の品は inventory に無いので出ない
      sellable: [
        { memberId: "c1", name: "アルド", items: [{ instanceId: "i4", name: "薬草", price: 5 }] },
        { memberId: "c2", name: "ベルク", items: [] },
        { memberId: "c3", name: "キリ", items: [{ instanceId: "i10", name: "薬草", price: 5 }] },
        { memberId: "c4", name: "ドナ", items: [{ instanceId: "i13", name: "解毒草", price: 7 }] },
        { memberId: "c5", name: "エル", items: [{ instanceId: "i15", name: "帰還の糸", price: 25 }] },
        { memberId: "c6", name: "フィン", items: [{ instanceId: "i18", name: "薬草", price: 5 }] },
      ],
      buyback: [],
      identify: { fee: 100, affordable: true, items: [] },
    });
    const m = townMenu(town({ c2: DEAD, c5: ASH }, 15), data)!.shop;
    expect(m.items.map((i) => i.affordable)).toEqual([true, true, false]);
    expect(m.members.map((x) => x.memberId)).toEqual(["c1", "c3", "c4", "c6"]);
    expect(m.sellable.map((x) => x.memberId)).toEqual(["c1", "c2", "c3", "c4", "c5", "c6"]); // 売るのは life を問わない
    expect(m.identify.affordable).toBe(false);
  });

  test("IT-62/IT-63/IT-65 townMenu.shop: shopLevel 2 の売り物（Lv2・買値 ×2・表示名 +2）、未鑑定の品は鑑定の一覧にだけ、ユニークの買い戻しの行", () => {
    const s = town({}, 150);
    s.progress.shopLevel = 2;
    const unid = createItemInstance(s, { itemId: "long_sword", identified: false, level: 3 });
    member(s, "c2").inventory.push(unid);
    const u = createItemInstance(s, { itemId: "long_sword", uniqueId: "shadowfolk_sword", rarity: "fine", identified: true });
    s.buyback.push(u);
    const m = townMenu(s, data)!.shop;
    // shopMinLevel ≤ 2 で鉄の小手（4）だけ並ばない。買値 = floor(price × (1 + 0.5 × 2)) = price × 2
    expect(m.equipment.map((e) => [e.itemId, e.name, e.level, e.price, e.affordable])).toEqual([
      ["dagger", "短剣 +2", 2, 30, true],
      ["long_sword", "長剣 +2", 2, 200, false],
      ["mace", "鎚矛 +2", 2, 120, true],
      ["short_bow", "短弓 +2", 2, 160, false],
      ["sling", "投石紐 +2", 2, 40, true],
      ["staff", "杖 +2", 2, 20, true],
      ["leather_armor", "革鎧 +2", 2, 100, true],
      ["chain_mail", "鎖帷子 +2", 2, 600, false],
      ["wooden_shield", "木の盾 +2", 2, 80, true],
      ["leather_cap", "革兜 +2", 2, 60, true],
      ["iron_helm", "鉄兜 +2", 2, 240, false],
      ["leather_gloves", "革小手 +2", 2, 60, true],
      ["charm", "護符 +2", 2, 400, false],
    ]);
    expect(m.sellable.find((x) => x.memberId === "c2")!.items).toEqual([]); // 未鑑定は売れない
    expect(m.identify).toEqual({ fee: 100, affordable: true, items: [{ memberId: "c2", memberName: "ベルク", instanceId: unid, name: "剣？" }] });
    expect(m.buyback).toEqual([{ instanceId: u, name: "上質な影法師の剣", price: 1200, affordable: false }]);
  });
});

describe("IT-60〜63 店の装備の購入・売却・買い戻し（town.shop。M7）", () => {
  const buy = (memberId: unknown, itemId: unknown): Command =>
    ({ type: "town.shop", action: { kind: "buy", memberId, itemId } }) as unknown as Command;
  const sell = (memberId: unknown, instanceId: unknown): Command =>
    ({ type: "town.shop", action: { kind: "sell", memberId, instanceId } }) as unknown as Command;
  const buyback = (memberId: unknown, instanceId: unknown): Command =>
    ({ type: "town.shop", action: { kind: "buyback", memberId, instanceId } }) as unknown as Command;
  /** memberId の inventory の末尾に実体を足して id を返す（s を書き換える） */
  function give(s: GameState, memberId: string, spec: Parameters<typeof createItemInstance>[1]): string {
    const id = createItemInstance(s, spec);
    member(s, memberId).inventory.push(id);
    return id;
  }

  test("IT-60 汎用装備の買値 = floor(price × (1 + 0.5 × Lv)): 長剣 Lv0 100・Lv1 150・Lv2 200・Lv5 350、短剣 Lv1 floor(22.5) = 22", () => {
    const sword = data.equipmentBases.find((b) => b.id === "long_sword")!;
    const dagger = data.equipmentBases.find((b) => b.id === "dagger")!;
    expect([0, 1, 2, 5].map((lv) => shopPrice(sword, lv, data))).toEqual([100, 150, 200, 350]);
    expect(shopPrice(dagger, 1, data)).toBe(22);
  });

  test("IT-61 売値: 汎用 floor(price × 0.5 × (1 + 0.5 × Lv)) + 正のオプションの段階ごと 20 / 40 / 80（負は 0）、ユニークは floor(price × 0.5) 固定、消耗品・魔法書は floor(price × 0.5)", () => {
    const s = town();
    const v = (spec: Parameters<typeof createItemInstance>[1]) => sellPrice(s.items[createItemInstance(s, spec)]!, data);
    // 長剣 100: Lv0 50、Lv1 75、Lv5 175。短剣 15 の Lv1 は floor(11.25) = 11
    expect([0, 1, 5].map((level) => v({ itemId: "long_sword", identified: true, level }))).toEqual([50, 75, 175]);
    expect(v({ itemId: "dagger", identified: true, level: 1 })).toBe(11);
    // オプション: 上質（段階 1 の +1）50 + 20、希少（段階 2 と 3）50 + 40 + 80、呪いの負は 0（通常の呪い 50、上質の呪い 50 + 20）
    expect(v({ itemId: "long_sword", identified: true, rarity: "fine", options: [{ optionId: "str", tier: 1, value: 1 }] })).toBe(70);
    expect(
      v({ itemId: "long_sword", identified: true, rarity: "rare", options: [{ optionId: "str", tier: 2, value: 2 }, { optionId: "hit", tier: 3, value: 15 }] }),
    ).toBe(170);
    expect(v({ itemId: "long_sword", identified: true, cursed: true, options: [{ optionId: "str", tier: 1, value: -1 }] })).toBe(50);
    expect(
      v({
        itemId: "long_sword",
        identified: true,
        rarity: "fine",
        cursed: true,
        options: [{ optionId: "str", tier: 1, value: 1 }, { optionId: "iq", tier: 1, value: -1 }],
      }),
    ).toBe(70);
    // ユニーク: 影法師の剣 1200 → 600。希少度・オプションに関わらない
    const opts = [{ optionId: "str", tier: 2 as const, value: 2 }, { optionId: "hit", tier: 2 as const, value: 10 }, { optionId: "agi", tier: 2 as const, value: 2 }];
    expect(v({ itemId: "long_sword", uniqueId: "shadowfolk_sword", identified: true, rarity: "legendary", options: opts })).toBe(600);
    // 消耗品・魔法書: 薬草 10 → 5、帰還の糸 50 → 25、雷光の魔法書 1500 → 750
    expect(["herb", "return_thread", "tome_lightning"].map((itemId) => v({ itemId, identified: true }))).toEqual([5, 25, 750]);
  });

  test("IT-62/IT-13 shopLevel 2 で長剣を買うと Lv2・通常・鑑定済み・オプションなし・foundIn null の実体が本人の inventory の末尾に入り、200G を払う。語りの item は表示名「長剣 +2」", () => {
    const s = town({}, 1000);
    s.progress.shopLevel = 2;
    const r = ok(s, buy("c2", "long_sword"));
    expect(r.events).toEqual([{ kind: "message", key: "town.shop.bought", params: { name: "ベルク", item: "長剣 +2", cost: 200 } }]);
    expect(r.state.gold).toBe(800);
    expect(member(r.state, "c2").inventory).toEqual(["i19"]);
    expect(r.state.items["i19"]).toEqual({
      id: "i19",
      itemId: "long_sword",
      level: 2,
      rarity: "normal",
      options: [],
      uniqueId: null,
      identified: true,
      cursed: false,
      foundIn: null,
    });
    expect(r.state.rng).toEqual(s.rng);
    expectStateInvariants(r.state);
    // shopMinLevel 2 の鎚矛は買え、4 の鉄の小手は not for sale。所持金ちょうど（鎚矛 Lv2 は 120G）なら 0 になる
    const exact = cloneState(s);
    exact.gold = 120;
    expect(ok(exact, buy("c1", "mace")).state.gold).toBe(0);
    expectRejected(s, buy("c1", "iron_gloves"), "not for sale");
    // shopLevel 0 では Lv0 で基本額
    const r0 = ok(town({}, 300), buy("c2", "long_sword"));
    expect(r0.state.items["i19"]!.level).toBe(0);
    expect(r0.events).toEqual([{ kind: "message", key: "town.shop.bought", params: { name: "ベルク", item: "長剣", cost: 100 } }]);
  });

  test("IT-61 sell: 本人の inventory の鑑定済みの汎用品を売ると実体が消え、売値を受け取って town.shop.sold{name, item, gold}。乱数なし・実体の番号は進まない。死んでいる者の品も売れる", () => {
    const s = town({ c2: DEAD }, 300);
    const id = give(s, "c2", { itemId: "long_sword", identified: true, level: 2 }); // i19。売値 floor(100 × 0.5 × 2) = 100
    const r = ok(s, sell("c2", id));
    expect(r.events).toEqual([{ kind: "message", key: "town.shop.sold", params: { name: "ベルク", item: "長剣 +2", gold: 100 } }]);
    expect(r.state.gold).toBe(400);
    expect(r.state.items[id]).toBeUndefined();
    expect(member(r.state, "c2").inventory).toEqual([]);
    expect(r.state.buyback).toEqual([]); // 汎用は買い戻しのストックに入らない（IT-63）
    expect(r.state.nextItemSeq).toBe(s.nextItemSeq);
    expect(r.state.rng).toEqual(s.rng);
    expectStateInvariants(r.state);
    // 消耗品（c1 の i4 薬草）は 5G。所持金 0 でも売れる
    const poor = cloneState(s);
    poor.gold = 0;
    const h = ok(poor, sell("c1", "i4"));
    expect(h.state.gold).toBe(5);
    expect(h.events).toEqual([{ kind: "message", key: "town.shop.sold", params: { name: "アルド", item: "薬草", gold: 5 } }]);
    // 鑑定済みの呪われた品（inventory にあれば）も売れる（負のオプションは 0 なので短剣 15 → 7）
    const c = cloneState(s);
    const cd = cursedDagger(c, true);
    member(c, "c1").inventory.push(cd);
    expect(ok(c, sell("c1", cd)).state.gold).toBe(307);
  });

  test("IT-63/IT-13 ユニークを売ると同じ実体が buyback の末尾へ（売った順）。uniques[].price で買い戻すと同じ実体（希少度・オプション・foundIn もそのまま）が本人の inventory の末尾へ戻り、ストックから外れる", () => {
    const s = town({}, 300);
    const sword = give(s, "c2", {
      itemId: "long_sword",
      uniqueId: "shadowfolk_sword",
      identified: true,
      rarity: "rare",
      options: [{ optionId: "str", tier: 2, value: 2 }, { optionId: "hit", tier: 2, value: 10 }],
      foundIn: "d01",
    });
    const helm = give(s, "c3", { itemId: "leather_cap", uniqueId: "alarm_bell_helm", identified: true });
    const original = structuredClone(s.items[sword]!);
    const r1 = ok(s, sell("c2", sword)); // 1200 × 0.5 = 600
    expect(r1.events).toEqual([{ kind: "message", key: "town.shop.sold", params: { name: "ベルク", item: "希少な影法師の剣", gold: 600 } }]);
    expect(r1.state.gold).toBe(900);
    expect(r1.state.items[sword]).toEqual(original);
    expect(member(r1.state, "c2").inventory).toEqual([]);
    const r2 = ok(r1.state, sell("c3", helm)); // 600 × 0.5 = 300
    expect(r2.state.gold).toBe(1200);
    expect(r2.state.buyback).toEqual([sword, helm]);
    expectStateInvariants(r2.state);
    // 買い戻し: 影法師の剣は 1200G。所持金ちょうどで 0 になる
    const r3 = ok(r2.state, buyback("c1", sword));
    expect(r3.events).toEqual([{ kind: "message", key: "town.shop.boughtBack", params: { name: "アルド", item: "希少な影法師の剣", cost: 1200 } }]);
    expect(r3.state.gold).toBe(0);
    expect(member(r3.state, "c1").inventory).toEqual([...member(r2.state, "c1").inventory, sword]);
    expect(r3.state.items[sword]).toEqual(original);
    expect(r3.state.items[sword]!.identified).toBe(true); // IT-13 買い戻した品は鑑定済み
    expect(r3.state.buyback).toEqual([helm]);
    expect(r3.state.nextItemSeq).toBe(s.nextItemSeq);
    expect(r3.state.rng).toEqual(s.rng);
    expectStateInvariants(r3.state);
  });

  test("IT-61/IT-63/TW-05 sell と buyback の理由と順: no such member → not alive（buyback だけ）→ item not in inventory / not in stock → not identified（sell）→ inventory full → not enough gold（buyback）", () => {
    const s = town({ c3: DEAD }, 599);
    const unid = give(s, "c1", { itemId: "long_sword", identified: false });
    const u = createItemInstance(s, { itemId: "leather_cap", uniqueId: "alarm_bell_helm", identified: true }); // 買い戻し 600G
    s.buyback.push(u);
    // sell
    expectRejected(s, sell("c9", "i4"), "no such member");
    expectRejected(s, sell("c2", "i4"), "item not in inventory"); // 他人の品
    expectRejected(s, sell("c1", "i1"), "item not in inventory"); // 装備中
    expectRejected(s, sell("c1", u), "item not in inventory"); // ストックの品
    expectRejected(s, sell("c1", "i999"), "item not in inventory");
    expectRejected(s, sell("c1", unid), "not identified");
    // buyback
    expectRejected(s, buyback("c9", u), "no such member");
    expectRejected(s, buyback("c3", u), "not alive");
    expectRejected(s, buyback("c1", "i4"), "not in stock");
    expectRejected(s, buyback("c1", "i999"), "not in stock");
    const full = cloneState(s);
    for (let i = 0; i < 3; i++) member(full, "c1").inventory.push(createItemInstance(full, { itemId: "herb", identified: true })); // 装備 3 + 5 = 8
    full.gold = 0;
    expectRejected(full, buyback("c1", u), "inventory full");
    expectRejected(s, buyback("c1", u), "not enough gold");
  });
});

describe("IT-65/IT-66 店の鑑定（town.shop identify。M7）", () => {
  const identify = (memberId: unknown, instanceId: unknown): Command =>
    ({ type: "town.shop", action: { kind: "identify", memberId, instanceId } }) as unknown as Command;
  /** memberId の inventory に未鑑定の品を足した state と、その実体 id */
  function withUnidentified(base: GameState, memberId: string, spec: Partial<Parameters<typeof createItemInstance>[1]> = {}) {
    const s = cloneState(base);
    const id = createItemInstance(s, { itemId: "long_sword", identified: false, level: 3, rarity: "rare", foundIn: "d01", ...spec });
    member(s, memberId).inventory.push(id);
    return { s, id };
  }

  test("IT-65 identifyFee（100G）を払って本人の未鑑定の品を鑑定: town.shop.identified{name, old, item, cost}。乱数なし。呪われていれば camp.identifiedCursed が続く", () => {
    const { s, id } = withUnidentified(town({}, 300), "c2");
    const r = ok(s, identify("c2", id));
    expect(r.state.gold).toBe(200);
    expect(r.state.items[id]!.identified).toBe(true);
    expect(r.events).toEqual([
      { kind: "message", key: "town.shop.identified", params: { name: "ベルク", old: "剣？", item: "希少な長剣 +3", cost: 100 } },
    ]);
    expect(r.state.rng).toEqual(s.rng);
    expect(r.state.uniqueBook).toEqual({});
    const c = withUnidentified(town({}, 300), "c2", { cursed: true, options: [{ optionId: "str", tier: 1, value: -1 }], rarity: "normal", level: 0 });
    const rc = ok(c.s, identify("c2", c.id));
    expect(rc.events).toEqual([
      { kind: "message", key: "town.shop.identified", params: { name: "ベルク", old: "剣？", item: "長剣", cost: 100 } },
      { kind: "message", key: "camp.identifiedCursed", params: { item: "長剣" } },
    ]);
  });

  test("IT-65/IT-66 ユニークを店で鑑定しても図鑑に記録する。死亡している者の品も鑑定できる（life を問わない）", () => {
    const { s, id } = withUnidentified(town({ c3: DEAD }, 300), "c3", { itemId: "leather_cap", uniqueId: "alarm_bell_helm", level: 0, rarity: "legendary", foundIn: "d02" });
    const r = ok(s, identify("c3", id));
    expect(r.events[0]).toEqual({ kind: "message", key: "town.shop.identified", params: { name: "キリ", old: data.equipmentBases.find((b) => b.id === "leather_cap")!.unidentifiedName, item: "伝説の早鐘の兜", cost: 100 } });
    expect(r.state.uniqueBook).toEqual({ alarm_bell_helm: { foundIn: "d02", bestRarity: "legendary" } });
  });

  test("IT-65/TW-05 理由と順: wrong screen → bad action → no such member → item not in inventory → already identified → not enough gold。所持金ちょうどなら 0 になる", () => {
    const { s, id } = withUnidentified(town({}, 99), "c1");
    const diveState = withUnidentified(diving({}, 300), "c1");
    expectRejected(diveState.s, identify("c1", diveState.id), "wrong screen");
    expectRejected(s, identify(1, id), "bad action");
    expectRejected(s, identify("c1", undefined), "bad action");
    expectRejected(s, identify("c9", id), "no such member");
    expectRejected(s, identify("c2", id), "item not in inventory"); // 他人の品
    expectRejected(s, identify("c1", "i1"), "item not in inventory"); // 装備中
    expectRejected(s, identify("c1", "i999"), "item not in inventory");
    expectRejected(s, identify("c1", "i4"), "already identified"); // 薬草（鑑定済み）
    expectRejected(s, identify("c1", id), "not enough gold");
    const rich = cloneState(s);
    rich.gold = 100;
    expect(ok(rich, identify("c1", id)).state.gold).toBe(0);
  });
});

describe("TW-16/IT-64 倉庫（town.storage。M7）", () => {
  const storage = (action: unknown, memberId: unknown, instanceId: unknown): Command =>
    ({ type: "town.storage", action, memberId, instanceId }) as unknown as Command;

  test("TW-16 deposit: 本人の inventory の品を warehouse の末尾へ移し town.storage.deposited{name, item}。実体はそのまま・乱数なし。死んでいる者の品・未鑑定の呪われた品も預けられる", () => {
    const s = town({ c2: DEAD });
    const cd = cursedDagger(s, false); // i19
    member(s, "c2").inventory.push(cd);
    const r1 = ok(s, storage("deposit", "c1", "i4"));
    expect(r1.events).toEqual([{ kind: "message", key: "town.storage.deposited", params: { name: "アルド", item: "薬草" } }]);
    expect(r1.state.warehouse).toEqual(["i4"]);
    expect(member(r1.state, "c1").inventory).toEqual([]);
    expect(r1.state.items).toEqual(s.items);
    expect(r1.state.rng).toEqual(s.rng);
    expect(r1.state.nextItemSeq).toBe(s.nextItemSeq);
    const r2 = ok(r1.state, storage("deposit", "c2", cd));
    expect(r2.events).toEqual([{ kind: "message", key: "town.storage.deposited", params: { name: "ベルク", item: "短い刃？" } }]);
    expect(r2.state.warehouse).toEqual(["i4", cd]);
    expect(r2.state.items[cd]).toEqual(s.items[cd]); // 未鑑定・呪いのまま
    expectStateInvariants(r2.state);
  });

  test("TW-16 withdraw: warehouse の品を本人の inventory の末尾へ移し town.storage.withdrawn{name, item}。預けた品は潜行・帰還をまたいで残る", () => {
    const s = ok(town(), storage("deposit", "c1", "i4")).state;
    const d = ok(s, { type: "dungeon.enter", dungeonId: "d01" }).state;
    expect(d.warehouse).toEqual(["i4"]);
    const ctx = ctxFor(d);
    returnToTown(ctx, "dungeon.exit");
    const back = ctx.state;
    expect(back.warehouse).toEqual(["i4"]);
    const r = ok(back, storage("withdraw", "c3", "i4"));
    expect(r.events).toEqual([{ kind: "message", key: "town.storage.withdrawn", params: { name: "キリ", item: "薬草" } }]);
    expect(r.state.warehouse).toEqual([]);
    expect(member(r.state, "c3").inventory).toEqual(["i10", "i4"]);
    expect(r.state.rng).toEqual(back.rng);
    expectStateInvariants(r.state);
  });

  test("TW-16 理由と順: wrong screen → bad action → no such member → item not in inventory / not in warehouse → warehouse full（40 個【仮】）/ inventory full（同じ参照・乱数不変）", () => {
    const s = ok(town(), storage("deposit", "c1", "i4")).state; // warehouse [i4]
    expectRejected(diving(), storage("deposit", "c1", "i4"), "wrong screen");
    expectRejected(createInitialState(1, data), storage("deposit", "c1", "i4"), "wrong screen");
    expectRejected(s, storage("lend", "c1", "i10"), "bad action");
    expectRejected(s, storage("deposit", 1, "i10"), "bad action");
    expectRejected(s, storage("withdraw", "c1", undefined), "bad action");
    expectRejected(s, storage("deposit", "c9", "i10"), "no such member");
    expectRejected(s, storage("deposit", "c1", "i10"), "item not in inventory"); // 他人の品
    expectRejected(s, storage("deposit", "c1", "i1"), "item not in inventory"); // 装備中
    expectRejected(s, storage("deposit", "c1", "i4"), "item not in inventory"); // 倉庫の品
    expectRejected(s, storage("deposit", "c1", "i999"), "item not in inventory");
    expectRejected(s, storage("withdraw", "c3", "i10"), "not in warehouse"); // 所持品
    expectRejected(s, storage("withdraw", "c3", "i999"), "not in warehouse");
    // 容量 40: 39 個なら預けられて 40 個になり、40 個なら warehouse full
    expect(data.config.items.warehouseSlots).toBe(40);
    const near = cloneState(s);
    for (let i = 0; i < 38; i++) near.warehouse.push(createItemInstance(near, { itemId: "herb", identified: true }));
    expect(near.warehouse).toHaveLength(39);
    const fullW = ok(near, storage("deposit", "c3", "i10")).state;
    expect(fullW.warehouse).toHaveLength(40);
    expectRejected(fullW, storage("deposit", "c4", "i13"), "warehouse full");
    // 所持枠: c1 は装備 3 + 5 = 8 で inventory full
    const fullI = cloneState(s);
    for (let i = 0; i < 5; i++) member(fullI, "c1").inventory.push(createItemInstance(fullI, { itemId: "herb", identified: true }));
    expectRejected(fullI, storage("withdraw", "c1", "i4"), "inventory full");
  });

  test("UI-52/TW-16 townMenu.storage: 容量・空き・倉庫の品（預けた順、表示名）・全員（life を問わない）の inventory と所持枠の空き", () => {
    const s = town({ c5: ASH });
    const unid = createItemInstance(s, { itemId: "long_sword", identified: false, level: 2 }); // i19
    s.warehouse.push("i19");
    member(s, "c1").inventory = member(s, "c1").inventory.filter((x) => x !== "i4");
    s.warehouse.push("i4");
    expect(unid).toBe("i19");
    expect(townMenu(s, data)!.storage).toEqual({
      capacity: 40,
      slotsFree: 38,
      items: [
        { instanceId: "i19", name: "剣？" },
        { instanceId: "i4", name: "薬草" },
      ],
      members: [
        { memberId: "c1", name: "アルド", slotsFree: 5, items: [] },
        { memberId: "c2", name: "ベルク", slotsFree: 6, items: [] },
        { memberId: "c3", name: "キリ", slotsFree: 4, items: [{ instanceId: "i10", name: "薬草" }] },
        { memberId: "c4", name: "ドナ", slotsFree: 5, items: [{ instanceId: "i13", name: "解毒草" }] },
        { memberId: "c5", name: "エル", slotsFree: 6, items: [{ instanceId: "i15", name: "帰還の糸" }] },
        { memberId: "c6", name: "フィン", slotsFree: 5, items: [{ instanceId: "i18", name: "薬草" }] },
      ],
    });
  });
});
