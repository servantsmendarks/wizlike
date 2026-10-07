// UI-06 / UI-63 / UI-65: 音の再生機（Web Audio）。
// - AudioContext は最初のユーザー操作（pointerup・touchend・keydown。attachAudio）の中で作り、suspended なら毎回 resume する（iOS の制約）。
//   作る前の setSong は覚えて、作ったときに始める。作る前のジングル・効果音は捨てる。AudioContext のレートは指定しない（端末の既定）。
// - 曲とジングルは区間（小節の頭とループ点で区切る。audio-synth.ts の planSong / renderSegment / nextSegment）ごとに
//   合成して AudioBuffer（1 チャンネル、config.audio.sampleRate）にし、区間ごとの AudioBufferSourceNode を start(when) で
//   隙間なく予約して鳴らす（M9.5）。when = 区間 0 の時刻 t0 + 予約済みの区間の長さの累計（整数のサンプル数）/ レート。
//   t0 = currentTime + baseLatency（取れなければ 0）+ config.audio.startLeadMs / 1000。
// - 鳴らし始めは区間 0 の合成だけを待つ。前の曲は区間 0 が揃ってから、区間 0 を予約した後の t0（置き直されたら置き直した後）で止まるように予約する（stop(t0)。無音を挟まない）。
//   区間 0 を待つ間に別の曲・ジングル・停止が頼まれたら、待っていた依頼は取り消す（依頼ごとの番号 req）。
// - 先読みは config.audio.prefetchBars 区間。鳴らし始めの直後は yieldTask（イベントループへ 1 回戻す）ごとに 1 区間ずつ、
//   以後は区間の ended で 1 区間ずつ合成して予約する。常駐のループ・rAF・タイマーは使わない（CLAUDE.md §2）。
//   予約の時刻に間に合わない区間は時刻を置き直す（隙間は出るが重ならない）。
// - 区間の合成は注入した renderer（本番は Web Worker の createWorkerRenderer。作れなければ主スレッドの createSyncRenderer）。
//   Web Worker 版は再生機の作成時に固定のダミー区間（warmupPlan）を合成して捨てる（暖機。新しい worker の最初の合成が遅いため。同期版はしない）。
// - 合成済みの区間はループする曲ごとに持ち（2 周目と戻ったときは合成しない）、直近 config.audio.keepSongs 曲だけ残す。
//   ジングルは鳴っている間だけ持つ（保持の数に入れない）。
// - ジングルは鳴っている曲を止めて頭から 1 回。最後の区間を予約したら setSong の曲の区間 0 をジングルの終わりの時刻に予約し
//   （無音を挟まない。ジングルの間の setSong・別のジングル・停止で予約し直す・取り消す）、最後の区間の ended でそれを鳴っているものにする。
// - 効果音は ZzFX 1.3.2（src/vendor）。名前ごとに 1 回だけ合成して AudioBuffer を持ち、再生はそれを使う（M9.5。初回の合成が
//   主スレッドで 60ms 以上かかったため）。合成は ZzFX の事前合成（ZZFXSound）と同じく randomness を 0 にし、揺らぎは再生のたびの
//   playbackRate で付ける（sfx-samples.ts）。params の null は undefined に変える（CONV §6・§7、proposal の案 A）。
//   renderer が sfx を持てば（Web Worker 版）、作成時（読み込み時）にすべての効果音の合成を頼み、返ってきたサンプル列を持ち、
//   AudioContext ができたら（または返事が後なら返事のときに）AudioBuffer にする。返事の前・worker が無い・合成できなかった効果音は、
//   最初の unlock の後に 1 回だけ動的 import する ZzFX（効果音のファイルが 1 つも無ければ読まない。モジュールが評価時に作った
//   AudioContext は閉じてゲームの context に差し替える）の buildSamples で、初回の再生のときに主スレッドで合成する。
//   バッファも ZzFX も無い効果音は捨てる。
// - 音量: 曲 = config.audio.musicGain × 段 / 10、効果音 = config.audio.sfxGain × 段 / 10（段は 0〜10。0 なら source を作らない）。
//   ZZFX.volume（0.3）は buildSamples の中で掛かる（zzfx() の playSamples の GainNode の 0.3 の代わりが sfxGain）。
// - 演出スキップ（settings.skipAnimations）は音に関わらない（UI-41 の省く対象に音は入らない）。
// - ファイルが無い曲・ジングル・効果音は無音（例外も console.error も出さない）。それ以外の例外も捕まえて console.warn にとどめる。
// モジュールのトップレベルでは Web API に触れない（依存は注入する。node のテストで動かす）。
import type { GameData, Wavetables } from "../core/data/index";
import type { GameAssets, SongData } from "../build/asset-types";
import { nextSegment, planSong, renderSegment, segmentCount, warmupPlan, type SongPlan } from "./audio-synth";
import { sfxArgs, sfxRate, sfxSampleRate } from "./sfx-samples";
import type { FromSynthWorker, ToSynthWorker } from "./synth-protocol";

