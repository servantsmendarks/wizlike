// UI-20〜22: 線画の座標表。期待値は表をなぞらず、面 P0..P4 と扉の比率（幅 1/2、高さ 3/4、床に接する、
// 側壁の扉は台形の横 1/4〜3/4。四捨五入で .5 は切り上げ）と階段の記号の比率（横線 3 本、f = 1/4, 1/2, 3/4、幅 3/4, 1/2, 1/4）から
// 計算し直して突き合わせる。
import { describe, expect, test } from "vitest";
import { EXIT_MARK_IDS, EXIT_MARK_PATHS, isChestSlot, isStairsSlot, isTrapSlot, PLANES, SLOT_DEPTHS, SLOT_IDS, SLOT_PATHS, type SlotId } from "../src/presenter/views/dungeon-geometry";

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

  test("UI-20 UI-72 96 個（壁・扉 40 と階段の記号 24 と罠の印 12 と宝箱の印 12 と開口側の床線 8。M5.5 で 64 → 76、M11 で 76 → 88、M16 で 88 → 96）の SlotId に空でない path があり、重複が無い", () => {
    expect(SLOT_IDS).toHaveLength(96);
    expect(new Set(SLOT_IDS).size).toBe(96);
    expect(SLOT_IDS.filter((id) => /^c[LR]O[0-3]$/.test(id))).toHaveLength(8);
    expect(SLOT_IDS.filter(isStairsSlot)).toHaveLength(24);
    expect(SLOT_IDS.filter(isTrapSlot)).toHaveLength(12);
    expect(SLOT_IDS.filter(isChestSlot)).toHaveLength(12);
    expect(Object.keys(SLOT_PATHS).sort()).toEqual([...SLOT_IDS].sort());
    const ds = SLOT_IDS.map((id) => SLOT_PATHS[id]);
    for (const d of ds) expect(d.trim().length).toBeGreaterThan(0);
    expect(new Set(ds).size).toBe(96);
  });

  test("UI-20 描画順（M16）: 同じ奥行きでは床線 cLO / cRO は床の印（宝箱の印）の後・壁の前", () => {
    for (const d of SLOT_DEPTHS) {
      const i = (p: string) => SLOT_IDS.indexOf(`${p}${d}` as SlotId);
      expect(i("rC"), `${d}`).toBeLessThan(i("cLO"));
      expect(i("cLO")).toBeLessThan(i("cRO"));
      expect(i("cRO")).toBeLessThan(i("cF"));
      expect(i("cRO")).toBeLessThan(i("cL"));
    }
  });

  test("UI-21 開口側の床線 cLO{d} / cRO{d} は側壁 cL{d} / cR{d} の下辺（P_d の下の角 → P_{d+1} の下の角）の 1 本", () => {
    for (const d of SLOT_DEPTHS) {
      const a = P(d);
      const b = P(d + 1);
      expect(points(path(`cLO${d}`))).toEqual([
        [a.L, a.B],
        [b.L, b.B],
      ]);
      expect(points(path(`cRO${d}`))).toEqual([
        [a.R, a.B],
        [b.R, b.B],
      ]);
      // 側壁の台形の頂点に含まれる（同じ線を引き直すだけ）
      const wallL = points(path(`cL${d}`)).map((q) => q.join(","));
      for (const q of points(path(`cLO${d}`))) expect(wallL).toContain(q.join(","));
      expect(path(`cLO${d}`).includes("Z")).toBe(false);
    }
  });

  test("UI-20 UI-21 開口の印（M16）: 6 本、座標は整数で線画の下端 y 145..149（床の印の最下端より 1px 以上下）、左右は鏡像、前は自分自身と左右対称、扉の印は矩形", () => {
    expect(EXIT_MARK_IDS).toEqual(["xL", "xF", "xR", "xLD", "xFD", "xRD"]);
    expect(Object.keys(EXIT_MARK_PATHS).sort()).toEqual([...EXIT_MARK_IDS].sort());
    const floorMarkBottom = Math.max(
      ...SLOT_IDS.filter((id) => isStairsSlot(id) || isTrapSlot(id) || isChestSlot(id)).map((id) => bbox(path(id)).y1),
    );
    expect(floorMarkBottom).toBe(143);
    for (const id of EXIT_MARK_IDS) {
      const d = EXIT_MARK_PATHS[id];
      for (const [x, y] of points(d)) {
        expect(Number.isInteger(x) && Number.isInteger(y), `${id} (${x},${y})`).toBe(true);
        expect(x >= 0 && x <= 239 && y >= floorMarkBottom + 2 && y <= 149, `${id} (${x},${y})`).toBe(true);
      }
      expect(d.endsWith("Z"), id).toBe(true);
    }
    const norm = (d: string) => parse(d).map((x) => x.c + x.n.join(" ")).join(" ");
    expect(mirror(EXIT_MARK_PATHS.xR)).toBe(norm(EXIT_MARK_PATHS.xL));
    expect(mirror(EXIT_MARK_PATHS.xRD)).toBe(norm(EXIT_MARK_PATHS.xLD));
    for (const id of ["xF", "xFD"] as const) {
      const b = bbox(EXIT_MARK_PATHS[id]);
      expect(b.x0 + b.x1, id).toBe(239);
    }
    // 向き: ◀ は左端が頂点 1 つ、▶ は右端が頂点 1 つ、▲ は上端が下端より狭い
    const xs = (id: "xL" | "xR" | "xF") => points(EXIT_MARK_PATHS[id]);
    expect(xs("xL").filter((q) => q[0] === bbox(EXIT_MARK_PATHS.xL).x0)).toHaveLength(1);
    expect(xs("xR").filter((q) => q[0] === bbox(EXIT_MARK_PATHS.xR).x1)).toHaveLength(1);
    const f = bbox(EXIT_MARK_PATHS.xF);
    const top = xs("xF").filter((q) => q[1] === f.y0).map((q) => q[0]);
    expect(Math.max(...top) - Math.min(...top)).toBeLessThan(f.x1 - f.x0);
    // 扉の印は軸に沿った矩形（頂点 4 つ）で、同じ側の open の印と同じ外接矩形
    for (const [o, dd] of [["xL", "xLD"], ["xF", "xFD"], ["xR", "xRD"]] as const) {
      const p = points(EXIT_MARK_PATHS[dd]);
      expect(p).toHaveLength(4);
      expect(new Set(p.map((q) => q[0])).size).toBe(2);
      expect(new Set(p.map((q) => q[1])).size).toBe(2);
      expect(bbox(EXIT_MARK_PATHS[dd])).toEqual(bbox(EXIT_MARK_PATHS[o]));
    }
  });

  test("UI-72 描画順: 同じ奥行きでは宝箱の印は罠の印の後・壁の前（床の印 → 壁 → 扉）", () => {
    for (const d of SLOT_DEPTHS) {
      const i = (p: string) => SLOT_IDS.indexOf(`${p}${d}` as SlotId);
      expect(i("rT"), `${d}`).toBeLessThan(i("cC"));
      expect(i("cC")).toBeLessThan(i("lC"));
      expect(i("lC")).toBeLessThan(i("rC"));
      expect(i("rC")).toBeLessThan(i("cF"));
    }
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
      ["rT", "lT"],
      ["rC", "lC"],
      ["cRO", "cLO"],
    ];
    for (const [r, l] of pairs) {
      for (const d of SLOT_DEPTHS) {
        expect(mirror(path(`${r}${d}` as SlotId)), `${r}${d}`).toBe(parse(path(`${l}${d}` as SlotId)).map((x) => x.c + x.n.join(" ")).join(" "));
      }
    }
    // 正面の壁と扉は自分自身と左右対称
    for (const d of SLOT_DEPTHS) {
      for (const part of ["cF", "cD", "cT", "cC"]) {
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

  test("UI-20 階段の記号: 床の横線 3 本。y は床の奥の縁から f=1/4,1/2,3/4、幅は床の幅の 3/4,1/2,1/4（中央の列はその y の床、左端を丸めて右端 239−左端。左の列は f=3/4 の y の帯 P_d.L..L(y) の中央で、左端は P_d.L+1 以上）", () => {
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
          return [Math.max(round(c - hw), a.L + 1), round(c + hw), y];
        });
        expect(hLines(path(sid(`cS${dir}${d}`))), `cS${dir}${d}`).toEqual(center);
        expect(hLines(path(sid(`lS${dir}${d}`))), `lS${dir}${d}`).toEqual(left);
      }
    }
  });

  test("UI-20 階段の記号は床の範囲内（y は P_{d+1}.B と P_d.B の間で両端を含まない、x はその y の床の幅（列は見えている帯で、帯の縁には付かない）に丸めの 0.5px まで）、線の長さは 1 以上", () => {
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
          // 列の記号は帯の縁（cL/lF、cR/rF の縦線）に付かない（開区間）
          if (part[0] === "l") expect(lo > a.L, `${tag} lo=${lo} > ${a.L}`).toBe(true);
          if (part[0] === "r") expect(hi < 239 - a.L, `${tag} hi=${hi} < ${239 - a.L}`).toBe(true);
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

  /** × の path（M x y L x y M x y L x y）を 2 本の線分 [x0, y0, x1, y1] にする */
  const crossLines = (d: string): Array<[number, number, number, number]> => {
    const cmds = parse(d);
    expect(cmds.map((c) => c.c).join("")).toBe("MLML");
    return [0, 2].map((i): [number, number, number, number] => [cmds[i]!.n[0]!, cmds[i]!.n[1]!, cmds[i + 1]!.n[0]!, cmds[i + 1]!.n[1]!]);
  };

  test("UI-20 罠の印（M5.5）: 床の ×。上下の端は床の奥の縁から f=1/4・3/4 の y、幅は f=3/4 の y で測った幅の 1/2（中央の列は床、左端を丸めて右端 239−左端。左の列は帯 P_d.L..L(y) の中央で左端は P_d.L+1 以上）", () => {
    for (const d of SLOT_DEPTHS) {
      const a = P(d);
      const b = P(d + 1);
      const y0 = round(b.B + 0.25 * (a.B - b.B));
      const y1 = round(b.B + 0.75 * (a.B - b.B));
      const L = floorL(d, y1);
      const cx0 = round(119.5 - (239 - 2 * L) * 0.5 * 0.5);
      const cx1 = 239 - cx0;
      expect(crossLines(path(sid(`cT${d}`))), `cT${d}`).toEqual([
        [cx0, y0, cx1, y1],
        [cx1, y0, cx0, y1],
      ]);
      const c = (a.L + L) / 2;
      const hw = ((L - a.L) * 0.5) / 2;
      const lx0 = Math.max(round(c - hw), a.L + 1);
      const lx1 = round(c + hw);
      expect(crossLines(path(sid(`lT${d}`))), `lT${d}`).toEqual([
        [lx0, y0, lx1, y1],
        [lx1, y0, lx0, y1],
      ]);
    }
  });

  test("UI-20 罠の印の線の端は床の台形（中央の列）・見えている帯（左右の列）の内側に収まり、帯の縁に付かない。× の幅と高さは 1 以上", () => {
    for (const d of SLOT_DEPTHS) {
      const a = P(d);
      const b = P(d + 1);
      for (const part of ["cT", "lT", "rT"]) {
        const tag = `${part}${d}`;
        const ls = crossLines(path(sid(tag)));
        for (const [x0, y0, x1, y1] of ls) {
          expect(Math.abs(x1 - x0), tag).toBeGreaterThanOrEqual(1);
          expect(Math.abs(y1 - y0), tag).toBeGreaterThanOrEqual(1);
          for (const [x, y] of [
            [x0, y0],
            [x1, y1],
          ] as const) {
            expect(y > b.B && y < a.B, `${tag} y=${y}`).toBe(true);
            const L = floorL(d, y);
            const [xl, xr] = part[0] === "c" ? [L, 239 - L] : part[0] === "l" ? [a.L, L] : [239 - L, 239 - a.L];
            expect(x >= xl - 0.5 && x <= xr + 0.5, `${tag} (${x},${y}) in ${xl}..${xr}`).toBe(true);
            if (part[0] === "l") expect(x > a.L, `${tag} x=${x}`).toBe(true);
            if (part[0] === "r") expect(x < 239 - a.L, `${tag} x=${x}`).toBe(true);
          }
        }
      }
    }
  });

  test("UI-72 宝箱の印（M11）: 前面の矩形（M x0 y0 H x1 V y1 H x0 Z）と、奥行き 0〜2 の中央・奥行き 0〜1 の左右の列には蓋の継ぎ目の横線 1 本（矩形の内側の y、全幅）", () => {
    for (const d of SLOT_DEPTHS) {
      for (const part of ["cC", "lC", "rC"]) {
        const tag = `${part}${d}`;
        const cmds = parse(path(sid(tag)));
        expect(cmds.slice(0, 5).map((c) => c.c).join(""), tag).toBe("MHVHZ");
        const [m, h1, v, h2] = cmds as [Cmd, Cmd, Cmd, Cmd];
        expect(h2.n[0], tag).toBe(m.n[0]);
        const x0 = Math.min(m.n[0]!, h1.n[0]!);
        const x1 = Math.max(m.n[0]!, h1.n[0]!);
        const y0 = m.n[1]!;
        const y1 = v.n[0]!;
        expect(y1 - y0, tag).toBeGreaterThanOrEqual(2);
        expect(x1 - x0, tag).toBeGreaterThan(y1 - y0);
        const lid = part === "cC" ? d <= 2 : d <= 1;
        if (!lid) {
          expect(cmds, tag).toHaveLength(5);
          continue;
        }
        expect(cmds.slice(5).map((c) => c.c).join(""), tag).toBe("MH");
        const [lm, lh] = cmds.slice(5) as [Cmd, Cmd];
        expect([Math.min(lm.n[0]!, lh.n[0]!), Math.max(lm.n[0]!, lh.n[0]!)], tag).toEqual([x0, x1]);
        expect(lm.n[1]! > y0 && lm.n[1]! < y1, tag).toBe(true);
      }
    }
  });

  test("UI-72 宝箱の印は床の上に立つ: 上端は P_{d+1}.B より下（奥の壁の下辺と交わらない）、下端は P_d.B より上。中央の列は左右対称で奥ほど狭い。左の列は見えている床の三角形の中（左端 P_d.L+1 以上、右下の角は側壁の下辺より上、右端 P_{d+1}.L 以下）", () => {
    let prevW = Infinity;
    for (const d of SLOT_DEPTHS) {
      const a = P(d);
      const b = P(d + 1);
      for (const part of ["cC", "lC", "rC"]) {
        const tag = `${part}${d}`;
        const bb = bbox(path(sid(tag)));
        expect(bb.y0 > b.B, `${tag} top ${bb.y0}`).toBe(true);
        expect(bb.y1 < a.B, `${tag} bottom ${bb.y1}`).toBe(true);
      }
      const c = bbox(path(sid(`cC${d}`)));
      expect(c.x0 + c.x1).toBe(239);
      // 中央の列は床の台形の中（下端の y の側壁の下辺の内側）
      expect(c.x0).toBeGreaterThan(floorL(d, c.y1));
      expect(c.x1 - c.x0).toBeLessThan(prevW);
      prevW = c.x1 - c.x0;
      const l = bbox(path(sid(`lC${d}`)));
      expect(l.x0).toBeGreaterThanOrEqual(a.L + 1);
      expect(l.x1).toBeLessThanOrEqual(b.L);
      // 右下の角 (x1, y1) は側壁の下辺（(a.L, a.B) と (b.L, b.B) を結ぶ線）の上（y が小さい側）
      const yEdge = a.B - ((l.x1 - a.L) * (a.B - b.B)) / (b.L - a.L);
      expect(l.y1, `lC${d}`).toBeLessThanOrEqual(yEdge);
    }
  });

  test("UI-72 isChestSlot は宝箱の印のスロットだけ真（罠・階段・壁は偽）。isTrapSlot・isStairsSlot は宝箱の印で偽", () => {
    expect(isChestSlot("cC0")).toBe(true);
    expect(isChestSlot("lC2")).toBe(true);
    expect(isChestSlot("rC3")).toBe(true);
    expect(isChestSlot("cT0")).toBe(false);
    expect(isChestSlot("cSU0")).toBe(false);
    expect(isChestSlot("cF0")).toBe(false);
    expect(isTrapSlot("cC1")).toBe(false);
    expect(isStairsSlot("rC1")).toBe(false);
  });

  test("UI-20 isTrapSlot は罠の印のスロットだけ真（階段・壁は偽）", () => {
    expect(isTrapSlot("cT0")).toBe(true);
    expect(isTrapSlot("rT3")).toBe(true);
    expect(isTrapSlot("cSU0")).toBe(false);
    expect(isTrapSlot("cF0")).toBe(false);
    expect(isStairsSlot("lT1")).toBe(false);
  });

  test("UI-20 isStairsSlot は階段の記号のスロットだけ真", () => {
    expect(isStairsSlot("cSU0")).toBe(true);
    expect(isStairsSlot("rSD3")).toBe(true);
    expect(isStairsSlot("cF0")).toBe(false);
    expect(isStairsSlot("lD2")).toBe(false);
  });
});
