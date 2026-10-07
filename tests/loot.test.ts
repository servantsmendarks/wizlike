// rules/loot.ts（items.md IT-30〜33・IT-50〜54 のドロップ）と、それを呼ぶ宝箱（CB-52）のテスト。M7 の B5。
// 期待値は、データを書き換えて結果を 1 通りに絞った上で手で数え、乱数の消費は鏡の rng（同じ順に同じ引数で呼ぶ）で数える。
// ボスの戦利品（DG-31）は tests/dungeon.test.ts のボスの describe にある。
import { describe, expect, test } from "vitest";
import type { DropEntry, GameData, ItemOption, OptionKind } from "../src/core/data";
import { optionAppliesTo } from "../src/core/data";
import { chance, cloneRng, randInt, weightedIndex } from "../src/core/rng";
import { genericOptionTier, partyChestQuality, placeFoundItem, rollDropTable, rollItemSpec } from "../src/core/rules/loot";
import { cloneState, createItemInstance, makeContext, memberById } from "../src/core/state";
import type { BattleAction, Character, Command, GameState } from "../src/core/types";
import { ALWAYS_HIT, allInputs, dataWith, dived, exec, kindsOf, withBattle } from "./helpers/battle";
import { data, expectKnownStringKeys, expectStateInvariants, loadFreshData } from "./helpers/core";

const RESOLVE: Command = { type: "battle.resolve" };
const DEF: BattleAction = { type: "defend" };
const member = (s: GameState, id: string): Character => memberById(s, id)!;
const SWORD: DropEntry[] = [{ base: "long_sword", weight: 1 }];
/** 希少度の重み（normal / fine / rare / legendary）を 1 つだけ 1 にして、引く希少度を固定する */
const ONLY = { normal: [1, 0, 0, 0], fine: [0, 1, 0, 0], rare: [0, 0, 1, 0], legendary: [0, 0, 0, 1] } as const;

/** 希少度・呪い・振れ幅を固定したデータ（独立したコピー） */
function lootData(o: { rarity?: keyof typeof ONLY; curse?: number; spread?: number; mut?: (d: GameData) => void } = {}): GameData {
  const d = loadFreshData();
  const w = ONLY[o.rarity ?? "normal"];
  d.config.items.rarities.forEach((r, i) => (r.weight = w[i]!));
  d.config.items.curseChance = o.curse ?? 0;
  if (o.spread !== undefined) d.config.items.dropLevelSpread = o.spread;
  o.mut?.(d);
  return d;
}

/** IT-36: 実データのオプション表のうち、その品種に付けられるもの（IT-33 / IT-52 の母集団の鏡） */
const poolOf = (kind: OptionKind): ItemOption[] => data.itemOptions.options.filter((x) => optionAppliesTo(x, kind));
/** 武器（術者用でない）の母集団の重み（IT-33 の鏡で、引いた分を除きながら使う）。M10 で表に杖・装飾品だけの magic_power を足したので品種で絞る */
const OPTION_WEIGHTS = poolOf("weapon").map((x) => x.weight);

