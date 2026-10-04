// SV-40: ホーム画面から起動しているか（表示のための判定）。
import { describe, expect, test } from "vitest";
import { isStandalone } from "../src/presenter/pwa-env";

const mm = (matches: boolean) => (q: string) => ({ matches: q === "(display-mode: standalone)" ? matches : false });

describe("SV-40 isStandalone", () => {
  test("SV-40 isStandalone: navigator.standalone true で真、matchMedia の matches true で真、どちらも無い・偽・matchMedia が例外なら偽", () => {
    expect(isStandalone({ navigator: { standalone: true } })).toBe(true);
    expect(isStandalone({ matchMedia: mm(true) })).toBe(true);
    expect(isStandalone({ matchMedia: mm(true), navigator: { standalone: false } })).toBe(true);
    expect(isStandalone({ matchMedia: mm(false), navigator: { standalone: true } })).toBe(true);
    expect(isStandalone({})).toBe(false);
    expect(isStandalone({ matchMedia: mm(false) })).toBe(false);
    expect(isStandalone({ matchMedia: mm(false), navigator: { standalone: false } })).toBe(false);
    // true そのものだけを真とする（"yes" や 1 は偽）
    expect(isStandalone({ navigator: { standalone: 1 } })).toBe(false);
    expect(isStandalone({ navigator: {} })).toBe(false);
    expect(
      isStandalone({
        matchMedia: () => {
          throw new Error("no");
        },
      }),
    ).toBe(false);
    // node の globalThis（matchMedia が無い）でも例外を出さない
    expect(isStandalone(globalThis as Parameters<typeof isStandalone>[0])).toBe(false);
  });
});
