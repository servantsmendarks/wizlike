// UI-76（M16）: 一度きりの GM の一言（hints）。契機ごとの規則（DG-37・CB-06・CH-61）から呼ぶ。乱数は使わない。
import type { HintId } from "../data/index";
import type { RuleContext } from "../types";

/**
 * UI-76: progress.hints に id が無ければ message hint.<id> を出して積む（ゲームで 1 回だけ）。積んだら真、もう出していたら偽。
 * key を渡すと message のキーだけを替える（記録は id。DG-46b の方角つき）。表示層は何もしない（ふつうの message として再生する）
 */
export function tellHintOnce(ctx: RuleContext, id: HintId, key?: string): boolean {
  const hints = ctx.state.progress.hints;
  if (hints.includes(id)) return false;
  hints.push(id);
  ctx.events.push({ kind: "message", key: key ?? `hint.${id}` });
  return true;
}
