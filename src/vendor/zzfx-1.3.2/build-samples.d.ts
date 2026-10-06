// UI-65（M9.5）: ZzFX.js の buildSamples の写し（build-samples.js）の型（手書き）。
// build-samples.js は Web Audio に触れないので、Web Worker と node のテストで静的に import してよい。
/** 効果音のサンプル列のレート（ZzFX.js の ZZFX.sampleRate と同じ 44100） */
export declare const zzfxSampleRate: number;
/** ZzFX.js の ZZFX.buildSamples と同じ（ZZFX.volume 0.3 は中で掛かる。randomness が 0 でなければ Math.random で周波数が揺れる） */
export declare function zzfxBuildSamples(...p: (number | undefined)[]): number[];
