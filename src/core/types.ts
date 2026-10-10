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

/** IT-33: 実体が持つオプション 1 つ。value は符号付き（呪いの負のオプションは負。IT-32）で、生成時に決めた値のまま */
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
/** DG-04: セル種別 */
export type CellKind = "corridor" | "room" | "stairsUp" | "stairsDown" | "boss" | "teleporter" | "event" | "trap" | "chest";
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
};

/**
 * CB-60（M11）: 宝箱 1 つの状態。
 * - source: drop は戦闘後のドロップ（CB-51）、cell は階に置かれた宝箱のセル（DG-23。cell が非 null）
 * - inRoom: 見つけたセルが部屋か（警報の遭遇の部屋 / 通路。CB-67）
 * - trapId: 今かかっている罠（chest-traps.json の id。解除・作動で null）
 * - danger: 見つけた時点の危険度（罠なし 0）。解除・作動しても残す。使うのは中身の上振れ（IT-56）だけ（調べる・解除の式は trapId から引く）
 * - level: 中身の Lv（IT-53）
 * - finding: 最後の「調べる」で GM が告げた名前（偽りもありうる）。{ trapId: null } は「罠は無さそう」、null は未調査か不明。解除に成功したら { trapId: null }
 * - rivalry: 職業の掛け合い（EV-70〜76）の担当。発生していなければ null
 * - rivalryFails: 担当の調べるの失敗の数（EV-76。片付いた時点で清算する）
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
};

// ===================== 保留中の選択（E3） =====================

/** labelKey は strings.json のキー */
export type ChoiceOption = { id: string; labelKey: string };
/**
 * 非 null の間は event.choose 以外のコマンドを rejected（"choice pending"）にする。
 * 階段・出口・テレポーター・罠の察知（DG-21）・イベントの選択（EV-31）を kind で区別して同じ形で載せる。kind ごとに option id の意味が違う（id が重なってもよい）。
 * promptKey は確認文の strings キー（params なし。リロード復帰で表示層が出し直す）。
 * 不変条件: これを立てる execute は、同じ events の中に key === promptKey（params なし）の message を必ず出す。
 * option id: kind stairs は "descend" | "ascend" | "stay"（M2）と "exit"（DG-06 の 1 階の上り階段）、kind teleporter は "teleport" | "stay"（DG-32）、
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
/** 辺は絶対方位（扉は通り抜けた後も door。DG-10） */
export type MapCell = { x: number; y: number; kind: MapCellKind; n: Edge; e: Edge; s: Edge; w: Edge };
/** DG-13 / UI-24。cells は探索済みセルだけ（添字の昇順） */
export type MapView = { dungeonId: string; floor: number; width: number; height: number; pos: Pos; facing: Facing; cells: MapCell[] };

/**
 * CB-60 / UI-70（M11）: 宝箱の操作の値。rules/chest.ts の chestView(state, data)。dive.chest が非 null で、battle も pendingChoice も null のときだけ非 null。
 * 判定の成否・罠の有無と危険度は載せない（表示層に漏らさない）。
 * - members: パーティ全員（並び順）。canAct の者だけが調べる・解除の人に選べる（リーダーも可）
 * - trapNames: chest-traps.json の全種（データの順）。name は表示名（strings を引いた値）。解除で宣言する名前の一覧
 * - finding: 最後の「調べる」で告げられた結果（ChestState.finding）。trapId null は「罠は無さそう」。name は trapId の表示名（null なら null）
 * - ownerId: 職業の掛け合い（EV-73）で決まった担当の id（ChestState.rivalry の ownerId。語りで告げた公開の値）。発生していなければ null。UI-70 の人の段の印
 */
