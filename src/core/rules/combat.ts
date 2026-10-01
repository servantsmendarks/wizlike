// 戦闘の手続き（combat.md CB-01〜54、MG-30/41、CH-43〜45/60）と、入力の検査、表示層向けの問い合わせ battleMenu。
// 判定と式は combat-calc.ts、オート入力・行動計画・行動順・オート解除は combat-plan.ts（どちらも純粋）。
// dungeon.ts は import しない（dungeon.ts がこのファイルを使う。循環を作らない）。
//
// 乱数の消費順（テストで固定する）:
//   遭遇: [グループ数] → ([種類] → [体数])×グループ → HP（g→u）→ 味方 1d10 → 敵 1d10 →（敵の奇襲ならそのラウンド）
//   ボス: groupSize（定数 "1" は消費なし）→ HP → 先手 2 個
//   ラウンド（battle.resolve / battle.repeat）: initiative（味方の計画の順 → ラウンド開始時に行動可能な敵の個体の g → u）
//     → 行動順に各行動
//   逃走（battle.flee）: d100 →（失敗なら）initiative（敵だけ）→ 敵の行動 → ラウンド終了
//     味方の攻撃 1 振り: 命中 → [ダメージ] → [覚醒]
//     敵の攻撃要素: 対象 → 命中 → [ダメージ] → [覚醒] → [付与]
//     呪文・道具: 個体ごとのダメージ（→ 覚醒）・付与、回復のダイス
//   → ラウンド終了の鑑定（g 順）→（勝利なら）金（g→u）→ 宝箱 d100 → 宝箱の金
//   免疫・既に同じ状態・対象なしは消費しない。
import type { GameData, Spell, SpellEffect, SpellTarget, StatusId } from "../data/index";
import { chance, randInt, rollDice, rollDie, weightedIndex } from "../rng";
import { classOf, destroyItemInstance, dungeonOf, itemDisplayName, itemOf, memberById, monsterOf, spellOf } from "../state";
import type {
  BattleAction,
  BattleMenu,
  BattleOrigin,
  BattleState,
  BattleTarget,
  Character,
  Dive,
  EnemyGroup,
  EnemyUnit,
  GameState,
  RuleContext,
} from "../types";
import {
  allyAc,
  attackCount,
  battleItemUsable,
  battleSpellUsable,
  canAct,
  canFleeOf,
  canStrike,
  enemyAgiAvg,
  enemyId,
  expShare,
  firstAliveUnit,
  fleePercent,
  groupAlive,
  groupName,
  groupViews,
  hitPercent,
  identifyPercent,
  isIdentified,
  isVictory,
  isWipe,
  lowestAliveGroup,
  lowestHpRatioAlly,
  partyAgiAvg,
  statusPercent,
  strBonus,
  targetMatches,
  unitAlive,
  unitCanAct,
  weaponOf,
} from "./combat-calc";
import type { BattleItem } from "./combat-calc";
import type { AllyPlan, MemberSnap, TargetRef } from "./combat-plan";
import { autoInput, autoInterruptReason, enemyTargetIds, orderActors, snapMembers, toPlan } from "./combat-plan";
import { applyAllyEffect } from "./effects";
import { loseSan } from "./san";

function requireBattle(state: GameState): BattleState {
  if (state.battle === null) throw new Error("not in battle");
  return state.battle;
}

function requireDive(state: GameState): Dive {
  if (state.dive === null) throw new Error("not in dungeon");
  return state.dive;
}

function requireMember(state: GameState, id: string): Character {
  const ch = memberById(state, id);
  if (ch === null) throw new Error(`unknown member: ${id}`);
  return ch;
}

function unitAt(b: BattleState, g: number, u: number): EnemyUnit {
  const unit = b.groups[g]?.units[u];
  if (unit === undefined) throw new Error(`no enemy unit ${g}-${u}`);
  return unit;
}

function groupAt(b: BattleState, g: number): EnemyGroup {
  const grp = b.groups[g];
  if (grp === undefined) throw new Error(`no enemy group ${g}`);
  return grp;
}

// ---------------------------------------------------------------------------
// 遭遇の開始（CB-01〜06、DG-31）

/** CB-01/03: ランダム遭遇。グループ数と種類は重みづけの抽選、体数は groupSize を 1..maxPerGroup にクランプ */
export function startRandomEncounter(ctx: RuleContext, inRoom: boolean): void {
  const { state, data } = ctx;
  const dive = requireDive(state);
  const def = dungeonOf(data, dive.dungeonId);
  const key = String(dive.floor);
  const weights = def.groupCountWeights[key];
  const table = def.encounterTable[key];
  if (weights === undefined || table === undefined) throw new Error(`no encounter table for ${def.id} floor ${key}`);
  const cfg = data.config.combat;
  const n = Math.min(cfg.maxEnemyGroups, weightedIndex(state.rng, weights) + 1);
  const specs: { monsterId: string; count: number }[] = [];
  const tableWeights = table.map((x) => x.weight);
  for (let i = 0; i < n; i++) {
    const e = table[weightedIndex(state.rng, tableWeights)];
    if (e === undefined) throw new Error("startRandomEncounter: bad table index");
    const m = monsterOf(data, e.monster);
    const count = Math.min(cfg.maxPerGroup, Math.max(1, rollDice(state.rng, m.groupSize).total));
    specs.push({ monsterId: m.id, count });
  }
  startBattle(ctx, { kind: "random", inRoom }, specs);
}

