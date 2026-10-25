// UI-59 / IT-65（M24 B-1）: 語りの 1 文の色（message の出来事のキー → 役）。表示層がキーで決める（GameEvent は変えない。CLAUDE.md §3-4）。
// sound-cues.ts と同じく、出来事から見せ方を引く小さな表（純粋。DOM に触れない）。会話の箱・メッセージ窓は 1 文 1 行で、その行の文字の色にする。

/** 語りの行の色の役（palette.ts の ROLES のうち、文に使うもの） */
export type MessageTone = "option" | "danger";

/** 鑑定で見つかったオプションの文は option（青）、呪いの文は danger。表に無いキーは色を変えない */
export const MESSAGE_TONES: Readonly<Record<string, MessageTone>> = {
  "item.option.found": "option",
  "item.curse.found": "danger",
  "item.curse.foundNone": "danger",
};

/** キーの色（無ければ undefined） */
export function messageTone(key: string): MessageTone | undefined {
  return Object.prototype.hasOwnProperty.call(MESSAGE_TONES, key) ? MESSAGE_TONES[key] : undefined;
}
