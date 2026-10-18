// オート入力（性格傾向・既定の呪文を含む）・行動計画への置き換え・対象の振り替え・行動順・オート解除（CB-11/13/15/40〜46）。
// すべて純粋関数。乱数は使わない。
import type { GameData, Spell, StatusId } from "../data/index";
import { parseDice } from "../rng";
import { classOf, findItem, monsterOf, personalityOf, spellOf } from "../state";
import type { BattleAction, BattleState, BattleTarget, Character, GameState, Life } from "../types";
import {
  battleItemUsable,
  battleSpellUsable,
  canStrike,
  frontLineIds,
  groupAlive,
  lowestAliveGroup,
  lowestHpRatioAlly,
  unitAlive,
} from "./combat-calc";
import { equipStats, hpMaxOf, spellCost } from "./equip-stats";
import { sanCapOf, sanStage, stageRank } from "./san";

/** CB-43 のオート解除の理由。strings: battle.autoReason.<r>。reinforce は M3 では発生源が無い */
export type AutoOffReason = "dead" | "hp" | "status" | "reinforce" | "san";

/** ラウンド開始時に確定する 1 人分の行動計画（CB-13/41） */
export type AllyPlan =
  | { kind: "attack"; memberId: string; group: number; noMp: boolean }
  | { kind: "cast"; memberId: string; spellId: string; target: BattleTarget }
  | { kind: "item"; memberId: string; instanceId: string; target: BattleTarget }
  | { kind: "defend"; memberId: string; why: "chosen" | "backRow" | "noMp" };

/** 効果の対象の 1 つ（敵は個体の位置、味方は id） */
export type TargetRef = { side: "enemy"; g: number; u: number } | { side: "ally"; id: string };

/** CB-43 用のラウンド開始時の写し */
export type MemberSnap = { id: string; life: Life; hp: number; hpMax: number; status: StatusId[]; sanRank: number };

/**
 * CB-40 / CB-46 / CB-26: lastBattleInput が無いときの既定。CB-46 の呪文（職業の系統で分ける。治癒 → 攻撃呪文の順）が
 * 当てはまらなければ（CB-47: spells が偽なら CB-46 を見ない）、canStrike かつ生存グループがあれば、その最小への攻撃（飛行も対象。届かない相手は無い）。無ければ防御
 */
function defaultAction(state: GameState, data: GameData, ch: Character, spells: boolean): BattleAction {
  const b = state.battle;
  const spell = spells ? autoSpellAction(state, data, ch) : null; // CB-47: 設定「オートの呪文: 使わない」なら CB-46 を見ない
  if (spell !== null) return spell;
  const g = b === null ? null : lowestAliveGroup(b);
  if (g !== null && canStrike(state, data, ch)) return { type: "attack", group: g };
  return { type: "defend" };
}

/** CB-46: knownSpells のうち戦闘で使え（battleSpellUsable）、pick に合う呪文で spellCost が最小のもの（同値は knownSpells の順）と、その消費 */
function cheapestSpell(state: GameState, data: GameData, ch: Character, pick: (sp: Spell) => boolean): { sp: Spell; cost: number } | null {
  let best: { sp: Spell; cost: number } | null = null;
  for (const id of ch.knownSpells) {
    const sp = spellOf(data, id);
    if (!battleSpellUsable(sp) || !pick(sp)) continue;
    const cost = spellCost(state, data, ch, sp);
    if (best === null || cost < best.cost) best = { sp, cost };
  }
  return best;
}

/**
 * CB-46（M19）【仮】: オートの既定の呪文。乱数は使わない。
 * 1. 治癒の系統（職業の spells に priest がある。僧侶・司教・君主）: life alive の味方に hp < hpMax × auto.healBelowRatio の者がいて、
 *    最も安い治癒の呪文（effect heal・target ally）の MP（spellCost）があれば、HP の割合が最も低い者（同率は並び順）に唱える。
 * 2. 攻撃の系統（職業の spells に mage がある。魔術師・司教・侍）: 生存の敵の個体の総数が auto.attackSpellMinEnemies 以上で、
 *    最も安い攻撃呪文（effect damage）を唱えた後の MP が mpMax（実効）× auto.attackSpellMpRatio 以上（mp − cost >= mpMax × ratio。M20）なら唱える。
 *    対象は enemy・enemyGroup なら最小の生存グループ、allEnemies なら none。
 * 司教は 1 → 2 の順。どちらも当てはまらなければ null
 */
