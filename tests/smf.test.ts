import { describe, expect, test } from "vitest";
import { parseSmf, SmfError } from "../src/build/smf";
import { conformingSong, markerEv, meta, noteOff, noteOn, program, smf, tempoEv, timeSigEv, track, trackNameEv, vlq } from "./helpers/midi";

describe("UI-64/E02 parseSmf（依存なしの SMF の読み込み）", () => {
  test("UI-64/E02 parseSmf: format・ppq・トラック名・テンポ・拍子・目印・Program Change・Note On/Off・End of Track の tick", () => {
    const f = parseSmf(conformingSong({ ppq: 96 }));
    expect([f.format, f.ppq, f.tracks.length]).toEqual([1, 96, 5]);
    expect(f.tracks.map((t) => t.name)).toEqual(["conductor", "ch1", "ch2", "ch3", "ch4"]);
    expect(f.tracks.map((t) => t.index)).toEqual([0, 1, 2, 3, 4]);
    expect(f.tracks.map((t) => t.end)).toEqual([768, 768, 768, 768, 768]);
    expect(f.tracks[0]!.events).toEqual([
      { tick: 0, type: "trackName", text: "conductor" },
      { tick: 0, type: "tempo", us: 500000 },
      { tick: 0, type: "timeSignature", num: 4, den: 4 },
      { tick: 0, type: "marker", text: "loop_start" },
      { tick: 768, type: "marker", text: "loop_end" },
    ]);
    expect(f.tracks[1]!.events).toEqual([
      { tick: 0, type: "trackName", text: "ch1" },
      { tick: 0, type: "programChange", channel: 0, program: 0 },
      { tick: 0, type: "noteOn", channel: 0, note: 60, velocity: 96 },
      { tick: 96, type: "noteOff", channel: 0, note: 60, velocity: 0 },
    ]);
    expect(f.tracks[4]!.events.slice(1)).toEqual([
      { tick: 0, type: "noteOn", channel: 9, note: 35, velocity: 120 },
      { tick: 24, type: "noteOff", channel: 9, note: 35, velocity: 0 },
    ]);
  });

  test("UI-64/E02 parseSmf: ランニングステータス・velocity 0 の Note On（noteOn のまま）・3/4 の拍子", () => {
    const body = [
      ...timeSigEv(3, 4), // dt 0 は track が前に付ける
      ...[0, 0x91, 64, 80], // Note On ch2
      ...[10, 64, 0], // ランニングステータスの Note On velocity 0
      ...[0, 67, 90], // もう一度ランニングステータス
    ];
    const f = parseSmf(smf({ tracks: [[...track([{ dt: 0, bytes: body }], 5)]] }));
    expect(f.tracks[0]!.events).toEqual([
      { tick: 0, type: "timeSignature", num: 3, den: 4 },
      { tick: 0, type: "noteOn", channel: 1, note: 64, velocity: 80 },
      { tick: 10, type: "noteOn", channel: 1, note: 64, velocity: 0 },
      { tick: 10, type: "noteOn", channel: 1, note: 67, velocity: 90 },
    ]);
    expect(f.tracks[0]!.end).toBe(15);
    expect(f.tracks[0]!.name).toBeNull();
  });

  test("UI-64/E02 parseSmf: 無視されるイベント（CC・pitchwheel・aftertouch・polytouch・sysex）と他のメタ", () => {
    const f = parseSmf(
      smf({
        tracks: [
          track([
            { dt: 0, bytes: [0xb0, 7, 100] },
            { dt: 1, bytes: [0xe0, 0, 64] },
            { dt: 1, bytes: [0xd0, 5] },
            { dt: 1, bytes: [0xa0, 60, 5] },
            { dt: 1, bytes: [0xf0, ...vlq(3), 1, 2, 0xf7] },
            { dt: 1, bytes: [0xf7, ...vlq(1), 0x10] },
            { dt: 1, bytes: meta(0x59, [0, 0]) },
            { dt: 0, bytes: trackNameEv("second") },
          ]),
        ],
      }),
    );
    expect(f.tracks[0]!.events.map((e) => [e.tick, e.type])).toEqual([
      [0, "controlChange"],
      [1, "pitchwheel"],
      [2, "aftertouch"],
      [3, "polytouch"],
      [4, "sysex"],
      [5, "sysex"],
      [6, "otherMeta"],
      [6, "trackName"],
    ]);
    // name は最初の trackName だけ
    expect(f.tracks[0]!.name).toBe("second");
  });

  test("UI-64/E02 parseSmf: 最初の trackName が name。End of Track が無ければ end は最後のイベントの tick。End of Track の後ろは読まない", () => {
    const bytes = smf({
      tracks: [
        track(
          [
            { dt: 0, bytes: trackNameEv("ch1") },
            { dt: 0, bytes: trackNameEv("ch2") },
            { dt: 7, bytes: markerEv("x") },
          ],
          false,
        ),
        [...track([], 3).slice(0, 4), 0, 0, 0, 6, 0, 0xff, 0x2f, 0, 0xff, 0xff], // EOT の後ろに壊れたバイト
      ],
    });
    const f = parseSmf(bytes);
    expect(f.tracks[0]!.name).toBe("ch1");
    expect(f.tracks[0]!.end).toBe(7);
    expect(f.tracks[1]!.events).toEqual([]);
    expect(f.tracks[1]!.end).toBe(0);
  });

  test("UI-64/E02 parseSmf: テキストは latin1（mido と同じ）。テンポの 3 バイト", () => {
    const f = parseSmf(smf({ tracks: [track([{ dt: 0, bytes: meta(0x06, [0x6c, 0xe9]) }, { dt: 0, bytes: tempoEv(0x07a120) }])] }));
    expect(f.tracks[0]!.events).toEqual([
      { tick: 0, type: "marker", text: "lé" },
      { tick: 0, type: "tempo", us: 500000 },
    ]);
  });

  test("UI-64/E02 parseSmf: MTrk 以外のチャンクは飛ばし、ヘッダの ntrks 本の MTrk を読む。ヘッダの長さが 6 より長くても読む", () => {
    const unknown = [0x58, 0x58, 0x58, 0x58, 0, 0, 0, 2, 1, 2];
    const f = parseSmf(smf({ ntrks: 1, tracks: [unknown, track([{ dt: 0, bytes: program(0, 3) }])] }));
    expect(f.tracks).toHaveLength(1);
    expect(f.tracks[0]!.events).toEqual([{ tick: 0, type: "programChange", channel: 0, program: 3 }]);
    const long = conformingSong();
    const head = [...long.slice(0, 4), 0, 0, 0, 8, ...long.slice(8, 14), 0xaa, 0xbb, ...long.slice(14)];
    expect(parseSmf(new Uint8Array(head)).tracks).toHaveLength(5);
  });

  test("UI-64/E02 parseSmf: 読めないものは SmfError", () => {
    const ok = conformingSong();
    const bad: [string, Uint8Array][] = [
      ["空", new Uint8Array()],
      ["MThd でない", new Uint8Array([0x52, 0x49, 0x46, 0x46, ...ok.slice(4)])],
      ["ヘッダが切れている", ok.slice(0, 10)],
      ["トラックが切れている", ok.slice(0, ok.length - 5)],
      ["ntrks より MTrk が少ない", smf({ ntrks: 2, tracks: [track([])] })],
      ["SMPTE の division", smf({ ppq: 0xe728, tracks: [track([])] })],
      ["ppq 0", smf({ ppq: 0, tracks: [track([])] })],
      ["VLQ の途中で終わる", smf({ tracks: [[0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, 2, 0x81, 0x80]] })],
      ["VLQ が 4 バイトを超える", smf({ tracks: [track([{ dt: 0, bytes: [0xff, 0x01, 0x81, 0x81, 0x81, 0x81, 0x01] }])] })],
      ["データバイトが 0x80 以上", smf({ tracks: [track([{ dt: 0, bytes: [0x90, 0x80, 10] }])] })],
      ["ランニングステータスの無い先頭データ", smf({ tracks: [track([{ dt: 0, bytes: [60, 10] }])] })],
      ["メタの後のランニングステータス無し", smf({ tracks: [track([{ dt: 0, bytes: markerEv("a") }, { dt: 0, bytes: [60, 10] }])] })],
      ["メタの長さがトラックを越える", smf({ tracks: [track([{ dt: 0, bytes: [0xff, 0x06, 0x7f, 0x41] }])] })],
      ["テンポが 3 バイトでない", smf({ tracks: [track([{ dt: 0, bytes: meta(0x51, [1, 2]) }])] })],
      ["拍子が 4 バイトより短い", smf({ tracks: [track([{ dt: 0, bytes: meta(0x58, [4]) }])] })],
      ["システムコモン（0xF1）", smf({ tracks: [track([{ dt: 0, bytes: [0xf1, 0] }])] })],
    ];
    for (const [what, b] of bad) expect(() => parseSmf(b), what).toThrow(SmfError);
  });

  test("UI-64/E02 parseSmf: Note On / Off の組を noteOff の velocity も含めて読む", () => {
    const f = parseSmf(smf({ tracks: [track([{ dt: 0, bytes: noteOn(2, 50, 1) }, { dt: 3, bytes: noteOff(2, 50, 64) }])] }));
    expect(f.tracks[0]!.events).toEqual([
      { tick: 0, type: "noteOn", channel: 2, note: 50, velocity: 1 },
      { tick: 3, type: "noteOff", channel: 2, note: 50, velocity: 64 },
    ]);
  });
});
