import { describe, expect, test } from "vitest";
import {
  chance,
  cloneRng,
  createRng,
  DiceParseError,
  diceRange,
  formatDice,
  isDiceExpr,
  isRngState,
  nextFloat,
  nextUint32,
  parseDice,
  randInt,
  restoreRng,
  rollDice,
  rollDie,
  type RngState,
} from "../src/core/rng";

function take(rng: RngState, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(nextUint32(rng));
  return out;
}

/** BigInt で書いた独立実装の xoshiro128**（参照 C 実装の直訳） */
function refXoshiro(seed: [number, number, number, number]): () => number {
  const M = 0xffffffffn;
  const s = seed.map((v) => BigInt(v));
  const rotl = (x: bigint, k: bigint) => ((x << k) | (x >> (32n - k))) & M;
  return () => {
    const s0 = s[0]!, s1 = s[1]!, s2 = s[2]!, s3 = s[3]!;
    const result = (rotl((s1 * 5n) & M, 7n) * 9n) & M;
    const t = (s1 << 9n) & M;
    let n2 = s2 ^ s0;
    let n3 = s3 ^ s1;
    const n1 = s1 ^ n2;
    const n0 = s0 ^ n3;
    n2 ^= t;
    n3 = rotl(n3, 11n);
    s[0] = n0; s[1] = n1; s[2] = n2; s[3] = n3;
    return Number(result);
  };
}