describe("IT-52 1 品の生成と乱数の順", () => {
  test("IT-52 汎用: weightedIndex(entries) → randInt(−spread, +spread) → weightedIndex(rarities) → chance(curse) → オプションの個数だけ weightedIndex（残りの重み）。鏡の rng", () => {
    // 実データの希少度の重み 75/18/6/1 と呪い 8% のまま、上質以上が出るシードを探して 1 品をちょうど作る
    for (let seed = 1; seed < 400; seed++) {
      const s = dived(seed);
      const m = cloneRng(s.rng);
      const entries: DropEntry[] = [{ base: "dagger", weight: 2 }, { base: "long_sword", weight: 3 }];
      const ei = weightedIndex(m, [2, 3]);
      const delta = randInt(m, -1, 1);
      const ri = weightedIndex(m, [75, 18, 6, 1]);
      const cursed = chance(m, 8);
      const n = [0, 1, 2, 3][ri]! + (cursed ? 1 : 0);
      if (n < 2) continue;
      const level = Math.max(1, 5 + delta);
      const tier = level >= 4 ? 2 : 1; // IT-33: Lv4〜7 は段階 2
      const pool = poolOf("weapon"); // 短剣・長剣は品種 weapon（IT-36）
      const want: { optionId: string; tier: number; value: number }[] = [];
      for (let i = 0; i < n; i++) {
        const k = weightedIndex(
          m,
          pool.map((x) => x.weight),
        );
        const o = pool.splice(k, 1)[0]!;
        want.push({ optionId: o.id, tier, value: o.values[tier - 1]! });
      }
      if (cursed) want[want.length - 1]!.value *= -1;
      const spec = rollItemSpec(s, data, entries, 5, 0, "d01");
      expect(s.rng).toEqual(m);
      expect(spec).toEqual({
        itemId: ei === 0 ? "dagger" : "long_sword",
        identified: false,
        level,
        rarity: ["normal", "fine", "rare", "legendary"][ri],
        options: want,
        uniqueId: null,
        cursed,
        foundIn: "d01",
      });
      return;
    }
    throw new Error("no seed with 2+ options");
  });

  test("IT-52 ユニーク: Lv の randInt を引かない（weightedIndex(entries) → weightedIndex(rarities) → chance(curse) → オプション）。itemId はベース、level 0、段階は optionTier", () => {
    const d = lootData({ rarity: "fine" });
    const s = dived(3);
    const m = cloneRng(s.rng);
    weightedIndex(m, [1]);
    weightedIndex(m, ONLY.fine);
    chance(m, 0);
    const k = weightedIndex(m, OPTION_WEIGHTS);
    const o = poolOf("weapon")[k]!;
    // 二枚舌の短剣: ベース dagger、optionTier 1
    const spec = rollItemSpec(s, d, [{ unique: "twin_tongue_dagger", weight: 1 }], 9, 0, "d01");
    expect(s.rng).toEqual(m);
    expect(spec).toEqual({
      itemId: "dagger",
      identified: false,
      level: 0,
      rarity: "fine",
      options: [{ optionId: o.id, tier: 1, value: o.values[0] }],
      uniqueId: "twin_tongue_dagger",
      cursed: false,
      foundIn: "d01",
    });
    // 影法師の剣は optionTier 2（ドロップの Lv に関係なく固定）
    const sp2 = rollItemSpec(dived(3), d, [{ unique: "shadowfolk_sword", weight: 1 }], 1, 0, "d01");
    expect(sp2.options!.map((x) => x.tier)).toEqual([2]);
  });

  test("IT-51 rolls 回とも独立に chance(itemChance)。外れた回はそれ以上引かない。表 d02_boss（100% × 2 回）で 2 品", () => {
    const d = lootData({ spread: 0 });
    const t = d.drops.tables.find((x) => x.id === "d01_f1")!;
    t.itemChance = 0;
    t.rolls = 3;
    const ctx = makeContext(cloneState(dived(1)), d);
    const m = cloneRng(ctx.state.rng);
    chance(m, 0);
    chance(m, 0);
    chance(m, 0);
    rollDropTable(ctx, "d01_f1", 3, 0, "d01");
    expect(ctx.state.rng).toEqual(m);
    expect(ctx.events).toEqual([]);
    const ctx2 = makeContext(cloneState(dived(1)), d);
    rollDropTable(ctx2, "d02_boss", 4, 0, "d02");
    expect(ctx2.events.filter((e) => e.kind === "message" && e.key === "item.found")).toHaveLength(2);
    expect(ctx2.state.dive!.ledger.items).toHaveLength(2);
    expectKnownStringKeys(ctx2.events, d);
  });
});

