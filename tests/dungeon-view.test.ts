// UI-20: 見えるセル（DG-12 の VisibleCell）→ 見せる path の集合（slotsFor）と、createDungeonSvg の振る舞い。
// VisibleCell は手組み。末尾に core の visibleCellsOf と組み合わせた結合テストを 1 本置く。
// createDungeonSvg は node 環境なので、document と Element.animate を最小の偽物に差し替えて確かめる。
import { afterEach, describe, expect, test, vi } from "vitest";
import { setEdge } from "../src/core/rules/dungeon-gen";
import { visibleCellsOf } from "../src/core/rules/dungeon";
import type { Cell, Edge, Floor, VisibleCell } from "../src/core/types";
import { SLOT_IDS, SLOT_PATHS, slotsFor, type SlotId } from "../src/presenter/views/dungeon-geometry";
import { createDungeonSvg } from "../src/presenter/views/dungeon-svg";

function cell(depth: number, lane: -1 | 0 | 1, front: Edge, left: Edge = "open", right: Edge = "open"): VisibleCell {
  return { depth, lane, x: 0, y: 0, front, left, right };
}

const sorted = (s: Set<SlotId>): SlotId[] => [...s].sort();

describe("slotsFor", () => {
  test("UI-20 正面が壁だけなら {cF0, cL0, cR0}", () => {
    expect(sorted(slotsFor([cell(0, 0, "wall", "wall", "wall")]))).toEqual(["cF0", "cL0", "cR0"]);
  });

  test("UI-20 扉は壁と扉の両方（cF+cD、cL+cLD、cR+cRD、lF+lD、rF+rD）", () => {
    expect(sorted(slotsFor([cell(1, 0, "door", "door", "door")]))).toEqual(["cD1", "cF1", "cL1", "cLD1", "cR1", "cRD1"]);
    expect(sorted(slotsFor([cell(2, -1, "door"), cell(2, 1, "door")]))).toEqual(["lD2", "lF2", "rD2", "rF2"]);
  });

  test("UI-20 左右が開いて列の front が wall なら lF と rF。lane ±1 の left/right は使わない", () => {
    const cells = [cell(0, 0, "open"), cell(0, -1, "wall", "wall", "door"), cell(0, 1, "wall", "door", "wall"), cell(1, 0, "wall", "wall", "wall")];
    expect(sorted(slotsFor(cells))).toEqual(["cF1", "cL1", "cR1", "lF0", "rF0"]);
  });

  test("UI-20 返らなかったセルは何も出ない、同じ d で cL と lF は同時に出ない、depth>3 は無視", () => {
    expect(slotsFor([]).size).toBe(0);
    // 3 マス先まで開けた通路: 両側の壁が d=0..3、正面の奥（d=3）が壁
    const corridor = [0, 1, 2].map((d) => cell(d, 0, "open", "wall", "wall")).concat([cell(3, 0, "wall", "wall", "wall"), cell(4, 0, "wall", "wall", "wall"), cell(-1, 0, "wall")]);
    const s = slotsFor(corridor);
    expect(sorted(s)).toEqual(["cF3", "cL0", "cL1", "cL2", "cL3", "cR0", "cR1", "cR2", "cR3"]);
    // core の可視性の規則（左右の列は正面の列の側の辺が open のときだけ返る）に従った入力なら、cL と lF は重ならない
    const mixed = [cell(0, 0, "open", "open", "wall"), cell(0, -1, "wall"), cell(1, 0, "wall", "wall", "open"), cell(1, 1, "door")];
    const m = slotsFor(mixed);
    for (const d of [0, 1, 2, 3]) {
      expect(m.has(`cL${d}` as SlotId) && m.has(`lF${d}` as SlotId)).toBe(false);
      expect(m.has(`cR${d}` as SlotId) && m.has(`rF${d}` as SlotId)).toBe(false);
    }
    expect(sorted(m)).toEqual(["cF1", "cL1", "cR0", "lF0", "rD1", "rF1"]);
  });
});

