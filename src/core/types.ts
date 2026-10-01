// src/core/types.ts — M1 の最終設計
// 方針:
// - GameState は JSON にそのまま保存できるプレーンな値だけで作る（CLAUDE.md §3-11）。
//   GameState の中にはクラス、Map、Set、関数、undefined の値、省略可能なフィールド（?:）を入れない。
//   「無い」は null か空配列・空オブジェクトで表す。
// - verbatimModuleSyntax が有効なので、型は import type で取る。data の型は定義し直さない。
// - import 先は "./data/index" と "./rng"（どちらも src/core 内。architecture.test の制約）。
import type { EquipSlot, GameData, PersonalityId, StatBlock, StatusId } from "./data/index";
import type { RngState } from "./rng";

// ===================== 小さな型 =====================

export type Screen = "title" | "town" | "dungeon" | "battle" | "event";
/** CH-40 */
export type Life = "alive" | "dead" | "ash";
/** dungeon.md §GameState.dive の表記に合わせる（"N"|"E"|"S"|"W"）。M2 で使う。 */
export type Facing = "N" | "E" | "S" | "W";
/** M2 で使う。 */
export type Pos = { x: number; y: number };

/** CH-61: levelHistory の要素。level は、このレコードで到達したレベル（2 以上）。レベル 1 の初期値は入れない。 */
export type LevelRecord = { level: number; hpGain: number; mpGain: number };

// ===================== 戦闘入力（【仮置き】M3 で確定） =====================

export type BattleTarget =
  | { side: "enemy"; group: number }
  | { side: "ally"; memberId: string }
  | { side: "none" };

export type BattleAction =
  | { type: "attack"; group: number }
  | { type: "cast"; spellId: string; target: BattleTarget }
  | { type: "defend" }
  | { type: "item"; instanceId: string; target: BattleTarget }
  | { type: "flee" };

// ===================== アイテム実体（CH-70〜73、DG-40） =====================

/**
 * 所持品 1 個分の実体。持ち主は Character の equipment または inventory からの参照で決まり、ここには書かない。
 * 呪い（CH-73）は items.json の cursed を見る。鑑定済みかどうか（CH-72）は実体ごとに持つ。
 */
export type ItemInstance = {
  /** "i1", "i2", ...（GameState.nextItemSeq で振る。再利用しない） */
  id: string;
  /** items.json の id */
  itemId: string;
  identified: boolean;
};

// ===================== キャラクター（character.md §9 の最低限のフィールドをすべて持つ） =====================

export type Character = {
  /** "c1".."c6"（作成時の添字 + 1）。メンバーの追加は起きない（CH-04）ので、カウンタは持たない。 */
  id: string;
  name: string;
  raceId: string;
  classId: string;
  /** CH-31: リーダーは null */
  personality: PersonalityId | null;
  /** CH-02/03: リーダーの判定は添字ではなくこのフラグで行う（SV-21 の leaderName もここから取る）。 */
  isLeader: boolean;
  stats: StatBlock;
  level: number;
  /** 累計 EXP（CH-64 は累計の閾値と比べる。D6） */
  exp: number;
  /** CH-63 */
  maxLevelReached: number;
  /** CH-61/62。不変条件: levelHistory.length === level - 1、末尾の level === 現在の level */
  levelHistory: LevelRecord[];
  hp: number;
  hpMax: number;
  mp: number;
  mpMax: number;
  san: number;
  sanMax: number;
  life: Life;
  /** CH-43。重複なし */
  status: StatusId[];
  /** spells.json の id。習得した順 */
  knownSpells: string[];
  /** CH-70: 6 スロットのキーを常にすべて持ち、空きは null。値は ItemInstance.id */
  equipment: Record<EquipSlot, string | null>;
  /** CH-71: 装備していない所持品の ItemInstance.id。使用枠 = 装備数 + inventory.length */
  inventory: string[];
  /** CB-40。M3 で使う */
  lastBattleInput: BattleAction | null;
};

// ===================== 進行 =====================

export type Progress = {
  /** DG-01 / TW-11。game.new で [dungeons[0].id] にする */
  unlockedDungeons: string[];
  /** DG-32。SV-21 の summary.clearedCount はこの長さ */
  clearedDungeons: string[];
};

// ===================== GameState =====================
// M1 で確定する欄だけを持つ。dive（M2）、battle・bestiary（M3）、townVisit（M4）は、
// それぞれのマイルストーンで足す（保存が始まる M4 より前なので migrate は要らない）。
// schemaVersion、turn、updatedAt、gameId は保存レコード側の欄（SV-21）で、ここには入れない。

export type GameState = {
  screen: Screen;
  /** §3-2 / SV-03: 乱数の状態も state に含める */
  rng: RngState;
  /** 並び順がそのまま隊列（添字 0..frontRow-1 が前衛。CH-01）。title では空配列 */
  party: Character[];
  /** アイテム実体の表。キーは ItemInstance.id。どこからも参照されない実体を残さない */
  items: Record<string, ItemInstance>;
  /** 次に振るアイテム実体の番号（"i" + nextItemSeq）。1 から始める */
  nextItemSeq: number;
  /** パーティ共有の所持金（CH-05 の startingGold、DG-42、TW-22、TW-30）。0 以上の整数 */
  gold: number;
  /** TW-10。M1 では常に 0 */
  bank: number;
  progress: Progress;
};