/** DG-31: ボスの固定遭遇（逃走不可） */
export function startBossEncounter(ctx: RuleContext): void {
  const { state, data } = ctx;
  const dive = requireDive(state);
  const def = dungeonOf(data, dive.dungeonId);
  const m = monsterOf(data, def.boss.monster);
  const count = Math.min(data.config.combat.maxPerGroup, Math.max(1, rollDice(state.rng, m.groupSize).total));
  startBattle(ctx, { kind: "boss" }, [{ monsterId: m.id, count }]);
}

/**
 * 戦闘を始める（テストからも使う。表示層には開かない）。
 * HP（g→u）→ 図鑑のキー → battle と screen → encounter → CB-06 の SAN → 全滅の確認 → CB-04 の先手判定。
 */
export function startBattle(ctx: RuleContext, origin: BattleOrigin, specs: { monsterId: string; count: number }[]): void {
  const { state, data } = ctx;
  const cfg = data.config;
  const groups: EnemyGroup[] = specs.map((sp) => {
    const m = monsterOf(data, sp.monsterId);
    const units: EnemyUnit[] = [];
    for (let i = 0; i < sp.count; i++) {
      const hp = Math.max(1, rollDice(state.rng, m.hp).total);
      units.push({ hp, hpMax: hp, status: [] });
    }
    return { monsterId: m.id, units };
  });
  for (const g of groups) {
    if (state.bestiary[g.monsterId] === undefined) state.bestiary[g.monsterId] = { kills: 0, identified: false };
  }
  state.battle = { origin, round: 0, partySurprise: false, groups, inputs: {}, auto: false, acBonus: {} };
  state.screen = "battle";
  ctx.events.push({ kind: "screen", to: "battle" });
  ctx.events.push({ kind: "encounter", groups: groupViews(state, data) });
  ctx.events.push({ kind: "message", key: "battle.encounter" });

  // CB-06: 未鑑定のグループの数 × unidentifiedGroup（耐性なし）
  const k = groups.filter((g) => !isIdentified(state, g.monsterId)).length;
  if (k > 0) {
    ctx.events.push({ kind: "message", key: "battle.unidentified" });
    for (const ch of state.party) {
      if (ch.life === "alive") loseSan(ctx, ch, k * cfg.san.unidentifiedGroup, []);
    }
  }
  if (isWipe(state)) {
    endBattle(ctx, "wipe");
    return;
  }

  // CB-04: 先手判定（ボス戦でも行う）
  const b = requireBattle(state);
  const pAvg = partyAgiAvg(state);
  const eAvg = enemyAgiAvg(state, data);
  const rP = rollDie(state.rng, 10);
  const rE = rollDie(state.rng, 10);
  ctx.events.push({ kind: "dice", label: "battle.initiativeParty", dice: [rP], total: Math.floor(pAvg) + rP });
  ctx.events.push({ kind: "dice", label: "battle.initiativeEnemy", dice: [rE], total: Math.floor(eAvg) + rE });
  const ambushAvoid = 0; // M5: EV-42 の慎重の恩恵を敵の奇襲判定から引く
  const diff = pAvg + rP - (eAvg + rE - ambushAvoid);
  if (diff >= cfg.combat.surpriseDiff) {
    b.partySurprise = true;
    ctx.events.push({ kind: "message", key: "battle.surpriseParty" });
  } else if (diff <= -cfg.combat.surpriseDiff) {
    ctx.events.push({ kind: "message", key: "battle.surpriseEnemy" });
    const before = snapMembers(state, data);
    if (!runRound(ctx, { allies: false, enemies: true })) roundEnd(ctx, before);
  }
}

// ---------------------------------------------------------------------------
// 入力の検査（engine が複製の前に呼ぶ）

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** battle.input を受け付けない理由。受け付けるなら null（state.battle が非 null の前提） */
export function checkBattleInput(state: GameState, data: GameData, memberId: unknown, action: unknown): string | null {
  const b = requireBattle(state);
  if (b.auto) return "auto on";
  if (typeof memberId !== "string") return "unknown member";
  const ch = memberById(state, memberId);
  if (ch === null) return "unknown member";
  if (!canAct(ch)) return "cannot act";
  if (!isObj(action) || typeof action["type"] !== "string") return "bad action";
  switch (action["type"]) {
    case "attack": {
      const g = action["group"];
      if (typeof g !== "number") return "bad action";
      if (!Number.isInteger(g) || !groupAlive(b, g)) return "bad target";
      return null;
    }
    case "defend":
      return null;
    case "cast": {
      const spellId = action["spellId"];
      if (typeof spellId !== "string" || !isObj(action["target"])) return "bad action";
      if (!ch.knownSpells.includes(spellId) || !data.spells.some((s) => s.id === spellId)) return "unknown spell";
      const sp = spellOf(data, spellId);
      if (!battleSpellUsable(sp)) return "not usable";
      if (ch.mp < sp.mp) return "no mp";
      if (!targetMatches(state, data, sp.target, action["target"])) return "bad target";
      return null;
    }
    case "item": {
      const instanceId = action["instanceId"];
      if (typeof instanceId !== "string" || !isObj(action["target"])) return "bad action";
      const inst = state.items[instanceId];
      if (!ch.inventory.includes(instanceId) || inst === undefined) return "no item";
      const item = itemOf(data, inst.itemId);
      if (!battleItemUsable(item)) return "not usable";
      if (!targetMatches(state, data, item.effect.target, action["target"])) return "bad target";
      return null;
    }
    default:
      return "bad action";
  }
}

