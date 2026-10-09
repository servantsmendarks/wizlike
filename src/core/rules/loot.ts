// ドロップ（items.md IT-50〜54・IT-57。M7 の B5）: 宝箱（CB-52）・ボスの戦利品（DG-31）・敵の直接ドロップ（CB-57。M14）の品を drops.json の表から引き、
// 希少度（IT-30）・chestQuality（IT-31）・呪い（IT-32）・オプション（IT-33）を決めて、所持枠の空いている者に配る（IT-54）。
// 純粋（乱数は state.rng だけ）。combat.ts の勝利の処理から呼ぶ。
//
// 個数（IT-51）: 宝箱は 1 個 + chance(min(100, secondItemChance + secondItemPerDanger × 危険度)) で 2 個目（CB-65。M14。chance は 100 でも 1 回引く）。
//   ボスの表は rolls 回 × chance(itemChance)（外れならその回は品なし）。
// 乱数の消費順（1 品。IT-52）: weightedIndex(entries) →（汎用なら）weightedIndex(dropLevelUpWeights)（IT-53。M14）
//   → weightedIndex(rarities) →（宝箱の危険度が正なら）chance(危険度 × rarityUpPerDanger)（IT-56。M11）
//   →（宝箱の chestQuality が正なら）chance(chestQuality)（IT-31。M14）→ 上限で止める（乱数なし）→ chance(curseChance) → オプションの個数だけ weightedIndex(残りのオプションの weight)。
//   上限（IT-56。M15）: 危険度が items.legendaryMinDanger 以上なら伝説、それ未満（直接ドロップは危険度 0）なら希少。
//   ボスの戦利品は危険度 legendaryMinDanger の箱として振る（M15。M14 までは危険度 0 で上振れの chance を引かなかった）。
//   オプションの母集団はその品の品種に付けられるもの（IT-36）で、引く回数は品種に依存しない。
//   置いていく品（IT-54）も乱数は同じだけ消費する。
//   魔法書の項目（IT-55）は weightedIndex(entries) で終わる。
import type { DropCategory, DropEntry, GameData } from "../data/index";
import { optionAppliesTo, optionKindOf } from "../data/index";
import { chance, randInt, rollDice, weightedIndex } from "../rng";
import type { ItemInstanceSpec } from "../state";
import { baseOf, createItemInstance, dropTableOf, dungeonOf, findBase, itemDisplayName, itemOf, monsterOf, personalityOf, uniqueOf, slotsUsed } from "../state";
import type { GameState, ItemOptionRoll, RuleContext } from "../types";
import { canAct, groupName } from "./combat-calc";
import { gainGold } from "./field";

/** IT-33: 汎用装備のオプションの段階 = min(3, 1 + floor(Lv ÷ optionTierStep)) */
export function genericOptionTier(level: number, data: GameData): 1 | 2 | 3 {
  return Math.min(3, 1 + Math.floor(level / data.config.items.optionTierStep)) as 1 | 2 | 3;
}

/** IT-31: 行動可能（CH-44）な味方の性格の benefits.chestQuality（希少度を 1 段上げる確率 %。M14）の最大（合計しない。リーダー・該当なしは 0） */
export function partyChestQuality(state: GameState, data: GameData): number {
  let q = 0;
  for (const ch of state.party) {
    if (!canAct(ch)) continue;
    const p = personalityOf(data, ch.personality);
    if (p !== null) q = Math.max(q, p.benefits.chestQuality);
  }
  return q;
}

/**
 * IT-53 / DG-38（M14）: 品の Lv の基準 = max(落とした敵の Lv, その階の基準 Lv（dungeons[].floorLevels[floor − 1]）)。
 * 宝箱は (潜行の階, 箱の level)、ボスは (最下層 floors, ボスの level)、直接ドロップは (潜行の階, その種類の level) で呼ぶ。乱数は引かない
 */
export function dropLevelBase(data: GameData, dungeonId: string, floor: number, enemyLevel: number): number {
  const fl = dungeonOf(data, dungeonId).floorLevels[floor - 1];
  if (fl === undefined) throw new Error(`no floor level: ${dungeonId} / ${floor}`);
  return Math.max(enemyLevel, fl);
}

