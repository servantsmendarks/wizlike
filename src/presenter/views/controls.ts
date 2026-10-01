// UI-32 / UI-53 の操作領域（ui §2 の controls 領域）。十字ボタン（dpad）、メニュー（menu）、リスト（list）、
// 地図の「閉じる」（mapClose）、戦闘のパーティの選択 4 枠・メンバーの 5 枠（battle）、オート中の「オート解除」（autoStop）を切り替えて出す。矩形は layout.ts の dungeonLayout のステージ座標で、region の原点を引いて置く。
// 十字ボタンは pointerdown で反応する（click は使わない）。離したら onRelease（前進の長押しの連打を止める。UI-31）。
// ゴーストクリックの抑止: 十字ボタンと「オート解除」は pointerdown で反応し、演出スキップ中は指を離す前に同じ位置へ
// 戦闘の枠や一覧（click で反応）が出ることがある。タッチ由来の click は pointerdown の preventDefault では止まらないので、
// それらの pointerdown から、同じ操作の pointerup / pointercancel の後 GHOST_CLICK_MS までの click を、戦闘の枠と一覧と
// close のボタン（全滅の内訳の「街へ」は「オート解除」と同じ矩形に出る）では捨てる。
// 新しい pointerdown（別の操作の始まり）が来たら抑止を解く。時刻は event.timeStamp で比べ、タイマーは使わない。
// Action から Command への変換と長押しの連打は呼び出し側（app）が持つ。表示層は前進できるかを判定しない（UI-35）。
// モジュールのトップレベルでは DOM に触れない。
import type { Strings } from "../../core/data/index";
import type { DungeonLayout, Rect } from "../layout";

export type DpadAction = "forward" | "left" | "right" | "around";
export type ControlsMode = "dpad" | "list" | "close" | "battle" | "autoStop" | "none";
/** disabled なら dim 色で出し、押しても onSelect を呼ばない */
/** onFocus は一覧の行に pointerenter / pointerdown したとき（戦闘の対象の注目。UI-54） */
export type ControlItem = { label: string; onSelect(): void; disabled?: boolean; onFocus?(): void };
/** 枠の配置（UI-54）。party は戦闘のパーティの選択の 4 枠、member はメンバーの 5 枠、town は街の施設メニューの 4 枠（UI-52） */
export type BattleSlots = "party" | "member" | "town";

export type Controls = {
  el: HTMLElement;
  /** dpad = 十字ボタンとメニュー、list = リスト、close = 地図の「閉じる」だけ、none = 何も出さない */
  setMode(m: ControlsMode): void;
  /** inputMode が swipe なら十字ボタンを隠す（メニューは残す） */
  setDpadVisible(on: boolean): void;
  /** layout.menu に並べる（5 件目以降は捨てる） */
  setMenu(items: ControlItem[]): void;
  /** layout.list の位置に並べる。4 件以上は縦スクロール（UI-11） */
  setList(items: ControlItem[]): void;
  /** UI-54: slots の配置（layout.battleParty の 4 枠 / battleMember の 5 枠 / townMenu の 4 枠）に並べる。枠数を超える分は捨てる */
  setBattleMenu(items: ControlItem[], slots: BattleSlots): void;
  /**
   * UI-54: 一覧の i 行目を注目の見た目（枠線を accent 色。dim の行は dim のまま）にし、見える位置へ動かす。null で解除。
   * 一覧は作り直さない。scroll: false なら見える位置へは動かさない（ポインタで触れた行。タッチの途中で一覧が動かないように）
   */
  setListFocus(i: number | null, opts?: { scroll?: boolean }): void;
  /** close モードの唯一のボタンの文言（既定は common.close。全滅の内訳では wipe.toTown） */
  setCloseLabel(label: string): void;
  /** オート中の「オート解除」。pointerdown で onPress を呼ぶ（再生中も受ける。UI-44 の例外は呼び出し側が扱う） */
  setAutoStop(label: string, onPress: () => void): void;
  /**
   * n 番目（0 始まり）を選ぶ。dpad ではメニュー、list ではリスト、battle では戦闘の枠、close / autoStop では 0 が唯一のボタン。
   * 範囲外と disabled は何もしない
   */
  select(n: number): void;
};

const SVG_NS = "http://www.w3.org/2000/svg";

/** pointerdown で反応したボタンを離してから、戦闘の枠と一覧の click を捨てる時間（ms） */
export const GHOST_CLICK_MS = 400;

/**
 * 純粋なゴーストクリックの抑止の状態機械（DOM に触れない）。arm は pointerdown で反応したボタン、
 * down は任意の pointerdown（arm より先に呼ぶ）、up は pointerup / pointercancel、blocks は click を捨てるか
 */
export function createGhostClickGuard(windowMs = GHOST_CLICK_MS): {
  down(): void;
  arm(): void;
  up(timeStamp: number): void;
  blocks(timeStamp: number): boolean;
} {
  let armed = false;
  let releasedAt = Number.NEGATIVE_INFINITY;
  return {
    down(): void {
      armed = false;
      releasedAt = Number.NEGATIVE_INFINITY;
    },
    arm(): void {
      armed = true;
      releasedAt = Number.NEGATIVE_INFINITY;
    },
    up(timeStamp: number): void {
      if (!armed) return;
      armed = false;
      releasedAt = timeStamp;
    },
    blocks(timeStamp: number): boolean {
      if (armed) return true;
      return timeStamp - releasedAt < windowMs;
    },
  };
}

