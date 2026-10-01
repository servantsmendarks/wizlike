// UI-52 街のページ（views/town.ts の純粋な部分）。値は core の townMenu だけから作る（UI-35）。
// 既定のパーティ（newGame(1)）: c1 アルド（リーダー）、c2 ベルク、c3 キリ、c4 ドナ、c5 エル、c6 フィン。全員レベル 1。所持金 300。
// 宿: 馬小屋 0G / 相部屋 30G / 個室 100G。寺院: 蘇生 level × 250、治療 毒 50 + 麻痺 150、解呪 200。
import { describe, expect, test } from "vitest";
import { townMenu } from "../src/core/rules/town";
import { cloneState, createItemInstance } from "../src/core/state";
import type { Character, GameState, TownMenu } from "../src/core/types";
import { samePage, townEntries, townHeader, townPageIntro, townParent, type TownEntry } from "../src/presenter/views/town";
import { data, newGame } from "./helpers/core";

const S = data.strings;

function town(patches: Record<string, Partial<Character>> = {}, gold = 300): GameState {
  const s = cloneState(newGame(1));
  for (const [id, p] of Object.entries(patches)) {
    const i = s.party.findIndex((c) => c.id === id);
    s.party[i] = { ...s.party[i]!, ...structuredClone(p) };
  }
  s.gold = gold;
  return s;
}

function menuOf(s: GameState): TownMenu {
  const m = townMenu(s, data);
  if (m === null) throw new Error("not in town");
  return m;
}

const back: TownEntry = { kind: "back", label: S["common.back"]! };

