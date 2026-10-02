// UI-32 / UI-53 の操作領域（ui §2 の controls 領域）。十字ボタン（dpad）、メニュー（menu）、リスト（list）、
// 地図の「閉じる」（mapClose）と「移動」（mapGo。map モード）、戦闘のパーティの選択 4 枠・メンバーの 5 枠・街の施設 6 枠・キャンプの 8 枠（battle）、オート中の「オート解除」（autoStop）を切り替えて出す。矩形は layout.ts の dungeonLayout のステージ座標で、region の原点を引いて置く。
// どのボタンも input/tap.ts の onTap で登録し、「動かずに離した」ときに反応する（UI-36。click は使わない）。
// 前進ボタンだけは、動かずに hold.ms() 押し続けたら hold.onHoldStart（長押しの連打）、離したら hold.onHoldEnd（UI-31）。
// 「オート解除」は再生中も反応する（whileBusy。UI-44 の例外）。
// 末尾が戻る / やめるの一覧は、その項目を一覧の外（layout.listBack）に固定し、一覧だけを縦にスクロールする（UI-11）。
// Action から Command への変換と長押しの連打は呼び出し側（app）が持つ。表示層は前進できるかを判定しない（UI-35）。
// モジュールのトップレベルでは DOM に触れない。
import type { Strings } from "../../core/data/index";
import { onTap } from "../input/tap";
import type { DungeonLayout, Rect } from "../layout";

export type DpadAction = "forward" | "left" | "right" | "around";
export type ControlsMode = "dpad" | "list" | "close" | "map" | "battle" | "autoStop" | "none";
/** disabled なら dim 色で出し、押しても onSelect を呼ばない */
/** onFocus は一覧の行に pointerenter / pointerdown したとき（戦闘の対象の注目。UI-54。押しただけで、選ぶのは離したとき） */
export type ControlItem = { label: string; onSelect(): void; disabled?: boolean; onFocus?(): void };
/** 枠の配置（UI-54）。party は戦闘のパーティの選択の 4 枠、member はメンバーの 5 枠、town は街の施設メニューの 6 枠（UI-52）、camp はキャンプの 8 枠（UI-53） */
export type BattleSlots = "party" | "member" | "town" | "camp";

export type Controls = {
  el: HTMLElement;
  /** dpad = 十字ボタンとメニュー、list = リスト、close = 「閉じる」だけ、map = 地図の「閉じる」と「移動」（UI-25）、none = 何も出さない */
  setMode(m: ControlsMode): void;
  /** inputMode が swipe なら十字ボタンを隠す（メニューは残す） */
  setDpadVisible(on: boolean): void;
  /** layout.menu に並べる（5 件目以降は捨てる） */
  setMenu(items: ControlItem[]): void;
  /**
   * layout.list の位置に並べる。4 件以上は縦スクロール（UI-11）。
   * fixedLast なら末尾の項目（戻る / やめる）を一覧の外の layout.listBack に固定し、残りを幅の狭い layout.listNarrow の一覧に置く。
   * 添字（select・setListFocus・数字キー）は fixedLast によらず items の順（末尾が戻る / やめる）
   */
  setList(items: ControlItem[], opts?: { fixedLast?: boolean }): void;
  /**
   * UI-54: slots の配置（layout.battleParty の 4 枠 / battleMember の 5 枠 / townMenu の 6 枠 / campGrid の 8 枠）に並べる。
   * null は空き枠（何も置かない）。枠数を超える分は捨てる
   */
  setBattleMenu(items: (ControlItem | null)[], slots: BattleSlots): void;
  /**
   * UI-54: 一覧の i 行目を注目の見た目（枠線を accent 色。dim の行は dim のまま）にし、見える位置へ動かす。null で解除。
   * 一覧は作り直さない。scroll: false なら見える位置へは動かさない（ポインタで触れた行。タッチの途中で一覧が動かないように）
   */
  setListFocus(i: number | null, opts?: { scroll?: boolean }): void;
  /** UI-25: map モードの「移動」を押せるか（偽なら dim 色で、押しても onMapGo を呼ばない） */
  setMapGo(enabled: boolean): void;
  /** close モードの唯一のボタンの文言（既定は common.close。全滅の内訳では wipe.toTown） */
  setCloseLabel(label: string): void;
  /** オート中の「オート解除」。タップで onPress を呼ぶ（再生中も受ける。UI-44 の例外は呼び出し側が扱う） */
  setAutoStop(label: string, onPress: () => void): void;
  /**
   * n 番目（0 始まり）を選ぶ。dpad ではメニュー、list ではリスト、battle では戦闘の枠、close / autoStop では 0 が唯一のボタン、
   * map では 0 が閉じる・1 が移動。
   * 範囲外と disabled は何もしない
   */
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
  });
}

