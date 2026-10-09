// H9 バランスのボット（ユーザー決定）: 「潜行 → 街（救済 → 拾った装備の売却（M7-B）→ 寺院 → 闇魔術 → 相部屋 1 泊 → 店で補充）→ 潜行」を繰り返す。
// 200 シードの計測は tests/balance/campaign.sim.ts（npm run balance）、既定の npm test には tests/balance.test.ts の煙テスト（5 シード）だけを置く。
// ボットは 2 つ: (a) 4 戦固定ボット（4 戦で帰る）、(b) セオリーボット（戦い続け、この潜行の開始時に alive だった者が dead / ash になった時点か、CB-14 の繰り上げ後の前衛の生存者（life が alive）の「現在 HP の合計 ÷ 最大 HP の合計」が半分を切った時点で帰る。死者は数えない。ユーザー決定）。
// ボットはテストの中だけにあり、core の execute と問い合わせ（floorOf、fieldItemMenu、townMenu、frontLineIds）だけを使う。
// 合否は不変条件だけで、数字のしきい値では落とさない（数字は console.log に出し、decisions に転記する）。
// 店: alive の者が帰還の糸を持っていなければ 1 本、その後パーティ全体の手持ちの薬草が 6 個【仮】になるまで薬草（払える範囲で。ユーザー決定）。
// M7-解毒（2026-10-05 ユーザー指示）: 店で薬草の後にパーティ全体の手持ちの解毒草を 2 個まで、戦闘の後に毒の者がいれば解毒草を使い、寺院で蘇生・闇魔術の後に毒を治す（cure）。
// 累積の評価は資産 = 所持金 + 手持ちの消耗品（パーティ全員の inventory の consumable）の購入価格の合計で、初期の資産からの差（所持金だけの差も参考に出す）。
// ボットの値（BFS 距離 6、戦闘数、上限 3000 歩、潜行の回数、薬草の目標 6 個）はテストの定数で、ゲームの調整値ではない。
// M9（2026-10-06 ユーザー指示「ボットを d01 の 2 階と、d01 クリア後の d02 まで潜らせる」）: 上の 2 つ（旧ルート。d01 の 1 階だけ）はそのまま残し、
// 進行ボット（route progress。帰る条件はセオリーと同じ）を足す。d01 の 1 階は、降りる条件（全員 alive・全員 L ≥ DESCEND_LEVEL）を満たせば
// 上り階段から下り階段へ BFS の最短で歩いて降り、満たさなければ旧ルートと同じく上り階段の近傍を歩く。2 階（最下層）では
// ボスに挑む条件（全員 alive・全員 L ≥ BOSS_LEVEL・前衛の HP の合計 ≥ BOSS_FRONT_HP_PCT%）を満たせばボスへ歩いて戦い、勝てばテレポーターで街へ。
// 満たさなければ 2 階の上り階段から BFS ≤ NEAR を歩く。帰りは糸が無ければ階ごとに上り階段へ歩いて ascend / exit。
// d01 を踏破した後は d02 の 1 階だけを旧ルートと同じ規則で歩き、d02 に D02_DIVES 回潜ったらそのシードを終える。
// M9-装備（2026-10-06 ユーザー指示。飛行への攻撃の規則の変更（仮）に伴うボットの変更）: 進行ボット（outfit）だけ、街の店の補充の後に
// (1) 後衛（並び 4〜6）の alive・行動可能な者で武器の reach が ranged でない者に、店に並ぶ ranged の武器（RANGED_BUY の順。職業が使えるもの）を
// 1 本買って装備させ（払える範囲）、外した武器は売る。(2) 所持金のうち予備費（ユーザーの判断 1: パーティの平均 level で計算した 1 人分の蘇生費
// = templeCostPerLevel × 並び 6 人全員の平均 level の切り捨て）を超える分で、前衛（並び 1〜3）の alive・行動可能な者の防具・盾・兜・小手を、流通レベル（shopLevel）の品のうち
// 実効の AC が最も低いものに替える（今の品より Lv が上がり（空の枠は常に上がるとみなす）、実効の AC が下がるものだけ。並び順 × 部位の順に 1 周、
// 払えるものだけ）。外した品は売る。旧ルートの 2 つはこれらをしない。
// 飛行だけの遭遇で逃走する規則（旧 (3)）はユーザーの判断 2（2026-10-06）で廃止した。ボットは逃げない。
// 進行ボットの降りる条件は「全員 L3 以上」（DESCEND_LEVEL）を公式とし、常に降りる規則（BALANCE_DESCEND_LEVEL=1）の数字は参考として残す。
// M12（2026-10-08 ユーザー指示「計測のボットを d03 まで潜らせる」。設計書 §4）: 進行ボットは全ダンジョンで同じ規則（progressDungeon）を使う。
// PROGRESS_ROUTE の順に、まだ踏破していない最初のダンジョン（どれも踏破済みなら最後の d03）に潜り、d03 に D03_DIVES 回潜ったらそのシードを終える。
// 降りる条件・ボスに挑む条件の level はダンジョンごと（DESCEND_LEVELS / BOSS_LEVELS。d02・d03 の値は降りすぎを止める保険で、ほぼ素通りの見込み）。
// 潜行の上限は PROGRESS_DIVES（15 → 40。d02 の踏破に何潜行かかるか分からないため）。
import { expect } from "vitest";
import { execute } from "../../src/core/engine";
import { createRng, diceRange, parseDice, randInt, type RngState } from "../../src/core/rng";
import { cellAt, edgeOf, FACINGS, isPassable, opposite, step, turnLeft, turnRight } from "../../src/core/rules/dungeon-gen";
import { floorOf } from "../../src/core/rules/dungeon";
import { fieldItemMenu } from "../../src/core/rules/items";
import { canAct, frontLineIds } from "../../src/core/rules/combat-calc";
import { chestRate, chestView } from "../../src/core/rules/chest";
import { equipStats, itemPower } from "../../src/core/rules/equip-stats";
import { sellPrice } from "../../src/core/rules/shop";
import { townMenu } from "../../src/core/rules/town";
import { classOf, findBase, findItem, itemOf, monsterOf, slotsUsed } from "../../src/core/state";
import type { EquipSlot } from "../../src/core/data/index";
import type { Command, Facing, Floor, GameEvent, GameState, ItemInstance, PartySetupMember, PenaltyResult, Pos } from "../../src/core/types";
import { data, expectKnownStringKeys, expectStateInvariants, expectTallyMatchesEvents, newGame } from "../helpers/core";

export const NEAR = 6; // 上り階段からの BFS 距離
const STEP_CAP = 3000; // 1 回の潜行の歩数の上限
const BATTLE_ROUND_CAP = 300;
const FRONT_ROW = data.config.party.frontRow; // 並び順の前衛の人数（frontDownAtStart の記録用。セオリーボットの帰還条件は CB-14 の frontLineIds を使う）
const HERB_TARGET = 6; // 【仮】店の後のパーティ全体の手持ちの薬草の数（ユーザー決定）
const ANTIDOTE_TARGET = 2; // M7-解毒: 店の後のパーティ全体の手持ちの解毒草の数（ユーザー指示「2 個まで」。薬草と同じくパーティ全体で数える）
const INN_RANK = data.config.town.innRanks.findIndex((r) => r.id === "cheap"); // 相部屋
const START_GOLD = data.config.prototypeParty.startingGold;
const HERB = "herb";
const ANTIDOTE = "antidote_herb";
export const THREAD = "return_thread";
const THEORY_BATTLE_CAP = 8; // 【仮】M7-8戦: セオリーボットはこの潜行の戦闘がこの回数に達したら帰る（ユーザー指示。40 戦の潜行は実態と離れているため）
const HERB_PRICE = itemOf(data, HERB).price;
const ANTIDOTE_PRICE = itemOf(data, ANTIDOTE).price;
const THREAD_PRICE = itemOf(data, THREAD).price;
// M9 進行ボットの定数（テストの定数で、ゲームの調整値ではない）
export const PROGRESS_DIVES = 40; // 1 シードあたりの潜行の上限（M12: 15 → 40。上限までに d03 に届かなかったシードは「d03 に未到達」）
/** M12: 進行ボットが潜る順。まだ踏破していない最初のダンジョンに潜り、どれも踏破済みなら最後のダンジョンに潜り続ける */
export const PROGRESS_ROUTE = ["d01", "d02", "d03"] as const;
export const D03_DIVES = 3; // M12: d03 にこの回数潜ったらそのシードを終える
export const DESCEND_LEVEL = 3; // d01 の下の階へ降りる条件: 全員 alive かつ全員の level がこれ以上（BALANCE_DESCEND_LEVEL で替えるのはこの値）
/**
 * M12（設計書 §4-1。【仮】。値は docs/balance.md のコンテンツの数値）: ダンジョンごとの降りる条件・ボスに挑む条件の level。
 * d01 は M9 からの値のまま（基準値と比べられるように）。d02・d03 は降りすぎを止める保険（F10）
 */
export const DESCEND_LEVELS: Readonly<Record<string, number>> = { d01: DESCEND_LEVEL, d02: 6, d03: 8 };
export const BOSS_LEVELS: Readonly<Record<string, number>> = { d01: 4, d02: 7, d03: 9 };
const BOSS_FRONT_HP_PCT = 70; // ボスに挑む条件: 前衛（frontLineIds）の HP の合計がこの % 以上
/** M9 で足した敵（死因の集計用） */
export const M9_MONSTERS = ["dusk_bat", "drowsy_slime", "drowned_acolyte", "glass_moth", "choir_wraith", "font_mire", "stone_gazer", "sunken_bishop"];
/** M12 で足した敵（d03。死因の集計用） */
export const M12_MONSTERS = ["ash_shambler", "cinder_crow", "candle_mourner", "urn_bearer", "grave_sentinel", "ashcrown_lord"];
const NEW_MONSTERS: readonly string[] = [...M9_MONSTERS, ...M12_MONSTERS];
const monsterMark = (id: string) => (M12_MONSTERS.includes(id) ? "**" : M9_MONSTERS.includes(id) ? "*" : "");
// M9-装備の定数（テストの定数で、ゲームの調整値ではない）
/** 後衛に買い与える ranged の武器の優先順（ユーザー指示の「投げナイフ・短弓」の順。店に並び、職業が使える最初のものを 1 本） */
export const RANGED_BUY = ["throwing_knives", "short_bow"] as const;
/** 前衛の防具の更新で替える部位（防具・盾・兜・小手。この順に見る） */
const ARMOR_SLOTS: readonly EquipSlot[] = ["armor", "shield", "helm", "gauntlet"];
/** M11: 同じ箱で解除を試す回数の上限（U-4 の「作動しなければ再挑戦」。超えたら開ける。テストの定数で、ゲームの調整値ではない） */
export const DISARM_TRIES = 5;

/**
 * route progress は M9 の進行ボット。descendLevel / bossLevel はその降りる条件・ボスに挑む条件の level をダンジョンごとに上書きする
 * （M12。書いていないダンジョンは DESCEND_LEVELS / BOSS_LEVELS。1 なら level を問わない。比較と煙テスト用）。
 * outfit は M9-装備（ranged の購入・前衛の防具の更新）をするか
 */
export type BotKind = {
  label: string;
  shouldReturn: (c: Campaign) => boolean;
  route?: "progress" | "farm";
  descendLevel?: Readonly<Record<string, number>>;
  bossLevel?: Readonly<Record<string, number>>;
  outfit?: boolean;
  /** M13: route farm（農夫ボット）の Lv・ダンジョン・稼ぐ階（tests/balance/farm.ts の farmBot） */
  farm?: { level: number; dungeonId: string; floor: number };
};

/** M12: kind のダンジョン dungeonId の降りる条件（descend）・ボスに挑む条件（boss）の level */
export function levelFor(kind: BotKind, which: "descend" | "boss", dungeonId: string): number {
  const lv = which === "descend" ? (kind.descendLevel?.[dungeonId] ?? DESCEND_LEVELS[dungeonId]) : (kind.bossLevel?.[dungeonId] ?? BOSS_LEVELS[dungeonId]);
  if (lv === undefined) throw new Error(`levelFor: no ${which} level for ${dungeonId}`);
  return lv;
}

/** セオリーボットの帰る条件（M9 の進行ボットも同じ規則を使う） */
function theoryShouldReturn(c: Campaign): boolean {
  if (c.battles >= THEORY_BATTLE_CAP) return true; // M7-8戦（ユーザー指示）
  return returnOnDeath(c) || returnOnFrontHp(c);
}

/** 潜行の開始時に alive だった者が dead / ash になった（ユーザー決定。セオリーと M13 の農夫で共有） */
export function returnOnDeath(c: Campaign): boolean {
  return c.state.party.some((x) => c.aliveAtStart.includes(x.id) && x.life !== "alive");
}

/** CB-14 の前衛の HP の規則（セオリーと M13 の農夫で共有） */
export function returnOnFrontHp(c: Campaign): boolean {
  const s = c.state;
  // CB-14 の繰り上げ後の前衛（frontLineIds は state.party と config.party.frontRow だけを見るので、戦闘外の迷宮の state でも同じ規則で働く）。
  // そのうち life が alive の者（麻痺・石化・睡眠・SAN 0 も含む）だけで、HP の合計 × 2 < 最大 HP の合計なら帰る（ユーザー決定）。
  // 生存者が 0 人なら HP の規則では帰らない（その状況は上の「開始時に alive だった者が dead / ash」で帰る）。
  const ids = frontLineIds(s, data);
  const front = s.party.filter((x) => ids.includes(x.id) && x.life === "alive");
  if (front.length === 0) return false;
  const hp = front.reduce((a, x) => a + x.hp, 0);
  const max = front.reduce((a, x) => a + x.hpMax, 0);
  return hp * 2 < max;
}

export const BOTS: BotKind[] = [
  { label: "4 戦固定", shouldReturn: (c) => c.battles >= 4 },
  { label: "セオリー", shouldReturn: theoryShouldReturn },
];

/** M9 の進行ボット（帰る条件はセオリーと同じ。d01 の 2 階とボス、d01 の踏破の後は d02 の 1 階。M9-装備をする） */
export const PROGRESS_BOT: BotKind = { label: "進行", shouldReturn: theoryShouldReturn, route: "progress", outfit: true };

type Method = "thread" | "walk" | "cap" | "wipe" | "teleport"; // teleport は M9 の進行ボットのボス撃破の後

/**
 * M7-死因（2026-10-05 ユーザー指示）: 潜行中に dead になった 1 人分の記録。cause は殺した敵の monsterId（戦闘中の死亡は CB の敵の攻撃だけ）、
 * 戦闘外は "trap:pit"（DG-20 の落とし穴）・"event:<eventId>"（EV-32 の damage）、どれでもなければ "other"。
 * floor は死んだ階、status は死んだ時点（lifeChanged dead の直前。CH-45 で死亡と同時に外れる前）の状態異常
 */
type DeathRecord = { cause: string; monster: boolean; floor: number; status: string[] };

/**
 * M11-EV（2026-10-08 ユーザー指示「計測で衝動の発生率を記録」）: イベント 1 種の衝動判定の数。starts はイベントの開始（eventStarted）の数
 * （= 衝動判定の回数。対象者がいなくても数える）、impulses はそのうち行動者が決まった数（eventStarted に actorId がある）、stopped は
 * そのうち制止に成功した数（event.stop.success）、byPersonality は行動者の性格ごとの数
 */
type ImpulseTally = { starts: number; impulses: number; stopped: number; byPersonality: Record<string, number> };

/**
 * M11（EV-16 / EV-71。U-5「計測で衝動の割合（箱あたり）を記録」）: 宝箱の衝動と職業の掛け合いの数。found は衝動判定をした箱の数
 * （message chest.found.drop / cell。警報の後に戻った chest.afterAlarm は数えない）、impulses は行動者が決まった数（chestImpulse）、
 * stopped はそのうち制止に成功した数（event.stop.success）、rivalries は掛け合いの発生（rivalry.*.start）、rivalryFails は担当の失敗（rivalry.*.fail）
 */
type ChestImpulseTally = { found: number; impulses: number; stopped: number; rivalries: number; rivalryFails: number };

const emptyChestImpulse = (): ChestImpulseTally => ({ found: 0, impulses: 0, stopped: 0, rivalries: 0, rivalryFails: 0 });

/**
 * M11 作業 9: 宝箱の流れの数。found は見つけた箱の経路別（message chest.found.drop / cell。警報の後の戻りは数えない）、
 * ends は箱の終わり（chestEnd の result）、traps は罠の作動回数（chestTrap の trapId ごと）、trapsBy は作動させた操作
 * （impulse = 衝動で開けた・inspect = 調べるの失敗・disarm = 解除の失敗か名前違い・open = 開ける）、
 * inspects / disarms はボットが送った回数、disarmOk は解除の成功（chest.disarm.ok）、disarmWrong は名前違い（chest.disarm.wrong）、
 * falseNames は調べるで偽りの名前を告げられた数（計測のためだけに state の trapId と比べる。ボットの判断には使わない）、
 * cellContents は中身を得たセルの箱の数（chests のうち）
 */
