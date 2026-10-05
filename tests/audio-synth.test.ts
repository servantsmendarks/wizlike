// UI-63: 曲の合成（src/presenter/audio-synth.ts）。CONV §1 の合成の数値と、工房の render.py の細部に揃える。
import { describe, expect, it } from "vitest";
import wavetablesJson from "../data/wavetables.json";
import type { Wavetables } from "../src/core/data/index";
import type { SongData, ToneNote, NoiseNote } from "../src/build/asset-types";
import { lfsrBits, renderSong, sampleAt, SAMPLE_RATE } from "../src/presenter/audio-synth";
import { RENDER_REF } from "./helpers/render-ref";

const wt = wavetablesJson as Wavetables;
const B32 = "0123456789abcdefghijklmnopqrstuv";

function song(o: Partial<SongData> & { ch?: SongData["ch"] }): SongData {
  return {
    name: "test",
    kind: "jingle",
    tempoUs: 500000,
    time: [4, 4],
    barLen16: 16,
    bars: 1,
    end16: 16,
    loop: null,
    waves: ["pulse50", "pulse50", "pulse50"],
    ch: [[], [], [], []],
    ...o,
  };
}

/** ch を 1 本だけ鳴らした曲の値 × 4（4 で割る前の 1 チャンネルの値） */
function single(waves: SongData["waves"], ch: SongData["ch"], end16 = 16): Float32Array {
  const r = renderSong(song({ waves, ch, end16, bars: end16 / 16 }), wt);
  return r.samples.map((x) => x * 4);
}

describe("UI-63 sampleAt", () => {
  it("UI-63 sampleAt: 120bpm（500000μs）の 16 分 1 つは 5512.5 → 5513（四捨五入の切り上げ）、0 は 0", () => {
    expect(SAMPLE_RATE).toBe(44100);
    expect(sampleAt(0, 500000)).toBe(0);
    expect(sampleAt(1, 500000)).toBe(5513);
    expect(sampleAt(2, 500000)).toBe(11025);
  });

  it("UI-63 sampleAt: 工房の tick_to_sample（PPQ 480）と同じ", () => {
    expect([0, 1, 2, 3, 16, 17, 64].map((p) => sampleAt(p, 500000))).toEqual(RENDER_REF.t2s);
  });
});

describe("UI-63 renderSong", () => {
  it("UI-63 renderSong: A4（69）pulse50 v15 の ch1 だけ。k = 0..50 は +1/4、51 で −1/4（idx が 16 になる境目）、101 で +1/4 に戻る", () => {
    const ch1: ToneNote[] = [[0, 4, 69, 15]];
    const r = renderSong(song({ ch: [ch1, [], [], []] }), wt);
    for (let k = 0; k <= 50; k++) expect(r.samples[k]).toBe(0.25);
    for (let k = 51; k <= 100; k++) expect(r.samples[k]).toBe(-0.25);
    expect(r.samples[101]).toBe(0.25);
  });

  it("UI-63 renderSong: 値は (s/15×2−1)×v/15 を 4 で割る（triangle の s = 0 は −v/15、v 8）", () => {
    const ch2: ToneNote[] = [[0, 1, 60, 8]];
    const r = renderSong(song({ waves: ["pulse50", "triangle", "pulse50"], ch: [[], ch2, [], []] }), wt);
    // k = 0 は idx 0（triangle の 0）
    expect(r.samples[0]).toBeCloseTo(((0 / 15) * 2 - 1) * (8 / 15) / 4, 7);
  });

  it("UI-63 ch4 kick v15: LFSR の最初の 16 ビット（0x7FFF から）と clock 1200 の保持（k = 0..36 は steps 0、37 で 1）", () => {
    const bits = lfsrBits();
    expect(bits.length).toBe(32767);
    // 工房の hat（clock 44100 = 1 サンプルに 1 歩）の先頭 4 桁の 16 進
    const head = Array.from(bits.slice(0, 16)).join("");
    const refHead = (RENDER_REF.noise["hat"] ?? "")
      .slice(0, 4)
      .split("")
      .map((h) => parseInt(h, 16).toString(2).padStart(4, "0"))
      .join("");
    expect(head).toBe(refHead);
    const ch4: NoiseNote[] = [[0, 1, "kick", 15]];
    const s = single(["pulse50", "pulse50", "pulse50"], [[], [], [], ch4]);
    const v0 = (bits[0] ?? 0) * 2 - 1;
    const v1 = (bits[1] ?? 0) * 2 - 1;
    for (let k = 0; k <= 36; k++) expect(s[k]).toBe(v0);
    expect(s[37]).toBe(v1);
  });

  it("UI-63 音の無い区間は 0、音の長さはゲートだけ（次のサンプルで 0）", () => {
    const ch1: ToneNote[] = [[2, 1, 69, 15]];
    const r = renderSong(song({ ch: [ch1, [], [], []] }), wt);
    const s0 = sampleAt(2, 500000);
    const s1 = sampleAt(3, 500000);
    expect(r.samples[s0 - 1]).toBe(0);
    expect(r.samples[s0]).toBe(0.25);
    expect(r.samples[s1 - 1]).not.toBe(0);
    expect(r.samples[s1]).toBe(0);
    expect(r.samples.length).toBe(sampleAt(16, 500000));
  });

  it("UI-63 同じチャンネルで次の音の頭が前の音の終わりより前なら前を切る（render.py と同じ）", () => {
    const a = renderSong(song({ ch: [[[0, 4, 69, 15], [2, 2, 81, 15]], [], [], []] }), wt);
    const b = renderSong(song({ ch: [[[0, 2, 69, 15], [2, 2, 81, 15]], [], [], []] }), wt);
    expect(Array.from(a.samples)).toEqual(Array.from(b.samples));
  });

  it("UI-63 ループする曲の loopStart / loopEnd は sampleAt(loop.start16) / sampleAt(loop.end16)、ジングルは null", () => {
    const looped = renderSong(song({ kind: "song", bars: 2, end16: 32, loop: { start16: 16, end16: 32 } }), wt);
    expect(looped.loopStart).toBe(sampleAt(16, 500000));
    expect(looped.loopEnd).toBe(sampleAt(32, 500000));
    const jingle = renderSong(song({}), wt);
    expect(jingle.loopStart).toBeNull();
    expect(jingle.loopEnd).toBeNull();
  });
});

