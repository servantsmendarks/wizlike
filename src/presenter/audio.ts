// UI-06 / UI-63 / UI-65: 音の再生機（Web Audio）。
// - AudioContext は最初のユーザー操作（pointerup・touchend・keydown。attachAudio）の中で作り、suspended なら毎回 resume する（iOS の制約）。
//   作る前の setSong は覚えて、作ったときに始める。作る前のジングル・効果音は捨てる。
// - 曲は SongData を audio-synth.ts で合成して AudioBuffer にし（曲名ごとに 1 回）、AudioBufferSourceNode で鳴らす。
//   ループする曲は loop と loopStart / loopEnd（秒）で回す。常駐のループ・rAF・タイマーは使わない（CLAUDE.md §2）。
// - ジングルは鳴っている曲を止めて頭から 1 回。終わったら（ended）setSong の曲を頭から。ジングルの間の setSong は終わった後に始める。
// - 効果音は ZzFX 1.3.2（src/vendor）。最初の unlock の後に 1 回だけ動的 import し（効果音のファイルが 1 つも無ければ読まない）、
//   モジュールが評価時に作った AudioContext は閉じてゲームの context に差し替える。buildSamples だけを使い、
//   params の null は undefined に変える（CONV §6・§7、proposal の案 A）。読み込みが終わる前の効果音は捨てる。
// - 音量: 曲 = config.audio.musicGain × 段 / 10、効果音 = config.audio.sfxGain × 段 / 10（段は 0〜10。0 なら source を作らない）。
//   ZZFX.volume（0.3）は buildSamples の中で掛かる（zzfx() の playSamples の GainNode の 0.3 の代わりが sfxGain）。
// - 演出スキップ（settings.skipAnimations）は音に関わらない（UI-41 の省く対象に音は入らない）。
// - ファイルが無い曲・ジングル・効果音は無音（例外も console.error も出さない）。それ以外の例外も捕まえて console.warn にとどめる。
// モジュールのトップレベルでは Web API に触れない（依存は注入する。node のテストで動かす）。
import type { GameData } from "../core/data/index";
import type { GameAssets } from "../build/asset-types";
import { renderSong, SAMPLE_RATE } from "./audio-synth";

export type ZzfxModule = typeof import("../vendor/zzfx-1.3.2/ZzFX.js");

export type AudioDeps = {
  /** 最初のユーザー操作の中で呼ぶ。作れなければ（古いブラウザ）null を返し、以後無音 */
  createContext(): AudioContext | null;
  /** ZzFX を読み込む（本番は () => import("../vendor/zzfx-1.3.2/ZzFX.js")） */
  loadZzfx(): Promise<ZzfxModule>;
  data: Pick<GameData, "wavetables" | "audio" | "config">;
  assets: Pick<GameAssets, "music" | "sfx">;
  /** 設定の段（0..10） */
  volumes(): { music: number; sfx: number };
};

export type AudioPlayer = {
  /** pointerup / touchend / keydown（capture）から呼ぶ。初回で context を作り、毎回 suspended なら resume */
  unlock(): void;
  /** 場面の曲（ループ）。同じ曲が鳴っていれば何もしない。ジングル中なら終わった後に始める。ファイルが無ければ止めて無音。null で止める */
  setSong(name: string | null): void;
  /** ジングル。鳴っている曲を止めて頭から 1 回。同じジングルが鳴っている間の同じ要求は無視、別のジングルは置き換え。終わったら setSong の曲を頭から */
  playJingle(name: string): void;
  /** 効果音。ファイルが無い・音量 0・unlock 前・ZzFX の読み込み前なら何もしない */
  playSfx(name: string): void;
  /** 設定が変わったら呼ぶ（GainNode の値を変える。曲の段が 0 になったら止め、0 から上がったら頭から） */
  refreshVolumes(): void;
  /** visibilitychange: hidden で suspend、visible で resume */
  setHidden(hidden: boolean): void;
};