type ChestFlowTally = {
  found: { drop: number; cell: number };
  ends: { opened: number; left: number; lost: number };
  traps: Record<string, number>;
  trapsBy: Record<string, number>;
  inspects: number;
  disarms: number;
  disarmOk: number;
  disarmWrong: number;
  falseNames: number;
  cellContents: number;
};

const emptyChestFlow = (): ChestFlowTally => ({
  found: { drop: 0, cell: 0 },
  ends: { opened: 0, left: 0, lost: 0 },
  traps: {},
  trapsBy: {},
  inspects: 0,
  disarms: 0,
  disarmOk: 0,
  disarmWrong: 0,
  falseNames: 0,
  cellContents: 0,
});

/**
 * M13（設計書 §2-4）: 推定の実時間（UI-75 の config.measure）に掛ける拍の数。コマンドの種類と events で数える。
 * 迷宮の分は steps〜threads、街の分は identifies・sells・inns
 */
export type Beats = {
  steps: number; // dungeon.move の送信数
  turns: number; // dungeon.turn の送信数
  encounters: number; // events の encounter
  declares: number; // events の beat{phase: "declare"}（オートの 1 行動）
  wins: number; // events の battleEnd{result: "win"}
  chestChecks: number; // chest.inspect + chest.disarm の送信数
  chestOpens: number; // chest.open の送信数
  threads: number; // dungeon.useItem で帰還の糸の実体を使った数
  identifies: number; // town.shop の identify
  sells: number; // town.shop の sell
  inns: number; // town.inn
};

export const emptyBeats = (): Beats => ({ steps: 0, turns: 0, encounters: 0, declares: 0, wins: 0, chestChecks: 0, chestOpens: 0, threads: 0, identifies: 0, sells: 0, inns: 0 });

/** M13（設計書 §3）: 迷宮の分の推定の実時間（ms） */
export function estDungeonMsOf(b: Beats): number {
  const m = data.config.measure;
  return (
    b.steps * m.stepMs +
    b.turns * m.turnMs +
    b.encounters * m.encounterMs +
    b.declares * m.actionMs +
    b.wins * m.battleEndMs +
    b.chestChecks * m.chestCheckMs +
    b.chestOpens * m.chestOpenMs +
    b.threads * m.threadMs
  );
}

/** M13（設計書 §3）: 街の分の推定の実時間（ms） */
export function estTownMsOf(b: Beats): number {
  const m = data.config.measure;
  return b.identifies * m.identifyMs + b.sells * m.sellMs + b.inns * m.innMs;
}

/** M13: 農夫ボットが帰った理由（farmShouldReturn。wipe / cap は method） */
export type FarmEnd = "full" | "time" | "death" | "hp";

/** M13: 拾った品（item.found の実体）の種類ごとの数 */
export type FoundTally = { generic: number; unique: number; consumable: number; book: number };

/** 潜行 1 回分（潜行 → 街の手順）の記録 */
export type DiveRecord = {
  method: Method;
  battles: number;
  steps: number;
  herbs: number;
  threads: number;
  homeBattles: number; // 帰ると決めた後（徒歩の帰り道）の戦闘数（battles に含む）
  homeWipe: boolean;
  frontDownAtStart: boolean; // 潜行の開始時に前衛（並び順の前 3 人）に alive でない者がいた
  down: number; // 潜行の終わり（街に着いた時点、救済・蘇生の前）に alive でない人数
  mercyOffered: boolean;
  mercyUsed: boolean;
  templeTries: number;
  templeOk: number;
  templeCost: number;
  darkCount: number;
  darkCost: number;
  innCost: number;
  innFallback: boolean; // 相部屋が払えず馬小屋に泊まった
  shopThreads: number;
  shopHerbs: number;
  shopCost: number;
  soldCount: number; // M7-B: 売った装備品の数
  soldGold: number; // M7-B: 売却収入の合計
  identifyCount: number; // M7-B: 売るために店で鑑定した回数
  identifyCost: number; // M7-B: その鑑定料の合計
  soldUnidCount: number; // M7-経済: 未鑑定のまま売った装備品の数（soldCount に含む）
  soldUnidGold: number; // M7-経済: その売却収入（soldGold に含む）
  unsold: number; // M7-B: 街の手順の後も手持ちに残った装備品（M7-経済の規則では未鑑定でも売れるので 0 のはず）
  unpaidAtStart: number; // M7-宝箱: 潜行の開始時に、前の街の手順で蘇生（寺院・闇魔術）を払えずに残した dead / ash の人数（定義は Campaign.unpaidLeft）
  chests: number; // M7-宝箱: この潜行で中身を得た宝箱の数（M11: chest.open.gold の数）
  chestsCorridor: number; // M7-宝箱: そのうち通路（ChestState の inRoom が偽）の宝箱
  chestGold: number; // M7-宝箱: 宝箱の金の合計（chest.open.gold の gold。金運込み）
  chestItems: number; // M7-宝箱: 宝箱の品のうち所持枠に入った数（chest.open.gold の後の item.found）
  chestLeft: number; // M7-宝箱: 宝箱の品のうち所持枠が無くて置いていった数（chest.open.gold の後の item.leftBehind）
  dropItems: number; // M14（CB-57）: 直接ドロップの品のうち所持枠に入った数（battle.drop の直後の item.found）
  dropLeft: number; // M14（CB-57）: 直接ドロップの品のうち所持枠が無くて置いていった数（battle.drop の直後の item.leftBehind）
  dropGold: number; // M14（CB-57）: 直接ドロップの金の合計（battle.dropGold の gold。強欲の SAN は別）
  deaths: DeathRecord[]; // M7-死因: この潜行中に dead になった延べ人数分（全滅の前に死んだ者も、全滅の処理で起こされる者も含む）
  ashInDive: number; // M7-死因: この潜行中に ash になった人数（今の規則では潜行中に灰になる経路は無いので 0 のはず。灰は寺院の蘇生の失敗だけ）
  encounterGroups: Record<string, number>; // M7-死因: 遭遇（encounter イベント）の敵グループの数（monsterId ごと）
  encounterUnits: Record<string, number>; // M7-死因: その体数
  antidotes: number; // M7-解毒: この潜行で戦闘の後に使った解毒草の数
  poisonedAtHome: number; // M7-解毒: 街に着いた時点（救済・蘇生の前）に alive で毒の人数
  cureCount: number; // M7-解毒: 寺院で毒を治した人数（town.temple の cure）
  cureCost: number; // M7-解毒: その費用の合計
  cureUnpaid: number; // M7-解毒: 寺院の治療を払えずに毒のまま残した人数
  shopAntidotes: number; // M7-解毒: 店で買った解毒草の数
  goldBefore: number; // 潜行の前の所持金
  goldAfter: number; // 街の手順をすべて終えた後の所持金
  assetsAfter: number; // 街の手順をすべて終えた後の資産（所持金 + 手持ちの消耗品の購入価格）
  allL2: boolean; // 宿の後に全員が alive かつ L2 以上
  anyL2: boolean; // 宿の後に誰かが L2 以上
  // M9 進行ボット
  dungeonId: string; // 潜ったダンジョン
  deepestFloor: number; // この潜行で到達した最も深い階
  bossFight: boolean; // ボス戦をした
  bossWin: boolean; // ボスを倒した
  bossWipe: boolean; // ボス戦で全滅した
  newMonsterDeaths: number; // 死因が M9・M12 の新しい敵の死者数
  minLevelAfter: number; // 宿の後の全員の最小 level
  levelHeld: boolean; // M12（F10）: 降りる・ボスに挑む条件のうち level を満たさないまま近傍を歩いて帰った（または上限で止まった）
  startMinLevel: number; // M12: 潜行の開始時（入場の直前）の全員の最小 level
  encounterByFloor: Record<string, number>; // M9: 遭遇の敵グループの数（キーは「階:monsterId」。階ごとの倍率用）
  // M9-装備（進行ボットだけ。旧ルートは 0）
  rangedBought: number; // 街で後衛に買い与えた ranged の武器の数
  armorBought: number; // 街で前衛の防具・盾・兜・小手を更新した数
  armorBoughtByLevel: Record<string, number>; // そのうち買った品の Lv（= その時点の流通レベル）ごとの数
  outfitCost: number; // その 2 つの購入の費用の合計
  outfitSoldGold: number; // 外した品を売った収入の合計
  chestImpulse: ChestImpulseTally; // M11: 宝箱の衝動と職業の掛け合いの数
  impulses: Record<string, ImpulseTally>; // M11-EV: イベントの id ごとの衝動判定の数
  chestFlow: ChestFlowTally; // M11 作業 9: 宝箱の経路・作動・操作の数
  // M13（設計書 §2-4。どのボットでも数えるが、判断に使うのは農夫だけ。既存のボットの数字には出さない）
  beats: Beats; // 拍の数（迷宮の分は潜行中、街の分はこの潜行の後の街の手順）
  estDungeonMs: number; // 推定の実時間（迷宮の分。§3）
  estTownMs: number; // 推定の実時間（街の分。§3）
  farmEnd: FarmEnd | null; // 農夫ボットが帰った理由（農夫以外・wipe / cap は null）
  found: FoundTally; // 拾った品（item.found のすべて。宝箱・ボス・直接ドロップ（M14）の品）の種類
  foundRarity: Record<string, number>; // そのうち汎用装備とユニークの希少度ごとの数
  foundGenericByLevel: Record<string, number>; // 汎用装備の Lv ごとの数（触媒になる品の Lv の分布）
  foundCursed: number; // 拾った品のうち呪われた品
  soldUnique: number; // 鑑定済みのユニークを売った数（soldCount に含む）
  soldUniqueGold: number; // その売却収入
  gearLvStart: number; // 潜行の開始時（入場の前）に全員が装備中の汎用装備の Lv の平均（ユニークを除く。無ければ NaN）
  gearUniques: number; // 潜行の開始時に装備中のユニークの数
  enemyLvMean: number; // この潜行の遭遇の敵の level の体数で重み付けした平均（遭遇が無ければ NaN）
  lootEquipped: number; // 街で拾った品を装備した数（農夫の equipLoot）
  netProfit: number; // 純益 = 売却の直後の所持金 − 潜行の前の所持金（農夫だけ。ほかは 0）
  goldAfterSell: number; // 売却の直後の所持金（農夫だけ。ほかは 0）
};

export type CampaignResult = { seed: number; startAssets: number; dives: DiveRecord[]; aborted: boolean };

const key = (p: Pos) => `${p.x},${p.y}`;

/** 消耗品・魔法書の effect.type（武器・防具は null。M7 の B2 から装備は items.json に無い） */
function effectType(itemId: string): string | null {
  return findItem(data, itemId)?.effect.type ?? null;
}

/** 上り階段からの BFS 距離（open / door の辺を通る。下り階段のセルは通らない。M9: avoid の kind のセルは通らない） */
function distancesFrom(f: Floor, from: Pos, avoid: readonly string[] = ["stairsDown"]): Map<string, number> {
  const dist = new Map<string, number>([[key(from), 0]]);
  const queue: Pos[] = [from];
  while (queue.length > 0) {
    const p = queue.shift()!;
    const d = dist.get(key(p))!;
    const c = cellAt(f, p.x, p.y);
    for (const dir of FACINGS) {
      if (!isPassable(edgeOf(c, dir))) continue;
      const q = step(p, dir);
      if (dist.has(key(q)) || avoid.includes(cellAt(f, q.x, q.y).kind)) continue;
      dist.set(key(q), d + 1);
      queue.push(q);
    }
  }
  return dist;
}

/** facing から dir へ向くための旋回（不要なら null） */
function turnFor(facing: Facing, dir: Facing): "left" | "right" | "around" | null {
  if (facing === dir) return null;
  if (turnLeft(facing) === dir) return "left";
  if (turnRight(facing) === dir) return "right";
  if (opposite(facing) === dir) return "around";
  throw new Error("turnFor: unreachable");
}

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
/** 最近傍順位の百分位（p は 0〜100） */
export function percentile(xs: readonly number[], p: number): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]!;
}
export function mean(xs: readonly number[]): number {
  return xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length;
}
export function sum(xs: readonly number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}
export function fmt(x: number): string {
  if (Number.isNaN(x)) return "-";
  const r = Math.round(x * 10) / 10; // 浮動小数の誤差（110/200*100 = 55.00000000000001）で「55.0」にしない
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}
export function pct(n: number, d: number): string {
  return d === 0 ? "-" : `${fmt((n / d) * 100)}%（${n}/${d}）`;
}
/** 死者の階ごとの数（「1 階 3・2 階 1」。死者が無ければ空文字） */
function floorLabel(xs: readonly DeathRecord[]): string {
  const fs = [...new Set(xs.map((x) => x.floor))].sort((a, b) => a - b);
  return fs.map((f) => `${f} 階 ${xs.filter((x) => x.floor === f).length}`).join("・");
}
export function stats(label: string, xs: readonly number[]): string {
  return `${label}（n=${xs.length}）: 平均 ${fmt(mean(xs))} / 中央値 ${fmt(median(xs))} / p10 ${fmt(percentile(xs, 10))} / p90 ${fmt(percentile(xs, 90))}`;
}

/** 資産 = 所持金 + パーティ全員の手持ち（inventory）の消耗品の購入価格（items.json の price）の合計 */
function assetsOf(s: GameState): number {
  let v = s.gold;
  for (const c of s.party)
    for (const id of c.inventory) {
      const it = findItem(data, s.items[id]!.itemId);
      if (it !== null && it.type === "consumable") v += it.price;
    }
  return v;
}

/** M9-装備: 防具・盾・兜・小手の実体の実効の AC（IT-21 の itemPower。オプションは見ない。店の品と初期装備はオプションを持たない） */
function armorAc(inst: ItemInstance): number {
  const p = itemPower(data, inst, findBase(data, inst.itemId)!);
  if (p.kind !== "armor") throw new Error(`armorAc: ${inst.itemId} is a weapon`);
  return p.ac;
}

/** 1 シード分のボット（潜行 × dives） */
export class Campaign {
  state: GameState;
  readonly bot: RngState;
  readonly keys = new Set<string>();
  // 潜行ごとにリセットする
  floor: Floor | null = null;
  near = new Set<string>();
  homeDist = new Map<string, number>();
  battles = 0;
  steps = 0;
  herbs = 0;
  threads = 0;
  homeBattles = 0;
  homeWipe = false;
  aliveAtStart: string[] = [];
  frontDownAtStart = false;
  wiped: PenaltyResult | null = null;
  chests = 0;
  chestsCorridor = 0;
  chestGold = 0;
  chestItems = 0;
  chestLeft = 0;
  dropItems = 0; // M14（CB-57）
  dropLeft = 0; // M14（CB-57）
  dropGold = 0; // M14（CB-57）
  unpaidAtStart = 0;
  deaths: DeathRecord[] = [];
  ashInDive = 0;
  encounterGroups: Record<string, number> = {};
  encounterUnits: Record<string, number> = {};
  antidotes = 0;
  impulses: Record<string, ImpulseTally> = {}; // M11-EV
  chestImpulse: ChestImpulseTally = emptyChestImpulse(); // M11
  chestFlow: ChestFlowTally = emptyChestFlow(); // M11 作業 9
  /**
   * M11 作業 9: 今の箱についてボットが覚えていること（箱が無くなったら null）。inspector は調べた盗賊（未調査は null）、
   * trapGone は罠がもう無いと分かった（作動を見た・chest.disarm.nothing）、disarms はこの箱で解除を送った回数
   */
  chestMemo: { inspector: string | null; trapGone: boolean; disarms: number } | null = null;
  // M9 進行ボット（潜行ごとにリセット）
  floorNo = 1; // floor / homeDist / near を作った階
  deepest = 1;
  encounterByFloor: Record<string, number> = {};
  bossFight = false;
  bossWin = false;
  bossWipe = false;
  dungeonId = "d01"; // M12: この潜行のダンジョン
  levelHeld = false; // M12（F10）
  startMinLevel = 1; // M12
  // M13（設計書 §2-4。潜行ごとにリセット。beats は潜行の後の街の手順の分もこの潜行の記録に入る）
  beats: Beats = emptyBeats();
  farmEnd: FarmEnd | null = null;
  found: FoundTally = { generic: 0, unique: 0, consumable: 0, book: 0 };
  foundRarity: Record<string, number> = {};
  foundGenericByLevel: Record<string, number> = {};
  foundCursed = 0;
  enemyLvSum = 0; // 遭遇の敵の level × 体数の合計
  enemyUnits = 0; // 遭遇の敵の体数の合計
  gearLvStart = NaN;
  gearUniques = 0;
  /**
   * M7-宝箱「蘇生を払えずに潜った」の定義: 直前の街の手順（revive）で、dead の者の寺院の蘇生、または ash の者（蘇生に失敗して灰になった者を含む）の
   * 闇魔術の費用が、その時点の所持金で払えずに（townMenu の affordable が偽で）蘇生しなかった者の id。次の潜行の開始時に、そのうちまだ dead / ash の者が
   * 1 人以上いれば、その潜行を「蘇生を払えずに潜った潜行」として数える。ボットの今の規則では、街の手順の後に dead / ash で残る理由は所持金不足だけ
   * （救済は 1 人だけ受け、残りは revive が払える限り蘇生する）なので、dive() で「開始時の dead / ash の全員がここに入っている」ことを確かめる
   */
  unpaidLeft: string[] = [];
  readonly startAssets: number;

