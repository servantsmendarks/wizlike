// UI-63: 曲の合成（src/presenter/audio-synth.ts）。CONV §1 の合成の数値と、工房の render.py の細部に揃える。
import { describe, expect, it } from "vitest";
import wavetablesJson from "../data/wavetables.json";
import type { Wavetables } from "../src/core/data/index";
import type { SongData, ToneNote, NoiseNote } from "../src/build/asset-types";
import {
  lfsrBits,
  nextSegment,
  planSong,
  renderSegment,
  renderSong,
  sampleAt,
  SAMPLE_RATE,
  segmentCount,
  warmupPlan,
  type SongPlan,
} from "../src/presenter/audio-synth";
import { checkSong } from "../src/build/music";
import { parseSmf } from "../src/build/smf";
import { data } from "./helpers/core";
import { RENDER_REF, RENDER_REF_22050 } from "./helpers/render-ref";

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

// ---- M9.5: 区間ごとの合成（planSong / renderSegment / nextSegment） ----

const FS_MODULE = "node:fs";
const fs = (await import(/* @vite-ignore */ FS_MODULE)) as { readFileSync(p: URL): Uint8Array };

/** 本物の曲（assets/music の .mid をビルドと同じ checkSong に通したもの） */
function realSong(name: string): SongData {
  const bytes = new Uint8Array(fs.readFileSync(new URL(`../assets/music/${name}.mid`, import.meta.url)));
  const r = checkSong(`assets/music/${name}.mid`, name, parseSmf(bytes), { wavetables: data.wavetables, audio: data.audio });
  if (r.song === null || r.errors.length > 0) throw new Error(`${name}: ${JSON.stringify(r.errors)}`);
  return r.song;
}

/** 区間を 0..n−1 の順につないだもの */
function joined(plan: SongPlan): Float32Array {
  const out = new Float32Array(plan.total);
  let at = 0;
  for (let i = 0; i < segmentCount(plan); i++) {
    const seg = renderSegment(plan, i);
    expect(seg.length).toBe((plan.bounds[i + 1] ?? 0) - (plan.bounds[i] ?? 0));
    out.set(seg, at);
    at += seg.length;
  }
  expect(at).toBe(plan.total);
  return out;
}

/** 区間をつないだものと renderSong の不一致の数（長い列を toEqual で比べない。最初の不一致の添字をメッセージに） */
function expectSame(s: SongData, rate: number): void {
  const full = renderSong(s, wt, rate).samples;
  const j = joined(planSong(s, wt, rate));
  expect(j.length).toBe(full.length);
  let count = 0;
  let first = -1;
  for (let i = 0; i < full.length; i++) {
    if (full[i] !== j[i]) {
      count++;
      if (first < 0) first = i;
    }
  }
  expect(count, `rate ${rate}: first mismatch at ${first}`).toBe(0);
}

const TOWN = realSong("town");
const DUNGEON1 = realSong("dungeon1");

describe("UI-63 小節: 区間の境界", () => {
  it("UI-63 小節: 区間の境界は bounds[b] = sampleAt(b·barLen16)、最後は total、長さ 0 の区間は無い", () => {
    for (const rate of [44100, 22050]) {
      const s = song({ kind: "song", tempoUs: 789474, bars: 3, end16: 48, loop: { start16: 0, end16: 48 } });
      const plan = planSong(s, wt, rate);
      expect(plan.rate).toBe(rate);
      expect(plan.total).toBe(sampleAt(48, 789474, rate));
      expect(plan.bounds).toEqual([0, 1, 2, 3].map((b) => sampleAt(b * 16, 789474, rate)));
      for (let i = 1; i < plan.bounds.length; i++) expect(plan.bounds[i]!).toBeGreaterThan(plan.bounds[i - 1]!);
      expect(segmentCount(plan)).toBe(3);
      expect(plan.loop).toEqual({ startSeg: 0, endSeg: 3 });
    }
  });

  it("UI-63 小節: town の 1 区間の長さは 2 通り（端数を四捨五入で吸収し、誤差は積み上がらない）", () => {
    const lensAt = (rate: number): number[] => {
      const plan = planSong(TOWN, wt, rate);
      expect(segmentCount(plan)).toBe(TOWN.bars);
      // 頭から計算するので最後の境界は曲末のサンプル番号そのもの
      expect(plan.bounds.at(-1)).toBe(sampleAt(TOWN.end16, TOWN.tempoUs, rate));
      return [...new Set(plan.bounds.slice(1).map((b, i) => b - (plan.bounds[i] ?? 0)))].sort((x, y) => x - y);
    };
    expect(lensAt(44100)).toEqual([139263, 139264]);
    const l22 = lensAt(22050);
    expect(l22.length).toBe(2);
    expect(l22[1]! - l22[0]!).toBe(1);
  });
});

