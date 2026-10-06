// UI-63 / UI-64 / UI-65 / UI-60: vite.config.ts のプラグイン wizlike-assets（ビルド時と開発サーバーの起動時に
// assets/music・assets/sfx・public/sprites を検証して仮想モジュール virtual:wizlike-assets にする）。
// @types/node は入れていないので node の型は手で書き、vite.config.ts と node:fs は文字列の動的 import で読む（pwa.test.ts と同じ）。
import { afterEach, describe, expect, test, vi } from "vitest";
import { buildSong, conformingSong, songParts } from "./helpers/midi";

type NodeFs = {
  mkdtempSync(prefix: string): string;
  mkdirSync(p: string, o: { recursive: true }): void;
  writeFileSync(p: string, s: string | Uint8Array): void;
  cpSync(src: URL, dst: string, o: { recursive: true }): void;
  rmSync(p: string, o: { recursive: true; force: true }): void;
};
type AssetsPlugin = {
  name: string;
  configResolved(c: { root: string }): void;
  resolveId(id: string): string | undefined;
  load(id: string): string | undefined;
};
const NODE_FS = "node:fs";
const NODE_OS = "node:os";
const nfs = (await import(/* @vite-ignore */ NODE_FS)) as NodeFs;
const nos = (await import(/* @vite-ignore */ NODE_OS)) as { tmpdir(): string };
const viteModule = (await import(/* @vite-ignore */ new URL("../vite.config.ts", import.meta.url).href)) as {
  default: (env: { command: "build" | "serve"; mode: string }) => { plugins: { name: string }[] };
  gameAssets: (o?: { scanInVitest?: boolean }) => AssetsPlugin;
};

const NODE_PATH = "node:path";
const npath = (await import(/* @vite-ignore */ NODE_PATH)) as { resolve(...p: string[]): string };
const VIRTUAL = "virtual:wizlike-assets";
const RESOLVED = "\0virtual:wizlike-assets";
const roots: string[] = [];

/** 一時の root に実データ（data/）を写し、files（root からの相対パス → 中身）を置く */
function makeRoot(files: Record<string, string | Uint8Array> = {}): string {
  const root = nfs.mkdtempSync(`${nos.tmpdir()}/wizlike-assets-`);
  roots.push(root);
  nfs.cpSync(new URL("../data", import.meta.url), `${root}/data`, { recursive: true });
  for (const [p, body] of Object.entries(files)) {
    const full = `${root}/${p}`;
    nfs.mkdirSync(full.slice(0, full.lastIndexOf("/")), { recursive: true });
    nfs.writeFileSync(full, body);
  }
  return root;
}

/** load の返す `export default {...};` の中身 */
function loaded(p: AssetsPlugin): { music: Record<string, unknown>; sfx: Record<string, unknown>; sprites: Record<string, unknown>; town: Record<string, unknown> } {
  const code = p.load(RESOLVED) ?? "";
  const m = /^export default (.*);$/s.exec(code);
  if (!m) throw new Error(`unexpected module: ${code}`);
  return JSON.parse(m[1]!);
}

