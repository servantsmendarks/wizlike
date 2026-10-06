// 戦闘の手続き（combat.md CB-01〜54、MG-30/41、CH-43〜45/60）と、入力の検査、表示層向けの問い合わせ battleMenu。
// 判定と式は combat-calc.ts、オート入力・行動計画・行動順・オート解除は combat-plan.ts（どちらも純粋）。
// dungeon.ts は import しない（dungeon.ts がこのファイルを使う。循環を作らない）。
// CB-55: 再生の区切り（beat）は section() で中身の前に差し込む（乱数を引かない。中身が空なら出さない）。
//
// 乱数の消費順（テストで固定する）:
//   遭遇: [グループ数] → ([種類] → [体数])×グループ → HP（g→u）→ 味方 1d10 → 敵 1d10
//     →（敵の奇襲が成立し、行動可能な味方の ambushAvoid の最大が正なら d100。CB-04）→（敵の奇襲ならそのラウンド）
//   ボス: groupSize（定数 "1" は消費なし）→ HP → 先手 2 個 →（同じく d100）
//   ラウンド（battle.resolve / battle.repeat）: [CB-45 の置き換え（並び順に、不安・錯乱の者だけ chance →（成功なら）
//     randomDefendChance → randInt）] → initiative（味方の計画の順 → ラウンド開始時に行動可能な敵の個体の g → u）
//     → 行動順に各行動
//   逃走（battle.flee）: d100 →（失敗なら）initiative（敵だけ）→ 敵の行動 → ラウンド終了
//     味方の攻撃 1 振り: 命中 → [ダメージ] → [覚醒]
//     敵の攻撃要素: 対象 → 命中 → [ダメージ] → [覚醒] → [付与]
//     呪文・道具: 個体ごとのダメージ（→ 覚醒）・付与、回復のダイス
//   → ラウンド終了の鑑定（g 順）→（勝利なら）金（g→u）→ 宝箱 d100 → 宝箱の金 → 宝箱の品（loot.ts。IT-52）
//     →（ボスなら）ボスの戦利品（loot.ts。IT-52）
//   免疫・既に同じ状態・対象なしは消費しない。
import type { GameData, Spell, SpellEffect, SpellTarget, StatusId } from "../data/index";
import { chance, randInt, rollDice, rollDie, weightedIndex } from "../rng";
import { classOf, destroyItemInstance, dungeonOf, findItem, itemDisplayName, itemOf, memberById, monsterOf, personalityOf, spellOf } from "../state";
import type {
  BattleAction,
  BattleMenu,
  BattleOrigin,
  BattleState,
  BattleTarget,
  BeatPhase,
  Character,
  Dive,
  EnemyGroup,
  EnemyUnit,
  GameState,
  RuleContext,
} from "../types";
import {
  allyAc,
  allyAttackBonus,
  ambushAvoider,
  attackCount,
  battleItemUsable,
  battleSpellUsable,
  benefitOf,
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
  partyGoldLuck,
  statusPercent,
  targetMatches,
  unitAlive,
  unitCanAct,
  withGoldLuck,
} from "./combat-calc";
import type { BattleItem } from "./combat-calc";
import type { AllyPlan, MemberSnap, TargetRef } from "./combat-plan";
import { autoInput, autoInterruptReason, enemyTargetIds, orderActors, richestGroup, snapMembers, toPlan } from "./combat-plan";
import { offerTeleporter } from "./choices";
import { applyAllyEffect } from "./effects";
import { clearAllStatus, gainGold } from "./field";
import { rollBossItems, rollChestItems } from "./loot";
import { equipStats, hasSkill, hpMaxOf, skillTotal, spellCost } from "./equip-stats";
import { loseSan, sanCapOf, sanStage } from "./san";
import { raiseShopLevel } from "./shop";
import { performWipe } from "./wipe";

/**
 * CB-55 の拍を出すかどうか。テストで「拍を入れない場合」と比べる（不変条件 (c)）ためだけのスイッチで、
 * ゲームのコードからは変えない（常に true）。
 */
export const beatSwitchForTests = { enabled: true };

/**
 * CB-55: fn が出したイベントの前に beat{phase, auto} を 1 件差し込む。fn が何も出さなければ拍も出さない。
 * auto は区切りを始めた時点の state.battle.auto（battle が null なら false）。乱数は引かない。入れ子にしない。
 */