describe("IT-53 ドロップの Lv", () => {
  test("IT-53 汎用の Lv = 敵の Lv + randInt(−spread, +spread)、最低 1。振れ幅 0 なら敵の Lv のまま（randInt(0, 0) は 1 回消費する）", () => {
    const d = lootData({ spread: 0 });
    for (const lv of [1, 4, 7]) {
      const s = dived(2);
      expect(rollItemSpec(s, d, SWORD, lv, 0, "d01").level).toBe(lv);
    }
    // 振れ幅 1 で敵の Lv 1: 出目 −1 でも 1（最低 1）。出目ごとの Lv を鏡で数える
    const seen = new Set<number>();
    for (let seed = 1; seed < 60; seed++) {
      const s = dived(seed);
      const m = cloneRng(s.rng);
      weightedIndex(m, [1]);
      const delta = randInt(m, -1, 1);
      const got = rollItemSpec(s, lootData(), SWORD, 1, 0, "d01").level;
      expect(got).toBe(delta === -1 ? 1 : 1 + delta);
      seen.add(delta);
    }
    expect([...seen].sort()).toEqual([-1, 0, 1]);
  });
});

describe("IT-30〜33 希少度・chestQuality・呪い・オプション", () => {
  test("IT-30 オプションの個数は 通常 0 / 上質 1 / 希少 2 / 伝説 3。同じ実体の中で重複しない", () => {
    const counts = (["normal", "fine", "rare", "legendary"] as const).map((r) => {
      const spec = rollItemSpec(dived(5), lootData({ rarity: r }), SWORD, 3, 0, "d01");
      expect(spec.rarity).toBe(r);
      const ids = spec.options!.map((o) => o.optionId);
      expect(new Set(ids).size).toBe(ids.length);
      return ids.length;
    });
    expect(counts).toEqual([0, 1, 2, 3]);
  });

  test("IT-31 quality は引いた希少度を段数だけ上げ、伝説で止める（乱数なし）", () => {
    expect(rollItemSpec(dived(5), lootData({ rarity: "normal" }), SWORD, 3, 1, "d01").rarity).toBe("fine");
    expect(rollItemSpec(dived(5), lootData({ rarity: "fine" }), SWORD, 3, 2, "d01").rarity).toBe("legendary");
    expect(rollItemSpec(dived(5), lootData({ rarity: "legendary" }), SWORD, 3, 1, "d01").rarity).toBe("legendary");
    // 乱数の消費は quality に依存しない（上げた先の個数のオプションを引く分だけ違う: 通常+1 → 上質で 1 個）
    const a = dived(5);
    const m = cloneRng(a.rng);
    weightedIndex(m, [1]);
    randInt(m, -1, 1);
    weightedIndex(m, ONLY.normal);
    chance(m, 0);
    weightedIndex(m, OPTION_WEIGHTS);
    rollItemSpec(a, lootData({ rarity: "normal" }), SWORD, 3, 1, "d01");
    expect(a.rng).toEqual(m);
  });

  test("IT-56 宝箱の危険度の上振れ: 希少度を引いた直後に chance(危険度 × rarityUpPerDanger) を 1 回（当たれば 1 段）。危険度 0 では振らない（鏡の rng）", () => {
    expect(data.config.chest.rarityUpPerDanger).toBe(15);
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const a = dived(seed);
      const m = cloneRng(a.rng);
      weightedIndex(m, [1]);
      randInt(m, -1, 1);
      weightedIndex(m, ONLY.normal);
      const up = chance(m, 30); // 危険度 2 × 15
      chance(m, 0);
      if (up) weightedIndex(m, OPTION_WEIGHTS);
      const spec = rollItemSpec(a, lootData({ rarity: "normal" }), SWORD, 3, 0, "d01", 2);
      expect(spec.rarity, `seed ${seed}`).toBe(up ? "fine" : "normal");
      expect(a.rng, `seed ${seed}`).toEqual(m);
      seen.add(String(spec.rarity));
    }
    expect([...seen].sort()).toEqual(["fine", "normal"]);
    // 危険度 0（罠なし・ボスの品）は chance を振らない（引数を省いたときと同じ乱数）
    const b = dived(5);
    const c = dived(5);
    rollItemSpec(b, lootData({ rarity: "normal" }), SWORD, 3, 0, "d01", 0);
    rollItemSpec(c, lootData({ rarity: "normal" }), SWORD, 3, 0, "d01");
    expect(b.rng).toEqual(c.rng);
  });

  test("IT-56 上振れの上に chestQuality を足し、伝説で止める。魔法書の項目では振らない", () => {
    // 危険度 4（60%）が当たるシードと外れるシードで、上質 + quality 1 は 当たり → 伝説、外れ → 希少
    let hit = false;
    let miss = false;
    for (let seed = 1; seed <= 40 && !(hit && miss); seed++) {
      const a = dived(seed);
      const m = cloneRng(a.rng);
      weightedIndex(m, [1]);
      randInt(m, -1, 1);
      weightedIndex(m, ONLY.fine);
      const up = chance(m, 60);
      const spec = rollItemSpec(a, lootData({ rarity: "fine" }), SWORD, 3, 1, "d01", 4);
      expect(spec.rarity, `seed ${seed}`).toBe(up ? "legendary" : "rare");
      if (up) hit = true;
      else miss = true;
    }
    expect([hit, miss]).toEqual([true, true]);
    // 伝説はそれ以上上がらない
    expect(rollItemSpec(dived(5), lootData({ rarity: "legendary" }), SWORD, 3, 1, "d01", 4).rarity).toBe("legendary");
    // 魔法書（IT-55）: weightedIndex(entries) の後に何も引かない
    const book = dived(5);
    const mb = cloneRng(book.rng);
    weightedIndex(mb, [1]);
    expect(rollItemSpec(book, data, [{ item: "tome_lightning", weight: 1 }], 3, 0, "d02", 4).rarity).toBe("normal");
    expect(book.rng).toEqual(mb);
  });

  test("IT-31 partyChestQuality は行動可能な味方の benefits.chestQuality の最大（強欲 1）。強欲が行動不能・死亡なら 0。リーダーは 0", () => {
    const s = dived(1);
    expect(member(s, "c4").personality).toBe("greedy");
    expect(partyChestQuality(s, data)).toBe(1);
    const para = cloneState(s);
    member(para, "c4").status = ["paralysis"];
    expect(partyChestQuality(para, data)).toBe(0);
    const dead = cloneState(s);
    member(dead, "c4").life = "dead";
    member(dead, "c4").hp = 0;
    expect(partyChestQuality(dead, data)).toBe(0);
    // 合計しない: 強欲が 2 人でも 1
    const two = cloneState(s);
    member(two, "c5").personality = "greedy";
    expect(partyChestQuality(two, data)).toBe(1);
  });

  test("IT-32 呪われた品は個数 +1 で、最後に引いた 1 つだけ値が負。通常なら負のオプション 1 つだけ", () => {
    const n = rollItemSpec(dived(7), lootData({ rarity: "normal", curse: 100 }), SWORD, 3, 0, "d01");
    expect(n.cursed).toBe(true);
    expect(n.options).toHaveLength(1);
    expect(n.options![0]!.value).toBeLessThan(0);
    const r = rollItemSpec(dived(7), lootData({ rarity: "legendary", curse: 100 }), SWORD, 3, 0, "d01");
    expect(r.options).toHaveLength(4);
    expect(r.options!.map((o) => Math.sign(o.value))).toEqual([1, 1, 1, -1]);
    expect(new Set(r.options!.map((o) => o.optionId)).size).toBe(4);
    // 呪い 0% では負にならない
    const c = rollItemSpec(dived(7), lootData({ rarity: "legendary", curse: 0 }), SWORD, 3, 0, "d01");
    expect(c.cursed).toBe(false);
    expect(c.options!.every((o) => o.value > 0)).toBe(true);
  });

  test("IT-33 汎用の段階 = min(3, 1 + floor(Lv ÷ 4))（Lv0〜3 は 1、4〜7 は 2、8 以上は 3）。値は values[段階 − 1]", () => {
    expect([0, 3, 4, 7, 8, 20].map((lv) => genericOptionTier(lv, data))).toEqual([1, 1, 2, 2, 3, 3]);
    // Lv 8（振れ幅 0）の上質の長剣: 段階 3 の値
    const spec = rollItemSpec(dived(4), lootData({ rarity: "fine", spread: 0 }), SWORD, 8, 0, "d01");
    const o = data.itemOptions.options.find((x) => x.id === spec.options![0]!.optionId)!;
    expect(spec.options).toEqual([{ optionId: o.id, tier: 3, value: o.values[2] }]);
  });

  test("IT-36/IT-33 剣・弓・鎧・盾・兜・小手のドロップには魔法攻撃力（magic_power）が付かない（伝説 + 呪いで 4 個 × 60 シード）", () => {
    const d = lootData({ rarity: "legendary", curse: 100 });
    for (const base of ["long_sword", "short_bow", "leather_armor", "wooden_shield", "leather_cap", "leather_gloves"]) {
      for (let seed = 1; seed <= 60; seed++) {
        const spec = rollItemSpec(dived(seed), d, [{ base, weight: 1 }], 3, 0, "d01");
        expect(spec.options).toHaveLength(4);
        expect(spec.options!.map((o) => o.optionId)).not.toContain("magic_power");
      }
    }
  });

  test("IT-36/IT-52 杖と護符の母集団は magic_power を含む 22 件（重み 76）。鏡の rng で出目と optionId を数え、magic_power が付くシードがある", () => {
    expect(poolOf("caster").map((x) => x.id)).toEqual(poolOf("accessory").map((x) => x.id));
    expect(poolOf("caster")).toHaveLength(22);
    expect(poolOf("caster").reduce((a, x) => a + x.weight, 0)).toBe(76);
    expect(OPTION_WEIGHTS.reduce((a, x) => a + x, 0)).toBe(72);
    const d = lootData({ rarity: "rare", spread: 0 });
    for (const [base, kind] of [
      ["staff", "caster"],
      ["charm", "accessory"],
    ] as const) {
      let found = 0;
      for (let seed = 1; seed <= 40; seed++) {
        const s = dived(seed);
        const m = cloneRng(s.rng);
        weightedIndex(m, [1]);
        randInt(m, 0, 0);
        weightedIndex(m, ONLY.rare);
        chance(m, 0);
        const pool = poolOf(kind);
        const want: string[] = [];
        for (let i = 0; i < 2; i++) want.push(pool.splice(weightedIndex(m, pool.map((x) => x.weight)), 1)[0]!.id);
        const spec = rollItemSpec(s, d, [{ base, weight: 1 }], 5, 0, "d01");
        expect(s.rng).toEqual(m);
        expect(spec.options!.map((o) => o.optionId)).toEqual(want);
        const mp = spec.options!.find((o) => o.optionId === "magic_power");
        if (mp !== undefined) {
          found++;
          expect(mp).toEqual({ optionId: "magic_power", tier: 2, value: 2 }); // Lv5 は段階 2 で値 2
        }
      }
      expect(found).toBeGreaterThan(0);
    }
  });

  test("IT-36 ユニークはベースの品種で絞る: 夜明けの火打ち杖（staff）と凪の護符（charm）は magic_power を引けるが、二枚舌の短剣（dagger）の母集団には無い", () => {
    // magic_power 以外の重みを 0 にすると、杖・護符は必ず magic_power を引き、短剣は母集団の重みが 0 で引けない
    const d = lootData({
      rarity: "fine",
      mut: (x) => x.itemOptions.options.forEach((o) => (o.weight = o.id === "magic_power" ? 1 : 0)),
    });
    for (const unique of ["dawn_flint_staff", "calm_sea_charm"]) {
      const spec = rollItemSpec(dived(2), d, [{ unique, weight: 1 }], 1, 0, "d01");
      expect(spec.options!.map((o) => o.optionId)).toEqual(["magic_power"]);
    }
    expect(() => rollItemSpec(dived(2), d, [{ unique: "twin_tongue_dagger", weight: 1 }], 1, 0, "d01")).toThrow("total weight is 0");
  });

  test("IT-52 引く乱数の回数は品種で変わらない: 同じシードで長剣と護符（希少 + 呪い = 3 個）を作ると rng が同じところまで進む", () => {
    const d = lootData({ rarity: "rare", curse: 100 });
    for (let seed = 1; seed <= 10; seed++) {
      const a = dived(seed);
      const b = dived(seed);
      rollItemSpec(a, d, SWORD, 3, 0, "d01");
      rollItemSpec(b, d, [{ base: "charm", weight: 1 }], 3, 0, "d01");
      expect(a.rng).toEqual(b.rng);
    }
  });
});

