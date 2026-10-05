import { describe, expect, test } from "vitest";
import { checkSong, pairNotes, velocityToV, type MusicContext } from "../src/build/music";
import { parseSmf, type SmfEvent } from "../src/build/smf";
import { data } from "./helpers/core";
import {
  buildSong,
  markerEv,
  noteOff,
  noteOn,
  program,
  songParts,
  tempoEv,
  timeSigEv,
  type AbsEv,
  type SongOptions,
  type SongParts,
} from "./helpers/midi";

const cx: MusicContext = { wavetables: data.wavetables, audio: data.audio };
const BAR = 1920; // 4/4・PPQ 480 の 1 小節
const END = 2 * BAR;

function check(p: SongParts, name = "town") {
  return checkSong(`assets/music/${name}.mid`, name, parseSmf(buildSong(p)), cx);
}
const ids = (xs: { id: string }[]): string[] => xs.map((x) => x.id);
/** 既定の曲の部品を mutate で書き換えて検査し、止めるものの ID の列を返す */
function errorsOf(mutate: (p: SongParts) => void, name = "town", o: SongOptions = {}): string[] {
  const p = songParts({ kind: data.audio.music.jingles.includes(name) ? "jingle" : "song", ...o });
  mutate(p);
  const r = check(p, name);
  if (r.errors.length > 0) expect(r.song).toBeNull();
  return ids(r.errors);
}
function warningsOf(mutate: (p: SongParts) => void, name = "town", o: SongOptions = {}): string[] {
  const p = songParts({ kind: data.audio.music.jingles.includes(name) ? "jingle" : "song", ...o });
  mutate(p);
  const r = check(p, name);
  expect(ids(r.errors)).toEqual([]);
  return ids(r.warnings);
}
const tr = (p: SongParts, i: number) => p.tracks[i]!;
/** conductor の evs から目印 text を除く */
const dropMarker = (p: SongParts, text: string): void => {
  const c = tr(p, 0);
  c.evs = c.evs.filter((e) => !isMarker(e, text));
};
const isMarker = (e: AbsEv, text: string): boolean =>
  e.bytes[0] === 0xff && e.bytes[1] === 0x06 && String.fromCharCode(...e.bytes.slice(3)) === text;

describe("UI-63 checkSong: 規約どおりの曲を SongData に", () => {
  test("UI-63 checkSong: tempoUs・time・bars・loop・waves・ch の 16 分の位置と長さ・v = velocityToV・ch4 は種類名", () => {
    const r = check(songParts());
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.song).toEqual({
      name: "town",
      kind: "song",
      tempoUs: 500000,
      time: [4, 4],
      barLen16: 16,
      bars: 2,
      end16: 32,
      loop: { start16: 0, end16: 32 },
      waves: ["pulse50", "pulse25", "triangle"],
      ch: [[[0, 4, 60, 12]], [], [], [[0, 1, "kick", 15]]],
    });
  });
  test("UI-63 ジングルは loop null、end16 = bars × barLen16", () => {
    const r = check(songParts({ kind: "jingle", bars: 3 }), "victory");
    expect(r.errors).toEqual([]);
    expect(r.song).toMatchObject({ name: "victory", kind: "jingle", loop: null, bars: 3, end16: 48 });
  });
  test("UI-63 3/4 の barLen16 は 12", () => {
    const r = check(songParts({ num: 3, bars: 4 }));
    expect(r.errors).toEqual([]);
    expect(r.song).toMatchObject({ time: [3, 4], barLen16: 12, bars: 4, end16: 48, loop: { start16: 0, end16: 48 } });
  });
  test("UI-63 PPQ 96 でも同じ SongData", () => {
    expect(check(songParts({ ppq: 96 })).song).toEqual(check(songParts()).song);
  });
  test("UI-63 ループ点は loop_start / loop_end の位置（2-3 小節のループ）、音符は開始の昇順", () => {
    const p = songParts({ bars: 4 });
    dropMarker(p, "loop_start");
    dropMarker(p, "loop_end");
    tr(p, 0).evs.push({ t: BAR, bytes: markerEv("loop_start") }, { t: 3 * BAR, bytes: markerEv("loop_end") });
    tr(p, 2).evs.push(
      { t: BAR, bytes: noteOn(1, 72, 8) },
      { t: BAR + 240, bytes: noteOff(1, 72) },
      { t: 0, bytes: noteOn(1, 36, 64) },
      { t: 120, bytes: noteOff(1, 36) },
    );
    const r = check(p);
    expect(r.errors).toEqual([]);
    expect(r.song?.loop).toEqual({ start16: 16, end16: 48 });
    expect(r.song?.ch[1]).toEqual([
      [0, 1, 36, 8],
      [16, 2, 72, 1],
    ]);
  });
  test("UI-63 トラック名の前後の空白は無視する（工房の strip と同じ）", () => {
    expect(errorsOf((p) => (tr(p, 2).name = " ch2 "))).toEqual([]);
  });
});