describe("rng: xoshiro128**", () => {
  test("rng: 参照ベクトル s=[1,2,3,4] の最初の 4 つ", () => {
    const rng: RngState = { algo: "xoshiro128**", s: [1, 2, 3, 4] };
    expect(take(rng, 4)).toEqual([11520, 0, 5927040, 70819200]);
  });

  test("rng: BigInt の独立実装と 1000 個一致", () => {
    for (const seed of [[1, 2, 3, 4], [0xffffffff, 0x80000000, 0x12345678, 0xdeadbeef]] as const) {
      const rng: RngState = { algo: "xoshiro128**", s: [...seed] };
      const ref = refXoshiro([...seed]);
      for (let i = 0; i < 1000; i++) expect(nextUint32(rng)).toBe(ref());
    }
    const rng = createRng(42);
    const ref = refXoshiro([...rng.s]);
    for (let i = 0; i < 1000; i++) expect(nextUint32(rng)).toBe(ref());
  });

  test("rng: 同じシードは同じ列、異なるシードは異なる列", () => {
    expect(take(createRng(7), 1000)).toEqual(take(createRng(7), 1000));
    expect(take(createRng(7), 10)).not.toEqual(take(createRng(8), 10));
    expect(take(createRng(0), 10)).not.toEqual(take(createRng(1), 10));
  });

  test("rng: createRng(42) / createRng(0) の回帰値", () => {
    const r42 = createRng(42);
    expect(r42.s).toEqual([551831576, 144025891, 322543647, 3034809370]);
    expect(take(r42, 5)).toEqual([660444221, 3652823732, 77672526, 910233633, 2297337756]);
    const r0 = createRng(0);
    expect(r0.s).toEqual([1684164658, 3653269916, 2939563536, 2141751570]);
    expect(take(r0, 5)).toEqual([1789933344, 44971166, 2521387044, 3848737593, 1138324114]);
  });

  test("rng: createRng は seed >>> 0 を使い、非整数は RangeError", () => {
    expect(createRng(-1)).toEqual(createRng(0xffffffff));
    expect(createRng(2 ** 32)).toEqual(createRng(0));
    expect(() => createRng(1.5)).toThrow(RangeError);
    expect(() => createRng(Number.NaN)).toThrow(RangeError);
    expect(() => createRng(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  test("rng: 出力は [0, 2^32) の整数、nextFloat は [0,1)", () => {
    const rng = createRng(99);
    for (let i = 0; i < 1000; i++) {
      const u = nextUint32(rng);
      expect(Number.isInteger(u) && u >= 0 && u < 2 ** 32).toBe(true);
      const f = nextFloat(rng);
      expect(f >= 0 && f < 1).toBe(true);
    }
    const a = createRng(5);
    const b = createRng(5);
    expect(nextFloat(a)).toBe(nextUint32(b) / 2 ** 32);
  });
});

describe("rng: 保存と復元", () => {
  test("rng: JSON 往復で続きが一致する", () => {
    const rng = createRng(2026);
    take(rng, 10);
    const restored = restoreRng(JSON.parse(JSON.stringify(rng)));
    expect(take(restored, 100)).toEqual(take(rng, 100));
  });

  test("rng: cloneRng は独立している", () => {
    const a = createRng(3);
    const b = cloneRng(a);
    const snapshot = [...b.s];
    take(a, 5);
    expect(b.s).toEqual(snapshot);
    const c = cloneRng(b);
    expect(take(b, 20)).toEqual(take(c, 20));
  });

  test("rng: restoreRng は新しいコピーを返す", () => {
    const src = createRng(4);
    const r = restoreRng(src);
    expect(r).not.toBe(src);
    expect(r.s).not.toBe(src.s);
    nextUint32(r);
    expect(src).toEqual(createRng(4));
  });

  test("rng: restoreRng は -0 を 0 に正規化し、余分なキーを捨てる", () => {
    const r = restoreRng({ algo: "xoshiro128**", s: [-0, 0, 0, 5], extra: 1 });
    expect(Object.is(r.s[0], 0)).toBe(true);
    expect(Object.keys(r).sort()).toEqual(["algo", "s"]);
    expect(isRngState({ algo: "xoshiro128**", s: [-0, -0, -0, -0] })).toBe(false);
  });

  test("rng: isRngState / restoreRng は不正な形を拒否する", () => {
    const bad: unknown[] = [
      { algo: "xorshift", s: [1, 2, 3, 4] },
      { s: [1, 2, 3, 4] },
      { algo: "xoshiro128**", s: [1, 2, 3] },
      { algo: "xoshiro128**", s: [1, 2, 3, 4, 5] },
      { algo: "xoshiro128**", s: [1, 2.5, 3, 4] },
      { algo: "xoshiro128**", s: [1, "2", 3, 4] },
      { algo: "xoshiro128**", s: [1, -1, 3, 4] },
      { algo: "xoshiro128**", s: [1, 2 ** 32, 3, 4] },
      { algo: "xoshiro128**", s: [0, 0, 0, 0] },
      { algo: "xoshiro128**" },
      null,
      undefined,
      42,
      "xoshiro128**",
      [1, 2, 3, 4],
    ];
    for (const x of bad) {
      expect(isRngState(x)).toBe(false);
      expect(() => restoreRng(x)).toThrow(Error);
    }
    expect(isRngState({ algo: "xoshiro128**", s: [0, 0, 0, 2 ** 32 - 1] })).toBe(true);
    expect(isRngState(createRng(1))).toBe(true);
  });
});

describe("rng: randInt / rollDie / chance", () => {
  test("rng: randInt(1,6) は両端を含みおおむね一様", () => {
    const rng = createRng(777);
    const counts = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 6000; i++) {
      const v = randInt(rng, 1, 6);
      expect(v >= 1 && v <= 6).toBe(true);
      counts[v - 1]!++;
    }
    for (const c of counts) expect(c).toBeGreaterThan(850);
    for (const c of counts) expect(c).toBeLessThan(1150);
  });

  test("rng: randInt の min==max、負の範囲、最大幅", () => {
    const rng = createRng(11);
    for (let i = 0; i < 20; i++) expect(randInt(rng, 5, 5)).toBe(5);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const v = randInt(rng, -3, -1);
      expect(v >= -3 && v <= -1).toBe(true);
      seen.add(v);
    }
    expect([...seen].sort((x, y) => x - y)).toEqual([-3, -2, -1]);
    const a = createRng(12);
    const b = createRng(12);
    for (let i = 0; i < 100; i++) expect(randInt(a, 0, 2 ** 32 - 1)).toBe(nextUint32(b));
    const c = createRng(13);
    for (let i = 0; i < 100; i++) {
      const v = randInt(c, -(2 ** 31), 2 ** 31 - 1);
      expect(v >= -(2 ** 31) && v <= 2 ** 31 - 1).toBe(true);
    }
  });

  test("rng: randInt の棄却（引き直し）経路: 幅 3*2^30 で出目と消費数が固定される", () => {
    // 幅 3*2^30 では limit = 3*2^30 で、u >= 3221225472 の語（約 1/4）は捨てて引き直す。
    const W = 3 * 2 ** 30;
    const raw = createRng(1);
    const words = take(raw, 15);
    // createRng(1) の生の語列。添字 2, 9, 10, 12 が棄却される（例: words[2] = 3814759091 >= 3221225472）。
    expect(words).toEqual([
      393288148, 2174103013, 3814759091, 2092745082, 1865176206, 2179171167, 3207394750, 2858353069,
      559075315, 3395495274, 4035540825, 1929427096, 4080585408, 498941776, 2789075627,
    ]);
    expect(words.map((u, i) => (u >= W ? i : -1)).filter((i) => i >= 0)).toEqual([2, 9, 10, 12]);
    const rng = createRng(1);
    const vals = Array.from({ length: 10 }, () => randInt(rng, 0, W - 1));
    // 棄却なしで u % W を返す実装なら 3 個目が 3814759091 - W = 593533619 になる。
    expect(vals).toEqual([
      393288148, 2174103013, 2092745082, 1865176206, 2179171167, 3207394750, 2858353069, 559075315,
      1929427096, 498941776,
    ]);
    // 10 個の出目に 10 + 棄却 4 = 14 語を消費した。次の語は生の列の words[14]。
    expect(nextUint32(rng)).toBe(words[14]);
  });

  test("rng: randInt の不正引数は RangeError", () => {
    const rng = createRng(1);
    expect(() => randInt(rng, 1.5, 3)).toThrow(RangeError);
    expect(() => randInt(rng, 1, 3.5)).toThrow(RangeError);
    expect(() => randInt(rng, Number.NaN, 3)).toThrow(RangeError);
    expect(() => randInt(rng, 1, Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => randInt(rng, 3, 1)).toThrow(RangeError);
    expect(() => randInt(rng, 0, 2 ** 32)).toThrow(RangeError);
    expect(() => rollDie(rng, 0)).toThrow(RangeError);
  });

  test("rng: rollDie は randInt(1, sides) と同じ", () => {
    const a = createRng(21);
    const b = createRng(21);
    for (let i = 0; i < 100; i++) expect(rollDie(a, 20)).toBe(randInt(b, 1, 20));
  });

  test("rng: chance(0) は常に false、chance(100) は常に true、どちらも 1 回分消費", () => {
    for (const p of [0, 100]) {
      const a = createRng(31);
      const b = createRng(31);
      for (let i = 0; i < 200; i++) {
        expect(chance(a, p)).toBe(p === 100);
        randInt(b, 1, 100);
      }
      expect(take(a, 10)).toEqual(take(b, 10));
    }
  });

  test("rng: chance(p) は randInt(1,100) <= p", () => {
    const a = createRng(41);
    const b = createRng(41);
    for (let i = 0; i < 200; i++) expect(chance(a, 37)).toBe(randInt(b, 1, 100) <= 37);
    expect(() => chance(createRng(1), Number.NaN)).toThrow(RangeError);
  });
});

describe("dice: 記法", () => {
  test("dice: 正常な記法の解釈", () => {
    expect(parseDice("1d1")).toEqual({ count: 1, sides: 1, modifier: 0 });
    expect(parseDice("2d10")).toEqual({ count: 2, sides: 10, modifier: 0 });
    expect(parseDice("1d8+2")).toEqual({ count: 1, sides: 8, modifier: 2 });
    expect(parseDice("3d6-1")).toEqual({ count: 3, sides: 6, modifier: -1 });
    expect(parseDice("100d1000")).toEqual({ count: 100, sides: 1000, modifier: 0 });
    expect(parseDice("1d6+0")).toEqual({ count: 1, sides: 6, modifier: 0 });
    expect(parseDice("1d6-0")).toEqual({ count: 1, sides: 6, modifier: 0 });
    expect(Object.is(parseDice("1d6-0").modifier, 0)).toBe(true);
    expect(parseDice("1d6-9999")).toEqual({ count: 1, sides: 6, modifier: -9999 });
    expect(parseDice("1d6+9999")).toEqual({ count: 1, sides: 6, modifier: 9999 });
  });

  test("dice: 不正な記法は DiceParseError", () => {
    const bad = [
      "", "d6", "0d6", "1d0", "101d6", "1d1001", "2D10", " 2d10", "2d10 ", "1d8 + 2",
      "01d6", "1d06", "2d10+", "2d10++1", "2d10+-1", "1.5d6", "-1d6", "1d6+10000", "1d6+01", "abc",
      "-1", "+5", "05", "00", "10000", " 1", "1 ", "1.0", "-0",
    ];
    for (const expr of bad) {
      expect(isDiceExpr(expr)).toBe(false);
      let err: unknown;
      try {
        parseDice(expr);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(DiceParseError);
      expect(err).toBeInstanceOf(Error);
      expect((err as DiceParseError).expr).toBe(expr);
      expect(() => rollDice(createRng(1), expr)).toThrow(DiceParseError);
    }
  });

  test("dice: 定数形 \"N\"（0..9999）は count 0・sides 0・modifier N", () => {
    expect(parseDice("0")).toEqual({ count: 0, sides: 0, modifier: 0 });
    expect(parseDice("1")).toEqual({ count: 0, sides: 0, modifier: 1 });
    expect(parseDice("5")).toEqual({ count: 0, sides: 0, modifier: 5 });
    expect(parseDice("9999")).toEqual({ count: 0, sides: 0, modifier: 9999 });
    for (const expr of ["0", "1", "10", "9999"]) expect(isDiceExpr(expr)).toBe(true);
    expect(diceRange(parseDice("0"))).toEqual({ min: 0, max: 0 });
    expect(diceRange(parseDice("1"))).toEqual({ min: 1, max: 1 });
    expect(diceRange(parseDice("9999"))).toEqual({ min: 9999, max: 9999 });
  });

  test("dice: 定数形の rollDice は dice [] で total N、乱数を消費しない", () => {
    for (const [expr, n] of [["0", 0], ["1", 1], ["9999", 9999]] as const) {
      const a = createRng(777);
      const b = createRng(777);
      expect(rollDice(a, expr)).toEqual({ spec: { count: 0, sides: 0, modifier: n }, dice: [], total: n });
      expect(rollDice(a, { count: 0, sides: 0, modifier: n })).toEqual({ spec: { count: 0, sides: 0, modifier: n }, dice: [], total: n });
      expect(a).toEqual(b);
      expect(take(a, 10)).toEqual(take(b, 10));
    }
  });

  test("dice: diceRange", () => {
    expect(diceRange(parseDice("1d1"))).toEqual({ min: 1, max: 1 });
    expect(diceRange(parseDice("2d10"))).toEqual({ min: 2, max: 20 });
    expect(diceRange(parseDice("1d8+2"))).toEqual({ min: 3, max: 10 });
    expect(diceRange(parseDice("3d6-1"))).toEqual({ min: 2, max: 17 });
    expect(diceRange(parseDice("100d1000"))).toEqual({ min: 100, max: 100000 });
    expect(diceRange(parseDice("1d6-9999"))).toEqual({ min: -9998, max: -9993 });
  });

  test("dice: formatDice の正規形と往復", () => {
    expect(formatDice({ count: 2, sides: 10, modifier: 0 })).toBe("2d10");
    expect(formatDice({ count: 1, sides: 8, modifier: 2 })).toBe("1d8+2");
    expect(formatDice({ count: 3, sides: 6, modifier: -1 })).toBe("3d6-1");
    expect(formatDice(parseDice("1d6+0"))).toBe("1d6");
    expect(formatDice(parseDice("1d6-0"))).toBe("1d6");
    expect(formatDice({ count: 0, sides: 0, modifier: 0 })).toBe("0");
    expect(formatDice({ count: 0, sides: 0, modifier: 5 })).toBe("5");
    for (const expr of ["1d1", "2d10", "1d8+2", "3d6-1", "100d1000", "1d6-9999", "1d6+9999", "6d8+10", "0", "1", "9999"]) {
      expect(formatDice(parseDice(expr))).toBe(expr);
      expect(parseDice(formatDice(parseDice(expr)))).toEqual(parseDice(expr));
    }
  });

  test("dice: data/*.json に実在する記法がすべて通る", () => {
    for (const expr of ["0", "1", "1d2", "1d3", "1d4", "1d6", "1d8", "2d10", "2d3", "2d6", "2d8", "3d6", "5d10", "6d8+10"]) {
      expect(isDiceExpr(expr)).toBe(true);
      const r = rollDice(createRng(1), expr);
      const { min, max } = diceRange(parseDice(expr));
      expect(r.total >= min && r.total <= max).toBe(true);
    }
  });
});

describe("dice: rollDice", () => {
  test("dice: createRng(12345) で 2d10 → [8,8]=16、3d6-1 → [6,1,3]=9、1d8+2 → [4]=6", () => {
    const rng = createRng(12345);
    expect(rollDice(rng, "2d10")).toEqual({ spec: { count: 2, sides: 10, modifier: 0 }, dice: [8, 8], total: 16 });
    expect(rollDice(rng, "3d6-1")).toEqual({ spec: { count: 3, sides: 6, modifier: -1 }, dice: [6, 1, 3], total: 9 });
    expect(rollDice(rng, "1d8+2")).toEqual({ spec: { count: 1, sides: 8, modifier: 2 }, dice: [4], total: 6 });
  });

  test("dice: 1d1 は常に 1", () => {
    const rng = createRng(8);
    for (let i = 0; i < 50; i++) expect(rollDice(rng, "1d1")).toEqual({ spec: { count: 1, sides: 1, modifier: 0 }, dice: [1], total: 1 });
  });

  test("dice: 3d6-1 は 2 と 17 の両方が出て範囲外は出ない", () => {
    const rng = createRng(606);
    let sawMin = false;
    let sawMax = false;
    for (let i = 0; i < 20000; i++) {
      const r = rollDice(rng, "3d6-1");
      expect(r.dice.length).toBe(3);
      expect(r.total).toBeGreaterThanOrEqual(2);
      expect(r.total).toBeLessThanOrEqual(17);
      expect(r.total).toBe(r.dice.reduce((a, b) => a + b, 0) - 1);
      if (r.total === 2) sawMin = true;
      if (r.total === 17) sawMax = true;
    }
    expect(sawMin).toBe(true);
    expect(sawMax).toBe(true);
  });

  test("dice: rollDice は rollDie を count 回呼ぶのと同じ消費", () => {
    for (const expr of ["2d10", "5d10", "6d8+10", "100d1000"]) {
      const spec = parseDice(expr);
      const a = createRng(4242);
      const b = createRng(4242);
      const r = rollDice(a, expr);
      const expected: number[] = [];
      for (let i = 0; i < spec.count; i++) expected.push(rollDie(b, spec.sides));
      expect(r.dice.length).toBe(spec.count);
      expect(r.dice).toEqual(expected);
      expect(r.total).toBe(expected.reduce((x, y) => x + y, 0) + spec.modifier);
      expect(take(a, 10)).toEqual(take(b, 10));
    }
  });

  test("dice: DiceSpec を直接渡しても文字列と同じ結果、不正な DiceSpec は RangeError", () => {
    const a = createRng(12345);
    const b = createRng(12345);
    expect(rollDice(a, { count: 2, sides: 10, modifier: 0 })).toEqual(rollDice(b, "2d10"));
    expect(rollDice(a, { count: 6, sides: 8, modifier: 10 })).toEqual(rollDice(b, "6d8+10"));
    const rng = createRng(1);
    expect(() => rollDice(rng, { count: 0, sides: 6, modifier: 0 })).toThrow(RangeError);
    expect(() => rollDice(rng, { count: 1, sides: 1001, modifier: 0 })).toThrow(RangeError);
    expect(() => rollDice(rng, { count: 1.5, sides: 6, modifier: 0 })).toThrow(RangeError);
    expect(() => rollDice(rng, { count: 1, sides: 6, modifier: 10000 })).toThrow(RangeError);
    expect(() => rollDice(rng, { count: 0, sides: 0, modifier: -1 })).toThrow(RangeError);
    expect(() => rollDice(rng, { count: 0, sides: 0, modifier: 10000 })).toThrow(RangeError);
    expect(() => rollDice(rng, { count: 0, sides: 0, modifier: 1.5 })).toThrow(RangeError);
    expect(() => rollDice(rng, { count: -1, sides: 6, modifier: 0 })).toThrow(RangeError);
    // -0 は 0 に正規化して返す
    const z = rollDice(createRng(1), { count: -0, sides: -0, modifier: 3 });
    expect(Object.is(z.spec.count, 0)).toBe(true);
    expect(Object.is(z.spec.sides, 0)).toBe(true);
    expect(z.total).toBe(3);
    expect(Object.is(rollDice(createRng(1), { count: 1, sides: 6, modifier: -0 }).spec.modifier, 0)).toBe(true);
  });
});
