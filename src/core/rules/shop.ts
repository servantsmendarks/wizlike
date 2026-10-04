// 店（TW-05、IT-60〜65）と流通レベルの更新（IT-62）。M7 の B7 で town.ts から切り出した（town.ts は townMenu のために shopMenu を import するだけ）。
// 値段の式（買値 IT-60・売値 IT-61・買い戻し IT-63・鑑定料 IT-65）は core のここだけに置く（表示層は shopMenu の値を描く。TW-27 の総資産も sellPrice）。
// 乱数は使わない。import してよいのは state と data（town.ts / combat.ts は import しない。combat.ts と town.ts から呼ばれる側）。
import type { ConsumableItem, EquipmentBase, GameData } from "../data/index";
import {
  createItemInstance,
  destroyItemInstance,
  equipmentDisplayName,
  findBase,
  identifyInstance,
  itemDisplayName,
  itemOf,
  memberById,
  slotsUsed,
  uniqueOf,
} from "../state";
import type { Character, GameState, ItemInstance, RuleContext, ShopAction, TownMenu } from "../types";
import { floorRatio } from "./ratio";

function inTown(state: GameState): boolean {
  return state.screen === "town" && state.dive === null;
}

/** CH-71: 空いている所持枠（slotsPerCharacter − 装備数 − inventory。負にはしない） */
export function slotsFreeOf(ch: Character, data: GameData): number {
  return Math.max(0, data.config.inventory.slotsPerCharacter - slotsUsed(ch));
}

// ---------------------------------------------------------------------------
// 値段（IT-60 / 61 / 63）

/** TW-05 の消耗品の売り物: items.json の順で、type consumable かつ infinite の品（在庫無限） */
function shopConsumables(data: GameData): ConsumableItem[] {
  return data.items.filter((it): it is ConsumableItem => it.type === "consumable" && it.infinite);
}

/** IT-62: 流通レベルで並ぶ汎用ベース（equipment-bases.json の順で shopMinLevel ≤ shopLevel） */
function shopBases(state: GameState, data: GameData): EquipmentBase[] {
  return data.equipmentBases.filter((b) => b.shopMinLevel <= state.progress.shopLevel);
}

/** IT-60: 汎用装備の買値 = floor(price × (1 + levelPriceRatio × Lv)) */
export function shopPrice(base: EquipmentBase, level: number, data: GameData): number {
  return floorRatio(base.price, 1 + data.config.items.levelPriceRatio * level);
}

/**
 * IT-61: 実体の売値（鑑定の有無・装備中かどうかは見ない。売れるかは checkShop が見る）。
 * - 汎用装備: floor(price × sellRatio × (1 + levelPriceRatio × Lv)) + 正のオプションごとに optionSellValue[tier − 1]（負は 0）
 * - ユニーク: floor(uniques[].price × sellRatio)（希少度・オプションに関わらず固定）
 * - 消耗品・魔法書: floor(price × sellRatio)
 */
export function sellPrice(inst: ItemInstance, data: GameData): number {
  const ratio = data.config.economy.sellRatio;
  const base = findBase(data, inst.itemId);
  if (base === null) return floorRatio(itemOf(data, inst.itemId).price, ratio);
  if (inst.uniqueId !== null) return floorRatio(uniqueOf(data, inst.uniqueId).price, ratio);
  let v = floorRatio(base.price, ratio * (1 + data.config.items.levelPriceRatio * inst.level));
  for (const o of inst.options) if (o.value > 0) v += data.config.items.optionSellValue[o.tier - 1] ?? 0;
  return v;
}

/** IT-63: 買い戻しの値段 = uniques[].price */
function buybackPrice(inst: ItemInstance, data: GameData): number {
  if (inst.uniqueId === null) throw new Error(`buybackPrice: ${inst.id} is not unique`);
  return uniqueOf(data, inst.uniqueId).price;
}

/** buy の売り物の値段と、作る実体の Lv。売っていなければ null */
function buyQuote(state: GameState, data: GameData, itemId: string): { price: number; level: number } | null {
  const c = shopConsumables(data).find((it) => it.id === itemId);
  if (c !== undefined) return { price: c.price, level: 0 };
  const b = shopBases(state, data).find((x) => x.id === itemId);
  if (b === undefined) return null;
  const level = state.progress.shopLevel;
  return { price: shopPrice(b, level, data), level };
}

// ---------------------------------------------------------------------------
// 受け付け（TW-05 の M7 の順）

/**
 * town.shop を受け付けない理由。順: wrong screen → bad action（オブジェクトでない・kind が buy / sell / buyback / identify でない・
 * buy の memberId / itemId、ほかの memberId / instanceId が文字列でない）→（kind ごとに）no such member → not alive（buy / buyback だけ）
 * → not for sale（buy）/ item not in inventory（sell / identify）/ not in stock（buyback）→ not identified（sell）/ already identified（identify）
 * → inventory full（buy / buyback）→ not enough gold（buy / buyback / identify）
 */
