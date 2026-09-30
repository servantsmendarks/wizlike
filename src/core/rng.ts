// シード付き乱数とダイス記法。core の乱数はすべてここを通す（CLAUDE.md §3-3）。
// Math.random / Date / タイマー / DOM は使わない。状態はプレーンオブジェクトで、JSON にそのまま保存できる。
// ダイス記法の唯一の定義もここに置く。文法は次の 2 形だけ（空白不可、先頭ゼロ不可、小文字 d のみ）:
//   ダイス形 "NdM[+-K]"  … count 1..100、sides 1..1000、|K| 0..9999（例 "2d10", "1d8+2", "3d6-1"）
//   定数形   "N"         … 0..9999、符号なし（例 "0", "1"）。振らずに N を返し、乱数を消費しない。

const TWO_POW_32 = 0x1_0000_0000;

/** 乱数の状態。xoshiro128** の 4 語（各 0..2^32-1、全ゼロ不可）。JSON にそのまま保存できる。 */
export type RngState = { algo: "xoshiro128**"; s: [number, number, number, number] };

/**
 * splitmix32（1 語ぶん進めて出力する）。
 * 定数: 加算 0x9e3779b9、乗算 0x21f0aaad / 0x735a2d97、シフト 16 / 15 / 15
 * （JS で広く使われている 32 ビット版 splitmix32 と同じ）。
 * 返り値は [次の内部状態, 出力]。
 */
function splitmix32(state: number): [number, number] {
  const next = (state + 0x9e3779b9) >>> 0;
  let z = next;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
  z = (z ^ (z >>> 15)) >>> 0;
  return [next, z];
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/** シード（整数）から乱数状態を作る。seed >>> 0 を splitmix32 で 4 語に展開する。 */
export function createRng(seed: number): RngState {
  if (!Number.isInteger(seed)) throw new RangeError(`seed must be an integer: ${seed}`);
  let x = seed >>> 0;
  const s: [number, number, number, number] = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    const [nx, out] = splitmix32(x);
    x = nx;
    s[i] = out;
  }
  if (s[0] === 0 && s[1] === 0 && s[2] === 0 && s[3] === 0) s[0] = 1;
  return { algo: "xoshiro128**", s };
}

/** xoshiro128** で 1 語進める。rng.s をその場で更新し、[0, 2^32) の整数を返す。 */
export function nextUint32(rng: RngState): number {
  const s = rng.s;
  const result = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
  const t = (s[1] << 9) >>> 0;
  s[2] = (s[2] ^ s[0]) >>> 0;
  s[3] = (s[3] ^ s[1]) >>> 0;
  s[1] = (s[1] ^ s[2]) >>> 0;
  s[0] = (s[0] ^ s[3]) >>> 0;
  s[2] = (s[2] ^ t) >>> 0;
  s[3] = rotl(s[3], 11);
  return result;
}

/** [0, 1) の浮動小数（nextUint32 / 2^32）。 */
export function nextFloat(rng: RngState): number {
  return nextUint32(rng) / TWO_POW_32;
}

/**
 * min 以上 max 以下（両端含む）の整数。棄却法で偏りなし。
 * 非整数（安全な整数でない）・min > max・幅 > 2^32 は RangeError。
 */
export function randInt(rng: RngState, min: number, max: number): number {
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max)) {
    throw new RangeError(`randInt: bounds must be safe integers: ${min}, ${max}`);
  }
  if (min > max) throw new RangeError(`randInt: min > max: ${min}, ${max}`);
  const width = max - min + 1;
  if (width > TWO_POW_32) throw new RangeError(`randInt: range too wide: ${min}, ${max}`);
  if (width === TWO_POW_32) return min + nextUint32(rng);
  // limit は width の倍数のうち 2^32 以下で最大のもの。これ以上の値は捨てて引き直す。
  const limit = TWO_POW_32 - (TWO_POW_32 % width);
  for (;;) {
    const u = nextUint32(rng);
    if (u < limit) return min + (u % width);
  }
}

/** sides 面ダイスを 1 個振る（randInt(rng, 1, sides)）。 */
export function rollDie(rng: RngState, sides: number): number {
  return randInt(rng, 1, sides);
}

/**
 * percent % の確率で true。randInt(rng, 1, 100) <= percent。
 * percent が 0 や 100 でも必ず 1 回 randInt を呼ぶ（消費数を値に依存させない）。NaN は RangeError。
 */
export function chance(rng: RngState, percent: number): boolean {
  if (Number.isNaN(percent)) throw new RangeError("chance: percent is NaN");
  return randInt(rng, 1, 100) <= percent;
}

/** 独立したコピーを返す。 */
export function cloneRng(rng: RngState): RngState {
  // >>> 0 で -0 を 0 に正規化する（isRngState を通った値なら、変わるのは -0 だけ）。
  return { algo: rng.algo, s: [rng.s[0] >>> 0, rng.s[1] >>> 0, rng.s[2] >>> 0, rng.s[3] >>> 0] };
}

/** 保存データなど未知の値が正しい RngState か（algo 一致、s は長さ 4 の 0..2^32-1 の整数、全ゼロでない）。 */
export function isRngState(x: unknown): x is RngState {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return false;
  const o = x as { algo?: unknown; s?: unknown };
  if (o.algo !== "xoshiro128**") return false;
  if (!Array.isArray(o.s) || o.s.length !== 4) return false;
  let nonZero = false;
  for (const v of o.s as unknown[]) {
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v >= TWO_POW_32) return false;
    if (v !== 0) nonZero = true;
  }
  return nonZero;
}

/** 保存からの復元。isRngState で検証して新しいコピーを返す。不正なら Error。 */
export function restoreRng(x: unknown): RngState {
  if (!isRngState(x)) throw new Error("restoreRng: invalid RngState");
  return cloneRng(x);
}

