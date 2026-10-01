// UI-54 / UI-60: 戦闘のビューの層（敵グループの列）。ビュー（既定 240×150）の左上を原点にした論理 px で置く。
// - 列は幅 56・間 4 で中央寄せ。絵の代わりの色付き矩形は 48×48（列内 x+4、y24..71）、1 グループだけなら 64×64（y16..79）。
// - 名前は y84..93（core が選んだ表示名をそのまま）、体数は y94..103（battle.groupCount）。
// - 体数 0 の列は詰めずに visibility hidden（グループの添字は戦闘中に詰めない。CB-42）。
// - 対象の選択中は highlight で列に枠を付ける。列の左上の番号は対象の一覧と同じ（battle-input の targetNumber）。
// PNG（public/sprites）は M3 では読まない。演出は Element.animate だけで、ms が 0 以下なら animate を呼ばない。
// モジュールのトップレベルでは DOM に触れない。
import type { GameData, Strings } from "../../core/data/index";
import type { EnemyGroupView } from "../../core/types";
import { targetNumber } from "../battle-input";
import type { Rect } from "../layout";
import { ENEMY_FILLS, PALETTE, type PaletteName } from "../palette";
import { formatMessage } from "./message";

const COL_W = 56;
const COL_GAP = 4;
const SPRITE = { x: 4, y: 24, size: 48 } as const;
const SPRITE_SOLO = { y: 16, size: 64 } as const;
const NAME_Y = 84;
const COUNT_Y = 94;
const TEXT_H = 10;

/** 列 i の矩形（幅 56、高さはビュー全体）。中央寄せで、左右の余白の差は 1 以下 */
export function groupBoxes(n: number, viewW: number, viewH = 150): Rect[] {
  if (n <= 0) return [];
  const total = n * COL_W + (n - 1) * COL_GAP;
  const left = Math.floor((viewW - total) / 2);
  return Array.from({ length: n }, (_, i): Rect => ({ x: left + i * (COL_W + COL_GAP), y: 0, w: COL_W, h: viewH }));
}

/** 列 i の絵の矩形。n=1 だけ 64×64（y16..79）、それ以外は 48×48（列内 x+4、y24..71） */
export function groupColumns(n: number, viewW: number): Rect[] {
  if (n === 1) {
    const x = Math.floor((viewW - SPRITE_SOLO.size) / 2);
    return [{ x, y: SPRITE_SOLO.y, w: SPRITE_SOLO.size, h: SPRITE_SOLO.size }];
  }
  return groupBoxes(n, viewW).map((b) => ({ x: b.x + SPRITE.x, y: SPRITE.y, w: SPRITE.size, h: SPRITE.size }));
}

/** UI-60: 色付き矩形の塗り。鑑定済みは monsters の添字で ENEMY_FILLS を巡回、未鑑定（と未知の id）は dim */
export function enemyFill(data: GameData, monsterId: string, identified: boolean): PaletteName {
  if (!identified) return "dim";
  const i = data.monsters.findIndex((m) => m.id === monsterId);
  if (i < 0) return "dim";
  return ENEMY_FILLS[i % ENEMY_FILLS.length] ?? "dim";
}

const ENEMY_ID = /^e(\d+)-(\d+)$/;

/** 敵の個体の id（"e{g}-{u}"）からグループの添字。味方の id などは null */
export function enemyGroupOfId(id: string): number | null {
  const m = ENEMY_ID.exec(id);
  return m === null ? null : Number(m[1]);
}

/** 体数の表示（battle.groupCount） */
export function groupCountText(view: Pick<EnemyGroupView, "count">, strings: Strings): string {
  return formatMessage(strings["battle.groupCount"] ?? "battle.groupCount", { count: view.count });
}

export type BattleView = {
  el: HTMLElement;
  /** 全グループを描き直す（encounter / enemyGroups / sync） */
  setGroups(groups: readonly EnemyGroupView[]): void;
  /** 撃破: 体数を 1 減らし、0 になったら絵を消して列を隠す（ms 0 なら即時） */
  removeOne(g: number, ms: number): Promise<void>;
  /** UI-42 の敵の被弾: 絵の opacity を 2 往復（ms 0 なら何もしない） */
  flash(g: number, ms: number): Promise<void>;
  /** 対象の選択中の枠（null で消す） */
  highlight(g: number | null): void;
  clear(): void;
};

type Col = { box: HTMLElement; sprite: HTMLElement; num: HTMLElement; count: HTMLElement; view: EnemyGroupView };

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

export function createBattleView(data: GameData, strings: Strings, viewW = 240, viewH = 150): BattleView {
  const el = document.createElement("div");
  el.className = "play-battle";
  place(el, { x: 0, y: 0, w: viewW, h: viewH });
  el.style.color = "var(--c-text)";
  el.style.pointerEvents = "none";

  let cols: Col[] = [];
  let groups: EnemyGroupView[] = [];
  let highlighted: number | null = null;

  const paintNumbers = (): void => {
    for (const c of cols) {
      const n = targetNumber(groups, c.view.index);
      c.num.textContent = highlighted !== null && n !== null ? String(n) : "";
      c.box.style.outline = highlighted === c.view.index ? "1px solid var(--c-accent)" : "";
    }
  };

  const showCount = (c: Col): void => {
    c.count.textContent = groupCountText(c.view, strings);
    c.box.style.visibility = c.view.count > 0 ? "visible" : "hidden";
  };

  const setGroups = (gs: readonly EnemyGroupView[]): void => {
    groups = gs.map((g) => ({ ...g }));
    el.replaceChildren();
    const boxes = groupBoxes(groups.length, viewW, viewH);
    const sprites = groupColumns(groups.length, viewW);
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
      const num = document.createElement("div");
      num.className = "battle-group-number";
      place(num, { x: 0, y: 0, w: 16, h: TEXT_H });
      num.style.color = "var(--c-accent)";
      const name = document.createElement("div");
      name.className = "battle-group-name";
      place(name, { x: 0, y: NAME_Y, w: b.w, h: TEXT_H });
      const count = document.createElement("div");
      count.className = "battle-group-count";
      place(count, { x: 0, y: COUNT_Y, w: b.w, h: TEXT_H });
      for (const t of [name, count]) Object.assign(t.style, { textAlign: "center", whiteSpace: "nowrap", overflow: "hidden" });
      name.textContent = g.name;
      box.append(sprite, num, name, count);
      el.appendChild(box);
      const c: Col = { box, sprite, num, count, view: g };
      showCount(c);
      return c;
    });
    paintNumbers();
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
      showCount(c);
      paintNumbers();
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
    highlight(g: number | null): void {
      highlighted = g;
      paintNumbers();
    },
    clear(): void {
      el.replaceChildren();
      cols = [];
      groups = [];
      highlighted = null;
    },
  };
}
