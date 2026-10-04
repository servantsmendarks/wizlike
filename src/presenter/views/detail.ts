// UI-59 キャンプの「状態」（旧 UI-58 の詳細）: キャンプと酒場のパネル（views/camp.ts。ビュー領域 240×150）に出す 1 人分の表示。
// 表示だけで、操作は無い（人の切り替えと閉じるはキャンプの枠。app が扱う）。装備の段では、選んでいる枠の行を accent 色にする（focusSlot）。
// - formatDetail は純粋: 名前、種族、職業の正式名（classes[].name。パーティの行の略称ではない）、レベル、経験値、HP / MP / SAN、
//   状態、能力値 6 つ、装備 6 枠（名前は呼び出し側が渡す itemName = 鑑定を反映した表示名。空きは detail.equipNone）。
// - 行は 10px で y = 4 + 10i（rect の外形の左上から。子の absolute は枠 1px の内側が原点なので、置くときに 1 引く）の 14 行。0 名前（accent）、1 種族・職業、2 レベル（x4）と経験値（x120）、3 HP / MP / SAN（x4 / x84 / x164）、
//   4 状態、5〜6 能力値（3 列 × 2 行。x4 / x84 / x164）、7 「装備」、8〜13 装備の枠名（x4）と名前（x40）。下端は 144（ビュー領域 150 に収まる）。
// 能力値と枠の並びは表示層の型付き定数（STAT_ORDER / SLOT_ORDER。core/data の値は UI-35 の許可外なので import しない）。
// モジュールのトップレベルでは DOM に触れない。
import type { EquipSlot, GameData, StatKey, Strings } from "../../core/data/index";
import type { Character } from "../../core/types";
import type { Rect } from "../layout";
import { formatMessage } from "./message";
import { conditionText } from "./party";

/** 能力値の並び（core の STAT_KEYS と同じ順。テストで一致を確かめる） */
export const STAT_ORDER = ["str", "iq", "pie", "vit", "agi", "luk"] as const satisfies readonly StatKey[];
/** 装備の枠の並び（core の EQUIP_SLOTS と同じ順。テストで一致を確かめる） */
export const SLOT_ORDER = ["weapon", "armor", "shield", "helm", "gauntlet", "accessory"] as const satisfies readonly EquipSlot[];

export type CharacterDetail = {
  name: string;
  /** detail.raceClass（種族の名前と職業の正式名） */
  raceClass: string;
  level: string;
  exp: string;
  hp: string;
  mp: string;
  san: string;
  /** TW-15（M7）: SAN が上限（sanCap）を超えている（士気の超過中）。真なら SAN の行を accent 色（UI-59 / UI-12） */
  sanOver: boolean;
  status: string;
  /** 能力値 6 つ（STAT_ORDER の順）。text は detail.stat「{label} {value}」 */
  stats: { label: string; value: number; text: string }[];
  /** 装備の見出し（detail.equipment） */
  equipmentTitle: string;
  /** 装備 6 枠（SLOT_ORDER の順）。item は表示名、空きは detail.equipNone */
  equipment: { slot: string; item: string }[];
};

/**
 * UI-59 の状態の文字列（純粋）。itemName は実体の id → 鑑定を反映した表示名。
 * sanCap は SAN の最大として出す値（app が core の sanCapOf を渡す。省略は ch.sanMax）。SAN が sanCap を超えていれば sanOver
 */
export function formatDetail(
  ch: Character,
  data: Pick<GameData, "races" | "classes">,
  strings: Strings,
  itemName: (instanceId: string) => string,
  sanCap: number = ch.sanMax,
): CharacterDetail {
  const s = (key: string, params?: Record<string, string | number>): string => formatMessage(strings[key] ?? key, params);
  const race = data.races.find((r) => r.id === ch.raceId)?.name ?? ch.raceId;
  const cls = data.classes.find((c) => c.id === ch.classId)?.name ?? ch.classId;
  const cond = conditionText(ch.life, ch.status, strings);
  return {
    name: ch.name,
    raceClass: s("detail.raceClass", { race, class: cls }),
    level: s("detail.level", { level: ch.level }),
    exp: s("detail.exp", { exp: ch.exp }),
    hp: s("detail.hp", { hp: ch.hp, hpMax: ch.hpMax }),
    mp: s("detail.mp", { mp: ch.mp, mpMax: ch.mpMax }),
    san: s("detail.san", { san: ch.san, sanMax: sanCap }),
    sanOver: ch.san > sanCap,
    status: s("detail.status", { status: cond === "" ? s("detail.statusOk") : cond }),
    stats: STAT_ORDER.map((k) => {
      const label = s(`stat.${k}`);
      const value = ch.stats[k];
      return { label, value, text: s("detail.stat", { label, value }) };
    }),
    equipmentTitle: s("detail.equipment"),
    equipment: SLOT_ORDER.map((slot) => {
      const id = ch.equipment[slot];
      return { slot: s(`detail.slot.${slot}`), item: id === null ? s("detail.equipNone") : itemName(id) };
    }),
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

export type DetailView = {
  el: HTMLElement;
  /** focusSlot は SLOT_ORDER の添字（その枠の行を accent 色）。null なら無し */
  render(d: CharacterDetail, focusSlot?: number | null): void;
};

/** rect は置き場所の範囲（親の要素からの座標） */
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

  return {
    el,
    render(d: CharacterDetail, focusSlot: number | null = null): void {
      const full = rect.w - 8;
      const name = text(0, 4, full, d.name, "detail-name");
      name.style.color = "var(--c-accent)";
      const san = text(3, COL3[2], COL3_W - 8, d.san, "detail-san");
      if (d.sanOver) san.style.color = "var(--c-accent)"; // TW-15: 士気の超過中（UI-12 と同じ色）
      const parts: HTMLElement[] = [
        name,
        text(1, 4, full, d.raceClass, "detail-race-class"),
        text(2, 4, 112, d.level, "detail-level"),
        text(2, 120, rect.w - 124, d.exp, "detail-exp"),
        text(3, COL3[0], COL3_W, d.hp, "detail-hp"),
        text(3, COL3[1], COL3_W, d.mp, "detail-mp"),
        san,
        text(4, 4, full, d.status, "detail-status"),
        ...d.stats.map((st, i) => text(5 + Math.floor(i / 3), COL3[i % 3]!, COL3_W - (i % 3 === 2 ? 8 : 0), st.text, "detail-stat")),
        text(7, 4, full, d.equipmentTitle, "detail-equipment"),
        ...d.equipment.flatMap((e, i) => {
          const row = [text(8 + i, SLOT_X, SLOT_W, e.slot, "detail-slot"), text(8 + i, ITEM_X, rect.w - ITEM_X - 4, e.item, "detail-item")];
          if (i === focusSlot) for (const r of row) r.style.color = "var(--c-accent)";
          return row;
        }),
      ];
      el.replaceChildren(...parts);
    },
  };
}