describe("IT-54 配る・置いていく", () => {
  test("IT-54 並び順に最初に所持枠が空いている者（life を問わない）の inventory の末尾と台帳に入れ、未鑑定の表示名で item.found", () => {
    const s = dived(1);
    // c1 の所持枠を埋める（8 枠）。c2 は死亡していても受け取る
    const c1 = member(s, "c1");
    const used = Object.values(c1.equipment).filter((x) => x !== null).length + c1.inventory.length;
    for (let i = used; i < data.config.inventory.slotsPerCharacter; i++) c1.inventory.push(createItemInstance(s, { itemId: "herb", identified: true }));
    member(s, "c2").life = "dead";
    member(s, "c2").hp = 0;
    const ctx = makeContext(cloneState(s), data);
    const seq = ctx.state.nextItemSeq;
    expect(placeFoundItem(ctx, { itemId: "long_sword", identified: false, level: 3, rarity: "rare", foundIn: "d01" })).toBe(true);
    const id = `i${seq}`;
    expect(member(ctx.state, "c2").inventory.at(-1)).toBe(id);
    expect(ctx.state.dive!.ledger.items).toEqual([id]);
    expect(ctx.state.items[id]).toMatchObject({ itemId: "long_sword", identified: false, level: 3, rarity: "rare", foundIn: "d01" });
    // 未鑑定は unidentifiedName だけ（IT-12）
    expect(ctx.events).toEqual([{ kind: "message", key: "item.found", params: { name: member(s, "c2").name, item: "剣？" } }]);
    expectStateInvariants(ctx.state);
  });

  test("IT-54 誰も空いていなければ実体を作らず（nextItemSeq も進めない）item.leftBehind{item}。乱数は品を引いた分だけ消費したまま", () => {
    const s = dived(1);
    for (const ch of s.party) {
      const used = Object.values(ch.equipment).filter((x) => x !== null).length + ch.inventory.length;
      for (let i = used; i < data.config.inventory.slotsPerCharacter; i++) ch.inventory.push(createItemInstance(s, { itemId: "herb", identified: true }));
    }
    const d = lootData({ rarity: "normal", spread: 0, mut: (x) => (x.drops.tables.find((t) => t.id === "d01_f1")!.entries = SWORD) });
    d.drops.tables.find((t) => t.id === "d01_f1")!.itemChance = 100;
    const ctx = makeContext(cloneState(s), d);
    const seq = ctx.state.nextItemSeq;
    const m = cloneRng(ctx.state.rng);
    chance(m, 100);
    weightedIndex(m, [1]);
    randInt(m, 0, 0);
    weightedIndex(m, ONLY.normal);
    chance(m, 0);
    rollDropTable(ctx, "d01_f1", 2, 0, "d01");
    expect(ctx.state.rng).toEqual(m);
    expect(ctx.events).toEqual([{ kind: "message", key: "item.leftBehind", params: { item: "剣？" } }]);
    expect(ctx.state.nextItemSeq).toBe(seq);
    expect(Object.keys(ctx.state.items)).toEqual(Object.keys(s.items));
    expect(ctx.state.dive!.ledger.items).toEqual([]);
    expectStateInvariants(ctx.state);
  });
});

