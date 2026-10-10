// 潜行中のルール（DG-03, DG-10〜14, DG-20〜22, DG-31〜33, DG-40, CB-01, CH-43/45/51/54）と、表示層向けの問い合わせ（visibleCells, mapView）。
// 迷宮の構造は state に入れず、dive.diveSeed から毎回作り直す（DG-03）。発動済みの罠は dive の記録を重ねる。扉は通り抜けても扉のまま（DG-10）。
import type { GameData } from "../data/index";
import { chance, nextUint32, randInt } from "../rng";
import { dungeonOf, moraleOf, personalityOf } from "../state";
import type {
  Cell,
  Dive,
  Facing,
  Floor,
  GameState,
  MapCell,
  MapCellKind,
  MapView,
  Pos,
  RuleContext,
  ViewPoint,
  VisibleCell,
} from "../types";
import {
  cellAt,
  edgeOf,
  FACINGS,
  generateFloor,
  idx,
  inBounds,
  isPassable,
  opposite,
  step,
  turnLeft,
  turnRight,
} from "./dungeon-gen";
import { chestGenOf, floorOf, markExplored, visibleCellsOf } from "./floor";
import { startAlarmEncounter, startBossEncounter, startRandomEncounter, tickPoisonStep } from "./combat";
import { findCellChest } from "./chest";
import { canAct } from "./combat-calc";
import { offerExit, offerStairs, offerTeleporter, offerTrap } from "./choices";
import { equipStats } from "./equip-stats";
import { chooseEventOption, startEvent } from "./events";
import { addIndex, aliveMembers, damageMembers, removeIndex } from "./field";
import { tellHintOnce } from "./hints";
import { bumpTally } from "./progress";
import { loseSan } from "./san";
import { enterBlockReason, returnToTown } from "./town";

// M11 の作業 5: floorOf・visibleCellsOf・markExplored は floor.ts に移した（chest.ts の転移が使うため）。既存の import の先を変えないよう再び export する
export { chestGenOf, floorOf, markExplored, visibleCellsOf };

/** DG-12。dive が null なら []。at を省くと dive の現在値。奥行きは config.dungeon.viewDepth */
export function visibleCells(state: GameState, data: GameData, at?: ViewPoint): VisibleCell[] {
  const dive = state.dive;
  if (dive === null) return [];
  const vp: ViewPoint = at ?? { floor: dive.floor, pos: dive.pos, facing: dive.facing };
  const f = floorOf(dive, data, vp.floor);
  return visibleCellsOf(f, vp.pos, vp.facing, data.config.dungeon.viewDepth);
}

/**
 * DG-12 / UI-20（M5.5）: 視野（visibleCells と同じ視点・奥行き）のうち、dive.knownTraps[その階] にあるセルの {depth, lane}（visibleCells の順）。
 * dive が null なら []。visibleCells は今どおり罠を返さない（察知した罠だけをこの別の問い合わせで返す）
 */
export function visibleKnownTraps(
  state: GameState,
  data: GameData,
  at?: ViewPoint,
): { depth: number; lane: -1 | 0 | 1 }[] {
  const dive = state.dive;
  if (dive === null) return [];
  const vp: ViewPoint = at ?? { floor: dive.floor, pos: dive.pos, facing: dive.facing };
  const known = dive.knownTraps[String(vp.floor)] ?? [];
  if (known.length === 0) return [];
  const f = floorOf(dive, data, vp.floor);
  return visibleCellsOf(f, vp.pos, vp.facing, data.config.dungeon.viewDepth)
    .filter((v) => known.includes(idx(f, v.x, v.y)))
    .map((v) => ({ depth: v.depth, lane: v.lane }));
}

/**
 * DG-12 / UI-72（M11）: 視野（visibleCells と同じ視点・奥行き）のうち、実効のセルの kind が chest（開ける前の宝箱のセル。DG-23）の {depth, lane}
 * （visibleCells の順）。dive が null なら []。宝箱は隠れた仕掛けではないので視野に出す（罠の有無は返さない）。
 * visibleKnownTraps と同じく visibleCells とは別の問い合わせにする（VisibleCell の形は変えない）
 */
