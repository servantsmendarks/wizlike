// UI-59 の品の詳細と IT-66 の図鑑の表示層（src/presenter/views/item-detail.ts の純粋な部分と、views/camp.ts の段）。M7 の B10。
// 値は core の itemDetail / uniqueBookView（tests/item-view.test.ts で数えた値）を描くだけ。行の文言は strings の値から手で組む。
import { afterEach, describe, expect, test, vi } from "vitest";
import { campMenu } from "../src/core/rules/camp";
import { fieldItemMenu } from "../src/core/rules/items";
import { itemDetail, uniqueBookView } from "../src/core/rules/item-view";
import { cloneState, createItemInstance } from "../src/core/state";
import type { GameState } from "../src/core/types";
import { campEntries, campFirstPage, campHeader, campPanel, campRepair, campStep, createCampView, type CampInput } from "../src/presenter/views/camp";
import { DESCRIPTION_CHARS, formatBook, formatItemDetail } from "../src/presenter/views/item-detail";
import { data, newGame } from "./helpers/core";
import { cursedDagger } from "./helpers/items";

const S = data.strings;
const town = (): GameState => cloneState(newGame(1));
const detailOf = (s: GameState, id: string) => {
  const d = itemDetail(s, data, id);
  if (d === null) throw new Error("no item");
  return d;
};

