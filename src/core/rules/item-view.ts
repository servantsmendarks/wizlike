// 表示層向けの装備の問い合わせ（IT-11 / IT-12 / IT-35 / IT-66、UI-59 の状態と品の詳細、図鑑）。純粋。state を変えない。乱数を使わない。
// 値の式は equip-stats.ts（実効の値・品 1 つの性能）と shop.ts（売値）のものをそのまま使う（表示層は計算しない。UI-35）。
import type { EquipSlot, GameData, SkillType, StatBlock } from "../data/index";
import { findBase, itemDisplayName, itemOf, optionOf, uniqueOf } from "../state";
import type { Character, GameState, Rarity } from "../types";
import { allyAc } from "./combat-calc";
import { equipStats, itemPower, type ItemPower } from "./equip-stats";
import { sellPrice } from "./shop";

/** 品の詳細のオプション 1 行。value は表示する符号付きの値（ac は AC の増減として −値。IT-34）、bad は負のオプション（呪い。IT-32） */
export type ItemDetailOption = { name: string; value: number; unit: string; bad: boolean };

/**
 * UI-59（M7）: 品の詳細。未鑑定（IT-12）は name（未鑑定の名前）・slot・identified だけで、ほかは null / [] / false（呪いも見せない。CH-73）。
 * - level: 鑑定済みの汎用装備の Lv（ユニーク・消耗品・魔法書は null）
 * - rarity / power: 鑑定済みの装備だけ（power はオプションを除く性能。IT-20〜23）
 * - options: 鑑定済みの装備のオプション（実体の順）。skill: 鑑定済みのユニークの固有スキル（IT-40）
 * - cursed: 鑑定済みかつ呪われている。sellPrice: 鑑定済みの品の売値（IT-61。未鑑定は売れないので null）
 * - description: 鑑定済みのユニークの説明（uniques[].description）
 */
export type ItemDetail = {
  instanceId: string;
  name: string;
  /** 装備の部位。消耗品・魔法書は null */
  slot: EquipSlot | null;
  identified: boolean;
  level: number | null;
  rarity: Rarity | null;
  unique: boolean;
  power: ItemPower | null;
  options: ItemDetailOption[];
  skill: { type: SkillType; value: number } | null;
  cursed: boolean;
  sellPrice: number | null;
  description: string | null;
};

/** UI-59 / IT-11 / IT-12: 品の詳細。実体が無ければ null */
export function itemDetail(state: GameState, data: GameData, instanceId: string): ItemDetail | null {
  const inst = state.items[instanceId];
  if (inst === undefined) return null;
  const base = findBase(data, inst.itemId);
  const name = itemDisplayName(state, data, instanceId);
  const hidden: ItemDetail = {
    instanceId,
    name,
    slot: base?.slot ?? null,
    identified: inst.identified,
    level: null,
    rarity: null,
    unique: false,
    power: null,
    options: [],
    skill: null,
    cursed: false,
    sellPrice: null,
    description: null,
  };
  if (!inst.identified) return hidden;
  if (base === null) {
    itemOf(data, inst.itemId); // 消耗品・魔法書（知らない id なら Error）
    return { ...hidden, sellPrice: sellPrice(inst, data) };
  }
  const uniq = inst.uniqueId === null ? null : uniqueOf(data, inst.uniqueId);
  return {
    ...hidden,
    level: uniq === null ? inst.level : null,
    rarity: inst.rarity,
    unique: uniq !== null,
    power: itemPower(data, inst, base),
    options: inst.options.map((o) => {
      const def = optionOf(data, o.optionId);
      return { name: def.name, value: def.effect.type === "ac" ? -o.value : o.value, unit: def.unit, bad: o.value < 0 };
    }),
    skill: uniq === null ? null : { type: uniq.skill.type, value: uniq.skill.value },
    cursed: inst.cursed,
    sellPrice: sellPrice(inst, data),
    description: uniq?.description ?? null,
  };
}

/**
 * UI-59 / UI-12（M7）: 1 人の状態に出す実効の値（CH-13 / CH-14 / IT-35）。stats は実効の能力値、hpMax / mpMax / sanMax は実効の最大値
 * （sanMax は sanCapOf と同じ値。士気の超過は含めない）、ac は allyAc（acBase + 装備。戦闘の外では防御の補正は 0）、magicPower は MG-33 の魔法攻撃力
 */
export type MemberSheet = { stats: StatBlock; hpMax: number; mpMax: number; sanMax: number; ac: number; magicPower: number };

export function memberSheet(state: GameState, data: GameData, ch: Character): MemberSheet {
  const es = equipStats(state, data, ch);
  return { stats: es.stats, hpMax: es.hpMax, mpMax: es.mpMax, sanMax: es.sanMax, ac: allyAc(state, data, ch), magicPower: es.magicPower };
}

/**
 * IT-66: 図鑑の 1 行（uniques.json の順で全種類）。記録の無いユニークは known false で name / foundIn / bestRarity が null。
 * foundIn は入手ダンジョンの名前（記録の foundIn が null か、知らない id なら null）
 */
export type UniqueBookRow = { uniqueId: string; known: boolean; name: string | null; foundIn: string | null; bestRarity: Rarity | null };

export function uniqueBookView(state: GameState, data: GameData): UniqueBookRow[] {
  return data.uniques.map((u) => {
    const e = state.uniqueBook[u.id];
    if (e === undefined) return { uniqueId: u.id, known: false, name: null, foundIn: null, bestRarity: null };
    const dungeon = e.foundIn === null ? undefined : data.dungeons.find((d) => d.id === e.foundIn);
    return { uniqueId: u.id, known: true, name: u.name, foundIn: dungeon?.name ?? null, bestRarity: e.bestRarity };
  });
}
