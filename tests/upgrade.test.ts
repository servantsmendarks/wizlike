// 闇魔術の強化（TW-17 / IT-70。M7 の C）。rules/upgrade.ts と engine の town.upgrade の配線、townMenu.upgrade。
// 既定のパーティ（newGame）: c1 アルド（武器 長剣・防具 革鎧・盾 木の盾、所持品 薬草）、c2 ベルク（長剣・鎖帷子）。所持金は town() で決める。
// config.economy: upgradeBase 50・upgradeRateBase 10・upgradeRatePerCatalyst 30・upgradeDecay 0.66・upgradeMaxCatalysts 3【仮】。
// 出目は seedWithFirstD100 で「最初の randInt(1, 100) がその値になる種」を探して state.rng に入れる（鏡の rng で同じ 1 回を引いて比べる）。
import { describe, expect, test } from "vitest";
import { execute } from "../src/core/engine";
import { createRng, randInt } from "../src/core/rng";
import { townMenu } from "../src/core/rules/town";
import { checkUpgrade, upgradeFee, upgradeGreat, upgradePreview, upgradeRate } from "../src/core/rules/upgrade";
import { cloneState, createItemInstance } from "../src/core/state";
import type { Character, Command, GameEvent, GameState, ItemInstance } from "../src/core/types";
import { data, expectKnownStringKeys, expectStateInvariants, loadFreshData, newGame, seedWithFirstD100 } from "./helpers/core";

const E = data.config.economy;

function member(s: GameState, id: string): Character {
  const c = s.party.find((x) => x.id === id);
  if (c === undefined) throw new Error(`no member ${id}`);
  return c;
}

/** newGame(1) の複製。所持金 gold、c1 の武器（長剣）の Lv を weaponLv にする */
function town(gold = 1000, weaponLv = 0): GameState {
  const s = cloneState(newGame(1));
  s.gold = gold;
  weaponOf(s, "c1").level = weaponLv;
  return s;
}

function weaponOf(s: GameState, id: string): ItemInstance {
  const wid = member(s, id).equipment.weapon;
  if (wid === null) throw new Error("no weapon");
  return s.items[wid]!;
}

/** 本人の inventory の末尾に実体を足して id を返す（既定は鑑定済みの汎用装備） */
function give(s: GameState, id: string, spec: Partial<ItemInstance> & { itemId: string }): string {
  const iid = createItemInstance(s, { identified: true, ...spec });
  member(s, id).inventory.push(iid);
  return iid;
}

/** 最初の d100 が roll になる種の rng を入れる */
function withFirstRoll(s: GameState, roll: number): void {
  s.rng = createRng(seedWithFirstD100((r) => r === roll).seed);
}

function ok(s: GameState, cmd: Command): { state: GameState; events: GameEvent[] } {
  const r = execute(s, cmd, data);
  const rej = r.events.find((e) => e.kind === "rejected");
  if (rej !== undefined) throw new Error(`rejected: ${JSON.stringify(rej)}`);
  expectKnownStringKeys(r.events);
  expectStateInvariants(r.state);
  return r;
}

function expectRejected(s: GameState, cmd: Command, reason: string): void {
  const rng = structuredClone(s.rng);
  const r = execute(s, cmd, data);
  expect(r.state).toBe(s);
  expect(r.events).toEqual([{ kind: "rejected", command: cmd.type, reason }]);
  expect(s.rng).toEqual(rng);
}

const up = (catalysts: string[], memberId = "c1", slot = "weapon"): Command =>
  ({ type: "town.upgrade", memberId, slot, catalysts }) as Command;

// ---------------------------------------------------------------------------