type Rendered = { buffer: AudioBuffer; loopStart: number | null; loopEnd: number | null };
type Playing = { kind: "song" | "jingle"; name: string; source: AudioBufferSourceNode };

function warn(e: unknown): void {
  console.warn("audio:", e);
}

export function createAudioPlayer(deps: AudioDeps): AudioPlayer {
  let tried = false;
  let ctx: AudioContext | null = null;
  let musicGain: GainNode | null = null;
  let sfxGain: GainNode | null = null;
  let hidden = false;
  /** setSong で求められた場面の曲 */
  let wanted: string | null = null;
  let playing: Playing | null = null;
  /** ended の古い通知を捨てるための番号 */
  let gen = 0;
  /** 曲名 → 合成済みの buffer（ファイルが無い・作れないなら null） */
  const rendered: Record<string, Rendered | null> = {};
  let zzfxLoad: Promise<void> | null = null;
  let zz: ZzfxModule | null = null;

  const level = (k: "music" | "sfx"): number => {
    const v = deps.volumes()[k];
    return Number.isFinite(v) ? Math.min(10, Math.max(0, v)) : 0;
  };
  const gainOf = (k: "music" | "sfx"): number =>
    (k === "music" ? deps.data.config.audio.musicGain : deps.data.config.audio.sfxGain) * (level(k) / 10);

  const stopPlaying = (): void => {
    const p = playing;
    if (p === null) return;
    playing = null;
    gen++;
    try {
      p.source.onended = null;
      p.source.stop();
      p.source.disconnect();
    } catch (e) {
      warn(e);
    }
  };

  const bufferOf = (c: AudioContext, name: string): Rendered | null => {
    if (name in rendered) return rendered[name] ?? null;
    const song = deps.assets.music[name];
    let r: Rendered | null = null;
    if (song !== undefined) {
      try {
        const out = renderSong(song, deps.data.wavetables);
        if (out.samples.length > 0) {
          const buffer = c.createBuffer(1, out.samples.length, SAMPLE_RATE);
          buffer.copyToChannel(out.samples, 0);
          r = { buffer, loopStart: out.loopStart, loopEnd: out.loopEnd };
        }
      } catch (e) {
        warn(e);
      }
    }
    rendered[name] = r;
    return r;
  };

  /** buffer を頭から鳴らす（loop なら loopStart / loopEnd で回す） */
  const start = (kind: Playing["kind"], name: string, r: Rendered): void => {
    const c = ctx;
    const g = musicGain;
    if (c === null || g === null) return;
    const source = c.createBufferSource();
    source.buffer = r.buffer;
    if (kind === "song" && r.loopStart !== null && r.loopEnd !== null) {
      source.loop = true;
      source.loopStart = r.loopStart / SAMPLE_RATE;
      source.loopEnd = r.loopEnd / SAMPLE_RATE;
    }
    source.connect(g);
    const my = ++gen;
    playing = { kind, name, source };
    if (kind === "jingle") {
      source.onended = () => {
        if (my !== gen) return;
        playing = null;
        try {
          source.disconnect();
        } catch (e) {
          warn(e);
        }
        startWanted();
      };
    }
    source.start(0);
  };

  /** 場面の曲を始める（同じ曲が鳴っていれば何もしない） */
  const startWanted = (): void => {
    try {
      if (playing !== null && playing.kind === "song" && playing.name === wanted) return;
      stopPlaying();
      const c = ctx;
      if (c === null || wanted === null || level("music") === 0) return;
      const r = bufferOf(c, wanted);
      if (r !== null) start("song", wanted, r);
    } catch (e) {
      warn(e);
    }
  };

  const applyGains = (): void => {
    if (musicGain !== null) musicGain.gain.value = gainOf("music");
    if (sfxGain !== null) sfxGain.gain.value = gainOf("sfx");
  };

  const loadSfx = (c: AudioContext): void => {
    if (zzfxLoad !== null || Object.keys(deps.assets.sfx).length === 0) return;
    zzfxLoad = deps
      .loadZzfx()
      .then((mod) => {
        const z = mod.ZZFX;
        // モジュールが評価時に作った AudioContext は閉じて、ゲームの context に差し替える
        if (z.audioContext !== c) {
          const extra = z.audioContext;
          z.audioContext = c;
          try {
            void Promise.resolve(extra.close()).catch(warn);
          } catch (e) {
            warn(e);
          }
        }
        zz = mod;
      })
      .catch((e: unknown) => {
        // 以後効果音は無音（警告は 1 回だけ）
        warn(e);
      });
  };

  return {
    unlock(): void {
      try {
        if (!tried) {
          tried = true;
          const c = deps.createContext();
          if (c === null) return;
          ctx = c;
          musicGain = c.createGain();
          sfxGain = c.createGain();
          musicGain.connect(c.destination);
          sfxGain.connect(c.destination);
          applyGains();
          startWanted();
          loadSfx(c);
        }
        const c = ctx;
        if (c !== null && c.state === "suspended" && !hidden) void c.resume().catch(warn);
      } catch (e) {
        warn(e);
      }
    },
    setSong(name: string | null): void {
      wanted = name;
      if (playing !== null && playing.kind === "jingle") return;
      startWanted();
    },
    playJingle(name: string): void {
      try {
        const c = ctx;
        if (c === null) return;
        if (playing !== null && playing.kind === "jingle" && playing.name === name) return;
        if (level("music") === 0) return;
        const r = bufferOf(c, name);
        if (r === null) return;
        stopPlaying();
        start("jingle", name, r);
      } catch (e) {
        warn(e);
      }
    },
    playSfx(name: string): void {
      try {
        const c = ctx;
        const g = sfxGain;
        const mod = zz;
        if (c === null || g === null || mod === null || level("sfx") === 0) return;
        const sfx = deps.assets.sfx[name];
        if (sfx === undefined) return;
        const samples = mod.ZZFX.buildSamples(...sfx.params.map((x) => x ?? undefined));
        if (samples.length === 0) return;
        const buffer = c.createBuffer(1, samples.length, mod.ZZFX.sampleRate);
        buffer.copyToChannel(Float32Array.from(samples), 0);
        const source = c.createBufferSource();
        source.buffer = buffer;
        source.connect(g);
        source.onended = () => {
          try {
            source.disconnect();
          } catch (e) {
            warn(e);
          }
        };
        source.start(0);
      } catch (e) {
        warn(e);
      }
    },
    refreshVolumes(): void {
      try {
        applyGains();
        if (ctx === null) return;
        if (level("music") === 0) stopPlaying();
        else if (playing === null) startWanted();
      } catch (e) {
        warn(e);
      }
    },
    setHidden(h: boolean): void {
      hidden = h;
      const c = ctx;
      if (c === null) return;
      try {
        if (h) void c.suspend().catch(warn);
        else if (c.state === "suspended") void c.resume().catch(warn);
      } catch (e) {
        warn(e);
      }
    },
  };
}

/** UI-06: 最初のユーザー操作で unlock、ページが隠れたら suspend・戻ったら resume。外す関数を返す */
export function attachAudio(
  doc: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState">,
  player: Pick<AudioPlayer, "unlock" | "setHidden">,
): () => void {
  const unlock = (): void => player.unlock();
  const vis = (): void => player.setHidden(doc.visibilityState === "hidden");
  const kinds = ["pointerup", "touchend", "keydown"] as const;
  for (const k of kinds) doc.addEventListener(k, unlock, { capture: true });
  doc.addEventListener("visibilitychange", vis);
  return () => {
    for (const k of kinds) doc.removeEventListener(k, unlock, { capture: true });
    doc.removeEventListener("visibilitychange", vis);
  };
}
