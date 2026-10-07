// UI-59 キャラクター画面（M10。M4.5〜M9 のキャンプの「状態」を全画面にした）: キャンプと酒場のパネル（views/camp.ts。layout.character = 240×284）に出す 1 人分の表示。
// 表示だけで、操作は無い（操作はキャンプの枠。app が扱う）。装備の段では、選んでいる枠の行を accent 色にする（focusSlot）。
// - formatCharacter は純粋: 名前、種族、職業の正式名（classes[].name。パーティの行の略称ではない）、レベル・経験値・次のレベル（UI-69）、
//   HP / MP / SAN、状態、能力値 6 つ、攻撃・AC・魔法攻撃力、装備 6 枠（名前は呼び出し側が渡す itemName = 鑑定を反映した表示名。空きは detail.equipNone）、
//   所持品（core の campMenu の members[].inventory）、習得呪文（members[].knownSpells。戦闘外で唱えられない呪文は dim）。
// - 行は 10px で y = 4 + 10i（rect の外形の左上から。子の absolute は枠 1px の内側が原点なので、置くときに 1 引く）の 27 行（CHARACTER_LINES）。
//   0 名前（accent）、1 種族・職業、2 レベル（x4）・経験値（x56）・次（x120。UI-69）、3 HP / MP / SAN（x4 / x84 / x164）、4 状態、
//   5〜6 能力値（3 列 × 2 行）、7 攻撃（x4）・AC（x84）・魔法攻撃力（x164）、8〜13 装備の枠名（x4）と名前（x40）、
//   14 所持品の見出し（使用枠 / 上限）、15〜18 所持品 2 列 × 4 行（x4 / x122、幅 114）、19 呪文の見出し、20〜26 習得呪文 2 列 × 7 行。下端は 274。
// - 所持品は 8 件・呪文は 14 件を超えると最後の枠を「ほか {n}」にする。頁の段（渡す・捨てる・呪文）では、その頁の品・呪文をそのまま出す。
// - 次のレベルの列（UI-69）は core の memberSheet の levelUpView で 3 通りに分けるだけ（判定はしない。UI-35）:
//   ready は detail.levelUpReady（accent）、next は detail.nextLevel{n}（n は expToNext）、blocked は空欄。
// 能力値と枠の並びは表示層の型付き定数（STAT_ORDER / SLOT_ORDER。core/data の値は UI-35 の許可外なので import しない）。
// モジュールのトップレベルでは DOM に触れない。
import type { EquipSlot, GameData, StatKey, Strings } from "../../core/data/index";
import type { MemberSheet } from "../../core/rules/item-view";
import type { CampMember, Character } from "../../core/types";
import type { Rect } from "../layout";
import { formatMessage } from "./message";
import { conditionText } from "./party";

/** 能力値の並び（core の STAT_KEYS と同じ順。テストで一致を確かめる） */
export const STAT_ORDER = ["str", "iq", "pie", "vit", "agi", "luk"] as const satisfies readonly StatKey[];
/** 装備の枠の並び（core の EQUIP_SLOTS と同じ順。テストで一致を確かめる） */
export const SLOT_ORDER = ["weapon", "armor", "shield", "helm", "gauntlet", "accessory"] as const satisfies readonly EquipSlot[];
/** UI-59（M10）: 所持品の枠（2 列 × 4 行）と呪文の枠（2 列 × 7 行）の数。渡す・捨てる・呪文の段の 1 頁の件数も同じ */
export const CHARACTER_INVENTORY_CELLS = 8;
export const CHARACTER_SPELL_CELLS = 14;

/** 所持品・呪文の 1 枠。dim は dim 色（戦闘外で唱えられない呪文） */
export type CharacterCell = { text: string; dim: boolean };

