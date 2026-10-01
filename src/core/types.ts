// src/core/types.ts — M1 の最終設計
// 方針:
// - GameState は JSON にそのまま保存できるプレーンな値だけで作る（CLAUDE.md §3-11）。
//   GameState の中にはクラス、Map、Set、関数、undefined の値、省略可能なフィールド（?:）を入れない。
//   「無い」は null か空配列・空オブジェクトで表す。
// - verbatimModuleSyntax が有効なので、型は import type で取る。data の型は定義し直さない。
// - import 先は "./data/index" と "./rng"（どちらも src/core 内。architecture.test の制約）。
import type { EquipSlot, GameData, PersonalityId, SpellTarget, StatBlock, StatusId, TrapId } from "./data/index";
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
 * M5 でイベントの選択と罠の察知（DG-21）を kind を足して同じ形で載せる。
 * promptKey は確認文の strings キー（params なし。リロード復帰で表示層が出し直す）。
 * 不変条件: これを立てる execute は、同じ events の中に key === promptKey（params なし）の message を必ず出す。
 * option id: "descend" | "ascend" | "stay"（M2）、"exit"（DG-06 の 1 階の上り階段。kind は stairs）、"teleport"（DG-32）
 */
export type PendingChoice = { kind: "stairs" | "teleporter"; promptKey: string; options: ChoiceOption[] };

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
/** UI-24 の記号。罠・イベント・ボス・部屋・通路はすべて plain（地図で明かさない） */
export type MapCellKind = "plain" | "stairsUp" | "stairsDown";
/** 辺は絶対方位（扉は通り抜けた後も door。DG-10） */
export type MapCell = { x: number; y: number; kind: MapCellKind; n: Edge; e: Edge; s: Edge; w: Edge };
/** DG-13 / UI-24。cells は探索済みセルだけ（添字の昇順） */
export type MapView = { dungeonId: string; floor: number; width: number; height: number; pos: Pos; facing: Facing; cells: MapCell[] };

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

/** 遭遇の出どころ。逃走の可否は origin から導く（random だけ可。CB-02）。M5 で { kind: "event"; eventId: string } を足す */
export type BattleOrigin =
  | { kind: "random"; inRoom: boolean } // CB-01。inRoom は遭遇したセルの roomId !== null（CB-51 の宝箱）
  | { kind: "boss" }; // DG-31

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

// ===================== GameState =====================
// M1 で確定した欄に、M2 で dive と pendingChoice、M3 で battle と bestiary、M4 で townVisit を足した。
// M4 のこの形を保存レコードの schemaVersion 1 として確定する（以後の変更は src/save/migrate.ts の移行を伴う）。
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
  /** F1: 戦闘中だけ非 null（screen === "battle" と同値） */
  battle: BattleState | null;
  /** F6: monsterId → 記録。ゲーム単位で永続（戦闘・潜行・全滅をまたぐ） */
  bestiary: Record<string, BestiaryEntry>;
  /** TW-30〜32。screen === "town" と townVisit !== null は同値（title / dungeon / battle では null） */
  townVisit: TownVisit | null;
};

// ===================== コマンド（CLAUDE.md §5） =====================

/** D4: members[0] がリーダーで personality は null。それ以外は null 不可。"random" は core が rng で決める（CH-30） */
export type PartySetupMember = { name: string; personality: PersonalityId | "random" | null };
export type PartySetup = { members: PartySetupMember[] };

/**
 * TW-05。プロトタイプで実装するのは buy（itemId は items.json の id。売り物は consumable かつ infinite の品）だけ。
 * sell / identify は形だけで、rejected "not implemented"
 */
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
  /**
   * itemId は §5 の名前のまま。中身は ItemInstance.id（使う本人の inventory のもの。items.json の id ではない）。
   * targetId は effect.target === "ally" のときだけ必須、他では無視（dungeon.cast と同じ形。types.ts を正とする）
   */
  | { type: "dungeon.useItem"; memberId: string; itemId: string; targetId?: string }
  /** MG-44: 迷宮の戦闘外の呪文。targetId は spell.target が ally のときだけ必要（resurrect では life dead の者） */
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
  /** UI-57（開発用）: alive の全員の hp を 1 にする。保留中も受け付ける。乱数は使わない */
  | { type: "debug.hpOne" };

export type CommandType = Command["type"];

// ===================== イベント =====================

// ===================== 表示層向けの問い合わせの結果（rules/combat.ts の battleMenu が返す。state には入れない） =====================

/**
 * §7: encounter / enemyGroups と BattleMenu.groups で同じ形。全グループを添字順に返す（体数 0 も残す）。
 * name は core が選んだ表示名（bestiary[monsterId].identified なら monsters[].name、でなければ unidentifiedName）。
 */