function autoSpellAction(state: GameState, data: GameData, ch: Character): BattleAction | null {
  const b = state.battle;
  if (b === null) return null;
  const cls = classOf(data, ch.classId);
  const cfg = data.config.auto;
  if (cls.spells.priest !== undefined) {
    const heal = cheapestSpell(state, data, ch, (sp) => sp.effect.type === "heal" && sp.target === "ally");
    if (heal !== null && ch.mp >= heal.cost) {
      let target: Character | null = null;
      let low = Infinity;
      for (const c of state.party) {
        if (c.life !== "alive") continue;
        const max = hpMaxOf(state, data, c);
        const r = max > 0 ? c.hp / max : 0;
        if (c.hp < max * cfg.healBelowRatio && r < low) {
          target = c;
          low = r;
        }
      }
      if (target !== null) return { type: "cast", spellId: heal.sp.id, target: { side: "ally", memberId: target.id } };
    }
  }
  if (cls.spells.mage !== undefined) {
    const enemies = b.groups.reduce((n, grp) => n + grp.units.filter(unitAlive).length, 0);
    const atk = cheapestSpell(state, data, ch, (sp) => sp.effect.type === "damage");
    const g = lowestAliveGroup(b);
    if (
      atk !== null &&
      g !== null &&
      enemies >= cfg.attackSpellMinEnemies &&
      ch.mp - atk.cost >= equipStats(state, data, ch).mpMax * cfg.attackSpellMpRatio
    ) {
      const target: BattleTarget = atk.sp.target === "allEnemies" ? { side: "none" } : { side: "enemy", group: g };
      return { type: "cast", spellId: atk.sp.id, target };
    }
  }
  return null;
}

/** CB-42: 対象の振り替え。振り替え先が無ければ null */
function retarget(state: GameState, data: GameData, t: BattleTarget): BattleTarget | null {
  const b = state.battle;
  if (t.side === "enemy") {
    if (b !== null && groupAlive(b, t.group)) return { side: "enemy", group: t.group };
    const g = b === null ? null : lowestAliveGroup(b);
    return g === null ? null : { side: "enemy", group: g };
  }
  if (t.side === "ally") {
    if (state.party.some((c) => c.id === t.memberId && c.life === "alive")) return { side: "ally", memberId: t.memberId };
    const c = lowestHpRatioAlly(state, data);
    return c === null ? null : { side: "ally", memberId: c.id };
  }
  return { side: "none" };
}

/**
 * CB-40/42/44: オートの入力（battle.repeat も使う）。基本の入力（baseAutoInput）に性格傾向（CB-44）を掛ける。
 * MP 不足はここでは見ない（toPlan の CB-41）。
 * CB-47（M21）: spells は設定「オートの呪文」（BattleState.autoSpells / battle.repeat の spells。省略は真）。偽なら既定に落ちたときに
 * CB-46 の呪文を選ばない。手入力の呪文の繰り返し（lastBattleInput）は設定の対象外で、偽でも繰り返す
 */
export function autoInput(state: GameState, data: GameData, ch: Character, spells = true): BattleAction {
  return applyAutoTendency(state, data, ch, baseAutoInput(state, data, ch, spells));
}

/**
 * CB-40/42: 基本のオート入力。lastBattleInput を繰り返し、無い・使えない呪文や道具なら既定
 * （CB-46 の呪文、当てはまらなければ canStrike なら最小の生存グループへの攻撃、でなければ防御）。対象は CB-42 で振り替える。
 */
