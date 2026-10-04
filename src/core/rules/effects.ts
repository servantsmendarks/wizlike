// 味方側の効果（F9: 呪文と道具で共通。heal / cureStatus）。戦闘（combat.ts の applyEffect）と
// 戦闘外（items.ts の dungeon.useItem）で共有する。battle に依存しない。
// 乱数: heal は対象ごとに effect.dice を 1 回（対象の並びの順）。cureStatus は使わない。
import type { StatusId } from "../data/index";
import { rollDice } from "../rng";
import type { Character, RuleContext } from "../types";
import { hpMaxOf } from "./equip-stats";

export type AllyEffect = { type: "heal"; dice: string } | { type: "cureStatus"; status: StatusId };

/**
 * targets の順に効果を当てる。
 * - heal: max(0, dice + power) を足して実効の hpMax（CH-14）で止める。増えたら hpChanged、続けて message battle.heal{target, amount}（増分 0 でも出す）。
 *   power は唱えた者の魔法攻撃力（MG-33。呪文だけ。道具は 0）
 * - cureStatus: 持っていれば外して statusChanged off と message battle.cured、無ければ message battle.noEffect
 */
export function applyAllyEffect(ctx: RuleContext, effect: AllyEffect, targets: readonly Character[], power = 0): void {
  const { state, data } = ctx;
  switch (effect.type) {
    case "heal":
      for (const ch of targets) {
        const r = Math.max(0, rollDice(state.rng, effect.dice).total + power);
        const next = Math.min(hpMaxOf(state, data, ch), ch.hp + r);
        const delta = next - ch.hp;
        if (delta > 0) ctx.events.push({ kind: "hpChanged", id: ch.id, delta, hp: next });
        ch.hp = next;
        ctx.events.push({ kind: "message", key: "battle.heal", params: { target: ch.name, amount: delta } });
      }
      return;
    case "cureStatus":
      for (const ch of targets) {
        if (ch.status.includes(effect.status)) {
          ch.status = ch.status.filter((x) => x !== effect.status);
          ctx.events.push({ kind: "statusChanged", id: ch.id, status: effect.status, on: false });
          ctx.events.push({ kind: "message", key: "battle.cured", params: { target: ch.name } });
        } else {
          ctx.events.push({ kind: "message", key: "battle.noEffect", params: { target: ch.name } });
        }
      }
      return;
  }
}
