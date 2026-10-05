// UI-13（M8.5）: 街のパーティの帯（views/party-band.ts の純粋な部分）
import { describe, expect, test } from "vitest";
import type { Character } from "../src/core/types";
import { bandCell, BAND_CELL_UNITS, fitName, textUnits } from "../src/presenter/views/party-band";
import { data } from "./helpers/core";

const S = data.strings;
const ch = (name: string, p: Partial<Pick<Character, "life" | "status">> = {}): Pick<Character, "name" | "life" | "status"> => ({
  name,
  life: p.life ?? "alive",
  status: p.status ?? [],
});

describe("UI-13 bandCell", () => {
  test("UI-13 bandCell: 正常は印なしの text。全角 5 字までは全文、6 字は 4 字＋…（10 単位）。半角（ASCII・半角カナ）は 1 単位", () => {
    expect(bandCell(ch("アルド"), "normal", S)).toEqual({ label: "アルド", mark: "", role: "text" });
    expect(bandCell(ch("アルドリン"), "normal", S).label).toBe("アルドリン");
    expect(bandCell(ch("アルドリンド"), "normal", S).label).toBe("アルドリ…");
    expect(bandCell(ch("Aldorin"), "normal", S).label).toBe("Aldorin");
    expect(bandCell(ch("Aldorinson"), "normal", S).label).toBe("Aldorinson");
    expect(bandCell(ch("Aldorinsons"), "normal", S).label).toBe("Aldorins…");
    expect(bandCell(ch("ｱﾙﾄﾞﾘﾝﾄﾞ"), "normal", S).label).toBe("ｱﾙﾄﾞﾘﾝﾄﾞ");
    for (const n of ["アルドリンド", "Aldorinsons", "アルドABCDEF"]) expect(textUnits(bandCell(ch(n), "normal", S).label), n).toBeLessThanOrEqual(BAND_CELL_UNITS);
    expect(fitName("あいうえおか", 10)).toBe("あいうえ…");
    expect(fitName("あいうえお", 10)).toBe("あいうえお");
  });

  test("UI-13 bandCell: 印は 1 人に 1 つで、優先順は 灰 > 死亡 > 石 > 痺 > 眠 > 毒 > 虚脱 > 錯乱 > 不安。印があれば 6 字の名前は 3 字＋…＋印", () => {
    expect(bandCell(ch("アルド", { life: "ash", status: ["poison"] }), "broken", S)).toEqual({ label: "アルド灰", mark: "灰", role: "dim" });
    expect(bandCell(ch("アルド", { life: "dead", status: ["stone"] }), "broken", S)).toEqual({ label: "アルド死", mark: "死", role: "danger" });
    expect(bandCell(ch("アルド", { status: ["poison", "sleep", "paralysis", "stone"] }), "broken", S)).toMatchObject({ mark: "石", role: "status" });
    expect(bandCell(ch("アルド", { status: ["poison", "sleep", "paralysis"] }), "normal", S)).toMatchObject({ mark: "痺", role: "status" });
    expect(bandCell(ch("アルド", { status: ["poison", "sleep"] }), "normal", S)).toMatchObject({ mark: "眠", role: "status" });
    expect(bandCell(ch("アルド", { status: ["poison"] }), "uneasy", S)).toMatchObject({ mark: "毒", role: "status" });
    expect(bandCell(ch("アルド"), "broken", S)).toEqual({ label: "アルド虚", mark: "虚", role: "san" });
    expect(bandCell(ch("アルド"), "confused", S)).toMatchObject({ mark: "錯", role: "san" });
    expect(bandCell(ch("アルド"), "uneasy", S)).toMatchObject({ mark: "不", role: "san" });
    expect(bandCell(ch("アルドリンド", { life: "dead" }), "normal", S).label).toBe("アルド…死");
    expect(bandCell(ch("アルドリン", { status: ["poison"] }), "normal", S).label).toBe("アルド…毒");
    expect(bandCell(ch("アルドリ", { status: ["poison"] }), "normal", S).label).toBe("アルドリ毒");
  });

  test("UI-13 帯の印の文言は strings にある 1 字（死亡・灰・SAN の段は town.band.mark.*、状態異常は party.status.*）", () => {
    for (const k of ["town.band.mark.ash", "town.band.mark.dead", "town.band.mark.uneasy", "town.band.mark.confused", "town.band.mark.broken"]) {
      expect(S[k], k).toBeDefined();
      expect(textUnits(S[k]!), k).toBe(2);
    }
    for (const st of ["poison", "paralysis", "sleep", "stone"]) expect(textUnits(S[`party.status.${st}`]!), st).toBe(2);
  });
});