function baseAutoInput(state: GameState, data: GameData, ch: Character, spells: boolean): BattleAction {
  const a = ch.lastBattleInput;
  if (a === null) return defaultAction(state, data, ch, spells);
  switch (a.type) {
    case "defend":
      return { type: "defend" };
    case "attack": {
      // CB-42: 前回のグループが生きていればそのまま、でなければ最小の生存グループ（CB-26: 飛行も対象）
      const b = state.battle;
      if (b !== null && groupAlive(b, a.group)) return { type: "attack", group: a.group };
      const g = b === null ? null : lowestAliveGroup(b);
      return g === null ? defaultAction(state, data, ch, spells) : { type: "attack", group: g };
    }
    case "cast": {
      if (!ch.knownSpells.includes(a.spellId) || !battleSpellUsable(spellOf(data, a.spellId))) {
        return defaultAction(state, data, ch, spells);
      }
      const t = retarget(state, data, a.target);
      return t === null ? defaultAction(state, data, ch, spells) : { type: "cast", spellId: a.spellId, target: t };
    }
    case "item": {
      const inst = state.items[a.instanceId];
      if (!ch.inventory.includes(a.instanceId) || inst === undefined || !battleItemUsable(findItem(data, inst.itemId))) {
        return defaultAction(state, data, ch, spells);
      }
      const t = retarget(state, data, a.target);
      return t === null ? defaultAction(state, data, ch, spells) : { type: "item", instanceId: a.instanceId, target: t };
    }
  }
}

/**
 * CB-44: 生存個体のあるグループのうち、gold の期待値 × 生存個体数が最大のグループの添字（同値は添字の小さい方）。
 * 比べる値は期待値の 2 倍の整数 (count × (sides + 1) + 2 × modifier) × 生存個体数。生存グループが無ければ null
 */
export function richestGroup(b: BattleState, data: GameData): number | null {
  let best: number | null = null;
  let bestV = 0;
  for (let g = 0; g < b.groups.length; g++) {
    const grp = b.groups[g]!;
    const alive = grp.units.filter(unitAlive).length;
    if (alive === 0) continue;
    const d = parseDice(monsterOf(data, grp.monsterId).gold);
    const v = (d.count * (d.sides + 1) + 2 * d.modifier) * alive;
    if (best === null || v > bestV) {
      best = g;
      bestV = v;
    }
  }
  return best;
}

/**
 * CB-44【仮】: オート入力に性格傾向を掛ける（乱数なし）。
 * - defendBelowHalf（慎重）: hp < hpMax × combat.autoDefendHpRatio なら防御
 * - alwaysAttack（無鉄砲）: 基本の入力が防御のときだけ攻撃に置き換える（前回の攻撃の対象グループが生きていればそれ、
 *   無ければ最小の生存グループ。生存グループが無ければ防御のまま）。呪文・道具・攻撃はそのまま。後衛は toPlan で防御（CB-13）
 * - targetRichest（強欲）: 攻撃の対象を richestGroup に変える（呪文・道具は変えない）
 * - none（普通）・リーダー: そのまま
 */
function applyAutoTendency(state: GameState, data: GameData, ch: Character, a: BattleAction): BattleAction {
  const b = state.battle;
  if (b === null) return a;
  switch (personalityOf(data, ch.personality)?.autoBattle ?? "none") {
    case "defendBelowHalf":
      return ch.hp < hpMaxOf(state, data, ch) * data.config.combat.autoDefendHpRatio ? { type: "defend" } : a;
    case "alwaysAttack": {
      if (a.type !== "defend") return a;
      const last = ch.lastBattleInput;
      const g = last !== null && last.type === "attack" && groupAlive(b, last.group) ? last.group : lowestAliveGroup(b);
      return g === null ? a : { type: "attack", group: g };
    }
    case "targetRichest": {
      if (a.type !== "attack") return a;
      return { type: "attack", group: richestGroup(b, data) ?? a.group };
    }
    case "none":
      return a;
  }
}

/**
 * CB-13/41: 入力を行動計画にする（ラウンド開始時に全員分を一括で作る）。
 * 後衛の攻撃は防御（backRow）、MP 不足の呪文は canStrike なら攻撃（noMp）、でなければ防御（noMp）。
 */
