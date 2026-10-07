// 状態異常の付与の判定（CB-30）。戦闘（combat.ts の敵の攻撃）と宝箱のガスの罠（chest.ts。CB-62）で共用する。
// M11 の作業 4 で combat.ts から移した（chest.ts は combat.ts を import できないため）。挙動と乱数の順は変えない。
import type { StatusId } from "../data/index";
import { chance } from "../rng";
import type { Character, RuleContext } from "../types";
import { statusPercent } from "./combat-calc";
import { equipStats } from "./equip-stats";

/**
 * CB-30: 状態の付与の判定。chance(statusPercent(基礎 %, 実効の luk（CH-13）) − その状態のオプション statusResist（IT-34）) を 1 回引き、
 * 当たれば status に足して statusChanged on を出す（語りは呼び出し側）。既にかかっているかは呼び出し側が確かめる。付いたら true
 */
export function tryInflictStatus(ctx: RuleContext, ch: Character, status: StatusId, basePct: number): boolean {
  const { state, data } = ctx;
  const es = equipStats(state, data, ch);
  if (!chance(state.rng, statusPercent(data.config, basePct, es.stats.luk) - es.statusResist[status])) return false;
  ch.status.push(status);
  ctx.events.push({ kind: "statusChanged", id: ch.id, status, on: true });
  return true;
}
