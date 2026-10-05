// UI-54 / UI-60: 戦闘のビュー（src/presenter/views/battle.ts）。純粋な部分と、document を最小の偽物に差し替えた DOM の部分。
import { afterEach, describe, expect, test, vi } from "vitest";
import type { EnemyGroupView } from "../src/core/types";
import { targetNumber } from "../src/presenter/battle-input";
import { tapSpecOf } from "../src/presenter/input/tap";
import { ENEMY_FILLS, PALETTE } from "../src/presenter/palette";
import {
  createBattleView,
  enemyFill,
  enemyGroupOfId,
  focusFrame,
  FOCUS_BLINK_MS,
  groupBoxes,
  groupColumns,
  groupLabel,
  groupLabelRects,
  spriteUrl,
} from "../src/presenter/views/battle";
import { diceBox } from "../src/presenter/views/dice";
import { formatMessage } from "../src/presenter/views/message";
import type { Rect } from "../src/presenter/layout";
import { data } from "./helpers/core";

const VIEW_W = 240;
const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("UI-54 敵グループの列", () => {
  test("UI-54 groupColumns(n=1..4) は重ならず、ビュー（240×150）の内側で、左右の余白の差は 1 以下。n=1 は 64×64（y2..65）、他は 48×48（y8..55。判定の箱を避けてラベルごと上に寄せた）", () => {
    for (let n = 1; n <= 4; n++) {
      const rs = groupColumns(n, VIEW_W);
      expect(rs).toHaveLength(n);
      for (const r of rs) {
        expect(r.x >= 0 && r.y >= 0 && r.x + r.w <= VIEW_W && r.y + r.h <= 150, `${n} ${JSON.stringify(r)}`).toBe(true);
        expect(r.w, `${n}`).toBe(n === 1 ? 64 : 48);
        expect(r.h, `${n}`).toBe(r.w);
        expect(r.y, `${n}`).toBe(n === 1 ? 2 : 8);
      }
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) expect(overlaps(rs[i]!, rs[j]!), `${n} ${i}/${j}`).toBe(false);
      const left = rs[0]!.x;
      const right = VIEW_W - (rs[n - 1]!.x + rs[n - 1]!.w);
      expect(Math.abs(left - right), `${n}`).toBeLessThanOrEqual(1);
    }
    expect(groupColumns(1, VIEW_W)).toEqual([{ x: 88, y: 2, w: 64, h: 64 }]);
  });

  test("UI-54 列の箱は幅 56・間 4 で中央寄せ。絵は箱の x+4", () => {
    expect(groupBoxes(4, VIEW_W).map((b) => b.x)).toEqual([2, 62, 122, 182]);
    expect(groupBoxes(2, VIEW_W).map((b) => [b.x, b.w])).toEqual([
      [62, 56],
      [122, 56],
    ]);
    expect(groupColumns(2, VIEW_W).map((r) => r.x)).toEqual([66, 126]);
    expect(groupBoxes(0, VIEW_W)).toEqual([]);
  });

  test("UI-60 enemyFill: 鑑定済みは monsters の添字で ENEMY_FILLS を巡回、未鑑定は系統の placeholderColor（敵ごとの色にしない）、未知は dim。色はすべて PALETTE にある", () => {
    data.monsters.forEach((m, i) => {
      expect(enemyFill(data, m.id, true), m.id).toBe(ENEMY_FILLS[i % ENEMY_FILLS.length]);
      expect(enemyFill(data, m.id, false), m.id).toBe(data.unknownKinds.find((k) => k.id === m.unknownKind)!.placeholderColor);
    });
    // 同じ系統の 2 種は同じ色、系統が違えば別の色
    expect(enemyFill(data, "giant_rat", false)).toBe(enemyFill(data, "giant_spider", false));
    expect(enemyFill(data, "kobold", false)).toBe(enemyFill(data, "rotting_corpse", false));
    expect(enemyFill(data, "giant_rat", false)).not.toBe(enemyFill(data, "kobold", false));
    for (const k of data.unknownKinds) expect(Object.keys(PALETTE), k.id).toContain(k.placeholderColor);
    expect(enemyFill(data, "no_such_monster", true)).toBe("dim");
    expect(enemyFill(data, "no_such_monster", false)).toBe("dim");
    expect(enemyFill(data, data.monsters[0]!.id, true)).toBe("orange");
    for (const c of ENEMY_FILLS) expect(Object.keys(PALETTE)).toContain(c);
    expect(ENEMY_FILLS).not.toContain("dim");
    expect(ENEMY_FILLS).not.toContain("black");
  });

  test("UI-60 spriteUrl: URL は {base}sprites/<名前>.png（絵の選び方は sprites.test.ts の chooseSprite）", () => {
    expect(spriteUrl("unknown_beast", "/wizlike/")).toBe("/wizlike/sprites/unknown_beast.png");
    expect(spriteUrl("kobold", "/")).toBe("/sprites/kobold.png");
  });

  test("UI-54/UI-60 1 グループのボス（bossSolo）は絵の枠 96×96 を 72,2 に置き、ラベルは絵の右 174,2,62,20。ラベルは判定の箱（rows 1〜2）とも注目の枠とも重ならず、ビューの内側", () => {
    expect(groupColumns(1, VIEW_W, true)).toEqual([{ x: 72, y: 2, w: 96, h: 96 }]);
    expect(groupLabelRects(1, VIEW_W, true)).toEqual([{ x: 174, y: 2, w: 62, h: 20 }]);
    const row = { label: { key: "dice.row.roll" }, base: null, dice: [1], total: 1 };
    const boxes = [diceBox({ rows: [row, row] }), diceBox({ rows: [row] })];
    const label = groupLabelRects(1, VIEW_W, true)[0]!;
    const frame = focusFrame(groupColumns(1, VIEW_W, true)[0]!);
    expect(frame).toEqual({ x: 70, y: 0, w: 100, h: 100 });
    for (const b of boxes) expect(overlaps(label, b), `dice ${b.y}`).toBe(false);
    expect(overlaps(label, frame)).toBe(false);
    const view = { x: 0, y: 0, w: VIEW_W, h: 150 };
    for (const r of [label, frame]) expect(r.x >= view.x && r.y >= view.y && r.x + r.w <= view.w && r.y + r.h <= view.h, JSON.stringify(r)).toBe(true);
    // ボスの名前・未鑑定名のラベルは幅 62 の 2 行に収まる（美咲: 半角 4px、他 8px。空白と仮名・漢字の間で折り返す）
    const px = (s: string): number => [...s].reduce((a, c) => a + (c.charCodeAt(0) < 0x80 ? 4 : 8), 0);
    const lines = (text: string, width: number): number => {
      let n = 1;
      let x = 0;
      for (const word of text.split(" ").map((w) => (/[぀-ヿ一-鿿]/.test(w) ? [...w] : [w]))) {
        if (x > 0) x += px(" ");
        for (const u of word) {
          if (x > 0 && x + px(u) > width) {
            n++;
            x = 0;
          }
          x += px(u);
        }
      }
      return n;
    };
    for (const m of data.monsters.filter((x) => x.special.boss === true)) {
      for (const name of [m.name, data.unknownKinds.find((k) => k.id === m.unknownKind)!.name]) {
        const text = groupLabel({ name, count: data.config.combat.maxPerGroup }, 1, data.strings);
        expect(lines(text, label.w), text).toBeLessThanOrEqual(2);
      }
    }
  });

  test("UI-54 bossSolo は 1 グループのときだけ効く（2〜4 グループの矩形・ボスでない 1 グループの矩形は今のまま）", () => {
    for (let n = 2; n <= 4; n++) {
      expect(groupColumns(n, VIEW_W, true), `${n}`).toEqual(groupColumns(n, VIEW_W));
      expect(groupLabelRects(n, VIEW_W, true), `${n}`).toEqual(groupLabelRects(n, VIEW_W));
    }
    expect(groupColumns(1, VIEW_W, false)).toEqual([{ x: 88, y: 2, w: 64, h: 64 }]);
    expect(groupLabelRects(1, VIEW_W, false)).toEqual([{ x: 92, y: 68, w: 56, h: 20 }]);
  });

  test("UI-41 enemyGroupOfId は core の敵の id e{g}-{u} のグループ添字。味方の id などは null", () => {
    expect(enemyGroupOfId("e2-0")).toBe(2);
    expect(enemyGroupOfId("e0-8")).toBe(0);
    expect(enemyGroupOfId("e10-3")).toBe(10);
    for (const id of ["c1", "c6", "e", "e1", "e1-", "-1-2", "xe1-2", "e1-2x", ""]) expect(enemyGroupOfId(id), id).toBeNull();
  });

  test("UI-54 groupLabel は battle.groupLabel「{n} {name} ×{count}」。旧 battle.groupCount は無い", () => {
    expect(data.strings["battle.groupLabel"]).toBe("{n} {name} ×{count}");
    expect(groupLabel({ name: "人の形をした影", count: 3 }, 1, data.strings)).toBe("1 人の形をした影 ×3");
    expect(groupLabel({ name: "N", count: 2 }, 4, data.strings)).toBe(formatMessage(data.strings["battle.groupLabel"]!, { n: 4, name: "N", count: 2 }));
    expect(Object.prototype.hasOwnProperty.call(data.strings, "battle.groupCount")).toBe(false);
  });

  test("UI-54 ラベルはラベルの幅（1 列 56、2 列以上 52）の 2 行に収まる: 全モンスターの名前・未鑑定名で、空白と仮名・漢字の間で折り返して 2 行以内（美咲: 半角 4px、他 8px）", () => {
    const px = (s: string): number => [...s].reduce((a, c) => a + (c.charCodeAt(0) < 0x80 ? 4 : 8), 0);
    // 折り返しの単位: 空白で区切った語。仮名・漢字を含む語は 1 字ずつ（その間で折り返せる）、それ以外（「×9」など）は語のまま
    const units = (label: string): string[][] =>
      label.split(" ").map((w) => (/[぀-ヿ一-鿿]/.test(w) ? [...w] : [w]));
    const lines = (label: string, width: number): number => {
      let n = 1;
      let x = 0;
      for (const word of units(label)) {
        if (x > 0) x += px(" ");
        for (const u of word) {
          const w = px(u);
          if (x > 0 && x + w > width) {
            n++;
            x = 0;
          }
          x += w;
        }
      }
      return n;
    };
    expect(lines("1 コボルド ×2", 56)).toBe(1);
    expect(lines("1 コボルド ×2", 52)).toBe(2);
    for (let n = 1; n <= data.config.combat.maxEnemyGroups; n++) {
      const width = groupLabelRects(n, VIEW_W)[0]!.w;
      for (const m of data.monsters) {
        for (const name of [m.name, data.unknownKinds.find((k) => k.id === m.unknownKind)!.name]) {
          const label = groupLabel({ name, count: data.config.combat.maxPerGroup }, data.config.combat.maxEnemyGroups, data.strings);
          expect(lines(label, width), `${n} ${label}`).toBeLessThanOrEqual(2);
        }
      }
    }
  });

  test("UI-54 2 列以上のラベルは注目の枠と同じ x と幅（52）で、隣のラベルとは 8px 以上離れる（3・4 グループで 1 行につながって見えない）", () => {
    for (let n = 2; n <= data.config.combat.maxEnemyGroups; n++) {
      const labels = groupLabelRects(n, VIEW_W);
      const frames = groupColumns(n, VIEW_W).map(focusFrame);
      labels.forEach((l, i) => {
        expect([l.x, l.w], `${n} ${i}`).toEqual([frames[i]!.x, frames[i]!.w]);
        expect(l.x >= 0 && l.x + l.w <= VIEW_W, `${n} ${i}`).toBe(true);
        const next = labels[i + 1];
        if (next !== undefined) expect(next.x - (l.x + l.w), `${n} ${i}`).toBeGreaterThanOrEqual(8);
      });
    }
    expect(groupLabelRects(3, VIEW_W).map((r) => [r.x, r.w])).toEqual([
      [34, 52],
      [94, 52],
      [154, 52],
    ]);
  });

  test("UI-54 focusFrame は絵を 2px ずつ広げ（48 → 52、64 → 68）、ビューの内側でラベルより上。2 列以上では列の箱の内側で互いに重ならない", () => {
    expect(focusFrame({ x: 66, y: 24, w: 48, h: 48 })).toEqual({ x: 64, y: 22, w: 52, h: 52 });
    expect(focusFrame({ x: 88, y: 16, w: 64, h: 64 })).toEqual({ x: 86, y: 14, w: 68, h: 68 });
    const inside = (r: Rect, o: Rect): boolean => r.x >= o.x && r.y >= o.y && r.x + r.w <= o.x + o.w && r.y + r.h <= o.y + o.h;
    for (let n = 1; n <= 4; n++) {
      const frames = groupColumns(n, VIEW_W).map(focusFrame);
      const boxes = groupBoxes(n, VIEW_W);
      frames.forEach((f, i) => {
        expect(inside(f, { x: 0, y: 0, w: VIEW_W, h: 150 }), `${n} ${i}`).toBe(true);
        if (n >= 2) expect(inside(f, boxes[i]!), `${n} ${i}`).toBe(true);
        expect(f.y + f.h, `${n} ${i}`).toBeLessThanOrEqual(groupLabelRects(n, VIEW_W)[i]!.y);
      });
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) expect(overlaps(frames[i]!, frames[j]!), `${n} ${i}/${j}`).toBe(false);
    }
  });

  test("UI-54/UI-40 n=1..4 のラベル（2 行・高さ 20）は、戦闘で出る判定の箱（先手 rows 2 の y88..145、逃走・全滅 rows 1 の y98..145）とも注目の枠とも重ならない", () => {
    const row = { label: { key: "dice.row.roll" }, base: null, dice: [1], total: 1 };
    const boxes = [diceBox({ rows: [row, row] }), diceBox({ rows: [row] })];
    expect(boxes.map((b) => [b.y, b.y + b.h])).toEqual([
      [88, 146],
      [98, 146],
    ]);
    // 期待値は 注目の枠の下端（絵の y + 大きさ + 2）からの 20px: 2 列以上は 8+48+2=58、1 列は 2+64+2=68
    expect(groupLabelRects(1, VIEW_W)).toEqual([{ x: 92, y: 68, w: 56, h: 20 }]);
    expect(groupLabelRects(4, VIEW_W).map((r) => [r.x, r.y, r.w, r.h])).toEqual([
      [4, 58, 52, 20],
      [64, 58, 52, 20],
      [124, 58, 52, 20],
      [184, 58, 52, 20],
    ]);
    for (let n = 1; n <= data.config.combat.maxEnemyGroups; n++) {
      const labels = groupLabelRects(n, VIEW_W);
      const frames = groupColumns(n, VIEW_W).map(focusFrame);
      expect(labels).toHaveLength(n);
      labels.forEach((l, i) => {
        expect(l.h, `${n} ${i}`).toBe(20);
        for (const b of boxes) expect(overlaps(l, b), `${n} ${i} dice ${b.y}`).toBe(false);
        for (const f of frames) expect(overlaps(l, f), `${n} ${i} frame`).toBe(false);
      });
    }
  });
});

