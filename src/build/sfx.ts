// UI-65: 効果音 JSON（assets/sfx/<name>.json）の検証。純粋な関数。
// 基準は工房（make-assets）の tools/music/sfx_render.py の validate_sfx_json / validate_params と同じ（docs/audio/CONVENTIONS.md §6）。
// 項目 ID: S01 JSON として読めない / S02 オブジェクトでない / S03 name がファイル名と違う / S04 sfx.names に無い /
// S05 params が無い / S06 params が配列でない / S07 params が 21 個を超える / S08 要素が数値でも null でもない / S09 要素が有限でない。

import type { AudioData } from "../core/data/types";
import type { AssetIssue, SfxData } from "./asset-types";

/** CONV §6: ZzFX 1.3.2 の引数は 21 個 */
const MAX_PARAMS = 21;

const typeName = (v: unknown): string => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

/** 効果音を検査し、止めるものが無ければ SfxData にする（null と末尾の省略はそのまま。undefined への置き換えは再生側） */
export function checkSfx(file: string, stem: string, text: string, audio: AudioData): { sfx: SfxData | null; errors: AssetIssue[] } {
  const errors: AssetIssue[] = [];
  const err = (id: string, message: string): void => void errors.push({ file, id, message });
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch (e) {
    err("S01", `not valid JSON (${e instanceof Error ? e.message : String(e)})`);
    return { sfx: null, errors };
  }
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    err("S02", `content must be an object, got ${typeName(v)}`);
    return { sfx: null, errors };
  }
  const o = v as Record<string, unknown>;
  if (o.name !== stem) err("S03", `name ${JSON.stringify(o.name ?? null)} differs from the file name ${JSON.stringify(stem)}`);
  if (!audio.sfx.names.includes(stem)) err("S04", `${JSON.stringify(stem)} is not in sfx.names of data/audio.json`);
  const params = o.params;
  if (!("params" in o)) err("S05", "params is missing");
  else if (!Array.isArray(params)) err("S06", `params must be an array, got ${typeName(params)}`);
  else {
    if (params.length > MAX_PARAMS) err("S07", `params has ${params.length} values (at most ${MAX_PARAMS})`);
    params.forEach((x: unknown, i) => {
      if (x === null) return;
      if (typeof x !== "number") err("S08", `params[${i}] must be a number or null, got ${typeName(x)}`);
      else if (!Number.isFinite(x)) err("S09", `params[${i}] must be finite, got ${x}`);
    });
  }
  if (errors.length > 0 || !Array.isArray(params)) return { sfx: null, errors };
  return { sfx: { name: stem, params: params as (number | null)[] }, errors };
}
