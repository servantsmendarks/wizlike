// UI-57 の設定画面（M6）。タイトルの「設定」とヘッダーの設定ボタンから開くステージ全面の overlay（app の overlay "settings"）。
// 上から 見出し → 4 行（演出スキップ・文字速度・オートの速さ・入力。押すたびに巡回し、その場で store.set）→ 書き出し・読み込み
// （SV-30〜33。遊んでいる途中は書き出しだけ、タイトルでは読み込みだけ）→ 案内の欄（2 行）→ ホーム画面への追加の案内（SV-40）→
// 下の段に「開発用」（debug パネルを開く）と「閉じる」（UI-11 の固定の位置）。
// 純粋な部分（settingsRows / settingsToggle / settingsItems / settingsKeyIndex / settingsFileHint）は DOM に触れないので node でテストできる。
// 書き出し・読み込み・debug パネル・閉じるの中身は app が行う（ここは描いて押されたことを知らせるだけ）。
// モジュールのトップレベルでは DOM に触れない。
import type { Strings } from "../../core/data/index";
import type { Action } from "../input/swipe";
import { onTap } from "../input/tap";
import { createFileButton } from "../file-io";
import type { Rect, SettingsLayout } from "../layout";
import { nextAutoBeat, nextInputMode, nextTextSpeed, type Settings, type SettingsStore } from "../settings";
import { formatMessage } from "./message";

export type SettingsKey = "skipAnimations" | "textSpeed" | "autoBeatMs" | "inputMode";
/** UI-57: 4 行の並び（固定） */
export const SETTINGS_ROW_KEYS: readonly SettingsKey[] = ["skipAnimations", "textSpeed", "autoBeatMs", "inputMode"];
export type SettingsRowView = { key: SettingsKey; label: string; value: string };

const tr = (strings: Strings, k: string): string => strings[k] ?? k;

/** UI-57: 4 行のラベルと値（演出スキップ 入/切、文字速度 即時/{ms}ms、オートの速さ {ms}ms、入力 スワイプ/ボタン/両方） */
export function settingsRows(s: Settings, strings: Strings): SettingsRowView[] {
  const ms = (n: number): string => formatMessage(tr(strings, "settings.ms"), { ms: n });
  return SETTINGS_ROW_KEYS.map((key): SettingsRowView => {
    switch (key) {
      case "skipAnimations":
        return { key, label: tr(strings, "settings.skipAnimations"), value: tr(strings, s.skipAnimations ? "settings.on" : "settings.off") };
      case "textSpeed":
        return { key, label: tr(strings, "settings.textSpeed"), value: s.textSpeed === 0 ? tr(strings, "settings.textSpeed.instant") : ms(s.textSpeed) };
      case "autoBeatMs":
        return { key, label: tr(strings, "settings.autoBeatMs"), value: ms(s.autoBeatMs) };
      case "inputMode":
        return { key, label: tr(strings, "settings.inputMode"), value: tr(strings, `settings.inputMode.${s.inputMode}`) };
    }
  });
}

/** UI-57: 押したときの次の値（skip は反転、textSpeed は nextTextSpeed、autoBeatMs は nextAutoBeat、inputMode は nextInputMode） */
export function settingsToggle(s: Settings, key: SettingsKey): Partial<Settings> {
  switch (key) {
    case "skipAnimations":
      return { skipAnimations: !s.skipAnimations };
    case "textSpeed":
      return { textSpeed: nextTextSpeed(s.textSpeed) };
    case "autoBeatMs":
      return { autoBeatMs: nextAutoBeat(s.autoBeatMs) };
    case "inputMode":
      return { inputMode: nextInputMode(s.inputMode) };
  }
}

export type SettingsContext = {
  /** 書き出せる（遊んでいる途中で、保存先が使え、current がある） */
  canExport: boolean;
  /** 読み込める（タイトルで、保存先が使える） */
  canImport: boolean;
  /** title = タイトルから開いた、play = 街・迷宮・戦闘から開いた、none = 保存先が使えない */
  where: "title" | "play" | "none";
  /** SV-40: ホーム画面から起動している */
  standalone: boolean;
};

export type SettingsItem =
  | { kind: "row"; key: SettingsKey }
  | { kind: "export"; disabled: boolean }
  | { kind: "import"; disabled: boolean }
  | { kind: "debug" }
  | { kind: "close" };

/** UI-33: 項目の並び（数字キーの番号）。4 行 → 書き出し → 読み込み → 開発用 → 閉じる */
export function settingsItems(ctx: SettingsContext): SettingsItem[] {
  return [
    ...SETTINGS_ROW_KEYS.map((key): SettingsItem => ({ kind: "row", key })),
    { kind: "export", disabled: !ctx.canExport },
    { kind: "import", disabled: !ctx.canImport },
    { kind: "debug" },
    { kind: "close" },
  ];
}

const isDisabled = (it: SettingsItem): boolean => (it.kind === "export" || it.kind === "import") && it.disabled;

