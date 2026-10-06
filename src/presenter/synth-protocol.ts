// UI-63（M9.5）: 区間の合成を Web Worker で行うときの主スレッドと worker の間のメッセージと、worker の側の処理。
// worker の本体（synth.worker.ts）はこの createSynthHandler を呼ぶだけ。ここは Web API に触れない（node のテストで直接呼ぶ）。
// - 主 → worker: { type: "plan" }（曲の計画。名前ごとに持ち、同じ名前の新しい計画で置き換える）、{ type: "seg" }（区間 i を合成）、
//   { type: "warmup" }（暖機。渡された計画の区間 0 を本物と同じ renderSegment で合成して捨てる。計画は持たず、返事もしない）。
// - worker → 主: { type: "seg"; id; samples }（samples の buffer は transfer。合成できなければ null）。
import { renderSegment, type SongPlan } from "./audio-synth";

export type ToSynthWorker =
  | { type: "plan"; name: string; plan: SongPlan }
  | { type: "seg"; name: string; i: number; id: number }
  | { type: "warmup"; plan: SongPlan };

export type FromSynthWorker = { type: "seg"; id: number; samples: Float32Array<ArrayBuffer> | null };

/** worker の側のメッセージ処理。返事が要るものは返事を返す（plan と warmup は null） */
export function createSynthHandler(): (m: ToSynthWorker) => FromSynthWorker | null {
  const plans: Record<string, SongPlan> = {};
  return (m) => {
    if (m.type === "plan") {
      plans[m.name] = m.plan;
      return null;
    }
    if (m.type === "warmup") {
      // 新しい worker の最初の合成が 2〜3 倍遅い（JIT がまだ温まっていない。実機 B6）ので、本物と同じ経路で 1 区間を合成して捨てる
      try {
        renderSegment(m.plan, 0);
      } catch {
        // 暖機の失敗は本物の依頼に関わらない
      }
      return null;
    }
    const plan = plans[m.name];
    let samples: Float32Array<ArrayBuffer> | null = null;
    if (plan !== undefined) {
      try {
        samples = renderSegment(plan, m.i);
      } catch {
        samples = null;
      }
    }
    return { type: "seg", id: m.id, samples };
  };
}