  constructor(readonly seed: number, readonly kind: BotKind, members?: PartySetupMember[]) {
    this.state = newGame(seed, members);
    this.bot = createRng(seed + 20_000);
    this.startAssets = assetsOf(this.state);
  }

  /** execute して、rejected なら例外。state の不変条件（battle.input・dungeon.turn 以外）と文字列キーを検査し、全滅なら PenaltyResult の内訳 = 差分を確かめる */
  run(cmd: Command): GameState {
    const from = this.state;
    const r = execute(from, cmd, data);
    if (r.events[0]?.kind === "rejected") throw new Error(`seed ${this.seed}: ${JSON.stringify(cmd)} rejected: ${JSON.stringify(r.events[0])}`);
    this.countChest(from, r.events);
    this.countDrops(r.events); // M14（CB-57）
    this.countDeaths(from, r.events);
    this.countImpulses(from, r.events);
    this.countChestFlow(cmd, from, r.state, r.events);
    this.countBeats(cmd, from, r.events); // M13
    this.countFound(from, r.state, r.events); // M13
    // 入力を積むだけの battle.input と向きを変えるだけの dungeon.turn は時間の都合で省く（decisions の H9 の行）
    if (cmd.type !== "battle.input" && cmd.type !== "dungeon.turn") expectStateInvariants(r.state);
    expectTallyMatchesEvents(from, r.state, r.events); // TW-35（M12）
    expectKnownStringKeys(r.events);
    for (const e of r.events) if (e.kind === "message") this.keys.add(e.key);
    const w = r.events.find((e): e is Extract<GameEvent, { kind: "wipe" }> => e.kind === "wipe");
    if (w !== undefined) {
      this.wiped = w.penalty;
      this.checkPenalty(from, r.state, w.penalty, r.events);
    }
    this.state = r.state;
    return r.state;
  }

  /**
   * M7-宝箱: chest.open.gold（M11 で battle.chest から替えた。宝箱の中身）とその後の item.found / item.leftBehind（宝箱の品）を数える。
   * 開けるのは別の execute（chest.open）なので、通路かどうかは開ける前の dive.chest の inRoom で見る
   */
  countChest(from: GameState, events: GameEvent[]): void {
    const i = events.findIndex((e) => e.kind === "message" && e.key === "chest.open.gold");
    if (i < 0) return;
    const e = events[i] as Extract<GameEvent, { kind: "message" }>;
    this.chests += 1;
    // M11 作業 9: セルの箱は開ける前の dive.chest の source（衝動で開けたセルの箱は、乗った dungeon.move の同じ execute なので from には無い。
    // そのときは同じ events の chest.found.cell で見る）
    const isCell = from.dive?.chest?.source === "cell" || events.some((x) => x.kind === "message" && x.key === "chest.found.cell");
    if (isCell) this.chestFlow.cellContents += 1;
    // M11（EV-16）: 衝動で開けた箱は勝利と同じ execute で置かれて開くので、from には箱が無い。そのときは勝った戦闘の origin の inRoom で見る
    const origin = from.battle?.origin;
    const inRoom = from.dive?.chest?.inRoom ?? (origin?.kind === "random" ? origin.inRoom : undefined);
    // M11（レビュー A-R5）: chestsCorridor は M7 からの「通路の戦闘の宝箱」の指標なので、ドロップの箱だけ数える（セルの箱は cellContents だけ）
    if (!isCell && inRoom === false) this.chestsCorridor += 1;
    this.chestGold += Number(e.params!["gold"]);
    for (const x of events.slice(i + 1)) {
      if (x.kind !== "message") continue;
      if (x.key === "item.found") this.chestItems += 1;
      else if (x.key === "item.leftBehind") this.chestLeft += 1;
    }
  }

  /**
   * M14（CB-57）: 直接ドロップ。battle.drop の直後の item.found / item.leftBehind（その品）と battle.dropGold の gold を数える。
   * battle.drop は勝利の battle.gold の後・宝箱の判定の前に出るので、chest.open.gold の後の品（countChest）とは重ならない
   */
  countDrops(events: GameEvent[]): void {
    let pending = false;
    for (const e of events) {
      if (e.kind !== "message") continue;
      if (e.key === "battle.drop") pending = true;
      else if (e.key === "battle.dropGold") this.dropGold += Number(e.params!["gold"]);
      else if (pending && e.key === "item.found") {
        this.dropItems += 1;
        pending = false;
      } else if (pending && e.key === "item.leftBehind") {
        this.dropLeft += 1;
        pending = false;
      }
    }
    if (pending) throw new Error(`seed ${this.seed}: battle.drop without item.found / item.leftBehind`);
  }

  /**
   * M13（設計書 §2-4）: 推定の実時間の拍を数える（コマンドの種類と events）。遭遇の敵の level（monsters.json）を体数で重み付けして足す。
   * 数えるだけで、既存のボットの判断・乱数・コマンド列には触れない
   */
  countBeats(cmd: Command, from: GameState, events: GameEvent[]): void {
    const b = this.beats;
    if (cmd.type === "dungeon.move") b.steps += 1;
    else if (cmd.type === "dungeon.turn") b.turns += 1;
    else if (cmd.type === "chest.inspect" || cmd.type === "chest.disarm") b.chestChecks += 1;
    else if (cmd.type === "chest.open") b.chestOpens += 1;
    else if (cmd.type === "dungeon.useItem" && from.items[cmd.itemId]?.itemId === THREAD) b.threads += 1;
    else if (cmd.type === "town.shop" && cmd.action.kind === "identify") b.identifies += 1;
    else if (cmd.type === "town.shop" && cmd.action.kind === "sell") b.sells += 1;
    else if (cmd.type === "town.inn") b.inns += 1;
    for (const e of events) {
      if (e.kind === "encounter") {
        b.encounters += 1;
        for (const g of e.groups) {
          this.enemyLvSum += monsterOf(data, g.monsterId).level * g.count;
          this.enemyUnits += g.count;
        }
      } else if (e.kind === "beat" && e.phase === "declare") b.declares += 1; // M14（CB-55）: 敵は同じグループの連続する個体のまとまりに 1 つ
      else if (e.kind === "battleEnd" && e.result === "win") b.wins += 1;
    }
  }

  /**
   * M13（設計書 §2-4）: item.found（宝箱・ボス・直接ドロップ（M14）の品。IT-54）ごとに、潜行台帳に増えた実体（迷宮の外なら state.items に増えた実体）の
   * 種類・希少度・Lv・呪いを数える。計測なので実体を覗く（ボットの判断には使わない）
   */
  countFound(from: GameState, to: GameState, events: GameEvent[]): void {
    const n = events.filter((e) => e.kind === "message" && e.key === "item.found").length;
    if (n === 0) return;
    let ids: string[];
    if (to.dive !== null) {
      const before = new Set(from.dive?.ledger.items ?? []);
      ids = to.dive.ledger.items.filter((id) => !before.has(id));
    } else ids = Object.keys(to.items).filter((id) => from.items[id] === undefined);
    if (ids.length !== n) throw new Error(`seed ${this.seed}: item.found ${n} but ${ids.length} new instances`);
    for (const id of ids) {
      const inst = to.items[id]!;
      if (inst.cursed) this.foundCursed += 1;
      if (inst.uniqueId !== null) this.found.unique += 1;
      else if (findBase(data, inst.itemId) !== null) {
        this.found.generic += 1;
        this.foundGenericByLevel[inst.level] = (this.foundGenericByLevel[inst.level] ?? 0) + 1;
      } else {
        const t = itemOf(data, inst.itemId).type;
        if (t === "book") this.found.book += 1;
        else this.found.consumable += 1;
        continue;
      }
      this.foundRarity[inst.rarity] = (this.foundRarity[inst.rarity] ?? 0) + 1;
    }
  }

  /** M13: この潜行の迷宮の分の推定の実時間（ms。農夫の帰る判定に使う） */
  estDungeonMs(): number {
    return estDungeonMsOf(this.beats);
  }

  /**
   * M11-EV: eventStarted（衝動判定の後に出る。行動者がいれば actorId）と、その後の event.stop.success をイベントの id ごとに数える。
   * M11（EV-16 / EV-71）: 宝箱を見つけた語り・chestImpulse・その後の event.stop.success・掛け合いの start / fail を chestImpulse に数える
   */
  countImpulses(from: GameState, events: GameEvent[]): void {
    let cur: ImpulseTally | ChestImpulseTally | null = null;
    const ct = this.chestImpulse;
    for (const e of events) {
      if (e.kind === "message" && (e.key === "chest.found.drop" || e.key === "chest.found.cell")) {
        ct.found += 1;
        cur = ct;
        continue;
      }
      if (e.kind === "chestImpulse") {
        ct.impulses += 1;
        continue;
      }
      if (e.kind === "message" && e.key.startsWith("rivalry.")) {
        if (e.key.endsWith(".start")) ct.rivalries += 1;
        else if (e.key.endsWith(".fail")) ct.rivalryFails += 1;
        continue;
      }
      if (e.kind === "eventStarted") {
        const t = (this.impulses[e.eventId] ??= { starts: 0, impulses: 0, stopped: 0, byPersonality: {} });
        t.starts += 1;
        cur = t;
        if (e.actorId === undefined) continue;
        t.impulses += 1;
        const p = from.party.find((c) => c.id === e.actorId)?.personality ?? "none";
        t.byPersonality[p] = (t.byPersonality[p] ?? 0) + 1;
      } else if (cur !== null && e.kind === "message" && e.key === "event.stop.success") cur.stopped += 1;
    }
  }

  /**
   * M11 作業 9: 宝箱の流れ（chestFlow）を数え、ボットの覚え（chestMemo）の trapGone を立てる。作動させた操作は、同じ events の chestTrap より前に
   * chestImpulse があれば impulse、なければ送ったコマンド（chest.inspect / disarm / open）。偽りの名前の数は計測のためだけに to の trapId と比べる
   */
  countChestFlow(cmd: Command, from: GameState, to: GameState, events: GameEvent[]): void {
    const f = this.chestFlow;
    if (cmd.type === "chest.inspect") f.inspects += 1;
    if (cmd.type === "chest.disarm") f.disarms += 1;
    let impulse = false;
    for (const e of events) {
      if (e.kind === "message" && e.key === "chest.found.drop") f.found.drop += 1;
      else if (e.kind === "message" && e.key === "chest.found.cell") f.found.cell += 1;
      else if (e.kind === "chestImpulse") impulse = true;
      else if (e.kind === "chestEnd") f.ends[e.result] += 1;
      else if (e.kind === "chestTrap") {
        f.traps[e.trapId] = (f.traps[e.trapId] ?? 0) + 1;
        const by = impulse ? "impulse" : cmd.type.startsWith("chest.") ? cmd.type.slice("chest.".length) : cmd.type;
        f.trapsBy[by] = (f.trapsBy[by] ?? 0) + 1;
        if (this.chestMemo !== null) this.chestMemo.trapGone = true; // 作動した罠は消える（公開の規則）
      } else if (e.kind === "message" && e.key === "chest.disarm.ok") f.disarmOk += 1;
      else if (e.kind === "message" && e.key === "chest.disarm.wrong") f.disarmWrong += 1;
      else if (e.kind === "message" && e.key === "chest.disarm.nothing" && this.chestMemo !== null) this.chestMemo.trapGone = true;
    }
    if (cmd.type === "chest.inspect" && from.dive?.chest != null) {
      const c = to.dive?.chest ?? null;
      if (c !== null && c.finding !== null && c.finding.trapId !== null && c.finding.trapId !== from.dive.chest.trapId) f.falseNames += 1;
    }
  }

  /**
   * M7-死因: 潜行中（from.dive がある）のコマンドのイベントから、遭遇した敵グループと、味方の死亡（lifeChanged dead）の死因・階・状態異常を数える。
   * 死因は、戦闘中なら直前にその者に命中した attack の actorId（e{g}-{u}）の敵グループの monsterId、戦闘外なら直前の落とし穴の発動（message dungeon.trap.pit）か
   * イベントの開始（eventStarted。選択の保留中なら pendingChoice の eventId）。敵グループは from.battle、無ければ同じコマンドの encounter の groups
   * （CB の不意打ち（surpriseEnemy）では、遭遇した dungeon.move の中で敵が先に攻撃する）の添字で引く。状態異常は from の status に statusChanged を順に当てた、死亡の時点の値
   */
  countDeaths(from: GameState, events: GameEvent[]): void {
    const dive = from.dive;
    if (dive === null) return; // 街（寺院の蘇生の失敗の灰）は数えない
    const status = new Map(from.party.map((c) => [c.id, [...c.status] as string[]]));
    const lastHit = new Map<string, string>(); // 味方の id → 最後に命中した敵の actorId
    let groupIds: string[] | null = from.battle === null ? null : from.battle.groups.map((g) => g.monsterId);
    let field: string | null = from.pendingChoice?.kind === "event" ? `event:${from.pendingChoice.eventId}` : null;
    for (const e of events) {
      if (e.kind === "encounter") {
        groupIds = [];
        for (const g of e.groups) groupIds[g.index] = g.monsterId;
        for (const g of e.groups) {
          this.encounterGroups[g.monsterId] = (this.encounterGroups[g.monsterId] ?? 0) + 1;
          this.encounterUnits[g.monsterId] = (this.encounterUnits[g.monsterId] ?? 0) + g.count;
          const fk = `${dive.floor}:${g.monsterId}`;
          this.encounterByFloor[fk] = (this.encounterByFloor[fk] ?? 0) + 1;
        }
      } else if (e.kind === "statusChanged") {
        const st = status.get(e.id);
        if (st !== undefined) status.set(e.id, e.on ? [...st, e.status] : st.filter((x) => x !== e.status));
      } else if (e.kind === "attack") {
        if (e.hit && status.has(e.targetId)) lastHit.set(e.targetId, e.actorId);
      } else if (e.kind === "message" && e.key === "dungeon.trap.pit") field = "trap:pit";
      else if (e.kind === "eventStarted") field = `event:${e.eventId}`;
      else if (e.kind === "chestTrap") {
        // M11 作業 9: 宝箱の罠（勝利と同じ execute の衝動で開けた箱では、その前の戦闘の命中を死因にしない）
        field = `chestTrap:${e.trapId}`;
        lastHit.clear();
      }
      else if (e.kind === "lifeChanged" && status.has(e.id)) {
        if (e.life === "ash") this.ashInDive += 1;
        if (e.life !== "dead") continue;
        const actor = lastHit.get(e.id);
        let cause: string;
        let monster = false;
        if (groupIds !== null && actor !== undefined) {
          const m = /^e(\d+)-(\d+)$/.exec(actor);
          if (m === null) throw new Error(`seed ${this.seed}: unknown actor ${actor}`);
          const id = groupIds[Number(m[1])];
          if (id === undefined) throw new Error(`seed ${this.seed}: no group for ${actor}`);
          cause = id;
          monster = true;
        } else cause = field ?? "other";
        this.deaths.push({ cause, monster, floor: dive.floor, status: [...status.get(e.id)!] });
      }
    }
  }

  /**
   * wipe では PenaltyResult の内訳 = state の差分（金、失った実体、EXP）。
   * M13: 内訳（performWipe）は全滅の時点の state に対するもので、勝利と同じ execute の衝動で開けた箱の罠で全滅すると（M11 作業 9 の countDeaths と同じ経路）、
   * その戦闘の EXP と金が入った後の値から引かれる。before はコマンド前なので、同じ execute の wipe より前の獲得を足して突き合わせる。
   * 金の獲得は gainGold のメッセージ（battle.gold / battle.dropGold（M14。CB-57）/ chest.open.gold / event.gold）の params.gold の合計（gainGold が足した額そのもの）。
   * EXP の獲得は battle.exp の params.exp（share）× その時点で alive の人数。人数は before の life に、events の lifeChanged（味方の id のもの）を
   * 順に当てて出す（endBattleBody は battleEnd → battle.exp の間に life を変えないので、勝利の時点の alive と同じ）。
   * 獲得が無い従来の経路では、今までの検査（before − after = 内訳）と同じになる
   */
  checkPenalty(before: GameState, after: GameState, p: PenaltyResult, events: GameEvent[]): void {
    const wi = events.findIndex((e) => e.kind === "wipe");
    const life = new Map(before.party.map((c) => [c.id, c.life as string]));
    let goldGained = 0;
    let expGained = 0;
    for (const e of events.slice(0, wi < 0 ? events.length : wi)) {
      if (e.kind === "lifeChanged" && life.has(e.id)) life.set(e.id, e.life);
      else if (e.kind === "message" && (e.key === "battle.gold" || e.key === "battle.dropGold" || e.key === "chest.open.gold" || e.key === "event.gold")) {
        const g = Number(e.params?.["gold"]);
        if (!Number.isSafeInteger(g) || g < 0) throw new Error(`seed ${this.seed}: bad ${e.key} gold ${String(e.params?.["gold"])}`);
        goldGained += g;
      } else if (e.kind === "message" && e.key === "battle.exp") {
        const share = Number(e.params?.["exp"]);
        if (!Number.isSafeInteger(share) || share < 0) throw new Error(`seed ${this.seed}: bad battle.exp ${String(e.params?.["exp"])}`);
        expGained += share * [...life.values()].filter((l) => l === "alive").length;
      }
    }
    expect(before.gold + goldGained - after.gold).toBe(p.ledgerGold + p.goldLost);
    for (const it of p.itemsLost) expect(after.items[it.instanceId]).toBeUndefined();
    for (const id of before.dive!.ledger.items) expect(after.items[id]).toBeUndefined();
    // EXP: 内訳は全員分（並び順）で、after の exp = expBefore − lost。Σ expBefore − Σ before の exp = 同じ execute の獲得
    expect(p.expLost.map((e) => e.id)).toEqual(after.party.map((c) => c.id));
    for (const e of p.expLost) {
      const ch = after.party.find((c) => c.id === e.id);
      if (ch === undefined) throw new Error(`seed ${this.seed}: expLost ${e.id} not in party`);
      expect(ch.exp).toBe(e.expBefore - e.lost);
    }
    const s = (st: GameState) => st.party.reduce((a, c) => a + c.exp, 0);
    expect(p.expLost.reduce((a, e) => a + e.expBefore, 0) - s(before)).toBe(expGained);
    expect(s(before) + expGained - s(after)).toBe(p.expLost.reduce((a, e) => a + e.lost, 0));
  }