export type CharacterDetail = {
  name: string;
  /** detail.raceClass（種族の名前と職業の正式名） */
  raceClass: string;
  level: string;
  exp: string;
  /** UI-69（M10）: 次のレベルの列（ready は「Lv UP 可（宿で処理）」で accent、next は「次の Lv まで あと n」、blocked と sheet なしは空） */
  next: { text: string; ready: boolean };
  hp: string;
  mp: string;
  san: string;
  /** TW-15（M7）: SAN が上限（sanCap）を超えている（士気の超過中）。真なら SAN の行を accent 色（UI-59 / UI-12） */
  sanOver: boolean;
  status: string;
  /** 能力値 6 つ（STAT_ORDER の順）。text は detail.stat「{label} {value}」 */
  stats: { label: string; value: number; text: string }[];
  /**
   * M7 / CB-22: 攻撃（detail.attack「攻撃 1d8+3」。core の memberSheet の attackDamageDice（武器ダイスの定数と足し分を 1 つの定数に合算した実効値。2026-10-06）。
   * 合計 0 なら「攻撃 1d8」、負なら「攻撃 1d8-1」）。
   * sheet が無ければ空
   */
  attack: string;
  /** M7 / CB-20: AC（detail.ac。core の memberSheet の ac）。sheet が無ければ空 */
  ac: string;
  /** M7 / MG-33: 魔法攻撃力（detail.magicPower。core の memberSheet の magicPower）。sheet が無ければ空 */
  magicPower: string;
  /** 装備 6 枠（SLOT_ORDER の順）。item は表示名、空きは detail.equipNone */
  equipment: { slot: string; item: string }[];
  /** UI-59（M10）: 所持品の見出し（character.inventoryHeading{used, max}。member が無ければ空） */
  inventoryHeading: string;
  /** UI-59（M10）: 所持品の枠（最大 CHARACTER_INVENTORY_CELLS） */
  inventory: CharacterCell[];
  /** UI-59（M10）: 呪文の見出し（character.spellHeading。member が無ければ空） */
  spellHeading: string;
  /** UI-59（M10）: 習得呪文の枠（最大 CHARACTER_SPELL_CELLS） */
  spells: CharacterCell[];
};

/**
 * 枠に出す分（純粋）。page が無ければ先頭から cap 件、cap を超えるなら最後の枠を「ほか {n}」（n は出していない件数）にする。
 * page があればその頁（cap 件ずつ）をそのまま出す
 */
export function characterCells<T>(items: readonly T[], cap: number, cell: (x: T) => CharacterCell, more: (n: number) => string, page?: number): CharacterCell[] {
  if (page !== undefined) return items.slice(page * cap, (page + 1) * cap).map(cell);
  if (items.length <= cap) return items.map(cell);
  return [...items.slice(0, cap - 1).map(cell), { text: more(items.length - (cap - 1)), dim: false }];
}

/**
 * UI-59 のキャラクター画面の文字列（純粋）。itemName は実体の id → 鑑定を反映した表示名。
 * sheet は core の memberSheet（M7。CH-13 / CH-14 / IT-35 の実効の能力値・最大値・AC・魔法攻撃力。M10 の CH-80 の levelUpView / expToNext）。
 * 能力値と HP / MP / SAN の最大はその値を出し、SAN が sheet.sanMax を超えていれば sanOver（TW-15）。省略すると素の値で、攻撃・AC・魔法攻撃力・次は空。
 * member は core の campMenu の members[] の 1 人（所持品・使用枠・習得呪文）。省略すると所持品と呪文の行は空。
 * view の inventoryPage / spellPage は頁の段（渡す・捨てる・呪文）の頁
 */
