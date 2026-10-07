// 宝箱（CB-51 / CB-52、IT-50 / IT-53、DG-40）。M11 の作業 1 で combat.ts の勝利の処理から切り出した（挙動と乱数の順は変えない）。
// 純粋（乱数は state.rng だけ）。import は combat.ts を含まない（combat.ts → chest.ts の向き。循環を作らない）。
//
// 乱数の消費順（勝利の宝箱。CB-51 / CB-52）: chance(chestPct) →（当たれば）rollDice(chestGoldDice) → rollChestItems（IT-52）。
import { chance, rollDice } from "../rng";
import type { RuleContext } from "../types";
import { partyGoldLuck, withGoldLuck } from "./combat-calc";
import { gainGold } from "./field";
import { rollChestItems } from "./loot";

/**
 * IT-50 / IT-53 / CB-52 / DG-40: 宝箱の中身を配る。金 chestGoldDice（0 未満にしない）に、開けた時点の行動可能な味方の金運（IT-34）を掛け、
 * message battle.chest{gold}（0 でも出す。金は台帳にも入る。強欲の treasureGain は gainGold が乗せる）→ 品（drops.chest[dungeonId][floor]、
 * Lv は level。置けた品は台帳に入る）
 */
export function grantChestContents(ctx: RuleContext, dungeonId: string, floor: number, level: number): void {
  const { state, data } = ctx;
  const luck = partyGoldLuck(state, data);
  const cg = withGoldLuck(Math.max(0, rollDice(state.rng, data.config.combat.chestGoldDice).total), luck);
  gainGold(ctx, cg, { key: "battle.chest", params: { gold: cg } });
  rollChestItems(ctx, dungeonId, floor, level);
}

/**
 * CB-51 / CB-52: ランダム遭遇の勝利の宝箱。部屋のセルは chestChance、通路のセルは chestChanceCorridor（どちらも chance を 1 回）。
 * 当たればその場で中身を配る（grantChestContents。罠・調べる・解除は M11 の以降の作業）。level はこの戦闘で倒した種類の level の最大。
 * 呼び出し側は origin.kind === "random" のときだけ呼ぶ。当たったら true
 */
export function rollDropChest(ctx: RuleContext, inRoom: boolean, level: number): boolean {
  const { state, data } = ctx;
  const dive = state.dive;
  if (dive === null) throw new Error("not in dungeon");
  const pct = inRoom ? data.config.combat.chestChance : data.config.combat.chestChanceCorridor;
  if (!chance(state.rng, pct)) return false;
  grantChestContents(ctx, dive.dungeonId, dive.floor, level);
  return true;
}
