// src/core/types.ts — M1 の最終設計
// 方針:
// - GameState は JSON にそのまま保存できるプレーンな値だけで作る（CLAUDE.md §3-11）。
//   GameState の中にはクラス、Map、Set、関数、undefined の値、省略可能なフィールド（?:）を入れない。
//   「無い」は null か空配列・空オブジェクトで表す。
// - verbatimModuleSyntax が有効なので、型は import type で取る。data の型は定義し直さない。
// - import 先は "./data/index" と "./rng"（どちらも src/core 内。architecture.test の制約）。
import type { EquipSlot, GameData, PersonalityId, SpellTarget, StatBlock, StatKey, StatusId, TrapId, UsableIn } from "./data/index";
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

// ===================== 戦闘の入力（M3 で確定。combat.md CB-10〜16） =====================

/**
 * battle.input の対象。
 * - side "enemy": attack の対象、spell.target が enemy / enemyGroup の呪文。group は BattleState.groups の添字
 * - side "ally": spell.target / items[].effect.target が ally
 * - side "none": allEnemies / party / self / none（対象を選ばない）
 */
export type BattleTarget =
  | { side: "enemy"; group: number }
  | { side: "ally"; memberId: string }
  | { side: "none" };

/** CB-12。attack.group は BattleState.groups の添字。instanceId は使う本人の inventory にある ItemInstance.id */
export type BattleAction =
  | { type: "attack"; group: number }
  | { type: "cast"; spellId: string; target: BattleTarget }
  | { type: "defend" }
  | { type: "item"; instanceId: string; target: BattleTarget };

// ===================== アイテム実体（CH-70〜73、DG-40） =====================

/** IT-30: 希少度（オプションの個数 通常 0 / 上質 1 / 希少 2 / 伝説 3）。消耗品・魔法書は normal */
export type Rarity = "normal" | "fine" | "rare" | "legendary";

/** IT-33: 実体が持つオプション 1 つ。生成時に決めた値のまま。options の値は正、curseEffect（IT-32。M24）の値は負 */
export type ItemOptionRoll = { optionId: string; tier: 1 | 2 | 3; value: number };

/**
 * 所持品 1 個分の実体（IT-10。M7 で level 以下を足した）。持ち主は Character の equipment / inventory、GameState の warehouse / buyback
 * からの参照で決まり、ここには書かない。鑑定済みかどうか（CH-72）と呪い（CH-73 / IT-32）は実体ごとに持つ。
 * GameState に入れる値なので省略可能な欄は持たない（無いは null か空配列）。
 */
export type ItemInstance = {
  /** "i1", "i2", ...（GameState.nextItemSeq で振る。再利用しない） */
  id: string;
  /** 装備は equipment-bases.json の id（ユニークならそのベース）、消耗品・魔法書は items.json の id */
  itemId: string;
  /** IT-20〜23: 汎用装備の Lv（0 以上）。ユニーク・消耗品・魔法書は 0 */
  level: number;
  rarity: Rarity;
  options: ItemOptionRoll[];
  /** IT-03: ユニークなら uniques.json の id、そうでなければ null */
  uniqueId: string | null;
  identified: boolean;
  /** IT-32 / CH-73: 呪われているか（鑑定と関係なく効く） */
  cursed: boolean;
  /**
   * IT-32（M24）: 呪いの負の効果（options の枠を使わない。値は負）。呪われていなければ null。
   * 不変条件: curseEffect !== null ⇒ cursed（母集団が尽きて効果の無い呪いはあり得る: cursed で null）
   */
  curseEffect: ItemOptionRoll | null;
  /** IT-66: ドロップしたダンジョンの id。店で買った品・初期装備は null */
  foundIn: string | null;
};

/** IT-66: 図鑑（ユニーク）の 1 種類分。鑑定した時点で記録する */
export type UniqueBookEntry = { foundIn: string | null; bestRarity: Rarity };

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
  /**
   * CH-63（SV-04 schemaVersion 5）: 職業ごとの最高到達レベル（classId → レベル）。今の職業の欄は常にあり、level 以上。
   * 全体の最高到達レベル（U5）は値の最大（growth.peakLevelReached。別の欄は持たない）
   */
  maxLevelReached: Record<string, number>;
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
  /** CB-40。手入力の最後の行動。戦闘の開始で null に戻る（M16） */
  lastBattleInput: BattleAction | null;
};

// ===================== 進行 =====================

export type Progress = {
  /** DG-01 / TW-11。game.new で [dungeons[0].id] にする */
  unlockedDungeons: string[];
  /** DG-32。SV-21 の summary.clearedCount はこの長さ */
  clearedDungeons: string[];
  /** IT-62（M7）: 店の流通レベル。game.new で 0 */
  shopLevel: number;
  /**
   * DG-37（M12。schemaVersion 7）: 一度でも入場（dungeon.enter の成立）したダンジョンの id（初めて入った順。重複なし）。game.new で []。
   * 初回入場の語り（enterSpeech）の判定に使う。v6 からの移行では clearedDungeons と潜行中の dive.dungeonId から復元する
   */
  enteredDungeons: string[];
  /**
   * DG-47（M21）: ダンジョンごとに到達した最深の階（キーはダンジョンの id、値は 1 以上）。入場（DG-03）で 1、降りる（DG-14）で dive.floor との大きい方にする。
   * 潜行・全滅をまたいで残し、下げない。省略可能（schemaVersion 9 のまま足した欄。無ければ記録なしとして読む。移行は無い。SV-04）。game.new では作らない
   */
  deepestFloors?: Record<string, number>;
  /**
   * CB-51b（M21。schemaVersion 10）: ランダム遭遇の勝利でドロップの箱が出なかった連続の回数（0 以上の整数。出たら 0）。game.new で 0。
   * 潜行をまたいで持ち越す（入場・帰還・全滅では戻さない）。v9 からの移行では dive.noChestStreak（無ければ 0）
   */
  noChestStreak: number;
  /**
   * IT-64 / TW-10（M24 D-1。schemaVersion 11）: 倉庫の枠数。game.new で config.items.warehouseSlots（40）、town.storage の expand で
   * config.bank.expandSlots ずつ増え config.bank.maxSlots で止まる。v10 からの移行では 40
   */
  warehouseSlots: number;
  /** DG-36（M12。schemaVersion 7）: 全ダンジョン制覇。一度立てたら落とさない。game.new で false */
  conquered: boolean;
  /** TW-34（M12。schemaVersion 7）: 結末を街で語る予定。語ったら false。game.new で false */
  endingPending: boolean;
  /**
   * UI-76（M16。schemaVersion 8）: 出した一度きりの GM の一言のキー（hint.* の * の部分。順不同、重複なし）。game.new で []。
   * 積むのは rules/hints.ts tellHintOnce だけ。v7 からの移行では []（既存の記録では一言がもう一度出る）
   */
  hints: string[];
};

/**
 * TW-35（M12。schemaVersion 7）: 戦績の通算。ゲーム単位で永続（全滅・帰還で戻さない）。game.new で全部 0。
 * 数える所は各項目 1 か所（rules/progress.ts bumpTally を呼ぶ）: dives は enterDungeon、battles は startBattle（random・boss・alarm）、
 * deaths は alive → dead の 2 か所（combat.ts allyDies・field.ts damageMembers）、ashes は town.ts rollResurrect の失敗、wipes は wipe.ts performWipe
 */
export type Tally = { dives: number; battles: number; deaths: number; ashes: number; wipes: number };

/**
 * TW-35（M12）: 戦績の画面の値（rules/progress.ts endingRecordView）。turns は adventureTurns。
 * bestiary.known は bestiary のうち identified が真の種類の数、total は data.monsters の数。uniques.known は uniqueBook のキー数、total は data.uniques の数
 */
export type EndingRecord = {
  dives: number;
  battles: number;
  deaths: number;
  ashes: number;
  wipes: number;
  turns: number;
  bestiary: { known: number; total: number };
  uniques: { known: number; total: number };
};

// ===================== 迷宮の構造（生成結果。GameState には入れない。DG-03 / E1） =====================
// 座標は y が南へ増える。N = y-1、E = x+1、S = y+1、W = x-1。添字は y * width + x。

/** DG-04: 辺の種別 */
export type Edge = "wall" | "door" | "open";
/** DG-04: セル種別。rock は DG-48（M21）の岩（充填率で間引いた通路。4 辺 wall で、床に数えない） */
export type CellKind = "corridor" | "room" | "stairsUp" | "stairsDown" | "boss" | "teleporter" | "event" | "trap" | "chest" | "rock";
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
  /**
   * M11（DG-04 / DG-23）: kind が chest のときだけ意味を持つ、生成時に引いた宝箱の罠（chest-traps.json の id。罠なしは null）。
   * それ以外の kind では null（floorOf が処理済みのセルを戻すときも null にする）
   */
  chestTrapId: string | null;
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
  /**
   * DG-46（M18。schemaVersion 9）: 今の階で前進が成立した歩数。入場・階の移動（昇降）・転移（DG-25）で 0、前進の 1 歩で +1。
   * 旋回・罠の察知の引き返す・debug.warp では変えない。config.dungeon.lostHintSteps に届いて下り階段が未探索なら hint.lostExits（UI-76）
   */
  floorSteps: number;
  pos: Pos;
  facing: Facing;
  /** DG-13: キーは階番号の文字列 "1".."floors"。値はセル添字（y*width+x）の昇順・重複なしの配列（Set は使わない。§3-11） */
  explored: Record<string, number[]>;
  /** E4: 発動した罠と、処理済みのイベントのセル（EV-33。選択の保留中はまだ入らない） */
  clearedCells: CellRef[];
  /** DG-21（M5.5）: 察知した罠のセル。キーは階番号の文字列、値はセル添字（y*width+x）の昇順・重複なし（explored と同じ形）。発動して clearedCells に入ったら外す。入場時 {} */
  knownTraps: Record<string, number[]>;
  /** DG-31/32。M2 では常に false */
  bossDefeated: boolean;
  /** DG-40 */
  ledger: Ledger;
  /**
   * CB-60（M11。schemaVersion 6）: 見つけて、まだ片付いていない宝箱。非 null の間（戦闘中を除く）は chest.* 以外のコマンドを rejected（"chest pending"）にする。
   * 不変条件: 非 null なら pendingChoice は null
   */
  chest: ChestState | null;
  /** CB-64 / DG-24（M11。schemaVersion 6）: 罠が無くなった（解除の成功・作動）宝箱のセル。入場時 [] */
  disarmedChests: CellRef[];
  /**
   * DG-24 / EV-16（M11。D-2）: 衝動判定（EV-16 / EV-25）と職業の掛け合い（EV-71）を一度行った宝箱のセル。踏み直したら両方を省く。
   * 重複なし。省略可能（schemaVersion 6 のまま足した欄。無ければ空として扱い、最初に判定したときに作る）
   */
  judgedChests?: CellRef[];
  /**
   * DG-48（M21）: この潜行の階は dungeons[].fillRatio で間引く（入場で true）。
   * 省略可能（schemaVersion 9 のまま足した欄。無ければ M20 までの潜行として間引かない = fillRatio 1 で生成。途中の潜行の盤を変えないため）
   */
  culled?: boolean;
  /**
   * CH-43b（M23。M22 の poisonWarned を改名）: HP の警告（hpWarn）を出して、まだ弱ったままの者の id。戦闘の開始で空になる。
   * 省略可能（schemaVersion 10 のまま足した欄。無ければ空。古いセーブの poisonWarned は読まない）
   */
  hpWarned?: string[];
};

