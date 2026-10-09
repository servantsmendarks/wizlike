// 宝箱（combat.md §6b。CB-51 / CB-60〜66、IT-50 / IT-53 / IT-56、DG-40）。M11 の作業 1 で combat.ts の勝利の処理から切り出し、
// 作業 4 で開封の流れ（調べる・解除・開ける・放っておく）に置き換えた。
// 純粋（乱数は state.rng だけ）。import は combat.ts と dungeon.ts を含まない（combat.ts → chest.ts の向き。循環を作らない）。
// 警報の戦闘（CB-67）は呼び出し側が startAlarm（combat.ts の startAlarmEncounter）を渡し、転移（DG-25）は floor.ts の teleportParty を使う。
//
// 乱数の消費順（state.rng。テストの鏡で固定する）:
//   勝利（CB-51 / CB-61）: chance(chestPct) →（当たれば）[chance(noTrapChance) →（罠ありなら）weightedIndex(危険度の重み) → randInt(その危険度の罠)]
//   宝箱のセル（DG-24。findCellChest）: 罠は生成時に階の rng で引いてある（DG-23）ので、ここでは引かずに「見つけた」へ進む
//     （一度判定したセル（judgedChests。D-2）は衝動なしの「見つけた」。乱数なし）
//   見つけた（presentChest。衝動あり）: [EV-16 衝動: 対象者（盗賊）ごとに並び順で（錯乱なら randInt(0,3)）→（p > 0 なら）d100]
//     →（行動者がいて制止者がいれば）[EV-25 制止: 1d10 制止者 → 1d10 行動者] →（開けるなら）[開ける]
//     →（箱が残り戦闘中でなければ）[EV-71 掛け合い: 対象が 2 人以上なら chance(d100) →（発生すれば）対象者ごとに並び順で contest.dice]
//   調べる（CB-63）: d100 →（失敗なら）d100 →（作動の段なら）[作動] /（偽りの名前の段なら）randInt(本当の罠以外)。担当の失敗（EV-76）は乱数なし
//   解除（CB-64）: （名前が合えば）d100 →（失敗なら）chance(disarmFailTrigger) →（当たれば）[作動]。名前違いは乱数なしで [作動]
//   開ける（CB-65）: （罠があれば）[作動] →（中身を得るなら）rollDice(chestGoldDice) → rollChestItems
//     （2 個目の chance(min(100, secondItemChance + secondItemPerDanger × 危険度))（IT-51。M14）→ 品ごとに IT-52 / IT-56）
//   [作動]（CB-62）: （開けるで target one の罠なら、作動させた人の randInt(行動可能な者)）→ 効果のダイス（damage は並び順に 1 人 1 回、
//     status は並び順に chance 1 回。既にかかっている者は振らない。san は乱数なし。alarm は遭遇の編成と開始（CB-03 / CB-04。startTableEncounter と同じ順）、
//     teleport は行き先の randInt（DG-25））
import type { ChestTrapDef, GameData, RivalryDef } from "../data/index";
import { chance, randInt, rollDice } from "../rng";
import { classOf, dungeonOf, memberById, personalityOf } from "../state";
import type { Cell, Character, ChestState, ChestView, DiceRow, Dive, GameState, Pos, RuleContext } from "../types";
import { canAct, partyGoldLuck, withGoldLuck } from "./combat-calc";
import { drawChestTrap } from "./dungeon-gen";
import { effectiveStats, equipStats } from "./equip-stats";
import { decideImpulse, pickStopper, rollRestrain } from "./events";
import { aliveMembers, damageMembers, gainGold } from "./field";
import { chestGenOf, teleportParty } from "./floor";
import { rollChestItems } from "./loot";
import { applySanValue, gainSan, loseSan } from "./san";
import { tryInflictStatus } from "./status";

/**
 * CB-67: 警報の罠の戦闘を始める関数（combat.ts の startAlarmEncounter）。chest.ts は combat.ts を import しないので、罠を作動させうる操作
 * （調べる・解除・開ける）の呼び出し側が渡す
 */
export type StartAlarm = (ctx: RuleContext, inRoom: boolean) => void;

function requireDive(state: GameState): Dive {
  if (state.dive === null) throw new Error("not in dungeon");
  return state.dive;
}

function requireChest(state: GameState): ChestState {
  const c = requireDive(state).chest;
  if (c === null) throw new Error("no chest");
  return c;
}

/** CB-62: 宝箱の罠の定義。無ければ Error（起動時に検証済み） */
export function chestTrapOf(data: GameData, id: string): ChestTrapDef {
  const t = data.chestTraps.find((x) => x.id === id);
  if (t === undefined) throw new Error(`unknown chest trap id: ${id}`);
  return t;
}

