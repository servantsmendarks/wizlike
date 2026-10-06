// UI-63（M9.5）: Web Worker の合成の暖機（B6 の (a)、2026-10-06 ユーザーの判断）。
// renderSegment を呼び出しを数える包み（中身は本物）に差し替え、暖機が本物の依頼と同じ renderSegment を通ることと、
// worker が無いときは主スレッドで合成しないことを確かめる（tests/audio.test.ts と分けたのは vi.mock がファイル全体に効くため）。
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SongData } from "../src/build/asset-types";
import { createWorkerRenderer } from "../src/presenter/audio";
import { planSong, renderSegment, type SongPlan } from "../src/presenter/audio-synth";
import { createSynthHandler } from "../src/presenter/synth-protocol";
import { data } from "./helpers/core";

vi.mock("../src/presenter/audio-synth", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/presenter/audio-synth")>();
  return { ...real, renderSegment: vi.fn(real.renderSegment) };
});

const RATE = data.config.audio.sampleRate;
const SONG: SongData = {
  name: "town",
  kind: "song",
  tempoUs: 500000,
  time: [4, 4],
  barLen16: 16,
  bars: 2,
  end16: 32,
  loop: { start16: 16, end16: 32 },
  waves: ["pulse50", "triangle", "organ"],
  ch: [[[0, 4, 69, 12]], [[4, 4, 57, 10]], [[8, 4, 45, 8]], [[0, 1, "kick", 15], [8, 1, "snare", 12]]],
};
const spy = vi.mocked(renderSegment);

afterEach(() => {
  spy.mockClear();
  vi.restoreAllMocks();
});

describe("UI-63 Web Worker の合成の暖機（M9.5）", () => {
  it("UI-63 worker 暖機: warmup は計画の区間 0 を本物と同じ renderSegment で合成して捨てる（返事なし・計画を名前で持たない）", () => {
    const handle = createSynthHandler();
    const plan = planSong(SONG, data.wavetables, RATE);
    spy.mockClear();
    expect(handle({ type: "warmup", plan: structuredClone(plan) })).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toEqual(plan);
    expect(spy.mock.calls[0]![1]).toBe(0);
    // 合成した中身は本物の区間 0 と同じ（全チャンネル・ノイズを通っている）
    expect(spy.mock.results[0]!.value).toEqual(renderSegment(plan, 0));
    // 計画は持たない: 同じ名前の区間を頼んでも null
    expect(handle({ type: "seg", name: "town", i: 0, id: 1 })).toEqual({ type: "seg", id: 1, samples: null });
  });

  it("UI-63 worker 暖機: 合成できない計画でも例外を投げず、以後の本物の依頼に影響しない", () => {
    const handle = createSynthHandler();
    expect(() => handle({ type: "warmup", plan: null as unknown as SongPlan })).not.toThrow();
    const plan = planSong(SONG, data.wavetables, RATE);
    handle({ type: "plan", name: "town", plan });
    expect(handle({ type: "seg", name: "town", i: 1, id: 7 })).toEqual({ type: "seg", id: 7, samples: renderSegment(plan, 1) });
  });

  it("UI-63 worker 暖機: worker が作れないとき warmup は主スレッドで合成しない", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = createWorkerRenderer(() => {
      throw new Error("no worker");
    });
    const plan = r.plan(SONG, data.wavetables, RATE);
    spy.mockClear();
    r.warmup?.(plan);
    expect(spy).not.toHaveBeenCalled();
  });
});
