// UI-53 の迷宮の画面。ui §2 の 5 領域（ヘッダー、ビュー、メッセージ、パーティ、操作）を合成する。
// DOM は 1 回だけ作り、街（UI-52 の M2 版）でもヘッダー・メッセージ・パーティ・操作をそのまま使う（ビューは枠だけ）。
// - ビュー: 線画の SVG（240×150）の上に、スワイプを受ける透明な div（touch-action:none）を重ねる。
// - 地図（UI-24）: ビューとメッセージの領域（y16..235）を覆う overlay。パーティ欄は見えたまま。
// 部品の結線（何を描くか、Action を何にするか）は app が行う。モジュールのトップレベルでは DOM に触れない。
import type { Strings } from "../../core/data/index";
import type { Regions } from "../layout";
import { createControls, type Controls, type DpadAction } from "./controls";
import { createDungeonSvg, type DungeonSvg } from "./dungeon-svg";
import { createHeader, type Header } from "./header";
import { createMapView, type MapViewEl } from "./map";
import { createMessageWindow, type MessageWindow } from "./message";
import { createPartyPanel, type PartyPanel } from "./party";

export type PlayMode = "town" | "dungeon";

export type DungeonScreen = {
  el: HTMLElement;
  header: Header;
  view: DungeonSvg;
  /** スワイプを受ける透明な div（ビューの上） */
  swipeLayer: HTMLElement;
  message: MessageWindow;
  party: PartyPanel;
  controls: Controls;
  map: MapViewEl;
  /** town ならビューは枠だけ、dungeon なら線画 */
  setMode(m: PlayMode): void;
  /** 地図の overlay の表示 */
  showMap(on: boolean): void;
  /** buttons モードではスワイプの div を pointer-events:none にする */
  setSwipeEnabled(on: boolean): void;
};

function at(el: HTMLElement | SVGElement, x: number, y: number): void {
  el.style.position = "absolute";
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
}

export function createDungeonScreen(o: {
  strings: Strings;
  regions: Regions;
  /** 文字送りの 1 文字あたりの ms（UI-43） */
  textSpeed(): number;
  historyMax: number;
  onSettings(): void;
  onAction(a: DpadAction): void;
  onRelease(): void;
  onClose(): void;
}): DungeonScreen {
  const r = o.regions;
  const el = document.createElement("div");
  el.className = "screen screen-play";

  const header = createHeader({ strings: o.strings, onSettings: o.onSettings });
  at(header.el, r.header.x, r.header.y);

  // ビュー
  const viewBox = document.createElement("div");
  viewBox.className = "play-view";
  at(viewBox, r.view.x, r.view.y);
  viewBox.style.width = `${r.view.w}px`;
  viewBox.style.height = `${r.view.h}px`;
  const view = createDungeonSvg();
  at(view.el, 0, 0);
  viewBox.appendChild(view.el);
  // 街のビューは枠だけ（UI-61 の絵は M2 では無い）
  const townFrame = document.createElement("div");
  townFrame.className = "play-view-frame";
  viewBox.appendChild(townFrame);
  const swipeLayer = document.createElement("div");
  swipeLayer.className = "play-swipe";
  viewBox.appendChild(swipeLayer);

  const message = createMessageWindow({ speed: o.textSpeed, historyMax: o.historyMax });
  at(message.el, r.message.x, r.message.y);

  const party = createPartyPanel(o.strings);
  at(party.el, r.party.x, r.party.y);

  const controls = createControls({
    region: r.controls,
    strings: o.strings,
    onAction: o.onAction,
    onRelease: o.onRelease,
    onClose: o.onClose,
  });

  // 地図はビューの上端から、メッセージの下端まで（240×220）
  const map = createMapView();
  at(map.el, r.view.x, r.view.y);
  map.el.style.display = "none";

  el.append(viewBox, header.el, message.el, party.el, controls.el, map.el);

  return {
    el,
    header,
    view,
    swipeLayer,
    message,
    party,
    controls,
    map,
    setMode(m: PlayMode): void {
      view.el.style.display = m === "dungeon" ? "" : "none";
      townFrame.style.display = m === "town" ? "" : "none";
      swipeLayer.style.display = m === "dungeon" ? "" : "none";
    },
    showMap(on: boolean): void {
      map.el.style.display = on ? "" : "none";
    },
    setSwipeEnabled(on: boolean): void {
      swipeLayer.style.pointerEvents = on ? "auto" : "none";
    },
  };
}
