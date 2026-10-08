// UI-50 / SV-11 / SV-12 / SV-14 / SV-30〜33 / SV-40 のタイトル。ゲーム一覧の行 → 新しく始める → 設定 → 読み込み の 1 本のリスト。
// 新しく始める → おすすめで始める / 自分で作る / やめる（M5.5）。
// 行を選ぶと 続きから / 書き出し / 削除 / やめる。削除は確認 2 段階で、先頭（Enter・1）は「やめる」。
// 古いファイルの読み込み（SV-32）は確認のページ importConfirm（先頭は「やめる」）。
// 純粋な部分（titleEntries / titleStep / titleKeyIndex / titleItems / titleNotice / titleRowLabels / formatUpdatedAt）は
// DOM に触れないので node でテストできる。保存先の読み書きは app が SaveService で行う（ここは描くだけ）。
// モジュールのトップレベルでは DOM に触れない。
import type { Strings } from "../../core/data/index";
import type { GameListEntry } from "../../save/types";
import type { Action } from "../input/swipe";
import type { SpriteInfo } from "../../build/asset-types";
import { TITLE_BUTTONS, TITLE_HEADING_Y, TITLE_HINT, TITLE_NOTICE, TITLE_PICTURE, TITLE_ROW_AREA, TITLE_ROW_PITCH, type Rect } from "../layout";
import { createTownPicture, TITLE_PICTURE_ID } from "./town-picture";
import { formatMessage } from "./message";
import { attachScrollMarks, marksLeftOf } from "./scroll-marks";
import { WRAP_STYLE } from "./wrap";
import { onTap } from "../input/tap";
import { createFileButton, type FileButton } from "../file-io";

export type TitlePage =
  | { kind: "list" }
  /** UI-50（M5.5）: 新しく始める → おすすめで始める / 自分で作る / やめる */
  | { kind: "newMode" }
  | { kind: "game"; gameId: string }
  | { kind: "confirm1"; gameId: string }
  | { kind: "confirm2"; gameId: string }
  /** SV-32: 古いファイルの読み込みの確認。計画（state を含む）は app が持つ */
  | { kind: "importConfirm"; gameId: string; leader: string; turn: number; existingTurn: number };

export type TitleEntry =
  | { kind: "game"; entry: GameListEntry }
  | { kind: "newGame" }
  | { kind: "quick" }
  | { kind: "custom" }
  | { kind: "settings" }
  | { kind: "continue"; gameId: string; disabled: boolean }
  | { kind: "delete"; gameId: string }
  | { kind: "deleteYes"; gameId: string }
  | { kind: "cancel" }
  /** SV-31: 読み込み（タップは透明の input が直接受ける。ここに来るのはキーボードのとき） */
  | { kind: "import" }
  /** SV-30: 書き出し（読めない記録は disabled） */
  | { kind: "export"; gameId: string; disabled: boolean }
  /** SV-32: 古いファイルでも読み込む */
  | { kind: "importYes" };

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
  | { kind: "import" }
  | { kind: "export"; gameId: string }
  | { kind: "applyImport" }
  | { kind: "none" };

/** 描く 1 項目。lines は 1 行（ボタン）か 2 行（一覧の行）。dim は見た目だけ、disabled は押しても何もしない */
export type TitleItem = { entry: TitleEntry; lines: string[]; dim: boolean; disabled: boolean };

const find = (list: readonly GameListEntry[], id: string): GameListEntry | undefined => list.find((e) => e.gameId === id);

/** UI-50: ページごとの項目の並び。list は一覧（与えられた順 = updatedAt の降順）→ 新しく始める → 設定 → 読み込み */
export function titleEntries(page: TitlePage, list: readonly GameListEntry[]): TitleEntry[] {
  if (page.kind === "list") {
    return [...list.map((entry): TitleEntry => ({ kind: "game", entry })), { kind: "newGame" }, { kind: "settings" }, { kind: "import" }];
  }
  if (page.kind === "newMode") return [{ kind: "quick" }, { kind: "custom" }, { kind: "cancel" }];
  // SV-32: 確認の先頭は「やめる」（Enter・1 で書かないように）。計画は app が持つので一覧に無くてもよい
  if (page.kind === "importConfirm") return [{ kind: "cancel" }, { kind: "importYes" }];
  const e = find(list, page.gameId);
  if (e === undefined) return [{ kind: "cancel" }];
  if (page.kind === "game") {
    // SV-12: 読めない記録（壊れた・新しすぎる版）は続きから・書き出しできないが、削除はできる
    const unreadable = e.status !== "ok";
    return [
      { kind: "continue", gameId: e.gameId, disabled: unreadable },
      { kind: "export", gameId: e.gameId, disabled: unreadable },
      { kind: "delete", gameId: e.gameId },
      { kind: "cancel" },
    ];
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
    case "import":
      return { kind: "import" };
    case "export":
      return e.disabled ? { kind: "none" } : { kind: "export", gameId: e.gameId };
    case "importYes":
      return page.kind === "importConfirm" ? { kind: "applyImport" } : { kind: "none" };
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
 * 新しすぎる版は 2 行目を title.rowTooNew にする。壊れた記録は summary が空の仮の値なので、1 行目を title.rowBroken、2 行目を空にする。
 * UI-50 / SV-21（M12）: summary.conquered（progress.conquered の写し。判定は core）が真なら 1 行目を title.rowConquered で描く
 */
export function titleRowLabels(entry: GameListEntry, size: number, strings: Strings): [string, string] {
  if (entry.status === "broken") return [tr(strings, "title.rowBroken"), ""];
  const s = entry.summary;
  const line1 = formatMessage(tr(strings, s.conquered ? "title.rowConquered" : "title.row"), { leader: s.leaderName, alive: s.aliveCount, size, cleared: s.clearedCount });
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
      case "import":
        return { entry: e, lines: [tr(strings, "title.import")], dim: false, disabled: false };
      case "export":
        return { entry: e, lines: [tr(strings, "title.export")], dim: e.disabled, disabled: e.disabled };
      case "importYes":
        return { entry: e, lines: [tr(strings, "title.importYes")], dim: false, disabled: false };
    }
  });
}