export function visibleChests(state: GameState, data: GameData, at?: ViewPoint): { depth: number; lane: -1 | 0 | 1 }[] {
  const dive = state.dive;
  if (dive === null) return [];
  const vp: ViewPoint = at ?? { floor: dive.floor, pos: dive.pos, facing: dive.facing };
  const f = floorOf(dive, data, vp.floor);
  return visibleCellsOf(f, vp.pos, vp.facing, data.config.dungeon.viewDepth)
    .filter((v) => cellAt(f, v.x, v.y).kind === "chest")
    .map((v) => ({ depth: v.depth, lane: v.lane }));
}

/**
 * DG-13 / UI-24。探索済みセルだけを、実効の 4 辺で返す。記号は上り・下り階段と、察知した罠（knownTraps にあり、
 * 実効のセルの kind が trap のもの。M5.5）と、開ける前の宝箱のセル（実効のセルの kind が chest。M11 の DG-13 改）。dive が null なら null
 */
export function mapView(state: GameState, data: GameData): MapView | null {
  const dive = state.dive;
  if (dive === null) return null;
  const f = floorOf(dive, data);
  const known = dive.knownTraps[String(dive.floor)] ?? [];
  const cells: MapCell[] = [];
  for (const i of dive.explored[String(dive.floor)] ?? []) {
    const x = i % f.width;
    const y = (i - x) / f.width;
    const c = cellAt(f, x, y);
    const kind: MapCellKind =
      c.kind === "stairsUp"
        ? "stairsUp"
        : c.kind === "stairsDown"
          ? "stairsDown"
          : c.kind === "trap" && known.includes(i)
            ? "trap"
            : c.kind === "chest"
              ? "chest"
              : "plain";
    cells.push({ x, y, kind, n: c.n, e: c.e, s: c.s, w: c.w });
  }
  return {
    dungeonId: dive.dungeonId,
    floor: dive.floor,
    width: f.width,
    height: f.height,
    pos: { x: dive.pos.x, y: dive.pos.y },
    facing: dive.facing,
    cells,
  };
}

/**
 * UI-57（開発用、M5）: debug.warp の行き先。dive.floor の実効の構造（floorOf。処理済みのイベント・発動済みの罠は消えている）で、
 * 目標のセルを添字順に、各セルについて FACINGS（N,E,S,W）の順に隣 n = step(セル, d) を見て、盤内・n の kind が corridor か room・
 * セルの辺 d が通れるものを探し、最初の { pos: n, facing: opposite(d) } を返す。無ければ null。
 * 目標: event は kind event かつ eventId 非 null、trap は kind trap かつ trapId が pit / spinner、stairsDown は f.stairsDown のセル、
 * chest は kind chest（開ける前の宝箱のセル。M11）
 */
export function warpTarget(
  state: GameState,
  data: GameData,
  to: "event" | "trap" | "stairsDown" | "chest",
): { pos: Pos; facing: Facing } | null {
  const f = floorOf(requireDive(state), data);
  const isTarget = (c: Cell, x: number, y: number): boolean => {
    switch (to) {
      case "event":
        return c.kind === "event" && c.eventId !== null;
      case "trap":
        return c.kind === "trap" && (c.trapId === "pit" || c.trapId === "spinner");
      case "chest":
        return c.kind === "chest";
      case "stairsDown":
        // UI-57（M9）: 最下層（下り階段が無い）ではボスのセル（撃破の後はテレポーターが重なる）
        if (f.stairsDown === null) return f.boss !== null && f.boss.x === x && f.boss.y === y;
        return f.stairsDown.x === x && f.stairsDown.y === y;
    }
  };
  for (let y = 0; y < f.height; y++) {
    for (let x = 0; x < f.width; x++) {
      const c = cellAt(f, x, y);
      if (!isTarget(c, x, y)) continue;
      for (const d of FACINGS) {
        const n = step({ x, y }, d);
        if (!inBounds(f, n.x, n.y) || !isPassable(edgeOf(c, d))) continue;
        const k = cellAt(f, n.x, n.y).kind;
        if (k !== "corridor" && k !== "room") continue;
        return { pos: n, facing: opposite(d) };
      }
    }
  }
  return null;
}

