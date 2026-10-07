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

export const PLACEHOLDER_COLORS = ["white", "gray", "dim", "lightGreen", "darkGreen", "red", "orange", "sky", "yellow", "violet", "teal"] as const;
export type PlaceholderColor = (typeof PLACEHOLDER_COLORS)[number];

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

/** IT-30: 希少度の行。id は normal / fine / rare / legendary の順で 4 件（検証する） */
export type RarityDef = { id: "normal" | "fine" | "rare" | "legendary"; weight: number; options: number };

/** config.items（items.md §10。M7）【仮】 */
export type ItemsConfig = {
  /** IT-30 */
  rarities: RarityDef[];
  /** IT-32: 呪われる確率（%） */
  curseChance: number;
  /** IT-33: 汎用のオプションの段階 = min(3, 1 + floor(Lv ÷ これ)) */
  optionTierStep: number;
  /** IT-53: ドロップの Lv の振れ幅 */
  dropLevelSpread: number;
  /** IT-20: 武器のダメージ +floor(Lv ÷ これ) */
  weaponLvPerDamage: number;
  /** IT-21: 防具・盾・兜・小手の AC −floor(Lv ÷ これ) */
  armorLvPerAc: number;
  /** IT-22: 術者用武器の魔法攻撃力 +floor(Lv ÷ これ) */
  casterLvPerPower: number;
  /** IT-60 / IT-61 */
  levelPriceRatio: number;
  /** IT-61: 正のオプションの段階 1〜3 ごとの売値の加算 */
  optionSellValue: [number, number, number];
  /** IT-64: 倉庫の容量 */
  warehouseSlots: number;
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

/**
 * CB-63 / CB-64（M11）【仮】: 成功率 = clamp(min, max, base + (盗賊なら thiefBonus) + (agi − statPivot) × agiMul
 * + (luk − statPivot) × lukMul + trapDetect − 危険度 × dangerMul)
 */
export type ChestRateConfig = {
  base: number;
  statPivot: number;
  thiefBonus: number;
  agiMul: number;
  lukMul: number;
  dangerMul: number;
  min: number;
  max: number;
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
    /** CH-61: レベルアップ（全体の最高到達レベルを超えたとき）で各能力値が +1 される確率（%）【仮】 */
    statUpChance: number;
    /** CH-61: 成長で上がる能力値の上限【仮】（作成の STAT_MAX とは別） */
    statCap: number;
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
    /** CB-20。M7 で下限 acMin は撤廃した（IT-24。命中率の hitMin〜hitMax のクランプに任せる） */
    acBase: number;
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
    /** CB-51 / CB-52【仮】: 部屋のセル（roomId が非 null）のランダム遭遇に勝ったときの宝箱の確率（%） */
    chestChance: number;
    /** CB-51 / CB-52【仮】: 通路のセル（部屋でないセル）のランダム遭遇に勝ったときの宝箱の確率（%） */
    chestChanceCorridor: number;
    /** CB-52【仮】: M3 の仮実装の宝箱の金のダイス */
    chestGoldDice: string;
    unarmedDice: string;
    autoInterrupt: { hpRatio: number };
    /** CB-44【仮】: 慎重（defendBelowHalf）のオートは hp < hpMax × この値で防御 */
    autoDefendHpRatio: number;
    /** CB-26【仮】: 飛行の敵への味方の通常攻撃の命中率の補正（武器の reach ごと。clamp の内側に足す） */
    flyingHit: Record<WeaponReach, number>;
    /** CB-21【仮】: reach ranged の命中率に (自分の agi − 相手の agi) × この値 を足す */
    rangedHitAgiMul: number;
    /** CB-21【仮】: reach ranged の命中率に (自分の luk − この値) を足す */
    rangedHitLukPivot: number;
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
  /**
   * CH-77（M10）【仮】: 司教の鑑定。成功率 = base + (知恵（実効）− iqPivot) × iqPerPoint + perLevelStep × floor(レベル / levelStep)
   * − rarityPenalty[希少度] −（ユニークなら uniquePenalty）を min〜max に収める。消費 MP は mpCost。
   * 失敗: 迷宮内なら SAN −failSanDungeon。呪われた品なら possessChance % で取り憑く（装備できなければ SAN −possessSan）
   */
  identify: {
    mpCost: number;
    base: number;
    iqPivot: number;
    iqPerPoint: number;
    levelStep: number;
    perLevelStep: number;
    rarityPenalty: Record<RarityDef["id"], number>;
    uniquePenalty: number;
    min: number;
    max: number;
    failSanDungeon: number;
    possessChance: number;
    possessSan: number;
  };
  /** TW-09 / CH-22（M10）【仮】: 転職の料金（0 なら無料） */
  classChange: { fee: number };
  economy: {
    sellRatio: number;
    /** IT-65【仮】: 店の鑑定料 = max(identifyFeeMin, floor(見た目の品種（Lv0・通常）の売値 × identifyFeeRatio)) */
    identifyFeeRatio: number;
    identifyFeeMin: number;
    templeSuccessBase: number;
    templeSuccessPerVit: number;
    templeSuccessMax: number;
    templeCostPerLevel: number;
    darkCostPerLevel: number;
    cureCost: Record<CurableStatusId, number>;
    uncurseCost: number;
    /** TW-17（M7）【仮】: 強化の料金 = upgradeBase × (対象Lv + 1) */
    upgradeBase: number;
    /** TW-17【仮】: 成功率の基礎（%） */
    upgradeRateBase: number;
    /** TW-17【仮】: 触媒 1 個あたりの成功率（%）。対象より Lv が低い触媒は upgradeDecay^(Lv 差) を掛ける */
    upgradeRatePerCatalyst: number;
    /** TW-17【仮】: Lv 差 1 あたりの減衰（0..1） */
    upgradeDecay: number;
    /** TW-17【仮】: 触媒の最大個数 */
    upgradeMaxCatalysts: number;
  };
  /** items.md §10（M7）の数値【仮】 */
  items: ItemsConfig;
  /** TW-04 / TW-14（M5.5）: tavernEventTurns は酒場のイベントが起きうるまでの冒険のターン数【仮】、tavernEventChance は見回すごとの確率%【仮】 */
  town: { innRanks: InnRank[]; tavernEventTurns: number; tavernEventChance: number };
  /** EV-11 / EV-14（M11）: 衝動確率の誘いの倍率 lureMul（%）、上限 cap・下限 floor（%）【仮】。stopSanGain は EV-22、confusedLureWeight は EV-14【仮】 */
  events: { lureMul: number; cap: number; floor: number; stopSanGain: number; confusedLureWeight: number };
  /** combat.md §6b（M11）宝箱の数値【仮】 */
  chest: {
    /** CB-61: 罠なしの箱の確率（%） */
    noTrapChance: number;
    /** IT-56: 危険度 1 あたりの希少度の 1 段の上振れの確率（%） */
    rarityUpPerDanger: number;
    /** CB-63: 調べるの成功率の式の定数 */
    inspect: ChestRateConfig;
    /** CB-64: 解除の成功率の式の定数 */
    disarm: ChestRateConfig;
    /** CB-63: 調べるに失敗したとき、2 回目の d100 がこれ以下なら作動（失敗のうちの %） */
    triggerChance: number;
    /** CB-63: 調べるに失敗して作動しなかったとき、別の罠の名前を告げる段の幅（失敗のうちの %。triggerChance + これ ≤ 100） */
    wrongNameChance: number;
    /** CB-64（U-4）: 名前が合って解除の判定に失敗したときに作動する確率（%）。作動しなければ再挑戦できる */
    disarmFailTrigger: number;
    /** EV-16: 宝箱の衝動判定の spec（decideImpulse に渡す） */
    impulse: { lure: LureWeights; stat: StatKey; impulseClasses?: string[] };
  };
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
    /** UI-57 / SV-24（M8）: 設定の曲の音量の既定値（0〜10 の段）【仮】 */
    musicVolume: number;
    /** UI-57 / SV-24（M8）: 設定の効果音の音量の既定値（0〜10 の段）【仮】 */
    sfxVolume: number;
  };
  /**
   * UI-63 / UI-65（M8）: 基準の音量（0..1）【仮】。実際の音量 = 基準 × 設定の段 / 10。
   * musicGain は曲の合成結果に、sfxGain は効果音（ZzFX の buildSamples の結果）に掛ける
   */
  audio: {
    musicGain: number;
    sfxGain: number;
    /** UI-63（M9.5）: 曲の区間を合成するレート（Hz）44100（CONV §1 の基準と同じ。工房の render.py の WAV と一致）。AudioBuffer のレート */
    sampleRate: number;
    /** UI-63（M9.5）: 先読みの区間の数（鳴っている区間の後ろに予約しておく数） */
    prefetchBars: number;
    /** UI-63（M9.5）: 合成済みの区間を持っておくループする曲の数（直近の曲から） */
    keepSongs: number;
    /** UI-63（M9.5）: 鳴らし始めの区間の時刻を currentTime + baseLatency より先にする分（ms）【仮】40。0..100 */
    startLeadMs: number;
    /** UI-63（M9.5）: Web Worker の暖機で合成して捨てる固定のダミー区間の長さ（秒）【仮】3。0..10。0 なら暖機しない */
    warmupSeconds: number;
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
  /** CB-05 / UI-60: 未鑑定の系統（unknown-kinds.json の id） */
  unknownKind: string;
  sprite: string;
  level: number;
  hp: string;
  ac: number;
  agi: number;
  attacks: MonsterAttack[];
  exp: number;
  gold: string;
  groupSize: string;
  /** flying: CB-26（M9。2026-10-06 に改めた）。宙にいて、味方の通常攻撃の命中率に武器の reach ごとの補正（combat.flyingHit）が付く */
  special: { undead?: boolean; boss?: boolean; flying?: boolean };
  resist: Partial<Record<StatusId, boolean>>;
  tags: string[];
  description: string;
};

// ---- unknown-kinds.json（CB-05 / UI-60。M7） ----

/** 未鑑定の系統。name は未鑑定の表示名、sprite は unknown_<id>、placeholderColor は PNG が無いときの矩形の色（表示層のパレットの色名） */
export type UnknownKind = {
  id: string;
  name: string;
  sprite: string;
  placeholderColor: PlaceholderColor;
};

// ---- items.json（M7 の B2 から消耗品と魔法書だけ。装備は equipment-bases.json。IT-01） ----

export const ITEM_TYPES = ["consumable", "book"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

type ItemBase = {
  id: string;
  name: string;
  price: number;
  infinite: boolean;
  unidentifiedName?: string;
  description?: string;
};

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

export type Item = ConsumableItem | BookItem;

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

/** IT-25 / CB-13（2026-10-06）: 武器の届き方。melee 近接（既定）/ long 長柄（後衛から使える）/ ranged 飛び道具（後衛から使える） */
export const WEAPON_REACHES = ["melee", "long", "ranged"] as const;
export type WeaponReach = (typeof WEAPON_REACHES)[number];

/** 武器のベース。caster（術者用武器。IT-22）の reach は melee だけ */
export type WeaponBase = EquipmentBaseCommon & {
  slot: "weapon";
  damage: string;
  /** IT-25: 省略は melee（weaponReach） */
  reach?: WeaponReach;
  caster: boolean;
  /** IT-22（M9）: 汎用の術者用武器のベースの魔法攻撃力（caster のときだけ書ける。省略は 0） */
  magicPower?: number;
};

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
  "magicPower",
] as const;
export type OptionEffectType = (typeof OPTION_EFFECT_TYPES)[number];

/**
 * IT-36（M10）: オプションの適用品種。weapon は術者用でない武器、caster は術者用武器（杖。IT-22）、ほかは装備の部位。
 * 品の品種はベース（ユニークなら uniques[].base のベース）の slot と caster で決める（optionKindOf）
 */
export const OPTION_KINDS = ["weapon", "caster", "armor", "shield", "helm", "gauntlet", "accessory"] as const;
export type OptionKind = (typeof OPTION_KINDS)[number];

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
  /** IT-36（M10）: 付けられる品種（空でなく重複なし）。省略はすべての品種 */
  appliesTo?: OptionKind[];
};