/** 案内の欄の文。list は一覧が空なら title.empty、game は行の 1 行目、confirm1 / confirm2 は削除の確認、importConfirm は古いファイルの警告（2 行） */
export function titleNotice(page: TitlePage, list: readonly GameListEntry[], size: number, strings: Strings): string {
  if (page.kind === "list") return list.length === 0 ? tr(strings, "title.empty") : "";
  if (page.kind === "newMode") return tr(strings, "title.mode.notice");
  if (page.kind === "importConfirm") {
    const detail = formatMessage(tr(strings, "title.importOldDetail"), { leader: page.leader, turn: page.turn, existing: page.existingTurn });
    return `${tr(strings, "save.importOld")}\n${detail}`;
  }
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

/** SV-40: タイトルの下の案内。ホーム画面から起動していれば出さない（空）、そうでなければ title.storageHint */
export function titleHint(standalone: boolean, strings: Strings): string {
  return standalone ? "" : tr(strings, "title.storageHint");
}

// ---------------------------------------------------------------- DOM

export type TitleScreen = {
  el: HTMLElement;
  /**
   * 項目を描き直す。一覧の行（kind game）は行の欄へ、それ以外は TITLE_BUTTONS の順に置く。notice は案内の欄、
   * hint は SV-40 の下の案内（titleHint。空なら何も出さない）
   */
  render(items: readonly TitleItem[], notice: string, hint: string): void;
  /** SV-31: 今出ている「読み込み」のファイル選択を開く（キーボード用。無ければ何もしない） */
  openFilePicker(): void;
};

function place(el: HTMLElement, r: Rect): void {
  Object.assign(el.style, { position: "absolute", left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
}

/**
 * pictures はビルド時の施設の絵の一覧（GameAssets.town）、base は import.meta.env.BASE_URL。
 * UI-50（2026-10-06 ユーザー決定）: 一覧に title があれば public/town/title.png を TITLE_PICTURE に出す（無ければ何も出さない = 今のまま）
 */
export function createTitleScreen(o: {
  strings: Strings;
  onSelect(index: number): void;
  onFile(f: File): void;
  pictures?: Readonly<Record<string, SpriteInfo>>;
  base?: string;
}): TitleScreen {
  const el = document.createElement("div");
  el.className = "screen screen-title";

  // UI-50: タイトルの絵は最下層（題字・一覧の行・ボタンより前に置く）。押せない
  if (o.pictures !== undefined && Object.prototype.hasOwnProperty.call(o.pictures, TITLE_PICTURE_ID)) {
    const pic = createTownPicture({ w: TITLE_PICTURE.w, h: TITLE_PICTURE.h, available: o.pictures, base: o.base ?? "/" });
    pic.el.className = "town-picture title-picture";
    Object.assign(pic.el.style, { left: `${TITLE_PICTURE.x}px`, top: `${TITLE_PICTURE.y}px`, pointerEvents: "none" });
    pic.show(TITLE_PICTURE_ID);
    el.appendChild(pic.el);
  }

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
  Object.assign(notice.style, { ...WRAP_STYLE, overflow: "hidden" });
  el.appendChild(notice);

  // SV-40: ホーム画面への追加の案内（押せない。dim の 2 行）
  const hintEl = document.createElement("div");
  hintEl.className = "title-hint";
  place(hintEl, TITLE_HINT);
  Object.assign(hintEl.style, { ...WRAP_STYLE, overflow: "hidden", color: "var(--c-dim)" });
  el.appendChild(hintEl);

  const buttons = document.createElement("div");
  el.appendChild(buttons);
  // UI-11（M10.5 追補。未定-24）: 一覧の左の 8px の列に続きの印（題字・一覧・案内・ボタンの後ろに足す）
  const marks = attachScrollMarks({ scroller: rows, host: el, strings: o.strings, pos: marksLeftOf(TITLE_ROW_AREA) });

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

  /** 今出ている「読み込み」のボタン（描き直すたびに作り直す） */
  let fileButton: FileButton | null = null;

  return {
    el,
    render(items, text, hint) {
      hintEl.textContent = hint;
      const rowEls: HTMLElement[] = [];
      const buttonEls: HTMLElement[] = [];
      fileButton = null;
      items.forEach((it, i) => {
        if (it.entry.kind === "import") {
          // SV-31: 透明の input[type=file] を重ねたボタン（onTap を付けない。タップでブラウザのファイル選択が開く）
          const r = TITLE_BUTTONS[buttonEls.length];
          if (r === undefined) return;
          const fb = createFileButton({ label: it.lines.join("\n"), rect: r, onFile: (f) => o.onFile(f) });
          fb.setDisabled(it.disabled);
          fileButton = fb;
          buttonEls.push(fb.el);
          return;
        }
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
      marks.refresh();
      buttons.replaceChildren(...buttonEls);
      notice.textContent = text;
    },
    openFilePicker() {
      fileButton?.open();
    },
  };
}
