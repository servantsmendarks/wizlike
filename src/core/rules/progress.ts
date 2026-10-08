// 進行の通算（TW-35。M12）: 戦績の集計（tally）と、戦績の画面の値（endingRecordView）。純粋。乱数を使わない。
import type { GameData } from "../data/index";
import type { EndingRecord, GameState, Tally } from "../types";

/** TW-35: 戦績の通算の 1 項目を 1 足す。呼ぶ所は各項目 1 か所に寄せる（types.ts の Tally の注を参照） */
export function bumpTally(state: GameState, key: keyof Tally): void {
  state.tally[key] += 1;
}

/**
 * TW-35: 戦績の画面の値（state を変えない）。ending イベントと酒場の「戦績」（U-2）の両方がこれを使う。
 * 敵の図鑑は bestiary のうち identified が真の種類（遭遇しただけ・identified 偽のキーは数えない。宿の噂話で鑑定した分は入る）÷ data.monsters の数。
 * 品の図鑑は uniqueBook のキー数 ÷ data.uniques の数。経過は adventureTurns
 */
export function endingRecordView(state: GameState, data: GameData): EndingRecord {
  const t = state.tally;
  return {
    dives: t.dives,
    battles: t.battles,
    deaths: t.deaths,
    ashes: t.ashes,
    wipes: t.wipes,
    turns: state.adventureTurns,
    bestiary: { known: Object.values(state.bestiary).filter((e) => e.identified).length, total: data.monsters.length },
    uniques: { known: Object.keys(state.uniqueBook).length, total: data.uniques.length },
  };
}