// ---------------------------------------------------------------- DOM（偽の document）
type FakeAnim = { options: Record<string, unknown>; cancelled: boolean; cancel(): void; finished: Promise<void> };

class FakeEl {
  style: Record<string, string> = {};
  className = "";
  textContent = "";
  children: FakeEl[] = [];
  anims: FakeAnim[] = [];
  listeners = new Map<string, Array<(e: unknown) => void>>();
  appendChild(c: FakeEl): FakeEl {
    this.children.push(c);
    return c;
  }
  append(...c: FakeEl[]): void {
    this.children.push(...c);
  }
  replaceChildren(...c: FakeEl[]): void {
    this.children = c;
  }
  addEventListener(type: string, f: (e: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), f]);
  }
  setAttribute(): void {}
  dispatch(type: string): void {
    for (const f of this.listeners.get(type) ?? []) f({ type });
  }
  /** onTap で登録した spec の onTap を呼ぶ（UI-36 の動かずに離した） */
  tap(): void {
    tapSpecOf(this)?.onTap({ lx: 0, ly: 0 });
  }
  animate(_keyframes: unknown, options: Record<string, unknown>): FakeAnim {
    const a: FakeAnim = {
      options,
      cancelled: false,
      cancel() {
        a.cancelled = true;
      },
      finished: Promise.resolve(),
    };
    this.anims.push(a);
    return a;
  }
}

