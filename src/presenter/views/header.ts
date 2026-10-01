// UI-53 のヘッダー（ui §2 の header 領域 240×16）。左に「{dungeon} {floor}F {dir}」、右に設定ボタン。
// 設定ボタンは HEADER_SETTINGS（UI-10 の例外。F2 でも開ける）。
// el の配置（left / top）は呼び出し側が決める。モジュールのトップレベルでは DOM に触れない。
import type { Strings } from "../../core/data/index";
import type { Facing } from "../../core/types";
import { HEADER_SETTINGS } from "../layout";
import { formatMessage } from "./message";

/** header.dungeon と dir.* から見出しの文字列を作る */
export function headerText(strings: Strings, dungeonName: string, floor: number, facing: Facing): string {
  const dirKey = `dir.${facing}`;
  return formatMessage(strings["header.dungeon"] ?? "header.dungeon", {
    dungeon: dungeonName,
    floor,
    dir: strings[dirKey] ?? dirKey,
  });
}

const HEIGHT = 16;

export type Header = { el: HTMLElement; setText(s: string): void };

export function createHeader(o: { strings: Strings; onSettings(): void }): Header {
  const el = document.createElement("div");
  el.className = "header";
  Object.assign(el.style, { position: "absolute", width: "240px", height: `${HEIGHT}px`, color: "var(--c-text)" });

  const text = document.createElement("div");
  text.className = "header-text";
  Object.assign(text.style, {
    position: "absolute",
    left: "4px",
    top: "0px",
    width: "192px", // x4..195
    height: `${HEIGHT}px`,
    lineHeight: `${HEIGHT}px`,
    whiteSpace: "nowrap",
    overflow: "hidden",
  });
  el.appendChild(text);

  const label = o.strings["controls.settings"] ?? "controls.settings";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "header-settings";
  btn.textContent = label;
  btn.setAttribute("aria-label", label);
  Object.assign(btn.style, {
    position: "absolute",
    left: `${HEADER_SETTINGS.x}px`,
    top: `${HEADER_SETTINGS.y}px`,
    width: `${HEADER_SETTINGS.w}px`,
    height: `${HEADER_SETTINGS.h}px`,
    margin: "0",
    padding: "0",
    border: "1px solid var(--c-frame)",
    background: "var(--c-bg)",
    color: "var(--c-text)",
    font: "inherit",
    lineHeight: `${HEADER_SETTINGS.h - 2}px`,
  });
  btn.addEventListener("click", () => o.onSettings());
  el.appendChild(btn);

  return {
    el,
    setText(s: string): void {
      text.textContent = s;
    },
  };
}
