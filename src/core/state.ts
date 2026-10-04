// GameState の複製、data の id 引き、アイテム実体の作成と削除、RuleContext の作成。
// ルール関数すべてが使う補助。見つからない id は Error（起動時に検証済みなので、来たらバグ）。
import type {
  ClassDef,
  DropTable,
  DungeonDef,
  EquipmentBase,
  EventDef,
  GameData,
  InnRank,
  Item,
  ItemOption,
  Monster,
  Personality,
  PersonalityId,
  Spell,
  UniqueDef,
} from "./data/index";
import { EQUIP_SLOTS } from "./data/index";
import type { Character, GameState, ItemOptionRoll, Rarity, RuleContext } from "./types";

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

/** items.json の消耗品・魔法書（M7 の B2 から装備は返さない。装備は baseOf） */
export function itemOf(data: GameData, id: string): Item {
  const i = data.items.find((x) => x.id === id);
  if (i === undefined) throw new Error(`unknown item id: ${id}`);
  return i;
}

/** items.json の消耗品・魔法書。無ければ（装備のベースの id なら）null */
export function findItem(data: GameData, id: string): Item | null {
  return data.items.find((x) => x.id === id) ?? null;
}

/** equipment-bases.json のベース。無ければ（消耗品・魔法書の id なら）null */
export function findBase(data: GameData, id: string): EquipmentBase | null {
  return data.equipmentBases.find((x) => x.id === id) ?? null;
}

/** IT-02: equipment-bases.json のベース */
export function baseOf(data: GameData, id: string): EquipmentBase {
  const b = data.equipmentBases.find((x) => x.id === id);
  if (b === undefined) throw new Error(`unknown equipment base id: ${id}`);
  return b;
}

/** IT-03: uniques.json のユニーク */
export function uniqueOf(data: GameData, id: string): UniqueDef {
  const u = data.uniques.find((x) => x.id === id);
  if (u === undefined) throw new Error(`unknown unique id: ${id}`);
  return u;
}

/** IT-33: item-options.json のオプション */
export function optionOf(data: GameData, id: string): ItemOption {
  const o = data.itemOptions.options.find((x) => x.id === id);
  if (o === undefined) throw new Error(`unknown item option id: ${id}`);
  return o;
}

