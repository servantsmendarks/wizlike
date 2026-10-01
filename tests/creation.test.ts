import { describe, expect, test } from "vitest";
import { EQUIP_SLOTS } from "../src/core/data";
import { createInitialState, execute } from "../src/core/engine";
import { createRng, randInt } from "../src/core/rng";
import { nameLength, normalizeName, validatePartySetup } from "../src/core/rules/creation";
import { slotsUsed } from "../src/core/state";
import type { Command, PartySetupMember } from "../src/core/types";
import { data, defaultMembers, newGame } from "./helpers/core";

const protos = data.config.prototypeParty.members;

function run(members: unknown, seed = 1) {
  const s = createInitialState(seed, data);
  return { s, r: execute(s, { type: "game.new", party: { members } } as Command, data) };
}

function rejectedReason(members: unknown): string | null {
  const { r } = run(members);
  const e = r.events[0];
  return e?.kind === "rejected" ? e.reason : null;
}

function withMember(i: number, patch: Partial<PartySetupMember>): PartySetupMember[] {
  const ms = defaultMembers();
  ms[i] = { ...ms[i]!, ...patch };
  return ms;
}

describe("creation: game.new", () => {
  test("CH-01 6 人を setup の順に作る。人数が 5 や 7 なら rejected（party size must be 6）", () => {
    const ms = defaultMembers().map((m, i) => ({ ...m, name: `N${i}` }));
    const s = newGame(1, ms);
    expect(s.party.map((c) => c.name)).toEqual(["N0", "N1", "N2", "N3", "N4", "N5"]);
    expect(s.party.map((c) => c.id)).toEqual(["c1", "c2", "c3", "c4", "c5", "c6"]);
    expect(rejectedReason(defaultMembers().slice(0, 5))).toBe("party size must be 6");
    expect(rejectedReason([...defaultMembers(), { name: "X", personality: "normal" }])).toBe("party size must be 6");
    expect(rejectedReason(undefined)).toBe("invalid party setup");
    expect(validatePartySetup(null, data)).toBe("invalid party setup");
    expect(validatePartySetup({ members: "x" }, data)).toBe("invalid party setup");
    expect(validatePartySetup({ members: defaultMembers() }, data)).toBeNull();
  });

  test("CH-02 isLeader は添字 0 の 1 人だけ", () => {
    const s = newGame(1);
    expect(s.party.map((c) => c.isLeader)).toEqual([true, false, false, false, false, false]);
  });

  test("CH-05 種族、職業、能力値、初期呪文は prototypeParty の同じ添字から取る", () => {
    const s = newGame(1);
    s.party.forEach((c, i) => {
      const p = protos[i]!;
      expect(c.raceId).toBe(p.raceId);
      expect(c.classId).toBe(p.classId);
      expect(c.stats).toEqual(p.stats);
      expect(c.stats).not.toBe(p.stats);
      expect(c.knownSpells).toEqual(p.knownSpells);
      expect(c.knownSpells).not.toBe(p.knownSpells);
    });
    expect(s.party[4]!.knownSpells).toEqual(["fire_arrow", "sleep_mist"]);
    expect(s.party[3]!.knownSpells).toEqual(["heal"]);
  });

  test("CH-05 所持金は 300、bank は 0。DG-01 unlockedDungeons は [dungeons[0].id]", () => {
    const s = newGame(1);
    expect(s.gold).toBe(300);
    expect(s.bank).toBe(0);
    expect(s.progress).toEqual({ unlockedDungeons: ["d01"], clearedDungeons: [] });
  });

  test("CH-05 名前は trim して保存する。空と 7 文字は rejected、6 文字は通る、絵文字 1 つは 1 文字", () => {
    expect(newGame(1, withMember(1, { name: "  ベルク　" })).party[1]!.name).toBe("ベルク");
    expect(normalizeName(" a b ")).toBe("a b");
    expect(rejectedReason(withMember(2, { name: "" }))).toBe("invalid name at 2");
    expect(rejectedReason(withMember(2, { name: "   " }))).toBe("invalid name at 2");
    expect(rejectedReason(withMember(2, { name: "abcdefg" }))).toBe("invalid name at 2");
    expect(newGame(1, withMember(2, { name: "abcdef" })).party[2]!.name).toBe("abcdef");
    expect(newGame(1, withMember(2, { name: " あいうえおか " })).party[2]!.name).toBe("あいうえおか");
    // サロゲートペアの絵文字はコードポイント 1 つ
    expect(nameLength("😀")).toBe(1);
    expect(nameLength("😀😀😀😀😀😀")).toBe(6);
    expect(newGame(1, withMember(0, { name: "😀😀😀😀😀😀" })).party[0]!.name).toBe("😀😀😀😀😀😀");
    expect(rejectedReason(withMember(0, { name: "😀😀😀😀😀😀😀" }))).toBe("invalid name at 0");
    // 名前が string でない、要素がオブジェクトでない
    expect(rejectedReason(withMember(3, { name: 5 as unknown as string }))).toBe("invalid name at 3");
    const ms: unknown[] = defaultMembers();
    ms[4] = null;
    expect(rejectedReason(ms)).toBe("invalid name at 4");
    // 重複は許す
    const dup = defaultMembers().map((m) => ({ ...m, name: "同名" }));
    expect(newGame(1, dup).party.every((c) => c.name === "同名")).toBe(true);
  });

  test("CH-31 リーダーは personality null。性格を指定すると leader must have no personality", () => {
    expect(newGame(1).party[0]!.personality).toBeNull();
    expect(rejectedReason(withMember(0, { personality: "cautious" }))).toBe("leader must have no personality");
    expect(rejectedReason(withMember(0, { personality: "random" }))).toBe("leader must have no personality");
  });

  test("CH-30 リーダー以外の null は personality required at i。未知の値は unknown personality at i", () => {
    expect(rejectedReason(withMember(2, { personality: null }))).toBe("personality required at 2");
    expect(rejectedReason(withMember(5, { personality: "brave" as never }))).toBe("unknown personality at 5");
    const ms: unknown[] = defaultMembers();
    ms[1] = { name: "X" }; // personality が無い
    expect(rejectedReason(ms)).toBe("unknown personality at 1");
    expect(newGame(1).party.map((c) => c.personality)).toEqual([null, "cautious", "reckless", "greedy", "normal", "cautious"]);
  });

  test("CH-30 seed 1 で 5 人とも random なら cautious, reckless, normal, greedy, greedy", () => {
    // seed 1 の randInt(0,3) = 0,1,3,2,2 → personalities 配列順 [cautious, reckless, greedy, normal]
    const rng = createRng(1);
    expect([0, 1, 2, 3, 4].map(() => randInt(rng, 0, 3))).toEqual([0, 1, 3, 2, 2]);
    const ms = defaultMembers().map((m, i) => (i === 0 ? m : { ...m, personality: "random" as const }));
    const s = newGame(1, ms);
    expect(s.party.map((c) => c.personality)).toEqual([null, "cautious", "reckless", "normal", "greedy", "greedy"]);
    expect(s.rng).toEqual(rng);
  });

  test("CH-30 random は添字の順に振る（seed 1、c3 と c6 だけ random なら 0,1 → cautious, reckless）", () => {
    const ms = defaultMembers();
    ms[2] = { ...ms[2]!, personality: "random" };
    ms[5] = { ...ms[5]!, personality: "random" };
    const s = newGame(1, ms);
    expect(s.party[2]!.personality).toBe("cautious");
    expect(s.party[5]!.personality).toBe("reckless");
  });

  test("CH-30 random が無ければ rng を消費しない", () => {
    const s = newGame(1);
    expect(s.rng).toEqual(createRng(1));
  });

  test("CH-40/43/50 作成時は alive、status []、san = sanMax = 100", () => {
    for (const c of newGame(1).party) {
      expect(c.life).toBe("alive");
      expect(c.status).toEqual([]);
      expect(c.san).toBe(100);
      expect(c.sanMax).toBe(100);
      expect(c.lastBattleInput).toBeNull();
    }
  });

  test("CH-63 作成時は level 1、exp 0、maxLevelReached 1、levelHistory []", () => {
    for (const c of newGame(1).party) {
      expect(c.level).toBe(1);
      expect(c.exp).toBe(0);
      expect(c.maxLevelReached).toBe(1);
      expect(c.levelHistory).toEqual([]);
    }
  });

  test("CH-65/MG-01 レベル 1 の hpMax/mpMax（アルド 11/0、ベルク 12/0、キリ 5/0、ドナ 8/5、エル 2/7、フィン 5/0）、hp と mp は満タン", () => {
    const party = newGame(1).party;
    expect(party.map((c) => [c.hpMax, c.mpMax])).toEqual([
      [11, 0],
      [12, 0],
      [5, 0],
      [8, 5],
      [2, 7],
      [5, 0],
    ]);
    for (const c of party) {
      expect(c.hp).toBe(c.hpMax);
      expect(c.mp).toBe(c.mpMax);
    }
  });

  test("CH-70 equipment は 6 スロットのキーをすべて持ち、空きは null。アルドの weapon は i1（long_sword）", () => {
    const s = newGame(1);
    for (const c of s.party) expect(Object.keys(c.equipment).sort()).toEqual([...EQUIP_SLOTS].sort());
    const aldo = s.party[0]!;
    expect(aldo.equipment).toEqual({
      weapon: "i1",
      armor: "i2",
      shield: "i3",
      helm: null,
      gauntlet: null,
      accessory: null,
    });
    expect(s.items["i1"]).toEqual({ id: "i1", itemId: "long_sword", identified: true });
    expect(s.items["i2"]!.itemId).toBe("leather_armor");
    expect(s.items["i3"]!.itemId).toBe("wooden_shield");
  });

  test("CH-71 inventory は装備を含まない。アルドの inventory は [i4]（herb）、slotsUsed は 4", () => {
    const s = newGame(1);
    const aldo = s.party[0]!;
    expect(aldo.inventory).toEqual(["i4"]);
    expect(s.items["i4"]!.itemId).toBe("herb");
    expect(slotsUsed(aldo)).toBe(4);
    for (const c of s.party) {
      const equipped = Object.values(c.equipment).filter((x) => x !== null);
      expect(c.inventory.filter((x) => equipped.includes(x))).toEqual([]);
    }
  });

  test("CH-72 初期の実体はすべて identified true", () => {
    const s = newGame(1);
    expect(Object.values(s.items).every((it) => it.identified)).toBe(true);
  });

  test("ID 実体は i1..i18。items のキーと参照が 1 対 1 で、nextItemSeq は 19。キャラクターは c1..c6", () => {
    const s = newGame(1);
    const expected = Array.from({ length: 18 }, (_, k) => `i${k + 1}`);
    expect(Object.keys(s.items).sort()).toEqual([...expected].sort());
    const refs = s.party.flatMap((c) => [
      ...EQUIP_SLOTS.map((slot) => c.equipment[slot]).filter((x): x is string => x !== null),
      ...c.inventory,
    ]);
    // 参照の順は メンバー添字順 → EQUIP_SLOTS 順 → inventory 順 で、採番順と一致する
    expect(refs).toEqual(expected);
    for (const [k, v] of Object.entries(s.items)) expect(v.id).toBe(k);
    expect(s.nextItemSeq).toBe(19);
    expect(s.party.map((c) => c.id)).toEqual(["c1", "c2", "c3", "c4", "c5", "c6"]);
    // 実体の itemId は prototypeParty と一致する
    const protoItems = protos.flatMap((p) => [
      ...EQUIP_SLOTS.map((slot) => p.equipment[slot]).filter((x): x is string => x !== undefined),
      ...p.inventory,
    ]);
    expect(refs.map((id) => s.items[id]!.itemId)).toEqual(protoItems);
  });
});