describe("UI-63 小節: 区間をつないだものは曲全体の合成と一致", () => {
  it("UI-63 小節: 区間をつないだものは renderSong と一致（town / dungeon1 × 44100 / 22050）", () => {
    for (const s of [TOWN, DUNGEON1]) for (const rate of [44100, 22050]) expectSame(s, rate);
  });

  it("UI-63 小節: 小節をまたぐ tone と noise の音符でも一致", () => {
    // 789474μs は小節の頭が整数のサンプルにならないテンポ。小節の頭をまたぐ音符を全チャンネルに置く
    const s = song({
      kind: "song",
      tempoUs: 789474,
      bars: 3,
      end16: 48,
      loop: { start16: 0, end16: 48 },
      waves: ["pulse25", "triangle", "saw"],
      ch: [[[10, 12, 69, 15]], [[14, 20, 57, 9]], [[0, 48, 40, 6]], [[12, 8, "hat", 7], [28, 6, "openhat", 11]]],
    });
    for (const rate of [44100, 22050]) {
      const plan = planSong(s, wt, rate);
      // またいでいることの確かめ: 区間 0 の終わりと区間 1 の頭が 0 でない
      const s0 = renderSegment(plan, 0);
      const s1 = renderSegment(plan, 1);
      expect(s0[s0.length - 1]).not.toBe(0);
      expect(s1[0]).not.toBe(0);
      expectSame(s, rate);
    }
  });

  it("UI-63 小節: 波形の無いチャンネル・種類の無いノイズでも一致（鳴らさない）", () => {
    const s = song({
      bars: 2,
      end16: 32,
      waves: ["pulse50", "nosuchwave", "organ"],
      ch: [[[0, 20, 60, 15]], [[0, 32, 60, 15]], [[4, 20, 72, 8]], [[0, 4, "nosuchkind", 15], [8, 18, "snare", 9]]],
    });
    for (const rate of [44100, 22050]) {
      const plan = planSong(s, wt, rate);
      expect(plan.voices[1]).toEqual([]);
      expect(plan.voices[3]?.length).toBe(1);
      expectSame(s, rate);
    }
  });

  it("UI-63 小節: 次の音の頭で切った音・total を越える音でも一致（ビルドでは L11/L12 で止まる。合成器の防御）", () => {
    const s = song({
      bars: 2,
      end16: 32,
      ch: [[[0, 20, 69, 15], [6, 30, 72, 9]], [], [[10, 40, 48, 7]], [[2, 20, "kick", 15], [14, 30, "snare", 5]]],
    });
    for (const rate of [44100, 22050]) expectSame(s, rate);
  });

  it("UI-63 小節: 3/4・前奏あり（loop_start > 0）・loop_end < 曲末・ジングルでも一致", () => {
    const notes: SongData["ch"] = [
      [[0, 9, 64, 12], [11, 14, 67, 10], [30, 6, 71, 8]],
      [[3, 30, 52, 7]],
      [[0, 48, 40, 5]],
      [[0, 1, "kick", 15], [12, 13, "snare", 8], [26, 1, "hat", 4], [27, 9, "openhat", 6]],
    ];
    const cases: SongData[] = [
      song({ kind: "song", time: [3, 4], barLen16: 12, bars: 4, end16: 48, loop: { start16: 0, end16: 48 }, ch: notes }),
      song({ kind: "song", bars: 3, end16: 48, loop: { start16: 16, end16: 48 }, ch: notes }),
      song({ kind: "song", bars: 3, end16: 48, loop: { start16: 0, end16: 32 }, ch: notes }),
      song({ kind: "jingle", tempoUs: 612245, bars: 3, end16: 48, ch: notes }),
    ];
    for (const s of cases) for (const rate of [44100, 22050]) expectSame(s, rate);
    expect(planSong(cases[0]!, wt, 22050).bounds).toEqual([0, 12, 24, 36, 48].map((p) => sampleAt(p, 500000, 22050)));
    expect(planSong(cases[1]!, wt, 22050).loop).toEqual({ startSeg: 1, endSeg: 3 });
    expect(planSong(cases[2]!, wt, 22050).loop).toEqual({ startSeg: 0, endSeg: 2 });
    expect(planSong(cases[3]!, wt, 22050).loop).toBeNull();
  });

  it("UI-63 小節: ループ点が小節の頭に無い曲でもループ点が区間の境界になる（ビルドでは L28 で止まる）", () => {
    const s = song({
      kind: "song",
      bars: 3,
      end16: 48,
      loop: { start16: 6, end16: 40 },
      ch: [[[0, 48, 60, 10]], [[5, 30, 64, 9]], [], [[4, 8, "snare", 9], [38, 6, "hat", 4]]],
    });
    for (const rate of [44100, 22050]) {
      const plan = planSong(s, wt, rate);
      expect(plan.bounds).toEqual([0, 6, 16, 32, 40, 48].map((p) => sampleAt(p, 500000, rate)));
      expect(plan.loop).toEqual({ startSeg: 1, endSeg: 4 });
      expectSame(s, rate);
    }
  });

  it("UI-63 小節: nextSegment は前奏を 1 回、以後 startSeg..endSeg−1 を繰り返す。ジングルは最後で null", () => {
    const walk = (plan: SongPlan, steps: number): (number | null)[] => {
      const seq: (number | null)[] = [0];
      let i: number | null = 0;
      for (let k = 0; k < steps && i !== null; k++) {
        i = nextSegment(plan, i);
        seq.push(i);
      }
      return seq;
    };
    // 前奏 1 小節 + ループ 2 小節 + loop_end の後ろに 1 小節（鳴らさない）
    const intro = planSong(song({ kind: "song", bars: 4, end16: 64, loop: { start16: 16, end16: 48 } }), wt, 22050);
    expect(segmentCount(intro)).toBe(4);
    expect(walk(intro, 7)).toEqual([0, 1, 2, 1, 2, 1, 2, 1]);
    const whole = planSong(song({ kind: "song", bars: 3, end16: 48, loop: { start16: 0, end16: 48 } }), wt, 22050);
    expect(walk(whole, 6)).toEqual([0, 1, 2, 0, 1, 2, 0]);
    const jingle = planSong(song({ kind: "jingle", bars: 3, end16: 48 }), wt, 22050);
    expect(walk(jingle, 6)).toEqual([0, 1, 2, null]);
    expect(nextSegment(planSong(TOWN, wt, 22050), TOWN.bars - 1)).toBe(0);
  });
});

