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

/**
 * TW-04 / TW-15（M7）。sanOver / goodWeight / judgeBonus / gossip のどれかが 0 / false でないランクに泊まると士気が立つ
 * （rules/town.ts raisesMorale）。sanOver は SAN の超過回復の量、goodWeight は衝動の結果（EV-30）の good の重みの加算、
 * judgeBonus は制止判定（EV-21）の制止者の側の加算、gossip は宿の主人の噂話（次の dungeon.enter で図鑑の 1 種を鑑定済みにする）
 */
export type InnRank = {
  id: string;
  name: string;
  cost: number;
  hpRatio: number;
  sanOver: number;
  goodWeight: number;
  judgeBonus: number;
  gossip: boolean;
};

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
  /** nameMaxLength: CH-05 名前の上限（trim 後のコードポイント数）【仮】 */
  creation: { bonusBase: number; bonusDie: number; bonusBigChance: number; bonusBig: number; nameMaxLength: number };
  /** mpStatPivot / mpStatDivisor: MG-01 の MP 補正【仮】 */
  growth: {
    expBase: number;
    expGrowth: number;
    hpVitPivot: number;
    hpVitDivisor: number;
    hpGainMin: number;
    /** CH-65: レベル 1 の hpMax = hpDie + max(0, 生命力補正) + これ【仮】 */
    level1Bonus: number;
    mpStatPivot: number;
    mpStatDivisor: number;
  };
  learning: { base: number; perLevelDiff: number; guaranteeDiff: number; statPivot: number; statPerPoint: number };
  dungeon: {
    /** DG-05: dungeons[].rooms を省略したときの部屋数 [min, max] */
    defaultRooms: [number, number];
    /** DG-05: 部屋の一辺 [min, max]【仮】 */
    roomSize: [number, number];
    /** DG-05: 1 部屋あたりの配置の試行回数【仮】 */
    roomAttempts: number;
    /** DG-05: 部屋ごとの扉の本数 [min, max]。min >= 1【仮】 */
    doorsPerRoom: [number, number];
    /** DG-05: ループ化する行き止まりの割合 [min, max]（0..1、min <= max。階ごとに整数パーセントを 1 つ引く）【仮】 */
    braidRatio: [number, number];
    /** DG-05: 迷路で直進できるときに直進する確率（0..1）【仮】 */
    straightBias: number;
    /** DG-12: 視野の奥行き（1..3。UI-20 の座標表が 0..3）【仮】 */
    viewDepth: number;
    /** DG-20: 罠の数値。pitDice は落とし穴のダメージ（ダイス記法）【仮】 */
    trap: { pitDice: string };
  };
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
    /** CB-05【仮】: 知恵補正 = max(0, 行動可能な味方の iq 最大 − 10) × この値 */
    identifyIqPerPoint: number;
    statusLukPerPoint: number;
    sleepWakeChance: number;
    sleepHitBonus: number;
    /** CB-32【仮】: ラウンド終了時に眠っている者が自然に覚める確率（%） */
    sleepNaturalWake: number;
    poisonDamagePerTick: number;
    fleeBase: number;
    fleeAgiMul: number;
    chestChance: number;
    chestTrapChance: number;
    /** CB-52【仮】: M3 の仮実装の宝箱の金のダイス */
    chestGoldDice: string;
    unarmedDice: string;
    autoInterrupt: { hpRatio: number };
    /** CB-44【仮】: 慎重（defendBelowHalf）のオートは hp < hpMax × この値で防御 */
    autoDefendHpRatio: number;
  };
  san: {
    max: number;
    /** 減少量（正の数） */
    floorDescend: number;
    /** 減少量（正の数） */
    unidentifiedGroup: number;
    /** 減少量（正の数） */
    allyDeath: number;
    /** 減少量（正の数）。罠の発動時、生存メンバー全員（CH-51） */
    trap: number;
    uneasyRatio: number;
    confusedRatio: number;
    uneasyChance: number;
    confusedChance: number;
    /** CH-53 / CB-45【仮】: 「防御または対象ランダムの攻撃」で防御を選ぶ確率（%） */
    randomDefendChance: number;
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
  /** TW-04 / TW-14（M5.5）: tavernEventTurns は酒場のイベントが起きうるまでの冒険のターン数【仮】、tavernEventChance は見回すごとの確率%【仮】 */
  town: { innRanks: InnRank[]; tavernEventTurns: number; tavernEventChance: number };
  events: { impulseThreshold: number; stopSanGain: number; confusedLureWeight: number };
  save: { maxGames: number; schemaVersion: number };
  input: { swipeThresholdPx: number; holdRepeatMs: number; edgeDeadZonePx: number };
  ui: {
    textSpeedMs: number;
    diceStepMs: number;
    flashMs: number;
    shakeMs: number;
    viewFadeMs: number;
    /** ui.md §2 の縦の区切り（論理 px）【仮】。合計は stage.height */
    layout: { header: number; view: number; message: number; party: number; controls: number };
    /** UI-43 / UI-11: メッセージ履歴に残す件数【仮】 */
    messageHistory: number;
    /** UI-45: オートの戦闘の拍の待ち（ms）の既定値【仮】。表示層が選択肢（settings.ts の AUTO_BEAT_CHOICES）の最も近い値に寄せる */
    autoBeatMs: number;
    /** SV-23: 「保存できません」の帯の高さ（論理 px）【仮】。帯はヘッダーの直下に置く */
    saveBannerHeight: number;
    /** UI-25: 地図のタップを探索済みのセルの中心に吸着させる距離（論理 px）。ユーザーが決めた値（【仮】ではない） */
    mapSnapPx: number;
  };
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
  /** 表示用の略称（ui §2 のパーティ欄）。1〜3 文字の ASCII 英大文字 */
  abbr: string;
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
  /** CH-24（M5.5）: 自分で作ったキャラクター（CH-06）の開始の装備・所持品・呪文と、パーティの所持金への寄与【仮】 */
  start: ClassStart;
};