function section(ctx: RuleContext, phase: BeatPhase, fn: () => void): void {
  const auto = ctx.state.battle?.auto ?? false;
  const at = ctx.events.length;
  fn();
  if (beatSwitchForTests.enabled && ctx.events.length > at) ctx.events.splice(at, 0, { kind: "beat", phase, auto });
}

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
  section(ctx, "system", () => {
    ctx.events.push({ kind: "encounter", groups: groupViews(state, data) });
    ctx.events.push({ kind: "message", key: "battle.encounter" });

    // CB-05 / IT-40 autoIdentify: 行動可能な装備者がいれば全グループを鑑定済みにする（MG-41 と同じ語り。CB-06 より前。乱数なし）
    if (state.party.some((c) => canAct(c) && hasSkill(equipStats(state, data, c), "autoIdentify"))) {
      let any = false;
      for (const g of groups) {
        if (isIdentified(state, g.monsterId)) continue;
        identifyMonster(ctx, g.monsterId);
        any = true;
      }
      if (any) ctx.events.push({ kind: "enemyGroups", groups: groupViews(state, data) });
    }

    // CB-06: 未鑑定のグループの数 × unidentifiedGroup（耐性なし）
    const k = groups.filter((g) => !isIdentified(state, g.monsterId)).length;
    if (k > 0) {
      ctx.events.push({ kind: "message", key: "battle.unidentified" });
      for (const ch of state.party) {
        if (ch.life === "alive") loseSan(ctx, ch, k * cfg.san.unidentifiedGroup, []);
      }
    }
  });
  if (isWipe(state)) {
    endBattle(ctx, "wipe");
    return;
  }

  // CB-04: 先手判定（ボス戦でも行う）
  const b = requireBattle(state);
  const pAvg = partyAgiAvg(state, data);
  const eAvg = enemyAgiAvg(state, data);
  // M4.5: 表示している整数の合計（floor(平均) + 1d10）どうしの差で比べる
  // IT-40 initiativeUp: 行動可能な装備者の品の値の最大（1 人の中でも人の間でも合計しない）を味方の行の base に足す（乱数は変えない）
  const up = Math.max(
    0,
    ...state.party
      .filter(canAct)
      .flatMap((c) => equipStats(state, data, c).skills.filter((x) => x.type === "initiativeUp").map((x) => x.value)),
  );
  const bP = Math.floor(pAvg) + up;
  const bE = Math.floor(eAvg);
  const rP = rollDie(state.rng, 10);
  const rE = rollDie(state.rng, 10);
  const tP = bP + rP;
  const tE = bE + rE;
  const diff = tP - tE;
  const need = cfg.combat.surpriseDiff;
  const ambush = need; // A1: ambushAvoid は閾値を広げず、成立した敵の奇襲を確率で取り消す（下）
  let outcome: "party" | "enemy" | "none" = diff >= need ? "party" : diff <= -ambush ? "enemy" : "none";
  // CB-04 / EV-42: 敵の奇襲が成立したときだけ、行動可能な味方の ambushAvoid の最大で d100 を 1 回
  const av = outcome === "enemy" ? ambushAvoider(state, data) : null;
  section(ctx, "system", () => {
    ctx.events.push({
      kind: "dice",
      label: { key: "dice.initiative" },
      rows: [
        { label: { key: "dice.side.party" }, base: bP, dice: [rP], total: tP },
        { label: { key: "dice.side.enemy" }, base: bE, dice: [rE], total: tE },
      ],
      rule: { key: "dice.initiative.rule", params: { diff, need, ambush } },
      result: { key: `dice.initiative.${outcome}` },
    });
    if (outcome === "party") {
      b.partySurprise = true;
      ctx.events.push({ kind: "message", key: "battle.surpriseParty" });
    } else if (outcome === "enemy") {
      ctx.events.push({ kind: "message", key: "battle.surpriseEnemy" });
    }
  });
  if (av !== null) {
    const d = randInt(state.rng, 1, 100);
    const ok = d <= av.value;
    // 先手の箱を読む前に置き換えないよう、別の system の拍にする（UI-40）
    section(ctx, "system", () => {
      ctx.events.push({
        kind: "dice",
        label: { key: "dice.ambushAvoid", params: { name: av.ch.name } },
        rows: [{ label: { key: "dice.row.roll" }, base: null, dice: [d], total: d }],
        rule: { key: "dice.rule.rate", params: { rate: av.value } },
        result: { key: ok ? "dice.ambushAvoid.ok" : "dice.ambushAvoid.ng" },
      });
      if (ok) ctx.events.push({ kind: "message", key: "battle.ambushAvoided", params: { name: av.ch.name } });
    });
    if (ok) outcome = "none";
  }
  if (outcome === "enemy") {
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
      if (ch.mp < spellCost(state, data, ch, sp)) return "no mp"; // MG-30 / IT-40: 入力時の検査も同じ消費
      if (!targetMatches(state, data, sp.target, action["target"])) return "bad target";
      return null;
    }
    case "item": {
      const instanceId = action["instanceId"];
      if (typeof instanceId !== "string" || !isObj(action["target"])) return "bad action";
      const inst = state.items[instanceId];
      if (!ch.inventory.includes(instanceId) || inst === undefined) return "no item";
      const item = findItem(data, inst.itemId); // 装備は null（not usable）
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
  const ok = d <= pct;
  section(ctx, "system", () => {
    ctx.events.push({
      kind: "dice",
      label: { key: "dice.flee" },
      rows: [{ label: { key: "dice.row.roll" }, base: null, dice: [d], total: d }],
      rule: { key: "dice.rule.rate", params: { rate: pct } },
      result: { key: ok ? "dice.flee.ok" : "dice.flee.ng" },
    });
    if (!ok) ctx.events.push({ kind: "message", key: "battle.fleeFail" });
  });
  if (ok) {
    endBattle(ctx, "flee");
    return;
  }
  const ended = runRound(ctx, { allies: false, enemies: true });
  if (!ended) roundEnd(ctx, before);
}