/** UI-33: 数字 n → n 番目（disabled は null）、Esc / Enter → 閉じる（close の添字）。それ以外は null */
export function settingsKeyIndex(a: Action, items: readonly SettingsItem[]): number | null {
  if (a === "back" || a === "confirm") {
    const i = items.findIndex((it) => it.kind === "close");
    return i < 0 ? null : i;
  }
  if (typeof a === "object") {
    const it = items[a.menu];
    if (a.menu < 0 || it === undefined || isDisabled(it)) return null;
    return a.menu;
  }
  return null;
}

/** 案内の欄の既定の文: title → settings.fileHintTitle、play → settings.fileHintPlay、none → settings.fileHintNone */
export function settingsFileHint(ctx: SettingsContext, strings: Strings): string {
  return tr(strings, ctx.where === "title" ? "settings.fileHintTitle" : ctx.where === "play" ? "settings.fileHintPlay" : "settings.fileHintNone");
}

// ---------------------------------------------------------------- DOM

export type SettingsScreen = {
  el: HTMLElement;
  /** 開くたびに app が呼ぶ。項目の dim・案内の欄を描き直す。notice が null なら settingsFileHint */
  render(ctx: SettingsContext, notice: string | null): void;
  /** 設定の値を描き直す（store の購読者から） */
  refresh(): void;
  /** UI-33: i 番目の項目を押したことにする（import は読み込みのファイル選択を開く。disabled は何もしない） */
  select(i: number): void;
};

function place(el: HTMLElement, r: Rect): void {
  Object.assign(el.style, { position: "absolute", left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
}

function setDim(el: HTMLElement, dim: boolean): void {
  el.style.color = dim ? "var(--c-dim)" : "";
  el.style.borderColor = dim ? "var(--c-dim)" : "";
  if (dim) el.setAttribute("aria-disabled", "true");
  else el.removeAttribute("aria-disabled");
}

export function createSettingsScreen(o: {
  strings: Strings;
  store: SettingsStore;
  layout: SettingsLayout;
  onExport(): void;
  onImportFile(f: File): void;
  onDebug(): void;
  onClose(): void;
}): SettingsScreen {
  const t = (k: string): string => tr(o.strings, k);
  const L = o.layout;

  const el = document.createElement("div");
  el.className = "settings-screen";

  const button = (text: string, r: Rect, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ui-button";
    b.textContent = text;
    place(b, r);
    // .ui-button の line-height 30px は高さ 32 用。高さの違うボタンは内側の高さ（上下の枠 1px を除く）に合わせて縦の中央に置く
    if (r.h !== 32) b.style.lineHeight = `${r.h - 2}px`;
    onTap(b, () => onClick());
    el.appendChild(b);
    return b;
  };

  const heading = document.createElement("div");
  heading.className = "settings-heading";
  place(heading, L.heading);
  heading.textContent = t("settings.title");
  el.appendChild(heading);

  // 4 行（ラベルは押せない、値の toggle は押せる）
  const rowEls = SETTINGS_ROW_KEYS.map((key, i) => {
    const r = L.rows[i] ?? { label: { x: 0, y: 0, w: 0, h: 0 }, toggle: { x: 0, y: 0, w: 0, h: 0 } };
    const label = document.createElement("div");
    label.className = "settings-label";
    place(label, r.label);
    el.appendChild(label);
    const toggle = button("", r.toggle, () => toggleRow(key));
    return { label, toggle };
  });

  let ctx: SettingsContext = { canExport: false, canImport: false, where: "none", standalone: false };

  const exportButton = button(t("title.export"), L.exportButton, () => {
    if (ctx.canExport) o.onExport();
  });

  // SV-31: 読み込みは透明の input[type=file] を重ねたボタン（onTap を付けない。タップでブラウザのファイル選択が開く）
  const fileButton = createFileButton({ label: t("title.import"), rect: L.importButton, onFile: (f) => o.onImportFile(f) });
  el.appendChild(fileButton.el);

  const notice = document.createElement("div");
  notice.className = "settings-notice";
  place(notice, L.notice);
  el.appendChild(notice);

  const install = document.createElement("div");
  install.className = "settings-install";
  place(install, L.install);
  el.appendChild(install);

  button(t("settings.debug"), L.debug, () => o.onDebug());
  button(t("common.close"), L.close, () => o.onClose());

  const toggleRow = (key: SettingsKey): void => {
    o.store.set(settingsToggle(o.store.get(), key));
  };

  const refresh = (): void => {
    const rows = settingsRows(o.store.get(), o.strings);
    rows.forEach((row, i) => {
      const e = rowEls[i];
      if (e === undefined) return;
      e.label.textContent = row.label;
      e.toggle.textContent = row.value;
    });
  };
  refresh();

  return {
    el,
    render(c, text) {
      ctx = c;
      setDim(exportButton, !c.canExport);
      fileButton.setDisabled(!c.canImport);
      notice.textContent = text ?? settingsFileHint(c, o.strings);
      refresh();
    },
    refresh,
    select(i) {
      const it = settingsItems(ctx)[i];
      if (it === undefined) return;
      switch (it.kind) {
        case "row":
          toggleRow(it.key);
          return;
        case "export":
          if (!it.disabled) o.onExport();
          return;
        case "import":
          // キーボード（数字キー）のときだけ。disabled なら何もしない
          if (!it.disabled) fileButton.open();
          return;
        case "debug":
          o.onDebug();
          return;
        case "close":
          o.onClose();
          return;
      }
    },
  };
}
