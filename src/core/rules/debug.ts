// UI-57（開発用）: debug パネルのコマンド。全滅の流れを実機で確かめるためのもの（M4 の実機の結果、ユーザー指示）。
// 乱数は使わない。
import type { RuleContext } from "../types";

/**
 * debug.hpOne: 並び順に、life alive で hp が 1 でない者の hp を 1 にして hpChanged を出す（dead / ash は変えない）。
 * 最後に message debug.hpOne を出す（変わった者がいなくても出す）。hp 1 で行動不能になる者はいないので、
 * 迷宮の戦闘外でも全滅処理（finish の wipeIfNoneCanAct）は起きない
 */
export function hpOne(ctx: RuleContext): void {
  for (const ch of ctx.state.party) {
    if (ch.life !== "alive" || ch.hp === 1) continue;
    const delta = 1 - ch.hp;
    ch.hp = 1;
    ctx.events.push({ kind: "hpChanged", id: ch.id, delta, hp: 1 });
  }
  ctx.events.push({ kind: "message", key: "debug.hpOne" });
}
