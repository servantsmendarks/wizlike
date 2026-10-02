// キャンプのコマンド（MG-44 dungeon.cast、CH-03 party.reorder、CH-76 party.equip / unequip、CH-77 party.identify）と campMenu（UI-53 / TW-03）。
// 既定のパーティ（newGame）: c1 アルド 戦士（i1 長剣 / i2 革鎧 / i3 木の盾、inv i4 薬草）、c2 ベルク 戦士（i5 長剣 / i6 鎖帷子）、
// c3 キリ 盗賊（i7 短剣 / i8 革鎧 / i9 革兜、inv i10 薬草）、c4 ドナ 僧侶（i11 杖 / i12 革鎧、inv i13 解毒草、呪文 heal）、
// c5 エル 魔術師（i14 杖、inv i15 帰還の糸、呪文 fire_arrow / sleep_mist）、c6 フィン 盗賊（i16 短弓 / i17 革鎧、inv i18 薬草）。
import { describe, expect, test } from "vitest";
import type { GameData } from "../src/core/data";
import { execute } from "../src/core/engine";
import { cloneRng, createRng, randInt, rollDice } from "../src/core/rng";
import { campMenu, campSummary, checkCast, checkEquip, checkUnequip } from "../src/core/rules/camp";
import { frontLineIds } from "../src/core/rules/combat-calc";
import { resurrectRate } from "../src/core/rules/town";
import { cloneState, createItemInstance } from "../src/core/state";
import type { Character, Command, GameEvent, GameState } from "../src/core/types";
import { dived, withBattle } from "./helpers/battle";
import { createInitialState } from "../src/core/engine";
import { data, expectKnownStringKeys, expectStateInvariants, loadFreshData, newGame, seedWithFirstD100 } from "./helpers/core";
import { atEvent } from "./helpers/events";

function member(s: GameState, id: string): Character {
  const c = s.party.find((x) => x.id === id);
  if (c === undefined) throw new Error(`no member ${id}`);
  return c;
}

/** base の複製に patch を当てたもの */
function patched(base: GameState, patches: Record<string, Partial<Character>> = {}): GameState {
  const s = cloneState(base);
  for (const [id, p] of Object.entries(patches)) {
    const i = s.party.findIndex((c) => c.id === id);
    s.party[i] = { ...s.party[i]!, ...structuredClone(p) };
  }
  return s;
}
const inDungeon = (patches: Record<string, Partial<Character>> = {}) => patched(dived(1), patches);
const inTown = (patches: Record<string, Partial<Character>> = {}) => patched(newGame(1), patches);

function ok(s: GameState, cmd: Command, d: GameData = data): { state: GameState; events: GameEvent[] } {
  const r = execute(s, cmd, d);
  const rej = r.events.find((e) => e.kind === "rejected");
  if (rej !== undefined) throw new Error(`rejected: ${JSON.stringify(rej)}`);
  expectKnownStringKeys(r.events, d);
  expectStateInvariants(r.state);
  return r;
}

function expectRejected(s: GameState, cmd: Command, reason: string, d: GameData = data): void {
  const before = JSON.stringify(s);
  const r = execute(s, cmd, d);
  expect(r.state).toBe(s);
  expect(r.events).toEqual([{ kind: "rejected", command: cmd.type, reason }]);
  expect(JSON.stringify(s)).toBe(before);
}

const cast = (memberId: string, spellId: string, targetId?: string): Command =>
  targetId === undefined ? { type: "dungeon.cast", memberId, spellId } : { type: "dungeon.cast", memberId, spellId, targetId };

const PRIEST_ALL = { knownSpells: ["heal", "cure_poison", "return", "resurrect"], mp: 30, mpMax: 30 };

function pending(s: GameState): GameState {
  const p = cloneState(s);
  p.pendingChoice = { kind: "stairs", promptKey: "dungeon.stairsUp", options: [{ id: "stay", labelKey: "dungeon.choice.stay" }] };
  return p;
}

function battleOf(s: GameState): GameState {
  return withBattle(s, [{ monsterId: data.monsters[0]!.id, hps: [3] }]);
}

// ---------------------------------------------------------------------------

