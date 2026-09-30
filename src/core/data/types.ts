// data/*.json の形をそのまま表した型。loadGameData の検証を通ったデータだけがこの型を名乗る。
// 列挙の値の一覧（*_VALUES）は検証とルールの両方から使う。

export const STAT_KEYS = ["str", "iq", "pie", "vit", "agi", "luk"] as const;
export type StatKey = (typeof STAT_KEYS)[number];
/** 能力値 6 つ（CH-10）。すべて整数 1..18。 */
export type StatBlock = Record<StatKey, number>;

export const SCHOOLS = ["mage", "priest"] as const;
export type School = (typeof SCHOOLS)[number];

export const STATUS_IDS = ["poison", "paralysis", "sleep", "stone"] as const;
export type StatusId = (typeof STATUS_IDS)[number];

export const EQUIP_SLOTS = ["weapon", "armor", "shield", "helm", "gauntlet", "accessory"] as const;
export type EquipSlot = (typeof EQUIP_SLOTS)[number];

export const USABLE_IN = ["battle", "field", "both"] as const;
export type UsableIn = (typeof USABLE_IN)[number];

export const LURE_TAGS = ["treasure", "unknown", "danger", "weak"] as const;
export type LureTag = (typeof LURE_TAGS)[number];
/** 誘いの重み（EV-03）。各 0..3。 */
export type LureWeights = Record<LureTag, number>;

export const SPELL_TARGETS = ["enemy", "enemyGroup", "allEnemies", "ally", "party", "self", "none"] as const;
export type SpellTarget = (typeof SPELL_TARGETS)[number];

export const PERSONALITY_IDS = ["cautious", "reckless", "greedy", "normal"] as const;
export type PersonalityId = (typeof PERSONALITY_IDS)[number];

export const TRAP_IDS = ["pit", "spinner", "teleport"] as const;
export type TrapId = (typeof TRAP_IDS)[number];

/** 寺院で治療できる状態（TW-07）。 */
export const CURABLE_STATUS_IDS = ["poison", "paralysis", "stone"] as const;
export type CurableStatusId = (typeof CURABLE_STATUS_IDS)[number];

// ---- config.json ----

export type InnRank = { id: string; name: string; cost: number; hpRatio: number; mpRatio: number };

export type PrototypeMember = {
  defaultName: string;
  raceId: string;
  classId: string;
  isLeader: boolean;
  stats: StatBlock;
  equipment: Partial<Record<EquipSlot, string>>;
  inventory: string[];
  knownSpells: string[];
};

export type Config = {
  stage: { width: number; height: number };
  party: { size: number; frontRow: number };
  inventory: { slotsPerCharacter: number };
  creation: { bonusBase: number; bonusDie: number; bonusBigChance: number; bonusBig: number };
  growth: { expBase: number; expGrowth: number; hpVitPivot: number; hpVitDivisor: number; hpGainMin: number };
  learning: { base: number; perLevelDiff: number; guaranteeDiff: number; statPivot: number; statPerPoint: number };
  combat: {
    hitBase: number;
    hitPerLevel: number;
    hitPerAC: number;
    hitMin: number;
    hitMax: number;
    acBase: number;
    acMin: number;
    maxEnemyGroups: number;
    maxPerGroup: number;
    surpriseDiff: number;
    identifyChancePerRound: number;
    identifyKills: number;
    statusLukPerPoint: number;
    sleepWakeChance: number;
    sleepHitBonus: number;
    poisonDamagePerTick: number;
    fleeBase: number;
    fleeAgiMul: number;
    chestChance: number;
    chestTrapChance: number;
    unarmedDice: string;
    autoInterrupt: { hpRatio: number };
  };
  san: {
    max: number;
    /** 減少量（正の数） */
    floorDescend: number;
    /** 減少量（正の数） */
    unidentifiedGroup: number;
    /** 減少量（正の数） */
    allyDeath: number;
    uneasyRatio: number;
    confusedRatio: number;
    uneasyChance: number;
    confusedChance: number;
    restoreOnTown: boolean;
  };
  wipe: { reviveHpRatio: number; clearStatus: boolean };
  economy: {
    sellRatio: number;
    identifyFee: number;
    templeSuccessBase: number;
    templeSuccessPerVit: number;
    templeSuccessMax: number;
    templeCostPerLevel: number;
    darkCostPerLevel: number;
    cureCost: Record<CurableStatusId, number>;
    uncurseCost: number;
  };
  town: { innRanks: InnRank[] };
  events: { impulseThreshold: number; stopSanGain: number };
  save: { maxGames: number; schemaVersion: number };
  input: { swipeThresholdPx: number; holdRepeatMs: number; edgeDeadZonePx: number };
  ui: { textSpeedMs: number; diceStepMs: number; flashMs: number; shakeMs: number; viewFadeMs: number };
  prototypeParty: { startingGold: number; members: PrototypeMember[] };
};

