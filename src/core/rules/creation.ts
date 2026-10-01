// キャラクター作成（CH-01〜05、CH-30、CH-31）。game.new の本体。
import type { GameData, PersonalityId } from "../data/index";
import { EQUIP_SLOTS, PERSONALITY_IDS } from "../data/index";
import { randInt } from "../rng";
import { classOf, createItemInstance } from "../state";
import type { Character, PartySetup, RuleContext } from "../types";
import { initialHpMax, mpGainFor } from "./growth";

/** CH-05: 前後の空白を除く。 */
export function normalizeName(raw: string): string {
  return raw.trim();
}

/** CH-05: 名前の長さはコードポイント数で数える（絵文字 1 つは 1 文字）。 */
export function nameLength(s: string): number {
  return [...s].length;
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function isPersonalityId(x: unknown): x is PersonalityId {
  return typeof x === "string" && (PERSONALITY_IDS as readonly string[]).includes(x);
}

/**
 * game.new の PartySetup を検査する（CH-01, CH-05, CH-30, CH-31, D4）。
 * 受け付けるなら null、受け付けないなら英語の理由。表示層からの壊れた入力にも備えて unknown を受ける。
 */
export function validatePartySetup(setup: unknown, data: GameData): string | null {
  if (!isObject(setup) || !Array.isArray(setup["members"])) return "invalid party setup";
  const members = setup["members"] as unknown[];
  const size = data.config.party.size;
  if (members.length !== size) return `party size must be ${size}`;
  const maxLen = data.config.creation.nameMaxLength;
  for (let i = 0; i < members.length; i++) {
    const m = members[i];
    if (!isObject(m) || typeof m["name"] !== "string") return `invalid name at ${i}`;
    const len = nameLength(normalizeName(m["name"]));
    if (len < 1 || len > maxLen) return `invalid name at ${i}`;
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

/** prototypeParty.members[index] から 1 人を作る（CH-05）。装備と所持品の実体もここで作る。乱数は使わない。 */
export function createCharacter(
  ctx: RuleContext,
  index: number,
  name: string,
  personality: PersonalityId | null,
): Character {
  const { state, data } = ctx;
  const cfg = data.config;
  const proto = cfg.prototypeParty.members[index];
  if (proto === undefined) throw new Error(`createCharacter: no prototype member at ${index}`);
  const cls = classOf(data, proto.classId);
  const stats = { ...proto.stats };
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
    const itemId = proto.equipment[slot];
    if (itemId !== undefined) equipment[slot] = createItemInstance(state, itemId, true);
  }
  const inventory = proto.inventory.map((itemId) => createItemInstance(state, itemId, true));

  return {
    id: `c${index + 1}`,
    name,
    raceId: proto.raceId,
    classId: proto.classId,
    personality,
    isLeader: proto.isLeader,
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
    knownSpells: [...proto.knownSpells],
    equipment,
    inventory,
    lastBattleInput: null,
  };
}

/** game.new の本体（validatePartySetup が null を返した前提）。 */
export function startNewGame(ctx: RuleContext, setup: PartySetup): void {
  const { state, data } = ctx;
  const size = data.config.party.size;
  for (let i = 0; i < size; i++) {
    const m = setup.members[i];
    if (m === undefined) throw new Error(`startNewGame: no setup member at ${i}`);
    const p = resolvePersonality(ctx, m.personality);
    state.party.push(createCharacter(ctx, i, normalizeName(m.name), p));
  }
  state.gold = data.config.prototypeParty.startingGold;
  const first = data.dungeons[0];
  if (first === undefined) throw new Error("startNewGame: no dungeons");
  state.progress.unlockedDungeons = [first.id]; // DG-01
  state.screen = "town";
  state.townVisit = { mercyOffered: false }; // TW-30: game.new は town.enter をしない（救済の判定もしない）
  ctx.events.push({ kind: "screen", to: "town" });
}