export type ChestView = {
  source: "drop" | "cell";
  members: { id: string; name: string; canAct: boolean }[];
  trapNames: { id: string; name: string }[];
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
  | { type: "town.temple"; memberId: string; service: "resurrect" | "cure" | "uncurse" }
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
  /**
   * TW-17（M7）: 闇魔術の強化。本人の equipment[slot] の汎用装備を、本人の inventory の鑑定済みの汎用装備（catalysts。0〜upgradeMaxCatalysts 個、
   * 重複なし。成否に関わらず消える）を触媒に d100 で鍛える。乱数は d100 の 1 回
   */
  | { type: "town.upgrade"; memberId: string; slot: EquipSlot; catalysts: string[] }
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
   * itemId は §5 の名前のまま。中身は ItemInstance.id（使う本人の inventory のもの。items.json の id ではない）。
   * targetId は effect.target === "ally" のときだけ必須、他では無視（dungeon.cast と同じ形。types.ts を正とする）
   */
  | { type: "dungeon.useItem"; memberId: string; itemId: string; targetId?: string }
  /** MG-44: 戦闘外の呪文（迷宮の戦闘外と、M5.5 から街。帰還は迷宮だけ）。targetId は spell.target が ally のときだけ必要（resurrect では life dead の者） */
  | { type: "dungeon.cast"; memberId: string; spellId: string; targetId?: string }
  | { type: "battle.input"; memberId: string; action: BattleAction }
  | { type: "battle.resolve" }
  | { type: "battle.auto"; on: boolean }
  /** CB-12/50: パーティの「逃げる」。入力済みの行動を捨てて、すぐに逃走判定をする */
  | { type: "battle.flee" }
  /** CB-12/40: パーティの「前回と同じ」。行動可能な全員の入力をオート入力の規則で作り、1 ラウンドだけ解決する */
  | { type: "battle.repeat" }
  | { type: "event.choose"; optionId: string }
  /** CH-03: パーティ全員の id を並べ替えたもの（同じ集合で重複なし）。街と、迷宮の戦闘外かつ保留なしのとき */
  | { type: "party.reorder"; order: string[] }
  /** CH-76: 本人の inventory にある品を装備する。同じスロットの旧品は inventory の同じ位置に入る */
  | { type: "party.equip"; memberId: string; instanceId: string }
  /** CH-76: 装備を外して inventory の末尾に入れる */
  | { type: "party.unequip"; memberId: string; slot: EquipSlot }
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
  spells: BattleMenuSpell[];
  items: BattleMenuItem[];
};
export type BattleMenu = {
  round: number;
  auto: boolean;
  /** CB-02: origin が random か alarm のときだけ真 */
  canFlee: boolean;
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
export type TownMenuTempleRow = { memberId: string; name: string; cost: number; affordable: boolean };
export type TownMenuShopItem = { itemId: string; name: string; price: number; affordable: boolean };
/**
 * TW-05（M16）: 店の汎用装備の性能の下見（rules/shop.ts shopItemPreview。鑑定済み・通常・オプションなしの Lv の実体を合成して itemPower を呼んだ値）。
 * attack は武器のダメージのダイス（Lv の分を定数に合算した正規形。品の詳細の damageDice と同じ）で武器でなければ null、
 * ac は防具類（盾・兜・小手・装飾を含む）の AC で武器なら null、magicPower は術者用の武器の魔法攻撃力でそれ以外は null。
 * anyone はベースの classes が空（誰でも装備できる）、classes は装備できる職業の abbr（classes.json の順。anyone なら全職業）
 */
export type ShopItemPreview = { attack: string | null; ac: number | null; magicPower: number | null; anyone: boolean; classes: string[] };
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
  preview: ShopItemPreview;
  canEquip: string[];
};
export type TownMenuShopMember = { memberId: string; name: string; slotsFree: number };
/** IT-61: 売れる品 1 個（本人の inventory の品。未鑑定も売れる）。price は店での売値 shopSellPrice（未鑑定は見た目の品種の売値、name は未鑑定の名前） */
export type TownMenuShopSellRow = { instanceId: string; name: string; price: number };
/** IT-63: 買い戻しのストックの品 1 個。price は uniques[].price、affordable = gold >= price */
export type TownMenuShopBuybackRow = { instanceId: string; name: string; price: number; affordable: boolean };
/** IT-65: 店で鑑定できる品 1 個（本人の inventory の未鑑定の品）。name は未鑑定の表示名、fee は品ごとの鑑定料 identifyFeeOf、affordable = gold >= fee */
export type TownMenuShopIdentifyRow = { memberId: string; memberName: string; instanceId: string; name: string; fee: number; affordable: boolean };
/** TW-16: 倉庫・所持品の 1 個 */
export type TownMenuStorageRow = { instanceId: string; name: string };
/**
 * TW-17: 強化の部位 1 つ（EQUIP_SLOTS の順）。block は null なら対象にできる、"slot empty"（空き）/ "unique"（ユニーク）。
 * name は表示名（空きなら null）、level は実体の level（空きなら 0）
 */
export type TownMenuUpgradeSlot = { slot: EquipSlot; instanceId: string | null; name: string | null; level: number; block: string | null };
/** TW-17: 触媒の候補 1 個（本人の inventory の鑑定済みの汎用装備。inventory の順）。name は表示名 */
export type TownMenuUpgradeCatalyst = { instanceId: string; name: string; level: number };
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
 * affordable = gold >= fee、block は checkUpgrade の理由（受け付けるなら null）
 */