// ---- races.json ----

export type Race = { id: string; name: string; baseStats: StatBlock; description: string };

// ---- classes.json ----

export const CLASS_TIERS = ["basic", "advanced"] as const;
export type ClassTier = (typeof CLASS_TIERS)[number];
export const CLASS_ABILITIES = ["disarm", "identify"] as const;
export type ClassAbility = (typeof CLASS_ABILITIES)[number];

export type ClassDef = {
  id: string;
  name: string;
  tier: ClassTier;
  requirements: Partial<Record<StatKey, number>>;
  hpDie: number;
  mpPerLevel: number;
  /** 系統 → 習得を始めるキャラクターレベル（MG-11） */
  spells: Partial<Record<School, number>>;
  learnMod: number;
  attacksPerLevels: number;
  maxAttacks: number;
  abilities: ClassAbility[];
  expMultiplier: number;
  description: string;
};

// ---- spells.json ----

export type SpellEffect =
  | { type: "damage"; dice: string }
  | { type: "heal"; dice: string }
  | { type: "status"; status: StatusId; chance: number }
  | { type: "acBonus"; value: number }
  | { type: "cureStatus"; status: StatusId }
  | { type: "identify" }
  | { type: "return" }
  | { type: "resurrect" }
  | { type: "sanHeal"; value: number };

export type Spell = {
  id: string;
  name: string;
  school: School;
  level: number;
  learnLevel: number;
  mp: number;
  target: SpellTarget;
  usableIn: UsableIn;
  effect: SpellEffect;
  bookOnly: boolean;
  /** 省略可（magic.md §6）。 */
  tags?: string[];
  description: string;
};

// ---- monsters.json ----

/** 1 要素につき 1 回攻撃する（CB-24）。status と chance は必ず組。tags は sanDrain があるときだけ。 */
export type MonsterAttack = {
  dice: string;
  status?: StatusId;
  chance?: number;
  sanDrain?: number;
  tags?: string[];
};

export type Monster = {
  id: string;
  name: string;
  unidentifiedName: string;
  sprite: string;
  level: number;
  hp: string;
  ac: number;
  agi: number;
  attacks: MonsterAttack[];
  exp: number;
  gold: string;
  groupSize: string;
  special: { undead?: boolean; boss?: boolean };
  resist: Partial<Record<StatusId, boolean>>;
  tags: string[];
  floors: number[];
  description: string;
};

// ---- items.json ----

