// CH-43b（M23）: 歩行の HP の警告。dungeon.ts・combat.ts・chest.ts・events.ts から呼ぶ（循環を作らないため独立のモジュール）
import type { RuleContext } from "../types";
import { canAct } from "./combat-calc";
import { hpMaxOf } from "./equip-stats";

/**
 * CH-43b（M23）: 歩行の HP の警告。迷宮を歩ける場面（dive あり・screen dungeon・戦闘なし・保留の問いなし・行動可能な者がいる）でだけ、
 * 生存者で hp が実効の hpMax × hpWarnRatio を下回り（毒でなくてもよい）、dive.hpWarned に id が無い者ごとに（並び順）hpWarn を出して id を足す。
 * 割合以上に戻った者・生存でない者は id を外す（再び下がればまた出る）。戦闘の開始で hpWarned は空になる（startBattle）。乱数なし
 */
export function warnHp(ctx: RuleContext): void {
  const { state, data } = ctx;
  const dive = state.dive;
  if (dive === null || state.screen !== "dungeon" || state.battle !== null || state.pendingChoice !== null) return;
  if (!state.party.some(canAct)) return; // 全滅の経路（engine の wipeIfNoneCanAct）では出さない
  const ratio = data.config.combat.hpWarnRatio;
  let warned = dive.hpWarned ?? [];
  for (const ch of state.party) {
    const hpMax = hpMaxOf(state, data, ch);
    const weak = ch.life === "alive" && ch.hp < hpMax * ratio;
    const has = warned.includes(ch.id);
    if (weak && !has) {
      ctx.events.push({ kind: "hpWarn", id: ch.id, hp: ch.hp, hpMax, poison: ch.status.includes("poison") });
      warned = [...warned, ch.id];
    } else if (!weak && has) {
      warned = warned.filter((x) => x !== ch.id);
    }
  }
  if (warned.length > 0 || dive.hpWarned !== undefined) dive.hpWarned = warned;
}