export function toPlan(state: GameState, data: GameData, ch: Character, action: BattleAction): AllyPlan {
  const memberId = ch.id;
  switch (action.type) {
    case "defend":
      return { kind: "defend", memberId, why: "chosen" };
    case "attack":
      return canStrike(state, data, ch)
        ? { kind: "attack", memberId, group: action.group, noMp: false }
        : { kind: "defend", memberId, why: "backRow" };
    case "cast": {
      const sp = spellOf(data, action.spellId);
      if (ch.mp < spellCost(state, data, ch, sp)) { // MG-30 / IT-40
        const b = state.battle;
        const g = b === null ? null : lowestAliveGroup(b);
        if (g !== null && canStrike(state, data, ch)) return { kind: "attack", memberId, group: g, noMp: true };
        return { kind: "defend", memberId, why: "noMp" };
      }
      return { kind: "cast", memberId, spellId: action.spellId, target: action.target };
    }
    case "item":
      return { kind: "item", memberId, instanceId: action.instanceId, target: action.target };
  }
}

/**
 * CB-11: init の降順の安定ソート。入力の並び（味方の並び順 → 敵のグループ → 個体）が
 * そのまま同値時の順になる（味方優先）。
 */
export function orderActors<T>(entries: { actor: T; init: number }[]): { actor: T; init: number }[] {
  return entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => b.e.init - a.e.init || a.i - b.i)
    .map((x) => x.e);
}

/**
 * CB-15: 敵の通常攻撃の対象の候補（並び順）。前衛扱い（CB-14）のうち生存者（life alive で石化していない者）。
 * 睡眠・麻痺の者も含む（行動可能かどうかは問わない。ユーザー決定）。空なら呼び出し側は何もしない。
 */
export function enemyTargetIds(state: GameState, data: GameData): string[] {
  const front = frontLineIds(state, data);
  return state.party
    .filter((c) => front.includes(c.id) && c.life === "alive" && !c.status.includes("stone"))
    .map((c) => c.id);
}

export function snapMembers(state: GameState, data: GameData): MemberSnap[] {
  return state.party.map((c) => ({
    id: c.id,
    life: c.life,
    hp: c.hp,
    hpMax: hpMaxOf(state, data, c),
    status: [...c.status],
    sanRank: stageRank(sanStage(c.san, sanCapOf(state, data, c), data.config)),
  }));
}

/** CB-43b: 解除の理由と、その対象（dead / hp のときだけ id） */
export type AutoInterrupt = { reason: AutoOffReason; id?: string };

/**
 * CB-43: ラウンド開始時の写しとの遷移で判定する。優先 dead > hp > status > san。
 * dead: 前 alive → 後 dead/ash。hp: 前 alive で割合 ≥ hpRatio → 後 alive で < hpRatio。
 * status: 後 alive で、前に無かった状態がある。san: 段階が悪化した。
 * CB-43b: dead は今回 dead になった者の先頭、hp は今回下回った者のうち割合が最も低い者（同じなら並び順）を id で返す。
 */
export function autoInterruptReason(before: MemberSnap[], state: GameState, data: GameData): AutoInterrupt | null {
  const ratio = data.config.combat.autoInterrupt.hpRatio;
  let deadId: string | undefined;
  let hpId: string | undefined;
  let hpLowest = Infinity;
  let status = false;
  let san = false;
  for (const prev of before) {
    const c = state.party.find((x) => x.id === prev.id);
    if (c === undefined) continue;
    if (prev.life === "alive" && c.life !== "alive" && deadId === undefined) deadId = c.id;
    if (prev.life === "alive" && c.life === "alive" && prev.hp / prev.hpMax >= ratio) {
      const now = c.hp / hpMaxOf(state, data, c);
      if (now < ratio && now < hpLowest) {
        hpLowest = now;
        hpId = c.id;
      }
    }
    if (c.life === "alive" && c.status.some((s) => !prev.status.includes(s))) status = true;
    if (stageRank(sanStage(c.san, sanCapOf(state, data, c), data.config)) > prev.sanRank) san = true;
  }
  if (deadId !== undefined) return { reason: "dead", id: deadId };
  if (hpId !== undefined) return { reason: "hp", id: hpId };
  if (status) return { reason: "status" };
  if (san) return { reason: "san" };
  return null;
}