/** CH-24: 職業ごとの開始の持ち物。簡易作成（CH-05）は prototypeParty を使い、これは使わない */
export type ClassStart = {
  equipment: Partial<Record<EquipSlot, string>>;
  inventory: string[];
  knownSpells: string[];
  gold: number;
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

// ---- equipment-bases.json（IT-02。M7） ----

type EquipmentBaseCommon = {
  id: string;
  name: string;
  /** IT-12: 未鑑定の実体の表示名 */
  unidentifiedName: string;
  /** 装備できる職業。空なら全職業（CH-75） */
  classes: string[];
  /** IT-60 の基本額 */
  price: number;
  /** IT-62: 店に並ぶ流通レベルの下限 */
  shopMinLevel: number;
};

/** 武器のベース。caster（術者用武器。IT-22）は ranged と両立しない */
export type WeaponBase = EquipmentBaseCommon & { slot: "weapon"; damage: string; ranged: boolean; caster: boolean };

/** 防具・盾・兜・小手・装飾のベース（CB-20 の ac） */
export type ArmorLikeBase = EquipmentBaseCommon & { slot: Exclude<EquipSlot, "weapon">; ac: number };

export type EquipmentBase = WeaponBase | ArmorLikeBase;

// ---- item-options.json（IT-33 / IT-34。M7） ----

export const OPTION_EFFECT_TYPES = [
  "stat",
  "hpMax",
  "mpMax",
  "hit",
  "damage",
  "ac",
  "initiative",
  "sanMax",
  "fearLoss",
  "statusResist",
  "trapDetect",
  "identifyRate",
  "goldLuck",
] as const;
export type OptionEffectType = (typeof OPTION_EFFECT_TYPES)[number];

export type OptionEffect =
  | { type: "stat"; stat: StatKey }
  | { type: "statusResist"; status: StatusId }
  | { type: Exclude<OptionEffectType, "stat" | "statusResist"> };

export const OPTION_UNITS = ["", "%"] as const;
export type OptionUnit = (typeof OPTION_UNITS)[number];

export type ItemOption = {
  id: string;
  name: string;
  effect: OptionEffect;
  unit: OptionUnit;
  /** 段階 1〜3 の値（正の整数で単調非減少。IT-33） */
  values: [number, number, number];
  weight: number;
};

export type ItemOptions = { options: ItemOption[] };

// ---- uniques.json（IT-03 / IT-40。M7） ----

export const SKILL_TYPES = [
  "mpCostDown",
  "extraAttack",
  "reachFromBack",
  "initiativeUp",
  "fearImmune",
  "lifeSteal",
  "autoIdentify",
  "walkRegen",
  "judgeBonus",
] as const;
export type SkillType = (typeof SKILL_TYPES)[number];

/** IT-40: value を使わない種類（value は 0） */
export const VALUELESS_SKILL_TYPES: readonly SkillType[] = ["reachFromBack", "fearImmune", "autoIdentify"];

export type UniqueDef = {
  id: string;
  name: string;
  /** equipment-bases.json の id（部位・職業・ranged・caster を引き継ぐ） */
  base: string;
  /** ベースが武器のときだけ */
  damage?: string;
  /** ベースが術者用武器（caster）のときだけ（MG-33） */
  magicPower?: number;
  /** ベースが武器以外のときだけ */
  ac?: number;
  skill: { type: SkillType; value: number };
  /** IT-33: オプションの段階の固定値 1..3 */
  optionTier: 1 | 2 | 3;
  price: number;
  description: string;
};

// ---- drops.json（IT-50〜53。M7） ----

export type DropEntry = { base: string; weight: number } | { unique: string; weight: number };

export type DropTable = { id: string; itemChance: number; rolls: number; entries: DropEntry[] };

export type Drops = {
  tables: DropTable[];
  /** ダンジョン id → 階番号の文字列 "1".."floors" → 表の id（全ダンジョンの全階） */
  chest: Record<string, Record<string, string>>;
  /** ダンジョン id → 表の id（全ダンジョン） */
  boss: Record<string, string>;
};

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
  /** UI-62: 自分で作るの性格の行の 2 行目（27 字以内） */
  shortDescription: string;
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
  /** DG-05: 部屋数 [min, max]。省略時は config.dungeon.defaultRooms */
  rooms?: [number, number];
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
  /** データの説明（表示には使わない。A9） */
  label: string;
  /** strings.json のキー。PendingChoice の labelKey に入れる。規約 event.<eventId>.choice.<choiceId>（A9） */
  labelKey: string;
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

// ---- tavern.json（TW-13 / TW-14。M5.5） ----

/** TW-14: 酒場のイベントの効果（EV-32 の部分集合。san の対象は party だけ）。EventEffect に代入できる形 */
export type TavernEffect =
  | { type: "gold"; dice: string }
  | { type: "san"; value: number; target: "party" }
  | { type: "message"; key: string }
  | { type: "nothing" };

export type TavernEventDef = {
  id: string;
  /** データの説明（表示には使わない） */
  name: string;
  /** weightedIndex の重み（正の整数） */
  weight: number;
  /** strings.json のキー（差し込みなし） */
  text: string;
  effects: TavernEffect[];
};

export type TavernData = {
  /** TW-13: 見回すの語り（strings.json のキー。差し込みなし）。randInt で 1 つ */
  lookTexts: string[];
  events: TavernEventDef[];
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
  equipmentBases: EquipmentBase[];
  itemOptions: ItemOptions;
  uniques: UniqueDef[];
  drops: Drops;
  personalities: Personality[];
  penaltyTable: PenaltyTable;
  dungeons: DungeonDef[];
  events: EventDef[];
  tavern: TavernData;
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
  equipmentBases: "equipment-bases.json",
  itemOptions: "item-options.json",
  uniques: "uniques.json",
  drops: "drops.json",
  personalities: "personalities.json",
  penaltyTable: "penalty-table.json",
  dungeons: "dungeons.json",
  events: "events.json",
  tavern: "tavern.json",
  strings: "strings.json",
};