export type ItemOptions = { options: ItemOption[] };

/** IT-36: ベースの品種（slot が weapon なら caster で weapon / caster を分け、それ以外は slot そのもの） */
export function optionKindOf(base: EquipmentBase): OptionKind {
  if (base.slot === "weapon") return base.caster ? "caster" : "weapon";
  return base.slot;
}

/** IT-36: オプション o を品種 kind の品に付けられるか（appliesTo の省略はすべての品種） */
export function optionAppliesTo(o: Pick<ItemOption, "appliesTo">, kind: OptionKind): boolean {
  return o.appliesTo === undefined || o.appliesTo.includes(kind);
}

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

/** IT-51: 汎用ベース・ユニーク・魔法書（items.json の type book。IT-55。M9）のどれか 1 つ */
export type DropEntry = { base: string; weight: number } | { unique: string; weight: number } | { item: string; weight: number };

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
  /** DG-35（M9）: 真なら「準備中」の枠。開放はされるが入場できない（配列の末尾の側・floors 1・onClear.unlockDungeon null） */
  placeholder?: boolean;
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
  /** UI-63（M8。2026-10-06）: このダンジョンの迷宮の曲（audio.json の music.songs）。省略は audio.json の screenSongs.dungeon */
  song?: string;
  events: string[];
  traps: TrapId[];
  trapsPerFloor: [number, number];
  /** DG-23（M11）: 階ごとの宝箱のセルの個数 [min, max] */
  chestsPerFloor: [number, number];
  /** CB-61（M11）: 宝箱の罠の危険度の上限 1..4 */
  chestTrapMaxDanger: number;
  /** CB-61（M11）: 危険度 1..4 の重み（長さ 4。上限より上の段は 0。合計 > 0） */
  chestTrapDangerWeights: number[];
  teleporterFloors: number[];
  /** shopLevel: IT-62 の流通レベル（初回クリアで progress.shopLevel をこれ以上にする。M7。v3 → v4 の移行でも使う）【仮】 */
  onClear: { unlockDungeon: string | null; shopLevel: number };
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
  /** EV-04（M11）: 衝動できる職業の id の一覧。省略時は全職業 */
  impulseClasses?: string[];
  text: { intro: string; impulse: string };
  impulseOutcomes: ImpulseOutcome[];
  choices: EventChoice[];
};

