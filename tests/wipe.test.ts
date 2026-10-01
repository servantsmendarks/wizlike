// rules/wipe.ts（全滅処理 TW-20〜26、DG-42、CH-41/62、MG-03）と、全滅の発生（CB-53、CB-06、戦闘外の CH-44）。
// 乱数は「鏡の rng」: 2d10 → 失う品 1 個ごとに randInt(0, 候補数 − 1)。期待の金・EXP・レベルは手計算の値を書く。
// 基準の一行（base）: 経験値 c1 1600（戦士 Lv3）、c2 2400（戦士 Lv4）、c3 1000（盗賊 Lv2）、c4 1100（僧侶 Lv2）、c5 50、c6 0（Lv1）。
// 戦士・僧侶の閾値 Lv2 1000 / Lv3 1500 / Lv4 2250、盗賊 900 / 1350 / 2025。所持金 300。
// 閾値は expBase を 1000 に固定したデータ（loadRuleData）のもの。実データの expBase（50【仮】）は調整値なので、レベルの閾値が関わるテストでは使わない（dived や dataWith を使う一部のテストは実データだが、閾値は結果に影響しない）。
// 非装備の所持品は 5 個（c1 薬草、c3 薬草、c4 解毒草、c5 帰還の糸、c6 薬草）。
import { describe, expect, test } from "vitest";
import type { GameData } from "../src/core/data";
import { EQUIP_SLOTS } from "../src/core/data";
import { execute } from "../src/core/engine";
import { cloneRng, createRng, randInt, rollDice, type RngState } from "../src/core/rng";
import { startBattle } from "../src/core/rules/combat";
import { levelUpWhilePossible } from "../src/core/rules/growth";
import { returnToTown } from "../src/core/rules/town";
import { assetValue, itemSaleValue, performWipe, wipeIfNoneCanAct } from "../src/core/rules/wipe";
import { cloneState, createItemInstance, destroyItemInstance, makeContext, memberById } from "../src/core/state";
import type { Character, GameEvent, GameState, PenaltyResult, RuleContext } from "../src/core/types";
import { ALWAYS_HIT, dataWith, dived, eventsOf, kindsOf, withBattle } from "./helpers/battle";
import { expectKnownStringKeys, expectStateInvariants, loadRuleData, mirrorWipeRolls, newGame } from "./helpers/core";

/** expBase 1000 に固定したデータ（CH-64 の調整値から手計算を切り離す） */
const data = loadRuleData();

const EXPS: Record<string, number> = { c1: 1600, c2: 2400, c3: 1000, c4: 1100, c5: 50, c6: 0 };

/** 迷宮の中（dive 非 null、battle null）。経験値は EXPS で、宿屋と同じ levelUpWhilePossible でレベルを上げてある */
function base(): GameState {
  const ctx = makeContext(cloneState(dived(1)), data);
  for (const ch of ctx.state.party) {
    ch.exp = EXPS[ch.id]!;
    levelUpWhilePossible(ctx, ch);
  }
  return ctx.state;
}

/** 台帳に c2 の短剣 1 個と 40G を足す（所持金にも入っている: DG-40） */
function withLedger(s0: GameState): GameState {
  const s = cloneState(s0);
  const id = createItemInstance(s, "dagger", true);
  s.party[1]!.inventory.push(id);
  s.dive!.ledger.items.push(id);
  s.dive!.ledger.gold += 40;
  s.gold += 40;
  return s;
}

/** 2d10 の合計が total になる rng に差し替える（createRng(k) の k を 1 から探す） */
function withTotal(s0: GameState, total: number): GameState {
  for (let k = 1; k < 100_000; k++) {
    if (rollDice(createRng(k), "2d10").total === total) {
      const s = cloneState(s0);
      s.rng = createRng(k);
      return s;
    }
  }
  throw new Error(`withTotal: ${total} not found`);
}

function patch(s0: GameState, patches: Record<string, Partial<Character>>): GameState {
  const s = cloneState(s0);
  s.party = s.party.map((c) => (patches[c.id] === undefined ? c : { ...c, ...structuredClone(patches[c.id]) }));
  return s;
}

function wipeOf(s: GameState, d: GameData = data): RuleContext {
  const ctx = makeContext(cloneState(s), d);
  performWipe(ctx);
  expectKnownStringKeys(ctx.events, d);
  return ctx;
}