describe("TW-17 成功率・大成功・料金の式", () => {
  test("TW-17 成功率 p = min(100, floor(10 + Σ 30 × 0.66^max(0, 対象Lv − 触媒Lv)))", () => {
    expect(upgradeRate(0, [], E)).toBe(10); // 触媒なし
    expect(upgradeRate(0, [0], E)).toBe(40); // 同 Lv 1 個: 10 + 30
    expect(upgradeRate(3, [3, 3], E)).toBe(70); // 同 Lv 2 個
    expect(upgradeRate(0, [0, 0, 0], E)).toBe(100); // 同 Lv 3 個: 10 + 90
    expect(upgradeRate(1, [0], E)).toBe(29); // Lv 差 1: 10 + 19.8 = 29.8 → 29
    expect(upgradeRate(1, [0, 0], E)).toBe(49); // 10 + 39.6 = 49.6 → 49（合計してから floor）
    expect(upgradeRate(2, [0], E)).toBe(23); // Lv 差 2: 30 × 0.4356 = 13.068 → 23.068 → 23
    expect(upgradeRate(3, [0, 0, 0], E)).toBe(35); // 30 × 0.287496 × 3 = 25.87464 → 35.87 → 35
    expect(upgradeRate(0, [5], E)).toBe(40); // 触媒の方が高い Lv は減衰しない（max(0, …)）
    expect(upgradeRate(4, [4, 3, 0], E)).toBe(65); // 30 + 19.8 + 30 × 0.18974736 = 5.69… → 65.49 → 65
  });

  test("TW-17 成功率の上限は 100（触媒 1 個 50% の config で 2 個 → 110 → 100）", () => {
    const d = loadFreshData();
    d.config.economy.upgradeRatePerCatalyst = 50;
    expect(upgradeRate(0, [0, 0], d.config.economy)).toBe(100);
    expect(upgradeRate(0, [0], d.config.economy)).toBe(60);
  });

  test("TW-17 大成功の率 q = max(1, floor(p ÷ 10))", () => {
    expect(upgradeGreat(5)).toBe(1);
    expect(upgradeGreat(10)).toBe(1);
    expect(upgradeGreat(19)).toBe(1);
    expect(upgradeGreat(20)).toBe(2);
    expect(upgradeGreat(49)).toBe(4);
    expect(upgradeGreat(100)).toBe(10);
  });

  test("TW-17 料金 = 50 × (対象Lv + 1)", () => {
    expect(upgradeFee(0, E)).toBe(50);
    expect(upgradeFee(2, E)).toBe(150);
    expect(upgradeFee(9, E)).toBe(500);
  });
});

