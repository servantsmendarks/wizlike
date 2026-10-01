// UI-52 の街。施設メニューは 酒場・宿屋・寺院・迷宮へ の 2×2（操作領域の layout.townMenu）。各施設はリスト選択。
// 街の画面は迷宮の画面（views/dungeon.ts）の 5 領域をそのまま使う（ビューは枠だけ）。ここはページの中身を決める純粋な部分。
// 料金・押せるか・候補（宿のランク、寺院の対象、救済の候補、入れる迷宮）は core の townMenu の値だけで決める（UI-35）。
// 表示層は式を持たない。どの項目で何を送るか（town.inn / town.temple / town.mercy / dungeon.enter）は app が決める。
import type { Strings } from "../../core/data/index";
import type { TownMenu } from "../../core/types";
import { formatMessage } from "./message";

export type TempleService = "resurrect" | "cure" | "uncurse";
/** 街のページ。{ temple: s } は寺院のサービス s の対象の一覧 */
export type TownPage = "menu" | "tavern" | "inn" | "temple" | "gate" | { temple: TempleService };
export type TownEntry =
  | { kind: "page"; to: TownPage; label: string }
  | { kind: "inn"; rank: number; label: string; disabled: boolean }
  | { kind: "temple"; service: TempleService; memberId: string; label: string; disabled: boolean }
  | { kind: "templeNone"; label: string }
  | { kind: "mercy"; memberId: string; label: string }
  | { kind: "enter"; dungeonId: string; label: string; disabled: boolean }
  | { kind: "back"; label: string };

const TEMPLE_SERVICES: readonly TempleService[] = ["resurrect", "cure", "uncurse"];

function s(strings: Strings, key: string, params?: Record<string, string | number>): string {
  return formatMessage(strings[key] ?? key, params);
}

/** 同じページか（{ temple } は service で比べる） */
export function samePage(a: TownPage, b: TownPage): boolean {
  if (typeof a === "string" || typeof b === "string") return a === b;
  return a.temple === b.temple;
}

/** 1 つ上のページ（Esc・戻る）。menu は null */
export function townParent(page: TownPage): TownPage | null {
  if (page === "menu") return null;
  if (typeof page === "object") return "temple";
  return "menu";
}

/** そのページのリストの項目（menu は 2×2 の 4 枠。それ以外は一覧で末尾が戻る） */
export function townEntries(page: TownPage, menu: TownMenu, strings: Strings): TownEntry[] {
  const back: TownEntry = { kind: "back", label: s(strings, "common.back") };
  if (page === "menu") {
    return [
      { kind: "page", to: "tavern", label: s(strings, "town.menu.tavern") },
      { kind: "page", to: "inn", label: s(strings, "town.menu.inn") },
      { kind: "page", to: "temple", label: s(strings, "town.menu.temple") },
      { kind: "page", to: "gate", label: s(strings, "town.menu.dungeon") },
    ];
  }
  if (page === "tavern") {
    // TW-31: 救済の申し出の間だけ、dead / ash の者の行（押すと town.mercy）
    const rows = (menu.mercy ?? []).map((m): TownEntry => ({ kind: "mercy", memberId: m.memberId, label: s(strings, "town.tavern.mercyRow", { name: m.name }) }));
    return [...rows, back];
  }
  if (page === "inn") {
    const rows = menu.inn.map(
      (r): TownEntry => ({ kind: "inn", rank: r.rank, label: s(strings, "town.inn.rank", { name: r.name, cost: r.cost }), disabled: !r.affordable }),
    );
    return [...rows, back];
  }
  if (page === "temple") {
    return [...TEMPLE_SERVICES.map((sv): TownEntry => ({ kind: "page", to: { temple: sv }, label: s(strings, `town.temple.${sv}`) })), back];
  }
  if (page === "gate") {
    const rows = menu.dungeons.map((d): TownEntry => ({ kind: "enter", dungeonId: d.id, label: d.name, disabled: !d.canEnter }));
    return [...rows, back];
  }
  const sv = page.temple;
  const rows = menu.temple[sv].map(
    (r): TownEntry => ({
      kind: "temple",
      service: sv,
      memberId: r.memberId,
      label: s(strings, "town.temple.row", { name: r.name, cost: r.cost }),
      disabled: !r.affordable,
    }),
  );
  if (rows.length === 0) return [{ kind: "templeNone", label: s(strings, "town.temple.none") }, back];
  return [...rows, back];
}

/**
 * ページに入ったときにメッセージ窓へ出す語りの strings キー（params なし。再生の外で出す）。
 * 酒場は救済の申し出（menu.mercy が null でない）の間だけ town.mercy.offer も続けて出す
 */
export function townPageIntro(page: TownPage, menu: TownMenu): string[] {
  if (page === "tavern") return menu.mercy !== null ? ["town.tavern.intro", "town.mercy.offer"] : ["town.tavern.intro"];
  if (page === "inn") return ["town.inn.intro"];
  if (page === "temple") return ["town.temple.intro"];
  if (page === "gate") return ["town.dungeonGate.intro"];
  return [];
}

/** UI-52: 街のヘッダー（所持金） */
export function townHeader(menu: TownMenu, strings: Strings): string {
  return s(strings, "town.header", { gold: menu.gold });
}
