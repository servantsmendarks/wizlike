// ビルド時（vite.config.ts のプラグイン）に作り、実行時（presenter）が仮想モジュール virtual:wizlike-assets で受け取る素材の型。
// presenter が src/build から import してよいのはこのファイルの型だけ（import type）。

/** [16 分単位の開始, 16 分単位の長さ, MIDI ノート番号, 音量 1..15] */
export type ToneNote = readonly [start16: number, len16: number, note: number, v: number];
/** [開始, 長さ, ノイズの種類名（wavetables の noise のキー）, 音量] */
export type NoiseNote = readonly [start16: number, len16: number, kind: string, v: number];

/** UI-63: MIDI（assets/music/<name>.mid）を変換した曲 */
export type SongData = {
  name: string;
  /** song = ループする曲（audio.json の music.songs）、jingle = ジングル（music.jingles） */
  kind: "song" | "jingle";
  /** μs / 4 分音符（set_tempo の値そのまま） */
  tempoUs: number;
  /** [4, 4] か [3, 4] */
  time: readonly [number, number];
  /** 1 小節の 16 分の数（4/4 は 16、3/4 は 12） */
  barLen16: number;
  bars: number;
  /** bars × barLen16 */
  end16: number;
  /** ループする曲だけ。16 分単位（loop_start の位置、loop_end の位置） */
  loop: { start16: number; end16: number } | null;
  /** ch1..ch3 の波形名（wavetables の waves のキー） */
  waves: readonly [string, string, string];
  /** ch1..ch3 は音符、ch4 はノイズ。各チャンネルは開始の昇順 */
  ch: readonly [ToneNote[], ToneNote[], ToneNote[], NoiseNote[]];
};

/** UI-65: 効果音（assets/sfx/<name>.json）。params は ZzFX 1.3.2 の引数配列（null は既定値。再生側で undefined に変える） */
export type SfxData = { name: string; params: (number | null)[] };

/** UI-60: public/sprites の PNG の大きさ */
export type SpriteInfo = { w: number; h: number };

export type GameAssets = {
  music: Record<string, SongData>;
  sfx: Record<string, SfxData>;
  /** public/sprites の実在の PNG。キーは拡張子を除いた名前 */
  sprites: Record<string, SpriteInfo>;
};

/** id は L01 など（docs/spec/ui.md の UI-64 / UI-65 / UI-60 の項目） */
export type AssetIssue = { file: string; id: string; message: string };
export type CollectResult = { assets: GameAssets; errors: AssetIssue[]; warnings: AssetIssue[] };