describe("UI-59 formatItemDetail（品の詳細の行）", () => {
  // 2026-10-05: 実機(M7-B) の【未定】で部位の次に希少度の行（item.detail.rarity「希少度 {rarity}」、語は book.rarity.*）を足し、各期待値に 1 行足した
  test("UI-59/IT-11/IT-20/IT-31/IT-34 汎用武器: 見出しは表示名、部位と Lv、希少度、ダメージ +Lv の分、オプション（符号付き。ac は AC の増減）、売値", () => {
    const s = town();
    const id = createItemInstance(s, {
      itemId: "long_sword",
      level: 5,
      rarity: "rare",
      options: [
        { optionId: "hit", tier: 2, value: 10 },
        { optionId: "ac", tier: 2, value: 1 },
      ],
      identified: true,
    });
    expect(formatItemDetail(detailOf(s, id), S)).toEqual({
      title: "希少な長剣 +5",
      lines: [
        { text: "武器　Lv5", tone: "normal" },
        { text: "希少度 希少", tone: "normal" },
        { text: "ダメージ 1d8+2", tone: "normal" },
        { text: "命中 +10%", tone: "normal" },
        { text: "AC -1", tone: "normal" },
        { text: "売値 255G", tone: "normal" }, // floor(100 × 0.5 × 3.5) = 175 + 40 × 2
      ],
    });
  });

  test("UI-59/IT-21/IT-22/CB-13 防具は AC、術者用武器は魔法攻撃力、長柄・飛び道具は「…後列から届く」（IT-25）。Lv0 でも Lv を出し、ダメージの +0 は出さない", () => {
    const s = town();
    const armor = createItemInstance(s, { itemId: "leather_armor", level: 6, identified: true });
    const staff = createItemInstance(s, { itemId: "staff", identified: true });
    const bow = createItemInstance(s, { itemId: "short_bow", level: 2, identified: true });
    const spear = createItemInstance(s, { itemId: "spear", identified: true });
    expect(formatItemDetail(detailOf(s, armor), S).lines.map((l) => l.text)).toEqual(["防具　Lv6", "希少度 通常", "AC -4", "売値 100G"]); // floor(50 × 0.5 × 4) = 100
    expect(formatItemDetail(detailOf(s, staff), S).lines.map((l) => l.text)).toEqual(["武器　Lv0", "希少度 通常", "ダメージ 1d4", "魔法攻撃力 0", "売値 5G"]);
    expect(formatItemDetail(detailOf(s, bow), S).lines.map((l) => l.text)).toEqual(["武器　Lv2", "希少度 通常", "ダメージ 1d6+1", "飛び道具。後列から届く", "売値 80G"]); // floor(80 × 0.5 × 2) = 80
    // IT-25: 長柄（reach long）
    expect(formatItemDetail(detailOf(s, spear), S).lines.map((l) => l.text)).toEqual(["武器　Lv0", "希少度 通常", "ダメージ 1d6", "長柄。後列から届く", "売値 75G"]);
    // 上質・伝説の語（book.rarity.fine / legendary）
    const fine = createItemInstance(s, { itemId: "leather_armor", rarity: "fine", options: [{ optionId: "hit", tier: 1, value: 5 }], identified: true });
    const legend = createItemInstance(s, { itemId: "leather_armor", rarity: "legendary", identified: true });
    expect(formatItemDetail(detailOf(s, fine), S).lines[1]).toEqual({ text: "希少度 上質", tone: "normal" });
    expect(formatItemDetail(detailOf(s, legend), S).lines[1]).toEqual({ text: "希少度 伝説", tone: "normal" });
  });

  test("UI-59/IT-34/IT-36 杖のオプション魔法攻撃力（M10。U10）: 性能の行（ベース + Lv。オプションを含まない）とオプションの行の両方を出す。護符はオプションの行だけ", () => {
    const s = town();
    const staff = createItemInstance(s, { itemId: "oak_staff", level: 2, rarity: "fine", options: [{ optionId: "magic_power", tier: 1, value: 2 }], identified: true });
    const charm = createItemInstance(s, { itemId: "charm", rarity: "fine", options: [{ optionId: "magic_power", tier: 1, value: 1 }], identified: true });
    const staffLines = formatItemDetail(detailOf(s, staff), S).lines.map((l) => l.text);
    expect(staffLines.slice(0, 5)).toEqual(["武器　Lv2", "希少度 上質", "ダメージ 1d6", "魔法攻撃力 2", "魔法攻撃力 +2"]); // 樫の杖 1 + floor(2/2)
    expect(formatItemDetail(detailOf(s, charm), S).lines.map((l) => l.text).slice(0, 4)).toEqual(["装飾　Lv0", "希少度 上質", "AC 0", "魔法攻撃力 +1"]);
  });

  test("UI-59/IT-03/IT-40 ユニーク: Lv なし、性能、固有スキル、売値、説明（28 字ずつ。dim）", () => {
    const s = town();
    const id = createItemInstance(s, { itemId: "staff", uniqueId: "dawn_flint_staff", identified: true });
    const desc = data.uniques.find((u) => u.id === "dawn_flint_staff")!.description;
    const p = formatItemDetail(detailOf(s, id), S);
    expect(p.title).toBe("夜明けの火打ち杖");
    const chars = Array.from(desc);
    const descLines = Array.from({ length: Math.ceil(chars.length / DESCRIPTION_CHARS) }, (_, i) => ({
      text: chars.slice(i * DESCRIPTION_CHARS, (i + 1) * DESCRIPTION_CHARS).join(""),
      tone: "dim",
    }));
    expect(p.lines).toEqual([
      { text: "武器", tone: "normal" },
      { text: "希少度 通常", tone: "normal" },
      { text: "ダメージ 1d6", tone: "normal" },
      { text: "魔法攻撃力 2", tone: "normal" },
      { text: "呪文の消費 -1", tone: "normal" },
      { text: "売値 450G", tone: "normal" },
      ...descLines,
    ]);
    // 見出し + 13 行に収まる（ビュー領域 150px）
    expect(p.lines.length).toBeLessThanOrEqual(13);
    // 希少度の行を足しても、今のデータの最も長い形（どのユニークも伝説・呪いでオプション 3 + 1 = 4 個）で 13 行以内
    for (const u of data.uniques) {
      const w = createItemInstance(s, {
        itemId: u.base,
        uniqueId: u.id,
        rarity: "legendary",
        cursed: true,
        options: [0, 1, 2, 3].map((k) => ({ optionId: "hit", tier: 1, value: k === 3 ? -5 : 5 })),
        identified: true,
      });
      expect(formatItemDetail(detailOf(s, w), S).lines.length, u.id).toBeLessThanOrEqual(13);
    }
    for (const u of data.uniques) expect(S[`item.skill.${u.skill.type}`], u.skill.type).toBeDefined();
  });

  test("UI-59/IT-32/IT-12 呪いは負のオプション（danger）と「呪われている」（danger）。未鑑定は名前・部位・「鑑定するまで分からない」・見た目の品種の売値だけ", () => {
    const s = town();
    const known = cursedDagger(s, true);
    expect(formatItemDetail(detailOf(s, known), S)).toEqual({
      title: "短剣",
      lines: [
        { text: "武器　Lv0", tone: "normal" },
        { text: "希少度 通常", tone: "normal" },
        { text: "ダメージ 1d4", tone: "normal" },
        { text: "力 -1", tone: "danger" },
        { text: "呪われている", tone: "danger" },
        { text: "売値 7G", tone: "normal" },
      ],
    });
    const hidden = cursedDagger(s, false);
    expect(formatItemDetail(detailOf(s, hidden), S)).toEqual({
      title: "短い刃？",
      lines: [
        { text: "武器", tone: "normal" },
        { text: "鑑定するまで正体は分からない。", tone: "normal" },
        { text: "売値 7G", tone: "normal" }, // 2026-10-05 から未鑑定も見た目の品種（短剣 Lv0）の floor(15 × 0.5) = 7 で売れる
      ],
    });
    const herb = createItemInstance(s, { itemId: "herb", identified: true });
    expect(formatItemDetail(detailOf(s, herb), S).lines.map((l) => l.text)).toEqual(["道具", "売値 5G"]);
  });

  // 2026-10-06: 実機(M9-飛行) の B3。ダイスの記法の定数と Lv の分（ItemPower.damageBonus）を 1 つの定数に合算して出す（「1d4+1+1」→「1d4+2」）
  test("UI-59/IT-20 ダメージの行はダイスの定数と Lv の分を合算する（定数のあるダイス・無いダイス・合計 0・負）", () => {
    // 負の定数のダイスは今のデータに無いので、投げナイフのベースの damage だけを替えたデータで見る（読み込みの検証はダイス記法なら通す）
    const neg = structuredClone(data);
    const knivesBase = neg.equipmentBases.find((b) => b.id === "throwing_knives");
    if (knivesBase === undefined || knivesBase.slot !== "weapon") throw new Error("no throwing_knives");
    const damageLine = (d: typeof data, itemId: string, level: number): string | undefined => {
      const s = town();
      const id = createItemInstance(s, { itemId, level, identified: true });
      const detail = itemDetail(s, d, id);
      if (detail === null) throw new Error("no item");
      return formatItemDetail(detail, S).lines.find((l) => l.text.startsWith("ダメージ "))?.text;
    };
    expect(damageLine(data, "throwing_knives", 2)).toBe("ダメージ 1d4+2"); // 1d4+1、Lv2 → +1
    expect(damageLine(data, "throwing_knives", 0)).toBe("ダメージ 1d4+1");
    expect(damageLine(data, "dagger", 4)).toBe("ダメージ 1d4+2"); // 1d4、Lv4 → +2
    knivesBase.damage = "1d4-1";
    expect(damageLine(neg, "throwing_knives", 2)).toBe("ダメージ 1d4"); // 合計 0 は定数を出さない
    knivesBase.damage = "1d4-2";
    expect(damageLine(neg, "throwing_knives", 0)).toBe("ダメージ 1d4-2"); // 負は「-」
    expect(damageLine(neg, "throwing_knives", 2)).toBe("ダメージ 1d4-1");
  });
});

