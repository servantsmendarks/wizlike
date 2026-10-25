// 闇魔術の強化（TW-17 / IT-70。M7 の C）。rules/upgrade.ts と engine の town.upgrade の配線、townMenu.upgrade。
// M16（G-2）: 触媒は {memberId, instanceId} の組でパーティ全員の inventory から。up() は文字列を c1 の品の組に読み替える。
// 既定のパーティ（newGame）: c1 アルド（武器 長剣・防具 革鎧・盾 木の盾、所持品 薬草）、c2 ベルク（長剣・鎖帷子）。所持金は town() で決める。
// config.economy: upgradeFeePerLevel 50（M21 B-1。それまでは upgradeBase 50）・upgradeRateBase 10・upgradeRatePerCatalyst 30・upgradeDecay 0.66・upgradeMaxCatalysts 3【仮】。
// 出目は seedWithFirstD100 で「最初の randInt(1, 100) がその値になる種」を探して state.rng に入れる（鏡の rng で同じ 1 回を引いて比べる）。
import { describe, expect, test } from "vitest";
import { execute } from "../src/core/engine";
import { createRng, randInt } from "../src/core/rng";
import { townMenu } from "../src/core/rules/town";
import { shopItemPreview } from "../src/core/rules/shop";
import { checkUpgrade, upgradeFee, upgradeGreat, upgradePreview, upgradeRate, upgradeResultLevel } from "../src/core/rules/upgrade";
import { cloneState, createItemInstance, destroyItemInstance } from "../src/core/state";
import type { Character, Command, GameEvent, GameState, ItemInstance, UpgradeCatalystRef } from "../src/core/types";
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

/** 触媒の指定（持ち主と実体）。既定の持ち主は c1 */
const ref = (instanceId: string, memberId = "c1"): UpgradeCatalystRef => ({ memberId, instanceId });
const refs = (ids: string[], memberId = "c1"): UpgradeCatalystRef[] => ids.map((id) => ref(id, memberId));