function explore(ctx: RuleContext, dive: Dive, f: Floor): void {
  markExplored(dive, f, ctx.data.config.dungeon.viewDepth);
}

// ---------------------------------------------------------------------------
// 入場（DG-03, DG-40, TW-11）

/** dungeon.enter を受け付けない理由。受け付けるなら null（実体は town.ts の enterBlockReason。townMenu の canEnter と同じ判定） */
export function checkEnter(state: GameState, dungeonId: unknown, data: GameData): string | null {
  return enterBlockReason(state, dungeonId, data);
}

/**
 * TW-15: 宿の主人の噂話の候補。dungeonId の encounterTable の全階に出る敵（ボス boss.monster は表にあっても除く）から、
 * 図鑑で鑑定済みの種類を除き、重複なく monsters.json の順に並べた monsterId の列
 */
export function gossipCandidates(state: GameState, data: GameData, dungeonId: string): string[] {
  const def = dungeonOf(data, dungeonId);
  const inTable = new Set<string>();
  for (const entries of Object.values(def.encounterTable)) for (const e of entries) inTable.add(e.monster);
  inTable.delete(def.boss.monster);
  return data.monsters.filter((m) => inTable.has(m.id) && state.bestiary[m.id]?.identified !== true).map((m) => m.id);
}

/**
 * TW-15: 士気の gossip が真なら、gossipCandidates から randInt(0, n − 1) で 1 種を選んで図鑑で鑑定済みにし
 * （図鑑に無ければ kills 0 で作る）、message dungeon.gossip{monster: 鑑定済みの名前}。士気が無い・gossip が偽・候補が空なら何もしない（乱数も引かない）
 */
function gossip(ctx: RuleContext, dungeonId: string): void {
  const { state, data } = ctx;
  if (moraleOf(state, data)?.gossip !== true) return;
  const candidates = gossipCandidates(state, data, dungeonId);
  if (candidates.length === 0) return;
  const id = candidates[randInt(state.rng, 0, candidates.length - 1)]!;
  state.bestiary[id] = { kills: state.bestiary[id]?.kills ?? 0, identified: true };
  const name = data.monsters.find((m) => m.id === id)!.name;
  ctx.events.push({ kind: "message", key: "dungeon.gossip", params: { monster: name } });
}

/**
 * DG-03: 入場。乱数は diveSeed の nextUint32 → （TW-15 の噂話。士気の gossip が真で候補があるときだけ）randInt の順。
 * イベントは screen{dungeon} → dungeon.enter →（DG-37 / UI-76。ゲームで最初の入場のときだけ）hint.dungeonFirst
 * →（DG-37。初回入場で enterSpeech を持つときだけ）その語り →（噂話）dungeon.gossip
 */
export function enterDungeon(ctx: RuleContext, dungeonId: string): void {
  const { state, data } = ctx;
  const def = dungeonOf(data, dungeonId);
  const diveSeed = nextUint32(state.rng); // 迷宮の構造に使う乱数はこの 1 回だけ（DG-03）
  const f = generateFloor(def, data.config.dungeon, diveSeed, 1, null, chestGenOf(data, dungeonId));
  const upCell = cellAt(f, f.stairsUp.x, f.stairsUp.y);
  const facing = FACINGS.find((d) => isPassable(edgeOf(upCell, d)));
  if (facing === undefined) throw new Error("enterDungeon: stairsUp has no exit");
  const dive: Dive = {
    dungeonId,
    diveSeed,
    floor: 1,
    deepestFloor: 1,
    pos: { x: f.stairsUp.x, y: f.stairsUp.y },
    facing,
    explored: {},
    clearedCells: [],
    knownTraps: {},
    bossDefeated: false,
    ledger: { items: [], gold: 0 },
    chest: null,
    disarmedChests: [],
  };
  state.dive = dive;
  bumpTally(state, "dives"); // TW-35（M12）: 潜行の開始
  // DG-37（M12）: 初回入場の記録。初回の語り（enterSpeech）は、この push の前の includes で判定する
  const first = !state.progress.enteredDungeons.includes(dungeonId);
  const firstEver = state.progress.enteredDungeons.length === 0; // DG-37 / UI-76（M16）: ゲームで最初の入場
  if (first) state.progress.enteredDungeons.push(dungeonId);
  state.townVisit = null; // TW-32: 来訪の終わり（救済の申し出も下ろす）
  state.screen = "dungeon";
  explore(ctx, dive, f);
  ctx.events.push({ kind: "screen", to: "dungeon", dungeonId: dive.dungeonId });
  ctx.events.push({ kind: "message", key: "dungeon.enter", params: { dungeon: def.name } });
  // DG-37 / UI-76（M16）: ゲームで最初の入場なら、線画の読み方の一言（一度きり。enterSpeech の前）
  if (firstEver) tellHintOnce(ctx, "dungeonFirst");
  // DG-37（M12。U-5）: そのダンジョンに初めて入るときだけ、enterSpeech の GM の一行（入場の語りの後、噂話の前）
  if (first && def.enterSpeech !== undefined) ctx.events.push({ kind: "message", key: def.enterSpeech });
  gossip(ctx, dungeonId);
}

