// UI-54 / UI-60: 戦闘のビューの層（敵グループの列）。ビュー（既定 240×150）の左上を原点にした論理 px で置く。
// - 列は幅 56・間 4 で中央寄せ。絵の代わりの色付き矩形は 48×48（列内 x+4、y8..55）、1 グループだけなら 64×64（y2..65）。
// - 絵の下のラベルは注目の枠のすぐ下の 2 行（y58..77、1 グループなら y68..87。3 行目以降は line-clamp で「…」）。
//   幅は 2 グループ以上なら注目の枠と同じ 52（隣と 8px 空ける）、1 グループなら列の箱の 56。
//   戦闘で出る判定の箱（UI-40。上端 y88 以下にはならない）と重ならない位置（battle.groupLabel「{n} {name} ×{count}」。
//   n は対象の一覧と同じ番号 = battle-input の targetNumber、name は core が選んだ表示名をそのまま）。列の区切り線や列の枠は描かない。
// - 体数 0 の列は詰めずに visibility hidden（グループの添字は戦闘中に詰めない。CB-42）。
// - 対象の選択中は focus で、注目しているグループの絵の周り（focusFrame）に枠を出し、点滅させる（Element.animate の
//   iterations: Infinity。常駐のループではなく、解除・切り替え・描き直しで cancel する）。演出スキップでは点滅せず枠だけ。
// - setPickable の間だけ絵のタップで onPick(グループの添字) を呼ぶ（体数 1 以上のとき）。
// - UI-60（M7）: 絵は public/sprites/<sprite>.png（鑑定済みは monsters[].sprite、未鑑定は系統の unknown_<kind>）を <img> で読み、
//   読めたら矩形の塗りを消して絵を出す。読めなければ（素材が無い・オフラインで未キャッシュ）色付き矩形のまま。読めなかった URL は
//   このビューの間は覚えて、次の描き直しで読みに行かない。
// 演出は Element.animate だけで、ms が 0 以下なら animate を呼ばない。
// モジュールのトップレベルでは DOM に触れない。
import type { GameData, Strings } from "../../core/data/index";
import type { EnemyGroupView } from "../../core/types";
import { targetNumber } from "../battle-input";
import type { Rect } from "../layout";
import { ENEMY_FILLS, PALETTE, type PaletteName } from "../palette";
import { formatMessage } from "./message";
import { onTap } from "../input/tap";

const COL_W = 56;
const COL_GAP = 4;
const SPRITE = { x: 4, y: 8, size: 48 } as const;
const SPRITE_SOLO = { y: 2, size: 64 } as const;
const LABEL_H = 20;
const LINE_H = 10;
/** 注目の枠を絵から広げる幅（論理 px） */
const FRAME_PAD = 2;
/** 注目の枠の点滅の 1 周期（ms）。表示層のコード定数（GHOST_CLICK_MS と同じ扱い。config には置かない） */
export const FOCUS_BLINK_MS = 400;

/** 列 i の矩形（幅 56、高さはビュー全体）。中央寄せで、左右の余白の差は 1 以下 */
export function groupBoxes(n: number, viewW: number, viewH = 150): Rect[] {
  if (n <= 0) return [];
  const total = n * COL_W + (n - 1) * COL_GAP;
  const left = Math.floor((viewW - total) / 2);
  return Array.from({ length: n }, (_, i): Rect => ({ x: left + i * (COL_W + COL_GAP), y: 0, w: COL_W, h: viewH }));
}

/** 列 i の絵の矩形。n=1 だけ 64×64（y2..65）、それ以外は 48×48（列内 x+4、y8..55） */
export function groupColumns(n: number, viewW: number): Rect[] {
  if (n === 1) {
    const x = Math.floor((viewW - SPRITE_SOLO.size) / 2);
    return [{ x, y: SPRITE_SOLO.y, w: SPRITE_SOLO.size, h: SPRITE_SOLO.size }];
  }
  return groupBoxes(n, viewW).map((b) => ({ x: b.x + SPRITE.x, y: SPRITE.y, w: SPRITE.size, h: SPRITE.size }));
}