// ---- chest-traps.json（CB-61 / CB-62。M11） ----

export const CHEST_TRAP_KINDS = ["damage", "status", "alarm", "teleport", "san"] as const;
export type ChestTrapKind = (typeof CHEST_TRAP_KINDS)[number];
/** CB-61: 宝箱の罠の危険度は 1..4 */
export const CHEST_TRAP_MAX_DANGER = 4;

/** CB-62: 宝箱の罠の効果。target one は作動させた人 1 人、all は生存者全員 */
export type ChestTrapEffect =
  | { kind: "damage"; target: "one" | "all"; dice: string; status?: StatusId }
  | { kind: "status"; target: "all"; status: StatusId; chance: number }
  | { kind: "alarm" }
  | { kind: "teleport" }
  | { kind: "san"; target: "all"; amount: number };

/** CB-62: 宝箱の罠。床の罠（TRAP_IDS）とは別の id 空間。name は罠の名前の strings キー、語りは chest.trap.<id> */
export type ChestTrapDef = { id: string; name: string; danger: number; effect: ChestTrapEffect };

// ---- rivalries.json（EV-70〜76。M11） ----

export const RIVALRY_TRIGGERS = ["chest"] as const;
export type RivalryTrigger = (typeof RIVALRY_TRIGGERS)[number];

