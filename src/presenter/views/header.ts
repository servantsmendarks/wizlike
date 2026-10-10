// UI-53 のヘッダー（ui §2 の header 領域。既定 240×16）。左に「{dungeon} {floor}F {dir}」、右に設定ボタン。
// UI-54（M5.5）: 戦闘中は文字領域の右端（設定ボタンの左）に「第{n}ターン」を右寄せで出す（setTurn。問いを消しても残す）。
// 矩形は layout.ts の dungeonLayout（header.text / header.settings。設定ボタンは UI-10 の例外。F2 でも開ける）。
// UI-13 / UI-46（M16）: 設定の左に「ログ」（header.log。UI-46 の履歴を開く。UI-10 の例外）を街・迷宮・戦闘で常に出す。文字領域はその左まで
// （M8.5〜M15 は街だけで、setLogVisible で出し入れしていた）。戦闘のターン表示はログの左に置き、その間の問いは 100px（既定）。
// UI-59 / UI-33（M16。設計 4-9）: キャラクター画面の間は、ヘッダーの左端に ◀（前の人）、ログの左に ▶（次の人）を出し（setNav）、
// 問いはその間に中央寄せ。三角は美咲フォントに無いのでインライン SVG の path で描く。
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
  /** UI-59（M16）: キャラクター画面の ◀ ▶ を出すか（出す間は問いを両者の間に中央寄せ） */
  setNav(on: boolean): void;
};

/** UI-59（M16）: ◀ ▶ の三角の path（ボタンの中央に置く 8×8。dir -1 が左向き） */
export function navTrianglePath(w: number, h: number, dir: 1 | -1): string {
  const cx = Math.round(w / 2);
  const cy = Math.round(h / 2);
  return dir < 0 ? `M${cx + 3} ${cy - 4}L${cx - 3} ${cy}L${cx + 3} ${cy + 4}Z` : `M${cx - 3} ${cy - 4}L${cx + 3} ${cy}L${cx - 3} ${cy + 4}Z`;
}

export function createHeader(o: {
  strings: Strings;
  /** ui §2 の header 領域（ステージ座標） */
  region: Rect;
  layout: DungeonLayout["header"];
  onSettings(): void;
  /** UI-46 / UI-13（M8.5）: ログのボタン */
  onLog?(): void;
  /** UI-59（M16）: キャラクター画面の ◀（−1）/ ▶（+1） */
  onCycle?(dir: 1 | -1): void;
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
    width: `${t.w}px`, // 既定 x4..155（ログの左まで）
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

  // UI-13 / UI-46（M16）: ログのボタン（街・迷宮・戦闘で常に出す。設定と同じ見た目）
  const lg = o.layout.log;
  const logLabel = o.strings["controls.log"] ?? "controls.log";
  const logBtn = document.createElement("button");
  logBtn.type = "button";
  logBtn.className = "header-log";
  logBtn.textContent = logLabel;
  logBtn.setAttribute("aria-label", logLabel);
  Object.assign(logBtn.style, {
    position: "absolute",
    left: `${lg.x - r.x}px`,
    top: `${lg.y - r.y}px`,
    width: `${lg.w}px`,
    height: `${lg.h}px`,
    margin: "0",
    padding: "0",
    border: "1px solid var(--c-frame)",
    background: "var(--c-bg)",
    color: "var(--c-text)",
    font: "inherit",
    lineHeight: `${lg.h - 2}px`,
  });
  onTap(logBtn, () => o.onLog?.());
  el.appendChild(logBtn);
  // UI-59（M16）: ◀ ▶（既定は隠す。setNav）
  const navButton = (rect: Rect, dir: 1 | -1): HTMLButtonElement => {
    const key = dir < 0 ? "character.prev" : "character.next";
    const b = document.createElement("button");
    b.type = "button";
    b.className = dir < 0 ? "header-prev" : "header-next";
    b.setAttribute("aria-label", o.strings[key] ?? key);
    Object.assign(b.style, {
      position: "absolute",
      left: `${rect.x - r.x}px`,
      top: `${rect.y - r.y}px`,
      width: `${rect.w}px`,
      height: `${rect.h}px`,
      margin: "0",
      padding: "0",
      border: "1px solid var(--c-frame)",
      background: "var(--c-bg)",
      color: "var(--c-text)",
      display: "none",
    });
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    // 枠線の内側（border-box なので 1px ずつ内側）
    const iw = rect.w - 2;
    const ih = rect.h - 2;
    svg.setAttribute("width", String(iw));
    svg.setAttribute("height", String(ih));
    svg.setAttribute("viewBox", `0 0 ${iw} ${ih}`);
    Object.assign(svg.style, { display: "block", pointerEvents: "none" });
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", navTrianglePath(iw, ih, dir));
    path.setAttribute("fill", "currentColor");
    svg.appendChild(path);
    b.appendChild(svg);
    onTap(b, () => o.onCycle?.(dir));
    el.appendChild(b);
    return b;
  };
  const prevBtn = navButton(o.layout.prev, -1);
  const nextBtn = navButton(o.layout.next, 1);
  const nt = o.layout.navText;

  let turnOn = false;
  /** 文字領域の幅（ログの左まで。戦闘のターン表示の間はさらにその左まで） */
  const textW = (): number => (turnOn ? t.w - tu.w - HEADER_TURN_GAP : t.w);

  return {
    el,
    setText(s: string): void {
      text.textContent = s;
    },
    setTurn(s: string | null): void {
      turn.textContent = s ?? "";
      turn.style.display = s === null ? "none" : "";
      turnOn = s !== null;
      text.style.width = `${textW()}px`;
    },
    setNav(on: boolean): void {
      prevBtn.style.display = on ? "" : "none";
      nextBtn.style.display = on ? "" : "none";
      text.style.left = `${(on ? nt.x : t.x) - r.x}px`;
      text.style.width = `${on ? nt.w : textW()}px`;
      text.style.textAlign = on ? "center" : "";
    },
  };
}
