// UI-53 の迷宮の画面。ui §2 の 5 領域（ヘッダー、ビュー、メッセージ、パーティ、操作）を合成する。
// DOM は 1 回だけ作り、街（UI-13。M8.5）でもヘッダー・ビュー・操作を使う。街ではビューに施設の絵（UI-61。views/town-picture.ts）を出し、
// メッセージ窓と 64 のパーティ欄を隠して、パーティの帯（views/party-band.ts）・見出しと一覧（controls の setList の town）を townLayout の位置に出す。
// 街の語りは会話の箱（UI-47。views/talk.ts）で、箱は閉じている間は見えない（setMode では出し入れしない。街を出るときは app が flush する）。
// - ビュー: 線画の SVG（240×150）。スワイプはステージ全体で受ける（input/tap.ts。UI-30）。受ける間は画面に class swipe-on を付け、
//   style.css で touch-action: none にする（ボタンの上で始めたスワイプがブラウザのパンにならないように。UI-37）。
// - 地図（UI-24）と全滅の内訳（UI-56）と履歴（UI-46）: ビューとメッセージの領域（既定 y16..235）を覆う overlay。パーティ欄は見えたまま。
// - キャンプと酒場のパネル（UI-53。views/camp.ts）: ビュー領域だけを覆う。メッセージ窓とパーティ欄は見えたまま。
//   キャラクター画面（UI-59。M10）と図鑑（IT-66。酒場だけ）は layout.character（ビューの上端から操作領域の上端まで）に広げるので、DOM では帯の後に置く。
//   キャラクター画面の間（setCharacterOpen）は、パーティ欄とメッセージ窓を隠し（パーティ欄はキャンプより上の層なので、隠さないと覆う）、
//   判定の箱をキャンプより上・会話の箱より下の層（diceLayer。ビューと同じ位置・寸法、押せない）へ移して会話の箱の上（townLayout の diceBottom）に出す。
// - 戦闘（UI-54）: ビューの中に敵グループの層（views/battle.ts）を重ね、battle の間は線画・街の絵を隠す。
//   ダイスの overlay（views/dice.ts、UI-40）はビューの中のいちばん上（モードを問わない）。全体攻撃の揺れ（UI-42）はビュー全体の translate。
// 各部品の位置と大きさは、config.ui.layout から作った regions と dungeonLayout（layout.ts）から決める。
// 部品の結線（何を描くか、Action を何にするか）は app が行う。モジュールのトップレベルでは DOM に触れない。
import type { SpriteInfo } from "../../build/asset-types";
import type { GameData, Strings } from "../../core/data/index";
import type { Character, Pos } from "../../core/types";
import type { DungeonLayout, Regions, TownLayout } from "../layout";
import { createBattleView, type BattleView } from "./battle";
import { createCampView, type CampView } from "./camp";
import { createControls, type Controls, type DpadAction, type UiSound } from "./controls";
import { createDiceView, DICE_BOX_BOTTOM, type DiceView } from "./dice";
import { createPenaltyTableView, type PenaltyTableView } from "./penalty-table";
import { createDungeonSvg, type DungeonSvg } from "./dungeon-svg";
import { createHeader, type Header } from "./header";
import { createHistoryView, type HistoryView } from "./history";
import { createMapView, type MapViewEl } from "./map";
import { createMessageWindow, type MessageWindow } from "./message";
import { createPartyPanel, type MaxOf, type PartyPanel, type StageOf } from "./party";
import { createPartyBand, type PartyBand } from "./party-band";
import { createTalkBox, type TalkBox } from "./talk";
import { createTownPicture } from "./town-picture";
import { createWipeView, type WipeView } from "./wipe";

export type PlayMode = "town" | "dungeon" | "battle";

