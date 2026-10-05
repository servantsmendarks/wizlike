// UI-65: 同梱した ZzFX 1.3.2（ZzFX.js。工房の tools/music/vendor/zzfx-1.3.2/ のバイト単位の複製）の型（手書き）。
// ZzFX.js はモジュールの評価時に audioContext: new AudioContext を作るので、静的に import しない
// （presenter/audio.ts が最初のユーザー操作の後に動的 import し、その context は閉じてゲームの context に差し替える）。
export declare const ZZFX: {
  volume: number;
  sampleRate: number;
  audioContext: AudioContext;
  buildSamples(...p: (number | undefined)[]): number[];
  play(...p: (number | undefined)[]): AudioBufferSourceNode;
  playSamples(ch: number[][], volumeScale?: number, rate?: number, pan?: number, loop?: boolean): AudioBufferSourceNode;
  getNote(semitoneOffset?: number, root?: number): number;
};
export declare function zzfx(...p: (number | undefined)[]): AudioBufferSourceNode;
export declare class ZZFXSound {
  constructor(p?: (number | undefined)[]);
  play(...a: number[]): AudioBufferSourceNode | undefined;
}
