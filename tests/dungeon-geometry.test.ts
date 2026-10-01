// UI-20〜22: 線画の座標表。期待値は表をなぞらず、面 P0..P4 と扉の比率（幅 1/2、高さ 3/4、床に接する、
// 側壁の扉は台形の横 1/4〜3/4。四捨五入で .5 は切り上げ）から計算し直して突き合わせる。
import { describe, expect, test } from "vitest";
import { PLANES, SLOT_DEPTHS, SLOT_IDS, SLOT_PATHS, type SlotId } from "../src/presenter/views/dungeon-geometry";

type Pt = [number, number];
type Cmd = { c: "M" | "L" | "H" | "V" | "Z"; n: number[] };

function parse(d: string): Cmd[] {
  const out: Cmd[] = [];
  const re = /([MLHVZ])([^MLHVZ]*)/g;
  for (const m of d.matchAll(re)) {
    const nums = m[2]!.trim() === "" ? [] : m[2]!.trim().split(/[\s,]+/).map(Number);
    out.push({ c: m[1] as Cmd["c"], n: nums });
  }
  // 解釈できない文字が無いこと
  expect(out.map((x) => x.c + (x.n.length ? x.n.join(" ") : "")).join(" ").replace(/\s/g, "")).toBe(d.replace(/\s/g, ""));
  return out;
}

/** 絶対座標の頂点列（Z は含めない） */
function points(d: string): Pt[] {
  const pts: Pt[] = [];
  let x = 0;
  let y = 0;
  for (const { c, n } of parse(d)) {
    if (c === "M" || c === "L") {
      expect(n).toHaveLength(2);
      [x, y] = [n[0]!, n[1]!];
    } else if (c === "H") {
      expect(n).toHaveLength(1);
      x = n[0]!;
    } else if (c === "V") {
      expect(n).toHaveLength(1);
      y = n[0]!;
    } else continue;
    pts.push([x, y]);
  }
  return pts;
}

