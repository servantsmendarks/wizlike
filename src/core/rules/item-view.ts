// 表示層向けの装備の問い合わせ（IT-11 / IT-12 / IT-35 / IT-66、UI-59 の状態と品の詳細、図鑑）と、M10 の装備の差分（UI-67）・
// 呪文の説明（UI-68）・レベルアップ可（CH-80）。純粋。state を変えない。乱数を使わない。
// 値の式は equip-stats.ts（実効の値・品 1 つの性能）と shop.ts（売値）のものをそのまま使う（表示層は計算しない。UI-35）。
import type { EquipSlot, GameData, SkillType, StatBlock } from "../data/index";
import { classOf, cloneState, findBase, itemDisplayName, itemOf, memberById, optionOf, uniqueOf } from "../state";
import { formatDice, parseDice } from "../rng";
import type { Character, GameState, Rarity, RuleContext, SpellInfo } from "../types";
import { checkEquip, checkUnequip, equipItem, unequipItem } from "./camp";
import { allyAc, allyAttackBonus } from "./combat-calc";
import { equipStats, itemPower, spellCost, type ItemPower } from "./equip-stats";
import { expFor, levelUpReady } from "./growth";
import { appearanceSellPrice, sellPrice } from "./shop";

/** 品の詳細のオプション 1 行。value は表示する符号付きの値（ac は AC の増減として −値。IT-34）、bad は負のオプション（呪い。IT-32） */
export type ItemDetailOption = { name: string; value: number; unit: string; bad: boolean };

