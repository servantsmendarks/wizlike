// UI-63（M9.5）: 区間の合成をする Web Worker（main.ts が new Worker(new URL(...), { type: "module" }) で作る）。
// メッセージの処理は synth-protocol.ts の createSynthHandler（曲の区間と、UI-65 の効果音の事前合成）。合成した samples の buffer は transfer で返す。
// tsconfig の lib に WebWorker が無いので、self に必要な形だけを当てる。
import { createSynthHandler, type FromSynthWorker, type ToSynthWorker } from "./synth-protocol";

const scope = self as unknown as {
  onmessage: ((e: { data: ToSynthWorker }) => void) | null;
  postMessage(m: FromSynthWorker, transfer: Transferable[]): void;
};
const handle = createSynthHandler();
scope.onmessage = (e) => {
  const reply = handle(e.data);
  if (reply !== null) scope.postMessage(reply, reply.samples !== null ? [reply.samples.buffer] : []);
};