/**
 * IT-52 / IT-53 / IT-30〜33: entries から 1 品の中身を引く（個数の判定（宝箱の 2 個目の chance・ボスの表の chance(itemChance)）は呼び出し側）。未鑑定（IT-13）。
 * 汎用は Lv = levelBase（dropLevelBase の値）+ weightedIndex(dropLevelUpWeights)（M14。乱数 1 回）、ユニークは Lv0 で段階は optionTier。
 * 魔法書（IT-55）は weightedIndex(entries) の後に乱数を引かず、鑑定済みの Lv0・通常で返す。
 * 希少度は重みで引いた直後に、danger > 0 なら chance(danger × chest.rarityUpPerDanger) で 1 段上げ（IT-56。M11。danger 0 では振らない）、
 * さらに quality > 0 なら chance(quality) を 1 回振って当たれば 1 段上げ（IT-31。M14。quality 0 では振らない）、
 * danger >= items.legendaryMinDanger なら伝説で、それ未満なら希少で止める（IT-56。M15）。呪われたら個数 +1 で、最後の 1 つの値を負にする。
 */
export function rollItemSpec(
  state: GameState,
  data: GameData,
  entries: readonly DropEntry[],
  levelBase: number,
  quality: number,
  foundIn: string,
  danger = 0,
): ItemInstanceSpec {
  const cfg = data.config.items;
  const entry = entries[weightedIndex(state.rng, entries.map((e) => e.weight))]!;
  // IT-55（M9）: 魔法書の項目は Lv0・通常・オプションなし・呪いなし・鑑定済みで、以降の乱数を引かない
  if ("item" in entry)
    return { itemId: entry.item, identified: true, level: 0, rarity: "normal", options: [], uniqueId: null, cursed: false, foundIn };
  let itemId: string;
  let uniqueId: string | null = null;
  let level = 0;
  let tier: 1 | 2 | 3;
  if ("unique" in entry) {
    const u = uniqueOf(data, entry.unique);
    itemId = u.base;
    uniqueId = u.id;
    tier = u.optionTier;
  } else {
    itemId = baseOf(data, entry.base).id;
    // IT-53（M14）: 上乗せ 0..n−1 を重みで引く（M13 までは randInt(−spread, +spread) で最低 1）
    level = levelBase + weightedIndex(state.rng, cfg.dropLevelUpWeights);
    tier = genericOptionTier(level, data);
  }
  const drawn = weightedIndex(
    state.rng,
    cfg.rarities.map((r) => r.weight),
  );
  // IT-56（M11）: 宝箱の危険度の上振れ。危険度 0（罠なし・ボスの品）では chance を振らない（B2）
  const up = danger > 0 && chance(state.rng, danger * data.config.chest.rarityUpPerDanger) ? 1 : 0;
  // IT-31（M14）: 強欲の chestQuality は 1 段上げる確率（%）。0（宝箱以外・強欲なし）では chance を振らない
  const greed = quality > 0 && chance(state.rng, quality) ? 1 : 0;
  // IT-56（M15）: 伝説まで上がれるのは危険度 legendaryMinDanger 以上の箱（とその扱いで振るボスの戦利品）だけ。それ以外は希少で止める。
  // 上限は乱数を引かない（chance は上限に関係なく上で引いている）。基礎の重みで伝説を引いた場合も上限で希少に下がる
  // rarities は「最後が伝説、その一つ前が希少」の並びが前提（validate の IT-30 の検査が 4 件・順序固定を保証する）
  const maxIdx = danger >= cfg.legendaryMinDanger ? cfg.rarities.length - 1 : cfg.rarities.length - 2;
  const rIdx = Math.min(maxIdx, drawn + up + greed);
  const rarity = cfg.rarities[rIdx]!;
  const cursed = chance(state.rng, cfg.curseChance);
  const count = rarity.options + (cursed ? 1 : 0);
  // IT-33 / IT-36（M10）: 母集団はその品の品種（ユニークはベースの品種。itemId はベース）に付けられるオプションだけ
  const kind = optionKindOf(baseOf(data, itemId));
  const pool = data.itemOptions.options.filter((o) => optionAppliesTo(o, kind));
  const options: ItemOptionRoll[] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const k = weightedIndex(
      state.rng,
      pool.map((o) => o.weight),
    );
    const o = pool.splice(k, 1)[0]!;
    options.push({ optionId: o.id, tier, value: o.values[tier - 1]! });
  }
  if (cursed && options.length > 0) {
    const last = options[options.length - 1]!;
    last.value = -last.value;
  }
  return { itemId, identified: false, level, rarity: rarity.id, options, uniqueId, cursed, foundIn };
}