function requireDive(state: GameState): Dive {
  if (state.dive === null) throw new Error("not in dungeon");
  return state.dive;
}

// ---------------------------------------------------------------------------
// 旋回（DG-10, DG-11）。乱数は使わない

export function turn(ctx: RuleContext, dir: "left" | "right" | "around"): void {
  const dive = requireDive(ctx.state);
  dive.facing = dir === "left" ? turnLeft(dive.facing) : dir === "right" ? turnRight(dive.facing) : opposite(dive.facing);
  ctx.events.push({ kind: "turned", facing: dive.facing });
  explore(ctx, dive, floorOf(dive, ctx.data));
}

// ---------------------------------------------------------------------------
// 階段のボタン（DG-44。M16）。乱数は使わない

/** DG-44: 今のセルの階段で出す確認の種類（1 階の上り = exit、2 階以降の上り = up、下り = down） */
export type StairsUse = "exit" | "up" | "down";

/**
 * DG-44（M16）: dungeon.useStairs を受け付ける状態なら、出す確認の種類を返す。受け付けない状態なら null。
 * 条件: screen dungeon・dive あり・戦闘中でない・保留中の選択（E3）も宝箱（CB-60）も無い・行動可能な者（CH-44）がいる・今のセルの実効の kind が
 * stairsUp か stairsDown。表示層はこの値で「地上へ戻る / 階段を上る / 階段を下りる」のボタンを出す・隠す（判定は core）
 */
export function stairsHere(state: GameState, data: GameData): StairsUse | null {
  const dive = state.dive;
  if (state.screen !== "dungeon" || dive === null || state.battle !== null) return null;
  if (state.pendingChoice !== null || dive.chest !== null) return null;
  if (!state.party.some(canAct)) return null;
  const kind = cellAt(floorOf(dive, data), dive.pos.x, dive.pos.y).kind;
  if (kind === "stairsDown") return "down";
  if (kind === "stairsUp") return dive.floor >= 2 ? "up" : "exit";
  return null;
}

/**
 * DG-44: dungeon.useStairs の受付の判定（engine が複製の前に呼ぶ。保留中・宝箱の門は engine の共通の門が先に見る）。
 * 迷宮の外・戦闘中は not in dungeon、行動可能な者がいなければ no one can act、階段のセルでなければ not on stairs
 */
export function checkUseStairs(state: GameState, data: GameData): string | null {
  if (state.screen !== "dungeon" || state.dive === null || state.battle !== null) return "not in dungeon";
  if (!state.party.some(canAct)) return "no one can act";
  return stairsHere(state, data) === null ? "not on stairs" : null;
}

/**
 * DG-44: 階段の上で確認を出す。前進で階段のセルに入ったとき（continueStep。DG-14 / DG-06）と同じ確認
 * （1 階の上りは offerExit、それ以外は offerStairs）。位置・向き・乱数・遭遇判定は変えない
 */
export function useStairs(ctx: RuleContext): void {
  const k = stairsHere(ctx.state, ctx.data);
  if (k === null) throw new Error("useStairs: not on usable stairs");
  if (k === "exit") offerExit(ctx);
  else offerStairs(ctx, k);
}