afterEach(() => {
  for (const r of roots.splice(0)) nfs.rmSync(r, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("UI-64 vite.config.ts のプラグイン wizlike-assets", () => {
  test("UI-64 vite.config.ts の plugins に wizlike-assets がある（build と serve の両方。apply を付けない）", () => {
    for (const command of ["build", "serve"] as const) {
      const names = viteModule.default({ command, mode: "x" }).plugins.map((p) => p.name);
      expect(names).toContain("wizlike-assets");
    }
    expect((viteModule.gameAssets() as { apply?: unknown }).apply).toBeUndefined();
  });

  test("UI-64 vitest の中（VITEST）では configResolved で何もしない（壊れた素材で全テストが巻き添えにならない）", () => {
    const p = viteModule.gameAssets();
    const root = makeRoot({ "assets/music/town.mid": new Uint8Array([1, 2, 3]) });
    expect(() => p.configResolved({ root })).not.toThrow();
    expect(loaded(p)).toEqual({ music: {}, sfx: {}, sprites: {}, town: {} });
  });

  test("UI-63 素材が無ければ（assets/ も public/sprites も無い）空の仮想モジュールで、エラーも警告も出さない", () => {
    const p = viteModule.gameAssets({ scanInVitest: true });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    p.configResolved({ root: makeRoot() });
    expect(p.resolveId(VIRTUAL)).toBe(RESOLVED);
    expect(p.resolveId("virtual:other")).toBeUndefined();
    expect(p.load("virtual:other")).toBeUndefined();
    expect(loaded(p)).toEqual({ music: {}, sfx: {}, sprites: {}, town: {} });
    expect(err).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  test("UI-63 規約どおりの曲・効果音・絵は仮想モジュールに入る", () => {
    const p = viteModule.gameAssets({ scanInVitest: true });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 48, 0, 0, 0, 48, 8, 3, 0, 0, 0, 0, 0, 0, 0]);
    p.configResolved({
      root: makeRoot({
        "assets/music/town.mid": conformingSong(),
        "assets/sfx/hit.json": '{ "name": "hit", "params": [null, 0.05, 220] }',
        "public/sprites/giant_rat.png": png,
      }),
    });
    const a = loaded(p);
    expect(Object.keys(a.music)).toEqual(["town"]);
    expect(a.sfx).toEqual({ hit: { name: "hit", params: [null, 0.05, 220] } });
    expect(a.sprites).toEqual({ giant_rat: { w: 48, h: 48 } });
  });

  test("UI-61 public/town の 240×150 の PNG は仮想モジュールの town に入る（大きさの違う絵は警告して入れない）", () => {
    const p = viteModule.gameAssets({ scanInVitest: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const u32 = (n: number): number[] => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
    const png = (w: number, h: number): Uint8Array =>
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...u32(w), ...u32(h), 8, 3, 0, 0, 0, 0, 0, 0, 0]);
    p.configResolved({ root: makeRoot({ "public/town/inn.png": png(240, 150), "public/town/shop.png": png(48, 48) }) });
    expect(loaded(p).town).toEqual({ inn: { w: 240, h: 150 } });
    expect(warn.mock.calls.map((c) => String(c[0])).join("\n")).toContain("warning: public/town/shop.png: UI-61/P04 ");
  });

  test("UI-64 壊れた MIDI があれば configResolved で throw し（build・dev・preview が止まる）、ファイル名と項目 ID と理由を出す", () => {
    const p = viteModule.gameAssets({ scanInVitest: true });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = songParts();
    bad.format = 0;
    const root = makeRoot({ "assets/music/town.mid": new Uint8Array([1, 2, 3]), "assets/music/battle1.mid": buildSong(bad) });
    expect(() => p.configResolved({ root })).toThrow(/wizlike-assets: 2 error\(s\)[\s\S]*assets\/music\/battle1.mid: UI-64\/L01 /);
    const out = err.mock.calls.map((c) => String(c[0])).join("\n");
    expect(out).toContain("assets/music/battle1.mid: UI-64/L01 SMF format must be 1, got 0");
    expect(out).toMatch(/assets\/music\/town\.mid: UI-64\/E02 /);
  });

  test("UI-64 警告だけなら止めずに console.warn に出す", () => {
    const p = viteModule.gameAssets({ scanInVitest: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    p.configResolved({ root: makeRoot({ "assets/music/notes.txt": "x" }) });
    expect(warn.mock.calls.map((c) => String(c[0])).join("\n")).toContain("warning: assets/music/notes.txt: UI-64/W07 ");
  });

  test("UI-63 data/*.json が不正なら同じく止める（検証は loadGameData）", () => {
    const p = viteModule.gameAssets({ scanInVitest: true });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const root = makeRoot();
    nfs.writeFileSync(`${root}/data/audio.json`, '{ "music": {} }');
    expect(() => p.configResolved({ root })).toThrow(/audio\.json/);
  });
});

describe("UI-61 開発サーバーの素材の見張り（B3。M8.5）", () => {
  const watchTargets = (viteModule as unknown as { watchTargets: (root: string, dirs: readonly string[]) => string[] }).watchTargets;
  const dirsOf = (root: string): string[] => ["assets/music", "assets/sfx", "public/sprites", "public/town"].map((d) => npath.resolve(root, d));

  test("UI-61 watchTargets: 在るディレクトリはそのまま見張り、無いものは root の中で在るいちばん近い親（無ければ root）に置き換える（chokidar に無いパスを足さない）", () => {
    const root = makeRoot({ "public/fonts/x.txt": "x", "assets/music/town.mid": conformingSong() });
    expect(watchTargets(root, dirsOf(root))).toEqual([npath.resolve(root, "assets/music"), npath.resolve(root, "assets"), npath.resolve(root, "public")]);
    const bare = makeRoot();
    expect(watchTargets(bare, dirsOf(bare))).toEqual([npath.resolve(bare)]);
    const full = makeRoot({ "assets/music/a.txt": "x", "assets/sfx/a.txt": "x", "public/sprites/a.txt": "x", "public/town/a.txt": "x" });
    expect(watchTargets(full, dirsOf(full))).toEqual(dirsOf(full));
  });

  test("UI-61 configureServer は watchTargets のパスだけを見張りに足す（無いディレクトリを直接 add しない）", () => {
    const src = (nfs as unknown as { readFileSync(p: URL, e: "utf8"): string }).readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
    const body = /configureServer\(server\) \{([\s\S]*?)\n {4}\},/.exec(src)?.[1] ?? "";
    expect(body).toContain("server.watcher.add(watchTargets(root, dirs));");
    expect(body.match(/server\.watcher\.add\(/g)).toHaveLength(1);
  });
});
