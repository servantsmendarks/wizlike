// UI-63 / UI-64 / UI-65 / UI-60 / UI-61: 素材（assets/music・assets/sfx・public/sprites・public/town）をまとめて検証し、GameAssets にする。
// 純粋な関数（ファイルの中身は引数で受ける。読むのは vite.config.ts のプラグイン）。
// 止めるもの（errors）があったファイルは assets に入れない。1 つでもあればプラグインがビルドと開発サーバーを止める。

import type { GameData } from "../core/data/types";
import type { AssetIssue, CollectResult, GameAssets } from "./asset-types";
import { checkSong } from "./music";
import { pngSize } from "./png";
import { checkSfx } from "./sfx";
import { parseSmf } from "./smf";

/** 各ディレクトリの全ファイル（name は拡張子付きのファイル名） */
export type AssetFiles = {
  music: { name: string; bytes: Uint8Array }[];
  sfx: { name: string; text: string }[];
  sprites: { name: string; bytes: Uint8Array }[];
  /** UI-61（M8.5）: public/town の全ファイル */
  town: { name: string; bytes: Uint8Array }[];
};

/** 工房の export の置き場（project.json の export） */
export const ASSET_DIRS = { music: "assets/music", sfx: "assets/sfx", sprites: "public/sprites", town: "public/town" } as const;

/** UI-61（M8.5）: 施設の絵の大きさ（ビューの領域そのまま） */
export const TOWN_PICTURE_SIZE = { w: 240, h: 150 } as const;

/** 絵の名前（monsters[].sprite・unknown_<kind>）の文字種 */
const SPRITE_NAME_RE = /^[a-z0-9_]+$/;

const split = (name: string): { stem: string; ext: string } => {
  const i = name.lastIndexOf(".");
  return i <= 0 ? { stem: name, ext: "" } : { stem: name.slice(0, i), ext: name.slice(i).toLowerCase() };
};
const byName = <T extends { name: string }>(xs: readonly T[]): T[] => [...xs].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

export function collectAssets(files: AssetFiles, data: Pick<GameData, "wavetables" | "audio">): CollectResult {
  const assets: GameAssets = { music: {}, sfx: {}, sprites: {}, town: {} };
  const errors: AssetIssue[] = [];
  const warnings: AssetIssue[] = [];

  for (const f of byName(files.music)) {
    const file = `${ASSET_DIRS.music}/${f.name}`;
    const { stem, ext } = split(f.name);
    if (ext !== ".mid") {
      warnings.push({ file, id: "W07", message: "only .mid files are read in assets/music (ignored)" });
      continue;
    }
    let smf;
    try {
      smf = parseSmf(f.bytes);
    } catch (e) {
      errors.push({ file, id: "E02", message: `cannot read MIDI: ${e instanceof Error ? e.message : String(e)}` });
      continue;
    }
    const r = checkSong(file, stem, smf, { wavetables: data.wavetables, audio: data.audio });
    errors.push(...r.errors);
    warnings.push(...r.warnings);
    if (r.song) assets.music[stem] = r.song;
  }

  for (const f of byName(files.sfx)) {
    const file = `${ASSET_DIRS.sfx}/${f.name}`;
    const { stem, ext } = split(f.name);
    if (ext !== ".json") {
      warnings.push({ file, id: "W07", message: "only .json files are read in assets/sfx (ignored)" });
      continue;
    }
    const r = checkSfx(file, stem, f.text, data.audio);
    errors.push(...r.errors);
    if (r.sfx) assets.sfx[stem] = r.sfx;
  }

  for (const f of byName(files.sprites)) {
    const file = `${ASSET_DIRS.sprites}/${f.name}`;
    const { stem, ext } = split(f.name);
    if (ext !== ".png") continue; // public/sprites の PNG 以外はゲームが読まない（Vite がそのまま dist に写す）
    if (!SPRITE_NAME_RE.test(stem)) {
      warnings.push({ file, id: "P03", message: `sprite name must match ${SPRITE_NAME_RE.source} (not listed)` });
      continue;
    }
    const size = pngSize(f.bytes);
    if (size === null) {
      errors.push({ file, id: "P01", message: "not a PNG (bad signature or IHDR)" });
      continue;
    }
    if (size.w !== size.h) warnings.push({ file, id: "P02", message: `sprite is not square (${size.w}x${size.h})` });
    assets.sprites[stem] = size;
  }

  // UI-61（M8.5）: 施設の絵。P01 は止める、P03（名前）と P04（240×150 でない）は警告して一覧に入れない
  for (const f of byName(files.town)) {
    const file = `${ASSET_DIRS.town}/${f.name}`;
    const { stem, ext } = split(f.name);
    if (ext !== ".png") continue;
    if (!SPRITE_NAME_RE.test(stem)) {
      warnings.push({ file, id: "P03", message: `picture name must match ${SPRITE_NAME_RE.source} (not listed)` });
      continue;
    }
    const size = pngSize(f.bytes);
    if (size === null) {
      errors.push({ file, id: "P01", message: "not a PNG (bad signature or IHDR)" });
      continue;
    }
    if (size.w !== TOWN_PICTURE_SIZE.w || size.h !== TOWN_PICTURE_SIZE.h) {
      warnings.push({
        file,
        id: "P04",
        message: `town picture must be ${TOWN_PICTURE_SIZE.w}x${TOWN_PICTURE_SIZE.h} (${size.w}x${size.h}, not listed)`,
      });
      continue;
    }
    assets.town[stem] = size;
  }

  return { assets, errors, warnings };
}

/** 項目 ID の頭の仕様 ID（S は UI-65、P は UI-60（public/town の P は UI-61）、ほか（L・G・E・W）は UI-64） */
function specOf(id: string, file: string): string {
  if (id.startsWith("S")) return "UI-65";
  if (id.startsWith("P") && file.startsWith(`${ASSET_DIRS.town}/`)) return "UI-61";
  if (id.startsWith("P")) return "UI-60";
  return "UI-64";
}

/** "assets/music/town.mid: UI-64/L11 ch2: notes overlap at 3.2" の形 */
export function formatIssue(i: AssetIssue): string {
  return `${i.file}: ${specOf(i.id, i.file)}/${i.id} ${i.message}`;
}

/** 止めるもの、続いて警告（先頭に "warning: "）の行 */
export function formatIssues(r: CollectResult): string[] {
  return [...r.errors.map(formatIssue), ...r.warnings.map((w) => `warning: ${formatIssue(w)}`)];
}