// ---------------------------------------------------------------------------
// 前進（DG-10, DG-11, DG-13, DG-14, DG-20, DG-31, CB-01, CH-43）

export function moveForward(ctx: RuleContext): void {
  const { state, data } = ctx;
  const dive = requireDive(state);
  const f = floorOf(dive, data);
  const here = cellAt(f, dive.pos.x, dive.pos.y);
  const e = edgeOf(here, dive.facing);
  if (e === "wall") {
    ctx.events.push({ kind: "blocked" });
    ctx.events.push({ kind: "message", key: "dungeon.blocked" });
    return;
  }
  // DG-10: 扉は通り抜けるたびに語る。辺は door のまま（開けた記録を持たない。ユーザー決定）
  if (e === "door") ctx.events.push({ kind: "message", key: "dungeon.door" });
  dive.pos = step(dive.pos, dive.facing);
  ctx.events.push({ kind: "moved", pos: { x: dive.pos.x, y: dive.pos.y }, facing: dive.facing });
  state.adventureTurns += 1; // TW-12: 前進が成立した 1 歩（壁の blocked では来ない）
  explore(ctx, dive, f);
  const cell = cellAt(f, dive.pos.x, dive.pos.y);
  // CH-43: 毒の 1 歩ごとのダメージ（HP 1 で止まるので、これで死ぬことはない）
  tickPoisonStep(ctx);
  walkRegen(ctx); // IT-40: 毒の後
  if (cell.kind === "trap") {
    // DG-21（M6）: 印のある罠（knownTraps）は察知を振らずに必ず確認を立てる（階段・遭遇なし）
    if ((dive.knownTraps[String(dive.floor)] ?? []).includes(idx(f, dive.pos.x, dive.pos.y))) {
      offerTrap(ctx, "dungeon.trap.knownPrompt");
      return;
    }
    if (detectTrap(ctx, f, cell)) return; // DG-21: 察知したら確認を立てて終わる（階段・遭遇なし）
    triggerTrap(ctx, f, dive.pos);
  }
  continueStep(ctx, f, cell);
}

/**
 * IT-40 walkRegen: 前進が成立した歩（毒の後）で、life alive の者の装備中の walkRegen の品ごとに、adventureTurns が value の倍数なら
 * HP +1（実効の hpMax で止める）。増えたら hpChanged だけを出す（毒と同じく message なし）。乱数なし
 */
function walkRegen(ctx: RuleContext): void {
  const { state, data } = ctx;
  for (const ch of state.party) {
    if (ch.life !== "alive") continue;
    const es = equipStats(state, data, ch);
    const n = es.skills.filter((x) => x.type === "walkRegen" && x.value > 0 && state.adventureTurns % x.value === 0).length;
    if (n === 0) continue;
    const hp = Math.min(es.hpMax, ch.hp + n);
    if (hp <= ch.hp) continue;
    ctx.events.push({ kind: "hpChanged", id: ch.id, delta: hp - ch.hp, hp });
    ch.hp = hp;
  }
}

/**
 * 前進の 1 歩の続き（罠の後）。罠の察知で「進む」を選んだときもここから続ける。f は dive.floor の実効の構造。
 * 行動可能な者がいなければ何もしない → 階段・出口・テレポーター・ボス → イベント（DG-22）→ 宝箱のセル（DG-24。M11）→ 遭遇判定。
 */
