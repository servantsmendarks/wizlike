// キャラクター作成（CH-01〜06、CH-11、CH-21、CH-24、CH-30、CH-31）。game.new の本体。
// 自分で作る（CH-06）の作成中の問い合わせ（ボーナスの振り・配分・職業の可否・名前）もここに置く。どれも純粋で、
// 作成中の乱数（CH-11 のボーナス）は呼び出し側（表示層）が持つ RngState を受ける（作成中はまだ GameState が無いため）。
import type { Config, EquipSlot, GameData, PersonalityId, StatBlock, StatKey } from "../data/index";
import { EQUIP_SLOTS, PERSONALITY_IDS, STAT_KEYS } from "../data/index";
import { chance, randInt, rollDie, type RngState } from "../rng";
import { classOf, createItemInstance } from "../state";
import type { Character, CustomMember, PartySetup, RuleContext } from "../types";
import { initialHpMax, mpGainFor } from "./growth";

/** CH-10: 能力値の上限（【仮】ではない） */
export const STAT_MAX = 18;

/** CH-05: 前後の空白を除く。 */
export function normalizeName(raw: string): string {
  return raw.trim();
}

/** CH-05: 名前の長さはコードポイント数で数える（絵文字 1 つは 1 文字）。 */
export function nameLength(s: string): number {
  return [...s].length;
}