export type ZzfxModule = typeof import("../vendor/zzfx-1.3.2/ZzFX.js");

/** UI-63（M9.5）: 区間の合成の口。同期版はその場で cb を呼ぶ。Web Worker 版（createWorkerRenderer）は後で呼ぶ */
export type SegmentRenderer = {
  /** 計画を作る（同期。音符の並べ替えだけで軽い） */
  plan(song: SongData, wt: Wavetables, rate: number): SongPlan;
  /** 区間 i を合成して cb に渡す。合成できなければ null */
  render(name: string, plan: SongPlan, i: number, cb: (samples: Float32Array<ArrayBuffer> | null) => void): void;
  /** 暖機（Web Worker 版だけが持つ）。計画（warmupPlan）の区間 0 を本物と同じ経路で合成して捨てる。返事も保持もしない */
  warmup?(plan: SongPlan): void;
  /**
   * UI-65（M9.5）: 効果音の事前合成（Web Worker 版だけが持つ）。params は assets の引数配列のまま。合成したサンプル列を cb に渡す。
   * worker が無い（作れない・error の後）・合成できなければ null（再生機は初回の再生のときに主スレッドで合成する）
   */
  sfx?(name: string, params: (number | null)[], cb: (samples: Float32Array<ArrayBuffer> | null) => void): void;
};
/** UI-63（M9.5）: cb をイベントループへ 1 回戻してから呼ぶ（間にタップの処理が入れるように） */
export type YieldTask = (cb: () => void) => void;