// ---- ダイス記法 ----

/**
 * ダイス記法を解釈した結果。"2d10+3" → { count: 2, sides: 10, modifier: 3 }。
 * count 0 は「ダイスを振らない定数」を表す（sides 0、modifier が値）。"5" → { count: 0, sides: 0, modifier: 5 }。
 */
export type DiceSpec = { count: number; sides: number; modifier: number };

const MAX_COUNT = 100;
const MAX_SIDES = 1000;
const MAX_MODIFIER = 9999;
const DICE_RE = /^([1-9][0-9]*)d([1-9][0-9]*)([+-](?:0|[1-9][0-9]{0,3}))?$/;
const CONST_RE = /^(?:0|[1-9][0-9]{0,3})$/;

/** ダイス記法の解釈に失敗したときの例外。expr は入力文字列。 */
export class DiceParseError extends Error {
  readonly expr: string;
  constructor(expr: string, reason: string) {
    super(`invalid dice expression ${JSON.stringify(expr)}: ${reason}`);
    this.name = "DiceParseError";
    this.expr = expr;
  }
}

/**
 * ダイス記法を解釈する。不正なら DiceParseError。
 * ダイス形（例 "2d10", "1d8+2", "3d6-1"）: 小文字 d のみ、空白不可、先頭ゼロ不可、
 * count 1..100、sides 1..1000、|modifier| 0..9999。
 * 定数形（例 "0", "1", "9999"）: 0..9999、符号なし、先頭ゼロ不可 → { count: 0, sides: 0, modifier: N }。
 * "0d6"、"-1"、"+5"、"05"、"10000" は不正。
 */
export function parseDice(expr: string): DiceSpec {
  if (CONST_RE.test(expr)) return { count: 0, sides: 0, modifier: Number(expr) };
  const m = DICE_RE.exec(expr);
  if (!m) throw new DiceParseError(expr, "syntax");
  const count = Number(m[1]);
  const sides = Number(m[2]);
  const modifier = m[3] === undefined ? 0 : Number(m[3]);
  if (count > MAX_COUNT) throw new DiceParseError(expr, `count must be 1..${MAX_COUNT}`);
  if (sides > MAX_SIDES) throw new DiceParseError(expr, `sides must be 1..${MAX_SIDES}`);
  // |modifier| <= 9999 は正規表現で保証済み。-0 は 0 に正規化する。
  return { count, sides, modifier: modifier === 0 ? 0 : modifier };
}

/** 正しいダイス記法（ダイス形または定数形）なら true。 */
export function isDiceExpr(expr: string): boolean {
  try {
    parseDice(expr);
    return true;
  } catch {
    return false;
  }
}

/**
 * 正規形の文字列にする。modifier 0 は省略（"2d10"）、正は "+2"、負は "-1"。
 * 定数（count 0）は String(modifier)（"0", "5"）。
 */
export function formatDice(spec: DiceSpec): string {
  if (spec.count === 0) return String(spec.modifier);
  const base = `${spec.count}d${spec.sides}`;
  if (spec.modifier === 0) return base;
  return spec.modifier > 0 ? `${base}+${spec.modifier}` : `${base}${spec.modifier}`;
}

/** 取りうる合計の範囲。count+modifier .. count*sides+modifier（定数 count 0 なら modifier .. modifier）。 */
export function diceRange(spec: DiceSpec): { min: number; max: number } {
  return { min: spec.count + spec.modifier, max: spec.count * spec.sides + spec.modifier };
}

/** ダイスを振った結果。dice は振った順、total = 合計 + modifier（クランプしない。クランプは呼び出し側）。 */
export type DiceRoll = { spec: DiceSpec; dice: number[]; total: number };

/**
 * DiceSpec の範囲検査。count 0（定数）なら sides 0 かつ modifier 0..9999 の整数。
 * count 1..100 なら sides 1..1000、|modifier| <= 9999 の整数。それ以外は RangeError。
 */
function checkSpec(spec: DiceSpec): DiceSpec {
  const ok =
    spec.count === 0
      ? spec.sides === 0 && Number.isInteger(spec.modifier) && spec.modifier >= 0 && spec.modifier <= MAX_MODIFIER
      : Number.isInteger(spec.count) && spec.count >= 1 && spec.count <= MAX_COUNT &&
        Number.isInteger(spec.sides) && spec.sides >= 1 && spec.sides <= MAX_SIDES &&
        Number.isInteger(spec.modifier) && Math.abs(spec.modifier) <= MAX_MODIFIER;
  if (!ok) throw new RangeError(`invalid DiceSpec: ${JSON.stringify(spec)}`);
  // -0 は 0 に正規化する（parseDice と揃える）。
  return {
    count: spec.count === 0 ? 0 : spec.count,
    sides: spec.sides === 0 ? 0 : spec.sides,
    modifier: spec.modifier === 0 ? 0 : spec.modifier,
  };
}

/**
 * ダイスを振る。rollDie をちょうど count 回、順に呼ぶ。
 * 定数（count 0）は dice: []、total: modifier を返し、乱数を 1 つも消費しない。
 * 文字列が不正なら DiceParseError、DiceSpec が範囲外なら RangeError。
 */
export function rollDice(rng: RngState, expr: string | DiceSpec): DiceRoll {
  const spec = typeof expr === "string" ? parseDice(expr) : checkSpec(expr);
  const dice: number[] = [];
  let sum = 0;
  for (let i = 0; i < spec.count; i++) {
    const d = rollDie(rng, spec.sides);
    dice.push(d);
    sum += d;
  }
  return { spec, dice, total: sum + spec.modifier };
}
