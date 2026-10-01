// UI-53 の迷宮の画面。ui §2 の 5 領域（ヘッダー、ビュー、メッセージ、パーティ、操作）を合成する。
// DOM は 1 回だけ作り、街（UI-52 の M2 版）でもヘッダー・メッセージ・パーティ・操作をそのまま使う（ビューは枠だけ）。
// - ビュー: 線画の SVG（240×150）。スワイプはステージ全体で受ける（input/tap.ts。UI-30）。受ける間は画面に class swipe-on を付け、
//   style.css で touch-action: none にする（ボタンの上で始めたスワイプがブラウザのパンにならないように。UI-37）。
// - 地図（UI-24）と全滅の内訳（UI-56）と履歴（UI-46）: ビューとメッセージの領域（既定 y16..235）を覆う overlay。パーティ欄は見えたまま。
// - キャンプと酒場のパネル（UI-53 / UI-59。views/camp.ts）: ビュー領域だけを覆う。メッセージ窓とパーティ欄は見えたまま。
// - 戦闘（UI-54）: ビューの中に敵グループの層（views/battle.ts）を重ね、battle の間は線画・街の枠を隠す。
//   ダイスの overlay（views/dice.ts、UI-40）はビューの中のいちばん上（モードを問わない）。全体攻撃の揺れ（UI-42）はビュー全体の translate。
// 各部品の位置と大きさは、config.ui.layout から作った regions と dungeonLayout（layout.ts）から決める。
// 部品の結線（何を描くか、Action を何にするか）は app が行う。モジュールのトップレベルでは DOM に触れない。
import type { GameData, Strings } from "../../core/data/index";
import type { Pos } from "../../core/types";
import type { DungeonLayout, Regions } from "../layout";
import { createBattleView, type BattleView } from "./battle";
import { createCampView, type CampView } from "./camp";
import { createControls, type Controls, type DpadAction } from "./controls";
import { createDiceView, type DiceView } from "./dice";
import { createDungeonSvg, type DungeonSvg } from "./dungeon-svg";
import { createHeader, type Header } from "./header";
import { createHistoryView, type HistoryView } from "./history";
import { createMapView, type MapViewEl } from "./map";
import { createMessageWindow, type MessageWindow } from "./message";
import { createPartyPanel, type PartyPanel } from "./party";
import { createWipeView, type WipeView } from "./wipe";

export type PlayMode = "town" | "dungeon" | "battle";

export type DungeonScreen = {
  el: HTMLElement;
  header: Header;
  view: DungeonSvg;
  message: MessageWindow;
  party: PartyPanel;
  controls: Controls;
  map: MapViewEl;
  /** ビューの中の敵グループの層（battle のときだけ見える） */
  battle: BattleView;
  /** ビューの中のダイスの overlay */
  dice: DiceView;
  /** UI-53 / UI-59 キャンプと酒場のパネル（ビュー領域を覆う） */
  camp: CampView;
  /** UI-56 の全滅の内訳の overlay（地図と同じ範囲） */
  wipe: WipeView;
  /** UI-46 の履歴の画面（地図と同じ範囲） */
  history: HistoryView;
  /** town ならビューは枠だけ、dungeon なら線画、battle なら敵グループ */
  setMode(m: PlayMode): void;
  /** UI-42 の全体攻撃: ビュー全体を translateX 0→−2→2→−2→0（ms が 0 以下なら何もせずに解決） */
  shake(ms: number): Promise<void>;
  /** 地図の overlay の表示 */
  showMap(on: boolean): void;
  /** UI-53 キャンプと酒場のパネルの表示 */
  showCamp(on: boolean): void;
  /** UI-56 の全滅の内訳の overlay の表示 */
  showWipe(on: boolean): void;
  /** UI-46 の履歴の画面の表示 */
  showHistory(on: boolean): void;
  /** UI-37: スワイプを受ける間は画面に class swipe-on を付ける（touch-action: none） */
  setSwipeOn(on: boolean): void;
};

function at(el: HTMLElement | SVGElement, x: number, y: number): void {
  el.style.position = "absolute";
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
}