export function checkShop(state: GameState, action: unknown, data: GameData): string | null {
  if (!inTown(state)) return "wrong screen";
  if (typeof action !== "object" || action === null) return "bad action";
  const a = action as { kind?: unknown; memberId?: unknown; itemId?: unknown; instanceId?: unknown };
  if (a.kind !== "buy" && a.kind !== "sell" && a.kind !== "buyback" && a.kind !== "identify") return "bad action";
  if (typeof a.memberId !== "string") return "bad action";
  if (a.kind === "buy" ? typeof a.itemId !== "string" : typeof a.instanceId !== "string") return "bad action";
  const ch = memberById(state, a.memberId);
  if (ch === null) return "no such member";
  const gold = state.gold;
  switch (a.kind) {
    case "buy": {
      if (ch.life !== "alive") return "not alive";
      const q = buyQuote(state, data, a.itemId as string);
      if (q === null) return "not for sale";
      if (slotsFreeOf(ch, data) === 0) return "inventory full";
      if (gold < q.price) return "not enough gold";
      return null;
    }
    case "sell": {
      const inst = ownInventoryItem(state, ch, a.instanceId as string);
      if (inst === null) return "item not in inventory";
      if (!inst.identified) return "not identified";
      return null;
    }
    case "buyback": {
      if (ch.life !== "alive") return "not alive";
      const iid = a.instanceId as string;
      const inst = state.items[iid];
      if (!state.buyback.includes(iid) || inst === undefined) return "not in stock";
      if (slotsFreeOf(ch, data) === 0) return "inventory full";
      if (gold < buybackPrice(inst, data)) return "not enough gold";
      return null;
    }
    case "identify": {
      const inst = ownInventoryItem(state, ch, a.instanceId as string);
      if (inst === null) return "item not in inventory";
      if (inst.identified) return "already identified";
      if (gold < data.config.economy.identifyFee) return "not enough gold";
      return null;
    }
  }
}

/** 本人の inventory にある実体（装備中の品は inventory に無いので null） */
function ownInventoryItem(state: GameState, ch: Character, instanceId: string): ItemInstance | null {
  if (!ch.inventory.includes(instanceId)) return null;
  return state.items[instanceId] ?? null;
}

/** town.shop の処理。checkShop が null を返した前提 */
export function doShop(ctx: RuleContext, a: ShopAction): void {
  switch (a.kind) {
    case "buy":
      return buyItem(ctx, a.memberId, a.itemId);
    case "sell":
      return sellItem(ctx, a.memberId, a.instanceId);
    case "buyback":
      return buyBack(ctx, a.memberId, a.instanceId);
    case "identify":
      return identifyAtShop(ctx, a.memberId, a.instanceId);
  }
}

// ---------------------------------------------------------------------------
// 処理

/**
 * TW-05 / IT-62 の購入。乱数は使わない。
 * 払う → 鑑定済みの実体（消耗品は Lv0、汎用装備は Lv = shopLevel・通常・オプションなし・foundIn null）を作って本人の inventory の末尾へ
 * → message town.shop.bought{name, item（表示名）, cost}。潜行台帳（DG-40）には入れない（街では dive が null）
 */
export function buyItem(ctx: RuleContext, memberId: string, itemId: string): void {
  const { state, data } = ctx;
  const ch = memberById(state, memberId);
  const q = buyQuote(state, data, itemId);
  if (ch === null || q === null) throw new Error(`buyItem: bad ${memberId} / ${itemId}`);
  state.gold -= q.price;
  const id = createItemInstance(state, { itemId, level: q.level, identified: true });
  ch.inventory.push(id);
  ctx.events.push({
    kind: "message",
    key: "town.shop.bought",
    params: { name: ch.name, item: itemDisplayName(state, data, id), cost: q.price },
  });
}

/**
 * IT-61 / IT-63 の売却。乱数は使わない。
 * 本人の inventory から外す → ユニークなら buyback の末尾へ（実体はそのまま）、それ以外は実体を消す → 売値を受け取る
 * → message town.shop.sold{name, item, gold}
 */
export function sellItem(ctx: RuleContext, memberId: string, instanceId: string): void {
  const { state, data } = ctx;
  const ch = memberById(state, memberId);
  const inst = state.items[instanceId];
  if (ch === null || inst === undefined) throw new Error(`sellItem: bad ${memberId} / ${instanceId}`);
  const item = itemDisplayName(state, data, instanceId);
  const gold = sellPrice(inst, data);
  if (inst.uniqueId !== null) {
    ch.inventory = ch.inventory.filter((x) => x !== instanceId);
    state.buyback.push(instanceId);
  } else {
    destroyItemInstance(state, ch, instanceId);
  }
  state.gold += gold;
  ctx.events.push({ kind: "message", key: "town.shop.sold", params: { name: ch.name, item, gold } });
}