/** 検査済みの入力から、余計な欄を落としたプレーンな値を作る（state に保存するため） */
function cleanTarget(t: BattleTarget): BattleTarget {
  if (t.side === "enemy") return { side: "enemy", group: t.group + 0 }; // + 0 で -0 を 0 にする（JSON の往復で同値にするため）
  if (t.side === "ally") return { side: "ally", memberId: t.memberId };
  return { side: "none" };
}

function cleanAction(a: BattleAction): BattleAction {
  switch (a.type) {
    case "attack":
      return { type: "attack", group: a.group + 0 }; // + 0 で -0 を 0 にする
    case "defend":
      return { type: "defend" };
    case "cast":
      return { type: "cast", spellId: a.spellId, target: cleanTarget(a.target) };
    case "item":
      return { type: "item", instanceId: a.instanceId, target: cleanTarget(a.target) };
  }
}

/** CB-10/12/40: 入力を記録する（上書き）。手入力は lastBattleInput にも保存する。イベントは出さない */
export function applyBattleInput(ctx: RuleContext, memberId: string, action: BattleAction): void {
  const b = requireBattle(ctx.state);
  const ch = requireMember(ctx.state, memberId);
  b.inputs[memberId] = cleanAction(action);
  ch.lastBattleInput = cleanAction(action);
}

/** battle.resolve を受け付けない理由。受け付けるなら null（state.battle が非 null の前提） */
export function checkResolve(state: GameState, _data: GameData): string | null {
  const b = requireBattle(state);
  if (b.auto) return null;
  const actors = state.party.filter(canAct);
  if (actors.every((c) => b.inputs[c.id] !== undefined)) return null;
  return "inputs incomplete";
}

/** battle.auto を受け付けない理由（state.battle が非 null の前提） */
export function checkBattleAuto(state: GameState, on: unknown): string | null {
  const b = requireBattle(state);
  if (typeof on !== "boolean") return "bad on";
  if (on === b.auto) return "no change";
  return null;
}

/** F2: オートの切り替え。イベントは出さず、inputs も触らない */
export function setAuto(ctx: RuleContext, on: boolean): void {
  requireBattle(ctx.state).auto = on;
}

/** battle.flee を受け付けない理由（CB-12/50。state.battle が非 null の前提） */
export function checkFlee(state: GameState): string | null {
  const b = requireBattle(state);
  if (b.auto) return "auto on";
  if (!canFleeOf(b)) return "cannot flee";
  if (!state.party.some(canAct)) return "no actor";
  return null;
}

/** battle.repeat を受け付けない理由（CB-12/40。state.battle が非 null の前提） */
export function checkRepeat(state: GameState): string | null {
  const b = requireBattle(state);
  if (b.auto) return "auto on";
  return null;
}

// ---------------------------------------------------------------------------
// ラウンドの解決

/** battle.resolve の本体（checkResolve が null を返した前提） */
export function resolveRound(ctx: RuleContext): void {
  const { state, data } = ctx;
  const b = requireBattle(state);
  const before = snapMembers(state, data);
  const surprised = b.partySurprise;
  b.partySurprise = false; // どの経路でも消費する
  if (b.auto) fillAutoInputs(state, data, b);
  const ended = runRound(ctx, { allies: true, enemies: !surprised });
  if (!ended) roundEnd(ctx, before);
}

/** CB-40〜42: 行動可能な全員の入力をオート入力で上書きする（lastBattleInput は変えない） */
function fillAutoInputs(state: GameState, data: GameData, b: BattleState): void {
  for (const ch of state.party) {
    if (canAct(ch)) b.inputs[ch.id] = autoInput(state, data, ch);
  }
}

/**
 * battle.repeat の本体（CB-12/40。checkRepeat が null を返した前提）。
 * オートの規則で入力を作って battle.resolve と同じ手順で 1 ラウンドを解決する。auto は OFF のままなので CB-43 は効かない
 */
export function repeatRound(ctx: RuleContext): void {
  const { state, data } = ctx;
  fillAutoInputs(state, data, requireBattle(state));
  resolveRound(ctx);
}