describe("UI-52 街のページ", () => {
  test("UI-52 施設メニューは 酒場・宿屋・寺院・迷宮へ の 4 枠。ヘッダーは所持金", () => {
    const m = menuOf(town());
    expect(townEntries("menu", m, S)).toEqual([
      { kind: "page", to: "tavern", label: "酒場" },
      { kind: "page", to: "inn", label: "宿屋" },
      { kind: "page", to: "temple", label: "寺院" },
      { kind: "page", to: "gate", label: "迷宮へ" },
    ]);
    expect(townHeader(m, S)).toBe("街　300G");
    expect(townHeader(menuOf(town({}, 0)), S)).toBe("街　0G");
  });

  test("UI-52/TW-04 宿屋はランクの行（名前と料金）。払えないランクは disabled。末尾が戻る", () => {
    expect(townEntries("inn", menuOf(town({}, 50)), S)).toEqual([
      { kind: "inn", rank: 0, label: "馬小屋　0G", disabled: false },
      { kind: "inn", rank: 1, label: "相部屋　30G", disabled: false },
      { kind: "inn", rank: 2, label: "個室　100G", disabled: true },
      back,
    ]);
    // ちょうど払える額なら押せる
    expect(townEntries("inn", menuOf(town({}, 100)), S).filter((e) => e.kind === "inn" && e.disabled)).toEqual([]);
  });

  test("UI-52/TW-07 寺院はサービスの 3 項目と戻る。サービスの対象は行（名前と料金、払えなければ disabled）", () => {
    const s = town({ c3: { life: "dead", hp: 0 }, c2: { status: ["poison", "paralysis"] } }, 200);
    const m = menuOf(s);
    expect(townEntries("temple", m, S)).toEqual([
      { kind: "page", to: { temple: "resurrect" }, label: "蘇生" },
      { kind: "page", to: { temple: "cure" }, label: "治療" },
      { kind: "page", to: { temple: "uncurse" }, label: "解呪" },
      back,
    ]);
    // 蘇生 1 × 250 = 250 > 200 → disabled
    expect(townEntries({ temple: "resurrect" }, m, S)).toEqual([
      { kind: "temple", service: "resurrect", memberId: "c3", label: "キリ　250G", disabled: true },
      back,
    ]);
    // 治療 毒 50 + 麻痺 150 = 200 ≤ 200 → 押せる
    expect(townEntries({ temple: "cure" }, m, S)).toEqual([
      { kind: "temple", service: "cure", memberId: "c2", label: "ベルク　200G", disabled: false },
      back,
    ]);
    // 呪われた品を装備している者がいない
    expect(townEntries({ temple: "uncurse" }, m, S)).toEqual([{ kind: "templeNone", label: S["town.temple.none"] }, back]);
  });

  test("UI-52/TW-07 解呪の行は呪われた品を装備している者（料金 200）", () => {
    const s = town();
    s.party[0]!.equipment.weapon = createItemInstance(s, "cursed_dagger", true);
    expect(townEntries({ temple: "uncurse" }, menuOf(s), S)).toEqual([
      { kind: "temple", service: "uncurse", memberId: "c1", label: "アルド　200G", disabled: false },
      back,
    ]);
  });

  test("UI-52/TW-31 酒場: 申し出が無ければ戻るだけ。申し出の間は dead / ash の者の行（リーダーも）", () => {
    expect(townEntries("tavern", menuOf(town()), S)).toEqual([back]);
    expect(townPageIntro("tavern", menuOf(town()))).toEqual(["town.tavern.intro"]);
    const s = town({ c1: { life: "dead", hp: 0 }, c3: { life: "ash", hp: 0 } });
    s.townVisit = { mercyOffered: true };
    const m = menuOf(s);
    expect(townEntries("tavern", m, S)).toEqual([
      { kind: "mercy", memberId: "c1", label: "アルドを戻してもらう" },
      { kind: "mercy", memberId: "c3", label: "キリを戻してもらう" },
      back,
    ]);
    expect(townPageIntro("tavern", m)).toEqual(["town.tavern.intro", "town.mercy.offer"]);
  });

  test("UI-52/TW-11 迷宮の入口は開放済みの迷宮の行。行動可能な者がいなければ disabled", () => {
    const d01 = data.dungeons.find((d) => d.id === "d01")!.name;
    expect(townEntries("gate", menuOf(town()), S)).toEqual([{ kind: "enter", dungeonId: "d01", label: d01, disabled: false }, back]);
    const allDead = town(Object.fromEntries(["c1", "c2", "c3", "c4", "c5", "c6"].map((id) => [id, { life: "dead" as const, hp: 0 }])));
    expect(townEntries("gate", menuOf(allDead), S)).toEqual([{ kind: "enter", dungeonId: "d01", label: d01, disabled: true }, back]);
  });

  test("UI-52/UI-33 戻る（Esc）は 1 つ上のページ。寺院のサービスは寺院へ、他はメニューへ、メニューは null", () => {
    expect(townParent("menu")).toBeNull();
    for (const p of ["tavern", "inn", "temple", "gate"] as const) expect(townParent(p)).toBe("menu");
    expect(townParent({ temple: "cure" })).toBe("temple");
    expect(samePage({ temple: "cure" }, { temple: "cure" })).toBe(true);
    expect(samePage({ temple: "cure" }, { temple: "uncurse" })).toBe(false);
    expect(samePage("inn", { temple: "cure" })).toBe(false);
    expect(samePage("inn", "inn")).toBe(true);
  });

  test("UI-52 ページの語りは params の無い strings キー（宿・寺院・迷宮の入口）。メニューとサービスの一覧は語らない", () => {
    const m = menuOf(town());
    expect(townPageIntro("inn", m)).toEqual(["town.inn.intro"]);
    expect(townPageIntro("temple", m)).toEqual(["town.temple.intro"]);
    expect(townPageIntro("gate", m)).toEqual(["town.dungeonGate.intro"]);
    expect(townPageIntro("menu", m)).toEqual([]);
    expect(townPageIntro({ temple: "resurrect" }, m)).toEqual([]);
    for (const k of ["town.tavern.intro", "town.mercy.offer", "town.inn.intro", "town.temple.intro", "town.dungeonGate.intro", "town.temple.none"]) {
      expect(S[k], k).toBeDefined();
      expect(S[k], k).not.toContain("{");
    }
  });
});
