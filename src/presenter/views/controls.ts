// UI-32 / UI-53 の操作領域（ui §2 の controls 領域）。十字ボタン、メニュー（MENU_SLOTS）、リスト（LIST_ROWS）、
// 地図の「閉じる」（MAP_CLOSE）を切り替えて出す。矩形は layout.ts のステージ座標で、region の原点を引いて置く。
// 十字ボタンは pointerdown で反応する（click は使わない）。離したら onRelease（前進の長押しの連打を止める。UI-31）。
// Action から Command への変換と長押しの連打は呼び出し側（app）が持つ。表示層は前進できるかを判定しない（UI-35）。
// モジュールのトップレベルでは DOM に触れない。
import type { Strings } from "../../core/data/index";
import { DPAD, LIST_ROWS, MAP_CLOSE, MENU_SLOTS, type Rect } from "../layout";

export type DpadAction = "forward" | "left" | "right" | "around";
export type ControlsMode = "dpad" | "list" | "close" | "none";
export type ControlItem = { label: string; onSelect(): void };

export type Controls = {
  el: HTMLElement;
  /** dpad = 十字ボタンとメニュー、list = リスト、close = 地図の「閉じる」だけ、none = 何も出さない */
  setMode(m: ControlsMode): void;
  /** inputMode が swipe なら十字ボタンを隠す（メニューは残す） */
  setDpadVisible(on: boolean): void;
  /** MENU_SLOTS に並べる（5 件目以降は捨てる） */
  setMenu(items: ControlItem[]): void;
  /** LIST_ROWS の位置に並べる。4 件以上は縦スクロール（UI-11） */
  setList(items: ControlItem[]): void;
  /** n 番目（0 始まり）を選ぶ。dpad ではメニュー、list ではリスト、close では 0 が「閉じる」。範囲外は何もしない */
  select(n: number): void;
};

const SVG_NS = "http://www.w3.org/2000/svg";

/** 32×32 の中の三角形（向き別） */
const ARROWS: Readonly<Record<DpadAction, string>> = {
  forward: "M16 8 L24 22 H8 Z",
  left: "M8 16 L22 8 V24 Z",
  right: "M24 16 L10 8 V24 Z",
  around: "M16 24 L8 10 H24 Z",
};

function buttonStyle(b: HTMLElement, r: Rect, origin: Rect): void {
  Object.assign(b.style, {
    position: "absolute",
    left: `${r.x - origin.x}px`,
    top: `${r.y - origin.y}px`,
    width: `${r.w}px`,
    height: `${r.h}px`,
    margin: "0",
    padding: "0",
    border: "1px solid var(--c-frame)",
    background: "var(--c-bg)",
    color: "var(--c-text)",
    font: "inherit",
    lineHeight: `${r.h - 2}px`,
    textAlign: "center",
    whiteSpace: "nowrap",
    overflow: "hidden",
    touchAction: "manipulation",
  });
}

function setShown(el: HTMLElement, on: boolean): void {
  el.style.display = on ? "" : "none";
}

/**
 * region は ui §2 の controls 領域（ステージ座標）。el はその位置と大きさに自分で置く。
 * onAction は十字ボタンを押した瞬間、onRelease は離したとき（pointerup / pointercancel / pointerleave）に呼ぶ。
 */