describe("UI-64 曲の検証（工房の lint と同じ基準。docs/audio/CONVENTIONS.md §2 / §5）", () => {
  test("UI-64/E01 ファイル名が songs にも jingles にも無ければ止める（ほかの検査はしない）", () => {
    const r = check(songParts(), "credits");
    expect(ids(r.errors)).toEqual(["E01"]);
    expect(r.errors[0]).toMatchObject({ file: "assets/music/credits.mid" });
    expect(r.song).toBeNull();
  });
  test("UI-64/L01 SMF フォーマットが 1 でなければ止める", () => {
    expect(errorsOf((p) => (p.format = 0))).toEqual(["L01"]);
    expect(errorsOf((p) => (p.format = 2))).toEqual(["L01"]);
  });
  test("UI-64/L02 ch1〜ch4 の名前のトラックがちょうど 1 本ずつでなければ止める", () => {
    expect(errorsOf((p) => p.tracks.push({ name: "ch3", evs: [{ t: 0, bytes: program(2, 3) }], end: END }))).toEqual(["L02"]);
    expect(errorsOf((p) => (tr(p, 4).name = "drums"))).toContain("L02");
  });
  test("UI-64/L03 トラック 0 が ch トラックなら止める。UI-64/W01 名前が conductor でないだけなら警告", () => {
    expect(errorsOf((p) => p.tracks.reverse())).toContain("L03");
    expect(warningsOf((p) => (tr(p, 0).name = "tempo"))).toEqual(["W01"]);
    expect(warningsOf((p) => (tr(p, 0).name = null))).toEqual(["W01"]);
  });
  test("UI-64/L04 ch トラックの MIDI チャンネルが違えば止める（ch1〜3 は 0〜2、ch4 は 9）", () => {
    expect(
      errorsOf((p) => {
        tr(p, 1).evs = [
          { t: 0, bytes: program(3, 0) },
          { t: 0, bytes: noteOn(3, 60, 96) },
          { t: 480, bytes: noteOff(3, 60) },
        ];
      }),
    ).toEqual(["L04"]);
    expect(errorsOf((p) => (tr(p, 4).evs = [{ t: 0, bytes: noteOn(3, 35, 96) }, { t: 120, bytes: noteOff(3, 35) }]))).toEqual(["L04"]);
    expect(errorsOf((p) => tr(p, 3).evs.push({ t: 0, bytes: [0xb1, 7, 100] }))).toEqual(["L04"]);
  });
  test("UI-64/L05 終わる前にもう一度鳴る・終わりが無い音は止める", () => {
    expect(errorsOf((p) => tr(p, 1).evs.push({ t: 240, bytes: noteOn(0, 60, 96) }))).toEqual(["L05"]);
    expect(errorsOf((p) => (tr(p, 1).evs = tr(p, 1).evs.filter((e) => (e.bytes[0]! & 0xf0) !== 0x80)))).toEqual(["L05"]);
  });
  test("UI-64/L06 ch 以外のトラックの音符は止める", () => {
    expect(errorsOf((p) => tr(p, 0).evs.push({ t: 0, bytes: noteOn(0, 60, 96) }, { t: 480, bytes: noteOff(0, 60) }))).toEqual(["L06"]);
  });
  test("UI-64/L07 ch 以外のトラックの Program Change は止める", () => {
    expect(errorsOf((p) => tr(p, 0).evs.push({ t: 0, bytes: program(0, 1) }))).toEqual(["L07"]);
  });
  test("UI-64/L08 ch トラックの音の始まりか終わりが 16 分の格子外なら止める（許容なし）", () => {
    expect(errorsOf((p) => (tr(p, 1).evs[2]!.t = 481))).toEqual(["L08"]);
    expect(errorsOf((p) => ((tr(p, 1).evs[1]!.t = 1), (tr(p, 1).evs[2]!.t = 481)))).toEqual(["L08"]);
    expect(errorsOf((p) => (tr(p, 1).evs[2]!.t = 600))).toEqual([]);
  });
  test("UI-64/L09 ch4 の未定義のノート（wavetables の noise に無い）は止める", () => {
    expect(errorsOf((p) => (tr(p, 4).evs = [{ t: 0, bytes: noteOn(9, 36, 96) }, { t: 120, bytes: noteOff(9, 36) }]))).toEqual(["L09"]);
    for (const n of [35, 38, 42, 46])
      expect(errorsOf((p) => (tr(p, 4).evs = [{ t: 0, bytes: noteOn(9, n, 96) }, { t: 120, bytes: noteOff(9, n) }]))).toEqual([]);
  });
  test("UI-64/L10 ch1〜3 の音域外（audio.json の noteRange 36〜96）は止める", () => {
    const one = (n: number) => (p: SongParts) => (tr(p, 1).evs = [{ t: 0, bytes: program(0, 0) }, { t: 0, bytes: noteOn(0, n, 96) }, { t: 480, bytes: noteOff(0, n) }]);
    expect(errorsOf(one(35))).toEqual(["L10"]);
    expect(errorsOf(one(97))).toEqual(["L10"]);
    expect(errorsOf(one(36))).toEqual([]);
    expect(errorsOf(one(96))).toEqual([]);
  });
  test("UI-64/L11 同一トラックの音の重なりは止める", () => {
    expect(errorsOf((p) => tr(p, 1).evs.push({ t: 240, bytes: noteOn(0, 64, 96) }, { t: 600, bytes: noteOff(0, 64) }))).toEqual(["L11"]);
    // 前の終わり = 次の始まりは重なりではない
    expect(errorsOf((p) => tr(p, 1).evs.push({ t: 480, bytes: noteOn(0, 64, 96) }, { t: 600, bytes: noteOff(0, 64) }))).toEqual([]);
  });
  test("UI-64/L12 曲末を越える音は止める（その トラックの曲末も違うので UI-64/L17 も）", () => {
    expect(errorsOf((p) => (tr(p, 1).evs.push({ t: END - 480, bytes: noteOn(0, 64, 96) }, { t: END + 480, bytes: noteOff(0, 64) }), (tr(p, 1).end = END + 480)))).toEqual([
      "L12",
      "L17",
    ]);
  });
  test("UI-64/L13 ch1〜3 の Program Change が tick 0 以外なら止める", () => {
    expect(errorsOf((p) => tr(p, 1).evs.push({ t: 480, bytes: program(0, 1) }))).toEqual(["L13"]);
  });
  test("UI-64/L14 ch1〜3 の tick 0 の Program Change が 1 個でなければ止める", () => {
    expect(errorsOf((p) => (tr(p, 2).evs = []))).toEqual(["L14"]);
    expect(errorsOf((p) => tr(p, 2).evs.push({ t: 0, bytes: program(1, 2) }))).toEqual(["L14"]);
  });
  test("UI-64/L15 Program Change の番号が wavetables に無ければ止める", () => {
    expect(errorsOf((p) => (tr(p, 3).evs = [{ t: 0, bytes: program(2, 99) }]))).toEqual(["L15"]);
  });
  test("UI-64/L17 各トラックの End of Track が曲末（指揮トラックの End of Track）と違えば止める", () => {
    expect(errorsOf((p) => (tr(p, 2).end = END + 480))).toEqual(["L17"]);
    expect(errorsOf((p) => (tr(p, 3).end = null))).toEqual(["L17"]); // End of Track が無ければ最後のイベントの tick（0）
  });
  test("UI-64/G01 曲末が 0、または小節の頭にない（txt の bars の代わり）なら止める", () => {
    expect(errorsOf((p) => p.tracks.forEach((t) => (t.end = END + 240)))).toEqual(["G01"]);
    expect(
      errorsOf(
        (p) => {
          tr(p, 0).evs = [{ t: 0, bytes: tempoEv(500000) }, { t: 0, bytes: timeSigEv(4, 4) }, { t: 0, bytes: markerEv("end") }];
          tr(p, 1).evs = [{ t: 0, bytes: program(0, 0) }];
          tr(p, 4).evs = [];
          p.tracks.forEach((t) => (t.end = 0));
        },
        "victory",
      ),
    ).toEqual(["G01"]);
  });
  test("UI-64/L18 テンポが 1 回でなければ止める（UI-64/L19 tick 0 以外、UI-64/L20 指揮トラック以外）", () => {
    expect(errorsOf((p) => tr(p, 0).evs.push({ t: 0, bytes: tempoEv(400000) }))).toEqual(["L18"]);
    expect(errorsOf((p) => (tr(p, 0).evs = tr(p, 0).evs.slice(1)))).toEqual(["L18"]);
    expect(errorsOf((p) => (tr(p, 0).evs[0]!.t = 480))).toEqual(["L19"]);
    expect(errorsOf((p) => tr(p, 1).evs.push(tr(p, 0).evs.shift()!))).toEqual(["L20"]);
  });
  test("UI-64/L21 拍子が 1 回でなければ止める（UI-64/L22 tick 0 以外、UI-64/L23 指揮トラック以外）", () => {
    expect(errorsOf((p) => tr(p, 0).evs.push({ t: 0, bytes: timeSigEv(4, 4) }))).toEqual(["L21"]);
    expect(errorsOf((p) => tr(p, 0).evs.splice(1, 1))).toEqual(["L21"]);
    expect(errorsOf((p) => (tr(p, 0).evs[1]!.t = 480))).toEqual(["L22"]);
    expect(errorsOf((p) => tr(p, 1).evs.push(tr(p, 0).evs.splice(1, 1)[0]!))).toEqual(["L23"]);
  });
  test("UI-64/L24 拍子が 4/4・3/4 以外なら止める", () => {
    expect(errorsOf((p) => (tr(p, 0).evs[1] = { t: 0, bytes: timeSigEv(6, 8) }))).toEqual(["L24"]);
    expect(errorsOf((p) => (tr(p, 0).evs[1] = { t: 0, bytes: timeSigEv(2, 4) }))).toEqual(["L24"]);
  });
  test("UI-64/L25 目印が指揮トラック以外なら止める", () => {
    expect(
      errorsOf((p) => {
        const m = tr(p, 0).evs.find((e) => isMarker(e, "loop_start"))!;
        dropMarker(p, "loop_start");
        tr(p, 1).evs.push(m);
      }),
    ).toEqual(["L25"]);
  });
  test("UI-64/L26 ループする曲に loop_start / loop_end が無ければ止める", () => {
    expect(errorsOf((p) => dropMarker(p, "loop_end"))).toEqual(["L26"]);
    expect(errorsOf((p) => dropMarker(p, "loop_start"))).toEqual(["L26"]);
  });
  test("UI-64/L27 ループする曲の目印が 2 個以上なら止める", () => {
    expect(errorsOf((p) => tr(p, 0).evs.push({ t: BAR, bytes: markerEv("loop_start") }))).toEqual(["L27"]);
  });
  test("UI-64/L28 ループする曲の目印が小節の頭にないなら止める", () => {
    expect(
      errorsOf((p) => {
        dropMarker(p, "loop_start");
        tr(p, 0).evs.push({ t: 480, bytes: markerEv("loop_start") });
      }),
    ).toEqual(["L28"]);
  });
  test("UI-64/L29 ループの位置は loop_start < loop_end <= 曲末（1 <= a <= b <= bars）", () => {
    const at = (s: number, e: number) => (p: SongParts) => {
      dropMarker(p, "loop_start");
      dropMarker(p, "loop_end");
      tr(p, 0).evs.push({ t: s, bytes: markerEv("loop_start") }, { t: e, bytes: markerEv("loop_end") });
    };
    expect(errorsOf(at(BAR, BAR))).toEqual(["L29"]);
    expect(errorsOf(at(END, BAR))).toEqual(["L29"]);
    expect(errorsOf(at(BAR, END))).toEqual([]);
    expect(errorsOf(at(0, BAR))).toEqual([]);
  });
  test("UI-64/L30 ループする曲に end の目印があれば止める", () => {
    expect(errorsOf((p) => tr(p, 0).evs.push({ t: END, bytes: markerEv("end") }))).toEqual(["L30"]);
  });
  test("UI-64/L31 ジングルに end の目印が無ければ止める", () => {
    expect(errorsOf((p) => dropMarker(p, "end"), "victory")).toEqual(["L31"]);
  });
  test("UI-64/L32 ジングルの end が曲末に無ければ止める", () => {
    expect(
      errorsOf((p) => {
        dropMarker(p, "end");
        tr(p, 0).evs.push({ t: BAR, bytes: markerEv("end") });
      }, "victory"),
    ).toEqual(["L32"]);
  });
  test("UI-64/L33 ジングルにループの目印があれば止める", () => {
    expect(errorsOf((p) => tr(p, 0).evs.push({ t: 0, bytes: markerEv("loop_start") }), "victory")).toEqual(["L33"]);
  });
  test("UI-64 止めるものはファイル名と理由を持つ", () => {
    const p = songParts();
    tr(p, 1).evs.push({ t: 240, bytes: noteOn(0, 64, 96) }, { t: 600, bytes: noteOff(0, 64) });
    const r = check(p);
    expect(r.errors).toEqual([{ file: "assets/music/town.mid", id: "L11", message: "ch1: notes overlap at 1.1.3" }]);
  });
});

