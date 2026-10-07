// SV-50: 続きから（リロード復帰）の計画（純粋。DOM なし）。
// 保存した screen（town / dungeon / battle / event）へ直接描き、再生の中でしか出ない問いをメッセージ窓に出し直す。
// screen event（イベントの選択を待つ間。UI-55）は迷宮の画面（route dungeon）の上の状態として描く。
// - 保留中の選択（pendingChoice）の promptKey。core は選択を立てた execute で同じ key の message を出す（decisions）ので、
//   通常の再生では出さず、復帰のときだけ出す。
// - 救済の申し出（TW-30）。townMenu の mercy が null でなければ town.mercy.offer。
// - 宝箱の問い（UI-70。M11）。chestView が null でなければ（箱が残っていて、戦闘中でも保留中でもない）chest.prompt。
//   警報の戦闘中（battle 非 null）は出さない（勝って戻るときに core が出す）。
// 判定は core の値（state.screen、pendingChoice、townMenu、chestView）だけで行う（§3-4）。
import type { GameData } from "../core/data/index";
import { chestView } from "../core/rules/chest";
import { townMenu } from "../core/rules/town";
import type { GameState, Screen } from "../core/types";

export type ResumePlan = {
  route: "town" | "dungeon" | "battle";
  /** 再生の外でメッセージ窓に出す strings キー（params なし）の列 */
  prompts: string[];
};

/** core の screen → 表示層の route。event は迷宮の画面の上の状態（UI-55）。title は null（呼び出し側で扱う） */
export function routeOfScreen(s: Screen): "town" | "dungeon" | "battle" | null {
  switch (s) {
    case "town":
    case "dungeon":
    case "battle":
      return s;
    case "event":
      return "dungeon";
    case "title":
      return null;
  }
}

export function resumePlan(st: GameState, data: GameData): ResumePlan {
  // 読み込みの形の検査（src/save/migrate.ts）で town / dungeon / battle / event に限られている
  const route = routeOfScreen(st.screen);
  if (route === null) throw new Error(`resumePlan: unexpected screen ${st.screen}`);
  const prompts: string[] = [];
  if (st.pendingChoice !== null) prompts.push(st.pendingChoice.promptKey);
  if (chestView(st, data) !== null) prompts.push("chest.prompt");
  const menu = townMenu(st, data);
  if (menu !== null && menu.mercy !== null) prompts.push("town.mercy.offer");
  return { route, prompts };
}
