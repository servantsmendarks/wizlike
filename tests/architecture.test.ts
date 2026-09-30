// CLAUDE.md §3 のうち、ソースを読めば機械的に確かめられるものを検査する。
// - §3-1: core は DOM / Web API / タイマー / Math.random / Date を使わず、core 内と data/ の型しか import しない。
//   （DOM の型そのものは tsconfig.core.json の lib ES2022 で typecheck が弾く。ここでは名前で検出する。）
// - §3-10: presenter と表示層の入口 src/main.ts の文字列リテラルに日本語を書かない（文言は data/strings.json）。
import { describe, expect, test } from "vitest";

const coreSources = import.meta.glob("../src/core/**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const presenterSources = import.meta.glob(["../src/presenter/**/*.ts", "../src/main.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

// ---------------------------------------------------------------------------
// 字句解析（最小限）: コメントと文字列リテラルを見分ける。
// 正規表現リテラルは、直前の意味のある文字から推定する（'/' が除算か正規表現か）。
// 直前が ++ / -- なら除算とみなす（i++ / 2）。直前が ) なら常に除算とみなすので、
// `if (x) /re/.test(s)` のように ) の直後に置いた正規表現リテラルは誤判定する（そう書かないこと）。

type Lexed = {
  /** コメントを空白に置き換えたソース（改行は残す）。 */
  code: string;
  /** 文字列リテラルの中身（' " ` の内側。テンプレートは ${...} の外側の部分）。 */
  strings: string[];
};

const REGEX_PREFIX = /[(,=:[!&|?{};+\-*%<>~^]$/;
const REGEX_KEYWORD_PREFIX = /\b(return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/;

function blank(s: string): string {
  return s.replace(/[^\n]/g, " ");
}

function lex(src: string): Lexed {
  let code = "";
  const strings: string[] = [];
  // テンプレートリテラルの ${ } の入れ子。値は、その式の中の { の深さ。
  const templateStack: number[] = [];
  let i = 0;
  const n = src.length;

  const lastSignificant = (): string => code.replace(/\s+$/, "");

  const readTemplate = (): void => {
    // src[i] は ` または } の次。テンプレート本体を ` か ${ まで読む。
    let buf = "";
    while (i < n) {
      const c = src[i]!;
      if (c === "\\") {
        buf += src.slice(i, i + 2);
        code += src.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (c === "`") {
        code += c;
        i++;
        strings.push(buf);
        return;
      }
      if (c === "$" && src[i + 1] === "{") {
        code += "${";
        i += 2;
        strings.push(buf);
        templateStack.push(0);
        return;
      }
      buf += c;
      code += c;
      i++;
    }
    strings.push(buf);
  };

  while (i < n) {
    const c = src[i]!;
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      const end = src.indexOf("\n", i);
      const stop = end === -1 ? n : end;
      code += blank(src.slice(i, stop));
      i = stop;
    } else if (c === "/" && d === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      code += blank(src.slice(i, stop));
      i = stop;
    } else if (c === "'" || c === '"') {
      let j = i + 1;
      let buf = "";
      while (j < n && src[j] !== c && src[j] !== "\n") {
        if (src[j] === "\\") {
          buf += src.slice(j, j + 2);
          j += 2;
        } else {
          buf += src[j];
          j++;
        }
      }
      strings.push(buf);
      code += src.slice(i, j + 1);
      i = j + 1;
    } else if (c === "`") {
      code += c;
      i++;
      readTemplate();
    } else if (c === "/") {
      const prev = lastSignificant();
      const afterIncDec = /(\+\+|--)$/.test(prev);
      if (!afterIncDec && (prev === "" || REGEX_PREFIX.test(prev) || REGEX_KEYWORD_PREFIX.test(prev))) {
        // 正規表現リテラル。文字クラス内の / は終端ではない。
        let j = i + 1;
        let inClass = false;
        while (j < n && src[j] !== "\n") {
          const r = src[j]!;
          if (r === "\\") {
            j += 2;
            continue;
          }
          if (r === "[") inClass = true;
          else if (r === "]") inClass = false;
          else if (r === "/" && !inClass) break;
          j++;
        }
        code += src.slice(i, j + 1);
        i = j + 1;
      } else {
        code += c;
        i++;
      }
    } else if (templateStack.length > 0 && c === "{") {
      templateStack[templateStack.length - 1]!++;
      code += c;
      i++;
    } else if (templateStack.length > 0 && c === "}") {
      code += c;
      i++;
      const depth = templateStack[templateStack.length - 1]!;
      if (depth === 0) {
        templateStack.pop();
        readTemplate();
      } else {
        templateStack[templateStack.length - 1] = depth - 1;
      }
    } else {
      code += c;
      i++;
    }
  }
  return { code, strings };
}

// ---------------------------------------------------------------------------
// §3-1 の禁止語。

// 行単位で検査する識別子。Math.random は書き方（改行・?.・ブラケット・別名）が多いので下で別に検査する。
const FORBIDDEN: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: "Date", re: /\bDate\b/ },
  { name: "setTimeout", re: /\bsetTimeout\b/ },
  { name: "setInterval", re: /\bsetInterval\b/ },
  { name: "requestAnimationFrame", re: /\brequestAnimationFrame\b/ },
  { name: "window", re: /\bwindow\b/ },
  { name: "document", re: /\bdocument\b/ },
  { name: "localStorage", re: /\blocalStorage\b/ },
  { name: "sessionStorage", re: /\bsessionStorage\b/ },
  { name: "indexedDB", re: /\bindexedDB\b/ },
  { name: "fetch", re: /\bfetch\b/ },
  { name: "XMLHttpRequest", re: /\bXMLHttpRequest\b/ },
  { name: "performance", re: /\bperformance\b/ },
  { name: "navigator", re: /\bnavigator\b/ },
  { name: "crypto", re: /\bcrypto\b/ },
];

// コメントを除いたコード全体（改行を含む）に当てる。\s は改行にも一致する。
// - Math.random / Math?.random / Math\n.random / Math["random"] / Math?.["random"]
// - 別名や分割代入（const M = Math、const { random } = Math）は追えないので、
//   Math の後ろにプロパティ名の . アクセスが続かない参照（素の Math）そのものを違反にする。
const WHOLE_CODE_FORBIDDEN: ReadonlyArray<{ name: string; re: RegExp }> = [
  {
    name: "Math.random",
    re: /\bMath\s*(?:\?\.|\.)\s*random\b|\bMath\s*(?:\?\.)?\s*\[\s*["'`]random["'`]\s*\]/g,
  },
  {
    name: "Math (bare reference)",
    re: /\bMath\b(?!\s*(?:\?\.|\.)\s*[A-Za-z_$])(?!\s*(?:\?\.)?\s*\[\s*["'`]random["'`])/g,
  },
];

function forbiddenUses(src: string): string[] {
  const code = lex(src).code;
  const found: Array<{ line: number; name: string }> = [];
  code.split("\n").forEach((line, idx) => {
    for (const f of FORBIDDEN) if (f.re.test(line)) found.push({ line: idx + 1, name: f.name });
  });
  for (const f of WHOLE_CODE_FORBIDDEN) {
    for (const m of code.matchAll(f.re)) {
      found.push({ line: code.slice(0, m.index).split("\n").length, name: f.name });
    }
  }
  return found.sort((a, b) => a.line - b.line).map((f) => `${f.line}: ${f.name}`);
}

/** 三斜線ディレクティブ（/// <reference lib="dom" /> など）。lex はコメントを消すので生テキストで探す。 */
function referenceDirectives(src: string): string[] {
  const out: string[] = [];
  src.split("\n").forEach((line, idx) => {
    if (/^\s*\/\/\/\s*<reference\b/.test(line)) out.push(`${idx + 1}: ${line.trim()}`);
  });
  return out;
}

// ---------------------------------------------------------------------------
// §3-1 の import 制限。

type ImportRef = { spec: string; typeOnly: boolean; dynamic: boolean };

function importsOf(src: string): ImportRef[] {
  const { code } = lex(src);
  const refs: ImportRef[] = [];
  const stmt = /^[ \t]*(import|export)\b([^;]*?)\bfrom\s*(["'])([^"'\n]+)\3/gm;
  for (const m of code.matchAll(stmt)) {
    // import type { } / export type { } / import type{ }（空白なし）は型だけ。import { type A } は値の import として扱う。
    refs.push({ spec: m[4]!, typeOnly: /^\s*type\b/.test(m[2]!), dynamic: false });
  }
  const bare = /^[ \t]*import\s*(["'])([^"'\n]+)\1/gm;
  for (const m of code.matchAll(bare)) refs.push({ spec: m[2]!, typeOnly: false, dynamic: false });
  const dyn = /\b(import|require)\s*\(/g;
  for (const m of code.matchAll(dyn)) refs.push({ spec: `${m[1]}(...)`, typeOnly: false, dynamic: true });
  return refs;
}

/** "../src/core/x.ts" のような glob のキーを、リポジトリ相対 "src/core/x.ts" にする。 */
function repoPath(globKey: string): string {
  return globKey.replace(/^\.\.\//, "");
}

function normalize(path: string): string | null {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length === 0) return null; // リポジトリの外
      out.pop();
    } else out.push(part);
  }
  return out.join("/");
}

function resolveRelative(fromFile: string, spec: string): string | null {
  if (!spec.startsWith("./") && !spec.startsWith("../")) return null;
  const dir = fromFile.slice(0, fromFile.lastIndexOf("/"));
  return normalize(`${dir}/${spec}`);
}

function importViolations(file: string, src: string, coreFiles: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const ref of importsOf(src)) {
    if (ref.dynamic) {
      out.push(`${ref.spec}: dynamic import / require is not allowed in core`);
      continue;
    }
    const target = resolveRelative(file, ref.spec);
    if (target === null) {
      out.push(`"${ref.spec}": core may only import relative paths inside src/core or data/ types`);
      continue;
    }
    if (target.startsWith("src/core/")) {
      // moduleResolution bundler では "./x.js" が x.ts に解決される。
      const tsOfJs = target.endsWith(".js") ? `${target.slice(0, -3)}.ts` : null;
      const exists =
        coreFiles.has(target) ||
        coreFiles.has(`${target}.ts`) ||
        coreFiles.has(`${target}/index.ts`) ||
        (tsOfJs !== null && coreFiles.has(tsOfJs));
      if (!exists) out.push(`"${ref.spec}": does not resolve to a file in src/core`);
      continue;
    }
    if (target.startsWith("data/")) {
      if (!ref.typeOnly) out.push(`"${ref.spec}": core may import data/ with "import type" only`);
      continue;
    }
    out.push(`"${ref.spec}": resolves outside src/core (${target})`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// §3-10 の日本語検出（ひらがな、カタカナ、CJK 統合漢字と拡張 A、CJK 記号、全角形）。

const JAPANESE = /[　-〿぀-ゟ゠-ヿㇰ-ㇿ㐀-䶿一-鿿＀-￯]/;

function japaneseLiterals(src: string): string[] {
  return lex(src).strings.filter((s) => JAPANESE.test(s));
}

// ---------------------------------------------------------------------------

describe("CLAUDE.md §3-1 core の純粋性", () => {
  const entries = Object.entries(coreSources).map(([k, v]) => [repoPath(k), v] as const);
  const coreFiles = new Set(entries.map(([k]) => k));

  test("CLAUDE.md §3-1 core のソースを 1 件以上読めている", () => {
    expect(entries.length).toBeGreaterThan(0);
    expect(coreFiles.has("src/core/rng.ts")).toBe(true);
  });

  test("CLAUDE.md §3-1 §3-3 core に Math.random / Date / タイマー / Web API が無い", () => {
    const problems = entries.flatMap(([file, src]) => forbiddenUses(src).map((p) => `${file}:${p}`));
    expect(problems).toEqual([]);
  });

  test("CLAUDE.md §3-1 core に三斜線ディレクティブ（/// <reference>）が無い", () => {
    // /// <reference lib="dom" /> 1 つで tsconfig.core.json の DOM 型検査が core 全体で外れるため。
    const problems = entries.flatMap(([file, src]) => referenceDirectives(src).map((p) => `${file}:${p}`));
    expect(problems).toEqual([]);
  });

  test("CLAUDE.md §3-1 core は src/core 内と data/ の型だけを import する", () => {
    const problems = entries.flatMap(([file, src]) =>
      importViolations(file, src, coreFiles).map((p) => `${file}: ${p}`),
    );
    expect(problems).toEqual([]);
  });
});

describe("CLAUDE.md §3-10 presenter と main.ts に日本語の文字列リテラルが無い", () => {
  test("CLAUDE.md §3-10 presenter と main.ts のソースを読めている", () => {
    expect(Object.keys(presenterSources).length).toBeGreaterThan(1);
    expect(Object.keys(presenterSources).map(repoPath)).toContain("src/main.ts");
  });

  test("CLAUDE.md §3-10 presenter と main.ts の文字列リテラルに日本語が無い（コメントは除く）", () => {
    const problems = Object.entries(presenterSources).flatMap(([file, src]) =>
      japaneseLiterals(src).map((s) => `${repoPath(file)}: ${JSON.stringify(s)}`),
    );
    expect(problems).toEqual([]);
  });
});

describe("CLAUDE.md §3 検査器そのもの（誤検出と見逃しが無いこと）", () => {
  test("CLAUDE.md §3-1 コメント中の言及は無視し、コード中の使用は検出する", () => {
    const src = [
      "// Math.random は使わない",
      "/* setTimeout や",
      "   document も */",
      "const updatedAt = 1; // Date ではない",
      "const x = Math.random();",
      "const y = new Date();",
      "window.alert(1);",
      "const url = \"http://example.com\"; // 文字列中の // はコメントではない",
      "const z = globalThis.crypto;",
    ].join("\n");
    expect(forbiddenUses(src)).toEqual(["5: Math.random", "6: Date", "7: window", "9: crypto"]);
  });

  test("CLAUDE.md §3-1 識別子の一部（updatedAt, fetchCount, documentation）は禁止語にならない", () => {
    expect(forbiddenUses("const fetchCount = 0; const documentation = 1; const windowed = 2; const toDate = 3;")).toEqual([]);
  });

  test("CLAUDE.md §3-1 正規表現リテラル中の // や /* をコメントと誤認しない", () => {
    const src = "const re = /\\/\\/*x/;\nconst s = 1; setTimeout(f, 0);";
    expect(forbiddenUses(src)).toEqual(["2: setTimeout"]);
  });

  test("CLAUDE.md §3-1 §3-3 Math.random は改行・?.・ブラケット・別名でも検出する", () => {
    expect(forbiddenUses('Math["random"]();')).toEqual(["1: Math.random"]);
    expect(forbiddenUses("Math?.['random']();")).toEqual(["1: Math.random"]);
    expect(forbiddenUses("Math?.random();")).toEqual(["1: Math.random"]);
    expect(forbiddenUses("const a = 1;\nconst x = Math\n  .random();")).toEqual(["2: Math.random"]);
    expect(forbiddenUses("const M = Math; M.random();")).toEqual(["1: Math (bare reference)"]);
    expect(forbiddenUses("const { random } = Math;")).toEqual(["1: Math (bare reference)"]);
    expect(forbiddenUses("globalThis.Math.random();")).toEqual(["1: Math.random"]);
    // 他の Math のメソッドは可
    expect(forbiddenUses("const y = Math.imul(a, 5) + Math.floor(b) + Math\n  .abs(c);")).toEqual([]);
  });

  test("CLAUDE.md §3-1 三斜線ディレクティブを検出する", () => {
    expect(referenceDirectives('/// <reference lib="dom" />\nconst x = 1;')).toEqual(['1: /// <reference lib="dom" />']);
    expect(referenceDirectives('  ///<reference types="node"/>')).toHaveLength(1);
    expect(referenceDirectives("// <reference> ではない普通のコメント\nconst x = 1;")).toEqual([]);
  });

  test("CLAUDE.md §3-1 import の検査: core 内・data の型は可、npm・presenter・data の値は不可", () => {
    const files = new Set(["src/core/rng.ts", "src/core/data/index.ts", "src/core/data/types.ts"]);
    const ok = [
      'import { createRng } from "../rng";',
      'import type { GameData } from "./types";',
      'export * from "./types";',
      'import type Races from "../../../data/races.json";',
      'export type { Races2 } from "../../../data/races.json";',
      'import type{ Races3 } from "../../../data/races.json";',
      'import { createRng as c2 } from "../rng.js";',
    ].join("\n");
    expect(importViolations("src/core/data/index.ts", ok, files)).toEqual([]);

    const bad = [
      'import { defineConfig } from "vite";',
      'import { mountStage } from "../../presenter/stage";',
      'import races from "../../../data/races.json";',
      'import { x } from "./missing";',
      'import "../../main";',
      'const m = await import("./types");',
      'import { type A, b } from "../../../data/races.json";',
      'import { x } from "./missing.js";',
    ].join("\n");
    expect(importViolations("src/core/data/index.ts", bad, files)).toHaveLength(8);
  });

  test("CLAUDE.md §3-10 日本語の検出: 文字列とテンプレートは検出し、コメントは無視する", () => {
    const src = [
      "// 日本語のコメントは可",
      "/* ブロックコメントも可 */",
      'const a = "ok";',
      'const b = "こんにちは";',
      "const c = `n=${n}件`;",
      "const d = `${`入れ子`}`;",
      "const e = 'Ａ';",
      "const f = `x${ {a: 1}.a }y`;",
    ].join("\n");
    expect(japaneseLiterals(src)).toEqual(["こんにちは", "件", "入れ子", "Ａ"]);
  });

  test("CLAUDE.md §3-10 i++ / 2 の / を正規表現と誤認しない", () => {
    expect(japaneseLiterals('let h = i++ / 2; const s = "あ"; const t = "/";')).toEqual(["あ"]);
    expect(japaneseLiterals('let h = i-- / 2; const s = "い";')).toEqual(["い"]);
    expect(forbiddenUses('i++ / 2; const q = "/"; // Date')).toEqual([]);
    // 比較: 通常の正規表現リテラルは従来どおり
    expect(japaneseLiterals('const re = /"/; const s = "う";')).toEqual(["う"]);
  });
});
