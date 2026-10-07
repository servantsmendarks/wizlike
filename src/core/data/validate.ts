// data/*.json の構造・参照・不変条件の検証。問題はすべて issues に集める（最初の 1 件で止めない）。

import {
  at,
  bool,
  dice,
  int,
  isObj,
  list,
  NON_NEG,
  num,
  obj,
  oneOf,
  PERCENT,
  POS_INT,
  RATIO,
  ref,
  report,
  str,
  uniqueIds,
  type Ctx,
  type Obj,
  type Range,
} from "./check";
import { diceRange, isDiceExpr, parseDice } from "../rng";
import {
  AUDIO_FACILITIES,
  AUDIO_SCREENS,
  AUTO_BATTLE_STYLES,
  CLASS_ABILITIES,
  CLASS_TIERS,
  CUE_EVENTS,
  CUE_RESULTS,
  CUE_LIVES,
  CUE_TARGETS,
  CURABLE_STATUS_IDS,
  DATA_FILES,
  EQUIP_SLOTS,
  EVENT_KINDS,
  ITEM_TYPES,
  LURE_TAGS,
  OPTION_EFFECT_TYPES,
  OPTION_KINDS,
  OPTION_UNITS,
  OUTCOME_QUALITIES,
  PERSONALITY_IDS,
  PLACEHOLDER_COLORS,
  SKILL_TYPES,
  SCHOOLS,
  SPELL_TARGETS,
  STAT_KEYS,
  STATUS_IDS,
  TRAP_IDS,
  USABLE_IN,
  VALUELESS_SKILL_TYPES,
  WEAPON_REACHES,
  type RawGameData,
} from "./types";

// ---- フィールド検査の組み立て ----

type Field = (ctx: Ctx, p: string, v: unknown) => unknown;

const I = (r: Range = {}): Field => (ctx, p, v) => int(ctx, p, v, r);
const N = (r: Range = {}): Field => (ctx, p, v) => num(ctx, p, v, r);
const S: Field = (ctx, p, v) => str(ctx, p, v);
/** 職業の略称（ui §2）: 1〜3 文字の ASCII 英大文字 */
const ABBR: Field = (ctx, p, v) => {
  const s = str(ctx, p, v);
  if (s !== undefined && !/^[A-Z]{1,3}$/.test(s)) report(ctx, p, "expected 1-3 uppercase ASCII letters");
  return s;
};
const SAnyLen: Field = (ctx, p, v) => str(ctx, p, v, false);
const B: Field = (ctx, p, v) => bool(ctx, p, v);
const D: Field = (ctx, p, v) => dice(ctx, p, v);
const E = (values: readonly string[]): Field => (ctx, p, v) => oneOf(ctx, p, v, values);
const opt = (f: Field): Field => (ctx, p, v) => (v === undefined ? undefined : f(ctx, p, v));
const nullable = (f: Field): Field => (ctx, p, v) => (v === null ? null : f(ctx, p, v));
const L = (each: Field, minLen = 0): Field => (ctx, p, v) => {
  const a = list(ctx, p, v, minLen);
  a?.forEach((e, i) => each(ctx, at(p, i), e));
  return a;
};

function fields(ctx: Ctx, path: string, v: unknown, spec: Record<string, Field>): Obj | undefined {
  const o = obj(ctx, path, v, Object.keys(spec));
  if (o === undefined) return undefined;
  for (const [k, f] of Object.entries(spec)) f(ctx, at(path, k), o[k]);
  return o;
}
const F = (spec: Record<string, Field>): Field => (ctx, p, v) => fields(ctx, p, v, spec);

/** `type` で判別するオブジェクト。specs[type] に type 以外のフィールドを書く。 */
const U = (specs: Record<string, Record<string, Field>>, extra: Record<string, Field> = {}): Field => (ctx, p, v) => {
  const o = obj(ctx, p, v, null);
  if (o === undefined) return undefined;
  const t = oneOf(ctx, at(p, "type"), o.type, Object.keys(specs));
  if (t === undefined) return undefined;
  return fields(ctx, p, o, { type: () => undefined, ...extra, ...specs[t] });
};

/** [min, max] の整数の組。min <= max。 */
const pair = (r: Range = {}): Field => (ctx, p, v) => {
  const a = list(ctx, p, v);
  if (a === undefined) return undefined;
  if (a.length !== 2) {
    report(ctx, p, `expected [min, max] (2 elements), got ${a.length} element(s)`);
    return undefined;
  }
  const lo = int(ctx, at(p, 0), a[0], r);
  const hi = int(ctx, at(p, 1), a[1], r);
  if (lo !== undefined && hi !== undefined && lo > hi) report(ctx, p, `min ${lo} > max ${hi}`);
  return a;
};

/** [min, max] の実数の組。min <= max。 */
const numPair = (r: Range = {}): Field => (ctx, p, v) => {
  const a = list(ctx, p, v);
  if (a === undefined) return undefined;
  if (a.length !== 2) {
    report(ctx, p, `expected [min, max] (2 elements), got ${a.length} element(s)`);
    return undefined;
  }
  const lo = num(ctx, at(p, 0), a[0], r);
  const hi = num(ctx, at(p, 1), a[1], r);
  if (lo !== undefined && hi !== undefined && lo > hi) report(ctx, p, `min ${lo} > max ${hi}`);
  return a;
};

/** UI-20: ビューの SVG は viewBox 0 0 240 150。ui §2 の view の高さはこれで固定（【仮】ではない） */
const UI_VIEW_HEIGHT = 150;
/** ui §2: パーティ欄は 1 行 10px で party.size 行 */
const UI_PARTY_ROW_H = 10;
/** UI-57 / SV-24（M8）: 設定の音量の段 0..10 */
const VOLUME_STEPS: Range = { min: 0, max: 10 };
const STAT_RANGE: Range = { min: 1, max: 18 }; // CH-10（上限 18。下限 1 は推測）
const statBlock: Field = F(Object.fromEntries(STAT_KEYS.map((k) => [k, I(STAT_RANGE)])));
const lure: Field = F(Object.fromEntries(LURE_TAGS.map((k) => [k, I({ min: 0, max: 3 })]))); // EV-03

// ---- 値の取り出し（型が合わなければ undefined） ----

const numOf = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const intOf = (v: unknown): number | undefined => (typeof v === "number" && Number.isInteger(v) ? v : undefined);
const strOf = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const objOf = (v: unknown): Obj | undefined => (isObj(v) ? v : undefined);
const arrOf = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const get = (v: unknown, ...keys: string[]): unknown => {
  let cur = v;
  for (const k of keys) {
    if (!isObj(cur)) return undefined;
    cur = cur[k];
  }
  return cur;
};

// ---- 参照用の索引 ----

type Index = {
  races: Map<string, Obj>;
  classes: Map<string, Obj>;
  spells: Map<string, Obj>;
  monsters: Map<string, Obj>;
  /** unknown-kinds.json（CB-05 / UI-60。M7） */
  unknownKinds: Map<string, Obj>;
  items: Map<string, Obj>;
  /** equipment-bases.json（IT-02。M7） */
  bases: Map<string, Obj>;
  /** uniques.json（IT-03。M7） */
  uniques: Map<string, Obj>;
  events: Map<string, Obj>;
  dungeons: Map<string, Obj>;
  /** audio.json の music.songs（UI-63 のダンジョンごとの曲の照合。M8） */
  songs: Set<string>;
  strings: Set<string>;
  /** strings.json の値（EV-34 / E3 の差し込みの検査に使う） */
  stringText: Map<string, string>;
  partySize: number | undefined;
  slotsPerCharacter: number | undefined;
  maxEnemyGroups: number | undefined;
  maxPerGroup: number | undefined;
  /** config.items.rarities[].options の最大（IT-30。オプション表の件数の検査に使う） */
  maxRarityOptions: number | undefined;
};

/** IT-30: config.items.rarities の id の順 */
const RARITY_IDS = ["normal", "fine", "rare", "legendary"] as const;

function byId(v: unknown): Map<string, Obj> {
  const m = new Map<string, Obj>();
  for (const e of arrOf(v)) {
    if (isObj(e) && typeof e.id === "string" && !m.has(e.id)) m.set(e.id, e);
  }
  return m;
}

function buildIndex(raw: RawGameData): Index {
  const strings = new Set<string>();
  const stringText = new Map<string, string>();
  if (isObj(raw.strings)) {
    for (const [k, v] of Object.entries(raw.strings)) {
      if (typeof v !== "string") continue;
      strings.add(k);
      stringText.set(k, v);
    }
  }
  return {
    races: byId(raw.races),
    classes: byId(raw.classes),
    spells: byId(raw.spells),
    monsters: byId(raw.monsters),
    unknownKinds: byId(raw.unknownKinds),
    items: byId(raw.items),
    bases: byId(raw.equipmentBases),
    uniques: byId(raw.uniques),
    events: byId(raw.events),
    dungeons: byId(raw.dungeons),
    songs: new Set(arrOf(get(raw.audio, "music", "songs")).filter((x): x is string => typeof x === "string")),
    strings,
    stringText,
    partySize: intOf(get(raw.config, "party", "size")),
    slotsPerCharacter: intOf(get(raw.config, "inventory", "slotsPerCharacter")),
    maxEnemyGroups: intOf(get(raw.config, "combat", "maxEnemyGroups")),
    maxPerGroup: intOf(get(raw.config, "combat", "maxPerGroup")),
    maxRarityOptions: (() => {
      const ns = arrOf(get(raw.config, "items", "rarities")).flatMap((r) => {
        const n = isObj(r) ? intOf(r.options) : undefined;
        return n === undefined ? [] : [n];
      });
      return ns.length === 0 ? undefined : Math.max(...ns);
    })(),
  };
}

function strKey(ctx: Ctx, p: string, v: unknown, ix: Index): void {
  if (typeof v === "string" && !ix.strings.has(v)) report(ctx, p, `unknown strings.json key ${JSON.stringify(v)}`);
}

