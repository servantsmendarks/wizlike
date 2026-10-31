// UI-53 / UI-54（M26 B-1）: 味方の対象の行。キャンプ（呪文・道具。views/camp.ts の targetRow）と戦闘（呪文・道具。battle-input.ts の ally の段）で共用する。
// 形は「{name}（{status}）HP {hp}/{hpMax}」、状態が無ければ「{name} HP {hp}/{hpMax}」（strings dungeon.items.allyRowStatus / allyRow）。
// 状態は core の allies[].status（Character.status の写し）を帯と同じ重さの順（STATUS_ORDER）に並べ、短い表記 party.status.<id> を半角空白で区切る。
// SAN の段は入れない。選べない行は camp.target.blocked「{row}（{why}）」で包み、包んだ後の幅が LIST_ROW_UNITS を超えるときは名前の末尾を「…」で詰める。
// 純粋（DOM に触れない）。判定はしない（block の有無は core が決め、ここは文字列を組むだけ）。
import type { StatusId, Strings } from "../../core/data/index";
import { formatMessage } from "./message";
import { BAND_ELLIPSIS_KEY, fitName, STATUS_ORDER, textUnits } from "./party-band";
import { LIST_ROW_UNITS } from "./town";

/** 行に要る値（core の CampMenu / FieldItemMenu / BattleMenu の allies の要素） */
export type AllyRowSource = { name: string; hp: number; hpMax: number; status: readonly StatusId[] };

function str(strings: Strings, key: string, params?: Record<string, string | number>): string {
  return formatMessage(strings[key] ?? key, params);
}

/** 味方の対象の行の文字列。why は選べない理由の文（camp.targetBlock.* を引いたもの。選べるなら null） */
export function allyRowLabel(strings: Strings, a: AllyRowSource, why: string | null = null): string {
  const status = STATUS_ORDER.filter((x) => a.status.includes(x))
    .map((x) => str(strings, `party.status.${x}`))
    .join(" ");
  const label = (name: string): string => {
    const params = { name, hp: a.hp, hpMax: a.hpMax };
    const row = status === "" ? str(strings, "dungeon.items.allyRow", params) : str(strings, "dungeon.items.allyRowStatus", { ...params, status });
    return why === null ? row : str(strings, "camp.target.blocked", { row, why });
  };
  const room = LIST_ROW_UNITS - textUnits(label(""));
  return label(fitName(a.name, Math.max(0, room), str(strings, BAND_ELLIPSIS_KEY)));
}
