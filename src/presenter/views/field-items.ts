// UI-53 迷宮の道具（戦闘の外。DG-30 の帰還の糸、MG-25 の魔法書、薬草など）。使う人 → 道具 → 対象 の 3 段の純粋な状態機械。
// 候補・押せるか・対象の要否は core の fieldItemMenu の値だけで決める（UI-35）。送る Command は dungeon.useItem。
// - member 段: パーティ全員（行動できない者・使える品の無い者は disabled）＋ 戻る（閉じる）。
// - item 段: その人の道具（usable 偽は disabled）＋ 戻る。対象の要らない品（target none）はここで送る。
// - target 段: 生きている味方の行（名前と HP）＋ 戻る。選ぶと targetId 付きで送る。
// DOM には触れない（一覧の描画と結線は app）。
import type { Strings } from "../../core/data/index";
import type { Command, FieldItemMenu } from "../../core/types";
import type { Action } from "../input/swipe";
import { formatMessage } from "./message";

export type ItemCursor =
  | { stage: "member" }
  | { stage: "item"; memberId: string }
  | { stage: "target"; memberId: string; instanceId: string };

export type ItemChoice =
  | { kind: "member"; memberId: string }
  | { kind: "item"; instanceId: string }
  | { kind: "target"; targetId: string }
  | { kind: "back" };

export type ItemEntry = { label: string; disabled: boolean; choice: ItemChoice };

/** 段を進めるか、閉じるか、送る（送るときは overlay を閉じてから送る） */
export type ItemStep = { kind: "cursor"; cursor: ItemCursor } | { kind: "close" } | { kind: "send"; command: Command };

function s(strings: Strings, key: string, params?: Record<string, string | number>): string {
  return formatMessage(strings[key] ?? key, params);
}

const BACK = (strings: Strings): ItemEntry => ({ label: s(strings, "common.back"), disabled: false, choice: { kind: "back" } });

/** その段の一覧（末尾が戻る） */
export function itemEntries(menu: FieldItemMenu, cur: ItemCursor, strings: Strings): ItemEntry[] {
  if (cur.stage === "member") {
    return [
      ...menu.members.map((m): ItemEntry => ({ label: m.name, disabled: !m.canAct || m.items.length === 0, choice: { kind: "member", memberId: m.id } })),
      BACK(strings),
    ];
  }
  if (cur.stage === "item") {
    const m = menu.members.find((x) => x.id === cur.memberId);
    const items = m?.items ?? [];
    return [...items.map((it): ItemEntry => ({ label: it.name, disabled: !it.usable, choice: { kind: "item", instanceId: it.instanceId } })), BACK(strings)];
  }
  return [
    ...menu.allies.map(
      (a): ItemEntry => ({
        label: s(strings, "dungeon.items.allyRow", { name: a.name, hp: a.hp, hpMax: a.hpMax }),
        disabled: false,
        choice: { kind: "target", targetId: a.id },
      }),
    ),
    BACK(strings),
  ];
}

/** その段の見出し（ヘッダーに出す） */
export function itemHeader(menu: FieldItemMenu, cur: ItemCursor, strings: Strings): string {
  if (cur.stage === "member") return s(strings, "dungeon.items.who");
  if (cur.stage === "item") return s(strings, "dungeon.items.which", { name: menu.members.find((m) => m.id === cur.memberId)?.name ?? "" });
  return s(strings, "dungeon.items.target");
}

/** 1 つ選ぶ。戻るは 1 段上へ（member 段では閉じる） */
export function itemStep(menu: FieldItemMenu, cur: ItemCursor, choice: ItemChoice): ItemStep {
  if (choice.kind === "back") {
    if (cur.stage === "member") return { kind: "close" };
    if (cur.stage === "item") return { kind: "cursor", cursor: { stage: "member" } };
    return { kind: "cursor", cursor: { stage: "item", memberId: cur.memberId } };
  }
  if (cur.stage === "member" && choice.kind === "member") return { kind: "cursor", cursor: { stage: "item", memberId: choice.memberId } };
  if (cur.stage === "item" && choice.kind === "item") {
    const it = menu.members.find((m) => m.id === cur.memberId)?.items.find((x) => x.instanceId === choice.instanceId);
    if (it === undefined) return { kind: "cursor", cursor: cur };
    if (it.target === "ally") return { kind: "cursor", cursor: { stage: "target", memberId: cur.memberId, instanceId: it.instanceId } };
    return { kind: "send", command: { type: "dungeon.useItem", memberId: cur.memberId, itemId: it.instanceId } };
  }
  if (cur.stage === "target" && choice.kind === "target") {
    return { kind: "send", command: { type: "dungeon.useItem", memberId: cur.memberId, itemId: cur.instanceId, targetId: choice.targetId } };
  }
  return { kind: "cursor", cursor: cur };
}

/**
 * UI-33 のキー: 数字 n → n 番目、Enter → 先頭の押せる行、Esc → 戻る（末尾）。該当が無ければ null。
 * 押せない行の番号も返す（選んでも何もしないのは一覧の側）
 */
export function itemKeyIndex(a: Action, entries: readonly ItemEntry[]): number | null {
  if (typeof a === "object") return a.menu < entries.length ? a.menu : null;
  if (a === "confirm") {
    const i = entries.findIndex((e) => !e.disabled);
    return i < 0 ? null : i;
  }
  if (a === "back") return entries.length > 0 ? entries.length - 1 : null;
  return null;
}
