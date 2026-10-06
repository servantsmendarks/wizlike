// UI-06 / UI-63 / UI-65 / UI-57: 再生機（src/presenter/audio.ts）。偽の AudioContext で呼び出しを記録する。
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameAssets, SongData } from "../src/build/asset-types";
import { attachAudio, createAudioPlayer, type AudioDeps, type ZzfxModule } from "../src/presenter/audio";
import { sampleAt, SAMPLE_RATE } from "../src/presenter/audio-synth";
import { data } from "./helpers/core";

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
  onended: (() => void) | null = null;
  start(): void {
    this.started++;
  }
  stop(): void {
    this.stopped++;
  }
  /** 鳴り終わった（ジングルの終わり） */
  end(): void {
    this.onended?.();
  }
}
class FakeContext {
  state: "suspended" | "running" | "closed" = "suspended";
  destination = { name: "destination" };
  gains: FakeGain[] = [];
  sources: FakeSource[] = [];
  buffers: FakeBuffer[] = [];
  resumes = 0;
  suspends = 0;
  closes = 0;
  createGain(): FakeGain {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createBuffer(ch: number, len: number, rate: number): FakeBuffer {
    const b = new FakeBuffer(ch, len, rate);
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

function songData(name: string, kind: "song" | "jingle", bars: number): SongData {
  return {
    name,
    kind,
    tempoUs: 500000,
    time: [4, 4],
    barLen16: 16,
    bars,
    end16: bars * 16,
    loop: kind === "song" ? { start16: 16, end16: bars * 16 } : null,
    waves: ["pulse50", "triangle", "organ"],
    ch: [[[0, 4, 69, 12]], [], [], [[0, 1, "kick", 15]]],
  };
}

const MUSIC: GameAssets["music"] = {
  town: songData("town", "song", 2),
  dungeon: songData("dungeon", "song", 3),
  victory: songData("victory", "jingle", 1),
  inn: songData("inn", "jingle", 4),
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
};

function setup(o: { music?: GameAssets["music"]; sfx?: GameAssets["sfx"]; noContext?: boolean; loadFails?: boolean } = {}): Fake {
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
  const f: Fake = {
    contexts,
    zz,
    vol,
    loads: 0,
    deps: {
      createContext: () => {
        if (o.noContext === true) return null;
        const c = new FakeContext();
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
    },
  };
  return f;
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
    // 効果音のファイルが 1 つも無ければ ZzFX を読まない（素材なしで chunk の要求を出さない）
    expect(f.loads).toBe(0);
    expect(err).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("UI-63 ループする曲は loop true・loopStart/loopEnd が秒、同じ曲の setSong は作り直さない、別の曲は前を止める", () => {
    const f = setup();
    const p = createAudioPlayer(f.deps);
    p.unlock();
    const c = f.contexts[0]!;
    p.setSong("town");
    expect(c.sources.length).toBe(1);
    const s = c.sources[0]!;
    expect(s.started).toBe(1);
    expect(s.loop).toBe(true);
    expect(s.loopStart).toBe(sampleAt(16, 500000) / SAMPLE_RATE);
    expect(s.loopEnd).toBe(sampleAt(32, 500000) / SAMPLE_RATE);
    expect(nameOf(s)).toBe("town");
    expect(s.connected).toEqual([c.gains[0]]);
    expect(s.buffer?.length).toBe(sampleAt(32, 500000));
    expect(s.buffer?.sampleRate).toBe(44100);
    p.setSong("town");
    expect(c.sources.length).toBe(1);
    p.setSong("dungeon");
    expect(s.stopped).toBe(1);
    expect(s.disconnected).toBe(1);
    expect(c.sources.length).toBe(2);
    // 合成は曲名ごとに 1 回（town に戻っても buffer を作り直さない）
    p.setSong("town");
    expect(c.buffers.length).toBe(2);
    expect(c.sources[2]?.buffer).toBe(s.buffer);
    // ファイルが無い曲は止めて無音
    p.setSong("boss");
    expect(c.sources[2]?.stopped).toBe(1);
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
    expect(j.loop).toBe(false);
    expect(j.started).toBe(1);
    p.playJingle("victory");
    expect(c.sources.length).toBe(2);
    p.setSong("dungeon");
    expect(c.sources.length).toBe(2);
    j.end();
    expect(c.sources.length).toBe(3);
    const d = c.sources[2]!;
    expect(d.loop).toBe(true);
    expect(d.started).toBe(1);
    expect(nameOf(d)).toBe("dungeon");
    // 別のジングルは置き換え。置き換えられた方の ended は無視する
    p.playJingle("victory");
    const v = c.sources[3]!;
    p.playJingle("inn");
    const inn = c.sources[4]!;
    expect(v.stopped).toBe(1);
    v.end();
    expect(c.sources.length).toBe(5);
    inn.end();
    expect(c.sources.length).toBe(6);
    // ファイルの無いジングルは何もしない（鳴っている曲のまま）
    p.playJingle("wipe");
    expect(c.sources.length).toBe(6);
    expect(c.sources[5]?.stopped).toBe(0);
  });

  it("UI-63 unlock 前の setSong は覚えて unlock で始める、unlock 前のジングルは捨てる", () => {
    const f = setup();
    const p = createAudioPlayer(f.deps);
    p.setSong("dungeon");
    p.playJingle("victory");
    p.unlock();
    const c = f.contexts[0]!;
    expect(c.sources.length).toBe(1);
    expect(c.sources[0]?.loop).toBe(true);
    expect(nameOf(c.sources[0]!)).toBe("dungeon");
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
    expect(c.sources.length).toBe(1);
    expect(c.sources[0]?.started).toBe(1);
    // 同じ段のままの refresh では作り直さない
    p.refreshVolumes();
    expect(c.sources.length).toBe(1);
    // 0 に下げたら止める
    f.vol.music = 0;
    p.refreshVolumes();
    expect(c.sources[0]?.stopped).toBe(1);
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
      const c = f.contexts[0]!;
      return c.sources.map((s) => `${s.loop}:${s.started}:${s.buffer?.length}`);
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
    const lenOf = (n: string): number => sampleAt(music[n]!.end16, music[n]!.tempoUs);
    const f = setup({ music });
    const p = createAudioPlayer(f.deps);
    p.unlock();
    const c = f.contexts[0]!;
    p.setSong("dungeon1");
    // soundsFor(encounter) の順: jingle encounter → song battle1
    p.playJingle("encounter");
    p.setSong("battle1");
    expect(c.sources.map((x) => x.buffer?.length)).toEqual([lenOf("dungeon1"), lenOf("encounter")]);
    expect(c.sources[0]!.stopped).toBe(1);
    c.sources[1]!.end();
    expect(c.sources.length).toBe(3);
    expect(c.sources[2]!.buffer?.length).toBe(lenOf("battle1"));
    expect(c.sources[2]!.loop).toBe(true);
    // ジングルのファイルが無ければ、迷宮の曲を止めてすぐ戦闘の曲
    const g = setup({ music: { dungeon1: music.dungeon1!, battle1: music.battle1! } });
    const q = createAudioPlayer(g.deps);
    q.unlock();
    const d = g.contexts[0]!;
    q.setSong("dungeon1");
    q.playJingle("encounter");
    q.setSong("battle1");
    expect(d.sources.map((x) => x.buffer?.length)).toEqual([lenOf("dungeon1"), lenOf("battle1")]);
    expect(d.sources[0]!.stopped).toBe(1);
  });
});

/** source の buffer から曲名を引く（テストの曲は長さがすべて違う） */
function nameOf(s: FakeSource): string {
  return Object.values(MUSIC).find((m) => sampleAt(m.end16, m.tempoUs) === s.buffer?.length)?.name ?? "?";
}
