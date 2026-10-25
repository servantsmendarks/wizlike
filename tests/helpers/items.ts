// アイテム実体のテスト用の helper（M7）。
// cursed_dagger（固定で呪われた品）は M7 の B2 で廃止した（items.md §11 の Q10）。呪いは実体ごと（IT-32）なので、
// テストの呪われた品は「呪われた短剣」の実体を作って使う。
import { createItemInstance } from "../../src/core/state";
import type { GameState, ItemOptionRoll } from "../../src/core/types";

/** 呪われた短剣の呪いの効果（IT-32。M24 から curseEffect。通常の希少度なので options は 0 個）。力 −1（段階 1） */
export const CURSED_DAGGER_EFFECT: Readonly<ItemOptionRoll> = { optionId: "str", tier: 1, value: -1 };

/**
 * 呪われた短剣（汎用 Lv0・通常・ベース dagger・cursed true・options なし・curseEffect 力 −1）の実体を作って state.items に登録し、id を返す。
 * 持ち主への登録は呼び出し側が行う（createItemInstance と同じ）。表示名は鑑定済みで「短剣」、未鑑定で「短い刃？」（IT-12）
 */
export function cursedDagger(s: GameState, identified: boolean): string {
  return createItemInstance(s, { itemId: "dagger", identified, cursed: true, curseEffect: { ...CURSED_DAGGER_EFFECT } });
}
