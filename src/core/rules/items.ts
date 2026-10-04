// 迷宮の戦闘外と街での道具（dungeon.useItem。M5.5 から街でも受け付ける。帰還の糸は迷宮だけ。DG-30 帰還の糸、DG-41、MG-25 魔法書、F9 の heal / cureStatus）と、
// 表示層向けの問い合わせ fieldItemMenu。battle には依存しない（効果は effects.ts の applyAllyEffect を戦闘と共有）。
// 乱数: heal のダイスだけ（applyAllyEffect の順）。
import type { GameData, Item } from "../data/index";
import { destroyItemInstance, itemDisplayName, itemOf, memberById } from "../state";
import type { Character, FieldItemMenu, FieldItemView, GameState, RuleContext } from "../types";
import { canAct } from "./combat-calc";
import { applyAllyEffect } from "./effects";
import { campPlace } from "./camp";
import { checkLearnFromBook, learnFromBook } from "./learning";
import { returnToTown } from "./town";

/** 戦闘外（迷宮・街）で使える品の種類（consumable / book で、usableIn が battle でない） */
function fieldUsable(item: Item): boolean {
  return (item.type === "consumable" || item.type === "book") && item.usableIn !== "battle";
}

/**
 * dungeon.useItem を受け付けない理由（英語）。受け付けるなら null。
 * itemId は ItemInstance.id（使う本人の inventory のもの。装備中は不可）。targetId は effect.target が ally のときだけ見る。
 * 判定順: wrong screen（戦闘中・保留中・title）→ no such member → cannot act → item not in inventory → not usable here → 効果ごと（街の帰還は not usable here、bad target / 魔法書の理由）
 */
export function checkUseItem(
  state: GameState,
  data: GameData,
  memberId: unknown,
  itemId: unknown,
  targetId: unknown,
): string | null {
  const place = campPlace(state);
  if (place === null) return "wrong screen";
  const ch = typeof memberId === "string" ? memberById(state, memberId) : null;
  if (ch === null) return "no such member";
  if (!canAct(ch)) return "cannot act";
  if (typeof itemId !== "string" || !ch.inventory.includes(itemId)) return "item not in inventory";
  const inst = state.items[itemId];
  if (inst === undefined) return "item not in inventory";
  const item = itemOf(data, inst.itemId);
  if (!fieldUsable(item)) return "not usable here";
  if (item.type === "book") return checkLearnFromBook(state, ch.id, itemId, data);
  if (item.type !== "consumable") return "not usable here";
  const e = item.effect;
  switch (e.type) {
    case "return":
      return place === "town" ? "not usable here" : null; // DG-30（M5.5）: 帰還の糸は迷宮だけ
    case "heal":
    case "cureStatus":
      switch (e.target) {
        case "ally": {
          const t = typeof targetId === "string" ? memberById(state, targetId) : null;
          return t !== null && t.life === "alive" ? null : "bad target";
        }
        case "self":
        case "party":
          return null;
        default:
          return "not usable here";
      }
  }
}

/** checkUseItem が null を返した前提で呼ぶ（engine は check の後に複製する） */
export function useItemInField(ctx: RuleContext, memberId: string, instanceId: string, targetId: string | null): void {
  const { state, data } = ctx;
  const ch = memberById(state, memberId);
  if (ch === null) throw new Error(`useItemInField: unknown member ${memberId}`);
  const inst = state.items[instanceId];
  if (inst === undefined) throw new Error(`useItemInField: unknown item instance ${instanceId}`);
  const item = itemOf(data, inst.itemId);
  if (item.type === "book") {
    // MG-25: 覚えて本を消費する（message は town.inn.learned の使い回し）
    learnFromBook(ctx, ch, instanceId);
    return;
  }
  if (item.type !== "consumable") throw new Error(`useItemInField: not usable: ${item.id}`);
  const name = itemDisplayName(state, data, instanceId);
  destroyItemInstance(state, ch, instanceId); // DG-41: 台帳からも外れる
  ctx.events.push({ kind: "message", key: "battle.useItem", params: { actor: ch.name, item: name } });
  const e = item.effect;
  switch (e.type) {
    case "return":
      returnToTown(ctx, "dungeon.return"); // DG-30
      return;
    case "heal":
    case "cureStatus": {
      const targets = fieldTargets(state, ch, e.target, targetId);
      applyAllyEffect(ctx, e.type === "heal" ? { type: "heal", dice: e.dice } : { type: "cureStatus", status: e.status }, targets);
      return;
    }
  }
}

function fieldTargets(state: GameState, actor: Character, target: string, targetId: string | null): Character[] {
  switch (target) {
    case "ally": {
      const t = targetId === null ? null : memberById(state, targetId);
      if (t === null) throw new Error(`useItemInField: bad target ${String(targetId)}`);
      return [t];
    }
    case "self":
      return [actor];
    case "party":
      return state.party.filter((c) => c.life === "alive");
    default:
      throw new Error(`useItemInField: target not usable in field: ${target}`);
  }
}

/**
 * UI-53 / TW-03 の道具の一覧。campPlace が非 null（街、または迷宮の戦闘外かつ保留なし）のときだけ非 null（M5.5 から街でも）。
 * members はパーティ全員（並び順）で、items は inventory の順の consumable / book。usable は checkUseItem と同値
 * （ally の品は先頭の alive の味方を仮の対象にして見る）。isReturn は consumable で effect が return の品（帰還の糸。表示層の確認の段）。
 */
export function fieldItemMenu(state: GameState, data: GameData): FieldItemMenu | null {
  if (campPlace(state) === null) return null;
  const alive = state.party.filter((c) => c.life === "alive");
  const probe = alive[0]?.id ?? null;
  return {
    members: state.party.map((ch) => {
      const items: FieldItemView[] = [];
      for (const id of ch.inventory) {
        const inst = state.items[id];
        if (inst === undefined) continue;
        const item = itemOf(data, inst.itemId);
        if (item.type !== "consumable" && item.type !== "book") continue;
        const target: FieldItemView["target"] =
          item.type === "consumable" && item.effect.type !== "return" && item.effect.target === "ally" ? "ally" : "none";
        items.push({
          instanceId: id,
          itemId: inst.itemId,
          name: itemDisplayName(state, data, id),
          target,
          isReturn: item.type === "consumable" && item.effect.type === "return",
          usable: checkUseItem(state, data, ch.id, id, target === "ally" ? probe : null) === null,
        });
      }
      return { id: ch.id, name: ch.name, canAct: canAct(ch), items };
    }),
    allies: alive.map((c) => ({ id: c.id, name: c.name, hp: c.hp, hpMax: c.hpMax })),
  };
}