/**
 * CB-60（M11）: 宝箱 1 つの状態。
 * - source: drop は戦闘後のドロップ（CB-51）、cell は階に置かれた宝箱のセル（DG-23。cell が非 null）
 * - inRoom: 見つけたセルが部屋か（警報の遭遇の部屋 / 通路。CB-67）
 * - trapId: 今かかっている罠（chest-traps.json の id。解除・作動で null）
 * - danger: 見つけた時点の危険度（罠なし 0）。解除・作動しても残す。使うのは中身の上振れ（IT-56）だけ（調べる・解除の式は trapId から引く）
 * - level: 中身の Lv（IT-53）
 * - finding: 最後の「調べる」で GM が告げた名前（偽りもありうる）。{ trapId: null } は「罠は無さそう」、null は未調査か作動の後（不明に終わった調べ直しは前の値を残す。M18）。解除に成功したら { trapId: null }
 * - rivalry: 職業の掛け合い（EV-70〜76）の担当。発生していなければ null
 * - rivalryFails: 担当の調べるの失敗の数（EV-76。片付いた時点で清算する）
 * - contentsDestroyed: 爆弾で中身（品）が吹き飛んだ印（CB-68 (a)。M21）
 */
export type ChestState = {
  source: "drop" | "cell";
  cell: CellRef | null;
  inRoom: boolean;
  trapId: string | null;
  danger: number;
  level: number;
  finding: { trapId: string | null } | null;
  rivalry: { id: string; ownerId: string } | null;
  /**
   * EV-76（U-7 (b)。2026-10-08）: 担当がこの箱の調べるに失敗した回数（まだ語っていない分）。箱が片付いた時点でまとめて SAN に効かせる。
   * 省略可能（schemaVersion 6 のまま足した欄）。無ければ 0。あれば 1 以上で、rivalry は非 null
   */
  rivalryFails?: number;
  /**
   * CB-68 (a)（M21）: 爆弾（効果に destroyContents がある罠）の作動で中身が吹き飛んだ。開けるとき金だけ配り、品は引かない。
   * 省略可能（schemaVersion 9 のまま足した欄）。無ければ偽。立てるときは true だけ
   */
  contentsDestroyed?: boolean;
};

// ===================== 保留中の選択（E3） =====================

/** labelKey は strings.json のキー */
export type ChoiceOption = { id: string; labelKey: string };
/**
 * 非 null の間は event.choose 以外のコマンドを rejected（"choice pending"）にする。
 * 階段・出口・テレポーター・罠の察知（DG-21）・イベントの選択（EV-31）を kind で区別して同じ形で載せる。kind ごとに option id の意味が違う（id が重なってもよい）。
 * promptKey は確認文の strings キー（params なし。リロード復帰で表示層が出し直す）。
 * 不変条件: これを立てる execute は、同じ events の中に key === promptKey（params なし）の message を必ず出す。
 * option id: kind stairs は "descend" | "ascend" | "stay"（M2）と "exit"（DG-06 の 1 階の上り階段）と "pass"（M19。stay と同じ効果。UI-25）、kind teleporter は "teleport" | "stay"（DG-32）、
 * kind trap は "retreat" | "proceed"（DG-21）、kind event は events[].choices[].id（EV-31）
 */
export type PendingChoice =
  | { kind: "stairs" | "teleporter"; promptKey: string; options: ChoiceOption[] }
  /** DG-21: 罠の察知。options は retreat / proceed。戻り先は step(pos, opposite(facing)) で導くので欄は持たない */
  | { kind: "trap"; promptKey: string; options: ChoiceOption[] }
  /** EV-31/33: イベントの選択。screen === "event" と同値。promptKey は events[].text.intro。options の id は choices[].id */
  | { kind: "event"; promptKey: string; options: ChoiceOption[]; eventId: string };

// ===================== 街の来訪（TW-30〜32） =====================

/** 1 回の来訪の状態。arriveTown（帰還・全滅）と game.new で作り、dungeon.enter で null に戻す */
export type TownVisit = {
  /** TW-30/31: この来訪で town.mercy を 1 回使える。受け付けたら false */
  mercyOffered: boolean;
};

// ===================== 表示層向けの問い合わせの結果（rules/dungeon.ts が返す。state には入れない） =====================

/** 視点。省略時は state.dive の floor / pos / facing */
export type ViewPoint = { floor: number; pos: Pos; facing: Facing };
/**
 * DG-12。depth 0 は自分のセル。lane は向きに対する相対（-1 左 / 0 正面列 / 1 右）。
 * front / left / right はそのセルの、向きに対する前・左・右の辺（扉は通り抜けた後も door。DG-10）。x, y は絶対座標（テストと explored 用。描画には使わない）。
 * stairs はそのセルが上り階段（stairsUp）なら "up"、下り階段（stairsDown）なら "down"、それ以外は null（UI-20 の階段の記号）。
 * それ以外のセルの種別は返さない（罠・イベント・ボスを表示層に漏らさない）。
 */
export type VisibleCell = {
  depth: number;
  lane: -1 | 0 | 1;
  x: number;
  y: number;
  front: Edge;
  left: Edge;
  right: Edge;
  stairs: "up" | "down" | null;
};
/**
 * UI-24 の記号。察知した罠（dive.knownTraps。M5.5）は trap。開ける前の宝箱のセル（DG-23。M11）は chest。
 * 察知していない罠・イベント・ボス・部屋・通路はすべて plain（地図で明かさない）
 */
export type MapCellKind = "plain" | "stairsUp" | "stairsDown" | "trap" | "chest";
/** UI-78（M18）: 未踏の口の辺の向き（MapCell の辺の名前と同じ小文字の絶対方位） */
export type MapEdgeDir = "n" | "e" | "s" | "w";
/**
 * 辺は絶対方位（扉は通り抜けた後も door。DG-10）。
 * exits（UI-78。M18）: 辺が open か door で、その先のセルが盤の内側にあり探索済み（cells）でない辺。順は n, e, s, w
 */
export type MapCell = { x: number; y: number; kind: MapCellKind; n: Edge; e: Edge; s: Edge; w: Edge; exits: MapEdgeDir[] };
/** DG-13 / UI-24。cells は探索済みセルだけ（添字の昇順）。unexploredExits は cells の exits の総数（UI-78。M18） */
export type MapView = {
  dungeonId: string;
  floor: number;
  width: number;
  height: number;
  pos: Pos;
  facing: Facing;
  cells: MapCell[];
  unexploredExits: number;
};

/**
 * CB-60 / UI-70（M11）: 宝箱の操作の値。rules/chest.ts の chestView(state, data)。dive.chest が非 null で、battle も pendingChoice も null のときだけ非 null。
 * 判定の成否・罠の有無と危険度は載せない（表示層に漏らさない）。
 * - members: パーティ全員（並び順）。canAct の者だけが調べる・解除の人に選べる（リーダーも可）
 * - trapNames: chest-traps.json の全種（データの順）。name は表示名（strings を引いた値）。解除で宣言する名前の一覧。amount は効果が san の罠だけ（M24 F-5。一覧の説明「全員の正気 −{n}」の n。表示のための参照）
 * - finding: 最後の「調べる」で告げられた結果（ChestState.finding）。trapId null は「罠は無さそう」。name は trapId の表示名（null なら null）
 * - ownerId: 職業の掛け合い（EV-73）で決まった担当の id（ChestState.rivalry の ownerId。語りで告げた公開の値）。発生していなければ null。UI-70 の人の段の印
 */
export type ChestView = {
  source: "drop" | "cell";
  /** thief: 盗賊の補正（config.chest の thiefBonus。職業の abilities に disarm）が効く者（M19 D-5。人の段の「（得意）」の印） */
  members: { id: string; name: string; canAct: boolean; thief: boolean }[];
  trapNames: { id: string; name: string; amount?: number }[];
  finding: { trapId: string | null; name: string | null } | null;
  ownerId: string | null;
};

// ---- 経路探索（DG-15。rules/pathfind.ts。state には入れない） ----
export type RouteCommand = Extract<Command, { type: "dungeon.move" } | { type: "dungeon.turn" }>;
/** 経路の 1 手。pos / facing は、この手を送って受け付けられた後に居るはずの位置と向き */
export type RouteStep = { command: RouteCommand; pos: Pos; facing: Facing };

// ===================== 戦闘の状態（M3。GameState.battle） =====================

/**
 * CB-25: 敵の 1 個体。hp <= 0 が死亡。死んでも配列から消さない。
 * id は保存せず、位置から "e{グループ添字}-{個体添字}"（rules/combat-calc.ts の enemyId）で作る。
 */
export type EnemyUnit = {
  hp: number;
  hpMax: number;
  /** 重複なし。M3 で付く経路は sleep_mist の sleep だけ */
  status: StatusId[];
};

