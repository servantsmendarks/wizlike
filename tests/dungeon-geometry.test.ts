// UI-20〜22: 線画の座標表。期待値は表をなぞらず、面 P0..P4 と扉の比率（幅 1/2、高さ 3/4、床に接する、
// 側壁の扉は台形の横 1/4〜3/4。四捨五入で .5 は切り上げ）と階段の記号の比率（横線 3 本、f = 1/4, 1/2, 3/4、幅 3/4, 1/2, 1/4）から
// 計算し直して突き合わせる。
import { describe, expect, test } from "vitest";
import { isStairsSlot, PLANES, SLOT_DEPTHS, SLOT_IDS, SLOT_PATHS, type SlotId } from "../src/presenter/views/dungeon-geometry";

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

  test("UI-20 64 個（壁・扉 40 と階段の記号 24）の SlotId に空でない path があり、重複が無い", () => {
    expect(SLOT_IDS).toHaveLength(64);
    expect(new Set(SLOT_IDS).size).toBe(64);
    expect(SLOT_IDS.filter(isStairsSlot)).toHaveLength(24);
    expect(Object.keys(SLOT_PATHS).sort()).toEqual([...SLOT_IDS].sort());
    const ds = SLOT_IDS.map((id) => SLOT_PATHS[id]);
    for (const d of ds) expect(d.trim().length).toBeGreaterThan(0);
    expect(new Set(ds).size).toBe(64);
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
      ["rSU", "lSU"],
      ["rSD", "lSD"],
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
  /** 横線 3 本の path を [x0, x1, y] の列にする（M x y H x の繰り返し） */
  const hLines = (d: string): Array<[number, number, number]> => {
    const cmds = parse(d);
    expect(cmds.map((c) => c.c).join("")).toBe("MHMHMH");
    const out: Array<[number, number, number]> = [];
    for (let i = 0; i < cmds.length; i += 2) out.push([cmds[i]!.n[0]!, cmds[i + 1]!.n[0]!, cmds[i]!.n[1]!]);
    return out;
  };
  /** 奥行き d の床で、y における中央の列の左端 L(y)（側壁の下辺。P_d.L..P_{d+1}.L の一次式） */
  const floorL = (d: number, y: number): number => {
    const a = P(d);
    const b = P(d + 1);
    return a.L + ((b.L - a.L) * (a.B - y)) / (a.B - b.B);
  };
  const STAIRS_F = { U: [0.75, 0.5, 0.25], D: [0.25, 0.5, 0.75] } as const;
  const STAIRS_W = [0.75, 0.5, 0.25] as const;
  const sid = (s: string): SlotId => s as SlotId;

  test("UI-20 階段の記号: 床の横線 3 本。y は床の奥の縁から f=1/4,1/2,3/4、幅は床の幅の 3/4,1/2,1/4（中央の列はその y の床、左端を丸めて右端 239−左端。左の列は f=3/4 の y の帯 P_d.L..L(y) の中央）", () => {
    for (const d of SLOT_DEPTHS) {
      const a = P(d);
      const b = P(d + 1);
      for (const dir of ["U", "D"] as const) {
        const ys = STAIRS_F[dir].map((f) => round(b.B + f * (a.B - b.B)));
        const center = ys.map((y, k): [number, number, number] => {
          const x0 = round(119.5 - ((239 - 2 * floorL(d, y)) * STAIRS_W[k]!) / 2);
          return [x0, 239 - x0, y];
        });
        // 左の列の帯は手前ほど細るので、最も手前の線（f=3/4）の y での帯 P_d.L..L(y) を 3 本共通の基準にする
        const Lr = floorL(d, round(b.B + 0.75 * (a.B - b.B)));
        const left = ys.map((y, k): [number, number, number] => {
          const c = (a.L + Lr) / 2;
          const hw = ((Lr - a.L) * STAIRS_W[k]!) / 2;
          return [round(c - hw), round(c + hw), y];
        });
        expect(hLines(path(sid(`cS${dir}${d}`))), `cS${dir}${d}`).toEqual(center);
        expect(hLines(path(sid(`lS${dir}${d}`))), `lS${dir}${d}`).toEqual(left);
      }
    }
  });

  test("UI-20 階段の記号は床の範囲内（y は P_{d+1}.B と P_d.B の間で両端を含まない、x はその y の床の幅（列は見えている帯）に丸めの 0.5px まで）、線の長さは 1 以上", () => {
    for (const d of SLOT_DEPTHS) {
      const a = P(d);
      const b = P(d + 1);
      for (const part of ["cSU", "cSD", "lSU", "lSD", "rSU", "rSD"]) {
        for (const [p, q, y] of hLines(path(sid(`${part}${d}`)))) {
          const tag = `${part}${d} y=${y}`;
          const lo = Math.min(p, q);
          const hi = Math.max(p, q);
          expect(y > b.B && y < a.B, tag).toBe(true);
          expect(hi - lo, tag).toBeGreaterThanOrEqual(1);
          const L = floorL(d, y);
          const [xl, xr] = part[0] === "c" ? [L, 239 - L] : part[0] === "l" ? [a.L, L] : [239 - L, 239 - a.L];
          expect(lo >= xl - 0.5 && hi <= xr + 0.5, `${tag} ${lo}..${hi} in ${xl}..${xr}`).toBe(true);
        }
      }
    }
  });

  test("UI-20 階段の記号の形: 下りは画面の下ほど線が狭い（地図の V）、上りは画面の上ほど狭い（地図の ^）。中央の列は左右対称、上りと下りは別の形", () => {
    for (const d of SLOT_DEPTHS) {
      for (const lane of ["c", "l", "r"]) {
        for (const dir of ["U", "D"] as const) {
          const ls = hLines(path(sid(`${lane}S${dir}${d}`)));
          const byY = [...ls].sort((p, q) => p[2] - q[2]);
          const widths = byY.map(([p, q]) => Math.abs(q - p));
          const tag = `${lane}S${dir}${d} ${widths.join(",")}`;
          // 上から下へ並べた幅。下りは狭くなり、上りは広くなる（丸めで等しくなることはあっても逆転しない）
          for (let i = 1; i < 3; i++) {
            if (dir === "D") expect(widths[i]! <= widths[i - 1]!, tag).toBe(true);
            else expect(widths[i]! >= widths[i - 1]!, tag).toBe(true);
          }
          expect(dir === "D" ? widths[0]! > widths[2]! : widths[2]! > widths[0]!, tag).toBe(true);
          if (lane === "c") for (const [p, q] of ls) expect(p + q, tag).toBe(239);
        }
        expect(path(sid(`${lane}SU${d}`))).not.toBe(path(sid(`${lane}SD${d}`)));
      }
    }
  });

  test("UI-20 isStairsSlot は階段の記号のスロットだけ真", () => {
    expect(isStairsSlot("cSU0")).toBe(true);
    expect(isStairsSlot("rSD3")).toBe(true);
    expect(isStairsSlot("cF0")).toBe(false);
    expect(isStairsSlot("lD2")).toBe(false);
  });
});
