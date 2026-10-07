// 戦闘の判定と式（combat.md CB-04/05/13/14/20〜23/26/30/42/50/53、CH-44/60）。
// すべて純粋関数。乱数も RuleContext も使わない（乱数を使う手続きは rules/combat.ts）。
import type { ClassDef, Config, ConsumableItem, GameData, Item, ItemEffect, Spell, SpellTarget, StatusId, WeaponReach } from "../data/index";
import { monsterOf, personalityOf, unknownKindOf } from "../state";
import type { BattleState, Character, EnemyGroup, EnemyGroupView, EnemyUnit, GameState } from "../types";
import { equipStats, type EquipStats } from "./equip-stats";

/** CH-44: 行動不能にする状態異常（毒は含まない） */
export const INCAPACITATING: readonly StatusId[] = ["paralysis", "sleep", "stone"];

/** CH-44: life が alive でない、麻痺・睡眠・石化のどれか、または SAN 0 */
export function isIncapacitated(ch: Character): boolean {
  return ch.life !== "alive" || ch.status.some((s) => INCAPACITATING.includes(s)) || ch.san <= 0;
}

export function canAct(ch: Character): boolean {
  return !isIncapacitated(ch);
}

/** CB-11 / CB-22 / EV-42: 行動者本人の性格の恩恵（initiative / damage）。リーダー（personality null）は 0 */
export function benefitOf(data: GameData, ch: Character, key: "initiative" | "damage"): number {
  return personalityOf(data, ch.personality)?.benefits[key] ?? 0;
}

/**
 * CB-04 / EV-42 / A1: 行動可能な味方のうち性格の benefits.ambushAvoid が最大（> 0）の者とその値。
 * 同値は並び順が前の者。いなければ null（合計しない）
 */
export function ambushAvoider(state: GameState, data: GameData): { ch: Character; value: number } | null {
  let best: { ch: Character; value: number } | null = null;
  for (const ch of state.party) {
    if (!canAct(ch)) continue;
    const v = personalityOf(data, ch.personality)?.benefits.ambushAvoid ?? 0;
    if (v > 0 && (best === null || v > best.value)) best = { ch, value: v };
  }
  return best;
}

/** CB-53: 「睡眠だけ」で止まっている（alive・SAN>0・睡眠あり・麻痺と石化なし） */
export function isSleepOnly(ch: Character): boolean {
  return (
    ch.life === "alive" &&
    ch.san > 0 &&
    ch.status.includes("sleep") &&
    !ch.status.includes("paralysis") &&
    !ch.status.includes("stone")
  );
}

/** CB-25: hp > 0 が生存 */
export function unitAlive(u: EnemyUnit): boolean {
  return u.hp > 0;
}

export function unitCanAct(u: EnemyUnit): boolean {
  return unitAlive(u) && !u.status.some((s) => INCAPACITATING.includes(s));
}

/** 敵の個体の id（表示層の enemyGroupOfId と対） */
export function enemyId(g: number, u: number): string {
  return `e${g}-${u}`;
}

/** CB-02 / CB-67: ランダム遭遇と宝箱の警報の戦闘だけ逃走できる */
export function canFleeOf(b: BattleState): boolean {
  return b.origin.kind === "random" || b.origin.kind === "alarm";
}

/**
 * CB-14: 前衛（添字 0..frontRow-1）に行動可能な者が 1 人でもいればその id、
 * いなければ後衛（添字 frontRow..末尾）の id を前衛として扱う。
 */
export function frontLineIds(state: GameState, data: GameData): string[] {
  const n = data.config.party.frontRow;
  const front = state.party.slice(0, n);
  if (front.some(canAct)) return front.map((c) => c.id);
  return state.party.slice(n).map((c) => c.id);
}

/** CB-13/14: 前衛扱いなら攻撃可、後衛は reach が long / ranged の武器か reachFromBack の品（equipStats の backAttack）のときだけ */
export function canStrike(state: GameState, data: GameData, ch: Character): boolean {
  return frontLineIds(state, data).includes(ch.id) || equipStats(state, data, ch).backAttack;
}

/**
 * CB-20 / IT-24: acBase + 装備の AC（equipStats の acEquip。レベルの効果とオプション ac を含む）+ 戦闘中の補正。
 * M7 で下限（acMin）は撤廃した（命中率の hitMin〜hitMax のクランプに任せる）
 */