describe("IT-55 ドロップ表の魔法書の項目（M9）", () => {
  test("IT-55 魔法書の項目: chance → weightedIndex(entries) だけを引き（Lv・希少度・呪い・オプションの乱数を引かない）、Lv0・通常・オプションなし・呪いなし・鑑定済みで入る", () => {
    // 実データの希少度の重みと呪い 8% のまま（引かないことを鏡で確かめる）
    const d = loadFreshData();
    const t = d.drops.tables.find((x) => x.id === "d01_f1")!;
    t.itemChance = 100;
    t.rolls = 1;
    t.entries = [
      { base: "dagger", weight: 1 },
      { item: "tome_lightning", weight: 3 },
    ];
    for (let seed = 1; seed < 40; seed++) {
      const ctx = makeContext(cloneState(dived(seed)), d);
      const m = cloneRng(ctx.state.rng);
      chance(m, 100);
      if (weightedIndex(m, [1, 3]) !== 1) continue;
      const seq = ctx.state.nextItemSeq;
      rollDropTable(ctx, "d01_f1", 5, 1, "d01");
      expect(ctx.state.rng).toEqual(m);
      const id = `i${seq}`;
      expect(ctx.state.items[id]).toEqual({
        id,
        itemId: "tome_lightning",
        level: 0,
        rarity: "normal",
        options: [],
        uniqueId: null,
        identified: true,
        cursed: false,
        foundIn: "d01",
      });
      expect(ctx.state.dive!.ledger.items).toEqual([id]);
      // 鑑定済みなので語りは品の名前
      expect(ctx.events).toEqual([{ kind: "message", key: "item.found", params: { name: ctx.state.party[0]!.name, item: "雷光の魔法書" } }]);
      expectStateInvariants(ctx.state);
      return;
    }
    throw new Error("no seed that draws the book");
  });

  test("IT-54/IT-55 置いていくときの item.leftBehind の item は魔法書の名前（ベースの unidentifiedName ではない）", () => {
    const s = dived(1);
    for (const ch of s.party) {
      const used = Object.values(ch.equipment).filter((x) => x !== null).length + ch.inventory.length;
      for (let i = used; i < data.config.inventory.slotsPerCharacter; i++) ch.inventory.push(createItemInstance(s, { itemId: "herb", identified: true }));
    }
    const ctx = makeContext(cloneState(s), data);
    const seq = ctx.state.nextItemSeq;
    expect(placeFoundItem(ctx, rollItemSpec(ctx.state, data, [{ item: "tome_lightning", weight: 1 }], 3, 0, "d02"))).toBe(false);
    expect(ctx.events).toEqual([{ kind: "message", key: "item.leftBehind", params: { item: "雷光の魔法書" } }]);
    expect(ctx.state.nextItemSeq).toBe(seq);
  });
});