describe("UI-63 工房の render.py との照合（python で実行して写した値）", () => {
  it("UI-63 synth_wave: 6 波形 × 5 音 × 256 サンプルの添字が一致する", () => {
    let checked = 0;
    for (const [key, expected] of Object.entries(RENDER_REF.waves)) {
      const [wave, noteText] = key.split(":");
      const note = Number(noteText);
      const data = wt.waves[wave ?? ""]?.data ?? [];
      // 256 サンプルを 1 音で鳴らす（16 分 1 つ = 5513 サンプル）
      const s = single([wave ?? "", "pulse50", "pulse50"], [[[0, 1, note, 15]], [], [], []]);
      const actual = Array.from({ length: 256 }, (_, k) => {
        const val = s[k] ?? NaN;
        // 値から添字を逆に引けないので、値が data[idx] の値と一致するかを見る
        return val;
      });
      const want = expected.split("").map((c) => ((((data[B32.indexOf(c)] ?? NaN) / 15) * 2 - 1) * 15) / 15);
      expect(actual.map((x) => Math.fround(x))).toEqual(want.map((x) => Math.fround(x)));
      checked++;
    }
    expect(checked).toBe(30);
  });

  it("UI-63 synth_noise: 4 種 × 2048 サンプルの符号が一致する", () => {
    for (const [kind, hex] of Object.entries(RENDER_REF.noise)) {
      // 2048 サンプルは 16 分 1 つ（5513）に収まる
      const s = single(["pulse50", "pulse50", "pulse50"], [[], [], [], [[0, 1, kind, 15]]]);
      const got = Array.from(s.slice(0, 2048), (x) => (x > 0 ? "1" : "0")).join("");
      const want = hex
        .split("")
        .map((h) => parseInt(h, 16).toString(2).padStart(4, "0"))
        .join("");
      expect(got).toBe(want);
    }
  });

  it("UI-63 render_timeline: 1 小節の 4 チャンネルの曲の長さ・合計・各点の値が一致する（Float32 の丸めまで）", () => {
    const r = renderSong(
      song({
        waves: ["pulse50", "triangle", "organ"],
        ch: [
          [
            [0, 4, 69, 15],
            [6, 3, 72, 9],
          ],
          [[2, 4, 60, 8]],
          [
            [4, 4, 96, 12],
            [8, 8, 36, 5],
          ],
          [
            [0, 2, "snare", 10],
            [4, 1, "kick", 15],
            [12, 1, "hat", 3],
          ],
        ],
      }),
      wt,
    );
    expect(r.samples.length).toBe(RENDER_REF.mixLen);
    for (const [i, v] of RENDER_REF.mixAt) expect(r.samples[i]).toBe(Math.fround(v));
    let sum = 0;
    let abs = 0;
    for (const x of r.samples) {
      sum += x;
      abs += Math.abs(x);
    }
    expect(sum).toBeCloseTo(RENDER_REF.mixSum, 3);
    expect(abs).toBeCloseTo(RENDER_REF.mixAbs, 3);
  });
});
