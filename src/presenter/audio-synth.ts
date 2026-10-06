// UI-63: 曲の合成（純粋。Web API を使わない）。SongData（ビルド時に MIDI から変換した曲）を 1 チャンネルのサンプル列にする。
// 数値は docs/audio/CONVENTIONS.md §1「合成の数値」、細部は工房の tools/music/render.py（git ed4cd94）の「この道具の決め」に揃える:
// - レートは引数（既定は CONV §1 の基準の 44100 Hz = SAMPLE_RATE）。16 分の位置 p のサンプル番号は render.py の
//   tick_to_sample（整数の四捨五入）を 16 分単位に直したもの。
// - 区間（M9.5）: 曲は区間（小節の頭とループ点で区切る）ごとにも合成できる（planSong / renderSegment / nextSegment）。
//   境界で引き継ぐ可変の状態は無い（位相と LFSR は音符の頭からのサンプル数で決まり、包絡・LFO・テンポ変化は無い）ので、
//   区間をつないだものは renderSong とサンプル単位で同じ。renderSong は比べる基準として残す。
// - ch1〜ch3: 32 サンプルの波形を最近傍で読む（位相 × 32 の切り捨て）。平均律、A4 = 440 Hz。位相は音符ごとに 0 から。
//   値 = (サンプル値 / 15 × 2 − 1) × v / 15。
// - ch4: 15 bit LFSR（bit0 xor bit1 を帰還）を音符ごとに 0x7FFF から、種類ごとの clock で進め、bit0 を ±1 にして × v / 15。
// - 同じチャンネルで次の音の頭が前の音の終わりより前なら前を切る。音の長さはゲートだけ（エンベロープなし）。
// - 4 チャンネルを足して 4 で割る。
import type { Wavetables } from "../core/data/index";
import type { SongData, ToneNote } from "../build/asset-types";

/** CONV §1 の基準のレート（工房の render.py の既定）。sampleAt / renderSong の rate の既定値 */
export const SAMPLE_RATE = 44100;
const LFSR_PERIOD = 32767;
/** 16 分 1 つ = PPQ/4 tick。tick_to_sample の分母（2 × ppq × 10^6）を 16 分単位に直した 8 × 10^6 */
const DEN16 = 8_000_000;

/** 16 分の位置 p16 のサンプル番号（render.py の tick_to_sample と同じ整数の四捨五入） */
export function sampleAt(p16: number, tempoUs: number, rate = SAMPLE_RATE): number {
  const n = 2 * p16 * tempoUs * rate + DEN16 / 2;
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
  rate: number,
): { note: T; span: Span }[] {
  const sorted = notes.slice().sort((a, b) => a[0] - b[0]);
  const out: { note: T; span: Span }[] = [];
  sorted.forEach((n, i) => {
    let e = n[0] + n[1];
    const next = sorted[i + 1];
    if (next !== undefined) e = Math.min(e, next[0]);
    const s0 = sampleAt(n[0], tempoUs, rate);
    const s1 = Math.min(sampleAt(e, tempoUs, rate), total);
    if (s1 > s0) out.push({ note: n, span: { s0, s1, at: s0 } });
  });
  return out;
}

/**
 * UI-63: 曲を合成する。loopStart / loopEnd はループする曲（song.loop が非 null）のサンプル番号、ジングルは null。
 * 波形名・ノイズの種類が wavetables に無い音符は鳴らさない（ビルド時の検証で止めているので通常は無い）。
 * M9.5 から再生には使わない（区間の合成 renderSegment を使う）。区間の合成と比べる基準として残す。
 */