// ---------------------------------------------------------------------------
// createDungeonSvg（偽の DOM）

class FakeAnimation {
  finished: Promise<void>;
  private resolve!: () => void;
  private reject!: (e: unknown) => void;
  constructor(
    readonly keyframes: { opacity: number }[],
    readonly options: KeyframeAnimationOptions,
  ) {
    this.finished = new Promise<void>((res, rej) => {
      this.resolve = res;
      this.reject = rej;
    });
  }
  finish(): void {
    this.resolve();
  }
  cancel(): void {
    this.reject(new DOMExceptionLike("AbortError"));
  }
}
class DOMExceptionLike extends Error {}

class FakeEl {
  attrs: Record<string, string> = {};
  children: FakeEl[] = [];
  style: Record<string, string> = {};
  sets: string[] = [];
  animations: FakeAnimation[] = [];
  constructor(
    readonly ns: string,
    readonly tag: string,
    private readonly log: string[],
  ) {}
  setAttribute(k: string, v: string): void {
    this.attrs[k] = v;
    if (k === "visibility") this.log.push(`vis ${this.attrs["data-slot"]} ${v}`);
  }
  appendChild(c: FakeEl): FakeEl {
    this.children.push(c);
    return c;
  }
  animate(k: { opacity: number }[], o: KeyframeAnimationOptions): FakeAnimation {
    const a = new FakeAnimation(k, o);
    this.animations.push(a);
    this.log.push(`animate ${k[0]!.opacity}->${k[1]!.opacity} ${o.duration} ${o.easing}`);
    return a;
  }
}

