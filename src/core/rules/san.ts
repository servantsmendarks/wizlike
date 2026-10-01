// SAN の増減と閾値（CH-50〜54、TW-02 の回復）。乱数は使わない。
import type { Config, Personality } from "../data/index";
import { personalityOf } from "../state";
import type { Character, RuleContext } from "../types";

export type SanStage = "normal" | "uneasy" | "confused" | "broken";
export type SanLossTag = "fear" | "allyInjury" | "trap";
export type SanChange = {
  from: number;
  to: number;
  delta: number;
  stageBefore: SanStage;
  stageAfter: SanStage;
  /** 段階が下がった（悪化した）か。CB-43 のオート解除で使う */
  dropped: boolean;
};

/** CH-53: 上から順に判定する（排他）。比較の値は丸めない。 */
export function sanStage(san: number, sanMax: number, cfg: Config): SanStage {
  if (san <= 0) return "broken";
  if (san < sanMax * cfg.san.confusedRatio) return "confused";
  if (san < sanMax * cfg.san.uneasyRatio) return "uneasy";
  return "normal";
}

export function stageRank(s: SanStage): number {
  switch (s) {
    case "normal":
      return 0;
    case "uneasy":
      return 1;
    case "confused":
      return 2;
    case "broken":
      return 3;
  }
}

/** CH-54: 当てはまるタグの倍率を掛け合わせる。リーダー（null）は 1。未知のタグは無視。 */
export function sanLossMultiplier(p: Personality | null, tags: readonly string[]): number {
  if (p === null) return 1;
  let mul = 1;
  if (tags.includes("fear")) mul *= p.san.fearLossMul;
  if (tags.includes("allyInjury")) mul *= p.san.allyInjuryLossMul;
  if (tags.includes("trap")) mul *= p.san.trapLossMul;
  return mul;
}

/** CH-54: 掛け合わせた後に 1 回だけ切り捨てる。 */
export function sanLossAmount(amount: number, p: Personality | null, tags: readonly string[]): number {
  return Math.floor(amount * sanLossMultiplier(p, tags) + 1e-9);
}

function setSan(ctx: RuleContext, ch: Character, next: number): SanChange {
  const cfg = ctx.data.config;
  const from = ch.san;
  const stageBefore = sanStage(from, ch.sanMax, cfg);
  const to = Math.min(ch.sanMax, Math.max(0, next));
  ch.san = to;
  const delta = to - from;
  const stageAfter = sanStage(to, ch.sanMax, cfg);
  const dropped = stageRank(stageAfter) > stageRank(stageBefore);
  if (delta !== 0) {
    ctx.events.push({ kind: "sanChanged", id: ch.id, delta, san: to });
  }
  if (dropped) {
    ctx.events.push({ kind: "message", key: `san.${stageAfter}`, params: { name: ch.name } });
  }
  return { from, to, delta, stageBefore, stageAfter, dropped };
}

/** amount は 0 以上の有限数。負なら増減の向きが逆になり CH-53 の虚脱の増加禁止をすり抜けるので、前提の崩れとして Error。 */
function assertSanAmount(amount: number): void {
  if (!Number.isFinite(amount) || amount < 0) throw new Error(`san amount must be non-negative: ${amount}`);
}

/** CH-51/54: 減少。amount は 0 以上（負や非有限は Error）。tags は攻撃の tags や ["allyInjury"]。 */
export function loseSan(ctx: RuleContext, ch: Character, amount: number, tags: readonly string[] = []): SanChange {
  assertSanAmount(amount);
  const p = personalityOf(ctx.data, ch.personality);
  return setSan(ctx, ch, ch.san - sanLossAmount(amount, p, tags));
}

/** CH-52: 増加。amount は 0 以上（負や非有限は Error）。虚脱（0）中は変化しない（CH-53）。 */
export function gainSan(ctx: RuleContext, ch: Character, amount: number): SanChange {
  assertSanAmount(amount);
  if (ch.san === 0) return setSan(ctx, ch, 0);
  return setSan(ctx, ch, ch.san + amount);
}

/** events.json の符号付きの value。負なら耐性なしで減少、正なら増加、0 なら変化なし。 */
export function applySanValue(ctx: RuleContext, ch: Character, value: number): SanChange {
  if (value < 0) return loseSan(ctx, ch, -value, []);
  if (value > 0) return gainSan(ctx, ch, value);
  return setSan(ctx, ch, ch.san);
}

/** TW-02: 虚脱からでも sanMax に戻す。 */
export function restoreSan(ctx: RuleContext, ch: Character): SanChange {
  return setSan(ctx, ch, ch.sanMax);
}