/**
 * UI-54: 列 i のラベルの矩形（ビュー座標）。高さ 20（2 行）、y は注目の枠の下端（絵の下端 + FRAME_PAD）。
 * n=1 は列の箱の幅 56 で y68..87、それ以外は注目の枠と同じ x と幅 52 で y58..77（隣のラベルと 8px 空け、
 * 3〜4 グループで 1 行につながって見えないようにする）。戦闘で出る判定の箱（UI-40。rows 1〜2 で上端 y98 / y88）と重ならない
 */
export function groupLabelRects(n: number, viewW: number): Rect[] {
  const sprites = groupColumns(n, viewW);
  return groupBoxes(n, viewW).map((b, i): Rect => {
    const sr = sprites[i] ?? { x: b.x + SPRITE.x, y: SPRITE.y, w: SPRITE.size, h: SPRITE.size };
    const y = sr.y + sr.h + FRAME_PAD;
    if (n === 1) return { x: b.x, y, w: b.w, h: LABEL_H };
    const f = focusFrame(sr);
    return { x: f.x, y, w: f.w, h: LABEL_H };
  });
}

/**
 * UI-60: 色付き矩形の塗り。鑑定済みは monsters の添字で ENEMY_FILLS を巡回、未鑑定は系統（unknown-kinds.json）の
 * placeholderColor（敵ごとの色にしない。同じ系統の別の種類は同じ色）。未知の id は dim。
 * placeholderColor の型（core の PLACEHOLDER_COLORS）を PaletteName として返すので、パレットに無い色名が一覧にあると typecheck が落ちる
 */
export function enemyFill(data: GameData, monsterId: string, identified: boolean): PaletteName {
  const i = data.monsters.findIndex((m) => m.id === monsterId);
  const m = data.monsters[i];
  if (m === undefined) return "dim";
  if (!identified) return data.unknownKinds.find((k) => k.id === m.unknownKind)?.placeholderColor ?? "dim";
  return ENEMY_FILLS[i % ENEMY_FILLS.length] ?? "dim";
}

/**
 * UI-60: 絵の名前（public/sprites/<名前>.png）。未鑑定は系統の sprite（unknown_<kind>）。
 * 鑑定済みは素材が揃うまで PNG を読まない（M3 のまま矩形。戦闘ごとの 404 を避ける）ので null。未知の id も null
 */
export function enemySprite(data: GameData, monsterId: string, identified: boolean): string | null {
  const m = data.monsters.find((x) => x.id === monsterId);
  if (m === undefined) return null;
  if (identified) return null;
  return data.unknownKinds.find((k) => k.id === m.unknownKind)?.sprite ?? null;
}

/** UI-60: 絵の URL（base は import.meta.env.BASE_URL。本番は /wizlike/） */
export function spriteUrl(sprite: string, base: string): string {
  return `${base}sprites/${sprite}.png`;
}

const ENEMY_ID = /^e(\d+)-(\d+)$/;

/** 敵の個体の id（"e{g}-{u}"）からグループの添字。味方の id などは null */
export function enemyGroupOfId(id: string): number | null {
  const m = ENEMY_ID.exec(id);
  return m === null ? null : Number(m[1]);
}

/** UI-54: 絵の下のラベル（battle.groupLabel）。n は対象の一覧と同じ番号（targetNumber） */
export function groupLabel(view: Pick<EnemyGroupView, "name" | "count">, n: number, strings: Strings): string {
  return formatMessage(strings["battle.groupLabel"] ?? "battle.groupLabel", { n, name: view.name, count: view.count });
}

/** UI-54: 注目の枠の矩形。絵の矩形を上下左右に FRAME_PAD ずつ広げる（48 → 52、64 → 68） */
export function focusFrame(sprite: Rect): Rect {
  return { x: sprite.x - FRAME_PAD, y: sprite.y - FRAME_PAD, w: sprite.w + 2 * FRAME_PAD, h: sprite.h + 2 * FRAME_PAD };
}