describe("UI-64 曲の警告（ビルドは続く）", () => {
  test("UI-64/W02 ch4 の Program Change は警告", () => {
    expect(warningsOf((p) => tr(p, 4).evs.push({ t: 0, bytes: program(9, 0) }))).toEqual(["W02"]);
  });
  test("UI-64/W03 再生機が無視するイベント（CC・pitchwheel・aftertouch・polytouch・sysex）は種類ごとの数で警告", () => {
    const p = songParts();
    tr(p, 1).evs.push({ t: 0, bytes: [0xb0, 7, 100] }, { t: 0, bytes: [0xb0, 10, 64] }, { t: 0, bytes: [0xe0, 0, 64] });
    tr(p, 0).evs.push({ t: 0, bytes: [0xf0, 2, 1, 0xf7] });
    const r = check(p);
    expect(ids(r.errors)).toEqual([]);
    expect(r.warnings).toEqual([
      { file: "assets/music/town.mid", id: "W03", message: "ignored events: controlChange x 2, pitchwheel x 1, sysex x 1" },
    ]);
  });
  test("UI-64/W04 1 チャンネル・1 小節で長さ 1 の音が 16 個続くと警告（15 個なら無し）", () => {
    const run = (n: number) => (p: SongParts) => {
      for (let i = 0; i < n; i++) tr(p, 2).evs.push({ t: i * 120, bytes: noteOn(1, 60, 96) }, { t: (i + 1) * 120, bytes: noteOff(1, 60) });
    };
    expect(warningsOf(run(16))).toEqual(["W04"]);
    expect(warningsOf(run(15))).toEqual([]);
  });
  test("UI-64/W05 全チャンネルをまとめた 2 小節の塊が 4 回以上同じなら警告（3 回なら無し）", () => {
    const blocks = (n: number) => (p: SongParts) => {
      tr(p, 1).evs = [{ t: 0, bytes: program(0, 0) }];
      tr(p, 4).evs = [];
      for (let k = 0; k < n; k++) tr(p, 1).evs.push({ t: k * 2 * BAR, bytes: noteOn(0, 60, 96) }, { t: k * 2 * BAR + 480, bytes: noteOff(0, 60) });
    };
    expect(warningsOf(blocks(4), "town", { bars: 8 })).toEqual(["W05"]);
    expect(warningsOf(blocks(3), "town", { bars: 8 })).toEqual([]);
  });
  test("UI-64/W06 知らない目印は警告", () => {
    expect(warningsOf((p) => tr(p, 0).evs.push({ t: BAR, bytes: markerEv("verse") }))).toEqual(["W06"]);
  });
});

