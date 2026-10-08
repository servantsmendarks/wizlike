// 成長（CH-61〜65、MG-01）。経験値の閾値、HP/MP の増分、レベルアップとレベルダウン。
// 乱数を引く順: HP のダイス → 能力値の d100 × 6（全体の最高到達レベルを超えたときだけ）→ 習得の d100（spells.json 順）→ 保証の randInt（帯の順）。
// 渡された 1 人だけを処理し、life は見ない（誰を上げ下げするかは呼び出し側が決める）。
import type { ClassDef, Config, GameData, StatBlock, StatKey } from "../data/index";
import { SCHOOLS, STAT_KEYS } from "../data/index";
import { chance, rollDie } from "../rng";
import { classOf } from "../state";
import type { Character, LevelRecord, RuleContext } from "../types";
import { effectiveStats, equipStats } from "./equip-stats";
import { relatedStatKey, rollSpellLearning } from "./learning";

/** CH-64（D6）: レベル L にいるのに必要な累計 EXP。expFor(1) = 0。 */
export function expFor(level: number, cls: ClassDef, cfg: Config): number {
  if (level <= 1) return 0;
  const g = cfg.growth;
  return Math.floor(g.expBase * g.expGrowth ** (level - 2) * cls.expMultiplier + 1e-9);
}

/** CH-65: 生命力補正。負も floor。 */
export function vitBonus(vit: number, cfg: Config): number {
  return Math.floor((vit - cfg.growth.hpVitPivot) / cfg.growth.hpVitDivisor);
}

/**
 * CH-65: レベル 1 の hpMax（乱数なし）。hpDie + max(0, 生命力補正) + level1Bonus（ユーザー決定）。
 * hpGainMin はレベルアップの増分にだけ使う。
 */
export function initialHpMax(cls: ClassDef, stats: StatBlock, cfg: Config): number {
  return cls.hpDie + Math.max(0, vitBonus(stats.vit, cfg)) + cfg.growth.level1Bonus;
}

/** MG-01: 関連能力値。cls.spells の系統の能力値の最大。系統が無ければ null。 */
export function mpStatFor(cls: ClassDef, stats: StatBlock): number | null {
  let best: number | null = null;
  for (const school of SCHOOLS) {
    if (cls.spells[school] === undefined) continue;
    const v = stats[relatedStatKey(school)];
    if (best === null || v > best) best = v;
  }
  return best;
}

/** MG-01: 1 レベル分の MP 増分（乱数なし）。レベル 1 の mpMax も同じ値。 */
export function mpGainFor(cls: ClassDef, stats: StatBlock, cfg: Config): number {
  const s = mpStatFor(cls, stats);
  const bonus = s === null ? 0 : Math.max(0, Math.floor((s - cfg.growth.mpStatPivot) / cfg.growth.mpStatDivisor));
  return cls.mpPerLevel + bonus;
}

/** CH-65: max(hpGainMin, 1d(hpDie) + 生命力補正)。生命力は実効の値（CH-13）。rng をちょうど 1 回使う。 */
export function rollHpGain(ctx: RuleContext, ch: Character): number {
  const cfg = ctx.data.config;
  const cls = classOf(ctx.data, ch.classId);
  const die = rollDie(ctx.state.rng, cls.hpDie);
  return Math.max(cfg.growth.hpGainMin, die + vitBonus(effectiveStats(ctx.state, ctx.data, ch).vit, cfg));
}

/** CH-63（SV-04 v5）: 職業 classId（既定は今の職業）で到達した最高レベル。記録が無ければ 0（まだその職業になったことが無い） */
export function maxLevelReachedIn(ch: Character, classId: string = ch.classId): number {
  return Object.prototype.hasOwnProperty.call(ch.maxLevelReached, classId) ? (ch.maxLevelReached[classId] ?? 0) : 0;
}

/** U5: 全体の最高到達レベル（職業ごとの記録の最大。記録が無ければ 0）。能力値の成長の判定（CH-61）が使う */
export function peakLevelReached(ch: Character): number {
  return Math.max(0, ...Object.values(ch.maxLevelReached));
}

/** CH-64: exp ≥ expFor(level + 1)。 */
export function canLevelUp(ch: Character, data: GameData): boolean {
  return ch.exp >= expFor(ch.level + 1, classOf(data, ch.classId), data.config);
}

/**
 * CH-80（M10）: レベルアップ可（表示用）。life alive で、かつ canLevelUp（exp ≥ expFor(level + 1)）。宿（TW-04）が上げる者と同じ条件。
 * canLevelUp は life を見ない（levelUpWhilePossible のループの条件）ので別に置く
 */
export function levelUpReady(ch: Character, data: GameData): boolean {
  return ch.life === "alive" && canLevelUp(ch, data);
}