export const ITEM_TYPES = [...EQUIP_SLOTS, "consumable", "book"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

type ItemBase = {
  id: string;
  name: string;
  price: number;
  stock: number;
  infinite: boolean;
  cursed: boolean;
  unidentifiedName?: string;
  description?: string;
};

export type WeaponItem = ItemBase & {
  type: "weapon";
  slot: EquipSlot;
  classes: string[];
  ranged: boolean;
  damage: string;
};

export type ArmorLikeItem = ItemBase & {
  type: "armor" | "shield" | "helm" | "gauntlet" | "accessory";
  slot: EquipSlot;
  classes: string[];
  ac: number;
  /** accessory だけ。仕様に定義なし。 */
  sanResist?: number;
};

export type EquipItem = WeaponItem | ArmorLikeItem;

export type ItemEffect =
  | { type: "heal"; dice: string; target: SpellTarget }
  | { type: "cureStatus"; status: StatusId; target: SpellTarget }
  | { type: "return" }
  | { type: "learn"; spell: string };

export type ConsumableItem = ItemBase & {
  type: "consumable";
  usableIn: UsableIn;
  effect: Exclude<ItemEffect, { type: "learn" }>;
};

export type BookItem = ItemBase & {
  type: "book";
  usableIn: UsableIn;
  effect: Extract<ItemEffect, { type: "learn" }>;
};

export type Item = WeaponItem | ArmorLikeItem | ConsumableItem | BookItem;

// ---- personalities.json ----

export const AUTO_BATTLE_STYLES = ["none", "defendBelowHalf", "alwaysAttack", "targetRichest"] as const;
export type AutoBattleStyle = (typeof AUTO_BATTLE_STYLES)[number];

export type Personality = {
  id: PersonalityId;
  name: string;
  lure: LureWeights;
  canStop: boolean;
  benefits: {
    trapDetect: number;
    ambushAvoid: number;
    initiative: number;
    damage: number;
    chestQuality: number;
    hiddenTreasure: number;
  };
  san: {
    trapLossMul: number;
    allyInjuryLossMul: number;
    fearLossMul: number;
    treasureGain: number;
    disobeyBelowHalf: number;
  };
  autoBattle: AutoBattleStyle;
  description: string;
};

// ---- penalty-table.json ----

export type PenaltyBand = {
  min: number;
  max: number;
  name: string;
  goldLossRatio: number;
  itemLoss: number;
  expLossRatio: number;
  /** strings.json のキー */
  text: string;
};

export type PenaltyTable = { dice: string; note: string; bands: PenaltyBand[] };

// ---- dungeons.json ----

export type EncounterEntry = { monster: string; weight: number };

export type DungeonDef = {
  id: string;
  name: string;
  floors: number;
  width: number;
  height: number;
  rooms: [number, number];
  unlock: string | null;
  encounterRate: { room: number; corridor: number };
  /** キーは階番号の文字列 "1".."floors" */
  encounterTable: Record<string, EncounterEntry[]>;
  /** キーは階番号の文字列。要素 i はグループ数 i+1 の重み */
  groupCountWeights: Record<string, number[]>;
  boss: { monster: string };
  events: string[];
  traps: TrapId[];
  trapsPerFloor: [number, number];
  teleporterFloors: number[];
  onClear: { unlockDungeon: string | null; shopStock: string[] };
  description: string;
};

// ---- events.json ----

export const EVENT_KINDS = ["choice", "impulse", "mixed"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
export const OUTCOME_QUALITIES = ["good", "bad", "neutral"] as const;
export type OutcomeQuality = (typeof OUTCOME_QUALITIES)[number];

export type EventEffect =
  | { type: "gold"; dice: string }
  | { type: "item"; itemId: string }
  | { type: "item"; table: string }
  | { type: "damage"; dice: string; target: "actor" | "party" }
  | { type: "san"; value: number; target: "actor" | "party" | "others" }
  | { type: "revealFloor" }
  | { type: "revealStairs" }
  | { type: "consumeItem"; itemId: string; target: "actor" | "party"; optional?: boolean }
  | { type: "encounter"; monster: string; count: string | number }
  | { type: "status"; status: StatusId; target: "actor" | "party" | "others" }
  | { type: "message"; key: string }
  | { type: "nothing" };

export type EventEffectType = EventEffect["type"];

export type ImpulseOutcome = {
  weight: number;
  quality: OutcomeQuality;
  /** strings.json のキー */
  text: string;
  effects: EventEffect[];
  requires?: "impulse";
  impulseBonus?: EventEffect[];
};

export type EventChoice = {
  id: string;
  label: string;
  /** strings.json のキー */
  text: string;
  effects: EventEffect[];
};

export type EventDef = {
  id: string;
  name: string;
  kind: EventKind;
  lure: LureWeights;
  stat: StatKey;
  stopCheck: boolean;
  text: { intro: string; impulse: string };
  impulseOutcomes: ImpulseOutcome[];
  choices: EventChoice[];
};

// ---- strings.json ----

export type Strings = Record<string, string>;

// ---- 全体 ----

export type GameData = {
  config: Config;
  races: Race[];
  classes: ClassDef[];
  spells: Spell[];
  monsters: Monster[];
  items: Item[];
  personalities: Personality[];
  penaltyTable: PenaltyTable;
  dungeons: DungeonDef[];
  events: EventDef[];
  strings: Strings;
};

/** loadGameData に渡す生データ。各値は JSON.parse（または JSON import）した結果そのまま。 */
export type RawGameData = { [K in keyof GameData]: unknown };

/** RawGameData の各キーに対応する data/ 以下のファイル名。 */
export const DATA_FILES: { readonly [K in keyof RawGameData]: string } = {
  config: "config.json",
  races: "races.json",
  classes: "classes.json",
  spells: "spells.json",
  monsters: "monsters.json",
  items: "items.json",
  personalities: "personalities.json",
  penaltyTable: "penalty-table.json",
  dungeons: "dungeons.json",
  events: "events.json",
  strings: "strings.json",
};
