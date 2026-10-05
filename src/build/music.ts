// UI-63 / UI-64: 曲の MIDI（assets/music/<name>.mid）の検証と SongData への変換。純粋な関数（DOM・node の API を使わない）。
// 検証は工房（make-assets）の tools/music/lint.py の _lint_midi と同じ基準（docs/audio/CONVENTIONS.md §2 / §5）。
// ゲームは工房の txt を持たないので、txt の bars の代わりに指揮トラック（トラック 0）の End of Track を曲末とし、
// ループの位置は「loop_start < loop_end <= 曲末」で判定する（G01・L29）。txt との照合と様式カードの音階は行わない。
// 項目 ID（L01 など）は lint の止めるものと 1 対 1（docs/spec/ui.md の UI-64）。

import type { AudioData, Wavetables } from "../core/data/types";
import type { AssetIssue, NoiseNote, SongData, ToneNote } from "./asset-types";
import type { SmfEvent, SmfFile } from "./smf";

export type MusicContext = { wavetables: Wavetables; audio: AudioData };

/** Note On と終わりを組にした音（tick） */
export type RawNote = { start: number; end: number; note: number; velocity: number; channel: number };

const CHANNELS = [1, 2, 3, 4] as const;
type Ch = (typeof CHANNELS)[number];
/** CONV §2: ch1〜ch3 は MIDI チャンネル 0〜2、ch4 は 9（0 始まり） */
const MIDI_CHANNEL: Record<Ch, number> = { 1: 0, 2: 1, 3: 2, 4: 9 };
/** CONV §2: 拍子は 4/4 か 3/4 */
const TIMES: readonly (readonly [number, number])[] = [
  [4, 4],
  [3, 4],
];
const MARKER_LOOP_START = "loop_start";
const MARKER_LOOP_END = "loop_end";
const MARKER_END = "end";
/** CONV §5: 再生機が無視するイベント（警告 W03） */
const IGNORED_TYPES = ["controlChange", "pitchwheel", "aftertouch", "polytouch", "sysex"] as const;

/** v = clamp(floor(velocity / 8 + 0.5), 1, 15)（工房の notetext.velocity_to_v と同じ整数計算） */
export function velocityToV(vel: number): number {
  return Math.max(1, Math.min(15, (vel * 2 + 8) >> 4));
}

const isNoteOff = (e: SmfEvent): boolean => e.type === "noteOff" || (e.type === "noteOn" && e.velocity === 0);

/**
 * Note On と終わり（Note Off か velocity 0 の Note On）を組にする（工房の notetext.pair_notes と同じ）。
 * 同じ tick では終わりを先に処理する。キーは (channel, note)。notes は (start, channel, note) の昇順。
 */
export function pairNotes(events: readonly SmfEvent[]): { notes: RawNote[]; problems: { tick: number; text: string }[] } {
  type NoteEv = Extract<SmfEvent, { type: "noteOn" | "noteOff" }>;
  const order = events
    .map((e, k) => ({ e, k }))
    .filter((x): x is { e: NoteEv; k: number } => x.e.type === "noteOn" || x.e.type === "noteOff")
    .sort((a, b) => a.e.tick - b.e.tick || (isNoteOff(a.e) ? 0 : 1) - (isNoteOff(b.e) ? 0 : 1) || a.k - b.k);
  const notes: RawNote[] = [];
  const problems: { tick: number; text: string }[] = [];
  const active = new Map<string, { start: number; velocity: number; channel: number; note: number }>();
  for (const { e } of order) {
    const key = `${e.channel}:${e.note}`;
    const a = active.get(key);
    if (isNoteOff(e)) {
      if (a) {
        active.delete(key);
        notes.push({ start: a.start, end: e.tick, note: e.note, velocity: a.velocity, channel: e.channel });
      }
      continue;
    }
    if (a) {
      problems.push({ tick: e.tick, text: `note ${e.note} retriggered before its end` });
      active.delete(key);
      notes.push({ start: a.start, end: e.tick, note: e.note, velocity: a.velocity, channel: e.channel });
    }
    active.set(key, { start: e.tick, velocity: e.velocity, channel: e.channel, note: e.note });
  }
  for (const a of active.values()) problems.push({ tick: a.start, text: `note ${a.note} has no end` });
  notes.sort((x, y) => x.start - y.start || x.channel - y.channel || x.note - y.note);
  return { notes, problems };
}

/** トラック名（前後の空白を除く）が ch1〜ch4 ならその番号 */
function trackChannel(name: string | null): Ch | null {
  if (name === null) return null;
  const m = /^ch([1-4])$/.exec(name.trim());
  return m ? (Number(m[1]) as Ch) : null;
}

function waveOfProgram(wt: Wavetables, p: number): string | null {
  for (const [name, w] of Object.entries(wt.waves)) if (w.program === p) return name;
  return null;
}

