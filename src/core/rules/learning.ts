// 呪文の習得（MG-20〜26）。レベルアップ時の判定（growth.levelUpOnce から呼ぶ）と、魔法書による習得。
// 乱数を引く順: 判定の d100 を spells.json の順にすべて振ってから、保証の randInt を帯の順に引く。
import type { ClassDef, Config, GameData, School, Spell, StatKey } from "../data/index";
import { randInt } from "../rng";
import { classOf, destroyItemInstance, itemOf, memberById, spellOf } from "../state";
import type { Character, GameState, RuleContext } from "../types";

/** MG-22: 呪文の系統で関連能力値を決める（mage → 知恵、priest → 信仰心）。 */
export function relatedStatKey(school: School): StatKey {
  return school === "mage" ? "iq" : "pie";
}

/** MG-22: 成功率。上限 100、下限なし。L − learnLevel ≥ guaranteeDiff なら 100。 */
export function learnRate(ch: Character, cls: ClassDef, spell: Spell, level: number, cfg: Config): number {
  const lc = cfg.learning;
  const diff = level - spell.learnLevel;
  if (diff >= lc.guaranteeDiff) return 100;
  const statMod = (ch.stats[relatedStatKey(spell.school)] - lc.statPivot) * lc.statPerPoint;
  return Math.min(100, lc.base + lc.perLevelDiff * diff + statMod + cls.learnMod);
}

/** MG-21（D5）: roll は 1..100。roll ≤ rate なら習得。 */
export function isLearnSuccess(roll: number, rate: number): boolean {
  return roll <= rate;
}

/** MG-20: レベル L での判定対象。spells.json の配列順。 */
export function learnCandidates(ch: Character, cls: ClassDef, level: number, data: GameData): Spell[] {
  return data.spells.filter((sp) => {
    const start = cls.spells[sp.school];
    if (start === undefined) return false;
    if (level < start) return false;
    if (sp.learnLevel > level) return false;
    if (ch.knownSpells.includes(sp.id)) return false;
    if (sp.bookOnly) return false;
    return true;
  });
}

/**
 * MG-23: 帯 (school, spellLevel) の解放レベル = max(系統の開始レベル, 帯の bookOnly でない呪文の learnLevel の最小値)。
 * 職業がその系統を使えないか、帯に bookOnly でない呪文が無ければ null（保証の対象にならない）。
 */
export function bandUnlockLevel(cls: ClassDef, school: School, spellLevel: number, data: GameData): number | null {
  const start = cls.spells[school];
  if (start === undefined) return null;
  let min: number | null = null;
  for (const sp of data.spells) {
    if (sp.school !== school || sp.level !== spellLevel || sp.bookOnly) continue;
    if (min === null || sp.learnLevel < min) min = sp.learnLevel;
  }
  return min === null ? null : Math.max(start, min);
}

/**
 * MG-20〜24: レベル L に初めて到達したときの習得判定。新しく覚えた呪文の id を覚えた順に返す。
 * 呼び出し側（growth.levelUpOnce）が CH-63 の条件（L > maxLevelReached）を確かめる。
 */
export function rollSpellLearning(ctx: RuleContext, ch: Character, level: number): string[] {
  const { state, data, events } = ctx;
  const cfg = data.config;
  const cls = classOf(data, ch.classId);
  const cands = learnCandidates(ch, cls, level, data);
  const learned: string[] = [];

  // MG-21/22/24: 1 呪文につき d100 を 1 回。
  for (const sp of cands) {
    const params = { name: ch.name, spell: sp.name };
    events.push({ kind: "message", key: "town.inn.learnRoll", params });
    const roll = randInt(state.rng, 1, 100);
    events.push({ kind: "dice", label: "town.inn.learnRoll", dice: [roll], total: roll });
    if (isLearnSuccess(roll, learnRate(ch, cls, sp, level, cfg))) {
      ch.knownSpells.push(sp.id);
      learned.push(sp.id);
      events.push({ kind: "spellLearned", id: ch.id, spellId: sp.id, via: "roll" });
      events.push({ kind: "message", key: "town.inn.learned", params });
    } else {
      events.push({ kind: "message", key: "town.inn.notLearned", params });
    }
  }

  // MG-23: 解放レベルが L の帯だけを、cands に初めて現れた順に見る。
  const bandKey = (sp: Spell): string => `${sp.school}:${sp.level}`;
  const bands: string[] = [];
  for (const sp of cands) {
    const k = bandKey(sp);
    if (bands.includes(k)) continue;
    if (bandUnlockLevel(cls, sp.school, sp.level, data) === level) bands.push(k);
  }
  for (const k of bands) {
    const pool = cands.filter((sp) => bandKey(sp) === k);
    if (pool.some((sp) => learned.includes(sp.id))) continue;
    const pick = pool[randInt(state.rng, 0, pool.length - 1)];
    if (pick === undefined) throw new Error(`rollSpellLearning: empty guarantee pool ${k}`);
    ch.knownSpells.push(pick.id);
    learned.push(pick.id);
    events.push({ kind: "spellLearned", id: ch.id, spellId: pick.id, via: "guarantee" });
    events.push({ kind: "message", key: "town.inn.learned", params: { name: ch.name, spell: pick.name } });
  }
  return learned;
}

/** MG-25: 魔法書を使えるか。使えるなら null、使えないなら英語の理由。 */
export function checkLearnFromBook(
  state: GameState,
  memberId: string,
  instanceId: string,
  data: GameData,
): string | null {
  const ch = memberById(state, memberId);
  if (ch === null) return "no such member";
  const inst = state.items[instanceId];
  if (!ch.inventory.includes(instanceId) || inst === undefined) return "item not in inventory";
  const item = itemOf(data, inst.itemId);
  if (item.type !== "book") return "not a book";
  const spell = spellOf(data, item.effect.spell);
  const cls = classOf(data, ch.classId);
  if (cls.spells[spell.school] === undefined) return "class cannot learn this school";
  if (ch.knownSpells.includes(spell.id)) return "spell already known";
  return null;
}

/** MG-25: checkLearnFromBook が null を返した前提で呼ぶ。呪文を覚え、魔法書の実体を消費する。 */
export function learnFromBook(ctx: RuleContext, ch: Character, instanceId: string): void {
  const { state, data, events } = ctx;
  const inst = state.items[instanceId];
  if (inst === undefined) throw new Error(`learnFromBook: unknown item instance: ${instanceId}`);
  const item = itemOf(data, inst.itemId);
  if (item.type !== "book") throw new Error(`learnFromBook: not a book: ${inst.itemId}`);
  const spell = spellOf(data, item.effect.spell);
  ch.knownSpells.push(spell.id);
  destroyItemInstance(state, ch, instanceId);
  events.push({ kind: "spellLearned", id: ch.id, spellId: spell.id, via: "book" });
  events.push({ kind: "message", key: "town.inn.learned", params: { name: ch.name, spell: spell.name } });
}
