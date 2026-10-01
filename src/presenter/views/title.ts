// UI-50 のタイトル（M2 版）。題字と「新しく始める」「設定」だけ。「続きから」は M4 で足す。
// モジュールのトップレベルでは DOM に触れない。
import type { Strings } from "../../core/data/index";
import { TITLE_BUTTONS, type Rect } from "../layout";

/** 題字の上端（論理 px）。中央寄せ */
export const TITLE_HEADING_Y = 120;

export type TitleScreen = { el: HTMLElement };

function button(text: string, r: Rect, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "ui-button";
  b.textContent = text;
  Object.assign(b.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
  b.addEventListener("click", onClick);
  return b;
}

export function createTitleScreen(o: { strings: Strings; onNewGame(): void; onSettings(): void }): TitleScreen {
  const t = (k: string): string => o.strings[k] ?? k;
  const el = document.createElement("div");
  el.className = "screen screen-title";

  const heading = document.createElement("div");
  heading.className = "title-heading";
  heading.style.top = `${TITLE_HEADING_Y}px`;
  heading.textContent = t("title.heading");
  el.appendChild(heading);

  el.appendChild(button(t("title.newGame"), TITLE_BUTTONS.newGame, () => o.onNewGame()));
  el.appendChild(button(t("title.settings"), TITLE_BUTTONS.settings, () => o.onSettings()));
  return { el };
}