function penaltyOf(events: readonly GameEvent[]): PenaltyResult {
  const w = eventsOf(events, "wipe");
  expect(w).toHaveLength(1);
  return w[0]!.penalty;
}

/** 手で書いた帯の表（penalty-table.json）: 出目 → 添字 */
function bandByHand(t: number): number {
  if (t <= 3) return 0;
  if (t <= 6) return 1;
  if (t <= 10) return 2;
  if (t <= 14) return 3;
  if (t <= 17) return 4;
  if (t <= 19) return 5;
  return 6;
}
/** 台帳分を引いた後の所持金 300 からの損失（0.5 / 0.3 / 0.2 / 0.1 / 0.05 / 0 / 0） */
const GOLD_LOST = [150, 90, 60, 30, 15, 0, 0];
const ITEM_LOSS = [3, 2, 1, 1, 0, 0, 0];

const DEAD = { life: "dead" as const, hp: 0 };
const ASH = { life: "ash" as const, hp: 0 };
const PARA = { status: ["paralysis" as const] };

/** 並び順 × inventory の順の非装備の品 */
function unequippedIds(s: GameState): string[] {
  return s.party.flatMap((c) => c.inventory);
}
/** 並び順 × EQUIP_SLOTS の順の装備の品 */
function equippedIds(s: GameState): string[] {
  return s.party.flatMap((c) => EQUIP_SLOTS.flatMap((slot) => (c.equipment[slot] === null ? [] : [c.equipment[slot]!])));
}

// ---------------------------------------------------------------------------