// ---- config.json ----

function validateConfig(ctx: Ctx, v: unknown, ix: Index): void {
  const member: Field = F({
    defaultName: S,
    raceId: S,
    classId: S,
    isLeader: B,
    stats: statBlock,
    equipment: F(Object.fromEntries(EQUIP_SLOTS.map((k) => [k, opt(S)]))),
    inventory: L(S),
    knownSpells: L(S),
  });
  const c = fields(ctx, "", v, {
    stage: F({ width: I({ min: 240, max: 240 }), height: I({ min: 400, max: 400 }) }), // UI-01
    party: F({ size: I({ min: 6, max: 6 }), frontRow: I({ min: 3, max: 3 }) }), // CH-01
    inventory: F({ slotsPerCharacter: I(POS_INT) }),
    creation: F({
      bonusBase: I(),
      bonusDie: I(POS_INT),
      bonusBigChance: I(PERCENT),
      bonusBig: I(),
      nameMaxLength: I(POS_INT), // CH-05
    }),
    growth: F({
      expBase: I({ positive: true }),
      expGrowth: N({ positive: true }),
      hpVitPivot: I(),
      hpVitDivisor: I(POS_INT),
      hpGainMin: I(POS_INT),
      level1Bonus: I(NON_NEG), // CH-65【仮】
      mpStatPivot: I(), // MG-01
      mpStatDivisor: I(POS_INT), // MG-01（0 除算を防ぐ）
      statUpChance: I(PERCENT), // CH-61【仮】
      statCap: I(POS_INT), // CH-61【仮】
    }),
    learning: F({ base: I(), perLevelDiff: I(), guaranteeDiff: I(), statPivot: I(), statPerPoint: I() }),
    dungeon: F({
      defaultRooms: pair(POS_INT), // DG-05
      roomSize: pair(POS_INT), // DG-05【仮】
      roomAttempts: I(POS_INT), // DG-05【仮】
      doorsPerRoom: pair(POS_INT), // DG-05【仮】（min >= 1 で到達性を保つ）
      braidRatio: numPair(RATIO), // DG-05【仮】
      straightBias: N(RATIO), // DG-05【仮】
      viewDepth: I({ min: 1, max: 3 }), // DG-12【仮】（UI-20 の座標表が奥行き 0..3）
      trap: F({ pitDice: D }), // DG-20【仮】
    }),
    combat: F({
      hitBase: I(),
      hitPerLevel: I(),
      hitPerAC: I(),
      hitMin: I(PERCENT),
      hitMax: I(PERCENT),
      acBase: I(), // CB-20（M7 で下限 acMin は撤廃。IT-24）
      maxEnemyGroups: I(POS_INT),
      maxPerGroup: I(POS_INT),
      surpriseDiff: I(),
      identifyChancePerRound: I(PERCENT),
      identifyKills: I(POS_INT),
      identifyIqPerPoint: I(NON_NEG), // CB-05【仮】
      statusLukPerPoint: I(),
      sleepWakeChance: I(PERCENT),
      sleepHitBonus: I(),
      sleepNaturalWake: I(PERCENT), // CB-32【仮】
      poisonDamagePerTick: I(POS_INT),
      fleeBase: I(),
      fleeAgiMul: I(),
      chestChance: I(PERCENT), // CB-51 / CB-52【仮】部屋
      chestChanceCorridor: I(PERCENT), // CB-51 / CB-52【仮】通路
      chestTrapChance: I(PERCENT),
      chestGoldDice: D, // CB-52【仮】（M3 の仮実装）
      unarmedDice: D,
      autoInterrupt: F({ hpRatio: N(RATIO) }),
      autoDefendHpRatio: N(RATIO), // CB-44【仮】
      flyingHit: F(Object.fromEntries(WEAPON_REACHES.map((k) => [k, I()]))), // CB-26【仮】
      rangedHitAgiMul: I(), // CB-21【仮】
      rangedHitLukPivot: I(), // CB-21【仮】
    }),
    san: F({
      max: I(POS_INT),
      floorDescend: I(NON_NEG),
      unidentifiedGroup: I(NON_NEG),
      allyDeath: I(NON_NEG),
      trap: I(NON_NEG),
      uneasyRatio: N(RATIO),
      confusedRatio: N(RATIO),
      uneasyChance: I(PERCENT),
      confusedChance: I(PERCENT),
      randomDefendChance: I(PERCENT), // CH-53 / CB-45【仮】
      restoreOnTown: B,
    }),
    wipe: F({ reviveHpRatio: N(RATIO), clearStatus: B }),
    // CH-77（M10）【仮】
    identify: F({
      mpCost: I(NON_NEG),
      base: I(),
      iqPivot: I(),
      iqPerPoint: I(NON_NEG),
      levelStep: I(POS_INT), // 0 除算を防ぐ
      perLevelStep: I(NON_NEG),
      rarityPenalty: F(Object.fromEntries(RARITY_IDS.map((k) => [k, I(NON_NEG)]))),
      uniquePenalty: I(NON_NEG),
      min: I(PERCENT),
      max: I(PERCENT),
      failSanDungeon: I(NON_NEG),
      possessChance: I(PERCENT),
      possessSan: I(NON_NEG),
    }),
    classChange: F({ fee: I(NON_NEG) }), // TW-09 / CH-22（M10）【仮】
    economy: F({
      sellRatio: N(RATIO),
      identifyFeeRatio: N(RATIO), // IT-65【仮】
      identifyFeeMin: I(NON_NEG),
      templeSuccessBase: I(PERCENT),
      templeSuccessPerVit: I(),
      templeSuccessMax: I(PERCENT),
      templeCostPerLevel: I(NON_NEG),
      darkCostPerLevel: I(NON_NEG),
      cureCost: F(Object.fromEntries(CURABLE_STATUS_IDS.map((k) => [k, I(NON_NEG)]))),
      uncurseCost: I(NON_NEG),
      // TW-17（M7）【仮】
      upgradeBase: I(NON_NEG),
      upgradeRateBase: I(PERCENT),
      upgradeRatePerCatalyst: I(PERCENT),
      upgradeDecay: N(RATIO),
      upgradeMaxCatalysts: I(POS_INT),
    }),
    // items.md §10（M7）【仮】
    items: F({
      rarities: L(F({ id: S, weight: I(NON_NEG), options: I({ min: 0, max: 3 }) }), 1), // IT-30（順と件数は下で検査）
      curseChance: I(PERCENT), // IT-32
      optionTierStep: I(POS_INT), // IT-33
      dropLevelSpread: I(NON_NEG), // IT-53
      weaponLvPerDamage: I(POS_INT), // IT-20
      armorLvPerAc: I(POS_INT), // IT-21
      casterLvPerPower: I(POS_INT), // IT-22
      levelPriceRatio: N({ min: 0 }), // IT-60 / IT-61
      optionSellValue: (c2, p, x) => {
        // IT-61: 段階 1〜3 の 3 件の 0 以上の整数
        const a = list(c2, p, x);
        if (a === undefined) return undefined;
        if (a.length !== 3) report(c2, p, `IT-61: expected 3 values (tiers 1..3), got ${a.length}`);
        a.forEach((e, i) => int(c2, at(p, i), e, NON_NEG));
        return a;
      },
      warehouseSlots: I(POS_INT), // IT-64
    }),
    town: F({
      innRanks: L(
        F({
          id: S,
          name: S,
          cost: I(NON_NEG),
          hpRatio: N(RATIO),
          sanOver: I(NON_NEG),
          goodWeight: I(NON_NEG),
          judgeBonus: I(NON_NEG),
          gossip: B,
        }),
        1,
      ), // TW-04 / TW-15【仮】。MP は全ランクで全回復（MG-02）
      tavernEventTurns: I(POS_INT), // TW-14【仮】
      tavernEventChance: I(PERCENT), // TW-14【仮】
    }),
    events: F({ impulseThreshold: I(), stopSanGain: I(NON_NEG), confusedLureWeight: I({ min: 0, max: 3 }) }), // EV-14 の仮の重み【仮】
    save: F({ maxGames: I(POS_INT), schemaVersion: I(POS_INT) }),
    input: F({ swipeThresholdPx: I(POS_INT), holdRepeatMs: I(POS_INT), edgeDeadZonePx: I(NON_NEG) }),
    ui: F({
      textSpeedMs: I(NON_NEG),
      diceStepMs: I(NON_NEG),
      flashMs: I(NON_NEG),
      shakeMs: I(NON_NEG),
      viewFadeMs: I(NON_NEG),
      layout: F({ header: I(POS_INT), view: I(POS_INT), message: I(POS_INT), party: I(POS_INT), controls: I(POS_INT) }), // ui.md §2【仮】
      messageHistory: I(POS_INT), // UI-43 / UI-46【仮】
      autoBeatMs: I(POS_INT), // UI-45【仮】
      saveBannerHeight: I(POS_INT), // SV-23【仮】
      mapSnapPx: I(POS_INT), // UI-25（ユーザーが決めた値。【仮】ではない）
      musicVolume: I(VOLUME_STEPS), // UI-57 / SV-24（M8）【仮】
      sfxVolume: I(VOLUME_STEPS), // UI-57 / SV-24（M8）【仮】
    }),
    audio: F({
      musicGain: N(RATIO), // UI-63 / UI-65（M8）【仮】
      sfxGain: N(RATIO), // UI-63 / UI-65（M8）【仮】
      sampleRate: I({ min: 8000, max: 96000 }), // UI-63（M9.5）【仮】createBuffer が全ブラウザで受ける範囲
      prefetchBars: I(POS_INT), // UI-63（M9.5）
      keepSongs: I(POS_INT), // UI-63（M9.5）
      startLeadMs: I({ min: 0, max: 100 }), // UI-63（M9.5）【仮】上限は M9.5 の完了条件の 100ms
      warmupSeconds: N({ min: 0, max: 10 }), // UI-63（M9.5）【仮】3。0 なら暖機しない。上限は単純に 10
    }),
    prototypeParty: F({ startingGold: I(NON_NEG), members: L(member) }),
  });
  if (c === undefined) return;

  // CB-21 / CH-53
  const hitMin = numOf(get(c, "combat", "hitMin"));
  const hitMax = numOf(get(c, "combat", "hitMax"));
  if (hitMin !== undefined && hitMax !== undefined && hitMin > hitMax)
    report(ctx, "combat.hitMin", `CB-21: hitMin ${hitMin} > hitMax ${hitMax}`);
  // CH-77（M10）
  const idMin = numOf(get(c, "identify", "min"));
  const idMax = numOf(get(c, "identify", "max"));
  if (idMin !== undefined && idMax !== undefined && idMin > idMax) report(ctx, "identify.min", `CH-77: min ${idMin} > max ${idMax}`);

  // IT-30: 希少度は normal / fine / rare / legendary の順で 4 件。重みの合計は正、個数は 0..3
  const rarities = arrOf(get(c, "items", "rarities"));
  if (rarities.length > 0) {
    if (rarities.length !== RARITY_IDS.length)
      report(ctx, "items.rarities", `IT-30: expected ${RARITY_IDS.length} rarities (${RARITY_IDS.join(" / ")}), got ${rarities.length}`);
    rarities.forEach((r, i) => {
      const want = RARITY_IDS[i];
      if (want !== undefined && isObj(r) && r.id !== want)
        report(ctx, at(at("items.rarities", i), "id"), `IT-30: expected ${JSON.stringify(want)}, got ${JSON.stringify(r.id)}`);
    });
    const total = rarities.reduce<number>((a, r) => a + (isObj(r) ? (intOf(r.weight) ?? 0) : 0), 0);
    if (total <= 0) report(ctx, "items.rarities", "IT-30: sum of weights must be > 0");
  }
  const uneasy = numOf(get(c, "san", "uneasyRatio"));
  const confused = numOf(get(c, "san", "confusedRatio"));
  if (uneasy !== undefined && confused !== undefined && !(confused < uneasy))
    report(ctx, "san.confusedRatio", `CH-53: confusedRatio ${confused} must be < uneasyRatio ${uneasy}`);

  // ui.md §2: 縦の区切りの合計はステージの高さ
  const layout = objOf(get(c, "ui", "layout"));
  const stageH = intOf(get(c, "stage", "height"));
  if (layout !== undefined) {
    const parts = ["header", "view", "message", "party", "controls"].map((k) => intOf(layout[k]));
    if (stageH !== undefined && parts.every((n) => n !== undefined)) {
      const sum = parts.reduce<number>((a, n) => a + (n ?? 0), 0);
      if (sum !== stageH) report(ctx, "ui.layout", `ui §2: sum of heights ${sum} must equal stage.height ${stageH}`);
    }
    // UI-20: ビューの高さは SVG の viewBox の 150 で固定
    const view = intOf(layout.view);
    if (view !== undefined && view !== UI_VIEW_HEIGHT)
      report(ctx, "ui.layout.view", `UI-20: view ${view} must be ${UI_VIEW_HEIGHT} (svg viewBox 0 0 240 150)`);
    // ui.md §2: パーティ欄は party.size 行 × 10px が入る高さ
    const party = intOf(layout.party);
    if (party !== undefined && ix.partySize !== undefined && party < ix.partySize * UI_PARTY_ROW_H)
      report(ctx, "ui.layout.party", `ui §2: party ${party} must be >= party.size ${ix.partySize} x ${UI_PARTY_ROW_H}`);
  }

  uniqueIds(ctx, "town.innRanks", arrOf(get(c, "town", "innRanks")));

  // prototypeParty（CH-01, CH-02, CH-05, CH-21, CH-71, CH-75, MG-11）
  const members = get(c, "prototypeParty", "members");
  if (!Array.isArray(members)) return;
  const mp = "prototypeParty.members";
  if (ix.partySize !== undefined && members.length !== ix.partySize)
    report(ctx, mp, `CH-01: expected ${ix.partySize} members (party.size), got ${members.length}`);
  const leaders = members.flatMap((m, i) => (isObj(m) && m.isLeader === true ? [i] : []));
  if (leaders.length !== 1 || leaders[0] !== 0)
    report(ctx, mp, `CH-02: exactly one leader at [0] is required, leaders at [${leaders.join(", ")}]`);

  members.forEach((m, i) => {
    if (!isObj(m)) return;
    const p = at(mp, i);
    ref(ctx, at(p, "raceId"), m.raceId, ix.races, "race");
    ref(ctx, at(p, "classId"), m.classId, ix.classes, "class");
    const classId = strOf(m.classId);
    const cls = classId === undefined ? undefined : ix.classes.get(classId);

    // CH-21 職業の requirements
    const req = objOf(cls?.requirements);
    const stats = objOf(m.stats);
    if (req && stats) {
      for (const [k, need] of Object.entries(req)) {
        const have = numOf(stats[k]);
        const n = numOf(need);
        if (have !== undefined && n !== undefined && have < n)
          report(ctx, at(at(p, "stats"), k), `CH-21: ${k} ${have} is below class ${classId} requirement ${n}`);
      }
    }

    validateKit(ctx, p, m, classId, cls, ix);
  });
}

