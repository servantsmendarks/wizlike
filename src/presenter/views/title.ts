// UI-50 / SV-11 / SV-12 / SV-14 のタイトル。ゲーム一覧の行 → 新しく始める → 設定 の 1 本のリスト。
// 新しく始める → おすすめで始める / 自分で作る / やめる（M5.5）。
// 行を選ぶと 続きから / 削除 / やめる。削除は確認 2 段階で、先頭（Enter・1）は「やめる」。
// 純粋な部分（titleEntries / titleStep / titleKeyIndex / titleItems / titleNotice / titleRowLabels / formatUpdatedAt）は
// DOM に触れないので node でテストできる。保存先の読み書きは app が SaveService で行う（ここは描くだけ）。
// モジュールのトップレベルでは DOM に触れない。
import type { Strings } from "../../core/data/index";
import type { GameListEntry } from "../../save/types";
import type { Action } from "../input/swipe";
import { TITLE_BUTTONS, TITLE_HEADING_Y, TITLE_NOTICE, TITLE_ROW_AREA, TITLE_ROW_PITCH, type Rect } from "../layout";
import { formatMessage } from "./message";
import { onTap } from "../input/tap";

export type TitlePage =
  | { kind: "list" }
  /** UI-50（M5.5）: 新しく始める → おすすめで始める / 自分で作る / やめる */
  | { kind: "newMode" }
  | { kind: "game"; gameId: string }
  | { kind: "confirm1"; gameId: string }
  | { kind: "confirm2"; gameId: string };

export type TitleEntry =
  | { kind: "game"; entry: GameListEntry }
  | { kind: "newGame" }
  | { kind: "quick" }
  | { kind: "custom" }
  | { kind: "settings" }
  | { kind: "continue"; gameId: string; disabled: boolean }
  | { kind: "delete"; gameId: string }
  | { kind: "deleteYes"; gameId: string }
  | { kind: "cancel" };

/**
 * 1 つ選んだ結果。page は表示だけの遷移、それ以外は app が保存先や画面を操作する。
 * newGame は app が上限（SV-11）を見てから newMode のページへ、quick は簡易作成（UI-51）、custom は自分で作る（UI-62）へ
 */
export type TitleStep =
  | { kind: "page"; page: TitlePage }
  | { kind: "newGame" }
  | { kind: "quick" }
  | { kind: "custom" }
  | { kind: "settings" }
  | { kind: "continue"; gameId: string }
  | { kind: "remove"; gameId: string }
  | { kind: "none" };

/** 描く 1 項目。lines は 1 行（ボタン）か 2 行（一覧の行）。dim は見た目だけ、disabled は押しても何もしない */
export type TitleItem = { entry: TitleEntry; lines: string[]; dim: boolean; disabled: boolean };

const find = (list: readonly GameListEntry[], id: string): GameListEntry | undefined => list.find((e) => e.gameId === id);

/** UI-50: ページごとの項目の並び。list は一覧（与えられた順 = updatedAt の降順）→ 新しく始める → 設定 */
export function titleEntries(page: TitlePage, list: readonly GameListEntry[]): TitleEntry[] {
  if (page.kind === "list") return [...list.map((entry): TitleEntry => ({ kind: "game", entry })), { kind: "newGame" }, { kind: "settings" }];
  if (page.kind === "newMode") return [{ kind: "quick" }, { kind: "custom" }, { kind: "cancel" }];
  const e = find(list, page.gameId);
  if (e === undefined) return [{ kind: "cancel" }];
  if (page.kind === "game") {
    // SV-12: 読めない記録（壊れた・新しすぎる版）は続きからできないが、削除はできる
    return [{ kind: "continue", gameId: e.gameId, disabled: e.status !== "ok" }, { kind: "delete", gameId: e.gameId }, { kind: "cancel" }];
  }
  // SV-14: 確認の先頭は「やめる」（Enter・1 で消えないように）
  return [{ kind: "cancel" }, { kind: "deleteYes", gameId: e.gameId }];
}

