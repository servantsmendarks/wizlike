// src/core/types.ts — M1 の最終設計
// 方針:
// - GameState は JSON にそのまま保存できるプレーンな値だけで作る（CLAUDE.md §3-11）。
//   GameState の中にはクラス、Map、Set、関数、undefined の値、省略可能なフィールド（?:）を入れない。
//   「無い」は null か空配列・空オブジェクトで表す。
// - verbatimModuleSyntax が有効なので、型は import type で取る。data の型は定義し直さない。
// - import 先は "./data/index" と "./rng"（どちらも src/core 内。architecture.test の制約）。
import type { EquipSlot, GameData, PersonalityId, StatBlock, StatusId, TrapId } from "./data/index";
import type { RngState } from "./rng";

// ===================== 小さな型 =====================

export type Screen = "title" | "town" | "dungeon" | "battle" | "event";
/** CH-40 */
export type Life = "alive" | "dead" | "ash";
/** dungeon.md §GameState.dive の表記に合わせる（"N"|"E"|"S"|"W"） */
export type Facing = "N" | "E" | "S" | "W";
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

// ===================== 迷宮の構造（生成結果。GameState には入れない。DG-03 / E1） =====================
// 座標は y が南へ増える。N = y-1、E = x+1、S = y+1、W = x-1。添字は y * width + x。

/** DG-04: 辺の種別 */
export type Edge = "wall" | "door" | "open";
/** DG-04: セル種別 */
export type CellKind = "corridor" | "room" | "stairsUp" | "stairsDown" | "boss" | "teleporter" | "event" | "trap";
/**
 * 生成結果のセル 1 つ。4 辺は各セルが持ち、隣のセルと同じ値を二重に持つ（DG-04 の文面どおり）。
 * 辺の書き込みは必ず dungeon-gen.ts の setEdge（両側を同時に書く）を通す。
 */
export type Cell = {
  kind: CellKind;
  n: Edge;
  e: Edge;
  s: Edge;
  w: Edge;
  /** 部屋の中なら Floor.rooms の添字、部屋でなければ null。kind が階段・罠・イベントに上書きされても残る（遭遇率 CB-01 はこれで決める） */
  roomId: number | null;
  /** kind が event のときだけ events.json の id。それ以外は null（DG-22） */
  eventId: string | null;
  /** kind が trap のときだけ罠の id。それ以外は null（DG-20） */
  trapId: TrapId | null;
};
export type Room = { x: number; y: number; w: number; h: number };
/** 1 階分の生成結果。cells は行優先（添字 = y * width + x） */
export type Floor = {
  /** 1 始まり */
  floor: number;
  width: number;
  height: number;
  cells: Cell[];
  rooms: Room[];
  stairsUp: Pos;
  /** 最下層は null */
  stairsDown: Pos | null;
  /** 最下層だけ非 null（DG-05, DG-31） */
  boss: Pos | null;
};

// ===================== 潜行（dungeon.md §6） =====================

/** 発動済みの罠のセル（E4）。M5 で処理済みのイベントセル（DG-22）もここに入れる */
export type CellRef = { floor: number; x: number; y: number };
/** DG-40。items は ItemInstance.id */
export type Ledger = { items: string[]; gold: number };
export type Dive = {
  dungeonId: string;
  /** 0..2^32-1 の整数。dungeon.enter で nextUint32(state.rng) を 1 回だけ引いて発行する（DG-03） */
  diveSeed: number;
  /** 1 始まり */
  floor: number;
  /** DG-14 / CH-51: この潜行で到達した最深の階（入場時 1。常に floor 以上）。これより深い階に降りたときだけ SAN が減る */
  deepestFloor: number;
  pos: Pos;
  facing: Facing;
  /** DG-13: キーは階番号の文字列 "1".."floors"。値はセル添字（y*width+x）の昇順・重複なしの配列（Set は使わない。§3-11） */
  explored: Record<string, number[]>;
  /** E4 */
  clearedCells: CellRef[];
  /** DG-31/32。M2 では常に false */
  bossDefeated: boolean;
  /** DG-40 */
  ledger: Ledger;
};

// ===================== 保留中の選択（E3） =====================

/** labelKey は strings.json のキー */
export type ChoiceOption = { id: string; labelKey: string };
/**
 * 非 null の間は event.choose 以外のコマンドを rejected（"choice pending"）にする。
 * M2 は kind "stairs" だけ。M5 でイベントの選択と罠の察知（DG-21）を kind を足して同じ形で載せる。
 * promptKey は確認文の strings キー（M4 のリロード復帰で再表示に使う）。
 */
export type PendingChoice = { kind: "stairs"; promptKey: string; options: ChoiceOption[] };

// ===================== 表示層向けの問い合わせの結果（rules/dungeon.ts が返す。state には入れない） =====================

/** 視点。省略時は state.dive の floor / pos / facing */
export type ViewPoint = { floor: number; pos: Pos; facing: Facing };
/**
 * DG-12。depth 0 は自分のセル。lane は向きに対する相対（-1 左 / 0 正面列 / 1 右）。
 * front / left / right はそのセルの、向きに対する前・左・右の辺（扉は通り抜けた後も door。DG-10）。x, y は絶対座標（テストと explored 用。描画には使わない）。
 * セルの種別は返さない（罠・イベント・ボスを表示層に漏らさない）。
 */
export type VisibleCell = { depth: number; lane: -1 | 0 | 1; x: number; y: number; front: Edge; left: Edge; right: Edge };
/** UI-24 の記号。罠・イベント・ボス・部屋・通路はすべて plain（地図で明かさない） */
export type MapCellKind = "plain" | "stairsUp" | "stairsDown";
/** 辺は絶対方位（扉は通り抜けた後も door。DG-10） */
export type MapCell = { x: number; y: number; kind: MapCellKind; n: Edge; e: Edge; s: Edge; w: Edge };
/** DG-13 / UI-24。cells は探索済みセルだけ（添字の昇順） */
export type MapView = { dungeonId: string; floor: number; width: number; height: number; pos: Pos; facing: Facing; cells: MapCell[] };

// ===================== GameState =====================
// M1 で確定した欄に、M2 で dive と pendingChoice を足した。battle・bestiary（M3）、townVisit（M4）は、
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
  /** DG-03 / §6。潜行していなければ null */
  dive: Dive | null;
  /** E3。null 以外の間は event.choose 以外を rejected にする */
  pendingChoice: PendingChoice | null;
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
  /** 階の移動（DG-14 の昇降）。moved は同じ階の前進だけに使う */
  | { kind: "floorChanged"; floor: number; pos: Pos; facing: Facing }
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
 *   例外: 迷宮の構造の生成（rules/dungeon-gen.ts）は RuleContext を取らない純粋関数で、
 *   diveSeed と階番号から作る専用の rng だけを使う（DG-03 / E1）。
 * - events には起きた順に push する。
 */
export type RuleContext = { state: GameState; data: GameData; events: GameEvent[] };