/** catalysts の文字列は c1 の品の組に読み替える（配列でない・文字列でも組でもない要素はそのまま。bad action の検査用） */
const up = (catalysts: unknown, memberId = "c1", slot = "weapon"): Command =>
  ({
    type: "town.upgrade",
    memberId,
    slot,
    catalysts: Array.isArray(catalysts) ? catalysts.map((x: unknown) => (typeof x === "string" ? ref(x) : x)) : catalysts,
  }) as unknown as Command;

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

  test("TW-17 M21（B-1）料金 = 50 × 結果の Lv（触媒が無ければ対象Lv + 1 なので M20 までの 50 × (対象Lv + 1) と同じ額）", () => {
    expect(upgradeFee(1, E)).toBe(50);
    expect(upgradeFee(3, E)).toBe(150);
    expect(upgradeFee(10, E)).toBe(500);
    expect(upgradeFee(upgradeResultLevel(0, []), E)).toBe(50);
    expect(upgradeFee(upgradeResultLevel(0, [5]), E)).toBe(250);
  });

  test("TW-17 M21（B-1）結果の Lv = max(対象Lv + 1, 触媒の Lv の最小値)。触媒が無ければ対象Lv + 1", () => {
    expect(upgradeResultLevel(0, [])).toBe(1);
    expect(upgradeResultLevel(4, [])).toBe(5);
    expect(upgradeResultLevel(0, [5])).toBe(5);
    expect(upgradeResultLevel(0, [5, 3, 7])).toBe(3); // 最小値
    expect(upgradeResultLevel(2, [5, 3])).toBe(3); // = 対象 + 1
    expect(upgradeResultLevel(2, [5, 0])).toBe(3); // 最小値が対象以下なら対象 + 1
    expect(upgradeResultLevel(6, [2, 2, 2])).toBe(7);
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

  // M16（4-5）: Lv0 の失敗の語りは ng ではなく ngFloor「鍛えそこねた。+0 なのでこれ以上は鈍らない。」（判定の箱の結果は ng のまま）
  test("TW-17 Lv0 で失敗しても 0 のまま、語りは town.upgrade.ngFloor。触媒なしでも料金（50）は取る（p 10・q 1、出目 11）", () => {
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
      { kind: "message", key: "town.upgrade.ngFloor", params: { name: "アルド", item: "長剣" } },
    ]);
  });

  test("TW-17 M16 ngFloor は強化前が Lv0 の失敗だけ（Lv1 の失敗で Lv0 になるときは今の ng。Lv0 の成功は ok）", () => {
    const msg = (lv: number, roll: number): GameEvent | undefined => {
      const s = town(1000, lv);
      withFirstRoll(s, roll);
      return ok(s, up([])).events[1];
    };
    expect(msg(1, 11)).toEqual({ kind: "message", key: "town.upgrade.ng", params: { name: "アルド", item: "長剣" } });
    expect(msg(0, 2)).toEqual({ kind: "message", key: "town.upgrade.ok", params: { name: "アルド", item: "長剣 +1" } });
    expect(msg(0, 100)).toMatchObject({ key: "town.upgrade.ngFloor" });
    expect(data.strings["town.upgrade.ngFloor"]).toBe("鍛えそこねた。+0 なのでこれ以上は鈍らない。");
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
    // bad action: 配列でない・組でない（数・文字列だけの組・欄の欠け）・多すぎる・重複（持ち主が違っても同じ実体）。no such member より先
    expectRejected(s, up("x"), "bad action");
    expectRejected(s, up([1]), "bad action");
    expectRejected(s, up([{ memberId: "c1" }]), "bad action");
    expectRejected(s, up([{ memberId: 1, instanceId: good }]), "bad action");
    expectRejected(s, up([null]), "bad action");
    // M15 までの形（実体の id の文字列の配列）は組でないので拒む（up() の読み替えを通さずに送る）
    expectRejected(s, { type: "town.upgrade", memberId: "c1", slot: "weapon", catalysts: [good] } as unknown as Command, "bad action");
    expectRejected(s, up(["a", "b", "c", "d"], "c9"), "bad action");
    expectRejected(s, up([good, good]), "bad action");
    expectRejected(s, up([ref(good), ref(good, "c2")]), "bad action");
    expectRejected(s, up([], "c9"), "no such member");
    expectRejected(s, up([], 3 as unknown as string), "no such member");
    expectRejected(s, up([], "c1", "foo"), "bad slot");
    expectRejected(s, up([], "c1", "helm"), "slot empty");
    // unique（対象がユニーク）
    const su = cloneState(s);
    su.items[target]!.uniqueId = "shadowfolk_sword";
    expectRejected(su, up([]), "unique");
    // bad catalyst: 未鑑定・ユニーク・持ち主の違う指定（c2 の品を c1 の品として）・消耗品・装備中の品（対象そのもの）・存在しない id。not enough gold より先
    for (const id of [unid, uniq, others, herb, target, "i999"]) expectRejected(s, up([id]), "bad catalyst");
    // M16（G-2）: 持ち主の inventory に無い（c1 の品を c2 の品として）・持ち主がいない
    expectRejected(s, up([ref(good, "c2")]), "bad catalyst");
    expectRejected(s, up([ref(good, "c9")]), "bad catalyst");
    expectRejected(s, up([ref(others, "c2")]), "not enough gold");
    expectRejected(s, up([good]), "not enough gold");
    const rich = cloneState(s);
    rich.gold = 150;
    expect(checkUpgrade(rich, "c1", "weapon", [ref(good)], data)).toBeNull();
    expect(checkUpgrade(rich, "c1", "weapon", [ref(good), ref(others, "c2")], data)).toBeNull();
  });
});

