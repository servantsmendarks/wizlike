// UI-13（M8.5）: 街のパーティの帯（ヘッダー・施設の絵の下の 1 行。1 人 40px = 全角 5 字 × 6 人）。
// 名前を省略して出し、死亡・灰・状態異常・SAN の段を色と印の字（色だけに頼らない）で区別する。全文は状態の画面（UI-59）で見る。
// bandCell は純粋（DOM に触れない）。段は app が core の sanStage で決めて渡す（表示層は段の境を計算しない。UI-35）。
import type { StatusId, Strings } from "../../core/data/index";
import type { SanStage } from "../../core/rules/san";
import type { Character } from "../../core/types";
import { onTap } from "../input/tap";
import type { Role } from "../palette";

/** 1 セルの幅（美咲の半角 1 = 4px を 1 単位として 10 単位 = 40px） */
export const BAND_CELL_UNITS = 10;
/** 省略の記号の strings のキー（既定は全角「…」= 2 単位。§3-10） */
export const BAND_ELLIPSIS_KEY = "town.band.ellipsis";

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

/** units に収まるように切る。収まらなければ末尾を ellipsis（strings の town.band.ellipsis）にする（記号を含めて units 以内） */
export function fitName(name: string, units: number, ellipsis: string): string {
  if (textUnits(name) <= units) return name;
  const room = units - textUnits(ellipsis);
  let out = "";
  let n = 0;
  for (const ch of name) {
    const w = charUnits(ch);
    if (n + w > room) break;
    out += ch;
    n += w;
  }
  return out + ellipsis;
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
  const name = fitName(ch.name, BAND_CELL_UNITS - textUnits(mark), str(strings, BAND_ELLIPSIS_KEY));
  return { label: `${name}${mark}`, mark, role };
}

/** UI-13: 帯の役の CSS 変数（palette の ROLES） */
const roleColor = (r: BandRole): string => `var(--c-${r})`;

export type PartyBand = {
  el: HTMLElement;
  render(party: readonly Character[]): void;
  setSan(id: string, san: number): void;
  setLife(id: string, life: Character["life"]): void;
  setStatus(id: string, status: StatusId, on: boolean): void;
};

type BandRow = { id: string; name: string; life: Character["life"]; status: StatusId[]; san: number; sanMax: number };

/**
 * UI-13（M8.5）: 帯の DOM。row は帯の 1 行（ステージ座標）、cells は見える 6 セル、hits は押せる範囲（帯と見出しの行。40×22）。
 * stageOf は core の sanStage、sanMaxOf は実効の sanMax（core の memberSheet）。タップで onPick（その人の id）。
 * el は row の位置に自分で置く。押せる範囲の要素は帯の下（見出しの行）まで伸ばし、透明にする
 */
export function createPartyBand(o: {
  strings: Strings;
  row: { x: number; y: number; w: number; h: number };
  cells: readonly { x: number; y: number; w: number; h: number }[];
  hits: readonly { x: number; y: number; w: number; h: number }[];
  stageOf: (san: number, sanMax: number) => SanStage;
  sanMaxOf: (ch: Character) => number;
  onPick(memberId: string): void;
}): PartyBand {
  const r = o.row;
  const el = document.createElement("div");
  el.className = "party-band";
  Object.assign(el.style, { position: "absolute", left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px`, color: "var(--c-text)" });
  let rows: BandRow[] = [];
  const cellEls = o.cells.map((c, i) => {
    const hit = o.hits[i] ?? c;
    const b = document.createElement("div");
    b.className = "party-band-cell";
    Object.assign(b.style, {
      position: "absolute",
      left: `${hit.x - r.x}px`,
      top: `${hit.y - r.y}px`,
      width: `${hit.w}px`,
      height: `${hit.h}px`,
    });
    const label = document.createElement("div");
    label.className = "party-band-label";
    Object.assign(label.style, {
      position: "absolute",
      left: `${c.x - hit.x}px`,
      top: `${c.y - hit.y}px`,
      width: `${c.w}px`,
      height: `${c.h}px`,
      lineHeight: `${c.h}px`,
      whiteSpace: "nowrap",
      overflow: "hidden",
      pointerEvents: "none",
    });
    b.appendChild(label);
    onTap(b, () => {
      const row = rows[i];
      if (row !== undefined) o.onPick(row.id);
    });
    el.appendChild(b);
    return { b, label };
  });
  const paint = (i: number): void => {
    const c = cellEls[i];
    if (c === undefined) return;
    const row = rows[i];
    if (row === undefined) {
      c.label.textContent = "";
      c.b.style.display = "none";
      return;
    }
    c.b.style.display = "";
    const cell = bandCell(row, o.stageOf(row.san, row.sanMax), o.strings);
    c.label.textContent = cell.label;
    c.label.style.color = roleColor(cell.role);
  };
  const update = (id: string, f: (row: BandRow) => void): void => {
    const i = rows.findIndex((x) => x.id === id);
    const row = rows[i];
    if (row === undefined) return;
    f(row);
    paint(i);
  };
  return {
    el,
    render(party: readonly Character[]): void {
      rows = party.map((ch) => ({ id: ch.id, name: ch.name, life: ch.life, status: [...ch.status], san: ch.san, sanMax: o.sanMaxOf(ch) }));
      cellEls.forEach((_, i) => paint(i));
    },
    setSan(id: string, san: number): void {
      update(id, (row) => (row.san = san));
    },
    setLife(id: string, life: Character["life"]): void {
      update(id, (row) => (row.life = life));
    },
    setStatus(id: string, status: StatusId, on: boolean): void {
      update(id, (row) => {
        row.status = on ? (row.status.includes(status) ? row.status : [...row.status, status]) : row.status.filter((x) => x !== status);
      });
    },
  };
}