/** CB-03: 同じ種類の敵の集まり。groups の添字は戦闘中に詰めない（CB-42「添字が最小の生存グループ」）。鑑定済みかは bestiary だけが持つ */
export type EnemyGroup = { monsterId: string; units: EnemyUnit[] };

/** 遭遇の出どころ。逃走の可否は origin から導く（random と alarm だけ可。CB-02）。イベントの encounter 効果（EV-32）を実装するときに { kind: "event"; eventId: string } を足す */
export type BattleOrigin =
  | { kind: "random"; inRoom: boolean } // CB-01。inRoom は遭遇したセルの roomId !== null（CB-51 の宝箱）
  | { kind: "boss" } // DG-31
  | { kind: "alarm"; inRoom: boolean }; // CB-67（M11）: 宝箱の警報の罠。inRoom は箱の inRoom。勝っても新しい宝箱の判定（CB-51）はしない

/**
 * F1: 戦闘中だけ非 null。state.screen === "battle" と同値。
 * ラウンドの解決は 1 回の execute で完結するので、防御・initiative・行動計画は state に持たない。
 */
export type BattleState = {
  origin: BattleOrigin;
  /** 始めたラウンドの数（0 始まり。敵の奇襲・逃走失敗のラウンドも数える） */
  round: number;
  /** CB-04: 真なら次の battle.resolve で敵は行動しない。battle.resolve の先頭で必ず false に戻す */
  partySurprise: boolean;
  groups: EnemyGroup[];
  /** CB-10: memberId → 入力。ラウンドの終わり（決着しなかったとき）に {} へ戻す。同じメンバーへの再入力は上書き */
  inputs: Record<string, BattleAction>;
  /** F2: パーティ単位のオート。開始時 false */
  auto: boolean;
  /** CB-47（M21。省略可能）: battle.auto on の spells が false のときだけ false。無ければ真（オートで CB-46 の呪文を選ぶ）。OFF にすると消す */
  autoSpells?: boolean;
  /** CB-20: 戦闘中だけの AC 補正（blessing の −2 を加算で重ねる）。memberId → 合計。無いキーは 0 */
  acBonus: Record<string, number>;
};

/** CB-05 / F6: 図鑑の 1 種類分。初めて遭遇したときにキーを作る */
export type BestiaryEntry = { kills: number; identified: boolean };

/**
 * TW-15（M7）: 宿の士気。士気の立つランク（sanOver / goodWeight / judgeBonus / gossip のどれかが 0 / false でない）に泊まると立ち、
 * 次に街に入る（arriveTown）まで有効。効果はいつも config.town.innRanks の rankId の行から読む（state.ts moraleOf）
 */
export type Morale = { rankId: string };

// ===================== GameState =====================
// M1 で確定した欄に、M2 で dive と pendingChoice、M3 で battle と bestiary、M4 で townVisit を足した。
// M4 のこの形を保存レコードの schemaVersion 1 として確定する（以後の変更は src/save/migrate.ts の移行を伴う）。
// M5.5 で adventureTurns・tavernEventMark・dive.knownTraps を足して schemaVersion 2 にした（migrateV1toV2）。
// M7 の A で morale を足して schemaVersion 3 にした（migrateV2toV3）。
// M7 の B で ItemInstance の欄・warehouse・buyback・uniqueBook・progress.shopLevel を足して schemaVersion 4 にした（migrateV3toV4）。
// M10 で maxLevelReached を職業ごとにして 5（migrateV4toV5）、M11 で dive.chest・disarmedChests を足して 6（migrateV5toV6）にした。
// M12 で tally・progress.enteredDungeons / conquered / endingPending を足して schemaVersion 7 にした（migrateV6toV7）。
// M16 で progress.hints を足して 8（migrateV7toV8）、M18 で dive.floorSteps を足して 9（migrateV8toV9）にした。
// M21 で dive.noChestStreak を progress.noChestStreak に移して 10（migrateV9toV10。CB-51b）にした。
// schemaVersion、turn、updatedAt、gameId は保存レコード側の欄（SV-21）で、ここには入れない。

export type GameState = {
  /** event は pendingChoice.kind === "event" と同値（イベントの選択を待つ間だけ。M5 / A4） */
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
  /** F1: 戦闘中だけ非 null（screen === "battle" と同値） */
  battle: BattleState | null;
  /** F6: monsterId → 記録。ゲーム単位で永続（戦闘・潜行・全滅をまたぐ） */
  bestiary: Record<string, BestiaryEntry>;
  /** TW-30〜32。screen === "town" と townVisit !== null は同値（title / dungeon / battle では null） */
  townVisit: TownVisit | null;
  /** TW-12（M5.5）: 冒険のターン数。dungeon.move の前進が成立した 1 歩ごとに +1、戦闘のラウンドを 1 つ解決するごと（runRound。battle.round と同時）に +1。game.new で 0。全滅・帰還で戻さない（ゲーム単位で永続） */
  adventureTurns: number;
  /** TW-14（M5.5）: 前に酒場のイベントが起きた時点の adventureTurns。game.new で 0 */
  tavernEventMark: number;
  /** TW-15（M7）: 宿の士気。title では null。街に入る（arriveTown）と null に戻す */
  morale: Morale | null;
  /** TW-16 / IT-64（M7）: 倉庫の ItemInstance.id。全滅の対象外 */
  warehouse: string[];
  /** IT-63（M7）: 店の買い戻しのストック。売ったユニークの ItemInstance.id（売った順）。全滅の対象外 */
  buyback: string[];
  /** IT-66（M7）: 図鑑（ユニーク）。uniqueId → 記録。ゲーム単位で永続 */
  uniqueBook: Record<string, UniqueBookEntry>;
  /** TW-35（M12。schemaVersion 7）: 戦績の通算。game.new で全部 0 */
  tally: Tally;
};

// ===================== コマンド（CLAUDE.md §5） =====================

/** D4: members[0] がリーダーで personality は null。それ以外は null 不可。"random" は core が rng で決める（CH-30） */
export type PartySetupMember = { name: string; personality: PersonalityId | "random" | null };
/** CH-06（M5.5）: 自分で作った 1 人。stats は種族の基礎値にボーナスを配分した値（CH-11）。職業は requirements を満たすこと（CH-21） */
export type CustomMember = {
  name: string;
  personality: PersonalityId | "random" | null;
  raceId: string;
  classId: string;
  stats: StatBlock;
};
/** CH-05: おすすめ（簡易作成）。種族・職業・能力値・装備は prototypeParty */
export type QuickPartySetup = { members: PartySetupMember[] };
/** CH-06（M5.5）: 自分で作る。装備・所持品・呪文・所持金は classes[].start（CH-24） */
export type CustomPartySetup = { kind: "custom"; members: CustomMember[] };
export type PartySetup = QuickPartySetup | CustomPartySetup;

/**
 * TW-05（M7 で在庫制を置き換えた。IT-60〜65）。buy の itemId は items.json の消耗品（infinite）か、流通レベルの汎用ベースの id（IT-62）。
 * sell / buyback / identify の instanceId は ItemInstance.id（sell / identify は本人の inventory、buyback は GameState.buyback のもの）
 */
export type ShopAction =
  | { kind: "buy"; memberId: string; itemId: string }
  | { kind: "sell"; memberId: string; instanceId: string }
  | { kind: "buyback"; memberId: string; instanceId: string }
  | { kind: "identify"; memberId: string; instanceId: string };