describe("IT-66 formatBook（図鑑）", () => {
  test("IT-66 見出しは記録の数と全種類の数。記録のある行は「名前　入手ダンジョン　最良の希少度」、無い行は「？？？」（dim）", () => {
    const s = town();
    s.uniqueBook["dawn_flint_staff"] = { foundIn: "d01", bestRarity: "rare" };
    s.uniqueBook["alarm_bell_helm"] = { foundIn: null, bestRarity: "normal" };
    const p = formatBook(uniqueBookView(s, data), S);
    const d01 = data.dungeons.find((d) => d.id === "d01")!.name;
    expect(p.title).toBe(`図鑑　2/${data.uniques.length}`);
    expect(p.lines).toHaveLength(data.uniques.length);
    const at = (id: string) => p.lines[data.uniques.findIndex((u) => u.id === id)];
    expect(at("dawn_flint_staff")).toEqual({ text: `夜明けの火打ち杖　${d01}　希少`, tone: "normal" });
    expect(at("alarm_bell_helm")).toEqual({ text: "早鐘の兜　―　通常", tone: "normal" });
    expect(at("twin_tongue_dagger")).toEqual({ text: "？？？", tone: "dim" });
    expect(p.lines.length).toBeLessThanOrEqual(13);
  });
});

function input(s: GameState): CampInput {
  const menu = campMenu(s, data);
  if (menu === null) throw new Error("camp closed");
  return { menu, items: fieldItemMenu(s, data), summary: null };
}

