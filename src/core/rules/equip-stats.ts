// 実効の値（IT-34 / IT-35、CH-13 / CH-14、IT-20〜23、MG-33、CB-20〜22）。純粋。乱数も RuleContext も使わない。
// 能力値・最大値・AC・武器・魔法攻撃力・オプションの加算を計算するのはこのファイルだけ。ルールはここから読む（表示層は計算しない。UI-35）。
// 装備中の品は、鑑定の有無に関係なく効く（IT-34）。state.items に無い id（表示層が古い写しの Character を渡した場合など）は飛ばす。
import type { GameData, StatBlock, StatusId } from "../data/index";
import { EQUIP_SLOTS, STAT_KEYS, STATUS_IDS } from "../data/index";
import { findBase, moraleOf, optionOf, uniqueOf } from "../state";
import type { Character, GameState, RuleContext } from "../types";

export type EquipStats = {
  /** CH-13: 素 + オプション stat。下限 1、上限なし */
  stats: StatBlock;
  /** CH-14: 素 + オプション hpMax。下限 1 */
  hpMax: number;
  /** CH-14: 素 + オプション mpMax。素が 1 以上なら下限 1、素が 0（呪文を使わない職業）なら下限 0 */
  mpMax: number;
  /** CH-14: 素 + オプション sanMax。下限 0 */
  sanMax: number;
  /** CB-20: 装備の ac の合計 − 汎用の防具類の floor(Lv ÷ armorLvPerAc) − オプション ac（acBase と戦闘中の補正は含めない） */
  acEquip: number;
  /** CB-22: 武器のダイス（ユニークはユニークの damage、素手は combat.unarmedDice） */
  weaponDice: string;
  /** CB-22 / IT-20: 汎用の武器（術者用でない）の floor(Lv ÷ weaponLvPerDamage) + オプション damage */
  damageBonus: number;
  /** MG-33 / IT-22: 汎用の術者用武器の floor(Lv ÷ casterLvPerPower) + ユニークの magicPower */
  magicPower: number;
  /** CB-21: オプション hit の合計（%） */
  hit: number;
  /** CB-11: オプション initiative の合計 */
  initiative: number;
  /** CB-31 / CH-54: オプション fearLoss の合計（%。正で減少が減る） */
  fearLossPct: number;
  /** DG-21: オプション trapDetect の合計（%） */
  trapDetect: number;
  /** CB-05: オプション identifyRate の合計（%） */
  identifyRate: number;
  /** CB-51 / CB-52: オプション goldLuck の合計（%） */
  goldLuck: number;
  /** CB-30: 状態ごとのオプション statusResist の合計（%。付与の確率から引く） */
  statusResist: Record<StatusId, number>;
  /** CB-13: 武器の ranged */
  ranged: boolean;
};

