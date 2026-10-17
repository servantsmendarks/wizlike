// UI-80（M20）: キャラクター画面で品を押したときの操作の問い合わせ itemActions。純粋。state を変えない。乱数を使わない。
// 当てはまるか・送れるかは既存の check 関数（checkEquip / checkUnequip / checkUseItem / checkGive / checkIdentify）で決める
// （表示層は判定しない。UI-35）。items.ts が camp.ts を import するので、両方を使うこの問い合わせは別のファイルに置く。
import type { GameData } from "../data/index";
import { EQUIP_SLOTS } from "../data/index";
import { findBase, findItem, itemDisplayName, memberById } from "../state";
import type { EquipBlock, GameState, ItemActionBlock, ItemActions, ItemActionView } from "../types";
import { campPlace, checkEquip, checkGive, checkIdentify, checkUnequip, identifyChance } from "./camp";
import { checkUseItem } from "./items";

/** checkEquip の理由 → EquipBlock（campMenu の equipCandidates と同じ写し） */
const EQUIP_BLOCK: Record<string, EquipBlock> = {
  "cannot act": "cannotAct",
  "not identified": "unidentified",
  "class cannot equip": "class",
  "slot cursed": "cursedSlot",
  "inventory full": "full", // TW-16c（M21）: 倉庫の品で旧品が無く、使用枠に空きが無い
};

/** checkUseItem の理由 → ItemActionBlock。full hp は対象の段の理由なので null（品の行では見ない。fieldItemMenu と同じ） */
const USE_BLOCK: Record<string, ItemActionBlock> = {
  "cannot act": "cannotAct",
  "not usable here": "notHere",
  "class cannot learn this school": "cannotLearn",
  "spell already known": "known",
  "bad target": "noTarget",
};

function mapped(r: string | null, table: Record<string, ItemActionBlock>, what: string): ItemActionBlock | null {
  if (r === null) return null;
  const b = table[r];
  if (b === undefined) throw new Error(`itemActions: unexpected ${what} reason ${r}`);
  return b;
}

/**
 * UI-80（M20）: memberId の品 instanceId（装備中か所持品）に当てはまる操作と、送れない理由。
 * campPlace が null（戦闘中・保留中・title）・人がいない・品がその人の装備にも所持品にも無いなら null。
 * - 装備中の品: 外す（呪われていれば cursed）だけ。
 * - 所持品の装備品: 装備する（checkEquip の理由）→ 渡す → 捨てる →（未鑑定なら）鑑定。
 * - 所持品の消耗品・魔法書: 使う（checkUseItem の理由。対象の要る品は先頭の生存者を仮の対象にし、満タンは見ない）→ 渡す → 捨てる →（未鑑定なら）鑑定。
 * - 渡す: 自分以外に checkGive が通る者がいなければ noReceiver。捨てる: 常に送れる（checkDrop は持ち主の所持品なら通る）。
 * - 鑑定: 品が未鑑定で、パーティに鑑定できる職業の者がいるときだけ。鑑定する者は 持ち主 → 並び順 の順で、checkIdentify が通る最初の者
 *   （誰も通らなければ同じ順の最初の者で、理由は cannotAct / noMp）。identifier にその者と identifyChance の rate
 * - TW-16c（M21）: 街（campPlace town）で、品が倉庫（GameState.warehouse）にある装備品なら、装備する だけ（checkEquip の from / to "warehouse" の理由）で
 *   from "warehouse"。倉庫の消耗品・魔法書は null（倉庫からは使えない）
 */
export function itemActions(state: GameState, data: GameData, memberId: string, instanceId: string): ItemActions | null {
  if (campPlace(state) === null) return null;
  const ch = memberById(state, memberId);
  const inst = state.items[instanceId];
  if (ch === null || inst === undefined) return null;
  const equippedSlot = EQUIP_SLOTS.find((k) => ch.equipment[k] === instanceId) ?? null;
  const base = findBase(data, inst.itemId);
  if (equippedSlot === null && !ch.inventory.includes(instanceId)) {
    // TW-16c（M21）: 倉庫の装備品
    if (campPlace(state) !== "town" || base === null || !state.warehouse.includes(instanceId)) return null;
    const r = checkEquip(state, data, memberId, instanceId, "warehouse", "warehouse");
    return {
      memberId,
      instanceId,
      name: itemDisplayName(state, data, instanceId),
      equippedSlot: null,
      slot: base.slot,
      actions: [{ action: "equip", block: mapped(r, EQUIP_BLOCK, "equip") }],
      identifier: null,
      from: "warehouse",
    };
  }
  const out: ItemActions = {
    memberId,
    instanceId,
    name: itemDisplayName(state, data, instanceId),
    equippedSlot,
    slot: base?.slot ?? null,
    actions: [],
    identifier: null,
  };
  const push = (action: ItemActionView["action"], block: ItemActionBlock | null): void => {
    out.actions.push({ action, block });
  };
  if (equippedSlot !== null) {
    const r = checkUnequip(state, data, memberId, equippedSlot);
    if (r !== null && r !== "cursed") throw new Error(`itemActions: unexpected unequip reason ${r}`);
    push("unequip", r === null ? null : "cursed");
    return out;
  }
  if (base !== null) {
    push("equip", mapped(checkEquip(state, data, memberId, instanceId), EQUIP_BLOCK, "equip"));
  } else if (findItem(data, inst.itemId) !== null) {
    const item = findItem(data, inst.itemId)!;
    const ally = item.type === "consumable" && item.effect.type !== "return" && item.effect.target === "ally";
    const probe = ally ? (state.party.find((c) => c.life === "alive")?.id ?? null) : null;
    const r = checkUseItem(state, data, memberId, instanceId, probe);
    push("use", r === "full hp" ? null : mapped(r, USE_BLOCK, "use"));
  }
  const receiver = state.party.some((c) => c.id !== memberId && checkGive(state, data, memberId, instanceId, c.id) === null);
  push("give", receiver ? null : "noReceiver");
  push("drop", null);
  if (!inst.identified) {
    const able = [ch, ...state.party.filter((c) => c.id !== memberId)].filter((c) => checkIdentify(state, data, c.id, instanceId) !== "cannot identify");
    const who = able.find((c) => checkIdentify(state, data, c.id, instanceId) === null) ?? able[0];
    if (who !== undefined) {
      const r = checkIdentify(state, data, who.id, instanceId);
      const block: ItemActionBlock | null = r === null ? null : r === "cannot act" ? "cannotAct" : r === "no mp" ? "noMp" : null;
      if (r !== null && block === null) throw new Error(`itemActions: unexpected identify reason ${r}`);
      push("identify", block);
      out.identifier = { id: who.id, name: who.name, rate: identifyChance(state, data, who.id, instanceId)!.rate };
    }
  }
  return out;
}