describe("UI-63 22050: 工房の render.py（sr = 22050）との照合", () => {
  it("UI-63 22050: render.py（22050）の値と一致（試験用の 1 小節と、本物の 2 曲の 16 区間の頭）", () => {
    const R = RENDER_REF_22050;
    expect([0, 1, 2, 3, 16, 17, 64].map((p) => sampleAt(p, 500000, 22050))).toEqual(R.t2s);
    const mixSong = song({
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
    });
    const mix = joined(planSong(mixSong, wt, 22050));
    expect(mix.length).toBe(R.mixLen);
    for (const [i, v] of R.mixAt) expect(mix[i]).toBe(Math.fround(v));
    let sum = 0;
    let abs = 0;
    for (const x of mix) {
      sum += x;
      abs += Math.abs(x);
    }
    expect(sum).toBeCloseTo(R.mixSum, 3);
    expect(abs).toBeCloseTo(R.mixAbs, 3);

    for (const [name, s] of [
      ["town", TOWN],
      ["dungeon1", DUNGEON1],
    ] as const) {
      const ref = R.songs[name]!;
      const plan = planSong(s, wt, 22050);
      expect(plan.total).toBe(ref.len);
      expect(plan.bounds).toEqual(ref.bounds);
      expect(ref.heads.length).toBe(16);
      for (let i = 0; i < ref.heads.length; i++) expect(renderSegment(plan, i)[0]).toBe(Math.fround(ref.heads[i]!));
      const all = joined(plan);
      for (const [i, v] of ref.at) expect(all[i]).toBe(Math.fround(v));
      let a = 0;
      for (const x of all) a += Math.abs(x);
      expect(Math.abs(a - ref.mixAbs)).toBeLessThan(1e-3);
    }
  });
});