type Actor = { side: "ally"; plan: AllyPlan } | { side: "enemy"; g: number; u: number };

/** 1 ラウンドの行動を解決する。決着したら endBattle まで行って true */
function runRound(ctx: RuleContext, who: { allies: boolean; enemies: boolean }): boolean {
  const { state, data } = ctx;
  const b = requireBattle(state);
  b.round += 1;
  state.adventureTurns += 1; // TW-12（M5.5）: ラウンドを 1 つ解決するごとに冒険のターン数も 1 進める
  const plans: AllyPlan[] = [];
  // CB-45: SAN の閾値効果で置き換えた者の語りのキー（このラウンドだけ。state には入れない）
  const sanMsg: Record<string, SanOverrideKey> = {};
  if (who.allies) {
    for (const ch of state.party) {
      if (!canAct(ch)) continue;
      const a = b.inputs[ch.id];
      const a0: BattleAction = a === undefined ? { type: "defend" } : a;
      const r = sanOverride(ctx, ch, a0); // 乱数はここ（initiative の 1d10 より前）
      if (r.key !== null) sanMsg[ch.id] = r.key;
      plans.push(toPlan(state, data, ch, r.action));
    }
  }
  // CB-12: 防御（置き換えを含む）はラウンド全体に効く
  const defending = new Set(plans.filter((p) => p.kind === "defend").map((p) => p.memberId));
  const entries: { actor: Actor; init: number }[] = [];
  for (const plan of plans) {
    const ch = requireMember(state, plan.memberId);
    const es = equipStats(state, data, ch);
    // CB-11: agi は実効の値（CH-13）、オプション initiative（IT-34）も足す
    entries.push({ actor: { side: "ally", plan }, init: es.stats.agi + rollDie(state.rng, 10) + benefitOf(data, ch, "initiative") + es.initiative });
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
      applyAllyPlan(ctx, ch, actor.plan, sanMsg[ch.id] ?? null);
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

type SanOverrideKey = "battle.disobey" | "battle.confused";

/**
 * CB-45 / CH-53【仮】: SAN の閾値効果で、ラウンドの頭に味方の行動を置き換える（オートの有無に関わらず）。
 * 不安: 確率 = 性格の san.disobeyBelowHalf が正ならその値、でなければ san.uneasyChance（A5）。成功で性格傾向の行動。
 * 錯乱: 確率 = san.confusedChance。成功でランダムな行動。normal / broken（行動不能で来ない）は置き換えない。
 * 確率が 0 以下なら chance を引かない（chance は 0% でも 1 回消費するため）。置き換えた行動は inputs にも lastBattleInput にも書かない
 */
function sanOverride(ctx: RuleContext, ch: Character, a0: BattleAction): { action: BattleAction; key: SanOverrideKey | null } {
  const { state, data } = ctx;
  const cfg = data.config;
  const p = personalityOf(data, ch.personality);
  const stage = sanStage(ch.san, sanCapOf(state, data, ch), cfg);
  if (stage === "uneasy") {
    const own = p?.san.disobeyBelowHalf ?? 0;
    const pct = own > 0 ? own : cfg.san.uneasyChance;
    if (pct <= 0 || !chance(state.rng, pct)) return { action: a0, key: null };
    return { action: sanTendencyAction(ctx, ch), key: "battle.disobey" };
  }
  if (stage === "confused") {
    const pct = cfg.san.confusedChance;
    if (pct <= 0 || !chance(state.rng, pct)) return { action: a0, key: null };
    return { action: sanRandomAction(ctx), key: "battle.confused" };
  }
  return { action: a0, key: null };
}

/** CB-45 / CH-53: 不安の「性格傾向の行動」。普通とリーダーは sanRandomAction（防御または対象ランダムの攻撃） */
function sanTendencyAction(ctx: RuleContext, ch: Character): BattleAction {
  const b = requireBattle(ctx.state);
  switch (personalityOf(ctx.data, ch.personality)?.autoBattle ?? "none") {
    case "defendBelowHalf":
      return { type: "defend" };
    case "alwaysAttack": {
      const g = lowestAliveGroup(b);
      return g === null ? { type: "defend" } : { type: "attack", group: g };
    }
    case "targetRichest": {
      const g = richestGroup(b, ctx.data);
      return g === null ? { type: "defend" } : { type: "attack", group: g };
    }
    case "none":
      return sanRandomAction(ctx);
  }
}

/** CB-45 / CH-53: ランダムな行動。san.randomDefendChance% で防御、でなければ生存グループ（添字の昇順）から randInt で 1 つを攻撃。生存グループが無ければ防御（乱数なし） */
function sanRandomAction(ctx: RuleContext): BattleAction {
  const { state, data } = ctx;
  const b = requireBattle(state);
  const alive = b.groups.map((_, g) => g).filter((g) => groupAlive(b, g));
  if (alive.length === 0) return { type: "defend" };
  if (chance(state.rng, data.config.san.randomDefendChance)) return { type: "defend" };
  return { type: "attack", group: alive[randInt(state.rng, 0, alive.length - 1)]! };
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

/** sanKey は CB-45 で置き換えた者の語り（battle.disobey / battle.confused）。declare の拍の先頭で出す */
function applyAllyPlan(ctx: RuleContext, ch: Character, plan: AllyPlan, sanKey: SanOverrideKey | null): void {
  const { state, data } = ctx;
  const b = requireBattle(state);
  const actor = ch.name;
  const sanLine = (): void => {
    if (sanKey !== null) ctx.events.push({ kind: "message", key: sanKey, params: { actor } });
  };
  switch (plan.kind) {
    case "defend":
      // CB-55: 防御と後衛の攻撃不可は宣言の拍だけ
      section(ctx, "declare", () => {
        sanLine();
        if (plan.why === "backRow") {
          ctx.events.push({ kind: "message", key: "battle.backRowCannotAttack", params: { actor } });
        } else {
          if (plan.why === "noMp") ctx.events.push({ kind: "message", key: "battle.noMp", params: { actor } });
          ctx.events.push({ kind: "message", key: "battle.defend", params: { actor } });
        }
      });
      return;
    case "attack": {
      // 区切りの中で決めた値（閉包の代入は制御フローの絞り込みに乗らないので as で型を広げておく）
      let g = null as number | null;
      section(ctx, "declare", () => {
        sanLine();
        if (plan.noMp) ctx.events.push({ kind: "message", key: "battle.noMp", params: { actor } });
        g = groupAlive(b, plan.group) ? plan.group : lowestAliveGroup(b); // CB-42
        if (g === null) return;
        ctx.events.push({ kind: "message", key: "battle.attackDeclare", params: { actor } });
      });
      const ga = g;
      if (ga === null) return;
      const grp = groupAt(b, ga);
      const m = monsterOf(data, grp.monsterId);
      const es = equipStats(state, data, ch); // CB-21 / CB-22 / IT-20 / IT-34
      // CB-26: 飛行の敵に ranged でない攻撃は届かない。結果の拍を 1 つ出して終える（乱数は引かない。残りの攻撃回数も振らない）
      if (m.special.flying === true && !es.ranged) {
        const u = firstAliveUnit(grp);
        if (u === null) return;
        const targetId = enemyId(ga, u);
        const target = groupName(state, data, ga);
        section(ctx, "result", () => {
          ctx.events.push({ kind: "attack", actorId: ch.id, targetId, hit: false, damage: 0 });
          ctx.events.push({ kind: "message", key: "battle.outOfReach", params: { actor, target } });
        });
        return;
      }
      const dice = es.weaponDice;
      // CB-23 / IT-40: 固有スキル extraAttack は maxAttacks の後に足す（超えてよい）
      const times = attackCount(classOf(data, ch.classId), ch.level) + skillTotal(es, "extraAttack");
      const steal = skillTotal(es, "lifeSteal"); // IT-40
      for (let k = 0; k < times; k++) {
        const u = firstAliveUnit(grp);
        if (u === null) break; // 他のグループへは振り替えない
        const unit = unitAt(b, ga, u);
        const targetId = enemyId(ga, u);
        const target = groupName(state, data, ga);
        let hit = false as boolean;
        let next = 0 as number;
        // CB-55: 振りごとに結果の拍
        section(ctx, "result", () => {
          hit = chance(state.rng, hitPercent(data.config, ch.level, m.ac, unit.status.includes("sleep"), es.hit));
          if (!hit) {
            ctx.events.push({ kind: "attack", actorId: ch.id, targetId, hit: false, damage: 0 });
            ctx.events.push({ kind: "message", key: "battle.miss", params: { target } });
            return;
          }
          // CB-22: str は実効の値、レベルの効果とオプション damage（damageBonus）も足して最低 1
          const dmg = Math.max(1, rollDice(state.rng, dice).total + allyAttackBonus(data, ch, es));
          next = damageUnit(ctx, ga, u, dmg);
          ctx.events.push({ kind: "attack", actorId: ch.id, targetId, hit: true, damage: dmg });
          ctx.events.push({ kind: "message", key: "battle.hit", params: { target, damage: dmg } });
          // IT-40 lifeSteal: 与えたダメージ（attack の damage）の value % を切り捨てで戻す。実効の hpMax で止め、増えなければ何も出さない
          if (steal > 0) {
            const hp = Math.min(es.hpMax, ch.hp + Math.floor((dmg * steal) / 100));
            if (hp > ch.hp) {
              const gain = hp - ch.hp;
              ctx.events.push({ kind: "hpChanged", id: ch.id, delta: gain, hp });
              ch.hp = hp;
              ctx.events.push({ kind: "message", key: "battle.lifeSteal", params: { name: actor, hp: gain } });
            }
          }
        });
        if (!hit) continue;
        // 当たった振りのその後（撃破か覚醒。覚めなければ何も出ず拍も無い）
        section(ctx, "aftermath", () => {
          if (next === 0) killUnit(ctx, ga, u);
          else wakeCheck(ctx, unit, targetId, target);
        });
      }
      return;
    }
    case "cast": {
      const sp = spellOf(data, plan.spellId);
      const refs = resolveTargets(state, data, ch, sp.target, plan.target);
      section(ctx, "declare", () => {
        const cost = spellCost(state, data, ch, sp); // MG-30 / IT-40: mpCostDown の後の消費
        ch.mp -= cost; // MG-30: 行動の時点で引く
        ctx.events.push({ kind: "mpChanged", id: ch.id, delta: -cost, mp: ch.mp });
        ctx.events.push({ kind: "message", key: "battle.cast", params: { actor, spell: sp.name } });
        const ids = sp.effect.type === "identify" ? [] : refs.map(refId);
        ctx.events.push({ kind: "spell", actorId: ch.id, spellId: sp.id, targets: ids });
      });
      applyEffect(ctx, sp.effect, refs, equipStats(state, data, ch).magicPower); // MG-33
      return;
    }
    case "item": {
      const inst = state.items[plan.instanceId];
      if (inst === undefined) throw new Error(`unknown item instance: ${plan.instanceId}`);
      const item = itemOf(data, inst.itemId);
      if (!battleItemUsable(item)) throw new Error(`item not usable in battle: ${item.id}`);
      const name = itemDisplayName(state, data, plan.instanceId);
      destroyItemInstance(state, ch, plan.instanceId); // DG-41
      section(ctx, "declare", () => {
        ctx.events.push({ kind: "message", key: "battle.useItem", params: { actor, item: name } });
      });
      const refs = resolveTargets(state, data, ch, item.effect.target, plan.target);
      applyEffect(ctx, item.effect, refs, 0); // MG-33: 道具には魔法攻撃力を足さない
      return;
    }
  }
}

function refId(r: TargetRef): string {
  return r.side === "enemy" ? enemyId(r.g, r.u) : r.id;
}

/** 効果の対象（CB-42 の振り替え込み） */
function resolveTargets(state: GameState, data: GameData, actor: Character, kind: SpellTarget, t: BattleTarget): TargetRef[] {
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
      const c = lowestHpRatioAlly(state, data);
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

/**
 * F9: 呪文と道具で共通の効果。呪文に命中判定はない。味方側の heal / cureStatus は effects.ts の applyAllyEffect（戦闘外と共有）。
 * power は唱えた者の魔法攻撃力（MG-33。道具は 0）で、damage と heal の出目に対象ごとに足す
 */
function applyEffect(ctx: RuleContext, effect: SpellEffect | BattleItem["effect"], refs: TargetRef[], power: number): void {
  const { state, data } = ctx;
  const b = requireBattle(state);
  const enemyRefs = refs.filter((r): r is Extract<TargetRef, { side: "enemy" }> => r.side === "enemy");
  const allyRefs = refs
    .filter((r): r is Extract<TargetRef, { side: "ally" }> => r.side === "ally")
    .map((r) => requireMember(state, r.id));
  // CB-55: damage は個体ごとに result と aftermath、status はグループごとに result、味方側の効果と identify は全体で result 1 つ
  switch (effect.type) {
    case "damage":
      for (const r of enemyRefs) {
        const unit = unitAt(b, r.g, r.u);
        if (!unitAlive(unit)) continue;
        const target = groupName(state, data, r.g);
        let next = 0 as number;
        section(ctx, "result", () => {
          const d = Math.max(1, rollDice(state.rng, effect.dice).total + power); // MG-33: 足した後に最低 1
          next = damageUnit(ctx, r.g, r.u, d);
          ctx.events.push({ kind: "message", key: "battle.spellDamage", params: { target, damage: d } });
        });
        section(ctx, "aftermath", () => {
          if (next === 0) killUnit(ctx, r.g, r.u);
          else wakeCheck(ctx, unit, enemyId(r.g, r.u), target);
        });
      }
      return;
    case "status": {
      const s = effect.status;
      let i = 0;
      while (i < enemyRefs.length) {
        const g = enemyRefs[i]!.g;
        const m = monsterOf(data, groupAt(b, g).monsterId);
        section(ctx, "result", () => {
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
        });
      }
      return;
    }
    case "heal":
      section(ctx, "result", () => applyAllyEffect(ctx, { type: "heal", dice: effect.dice }, allyRefs, power));
      return;
    case "acBonus":
      section(ctx, "result", () => {
        for (const ch of allyRefs) {
          b.acBonus[ch.id] = (b.acBonus[ch.id] ?? 0) + effect.value;
          ctx.events.push({ kind: "message", key: "battle.acBonus", params: { target: ch.name } });
        }
      });
      return;
    case "cureStatus":
      section(ctx, "result", () => applyAllyEffect(ctx, { type: "cureStatus", status: effect.status }, allyRefs));
      return;
    case "identify": {
      section(ctx, "result", () => {
        let any = false;
        for (const grp of b.groups) {
          if (isIdentified(state, grp.monsterId)) continue;
          identifyMonster(ctx, grp.monsterId);
          any = true;
        }
        if (any) ctx.events.push({ kind: "enemyGroups", groups: groupViews(state, data) });
      });
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
  // CB-55: 宣言は個体ごとに 1 回（攻撃要素のループの前）
  section(ctx, "declare", () => {
    ctx.events.push({ kind: "message", key: "battle.attackDeclare", params: { actor: groupName(state, data, g) } });
  });
  for (const atk of m.attacks) {
    let t = null as Character | null;
    let hit = false as boolean;
    // 攻撃要素ごとに結果の拍（対象の抽選と命中判定。対象がいなければ何も出ず拍も無い）
    section(ctx, "result", () => {
      const cands = enemyTargetIds(state, data);
      if (cands.length === 0) return;
      const tt = requireMember(state, cands[randInt(state.rng, 0, cands.length - 1)]!);
      t = tt;
      hit = chance(state.rng, hitPercent(data.config, m.level, allyAc(state, data, tt), tt.status.includes("sleep")));
      if (!hit) {
        ctx.events.push({ kind: "attack", actorId, targetId: tt.id, hit: false, damage: 0 });
        ctx.events.push({ kind: "message", key: "battle.miss", params: { target: tt.name } });
        return;
      }
      let d = Math.max(1, rollDice(state.rng, atk.dice).total);
      if (defending.has(tt.id)) d = Math.ceil(d / 2); // CB-12/22
      const next = Math.max(0, tt.hp - d);
      ctx.events.push({ kind: "hpChanged", id: tt.id, delta: next - tt.hp, hp: next });
      tt.hp = next;
      ctx.events.push({ kind: "attack", actorId, targetId: tt.id, hit: true, damage: d });
      ctx.events.push({ kind: "message", key: "battle.hit", params: { target: tt.name, damage: d } });
    });
    const tt = t;
    if (tt === null || !hit) continue;
    // その後の拍: 死亡（と他の生存者の SAN）、または 覚醒 → 状態付与 → SAN 吸収
    section(ctx, "aftermath", () => {
      if (tt.hp === 0) {
        allyDies(ctx, tt);
        return;
      }
      wakeCheck(ctx, tt, tt.id, tt.name);
      if (atk.status !== undefined && !tt.status.includes(atk.status)) {
        // CB-30: luk は実効の値（CH-13）、その状態のオプション statusResist（IT-34）を引く
        const tes = equipStats(state, data, tt);
        if (chance(state.rng, statusPercent(data.config, atk.chance ?? 0, tes.stats.luk) - tes.statusResist[atk.status])) {
          tt.status.push(atk.status);
          ctx.events.push({ kind: "statusChanged", id: tt.id, status: atk.status, on: true });
          ctx.events.push({ kind: "message", key: `battle.status.${atk.status}`, params: { target: tt.name } });
        }
      }
      if (atk.sanDrain !== undefined) {
        const c = loseSan(ctx, tt, atk.sanDrain, atk.tags ?? []); // CB-31: fear 耐性は san.ts が効かせる
        if (c.delta !== 0) ctx.events.push({ kind: "message", key: "battle.sanDrain", params: { target: tt.name } });
      }
    });
  }
}

/** CB-54/CH-45: 戦闘中の死亡。状態異常をすべて外す。本人以外の生存者の SAN が減る */
function allyDies(ctx: RuleContext, ch: Character): void {
  ch.life = "dead";
  ctx.events.push({ kind: "lifeChanged", id: ch.id, life: "dead" });
  clearAllStatus(ctx, ch);
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
  // CB-55: 全体を 1 つの system の拍にする（何も起きなければ拍は出ない）
  section(ctx, "system", () => roundEndBody(ctx, before));
}

function roundEndBody(ctx: RuleContext, before: MemberSnap[]): void {
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
  // CB-55: 戦闘の終わりを system の拍 1 つで包む。戦闘の中で起きた全滅では、全滅処理（TW-20〜26）をもう 1 つの system の拍で包む
  section(ctx, "system", () => endBattleBody(ctx, result));
  if (result === "wipe") section(ctx, "system", () => performWipe(ctx));
}

function endBattleBody(ctx: RuleContext, result: "win" | "flee" | "wipe"): void {
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
    let rolled = 0;
    for (const grp of b.groups) {
      const m = monsterOf(data, grp.monsterId);
      for (let i = 0; i < grp.units.length; i++) rolled += Math.max(0, rollDice(state.rng, m.gold).total);
    }
    // CB-51 / IT-34: 行動可能な味方の金運の合計 % を掛ける（乱数なし。合計は勝利の時点で 1 回だけ数える）
    const luck = partyGoldLuck(state, data);
    const gold = withGoldLuck(rolled, luck);
    if (gold > 0) gainGold(ctx, gold, { key: "battle.gold", params: { gold } }); // CH-52: 強欲の treasureGain もここ
    if (b.origin.kind === "random") {
      // CB-51 / CB-52: 部屋のセルは chestChance、通路のセルは chestChanceCorridor（どちらも chance を 1 回）。ボス戦では判定しない。
      // 罠・調べる・解除はプロトタイプ後（A7 / items.md §11 の Q7）。chestQuality は品の希少度（IT-31）
      const chestPct = b.origin.inRoom ? cfg.combat.chestChance : cfg.combat.chestChanceCorridor;
      if (chance(state.rng, chestPct)) {
        const cg = withGoldLuck(Math.max(0, rollDice(state.rng, cfg.combat.chestGoldDice).total), luck); // CB-52 / IT-34
        gainGold(ctx, cg, { key: "battle.chest", params: { gold: cg } }); // cg が 0 でも message は出す
        // IT-50 / IT-53: 金の後に品。Lv はこの戦闘で倒した種類の level の最大
        const dive = requireDive(state);
        const lv = Math.max(...b.groups.map((g) => monsterOf(data, g.monsterId).level));
        rollChestItems(ctx, dive.dungeonId, dive.floor, lv);
      }
    }
    if (b.origin.kind === "boss") {
      const dive = requireDive(state);
      dive.bossDefeated = true;
      const def = dungeonOf(data, dive.dungeonId);
      // DG-32（M9）: 撃破の語りはそのダンジョンのボスの本名（鑑定の有無を問わない。倒した後なので正体を明かす）
      ctx.events.push({ kind: "message", key: "battle.bossDefeated", params: { boss: monsterOf(data, def.boss.monster).name } });
      const firstClear = !state.progress.clearedDungeons.includes(def.id);
      if (firstClear) {
        state.progress.clearedDungeons.push(def.id);
        ctx.events.push({ kind: "message", key: "battle.dungeonCleared" });
      }
      const next = def.onClear.unlockDungeon;
      if (next !== null && !state.progress.unlockedDungeons.includes(next)) {
        state.progress.unlockedDungeons.push(next);
        ctx.events.push({ kind: "message", key: "dungeon.unlocked", params: { dungeon: dungeonOf(data, next).name } });
      }
      // DG-31 / IT-50: ボスの戦利品（勝つたび。再撃破でも）。ボスの語りの後、テレポーターの申し出の前
      rollBossItems(ctx, def.id, monsterOf(data, def.boss.monster).level);
      // IT-62: 初回クリアで店の流通レベルを上げる（上がったときだけ dungeon.shopLevel）。品の語りの後
      if (firstClear) raiseShopLevel(ctx, def.onClear.shopLevel);
    }
  } else if (result === "flee") {
    ctx.events.push({ kind: "message", key: "battle.fleeOk" });
  } else {
    ctx.events.push({ kind: "message", key: "battle.wipe" });
  }
  for (const ch of state.party) {
    if (!ch.status.includes("sleep")) continue;
    ch.status = ch.status.filter((s) => s !== "sleep");
    ctx.events.push({ kind: "statusChanged", id: ch.id, status: "sleep", on: false });
  }
  state.battle = null;
  state.screen = "dungeon";
  // CB-53 / TW-20: 全滅なら呼び出し側（endBattle）が全滅処理で街へ（screen{dungeon} は出さない。performWipe の最後が screen{town}）
  if (result === "wipe") return;
  ctx.events.push({ kind: "screen", to: "dungeon" });
  // DG-32: ボスを倒すとその場にテレポーターが出て、一行はその上に立っているので、すぐに街へ戻るかを尋ねる
  if (result === "win" && b.origin.kind === "boss") offerTeleporter(ctx);
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
      .map((s) => {
        const mp = spellCost(state, data, ch, s); // MG-30 / IT-40
        return { spellId: s.id, name: s.name, mp, target: s.target, usable: ch.mp >= mp };
      });
    const items = ch.inventory.flatMap((instanceId) => {
      const inst = state.items[instanceId];
      if (inst === undefined) return [];
      const item = findItem(data, inst.itemId); // 装備は null（一覧に出さない）
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
    allies: state.party.filter((c) => c.life === "alive").map((c) => ({ id: c.id, name: c.name, hp: c.hp, hpMax: hpMaxOf(state, data, c) })),
  };
}