describe("MG-44 dungeon.cast の受け付け", () => {
  test("MG-32/MG-44 理由の順: not in dungeon（街・戦闘中・title）→ no such member → cannot act → unknown spell → not usable here → no mp → bad target。同じ参照で乱数も変えない", () => {
    expectRejected(newGame(1), cast("c4", "heal", "c1"), "not in dungeon");
    expectRejected(battleOf(inDungeon()), cast("c4", "heal", "c1"), "not in dungeon");
    expectRejected(createInitialState(1, data), cast("c4", "heal", "c1"), "not in dungeon");
    expectRejected(inDungeon(), cast("c9", "heal", "c1"), "no such member");
    for (const p of [{ status: ["sleep"] }, { san: 0 }, { life: "dead", hp: 0 }] as Partial<Character>[]) {
      expectRejected(inDungeon({ c4: p }), cast("c4", "heal", "c1"), "cannot act");
    }
    expectRejected(inDungeon(), cast("c4", "nope", "c1"), "unknown spell");
    expectRejected(inDungeon(), cast("c4", "cure_poison", "c1"), "unknown spell"); // 知らない呪文
    expectRejected(inDungeon(), cast("c5", "fire_arrow"), "not usable here"); // battle 専用
    expectRejected(inDungeon({ c4: { knownSpells: ["heal", "blessing"] } }), cast("c4", "blessing"), "not usable here");
    expectRejected(inDungeon({ c4: { mp: 1 } }), cast("c4", "heal", "c1"), "no mp");
    expectRejected(inDungeon(), cast("c4", "heal"), "bad target");
    expectRejected(inDungeon({ c1: { life: "dead", hp: 0 } }), cast("c4", "heal", "c1"), "bad target");
    expectRejected(inDungeon({ c4: PRIEST_ALL }), cast("c4", "resurrect", "c1"), "bad target"); // alive
    expectRejected(inDungeon({ c4: PRIEST_ALL, c1: { life: "ash", hp: 0 } }), cast("c4", "resurrect", "c1"), "bad target");
  });

  test("MG-44 保留中の選択があれば choice pending", () => {
    expectRejected(pending(inDungeon()), cast("c4", "heal", "c1"), "choice pending");
  });
});

