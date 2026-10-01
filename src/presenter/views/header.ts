// UI-53 のヘッダー（ui §2 の header 領域。既定 240×16）。左に「{dungeon} {floor}F {dir}」、右に設定ボタン。
// 矩形は layout.ts の dungeonLayout（header.text / header.settings。設定ボタンは UI-10 の例外。F2 でも開ける）。
// el は region の位置と大きさに自分で置く。モジュールのトップレベルでは DOM に触れない。
import type { Strings } from "../../core/data/index";
import type { Facing } from "../../core/types";
import type { DungeonLayout, Rect } from "../layout";
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

export type Header = { el: HTMLElement; setText(s: string): void };

export function createHeader(o: {
  strings: Strings;
  /** ui §2 の header 領域（ステージ座標） */
  region: Rect;
  layout: DungeonLayout["header"];
  onSettings(): void;
}): Header {
  const r = o.region;
  const t = o.layout.text;
  const st = o.layout.settings;
  const el = document.createElement("div");
  el.className = "header";
  Object.assign(el.style, {
    position: "absolute",
    left: `${r.x}px`,
    top: `${r.y}px`,
    width: `${r.w}px`,
    height: `${r.h}px`,
    color: "var(--c-text)",
  });

  const text = document.createElement("div");
  text.className = "header-text";
  Object.assign(text.style, {
    position: "absolute",
    left: `${t.x - r.x}px`,
    top: `${t.y - r.y}px`,
    width: `${t.w}px`, // 既定 x4..195
    height: `${t.h}px`,
    lineHeight: `${t.h}px`,
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
    left: `${st.x - r.x}px`,
    top: `${st.y - r.y}px`,
    width: `${st.w}px`,
    height: `${st.h}px`,
    margin: "0",
    padding: "0",
    border: "1px solid var(--c-frame)",
    background: "var(--c-bg)",
    color: "var(--c-text)",
    font: "inherit",
    lineHeight: `${st.h - 2}px`,
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