/**
 * UI-59（M7）: 品の詳細。未鑑定（IT-12）は name（未鑑定の名前）・slot・identified・sellPrice（見た目の品種の売値）だけで、ほかは null / [] / false（呪いも見せない。CH-73）。
 * - level: 鑑定済みの汎用装備の Lv（ユニーク・消耗品・魔法書は null）
 * - rarity / power: 鑑定済みの装備だけ（power はオプションを除く性能。IT-20〜23）
 * - damageDice: 鑑定済みの武器のダメージの表示用のダイス。power.dice の定数と power.damageBonus（Lv の分）を 1 つの定数に合算した正規形（「1d4+1」の Lv2 は「1d4+2」、合計 0 は「1d4」、負は「1d4-1」）。武器でなければ null
 * - options: 鑑定済みの装備のオプション（実体の順）。skill: 鑑定済みのユニークの固有スキル（IT-40）
 * - cursed: 鑑定済みかつ呪われている。sellPrice: 店での売値（IT-61。鑑定済みは本当の売値、未鑑定は見た目の品種の売値。2026-10-05 から未鑑定も売れる）
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
  damageDice: string | null;
  options: ItemDetailOption[];
  skill: { type: SkillType; value: number } | null;
  cursed: boolean;
  sellPrice: number | null;
  description: string | null;
};

/** UI-59 / IT-20: 武器のダメージの表示用のダイス。ダイスの記法の定数に Lv の分を足して 1 つの定数にする（「1d4+1+1」と出さない） */
export function weaponDamageDice(dice: string, damageBonus: number): string {
  const spec = parseDice(dice);
  return formatDice({ ...spec, modifier: spec.modifier + damageBonus });
}

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
    damageDice: null,
    options: [],
    skill: null,
    cursed: false,
    sellPrice: null,
    description: null,
  };
  if (!inst.identified) return { ...hidden, sellPrice: appearanceSellPrice(inst, data) };
  if (base === null) {
    itemOf(data, inst.itemId); // 消耗品・魔法書（知らない id なら Error）
    return { ...hidden, sellPrice: sellPrice(inst, data) };
  }
  const uniq = inst.uniqueId === null ? null : uniqueOf(data, inst.uniqueId);
  const power = itemPower(data, inst, base);
  return {
    ...hidden,
    level: uniq === null ? inst.level : null,
    rarity: inst.rarity,
    unique: uniq !== null,
    power,
    damageDice: power.kind === "weapon" ? weaponDamageDice(power.dice, power.damageBonus) : null,
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
 * （sanMax は sanCapOf と同じ値。士気の超過は含めない）、ac は allyAc（acBase + 装備。戦闘の外では防御の補正は 0）、magicPower は MG-33 の魔法攻撃力。
 * attackDice / attackBonus は CB-22 の攻撃ダメージの武器ダイス（素手は combat.unarmedDice）と、それ以外の足し分（allyAttackBonus。戦闘と同じ式。最低 1 の丸めは含めない）。
 * attackDamageDice は状態画面の攻撃の行に出す実効値で、武器ダイスの記法の定数と attackBonus（オプション damage まで含む）を 1 つの定数に合算した正規形（weaponDamageDice。「1d4+1」と足し分 4 は「1d4+5」。2026-10-06）
 */
export type MemberSheet = {
  stats: StatBlock;
  hpMax: number;
  mpMax: number;
  sanMax: number;
  ac: number;
  magicPower: number;
  attackDice: string;
  attackBonus: number;
  attackDamageDice: string;
  /** CH-80（M10）: 次のレベルに要る累計 EXP（expFor(level + 1)。CH-64） */
  expNext: number;
  /** CH-80（M10）: 次のレベルまでの残り max(0, expNext − exp)。life を問わない */
  expToNext: number;
  /** CH-80（M10）: レベルアップ可（levelUpReady。life alive かつ exp ≥ expNext）。levelUpView === "ready" と同じ */
  canLevelUp: boolean;
  /**
   * CH-80（M10）: 表示の段。ready = レベルアップ可、next = 残りが 1 以上（life を問わない）、
   * blocked = 残りが 0 だが alive でない（死亡・灰。U9。蘇生すれば ready）
   */
  levelUpView: LevelUpView;
};
export type LevelUpView = "ready" | "next" | "blocked";

export function memberSheet(state: GameState, data: GameData, ch: Character): MemberSheet {
  const es = equipStats(state, data, ch);
  const attackBonus = allyAttackBonus(data, ch, es);
  const expNext = expFor(ch.level + 1, classOf(data, ch.classId), data.config);
  const expToNext = Math.max(0, expNext - ch.exp);
  const canLevelUp = levelUpReady(ch, data);
  return {
    expNext,
    expToNext,
    canLevelUp,
    levelUpView: canLevelUp ? "ready" : expToNext > 0 ? "next" : "blocked",
    stats: es.stats,
    hpMax: es.hpMax,
    mpMax: es.mpMax,
    sanMax: es.sanMax,
    ac: allyAc(state, data, ch),
    magicPower: es.magicPower,
    attackDice: es.weaponDice,
    attackBonus,
    attackDamageDice: weaponDamageDice(es.weaponDice, attackBonus),
  };
}

/** UI-67（M10）: 差分の 1 行。changed は from と to が違うか（表示層は比べない） */
export type EquipPreviewLine<T> = { from: T; to: T; changed: boolean };
/**
 * UI-67（M10）: 装備の差分。ac / magicPower は memberSheet の ac / magicPower、attack は memberSheet の attackDamageDice。
 * cursedWarning は装備しようとする品が鑑定済みかつ呪われているとき真（呪いの警告。未鑑定は CH-76 で装備できないので出ない。外すときは偽）
 */
export type EquipPreview = {
  ac: EquipPreviewLine<number>;
  attack: EquipPreviewLine<string>;
  magicPower: EquipPreviewLine<number>;
  cursedWarning: boolean;
};

function line<T>(from: T, to: T): EquipPreviewLine<T> {
  return { from, to, changed: from !== to };
}

/**
 * UI-67（M10）/ UI-35: 枠 slot に instanceId を装備したとき（null なら枠の品を外したとき）の memberSheet の前後。
 * 求め方は、state の複製（cloneState）に party.equip / party.unequip の処理（equipItem / unequipItem）をそのまま当てて前後の memberSheet を比べる
 * （upgradePreview と同じく、表示の値と処理の結果がずれない）。元の state と乱数は変えない（どちらの処理も乱数を使わない）。
 * checkEquip / checkUnequip が拒む（装備できない・外せない・キャンプの外）か、品の部位が slot でなければ null
 */
export function equipPreview(state: GameState, data: GameData, memberId: string, slot: EquipSlot, instanceId: string | null): EquipPreview | null {
  const ch = memberById(state, memberId);
  if (ch === null) return null;
  if (instanceId === null) {
    if (checkUnequip(state, data, memberId, slot) !== null) return null;
  } else {
    if (checkEquip(state, data, memberId, instanceId) !== null) return null;
    const inst = state.items[instanceId]!;
    if (findBase(data, inst.itemId)?.slot !== slot) return null;
  }
  const copy = cloneState(state);
  const ctx: RuleContext = { state: copy, data, events: [] };
  if (instanceId === null) unequipItem(ctx, memberId, slot);
  else equipItem(ctx, memberId, instanceId);
  const before = memberSheet(state, data, ch);
  const after = memberSheet(copy, data, memberById(copy, memberId)!);
  const inst = instanceId === null ? undefined : state.items[instanceId];
  return {
    ac: line(before.ac, after.ac),
    attack: line(before.attackDamageDice, after.attackDamageDice),
    magicPower: line(before.magicPower, after.magicPower),
    cursedWarning: inst !== undefined && inst.identified && inst.cursed,
  };
}

/**
 * UI-68（M10）/ UI-35: 呪文の説明（キャラクター画面の呪文の段と戦闘の呪文の一覧で共通）。mp は memberId の者が唱えるときの消費（spellCost）。
 * memberId がいないか、spellId が spells.json に無ければ null。本人が覚えているかは見ない
 */
export function spellInfo(state: GameState, data: GameData, memberId: string, spellId: string): SpellInfo | null {
  const ch = memberById(state, memberId);
  const sp = data.spells.find((s) => s.id === spellId);
  if (ch === null || sp === undefined) return null;
  return {
    spellId: sp.id,
    name: sp.name,
    mp: spellCost(state, data, ch, sp),
    target: sp.target,
    usableIn: sp.usableIn,
    description: sp.description,
  };
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