/**
 * EV-70: 職業の掛け合い。classId の行動可能なメンバーが 2 人以上いるとき、契機（trigger）で chance % で起きる。
 * contest の能力値の合計 + dice の最大が担当。担当の調べるに bonus.inspect、負けた者に SAN −loserSan、担当の調べるの失敗で SAN −failSan
 */
export type RivalryDef = {
  id: string;
  trigger: RivalryTrigger;
  classId: string;
  chance: number;
  contest: { stats: StatKey[]; dice: string };
  bonus: { inspect: number };
  loserSan: number;
  failSan: number;
  /** strings キー。start は {a}{b}、win は {winner}{loser}、fail は {name} を差し込む */
  text: { start: string; win: string; fail: string };
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

// ---- wavetables.json（UI-63。docs/audio/CONVENTIONS.md §1。工房の instruments/wavetables.json の複製） ----

/** 波形テーブル。program は Program Change の値、data は samples 個の 0..(2^depth − 1) */
export type Wave = { program: number; data: number[] };
/** ch4 のノイズの種類。note は ch4 のノート番号、clock は LFSR を進める速さ（Hz） */
export type NoiseKind = { note: number; clock: number };
export type Wavetables = {
  samples: number;
  depth: number;
  waves: Record<string, Wave>;
  noise: Record<string, NoiseKind>;
};

// ---- audio.json（UI-63 / UI-65 / UI-66。M8） ----

/** 場面の曲を持てる画面（core/types の Screen と同じ値）。battle は screenSongs に置かず battleSongs / bossSong で決める（2026-10-06） */
export const AUDIO_SCREENS = ["title", "town", "dungeon", "battle", "event"] as const;
export type AudioScreen = (typeof AUDIO_SCREENS)[number];

/**
 * UI-63（2026-10-06）: 施設ごとの曲を持てる街の施設（表示層の townFacility の id から town を除いたもの。
 * data に施設の一覧が無いので、ここに写す。表示層の値と同じことをテストで確かめる）
 */
export const AUDIO_FACILITIES = ["tavern", "inn", "temple", "dark", "gate", "shop"] as const;
export type AudioFacility = (typeof AUDIO_FACILITIES)[number];

/** 音の契機にできる GameEvent の kind（UI-66。encounter 以降は 2026-10-06、chestFound は 2026-10-08（M11）に足した） */
export const CUE_EVENTS = [
  "message",
  "attack",
  "hpChanged",
  "spell",
  "floorChanged",
  "battleEnd",
  "levelUp",
  "wipe",
  "encounter",
  "blocked",
  "statusChanged",
  "sanChanged",
  "lifeChanged",
  "dice",
  "spellLearned",
  "chestFound",
] as const;
export type CueEvent = (typeof CUE_EVENTS)[number];

export const CUE_RESULTS = ["win", "flee", "wipe"] as const;
export const CUE_TARGETS = ["enemy", "party"] as const;
export const CUE_LIVES = ["alive", "dead", "ash"] as const;

export type SoundCue = {
  event: CueEvent;
  /** event "message"（必須。strings.json のキー）と "dice"（任意。label のキー）のときだけ */
  key?: string;
  /** event "message" のときだけ。params.rarity（鑑定の語りの品の希少度）がこれのときだけ */
  rarity?: RarityDef["id"];
  /** event "battleEnd" のときだけ */
  result?: (typeof CUE_RESULTS)[number];
  /** event "battleEnd" のときだけ。真ならボス戦の終わり、偽ならボス戦でない戦闘の終わりだけ（ボスかは直前の encounter で表示層が覚える） */
  boss?: boolean;
  /** event "attack" のときだけ。命中したか */
  hit?: boolean;
  /** event "attack"（targetId）・"hpChanged" / "statusChanged" / "sanChanged" / "lifeChanged"（id）のときだけ。enemy = 敵の id（"e{g}-{u}"）、party = それ以外 */
  target?: (typeof CUE_TARGETS)[number];
  /** event "hpChanged" / "sanChanged" のときだけ。真なら delta < 0、偽なら delta > 0 のときだけ */
  loss?: boolean;
  /** event "statusChanged" のときだけ。その状態のときだけ */
  status?: StatusId;
  /** event "statusChanged" のときだけ。真なら付いたとき、偽なら外れたときだけ */
  on?: boolean;
  /** event "lifeChanged" のときだけ */
  life?: (typeof CUE_LIVES)[number];
  /** sfx と jingle のどちらか一方だけ */
  sfx?: string;
  jingle?: string;
};

export type AudioData = {
  /** 工房の project.json の music.songs（ループする曲）・jingles（ジングル）・noteRange（ch1〜ch3 の音域）の写し（ゲーム側が先に足した名前は工房への提案。decisions） */
  music: { songs: string[]; jingles: string[]; noteRange: [number, number] };
  /** 工房の project.json の sfx.names の写し（同上） */
  sfx: { names: string[] };
  /** 画面 → ループする曲。無い画面（event）は今の曲のまま。battle は置かない（battleSongs / bossSong）。dungeon はダンジョンに song が無いときの曲 */
  screenSongs: Partial<Record<AudioScreen, string>>;
  /** 戦闘の曲。ボスのいない遭遇ごとに先頭から順に（交互）。続きからの戦闘は先頭（1 つ以上） */
  battleSongs: string[];
  /** 戦闘の敵に special.boss の敵がいるときの曲（battleSongs の代わり） */
  bossSong: string;
  /** 街の施設のページ → 曲。無い施設（と施設メニュー）は screenSongs.town */
  facilitySongs: Partial<Record<AudioFacility, string>>;
  /** 迷宮のキャンプを開いている間の曲（閉じたら迷宮の曲に戻る。酒場のキャンプでは変えない） */
  campSong: string;
  cues: SoundCue[];
  /** 表示層の操作の効果音（決定・取り消し・施設に入る・迷宮のキャンプを開く・会話の箱の送り） */
  ui: { ok: string; cancel: string; facility: string; camp: string; talk: string };
};

// ---- 全体 ----

export type GameData = {
  config: Config;
  races: Race[];
  classes: ClassDef[];
  spells: Spell[];
  monsters: Monster[];
  unknownKinds: UnknownKind[];
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
  chestTraps: ChestTrapDef[];
  rivalries: RivalryDef[];
  strings: Strings;
  wavetables: Wavetables;
  audio: AudioData;
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
  unknownKinds: "unknown-kinds.json",
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
  chestTraps: "chest-traps.json",
  rivalries: "rivalries.json",
  strings: "strings.json",
  wavetables: "wavetables.json",
  audio: "audio.json",
};