/**
 * 開始の持ち物（prototypeParty の 1 人と classes[].start。CH-24）の参照・装備枠・職業・所持枠・初期呪文の系統。
 * kit は equipment / inventory / knownSpells を持つオブジェクト（形の検査は呼び出し側）
 */
function validateKit(ctx: Ctx, p: string, m: Obj, classId: string | undefined, cls: Obj | undefined, ix: Index): void {
  // CH-70 / CH-75 装備（IT-04: 汎用ベース表の id）
  const eq = objOf(m.equipment);
  let equipped = 0;
  if (eq) {
    for (const [slot, itemId] of Object.entries(eq)) {
      const ep = at(at(p, "equipment"), slot);
      equipped++;
      ref(ctx, ep, itemId, ix.bases, "equipment base");
      const item = typeof itemId === "string" ? ix.bases.get(itemId) : undefined;
      if (!item) continue;
      if (item.slot !== slot)
        report(ctx, ep, `CH-70: item ${JSON.stringify(itemId)} has slot ${JSON.stringify(item.slot)}, not ${JSON.stringify(slot)}`);
      const allowed = arrOf(item.classes);
      if (classId !== undefined && allowed.length > 0 && !allowed.includes(classId))
        report(ctx, ep, `CH-75: class ${JSON.stringify(classId)} cannot equip ${JSON.stringify(itemId)}`);
    }
  }
  const inv = arrOf(m.inventory);
  inv.forEach((it, j) => ref(ctx, at(at(p, "inventory"), j), it, ix.items, "item"));
  // CH-71 所持枠（装備中を含む）
  if (ix.slotsPerCharacter !== undefined && equipped + inv.length > ix.slotsPerCharacter)
    report(ctx, p, `CH-71: ${equipped + inv.length} items exceed inventory.slotsPerCharacter ${ix.slotsPerCharacter}`);

  // MG-11 初期呪文の系統
  arrOf(m.knownSpells).forEach((sp, j) => {
    const sp_p = at(at(p, "knownSpells"), j);
    ref(ctx, sp_p, sp, ix.spells, "spell");
    const spell = typeof sp === "string" ? ix.spells.get(sp) : undefined;
    const school = strOf(spell?.school);
    if (!cls || school === undefined) return;
    const start = numOf(get(cls, "spells", school));
    if (start === undefined) report(ctx, sp_p, `MG-11: class ${JSON.stringify(classId)} cannot learn ${school} spells`);
    else if (start > 1) report(ctx, sp_p, `MG-11: class ${JSON.stringify(classId)} starts ${school} spells at level ${start}, not 1`);
  });
}

// ---- races.json / classes.json ----

function validateRaces(ctx: Ctx, v: unknown): void {
  const a = L(F({ id: S, name: S, baseStats: statBlock, description: S }))(ctx, "", v);
  if (Array.isArray(a)) uniqueIds(ctx, "", a);
}

function validateClasses(ctx: Ctx, v: unknown, ix: Index): void {
  const a = L(
    F({
      id: S,
      name: S,
      abbr: ABBR,
      tier: E(CLASS_TIERS),
      requirements: F(Object.fromEntries(STAT_KEYS.map((k) => [k, opt(I(STAT_RANGE))]))),
      hpDie: I(POS_INT),
      mpPerLevel: I(NON_NEG),
      spells: F(Object.fromEntries(SCHOOLS.map((k) => [k, opt(I(POS_INT))]))),
      learnMod: I(),
      attacksPerLevels: I(NON_NEG),
      maxAttacks: I(POS_INT),
      abilities: L(E(CLASS_ABILITIES)),
      expMultiplier: N({ positive: true }),
      description: S,
      // CH-24（M5.5）【仮】
      start: F({
        equipment: F(Object.fromEntries(EQUIP_SLOTS.map((k) => [k, opt(S)]))),
        inventory: L(S),
        knownSpells: L(S),
        gold: I(NON_NEG),
      }),
    }),
  )(ctx, "", v);
  if (!Array.isArray(a)) return;
  uniqueIds(ctx, "", a);
  // CH-24: 開始の持ち物は prototypeParty と同じ規則（CH-70 / CH-75 / CH-71 / MG-11）に加え、
  // 呪文は重複なし・魔法書専用でない・learnLevel 1（作成時に覚えていてよいもの）
  a.forEach((c, i) => {
    if (!isObj(c)) return;
    const start = objOf(c.start);
    if (!start) return;
    const p = at(at("", i), "start");
    validateKit(ctx, p, start, strOf(c.id), c, ix);
    const seen = new Set<string>();
    arrOf(start.knownSpells).forEach((sp, j) => {
      if (typeof sp !== "string") return;
      const sp_p = at(at(p, "knownSpells"), j);
      if (seen.has(sp)) report(ctx, sp_p, `CH-24: duplicate spell ${JSON.stringify(sp)}`);
      seen.add(sp);
      const spell = ix.spells.get(sp);
      if (!spell) return;
      if (spell.bookOnly === true) report(ctx, sp_p, `CH-24: spell ${JSON.stringify(sp)} is bookOnly`);
      const ll = numOf(spell.learnLevel);
      if (ll !== undefined && ll > 1) report(ctx, sp_p, `CH-24: spell ${JSON.stringify(sp)} has learnLevel ${ll}, not 1`);
    });
  });
}

