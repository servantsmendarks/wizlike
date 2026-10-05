// UI-13（M8.5）: 街のパーティの帯（ヘッダー・施設の絵の下の 1 行。1 人 40px = 全角 5 字 × 6 人）。
// 名前を省略して出し、死亡・灰・状態異常・SAN の段を色と印の字（色だけに頼らない）で区別する。全文は状態の画面（UI-59）で見る。
// bandCell は純粋（DOM に触れない）。段は app が core の sanStage で決めて渡す（表示層は段の境を計算しない。UI-35）。
import type { StatusId, Strings } from "../../core/data/index";
import type { SanStage } from "../../core/rules/san";
import type { Character } from "../../core/types";
import type { Role } from "../palette";

/** 1 セルの幅（美咲の半角 1 = 4px を 1 単位として 10 単位 = 40px） */
export const BAND_CELL_UNITS = 10;
/** 省略の記号（全角。2 単位） */
export const BAND_ELLIPSIS = "…";

/** 状態異常の印の優先順（重いものが先。UI-13） */
const STATUS_ORDER: readonly StatusId[] = ["stone", "paralysis", "sleep", "poison"];
/** SAN の段の印の優先順（重いものが先。normal は印なし） */
const SAN_ORDER: readonly Exclude<SanStage, "normal">[] = ["broken", "confused", "uneasy"];

/** 帯の色の役（palette の ROLES）。死亡 danger・灰 dim・状態異常 status・SAN の段 san・正常 text */
export type BandRole = Extract<Role, "text" | "dim" | "danger" | "status" | "san">;
/** label は省略した名前に印の字を続けたもの（名前と印は同じ色）。mark は印の字（無ければ空） */
export type BandCell = { label: string; mark: string; role: BandRole };

/** 文字の幅（単位）。ASCII と半角カナは 1、それ以外は 2 */
export function charUnits(ch: string): number {
  const c = ch.codePointAt(0) ?? 0;
  return c <= 0x7e || (c >= 0xff61 && c <= 0xff9f) ? 1 : 2;
}

/** 文字列の幅（単位） */
export function textUnits(text: string): number {
  let n = 0;
  for (const ch of text) n += charUnits(ch);
  return n;
}

/** units に収まるように切る。収まらなければ末尾を BAND_ELLIPSIS にする（記号を含めて units 以内） */
export function fitName(name: string, units: number): string {
  if (textUnits(name) <= units) return name;
  const room = units - textUnits(BAND_ELLIPSIS);
  let out = "";
  let n = 0;
  for (const ch of name) {
    const w = charUnits(ch);
    if (n + w > room) break;
    out += ch;
    n += w;
  }
  return out + BAND_ELLIPSIS;
}

function str(strings: Strings, key: string): string {
  return strings[key] ?? key;
}

/** 印の字と色の役。優先順は 灰 > 死亡 > 石 > 痺 > 眠 > 毒 > 虚脱 > 錯乱 > 不安（1 人に 1 つ） */
function markOf(ch: Pick<Character, "life" | "status">, stage: SanStage, strings: Strings): { mark: string; role: BandRole } {
  if (ch.life === "ash") return { mark: str(strings, "town.band.mark.ash"), role: "dim" };
  if (ch.life === "dead") return { mark: str(strings, "town.band.mark.dead"), role: "danger" };
  const st = STATUS_ORDER.find((x) => ch.status.includes(x));
  if (st !== undefined) return { mark: str(strings, `party.status.${st}`), role: "status" };
  const sn = SAN_ORDER.find((x) => x === stage);
  if (sn !== undefined) return { mark: str(strings, `town.band.mark.${sn}`), role: "san" };
  return { mark: "", role: "text" };
}

/**
 * UI-13（M8.5）: 帯の 1 セル。名前は BAND_CELL_UNITS から印の幅を引いた幅に収め、収まらなければ「…」で切る
 * （全角 6 字の名前は 4 字＋…、印があれば 3 字＋…＋印）。stage は app が core の sanStage で決めた段
 */
export function bandCell(ch: Pick<Character, "name" | "life" | "status">, stage: SanStage, strings: Strings): BandCell {
  const { mark, role } = markOf(ch, stage, strings);
  const name = fitName(ch.name, BAND_CELL_UNITS - textUnits(mark));
  return { label: `${name}${mark}`, mark, role };
}