export function renderSong(
  song: SongData,
  wt: Wavetables,
  rate = SAMPLE_RATE,
): { samples: Float32Array<ArrayBuffer>; loopStart: number | null; loopEnd: number | null } {
  const total = sampleAt(song.end16, song.tempoUs, rate);
  const mix = new Float64Array(total);
  const size = wt.samples;
  const tones: readonly (readonly ToneNote[])[] = [song.ch[0], song.ch[1], song.ch[2]];
  for (let c = 0; c < 3; c++) {
    const data = wt.waves[song.waves[c] ?? ""]?.data;
    const notes = tones[c];
    if (data === undefined || notes === undefined) continue;
    for (const { note, span } of spans(notes, song.tempoUs, total, rate)) {
      const [, , midi, v] = note;
      const freq = 440 * 2 ** ((midi - 69) / 12);
      for (let k = 0; k < span.s1 - span.s0; k++) {
        const pos = ((k * freq) / rate) % 1;
        const idx = Math.min(Math.floor(pos * size), size - 1);
        mix[span.s0 + k] = (mix[span.s0 + k] ?? 0) + ((((data[idx] ?? 0) / 15) * 2 - 1) * v) / 15;
      }
    }
  }
  const bits = lfsrBits();
  for (const { note, span } of spans(song.ch[3], song.tempoUs, total, rate)) {
    const [, , kind, v] = note;
    const clock = wt.noise[kind]?.clock;
    if (clock === undefined) continue;
    for (let k = 0; k < span.s1 - span.s0; k++) {
      const steps = Math.floor((k * clock) / rate);
      mix[span.s0 + k] = (mix[span.s0 + k] ?? 0) + (((bits[steps % LFSR_PERIOD] ?? 0) * 2 - 1) * v) / 15;
    }
  }
  const samples = new Float32Array(total);
  for (let i = 0; i < total; i++) samples[i] = (mix[i] ?? 0) / 4;
  if (song.loop === null) return { samples, loopStart: null, loopEnd: null };
  return {
    samples,
    loopStart: sampleAt(song.loop.start16, song.tempoUs, rate),
    loopEnd: Math.min(sampleAt(song.loop.end16, song.tempoUs, rate), total),
  };
}

/** 区間の合成で鳴らす 1 つの音符（サンプルの区間 [s0, s1)）。tone は ch1〜ch3、noise は ch4 */
export type Voice =
  | { s0: number; s1: number; kind: "tone"; data: readonly number[]; freq: number; v: number }
  | { s0: number; s1: number; kind: "noise"; clock: number; v: number };

/**
 * UI-63（M9.5）: 曲の計画。曲ごとに 1 回作る不変のプレーンな値（structuredClone できる）。
 * 区間 i はサンプルの区間 [bounds[i], bounds[i + 1])。
 */
export type SongPlan = {
  rate: number;
  /** 波形のサンプル数（wavetables の samples） */
  size: number;
  /** sampleAt(end16) */
  total: number;
  /** 区間の境界のサンプル番号。bounds[0] = 0、最後は total、狭義単調増加 */
  bounds: number[];
  /** チャンネル順（ch1〜ch4）。各チャンネルの中は s0 の昇順で、区間は重ならない */
  voices: Voice[][];
  /** ループの区間番号（bounds の添字）。ループは区間 startSeg … endSeg − 1。ジングルは null */
  loop: { startSeg: number; endSeg: number } | null;
};

/**
 * UI-63（M9.5）: 曲の計画を作る。音符の区間は renderSong と同じ規則（次の音の頭で切る・total で切る・
 * 波形や clock が無い音符は入れない）。区間の境界は小節の頭とループ点（と曲末）の 16 分の位置を
 * sampleAt（四捨五入）でサンプル番号にしたもので、長さ 0 の区間は落とす。
 */
