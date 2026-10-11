// 保留中の選択（E3）を立てる関数。types と data の型だけに依存する（dungeon.ts・combat.ts・events.ts から使う）。
// 不変条件: pendingChoice を立てたら、同じ events に key === promptKey（params なし）の message を必ず出す
// （リロード復帰では表示層が promptKey を出し直す。SV-50）。イベントの選択（offerEventChoice）は intro を startEvent が先に出す。
import type { EventDef } from "../data/index";
import type { ChoiceOption, RuleContext } from "../types";

function offer(ctx: RuleContext, kind: "stairs" | "teleporter" | "trap", promptKey: string, options: ChoiceOption[], clearOnMoved = false): void {
  ctx.state.pendingChoice = { kind, promptKey, options };
  ctx.events.push(clearOnMoved ? { kind: "message", key: promptKey, clearOn: "moved" } : { kind: "message", key: promptKey });
}

/** UI-66: 確認の取り消し（やめる）の id。表示層は戻る・やめるの印（cancel の音）をこれで付ける */
export const STAY_CHOICE_ID = "stay";
const STAY: ChoiceOption = { id: STAY_CHOICE_ID, labelKey: "dungeon.choice.stay" };

/**
 * DG-14 / UI-25（M19）: 階段・出口の確認の「通り過ぎる」の id。core では STAY と同じ効果（何もしない）。
 * 表示層はこれを受け付けたら、自動歩行の目的地が残っていれば「移動を続ける」と同じく歩き直す
 */
export const PASS_CHOICE_ID = "pass";
const PASS: ChoiceOption = { id: PASS_CHOICE_ID, labelKey: "dungeon.choice.pass" };

/** DG-14: 下り階段（descend / pass / stay）と、2 階以降の上り階段（ascend / pass / stay）。問いの message は clearOn moved（UI-45。M18）。pass は M19 */
export function offerStairs(ctx: RuleContext, dir: "down" | "up"): void {
  if (dir === "down") {
    offer(ctx, "stairs", "dungeon.stairsDown", [{ id: "descend", labelKey: "dungeon.choice.descend" }, { ...PASS }, { ...STAY }], true);
  } else {
    offer(ctx, "stairs", "dungeon.stairsUpFloor", [{ id: "ascend", labelKey: "dungeon.choice.ascend" }, { ...PASS }, { ...STAY }], true);
  }
}

/** DG-06: 1 階の上り階段は街への出口（徒歩帰還。exit / pass / stay）。問いの message は clearOn moved（UI-45。M18）。pass は M19 */
export function offerExit(ctx: RuleContext): void {
  offer(ctx, "stairs", "dungeon.stairsUp", [{ id: "exit", labelKey: "dungeon.choice.exit" }, { ...PASS }, { ...STAY }], true);
}

/** DG-32: ボス撃破後のテレポーター（teleport / stay） */
export function offerTeleporter(ctx: RuleContext): void {
  offer(ctx, "teleporter", "dungeon.teleporter", [{ id: "teleport", labelKey: "dungeon.choice.teleport" }, { ...STAY }]);
}

/**
 * DG-21 / A6: 罠の察知（retreat / proceed）。先頭が安全な方（引き返す）。
 * 問いは察知したときが dungeon.trap.prompt、印のある罠（knownTraps）に入ったときが dungeon.trap.knownPrompt（M6）
 */
export function offerTrap(ctx: RuleContext, promptKey: "dungeon.trap.prompt" | "dungeon.trap.knownPrompt" = "dungeon.trap.prompt"): void {
  offer(ctx, "trap", promptKey, [
    { id: "retreat", labelKey: "dungeon.choice.retreat" },
    { id: "proceed", labelKey: "dungeon.choice.proceed" },
  ]);
}

/**
 * EV-33 / A4: イベントの選択を待つ。screen を event にし、screen{event} を出してから pendingChoice{kind:"event"} を立てる。
 * message は出さない（問いの intro は同じ execute の先頭で startEvent が出し済み。E3 の不変条件はそれで満たす）。
 */
export function offerEventChoice(ctx: RuleContext, def: EventDef): void {
  ctx.state.screen = "event";
  ctx.events.push({ kind: "screen", to: "event" });
  ctx.state.pendingChoice = {
    kind: "event",
    promptKey: def.text.intro,
    options: def.choices.map((c) => ({ id: c.id, labelKey: c.labelKey })),
    eventId: def.id,
  };
}
