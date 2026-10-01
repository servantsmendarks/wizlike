// オート入力・行動計画への置き換え・対象の振り替え・行動順・オート解除（CB-11/13/15/40〜43）。
// すべて純粋関数。乱数は使わない。
import type { GameData, StatusId } from "../data/index";
import { itemOf, spellOf } from "../state";
import type { BattleAction, BattleTarget, Character, GameState, Life } from "../types";
import {
  battleItemUsable,
  battleSpellUsable,
  canAct,
  canStrike,
  frontLineIds,
  groupAlive,
  lowestAliveGroup,
  lowestHpRatioAlly,
} from "./combat-calc";
import { sanStage, stageRank } from "./san";

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

function defaultAction(state: GameState, data: GameData, ch: Character): BattleAction {
  const b = state.battle;
  const g = b === null ? null : lowestAliveGroup(b);
  if (g !== null && canStrike(state, data, ch)) return { type: "attack", group: g };
  return { type: "defend" };
}

/** CB-42: 対象の振り替え。振り替え先が無ければ null */
function retarget(state: GameState, t: BattleTarget): BattleTarget | null {
  const b = state.battle;
  if (t.side === "enemy") {
    if (b !== null && groupAlive(b, t.group)) return { side: "enemy", group: t.group };
    const g = b === null ? null : lowestAliveGroup(b);
    return g === null ? null : { side: "enemy", group: g };
  }
  if (t.side === "ally") {
    if (state.party.some((c) => c.id === t.memberId && c.life === "alive")) return { side: "ally", memberId: t.memberId };
    const c = lowestHpRatioAlly(state);
    return c === null ? null : { side: "ally", memberId: c.id };
  }
  return { side: "none" };
}

/**
 * CB-40/42: オートの入力。lastBattleInput を繰り返し、無い・flee・使えない呪文や道具なら既定
 * （canStrike なら最小の生存グループへの攻撃、でなければ防御）。対象は CB-42 で振り替える。
 * MP 不足はここでは見ない（toPlan の CB-41）。flee は返さない。
 */
export function autoInput(state: GameState, data: GameData, ch: Character): BattleAction {
  const a = ch.lastBattleInput;
  if (a === null || a.type === "flee") return defaultAction(state, data, ch);
  switch (a.type) {
    case "defend":
      return { type: "defend" };
    case "attack": {
      const b = state.battle;
      if (b !== null && groupAlive(b, a.group)) return { type: "attack", group: a.group };
      const g = b === null ? null : lowestAliveGroup(b);
      return g === null ? defaultAction(state, data, ch) : { type: "attack", group: g };
    }
    case "cast": {
      if (!ch.knownSpells.includes(a.spellId) || !battleSpellUsable(spellOf(data, a.spellId))) {
        return defaultAction(state, data, ch);
      }
      const t = retarget(state, a.target);
      return t === null ? defaultAction(state, data, ch) : { type: "cast", spellId: a.spellId, target: t };
    }
    case "item": {
      const inst = state.items[a.instanceId];
      if (!ch.inventory.includes(a.instanceId) || inst === undefined || !battleItemUsable(itemOf(data, inst.itemId))) {
        return defaultAction(state, data, ch);
      }
      const t = retarget(state, a.target);
      return t === null ? defaultAction(state, data, ch) : { type: "item", instanceId: a.instanceId, target: t };
    }
  }
  // M5: CB-44 の autoTendency をこの直後に挟む
}

/**
 * CB-13/41: 入力を行動計画にする（ラウンド開始時に全員分を一括で作る）。
 * 後衛の攻撃は防御（backRow）、MP 不足の呪文は canStrike なら攻撃（noMp）、でなければ防御（noMp）。
 */
export function toPlan(
  state: GameState,
  data: GameData,
  ch: Character,
  action: Exclude<BattleAction, { type: "flee" }>,
): AllyPlan {
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
      if (ch.mp < sp.mp) {
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
  // M5: CB-45（SAN の閾値効果）の段をここに足す
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
 * CB-15: 敵の通常攻撃の対象の候補（並び順）。(1) 前衛扱い（CB-14）の行動可能な者、
 * 空なら (2) 前衛扱いの life alive の者、それも空なら (3) life alive の全員【仮・衝突】。
 */
export function enemyTargetIds(state: GameState, data: GameData): string[] {
  const front = frontLineIds(state, data);
  const inFront = state.party.filter((c) => front.includes(c.id));
  const a = inFront.filter(canAct);
  if (a.length > 0) return a.map((c) => c.id);
  const b = inFront.filter((c) => c.life === "alive");
  if (b.length > 0) return b.map((c) => c.id);
  return state.party.filter((c) => c.life === "alive").map((c) => c.id);
}

export function snapMembers(state: GameState, data: GameData): MemberSnap[] {
  return state.party.map((c) => ({
    id: c.id,
    life: c.life,
    hp: c.hp,
    hpMax: c.hpMax,
    status: [...c.status],
    sanRank: stageRank(sanStage(c.san, c.sanMax, data.config)),
  }));
}

/**
 * CB-43: ラウンド開始時の写しとの遷移で判定する。優先 dead > hp > status > san。
 * dead: 前 alive → 後 dead/ash。hp: 前 alive で割合 ≥ hpRatio → 後 alive で < hpRatio。
 * status: 後 alive で、前に無かった状態がある。san: 段階が悪化した。
 */
export function autoInterruptReason(before: MemberSnap[], state: GameState, data: GameData): AutoOffReason | null {
  const ratio = data.config.combat.autoInterrupt.hpRatio;
  let dead = false;
  let hp = false;
  let status = false;
  let san = false;
  for (const prev of before) {
    const c = state.party.find((x) => x.id === prev.id);
    if (c === undefined) continue;
    if (prev.life === "alive" && c.life !== "alive") dead = true;
    if (prev.life === "alive" && c.life === "alive" && prev.hp / prev.hpMax >= ratio && c.hp / c.hpMax < ratio) hp = true;
    if (c.life === "alive" && c.status.some((s) => !prev.status.includes(s))) status = true;
    if (stageRank(sanStage(c.san, c.sanMax, data.config)) > prev.sanRank) san = true;
  }
  if (dead) return "dead";
  if (hp) return "hp";
  if (status) return "status";
  if (san) return "san";
  return null;
}