export type BattleView = {
  el: HTMLElement;
  /** 全グループを描き直す（encounter / enemyGroups / sync） */
  setGroups(groups: readonly EnemyGroupView[]): void;
  /** 撃破: 体数を 1 減らし、0 になったら絵を消して列を隠す（ms 0 なら即時） */
  removeOne(g: number, ms: number): Promise<void>;
  /** UI-42 の敵の被弾: 絵の opacity を 2 往復（ms 0 なら何もしない） */
  flash(g: number, ms: number): Promise<void>;
  /** UI-54: 対象の選択中の注目の枠（null で消す）。blink なら点滅（iterations: Infinity）、偽なら枠だけ */
  focus(g: number | null, blink: boolean): void;
  /** UI-54: 真の間だけ絵のタップで onPick を呼ぶ */
  setPickable(on: boolean): void;
  clear(): void;
};

type Col = { box: HTMLElement; sprite: HTMLElement; frame: HTMLElement; label: HTMLElement; view: EnemyGroupView };

function place(el: HTMLElement, r: Rect): void {
  Object.assign(el.style, { position: "absolute", left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
}

async function settle(a: Animation): Promise<void> {
  try {
    await a.finished;
  } catch {
    // cancel（要素の作り直しなど）。そのまま先へ進む
  }
}

export function createBattleView(
  data: GameData,
  strings: Strings,
  viewW = 240,
  viewH = 150,
  onPick?: (g: number) => void,
): BattleView {
  const el = document.createElement("div");
  el.className = "play-battle";
  place(el, { x: 0, y: 0, w: viewW, h: viewH });
  el.style.color = "var(--c-text)";
  el.style.pointerEvents = "none";

  let cols: Col[] = [];
  let groups: EnemyGroupView[] = [];
  let focused: number | null = null;
  let blinking: Animation | null = null;
  let pickable = false;
  /** UI-60: 読めなかった絵の URL（このビューの間は読みに行かない） */
  const missing = new Set<string>();

  const stopBlink = (): void => {
    if (blinking !== null) blinking.cancel();
    blinking = null;
  };

  /** ラベルは番号が変わる（前のグループの全滅）ので全列を書き直す */
  const paintLabels = (): void => {
    for (const c of cols) {
      const n = targetNumber(groups, c.view.index);
      c.label.textContent = n === null ? "" : groupLabel(c.view, n, strings);
      c.box.style.visibility = c.view.count > 0 ? "visible" : "hidden";
    }
  };

  const paintPickable = (): void => {
    for (const c of cols) c.sprite.style.pointerEvents = pickable && c.view.count > 0 ? "auto" : "none";
  };

  const paintFrames = (): void => {
    for (const c of cols) c.frame.style.display = focused === c.view.index ? "" : "none";
  };

  const setGroups = (gs: readonly EnemyGroupView[]): void => {
    stopBlink();
    focused = null;
    groups = gs.map((g) => ({ ...g }));
    el.replaceChildren();
    const boxes = groupBoxes(groups.length, viewW, viewH);
    const sprites = groupColumns(groups.length, viewW);
    const labels = groupLabelRects(groups.length, viewW);
    cols = groups.map((g, i): Col => {
      const b = boxes[i] ?? { x: 0, y: 0, w: COL_W, h: viewH };
      const sr = sprites[i] ?? { x: b.x + SPRITE.x, y: SPRITE.y, w: SPRITE.size, h: SPRITE.size };
      const box = document.createElement("div");
      box.className = "battle-group";
      place(box, b);
      const sprite = document.createElement("div");
      sprite.className = "battle-group-sprite";
      place(sprite, { x: sr.x - b.x, y: sr.y, w: sr.w, h: sr.h });
      sprite.style.background = PALETTE[enemyFill(data, g.monsterId, g.identified)];
      const name = enemySprite(data, g.monsterId, g.identified);
      const url = name === null ? null : spriteUrl(name, import.meta.env.BASE_URL);
      if (url !== null && !missing.has(url)) {
        // UI-60: 読めたら矩形の塗りを消して絵を出す。読めなければ矩形のまま（読めなかった URL を覚える）
        const img = document.createElement("img");
        img.className = "battle-group-img";
        img.alt = "";
        img.draggable = false;
        Object.assign(img.style, { display: "none", width: "100%", height: "100%", imageRendering: "pixelated", pointerEvents: "none" });
        img.addEventListener("load", () => {
          img.style.display = "block";
          sprite.style.background = "transparent";
        });
        img.addEventListener("error", () => {
          missing.add(url);
        });
        img.src = url;
        sprite.appendChild(img);
      }
      const index = g.index;
      onTap(sprite, () => {
        const c = cols.find((x) => x.view.index === index);
        if (pickable && c !== undefined && c.view.count > 0 && onPick !== undefined) onPick(index);
      });
      const fr = focusFrame(sr);
      const frame = document.createElement("div");
      frame.className = "battle-group-focus";
      place(frame, { x: fr.x - b.x, y: fr.y, w: fr.w, h: fr.h });
      Object.assign(frame.style, { border: "1px solid var(--c-accent)", pointerEvents: "none", display: "none" });
      const label = document.createElement("div");
      label.className = "battle-group-label";
      const lr = labels[i] ?? { x: b.x, y: sr.y + sr.h + FRAME_PAD, w: b.w, h: LABEL_H };
      place(label, { x: lr.x - b.x, y: lr.y, w: lr.w, h: lr.h });
      // 2 行まで折り返し、3 行目以降は「…」で省く（-webkit-line-clamp。iOS Safari / Android Chrome で使える）
      Object.assign(label.style, {
        textAlign: "center",
        whiteSpace: "normal",
        overflow: "hidden",
        overflowWrap: "anywhere",
        lineHeight: `${LINE_H}px`,
        display: "-webkit-box",
        webkitLineClamp: "2",
        webkitBoxOrient: "vertical",
      });
      box.append(sprite, frame, label);
      el.appendChild(box);
      return { box, sprite, frame, label, view: g };
    });
    paintLabels();
    paintPickable();
    paintFrames();
  };

  return {
    el,
    setGroups,
    async removeOne(g: number, ms: number): Promise<void> {
      const c = cols.find((x) => x.view.index === g);
      if (c === undefined) return;
      c.view.count = Math.max(0, c.view.count - 1);
      const gv = groups.find((x) => x.index === g);
      if (gv !== undefined) gv.count = c.view.count;
      if (c.view.count === 0 && ms > 0) {
        await settle(c.sprite.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: "steps(2, end)" }));
      }
      paintLabels();
      paintPickable();
    },
    async flash(g: number, ms: number): Promise<void> {
      const c = cols.find((x) => x.view.index === g);
      if (c === undefined || !(ms > 0)) return;
      await settle(
        c.sprite.animate([{ opacity: 1 }, { opacity: 0 }, { opacity: 1 }, { opacity: 0 }, { opacity: 1 }], {
          duration: ms,
          easing: "steps(4, end)",
        }),
      );
    },
    focus(g: number | null, blink: boolean): void {
      stopBlink();
      focused = g;
      paintFrames();
      const c = g === null ? undefined : cols.find((x) => x.view.index === g);
      if (c === undefined || !blink) return;
      blinking = c.frame.animate(
        [
          { opacity: 1, offset: 0 },
          { opacity: 1, offset: 0.5 },
          { opacity: 0, offset: 0.5 },
          { opacity: 0, offset: 1 },
        ],
        { duration: FOCUS_BLINK_MS, iterations: Infinity },
      );
    },
    setPickable(on: boolean): void {
      pickable = on;
      paintPickable();
    },
    clear(): void {
      stopBlink();
      el.replaceChildren();
      cols = [];
      groups = [];
      focused = null;
    },
  };
}
