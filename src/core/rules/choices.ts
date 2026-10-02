// 保留中の選択（E3）を立てる関数。types だけに依存する（dungeon.ts と combat.ts の両方から使う）。
// 不変条件: pendingChoice を立てたら、同じ events に key === promptKey（params なし）の message を必ず出す
// （リロード復帰では表示層が promptKey を出し直す。SV-50）。
import type { ChoiceOption, RuleContext } from "../types";

function offer(ctx: RuleContext, kind: "stairs" | "teleporter" | "trap", promptKey: string, options: ChoiceOption[]): void {
  ctx.state.pendingChoice = { kind, promptKey, options };
  ctx.events.push({ kind: "message", key: promptKey });
}

const STAY: ChoiceOption = { id: "stay", labelKey: "dungeon.choice.stay" };

/** DG-14: 下り階段（descend / stay）と、2 階以降の上り階段（ascend / stay） */
export function offerStairs(ctx: RuleContext, dir: "down" | "up"): void {
  if (dir === "down") {
    offer(ctx, "stairs", "dungeon.stairsDown", [{ id: "descend", labelKey: "dungeon.choice.descend" }, { ...STAY }]);
  } else {
    offer(ctx, "stairs", "dungeon.stairsUpFloor", [{ id: "ascend", labelKey: "dungeon.choice.ascend" }, { ...STAY }]);
  }
}

/** DG-06: 1 階の上り階段は街への出口（徒歩帰還。exit / stay） */
export function offerExit(ctx: RuleContext): void {
  offer(ctx, "stairs", "dungeon.stairsUp", [{ id: "exit", labelKey: "dungeon.choice.exit" }, { ...STAY }]);
}

/** DG-32: ボス撃破後のテレポーター（teleport / stay） */
export function offerTeleporter(ctx: RuleContext): void {
  offer(ctx, "teleporter", "dungeon.teleporter", [{ id: "teleport", labelKey: "dungeon.choice.teleport" }, { ...STAY }]);
}

/** DG-21 / A6: 罠の察知（retreat / proceed）。先頭が安全な方（引き返す） */
export function offerTrap(ctx: RuleContext): void {
  offer(ctx, "trap", "dungeon.trap.prompt", [
    { id: "retreat", labelKey: "dungeon.choice.retreat" },
    { id: "proceed", labelKey: "dungeon.choice.proceed" },
  ]);
}