export type EnemyGroupView = {
  index: number;
  monsterId: string;
  name: string;
  identified: boolean;
  /** 生存個体の数 */
  count: number;
};

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
  /** CB-02: origin が random のときだけ真 */
  canFlee: boolean;
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

export type TownMenuInnRank = { rank: number; id: string; name: string; cost: number; affordable: boolean };
export type TownMenuTempleRow = { memberId: string; name: string; cost: number; affordable: boolean };
export type TownMenuShopItem = { itemId: string; name: string; price: number; affordable: boolean };
export type TownMenuShopMember = { memberId: string; name: string; slotsFree: number };
/** rules/town.ts townMenu。screen === "town" のときだけ非 null */
export type TownMenu = {
  gold: number;
  inn: TownMenuInnRank[];
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
  /** TW-05 店（消耗品の購入だけ） */
  shop: {
    /** 売り物（items.json の順で consumable かつ infinite の品）。affordable = gold >= price */
    items: TownMenuShopItem[];
    /** 持たせる候補 = life alive の者（並び順）。slotsFree = slotsPerCharacter − 装備数 − inventory（CH-71。0 なら inventory full） */
    members: TownMenuShopMember[];
  };
  /** TW-31: townVisit.mercyOffered なら dead / ash の全員（並び順）。申し出が無ければ null */
  mercy: { memberId: string; name: string; life: "dead" | "ash" }[] | null;
  /** TW-11: progress.unlockedDungeons の順。canEnter = checkEnter(state, id, data) === null */
  dungeons: { id: string; name: string; canEnter: boolean }[];
};

/** rules/items.ts fieldItemMenu の道具 1 個 */
export type FieldItemView = {
  instanceId: string;
  itemId: string;
  name: string;
  /** "ally" なら対象を選ぶ（targetId 必須）。"none" は対象を選ばない（self / party / return / learn） */
  target: "ally" | "none";
  /** checkUseItem(state, data, cmd) === null と同値。ally の品は「alive の味方が 1 人以上」で見る */
  usable: boolean;
};
/** rules/items.ts fieldItemMenu。screen dungeon・dive 非 null・battle null・pendingChoice null のときだけ非 null */
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
  /** 対象を 1 人仮に当てたうえで checkCast === null かどうか（ally なら allies の先頭、dead なら dead の先頭、none なら対象なし） */
  usable: boolean;
};
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
  /** 鑑定済みかつ items[].cursed のとき true（表示用。未鑑定なら false。CH-73 の「見えない」） */
  cursed: boolean;
  /** checkUnequip === null と同じ。呪われているかは鑑定と関係なく items[].cursed で決める */
  canUnequip: boolean;
};
export type CampMember = {
  id: string;
  name: string;
  life: Life;
  canAct: boolean;
  /** 並び順の添字が config.party.frontRow 未満なら front（表記だけに使う） */
  row: "front" | "back";
  /** place が town なら []。dungeon なら knownSpells の順で、戦闘外で使える呪文（fieldSpellOk）だけ */
  spells: CampSpellView[];
  /** EQUIP_SLOTS の順に 6 件 */
  slots: CampSlotView[];
  /** 本人の inventory の順で、type が EQUIP_SLOTS のどれかに当たる品 */
  equipCandidates: CampEquipCandidate[];
};
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
 * 道具は従来どおり fieldItemMenu を使う（dungeon のときだけ非 null）。
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
  | { kind: "dice"; label: TextRef; rows: DiceRow[]; rule: TextRef; result: TextRef }
  /** CB-55: 区切りの始まり。直後は必ず拍以外のイベント。auto はその区切りを始めた時点の state.battle.auto（battle が null なら false） */
  | { kind: "beat"; phase: BeatPhase; auto: boolean }
  | { kind: "battleEnd"; result: "win" | "flee" | "wipe" }
  | { kind: "wipe"; penalty: PenaltyResult }
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
    }
  /** §5 に追加（CH-62）。1 段下がるごとに 1 件。hp / mp は変化後の現在値 */
  | { kind: "levelDown"; id: string; level: number; hpMax: number; mpMax: number; hp: number; mp: number }
  /** via は §5 に追加（MG-21 の判定 / MG-23 の保証 / MG-25 の魔法書） */
  | { kind: "spellLearned"; id: string; spellId: string; via: "roll" | "guarantee" | "book" }
  | { kind: "eventStarted"; eventId: string; actorId?: string }
  /** 階の移動（DG-14 の昇降）。moved は同じ階の前進だけに使う */
  | { kind: "floorChanged"; floor: number; pos: Pos; facing: Facing }
  | { kind: "screen"; to: Screen }
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