/**
 * battle.flee の本体（CB-12/50。checkFlee が null を返した前提）。入力済みの行動は捨てる。
 * 成功で戦闘終了。失敗で敵だけが 1 ラウンド行動する（CB-04 の味方の奇襲は消費する）
 */
export function fleeRound(ctx: RuleContext): void {
  const { state, data } = ctx;
  const b = requireBattle(state);
  const before = snapMembers(state, data);
  b.partySurprise = false; // どの経路でも消費する
  const pct = fleePercent(state, data);
  const d = randInt(state.rng, 1, 100);
  ctx.events.push({ kind: "dice", label: "battle.fleeRoll", dice: [d], total: d });
  if (d <= pct) {
    endBattle(ctx, "flee");
    return;
  }
  ctx.events.push({ kind: "message", key: "battle.fleeFail" });
  const ended = runRound(ctx, { allies: false, enemies: true });
  if (!ended) roundEnd(ctx, before);
}

type Actor = { side: "ally"; plan: AllyPlan } | { side: "enemy"; g: number; u: number };

/** 1 ラウンドの行動を解決する。決着したら endBattle まで行って true */
function runRound(ctx: RuleContext, who: { allies: boolean; enemies: boolean }): boolean {
  const { state, data } = ctx;
  const b = requireBattle(state);
  b.round += 1;
  const plans: AllyPlan[] = [];
  if (who.allies) {
    for (const ch of state.party) {
      if (!canAct(ch)) continue;
      const a = b.inputs[ch.id];
      const action = a === undefined ? ({ type: "defend" } as const) : a;
      plans.push(toPlan(state, data, ch, action));
    }
  }
  // CB-12: 防御（置き換えを含む）はラウンド全体に効く
  const defending = new Set(plans.filter((p) => p.kind === "defend").map((p) => p.memberId));
  const entries: { actor: Actor; init: number }[] = [];
  for (const plan of plans) {
    const ch = requireMember(state, plan.memberId);
    entries.push({ actor: { side: "ally", plan }, init: ch.stats.agi + rollDie(state.rng, 10) + 0 }); // 0 は M5 の initiative 恩恵
  }
  if (who.enemies) {
    b.groups.forEach((grp, g) => {
      const agi = monsterOf(data, grp.monsterId).agi;
      grp.units.forEach((unit, u) => {
        if (unitCanAct(unit)) entries.push({ actor: { side: "enemy", g, u }, init: agi + rollDie(state.rng, 10) });
      });
    });
  }
  for (const { actor } of orderActors(entries)) {
    if (actor.side === "ally") {
      const ch = requireMember(state, actor.plan.memberId);
      if (!canAct(ch)) continue; // CB-16
      applyAllyPlan(ctx, ch, actor.plan);
    } else {
      if (!unitCanAct(unitAt(b, actor.g, actor.u))) continue; // CB-16
      actEnemyUnit(ctx, actor.g, actor.u, defending);
    }
    if (isVictory(b)) {
      endBattle(ctx, "win");
      return true;
    }
    if (isWipe(state)) {
      endBattle(ctx, "wipe");
      return true;
    }
  }
  return false;
}

/** 覚醒の判定（CB-32）。眠っていれば sleepWakeChance で外す */
function wakeCheck(ctx: RuleContext, holder: { status: StatusId[] }, id: string, target: string): void {
  if (!holder.status.includes("sleep")) return;
  if (chance(ctx.state.rng, ctx.data.config.combat.sleepWakeChance)) {
    holder.status = holder.status.filter((s) => s !== "sleep");
    ctx.events.push({ kind: "statusChanged", id, status: "sleep", on: false });
    ctx.events.push({ kind: "message", key: "battle.wake", params: { target } });
  }
}

/** 敵の個体へダメージを与える（hpChanged、0 なら撃破、生きていれば覚醒判定）。message は呼び出し側 */
function damageUnit(ctx: RuleContext, g: number, u: number, dmg: number): number {
  const b = requireBattle(ctx.state);
  const unit = unitAt(b, g, u);
  const next = Math.max(0, unit.hp - dmg);
  ctx.events.push({ kind: "hpChanged", id: enemyId(g, u), delta: next - unit.hp, hp: next });
  unit.hp = next;
  return next;
}

