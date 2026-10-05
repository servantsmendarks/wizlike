// UI-59（M7）: 品の詳細（キャンプ・酒場の装備の段で品を選ぶと開く）と、IT-66 の図鑑（酒場の一覧の「図鑑」）の行。
// 値は core の itemDetail / uniqueBookView の値だけで決める（UI-35。式・判定を持たない）。ここは文字列を組むだけの純粋な部分で、
// 描くのはキャンプのパネル（views/camp.ts の lines）。行は 10px で、パネル（ビュー領域 150px）に見出し + 13 行まで。
import type { Strings } from "../../core/data/index";
import type { ItemDetail, UniqueBookRow } from "../../core/rules/item-view";
import { formatMessage } from "./message";

/** パネルの 1 行。tone は色（danger は負のオプションと呪い、dim は説明） */
export type PanelLine = { text: string; tone: "normal" | "danger" | "dim" };
export type PanelLines = { title: string; lines: PanelLine[] };

/** 説明を 1 行に入れる文字数（美咲の全角 8px。パネルの幅 240 − 左右の余白 8 = 232px → 29 字。1 字の余裕を残す） */
export const DESCRIPTION_CHARS = 28;

function s(strings: Strings, key: string, params?: Record<string, string | number>): string {
  return formatMessage(strings[key] ?? key, params);
}

/** 符号付きの値（正は +、0 と負はそのまま） */
function signed(v: number): string {
  return v > 0 ? `+${v}` : String(v);
}

/** 説明を DESCRIPTION_CHARS 字ずつに切る（表示のためだけの計算） */
function chunks(text: string): string[] {
  const chars = Array.from(text);
  const out: string[] = [];
  for (let i = 0; i < chars.length; i += DESCRIPTION_CHARS) out.push(chars.slice(i, i + DESCRIPTION_CHARS).join(""));
  return out;
}

/**
 * UI-59 / IT-11 / IT-12: 品の詳細の行。見出しは表示名。
 * 部位（と Lv）→（未鑑定なら「鑑定するまで分からない」だけ）→ 希少度（装備だけ）→ 性能（ダメージ・魔法攻撃力・後列から届く / AC）→ オプション → 固有スキル → 呪い → 売値 → 説明
 */
export function formatItemDetail(d: ItemDetail, strings: Strings): PanelLines {
  const line = (text: string, tone: PanelLine["tone"] = "normal"): PanelLine => ({ text, tone });
  const slot = d.slot === null ? s(strings, "item.detail.consumable") : s(strings, `detail.slot.${d.slot}`);
  const lines: PanelLine[] = [line(d.level === null ? s(strings, "item.detail.slot", { slot }) : s(strings, "item.detail.slotLv", { slot, level: d.level }))];
  if (!d.identified) return { title: d.name, lines: [...lines, line(s(strings, "item.detail.unidentified"))] };
  // IT-31: 希少度（通常も出す。語は図鑑と同じ book.rarity.*）。鑑定済みの装備だけ（消耗品・魔法書は rarity が null）
  if (d.rarity !== null) lines.push(line(s(strings, "item.detail.rarity", { rarity: s(strings, `book.rarity.${d.rarity}`) })));
  const p = d.power;
  if (p !== null && p.kind === "weapon") {
    lines.push(line(p.damageBonus > 0 ? s(strings, "item.detail.damagePlus", { dice: p.dice, bonus: p.damageBonus }) : s(strings, "item.detail.damage", { dice: p.dice })));
    if (p.caster || p.magicPower > 0) lines.push(line(s(strings, "item.detail.magicPower", { value: p.magicPower })));
    if (p.ranged) lines.push(line(s(strings, "item.detail.ranged")));
  } else if (p !== null) {
    lines.push(line(s(strings, "item.detail.ac", { ac: p.ac })));
  }
  for (const o of d.options) lines.push(line(s(strings, "item.option.row", { name: o.name, value: signed(o.value), unit: o.unit }), o.bad ? "danger" : "normal"));
  if (d.skill !== null) lines.push(line(s(strings, `item.skill.${d.skill.type}`, { value: d.skill.value })));
  if (d.cursed) lines.push(line(s(strings, "item.cursed"), "danger"));
  if (d.sellPrice !== null) lines.push(line(s(strings, "item.detail.sell", { gold: d.sellPrice })));
  if (d.description !== null) lines.push(...chunks(d.description).map((t) => line(t, "dim")));
  return { title: d.name, lines };
}

/** IT-66: 図鑑の行（uniques.json の順）。記録の無いものは book.unknown、入手ダンジョンが無ければ book.noPlace */
export function formatBook(rows: readonly UniqueBookRow[], strings: Strings): PanelLines {
  const known = rows.filter((r) => r.known).length;
  return {
    title: s(strings, "book.title", { known, total: rows.length }),
    lines: rows.map((r): PanelLine => {
      if (!r.known || r.name === null) return { text: s(strings, "book.unknown"), tone: "dim" };
      return {
        text: s(strings, "book.row", {
          name: r.name,
          place: r.foundIn ?? s(strings, "book.noPlace"),
          rarity: s(strings, `book.rarity.${r.bestRarity ?? "normal"}`),
        }),
        tone: "normal",
      };
    }),
  };
}