function setShown(el: HTMLElement, on: boolean): void {
  el.style.display = on ? "" : "none";
}

/**
 * region は ui §2 の controls 領域（ステージ座標）。el はその位置と大きさに自分で置く。
 * onAction は十字ボタンのタップ（動かずに離した）。hold は前進ボタンの長押し（UI-31）。
 */
export function createControls(o: {
  region: Rect;
  layout: Pick<DungeonLayout, "dpad" | "menu" | "list" | "listNarrow" | "listBack" | "mapClose" | "mapGo" | "battleParty" | "battleMember" | "autoStop" | "townMenu" | "campGrid">;
  strings: Strings;
  onAction(a: DpadAction): void;
  hold: { ms(): number; onHoldStart(): void; onHoldEnd(): void };
  onClose(): void;
  /** UI-25: 地図の「移動」（押せるときだけ呼ぶ） */
  onMapGo?(): void;
}): Controls {
  const s = (key: string): string => o.strings[key] ?? key;
  const origin = o.region;
  const DPAD = o.layout.dpad;
  const MENU_SLOTS = o.layout.menu;
  const LIST_ROWS = o.layout.list;
  const BATTLE_SLOTS: Readonly<Record<BattleSlots, readonly Rect[]>> = {
    party: o.layout.battleParty,
    member: o.layout.battleMember,
    town: o.layout.townMenu,
    camp: o.layout.campGrid,
  };

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
    b.tabIndex = -1; // 矢印キーと重複するのでタブ順から外す。フォーカス中の Enter も confirm のまま（swipe.ts の isButton）
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
    // UI-31: 前進だけ長押しで連打する（短く離せば 1 歩）
    onTap(b, a === "forward" ? { onTap: () => o.onAction(a), hold: o.hold } : () => o.onAction(a));
    dpad.appendChild(b);
  }

  // ---- メニュー（layout.menu）
  const menu = document.createElement("div");
  menu.className = "controls-menu";
  el.appendChild(menu);
  let menuItems: ControlItem[] = [];

  // ---- リスト（layout.list。行は連続しているので 1 つのスクロール容器に縦に積む）
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
  });
  el.appendChild(list);
  let listItems: ControlItem[] = [];
  /** 行の要素（fixedLast なら末尾は listBack のボタン）。添字は listItems と同じ */
  let listButtons: HTMLElement[] = [];
  const narrow = o.layout.listNarrow[0] ?? first;
  /** UI-11: 一覧の外に固定する戻る / やめる（setList の fixedLast のときだけ出す） */
  const listBackRect = o.layout.listBack;
  let listBackOn = false;
  const listBack = document.createElement("div");
  listBack.className = "controls-list-back";
  el.appendChild(listBack);

  // ---- 地図の「閉じる」
  const close = document.createElement("button");
  close.type = "button";
  close.className = "controls-close";
  close.textContent = s("common.close");
  buttonStyle(close, o.layout.mapClose, origin);
  onTap(close, () => o.onClose());
  el.appendChild(close);

  // ---- 地図の「移動」（UI-25。map モードで閉じるの真下）
  const mapGo = document.createElement("button");
  mapGo.type = "button";
  mapGo.className = "controls-map-go";
  mapGo.textContent = s("map.go");
  buttonStyle(mapGo, o.layout.mapGo, origin);
  let mapGoOn = false;
  const paintMapGo = (): void => {
    mapGo.style.color = mapGoOn ? "var(--c-text)" : "var(--c-dim)";
    mapGo.style.borderColor = mapGoOn ? "var(--c-frame)" : "var(--c-dim)";
    mapGo.setAttribute("aria-disabled", mapGoOn ? "false" : "true");
  };
  paintMapGo();
  const pressMapGo = (): void => {
    if (mapGoOn) o.onMapGo?.();
  };
  onTap(mapGo, () => pressMapGo());
  el.appendChild(mapGo);

  // ---- 戦闘の枠（layout.battleParty / battleMember）
  const battle = document.createElement("div");
  battle.className = "controls-battle";
  el.appendChild(battle);
  let battleItems: (ControlItem | null)[] = [];

  // ---- オート中の「オート解除」
  const autoStop = document.createElement("button");
  autoStop.type = "button";
  autoStop.className = "controls-auto-stop";
  buttonStyle(autoStop, o.layout.autoStop, origin);
  let autoStopPress: () => void = () => {};
  onTap(autoStop, { onTap: () => autoStopPress(), whileBusy: true });
  el.appendChild(autoStop);

  let mode: ControlsMode = "none";
  let dpadVisible = true;

  const apply = (): void => {
    setShown(dpad, mode === "dpad" && dpadVisible);
    setShown(menu, mode === "dpad");
    setShown(list, mode === "list");
    setShown(listBack, mode === "list" && listBackOn);
    setShown(close, mode === "close" || mode === "map");
    setShown(mapGo, mode === "map");
    setShown(battle, mode === "battle");
    setShown(autoStop, mode === "autoStop");
  };

  /** disabled の見た目（dim 色）。押しても onSelect を呼ばない */
  const pick = (it: ControlItem): void => {
    if (it.disabled !== true) it.onSelect();
  };
  const dimIf = (b: HTMLElement, it: ControlItem): void => {
    if (it.disabled === true) {
      b.style.color = "var(--c-dim)";
      b.style.borderColor = "var(--c-dim)";
      b.setAttribute("aria-disabled", "true");
    }
  };
  apply();

  return {
    el,
    setMode(m: ControlsMode): void {
      mode = m;
      apply();
      // UI-11: 一覧は出すたびに先頭から見せる（display:none の間の代入が効かないことがあるので、表示した後にも 0 にする）
      if (m === "list") list.scrollTop = 0;
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
        dimIf(b, it);
        onTap(b, () => pick(it));
        menu.appendChild(b);
      });
    },
    setList(items: ControlItem[], opts?: { fixedLast?: boolean }): void {
      listItems = items.slice();
      listButtons = [];
      list.replaceChildren();
      listBack.replaceChildren();
      list.scrollTop = 0;
      const fixed = opts?.fixedLast === true && listItems.length > 0;
      listBackOn = fixed;
      const rowW = fixed ? narrow.w : first.w;
      list.style.width = `${rowW}px`;
      listItems.forEach((it, k) => {
        const isBack = fixed && k === listItems.length - 1;
        const b = document.createElement("button");
        b.type = "button";
        b.className = isBack ? "controls-list-back-item" : "controls-list-item";
        b.textContent = it.label;
        if (isBack) buttonStyle(b, listBackRect, origin);
        else
          Object.assign(b.style, {
            display: "block",
            width: `${rowW}px`,
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
          });
        dimIf(b, it);
        onTap(b, () => pick(it));
        const focus = it.onFocus;
        if (focus !== undefined) {
          // 対象の一覧の Enter は、DOM のフォーカスのある行の click ではなく、いつも注目している行を選ぶ（UI-33。swipe.ts の isButton）
          b.tabIndex = -1;
          b.addEventListener("pointerenter", () => focus());
          b.addEventListener("pointerdown", () => focus());
        }
        (isBack ? listBack : list).appendChild(b);
        listButtons.push(b);
      });
      apply();
    },
    setListFocus(i: number | null, opts?: { scroll?: boolean }): void {
      listButtons.forEach((b, k) => {
        if (listItems[k]?.disabled === true) return;
        b.style.borderColor = k === i ? "var(--c-accent)" : "var(--c-frame)";
      });
      const b = i === null ? undefined : listButtons[i];
      if (opts?.scroll === false) return;
      // 固定の戻る / やめるは一覧の外なので動かさない（overflow hidden の祖先をスクロールさせない）
      if (listBackOn && i === listButtons.length - 1) return;
      if (b !== undefined && typeof b.scrollIntoView === "function") b.scrollIntoView({ block: "nearest" });
    },
    setBattleMenu(items: (ControlItem | null)[], slots: BattleSlots): void {
      const rects = BATTLE_SLOTS[slots];
      battleItems = items.slice(0, rects.length);
      battle.replaceChildren();
      battleItems.forEach((it, i) => {
        const r = rects[i];
        if (r === undefined || it === null) return;
        const b = document.createElement("button");
        b.type = "button";
        b.className = "controls-battle-item";
        b.textContent = it.label;
        buttonStyle(b, r, origin);
        dimIf(b, it);
        onTap(b, () => pick(it));
        battle.appendChild(b);
      });
    },
    setMapGo(enabled: boolean): void {
      mapGoOn = enabled;
      paintMapGo();
    },
    setCloseLabel(label: string): void {
      if (close.textContent !== label) close.textContent = label;
    },
    setAutoStop(label: string, onPress: () => void): void {
      autoStop.textContent = label;
      autoStopPress = onPress;
    },
    select(n: number): void {
      const at = (items: readonly (ControlItem | null)[]): void => {
        const it = items[n];
        if (it !== undefined && it !== null) pick(it);
      };
      if (mode === "dpad") at(menuItems);
      else if (mode === "list") at(listItems);
      else if (mode === "battle") at(battleItems);
      else if ((mode === "close" || mode === "map") && n === 0) o.onClose();
      else if (mode === "map" && n === 1) pressMapGo();
      else if (mode === "autoStop" && n === 0) autoStopPress();
    },
  };
}