describe("全滅処理（TW-20〜26）", () => {
  test("前提: base の一行のレベルは 3 / 4 / 2 / 2 / 1 / 1", () => {
    expect(base().party.map((c) => c.level)).toEqual([3, 4, 2, 2, 1, 1]);
  });

  test("TW-22/UI-40 出目と帯: 2d10 の合計 2〜20 のそれぞれで dice{dice.wipe}（出目 1 行に 2 個・合計、rule は帯の min / max、result は帯の name）→ 帯の text の message。bandIndex は帯。乱数は 2d10 と失う品の選択だけ（鏡の rng）", () => {
    for (let t = 2; t <= 20; t++) {
      const s = withTotal(withLedger(base()), t);
      const m = cloneRng(s.rng);
      expect(mirrorWipeRolls(m, 5)).toBe(t);
      const ctx = wipeOf(s);
      const p = penaltyOf(ctx.events);
      const idx = bandByHand(t);
      const dice = eventsOf(ctx.events, "dice");
      expect(dice).toHaveLength(1);
      const band = data.penaltyTable.bands[idx]!;
      expect(dice[0]!.label).toEqual({ key: "dice.wipe" });
      expect(dice[0]!.rows).toHaveLength(1);
      const row = dice[0]!.rows[0]!;
      expect(row.label).toEqual({ key: "dice.row.roll" });
      expect(row.base).toBeNull();
      expect(row.dice).toHaveLength(2);
      expect(row.dice[0]! + row.dice[1]!).toBe(t);
      expect(row.total).toBe(t);
      expect(band.min <= t && t <= band.max).toBe(true);
      expect(dice[0]!.rule).toEqual({ key: "dice.wipe.rule", params: { min: band.min, max: band.max } });
      expect(dice[0]!.result).toEqual({ key: "dice.wipe.result", params: { band: band.name } });
      expect(p.dice).toEqual(row.dice);
      expect(p.total).toBe(t);
      expect(p.bandIndex).toBe(idx);
      const di = ctx.events.indexOf(dice[0]!);
      expect(ctx.events[di + 1]).toEqual({ kind: "message", key: data.penaltyTable.bands[idx]!.text });
      expect(ctx.state.rng).toEqual(m);
      // TW-22 金: 台帳分を引いた後の 300 に比率を掛けて切り捨て。0 なら wipe.goldLost を出さない
      expect(p.ledgerGold).toBe(40);
      expect(p.goldLost).toBe(GOLD_LOST[idx]);
      expect(ctx.state.gold).toBe(300 - GOLD_LOST[idx]!);
      const gl = ctx.events.filter((e) => e.kind === "message" && e.key === "wipe.goldLost");
      expect(gl).toEqual(GOLD_LOST[idx]! > 0 ? [{ kind: "message", key: "wipe.goldLost", params: { gold: GOLD_LOST[idx] } }] : []);
      expect(p.itemsLost).toHaveLength(ITEM_LOSS[idx]!);
      // 内訳 = state の差分
      expect(s.gold - ctx.state.gold).toBe(p.ledgerGold + p.goldLost);
      for (const it of p.itemsLost) expect(ctx.state.items[it.instanceId]).toBeUndefined();
      expect(Object.keys(s.items).length - Object.keys(ctx.state.items).length).toBe(1 + p.itemsLost.length);
      const expSum = (x: GameState) => x.party.reduce((a, c) => a + c.exp, 0);
      expect(p.expLost.map((e) => e.id)).toEqual(["c1", "c2", "c3", "c4", "c5", "c6"]);
      expect(expSum(s) - expSum(ctx.state)).toBe(p.expLost.reduce((a, e) => a + e.lost, 0));
      p.expLost.forEach((e, i) => {
        expect(e.expBefore).toBe(s.party[i]!.exp);
        expect(e.expBefore - e.lost).toBe(ctx.state.party[i]!.exp);
        expect(e.levelTo).toBe(ctx.state.party[i]!.level);
      });
    }
  });

  test("TW-21/DG-42 台帳: 品は全部消え（名前は ledgerItems）、所持金は min(所持金, 台帳の金) 減る。台帳が空でも wipe.ledgerLost を 1 回出す", () => {
    const s = withTotal(withLedger(base()), 20);
    const daggerId = s.dive!.ledger.items[0]!;
    const ctx = wipeOf(s);
    const p = penaltyOf(ctx.events);
    expect(p.ledgerItems).toEqual(["短剣"]);
    expect(p.ledgerGold).toBe(40);
    expect(ctx.state.items[daggerId]).toBeUndefined();
    expect(ctx.state.party[1]!.inventory).not.toContain(daggerId);
    expect(kindsOf(ctx.events).slice(0, 3)).toEqual(["message:wipe.intro", "message:wipe.ledgerLost", "dice"]);
    expect(ctx.state.gold).toBe(300);
    // 所持金が台帳の金より少なければ 0 で止まる
    const poor = cloneState(s);
    poor.gold = 25;
    const pc = wipeOf(poor);
    expect(penaltyOf(pc.events).ledgerGold).toBe(25);
    expect(pc.state.gold).toBe(0);
    // 台帳が空
    const empty = wipeOf(withTotal(base(), 20));
    const pe = penaltyOf(empty.events);
    expect(pe.ledgerGold).toBe(0);
    expect(pe.ledgerItems).toEqual([]);
    expect(kindsOf(empty.events).filter((k) => k === "message:wipe.ledgerLost")).toHaveLength(1);
  });

  test("TW-22 品: 非装備が itemLoss 以上なら非装備（並び順 × inventory の順）から選び、装備は残る。1 個ごとに候補を作り直して randInt(0, 候補数 − 1)（鏡の rng）", () => {
    const s = withTotal(base(), 2); // 大災厄: 3 個
    const m = cloneRng(s.rng);
    rollDice(m, "2d10");
    const pool = unequippedIds(s);
    expect(pool).toHaveLength(5);
    const picks: string[] = [];
    for (let k = 0; k < 3; k++) picks.push(pool.splice(randInt(m, 0, pool.length - 1), 1)[0]!);
    const ctx = wipeOf(s);
    const p = penaltyOf(ctx.events);
    expect(p.itemsLost.map((x) => x.instanceId)).toEqual(picks);
    expect(p.itemsLost.every((x) => !x.equipped)).toBe(true);
    expect(ctx.state.rng).toEqual(m);
    expect(ctx.state.party.map((c) => c.equipment)).toEqual(s.party.map((c) => c.equipment));
    expect(ctx.events.filter((e) => e.kind === "message" && e.key === "wipe.itemLost")).toEqual(
      p.itemsLost.map((x) => ({ kind: "message", key: "wipe.itemLost", params: { item: x.name } })),
    );
    for (const x of p.itemsLost) {
      expect(x.itemId).toBe(s.items[x.instanceId]!.itemId);
      expect(memberById(s, x.memberId)!.inventory).toContain(x.instanceId);
    }
  });

  test("TW-22 品: 非装備が足りなければ残りは装備（並び順 × EQUIP_SLOTS の順）から。infinite の薬草も対象。候補 1 個でも randInt を引く", () => {
    let s = withTotal(base(), 2);
    // c1 の薬草だけを残す
    for (const ch of s.party) for (const id of [...ch.inventory]) if (ch.id !== "c1") destroyItemInstance(s, ch, id);
    s = cloneState(s);
    expect(unequippedIds(s)).toHaveLength(1);
    const herb = unequippedIds(s)[0]!;
    const m = cloneRng(s.rng);
    rollDice(m, "2d10");
    expect(randInt(m, 0, 0)).toBe(0);
    const pool = equippedIds(s);
    expect(pool).toHaveLength(13);
    const picks = [herb];
    for (let k = 0; k < 2; k++) picks.push(pool.splice(randInt(m, 0, pool.length - 1), 1)[0]!);
    const ctx = wipeOf(s);
    const p = penaltyOf(ctx.events);
    expect(p.itemsLost.map((x) => x.instanceId)).toEqual(picks);
    expect(p.itemsLost.map((x) => x.equipped)).toEqual([false, true, true]);
    expect(p.itemsLost[0]!.itemId).toBe("herb");
    expect(ctx.state.rng).toEqual(m);
    // 失った装備の枠は null、他の装備は残る
    expect(equippedIds(ctx.state)).toEqual(equippedIds(s).filter((id) => !picks.includes(id)));
  });

  test("TW-22 品: 所持品が尽きたら打ち切る（randInt を引かない）", () => {
    const s = withTotal(base(), 2);
    for (const ch of s.party) for (const id of [...ch.inventory, ...equippedIds({ ...s, party: [ch] })]) destroyItemInstance(s, ch, id);
    expect(Object.keys(s.items)).toEqual([]);
    const m = cloneRng(s.rng);
    rollDice(m, "2d10");
    const ctx = wipeOf(s);
    expect(penaltyOf(ctx.events).itemsLost).toEqual([]);
    expect(kindsOf(ctx.events)).not.toContain("message:wipe.itemLost");
    expect(ctx.state.rng).toEqual(m);
  });

  test("TW-22/CH-62 EXP: 全員（dead / ash も）が floor(exp × 0.2) 減り、閾値を割ればレベルダウン（levelDown に hp / mp）。wipe.levelDown は 1 人 1 回で最終レベル。レベル 1 は下がらない", () => {
    const s = withTotal(patch(base(), { c4: DEAD, c5: ASH }), 2);
    const ctx = wipeOf(s);
    const p = penaltyOf(ctx.events);
    expect(p.expLost).toEqual([
      { id: "c1", name: "アルド", expBefore: 1600, lost: 320, levelFrom: 3, levelTo: 2 },
      { id: "c2", name: "ベルク", expBefore: 2400, lost: 480, levelFrom: 4, levelTo: 3 },
      { id: "c3", name: "キリ", expBefore: 1000, lost: 200, levelFrom: 2, levelTo: 1 },
      { id: "c4", name: "ドナ", expBefore: 1100, lost: 220, levelFrom: 2, levelTo: 1 },
      { id: "c5", name: "エル", expBefore: 50, lost: 10, levelFrom: 1, levelTo: 1 },
      { id: "c6", name: "フィン", expBefore: 0, lost: 0, levelFrom: 1, levelTo: 1 },
    ]);
    expect(ctx.state.party.map((c) => c.exp)).toEqual([1280, 1920, 800, 880, 40, 0]);
    const ks = kindsOf(ctx.events);
    const from = ks.indexOf("message:wipe.expLost");
    const to = ks.indexOf("message:wipe.revived");
    expect(from).toBeGreaterThan(ks.lastIndexOf("message:wipe.itemLost"));
    const seg = ctx.events.slice(from + 1, to);
    expect(seg.map((e) => (e.kind === "levelDown" ? `levelDown:${e.id}:${e.level}` : e.kind === "message" ? `${e.key}:${JSON.stringify(e.params)}` : e.kind))).toEqual([
      "levelDown:c1:2",
      'wipe.levelDown:{"name":"アルド","level":2}',
      "levelDown:c2:3",
      'wipe.levelDown:{"name":"ベルク","level":3}',
      "levelDown:c3:1",
      'wipe.levelDown:{"name":"キリ","level":1}',
      "levelDown:c4:1",
      'wipe.levelDown:{"name":"ドナ","level":1}',
    ]);
    for (const e of eventsOf(seg, "levelDown")) {
      const before = memberById(s, e.id)!;
      const after = memberById(ctx.state, e.id)!;
      expect(e.hpMax).toBe(after.hpMax);
      expect(e.mpMax).toBe(after.mpMax);
      expect(e.hp).toBe(Math.min(before.hp, after.hpMax));
      expect(e.mp).toBe(Math.min(before.mp, after.mpMax));
      expect(after.levelHistory).toHaveLength(after.level - 1);
    }
    expect(memberById(ctx.state, "c4")!.hp).toBe(0); // dead のまま
  });

  test("CH-62 EXP の損失で複数段下がるときは levelDown が 1 段ずつ、wipe.levelDown は最終レベルで 1 回（expLossRatio 0.6 の data）", () => {
    const d = loadRuleData();
    d.penaltyTable.bands[0]!.expLossRatio = 0.6;
    const s = withTotal(base(), 2);
    const ctx = wipeOf(s, d);
    // c2: 2400 − 1440 = 960 < 1000 なので Lv4 → 1
    const c2 = ctx.events.filter((e) => (e.kind === "levelDown" && e.id === "c2") || (e.kind === "message" && e.key === "wipe.levelDown" && e.params?.["name"] === "ベルク"));
    expect(c2.map((e) => (e.kind === "levelDown" ? e.level : `msg${e.kind === "message" ? String(e.params?.["level"]) : ""}`))).toEqual([3, 2, 1, "msg1"]);
    expect(memberById(ctx.state, "c2")!.exp).toBe(960);
    expect(memberById(ctx.state, "c2")!.level).toBe(1);
  });

  test("TW-23/MG-03 全滅時点で alive の者（麻痺・石化・SAN 0 も）は HP を max(1, ceil(hpMax × 0.5)) に「する」（下がることもある）。状態はすべて外す。MP は変えない", () => {
    const s = withTotal(
      patch(base(), {
        c1: { hp: 1, hpMax: 15, status: ["stone"] },
        c2: { hp: 20, hpMax: 20, status: ["paralysis"] },
        c3: { hp: 1, hpMax: 1, status: ["paralysis", "poison"] },
        c4: DEAD,
        c5: ASH,
        c6: { hp: 7, hpMax: 9, san: 0 },
      }),
      20, // 奇跡: 損失なし
    );
    const ctx = wipeOf(s);
    const p = penaltyOf(ctx.events);
    expect(p.revived).toEqual(["c1", "c2", "c3", "c6"]);
    expect(p.leaderRule).toBe(false);
    const ks = kindsOf(ctx.events);
    const seg = ctx.events.slice(ks.indexOf("message:wipe.revived") + 1, ks.indexOf("wipe"));
    expect(seg).toEqual([
      { kind: "hpChanged", id: "c1", delta: 7, hp: 8 },
      { kind: "statusChanged", id: "c1", status: "stone", on: false },
      { kind: "hpChanged", id: "c2", delta: -10, hp: 10 },
      { kind: "statusChanged", id: "c2", status: "paralysis", on: false },
      { kind: "statusChanged", id: "c3", status: "paralysis", on: false },
      { kind: "statusChanged", id: "c3", status: "poison", on: false },
      { kind: "hpChanged", id: "c6", delta: -2, hp: 5 },
    ]);
    expect(ks).not.toContain("message:wipe.leaderRule");
    expect(ctx.state.party.map((c) => c.mp)).toEqual(s.party.map((c) => c.mp));
    expect(ctx.state.party.map((c) => c.status)).toEqual([[], [], [], [], [], []]);
    // TW-25/CH-41: 全滅より前の dead / ash の非リーダーはそのまま
    expect(ctx.state.party.map((c) => c.life)).toEqual(["alive", "alive", "alive", "dead", "ash", "alive"]);
  });

  test("TW-24 リーダーは dead でも ash でも alive に戻り、wipe.leaderRule を出す（全滅時点で alive なら出さない）。生存者がいなければ wipe.revived は出さない", () => {
    for (const leader of [DEAD, ASH]) {
      const s = withTotal(patch(base(), { c1: { ...leader, hpMax: 21 }, c2: PARA, c3: DEAD, c4: DEAD, c5: DEAD, c6: DEAD }), 20);
      const ctx = wipeOf(s);
      const p = penaltyOf(ctx.events);
      expect(p.leaderRule).toBe(true);
      expect(p.revived).toEqual(["c2", "c1"]);
      const ks = kindsOf(ctx.events);
      const i = ks.indexOf("message:wipe.leaderRule");
      expect(i).toBeGreaterThan(ks.indexOf("message:wipe.revived"));
      expect(ctx.events.slice(i + 1, i + 3)).toEqual([
        { kind: "lifeChanged", id: "c1", life: "alive" },
        { kind: "hpChanged", id: "c1", delta: 11, hp: 11 },
      ]);
      expect(memberById(ctx.state, "c1")!.life).toBe("alive");
    }
    const alone = wipeOf(withTotal(patch(base(), { c1: DEAD, c2: DEAD, c3: DEAD, c4: DEAD, c5: DEAD, c6: DEAD }), 20));
    expect(kindsOf(alone.events)).not.toContain("message:wipe.revived");
    expect(penaltyOf(alone.events).revived).toEqual(["c1"]);
    const para = wipeOf(withTotal(patch(base(), { c1: PARA, c2: PARA, c3: DEAD, c4: DEAD, c5: DEAD, c6: DEAD }), 20));
    expect(kindsOf(para.events)).not.toContain("message:wipe.leaderRule");
    expect(penaltyOf(para.events).leaderRule).toBe(false);
  });

  test("TW-26 wipe イベントの後に town.enter → sanChanged（SAN 0 の者も、life を問わず sanMax へ）→ 条件なら town.mercy.offer → screen town が最後。dive・battle・pendingChoice は null、townVisit は非 null", () => {
    const s0 = patch(base(), { c1: { ...DEAD, san: 0 }, c2: { ...DEAD, san: 40 }, c3: DEAD, c4: DEAD, c5: DEAD, c6: DEAD });
    s0.gold = 0;
    s0.pendingChoice = { kind: "stairs", promptKey: "dungeon.stairsDown", options: [{ id: "stay", labelKey: "dungeon.choice.stay" }] };
    const ctx = wipeOf(withTotal(s0, 20));
    const ks = kindsOf(ctx.events);
    expect(ctx.events.slice(ks.indexOf("wipe") + 1)).toEqual([
      { kind: "message", key: "town.enter" },
      { kind: "sanChanged", id: "c1", delta: 100, san: 100 },
      { kind: "sanChanged", id: "c2", delta: 60, san: 100 },
      { kind: "message", key: "town.mercy.offer" },
      { kind: "screen", to: "town" },
    ]);
    expect(ctx.state.screen).toBe("town");
    expect(ctx.state.dive).toBeNull();
    expect(ctx.state.battle).toBeNull();
    expect(ctx.state.pendingChoice).toBeNull();
    expect(ctx.state.townVisit).toEqual({ mercyOffered: true });
    // 所持金が足りれば救済は出ない
    const rich = cloneState(s0);
    rich.gold = 300;
    const r = wipeOf(withTotal(rich, 20));
    expect(kindsOf(r.events)).not.toContain("message:town.mercy.offer");
    expect(r.events.at(-1)).toEqual({ kind: "screen", to: "town" });
    expect(r.state.townVisit).toEqual({ mercyOffered: false });
  });
});