export type UpgradePreview = { rate: number; great: number; fee: number; affordable: boolean; block: string | null };
/** rules/town.ts townMenu。screen === "town" のときだけ非 null */
export type TownMenu = {
  gold: number;
  inn: TownMenuInnRank[];
  /** TW-15（M7）: 今の士気（立てたランクの id と名前）。無ければ null。rankId がデータに無ければ null */
  morale: { rankId: string; name: string } | null;
  temple: {
    /** life dead の者（並び順）。cost = level × templeCostPerLevel */
    resurrect: TownMenuTempleRow[];
    /** life alive で毒・麻痺・石化のどれかを持つ者。cost = 該当状態の cureCost の合計 */
    cure: TownMenuTempleRow[];
    /** 呪われた品を装備している者（life を問わない）。cost = uncurseCost */
    uncurse: TownMenuTempleRow[];
  };
  /** TW-08 闇魔術: life ash の者（並び順）。cost = level × darkCostPerLevel、affordable = gold >= cost */
  dark: TownMenuTempleRow[];
  /** TW-05 店（rules/shop.ts shopMenu。M7 で売却・買い戻し・鑑定・流通レベルの装備を足した） */
  shop: {
    /** 売り物の消耗品（items.json の順で consumable かつ infinite の品）。affordable = gold >= price */
    items: TownMenuShopItem[];
    /** IT-62: 流通レベルの汎用装備（equipment-bases.json の順で shopMinLevel ≤ shopLevel のベース） */
    equipment: TownMenuShopEquipment[];
    /** 持たせる候補（buy / buyback）= life alive の者（並び順）。slotsFree = slotsPerCharacter − 装備数 − inventory（CH-71。0 なら inventory full） */
    members: TownMenuShopMember[];
    /** IT-61: 全員（並び順。life を問わない）の、inventory の品（inventory の順。2026-10-05 から未鑑定も含む） */
    sellable: { memberId: string; name: string; items: TownMenuShopSellRow[] }[];
    /** IT-63: 買い戻しのストック（売った順） */
    buyback: TownMenuShopBuybackRow[];
    /** IT-65: 全員（並び順。life を問わない）の inventory の未鑑定の品（鑑定料は品ごと） */
    identify: { items: TownMenuShopIdentifyRow[] };
  };
  /** TW-16 / IT-64 倉庫（rules/storage.ts storageMenu） */
  storage: {
    /** config.items.warehouseSlots */
    capacity: number;
    /** capacity − warehouse の数（0 なら warehouse full） */
    slotsFree: number;
    /** warehouse の品（預けた順）。name は itemDisplayName（未鑑定なら未鑑定の名前） */
    items: TownMenuStorageRow[];
    /** 全員（並び順。life を問わない）の inventory の品と、所持枠の空き（0 なら引き出しは inventory full） */
    members: { memberId: string; name: string; slotsFree: number; items: TownMenuStorageRow[] }[];
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
  /** TW-11: progress.unlockedDungeons の順。canEnter = checkEnter(state, id, data) === null */
  dungeons: { id: string; name: string; canEnter: boolean; notReady: boolean }[];
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
/** 装備できない理由。表示層は strings の camp.equipBlock.{block} で出す */
export type EquipBlock = "cannotAct" | "unidentified" | "class" | "cursedSlot";
export type CampEquipCandidate = {
  instanceId: string;
  /** itemDisplayName。未鑑定なら unidentifiedName（CH-72） */
  name: string;
  slot: EquipSlot;
  /** null なら party.equip を受け付ける（checkEquip === null と同じ） */
  block: EquipBlock | null;
};
export type CampSlotView = {
  slot: EquipSlot;
  instanceId: string | null;
  name: string | null;
  /** 鑑定済みかつ実体の cursed（IT-32）のとき true（表示用。未鑑定なら false。CH-73 の「見えない」） */
  cursed: boolean;
  /** checkUnequip === null と同じ。呪われているかは鑑定と関係なく実体の cursed で決める */
  canUnequip: boolean;
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
  /** CH-78（M10）: 使用枠（CH-71）に空きがあり、party.give の受け取る側になれる（target full の逆）。life は問わない。自分かどうかは見ない */
  canReceive: boolean;
  /** UI-59（M10）: 本人の inventory の順の所持品（装備中は含めない。渡す・捨てるの候補） */
  inventory: CampInventoryItem[];
  /** CH-71（M10）: 使用枠の数（装備 + 所持品。slotsUsed）と上限（config.inventory.slotsPerCharacter）。表示の数字だけ */
  slotsUsed: number;
  slotsMax: number;
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
  /** TW-15（M7）: 宿の士気がある（moraleOf が null でない） */
  morale: boolean;
};

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
  | { kind: "message"; key: string; params?: Record<string, string | number> }
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

