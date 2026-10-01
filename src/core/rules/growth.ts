// 成長（CH-61〜65、MG-01）。経験値の閾値、HP/MP の増分、レベルアップとレベルダウン。
// 乱数を引く順: HP のダイス → 習得の d100（spells.json 順）→ 保証の randInt（帯の順）。
// 渡された 1 人だけを処理し、life は見ない（誰を上げ下げするかは呼び出し側が決める）。
import type { ClassDef, Config, GameData, StatBlock } from "../data/index";
import { SCHOOLS } from "../data/index";
import { rollDie } from "../rng";
import { classOf } from "../state";
import type { Character, LevelRecord, RuleContext } from "../types";
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

/** CH-65: レベル 1 の hpMax（ダイスの最大値。乱数なし）。 */
export function initialHpMax(cls: ClassDef, stats: StatBlock, cfg: Config): number {
  return Math.max(cfg.growth.hpGainMin, cls.hpDie + vitBonus(stats.vit, cfg));
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

/** CH-65: max(hpGainMin, 1d(hpDie) + 生命力補正)。rng をちょうど 1 回使う。 */
export function rollHpGain(ctx: RuleContext, ch: Character): number {
  const cfg = ctx.data.config;
  const cls = classOf(ctx.data, ch.classId);
  const die = rollDie(ctx.state.rng, cls.hpDie);
  return Math.max(cfg.growth.hpGainMin, die + vitBonus(ch.stats.vit, cfg));
}

/** CH-64: exp ≥ expFor(level + 1)。 */
export function canLevelUp(ch: Character, data: GameData): boolean {
  return ch.exp >= expFor(ch.level + 1, classOf(data, ch.classId), data.config);
}

/** CH-61/63: 1 段上げる。初めて到達したレベルなら習得判定（MG-20）をする。 */
export function levelUpOnce(ctx: RuleContext, ch: Character): LevelRecord {
  const { data, events } = ctx;
  const cfg = data.config;
  const cls = classOf(data, ch.classId);
  const level = ch.level + 1;
  const hpGain = rollHpGain(ctx, ch);
  const mpGain = mpGainFor(cls, ch.stats, cfg);

  ch.level = level;
  ch.hpMax += hpGain;
  ch.hp += hpGain;
  ch.mpMax += mpGain;
  ch.mp += mpGain;
  const rec: LevelRecord = { level, hpGain, mpGain };
  ch.levelHistory.push({ ...rec });

  events.push({ kind: "levelUp", id: ch.id, level, hpGain, mpGain, hpMax: ch.hpMax, mpMax: ch.mpMax });
  events.push({ kind: "message", key: "town.inn.levelUp", params: { name: ch.name, level } });

  if (level > ch.maxLevelReached) {
    rollSpellLearning(ctx, ch, level);
    ch.maxLevelReached = level;
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
    ch.hp = Math.min(ch.hp, ch.hpMax);
    ch.mp = Math.min(ch.mp, ch.mpMax);
    events.push({ kind: "levelDown", id: ch.id, level: ch.level, hpMax: ch.hpMax, mpMax: ch.mpMax });
    n += 1;
  }
  return n;
}