function applyAllyPlan(ctx: RuleContext, ch: Character, plan: AllyPlan): void {
  const { state, data } = ctx;
  const b = requireBattle(state);
  const actor = ch.name;
  switch (plan.kind) {
    case "defend":
      if (plan.why === "backRow") {
        ctx.events.push({ kind: "message", key: "battle.backRowCannotAttack", params: { actor } });
      } else {
        if (plan.why === "noMp") ctx.events.push({ kind: "message", key: "battle.noMp", params: { actor } });
        ctx.events.push({ kind: "message", key: "battle.defend", params: { actor } });
      }
      return;
    case "attack": {
      if (plan.noMp) ctx.events.push({ kind: "message", key: "battle.noMp", params: { actor } });
      const g = groupAlive(b, plan.group) ? plan.group : lowestAliveGroup(b); // CB-42
      if (g === null) return;
      const grp = groupAt(b, g);
      const m = monsterOf(data, grp.monsterId);
      const dice = weaponOf(state, data, ch)?.damage ?? data.config.combat.unarmedDice;
      const times = attackCount(classOf(data, ch.classId), ch.level);
      for (let k = 0; k < times; k++) {
        const u = firstAliveUnit(grp);
        if (u === null) break; // 他のグループへは振り替えない
        const unit = unitAt(b, g, u);
        const targetId = enemyId(g, u);
        const hit = chance(state.rng, hitPercent(data.config, ch.level, m.ac, unit.status.includes("sleep")));
        if (!hit) {
          ctx.events.push({ kind: "attack", actorId: ch.id, targetId, hit: false, damage: 0 });
          ctx.events.push({ kind: "message", key: "battle.attackMiss", params: { actor } });
          continue;
        }
        const dmg = Math.max(1, rollDice(state.rng, dice).total + strBonus(ch.stats.str) + 0); // 0 は M5 の damage 恩恵
        const target = groupName(state, data, g);
        const next = damageUnit(ctx, g, u, dmg);
        ctx.events.push({ kind: "attack", actorId: ch.id, targetId, hit: true, damage: dmg });
        ctx.events.push({ kind: "message", key: "battle.attackHit", params: { actor, target, damage: dmg } });
        if (next === 0) killUnit(ctx, g, u);
        else wakeCheck(ctx, unit, targetId, target);
      }
      return;
    }
    case "cast": {
      const sp = spellOf(data, plan.spellId);
      ch.mp -= sp.mp; // MG-30: 行動の時点で引く
      ctx.events.push({ kind: "mpChanged", id: ch.id, delta: -sp.mp, mp: ch.mp });
      ctx.events.push({ kind: "message", key: "battle.cast", params: { actor, spell: sp.name } });
      const refs = resolveTargets(state, ch, sp.target, plan.target);
      const ids = sp.effect.type === "identify" ? [] : refs.map(refId);
      ctx.events.push({ kind: "spell", actorId: ch.id, spellId: sp.id, targets: ids });
      applyEffect(ctx, sp.effect, refs);
      return;
    }
    case "item": {
      const inst = state.items[plan.instanceId];
      if (inst === undefined) throw new Error(`unknown item instance: ${plan.instanceId}`);
      const item = itemOf(data, inst.itemId);
      if (!battleItemUsable(item)) throw new Error(`item not usable in battle: ${item.id}`);
      const name = itemDisplayName(state, data, plan.instanceId);
      destroyItemInstance(state, ch, plan.instanceId); // DG-41
      ctx.events.push({ kind: "message", key: "battle.useItem", params: { actor, item: name } });
      const refs = resolveTargets(state, ch, item.effect.target, plan.target);
      applyEffect(ctx, item.effect, refs);
      return;
    }
  }
}

function refId(r: TargetRef): string {
  return r.side === "enemy" ? enemyId(r.g, r.u) : r.id;
}

/** 効果の対象（CB-42 の振り替え込み） */
function resolveTargets(state: GameState, actor: Character, kind: SpellTarget, t: BattleTarget): TargetRef[] {
  const b = requireBattle(state);
  const pickGroup = (): number | null => {
    if (t.side === "enemy" && groupAlive(b, t.group)) return t.group;
    return lowestAliveGroup(b);
  };
  switch (kind) {
    case "enemy": {
      const g = pickGroup();
      if (g === null) return [];
      const u = firstAliveUnit(groupAt(b, g));
      return u === null ? [] : [{ side: "enemy", g, u }];
    }
    case "enemyGroup": {
      const g = pickGroup();
      if (g === null) return [];
      const out: TargetRef[] = [];
      groupAt(b, g).units.forEach((unit, u) => {
        if (unitAlive(unit)) out.push({ side: "enemy", g, u });
      });
      return out;
    }
    case "allEnemies": {
      const out: TargetRef[] = [];
      b.groups.forEach((grp, g) =>
        grp.units.forEach((unit, u) => {
          if (unitAlive(unit)) out.push({ side: "enemy", g, u });
        }),
      );
      return out;
    }
    case "ally": {
      if (t.side === "ally" && state.party.some((c) => c.id === t.memberId && c.life === "alive")) {
        return [{ side: "ally", id: t.memberId }];
      }
      const c = lowestHpRatioAlly(state);
      return c === null ? [] : [{ side: "ally", id: c.id }];
    }
    case "party":
      return state.party.filter((c) => c.life === "alive").map((c) => ({ side: "ally", id: c.id }));
    case "self":
      return [{ side: "ally", id: actor.id }];
    case "none":
      return [];
  }
}