describe("全滅の発生（CB-53、CB-06、CH-44）", () => {
  test("CB-06/CB-53 遭遇の SAN（未鑑定）で全員 SAN 0 になると、先手判定の dice を出さずに battleEnd(wipe) → 全滅処理 → 街", () => {
    const s = patch(dived(1), Object.fromEntries(["c1", "c2", "c3", "c4", "c5", "c6"].map((id) => [id, { san: 2 }])));
    const ctx = makeContext(cloneState(s), data);
    startBattle(ctx, { kind: "random", inRoom: false }, [{ monsterId: "kobold", count: 1 }]);
    expectKnownStringKeys(ctx.events);
    const ks = kindsOf(ctx.events);
    expect(eventsOf(ctx.events, "dice").map((e) => e.label.key)).toEqual(["dice.wipe"]);
    expect(ks.indexOf("message:battle.unidentified")).toBeLessThan(ks.indexOf("battleEnd"));
    expect(ks.slice(ks.indexOf("battleEnd"), ks.indexOf("battleEnd") + 3)).toEqual(["battleEnd", "message:battle.wipe", "message:wipe.intro"]);
    expect(eventsOf(ctx.events, "screen")).toEqual([
      { kind: "screen", to: "battle" },
      { kind: "screen", to: "town" },
    ]);
    expect(ctx.state.screen).toBe("town");
    expect(ctx.state.battle).toBeNull();
  });

  test("CB-53 戦闘の全滅では、眠っている者の睡眠を解いてから全滅処理（battle.wipe → statusChanged sleep off → wipe.intro）", () => {
    // 睡眠と麻痺を併せ持つ者は「睡眠だけ」ではないので全滅になる
    const s0 = patch(dived(1), {
      c1: { hp: 1 },
      c2: { status: ["sleep", "paralysis"] },
      c3: PARA,
      c4: PARA,
      c5: PARA,
      c6: PARA,
    });
    const d = dataWith({ combat: ALWAYS_HIT });
    const s = withBattle(s0, [{ monsterId: "kobold", hps: [50] }], { identified: ["kobold"], inputs: { c1: { type: "defend" } } });
    const r = execute(s, { type: "battle.resolve" }, d);
    expectKnownStringKeys(r.events, d);
    const ks = kindsOf(r.events);
    const end = ks.indexOf("battleEnd");
    expect(ks.slice(end, end + 4)).toEqual(["battleEnd", "message:battle.wipe", "statusChanged", "message:wipe.intro"]);
    expect(r.events[end + 2]).toEqual({ kind: "statusChanged", id: "c2", status: "sleep", on: false });
    expect(r.state.screen).toBe("town");
  });

  test("H4 wipeIfNoneCanAct は迷宮の戦闘外で行動可能な者がいないときだけ全滅処理をする（街・戦闘中・行動可能な者がいるときは何もしない）。dungeon.turn でも同じ execute の中で起きる", () => {
    const allPara = Object.fromEntries(["c1", "c2", "c3", "c4", "c5", "c6"].map((id) => [id, PARA]));
    const cases: GameState[] = [
      patch(newGame(1), allPara), // 街
      withBattle(patch(dived(1), allPara), [{ monsterId: "kobold", hps: [5] }]), // 戦闘中
      patch(dived(1), { ...allPara, c6: {} }), // 1 人は動ける
    ];
    for (const s of cases) {
      const ctx = makeContext(cloneState(s), data);
      wipeIfNoneCanAct(ctx);
      expect(ctx.events).toEqual([]);
      expect(ctx.state).toEqual(s);
    }
    const s = patch(dived(1), allPara);
    const m: RngState = cloneRng(s.rng);
    mirrorWipeRolls(m, 5);
    const r = execute(s, { type: "dungeon.turn", dir: "left" }, data);
    expectKnownStringKeys(r.events);
    expect(kindsOf(r.events).slice(0, 2)).toEqual(["turned", "message:wipe.intro"]);
    expect(r.state.screen).toBe("town");
    expect(r.state.rng).toEqual(m);
  });
});