export type AudioDeps = {
  /** 最初のユーザー操作の中で呼ぶ。作れなければ（古いブラウザ）null を返し、以後無音 */
  createContext(): AudioContext | null;
  /** ZzFX を読み込む（本番は () => import("../vendor/zzfx-1.3.2/ZzFX.js")） */
  loadZzfx(): Promise<ZzfxModule>;
  data: Pick<GameData, "wavetables" | "audio" | "config">;
  assets: Pick<GameAssets, "music" | "sfx">;
  /** 設定の段（0..10） */
  volumes(): { music: number; sfx: number };
  /** 区間の合成（本番は createWorkerRenderer(...)。worker が使えなければその中で同期版に切り替わる） */
  renderer: SegmentRenderer;
  /** 先読みの 1 区間ごとにイベントループへ戻す（本番は createMessageChannelYield()） */
  yieldTask: YieldTask;
  /** UI-65（M9.5）: 効果音の揺らぎの乱数（0 以上 1 未満。省略なら Math.random。表示層の演出だけに使う） */
  random?: () => number;
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

type Kind = "song" | "jingle";

/** 曲（またはジングル）の計画と合成済みの区間 */
type SongCache = { name: string; plan: SongPlan; buffers: (AudioBuffer | undefined)[] };
/** 鳴っている曲・ジングル */
type Track = {
  kind: Kind;
  name: string;
  cache: SongCache;
  /** 区間 0 の開始の ctx 時刻（予約の基準。間に合わないときは置き直す） */
  t0: number;
  /** 予約済みの区間の長さの累計（サンプル数） */
  played: number;
  /** 次に予約する区間（無ければ null） */
  nextSeg: number | null;
  /** 予約済みで鳴り終わっていない source */
  queued: AudioBufferSourceNode[];
  /** 先読みの区間を合成している最中 */
  filling: boolean;
};
/** 鳴らし始めの区間 0 を頼んでいる最中のもの */
type Pending = { req: number; kind: Kind; name: string; cache: SongCache };
/** ジングルの終わりの時刻に予約した場面の曲（track は区間 0 が揃うまで null） */
type Follow = { name: string; cache: SongCache; track: Track | null };

function warn(e: unknown): void {
  console.warn("audio:", e);
}

/** UI-63（M9.5）: 主スレッドでその場で合成する renderer */
export function createSyncRenderer(): SegmentRenderer {
  return {
    plan: (song, wt, rate) => planSong(song, wt, rate),
    render(_name, plan, i, cb) {
      let samples: Float32Array<ArrayBuffer> | null = null;
      try {
        samples = renderSegment(plan, i);
      } catch (e) {
        warn(e);
      }
      cb(samples);
    },
  };
}

/**
 * UI-63（M9.5）: Web Worker（synth.worker.ts。make で作る）で区間を合成する renderer（1 区間の合成が実機で 50ms 以上かかったため）。
 * worker は作成時（main.ts がページの読み込み時に作る）に起動しておく（最初のタップで worker の起動を待たないため。2026-10-06）。
 * 計画は名前ごとに送り、同じ計画を送り済みなら送らない（worker は名前ごとに最後の計画を持つ）。
 * 返事は依頼ごとの番号 id で cb に渡す（古い結果を捨てるのは再生機の req と gen）。worker が作れない・error か messageerror が
 * 来たら、warn を 1 回出して以後は同期版で合成し、返事を待っている依頼も同期版で合成し直して cb に渡す。
 */
export function createWorkerRenderer(make: () => Worker): SegmentRenderer {
  const sync = createSyncRenderer();
  type Waiting = { name: string; plan: SongPlan; i: number; cb: (samples: Float32Array<ArrayBuffer> | null) => void };
  let worker: Worker | null = null;
  let failed = false;
  let idSeq = 0;
  const sent: Record<string, SongPlan> = {};
  const waiting = new Map<number, Waiting>();
  /** 返事を待っている効果音（名前ごと。同じ名前の依頼は最後のものだけ。まだ送っていないものも含む） */
  const waitingSfx = new Map<string, (samples: Float32Array<ArrayBuffer> | null) => void>();
  /**
   * 未定-16（2026-10-07）: まだ送っていない効果音の依頼（届いた順）。worker は届いた順に 1 件ずつ処理するので、効果音は 1 個ずつ
   * （前の返事が来てから次を）送り、曲の区間の依頼（plan・seg）はすぐ送る。区間の前に並ぶ効果音は高々 1 個になる
   */
  const sfxQueue: { name: string; params: (number | null)[] }[] = [];
  /** 送って返事を待っている効果音があるか（高々 1 個） */
  let sfxBusy = false;

  const fail = (e: unknown): void => {
    if (failed) return;
    failed = true;
    warn(e);
    const w = worker;
    worker = null;
    try {
      w?.terminate();
    } catch (err) {
      warn(err);
    }
    const rest = [...waiting.values()];
    waiting.clear();
    for (const r of rest) sync.render(r.name, r.plan, r.i, r.cb);
    // 効果音は主スレッドで合成し直さない（読み込み時に主スレッドを止めないため。再生機が初回の再生のときに合成する）
    const sfxRest = [...waitingSfx.values()];
    waitingSfx.clear();
    sfxQueue.length = 0;
    sfxBusy = false;
    for (const cb of sfxRest) cb(null);
  };

  const get = (): Worker | null => {
    if (failed) return null;
    if (worker !== null) return worker;
    try {
      const w = make();
      w.onmessage = (e: MessageEvent<FromSynthWorker>) => {
        const m = e.data;
        if (m.type === "sfx") {
          sfxBusy = false;
          const cb = waitingSfx.get(m.name);
          if (cb !== undefined) {
            waitingSfx.delete(m.name);
            cb(m.samples);
          }
          pumpSfx();
          return;
        }
        const r = waiting.get(m.id);
        if (r === undefined) return;
        waiting.delete(m.id);
        r.cb(m.samples);
      };
      w.onerror = (e) => fail(e);
      w.onmessageerror = (e) => fail(e);
      worker = w;
      return w;
    } catch (e) {
      fail(e);
      return null;
    }
  };

  /** 返事を待っている効果音が無ければ、待ち行列の先頭の効果音を 1 個送る */
  const pumpSfx = (): void => {
    if (sfxBusy || failed) return;
    const next = sfxQueue.shift();
    if (next === undefined) return;
    const w = get();
    if (w === null) return;
    sfxBusy = true;
    try {
      const m: ToSynthWorker = { type: "sfx", name: next.name, params: next.params };
      w.postMessage(m);
    } catch (e) {
      // 待っている効果音（送っていないものを含む）は fail が null で返す
      fail(e);
    }
  };

  // 読み込み時に起動しておく。作れなければ fail が warn を出し、以後は同期版（待っている依頼は無い）
  get();

  return {
    plan: (song, wt, rate) => sync.plan(song, wt, rate),
    warmup(plan) {
      // worker が無い（作れない・error の後）なら暖機しない（主スレッドで合成すると読み込み時に主スレッドを止めるだけ）
      const w = get();
      if (w === null) return;
      try {
        const m: ToSynthWorker = { type: "warmup", plan };
        w.postMessage(m);
      } catch (e) {
        fail(e);
      }
    },
    sfx(name, params, cb) {
      const w = get();
      if (w === null) {
        cb(null);
        return;
      }
      waitingSfx.set(name, cb);
      // まだ送っていない同じ名前の依頼があれば引数だけ新しくする。送り済み（返事待ち）の同じ名前はもう一度送る
      // （先の返事が新しい cb に渡り、後の返事は捨てる。今の呼び手は requestSfx の名前ごとに 1 回だけ）
      const queued = sfxQueue.find((q) => q.name === name);
      if (queued !== undefined) queued.params = params;
      else sfxQueue.push({ name, params });
      pumpSfx();
    },
    render(name, plan, i, cb) {
      const w = get();
      if (w === null) {
        sync.render(name, plan, i, cb);
        return;
      }
      const id = ++idSeq;
      waiting.set(id, { name, plan, i, cb });
      try {
        if (sent[name] !== plan) {
          const m: ToSynthWorker = { type: "plan", name, plan };
          w.postMessage(m);
          sent[name] = plan;
        }
        const m: ToSynthWorker = { type: "seg", name, i, id };
        w.postMessage(m);
      } catch (e) {
        // 待っている依頼（この依頼を含む）は fail が同期版で合成し直す
        fail(e);
      }
    },
  };
}

/**
 * UI-63（M9.5）: MessageChannel の 1 回きりの通知で cb をイベントループへ戻す（タイマーではない。呼ばれたときだけ作り、
 * 通知の後に閉じるので常駐しない）。モジュールの評価時には Web API に触れない。
 */
export function createMessageChannelYield(): YieldTask {
  return (cb) => {
    const ch = new MessageChannel();
    ch.port2.onmessage = () => {
      ch.port1.close();
      ch.port2.close();
      cb();
    };
    ch.port1.postMessage(null);
  };
}

export function createAudioPlayer(deps: AudioDeps): AudioPlayer {
  let tried = false;
  let ctx: AudioContext | null = null;
  let musicGain: GainNode | null = null;
  let sfxGain: GainNode | null = null;
  let hidden = false;
  /** setSong で求められた場面の曲 */
  let wanted: string | null = null;
  let playing: Track | null = null;
  let pending: Pending | null = null;
  /** 区間 0 の依頼ごとに増やす番号 */
  let reqSeq = 0;
  /** 鳴っているジングルの後に続ける場面の曲 */
  let follow: Follow | null = null;
  /** 合成済みの区間を持つループする曲（先頭が最近）。config.audio.keepSongs 曲まで */
  let caches: SongCache[] = [];
  let zzfxLoad: Promise<void> | null = null;
  let zz: ZzfxModule | null = null;
  /** UI-65（M9.5）: worker が合成した効果音のサンプル列（AudioContext ができる前の返事。AudioBuffer にしたら消す） */
  const sfxSamples: Record<string, Float32Array<ArrayBuffer>> = {};
  /** UI-65（M9.5）: 効果音の AudioBuffer（名前ごとに 1 つ。以後の再生はこれを使い、合成し直さない） */
  const sfxBuffers: Record<string, AudioBuffer> = {};
  const random = deps.random ?? Math.random;
  const conf = deps.data.config.audio;

  const level = (k: "music" | "sfx"): number => {
    const v = deps.volumes()[k];
    return Number.isFinite(v) ? Math.min(10, Math.max(0, v)) : 0;
  };
  const gainOf = (k: "music" | "sfx"): number => (k === "music" ? conf.musicGain : conf.sfxGain) * (level(k) / 10);

  /** 鳴らし始めの先行の時間（秒）= baseLatency（取れなければ 0）+ startLeadMs */
  const lead = (c: AudioContext): number => {
    const bl: unknown = (c as { baseLatency?: unknown }).baseLatency;
    return (typeof bl === "number" && Number.isFinite(bl) && bl > 0 ? bl : 0) + conf.startLeadMs / 1000;
  };

  /** 計画を作る（ファイルが無い・区間が無い・作れないなら null） */
  const newCache = (name: string): SongCache | null => {
    const song = deps.assets.music[name];
    if (song === undefined) return null;
    try {
      const plan = deps.renderer.plan(song, deps.data.wavetables, conf.sampleRate);
      return segmentCount(plan) > 0 ? { name, plan, buffers: [] } : null;
    } catch (e) {
      warn(e);
      return null;
    }
  };

  /** ループする曲の保持（LRU）から引く。無ければ計画を作って入れる。直近 keepSongs 曲を越えた古いものは捨てる */
  const songCache = (name: string): SongCache | null => {
    const k = caches.findIndex((x) => x.name === name);
    const cache = k >= 0 ? caches[k] : newCache(name);
    if (cache === undefined || cache === null) return null;
    caches = [cache, ...caches.filter((x) => x !== cache)];
    while (caches.length > conf.keepSongs) {
      // いま頼んだ曲・鳴っている曲・区間 0 を待っている曲は捨てない（非同期の renderer で、鳴っている曲と待っている曲が
      // 後ろに並んだまま別の曲を頼んだときや、keepSongs = 1 のとき。その間は keepSongs を一時的に越え、次の刈り込みで減る）
      let j = caches.length - 1;
      while (j >= 0 && (caches[j] === cache || caches[j] === playing?.cache || caches[j] === pending?.cache || caches[j] === follow?.cache)) j--;
      if (j < 0) break;
      caches.splice(j, 1);
    }
    return cache;
  };

  /** 区間 i の AudioBuffer を cb に渡す（合成済みならその場で） */
  const withSegment = (cache: SongCache, i: number, cb: (b: AudioBuffer | null) => void): void => {
    const have = cache.buffers[i];
    if (have !== undefined) {
      cb(have);
      return;
    }
    deps.renderer.render(cache.name, cache.plan, i, (samples) => {
      let b: AudioBuffer | null = null;
      try {
        const c = ctx;
        if (c !== null && samples !== null && samples.length > 0) {
          b = c.createBuffer(1, samples.length, cache.plan.rate);
          b.copyToChannel(samples, 0);
          cache.buffers[i] = b;
        }
      } catch (e) {
        warn(e);
        b = null;
      }
      cb(b);
    });
  };

  /** 区間 i を予約する（when = t0 + 累計 / レート。間に合わなければ t0 を置き直す） */
  const schedule = (t: Track, i: number, buffer: AudioBuffer): void => {
    const c = ctx;
    const g = musicGain;
    if (c === null || g === null) return;
    const { plan } = t.cache;
    let when = t.t0 + t.played / plan.rate;
    const min = c.currentTime + lead(c);
    if (when < min) {
      t.t0 = min - t.played / plan.rate;
      when = min;
    }
    const source = c.createBufferSource();
    source.buffer = buffer;
    source.connect(g);
    source.onended = () => onEnded(t, source);
    t.queued.push(source);
    t.played += (plan.bounds[i + 1] ?? 0) - (plan.bounds[i] ?? 0);
    t.nextSeg = nextSegment(plan, i);
    source.start(when);
  };

  const needMore = (t: Track): boolean => t.nextSeg !== null && t.queued.length < 1 + conf.prefetchBars;

  /** ジングルの終わり（最後の区間まで鳴り終わった）なら場面の曲へ */
  const finishJingle = (t: Track): boolean => {
    if (t.kind !== "jingle" || t.nextSeg !== null || t.queued.length > 0 || t.filling) return false;
    playing = null;
    const fw = follow;
    if (fw !== null && fw.track !== null && fw.name === wanted && ctx !== null && level("music") > 0) {
      // ジングルの終わりの時刻に予約済みの場面の曲を、鳴っているものにして先読みを続ける
      follow = null;
      const next = fw.track;
      playing = next;
      if (needMore(next)) deps.yieldTask(() => fill(next));
      return true;
    }
    cancelFollow();
    startWanted();
    return true;
  };

  /** 先読みを 1 区間埋める。まだ足りなければ yieldTask でもう一度 */
  const fill = (t: Track): void => {
    if (playing !== t || t.filling || !needMore(t)) return;
    const i = t.nextSeg;
    if (i === null) return;
    t.filling = true;
    withSegment(t.cache, i, (b) => {
      t.filling = false;
      if (playing !== t) return;
      try {
        if (b === null) {
          // 合成できない区間から先は鳴らさない。ループする曲は止めて「鳴っている」扱いを外す（同じ曲の setSong・音量の変更で作り直せる）
          t.nextSeg = null;
          if (t.kind === "song") stopTrack();
          else {
            prepareFollow(t);
            finishJingle(t);
          }
          return;
        }
        schedule(t, i, b);
        prepareFollow(t);
        if (needMore(t)) deps.yieldTask(() => fill(t));
      } catch (e) {
        warn(e);
      }
    });
  };

  const onEnded = (t: Track, source: AudioBufferSourceNode): void => {
    try {
      const k = t.queued.indexOf(source);
      if (k >= 0) t.queued.splice(k, 1);
      source.disconnect();
      if (playing !== t) return;
      if (finishJingle(t)) return;
      fill(t);
    } catch (e) {
      warn(e);
    }
  };

  /** 前の曲の予約を t0 で止める（disconnect は ended の中。すぐ切ると t0 までの音が切れる） */
  const switchAt = (old: Track, t0: number): void => {
    for (const s of old.queued) {
      s.onended = () => {
        try {
          s.disconnect();
        } catch (e) {
          warn(e);
        }
      };
      try {
        s.stop(t0);
      } catch (e) {
        warn(e);
      }
    }
    old.queued = [];
  };

  /** すぐ止める（段 0・wanted が null・ファイルが無い曲）。待っている依頼も取り消す */
  const stopPlaying = (): void => {
    pending = null;
    stopTrack();
  };

  /** ジングルの後に予約した場面の曲を取り消す（予約済みの区間 0 はすぐ止める） */
  const cancelFollow = (): void => {
    const fw = follow;
    follow = null;
    if (fw === null || fw.track === null) return;
    for (const s of fw.track.queued) {
      try {
        s.onended = null;
        s.stop();
        s.disconnect();
      } catch (e) {
        warn(e);
      }
    }
    fw.track.queued = [];
  };

  /**
   * ジングル j の最後の区間を予約した後（j.nextSeg === null）に呼ぶ。場面の曲の区間 0 を用意し、ジングルの終わりの時刻
   * （j.t0 + 累計 / レート。過ぎていれば schedule が currentTime + 先行の時間に置き直す）に予約する。
   * ジングルの間に場面が変わったら（setSong）予約し直す。最後の区間の ended（finishJingle）でこれを鳴っているものにする。
   */
  const prepareFollow = (j: Track): void => {
    if (playing !== j || j.kind !== "jingle" || j.nextSeg !== null) return;
    if (follow !== null && follow.name === wanted) return;
    cancelFollow();
    if (ctx === null || wanted === null || level("music") === 0) return;
    const cache = songCache(wanted);
    if (cache === null) return;
    const fw: Follow = { name: wanted, cache, track: null };
    follow = fw;
    const jEnd = j.t0 + j.played / j.cache.plan.rate;
    withSegment(cache, 0, (b) => {
      if (follow !== fw) return;
      try {
        if (b === null) {
          follow = null;
          return;
        }
        const t: Track = { kind: "song", name: fw.name, cache, t0: jEnd, played: 0, nextSeg: 0, queued: [], filling: false };
        fw.track = t;
        schedule(t, 0, b);
      } catch (e) {
        warn(e);
      }
    });
  };

  /** 鳴っている曲・ジングルの予約をすぐ止める（待っている依頼はそのまま）。ジングルの後の予約も取り消す */
  const stopTrack = (): void => {
    cancelFollow();
    const p = playing;
    if (p === null) return;
    playing = null;
    for (const s of p.queued) {
      try {
        s.onended = null;
        s.stop();
        s.disconnect();
      } catch (e) {
        warn(e);
      }
    }
    p.queued = [];
  };

  /** 区間 0 を頼み、揃ったら（その依頼が最新なら）前を t0 で止めて鳴らし始める */
  const begin = (kind: Kind, cache: SongCache): void => {
    const req = ++reqSeq;
    pending = { req, kind, name: cache.name, cache };
    withSegment(cache, 0, (b) => {
      if (pending?.req !== req) return;
      pending = null;
      try {
        const c = ctx;
        if (c === null) return;
        if (b === null) {
          if (kind === "song") stopPlaying();
          return;
        }
        const old = playing;
        // 前のジングルの後に予約した場面の曲は取り消す（新しい曲・ジングルに置き換わる）
        cancelFollow();
        const t: Track = { kind, name: cache.name, cache, t0: c.currentTime + lead(c), played: 0, nextSeg: 0, queued: [], filling: false };
        playing = t;
        // 区間 0 を先に予約して時刻を確定させ（schedule が置き直したら置き直した後の t.t0）、前の曲をその時刻で止める。
        // 先に止めると、間に currentTime が 1 レンダー量子進んで schedule が置き直したとき stop と start の間に隙間ができる
        schedule(t, 0, b);
        if (old !== null) switchAt(old, t.t0);
        prepareFollow(t);
        if (!finishJingle(t) && needMore(t)) deps.yieldTask(() => fill(t));
      } catch (e) {
        warn(e);
      }
    });
  };

  const jingleBusy = (): boolean => playing?.kind === "jingle" || pending?.kind === "jingle";

  /** 場面の曲を始める（同じ曲が鳴っていれば何もしない） */
  const startWanted = (): void => {
    try {
      if (playing !== null && playing.kind === "song" && playing.name === wanted) {
        pending = null;
        return;
      }
      if (ctx === null || wanted === null || level("music") === 0) {
        stopPlaying();
        return;
      }
      if (pending !== null && pending.kind === "song" && pending.name === wanted) return;
      const cache = songCache(wanted);
      if (cache === null) {
        stopPlaying();
        return;
      }
      begin("song", cache);
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

  /** 効果音のサンプル列を AudioBuffer にして持つ（効果音のレート 44100。空なら持たない） */
  const keepSfx = (c: AudioContext, name: string, samples: Float32Array<ArrayBuffer>, rate: number): AudioBuffer | null => {
    if (samples.length === 0) return null;
    const buffer = c.createBuffer(1, samples.length, rate);
    buffer.copyToChannel(samples, 0);
    sfxBuffers[name] = buffer;
    return buffer;
  };
  const keepWorkerSfx = (c: AudioContext): void => {
    for (const [name, samples] of Object.entries(sfxSamples)) {
      delete sfxSamples[name];
      if (sfxBuffers[name] === undefined) keepSfx(c, name, samples, sfxSampleRate);
    }
  };

  // UI-65（M9.5）: 効果音の事前合成。renderer が sfx を持てば（Web Worker 版）、作成時（読み込み時。暖機の後）にすべての効果音を頼む。
  // 同期版・worker が無いときは頼まない（主スレッドで合成するのは初回の再生のとき）
  const requestSfx = (): void => {
    const sfx = deps.renderer.sfx;
    if (sfx === undefined) return;
    for (const [name, data] of Object.entries(deps.assets.sfx)) {
      try {
        sfx.call(deps.renderer, name, data.params, (samples) => {
          try {
            if (samples === null || sfxBuffers[name] !== undefined) return;
            if (ctx === null) sfxSamples[name] = samples;
            else keepSfx(ctx, name, samples, sfxSampleRate);
          } catch (e) {
            warn(e);
          }
        });
      } catch (e) {
        warn(e);
      }
    }
  };

  // 暖機（M9.5 B6。2026-10-07 ユーザーの判断で固定のダミー区間）: renderer が warmup を持てば（Web Worker 版）、作成時（読み込み時。
  // worker の起動の直後）に warmupPlan（実在の曲に依存しない。波形の全種とノイズの全種を含む config.audio.warmupSeconds 秒の 1 区間）を
  // 1 回合成させて捨てる。曲のファイルの有無に関係なく送る。warmupSeconds が 0 なら送らない。計画は保持に入れない
  if (deps.renderer.warmup !== undefined && conf.warmupSeconds > 0) {
    try {
      const plan = warmupPlan(deps.data.wavetables, conf.sampleRate, conf.warmupSeconds);
      if (segmentCount(plan) > 0) deps.renderer.warmup(plan);
    } catch (e) {
      warn(e);
    }
  }
  requestSfx();

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
          keepWorkerSfx(c);
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
      if (jingleBusy()) {
        // ジングルの最後の区間を予約済みなら、後に続ける場面の曲を予約し直す
        try {
          if (playing?.kind === "jingle") prepareFollow(playing);
        } catch (e) {
          warn(e);
        }
        return;
      }
      startWanted();
    },
    playJingle(name: string): void {
      try {
        if (ctx === null) return;
        // 同じジングルが鳴っている・頼んでいる最中なら無視
        if (pending !== null ? pending.kind === "jingle" && pending.name === name : playing?.kind === "jingle" && playing.name === name) return;
        if (level("music") === 0) return;
        const cache = newCache(name);
        if (cache === null) return;
        begin("jingle", cache);
      } catch (e) {
        warn(e);
      }
    },
    playSfx(name: string): void {
      try {
        const c = ctx;
        const g = sfxGain;
        const mod = zz;
        if (c === null || g === null || level("sfx") === 0) return;
        const sfx = deps.assets.sfx[name];
        if (sfx === undefined) return;
        // 持っているバッファを使う。無ければ（worker の返事の前・worker が無い）ZzFX で 1 回だけ合成して持つ。ZzFX も無ければ捨てる
        let buffer: AudioBuffer | null = sfxBuffers[name] ?? null;
        if (buffer === null) {
          if (mod === null) return;
          buffer = keepSfx(c, name, Float32Array.from(mod.ZZFX.buildSamples(...sfxArgs(sfx.params))), mod.ZZFX.sampleRate);
          if (buffer === null) return;
        }
        const source = c.createBufferSource();
        source.buffer = buffer;
        // 揺らぎ（ZZFXSound と同じく再生の速さで付ける）
        source.playbackRate.value = sfxRate(sfx.params, random());
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
        else if (playing === null && pending === null) startWanted();
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
