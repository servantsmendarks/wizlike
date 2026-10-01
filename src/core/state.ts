// GameState の複製、data の id 引き、アイテム実体の作成と削除、RuleContext の作成。
// ルール関数すべてが使う補助。見つからない id は Error（起動時に検証済みなので、来たらバグ）。
import type { ClassDef, GameData, Item, Personality, PersonalityId, Spell } from "./data/index";
import { EQUIP_SLOTS } from "./data/index";
import type { Character, GameState, RuleContext } from "./types";

/** JSON 往復で複製する（D1。GameState は JSON 安全が前提: CLAUDE.md §3-11）。 */
export function cloneState(s: GameState): GameState {
  return JSON.parse(JSON.stringify(s)) as GameState;
}

/** execute が作った下書きにイベント配列を添える。 */
export function makeContext(state: GameState, data: GameData): RuleContext {
  return { state, data, events: [] };
}

export function classOf(data: GameData, id: string): ClassDef {
  const c = data.classes.find((x) => x.id === id);
  if (c === undefined) throw new Error(`unknown class id: ${id}`);
  return c;
}

export function spellOf(data: GameData, id: string): Spell {
  const s = data.spells.find((x) => x.id === id);
  if (s === undefined) throw new Error(`unknown spell id: ${id}`);
  return s;
}

export function itemOf(data: GameData, id: string): Item {
  const i = data.items.find((x) => x.id === id);
  if (i === undefined) throw new Error(`unknown item id: ${id}`);
  return i;
}

/** null（リーダー）→ null。未知の id → Error。 */
export function personalityOf(data: GameData, id: PersonalityId | null): Personality | null {
  if (id === null) return null;
  const p = data.personalities.find((x) => x.id === id);
  if (p === undefined) throw new Error(`unknown personality id: ${id}`);
  return p;
}

export function memberById(state: GameState, id: string): Character | null {
  return state.party.find((c) => c.id === id) ?? null;
}

/**
 * 実体を作って state.items に登録し、id を返す。id は "i" + nextItemSeq で、作った後に nextItemSeq += 1。
 * 持ち主への登録は呼び出し側が行う。itemId は items.json の id（data での存在確認は呼び出し側）。
 */
export function createItemInstance(state: GameState, itemId: string, identified: boolean): string {
  const id = `i${state.nextItemSeq}`;
  if (Object.prototype.hasOwnProperty.call(state.items, id)) throw new Error(`item instance id already used: ${id}`);
  state.items[id] = { id, itemId, identified };
  state.nextItemSeq += 1;
  return id;
}

/** 持ち主の equipment（該当スロットを null に）と inventory から外し、state.items から消す。 */
export function destroyItemInstance(state: GameState, ch: Character, instanceId: string): void {
  if (!Object.prototype.hasOwnProperty.call(state.items, instanceId)) {
    throw new Error(`unknown item instance: ${instanceId}`);
  }
  for (const slot of EQUIP_SLOTS) {
    if (ch.equipment[slot] === instanceId) ch.equipment[slot] = null;
  }
  ch.inventory = ch.inventory.filter((x) => x !== instanceId);
  // TODO(M2, DG-41): dive.ledger.items からも外す。
  delete state.items[instanceId];
}

/** CH-71 の使用枠 = equipment の非 null の数 + inventory.length */
export function slotsUsed(ch: Character): number {
  let n = 0;
  for (const slot of EQUIP_SLOTS) {
    if (ch.equipment[slot] !== null) n += 1;
  }
  return n + ch.inventory.length;
}