describe("MG-44 dungeon.cast の効果", () => {
  test("MG-44/F9 heal: mpChanged → battle.cast → hpChanged → battle.heal。1d8 を 1 回（鏡の rng）。spell イベントは出さない", () => {
    const s = inDungeon({ c1: { hp: 1 } });
    const m = cloneRng(s.rng);
    const roll = rollDice(m, "1d8").total;
    const c4 = member(s, "c4");
    const c1 = member(s, "c1");
    const next = Math.min(c1.hpMax, 1 + roll);
    const r = ok(s, cast("c4", "heal", "c1"));
    expect(r.events).toEqual([
      { kind: "mpChanged", id: "c4", delta: -2, mp: c4.mp - 2 },
      { kind: "message", key: "battle.cast", params: { actor: "ドナ", spell: "治癒" } },
      { kind: "hpChanged", id: "c1", delta: next - 1, hp: next },
      { kind: "message", key: "battle.heal", params: { target: "アルド", amount: next - 1 } },
    ]);
    expect(member(r.state, "c4").mp).toBe(c4.mp - 2);
    expect(member(r.state, "c1").hp).toBe(next);
    expect(r.state.rng).toEqual(m);
    expect(r.state.screen).toBe("dungeon");
  });

  test("MG-44/F9 cure_poison: 毒が消える（statusChanged off → battle.cured）。毒が無ければ battle.noEffect。乱数は使わない", () => {
    const s = inDungeon({ c4: PRIEST_ALL, c2: { status: ["poison"] } });
    const r = ok(s, cast("c4", "cure_poison", "c2"));
    expect(r.events).toEqual([
      { kind: "mpChanged", id: "c4", delta: -3, mp: 27 },
      { kind: "message", key: "battle.cast", params: { actor: "ドナ", spell: "解毒" } },
      { kind: "statusChanged", id: "c2", status: "poison", on: false },
      { kind: "message", key: "battle.cured", params: { target: "ベルク" } },
    ]);
    expect(member(r.state, "c2").status).toEqual([]);
    expect(r.state.rng).toEqual(s.rng);
    const r2 = ok(s, cast("c4", "cure_poison", "c3"));
    expect(r2.events.slice(2)).toEqual([{ kind: "message", key: "battle.noEffect", params: { target: "キリ" } }]);
  });

  test("MG-40 return: mpChanged → battle.cast → dungeon.returnSpell → town.enter → screen town。台帳の品と金は残る（DG-43）。乱数なし", () => {
    const s = inDungeon({ c4: PRIEST_ALL });
    s.gold = 350;
    s.dive!.ledger = { items: ["i4"], gold: 50 };
    const r = ok(s, cast("c4", "return", "c1")); // targetId は無視
    expect(r.events).toEqual([
      { kind: "mpChanged", id: "c4", delta: -8, mp: 22 },
      { kind: "message", key: "battle.cast", params: { actor: "ドナ", spell: "帰還" } },
      { kind: "message", key: "dungeon.returnSpell" },
      { kind: "message", key: "town.enter" },
      { kind: "screen", to: "town" },
    ]);
    expect(r.state.dive).toBeNull();
    expect(r.state.screen).toBe("town");
    expect(r.state.gold).toBe(350);
    expect(r.state.items["i4"]).toEqual(s.items["i4"]);
    expect(r.state.rng).toEqual(s.rng);
  });

  test("MG-42 resurrect: d100 ≤ resurrectRate（寺院と同じ式）なら alive・HP 1、外れたら ash。どちらも MP を消費し、randInt(1,100) を 1 回だけ引く", () => {
    const head: GameEvent[] = [
      { kind: "mpChanged", id: "c4", delta: -15, mp: 15 },
      { kind: "message", key: "battle.cast", params: { actor: "ドナ", spell: "蘇生" } },
      { kind: "message", key: "dungeon.cast.resurrectRoll", params: { name: "アルド" } },
    ];
    // 成功: dived(1) の最初の d100 は 14 ≤ 74
    const s = inDungeon({ c4: PRIEST_ALL, c1: { life: "dead", hp: 0 } });
    const rate = resurrectRate(member(s, "c1"), data);
    expect(rate).toBe(Math.min(95, 50 + 12 * 2)); // c1 の vit 12 → 74
    const m = cloneRng(s.rng);
    expect(randInt(m, 1, 100)).toBe(14);
    const r = ok(s, cast("c4", "resurrect", "c1"));
    expect(r.state.rng).toEqual(m);
    expect(r.events).toEqual([
      ...head,
      { kind: "lifeChanged", id: "c1", life: "alive" },
      { kind: "hpChanged", id: "c1", delta: 1, hp: 1 },
      { kind: "message", key: "dungeon.cast.resurrectOk", params: { name: "アルド" } },
    ]);
    // 失敗: 最初の d100 が 74 を超えるシードに差し替える
    const { seed, roll } = seedWithFirstD100((x) => x > 74);
    expect(roll).toBeGreaterThan(74);
    const f = inDungeon({ c4: PRIEST_ALL, c1: { life: "dead", hp: 0 } });
    f.rng = createRng(seed);
    const fm = createRng(seed);
    randInt(fm, 1, 100);
    const rf = ok(f, cast("c4", "resurrect", "c1"));
    expect(rf.state.rng).toEqual(fm);
    expect(rf.events).toEqual([
      ...head,
      { kind: "lifeChanged", id: "c1", life: "ash" },
      { kind: "message", key: "dungeon.cast.resurrectFail", params: { name: "アルド" } },
    ]);
  });

  test("MG-42 resurrect の両方の分岐（templeSuccessBase を上書き）: 成功は alive・HP 1、失敗は ash。成否に関わらず MP 15 を消費", () => {
    const always = loadFreshData();
    always.config.economy.templeSuccessBase = 100;
    always.config.economy.templeSuccessMax = 100;
    const never = loadFreshData();
    never.config.economy.templeSuccessBase = -100;
    const s = inDungeon({ c4: PRIEST_ALL, c1: { life: "dead", hp: 0 } });
    const a = ok(s, cast("c4", "resurrect", "c1"), always);
    expect(member(a.state, "c1")).toMatchObject({ life: "alive", hp: 1 });
    expect(member(a.state, "c4").mp).toBe(15);
    expect(a.events.at(-1)).toEqual({ kind: "message", key: "dungeon.cast.resurrectOk", params: { name: "アルド" } });
    const n = ok(s, cast("c4", "resurrect", "c1"), never);
    expect(member(n.state, "c1")).toMatchObject({ life: "ash", hp: 0 });
    expect(member(n.state, "c4").mp).toBe(15);
    expect(n.events.at(-1)).toEqual({ kind: "message", key: "dungeon.cast.resurrectFail", params: { name: "アルド" } });
    expect(n.events.some((e) => e.kind === "dice")).toBe(false);
  });

  test("TW-07 寺院の蘇生は resurrectRate / rollResurrect に切り出した後も、イベント順と乱数が同じ（d100 を 1 回）", () => {
    // 成功: newGame(1) の最初の d100 は 49 ≤ 74（c1 の vit 12）
    const s = inTown({ c1: { life: "dead", hp: 0 } });
    s.gold = 10000;
    expect(resurrectRate(member(s, "c1"), data)).toBe(74);
    const m = cloneRng(s.rng);
    expect(randInt(m, 1, 100)).toBe(49);
    const r = ok(s, { type: "town.temple", memberId: "c1", service: "resurrect" });
    expect(r.state.rng).toEqual(m);
    expect(r.events).toEqual([
      { kind: "message", key: "town.temple.resurrectRoll", params: { name: "アルド" } },
      { kind: "lifeChanged", id: "c1", life: "alive" },
      { kind: "hpChanged", id: "c1", delta: 1, hp: 1 },
      { kind: "message", key: "town.temple.resurrectOk", params: { name: "アルド" } },
    ]);
    // 失敗: 最初の d100 が 74 を超えるシードに差し替える
    const { seed } = seedWithFirstD100((x) => x > 74);
    const f = inTown({ c1: { life: "dead", hp: 0 } });
    f.gold = 10000;
    f.rng = createRng(seed);
    const fm = createRng(seed);
    randInt(fm, 1, 100);
    const rf = ok(f, { type: "town.temple", memberId: "c1", service: "resurrect" });
    expect(rf.state.rng).toEqual(fm);
    expect(rf.events).toEqual([
      { kind: "message", key: "town.temple.resurrectRoll", params: { name: "アルド" } },
      { kind: "lifeChanged", id: "c1", life: "ash" },
      { kind: "message", key: "town.temple.resurrectFail", params: { name: "アルド" } },
    ]);
  });
});