describe("UI-64 velocityToV と pairNotes（工房の notetext と同じ）", () => {
  test("UI-64 velocityToV: 0→1・8→1・12→2（四捨五入の切り上げ）・120→15・127→15", () => {
    expect([0, 8, 11, 12, 96, 120, 127].map(velocityToV)).toEqual([1, 1, 1, 2, 12, 15, 15]);
  });
  test("UI-64 pairNotes: 同じ tick の終わりを先に処理する（連打）。velocity 0 の Note On は終わり", () => {
    const ev = (tick: number, type: "noteOn" | "noteOff", note: number, velocity: number): SmfEvent => ({ tick, type, channel: 0, note, velocity });
    const r = pairNotes([ev(0, "noteOn", 60, 80), ev(120, "noteOn", 60, 90), ev(120, "noteOn", 60, 0), ev(240, "noteOff", 60, 0)]);
    expect(r.problems).toEqual([]);
    expect(r.notes).toEqual([
      { start: 0, end: 120, note: 60, velocity: 80, channel: 0 },
      { start: 120, end: 240, note: 60, velocity: 90, channel: 0 },
    ]);
  });
  test("UI-64 pairNotes: 問題は tick と文で返す", () => {
    const ev = (tick: number, note: number): SmfEvent => ({ tick, type: "noteOn", channel: 0, note, velocity: 80 });
    const r = pairNotes([ev(0, 60), ev(60, 60)]);
    expect(r.problems).toEqual([
      { tick: 60, text: "note 60 retriggered before its end" },
      { tick: 60, text: "note 60 has no end" },
    ]);
    expect(r.notes).toEqual([{ start: 0, end: 60, note: 60, velocity: 80, channel: 0 }]);
  });
});
