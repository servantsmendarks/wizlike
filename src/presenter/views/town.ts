// UI-52 の街（M2 版）。施設メニューは「迷宮へ」だけ。押すとダンジョン一覧（progress.unlockedDungeons の順）と「戻る」。
// 街の画面は迷宮の画面（views/dungeon.ts）の 5 領域をそのまま使う（ビューは枠だけ）。ここはリストの中身を決める純粋な部分。
// 一覧の何を選んだら何を送るか（dungeon.enter）は app が決める。入場できるかの判定は core が行う（UI-35）。
import type { GameData, Strings } from "../../core/data/index";
import type { GameState } from "../../core/types";

export type TownPage = "menu" | "gate";
export type TownEntry = { kind: "gate" } | { kind: "enter"; dungeonId: string } | { kind: "back" };

/** そのページのリストの項目 */
export function townEntries(page: TownPage, state: GameState): TownEntry[] {
  if (page === "menu") return [{ kind: "gate" }];
  return [...state.progress.unlockedDungeons.map((id): TownEntry => ({ kind: "enter", dungeonId: id })), { kind: "back" }];
}

/** 項目の表示名 */
export function townEntryLabel(e: TownEntry, data: GameData, strings: Strings): string {
  switch (e.kind) {
    case "gate":
      return strings["town.menu.dungeon"] ?? "town.menu.dungeon";
    case "back":
      return strings["common.back"] ?? "common.back";
    case "enter":
      return data.dungeons.find((d) => d.id === e.dungeonId)?.name ?? e.dungeonId;
  }
}
