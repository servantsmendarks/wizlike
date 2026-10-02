// GameState の複製、data の id 引き、アイテム実体の作成と削除、RuleContext の作成。
// ルール関数すべてが使う補助。見つからない id は Error（起動時に検証済みなので、来たらバグ）。
import type { ClassDef, DungeonDef, EventDef, GameData, Item, Monster, Personality, PersonalityId, Spell } from "./data/index";
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

export function monsterOf(data: GameData, id: string): Monster {
  const m = data.monsters.find((x) => x.id === id);
  if (m === undefined) throw new Error(`unknown monster id: ${id}`);
  return m;
}

export function dungeonOf(data: GameData, id: string): DungeonDef {
  const d = data.dungeons.find((x) => x.id === id);
  if (d === undefined) throw new Error(`unknown dungeon id: ${id}`);
  return d;
}

export function eventOf(data: GameData, id: string): EventDef {
  const e = data.events.find((x) => x.id === id);
  if (e === undefined) throw new Error(`unknown event id: ${id}`);
  return e;
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

/**
 * 持ち主の equipment（該当スロットを null に）と inventory から外し、state.items から消す。
 * 潜行中なら潜行台帳（dive.ledger.items）からも外す（DG-41: 迷宮で使った・壊れた取得物は台帳から消える）。
 */
export function destroyItemInstance(state: GameState, ch: Character, instanceId: string): void {
  if (!Object.prototype.hasOwnProperty.call(state.items, instanceId)) {
    throw new Error(`unknown item instance: ${instanceId}`);
  }
  for (const slot of EQUIP_SLOTS) {
    if (ch.equipment[slot] === instanceId) ch.equipment[slot] = null;
  }
  ch.inventory = ch.inventory.filter((x) => x !== instanceId);
  if (state.dive !== null) state.dive.ledger.items = state.dive.ledger.items.filter((x) => x !== instanceId);
  delete state.items[instanceId];
}

/**
 * CH-72: アイテム実体の表示名。鑑定済みなら items[].name、未鑑定なら unidentifiedName（無ければ name）。
 * 実体が無ければ Error。
 */
export function itemDisplayName(state: GameState, data: GameData, instanceId: string): string {
  const inst = state.items[instanceId];
  if (inst === undefined) throw new Error(`unknown item instance: ${instanceId}`);
  const item = itemOf(data, inst.itemId);
  return inst.identified ? item.name : (item.unidentifiedName ?? item.name);
}

/** CH-71 の使用枠 = equipment の非 null の数 + inventory.length */
export function slotsUsed(ch: Character): number {
  let n = 0;
  for (const slot of EQUIP_SLOTS) {
    if (ch.equipment[slot] !== null) n += 1;
  }
  return n + ch.inventory.length;
}