/** 罠の名前の表示名（strings を引いた値。chest-traps.json の name は strings のキー） */
function trapName(data: GameData, id: string): string {
  const key = chestTrapOf(data, id).name;
  return data.strings[key] ?? key;
}

/**
 * CB-61: 罠の抽選。chance(noTrapChance) が当たれば罠なし（危険度 0）。外れたら weightedIndex(chestTrapDangerWeights) で危険度、
 * その危険度の罠（データの順）から randInt で 1 つ
 */
export function rollChestTrap(rng: GameState["rng"], data: GameData, dungeonId: string): { trapId: string | null; danger: number } {
  // 宝箱のセルの生成（DG-23。階の rng）と同じ関数で引く（M11 の作業 7 で dungeon-gen.ts の drawChestTrap に寄せた。順は不変）
  return drawChestTrap(rng, chestGenOf(data, dungeonId));
}

/** IT-53 / DG-24: 宝箱のセル（と debug.chest）の中身の Lv。その階の encounterTable に載る敵の level の最大（表が空なら 1） */
export function floorChestLevel(data: GameData, dungeonId: string, floor: number): number {
  const table = dungeonOf(data, dungeonId).encounterTable[String(floor)] ?? [];
  return Math.max(1, ...table.map((e) => data.monsters.find((m) => m.id === e.monster)?.level ?? 1));
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

function row(key: string, value: number, v: string = signed(value)): DiceRow {
  return { label: { key, params: { v } }, base: value, dice: [], total: value };
}

/**
 * CB-63 / CB-64: 調べる・解除の成功率と判定の箱の行（純粋）。
 * rate = clamp(min, max, base + (盗賊なら thiefBonus) + (実効の agi − statPivot) × agiMul + (実効の luk − statPivot) × lukMul + trapDetect − danger × dangerMul)。
 * 盗賊は職業の abilities に disarm があること。trapDetect は性格の benefits.trapDetect + オプション trapDetect（DG-21 と同じ合算）。
 * danger は今かかっている罠の危険度（無ければ 0。B1）。
 * rivalry は職業の掛け合いの担当の補正（EV-75。調べるの担当だけ呼び出し側が bonus.inspect を渡す。ほかは 0）で、trapDetect の後に足す（clamp の前）。
 * power は危険度を引く前の値、powerRows はその内訳（基本は常に、ほかは 0 でない行だけ。UI-71）、riskRows は危険度と上下限の行（0 でない行だけ）
 */
export function chestRate(
  state: GameState,
  data: GameData,
  kind: "inspect" | "disarm",
  ch: Character,
  danger: number,
  rivalry = 0,
): { rate: number; power: number; powerRows: DiceRow[]; riskRows: DiceRow[] } {
  const c = data.config.chest[kind];
  const es = equipStats(state, data, ch);
  const thief = classOf(data, ch.classId).abilities.includes("disarm") ? c.thiefBonus : 0;
  const agi = (es.stats.agi - c.statPivot) * c.agiMul;
  const luk = (es.stats.luk - c.statPivot) * c.lukMul;
  const detect = (personalityOf(data, ch.personality)?.benefits.trapDetect ?? 0) + es.trapDetect;
  const power = c.base + thief + agi + luk + detect + rivalry;
  const risk = -danger * c.dangerMul;
  const rate = Math.min(c.max, Math.max(c.min, power + risk));
  const powerRows: DiceRow[] = [row("chest.row.base", c.base, `${c.base}`)];
  for (const [key, v] of [
    ["chest.row.thief", thief],
    ["chest.row.agi", agi],
    ["chest.row.luk", luk],
    ["chest.row.trapDetect", detect],
    ["chest.row.rivalry", rivalry],
  ] as const) {
    if (v !== 0) powerRows.push(row(key, v));
  }
  const riskRows: DiceRow[] = [];
  if (risk !== 0) riskRows.push(row("chest.row.danger", risk));
  if (rate - (power + risk) !== 0) riskRows.push(row("chest.row.clamp", rate - (power + risk)));
  return { rate, power, powerRows, riskRows };
}

/** CB-60 / B5: 箱が残っていて戦闘中でなく、行動可能な者がいれば（全滅処理の前でなければ）message chest.prompt */
function promptIfPending(ctx: RuleContext): void {
  const { state } = ctx;
  if (state.dive?.chest == null || state.battle !== null) return;
  if (!state.party.some(canAct)) return;
  ctx.events.push({ kind: "message", key: "chest.prompt" });
}

/**
 * CB-51 / CB-60: ランダム遭遇の勝利の宝箱。部屋のセルは chestChance、通路のセルは chestChanceCorridor（どちらも chance を 1 回）。
 * 当たれば CB-61 で罠を引き、dive.chest にドロップの箱を置く（中身はまだ配らない。開けたとき CB-65）。level はこの戦闘で倒した種類の level の最大（IT-53）。
 * 呼び出し側は origin.kind === "random" のときだけ呼び、screen{dungeon} の後に presentChest を呼ぶ。当たったら true
 */
export function rollDropChest(ctx: RuleContext, inRoom: boolean, level: number): boolean {
  const { state, data } = ctx;
  const dive = requireDive(state);
  const pct = inRoom ? data.config.combat.chestChance : data.config.combat.chestChanceCorridor;
  if (!chance(state.rng, pct)) return false;
  const t = rollChestTrap(state.rng, data, dive.dungeonId);
  dive.chest = { source: "drop", cell: null, inRoom, trapId: t.trapId, danger: t.danger, level, finding: null, rivalry: null };
  return true;
}

/**
 * DG-24（M11）: 宝箱のセルに乗った。dive.chest に宝箱のセルの箱を置いて presentChest（衝動あり）を呼ぶ。
 * 罠は生成時の chestTrapId（disarmedChests にあれば罠なし）、危険度は生成時の罠の値（解除した箱でも残す。IT-56）、
 * 中身の Lv は floorChestLevel、inRoom は roomId !== null。cell は dive.floor の実効の構造のセル（kind chest）、pos はその位置。
 * 乱数はここでは引かない（presentChest の衝動・制止・掛け合いが引く）。
 * D-2: そのセルが dive.judgedChests にあれば presentChest（衝動なし。乱数なし）。無ければ judgedChests の末尾に入れてから衝動ありで呼ぶ
 */
export function findCellChest(ctx: RuleContext, cell: Cell, pos: Pos, startAlarm: StartAlarm): void {
  const { state, data } = ctx;
  const dive = requireDive(state);
  if (cell.kind !== "chest") throw new Error("findCellChest: not a chest cell");
  const ref = { floor: dive.floor, x: pos.x, y: pos.y };
  const disarmed = dive.disarmedChests.some((c) => c.floor === ref.floor && c.x === ref.x && c.y === ref.y);
  const danger = cell.chestTrapId === null ? 0 : chestTrapOf(data, cell.chestTrapId).danger;
  dive.chest = {
    source: "cell",
    cell: ref,
    inRoom: cell.roomId !== null,
    trapId: disarmed ? null : cell.chestTrapId,
    danger,
    level: floorChestLevel(data, dive.dungeonId, dive.floor),
    finding: null,
    rivalry: null,
  };
  // D-2（2026-10-08）: 一度判定したセル（judgedChests）は衝動・制止・掛け合いを省く（乱数を引かない）。初めてなら記録して判定する
  const judged = dive.judgedChests ?? [];
  if (judged.some((c) => c.floor === ref.floor && c.x === ref.x && c.y === ref.y)) {
    presentChest(ctx, { impulse: false });
    return;
  }
  dive.judgedChests = [...judged, { ...ref }];
  presentChest(ctx, { impulse: true, startAlarm });
}

/**
 * presentChest の指定。impulse が偽なら衝動判定（EV-16）も職業の掛け合い（EV-71）もしない（乱数を使わない。debug.chest の present 偽・省略と、
 * 一度判定した宝箱のセル（DG-24 の judgedChests））
 */
export type PresentChestOptions = { impulse: false } | { impulse: true; startAlarm: StartAlarm };

/**
 * CB-60 / EV-16 / EV-25 / EV-71: 箱を見つけたことを語る。chestFound{source, danger} → message chest.found.<source> →
 * （impulse なら）衝動と制止（chestImpulse）。衝動で開けたら（中身・転移・警報のどれでも）ここで終わる（掛け合いも chest.prompt も無し）→
 * （impulse なら）職業の掛け合い（rollRivalry）→ chest.prompt（B5）
 */
export function presentChest(ctx: RuleContext, opts: PresentChestOptions): void {
  const chest = requireChest(ctx.state);
  ctx.events.push({ kind: "chestFound", source: chest.source, danger: chest.danger });
  ctx.events.push({ kind: "message", key: `chest.found.${chest.source}` });
  if (opts.impulse) {
    if (chestImpulse(ctx, opts.startAlarm)) return;
    rollRivalry(ctx);
  }
  promptIfPending(ctx);
}

/**
 * EV-16 / EV-25: 宝箱の衝動と制止。decideImpulse(config.chest.impulse)（盗賊だけ。EV-04）で行動者が決まらなければ偽。
 * 決まれば chestImpulse{actorId} → message chest.impulse.actor{actor} →（制止者がいれば。宝箱は常に stopCheck 真）event.stop.roll{stopper} → rollRestrain:
 * - 成功: event.stop.success{stopper, actor}、制止者 → 行動者の順に SAN +stopSanGain（EV-22）。開封の選択へ（偽を返す）
 * - 失敗（event.stop.fail{stopper}）・制止者なし: message chest.impulse.open{actor} → 行動者が「調べずに開ける」（openChest。作動させた人は行動者）。
 *   罠が作動し、制止者がいて生きていて、戦闘に入っておらず潜行が続いていて行動可能な者がいれば（全滅処理に入らなければ）event.stop.told{stopper} と制止者の SAN +stopSanGain（EV-23。罠なしは good で、
 *   impulseBonus は無い）。真を返す
 */
function chestImpulse(ctx: RuleContext, startAlarm: StartAlarm): boolean {
  const { state, data } = ctx;
  const actor = decideImpulse(ctx, data.config.chest.impulse);
  if (actor === null) return false;
  ctx.events.push({ kind: "chestImpulse", actorId: actor.id });
  ctx.events.push({ kind: "message", key: "chest.impulse.actor", params: { actor: actor.name } });
  const stopper = pickStopper(state, data, { stopCheck: true }, actor);
  if (stopper !== null) {
    ctx.events.push({ kind: "message", key: "event.stop.roll", params: { stopper: stopper.name } });
    if (rollRestrain(ctx, stopper, actor)) {
      ctx.events.push({ kind: "message", key: "event.stop.success", params: { stopper: stopper.name, actor: actor.name } });
      gainSan(ctx, stopper, data.config.events.stopSanGain);
      gainSan(ctx, actor, data.config.events.stopSanGain);
      return false;
    }
    ctx.events.push({ kind: "message", key: "event.stop.fail", params: { stopper: stopper.name } });
  }
  ctx.events.push({ kind: "message", key: "chest.impulse.open", params: { actor: actor.name } });
  const trapped = requireChest(state).trapId !== null;
  openChest(ctx, startAlarm, actor);
  if (trapped && stopper !== null && stopper.life === "alive" && state.battle === null && state.dive !== null && state.party.some(canAct)) {
    ctx.events.push({ kind: "message", key: "event.stop.told", params: { stopper: stopper.name } });
    gainSan(ctx, stopper, data.config.events.stopSanGain);
  }
  return true;
}

/**
 * EV-70〜74: 職業の掛け合い（宝箱の契機）。箱が残り戦闘中でないときだけ。rivalries.json の trigger chest の定義をデータの順に見て、
 * classId の行動可能なメンバー（リーダーを含む）が 2 人以上なら chance(def.chance)。最初に発生した 1 つだけ。
 * 発生: 対象者ごとに並び順で Σ contest.stats（実効の能力値 CH-13）+ contest.dice。最大の者が担当（同点は並び順が前）。
 * message text.start{a, b}（先頭の 2 人）→ dice{dice.rivalry、行は対象者ごと dice.rivalry.member{name, 各能力値}、rule dice.rivalry.rule、
 * result dice.rivalry.win{winner}} → message text.win{winner, loser（先頭の負け）}→ 負けた者それぞれに SAN −loserSan（耐性なし。並び順）。
 * chest.rivalry = { id, ownerId }
 */
function rollRivalry(ctx: RuleContext): void {
  const { state, data } = ctx;
  const chest = requireChest(state);
  if (state.battle !== null) return;
  for (const def of data.rivalries) {
    if (def.trigger !== "chest") continue;
    const cands = state.party.filter((c) => c.classId === def.classId && canAct(c));
    if (cands.length < 2) continue;
    if (!chance(state.rng, def.chance)) continue;
    const scores = cands.map((ch) => {
      const st = effectiveStats(state, data, ch);
      const base = def.contest.stats.reduce((a, k) => a + st[k], 0);
      const roll = rollDice(state.rng, def.contest.dice);
      const params: Record<string, string | number> = { name: ch.name };
      for (const k of def.contest.stats) params[k] = st[k];
      return { ch, base, dice: roll.dice, total: base + roll.total, params };
    });
    let win = scores[0]!;
    for (const s of scores) if (s.total > win.total) win = s;
    const losers = scores.filter((s) => s !== win).map((s) => s.ch);
    ctx.events.push({ kind: "message", key: def.text.start, params: { a: cands[0]!.name, b: cands[1]!.name } });
    ctx.events.push({
      kind: "dice",
      label: { key: "dice.rivalry" },
      rows: scores.map((s) => ({ label: { key: "dice.rivalry.member", params: s.params }, base: s.base, dice: s.dice, total: s.total })),
      rule: { key: "dice.rivalry.rule" },
      result: { key: "dice.rivalry.win", params: { winner: win.ch.name } },
    });
    ctx.events.push({ kind: "message", key: def.text.win, params: { winner: win.ch.name, loser: losers[0]!.name } });
    for (const l of losers) applySanValue(ctx, l, -def.loserSan); // EV-74: 耐性なし
    chest.rivalry = { id: def.id, ownerId: win.ch.id };
    return;
  }
}

function rivalryOf(data: GameData, id: string): RivalryDef {
  const r = data.rivalries.find((x) => x.id === id);
  if (r === undefined) throw new Error(`unknown rivalry id: ${id}`);
  return r;
}

/**
 * CB-67: 警報の戦闘に勝って同じ箱に戻る。chestFound{source, danger} → message chest.afterAlarm → chest.prompt（衝動判定・職業の掛け合いはしない）。乱数は使わない
 */
export function returnToChest(ctx: RuleContext): void {
  const chest = requireChest(ctx.state);
  ctx.events.push({ kind: "chestFound", source: chest.source, danger: chest.danger });
  ctx.events.push({ kind: "message", key: "chest.afterAlarm" });
  promptIfPending(ctx);
}

/**
 * CB-67: 警報の戦闘から逃げた。message chest.fled → 箱を失う（ドロップの箱は chestEnd lost。宝箱のセルは罠なしで残るので chestEnd left で、
 * clearedCells には入れない）。乱数は使わない
 */
export function abandonChest(ctx: RuleContext): void {
  const chest = requireChest(ctx.state);
  ctx.events.push({ kind: "message", key: "chest.fled" });
  endChest(ctx, chest.cell === null ? "lost" : "left");
}

/**
 * 箱を片付ける（dive.chest = null。セルの箱で opened / lost なら clearedCells に入れる）→ chestEnd{result} →
 * 担当の失敗の清算（EV-76。settleRivalryFails）
 */
function endChest(ctx: RuleContext, result: "opened" | "left" | "lost"): void {
  const dive = requireDive(ctx.state);
  const chest = requireChest(ctx.state);
  dive.chest = null;
  if (chest.cell !== null && result !== "left") dive.clearedCells.push({ ...chest.cell });
  ctx.events.push({ kind: "chestEnd", result });
  settleRivalryFails(ctx, chest);
}

/** 罠が無くなった（解除・作動）。trapId = null、セルの箱なら disarmedChests に入れる（重複なし） */
function removeTrap(dive: Dive, chest: ChestState): void {
  chest.trapId = null;
  const cell = chest.cell;
  if (cell === null) return;
  if (!dive.disarmedChests.some((c) => c.floor === cell.floor && c.x === cell.x && c.y === cell.y)) dive.disarmedChests.push({ ...cell });
}

/**
 * CB-62: 罠の作動。罠は経路を問わず消える（removeTrap）。actor は作動させた人（null なら、開けるで作動した）。
 * target one の罠で actor が null なら、行動可能な者（並び順）から randInt で 1 人を選ぶ。
 * chestTrap{trapId, actorId} → message chest.trap.<id>（actor がいれば {actor}）→ 効果。返り値は効果の kind（中身を得るかの判断に使う）。
 * alarm（CB-67）: 箱を残したまま startAlarm(ctx, chest.inRoom) で戦闘を始める（screen{battle} → encounter …）。
 * teleport（DG-25）: 箱を失い（chestEnd lost。宝箱のセルは clearedCells）、teleportParty で同じ階の通路へ移る（moved）
 */
function triggerTrap(ctx: RuleContext, actor: Character | null, startAlarm: StartAlarm): ChestTrapDef["effect"]["kind"] {
  const { state, data } = ctx;
  const dive = requireDive(state);
  const chest = requireChest(state);
  if (chest.trapId === null) throw new Error("triggerTrap: no trap");
  const trap = chestTrapOf(data, chest.trapId);
  const eff = trap.effect;
  let who = actor;
  if (who === null && (eff.kind === "damage" && eff.target === "one")) {
    const able = state.party.filter(canAct);
    who = able[randInt(state.rng, 0, able.length - 1)] ?? null;
    if (who === null) throw new Error("triggerTrap: no one can act");
  }
  removeTrap(dive, chest);
  ctx.events.push({ kind: "chestTrap", trapId: trap.id, actorId: who === null ? null : who.id });
  ctx.events.push({ kind: "message", key: `chest.trap.${trap.id}`, ...(who === null ? {} : { params: { actor: who.name } }) });
  switch (eff.kind) {
    case "damage": {
      if (eff.target === "one") {
        const target = who!;
        damageMembers(ctx, [target], eff.dice);
        // 毒針: 判定なしで付ける（生きていて、まだかかっていなければ）
        if (eff.status !== undefined && target.life === "alive" && !target.status.includes(eff.status)) {
          target.status.push(eff.status);
          ctx.events.push({ kind: "statusChanged", id: target.id, status: eff.status, on: true });
          ctx.events.push({ kind: "message", key: `battle.status.${eff.status}`, params: { target: target.name } });
        }
      } else {
        damageMembers(ctx, aliveMembers(state), eff.dice);
      }
      break;
    }
    case "status": {
      // CB-30 と同じ式（運・statusResist）。既にかかっている者は振らない
      for (const ch of aliveMembers(state)) {
        if (ch.status.includes(eff.status)) continue;
        if (tryInflictStatus(ctx, ch, eff.status, eff.chance)) {
          ctx.events.push({ kind: "message", key: `battle.status.${eff.status}`, params: { target: ch.name } });
        }
      }
      break;
    }
    case "san": {
      for (const ch of aliveMembers(state)) loseSan(ctx, ch, eff.amount, ["trap"]); // 慎重は trapLossMul が効く
      break;
    }
    case "alarm":
      startAlarm(ctx, chest.inRoom);
      break;
    case "teleport":
      endChest(ctx, "lost");
      teleportParty(ctx);
      break;
  }
  return eff.kind;
}

/**
 * CB-65 / IT-50 / IT-53 / IT-56 / DG-40: 中身を配る。金 chestGoldDice（0 未満にしない）に、開けた時点の行動可能な味方の金運（IT-34）を掛け、
 * message chest.open.gold{gold}（0 でも出す。強欲の treasureGain は gainGold が乗せる）→ 品（drops.chest[dungeonId][floor]。1 個 + 2 個目の確率（IT-51。M14）、
 * Lv の基準は箱の level と階の基準 Lv（IT-53）、見つけた時点の危険度で上振れ）
 */
function grantChestContents(ctx: RuleContext, chest: ChestState): void {
  const { state, data } = ctx;
  const dive = requireDive(state);
  const luck = partyGoldLuck(state, data);
  const cg = withGoldLuck(Math.max(0, rollDice(state.rng, data.config.combat.chestGoldDice).total), luck);
  gainGold(ctx, cg, { key: "chest.open.gold", params: { gold: cg } });
  rollChestItems(ctx, dive.dungeonId, dive.floor, chest.level, chest.danger);
}

// ---------------------------------------------------------------------------
// コマンド（chest.inspect / disarm / open / leave）

/**
 * chest.* の受け付けの検査（engine から。rejected の理由）。箱が無い → "no chest"、戦闘中 → "in battle"、保留中の選択 → "choice pending"。
 * inspect / disarm の memberId はパーティの行動可能な者（"unknown member" / "cannot act"）、disarm の trapId は chest-traps.json の id（"unknown trap"）
 */
export function checkChest(state: GameState, data: GameData, cmd: { type: string; memberId?: unknown; trapId?: unknown }): string | null {
  if (state.dive === null || state.dive.chest === null) return "no chest";
  if (state.battle !== null) return "in battle";
  if (state.pendingChoice !== null) return "choice pending";
  if (cmd.type === "chest.inspect" || cmd.type === "chest.disarm") {
    const ch = typeof cmd.memberId === "string" ? memberById(state, cmd.memberId) : null;
    if (ch === null) return "unknown member";
    if (!canAct(ch)) return "cannot act";
  }
  if (cmd.type === "chest.disarm") {
    if (typeof cmd.trapId !== "string" || !data.chestTraps.some((t) => t.id === cmd.trapId)) return "unknown trap";
  }
  return null;
}

/**
 * CB-63 調べる（何度でも、誰でも）。d100 ≤ rate（危険度は今の trapId から）で成功し、本当の結果を告げる（chest.inspect.found{trap} / none）。
 * 失敗なら 2 回目の d100: 1〜triggerChance は作動（作動させた人は調べた人。罠なしの箱なら何も起きず「分からない」）、
 * 続く wrongNameChance の幅は本当の罠以外（罠なしなら全種）から randInt で別の名前を告げる（成功と同じ文）、残りは chest.inspect.unknown。
 * 判定の箱は U-2 (1): 調べる人の力の内訳と危険度を引く前の値だけを出し、危険度・出目・結果は伏せる（hidden）。結果の文は箱の後の語り。
 * 告げた結果は chest.finding（不明・作動は null）。
 * 掛け合いの担当（EV-75）が失敗したら chest.rivalryFails を 1 増やす（語りと SAN は箱が片付いた時点。EV-76 / U-7 (b)）
 */
export function inspectChest(ctx: RuleContext, memberId: string, startAlarm: StartAlarm): void {
  const { state, data } = ctx;
  const chest = requireChest(state);
  const ch = memberById(state, memberId);
  if (ch === null) throw new Error(`inspectChest: unknown member ${memberId}`);
  const danger = chest.trapId === null ? 0 : chestTrapOf(data, chest.trapId).danger;
  // EV-75: 掛け合いの担当がこの箱を調べるときだけ bonus.inspect
  const riv = chest.rivalry !== null && chest.rivalry.ownerId === ch.id ? rivalryOf(data, chest.rivalry.id) : null;
  const r = chestRate(state, data, "inspect", ch, danger, riv?.bonus.inspect ?? 0);
  const roll = randInt(state.rng, 1, 100);
  ctx.events.push({
    kind: "dice",
    label: { key: "dice.chestInspect", params: { name: ch.name } },
    rows: [...r.powerRows, row("chest.row.subtotal", r.power, `${r.power}`)],
    rule: { key: "chest.ruleHidden", params: { mul: data.config.chest.inspect.dangerMul } },
    result: { key: "dice.chestInspect.hidden" },
    hidden: true,
  });
  const tell = (trapId: string | null): void => {
    chest.finding = { trapId };
    if (trapId === null) ctx.events.push({ kind: "message", key: "chest.inspect.none" });
    else ctx.events.push({ kind: "message", key: "chest.inspect.found", params: { trap: trapName(data, trapId) } });
  };
  const unknown = (): void => {
    chest.finding = null;
    ctx.events.push({ kind: "message", key: "chest.inspect.unknown" });
  };
  if (roll <= r.rate) {
    tell(chest.trapId);
  } else {
    // EV-76（U-7 (b)）: 担当の失敗はここでは語らず数えるだけ（作動の前に数える。清算は箱が片付いた時点の endChest）
    if (riv !== null) chest.rivalryFails = (chest.rivalryFails ?? 0) + 1;
    const cfg = data.config.chest;
    const r2 = randInt(state.rng, 1, 100);
    if (r2 <= cfg.triggerChance) {
      if (chest.trapId === null) unknown();
      else {
        chest.finding = null;
        triggerTrap(ctx, ch, startAlarm);
      }
    } else if (r2 <= cfg.triggerChance + cfg.wrongNameChance) {
      const others = data.chestTraps.filter((t) => t.id !== chest.trapId);
      const t = others[randInt(state.rng, 0, others.length - 1)];
      if (t === undefined) throw new Error("inspectChest: no other trap");
      tell(t.id);
    } else {
      unknown();
    }
  }
  promptIfPending(ctx);
}

/**
 * EV-76（U-7 (b)）: 担当の失敗の清算。endChest が chestEnd の直後に呼ぶ。rivalryFails が 1 以上で、担当が生きていて（life alive）、
 * 戦闘中でなく、行動可能な者がいれば（全滅処理に入らなければ）message text.fail{name} を 1 回と、担当の SAN −failSan × 回数（耐性なし。乱数なし）
 */
function settleRivalryFails(ctx: RuleContext, chest: ChestState): void {
  const { state, data } = ctx;
  const n = chest.rivalryFails ?? 0;
  if (n === 0 || chest.rivalry === null) return;
  const owner = memberById(state, chest.rivalry.ownerId);
  if (owner === null || owner.life !== "alive" || state.battle !== null || !state.party.some(canAct)) return;
  const riv = rivalryOf(data, chest.rivalry.id);
  ctx.events.push({ kind: "message", key: riv.text.fail, params: { name: owner.name } });
  applySanValue(ctx, owner, -riv.failSan * n);
}

/**
 * CB-64 解除（誰でも。盗賊は thiefBonus）。罠なしの箱は判定せず chest.disarm.nothing。名前が違えば判定せず chest.disarm.wrong → 作動（作動させた人は解除した人）。
 * 名前が合えば d100 ≤ rate（判定の箱は全行: 内訳・危険度・上下限・出目、基準 chest.rule{rate}、結果 dice.chestDisarm.ok / ng）。
 * 成功: 罠なし（セルの箱は disarmedChests）、finding は { trapId: null }、chest.disarm.ok。
 * 失敗: chance(disarmFailTrigger)（U-4）が当たれば作動、外れれば chest.disarm.fail（箱も罠も残り、再挑戦できる）
 */
export function disarmChest(ctx: RuleContext, memberId: string, trapId: string, startAlarm: StartAlarm): void {
  const { state, data } = ctx;
  const dive = requireDive(state);
  const chest = requireChest(state);
  const ch = memberById(state, memberId);
  if (ch === null) throw new Error(`disarmChest: unknown member ${memberId}`);
  if (chest.trapId === null) {
    ctx.events.push({ kind: "message", key: "chest.disarm.nothing" });
  } else if (chest.trapId !== trapId) {
    ctx.events.push({ kind: "message", key: "chest.disarm.wrong" });
    triggerTrap(ctx, ch, startAlarm);
  } else {
    const r = chestRate(state, data, "disarm", ch, chestTrapOf(data, chest.trapId).danger);
    const roll = randInt(state.rng, 1, 100);
    const ok = roll <= r.rate;
    ctx.events.push({
      kind: "dice",
      label: { key: "dice.chestDisarm", params: { name: ch.name, trap: trapName(data, trapId) } },
      rows: [...r.powerRows, ...r.riskRows, { label: { key: "chest.row.roll" }, base: null, dice: [roll], total: roll }],
      rule: { key: "chest.rule", params: { rate: r.rate } },
      result: { key: ok ? "dice.chestDisarm.ok" : "dice.chestDisarm.ng" },
    });
    if (ok) {
      removeTrap(dive, chest);
      chest.finding = { trapId: null };
      ctx.events.push({ kind: "message", key: "chest.disarm.ok" });
    } else if (chance(state.rng, data.config.chest.disarmFailTrigger)) {
      triggerTrap(ctx, ch, startAlarm);
    } else {
      ctx.events.push({ kind: "message", key: "chest.disarm.fail" });
    }
  }
  promptIfPending(ctx);
}

/**
 * CB-65 開ける: 罠があれば必ず作動する（作動させた人は actor。null（コマンドの開ける）なら、target one の罠は行動可能な者から randInt で 1 人。
 * 衝動で開ける EV-16 は行動者を渡す）。
 * その後、teleport でなく alarm でなく、行動可能な者が残っていれば中身を得て、chestEnd opened（セルの箱は clearedCells）。
 * teleport は箱を失って移る（triggerTrap の中で chestEnd lost → moved）。alarm は箱を残して戦闘になる（勝てば returnToChest で戻る）。
 * 全員が行動不能なら中身を得ず chestEnd opened（全滅処理は engine の finish）
 */
export function openChest(ctx: RuleContext, startAlarm: StartAlarm, actor: Character | null = null): void {
  const { state } = ctx;
  const chest = requireChest(state);
  let kind: ChestTrapDef["effect"]["kind"] | null = null;
  if (chest.trapId !== null) kind = triggerTrap(ctx, actor, startAlarm);
  if (kind === "teleport" || kind === "alarm") return;
  if (state.party.some(canAct)) grantChestContents(ctx, chest);
  endChest(ctx, "opened");
}

/** CB-66 放っておく: chest.left → chestEnd left（ドロップの箱は失う。セルの箱は残る） */
export function leaveChest(ctx: RuleContext): void {
  ctx.events.push({ kind: "message", key: "chest.left" });
  endChest(ctx, "left");
}

/**
 * UI-57（開発用、M11）: 今の位置にドロップの箱を置く（trapId は null か chest-traps.json の id。危険度はその罠の値）。
 * inRoom は呼び出し側が渡す（今のセルの roomId !== null）。level はその階の遭遇表の敵の level の最大。presentChest まで行う。
 * startAlarm が null なら衝動なし（乱数は使わない）。非 null なら presentChest{impulse: true}（衝動・制止・掛け合い。state.rng を使う。debug.chest{present: true}）
 */
export function placeDebugChest(ctx: RuleContext, trapId: string | null, inRoom: boolean, startAlarm: StartAlarm | null = null): void {
  const { state, data } = ctx;
  const dive = requireDive(state);
  const level = floorChestLevel(data, dive.dungeonId, dive.floor);
  const danger = trapId === null ? 0 : chestTrapOf(data, trapId).danger;
  dive.chest = { source: "drop", cell: null, inRoom, trapId, danger, level, finding: null, rivalry: null };
  presentChest(ctx, startAlarm === null ? { impulse: false } : { impulse: true, startAlarm });
}

// ---------------------------------------------------------------------------
// 表示層向けの問い合わせ（純粋）

/** CB-60 / UI-70: 宝箱の操作の値。dive.chest が非 null で battle・pendingChoice が null のときだけ非 null */
export function chestView(state: GameState, data: GameData): ChestView | null {
  const chest = state.dive?.chest ?? null;
  if (chest === null || state.battle !== null || state.pendingChoice !== null) return null;
  const f = chest.finding;
  return {
    source: chest.source,
    members: state.party.map((c) => ({ id: c.id, name: c.name, canAct: canAct(c) })),
    trapNames: data.chestTraps.map((t) => ({ id: t.id, name: data.strings[t.name] ?? t.name })),
    finding: f === null ? null : { trapId: f.trapId, name: f.trapId === null ? null : trapName(data, f.trapId) },
    ownerId: chest.rivalry?.ownerId ?? null,
  };
}