export function planSong(song: SongData, wt: Wavetables, rate: number): SongPlan {
  const total = sampleAt(song.end16, song.tempoUs, rate);
  const voices: Voice[][] = [];
  const tones: readonly (readonly ToneNote[])[] = [song.ch[0], song.ch[1], song.ch[2]];
  for (let c = 0; c < 3; c++) {
    const list: Voice[] = [];
    const data = wt.waves[song.waves[c] ?? ""]?.data;
    const notes = tones[c];
    if (data !== undefined && notes !== undefined) {
      for (const { note, span } of spans(notes, song.tempoUs, total, rate)) {
        const [, , midi, v] = note;
        list.push({ s0: span.s0, s1: span.s1, kind: "tone", data, freq: 440 * 2 ** ((midi - 69) / 12), v });
      }
    }
    voices.push(list);
  }
  const noise: Voice[] = [];
  for (const { note, span } of spans(song.ch[3], song.tempoUs, total, rate)) {
    const [, , kind, v] = note;
    const clock = wt.noise[kind]?.clock;
    if (clock === undefined) continue;
    noise.push({ s0: span.s0, s1: span.s1, kind: "noise", clock, v });
  }
  voices.push(noise);

  const pos16 = new Set<number>([0, song.end16]);
  for (let b = 0; b * song.barLen16 < song.end16; b++) pos16.add(b * song.barLen16);
  if (song.loop !== null) {
    pos16.add(song.loop.start16);
    pos16.add(song.loop.end16);
  }
  const bounds: number[] = [];
  for (const p of [...pos16].sort((a, b) => a - b)) {
    const s = Math.min(sampleAt(p, song.tempoUs, rate), total);
    if (bounds.length === 0 || s > (bounds[bounds.length - 1] ?? 0)) bounds.push(s);
  }
  if (bounds.length === 0 || bounds[0] !== 0) bounds.unshift(0);

  let loop: SongPlan["loop"] = null;
  if (song.loop !== null) {
    const startSeg = bounds.indexOf(Math.min(sampleAt(song.loop.start16, song.tempoUs, rate), total));
    const endSeg = bounds.indexOf(Math.min(sampleAt(song.loop.end16, song.tempoUs, rate), total));
    if (startSeg >= 0 && endSeg > startSeg) loop = { startSeg, endSeg };
  }
  return { rate, size: wt.samples, total, bounds, voices, loop };
}

/** 区間の数 */
export function segmentCount(plan: SongPlan): number {
  return Math.max(0, plan.bounds.length - 1);
}

/** s1 > a の最初の voice の添字（各チャンネルは s0 昇順で重ならないので s1 も昇順） */
function firstEndingAfter(list: readonly Voice[], a: number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((list[mid]?.s1 ?? 0) > a) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/**
 * UI-63（M9.5）: 区間 i を合成する（長さ bounds[i+1] − bounds[i]）。計画と区間番号だけで決まる純粋関数。
 * 位相と LFSR の歩数は音符の頭からのサンプル数 k = 全体の番号 − s0 で決めるので、区間をまたぐ音符も連続する。
 * 足す順は ch1→ch4（renderSong と同じ float64 の演算列）なので、区間をつなぐと renderSong と同じになる。
 */
export function renderSegment(plan: SongPlan, i: number): Float32Array<ArrayBuffer> {
  const a = plan.bounds[i] ?? 0;
  const z = plan.bounds[i + 1] ?? a;
  const n = Math.max(0, z - a);
  const mix = new Float64Array(n);
  const { rate, size } = plan;
  const bits = lfsrBits();
  for (const list of plan.voices) {
    for (let j = firstEndingAfter(list, a); j < list.length; j++) {
      const voice = list[j];
      if (voice === undefined || voice.s0 >= z) break;
      const g0 = Math.max(voice.s0, a);
      const g1 = Math.min(voice.s1, z);
      if (voice.kind === "tone") {
        const { data, freq, v } = voice;
        for (let g = g0; g < g1; g++) {
          const k = g - voice.s0;
          const pos = ((k * freq) / rate) % 1;
          const idx = Math.min(Math.floor(pos * size), size - 1);
          mix[g - a] = (mix[g - a] ?? 0) + ((((data[idx] ?? 0) / 15) * 2 - 1) * v) / 15;
        }
      } else {
        const { clock, v } = voice;
        for (let g = g0; g < g1; g++) {
          const k = g - voice.s0;
          const steps = Math.floor((k * clock) / rate);
          mix[g - a] = (mix[g - a] ?? 0) + (((bits[steps % LFSR_PERIOD] ?? 0) * 2 - 1) * v) / 15;
        }
      }
    }
  }
  const out = new Float32Array(n);
  for (let j = 0; j < n; j++) out[j] = (mix[j] ?? 0) / 4;
  return out;
}

/**
 * UI-63（M9.5）: 区間 i の次に鳴らす区間。ループする曲は 0 … endSeg − 1 の後、startSeg … endSeg − 1 を繰り返す
 * （前奏は 1 回だけ。endSeg 以降は鳴らさない）。ジングル（loop が null）は最後の区間の次が null。
 */
export function nextSegment(plan: SongPlan, i: number): number | null {
  if (plan.loop !== null) return i + 1 < plan.loop.endSeg ? i + 1 : plan.loop.startSeg;
  return i + 1 < segmentCount(plan) ? i + 1 : null;
}