describe("TW-17 upgradePreview と townMenu.upgrade（表示層向けの問い合わせ）", () => {
  test("TW-17 upgradePreview は town.upgrade の dice の rate / great と料金に一致し、block は checkUpgrade と同じ", () => {
    const s = town(1000, 4);
    const cats = [give(s, "c1", { itemId: "long_sword", level: 4 }), give(s, "c1", { itemId: "dagger", level: 3 }), give(s, "c1", { itemId: "dagger", level: 0 })];
    const p = upgradePreview(s, data, "c1", "weapon", refs(cats));
    expect(p).toMatchObject({ rate: 65, great: 6, fee: 250, affordable: true, block: null });
    withFirstRoll(s, 50);
    const r = ok(s, up(cats));
    const d = r.events[0];
    expect(d?.kind === "dice" && d.rule.params).toEqual({ rate: p!.rate, great: p!.great });
    expect(s.gold - r.state.gold).toBe(p!.fee);
  });

  test("TW-17 upgradePreview: 払えなければ affordable 偽・block not enough gold、触媒が不正なら block bad catalyst、対象が決まらなければ null", () => {
    const s = town(100, 2);
    const unid = give(s, "c1", { itemId: "dagger", identified: false });
    expect(upgradePreview(s, data, "c1", "weapon", [])).toMatchObject({ rate: 10, great: 1, fee: 150, affordable: false, block: "not enough gold" });
    expect(upgradePreview(s, data, "c1", "weapon", [ref(unid)])).toMatchObject({ rate: 10, great: 1, fee: 150, affordable: false, block: "bad catalyst" });
    expect(upgradePreview(s, data, "c1", "helm", [])).toBeNull();
    expect(upgradePreview(s, data, "c9", "weapon", [])).toBeNull();
  });

  test("TW-17 M18（3-3）upgradePreview の before / after は対象の Lv と Lv+1 の性能の下見（shopItemPreview と同じ値。大成功の +2 は出さない）、kind は武器 attack・防具 ac・術者用武器 magic・装飾 null。触媒・所持金によらず、乱数を引かない", () => {
    const s = town(0, 3);
    const rng = JSON.stringify(s.rng);
    // 武器（長剣 1d8。weaponLvPerDamage 1）: Lv3 → Lv4 で 1d8+3 → 1d8+4
    const w = upgradePreview(s, data, "c1", "weapon", [])!;
    expect(w.kind).toBe("attack");
    expect(w.before).toEqual(shopItemPreview(data, "long_sword", 3));
    expect(w.after).toEqual(shopItemPreview(data, "long_sword", 4));
    expect([w.before.attack, w.after.attack, w.before.ac, w.before.magicPower]).toEqual(["1d8+3", "1d8+4", null, null]);
    // 触媒と所持金は前後に効かない（block が bad catalyst でも値は出す）
    const cat = give(s, "c1", { itemId: "dagger", identified: false });
    expect(upgradePreview(s, data, "c1", "weapon", [ref(cat)])).toMatchObject({ block: "bad catalyst", kind: "attack", before: w.before, after: w.after });
    // 防具（革鎧 AC -2。armorLvPerAc 2）: Lv0 → 1 は -2 → -2、Lv1 → 2 は -2 → -3
    const armor = s.items[member(s, "c1").equipment.armor!]!;
    expect(armor.itemId).toBe("leather_armor");
    const a0 = upgradePreview(s, data, "c1", "armor", [])!;
    expect([a0.kind, a0.before.ac, a0.after.ac, a0.before.attack]).toEqual(["ac", -2, -2, null]);
    armor.level = 1;
    const a1 = upgradePreview(s, data, "c1", "armor", [])!;
    expect([a1.before.ac, a1.after.ac]).toEqual([-2, -3]);
    // 術者用武器（樫の杖 magicPower 1。casterLvPerPower 1）: Lv2 → 3 で 3 → 4。攻撃は Lv で増えない
    const staff = createItemInstance(s, { itemId: "oak_staff", level: 2, identified: true });
    member(s, "c2").equipment.weapon = staff;
    const m = upgradePreview(s, data, "c2", "weapon", [])!;
    expect([m.kind, m.before.magicPower, m.after.magicPower, m.before.attack, m.after.attack]).toEqual(["magic", 3, 4, "1d6", "1d6"]);
    // 装飾（IT-23。Lv は AC に効かない）は語る項目が無い
    const charm = createItemInstance(s, { itemId: "charm", level: 1, identified: true });
    member(s, "c1").equipment.accessory = charm;
    const c = upgradePreview(s, data, "c1", "accessory", [])!;
    expect(c.kind).toBeNull();
    expect([c.before.ac, c.after.ac]).toEqual([0, 0]);
    expect(JSON.stringify(s.rng)).toBe(rng);
  });

  test("TW-17 M18（5-13）upgradePreview の nextChangeAt: kind の値が前後で同じときだけ、次に値が変わる Lv までの段数とその値（防具 Lv0・Lv2 は +2 で変わる）。値が変わる・kind が null なら null。乱数を引かない", () => {
    const s = town(0, 3);
    const rng = JSON.stringify(s.rng);
    // 武器（weaponLvPerDamage 1）は毎段変わる
    expect(upgradePreview(s, data, "c1", "weapon", [])!.nextChangeAt).toBeNull();
    // 防具（革鎧 AC -2。armorLvPerAc 2）: Lv0 → 1 は -2 のまま、+2（Lv2）で -3
    const armor = s.items[member(s, "c1").equipment.armor!]!;
    armor.level = 0;
    const a0 = upgradePreview(s, data, "c1", "armor", [])!;
    expect([a0.before.ac, a0.after.ac]).toEqual([-2, -2]);
    expect(a0.nextChangeAt).toEqual({ levels: 2, level: 2, value: "-3" });
    armor.level = 1;
    expect(upgradePreview(s, data, "c1", "armor", [])!.nextChangeAt).toBeNull();
    armor.level = 2;
    expect(upgradePreview(s, data, "c1", "armor", [])!.nextChangeAt).toEqual({ levels: 2, level: 4, value: "-4" });
    // 除数を 3 にすると Lv0 は +3 で変わる（config の値を読む）
    const d3 = { ...data, config: { ...data.config, items: { ...data.config.items, armorLvPerAc: 3 } } };
    armor.level = 0;
    expect(upgradePreview(s, d3, "c1", "armor", [])!.nextChangeAt).toEqual({ levels: 3, level: 3, value: "-3" });
    armor.level = 2;
    expect(upgradePreview(s, d3, "c1", "armor", [])!.nextChangeAt).toBeNull();
    // 装飾（kind null）は前後が同じでも null
    const charm = createItemInstance(s, { itemId: "charm", level: 0, identified: true });
    member(s, "c1").equipment.accessory = charm;
    const c = upgradePreview(s, data, "c1", "accessory", [])!;
    expect([c.kind, c.nextChangeAt]).toEqual([null, null]);
    // 未鑑定の対象（kind null）も null
    armor.level = 0;
    armor.identified = false;
    expect(upgradePreview(s, data, "c1", "armor", [])!.nextChangeAt).toBeNull();
    expect(JSON.stringify(s.rng)).toBe(rng);
  });

  test("TW-17 IT-12 M18 upgradePreview: 未鑑定の対象（呪いで外せずに着けている品）は kind を null にして前後を語らない（品の中身を見せない）", () => {
    const s = town(1000, 3);
    s.items[member(s, "c1").equipment.weapon!]!.identified = false;
    const p = upgradePreview(s, data, "c1", "weapon", [])!;
    expect(p).toMatchObject({ block: null, kind: null });
    s.items[member(s, "c1").equipment.weapon!]!.identified = true;
    expect(upgradePreview(s, data, "c1", "weapon", [])!.kind).toBe("attack");
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
    // M16（4-5）: plainName は表示名から Lv を除いたもの（name は IT-11 のまま）
    expect(c1.slots.map((x) => [x.slot, x.name, x.plainName, x.level, x.block])).toEqual([
      ["weapon", "長剣 +3", "長剣", 3, null],
      ["armor", "革鎧", "革鎧", 0, null],
      ["shield", "木の盾", "木の盾", 0, null],
      ["helm", null, null, 0, "slot empty"],
      ["gauntlet", null, null, 0, "slot empty"],
      ["accessory", null, null, 0, "slot empty"],
    ]);
    expect(c1.catalysts).toEqual([{ instanceId: a, name: "短剣 +1", plainName: "短剣", level: 1, ownerId: "c1", ownerName: "アルド", power: { attack: "1d4+1", ac: null, magicPower: null }, cursed: false }]);
    // ユニークだけを装備した者は canUpgrade 偽
    const s2 = cloneState(s);
    const c5 = member(s2, "c5"); // 魔術師（杖だけ）
    s2.items[c5.equipment.weapon!]!.uniqueId = "dawn_flint_staff";
    expect(townMenu(s2, data)!.upgrade.members[4]!.canUpgrade).toBe(false);
  });
});