/**
 * IT-54: 並び順に最初に所持枠（CH-71）が空いている者（life を問わない）の inventory の末尾に実体を作って入れ、潜行台帳（DG-40）に入れる。
 * message item.found{name, item}（item は未鑑定の表示名）。誰も空いていなければ実体を作らず（nextItemSeq も進めない）
 * message item.leftBehind{item}（item はベースの unidentifiedName）。置けたら true
 */
export function placeFoundItem(ctx: RuleContext, spec: ItemInstanceSpec): boolean {
  const { state, data } = ctx;
  const ch = state.party.find((c) => slotsUsed(c) < data.config.inventory.slotsPerCharacter) ?? null;
  if (ch === null) {
    // 装備はベースの unidentifiedName、魔法書（IT-55。鑑定済みで生まれる）は items の name
    const base = findBase(data, spec.itemId);
    const item = base !== null ? base.unidentifiedName : itemOf(data, spec.itemId).name;
    ctx.events.push({ kind: "message", key: "item.leftBehind", params: { item } });
    return false;
  }
  const id = createItemInstance(state, spec);
  ch.inventory.push(id);
  if (state.dive !== null) state.dive.ledger.items.push(id);
  ctx.events.push({ kind: "message", key: "item.found", params: { name: ch.name, item: itemDisplayName(state, data, id) } });
  return true;
}

/**
 * IT-51 / IT-52: ボスの表を rolls 回だけ、itemChance % で 1 品を引いて配る（rolls 回とも独立）。levelBase は dropLevelBase の値（IT-53）。
 * quality（IT-31）は効かない（0）。危険度は items.legendaryMinDanger の箱として振る（IT-56。M15。上振れの chance を 1 回引き、伝説まで上がれる）。
 * 宝箱の表は rollChestItems（itemChance / rolls を持たない。M14）
 */
export function rollBossTable(ctx: RuleContext, tableId: string, levelBase: number, foundIn: string): void {
  const { state, data } = ctx;
  const t = dropTableOf(data, tableId);
  if (t.rolls === undefined || t.itemChance === undefined) throw new Error(`boss drop table needs itemChance / rolls: ${tableId}`);
  for (let i = 0; i < t.rolls; i++) {
    if (!chance(state.rng, t.itemChance)) continue;
    placeFoundItem(ctx, rollItemSpec(state, data, t.entries, levelBase, 0, foundIn, data.config.items.legendaryMinDanger));
  }
}

/** CB-65 / IT-51（M14）: 宝箱の品の個数 = 1 + (chance(min(100, secondItemChance + secondItemPerDanger × 危険度)) なら 1)。chance は必ず 1 回引く */
export function chestItemCount(state: GameState, data: GameData, danger: number): number {
  const cfg = data.config.chest;
  return 1 + (chance(state.rng, Math.min(100, cfg.secondItemChance + cfg.secondItemPerDanger * danger)) ? 1 : 0);
}

/**
 * CB-65 / IT-50 / IT-51: 宝箱の品。個数は chestItemCount（1 個 + 2 個目の chance。M14）、表は drops.chest[dungeonId][floor]、Lv の基準は max(箱の level（敵の Lv）, その階の基準 Lv)（IT-53 / DG-38。M14）、
 * quality は IT-31、danger は見つけた時点の危険度（IT-56）
 */
export function rollChestItems(ctx: RuleContext, dungeonId: string, floor: number, enemyLevel: number, danger: number): void {
  const tableId = ctx.data.drops.chest[dungeonId]?.[String(floor)];
  if (tableId === undefined) throw new Error(`no chest drop table: ${dungeonId} / ${floor}`);
  const { state, data } = ctx;
  const base = dropLevelBase(data, dungeonId, floor, enemyLevel);
  const quality = partyChestQuality(state, data);
  const entries = dropTableOf(data, tableId).entries;
  const n = chestItemCount(state, data, danger);
  for (let i = 0; i < n; i++) placeFoundItem(ctx, rollItemSpec(state, data, entries, base, quality, dungeonId, danger));
}

/** DG-31 / IT-50: ボスの戦利品。表は drops.boss[dungeonId]、Lv の基準は max(ボスの level, 最下層の基準 Lv)（IT-53 / DG-38。M14）、chestQuality は効かない（IT-31）、危険度は legendaryMinDanger 扱い（IT-56。M15） */
export function rollBossItems(ctx: RuleContext, dungeonId: string, bossLevel: number): void {
  const tableId = ctx.data.drops.boss[dungeonId];
  if (tableId === undefined) throw new Error(`no boss drop table: ${dungeonId}`);
  const base = dropLevelBase(ctx.data, dungeonId, dungeonOf(ctx.data, dungeonId).floors, bossLevel);
  rollBossTable(ctx, tableId, base, dungeonId);
}