function bbox(d: string): { x0: number; x1: number; y0: number; y1: number } {
  const p = points(d);
  const xs = p.map((q) => q[0]);
  const ys = p.map((q) => q[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

/** x を 239 - x に写した path（H は x、V は y、M/L は 1 番目） */
function mirror(d: string): string {
  return parse(d)
    .map(({ c, n }) => {
      if (c === "Z") return "Z";
      if (c === "H") return `H${239 - n[0]!}`;
      if (c === "V") return `V${n[0]}`;
      return `${c}${239 - n[0]!} ${n[1]}`;
    })
    .join(" ");
}

const round = (v: number): number => Math.floor(v + 0.5);
const P = (d: number) => PLANES[d]!;
const path = (id: SlotId): string => SLOT_PATHS[id];

describe("dungeon-geometry", () => {
  test("UI-21 P0..P4 は厳密に入れ子で、どの面も L+R=239、T+B=149", () => {
    expect(PLANES).toHaveLength(5);
    expect(P(0)).toEqual({ L: 0, R: 239, T: 0, B: 149 });
    for (let d = 0; d < 5; d++) {
      const p = P(d);
      expect(p.L + p.R).toBe(239);
      expect(p.T + p.B).toBe(149);
      expect(p.L).toBeLessThan(p.R);
      expect(p.T).toBeLessThan(p.B);
      if (d > 0) {
        const q = P(d - 1);
        expect(p.L).toBeGreaterThan(q.L);
        expect(p.T).toBeGreaterThan(q.T);
        expect(p.R).toBeLessThan(q.R);
        expect(p.B).toBeLessThan(q.B);
      }
    }
  });

  test("UI-20 40 個の SlotId に空でない path があり、重複が無い", () => {
    expect(SLOT_IDS).toHaveLength(40);
    expect(new Set(SLOT_IDS).size).toBe(40);
    expect(Object.keys(SLOT_PATHS).sort()).toEqual([...SLOT_IDS].sort());
    const ds = SLOT_IDS.map((id) => SLOT_PATHS[id]);
    for (const d of ds) expect(d.trim().length).toBeGreaterThan(0);
    expect(new Set(ds).size).toBe(40);
  });

  test("UI-22 全座標が 0..239 × 0..149 の整数", () => {
    for (const id of SLOT_IDS) {
      for (const [x, y] of points(path(id))) {
        expect(Number.isInteger(x) && Number.isInteger(y), `${id} (${x},${y})`).toBe(true);
        expect(x >= 0 && x <= 239 && y >= 0 && y <= 149, `${id} (${x},${y})`).toBe(true);
      }
    }
  });

  test("UI-21 正面の壁は P_{d+1} の矩形、側壁の台形の頂点は P_d と P_{d+1} の角", () => {
    for (const d of SLOT_DEPTHS) {
      const a = P(d);
      const b = P(d + 1);
      expect(points(path(`cF${d}`))).toEqual([
        [b.L, b.T],
        [b.R, b.T],
        [b.R, b.B],
        [b.L, b.B],
      ]);
      expect(points(path(`cL${d}`))).toEqual([
        [a.L, a.T],
        [b.L, b.T],
        [b.L, b.B],
        [a.L, a.B],
      ]);
      expect(points(path(`cR${d}`))).toEqual([
        [a.R, a.T],
        [b.R, b.T],
        [b.R, b.B],
        [a.R, a.B],
      ]);
      expect(path(`cF${d}`).endsWith("Z") && path(`cL${d}`).endsWith("Z") && path(`cR${d}`).endsWith("Z")).toBe(true);
    }
  });

  test("UI-21 右の path を x→239−x で写すと左と一致（cR/cL、cRD/cLD、rF/lF、rD/lD）", () => {
    const pairs: [string, string][] = [
      ["cR", "cL"],
      ["cRD", "cLD"],
      ["rF", "lF"],
      ["rD", "lD"],
    ];
    for (const [r, l] of pairs) {
      for (const d of SLOT_DEPTHS) {
        expect(mirror(path(`${r}${d}` as SlotId)), `${r}${d}`).toBe(parse(path(`${l}${d}` as SlotId)).map((x) => x.c + x.n.join(" ")).join(" "));
      }
    }
    // 正面の壁と扉は自分自身と左右対称
    for (const d of SLOT_DEPTHS) {
      for (const part of ["cF", "cD"]) {
        const b = bbox(path(`${part}${d}` as SlotId));
        expect(b.x0 + b.x1, `${part}${d}`).toBe(239);
      }
    }
  });

  test("UI-22 正面の扉は壁の中央で幅 1/2・高さ 3/4、床に接し、下辺を描かない", () => {
    for (const d of SLOT_DEPTHS) {
      const w = P(d + 1);
      const half = (w.R - w.L) / 4;
      const cx = (w.L + w.R) / 2;
      const x0 = round(cx - half);
      const x1 = round(cx + half);
      const top = round(w.B - (w.B - w.T) * 0.75);
      expect(points(path(`cD${d}`)), `cD${d}`).toEqual([
        [x0, w.B],
        [x0, top],
        [x1, top],
        [x1, w.B],
      ]);
    }
  });

  test("UI-22 側壁の扉は台形の横 1/4〜3/4、その位置の壁の高さの 3/4 で床に接する", () => {
    for (const d of SLOT_DEPTHS) {
      const a = P(d);
      const b = P(d + 1);
      // 左の側壁の上辺と下辺（x の一次式）
      const topAt = (x: number) => a.T + ((b.T - a.T) * (x - a.L)) / (b.L - a.L);
      const botAt = (x: number) => a.B - ((a.B - b.B) * (x - a.L)) / (b.L - a.L);
      const xa = round(a.L + (b.L - a.L) / 4);
      const xb = round(a.L + ((b.L - a.L) * 3) / 4);
      const doorTop = (x: number) => round(botAt(x) - (botAt(x) - topAt(x)) * 0.75);
      expect(points(path(`cLD${d}`)), `cLD${d}`).toEqual([
        [xa, round(botAt(xa))],
        [xa, doorTop(xa)],
        [xb, doorTop(xb)],
        [xb, round(botAt(xb))],
      ]);
    }
  });

  test("UI-20 左の列の壁は見えている帯 P_d.L..P_{d+1}.L で、扉は帯の中央の目印", () => {
    for (const d of SLOT_DEPTHS) {
      const a = P(d);
      const b = P(d + 1);
      expect(points(path(`lF${d}`))).toEqual([
        [a.L, b.T],
        [b.L, b.T],
        [b.L, b.B],
        [a.L, b.B],
      ]);
      const cx = (a.L + b.L) / 2;
      const q = (b.L - a.L) / 4;
      const top = round(b.B - (b.B - b.T) * 0.75);
      expect(points(path(`lD${d}`))).toEqual([
        [round(cx - q), b.B],
        [round(cx - q), top],
        [round(cx + q), top],
        [round(cx + q), b.B],
      ]);
    }
  });

  test("UI-22 扉の外接矩形は、親の壁の外接矩形の内側（側壁の扉は台形の内側、丸めの 0.5px まで）", () => {
    const parents: [string, string][] = [
      ["cD", "cF"],
      ["cLD", "cL"],
      ["cRD", "cR"],
      ["lD", "lF"],
      ["rD", "rF"],
    ];
    for (const [door, wall] of parents) {
      for (const d of SLOT_DEPTHS) {
        const i = bbox(path(`${door}${d}` as SlotId));
        const o = bbox(path(`${wall}${d}` as SlotId));
        const tag = `${door}${d} in ${wall}${d}`;
        expect(i.x0 > o.x0 && i.x1 < o.x1, tag).toBe(true);
        expect(i.y0 > o.y0 && i.y1 <= o.y1, tag).toBe(true);
      }
    }
    for (const d of SLOT_DEPTHS) {
      const a = P(d);
      const b = P(d + 1);
      const topAt = (x: number) => a.T + ((b.T - a.T) * (x - a.L)) / (b.L - a.L);
      const botAt = (x: number) => a.B - ((a.B - b.B) * (x - a.L)) / (b.L - a.L);
      for (const [x, y] of points(path(`cLD${d}`))) {
        expect(y >= topAt(x) && y <= botAt(x) + 0.5, `cLD${d} (${x},${y})`).toBe(true);
      }
    }
  });
});
