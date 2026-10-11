// TW-15: 宿の主人の噂話の候補（純粋。乱数なし）。dungeon.ts（入場の噂話）と town.ts（M20 D-5 の宿の予告）の両方が使うので、
// town → dungeon の循環を作らないように切り出した。
import type { GameData } from "../data/index";
import { dungeonOf } from "../state";
import type { GameState } from "../types";

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
 * TW-15（M20 D-5）: 宿で噂を聞く値打ちがあるか。解放済みで準備中（DG-35 の placeholder）でないダンジョンのどれかに
 * gossipCandidates が 1 つ以上ある（入るダンジョンは宿では決まっていないので、どれかで噂を思い出せれば真）
 */
export function hasGossip(state: GameState, data: GameData): boolean {
  return state.progress.unlockedDungeons.some(
    (id) => data.dungeons.some((d) => d.id === id && d.placeholder !== true) && gossipCandidates(state, data, id).length > 0,
  );
}