// ---------------------------------------------------------------------------

describe("CH-03 party.reorder", () => {
  const order = ["c4", "c2", "c3", "c1", "c5", "c6"];

  test("CH-03 街と迷宮の戦闘外で受け付ける。order の順に並べ替えて camp.reordered。リーダーも動かせる。乱数なし", () => {
    for (const s of [inTown(), inDungeon()]) {
      const r = ok(s, { type: "party.reorder", order });
      expect(r.events).toEqual([{ kind: "message", key: "camp.reordered" }]);
      expect(r.state.party.map((c) => c.id)).toEqual(order);
      expect(r.state.party[3]!.isLeader).toBe(true);
      expect(r.state.rng).toEqual(s.rng);
      expect(r.state.party.map((c) => c.id)).not.toEqual(s.party.map((c) => c.id));
    }
  });

  test("CH-03/CB-14 並べ替えた後は新しい並びで前衛が決まる（frontLineIds）", () => {
    const r = ok(inDungeon(), { type: "party.reorder", order });
    expect(frontLineIds(r.state, data)).toEqual(["c4", "c2", "c3"]);
  });

  test("CH-03 rejected: wrong screen（戦闘中・title）→ bad order（配列でない・長さ違い・重複・未知・文字列でない）→ no change。保留中は choice pending", () => {
    expectRejected(battleOf(inDungeon()), { type: "party.reorder", order }, "wrong screen");
    expectRejected(createInitialState(1, data), { type: "party.reorder", order: [] }, "wrong screen");
    const s = inTown();
    for (const bad of [
      "c1",
      ["c1", "c2", "c3", "c4", "c5"],
      ["c1", "c1", "c3", "c4", "c5", "c6"],
      ["c1", "c2", "c3", "c4", "c5", "c9"],
      ["c1", "c2", "c3", "c4", "c5", 6],
    ]) {
      expectRejected(s, { type: "party.reorder", order: bad as string[] }, "bad order");
    }
    expectRejected(s, { type: "party.reorder", order: ["c1", "c2", "c3", "c4", "c5", "c6"] }, "no change");
    expectRejected(pending(inDungeon()), { type: "party.reorder", order }, "choice pending");
  });
});

