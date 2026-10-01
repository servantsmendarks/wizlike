// UI-54 / UI-60: 戦闘のビューの純粋な部分（src/presenter/views/battle.ts）。
import { describe, expect, test } from "vitest";
import { ENEMY_FILLS, PALETTE } from "../src/presenter/palette";
import { enemyFill, enemyGroupOfId, groupBoxes, groupColumns, groupCountText } from "../src/presenter/views/battle";
import { formatMessage } from "../src/presenter/views/message";
import type { Rect } from "../src/presenter/layout";
import { data } from "./helpers/core";

const VIEW_W = 240;
const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("UI-54 敵グループの列", () => {
  test("UI-54 groupColumns(n=1..4) は重ならず、ビュー（240×150）の内側で、左右の余白の差は 1 以下。n=1 は 64×64（y16..79）、他は 48×48（y24..71）", () => {
    for (let n = 1; n <= 4; n++) {
      const rs = groupColumns(n, VIEW_W);
      expect(rs).toHaveLength(n);
      for (const r of rs) {
        expect(r.x >= 0 && r.y >= 0 && r.x + r.w <= VIEW_W && r.y + r.h <= 150, `${n} ${JSON.stringify(r)}`).toBe(true);
        expect(r.w, `${n}`).toBe(n === 1 ? 64 : 48);
        expect(r.h, `${n}`).toBe(r.w);
        expect(r.y, `${n}`).toBe(n === 1 ? 16 : 24);
      }
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) expect(overlaps(rs[i]!, rs[j]!), `${n} ${i}/${j}`).toBe(false);
      const left = rs[0]!.x;
      const right = VIEW_W - (rs[n - 1]!.x + rs[n - 1]!.w);
      expect(Math.abs(left - right), `${n}`).toBeLessThanOrEqual(1);
    }
    expect(groupColumns(1, VIEW_W)).toEqual([{ x: 88, y: 16, w: 64, h: 64 }]);
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

  test("UI-60 enemyFill: 鑑定済みは monsters の添字で ENEMY_FILLS を巡回、未鑑定・未知は dim。色はすべて PALETTE にある", () => {
    data.monsters.forEach((m, i) => {
      expect(enemyFill(data, m.id, true), m.id).toBe(ENEMY_FILLS[i % ENEMY_FILLS.length]);
      expect(enemyFill(data, m.id, false), m.id).toBe("dim");
    });
    expect(enemyFill(data, "no_such_monster", true)).toBe("dim");
    expect(enemyFill(data, data.monsters[0]!.id, true)).toBe("orange");
    for (const c of ENEMY_FILLS) expect(Object.keys(PALETTE)).toContain(c);
    expect(ENEMY_FILLS).not.toContain("dim");
    expect(ENEMY_FILLS).not.toContain("black");
  });

  test("UI-41 enemyGroupOfId は core の敵の id e{g}-{u} のグループ添字。味方の id などは null", () => {
    expect(enemyGroupOfId("e2-0")).toBe(2);
    expect(enemyGroupOfId("e0-8")).toBe(0);
    expect(enemyGroupOfId("e10-3")).toBe(10);
    for (const id of ["c1", "c6", "e", "e1", "e1-", "-1-2", "xe1-2", "e1-2x", ""]) expect(enemyGroupOfId(id), id).toBeNull();
  });

  test("UI-54 groupCountText は battle.groupCount", () => {
    expect(groupCountText({ count: 3 }, data.strings)).toBe(formatMessage(data.strings["battle.groupCount"]!, { count: 3 }));
    expect(groupCountText({ count: 3 }, data.strings)).toContain("3");
  });
});