export function createDungeonScreen(o: {
  data: GameData;
  strings: Strings;
  regions: Regions;
  /** regions から dungeonLayout で作った矩形 */
  layout: DungeonLayout;
  /** 文字送りの 1 文字あたりの ms（UI-43） */
  textSpeed(): number;
  historyMax: number;
  onSettings(): void;
  /** 十字ボタンのタップ */
  onAction(a: DpadAction): void;
  /** 前進ボタンの長押し（UI-31） */
  hold: { ms(): number; onHoldStart(): void; onHoldEnd(): void };
  onClose(): void;
  /** UI-54: 対象の選択中に敵の絵をタップした（グループの添字） */
  onPick?(g: number): void;
  /** UI-25: 地図本体のセルをタップした（盤内のセルの座標。探索済みかは見ない） */
  onMapCell?(p: Pos): void;
}): DungeonScreen {
  const r = o.regions;
  const lay = o.layout;
  const el = document.createElement("div");
  el.className = "screen screen-play";

  const header = createHeader({ strings: o.strings, region: r.header, layout: lay.header, onSettings: o.onSettings });

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
  const battle = createBattleView(o.data, o.strings, r.view.w, r.view.h, (g) => o.onPick?.(g));
  battle.el.style.display = "none";
  viewBox.appendChild(battle.el);
  const dice = createDiceView(o.strings);
  viewBox.appendChild(dice.el);

  const message = createMessageWindow({ speed: o.textSpeed, historyMax: o.historyMax, region: r.message, layout: lay.message });

  const party = createPartyPanel({
    strings: o.strings,
    classes: o.data.classes,
    region: r.party,
    rows: lay.partyRows,
  });

  const controls = createControls({
    region: r.controls,
    layout: lay,
    strings: o.strings,
    onAction: o.onAction,
    hold: o.hold,
    onClose: o.onClose,
  });

  // 地図はビューの上端から、メッセージの下端まで（既定 240×220）
  const map = createMapView(lay.map, (p) => o.onMapCell?.(p));
  map.el.style.display = "none";

  // キャンプと酒場のパネル（UI-53）はビュー領域だけ
  const camp = createCampView(lay.camp);
  camp.el.style.display = "none";

  // 全滅の内訳（UI-56）は地図と同じ範囲
  const wipe = createWipeView(lay.wipe);
  wipe.el.style.display = "none";

  // 履歴（UI-46）も同じ範囲
  const history = createHistoryView(lay.history);
  history.el.style.display = "none";

  el.append(viewBox, camp.el, header.el, message.el, party.el, controls.el, map.el, wipe.el, history.el);

  return {
    el,
    header,
    view,
    message,
    party,
    controls,
    map,
    battle,
    dice,
    camp,
    wipe,
    history,
    setMode(m: PlayMode): void {
      view.el.style.display = m === "dungeon" ? "" : "none";
      townFrame.style.display = m === "town" ? "" : "none";
      battle.el.style.display = m === "battle" ? "" : "none";
    },
    async shake(ms: number): Promise<void> {
      if (!(ms > 0)) return;
      const a = viewBox.animate(
        [
          { transform: "translateX(0px)" },
          { transform: "translateX(-2px)" },
          { transform: "translateX(2px)" },
          { transform: "translateX(-2px)" },
          { transform: "translateX(0px)" },
        ],
        { duration: ms, easing: "steps(4, end)" },
      );
      try {
        await a.finished;
      } catch {
        // cancel。そのまま先へ進む
      }
    },
    showMap(on: boolean): void {
      map.el.style.display = on ? "" : "none";
    },
    showCamp(on: boolean): void {
      camp.el.style.display = on ? "" : "none";
    },
    showWipe(on: boolean): void {
      wipe.el.style.display = on ? "" : "none";
    },
    showHistory(on: boolean): void {
      history.el.style.display = on ? "" : "none";
    },
    setSwipeOn(on: boolean): void {
      el.classList.toggle("swipe-on", on);
    },
  };
}
