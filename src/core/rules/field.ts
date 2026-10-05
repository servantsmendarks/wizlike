// 戦闘外の共有部品（DG-13, DG-20, DG-40, CH-45, CH-52, EV-32）。
// dungeon.ts・combat.ts・（M5 の）events.ts から使う。import は san.ts と型・dungeon-gen だけ（循環を作らない）。
import { rollDice } from "../rng";
import type { Character, Dive, GameState, RuleContext, TextRef } from "../types";
import { gainTreasureSan, loseSan } from "./san";

/** life alive の者（並び順） */
export function aliveMembers(state: GameState): Character[] {
  return state.party.filter((c) => c.life === "alive");
}

/**
 * CH-45 / TW-07 / TW-08 / TW-23 / TW-31: 状態異常をすべて外す。status の順に 1 つずつ statusChanged off を出す（無ければ何も出さない）。
 * 死亡・灰になったとき（lifeChanged の直後）と、生き返るとき（lifeChanged alive の直後）に使う
 */
export function clearAllStatus(ctx: RuleContext, ch: Character): void {
  for (const s of [...ch.status]) {
    ch.status = ch.status.filter((x) => x !== s);
    ctx.events.push({ kind: "statusChanged", id: ch.id, status: s, on: false });
  }
}

/**
 * 戦闘外のダメージ（DG-20 pit と EV-32 damage の共通。CH-45）。targets を並び順に dice を 1 回ずつ振り、max(0, total) を引く
 * （0 なら hpChanged なし）。全員分の後に HP 0 の者を dead → lifeChanged → message dungeon.dead{name}、
 * 死者 1 人ごとに、その時点の生存者全員へ loseSan(allyDeath, ["allyInjury"])。
 */
export function damageMembers(ctx: RuleContext, targets: readonly Character[], dice: string): void {
  const { state, data } = ctx;
  for (const ch of targets) {
    // 負の修正値（"1d6-3" など）で回復しないよう、ダメージは 0 以上にクランプする（rng.ts: クランプは呼び出し側）
    const r = Math.max(0, rollDice(state.rng, dice).total);
    if (r === 0) continue; // 0 ダメージでは hpChanged を出さない
    const next = Math.max(0, ch.hp - r);
    ctx.events.push({ kind: "hpChanged", id: ch.id, delta: next - ch.hp, hp: next });
    ch.hp = next;
  }
  const died = targets.filter((ch) => ch.life === "alive" && ch.hp === 0);
  for (const ch of died) {
    ch.life = "dead";
    ctx.events.push({ kind: "lifeChanged", id: ch.id, life: "dead" });
    clearAllStatus(ctx, ch); // CH-45
    ctx.events.push({ kind: "message", key: "dungeon.dead", params: { name: ch.name } });
  }
  for (let k = 0; k < died.length; k++) {
    for (const o of aliveMembers(state)) loseSan(ctx, o, data.config.san.allyDeath, ["allyInjury"]);
  }
}

/**
 * DG-40 / CH-52: 金の入手。msg は必ず出す。amount > 0 なら所持金と（dive があれば）台帳の金に足し、
 * msg の後に gainTreasureSan（強欲の treasureGain。入手 1 回につき 1 回）。amount は 0 以上の整数
 */
export function gainGold(ctx: RuleContext, amount: number, msg: TextRef): void {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error(`gainGold: bad amount ${amount}`);
  const { state } = ctx;
  if (amount > 0) {
    state.gold += amount;
    if (state.dive !== null) state.dive.ledger.gold += amount; // DG-40
  }
  ctx.events.push({ kind: "message", key: msg.key, ...(msg.params === undefined ? {} : { params: msg.params }) });
  if (amount > 0) gainTreasureSan(ctx);
}

/** 昇順の配列で i 以上の最初の位置（二分探索） */
function lowerBound(list: readonly number[], i: number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (list[mid]! < i) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** DG-13 / DG-21: 階ごとの添字の表（explored・knownTraps）の map[floorNo] に添字を昇順・重複なしで足す */
export function addIndex(map: Record<string, number[]>, floorNo: number, indices: readonly number[]): void {
  const key = String(floorNo);
  const list = map[key] ?? [];
  for (const i of indices) {
    // 昇順の位置に挿入する（重複は足さない）
    const lo = lowerBound(list, i);
    if (list[lo] !== i) list.splice(lo, 0, i);
  }
  map[key] = list;
}

/** DG-21: map[floorNo] から添字 index を外す（無ければ何もしない。空になってもキーは残す） */
export function removeIndex(map: Record<string, number[]>, floorNo: number, index: number): void {
  const list = map[String(floorNo)];
  if (list === undefined) return;
  const lo = lowerBound(list, index);
  if (list[lo] === index) list.splice(lo, 1);
}

/** DG-13: explored[floorNo] に添字を昇順・重複なしで足す */
export function addExplored(dive: Dive, floorNo: number, indices: readonly number[]): void {
  addIndex(dive.explored, floorNo, indices);
}