export type Command =
  | { type: "game.new"; party: PartySetup }
  | { type: "town.enter" }
  | { type: "town.inn"; rank: number }
  /** TW-07（M24）: instanceId は解呪（uncurse）の品。uncurse のときだけ要る（rules/town の uncurseTargets のどれか） */
  | { type: "town.temple"; memberId: string; service: "resurrect" | "cure" | "uncurse"; instanceId?: string }
  | { type: "town.dark"; memberId: string }
  | { type: "town.shop"; action: ShopAction }
  | { type: "town.bank"; amount: number } // 正で預け入れ、負で引き出し
  | { type: "town.mercy"; memberId: string }
  /**
   * TW-09 / CH-22（M10）: 酒場で GM に申し出る転職。街（screen town・dive null）だけ。素の能力値が新しい職業の requirements を満たすこと。
   * level 1・exp 0、hpMax と習得呪文は保持、mpMax は新しい職業の L1 の値（U2）。乱数は使わない
   */
  | { type: "town.classChange"; memberId: string; classId: string }
  /** TW-16 / IT-64（M7）: 倉庫。deposit は本人の inventory の実体を warehouse へ、withdraw は warehouse の実体を本人の inventory へ。乱数は使わない */
  | { type: "town.storage"; action: "deposit" | "withdraw"; memberId: string; instanceId: string }
  | { type: "town.storage"; action: "expand" } // TW-10（M24 D-1）倉庫を広げる
  | { type: "town.storage"; action: "depositAll"; memberId: string | null } // TW-16b（M17）すべて預ける。null = 全員
  /**
   * TW-17（M7）: 闇魔術の強化。本人の equipment[slot] の汎用装備を、パーティの誰かの inventory の鑑定済みの汎用装備（catalysts。0〜upgradeMaxCatalysts 個、
   * 重複なし。成否に関わらず持ち主の inventory から消える。M16 で本人だけから全員に広げ、持ち主と実体の組にした）を触媒に d100 で鍛える。乱数は d100 の 1 回
   */
  | { type: "town.upgrade"; memberId: string; slot: EquipSlot; catalysts: UpgradeCatalystRef[] }
  /** TW-13（M5.5）: 酒場で見回す。街（screen town・dive null）だけ。乱数を使う */
  | { type: "town.lookAround" }
  | { type: "dungeon.enter"; dungeonId: string }
  | { type: "dungeon.move" }
  | { type: "dungeon.turn"; dir: "left" | "right" | "around" }
  /**
   * DG-44（M16）: 今いる階段のセルで、前進で入ったときと同じ確認（1 階の上りは exit / stay、2 階以降の上りは ascend / stay、下りは descend / stay）を出す。
   * 迷宮の戦闘外・保留なし・宝箱なし・行動可能な者がいるときだけ（core の stairsHere が非 null）。乱数は使わない
   */
  | { type: "dungeon.useStairs" }
  /**
   * DG-45（M18）: 敵を待つ（旧 辺りを探る）。その場で 1 歩ぶんの時間を進め（毒と walkRegen）、生存者の SAN を config.san.search 減らし、
   * 部屋の遭遇率で遭遇を判定する（CB-01b）。迷宮の戦闘外・保留なし・宝箱なし・行動可能な者がいるときだけ。乱数は遭遇の d100 だけ
   */
  | { type: "dungeon.search" }
  /**
   * itemId は §5 の名前のまま。中身は ItemInstance.id（使う本人の inventory のもの。items.json の id ではない）。
   * targetId は effect.target === "ally" のときだけ必須、他では無視（dungeon.cast と同じ形。types.ts を正とする）
   */
  | { type: "dungeon.useItem"; memberId: string; itemId: string; targetId?: string }
  /** MG-44: 戦闘外の呪文（迷宮の戦闘外と、M5.5 から街。帰還は迷宮だけ）。targetId は spell.target が ally のときだけ必要（resurrect では life dead の者） */
  | { type: "dungeon.cast"; memberId: string; spellId: string; targetId?: string }
  | { type: "battle.input"; memberId: string; action: BattleAction }
  | { type: "battle.resolve" }
  /** F2。CB-47（M21）: spells は設定「オートの呪文」（省略は true。false なら CB-46 の呪文を選ばない）。ON にするときだけ効く */
  | { type: "battle.auto"; on: boolean; spells?: boolean }
  /** CB-12/50: パーティの「逃げる」。入力済みの行動を捨てて、すぐに逃走判定をする */
  | { type: "battle.flee" }
  /** CB-12/40: パーティの「前回と同じ」。行動可能な全員の入力をオート入力の規則で作り、1 ラウンドだけ解決する */
  | { type: "battle.repeat"; spells?: boolean }
  | { type: "event.choose"; optionId: string }
  /** CH-03: パーティ全員の id を並べ替えたもの（同じ集合で重複なし）。街と、迷宮の戦闘外かつ保留なしのとき */
  | { type: "party.reorder"; order: string[] }
  /**
   * CH-76: 本人の inventory にある品を装備する。同じスロットの旧品は inventory の同じ位置に入る。
   * TW-16c（M21）: from "warehouse" は倉庫（GameState.warehouse）の品を装備する（旧品は to が無ければ inventory の末尾（使用枠に空きが無ければ倉庫）、
   * to "warehouse" なら倉庫へ）。from / to のどちらかがあれば街（dive null）だけ
   */
  | { type: "party.equip"; memberId: string; instanceId: string; from?: "warehouse"; to?: "warehouse" }
  /** CH-76: 装備を外して inventory の末尾に入れる。TW-16c（M21）: to "warehouse" なら倉庫の末尾へ（街だけ） */
  | { type: "party.unequip"; memberId: string; slot: EquipSlot; to?: "warehouse" }
  /** CH-77: memberId は鑑定する者（abilities に identify を持つ職業）。instanceId はパーティの誰かの inventory にある未鑑定品 */
  | { type: "party.identify"; memberId: string; instanceId: string }
  /** CH-78（M10）: memberId の inventory の品を toId（自分以外のパーティの者）の inventory の末尾へ渡す。両者の life と行動の可否は問わない */
  | { type: "party.give"; memberId: string; instanceId: string; toId: string }
  /** CH-79（M10）: memberId の inventory の品を捨てる（実体ごと消える。潜行中なら台帳からも）。本人の life と行動の可否は問わない */
  | { type: "party.drop"; memberId: string; instanceId: string }
  /** UI-57（開発用）: alive の全員の hp を 1 にする。保留中も受け付ける。乱数は使わない */
  | { type: "debug.hpOne" }
  /** UI-57（開発用、M5）: リーダー以外の alive の SAN を 1 段下げる（境の 1 つ下、錯乱の次は 0）。保留中も受け付ける。乱数は使わない */
  | { type: "debug.sanDown" }
  /** UI-57（開発用、M5）: その階のイベント・罠・下り階段のセルの手前へ移り、そちらを向く。行き先が無ければ message だけ。乱数は使わない */
  | { type: "debug.warp"; to: "event" | "trap" | "stairsDown" | "chest" }
  /** UI-57（開発用、M5.5）: adventureTurns に config.town.tavernEventTurns を足す。party が空（title）だけ rejected no party。保留中・戦闘中・街も受け付ける。乱数は使わない */
  | { type: "debug.addTurns" }
  /** UI-57（開発用、M7）: alive の全員の SAN を sanCapOf + 10 にする（士気が無くても）。party が空（title）だけ rejected no party。保留中・戦闘中・街も受け付ける。乱数は使わない */
  | { type: "debug.sanOver" }
  /**
   * UI-57（開発用、M10）: 呪われた未鑑定の装備品を 1 つ、並び順で最初に使用枠の空いた者の inventory の末尾に入れる。
   * wearable が真なら鑑定できる職業（司教）が装備できる最初のベース、偽なら装備できない最初のベース。party が空（title）だけ
   * rejected no party。保留中・戦闘中・街も受け付ける。乱数は使わない
   */
  | { type: "debug.giveCursed"; wearable: boolean }
  /**
   * UI-57（開発用、M11）: 今の位置にドロップの宝箱を出す（罠を指定する。null は罠なし。U-1 の確認用）。迷宮の戦闘外・保留なし・箱なしのときだけ。
   * 危険度は罠の値、中身の Lv はその階の遭遇表の敵の level の最大。present が偽・省略なら乱数は使わない（衝動判定もしない）。
   * present が真なら、置いた箱で勝利の後と同じ衝動・制止（EV-16 / EV-25）と職業の掛け合い（EV-71）を行う（state.rng を使う。M11 の実機の確認用）
   */
  | { type: "debug.chest"; trapId: string | null; present?: boolean }
  /**
   * UI-57（開発用、M12。U-6）: life alive の全員の exp を expFor(level) にして level を合わせる（HP / MP の最大値・levelHistory・習得は宿と同じ。
   * 能力値の成長 CH-61 はしない）。level は 1〜DEBUG_LEVEL_MAX の整数（それ以外は rejected bad level）。party が空（title）は rejected no party、
   * 戦闘中は rejected in battle、保留中・箱がある間は E3 / CB-60 の門で rejected。上げる段の HP のダイスと習得判定に state.rng を使う
   */
  | { type: "debug.levels"; level: number }
  /** CB-63（M11）: memberId（行動可能な者。リーダーも可）が箱を調べる。何度でもできる */
  | { type: "chest.inspect"; memberId: string }
  /** CB-64（M11）: memberId（行動可能な者）が、罠の名前（chest-traps.json の id）を宣言して解除する */
  | { type: "chest.disarm"; memberId: string; trapId: string }
  /** CB-65（M11）: 箱を開ける。罠があれば必ず作動する */
  | { type: "chest.open" }
  /** CB-66（M11）: 箱を放っておく */
  | { type: "chest.leave" };

export type CommandType = Command["type"];

// ===================== イベント =====================

// ===================== 表示層向けの問い合わせの結果（rules/combat.ts の battleMenu が返す。state には入れない） =====================

/**
 * §7: encounter / enemyGroups と BattleMenu.groups で同じ形。全グループを添字順に返す（体数 0 も残す）。
 * name は core が選んだ表示名（bestiary[monsterId].identified なら monsters[].name、でなければ系統の unknown-kinds.json の name。CB-05）。
 */
export type EnemyGroupView = {
  index: number;
  monsterId: string;
  name: string;
  identified: boolean;
  /** 生存個体の数 */
  count: number;
};

/**
 * UI-68（M10）: 呪文の説明。rules/item-view.ts の spellInfo。mp は唱える者の消費（spellCost。MG-30 / IT-40）、
 * target / usableIn / description は spells.json の値をそのまま写す（表示層は spell.target.{target} / spell.usableIn.{usableIn} で出す）
 */
export type SpellInfo = { spellId: string; name: string; mp: number; target: SpellTarget; usableIn: UsableIn; description: string };

/** 戦闘で使える既知の呪文。usable = mp >= spells[].mp */
export type BattleMenuSpell = { spellId: string; name: string; mp: number; target: SpellTarget; usable: boolean };
/** 本人の inventory のうち戦闘で使える消耗品。name は鑑定を反映した表示名 */
export type BattleMenuItem = { instanceId: string; itemId: string; name: string; target: SpellTarget };
export type BattleMenuMember = {
  id: string;
  name: string;
  /** CH-44 の否定 */
  canAct: boolean;
  /** このラウンドの入力（未入力なら null） */
  input: BattleAction | null;
  /** CB-13/14 の今の判定。偽なら「攻撃」は防御として解決される（入力は受け付ける。表示の注記用） */
  canStrike: boolean;
  /** UI-54（M18。設計 4-6）: 並び順の添字が config.party.frontRow 未満なら front（入力の問いの表記だけに使う。CB-14 の繰り上げは反映しない） */
  row: "front" | "back";
  spells: BattleMenuSpell[];
  items: BattleMenuItem[];
  /**
   * UI-54 / CB-12（M20。設計 D-2）: spells が空の理由。knownSpells が空なら none、知っていても戦闘で使える呪文
   * （battleSpellUsable）が無ければ unusable、spells が空でなければ null（表示層は dim の行の理由の文を選ぶだけ）
   */
  spellBlock: "none" | "unusable" | null;
  /**
   * UI-54 / CB-12（M20。設計 D-2）: items が空の理由。inventory に道具（items.json の品 = 消耗品・魔法書。装備は数えない）が
   * 1 つも無ければ none、道具はあるが戦闘で使えるもの（battleItemUsable）が無ければ fieldOnly、items が空でなければ null
   */
  itemBlock: "none" | "fieldOnly" | null;
};
export type BattleMenu = {
  round: number;
  auto: boolean;
  /** CB-02: origin が random か alarm のときだけ真 */
  canFlee: boolean;
  /** CB-50b（M22）: 逃走の成功率（%。0〜100。canFlee が偽でも値は入る）。battle.flee の dice の rate と同じ値 */
  fleePercent: number;
  /** CB-12/40（M16）: 行動可能な者に lastBattleInput が 1 人でもあれば真。偽なら battle.repeat は rejected（no last input） */
  canRepeat: boolean;
  /** battle.resolve を受け付けるか（checkResolve(state, data) === null と同値） */
  ready: boolean;
  /** 行動可能で未入力のメンバーの id（並び順）。オート中は [] */
  pending: string[];
  groups: EnemyGroupView[];
  /** パーティ全員（並び順） */
  members: BattleMenuMember[];
  /** 味方の対象の候補 = life が alive のメンバー（並び順） */
  allies: { id: string; name: string; hp: number; hpMax: number }[];
};

