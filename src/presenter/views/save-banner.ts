// SV-23: 「保存できません」の帯。ステージ直下の最前面に置き、ヘッダーの直下（SAVE_BANNER）を覆う。
// 押せない（pointer-events:none）ので、下の画面の操作を妨げない。タイトルでも見える。
// モジュールのトップレベルでは DOM に触れない。
import type { Strings } from "../../core/data/index";
import type { Rect } from "../layout";

export type SaveBanner = { el: HTMLElement; setVisible(on: boolean): void };

export function createSaveBanner(o: { strings: Strings; rect: Rect }): SaveBanner {
  const r = o.rect;
  const el = document.createElement("div");
  el.className = "save-banner";
  el.setAttribute("role", "status");
  Object.assign(el.style, {
    position: "absolute",
    left: `${r.x}px`,
    top: `${r.y}px`,
    width: `${r.w}px`,
    height: `${r.h}px`,
    lineHeight: `${r.h}px`,
    textAlign: "center",
    whiteSpace: "nowrap",
    overflow: "hidden",
    background: "var(--c-danger)",
    color: "var(--c-text)",
    pointerEvents: "none",
    zIndex: "100",
    display: "none",
  });
  el.textContent = o.strings["save.failedBanner"] ?? "save.failedBanner";
  return {
    el,
    setVisible(on: boolean): void {
      el.style.display = on ? "" : "none";
    },
  };
}