// 2026-10-07 ユーザーの指示: 暖機は実在の曲から選ばず、合成器に固定のダミー区間（3 秒分【仮】、波形 6 種とノイズ 4 種をすべて含む）を作らせる
describe("UI-63 暖機のダミー区間 warmupPlan（M9.5）", () => {
  const wt = data.wavetables;
  const rate = data.config.audio.sampleRate;

  it("UI-63 warmupPlan: 区間は 1 つで長さは round(seconds × rate)、ジングルと同じくループしない（小数の秒も可）", () => {
    for (const sec of [3, 1.5, data.config.audio.warmupSeconds]) {
      const plan = warmupPlan(wt, rate, sec);
      expect(segmentCount(plan)).toBe(1);
      expect(plan.bounds).toEqual([0, Math.round(sec * rate)]);
      expect(plan.total).toBe(Math.round(sec * rate));
      expect(plan.rate).toBe(rate);
      expect(plan.size).toBe(wt.samples);
      expect(plan.loop).toBeNull();
      expect(plan.voices).toHaveLength(4);
    }
    expect(warmupPlan(wt, 44100, 3).total).toBe(132300);
    expect(segmentCount(warmupPlan(wt, rate, 0))).toBe(0);
    // 構造化複製できるプレーンな値
    const p = warmupPlan(wt, rate, 3);
    expect(structuredClone(p)).toEqual(p);
  });

  it("UI-63 warmupPlan: 波形の全種（6 種）が ch1〜ch3 に、ノイズの全種（4 種）が ch4 に入り、全部が区間 0 の中で鳴る", () => {
    const plan = warmupPlan(wt, rate, 3);
    const z = plan.bounds[1]!;
    const tones = plan.voices.slice(0, 3).flat();
    expect(tones.every((v) => v.kind === "tone")).toBe(true);
    const waveNames = Object.keys(wt.waves);
    expect(waveNames).toHaveLength(6);
    const usedWaves = tones.map((v) => (v.kind === "tone" ? waveNames.find((k) => wt.waves[k]!.data === v.data) : undefined));
    expect(new Set(usedWaves)).toEqual(new Set(waveNames));
    expect(tones).toHaveLength(6);
    const noise = plan.voices[3]!;
    const noiseKinds = Object.keys(wt.noise);
    expect(noiseKinds).toHaveLength(4);
    expect(noise.map((v) => (v.kind === "noise" ? v.clock : -1))).toEqual(noiseKinds.map((k) => wt.noise[k]!.clock));
    for (const list of plan.voices) {
      expect(list.length).toBeGreaterThan(0);
      // 各チャンネルは s0 昇順で重ならず、区間 [0, z) の中で長さがある
      list.forEach((v, j) => {
        expect(v.s0).toBeGreaterThanOrEqual(j === 0 ? 0 : list[j - 1]!.s1);
        expect(v.s1).toBeGreaterThan(v.s0);
        expect(v.s1).toBeLessThanOrEqual(z);
        expect(v.v).toBeGreaterThan(0);
      });
    }
  });

  it("UI-63 warmupPlan: renderSegment(plan, 0) が例外なく終わり、全チャンネルに音がある（チャンネルごとの出力が 0 だけでない）", () => {
    const plan = warmupPlan(wt, rate, 3);
    const out = renderSegment(plan, 0);
    expect(out).toHaveLength(plan.total);
    expect(out.some((x) => x !== 0)).toBe(true);
    for (let c = 0; c < 4; c++) {
      const only: SongPlan = { ...plan, voices: plan.voices.map((l, k) => (k === c ? l : [])) };
      const o = renderSegment(only, 0);
      expect(o.some((x) => x !== 0)).toBe(true);
      // 各音符の中にも音がある（波形・ノイズの種類ごと）
      for (const v of plan.voices[c]!) expect(o.subarray(v.s0, v.s1).some((x) => x !== 0)).toBe(true);
    }
  });
});