// ---------------------------------------------------------------------------
// TW-27: 全滅後の総資産は、同じ状態から徒歩で帰還した場合（0G。糸を消費しない）を上回らない（代替案 A で確定）。
// 徒歩の帰還は returnToTown（テレポーターと同値）。糸で帰ると糸の売値 25 だけ下がるので、糸とは比べない。

/** 同じ状態から徒歩で帰還した state（DG-06。糸を消費しない） */
function returnedOf(s: GameState, d: GameData = data): GameState {
  const ctx = makeContext(cloneState(s), d);
  returnToTown(ctx, "dungeon.exit");
  return ctx.state;
}

/** TW-27 の比較: 総資産と、成分ごと（所持金、所持品の実体の集合、各人の EXP） */
function expectWipeNotBetter(s: GameState, d: GameData = data): { w: GameState; r: GameState } {
  const w = wipeOf(s, d).state;
  const r = returnedOf(s, d);
  expectStateInvariants(w);
  expectStateInvariants(r);
  expect(assetValue(w, d)).toBeLessThanOrEqual(assetValue(r, d));
  expect(w.gold).toBeLessThanOrEqual(r.gold);
  for (const id of Object.keys(w.items)) expect(r.items[id]).toBeDefined();
  w.party.forEach((c, i) => expect(c.exp).toBeLessThanOrEqual(r.party[i]!.exp));
  return { w, r };
}