describe("IT-66/TW-03 酒場の図鑑の段", () => {
  test("IT-66 酒場の「図鑑」は book の段: 問いは「名品の図鑑」、パネルは図鑑、操作はやめるだけ（酒場の一覧へ閉じる）", () => {
    const m = input(town());
    const page = campFirstPage("tavern", "book", m.menu);
    expect(page).toEqual({ kind: "book" });
    expect(campHeader(page, m, S)).toBe("名品の図鑑");
    expect(campPanel(page, m, S)).toEqual({ kind: "book" });
    const e = campEntries("tavern", page, m, S);
    expect(e).toEqual({ layout: "list", rows: [{ label: "やめる", disabled: false, choice: { kind: "cancel" } }] });
    expect(campStep("tavern", page, m, { kind: "cancel" })).toEqual({ kind: "close" });
    expect(campRepair("tavern", page, m)).toEqual(page);
  });
});

class FakeEl {
  style: Record<string, string> = {};
  className = "";
  textContent = "";
  children: FakeEl[] = [];
  appendChild(c: FakeEl): FakeEl {
    this.children.push(c);
    return c;
  }
  replaceChildren(...c: FakeEl[]): void {
    this.children = c;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("UI-59 パネルの lines", () => {
  test("UI-59 lines は見出し（accent）と行（danger は danger 色、dim は dim 色、normal は色なし）を 10px ごとに置く", () => {
    vi.stubGlobal("document", { createElement: (): FakeEl => new FakeEl() });
    const v = createCampView({ x: 0, y: 16, w: 240, h: 150 });
    v.render({
      kind: "lines",
      title: "短剣",
      lines: [
        { text: "武器　Lv0", tone: "normal" },
        { text: "力 -1", tone: "danger" },
        { text: "説明", tone: "dim" },
      ],
    });
    const el = v.el as unknown as FakeEl;
    expect(el.children.map((c) => [c.textContent, c.style["top"], c.style["color"]])).toEqual([
      ["短剣", "4px", "var(--c-accent)"],
      ["武器　Lv0", "14px", undefined],
      ["力 -1", "24px", "var(--c-danger)"],
      ["説明", "34px", "var(--c-dim)"],
    ]);
  });

  test("IT-66/UI-11（M7）lines の tall（図鑑）はパネルを tallRect（ビューとメッセージ窓の下 2 行の上まで。既定 y16・240×198）に広げ、tall なし（品の詳細）・ほかの表示はビュー領域（y16・240×150）に戻す", () => {
    vi.stubGlobal("document", { createElement: (): FakeEl => new FakeEl() });
    const v = createCampView({ x: 0, y: 16, w: 240, h: 150 }, { x: 0, y: 16, w: 240, h: 198 });
    const el = v.el as unknown as FakeEl;
    const box = (): string[] => [el.style["left"]!, el.style["top"]!, el.style["width"]!, el.style["height"]!];
    expect(box()).toEqual(["0px", "16px", "240px", "150px"]);
    // 見出し + 18 行（4 + 10 × 19 = 194 ≤ 198）
    v.render({ kind: "lines", title: "図鑑", lines: Array.from({ length: 18 }, (_, i) => ({ text: `r${i}`, tone: "normal" as const })), tall: true });
    expect(box()).toEqual(["0px", "16px", "240px", "198px"]);
    expect(el.children.at(-1)!.style["top"]).toBe("184px");
    v.render({ kind: "lines", title: "短剣", lines: [] });
    expect(box()).toEqual(["0px", "16px", "240px", "150px"]);
    v.render({ kind: "lines", title: "図鑑", lines: [], tall: true });
    v.render({ kind: "text", title: "酒場" });
    expect(box()).toEqual(["0px", "16px", "240px", "150px"]);
  });
});
