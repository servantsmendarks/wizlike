// 倉庫（TW-16 / IT-64。M7）。街（screen town・dive null）でだけ、本人の inventory と GameState.warehouse の間で実体を移す。
// 実体は作らず消さない（id も中身もそのまま）。乱数は使わない。倉庫の品は全滅（TW-21 / TW-22）の対象外（wipe.ts は party の所持品だけを見る）。
import type { GameData } from "../data/index";
import { itemDisplayName, memberById, slotsMaxOf, slotsUsed } from "../state";
import type { Character, GameState, RuleContext, TownMenu } from "../types";
import { slotsFreeOf } from "./shop";

export type StorageAction = "deposit" | "withdraw" | "depositAll" | "expand";

/**
 * town.storage を受け付けない理由。順: wrong screen → bad action（action が deposit / withdraw でない・memberId / instanceId が文字列でない）
 * → no such member → item not in inventory（deposit。装備中の品は inventory に無い）/ not in warehouse（withdraw）
 * → （expand は storage max → not enough gold。TW-10 M24）→ warehouse full（deposit。warehouse.length ≥ progress.warehouseSlots）/ inventory full（withdraw。CH-71）。本人の life は問わない
 */
export function checkStorage(state: GameState, action: unknown, memberId: unknown, instanceId: unknown, data: GameData): string | null {
  if (state.screen !== "town" || state.dive !== null) return "wrong screen";
  if (action === "expand") return checkExpand(state, data);
  if (action === "depositAll") return checkDepositAll(state, memberId, data);
  if (action !== "deposit" && action !== "withdraw") return "bad action";
  if (typeof memberId !== "string" || typeof instanceId !== "string") return "bad action";
  const ch = memberById(state, memberId);
  if (ch === null) return "no such member";
  if (action === "deposit") {
    if (!ch.inventory.includes(instanceId) || state.items[instanceId] === undefined) return "item not in inventory";
    if (state.warehouse.length >= state.progress.warehouseSlots) return "warehouse full";
    return null;
  }
  if (!state.warehouse.includes(instanceId) || state.items[instanceId] === undefined) return "not in warehouse";
  if (slotsFreeOf(ch, data) === 0) return "inventory full";
  return null;
}

/** TW-10（M24 D-1）倉庫を広げる（screen は checkStorage で見た後）。順: storage max（枠数 ≥ config.bank.maxSlots）→ not enough gold（gold < expandCost） */
function checkExpand(state: GameState, data: GameData): string | null {
  const b = data.config.bank;
  if (state.progress.warehouseSlots >= b.maxSlots) return "storage max";
  if (state.gold < b.expandCost) return "not enough gold";
  return null;
}

/** TW-10（M24 D-1）倉庫を広げる。checkStorage が null を返した前提。gold −= expandCost、枠数 = min(maxSlots, 枠数 + expandSlots)。message town.storage.expanded{capacity}。乱数は使わない */
export function doExpand(ctx: RuleContext): void {
  const { state, data } = ctx;
  const b = data.config.bank;
  state.gold -= b.expandCost;
  state.progress.warehouseSlots = Math.min(b.maxSlots, state.progress.warehouseSlots + b.expandSlots);
  ctx.events.push({ kind: "message", key: "town.storage.expanded", params: { capacity: state.progress.warehouseSlots } });
}

/** TW-16b（M17）すべて預けるの対象の者（memberId が null なら全員を並び順に）。memberId が文字列でパーティに居なければ null */
function depositAllTargets(state: GameState, memberId: string | null): Character[] | null {
  if (memberId === null) return state.party;
  const ch = memberById(state, memberId);
  return ch === null ? null : [ch];
}

/**
 * TW-16b（M17）depositAll を受け付けない理由（screen は checkStorage で見た後）。順: bad action（memberId が文字列でも null でもない）
 * → no such member → nothing to deposit（対象の inventory が全部空）→ warehouse full（warehouse.length ≥ progress.warehouseSlots）。life は問わない
 */
function checkDepositAll(state: GameState, memberId: unknown, _data: GameData): string | null {
  if (memberId !== null && typeof memberId !== "string") return "bad action";
  const targets = depositAllTargets(state, memberId);
  if (targets === null) return "no such member";
  if (targets.every((ch) => ch.inventory.length === 0)) return "nothing to deposit";
  if (state.warehouse.length >= state.progress.warehouseSlots) return "warehouse full";
  return null;
}

/**
 * TW-16b（M17）すべて預ける。checkStorage が null を返した前提。対象の者（null = 全員を並び順に）の inventory の全部（装備していない物。
 * 消耗品・未鑑定・呪われた品も含む）を、者の並び → inventory の順に warehouse の末尾へ移す。倉庫が満杯になったらそこで止め、残りは手元。
 * 1 品でも預けた者ごとに message town.storage.depositedAll{name, count}。満杯で止まって対象の品が残れば最後に town.storage.fullStopped{left}。
 * 実体は作らず消さない。乱数は使わない
 */