/**
 * CH-61（M10）: 能力値の成長。STAT_KEYS の順に chance(statUpChance) を 6 回振り、当たれば素の stats を +1（statCap まで）。
 * 上限の能力値も振る（消費は常に 6 回）。上がった能力値を STAT_KEYS の順に返す。
 */
export function rollStatGains(ctx: RuleContext, ch: Character): StatKey[] {
  const g = ctx.data.config.growth;
  const gains: StatKey[] = [];
  for (const key of STAT_KEYS) {
    const hit = chance(ctx.state.rng, g.statUpChance);
    if (hit && ch.stats[key] < g.statCap) {
      ch.stats[key] += 1;
      gains.push(key);
    }
  }
  return gains;
}

/**
 * CH-61/63: 1 段上げる。乱数の順は HP のダイス → 能力値 6 回（全体の最高到達レベルを超えたときだけ。U5）→ 習得判定（今の職業で初到達のときだけ）。
 * HP・MP の増分は能力値を上げる前の値で求める。語りは levelUp → hpUp → mpUp（mpGain > 0）→ statUp.{stat}（上がったものだけ）。
 * statGrowth が偽なら能力値の判定（CH-61）をしない（乱数も引かない）。UI-57 の debug.levels（M12。U-6）だけが偽で呼ぶ。
 */
export function levelUpOnce(ctx: RuleContext, ch: Character, statGrowth = true): LevelRecord {
  const { data, events } = ctx;
  const cfg = data.config;
  const cls = classOf(data, ch.classId);
  const level = ch.level + 1;
  const hpGain = rollHpGain(ctx, ch);
  const mpGain = mpGainFor(cls, effectiveStats(ctx.state, data, ch), cfg); // CH-13
  const before = { ...ch.stats };
  const statGains = statGrowth && level > peakLevelReached(ch) ? rollStatGains(ctx, ch) : [];

  ch.level = level;
  ch.hpMax += hpGain;
  ch.hp += hpGain;
  ch.mpMax += mpGain;
  ch.mp += mpGain;
  const rec: LevelRecord = { level, hpGain, mpGain };
  ch.levelHistory.push({ ...rec });

  // CH-14: イベントの最大値は実効の値（表示層がそのまま描く。保存するのは素の値）
  const es = equipStats(ctx.state, data, ch);
  events.push({
    kind: "levelUp",
    id: ch.id,
    level,
    hpGain,
    mpGain,
    hpMax: es.hpMax,
    mpMax: es.mpMax,
    hp: ch.hp,
    mp: ch.mp,
    statGains,
  });
  events.push({ kind: "message", key: "town.inn.levelUp", params: { name: ch.name, level } });
  events.push({ kind: "message", key: "town.inn.hpUp", params: { gain: hpGain, max: es.hpMax } });
  if (mpGain > 0) events.push({ kind: "message", key: "town.inn.mpUp", params: { gain: mpGain, max: es.mpMax } });
  for (const key of statGains) {
    events.push({ kind: "message", key: `town.inn.statUp.${key}`, params: { from: before[key], to: ch.stats[key] } });
  }

  if (level > maxLevelReachedIn(ch)) {
    rollSpellLearning(ctx, ch, level);
    ch.maxLevelReached[ch.classId] = level;
  }
  return rec;
}

/** TW-04: 上げられる間 levelUpOnce を繰り返す。上がった段数を返す。 */
export function levelUpWhilePossible(ctx: RuleContext, ch: Character): number {
  let n = 0;
  while (canLevelUp(ch, ctx.data)) {
    levelUpOnce(ctx, ch);
    n += 1;
  }
  return n;
}

/** CH-62: level > 1 かつ exp < expFor(level) の間、1 段ずつ下げる。下がった段数を返す。乱数は使わない。 */
export function levelDownWhileBelow(ctx: RuleContext, ch: Character): number {
  const { data, events } = ctx;
  const cls = classOf(data, ch.classId);
  let n = 0;
  while (ch.level > 1 && ch.exp < expFor(ch.level, cls, data.config)) {
    const rec = ch.levelHistory.pop();
    if (rec === undefined || rec.level !== ch.level) {
      throw new Error(`levelDownWhileBelow: levelHistory does not match level ${ch.level} of ${ch.id}`);
    }
    ch.hpMax -= rec.hpGain;
    ch.mpMax -= rec.mpGain;
    ch.level -= 1;
    const es = equipStats(ctx.state, data, ch); // CH-14: 実効の最大値で止める
    ch.hp = Math.min(ch.hp, es.hpMax);
    ch.mp = Math.min(ch.mp, es.mpMax);
    events.push({ kind: "levelDown", id: ch.id, level: ch.level, hpMax: es.hpMax, mpMax: es.mpMax, hp: ch.hp, mp: ch.mp });
    n += 1;
  }
  return n;
}