  get inDungeon(): boolean {
    return this.state.screen === "dungeon" || this.state.screen === "battle" || this.state.screen === "event";
  }

  /** 戦闘をオートで終わらせる（CB-43 でオートが切れたら入れ直す） */
  fight(): void {
    this.battles += 1;
    let n = 0;
    while (this.state.battle !== null) {
      if (n++ > BATTLE_ROUND_CAP) throw new Error(`seed ${this.seed}: battle did not end`);
      this.run(this.state.battle.auto ? { type: "battle.resolve" } : { type: "battle.auto", on: true });
    }
    this.resolveChest();
    this.cureAfterBattle();
  }

  /**
   * M11（設計書 §8。A3）: 宝箱が残っていて戦闘中でも保留中でもなければ、chestCommand の方針で 1 手ずつ送る。警報で戦闘になれば戦う
   * （fight の中でまた呼ぶ。勝って同じ箱に戻れば、その中で方針を続ける）。箱が無くなったら覚え（chestMemo）を消す。
   * 呼ぶのは fight の後・dungeon.move の後・resolvePending の後の 3 か所と、fight からの再帰
   */
  resolveChest(): void {
    for (let n = 0; ; n++) {
      if (!this.inDungeon || this.state.dive?.chest == null) {
        this.chestMemo = null;
        return;
      }
      if (this.state.battle !== null || this.state.pendingChoice !== null) return;
      if (n > DISARM_TRIES + 10) throw new Error(`seed ${this.seed}: chest did not end`);
      this.run(this.chestCommand());
      if (this.state.battle !== null) this.fight();
    }
  }

  /**
   * M11（設計書 §8。B7）: 宝箱の 1 手。判断に使うのは chestView（finding）・パーティ・告げられた掛け合いの担当（chest.rivalry）・覚え（chestMemo）だけで、
   * dive.chest.trapId は覗かない。
   * 1. 罠がもう無いと分かっている（作動を見た・解除する罠が無かった）なら開ける。
   * 2. 行動可能な盗賊（職業の abilities に disarm）がいなければ開ける。
   * 3. まだ調べていなければ、掛け合いの担当（行動可能な盗賊なら）、いなければ調べる力（chestRate の power。危険度は分からないので 0）が最大の盗賊
   *    （同点は並び順が前）で調べる。
   * 4. 告げられた名前があれば、調べた盗賊（行動できなければ解除の力が最大の盗賊）でその名前を解除する。失敗して作動しなければ再挑戦（DISARM_TRIES 回まで）。
   *    偽りの名前は見分けられないので、そのまま解除する（実プレイと同じ）。
   * 5. それ以外（罠は無さそう・不明・解除の上限）は開ける
   */
  chestCommand(): Command {
    const v = chestView(this.state, data);
    if (v === null) throw new Error(`seed ${this.seed}: chestCommand without chestView`);
    const m = (this.chestMemo ??= { inspector: null, trapGone: false, disarms: 0 });
    if (m.trapGone) return { type: "chest.open" };
    const thieves = this.state.party.filter((c) => canAct(c) && classOf(data, c.classId).abilities.includes("disarm"));
    if (thieves.length === 0) return { type: "chest.open" };
    const best = (kind: "inspect" | "disarm") => {
      let b = thieves[0]!;
      for (const c of thieves) if (chestRate(this.state, data, kind, c, 0).power > chestRate(this.state, data, kind, b, 0).power) b = c;
      return b;
    };
    if (m.inspector === null) {
      const owner = this.state.dive!.chest!.rivalry?.ownerId;
      const ch = thieves.find((c) => c.id === owner) ?? best("inspect");
      m.inspector = ch.id;
      return { type: "chest.inspect", memberId: ch.id };
    }
    const f = v.finding;
    if (f === null || f.trapId === null || m.disarms >= DISARM_TRIES) return { type: "chest.open" };
    const ch = thieves.find((c) => c.id === m.inspector) ?? best("disarm");
    m.disarms += 1;
    return { type: "chest.disarm", memberId: ch.id, trapId: f.trapId };
  }

  /**
   * M7-解毒（2026-10-05 ユーザー指示「戦闘後に毒の者がいれば使う」）: 戦闘が終わって迷宮に戻ったとき（勝利・逃走の後。全滅で街に戻った場合と、
   * 選択の保留中は何もしない）、alive で毒の者が並び順にいる間、行動可能な者（並び順）が持つ解毒草（items.json の antidote_herb）を
   * core の dungeon.useItem でその者に使う。解毒草が無くなれば止める（解毒の呪文はボットは使わない）
   */
  cureAfterBattle(): void {
    for (;;) {
      if (this.state.screen !== "dungeon" || this.state.pendingChoice !== null || this.state.dive?.chest != null) return;
      const target = this.state.party.find((c) => c.life === "alive" && c.status.includes("poison"));
      if (target === undefined) return;
      const menu = fieldItemMenu(this.state, data);
      if (menu === null) return;
      let use: { memberId: string; instanceId: string } | null = null;
      for (const m of menu.members) {
        if (!m.canAct) continue;
        const it = m.items.find((x) => x.usable && x.itemId === ANTIDOTE);
        if (it !== undefined) {
          use = { memberId: m.id, instanceId: it.instanceId };
          break;
        }
      }
      if (use === null) return;
      this.run({ type: "dungeon.useItem", memberId: use.memberId, itemId: use.instanceId, targetId: target.id });
      expect(this.state.party.find((c) => c.id === target.id)!.status).not.toContain("poison");
      this.antidotes += 1;
    }
  }

  /** 前進 1 歩（向きを変えてから）。遭遇したら戦う */
  moveTo(dir: Facing): void {
    const t = turnFor(this.state.dive!.facing, dir);
    if (t !== null) this.run({ type: "dungeon.turn", dir: t });
    if (!this.inDungeon) return; // 旋回でも全滅しうる（行動不能のまま歩いていた場合）
    this.run({ type: "dungeon.move" });
    this.steps += 1;
    if (this.state.battle !== null) this.fight();
    else this.resolveChest();
  }

  /** 戦闘の合間の回復: HP が半分未満の alive の者がいて、行動可能な誰かが heal の品を持つ間、HP 割合が最小の者に使う */
  healBetweenBattles(): void {
    for (;;) {
      if (this.state.screen !== "dungeon" || this.state.pendingChoice !== null || this.state.dive?.chest != null) return;
      const alive = this.state.party.filter((c) => c.life === "alive");
      if (!alive.some((c) => c.hp * 2 < c.hpMax)) return;
      const menu = fieldItemMenu(this.state, data);
      if (menu === null) return;
      let use: { memberId: string; instanceId: string } | null = null;
      for (const m of menu.members) {
        if (!m.canAct) continue;
        const it = m.items.find((x) => x.usable && effectType(x.itemId) === "heal");
        if (it !== undefined) {
          use = { memberId: m.id, instanceId: it.instanceId };
          break;
        }
      }
      if (use === null) return;
      let target = alive[0]!;
      for (const c of alive) if (c.hp / c.hpMax < target.hp / target.hpMax) target = c;
      this.run({ type: "dungeon.useItem", memberId: use.memberId, itemId: use.instanceId, targetId: target.id });
      this.herbs += 1;
    }
  }

  /**
   * 階段付近の歩行: 今のセルから、近傍（near）のセルへ通れる方向を bot で選ぶ。
   * M11（DG-25）: 宝箱の転移の罠で近傍の外に移っていたら、上り階段への BFS の最短（homeDist）で 1 歩戻る
   */
  wanderStep(): void {
    const dive = this.state.dive!;
    if (!this.near.has(key(dive.pos))) {
      this.moveTo(this.stepToward(this.homeDist, "back to near"));
      this.resolvePending("wander");
      return;
    }
    const c = cellAt(this.floor!, dive.pos.x, dive.pos.y);
    const dirs = FACINGS.filter((d) => isPassable(edgeOf(c, d)) && this.near.has(key(step(dive.pos, d))));
    if (dirs.length === 0) throw new Error(`seed ${this.seed}: no way from ${key(dive.pos)}`);
    this.moveTo(dirs[randInt(this.bot, 0, dirs.length - 1)]!);
    this.resolvePending("wander");
  }

  /**
   * 保留中の選択を 1 か所で解決する（無ければ何もしない）。kind stairs は、mode home なら exit（無ければ M9 の ascend）、mode descend（M9: 下り階段へ
   * 向かっている間）なら descend、それ以外は stay。kind teleporter（M9: ボス撃破の後）は teleport。
   * kind trap（DG-21 の察知）は proceed（罠を踏んで進む）、kind event（EV-31 の選択）は先頭の選択肢。選んだ結果で遭遇したら戦う。
   * 旧ルート（d01 の 1 階だけ）では ascend・descend・teleporter の選択は出ないので、M8 までの「goExit なら exit、それ以外は stay」と同じ。
   */
  resolvePending(mode: "wander" | "home" | "descend"): void {
    const pc = this.state.pendingChoice;
    if (pc === null) return;
    const has = (id: string) => pc.options.some((o) => o.id === id);
    let optionId: string;
    if (pc.kind === "trap") optionId = "proceed";
    else if (pc.kind === "event") optionId = pc.options[0]!.id;
    else if (pc.kind === "teleporter") optionId = "teleport";
    else if (mode === "home") optionId = has("exit") ? "exit" : has("ascend") ? "ascend" : "stay";
    else if (mode === "descend") optionId = has("descend") ? "descend" : "stay";
    else optionId = "stay";
    const goldBefore = this.state.gold;
    this.run({ type: "event.choose", optionId });
    if (optionId === "exit" || optionId === "teleport") expect(this.state.gold).toBe(goldBefore); // DG-43
    if (this.state.battle !== null) this.fight();
    this.resolveChest();
  }

  /** 行動可能な者が持つ、使える帰還の品（無ければ null） */
  threadInHand(): { memberId: string; instanceId: string } | null {
    const menu = fieldItemMenu(this.state, data);
    if (menu === null) return null;
    for (const m of menu.members) {
      if (!m.canAct) continue;
      const it = m.items.find((x) => x.usable && effectType(x.itemId) === "return");
      if (it !== undefined) return { memberId: m.id, instanceId: it.instanceId };
    }
    return null;
  }

  /** 帰還: 上り階段の上でなく、帰還の品があれば使う。無ければ合間の回復をしてから BFS の最短で上り階段へ歩いて exit（途中の遭遇も戦う） */
  goHome(): "thread" | "walk" {
    // M9: 2 階以上の上り階段の上では歩いて出られないので糸を使う（旧ルートは 1 階だけなので変わらない）
    const onStairs = this.state.dive!.floor === 1 && this.homeDist.get(key(this.state.dive!.pos)) === 0;
    const t = onStairs ? null : this.threadInHand(); // 上り階段の上なら糸を使わず、1 歩出て戻って exit
    if (t !== null) {
      const goldBefore = this.state.gold;
      this.run({ type: "dungeon.useItem", memberId: t.memberId, itemId: t.instanceId });
      this.threads += 1;
      expect(this.state.gold).toBe(goldBefore); // DG-43
      return "thread";
    }
    this.healBetweenBattles();
    let guard = 0;
    while (this.inDungeon) {
      if (guard++ > 2000) throw new Error(`seed ${this.seed}: walk home did not finish`);
      if (this.state.pendingChoice !== null) {
        this.resolvePending("home");
        continue;
      }
      if (this.state.screen === "battle") {
        this.fight();
        continue;
      }
      if (this.state.dive!.floor !== this.floorNo) this.setFloor(); // M9: ascend の後は上の階の構造で歩く
      this.moveTo(this.stepToward(this.homeDist, "home"));
    }
    return "walk";
  }

  /**
   * dist（目標からの BFS 距離）が今より小さい隣のうち最小の方向。今のセルが dist に無ければ dist にある隣の最小、
   * 今が 0（目標の上）なら dist にある最初の隣（1 歩出て戻る）。どれも無ければ例外（M8 までの goHome の規則をそのまま切り出した）
   */
  stepToward(dist: Map<string, number>, what: string): Facing {
    const dive = this.state.dive!;
    const c = cellAt(this.floor!, dive.pos.x, dive.pos.y);
    const here = dist.get(key(dive.pos));
    let best: Facing | null = null;
    for (const d of FACINGS) {
      if (!isPassable(edgeOf(c, d))) continue;
      const nd = dist.get(key(step(dive.pos, d)));
      if (nd !== undefined && (here === undefined || nd < here) && (best === null || nd < dist.get(key(step(dive.pos, best)))!)) best = d;
    }
    if (best === null && here === 0) {
      for (const d of FACINGS) if (best === null && isPassable(edgeOf(c, d)) && dist.get(key(step(dive.pos, d))) !== undefined) best = d;
    }
    if (best === null) throw new Error(`seed ${this.seed}: no way ${what} from ${key(dive.pos)} on floor ${dive.floor}`);
    return best;
  }

  /**
   * 今の階（dive.floor）の構造・上り階段からの距離・近傍をキャッシュする。構造の辺はこの潜行の間変わらない（罠の発動・イベントの処理は kind だけ）。
   * 下り階段とボスのセルは通らない（M9。旧ルートの d01 の 1 階にボスのセルは無いので M8 までと同じ）
   */
  setFloor(): void {
    const dive = this.state.dive!;
    this.floorNo = dive.floor;
    this.deepest = Math.max(this.deepest, dive.floor);
    this.floor = floorOf(dive, data, dive.floor);
    this.homeDist = distancesFrom(this.floor, this.floor.stairsUp, ["stairsDown", "boss"]);
    this.near = new Set([...this.homeDist].filter(([, d]) => d <= NEAR).map(([k]) => k));
  }

  /** M9: ボスに挑む条件（全員 alive・全員 level ≥ ボスの level（M12: ダンジョンごと）・前衛（frontLineIds）の HP の合計 ≥ 最大の合計の BOSS_FRONT_HP_PCT%） */
  bossReady(): boolean {
    const s = this.state;
    if (!s.party.every((c) => c.life === "alive" && c.level >= levelFor(this.kind, "boss", this.dungeonId))) return false;
    const ids = frontLineIds(s, data);
    const front = s.party.filter((x) => ids.includes(x.id));
    return sum(front.map((x) => x.hp)) * 100 >= sum(front.map((x) => x.hpMax)) * BOSS_FRONT_HP_PCT;
  }

  /**
   * M9: 目標のセルへ BFS の最短で歩く（各歩で遭遇すれば戦い、保留は mode で解決し、歩く前に合間の回復）。迷宮を出た・階が変わった（descend）・
   * 帰る条件・歩数の上限で止まり、その理由を返す。ボスのセル以外が目標なら途中でボスのセルを通らない。
   * ボスのセルに入る歩ではボス戦（bossFight）とその結果（bossWin = 撃破、bossWipe = 全滅）を記録する。勝てばテレポーターの確認を teleport で解決して街へ
   */
  walkTo(target: Pos, mode: "descend" | "wander"): "left" | "floor" | "return" | "cap" {
    const startFloor = this.state.dive!.floor;
    const boss = this.floor!.boss;
    const isBoss = boss !== null && boss.x === target.x && boss.y === target.y;
    const dist = distancesFrom(this.floor!, target, isBoss ? [] : ["boss"]);
    for (;;) {
      if (!this.inDungeon) return "left";
      if (this.state.pendingChoice !== null) {
        this.resolvePending(mode);
        continue;
      }
      if (this.state.screen === "battle") {
        this.fight();
        continue;
      }
      if (this.state.dive!.floor !== startFloor) return "floor";
      if (this.kind.shouldReturn(this)) return "return";
      if (this.steps >= STEP_CAP) return "cap";
      this.healBetweenBattles();
      if (!this.inDungeon || this.state.pendingChoice !== null) continue;
      const dir = this.stepToward(dist, "to target");
      const next = step(this.state.dive!.pos, dir);
      const intoBoss = isBoss && next.x === target.x && next.y === target.y && !this.state.dive!.bossDefeated;
      this.moveTo(dir);
      if (intoBoss) {
        this.bossFight = true;
        this.bossWipe = this.wiped !== null;
        this.bossWin = this.state.dive?.bossDefeated === true;
      }
    }
  }