// ---------------------------------------------------------------------------

/** c5（魔術師）の inventory に itemId の実体を作って足した state と、その実体 id */
function give(base: GameState, memberId: string, itemId: string, identified = true): { s: GameState; id: string } {
  const s = cloneState(base);
  const id = createItemInstance(s, itemId, identified);
  member(s, memberId).inventory.push(id);
  return { s, id };
}

describe("CH-76 party.equip / party.unequip", () => {
  test("CH-76 入れ替え: 旧品は inventory の同じ位置に入る。使用枠と台帳は変わらない。message camp.equipped。乱数なし", () => {
    const base = inDungeon();
    const { s, id } = give(base, "c3", "short_bow"); // c3 inv [i10 薬草, i19 短弓]
    member(s, "c3").inventory = [id, "i10"];
    s.dive!.ledger.items = [id];
    const r = ok(s, { type: "party.equip", memberId: "c3", instanceId: id });
    expect(r.events).toEqual([{ kind: "message", key: "camp.equipped", params: { name: "キリ", item: "短弓" } }]);
    const c3 = member(r.state, "c3");
    expect(c3.equipment.weapon).toBe(id);
    expect(c3.inventory).toEqual(["i7", "i10"]);
    expect(r.state.dive!.ledger.items).toEqual([id]);
    expect(r.state.rng).toEqual(s.rng);
  });

  test("CH-76 空きの枠に装備すると inventory から消える（街でも受け付ける）", () => {
    const { s, id } = give(inTown(), "c5", "leather_cap");
    const r = ok(s, { type: "party.equip", memberId: "c5", instanceId: id });
    expect(member(r.state, "c5").equipment.helm).toBe(id);
    expect(member(r.state, "c5").inventory).toEqual(["i15"]);
  });

  test("CH-73/76 呪われた品を装備すると camp.cursed が続き、外せなくなる（未鑑定のままでも cursed）", () => {
    const { s, id } = give(inDungeon(), "c3", "cursed_dagger");
    const r = ok(s, { type: "party.equip", memberId: "c3", instanceId: id });
    expect(r.events).toEqual([
      { kind: "message", key: "camp.equipped", params: { name: "キリ", item: "血濡れの短剣" } },
      { kind: "message", key: "camp.cursed", params: { item: "血濡れの短剣" } },
    ]);
    expectRejected(r.state, { type: "party.unequip", memberId: "c3", slot: "weapon" }, "cursed");
    // 未鑑定のまま装備している（鑑定前に装備させた状態を直接作る）
    const u = cloneState(r.state);
    u.items[id]!.identified = false;
    expectRejected(u, { type: "party.unequip", memberId: "c3", slot: "weapon" }, "cursed");
  });

  test("CH-76 party.equip の理由の順: wrong screen → no such member → cannot act → item not in inventory → not equipment → not identified → class cannot equip → slot cursed", () => {
    const { s, id } = give(inDungeon(), "c5", "long_sword");
    expectRejected(battleOf(s), { type: "party.equip", memberId: "c5", instanceId: id }, "wrong screen");
    expectRejected(s, { type: "party.equip", memberId: "c9", instanceId: id }, "no such member");
    expectRejected(patched(s, { c5: { status: ["sleep"] } }), { type: "party.equip", memberId: "c5", instanceId: id }, "cannot act");
    expectRejected(s, { type: "party.equip", memberId: "c5", instanceId: "i4" }, "item not in inventory"); // 他人の品
    expectRejected(s, { type: "party.equip", memberId: "c5", instanceId: "i14" }, "item not in inventory"); // 装備中
    expectRejected(s, { type: "party.equip", memberId: "c5", instanceId: "i15" }, "not equipment"); // 帰還の糸
    const un = give(inDungeon(), "c5", "dagger", false);
    expectRejected(un.s, { type: "party.equip", memberId: "c5", instanceId: un.id }, "not identified");
    expectRejected(s, { type: "party.equip", memberId: "c5", instanceId: id }, "class cannot equip"); // 長剣を魔術師
    const cur = give(inDungeon(), "c3", "cursed_dagger");
    const equipped = ok(cur.s, { type: "party.equip", memberId: "c3", instanceId: cur.id }).state;
    const d2 = give(equipped, "c3", "dagger");
    expectRejected(d2.s, { type: "party.equip", memberId: "c3", instanceId: d2.id }, "slot cursed");
  });

  test("CH-76 party.unequip: inventory の末尾に入る。message camp.unequipped。理由: bad slot → slot empty", () => {
    const s = inDungeon();
    const r = ok(s, { type: "party.unequip", memberId: "c1", slot: "shield" });
    expect(r.events).toEqual([{ kind: "message", key: "camp.unequipped", params: { name: "アルド", item: "木の盾" } }]);
    expect(member(r.state, "c1").equipment.shield).toBeNull();
    expect(member(r.state, "c1").inventory).toEqual(["i4", "i3"]);
    expectRejected(s, { type: "party.unequip", memberId: "c1", slot: "tail" as "helm" }, "bad slot");
    expectRejected(s, { type: "party.unequip", memberId: "c1", slot: "helm" }, "slot empty");
    expectRejected(battleOf(s), { type: "party.unequip", memberId: "c1", slot: "shield" }, "wrong screen");
    expectRejected(patched(s, { c1: { life: "dead", hp: 0 } }), { type: "party.unequip", memberId: "c1", slot: "shield" }, "cannot act");
  });
});

