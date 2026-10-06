// イベント（EV）のテスト用の共通部品。
import type { GameData, OutcomeQuality } from "../../src/core/data/index";
import { dungeonOf, eventOf } from "../../src/core/state";
import type { Floor, GameState } from "../../src/core/types";
import { execute } from "../../src/core/engine";
import { data, newGame, noAmbushAvoid, noTrapDetect } from "./core";
import { dataWithRate, findSituation, placeAt, type Approach } from "./dungeon";

/** d01 で eventId が置かれる階（DG-22: events の i 番目を (i mod floors)+1 階）。光る石板は 1 階、宝袋は 2 階 */
export function floorOfEvent(eventId: string, dungeonId = "d01"): number {
  const def = dungeonOf(data, dungeonId);
  const i = def.events.indexOf(eventId);
  if (i < 0) throw new Error(`floorOfEvent: ${eventId} is not in ${dungeonId}`);
  return (i % def.floors) + 1;
}

/** dungeonId（既定 d01）で eventId のセルの手前に立って向いている state（findSituation。シードは 1 から探す） */
export function atEvent(eventId: string, dungeonId = "d01"): { state: GameState; a: Approach; f: Floor; seed: number } {
  const base = dungeonId === "d01" ? undefined : (seed: number) => enterDungeon(seed, dungeonId);
  return findSituation((c) => c.kind === "event" && c.eventId === eventId, { floor: floorOfEvent(eventId, dungeonId), base });
}

/** newGame(seed) で dungeonId を開放済みにして dungeon.enter したもの（d01 以外のイベントのテスト用） */
export function enterDungeon(seed: number, dungeonId: string): GameState {
  const s = newGame(seed);
  if (!s.progress.unlockedDungeons.includes(dungeonId)) s.progress.unlockedDungeons.push(dungeonId);
  const r = execute(s, { type: "dungeon.enter", dungeonId }, data);
  if (r.events[0]?.kind === "rejected") throw new Error(JSON.stringify(r.events));
  return r.state;
}

/** atEvent の 1 歩先（イベントのセルの上）に立った state。startEvent を直接呼ぶテスト用 */
export function onEvent(eventId: string, dungeonId = "d01"): { state: GameState; a: Approach; f: Floor } {
  const sit = atEvent(eventId, dungeonId);
  return { state: placeAt(sit.state, sit.a.target, sit.a.facing), a: sit.a, f: sit.f };
}

/** 遭遇率 0・罠の察知なし・奇襲の取り消しなしの data に mut を当てたもの（イベントの乱数だけを見る） */
export function dataEvents(mut?: (d: GameData) => void): GameData {
  const d = dataWithRate(0, 0);
  noTrapDetect(d);
  noAmbushAvoid(d);
  mut?.(d);
  return d;
}

/** d の eventId の衝動の結果のうち、quality 以外の weight を 0 にする（weightedIndex は 0 の重みを引かない） */
export function outcomeOnly(d: GameData, eventId: string, quality: OutcomeQuality): void {
  const def = eventOf(d, eventId);
  if (!def.impulseOutcomes.some((o) => o.quality === quality)) throw new Error(`outcomeOnly: ${eventId} has no ${quality}`);
  for (const o of def.impulseOutcomes) if (o.quality !== quality) o.weight = 0;
}
