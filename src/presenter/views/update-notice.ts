// SV-42: 新しい版があることの案内（Service Worker の更新が待機に入ったとき）。ステージの最前面に置く。
// 「読み込み直す」で onReload（待機中の Service Worker を有効にして読み込み直す）、「閉じる」で隠す（そのまま遊べる）。
// 再生中でも押せる（whileBusy）。モジュールのトップレベルでは DOM に触れない。
import type { Strings } from "../../core/data/index";
import { onTap } from "../input/tap";
import { UPDATE_NOTICE, type Rect } from "../layout";

export type UpdateNotice = { el: HTMLElement; show(onReload: () => void): void; hide(): void };

/** 案内の文言の key（tests/pwa.test.ts で strings にあることを確かめる） */
export const UPDATE_NOTICE_KEYS = ["pwa.update.message", "pwa.update.reload", "common.close"] as const;

function place(el: HTMLElement, r: Rect, origin: Rect): void {
  Object.assign(el.style, {
    position: "absolute",
    left: `${r.x - origin.x}px`,
    top: `${r.y - origin.y}px`,
    width: `${r.w}px`,
    height: `${r.h}px`,
  });
}

export function createUpdateNotice(o: { strings: Strings }): UpdateNotice {
  const t = (k: string): string => o.strings[k] ?? k;
  const L = UPDATE_NOTICE;
  const el = document.createElement("div");
  el.className = "update-notice";
  el.setAttribute("role", "alert");
  place(el, L.box, { x: 0, y: 0, w: 0, h: 0 });
  Object.assign(el.style, {
    boxSizing: "border-box",
    border: "1px solid var(--c-frame)",
    background: "var(--c-bg)",
    color: "var(--c-text)",
    zIndex: "101",
    display: "none",
  });

  const text = document.createElement("div");
  text.className = "update-notice-text";
  place(text, L.text, L.box);
  Object.assign(text.style, { overflow: "hidden", lineHeight: "14px" });
  text.textContent = t("pwa.update.message");

  let reload: (() => void) | null = null;
  const button = (label: string, r: Rect, f: () => void): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ui-button";
    b.textContent = label;
    place(b, r, L.box);
    onTap(b, { onTap: () => f(), whileBusy: true });
    return b;
  };
  const hide = (): void => {
    el.style.display = "none";
  };
  el.append(
    text,
    button(t("pwa.update.reload"), L.reload, () => reload?.()),
    button(t("common.close"), L.close, hide),
  );

  return {
    el,
    show(onReload: () => void): void {
      reload = onReload;
      el.style.display = "";
    },
    hide,
  };
}
