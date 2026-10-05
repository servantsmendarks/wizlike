// テスト用の SMF（Standard MIDI File）の組み立て。工房の MIDI はまだ無いので、テストの中でバイト列を作る。
// conformingSong は docs/audio/CONVENTIONS.md §2 どおりの曲（UI-64 の止めるものに 1 つも当たらない）を作る。

/** 前のイベントからの tick（dt）とイベントのバイト列（ステータスから） */
export type MidiEv = { dt: number; bytes: number[] };
/** 曲の頭からの tick（t）とイベントのバイト列 */
export type AbsEv = { t: number; bytes: number[] };

export function vlq(n: number): number[] {
  if (!Number.isInteger(n) || n < 0 || n > 0x0fffffff) throw new Error(`vlq: ${n}`);
  const out = [n & 0x7f];
  for (let x = n >> 7; x > 0; x >>= 7) out.unshift((x & 0x7f) | 0x80);
  return out;
}

const u32 = (n: number): number[] => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const u16 = (n: number): number[] => [(n >> 8) & 0xff, n & 0xff];
const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0) & 0xff);

/** FF type len data */
export function meta(type: number, data: number[]): number[] {
  return [0xff, type, ...vlq(data.length), ...data];
}
export const trackNameEv = (s: string): number[] => meta(0x03, ascii(s));
export const markerEv = (s: string): number[] => meta(0x06, ascii(s));
export const tempoEv = (us: number): number[] => meta(0x51, [(us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff]);
/** den は 2 の累乗（4 なら dd = 2） */
export const timeSigEv = (num: number, den: number): number[] => meta(0x58, [num, Math.log2(den), 24, 8]);
/** channel は 0 始まり（ch4 は 9） */
export const noteOn = (channel: number, note: number, vel: number): number[] => [0x90 | channel, note, vel];
export const noteOff = (channel: number, note: number, vel = 0): number[] => [0x80 | channel, note, vel];
export const program = (channel: number, p: number): number[] => [0xc0 | channel, p];

/** MTrk + 長さ + 本体。eot が true なら dt 0 の End of Track を、数なら dt = その数の End of Track を末尾に付ける */
export function track(evs: MidiEv[], eot: boolean | number = true): number[] {
  const body = evs.flatMap((e) => [...vlq(e.dt), ...e.bytes]);
  if (eot !== false) body.push(...vlq(eot === true ? 0 : eot), 0xff, 0x2f, 0x00);
  return [...ascii("MTrk"), ...u32(body.length), ...body];
}

export function smf(o: { format?: number; ppq?: number; ntrks?: number; tracks: number[][] }): Uint8Array {
  const head = [...ascii("MThd"), ...u32(6), ...u16(o.format ?? 1), ...u16(o.ntrks ?? o.tracks.length), ...u16(o.ppq ?? 480)];
  return new Uint8Array([...head, ...o.tracks.flat()]);
}

/** 曲の頭からの tick のイベントを dt の列にする（同じ t は並びのまま） */
export function toDelta(evs: AbsEv[]): MidiEv[] {
  const sorted = evs.map((e, i) => ({ e, i })).sort((a, b) => a.e.t - b.e.t || a.i - b.i);
  let prev = 0;
  return sorted.map(({ e }) => {
    const dt = e.t - prev;
    prev = e.t;
    return { dt, bytes: e.bytes };
  });
}

/** 曲の各トラック（name が null なら名前のイベントを置かない、end が null なら End of Track を置かない） */
export type PartTrack = { name: string | null; evs: AbsEv[]; end: number | null };
export type SongParts = { format: number; ppq: number; tracks: PartTrack[] };

export type SongOptions = {
  kind?: "song" | "jingle";
  bars?: number;
  num?: 3 | 4;
  ppq?: number;
  tempoUs?: number;
};

/** 16 分 n 個の tick */
export const s16 = (n: number, ppq = 480): number => (n * ppq) / 4;

/**
 * CONV §2 どおりの曲の部品（既定: 4/4・120（500000μs）・2 小節・ループ 1-2・ch1 pulse50 で C4 の 4 分を 1 つ（velocity 96 = v12）、
 * ch2 pulse25・ch3 triangle（音なし）、ch4 kick を 16 分 1 つ）。テストは部品を書き換えてから buildSong で組み立てる。
 */
export function songParts(o: SongOptions = {}): SongParts {
  const ppq = o.ppq ?? 480;
  const num = o.num ?? 4;
  const bars = o.bars ?? 2;
  const end = bars * num * ppq;
  const kind = o.kind ?? "song";
  const conductor: AbsEv[] = [
    { t: 0, bytes: tempoEv(o.tempoUs ?? 500000) },
    { t: 0, bytes: timeSigEv(num, 4) },
    ...(kind === "song"
      ? [
          { t: 0, bytes: markerEv("loop_start") },
          { t: end, bytes: markerEv("loop_end") },
        ]
      : [{ t: end, bytes: markerEv("end") }]),
  ];
  return {
    format: 1,
    ppq,
    tracks: [
      { name: "conductor", evs: conductor, end },
      {
        name: "ch1",
        evs: [
          { t: 0, bytes: program(0, 0) },
          { t: 0, bytes: noteOn(0, 60, 96) },
          { t: ppq, bytes: noteOff(0, 60) },
        ],
        end,
      },
      { name: "ch2", evs: [{ t: 0, bytes: program(1, 1) }], end },
      { name: "ch3", evs: [{ t: 0, bytes: program(2, 3) }], end },
      {
        name: "ch4",
        evs: [
          { t: 0, bytes: noteOn(9, 35, 120) },
          { t: ppq / 4, bytes: noteOff(9, 35) },
        ],
        end,
      },
    ],
  };
}

export function buildSong(p: SongParts): Uint8Array {
  const tracks = p.tracks.map((tr) => {
    const evs: AbsEv[] = [...(tr.name === null ? [] : [{ t: 0, bytes: trackNameEv(tr.name) }]), ...tr.evs];
    const deltas = toDelta(evs);
    if (tr.end === null) return track(deltas, false);
    const last = evs.reduce((m, e) => Math.max(m, e.t), 0);
    if (tr.end < last) throw new Error(`buildSong: end ${tr.end} < last event ${last}`);
    return track(deltas, tr.end - last);
  });
  return smf({ format: p.format, ppq: p.ppq, tracks });
}

/** CONV §2 どおりの曲（songParts の既定のまま組み立てたもの） */
export function conformingSong(o: SongOptions = {}): Uint8Array {
  return buildSong(songParts(o));
}
