// SAN の増減と閾値（CH-50〜54、TW-02 の回復、TW-15 の士気の超過回復）。乱数は使わない。
// 上限: ふだんは sanCapOf（実効の sanMax）。士気の超過（overSan）の間だけ sanMax を超えてよく、減少は超過分から引き、
// 増加は sanCapOf で止まり、sanCapOf 以上なら増えない（CH-50 / CH-52 / TW-15）。
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

/**
 * CH-53: 段 s の上限の境の 1 つ下の SAN（uneasy → ceil(sanMax×uneasyRatio)−1、confused → ceil(sanMax×confusedRatio)−1、
 * broken → 0）。0 未満にはしない。debug.sanDown（UI-57）が使う
 */
export function sanJustBelow(stage: "uneasy" | "confused" | "broken", sanMax: number, cfg: Config): number {
  if (stage === "broken") return 0;
  const ratio = stage === "uneasy" ? cfg.san.uneasyRatio : cfg.san.confusedRatio;
  return Math.max(0, Math.ceil(sanMax * ratio) - 1);
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

/** CH-50 / CH-14: 実効の sanMax（M7 の A の時点では素の sanMax。B で装備の最大 SAN を足す）。超過回復の基準と、増加・丸めの上限 */
export function sanCapOf(ch: Character): number {
  return ch.sanMax;
}

/** next を 0..cap に収めて書く。cap は呼び出し側が決める（ふだんは sanCapOf、減少と変化なしは超過を残すため max(sanCapOf, 今の値)） */
function setSan(ctx: RuleContext, ch: Character, next: number, cap: number): SanChange {
  const cfg = ctx.data.config;
  const from = ch.san;
  const stageBefore = sanStage(from, ch.sanMax, cfg);
  const to = Math.min(cap, Math.max(0, next));
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
  return setSan(ctx, ch, ch.san - sanLossAmount(amount, p, tags), Math.max(sanCapOf(ch), ch.san));
}

/**
 * CH-52: 増加。amount は 0 以上（負や非有限は Error）。虚脱（0）中は変化しない（CH-53）。
 * M7（TW-15）: sanCapOf で止まり、今が sanCapOf 以上（士気の超過中）なら変化しない（超過分は回復で戻らない）
 */
export function gainSan(ctx: RuleContext, ch: Character, amount: number): SanChange {
  assertSanAmount(amount);
  if (ch.san === 0 || ch.san >= sanCapOf(ch)) return unchanged(ctx, ch);
  return setSan(ctx, ch, ch.san + amount, sanCapOf(ch));
}

/** 変化なし（イベントは出ない。超過中でも丸めない） */
function unchanged(ctx: RuleContext, ch: Character): SanChange {
  return setSan(ctx, ch, ch.san, Math.max(sanCapOf(ch), ch.san));
}

/** events.json の符号付きの value。負なら耐性なしで減少、正なら増加、0 なら変化なし。 */
export function applySanValue(ctx: RuleContext, ch: Character, value: number): SanChange {
  if (value < 0) return loseSan(ctx, ch, -value, []);
  if (value > 0) return gainSan(ctx, ch, value);
  return unchanged(ctx, ch);
}

/**
 * CH-52 / A8: 財宝入手（迷宮で金を得た 1 回）。並び順に、life alive かつ san > 0 で
 * personality.san.treasureGain > 0 の者へ gainSan(treasureGain)。乱数なし。
 */
export function gainTreasureSan(ctx: RuleContext): void {
  for (const ch of ctx.state.party) {
    if (ch.life !== "alive" || ch.san <= 0) continue;
    const g = personalityOf(ctx.data, ch.personality)?.san.treasureGain ?? 0;
    if (g > 0) gainSan(ctx, ch, g);
  }
}

/** TW-02: 虚脱からでも sanMax（sanCapOf）に戻す。士気の超過分（TW-15）もここで sanMax に丸める */
export function restoreSan(ctx: RuleContext, ch: Character): SanChange {
  return setSan(ctx, ch, sanCapOf(ch), sanCapOf(ch));
}

/**
 * TW-02（restoreOnTown が偽のとき）: 士気の超過分だけを sanMax（sanCapOf）に丸める。sanMax 以下なら変化しない
 */
export function capSan(ctx: RuleContext, ch: Character): SanChange {
  return setSan(ctx, ch, ch.san, sanCapOf(ch));
}

/**
 * TW-15: 士気の超過回復。SAN を sanCapOf + over にする（今の方が高ければ変えない。下げない）。over は 0 以上の整数（負は Error）。
 * 虚脱（0）でも特別扱いしない（街では TW-02 で戻っている）
 */
export function overSan(ctx: RuleContext, ch: Character, over: number): SanChange {
  assertSanAmount(over);
  const target = sanCapOf(ch) + over;
  if (ch.san >= target) return unchanged(ctx, ch);
  return setSan(ctx, ch, target, target);
}