describe("TW-17 town.upgrade の判定と処理", () => {
  /** c1 の長剣 Lv2、触媒に同 Lv の長剣 1 個 → p 40・q 4、料金 150 */
  function lv2With1(roll: number): { s: GameState; cat: string } {
    const s = town(1000, 2);
    const cat = give(s, "c1", { itemId: "long_sword", level: 2 });
    withFirstRoll(s, roll);
    return { s, cat };
  }

  test("TW-17 出目 r ≤ q で大成功（Lv +2）。払う → 触媒が消える → dice → message。乱数は d100 の 1 回（鏡の rng）", () => {
    const { s, cat } = lv2With1(4);
    const mirror = structuredClone(s.rng);
    expect(randInt(mirror, 1, 100)).toBe(4);
    const r = ok(s, up([cat]));
    expect(r.events).toEqual([
      {
        kind: "dice",
        label: { key: "dice.upgrade", params: { item: "長剣 +2" } },
        rows: [{ label: { key: "dice.row.roll" }, base: null, dice: [4], total: 4 }],
        rule: { key: "dice.upgrade.rule", params: { rate: 40, great: 4 } },
        result: { key: "dice.upgrade.great" },
      },
      { kind: "message", key: "town.upgrade.great", params: { name: "アルド", item: "長剣 +4" } },
    ]);
    expect(weaponOf(r.state, "c1").level).toBe(4);
    expect(r.state.gold).toBe(1000 - 150);
    expect(r.state.items[cat]).toBeUndefined();
    expect(member(r.state, "c1").inventory).not.toContain(cat);
    expect(r.state.rng).toEqual(mirror);
    expect(weaponOf(s, "c1").level).toBe(2); // 引数の state は変えない
  });

  test("TW-17 出目の境界: r = q+1 と r = p で成功（Lv +1）、r = p+1 で失敗（Lv −1）", () => {
    const cases: [number, string, number][] = [
      [5, "ok", 3],
      [40, "ok", 3],
      [41, "ng", 1],
    ];
    for (const [roll, outcome, lv] of cases) {
      const { s, cat } = lv2With1(roll);
      const r = ok(s, up([cat]));
      const dice = r.events[0];
      expect(dice?.kind === "dice" && dice.result.key).toBe(`dice.upgrade.${outcome}`);
      expect(weaponOf(r.state, "c1").level).toBe(lv);
      expect(r.events[1]).toEqual({ kind: "message", key: `town.upgrade.${outcome}`, params: { name: "アルド", item: `長剣 +${lv}` } });
      expect(r.state.items[cat]).toBeUndefined(); // 成否に関わらず消える
    }
  });

  test("TW-17 強化の Lv に上限はない（Lv20 が触媒なし・p 10・q 1・出目 1 で大成功 → Lv22、料金 50 × 21 = 1050）", () => {
    const s = town(2000, 20);
    withFirstRoll(s, 1);
    const mirror = structuredClone(s.rng);
    expect(randInt(mirror, 1, 100)).toBe(1);
    const r = ok(s, up([]));
    const d = r.events[0];
    expect(d?.kind === "dice" && d.rule.params).toEqual({ rate: 10, great: 1 });
    expect(d?.kind === "dice" && d.result.key).toBe("dice.upgrade.great");
    expect(weaponOf(r.state, "c1").level).toBe(22);
    expect(r.state.gold).toBe(2000 - 1050);
    expect(r.state.rng).toEqual(mirror);
  });

  test("TW-17 Lv0 で失敗しても 0 のまま。触媒なしでも料金（50）は取る（p 10・q 1、出目 11）", () => {
    const s = town(1000, 0);
    withFirstRoll(s, 11);
    const r = ok(s, up([]));
    expect(weaponOf(r.state, "c1").level).toBe(0);
    expect(r.state.gold).toBe(950);
    expect(r.events).toEqual([
      {
        kind: "dice",
        label: { key: "dice.upgrade", params: { item: "長剣" } },
        rows: [{ label: { key: "dice.row.roll" }, base: null, dice: [11], total: 11 }],
        rule: { key: "dice.upgrade.rule", params: { rate: 10, great: 1 } },
        result: { key: "dice.upgrade.ng" },
      },
      { kind: "message", key: "town.upgrade.ng", params: { name: "アルド", item: "長剣" } },
    ]);
  });

  test("TW-17 判定は表示している整数の成功率と比べる（p 29.8 → 29: 出目 29 は成功、30 は失敗）", () => {
    for (const [roll, lv] of [
      [29, 2],
      [30, 0],
    ] as const) {
      const s = town(1000, 1);
      const cat = give(s, "c1", { itemId: "dagger", level: 0 });
      withFirstRoll(s, roll);
      const r = ok(s, up([cat]));
      const d = r.events[0];
      expect(d?.kind === "dice" && d.rule.params).toEqual({ rate: 29, great: 2 });
      expect(weaponOf(r.state, "c1").level).toBe(lv);
    }
  });

  test("TW-17 オプション・希少度・呪い・鑑定は対象のまま。触媒のオプション・希少度は引き継がない。触媒は並びの順に消え、呪われた触媒も使える", () => {
    const s = town(1000, 1);
    const w = weaponOf(s, "c1");
    w.rarity = "fine";
    w.cursed = true;
    w.options = [{ optionId: "str", tier: 1, value: 1 }];
    const a = give(s, "c1", { itemId: "long_sword", level: 3, rarity: "legendary", options: [{ optionId: "agi", tier: 3, value: 3 }] });
    const b = give(s, "c1", { itemId: "dagger", level: 0, cursed: true, options: [{ optionId: "luk", tier: 1, value: -1 }] });
    withFirstRoll(s, 1);
    const r = ok(s, up([b, a]));
    const after = weaponOf(r.state, "c1");
    expect(after).toEqual({ ...w, level: 3 }); // p = floor(10 + 30 + 19.8) = 59、q 5、出目 1 で大成功
    expect(r.state.items[a]).toBeUndefined();
    expect(r.state.items[b]).toBeUndefined();
    expect(member(r.state, "c1").inventory).toEqual(member(s, "c1").inventory.filter((x) => x !== a && x !== b));
  });

  test("TW-17 本人の life は問わない（死亡・灰の者の装備も鍛えられる）", () => {
    const s = town(1000, 0);
    const c2 = member(s, "c2");
    c2.life = "ash";
    c2.hp = 0;
    withFirstRoll(s, 1);
    const r = ok(s, up([], "c2"));
    expect(weaponOf(r.state, "c2").level).toBe(2);
  });

  test("TW-17 拒否の理由と判定順（wrong screen → bad action → no such member → bad slot → slot empty → unique → bad catalyst → not enough gold）。拒否では乱数を引かない", () => {
    const s = town(149, 2); // Lv2 の料金 150 に 1 足りない
    const good = give(s, "c1", { itemId: "long_sword", level: 0 });
    const unid = give(s, "c1", { itemId: "dagger", identified: false });
    const uniq = give(s, "c1", { itemId: "dagger", uniqueId: "twin_tongue_dagger" });
    const others = give(s, "c2", { itemId: "dagger" });
    const herb = member(s, "c1").inventory[0]!; // 薬草（消耗品）
    const target = member(s, "c1").equipment.weapon!;
    // wrong screen（迷宮の中）
    const diving = cloneState(execute(newGame(1), { type: "dungeon.enter", dungeonId: "d01" }, data).state);
    expectRejected(diving, up([]), "wrong screen");
    // bad action: 配列でない・文字列でない・多すぎる・重複。no such member より先
    expectRejected(s, up("x" as unknown as string[]), "bad action");
    expectRejected(s, up([1 as unknown as string]), "bad action");
    expectRejected(s, up(["a", "b", "c", "d"], "c9"), "bad action");
    expectRejected(s, up([good, good]), "bad action");
    expectRejected(s, up([], "c9"), "no such member");
    expectRejected(s, up([], 3 as unknown as string), "no such member");
    expectRejected(s, up([], "c1", "foo"), "bad slot");
    expectRejected(s, up([], "c1", "helm"), "slot empty");
    // unique（対象がユニーク）
    const su = cloneState(s);
    su.items[target]!.uniqueId = "shadowfolk_sword";
    expectRejected(su, up([]), "unique");
    // bad catalyst: 未鑑定・ユニーク・他人の品・消耗品・装備中の品（対象そのもの）・存在しない id。not enough gold より先
    for (const id of [unid, uniq, others, herb, target, "i999"]) expectRejected(s, up([id]), "bad catalyst");
    expectRejected(s, up([good]), "not enough gold");
    const rich = cloneState(s);
    rich.gold = 150;
    expect(checkUpgrade(rich, "c1", "weapon", [good], data)).toBeNull();
  });
});

