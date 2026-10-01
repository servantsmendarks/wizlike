// UI-54 / CB-43: オート戦闘の連鎖。常駐のループではなく、run の後に「次に何を送るか」を決めて 1 段ずつ進める async の連鎖。
// - chainDecision は純粋: rejected・戦闘外なら止まる。オート中は解除の予約があれば battle.auto off、無ければ battle.resolve。
//   手動では入力が揃った（menu.ready）ときだけ battle.resolve を送る（全員入力済み・行動可能 0 人の睡眠だけ）。
// - runChain は連鎖の本体。段の間で yieldFrame（app では 1 回だけの requestAnimationFrame）を待ち、描画と入力に 1 フレーム譲る。
// - closesInput は純粋: 送ったら再生の間は入力の UI を下げる Command か（UI-44）。
// DOM・タイマーには触れない（yieldFrame は呼び出し側が注入する）。
import type { BattleMenu, Command } from "../core/types";

export type ChainStep = "resolve" | "autoOff" | "stop";

export function chainDecision(i: { rejected: boolean; menu: BattleMenu | null; stopRequested: boolean }): ChainStep {
  if (i.rejected || i.menu === null) return "stop";
  if (i.menu.auto) return i.stopRequested ? "autoOff" : "resolve";
  return i.menu.ready ? "resolve" : "stop";
}

/**
 * UI-44: 送ると戦闘の入力を閉じる Command か（表示のためだけ。送ってから再生が終わるまで入力の UI を下げる）。
 * 逃走・前回と同じ、手動の battle.resolve。オート中の battle.resolve は閉じない（「オート戦闘中」とオート解除は出したまま）。
 * battle.input は閉じない（次の入力待ちは再生の最後の sync が出す）
 */
export function closesInput(cmd: Command, menu: BattleMenu | null): boolean {
  if (cmd.type === "battle.flee" || cmd.type === "battle.repeat") return true;
  if (cmd.type !== "battle.resolve") return false;
  return menu !== null && !menu.auto;
}

export type ChainDeps = {
  /** 門を通して execute と再生を行う。再生中で捨てられたら null */
  run(cmd: Command): Promise<{ rejected: boolean } | null>;
  /** 今の state の battleMenu（戦闘外なら null） */
  menu(): BattleMenu | null;
  /** UI-44 の例外で立てた「オート解除」の予約 */
  stopRequested(): boolean;
  /** 予約を下ろす（autoOff を送るとき・止まるとき） */
  clearStop(): void;
  /** 段の間で 1 フレーム譲る */
  yieldFrame(): Promise<void>;
};

/** first を送り、chainDecision が stop を返すまで battle.resolve / battle.auto off を送り続ける */
export async function runChain(first: Command, d: ChainDeps): Promise<void> {
  let r = await d.run(first);
  for (;;) {
    const step = chainDecision({ rejected: r === null || r.rejected, menu: d.menu(), stopRequested: d.stopRequested() });
    if (step === "stop") {
      d.clearStop();
      return;
    }
    let next: Command;
    if (step === "autoOff") {
      d.clearStop();
      next = { type: "battle.auto", on: false };
    } else {
      next = { type: "battle.resolve" };
    }
    await d.yieldFrame();
    r = await d.run(next);
  }
}
