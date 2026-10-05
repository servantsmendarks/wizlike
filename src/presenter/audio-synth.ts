// UI-63: 曲の合成（純粋。Web API を使わない）。SongData（ビルド時に MIDI から変換した曲）を 1 チャンネルのサンプル列にする。
// 数値は docs/audio/CONVENTIONS.md §1「合成の数値」、細部は工房の tools/music/render.py（git ed4cd94）の「この道具の決め」に揃える:
// - 44100 Hz。16 分の位置 p のサンプル番号は render.py の tick_to_sample（整数の四捨五入）を 16 分単位に直したもの。
// - ch1〜ch3: 32 サンプルの波形を最近傍で読む（位相 × 32 の切り捨て）。平均律、A4 = 440 Hz。位相は音符ごとに 0 から。
//   値 = (サンプル値 / 15 × 2 − 1) × v / 15。
// - ch4: 15 bit LFSR（bit0 xor bit1 を帰還）を音符ごとに 0x7FFF から、種類ごとの clock で進め、bit0 を ±1 にして × v / 15。
// - 同じチャンネルで次の音の頭が前の音の終わりより前なら前を切る。音の長さはゲートだけ（エンベロープなし）。
// - 4 チャンネルを足して 4 で割る。
import type { Wavetables } from "../core/data/index";
import type { SongData, ToneNote } from "../build/asset-types";

export const SAMPLE_RATE = 44100;
const LFSR_PERIOD = 32767;
/** 16 分 1 つ = PPQ/4 tick。tick_to_sample の分母（2 × ppq × 10^6）を 16 分単位に直した 8 × 10^6 */
const DEN16 = 8_000_000;

/** 16 分の位置 p16 のサンプル番号（render.py の tick_to_sample と同じ整数の四捨五入） */
export function sampleAt(p16: number, tempoUs: number): number {
  const n = 2 * p16 * tempoUs * SAMPLE_RATE + DEN16 / 2;
  return (n - (n % DEN16)) / DEN16;
}

let bitsCache: Uint8Array | null = null;

/** 0x7FFF から始めた 15 bit LFSR の bit0 の列（[j] は j 回進めた後）。周期 32767 */
export function lfsrBits(): Uint8Array {
  if (bitsCache !== null) return bitsCache;
  const out = new Uint8Array(LFSR_PERIOD);
  let s = 0x7fff;
  for (let j = 0; j < LFSR_PERIOD; j++) {
    out[j] = s & 1;
    const fb = (s ^ (s >> 1)) & 1;
    s = (s >> 1) | (fb << 14);
  }
  bitsCache = out;
  return out;
}

type Span = { s0: number; s1: number; at: number };

/** 1 チャンネルの音符を開始の昇順に並べ、次の音の頭で前を切ったサンプルの区間にする */
function spans<T extends readonly [number, number, unknown, number]>(
  notes: readonly T[],
  tempoUs: number,
  total: number,
): { note: T; span: Span }[] {
  const sorted = notes.slice().sort((a, b) => a[0] - b[0]);
  const out: { note: T; span: Span }[] = [];
  sorted.forEach((n, i) => {
    let e = n[0] + n[1];
    const next = sorted[i + 1];
    if (next !== undefined) e = Math.min(e, next[0]);
    const s0 = sampleAt(n[0], tempoUs);
    const s1 = Math.min(sampleAt(e, tempoUs), total);
    if (s1 > s0) out.push({ note: n, span: { s0, s1, at: s0 } });
  });
  return out;
}

/**
 * UI-63: 曲を合成する。loopStart / loopEnd はループする曲（song.loop が非 null）のサンプル番号、ジングルは null。
 * 波形名・ノイズの種類が wavetables に無い音符は鳴らさない（ビルド時の検証で止めているので通常は無い）。
 */
export function renderSong(
  song: SongData,
  wt: Wavetables,
): { samples: Float32Array<ArrayBuffer>; loopStart: number | null; loopEnd: number | null } {
  const total = sampleAt(song.end16, song.tempoUs);
  const mix = new Float64Array(total);
  const size = wt.samples;
  const tones: readonly (readonly ToneNote[])[] = [song.ch[0], song.ch[1], song.ch[2]];
  for (let c = 0; c < 3; c++) {
    const data = wt.waves[song.waves[c] ?? ""]?.data;
    const notes = tones[c];
    if (data === undefined || notes === undefined) continue;
    for (const { note, span } of spans(notes, song.tempoUs, total)) {
      const [, , midi, v] = note;
      const freq = 440 * 2 ** ((midi - 69) / 12);
      for (let k = 0; k < span.s1 - span.s0; k++) {
        const pos = ((k * freq) / SAMPLE_RATE) % 1;
        const idx = Math.min(Math.floor(pos * size), size - 1);
        mix[span.s0 + k] = (mix[span.s0 + k] ?? 0) + ((((data[idx] ?? 0) / 15) * 2 - 1) * v) / 15;
      }
    }
  }
  const bits = lfsrBits();
  for (const { note, span } of spans(song.ch[3], song.tempoUs, total)) {
    const [, , kind, v] = note;
    const clock = wt.noise[kind]?.clock;
    if (clock === undefined) continue;
    for (let k = 0; k < span.s1 - span.s0; k++) {
      const steps = Math.floor((k * clock) / SAMPLE_RATE);
      mix[span.s0 + k] = (mix[span.s0 + k] ?? 0) + (((bits[steps % LFSR_PERIOD] ?? 0) * 2 - 1) * v) / 15;
    }
  }
  const samples = new Float32Array(total);
  for (let i = 0; i < total; i++) samples[i] = (mix[i] ?? 0) / 4;
  if (song.loop === null) return { samples, loopStart: null, loopEnd: null };
  return {
    samples,
    loopStart: sampleAt(song.loop.start16, song.tempoUs),
    loopEnd: Math.min(sampleAt(song.loop.end16, song.tempoUs), total),
  };
}
