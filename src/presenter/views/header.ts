// UI-53 のヘッダー（ui §2 の header 領域。既定 240×16）。左に「{dungeon} {floor}F {dir}」、右に設定ボタン。
// UI-54（M5.5）: 戦闘中は文字領域の右端（設定ボタンの左）に「第{n}ターン」を右寄せで出す（setTurn。問いを消しても残す）。
// 矩形は layout.ts の dungeonLayout（header.text / header.settings。設定ボタンは UI-10 の例外。F2 でも開ける）。
// el は region の位置と大きさに自分で置く。モジュールのトップレベルでは DOM に触れない。
import type { Strings } from "../../core/data/index";
import type { Facing } from "../../core/types";
import { HEADER_TURN_GAP, type DungeonLayout, type Rect } from "../layout";
import { formatMessage } from "./message";
import { onTap } from "../input/tap";

/** header.dungeon と dir.* から見出しの文字列を作る */
export function headerText(strings: Strings, dungeonName: string, floor: number, facing: Facing): string {
  const dirKey = `dir.${facing}`;
  return formatMessage(strings["header.dungeon"] ?? "header.dungeon", {
    dungeon: dungeonName,
    floor,
    dir: strings[dirKey] ?? dirKey,
  });
}

/** UI-54（M5.5）: 戦闘のターン表示の文字列。n は battleMenu.round + 1（遭遇の再生の間は 1。表示のための読み取り） */
export function battleTurnText(strings: Strings, n: number): string {
  return formatMessage(strings["battle.turn"] ?? "battle.turn", { n });
}

export type Header = {
  el: HTMLElement;
  setText(s: string): void;
  /** UI-54: 戦闘のターン表示。null で隠し、文字領域の幅を戻す */
  setTurn(s: string | null): void;
};

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

  // UI-54: ターン表示（右寄せ。出している間は問いの文字領域を tu.w + HEADER_TURN_GAP だけ縮める）
  const tu = o.layout.turn;
  const turn = document.createElement("div");
  turn.className = "header-turn";
  Object.assign(turn.style, {
    position: "absolute",
    left: `${tu.x - r.x}px`,
    top: `${tu.y - r.y}px`,
    width: `${tu.w}px`,
    height: `${tu.h}px`,
    lineHeight: `${tu.h}px`,
    textAlign: "right",
    whiteSpace: "nowrap",
    overflow: "hidden",
    display: "none",
  });
  el.appendChild(turn);

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
  onTap(btn, () => o.onSettings());
  el.appendChild(btn);

  return {
    el,
    setText(s: string): void {
      text.textContent = s;
    },
    setTurn(s: string | null): void {
      turn.textContent = s ?? "";
      turn.style.display = s === null ? "none" : "";
      text.style.width = `${s === null ? t.w : t.w - tu.w - HEADER_TURN_GAP}px`;
    },
  };
}