// ===================== 全滅の内訳（TW-20〜26。wipe イベントの penalty） =====================

/** TW-22 で失った所持品 1 個 */
export type PenaltyLostItem = {
  memberId: string;
  instanceId: string;
  itemId: string;
  /** 失った時点の表示名（CH-72 の鑑定を反映） */
  name: string;
  equipped: boolean;
};
/** TW-22 / CH-62。パーティ全員を並び順で（life を問わず、lost 0 も入れる） */
export type PenaltyExpLoss = {
  id: string;
  name: string;
  expBefore: number;
  lost: number;
  levelFrom: number;
  levelTo: number;
};
export type PenaltyResult = {
  /** 2d10 の各目 */
  dice: number[];
  total: number;
  /** data.penaltyTable.bands の添字 */
  bandIndex: number;
  /** DG-42/TW-21: 所持金から実際に引いた台帳の金 = min(gold, ledger.gold) */
  ledgerGold: number;
  /** DG-42: 台帳から失った品の表示名（台帳の順） */
  ledgerItems: string[];
  /** TW-22: 台帳分を引いた後の所持金 g から floor(g × goldLossRatio + 1e-9) */
  goldLost: number;
  itemsLost: PenaltyLostItem[];
  expLost: PenaltyExpLoss[];
  /** TW-23/24 で復活処理をした者の id（処理順: 全滅時点で alive の者を並び順 → リーダー） */
  revived: string[];
  /** TW-24: リーダーが全滅時点で alive でなかった（wipe.leaderRule を出した） */
  leaderRule: boolean;
};

// ===================== 表示層向けの問い合わせの結果（rules/town.ts townMenu、rules/items.ts fieldItemMenu。state には入れない） =====================

/** morale はそのランクに泊まると士気が立つか（TW-15。宿の一覧の印） */
export type TownMenuInnRank = { rank: number; id: string; name: string; cost: number; affordable: boolean; morale: boolean };
/**
 * TW-04（M18 5-3）: 宿屋の見出しの 2 行目の一行の合計。life alive の者（宿で回復・レベルアップする者）の HP / MP の今の値と
 * 実効の最大値（CH-14 の equipStats）の合計と、そのうち canLevelUp（CH-61。宿で上がる）の人数。生きている者がいなければ全部 0。
 * M20 D-6: nearest は life alive で宿で上がらない者（canLevelUp が偽）のうち
 * 次のレベルまでの残り exp（expFor(level + 1) − exp）が最も少ない者（同じなら並び順で先）。そういう者がいなければ null
 */
export type TownMenuInnParty = {
  hp: number;
  hpMax: number;
  mp: number;
  mpMax: number;
  levelUpReady: number;
  nearest: { name: string; expToNext: number } | null;
};
export type TownMenuTempleRow = { memberId: string; name: string; cost: number; affordable: boolean };
/**
 * TW-07（M24）: 解呪の品の行。name は表示名（itemDisplayName。未鑑定なら見た目の名前）、fee は uncurseFee、affordable = gold >= fee、
 * cursed は呪いが見えている（鑑定済み）か。未鑑定の装備中の品は偽（中身を漏らさない。IT-12）
 */
export type TownMenuUncurseItem = { instanceId: string; name: string; fee: number; affordable: boolean; cursed: boolean };
/** TW-07（M24）: 解呪の人の行。count は対象の品の数（items の長さ。0 なら表示層が dim）、items は uncurseTargets の順 */
export type TownMenuUncurseRow = { memberId: string; name: string; count: number; items: TownMenuUncurseItem[] };
export type TownMenuShopItem = { itemId: string; name: string; price: number; affordable: boolean };
/**
 * TW-05（M16）: 汎用装備の性能の下見（rules/shop.ts shopItemPreview。鑑定済み・通常・オプションなしの Lv の実体を合成して itemPower を呼んだ値）。
 * M18（3-3）: 店の下見と強化の確認の前後（UpgradePreview の before / after）が共用する（ShopItemPreview から改名）。
 * attack は武器のダメージのダイス（Lv の分を定数に合算した正規形。品の詳細の damageDice と同じ）で武器でなければ null、
 * ac は防具類（盾・兜・小手・装飾を含む）の AC で武器なら null、magicPower は術者用の武器の魔法攻撃力でそれ以外は null。
 * anyone はベースの classes が空（誰でも装備できる）、classes は装備できる職業の abbr（classes.json の順。anyone なら全職業）
 */
export type ItemPreview = { attack: string | null; ac: number | null; magicPower: number | null; anyone: boolean; classes: string[] };
/**
 * IT-62: 流通レベルの汎用装備の売り物。name は表示名（「長剣 +2」）、level は progress.shopLevel、price は IT-60 の買値。
 * TW-05（M16）: preview は性能の下見、canEquip は持たせる候補（shop.members）のうち職業でこの品を装備できる者の id（並び順）
 */
export type TownMenuShopEquipment = {
  itemId: string;
  name: string;
  level: number;
  price: number;
  affordable: boolean;
  preview: ItemPreview;
  canEquip: string[];
};
export type TownMenuShopMember = { memberId: string; name: string; slotsFree: number };
/** IT-61: 売れる品 1 個（本人の inventory の品。未鑑定も売れる）。price は店での売値 shopSellPrice（未鑑定は見た目の品種の売値、name は未鑑定の名前） */
/** cursed（M24 B-1）: 鑑定済みかつ実体の cursed（campMenu の inventory[].cursed と同じ基準。表示層が名前を danger で描く） */
export type TownMenuShopSellRow = { instanceId: string; name: string; price: number; cursed: boolean };
/** IT-63: 買い戻しのストックの品 1 個。price は uniques[].price、affordable = gold >= price */
export type TownMenuShopBuybackRow = { instanceId: string; name: string; price: number; affordable: boolean; cursed: boolean };
/** IT-65: 店で鑑定できる品 1 個（本人の inventory の未鑑定の品）。name は未鑑定の表示名、fee は品ごとの鑑定料 identifyFeeOf、affordable = gold >= fee */
export type TownMenuShopIdentifyRow = { memberId: string; memberName: string; instanceId: string; name: string; fee: number; affordable: boolean };
/** TW-16: 倉庫・所持品の 1 個。cursed（M24 B-1）は鑑定済みかつ実体の cursed */
export type TownMenuStorageRow = { instanceId: string; name: string; cursed: boolean };
/**
 * TW-17: 強化の部位 1 つ（EQUIP_SLOTS の順）。block は null なら対象にできる、"slot empty"（空き）/ "unique"（ユニーク）。
 * name は表示名（空きなら null）、level は実体の level（空きなら 0）
 */
export type TownMenuUpgradeSlot = {
  slot: EquipSlot;
  instanceId: string | null;
  name: string | null;
  /** M16（4-5）: 表示名から Lv を除いたもの（equipmentPlainName。空きなら null）。強化の画面は「{plainName} +{level}」で出す */
  plainName: string | null;
  level: number;
  block: string | null;
  /** M24 B-1: 鑑定済みかつ実体の cursed（空きなら false） */
  cursed: boolean;
};
/**
 * TW-17: 触媒の候補 1 個（パーティ全員の inventory の鑑定済みの汎用装備。メンバーの並び順 → inventory の順。M16 で本人だけから全員に広げた。
 * M17 でその後ろに倉庫の品を倉庫の順で足した）。name は表示名、plainName は Lv を除いた名前（equipmentPlainName）、ownerId / ownerName は持ち主。
 * 倉庫の品は ownerId null・ownerName 空文字（表示層が strings の town.shop.menu.storage を引く。core に日本語を持たない）
 * power（M20 B-2）: 品の性能の下見の値（itemPowerPreview。オプションを除く。該当しない項目は null）。触媒の付け外しのたびに表示層が語る 1 文に使う
 */
export type TownMenuUpgradeCatalyst = {
  instanceId: string;
  name: string;
  plainName: string;
  level: number;
  ownerId: string | null;
  ownerName: string;
  power: Pick<ItemPreview, "attack" | "ac" | "magicPower">;
  /** M24 B-1: 鑑定済みかつ実体の cursed */
  cursed: boolean;
};
/** TW-17（M16）: town.upgrade の触媒 1 個の指定（持ち主と実体）。消費は持ち主の inventory から。M17: memberId null は倉庫の品（消費は warehouse から） */
export type UpgradeCatalystRef = { memberId: string | null; instanceId: string };
/** TW-17: 1 人分。canUpgrade は block が null の部位が 1 つ以上あるか */
export type TownMenuUpgradeMember = {
  memberId: string;
  name: string;
  canUpgrade: boolean;
  slots: TownMenuUpgradeSlot[];
  catalysts: TownMenuUpgradeCatalyst[];
};
/**
 * TW-17: rules/upgrade.ts upgradePreview の値。rate は成功率 p（整数。判定はこの値と出目を比べる）、great は大成功の率 q、fee は料金、
 * affordable = gold >= fee、block は checkUpgrade の理由（受け付けるなら null）。
 * M18（3-3）: before / after は対象の今の Lv と Lv+1（成功のとき。大成功の +2 は出さない）の性能の下見（shopItemPreview と同じ値）。
 * kind は確認の段で語る前後の項目（UpgradePreviewKind）。Lv で数値が変わらない装飾（IT-23）は null（語らない）。
 * M18（5-13）: nextChangeAt は kind の値が before と after で同じとき（防具の Lv0 → 1 の AC など）、次に値が変わる Lv までの段数 levels
 * （今の Lv からの差。2 以上）とそのときの値 value（文字列）。値が変わるとき・kind が null のときは null。
 * M21（B-1）: level / resultLevel は対象の今の Lv と成功のときの結果の Lv（max(Lv + 1, 触媒の Lv の最小値)。大成功の +1 は含めない）。
 * after は resultLevel の下見、fee は resultLevel × upgradeFeePerLevel。nextChangeAt.level はその Lv（level + levels）
 */