/** F9: 呪文と道具で共通の効果。呪文に命中判定はない。味方側の heal / cureStatus は effects.ts の applyAllyEffect（戦闘外と共有） */
function applyEffect(ctx: RuleContext, effect: SpellEffect | BattleItem["effect"], refs: TargetRef[]): void {
  const { state, data } = ctx;
  const b = requireBattle(state);
  const enemyRefs = refs.filter((r): r is Extract<TargetRef, { side: "enemy" }> => r.side === "enemy");
  const allyRefs = refs
    .filter((r): r is Extract<TargetRef, { side: "ally" }> => r.side === "ally")
    .map((r) => requireMember(state, r.id));
  switch (effect.type) {
    case "damage":
      for (const r of enemyRefs) {
        const unit = unitAt(b, r.g, r.u);
        if (!unitAlive(unit)) continue;
        const d = Math.max(1, rollDice(state.rng, effect.dice).total);
        const target = groupName(state, data, r.g);
        const next = damageUnit(ctx, r.g, r.u, d);
        ctx.events.push({ kind: "message", key: "battle.spellDamage", params: { target, damage: d } });
        if (next === 0) killUnit(ctx, r.g, r.u);
        else wakeCheck(ctx, unit, enemyId(r.g, r.u), target);
      }
      return;
    case "status": {
      const s = effect.status;
      let i = 0;
      while (i < enemyRefs.length) {
        const g = enemyRefs[i]!.g;
        const m = monsterOf(data, groupAt(b, g).monsterId);
        let landed = 0;
        for (; i < enemyRefs.length && enemyRefs[i]!.g === g; i++) {
          const r = enemyRefs[i]!;
          const unit = unitAt(b, r.g, r.u);
          if (m.resist[s] === true || unit.status.includes(s)) continue; // F8: 判定しない（乱数なし）
          if (chance(state.rng, statusPercent(data.config, effect.chance, 10))) {
            unit.status.push(s);
            ctx.events.push({ kind: "statusChanged", id: enemyId(r.g, r.u), status: s, on: true });
            landed += 1;
          }
        }
        const target = groupName(state, data, g);
        ctx.events.push({ kind: "message", key: landed > 0 ? `battle.status.${s}` : "battle.noEffect", params: { target } });
      }
      return;
    }
    case "heal":
      applyAllyEffect(ctx, { type: "heal", dice: effect.dice }, allyRefs);
      return;
    case "acBonus":
      for (const ch of allyRefs) {
        b.acBonus[ch.id] = (b.acBonus[ch.id] ?? 0) + effect.value;
        ctx.events.push({ kind: "message", key: "battle.acBonus", params: { target: ch.name } });
      }
      return;
    case "cureStatus":
      applyAllyEffect(ctx, { type: "cureStatus", status: effect.status }, allyRefs);
      return;
    case "identify": {
      let any = false;
      for (const grp of b.groups) {
        if (isIdentified(state, grp.monsterId)) continue;
        identifyMonster(ctx, grp.monsterId);
        any = true;
      }
      if (any) ctx.events.push({ kind: "enemyGroups", groups: groupViews(state, data) });
      return;
    }
    default:
      throw new Error(`effect not usable in battle: ${effect.type}`);
  }
}

/** CB-15/24: 敵の個体の行動。攻撃要素ごとに対象を選び直す */
function actEnemyUnit(ctx: RuleContext, g: number, u: number, defending: ReadonlySet<string>): void {
  const { state, data } = ctx;
  const b = requireBattle(state);
  const m = monsterOf(data, groupAt(b, g).monsterId);
  const actorId = enemyId(g, u);
  for (const atk of m.attacks) {
    const actor = groupName(state, data, g);
    const cands = enemyTargetIds(state, data);
    if (cands.length === 0) continue;
    const t = requireMember(state, cands[randInt(state.rng, 0, cands.length - 1)]!);
    const hit = chance(state.rng, hitPercent(data.config, m.level, allyAc(state, data, t), t.status.includes("sleep")));
    if (!hit) {
      ctx.events.push({ kind: "attack", actorId, targetId: t.id, hit: false, damage: 0 });
      ctx.events.push({ kind: "message", key: "battle.attackMiss", params: { actor } });
      continue;
    }
    let d = Math.max(1, rollDice(state.rng, atk.dice).total);
    if (defending.has(t.id)) d = Math.ceil(d / 2); // CB-12/22
    const next = Math.max(0, t.hp - d);
    ctx.events.push({ kind: "hpChanged", id: t.id, delta: next - t.hp, hp: next });
    t.hp = next;
    ctx.events.push({ kind: "attack", actorId, targetId: t.id, hit: true, damage: d });
    ctx.events.push({ kind: "message", key: "battle.enemyAttack", params: { actor, target: t.name, damage: d } });
    if (t.hp === 0) {
      allyDies(ctx, t);
      continue;
    }
    wakeCheck(ctx, t, t.id, t.name);
    if (atk.status !== undefined && !t.status.includes(atk.status)) {
      if (chance(state.rng, statusPercent(data.config, atk.chance ?? 0, t.stats.luk))) {
        t.status.push(atk.status);
        ctx.events.push({ kind: "statusChanged", id: t.id, status: atk.status, on: true });
        ctx.events.push({ kind: "message", key: `battle.status.${atk.status}`, params: { target: t.name } });
      }
    }
    if (atk.sanDrain !== undefined) {
      const c = loseSan(ctx, t, atk.sanDrain, atk.tags ?? []); // CB-31: fear 耐性は san.ts が効かせる
      if (c.delta !== 0) ctx.events.push({ kind: "message", key: "battle.sanDrain", params: { target: t.name } });
    }
  }
}