function continueStep(ctx: RuleContext, f: Floor, cell: Cell): void {
  const { state } = ctx;
  const dive = requireDive(state);
  // DG-11 / DG-20: 行動可能な者（CH-44）がいなければ階段・遭遇を起こさずに返る（全滅処理は engine の後処理 wipeIfNoneCanAct）
  if (!state.party.some(canAct)) return;
  if (cell.kind === "stairsDown") {
    offerStairs(ctx, "down");
    return; // 階段セルでは遭遇判定をしない
  }
  if (cell.kind === "stairsUp") {
    if (dive.floor >= 2) offerStairs(ctx, "up");
    else offerExit(ctx); // DG-06: 1 階の上り階段は街への出口
    return;
  }
  // DG-32: ボス撃破後のテレポーター（floorOf が重ねる）。遭遇の d100 は振らない
  if (cell.kind === "teleporter") {
    offerTeleporter(ctx);
    return;
  }
  // DG-31: ボスのセルは遭遇の d100 を振らずに固定遭遇（倒した後は floorOf が teleporter に重ねる）
  if (cell.kind === "boss" && !dive.bossDefeated) {
    startBossEncounter(ctx);
    return;
  }
  // DG-22 / B11: イベントのセルは events.ts の手順で処理し、遭遇の d100 は振らない（処理後は floorOf が通常のセルに戻す）
  if (cell.kind === "event" && cell.eventId !== null) {
    startEvent(ctx, f, cell.eventId);
    return;
  }
  // DG-24（M11）: 宝箱のセルは箱を置いて CB-60 の流れ（衝動・制止・掛け合い → chest.prompt）。遭遇の d100 は振らない。
  // 開けた・転移で失った箱は clearedCells に入り floorOf が消す。放っておいた箱は残り、次に乗るとまた見つかる
  if (cell.kind === "chest") {
    findCellChest(ctx, cell, dive.pos, startAlarmEncounter);
    return;
  }
  rollEncounter(ctx, cell.roomId !== null);
}

/** CB-01。前進が成立した 1 歩につき d100 をちょうど 1 回消費し、当たれば CB-03 の編成で戦闘を始める */
function rollEncounter(ctx: RuleContext, inRoom: boolean): void {
  const dive = requireDive(ctx.state);
  const def = dungeonOf(ctx.data, dive.dungeonId);
  const rate = inRoom ? def.encounterRate.room : def.encounterRate.corridor;
  if (chance(ctx.state.rng, Math.round(rate * 100))) startRandomEncounter(ctx, inRoom);
}

// ---------------------------------------------------------------------------
// 罠（DG-20, DG-21, CH-45, CH-51, CH-54, E4）。踏んだときに察知（DG-21）を判定し、察知しなければ発動する

/**
 * DG-21 / A6: 罠の察知。teleport（未実装の罠）は対象外。行動可能で benefits.trapDetect + オプション trapDetect（M7）> 0 の者を並び順に
 * d100 ≤ trapDetect で振り、最初の成功者で止める（dungeon.trap.detected{name} と確認 kind trap）。dice は出さない。
 * 誰も成功しなければ何も出さずに false（罠は通常どおり発動する）。
 * 成功したら、そのセルの添字を dive.knownTraps[階] に昇順・重複なしで足す（M5.5。乱数は使わない）。f は dive.floor の実効の構造。
 */
function detectTrap(ctx: RuleContext, f: Floor, cell: Cell): boolean {
  const { state, data } = ctx;
  const dive = requireDive(state);
  if (cell.trapId === null || cell.trapId === "teleport") return false;
  for (const ch of state.party) {
    if (!canAct(ch)) continue;
    // M7（IT-34）: 性格の trapDetect + オプション trapDetect の合計。正ならリーダーも振る
    const v = (personalityOf(data, ch.personality)?.benefits.trapDetect ?? 0) + equipStats(state, data, ch).trapDetect;
    if (v <= 0) continue;
    if (chance(state.rng, v)) {
      addIndex(dive.knownTraps, dive.floor, [idx(f, dive.pos.x, dive.pos.y)]); // DG-21（M5.5）: 察知した罠を覚える
      ctx.events.push({ kind: "message", key: "dungeon.trap.detected", params: { name: ch.name } });
      offerTrap(ctx);
      return true;
    }
  }
  return false;
}

/**
 * DG-21 / A6: 察知の確認の選択。retreat は 1 歩前のセルへ戻る（向きはそのまま。遭遇・毒・SAN なし、罠は残る）。
 * proceed はその場で罠が通常どおり発動し、その後は普段の歩の続き（行動可能チェック・遭遇判定）。
 */
