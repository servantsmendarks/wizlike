// 実効の値（IT-34 / IT-35、CH-13 / CH-14、IT-20〜23、MG-33、CB-20〜22）。純粋。乱数も RuleContext も使わない。
// 能力値・最大値・AC・武器・魔法攻撃力・オプションの加算を計算するのはこのファイルだけ。ルールはここから読む（表示層は計算しない。UI-35）。
// 装備中の品は、鑑定の有無に関係なく効く（IT-34）。state.items に無い id（表示層が古い写しの Character を渡した場合など）は飛ばす。
import type { EquipmentBase, GameData, SkillType, Spell, StatBlock, StatusId, WeaponBase, WeaponReach } from "../data/index";
import { EQUIP_SLOTS, STAT_KEYS, STATUS_IDS } from "../data/index";
import { findBase, moraleOf, optionOf, uniqueOf } from "../state";
import type { Character, GameState, ItemInstance, RuleContext } from "../types";

/** IT-40: 装備中のユニークの固有スキル 1 つ */
export type EquipSkill = { type: SkillType; value: number; instanceId: string };

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
  /** MG-33 / IT-22: 汎用の術者用武器のベースの magicPower + floor(Lv ÷ casterLvPerPower)、ユニークはユニークの magicPower、+ オプション magicPower の合計（IT-34。M10）。下限 0 */
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
  /** IT-25 / CB-21 / CB-26: 装備中の武器の reach（ユニークはベースの値。素手は melee） */
  reach: WeaponReach;
  /** CB-13: 武器の reach が long か ranged、または固有スキル reachFromBack（IT-40）の品を装備している（後衛から攻撃できる） */
  backAttack: boolean;
  /** IT-40: 装備中のユニークの固有スキル（EQUIP_SLOTS の順。instanceId はその品の実体） */
  skills: EquipSkill[];
};

/**
 * IT-03 / IT-20〜23: 装備 1 つの性能（オプションを除く）。equipStats と品の詳細（rules/item-view.ts）が同じ式を使う。
 * - weapon: dice（ユニークはユニークの damage）、damageBonus（汎用の術者用でない武器の floor(Lv ÷ weaponLvPerDamage)。IT-20）、
 *   magicPower（汎用の術者用武器のベースの magicPower（省略は 0）+ floor(Lv ÷ casterLvPerPower)、ユニークはユニークの magicPower。IT-22）、
 *   reach（省略は melee。IT-25）/ caster はベースの値
 * - それ以外: ac（ユニークはユニークの ac、汎用はベースの ac − 装飾以外の floor(Lv ÷ armorLvPerAc)。IT-21 / IT-23）
 * ユニークはレベルの効果を持たない（IT-03）
 */
export type ItemPower =
  | { kind: "weapon"; dice: string; damageBonus: number; magicPower: number; reach: WeaponReach; caster: boolean }
  | { kind: "armor"; ac: number };

/** IT-25: 武器のベースの reach（省略は melee） */
export function weaponReach(base: WeaponBase): WeaponReach {
  return base.reach ?? "melee";
}

export function itemPower(data: GameData, inst: ItemInstance, base: EquipmentBase): ItemPower {
  const ic = data.config.items;
  const uniq = inst.uniqueId === null ? null : uniqueOf(data, inst.uniqueId);
  if (base.slot === "weapon") {
    const generic = uniq === null;
    return {
      kind: "weapon",
      dice: uniq?.damage ?? base.damage,
      damageBonus: generic && !base.caster ? Math.floor(inst.level / ic.weaponLvPerDamage) : 0,
      magicPower: uniq !== null ? (uniq.magicPower ?? 0) : base.caster ? (base.magicPower ?? 0) + Math.floor(inst.level / ic.casterLvPerPower) : 0,
      reach: weaponReach(base),
      caster: base.caster,
    };
  }
  const lv = uniq === null && base.slot !== "accessory" ? Math.floor(inst.level / ic.armorLvPerAc) : 0;
  return { kind: "armor", ac: (uniq?.ac ?? base.ac) - lv };
}

/** IT-35: ch の実効の値。装備は EQUIP_SLOTS の順に見る（武器は weapon の枠だけ） */
export function equipStats(state: GameState, data: GameData, ch: Character): EquipStats {
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
  let reach: WeaponReach = "melee";
  const skills: EquipSkill[] = [];
  for (const slot of EQUIP_SLOTS) {
    const id = ch.equipment[slot];
    if (id === null) continue;
    const inst = state.items[id];
    if (inst === undefined) continue;
    const base = findBase(data, inst.itemId);
    if (base === null) continue;
    const perf = itemPower(data, inst, base);
    if (perf.kind === "weapon") {
      weaponDice = perf.dice;
      reach = perf.reach;
      magicPower += perf.magicPower;
      damageBonus += perf.damageBonus;
    } else {
      acEquip += perf.ac;
    }
    if (inst.uniqueId !== null) {
      const uniq = uniqueOf(data, inst.uniqueId);
      skills.push({ type: uniq.skill.type, value: uniq.skill.value, instanceId: id }); // IT-40
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
        case "magicPower":
          magicPower += v; // IT-34 / MG-33（M10）: 全部位の合計。最後に 0 未満にしない
          break;
        case "goldLuck":
          goldLuck += v;
          break;
        default: {
          const unreachable: never = e; // OPTION_EFFECT_TYPES を足して case を書き忘れたらここで型エラーになる
          throw new Error(`unknown option effect: ${JSON.stringify(unreachable)}`);
        }
      }
    }
  }
  const stats = Object.fromEntries(STAT_KEYS.map((k) => [k, Math.max(1, ch.stats[k] + statAdd[k])])) as StatBlock;
  return {
    stats,
    hpMax: Math.max(1, ch.hpMax + hpAdd),
    mpMax: ch.mpMax === 0 ? 0 : Math.max(1, ch.mpMax + mpAdd), // CH-14: 素が 0 なら正のオプションでも 0
    sanMax: Math.max(0, ch.sanMax + sanAdd),
    acEquip,
    weaponDice,
    damageBonus,
    magicPower: Math.max(0, magicPower), // IT-34 / MG-33: 負のオプションでも合計は 0 未満にしない
    hit,
    initiative,
    fearLossPct,
    trapDetect,
    identifyRate,
    goldLuck,
    statusResist,
    reach,
    backAttack: reach !== "melee" || skills.some((x) => x.type === "reachFromBack"), // CB-13 / IT-40
    skills,
  };
}

/** IT-40: 装備中のその種類の固有スキルの value の合計（無ければ 0） */
export function skillTotal(es: EquipStats, type: SkillType): number {
  return es.skills.reduce((a, x) => (x.type === type ? a + x.value : a), 0);
}

/** IT-40: その種類の固有スキルの品を装備しているか（value を使わない reachFromBack / fearImmune / autoIdentify） */
export function hasSkill(es: EquipStats, type: SkillType): boolean {
  return es.skills.some((x) => x.type === type);
}

/**
 * MG-30 / IT-40: ch が spell を唱えるときの MP の消費。固有スキル mpCostDown を装備していれば min(spells[].mp, max(1, spells[].mp − 値))、
 * そうでなければ spells[].mp（戦闘・dungeon.cast・入力の検査・問い合わせで同じ値を使う）
 */
export function spellCost(state: GameState, data: GameData, ch: Character, spell: Spell): number {
  const down = skillTotal(equipStats(state, data, ch), "mpCostDown");
  return down > 0 ? Math.min(spell.mp, Math.max(1, spell.mp - down)) : spell.mp; // 元の消費より増やさない（mp 0 の呪文は 0）
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
