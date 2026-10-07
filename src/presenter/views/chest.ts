// UI-70（M11）: 宝箱の操作の段。core の chestView の値（人の一覧と canAct、罠の名前の一覧、告げられた名前、掛け合いの担当）から
// 一覧の項目と段の問いを作る（純粋）。押せるか・誰が選べるかは chestView の canAct だけで決め、判定はしない（§3-4。UI-35）。
// 段は表示層の局所の状態（保存しない）。menu → [調べる][解除][開ける][放っておく]、inspect → 調べる人、disarmWho → 解除する人、
// disarmTrap → 罠の名前（chest-traps.json の全種、データの順）。人と罠の段の末尾は [戻る]（一覧の外に固定。UI-11）。
// モジュールのトップレベルでは DOM に触れない。
import type { Strings } from "../../core/data/index";
import type { ChestView, Command } from "../../core/types";
import { formatMessage } from "./message";

export type ChestPage = { kind: "menu" } | { kind: "inspect" } | { kind: "disarmWho" } | { kind: "disarmTrap"; memberId: string };

/** 段の移動・Command の送信・1 つ上の段へ */
export type ChestChoice = { kind: "page"; page: ChestPage } | { kind: "send"; command: Command } | { kind: "back" };

/** 一覧の 1 行。reason は押せない行を押したときに語る 1 文（UI-59 の作法） */
export type ChestEntry = { label: string; disabled: boolean; choice: ChestChoice; reason?: string };

export const CHEST_MENU: ChestPage = { kind: "menu" };

function t(strings: Strings, key: string, params?: Record<string, string | number>): string {
  return formatMessage(strings[key] ?? key, params);
}

/** 人の段の行（canAct でない者は dim で、理由は chest.menu.cannotAct。掛け合いの担当は chest.menu.owner の印） */
function memberEntries(v: ChestView, strings: Strings, choose: (memberId: string) => ChestChoice): ChestEntry[] {
  return v.members.map((m) => ({
    label: m.id === v.ownerId ? t(strings, "chest.menu.owner", { name: m.name }) : m.name,
    disabled: !m.canAct,
    choice: choose(m.id),
    ...(m.canAct ? {} : { reason: t(strings, "chest.menu.cannotAct", { name: m.name }) }),
  }));
}

const BACK = (strings: Strings): ChestEntry => ({ label: t(strings, "common.back"), disabled: false, choice: { kind: "back" } });

/** UI-70: 段の一覧（人と罠の段は末尾が戻る） */
export function chestEntries(page: ChestPage, v: ChestView, strings: Strings): ChestEntry[] {
  switch (page.kind) {
    case "menu":
      return [
        { label: t(strings, "chest.menu.inspect"), disabled: false, choice: { kind: "page", page: { kind: "inspect" } } },
        { label: t(strings, "chest.menu.disarm"), disabled: false, choice: { kind: "page", page: { kind: "disarmWho" } } },
        { label: t(strings, "chest.menu.open"), disabled: false, choice: { kind: "send", command: { type: "chest.open" } } },
        { label: t(strings, "chest.menu.leave"), disabled: false, choice: { kind: "send", command: { type: "chest.leave" } } },
      ];
    case "inspect":
      return [...memberEntries(v, strings, (memberId) => ({ kind: "send", command: { type: "chest.inspect", memberId } })), BACK(strings)];
    case "disarmWho":
      return [...memberEntries(v, strings, (memberId) => ({ kind: "page", page: { kind: "disarmTrap", memberId } })), BACK(strings)];
    case "disarmTrap": {
      // 告げられた名前（finding。偽りもありうる）には印。並びはデータの順のまま（数字キーの位置を変えない）
      const found = v.finding?.trapId ?? null;
      const traps = v.trapNames.map(
        (x): ChestEntry => ({
          label: x.id === found ? t(strings, "chest.menu.found", { name: x.name }) : x.name,
          disabled: false,
          choice: { kind: "send", command: { type: "chest.disarm", memberId: page.memberId, trapId: x.id } },
        }),
      );
      return [...traps, BACK(strings)];
    }
  }
}

/** UI-70: 段の問い（ヘッダーに出す）。menu は null（ヘッダーは場所のまま。問い chest.prompt は core がメッセージ窓に語る） */
export function chestHeading(page: ChestPage, v: ChestView, strings: Strings): string | null {
  switch (page.kind) {
    case "menu":
      return null;
    case "inspect":
      return t(strings, "chest.menu.whoInspect");
    case "disarmWho":
      return t(strings, "chest.menu.whoDisarm");
    case "disarmTrap": {
      const name = v.members.find((m) => m.id === page.memberId)?.name ?? "";
      return t(strings, "chest.menu.which", { name });
    }
  }
}

/** 1 つ上の段（menu では null） */
export function chestParent(page: ChestPage): ChestPage | null {
  switch (page.kind) {
    case "menu":
      return null;
    case "inspect":
    case "disarmWho":
      return CHEST_MENU;
    case "disarmTrap":
      return { kind: "disarmWho" };
  }
}

/** 成り立たない段を直す（罠の段の人がもう動けない・いない → 人の段へ） */
export function chestRepair(page: ChestPage, v: ChestView): ChestPage {
  if (page.kind !== "disarmTrap") return page;
  return v.members.some((m) => m.id === page.memberId && m.canAct) ? page : { kind: "disarmWho" };
}