function fakeDocument(log: string[]): { created: FakeEl[] } {
  const created: FakeEl[] = [];
  vi.stubGlobal("document", {
    createElementNS(ns: string, tag: string): FakeEl {
      const e = new FakeEl(ns, tag, log);
      created.push(e);
      return e;
    },
  });
  return { created };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createDungeonSvg", () => {
  test("UI-20 UI-22 40 本の path を 1 回だけ作り、viewBox 240×150、translate(0.5 0.5)・crispEdges・塗り無し", () => {
    const log: string[] = [];
    const { created } = fakeDocument(log);
    const v = createDungeonSvg();
    const svg = v.el as unknown as FakeEl;
    expect(svg.tag).toBe("svg");
    expect(svg.attrs.viewBox).toBe("0 0 240 150");
    expect(svg.attrs.width).toBe("240");
    expect(svg.attrs.height).toBe("150");
    const g = svg.children[0]!;
    expect(g.attrs.transform).toBe("translate(0.5 0.5)");
    expect(g.attrs["shape-rendering"]).toBe("crispEdges");
    expect(g.attrs["stroke-width"]).toBe("1");
    expect(g.attrs.fill).toBe("none");
    expect(g.attrs.stroke).toBe("var(--c-line)");
    expect(g.children).toHaveLength(40);
    expect(g.children.map((p) => p.attrs["data-slot"])).toEqual([...SLOT_IDS]);
    for (const p of g.children) {
      expect(p.attrs.d).toBe(SLOT_PATHS[p.attrs["data-slot"] as SlotId]);
      expect(p.attrs.visibility).toBe("hidden");
    }
    const before = created.length;
    v.show(new Set<SlotId>(["cF0"]));
    v.show(new Set<SlotId>(["cL0"]));
    expect(created.length).toBe(before);
  });

  test("UI-20 show は差分だけ visibility を書き換える", () => {
    const log: string[] = [];
    fakeDocument(log);
    const v = createDungeonSvg();
    log.length = 0;
    v.show(new Set<SlotId>(["cF0", "cL0", "cR0"]));
    expect(log.sort()).toEqual(["vis cF0 visible", "vis cL0 visible", "vis cR0 visible"]);
    log.length = 0;
    v.show(new Set<SlotId>(["cF0", "cD0", "cR0"]));
    expect(log.sort()).toEqual(["vis cD0 visible", "vis cL0 hidden"]);
    log.length = 0;
    v.show(new Set<SlotId>(["cF0", "cD0", "cR0"]));
    expect(log).toEqual([]);
    const g = (v.el as unknown as FakeEl).children[0]!;
    const visible = g.children.filter((p) => p.attrs.visibility === "visible").map((p) => p.attrs["data-slot"]);
    expect(visible.sort()).toEqual(["cD0", "cF0", "cR0"]);
  });

  test("UI-23 fade は 1→0（ms/2、steps(2,end)）→ apply → 0→1（ms/2）の順。fill を使わない", async () => {
    const log: string[] = [];
    fakeDocument(log);
    const v = createDungeonSvg();
    const svg = v.el as unknown as FakeEl;
    log.length = 0;
    let done = false;
    const p = v.fade(80, () => log.push("apply")).then(() => {
      done = true;
    });
    await flush();
    expect(log).toEqual(["animate 1->0 40 steps(2, end)"]);
    expect(svg.animations[0]!.options.fill).toBeUndefined();
    svg.animations[0]!.finish();
    await flush();
    expect(log).toEqual(["animate 1->0 40 steps(2, end)", "apply", "animate 0->1 40 steps(2, end)"]);
    expect(done).toBe(false);
    svg.animations[1]!.finish();
    await p;
    expect(done).toBe(true);
    expect(svg.style.opacity).toBe("1");
  });

  test("UI-23 UI-41 fade(0) は apply だけを同期で呼び、animate しない。cancel の reject は握りつぶす", async () => {
    const log: string[] = [];
    fakeDocument(log);
    const v = createDungeonSvg();
    const svg = v.el as unknown as FakeEl;
    log.length = 0;
    const p = v.fade(0, () => log.push("apply"));
    expect(log).toEqual(["apply"]);
    await p;
    expect(svg.animations).toHaveLength(0);

    const q = v.fade(60, () => log.push("apply2"));
    await flush();
    svg.animations[0]!.cancel();
    await flush();
    expect(log).toEqual(["apply", "animate 1->0 30 steps(2, end)", "apply2", "animate 0->1 30 steps(2, end)"]);
    svg.animations[1]!.cancel();
    await expect(q).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 結合: core の visibleCellsOf（DG-12）→ slotsFor（UI-20）

describe("visibleCellsOf と slotsFor の結合", () => {
  test("UI-20/DG-12 手組みの 5×5: 通路 2 マス、d1 で左に開き、d2 の正面が扉なら {cL0,cR0,lF1,cR1,cF2,cD2,cL2,cR2}", () => {
    const cells: Cell[] = [];
    for (let i = 0; i < 25; i++) cells.push({ kind: "corridor", n: "wall", e: "wall", s: "wall", w: "wall", roomId: null, eventId: null, trapId: null });
    const f: Floor = { floor: 1, width: 5, height: 5, cells, rooms: [], stairsUp: { x: 2, y: 4 }, stairsDown: null, boss: null };
    // (2,4) から北へ (2,3)、(2,2)。(2,3) の西は (1,3) へ開く。(2,2) の北は扉（扉は遮る）
    setEdge(f, 2, 4, "N", "open");
    setEdge(f, 2, 3, "N", "open");
    setEdge(f, 2, 3, "W", "open");
    setEdge(f, 2, 2, "N", "door");
    const vis = visibleCellsOf(f, { x: 2, y: 4 }, "N", 3);
    // d0: 自分 (2,4) は左右が壁。d1: (2,3) は左が開き、左の列 (1,3) の front は壁、右は壁。d2: (2,2) は正面が扉で、ここで止まる
    expect(vis.map((v) => `${v.depth}:${v.lane}:${v.x},${v.y}`)).toEqual(["0:0:2,4", "1:-1:1,3", "1:0:2,3", "2:0:2,2"]);
    expect(sorted(slotsFor(vis))).toEqual(["cD2", "cF2", "cL0", "cL2", "cR0", "cR1", "cR2", "lF1"]);
  });
});