type Collected = { track: number; tick: number };

/**
 * 1 曲を検査し、止めるものが無ければ SongData にする。
 * name（ファイル名の stem）が audio.json の music.songs にも jingles にも無ければ E01 だけを返す。
 */
export function checkSong(
  file: string,
  name: string,
  smf: SmfFile,
  cx: MusicContext,
): { song: SongData | null; errors: AssetIssue[]; warnings: AssetIssue[] } {
  const errors: AssetIssue[] = [];
  const warnings: AssetIssue[] = [];
  const err = (id: string, message: string): void => void errors.push({ file, id, message });
  const warn = (id: string, message: string): void => void warnings.push({ file, id, message });

  const { songs, jingles, noteRange } = cx.audio.music;
  const kind: "song" | "jingle" | null = songs.includes(name) ? "song" : jingles.includes(name) ? "jingle" : null;
  if (kind === null) {
    err("E01", `${JSON.stringify(name)} is in neither music.songs nor music.jingles of data/audio.json`);
    return { song: null, errors, warnings };
  }

  const ppq = smf.ppq;
  const tracks = smf.tracks;
  const [lo, hi] = noteRange;
  const noiseByNote = new Map(Object.entries(cx.wavetables.noise).map(([k, n]) => [n.note, k]));
  const onGrid = (tick: number): boolean => (tick * 4) % ppq === 0;

  // 拍子（ちょうど 1 個で 4/4 か 3/4 のときだけ小節の長さが決まる）
  const times: (Collected & { num: number; den: number })[] = [];
  const tempos: (Collected & { us: number })[] = [];
  const markers: (Collected & { text: string })[] = [];
  for (const t of tracks)
    for (const e of t.events) {
      if (e.type === "tempo") tempos.push({ track: t.index, tick: e.tick, us: e.us });
      else if (e.type === "timeSignature") times.push({ track: t.index, tick: e.tick, num: e.num, den: e.den });
      else if (e.type === "marker") markers.push({ track: t.index, tick: e.tick, text: e.text.trim() });
    }
  const time = times.length === 1 && TIMES.some(([n, d]) => n === times[0]!.num && d === times[0]!.den) ? times[0]! : null;
  const barLen16 = time ? (time.num * 16) / time.den : 16;
  const barTicks = time ? (time.num * 4 * ppq) / time.den : null;
  /** 曲末 = 指揮トラック（トラック 0）の End of Track（無ければ最後のイベントの tick） */
  const endTick = tracks[0]?.end ?? 0;

  /** 位置の表示（小節.拍[.16 分]。格子外は tick） */
  const pos = (tick: number): string => {
    if (!onGrid(tick)) return `tick ${tick}`;
    const p = (tick * 4) / ppq;
    const bar = Math.floor(p / barLen16);
    const r = p - bar * barLen16;
    const beat = Math.floor(r / 4);
    const s = r % 4;
    return `${bar + 1}.${beat + 1}` + (s === 0 ? "" : `.${s + 1}`);
  };

  if (smf.format !== 1) err("L01", `SMF format must be 1, got ${smf.format}`);
  const counts = new Map<Ch, number>();
  for (const t of tracks) {
    const c = trackChannel(t.name);
    if (c !== null) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  for (const c of CHANNELS) {
    const n = counts.get(c) ?? 0;
    if (n !== 1) err("L02", `expected exactly 1 track named ch${c}, found ${n}`);
  }
  const t0 = tracks[0];
  if (t0 && trackChannel(t0.name) !== null) err("L03", "track 0 must be the conductor track, not a ch track");
  else if (t0 && t0.name !== "conductor") warn("W01", `track 0 is named ${JSON.stringify(t0.name)}, not "conductor"`);

  const ignored = new Map<string, number>();
  const chNotes = new Map<Ch, RawNote[]>();
  const chProgram = new Map<Ch, number>();
  const checkEnd = barTicks !== null; // 拍子が不正なら小節と曲末に依る検査（L12・L17・L26〜L33・G01）は行わない

  for (const t of tracks) {
    const c = trackChannel(t.name);
    const label = c !== null ? `ch${c}` : `track ${t.index} (${t.name ?? "unnamed"})`;
    const badChan = new Set<number>();
    const progs: { tick: number; program: number }[] = [];
    for (const e of t.events) {
      if ((IGNORED_TYPES as readonly string[]).includes(e.type)) ignored.set(e.type, (ignored.get(e.type) ?? 0) + 1);
      if (c !== null && "channel" in e && e.channel !== MIDI_CHANNEL[c]) badChan.add(e.channel + 1);
      if (e.type === "programChange") progs.push({ tick: e.tick, program: e.program });
    }
    if (c !== null && badChan.size > 0)
      err("L04", `${label}: MIDI channel(s) ${[...badChan].sort((a, b) => a - b).join(", ")} differ from ${MIDI_CHANNEL[c] + 1}`);

    const { notes, problems } = pairNotes(t.events);
    for (const p of problems) err("L05", `${label}: ${p.text} (${pos(p.tick)})`);
    if (c === null) {
      if (notes.length > 0) err("L06", `${label} has notes (notes belong to ch1..ch4 only)`);
      if (progs.length > 0) err("L07", `${label} has a Program Change`);
    } else {
      chNotes.set(c, notes);
      const off = notes.filter((n) => !(onGrid(n.start) && onGrid(n.end)));
      if (off.length > 0)
        err("L08", `${label}: ${off.length} note(s) off the 16th-note grid (first at tick ${off[0]!.start}..${off[0]!.end})`);
      if (c === 4) {
        const bad = [...new Set(notes.filter((n) => !noiseByNote.has(n.note)).map((n) => n.note))].sort((a, b) => a - b);
        if (bad.length > 0)
          err("L09", `ch4: undefined noise note(s) ${bad.join(", ")} (only ${[...noiseByNote.keys()].sort((a, b) => a - b).join(", ")})`);
      } else {
        const out = notes.filter((n) => n.note < lo || n.note > hi);
        if (out.length > 0) err("L10", `${label}: ${out.length} note(s) out of range ${lo}..${hi} (first at ${pos(out[0]!.start)}, note ${out[0]!.note})`);
      }
      for (let i = 1; i < notes.length; i++) {
        if (notes[i]!.start < notes[i - 1]!.end) {
          err("L11", `${label}: notes overlap at ${pos(notes[i]!.start)}`);
          break;
        }
      }
      if (checkEnd) {
        const late = notes.filter((n) => n.end > endTick);
        if (late.length > 0) err("L12", `${label}: ${late.length} note(s) end after the song end ${pos(endTick)}`);
      }
      if (c === 4) {
        if (progs.length > 0) warn("W02", "ch4 has a Program Change (the player ignores it)");
      } else {
        if (progs.some((p) => p.tick !== 0)) err("L13", `${label}: Program Change outside tick 0 (no changes within a song)`);
        const p0 = progs.filter((p) => p.tick === 0).map((p) => p.program);
        if (p0.length !== 1) err("L14", `${label}: expected 1 Program Change at tick 0, found ${p0.length}`);
        for (const p of [...new Set(p0)].sort((a, b) => a - b)) {
          if (waveOfProgram(cx.wavetables, p) === null) err("L15", `${label}: Program Change ${p} is not a wave in data/wavetables.json`);
        }
        if (p0.length === 1) chProgram.set(c, p0[0]!);
      }
    }
    if (checkEnd && t.end !== endTick) err("L17", `${label}: End of Track at tick ${t.end} differs from the song end (track 0) at tick ${endTick}`);
  }

  if (checkEnd && (endTick === 0 || endTick % barTicks !== 0))
    err("G01", `song end (End of Track of track 0) at tick ${endTick} must be > 0 and at the start of a bar (${barTicks} ticks)`);

  const once = (ids: [string, string, string], what: string, items: Collected[]): void => {
    if (items.length !== 1) err(ids[0], `${what} appears ${items.length} time(s) (exactly once at tick 0)`);
    for (const x of items) {
      if (x.tick !== 0) err(ids[1], `${what} at tick ${x.tick} (only at tick 0)`);
      if (x.track !== 0) err(ids[2], `${what} in track ${x.track} (only in the conductor track)`);
    }
  };
  once(["L18", "L19", "L20"], "tempo", tempos);
  once(["L21", "L22", "L23"], "time signature", times);
  for (const x of times) if (!TIMES.some(([n, d]) => n === x.num && d === x.den)) err("L24", `time signature ${x.num}/${x.den} (only 4/4 or 3/4)`);
  if (markers.some((m) => m.track !== 0)) err("L25", "markers outside the conductor track");
  if (ignored.size > 0)
    warn("W03", `ignored events: ${[...ignored.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, n]) => `${k} x ${n}`).join(", ")}`);

  const other = [...new Set(markers.map((m) => m.text).filter((x) => x !== MARKER_LOOP_START && x !== MARKER_LOOP_END && x !== MARKER_END))];
  if (other.length > 0) warn("W06", `unknown marker(s) ignored: ${other.sort().join(", ")}`);

  let loopTicks: { start: number; end: number } | null = null;
  if (checkEnd) {
    const ticksOf = (text: string): number[] => markers.filter((m) => m.text === text).map((m) => m.tick);
    if (kind === "song") {
      const found: number[][] = [];
      for (const text of [MARKER_LOOP_START, MARKER_LOOP_END]) {
        const ts = ticksOf(text);
        found.push(ts);
        if (ts.length === 0) err("L26", `loop marker ${text} is missing (looping song)`);
        else if (ts.length > 1) err("L27", `loop marker ${text} appears ${ts.length} times`);
        for (const t of ts) if (t % barTicks !== 0) err("L28", `loop marker ${text} is not at the start of a bar (${pos(t)})`);
      }
      const [ls, le] = found as [number[], number[]];
      if (ls.length === 1 && le.length === 1 && ls[0]! % barTicks === 0 && le[0]! % barTicks === 0) {
        if (!(ls[0]! < le[0]! && le[0]! <= endTick))
          err("L29", `loop markers must satisfy loop_start < loop_end <= song end (loop_start ${pos(ls[0]!)}, loop_end ${pos(le[0]!)}, end ${pos(endTick)})`);
        else loopTicks = { start: ls[0]!, end: le[0]! };
      }
      if (ticksOf(MARKER_END).length > 0) err("L30", "a looping song must not have an end marker");
    } else {
      const ends = ticksOf(MARKER_END);
      if (ends.length === 0) err("L31", "a jingle needs an end marker");
      else if (ends.some((t) => t !== endTick)) err("L32", `end marker is not at the song end (${pos(endTick)})`);
      if (ticksOf(MARKER_LOOP_START).length + ticksOf(MARKER_LOOP_END).length > 0) err("L33", "a jingle must not have loop markers");
    }
  }

  if (errors.length > 0 || time === null || barTicks === null) return { song: null, errors, warnings };

  // ---- 変換（止めるものが無いときだけ。位置は L08 を通っているので 16 分の整数） ----
  const p16 = (tick: number): number => (tick * 4) / ppq;
  const tone = (c: 1 | 2 | 3): ToneNote[] =>
    (chNotes.get(c) ?? []).map((n) => [p16(n.start), p16(n.end) - p16(n.start), n.note, velocityToV(n.velocity)] as const);
  const noise: NoiseNote[] = (chNotes.get(4) ?? []).map(
    (n) => [p16(n.start), p16(n.end) - p16(n.start), noiseByNote.get(n.note)!, velocityToV(n.velocity)] as const,
  );
  const wave = (c: 1 | 2 | 3): string => waveOfProgram(cx.wavetables, chProgram.get(c)!)!;
  const bars = endTick / barTicks;
  const song: SongData = {
    name,
    kind,
    tempoUs: tempos[0]!.us,
    time: [time.num, time.den],
    barLen16,
    bars,
    end16: bars * barLen16,
    loop: loopTicks ? { start16: p16(loopTicks.start), end16: p16(loopTicks.end) } : null,
    waves: [wave(1), wave(2), wave(3)],
    ch: [tone(1), tone(2), tone(3), noise],
  };
  styleWarnings(song, warn);
  return { song, errors, warnings };
}

/** 工房の lint の _style_warnings のうち、音符だけで判定できる 2 つ（W04・W05）。音階（カード）は行わない */
function styleWarnings(song: SongData, warn: (id: string, message: string) => void): void {
  const blen = song.barLen16;
  const all: [Ch, readonly (readonly [number, number, number | string, number])[]][] = [
    [1, song.ch[0]],
    [2, song.ch[1]],
    [3, song.ch[2]],
    [4, song.ch[3]],
  ];
  for (const [c, notes] of all) {
    for (let bar = 0; bar < song.bars; bar++) {
      const lo = bar * blen;
      const hi = lo + blen;
      let run = 0;
      let best = 0;
      let prevEnd: number | null = null;
      for (const [start, len] of notes) {
        if (!(lo <= start && start < hi)) continue;
        if (len === 1 && start === prevEnd && run > 0) run += 1;
        else if (len === 1) run = 1;
        else run = 0;
        prevEnd = start + len;
        best = Math.max(best, run);
      }
      if (best >= 16) warn("W04", `ch${c} bar ${bar + 1}: 16 sixteenth notes in a row`);
    }
  }
  const blocks = new Map<string, string[]>();
  for (let k = 0; k < Math.floor(song.bars / 2); k++) {
    const lo = 2 * k * blen;
    const hi = lo + 2 * blen;
    const key = all
      .flatMap(([c, notes]) => notes.filter(([s]) => lo <= s && s < hi).map(([s, len, pitch, v]) => JSON.stringify([c, s - lo, String(pitch), len, v])))
      .sort();
    if (key.length === 0) continue;
    const k2 = key.join("|");
    const where = blocks.get(k2) ?? [];
    where.push(`${2 * k + 1}-${2 * k + 2}`);
    blocks.set(k2, where);
  }
  for (const where of blocks.values())
    if (where.length >= 4) warn("W05", `the same 2-bar block appears ${where.length} times (bars ${where.join(", ")})`);
}

