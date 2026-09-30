// 検証の小道具。問題は投げずに ctx.issues へ積み、最後にまとめて報告する。
// 各関数は「値が期待どおりならその値、そうでなければ undefined」を返す。
// 必須フィールドの欠落は、値が undefined のときに各関数が "missing required field" として報告する。

import { isDiceExpr } from "../rng";

export type Ctx = { readonly file: string; readonly issues: string[] };
export type Obj = Record<string, unknown>;

export function at(path: string, key: string | number): string {
  if (typeof key === "number") return `${path}[${key}]`;
  return path === "" ? key : `${path}.${key}`;
}

export function report(ctx: Ctx, path: string, msg: string): void {
  ctx.issues.push(`${ctx.file}: ${path === "" ? "(root)" : path}: ${msg}`);
}

export function typeName(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : Number.isFinite(v) ? "number" : String(v);
  return typeof v;
}

function show(v: unknown): string {
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number" || typeof v === "boolean" || v === null) return String(v);
  return typeName(v);
}

export function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function missing(ctx: Ctx, path: string, v: unknown): boolean {
  if (v === undefined) {
    report(ctx, path, "missing required field");
    return true;
  }
  return false;
}

/** オブジェクトであることと、allowed 以外のキーが無いことを検査する。 */
export function obj(ctx: Ctx, path: string, v: unknown, allowed: readonly string[] | null): Obj | undefined {
  if (missing(ctx, path, v)) return undefined;
  if (!isObj(v)) {
    report(ctx, path, `expected object, got ${typeName(v)}`);
    return undefined;
  }
  if (allowed !== null) {
    for (const k of Object.keys(v)) {
      if (!allowed.includes(k)) report(ctx, at(path, k), "unknown field");
    }
  }
  return v;
}

export function list(ctx: Ctx, path: string, v: unknown, minLen = 0): unknown[] | undefined {
  if (missing(ctx, path, v)) return undefined;
  if (!Array.isArray(v)) {
    report(ctx, path, `expected array, got ${typeName(v)}`);
    return undefined;
  }
  if (v.length < minLen) report(ctx, path, `expected at least ${minLen} element(s), got ${v.length}`);
  return v;
}

export function str(ctx: Ctx, path: string, v: unknown, nonEmpty = true): string | undefined {
  if (missing(ctx, path, v)) return undefined;
  if (typeof v !== "string") {
    report(ctx, path, `expected string, got ${typeName(v)}`);
    return undefined;
  }
  if (nonEmpty && v === "") {
    report(ctx, path, "expected non-empty string");
    return undefined;
  }
  return v;
}

export function bool(ctx: Ctx, path: string, v: unknown): boolean | undefined {
  if (missing(ctx, path, v)) return undefined;
  if (typeof v !== "boolean") {
    report(ctx, path, `expected boolean, got ${typeName(v)}`);
    return undefined;
  }
  return v;
}

export type Range = { min?: number; max?: number; positive?: boolean };

function rangeText(r: Range): string {
  if (r.min !== undefined && r.max !== undefined) return r.min === r.max ? ` equal to ${r.min}` : ` in ${r.min}..${r.max}`;
  if (r.positive) return " > 0";
  if (r.min !== undefined) return ` >= ${r.min}`;
  if (r.max !== undefined) return ` <= ${r.max}`;
  return "";
}

function inRange(n: number, r: Range): boolean {
  if (r.positive && !(n > 0)) return false;
  if (r.min !== undefined && n < r.min) return false;
  if (r.max !== undefined && n > r.max) return false;
  return true;
}

export function int(ctx: Ctx, path: string, v: unknown, r: Range = {}): number | undefined {
  if (missing(ctx, path, v)) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v)) {
    report(ctx, path, `expected integer${rangeText(r)}, got ${typeName(v)}`);
    return undefined;
  }
  if (!inRange(v, r)) {
    report(ctx, path, `expected integer${rangeText(r)}, got ${v}`);
    return undefined;
  }
  return v;
}

export function num(ctx: Ctx, path: string, v: unknown, r: Range = {}): number | undefined {
  if (missing(ctx, path, v)) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v)) {
    report(ctx, path, `expected number${rangeText(r)}, got ${typeName(v)}`);
    return undefined;
  }
  if (!inRange(v, r)) {
    report(ctx, path, `expected number${rangeText(r)}, got ${v}`);
    return undefined;
  }
  return v;
}

export const PERCENT: Range = { min: 0, max: 100 };
export const RATIO: Range = { min: 0, max: 1 };
export const NON_NEG: Range = { min: 0 };
export const POS_INT: Range = { min: 1 };

export function oneOf<T extends string>(ctx: Ctx, path: string, v: unknown, values: readonly T[]): T | undefined {
  if (missing(ctx, path, v)) return undefined;
  if (typeof v !== "string" || !(values as readonly string[]).includes(v)) {
    report(ctx, path, `expected one of ${values.join("|")}, got ${show(v)}`);
    return undefined;
  }
  return v as T;
}

/** ダイス記法のフィールド。文法は rng.ts の isDiceExpr（ダイス形 "NdM[+-K]" と定数形 "N"）が唯一の定義。 */
export function dice(ctx: Ctx, path: string, v: unknown): string | undefined {
  const s = str(ctx, path, v, false);
  if (s === undefined) return undefined;
  if (!isDiceExpr(s)) {
    report(ctx, path, `invalid dice expression ${JSON.stringify(s)}`);
    return undefined;
  }
  return s;
}

/** 文字列の配列。各要素を each で検査する（省略時は空でない文字列）。 */
export function strList(
  ctx: Ctx,
  path: string,
  v: unknown,
  each: (p: string, s: string) => void = () => {},
): string[] | undefined {
  const a = list(ctx, path, v);
  if (a === undefined) return undefined;
  a.forEach((e, i) => {
    const s = str(ctx, at(path, i), e);
    if (s !== undefined) each(at(path, i), s);
  });
  return a as string[];
}

/** 参照先が存在するか。v が文字列でなければ（型エラーは別に報告済みとして）何もしない。 */
export function ref(ctx: Ctx, path: string, v: unknown, ids: ReadonlySet<string> | ReadonlyMap<string, unknown>, what: string): void {
  if (typeof v === "string" && !ids.has(v)) report(ctx, path, `unknown ${what} id ${JSON.stringify(v)}`);
}

/** 配列要素の id の重複を報告する。 */
export function uniqueIds(ctx: Ctx, path: string, arr: readonly unknown[], key = "id"): void {
  const seen = new Map<string, number>();
  arr.forEach((e, i) => {
    if (!isObj(e)) return;
    const id = e[key];
    if (typeof id !== "string") return;
    const first = seen.get(id);
    if (first !== undefined) report(ctx, at(at(path, i), key), `duplicate ${key} ${JSON.stringify(id)} (first at [${first}])`);
    else seen.set(id, i);
  });
}
