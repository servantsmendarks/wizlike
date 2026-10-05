// UI-64/E02: SMF（Standard MIDI File）の読み込み。依存パッケージを使わない純粋な関数（CLAUDE.md §2）。
// ビルド時（vite.config.ts のプラグイン）だけで使う。DOM・node の API を使わない。
// 読み方は工房の道具（mido と notetext.scan_midi）に揃える: トラックごとに絶対 tick のイベント列、
// name は最初のトラック名、end は最後の End of Track の tick（無ければ最後のイベントの tick）。
// End of Track の後もチャンクの末尾まで読む。

export type SmfEvent =
  | { tick: number; type: "noteOn" | "noteOff"; channel: number; note: number; velocity: number }
  | { tick: number; type: "programChange"; channel: number; program: number }
  | { tick: number; type: "controlChange" | "pitchwheel" | "aftertouch" | "polytouch"; channel: number }
  | { tick: number; type: "sysex" }
  /** テキストは latin1 で復号する（mido と同じ） */
  | { tick: number; type: "trackName" | "marker"; text: string }
  | { tick: number; type: "tempo"; us: number }
  /** den = 2 ** dd */
  | { tick: number; type: "timeSignature"; num: number; den: number }
  | { tick: number; type: "otherMeta"; meta: number };

export type SmfTrack = {
  /** ファイルの中の MTrk の順（0 始まり） */
  index: number;
  /** 最初のトラック名のイベントの文字列（strip しない）。無ければ null */
  name: string | null;
  /** End of Track を除くイベント（ファイルの順） */
  events: SmfEvent[];
  /** 最後の End of Track の tick。無ければ最後のイベントの tick（イベントが無ければ 0） */
  end: number;
};

export type SmfFile = { format: number; ppq: number; tracks: SmfTrack[] };

/** MIDI として読めない（UI-64/E02） */
export class SmfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmfError";
  }
}

const MAX_VLQ_BYTES = 4;