describe("TW-17 / IT-70 M16（G-2）触媒はパーティ全員の所持品から", () => {
  const S = data.strings;

  test("TW-17/IT-70 M16 触媒の候補は全員の inventory（メンバーの並び順 → inventory の順）で、持ち主の id と名前を持つ。どの者の段でも同じ。装備中の品（鍛える対象そのもの）は出ない", () => {
    const s = town(1000, 0);
    const x = give(s, "c3", { itemId: "dagger", level: 2 });
    const y = give(s, "c1", { itemId: "long_sword", level: 0, rarity: "fine" });
    const z = give(s, "c3", { itemId: "dagger", level: 0 });
    const w = give(s, "c6", { itemId: "dagger", level: 1 });
    const m = townMenu(s, data)!.upgrade;
    const expected = [
      { instanceId: y, name: "上質な長剣", plainName: "上質な長剣", level: 0, ownerId: "c1", ownerName: "アルド", power: { attack: "1d8", ac: null, magicPower: null }, cursed: false },
      { instanceId: x, name: "短剣 +2", plainName: "短剣", level: 2, ownerId: "c3", ownerName: "キリ", power: { attack: "1d4+2", ac: null, magicPower: null }, cursed: false },
      { instanceId: z, name: "短剣", plainName: "短剣", level: 0, ownerId: "c3", ownerName: "キリ", power: { attack: "1d4", ac: null, magicPower: null }, cursed: false },
      { instanceId: w, name: "短剣 +1", plainName: "短剣", level: 1, ownerId: "c6", ownerName: "フィン", power: { attack: "1d4+1", ac: null, magicPower: null }, cursed: false },
    ];
    for (const mm of m.members) expect(mm.catalysts, mm.memberId).toEqual(expected);
    // 装備中の品（全員の equipment）は候補に出ない
    const equipped = s.party.flatMap((c) => Object.values(c.equipment).filter((id): id is string => id !== null));
    expect(equipped.length).toBeGreaterThan(0);
    for (const id of equipped) expect(m.members[0]!.catalysts.some((c) => c.instanceId === id)).toBe(false);
    expect(S["item.owner.short"]).toBe("{name}…");
  });

  test("TW-17/IT-70 M16 他人の品を触媒にすると、持ち主の inventory から消える（鍛える本人の所持品は変わらない）。成功率は自分の品と同じ式", () => {
    const s = town(1000, 2);
    const cat = give(s, "c2", { itemId: "long_sword", level: 2 });
    const before1 = [...member(s, "c1").inventory];
    const before2 = member(s, "c2").inventory.filter((id) => id !== cat);
    expect(upgradePreview(s, data, "c1", "weapon", [ref(cat, "c2")])).toMatchObject({ rate: 40, great: 4, fee: 150, affordable: true, block: null });
    withFirstRoll(s, 5);
    const r = ok(s, up([ref(cat, "c2")]));
    expect(r.events[1]).toEqual({ kind: "message", key: "town.upgrade.ok", params: { name: "アルド", item: "長剣 +3" } });
    expect(r.state.items[cat]).toBeUndefined();
    expect(member(r.state, "c2").inventory).toEqual(before2);
    expect(member(r.state, "c1").inventory).toEqual(before1);
    expect(weaponOf(r.state, "c1").level).toBe(3);
  });

  test("TW-17/IT-70 M16 持ち主の life は問わない（灰の者の品も触媒にできる）。3 人の品を 1 個ずつ混ぜて使える", () => {
    const s = town(1000, 0);
    const a = give(s, "c1", { itemId: "dagger" });
    const b = give(s, "c4", { itemId: "dagger" });
    const c = give(s, "c5", { itemId: "dagger" });
    member(s, "c4").life = "ash";
    member(s, "c4").hp = 0;
    withFirstRoll(s, 50);
    const r = ok(s, up([ref(a), ref(b, "c4"), ref(c, "c5")]));
    const d = r.events[0];
    expect(d?.kind === "dice" && d.rule.params).toEqual({ rate: 100, great: 10 });
    for (const id of [a, b, c]) expect(r.state.items[id]).toBeUndefined();
    expect(member(r.state, "c4").inventory).not.toContain(b);
    expect(member(r.state, "c5").inventory).not.toContain(c);
  });
});

