// 迷宮の戦闘外での道具（dungeon.useItem: DG-30, DG-41, DG-43, MG-25, F9）と fieldItemMenu（UI-53）。
// 既定のパーティの所持品: c1 アルド i4 薬草、c3 キリ i10 薬草、c4 ドナ i13 解毒草、c5 エル i15 帰還の糸、c6 フィン i18 薬草。
// 装備: c1 は i1 長剣 / i2 革鎧 / i3 木の盾。
import { describe, expect, test } from "vitest";
import { createInitialState, execute } from "../src/core/engine";
import { cloneRng, rollDice } from "../src/core/rng";
import { fieldItemMenu } from "../src/core/rules/items";
import { cloneState, createItemInstance } from "../src/core/state";
import type { Character, Command, GameEvent, GameState } from "../src/core/types";
import { dived, withBattle } from "./helpers/battle";
import { data, expectKnownStringKeys, loadFreshData, newGame } from "./helpers/core";

function member(s: GameState, id: string): Character {
  const c = s.party.find((x) => x.id === id);
  if (c === undefined) throw new Error(`no member ${id}`);
  return c;
}

/** dived(1) の複製に patch を当てたもの（screen dungeon） */
function inDungeon(patches: Record<string, Partial<Character>> = {}): GameState {
  const s = cloneState(dived(1));
  for (const [id, p] of Object.entries(patches)) {
    const i = s.party.findIndex((c) => c.id === id);
    s.party[i] = { ...s.party[i]!, ...structuredClone(p) };
  }
  return s;
}

function ok(s: GameState, cmd: Command, d = data): { state: GameState; events: GameEvent[] } {
  const r = execute(s, cmd, d);
  const rej = r.events.find((e) => e.kind === "rejected");
  if (rej !== undefined) throw new Error(`rejected: ${JSON.stringify(rej)}`);
  expectKnownStringKeys(r.events, d);
  return r;
}

function expectRejected(s: GameState, cmd: Command, reason: string, d = data): void {
  const before = JSON.stringify(s);
  const r = execute(s, cmd, d);
  expect(r.state).toBe(s);
  expect(r.events).toEqual([{ kind: "rejected", command: cmd.type, reason }]);
  expect(JSON.stringify(s)).toBe(before);
}

const use = (memberId: string, itemId: string, targetId?: string): Command =>
  targetId === undefined ? { type: "dungeon.useItem", memberId, itemId } : { type: "dungeon.useItem", memberId, itemId, targetId };