class Reader {
  pos: number;
  constructor(
    private readonly b: Uint8Array,
    start: number,
    private readonly limit: number,
  ) {
    this.pos = start;
  }
  get done(): boolean {
    return this.pos >= this.limit;
  }
  byte(what: string): number {
    if (this.pos >= this.limit) throw new SmfError(`unexpected end of data (${what}) at byte ${this.pos}`);
    return this.b[this.pos++]!;
  }
  data(what: string): number {
    const at = this.pos;
    const v = this.byte(what);
    if (v >= 0x80) throw new SmfError(`data byte 0x${v.toString(16)} >= 0x80 (${what}) at byte ${at}`);
    return v;
  }
  bytes(n: number, what: string): Uint8Array {
    if (this.pos + n > this.limit) throw new SmfError(`unexpected end of data (${what}, ${n} bytes) at byte ${this.pos}`);
    const out = this.b.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  vlq(what: string): number {
    let n = 0;
    for (let i = 0; i < MAX_VLQ_BYTES; i++) {
      const v = this.byte(what);
      n = n * 128 + (v & 0x7f);
      if ((v & 0x80) === 0) return n;
    }
    throw new SmfError(`variable-length quantity longer than ${MAX_VLQ_BYTES} bytes (${what}) at byte ${this.pos}`);
  }
}

const u32 = (b: Uint8Array, i: number): number => ((b[i]! << 24) >>> 0) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!;
const u16 = (b: Uint8Array, i: number): number => (b[i]! << 8) + b[i + 1]!;
const chunkType = (b: Uint8Array, i: number): string => String.fromCharCode(b[i]!, b[i + 1]!, b[i + 2]!, b[i + 3]!);
const latin1 = (b: Uint8Array): string => String.fromCharCode(...b);

function parseTrack(bytes: Uint8Array, start: number, limit: number, index: number): SmfTrack {
  const r = new Reader(bytes, start, limit);
  const events: SmfEvent[] = [];
  let tick = 0;
  let running: number | null = null;
  let name: string | null = null;
  let end: number | null = null;
  while (!r.done) {
    tick += r.vlq("delta time");
    const first = r.byte("status");
    let status: number;
    let pending: number | null = null;
    if (first < 0x80) {
      if (running === null) throw new SmfError(`running status without a previous status at byte ${r.pos - 1}`);
      status = running;
      pending = first;
    } else {
      status = first;
    }
    const d = (what: string): number => {
      if (pending !== null) {
        const v = pending;
        pending = null;
        return v;
      }
      return r.data(what);
    };

    if (status === 0xff) {
      // メタはランニングステータスを変えない
      const type = r.byte("meta type");
      const len = r.vlq("meta length");
      const body = r.bytes(len, "meta data");
      if (type === 0x2f) {
        // End of Track の後もチャンクの末尾まで読む（mido の read_track と同じ）。
        // 後ろのイベントも events に入れ、end は最後の End of Track（notetext.scan_midi と同じ）
        end = tick;
        continue;
      }
      if (type === 0x03 || type === 0x06) {
        const text = latin1(body);
        events.push({ tick, type: type === 0x03 ? "trackName" : "marker", text });
        if (type === 0x03 && name === null) name = text;
      } else if (type === 0x51) {
        if (len !== 3) throw new SmfError(`tempo meta must have 3 bytes, got ${len}`);
        events.push({ tick, type: "tempo", us: (body[0]! << 16) + (body[1]! << 8) + body[2]! });
      } else if (type === 0x58) {
        if (len < 4) throw new SmfError(`time signature meta must have 4 bytes, got ${len}`);
        events.push({ tick, type: "timeSignature", num: body[0]!, den: 2 ** body[1]! });
      } else {
        events.push({ tick, type: "otherMeta", meta: type });
      }
      continue;
    }
    if (status === 0xf0 || status === 0xf7) {
      const len = r.vlq("sysex length");
      r.bytes(len, "sysex data");
      events.push({ tick, type: "sysex" });
      running = null;
      continue;
    }
    if (status >= 0xf0) throw new SmfError(`unsupported status 0x${status.toString(16)} at byte ${r.pos - 1}`);

    running = status;
    const channel = status & 0x0f;
    switch (status & 0xf0) {
      case 0x80:
      case 0x90: {
        const note = d("note");
        const velocity = d("velocity");
        events.push({ tick, type: (status & 0xf0) === 0x90 ? "noteOn" : "noteOff", channel, note, velocity });
        break;
      }
      case 0xa0:
        d("polytouch note");
        d("polytouch value");
        events.push({ tick, type: "polytouch", channel });
        break;
      case 0xb0:
        d("control");
        d("control value");
        events.push({ tick, type: "controlChange", channel });
        break;
      case 0xc0:
        events.push({ tick, type: "programChange", channel, program: d("program") });
        break;
      case 0xd0:
        d("aftertouch value");
        events.push({ tick, type: "aftertouch", channel });
        break;
      default: // 0xe0
        d("pitchwheel lsb");
        d("pitchwheel msb");
        events.push({ tick, type: "pitchwheel", channel });
        break;
    }
  }
  const last = events.length > 0 ? events[events.length - 1]!.tick : 0;
  return { index, name, events, end: end ?? last };
}

/** SMF を読む。読めなければ SmfError（UI-64/E02） */
export function parseSmf(bytes: Uint8Array): SmfFile {
  if (bytes.length < 14 || chunkType(bytes, 0) !== "MThd") throw new SmfError("not a standard MIDI file (no MThd header)");
  const headLen = u32(bytes, 4);
  if (headLen < 6 || 8 + headLen > bytes.length) throw new SmfError(`invalid MThd length ${headLen}`);
  const format = u16(bytes, 8);
  const ntrks = u16(bytes, 10);
  const division = u16(bytes, 12);
  if (division & 0x8000) throw new SmfError("SMPTE time division is not supported");
  if (division === 0) throw new SmfError("ticks per quarter note must be > 0");

  const tracks: SmfTrack[] = [];
  let pos = 8 + headLen;
  while (tracks.length < ntrks) {
    if (pos + 8 > bytes.length) throw new SmfError(`expected ${ntrks} track(s), found ${tracks.length}`);
    const type = chunkType(bytes, pos);
    const len = u32(bytes, pos + 4);
    const start = pos + 8;
    if (start + len > bytes.length) throw new SmfError(`chunk ${JSON.stringify(type)} at byte ${pos} is truncated`);
    if (type === "MTrk") tracks.push(parseTrack(bytes, start, start + len, tracks.length));
    pos = start + len;
  }
  return { format, ppq: division, tracks };
}