describe("TW-17 / IT-70 M17 倉庫の品を触媒に", () => {
  /** 倉庫の末尾に実体を足して id を返す（既定は鑑定済みの汎用装備） */
  function store(s: GameState, spec: Partial<ItemInstance> & { itemId: string }): string {
    const iid = createItemInstance(s, { identified: true, ...spec });
    s.warehouse.push(iid);
    return iid;
  }
  const wh = (instanceId: string): UpgradeCatalystRef => ({ memberId: null, instanceId });

  test("TW-17 M20 B-2 触媒の候補の power は品の性能の下見（itemPowerPreview。オプションを除く）: 防具は AC だけ、術者用の武器は攻撃と魔法攻撃力、該当しない項目は null。倉庫の品も同じ", () => {
    const s = town(1000, 0);
    const mail = give(s, "c1", { itemId: "chain_mail", level: 4 });
    const oak = give(s, "c2", { itemId: "oak_staff", level: 2, rarity: "fine", options: [{ optionId: "mp_max", tier: 2, value: 4 }] });
    const cap = store(s, { itemId: "leather_cap", level: 2 });
    const cats = townMenu(s, data)!.upgrade.members[0]!.catalysts;
    const power = (id: string) => cats.find((c) => c.instanceId === id)?.power;
    expect(power(mail)).toEqual({ attack: null, ac: -6, magicPower: null }); // −4 − floor(4 ÷ armorLvPerAc 2)
    expect(power(oak)).toEqual({ attack: "1d6", ac: null, magicPower: 3 }); // 術者用は Lv の分を攻撃に足さない。オプションの最大MP は入らない
    expect(power(cap)).toEqual({ attack: null, ac: -2, magicPower: null });
  });

  test("TW-17/IT-70 M17 候補はメンバーの品の後に倉庫の品（倉庫の順）。倉庫の品は ownerId null・ownerName 空文字。未鑑定・ユニーク・消耗品は出ない。どの者の段でも同じ", () => {
    const s = town(1000, 0);
    const herb = member(s, "c1").inventory.shift()!; // 薬草（消耗品）を倉庫へ
    s.warehouse.push(herb);
    const p = store(s, { itemId: "dagger", level: 3 });
    store(s, { itemId: "dagger", identified: false });
    store(s, { itemId: "dagger", uniqueId: "twin_tongue_dagger" });
    const q = store(s, { itemId: "long_sword", level: 0 });
    const x = give(s, "c2", { itemId: "dagger", level: 1 });
    const m = townMenu(s, data)!.upgrade;
    const expected = [
      { instanceId: x, name: "短剣 +1", plainName: "短剣", level: 1, ownerId: "c2", ownerName: "ベルク", power: { attack: "1d4+1", ac: null, magicPower: null }, cursed: false },
      { instanceId: p, name: "短剣 +3", plainName: "短剣", level: 3, ownerId: null, ownerName: "", power: { attack: "1d4+3", ac: null, magicPower: null }, cursed: false },
      { instanceId: q, name: "長剣", plainName: "長剣", level: 0, ownerId: null, ownerName: "", power: { attack: "1d8", ac: null, magicPower: null }, cursed: false },
    ];
    for (const mm of m.members) expect(mm.catalysts, mm.memberId).toEqual(expected);
    // 表示層が持ち主の欄に引く文言（core は日本語を持たない）
    expect(data.strings["town.shop.menu.storage"]).toBe("倉庫");
  });

  test("TW-17/IT-70 M17 倉庫の品を触媒にすると倉庫から消える（ほかの倉庫の品と並びは残る）。メンバーの品と混ぜられ、成功率は同じ式。品は触媒の分だけ減る", () => {
    const s = town(1000, 2);
    const keep1 = store(s, { itemId: "dagger", level: 0 });
    const cat = store(s, { itemId: "long_sword", level: 2 });
    const keep2 = store(s, { itemId: "dagger", identified: false });
    const mine = give(s, "c3", { itemId: "long_sword", level: 2 });
    const inv = s.party.map((c) => [...c.inventory]);
    const nItems = Object.keys(s.items).length;
    expect(upgradePreview(s, data, "c1", "weapon", [wh(cat)])).toMatchObject({ rate: 40, great: 4, fee: 150, affordable: true, block: null });
    expect(upgradePreview(s, data, "c1", "weapon", [wh(cat), ref(mine, "c3")])).toMatchObject({ rate: 70, great: 7, fee: 150, affordable: true, block: null });
    withFirstRoll(s, 50); // q 7 < 50 ≤ p 70 で成功（Lv +1）
    const r = ok(s, up([wh(cat), ref(mine, "c3")]));
    const d = r.events[0];
    expect(d?.kind === "dice" && d.rule.params).toEqual({ rate: 70, great: 7 });
    expect(r.state.items[cat]).toBeUndefined();
    expect(r.state.items[mine]).toBeUndefined();
    expect(r.state.warehouse).toEqual([keep1, keep2]);
    expect(member(r.state, "c3").inventory).toEqual(inv[2]!.filter((id) => id !== mine));
    for (const [i, c] of r.state.party.entries()) if (c.id !== "c3") expect(c.inventory, c.id).toEqual(inv[i]);
    expect(Object.keys(r.state.items).length).toBe(nItems - 2); // 消えたのは触媒の 2 個だけ
    expect(weaponOf(r.state, "c1").level).toBe(3);
    expect(s.warehouse).toEqual([keep1, cat, keep2]); // 引数の state は変わらない
  });

  test("TW-17/IT-70 M17 拒否: memberId null で倉庫に無い・倉庫の品を者の品として・倉庫の未鑑定は bad catalyst。memberId が文字列でも null でもなければ bad action。倉庫と者で同じ実体の重複も bad action", () => {
    const s = town(1000, 0);
    const w = store(s, { itemId: "dagger" });
    const wUnid = store(s, { itemId: "dagger", identified: false });
    const mine = give(s, "c1", { itemId: "dagger" });
    expectRejected(s, up([wh(mine)]), "bad catalyst"); // 者の品を倉庫の品として
    expectRejected(s, up([ref(w)]), "bad catalyst"); // 倉庫の品を c1 の品として
    expectRejected(s, up([wh(wUnid)]), "bad catalyst");
    expectRejected(s, up([wh("i999")]), "bad catalyst");
    expectRejected(s, up([{ instanceId: w }]), "bad action"); // memberId の欠け（undefined）
    expectRejected(s, up([{ memberId: 0, instanceId: w }]), "bad action");
    expectRejected(s, up([wh(w), ref(w)]), "bad action");
    expect(checkUpgrade(s, "c1", "weapon", [wh(w), ref(mine)], data)).toBeNull();
    // 迷宮の中では wrong screen（倉庫は街だけ）
    const diving = cloneState(execute(newGame(1), { type: "dungeon.enter", dungeonId: "d01" }, data).state);
    expectRejected(diving, up([wh(w)]), "wrong screen");
  });

  test("TW-17 M17 destroyItemInstance は持ち主 null で倉庫から外す（持ち主ありでも倉庫に残った参照は外す）", () => {
    const s = town(1000, 0);
    const a = store(s, { itemId: "dagger" });
    const b = store(s, { itemId: "dagger" });
    destroyItemInstance(s, null, a);
    expect(s.warehouse).toEqual([b]);
    expect(s.items[a]).toBeUndefined();
    expectStateInvariants(s);
  });
});

