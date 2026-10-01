// 街（TW-02, TW-04, TW-05 の消耗品の購入, TW-07, TW-08, TW-11, TW-30〜32）。rules/town.ts と engine の town.* の配線。
// 既定のパーティ（newGame）: c1 アルド 戦士 HP 15（リーダー）、c2 ベルク 戦士 HP 16 vit 14、c3 キリ 盗賊 HP 10、
// c4 ドナ 僧侶 HP 12 MP 5、c5 エル 魔術師 HP 8 MP 7、c6 フィン 盗賊 HP 10。所持金 300。
// 宿のランク: 0 馬小屋 0G HP ×0、1 相部屋 20G HP ×0.5、2 個室 60G HP ×1.0（MP はどのランクでも全回復）。寺院: 蘇生 level × 100、
// 成功率 min(95, 50 + vit × 2)、治療 毒 50 / 麻痺 150 / 石化 300、解呪 200。闇魔術 level × 1000。
import { describe, expect, test } from "vitest";
import { createInitialState, execute } from "../src/core/engine";
import { createRng, randInt, type RngState } from "../src/core/rng";
import { checkEnter } from "../src/core/rules/dungeon";
import { arriveTown, mercyEligible, resurrectCostOf, returnToTown, townMenu } from "../src/core/rules/town";
import { cloneState, createItemInstance, makeContext } from "../src/core/state";
import type { Character, Command, GameEvent, GameState } from "../src/core/types";
import { ctxFor, data, expectKnownStringKeys, loadFreshData, loadRuleData, newGame, seedWithFirstD100 } from "./helpers/core";

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

  test("TW-04/MG-02 相部屋（20G、HP ×0.5）と個室（60G、HP ×1.0）: 料金を 1 回払い、HP は ceil(hpMax × hpRatio) 増えて hpMax で止まり、MP は全回復", () => {
    const s = town({ c1: { hp: 1 }, c4: { mp: 0 } });
    const a = ok(s, { type: "town.inn", rank: 1 });
    // c1 +ceil(7.5)=8 → 9、c4 MP 0 → 5（ランクに関わらず mpMax）
    expect(a.state.gold).toBe(280);
    expect(member(a.state, "c1").hp).toBe(9);
    expect(member(a.state, "c4").mp).toBe(5);
    const b = ok(s, { type: "town.inn", rank: 2 });
    expect(b.state.gold).toBe(240);
    expect(member(b.state, "c1").hp).toBe(15);
    expect(member(b.state, "c4").mp).toBe(5);
  });

  test("TW-04 満タンでも泊まれる（料金を払い、回復のイベントは出ない）", () => {
    const s = town();
    const r = ok(s, { type: "town.inn", rank: 2 });
    expect(r.events).toEqual([{ kind: "message", key: "town.inn.stay", params: { room: "個室", cost: 60 } }]);
    expect(r.state.gold).toBe(240);
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

  test("TW-07 蘇生の失敗: 成否に関わらず払い、d100 > 78 で ash", () => {
    const { seed } = seedWithFirstD100((x) => x > 78);
    const s = town({ c2: { ...DEAD, mp: 0, san: 30, status: ["poison"] } });
    s.rng = createRng(seed);
    const r = ok(s, { type: "town.temple", memberId: "c2", service: "resurrect" });
    expect(r.events).toEqual([
      { kind: "message", key: "town.temple.resurrectRoll", params: { name: "ベルク" } },
      { kind: "lifeChanged", id: "c2", life: "ash" },
      { kind: "message", key: "town.temple.resurrectFail", params: { name: "ベルク" } },
    ]);
    expect(r.state.gold).toBe(200);
    expect(member(r.state, "c2")).toMatchObject({ life: "ash", hp: 0, san: 30, status: ["poison"] });
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
    const inst = createItemInstance(s, "cursed_dagger", true);
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
        { kind: "message", key: "town.temple.uncursed", params: { name: "ベルク", item: "血濡れの短剣" } },
      ]);
      expect(r.state.gold).toBe(100);
      expect(r.state.items[inst]).toBeUndefined();
      expect(member(r.state, "c2").equipment.weapon).toBeNull();
      expect(member(r.state, "c2").inventory).toEqual(["i5"]);
    }
  });

  test("TW-07 解呪の rejected: 呪われた品を装備していない（inventory にあるだけでも）、所持金不足", () => {
    expectRejected(town(), { type: "town.temple", memberId: "c2", service: "uncurse" }, "nothing cursed");
    const s = town();
    member(s, "c2").inventory.push(createItemInstance(s, "cursed_dagger", true));
    expectRejected(s, { type: "town.temple", memberId: "c2", service: "uncurse" }, "nothing cursed");
    expectRejected(withCursed(town({}, 199)).s, { type: "town.temple", memberId: "c2", service: "uncurse" }, "not enough gold");
  });

});

// ---------------------------------------------------------------------------