/** IT-51: drops.json の表 */
export function dropTableOf(data: GameData, id: string): DropTable {
  const t = data.drops.tables.find((x) => x.id === id);
  if (t === undefined) throw new Error(`unknown drop table id: ${id}`);
  return t;
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

/** TW-15: そのランクに泊まると士気が立つか（sanOver / goodWeight / judgeBonus / gossip のどれかが 0 / false でない） */
export function raisesMorale(r: InnRank): boolean {
  return r.sanOver > 0 || r.goodWeight > 0 || r.judgeBonus > 0 || r.gossip;
}

/** TW-15: 今の士気のランクの行。士気が無い、または rankId がデータに無ければ null（効果なし。検証はしない） */
export function moraleOf(state: GameState, data: GameData): InnRank | null {
  if (state.morale === null) return null;
  const id = state.morale.rankId;
  return data.config.town.innRanks.find((r) => r.id === id) ?? null;
}

export function memberById(state: GameState, id: string): Character | null {
  return state.party.find((c) => c.id === id) ?? null;
}

/** createItemInstance の指定。省略した欄の既定は Lv0・normal・オプションなし・ユニークでない・呪いなし・foundIn null（IT-10） */
export type ItemInstanceSpec = {
  itemId: string;
  identified: boolean;
  level?: number;
  rarity?: Rarity;
  options?: ItemOptionRoll[];
  uniqueId?: string | null;
  cursed?: boolean;
  foundIn?: string | null;
};

/**
 * 実体を作って state.items に登録し、id を返す。id は "i" + nextItemSeq で、作った後に nextItemSeq += 1。
 * 持ち主への登録は呼び出し側が行う。itemId は equipment-bases.json か items.json の id（data での存在確認は呼び出し側）。
 * options は複製して持つ（呼び出し側の配列を共有しない）。
 */
export function createItemInstance(state: GameState, spec: ItemInstanceSpec): string {
  const id = `i${state.nextItemSeq}`;
  if (Object.prototype.hasOwnProperty.call(state.items, id)) throw new Error(`item instance id already used: ${id}`);
  state.items[id] = {
    id,
    itemId: spec.itemId,
    level: spec.level ?? 0,
    rarity: spec.rarity ?? "normal",
    options: (spec.options ?? []).map((o) => ({ ...o })),
    uniqueId: spec.uniqueId ?? null,
    identified: spec.identified,
    cursed: spec.cursed ?? false,
    foundIn: spec.foundIn ?? null,
  };
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
 * CH-72 / IT-11 / IT-12: アイテム実体の表示名。実体が無ければ Error。
 * - 装備の未鑑定: ベースの unidentifiedName だけ（希少度・Lv・ユニークかどうかを見せない。IT-12）。
 * - 装備の鑑定済み: 希少度の接頭辞（strings の item.rarity.<rarity>。通常は無し）+ 名前（ユニークならユニークの名前、それ以外はベースの名前）
 *   + Lv（汎用で 1 以上のときだけ strings の item.plus の {n}）。例「上質な長剣 +5」。
 * - 消耗品・魔法書: 鑑定済みなら items[].name、未鑑定なら unidentifiedName（無ければ name）。
 * core が strings の値を読むのは、message の params に入れる表示名を組むここだけ（items.md §11 の Q11 の既定の案。キーは検証で必須）。
 */
export function itemDisplayName(state: GameState, data: GameData, instanceId: string): string {
  const inst = state.items[instanceId];
  if (inst === undefined) throw new Error(`unknown item instance: ${instanceId}`);
  const base = findBase(data, inst.itemId);
  if (base !== null) {
    if (!inst.identified) return base.unidentifiedName;
    const prefix = inst.rarity === "normal" ? "" : (data.strings[`item.rarity.${inst.rarity}`] ?? "");
    if (inst.uniqueId !== null) return prefix + uniqueOf(data, inst.uniqueId).name;
    const plus = inst.level >= 1 ? (data.strings["item.plus"] ?? "").replace("{n}", String(inst.level)) : "";
    return prefix + base.name + plus;
  }
  const item = itemOf(data, inst.itemId);
  return inst.identified ? item.name : (item.unidentifiedName ?? item.name);
}

/** IT-30 の希少度の順（後ろほど良い。IT-66 の bestRarity の比較に使う） */
export const RARITY_ORDER: readonly Rarity[] = ["normal", "fine", "rare", "legendary"];

/**
 * CH-77 / IT-65 / IT-66: 実体を鑑定済みにし、ユニークなら図鑑に記録する。図鑑に無ければ { foundIn: 実体の foundIn, bestRarity: 実体の rarity }、
 * あれば bestRarity だけを良い方に更新する（foundIn は最初の記録のまま）。乱数は使わない。実体が無ければ Error
 */
export function identifyInstance(state: GameState, instanceId: string): void {
  const inst = state.items[instanceId];
  if (inst === undefined) throw new Error(`unknown item instance: ${instanceId}`);
  inst.identified = true;
  if (inst.uniqueId === null) return;
  const prev = state.uniqueBook[inst.uniqueId];
  if (prev === undefined) {
    state.uniqueBook[inst.uniqueId] = { foundIn: inst.foundIn, bestRarity: inst.rarity };
  } else if (RARITY_ORDER.indexOf(inst.rarity) > RARITY_ORDER.indexOf(prev.bestRarity)) {
    prev.bestRarity = inst.rarity;
  }
}

/** CH-71 の使用枠 = equipment の非 null の数 + inventory.length */
export function slotsUsed(ch: Character): number {
  let n = 0;
  for (const slot of EQUIP_SLOTS) {
    if (ch.equipment[slot] !== null) n += 1;
  }
  return n + ch.inventory.length;
}