export function createControls(o: {
  region: Rect;
  strings: Strings;
  onAction(a: DpadAction): void;
  onRelease(): void;
  onClose(): void;
}): Controls {
  const s = (key: string): string => o.strings[key] ?? key;
  const origin = o.region;

  const el = document.createElement("div");
  el.className = "controls";
  Object.assign(el.style, {
    position: "absolute",
    left: `${origin.x}px`,
    top: `${origin.y}px`,
    width: `${origin.w}px`,
    height: `${origin.h}px`,
    color: "var(--c-text)",
  });

  // ---- 十字ボタン
  const dpad = document.createElement("div");
  dpad.className = "controls-dpad";
  el.appendChild(dpad);
  for (const a of Object.keys(DPAD) as DpadAction[]) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `controls-dpad-${a}`;
    b.setAttribute("aria-label", s(`controls.${a}`));
    buttonStyle(b, DPAD[a], origin);
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("width", String(DPAD[a].w - 2));
    svg.setAttribute("height", String(DPAD[a].h - 2));
    svg.setAttribute("viewBox", `1 1 ${DPAD[a].w - 2} ${DPAD[a].h - 2}`);
    svg.setAttribute("shape-rendering", "crispEdges");
    svg.style.display = "block";
    svg.style.pointerEvents = "none";
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", ARROWS[a]);
    p.setAttribute("fill", "var(--c-line)");
    svg.appendChild(p);
    b.appendChild(svg);
    b.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      o.onAction(a);
    });
    const release = (): void => o.onRelease();
    b.addEventListener("pointerup", release);
    b.addEventListener("pointercancel", release);
    b.addEventListener("pointerleave", release);
    // pointerdown の preventDefault で click は来ないことがあるので、click では何もしない
    dpad.appendChild(b);
  }

  // ---- メニュー（MENU_SLOTS）
  const menu = document.createElement("div");
  menu.className = "controls-menu";
  el.appendChild(menu);
  let menuItems: ControlItem[] = [];

  // ---- リスト（LIST_ROWS。行は連続しているので 1 つのスクロール容器に縦に積む）
  const first = LIST_ROWS[0] ?? { x: 8, y: origin.y + 2, w: 224, h: 32 };
  const last = LIST_ROWS[LIST_ROWS.length - 1] ?? first;
  const list = document.createElement("div");
  list.className = "controls-list";
  Object.assign(list.style, {
    position: "absolute",
    left: `${first.x - origin.x}px`,
    top: `${first.y - origin.y}px`,
    width: `${first.w}px`,
    height: `${last.y + last.h - first.y}px`,
    overflowY: "auto",
    overflowX: "hidden",
    touchAction: "pan-y",
  });
  el.appendChild(list);
  let listItems: ControlItem[] = [];

  // ---- 地図の「閉じる」
  const close = document.createElement("button");
  close.type = "button";
  close.className = "controls-close";
  close.textContent = s("common.close");
  buttonStyle(close, MAP_CLOSE, origin);
  close.addEventListener("click", () => o.onClose());
  el.appendChild(close);

  let mode: ControlsMode = "none";
  let dpadVisible = true;

  const apply = (): void => {
    setShown(dpad, mode === "dpad" && dpadVisible);
    setShown(menu, mode === "dpad");
    setShown(list, mode === "list");
    setShown(close, mode === "close");
  };
  apply();

  return {
    el,
    setMode(m: ControlsMode): void {
      mode = m;
      apply();
    },
    setDpadVisible(on: boolean): void {
      dpadVisible = on;
      apply();
    },
    setMenu(items: ControlItem[]): void {
      menuItems = items.slice(0, MENU_SLOTS.length);
      menu.replaceChildren();
      menuItems.forEach((it, i) => {
        const r = MENU_SLOTS[i];
        if (r === undefined) return;
        const b = document.createElement("button");
        b.type = "button";
        b.className = "controls-menu-item";
        b.textContent = it.label;
        buttonStyle(b, r, origin);
        b.addEventListener("click", () => it.onSelect());
        menu.appendChild(b);
      });
    },
    setList(items: ControlItem[]): void {
      listItems = items.slice();
      list.replaceChildren();
      list.scrollTop = 0;
      for (const it of listItems) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "controls-list-item";
        b.textContent = it.label;
        Object.assign(b.style, {
          display: "block",
          width: `${first.w}px`,
          height: `${first.h}px`,
          margin: "0",
          padding: "0 4px",
          border: "1px solid var(--c-frame)",
          background: "var(--c-bg)",
          color: "var(--c-text)",
          font: "inherit",
          lineHeight: `${first.h - 2}px`,
          textAlign: "left",
          whiteSpace: "nowrap",
          overflow: "hidden",
          touchAction: "pan-y",
        });
        b.addEventListener("click", () => it.onSelect());
        list.appendChild(b);
      }
    },
    select(n: number): void {
      if (mode === "dpad") menuItems[n]?.onSelect();
      else if (mode === "list") listItems[n]?.onSelect();
      else if (mode === "close" && n === 0) o.onClose();
    },
  };
}