describe("DG-30/DG-41/DG-43 帰還の糸", () => {
  test("DG-30 帰還の糸で街へ: battle.useItem → dungeon.return → town.enter → screen town。糸は消え、他の台帳の品と金は所持に残る（DG-43）。乱数なし", () => {
    const s = inDungeon({ c2: { san: 50 } });
    s.gold = 350;
    s.dive!.ledger = { items: ["i4", "i15"], gold: 50 };
    const r = ok(s, use("c5", "i15", "c1")); // targetId は無視
    expect(r.events).toEqual([
      { kind: "message", key: "battle.useItem", params: { actor: "エル", item: "帰還の糸" } },
      { kind: "message", key: "dungeon.return" },
      { kind: "message", key: "town.enter" },
      { kind: "sanChanged", id: "c2", delta: 50, san: 100 },
      { kind: "screen", to: "town" },
    ]);
    expect(r.state.screen).toBe("town");
    expect(r.state.dive).toBeNull();
    expect(r.state.townVisit).toEqual({ mercyOffered: false });
    expect(r.state.items["i15"]).toBeUndefined();
    expect(member(r.state, "c5").inventory).toEqual([]);
    expect(r.state.items["i4"]).toEqual(s.items["i4"]);
    expect(member(r.state, "c1").inventory).toEqual(["i4"]);
    expect(r.state.gold).toBe(350);
    expect(r.state.rng).toEqual(s.rng);
  });

  // M5.5: 街でも dungeon.useItem を受け付けるようにしたので、戦闘中の理由を not in dungeon から wrong screen に、街の帰還の糸を not usable here に変えた
  test("DG-30 戦闘中・保留中の選択・街では使えない（街は not usable here）。行動不能・装備中・他人の品・未知のメンバーも rejected（同じ参照、state 不変）", () => {
    const base = inDungeon();
    expectRejected(withBattle(base, [{ monsterId: data.monsters[0]!.id, hps: [3] }]), use("c5", "i15"), "wrong screen");
    const pending = cloneState(base);
    pending.pendingChoice = { kind: "stairs", promptKey: "dungeon.stairsUp", options: [{ id: "stay", labelKey: "dungeon.choice.stay" }] };
    expectRejected(pending, use("c5", "i15"), "choice pending");
    expectRejected(newGame(1), use("c5", "i15"), "not usable here");
    expectRejected(createInitialState(1, data), use("c5", "i15"), "wrong screen");
    for (const patch of [{ status: ["paralysis"] }, { san: 0 }, { life: "dead", hp: 0 }] as Partial<Character>[]) {
      expectRejected(inDungeon({ c5: patch }), use("c5", "i15"), "cannot act");
    }
    expectRejected(base, use("c1", "i1"), "item not in inventory"); // 装備中の長剣
    expectRejected(base, use("c1", "i15"), "item not in inventory"); // エルの糸
    expectRejected(base, use("c1", "nope"), "item not in inventory");
    expectRejected(base, use("c9", "i15"), "no such member");
  });

  test("DG-30 戦闘外で使えない品（武器・usableIn battle の消耗品）は not usable here", () => {
    const s = inDungeon();
    const c1 = member(s, "c1");
    c1.inventory.push(c1.equipment.weapon!);
    c1.equipment.weapon = null;
    expectRejected(s, use("c1", "i1"), "not usable here");
    const d = loadFreshData();
    const herb = d.items.find((i) => i.id === "herb")!;
    if (herb.type !== "consumable") throw new Error("herb");
    herb.usableIn = "battle";
    expectRejected(inDungeon({ c2: { hp: 3 } }), use("c1", "i4", "c2"), "not usable here", d);
  });
});

describe("F9/H5 戦闘外の heal / cureStatus（applyAllyEffect を戦闘と共有）", () => {
  test("F9 薬草（1d8、ally）: battle.useItem → hpChanged → battle.heal。回復量は鏡の rng（max 止まり）、薬草は消え台帳からも外れる（DG-41）", () => {
    for (const hp of [3, 15]) {
      const s = inDungeon({ c2: { hp } });
      s.dive!.ledger = { items: ["i4"], gold: 0 };
      const mirror = cloneRng(s.rng);
      const roll = rollDice(mirror, "1d8").total;
      const next = Math.min(16, hp + roll);
      const r = ok(s, use("c1", "i4", "c2"));
      expect(r.events).toEqual([
        { kind: "message", key: "battle.useItem", params: { actor: "アルド", item: "薬草" } },
        ...(next > hp ? [{ kind: "hpChanged", id: "c2", delta: next - hp, hp: next }] : []),
        { kind: "message", key: "battle.heal", params: { target: "ベルク", amount: next - hp } },
      ]);
      expect(member(r.state, "c2").hp).toBe(next);
      expect(r.state.rng).toEqual(mirror);
      expect(r.state.items["i4"]).toBeUndefined();
      expect(member(r.state, "c1").inventory).toEqual([]);
      expect(r.state.dive!.ledger.items).toEqual([]);
      expect(r.state.screen).toBe("dungeon");
    }
  });

  test("F9 ally の品は targetId が life alive の味方でなければ bad target（dead・未指定・未知）", () => {
    const s = inDungeon({ c2: { life: "dead", hp: 0 } });
    expectRejected(s, use("c1", "i4", "c2"), "bad target");
    expectRejected(s, use("c1", "i4"), "bad target");
    expectRejected(s, use("c1", "i4", "c9"), "bad target");
    // 自分自身は対象にできる
    ok(inDungeon({ c1: { hp: 2 } }), use("c1", "i4", "c1"));
  });

  test("F9 解毒草（cureStatus poison）: 毒があれば statusChanged off と battle.cured、無ければ battle.noEffect（どちらも消費する）。乱数なし", () => {
    const a = inDungeon({ c2: { status: ["poison", "paralysis"] } });
    const r = ok(a, use("c4", "i13", "c2"));
    expect(r.events).toEqual([
      { kind: "message", key: "battle.useItem", params: { actor: "ドナ", item: "解毒草" } },
      { kind: "statusChanged", id: "c2", status: "poison", on: false },
      { kind: "message", key: "battle.cured", params: { target: "ベルク" } },
    ]);
    expect(member(r.state, "c2").status).toEqual(["paralysis"]);
    expect(r.state.rng).toEqual(a.rng);
    const b = ok(inDungeon(), use("c4", "i13", "c2"));
    expect(b.events).toEqual([
      { kind: "message", key: "battle.useItem", params: { actor: "ドナ", item: "解毒草" } },
      { kind: "message", key: "battle.noEffect", params: { target: "ベルク" } },
    ]);
    expect(b.state.items["i13"]).toBeUndefined();
  });
});

