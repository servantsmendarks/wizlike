// 倉庫（TW-16 / IT-64。M7）。街（screen town・dive null）でだけ、本人の inventory と GameState.warehouse の間で実体を移す。
// 実体は作らず消さない（id も中身もそのまま）。乱数は使わない。倉庫の品は全滅（TW-21 / TW-22）の対象外（wipe.ts は party の所持品だけを見る）。
import type { GameData } from "../data/index";
import { itemDisplayName, memberById } from "../state";
import type { GameState, RuleContext, TownMenu } from "../types";
import { slotsFreeOf } from "./shop";

export type StorageAction = "deposit" | "withdraw";

/**
 * town.storage を受け付けない理由。順: wrong screen → bad action（action が deposit / withdraw でない・memberId / instanceId が文字列でない）
 * → no such member → item not in inventory（deposit。装備中の品は inventory に無い）/ not in warehouse（withdraw）
 * → warehouse full（deposit。warehouse.length ≥ warehouseSlots）/ inventory full（withdraw。CH-71）。本人の life は問わない
 */
export function checkStorage(state: GameState, action: unknown, memberId: unknown, instanceId: unknown, data: GameData): string | null {
  if (state.screen !== "town" || state.dive !== null) return "wrong screen";
  if (action !== "deposit" && action !== "withdraw") return "bad action";
  if (typeof memberId !== "string" || typeof instanceId !== "string") return "bad action";
  const ch = memberById(state, memberId);
  if (ch === null) return "no such member";
  if (action === "deposit") {
    if (!ch.inventory.includes(instanceId) || state.items[instanceId] === undefined) return "item not in inventory";
    if (state.warehouse.length >= data.config.items.warehouseSlots) return "warehouse full";
    return null;
  }
  if (!state.warehouse.includes(instanceId) || state.items[instanceId] === undefined) return "not in warehouse";
  if (slotsFreeOf(ch, data) === 0) return "inventory full";
  return null;
}

/**
 * TW-16。checkStorage が null を返した前提。
 * deposit: 本人の inventory から外して warehouse の末尾へ → message town.storage.deposited{name, item}
 * withdraw: warehouse から外して本人の inventory の末尾へ → message town.storage.withdrawn{name, item}
 */
export function doStorage(ctx: RuleContext, action: StorageAction, memberId: string, instanceId: string): void {
  const { state, data } = ctx;
  const ch = memberById(state, memberId);
  if (ch === null || state.items[instanceId] === undefined) throw new Error(`doStorage: bad ${memberId} / ${instanceId}`);
  const item = itemDisplayName(state, data, instanceId);
  if (action === "deposit") {
    ch.inventory = ch.inventory.filter((x) => x !== instanceId);
    state.warehouse.push(instanceId);
    ctx.events.push({ kind: "message", key: "town.storage.deposited", params: { name: ch.name, item } });
  } else {
    state.warehouse = state.warehouse.filter((x) => x !== instanceId);
    ch.inventory.push(instanceId);
    ctx.events.push({ kind: "message", key: "town.storage.withdrawn", params: { name: ch.name, item } });
  }
}

/** UI-52 の倉庫のページの値（townMenu.storage。純粋） */
export function storageMenu(state: GameState, data: GameData): TownMenu["storage"] {
  const capacity = data.config.items.warehouseSlots;
  return {
    capacity,
    slotsFree: Math.max(0, capacity - state.warehouse.length),
    items: state.warehouse.map((id) => ({ instanceId: id, name: itemDisplayName(state, data, id) })),
    members: state.party.map((ch) => ({
      memberId: ch.id,
      name: ch.name,
      slotsFree: slotsFreeOf(ch, data),
      items: ch.inventory.map((id) => ({ instanceId: id, name: itemDisplayName(state, data, id) })),
    })),
  };
}