export type DungeonScreen = {
  el: HTMLElement;
  header: Header;
  view: DungeonSvg;
  message: MessageWindow;
  /** パーティ欄（UI-12）。setSan / setLife / setStatus / render は街の帯（UI-13）にも反映する */
  party: PartyPanel;
  /** UI-13（M8.5）: 街のパーティの帯 */
  band: PartyBand;
  /** UI-47（M8.5）: 街の会話の箱（ログはメッセージ窓の履歴に入れる） */
  talk: TalkBox;
  /** UI-47（M8.5）: 街の施設の絵の層（再生の外のタップで会話を進める） */
  picture: HTMLElement;
  controls: Controls;
  map: MapViewEl;
  /** ビューの中の敵グループの層（battle のときだけ見える） */
  battle: BattleView;
  /** ビューの中のダイスの overlay */
  dice: DiceView;
  /** UI-56（M5.5）: ビューの中の全滅の出目の表（ダイスと同じ層） */
  penaltyTable: PenaltyTableView;
  /** UI-53 / UI-59 キャンプと酒場のパネル（ビュー領域を覆う） */
  camp: CampView;
  /** UI-56 の全滅の内訳の overlay（地図と同じ範囲） */
  wipe: WipeView;
  /** UI-46 の履歴の画面（地図と同じ範囲） */
  history: HistoryView;
  /** town ならビューは施設の絵（UI-61）で、メッセージ窓とパーティ欄を隠して帯とログのボタンを出す。dungeon なら線画、battle なら敵グループ */
  setMode(m: PlayMode): void;
  /** UI-61（M8.5）: 街の施設の絵（townFacility の id。一覧に無ければ黒） */
  setTownPicture(facility: string): void;
  /** UI-42 の全体攻撃: ビュー全体を translateX 0→−2→2→−2→0（ms が 0 以下なら何もせずに解決） */
  shake(ms: number): Promise<void>;
  /** 地図の overlay の表示 */
  showMap(on: boolean): void;
  /** UI-53 キャンプと酒場のパネルの表示 */
  showCamp(on: boolean): void;
  /**
   * UI-59（M10）: キャラクター画面の間か。真ならパーティ欄とメッセージ窓を隠し、判定の箱を diceLayer へ移して会話の箱の上に出す。
   * 偽なら setMode の見え方と、ビューの中の判定の箱（迷宮・戦闘の下端）に戻す
   */
  setCharacterOpen(on: boolean): void;
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

/**
 * UI-13 / UI-69（M10）: 帯へ渡す実効の sanMax と Lv UP 可。どちらも maxOf（app が渡す core の memberSheet）の値を中継するだけ（UI-35）。
 * maxOf が無ければ素の sanMax で、Lv の印は出さない
 */
export function bandLookups(maxOf: MaxOf | undefined): { sanMaxOf: (ch: Character) => number; levelUpOf: (ch: Character) => boolean } {
  return {
    sanMaxOf: (ch) => (maxOf !== undefined ? maxOf(ch).sanMax : ch.sanMax),
    levelUpOf: (ch) => (maxOf !== undefined ? maxOf(ch).canLevelUp === true : false),
  };
}

/** 表示の出し入れだけを使う要素（applyPanels の引数。テストでは偽の要素を渡す） */
export type Displayed = { style: { display: string } };

/**
 * UI-13 / UI-59 / UI-40（M10）: メッセージ窓・パーティ欄・判定の箱の下端。街かキャラクター画面なら窓と欄を隠し、
 * 判定の箱の下端を会話の箱の上（townDiceBottom）に上げる。それ以外は窓と欄を出し、箱は迷宮の下端（DICE_BOX_BOTTOM）
 */
export function applyPanels(
  mode: PlayMode,
  characterOpen: boolean,
  p: { message: Displayed; panel: Displayed; setDiceBottom(bottom: number): void },
  townDiceBottom: number,
): void {
  const hide = mode === "town" || characterOpen;
  p.message.style.display = hide ? "none" : "";
  p.panel.style.display = hide ? "none" : "";
  p.setDiceBottom(hide ? townDiceBottom : DICE_BOX_BOTTOM);
}

/**
 * UI-59 / UI-40（M10）: 判定の箱の付け替え。キャラクター画面を開いたら diceLayer（キャンプのパネルより上・会話の箱より下）の子に、
 * 閉じたらビューの中の全滅の出目の表（anchor）の前の元の位置へ戻す。appendChild / insertBefore だけを使う（テストでは偽の要素を渡す）
 */
export function placeDice<N>(on: boolean, p: { dice: N; layer: { appendChild(n: N): unknown }; viewBox: { insertBefore(n: N, ref: N): unknown }; anchor: N }): void {
  if (on) p.layer.appendChild(p.dice);
  else p.viewBox.insertBefore(p.dice, p.anchor);
}

export function createDungeonScreen(o: {
  data: GameData;
  strings: Strings;
  regions: Regions;
  /** regions から dungeonLayout で作った矩形 */
  layout: DungeonLayout;
  /** UI-13（M8.5）: regions から townLayout で作った街の画面の矩形 */
  town: TownLayout;
  /** 文字送りの 1 文字あたりの ms（UI-43） */
  textSpeed(): number;
  /** UI-47: 会話の箱のタップ待ちの ▼ を点滅させるか（演出スキップでは偽） */
  talkBlink(): boolean;
  historyMax: number;
  /** UI-12: パーティ欄の SAN の段（core の sanStage） */
  stageOf: StageOf;
  /** UI-12 / TW-15 / CH-14: パーティ欄の HP / MP / SAN の最大（core の memberSheet。省略は素の値） */
  maxOf?: MaxOf;
  onSettings(): void;
  /** UI-46 / UI-13（M8.5）: 街のヘッダーのログ */
  onLog(): void;
  /** UI-13（M8.5）: 街の帯のタップ（その人の id） */
  onBand(memberId: string): void;
  /** 十字ボタンのタップ */
  onAction(a: DpadAction): void;
  /** 前進ボタンの長押し（UI-31） */
  hold: { ms(): number; onHoldStart(): void; onHoldEnd(): void };
  onClose(): void;
  /** UI-54: 対象の選択中に敵の絵をタップした（グループの添字） */
  onPick?(g: number): void;
  /** UI-25: 地図本体のタップを探索済みのセルに吸着させた（config.ui.mapSnapPx 以内。範囲外のタップでは呼ばない） */
  onMapCell?(p: Pos): void;
  /** UI-25: 操作領域の地図の「移動」（選んでいるときだけ呼ぶ） */
  onMapGo?(): void;
  /** UI-66（M8）: 操作領域の決定・取り消しの音（controls の onSound） */
  onSound?(k: UiSound): void;
  /** UI-66（2026-10-06）: 会話の箱の送り（次の文へ・閉じる）。即表示では呼ばない */
  talkAdvanced?(): void;
  /** UI-60（M8）: public/sprites に実在する絵の一覧（GameAssets.sprites）。省略時は絵を読まない */
  sprites?: Readonly<Record<string, SpriteInfo>>;
  /** UI-61（M8.5）: public/town に実在する施設の絵の一覧（GameAssets.town）。省略時は黒 */
  townPictures?: Readonly<Record<string, SpriteInfo>>;
}): DungeonScreen {
  const r = o.regions;
  const lay = o.layout;
  const el = document.createElement("div");
  el.className = "screen screen-play";

  const tl = o.town;
  const header = createHeader({ strings: o.strings, region: r.header, layout: lay.header, town: tl.header, onSettings: o.onSettings, onLog: o.onLog });

  // ビュー
  const viewBox = document.createElement("div");
  viewBox.className = "play-view";
  at(viewBox, r.view.x, r.view.y);
  viewBox.style.width = `${r.view.w}px`;
  viewBox.style.height = `${r.view.h}px`;
  const view = createDungeonSvg();
  at(view.el, 0, 0);
  viewBox.appendChild(view.el);
  // UI-61（M8.5）: 街のビューは施設の絵（一覧に無ければ黒）
  const townPic = createTownPicture({ w: r.view.w, h: r.view.h, available: o.townPictures ?? {}, base: import.meta.env.BASE_URL });
  viewBox.appendChild(townPic.el);
  const battle = createBattleView(o.data, o.strings, r.view.w, r.view.h, (g) => o.onPick?.(g), o.sprites ?? {});
  battle.el.style.display = "none";
  viewBox.appendChild(battle.el);
  const dice = createDiceView(o.strings);
  viewBox.appendChild(dice.el);
  const penaltyTable = createPenaltyTableView();
  viewBox.appendChild(penaltyTable.el);

  const message = createMessageWindow({ speed: o.textSpeed, historyMax: o.historyMax, region: r.message, layout: lay.message });

  const panel = createPartyPanel({
    strings: o.strings,
    classes: o.data.classes,
    region: r.party,
    rows: lay.partyRows,
    stageOf: o.stageOf,
    ...(o.maxOf !== undefined ? { maxOf: o.maxOf } : {}),
  });

  // UI-13（M8.5）: 街のパーティの帯。段は core の sanStage、最大は memberSheet の実効の sanMax（パーティ欄と同じ）
  const band = createPartyBand({
    strings: o.strings,
    row: tl.band.row,
    cells: tl.band.cells,
    hits: tl.band.hits,
    stageOf: o.stageOf,
    ...bandLookups(o.maxOf),
    onPick: (id) => o.onBand(id),
  });
  band.el.style.display = "none";
  /** パーティ欄の setter を帯にも流す（再生中の sanChanged / statusChanged / lifeChanged と、sync の render） */
  const party: PartyPanel = {
    ...panel,
    render(p): void {
      panel.render(p);
      band.render(p);
    },
    setSan(id, san): void {
      panel.setSan(id, san);
      band.setSan(id, san);
    },
    setLife(id, life): void {
      panel.setLife(id, life);
      band.setLife(id, life);
    },
    setStatus(id, status, on): void {
      panel.setStatus(id, status, on);
      band.setStatus(id, status, on);
    },
  };

  const controls = createControls({
    region: r.controls,
    layout: { ...lay, townList: { heading: tl.heading, area: tl.list.area, rows: tl.list.rows, grid: tl.grid } },
    strings: o.strings,
    onAction: o.onAction,
    hold: o.hold,
    onClose: o.onClose,
    onMapGo: () => o.onMapGo?.(),
    onSound: (k) => o.onSound?.(k),
  });

  // 地図はビューの上端から、メッセージの下端まで（既定 240×220）
  const map = createMapView(lay.map, (p) => o.onMapCell?.(p), o.data.config.ui.mapSnapPx);
  map.el.style.display = "none";

  // キャンプと酒場のパネル（UI-53）はビュー領域だけ（キャラクター画面と酒場の図鑑は layout.character に広げる。M8.5 / M10）
  const camp = createCampView(lay.camp, lay.character);
  camp.el.style.display = "none";

  // UI-59 / UI-40（M10）: キャラクター画面の間の判定の箱の層（キャンプのパネルより上、会話の箱より下。押せない）
  const diceLayer = document.createElement("div");
  diceLayer.className = "dice-layer";
  at(diceLayer, r.view.x, r.view.y);
  Object.assign(diceLayer.style, { width: `${r.view.w}px`, height: `${r.view.h}px`, pointerEvents: "none" });

  // 全滅の内訳（UI-56）は地図と同じ範囲
  const wipe = createWipeView(lay.wipe);
  wipe.el.style.display = "none";

  // 履歴（UI-46）も同じ範囲
  const history = createHistoryView(lay.history);
  history.el.style.display = "none";

  // UI-47（M8.5）: 街の会話の箱。キャンプのパネルより上（酒場の呪文の結果が見える）、overlay より下。ログはメッセージ窓の 1 本の履歴
  const talk = createTalkBox({ layout: tl.talk, speed: o.textSpeed, blink: o.talkBlink, log: (t) => message.log(t), advanced: () => o.talkAdvanced?.() });

  el.append(viewBox, header.el, message.el, band.el, camp.el, diceLayer, talk.el, panel.el, controls.el, map.el, wipe.el, history.el);

  let mode: PlayMode = "dungeon";
  let characterOpen = false;
  /**
   * メッセージ窓・パーティ欄・判定の箱の下端（街かキャラクター画面なら窓と欄を隠し、箱は会話の箱の上）。
   * UI-13: 街はメッセージ窓とパーティ欄を置かず、帯とヘッダーのログを出す。UI-59（M10）: キャラクター画面の間も隠す
   */
  const syncPanels = (): void => applyPanels(mode, characterOpen, { message: message.el, panel: panel.el, setDiceBottom: (b) => dice.setBottom(b) }, tl.diceBottom);

  return {
    el,
    header,
    view,
    message,
    party,
    band,
    talk,
    picture: townPic.el,
    controls,
    map,
    battle,
    dice,
    penaltyTable,
    camp,
    wipe,
    history,
    setMode(m: PlayMode): void {
      mode = m;
      const town = m === "town";
      view.el.style.display = m === "dungeon" ? "" : "none";
      townPic.el.style.display = town ? "" : "none";
      battle.el.style.display = m === "battle" ? "" : "none";
      band.el.style.display = town ? "" : "none";
      header.setLogVisible(town);
      syncPanels();
    },
    setTownPicture(facility: string): void {
      townPic.show(facility);
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
    setCharacterOpen(on: boolean): void {
      characterOpen = on;
      // 付け替えは appendChild / insertBefore だけ（ビューの中では全滅の出目の表の前の、元の位置へ戻す）
      placeDice(on, { dice: dice.el, layer: diceLayer, viewBox, anchor: penaltyTable.el });
      syncPanels();
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