describe("CB-52 宝箱の品（IT-50 / IT-31 / IT-53）", () => {
  /** 部屋のランダム遭遇で、HP 1・麻痺の敵をアルドが必中で倒す戦闘 */
  function roomWin(groups: { monsterId: string }[], patch?: (s: GameState) => void): GameState {
    const base = dived(1);
    patch?.(base);
    const inputs = allInputs(base, DEF);
    inputs["c1"] = { type: "attack", group: 0 };
    // 2 つ目以降のグループは HP 0 の個体だけ（倒した種類として数える。勝利の判定は生きている個体が無いこと）
    return withBattle(
      base,
      groups.map((g, i) => ({ monsterId: g.monsterId, hps: [i === 0 ? 1 : 0], status: [["paralysis"]] })),
      { origin: { kind: "random", inRoom: true }, inputs, identified: groups.map((g) => g.monsterId) },
    );
  }
  const chestData = (rarity: keyof typeof ONLY) =>
    dataWith({ combat: { ...ALWAYS_HIT, chestChance: 100 } }, (d) => {
      d.config.items.rarities.forEach((r, i) => (r.weight = ONLY[rarity][i]!));
      d.config.items.curseChance = 0;
      d.config.items.dropLevelSpread = 0;
      d.config.chest.noTrapChance = 100; // M11: 罠なし（危険度 0 なので IT-56 の上振れも振らない）
      for (const t of d.drops.tables) {
        t.itemChance = 100;
        t.entries = SWORD;
      }
    });
  /** M11（CB-60 / CB-65）: 勝って箱を置き、chest.open で中身を得る。2 つの execute の events をつなげたもの */
  const winOpen = (s: GameState, d: GameData) => {
    const w = exec(s, RESOLVE, d);
    if (w.state.dive!.chest === null) return w;
    const o = exec(w.state, { type: "chest.open" }, d);
    return { state: o.state, events: [...w.events, ...o.events] };
  };

  test("CB-65/IT-13 宝箱を開けると金の後に、その階の表から品（未鑑定・foundIn 迷宮・台帳）。Lv は倒した種類の level の最大（IT-53）。強欲が行動可能なら希少度 +1", () => {
    // 腐乱死体 level 2・大鼠 level 1 → Lv 2（振れ幅 0）。強欲のドナ（c4）が行動可能 → 通常 + 1 = 上質
    const s = roomWin([{ monsterId: "giant_rat" }, { monsterId: "rotting_corpse" }]);
    const r = winOpen(s, chestData("normal"));
    const ks = kindsOf(r.events);
    const iChest = ks.indexOf("message:chest.open.gold");
    const iFound = ks.indexOf("message:item.found");
    expect(iChest).toBeGreaterThan(-1);
    expect(iFound).toBeGreaterThan(iChest);
    const id = r.state.dive!.ledger.items[0]!;
    expect(r.state.items[id]).toMatchObject({ itemId: "long_sword", level: 2, rarity: "fine", identified: false, foundIn: "d01", uniqueId: null });
    expect(r.state.items[id]!.options).toHaveLength(1);
    expect(r.state.party[0]!.inventory.at(-1)).toBe(id);
    expectStateInvariants(r.state);
    // 強欲が麻痺なら上げない（通常・オプションなし）
    const p = winOpen(roomWin([{ monsterId: "rotting_corpse" }], (b) => (member(b, "c4").status = ["paralysis"])), chestData("normal"));
    const pid = p.state.dive!.ledger.items[0]!;
    expect(p.state.items[pid]).toMatchObject({ level: 2, rarity: "normal", options: [] });
  });

  test("CB-51/CB-65 通路の遭遇の宝箱は chestChanceCorridor で判定し、出れば部屋と同じく開けると金の後に品。0 なら宝箱も品も出ない", () => {
    const base = dived(1);
    const inputs = allInputs(base, DEF);
    inputs["c1"] = { type: "attack", group: 0 };
    const s = withBattle(base, [{ monsterId: "rotting_corpse", hps: [1], status: [["paralysis"]] }], {
      origin: { kind: "random", inRoom: false },
      inputs,
      identified: ["rotting_corpse"],
    });
    const corridor = (pct: number) => {
      const d = chestData("normal");
      d.config.combat.chestChanceCorridor = pct;
      return d;
    };
    const r0 = winOpen(s, corridor(0));
    expect(kindsOf(r0.events)).not.toContain("chestFound");
    expect(kindsOf(r0.events)).not.toContain("message:chest.open.gold");
    expect(kindsOf(r0.events)).not.toContain("message:item.found");
    expect(r0.state.dive!.ledger.items).toEqual([]);
    const r = winOpen(s, corridor(100));
    const ks = kindsOf(r.events);
    expect(ks.indexOf("message:chest.open.gold")).toBeGreaterThan(-1);
    expect(ks.indexOf("message:item.found")).toBeGreaterThan(ks.indexOf("message:chest.open.gold"));
    const id = r.state.dive!.ledger.items[0]!;
    expect(r.state.items[id]).toMatchObject({ itemId: "long_sword", level: 2, identified: false, foundIn: "d01" });
    expectStateInvariants(r.state);
  });
});
