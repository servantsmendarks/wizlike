// UI-06 / UI-63 / UI-65 / UI-57: 再生機（src/presenter/audio.ts）。偽の AudioContext で呼び出しを記録する。
// UI-63（M9.5）: 曲とジングルは区間（小節）ごとの AudioBufferSourceNode の予約で鳴らす。合成の口（renderer）と
// イベントループへ戻す口（yieldTask）は偽物を注入し、テストが 1 つずつ進める。
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameAssets, SongData } from "../src/build/asset-types";
import {
  attachAudio,
  createAudioPlayer,
  createMessageChannelYield,
  createSyncRenderer,
  createWorkerRenderer,
  type AudioDeps,
  type SegmentRenderer,
  type ZzfxModule,
} from "../src/presenter/audio";
import { planSong, renderSegment, sampleAt, type SongPlan } from "../src/presenter/audio-synth";
import { createSynthHandler, type FromSynthWorker, type ToSynthWorker } from "../src/presenter/synth-protocol";
import { data } from "./helpers/core";

const RATE = data.config.audio.sampleRate;
const LEAD = data.config.audio.startLeadMs / 1000;
const PREFETCH = data.config.audio.prefetchBars;

class FakeParam {
  value = 1;
}
class FakeNode {
  connected: unknown[] = [];
  disconnected = 0;
  connect(n: unknown): void {
    this.connected.push(n);
  }
  disconnect(): void {
    this.disconnected++;
  }
}
class FakeGain extends FakeNode {
  gain = new FakeParam();
}
class FakeBuffer {
  data: Float32Array | null = null;
  constructor(
    public channels: number,
    public length: number,
    public sampleRate: number,
    /** どの曲のどの区間か（"town:0"。偽の renderer が最後に合成したもの） */
    public tag: string,
  ) {}
  copyToChannel(src: Float32Array, ch: number): void {
    if (ch === 0) this.data = src;
  }
}
class FakeSource extends FakeNode {
  buffer: FakeBuffer | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  started = 0;
  stopped = 0;
  /** start(when) の when */
  startAt: number[] = [];
  /** stop(when) の when（引数なしは undefined） */
  stopAt: (number | undefined)[] = [];
  onended: (() => void) | null = null;
  start(when?: number): void {
    this.started++;
    this.startAt.push(when ?? 0);
  }
  stop(when?: number): void {
    this.stopped++;
    this.stopAt.push(when);
  }
  /** 鳴り終わった（ended） */
  end(): void {
    this.onended?.();
  }
}
class FakeContext {
  state: "suspended" | "running" | "closed" = "suspended";
  destination = { name: "destination" };
  currentTime = 0;
  baseLatency: number | undefined = undefined;
  sampleRate = 48000;
  gains: FakeGain[] = [];
  sources: FakeSource[] = [];
  buffers: FakeBuffer[] = [];
  resumes = 0;
  suspends = 0;
  closes = 0;
  constructor(private tag: () => string = () => "?") {}
  createGain(): FakeGain {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createBuffer(ch: number, len: number, rate: number): FakeBuffer {
    const b = new FakeBuffer(ch, len, rate, this.tag());
    this.buffers.push(b);
    return b;
  }
  createBufferSource(): FakeSource {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  resume(): Promise<void> {
    this.resumes++;
    this.state = "running";
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    this.suspends++;
    this.state = "suspended";
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.closes++;
    this.state = "closed";
    return Promise.resolve();
  }
}

function songData(
  name: string,
  kind: "song" | "jingle",
  bars: number,
  o: { tempoUs?: number; loop?: { start16: number; end16: number } } = {},
): SongData {
  return {
    name,
    kind,
    tempoUs: o.tempoUs ?? 500000,
    time: [4, 4],
    barLen16: 16,
    bars,
    end16: bars * 16,
    loop: kind === "song" ? (o.loop ?? { start16: 16, end16: bars * 16 }) : null,
    waves: ["pulse50", "triangle", "organ"],
    ch: [[[0, 4, 69, 12]], [], [], [[0, 1, "kick", 15]]],
  };
}

const MUSIC: GameAssets["music"] = {
  town: songData("town", "song", 2),
  dungeon: songData("dungeon", "song", 3),
  victory: songData("victory", "jingle", 1),
  inn: songData("inn", "jingle", 4),
  // 前奏 1 小節 + ループ 5 小節（区間 0..5、ループは区間 1..5）
  long: songData("long", "song", 6),
  // ループの終わりが曲末より前（区間 0..3、ループは区間 0..1）
  cut: songData("cut", "song", 4, { loop: { start16: 0, end16: 32 } }),
  // 小節の頭が整数のサンプルにならないテンポ（区間の長さが 1 サンプル揺れる）
  odd: songData("odd", "song", 4, { tempoUs: 789474, loop: { start16: 0, end16: 64 } }),
};
const SFX: GameAssets["sfx"] = {
  hit: { name: "hit", params: [null, 0.05, 220, null, null, 0.1] },
  ok: { name: "ok", params: [1, null, 440] },
};

type Fake = {
  deps: AudioDeps;
  contexts: FakeContext[];
  zz: { ZZFX: { volume: number; sampleRate: number; audioContext: FakeContext; buildSamples: ReturnType<typeof vi.fn> } };
  vol: { music: number; sfx: number };
  loads: number;
  /** 合成を頼まれた区間（"town:0"）の順 */
  renders: string[];
  /** yieldTask に積まれた cb */
  tasks: (() => void)[];
  /** delay のとき、まだ返していない合成（release で返す） */
  held: { key: string; run: () => void }[];
};

function setup(
  o: { music?: GameAssets["music"]; sfx?: GameAssets["sfx"]; noContext?: boolean; loadFails?: boolean; delay?: boolean } = {},
): Fake {
  const contexts: FakeContext[] = [];
  const zzContext = new FakeContext();
  const zz = {
    ZZFX: {
      volume: 0.3,
      sampleRate: 44100,
      audioContext: zzContext,
      buildSamples: vi.fn((...p: (number | undefined)[]) => [0.1, -0.1, p.length]),
    },
  };
  const vol = { music: 7, sfx: 7 };
  const sync = createSyncRenderer();
  let last = "?";
  const renderer: SegmentRenderer = {
    plan: (song, wt, rate) => sync.plan(song, wt, rate),
    render: (name, plan, i, cb) => {
      const key = `${name}:${i}`;
      f.renders.push(key);
      const run = (): void => {
        last = key;
        sync.render(name, plan, i, cb);
      };
      if (o.delay === true) f.held.push({ key, run });
      else run();
    },
  };
  const f: Fake = {
    contexts,
    zz,
    vol,
    loads: 0,
    renders: [],
    tasks: [],
    held: [],
    deps: {
      createContext: () => {
        if (o.noContext === true) return null;
        const c = new FakeContext(() => last);
        contexts.push(c);
        return c as unknown as AudioContext;
      },
      loadZzfx: () => {
        f.loads++;
        return o.loadFails === true ? Promise.reject(new Error("load failed")) : Promise.resolve(zz as unknown as ZzfxModule);
      },
      data,
      assets: { music: o.music ?? MUSIC, sfx: o.sfx ?? SFX },
      volumes: () => ({ ...vol }),
      renderer,
      yieldTask: (cb) => {
        f.tasks.push(cb);
      },
    },
  };
  return f;
}

/** yieldTask に積まれた cb を 1 つ呼ぶ */
function runTask(f: Fake): void {
  const t = f.tasks.shift();
  if (t === undefined) throw new Error("no task");
  t();
}
/** yieldTask に積まれた cb を空になるまで呼ぶ */
function runTasks(f: Fake): void {
  for (let n = 0; f.tasks.length > 0; n++) {
    if (n > 100) throw new Error("tasks do not settle");
    runTask(f);
  }
}
/** delay の合成を key で返す（無ければ先頭） */
function release(f: Fake, key?: string): void {
  const k = key === undefined ? 0 : f.held.findIndex((h) => h.key === key);
  const h = f.held[k];
  if (k < 0 || h === undefined) throw new Error(`not held: ${key}`);
  f.held.splice(k, 1);
  h.run();
}
/** delay の合成と yieldTask を両方とも空になるまで進める */
function settle(f: Fake): void {
  for (let n = 0; f.held.length > 0 || f.tasks.length > 0; n++) {
    if (n > 100) throw new Error("does not settle");
    if (f.held.length > 0) release(f);
    else runTask(f);
  }
}
const tags = (c: FakeContext): string[] => c.sources.map((s) => s.buffer?.tag ?? "?");
/** まだ鳴り終わっていない（end を呼んでいない）source の先頭を終わらせる */
function endNext(c: FakeContext, ended: Set<FakeSource>): FakeSource {
  const s = c.sources.find((x) => !ended.has(x));
  if (s === undefined) throw new Error("no source");
  ended.add(s);
  s.end();
  return s;
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("UI-06 AudioContext の開始", () => {
  it("UI-06 unlock の前は context を作らず何も鳴らさない。最初の unlock で 1 回だけ作り、suspended なら resume", () => {
    const f = setup();
    const p = createAudioPlayer(f.deps);
    p.setSong("town");
    p.playJingle("victory");
    p.playSfx("hit");
    expect(f.contexts.length).toBe(0);
    p.unlock();
    expect(f.contexts.length).toBe(1);
    const c = f.contexts[0]!;
    expect(c.resumes).toBe(1);
    p.unlock();
    p.unlock();
    expect(f.contexts.length).toBe(1);
    // running なら resume しない
    expect(c.resumes).toBe(1);
    c.state = "suspended";
    p.unlock();
    expect(c.resumes).toBe(2);
    // 曲と効果音の GainNode は destination へ
    expect(c.gains.length).toBe(2);
    for (const g of c.gains) expect(g.connected).toEqual([c.destination]);
  });

  it("UI-06 setHidden(true) で suspend、false で resume", () => {
    const f = setup();
    const p = createAudioPlayer(f.deps);
    // context が無い間は何もしない（隠れている間の unlock は resume しない）
    p.setHidden(true);
    p.unlock();
    expect(f.contexts[0]?.resumes).toBe(0);
    p.setHidden(false);
    const c = f.contexts[0]!;
    p.setHidden(true);
    expect(c.suspends).toBe(1);
    expect(c.state).toBe("suspended");
    p.setHidden(false);
    expect(c.resumes).toBe(2);
    expect(c.state).toBe("running");
  });

  it("UI-06 context を作れない（古いブラウザ）なら以後無音で例外も出ない", () => {
    const f = setup({ noContext: true });
    const p = createAudioPlayer(f.deps);
    p.unlock();
    p.unlock();
    p.setSong("town");
    p.playJingle("victory");
    p.playSfx("hit");
    p.refreshVolumes();
    p.setHidden(true);
    expect(f.loads).toBe(0);
    expect(f.renders).toEqual([]);
  });

  it("UI-06 attachAudio: pointerup・touchend・keydown（capture）で unlock、visibilitychange で setHidden。外す関数で外れる", () => {
    const handlers: Record<string, { fn: () => void; capture: boolean }[]> = {};
    const doc = {
      visibilityState: "visible" as DocumentVisibilityState,
      addEventListener: (k: string, fn: () => void, opt?: { capture?: boolean }) => {
        (handlers[k] ??= []).push({ fn, capture: opt?.capture === true });
      },
      removeEventListener: (k: string, fn: () => void) => {
        handlers[k] = (handlers[k] ?? []).filter((h) => h.fn !== fn);
      },
    };
    const calls: string[] = [];
    const detach = attachAudio(doc as unknown as Document, {
      unlock: () => calls.push("unlock"),
      setHidden: (h) => calls.push(`hidden:${h}`),
    });
    for (const k of ["pointerup", "touchend", "keydown"]) {
      expect(handlers[k]?.[0]?.capture).toBe(true);
      handlers[k]?.[0]?.fn();
    }
    doc.visibilityState = "hidden";
    handlers["visibilitychange"]?.[0]?.fn();
    doc.visibilityState = "visible";
    handlers["visibilitychange"]?.[0]?.fn();
    expect(calls).toEqual(["unlock", "unlock", "unlock", "hidden:true", "hidden:false"]);
    detach();
    for (const k of ["pointerup", "touchend", "keydown", "visibilitychange"]) expect(handlers[k]).toEqual([]);
  });
});

describe("UI-63 曲とジングル", () => {
  it("UI-63 ファイルが無い曲の setSong / playJingle と効果音は無音で、例外も console.error も出ない（assets 空）", async () => {
    const err = vi.spyOn(console, "error");
    const warn = vi.spyOn(console, "warn");
    const f = setup({ music: {}, sfx: {} });
    const p = createAudioPlayer(f.deps);
    p.setSong("title");
    p.unlock();
    p.setSong("town");
    p.playJingle("victory");
    p.playSfx("ok");
    p.refreshVolumes();
    await flush();
    const c = f.contexts[0]!;
    expect(c.sources.length).toBe(0);
    expect(c.buffers.length).toBe(0);
    expect(f.renders).toEqual([]);
    // 効果音のファイルが 1 つも無ければ ZzFX を読まない（素材なしで chunk の要求を出さない）
    expect(f.loads).toBe(0);
    expect(err).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("UI-63 曲は区間の source（loop なし）で鳴らす。同じ曲の setSong は作り直さない、別の曲は前を区間 0 の時刻で止める、ファイルが無い曲は止めて無音", () => {
    const f = setup();
    const p = createAudioPlayer(f.deps);
    p.unlock();
    const c = f.contexts[0]!;
    p.setSong("town");
    expect(tags(c)).toEqual(["town:0"]);
    const s = c.sources[0]!;
    expect(s.started).toBe(1);
    expect(s.loop).toBe(false);
    expect(s.connected).toEqual([c.gains[0]]);
    p.setSong("town");
    expect(c.sources.length).toBe(1);
    expect(f.renders).toEqual(["town:0"]);
    c.currentTime = 0.5;
    p.setSong("dungeon");
    expect(s.stopAt).toEqual([0.5 + LEAD]);
    // disconnect は ended の中（すぐ切ると区間 0 の時刻までの音が切れる）
    expect(s.disconnected).toBe(0);
    s.end();
    expect(s.disconnected).toBe(1);
    expect(tags(c)).toEqual(["town:0", "dungeon:0"]);
    expect(c.sources[1]?.startAt).toEqual([0.5 + LEAD]);
    // 合成は区間ごとに 1 回（town に戻っても区間 0 を作り直さない）
    p.setSong("town");
    expect(f.renders).toEqual(["town:0", "dungeon:0"]);
    expect(c.sources[2]?.buffer).toBe(s.buffer);
    // ファイルが無い曲は止めて無音（即時の停止）
    p.setSong("boss");
    expect(c.sources[2]?.stopAt).toEqual([undefined]);
    expect(c.sources.length).toBe(3);
    p.setSong(null);
    expect(c.sources.length).toBe(3);
  });

  it("UI-63 ジングル中の setSong は終わった後に始まる。ended で場面の曲を頭から。同じジングルの再要求は無視、別のジングルは置き換え", () => {
    const f = setup();
    const p = createAudioPlayer(f.deps);
    p.unlock();
    const c = f.contexts[0]!;
    p.setSong("town");
    const town = c.sources[0]!;
    p.playJingle("victory");
    expect(town.stopped).toBe(1);
    const j = c.sources[1]!;
    expect(j.buffer?.tag).toBe("victory:0");
    expect(j.loop).toBe(false);
    expect(j.started).toBe(1);
    // ジングルの最後の区間（victory は 1 区間）を予約したので、場面の曲（town）をジングルの終わりの時刻に予約済み
    expect(tags(c)).toEqual(["town:0", "victory:0", "town:0"]);
    p.playJingle("victory");
    expect(c.sources.length).toBe(3);
    // ジングルの間の setSong は、ジングルの後の予約を取り消して新しい場面の曲を予約し直す
    p.setSong("dungeon");
    expect(tags(c)).toEqual(["town:0", "victory:0", "town:0", "dungeon:0"]);
    expect(c.sources[2]?.stopped).toBe(1);
    j.end();
    expect(c.sources.length).toBe(4);
    expect(c.sources[3]?.started).toBe(1);
    expect(c.sources[3]?.stopped).toBe(0);
    // 別のジングルは置き換え。置き換えられた方の ended は無視する
    p.playJingle("victory");
    const v = c.sources[4]!;
    expect(v.buffer?.tag).toBe("victory:0");
    p.playJingle("inn");
    const inn = c.sources[6]!;
    expect(inn.buffer?.tag).toBe("inn:0");
    expect(v.stopped).toBe(1);
    // victory の後に予約した dungeon も取り消す
    expect(c.sources[5]?.buffer?.tag).toBe("dungeon:0");
    expect(c.sources[5]?.stopped).toBe(1);
    v.end();
    expect(c.sources.length).toBe(7);
    // inn は 4 区間。最後の区間を予約したら場面の曲を予約し、全部の ended の後にそれが鳴っているものになる
    runTasks(f);
    const ended = new Set<FakeSource>(c.sources.slice(0, 6));
    for (let n = 0; n < 4; n++) endNext(c, ended);
    expect(tags(c).slice(6)).toEqual(["inn:0", "inn:1", "inn:2", "inn:3", "dungeon:0"]);
    // ファイルの無いジングルは何もしない（鳴っている曲のまま）
    const before = c.sources.length;
    p.playJingle("wipe");
    expect(c.sources.length).toBe(before);
    expect(c.sources[before - 1]?.stopped).toBe(0);
  });

  it("UI-63 unlock 前の setSong は覚えて unlock で始める、unlock 前のジングルは捨てる", () => {
    const f = setup();
    const p = createAudioPlayer(f.deps);
    p.setSong("dungeon");
    p.playJingle("victory");
    p.unlock();
    const c = f.contexts[0]!;
    expect(tags(c)).toEqual(["dungeon:0"]);
  });
});

describe("UI-63 区間の予約（M9.5）", () => {
  it("UI-63 再生: setSong は区間 0 だけを合成して currentTime + baseLatency + startLeadMs/1000 に予約する", () => {
    const f = setup();
    const p = createAudioPlayer(f.deps);
    p.unlock();
    const c = f.contexts[0]!;
    c.currentTime = 1.5;
    c.baseLatency = 0.01;
    p.setSong("long");
    expect(f.renders).toEqual(["long:0"]);
    expect(c.sources.length).toBe(1);
    expect(c.sources[0]?.startAt[0]).toBeCloseTo(1.5 + 0.01 + LEAD, 12);
    // baseLatency が無い context では currentTime + startLeadMs/1000
    const g = setup();
    const q = createAudioPlayer(g.deps);
    q.unlock();
    const d = g.contexts[0]!;
    d.currentTime = 2;
    q.setSong("town");
    expect(d.sources[0]?.startAt).toEqual([2 + LEAD]);
  });

  it("UI-63 再生: yieldTask を 1 回回すごとに 1 区間ずつ合成・予約し、1 + prefetchBars 個で止まる", () => {
    expect(PREFETCH).toBe(2);
    const f = setup();
    const p = createAudioPlayer(f.deps);
    p.unlock();
    const c = f.contexts[0]!;
    p.setSong("long");
    expect(f.tasks.length).toBe(1);
    runTask(f);
    expect(f.renders).toEqual(["long:0", "long:1"]);
    expect(f.tasks.length).toBe(1);
    runTask(f);
    expect(f.renders).toEqual(["long:0", "long:1", "long:2"]);
    expect(tags(c)).toEqual(["long:0", "long:1", "long:2"]);
    expect(f.tasks.length).toBe(0);
  });

  it("UI-63 再生: 予約の時刻は t0 + 累計サンプル / rate で隙間なく連なる（長さが 1 サンプル違う区間が混ざっても）", () => {
    const plan = planSong(MUSIC.odd!, data.wavetables, RATE);
    const lens = plan.bounds.slice(1).map((b, i) => b - (plan.bounds[i] ?? 0));
    expect(new Set(lens).size).toBe(2);
    const f = setup();
    const p = createAudioPlayer(f.deps);
    p.unlock();
    const c = f.contexts[0]!;
    p.setSong("odd");
    runTasks(f);
    const ended = new Set<FakeSource>();
    // 4 区間 + ループの 2 周目の頭まで
    for (let n = 0; n < 3; n++) endNext(c, ended);
    expect(tags(c)).toEqual(["odd:0", "odd:1", "odd:2", "odd:3", "odd:0", "odd:1"]);
    const starts = c.sources.map((s) => s.startAt[0]);
    const cum = [0, ...plan.bounds.slice(1), plan.total + (plan.bounds[1] ?? 0)];
    expect(starts).toEqual(cum.map((x) => LEAD + x / RATE));
  });

  it("UI-63 再生: 区間の ended で次の 1 区間を予約する（先読みは常に 2）。ended が順番どおりに来なくても自分の source だけを外す", () => {
    const f = setup();
    const p = createAudioPlayer(f.deps);
    p.unlock();
    const c = f.contexts[0]!;
    p.setSong("long");
    runTasks(f);
    c.sources[0]!.end();
    expect(tags(c)).toEqual(["long:0", "long:1", "long:2", "long:3"]);
    expect(f.tasks.length).toBe(0);
    // 区間 2 の ended が区間 1 より先に来る
    c.sources[2]!.end();
    expect(tags(c)).toEqual(["long:0", "long:1", "long:2", "long:3", "long:4"]);
    // 切り替えでは予約に残っている source（区間 1・3・4）だけを止める
    c.currentTime = 3;
    p.setSong("town");
    expect(c.sources[1]?.stopAt).toEqual([3 + LEAD]);
    expect(c.sources[3]?.stopAt).toEqual([3 + LEAD]);
    expect(c.sources[4]?.stopAt).toEqual([3 + LEAD]);
    expect(c.sources[0]?.stopAt).toEqual([]);
    expect(c.sources[2]?.stopAt).toEqual([]);
    // 止めた source の ended は先読みを増やさない
    const n = c.sources.length;
    c.sources[1]!.end();
    expect(c.sources.length).toBe(n);
  });

  it("UI-63 再生: ループの終わりの次はループの頭（前奏は 1 回だけ）。2 周目は合成しない（合成の回数が区間の数のまま）", () => {
    const f = setup();
    const p = createAudioPlayer(f.deps);
    p.unlock();
    const c = f.contexts[0]!;
    p.setSong("long");
    runTasks(f);
    const ended = new Set<FakeSource>();
    for (let n = 0; n < 12; n++) endNext(c, ended);
    expect(tags(c)).toEqual([
      "long:0", "long:1", "long:2", "long:3", "long:4", "long:5",
      "long:1", "long:2", "long:3", "long:4", "long:5",
      "long:1", "long:2", "long:3", "long:4",
    ]);
    expect(f.renders).toEqual(["long:0", "long:1", "long:2", "long:3", "long:4", "long:5"]);
    expect(c.buffers.length).toBe(6);
    // 2 周目は同じ AudioBuffer を使い回す
    expect(c.sources[6]?.buffer).toBe(c.sources[1]?.buffer);
  });

  it("UI-63 再生: loop_end < 曲末の曲は loop_end 以降を合成も予約もしない", () => {
    const f = setup();
    const p = createAudioPlayer(f.deps);
    p.unlock();
    const c = f.contexts[0]!;
    p.setSong("cut");
    runTasks(f);
    const ended = new Set<FakeSource>();
    for (let n = 0; n < 4; n++) endNext(c, ended);
    expect(tags(c)).toEqual(["cut:0", "cut:1", "cut:0", "cut:1", "cut:0", "cut:1", "cut:0"]);
    expect(f.renders).toEqual(["cut:0", "cut:1"]);
  });

  it("UI-63 再生: 切り替えは次の曲の区間 0 が揃ってから、前の曲の予約済みの source を区間 0 の時刻で stop する", () => {
    const f = setup({ delay: true });
    const p = createAudioPlayer(f.deps);
    p.unlock();
    const c = f.contexts[0]!;
    p.setSong("long");
    settle(f);
    expect(tags(c)).toEqual(["long:0", "long:1", "long:2"]);
    c.currentTime = 1;
    p.setSong("dungeon");
    expect(f.held.map((h) => h.key)).toEqual(["dungeon:0"]);
    // 合成を待つ間は前の曲が鳴り続ける
    for (const s of c.sources) expect(s.stopAt).toEqual([]);
    c.currentTime = 1.2;
    release(f, "dungeon:0");
    for (const s of c.sources.slice(0, 3)) expect(s.stopAt).toEqual([1.2 + LEAD]);
    expect(c.sources[3]?.buffer?.tag).toBe("dungeon:0");
    expect(c.sources[3]?.startAt).toEqual([1.2 + LEAD]);
  });

  it("UI-63 再生: 切り替えで currentTime が読むたびに 1 レンダー量子進んで区間 0 の時刻が置き直されても、前の曲の stop と区間 0 の start は同じ時刻（無音を挟まない）", () => {
    const f = setup({ delay: true });
    const p = createAudioPlayer(f.deps);
    p.unlock();
    const c = f.contexts[0]!;
    p.setSong("long");
    settle(f);
    p.setSong("dungeon");
    // 実機では切り替えの処理の間に currentTime が 1 量子（128 / context の sampleRate）進むことがある。読むたびに進める
    const q = 128 / c.sampleRate;
    let now = 1.2;
    Object.defineProperty(c, "currentTime", {
      configurable: true,
      get: () => {
        const v = now;
        now += q;
        return v;
      },
    });
    release(f, "dungeon:0");
    const next = c.sources[3]!;
    expect(next.buffer?.tag).toBe("dungeon:0");
    const at = next.startAt[0]!;
    expect(at).toBeGreaterThanOrEqual(1.2 + LEAD);
    for (const s of c.sources.slice(0, 3)) expect(s.stopAt).toEqual([at]);
  });

  it("UI-63 再生: 区間 0 を待つ間の setSong（元の曲）・setSong（別の曲）・playJingle・音量 0 で、待っていた依頼は取り消され、遅れて届いた結果では切り替わらない", () => {
    // A→B を頼み、B の前に A に戻る → B が届いても A のまま
    {
      const f = setup({ delay: true });
      const p = createAudioPlayer(f.deps);
      p.unlock();
      const c = f.contexts[0]!;
      p.setSong("town");
      release(f, "town:0");
      p.setSong("dungeon");
      p.setSong("town");
      release(f, "dungeon:0");
      expect(tags(c)).toEqual(["town:0"]);
      expect(c.sources[0]?.stopped).toBe(0);
    }
    // A→B→C を頼み、B が先に届いても B は始まらず、C で C が始まる
    {
      const f = setup({ delay: true });
      const p = createAudioPlayer(f.deps);
      p.unlock();
      const c = f.contexts[0]!;
      p.setSong("town");
      release(f, "town:0");
      p.setSong("dungeon");
      p.setSong("long");
      release(f, "dungeon:0");
      expect(tags(c)).toEqual(["town:0"]);
      release(f, "long:0");
      expect(tags(c)).toEqual(["town:0", "long:0"]);
      expect(c.sources[0]?.stopped).toBe(1);
    }
    // A→ジングル J を頼み、J の前に setSong(B) → J で J、終わったら B
    {
      const f = setup({ delay: true });
      const p = createAudioPlayer(f.deps);
      p.unlock();
      const c = f.contexts[0]!;
      p.setSong("town");
      release(f, "town:0");
      p.playJingle("victory");
      p.setSong("dungeon");
      expect(f.held.map((h) => h.key)).toEqual(["victory:0"]);
      release(f, "victory:0");
      expect(tags(c)).toEqual(["town:0", "victory:0"]);
      // ジングルの最後の区間を予約したので B の区間 0 を頼み、揃ったらジングルの終わりの時刻に予約する
      expect(f.held.map((h) => h.key)).toEqual(["dungeon:0"]);
      release(f, "dungeon:0");
      expect(tags(c)).toEqual(["town:0", "victory:0", "dungeon:0"]);
      c.sources[1]!.end();
      expect(tags(c)).toEqual(["town:0", "victory:0", "dungeon:0"]);
      expect(c.sources[2]?.stopped).toBe(0);
    }
    // A→B を頼み、B の前に音量 0 → B が届いても何も始まらない
    {
      const f = setup({ delay: true });
      const p = createAudioPlayer(f.deps);
      p.unlock();
      const c = f.contexts[0]!;
      p.setSong("town");
      release(f, "town:0");
      p.setSong("dungeon");
      f.vol.music = 0;
      p.refreshVolumes();
      release(f, "dungeon:0");
      expect(tags(c)).toEqual(["town:0"]);
      expect(c.sources[0]?.stopAt).toEqual([undefined]);
    }
  });

  it("UI-63 再生: 古い曲の ended と合成の結果は捨てる", () => {
    const f = setup({ delay: true });
    const p = createAudioPlayer(f.deps);
    p.unlock();
    const c = f.contexts[0]!;
    p.setSong("long");
    release(f, "long:0");
    runTask(f);
    expect(f.held.map((h) => h.key)).toEqual(["long:1"]);
    p.setSong("town");
    release(f, "town:0");
    expect(tags(c)).toEqual(["long:0", "town:0"]);
    // 切り替えの後に届いた前の曲の区間は予約しない
    release(f, "long:1");
    expect(tags(c)).toEqual(["long:0", "town:0"]);
    // 前の曲の ended は合成を頼まない
    const n = f.renders.length;
    c.sources[0]!.end();
    expect(f.renders.length).toBe(n);
  });

  it("UI-63 再生: 保持は直近 keepSongs 曲。3 曲目で最も古い曲を捨て、戻ったら合成し直す。保持にある曲は合成なしで区間 0 を予約", () => {
    expect(data.config.audio.keepSongs).toBe(2);
    const f = setup();
    const p = createAudioPlayer(f.deps);
    p.unlock();
    const c = f.contexts[0]!;
    p.setSong("town");
    p.setSong("dungeon");
    const dungeon0 = c.sources[1]!.buffer;
    p.setSong("long");
    expect(f.renders).toEqual(["town:0", "dungeon:0", "long:0"]);
    // dungeon は保持にある
    p.setSong("dungeon");
    expect(f.renders).toEqual(["town:0", "dungeon:0", "long:0"]);
    expect(c.sources[3]?.buffer).toBe(dungeon0);
    expect(c.sources[3]?.startAt.length).toBe(1);
    // town は捨てられている
    p.setSong("town");
    expect(f.renders).toEqual(["town:0", "dungeon:0", "long:0", "town:0"]);
  });

  it("UI-63 再生: 非同期の合成で曲を素早く切り替えても、保持の刈り込みはいま頼んだ曲を捨てない（戻ったときに合成し直さない）", () => {
    const f = setup({ delay: true });
    const p = createAudioPlayer(f.deps);
    p.unlock();
    p.setSong("town");
    settle(f);
    // dungeon の区間 0 を待つ間に long を頼む（鳴っている town と待っている dungeon が保持の後ろに並ぶ）
    p.setSong("dungeon");
    p.setSong("long");
    settle(f);
    p.setSong("town");
    settle(f);
    p.setSong("long");
    settle(f);
    expect(f.renders.filter((r) => r === "long:0").length).toBe(1);
  });

  it("UI-63 再生: 途中の区間の合成に失敗した曲は止まり、同じ曲の setSong で区間 0 から予約し直す", () => {
    const f = setup();
    const orig = f.deps.renderer;
    const fail = new Set(["long:2"]);
    f.deps.renderer = {
      plan: orig.plan,
      render: (name, plan, i, cb) => (fail.has(`${name}:${i}`) ? cb(null) : orig.render(name, plan, i, cb)),
    };
    const p = createAudioPlayer(f.deps);
    p.unlock();
    const c = f.contexts[0]!;
    p.setSong("long");
    runTasks(f);
    expect(tags(c)).toEqual(["long:0", "long:1"]);
    // 予約済みの区間も止める（鳴っている扱いを残さない）
    expect(c.sources[0]?.stopped).toBe(1);
    expect(c.sources[1]?.stopped).toBe(1);
    fail.clear();
    p.setSong("long");
    expect(tags(c)).toEqual(["long:0", "long:1", "long:0"]);
    expect(c.sources[2]?.startAt.length).toBe(1);
  });

  it("UI-63 再生: ジングルは区間で鳴らし、最後の区間の ended で場面の曲を頭から。ジングルは保持に入れない", () => {
    const f = setup();
    const p = createAudioPlayer(f.deps);
    p.unlock();
    const c = f.contexts[0]!;
    p.setSong("town");
    p.setSong("dungeon");
    p.playJingle("inn");
    runTasks(f);
    const ended = new Set<FakeSource>([c.sources[0]!, c.sources[1]!]);
    for (let n = 0; n < 3; n++) endNext(c, ended);
    // 最後の区間（inn:3）を予約した時点で、場面の曲（dungeon）の区間 0 をジングルの終わりの時刻に予約する
    expect(tags(c)).toEqual(["town:0", "dungeon:0", "inn:0", "inn:1", "inn:2", "inn:3", "dungeon:0"]);
    const innStart = c.sources[2]!.startAt[0]!;
    const innTotal = planSong(MUSIC.inn!, data.wavetables, RATE).total;
    expect(c.sources[6]?.startAt[0]).toBeCloseTo(innStart + innTotal / RATE, 12);
    expect(c.sources[6]?.startAt[0]).toBeCloseTo(c.sources[5]!.startAt[0]! + sampleAt(16, 500000, RATE) / RATE, 12);
    endNext(c, ended);
    // 最後の区間の ended では新しい source を作らない（予約済みの dungeon をそのまま鳴らす）。保持にあるので合成しない
    expect(c.sources.length).toBe(7);
    expect(tags(c).at(-1)).toBe("dungeon:0");
    expect(f.renders.filter((r) => r === "dungeon:0").length).toBe(1);
    // ジングルを数に入れないので town も捨てられていない
    p.setSong("town");
    expect(f.renders.filter((r) => r === "town:0").length).toBe(1);
    // 同じジングルをもう一度鳴らすと合成し直す（鳴り終わったら捨てる）
    p.playJingle("inn");
    expect(f.renders.filter((r) => r === "inn:0").length).toBe(2);
  });

  it("UI-63 再生: ジングルの最後の区間を予約したら場面の曲の区間 0 をジングルの終わりの時刻に予約する（無音を挟まない）。ジングルの間に変わった場面・別のジングル・停止で予約し直す・取り消す", () => {
    const bar = sampleAt(16, 500000, RATE) / RATE;
    // 区間 0 の時刻 = ジングルの終わり。ended が時刻ちょうどに来ても、遅れて来ても、場面の曲の頭は動かない
    {
      const f = setup();
      const p = createAudioPlayer(f.deps);
      p.unlock();
      const c = f.contexts[0]!;
      c.baseLatency = 0.02;
      p.setSong("dungeon");
      p.playJingle("victory");
      const j = c.sources[1]!;
      expect(j.buffer?.tag).toBe("victory:0");
      const jEnd = j.startAt[0]! + bar;
      expect(tags(c)).toEqual(["dungeon:0", "victory:0", "dungeon:0"]);
      const d = c.sources[2]!;
      expect(d.startAt).toEqual([jEnd]);
      expect(d.stopped).toBe(0);
      // 保持にある区間 0 を使い、合成し直さない
      expect(f.renders.filter((r) => r === "dungeon:0").length).toBe(1);
      c.currentTime = jEnd + 0.05;
      j.end();
      expect(c.sources.length).toBe(3);
      // 場面の曲を鳴っているものにして、先読みを続ける
      runTasks(f);
      expect(tags(c)).toEqual(["dungeon:0", "victory:0", "dungeon:0", "dungeon:1", "dungeon:2"]);
      expect(c.sources[3]?.startAt[0]).toBeCloseTo(jEnd + bar, 12);
      // 鳴っている曲と同じ場面では作り直さない
      p.setSong("dungeon");
      expect(c.sources.length).toBe(5);
    }
    // 場面の曲の区間 0 の合成が遅れてジングルの終わりを過ぎたら、currentTime + 先行の時間に置き直す
    {
      const f = setup({ delay: true });
      const p = createAudioPlayer(f.deps);
      p.unlock();
      const c = f.contexts[0]!;
      p.setSong("dungeon");
      settle(f);
      p.playJingle("victory");
      p.setSong("town");
      release(f, "victory:0");
      expect(f.held.map((h) => h.key)).toEqual(["town:0"]);
      c.currentTime = 50;
      release(f, "town:0");
      expect(tags(c)).toEqual(["dungeon:0", "dungeon:1", "dungeon:2", "victory:0", "town:0"]);
      expect(c.sources[4]?.startAt[0]).toBeCloseTo(50 + LEAD, 9);
    }
    // ジングルの間の setSong は予約し直す（前の予約は止める）。null なら取り消す
    {
      const f = setup();
      const p = createAudioPlayer(f.deps);
      p.unlock();
      const c = f.contexts[0]!;
      p.setSong("dungeon");
      p.playJingle("victory");
      const jEnd = c.sources[1]!.startAt[0]! + bar;
      p.setSong("town");
      expect(tags(c)).toEqual(["dungeon:0", "victory:0", "dungeon:0", "town:0"]);
      expect(c.sources[2]?.stopAt).toEqual([undefined]);
      expect(c.sources[3]?.startAt).toEqual([jEnd]);
      p.setSong(null);
      expect(c.sources[3]?.stopAt).toEqual([undefined]);
      c.sources[1]!.end();
      runTasks(f);
      expect(c.sources.length).toBe(4);
    }
    // ジングルの間の別のジングルは、場面の曲の予約も取り消す
    {
      const f = setup();
      const p = createAudioPlayer(f.deps);
      p.unlock();
      const c = f.contexts[0]!;
      p.setSong("dungeon");
      p.playJingle("victory");
      p.playJingle("inn");
      expect(tags(c)).toEqual(["dungeon:0", "victory:0", "dungeon:0", "inn:0"]);
      expect(c.sources[2]?.stopAt).toEqual([undefined]);
      // 音量 0 でも取り消す（inn の最後の区間を予約して場面の曲を予約した後）
      runTasks(f);
      c.sources[3]!.end();
      const n = c.sources.length;
      expect(tags(c).slice(3)).toEqual(["inn:0", "inn:1", "inn:2", "inn:3", "dungeon:0"]);
      f.vol.music = 0;
      p.refreshVolumes();
      expect(c.sources[n - 1]?.stopAt).toEqual([undefined]);
    }
  });

  it("UI-63 再生: 間に合わない区間（when < currentTime + 先行の時間）は時刻を置き直し、後続が重ならない", () => {
    const f = setup();
    const p = createAudioPlayer(f.deps);
    p.unlock();
    const c = f.contexts[0]!;
    p.setSong("long");
    runTasks(f);
    const bar = sampleAt(16, 500000, RATE) / RATE;
    expect(c.sources.map((s) => s.startAt[0])).toEqual([LEAD, LEAD + bar, LEAD + 2 * bar]);
    // 主スレッドが長く止まった
    c.currentTime = 100;
    c.sources[0]!.end();
    expect(c.sources[3]?.startAt[0]).toBeCloseTo(100 + LEAD, 9);
    c.sources[1]!.end();
    expect(c.sources[4]?.startAt[0]).toBeCloseTo(100 + LEAD + bar, 9);
  });

  it("UI-63 再生: buffer のレートは config.audio.sampleRate（44100）、長さは区間の長さ", () => {
    // 22050【仮】から 44100 に戻した（2026-10-06 ユーザーの判断。工房の render.py の WAV との一致を優先）
    expect(RATE).toBe(44100);
    const f = setup();
    const p = createAudioPlayer(f.deps);
    p.unlock();
    const c = f.contexts[0]!;
    p.setSong("town");
    expect(c.sources[0]?.buffer?.sampleRate).toBe(RATE);
    expect(c.sources[0]?.buffer?.length).toBe(sampleAt(16, 500000, RATE));
    expect(c.sources[0]?.buffer?.channels).toBe(1);
  });

  it("UI-63 再生: createMessageChannelYield は呼ばれたときだけ 1 回 cb を呼ぶ（タイマーを使わない）", async () => {
    const yieldTask = createMessageChannelYield();
    let n = 0;
    yieldTask(() => n++);
    expect(n).toBe(0);
    await new Promise<void>((r) => yieldTask(r));
    expect(n).toBe(1);
  });
});

describe("UI-57 音量", () => {
  it("UI-57 音量 0 なら source を作らない。refreshVolumes で GainNode の値 = 基準 × 段 / 10、0 から上がったら曲を頭から", () => {
    const f = setup();
    f.vol.music = 0;
    f.vol.sfx = 0;
    const p = createAudioPlayer(f.deps);
    p.setSong("town");
    p.unlock();
    const c = f.contexts[0]!;
    const [mg, sg] = c.gains;
    expect(mg?.gain.value).toBe(0);
    expect(sg?.gain.value).toBe(0);
    expect(c.sources.length).toBe(0);
    p.playJingle("victory");
    expect(c.sources.length).toBe(0);
    f.vol.music = 7;
    f.vol.sfx = 4;
    p.refreshVolumes();
    expect(mg?.gain.value).toBeCloseTo(data.config.audio.musicGain * 0.7, 10);
    expect(sg?.gain.value).toBeCloseTo(data.config.audio.sfxGain * 0.4, 10);
    expect(tags(c)).toEqual(["town:0"]);
    expect(c.sources[0]?.started).toBe(1);
    // 同じ段のままの refresh では作り直さない
    p.refreshVolumes();
    expect(c.sources.length).toBe(1);
    // 0 に下げたら止める（即時）
    f.vol.music = 0;
    p.refreshVolumes();
    expect(c.sources[0]?.stopAt).toEqual([undefined]);
    expect(mg?.gain.value).toBe(0);
  });
});

describe("UI-65 効果音", () => {
  it("UI-65 効果音: unlock で loadZzfx を 1 回、モジュールの audioContext を閉じて差し替え、buildSamples に null → undefined で渡す、sfxGain に繋ぐ。ファイルが無い名前は何もしない", async () => {
    const f = setup();
    const p = createAudioPlayer(f.deps);
    p.playSfx("hit"); // unlock 前は何もしない
    expect(f.loads).toBe(0);
    p.unlock();
    expect(f.loads).toBe(1);
    const c = f.contexts[0]!;
    const extra = f.zz.ZZFX.audioContext;
    // 読み込みが終わる前の効果音は捨てる
    p.playSfx("hit");
    expect(f.zz.ZZFX.buildSamples).not.toHaveBeenCalled();
    await flush();
    expect(extra.closes).toBe(1);
    expect(f.zz.ZZFX.audioContext).toBe(c);
    // ZZFX.volume は触らない（buildSamples の中で掛かる）
    expect(f.zz.ZZFX.volume).toBe(0.3);
    p.playSfx("hit");
    expect(f.zz.ZZFX.buildSamples).toHaveBeenCalledTimes(1);
    expect(f.zz.ZZFX.buildSamples.mock.calls[0]).toEqual([undefined, 0.05, 220, undefined, undefined, 0.1]);
    const s = c.sources[0]!;
    expect(s.connected).toEqual([c.gains[1]]);
    expect(s.started).toBe(1);
    expect(s.buffer?.sampleRate).toBe(44100);
    expect(Array.from(s.buffer?.data ?? [])).toEqual([Math.fround(0.1), Math.fround(-0.1), 6]);
    p.playSfx("door");
    expect(c.sources.length).toBe(1);
    p.unlock();
    p.playSfx("ok");
    expect(f.loads).toBe(1);
    expect(c.sources.length).toBe(2);
  });

  it("UI-65 効果音: 読み込みに失敗したら以後無音で warn は 1 回", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const f = setup({ loadFails: true });
    const p = createAudioPlayer(f.deps);
    p.unlock();
    await flush();
    p.playSfx("hit");
    p.playSfx("ok");
    p.unlock();
    await flush();
    expect(f.loads).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(f.contexts[0]?.sources.length).toBe(0);
  });

  it("UI-65 効果音の段 0 なら鳴らさない", async () => {
    const f = setup();
    f.vol.sfx = 0;
    const p = createAudioPlayer(f.deps);
    p.unlock();
    await flush();
    p.playSfx("hit");
    expect(f.zz.ZZFX.buildSamples).not.toHaveBeenCalled();
  });
});

describe("UI-41 演出スキップ", () => {
  it("UI-41 演出スキップは音に影響しない（再生機は skipAnimations を見ない。同じ操作で同じ呼び出し）", async () => {
    const run = async (skip: boolean): Promise<string[]> => {
      const f = setup();
      const settings = { skipAnimations: skip, musicVolume: 7, sfxVolume: 7 };
      const p = createAudioPlayer({ ...f.deps, volumes: () => ({ music: settings.musicVolume, sfx: settings.sfxVolume }) });
      p.unlock();
      await flush();
      p.setSong("town");
      p.playJingle("victory");
      p.playSfx("hit");
      runTasks(f);
      const c = f.contexts[0]!;
      return c.sources.map((s) => `${s.buffer?.tag}:${s.startAt.join(",")}:${s.buffer?.length}`);
    };
    expect(await run(true)).toEqual(await run(false));
  });
});

describe("UI-63 / UI-65 / UI-66 音の対応の拡充（2026-10-06）", () => {
  it("UI-63/UI-65 audio.json のすべての曲・ジングル・効果音・操作の音は、ファイルが無ければ無音で、例外も console.error / warn も出ない", async () => {
    const err = vi.spyOn(console, "error");
    const warn = vi.spyOn(console, "warn");
    const f = setup({ music: {}, sfx: {} });
    const p = createAudioPlayer(f.deps);
    p.unlock();
    await flush();
    for (const n of data.audio.music.songs) p.setSong(n);
    for (const n of data.audio.music.jingles) p.playJingle(n);
    for (const n of data.audio.sfx.names) p.playSfx(n);
    for (const n of Object.values(data.audio.ui)) p.playSfx(n);
    p.setSong(null);
    await flush();
    const c = f.contexts[0]!;
    expect(c.sources.length).toBe(0);
    expect(f.loads).toBe(0);
    expect(err).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("UI-63 遭遇: encounter のジングルが鳴り終わってから戦闘の曲（soundsFor の順に setSong が来ても先に始めない）。ジングルが無ければすぐ戦闘の曲", () => {
    const music: GameAssets["music"] = {
      dungeon1: songData("dungeon1", "song", 2),
      encounter: songData("encounter", "jingle", 1),
      battle1: songData("battle1", "song", 3),
    };
    const f = setup({ music });
    const p = createAudioPlayer(f.deps);
    p.unlock();
    const c = f.contexts[0]!;
    p.setSong("dungeon1");
    // soundsFor(encounter) の順: jingle encounter → song battle1
    p.playJingle("encounter");
    p.setSong("battle1");
    // ジングル（1 区間）の後に予約した迷宮の曲は setSong で取り消し、戦闘の曲をジングルの終わりの時刻に予約し直す（先に始めない）
    expect(tags(c)).toEqual(["dungeon1:0", "encounter:0", "dungeon1:0", "battle1:0"]);
    expect(c.sources[0]!.stopped).toBe(1);
    expect(c.sources[2]!.stopped).toBe(1);
    const bar = sampleAt(16, 500000, RATE) / RATE;
    expect(c.sources[3]?.startAt[0]).toBeCloseTo(c.sources[1]!.startAt[0]! + bar, 12);
    c.sources[1]!.end();
    expect(tags(c)).toEqual(["dungeon1:0", "encounter:0", "dungeon1:0", "battle1:0"]);
    expect(c.sources[3]!.stopped).toBe(0);
    // ジングルのファイルが無ければ、迷宮の曲を止めてすぐ戦闘の曲
    const g = setup({ music: { dungeon1: music.dungeon1!, battle1: music.battle1! } });
    const q = createAudioPlayer(g.deps);
    q.unlock();
    const d = g.contexts[0]!;
    q.setSong("dungeon1");
    q.playJingle("encounter");
    q.setSong("battle1");
    expect(tags(d)).toEqual(["dungeon1:0", "battle1:0"]);
    expect(d.sources[0]!.stopped).toBe(1);
  });
});

// UI-63（M9.5）: 1 区間の合成が実機で 50ms 以上かかったので Web Worker で合成する。node に Worker は無いので、
// worker の側の処理（createSynthHandler）は直接呼び、主の側（createWorkerRenderer）は偽の Worker で確かめる。
class FakeWorker {
  posted: ToSynthWorker[] = [];
  terminated = 0;
  onmessage: ((e: { data: FromSynthWorker }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onmessageerror: ((e: unknown) => void) | null = null;
  postMessage(m: ToSynthWorker): void {
    // 本物の postMessage と同じく構造化複製できる形であること（関数・クラスが入ると例外）
    this.posted.push(structuredClone(m));
  }
  terminate(): void {
    this.terminated++;
  }
  /** worker の返事を届ける */
  reply(m: FromSynthWorker): void {
    this.onmessage?.({ data: m });
  }
}
/** 本物の handler で worker を動かす偽物（返事は deliver で 1 つずつ届ける） */
class LoopbackWorker extends FakeWorker {
  handle = createSynthHandler();
  out: FromSynthWorker[] = [];
  override postMessage(m: ToSynthWorker): void {
    super.postMessage(m);
    const r = this.handle(structuredClone(m));
    if (r !== null) this.out.push(r);
  }
  deliver(): void {
    const r = this.out.shift();
    if (r === undefined) throw new Error("no reply");
    this.reply(r);
  }
}
const asWorker = (w: FakeWorker): Worker => w as unknown as Worker;
const segOf = (m: ToSynthWorker | undefined): { name: string; i: number; id: number } => {
  if (m?.type !== "seg") throw new Error(`not seg: ${JSON.stringify(m?.type)}`);
  return m;
};

describe("UI-63 Web Worker の合成（M9.5）", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("UI-63 worker: 計画を受けた後の区間の依頼に renderSegment と同じ samples を返す。計画は返事なし、知らない曲は null", () => {
    const handle = createSynthHandler();
    const plan = planSong(MUSIC.long!, data.wavetables, RATE);
    expect(handle({ type: "plan", name: "long", plan: structuredClone(plan) })).toBeNull();
    for (const i of [0, 1, 5]) {
      const r = handle({ type: "seg", name: "long", i, id: 10 + i });
      expect(r?.type).toBe("seg");
      expect(r?.id).toBe(10 + i);
      expect(r?.samples).toEqual(renderSegment(plan, i));
    }
    expect(handle({ type: "seg", name: "nope", i: 0, id: 99 })).toEqual({ type: "seg", id: 99, samples: null });
    // 同じ名前の新しい計画で置き換える
    const other = planSong(MUSIC.town!, data.wavetables, RATE);
    handle({ type: "plan", name: "long", plan: other });
    expect(handle({ type: "seg", name: "long", i: 0, id: 1 })?.samples).toEqual(renderSegment(other, 0));
  });

  // 2026-10-06 ユーザーの判断で、worker は最初の render ではなく作成時（ページの読み込み時）に作る（最初のタップの鳴り始めの遅れ B3 を減らす）
  it("UI-63 worker: worker は作成時（読み込み時）に作り、計画は名前ごとに 1 回だけ送り、返事は id で cb に渡す（順が入れ替わっても）", () => {
    const workers: FakeWorker[] = [];
    const r = createWorkerRenderer(() => {
      const w = new FakeWorker();
      workers.push(w);
      return asWorker(w);
    });
    expect(workers).toHaveLength(1);
    expect(workers[0]!.posted).toEqual([]);
    const plan = r.plan(MUSIC.long!, data.wavetables, RATE);
    expect(workers).toHaveLength(1);
    const got: (string | null)[] = [];
    const samplesOf: Record<number, Float32Array | null> = {};
    r.render("long", plan, 0, (s) => {
      got.push("long:0");
      samplesOf[0] = s;
    });
    r.render("long", plan, 1, (s) => {
      got.push("long:1");
      samplesOf[1] = s;
    });
    expect(workers).toHaveLength(1);
    const w = workers[0]!;
    expect(w.posted.map((m) => m.type)).toEqual(["plan", "seg", "seg"]);
    expect(got).toEqual([]);
    const s0 = segOf(w.posted[1]);
    const s1 = segOf(w.posted[2]);
    expect([s0.name, s0.i, s1.name, s1.i]).toEqual(["long", 0, "long", 1]);
    expect(s0.id).not.toBe(s1.id);
    const a = new Float32Array([0.5]);
    const b = new Float32Array([0.25]);
    w.reply({ type: "seg", id: s1.id, samples: b });
    w.reply({ type: "seg", id: s0.id, samples: a });
    w.reply({ type: "seg", id: s0.id, samples: a }); // 2 回目と知らない id は捨てる
    w.reply({ type: "seg", id: 12345, samples: a });
    expect(got).toEqual(["long:1", "long:0"]);
    expect(samplesOf[0]).toBe(a);
    expect(samplesOf[1]).toBe(b);
    // 同じ名前でも計画が新しければ送り直す（ジングルは鳴らすたびに計画を作る）
    const plan2 = r.plan(MUSIC.long!, data.wavetables, RATE);
    r.render("long", plan2, 2, () => {});
    r.render("long", plan2, 3, () => {});
    expect(w.posted.slice(3).map((m) => m.type)).toEqual(["plan", "seg", "seg"]);
    expect(workers).toHaveLength(1);
  });

  it("UI-63 worker: error が来たら warn を 1 回出して worker を閉じ、返事を待つ依頼と以後の依頼は主スレッドで合成する", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const w = new FakeWorker();
    const r = createWorkerRenderer(() => asWorker(w));
    const plan: SongPlan = r.plan(MUSIC.long!, data.wavetables, RATE);
    const got: [number, Float32Array | null][] = [];
    r.render("long", plan, 0, (s) => got.push([0, s]));
    r.render("long", plan, 1, (s) => got.push([1, s]));
    expect(got).toEqual([]);
    w.onerror?.(new Error("boom"));
    expect(w.terminated).toBe(1);
    expect(got.map(([i]) => i)).toEqual([0, 1]);
    expect(got[0]![1]).toEqual(renderSegment(plan, 0));
    expect(got[1]![1]).toEqual(renderSegment(plan, 1));
    const n = w.posted.length;
    r.render("long", plan, 2, (s) => got.push([2, s]));
    expect(w.posted).toHaveLength(n);
    expect(got[2]).toEqual([2, renderSegment(plan, 2)]);
    w.onmessageerror?.(new Error("again"));
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("UI-63 worker: render を一度も頼まれていない間に error が来ても壊れず、warn を 1 回出して worker を閉じ、以後は主スレッドで合成する", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const workers: FakeWorker[] = [];
    const r = createWorkerRenderer(() => {
      const w = new FakeWorker();
      workers.push(w);
      return asWorker(w);
    });
    expect(workers).toHaveLength(1);
    const w = workers[0]!;
    expect(() => w.onerror?.(new Error("load failed"))).not.toThrow();
    expect(w.terminated).toBe(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    w.onmessageerror?.(new Error("again"));
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const plan = r.plan(MUSIC.town!, data.wavetables, RATE);
    const got: (Float32Array | null)[] = [];
    r.render("town", plan, 0, (s) => got.push(s));
    r.render("town", plan, 1, (s) => got.push(s));
    expect(got).toEqual([renderSegment(plan, 0), renderSegment(plan, 1)]);
    // worker は作り直さず、閉じた worker には送らない
    expect(workers).toHaveLength(1);
    expect(w.posted).toEqual([]);
  });

  it("UI-63 worker: worker が作れなければ（例外）主スレッドで合成する", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    let made = 0;
    const r = createWorkerRenderer(() => {
      made++;
      throw new Error("no worker");
    });
    // 作成時に作ろうとして失敗する（作成そのものは例外を投げない）
    expect(made).toBe(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const plan = r.plan(MUSIC.town!, data.wavetables, RATE);
    const got: (Float32Array | null)[] = [];
    r.render("town", plan, 0, (s) => got.push(s));
    r.render("town", plan, 1, (s) => got.push(s));
    expect(got).toEqual([renderSegment(plan, 0), renderSegment(plan, 1)]);
    expect(made).toBe(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("UI-63 worker: 再生機は worker の返事を待って区間 0 を鳴らし、返事が来るたびに先読みを予約する", () => {
    const f = setup();
    const w = new LoopbackWorker();
    f.deps.renderer = createWorkerRenderer(() => asWorker(w));
    const p = createAudioPlayer(f.deps);
    p.unlock();
    const c = f.contexts[0]!;
    p.setSong("long");
    expect(c.sources).toHaveLength(0);
    const plan = planSong(MUSIC.long!, data.wavetables, RATE);
    w.deliver();
    expect(c.sources).toHaveLength(1);
    expect(c.sources[0]!.buffer?.data).toEqual(renderSegment(plan, 0));
    expect(c.sources[0]!.startAt).toEqual([LEAD]);
    for (let k = 1; k <= PREFETCH; k++) {
      runTasks(f);
      w.deliver();
      expect(c.sources).toHaveLength(1 + k);
      expect(c.sources[k]!.buffer?.data).toEqual(renderSegment(plan, k));
      expect(c.sources[k]!.startAt[0]).toBeCloseTo(LEAD + (plan.bounds[k] ?? 0) / RATE, 12);
    }
    runTasks(f);
    expect(w.out).toHaveLength(0);
    // 計画は 1 回だけ送る
    expect(w.posted.filter((m) => m.type === "plan")).toHaveLength(1);
  });

  // 2026-10-06 ユーザーの判断（B6 の (a)）: 新しい worker の最初の合成が 2〜3 倍遅いので、読み込み時に 1 区間を合成して捨てる（暖機）
  it("UI-63 worker 暖機: 再生機の作成時に最初のループする曲の計画で warmup を 1 回だけ送り、保持に入れず、以後の本物の依頼に影響しない", () => {
    const f = setup({ music: { victory: MUSIC.victory!, town: MUSIC.town!, long: MUSIC.long! } });
    const w = new LoopbackWorker();
    f.deps.renderer = createWorkerRenderer(() => asWorker(w));
    const p = createAudioPlayer(f.deps);
    // unlock の前（読み込み時）。AudioContext はまだ作らない
    expect(f.contexts).toHaveLength(0);
    expect(w.posted).toEqual([{ type: "warmup", plan: planSong(MUSIC.town!, data.wavetables, RATE) }]);
    // 暖機は返事をしない（worker は計画を名前で持たない）
    expect(w.out).toHaveLength(0);
    p.unlock();
    const c = f.contexts[0]!;
    // 暖機に使った曲を鳴らしても、計画は送り直し、区間 0 は本物の依頼として合成する（暖機の結果は保持に入っていない）
    p.setSong("town");
    expect(w.posted.slice(1).map((m) => m.type)).toEqual(["plan", "seg"]);
    expect(segOf(w.posted[2]).i).toBe(0);
    expect(c.sources).toHaveLength(0);
    w.deliver();
    expect(c.sources).toHaveLength(1);
    expect(c.sources[0]!.buffer?.data).toEqual(renderSegment(planSong(MUSIC.town!, data.wavetables, RATE), 0));
    expect(c.sources[0]!.startAt).toEqual([LEAD]);
    expect(w.posted.filter((m) => m.type === "warmup")).toHaveLength(1);
  });

  // 2026-10-06 レビュー F1: 名前順で先に来る曲の区間 0 にノイズ（ch4）が無いと、renderSegment のノイズの枝が暖機で回らない
  it("UI-63 worker 暖機: 区間 0 にトーンとノイズの両方の音がある最初のループする曲で暖機する（無ければ最初のループする曲）", () => {
    const quiet: SongData = { ...songData("aquiet", "song", 2), ch: [[[0, 4, 69, 12]], [], [], []] };
    const late: SongData = { ...songData("blate", "song", 2), ch: [[[0, 4, 69, 12]], [], [], [[16, 1, "kick", 15]]] };
    const f = setup({ music: { aquiet: quiet, blate: late, victory: MUSIC.victory!, town: MUSIC.town! } });
    const w = new FakeWorker();
    f.deps.renderer = createWorkerRenderer(() => asWorker(w));
    createAudioPlayer(f.deps);
    expect(w.posted).toEqual([{ type: "warmup", plan: planSong(MUSIC.town!, data.wavetables, RATE) }]);
    // 両方ある曲が無ければ従来どおり最初のループする曲
    const g = setup({ music: { aquiet: quiet, blate: late } });
    const v = new FakeWorker();
    g.deps.renderer = createWorkerRenderer(() => asWorker(v));
    createAudioPlayer(g.deps);
    expect(v.posted).toEqual([{ type: "warmup", plan: planSong(quiet, data.wavetables, RATE) }]);
  });

  it("UI-63 worker 暖機: ループする曲が無ければ最初のジングル、曲のファイルが 1 つも無ければ暖機しない（壊れない）", () => {
    const f = setup({ music: { victory: MUSIC.victory! } });
    const w = new FakeWorker();
    f.deps.renderer = createWorkerRenderer(() => asWorker(w));
    createAudioPlayer(f.deps);
    expect(w.posted).toEqual([{ type: "warmup", plan: planSong(MUSIC.victory!, data.wavetables, RATE) }]);
    const g = setup({ music: {} });
    const v = new FakeWorker();
    g.deps.renderer = createWorkerRenderer(() => asWorker(v));
    const q = createAudioPlayer(g.deps);
    expect(v.posted).toEqual([]);
    q.unlock();
    expect(() => q.setSong("town")).not.toThrow();
    expect(v.posted).toEqual([]);
  });

  it("UI-63 worker 暖機: 暖機の後に error が来ても壊れず（warn は 1 回、主スレッドで暖機し直さない）、以後は主スレッドで合成する", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const f = setup();
    const w = new FakeWorker();
    f.deps.renderer = createWorkerRenderer(() => asWorker(w));
    const p = createAudioPlayer(f.deps);
    expect(w.posted.map((m) => m.type)).toEqual(["warmup"]);
    expect(() => w.onerror?.(new Error("boom"))).not.toThrow();
    expect(w.terminated).toBe(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    p.unlock();
    const c = f.contexts[0]!;
    p.setSong("long");
    expect(c.sources).toHaveLength(1);
    expect(c.sources[0]!.buffer?.data).toEqual(renderSegment(planSong(MUSIC.long!, data.wavetables, RATE), 0));
    expect(w.posted.map((m) => m.type)).toEqual(["warmup"]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("UI-63 worker 暖機: worker が作れないとき・同期版では暖機しない（読み込み時に主スレッドで合成しない）", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // 同期版は warmup を持たないので、再生機は暖機しない（renderer.render も呼ばない）
    expect(createSyncRenderer().warmup).toBeUndefined();
    const f = setup();
    createAudioPlayer(f.deps);
    expect(f.renders).toEqual([]);
    // worker が作れない renderer の warmup は何もしない（主スレッドで合成しないことは synth-protocol.test.ts で renderSegment の呼び出しを数えて確かめる）
    const r = createWorkerRenderer(() => {
      throw new Error("no worker");
    });
    f.deps.renderer = r;
    expect(() => createAudioPlayer(f.deps)).not.toThrow();
  });
});