/**
 * IT-63 の買い戻し。乱数は使わない。
 * uniques[].price を払う → buyback から外し、同じ実体を本人の inventory の末尾へ → message town.shop.boughtBack{name, item, cost}
 */
export function buyBack(ctx: RuleContext, memberId: string, instanceId: string): void {
  const { state, data } = ctx;
  const ch = memberById(state, memberId);
  const inst = state.items[instanceId];
  if (ch === null || inst === undefined || !state.buyback.includes(instanceId)) throw new Error(`buyBack: bad ${memberId} / ${instanceId}`);
  const cost = buybackPrice(inst, data);
  state.gold -= cost;
  state.buyback = state.buyback.filter((x) => x !== instanceId);
  ch.inventory.push(instanceId);
  ctx.events.push({
    kind: "message",
    key: "town.shop.boughtBack",
    params: { name: ch.name, item: itemDisplayName(state, data, instanceId), cost },
  });
}

/**
 * IT-65 店の鑑定。乱数は使わない（結果は CH-77 と同じ）。
 * identifyFee を払う → 鑑定済みにし、ユニークなら図鑑に記録（IT-66）→ message town.shop.identified{name, old, item, cost}
 * → 呪われていれば message camp.identifiedCursed{item}
 */
export function identifyAtShop(ctx: RuleContext, memberId: string, instanceId: string): void {
  const { state, data } = ctx;
  const ch = memberById(state, memberId);
  if (ch === null || state.items[instanceId] === undefined) throw new Error(`identifyAtShop: bad ${memberId} / ${instanceId}`);
  const cost = data.config.economy.identifyFee;
  state.gold -= cost;
  const old = itemDisplayName(state, data, instanceId);
  identifyInstance(state, instanceId);
  const item = itemDisplayName(state, data, instanceId);
  ctx.events.push({ kind: "message", key: "town.shop.identified", params: { name: ch.name, old, item, cost } });
  if (state.items[instanceId]!.cursed) ctx.events.push({ kind: "message", key: "camp.identifiedCursed", params: { item } });
}

/**
 * IT-62: ダンジョンの初回クリア（DG-32）で流通レベルを max(今の値, onClear.shopLevel) にする。上がったときだけ message dungeon.shopLevel。
 * 呼び出し側（combat.ts のボスの勝利）が初回かどうかを判定する。乱数は使わない
 */
export function raiseShopLevel(ctx: RuleContext, level: number): void {
  const p = ctx.state.progress;
  if (level <= p.shopLevel) return;
  p.shopLevel = level;
  ctx.events.push({ kind: "message", key: "dungeon.shopLevel" });
}

// ---------------------------------------------------------------------------
// 表示層向けの問い合わせ（純粋。state を変えない）

/** UI-52 の店のページの値（townMenu.shop） */
export function shopMenu(state: GameState, data: GameData): TownMenu["shop"] {
  const gold = state.gold;
  const level = state.progress.shopLevel;
  const fee = data.config.economy.identifyFee;
  return {
    items: shopConsumables(data).map((it) => ({ itemId: it.id, name: it.name, price: it.price, affordable: gold >= it.price })),
    equipment: shopBases(state, data).map((b) => {
      const price = shopPrice(b, level, data);
      return { itemId: b.id, name: equipmentDisplayName(data, b, level, "normal", null), level, price, affordable: gold >= price };
    }),
    members: state.party.flatMap((ch) =>
      ch.life === "alive" ? [{ memberId: ch.id, name: ch.name, slotsFree: slotsFreeOf(ch, data) }] : [],
    ),
    sellable: state.party.map((ch) => ({
      memberId: ch.id,
      name: ch.name,
      items: ch.inventory.flatMap((id) => {
        const inst = state.items[id];
        return inst !== undefined && inst.identified
          ? [{ instanceId: id, name: itemDisplayName(state, data, id), price: sellPrice(inst, data) }]
          : [];
      }),
    })),
    buyback: state.buyback.map((id) => {
      const inst = state.items[id];
      if (inst === undefined) throw new Error(`shopMenu: unknown buyback item ${id}`);
      const price = buybackPrice(inst, data);
      return { instanceId: id, name: itemDisplayName(state, data, id), price, affordable: gold >= price };
    }),
    identify: {
      fee,
      affordable: gold >= fee,
      items: state.party.flatMap((ch) =>
        ch.inventory.flatMap((id) => {
          const inst = state.items[id];
          return inst !== undefined && !inst.identified
            ? [{ memberId: ch.id, memberName: ch.name, instanceId: id, name: itemDisplayName(state, data, id) }]
            : [];
        }),
      ),
    },
  };
}
