import { describe, expect, test } from "vitest";
import { formatMessage, trimHistory, typewriterSteps } from "../src/presenter/views/message";
import { headerText } from "../src/presenter/views/header";
import { formatPartyRow } from "../src/presenter/views/party";
import { data, newGame } from "./helpers/core";

describe("message.ts（純粋な部分）", () => {
  test("UI-43 formatMessage の置き換えと、params に無いものの残し方", () => {
    expect(formatMessage("{a}と{b}", { a: "X", b: 3 })).toBe("Xと3");
    // 同じ名前が 2 回あれば両方置き換える
    expect(formatMessage("{a}{a}", { a: 1 })).toBe("11");
    // params に無いものは {k} のまま
    expect(formatMessage("{a} {missing}", { a: "x" })).toBe("x {missing}");
    // params 省略ならそのまま
    expect(formatMessage("{a}")).toBe("{a}");
    // 0 と空文字も値として置き換える
    expect(formatMessage("[{n}][{s}]", { n: 0, s: "" })).toBe("[0][]");
    // 識別子の形でない波括弧は触らない。プロトタイプのキーは値として扱わない
    expect(formatMessage("{ a } {1x} {toString}", { a: "x" })).toBe("{ a } {1x} {toString}");
    // 実データの文言
    expect(formatMessage(data.strings["dungeon.enter"]!, { dungeon: "D" })).not.toContain("{dungeon}");
  });

  test("UI-43 typewriterSteps はコードポイント単位（サロゲートペアを分けない）で、空文字は [\"\"]", () => {
    expect(typewriterSteps("")).toEqual([""]);
    expect(typewriterSteps("abc")).toEqual(["a", "ab", "abc"]);
    expect(typewriterSteps("迷宮")).toEqual(["迷", "迷宮"]);
    // U+20BB7（𠮷）は UTF-16 で 2 単位。途中で切らない
    const s = "a\u{20BB7}b";
    expect(s.length).toBe(4);
    const steps = typewriterSteps(s);
    expect(steps).toEqual(["a", "a\u{20BB7}", s]);
    for (const st of steps) expect(st).not.toMatch(/[\uD800-\uDBFF]$/);
  });

  test("UI-11 trimHistory は末尾の max 件を残し、元の配列を変えない", () => {
    const xs = [1, 2, 3, 4, 5];
    expect(trimHistory(xs, 3)).toEqual([3, 4, 5]);
    expect(trimHistory(xs, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(trimHistory(xs, 10)).toEqual([1, 2, 3, 4, 5]);
    expect(trimHistory(xs, 0)).toEqual([]);
    expect(trimHistory(xs, 3)).not.toBe(xs);
    expect(xs).toEqual([1, 2, 3, 4, 5]);
    expect(trimHistory(Array.from({ length: 60 }, (_, i) => i), data.config.ui.messageHistory)).toHaveLength(50);
  });
});

describe("header.ts / party.ts（純粋な部分）", () => {
  test("UI-53 headerText は header.dungeon と dir.* から作る", () => {
    // header.dungeon = "{dungeon} {floor}F {dir}"、dir.E = "東"
    const tpl = data.strings["header.dungeon"]!;
    const expected = tpl.replace("{dungeon}", "D").replace("{floor}", "2").replace("{dir}", data.strings["dir.E"]!);
    expect(headerText(data.strings, "D", 2, "E")).toBe(expected);
    for (const f of ["N", "E", "S", "W"] as const) {
      expect(headerText(data.strings, "D", 1, f)).toContain(data.strings[`dir.${f}`]!);
      expect(headerText(data.strings, "D", 1, f)).not.toMatch(/\{/);
    }
  });

  test("UI-53 formatPartyRow は HP を hp/hpMax、状態を party.life.* で出し、生存は空", () => {
    const s = newGame(1);
    const ch = s.party[0]!;
    const row = formatPartyRow(ch, data.strings);
    expect(row).toEqual({
      name: ch.name,
      hp: `${ch.hp}/${ch.hpMax}`,
      mp: `${ch.mp}/${ch.mpMax}`,
      san: String(ch.san),
      life: "",
    });
    expect(formatPartyRow({ ...ch, life: "dead", hp: 0 }, data.strings).life).toBe(data.strings["party.life.dead"]);
    expect(formatPartyRow({ ...ch, life: "ash", hp: 0 }, data.strings).life).toBe(data.strings["party.life.ash"]);
  });
});
