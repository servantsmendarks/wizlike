// SV-50: 続きから（リロード復帰）の計画（純粋。DOM なし）。
// 保存した screen（town / dungeon / battle）へ直接描き、再生の中でしか出ない問いをメッセージ窓に出し直す。
// - 保留中の選択（pendingChoice）の promptKey。core は選択を立てた execute で同じ key の message を出す（decisions）ので、
//   通常の再生では出さず、復帰のときだけ出す。
// - 救済の申し出（TW-30）。townMenu の mercy が null でなければ town.mercy.offer。
// 判定は core の値（state.screen、pendingChoice、townMenu）だけで行う（§3-4）。
import type { GameData } from "../core/data/index";
import { townMenu } from "../core/rules/town";
import type { GameState } from "../core/types";

export type ResumePlan = {
  route: "town" | "dungeon" | "battle";
  /** 再生の外でメッセージ窓に出す strings キー（params なし）の列 */
  prompts: string[];
};

export function resumePlan(st: GameState, data: GameData): ResumePlan {
  const s = st.screen;
  // 読み込みの形の検査（src/save/migrate.ts）で town / dungeon / battle に限られている
  if (s !== "town" && s !== "dungeon" && s !== "battle") throw new Error(`resumePlan: unexpected screen ${s}`);
  const prompts: string[] = [];
  if (st.pendingChoice !== null) prompts.push(st.pendingChoice.promptKey);
  const menu = townMenu(st, data);
  if (menu !== null && menu.mercy !== null) prompts.push("town.mercy.offer");
  return { route: s, prompts };
}