export function doDepositAll(ctx: RuleContext, memberId: string | null): void {
  const { state } = ctx;
  const targets = depositAllTargets(state, memberId);
  if (targets === null) throw new Error(`doDepositAll: unknown member ${memberId}`);
  const capacity = state.progress.warehouseSlots;
  for (const ch of targets) {
    const room = Math.max(0, capacity - state.warehouse.length);
    const moved = ch.inventory.slice(0, room);
    if (moved.length === 0) continue;
    ch.inventory = ch.inventory.slice(moved.length);
    state.warehouse.push(...moved);
    ctx.events.push({ kind: "message", key: "town.storage.depositedAll", params: { name: ch.name, count: moved.length } });
  }
  const left = targets.reduce((n, ch) => n + ch.inventory.length, 0);
  if (left > 0) ctx.events.push({ kind: "message", key: "town.storage.fullStopped", params: { left } });
}

/**
 * TW-16。checkStorage が null を返した前提。
 * deposit: 本人の inventory から外して warehouse の末尾へ → message town.storage.deposited{name, item}
 * withdraw: warehouse から外して本人の inventory の末尾へ → message town.storage.withdrawn{name, item}
 */
export function doStorage(ctx: RuleContext, action: "deposit" | "withdraw", memberId: string, instanceId: string): void {
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

/**
 * CH-71b 溢れの保険（M17）。溢れ = slotsUsed − slotsMaxOf が正。素の力だけで枠を決めるので今の規則では起きない（保険）。
 * 街（screen town・dive null）でだけ動く（迷宮の中では何もしない）。倉庫に空きがある間、inventory の末尾から 1 品ずつ warehouse の末尾へ移し、
 * 1 品ごとに message town.storage.autoDeposited{name, item}。倉庫が満杯で溢れが残れば message inventory.overflow{name, over}（品は消さない）。
 * 装備中の品は動かさない（inventory が尽きたらそこで止める）。乱数は使わない。呼ぶのは arriveTown（全員）と changeClass（本人）
 */
export function settleOverflow(ctx: RuleContext, memberId: string): void {
  const { state, data } = ctx;
  if (state.screen !== "town" || state.dive !== null) return;
  const ch = memberById(state, memberId);
  if (ch === null) throw new Error(`settleOverflow: unknown member ${memberId}`);
  const capacity = state.progress.warehouseSlots;
  while (slotsUsed(ch) > slotsMaxOf(ch, data) && ch.inventory.length > 0 && state.warehouse.length < capacity) {
    const id = ch.inventory[ch.inventory.length - 1] as string;
    ch.inventory = ch.inventory.slice(0, -1);
    state.warehouse.push(id);
    ctx.events.push({ kind: "message", key: "town.storage.autoDeposited", params: { name: ch.name, item: itemDisplayName(state, data, id) } });
  }
  const over = slotsUsed(ch) - slotsMaxOf(ch, data);
  if (over > 0) ctx.events.push({ kind: "message", key: "inventory.overflow", params: { name: ch.name, over } });
}

/** TW-16 の行 1 個（M24 B-1: cursed は鑑定済みかつ実体の cursed） */
function storageRow(state: GameState, data: GameData, id: string): TownMenu["storage"]["items"][number] {
  const inst = state.items[id];
  return { instanceId: id, name: itemDisplayName(state, data, id), cursed: inst !== undefined && inst.identified && inst.cursed };
}

/** UI-52 の倉庫のページの値（townMenu.storage。純粋） */
export function storageMenu(state: GameState, data: GameData): TownMenu["storage"] {
  const capacity = state.progress.warehouseSlots;
  const b = data.config.bank;
  const expandReason = checkExpand(state, data);
  return {
    capacity,
    expand:
      capacity >= b.maxSlots
        ? null
        : { cost: b.expandCost, slots: b.expandSlots, next: Math.min(b.maxSlots, capacity + b.expandSlots), ok: expandReason === null, reason: expandReason },
    slotsFree: Math.max(0, capacity - state.warehouse.length),
    depositAllOk: checkDepositAll(state, null, data) === null,
    items: state.warehouse.map((id) => storageRow(state, data, id)),
    members: state.party.map((ch) => ({
      memberId: ch.id,
      name: ch.name,
      slotsFree: slotsFreeOf(ch, data),
      depositAllOk: checkDepositAll(state, ch.id, data) === null,
      items: ch.inventory.map((id) => storageRow(state, data, id)),
    })),
  };
}