/** CB-54/CH-45: 戦闘中の死亡。本人以外の生存者の SAN が減る。status は消さない */
function allyDies(ctx: RuleContext, ch: Character): void {
  ch.life = "dead";
  ctx.events.push({ kind: "lifeChanged", id: ch.id, life: "dead" });
  ctx.events.push({ kind: "message", key: "battle.dead", params: { target: ch.name } });
  for (const o of ctx.state.party) {
    if (o.life === "alive") loseSan(ctx, o, ctx.data.config.san.allyDeath, ["allyInjury"]);
  }
}

/** 敵の撃破。通算撃破数が identifyKills に届いたらその場で鑑定する（CB-05） */
function killUnit(ctx: RuleContext, g: number, u: number): void {
  const { state, data } = ctx;
  const b = requireBattle(state);
  const unit = unitAt(b, g, u);
  const monsterId = groupAt(b, g).monsterId;
  unit.hp = 0;
  ctx.events.push({ kind: "lifeChanged", id: enemyId(g, u), life: "dead" });
  ctx.events.push({ kind: "message", key: "battle.dead", params: { target: groupName(state, data, g) } });
  const entry = state.bestiary[monsterId] ?? { kills: 0, identified: false };
  entry.kills += 1;
  state.bestiary[monsterId] = entry;
  if (!entry.identified && entry.kills >= data.config.combat.identifyKills) {
    identifyMonster(ctx, monsterId);
    ctx.events.push({ kind: "enemyGroups", groups: groupViews(state, data) });
  }
}

function identifyMonster(ctx: RuleContext, monsterId: string): void {
  const entry = ctx.state.bestiary[monsterId] ?? { kills: 0, identified: false };
  entry.identified = true;
  ctx.state.bestiary[monsterId] = entry;
  ctx.events.push({ kind: "message", key: "battle.identified", params: { name: monsterOf(ctx.data, monsterId).name } });
}

/** 決着しなかったラウンドの終わり: 毒（CB-33）→ 自然覚醒（CB-32）→ 確率鑑定（CB-05）→ inputs を空に → オート解除（CB-43） */
function roundEnd(ctx: RuleContext, before: MemberSnap[]): void {
  const { state, data } = ctx;
  const b = requireBattle(state);
  tickPoison(ctx);
  naturalWake(ctx);
  let any = false;
  for (const grp of b.groups) {
    if (!grp.units.some(unitAlive) || isIdentified(state, grp.monsterId)) continue;
    if (chance(state.rng, identifyPercent(state, data))) {
      identifyMonster(ctx, grp.monsterId);
      any = true;
    }
  }
  if (any) ctx.events.push({ kind: "enemyGroups", groups: groupViews(state, data) });
  b.inputs = {};
  if (b.auto) {
    const r = autoInterruptReason(before, state, data);
    if (r !== null) {
      b.auto = false;
      ctx.events.push({ kind: "message", key: "battle.autoOff" });
      ctx.events.push({ kind: "message", key: `battle.autoReason.${r}` });
    }
  }
}

/**
 * CB-32: ラウンド終了の自然覚醒。並び順の味方（life alive）→ グループ → 個体（hp > 0）の順に、
 * 眠っている者ごとに sleepNaturalWake% を 1 回振る。覚めたら statusChanged off と battle.wake
 */
function naturalWake(ctx: RuleContext): void {
  const { state, data } = ctx;
  const b = requireBattle(state);
  const pct = data.config.combat.sleepNaturalWake;
  const wake = (holder: { status: StatusId[] }, id: string, target: string): void => {
    if (!chance(state.rng, pct)) return;
    holder.status = holder.status.filter((s) => s !== "sleep");
    ctx.events.push({ kind: "statusChanged", id, status: "sleep", on: false });
    ctx.events.push({ kind: "message", key: "battle.wake", params: { target } });
  };
  for (const ch of state.party) {
    if (ch.life === "alive" && ch.status.includes("sleep")) wake(ch, ch.id, ch.name);
  }
  b.groups.forEach((grp, g) => {
    grp.units.forEach((unit, u) => {
      if (unitAlive(unit) && unit.status.includes("sleep")) wake(unit, enemyId(g, u), groupName(state, data, g));
    });
  });
}

/** CB-33/CH-43: 毒は HP −poisonDamagePerTick、1 で止まる。hpChanged だけを出す */
function tickPoison(ctx: RuleContext): void {
  const per = ctx.data.config.combat.poisonDamagePerTick;
  for (const ch of ctx.state.party) {
    if (ch.life !== "alive" || !ch.status.includes("poison") || ch.hp <= 1) continue;
    const next = Math.max(1, ch.hp - per);
    if (next === ch.hp) continue;
    ctx.events.push({ kind: "hpChanged", id: ch.id, delta: next - ch.hp, hp: next });
    ch.hp = next;
  }
}

