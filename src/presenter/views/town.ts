// UI-52 の街。施設メニューは 酒場・宿屋・寺院 / 闇魔術・迷宮へ・店 の 3 列 × 2 段の 6 枠（操作領域の layout.townMenu）。各施設はリスト選択。
// 街の画面は迷宮の画面（views/dungeon.ts）の 5 領域をそのまま使う（ビューは枠だけ）。ここはページの中身を決める純粋な部分。
// 料金・押せるか・候補（宿のランク、寺院・闇魔術の対象、救済の候補、店の売り物と持たせる者、入れる迷宮）は core の townMenu の値だけで決める（UI-35）。
// 表示層は式を持たない。どの項目で何を送るか（town.inn / town.temple / town.dark / town.mercy / town.shop / dungeon.enter）は app が決める。
import type { Strings } from "../../core/data/index";
import type { TownMenu } from "../../core/types";
import { formatMessage } from "./message";

export type TempleService = "resurrect" | "cure" | "uncurse";
/** 街のページ。{ temple: s } は寺院のサービス s の対象の一覧、{ shop: itemId } は店でその品を持たせるメンバーの一覧 */
export type TownPage = "menu" | "tavern" | "inn" | "temple" | "dark" | "gate" | "shop" | { temple: TempleService } | { shop: string };
export type TownEntry =
  | { kind: "page"; to: TownPage; label: string }
  | { kind: "inn"; rank: number; label: string; disabled: boolean }
  | { kind: "temple"; service: TempleService; memberId: string; label: string; disabled: boolean }
  | { kind: "dark"; memberId: string; label: string; disabled: boolean }
  /** 寺院のサービス・闇魔術の対象がいない（「その必要がある者はいない」。押すと同じ文を語る） */
  | { kind: "templeNone"; label: string }
  | { kind: "mercy"; memberId: string; label: string }
  | { kind: "enter"; dungeonId: string; label: string; disabled: boolean }
  /** TW-05: 店の売り物の行（名前と価格。払えなければ disabled）。押すと { shop: itemId } のページへ */
  | { kind: "shopItem"; itemId: string; label: string; disabled: boolean }
  /** TW-05: 持たせるメンバーの行（名前と所持枠の空き。空きが無いか払えなければ disabled）。押すと town.shop の buy */
  | { kind: "buy"; itemId: string; memberId: string; label: string; disabled: boolean }
  | { kind: "back"; label: string };

const TEMPLE_SERVICES: readonly TempleService[] = ["resurrect", "cure", "uncurse"];

function s(strings: Strings, key: string, params?: Record<string, string | number>): string {
  return formatMessage(strings[key] ?? key, params);
}

/** 同じページか（{ temple } は service、{ shop } は itemId で比べる） */
export function samePage(a: TownPage, b: TownPage): boolean {
  if (typeof a === "string" || typeof b === "string") return a === b;
  if ("temple" in a) return "temple" in b && a.temple === b.temple;
  return "shop" in b && a.shop === b.shop;
}

/** 1 つ上のページ（Esc・戻る）。menu は null */
export function townParent(page: TownPage): TownPage | null {
  if (page === "menu") return null;
  if (typeof page === "object") return "temple" in page ? "temple" : "shop";
  return "menu";
}

/** そのページのリストの項目（menu は 3 列 × 2 段の 6 枠。それ以外は一覧で末尾が戻る） */
export function townEntries(page: TownPage, menu: TownMenu, strings: Strings): TownEntry[] {
  const back: TownEntry = { kind: "back", label: s(strings, "common.back") };
  if (page === "menu") {
    return [
      { kind: "page", to: "tavern", label: s(strings, "town.menu.tavern") },
      { kind: "page", to: "inn", label: s(strings, "town.menu.inn") },
      { kind: "page", to: "temple", label: s(strings, "town.menu.temple") },
      { kind: "page", to: "dark", label: s(strings, "town.menu.dark") },
      { kind: "page", to: "gate", label: s(strings, "town.menu.dungeon") },
      { kind: "page", to: "shop", label: s(strings, "town.menu.shop") },
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
  if (page === "dark") {
    // TW-08: ash の者の行（名前と料金。払えなければ disabled）。押すと town.dark
    const rows = menu.dark.map(
      (r): TownEntry => ({ kind: "dark", memberId: r.memberId, label: s(strings, "town.dark.row", { name: r.name, cost: r.cost }), disabled: !r.affordable }),
    );
    if (rows.length === 0) return [{ kind: "templeNone", label: s(strings, "town.temple.none") }, back];
    return [...rows, back];
  }
  if (page === "gate") {
    const rows = menu.dungeons.map((d): TownEntry => ({ kind: "enter", dungeonId: d.id, label: d.name, disabled: !d.canEnter }));
    return [...rows, back];
  }
  if (page === "shop") {
    // TW-05: 売り物の行（名前と価格。払えなければ disabled）
    const rows = menu.shop.items.map(
      (r): TownEntry => ({ kind: "shopItem", itemId: r.itemId, label: s(strings, "town.shop.row", { name: r.name, cost: r.price }), disabled: !r.affordable }),
    );
    return [...rows, back];
  }
  if ("shop" in page) {
    // TW-05: 持たせるメンバーの行（生きている者を並び順で。所持枠の空きが無い者・払えないときは disabled）
    const itemId = page.shop;
    const affordable = menu.shop.items.find((r) => r.itemId === itemId)?.affordable ?? false;
    const rows = menu.shop.members.map(
      (m): TownEntry => ({
        kind: "buy",
        itemId,
        memberId: m.memberId,
        label: s(strings, "town.shop.member", { name: m.name, slots: m.slotsFree }),
        disabled: !affordable || m.slotsFree <= 0,
      }),
    );
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
  if (page === "dark") return ["town.dark.intro"];
  if (page === "gate") return ["town.dungeonGate.intro"];
  if (page === "shop") return ["town.shop.intro"];
  if (typeof page === "object" && "shop" in page) return ["town.shop.whom"];
  return [];
}

/** UI-52: 街のヘッダー（所持金） */
export function townHeader(menu: TownMenu, strings: Strings): string {
  return s(strings, "town.header", { gold: menu.gold });
}