// ---------------------------------------------------------------------------

/** c5 を司教にした state（prototypeParty に司教はいないので、テストで職業を差し替える） */
function withBishop(base: GameState): GameState {
  return patched(base, { c5: { classId: "bishop" } });
}

describe("CH-77 party.identify", () => {
  test("CH-77 司教が他人の未鑑定品を鑑定する: identified true、message camp.identified{name, old, item}。乱数は変わらない", () => {
    const { s, id } = give(withBishop(inDungeon()), "c1", "dagger", false);
    const r = ok(s, { type: "party.identify", memberId: "c5", instanceId: id });
    expect(r.events).toEqual([{ kind: "message", key: "camp.identified", params: { name: "エル", old: "短剣", item: "短剣" } }]);
    expect(r.state.items[id]!.identified).toBe(true);
    expect(r.state.rng).toEqual(s.rng);
  });

  test("CH-73/77 呪われた品を鑑定すると camp.identifiedCursed が続く（街でも受け付ける）", () => {
    const { s, id } = give(withBishop(inTown()), "c3", "cursed_dagger", false);
    const r = ok(s, { type: "party.identify", memberId: "c5", instanceId: id });
    expect(r.events).toEqual([
      { kind: "message", key: "camp.identified", params: { name: "エル", old: "短剣？", item: "血濡れの短剣" } },
      { kind: "message", key: "camp.identifiedCursed", params: { item: "血濡れの短剣" } },
    ]);
  });

  test("CH-77 理由の順: wrong screen → no such member → cannot identify → cannot act → no such item → already identified", () => {
    const { s, id } = give(withBishop(inDungeon()), "c1", "dagger", false);
    expectRejected(battleOf(s), { type: "party.identify", memberId: "c5", instanceId: id }, "wrong screen");
    expectRejected(s, { type: "party.identify", memberId: "c9", instanceId: id }, "no such member");
    expectRejected(s, { type: "party.identify", memberId: "c4", instanceId: id }, "cannot identify"); // 僧侶
    expectRejected(patched(s, { c5: { status: ["sleep"] } }), { type: "party.identify", memberId: "c5", instanceId: id }, "cannot act");
    expectRejected(s, { type: "party.identify", memberId: "c5", instanceId: "i1" }, "no such item"); // 装備中は対象外
    expectRejected(s, { type: "party.identify", memberId: "c5", instanceId: "i999" }, "no such item");
    expectRejected(s, { type: "party.identify", memberId: "c5", instanceId: "i4" }, "already identified");
  });
});

// ---------------------------------------------------------------------------