/** CH-43 / F8: 迷宮の 1 歩ごとの毒 */
export function tickPoisonStep(ctx: RuleContext): void {
  tickPoison(ctx);
}

/** 戦闘の終わり（CB-50/51/53、DG-31〜33） */
function endBattle(ctx: RuleContext, result: "win" | "flee" | "wipe"): void {
  const { state, data } = ctx;
  const b = requireBattle(state);
  const cfg = data.config;
  ctx.events.push({ kind: "battleEnd", result });
  if (result === "win") {
    ctx.events.push({ kind: "message", key: "battle.win" });
    let total = 0;
    for (const grp of b.groups) total += monsterOf(data, grp.monsterId).exp * grp.units.length;
    const alive = state.party.filter((c) => c.life === "alive");
    const share = expShare(total, alive.length);
    for (const ch of alive) ch.exp += share;
    ctx.events.push({ kind: "message", key: "battle.exp", params: { exp: share } });
    let gold = 0;
    for (const grp of b.groups) {
      const m = monsterOf(data, grp.monsterId);
      for (let i = 0; i < grp.units.length; i++) gold += Math.max(0, rollDice(state.rng, m.gold).total);
    }
    if (gold > 0) addGold(state, gold);
    if (gold > 0) ctx.events.push({ kind: "message", key: "battle.gold", params: { gold } });
    if (b.origin.kind === "random" && b.origin.inRoom) {
      // CB-52 の仮実装。罠・chestQuality は M5（openChest の差し込み口）
      if (chance(state.rng, cfg.combat.chestChance)) {
        const cg = Math.max(0, rollDice(state.rng, cfg.combat.chestGoldDice).total);
        addGold(state, cg);
        ctx.events.push({ kind: "message", key: "battle.chest", params: { gold: cg } });
      }
    }
    if (b.origin.kind === "boss") {
      const dive = requireDive(state);
      dive.bossDefeated = true;
      ctx.events.push({ kind: "message", key: "battle.bossDefeated" });
      const def = dungeonOf(data, dive.dungeonId);
      if (!state.progress.clearedDungeons.includes(def.id)) {
        state.progress.clearedDungeons.push(def.id);
        ctx.events.push({ kind: "message", key: "battle.dungeonCleared" });
      }
      const next = def.onClear.unlockDungeon;
      if (next !== null && !state.progress.unlockedDungeons.includes(next)) {
        state.progress.unlockedDungeons.push(next);
        ctx.events.push({ kind: "message", key: "dungeon.unlocked", params: { dungeon: dungeonOf(data, next).name } });
      }
    }
  } else if (result === "flee") {
    ctx.events.push({ kind: "message", key: "battle.fleeOk" });
  } else {
    // M4: ここから wipe.ts の全滅処理（TW-20〜27）を呼ぶ
    ctx.events.push({ kind: "message", key: "battle.wipe" });
  }
  for (const ch of state.party) {
    if (!ch.status.includes("sleep")) continue;
    ch.status = ch.status.filter((s) => s !== "sleep");
    ctx.events.push({ kind: "statusChanged", id: ch.id, status: "sleep", on: false });
  }
  state.battle = null;
  state.screen = "dungeon";
  ctx.events.push({ kind: "screen", to: "dungeon" });
}

function addGold(state: GameState, gold: number): void {
  state.gold += gold;
  if (state.dive !== null) state.dive.ledger.gold += gold; // DG-40
}

// ---------------------------------------------------------------------------
// 表示層向けの問い合わせ（純粋）

/** 入力用の値。battle が null なら null */
export function battleMenu(state: GameState, data: GameData): BattleMenu | null {
  const b = state.battle;
  if (b === null) return null;
  const members = state.party.map((ch) => {
    const spells = ch.knownSpells
      .map((id) => data.spells.find((s) => s.id === id))
      .filter((s): s is Spell => s !== undefined && battleSpellUsable(s))
      .map((s) => ({ spellId: s.id, name: s.name, mp: s.mp, target: s.target, usable: ch.mp >= s.mp }));
    const items = ch.inventory.flatMap((instanceId) => {
      const inst = state.items[instanceId];
      if (inst === undefined) return [];
      const item = itemOf(data, inst.itemId);
      if (!battleItemUsable(item)) return [];
      const name = itemDisplayName(state, data, instanceId);
      return [{ instanceId, itemId: item.id, name, target: item.effect.target }];
    });
    const input = b.inputs[ch.id];
    return {
      id: ch.id,
      name: ch.name,
      canAct: canAct(ch),
      input: input === undefined ? null : cleanAction(input),
      canStrike: canStrike(state, data, ch),
      spells,
      items,
    };
  });
  return {
    round: b.round,
    auto: b.auto,
    canFlee: canFleeOf(b),
    ready: checkResolve(state, data) === null,
    pending: b.auto ? [] : members.filter((m) => m.canAct && m.input === null).map((m) => m.id),
    groups: groupViews(state, data),
    members,
    allies: state.party.filter((c) => c.life === "alive").map((c) => ({ id: c.id, name: c.name, hp: c.hp, hpMax: c.hpMax })),
  };
}