/** CH-05 / CH-06: trim 後 1..nameMaxLength 文字（コードポイント数）なら真 */
export function validCreationName(raw: string, data: GameData): boolean {
  const len = nameLength(normalizeName(raw));
  return len >= 1 && len <= data.config.creation.nameMaxLength;
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function isPersonalityId(x: unknown): x is PersonalityId {
  return typeof x === "string" && (PERSONALITY_IDS as readonly string[]).includes(x);
}

function raceBase(raceId: string, data: GameData): StatBlock {
  const r = data.races.find((x) => x.id === raceId);
  if (r === undefined) throw new Error(`unknown race: ${raceId}`);
  return r.baseStats;
}

/** CH-11: ボーナスポイント。乱数の順は rollDie(bonusDie) → chance(bonusBigChance)。bonusBase + 出目（当たれば + bonusBig） */
export function rollBonus(rng: RngState, cfg: Config["creation"]): number {
  const die = rollDie(rng, cfg.bonusDie);
  const big = chance(rng, cfg.bonusBigChance);
  return cfg.bonusBase + die + (big ? cfg.bonusBig : 0);
}

/** CH-11: 配分の様子。rows は STAT_KEYS の順 */
export type StatAllocation = {
  bonus: number;
  /** bonus − Σ(stats − 種族の基礎値) */
  remaining: number;
  /** remaining === 0（配分し終えた。職業へ進める） */
  complete: boolean;
  rows: { key: StatKey; base: number; value: number; canInc: boolean; canDec: boolean }[];
};

/** CH-11: canInc = remaining > 0 かつ value < STAT_MAX、canDec = value > base */
export function statAllocation(raceId: string, stats: StatBlock, bonus: number, data: GameData): StatAllocation {
  const base = raceBase(raceId, data);
  let spent = 0;
  for (const k of STAT_KEYS) spent += stats[k] - base[k];
  const remaining = bonus - spent;
  return {
    bonus,
    remaining,
    complete: remaining === 0,
    rows: STAT_KEYS.map((key) => ({
      key,
      base: base[key],
      value: stats[key],
      canInc: remaining > 0 && stats[key] < STAT_MAX,
      canDec: stats[key] > base[key],
    })),
  };
}

/** CH-11: 1 点の増減。できなければ同じ参照を返す */
export function adjustStat(
  raceId: string,
  stats: StatBlock,
  bonus: number,
  key: StatKey,
  delta: 1 | -1,
  data: GameData,
): StatBlock {
  const row = statAllocation(raceId, stats, bonus, data).rows.find((r) => r.key === key);
  if (row === undefined) return stats;
  if (delta === 1 ? !row.canInc : !row.canDec) return stats;
  return { ...stats, [key]: stats[key] + delta };
}

/** CH-21: 職業の一覧（classes.json の順）。ok = requirements をすべて満たす */
export function classOptions(
  stats: StatBlock,
  data: GameData,
): { classId: string; name: string; ok: boolean; requirements: Partial<StatBlock> }[] {
  return data.classes.map((c) => ({
    classId: c.id,
    name: c.name,
    ok: STAT_KEYS.every((k) => {
      const need = c.requirements[k];
      return need === undefined || stats[k] >= need;
    }),
    requirements: { ...c.requirements },
  }));
}

/** CH-06: 配分できるボーナスの最大（作成中の出目は表示層が持つので、core は取りうる最大で守る） */
function maxBonus(data: GameData): number {
  const c = data.config.creation;
  return c.bonusBase + c.bonusDie + c.bonusBig;
}

/**
 * game.new の PartySetup を検査する（CH-01, CH-05, CH-06, CH-30, CH-31, D4）。
 * kind が無ければおすすめ（簡易作成）、kind "custom" なら自分で作る。
 * 受け付けるなら null、受け付けないなら英語の理由。表示層からの壊れた入力にも備えて unknown を受ける。
 */
export function validatePartySetup(setup: unknown, data: GameData): string | null {
  if (!isObject(setup) || !Array.isArray(setup["members"])) return "invalid party setup";
  const kind = setup["kind"];
  if (kind !== undefined && kind !== "custom") return "invalid party setup";
  const members = setup["members"] as unknown[];
  const size = data.config.party.size;
  if (members.length !== size) return `party size must be ${size}`;
  for (let i = 0; i < members.length; i++) {
    const m = members[i];
    if (!isObject(m) || typeof m["name"] !== "string") return `invalid name at ${i}`;
    if (!validCreationName(m["name"], data)) return `invalid name at ${i}`;
  }
  for (let i = 0; i < members.length; i++) {
    const m = members[i] as Record<string, unknown>;
    const p = m["personality"];
    if (i === 0) {
      if (p !== null) return "leader must have no personality";
      continue;
    }
    if (p === null) return `personality required at ${i}`;
    if (p !== "random" && !isPersonalityId(p)) return `unknown personality at ${i}`;
  }
  if (kind === "custom") {
    for (let i = 0; i < members.length; i++) {
      const r = validateCustomMember(members[i] as Record<string, unknown>, i, data);
      if (r !== null) return r;
    }
  }
  return null;
}

/** CH-06: 1 人の種族・職業・能力値（基礎値以上 STAT_MAX 以下の整数、配分の合計 ≤ maxBonus）・職業の条件 */
function validateCustomMember(m: Record<string, unknown>, i: number, data: GameData): string | null {
  const raceId = m["raceId"];
  const race = typeof raceId === "string" ? data.races.find((r) => r.id === raceId) : undefined;
  if (race === undefined) return `unknown race at ${i}`;
  const classId = m["classId"];
  const cls = typeof classId === "string" ? data.classes.find((c) => c.id === classId) : undefined;
  if (cls === undefined) return `unknown class at ${i}`;
  const stats = m["stats"];
  if (!isObject(stats)) return `bad stats at ${i}`;
  let spent = 0;
  for (const k of STAT_KEYS) {
    const v = stats[k];
    if (typeof v !== "number" || !Number.isInteger(v) || v < race.baseStats[k] || v > STAT_MAX) return `bad stats at ${i}`;
    spent += v - race.baseStats[k];
  }
  if (spent > maxBonus(data)) return `too many bonus points at ${i}`;
  for (const k of STAT_KEYS) {
    const need = cls.requirements[k];
    if (need !== undefined && (stats[k] as number) < need) return `class requirements not met at ${i}`;
  }
  return null;
}

/** CH-30: "random" は data.personalities の配列順から randInt で選ぶ。null → null。それ以外はそのまま。 */
export function resolvePersonality(
  ctx: RuleContext,
  choice: PersonalityId | "random" | null,
): PersonalityId | null {
  if (choice !== "random") return choice;
  const list = ctx.data.personalities;
  const picked = list[randInt(ctx.state.rng, 0, list.length - 1)];
  if (picked === undefined) throw new Error("resolvePersonality: no personalities");
  return picked.id;
}

type Kit = { equipment: Partial<Record<EquipSlot, string>>; inventory: readonly string[]; knownSpells: readonly string[] };

/** 1 人を作る（共通部分）。装備と所持品の実体もここで作る。乱数は使わない。 */
function buildCharacter(
  ctx: RuleContext,
  o: {
    index: number;
    name: string;
    personality: PersonalityId | null;
    isLeader: boolean;
    raceId: string;
    classId: string;
    stats: StatBlock;
    kit: Kit;
  },
): Character {
  const { state, data } = ctx;
  const cfg = data.config;
  const cls = classOf(data, o.classId);
  const stats = { ...o.stats };
  const hpMax = initialHpMax(cls, stats, cfg);
  const mpMax = mpGainFor(cls, stats, cfg);

  const equipment: Character["equipment"] = {
    weapon: null,
    armor: null,
    shield: null,
    helm: null,
    gauntlet: null,
    accessory: null,
  };
  for (const slot of EQUIP_SLOTS) {
    const itemId = o.kit.equipment[slot];
    if (itemId !== undefined) equipment[slot] = createItemInstance(state, itemId, true);
  }
  const inventory = o.kit.inventory.map((itemId) => createItemInstance(state, itemId, true));

  return {
    id: `c${o.index + 1}`,
    name: o.name,
    raceId: o.raceId,
    classId: o.classId,
    personality: o.personality,
    isLeader: o.isLeader,
    stats,
    level: 1,
    exp: 0,
    maxLevelReached: 1,
    levelHistory: [],
    hp: hpMax,
    hpMax,
    mp: mpMax,
    mpMax,
    san: cfg.san.max,
    sanMax: cfg.san.max,
    life: "alive",
    status: [],
    knownSpells: [...o.kit.knownSpells],
    equipment,
    inventory,
    lastBattleInput: null,
  };
}

/** prototypeParty.members[index] から 1 人を作る（CH-05）。装備と所持品の実体もここで作る。乱数は使わない。 */
export function createCharacter(
  ctx: RuleContext,
  index: number,
  name: string,
  personality: PersonalityId | null,
): Character {
  const proto = ctx.data.config.prototypeParty.members[index];
  if (proto === undefined) throw new Error(`createCharacter: no prototype member at ${index}`);
  return buildCharacter(ctx, {
    index,
    name,
    personality,
    isLeader: proto.isLeader,
    raceId: proto.raceId,
    classId: proto.classId,
    stats: proto.stats,
    kit: proto,
  });
}

/**
 * CH-06 / CH-24: 自分で作った 1 人。能力値は m.stats（STAT_KEYS だけを写す）、装備・所持品・呪文は classes[].start。
 * isLeader は index === 0。乱数は使わない（性格の random は呼び出し側が先に決める）
 */
export function createCustomCharacter(
  ctx: RuleContext,
  index: number,
  m: CustomMember,
  personality: PersonalityId | null,
): Character {
  const cls = classOf(ctx.data, m.classId);
  const stats = Object.fromEntries(STAT_KEYS.map((k) => [k, m.stats[k]])) as StatBlock;
  return buildCharacter(ctx, {
    index,
    name: normalizeName(m.name),
    personality,
    isLeader: index === 0,
    raceId: m.raceId,
    classId: m.classId,
    stats,
    kit: cls.start,
  });
}

/** game.new の本体（validatePartySetup が null を返した前提）。 */
export function startNewGame(ctx: RuleContext, setup: PartySetup): void {
  const { state, data } = ctx;
  const size = data.config.party.size;
  if ("kind" in setup && setup.kind === "custom") {
    // CH-06 / CH-24: 性格の random はおすすめと同じく添字の順に state.rng で決める。所持金は start.gold の合計
    let gold = 0;
    for (let i = 0; i < size; i++) {
      const m = setup.members[i];
      if (m === undefined) throw new Error(`startNewGame: no setup member at ${i}`);
      const p = resolvePersonality(ctx, m.personality);
      state.party.push(createCustomCharacter(ctx, i, m, p));
      gold += classOf(data, m.classId).start.gold;
    }
    state.gold = gold;
  } else {
    for (let i = 0; i < size; i++) {
      const m = setup.members[i];
      if (m === undefined) throw new Error(`startNewGame: no setup member at ${i}`);
      const p = resolvePersonality(ctx, m.personality);
      state.party.push(createCharacter(ctx, i, normalizeName(m.name), p));
    }
    state.gold = data.config.prototypeParty.startingGold;
  }
  const first = data.dungeons[0];
  if (first === undefined) throw new Error("startNewGame: no dungeons");
  state.progress.unlockedDungeons = [first.id]; // DG-01
  state.screen = "town";
  state.townVisit = { mercyOffered: false }; // TW-30: game.new は town.enter をしない（救済の判定もしない）
  ctx.events.push({ kind: "screen", to: "town" });
}