describe("TW-17 M21（B-1）鍛えるの Lv 移植と料金", () => {
  /** c1 の長剣 Lv targetLv、触媒（c1 の inventory の長剣）を lvs の Lv で足し、最初の d100 を roll に */
  function setup(targetLv: number, lvs: number[], roll: number, gold = 1000): { s: GameState; cats: string[] } {
    const s = town(gold, targetLv);
    const cats = lvs.map((lv) => give(s, "c1", { itemId: "long_sword", level: lv }));
    withFirstRoll(s, roll);
    return { s, cats };
  }

  test("TW-17 M21 成功: Lv0 の長剣に Lv5 の触媒 1 個（p 40・q 4）、出目 5 → Lv5、料金 50 × 5 = 250。乱数は d100 の 1 回（鏡の rng）", () => {
    const { s, cats } = setup(0, [5], 5);
    const mirror = structuredClone(s.rng);
    expect(randInt(mirror, 1, 100)).toBe(5);
    const r = ok(s, up(cats));
    expect(r.events[0]).toMatchObject({ kind: "dice", rule: { params: { rate: 40, great: 4 } }, result: { key: "dice.upgrade.ok" } });
    expect(r.events[1]).toEqual({ kind: "message", key: "town.upgrade.ok", params: { name: "アルド", item: "長剣 +5" } });
    expect(weaponOf(r.state, "c1").level).toBe(5);
    expect(r.state.gold).toBe(1000 - 250);
    expect(r.state.rng).toEqual(mirror);
  });

  test("TW-17 M21 大成功は結果の Lv に +1（Lv0 + 触媒 Lv5 → Lv6）。料金は大成功を含めない 250", () => {
    const { s, cats } = setup(0, [5], 4);
    const r = ok(s, up(cats));
    expect(r.events[0]).toMatchObject({ kind: "dice", result: { key: "dice.upgrade.great" } });
    expect(weaponOf(r.state, "c1").level).toBe(6);
    expect(r.state.gold).toBe(1000 - 250);
  });

  test("TW-17 M21 失敗は対象の Lv − 1（触媒の Lv によらない）。Lv0 は 0 のまま ngFloor。料金は結果の Lv で取る", () => {
    const a = setup(3, [8, 6], 100);
    const ra = ok(a.s, up(a.cats));
    expect(ra.events[0]).toMatchObject({ kind: "dice", result: { key: "dice.upgrade.ng" } });
    expect(weaponOf(ra.state, "c1").level).toBe(2);
    expect(ra.state.gold).toBe(1000 - 50 * 6); // 結果の Lv = max(4, 6) = 6
    const b = setup(0, [5], 100);
    const rb = ok(b.s, up(b.cats));
    expect(weaponOf(rb.state, "c1").level).toBe(0);
    expect(rb.events[1]).toMatchObject({ key: "town.upgrade.ngFloor" });
    expect(rb.state.gold).toBe(1000 - 250);
  });

  test("TW-17 M21 触媒の最小値が対象以下なら対象 + 1（Lv2 + 触媒 Lv5・Lv0 → 成功で Lv3、料金 150）", () => {
    const { s, cats } = setup(2, [5, 0], 10);
    const r = ok(s, up(cats));
    expect(r.events[0]).toMatchObject({ kind: "dice", result: { key: "dice.upgrade.ok" } });
    expect(weaponOf(r.state, "c1").level).toBe(3);
    expect(r.state.gold).toBe(1000 - 150);
  });

  test("TW-17 M21 checkUpgrade の所持金の検査は結果の Lv の料金（Lv0 + 触媒 Lv5 は 250G。249G は not enough gold、乱数を引かない）", () => {
    const poor = setup(0, [5], 5, 249);
    expectRejected(poor.s, up(poor.cats), "not enough gold");
    expect(checkUpgrade(poor.s, "c1", "weapon", refs(poor.cats), data)).toBe("not enough gold");
    expect(checkUpgrade(poor.s, "c1", "weapon", [], data)).toBeNull(); // 触媒なしなら 50G
    const rich = setup(0, [5], 5, 250);
    expect(checkUpgrade(rich.s, "c1", "weapon", refs(rich.cats), data)).toBeNull();
    expect(ok(rich.s, up(rich.cats)).state.gold).toBe(0);
  });

  test("TW-17 M21 upgradePreview: level / resultLevel、after は結果の Lv の下見、fee は結果の Lv × 50、affordable も同じ額。触媒にできない品は数えない", () => {
    const s = town(240, 0);
    const c5 = give(s, "c1", { itemId: "long_sword", level: 5 });
    const p = upgradePreview(s, data, "c1", "weapon", [ref(c5)])!;
    expect(p).toMatchObject({ level: 0, resultLevel: 5, fee: 250, affordable: false, block: "not enough gold" });
    expect(p.before).toEqual(shopItemPreview(data, "long_sword", 0));
    expect(p.after).toEqual(shopItemPreview(data, "long_sword", 5));
    const unid = give(s, "c1", { itemId: "long_sword", level: 9, identified: false });
    expect(upgradePreview(s, data, "c1", "weapon", [ref(c5), ref(unid)])).toMatchObject({ resultLevel: 5, block: "bad catalyst" });
    expect(upgradePreview(s, data, "c1", "weapon", [])).toMatchObject({ level: 0, resultLevel: 1, fee: 50, affordable: true, block: null });
  });

  test("TW-17 M21 upgradePreview の nextChangeAt は結果の Lv で判定（革鎧 Lv0 + 触媒 Lv1 は同じ値で +2 で -3、触媒 Lv3 は値が変わるので null。除数 3 で触媒 Lv2 は +3 で -3）", () => {
    const s = town(1000, 0);
    const armor = s.items[member(s, "c1").equipment.armor!]!;
    armor.level = 0;
    const c1 = give(s, "c1", { itemId: "leather_armor", level: 1 });
    const c2 = give(s, "c1", { itemId: "leather_armor", level: 2 });
    const c3 = give(s, "c1", { itemId: "leather_armor", level: 3 });
    expect(upgradePreview(s, data, "c1", "armor", [ref(c1)])!.nextChangeAt).toEqual({ levels: 2, level: 2, value: "-3" });
    const p3 = upgradePreview(s, data, "c1", "armor", [ref(c3)])!;
    expect([p3.resultLevel, p3.before.ac, p3.after.ac, p3.nextChangeAt]).toEqual([3, -2, -3, null]);
    const d3 = { ...data, config: { ...data.config, items: { ...data.config.items, armorLvPerAc: 3 } } };
    expect(upgradePreview(s, d3, "c1", "armor", [ref(c2)])!.nextChangeAt).toEqual({ levels: 3, level: 3, value: "-3" });
  });
});