export type UpgradePreview = {
  rate: number;
  great: number;
  fee: number;
  affordable: boolean;
  block: string | null;
  kind: UpgradePreviewKind | null;
  level: number;
  resultLevel: number;
  before: ItemPreview;
  after: ItemPreview;
  nextChangeAt: { levels: number; level: number; value: string } | null;
};
/** M18（3-3）: 強化の前後で比べる項目。attack は武器（術者用でない）の攻撃、ac は防具・盾・兜・小手の AC、magic は術者用武器の魔法攻撃力 */
export type UpgradePreviewKind = "attack" | "ac" | "magic";
/**
 * TW-10（M17）: 銀行の額の行。kind は all（全額）/ half（半分。floor）/ fixed（config.bank.amounts の額）、amount は表示の額（正）、
 * delta は town.bank に送る額（預入は +amount、引出は −amount）、ok = checkBank(state, delta) === null（額 0・元より多い額は false）
 */
export type TownMenuBankRow = { kind: "all" | "half" | "fixed"; amount: number; delta: number; ok: boolean };
/** rules/town.ts townMenu。screen === "town" のときだけ非 null */
export type TownMenu = {
  gold: number;
  inn: TownMenuInnRank[];
  /** TW-04（M18 5-3）: 宿屋の見出しの 2 行目の値（一行の HP / MP の合計と、宿で上がる人数） */
  innParty: TownMenuInnParty;
  /** TW-15（M7）: 今の士気（立てたランクの id と名前）。無ければ null。rankId がデータに無ければ null */
  morale: { rankId: string; name: string } | null;
  temple: {
    /** life dead の者（並び順）。cost = level × templeCostPerLevel */
    resurrect: TownMenuTempleRow[];
    /** life alive で毒・麻痺・石化のどれかを持つ者。cost = 該当状態の cureCost の合計 */
    cure: TownMenuTempleRow[];
    /**
     * TW-07（M24）: 解呪。誰かに対象の品（uncurseTargets）があればパーティ全員（並び順。life を問わない。対象の無い者は count 0）、
     * 誰にも無ければ []（M23 までは呪われた品を装備している者だけで、cost = uncurseCost の 1 回分）
     */
    uncurse: TownMenuUncurseRow[];
    /**
     * TW-07（M18 5-4）: 最初の段（蘇生・治療・解呪）の料金の目安。perLevel = templeCostPerLevel、
     * cureFrom = cureCost の最小値（治療 1 つ分）、uncurse = { ratio: uncurseFeeRatio, min: uncurseFeeMin }（M24。M23 までは uncurseCost）。
     * 対象の有無に関わらず config の値
     */
    pricing: { perLevel: number; cureFrom: number; uncurse: { ratio: number; min: number } };
  };
  /** TW-08 闇魔術: life ash の者（並び順）。cost = level × darkCostPerLevel、affordable = gold >= cost */
  dark: TownMenuTempleRow[];
  /** TW-05 店（rules/shop.ts shopMenu。M7 で売却・買い戻し・鑑定・流通レベルの装備を足した） */
  shop: {
    /** 売り物の消耗品（items.json の順で consumable かつ infinite の品）。affordable = gold >= price */
    items: TownMenuShopItem[];
    /** IT-62: 流通レベルの汎用装備（equipment-bases.json の順で shopMinLevel ≤ shopLevel のベース） */
    equipment: TownMenuShopEquipment[];
    /** 持たせる候補（buy / buyback）= life alive の者（並び順）。slotsFree = slotsMaxOf（CH-71。M17 から素の力の補正を含む）− 装備数 − inventory（CH-71。0 なら inventory full） */
    members: TownMenuShopMember[];
    /**
     * IT-61: 全員（並び順。life を問わない）の、inventory の品（inventory の順。2026-10-05 から未鑑定も含む）。
     * total は items の price の合計（TW-05 / UI-52。M18 5-2。「誰の品を売る」の行の計）
     */
    sellable: { memberId: string; name: string; items: TownMenuShopSellRow[]; total: number }[];
    /** IT-63: 買い戻しのストック（売った順） */
    buyback: TownMenuShopBuybackRow[];
    /** IT-65: 全員（並び順。life を問わない）の inventory の未鑑定の品（鑑定料は品ごと） */
    identify: { items: TownMenuShopIdentifyRow[] };
  };
  /** TW-10（M17）銀行の金（rules/bank.ts bankMenu）。bank は預金、gold は所持金 */
  bank: {
    bank: number;
    gold: number;
    /** 預け入れの額の行（全額 → 半分 → config.bank.amounts の順）。元は所持金 */
    deposit: TownMenuBankRow[];
    /** 引き出しの額の行（同じ順）。元は預金 */
    withdraw: TownMenuBankRow[];
  };
  /** TW-16 / IT-64 倉庫（rules/storage.ts storageMenu） */
  storage: {
    /** progress.warehouseSlots（初期は config.items.warehouseSlots。拡張は TW-10） */
    capacity: number;
    /** TW-10（M24 D-1）倉庫を広げる。上限（capacity ≥ config.bank.maxSlots）なら null。next = 広げた後の枠数、ok = 受け付けるか、reason = ok でない理由（checkStorage の文） */
    expand: { cost: number; slots: number; next: number; ok: boolean; reason: string | null } | null;
    /** capacity − warehouse の数（0 なら warehouse full） */
    slotsFree: number;
    /** TW-16b（M17）全員の「すべて預ける」（depositAll memberId null）を受け付けるか（checkStorage と同じ判定。品が無い・倉庫が満杯なら false） */
    depositAllOk: boolean;
    /** warehouse の品（預けた順）。name は itemDisplayName（未鑑定なら未鑑定の名前） */
    items: TownMenuStorageRow[];
    /** 全員（並び順。life を問わない）の inventory の品と、所持枠の空き（0 なら引き出しは inventory full）。depositAllOk はその者の「すべて預ける」を受け付けるか */
    members: { memberId: string; name: string; slotsFree: number; depositAllOk: boolean; items: TownMenuStorageRow[] }[];
  };
  /** TW-17（M7）闇魔術の強化（rules/upgrade.ts upgradeMenu） */
  upgrade: {
    /** config.economy.upgradeMaxCatalysts */
    maxCatalysts: number;
    /** 全員（並び順。life を問わない） */
    members: TownMenuUpgradeMember[];
  };
  /** TW-31: townVisit.mercyOffered なら dead / ash の全員（並び順）。申し出が無ければ null */
  mercy: { memberId: string; name: string; life: "dead" | "ash" }[] | null;
  /**
   * TW-11: progress.unlockedDungeons の順。canEnter = checkEnter(state, id, data) === null。
   * M19（D-1）: floors（階数）と description（入口の行を押したときに語る文）は dungeons.json の値。
   * M21（DG-47）: reached は progress.deepestFloors のその id の値（記録が無ければ null）
   */
  dungeons: { id: string; name: string; floors: number; description: string; canEnter: boolean; notReady: boolean; reached: number | null }[];
  /** TW-03（M5.5）: 酒場の一覧に「鑑定」を出すか。abilities に identify を持ち canAct の者が 1 人以上（campMenu の identifiers.length > 0 と同値） */
  canIdentify: boolean;
  /** TW-35（M12。U-2）: 酒場の一覧に「戦績」を出すか。progress.conquered と同値 */
  canShowRecord: boolean;
};

/** rules/items.ts fieldItemMenu の道具 1 個 */
export type FieldItemView = {
  instanceId: string;
  itemId: string;
  name: string;
  /** "ally" なら対象を選ぶ（targetId 必須）。"none" は対象を選ばない（self / party / return / learn） */
  target: "ally" | "none";
  /** checkUseItem(state, data, cmd) === null と同値。ally の品は「alive の味方が 1 人以上」で見る（対象の満タン full hp は見ない。targets の block） */
  usable: boolean;
  /** target が ally のとき、allies と同じ順の対象ごとの可否（block が null なら送れる。MG-44 / UI-53、2026-10-05）。ally 以外は [] */
  targets: CampTargetView[];
  /** DG-30 / UI-53（M5.5）: consumable で effect.type が return（帰還の糸）。表示層が使う前の確認の段を挟む */
  isReturn: boolean;
};
/** rules/items.ts fieldItemMenu。街（screen town・dive null）と、迷宮（screen dungeon・dive 非 null）で battle null・pendingChoice null のときだけ非 null（M5.5 から街でも） */
export type FieldItemMenu = {
  /** パーティ全員（並び順）。items は inventory の順で consumable / book だけ */
  members: { id: string; name: string; canAct: boolean; items: FieldItemView[] }[];
  /** 対象の候補 = life alive（並び順） */
  allies: { id: string; name: string; hp: number; hpMax: number }[];
};

// ===================== キャンプと酒場の問い合わせ（UI-53 / TW-03。rules/camp.ts の campMenu。state には入れない） =====================

export type CampPlace = "town" | "dungeon";
/** MG-32: 戦闘外で使える既知の呪文。target が dead なら蘇生で、対象は life dead の者 */
export type CampSpellView = {
  spellId: string;
  name: string;
  mp: number;
  target: "ally" | "dead" | "none";
  /**
   * 対象を 1 人仮に当てたうえで checkCast === null かどうか（ally なら allies の先頭、dead なら dead の先頭、none なら対象なし）。
   * ただし対象の満タン（full hp）は見ない（対象ごとの可否は targets の block）
   */
  usable: boolean;
  /** target が ally のとき、allies と同じ順の対象ごとの可否（block が null なら送れる）。ally 以外は [] */
  targets: CampTargetView[];
};
/** MG-44 / UI-53（2026-10-05）: 戦闘外の回復の対象を選べない理由。表示層は strings の camp.targetBlock.{block} で出す */
export type CampTargetBlock = "fullHp";
export type CampTargetView = { id: string; block: CampTargetBlock | null };
/**
 * 装備できない理由。表示層は strings の camp.equipBlock.{block} で出す。full は TW-16c（M21）の倉庫の品で、旧品が無く使用枠（CH-71）に空きが無いとき。
 * warehouseFull は TW-16c（M21）の to "warehouse"（銀行の状態）で、外す品・入れ替えで外れる品があり倉庫が満杯のとき
 */