/** event.timeStamp（無ければ 0） */
function stampOf(e: Event): number {
  return typeof e.timeStamp === "number" ? e.timeStamp : 0;
}

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
 * onAction は十字ボタンを押した瞬間、onRelease は離したとき（pointerup / pointercancel / pointerleave / lostpointercapture）に呼ぶ。
 */
export function createControls(o: {
  region: Rect;
  layout: Pick<DungeonLayout, "dpad" | "menu" | "list" | "mapClose" | "battleParty" | "battleMember" | "autoStop" | "townMenu">;
  strings: Strings;
  onAction(a: DpadAction): void;
  onRelease(): void;
  onClose(): void;
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

  // ---- ゴーストクリックの抑止（キャプチャ段で、ボタンの pointerdown の arm より先に down を呼ぶ）
  const ghost = createGhostClickGuard();
  el.addEventListener("pointerdown", () => ghost.down(), true);
  el.addEventListener("pointerup", (e) => ghost.up(stampOf(e)), true);
  el.addEventListener("pointercancel", (e) => ghost.up(stampOf(e)), true);
  /** 戦闘の枠と一覧の click。抑止中なら捨てる */
  const onGuardedClick = (it: ControlItem) => (e: Event): void => {
    if (ghost.blocks(stampOf(e))) return;
    pick(it);
  };

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
    b.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      ghost.arm();
      o.onAction(a);
    });
    const release = (): void => o.onRelease();
    b.addEventListener("pointerup", release);
    b.addEventListener("pointercancel", release);
    b.addEventListener("pointerleave", release);
    // 押したままボタンが隠れたときなど、pointerup の代わりにこれだけが届く場合がある
    b.addEventListener("lostpointercapture", release);
    // pointerdown の preventDefault で click は来ないことがあるので、click では何もしない
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
    touchAction: "pan-y",
  });
  el.appendChild(list);
  let listItems: ControlItem[] = [];
  let listButtons: HTMLElement[] = [];

  // ---- 地図の「閉じる」
  const close = document.createElement("button");
  close.type = "button";
  close.className = "controls-close";
  close.textContent = s("common.close");
  buttonStyle(close, o.layout.mapClose, origin);
  close.addEventListener("click", (e) => {
    if (!ghost.blocks(stampOf(e))) o.onClose();
  });
  el.appendChild(close);

  // ---- 戦闘の枠（layout.battleParty / battleMember）
  const battle = document.createElement("div");
  battle.className = "controls-battle";
  el.appendChild(battle);
  let battleItems: ControlItem[] = [];

  // ---- オート中の「オート解除」
  const autoStop = document.createElement("button");
  autoStop.type = "button";
  autoStop.className = "controls-auto-stop";
  buttonStyle(autoStop, o.layout.autoStop, origin);
  let autoStopPress: () => void = () => {};
  autoStop.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    ghost.arm();
    autoStopPress();
  });
  el.appendChild(autoStop);

  let mode: ControlsMode = "none";
  let dpadVisible = true;

  const apply = (): void => {
    setShown(dpad, mode === "dpad" && dpadVisible);
    setShown(menu, mode === "dpad");
    setShown(list, mode === "list");
    setShown(close, mode === "close");
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
        b.addEventListener("click", () => pick(it));
        menu.appendChild(b);
      });
    },
    setList(items: ControlItem[]): void {
      listItems = items.slice();
      listButtons = [];
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
        dimIf(b, it);
        b.addEventListener("click", onGuardedClick(it));
        const focus = it.onFocus;
        if (focus !== undefined) {
          // 対象の一覧の Enter は、DOM のフォーカスのある行の click ではなく、いつも注目している行を選ぶ（UI-33。swipe.ts の isButton）
          b.tabIndex = -1;
          b.addEventListener("pointerenter", () => focus());
          b.addEventListener("pointerdown", () => focus());
        }
        list.appendChild(b);
        listButtons.push(b);
      }
    },
    setListFocus(i: number | null, opts?: { scroll?: boolean }): void {
      listButtons.forEach((b, k) => {
        if (listItems[k]?.disabled === true) return;
        b.style.borderColor = k === i ? "var(--c-accent)" : "var(--c-frame)";
      });
      const b = i === null ? undefined : listButtons[i];
      if (opts?.scroll === false) return;
      if (b !== undefined && typeof b.scrollIntoView === "function") b.scrollIntoView({ block: "nearest" });
    },
    setBattleMenu(items: ControlItem[], slots: BattleSlots): void {
      const rects = BATTLE_SLOTS[slots];
      battleItems = items.slice(0, rects.length);
      battle.replaceChildren();
      battleItems.forEach((it, i) => {
        const r = rects[i];
        if (r === undefined) return;
        const b = document.createElement("button");
        b.type = "button";
        b.className = "controls-battle-item";
        b.textContent = it.label;
        buttonStyle(b, r, origin);
        dimIf(b, it);
        b.addEventListener("click", onGuardedClick(it));
        battle.appendChild(b);
      });
    },
    setCloseLabel(label: string): void {
      if (close.textContent !== label) close.textContent = label;
    },
    setAutoStop(label: string, onPress: () => void): void {
      autoStop.textContent = label;
      autoStopPress = onPress;
    },
    select(n: number): void {
      const at = (items: readonly ControlItem[]): void => {
        const it = items[n];
        if (it !== undefined) pick(it);
      };
      if (mode === "dpad") at(menuItems);
      else if (mode === "list") at(listItems);
      else if (mode === "battle") at(battleItems);
      else if (mode === "close" && n === 0) o.onClose();
      else if (mode === "autoStop" && n === 0) autoStopPress();
    },
  };
}
