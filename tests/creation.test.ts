import { describe, expect, test } from "vitest";
import { EQUIP_SLOTS } from "../src/core/data";
import { createInitialState, execute } from "../src/core/engine";
import type { StatBlock } from "../src/core/data";
import { chance, cloneRng, createRng, randInt, rollDie } from "../src/core/rng";
import {
  adjustStat,
  classOptions,
  nameLength,
  normalizeName,
  rollBonus,
  rollBonusParts,
  STAT_MAX,
  statAllocation,
  validCreationName,
  validatePartySetup,
} from "../src/core/rules/creation";
import { initialHpMax, mpGainFor } from "../src/core/rules/growth";
import { slotsUsed } from "../src/core/state";
import type { Command, CustomMember, PartySetupMember } from "../src/core/types";
import { data, defaultMembers, expectKnownStringKeys, gameNewEvents, loadFreshData, newGame } from "./helpers/core";

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

  test("CH-05 所持金は 300、bank は 0。DG-01 unlockedDungeons は [dungeons[0].id]。IT-62 shopLevel は 0、IT-64/63/66 倉庫・買い戻し・図鑑は空（M7）", () => {
    const s = newGame(1);
    expect(s.gold).toBe(300);
    expect(s.bank).toBe(0);
    // M12: progress に enteredDungeons / conquered / endingPending を足した（SV-04 v7）
    expect(s.progress).toEqual({ unlockedDungeons: ["d01"], clearedDungeons: [], shopLevel: 0, enteredDungeons: [], conquered: false, endingPending: false });
    expect([s.warehouse, s.buyback, s.uniqueBook]).toEqual([[], [], {}]);
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

  test("CH-63 作成時は level 1、exp 0、maxLevelReached は今の職業だけ 1（{ [classId]: 1 }）、levelHistory []", () => {
    for (const c of newGame(1).party) {
      expect(c.level).toBe(1);
      expect(c.exp).toBe(0);
      expect(c.maxLevelReached).toEqual({ [c.classId]: 1 }); // SV-04 v5: 職業ごとの記録
      expect(c.levelHistory).toEqual([]);
    }
  });

  test("CH-65/MG-01 レベル 1 の hpMax/mpMax（アルド 15/0、ベルク 16/0、キリ 10/0、ドナ 12/5、エル 8/7、フィン 10/0）、hp と mp は満タン", () => {
    // hpMax = hpDie + max(0, 生命力補正) + level1Bonus 4（手計算は growth.test.ts の CH-65）
    const party = newGame(1).party;
    expect(party.map((c) => [c.hpMax, c.mpMax])).toEqual([
      [15, 0],
      [16, 0],
      [10, 0],
      [12, 5],
      [8, 7],
      [10, 0],
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
    // IT-04（M7）: 初期装備は汎用 Lv0・通常・オプションなし・鑑定済み・呪いなし（foundIn null）
    expect(s.items["i1"]).toEqual({
      id: "i1",
      itemId: "long_sword",
      level: 0,
      rarity: "normal",
      options: [],
      uniqueId: null,
      identified: true,
      cursed: false,
      foundIn: null,
    });
    for (const inst of Object.values(s.items)) {
      expect([inst.level, inst.rarity, inst.options, inst.uniqueId, inst.cursed, inst.foundIn], inst.id).toEqual([0, "normal", [], null, false, null]);
    }
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

  test("CH-72/IT-13 初期の実体はすべて identified true", () => {
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

// ---------------------------------------------------------------- CH-06 / CH-11 / CH-21 / CH-24 自分で作る（M5.5）

/** 有効な 6 人。配分は手で数えた値（種族の基礎値は races.json、職業の条件は classes.json） */
function customMembers(): CustomMember[] {
  return [
    // 人間 {8,8,5,8,8,9} に str+6・vit+4（計 10）→ 戦士（str 11）
    { name: "アキ", personality: null, raceId: "human", classId: "fighter", stats: { str: 14, iq: 8, pie: 5, vit: 12, agi: 8, luk: 9 } },
    // ドワーフ {10,7,10,10,5,6} に pie+5 → 僧侶（pie 11）
    { name: "イサ", personality: "cautious", raceId: "dwarf", classId: "priest", stats: { str: 10, iq: 7, pie: 15, vit: 10, agi: 5, luk: 6 } },
    // ホビット {5,7,7,6,10,15} に agi+4 → 盗賊（agi 11）
    { name: "ウル", personality: "reckless", raceId: "hobbit", classId: "thief", stats: { str: 5, iq: 7, pie: 7, vit: 6, agi: 14, luk: 15 } },
    // エルフ {7,10,10,6,9,6} に iq+6 → 魔術師（iq 11）
    { name: "エマ", personality: "greedy", raceId: "elf", classId: "mage", stats: { str: 7, iq: 16, pie: 10, vit: 6, agi: 9, luk: 6 } },
    // ノーム {7,7,10,8,10,7} に iq+5・pie+2（計 7）→ 司教（iq 12・pie 12 ちょうど）
    { name: "オト", personality: "normal", raceId: "gnome", classId: "bishop", stats: { str: 7, iq: 12, pie: 12, vit: 8, agi: 10, luk: 7 } },
    // ドワーフ {10,7,10,10,5,6} に str+5・iq+4・vit+4・agi+5（計 18）→ 侍（str 15・iq 11・pie 10・vit 14・agi 10 ちょうど）
    { name: "カイ", personality: "cautious", raceId: "dwarf", classId: "samurai", stats: { str: 15, iq: 11, pie: 10, vit: 14, agi: 10, luk: 6 } },
  ];
}

function customReason(members: unknown): string | null {
  const s = createInitialState(1, data);
  const r = execute(s, { type: "game.new", party: { kind: "custom", members } } as Command, data);
  const e = r.events[0];
  return e?.kind === "rejected" ? e.reason : null;
}

function withCustom(i: number, patch: Partial<CustomMember>): CustomMember[] {
  const ms = customMembers();
  ms[i] = { ...ms[i]!, ...patch };
  return ms;
}

describe("creation: 自分で作る（CH-06 / CH-11 / CH-21 / CH-24）", () => {
  test("CH-11 rollBonus は rollDie(bonusDie) → chance(bonusBigChance) の順で bonusBase + 出目 (+ bonusBig)（鏡の rng。bonusBigChance 0 / 100）", () => {
    for (const pct of [0, 100]) {
      const cfg = { ...data.config.creation, bonusBigChance: pct };
      for (const seed of [1, 2, 3, 4, 5]) {
        const rng = createRng(seed);
        const mirror = cloneRng(rng);
        const die = rollDie(mirror, cfg.bonusDie);
        const big = chance(mirror, pct);
        expect(big).toBe(pct === 100);
        const v = rollBonus(rng, cfg);
        expect(v).toBe(7 + die + (pct === 100 ? 10 : 0));
        expect(rng).toEqual(mirror); // randInt を 2 回だけ消費する
        expect(v).toBeGreaterThanOrEqual(pct === 100 ? 18 : 8);
        expect(v).toBeLessThanOrEqual(pct === 100 ? 21 : 11);
      }
    }
  });

  test("CH-11 / UI-62 rollBonusParts は rollBonus と同じ順で引き、内訳 base / die / big と合計 total を返す（鏡の rng。bonusBigChance 0 / 100）", () => {
    for (const pct of [0, 100]) {
      const cfg = { ...data.config.creation, bonusBigChance: pct };
      for (const seed of [1, 2, 3, 4, 5]) {
        const rng = createRng(seed);
        const mirror = cloneRng(rng);
        const die = rollDie(mirror, cfg.bonusDie);
        const hit = chance(mirror, pct);
        const parts = rollBonusParts(rng, cfg);
        expect(parts).toEqual({ base: 7, die, big: hit ? 10 : 0, total: 7 + die + (hit ? 10 : 0) });
        expect(rng).toEqual(mirror); // randInt を 2 回だけ消費する
        // rollBonus は同じ種で同じ合計（包み）
        expect(rollBonus(createRng(seed), cfg)).toBe(parts.total);
      }
    }
  });

  test("CH-11 / UI-62 rollBonusParts（実データ）: seed 固定の出目（seed 1..400 で外れは big 0、当たりは big 10。合計は base + die + big）", () => {
    let hits = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const p = rollBonusParts(createRng(seed), data.config.creation);
      expect(p.base).toBe(7);
      expect(p.die).toBeGreaterThanOrEqual(1);
      expect(p.die).toBeLessThanOrEqual(4);
      expect([0, 10]).toContain(p.big);
      expect(p.total).toBe(p.base + p.die + p.big);
      expect(p.total).toBe(rollBonus(createRng(seed), data.config.creation));
      if (p.big === 10) hits++;
    }
    expect(hits).toBeGreaterThan(0); // 5% の当たりの分岐を通る
    // 固定の種の出目: seed 1 は外れ（7+1）、seed 22 は当たり（7+4+10）
    expect(rollBonusParts(createRng(1), data.config.creation)).toEqual({ base: 7, die: 1, big: 0, total: 8 });
    expect(rollBonusParts(createRng(22), data.config.creation)).toEqual({ base: 7, die: 4, big: 10, total: 21 });
  });

  test("CH-11 rollBonus は実データ（7 + 1d4、5% で +10）の範囲 8..11 / 18..21 だけを出す（seed 1..400）", () => {
    const seen = new Set<number>();
    for (let seed = 1; seed <= 400; seed++) seen.add(rollBonus(createRng(seed), data.config.creation));
    for (const v of seen) expect([8, 9, 10, 11, 18, 19, 20, 21]).toContain(v);
    for (const v of [8, 9, 10, 11]) expect(seen.has(v)).toBe(true);
  });

  test("CH-11 statAllocation / adjustStat: 基礎値未満・18 超・残り 0 で増やす操作は同じ参照。complete は残り 0 のときだけ", () => {
    const base = data.races.find((r) => r.id === "human")!.baseStats; // {8,8,5,8,8,9}
    let st = { ...base };
    let a = statAllocation("human", st, 2, data);
    expect(a.remaining).toBe(2);
    expect(a.complete).toBe(false);
    expect(a.rows.map((r) => r.key)).toEqual(["str", "iq", "pie", "vit", "agi", "luk"]);
    expect(a.rows.map((r) => r.base)).toEqual([8, 8, 5, 8, 8, 9]);
    expect(a.rows.every((r) => r.canInc && !r.canDec)).toBe(true);
    // 基礎値未満には下げられない（同じ参照）
    expect(adjustStat("human", st, 2, "str", -1, data)).toBe(st);
    st = adjustStat("human", st, 2, "str", 1, data);
    st = adjustStat("human", st, 2, "str", 1, data);
    expect(st.str).toBe(10);
    a = statAllocation("human", st, 2, data);
    expect(a.remaining).toBe(0);
    expect(a.complete).toBe(true);
    expect(a.rows.every((r) => !r.canInc)).toBe(true);
    expect(a.rows.find((r) => r.key === "str")!.canDec).toBe(true);
    // 残り 0 では増やせない（同じ参照）
    expect(adjustStat("human", st, 2, "iq", 1, data)).toBe(st);
    // 減らすと残りが戻る
    const back = adjustStat("human", st, 2, "str", -1, data);
    expect(back.str).toBe(9);
    expect(statAllocation("human", back, 2, data).remaining).toBe(1);
    // 18 を超えない（ホビットの luk 15 に 3 足して 18、もう 1 は同じ参照）
    let h = { ...data.races.find((r) => r.id === "hobbit")!.baseStats };
    for (let k = 0; k < 3; k++) h = adjustStat("hobbit", h, 10, "luk", 1, data);
    expect(h.luk).toBe(STAT_MAX);
    expect(STAT_MAX).toBe(18);
    expect(statAllocation("hobbit", h, 10, data).rows.find((r) => r.key === "luk")!.canInc).toBe(false);
    expect(adjustStat("hobbit", h, 10, "luk", 1, data)).toBe(h);
  });

  test("CH-21 classOptions は requirements をすべて満たす職業だけ ok（境界: ちょうど満たす / 1 足りない）", () => {
    const ids = data.classes.map((c) => c.id);
    const okOf = (stats: StatBlock) => classOptions(stats, data).filter((o) => o.ok).map((o) => o.classId);
    expect(classOptions(customMembers()[0]!.stats, data).map((o) => o.classId)).toEqual(ids);
    // 司教ちょうど（iq 12・pie 12）
    const gnome = customMembers()[4]!.stats;
    expect(okOf(gnome)).toEqual(["priest", "mage", "bishop"]);
    // pie が 1 足りないと司教は不可（僧侶 pie 11 は可）
    expect(okOf({ ...gnome, pie: 11 })).toEqual(["priest", "mage"]);
    // 侍ちょうど（str15 iq11 pie10 vit14 agi10）と、agi が 1 足りないとき
    const sam = customMembers()[5]!.stats;
    expect(okOf(sam)).toContain("samurai");
    expect(okOf({ ...sam, agi: 9 })).not.toContain("samurai");
    const opt = classOptions(sam, data).find((o) => o.classId === "samurai")!;
    expect(opt.name).toBe("侍");
    expect(opt.requirements).toEqual({ str: 15, iq: 11, pie: 10, vit: 14, agi: 10 });
  });

  test("CH-05/CH-06 validCreationName は trim 後 1..6 文字（コードポイント）", () => {
    expect(validCreationName("  ab ", data)).toBe(true);
    expect(validCreationName("あいうえおか", data)).toBe(true);
    expect(validCreationName("あいうえおかき", data)).toBe(false);
    expect(validCreationName("   ", data)).toBe(false);
    expect(validCreationName("😀😀😀😀😀😀", data)).toBe(true);
  });

  test("CH-06/CH-24 game.new custom: 装備・所持品・呪文は classes[].start、所持金は Σ start.gold（300）。HP / MP は initialHpMax / mpGainFor。リーダーは c1・personality null", () => {
    const ms = customMembers();
    ms[2] = { ...ms[2]!, name: " ウル　" };
    const s0 = createInitialState(1, data);
    const r = execute(s0, { type: "game.new", party: { kind: "custom", members: ms } }, data);
    const s = r.state;
    expect(r.events).toEqual(gameNewEvents()); // TW-36（M12.5）: screen{town} の後に開始の語り
    expect(s.screen).toBe("town");
    expect(s.gold).toBe(300);
    expect(s.rng).toEqual(createRng(1)); // random が無ければ乱数を使わない
    expect(s.party.map((c) => c.id)).toEqual(["c1", "c2", "c3", "c4", "c5", "c6"]);
    expect(s.party.map((c) => c.name)).toEqual(["アキ", "イサ", "ウル", "エマ", "オト", "カイ"]);
    expect(s.party.map((c) => c.isLeader)).toEqual([true, false, false, false, false, false]);
    expect(s.party.map((c) => c.personality)).toEqual([null, "cautious", "reckless", "greedy", "normal", "cautious"]);
    expect(s.party.map((c) => [c.raceId, c.classId])).toEqual([
      ["human", "fighter"],
      ["dwarf", "priest"],
      ["hobbit", "thief"],
      ["elf", "mage"],
      ["gnome", "bishop"],
      ["dwarf", "samurai"],
    ]);
    s.party.forEach((c, i) => {
      const m = customMembers()[i]!;
      const cls = data.classes.find((x) => x.id === m.classId)!;
      expect(c.stats).toEqual(m.stats);
      expect(c.hpMax).toBe(initialHpMax(cls, m.stats, data.config));
      expect(c.mpMax).toBe(mpGainFor(cls, m.stats, data.config));
      expect(c.hp).toBe(c.hpMax);
      expect(c.mp).toBe(c.mpMax);
      expect(c.knownSpells).toEqual(cls.start.knownSpells);
      expect(c.level).toBe(1);
      expect(c.life).toBe("alive");
      const eq = EQUIP_SLOTS.flatMap((slot) => (c.equipment[slot] === null ? [] : [[slot, s.items[c.equipment[slot]!]!.itemId]]));
      expect(Object.fromEntries(eq)).toEqual(cls.start.equipment);
      expect(c.inventory.map((id) => s.items[id]!.itemId)).toEqual(cls.start.inventory);
    });
    // 手で数えた値: 戦士 アキは long_sword・leather_armor・wooden_shield と herb（i1..i4）
    expect(s.party[0]!.equipment).toEqual({ weapon: "i1", armor: "i2", shield: "i3", helm: null, gauntlet: null, accessory: null });
    expect(s.party[0]!.inventory).toEqual(["i4"]);
    expect(s.party[3]!.knownSpells).toEqual(["fire_arrow", "sleep_mist"]);
    expect(s.party[4]!.knownSpells).toEqual(["heal", "fire_arrow"]);
    expect(Object.values(s.items).every((it) => it.identified)).toBe(true);
    // 余分なキーは写さない（GameState は JSON 安全なプレーンなオブジェクト）
    const extra = customMembers();
    (extra[0]!.stats as Record<string, number>)["xyz"] = 3;
    const s2 = execute(createInitialState(1, data), { type: "game.new", party: { kind: "custom", members: extra } }, data).state;
    expect(Object.keys(s2.party[0]!.stats)).toEqual(["str", "iq", "pie", "vit", "agi", "luk"]);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  test("CH-06/CH-30 game.new custom の性格の random はおすすめと同じく添字の順に state.rng で決める（seed 1 で 0,1,3,2,2）", () => {
    const ms = customMembers().map((m, i) => (i === 0 ? m : { ...m, personality: "random" as const }));
    const s = execute(createInitialState(1, data), { type: "game.new", party: { kind: "custom", members: ms } }, data).state;
    const rng = createRng(1);
    expect([0, 1, 2, 3, 4].map(() => randInt(rng, 0, 3))).toEqual([0, 1, 3, 2, 2]);
    expect(s.party.map((c) => c.personality)).toEqual([null, "cautious", "reckless", "normal", "greedy", "greedy"]);
    expect(s.rng).toEqual(rng);
  });

  test("CH-06 game.new custom の検証: 未知の種族・職業、基礎値未満・18 超・小数、配分の合計 > 21、職業の条件を満たさない、名前・性格の誤り、6 人でない、未知の kind → rejected", () => {
    expect(customReason(customMembers())).toBeNull();
    expect(validatePartySetup({ kind: "custom", members: customMembers() }, data)).toBeNull();
    expect(validatePartySetup({ kind: "quick", members: defaultMembers() }, data)).toBe("invalid party setup");
    expect(customReason(customMembers().slice(0, 5))).toBe("party size must be 6");
    expect(customReason(withCustom(3, { name: "あいうえおかき" }))).toBe("invalid name at 3");
    expect(customReason(withCustom(0, { personality: "normal" }))).toBe("leader must have no personality");
    expect(customReason(withCustom(2, { personality: null }))).toBe("personality required at 2");
    expect(customReason(withCustom(1, { raceId: "orc" }))).toBe("unknown race at 1");
    expect(customReason(withCustom(1, { classId: "ninja" }))).toBe("unknown class at 1");
    const st = customMembers()[0]!.stats;
    // 人間の pie の基礎値は 5
    expect(customReason(withCustom(0, { stats: { ...st, pie: 4 } }))).toBe("bad stats at 0");
    expect(customReason(withCustom(0, { stats: { ...st, str: 19 } }))).toBe("bad stats at 0");
    expect(customReason(withCustom(0, { stats: { ...st, str: 13.5 } }))).toBe("bad stats at 0");
    expect(customReason(withCustom(0, { stats: { ...st, luk: "9" as unknown as number } }))).toBe("bad stats at 0");
    const noLuk: Record<string, number> = { ...st };
    delete noLuk["luk"];
    expect(customReason(withCustom(0, { stats: noLuk as StatBlock }))).toBe("bad stats at 0");
    expect(customReason(withCustom(0, { stats: null as unknown as StatBlock }))).toBe("bad stats at 0");
    // 配分の上限 7 + 4 + 10 = 21。人間 {8,8,5,8,8,9} に 21 は通り、22 は止まる
    const h21 = { str: 18, iq: 12, pie: 5, vit: 12, agi: 11, luk: 9 }; // 10 + 4 + 4 + 3 = 21
    expect(customReason(withCustom(0, { stats: h21 }))).toBeNull();
    expect(customReason(withCustom(0, { stats: { ...h21, agi: 12 } }))).toBe("too many bonus points at 0");
    // 職業の条件（戦士 str 11）
    expect(customReason(withCustom(0, { stats: { ...st, str: 10 } }))).toBe("class requirements not met at 0");
    expect(customReason(withCustom(0, { stats: { ...st, str: 11 } }))).toBeNull();
    // 簡易作成の形は今のまま（kind が無い）
    expect(validatePartySetup({ members: defaultMembers() }, data)).toBeNull();
  });
});

// ---------------------------------------------------------------- TW-36 開始の語り（M12.5）

describe("creation: TW-36 開始の語り", () => {
  const OPENING = ["opening.speech.1", "opening.speech.2", "opening.speech.3", "opening.speech.4", "opening.speech.5"];
  const keyOf = (e: { kind: string; key?: string }): string => (e.kind === "message" ? e.key! : e.kind);
  const quick = (d = data) => execute(createInitialState(1, d), { type: "game.new", party: { members: defaultMembers() } }, d);
  const custom = (d = data) => execute(createInitialState(1, d), { type: "game.new", party: { kind: "custom", members: customMembers() } }, d);

  test("TW-36 game.new（おすすめ・自分で作るの両方）は screen{town} の後に opening.speech.1..5 を順に message で出す（差し込みなし。キーは strings に実在）", () => {
    for (const r of [quick(), custom()]) {
      expect(r.events).toEqual([{ kind: "screen", to: "town" }, ...OPENING.map((key) => ({ kind: "message", key }))]);
      expectKnownStringKeys(r.events);
    }
  });

  test("TW-36 開始の語りは乱数を使わない（random の性格が無ければ state.rng は createRng(seed) のまま）", () => {
    expect(quick().state.rng).toEqual(createRng(1));
    expect(custom().state.rng).toEqual(createRng(1));
  });

  test("TW-36 行の数は strings の続き番号で決まる: 2 行・7 行に差し替えるとそれに従い、途切れた先（3 が無ければ 4 以降）は使わない", () => {
    const cases: [string[], string[]][] = [
      [["opening.speech.3", "opening.speech.4", "opening.speech.5"], OPENING.slice(0, 2)],
      [["opening.speech.3"], OPENING.slice(0, 2)],
      [[], OPENING],
    ];
    for (const [drop, want] of cases) {
      const d = loadFreshData();
      for (const k of drop) delete (d.strings as Record<string, string>)[k];
      expect(quick(d).events.map(keyOf), drop.join(",")).toEqual(["screen", ...want]);
    }
    const seven = loadFreshData();
    (seven.strings as Record<string, string>)["opening.speech.6"] = "六";
    (seven.strings as Record<string, string>)["opening.speech.7"] = "七";
    expect(custom(seven).events.map(keyOf)).toEqual(["screen", ...OPENING, "opening.speech.6", "opening.speech.7"]);
  });
});