// ---- spells.json ----

function validateSpells(ctx: Ctx, v: unknown): void {
  const effect = U({
    damage: { dice: D },
    heal: { dice: D },
    status: { status: E(STATUS_IDS), chance: I(PERCENT) },
    acBonus: { value: I() },
    cureStatus: { status: E(STATUS_IDS) },
    identify: {},
    return: {},
    resurrect: {},
    sanHeal: { value: I(POS_INT) },
  });
  const a = L(
    F({
      id: S,
      name: S,
      school: E(SCHOOLS),
      level: I({ min: 1, max: 7 }), // MG-10
      learnLevel: I(POS_INT), // MG-12
      mp: I(NON_NEG),
      target: E(SPELL_TARGETS),
      usableIn: E(USABLE_IN),
      effect,
      bookOnly: B,
      tags: opt(L(S)), // magic.md §6: 省略可
      description: S,
    }),
  )(ctx, "", v);
  if (Array.isArray(a)) uniqueIds(ctx, "", a);
}

// ---- monsters.json ----

function validateMonsters(ctx: Ctx, v: unknown, ix: Index): void {
  const attack: Field = (c, p, x) => {
    const o = fields(c, p, x, {
      dice: D,
      status: opt(E(STATUS_IDS)),
      chance: opt(I(PERCENT)),
      sanDrain: opt(I(POS_INT)), // CB-31
      tags: opt(L(S)),
    });
    if (o && (o.status === undefined) !== (o.chance === undefined))
      report(c, p, "CB-24: status and chance must appear together");
    return o;
  };
  const a = L(
    F({
      id: S,
      name: S,
      // CB-05 / UI-60: 未鑑定の系統。unknown-kinds.json に定義があること
      unknownKind: (c, p, x) => {
        const s = str(c, p, x);
        ref(c, p, s, ix.unknownKinds, "unknownKind");
        return s;
      },
      sprite: S,
      level: I(POS_INT),
      hp: D,
      ac: I(),
      agi: I(NON_NEG),
      attacks: L(attack, 1),
      exp: I(NON_NEG),
      gold: D,
      groupSize: D,
      special: F({ undead: opt(B), boss: opt(B), flying: opt(B) }), // flying: CB-26（M9）
      resist: F(Object.fromEntries(STATUS_IDS.map((k) => [k, opt(B)]))),
      tags: L(S),
      description: S,
    }),
  )(ctx, "", v);
  if (!Array.isArray(a)) return;
  uniqueIds(ctx, "", a);
  // CB-03 グループの体数は 1..maxPerGroup
  a.forEach((m, i) => {
    const g = strOf(get(m, "groupSize"));
    const r = g !== undefined && isDiceExpr(g) ? diceRange(parseDice(g)) : undefined;
    if (!r) return;
    const p = at(at("", i), "groupSize");
    if (r.min < 1) report(ctx, p, `CB-03: groupSize ${JSON.stringify(g)} can be ${r.min} (< 1)`);
    if (ix.maxPerGroup !== undefined && r.max > ix.maxPerGroup)
      report(ctx, p, `CB-03: groupSize ${JSON.stringify(g)} can be ${r.max} (> combat.maxPerGroup ${ix.maxPerGroup})`);
  });
}

// ---- unknown-kinds.json（CB-05 / UI-60。M7） ----

function validateUnknownKinds(ctx: Ctx, v: unknown): void {
  const a = L(F({ id: S, name: S, sprite: S, placeholderColor: E(PLACEHOLDER_COLORS) }), 1)(ctx, "", v);
  if (!Array.isArray(a)) return;
  uniqueIds(ctx, "", a);
  // UI-60: 絵は public/sprites/unknown_<id>.png
  a.forEach((k, i) => {
    // CB-05 / UI-54（M9）: 名前は全角 8 字以内（戦闘のラベルの 2 行に収まる）
    const name = strOf(get(k, "name"));
    if (name !== undefined && [...name].length > 8) report(ctx, at(at("", i), "name"), "CB-05: name must be at most 8 characters");
    const id = strOf(get(k, "id"));
    const sprite = strOf(get(k, "sprite"));
    if (id !== undefined && sprite !== undefined && sprite !== `unknown_${id}`)
      report(ctx, at(at("", i), "sprite"), `UI-60: sprite must be ${JSON.stringify(`unknown_${id}`)} (found ${JSON.stringify(sprite)})`);
  });
}

// ---- items.json ----

function validateItems(ctx: Ctx, v: unknown, ix: Index): void {
  const learnSpell: Field = (c, p, x) => {
    const s = str(c, p, x);
    if (s === undefined) return undefined;
    const spell = ix.spells.get(s);
    if (!spell) report(c, p, `unknown spell id ${JSON.stringify(s)}`);
    else if (spell.bookOnly !== true) report(c, p, `MG-25: spell ${JSON.stringify(s)} is not bookOnly`);
    return s;
  };
  const common = {
    id: S,
    name: S,
    price: I(NON_NEG), // TW-05
    infinite: B,
    unidentifiedName: opt(S),
    description: opt(S),
  };
  // IT-01（M7）: 消耗品と魔法書だけ。装備は equipment-bases.json（type に装備の部位を書くと expected one of で止まる）
  const item = U(
    {
      consumable: {
        usableIn: E(USABLE_IN),
        effect: U({
          heal: { dice: D, target: E(SPELL_TARGETS) },
          cureStatus: { status: E(STATUS_IDS), target: E(SPELL_TARGETS) },
          return: {},
        }),
      },
      book: { usableIn: E(USABLE_IN), effect: U({ learn: { spell: learnSpell } }) },
    } satisfies Record<(typeof ITEM_TYPES)[number], Record<string, Field>>,
    common,
  );
  const a = L(item)(ctx, "", v);
  if (Array.isArray(a)) uniqueIds(ctx, "", a);
}

// ---- equipment-bases.json（IT-02 / IT-20〜22。M7） ----

function validateEquipmentBases(ctx: Ctx, v: unknown, ix: Index): void {
  const classes = L((c, p, x) => {
    const s = str(c, p, x);
    ref(c, p, s, ix.classes, "class");
    return s;
  });
  const common = { id: S, name: S, unidentifiedName: S, slot: E(EQUIP_SLOTS), classes, price: I(NON_NEG), shopMinLevel: I(NON_NEG) };
  const base: Field = (c, p, x) => {
    const o = obj(c, p, x, null);
    if (o === undefined) return undefined;
    const slot = oneOf(c, at(p, "slot"), o.slot, EQUIP_SLOTS);
    if (slot === undefined) return undefined;
    // 武器は damage / caster と任意の reach を持ち ac を持たない。それ以外は ac を持ち damage / reach / caster を持たない（CB-20 / CB-22）
    // IT-25（2026-10-06）: reach は melee / long / ranged、省略は melee。前の ranged の欄は未知の欄として止める
    // IT-22（M9）: 武器は任意の magicPower（0 以上）を持てるが、caster のときだけ
    const spec =
      slot === "weapon"
        ? { ...common, damage: D, reach: opt(E(WEAPON_REACHES)), caster: B, magicPower: opt(I(NON_NEG)) }
        : { ...common, ac: I() };
    const f = fields(c, p, o, spec);
    if (f !== undefined && f.caster === true && f.reach !== undefined && f.reach !== "melee")
      report(c, at(p, "caster"), "IT-22: a caster weapon must be melee (reach)");
    if (f !== undefined && f.caster !== true && f.magicPower !== undefined)
      report(c, at(p, "magicPower"), "IT-22: magicPower is only for caster weapons");
    return f;
  };
  const a = L(base)(ctx, "", v);
  if (!Array.isArray(a)) return;
  uniqueIds(ctx, "", a);
  // IT-10: 実体の itemId はベース表と items.json の両方を指すので、id は重ならない
  a.forEach((b, i) => {
    const id = strOf(get(b, "id"));
    if (id !== undefined && ix.items.has(id)) report(ctx, at(at("", i), "id"), `IT-10: base id ${JSON.stringify(id)} overlaps an items.json id`);
  });
}

// ---- item-options.json（IT-33 / IT-34。M7） ----

