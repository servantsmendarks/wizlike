// UI-60: PNG の署名と IHDR の幅・高さ（純粋な関数）。画素と CRC は見ない（ブラウザが読む）。

import type { SpriteInfo } from "./asset-types";

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** 署名 8 + 長さ 4 + "IHDR" 4 + IHDR の中身 13 + CRC 4 */
const MIN_LENGTH = 33;
const IHDR_LENGTH = 13;

const u32 = (b: Uint8Array, i: number): number => ((b[i]! << 24) >>> 0) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!;

/** 署名と最初のチャンクの IHDR が正しければ幅と高さ、そうでなければ null */
export function pngSize(bytes: Uint8Array): SpriteInfo | null {
  if (bytes.length < MIN_LENGTH) return null;
  if (SIGNATURE.some((v, i) => bytes[i] !== v)) return null;
  if (u32(bytes, 8) !== IHDR_LENGTH) return null;
  if (String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!) !== "IHDR") return null;
  const w = u32(bytes, 16);
  const h = u32(bytes, 20);
  if (w === 0 || h === 0) return null;
  return { w, h };
}