/** SV-14: 削除は confirm1 → confirm2 の 2 段階で、confirm2 の「消す」だけが remove。やめるは 1 つ上へ */
export function titleStep(page: TitlePage, e: TitleEntry): TitleStep {
  switch (e.kind) {
    case "game":
      return { kind: "page", page: { kind: "game", gameId: e.entry.gameId } };
    case "newGame":
      return { kind: "newGame" };
    case "quick":
      return { kind: "quick" };
    case "custom":
      return { kind: "custom" };
    case "settings":
      return { kind: "settings" };
    case "continue":
      return e.disabled ? { kind: "none" } : { kind: "continue", gameId: e.gameId };
    case "delete":
      return { kind: "page", page: { kind: "confirm1", gameId: e.gameId } };
    case "deleteYes":
      if (page.kind === "confirm1") return { kind: "page", page: { kind: "confirm2", gameId: e.gameId } };
      if (page.kind === "confirm2") return { kind: "remove", gameId: e.gameId };
      return { kind: "none" };
    case "cancel":
      if (page.kind === "confirm1" || page.kind === "confirm2") return { kind: "page", page: { kind: "game", gameId: page.gameId } };
      return { kind: "page", page: { kind: "list" } };
  }
}

/** UI-33: 数字 n → n 番目、Enter → 先頭、Esc → やめる（やめるが無いページ = list では無視）。該当なしは null */
export function titleKeyIndex(a: Action, entries: readonly TitleEntry[]): number | null {
  if (a === "confirm") return entries.length > 0 ? 0 : null;
  if (a === "back") {
    const i = entries.findIndex((e) => e.kind === "cancel");
    return i < 0 ? null : i;
  }
  if (typeof a === "object") return a.menu >= 0 && a.menu < entries.length ? a.menu : null;
  return null;
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** SV-12 の最終更新日時（端末のローカル時刻。toLocaleString は使わない）。月日時分は 2 桁の 0 詰め */
export function formatUpdatedAt(ms: number): { y: string; mo: string; d: string; hh: string; mm: string } {
  const t = new Date(ms);
  return {
    y: String(t.getFullYear()),
    mo: pad2(t.getMonth() + 1),
    d: pad2(t.getDate()),
    hh: pad2(t.getHours()),
    mm: pad2(t.getMinutes()),
  };
}

const tr = (strings: Strings, k: string): string => strings[k] ?? k;

/**
 * SV-12: 一覧の行の 2 行。1 行目 リーダー名・生存 n/size・踏破数、2 行目 最終更新日時。
 * 新しすぎる版は 2 行目を title.rowTooNew にする。壊れた記録は summary が空の仮の値なので、1 行目を title.rowBroken、2 行目を空にする
 */
export function titleRowLabels(entry: GameListEntry, size: number, strings: Strings): [string, string] {
  if (entry.status === "broken") return [tr(strings, "title.rowBroken"), ""];
  const s = entry.summary;
  const line1 = formatMessage(tr(strings, "title.row"), { leader: s.leaderName, alive: s.aliveCount, size, cleared: s.clearedCount });
  if (entry.status === "tooNew") return [line1, tr(strings, "title.rowTooNew")];
  return [line1, formatMessage(tr(strings, "title.rowDate"), formatUpdatedAt(entry.updatedAt))];
}

/** 描く項目（ラベルと dim / disabled）。size は config.party.size */
export function titleItems(page: TitlePage, list: readonly GameListEntry[], size: number, strings: Strings): TitleItem[] {
  return titleEntries(page, list).map((e): TitleItem => {
    switch (e.kind) {
      case "game":
        return { entry: e, lines: titleRowLabels(e.entry, size, strings), dim: e.entry.status !== "ok", disabled: false };
      case "newGame":
        return { entry: e, lines: [tr(strings, "title.newGame")], dim: false, disabled: false };
      case "quick":
        return { entry: e, lines: [tr(strings, "title.mode.quick")], dim: false, disabled: false };
      case "custom":
        return { entry: e, lines: [tr(strings, "title.mode.custom")], dim: false, disabled: false };
      case "settings":
        return { entry: e, lines: [tr(strings, "title.settings")], dim: false, disabled: false };
      case "continue":
        return { entry: e, lines: [tr(strings, "title.continue")], dim: e.disabled, disabled: e.disabled };
      case "delete":
        return { entry: e, lines: [tr(strings, "title.delete")], dim: false, disabled: false };
      case "deleteYes":
        return { entry: e, lines: [tr(strings, "title.deleteYes")], dim: false, disabled: false };
      case "cancel":
        return { entry: e, lines: [tr(strings, "title.cancel")], dim: false, disabled: false };
    }
  });
}

/** 案内の欄の文。list は一覧が空なら title.empty、game は行の 1 行目、confirm1 / confirm2 は削除の確認 */
export function titleNotice(page: TitlePage, list: readonly GameListEntry[], size: number, strings: Strings): string {
  if (page.kind === "list") return list.length === 0 ? tr(strings, "title.empty") : "";
  if (page.kind === "newMode") return tr(strings, "title.mode.notice");
  const e = find(list, page.gameId);
  if (e === undefined) return "";
  const line1 = titleRowLabels(e, size, strings)[0];
  if (page.kind === "game") return line1;
  if (page.kind === "confirm1") {
    const leader = e.status === "broken" ? line1 : e.summary.leaderName;
    return formatMessage(tr(strings, "title.deleteConfirm1"), { leader });
  }
  return tr(strings, "title.deleteConfirm2");
}

// ---------------------------------------------------------------- DOM

export type TitleScreen = {
  el: HTMLElement;
  /** 項目を描き直す。一覧の行（kind game）は行の欄へ、それ以外は TITLE_BUTTONS の順に置く。notice は案内の欄 */
  render(items: readonly TitleItem[], notice: string): void;
};

function place(el: HTMLElement, r: Rect): void {
  Object.assign(el.style, { position: "absolute", left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
}

export function createTitleScreen(o: { strings: Strings; onSelect(index: number): void }): TitleScreen {
  const el = document.createElement("div");
  el.className = "screen screen-title";

  const heading = document.createElement("div");
  heading.className = "title-heading";
  heading.style.top = `${TITLE_HEADING_Y}px`;
  heading.textContent = tr(o.strings, "title.heading");
  el.appendChild(heading);

  // 一覧の行（maxGames が 5 を超えたら縦スクロール）
  const rows = document.createElement("div");
  rows.className = "title-rows";
  place(rows, TITLE_ROW_AREA);
  // 縦スクロールの容器（touch-action: pan-y は style.css。UI-37）
  Object.assign(rows.style, { overflowY: "auto", overflowX: "hidden" });
  el.appendChild(rows);

  const notice = document.createElement("div");
  notice.className = "title-notice";
  place(notice, TITLE_NOTICE);
  Object.assign(notice.style, { whiteSpace: "pre-wrap", wordBreak: "break-all", lineBreak: "anywhere", overflow: "hidden" });
  el.appendChild(notice);

  const buttons = document.createElement("div");
  el.appendChild(buttons);

  const makeButton = (it: TitleItem, index: number): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ui-button";
    b.textContent = it.lines.join("\n");
    if (it.dim) {
      b.style.color = "var(--c-dim)";
      b.style.borderColor = "var(--c-dim)";
    }
    if (it.disabled) b.setAttribute("aria-disabled", "true");
    onTap(b, () => {
      if (!it.disabled) o.onSelect(index);
    });
    return b;
  };

  return {
    el,
    render(items, text) {
      const rowEls: HTMLElement[] = [];
      const buttonEls: HTMLElement[] = [];
      items.forEach((it, i) => {
        const b = makeButton(it, i);
        if (it.entry.kind === "game") {
          const k = rowEls.length;
          place(b, { x: 0, y: k * TITLE_ROW_PITCH, w: TITLE_ROW_AREA.w, h: TITLE_ROW_PITCH - 2 });
          Object.assign(b.style, { whiteSpace: "pre", textAlign: "left", lineHeight: "14px", paddingLeft: "4px", boxSizing: "border-box" });
          rowEls.push(b);
        } else {
          const r = TITLE_BUTTONS[buttonEls.length];
          if (r === undefined) return;
          place(b, r);
          buttonEls.push(b);
        }
      });
      rows.replaceChildren(...rowEls);
      buttons.replaceChildren(...buttonEls);
      notice.textContent = text;
    },
  };
}