describe("UI-53/TW-03 campMenu", () => {
  test("UI-53/TW-03 迷宮の戦闘外と街で非 null、戦闘中・保留中・title で null", () => {
    expect(campMenu(inDungeon(), data)?.place).toBe("dungeon");
    expect(campMenu(inTown(), data)?.place).toBe("town");
    expect(campMenu(battleOf(inDungeon()), data)).toBeNull();
    expect(campMenu(pending(inDungeon()), data)).toBeNull();
    expect(campMenu(createInitialState(1, data), data)).toBeNull();
  });

  test("UI-53/UI-55 screen event（イベントの選択を待つ間）では campMenu が null", () => {
    const d = loadFreshData();
    d.config.events.impulseThreshold = 1000; // 衝動を起こさず選択を待たせる
    for (const def of d.dungeons) def.encounterRate = { room: 0, corridor: 0 };
    const r = execute(atEvent("glowing_tablet").state, { type: "dungeon.move" }, d);
    expect(r.state.screen).toBe("event");
    expect(campMenu(r.state, data)).toBeNull();
  });

  test("UI-53 spells: 街では []。迷宮では heal / cure_poison / return / resurrect だけで、usable は checkCast と一致する", () => {
    expect(campMenu(inTown({ c4: PRIEST_ALL }), data)!.members.every((m) => m.spells.length === 0)).toBe(true);
    const s = inDungeon({ c4: { ...PRIEST_ALL, knownSpells: ["heal", "blessing", "cure_poison", "identify", "return", "resurrect"], mp: 8 } });
    const m = campMenu(s, data)!;
    const c4 = m.members.find((x) => x.id === "c4")!;
    expect(c4.spells).toEqual([
      { spellId: "heal", name: "治癒", mp: 2, target: "ally", usable: true },
      { spellId: "cure_poison", name: "解毒", mp: 3, target: "ally", usable: true },
      { spellId: "return", name: "帰還", mp: 8, target: "none", usable: true },
      { spellId: "resurrect", name: "蘇生", mp: 15, target: "dead", usable: false }, // MP 不足・死者なし
    ]);
    expect(m.members.find((x) => x.id === "c5")!.spells).toEqual([]); // fire_arrow / sleep_mist は battle 専用
    for (const sp of c4.spells) {
      const probe = sp.target === "ally" ? m.allies[0]?.id : sp.target === "dead" ? m.dead[0]?.id : undefined;
      expect(sp.usable).toBe(checkCast(s, data, "c4", sp.spellId, probe) === null);
    }
    // 死者がいて MP が足りれば蘇生も使える
    const d = inDungeon({ c4: PRIEST_ALL, c2: { life: "dead", hp: 0 } });
    const md = campMenu(d, data)!;
    expect(md.dead).toEqual([{ id: "c2", name: "ベルク" }]);
    expect(md.allies.map((a) => a.id)).toEqual(["c1", "c3", "c4", "c5", "c6"]);
    expect(md.members.find((x) => x.id === "c4")!.spells.find((x) => x.spellId === "resurrect")!.usable).toBe(true);
  });

  test("UI-53/CH-76 slots の canUnequip と equipCandidates の block が check 関数と一致する。row は frontRow による", () => {
    let s = give(inDungeon(), "c5", "long_sword").s; // class
    s = give(s, "c5", "dagger", false).s; // unidentified
    s = give(s, "c5", "leather_cap").s; // ok
    s = give(s, "c3", "cursed_dagger").s;
    s = ok(s, { type: "party.equip", memberId: "c3", instanceId: "i22" }).state;
    s = patched(s, { c2: { status: ["sleep"] } });
    s = give(s, "c2", "leather_cap").s; // cannotAct（i23）
    const m = campMenu(s, data)!;
    expect(m.members.map((x) => x.row)).toEqual(["front", "front", "front", "back", "back", "back"]);
    expect(m.members.find((x) => x.id === "c5")!.equipCandidates).toEqual([
      { instanceId: "i19", name: "長剣", slot: "weapon", block: "class" },
      { instanceId: "i20", name: "短剣", slot: "weapon", block: "unidentified" },
      { instanceId: "i21", name: "革兜", slot: "helm", block: null },
    ]);
    // 呪いの短剣を装備した c3 の inventory は [i10 薬草, i7 短剣（入れ替えた旧品）]
    expect(m.members.find((x) => x.id === "c3")!.equipCandidates).toEqual([
      { instanceId: "i7", name: "短剣", slot: "weapon", block: "cursedSlot" },
    ]);
    expect(m.members.find((x) => x.id === "c2")!.equipCandidates).toEqual([
      { instanceId: "i23", name: "革兜", slot: "helm", block: "cannotAct" },
    ]);
    const c3 = m.members.find((x) => x.id === "c3")!;
    expect(c3.slots.map((x) => x.slot)).toEqual(["weapon", "armor", "shield", "helm", "gauntlet", "accessory"]);
    expect(c3.slots[0]).toEqual({ slot: "weapon", instanceId: "i22", name: "血濡れの短剣", cursed: true, canUnequip: false });
    expect(c3.slots[2]).toEqual({ slot: "shield", instanceId: null, name: null, cursed: false, canUnequip: false });
    for (const mem of m.members) {
      for (const sl of mem.slots) {
        if (sl.instanceId !== null) expect(sl.canUnequip).toBe(checkUnequip(s, data, mem.id, sl.slot) === null);
      }
      for (const c of mem.equipCandidates) expect(c.block === null).toBe(checkEquip(s, data, mem.id, c.instanceId) === null);
    }
  });

  test("UI-53/CH-73 未鑑定の呪われた品を装備していると、slots の cursed は false（見えない）だが外せない", () => {
    const g = give(inDungeon(), "c3", "cursed_dagger");
    const s = ok(g.s, { type: "party.equip", memberId: "c3", instanceId: g.id }).state;
    const u = cloneState(s);
    u.items[g.id]!.identified = false;
    const w = campMenu(u, data)!.members.find((x) => x.id === "c3")!.slots[0]!;
    expect(w).toEqual({ slot: "weapon", instanceId: g.id, name: "短剣？", cursed: false, canUnequip: false });
  });

  test("UI-53/CH-77 identifiers は司教が alive・canAct のときだけ。unidentified は並び順 × inventory の順", () => {
    expect(campMenu(inDungeon(), data)!.identifiers).toEqual([]);
    let s = withBishop(inDungeon());
    s = give(s, "c3", "dagger", false).s; // i19
    s = give(s, "c1", "cursed_dagger", false).s; // i20
    const m = campMenu(s, data)!;
    expect(m.identifiers).toEqual([{ id: "c5", name: "エル" }]);
    expect(m.unidentified).toEqual([
      { instanceId: "i20", ownerId: "c1", ownerName: "アルド", name: "短剣？" },
      { instanceId: "i19", ownerId: "c3", ownerName: "キリ", name: "短剣" },
    ]);
    expect(campMenu(patched(s, { c5: { status: ["sleep"] } }), data)!.identifiers).toEqual([]);
  });
});

