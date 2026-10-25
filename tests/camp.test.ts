// キャンプのコマンド（MG-44 dungeon.cast、CH-03 party.reorder、CH-76 party.equip / unequip、CH-77 party.identify）と campMenu（UI-53 / TW-03）。
// 既定のパーティ（newGame）: c1 アルド 戦士（i1 長剣 / i2 革鎧 / i3 木の盾、inv i4 薬草）、c2 ベルク 戦士（i5 長剣 / i6 鎖帷子）、
// c3 キリ 盗賊（i7 短剣 / i8 革鎧 / i9 革兜、inv i10 薬草）、c4 ドナ 僧侶（i11 杖 / i12 革鎧、inv i13 解毒草、呪文 heal）、
// c5 エル 魔術師（i14 杖、inv i15 帰還の糸、呪文 fire_arrow / sleep_mist）、c6 フィン 盗賊（i16 短弓 / i17 革鎧、inv i18 薬草）。
import { describe, expect, test } from "vitest";
import type { GameData } from "../src/core/data";
import { execute } from "../src/core/engine";
import { chance, cloneRng, createRng, randInt, rollDice } from "../src/core/rng";
import { campMenu, campSummary, checkCast, checkEquip, checkIdentify, checkUnequip, identifyChance } from "../src/core/rules/camp";
import { itemActions } from "../src/core/rules/item-actions";
import { equipPreview } from "../src/core/rules/item-view";
import { formatMessage } from "../src/presenter/views/message";
import { kinsokuLines } from "./helpers/wrap";
import { fieldItemMenu } from "../src/core/rules/items";
import { frontLineIds } from "../src/core/rules/combat-calc";
import { resurrectRate, townMenu } from "../src/core/rules/town";
import { cloneState, createItemInstance, itemDisplayName, slotsMaxOf } from "../src/core/state";
import type { Character, Command, GameEvent, GameState } from "../src/core/types";
import { dived, withBattle } from "./helpers/battle";
import { createInitialState } from "../src/core/engine";
import { data, expectKnownStringKeys, expectStateInvariants, loadFreshData, newGame, seedWithFirstD100 } from "./helpers/core";
import { atEvent } from "./helpers/events";
import { cursedDagger } from "./helpers/items";

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
  // M5.5: 街でも受け付けるようにしたので、先頭の理由は not in dungeon（街・戦闘中・title）から wrong screen（戦闘中・title）に変えた
  test("MG-32/MG-44 理由の順: wrong screen（戦闘中・title）→ no such member → cannot act → unknown spell → not usable here → no mp → bad target。同じ参照で乱数も変えない", () => {
    expectRejected(battleOf(inDungeon()), cast("c4", "heal", "c1"), "wrong screen");
    expectRejected(createInitialState(1, data), cast("c4", "heal", "c1"), "wrong screen");
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

  test("MG-44 街でも dungeon.cast の治癒を受け付ける（mpChanged → battle.cast → hpChanged → battle.heal。鏡の rng）。帰還は街では not usable here（MP は減らない）", () => {
    const s = inTown({ c1: { hp: 1 } });
    const m = cloneRng(s.rng);
    const roll = rollDice(m, "1d8").total;
    const c4 = member(s, "c4");
    const next = Math.min(member(s, "c1").hpMax, 1 + roll);
    const r = ok(s, cast("c4", "heal", "c1"));
    expect(r.events).toEqual([
      { kind: "mpChanged", id: "c4", delta: -2, mp: c4.mp - 2 },
      { kind: "message", key: "battle.cast", params: { actor: "ドナ", spell: "治癒" } },
      { kind: "hpChanged", id: "c1", delta: next - 1, hp: next },
      { kind: "message", key: "battle.heal", params: { target: "アルド", amount: next - 1 } },
    ]);
    expect(r.state.rng).toEqual(m);
    expect(r.state.screen).toBe("town");
    expect(r.state.dive).toBeNull();
    // 帰還は街では使えない（MP は減らず、同じ参照）。迷宮では受け付ける
    expectRejected(inTown({ c4: PRIEST_ALL }), cast("c4", "return"), "not usable here");
    expect(checkCast(inDungeon({ c4: PRIEST_ALL }), data, "c4", "return", undefined)).toBeNull();
    // 街でも順は同じ: cannot act → unknown spell → not usable here（battle 専用）→ no mp → bad target
    expectRejected(inTown({ c4: { status: ["sleep"] } }), cast("c4", "heal", "c1"), "cannot act");
    expectRejected(inTown(), cast("c5", "fire_arrow"), "not usable here");
    expectRejected(inTown({ c4: { mp: 1 } }), cast("c4", "heal", "c1"), "no mp");
    expectRejected(inTown(), cast("c4", "heal"), "bad target");
    // 街の蘇生（MG-42）も受け付ける: randInt(1, 100) を 1 回
    const d = inTown({ c4: PRIEST_ALL, c2: { life: "dead", hp: 0 } });
    const m2 = cloneRng(d.rng);
    randInt(m2, 1, 100);
    const rr = ok(d, cast("c4", "resurrect", "c2"));
    expect(rr.events[2]).toEqual({ kind: "message", key: "dungeon.cast.resurrectRoll", params: { name: "ベルク" } });
    expect(rr.state.rng).toEqual(m2);
  });
});