describe("TW-17 upgradePreview と townMenu.upgrade（表示層向けの問い合わせ）", () => {
  test("TW-17 upgradePreview は town.upgrade の dice の rate / great と料金に一致し、block は checkUpgrade と同じ", () => {
    const s = town(1000, 4);
    const cats = [give(s, "c1", { itemId: "long_sword", level: 4 }), give(s, "c1", { itemId: "dagger", level: 3 }), give(s, "c1", { itemId: "dagger", level: 0 })];
    const p = upgradePreview(s, data, "c1", "weapon", cats);
    expect(p).toEqual({ rate: 65, great: 6, fee: 250, affordable: true, block: null });
    withFirstRoll(s, 50);
    const r = ok(s, up(cats));
    const d = r.events[0];
    expect(d?.kind === "dice" && d.rule.params).toEqual({ rate: p!.rate, great: p!.great });
    expect(s.gold - r.state.gold).toBe(p!.fee);
  });

  test("TW-17 upgradePreview: 払えなければ affordable 偽・block not enough gold、触媒が不正なら block bad catalyst、対象が決まらなければ null", () => {
    const s = town(100, 2);
    const unid = give(s, "c1", { itemId: "dagger", identified: false });
    expect(upgradePreview(s, data, "c1", "weapon", [])).toEqual({ rate: 10, great: 1, fee: 150, affordable: false, block: "not enough gold" });
    expect(upgradePreview(s, data, "c1", "weapon", [unid])).toEqual({ rate: 10, great: 1, fee: 150, affordable: false, block: "bad catalyst" });
    expect(upgradePreview(s, data, "c1", "helm", [])).toBeNull();
    expect(upgradePreview(s, data, "c9", "weapon", [])).toBeNull();
  });

  test("TW-17 townMenu.upgrade: 全員の部位（EQUIP_SLOTS の順。空き・ユニークは block）と触媒の候補（鑑定済みの汎用装備だけ、inventory の順）", () => {
    const s = town(1000, 3);
    const a = give(s, "c1", { itemId: "dagger", level: 1 });
    give(s, "c1", { itemId: "dagger", identified: false });
    give(s, "c1", { itemId: "dagger", uniqueId: "twin_tongue_dagger" });
    const m = townMenu(s, data)!.upgrade;
    expect(m.maxCatalysts).toBe(3);
    expect(m.members.map((x) => x.memberId)).toEqual(["c1", "c2", "c3", "c4", "c5", "c6"]);
    const c1 = m.members[0]!;
    expect(c1.canUpgrade).toBe(true);
    expect(c1.slots.map((x) => [x.slot, x.name, x.level, x.block])).toEqual([
      ["weapon", "長剣 +3", 3, null],
      ["armor", "革鎧", 0, null],
      ["shield", "木の盾", 0, null],
      ["helm", null, 0, "slot empty"],
      ["gauntlet", null, 0, "slot empty"],
      ["accessory", null, 0, "slot empty"],
    ]);
    expect(c1.catalysts).toEqual([{ instanceId: a, name: "短剣 +1", level: 1 }]);
    // ユニークだけを装備した者は canUpgrade 偽
    const s2 = cloneState(s);
    const c5 = member(s2, "c5"); // 魔術師（杖だけ）
    s2.items[c5.equipment.weapon!]!.uniqueId = "dawn_flint_staff";
    expect(townMenu(s2, data)!.upgrade.members[4]!.canUpgrade).toBe(false);
  });
});
