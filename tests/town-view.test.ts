// UI-52 街のページ（views/town.ts の純粋な部分）。値は core の townMenu だけから作る（UI-35）。
// 既定のパーティ（newGame(1)）: c1 アルド（リーダー）、c2 ベルク、c3 キリ、c4 ドナ、c5 エル、c6 フィン。全員レベル 1。所持金 300。
// 宿: 馬小屋 0G / 相部屋 20G / 個室 60G。寺院: 蘇生 level × 100、治療 毒 50 + 麻痺 150、解呪 200。闇魔術: level × darkCostPerLevel。
// 店（TW-05）: 薬草 10G / 解毒草 15G / 帰還の糸 50G。初期の所持枠の空き（townMenu.shop.members）は c1 4 / c2 6 / c3 4 / c4 5 / c5 6 / c6 5。
import { describe, expect, test } from "vitest";
import { townMenu } from "../src/core/rules/town";
import { cloneState, createItemInstance } from "../src/core/state";
import type { Character, GameState, TownMenu } from "../src/core/types";
import { samePage, townEntries, townHeader, townPageIntro, townParent, type TownEntry } from "../src/presenter/views/town";
import { data, newGame } from "./helpers/core";
import { cursedDagger } from "./helpers/items";

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
  test("UI-52/TW-08/TW-05 施設メニューは 酒場・宿屋・寺院・闇魔術・迷宮へ・店 の 6 枠。ヘッダーは所持金", () => {
    const m = menuOf(town());
    expect(townEntries("menu", m, S)).toEqual([
      { kind: "page", to: "tavern", label: "酒場" },
      { kind: "page", to: "inn", label: "宿屋" },
      { kind: "page", to: "temple", label: "寺院" },
      { kind: "page", to: "dark", label: "闇魔術" },
      { kind: "page", to: "gate", label: "迷宮へ" },
      { kind: "page", to: "shop", label: "店" },
    ]);
    expect(townHeader(m, S)).toBe("街　300G");
    expect(townHeader(menuOf(town({}, 0)), S)).toBe("街　0G");
  });

  test("UI-52/TW-04/TW-15 宿屋はランクの行（名前と料金。士気の立つ個室は末尾に「＋士気」）。払えないランクは disabled。末尾が戻る", () => {
    expect(townEntries("inn", menuOf(town({}, 50)), S)).toEqual([
      { kind: "inn", rank: 0, label: "馬小屋　0G", disabled: false },
      { kind: "inn", rank: 1, label: "相部屋　20G", disabled: false },
      { kind: "inn", rank: 2, label: "個室　60G　＋士気", disabled: true },
      back,
    ]);
    // ちょうど払える額なら押せる
    expect(townEntries("inn", menuOf(town({}, 60)), S).filter((e) => e.kind === "inn" && e.disabled)).toEqual([]);
  });

  test("UI-52/TW-15 宿屋の語りは、士気がある間だけ town.inn.moraleNow を続けて出す", () => {
    expect(townPageIntro("inn", menuOf(town()))).toEqual(["town.inn.intro"]);
    const stayed = cloneState(town());
    stayed.morale = { rankId: "good" };
    expect(townPageIntro("inn", menuOf(stayed))).toEqual(["town.inn.intro", "town.inn.moraleNow"]);
    for (const k of ["town.inn.intro", "town.inn.moraleNow", "town.inn.moraleMark"]) expect(S[k], k).toBeDefined();
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
    // 蘇生 1 × 100 = 100 ≤ 200 → 押せる
    expect(townEntries({ temple: "resurrect" }, m, S)).toEqual([
      { kind: "temple", service: "resurrect", memberId: "c3", label: "キリ　100G", disabled: false },
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
    s.party[0]!.equipment.weapon = cursedDagger(s, true);
    expect(townEntries({ temple: "uncurse" }, menuOf(s), S)).toEqual([
      { kind: "temple", service: "uncurse", memberId: "c1", label: "アルド　200G", disabled: false },
      back,
    ]);
  });

  test("UI-52/TW-08 闇魔術は ash の者の行（名前と料金、払えなければ disabled）。対象がいなければ「その必要がある者はいない」", () => {
    const per = data.config.economy.darkCostPerLevel;
    // dead の者は対象外（寺院の蘇生）。ash の c2（レベル 3）と c5（レベル 1）が並び順で出る
    const s = town({ c5: { life: "ash", hp: 0 }, c2: { life: "ash", hp: 0, level: 3 }, c3: { life: "dead", hp: 0 } }, per * 2);
    const m = menuOf(s);
    expect(townEntries("dark", m, S)).toEqual([
      { kind: "dark", memberId: "c2", label: `ベルク　${per * 3}G`, disabled: true },
      { kind: "dark", memberId: "c5", label: `エル　${per}G`, disabled: false },
      back,
    ]);
    // ちょうど払える額なら押せる
    expect(townEntries("dark", menuOf(town({ c2: { life: "ash", hp: 0, level: 3 } }, per * 3)), S)).toEqual([
      { kind: "dark", memberId: "c2", label: `ベルク　${per * 3}G`, disabled: false },
      back,
    ]);
    expect(townEntries("dark", menuOf(town({ c3: { life: "dead", hp: 0 } })), S)).toEqual([{ kind: "templeNone", label: S["town.temple.none"] }, back]);
    expect(townParent("dark")).toBe("menu");
    expect(townPageIntro("dark", m)).toEqual(["town.dark.intro"]);
  });

  // M5.5 で一覧を「見回す ＋ キャンプと同じ項目」に改めた（旧: 状態を見る・装備を替える・並び順を変える）
  test("TW-01/TW-03/TW-13/UI-52/TW-31 酒場: 見回す → 状態・呪文・道具・装備・並び順 → 救済の行（申し出の間だけ。dead / ash の者、リーダーも）→ 戻る", () => {
    const camp: TownEntry[] = [
      { kind: "look", label: "見回す" },
      { kind: "camp", open: "status", label: "状態" },
      { kind: "camp", open: "spell", label: "呪文" },
      { kind: "camp", open: "item", label: "道具" },
      { kind: "camp", open: "equip", label: "装備" },
      { kind: "camp", open: "order", label: "並び順" },
    ];
    expect(townEntries("tavern", menuOf(town()), S)).toEqual([...camp, back]);
    expect(townPageIntro("tavern", menuOf(town()))).toEqual(["town.tavern.intro"]);
    const s = town({ c1: { life: "dead", hp: 0 }, c3: { life: "ash", hp: 0 } });
    s.townVisit = { mercyOffered: true };
    const m = menuOf(s);
    expect(townEntries("tavern", m, S)).toEqual([
      ...camp,
      { kind: "mercy", memberId: "c1", label: "アルドを戻してもらう" },
      { kind: "mercy", memberId: "c3", label: "キリを戻してもらう" },
      back,
    ]);
    expect(townPageIntro("tavern", m)).toEqual(["town.tavern.intro", "town.mercy.offer"]);
  });

  test("TW-03/UI-52 酒場の鑑定の行は townMenu.canIdentify のときだけ（並び順の後、救済の行の前）。どの行も disabled を持たない", () => {
    expect(menuOf(town()).canIdentify).toBe(false);
    const s = town({ c5: { classId: "bishop" }, c2: { life: "dead", hp: 0 } });
    s.townVisit = { mercyOffered: true };
    const m = menuOf(s);
    expect(m.canIdentify).toBe(true);
    const e = townEntries("tavern", m, S);
    expect(e.map((x) => x.kind)).toEqual(["look", "camp", "camp", "camp", "camp", "camp", "camp", "mercy", "back"]);
    expect(e[6]).toEqual({ kind: "camp", open: "identify", label: "鑑定" });
    for (const x of e) expect("disabled" in x, x.label).toBe(false);
    // 司教が行動できなければ鑑定の行は出さない
    expect(townEntries("tavern", menuOf(town({ c5: { classId: "bishop", status: ["sleep"] } })), S).some((x) => x.kind === "camp" && x.open === "identify")).toBe(false);
  });

  test("UI-52/TW-11 迷宮の入口は開放済みの迷宮の行。行動可能な者がいなければ disabled", () => {
    const d01 = data.dungeons.find((d) => d.id === "d01")!.name;
    expect(townEntries("gate", menuOf(town()), S)).toEqual([{ kind: "enter", dungeonId: "d01", label: d01, disabled: false }, back]);
    const allDead = town(Object.fromEntries(["c1", "c2", "c3", "c4", "c5", "c6"].map((id) => [id, { life: "dead" as const, hp: 0 }])));
    expect(townEntries("gate", menuOf(allDead), S)).toEqual([{ kind: "enter", dungeonId: "d01", label: d01, disabled: true }, back]);
  });

  test("UI-52/TW-05 店は売り物の行（名前と価格。払えなければ disabled）。末尾が戻る", () => {
    expect(townEntries("shop", menuOf(town({}, 15)), S)).toEqual([
      { kind: "shopItem", itemId: "herb", label: "薬草　10G", disabled: false },
      { kind: "shopItem", itemId: "antidote_herb", label: "解毒草　15G", disabled: false },
      { kind: "shopItem", itemId: "return_thread", label: "帰還の糸　50G", disabled: true },
      back,
    ]);
    // ちょうど払える額なら押せる
    expect(townEntries("shop", menuOf(town({}, 50)), S).filter((e) => e.kind === "shopItem" && e.disabled)).toEqual([]);
    expect(townPageIntro("shop", menuOf(town()))).toEqual(["town.shop.intro"]);
    expect(townParent("shop")).toBe("menu");
  });

  test("UI-52/TW-05/CH-71 品を選ぶと持たせる者の行（生きている者の名前と所持枠の空き）。空きが無い者・払えないときは disabled", () => {
    // c3 は dead（候補に出ない）。c6 は所持枠を埋める（初期の空き 5 → 品を 5 つ持たせて 0）
    const s = town({ c3: { life: "dead", hp: 0 } }, 10);
    for (let i = 0; i < 5; i++) s.party[5]!.inventory.push(createItemInstance(s, { itemId: "herb", identified: true }));
    const m = menuOf(s);
    expect(townEntries({ shop: "herb" }, m, S)).toEqual([
      { kind: "buy", itemId: "herb", memberId: "c1", label: "アルド　空き4", disabled: false },
      { kind: "buy", itemId: "herb", memberId: "c2", label: "ベルク　空き6", disabled: false },
      { kind: "buy", itemId: "herb", memberId: "c4", label: "ドナ　空き5", disabled: false },
      { kind: "buy", itemId: "herb", memberId: "c5", label: "エル　空き6", disabled: false },
      { kind: "buy", itemId: "herb", memberId: "c6", label: "フィン　空き0", disabled: true },
      back,
    ]);
    // 払えない品（10G で帰還の糸 50G）は全員 disabled
    expect(townEntries({ shop: "return_thread" }, m, S).filter((e) => e.kind === "buy").every((e) => e.kind === "buy" && e.disabled)).toBe(true);
    expect(townPageIntro({ shop: "herb" }, m)).toEqual(["town.shop.whom"]);
    for (const k of ["town.shop.intro", "town.shop.whom"]) {
      expect(S[k], k).toBeDefined();
      expect(S[k], k).not.toContain("{");
    }
  });

  test("UI-52/UI-33 戻る（Esc）は 1 つ上のページ。寺院のサービスは寺院へ、店の品は店へ、他はメニューへ、メニューは null", () => {
    expect(townParent("menu")).toBeNull();
    for (const p of ["tavern", "inn", "temple", "dark", "gate", "shop"] as const) expect(townParent(p)).toBe("menu");
    expect(townParent({ temple: "cure" })).toBe("temple");
    expect(townParent({ shop: "herb" })).toBe("shop");
    expect(samePage({ shop: "herb" }, { shop: "herb" })).toBe(true);
    expect(samePage({ shop: "herb" }, { shop: "return_thread" })).toBe(false);
    expect(samePage({ shop: "herb" }, { temple: "cure" })).toBe(false);
    expect(samePage({ temple: "cure" }, { shop: "herb" })).toBe(false);
    expect(samePage("shop", { shop: "herb" })).toBe(false);
    expect(samePage({ temple: "cure" }, { temple: "cure" })).toBe(true);
    expect(samePage({ temple: "cure" }, { temple: "uncurse" })).toBe(false);
    expect(samePage("inn", { temple: "cure" })).toBe(false);
    expect(samePage("inn", "inn")).toBe(true);
  });

  test("UI-52 ページの語りは params の無い strings キー（宿・寺院・闇魔術・迷宮の入口）。メニューとサービスの一覧は語らない", () => {
    const m = menuOf(town());
    expect(townPageIntro("inn", m)).toEqual(["town.inn.intro"]);
    expect(townPageIntro("temple", m)).toEqual(["town.temple.intro"]);
    expect(townPageIntro("gate", m)).toEqual(["town.dungeonGate.intro"]);
    expect(townPageIntro("menu", m)).toEqual([]);
    expect(townPageIntro({ temple: "resurrect" }, m)).toEqual([]);
    for (const k of ["town.tavern.intro", "town.mercy.offer", "town.inn.intro", "town.temple.intro", "town.dungeonGate.intro", "town.dark.intro", "town.temple.none"]) {
      expect(S[k], k).toBeDefined();
      expect(S[k], k).not.toContain("{");
    }
  });
});