  /** 1 回の潜行（入場から街に戻るまで）。入れなければ null。M9: dungeonId（旧ルートは d01）。M12: 進行ボットはどのダンジョンでも最下層とボスまで */
  dive(dungeonId = "d01"): Method | null {
    if (townMenu(this.state, data)!.dungeons.find((d) => d.id === dungeonId)?.canEnter !== true) return null;
    this.dungeonId = dungeonId;
    this.levelHeld = false;
    this.startMinLevel = Math.min(...this.state.party.map((c) => c.level));
    this.deepest = 1;
    this.encounterByFloor = {};
    this.bossFight = false;
    this.bossWin = false;
    this.bossWipe = false;
    this.battles = 0;
    this.steps = 0;
    this.herbs = 0;
    this.threads = 0;
    this.homeBattles = 0;
    this.homeWipe = false;
    this.wiped = null;
    this.chests = 0;
    this.chestsCorridor = 0;
    this.chestGold = 0;
    this.chestItems = 0;
    this.chestLeft = 0;
    this.dropItems = 0;
    this.dropLeft = 0;
    this.dropGold = 0;
    this.deaths = [];
    this.ashInDive = 0;
    this.encounterGroups = {};
    this.encounterUnits = {};
    this.antidotes = 0;
    this.impulses = {};
    this.chestImpulse = emptyChestImpulse();
    this.chestFlow = emptyChestFlow();
    this.chestMemo = null;
    // M13
    this.beats = emptyBeats();
    this.farmEnd = null;
    this.found = { generic: 0, unique: 0, consumable: 0, book: 0 };
    this.foundRarity = {};
    this.foundGenericByLevel = {};
    this.foundCursed = 0;
    this.enemyLvSum = 0;
    this.enemyUnits = 0;
    const gearLv: number[] = [];
    this.gearUniques = 0;
    for (const c of this.state.party)
      for (const id of Object.values(c.equipment)) {
        if (id === null) continue;
        const inst = this.state.items[id]!;
        if (inst.uniqueId !== null) this.gearUniques += 1;
        else gearLv.push(inst.level);
      }
    this.gearLvStart = mean(gearLv);
    const down = this.state.party.filter((c) => c.life !== "alive").map((c) => c.id);
    expect(down.filter((id) => !this.unpaidLeft.includes(id))).toEqual([]); // 定義（unpaidLeft）のとおり、残った理由は所持金不足だけ
    this.unpaidAtStart = down.length;
    this.aliveAtStart = this.state.party.filter((c) => c.life === "alive").map((c) => c.id);
    this.frontDownAtStart = this.state.party.slice(0, FRONT_ROW).some((c) => c.life !== "alive");
    this.run({ type: "dungeon.enter", dungeonId });
    // 1 階の構造はこの潜行の間変わらない（罠の発動は kind だけを変え、辺は変えない）ので、潜行ごとにキャッシュする
    this.setFloor();
    const capped = this.kind.route === "progress" ? this.progressDungeon() : this.kind.route === "farm" ? this.farmDungeon() : this.wanderHere() === true;
    if (this.inDungeon) {
      const b0 = this.battles;
      const m = this.goHome();
      this.homeBattles = this.battles - b0;
      this.homeWipe = this.wiped !== null;
      if (this.wiped === null) return capped ? "cap" : m;
    }
    if (this.wiped !== null) return "wipe";
    if (this.bossWin) return "teleport"; // M9: ボスを倒してテレポーターで街へ
    throw new Error(`seed ${this.seed}: left the dungeon without returning or wiping`);
  }

  /**
   * 今の階の上り階段から BFS ≤ NEAR を歩く（M8 までの潜行の本体）。帰る判定は各歩（戦闘・罠を含む）の直後、合間の回復より前。
   * 歩数の上限で止まったら true。M9: 進行ボットでは、歩く間に until（降りる条件・ボスに挑む条件）を満たせば null を返して階段・ボスへ向かわせる
   */
  wanderHere(until?: () => boolean): boolean | null {
    while (this.inDungeon && !this.kind.shouldReturn(this)) {
      if (this.steps >= STEP_CAP) return true;
      this.healBetweenBattles();
      if (!this.inDungeon) break;
      if (until !== undefined && this.state.pendingChoice === null && until()) return null;
      this.wanderStep();
    }
    return false;
  }

  /** M9: 下の階へ降りる条件（全員 alive・全員 level ≥ 降りる level（M12: ダンジョンごと。levelFor）） */
  descendReady(): boolean {
    const lv = levelFor(this.kind, "descend", this.dungeonId);
    return this.state.party.every((c) => c.life === "alive" && c.level >= lv);
  }

  /** M12（F10）: 全員（生死を問わない）の level が which の条件を満たすか */
  levelsOk(which: "descend" | "boss"): boolean {
    const lv = levelFor(this.kind, which, this.dungeonId);
    return this.state.party.every((c) => c.level >= lv);
  }

  /**
   * M9 進行ボット（M12: d01 だけでなく全ダンジョン。最下層は data の floors）: 最下層より上の階は、降りる条件を満たせば下り階段へ最短で歩いて降り、
   * 満たさなければ上り階段の近傍を歩く（途中で満たせば階段へ）。最下層はボスに挑む条件を満たせばボスへ歩いて戦い（勝てば teleport で街へ）、
   * 満たさなければ上り階段の近傍を歩き、途中で満たせばボスへ向かう。歩数の上限で止まったら true。
   * 近傍を歩いたまま帰った（上限で止まった）とき、level の条件を満たしていなければ levelHeld を立てる（F10）
   */
  progressDungeon(): boolean {
    const last = data.dungeons.find((d) => d.id === this.dungeonId)!.floors;
    for (;;) {
      if (!this.inDungeon) return false;
      if (this.state.dive!.floor !== this.floorNo) this.setFloor();
      if (this.floorNo < last) {
        if (!this.descendReady()) {
          const w = this.wanderHere(() => this.descendReady());
          if (w !== null) {
            if (!this.levelsOk("descend")) this.levelHeld = true;
            return w;
          }
        }
        const r = this.walkTo(this.floor!.stairsDown!, "descend");
        if (r === "floor") continue;
        return r === "cap";
      }
      if (!this.bossReady()) {
        const w = this.wanderHere(() => this.bossReady());
        if (w !== null) {
          if (!this.levelsOk("boss")) this.levelHeld = true;
          return w;
        }
      }
      const r = this.walkTo(this.floor!.boss!, "wander");
      return r === "cap";
    }
  }

  /**
   * M13（設計書 §2-2）: 農夫ボット。目標の階（kind.farm.floor）まで下り階段へ最短で歩いて降り（level の条件は見ない）、目標の階では
   * 上り階段から BFS ≤ NEAR を歩く（wanderHere）。帰る判定は kind.shouldReturn（farmShouldReturn）。歩数の上限で止まったら true
   */
  farmDungeon(): boolean {
    const target = this.kind.farm!.floor;
    for (;;) {
      if (!this.inDungeon) return false;
      if (this.state.dive!.floor !== this.floorNo) this.setFloor();
      if (this.floorNo < target) {
        const r = this.walkTo(this.floor!.stairsDown!, "descend");
        if (r === "floor") continue;
        return r === "cap";
      }
      return this.wanderHere() === true;
    }
  }

  /**
   * M13（設計書 §2-1）: 農夫ボットの準備（Campaign の作成の直後、街）。debug.levels（UI-57。能力値は Lv1 のまま、HP・MP・呪文だけ Lv 相応。
   * state.rng を消費する）で kind.farm.level にし、PROGRESS_ROUTE で目標のダンジョンより前のダンジョンを踏破済みにする
   * （combat.ts の初回クリアと同じ 3 点: clearedDungeons・unlockedDungeons・shopLevel。state を直接書く）
   */
  prepareFarm(): void {
    const f = this.kind.farm;
    if (f === undefined) throw new Error("prepareFarm: not a farm bot");
    this.run({ type: "debug.levels", level: f.level });
    const route: readonly string[] = PROGRESS_ROUTE;
    const i = route.indexOf(f.dungeonId);
    if (i < 0) throw new Error(`prepareFarm: ${f.dungeonId} is not in PROGRESS_ROUTE`);
    const p = this.state.progress;
    for (const id of route.slice(0, i)) {
      const d = data.dungeons.find((x) => x.id === id)!;
      if (!p.clearedDungeons.includes(id)) p.clearedDungeons.push(id);
      const next = d.onClear.unlockDungeon;
      if (next !== null && !p.unlockedDungeons.includes(next)) p.unlockedDungeons.push(next);
      p.shopLevel = Math.max(p.shopLevel, d.onClear.shopLevel);
    }
    expectStateInvariants(this.state);
  }

  life(id: string): "alive" | "dead" | "ash" {
    return this.state.party.find((c) => c.id === id)!.life;
  }

  /** 救済の申し出があれば受ける（対象は並び順で最初の dead / ash） */
  mercy(rec: DiveRecord): void {
    const m = townMenu(this.state, data)!.mercy;
    if (m === null || m.length === 0) return;
    const id = m[0]!.memberId;
    const g = this.state.gold;
    this.run({ type: "town.mercy", memberId: id });
    expect(this.state.gold).toBe(g);
    expect(this.life(id)).toBe("alive");
    rec.mercyUsed = true;
  }

  darkIfAffordable(id: string, rec: DiveRecord): void {
    const row = townMenu(this.state, data)!.dark.find((r) => r.memberId === id)!;
    if (!row.affordable) {
      if (!this.unpaidLeft.includes(id)) this.unpaidLeft.push(id); // M7-宝箱: 闇魔術を払えない
      return;
    }
    const g = this.state.gold;
    this.run({ type: "town.dark", memberId: id });
    expect(g - this.state.gold).toBe(row.cost);
    expect(this.life(id)).toBe("alive");
    rec.darkCount += 1;
    rec.darkCost += row.cost;
  }

  /** 寺院: dead を並び順に蘇生（払えるなら。失敗して灰なら払えるなら闇魔術）→ 灰の者を並び順に闇魔術（払えるなら） */
  revive(rec: DiveRecord): void {
    const ids = this.state.party.map((c) => c.id);
    this.unpaidLeft = [];
    for (const id of ids) {
      if (this.life(id) !== "dead") continue;
      const row = townMenu(this.state, data)!.temple.resurrect.find((r) => r.memberId === id)!;
      if (!row.affordable) {
        this.unpaidLeft.push(id); // M7-宝箱: 寺院の蘇生を払えない
        continue;
      }
      const g = this.state.gold;
      this.run({ type: "town.temple", memberId: id, service: "resurrect" });
      expect(g - this.state.gold).toBe(row.cost);
      rec.templeTries += 1;
      rec.templeCost += row.cost;
      if (this.life(id) === "alive") rec.templeOk += 1;
      else this.darkIfAffordable(id, rec);
    }
    for (const id of ids) if (this.life(id) === "ash") this.darkIfAffordable(id, rec);
    this.cureAtTemple(rec);
  }

  /**
   * M7-解毒（2026-10-05 ユーザー指示「寺院でも毒を治す」）: 蘇生と闇魔術の後（死者・灰を戻す方を先に払う）、宿の前に、
   * townMenu の temple.cure の行（alive で毒・麻痺・石化のどれかを持つ者。並び順）のうち毒を持つ者を、払える限り town.temple の cure で治す。
   * 費用は TW-07 の cureCost の合計（毒と麻痺を併せ持つなら両方の分）。払えなければその者は毒のまま（cureUnpaid）。
   * M11 作業 9（設計書 §8）: 宝箱の麻痺ガスで麻痺のまま帰る者がいるので、麻痺の者も治す（cureCount / cureUnpaid に含める）
   */
  cureAtTemple(rec: DiveRecord): void {
    for (const id of this.state.party.map((c) => c.id)) {
      const ch = this.state.party.find((c) => c.id === id)!;
      if (ch.life !== "alive" || !(ch.status.includes("poison") || ch.status.includes("paralysis"))) continue;
      const row = townMenu(this.state, data)!.temple.cure.find((r) => r.memberId === id)!;
      if (!row.affordable) {
        rec.cureUnpaid += 1;
        continue;
      }
      const g = this.state.gold;
      this.run({ type: "town.temple", memberId: id, service: "cure" });
      expect(g - this.state.gold).toBe(row.cost);
      const after = this.state.party.find((c) => c.id === id)!.status;
      expect(after).not.toContain("poison");
      expect(after).not.toContain("paralysis");
      rec.cureCount += 1;
      rec.cureCost += row.cost;
    }
  }

  inn(rec: DiveRecord): void {
    const inn = townMenu(this.state, data)!.inn;
    const rank = inn[INN_RANK]!.affordable ? INN_RANK : inn.findIndex((r) => r.cost === 0);
    rec.innFallback = rank !== INN_RANK;
    const g = this.state.gold;
    this.run({ type: "town.inn", rank });
    rec.innCost = g - this.state.gold;
    expect(rec.innCost).toBe(inn[rank]!.cost);
  }

  /** 1 個買う。持たせるのは空き枠が最も多い alive の者（同数なら並び順）。買えなければ false */
  buy(itemId: string, rec: DiveRecord): boolean {
    const shop = townMenu(this.state, data)!.shop;
    const row = shop.items.find((x) => x.itemId === itemId)!;
    if (!row.affordable) return false;
    let to: { memberId: string; slotsFree: number } | null = null;
    for (const m of shop.members) if (m.slotsFree > 0 && (to === null || m.slotsFree > to.slotsFree)) to = m;
    if (to === null) return false;
    const g = this.state.gold;
    const invBefore = this.state.party.find((c) => c.id === to!.memberId)!.inventory.length;
    this.run({ type: "town.shop", action: { kind: "buy", memberId: to.memberId, itemId } });
    expect(g - this.state.gold).toBe(row.price);
    const inv = this.state.party.find((c) => c.id === to!.memberId)!.inventory;
    expect(inv.length).toBe(invBefore + 1);
    expect(this.state.items[inv[inv.length - 1]!]!.itemId).toBe(itemId);
    rec.shopCost += row.price;
    return true;
  }

  /** 装備品（消耗品・魔法書でない。M7 の B2 から装備は items.json に無いので findItem が null）か */
  isEquipment(instanceId: string): boolean {
    return findItem(data, this.state.items[instanceId]!.itemId) === null;
  }

  /**
   * M7-B / M7-経済（2026-10-05 ユーザー指示）: 拾った装備を売る（街に着いて救済の後、寺院の前）。並び順（life を問わない）× inventory の順に、
   * 装備していない装備品を売る。未鑑定の品は「鑑定後の見込み売値 − 未鑑定売値 > 鑑定料」かつ鑑定料が払えるときだけ店で鑑定してから売り、
   * そうでなければ未鑑定のまま（見た目の品種の売値で）売る。見込み売値はボットが実体を覗いた本当の売値（core の sellPrice）で、
   * プレイヤーには分からない値なので、鑑定の判断としては最良の場合（上限）になる。ユニークも売る（買い戻しはしない）。
   * 初期の所持品は消耗品だけなので、inventory の装備品は宝箱・ボスで拾った品だけ。
   * M13: opts.identify が偽（農夫）なら鑑定せず、今の状態（未鑑定なら見た目の品種の売値）で売る。既存の呼び出しは既定の真
   */
  sellLoot(rec: DiveRecord, opts: { identify: boolean } = { identify: true }): void {
    for (const c of this.state.party.map((x) => x.id)) {
      for (const id of [...this.state.party.find((x) => x.id === c)!.inventory]) {
        if (!this.isEquipment(id)) continue;
        const shop = townMenu(this.state, data)!.shop;
        const inst = this.state.items[id]!;
        let unid = !inst.identified;
        if (unid && opts.identify) {
          const idRow = shop.identify.items.find((x) => x.instanceId === id)!;
          const unidPrice = shop.sellable.find((m) => m.memberId === c)!.items.find((x) => x.instanceId === id)!.price;
          if (sellPrice(inst, data) - unidPrice > idRow.fee && idRow.affordable) {
            const g = this.state.gold;
            this.run({ type: "town.shop", action: { kind: "identify", memberId: c, instanceId: id } });
            expect(g - this.state.gold).toBe(idRow.fee);
            rec.identifyCount += 1;
            rec.identifyCost += idRow.fee;
            unid = false;
          }
        }
        const row = townMenu(this.state, data)!.shop.sellable.find((m) => m.memberId === c)!.items.find((x) => x.instanceId === id)!;
        const g = this.state.gold;
        this.run({ type: "town.shop", action: { kind: "sell", memberId: c, instanceId: id } });
        expect(this.state.gold - g).toBe(row.price);
        rec.soldCount += 1;
        rec.soldGold += row.price;
        if (!unid && inst.uniqueId !== null) {
          rec.soldUnique += 1; // M13（数えるだけ）
          rec.soldUniqueGold += row.price;
        }
        if (unid) {
          rec.soldUnidCount += 1;
          rec.soldUnidGold += row.price;
        }
      }
    }
  }