export function formatCharacter(
  ch: Character,
  data: Pick<GameData, "races" | "classes">,
  strings: Strings,
  itemName: (instanceId: string) => string,
  sheet?: MemberSheet,
  member?: Pick<CampMember, "inventory" | "slotsUsed" | "slotsMax" | "knownSpells">,
  view: { inventoryPage?: number; spellPage?: number } = {},
): CharacterDetail {
  const s = (key: string, params?: Record<string, string | number>): string => formatMessage(strings[key] ?? key, params);
  const race = data.races.find((r) => r.id === ch.raceId)?.name ?? ch.raceId;
  const cls = data.classes.find((c) => c.id === ch.classId)?.name ?? ch.classId;
  const cond = conditionText(ch.life, ch.status, strings);
  const stats = sheet?.stats ?? ch.stats;
  const sanCap = sheet?.sanMax ?? ch.sanMax;
  const more = (n: number): string => s("character.more", { n });
  const next =
    sheet === undefined || sheet.levelUpView === "blocked"
      ? { text: "", ready: false }
      : sheet.levelUpView === "ready"
        ? { text: s("detail.levelUpReady"), ready: true }
        : { text: s("detail.nextLevel", { n: sheet.expToNext }), ready: false };
  return {
    name: ch.name,
    raceClass: s("detail.raceClass", { race, class: cls }),
    level: s("detail.level", { level: ch.level }),
    exp: s("detail.exp", { exp: ch.exp }),
    next,
    hp: s("detail.hp", { hp: ch.hp, hpMax: sheet?.hpMax ?? ch.hpMax }),
    mp: s("detail.mp", { mp: ch.mp, mpMax: sheet?.mpMax ?? ch.mpMax }),
    san: s("detail.san", { san: ch.san, sanMax: sanCap }),
    sanOver: ch.san > sanCap,
    status: s("detail.status", { status: cond === "" ? s("detail.statusOk") : cond }),
    stats: STAT_ORDER.map((k) => {
      const label = s(`stat.${k}`);
      const value = stats[k];
      return { label, value, text: s("detail.stat", { label, value }) };
    }),
    attack: sheet === undefined ? "" : s("detail.attack", { dice: sheet.attackDamageDice }),
    ac: sheet === undefined ? "" : s("detail.ac", { ac: sheet.ac }),
    magicPower: sheet === undefined ? "" : s("detail.magicPower", { value: sheet.magicPower }),
    equipment: SLOT_ORDER.map((slot) => {
      const id = ch.equipment[slot];
      return { slot: s(`detail.slot.${slot}`), item: id === null ? s("detail.equipNone") : itemName(id) };
    }),
    inventoryHeading: member === undefined ? "" : s("character.inventoryHeading", { used: member.slotsUsed, max: member.slotsMax }),
    inventory:
      member === undefined ? [] : characterCells(member.inventory, CHARACTER_INVENTORY_CELLS, (x) => ({ text: x.name, dim: false }), more, view.inventoryPage),
    spellHeading: member === undefined ? "" : s("character.spellHeading"),
    spells:
      member === undefined
        ? []
        : characterCells(member.knownSpells, CHARACTER_SPELL_CELLS, (x) => ({ text: s("character.spellCell", { name: x.name, mp: x.mp }), dim: !x.castable }), more, view.spellPage),
  };
}

const LINE_H = 10;
const TOP = 4;
/** 外枠の太さ（border 1px） */
const BORDER = 1;
const COL3 = [4, 84, 164] as const;
const COL3_W = 76;
const SLOT_X = 4;
const SLOT_W = 32;
const ITEM_X = 40;
/** UI-69（M10）: 行 2 の 3 列（レベル x4・経験値 x56・次 x120）。次の列は右の余白 4 まで（幅 116） */
export const LEVEL_COLUMNS = {
  level: { x: 4, w: 52 },
  exp: { x: 56, w: 64 },
  next: { x: 120, w: 116 },
} as const;
/** UI-59（M10）: 所持品と呪文の 2 列（x4 / x122、幅 114） */
export const CELL_COLUMNS = [4, 122] as const;
export const CELL_W = 114;
/** UI-59（M10）: 行の位置（所持品の見出し 14・所持品 15〜18・呪文の見出し 19・呪文 20〜26） */
const ROW_INVENTORY_HEAD = 14;
const ROW_SPELL_HEAD = 19;

export type DetailView = {
  el: HTMLElement;
  /** focusSlot は SLOT_ORDER の添字（その枠の行を accent 色）。null なら無し */
  render(d: CharacterDetail, focusSlot?: number | null): void;
};