/** IT-35: ch の実効の値。装備は EQUIP_SLOTS の順に見る（武器は weapon の枠だけ） */
export function equipStats(state: GameState, data: GameData, ch: Character): EquipStats {
  const ic = data.config.items;
  const statAdd = Object.fromEntries(STAT_KEYS.map((k) => [k, 0])) as StatBlock;
  const statusResist = Object.fromEntries(STATUS_IDS.map((s) => [s, 0])) as Record<StatusId, number>;
  let hpAdd = 0;
  let mpAdd = 0;
  let sanAdd = 0;
  let acEquip = 0;
  let weaponDice = data.config.combat.unarmedDice;
  let damageBonus = 0;
  let magicPower = 0;
  let hit = 0;
  let initiative = 0;
  let fearLossPct = 0;
  let trapDetect = 0;
  let identifyRate = 0;
  let goldLuck = 0;
  let ranged = false;
  for (const slot of EQUIP_SLOTS) {
    const id = ch.equipment[slot];
    if (id === null) continue;
    const inst = state.items[id];
    if (inst === undefined) continue;
    const base = findBase(data, inst.itemId);
    if (base === null) continue;
    const uniq = inst.uniqueId === null ? null : uniqueOf(data, inst.uniqueId);
    if (base.slot === "weapon") {
      weaponDice = uniq?.damage ?? base.damage;
      ranged = base.ranged;
      if (uniq !== null) magicPower += uniq.magicPower ?? 0; // IT-03: ユニークはレベルの効果を持たない
      else if (base.caster) magicPower += Math.floor(inst.level / ic.casterLvPerPower); // IT-22
      else damageBonus += Math.floor(inst.level / ic.weaponLvPerDamage); // IT-20
    } else {
      acEquip += uniq?.ac ?? base.ac;
      if (uniq === null && base.slot !== "accessory") acEquip -= Math.floor(inst.level / ic.armorLvPerAc); // IT-21 / IT-23
    }
    for (const roll of inst.options) {
      const e = optionOf(data, roll.optionId).effect;
      const v = roll.value;
      switch (e.type) {
        case "stat":
          statAdd[e.stat] += v;
          break;
        case "statusResist":
          statusResist[e.status] += v;
          break;
        case "hpMax":
          hpAdd += v;
          break;
        case "mpMax":
          mpAdd += v;
          break;
        case "sanMax":
          sanAdd += v;
          break;
        case "hit":
          hit += v;
          break;
        case "damage":
          damageBonus += v;
          break;
        case "ac":
          acEquip -= v; // IT-34: 値は AC を下げる量
          break;
        case "initiative":
          initiative += v;
          break;
        case "fearLoss":
          fearLossPct += v;
          break;
        case "trapDetect":
          trapDetect += v;
          break;
        case "identifyRate":
          identifyRate += v;
          break;
        case "goldLuck":
          goldLuck += v;
          break;
      }
    }
  }
  const stats = Object.fromEntries(STAT_KEYS.map((k) => [k, Math.max(1, ch.stats[k] + statAdd[k])])) as StatBlock;
  return {
    stats,
    hpMax: Math.max(1, ch.hpMax + hpAdd),
    mpMax: Math.max(Math.min(1, ch.mpMax), ch.mpMax + mpAdd),
    sanMax: Math.max(0, ch.sanMax + sanAdd),
    acEquip,
    weaponDice,
    damageBonus,
    magicPower,
    hit,
    initiative,
    fearLossPct,
    trapDetect,
    identifyRate,
    goldLuck,
    statusResist,
    ranged,
  };
}

/** CH-13: 実効の能力値（equipStats の stats） */
export function effectiveStats(state: GameState, data: GameData, ch: Character): StatBlock {
  return equipStats(state, data, ch).stats;
}

/** CH-14: 実効の hpMax */
export function hpMaxOf(state: GameState, data: GameData, ch: Character): number {
  return equipStats(state, data, ch).hpMax;
}

/**
 * CH-14: 装備の付け外し（と寺院の解呪で品を失ったとき）の後に、hp / mp / san を実効の最大値で止める（増えたときは変えない）。
 * SAN の上限は実効の sanMax で、宿の士気（TW-15）の間は + sanOver。変わった値ごとに hpChanged / mpChanged / sanChanged を出す
 */
export function clampToMax(ctx: RuleContext, ch: Character): void {
  const { state, data, events } = ctx;
  const es = equipStats(state, data, ch);
  if (ch.hp > es.hpMax) {
    events.push({ kind: "hpChanged", id: ch.id, delta: es.hpMax - ch.hp, hp: es.hpMax });
    ch.hp = es.hpMax;
  }
  if (ch.mp > es.mpMax) {
    events.push({ kind: "mpChanged", id: ch.id, delta: es.mpMax - ch.mp, mp: es.mpMax });
    ch.mp = es.mpMax;
  }
  const sanCap = es.sanMax + (moraleOf(state, data)?.sanOver ?? 0);
  if (ch.san > sanCap) {
    events.push({ kind: "sanChanged", id: ch.id, delta: sanCap - ch.san, san: sanCap });
    ch.san = sanCap;
  }
}