describe("MG-25 魔法書（dungeon.useItem）", () => {
  function withBook(id: string): { s: GameState; book: string } {
    const s = inDungeon();
    const book = createItemInstance(s, { itemId: "tome_lightning", identified: true });
    member(s, id).inventory.push(book);
    return { s, book };
  }

  test("MG-25 魔術師が魔法書で雷光を覚え、本は消える（spellLearned via book → town.inn.learned）。乱数なし", () => {
    const { s, book } = withBook("c5");
    const r = ok(s, use("c5", book));
    expect(r.events).toEqual([
      { kind: "spellLearned", id: "c5", spellId: "lightning_tome", via: "book" },
      { kind: "message", key: "town.inn.learned", params: { name: "エル", spell: "雷光" } },
    ]);
    expect(member(r.state, "c5").knownSpells).toEqual(["fire_arrow", "sleep_mist", "lightning_tome"]);
    expect(r.state.items[book]).toBeUndefined();
    expect(r.state.rng).toEqual(s.rng);
  });

  test("MG-25 系統を使えない職業・既に知っている呪文は rejected で、本は消費しない", () => {
    const a = withBook("c1");
    expectRejected(a.s, use("c1", a.book), "class cannot learn this school");
    const b = withBook("c5");
    member(b.s, "c5").knownSpells.push("lightning_tome");
    expectRejected(b.s, use("c5", b.book), "spell already known");
  });
});