/** rect は置き場所の範囲（親の要素からの座標）。27 行（layout の CHARACTER_LINES。CHARACTER_MIN_HEIGHT）が入る高さを前提にする */
export function createDetailView(rect: Rect): DetailView {
  const el = document.createElement("div");
  el.className = "detail-view";
  Object.assign(el.style, {
    position: "absolute",
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.w}px`,
    height: `${rect.h}px`,
    background: "var(--c-bg)",
    color: "var(--c-text)",
    border: "1px solid var(--c-frame)",
  });

  /** x と行の y は外形の左上から。子の absolute は枠（1px）の内側が原点なので 1 引く（dice.ts の PAD - 1 と同じ） */
  const text = (row: number, x: number, w: number, value: string, cls: string): HTMLElement => {
    const t = document.createElement("div");
    t.className = cls;
    Object.assign(t.style, {
      position: "absolute",
      left: `${x - BORDER}px`,
      top: `${TOP - BORDER + LINE_H * row}px`,
      width: `${w}px`,
      height: `${LINE_H}px`,
      lineHeight: `${LINE_H}px`,
      whiteSpace: "nowrap",
      overflow: "hidden",
    });
    t.textContent = value;
    return t;
  };
  /** 2 列の枠（所持品・呪文）。first は最初の行 */
  const cells = (first: number, xs: readonly CharacterCell[], cls: string): HTMLElement[] =>
    xs.map((c, i) => {
      const t = text(first + Math.floor(i / 2), CELL_COLUMNS[i % 2]!, CELL_W, c.text, cls);
      if (c.dim) t.style.color = "var(--c-dim)";
      return t;
    });

  return {
    el,
    render(d: CharacterDetail, focusSlot: number | null = null): void {
      const full = rect.w - 8;
      const name = text(0, 4, full, d.name, "detail-name");
      name.style.color = "var(--c-accent)";
      const san = text(3, COL3[2], COL3_W - 8, d.san, "detail-san");
      if (d.sanOver) san.style.color = "var(--c-accent)"; // TW-15: 士気の超過中（UI-12 と同じ色）
      const next = text(2, LEVEL_COLUMNS.next.x, LEVEL_COLUMNS.next.w, d.next.text, "detail-next");
      if (d.next.ready) next.style.color = "var(--c-accent)"; // UI-69: Lv UP 可
      const parts: HTMLElement[] = [
        name,
        text(1, 4, full, d.raceClass, "detail-race-class"),
        text(2, LEVEL_COLUMNS.level.x, LEVEL_COLUMNS.level.w, d.level, "detail-level"),
        text(2, LEVEL_COLUMNS.exp.x, LEVEL_COLUMNS.exp.w, d.exp, "detail-exp"),
        next,
        text(3, COL3[0], COL3_W, d.hp, "detail-hp"),
        text(3, COL3[1], COL3_W, d.mp, "detail-mp"),
        san,
        text(4, 4, full, d.status, "detail-status"),
        ...d.stats.map((st, i) => text(5 + Math.floor(i / 3), COL3[i % 3]!, COL3_W - (i % 3 === 2 ? 8 : 0), st.text, "detail-stat")),
        // 7 行目: M7 の攻撃・AC・魔法攻撃力（能力値の 3 列にそろえる）
        text(7, COL3[0], COL3_W, d.attack, "detail-attack"),
        text(7, COL3[1], COL3_W, d.ac, "detail-ac"),
        text(7, COL3[2], COL3_W - 8, d.magicPower, "detail-magic-power"),
        ...d.equipment.flatMap((e, i) => {
          const row = [text(8 + i, SLOT_X, SLOT_W, e.slot, "detail-slot"), text(8 + i, ITEM_X, rect.w - ITEM_X - 4, e.item, "detail-item")];
          if (i === focusSlot) for (const r of row) r.style.color = "var(--c-accent)";
          return row;
        }),
        text(ROW_INVENTORY_HEAD, 4, full, d.inventoryHeading, "detail-inventory-head"),
        ...cells(ROW_INVENTORY_HEAD + 1, d.inventory, "detail-inventory"),
        text(ROW_SPELL_HEAD, 4, full, d.spellHeading, "detail-spell-head"),
        ...cells(ROW_SPELL_HEAD + 1, d.spells, "detail-spell"),
      ];
      el.replaceChildren(...parts);
    },
  };
}