  /**
   * M13（設計書 §2-3）: 農夫の鑑定。全員の inventory の未鑑定の装備品を、見た目の売値（shop.sellable の price）の高い順
   * （同じなら並び順 × inventory の順）に、払える限り店で鑑定する（払えない品は飛ばして次を見る）
   */
  identifyLoot(rec: DiveRecord): void {
    const shop = townMenu(this.state, data)!.shop;
    const rows = shop.identify.items
      .filter((r) => this.isEquipment(r.instanceId))
      .map((r) => ({ ...r, price: shop.sellable.find((m) => m.memberId === r.memberId)!.items.find((x) => x.instanceId === r.instanceId)!.price }));
    rows.sort((a, b) => b.price - a.price); // 安定ソート
    for (const r of rows) {
      if (this.state.gold < r.fee) continue;
      const g = this.state.gold;
      this.run({ type: "town.shop", action: { kind: "identify", memberId: r.memberId, instanceId: r.instanceId } });
      expect(g - this.state.gold).toBe(r.fee);
      expect(this.state.items[r.instanceId]!.identified).toBe(true);
      rec.identifyCount += 1;
      rec.identifyCost += r.fee;
    }
  }

  /**
   * M13（設計書 §2-3。ボットの方針で、ゲームの規則ではない）: new が cur（null は空の枠）より強いか。武器は caster と reach が同じものだけを比べ、
   * 術者用でなければ ダイスの平均（(min + max) / 2）+ damageBonus（floor(Lv / weaponLvPerDamage)）、術者用は magicPower（+ floor(Lv / casterLvPerPower)）。
   * 防具・盾・兜・小手は実効の AC（armorAc。小さいほど強い）、装飾は Lv。同値なら偽
   */
  stronger(neu: ItemInstance, cur: ItemInstance | null): boolean {
    if (cur === null) return true;
    const base = findBase(data, neu.itemId)!;
    if (base.slot === "weapon") {
      const a = itemPower(data, neu, base);
      const b = itemPower(data, cur, findBase(data, cur.itemId)!);
      if (a.kind !== "weapon" || b.kind !== "weapon") throw new Error("stronger: not a weapon");
      if (a.caster !== b.caster || a.reach !== b.reach) return false;
      if (a.caster) return a.magicPower > b.magicPower;
      const avg = (dice: string, bonus: number) => {
        const r = diceRange(parseDice(dice));
        return (r.min + r.max) / 2 + bonus;
      };
      return avg(a.dice, a.damageBonus) > avg(b.dice, b.damageBonus);
    }
    if (base.slot === "accessory") return neu.level > cur.level;
    return armorAc(neu) < armorAc(cur);
  }

  /**
   * M13（設計書 §2-3）: 農夫の装備の更新。inventory にある鑑定済み・呪われていない・ユニークでない汎用装備を Lv の高い順（同じなら並び順 ×
   * inventory の順）に見て、並び順で最初の「alive・行動可能・職業が使える・その部位の今の品が空か呪われていない・新しい品の方が強い（stronger）」者に
   * 装備させる。持ち主が違えば party.give（相手に空きが無ければその者を飛ばす）の後 party.equip。外した品は inventory に戻る（sellLoot が売る）
   */
  equipLoot(rec: DiveRecord): void {
    const slots = data.config.inventory.slotsPerCharacter;
    const cands: { id: string; level: number }[] = [];
    for (const c of this.state.party)
      for (const id of c.inventory) {
        const inst = this.state.items[id]!;
        if (findBase(data, inst.itemId) !== null && inst.identified && !inst.cursed && inst.uniqueId === null) cands.push({ id, level: inst.level });
      }
    cands.sort((a, b) => b.level - a.level); // 安定ソート
    for (const { id } of cands) {
      const owner = this.state.party.find((c) => c.inventory.includes(id));
      if (owner === undefined) continue;
      const inst = this.state.items[id]!;
      const base = findBase(data, inst.itemId)!;
      for (const ch of this.state.party) {
        if (ch.life !== "alive" || !canAct(ch)) continue;
        if (base.classes.length > 0 && !base.classes.includes(ch.classId)) continue;
        const curId = ch.equipment[base.slot];
        const cur = curId === null ? null : this.state.items[curId]!;
        if (cur !== null && cur.cursed) continue;
        if (!this.stronger(inst, cur)) continue;
        if (ch.id !== owner.id) {
          if (slotsUsed(ch) >= slots) continue;
          this.run({ type: "party.give", memberId: owner.id, instanceId: id, toId: ch.id });
        }
        this.run({ type: "party.equip", memberId: ch.id, instanceId: id });
        expect(this.state.party.find((c) => c.id === ch.id)!.equipment[base.slot]).toBe(id);
        rec.lootEquipped += 1;
        break;
      }
    }
  }

  /** パーティ全体（死者・灰を含む）の手持ちの装備品の数 */
  equipmentInHand(): number {
    return sum(this.state.party.map((c) => c.inventory.filter((id) => this.isEquipment(id)).length));
  }

  /** パーティ全体（死者・灰を含む）の手持ちの薬草の数 */
  herbsInHand(): number {
    return sum(this.state.party.map((c) => c.inventory.filter((id) => this.state.items[id]!.itemId === HERB).length));
  }

  /** M7-解毒: パーティ全体（死者・灰を含む。薬草と同じ数え方）の手持ちの解毒草の数 */
  antidotesInHand(): number {
    return sum(this.state.party.map((c) => c.inventory.filter((id) => this.state.items[id]!.itemId === ANTIDOTE).length));
  }

  /**
   * 店: alive の者が帰還の糸を持っていなければ 1 本（死者・灰の糸は使えないので数えない）、その後パーティ全体の手持ちの薬草が HERB_TARGET になるまで薬草を、
   * その後（M7-解毒）パーティ全体の手持ちの解毒草が ANTIDOTE_TARGET になるまで解毒草を（どれも払える範囲で）。解毒草は今の糸 → 薬草の順の後ろに足した（既存の補充の優先を変えない）
   */
  shop(rec: DiveRecord): void {
    const hasThread = this.state.party.some((c) => c.life === "alive" && c.inventory.some((id) => this.state.items[id]!.itemId === THREAD));
    if (!hasThread && this.buy(THREAD, rec)) rec.shopThreads += 1;
    while (this.herbsInHand() < HERB_TARGET && this.buy(HERB, rec)) rec.shopHerbs += 1;
    while (this.antidotesInHand() < ANTIDOTE_TARGET && this.buy(ANTIDOTE, rec)) rec.shopAntidotes += 1;
  }

  /**
   * M9-装備: 店の装備（流通レベルの汎用ベース）を memberId に買い、装備させ、外した品（あれば）を売る。買えなければ（並んでいない・払えない・
   * 所持枠が無い・装備できない）false で、何もしない。費用は rec.outfitCost、売った額は rec.outfitSoldGold
   */
  buyAndEquip(memberId: string, itemId: string, budget: number, rec: DiveRecord): boolean {
    const shop = townMenu(this.state, data)!.shop;
    const row = shop.equipment.find((x) => x.itemId === itemId);
    const m = shop.members.find((x) => x.memberId === memberId);
    if (row === undefined || m === undefined || m.slotsFree === 0 || row.price > budget || row.price > this.state.gold) return false;
    const ch = this.state.party.find((c) => c.id === memberId)!;
    const base = findBase(data, itemId)!;
    if (!canAct(ch) || (base.classes.length > 0 && !base.classes.includes(ch.classId))) return false;
    const old = ch.equipment[base.slot];
    if (old !== null && this.state.items[old]!.cursed) return false;
    const g = this.state.gold;
    this.run({ type: "town.shop", action: { kind: "buy", memberId, itemId } });
    expect(g - this.state.gold).toBe(row.price);
    rec.outfitCost += row.price;
    const inv = this.state.party.find((c) => c.id === memberId)!.inventory;
    const bought = inv[inv.length - 1]!;
    this.run({ type: "party.equip", memberId, instanceId: bought });
    expect(this.state.party.find((c) => c.id === memberId)!.equipment[base.slot]).toBe(bought);
    if (old !== null) {
      const price = townMenu(this.state, data)!.shop.sellable.find((x) => x.memberId === memberId)!.items.find((x) => x.instanceId === old)!.price;
      const g2 = this.state.gold;
      this.run({ type: "town.shop", action: { kind: "sell", memberId, instanceId: old } });
      expect(this.state.gold - g2).toBe(price);
      rec.outfitSoldGold += price;
    }
    return true;
  }

  /**
   * M9-装備の予備費（ユーザーの判断 1、2026-10-06）: パーティの平均 level で計算した 1 人分の蘇生費 = templeCostPerLevel × 並び 6 人全員（生死を問わない）の
   * 平均 level（小数のまま掛けて切り捨て）。防具の更新にはこれを超える分を回す
   */
  reviveCost(): number {
    const ls = this.state.party.map((c) => c.level);
    return Math.floor((data.config.economy.templeCostPerLevel * sum(ls)) / ls.length);
  }

  /**
   * M9-装備（ユーザー指示）: (1) 後衛（並び FRONT_ROW 以降）の alive・行動可能な者で、武器の reach が ranged でない者に、RANGED_BUY の順で
   * 店に並び職業が使える最初の ranged の武器を 1 本（払える範囲。予備費は取らない）。(2) 所持金 − 予備費（reviveCost）の範囲で、前衛（並び 1〜FRONT_ROW）の
   * alive・行動可能な者の ARMOR_SLOTS を、店の同じ部位で職業が使える品のうち実効の AC（itemPower）が最も低いもの（同じなら安いもの、さらに同じならファイルの順）に替える。
   * 替えるのは「店の Lv（shopLevel）> 今の品の Lv（空の枠は常に真）」かつ「実効の AC が今より下がる」ときだけ。並び順 × 部位の順に 1 周する
   */
  outfit(rec: DiveRecord): void {
    for (const ch of this.state.party.slice(FRONT_ROW)) {
      if (ch.life !== "alive" || !canAct(ch)) continue;
      if (equipStats(this.state, data, ch).reach === "ranged") continue;
      for (const id of RANGED_BUY) {
        if (this.buyAndEquip(ch.id, id, Infinity, rec)) {
          rec.rangedBought += 1;
          break;
        }
      }
    }
    const level = this.state.progress.shopLevel;
    for (const id of this.state.party.slice(0, FRONT_ROW).map((c) => c.id)) {
      for (const slot of ARMOR_SLOTS) {
        const ch = this.state.party.find((c) => c.id === id)!;
        if (ch.life !== "alive" || !canAct(ch)) break;
        const curId = ch.equipment[slot];
        const cur = curId === null ? null : this.state.items[curId]!;
        const curAc = cur === null ? 0 : armorAc(cur);
        if (cur !== null && cur.level >= level) continue;
        let best: { itemId: string; ac: number; price: number } | null = null;
        for (const row of townMenu(this.state, data)!.shop.equipment) {
          const base = findBase(data, row.itemId)!;
          if (base.slot !== slot || (base.classes.length > 0 && !base.classes.includes(ch.classId))) continue;
          const ac = armorAc({ id: "-", itemId: row.itemId, level: row.level, rarity: "normal", options: [], uniqueId: null, identified: true, cursed: false, foundIn: null });
          if (best === null || ac < best.ac || (ac === best.ac && row.price < best.price)) best = { itemId: row.itemId, ac, price: row.price };
        }
        if (best === null || best.ac >= curAc) continue;
        if (this.buyAndEquip(id, best.itemId, this.state.gold - this.reviveCost(), rec)) {
          rec.armorBought += 1;
          rec.armorBoughtByLevel[level] = (rec.armorBoughtByLevel[level] ?? 0) + 1;
        }
      }
    }
  }

  /**
   * 潜行 → 街 を count 回。M9 の進行ボット（route progress）は、M12 から PROGRESS_ROUTE の順にまだ踏破していない最初のダンジョン
   * （どれも踏破済みなら最後の d03）に潜り、d03 に D03_DIVES 回潜ったところで終える（count は潜行の上限）
   */
  campaign(count: number): CampaignResult {
    const dives: DiveRecord[] = [];
    const progress = this.kind.route === "progress";
    const farm = this.kind.route === "farm" ? this.kind.farm! : null; // M13
    const lastId = PROGRESS_ROUTE[PROGRESS_ROUTE.length - 1]!;
    for (let k = 0; k < count; k++) {
      const dungeonId = progress ? (PROGRESS_ROUTE.find((id) => !this.state.progress.clearedDungeons.includes(id)) ?? lastId) : farm !== null ? farm.dungeonId : "d01";
      if (progress && dives.filter((d) => d.dungeonId === lastId).length >= D03_DIVES) break;
      const goldBefore = this.state.gold;
      const method = this.dive(dungeonId);
      if (method === null) return { seed: this.seed, startAssets: this.startAssets, dives, aborted: true };
      expect(this.state.screen).toBe("town");
      const rec: DiveRecord = {
        method,
        battles: this.battles,
        steps: this.steps,
        herbs: this.herbs,
        threads: this.threads,
        homeBattles: this.homeBattles,
        homeWipe: this.homeWipe,
        frontDownAtStart: this.frontDownAtStart,
        unpaidAtStart: this.unpaidAtStart,
        chests: this.chests,
        chestsCorridor: this.chestsCorridor,
        chestGold: this.chestGold,
        chestItems: this.chestItems,
        chestLeft: this.chestLeft,
        dropItems: this.dropItems,
        dropLeft: this.dropLeft,
        dropGold: this.dropGold,
        deaths: this.deaths,
        ashInDive: this.ashInDive,
        encounterGroups: this.encounterGroups,
        encounterUnits: this.encounterUnits,
        antidotes: this.antidotes,
        impulses: this.impulses,
        chestImpulse: this.chestImpulse,
        chestFlow: this.chestFlow,
        poisonedAtHome: this.state.party.filter((c) => c.life === "alive" && c.status.includes("poison")).length,
        cureCount: 0,
        cureCost: 0,
        cureUnpaid: 0,
        shopAntidotes: 0,
        down: this.state.party.filter((c) => c.life !== "alive").length,
        mercyOffered: this.state.townVisit!.mercyOffered,
        mercyUsed: false,
        templeTries: 0,
        templeOk: 0,
        templeCost: 0,
        darkCount: 0,
        darkCost: 0,
        innCost: 0,
        innFallback: false,
        shopThreads: 0,
        shopHerbs: 0,
        shopCost: 0,
        soldCount: 0,
        soldGold: 0,
        identifyCount: 0,
        identifyCost: 0,
        soldUnidCount: 0,
        soldUnidGold: 0,
        unsold: 0,
        goldBefore,
        goldAfter: 0,
        assetsAfter: 0,
        allL2: false,
        anyL2: false,
        dungeonId,
        deepestFloor: this.deepest,
        bossFight: this.bossFight,
        bossWin: this.bossWin,
        bossWipe: this.bossWipe,
        newMonsterDeaths: this.deaths.filter((d) => d.monster && NEW_MONSTERS.includes(d.cause)).length,
        minLevelAfter: 0,
        levelHeld: this.levelHeld,
        startMinLevel: this.startMinLevel,
        encounterByFloor: this.encounterByFloor,
        rangedBought: 0,
        armorBought: 0,
        armorBoughtByLevel: {},
        outfitCost: 0,
        outfitSoldGold: 0,
        beats: this.beats,
        estDungeonMs: 0,
        estTownMs: 0,
        farmEnd: method === "wipe" || method === "cap" ? null : this.farmEnd,
        found: this.found,
        foundRarity: this.foundRarity,
        foundGenericByLevel: this.foundGenericByLevel,
        foundCursed: this.foundCursed,
        soldUnique: 0,
        soldUniqueGold: 0,
        gearLvStart: this.gearLvStart,
        gearUniques: this.gearUniques,
        enemyLvMean: this.enemyUnits === 0 ? NaN : this.enemyLvSum / this.enemyUnits,
        lootEquipped: 0,
        netProfit: 0,
        goldAfterSell: 0,
      };
      rec.estDungeonMs = estDungeonMsOf(rec.beats); // 迷宮の分はここで締める（beats は街の手順の分も続けて数える）
      this.mercy(rec);
      if (farm !== null) {
        // M13（設計書 §2-3）: 農夫の街の手順。救済 → 鑑定 → 装備の更新 → 売却（鑑定しない）→ 寺院 → 宿 → 店の補充（outfit はしない）
        this.identifyLoot(rec);
        this.equipLoot(rec);
        this.sellLoot(rec, { identify: false });
        rec.goldAfterSell = this.state.gold;
        rec.netProfit = this.state.gold - goldBefore;
      } else this.sellLoot(rec);
      this.revive(rec);
      this.inn(rec);
      rec.allL2 = this.state.party.every((c) => c.life === "alive" && c.level >= 2);
      rec.anyL2 = this.state.party.some((c) => c.level >= 2);
      rec.minLevelAfter = Math.min(...this.state.party.map((c) => c.level));
      this.shop(rec);
      if (this.kind.outfit === true) this.outfit(rec); // M9-装備（消耗品の補充の後）
      rec.unsold = this.equipmentInHand();
      rec.estTownMs = estTownMsOf(rec.beats);
      rec.goldAfter = this.state.gold;
      rec.assetsAfter = assetsOf(this.state);
      dives.push(rec);
    }
    return { seed: this.seed, startAssets: this.startAssets, dives, aborted: false };
  }
}