function fakeDocument(): FakeEl[] {
  const created: FakeEl[] = [];
  vi.stubGlobal("document", {
    createElement(): FakeEl {
      const e = new FakeEl();
      created.push(e);
      return e;
    },
  });
  return created;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const GROUPS: EnemyGroupView[] = [
  { index: 0, monsterId: "giant_rat", name: "何かの獣", identified: false, count: 1 },
  { index: 1, monsterId: "kobold", name: "コボルド", identified: true, count: 3 },
  { index: 2, monsterId: "giant_spider", name: "何かの獣", identified: false, count: 0 },
];

/** UI-60: public/sprites に実在する絵の一覧（テスト用。鑑定済みのコボルドと未鑑定の beast だけ） */
const SPRITES = { kobold: { w: 48, h: 48 }, unknown_beast: { w: 48, h: 48 } };

function setup(onPick?: (g: number) => void, sprites: Record<string, { w: number; h: number }> = SPRITES) {
  const created = fakeDocument();
  const v = createBattleView(data, data.strings, VIEW_W, 150, onPick, sprites);
  v.setGroups(GROUPS);
  const byClass = (c: string): FakeEl[] => created.filter((e) => e.className === c);
  return { v, byClass };
}

describe("UI-54 戦闘のビュー（DOM）", () => {
  test("UI-54 列に枠線（outline）を付けず、番号だけの要素も置かない。ラベルは targetNumber の番号入り、体数 0 の列は隠す", () => {
    const { v, byClass } = setup();
    const boxes = byClass("battle-group");
    expect(boxes).toHaveLength(3);
    for (const b of boxes) expect(b.style["outline"] ?? "").toBe("");
    expect(byClass("battle-group-number")).toEqual([]);
    expect(byClass("battle-group-label").map((l) => l.textContent)).toEqual([
      groupLabel(GROUPS[0]!, targetNumber(GROUPS, 0)!, data.strings),
      groupLabel(GROUPS[1]!, targetNumber(GROUPS, 1)!, data.strings),
      "",
    ]);
    expect(byClass("battle-group-label")[1]!.textContent).toBe("2 コボルド ×3");
    expect(boxes.map((b) => b.style["visibility"])).toEqual(["visible", "visible", "hidden"]);
    v.focus(1, true);
    for (const b of boxes) expect(b.style["outline"] ?? "").toBe("");
  });

  test("UI-54/CB-05 同じ系統の別の種類が 2 グループいても、ラベルはグループの番号で区別できる（「1 人の形をした影 ×2」「2 人の形をした影 ×3」）", () => {
    const gs: EnemyGroupView[] = [
      { index: 0, monsterId: "kobold", name: "人の形をした影", identified: false, count: 2 },
      { index: 1, monsterId: "rotting_corpse", name: "人の形をした影", identified: false, count: 3 },
    ];
    const created = fakeDocument();
    createBattleView(data, data.strings, VIEW_W, 150).setGroups(gs);
    expect(created.filter((e) => e.className === "battle-group-label").map((l) => l.textContent)).toEqual([
      "1 人の形をした影 ×2",
      "2 人の形をした影 ×3",
    ]);
  });

  test("UI-60 一覧が空（素材が無い今）なら <img> を作らない（404 や SPA の HTML を取りに行かない）。矩形の塗りのまま", () => {
    const { byClass } = setup(undefined, {});
    expect(byClass("battle-group-img")).toEqual([]);
    expect(byClass("battle-group-sprite").map((s) => s.children.length)).toEqual([0, 0, 0]);
  });

  test("UI-60 <img> は一覧にある絵だけ: 幅・高さは w × scale、位置は枠の中央、image-rendering pixelated。1 グループの非ボスは枠 64 に 48 を 1 倍で 8px 寄せ、1 グループのボス（未鑑定）は枠 96 に unknown_construct を 2 倍", () => {
    const created = fakeDocument();
    const v = createBattleView(data, data.strings, VIEW_W, 150, undefined, { kobold: { w: 48, h: 48 }, unknown_construct: { w: 48, h: 48 } });
    v.setGroups([{ index: 0, monsterId: "kobold", name: "コボルド", identified: true, count: 1 }]);
    const img0 = created.filter((e) => e.className === "battle-group-img")[0]!;
    expect((img0 as unknown as { src: string }).src).toBe("/sprites/kobold.png");
    expect([img0.style["left"], img0.style["top"], img0.style["width"], img0.style["height"]]).toEqual(["8px", "8px", "48px", "48px"]);
    expect(img0.style["position"]).toBe("absolute");
    expect(img0.style["imageRendering"]).toBe("pixelated");
    v.setGroups([{ index: 0, monsterId: "gatekeeper_armor", name: "動く何か", identified: false, count: 1 }]);
    const sprite = created.filter((e) => e.className === "battle-group-sprite")[1]!;
    const box = created.filter((e) => e.className === "battle-group")[1]!;
    // 枠 72,2,96,96（列の箱 x92 からの相対で -20）、ラベルは 174,2（相対 82）
    expect([sprite.style["left"], sprite.style["top"], sprite.style["width"], sprite.style["height"]]).toEqual(["-20px", "2px", "96px", "96px"]);
    expect(box.style["left"]).toBe("92px");
    const label = created.filter((e) => e.className === "battle-group-label")[1]!;
    expect([label.style["left"], label.style["top"], label.style["width"], label.style["height"]]).toEqual(["82px", "2px", "62px", "20px"]);
    const img1 = created.filter((e) => e.className === "battle-group-img")[1]!;
    expect((img1 as unknown as { src: string }).src).toBe("/sprites/unknown_construct.png");
    expect([img1.style["left"], img1.style["top"], img1.style["width"], img1.style["height"]]).toEqual(["0px", "0px", "96px", "96px"]);
    // 鑑定済みのボスの 96 の絵が一覧に無ければ <img> を作らず 96×96 の矩形
    v.setGroups([{ index: 0, monsterId: "gatekeeper_armor", name: "門番の甲冑", identified: true, count: 1 }]);
    expect(created.filter((e) => e.className === "battle-group-img")).toHaveLength(2);
    expect(created.filter((e) => e.className === "battle-group-sprite")[2]!.style["width"]).toBe("96px");
  });

  test("UI-60 2 グループ以上のボスの 96 の絵は枠 48 に入らないので <img> を作らず矩形（縮小しない）", () => {
    const created = fakeDocument();
    const v = createBattleView(data, data.strings, VIEW_W, 150, undefined, { gatekeeper_armor: { w: 96, h: 96 }, kobold: { w: 48, h: 48 } });
    v.setGroups([
      { index: 0, monsterId: "gatekeeper_armor", name: "門番の甲冑", identified: true, count: 1 },
      { index: 1, monsterId: "kobold", name: "コボルド", identified: true, count: 2 },
    ]);
    const imgs = created.filter((e) => e.className === "battle-group-img");
    expect(imgs.map((i) => (i as unknown as { src: string }).src)).toEqual(["/sprites/kobold.png"]);
    expect(created.filter((e) => e.className === "battle-group-sprite").map((s) => s.style["width"])).toEqual(["48px", "48px"]);
  });

  test("UI-60 絵: 一覧にある絵（鑑定済みは本名、未鑑定は unknown_<kind>）の矩形の中に <img>（{base}sprites/<名前>.png）。塗りは未鑑定なら系統の色。読めたら塗りを消して絵を出し、読めなければ矩形のまま、その URL は次の描き直しで読まない", () => {
    const { v, byClass } = setup();
    const sprites = byClass("battle-group-sprite");
    const imgs = byClass("battle-group-img");
    expect(imgs.map((i) => (i as unknown as { src: string }).src)).toEqual([
      "/sprites/unknown_beast.png",
      "/sprites/kobold.png",
      "/sprites/unknown_beast.png",
    ]);
    expect(sprites.map((s) => s.children)).toEqual([[imgs[0]], [imgs[1]], [imgs[2]]]);
    expect(imgs.map((i) => i.style["display"])).toEqual(["none", "none", "none"]);
    // 未鑑定の大ネズミと大蜘蛛（同じ beast）は同じ色。鑑定済みのコボルドは敵ごとの色
    const beast = PALETTE[data.unknownKinds.find((k) => k.id === "beast")!.placeholderColor];
    expect(sprites.map((s) => s.style["background"])).toEqual([beast, PALETTE[enemyFill(data, "kobold", true)], beast]);
    // 読めた: 塗りを消して絵を出す
    imgs[1]!.dispatch("load");
    expect(imgs[1]!.style["display"]).toBe("block");
    expect(sprites[1]!.style["background"]).toBe("transparent");
    // 読めなかった: 矩形のまま。次の描き直しではその URL の <img> を作らない（コボルドは作る）
    imgs[0]!.dispatch("error");
    expect(imgs[0]!.style["display"]).toBe("none");
    expect(sprites[0]!.style["background"]).toBe(beast);
    v.setGroups(GROUPS);
    expect(byClass("battle-group-img").slice(3).map((i) => (i as unknown as { src: string }).src)).toEqual(["/sprites/kobold.png"]);
    expect(byClass("battle-group-sprite").slice(3).map((s) => s.children.length)).toEqual([0, 1, 0]);
  });

  test("UI-54 ラベルは 2 行（高さ 20・行間 10）まで折り返し、3 行目以降は -webkit-line-clamp 2 で省く。位置は groupLabelRects（列の箱の左上からの相対）", () => {
    const { byClass } = setup();
    const labels = byClass("battle-group-label");
    const rects = groupLabelRects(GROUPS.length, VIEW_W);
    const boxes = groupBoxes(GROUPS.length, VIEW_W);
    labels.forEach((l, i) => {
      expect(l.style["display"]).toBe("-webkit-box");
      expect(l.style["webkitLineClamp"]).toBe("2");
      expect(l.style["webkitBoxOrient"]).toBe("vertical");
      expect(l.style["overflow"]).toBe("hidden");
      expect(l.style["lineHeight"]).toBe("10px");
      expect(l.style["height"]).toBe("20px");
      expect(l.style["top"]).toBe(`${rects[i]!.y}px`);
      expect(l.style["left"]).toBe(`${rects[i]!.x - boxes[i]!.x}px`);
    });
    expect(labels[0]!.style["top"]).toBe("58px");
  });

  test("UI-54 removeOne で体数 0 になったグループの後ろの番号が詰まる（ラベルを作り直す）", async () => {
    const { v, byClass } = setup();
    await v.removeOne(0, 0);
    const labels = byClass("battle-group-label");
    expect(labels[1]!.textContent).toBe("1 コボルド ×3");
    expect(byClass("battle-group")[0]!.style["visibility"]).toBe("hidden");
    await v.removeOne(1, 0);
    expect(labels[1]!.textContent).toBe("1 コボルド ×2");
  });

  test("UI-54 focus(g, true) は g の絵の枠を出し、iterations: Infinity で点滅させる。切り替え・解除・setGroups・clear で前の点滅を cancel", () => {
    const { v, byClass } = setup();
    const frames = byClass("battle-group-focus");
    expect(frames).toHaveLength(3);
    expect(frames.map((f) => f.style["display"])).toEqual(["none", "none", "none"]);
    expect(frames[1]!.style["border"]).toBe("1px solid var(--c-accent)");
    v.focus(1, true);
    expect(frames.map((f) => f.style["display"])).toEqual(["none", "", "none"]);
    const a1 = frames[1]!.anims[0]!;
    expect(a1.options).toMatchObject({ duration: FOCUS_BLINK_MS, iterations: Infinity });
    expect(a1.cancelled).toBe(false);
    v.focus(0, true);
    expect(a1.cancelled).toBe(true);
    expect(frames.map((f) => f.style["display"])).toEqual(["", "none", "none"]);
    const a0 = frames[0]!.anims[0]!;
    v.focus(null, true);
    expect(a0.cancelled).toBe(true);
    expect(frames.map((f) => f.style["display"])).toEqual(["none", "none", "none"]);
    v.focus(1, true);
    const a2 = frames[1]!.anims[1]!;
    v.setGroups(GROUPS);
    expect(a2.cancelled).toBe(true);
    const frames2 = byClass("battle-group-focus").slice(3);
    expect(frames2.map((f) => f.style["display"])).toEqual(["none", "none", "none"]);
    v.focus(1, true);
    const a3 = frames2[1]!.anims[0]!;
    v.clear();
    expect(a3.cancelled).toBe(true);
  });

  test("UI-54 演出スキップ（blink 偽）では animate を呼ばず枠だけ出す", () => {
    const { v, byClass } = setup();
    const frames = byClass("battle-group-focus");
    v.focus(1, false);
    expect(frames[1]!.style["display"]).toBe("");
    expect(frames.flatMap((f) => f.anims)).toEqual([]);
  });

  test("UI-54/UI-36 setPickable の間だけ、体数 1 以上の絵のタップ（onTap）で onPick(グループの添字) を呼ぶ", () => {
    const picked: number[] = [];
    const { v, byClass } = setup((g) => picked.push(g));
    const sprites = byClass("battle-group-sprite");
    sprites[1]!.tap();
    expect(picked).toEqual([]);
    expect(sprites.map((s) => s.style["pointerEvents"])).toEqual(["none", "none", "none"]);
    v.setPickable(true);
    expect(sprites.map((s) => s.style["pointerEvents"])).toEqual(["auto", "auto", "none"]);
    sprites[1]!.tap();
    sprites[0]!.tap();
    sprites[2]!.tap(); // 体数 0
    expect(picked).toEqual([1, 0]);
    v.setPickable(false);
    sprites[1]!.tap();
    expect(picked).toEqual([1, 0]);
    expect(sprites.map((s) => s.style["pointerEvents"])).toEqual(["none", "none", "none"]);
  });
});