function chooseTrapOption(ctx: RuleContext, optionId: string): void {
  const { state, data } = ctx;
  const dive = requireDive(state);
  if (optionId === "retreat") {
    dive.pos = step(dive.pos, opposite(dive.facing));
    ctx.events.push({ kind: "moved", pos: { x: dive.pos.x, y: dive.pos.y }, facing: dive.facing });
    explore(ctx, dive, floorOf(dive, data));
    ctx.events.push({ kind: "message", key: "dungeon.trap.retreat" });
    return;
  }
  if (optionId === "proceed") {
    const f = floorOf(dive, data);
    const cell = cellAt(f, dive.pos.x, dive.pos.y); // clearedCells にまだ無いので kind trap のまま
    triggerTrap(ctx, f, dive.pos);
    continueStep(ctx, f, cell);
    return;
  }
  throw new Error(`chooseTrapOption: unknown option ${optionId}`);
}

function triggerTrap(ctx: RuleContext, f: Floor, p: Pos): void {
  const { state, data } = ctx;
  const dive = requireDive(state);
  const cell = cellAt(f, p.x, p.y);
  const trapId = cell.trapId;
  if (trapId === null || trapId === "teleport") return; // teleport は M2 では何もしない（clearedCells にも入れない）
  dive.clearedCells.push({ floor: dive.floor, x: p.x, y: p.y });
  removeIndex(dive.knownTraps, dive.floor, idx(f, p.x, p.y)); // DG-21（M5.5）: 発動したら察知の印を外す
  ctx.events.push({ kind: "message", key: `dungeon.trap.${trapId}` });
  const cfg = data.config;
  if (trapId === "pit") {
    damageMembers(ctx, aliveMembers(state), cfg.dungeon.trap.pitDice);
  } else if (trapId === "spinner") {
    dive.facing = FACINGS[randInt(state.rng, 0, 3)]!;
    ctx.events.push({ kind: "turned", facing: dive.facing });
    explore(ctx, dive, f);
  }
  for (const ch of aliveMembers(state)) loseSan(ctx, ch, cfg.san.trap, ["trap"]);
}

// ---------------------------------------------------------------------------
// 階段・出口・テレポーター（DG-06, DG-14, DG-32, E3）。確認を立てるのは choices.ts

/**
 * event.choose。optionId は pendingChoice.options にあることを呼び出し側で確かめ済み。
 * kind event は chooseEventOption（EV-31/33）、kind trap は chooseTrapOption（DG-21）。以下は階段・出口・テレポーター:
 * stay は何もしない。exit（DG-06 徒歩）と teleport（DG-32）は returnToTown で街へ（DG-43 で台帳を確定）。
 */
export function chooseOption(ctx: RuleContext, optionId: string): void {
  const { state, data } = ctx;
  const pc = state.pendingChoice;
  if (pc === null) throw new Error("chooseOption: no pending choice");
  state.pendingChoice = null;
  if (pc.kind === "event") {
    chooseEventOption(ctx, floorOf(requireDive(state), data), pc, optionId); // EV-31 / EV-33
    return;
  }
  if (pc.kind === "trap") {
    chooseTrapOption(ctx, optionId);
    return;
  }
  if (optionId === "stay") return;
  if (optionId === "exit") {
    returnToTown(ctx, "dungeon.exit");
    return;
  }
  if (optionId === "teleport") {
    returnToTown(ctx, "dungeon.teleport");
    return;
  }
  const dive = requireDive(state);
  if (optionId === "descend") {
    dive.floor += 1;
    explore(ctx, dive, floorOf(dive, data));
    ctx.events.push({ kind: "floorChanged", floor: dive.floor, pos: { x: dive.pos.x, y: dive.pos.y }, facing: dive.facing });
    ctx.events.push({ kind: "message", key: "dungeon.descend" });
    // DG-14 / CH-51: この潜行で初めて到達した階に降りたときだけ減る（上って降り直しても減らない。ユーザー決定）
    if (dive.floor > dive.deepestFloor) {
      dive.deepestFloor = dive.floor;
      for (const ch of aliveMembers(state)) loseSan(ctx, ch, data.config.san.floorDescend, []);
    }
    return;
  }
  if (optionId === "ascend") {
    dive.floor -= 1;
    explore(ctx, dive, floorOf(dive, data));
    ctx.events.push({ kind: "floorChanged", floor: dive.floor, pos: { x: dive.pos.x, y: dive.pos.y }, facing: dive.facing });
    ctx.events.push({ kind: "message", key: "dungeon.ascend" });
    return;
  }
  throw new Error(`chooseOption: unknown option ${optionId}`);
}
