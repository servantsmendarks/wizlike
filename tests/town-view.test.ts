// UI-52 街のページ（views/town.ts の純粋な部分）。値は core の townMenu だけから作る（UI-35）。
// 既定のパーティ（newGame(1)）: c1 アルド（リーダー）、c2 ベルク、c3 キリ、c4 ドナ、c5 エル、c6 フィン。全員レベル 1。所持金 300。
// 宿: 馬小屋 0G / 相部屋 20G / 個室 60G。寺院: 蘇生 level × 100、治療 毒 50 + 麻痺 150、解呪 200。闇魔術: level × darkCostPerLevel。
// 店（TW-05）: 薬草 10G / 解毒草 15G / 帰還の糸 50G。初期の所持枠の空き（townMenu.shop.members）は c1 4 / c2 6 / c3 4 / c4 5 / c5 6 / c6 5。
import { describe, expect, test } from "vitest";
import { campMenu } from "../src/core/rules/camp";
import { classChangeOptions, townMenu } from "../src/core/rules/town";
import { execute } from "../src/core/engine";
import { upgradePreview } from "../src/core/rules/upgrade";
import { cloneState, createItemInstance } from "../src/core/state";
import type { Character, EndingRecord, GameState, TownMenu } from "../src/core/types";
import { endingKeyAction, formatEndingRecord } from "../src/presenter/views/ending";
import {
  samePage,
  TOWN_INTRO_DEDUP,
  townEntries,
  townFacility,
  townFreshIntro,
  townHeader,
  townHeading,
  townHeadingText,
  townLowersInput,
  townPageIntro,
  townParent,
  townPlace,
  townRepair,
  type ClassChangeView,
  type TownEntry,
  type TownPage,
} from "../src/presenter/views/town";
import { formatMessage } from "../src/presenter/views/message";
import { dungeonLayout, regions, TOWN_GRID_LABEL_MAX, townLayout } from "../src/presenter/layout";
import { data, loadDataWithPlaceholder, newGame, PLACEHOLDER_DUNGEON_NAME } from "./helpers/core";
import { cursedDagger } from "./helpers/items";
import { kinsokuLines } from "./helpers/wrap";

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