/** CB-57 / IT-57（M14）: 種別 weapon / armor / accessory の部位（armor は胴・盾・兜・小手） */
const CATEGORY_SLOTS: Record<"weapon" | "armor" | "accessory", readonly string[]> = {
  weapon: ["weapon"],
  armor: ["armor", "shield", "helm", "gauntlet"],
  accessory: ["accessory"],
};

/**
 * CB-57 / IT-57（M14）: 直接ドロップの装備・魔法書の母集団 = その階の宝箱の表（drops.chest[dungeonId][floor]）の項目を種別で絞ったもの。
 * book は { item }（魔法書）、weapon / armor / accessory は { base } と { unique }（uniques[].base）のうち部位が合うもの
 */
export function directDropPool(data: GameData, dungeonId: string, floor: number, category: "weapon" | "armor" | "accessory" | "book"): DropEntry[] {
  const tableId = data.drops.chest[dungeonId]?.[String(floor)];
  if (tableId === undefined) throw new Error(`no chest drop table: ${dungeonId} / ${floor}`);
  const entries = dropTableOf(data, tableId).entries;
  if (category === "book") return entries.filter((e) => "item" in e);
  const slots = CATEGORY_SLOTS[category];
  return entries.filter((e) => {
    if ("item" in e) return false;
    const baseId = "unique" in e ? uniqueOf(data, e.unique).base : e.base;
    return slots.includes(baseOf(data, baseId).slot);
  });
}

/**
 * CB-57 / IT-57（M14）: 勝利の直接ドロップ。battle.gold の後・宝箱の判定とボスの戦利品の前に、b.groups の添字順に:
 * chance(combat.directDropChance)（グループごとに必ず 1 回）→（当たれば）種別 = direct.kinds[dropKind] から（長さ 2 以上のときだけ randInt(0, 長さ − 1)）→
 * gold: rollDice(directDropGoldDice)（0 未満にしない。正なら gainGold で battle.dropGold）/
 * consumable: weightedIndex(direct.consumables) → battle.drop → placeFoundItem（鑑定済み・Lv0・通常）/
 * book・weapon・armor・accessory: 母集団（directDropPool）が空なら何もしない（乱数も引かない）。あれば rollItemSpec（quality 0・danger 0。希少まで（IT-57。M15）、
 * Lv の基準は dropLevelBase(潜行の階, その種類の level)）→ battle.drop → placeFoundItem。name は groupName（鑑定済みなら名前、未鑑定なら系統）
 */
export function rollDirectDrops(ctx: RuleContext): void {
  const { state, data } = ctx;
  const b = state.battle;
  const dive = state.dive;
  if (b === null || dive === null) throw new Error("rollDirectDrops: no battle or dive");
  const cfg = data.config.combat;
  for (let g = 0; g < b.groups.length; g++) {
    if (!chance(state.rng, cfg.directDropChance)) continue;
    const m = monsterOf(data, b.groups[g]!.monsterId);
    const cats = data.drops.direct.kinds[m.dropKind];
    const cat: DropCategory = cats.length >= 2 ? cats[randInt(state.rng, 0, cats.length - 1)]! : cats[0]!;
    const name = groupName(state, data, g);
    if (cat === "gold") {
      const gold = Math.max(0, rollDice(state.rng, cfg.directDropGoldDice).total);
      if (gold > 0) gainGold(ctx, gold, { key: "battle.dropGold", params: { name, gold } }); // CH-52: 強欲の treasureGain もここ
      continue;
    }
    let spec: ItemInstanceSpec;
    if (cat === "consumable") {
      const list = data.drops.direct.consumables;
      const itemId = list[weightedIndex(state.rng, list.map((e) => e.weight))]!.item;
      spec = { itemId, identified: true, level: 0, rarity: "normal", options: [], uniqueId: null, cursed: false, foundIn: dive.dungeonId };
    } else {
      const pool = directDropPool(data, dive.dungeonId, dive.floor, cat);
      if (pool.length === 0) continue;
      const base = dropLevelBase(data, dive.dungeonId, dive.floor, m.level);
      spec = rollItemSpec(state, data, pool, base, 0, dive.dungeonId, 0);
    }
    ctx.events.push({ kind: "message", key: "battle.drop", params: { name } });
    placeFoundItem(ctx, spec);
  }
}
