// UI-65（M9.5）: 効果音（ZzFX 1.3.2 の引数配列）を事前に合成するときの引数の扱い。主スレッド（audio.ts）と worker（synth-protocol.ts）で共有する。
// ZzFX 自身の事前合成（ZzFX.js の ZZFXSound）と同じく、揺らぎ（params[1] の randomness）は 0 にして 1 回だけ合成し、
// 揺らぎは再生のたびに playbackRate（1 + randomness × (乱数 × 2 − 1)）で付ける。randomness が null・省略なら ZzFX の既定 0.05。
// ここは Web API に触れない（build-samples.js は ZzFX.js の buildSamples の写しで AudioContext を作らない）。
import { zzfxBuildSamples, zzfxSampleRate } from "../vendor/zzfx-1.3.2/build-samples.js";

/** 効果音のサンプル列のレート（ZzFX の 44100） */
export const sfxSampleRate = zzfxSampleRate;

/** ZzFX の randomness の既定値（ZzFX.js の buildSamples の引数の既定と ZZFXSound の既定） */
const DEFAULT_RANDOMNESS = 0.05;

/** 事前合成に渡す引数（null は undefined に、randomness は 0 に） */
export function sfxArgs(params: readonly (number | null)[]): (number | undefined)[] {
  const a = params.map((x) => x ?? undefined);
  a[1] = 0;
  return a;
}

/** 揺らぎの幅（params[1]。null・省略なら 0.05） */
export function sfxRandomness(params: readonly (number | null)[]): number {
  return params[1] ?? DEFAULT_RANDOMNESS;
}

/** 再生の速さ（ZZFXSound.play の pitch 1・randomnessScale 1 と同じ式）。r は 0 以上 1 未満の乱数 */
export function sfxRate(params: readonly (number | null)[], r: number): number {
  return 1 + sfxRandomness(params) * (r * 2 - 1);
}

/** 事前合成（build-samples.js。ZzFX.js の ZZFX.buildSamples と同じ結果）。Float32Array にして返す */
export function buildSfxSamples(params: readonly (number | null)[]): Float32Array<ArrayBuffer> {
  return Float32Array.from(zzfxBuildSamples(...sfxArgs(params)));
}