export type EquipBlock = "cannotAct" | "unidentified" | "class" | "cursedSlot" | "full" | "warehouseFull";
export type CampEquipCandidate = {
  instanceId: string;
  /** itemDisplayName。未鑑定なら unidentifiedName（CH-72） */
  name: string;
  slot: EquipSlot;
  /** null なら party.equip を受け付ける（checkEquip === null と同じ） */
  block: EquipBlock | null;
  /** M24 B-1: 鑑定済みかつ実体の cursed（CampSlotView.cursed と同じ基準。表示層が名前を danger で描く） */
  cursed: boolean;
  /**
   * TW-16c（M21）: 街（place town）だけ。旧品を倉庫へ入れる装備（party.equip の to "warehouse"。倉庫の品は from も "warehouse"）の理由の写し。
   * 銀行の状態の表示層はこちらを使う。街でなければ省略
   */
  toWarehouseBlock?: EquipBlock | null;
};
export type CampSlotView = {
  slot: EquipSlot;
  instanceId: string | null;
  name: string | null;
  /** 鑑定済みかつ実体の cursed（IT-32）のとき true（表示用。未鑑定なら false。CH-73 の「見えない」） */
  cursed: boolean;
  /** checkUnequip === null と同じ。呪われているかは鑑定と関係なく実体の cursed で決める */
  canUnequip: boolean;
  /** TW-16c（M21）: 外して倉庫へ入れられるか（checkUnequip の to "warehouse" === null。街でなければ・倉庫が満杯なら false） */
  canUnequipToWarehouse: boolean;
};
export type CampMember = {
  id: string;
  name: string;
  life: Life;
  canAct: boolean;
  /** 並び順の添字が config.party.frontRow 未満なら front（表記だけに使う） */
  row: "front" | "back";
  /** knownSpells の順で、戦闘外で使える呪文（fieldSpellOk）だけ。M5.5 から town でも作る（街の帰還は usable false） */
  spells: CampSpellView[];
  /** EQUIP_SLOTS の順に 6 件 */
  slots: CampSlotView[];
  /** 本人の inventory の順で、type が EQUIP_SLOTS のどれかに当たる品 */
  equipCandidates: CampEquipCandidate[];
  /**
   * TW-16c（M21）: 倉庫（GameState.warehouse の順）の品のうち、鑑定済みでこの者の職業が装備できる装備品（party.equip の from "warehouse" の候補）。
   * block は checkEquip（from "warehouse"、to "warehouse"）の理由の写し（cannotAct / cursedSlot / full）。街（place town）でなければ null
   */
  warehouseCandidates: CampEquipCandidate[] | null;
  /** CH-78（M10）: 使用枠（CH-71）に空きがあり、party.give の受け取る側になれる（target full の逆）。life は問わない。自分かどうかは見ない */
  canReceive: boolean;
  /** UI-59（M10）: 本人の inventory の順の所持品（装備中は含めない。渡す・捨てるの候補） */
  inventory: CampInventoryItem[];
  /** CH-71（M10）: 使用枠の数（装備 + 所持品。slotsUsed）と上限（slotsMaxOf = config.inventory.slotsPerCharacter + 素の力の補正。M17）。表示の数字だけ */
  slotsUsed: number;
  slotsMax: number;
  /** CH-71（M16。設計 4-7）: 装備中の品の数（6 枠のうち空きでない枠。slotsUsed に含まれる分）。所持品の見出しの「装備 n を含む」 */
  equipped: number;
  /**
   * UI-59 / UI-68（M10）: knownSpells の順で、data にある全習得呪文（戦闘専用も含む）。castable は spells（戦闘外で使える呪文）に
   * あって usable が真のとき（戦闘外で唱えられ MP が足りる）。説明は spellInfo
   */
  knownSpells: CampKnownSpell[];
  /** CH-77（M10）: 今この者が party.identify を送れるか（identifyBlock === null） */
  canIdentifyNow: boolean;
  /** CH-77（M10）: 送れない理由。checkIdentify の順（cannotIdentify → cannotAct → noMp → noUnidentified）。送れるなら null */
  identifyBlock: IdentifyBlock | null;
  /** CH-77（M10）: この者が鑑定するときの、CampMenu.unidentified と同じ順の成功率（identifyChance の rate）。鑑定できる職業でなければ [] */
  identifyRates: { instanceId: string; rate: number }[];
};
/** UI-59（M10）: 所持品の品種。装備品（equipment-bases）・消耗品・魔法書 */
export type CampInventoryKind = "equipment" | "consumable" | "book";
export type CampInventoryItem = {
  instanceId: string;
  /** itemDisplayName。未鑑定なら unidentifiedName（CH-72） */
  name: string;
  identified: boolean;
  kind: CampInventoryKind;
  /** 鑑定済みかつ実体の cursed（CampSlotView.cursed と同じ。未鑑定なら false） */
  cursed: boolean;
};
export type CampKnownSpell = { spellId: string; name: string; mp: number; castable: boolean };
/** CH-77（M10）: 鑑定を送れない理由。表示層は strings の camp.identifyBlock.{block} で出す */
export type IdentifyBlock = "cannotIdentify" | "cannotAct" | "noMp" | "noUnidentified";
export type CampIdentifyItem = {
  instanceId: string;
  ownerId: string;
  ownerName: string;
  /** unidentifiedName */
  name: string;
};
/**
 * rules/camp.ts の campMenu(state, data)。非 null になるのは次のときだけ:
 *   town: screen town・dive null・battle null・pendingChoice null
 *   dungeon: screen dungeon・dive 非 null・battle null・pendingChoice null
 * 道具は fieldItemMenu を使う（M5.5 から town でも非 null）。
 */
export type CampMenu = {
  place: CampPlace;
  /** パーティ全員（並び順） */
  members: CampMember[];
  /** heal / cure の対象の候補 = life alive の者（並び順） */
  allies: { id: string; name: string; hp: number; hpMax: number }[];
  /** 蘇生の対象の候補 = life dead の者（並び順。ash は入れない） */
  dead: { id: string; name: string }[];
  /** 鑑定できる者 = abilities に identify を持ち、canAct の者（並び順）。空なら「鑑定」の項目を出さない */
  identifiers: { id: string; name: string }[];
  /** パーティ全員の inventory にある未鑑定品（並び順 × inventory の順） */
  unidentified: CampIdentifyItem[];
};

/** UI-80（M20）: キャラクター画面で品を押したときの操作（rules/item-actions.ts の itemActions） */
export type ItemActionKind = "equip" | "unequip" | "use" | "give" | "drop" | "identify";
/**
 * UI-80（M20）: 品の操作を送れない理由。表示層は strings の camp.itemReason.{block} で出す。
 * equip は EquipBlock（checkEquip）、unequip は cursed（checkUnequip）、use は cannotAct / notHere / cannotLearn / known / noTarget（checkUseItem）、
 * give は noReceiver（自分以外に受け取れる者がいない）、identify は cannotAct / noMp（鑑定する者の checkIdentify）
 */
export type ItemActionBlock = EquipBlock | "cursed" | "notHere" | "cannotLearn" | "known" | "noTarget" | "noReceiver" | "noMp";
export type ItemActionView = { action: ItemActionKind; block: ItemActionBlock | null };
/**
 * UI-80（M20）: 1 つの品に当てはまる操作。state は変えず、乱数も引かない。
 * actions の順は 装備する／外す → 使う → 渡す → 捨てる → 鑑定（当てはまらない操作は入れない）
 */
export type ItemActions = {
  memberId: string;
  instanceId: string;
  /** itemDisplayName（未鑑定なら見た目の名前） */
  name: string;
  /** 装備中ならその枠。所持品なら null */
  equippedSlot: EquipSlot | null;
  /** 装備品なら部位（ベースの slot）。消耗品・魔法書なら null */
  slot: EquipSlot | null;
  actions: ItemActionView[];
  /** identify があるとき、鑑定する者と成功率（identifyChance の rate）。無ければ null */
  identifier: { id: string; name: string; rate: number } | null;
  /** TW-16c（M21）: 倉庫の品（街だけ。操作は装備するだけで、送るのは party.equip の from "warehouse"）のとき "warehouse"。手元の品は省略 */
  from?: "warehouse";
  /**
   * TW-16c（M21）: itemActions に to "warehouse" を渡し、街（campPlace town）だったとき "warehouse"。手元の品の 装備する・外す の理由は
   * to "warehouse" の checkEquip / checkUnequip（倉庫が満杯なら warehouseFull）で、送るのも to "warehouse"。それ以外は省略
   */
  to?: "warehouse";
};

/**
 * UI-53: キャンプの top のパネルの要約。rules/camp.ts の campSummary(state, data)。迷宮のキャンプ（campPlace dungeon）のときだけ非 null。
 * gold は state.gold（台帳の金を含む）。ledgerItems / ledgerGold は潜行台帳（DG-40）。
 * returnItems は life を問わずパーティ全員の inventory にある、効果 return の消耗品の個数（装備は数えない）。
 */
export type CampSummary = {
  dungeonName: string;
  floor: number;
  gold: number;
  ledgerItems: number;
  ledgerGold: number;
  returnItems: number;
  /**
   * DG-30 / UI-53（M16。設計 4-8）: いま使える帰還の品の最初の 1 つ（並び順 × inventory の順で、効果 return の消耗品のうち
   * checkUseItem が受け付けるもの = 持ち主が行動可能（CH-44）で usableIn が battle でない）。無ければ null。
   * memberId は持ち主（dungeon.useItem の memberId）、name は itemDisplayName（未鑑定なら見た目の名前）
   */
  returnItem: CampReturnItem | null;
  /** TW-15（M7）: 宿の士気がある（moraleOf が null でない） */
  morale: boolean;
};
/** DG-30 / UI-53（M16）: campSummary の returnItem */
export type CampReturnItem = { memberId: string; ownerName: string; instanceId: string; name: string };