describe("TW-08 闇魔術（town.dark）", () => {
  test("TW-08 ash の者が level × 1000 を払って alive・HP 1 に戻る（確定。乱数なし）。status・MP・SAN はそのまま", () => {
    // ベルク L2 → 2 × 1000 = 2000。所持金 2500 → 500
    const s = town(
      { c2: { ...ASH, level: 2, levelHistory: [{ level: 2, hpGain: 5, mpGain: 0 }], hpMax: 19, mp: 0, san: 30, status: ["poison"] } },
      2500,
    );
    const r = ok(s, { type: "town.dark", memberId: "c2" });
    expect(r.events).toEqual([
      { kind: "lifeChanged", id: "c2", life: "alive" },
      { kind: "hpChanged", id: "c2", delta: 1, hp: 1 },
      { kind: "message", key: "town.dark.done", params: { name: "ベルク" } },
    ]);
    expect(r.state.gold).toBe(500);
    expect(member(r.state, "c2")).toMatchObject({ life: "alive", hp: 1, hpMax: 19, mp: 0, san: 30, status: ["poison"], level: 2 });
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
      const inst = createItemInstance(base, "cursed_dagger", true);
      member(base, "c4").inventory.push(member(base, "c4").equipment.weapon!);
      member(base, "c4").equipment.weapon = inst;
      return { s: base };
    })();
    const m = townMenu(s, data)!;
    expect(m.gold).toBe(200);
    expect(m.inn).toEqual([
      { rank: 0, id: "stable", name: "馬小屋", cost: 0, affordable: true },
      { rank: 1, id: "cheap", name: "相部屋", cost: 20, affordable: true },
      { rank: 2, id: "good", name: "個室", cost: 60, affordable: true },
    ]);
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
    expect(r.state.items["i19"]).toEqual({ id: "i19", itemId: "herb", identified: true });
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
    for (let i = 0; i < 5; i++) c2.inventory.push(createItemInstance(s, "herb", true)); // 装備 2 + 5 = 7
    const r = ok(s, buy("c2", "herb"));
    expect(member(r.state, "c2").inventory).toHaveLength(6);
    expectRejected(r.state, buy("c2", "herb"), "inventory full");
    const poor = cloneState(r.state);
    poor.gold = 0;
    expectRejected(poor, buy("c2", "herb"), "inventory full");
  });

  test("TW-05 rejected の理由と順: wrong screen → bad action → not implemented → not for sale → no such member → not alive → inventory full → not enough gold（同じ参照・乱数不変）", () => {
    const s = town({ c2: DEAD, c3: ASH }, 5);
    expectRejected(diving(), buy("c1", "herb"), "wrong screen");
    expectRejected(createInitialState(1, data), buy("c1", "herb"), "wrong screen");
    expectRejected(s, { type: "town.shop" } as unknown as Command, "bad action");
    expectRejected(s, { type: "town.shop", action: "buy" } as unknown as Command, "bad action");
    expectRejected(s, { type: "town.shop", action: { kind: "steal", memberId: "c1", itemId: "herb" } } as unknown as Command, "bad action");
    expectRejected(s, buy(1, "herb"), "bad action");
    expectRejected(s, buy("c1", null), "bad action");
    expectRejected(s, { type: "town.shop", action: { kind: "sell", memberId: "c1", instanceId: "i4" } }, "not implemented");
    expectRejected(s, { type: "town.shop", action: { kind: "identify", memberId: "c1", instanceId: "i4" } }, "not implemented");
    // 売り物は consumable かつ infinite の品だけ（装備・魔法書・未知の id は売らない）。メンバーより先に判定
    for (const itemId of ["long_sword", "tome_lightning", "cursed_dagger", "nope"]) {
      expectRejected(s, buy("c1", itemId), "not for sale");
    }
    expectRejected(s, buy("c9", "long_sword"), "not for sale");
    expectRejected(s, buy("c9", "herb"), "no such member");
    expectRejected(s, buy("c2", "herb"), "not alive");
    expectRejected(s, buy("c3", "herb"), "not alive");
    expectRejected(s, buy("c1", "herb"), "not enough gold");
  });

  test("TW-05/TW-32 救済の申し出の間も店は使え、申し出は下りない", () => {
    const ctx = ctxFor(diving({ c2: DEAD, c3: DEAD, c4: DEAD, c5: DEAD, c6: DEAD }, 99));
    returnToTown(ctx, "dungeon.exit");
    expect(ctx.state.townVisit).toEqual({ mercyOffered: true });
    const r = ok(ctx.state, buy("c1", "herb"));
    expect(r.state.gold).toBe(89);
    expect(r.state.townVisit).toEqual({ mercyOffered: true });
  });

  test("UI-52/TW-05 townMenu.shop: 売り物（items.json の順、affordable = 所持金 ≥ price）と、持たせる候補（alive の者、slotsFree）", () => {
    expect(townMenu(town(), data)!.shop).toEqual({
      items: [
        { itemId: "herb", name: "薬草", price: 10, affordable: true },
        { itemId: "antidote_herb", name: "解毒草", price: 15, affordable: true },
        { itemId: "return_thread", name: "帰還の糸", price: 50, affordable: true },
      ],
      members: [
        { memberId: "c1", name: "アルド", slotsFree: 4 },
        { memberId: "c2", name: "ベルク", slotsFree: 6 },
        { memberId: "c3", name: "キリ", slotsFree: 4 },
        { memberId: "c4", name: "ドナ", slotsFree: 5 },
        { memberId: "c5", name: "エル", slotsFree: 6 },
        { memberId: "c6", name: "フィン", slotsFree: 5 },
      ],
    });
    const m = townMenu(town({ c2: DEAD, c5: ASH }, 15), data)!.shop;
    expect(m.items.map((i) => i.affordable)).toEqual([true, true, false]);
    expect(m.members.map((x) => x.memberId)).toEqual(["c1", "c3", "c4", "c6"]);
  });
});