describe("TW-27 全滅の方が得にならない", () => {
  test("TW-27 assetValue = 所持金 + 銀行 + 全実体の売値 floor(price × 0.5) + 全員の EXP（手計算）", () => {
    const s = base();
    // 長剣 100 ×2、革鎧 50 ×4、木の盾 40、鎖帷子 300、短剣 15、杖 10 ×2、革兜 30、短弓 80、薬草 10 ×3、解毒草 15、帰還の糸 50
    const sale = 50 * 2 + 25 * 4 + 20 + 150 + 7 + 5 * 2 + 15 + 40 + 5 * 3 + 7 + 25;
    expect(assetValue(s, data)).toBe(300 + sale + 1600 + 2400 + 1000 + 1100 + 50);
    expect(itemSaleValue(data, "return_thread")).toBe(25);
  });

  test("TW-27 境界: 台帳に金と品、非装備・装備の品、Lv2〜4 の EXP の一行で、2d10 の合計 2〜20 のどれでも全滅後の総資産 ≤ 徒歩で帰還した後（成分ごとにも ≤）", () => {
    const s0 = withLedger(base());
    for (let t = 2; t <= 20; t++) {
      const { w, r } = expectWipeNotBetter(withTotal(s0, t));
      // 台帳の全損だけで必ず下回る（短剣の売値 7 と台帳の金 40）
      expect(assetValue(r, data) - assetValue(w, data)).toBeGreaterThanOrEqual(47);
    }
  });

  test("TW-27 損失なし: 全帯の比率と itemLoss を 0 にした data で、台帳が空・糸を持つ一行でも全滅後の総資産は徒歩で帰還した後と等しい（上回らない）", () => {
    const d = loadRuleData();
    for (const b of d.penaltyTable.bands) {
      b.goldLossRatio = 0;
      b.itemLoss = 0;
      b.expLossRatio = 0;
    }
    const s = base();
    expect(s.party[4]!.inventory.map((id) => s.items[id]!.itemId)).toEqual(["return_thread"]);
    for (let t = 2; t <= 20; t++) {
      const { w, r } = expectWipeNotBetter(withTotal(s, t), d);
      expect(assetValue(w, d)).toBe(assetValue(r, d));
    }
  });

  test("TW-27 比較の基準が徒歩の帰還である理由: 糸で帰った場合と比べると、台帳が空で奇跡（損失 0）の全滅は糸の売値 25 だけ上回る", () => {
    const s = withTotal(base(), 20);
    const thread = s.party[4]!.inventory[0]!;
    const byThread = execute(s, { type: "dungeon.useItem", memberId: "c5", itemId: thread }, data);
    expectKnownStringKeys(byThread.events);
    expect(byThread.state.screen).toBe("town");
    const w = wipeOf(s).state;
    expect(assetValue(w, data) - assetValue(byThread.state, data)).toBe(25);
  });

  test("TW-27 性質: 200 シード（ボットの rng で台帳の金と品・所持金・追加の品・EXP・生死・状態を作る）で、全滅後の総資産 ≤ 徒歩で帰還した後。両方の state が不変条件を満たす", () => {
    const itemIds = data.items.map((i) => i.id);
    for (let k = 1; k <= 200; k++) {
      const bot = createRng(k + 30_000);
      const ctx = makeContext(cloneState(dived(k)), data);
      const s = ctx.state;
      for (const ch of s.party) {
        ch.exp = randInt(bot, 0, 4000);
        levelUpWhilePossible(ctx, ch);
        const life = randInt(bot, 0, 5);
        if (life === 0) Object.assign(ch, DEAD);
        else if (life === 1) Object.assign(ch, ASH);
        else if (life === 2) ch.status = ["paralysis"];
      }
      s.gold = randInt(bot, 0, 3000);
      s.dive!.ledger.gold = randInt(bot, 0, s.gold);
      const extra = randInt(bot, 0, 4);
      for (let i = 0; i < extra; i++) {
        const id = createItemInstance(s, itemIds[randInt(bot, 0, itemIds.length - 1)]!, randInt(bot, 0, 1) === 1);
        s.party[randInt(bot, 0, s.party.length - 1)]!.inventory.push(id);
        if (randInt(bot, 0, 1) === 1) s.dive!.ledger.items.push(id);
      }
      s.rng = createRng(k);
      expectStateInvariants(s);
      expectWipeNotBetter(s);
    }
  });
});