describe("D2 キャンプのコマンドの形", () => {
  test.each<Command>([
    { type: "party.equip", memberId: "c1", instanceId: "i4" },
    { type: "party.unequip", memberId: "c1", slot: "shield" },
    { type: "party.identify", memberId: "c1", instanceId: "i4" },
    { type: "party.reorder", order: ["c2", "c1", "c3", "c4", "c5", "c6"] },
  ])("D2 title では wrong screen: $type", (cmd) => {
    expectRejected(createInitialState(1, data), cmd, "wrong screen");
  });
});

// ---------------------------------------------------------------------------

describe("UI-53/DG-40 campSummary", () => {
  test("UI-53/DG-40 迷宮名と階・所持金・台帳の件数と金額・帰還の糸のパーティ全体の数（死者の分も数え、他の消耗品は数えない）", () => {
    const base = inDungeon();
    const a = give(base, "c1", "return_thread");
    const b = give(a.s, "c1", "herb");
    const s = b.s;
    s.gold = 123;
    s.dive!.floor = 2;
    s.dive!.ledger = { items: [a.id, b.id], gold: 45 };
    member(s, "c1").life = "dead";
    member(s, "c1").hp = 0;
    // 帰還の糸: c5 の初期の 1 本（config の初期装備）+ c1 に足した 1 本 = 2
    expect(campSummary(s, data)).toEqual({ dungeonName: "試しの坑道", floor: 2, gold: 123, ledgerItems: 2, ledgerGold: 45, returnItems: 2 });
  });

  test("UI-53/DG-40 未鑑定の帰還の糸も数える", () => {
    // c5 の初期の 1 本（鑑定済み）+ c2 に足した未鑑定の 1 本 = 2
    const u = give(inDungeon(), "c2", "return_thread", false);
    expect(campSummary(u.s, data)!.returnItems).toBe(2);
  });

  test("UI-53 街・戦闘中・保留中・title では null", () => {
    expect(campSummary(inTown(), data)).toBeNull();
    expect(campSummary(battleOf(inDungeon()), data)).toBeNull();
    expect(campSummary(pending(inDungeon()), data)).toBeNull();
    expect(campSummary(createInitialState(1, data), data)).toBeNull();
  });
});
