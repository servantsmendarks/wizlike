import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { precacheUrls, renderServiceWorker } from "./src/pwa/sw-template.ts";

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

export default defineConfig({
  plugins: [serviceWorker()],
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