export function report(kind: BotKind, results: CampaignResult[], seeds: number, dives: number): string {
  const lines: string[] = [];
  const all = results.flatMap((r) => r.dives);
  lines.push(
    `H9 再計測【${kind.label}】（${seeds} シード × 潜行 ${dives} 回。d01 の 1 階の上り階段から BFS 距離 ${NEAR} 以内。街: 救済 → 装備の売却（未鑑定は 見込み売値 − 未鑑定売値 > 鑑定料 なら店で鑑定してから、そうでなければ未鑑定のまま）→ 寺院 → 闇魔術 → 寺院の治療（毒・麻痺）→ 相部屋 1 泊 → 店（糸が無ければ 1 本 ${THREAD_PRICE}G、薬草 ${HERB_PRICE}G を手持ち ${HERB_TARGET} 個まで、解毒草 ${ANTIDOTE_PRICE}G を手持ち ${ANTIDOTE_TARGET} 個まで）。戦闘の後に毒の者がいれば解毒草を使う。所持金の初期値 ${START_GOLD}、資産の初期値 ${results[0]?.startAssets ?? "-"}（所持金 + 手持ちの消耗品の購入価格））`,
  );
  lines.push(`打ち切り（行動可能な者がいなくて入れない）: ${results.filter((r) => r.aborted).length} シード`);
  for (let k = 0; k < dives; k++) {
    const ds = results.flatMap((r) => (r.dives[k] === undefined ? [] : [r.dives[k]!]));
    const wipes = ds.filter((d) => d.method === "wipe").length;
    const m = (x: Method) => ds.filter((d) => d.method === x).length;
    const downDist = Array.from({ length: 7 }, (_, n) => `${n}:${ds.filter((d) => d.down === n).length}`).join(" ");
    lines.push(
      `潜行 ${k + 1}: 全滅率 ${pct(wipes, ds.length)} / 帰還 糸 ${m("thread")}・徒歩 ${m("walk")}・上限 ${m("cap")}・全滅 ${wipes} / 戦闘数 平均 ${fmt(mean(ds.map((d) => d.battles)))}・中央値 ${fmt(median(ds.map((d) => d.battles)))}・最大 ${Math.max(...ds.map((d) => d.battles))}・戦闘 0 で帰還 ${ds.filter((d) => d.battles === 0 && d.method !== "wipe").length}（うち開始時に前衛に alive でない者 ${ds.filter((d) => d.battles === 0 && d.method !== "wipe" && d.frontDownAtStart).length}）/ 徒歩の帰り道で戦闘 ${ds.filter((d) => d.homeBattles > 0).length}・そこで全滅 ${ds.filter((d) => d.homeWipe).length} / 薬草 平均 ${fmt(mean(ds.map((d) => d.herbs)))}・糸 ${sum(ds.map((d) => d.threads))} 本`,
    );
    lines.push(`  死者数（潜行の終わり、救済・蘇生の前に alive でない人数）: 平均 ${fmt(mean(ds.map((d) => d.down)))} / 分布 ${downDist}`);
    lines.push(
      `  救済: 申し出 ${ds.filter((d) => d.mercyOffered).length}・受けた ${ds.filter((d) => d.mercyUsed).length} / 寺院 ${sum(ds.map((d) => d.templeTries))} 回（成功 ${sum(ds.map((d) => d.templeOk))}、費用計 ${sum(ds.map((d) => d.templeCost))}）/ 闇魔術 ${sum(ds.map((d) => d.darkCount))} 回（費用計 ${sum(ds.map((d) => d.darkCost))}）/ 宿 費用計 ${sum(ds.map((d) => d.innCost))}・馬小屋 ${ds.filter((d) => d.innFallback).length} / 店 糸 ${sum(ds.map((d) => d.shopThreads))}・薬草 ${sum(ds.map((d) => d.shopHerbs))}・費用計 ${sum(ds.map((d) => d.shopCost))}`,
    );
    lines.push(
      `  売却: 装備 ${sum(ds.map((d) => d.soldCount))} 品（うち未鑑定のまま ${sum(ds.map((d) => d.soldUnidCount))} 品・${sum(ds.map((d) => d.soldUnidGold))}G）・収入計 ${sum(ds.map((d) => d.soldGold))}G（シードあたり平均 ${fmt(mean(ds.map((d) => d.soldGold)))}G）/ 売るための鑑定 ${sum(ds.map((d) => d.identifyCount))} 回・費用計 ${sum(ds.map((d) => d.identifyCost))}G / 売れずに残った装備（街の手順の後）計 ${sum(ds.map((d) => d.unsold))}`,
    );
    lines.push(
      `  宝箱: ${sum(ds.map((d) => d.chests))} 個（うち通路 ${sum(ds.map((d) => d.chestsCorridor))}）・金 計 ${sum(ds.map((d) => d.chestGold))}G・品 ${sum(ds.map((d) => d.chestItems))}（置いていった ${sum(ds.map((d) => d.chestLeft))}）/ 蘇生を払えずに潜った ${ds.filter((d) => d.unpaidAtStart > 0).length} 潜行（残した人数 計 ${sum(ds.map((d) => d.unpaidAtStart))}）`,
    );
    lines.push(`  ${stats("この潜行の所持金の変化（街の手順の後）", ds.map((d) => d.goldAfter - d.goldBefore))}`);
    // 打ち切られたシードは最後の潜行の後の値で据え置く
    const cumA = results.map((r) => (r.dives[Math.min(k, r.dives.length - 1)]?.assetsAfter ?? r.startAssets) - r.startAssets);
    lines.push(`  ${stats(`潜行 1〜${k + 1} の累積（資産。初期の資産からの差）`, cumA)}・黒字 ${cumA.filter((x) => x > 0).length}`);
    const cum = results.map((r) => (r.dives[Math.min(k, r.dives.length - 1)]?.goldAfter ?? START_GOLD) - START_GOLD);
    lines.push(`  （参考）${stats(`潜行 1〜${k + 1} の累積所持金（初期値 ${START_GOLD} からの差）`, cum)}・黒字 ${cum.filter((x) => x > 0).length}`);
  }
  lines.push(`全潜行の全滅率: ${pct(all.filter((d) => d.method === "wipe").length, all.length)}`);
  lines.push(
    `全潜行の売却: 装備 ${sum(all.map((d) => d.soldCount))} 品（うち未鑑定のまま ${sum(all.map((d) => d.soldUnidCount))} 品・${sum(all.map((d) => d.soldUnidGold))}G）・収入計 ${sum(all.map((d) => d.soldGold))}G（シードあたり平均 ${fmt(sum(all.map((d) => d.soldGold)) / results.length)}G）/ 鑑定 ${sum(all.map((d) => d.identifyCount))} 回・費用計 ${sum(all.map((d) => d.identifyCost))}G`,
  );
  lines.push(
    `全潜行の宝箱: ${sum(all.map((d) => d.chests))} 個（うち通路 ${sum(all.map((d) => d.chestsCorridor))}）・金 計 ${sum(all.map((d) => d.chestGold))}G・品 ${sum(all.map((d) => d.chestItems))}（置いていった ${sum(all.map((d) => d.chestLeft))}）/ 蘇生を払えずに潜った ${all.filter((d) => d.unpaidAtStart > 0).length} 潜行（残した人数 計 ${sum(all.map((d) => d.unpaidAtStart))}）`,
  );
  const idx = results.map((r) => r.dives.findIndex((d) => d.allL2));
  const parts = Array.from({ length: dives }, (_, k) => `${k + 1} 回目 ${idx.filter((i) => i === k).length}`);
  parts.push(`未到達 ${idx.filter((i) => i < 0).length}`);
  lines.push(`全員 L2 到達（宿の後、全員 alive かつ L2 以上）の最初の潜行: ${parts.join(" / ")}（3 回目までに ${idx.filter((i) => i >= 0 && i < 3).length}）`);
  const idxAny = results.map((r) => r.dives.findIndex((d) => d.anyL2));
  const partsAny = Array.from({ length: dives }, (_, k) => `${k + 1} 回目 ${idxAny.filter((i) => i === k).length}`);
  partsAny.push(`未到達 ${idxAny.filter((i) => i < 0).length}`);
  lines.push(`（参考）誰か 1 人が L2 の最初の潜行: ${partsAny.join(" / ")}`);
  lines.push(...deathReport(results, dives));
  lines.push(...curingReport(results, dives));
  lines.push(...impulseReport(results.flatMap((r) => r.dives)));
  lines.push(...chestReport("全潜行", all));
  return lines.join("\n");
}

/**
 * M11 作業 9（設計書 §8）: 宝箱の経路別の数・箱の終わり・中身・ボットの操作（調べる・解除）・罠の作動回数（罠別と操作別）・罠による死者。
 * 罠による死者は死因 chestTrap:<id>（countDeaths。全滅の処理で起こされる者も含む）
 */
function chestReport(label: string, ds: readonly DiveRecord[]): string[] {
  const f = emptyChestFlow();
  for (const d of ds) {
    const x = d.chestFlow;
    f.found.drop += x.found.drop;
    f.found.cell += x.found.cell;
    f.ends.opened += x.ends.opened;
    f.ends.left += x.ends.left;
    f.ends.lost += x.ends.lost;
    for (const [id, n] of Object.entries(x.traps)) f.traps[id] = (f.traps[id] ?? 0) + n;
    for (const [id, n] of Object.entries(x.trapsBy)) f.trapsBy[id] = (f.trapsBy[id] ?? 0) + n;
    f.inspects += x.inspects;
    f.disarms += x.disarms;
    f.disarmOk += x.disarmOk;
    f.disarmWrong += x.disarmWrong;
    f.falseNames += x.falseNames;
    f.cellContents += x.cellContents;
  }
  const found = f.found.drop + f.found.cell;
  const fired = sum(Object.values(f.traps));
  const deaths = ds.flatMap((d) => d.deaths).filter((x) => x.cause.startsWith("chestTrap:"));
  const trapIds = data.chestTraps.map((t) => t.id).filter((id) => (f.traps[id] ?? 0) > 0 || deaths.some((x) => x.cause === `chestTrap:${id}`));
  const perTrap = trapIds.map((id) => `${id} ${f.traps[id] ?? 0}（死者 ${deaths.filter((x) => x.cause === `chestTrap:${id}`).length}）`).join("・");
  const by = ["impulse", "inspect", "disarm", "open"].map((k) => `${k} ${f.trapsBy[k] ?? 0}`).join("・");
  return [
    `M11-宝箱【${label}】（${ds.length} 潜行）: 見つけた ${found}（ドロップ ${f.found.drop}・セル ${f.found.cell}）/ 終わり 開けた ${f.ends.opened}・放っておいた ${f.ends.left}・失った ${f.ends.lost} / 中身を得た ${sum(ds.map((d) => d.chests))}（うちセル ${f.cellContents}）/ 調べる ${f.inspects}（偽りの名前 ${f.falseNames}）・解除 ${f.disarms}（成功 ${f.disarmOk}・名前違い ${f.disarmWrong}）`,
    `  罠の作動 計 ${fired}（見つけた箱の ${pct(fired, found)}）: ${perTrap || "-"} / 作動させた操作 ${by} / 罠による死者 ${deaths.length}（潜行中の死者 ${pct(deaths.length, ds.flatMap((d) => d.deaths).length)}）`,
  ];
}

/**
 * M9 進行ボットの集計（2026-10-06 ユーザー指示）: d01 の踏破（潜行回数・ボス戦）、d01 の潜行（踏破まで）の全滅率・死者・敵ごとの死者と倍率（2 階だけの行も）、
 * d02 の潜行 1（各シードの最初の d02）と潜行 2〜3 の全滅率・死者・死因・戦闘数。M9-装備の購入の数（ユーザーの判断 2 で逃走の集計は消した。「飛行で届かなかった回数」は
 * CB-26 の置き換えで battle.outOfReach が無くなったので消した）。
 * M12（設計書 §4-1）: d02 の踏破（シード・潜行回数・ボス戦）と踏破までの潜行、d03 に届いたシード数（分母 n）、d03 の潜行 1〜3 の全滅率（件数/n）・死者
 * （階ごと・死因の倍率・灰）、d03 の潜行 1 の開始時の最小 level、d03 のボス戦（潜行 1〜3 の中）、level の条件で帰った潜行の数（F10）、d03 の宝箱
 */
export function progressReport(results: CampaignResult[], kind: BotKind = PROGRESS_BOT): string {
  const lines: string[] = [];
  const seeds = results.length;
  const lv = (id: string) => `${id} 降りる L${levelFor(kind, "descend", id)}・ボス L${levelFor(kind, "boss", id)}`;
  lines.push(
    `M9-進行【${kind.label}】（${seeds} シード × 最大 ${PROGRESS_DIVES} 潜行。帰る条件はセオリー（8 戦・開始時に alive の者の死亡・前衛の HP 半分）。M12: ${PROGRESS_ROUTE.join(" → ")} の順にまだ踏破していないダンジョンに潜り、${PROGRESS_ROUTE[PROGRESS_ROUTE.length - 1]} に ${D03_DIVES} 潜行したら終える。どのダンジョンも、最下層より上の階は「全員 alive・全員 L（降りる）以上」なら下り階段へ最短で歩いて降り（そうでなければ上り階段から BFS ${NEAR} 以内）、最下層は「全員 alive・全員 L（ボス）以上・前衛の HP ${BOSS_FRONT_HP_PCT}% 以上」ならボスへ、そうでなければ上り階段から BFS ${NEAR} 以内。level の条件【仮】: ${PROGRESS_ROUTE.map(lv).join(" / ")}。M9-装備 ${kind.outfit === true ? `あり（街で後衛に ranged（${RANGED_BUY.join("・")}）、所持金 − 予備費（templeCostPerLevel × 6 人の平均 level の切り捨て）の範囲で前衛の防具を流通レベルの品に。逃げない）` : "なし"}）`,
  );
  lines.push(`目安: d03 の潜行 1 でセオリー（このボット）の全滅率 5% 以下【仮】（件数で見る。境目 4〜7% なら BALANCE_SEEDS=400 で取り直す）`);
  lines.push(`打ち切り（行動可能な者がいなくて入れない）: ${results.filter((r) => r.aborted).length} シード`);
  /** 各シードで dungeonId のボスを初めて倒した潜行の添字（無ければ -1） */
  const clearedAt = (id: string) => results.map((r) => r.dives.findIndex((d) => d.dungeonId === id && d.bossWin));
  /** 各シードの dungeonId の潜行のうち、踏破した潜行まで（踏破していなければ全部） */
  const untilClear = (id: string) => {
    const at = clearedAt(id);
    return results.flatMap((r, i) => r.dives.slice(0, at[i]! >= 0 ? at[i]! + 1 : r.dives.length).filter((d) => d.dungeonId === id));
  };
  const clearLines = (id: string) => {
    const at = clearedAt(id);
    // 踏破までの「その dungeon の」潜行回数（踏破した潜行を含む）
    const n = results.flatMap((r, i) => (at[i]! >= 0 ? [r.dives.slice(0, at[i]! + 1).filter((d) => d.dungeonId === id).length] : []));
    const ds = untilClear(id);
    const fights = ds.filter((d) => d.bossFight);
    const last = data.dungeons.find((d) => d.id === id)!.floors;
    const deep = Array.from({ length: last }, (_, f) => `${f + 1} 階 ${ds.filter((d) => d.deepestFloor === f + 1).length}`).join("・");
    return [
      `${id} の踏破: ${n.length}/${seeds} シード / ${stats(`踏破までの ${id} の潜行回数（踏破した潜行を含む）`, n)}`,
      `${id} のボス戦（踏破まで）: ${fights.length} 回・勝ち ${pct(fights.filter((d) => d.bossWin).length, fights.length)}・ボス戦で全滅 ${fights.filter((d) => d.bossWipe).length} / 最も深い階の潜行の数 ${deep}（計 ${ds.length}）`,
    ];
  };
  const d01 = untilClear("d01");
  lines.push(...clearLines("d01"));
  lines.push(...diveLines("d01 の潜行（踏破まで）", d01, 2));
  lines.push(...clearLines("d02"));
  const d02 = untilClear("d02");
  lines.push(...diveLines("d02 の潜行（踏破まで）", d02));
  /** 各シードの dungeonId の k 番目の潜行 */
  const nth = (id: string, k: number) =>
    results.flatMap((r) => {
      const d = r.dives.filter((x) => x.dungeonId === id)[k];
      return d === undefined ? [] : [d];
    });
  for (const k of [0, 1, 2]) {
    const ds = nth("d02", k);
    lines.push(...diveLines(`d02 の潜行 ${k + 1}`, ds));
    if (k === 0 && ds.length > 0) lines.push(`  ${stats("d02 の潜行 1 の開始時（直前の宿の後）の最小 level", ds.map((d) => d.startMinLevel))}`);
  }
  // M12: d03（分母 n は d03 に 1 回でも潜ったシードの数）
  const reached = results.filter((r) => r.dives.some((d) => d.dungeonId === "d03")).length;
  lines.push(`d03 に届いたシード: ${reached}/${seeds}（上限 ${PROGRESS_DIVES} 潜行までに届かなかった ${seeds - reached}）`);
  const d03 = results.flatMap((r) => r.dives.filter((d) => d.dungeonId === "d03"));
  for (const k of [0, 1, 2]) {
    const ds = nth("d03", k);
    lines.push(...diveLines(`d03 の潜行 ${k + 1}`, ds));
    if (k === 0 && ds.length > 0) lines.push(`  ${stats("d03 の潜行 1 の開始時（直前の宿の後）の最小 level", ds.map((d) => d.startMinLevel))}`);
  }
  const fights = d03.filter((d) => d.bossFight);
  lines.push(
    `d03 のボス戦（潜行 1〜${D03_DIVES} の中）: ${fights.length} 回・勝ち ${pct(fights.filter((d) => d.bossWin).length, fights.length)}・ボス戦で全滅 ${fights.filter((d) => d.bossWipe).length} / d03 を踏破したシード ${clearedAt("d03").filter((i) => i >= 0).length}/${reached} / 最も深い階の潜行の数 ${Array.from({ length: data.dungeons.find((d) => d.id === "d03")!.floors }, (_, f) => `${f + 1} 階 ${d03.filter((d) => d.deepestFloor === f + 1).length}`).join("・")}（計 ${d03.length}）`,
  );
  lines.push(
    `level の条件（F10）で降りずに・ボスに挑まずに帰った潜行: ${PROGRESS_ROUTE.map((id) => {
      const ds = results.flatMap((r) => r.dives.filter((d) => d.dungeonId === id));
      return `${id} ${ds.filter((d) => d.levelHeld).length}/${ds.length}`;
    }).join(" / ")}`,
  );
  lines.push(...impulseReport(results.flatMap((r) => r.dives)));
  lines.push(...chestReport("d01 の潜行（踏破まで）", d01));
  lines.push(...chestReport("d02 の潜行", results.flatMap((r) => r.dives.filter((d) => d.dungeonId === "d02"))));
  lines.push(...chestReport("d03 の潜行", d03));
  return lines.join("\n");
}