/** M8.5: TownPage のすべての種類（オブジェクトのページは代表の値） */
const ALL_PAGES: readonly TownPage[] = [
  "menu",
  "tavern",
  "inn",
  "temple",
  { temple: "resurrect" },
  "dark",
  "darkRevive",
  "upgrade",
  { upSlot: "c1" },
  { upCat: { memberId: "c1", slot: "weapon", picked: [] } },
  { upConfirm: { memberId: "c1", slot: "weapon", picked: [] } },
  "gate",
  "shop",
  "shopBuy",
  "shopSell",
  "shopBuyback",
  "shopIdentify",
  "storage",
  "storageDeposit",
  "storageWithdraw",
  { shop: "herb" },
  { sell: "c1" },
  { buyback: "i1" },
  { deposit: "c1" },
  { withdraw: "i1" },
  "classChange",
  { ccClass: "c1" },
  { ccConfirm: { memberId: "c1", classId: "mage" } },
];

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
    expect(townHeader(m, S, "menu")).toBe("街　300G");
    expect(townHeader(menuOf(town({}, 0)), S, "menu")).toBe("街　0G");
  });

  test("UI-13/UI-52（M10）施設メニューのラベルは 4 字（TOWN_GRID_LABEL_MAX）まで。8px の字で 48×48 の枠の内側に収まる（strings を差し替えて 5 字にしたら落ちる）", () => {
    expect(TOWN_GRID_LABEL_MAX).toBe(4);
    const grid = townLayout(regions(data.config.ui.layout, data.config.stage.width), data.config.party.size).grid;
    const labels = townEntries("menu", menuOf(town()), S).map((e) => e.label);
    expect(labels).toHaveLength(grid.length);
    for (const l of labels) expect([...l].length, l).toBeLessThanOrEqual(TOWN_GRID_LABEL_MAX);
    for (const r of grid) expect(8 * TOWN_GRID_LABEL_MAX).toBeLessThanOrEqual(r.w - 2);
    // 差し替えの検査が効くこと（5 字の施設名は上の検査で落ちる）
    const long = townEntries("menu", menuOf(town()), { ...S, "town.menu.tavern": "冒険者の酒場" }).map((e) => e.label);
    expect(long.some((l) => [...l].length > TOWN_GRID_LABEL_MAX)).toBe(true);
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

  // M7（TW-17）で闇魔術の最初を「灰から戻す / 装備を鍛える / 戻る」にし、灰の者の一覧は darkRevive のページに移した（期待のページ名だけを変えた）
  test("UI-52/TW-08 闇魔術の灰から戻すは ash の者の行（名前と料金、払えなければ disabled）。対象がいなければ「その必要がある者はいない」", () => {
    const per = data.config.economy.darkCostPerLevel;
    // dead の者は対象外（寺院の蘇生）。ash の c2（レベル 3）と c5（レベル 1）が並び順で出る
    const s = town({ c5: { life: "ash", hp: 0 }, c2: { life: "ash", hp: 0, level: 3 }, c3: { life: "dead", hp: 0 } }, per * 2);
    const m = menuOf(s);
    expect(townEntries("darkRevive", m, S)).toEqual([
      { kind: "dark", memberId: "c2", label: `ベルク　${per * 3}G`, disabled: true },
      { kind: "dark", memberId: "c5", label: `エル　${per}G`, disabled: false },
      back,
    ]);
    // ちょうど払える額なら押せる
    expect(townEntries("darkRevive", menuOf(town({ c2: { life: "ash", hp: 0, level: 3 } }, per * 3)), S)).toEqual([
      { kind: "dark", memberId: "c2", label: `ベルク　${per * 3}G`, disabled: false },
      back,
    ]);
    expect(townEntries("darkRevive", menuOf(town({ c3: { life: "dead", hp: 0 } })), S)).toEqual([{ kind: "templeNone", label: S["town.temple.none"] }, back]);
    expect(townParent("dark")).toBe("menu");
    expect(townParent("darkRevive")).toBe("dark");
    expect(townPageIntro("dark", m)).toEqual(["town.dark.intro"]);
  });

  test("UI-52/TW-17 闇魔術の最初は 灰から戻す / 装備を鍛える / 戻る。鍛えるは全員の行で、対象にできる部位が無い者は disabled", () => {
    const m = menuOf(town());
    expect(townEntries("dark", m, S)).toEqual([
      { kind: "page", to: "darkRevive", label: "灰から戻す" },
      { kind: "page", to: "upgrade", label: "装備を鍛える" },
      back,
    ]);
    const s = town();
    const c5 = s.party[4]!; // エル（杖だけ）の杖をユニークにする
    s.items[c5.equipment.weapon!]!.uniqueId = "dawn_flint_staff";
    const e = townEntries("upgrade", menuOf(s), S);
    expect(e.map((x) => [x.label, "disabled" in x ? x.disabled : null])).toEqual([
      ["アルド", false],
      ["ベルク", false],
      ["キリ", false],
      ["ドナ", false],
      ["エル", true],
      ["フィン", false],
      [S["common.back"], null],
    ]);
    expect(e[0]).toEqual({ kind: "pick", to: { upSlot: "c1" }, label: "アルド", disabled: false });
    expect(townParent("upgrade")).toBe("dark");
    expect(townPageIntro("upgrade", m)).toEqual(["town.upgrade.intro"]);
  });

  test("UI-52/TW-17 部位の段: EQUIP_SLOTS の順に「部位　品名」、空きは「部位　（なし）」で disabled。押すと触媒の段（選択なし）", () => {
    const s = town();
    s.items[s.party[0]!.equipment.weapon!]!.level = 3;
    const m = menuOf(s);
    const page = { upSlot: "c1" };
    expect(townEntries(page, m, S)).toEqual([
      { kind: "pick", to: { upCat: { memberId: "c1", slot: "weapon", picked: [] } }, label: "武器　長剣 +3", disabled: false },
      { kind: "pick", to: { upCat: { memberId: "c1", slot: "armor", picked: [] } }, label: "防具　革鎧", disabled: false },
      { kind: "pick", to: { upCat: { memberId: "c1", slot: "shield", picked: [] } }, label: "盾　木の盾", disabled: false },
      { kind: "pick", to: { upCat: { memberId: "c1", slot: "helm", picked: [] } }, label: "兜　（なし）", disabled: true },
      { kind: "pick", to: { upCat: { memberId: "c1", slot: "gauntlet", picked: [] } }, label: "小手　（なし）", disabled: true },
      { kind: "pick", to: { upCat: { memberId: "c1", slot: "accessory", picked: [] } }, label: "装飾　（なし）", disabled: true },
      back,
    ]);
    expect(townParent(page)).toBe("upgrade");
    expect(townPageIntro(page, m)).toEqual([]);
  });

  test("UI-52/TW-17 触媒の段: 鑑定済みの汎用装備に ○ / ● の印。押すと付け外し、maxCatalysts（3）個選ぶと未選択は disabled。決める → 確認の段", () => {
    const s = town();
    const add = (level: number, identified = true): string => {
      const id = createItemInstance(s, { itemId: "dagger", level, identified });
      s.party[0]!.inventory.push(id);
      return id;
    };
    const [a, b, c, d] = [add(1), add(0), add(2), add(0)];
    add(0, false); // 未鑑定は候補に出ない
    const m = menuOf(s);
    const sel = { memberId: "c1", slot: "weapon" as const, picked: [] as string[] };
    const e0 = townEntries({ upCat: sel }, m, S);
    expect(e0).toEqual([
      { kind: "upPick", to: { upCat: { ...sel, picked: [a] } }, label: "○短剣 +1", disabled: false },
      { kind: "upPick", to: { upCat: { ...sel, picked: [b] } }, label: "○短剣", disabled: false },
      { kind: "upPick", to: { upCat: { ...sel, picked: [c] } }, label: "○短剣 +2", disabled: false },
      { kind: "upPick", to: { upCat: { ...sel, picked: [d] } }, label: "○短剣", disabled: false },
      { kind: "page", to: { upConfirm: sel }, label: "決める" },
      back,
    ]);
    // c → a → b の順に 3 個選んだ: 印が付き、外すと選んだ順のまま 1 個抜ける。未選択の d は disabled
    const full = { ...sel, picked: [c, a, b] };
    const e3 = townEntries({ upCat: full }, m, S);
    expect(e3[0]).toEqual({ kind: "upPick", to: { upCat: { ...sel, picked: [c, b] } }, label: "●短剣 +1", disabled: false });
    expect(e3[3]).toEqual({ kind: "upPick", to: { upCat: { ...sel, picked: [c, a, b, d] } }, label: "○短剣", disabled: true });
    expect(e3[4]).toEqual({ kind: "page", to: { upConfirm: full }, label: "決める" });
    expect(townParent({ upCat: full })).toEqual({ upSlot: "c1" });
    expect(townPageIntro({ upCat: full }, m)).toEqual([]);
    // 候補が無ければ空の行 → 決める → 戻る（触媒なしでも鍛えられる）
    expect(townEntries({ upCat: { ...sel, memberId: "c2" } }, m, S)).toEqual([
      { kind: "empty", label: "触媒にできる物がない", disabled: true },
      { kind: "page", to: { upConfirm: { ...sel, memberId: "c2" } }, label: "決める" },
      back,
    ]);
  });

  // 2026-10-07（M10.5 追補・未定-22）: 確認の段は会話の箱で語らず、問いを見出しに出し、対象と触媒の数を答えのボタンのラベルに出す。
  // 旧「対象・触媒の数」「成功率・料金」「所持金が足りない」の語り（upgradeConfirmLines）とラベル「鍛える」の期待を置き換えた
  test("UI-52/UI-47/TW-17 未定-22 確認の段: core の upgradePreview の値で見出しに「成功率（大成功）料金。鍛えるか？」（払えなければ「所持金が足りない。」）、ボタンに「{item}を鍛える（触媒 n）」。会話の箱では語らない。block が null のときだけ 鍛える を押せる", () => {
    const s = town({}, 300);
    s.items[s.party[0]!.equipment.weapon!]!.level = 1;
    const cat = createItemInstance(s, { itemId: "dagger", level: 0, identified: true });
    s.party[0]!.inventory.push(cat);
    const m = menuOf(s);
    const sel = { memberId: "c1", slot: "weapon" as const, picked: [cat] };
    const p = upgradePreview(s, data, "c1", "weapon", [cat]);
    expect(p).toEqual({ rate: 29, great: 2, fee: 100, affordable: true, block: null });
    expect(townEntries({ upConfirm: sel }, m, S, p)).toEqual([
      { kind: "upgrade", memberId: "c1", slot: "weapon", catalysts: [cat], label: "長剣 +1を鍛える（触媒 1）", disabled: false },
      back,
    ]);
    expect(townHeadingText({ upConfirm: sel }, m, S, p)).toBe("成功率 29%（大成功 2%）料金 100G。鍛えるか？");
    // 問いは見出しに出すので、会話の箱（広い箱は答えのボタンを覆う）で語らない
    expect(townPageIntro({ upConfirm: sel }, m)).toEqual([]);
    expect(townParent({ upConfirm: sel })).toEqual({ upCat: sel });
    // 払えない: 鍛えるは disabled、見出しの問いを「所持金が足りない。」に替える
    const poor = cloneState(s);
    poor.gold = 99;
    const pp = upgradePreview(poor, data, "c1", "weapon", [cat]);
    expect(townEntries({ upConfirm: sel }, menuOf(poor), S, pp)[0]).toMatchObject({ kind: "upgrade", disabled: true });
    expect(townHeadingText({ upConfirm: sel }, menuOf(poor), S, pp)).toBe("成功率 29%（大成功 2%）料金 100G。金が足りない。");
    // preview が無い（対象が決まらない）なら押せず、見出しは値の無い問い
    expect(townEntries({ upConfirm: sel }, m, S, null)[0]).toMatchObject({ disabled: true });
    expect(townHeadingText({ upConfirm: sel }, m, S, null)).toBe(S["town.ask.upConfirm"]);
    expect(townHeadingText("dark", m, S, p)).toBe(S["town.ask.service"]);
  });

  // M8.5: townListTall（M7 の広げた一覧のページ）は UI-13 の街の配置に置き換えて削除した（どのページも同じ一覧の位置）
  test("UI-52/TW-17（M7）townFreshIntro: 窓の下に見えている直近の文（recent）と同じ語りは重ねて出さない。強化の段を戻ってまた進んでも「どれを鍛える？ / 触媒を選べ。」が重ならない", () => {
    const slot = S["town.upgrade.slot"]!;
    const cat = S["town.upgrade.catalyst"]!;
    // 初めて入る段は出す
    expect(townFreshIntro([slot], ["誰の装備を鍛える？"])).toEqual([slot]);
    // 部位 → 触媒 → 戻る → 戻る → 同じ者 → 同じ部位（窓の下 2 件は「どれを鍛える？ / 触媒を選べ。」のまま）
    expect(townFreshIntro([slot], [slot, cat])).toEqual([]);
    expect(townFreshIntro([cat], [slot, cat])).toEqual([]);
    // 2 文の語りは、見えている方だけ省く
    expect(townFreshIntro(["a", "b"], ["x", "a"])).toEqual(["b"]);
    // 履歴が空なら全部出す。元の配列は変えない
    const xs = ["a"];
    expect(townFreshIntro(xs, [])).toEqual(["a"]);
    expect(townFreshIntro(xs, [])).not.toBe(xs);
    // M8.5: app が照合する履歴の末尾の件数（LIST_TALL_MESSAGE_LINES の代わり）
    expect(TOWN_INTRO_DEDUP).toBe(2);
  });

  test("UI-52（M8.5）townHeading: 全ページで strings にある params の無いキーで、1 行（見出しの幅 224 = 全角 28 字）に収まる", () => {
    for (const p of ALL_PAGES) {
      const k = townHeading(p);
      expect(S[k], JSON.stringify(p)).toBeDefined();
      expect(S[k], k).not.toContain("{");
      expect(kinsokuLines(S[k]!, 28), k).toHaveLength(1);
    }
    expect(townHeading("menu")).toBe("town.ask.menu");
    expect(townHeading("inn")).toBe("town.ask.inn");
    expect(townHeading("gate")).toBe("town.ask.gate");
    expect(townHeading("upgrade")).toBe("town.upgrade.whom");
    expect(townHeading({ upSlot: "c1" })).toBe("town.upgrade.slot");
    expect(townHeading("shopBuy")).toBe("town.shop.buyIntro");
    expect(townHeading({ shop: "herb" })).toBe("town.shop.whom");
    expect(townHeading({ withdraw: "i1" })).toBe("town.storage.whom");
    expect(S["town.ask.inn"]).toBe("どの部屋にする？");
  });

  test("UI-52（M8.5）townPageIntro は問いを含まない（見出し townHeading のキーと重ならず、語りの文に「？」が無い）", () => {
    const s = town({ c3: { life: "dead", hp: 0 } });
    s.morale = { rankId: "good" };
    const m = menuOf(s);
    const headings = new Set(ALL_PAGES.map((p) => townHeading(p)));
    for (const p of ALL_PAGES) {
      for (const k of townPageIntro(p, m)) {
        expect(headings.has(k), `${JSON.stringify(p)} ${k}`).toBe(false);
        // 2026-10-07（M10.5 追補）: 救済の申し出（TW-30）の town.mercy.offer も問いを含まなくなったので、除外をやめた
        expect(S[k], k).not.toContain("？");
      }
    }
    expect(S["town.inn.intro"]).toBe("宿の主人が鍵を並べる。");
    expect(S["town.dungeonGate.intro"]).toBe("迷宮の入口。");
    expect(S["town.shop.sellIntro"]).toBe("鑑定していない品は、見た目どおりの値で引き取るそうだ。");
  });

  test("UI-61（M8.5）townFacility: menu は town、寺院のサービスは temple、闇魔術の灰から戻す・強化の各段は dark、店と倉庫の各段は shop。townPlace は town.place.<施設>", () => {
    const sel = { memberId: "c1", slot: "weapon" as const, picked: [] };
    const want: [TownPage, string][] = [
      ["menu", "town"],
      ["tavern", "tavern"],
      ["inn", "inn"],
      ["temple", "temple"],
      [{ temple: "cure" }, "temple"],
      ["dark", "dark"],
      ["darkRevive", "dark"],
      ["upgrade", "dark"],
      [{ upSlot: "c1" }, "dark"],
      [{ upCat: sel }, "dark"],
      [{ upConfirm: sel }, "dark"],
      ["gate", "gate"],
      ["shop", "shop"],
      ["shopBuy", "shop"],
      ["shopSell", "shop"],
      ["shopBuyback", "shop"],
      ["shopIdentify", "shop"],
      ["storage", "shop"],
      ["storageDeposit", "shop"],
      ["storageWithdraw", "shop"],
      [{ shop: "herb" }, "shop"],
      [{ sell: "c1" }, "shop"],
      [{ buyback: "i1" }, "shop"],
      [{ deposit: "c1" }, "shop"],
      [{ withdraw: "i1" }, "shop"],
      ["classChange", "tavern"],
      [{ ccClass: "c1" }, "tavern"],
      [{ ccConfirm: { memberId: "c1", classId: "mage" } }, "tavern"],
    ];
    expect(want.map(([p]) => townFacility(p))).toEqual(want.map(([, f]) => f));
    expect(want.length).toBe(ALL_PAGES.length);
    for (const [p, f] of want) {
      expect(townPlace(p)).toBe(`town.place.${f}`);
      expect(S[townPlace(p)], f).toBeDefined();
    }
  });

  test("UI-52（M8.5）townHeader は「{place}　{gold}G」（場所はページの施設）", () => {
    const m = menuOf(town());
    expect(townHeader(m, S, "menu")).toBe("街　300G");
    expect(townHeader(m, S, "inn")).toBe("宿屋　300G");
    expect(townHeader(m, S, { upSlot: "c1" })).toBe("闇魔術　300G");
    expect(townHeader(m, S, "gate")).toBe("迷宮の入口　300G");
    expect(townHeader(m, S, { withdraw: "i1" })).toBe("店　300G");
  });

  test("UI-47（M8.5）街で語る固定の文（ページの語り・救済の申し出・士気・街に入る・見回す・対象なし）は、会話の箱の 3 行（全角 28 字。禁則つき）に収まる", () => {
    const s = town({ c3: { life: "dead", hp: 0 } });
    s.morale = { rankId: "good" };
    const m = menuOf(s);
    const keys = new Set<string>([
      "town.enter",
      "town.mercy.offer",
      "town.temple.none",
      "town.look.crowd",
      "town.look.quiet",
      "town.look.gm",
      "town.look.board",
    ]);
    for (const p of ALL_PAGES) for (const k of townPageIntro(p, m)) keys.add(k);
    expect(keys.has("town.inn.moraleNow")).toBe(true);
    for (const k of keys) {
      expect(S[k], k).toBeDefined();
      expect(kinsokuLines(S[k]!, 28).length, `${k}: ${S[k]}`).toBeLessThanOrEqual(3);
    }
  });

  test("UI-44/TW-17 townLowersInput: 判定の箱でタップを待つ 鍛える だけが、送ったら再生の間 所持金・一覧・戻るを下げる。他の街の項目（買う・売る・宿・寺院・闇魔術・戻る）は下げない", () => {
    const s = town({}, 300);
    const cat = createItemInstance(s, { itemId: "dagger", level: 0, identified: true });
    s.party[0]!.inventory.push(cat);
    const m = menuOf(s);
    const sel = { memberId: "c1", slot: "weapon" as const, picked: [cat] };
    const confirm = townEntries({ upConfirm: sel }, m, S, upgradePreview(s, data, "c1", "weapon", [cat]));
    expect(confirm.map((e) => [e.kind, townLowersInput(e)])).toEqual([
      ["upgrade", true],
      ["back", false],
    ]);
    const others = [
      ...townEntries("inn", m, S),
      ...townEntries({ temple: "cure" }, m, S),
      ...townEntries("darkRevive", m, S),
      ...townEntries("shopBuy", m, S),
      ...townEntries({ shop: "herb" }, m, S),
      ...townEntries({ sell: "c1" }, m, S),
    ];
    expect(others.length).toBeGreaterThan(6);
    expect(others.filter((e) => townLowersInput(e))).toEqual([]);
  });

  test("UI-52/TW-17 townRepair: 消えた触媒は選択から外し、部位が対象にできなくなれば部位の段、本人がいなければ者の段へ。samePage は選択まで比べる", () => {
    const s = town();
    const cat = createItemInstance(s, { itemId: "dagger", identified: true });
    s.party[0]!.inventory.push(cat);
    const m = menuOf(s);
    const sel = { memberId: "c1", slot: "weapon" as const, picked: [cat] };
    expect(townRepair({ upCat: sel }, m)).toEqual({ upCat: sel });
    expect(townRepair({ upConfirm: { ...sel, picked: ["i999", cat] } }, m)).toEqual({ upConfirm: sel });
    expect(townRepair({ upCat: { ...sel, slot: "helm" } }, m)).toEqual({ upSlot: "c1" });
    expect(townRepair({ upCat: { ...sel, memberId: "c9" } }, m)).toBe("upgrade");
    expect(townRepair({ upSlot: "c9" }, m)).toBe("upgrade");
    expect(samePage({ upCat: sel }, { upCat: { ...sel, picked: [cat] } })).toBe(true);
    expect(samePage({ upCat: sel }, { upCat: { ...sel, picked: [] } })).toBe(false);
  });

  // M5.5 で一覧を「見回す ＋ キャンプと同じ項目」に改めた（旧: 状態を見る・装備を替える・並び順を変える）。
  // M10（2026-10-07）: 呪文・道具・装備・鑑定はキャラクター画面（UI-59。状態から開く）の操作に移したので、酒場の一覧から外した
  // M10 TW-09: 図鑑の後に「GMに申し出る」（転職）を足した
  test("TW-01/TW-03/TW-13/UI-52/TW-31/IT-66/TW-09 酒場: 見回す → 状態・並び順 → 図鑑 → GMに申し出る → 救済の行（申し出の間だけ。dead / ash の者、リーダーも）→ 戻る", () => {
    const camp: TownEntry[] = [
      { kind: "look", label: "見回す" },
      { kind: "camp", open: "status", label: "状態" },
      { kind: "camp", open: "order", label: "並び順" },
      { kind: "camp", open: "book", label: "図鑑" }, // IT-66（M7）: 図鑑は酒場の一覧（並び順の後）
      { kind: "page", to: "classChange", label: "転職（GMに申し出る）" }, // TW-09（M10）: 転職は図鑑の後
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
    // 2026-10-07（M10.5 追補・未定-22）: 救済の申し出の問いは会話の箱で語らず、酒場の見出しに出す（答えの救済の行と同時に見える）。
    // 旧期待 ["town.tavern.intro", "town.mercy.offer"] を置き換えた。街に入るときの core の town.mercy.offer（施設メニューの上）は変えない
    expect(townPageIntro("tavern", m)).toEqual(["town.tavern.intro"]);
    expect(townHeadingText("tavern", m, S)).toBe(S["town.ask.mercy"]);
    expect(townHeadingText("tavern", menuOf(town()), S)).toBe(S["town.ask.what"]);
  });

  // 2026-10-07（M10.5 追補・未定-22 のレビュー）: 街に入るとき（core の town.enter）と再開のとき（SV-50）に会話の箱で語る town.mercy.offer は
  // 施設メニューのボタンを覆うので、問い（旧「…誰にする？」）を含まない語りに改め、問いは施設メニューの見出しに出す
  test("UI-47/UI-52/TW-30 未定-22 救済の申し出の間、施設メニューの見出しは town.ask.menuMercy（1 行の問い）。箱で語る town.mercy.offer は問いを含まない", () => {
    const s = town({ c3: { life: "dead", hp: 0 } });
    s.townVisit = { mercyOffered: true };
    const m = menuOf(s);
    expect(m.mercy).not.toBeNull();
    expect(townHeadingText("menu", m, S)).toBe(S["town.ask.menuMercy"]);
    expect(townHeadingText("menu", menuOf(town()), S)).toBe(S["town.ask.menu"]);
    expect(kinsokuLines(S["town.ask.menuMercy"]!, 28)).toHaveLength(1);
    expect(S["town.ask.menuMercy"]).toContain("？");
    expect(S["town.mercy.offer"]).not.toContain("？");
  });

  test("UI-47/UI-52 未定-22 答えのボタンが続く問い（強化の確認・転職の確認・救済の申し出）は見出しの 1 行（全角 28 字）に収まり、強化のボタンのラベルは一覧の行の文字の幅 158（168 − 余白 4×2 − 枠 1×2。半角 39 単位 = 全角 19.5 字）に収まる", () => {
    const ask = (k: string, p: Record<string, number>): string => formatMessage(S[k]!, p);
    // 成功率 100・大成功 100・料金 5 桁の最悪の場合
    for (const k of ["town.upgrade.ask", "town.upgrade.askNoGold"]) expect(kinsokuLines(ask(k, { rate: 100, great: 100, fee: 99999 }), 28), k).toHaveLength(1);
    expect(kinsokuLines(S["town.ask.mercy"]!, 28)).toHaveLength(1);
    expect(S["town.ask.mercy"]).toContain("？");
    // 品の名前は equipmentDisplayName の汎用の形（ユニークは強化値が付かず、強化の部位の段で dim なので確認の段に来ない）:
    // 最も長い希少度の接頭辞 + 最も長いベースの名前 + 強化値 2 桁（item.plus）、触媒 3 個。2026-10-07 レビュー: 以前は最も長いユニーク + " +10" を全角 21 字で測っていた
    const longestOf = (xs: string[]): string => [...xs].sort((a, b) => Array.from(b).length - Array.from(a).length)[0]!;
    const prefix = longestOf(["fine", "rare", "legendary"].map((r) => S[`item.rarity.${r}`]!));
    const base = longestOf(data.equipmentBases.map((b) => b.name));
    const item = prefix + base + S["item.plus"]!.replace("{n}", "10");
    expect(kinsokuLines(formatMessage(S["town.upgrade.do"]!, { item, count: 3 }), 19.5)).toHaveLength(1);
  });

  // M10（2026-10-07）: 鑑定は酒場の一覧ではなくキャラクター画面の「鑑定」（司教だけ）から。旧「鑑定の行は canIdentify のときだけ」を置き換えた
  test("TW-03/UI-52/UI-59 酒場の一覧に鑑定の行は無い（司教がいても。鑑定はキャラクター画面の操作）。どの行も disabled を持たない", () => {
    const s = town({ c5: { classId: "bishop" }, c2: { life: "dead", hp: 0 } });
    s.townVisit = { mercyOffered: true };
    const m = menuOf(s);
    expect(m.canIdentify).toBe(true);
    const e = townEntries("tavern", m, S);
    expect(e.map((x) => x.kind)).toEqual(["look", "camp", "camp", "camp", "page", "mercy", "back"]);
    for (const x of e) expect("disabled" in x, x.label).toBe(false);
  });

  test("UI-52/TW-11 迷宮の入口は開放済みの迷宮の行。行動可能な者がいなければ disabled", () => {
    const d01 = data.dungeons.find((d) => d.id === "d01")!.name;
    expect(townEntries("gate", menuOf(town()), S)).toEqual([{ kind: "enter", dungeonId: "d01", label: d01, disabled: false, notReady: null }, back]);
    const allDead = town(Object.fromEntries(["c1", "c2", "c3", "c4", "c5", "c6"].map((id) => [id, { life: "dead" as const, hp: 0 }])));
    expect(townEntries("gate", menuOf(allDead), S)).toEqual([{ kind: "enter", dungeonId: "d01", label: d01, disabled: true, notReady: null }, back]);
  });

  test("UI-52/DG-35/TW-11 迷宮の入口の準備中の行は town.gate.notReady のラベルで dim、押したときの理由の文 town.gate.notReadyReason を持つ（M9。M12 から合成データの d04）", () => {
    const s = town();
    s.progress.unlockedDungeons.push("d02", "d03", "d04");
    const m = townMenu(s, loadDataWithPlaceholder());
    if (m === null) throw new Error("not in town");
    const P = PLACEHOLDER_DUNGEON_NAME;
    expect(townEntries("gate", m, S)).toEqual([
      { kind: "enter", dungeonId: "d01", label: "試しの坑道", disabled: false, notReady: null },
      { kind: "enter", dungeonId: "d02", label: "沈んだ聖堂", disabled: false, notReady: null },
      // M12: 実データの d03 は本物になったので普通の行
      { kind: "enter", dungeonId: "d03", label: "灰の地下墓所", disabled: false, notReady: null },
      // UI-52 / TW-11（M9 実機 B2）: 押したときに会話の箱へ出す理由の 1 文（準備中かは core の notReady）
      { kind: "enter", dungeonId: "d04", label: `${P}（準備中）`, disabled: true, notReady: `${P}はまだ道が開いていない。` },
      back,
    ]);
  });

  // M7 で店の最初に 買う / 売る / 買い戻す / 鑑定 / 倉庫 の一覧を置いた（ui.md UI-52 の M7）。旧「店は売り物の行」は買うのページ（shopBuy）に移した
  test("UI-52/TW-05/TW-16 店の最初の一覧は 買う・売る・買い戻す・鑑定・倉庫・戻る。どれも dim にしない", () => {
    expect(townEntries("shop", menuOf(town({}, 0)), S)).toEqual([
      { kind: "page", to: "shopBuy", label: "買う" },
      { kind: "page", to: "shopSell", label: "売る" },
      { kind: "page", to: "shopBuyback", label: "買い戻す" },
      { kind: "page", to: "shopIdentify", label: "鑑定" },
      { kind: "page", to: "storage", label: "倉庫" },
      back,
    ]);
    expect(townPageIntro("shop", menuOf(town()))).toEqual(["town.shop.intro"]);
    expect(townParent("shop")).toBe("menu");
  });

  test("UI-52/TW-05/IT-62 買うは消耗品の行 → 流通レベルの汎用装備の行（名前と価格。払えなければ disabled）。末尾が戻る", () => {
    // shopLevel 0: shopMinLevel 0 のベース 9 種が Lv0（買値 = price × (1 + 0.5 × 0) = price。名前に +N は付かない）。15G で払えるのは 10G と 15G の品
    expect(townEntries("shopBuy", menuOf(town({}, 15)), S)).toEqual([
      { kind: "shopItem", itemId: "herb", label: "薬草　10G", disabled: false },
      { kind: "shopItem", itemId: "antidote_herb", label: "解毒草　15G", disabled: false },
      { kind: "shopItem", itemId: "return_thread", label: "帰還の糸　50G", disabled: true },
      { kind: "shopItem", itemId: "dagger", label: "短剣　15G", disabled: false },
      { kind: "shopItem", itemId: "long_sword", label: "長剣　100G", disabled: true },
      { kind: "shopItem", itemId: "short_bow", label: "短弓　80G", disabled: true },
      { kind: "shopItem", itemId: "sling", label: "投石紐　20G", disabled: true },
      { kind: "shopItem", itemId: "staff", label: "杖　10G", disabled: false },
      { kind: "shopItem", itemId: "leather_armor", label: "革鎧　50G", disabled: true },
      { kind: "shopItem", itemId: "wooden_shield", label: "木の盾　40G", disabled: true },
      { kind: "shopItem", itemId: "leather_cap", label: "革兜　30G", disabled: true },
      { kind: "shopItem", itemId: "leather_gloves", label: "革小手　30G", disabled: true },
      back,
    ]);
    // shopLevel 2: shopMinLevel 2 のベース（鎚矛・鎖帷子・鉄兜・護符と、M9 の長槍・投げナイフ・樫の杖・鋲打ち革鎧・守りの法衣・鉄の盾・鎖頭巾）も並び、Lv2（買値 = price × (1 + 0.5 × 2) = price × 2、名前は「 +2」）
    const s = town({}, 1000);
    s.progress.shopLevel = 2;
    const consumables = ["herb", "antidote_herb", "return_thread"];
    const eq = townEntries("shopBuy", menuOf(s), S).filter((e) => e.kind === "shopItem" && !consumables.includes(e.itemId));
    expect(eq.map((e) => e.label)).toEqual([
      "短剣 +2　30G",
      "長剣 +2　200G",
      "鎚矛 +2　120G",
      "短弓 +2　160G",
      "投石紐 +2　40G",
      "杖 +2　20G",
      "長槍 +2　300G",
      "投げナイフ +2　120G",
      "樫の杖 +2　400G",
      "革鎧 +2　100G",
      "鎖帷子 +2　600G",
      "鋲打ち革鎧 +2　300G",
      "守りの法衣 +2　500G",
      "木の盾 +2　80G",
      "鉄の盾 +2　400G",
      "革兜 +2　60G",
      "鉄兜 +2　240G",
      "鎖頭巾 +2　240G",
      "革小手 +2　60G",
      "護符 +2　400G",
    ]);
    // 50G で払えないのは 長剣 100G と 短弓 80G だけ（帰還の糸 50G・革鎧 50G はちょうど払える）
    expect(townEntries("shopBuy", menuOf(town({}, 50)), S).flatMap((e) => (e.kind === "shopItem" && e.disabled ? [e.itemId] : []))).toEqual([
      "long_sword",
      "short_bow",
    ]);
    expect(townPageIntro("shopBuy", menuOf(town()))).toEqual([]);
    expect(townParent("shopBuy")).toBe("shop");
  });

  test("UI-52/TW-05/CH-71 品を選ぶと持たせる者の行（生きている者の名前と所持枠の空き）。空きが無い者・払えないときは disabled", () => {
    // c3 は dead（候補に出ない）。c6 は所持枠を埋める（初期の空き 5 → 品を 5 つ持たせて 0）
    const s = town({ c3: { life: "dead", hp: 0 } }, 10);
    for (let i = 0; i < 5; i++) s.party[5]!.inventory.push(createItemInstance(s, { itemId: "herb", identified: true }));
    const m = menuOf(s);
    expect(townEntries({ shop: "herb" }, m, S)).toEqual([
      { kind: "buy", itemId: "herb", memberId: "c1", label: "アルド　空き 4 枠", disabled: false },
      { kind: "buy", itemId: "herb", memberId: "c2", label: "ベルク　空き 6 枠", disabled: false },
      { kind: "buy", itemId: "herb", memberId: "c4", label: "ドナ　空き 5 枠", disabled: false },
      { kind: "buy", itemId: "herb", memberId: "c5", label: "エル　空き 6 枠", disabled: false },
      { kind: "buy", itemId: "herb", memberId: "c6", label: "フィン　空き 0 枠", disabled: true },
      back,
    ]);
    // 払えない品（10G で帰還の糸 50G・長剣 100G）は全員 disabled。杖（10G）は空きのある 4 人が押せる
    expect(townEntries({ shop: "return_thread" }, m, S).filter((e) => e.kind === "buy").every((e) => e.kind === "buy" && e.disabled)).toBe(true);
    expect(townEntries({ shop: "long_sword" }, m, S).filter((e) => e.kind === "buy").every((e) => e.kind === "buy" && e.disabled)).toBe(true);
    expect(townEntries({ shop: "staff" }, m, S).filter((e) => e.kind === "buy" && !e.disabled).length).toBe(4);
    expect(townPageIntro({ shop: "herb" }, m)).toEqual([]);
    for (const k of ["town.shop.intro", "town.shop.whom", "town.shop.buyIntro", "town.shop.sellIntro", "town.shop.buybackIntro", "town.shop.identifyIntro", "town.storage.intro", "town.storage.whom"]) {
      expect(S[k], k).toBeDefined();
      expect(S[k], k).not.toContain("{");
    }
  });

  test("UI-52/IT-61 売るは全員（life を問わない）の行（名前と売れる品の数。無ければ disabled）→ その者の売れる品（名前と売値）。押すと sell", () => {
    // 初期の所持品: c1 薬草・c2 なし・c3 薬草・c4 解毒草・c5 帰還の糸・c6 薬草（どれも鑑定済み）。c3 を dead にしても行は出る
    const s = town({ c3: { life: "dead", hp: 0 } });
    // c2 に 上質な長剣 +2（力 +1 の段階 1）と未鑑定の長剣（2026-10-05 から見た目の売値で売れるので数える）を持たせる
    const fine = createItemInstance(s, { itemId: "long_sword", level: 2, rarity: "fine", options: [{ optionId: "str", tier: 1, value: 1 }], identified: true });
    const unk = createItemInstance(s, { itemId: "long_sword", identified: false });
    s.party[1]!.inventory.push(fine, unk);
    const m = menuOf(s);
    expect(townEntries("shopSell", m, S)).toEqual([
      { kind: "pick", to: { sell: "c1" }, label: "アルド　1品", disabled: false },
      { kind: "pick", to: { sell: "c2" }, label: "ベルク　2品", disabled: false },
      { kind: "pick", to: { sell: "c3" }, label: "キリ　1品", disabled: false },
      { kind: "pick", to: { sell: "c4" }, label: "ドナ　1品", disabled: false },
      { kind: "pick", to: { sell: "c5" }, label: "エル　1品", disabled: false },
      { kind: "pick", to: { sell: "c6" }, label: "フィン　1品", disabled: false },
      back,
    ]);
    // IT-61: floor(100 × 0.5 × (1 + 0.5 × 2)) = 100 + 正のオプション 段階 1 の 20 = 120。未鑑定の長剣は見た目の品種の floor(100 × 0.5) = 50
    expect(townEntries({ sell: "c2" }, m, S)).toEqual([
      { kind: "sell", memberId: "c2", instanceId: fine, label: "上質な長剣 +2　120G", disabled: false },
      { kind: "sell", memberId: "c2", instanceId: unk, label: "剣？　50G", disabled: false },
      back,
    ]);
    // 薬草 floor(10 × 0.5) = 5
    expect(townEntries({ sell: "c1" }, m, S)).toEqual([{ kind: "sell", memberId: "c1", instanceId: s.party[0]!.inventory[0]!, label: "薬草　5G", disabled: false }, back]);
    // 売れる品が無い者は disabled、そのページは「売れる物がない」
    const bare = town();
    expect(townEntries("shopSell", menuOf(bare), S)[1]).toEqual({ kind: "pick", to: { sell: "c2" }, label: "ベルク　0品", disabled: true });
    expect(townEntries({ sell: "c2" }, menuOf(bare), S)).toEqual([{ kind: "empty", label: "売れる物がない", disabled: true }, back]);
    expect(townParent({ sell: "c2" })).toBe("shopSell");
    expect(townPageIntro("shopSell", m)).toEqual(["town.shop.sellIntro"]);
  });

  test("UI-52/IT-63 買い戻すはストックの行（名前と uniques[].price。払えなければ disabled）→ 持たせる者（生きている者）。押すと buyback", () => {
    const s = town({ c3: { life: "dead", hp: 0 } }, 700);
    const twin = createItemInstance(s, { itemId: "dagger", uniqueId: "twin_tongue_dagger", identified: true });
    const sword = createItemInstance(s, { itemId: "long_sword", uniqueId: "shadowfolk_sword", rarity: "rare", identified: true });
    s.buyback.push(twin, sword);
    const m = menuOf(s);
    // 二枚舌の短剣 700（ちょうど払える）、希少な影法師の剣 1200（払えない）
    expect(townEntries("shopBuyback", m, S)).toEqual([
      { kind: "pick", to: { buyback: twin }, label: "二枚舌の短剣　700G", disabled: false },
      { kind: "pick", to: { buyback: sword }, label: "希少な影法師の剣　1200G", disabled: true },
      back,
    ]);
    expect(townEntries({ buyback: twin }, m, S)).toEqual([
      { kind: "buyback", memberId: "c1", instanceId: twin, label: "アルド　空き 4 枠", disabled: false },
      { kind: "buyback", memberId: "c2", instanceId: twin, label: "ベルク　空き 6 枠", disabled: false },
      { kind: "buyback", memberId: "c4", instanceId: twin, label: "ドナ　空き 5 枠", disabled: false },
      { kind: "buyback", memberId: "c5", instanceId: twin, label: "エル　空き 6 枠", disabled: false },
      { kind: "buyback", memberId: "c6", instanceId: twin, label: "フィン　空き 5 枠", disabled: false },
      back,
    ]);
    expect(townEntries({ buyback: sword }, m, S).filter((e) => e.kind === "buyback").every((e) => e.kind === "buyback" && e.disabled)).toBe(true);
    expect(townEntries("shopBuyback", menuOf(town()), S)).toEqual([{ kind: "empty", label: "買い戻せる品はない", disabled: true }, back]);
    expect(townParent({ buyback: twin })).toBe("shopBuyback");
    expect(townPageIntro({ buyback: twin }, m)).toEqual([]);
  });

  test("UI-52/IT-65 鑑定は全員の未鑑定の品（持ち主・未鑑定の名前・品ごとの鑑定料）。払えない品は disabled。押すと identify", () => {
    // 2026-10-05: 鑑定料は品ごと（max(10, floor(見た目の売値 × 0.5))）。護符 200 → 100 → 50、長剣 100 → 50 → 25
    const s = town({ c3: { life: "dead", hp: 0 } }, 50);
    const a = createItemInstance(s, { itemId: "long_sword", identified: false });
    const b = createItemInstance(s, { itemId: "charm", identified: false });
    s.party[2]!.inventory.push(a);
    s.party[0]!.inventory.push(b);
    expect(townEntries("shopIdentify", menuOf(s), S)).toEqual([
      { kind: "identify", memberId: "c1", instanceId: b, label: "アルド: 飾り？　50G", disabled: false },
      { kind: "identify", memberId: "c3", instanceId: a, label: "キリ: 剣？　25G", disabled: false },
      back,
    ]);
    s.gold = 49;
    expect(townEntries("shopIdentify", menuOf(s), S).map((e) => (e.kind === "identify" ? e.disabled : e.kind))).toEqual([true, false, "back"]);
    expect(townEntries("shopIdentify", menuOf(town()), S)).toEqual([{ kind: "empty", label: "鑑定する物がない", disabled: true }, back]);
    expect(townParent("shopIdentify")).toBe("shop");
  });

  test("UI-52/TW-16 倉庫は 預ける・引き出す（数と容量）→ 預けるは者（品の無い者は disabled）→ 品。引き出すは品 → 受け取る者（空きが無ければ disabled）", () => {
    const s = town({ c3: { life: "dead", hp: 0 } });
    const kept = createItemInstance(s, { itemId: "long_sword", identified: false });
    s.warehouse.push(kept);
    for (let i = 0; i < 5; i++) s.party[5]!.inventory.push(createItemInstance(s, { itemId: "herb", identified: true }));
    const m = menuOf(s);
    const cap = data.config.items.warehouseSlots;
    expect(townEntries("storage", m, S)).toEqual([
      { kind: "page", to: "storageDeposit", label: "預ける" },
      { kind: "page", to: "storageWithdraw", label: `引き出す　1/${cap}` },
      back,
    ]);
    expect(townEntries("storageDeposit", m, S).map((e) => (e.kind === "pick" ? [e.label, e.disabled] : e.kind))).toEqual([
      ["アルド　1品", false],
      ["ベルク　0品", true],
      ["キリ　1品", false],
      ["ドナ　1品", false],
      ["エル　1品", false],
      ["フィン　6品", false],
      "back",
    ]);
    const herb = s.party[0]!.inventory[0]!;
    expect(townEntries({ deposit: "c1" }, m, S)).toEqual([{ kind: "deposit", memberId: "c1", instanceId: herb, label: "薬草", disabled: false }, back]);
    expect(townEntries({ deposit: "c2" }, m, S)).toEqual([{ kind: "empty", label: "預ける物がない", disabled: true }, back]);
    // 未鑑定の品は未鑑定の名前で出る
    expect(townEntries("storageWithdraw", m, S)).toEqual([{ kind: "pick", to: { withdraw: kept }, label: "剣？", disabled: false }, back]);
    // 受け取る者は全員（dead の c3 も）。c6 は空き 0
    expect(townEntries({ withdraw: kept }, m, S).map((e) => (e.kind === "withdraw" ? [e.memberId, e.disabled] : e.kind))).toEqual([
      ["c1", false],
      ["c2", false],
      ["c3", false],
      ["c4", false],
      ["c5", false],
      ["c6", true],
      "back",
    ]);
    // 倉庫が満杯なら預ける品は disabled
    const full = cloneState(s);
    for (let i = full.warehouse.length; i < cap; i++) full.warehouse.push(createItemInstance(full, { itemId: "herb", identified: true }));
    expect(townEntries({ deposit: "c1" }, menuOf(full), S)).toEqual([{ kind: "deposit", memberId: "c1", instanceId: herb, label: "薬草", disabled: true }, back]);
    expect(townEntries("storageWithdraw", menuOf(town()), S)).toEqual([{ kind: "empty", label: "倉庫は空だ", disabled: true }, back]);
    expect(townParent("storage")).toBe("shop");
    expect(townParent("storageDeposit")).toBe("storage");
    expect(townParent({ deposit: "c1" })).toBe("storageDeposit");
    expect(townParent({ withdraw: kept })).toBe("storageWithdraw");
    expect(townPageIntro({ withdraw: kept }, m)).toEqual([]);
  });

  test("UI-52 townRepair: townMenu を取り直して品や者が消えたページは 1 つ上へ。成り立つページはそのまま", () => {
    const s = town();
    const twin = createItemInstance(s, { itemId: "dagger", uniqueId: "twin_tongue_dagger", identified: true });
    const kept = createItemInstance(s, { itemId: "herb", identified: true });
    s.buyback.push(twin);
    s.warehouse.push(kept);
    const m = menuOf(s);
    expect(townRepair({ buyback: twin }, m)).toEqual({ buyback: twin });
    expect(townRepair({ withdraw: kept }, m)).toEqual({ withdraw: kept });
    // 買い戻した・引き出した後（ストック・倉庫から消えた）
    const after = cloneState(s);
    after.buyback = [];
    after.warehouse = [];
    after.party[0]!.inventory.push(twin, kept);
    const m2 = menuOf(after);
    expect(townRepair({ buyback: twin }, m2)).toBe("shopBuyback");
    expect(townRepair({ withdraw: kept }, m2)).toBe("storageWithdraw");
    expect(townRepair({ shop: "herb" }, m2)).toEqual({ shop: "herb" });
    expect(townRepair({ shop: "chain_mail" }, m2)).toBe("shopBuy"); // shopLevel 0 では並ばない
    expect(townRepair({ sell: "c9" }, m2)).toBe("shopSell");
    expect(townRepair({ deposit: "c9" }, m2)).toBe("storageDeposit");
    expect(townRepair({ sell: "c1" }, m2)).toEqual({ sell: "c1" });
    expect(townRepair("shopBuy", m2)).toBe("shopBuy");
    expect(townRepair({ temple: "cure" }, m2)).toEqual({ temple: "cure" });
  });

  test("UI-52/UI-33 戻る（Esc）は 1 つ上のページ。寺院のサービスは寺院へ、店の品は買うへ、店の各ページは店へ、他はメニューへ、メニューは null", () => {
    expect(townParent("menu")).toBeNull();
    for (const p of ["tavern", "inn", "temple", "dark", "gate", "shop"] as const) expect(townParent(p)).toBe("menu");
    for (const p of ["shopBuy", "shopSell", "shopBuyback", "shopIdentify", "storage"] as const) expect(townParent(p)).toBe("shop");
    expect(townParent({ temple: "cure" })).toBe("temple");
    expect(townParent({ shop: "herb" })).toBe("shopBuy");
    expect(samePage({ shop: "herb" }, { shop: "herb" })).toBe(true);
    expect(samePage({ shop: "herb" }, { shop: "return_thread" })).toBe(false);
    expect(samePage({ shop: "herb" }, { temple: "cure" })).toBe(false);
    expect(samePage({ temple: "cure" }, { shop: "herb" })).toBe(false);
    expect(samePage("shop", { shop: "herb" })).toBe(false);
    expect(samePage({ temple: "cure" }, { temple: "cure" })).toBe(true);
    expect(samePage({ temple: "cure" }, { temple: "uncurse" })).toBe(false);
    expect(samePage({ sell: "c1" }, { deposit: "c1" })).toBe(false);
    expect(samePage({ sell: "c1" }, { sell: "c1" })).toBe(true);
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

describe("TW-09/CH-22 転職（酒場の「GMに申し出る」。M10）", () => {
  /** app の classChangeOf と同じ値（名前は campMenu、転職先はその段の者の classChangeOptions） */
  function ccOf(s: GameState, memberId: string | null): ClassChangeView {
    const members = (campMenu(s, data)?.members ?? []).map((x) => ({ memberId: x.id, name: x.name }));
    return { members, options: memberId === null ? [] : classChangeOptions(s, data, memberId) };
  }

  test("TW-09/UI-52 申し出る者の段: 全員（並び順。死亡も dim にしない）→ 戻る。語りは town.classChange.intro、見出しは誰が転職する？、戻るは酒場", () => {
    const s = town({ c2: { life: "dead", hp: 0 } });
    const m = menuOf(s);
    const names = ["アルド", "ベルク", "キリ", "ドナ", "エル", "フィン"];
    expect(townEntries("classChange", m, S, null, ccOf(s, null))).toEqual([
      ...names.map((label, i): TownEntry => ({ kind: "pick", to: { ccClass: `c${i + 1}` }, label, disabled: false })),
      back,
    ]);
    expect(townPageIntro("classChange", m)).toEqual(["town.classChange.intro"]);
    expect(townHeading("classChange")).toBe("town.ask.classChangeWho");
    expect(townParent("classChange")).toBe("tavern");
    expect(townParent({ ccClass: "c5" })).toBe("classChange");
    expect(townParent({ ccConfirm: { memberId: "c5", classId: "thief" } })).toEqual({ ccClass: "c5" });
  });

  test("TW-09/CH-22 職業の段: classes.json の順。core の ok が偽なら dim で、押したときの理由（要る能力値は requirements をそのまま並べる）。今の職業は「（今）」", () => {
    // エル（魔術師。力 7・知恵 16・信仰心 10・素早さ 11）: 盗賊（素早さ 11）だけ条件を満たす
    const s = town();
    const e = townEntries({ ccClass: "c5" }, menuOf(s), S, null, ccOf(s, "c5"));
    const to = (classId: string): TownPage => ({ ccConfirm: { memberId: "c5", classId } });
    expect(e).toEqual([
      { kind: "ccClass", to: to("fighter"), label: "戦士", disabled: true, reason: "戦士には 力 11 が要る。" },
      { kind: "ccClass", to: to("thief"), label: "盗賊", disabled: false, reason: null },
      { kind: "ccClass", to: to("priest"), label: "僧侶", disabled: true, reason: "僧侶には 信仰心 11 が要る。" },
      { kind: "ccClass", to: to("mage"), label: "魔術師（今）", disabled: true, reason: "エルはすでに魔術師だ。" },
      { kind: "ccClass", to: to("samurai"), label: "侍", disabled: true, reason: "侍には 力 15・知恵 11・信仰心 10・生命力 14・素早さ 10 が要る。" },
      { kind: "ccClass", to: to("lord"), label: "君主", disabled: true, reason: "君主には 力 15・知恵 12・信仰心 12・生命力 15・素早さ 14・運 15 が要る。" },
      { kind: "ccClass", to: to("bishop"), label: "司教", disabled: true, reason: "司教には 知恵 12・信仰心 12 が要る。" },
      back,
    ]);
    // 死亡の者はどの職業も dim（core の not alive）
    const d = town({ c5: { life: "dead", hp: 0 } });
    const de = townEntries({ ccClass: "c5" }, menuOf(d), S, null, ccOf(d, "c5"));
    for (const x of de.slice(0, -1)) expect(x).toMatchObject({ kind: "ccClass", disabled: true, reason: "エルは今、転職を申し出られない。" });
    // dim かどうかは core の ok と一致する（表示層は比べない）
    const opts = classChangeOptions(s, data, "c5");
    expect(e.slice(0, -1).map((x) => ("disabled" in x ? !x.disabled : null))).toEqual(opts.map((o) => o.ok));
    expect(townHeading({ ccClass: "c5" })).toBe("town.ask.classChangeTo");
  });

  // 2026-10-07（M10.5 追補・未定-22）: 確認の文は会話の箱ではなく見出しに出す（classChangeConfirmLines を townHeadingText に置き換えた）
  test("TW-09/UI-47 未定-22 確認の段: 見出しに「{name}を{cls}にする。レベルは 1 に戻る。よいか。」（会話の箱では語らない）、[転職する]（core の ok が偽なら dim）→ 戻る。送る Command を core が受け付け、結果の語りが出る", () => {
    const s = town();
    const page: TownPage = { ccConfirm: { memberId: "c5", classId: "thief" } };
    const cc = ccOf(s, "c5");
    expect(townHeadingText(page, menuOf(s), S, null, cc)).toBe("エルを盗賊にする。レベルは 1 に戻る。よいか。");
    expect(townPageIntro(page, menuOf(s))).toEqual([]);
    expect(townHeadingText({ ccClass: "c5" }, menuOf(s), S, null, cc)).toBe(S["town.ask.classChangeTo"]);
    expect(townHeadingText(page, menuOf(s), S, null, null)).toBe(S["town.ask.classChangeConfirm"]);
    const e = townEntries(page, menuOf(s), S, null, cc);
    expect(e).toEqual([{ kind: "classChange", memberId: "c5", classId: "thief", label: "転職する", disabled: false }, back]);
    expect(townEntries({ ccConfirm: { memberId: "c5", classId: "fighter" } }, menuOf(s), S, null, cc)[0]).toMatchObject({ kind: "classChange", disabled: true });
    expect(townHeading(page)).toBe("town.ask.classChangeConfirm");
    const x = e[0]!;
    if (x.kind !== "classChange") throw new Error("classChange expected");
    const r = execute(s, { type: "town.classChange", memberId: x.memberId, classId: x.classId }, data);
    expect(r.events.some((ev) => ev.kind === "rejected")).toBe(false);
    expect(r.events).toContainEqual({ kind: "message", key: "town.tavern.classChanged", params: { name: "エル", cls: "盗賊" } });
    // 転職の後は今の職業の印が盗賊に移る
    const after = townEntries({ ccClass: "c5" }, menuOf(r.state), S, null, ccOf(r.state, "c5"));
    expect(after.find((y) => y.label === "盗賊（今）")).toMatchObject({ disabled: true });
  });

  test("TW-09/UI-47 転職の文（理由・語り）は会話の箱の 3 行（全角 28 字）に収まる。未定-22: 確認の見出しは全角 6 字の名前と最も長い職業名でも 1 行", () => {
    const s = town({ c5: { name: "ああああああ" } });
    const longest = [...data.classes].sort((a, b) => b.name.length - a.name.length)[0]!;
    const heading = townHeadingText({ ccConfirm: { memberId: "c5", classId: longest.id } }, menuOf(s), S, null, ccOf(s, "c5"));
    expect(heading).toBe(`ああああああを${longest.name}にする。レベルは 1 に戻る。よいか。`);
    expect(kinsokuLines(heading, 28)).toHaveLength(1);
    const lines = [
      ...townEntries({ ccClass: "c5" }, menuOf(s), S, null, ccOf(s, "c5")).flatMap((x) => (x.kind === "ccClass" && x.reason !== null ? [x.reason] : [])),
      S["town.classChange.intro"]!,
    ];
    for (const l of lines) expect(kinsokuLines(l, 28).length, l).toBeLessThanOrEqual(3);
  });
});

describe("UI-73 戦績の画面（M12。views/ending.ts の純粋な部分）", () => {
  const record: EndingRecord = {
    dives: 12,
    battles: 80,
    deaths: 5,
    ashes: 1,
    wipes: 2,
    turns: 4321,
    bestiary: { known: 15, total: 20 },
    uniques: { known: 3, total: 14 },
  };

  test("UI-73/TW-35 formatEndingRecord: 見出し → 潜行 → 戦闘 → 死者 → 灰 → 全滅 → 経過 → 敵の図鑑 → 品の図鑑（record の値だけで描く）。どの行も 1 行（全角 26 字）に収まる", () => {
    const lines = formatEndingRecord(record, S);
    expect(lines).toEqual([
      "戦績",
      "潜行　12回",
      "戦闘　80回",
      "死者　5人",
      "灰　1人",
      "全滅　2回",
      "経過　4321ターン",
      "敵の図鑑　15/20",
      "品の図鑑　3/14",
    ]);
    for (const l of lines) expect(kinsokuLines(l, 26), l).toHaveLength(1);
    // 9 行（行の高さ 10）は全滅の内訳と同じ矩形に収まる（スクロールしない）
    const w = dungeonLayout(regions(data.config.ui.layout, data.config.stage.width), data.config.party.size).wipe;
    expect(lines.length * 10 + 2 * 4 + 2).toBeLessThanOrEqual(w.h);
  });

  test("UI-73/UI-33 endingKeyAction: Enter / Esc / 1 は閉じる。↑↓ は下の会話の箱が開いているときだけ 3 行ずつ読み返す。ほかのキーは何もしない", () => {
    for (const a of ["back", "confirm", { menu: 0 }] as const) expect(endingKeyAction(a, false)).toBe("close");
    expect(endingKeyAction("forward", true)).toBe("scrollUp");
    expect(endingKeyAction("around", true)).toBe("scrollDown");
    expect(endingKeyAction("forward", false)).toBeNull();
    expect(endingKeyAction("around", false)).toBeNull();
    expect(endingKeyAction({ menu: 1 }, true)).toBeNull();
    expect(endingKeyAction("left", true)).toBeNull();
  });

  test("UI-73/UI-52/TW-35 酒場の「戦績」は townMenu.canShowRecord のときだけ、GMに申し出るの後（救済の行・戻るの前）に出る（U-2）", () => {
    const off = townEntries("tavern", menuOf(town()), S);
    expect(off.some((e) => e.kind === "record")).toBe(false);
    const s = town();
    s.progress = { ...s.progress, conquered: true };
    const m = menuOf(s);
    expect(m.canShowRecord).toBe(true);
    const on = townEntries("tavern", m, S);
    const i = on.findIndex((e) => e.kind === "page" && e.to === "classChange");
    expect(on[i + 1]).toEqual({ kind: "record", label: "戦績" });
    expect(on.at(-1)).toEqual(back);
    expect(S["ending.dismiss"]).toBe("閉じる");
  });
});

describe("TW-36 開始の語り（M12.5）の文の長さ", () => {
  test("TW-36 opening.speech.1..N は会話の箱の 1 行 28 字で 2 行以内（禁則つき）。1 行目はある", () => {
    expect(S["opening.speech.1"]).toBeDefined();
    for (let n = 1; S[`opening.speech.${n}`] !== undefined; n++) {
      const t = S[`opening.speech.${n}`]!;
      expect(kinsokuLines(t, 28).length, `${n}: ${t}`).toBeLessThanOrEqual(2);
    }
  });
});
