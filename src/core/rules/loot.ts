// ドロップ（items.md IT-50〜54。M7 の B5）: 宝箱（CB-52）とボスの戦利品（DG-31）の品を drops.json の表から引き、
// 希少度（IT-30）・chestQuality（IT-31）・呪い（IT-32）・オプション（IT-33）を決めて、所持枠の空いている者に配る（IT-54）。
// 純粋（乱数は state.rng だけ）。combat.ts の勝利の処理から呼ぶ。
//
// 乱数の消費順（1 品。IT-52）: chance(itemChance) →（当たれば）weightedIndex(entries) →（汎用なら）weightedIndex(dropLevelUpWeights)（IT-53。M14）
//   → weightedIndex(rarities) →（宝箱の危険度が正なら）chance(危険度 × rarityUpPerDanger)（IT-56。M11）
//   →（宝箱の chestQuality が正なら）chance(chestQuality)（IT-31。M14）→ chance(curseChance) → オプションの個数だけ weightedIndex(残りのオプションの weight)。
//   オプションの母集団はその品の品種に付けられるもの（IT-36）で、引く回数は品種に依存しない。
//   外れならその品はそこで終わり。表の rolls 回くり返す。置いていく品（IT-54）も乱数は同じだけ消費する。
//   魔法書の項目（IT-55）は weightedIndex(entries) で終わる。
import type { DropEntry, GameData } from "../data/index";
import { optionAppliesTo, optionKindOf } from "../data/index";
import { chance, weightedIndex } from "../rng";
import type { ItemInstanceSpec } from "../state";
import { baseOf, createItemInstance, dropTableOf, dungeonOf, findBase, itemDisplayName, itemOf, personalityOf, uniqueOf, slotsUsed } from "../state";
import type { GameState, ItemOptionRoll, RuleContext } from "../types";
import { canAct } from "./combat-calc";

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
 * IT-52 / IT-53 / IT-30〜33: entries から 1 品の中身を引く（chance(itemChance) は呼び出し側）。未鑑定（IT-13）。
 * 汎用は Lv = levelBase（dropLevelBase の値）+ weightedIndex(dropLevelUpWeights)（M14。乱数 1 回）、ユニークは Lv0 で段階は optionTier。
 * 魔法書（IT-55）は weightedIndex(entries) の後に乱数を引かず、鑑定済みの Lv0・通常で返す。
 * 希少度は重みで引いた直後に、danger > 0 なら chance(danger × chest.rarityUpPerDanger) で 1 段上げ（IT-56。M11。danger 0 では振らない）、
 * さらに quality > 0 なら chance(quality) を 1 回振って当たれば 1 段上げ（IT-31。M14。quality 0 では振らない）、伝説で止める。呪われたら個数 +1 で、最後の 1 つの値を負にする。
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
  const rIdx = Math.min(cfg.rarities.length - 1, drawn + up + greed);
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

/** IT-51 / IT-52: 表の rolls 回だけ、itemChance % で 1 品を引いて配る（rolls 回とも独立）。levelBase は dropLevelBase の値（IT-53）。danger は宝箱の危険度（IT-56。宝箱以外は 0） */
export function rollDropTable(ctx: RuleContext, tableId: string, levelBase: number, quality: number, foundIn: string, danger = 0): void {
  const { state, data } = ctx;
  const t = dropTableOf(data, tableId);
  for (let i = 0; i < t.rolls; i++) {
    if (!chance(state.rng, t.itemChance)) continue;
    placeFoundItem(ctx, rollItemSpec(state, data, t.entries, levelBase, quality, foundIn, danger));
  }
}

/**
 * CB-65 / IT-50: 宝箱の品。表は drops.chest[dungeonId][floor]、Lv の基準は max(箱の level（敵の Lv）, その階の基準 Lv)（IT-53 / DG-38。M14）、
 * quality は IT-31、danger は見つけた時点の危険度（IT-56）
 */
export function rollChestItems(ctx: RuleContext, dungeonId: string, floor: number, enemyLevel: number, danger: number): void {
  const tableId = ctx.data.drops.chest[dungeonId]?.[String(floor)];
  if (tableId === undefined) throw new Error(`no chest drop table: ${dungeonId} / ${floor}`);
  const base = dropLevelBase(ctx.data, dungeonId, floor, enemyLevel);
  rollDropTable(ctx, tableId, base, partyChestQuality(ctx.state, ctx.data), dungeonId, danger);
}

/** DG-31 / IT-50: ボスの戦利品。表は drops.boss[dungeonId]、Lv の基準は max(ボスの level, 最下層の基準 Lv)（IT-53 / DG-38。M14）、chestQuality は効かない（IT-31） */
export function rollBossItems(ctx: RuleContext, dungeonId: string, bossLevel: number): void {
  const tableId = ctx.data.drops.boss[dungeonId];
  if (tableId === undefined) throw new Error(`no boss drop table: ${dungeonId}`);
  const base = dropLevelBase(ctx.data, dungeonId, dungeonOf(ctx.data, dungeonId).floors, bossLevel);
  rollDropTable(ctx, tableId, base, 0, dungeonId);
}