/** M9-装備: 防具の更新で買った品の Lv ごとの数（「Lv0 12・Lv2 3」。無ければ空文字） */
function byLevel(ds: readonly DiveRecord[]): string {
  const t: Record<string, number> = {};
  for (const d of ds) for (const [lv, n] of Object.entries(d.armorBoughtByLevel)) t[lv] = (t[lv] ?? 0) + n;
  return Object.keys(t)
    .sort((a, b) => Number(a) - Number(b))
    .map((lv) => `Lv${lv} ${t[lv]}`)
    .join("・");
}

/**
 * M9: 潜行の集まり ds の全滅率・帰り方・死者・戦闘数・死因（敵ごと・敵以外）と、M9-装備の購入。
 * 死因の「倍率」は deathReport と同じ式（その敵による死者 ÷ 敵による死者の合計）÷（その敵の遭遇グループ ÷ 遭遇グループの合計）。
 * floor を渡すとその階の死者と遭遇だけで死因の行をもう 1 つ出す
 */
function diveLines(label: string, ds: readonly DiveRecord[], floor?: number): string[] {
  const lines: string[] = [];
  const m = (x: Method) => ds.filter((d) => d.method === x).length;
  const deaths = ds.flatMap((d) => d.deaths);
  lines.push(
    `${label}: ${ds.length} 潜行 / 全滅率 ${pct(m("wipe"), ds.length)} / 帰還 糸 ${m("thread")}・徒歩 ${m("walk")}・テレポーター ${m("teleport")}・上限 ${m("cap")} / 1 潜行あたりの死者 ${fmt(mean(ds.map((d) => d.deaths.length)))}（計 ${deaths.length}。うち M9・M12 の敵 ${sum(ds.map((d) => d.newMonsterDeaths))}。階ごと ${floorLabel(deaths) || "-"}）/ 灰（この潜行の後の寺院の蘇生の失敗）${sum(ds.map((d) => d.templeTries - d.templeOk))} / 潜行の終わりに alive でない人数 平均 ${fmt(mean(ds.map((d) => d.down)))} / 戦闘数 平均 ${fmt(mean(ds.map((d) => d.battles)))}・中央値 ${fmt(median(ds.map((d) => d.battles)))}`,
  );
  lines.push(
    `  M9-装備: この潜行の後の街で ranged を買った ${sum(ds.map((d) => d.rangedBought))} 本・前衛の防具の更新 ${sum(ds.map((d) => d.armorBought))} 品（買った品の Lv ごと ${byLevel(ds) || "-"}。費用計 ${sum(ds.map((d) => d.outfitCost))}G、外した品の売却 ${sum(ds.map((d) => d.outfitSoldGold))}G）`,
  );
  const causeLine = (title: string, dd: readonly DeathRecord[], groups: Record<string, number>) => {
    const byEnemy = dd.filter((x) => x.monster).length;
    const total = sum(Object.values(groups));
    const causes = [...new Set([...Object.keys(groups), ...dd.map((x) => x.cause)])].sort(
      (a, b) => dd.filter((x) => x.cause === b).length - dd.filter((x) => x.cause === a).length || a.localeCompare(b),
    );
    const parts = causes.map((c) => {
      const n = dd.filter((x) => x.cause === c).length;
      const g = groups[c] ?? 0;
      const ratio = g === 0 || byEnemy === 0 || !dd.some((x) => x.cause === c && x.monster) ? "" : `・倍率 ${fmt(n / byEnemy / (g / total))}`;
      return `${c}${monsterMark(c)} ${n}（遭遇 ${g}${ratio}）`;
    });
    if (parts.length > 0) lines.push(`  ${title}（死者・遭遇のグループ数・倍率。* は M9・** は M12 の敵。遭遇グループ 計 ${total}・敵による死者 計 ${byEnemy}）: ${parts.join(" / ")}`);
  };
  const groups: Record<string, number> = {};
  for (const d of ds) for (const [id, n] of Object.entries(d.encounterGroups)) groups[id] = (groups[id] ?? 0) + n;
  causeLine("死因", deaths, groups);
  if (floor !== undefined) {
    const fg: Record<string, number> = {};
    for (const d of ds)
      for (const [k, n] of Object.entries(d.encounterByFloor)) {
        const [f, id] = k.split(":") as [string, string];
        if (Number(f) === floor) fg[id] = (fg[id] ?? 0) + n;
      }
    causeLine(`${floor} 階だけの死因`, deaths.filter((x) => x.floor === floor), fg);
  }
  return lines;
}

/**
 * M11-EV（2026-10-08 ユーザー指示）: イベントごとの衝動の発生率（衝動 ÷ イベントの開始）と制止の数、行動者の性格の内訳。
 * イベントの開始は衝動判定の回数（EV-10〜14 の確率型。対象者の能力値・SAN はその時点の値なので、式の初期値の確率とは成長や錯乱でずれる）
 */
function impulseReport(ds: readonly DiveRecord[]): string[] {
  const t: Record<string, ImpulseTally> = {};
  for (const d of ds)
    for (const [id, x] of Object.entries(d.impulses)) {
      const a = (t[id] ??= { starts: 0, impulses: 0, stopped: 0, byPersonality: {} });
      a.starts += x.starts;
      a.impulses += x.impulses;
      a.stopped += x.stopped;
      for (const [p, n] of Object.entries(x.byPersonality)) a.byPersonality[p] = (a.byPersonality[p] ?? 0) + n;
    }
  const ids = data.events.map((e) => e.id).filter((id) => t[id] !== undefined);
  const lines = ["M11-EV: イベントの衝動（衝動 / イベントの開始 = 発生率。制止はそのうち制止に成功した数。行動者の性格）"];
  const all = { starts: 0, impulses: 0, stopped: 0 };
  for (const id of ids) {
    const x = t[id]!;
    all.starts += x.starts;
    all.impulses += x.impulses;
    all.stopped += x.stopped;
    const by = Object.entries(x.byPersonality)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([p, n]) => `${p} ${n}`)
      .join("・");
    lines.push(`  ${id}: 衝動 ${pct(x.impulses, x.starts)}・制止 ${x.stopped}（衝動の ${pct(x.stopped, x.impulses)}）/ 行動者 ${by || "-"}`);
  }
  lines.push(`  計: 衝動 ${pct(all.impulses, all.starts)}・制止 ${all.stopped}`);
  // M11（U-5）: 宝箱あたりの衝動の割合（目安は既定の編成で 30% 以下）と、職業の掛け合い
  const c = emptyChestImpulse();
  for (const d of ds) for (const k of Object.keys(c) as (keyof ChestImpulseTally)[]) c[k] += d.chestImpulse[k];
  lines.push(
    `  宝箱: 衝動 ${pct(c.impulses, c.found)}・制止 ${c.stopped}（衝動の ${pct(c.stopped, c.impulses)}）・開けてしまった ${pct(c.impulses - c.stopped, c.found)} / 掛け合い ${pct(c.rivalries, c.found)}・担当の失敗 ${c.rivalryFails}`,
  );
  return lines;
}

/** M7-解毒（2026-10-05 ユーザー指示）: 解毒草・寺院の治療と、灰になった人数・闇魔術で戻した人数。既存の出力の後ろに足す */
function curingReport(results: CampaignResult[], dives: number): string[] {
  const lines: string[] = [];
  const line = (label: string, ds: DiveRecord[]) => {
    const ash = sum(ds.map((d) => d.templeTries - d.templeOk)) + sum(ds.map((d) => d.ashInDive));
    return `  ${label}: 解毒草 使用 ${sum(ds.map((d) => d.antidotes))}・店で買った ${sum(ds.map((d) => d.shopAntidotes))} / 街に着いた時点で毒 ${sum(ds.map((d) => d.poisonedAtHome))} 人・寺院の治療 ${sum(ds.map((d) => d.cureCount))} 人（費用計 ${sum(ds.map((d) => d.cureCost))}G）・払えず毒のまま ${sum(ds.map((d) => d.cureUnpaid))} 人 / 灰になった ${ash} 人（寺院の蘇生の失敗 ${sum(ds.map((d) => d.templeTries - d.templeOk))}・潜行中 ${sum(ds.map((d) => d.ashInDive))}）・闇魔術で戻した ${sum(ds.map((d) => d.darkCount))} 人（費用計 ${sum(ds.map((d) => d.darkCost))}G）`;
  };
  lines.push("M7-解毒: 解毒草と寺院の治療、灰と闇魔術");
  for (let k = 0; k < dives; k++) lines.push(line(`潜行 ${k + 1}`, results.flatMap((r) => (r.dives[k] === undefined ? [] : [r.dives[k]!]))));
  lines.push(line("全潜行", results.flatMap((r) => r.dives)));
  return lines;
}

/** M7-死因（2026-10-05 ユーザー指示）: 1 潜行あたりの死者数と、死因（敵の種類・階・状態異常の有無）の内訳。既存の出力の後ろに足す */
function deathReport(results: CampaignResult[], dives: number): string[] {
  const lines: string[] = [];
  const all = results.flatMap((r) => r.dives);
  const deaths = all.flatMap((d) => d.deaths);
  const dist = (ds: DiveRecord[]) => {
    const max = Math.max(0, ...ds.map((d) => d.deaths.length));
    return Array.from({ length: max + 1 }, (_, n) => `${n}:${ds.filter((d) => d.deaths.length === n).length}`).join(" ");
  };
  lines.push(`M7-死因: 潜行中に dead になった延べ人数（全滅の処理で起こされる者も含む。潜行中に ash になった人数 計 ${sum(all.map((d) => d.ashInDive))}）`);
  for (let k = 0; k < dives; k++) {
    const ds = results.flatMap((r) => (r.dives[k] === undefined ? [] : [r.dives[k]!]));
    const wiped = ds.filter((d) => d.method === "wipe");
    const rest = ds.filter((d) => d.method !== "wipe");
    lines.push(
      `  潜行 ${k + 1}: 死者 計 ${sum(ds.map((d) => d.deaths.length))}・1 潜行あたり 平均 ${fmt(mean(ds.map((d) => d.deaths.length)))}（全滅の潜行を除く ${fmt(mean(rest.map((d) => d.deaths.length)))}、全滅の潜行 ${fmt(mean(wiped.map((d) => d.deaths.length)))}）/ 分布 ${dist(ds)}`,
    );
  }
  const rest = all.filter((d) => d.method !== "wipe");
  lines.push(
    `  全潜行: 死者 計 ${deaths.length}・1 潜行あたり 平均 ${fmt(mean(all.map((d) => d.deaths.length)))}（全滅の潜行を除く ${fmt(mean(rest.map((d) => d.deaths.length)))}）/ 分布 ${dist(all)} / 寺院の蘇生の失敗で灰 計 ${sum(all.map((d) => d.templeTries - d.templeOk))}`,
  );
  const statusLabel = (xs: readonly DeathRecord[]) => {
    const withSt = xs.filter((x) => x.status.length > 0).length;
    const per = ["poison", "paralysis", "sleep", "stone"].map((s) => `${s} ${xs.filter((x) => x.status.includes(s)).length}`).join("・");
    return `状態異常あり ${pct(withSt, xs.length)}（${per}）`;
  };
  const groups: Record<string, number> = {};
  const units: Record<string, number> = {};
  for (const d of all) {
    for (const [m, n] of Object.entries(d.encounterGroups)) groups[m] = (groups[m] ?? 0) + n;
    for (const [m, n] of Object.entries(d.encounterUnits)) units[m] = (units[m] ?? 0) + n;
  }
  const totalGroups = sum(Object.values(groups));
  const byEnemy = deaths.filter((x) => x.monster);
  lines.push(
    `  死因: 敵 ${pct(byEnemy.length, deaths.length)}・敵以外 ${deaths.length - byEnemy.length} / 全体の ${statusLabel(deaths)} / 階 ${floorLabel(deaths)} / 遭遇の敵グループ 計 ${totalGroups}（体数 計 ${sum(Object.values(units))}）`,
  );
  const monsterIds = [...new Set([...Object.keys(groups), ...byEnemy.map((x) => x.cause)])].sort(
    (a, b) => byEnemy.filter((x) => x.cause === b).length - byEnemy.filter((x) => x.cause === a).length || a.localeCompare(b),
  );
  for (const m of monsterIds) {
    const xs = byEnemy.filter((x) => x.cause === m);
    const dShare = byEnemy.length === 0 ? NaN : xs.length / byEnemy.length;
    const gShare = totalGroups === 0 ? NaN : (groups[m] ?? 0) / totalGroups;
    lines.push(
      `    ${m}: 死者 ${xs.length}（敵による死者の ${fmt(dShare * 100)}%）/ 遭遇 ${groups[m] ?? 0} グループ（${fmt(gShare * 100)}%）・${units[m] ?? 0} 体 / 死者の割合 ÷ 遭遇の割合 ${fmt(dShare / gShare)} / 1 グループあたりの死者 ${fmt(xs.length / (groups[m] ?? 0))} / ${statusLabel(xs)} / 階 ${floorLabel(xs) || "-"}`,
    );
  }
  for (const c of [...new Set(deaths.filter((x) => !x.monster).map((x) => x.cause))].sort()) {
    const xs = deaths.filter((x) => x.cause === c);
    lines.push(`    （敵以外）${c}: 死者 ${xs.length}（全死者の ${fmt((xs.length / deaths.length) * 100)}%）/ ${statusLabel(xs)} / 階 ${floorLabel(xs)}`);
  }
  return lines;
}

/**
 * seeds 個のシード（1 から）で kind のボットを count 回ずつ潜らせ、各シードの最後の state の不変条件を確かめる。出たメッセージのキーの和集合も返す。
 * members を省くと newGame の既定の編成（defaultMembers()）。
 */
export function runCampaigns(
  kind: BotKind,
  seeds: number,
  count: number,
  members?: PartySetupMember[],
): { results: CampaignResult[]; keys: Set<string> } {
  const results: CampaignResult[] = [];
  const keys = new Set<string>();
  for (let seed = 1; seed <= seeds; seed++) {
    const c = new Campaign(seed, kind, members);
    if (kind.farm !== undefined) c.prepareFarm(); // M13
    const r = c.campaign(count);
    expect(c.state.screen).toBe("town");
    expectStateInvariants(c.state);
    for (const k of c.keys) keys.add(k);
    results.push(r);
  }
  return { results, keys };
}
