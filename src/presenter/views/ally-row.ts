// UI-53 / UI-54（M26 B-1。2026-11-01 直し）: 味方の対象の行。キャンプ（呪文・道具。views/camp.ts の targetRow）と戦闘（呪文・道具。battle-input.ts の ally の段）で共用する。
// 形は「{name}（{status}）HP {hp}/{hpMax}」、状態が無ければ「{name} HP {hp}/{hpMax}」（strings dungeon.items.allyRowStatus / allyRow）。
// 状態は core が targets[].status に載せた 1 つ（最も重い 1 つ。治す呪文・道具は治す状態だけ）の短い表記 party.status.<id>。ここでは選ばない。
// SAN の段は入れない。満タンで選べない行も理由は付けない（dim だけ）。行が 39 単位（LIST_ROW_UNITS）か 21 字（LIST_ROW_CHARS）を超えるときは名前の末尾を「…」で詰める（安全網）。
// 純粋（DOM に触れない）。判定はしない（文字列を組むだけ）。
import type { StatusId, Strings } from "../../core/data/index";
import { formatMessage } from "./message";
import { BAND_ELLIPSIS_KEY, fitName, textChars, textUnits } from "./party-band";
import { LIST_ROW_CHARS, LIST_ROW_UNITS } from "./town";

/** 行に要る値（core の allies の要素 + その呪文・道具の targets[].status） */
export type AllyRowSource = { name: string; hp: number; hpMax: number; status: StatusId | null };

function str(strings: Strings, key: string, params?: Record<string, string | number>): string {
  return formatMessage(strings[key] ?? key, params);
}

/** 味方の対象の行の文字列 */
export function allyRowLabel(strings: Strings, a: AllyRowSource): string {
  const status = a.status === null ? "" : str(strings, `party.status.${a.status}`);
  const label = (name: string): string => {
    const params = { name, hp: a.hp, hpMax: a.hpMax };
    return status === "" ? str(strings, "dungeon.items.allyRow", params) : str(strings, "dungeon.items.allyRowStatus", { ...params, status });
  };
  const bare = label("");
  const room = LIST_ROW_UNITS - textUnits(bare);
  const roomChars = LIST_ROW_CHARS - textChars(bare);
  return label(fitName(a.name, Math.max(0, room), str(strings, BAND_ELLIPSIS_KEY), Math.max(0, roomChars)));
}
