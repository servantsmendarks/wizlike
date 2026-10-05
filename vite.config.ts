import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve, sep } from "node:path";
import { precacheUrls, renderServiceWorker } from "./src/pwa/sw-template.ts";
import { ASSET_DIRS, collectAssets, formatIssue, type AssetFiles } from "./src/build/assets.ts";
import type { GameAssets } from "./src/build/asset-types.ts";
import { DATA_FILES, loadGameData, type RawGameData } from "./src/core/data/index.ts";

const sha256 = (b: string | Buffer): string => createHash("sha256").update(b).digest("hex");

/** outDir の下のファイルを再帰で集め、"/" 区切りの相対パスで返す */
function listFiles(dir: string, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? listFiles(join(dir, d.name), `${prefix}${d.name}/`) : [`${prefix}${d.name}`],
  );
}

/**
 * SV-42: ビルドの最後（public のコピーの後）に dist のファイル一覧と中身の版を埋め込んだ sw.js を書く。
 * 依存パッケージを使わない（vite-plugin-pwa は使わない。CLAUDE.md §2）。apply build なので dev と vitest では動かない。
 */
function serviceWorker(): Plugin {
  let outDir = "dist";
  return {
    name: "wizlike-sw",
    apply: "build",
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    closeBundle() {
      const urls = precacheUrls(listFiles(outDir));
      // 版 = 各 url と中身の sha256 を url の昇順につないだものの sha256 の先頭 16 字
      const version = sha256(
        urls.map((u) => `${u}\n${sha256(readFileSync(join(outDir, u.slice(2))))}\n`).join(""),
      ).slice(0, 16);
      writeFileSync(join(outDir, "sw.js"), renderServiceWorker({ version, urls }));
      console.log(`wizlike-sw: sw.js version ${version}, ${urls.length} files`);
    },
  };
}

const VIRTUAL_ASSETS = "virtual:wizlike-assets";
const RESOLVED_ASSETS = "\0virtual:wizlike-assets";
const EMPTY_ASSETS: GameAssets = { music: {}, sfx: {}, sprites: {}, town: {} };

/** dir の直下のファイル名（無いディレクトリは空） */
function filesIn(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => d.name);
}

/**
 * root の data/*.json を loadGameData で検証し（不正なら GameDataError）、assets/music・assets/sfx・public/sprites・public/town を collectAssets で検証する。
 * 止めるものがあれば console.error に出してから throw（ファイル名と項目 ID と理由はエラーの文にも入れる）。警告は console.warn。
 */
function scanAssets(root: string): GameAssets {
  const raw = Object.fromEntries(
    Object.entries(DATA_FILES).map(([k, f]) => [k, JSON.parse(readFileSync(join(root, "data", f), "utf8")) as unknown]),
  ) as RawGameData;
  const data = loadGameData(raw);
  const dir = (k: keyof typeof ASSET_DIRS): string => join(root, ASSET_DIRS[k]);
  const files: AssetFiles = {
    music: filesIn(dir("music")).map((name) => ({ name, bytes: new Uint8Array(readFileSync(join(dir("music"), name))) })),
    sfx: filesIn(dir("sfx")).map((name) => ({ name, text: readFileSync(join(dir("sfx"), name), "utf8") })),
    sprites: filesIn(dir("sprites")).map((name) => ({ name, bytes: new Uint8Array(readFileSync(join(dir("sprites"), name))) })),
    town: filesIn(dir("town")).map((name) => ({ name, bytes: new Uint8Array(readFileSync(join(dir("town"), name))) })),
  };
  const r = collectAssets(files, data);
  for (const w of r.warnings) console.warn(`warning: ${formatIssue(w)}`);
  if (r.errors.length > 0) {
    const lines = r.errors.map(formatIssue);
    for (const l of lines) console.error(l);
    throw new Error([`wizlike-assets: ${r.errors.length} error(s)`, ...lines].join("\n"));
  }
  return r.assets;
}

/**
 * UI-63 / UI-64 / UI-65 / UI-60（M8）/ UI-61（M8.5）: 曲（assets/music/*.mid）・効果音（assets/sfx/*.json）・絵の一覧（public/sprites/*.png・public/town/*.png）を
 * ビルド時と開発サーバー・preview の起動時に検証し、仮想モジュール virtual:wizlike-assets（GameAssets）にする。
 * 止めるものが 1 つでもあれば configResolved で throw する（build・dev・preview が止まる）。apply を付けない（build と serve の両方）。
 * vitest の中（VITEST）では何もしない（テストは scanInVitest で作ったものの hook を直接呼ぶ）。
 * 開発サーバーでは 4 つのディレクトリ（ASSET_DIRS）を見張り、変わったら取り直してフルリロードする（止めるものがあればオーバーレイに出し、前の内容のまま）。
 */
export function gameAssets(o: { scanInVitest?: boolean } = {}): Plugin {
  let root = process.cwd();
  let assets: GameAssets = EMPTY_ASSETS;
  return {
    name: "wizlike-assets",
    configResolved(c) {
      root = c.root;
      if (process.env.VITEST && !o.scanInVitest) return;
      assets = scanAssets(root);
    },
    resolveId(id) {
      return id === VIRTUAL_ASSETS ? RESOLVED_ASSETS : undefined;
    },
    load(id) {
      return id === RESOLVED_ASSETS ? `export default ${JSON.stringify(assets)};` : undefined;
    },
    configureServer(server) {
      const dirs = Object.values(ASSET_DIRS).map((d) => resolve(root, d));
      server.watcher.add(dirs);
      const onChange = (file: string): void => {
        const f = resolve(file);
        if (!dirs.some((d) => f.startsWith(d + sep))) return;
        try {
          assets = scanAssets(root);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          server.config.logger.error(message);
          server.ws.send({ type: "error", err: { message, stack: "" } });
          return;
        }
        const m = server.moduleGraph.getModuleById(RESOLVED_ASSETS);
        if (m) server.moduleGraph.invalidateModule(m);
        server.ws.send({ type: "full-reload" });
      };
      server.watcher.on("add", onChange);
      server.watcher.on("change", onChange);
      server.watcher.on("unlink", onChange);
    },
  };
}

/**
 * SV-42: 本番ビルドの base。配布 URL https://servantsmendarks.github.io/wizlike/ のパスで固定する（docs/decisions.md）。
 * Service Worker の登録の scope もこれ（main.ts が import.meta.env.BASE_URL で受け取る）
 */
export const PAGES_BASE = "/wizlike/";

// 本番ビルド（vite build）とビルド結果の確認（vite preview。command は "serve" で isPreview が真）では PAGES_BASE、
// 開発サーバー（と vitest）では "/"
export default defineConfig(({ command, isPreview }) => ({
  base: command === "build" || isPreview === true ? PAGES_BASE : "/",
  plugins: [gameAssets(), serviceWorker()],
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // GitHub Actions の runner は手元より遅く、重いテスト（検証の網羅・迷宮の生成）が既定の 5 秒を超えたため
    testTimeout: 30_000,
  },
}));