function validateItemOptions(ctx: Ctx, v: unknown, ix: Index): void {
  // IT-33: 段階 1〜3 の値。正の整数で単調非減少
  const values: Field = (c, p, x) => {
    const a = list(c, p, x);
    if (a === undefined) return undefined;
    if (a.length !== 3) report(c, p, `IT-33: expected 3 values (tiers 1..3), got ${a.length}`);
    const ns = a.map((e, i) => int(c, at(p, i), e, POS_INT));
    for (let i = 1; i < ns.length; i++) {
      const prev = ns[i - 1];
      const cur = ns[i];
      if (prev !== undefined && cur !== undefined && cur < prev) report(c, at(p, i), `IT-33: values must be non-decreasing (${prev} > ${cur})`);
    }
    return a;
  };
  const effectSpecs: Record<string, Record<string, Field>> = Object.fromEntries(OPTION_EFFECT_TYPES.map((t) => [t, {}]));
  effectSpecs.stat = { stat: E(STAT_KEYS) };
  effectSpecs.statusResist = { status: E(STATUS_IDS) };
  // IT-36（M10）: 適用品種。空でなく、OPTION_KINDS のいずれかで、重複しない
  const appliesTo: Field = (c, p, x) => {
    const a = L(E(OPTION_KINDS), 1)(c, p, x);
    if (!Array.isArray(a)) return a;
    a.forEach((k, i) => {
      if (typeof k === "string" && a.indexOf(k) < i) report(c, at(p, i), `IT-36: duplicate kind ${JSON.stringify(k)}`);
    });
    return a;
  };
  const t = fields(ctx, "", v, {
    options: L(F({ id: S, name: S, effect: U(effectSpecs), unit: E(OPTION_UNITS), values, weight: I(POS_INT), appliesTo: opt(appliesTo) }), 1),
  });
  if (t !== undefined && Array.isArray(t.options)) {
    uniqueIds(ctx, "options", t.options);
    // IT-30 / IT-32: 同じ実体の中で重複なしに引くので、希少度の個数の最大 + 呪いの余分 1 個ぶんの件数が要る
    const need = ix.maxRarityOptions === undefined ? undefined : ix.maxRarityOptions + 1;
    if (need !== undefined && t.options.length < need)
      report(ctx, "options", `IT-30/IT-32: expected at least ${need} options (max rarities[].options + 1 for a curse), got ${t.options.length}`);
    // IT-36: 品種ごとに、その品種に付けられる件数も同じだけ要る。全体が足りないときは全体のエラーだけ（重ねない）
    else if (need !== undefined) {
      for (const kind of OPTION_KINDS) {
        const n = t.options.filter((o) => {
          const a = get(o, "appliesTo");
          return !Array.isArray(a) || a.includes(kind);
        }).length;
        if (n < need) report(ctx, "options", `IT-36: kind ${JSON.stringify(kind)} has only ${n} options (need ${need})`);
      }
    }
  }
}

// ---- uniques.json（IT-03 / IT-40。M7） ----

function validateUniques(ctx: Ctx, v: unknown, ix: Index): void {
  const skill: Field = (c, p, x) => {
    const o = fields(c, p, x, { type: E(SKILL_TYPES), value: I() });
    if (o === undefined) return undefined;
    const value = intOf(o.value);
    const type = strOf(o.type);
    if (value === undefined || type === undefined) return o;
    const vp = at(p, "value");
    if (type === "walkRegen" && value < 1) report(c, vp, `IT-40: walkRegen value must be >= 1, got ${value}`);
    if (type === "lifeSteal" && (value < 0 || value > 100)) report(c, vp, `IT-40: lifeSteal value must be in 0..100, got ${value}`);
    if ((VALUELESS_SKILL_TYPES as readonly string[]).includes(type) && value !== 0) report(c, vp, `IT-40: ${type} value must be 0, got ${value}`);
    return o;
  };
  const baseRef: Field = (c, p, x) => {
    const s = str(c, p, x);
    ref(c, p, s, ix.bases, "equipment base");
    return s;
  };
  const common = { id: S, name: S, base: baseRef, skill, optionTier: I({ min: 1, max: 3 }), price: I(NON_NEG), description: S };
  const unique: Field = (c, p, x) => {
    const o = obj(c, p, x, null);
    if (o === undefined) return undefined;
    const baseId = strOf(o.base);
    const b = baseId === undefined ? undefined : ix.bases.get(baseId);
    const slot = strOf(b?.slot);
    // ベースが武器なら damage（caster なら magicPower も）、それ以外は ac。ベースが分からなければ型だけ見る
    const spec =
      slot === "weapon"
        ? b?.caster === true
          ? { ...common, damage: D, magicPower: I(NON_NEG) }
          : { ...common, damage: D }
        : slot !== undefined && (EQUIP_SLOTS as readonly string[]).includes(slot)
          ? { ...common, ac: I() }
          : { ...common, damage: opt(D), magicPower: opt(I(NON_NEG)), ac: opt(I()) };
    return fields(c, p, o, spec);
  };
  const a = L(unique)(ctx, "", v);
  if (!Array.isArray(a)) return;
  uniqueIds(ctx, "", a);
  a.forEach((u, i) => {
    const id = strOf(get(u, "id"));
    if (id !== undefined && ix.bases.has(id)) report(ctx, at(at("", i), "id"), `IT-03: unique id ${JSON.stringify(id)} overlaps an equipment base id`);
  });
}

// ---- drops.json（IT-50〜53。M7） ----