describe("MG-44 dungeon.cast の効果", () => {
  test("MG-44 治癒（heal・ally）の対象の HP が実効の hpMax 以上なら rejected full hp（MP を消費しない。2026-10-05）。満タンでなければ受け付ける。解毒（cureStatus）は HP を見ない", () => {
    const s = inDungeon({ c4: PRIEST_ALL });
    expectRejected(s, cast("c4", "heal", "c1"), "full hp");
    member(s, "c1").hp -= 1;
    expect(ok(s, cast("c4", "heal", "c1")).events[0]).toEqual({ kind: "mpChanged", id: "c4", delta: -2, mp: 28 });
    const p = inDungeon({ c4: PRIEST_ALL, c1: { status: ["poison"] } });
    expect(ok(p, cast("c4", "cure_poison", "c1")).events[0]).toEqual({ kind: "mpChanged", id: "c4", delta: -3, mp: 27 });
  });

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

  test("MG-47 解縛（M9。cureStatus paralysis・ally・both）は迷宮でも街でも麻痺を解く（statusChanged off → battle.cured）。MP 4、乱数なし。麻痺でなければ battle.noEffect", () => {
    const spells = { knownSpells: ["heal", "unbind"], mp: 20, mpMax: 20 };
    for (const s of [inDungeon({ c4: spells, c2: { status: ["paralysis"] } }), inTown({ c4: spells, c2: { status: ["paralysis"] } })]) {
      const r = ok(s, cast("c4", "unbind", "c2"));
      expect(r.events).toEqual([
        { kind: "mpChanged", id: "c4", delta: -4, mp: 16 },
        { kind: "message", key: "battle.cast", params: { actor: "ドナ", spell: "解縛" } },
        { kind: "statusChanged", id: "c2", status: "paralysis", on: false },
        { kind: "message", key: "battle.cured", params: { target: "ベルク" } },
      ]);
      expect(member(r.state, "c2").status).toEqual([]);
      expect(r.state.rng).toEqual(s.rng);
    }
    const r2 = ok(inDungeon({ c4: spells }), cast("c4", "unbind", "c3"));
    expect(r2.events.slice(2)).toEqual([{ kind: "message", key: "battle.noEffect", params: { target: "キリ" } }]);
  });

  test("MG-48 聖域の讃歌（M9。heal 2d8・party・both）は dungeon.cast で生存者全員を 1 人 2d8 ずつ回復する（targetId は見ない。死者は飛ばす）。MP 12", () => {
    const hurt = { hp: 1 };
    const s = inDungeon({ c1: hurt, c2: hurt, c3: { life: "dead", hp: 0 }, c4: { ...hurt, knownSpells: ["heal", "sanctuary_hymn"], mp: 20, mpMax: 20 }, c5: hurt, c6: hurt });
    const m = cloneRng(s.rng);
    const alive = ["c1", "c2", "c4", "c5", "c6"];
    const want = alive.map((id) => Math.min(member(s, id).hpMax, 1 + rollDice(m, "2d8").total));
    const r = ok(s, cast("c4", "sanctuary_hymn", "c3"));
    expect(r.events.slice(0, 2)).toEqual([
      { kind: "mpChanged", id: "c4", delta: -12, mp: 8 },
      { kind: "message", key: "battle.cast", params: { actor: "ドナ", spell: "聖域の讃歌" } },
    ]);
    expect(r.events.filter((e) => e.kind === "hpChanged").map((e) => (e.kind === "hpChanged" ? [e.id, e.hp] : []))).toEqual(alive.map((id, i) => [id, want[i]]));
    expect(member(r.state, "c3").hp).toBe(0);
    expect(r.state.rng).toEqual(m);
    // 街でも使える（MG-32）
    expect(checkCast(inTown({ c4: { knownSpells: ["sanctuary_hymn"], mp: 20, mpMax: 20 } }), data, "c4", "sanctuary_hymn", undefined)).toBeNull();
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
    // 成功: dived(1) の最初の d100 は 14 ≤ 84
    const s = inDungeon({ c4: PRIEST_ALL, c1: { life: "dead", hp: 0 } });
    const rate = resurrectRate(member(s, "c1"), data);
    expect(rate).toBe(Math.min(95, 60 + 12 * 2)); // c1 の vit 12 → 84（templeSuccessBase 60【仮】。M7-解毒の灰の経済で 50 → 60 にし、74 → 84）
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
    // 失敗: 最初の d100 が 84 を超えるシードに差し替える
    const { seed, roll } = seedWithFirstD100((x) => x > 84);
    expect(roll).toBeGreaterThan(84);
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

  test("MG-42/CH-45 呪文の蘇生で戻る者も常に状態異常なし（古い保存の死者に毒が残っていても hpChanged の後に statusChanged off）", () => {
    // dived(1) の最初の d100 は 14 ≤ 84（上のテストと同じ）で成功
    const s = inDungeon({ c4: PRIEST_ALL, c1: { life: "dead", hp: 0, status: ["poison"] } });
    const r = ok(s, cast("c4", "resurrect", "c1"));
    expect(r.events.slice(3)).toEqual([
      { kind: "lifeChanged", id: "c1", life: "alive" },
      { kind: "hpChanged", id: "c1", delta: 1, hp: 1 },
      { kind: "statusChanged", id: "c1", status: "poison", on: false },
      { kind: "message", key: "dungeon.cast.resurrectOk", params: { name: "アルド" } },
    ]);
    expect(member(r.state, "c1").status).toEqual([]);
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
    // 成功: newGame(1) の最初の d100 は 49 ≤ 84（c1 の vit 12）
    const s = inTown({ c1: { life: "dead", hp: 0 } });
    s.gold = 10000;
    expect(resurrectRate(member(s, "c1"), data)).toBe(84);
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
    // 失敗: 最初の d100 が 84 を超えるシードに差し替える
    const { seed } = seedWithFirstD100((x) => x > 84);
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

/** memberId の inventory に itemId の実体を作って足した state と、その実体 id */
function give(base: GameState, memberId: string, itemId: string, identified = true): { s: GameState; id: string } {
  const s = cloneState(base);
  const id = createItemInstance(s, { itemId, identified });
  member(s, memberId).inventory.push(id);
  return { s, id };
}

/** memberId の inventory に呪われた短剣（tests/helpers/items.ts。M7 で cursed_dagger を廃止した代わり）を足した state と、その実体 id */
function giveCursed(base: GameState, memberId: string, identified = true): { s: GameState; id: string } {
  const s = cloneState(base);
  const id = cursedDagger(s, identified);
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
    const { s, id } = giveCursed(inDungeon(), "c3");
    const r = ok(s, { type: "party.equip", memberId: "c3", instanceId: id });
    expect(r.events).toEqual([
      { kind: "message", key: "camp.equipped", params: { name: "キリ", item: "短剣" } },
      { kind: "message", key: "camp.cursed", params: { item: "短剣" } },
    ]);
    expectRejected(r.state, { type: "party.unequip", memberId: "c3", slot: "weapon" }, "cursed");
    // 未鑑定のまま装備している（鑑定前に装備させた状態を直接作る）
    const u = cloneState(r.state);
    u.items[id]!.identified = false;
    expectRejected(u, { type: "party.unequip", memberId: "c3", slot: "weapon" }, "cursed");
  });

  test("CH-73/IT-32 呪いは実体ごと（M7）: 同じ短剣のベースでも cursed の実体だけが camp.cursed を語り外せない。呪われていない短剣は外せる", () => {
    const plain = give(inDungeon(), "c3", "dagger");
    const r1 = ok(plain.s, { type: "party.equip", memberId: "c3", instanceId: plain.id });
    expect(r1.events).toEqual([{ kind: "message", key: "camp.equipped", params: { name: "キリ", item: "短剣" } }]);
    ok(r1.state, { type: "party.unequip", memberId: "c3", slot: "weapon" });
    // 同じ itemId の実体に cursed を立てると呪いが効く（items.json の cursed は廃止。Q10）
    const s2 = cloneState(plain.s);
    s2.items[plain.id]!.cursed = true;
    const r2 = ok(s2, { type: "party.equip", memberId: "c3", instanceId: plain.id });
    expect(r2.events.map((e) => (e.kind === "message" ? e.key : e.kind))).toEqual(["camp.equipped", "camp.cursed"]);
    expectRejected(r2.state, { type: "party.unequip", memberId: "c3", slot: "weapon" }, "cursed");
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
    const cur = giveCursed(inDungeon(), "c3");
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
    // M10（U6。2026-10-07）: 死亡・灰・行動不能の者の装備も外せるようにしたので、cannot act の理由は無くなった（CH-76/U6 のテスト）
  });
});

// ---------------------------------------------------------------------------

/** c5 を司教にした state（prototypeParty に司教はいないので、テストで職業を差し替える） */
function withBishop(base: GameState): GameState {
  return patched(base, { c5: { classId: "bishop", maxLevelReached: { bishop: 1 } } }); // CH-63（SV-04 v5）: 今の職業の記録も合わせる
}

/**
 * c5 を司教にし、知恵・レベル・MP を決めた state（CH-77 の成功率を式どおりに数えるため）。
 * 杖（i14）にはオプションが無いので、実効の知恵は stats.iq のまま
 */
function bishopAt(base: GameState, iq = 10, level = 1, extra: Partial<Character> = {}): GameState {
  const c5 = member(base, "c5");
  return patched(base, {
    c5: { classId: "bishop", maxLevelReached: { bishop: level }, stats: { ...c5.stats, iq }, level, mp: 5, mpMax: 5, ...extra },
  });
}

/** 最初の d100 が pred を満たし、続く chance(possessChance) の当たり外れが hit になる種（hit が undefined なら 2 つめは見ない） */
function seedFor(pred: (roll: number) => boolean, hit?: boolean): number {
  for (let k = 1; k < 100000; k++) {
    const r = createRng(k);
    if (!pred(randInt(r, 1, 100))) continue;
    if (hit === undefined || chance(r, data.config.identify.possessChance) === hit) return k;
  }
  throw new Error("no seed");
}

function withSeed(s: GameState, seed: number): GameState {
  const t = cloneState(s);
  t.rng = createRng(seed);
  return t;
}

/** 成功率を 100 に固定した data（min = max = 100。鑑定の結果だけを見たいテスト用） */
function sureData(): GameData {
  const d = loadFreshData();
  d.config.identify.min = 100;
  d.config.identify.max = 100;
  return d;
}

const identify = (memberId: string, instanceId: string): Command => ({ type: "party.identify", memberId, instanceId });
const messagesOf = (events: GameEvent[]): GameEvent[] => events.filter((e) => e.kind === "message");

describe("CH-77 party.identify", () => {
  test("CH-77 成功: MP −1（mpChanged）→ dice{dice.identify・内訳の行・出目の行・identify.rule{rate}・dice.identify.ok}→ camp.identified。乱数は d100 を 1 回だけ", () => {
    const g = give(bishopAt(inDungeon(), 16), "c1", "dagger", false);
    const rate = 60 + 18; // 基本 60 + (16 − 10) × 3
    const s = withSeed(g.s, seedFor((x) => x <= rate));
    const m = cloneRng(s.rng);
    const roll = randInt(m, 1, 100);
    const r = ok(s, identify("c5", g.id));
    expect(r.events).toEqual([
      { kind: "mpChanged", id: "c5", delta: -1, mp: 4 },
      {
        kind: "dice",
        label: { key: "dice.identify", params: { item: "短い刃？" } },
        rows: [
          { label: { key: "identify.row.base", params: { v: "60" } }, base: 60, dice: [], total: 60 },
          { label: { key: "identify.row.iq", params: { v: "+18" } }, base: 18, dice: [], total: 18 },
          { label: { key: "identify.row.roll" }, base: null, dice: [roll], total: roll },
        ],
        rule: { key: "identify.rule", params: { rate } },
        result: { key: "dice.identify.ok" },
      },
      { kind: "message", key: "camp.identified", params: { name: "エル", old: "短い刃？", item: "短剣", rarity: "normal" } },
      // UI-59 / CH-77（M18）: 装備なら品そのものの数値の 1 文（短剣 1d4。該当しない項目は「—」）
      { kind: "message", key: "camp.identifiedPower", params: { item: "短剣", attack: "1d4", ac: "—", magic: "—" }, instant: true },
      // IT-61 / CH-77（M19）: 希少度と売値の 1 文（短剣 floor(15 × 0.5) = 7G）
      { kind: "message", key: "camp.identifiedValue", params: { rarity: "通常", gold: 7 }, instant: true },
    ]);
    expect(r.state.items[g.id]!.identified).toBe(true);
    expect(member(r.state, "c5").mp).toBe(4);
    expect(r.state.rng).toEqual(m);
  });

  test("IT-61/CH-77/UI-43（M19・M20 D-3）司教の鑑定の成功の後に camp.identifiedValue{rarity, gold}（希少度の語と鑑定後の売値。数値の行なので instant）。消耗品でも出す（性能の文は出さない）。乱数は d100 の 1 回のまま", () => {
    const sure = sureData();
    const g = give(bishopAt(inTown()), "c1", "herb", false);
    const m = cloneRng(g.s.rng);
    randInt(m, 1, 100);
    const r = ok(g.s, identify("c5", g.id), sure);
    // 薬草 floor(10 × 0.5) = 5G。消耗品の実体の希少度は normal
    expect(messagesOf(r.events).map((e) => (e.kind === "message" ? e.key : ""))).toEqual(["camp.identified", "camp.identifiedValue"]);
    expect(messagesOf(r.events)[1]).toEqual({ kind: "message", key: "camp.identifiedValue", params: { rarity: "通常", gold: 5 }, instant: true });
    expect(r.state.rng).toEqual(m);
  });

  test("CH-73/77/IT-32 呪われた品の鑑定に成功すると最後に item.curse.found{item, name, value, unit}（M24。camp.identifiedCursed と foundBad を統合。instant なし）が続く（街でも受け付ける。取り憑きの chance は引かない）", () => {
    const g = giveCursed(bishopAt(inTown()), "c3", false);
    const s = withSeed(g.s, seedFor((x) => x <= 60));
    const m = cloneRng(s.rng);
    randInt(m, 1, 100);
    const r = ok(s, identify("c5", g.id));
    expect(messagesOf(r.events)).toEqual([
      { kind: "message", key: "camp.identified", params: { name: "エル", old: "短い刃？", item: "短剣", rarity: "normal" } },
      { kind: "message", key: "camp.identifiedPower", params: { item: "短剣", attack: "1d4", ac: "—", magic: "—" }, instant: true },
      { kind: "message", key: "camp.identifiedValue", params: { rarity: "通常", gold: 7 }, instant: true },
      // IT-32（M24）: 呪いの効果はオプションの行に出さず、最後の呪いの 1 文に出す
      { kind: "message", key: "item.curse.found", params: { item: "短剣", name: "力", value: "-1", unit: "" } },
    ]);
    expect(r.state.rng).toEqual(m);
  });

  test("CH-77/IT-65/UI-43 M20（D-7）司教の鑑定の成功の後にオプションを 1 行ずつ item.option.found{name, value（符号付き）, unit}（identifiedValue の後。instant）。失敗では出さない。乱数は d100 の 1 回のまま", () => {
    const base = bishopAt(inTown());
    const s0 = cloneState(base);
    const id = createItemInstance(s0, { itemId: "dagger", identified: false, rarity: "rare", options: [{ optionId: "agi", tier: 2, value: 2 }, { optionId: "fear_loss", tier: 1, value: 10 }] });
    member(s0, "c3").inventory.push(id);
    const s = withSeed(s0, seedFor((x) => x <= 5)); // 成功率は 5 以上なので必ず成功
    const m = cloneRng(s.rng);
    randInt(m, 1, 100);
    const r = ok(s, identify("c5", id));
    expect(messagesOf(r.events).map((e) => (e.kind === "message" ? e.key : ""))).toEqual([
      "camp.identified",
      "camp.identifiedPower",
      "camp.identifiedValue",
      "item.option.found",
      "item.option.found",
    ]);
    expect(messagesOf(r.events).slice(3)).toEqual([
      { kind: "message", key: "item.option.found", params: { name: "素早さ", value: "+2", unit: "" }, instant: true },
      { kind: "message", key: "item.option.found", params: { name: "恐怖への耐性", value: "+10", unit: "%" }, instant: true },
    ]);
    expect(r.state.rng).toEqual(m);
    // 失敗（出目 > 95）ではオプションを明かさない
    const f = ok(withSeed(s0, seedFor((x) => x > 95)), identify("c5", id));
    expect(f.events.some((e) => e.kind === "message" && e.key.startsWith("item.option."))).toBe(false);
  });

  test("CH-77 失敗（迷宮）: dice.identify.ng → camp.identifyFailed → 司教の SAN −3。品は未鑑定のまま。呪われていない品では chance を引かない", () => {
    const g = give(bishopAt(inDungeon()), "c1", "dagger", false);
    const s = withSeed(g.s, seedFor((x) => x > 60));
    const m = cloneRng(s.rng);
    const roll = randInt(m, 1, 100);
    const san = member(s, "c5").san;
    const r = ok(s, identify("c5", g.id));
    expect(r.events).toEqual([
      { kind: "mpChanged", id: "c5", delta: -1, mp: 4 },
      {
        kind: "dice",
        label: { key: "dice.identify", params: { item: "短い刃？" } },
        rows: [
          { label: { key: "identify.row.base", params: { v: "60" } }, base: 60, dice: [], total: 60 },
          { label: { key: "identify.row.roll" }, base: null, dice: [roll], total: roll },
        ],
        rule: { key: "identify.rule", params: { rate: 60 } },
        result: { key: "dice.identify.ng" },
      },
      { kind: "message", key: "camp.identifyFailed", params: { name: "エル", item: "短い刃？" } },
      { kind: "sanChanged", id: "c5", delta: -3, san: san - 3 },
    ]);
    expect(r.state.items[g.id]!.identified).toBe(false);
    expect(r.state.rng).toEqual(m);
  });

  test("CH-77 失敗（街）: SAN は減らない。何度でも試せ、制限は MP だけ（尽きたら no mp）", () => {
    const g = give(bishopAt(inTown(), 10, 1, { mp: 2 }), "c1", "dagger", false);
    const s = withSeed(g.s, seedFor((x) => x > 60));
    const san = member(s, "c5").san;
    const r = ok(s, identify("c5", g.id));
    expect(messagesOf(r.events)).toEqual([{ kind: "message", key: "camp.identifyFailed", params: { name: "エル", item: "短い刃？" } }]);
    expect(r.events.some((e) => e.kind === "sanChanged")).toBe(false);
    expect(member(r.state, "c5").san).toBe(san);
    const r2 = ok(r.state, identify("c5", g.id));
    expect(member(r2.state, "c5").mp).toBe(0);
    expectRejected(r2.state, identify("c5", g.id), "no mp"); // 成功していても no mp が already identified より先
  });

  test("CH-77 理由の順: wrong screen → no such member → cannot identify → cannot act → no mp → no such item → already identified", () => {
    const { s, id } = give(bishopAt(inDungeon()), "c1", "dagger", false);
    expectRejected(battleOf(s), identify("c5", id), "wrong screen");
    expectRejected(s, identify("c9", id), "no such member");
    expectRejected(s, identify("c4", id), "cannot identify"); // 僧侶
    expectRejected(patched(s, { c5: { status: ["sleep"] } }), identify("c5", id), "cannot act");
    expectRejected(patched(s, { c5: { mp: 0 } }), identify("c5", "i999"), "no mp"); // no mp は no such item より先
    expectRejected(s, identify("c5", "i1"), "no such item"); // 装備中は対象外
    expectRejected(s, identify("c5", "i999"), "no such item");
    expectRejected(s, identify("c5", "i4"), "already identified");
  });

  test("CH-77 identifyChance: 基本 60 + (知恵 − 10) × 3 + 10 × floor(Lv / 10) − 希少度（0 / 10 / 20 / 30）− ユニーク 15 を 5〜95 に。基本以外の 0 の行は出さない", () => {
    const base = inTown();
    const at = (iq: number, level: number, spec: Parameters<typeof createItemInstance>[1]) => {
      const s = bishopAt(base, iq, level);
      const id = createItemInstance(s, spec);
      member(s, "c1").inventory.push(id);
      return identifyChance(s, data, "c5", id)!;
    };
    const v = (r: { rows: Array<{ label: { key: string; params?: Record<string, string | number> }; base: number | null }> }) =>
      r.rows.map((x) => [x.label.key.replace("identify.row.", ""), x.label.params?.["v"], x.base]);
    expect(at(10, 1, { identified: false, itemId: "dagger" })).toEqual({
      rate: 60,
      rows: [{ label: { key: "identify.row.base", params: { v: "60" } }, base: 60, dice: [], total: 60 }],
    });
    expect(at(13, 9, { identified: false, itemId: "dagger" }).rate).toBe(69);
    const a = at(13, 10, { identified: false, itemId: "long_sword", rarity: "fine" });
    expect(a.rate).toBe(60 + 9 + 10 - 10);
    expect(v(a)).toEqual([["base", "60", 60], ["iq", "+9", 9], ["level", "+10", 10], ["rarity", "-10", -10]]);
    expect(at(10, 25, { identified: false, itemId: "dagger", rarity: "rare" }).rate).toBe(60 + 20 - 20);
    const u = at(8, 1, { identified: false, itemId: "long_sword", uniqueId: "shadowfolk_sword", rarity: "legendary" });
    expect(u.rate).toBe(60 - 6 - 30 - 15);
    expect(v(u)).toEqual([["base", "60", 60], ["iq", "-6", -6], ["rarity", "-30", -30], ["unique", "-15", -15]]);
    // 上限 95: 60 + 60 + 30 = 150 → 上下限 −55
    const hi = at(30, 30, { identified: false, itemId: "dagger" });
    expect(hi.rate).toBe(95);
    expect(v(hi).at(-1)).toEqual(["clamp", "-55", -55]);
    // 下限 5: 60 − 21 − 30 − 15 = −6 → 上下限 +11
    const lo = at(3, 1, { identified: false, itemId: "long_sword", uniqueId: "shadowfolk_sword", rarity: "legendary" });
    expect(lo.rate).toBe(5);
    expect(v(lo).at(-1)).toEqual(["clamp", "+11", 11]);
    // 鑑定できない職業・いない者・無い品は null
    expect(identifyChance(base, data, "c4", "i4")).toBeNull();
    expect(identifyChance(bishopAt(base), data, "c9", "i4")).toBeNull();
    expect(identifyChance(bishopAt(base), data, "c5", "i999")).toBeNull();
  });

  test("CH-77/CH-13 知恵は実効の値（装備のオプションを含む）", () => {
    const s = bishopAt(inTown(), 10);
    s.items["i14"]!.options = [{ optionId: "iq", tier: 1, value: 2 }]; // c5 の杖に知恵 +2
    const id = createItemInstance(s, { identified: false, itemId: "dagger" });
    member(s, "c1").inventory.push(id);
    expect(identifyChance(s, data, "c5", id)!.rate).toBe(66);
  });

  test("CH-77 取り憑き（当たり・装備できる）: 他人の inventory の呪われた品が未鑑定のまま司教の枠に入り、旧品は持ち主の同じ位置へ。SAN −3 の後に camp.possessed → camp.cursed。乱数は d100 → chance", () => {
    const g = giveCursed(bishopAt(inDungeon()), "c1", false);
    member(g.s, "c1").inventory = [g.id, "i4"];
    const s = withSeed(g.s, seedFor((x) => x > 60, true));
    const m = cloneRng(s.rng);
    randInt(m, 1, 100);
    chance(m, 50);
    const san = member(s, "c5").san;
    const r = ok(s, identify("c5", g.id));
    expect(r.events.slice(2)).toEqual([
      { kind: "message", key: "camp.identifyFailed", params: { name: "エル", item: "短い刃？" } },
      { kind: "sanChanged", id: "c5", delta: -3, san: san - 3 },
      { kind: "message", key: "camp.possessed", params: { name: "エル", item: "短い刃？" } },
      { kind: "message", key: "camp.cursed", params: { item: "短い刃？" } },
    ]);
    expect(member(r.state, "c5").equipment.weapon).toBe(g.id);
    expect(member(r.state, "c1").inventory).toEqual(["i14", "i4"]); // 旧品の杖は c1 の同じ位置へ
    expect(r.state.items[g.id]!.identified).toBe(false);
    expect(r.state.rng).toEqual(m);
    // 外せない（CH-73）。装備中なので鑑定の対象でもない
    expectRejected(r.state, { type: "party.unequip", memberId: "c5", slot: "weapon" }, "cursed");
    expectRejected(r.state, identify("c5", g.id), "no such item");
  });

  test("CH-77/CH-14 取り憑き（街でも起き、SAN は減らない）: 自分の inventory の品で枠が空なら取り除いて枠へ。強制装備の後 hp は実効の最大値に止まる", () => {
    const empty = { weapon: null, armor: null, shield: null, helm: null, gauntlet: null, accessory: null };
    const s0 = bishopAt(inTown(), 10, 1, { equipment: empty });
    const c5 = member(s0, "c5");
    const hpMax = c5.hpMax;
    c5.hp = hpMax;
    const id = createItemInstance(s0, { itemId: "charm", identified: false, cursed: true, options: [{ optionId: "hp_max", tier: 1, value: -3 }] });
    const rest = [...c5.inventory, "i14"]; // 外した杖も持たせる（実体の参照を保つ）
    c5.inventory = [id, ...rest];
    const san = c5.san;
    const s = withSeed(s0, seedFor((x) => x > 60, true));
    const r = ok(s, identify("c5", id));
    const after = member(r.state, "c5");
    expect(after.equipment.accessory).toBe(id);
    expect(after.inventory).toEqual(rest);
    expect(after.san).toBe(san);
    expect(r.events.slice(-3)).toEqual([
      { kind: "message", key: "camp.possessed", params: { name: "エル", item: "飾り？" } },
      { kind: "message", key: "camp.cursed", params: { item: "飾り？" } },
      { kind: "hpChanged", id: "c5", delta: -3, hp: hpMax - 3 },
    ]);
    expect(after.hp).toBe(hpMax - 3);
  });

  test("CH-77 取り憑きの外れ: 失敗の SAN だけで、品も装備も動かない", () => {
    const g = giveCursed(bishopAt(inDungeon()), "c1", false);
    const s = withSeed(g.s, seedFor((x) => x > 60, false));
    const r = ok(s, identify("c5", g.id));
    expect(messagesOf(r.events)).toEqual([{ kind: "message", key: "camp.identifyFailed", params: { name: "エル", item: "短い刃？" } }]);
    expect(member(r.state, "c1").inventory).toContain(g.id);
    expect(member(r.state, "c5").equipment.weapon).toBe("i14");
  });

  test("CH-77 取り憑き（装備できない）: 職業が装備できない・枠の品が呪われている・枠が空で使用枠が満杯なら、品は元の場所のまま camp.possessedSan → SAN −10", () => {
    const seed = seedFor((x) => x > 60, true);
    const check = (s0: GameState, id: string, name: string, failSan: number) => {
      const s = withSeed(s0, seed);
      const san = member(s, "c5").san;
      const eq = { ...member(s, "c5").equipment };
      const inv = [...member(s, "c1").inventory];
      const r = ok(s, identify("c5", id));
      expect(r.events.slice(-2)).toEqual([
        { kind: "message", key: "camp.possessedSan", params: { name: "エル", item: name } },
        { kind: "sanChanged", id: "c5", delta: -10, san: san - failSan - 10 },
      ]);
      expect(member(r.state, "c5").san).toBe(san - failSan - 10);
      expect(member(r.state, "c5").equipment).toEqual(eq);
      expect(member(r.state, "c1").inventory).toEqual(inv);
    };
    // 職業: 長剣は司教が装備できない（街なので失敗の SAN は無い）
    const t = bishopAt(inTown());
    const sword = createItemInstance(t, { itemId: "long_sword", identified: false, cursed: true });
    member(t, "c1").inventory.push(sword);
    check(t, sword, "剣？", 0);
    // 枠の品が呪われている: 司教の武器が呪いの短剣（迷宮なので失敗の −3 も）
    const u = bishopAt(inDungeon());
    member(u, "c5").inventory.push("i14");
    member(u, "c5").equipment.weapon = cursedDagger(u, true);
    const second = cursedDagger(u, false);
    member(u, "c1").inventory.push(second);
    check(u, second, "短い刃？", 3);
    // 枠が空で、品は他人の inventory、司教の使用枠が満杯
    const w = bishopAt(inTown());
    const c5 = member(w, "c5");
    c5.equipment.weapon = null;
    member(w, "c2").inventory.push("i14", ...c5.inventory); // 杖と帰還の糸は c2 へ（実体の参照を保つ）
    c5.inventory = [];
    while (c5.inventory.length < slotsMaxOf(c5, data)) c5.inventory.push(createItemInstance(w, { itemId: "herb", identified: true }));
    const third = cursedDagger(w, false);
    member(w, "c1").inventory.push(third);
    check(w, third, "短い刃？", 0);
  });

  test("CH-77/IT-66 ユニークを鑑定すると図鑑に記録（foundIn・bestRarity）。2 本目以降は bestRarity だけ良い方に更新し、foundIn は最初のまま。汎用では記録しない", () => {
    // M10（CH-77 が確率になった）: 成功率を 100 に固定した data で結果だけを見る。期待する図鑑と語りは変えていない
    const sure = sureData();
    const s = bishopAt(inTown());
    const add = (spec: Parameters<typeof createItemInstance>[1]) => {
      const id = createItemInstance(s, spec);
      member(s, "c1").inventory.push(id);
      return id;
    };
    const a = add({ itemId: "long_sword", uniqueId: "shadowfolk_sword", rarity: "fine", identified: false, foundIn: "d01" });
    const b = add({ itemId: "long_sword", uniqueId: "shadowfolk_sword", rarity: "rare", identified: false, foundIn: "d02" });
    const c = add({ itemId: "long_sword", uniqueId: "shadowfolk_sword", rarity: "normal", identified: false, foundIn: "d02" });
    const g = add({ itemId: "long_sword", level: 2, rarity: "legendary", identified: false, foundIn: "d01" });
    expect(s.uniqueBook).toEqual({});
    const r1 = ok(s, identify("c5", a), sure);
    // IT-11 / IT-12: 鑑定前は「剣？」、鑑定後は「上質な影法師の剣」（ユニークは Lv を出さない）
    expect(messagesOf(r1.events)).toEqual([
      { kind: "message", key: "camp.identified", params: { name: "エル", old: "剣？", item: "上質な影法師の剣", rarity: "fine" } },
      { kind: "message", key: "camp.identifiedPower", params: { item: "上質な影法師の剣", attack: "1d8", ac: "—", magic: "—" }, instant: true }, // ユニークは Lv の効果なし（IT-03）
      { kind: "message", key: "camp.identifiedValue", params: { rarity: "上質", gold: 600 }, instant: true }, // IT-61: ユニークは floor(1200 × 0.5)（希少度に関わらず固定）
    ]);
    expect(r1.state.uniqueBook).toEqual({ shadowfolk_sword: { foundIn: "d01", bestRarity: "fine" } });
    const r2 = ok(r1.state, identify("c5", b), sure);
    expect(r2.state.uniqueBook).toEqual({ shadowfolk_sword: { foundIn: "d01", bestRarity: "rare" } });
    const r3 = ok(r2.state, identify("c5", c), sure);
    expect(r3.state.uniqueBook).toEqual({ shadowfolk_sword: { foundIn: "d01", bestRarity: "rare" } });
    const r4 = ok(r3.state, identify("c5", g), sure);
    expect(r4.state.uniqueBook).toEqual(r3.state.uniqueBook);
    expect(messagesOf(r4.events)[0]).toEqual({ kind: "message", key: "camp.identified", params: { name: "エル", old: "剣？", item: "伝説の長剣 +2", rarity: "legendary" } });
    expect(messagesOf(r4.events)[1]).toEqual({ kind: "message", key: "camp.identifiedPower", params: { item: "伝説の長剣 +2", attack: "1d8+2", ac: "—", magic: "—" }, instant: true }); // IT-20: Lv2 → +2
    // IT-61（M19）: 汎用は floor(100 × 0.5 × (1 + 0.5 × 2)) = 100G
    expect(messagesOf(r4.events)[2]).toEqual({ kind: "message", key: "camp.identifiedValue", params: { rarity: "伝説", gold: 100 }, instant: true });
  });
});

// ---------------------------------------------------------------------------

/** memberId の inventory を薬草で使用枠の上限（slotsMaxOf。CH-71 の素の力の補正を含む）まで埋めた state */
function fillSlots(base: GameState, memberId: string): GameState {
  let s = base;
  while (true) {
    const ch = member(s, memberId);
    const used = Object.values(ch.equipment).filter((x) => x !== null).length + ch.inventory.length;
    if (used >= slotsMaxOf(ch, data)) return s;
    s = give(s, memberId, "herb").s;
  }
}

const giveCmd = (memberId: string, instanceId: string, toId: string): Command => ({ type: "party.give", memberId, instanceId, toId });
const dropCmd = (memberId: string, instanceId: string): Command => ({ type: "party.drop", memberId, instanceId });

describe("CH-78 party.give", () => {
  test("CH-78 理由の順: wrong screen → no such member → item not in inventory（装備中・他人の品）→ no such target（自分・パーティ外）→ target full", () => {
    const s = inDungeon();
    expectRejected(battleOf(s), giveCmd("c1", "i4", "c2"), "wrong screen");
    expectRejected(s, giveCmd("zz", "i4", "c2"), "no such member");
    expectRejected(s, giveCmd("c1", "i1", "c2"), "item not in inventory"); // 装備中の長剣
    expectRejected(s, giveCmd("c1", "i10", "c2"), "item not in inventory"); // c3 の薬草
    expectRejected(s, giveCmd("c1", "i4", "c1"), "no such target");
    expectRejected(s, giveCmd("c1", "i4", "zz"), "no such target");
    expectRejected(fillSlots(s, "c2"), giveCmd("c1", "i4", "c2"), "target full");
    // 順: item not in inventory は no such target より先
    expectRejected(s, giveCmd("c1", "i1", "zz"), "item not in inventory");
  });

  test("CH-78 受け取る側の inventory の末尾に入る。message camp.gave。潜行台帳と乱数は変わらない", () => {
    const base = inDungeon();
    const { s, id } = give(base, "c1", "herb");
    s.dive!.ledger.items = [id];
    const r = ok(s, giveCmd("c1", id, "c3"));
    expect(r.events).toEqual([{ kind: "message", key: "camp.gave", params: { name: "アルド", item: "薬草", to: "キリ" } }]);
    expect(member(r.state, "c1").inventory).toEqual(["i4"]);
    expect(member(r.state, "c3").inventory).toEqual(["i10", id]);
    expect(r.state.dive!.ledger).toEqual(s.dive!.ledger);
    expect(r.state.rng).toEqual(s.rng);
    expect(r.state.items[id]).toEqual(s.items[id]);
  });

  test("CH-78 街でも渡せる。呪われた品・未鑑定の品も渡せる（表示名は未鑑定のまま）", () => {
    const cur = giveCursed(inTown(), "c3", false);
    const r = ok(cur.s, giveCmd("c3", cur.id, "c2"));
    expect(r.events).toEqual([{ kind: "message", key: "camp.gave", params: { name: "キリ", item: "短い刃？", to: "ベルク" } }]);
    expect(member(r.state, "c2").inventory).toEqual([cur.id]);
  });

  test("CH-78/U6 渡す側・受け取る側の life と行動の可否は問わない（死亡・灰・睡眠の者の品も渡せる）", () => {
    for (const p of [{ life: "dead" as const, hp: 0 }, { life: "ash" as const, hp: 0 }, { status: ["sleep" as const] }]) {
      const s = inDungeon({ c1: p, c2: p });
      const r = ok(s, giveCmd("c1", "i4", "c2"));
      expect(member(r.state, "c2").inventory).toEqual(["i4"]);
    }
  });

  test("CH-78 campMenu の members[].canReceive は使用枠が満杯でない者だけ真（life は問わない）", () => {
    const s = fillSlots(inDungeon({ c4: { life: "ash", hp: 0 } }), "c2");
    const m = campMenu(s, data)!.members;
    expect(m.map((x) => x.canReceive)).toEqual([true, false, true, true, true, true]);
  });
});

describe("CH-79 party.drop", () => {
  test("CH-79 理由の順: wrong screen → no such member → item not in inventory（装備中・他人の品）", () => {
    const s = inDungeon();
    expectRejected(battleOf(s), dropCmd("c1", "i4"), "wrong screen");
    expectRejected(s, dropCmd("zz", "i4"), "no such member");
    expectRejected(s, dropCmd("c1", "i1"), "item not in inventory");
    expectRejected(s, dropCmd("c1", "i10"), "item not in inventory");
  });

  test("CH-79 品の実体ごと消え、潜行中なら台帳からも消える。message camp.dropped。乱数は変わらない", () => {
    const base = inDungeon();
    const { s, id } = give(base, "c1", "herb");
    s.dive!.ledger.items = [id];
    const r = ok(s, dropCmd("c1", id));
    expect(r.events).toEqual([{ kind: "message", key: "camp.dropped", params: { name: "アルド", item: "薬草" } }]);
    expect(member(r.state, "c1").inventory).toEqual(["i4"]);
    expect(r.state.items[id]).toBeUndefined();
    expect(r.state.dive!.ledger.items).toEqual([]);
    expect(r.state.rng).toEqual(s.rng);
  });

  test("CH-79 街でも捨てられる。図鑑（IT-66）は消えない。死亡の者の品も捨てられる（U6）", () => {
    const s = inTown({ c1: { life: "dead", hp: 0 } });
    s.uniqueBook = { u_test: { foundIn: "d01", bestRarity: "rare" } } as GameState["uniqueBook"];
    const r = ok(s, dropCmd("c1", "i4"));
    expect(r.state.uniqueBook).toEqual(s.uniqueBook);
    expect(r.state.items["i4"]).toBeUndefined();
  });
});

describe("CH-76/U6 死亡・灰の者の装備を外す", () => {
  test("CH-76/U6 死亡・灰・睡眠の者でも呪われていなければ外せる。呪われていれば cursed", () => {
    for (const p of [{ life: "dead" as const, hp: 0 }, { life: "ash" as const, hp: 0 }, { status: ["sleep" as const] }]) {
      const r = ok(inDungeon({ c1: p }), { type: "party.unequip", memberId: "c1", slot: "shield" });
      expect(member(r.state, "c1").inventory).toEqual(["i4", "i3"]);
      expect(campMenu(inDungeon({ c1: p }), data)!.members[0]!.slots.find((x) => x.slot === "shield")!.canUnequip).toBe(true);
    }
    const cur = giveCursed(inDungeon(), "c3");
    const equipped = ok(cur.s, { type: "party.equip", memberId: "c3", instanceId: cur.id }).state;
    const dead = patched(equipped, { c3: { life: "dead", hp: 0 } });
    expectRejected(dead, { type: "party.unequip", memberId: "c3", slot: "weapon" }, "cursed");
  });
});

describe("IT-11/IT-12 itemDisplayName（表示名）", () => {
  const nameOf = (spec: Parameters<typeof createItemInstance>[1], d: GameData = data): string => {
    const s = cloneState(newGame(1));
    const id = createItemInstance(s, spec);
    return itemDisplayName(s, d, id);
  };

  test("IT-11 汎用の鑑定済み: 希少度の接頭辞（通常は無し）+ ベースの名前 + Lv（1 以上のときだけ「 +N」）", () => {
    expect(nameOf({ itemId: "long_sword", identified: true })).toBe("長剣");
    expect(nameOf({ itemId: "long_sword", identified: true, level: 1 })).toBe("長剣 +1");
    expect(nameOf({ itemId: "long_sword", identified: true, level: 5, rarity: "fine" })).toBe("上質な長剣 +5");
    expect(nameOf({ itemId: "leather_armor", identified: true, level: 0, rarity: "rare" })).toBe("希少な革鎧");
    expect(nameOf({ itemId: "charm", identified: true, level: 12, rarity: "legendary" })).toBe("伝説の護符 +12");
    // オプション・呪いは名前に出さない（詳細の画面）
    expect(nameOf({ itemId: "dagger", identified: true, level: 3, cursed: true, options: [{ optionId: "str", tier: 1, value: -1 }] })).toBe("短剣 +3");
  });

  test("IT-11 ユニークの鑑定済み: 接頭辞 + ユニークの名前（Lv は出さない）", () => {
    expect(nameOf({ itemId: "dagger", uniqueId: "twin_tongue_dagger", identified: true })).toBe("二枚舌の短剣");
    expect(nameOf({ itemId: "dagger", uniqueId: "twin_tongue_dagger", identified: true, rarity: "legendary" })).toBe("伝説の二枚舌の短剣");
  });

  test("IT-12 未鑑定は希少度・Lv・ユニークかどうかに関わらずベースの unidentifiedName だけ。消耗品は今どおり", () => {
    expect(nameOf({ itemId: "long_sword", identified: false, level: 5, rarity: "legendary" })).toBe("剣？");
    expect(nameOf({ itemId: "long_sword", identified: false, uniqueId: "shadowfolk_sword", rarity: "fine" })).toBe("剣？");
    expect(nameOf({ itemId: "herb", identified: true })).toBe("薬草");
  });

  test("IT-11 接頭辞と Lv の書式は strings.json から引く（差し替えればその文言になる）", () => {
    const d = loadFreshData();
    d.strings["item.rarity.fine"] = "良い";
    d.strings["item.plus"] = "＋{n}";
    expect(nameOf({ itemId: "long_sword", identified: true, level: 4, rarity: "fine" }, d)).toBe("良い長剣＋4");
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
    d.config.events.cap = 0; // 衝動を起こさず選択を待たせる
    for (const def of d.dungeons) def.encounterRate = { room: 0, corridor: 0 };
    const r = execute(atEvent("glowing_tablet").state, { type: "dungeon.move" }, d);
    expect(r.state.screen).toBe("event");
    expect(campMenu(r.state, data)).toBeNull();
  });

  // M5.5: 街でも spells を返すようにした（旧: 街では []）
  test("UI-53/TW-03/MG-44 spells: 迷宮では heal / cure_poison / return / resurrect だけで、usable は checkCast と一致する（full hp だけは見ない）。targets は ally の呪文の対象ごとの可否（heal は HP 満タンなら fullHp）。campMenu の place town でも spells を返し、帰還は usable false", () => {
    // 2026-10-05: targets を足した（MG-44 の full hp）。新しく始めた直後は全員 HP 満タンなので、治癒の対象は全員 fullHp でも usable は true のまま
    const full = ["c1", "c2", "c3", "c4", "c5", "c6"].map((id) => ({ id, block: "fullHp" }));
    const none = ["c1", "c2", "c3", "c4", "c5", "c6"].map((id) => ({ id, block: null }));
    const tm = campMenu(inTown({ c4: PRIEST_ALL }), data)!;
    expect(tm.place).toBe("town");
    expect(tm.members.find((x) => x.id === "c4")!.spells).toEqual([
      { spellId: "heal", name: "治癒", mp: 2, target: "ally", usable: true, targets: full },
      { spellId: "cure_poison", name: "解毒", mp: 3, target: "ally", usable: true, targets: none },
      { spellId: "return", name: "帰還", mp: 8, target: "none", usable: false, targets: [] }, // 街では帰還できない
      { spellId: "resurrect", name: "蘇生", mp: 15, target: "dead", usable: false, targets: [] }, // 死者なし
    ]);
    // 迷宮: アルド（c1）だけ HP 1 → 治癒の対象は c1 だけ送れる
    const s = inDungeon({ c1: { hp: 1 }, c4: { ...PRIEST_ALL, knownSpells: ["heal", "blessing", "cure_poison", "identify", "return", "resurrect"], mp: 8 } });
    const m = campMenu(s, data)!;
    const c4 = m.members.find((x) => x.id === "c4")!;
    expect(c4.spells).toEqual([
      { spellId: "heal", name: "治癒", mp: 2, target: "ally", usable: true, targets: [{ id: "c1", block: null }, ...full.slice(1)] },
      { spellId: "cure_poison", name: "解毒", mp: 3, target: "ally", usable: true, targets: none },
      { spellId: "return", name: "帰還", mp: 8, target: "none", usable: true, targets: [] },
      { spellId: "resurrect", name: "蘇生", mp: 15, target: "dead", usable: false, targets: [] }, // MP 不足・死者なし
    ]);
    expect(m.members.find((x) => x.id === "c5")!.spells).toEqual([]); // fire_arrow / sleep_mist は battle 専用
    for (const sp of c4.spells) {
      const probe = sp.target === "ally" ? m.allies[0]?.id : sp.target === "dead" ? m.dead[0]?.id : undefined;
      expect(sp.usable).toBe(checkCast(s, data, "c4", sp.spellId, probe) === null);
      for (const t of sp.targets) expect(t.block === null, `${sp.spellId} ${t.id}`).toBe(checkCast(s, data, "c4", sp.spellId, t.id) === null);
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
    s = giveCursed(s, "c3").s;
    s = ok(s, { type: "party.equip", memberId: "c3", instanceId: "i22" }).state;
    s = patched(s, { c2: { status: ["sleep"] } });
    s = give(s, "c2", "leather_cap").s; // cannotAct（i23）
    const m = campMenu(s, data)!;
    expect(m.members.map((x) => x.row)).toEqual(["front", "front", "front", "back", "back", "back"]);
    expect(m.members.find((x) => x.id === "c5")!.equipCandidates).toEqual([
      { instanceId: "i19", name: "長剣", slot: "weapon", block: "class", cursed: false },
      { instanceId: "i20", name: "短い刃？", slot: "weapon", block: "unidentified", cursed: false },
      { instanceId: "i21", name: "革兜", slot: "helm", block: null, cursed: false },
    ]);
    // 呪いの短剣を装備した c3 の inventory は [i10 薬草, i7 短剣（入れ替えた旧品）]
    expect(m.members.find((x) => x.id === "c3")!.equipCandidates).toEqual([
      { instanceId: "i7", name: "短剣", slot: "weapon", block: "cursedSlot", cursed: false },
    ]);
    expect(m.members.find((x) => x.id === "c2")!.equipCandidates).toEqual([
      { instanceId: "i23", name: "革兜", slot: "helm", block: "cannotAct", cursed: false },
    ]);
    const c3 = m.members.find((x) => x.id === "c3")!;
    expect(c3.slots.map((x) => x.slot)).toEqual(["weapon", "armor", "shield", "helm", "gauntlet", "accessory"]);
    expect(c3.slots[0]).toEqual({ slot: "weapon", instanceId: "i22", name: "短剣", cursed: true, canUnequip: false, canUnequipToWarehouse: false }); // TW-16c: 迷宮は false
    expect(c3.slots[2]).toEqual({ slot: "shield", instanceId: null, name: null, cursed: false, canUnequip: false, canUnequipToWarehouse: false }); // TW-16c: 迷宮は false
    for (const mem of m.members) {
      for (const sl of mem.slots) {
        if (sl.instanceId !== null) expect(sl.canUnequip).toBe(checkUnequip(s, data, mem.id, sl.slot) === null);
      }
      for (const c of mem.equipCandidates) expect(c.block === null).toBe(checkEquip(s, data, mem.id, c.instanceId) === null);
    }
  });

  test("UI-53/CH-73 未鑑定の呪われた品を装備していると、slots の cursed は false（見えない）だが外せない", () => {
    const g = giveCursed(inDungeon(), "c3");
    const s = ok(g.s, { type: "party.equip", memberId: "c3", instanceId: g.id }).state;
    const u = cloneState(s);
    u.items[g.id]!.identified = false;
    const w = campMenu(u, data)!.members.find((x) => x.id === "c3")!.slots[0]!;
    expect(w).toEqual({ slot: "weapon", instanceId: g.id, name: "短い刃？", cursed: false, canUnequip: false, canUnequipToWarehouse: false }); // TW-16c: 迷宮は false
  });

  test("UI-53/CH-77 identifiers は司教が alive・canAct のときだけ。unidentified は並び順 × inventory の順", () => {
    expect(campMenu(inDungeon(), data)!.identifiers).toEqual([]);
    let s = withBishop(inDungeon());
    s = give(s, "c3", "dagger", false).s; // i19
    s = giveCursed(s, "c1", false).s; // i20
    const m = campMenu(s, data)!;
    expect(m.identifiers).toEqual([{ id: "c5", name: "エル" }]);
    expect(m.unidentified).toEqual([
      { instanceId: "i20", ownerId: "c1", ownerName: "アルド", name: "短い刃？" },
      { instanceId: "i19", ownerId: "c3", ownerName: "キリ", name: "短い刃？" },
    ]);
    expect(campMenu(patched(s, { c5: { status: ["sleep"] } }), data)!.identifiers).toEqual([]);
  });
});

describe("UI-59（M10）campMenu のキャラクター画面の欄（inventory・slotsUsed・knownSpells・鑑定）", () => {
  test("UI-59/CH-71 inventory は本人の inventory の順で品種と呪いの印（鑑定済みだけ）。slotsUsed は装備 + 所持品、slotsMax は config、equipped は装備中の品の数（M16）", () => {
    let s = inTown();
    s = giveCursed(s, "c1", true).s; // i19 鑑定済みの呪われた短剣
    s = giveCursed(s, "c1", false).s; // i20 未鑑定の呪われた短剣
    s = give(s, "c1", "tome_lightning").s; // i21 魔法書
    const c1 = campMenu(s, data)!.members[0]!;
    expect(c1.inventory).toEqual([
      { instanceId: "i4", name: "薬草", identified: true, kind: "consumable", cursed: false },
      { instanceId: "i19", name: "短剣", identified: true, kind: "equipment", cursed: true },
      { instanceId: "i20", name: "短い刃？", identified: false, kind: "equipment", cursed: false },
      { instanceId: "i21", name: "雷光の魔法書", identified: true, kind: "book", cursed: false },
    ]);
    expect(c1.slotsUsed).toBe(3 + 4); // 長剣・革鎧・木の盾 + 所持品 4
    expect(c1.slotsMax).toBe(data.config.inventory.slotsPerCharacter + 1); // CH-71（M17）: アルドの素の力 14 は strBonus の 12 の段で +1
    expect(c1.equipped).toBe(3);
    expect(campMenu(s, data)!.members[1]!.inventory).toEqual([]); // ベルクは所持品なし
  });

  test("UI-59/UI-68/MG-32 knownSpells は戦闘専用も含む全習得呪文（knownSpells の順）。castable は spells にあって usable のときだけ", () => {
    const s = inDungeon({ c4: { knownSpells: ["heal", "blessing", "return", "resurrect"], mp: 8, mpMax: 30 } });
    const m = campMenu(s, data)!;
    expect(m.members.find((x) => x.id === "c4")!.knownSpells).toEqual([
      { spellId: "heal", name: "治癒", mp: 2, castable: true },
      { spellId: "blessing", name: "加護", mp: 3, castable: false }, // 戦闘専用
      { spellId: "return", name: "帰還", mp: 8, castable: true },
      { spellId: "resurrect", name: "蘇生", mp: 15, castable: false }, // MP 不足・死者なし
    ]);
    expect(m.members.find((x) => x.id === "c5")!.knownSpells).toEqual([
      { spellId: "fire_arrow", name: "火矢", mp: 2, castable: false },
      { spellId: "sleep_mist", name: "眠りの霧", mp: 3, castable: false },
    ]);
    // 街では帰還は唱えられない（MG-32）。MP 0 なら治癒も唱えられない
    const t = campMenu(inTown({ c4: { knownSpells: ["heal", "return"], mp: 0, mpMax: 30 } }), data)!;
    expect(t.members.find((x) => x.id === "c4")!.knownSpells.map((x) => x.castable)).toEqual([false, false]);
  });

  test("CH-77（M10）canIdentifyNow / identifyBlock の順: cannotIdentify → cannotAct → noMp → noUnidentified。identifyRates は unidentified の順の identifyChance", () => {
    const base = bishopAt(inDungeon(), 13, 10); // 60 + 9 + 10 = 79
    const c5Of = (s: GameState) => campMenu(s, data)!.members.find((x) => x.id === "c5")!;
    expect(c5Of(base)).toMatchObject({ canIdentifyNow: false, identifyBlock: "noUnidentified", identifyRates: [] });
    let s = give(base, "c3", "dagger", false).s; // i19
    s = give(s, "c1", "dagger", false).s; // i20
    s.items["i20"]!.rarity = "rare";
    const c5 = c5Of(s);
    expect(c5.canIdentifyNow).toBe(true);
    expect(c5.identifyBlock).toBeNull();
    // unidentified は並び順 × inventory の順（c1 の i20 → c3 の i19）
    expect(c5.identifyRates).toEqual([
      { instanceId: "i20", rate: 59 }, // 79 − 希少 20
      { instanceId: "i19", rate: 79 },
    ]);
    for (const r of c5.identifyRates) expect(r.rate).toBe(identifyChance(s, data, "c5", r.instanceId)!.rate);
    expect(c5Of(patched(s, { c5: { mp: 0 } }))).toMatchObject({ canIdentifyNow: false, identifyBlock: "noMp" });
    // 行動できなくても成功率は返す（行動の可否と MP は問わない）
    expect(c5Of(patched(s, { c5: { status: ["sleep"], mp: 0 } }))).toMatchObject({ canIdentifyNow: false, identifyBlock: "cannotAct", identifyRates: c5.identifyRates });
    expect(campMenu(s, data)!.members[0]).toMatchObject({ canIdentifyNow: false, identifyBlock: "cannotIdentify", identifyRates: [] });
    // 理由の順は checkIdentify と同じ（受け付けるときだけ canIdentifyNow）
    expect(checkIdentify(s, data, "c5", "i19")).toBeNull();
    expect(checkIdentify(patched(s, { c5: { mp: 0 } }), data, "c5", "i19")).toBe("no mp");
  });
});

describe("D2 キャンプのコマンドの形", () => {
  test.each<Command>([
    { type: "party.equip", memberId: "c1", instanceId: "i4" },
    { type: "party.unequip", memberId: "c1", slot: "shield" },
    { type: "party.identify", memberId: "c1", instanceId: "i4" },
    { type: "party.give", memberId: "c1", instanceId: "i4", toId: "c2" },
    { type: "party.drop", memberId: "c1", instanceId: "i4" },
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
    // returnItem（M16）: c1 は死亡で使えないので、次の c5 の i15
    expect(campSummary(s, data)).toEqual({
      dungeonName: "試しの坑道",
      floor: 2,
      gold: 123,
      ledgerItems: 2,
      ledgerGold: 45,
      returnItems: 2,
      returnItem: { memberId: "c5", ownerName: "エル", instanceId: "i15", name: "帰還の糸" },
      morale: false,
    });
  });

  test("UI-53/TW-15 宿の士気があれば morale が真（rankId がデータに無ければ偽）", () => {
    const s = inDungeon();
    s.morale = { rankId: "good" };
    expect(campSummary(s, data)!.morale).toBe(true);
    s.morale = { rankId: "suite" };
    expect(campSummary(s, data)!.morale).toBe(false);
  });

  test("UI-53/DG-40 未鑑定の帰還の糸も数える", () => {
    // c5 の初期の 1 本（鑑定済み）+ c2 に足した未鑑定の 1 本 = 2
    const u = give(inDungeon(), "c2", "return_thread", false);
    expect(campSummary(u.s, data)!.returnItems).toBe(2);
  });

  test("DG-30/UI-53（M16）returnItem は並び順 × inventory の順で、いま dungeon.useItem が受け付ける最初の帰還の品（持ち主が行動可能）。無ければ null", () => {
    // 並び順で先の c2 に未鑑定の糸を足すと、c5 より先にそれ（名前は未鑑定の見た目）
    const a = give(inDungeon(), "c2", "return_thread", false);
    const ra = campSummary(a.s, data)!.returnItem!;
    expect(ra).toEqual({ memberId: "c2", ownerName: "ベルク", instanceId: a.id, name: itemDisplayName(a.s, data, a.id) });
    // c2 が眠り（行動不能）なら c5 の i15。c5 も石化なら null（数は 2 のまま）
    const b = cloneState(a.s);
    member(b, "c2").status = ["sleep"];
    expect(campSummary(b, data)!.returnItem).toEqual({ memberId: "c5", ownerName: "エル", instanceId: "i15", name: "帰還の糸" });
    member(b, "c5").status = ["stone"];
    expect(campSummary(b, data)!.returnItem).toBeNull();
    expect(campSummary(b, data)!.returnItems).toBe(2);
    // 糸が 1 本も無ければ null
    const none = inDungeon({ c5: { inventory: [] } });
    expect(campSummary(none, data)!.returnItem).toBeNull();
    // checkUseItem と同値（使えるものの先頭が returnItem）
    for (const st of [a.s, b, none]) {
      const firstOk =
        st.party.flatMap((c) => c.inventory.filter((id) => st.items[id]?.itemId === "return_thread").map((id) => ({ c: c.id, id }))).find(
          (x) => !execute(st, { type: "dungeon.useItem", memberId: x.c, itemId: x.id }, data).events.some((e) => e.kind === "rejected"),
        ) ?? null;
      expect(campSummary(st, data)!.returnItem?.instanceId ?? null).toBe(firstOk?.id ?? null);
    }
  });

  test("UI-53 街・戦闘中・保留中・title では null", () => {
    expect(campSummary(inTown(), data)).toBeNull();
    expect(campSummary(battleOf(inDungeon()), data)).toBeNull();
    expect(campSummary(pending(inDungeon()), data)).toBeNull();
    expect(campSummary(createInitialState(1, data), data)).toBeNull();
  });
});

describe("TW-03 townMenu.canIdentify（M5.5）", () => {
  test("TW-03 townMenu.canIdentify は campMenu.identifiers.length > 0 と同値（司教がいる / いない / 司教が行動不能）", () => {
    const cases: Array<[string, GameState, boolean]> = [
      ["司教なし", inTown(), false],
      ["司教あり", inTown({ c5: { classId: "bishop" } }), true],
      ["司教が睡眠", inTown({ c5: { classId: "bishop", status: ["sleep"] } }), false],
      ["司教が死亡", inTown({ c5: { classId: "bishop", life: "dead", hp: 0 } }), false],
      ["司教が 2 人で 1 人は行動不能", inTown({ c5: { classId: "bishop", san: 0 }, c4: { classId: "bishop" } }), true],
    ];
    for (const [name, s, want] of cases) {
      expect(townMenu(s, data)!.canIdentify, name).toBe(want);
      expect(campMenu(s, data)!.identifiers.length > 0, name).toBe(want);
    }
  });
});

describe("CH-71（M17）所持枠の素の力の補正（config.inventory.strBonus）", () => {
  test("CH-71 slotsMaxOf = slotsPerCharacter 8 + 素の力の段（12 以上で +1、16 以上で +2【仮】）: 力 3・11 → 8、12・15 → 9、16・18 → 10", () => {
    const s = inTown();
    const ch = s.party[0]!;
    for (const [str, want] of [[3, 8], [11, 8], [12, 9], [15, 9], [16, 10], [18, 10]] as const) {
      ch.stats.str = str;
      expect(slotsMaxOf(ch, data), `str ${str}`).toBe(want);
    }
  });

  test("CH-71 装備の力のオプションは含めない（素の力 11 + 力 +3 の剣で実効 14 でも 8）。campMenu の slotsMax と townMenu の slotsFree が追従する", () => {
    const s = inTown({ c1: { stats: { ...newGame(1).party[0]!.stats, str: 11 } } });
    const c1 = member(s, "c1");
    s.items[c1.equipment.weapon!]!.options = [{ optionId: "str", tier: 3, value: 3 }];
    expect(slotsMaxOf(c1, data)).toBe(8);
    expect(campMenu(s, data)!.members[0]!.slotsMax).toBe(8);
    // c1 は装備 3 + 薬草 1 = 4 → 空き 4。c2（ベルク・力 15）は上限 9 で装備 2 → 空き 7
    const shop = townMenu(s, data)!.shop;
    expect(shop.members.find((m) => m.memberId === "c1")!.slotsFree).toBe(4);
    expect(shop.members.find((m) => m.memberId === "c2")!.slotsFree).toBe(7);
  });

  test("CH-71/CH-78 力 16 の者は 10 品まで受け取れる（party.give の target full は 10 で）", () => {
    const s = inDungeon({ c2: { stats: { ...dived(1).party[1]!.stats, str: 16 } } });
    const c2 = member(s, "c2");
    while (c2.inventory.length + 2 < 9) c2.inventory.push(createItemInstance(s, { itemId: "herb", identified: true })); // 装備 2 + 7 = 9
    const r = execute(s, { type: "party.give", memberId: "c1", instanceId: "i4", toId: "c2" }, data);
    expect(r.events.some((e) => e.kind === "rejected")).toBe(false);
    expect(member(r.state, "c2").inventory).toHaveLength(8); // 10 枠が満杯
    const c1 = member(r.state, "c1");
    c1.inventory.push(createItemInstance(r.state, { itemId: "herb", identified: true }));
    const again = execute(r.state, { type: "party.give", memberId: "c1", instanceId: c1.inventory.at(-1)!, toId: "c2" }, data);
    expect(again.events).toEqual([{ kind: "rejected", command: "party.give", reason: "target full" }]);
  });
});

describe("UI-80（M20）itemActions 品に当てはまる操作とできない理由", () => {
  const acts = (s: GameState, memberId: string, instanceId: string) => itemActions(s, data, memberId, instanceId)?.actions ?? null;

  test("UI-80/CH-76 装備中の品は 外す だけ（呪われていれば cursed）。equippedSlot と slot は枠、identifier は null", () => {
    const s = inDungeon();
    expect(itemActions(s, data, "c1", "i1")).toEqual({
      memberId: "c1",
      instanceId: "i1",
      name: "長剣",
      equippedSlot: "weapon",
      slot: "weapon",
      actions: [{ action: "unequip", block: null }],
      identifier: null,
    });
    const g = giveCursed(s, "c3", true);
    const t = ok(g.s, { type: "party.equip", memberId: "c3", instanceId: g.id }).state;
    expect(acts(t, "c3", g.id)).toEqual([{ action: "unequip", block: "cursed" }]);
    // 死亡・灰の者も呪われていなければ外せる（CH-76/U6）
    expect(acts(patched(s, { c1: { life: "dead", hp: 0 } }), "c1", "i1")).toEqual([{ action: "unequip", block: null }]);
  });

  test("UI-80/CH-76/CH-78/CH-79 所持品の装備品は 装備する → 渡す → 捨てる。装備する の理由は checkEquip（class / unidentified / cannotAct / cursedSlot）で campMenu の equipCandidates と同じ", () => {
    let s = inDungeon();
    const sword = give(s, "c5", "long_sword");
    s = sword.s;
    const dag = give(s, "c3", "dagger", false);
    s = dag.s;
    expect(itemActions(s, data, "c5", sword.id)).toMatchObject({ equippedSlot: null, slot: "weapon", identifier: null });
    expect(acts(s, "c5", sword.id)).toEqual([
      { action: "equip", block: "class" },
      { action: "give", block: null },
      { action: "drop", block: null },
    ]);
    // 未鑑定（パーティに司教がいないので鑑定は出さない）
    expect(acts(s, "c3", dag.id)).toEqual([
      { action: "equip", block: "unidentified" },
      { action: "give", block: null },
      { action: "drop", block: null },
    ]);
    expect(acts(patched(s, { c3: { status: ["sleep"] } }), "c3", "i10")![0]).toEqual({ action: "use", block: "cannotAct" });
    const sh = give(s, "c1", "iron_shield");
    expect(acts(sh.s, "c1", sh.id)![0]).toEqual({ action: "equip", block: null });
    const cur = giveCursed(sh.s, "c1", true);
    const t = give(ok(cur.s, { type: "party.equip", memberId: "c1", instanceId: cur.id }).state, "c1", "dagger");
    expect(acts(t.s, "c1", t.id)![0]).toEqual({ action: "equip", block: "cursedSlot" });
    // campMenu の equipCandidates の block と同じ
    for (const st of [s, t.s, patched(s, { c3: { status: ["sleep"] } })]) {
      for (const m of campMenu(st, data)!.members) {
        for (const c of m.equipCandidates) expect(acts(st, m.id, c.instanceId)![0], `${m.id} ${c.instanceId}`).toEqual({ action: "equip", block: c.block });
      }
    }
  });

  test("UI-80/MG-25/DG-30 消耗品・魔法書は 使う → 渡す → 捨てる。使う の可否は fieldItemMenu の usable と同じ（帰還の糸は街で notHere、魔法書は cannotLearn / known）", () => {
    const d = inDungeon();
    expect(acts(d, "c1", "i4")).toEqual([
      { action: "use", block: null },
      { action: "give", block: null },
      { action: "drop", block: null },
    ]);
    // 対象の満タンは品の行では見ない（全員が満タンでも null）
    expect(acts(d, "c5", "i15")![0]).toEqual({ action: "use", block: null });
    const t = inTown();
    expect(acts(t, "c5", "i15")![0]).toEqual({ action: "use", block: "notHere" });
    const tome = give(t, "c1", "tome_lightning");
    expect(acts(tome.s, "c1", tome.id)![0]).toEqual({ action: "use", block: "cannotLearn" });
    const mine = give(t, "c5", "tome_lightning");
    expect(acts(mine.s, "c5", mine.id)![0]).toEqual({ action: "use", block: null });
    const known = patched(mine.s, { c5: { knownSpells: ["fire_arrow", "sleep_mist", "lightning_tome"] } });
    expect(acts(known, "c5", mine.id)![0]).toEqual({ action: "use", block: "known" });
    for (const st of [d, t, known, patched(d, { c4: { status: ["sleep"] } })]) {
      for (const m of fieldItemMenu(st, data)!.members) {
        for (const it of m.items) expect(acts(st, m.id, it.instanceId)![0], `${m.id} ${it.instanceId}`).toEqual({ action: "use", block: it.usable ? null : expect.any(String) });
      }
    }
  });

  test("UI-80/CH-78 渡す は自分以外に受け取れる者（checkGive）がいなければ noReceiver。捨てる は常に送れる", () => {
    let s = inTown();
    for (const id of ["c2", "c3", "c4", "c5", "c6"]) s = fillSlots(s, id);
    expect(acts(s, "c1", "i4")).toEqual([
      { action: "use", block: null },
      { action: "give", block: "noReceiver" },
      { action: "drop", block: null },
    ]);
  });

  test("UI-80/CH-77 鑑定 は未鑑定の所持品で、パーティに鑑定できる者がいるときだけ。鑑定する者は 持ち主 → 並び順 で checkIdentify が通る最初の者。rate は identifyChance", () => {
    const base = bishopAt(inDungeon(), 13, 10); // 79
    const g = give(base, "c3", "dagger", false);
    const a = itemActions(g.s, data, "c3", g.id)!;
    expect(a.actions.map((x) => x.action)).toEqual(["equip", "give", "drop", "identify"]);
    expect(a.actions[3]).toEqual({ action: "identify", block: null });
    expect(a.identifier).toEqual({ id: "c5", name: "エル", rate: 79 });
    expect(a.identifier!.rate).toBe(identifyChance(g.s, data, "c5", g.id)!.rate);
    // 鑑定済みの品には出さない
    expect(acts(base, "c1", "i4")!.map((x) => x.action)).toEqual(["use", "give", "drop"]);
    // MP 切れ・行動不能なら理由付き（鑑定する者はその司教のまま）
    const noMp = itemActions(patched(g.s, { c5: { mp: 0 } }), data, "c3", g.id)!;
    expect(noMp.actions[3]).toEqual({ action: "identify", block: "noMp" });
    expect(noMp.identifier?.id).toBe("c5");
    expect(acts(patched(g.s, { c5: { status: ["sleep"] } }), "c3", g.id)![3]).toEqual({ action: "identify", block: "cannotAct" });
    // 持ち主が司教なら持ち主（2 人目の司教 c4 より先）。持ち主が MP 切れなら送れる c4
    const two = patched(g.s, { c4: { classId: "bishop", maxLevelReached: { bishop: 1 }, mp: 5, mpMax: 5 } });
    const own = give(two, "c5", "dagger", false);
    expect(itemActions(own.s, data, "c5", own.id)!.identifier?.id).toBe("c5");
    expect(itemActions(patched(own.s, { c5: { mp: 0 } }), data, "c5", own.id)!.identifier?.id).toBe("c4");
    // 装備中の未鑑定の品（取り憑き）は 外す だけ
    const eq = cloneState(g.s);
    member(eq, "c3").inventory = member(eq, "c3").inventory.filter((x) => x !== g.id);
    member(eq, "c3").equipment.weapon = g.id;
    expect(acts(eq, "c3", g.id)).toEqual([{ action: "unequip", block: null }]);
  });

  test("UI-80 null: 戦闘中・保留中・title、人がいない、品がその人の装備にも所持品にも無い。state と乱数は変えない", () => {
    const s = inDungeon();
    expect(itemActions(battleOf(s), data, "c1", "i4")).toBeNull();
    expect(itemActions(pending(s), data, "c1", "i4")).toBeNull();
    expect(itemActions(createInitialState(1, data), data, "c1", "i4")).toBeNull();
    expect(itemActions(s, data, "zz", "i4")).toBeNull();
    expect(itemActions(s, data, "c1", "i10")).toBeNull(); // c3 の薬草
    expect(itemActions(s, data, "c1", "zz")).toBeNull();
    const before = JSON.stringify(s);
    for (const m of s.party) for (const id of [...m.inventory, ...Object.values(m.equipment)]) if (id !== null) itemActions(s, data, m.id, id);
    expect(JSON.stringify(s)).toBe(before);
  });
});

// ---------------------------------------------------------------------------

/** base の複製の倉庫の末尾に itemId の実体を足した state と、その実体 id（TW-16c） */
function stash(base: GameState, itemId: string, identified = true): { s: GameState; id: string } {
  const s = cloneState(base);
  const id = createItemInstance(s, { itemId, identified });
  s.warehouse.push(id);
  return { s, id };
}
const nameOfItem = (s: GameState, id: string): string => itemDisplayName(s, data, id);

describe("TW-16c（M21）倉庫から装備する・倉庫へ外す（party.equip の from / to、party.unequip の to）", () => {
  test("TW-16c/CH-76 空きの枠に倉庫の品を装備: 倉庫から消え、inventory は変わらない。message camp.equipped だけ。乱数なし", () => {
    const pre = stash(inTown(), "dagger").s;
    const { s, id } = stash(pre, "leather_cap");
    const other = s.warehouse[0]!;
    const r = ok(s, { type: "party.equip", memberId: "c5", instanceId: id, from: "warehouse" });
    expect(r.events).toEqual([{ kind: "message", key: "camp.equipped", params: { name: "エル", item: nameOfItem(s, id) } }]);
    expect(member(r.state, "c5").equipment.helm).toBe(id);
    expect(member(r.state, "c5").inventory).toEqual(["i15"]);
    expect(r.state.warehouse).toEqual([other]);
    expect(r.state.rng).toEqual(s.rng);
  });

  test("TW-16c 入れ替え（to warehouse）: 旧品は倉庫の新しい品のいた位置に入り、camp.equipped → camp.toWarehouse。手元と使用枠は変わらない", () => {
    const pre = stash(inTown(), "leather_cap").s;
    const { s, id } = stash(pre, "short_bow");
    const r = ok(s, { type: "party.equip", memberId: "c3", instanceId: id, from: "warehouse", to: "warehouse" });
    expect(r.events).toEqual([
      { kind: "message", key: "camp.equipped", params: { name: "キリ", item: nameOfItem(s, id) } },
      { kind: "message", key: "camp.toWarehouse", params: { item: nameOfItem(s, "i7") } },
    ]);
    expect(member(r.state, "c3").equipment.weapon).toBe(id);
    expect(member(r.state, "c3").inventory).toEqual(member(s, "c3").inventory);
    expect(r.state.warehouse).toEqual([s.warehouse[0], "i7"]);
    expect(r.state.rng).toEqual(s.rng);
  });

  test("TW-16c 入れ替え（to なし）: 旧品は inventory の末尾。使用枠に空きが無ければ倉庫の新しい品のいた位置（camp.toWarehouse）", () => {
    const { s, id } = stash(inTown(), "short_bow");
    const r = ok(s, { type: "party.equip", memberId: "c3", instanceId: id, from: "warehouse" });
    expect(r.events.map((e) => (e.kind === "message" ? e.key : e.kind))).toEqual(["camp.equipped"]);
    expect(member(r.state, "c3").inventory).toEqual([...member(s, "c3").inventory, "i7"]);
    expect(r.state.warehouse).toEqual([]);
    const full = fillSlots(s, "c3");
    const r2 = ok(full, { type: "party.equip", memberId: "c3", instanceId: id, from: "warehouse" });
    expect(r2.events.map((e) => (e.kind === "message" ? e.key : e.kind))).toEqual(["camp.equipped", "camp.toWarehouse"]);
    expect(member(r2.state, "c3").inventory).toEqual(member(full, "c3").inventory);
    expect(r2.state.warehouse).toEqual(["i7"]);
  });

  test("TW-16c 手元の品を to warehouse で装備: 旧品は倉庫の末尾（camp.toWarehouse）。旧品が無ければ倉庫は変わらない", () => {
    const { s, id } = give(inTown(), "c3", "short_bow");
    const r = ok(s, { type: "party.equip", memberId: "c3", instanceId: id, to: "warehouse" });
    expect(r.events.map((e) => (e.kind === "message" ? e.key : e.kind))).toEqual(["camp.equipped", "camp.toWarehouse"]);
    expect(member(r.state, "c3").inventory).toEqual(["i10"]);
    expect(r.state.warehouse).toEqual(["i7"]);
    const cap = give(inTown(), "c5", "leather_cap");
    const r2 = ok(cap.s, { type: "party.equip", memberId: "c5", instanceId: cap.id, to: "warehouse" });
    expect(r2.state.warehouse).toEqual([]);
    expect(member(r2.state, "c5").inventory).toEqual(["i15"]);
  });

  test("TW-16c party.unequip の to warehouse: 倉庫の末尾へ入り、camp.unequipped → camp.toWarehouse。満杯なら warehouse full", () => {
    const s = inTown();
    const r = ok(s, { type: "party.unequip", memberId: "c1", slot: "shield", to: "warehouse" });
    expect(r.events).toEqual([
      { kind: "message", key: "camp.unequipped", params: { name: "アルド", item: "木の盾" } },
      { kind: "message", key: "camp.toWarehouse", params: { item: "木の盾" } },
    ]);
    expect(member(r.state, "c1").equipment.shield).toBeNull();
    expect(member(r.state, "c1").inventory).toEqual(["i4"]);
    expect(r.state.warehouse).toEqual(["i3"]);
    expect(r.state.rng).toEqual(s.rng);
    const full = cloneState(s);
    for (let i = 0; i < data.config.items.warehouseSlots; i++) full.warehouse.push(createItemInstance(full, { itemId: "herb", identified: true }));
    expectRejected(full, { type: "party.unequip", memberId: "c1", slot: "shield", to: "warehouse" }, "warehouse full");
    // to なしは今どおり（倉庫が満杯でも inventory へ）
    ok(full, { type: "party.unequip", memberId: "c1", slot: "shield" });
  });

  test("TW-16c 理由: 街だけ（迷宮は not in town）、bad place、item not in warehouse、inventory full、warehouse full、ほかは CH-76 の順", () => {
    const { s, id } = stash(inTown(), "leather_cap");
    // 迷宮（dive 非 null）では from / to を受け付けない。to なしの付け外しは今どおり
    const d = cloneState(dived(1));
    d.warehouse.push(createItemInstance(d, { itemId: "leather_cap", identified: true }));
    expectRejected(d, { type: "party.equip", memberId: "c5", instanceId: d.warehouse[0]!, from: "warehouse" }, "not in town");
    expectRejected(d, { type: "party.unequip", memberId: "c1", slot: "shield", to: "warehouse" }, "not in town");
    expectRejected(battleOf(dived(1)), { type: "party.unequip", memberId: "c1", slot: "shield", to: "warehouse" }, "wrong screen");
    expectRejected(s, { type: "party.equip", memberId: "c5", instanceId: id, from: "bag" as "warehouse" }, "bad place");
    expectRejected(s, { type: "party.unequip", memberId: "c1", slot: "shield", to: "bag" as "warehouse" }, "bad place");
    expectRejected(s, { type: "party.equip", memberId: "c9", instanceId: id, from: "warehouse" }, "no such member");
    expectRejected(patched(s, { c5: { status: ["sleep"] } }), { type: "party.equip", memberId: "c5", instanceId: id, from: "warehouse" }, "cannot act");
    expectRejected(s, { type: "party.equip", memberId: "c5", instanceId: "i15", from: "warehouse" }, "item not in warehouse"); // 手元の品
    expectRejected(s, { type: "party.equip", memberId: "c5", instanceId: id }, "item not in inventory"); // from なしで倉庫の品
    const herb = stash(s, "herb");
    expectRejected(herb.s, { type: "party.equip", memberId: "c5", instanceId: herb.id, from: "warehouse" }, "not equipment");
    const un = stash(s, "dagger", false);
    expectRejected(un.s, { type: "party.equip", memberId: "c3", instanceId: un.id, from: "warehouse" }, "not identified");
    const sw = stash(s, "long_sword");
    expectRejected(sw.s, { type: "party.equip", memberId: "c5", instanceId: sw.id, from: "warehouse" }, "class cannot equip");
    const cur = giveCursed(s, "c3");
    const cursed = stash(ok(cur.s, { type: "party.equip", memberId: "c3", instanceId: cur.id }).state, "dagger");
    expectRejected(cursed.s, { type: "party.equip", memberId: "c3", instanceId: cursed.id, from: "warehouse" }, "slot cursed");
    // 旧品が無く使用枠に空きが無い → inventory full（旧品があれば入れ替えなので通る）
    const full = fillSlots(s, "c5");
    expectRejected(full, { type: "party.equip", memberId: "c5", instanceId: id, from: "warehouse" }, "inventory full");
    expectRejected(full, { type: "party.equip", memberId: "c5", instanceId: id, from: "warehouse", to: "warehouse" }, "inventory full");
    const bow = stash(fillSlots(s, "c3"), "short_bow");
    ok(bow.s, { type: "party.equip", memberId: "c3", instanceId: bow.id, from: "warehouse", to: "warehouse" });
    // 手元の品を to warehouse で入れ替えるとき、倉庫が満杯なら warehouse full
    const own = give(s, "c3", "short_bow");
    const wf = cloneState(own.s);
    for (let i = wf.warehouse.length; i < data.config.items.warehouseSlots; i++) wf.warehouse.push(createItemInstance(wf, { itemId: "herb", identified: true }));
    expectRejected(wf, { type: "party.equip", memberId: "c3", instanceId: own.id, to: "warehouse" }, "warehouse full");
    expect(checkEquip(wf, data, "c3", own.id)).toBeNull(); // to なしは通る
  });

  test("TW-16c campMenu: 街だけ warehouseCandidates（倉庫の順。鑑定済みで職業が装備できる装備品。block は checkEquip）と slots の canUnequipToWarehouse。迷宮は null / false", () => {
    let s = inTown();
    const cap = stash(s, "leather_cap");
    s = cap.s;
    const sw = stash(s, "long_sword");
    s = sw.s;
    const un = stash(s, "dagger", false);
    s = un.s;
    const herb = stash(s, "herb");
    s = herb.s;
    const c5 = campMenu(s, data)!.members.find((m) => m.id === "c5")!;
    expect(c5.warehouseCandidates).toEqual([{ instanceId: cap.id, name: nameOfItem(s, cap.id), slot: "helm", block: null, cursed: false, toWarehouseBlock: null }]);
    const c1 = campMenu(s, data)!.members.find((m) => m.id === "c1")!;
    expect(c1.warehouseCandidates!.map((c) => c.instanceId)).toEqual([cap.id, sw.id]);
    expect(c1.slots.find((x) => x.slot === "shield")!.canUnequipToWarehouse).toBe(true);
    expect(c1.slots.find((x) => x.slot === "helm")!.canUnequipToWarehouse).toBe(false); // 空き枠
    // block は from / to warehouse の checkEquip の写し（full / cannotAct）
    const full = fillSlots(s, "c5");
    expect(campMenu(full, data)!.members.find((m) => m.id === "c5")!.warehouseCandidates![0]!.block).toBe("full");
    expect(campMenu(patched(s, { c1: { status: ["sleep"] } }), data)!.members.find((m) => m.id === "c1")!.warehouseCandidates!.map((c) => c.block)).toEqual([
      "cannotAct",
      "cannotAct",
    ]);
    // 倉庫が満杯なら外して倉庫へ入れられない
    const wf = cloneState(s);
    for (let i = wf.warehouse.length; i < data.config.items.warehouseSlots; i++) wf.warehouse.push(createItemInstance(wf, { itemId: "herb", identified: true }));
    expect(campMenu(wf, data)!.members.find((m) => m.id === "c1")!.slots.every((x) => !x.canUnequipToWarehouse)).toBe(true);
    // 迷宮
    const d = campMenu(dived(1), data)!;
    expect(d.members.every((m) => m.warehouseCandidates === null && m.slots.every((x) => !x.canUnequipToWarehouse))).toBe(true);
  });

  test("TW-16c/UI-80 itemActions: 街の倉庫の装備品は 装備する だけ（from warehouse。理由は campMenu の warehouseCandidates と同じ）。倉庫の消耗品・迷宮は null", () => {
    const { s, id } = stash(inTown(), "leather_cap");
    expect(itemActions(s, data, "c5", id)).toEqual({
      memberId: "c5",
      instanceId: id,
      name: nameOfItem(s, id),
      equippedSlot: null,
      slot: "helm",
      actions: [{ action: "equip", block: null }],
      identifier: null,
      from: "warehouse",
    });
    expect(itemActions(fillSlots(s, "c5"), data, "c5", id)!.actions).toEqual([{ action: "equip", block: "full" }]);
    const sw = stash(s, "long_sword");
    expect(itemActions(sw.s, data, "c5", sw.id)!.actions).toEqual([{ action: "equip", block: "class" }]);
    const herb = stash(s, "herb");
    expect(itemActions(herb.s, data, "c5", herb.id)).toBeNull();
    const d = cloneState(dived(1));
    d.warehouse.push(createItemInstance(d, { itemId: "leather_cap", identified: true }));
    expect(itemActions(d, data, "c5", d.warehouse[0]!)).toBeNull();
    // 手元の品の itemActions は from を持たない
    expect(itemActions(s, data, "c1", "i1")).not.toHaveProperty("from");
  });

  const who = (st: GameState, id: string): Character => st.party.find((c) => c.id === id)!;
  test("TW-16c campMenu の toWarehouseBlock と itemActions の to warehouse: 旧品・外す品を倉庫へ入れる理由（倉庫が満杯で旧品があれば warehouseFull）。迷宮は省略・to は無視。乱数と state は変えない", () => {
    const own = give(inTown(), "c3", "short_bow");
    const s = own.s;
    const cand = (st: GameState) => campMenu(st, data)!.members.find((m) => m.id === "c3")!.equipCandidates.find((c) => c.instanceId === own.id)!;
    expect(cand(s)).toMatchObject({ block: null, toWarehouseBlock: null });
    const wf = cloneState(s);
    for (let i = wf.warehouse.length; i < data.config.items.warehouseSlots; i++) wf.warehouse.push(createItemInstance(wf, { itemId: "herb", identified: true }));
    expect(cand(wf)).toMatchObject({ block: null, toWarehouseBlock: "warehouseFull" });
    // 旧品の無い枠への装備は倉庫を使わないので満杯でも null
    const helm = give(wf, "c1", "leather_cap"); // c1 の兜の枠は空き
    expect(campMenu(helm.s, data)!.members.find((m) => m.id === "c1")!.equipCandidates.find((c) => c.instanceId === helm.id)!.toWarehouseBlock).toBeNull();
    // 迷宮は省略
    const d = campMenu(dived(1), data)!;
    expect(d.members.every((m) => m.equipCandidates.every((c) => !("toWarehouseBlock" in c)))).toBe(true);
    // itemActions の to warehouse
    const before = JSON.stringify(wf);
    const weapon = who(wf, "c3").equipment.weapon!;
    expect(itemActions(wf, data, "c3", weapon, "warehouse")).toMatchObject({ to: "warehouse", actions: [{ action: "unequip", block: "warehouseFull" }] });
    expect(itemActions(wf, data, "c3", own.id, "warehouse")!.actions[0]).toEqual({ action: "equip", block: "warehouseFull" });
    expect(itemActions(s, data, "c3", weapon, "warehouse")!.actions).toEqual([{ action: "unequip", block: null }]);
    expect(itemActions(wf, data, "c3", weapon)).not.toHaveProperty("to"); // to なしは今どおり
    expect(itemActions(wf, data, "c3", weapon)!.actions).toEqual([{ action: "unequip", block: null }]);
    expect(JSON.stringify(wf)).toBe(before);
    // 迷宮では to を無視する（結果に to が無く、理由は手元のまま）
    const dv = dived(1);
    const dw = who(dv, "c1").equipment.weapon!;
    expect(itemActions(dv, data, "c1", dw, "warehouse")).not.toHaveProperty("to");
    expect(itemActions(dv, data, "c1", dw, "warehouse")!.actions).toEqual([{ action: "unequip", block: null }]);
  });

  test("TW-16c/UI-67 equipPreview の from warehouse: 倉庫の品を装備したときの差分（元の state と乱数は変えない）。from なしでは倉庫の品は null", () => {
    const { s, id } = stash(inTown(), "short_bow");
    const before = JSON.stringify(s);
    expect(equipPreview(s, data, "c3", "weapon", id)).toBeNull();
    const pv = equipPreview(s, data, "c3", "weapon", id, "warehouse");
    expect(pv).not.toBeNull();
    expect(pv!.attack.changed).toBe(true);
    expect(JSON.stringify(s)).toBe(before);
  });

  test("TW-16c 乱数: from / to を付けた付け外しは乱数を引かない（rng は送る前と同じ。鏡の rng と並べても同じ）", () => {
    const { s, id } = stash(inTown(), "short_bow");
    const mirror = cloneRng(s.rng);
    const r1 = ok(s, { type: "party.equip", memberId: "c3", instanceId: id, from: "warehouse", to: "warehouse" });
    const r2 = ok(r1.state, { type: "party.unequip", memberId: "c3", slot: "weapon", to: "warehouse" });
    const r3 = ok(r2.state, { type: "party.equip", memberId: "c3", instanceId: "i7", from: "warehouse" });
    expect(r3.state.rng).toEqual(mirror);
    expect(randInt(cloneRng(r3.state.rng), 1, 100)).toBe(randInt(cloneRng(mirror), 1, 100));
  });

  test("TW-16c 新しい文は最悪の値でも会話の箱の 28 字 × 2 行に収まる（6 字の名前・最も長い品名）", () => {
    const units = (x: string): number => Array.from(x).reduce((n, c) => n + ((c.codePointAt(0) ?? 0) < 0x80 ? 0.5 : 1), 0);
    const longest = (xs: string[]): string => [...xs].sort((a, b) => units(b) - units(a))[0]!;
    const S = data.strings;
    const prefix = longest(["fine", "rare", "legendary"].map((r) => S[`item.rarity.${r}`]!));
    const item = longest([
      ...data.equipmentBases.flatMap((b) => [b.unidentifiedName, `${prefix}${b.name}${formatMessage(S["item.plus"]!, { n: 12 })}`]),
      ...data.uniques.map((u) => `${prefix}${u.name}`),
    ]);
    const name = "あ".repeat(data.config.creation.nameMaxLength);
    for (const k of ["camp.toWarehouse", "camp.equipReason.full", "camp.itemReason.full", "camp.equipReason.warehouseFull", "camp.itemReason.warehouseFull"]) {
      const text = formatMessage(S[k]!, { name, item });
      expect(text, k).not.toContain("{");
      expect(kinsokuLines(text, 28).length, `${k}: ${text}`).toBeLessThanOrEqual(2);
    }
    expect(units(S["camp.equipBlock.full"]!)).toBeLessThanOrEqual(units(S["camp.equipBlock.cursedSlot"]!));
    expect(units(S["camp.equipBlock.warehouseFull"]!)).toBeLessThanOrEqual(units(S["camp.equipBlock.cursedSlot"]!));
  });
});

describe("UI-59/IT-32（M24 B-1）campMenu の装備の候補の cursed", () => {
  test("UI-59/IT-32 equipCandidates と warehouseCandidates の cursed は鑑定済みの呪われた品だけ真（未鑑定の呪われた品は偽。中身を漏らさない）", () => {
    const known = giveCursed(inTown(), "c1", true);
    const hidden = giveCursed(known.s, "c1", false);
    const s = hidden.s;
    const stored = cursedDagger(s, true);
    s.warehouse.push(stored);
    const c1 = campMenu(s, data)!.members.find((m) => m.id === "c1")!;
    expect(c1.equipCandidates.filter((c) => [known.id, hidden.id].includes(c.instanceId)).map((c) => [c.instanceId, c.cursed])).toEqual([
      [known.id, true],
      [hidden.id, false],
    ]);
    expect(c1.warehouseCandidates!.find((c) => c.instanceId === stored)!.cursed).toBe(true);
  });
});