/** strings.json のキーと埋め込み値。表示層は formatMessage(strings[key], params) で出す */
export type TextRef = { key: string; params?: Record<string, string | number> };

/**
 * UI-40: 判定の 1 行。表示は「{label} {base}+{dice…}={total}」。base が null なら「{label} {dice…}={total}」。
 * total は base（null なら 0）+ 出目の和。将来の出目補正スキル（M5 以降）は base に足すか行を足して表し、形は変えない。
 */
export type DiceRow = { label: TextRef; base: number | null; dice: number[]; total: number };

/**
 * CB-55: 戦闘の再生の区切り。出すのは rules/combat.ts だけ。
 * declare = 行動の宣言、result = 命中とダメージ（または効果）、aftermath = それで起きたこと（死亡・覚醒・状態異常・SAN・撃破による鑑定）、
 * system = 行動の外（遭遇、先手判定、逃走判定、ラウンドの終わり、戦闘の終わり、戦闘の中で起きた全滅の処理）
 */
export type BeatPhase = "declare" | "result" | "aftermath" | "system";

export type GameEvent =
  /**
   * clearOn（UI-45。M18）: "moved" なら、表示層はこの文を出した後の次の moved（位置が変わったもの）でメッセージ窓を空にする
   * （階段・出口の問い。やめるで答えて歩き去った後に問いが窓に残らないように）。旋回では空にしない。
   * M19: "step" なら、この文を出した再生より後の再生の、次の moved（位置が変わったもの）か turned のどちらでも窓を空にする
   * （壁 dungeon.blocked と扉 dungeon.door。古い「壁だ。」が向き直った後に残らないように）。省略は従来どおり
   * instant（UI-43。M20 D-3）: 真なら表示層は文字送りの速さによらずこの文を即時に出す（数値の行。鑑定の結果の性能・希少度と売値）。
   * 省略は従来どおり（演出スキップのときだけ即時）。タップ待ちは変えない
   */
  | { kind: "message"; key: string; params?: Record<string, string | number>; clearOn?: "moved" | "step"; instant?: true }
  | { kind: "moved"; pos: Pos; facing: Facing }
  | { kind: "turned"; facing: Facing }
  | { kind: "blocked" }
  /** 戦闘の開始。screen{battle} の直後に 1 回 */
  | { kind: "encounter"; groups: EnemyGroupView[] }
  /** actorId / targetId は味方なら "c1".."c6"、敵なら "e{g}-{u}"。1 振り（味方の攻撃 1 回・敵の攻撃要素 1 つ）ごとに 1 件 */
  | { kind: "attack"; actorId: string; targetId: string; hit: boolean; damage: number }
  /** targets は効果を受けた id（敵は "e{g}-{u}"、味方は memberId）。identify は [] */
  | { kind: "spell"; actorId: string; spellId: string; targets: string[] }
  /** id は味方か敵（"e{g}-{u}"）。敵の hp は表示層が見せない（被弾のフラッシュの契機にだけ使う） */
  | { kind: "hpChanged"; id: string; delta: number; hp: number }
  | { kind: "sanChanged"; id: string; delta: number; san: number }
  /** id は味方か敵 */
  | { kind: "statusChanged"; id: string; status: StatusId; on: boolean }
  /** id は味方か敵。敵の撃破は life "dead" */
  | { kind: "lifeChanged"; id: string; life: Life }
  /** UI-40: 判定 1 件。見出し / 各行（DiceRow）/ 基準 / 結果。どれも strings のキーと埋め込み値 */
  | {
      kind: "dice";
      label: TextRef;
      rows: DiceRow[];
      rule: TextRef;
      result: TextRef;
      /**
       * UI-71（M11。U-2）: 真なら GM が出目と結果を伏せた判定。rows は判定する人の力の内訳だけで、出目の行は無い。result は伏せたことを表す文。
       * 表示層は結果の行の演出（成否の色）を出さない。今は宝箱の「調べる」（CB-63）だけ
       */
      hidden?: true;
    }
  /** CB-55: 区切りの始まり。直後は必ず拍以外のイベント。auto はその区切りを始めた時点の state.battle.auto（battle が null なら false） */
  | { kind: "beat"; phase: BeatPhase; auto: boolean }
  | { kind: "battleEnd"; result: "win" | "flee" | "wipe" }
  /**
   * UI-47 / TW-04（M10.5 追補 2）: 語りの区切り。表示層は会話の箱の文を読ませてから（▼ のタップ待ち）空にして続ける。
   * 今は宿のレベルアップでメンバーごとに 1 回（その人の最初の levelUp の直前）。区切りの前に語った文が無ければ表示層は何もしない
   */
  | { kind: "section" }
  | { kind: "wipe"; penalty: PenaltyResult }
  /**
   * TW-34（M12）: 結末の戦績。全ダンジョン制覇（DG-36）の後に初めて街に着いたとき、締めの語り（ending.speech.1..N）の直後に 1 回。
   * record は core の endingRecordView の値（表示層は state を掘らずにこれだけで描く）
   */
  | { kind: "ending"; record: EndingRecord }
  /**
   * TW-22 / UI-56（M5.5）: 全滅の出目の表。title は見出し、rows は penalty-table.json の帯の順に 1 行ずつ（strings のキーと埋め込み値。core が作る）。
   * 2d10 の dice の直前に hit null で 1 回、dice の直後に hit = 当たった帯の添字（PenaltyResult.bandIndex と同じ）で 1 回出す
   */
  | { kind: "penaltyTable"; title: TextRef; rows: TextRef[]; hit: number | null }
  /** §5 に増分と新しい最大値と変化後の現在値を足した（表示層が state を掘り直さずに済むように） */
  | {
      kind: "levelUp";
      id: string;
      level: number;
      hpGain: number;
      mpGain: number;
      hpMax: number;
      mpMax: number;
      hp: number;
      mp: number;
      /** CH-61（M10）: この段で +1 された能力値（STAT_KEYS の順）。判定しなかった段・上がらなかった段は空。state には残さない */
      statGains: StatKey[];
    }
  /**
   * CH-80 / UI-69（M20。D-8）: 戦闘の勝利の経験値（CB-50）でレベルアップ可（↑）が偽 → 真になった者 1 人につき 1 件（battle.exp の直後、並び順）。
   * 表示層はパーティ欄のその人の名前に↑をその場で付ける（今までは再生の最後の sync まで付かず、一言 hint.levelUpMark が先に出た）
   */
  | { kind: "levelUpReady"; id: string }
  /** §5 に追加（CH-62）。1 段下がるごとに 1 件。hp / mp は変化後の現在値 */
  | { kind: "levelDown"; id: string; level: number; hpMax: number; mpMax: number; hp: number; mp: number }
  /** via は §5 に追加（MG-21 の判定 / MG-23 の保証 / MG-25 の魔法書 / TW-09 の転職で初めての職業の start.knownSpells。M10） */
  | { kind: "spellLearned"; id: string; spellId: string; via: "roll" | "guarantee" | "book" | "classChange" }
  | { kind: "eventStarted"; eventId: string; actorId?: string }
  /** 階の移動（DG-14 の昇降）。moved は同じ階の前進だけに使う */
  | { kind: "floorChanged"; floor: number; pos: Pos; facing: Facing }
  /** dungeonId は to が dungeon のときだけ（潜っているダンジョン。UI-63 のダンジョンごとの曲。M8） */
  /**
   * at は to が dungeon のときの視点（M11。A2 / U-6）。戦闘の終わり（勝利・逃走）では必ず載せる（戦った位置と向き）。
   * 同じ events の後で位置が変わりうる（宝箱の転移など）ので、表示層はあればこれで迷宮を描き、無ければ最終の state から描く
   */
  | { kind: "screen"; to: Screen; dungeonId?: string; at?: { pos: Pos; facing: Facing } }
  /**
   * CB-60（M11）: 宝箱を見つけた（dive.chest に置いた）。表示層は箱の操作を出す合図にする。
   * danger は見つけた時点の箱の危険度（dive.chest.danger。M15。記録・集計用で、表示層は使わない）
   */
  | { kind: "chestFound"; source: "drop" | "cell"; danger: number }
  /**
   * CB-62（M11）: 宝箱の罠が作動した。続けて語り chest.trap.<trapId> と効果の hpChanged / statusChanged / sanChanged など。
   * actorId は作動させた人（調べる・解除の失敗はその人、開けるで target one の罠なら選ばれた人）。開けるで target one でない罠は null
   */
  | { kind: "chestTrap"; trapId: string; actorId: string | null }
  /** CB-65 / CB-66（M11）: 箱が片付いた（dive.chest が null になった）。opened 開けた、left 放っておいた、lost 失った。表示層は箱の操作を下げる */
  | { kind: "chestEnd"; result: "opened" | "left" | "lost" }
  /**
   * EV-16（M11）: 宝箱を見つけたときの衝動で行動者が決まった（語り chest.impulse.actor の前）。続けて制止（EV-25）と、制止できなければ
   * 「調べずに開ける」（CB-65。作動させた人は行動者）。表示層の印は eventStarted の actorId と同じ扱い
   */
  | { kind: "chestImpulse"; actorId: string }
  /** CH-43b（M23）: 歩ける場面で hp が hpMax × hpWarnRatio を下回った（割合以上に戻るか戦闘が始まるまで一度）。poison はその者が毒か（文を選ぶ） */
  | { kind: "hpWarn"; id: string; hp: number; hpMax: number; poison: boolean }
  /** D2: 受け付けなかったコマンド。command は受け取った type（形が壊れていれば "unknown"）、reason は英語の短い理由 */
  | { kind: "rejected"; command: string; reason: string }
  /** M3 追加: 鑑定（CB-05 / MG-41）で表示名が変わったときに全グループを出し直す */
  | { kind: "enemyGroups"; groups: EnemyGroupView[] }
  /** M3 追加（§5「足りなければ足す」）: MP の変化。delta は負で消費 */
  | { kind: "mpChanged"; id: string; delta: number; mp: number };

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