function validateDrops(ctx: Ctx, v: unknown, ix: Index): void {
  const refTo = (ids: ReadonlyMap<string, unknown>, what: string): Field => (c, p, x) => {
    const s = str(c, p, x);
    ref(c, p, s, ids, what);
    return s;
  };
  const entry: Field = (c, p, x) => {
    const o = fields(c, p, x, {
      base: opt(refTo(ix.bases, "equipment base")),
      unique: opt(refTo(ix.uniques, "unique")),
      item: opt(refTo(ix.items, "item")), // IT-55（M9）: 魔法書
      weight: I(POS_INT),
    });
    if (o === undefined) return o;
    if ([o.base, o.unique, o.item].filter((k) => k !== undefined).length !== 1) report(c, p, "IT-51: entry needs exactly one of base, unique or item");
    const itemId = strOf(o.item);
    const it = itemId === undefined ? undefined : ix.items.get(itemId);
    if (it !== undefined && it.type !== "book") report(c, at(p, "item"), "IT-55: item must be a book");
    return o;
  };
  const t = fields(ctx, "", v, {
    tables: L(F({ id: S, itemChance: I(PERCENT), rolls: I(POS_INT), entries: L(entry, 1) }), 1),
    chest: (c, p, x) => obj(c, p, x, null),
    boss: (c, p, x) => obj(c, p, x, null),
  });
  if (t === undefined) return;
  const tables = arrOf(t.tables);
  uniqueIds(ctx, "tables", tables);
  const tableRef = refTo(byId(tables), "drop table");
  const has = (o: Obj, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

  // IT-51: chest は全ダンジョンの全階（"1".."floors"）に表を持つ
  const chest = objOf(t.chest);
  if (chest !== undefined) {
    for (const [dId, x] of Object.entries(chest)) {
      const dp = at("chest", dId);
      const d = ix.dungeons.get(dId);
      if (d === undefined) report(ctx, dp, `unknown dungeon id ${JSON.stringify(dId)}`);
      const fo = obj(ctx, dp, x, null);
      if (fo === undefined) continue;
      const floors = intOf(d?.floors);
      const keys = floors !== undefined && floors >= 1 ? Array.from({ length: floors }, (_, k) => String(k + 1)) : undefined;
      for (const [k, tid] of Object.entries(fo)) {
        if (keys !== undefined && !keys.includes(k)) report(ctx, at(dp, k), `IT-51: floor key must be 1..${floors}`);
        tableRef(ctx, at(dp, k), tid);
      }
      if (keys !== undefined) for (const k of keys) if (!has(fo, k)) report(ctx, at(dp, k), "missing required field");
    }
    for (const dId of ix.dungeons.keys()) if (!has(chest, dId)) report(ctx, at("chest", dId), "missing required field");
  }
  // IT-51: boss は全ダンジョンに表を持つ
  const boss = objOf(t.boss);
  if (boss !== undefined) {
    for (const [dId, tid] of Object.entries(boss)) {
      const dp = at("boss", dId);
      if (!ix.dungeons.has(dId)) report(ctx, dp, `unknown dungeon id ${JSON.stringify(dId)}`);
      tableRef(ctx, dp, tid);
    }
    for (const dId of ix.dungeons.keys()) if (!has(boss, dId)) report(ctx, at("boss", dId), "missing required field");
  }
}

// ---- personalities.json ----

/** UI-62（M5.5）: 性格の短い説明の字数の上限。自分で作るの行の中身 218px ÷ 全角 8px（表示の都合。【仮】ではない） */
const PERSONALITY_SHORT_DESCRIPTION_MAX = 27;

/** UI-62: 1〜PERSONALITY_SHORT_DESCRIPTION_MAX 字の文字列 */
const SHORT_DESC: Field = (ctx, p, v) => {
  const s = str(ctx, p, v);
  const n = s === undefined ? 0 : [...s].length;
  if (n > PERSONALITY_SHORT_DESCRIPTION_MAX) report(ctx, p, `UI-62: too long (${n} > ${PERSONALITY_SHORT_DESCRIPTION_MAX})`);
};

function validatePersonalities(ctx: Ctx, v: unknown): void {
  const a = L(
    F({
      id: E(PERSONALITY_IDS),
      name: S,
      lure,
      canStop: B,
      benefits: F({
        trapDetect: I(PERCENT),
        ambushAvoid: I(PERCENT),
        initiative: I(),
        damage: I(),
        chestQuality: I(NON_NEG),
        hiddenTreasure: I(PERCENT),
      }),
      san: F({
        trapLossMul: N(NON_NEG),
        allyInjuryLossMul: N(NON_NEG),
        fearLossMul: N(NON_NEG),
        treasureGain: I(NON_NEG),
        disobeyBelowHalf: I(PERCENT),
      }),
      autoBattle: E(AUTO_BATTLE_STYLES),
      description: S,
      shortDescription: SHORT_DESC,
    }),
  )(ctx, "", v);
  if (!Array.isArray(a)) return;
  uniqueIds(ctx, "", a);
  // CH-30: 4 つの性格がちょうど 1 回ずつ
  const present = new Set(a.map((p) => get(p, "id")));
  for (const id of PERSONALITY_IDS) if (!present.has(id)) report(ctx, "", `CH-30: personality ${JSON.stringify(id)} is missing`);
  // EV-14 / EV-41: 普通は誘いも恩恵も耐性も持たない
  a.forEach((p, i) => {
    if (get(p, "id") !== "normal") return;
    const base = at("", i);
    for (const k of LURE_TAGS) {
      const x = get(p, "lure", k);
      if (typeof x === "number" && x !== 0) report(ctx, at(at(base, "lure"), k), `EV-14: normal must have lure 0, got ${x}`);
    }
    const benefits = objOf(get(p, "benefits"));
    for (const [k, x] of Object.entries(benefits ?? {}))
      if (typeof x === "number" && x !== 0) report(ctx, at(at(base, "benefits"), k), `EV-41: normal must have no benefit, got ${x}`);
    for (const k of ["trapLossMul", "allyInjuryLossMul", "fearLossMul"]) {
      const x = get(p, "san", k);
      if (typeof x === "number" && x !== 1) report(ctx, at(at(base, "san"), k), `EV-41: normal must have no SAN resistance (1), got ${x}`);
    }
    const tg = get(p, "san", "treasureGain");
    if (typeof tg === "number" && tg !== 0) report(ctx, at(at(base, "san"), "treasureGain"), `EV-41: normal must have treasureGain 0, got ${tg}`);
  });
}

// ---- penalty-table.json ----

/** UI-56（M5.5）: 全滅の出目の表に並べられる帯の数の上限（表示の都合。【仮】ではない） */
const PENALTY_TABLE_MAX_BANDS = 8;

function validatePenaltyTable(ctx: Ctx, v: unknown, ix: Index): void {
  const band: Field = (c, p, x) => {
    const o = fields(c, p, x, {
      min: I(),
      max: I(),
      name: S,
      goldLossRatio: N(RATIO),
      itemLoss: I(NON_NEG),
      expLossRatio: N(RATIO),
      text: S,
    });
    if (!o) return o;
    strKey(c, at(p, "text"), o.text, ix);
    const lo = intOf(o.min);
    const hi = intOf(o.max);
    if (lo !== undefined && hi !== undefined && lo > hi) report(c, p, `TW-22: min ${lo} > max ${hi}`);
    return o;
  };
  const t = fields(ctx, "", v, { dice: D, note: SAnyLen, bands: L(band, 1) });
  if (!t) return;
  // UI-56（M5.5）: 出目の表の箱（高さ 8 + 10 ×（1 + 帯の数））が 2d10 の箱（上端 y98）に届かないよう、帯は 8 以下
  if (Array.isArray(t.bands) && t.bands.length > PENALTY_TABLE_MAX_BANDS) report(ctx, "bands", `UI-56: too many bands (max ${PENALTY_TABLE_MAX_BANDS})`);
  if (typeof t.dice === "string" && t.dice !== "2d10") report(ctx, "dice", `TW-22: expected "2d10", got ${JSON.stringify(t.dice)}`);
  // TW-22: 帯は出目の範囲を隙間なく重複なく覆う
  const range = typeof t.dice === "string" && isDiceExpr(t.dice) ? diceRange(parseDice(t.dice)) : undefined;
  const bands = arrOf(t.bands)
    .map((b, i) => ({ i, min: intOf(get(b, "min")), max: intOf(get(b, "max")) }))
    .filter((b): b is { i: number; min: number; max: number } => b.min !== undefined && b.max !== undefined && b.min <= b.max);
  if (!range || bands.length !== arrOf(t.bands).length) return;
  bands.sort((x, y) => x.min - y.min);
  let next = range.min;
  for (const b of bands) {
    const p = at("bands", b.i);
    if (b.min > next) report(ctx, "bands", `TW-22: rolls ${next}..${b.min - 1} are not covered`);
    else if (b.min < next) report(ctx, p, `TW-22: band ${b.min}..${b.max} overlaps or is outside ${range.min}..${range.max}`);
    next = Math.max(next, b.max + 1);
  }
  if (next <= range.max) report(ctx, "bands", `TW-22: rolls ${next}..${range.max} are not covered`);
  else if (next > range.max + 1) report(ctx, "bands", `TW-22: bands exceed the maximum roll ${range.max}`);
}

// ---- dungeons.json ----

function validateDungeons(ctx: Ctx, v: unknown, ix: Index): void {
  const refField = (ids: ReadonlyMap<string, unknown>, what: string): Field => (c, p, x) => {
    const s = str(c, p, x);
    ref(c, p, s, ids, what);
    return s;
  };
  const a = L(
    F({
      id: S,
      name: S,
      placeholder: opt(B), // DG-35（M9）
      floors: I(POS_INT),
      width: I({ min: 5 }), // DG-02: 生成の前提（部屋が置ける寸法）
      height: I({ min: 5 }), // DG-02
      rooms: opt(pair(NON_NEG)), // DG-05: 省略時は config.dungeon.defaultRooms
      unlock: nullable(refField(ix.dungeons, "dungeon")),
      encounterRate: F({ room: N(RATIO), corridor: N(RATIO) }), // CB-01
      encounterTable: (c, p, x) => obj(c, p, x, null),
      groupCountWeights: (c, p, x) => obj(c, p, x, null),
      boss: F({ monster: refField(ix.monsters, "monster") }),
      // UI-63（M8。2026-10-06）: 迷宮の曲。audio.json の music.songs のどれか
      song: opt((c, p, x) => {
        const s = str(c, p, x);
        if (s !== undefined && !ix.songs.has(s)) report(c, p, `UI-63: unknown song ${JSON.stringify(s)}`);
        return s;
      }),
      events: L(refField(ix.events, "event")),
      traps: L((c, p, x) => {
        const t = oneOf(c, p, x, TRAP_IDS);
        if (t !== undefined) strKey(c, p, `dungeon.trap.${t}`, ix);
        return t;
      }),
      trapsPerFloor: pair(NON_NEG),
      teleporterFloors: L(I(POS_INT)),
      onClear: F({
        unlockDungeon: nullable(refField(ix.dungeons, "dungeon")),
        shopLevel: I(NON_NEG), // IT-62【仮】
      }),
      description: S,
    }),
    1, // DG-01: ダンジョンは 1 件以上（最初のダンジョンは最初から開放）
  )(ctx, "", v);
  if (!Array.isArray(a)) return;
  uniqueIds(ctx, "", a);

  a.forEach((d, i) => {
    if (!isObj(d)) return;
    const p = at("", i);
    const floors = intOf(d.floors);
    const floorKeys = floors !== undefined && floors >= 1 ? Array.from({ length: floors }, (_, k) => String(k + 1)) : undefined;

    // DG-02: 階ごとの表のキーは "1".."floors"
    const perFloor = (key: string, each: (fp: string, x: unknown) => void): void => {
      const o = objOf(d[key]);
      if (!o) return;
      const kp = at(p, key);
      if (floorKeys) {
        for (const k of Object.keys(o)) if (!floorKeys.includes(k)) report(ctx, at(kp, k), `DG-02: floor key must be 1..${floors}`);
        for (const k of floorKeys) if (!(k in o)) report(ctx, at(kp, k), "missing required field");
      }
      for (const [k, x] of Object.entries(o)) each(at(kp, k), x);
    };
    perFloor("encounterTable", (fp, x) => {
      L((c, ep, e) => {
        const o = fields(c, ep, e, { monster: S, weight: I(POS_INT) });
        if (o) ref(c, at(ep, "monster"), o.monster, ix.monsters, "monster");
        return o;
      }, 1)(ctx, fp, x);
    });
    // CB-03: グループ数の重みは maxEnemyGroups 個、合計 > 0
    perFloor("groupCountWeights", (fp, x) => {
      const w = L(I(NON_NEG))(ctx, fp, x);
      if (!Array.isArray(w)) return;
      if (ix.maxEnemyGroups !== undefined && w.length !== ix.maxEnemyGroups)
        report(ctx, fp, `CB-03: expected ${ix.maxEnemyGroups} weights (combat.maxEnemyGroups), got ${w.length}`);
      const nums = w.filter((n): n is number => typeof n === "number");
      if (nums.length === w.length && nums.reduce((s, n) => s + n, 0) <= 0) report(ctx, fp, "CB-03: weights must sum to > 0");
    });

    // DG-22: イベントは重複なく配置
    const evs = arrOf(d.events);
    evs.forEach((e, j) => {
      if (typeof e === "string" && evs.indexOf(e) !== j) report(ctx, at(at(p, "events"), j), `DG-22: duplicate event ${JSON.stringify(e)}`);
    });
    // DG-34: テレポーターの階
    if (floors !== undefined) {
      arrOf(d.teleporterFloors).forEach((f, j) => {
        if (typeof f === "number" && f > floors) report(ctx, at(at(p, "teleporterFloors"), j), `DG-34: floor ${f} exceeds floors ${floors}`);
      });
    }

    // DG-31（M9）: ボスの敵は special.boss
    const bossId = strOf(get(d, "boss", "monster"));
    const bossDef = bossId === undefined ? undefined : ix.monsters.get(bossId);
    if (bossDef !== undefined && get(bossDef, "special", "boss") !== true)
      report(ctx, at(at(p, "boss"), "monster"), `DG-31: boss monster ${JSON.stringify(bossId)} must have special.boss`);

    // DG-35（M9）: 準備中の枠は末尾の側だけ・1 階・次を開かない
    if (d.placeholder === true) {
      if (floors !== undefined && floors !== 1) report(ctx, at(p, "floors"), "DG-35: a placeholder dungeon must have floors 1");
      const next = get(d, "onClear", "unlockDungeon");
      if (next !== undefined && next !== null) report(ctx, at(at(p, "onClear"), "unlockDungeon"), "DG-35: a placeholder dungeon cannot unlock another");
    } else if (a.slice(0, i).some((x) => get(x, "placeholder") === true)) {
      report(ctx, p, "DG-35: a playable dungeon cannot follow a placeholder");
    }

    // DG-01: 配列の順に開放する
    const prevId = i === 0 ? null : strOf(get(a[i - 1], "id"));
    const nextId = i === a.length - 1 ? null : strOf(get(a[i + 1], "id"));
    if (prevId !== undefined && d.unlock !== undefined && d.unlock !== prevId)
      report(ctx, at(p, "unlock"), `DG-01: expected ${JSON.stringify(prevId)}, got ${JSON.stringify(d.unlock)}`);
    const unlockNext = get(d, "onClear", "unlockDungeon");
    if (nextId !== undefined && unlockNext !== undefined && unlockNext !== nextId)
      report(ctx, at(at(p, "onClear"), "unlockDungeon"), `DG-01: expected ${JSON.stringify(nextId)}, got ${JSON.stringify(unlockNext)}`);
  });
}

// ---- events.json ----

/** EV-32: プロトタイプで実装しない効果の種類（データにあれば検証で止める） */
const EFFECTS_NOT_IMPLEMENTED: readonly string[] = ["item", "encounter", "status"];

function validateEvents(ctx: Ctx, v: unknown, ix: Index): void {
  const itemRef: Field = (c, p, x) => {
    const s = str(c, p, x);
    ref(c, p, s, ix.items, "item");
    return s;
  };
  const strRef: Field = (c, p, x) => {
    const s = str(c, p, x);
    strKey(c, p, s, ix);
    return s;
  };
  const placeholdersOf = (key: unknown): string[] =>
    typeof key === "string" ? [...(ix.stringText.get(key) ?? "").matchAll(PLACEHOLDER_RE)].map((m) => m[0]) : [];
  const noPlaceholder = (p: string, key: unknown): void => {
    const ph = placeholdersOf(key);
    if (ph.length > 0) report(ctx, p, `EV-34/E3: strings ${JSON.stringify(key)} must not have placeholders (found ${ph.join(" ")})`);
  };
  const actorOnly = (p: string, key: unknown): void => {
    const bad = placeholdersOf(key).filter((x) => x !== "{actor}");
    if (bad.length > 0) report(ctx, p, `EV-34: strings ${JSON.stringify(key)} may only use {actor} (found ${bad.join(" ")})`);
  };
  const count: Field = (c, p, x) => (typeof x === "number" ? int(c, p, x, POS_INT) : dice(c, p, x));
  const effectU = U({
    gold: { dice: D },
    item: { itemId: opt(itemRef), table: opt(S) },
    damage: { dice: D, target: E(["actor", "party"]) },
    san: { value: I(), target: E(["actor", "party", "others"]) },
    revealFloor: {},
    revealStairs: {},
    consumeItem: { itemId: itemRef, target: E(["actor", "party"]), optional: opt(B) },
    encounter: {
      monster: (c, p, x) => {
        const s = str(c, p, x);
        ref(c, p, s, ix.monsters, "monster");
        return s;
      },
      count,
    },
    status: { status: E(STATUS_IDS), target: E(["actor", "party", "others"]) },
    message: { key: strRef },
    nothing: {},
  });
  const effect: Field = (c, p, x) => {
    const o = effectU(c, p, x);
    if (isObj(o) && o.type === "item" && (o.itemId === undefined) === (o.table === undefined))
      report(c, p, "EV-32: item effect needs exactly one of itemId or table");
    // EV-32: プロトタイプ（M5）で実装しない効果はデータにあれば起動を止める（型と検査の定義は残す）
    if (isObj(o) && typeof o.type === "string" && EFFECTS_NOT_IMPLEMENTED.includes(o.type))
      report(c, p, `EV-32: effect type ${JSON.stringify(o.type)} is not implemented in the prototype (M5)`);
    return o;
  };
  const outcome = F({
    weight: I(POS_INT), // EV-30
    quality: E(OUTCOME_QUALITIES),
    text: strRef,
    effects: L(effect),
    requires: opt(E(["impulse"])), // EV-31
    impulseBonus: opt(L(effect)), // EV-23
  });
  const choice = F({ id: S, label: S, labelKey: strRef, text: strRef, effects: L(effect) }); // A9: labelKey は表示のキー、label は説明
  const a = L(
    F({
      id: S,
      name: S,
      kind: E(EVENT_KINDS),
      lure,
      stat: E(STAT_KEYS),
      stopCheck: B,
      text: F({ intro: strRef, impulse: strRef }), // EV-34
      impulseOutcomes: L(outcome), // 件数は下の EV-01 で kind ごとに検査する
      choices: L(choice),
    }),
  )(ctx, "", v);
  if (!Array.isArray(a)) return;
  uniqueIds(ctx, "", a);
  a.forEach((e, i) => {
    if (!isObj(e)) return;
    if (Array.isArray(e.choices)) {
      uniqueIds(ctx, at(at("", i), "choices"), e.choices);
      // EV-01: 選択型・混合型は衝動が無ければ選択肢で続くので、選択肢が要る
      if ((e.kind === "choice" || e.kind === "mixed") && e.choices.length === 0)
        report(ctx, at(at("", i), "choices"), `EV-01: kind ${JSON.stringify(e.kind)} needs at least 1 choice`);
    }
    // EV-34 / E3: 問い（intro）・選択肢のラベルと語りは params なしで出すので差し込みを持たない。衝動の語りは {actor} だけを差し込む
    const ei = at("", i);
    noPlaceholder(at(at(ei, "text"), "intro"), get(e, "text", "intro"));
    actorOnly(at(at(ei, "text"), "impulse"), get(e, "text", "impulse"));
    arrOf(e.choices).forEach((c, j) => {
      noPlaceholder(at(at(at(ei, "choices"), j), "labelKey"), get(c, "labelKey"));
      noPlaceholder(at(at(at(ei, "choices"), j), "text"), get(c, "text"));
    });
    arrOf(e.impulseOutcomes).forEach((o, j) => actorOnly(at(at(at(ei, "impulseOutcomes"), j), "text"), get(o, "text")));
    // EV-01: 衝動型・混合型は衝動判定をするので、衝動の結果が要る（選択型は空でよい）
    if ((e.kind === "impulse" || e.kind === "mixed") && Array.isArray(e.impulseOutcomes) && e.impulseOutcomes.length === 0)
      report(ctx, at(at("", i), "impulseOutcomes"), `EV-01: kind ${JSON.stringify(e.kind)} needs at least 1 impulse outcome`);
  });
}

// ---- tavern.json（TW-13 / TW-14。M5.5） ----

/** TW-14: 酒場のイベントで使える効果（EV-32 の部分集合） */
const TAVERN_EFFECTS = ["gold", "san", "message", "nothing"] as const;

function validateTavern(ctx: Ctx, v: unknown, ix: Index): void {
  const strRef: Field = (c, p, x) => {
    const s = str(c, p, x);
    strKey(c, p, s, ix);
    if (s !== undefined) {
      const ph = [...(ix.stringText.get(s) ?? "").matchAll(PLACEHOLDER_RE)].map((m) => m[0]);
      if (ph.length > 0) report(c, p, `TW-13/TW-14: strings ${JSON.stringify(s)} must not have placeholders (found ${ph.join(" ")})`);
    }
    return s;
  };
  const effectU = U({
    gold: { dice: D },
    san: { value: I(), target: E(["party"]) },
    message: { key: strRef },
    nothing: {},
  });
  const effect: Field = (c, p, x) => {
    const t = get(x, "type");
    if (typeof t === "string" && !(TAVERN_EFFECTS as readonly string[]).includes(t)) {
      report(c, p, `TW-14: tavern effect type ${JSON.stringify(t)} is not allowed`);
      return undefined;
    }
    return effectU(c, p, x);
  };
  const t = fields(ctx, "", v, {
    lookTexts: L(strRef, 1),
    events: L(F({ id: S, name: S, weight: I(POS_INT), text: strRef, effects: L(effect) }), 1),
  });
  if (!t) return;
  if (Array.isArray(t.events)) uniqueIds(ctx, "events", t.events);
}

// ---- strings.json ----

const PLACEHOLDER_RE = /\{[A-Za-z_][A-Za-z0-9_]*\}/g;

function validateStrings(ctx: Ctx, v: unknown, ix: Index): void {
  const o = obj(ctx, "", v, null);
  if (!o) return;
  for (const [k, x] of Object.entries(o)) {
    const s = str(ctx, k, x);
    if (s === undefined) continue;
    if (/[{}]/.test(s.replace(PLACEHOLDER_RE, ""))) report(ctx, k, `malformed placeholder in ${JSON.stringify(s)}`);
  }
  // 状態異常の名前は battle.status.<StatusId>（文）と party.status.<StatusId>（パーティ欄の短い名前）で引く
  for (const id of STATUS_IDS) {
    strKey(ctx, "", `battle.status.${id}`, ix);
    strKey(ctx, "", `party.status.${id}`, ix);
  }
  // IT-11: core の itemDisplayName が希少度の接頭辞と Lv の書式を引く（通常は接頭辞なし）。item.plus は {n} だけを差し込む
  for (const r of RARITY_IDS) if (r !== "normal") strKey(ctx, "", `item.rarity.${r}`, ix);
  strKey(ctx, "", "item.plus", ix);
  const plus = ix.stringText.get("item.plus");
  if (plus !== undefined) {
    const ph = [...plus.matchAll(PLACEHOLDER_RE)].map((m) => m[0]);
    if (ph.length !== 1 || ph[0] !== "{n}") report(ctx, "item.plus", `IT-11: must have exactly one placeholder {n} (found ${ph.join(" ") || "none"})`);
  }
}

// ---- wavetables.json（UI-63。docs/audio/CONVENTIONS.md §1。M8） ----

/** CONV §1 の波形テーブルの値（32 サンプル・4 bit）。工房の規約の値に固定する */
const WAVE_SAMPLES = 32;
const WAVE_DEPTH = 4;
/** 波形・ノイズ・曲・効果音の名前（工房の名前と同じ文字種） */
const AUDIO_NAME_RE = /^[a-z0-9_]+$/;
const MIDI_7BIT: Range = { min: 0, max: 127 };

/** 名前付きのオブジェクト（波形・ノイズ）。1 個以上、名前は AUDIO_NAME_RE で "noise" でない（CONV §1 の予約語） */
function namedEntries(ctx: Ctx, p: string, v: unknown): [string, unknown][] {
  const o = obj(ctx, p, v, null);
  if (o === undefined) return [];
  const es = Object.entries(o);
  if (es.length === 0) report(ctx, p, "UI-63: expected at least 1 entry");
  for (const [k] of es) {
    if (!AUDIO_NAME_RE.test(k)) report(ctx, at(p, k), `UI-63: name must match ${AUDIO_NAME_RE.source}`);
    else if (k === "noise") report(ctx, at(p, k), 'UI-63: "noise" is reserved (ch4)');
  }
  return es;
}

/** 同じ値を持つ先の名前を報告する（program / note の重複） */
function uniqueValue(ctx: Ctx, p: string, entries: [string, unknown][], key: string, what: string): void {
  const seen = new Map<number, string>();
  for (const [name, e] of entries) {
    const n = intOf(get(e, key));
    if (n === undefined) continue;
    const first = seen.get(n);
    if (first !== undefined) report(ctx, at(at(p, name), key), `UI-63: duplicate ${what} ${n} (${first})`);
    else seen.set(n, name);
  }
}

function validateWavetables(ctx: Ctx, v: unknown): void {
  const o = obj(ctx, "", v, ["samples", "depth", "waves", "noise"]);
  if (o === undefined) return;
  const samples = int(ctx, "samples", o.samples);
  if (samples !== undefined && samples !== WAVE_SAMPLES) report(ctx, "samples", `UI-63: samples must be ${WAVE_SAMPLES}`);
  const depth = int(ctx, "depth", o.depth);
  if (depth !== undefined && depth !== WAVE_DEPTH) report(ctx, "depth", `UI-63: depth must be ${WAVE_DEPTH}`);
  const maxSample = 2 ** WAVE_DEPTH - 1;

  const waves = namedEntries(ctx, "waves", o.waves);
  for (const [name, w] of waves) {
    const p = at("waves", name);
    fields(ctx, p, w, {
      program: I(MIDI_7BIT),
      data: (c, dp, x) => {
        const a = list(c, dp, x);
        if (a === undefined) return undefined;
        if (a.length !== WAVE_SAMPLES) report(c, dp, `UI-63: expected ${WAVE_SAMPLES} samples, got ${a.length}`);
        a.forEach((e, i) => int(c, at(dp, i), e, { min: 0, max: maxSample }));
        return a;
      },
    });
  }
  uniqueValue(ctx, "waves", waves, "program", "program");

  const noise = namedEntries(ctx, "noise", o.noise);
  for (const [name, n] of noise) fields(ctx, at("noise", name), n, { note: I(MIDI_7BIT), clock: N({ positive: true }) });
  uniqueValue(ctx, "noise", noise, "note", "note");
}

// ---- audio.json（UI-63 / UI-65 / UI-66。M8） ----

/** 名前の配列。各要素は AUDIO_NAME_RE。seen に先に出た名前があれば重複として報告する */
function audioNames(ctx: Ctx, p: string, v: unknown, seen: Set<string>, id: string): string[] {
  const out: string[] = [];
  const a = list(ctx, p, v);
  a?.forEach((e, i) => {
    const s = str(ctx, at(p, i), e);
    if (s === undefined) return;
    if (!AUDIO_NAME_RE.test(s)) report(ctx, at(p, i), `${id}: name must match ${AUDIO_NAME_RE.source}`);
    if (seen.has(s)) report(ctx, at(p, i), `${id}: duplicate name ${JSON.stringify(s)}`);
    seen.add(s);
    out.push(s);
  });
  return out;
}

function validateAudio(ctx: Ctx, v: unknown, ix: Index): void {
  const o = obj(ctx, "", v, ["music", "sfx", "screenSongs", "battleSongs", "bossSong", "facilitySongs", "campSong", "cues", "ui"]);
  if (o === undefined) return;

  const musicNames = new Set<string>();
  const music = obj(ctx, "music", o.music, ["songs", "jingles", "noteRange"]);
  const songs = new Set(music ? audioNames(ctx, "music.songs", music.songs, musicNames, "UI-63") : []);
  const jingles = new Set(music ? audioNames(ctx, "music.jingles", music.jingles, musicNames, "UI-63") : []);
  if (music) pair(MIDI_7BIT)(ctx, "music.noteRange", music.noteRange);

  const sfxObj = obj(ctx, "sfx", o.sfx, ["names"]);
  const sfx = new Set(sfxObj ? audioNames(ctx, "sfx.names", sfxObj.names, new Set(), "UI-65") : []);

  const song = (p: string, x: unknown): void => {
    const s = str(ctx, p, x);
    if (s !== undefined && !songs.has(s)) report(ctx, p, `unknown song ${JSON.stringify(s)}`);
  };
  const sfxName = (p: string, x: unknown): void => {
    const s = str(ctx, p, x);
    if (s !== undefined && !sfx.has(s)) report(ctx, p, `unknown sfx ${JSON.stringify(s)}`);
  };

  const screens = obj(ctx, "screenSongs", o.screenSongs, AUDIO_SCREENS);
  if (screens) {
    for (const k of AUDIO_SCREENS) if (screens[k] !== undefined) song(at("screenSongs", k), screens[k]);
    // UI-63（2026-10-06）: 戦闘の曲は battleSongs / bossSong で決める（二重に持たない）
    if (screens.battle !== undefined) report(ctx, at("screenSongs", "battle"), "UI-63: use battleSongs / bossSong for battle");
  }
  L((_c, p, x) => {
    song(p, x);
    return x;
  }, 1)(ctx, "battleSongs", o.battleSongs);
  song("bossSong", o.bossSong);
  const facilities = obj(ctx, "facilitySongs", o.facilitySongs, AUDIO_FACILITIES);
  if (facilities) for (const k of AUDIO_FACILITIES) if (facilities[k] !== undefined) song(at("facilitySongs", k), facilities[k]);
  song("campSong", o.campSong);

  // UI-66: 欄 → それを付けられる event
  const only: Record<string, readonly string[]> = {
    key: ["message", "dice"],
    rarity: ["message"],
    result: ["battleEnd"],
    boss: ["battleEnd"],
    hit: ["attack"],
    target: ["attack", "hpChanged", "statusChanged", "sanChanged", "lifeChanged"],
    loss: ["hpChanged", "sanChanged"],
    status: ["statusChanged"],
    on: ["statusChanged"],
    life: ["lifeChanged"],
  };
  list(ctx, "cues", o.cues)?.forEach((cv, i) => {
    const p = at("cues", i);
    const c = fields(ctx, p, cv, {
      event: E(CUE_EVENTS),
      key: opt(S),
      rarity: opt(E(RARITY_IDS)),
      result: opt(E(CUE_RESULTS)),
      boss: opt(B),
      hit: opt(B),
      target: opt(E(CUE_TARGETS)),
      loss: opt(B),
      status: opt(E(STATUS_IDS)),
      on: opt(B),
      life: opt(E(CUE_LIVES)),
      sfx: opt(S),
      jingle: opt(S),
    });
    if (c === undefined) return;
    const ev = strOf(c.event);
    if ((c.sfx === undefined) === (c.jingle === undefined)) report(ctx, p, "UI-66: exactly one of sfx / jingle");
    if (c.sfx !== undefined) sfxName(at(p, "sfx"), c.sfx);
    const j = strOf(c.jingle);
    if (j !== undefined && !jingles.has(j)) report(ctx, at(p, "jingle"), `unknown jingle ${JSON.stringify(j)}`);
    if (ev === "message" && c.key === undefined) report(ctx, at(p, "key"), "UI-66: required for event message");
    strKey(ctx, at(p, "key"), c.key, ix);
    if (ev === undefined || !(CUE_EVENTS as readonly string[]).includes(ev)) return;
    for (const [k, evs] of Object.entries(only)) {
      if (c[k] !== undefined && !evs.includes(ev)) report(ctx, at(p, k), `UI-66: only for event ${evs.join(" / ")}`);
    }
  });

  const ui = obj(ctx, "ui", o.ui, ["ok", "cancel", "facility", "camp", "talk"]);
  if (ui) for (const k of ["ok", "cancel", "facility", "camp", "talk"] as const) sfxName(at("ui", k), ui[k]);
}

// ---- 全体 ----

export function validateGameData(raw: RawGameData): string[] {
  const issues: string[] = [];
  const ctxOf = (k: keyof RawGameData): Ctx => ({ file: DATA_FILES[k], issues });
  if (!isObj(raw)) return [`(input): expected RawGameData object, got ${raw === null ? "null" : typeof raw}`];
  const ix = buildIndex(raw);
  validateConfig(ctxOf("config"), raw.config, ix);
  validateRaces(ctxOf("races"), raw.races);
  validateClasses(ctxOf("classes"), raw.classes, ix);
  validateSpells(ctxOf("spells"), raw.spells);
  validateMonsters(ctxOf("monsters"), raw.monsters, ix);
  validateUnknownKinds(ctxOf("unknownKinds"), raw.unknownKinds);
  validateItems(ctxOf("items"), raw.items, ix);
  validateEquipmentBases(ctxOf("equipmentBases"), raw.equipmentBases, ix);
  validateItemOptions(ctxOf("itemOptions"), raw.itemOptions, ix);
  validateUniques(ctxOf("uniques"), raw.uniques, ix);
  validateDrops(ctxOf("drops"), raw.drops, ix);
  validatePersonalities(ctxOf("personalities"), raw.personalities);
  validatePenaltyTable(ctxOf("penaltyTable"), raw.penaltyTable, ix);
  validateDungeons(ctxOf("dungeons"), raw.dungeons, ix);
  validateEvents(ctxOf("events"), raw.events, ix);
  validateTavern(ctxOf("tavern"), raw.tavern, ix);
  validateStrings(ctxOf("strings"), raw.strings, ix);
  validateWavetables(ctxOf("wavetables"), raw.wavetables);
  validateAudio(ctxOf("audio"), raw.audio, ix);
  return issues;
}