describe("UI-53 fieldItemMenu", () => {
  test("迷宮の戦闘外: 全員（並び順）、items は inventory の順の consumable / book、target は ally / none、usable は checkUseItem と同値", () => {
    const s = inDungeon({ c3: { status: ["paralysis"] }, c6: { life: "dead", hp: 0 } });
    const book = createItemInstance(s, { itemId: "tome_lightning", identified: true });
    member(s, "c1").inventory.push(book);
    const m = fieldItemMenu(s, data)!;
    expect(m.members.map((x) => [x.id, x.canAct])).toEqual([
      ["c1", true],
      ["c2", true],
      ["c3", false],
      ["c4", true],
      ["c5", true],
      ["c6", false],
    ]);
    expect(m.members[0]!.items).toEqual([
      { instanceId: "i4", itemId: "herb", name: "薬草", target: "ally", usable: true, isReturn: false },
      { instanceId: book, itemId: "tome_lightning", name: "雷光の魔法書", target: "none", usable: false, isReturn: false },
    ]);
    expect(m.members[1]!.items).toEqual([]);
    expect(m.members[2]!.items).toEqual([{ instanceId: "i10", itemId: "herb", name: "薬草", target: "ally", usable: false, isReturn: false }]);
    expect(m.members[3]!.items).toEqual([{ instanceId: "i13", itemId: "antidote_herb", name: "解毒草", target: "ally", usable: true, isReturn: false }]);
    expect(m.members[4]!.items).toEqual([{ instanceId: "i15", itemId: "return_thread", name: "帰還の糸", target: "none", usable: true, isReturn: true }]);
    expect(m.allies.map((a) => a.id)).toEqual(["c1", "c2", "c3", "c4", "c5"]);
    expect(m.allies[0]).toEqual({ id: "c1", name: "アルド", hp: 15, hpMax: 15 });
  });

  // M5.5: 街（酒場）でも道具を使えるようにしたので、街では非 null に変えた（旧: 街でも null）
  test("戦闘中・保留中の選択・タイトルでは null（街は非 null）", () => {
    const base = inDungeon();
    expect(fieldItemMenu(withBattle(base, [{ monsterId: data.monsters[0]!.id, hps: [3] }]), data)).toBeNull();
    const pending = cloneState(base);
    pending.pendingChoice = { kind: "stairs", promptKey: "dungeon.stairsUp", options: [] };
    expect(fieldItemMenu(pending, data)).toBeNull();
    expect(fieldItemMenu(createInitialState(1, data), data)).toBeNull();
    expect(fieldItemMenu(newGame(1), data)).not.toBeNull();
  });

  test("UI-53/TW-03 fieldItemMenu は街でも非 null で、帰還の糸は usable false・isReturn true（迷宮では usable true・isReturn true）。薬草・解毒草は街でも usable", () => {
    const t = fieldItemMenu(newGame(1), data)!;
    expect(t.members[4]!.items).toEqual([{ instanceId: "i15", itemId: "return_thread", name: "帰還の糸", target: "none", usable: false, isReturn: true }]);
    expect(t.members[0]!.items).toEqual([{ instanceId: "i4", itemId: "herb", name: "薬草", target: "ally", usable: true, isReturn: false }]);
    expect(t.members[3]!.items).toEqual([{ instanceId: "i13", itemId: "antidote_herb", name: "解毒草", target: "ally", usable: true, isReturn: false }]);
    const d = fieldItemMenu(inDungeon(), data)!;
    expect(d.members[4]!.items[0]).toMatchObject({ instanceId: "i15", usable: true, isReturn: true });
  });
});

describe("DG-30/MG-25 街での道具（M5.5）", () => {
  test("DG-30/MG-25 街でも dungeon.useItem の薬草・解毒草・魔法書を受け付ける。帰還の糸は街では not usable here（品は消えない）", () => {
    // 薬草: battle.useItem → hpChanged → battle.heal（鏡の rng）
    const s = cloneState(newGame(1));
    member(s, "c2").hp = 1;
    const m = cloneRng(s.rng);
    const herb = data.items.find((x) => x.id === "herb")!;
    if (herb.type !== "consumable" || herb.effect.type !== "heal") throw new Error("herb is not a heal item");
    const roll = rollDice(m, herb.effect.dice).total;
    const next = Math.min(member(s, "c2").hpMax, 1 + roll);
    const r = ok(s, use("c1", "i4", "c2"));
    expect(r.events).toEqual([
      { kind: "message", key: "battle.useItem", params: { actor: "アルド", item: "薬草" } },
      { kind: "hpChanged", id: "c2", delta: next - 1, hp: next },
      { kind: "message", key: "battle.heal", params: { target: "ベルク", amount: next - 1 } },
    ]);
    expect(r.state.rng).toEqual(m);
    expect(r.state.items["i4"]).toBeUndefined();
    expect(r.state.screen).toBe("town");
    // 解毒草: 毒が消える
    const p = cloneState(newGame(1));
    member(p, "c1").status = ["poison"];
    const rp = ok(p, use("c4", "i13", "c1"));
    expect(member(rp.state, "c1").status).toEqual([]);
    expect(rp.state.items["i13"]).toBeUndefined();
    // 魔法書: 覚えて本が消える
    const b = cloneState(newGame(1));
    const book = createItemInstance(b, { itemId: "tome_lightning", identified: true });
    member(b, "c5").inventory.push(book);
    const rb = ok(b, use("c5", book));
    expect(rb.events[0]).toEqual({ kind: "spellLearned", id: "c5", spellId: "lightning_tome", via: "book" });
    expect(rb.state.items[book]).toBeUndefined();
    // 帰還の糸は街では使えない（品は残る。同じ参照）
    const t = newGame(1);
    expectRejected(t, use("c5", "i15"), "not usable here");
    expect(t.items["i15"]).toBeDefined();
  });
});