// ===================== コマンド（CLAUDE.md §5） =====================

/** D4: members[0] がリーダーで personality は null。それ以外は null 不可。"random" は core が rng で決める（CH-30） */
export type PartySetupMember = { name: string; personality: PersonalityId | "random" | null };
export type PartySetup = { members: PartySetupMember[] };

/** 【仮置き】TW-05（プロトタイプの範囲外。形だけ） */
export type ShopAction =
  | { kind: "buy"; memberId: string; itemId: string }
  | { kind: "sell"; memberId: string; instanceId: string }
  | { kind: "identify"; memberId: string; instanceId: string };

export type Command =
  | { type: "game.new"; party: PartySetup }
  | { type: "town.enter" }
  | { type: "town.inn"; rank: number }
  | { type: "town.temple"; memberId: string; service: "resurrect" | "cure" | "uncurse" }
  | { type: "town.dark"; memberId: string }
  | { type: "town.shop"; action: ShopAction }
  | { type: "town.bank"; amount: number } // 正で預け入れ、負で引き出し
  | { type: "town.mercy"; memberId: string }
  | { type: "dungeon.enter"; dungeonId: string }
  | { type: "dungeon.move" }
  | { type: "dungeon.turn"; dir: "left" | "right" | "around" }
  /** itemId は §5 の名前のまま。中身は ItemInstance.id（items.json の id ではない） */
  | { type: "dungeon.useItem"; memberId: string; itemId: string }
  | { type: "dungeon.cast"; memberId: string; spellId: string; targetId?: string }
  | { type: "battle.input"; memberId: string; action: BattleAction }
  | { type: "battle.resolve" }
  | { type: "battle.auto"; on: boolean }
  | { type: "event.choose"; optionId: string }
  | { type: "party.reorder"; order: string[] };

export type CommandType = Command["type"];

// ===================== イベント =====================

/** 【仮置き】M3 で確定する */
export type EnemyGroupView = { index: number; monsterId: string; count: number; identified: boolean };

/** 【仮置き】M4 で確定する */
export type PenaltyResult = { dice: number[]; total: number; bandIndex: number };

export type GameEvent =
  | { kind: "message"; key: string; params?: Record<string, string | number> }
  | { kind: "moved"; pos: Pos; facing: Facing }
  | { kind: "turned"; facing: Facing }
  | { kind: "blocked" }
  | { kind: "encounter"; groups: EnemyGroupView[] }
  | { kind: "attack"; actorId: string; targetId: string; hit: boolean; damage: number }
  | { kind: "spell"; actorId: string; spellId: string; targets: string[] }
  | { kind: "hpChanged"; id: string; delta: number; hp: number }
  | { kind: "sanChanged"; id: string; delta: number; san: number }
  | { kind: "statusChanged"; id: string; status: StatusId; on: boolean }
  | { kind: "lifeChanged"; id: string; life: Life }
  /** label は strings.json のキー（UI-40 の各判定で使い回す。習得なら "town.inn.learnRoll"） */
  | { kind: "dice"; label: string; dice: number[]; total: number }
  | { kind: "battleEnd"; result: "win" | "flee" | "wipe" }
  | { kind: "wipe"; penalty: PenaltyResult }
  /** §5 に増分と新しい最大値を足した（表示層が state を掘り直さずに済むように） */
  | { kind: "levelUp"; id: string; level: number; hpGain: number; mpGain: number; hpMax: number; mpMax: number }
  /** §5 に追加（CH-62）。1 段下がるごとに 1 件 */
  | { kind: "levelDown"; id: string; level: number; hpMax: number; mpMax: number }
  /** via は §5 に追加（MG-21 の判定 / MG-23 の保証 / MG-25 の魔法書） */
  | { kind: "spellLearned"; id: string; spellId: string; via: "roll" | "guarantee" | "book" }
  | { kind: "eventStarted"; eventId: string; actorId?: string }
  | { kind: "screen"; to: Screen }
  /** D2: 受け付けなかったコマンド。command は受け取った type（形が壊れていれば "unknown"）、reason は英語の短い理由 */
  | { kind: "rejected"; command: string; reason: string };

export type GameEventKind = GameEvent["kind"];

export type ExecuteResult = { state: GameState; events: GameEvent[] };

// ===================== ルール関数の共通引数 =====================

/**
 * execute が作った下書きと、起きたことを積む配列。
 * - ルール関数は ctx.state の中のオブジェクトをその場で書き換えてよい。
 * - 乱数は必ず ctx.state.rng から引く（別の rng を引数で受けない）。
 * - events には起きた順に push する。
 */
export type RuleContext = { state: GameState; data: GameData; events: GameEvent[] };