export function allyAc(state: GameState, data: GameData, ch: Character): number {
  return data.config.combat.acBase + equipStats(state, data, ch).acEquip + (state.battle?.acBonus[ch.id] ?? 0);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** CB-21/32: 命中率%。睡眠中の対象への補正と、攻撃側のオプション hit（IT-34。bonus）は clamp の内側 */
export function hitPercent(cfg: Config, level: number, targetAc: number, targetAsleep: boolean, bonus = 0): number {
  const c = cfg.combat;
  const raw = c.hitBase + c.hitPerLevel * level + c.hitPerAC * targetAc + (targetAsleep ? c.sleepHitBonus : 0) + bonus;
  return clamp(raw, c.hitMin, c.hitMax);
}

/**
 * CB-21 / CB-26【仮】: 味方の通常攻撃の命中率に足す、武器の reach による補正（hitPercent の bonus に入れる。clamp の内側）。
 * - ranged: (自分の実効の agi − 相手の agi) × rangedHitAgiMul + (自分の実効の luk − rangedHitLukPivot)。飛行かどうかに関係なく常に
 * - 相手が飛行なら flyingHit[reach]（melee −30 / long −15 / ranged 0）
 */
export function reachHitBonus(cfg: Config, reach: WeaponReach, flying: boolean, agi: number, luk: number, targetAgi: number): number {
  const c = cfg.combat;
  const ranged = reach === "ranged" ? (agi - targetAgi) * c.rangedHitAgiMul + (luk - c.rangedHitLukPivot) : 0;
  return ranged + (flying ? c.flyingHit[reach] : 0);
}

/** CB-22: 力補正 floor((str − 10) / 2) */
export function strBonus(str: number): number {
  return Math.floor((str - 10) / 2);
}

/**
 * CB-22: 味方の攻撃ダメージの武器ダイス以外の足し分（力補正 + 性格恩恵 damage + 汎用の武器のレベルの効果とオプション damage）。
 * 戦闘の攻撃（rules/combat.ts）と状態の表示（rules/item-view.ts の memberSheet。UI-59）が同じ式を使う
 */
export function allyAttackBonus(data: GameData, ch: Character, es: Pick<EquipStats, "stats" | "damageBonus">): number {
  return strBonus(es.stats.str) + benefitOf(data, ch, "damage") + es.damageBonus;
}

/** CB-23: attacksPerLevels が 0 なら 1、それ以外 min(maxAttacks, 1 + floor(level / attacksPerLevels)) */
export function attackCount(cls: ClassDef, level: number): number {
  if (cls.attacksPerLevels === 0) return 1;
  return Math.min(cls.maxAttacks, 1 + Math.floor(level / cls.attacksPerLevels));
}

/** CB-30: chance − (luk − 10) × statusLukPerPoint（敵は luk 10） */
export function statusPercent(cfg: Config, chancePct: number, luk: number): number {
  return chancePct - (luk - 10) * cfg.combat.statusLukPerPoint;
}

/** CB-04/50: 行動可能な味方の agi（実効の能力値。CH-13）の平均（小数のまま。0 人なら 0） */
export function partyAgiAvg(state: GameState, data: GameData): number {
  const list = state.party.filter(canAct);
  if (list.length === 0) return 0;
  return list.reduce((a, c) => a + equipStats(state, data, c).stats.agi, 0) / list.length;
}

/** CB-04/50: 生存個体の agi 平均（0 体なら 0） */
export function enemyAgiAvg(state: GameState, data: GameData): number {
  const b = state.battle;
  if (b === null) return 0;
  let sum = 0;
  let n = 0;
  for (const g of b.groups) {
    const agi = monsterOf(data, g.monsterId).agi;
    for (const u of g.units) {
      if (!unitAlive(u)) continue;
      sum += agi;
      n += 1;
    }
  }
  return n === 0 ? 0 : sum / n;
}

/** CB-50: floor(fleeBase + (味方平均 − 敵平均) × fleeAgiMul)。クランプしない */
export function fleePercent(state: GameState, data: GameData): number {
  const c = data.config.combat;
  return Math.floor(c.fleeBase + (partyAgiAvg(state, data) - enemyAgiAvg(state, data)) * c.fleeAgiMul);
}

/**
 * CB-05: identifyChancePerRound + max(0, 行動可能な味方の iq（実効）最大 − 10) × identifyIqPerPoint
 * + 行動可能な味方のオプション identifyRate（IT-34）の合計
 */
export function identifyPercent(state: GameState, data: GameData): number {
  const c = data.config.combat;
  const list = state.party.filter(canAct).map((x) => equipStats(state, data, x));
  const bonus = list.length === 0 ? 0 : Math.max(0, Math.max(...list.map((es) => es.stats.iq)) - 10) * c.identifyIqPerPoint;
  return c.identifyChancePerRound + bonus + list.reduce((a, es) => a + es.identifyRate, 0);
}

/** CB-51 / CB-52: 行動可能な味方のオプション goldLuck（IT-34）の合計（%） */
export function partyGoldLuck(state: GameState, data: GameData): number {
  return state.party.filter(canAct).reduce((a, c) => a + equipStats(state, data, c).goldLuck, 0);
}

/** CB-51 / CB-52 / IT-34: floor(金 × (100 + 金運の合計) ÷ 100)。0 未満にはしない */
export function withGoldLuck(gold: number, luckPct: number): number {
  return Math.max(0, Math.floor((gold * (100 + luckPct)) / 100));
}

/** CH-60: floor(total / alive)。alive 0 なら 0 */
export function expShare(totalExp: number, aliveCount: number): number {
  if (aliveCount <= 0) return 0;
  return Math.floor(totalExp / aliveCount);
}

/** 全個体の hp <= 0 */
export function isVictory(b: BattleState): boolean {
  return b.groups.every((g) => g.units.every((u) => !unitAlive(u)));
}

/** CB-53: 行動可能な者が 0 人、かつ「睡眠だけ」の者も 0 人 */
export function isWipe(state: GameState): boolean {
  return !state.party.some(canAct) && !state.party.some(isSleepOnly);
}

/** CB-25: グループの先頭の生存個体の添字 */
export function firstAliveUnit(group: EnemyGroup): number | null {
  const i = group.units.findIndex(unitAlive);
  return i === -1 ? null : i;
}

/** CB-42: 生存個体のあるグループのうち添字が最小のもの */
export function lowestAliveGroup(b: BattleState): number | null {
  const i = b.groups.findIndex((g) => g.units.some(unitAlive));
  return i === -1 ? null : i;
}

/** グループ g に生存個体があるか（範囲外は偽） */
export function groupAlive(b: BattleState, g: number): boolean {
  const grp = b.groups[g];
  return grp !== undefined && grp.units.some(unitAlive);
}

/** CB-42: life alive のうち hp/hpMax（実効の最大値。CH-14）が最小（同値は並び順で先） */
export function lowestHpRatioAlly(state: GameState, data: GameData): Character | null {
  let best: Character | null = null;
  let bestRatio = Infinity;
  for (const c of state.party) {
    if (c.life !== "alive") continue;
    const max = equipStats(state, data, c).hpMax;
    const r = max > 0 ? c.hp / max : 0;
    if (r < bestRatio) {
      best = c;
      bestRatio = r;
    }
  }
  return best;
}

export function isIdentified(state: GameState, monsterId: string): boolean {
  return state.bestiary[monsterId]?.identified === true;
}

/** CB-05: グループの表示名（鑑定済みなら monsters[].name、未鑑定なら系統 unknown-kinds.json の name） */
export function groupName(state: GameState, data: GameData, g: number): string {
  const b = state.battle;
  const grp = b?.groups[g];
  if (grp === undefined) throw new Error(`groupName: no group ${g}`);
  const m = monsterOf(data, grp.monsterId);
  return isIdentified(state, grp.monsterId) ? m.name : unknownKindOf(data, m.unknownKind).name;
}

/** §7: 全グループを添字順に（体数 0 も残す） */
export function groupViews(state: GameState, data: GameData): EnemyGroupView[] {
  const b = state.battle;
  if (b === null) return [];
  return b.groups.map((grp, index) => ({
    index,
    monsterId: grp.monsterId,
    name: groupName(state, data, index),
    identified: isIdentified(state, grp.monsterId),
    count: grp.units.filter(unitAlive).length,
  }));
}

const ENEMY_SIDE: readonly SpellTarget[] = ["enemy", "enemyGroup", "allEnemies"];
const ALLY_SIDE: readonly SpellTarget[] = ["ally", "party", "self"];

/**
 * F9: 戦闘で使える呪文か。usableIn が field でなく、効果と対象の組み合わせが
 * damage/status × 敵側、heal/acBonus/cureStatus × 味方側、identify × 任意 のどれか。
 */
export function battleSpellUsable(spell: Spell): boolean {
  if (spell.usableIn === "field") return false;
  switch (spell.effect.type) {
    case "damage":
    case "status":
      return ENEMY_SIDE.includes(spell.target);
    case "heal":
    case "acBonus":
    case "cureStatus":
      return ALLY_SIDE.includes(spell.target);
    case "identify":
      return true;
    default:
      return false;
  }
}

/** 戦闘で使える消耗品（効果が heal / cureStatus） */
export type BattleItem = ConsumableItem & { effect: Extract<ItemEffect, { type: "heal" | "cureStatus" }> };

/** F9: 戦闘で使える消耗品か（heal / cureStatus で、対象が味方側）。null（装備。M7 の B2 から items.json に無い）は false */
export function battleItemUsable(item: Item | null): item is BattleItem {
  if (item === null || item.type !== "consumable" || item.usableIn === "field") return false;
  const e = item.effect;
  if (e.type !== "heal" && e.type !== "cureStatus") return false;
  return ALLY_SIDE.includes(e.target);
}

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/**
 * 入力の対象が対象の種類に合うか。
 * enemy/enemyGroup → {side:"enemy", group: 整数・範囲内・生存個体あり}、ally → {side:"ally", memberId: life alive の味方}、
 * allEnemies/party/self/none → {side:"none"}
 */
export function targetMatches(state: GameState, _data: GameData, kind: SpellTarget, t: unknown): boolean {
  if (!isObj(t)) return false;
  switch (kind) {
    case "enemy":
    case "enemyGroup": {
      const b = state.battle;
      const g = t["group"];
      return t["side"] === "enemy" && b !== null && typeof g === "number" && Number.isInteger(g) && groupAlive(b, g);
    }
    case "ally": {
      const id = t["memberId"];
      return t["side"] === "ally" && typeof id === "string" && state.party.some((c) => c.id === id && c.life === "alive");
    }
    case "allEnemies":
    case "party":
    case "self":
    case "none":
      return t["side"] === "none";
  }
}
