// UI-52 街のページ（views/town.ts の純粋な部分）。値は core の townMenu だけから作る（UI-35）。
// 既定のパーティ（newGame(1)）: c1 アルド（リーダー）、c2 ベルク、c3 キリ、c4 ドナ、c5 エル、c6 フィン。全員レベル 1。所持金 300。
// 宿: 馬小屋 0G / 相部屋 20G / 個室 60G。寺院: 蘇生 level × 100、治療 毒 50 + 麻痺 150、解呪 200。闇魔術: level × darkCostPerLevel。
// 店（TW-05）: 薬草 10G / 解毒草 15G / 帰還の糸 50G。初期の所持枠の空き（townMenu.shop.members）は c1 5 / c2 7 / c3 4 / c4 5 / c5 6 / c6 5（M17 から c1・c2 は素の力 14・15 で上限 9）。
import { describe, expect, test, vi } from "vitest";
import { campMenu } from "../src/core/rules/camp";
import { classChangeOptions, townMenu, type ClassChangeOption } from "../src/core/rules/town";
import { identifiedValueParams, shopPrice } from "../src/core/rules/shop";
import { execute } from "../src/core/engine";
import { upgradePreview } from "../src/core/rules/upgrade";
import { shopEquipCompare, type EquipVerdict, type ShopEquipCompare } from "../src/core/rules/item-view";
import { cloneState, createItemInstance, itemDisplayName } from "../src/core/state";
import { identifiedPowerParams, POWER_NONE } from "../src/core/rules/equip-stats";
import type { Character, EndingRecord, GameState, TownMenu, UpgradeCatalystRef } from "../src/core/types";
import { endingKeyAction, formatEndingRecord } from "../src/presenter/views/ending";
import { createRulesOverlay, formatRules, RULE_TERM_MAX, splitRuleEntry, splitRuleLine } from "../src/presenter/views/rules";
import { tapSpecOf } from "../src/presenter/input/tap";
import { createWipeView, TERM_COL_W, type WipeTermLine } from "../src/presenter/views/wipe";
import {
  classChangeRowLabel,
  samePage,
  TOWN_INTRO_DEDUP,
  townEntries,
  townFacility,
  townFreshBlock,
  townFreshIntro,
  townHeader,
  townHeading,
  townHeadingSub,
  townHeadingText,
  townLowersInput,
  townMenuNotes,
  townPageIntro,
  townParent,
  townPlace,
  townRepair,
  shopCannotEquipText,
  shopCompareText,
  shopMemberCompareLabel,
  shopPreviewText,
  upgradeCatalystInfo,
  upgradeCatalystLabel,
  upgradeItemName,
  upgradePreviewText,
  upgradeConfirmSay,
  type ClassChangeView,
  type TownEntry,
  type TownPage,
} from "../src/presenter/views/town";
import { formatMessage } from "../src/presenter/views/message";
import { textUnits } from "../src/presenter/views/party-band";
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
  { gateAsk: "d01" },
  "shop",
  "shopBuy",
  "shopSell",
  "shopBuyback",
  "shopIdentify",
  "bank",
  "bankDeposit",
  "bankWithdraw",
  "storageDeposit",
  "storageWithdraw",
  { shop: "herb" },
  { sell: "c1" },
  { buyback: "i1" },
  { deposit: "c1" },
  { withdraw: "i1" },
  { buyAsk: { itemId: "herb", memberId: "c1" } },
  { sellAsk: { memberId: "c1", instanceId: "i1" } },
  "classChange",
  { ccClass: "c1" },
  { ccConfirm: { memberId: "c1", classId: "mage" } },
];

describe("UI-52 街のページ", () => {
  test("UI-52/TW-08/TW-05/TW-10 施設メニューは 酒場・宿屋・寺院・闇魔術・迷宮へ・店・銀行 の 7 枠（M17 で銀行。3 段目の左）。ヘッダーは所持金", () => {
    const m = menuOf(town());
    expect(townEntries("menu", m, S)).toEqual([
      { kind: "page", to: "tavern", label: "酒場" },
      { kind: "page", to: "inn", label: "宿屋" },
      { kind: "page", to: "temple", label: "寺院" },
      { kind: "page", to: "dark", label: "闇魔術" },
      { kind: "page", to: "gate", label: "迷宮へ" },
      { kind: "page", to: "shop", label: "店" },
      { kind: "page", to: "bank", label: "銀行" },
    ]);
    expect(townHeader(m, S, "menu")).toBe("街　300G");
    expect(townHeader(menuOf(town({}, 0)), S, "menu")).toBe("街　0G");
  });

  test("UI-13/UI-52（M10。M17）施設メニューのラベルは 4 字（TOWN_GRID_LABEL_MAX）まで。8px の字で 40×40 の枠の内側に収まる（strings を差し替えて 5 字にしたら落ちる）。7 つは 9 枠に収まる", () => {
    expect(TOWN_GRID_LABEL_MAX).toBe(4);
    const grid = townLayout(regions(data.config.ui.layout, data.config.stage.width), data.config.party.size).grid;
    const labels = townEntries("menu", menuOf(town()), S).map((e) => e.label);
    expect(grid).toHaveLength(9);
    expect(labels).toHaveLength(7);
    for (const l of labels) expect([...l].length, l).toBeLessThanOrEqual(TOWN_GRID_LABEL_MAX);
    for (const r of grid) expect(8 * TOWN_GRID_LABEL_MAX).toBeLessThanOrEqual(r.w - 2);
    // 差し替えの検査が効くこと（5 字の施設名は上の検査で落ちる）
    const long = townEntries("menu", menuOf(town()), { ...S, "town.menu.tavern": "冒険者の酒場" }).map((e) => e.label);
    expect(long.some((l) => [...l].length > TOWN_GRID_LABEL_MAX)).toBe(true);
  });

  test("UI-13/UI-52（M16。M17）施設メニューの下の説明は枠の順に 7 行「{label}: {note}」。各行は全角 28 字以内で、行の数は townLayout の notes と同じ", () => {
    const notes = townMenuNotes(S);
    expect(notes).toEqual([
      "酒場: 状態・転職・図鑑",
      "宿屋: 休む・レベルアップ",
      "寺院: 蘇生・治療・解呪",
      "闇魔術: 灰から戻す・装備を鍛える",
      "迷宮へ: 潜る",
      "店: 売買・鑑定",
      "銀行: 金と品を預ける",
    ]);
    // ラベルは施設メニューの枠と同じ文言（town.menu.<id>）
    expect(notes.map((l) => l.split(":")[0])).toEqual(townEntries("menu", menuOf(town()), S).map((e) => e.label));
    for (const l of notes) expect(kinsokuLines(l, 28), l).toHaveLength(1);
    expect(notes).toHaveLength(townLayout(regions(data.config.ui.layout, data.config.stage.width), data.config.party.size).notes.length);
  });

  test("UI-52/TW-04/TW-15（M16。M18 5-3）宿屋はランクの行（名前・料金「{cost}G」・効果。M22 D-7 で「（一行）」は見出しへ。士気の立つ個室は効果に「＋士気」）。払えないランクは disabled。末尾が戻る", () => {
    expect(townEntries("inn", menuOf(town({}, 50)), S)).toEqual([
      { kind: "inn", rank: 0, label: "馬小屋　0G　MPのみ", disabled: false },
      { kind: "inn", rank: 1, label: "相部屋　20G　全回復・毒も治る", disabled: false },
      { kind: "inn", rank: 2, label: "個室　60G　全回復＋士気・毒も治る", disabled: true },
      back,
    ]);
    // ちょうど払える額なら押せる
    expect(townEntries("inn", menuOf(town({}, 60)), S).filter((e) => e.kind === "inn" && e.disabled)).toEqual([]);
  });

  test("UI-52/TW-04/TW-15（M16）宿の効果の文は config.town.innRanks の id ごとに town.inn.effect.<id> があり、行は一覧の幅（全角 21 字）に収まる。キーは core の id から組み立てる", () => {
    for (const r of data.config.town.innRanks) expect(S[`town.inn.effect.${r.id}`], r.id).toBeDefined();
    for (const e of townEntries("inn", menuOf(town()), S)) expect(kinsokuLines(e.label, 21), e.label).toHaveLength(1);
    // 効果の文はランクの id で引く（strings を差し替えれば行も変わる。表示層はランクを見て分岐しない）
    const swapped = townEntries("inn", menuOf(town()), { ...S, "town.inn.effect.cheap": "効果X" });
    expect(swapped[1]?.label).toBe("相部屋　20G　効果X");
    expect(S["town.inn.moraleMark"]).toBeUndefined();
  });

  test("UI-52/TW-15 宿屋の語りは、士気がある間だけ town.inn.moraleNow を続けて出す", () => {
    expect(townPageIntro("inn", menuOf(town()))).toEqual(["town.inn.intro"]);
    const stayed = cloneState(town());
    stayed.morale = { rankId: "good" };
    expect(townPageIntro("inn", menuOf(stayed))).toEqual(["town.inn.intro", "town.inn.moraleNow"]);
    for (const k of ["town.inn.intro", "town.inn.moraleNow"]) expect(S[k], k).toBeDefined();
    // M16（TW-15）: 宿の語りに士気の一言（会話の箱の 28 字 × 2 行以内）
    expect(S["town.inn.intro"]).toContain("士気: 次の潜行で SAN と判定に補正");
    expect(kinsokuLines(S["town.inn.intro"]!, 28).length).toBeLessThanOrEqual(2);
  });

  test("UI-52/TW-07 寺院はサービスの 3 項目と戻る（M18 5-4 から料金の目安つき）。サービスの対象は行（名前と料金、払えなければ disabled）", () => {
    const s = town({ c3: { life: "dead", hp: 0 }, c2: { status: ["poison", "paralysis"] } }, 200);
    const m = menuOf(s);
    expect(townEntries("temple", m, S)).toEqual([
      { kind: "page", to: { temple: "resurrect" }, label: "蘇生　Lv×100G" },
      { kind: "page", to: { temple: "cure" }, label: "治療（麻痺・石化・毒）　50G〜" },
      { kind: "page", to: { temple: "uncurse" }, label: "解呪　200G" },
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

  test("TW-17 M22（D-4）town.dark.intro は 2 行以内で安い装備も触媒になると語る。town.upgrade.intro は変えない", () => {
    expect(S["town.dark.intro"]).toContain("店で買った安い装備も触媒になる。");
    expect(kinsokuLines(S["town.dark.intro"]!, 28).length).toBeLessThanOrEqual(2);
    expect(kinsokuLines(S["town.upgrade.intro"]!, 28).length).toBeLessThanOrEqual(3);
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

  // M16（4-5）: 強化の画面の品の名前は Lv を常に「+N」で出す（town.upgrade.itemLv。Lv0 も「革鎧 +0」）
  test("UI-52/TW-17/IT-11 部位の段: EQUIP_SLOTS の順に「部位　品名 +N」（Lv0 も +0）、空きは「部位　（なし）」で disabled。押すと触媒の段（選択なし）", () => {
    const s = town();
    s.items[s.party[0]!.equipment.weapon!]!.level = 3;
    const m = menuOf(s);
    const page = { upSlot: "c1" };
    expect(townEntries(page, m, S)).toEqual([
      { kind: "pick", to: { upCat: { memberId: "c1", slot: "weapon", picked: [] } }, label: "武器　長剣 +3", disabled: false },
      { kind: "pick", to: { upCat: { memberId: "c1", slot: "armor", picked: [] } }, label: "防具　革鎧 +0", disabled: false },
      { kind: "pick", to: { upCat: { memberId: "c1", slot: "shield", picked: [] } }, label: "盾　木の盾 +0", disabled: false },
      { kind: "pick", to: { upCat: { memberId: "c1", slot: "helm", picked: [] } }, label: "兜　（なし）", disabled: true },
      { kind: "pick", to: { upCat: { memberId: "c1", slot: "gauntlet", picked: [] } }, label: "小手　（なし）", disabled: true },
      { kind: "pick", to: { upCat: { memberId: "c1", slot: "accessory", picked: [] } }, label: "装飾　（なし）", disabled: true },
      back,
    ]);
    expect(townParent(page)).toBe("upgrade");
    expect(townPageIntro(page, m)).toEqual([]);
  });

  // M16（4-5・G-2）: 行は「○{品} +{Lv}　{持ち主}」。選択は持ち主と実体の組
  test("UI-52/TW-17/IT-70 触媒の段: 鑑定済みの汎用装備に ○ / ● の印と持ち主の名前。押すと付け外し、maxCatalysts（3）個選ぶと未選択は disabled。決める → 確認の段", () => {
    const s = town();
    const add = (level: number, identified = true): string => {
      const id = createItemInstance(s, { itemId: "dagger", level, identified });
      s.party[0]!.inventory.push(id);
      return id;
    };
    const [a, b, c, d] = [add(1), add(0), add(2), add(0)];
    add(0, false); // 未鑑定は候補に出ない
    const m = menuOf(s);
    const sel = { memberId: "c1", slot: "weapon" as const, picked: [] as UpgradeCatalystRef[] };
    const r1 = (id: string): UpgradeCatalystRef => ({ memberId: "c1", instanceId: id });
    const [ra, rb, rc, rd] = [r1(a), r1(b), r1(c), r1(d)];
    const e0 = townEntries({ upCat: sel }, m, S);
    expect(e0).toEqual([
      { kind: "upPick", to: { upCat: { ...sel, picked: [ra] } }, label: "○短剣 +1　アルド", disabled: false, info: "短剣 +1: 攻撃 1d4+1 / AC — / 魔法攻撃力 —" },
      { kind: "upPick", to: { upCat: { ...sel, picked: [rb] } }, label: "○短剣 +0　アルド", disabled: false, info: "短剣 +0: 攻撃 1d4 / AC — / 魔法攻撃力 —" },
      { kind: "upPick", to: { upCat: { ...sel, picked: [rc] } }, label: "○短剣 +2　アルド", disabled: false, info: "短剣 +2: 攻撃 1d4+2 / AC — / 魔法攻撃力 —" },
      { kind: "upPick", to: { upCat: { ...sel, picked: [rd] } }, label: "○短剣 +0　アルド", disabled: false, info: "短剣 +0: 攻撃 1d4 / AC — / 魔法攻撃力 —" },
      { kind: "page", to: { upConfirm: sel }, label: "決める" },
      back,
    ]);
    // c → a → b の順に 3 個選んだ: 印が付き、外すと選んだ順のまま 1 個抜ける。未選択の d は disabled
    const full = { ...sel, picked: [rc, ra, rb] };
    const e3 = townEntries({ upCat: full }, m, S);
    expect(e3[0]).toEqual({ kind: "upPick", to: { upCat: { ...sel, picked: [rc, rb] } }, label: "●短剣 +1　アルド", disabled: false, info: "短剣 +1: 攻撃 1d4+1 / AC — / 魔法攻撃力 —" });
    expect(e3[3]).toEqual({ kind: "upPick", to: { upCat: { ...sel, picked: [rc, ra, rb, rd] } }, label: "○短剣 +0　アルド", disabled: true, info: "短剣 +0: 攻撃 1d4 / AC — / 魔法攻撃力 —" });
    expect(e3[4]).toEqual({ kind: "page", to: { upConfirm: full }, label: "決める" });
    expect(townParent({ upCat: full })).toEqual({ upSlot: "c1" });
    expect(townPageIntro({ upCat: full }, m)).toEqual([]);
    // M16（G-2）: 他の者の段でも同じ候補（c1 の品）が出る
    expect(townEntries({ upCat: { ...sel, memberId: "c2" } }, m, S)[0]).toEqual({
      kind: "upPick",
      to: { upCat: { ...sel, memberId: "c2", picked: [ra] } },
      label: "○短剣 +1　アルド",
      disabled: false,
      info: "短剣 +1: 攻撃 1d4+1 / AC — / 魔法攻撃力 —",
    });
    // 候補が無ければ空の行 → 決める → 戻る（触媒なしでも鍛えられる）
    const none = menuOf(town());
    expect(townEntries({ upCat: { ...sel, memberId: "c2" } }, none, S)).toEqual([
      { kind: "empty", label: "触媒にできる物がない", disabled: true },
      { kind: "page", to: { upConfirm: { ...sel, memberId: "c2" } }, label: "決める" },
      back,
    ]);
  });

  test("UI-52/TW-17/IT-70 M16（G-2）触媒の行が一覧の幅（全角 21 字）を超えるときは、持ち主の名前を先頭 2 字 +「…」（item.owner.short）に縮める。IT-11 の表示名は変えない", () => {
    const s = town({ c3: { name: "ろくもじのな" } });
    const longBase = [...data.equipmentBases].sort((x, y) => Array.from(y.name).length - Array.from(x.name).length)[0]!;
    const longRarity = (["fine", "rare", "legendary"] as ("fine" | "rare" | "legendary")[]).sort((x, y) => Array.from(S[`item.rarity.${y}`]!).length - Array.from(S[`item.rarity.${x}`]!).length)[0]!;
    const big = createItemInstance(s, { itemId: longBase.id, level: 12, rarity: longRarity, identified: true });
    const small = createItemInstance(s, { itemId: "dagger", level: 0, identified: true });
    s.party[2]!.inventory.push(big, small);
    const m = menuOf(s);
    const sel = { memberId: "c1", slot: "weapon" as const, picked: [] as UpgradeCatalystRef[] };
    const rows = townEntries({ upCat: sel }, m, S).filter((e) => e.kind === "upPick");
    const item = `${S[`item.rarity.${longRarity}`]}${longBase.name} +12`;
    // 今のデータの最悪（最も長い接頭辞 + 最も長いベースの名前 + 2 桁の Lv + 6 字の名前）は行の文字の幅（39 単位）に収まるので縮めない
    expect(rows.map((e) => e.label)).toEqual([`○${item}　ろくもじのな`, "○短剣 +0　ろくもじのな"]);
    for (const e of rows) expect(textUnits(e.label), e.label).toBeLessThanOrEqual(39);
    // 39 単位を超える行（名前の長いベースを足したデータを想定した値）は、持ち主の名前を先頭 2 字 +「…」に縮める
    const long = { instanceId: "i1", name: "とてもながいなまえのけん +12", plainName: "とてもながいなまえのけん", level: 12, ownerId: "c3", ownerName: "ろくもじのな", power: { attack: "1d6+12", ac: null, magicPower: null } };
    expect(textUnits(`○とてもながいなまえのけん +12　ろくもじのな`)).toBeGreaterThan(39);
    expect(upgradeCatalystLabel(long, false, S)).toBe("○とてもながいなまえのけん +12　ろく…");
    expect(upgradeCatalystLabel(long, true, S)).toBe("●とてもながいなまえのけん +12　ろく…");
    expect(textUnits(upgradeCatalystLabel(long, false, S))).toBeLessThanOrEqual(39);
    // 文言の差し替え: item.owner.short・catRow・itemLv は strings から
    const S2 = { ...S, "item.owner.short": "{name}~", "town.upgrade.catRow": "{owner}：{item}", "town.upgrade.itemLv": "{name}+{level}" };
    expect(upgradeCatalystLabel(long, true, S2)).toBe("●ろく~：とてもながいなまえのけん+12");
    // 表示名（IT-11）は Lv0 で +0 を付けないまま
    expect(m.upgrade.members[0]!.catalysts[1]!.name).toBe("短剣");
    expect(upgradeItemName("短剣", 0, S)).toBe("短剣 +0");
  });

  test("UI-52/TW-17/IT-70（M17）倉庫の品の触媒の行は持ち主の欄が town.shop.menu.storage「倉庫」。メンバーの品の後に並び、選ぶと memberId null の組。townRepair は倉庫の品を選んだままにする", () => {
    const s = town();
    const mine = createItemInstance(s, { itemId: "dagger", level: 1, identified: true });
    const stored = createItemInstance(s, { itemId: "dagger", level: 3, identified: true });
    s.party[0]!.inventory.push(mine);
    s.warehouse.push(stored);
    const m = menuOf(s);
    const sel = { memberId: "c1", slot: "weapon" as const, picked: [] as UpgradeCatalystRef[] };
    const rows = townEntries({ upCat: sel }, m, S).filter((e) => e.kind === "upPick");
    expect(rows).toEqual([
      { kind: "upPick", to: { upCat: { ...sel, picked: [{ memberId: "c1", instanceId: mine }] } }, label: "○短剣 +1　アルド", disabled: false, info: "短剣 +1: 攻撃 1d4+1 / AC — / 魔法攻撃力 —" },
      { kind: "upPick", to: { upCat: { ...sel, picked: [{ memberId: null, instanceId: stored }] } }, label: "○短剣 +3　倉庫", disabled: false, info: "短剣 +3: 攻撃 1d4+3 / AC — / 魔法攻撃力 —" },
    ]);
    const picked = { ...sel, picked: [{ memberId: null, instanceId: stored }] };
    expect(townEntries({ upCat: picked }, m, S).find((e) => e.kind === "upPick" && e.label.includes("倉庫"))?.label).toBe("●短剣 +3　倉庫");
    expect(townRepair({ upCat: picked }, m)).toEqual({ upCat: picked });
    // 倉庫から消えたら選択から外す
    const after = cloneState(s);
    after.warehouse = [];
    expect(townRepair({ upCat: picked }, menuOf(after))).toEqual({ upCat: sel });
    // ownerName（倉庫は空文字）ではなく strings の「倉庫」を出す（差し替えに追従）
    const row = { instanceId: "i1", name: "短剣 +3", plainName: "短剣", level: 3, ownerId: null, ownerName: "", power: { attack: "1d4+3", ac: null, magicPower: null } };
    expect(upgradeCatalystLabel(row, false, S)).toBe("○短剣 +3　倉庫");
    expect(upgradeCatalystLabel(row, false, { ...S, "town.shop.menu.storage": "蔵" })).toBe("○短剣 +3　蔵");
  });

  // 2026-10-07（M10.5 追補・未定-22）: 確認の段は会話の箱で語らず、問いを見出しに出し、対象と触媒の数を答えのボタンのラベルに出す。
  // 旧「対象・触媒の数」「成功率・料金」「所持金が足りない」の語り（upgradeConfirmLines）とラベル「鍛える」の期待を置き換えた
  test("UI-52/UI-47/TW-17 未定-22 確認の段: core の upgradePreview の値で見出しに「成功率（大成功）料金。鍛えるか？」（払えなければ「所持金が足りない。」）、ボタンに「{item}を鍛える（触媒 n）」。会話の箱では語らない。block が null のときだけ 鍛える を押せる", () => {
    const s = town({}, 300);
    s.items[s.party[0]!.equipment.weapon!]!.level = 1;
    const cat = createItemInstance(s, { itemId: "dagger", level: 0, identified: true });
    s.party[0]!.inventory.push(cat);
    const m = menuOf(s);
    const sel = { memberId: "c1", slot: "weapon" as const, picked: [{ memberId: "c1", instanceId: cat }] };
    const p = upgradePreview(s, data, "c1", "weapon", sel.picked);
    expect(p).toMatchObject({ rate: 29, great: 2, fee: 100, affordable: true, block: null });
    expect(townEntries({ upConfirm: sel }, m, S, p)).toEqual([
      { kind: "upgrade", memberId: "c1", slot: "weapon", catalysts: [{ memberId: "c1", instanceId: cat }], label: "長剣 +1を鍛える（触媒 1）", disabled: false },
      back,
    ]);
    expect(townHeadingText({ upConfirm: sel }, m, S, p)).toBe("成功率 29%（大成功 2%）料金 100G。鍛えるか？");
    // 問いは見出しに出すので、会話の箱（広い箱は答えのボタンを覆う）で語らない（M18 3-3 の前後の 1 文は問いではない語り。upgradePreviewText）
    expect(townPageIntro({ upConfirm: sel }, m)).toEqual([]);
    expect(townParent({ upConfirm: sel })).toEqual({ upCat: sel });
    // 払えない: 鍛えるは disabled、見出しの問いを「所持金が足りない。」に替える
    const poor = cloneState(s);
    poor.gold = 99;
    const pp = upgradePreview(poor, data, "c1", "weapon", sel.picked);
    expect(townEntries({ upConfirm: sel }, menuOf(poor), S, pp)[0]).toMatchObject({ kind: "upgrade", disabled: true });
    expect(townHeadingText({ upConfirm: sel }, menuOf(poor), S, pp)).toBe("成功率 29%（大成功 2%）料金 100G。金が足りない。");
    // preview が無い（対象が決まらない）なら押せず、見出しは値の無い問い
    expect(townEntries({ upConfirm: sel }, m, S, null)[0]).toMatchObject({ disabled: true });
    expect(townHeadingText({ upConfirm: sel }, m, S, null)).toBe(S["town.ask.upConfirm"]);
    expect(townHeadingText("dark", m, S, p)).toBe(S["town.ask.service"]);
  });

  test("UI-52/TW-17 M19（C-1）触媒の段の見出しは core の upgradePreview(picked) の値で「触媒 {n} → 成功率 {rate}%（大成功 {great}%）」（town.upgrade.catalystRate）。選ぶたびに組み直り、最悪の値でも 1 行（28 字）。preview が無ければ town.upgrade.catalyst", () => {
    const s = town({}, 300);
    s.items[s.party[0]!.equipment.weapon!]!.level = 1;
    const [a, b] = [0, 0].map((lv) => {
      const id = createItemInstance(s, { itemId: "dagger", level: lv, identified: true });
      s.party[0]!.inventory.push(id);
      return { memberId: "c1", instanceId: id } as UpgradeCatalystRef;
    });
    const m = menuOf(s);
    const sel = { memberId: "c1", slot: "weapon" as const, picked: [] as UpgradeCatalystRef[] };
    const head = (picked: UpgradeCatalystRef[]): string =>
      townHeadingText({ upCat: { ...sel, picked } }, m, S, upgradePreview(s, data, "c1", "weapon", picked));
    // 触媒なし 10%（大成功 1%）→ Lv0 を 1 個 29%（10 + 30 × 0.66 = 29.8）→ 2 個 49%（49.6）
    expect(head([])).toBe("触媒 0 → 成功率 10%（大成功 1%）");
    expect(head([a!])).toBe("触媒 1 → 成功率 29%（大成功 2%）");
    expect(head([a!, b!])).toBe("触媒 2 → 成功率 49%（大成功 4%）");
    // 確認の段の見出し（town.upgrade.ask）と同じ値
    expect(townHeadingText({ upConfirm: { ...sel, picked: [a!] } }, m, S, upgradePreview(s, data, "c1", "weapon", [a!]))).toContain("成功率 29%（大成功 2%）");
    // 値が無ければ固定の問い（townHeading のキー）
    expect(townHeadingText({ upCat: sel }, m, S, null)).toBe(S["town.upgrade.catalyst"]);
    expect(townHeading({ upCat: sel })).toBe("town.upgrade.catalyst");
    // 最悪の値（触媒 3・成功率 100・大成功 10）でも見出しの 1 行
    expect(kinsokuLines(formatMessage(S["town.upgrade.catalystRate"]!, { n: 3, rate: 100, great: 10 }), 28)).toHaveLength(1);
    // 文言は strings から
    const S2 = { ...S, "town.upgrade.catalystRate": "{n}:{rate}/{great}" };
    expect(townHeadingText({ upCat: { ...sel, picked: [a!] } }, m, S2, upgradePreview(s, data, "c1", "weapon", [a!]))).toBe("1:29/2");
  });

  test("TW-17/UI-52 M20（D-7）触媒の段の見出しの 2 行目（townHeadingSub）は core の upgradePreview の料金で「料金 {fee}G」（town.upgrade.feeSub。触媒の数によらない）。preview が無ければ null。最悪の値でも 28 字", () => {
    const s = town({}, 300);
    s.items[s.party[0]!.equipment.weapon!]!.level = 1;
    const id = createItemInstance(s, { itemId: "dagger", level: 0, identified: true });
    s.party[0]!.inventory.push(id);
    const ref = { memberId: "c1", instanceId: id } as UpgradeCatalystRef;
    const m = menuOf(s);
    const sel = { memberId: "c1", slot: "weapon" as const, picked: [] as UpgradeCatalystRef[] };
    const fee = data.config.economy.upgradeFeePerLevel * 2; // 対象の Lv1・触媒 Lv0 → 結果の Lv2 × upgradeFeePerLevel（M21 B-1）
    for (const picked of [[], [ref]]) {
      const pv = upgradePreview(s, data, "c1", "weapon", picked)!;
      expect(pv.fee).toBe(fee);
      expect(townHeadingSub({ upCat: { ...sel, picked } }, m, S, pv)).toBe(`料金 ${fee}G`);
    }
    expect(townHeadingSub({ upCat: sel }, m, S, null)).toBeNull();
    // 確認の段・ほかの段には 2 行目を出さない（宿屋は D-6 の文）
    expect(townHeadingSub({ upConfirm: sel }, m, S, upgradePreview(s, data, "c1", "weapon", []))).toBeNull();
    expect(townHeadingSub("dark", m, S, upgradePreview(s, data, "c1", "weapon", []))).toBeNull();
    expect(kinsokuLines(formatMessage(S["town.upgrade.feeSub"]!, { fee: 9999999 }), 28)).toHaveLength(1);
    expect(townHeadingSub({ upCat: sel }, m, { ...S, "town.upgrade.feeSub": "<{fee}>" }, upgradePreview(s, data, "c1", "weapon", []))).toBe(`<${fee}>`);
  });

  test("TW-05/IT-63 M20（D-7）買い戻すの見出しは「どれを買い戻す？（名品だけ）」（town.ask.buyback）で 28 字に収まる", () => {
    expect(townHeading("shopBuyback")).toBe("town.ask.buyback");
    expect(S["town.ask.buyback"]).toBe("どれを買い戻す？（名品だけ）");
    expect(kinsokuLines(S["town.ask.buyback"]!, 28)).toHaveLength(1);
  });

  test("UI-77/IT-30 M20（D-7）用語の希少度の行はオプションの個数（config.items.rarities の options。上質 1・希少 2・伝説 3）を言う", () => {
    const l = splitRuleLine(Object.entries(S).find(([k, v]) => k.startsWith("rules.line.") && v.startsWith("希少度"))![1]);
    expect(l).toEqual({ term: "希少度", desc: "品の格。上質 1・希少 2・伝説 3 のオプション" });
    const n = Object.fromEntries(data.config.items.rarities.map((r) => [r.id, r.options]));
    expect([n["fine"], n["rare"], n["legendary"]]).toEqual([1, 2, 3]);
  });

  test("TW-17/UI-52 M19（C-1）候補が無い触媒の段に入るときは、候補に出ない理由（town.upgrade.catNoneWhy）を語る（候補があれば語らない）。語り town.upgrade.intro は触媒が成否によらず消えると言う。どちらも会話の箱の 2 行（28 字 × 2）", () => {
    const sel = { memberId: "c1", slot: "weapon" as const, picked: [] as UpgradeCatalystRef[] };
    expect(townPageIntro({ upCat: sel }, menuOf(town()))).toEqual(["town.upgrade.catNoneWhy"]);
    const s = town();
    s.party[1]!.inventory.push(createItemInstance(s, { itemId: "dagger", level: 0, identified: true }));
    expect(townPageIntro({ upCat: sel }, menuOf(s))).toEqual([]);
    // 一覧の空の行は短いまま（行の幅 21 字）
    expect(townEntries({ upCat: sel }, menuOf(town()), S)[0]).toEqual({ kind: "empty", label: S["town.upgrade.catNone"], disabled: true });
    expect(kinsokuLines(S["town.upgrade.catNone"]!, 21)).toHaveLength(1);
    for (const k of ["town.upgrade.catNoneWhy", "town.upgrade.intro"]) expect(kinsokuLines(S[k]!, 28).length, k).toBeLessThanOrEqual(2);
    expect(S["town.upgrade.intro"]).toContain("成否によらず消える");
    for (const w of ["装備中", "消耗品", "未鑑定", "倉庫"]) expect(S["town.upgrade.catNoneWhy"]).toContain(w);
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

  test("UI-52（M8.5）/TW-10（M17）townHeading: 全ページで strings にある params の無いキーで、1 行（見出しの幅 224 = 全角 28 字）に収まる。銀行の一覧と金の額の段だけは預金・所持金を入れた文（townHeadingText）", () => {
    const bankPages: readonly TownPage[] = ["bank", "bankDeposit", "bankWithdraw"];
    const rich = town({}, 9999999);
    rich.bank = 9999999;
    for (const p of ALL_PAGES) {
      const k = townHeading(p);
      expect(S[k], JSON.stringify(p)).toBeDefined();
      if (bankPages.includes(p)) {
        // 7 桁の額でも 1 行に収まり、置き換え忘れの { が残らない
        const text = townHeadingText(p, menuOf(rich), S);
        expect(text, k).not.toContain("{");
        expect(kinsokuLines(text, 28), text).toHaveLength(1);
        continue;
      }
      expect(S[k], k).not.toContain("{");
      expect(kinsokuLines(S[k]!, 28), k).toHaveLength(1);
    }
    const m = menuOf(town({}, 300));
    expect(townHeadingText("bank", m, S)).toBe("預金 0G　所持 300G");
    expect(townHeadingText("bankDeposit", m, S)).toBe("いくら預ける？　所持 300G");
    expect(townHeadingText("bankWithdraw", m, S)).toBe("いくら引き出す？　預金 0G");
    expect(townHeading("menu")).toBe("town.ask.menu");
    expect(townHeading("inn")).toBe("town.ask.inn");
    expect(townHeading("gate")).toBe("town.ask.gate");
    expect(townHeading("upgrade")).toBe("town.upgrade.whom");
    expect(townHeading({ upSlot: "c1" })).toBe("town.upgrade.slot");
    expect(townHeading("shopBuy")).toBe("town.shop.buyIntro");
    expect(townHeading({ shop: "herb" })).toBe("town.shop.whom");
    expect(townHeading({ withdraw: "i1" })).toBe("town.storage.whom");
    expect(S["town.ask.inn"]).toBe("どの部屋にする？（料金は一行分）");
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
    expect(S["town.inn.intro"]).toBe("宿の主人が鍵を並べる。（士気: 次の潜行で SAN と判定に補正）");
    expect(S["town.dungeonGate.intro"]).toBe("迷宮の入口。");
    expect(S["town.shop.sellIntro"]).toBe("鑑定していない品は、見た目どおりの値で引き取るそうだ。");
  });

  test("UI-61（M8.5）townFacility: menu は town、寺院のサービスは temple、闇魔術の灰から戻す・強化の各段は dark、店の各段は shop、銀行（M17）の各段は bank（M21。M20 までは shop）。townPlace は town.place.<施設>（銀行の各段は town.place.bank）", () => {
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
      [{ gateAsk: "d01" }, "gate"],
      ["shop", "shop"],
      ["shopBuy", "shop"],
      ["shopSell", "shop"],
      ["shopBuyback", "shop"],
      ["shopIdentify", "shop"],
      ["bank", "bank"],
      ["bankDeposit", "bank"],
      ["bankWithdraw", "bank"],
      ["storageDeposit", "bank"],
      ["storageWithdraw", "bank"],
      [{ shop: "herb" }, "shop"],
      [{ sell: "c1" }, "shop"],
      [{ buyback: "i1" }, "shop"],
      [{ deposit: "c1" }, "bank"],
      [{ withdraw: "i1" }, "bank"],
      [{ buyAsk: { itemId: "herb", memberId: "c1" } }, "shop"],
      [{ sellAsk: { memberId: "c1", instanceId: "i1" } }, "shop"],
      ["classChange", "tavern"],
      [{ ccClass: "c1" }, "tavern"],
      [{ ccConfirm: { memberId: "c1", classId: "mage" } }, "tavern"],
    ];
    expect(want.map(([p]) => townFacility(p))).toEqual(want.map(([, f]) => f));
    expect(want.length).toBe(ALL_PAGES.length);
    // TW-10 / TW-16（M17）: 銀行の各段（金の額・品を預ける者と品・引き出す品と受け取る者）は施設の id が bank（M21。絵と曲は届くまで店に落とす）、場所は銀行
    const bank = new Set(["bank", "bankDeposit", "bankWithdraw", "storageDeposit", "storageWithdraw", JSON.stringify({ deposit: "c1" }), JSON.stringify({ withdraw: "i1" })]);
    for (const [p, f] of want) {
      const key = typeof p === "string" ? p : JSON.stringify(p);
      expect(townPlace(p)).toBe(bank.has(key) ? "town.place.bank" : `town.place.${f}`);
      expect(S[townPlace(p)], f).toBeDefined();
    }
    expect(S["town.place.bank"]).toBe("銀行");
  });

  test("UI-52（M8.5）townHeader は「{place}　{gold}G」（場所はページの施設）", () => {
    const m = menuOf(town());
    expect(townHeader(m, S, "menu")).toBe("街　300G");
    expect(townHeader(m, S, "inn")).toBe("宿屋　300G");
    expect(townHeader(m, S, { upSlot: "c1" })).toBe("闇魔術　300G");
    expect(townHeader(m, S, "gate")).toBe("迷宮の入口　300G");
    expect(townHeader(m, S, { withdraw: "i1" })).toBe("銀行　300G");
    expect(townHeader(m, S, "bank")).toBe("銀行　300G");
    expect(townHeader(m, S, "shopSell")).toBe("店　300G");
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
    const sel = { memberId: "c1", slot: "weapon" as const, picked: [{ memberId: "c1", instanceId: cat }] };
    const confirm = townEntries({ upConfirm: sel }, m, S, upgradePreview(s, data, "c1", "weapon", sel.picked));
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
    const rc = { memberId: "c1", instanceId: cat };
    const sel = { memberId: "c1", slot: "weapon" as const, picked: [rc] };
    expect(townRepair({ upCat: sel }, m)).toEqual({ upCat: sel });
    // 消えた品・持ち主の違う組は外す
    expect(townRepair({ upConfirm: { ...sel, picked: [{ memberId: "c1", instanceId: "i999" }, rc, { memberId: "c2", instanceId: cat }] } }, m)).toEqual({ upConfirm: sel });
    expect(townRepair({ upCat: { ...sel, slot: "helm" } }, m)).toEqual({ upSlot: "c1" });
    expect(townRepair({ upCat: { ...sel, memberId: "c9" } }, m)).toBe("upgrade");
    expect(townRepair({ upSlot: "c9" }, m)).toBe("upgrade");
    expect(samePage({ upCat: sel }, { upCat: { ...sel, picked: [{ memberId: "c1", instanceId: cat }] } })).toBe(true);
    expect(samePage({ upCat: sel }, { upCat: { ...sel, picked: [] } })).toBe(false);
  });

  // M5.5 で一覧を「見回す ＋ キャンプと同じ項目」に改めた（旧: 状態を見る・装備を替える・並び順を変える）。
  // M10（2026-10-07）: 呪文・道具・装備・鑑定はキャラクター画面（UI-59。状態から開く）の操作に移したので、酒場の一覧から外した
  // M10 TW-09: 図鑑の後に「GMに申し出る」（転職）を足した
  // M16 UI-77: 転職の後に「用語」を足した（以前の期待値は用語なし）
  // M18 UI-79（設計 5-5）: 図鑑を「名品の図鑑」（ラベルを「図鑑」から改めた）と「敵の図鑑」の 2 項目にした
  test("TW-01/TW-03/TW-13/UI-52/TW-31/IT-66/UI-79/TW-09 酒場: 見回す → 状態・並び順 → 名品の図鑑・敵の図鑑 → GMに申し出る → 救済の行（申し出の間だけ。dead / ash の者、リーダーも）→ 戻る", () => {
    const camp: TownEntry[] = [
      { kind: "look", label: "見回す" },
      { kind: "camp", open: "status", label: "状態" },
      { kind: "camp", open: "order", label: "並び順" },
      { kind: "camp", open: "book", label: "名品の図鑑" }, // IT-66（M7）: 図鑑は酒場の一覧（並び順の後）
      { kind: "camp", open: "bestiary", label: "敵の図鑑" }, // UI-79（M18）: 敵の図鑑は名品の図鑑の後
      { kind: "page", to: "classChange", label: "転職（GMに申し出る）" }, // TW-09（M10）: 転職は図鑑の後
      { kind: "rules", label: "用語" }, // UI-77（M16）: 用語は転職（と戦績）の後・救済の行の前
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
    expect(e.map((x) => x.kind)).toEqual(["look", "camp", "camp", "camp", "camp", "page", "rules", "mercy", "back"]); // UI-77（M16）で rules、UI-79（M18）で 4 つ目の camp（敵の図鑑）を足した
    for (const x of e) expect("disabled" in x, x.label).toBe(false);
  });

  test("UI-52/TW-11/DG-47 迷宮の入口は開放済みの迷宮の行「{name}（全 {floors} 階）」（M19 D-1。M21 で表記を変えた）。行動可能な者がいなければ disabled", () => {
    const d = data.dungeons.find((x) => x.id === "d01")!;
    const row = { kind: "enter", dungeonId: "d01", label: "試しの坑道（全 2 階）", notReady: null, description: d.description } as const;
    expect(townEntries("gate", menuOf(town()), S)).toEqual([{ ...row, disabled: false }, back]);
    const allDead = town(Object.fromEntries(["c1", "c2", "c3", "c4", "c5", "c6"].map((id) => [id, { life: "dead" as const, hp: 0 }])));
    expect(townEntries("gate", menuOf(allDead), S)).toEqual([{ ...row, disabled: true }, back]);
  });

  test("UI-52/DG-47（M21）到達の記録（core の reached）があれば入口の行に「　到達 {n}F」を添える。記録の無い迷宮には添えない。最悪の値（全迷宮・99 階・到達 99F）でも一覧の行（39 単位・21 字）に収まる", () => {
    const s = town();
    s.progress.unlockedDungeons.push("d02");
    s.progress.deepestFloors = { d01: 2 };
    const labels = townEntries("gate", menuOf(s), S).map((e) => e.label);
    expect(labels.slice(0, 2)).toEqual(["試しの坑道（全 2 階）　到達 2F", "沈んだ聖堂（全 3 階）"]);
    expect(Array.from(labels[0]!).length).toBeLessThanOrEqual(21);
    for (const d of data.dungeons) {
      const row = formatMessage(S["town.gate.row"]!, { name: d.name, floors: 99 }) + formatMessage(S["town.gate.reached"]!, { n: 99 });
      expect(row).not.toContain("{");
      expect(textUnits(row), row).toBeLessThanOrEqual(39);
      expect(Array.from(row).length, row).toBeLessThanOrEqual(21);
      expect(kinsokuLines(row, 21), row).toHaveLength(1);
    }
  });

  test("TW-11/UI-52（M19 D-1）迷宮の入口の確認 { gateAsk }: 見出しは「{name}へ潜るか？」、答えは 潜る（入口の行と同じ canEnter で dim）/ やめる（迷宮の一覧へ）。語りは入口の行が持つ description", () => {
    const cancel: TownEntry = { kind: "back", label: S["common.cancel"]! };
    const m = menuOf(town());
    const page: TownPage = { gateAsk: "d01" };
    expect(townHeadingText(page, m, S)).toBe("試しの坑道へ潜るか？");
    expect(townHeading(page)).toBe("town.ask.gateConfirm");
    expect(townEntries(page, m, S)).toEqual([{ kind: "enterYes", dungeonId: "d01", label: "潜る", disabled: false }, cancel]);
    expect(townParent(page)).toBe("gate");
    expect(townPageIntro(page, m)).toEqual([]);
    expect(townFacility(page)).toBe("gate");
    expect(townPlace(page)).toBe("town.place.gate");
    expect(townRepair(page, m)).toBe(page);
    // 開いていない迷宮の確認の段は迷宮の一覧へ直し、見出しは名前の無い問い
    expect(townRepair({ gateAsk: "d02" }, m)).toBe("gate");
    expect(townHeadingText({ gateAsk: "d02" }, m, S)).toBe(S["town.ask.gateConfirm"]);
    // 行動可能な者がいなければ「潜る」も dim
    const allDead = town(Object.fromEntries(["c1", "c2", "c3", "c4", "c5", "c6"].map((id) => [id, { life: "dead" as const, hp: 0 }])));
    expect(townEntries(page, menuOf(allDead), S)[0]).toMatchObject({ kind: "enterYes", disabled: true });
    // 入口の行の description は dungeons.json の文
    const e = townEntries("gate", m, S)[0]!;
    expect(e.kind === "enter" ? e.description : null).toBe("冒険者の腕試しに使われる浅い坑道。最下層に門番がいる。");
  });

  test("TW-11/UI-52（M19 D-1）最悪の値: 全迷宮の入口の行は一覧の行の幅（39 単位）、確認の問いは見出しの 1 行（全角 28 字）、description は会話の箱の 28 字 × 2 行、潜るは全角 4 字", () => {
    for (const d of data.dungeons) {
      const row = formatMessage(S["town.gate.row"]!, { name: d.name, floors: 99 });
      expect(row).not.toContain("{");
      expect(textUnits(row), row).toBeLessThanOrEqual(39);
      const ask = formatMessage(S["town.gate.ask"]!, { name: d.name });
      expect(kinsokuLines(ask, 28), ask).toHaveLength(1);
      expect(kinsokuLines(d.description, 28).length, d.id).toBeLessThanOrEqual(2);
    }
    expect(Array.from(S["town.gate.enterYes"]!).length).toBeLessThanOrEqual(4);
  });

  test("UI-52/DG-35/TW-11 迷宮の入口の準備中の行は town.gate.notReady のラベルで dim、押したときの理由の文 town.gate.notReadyReason を持つ（M9。M12 から合成データの d04）", () => {
    const s = town();
    s.progress.unlockedDungeons.push("d02", "d03", "d04");
    const m = townMenu(s, loadDataWithPlaceholder());
    if (m === null) throw new Error("not in town");
    const P = PLACEHOLDER_DUNGEON_NAME;
    const desc = (id: string): string => m.dungeons.find((x) => x.id === id)!.description;
    expect(townEntries("gate", m, S)).toEqual([
      { kind: "enter", dungeonId: "d01", label: "試しの坑道（全 2 階）", disabled: false, notReady: null, description: desc("d01") },
      { kind: "enter", dungeonId: "d02", label: "沈んだ聖堂（全 3 階）", disabled: false, notReady: null, description: desc("d02") },
      // M12: 実データの d03 は本物になったので普通の行
      { kind: "enter", dungeonId: "d03", label: "灰の地下墓所（全 4 階）", disabled: false, notReady: null, description: desc("d03") },
      // UI-52 / TW-11（M9 実機 B2）: 押したときに会話の箱へ出す理由の 1 文（準備中かは core の notReady）。準備中の行は階数を添えない（M19 D-1）
      { kind: "enter", dungeonId: "d04", label: `${P}（準備中）`, disabled: true, notReady: `${P}はまだ道が開いていない。`, description: desc("d04") },
      back,
    ]);
  });

  // M7 で店の最初に 買う / 売る / 買い戻す / 鑑定 / 倉庫 の一覧を置いた（ui.md UI-52 の M7）。旧「店は売り物の行」は買うのページ（shopBuy）に移した。
  // M17 で倉庫を銀行へ移した
  test("UI-52/TW-05/TW-16 店の最初の一覧は 買う・売る・買い戻す・鑑定・戻る（M17 で倉庫を銀行へ移した）。どれも dim にしない", () => {
    expect(townEntries("shop", menuOf(town({}, 0)), S)).toEqual([
      { kind: "page", to: "shopBuy", label: "買う" },
      { kind: "page", to: "shopSell", label: "売る" },
      { kind: "page", to: "shopBuyback", label: "買い戻す" },
      { kind: "page", to: "shopIdentify", label: "鑑定" },
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
      { kind: "buy", itemId: "herb", memberId: "c1", label: "アルド　空き 5 枠", disabled: false, reason: null, compare: null },
      { kind: "buy", itemId: "herb", memberId: "c2", label: "ベルク　空き 7 枠", disabled: false, reason: null, compare: null },
      { kind: "buy", itemId: "herb", memberId: "c4", label: "ドナ　空き 5 枠", disabled: false, reason: null, compare: null },
      { kind: "buy", itemId: "herb", memberId: "c5", label: "エル　空き 6 枠", disabled: false, reason: null, compare: null },
      { kind: "buy", itemId: "herb", memberId: "c6", label: "フィン　空き 0 枠", disabled: true, reason: null, compare: null },
      back,
    ]);
    // 払えない品（10G で帰還の糸 50G・長剣 100G）は全員 disabled。杖（10G）は空きのある 4 人が押せる
    expect(townEntries({ shop: "return_thread" }, m, S).filter((e) => e.kind === "buy").every((e) => e.kind === "buy" && e.disabled)).toBe(true);
    expect(townEntries({ shop: "long_sword" }, m, S).filter((e) => e.kind === "buy").every((e) => e.kind === "buy" && e.disabled)).toBe(true);
    expect(townEntries({ shop: "staff" }, m, S).filter((e) => e.kind === "buy" && !e.disabled).length).toBe(4);
    expect(townPageIntro({ shop: "herb" }, m)).toEqual([]);
    for (const k of ["town.shop.intro", "town.shop.whom", "town.shop.buyIntro", "town.shop.sellIntro", "town.shop.buybackIntro", "town.shop.identifyIntro", "town.bank.intro", "town.storage.whom"]) {
      expect(S[k], k).toBeDefined();
      expect(S[k], k).not.toContain("{");
    }
  });

  test("TW-05/UI-52 装備の品の持たせる者の行: core の canEquip に無い者（職業で装備できない者）は disabled で「（装備不可）」を添え、押したときの理由 reason を持つ。消耗品は添えない（M16・追補 H-4）", () => {
    // 初期のパーティ: c1 戦士・c2 戦士・c3 盗賊・c4 僧侶・c5 魔術師・c6 盗賊。長剣（戦士・侍・君主）は c1・c2 だけ
    const m = menuOf(town({}, 1000));
    const NG = S["town.shop.cannotEquip"]!;
    expect(NG).toBe("（装備不可）");
    const why = (name: string): string => `${name}は長剣を装備できない。WAR・SAM・LOR向けの品だ。`;
    expect(townEntries({ shop: "long_sword" }, m, S)).toEqual([
      { kind: "buy", itemId: "long_sword", memberId: "c1", label: "アルド　空き 5 枠", disabled: false, reason: null, compare: null },
      { kind: "buy", itemId: "long_sword", memberId: "c2", label: "ベルク　空き 7 枠", disabled: false, reason: null, compare: null },
      { kind: "buy", itemId: "long_sword", memberId: "c3", label: `${m.shop.members[2]!.name}　空き ${m.shop.members[2]!.slotsFree} 枠${NG}`, disabled: true, reason: why(m.shop.members[2]!.name), compare: null },
      { kind: "buy", itemId: "long_sword", memberId: "c4", label: "ドナ　空き 5 枠（装備不可）", disabled: true, reason: why("ドナ"), compare: null },
      { kind: "buy", itemId: "long_sword", memberId: "c5", label: "エル　空き 6 枠（装備不可）", disabled: true, reason: why("エル"), compare: null },
      { kind: "buy", itemId: "long_sword", memberId: "c6", label: `${m.shop.members[5]!.name}　空き ${m.shop.members[5]!.slotsFree} 枠${NG}`, disabled: true, reason: why(m.shop.members[5]!.name), compare: null },
      back,
    ]);
    // 誰でも装備できる杖・消耗品は添えない（reason も null）
    expect(townEntries({ shop: "staff" }, m, S).some((e) => e.kind === "buy" && (e.disabled || e.label.includes(NG) || e.reason !== null))).toBe(false);
    expect(townEntries({ shop: "herb" }, m, S).some((e) => e.kind === "buy" && (e.disabled || e.label.includes(NG) || e.reason !== null))).toBe(false);
    // 払えないときも、装備できない者の行は理由を持つ（押すと職業の理由を語る）。装備できる者は払えない dim で理由なし
    const poor = townEntries({ shop: "long_sword" }, menuOf(town({}, 10)), S).filter((e) => e.kind === "buy");
    expect(poor.every((e) => e.kind === "buy" && e.disabled)).toBe(true);
    expect(poor.map((e) => e.kind === "buy" && e.reason !== null)).toEqual([false, false, true, true, true, true]);
    // 行は一覧の幅（全角 21 字）に収まる（名前 6 字・空き 2 桁でも）
    expect(kinsokuLines(`ああああああ${formatMessage(S["town.shop.member"]!, { name: "", slots: 10 })}${NG}`, 21)).toHaveLength(1);
  });

  // M19（C-3）: 持たせる者の行の今の装備と印（app が core の shopEquipCompare を渡す）と、押したときの比較の文
  const comparesOf = (s: GameState, m: TownMenu, itemId: string): ShopEquipCompare[] => {
    const row = m.shop.equipment.find((r) => r.itemId === itemId)!;
    return m.shop.members.flatMap((x) => {
      const c = shopEquipCompare(s, data, x.memberId, itemId, row.level);
      return c === null ? [] : [c];
    });
  };

  test("TW-05/UI-52/UI-67 M19 C-3 装備の品の持たせる者の行は town.shop.memberCompare「{name}　{current}　{mark}」（今の装備の plainName か「なし」と core の verdict の印）。押すと語る比較の文は compare に持つ。装備できない者・空きの無い者・消耗品は今の行のまま", () => {
    const s = town({}, 1000);
    s.progress.shopLevel = 2;
    for (let i = 0; i < 5; i++) s.party[5]!.inventory.push(createItemInstance(s, { itemId: "herb", identified: true })); // c6 の空きを 0 に
    const m = menuOf(s);
    expect(S["equip.mark.better"]).toBe("▲");
    expect(S["equip.mark.worse"]).toBe("▼");
    expect(S["equip.mark.same"]).toBe("－");
    expect(S["equip.mark.mixed"]).toBe("±");
    const sword = townEntries({ shop: "long_sword" }, m, S, null, null, comparesOf(s, m, "long_sword"));
    expect(sword[0]).toEqual({ kind: "buy", itemId: "long_sword", memberId: "c1", label: "アルド　長剣　▲", disabled: false, reason: null, compare: ["長剣 1d8 → 長剣 +2 1d8+2"] });
    expect(sword[1]).toMatchObject({ memberId: "c2", label: "ベルク　長剣　▲", disabled: false });
    expect(sword[3]).toMatchObject({ memberId: "c4", label: "ドナ　空き 5 枠（装備不可）", disabled: true, compare: null });
    // 誰でも装備できる革兜: 兜の無い者は「なし」。空きの無い c6 は空きの行（dim の理由が見える）
    const cap = townEntries({ shop: "leather_cap" }, m, S, null, null, comparesOf(s, m, "leather_cap"));
    expect(cap[0]).toMatchObject({ memberId: "c1", label: "アルド　なし　▲", compare: ["なし AC 0 → 革兜 +2 AC -2"] });
    expect(cap[2]).toMatchObject({ memberId: "c3", label: `${m.shop.members[2]!.name}　革兜　▲` });
    expect(cap[5]).toMatchObject({ memberId: "c6", label: `${m.shop.members[5]!.name}　空き 0 枠`, disabled: true });
    // 良くなる行と悪くなる行がある（樫の杖を戦士に）は ±。主の行（武器は攻撃）の後に、ほかの変わる行を印つきで続ける
    const oak = townEntries({ shop: "oak_staff" }, m, S, null, null, comparesOf(s, m, "oak_staff"));
    expect(oak[0]).toMatchObject({ label: "アルド　長剣　±", compare: ["長剣 1d8 → 樫の杖 +2 1d6　魔法攻撃力 0 → 3 ▲"] });
    // 比較を渡さなければ（消耗品・他のページ）今の行のまま
    expect(townEntries({ shop: "herb" }, m, S, null, null, comparesOf(s, m, "long_sword"))[0]).toMatchObject({ label: "アルド　空き 5 枠", compare: null });
    expect(townEntries({ shop: "long_sword" }, m, S)[0]).toMatchObject({ label: "アルド　空き 5 枠", compare: null });
    // 文言はデータで差し替えられる
    const S2 = { ...S, "town.shop.memberCompare": "{mark}{name}/{current}", "town.shop.currentNone": "素手", "equip.mark.better": "上" };
    expect(townEntries({ shop: "leather_cap" }, m, S2, null, null, comparesOf(s, m, "leather_cap"))[0]).toMatchObject({ label: "上アルド/素手" });
  });

  test("TW-05/UI-52 M19 C-3 最悪の値（6 字の名前・最も長い今の装備の名前・大きい数）でも、持たせる者の行は一覧の行の幅（39 単位）に収まり（収まらなければ今の装備の名前を「…」で切る）、比較の文は会話の箱の 28 字 × 2 行に収まる", () => {
    const longest = (xs: string[]): string => xs.reduce((a, b) => (textUnits(b) > textUnits(a) ? b : a));
    const prefixes = ["fine", "rare", "legendary"].map((r) => S[`item.rarity.${r}`]!);
    const plain = longest([...data.uniques.map((u) => u.name), ...data.equipmentBases.map((b) => b.name)].flatMap((n) => prefixes.map((p) => p + n)));
    const shopName = longest(data.equipmentBases.map((b) => b.name + formatMessage(S["item.plus"]!, { n: 6 })));
    const line = <T,>(from: T, to: T, verdict: EquipVerdict) => ({ from, to, changed: true, verdict });
    const base: ShopEquipCompare = {
      memberId: "c1",
      slot: "armor",
      current: { plainName: plain, name: plain + formatMessage(S["item.plus"]!, { n: 10 }) },
      ac: line(-20, -20, "better"),
      attack: line("2d10+20", "2d10+20", "worse"),
      magicPower: line(12, 12, "better"),
      currentOptions: [],
      verdict: "mixed",
    };
    for (const verdict of ["better", "worse", "same", "mixed"] as const) {
      const label = shopMemberCompareLabel("ああああああ", { ...base, verdict }, S);
      expect(textUnits(label), label).toBeLessThanOrEqual(39);
      expect(label.endsWith(S[`equip.mark.${verdict}`]!), label).toBe(true);
    }
    expect(shopMemberCompareLabel("ああああああ", base, S)).toContain(S["town.band.ellipsis"]!);
    // 短い名前は切らない
    expect(shopMemberCompareLabel("アルド", { ...base, current: { plainName: "長剣", name: "長剣" } }, S)).toBe("アルド　長剣　±");
    const menu = { shop: { equipment: [{ itemId: "x", name: shopName }] } } as unknown as TownMenu;
    for (const slot of ["armor", "weapon"] as const) {
      const texts = shopCompareText("x", { ...base, slot }, menu, S);
      expect(texts).toHaveLength(1);
      expect(kinsokuLines(texts[0]!, 28).length, texts[0]).toBeLessThanOrEqual(2);
    }
    expect(shopCompareText("x", { ...base, slot: "weapon" }, menu, S)).toEqual([
      `${base.current!.name} 2d10+20 → ${shopName} 2d10+20　AC -20 → -20 ▲　魔法攻撃力 12 → 12 ▲`,
    ]);
    // M20 B-2: 今の装備のオプション（伝説の 3 個。最も長い名前・最も大きい値）は、見出しの 1 文と 1 文に 1 行ずつ。どれも 28 字 × 2 行に収まる
    const opt = data.itemOptions.options.reduce((a, b) => (textUnits(b.name + b.unit) > textUnits(a.name + a.unit) ? b : a));
    const big = Math.max(...data.itemOptions.options.flatMap((o) => o.values));
    const options = [1, 2, 3].map(() => ({ name: opt.name, value: -big, unit: opt.unit, bad: true }));
    const withOpts = shopCompareText("x", { ...base, slot: "weapon", currentOptions: options }, menu, S);
    expect(withOpts).toHaveLength(5);
    expect(withOpts[1]).toBe(`${base.current!.name}のオプション（${shopName}はなし）`);
    for (const text of withOpts) expect(kinsokuLines(text, 28).length, text).toBeLessThanOrEqual(2);
  });

  test("TW-05/UI-52 M20 B-2 今の装備にオプションがあれば、比較の文の後に town.shop.compareOpt「{current}のオプション（{item}はなし）」とオプションを 1 文に 1 行ずつ（item.option.row。品の詳細と同じ文）。未鑑定の今の装備は出さない", () => {
    const s = town({}, 1000);
    s.progress.shopLevel = 2;
    const opts = [
      { optionId: "mp_max", tier: 2 as const, value: 4 },
      { optionId: "str", tier: 1 as const, value: -1 },
    ];
    s.party[0]!.equipment.weapon = createItemInstance(s, { itemId: "long_sword", level: 1, rarity: "rare", options: opts, identified: true });
    const m = menuOf(s);
    const row = townEntries({ shop: "long_sword" }, m, S, null, null, comparesOf(s, m, "long_sword"))[0]!;
    expect(row).toMatchObject({ label: "アルド　希少な長剣　▲", compare: ["希少な長剣 +1 1d8+1 → 長剣 +2 1d8+2", "希少な長剣 +1のオプション（長剣 +2はなし）", "最大MP +4", "力 -1"] });
    // 文言はデータで差し替えられる
    const S2 = { ...S, "town.shop.compareOpt": "{current}/{item}", "item.option.row": "{name}={value}" };
    expect(townEntries({ shop: "long_sword" }, m, S2, null, null, comparesOf(s, m, "long_sword"))[0]).toMatchObject({
      compare: ["希少な長剣 +1 1d8+1 → 長剣 +2 1d8+2", "希少な長剣 +1/長剣 +2", "最大MP=+4", "力=-1"],
    });
    // 未鑑定の今の装備はオプションを見せない（比較の文だけ）
    s.items[s.party[0]!.equipment.weapon!]!.identified = false;
    const hidden = townEntries({ shop: "long_sword" }, menuOf(s), S, null, null, comparesOf(s, menuOf(s), "long_sword"))[0]!;
    expect(hidden.kind === "buy" ? hidden.compare : null).toHaveLength(1);
  });

  test("TW-05 M20 B-2 townFreshBlock: ひと続きの語りは、先頭の文が直近（recent）にあればまとめて省き、無ければ全部出す（オプションの行だけが他の者と同じでも省かない）", () => {
    const block = ["比較", "見出し", "命中 +2"];
    expect(townFreshBlock(block, [])).toEqual(block);
    expect(townFreshBlock(block, block)).toEqual([]);
    expect(townFreshBlock(block, ["別の者の比較", "見出し", "命中 +2"])).toEqual(block);
    expect(townFreshBlock([], ["x"])).toEqual([]);
    expect(townFreshBlock(block, [])).not.toBe(block);
  });

  test("TW-17/UI-52 M20 B-2 触媒の行は押したときに語る性能の 1 文 town.upgrade.catInfo「{item}: 攻撃 … / AC … / 魔法攻撃力 …」を info に持つ（core の power。該当しない項目は —）。最悪の値（最も長い接頭辞 + 名前・Lv20）でも 28 字 × 2 行", () => {
    const s = town();
    const mail = createItemInstance(s, { itemId: "chain_mail", level: 4, identified: true });
    const oak = createItemInstance(s, { itemId: "oak_staff", level: 2, rarity: "fine", identified: true });
    s.party[0]!.inventory.push(mail, oak);
    const m = menuOf(s);
    const sel = { memberId: "c1", slot: "weapon" as const, picked: [] as UpgradeCatalystRef[] };
    const rows = townEntries({ upCat: sel }, m, S).filter((e) => e.kind === "upPick");
    expect(rows.map((e) => (e.kind === "upPick" ? e.info : ""))).toEqual(["鎖帷子 +4: 攻撃 — / AC -6 / 魔法攻撃力 —", "上質な樫の杖 +2: 攻撃 1d6 / AC — / 魔法攻撃力 3"]);
    // 選んだ後の行（●）も同じ文
    const on = townEntries({ upCat: { ...sel, picked: [{ memberId: "c1", instanceId: mail }] } }, m, S).find((e) => e.kind === "upPick")!;
    expect(on.kind === "upPick" ? on.info : "").toBe("鎖帷子 +4: 攻撃 — / AC -6 / 魔法攻撃力 —");
    // 文言はデータで差し替えられる
    const c = m.upgrade.members[0]!.catalysts[0]!;
    expect(upgradeCatalystInfo(c, { ...S, "town.upgrade.catInfo": "{item}|{attack}|{ac}|{magic}", "town.shop.previewNone": "x" })).toBe("鎖帷子 +4|x|-6|x");
    // 最悪の値
    const prefixes = ["fine", "rare", "legendary"].map((r) => S[`item.rarity.${r}`]!);
    const longest = (xs: string[]): string => xs.reduce((a, b) => (textUnits(b) > textUnits(a) ? b : a));
    const plain = longest(data.equipmentBases.flatMap((b) => prefixes.map((p) => p + b.name)));
    const worst = upgradeCatalystInfo({ ...c, plainName: plain, level: 20, power: { attack: "10d10+20", ac: -20, magicPower: 20 } }, S);
    expect(kinsokuLines(worst, 28).length, worst).toBeLessThanOrEqual(2);
  });

  test("TW-05 品の性能の 1 文 shopPreviewText は core の preview を並べるだけ（該当しない項目は —、誰でもは「誰でも」）。どの流通レベルのどの品も 28 字 × 2 行以内（M16）", () => {
    const s = town({}, 0);
    expect(shopPreviewText("long_sword", menuOf(s), S)).toBe("長剣: 攻撃 1d8 / AC — / 魔法攻撃力 — / 装備: WAR・SAM・LOR");
    expect(shopPreviewText("leather_armor", menuOf(s), S)).toBe("革鎧: 攻撃 — / AC -2 / 魔法攻撃力 — / 装備: 誰でも");
    expect(shopPreviewText("herb", menuOf(s), S)).toBeNull();
    s.progress.shopLevel = 2;
    expect(shopPreviewText("staff", menuOf(s), S)).toBe("杖 +2: 攻撃 1d4 / AC — / 魔法攻撃力 2 / 装備: 誰でも");
    // strings を差し替えれば文も変わる（表示層に文を書かない）
    expect(shopPreviewText("staff", menuOf(s), { ...S, "town.shop.preview": "{name} Lv{level} {magic}" })).toBe("杖 +2 Lv2 2");
    for (let lv = 0; lv <= 6; lv++) {
      s.progress.shopLevel = lv;
      const m = menuOf(s);
      for (const e of m.shop.equipment) {
        const text = shopPreviewText(e.itemId, m, S)!;
        expect(kinsokuLines(text, 28).length, text).toBeLessThanOrEqual(2);
      }
    }
  });

  test("UI-59/IT-65/CH-77（M18）鑑定の結果の性能の 1 文 town.shop.identifiedPower / camp.identifiedPower: core の params を埋めるだけ。どのベース・ユニークの伝説・Lv20 でも 28 字 × 2 行以内", () => {
    expect(S["town.shop.identifiedPower"]).toBe("{item}: 攻撃 {attack} / AC {ac} / 魔法攻撃力 {magic}");
    expect(S["camp.identifiedPower"]).toBe(S["town.shop.identifiedPower"]);
    // core が該当しない項目に入れる記号は店の下見の「—」と同じ
    expect(POWER_NONE).toBe(S["town.shop.previewNone"]);
    const s = town({}, 0);
    const ids = [
      ...data.equipmentBases.map((b) => createItemInstance(s, { itemId: b.id, level: 20, rarity: "legendary", identified: true })),
      ...data.uniques.map((u) => createItemInstance(s, { itemId: u.base, uniqueId: u.id, rarity: "legendary", identified: true })),
    ];
    for (const id of ids) {
      const params = identifiedPowerParams(s, data, id, itemDisplayName(s, data, id))!;
      for (const key of ["town.shop.identifiedPower", "camp.identifiedPower"]) {
        const text = formatMessage(S[key]!, params);
        expect(text, text).not.toMatch(/\{/);
        expect(kinsokuLines(text, 28).length, text).toBeLessThanOrEqual(2);
      }
    }
  });

  test("IT-65/CH-77 M20（D-7）鑑定の結果のオプションの行 item.option.found「オプション: {name} {value}{unit}」/ foundBad（末尾に「（呪い）」）は、どのオプションの最大の値（正負）でも会話の箱の 1 行（28 字）に収まる", () => {
    expect(S["item.option.found"]).toBe("オプション: {name} {value}{unit}");
    expect(S["item.option.foundBad"]).toBe("オプション: {name} {value}{unit}（呪い）");
    expect(formatMessage(S["item.option.foundBad"]!, { name: "力", value: "-2", unit: "" })).toBe("オプション: 力 -2（呪い）");
    for (const o of data.itemOptions.options) {
      const top = Math.max(...o.values);
      for (const [key, value] of [["item.option.found", `+${top}`], ["item.option.foundBad", `-${top}`]] as const) {
        const text = formatMessage(S[key]!, { name: o.name, value, unit: o.unit });
        expect(kinsokuLines(text, 28), text).toHaveLength(1);
      }
    }
  });

  test("IT-65/IT-61/CH-77（M19）鑑定の結果の 2 文目 town.shop.identifiedValue / camp.identifiedValue「希少度 {rarity}　売値 {gold}G」: core の params を埋めるだけ。どのベースの伝説・Lv20・tier 3 のオプション 3 つ、どのユニーク、どの消耗品・魔法書でも 28 字 × 2 行以内", () => {
    expect(S["town.shop.identifiedValue"]).toBe("希少度 {rarity}　売値 {gold}G");
    expect(S["camp.identifiedValue"]).toBe(S["town.shop.identifiedValue"]);
    const s = town({}, 0);
    const opts = [1, 2, 3].map(() => ({ optionId: "str", tier: 3 as const, value: 3 }));
    const ids = [
      ...data.equipmentBases.map((b) => createItemInstance(s, { itemId: b.id, level: 20, rarity: "legendary", options: opts, identified: true })),
      ...data.uniques.map((u) => createItemInstance(s, { itemId: u.base, uniqueId: u.id, rarity: "legendary", identified: true })),
      ...data.items.map((it) => createItemInstance(s, { itemId: it.id, identified: true })),
    ];
    // 例: 伝説の長剣 +3（floor(100 × 0.5 × 2.5) = 125G）
    const sword = createItemInstance(s, { itemId: "long_sword", level: 3, rarity: "legendary", identified: true });
    expect(formatMessage(S["town.shop.identifiedValue"]!, identifiedValueParams(s, data, sword))).toBe("希少度 伝説　売値 125G");
    for (const id of ids) {
      const params = identifiedValueParams(s, data, id);
      for (const key of ["town.shop.identifiedValue", "camp.identifiedValue"]) {
        const text = formatMessage(S[key]!, params);
        expect(text, text).not.toMatch(/\{/);
        expect(kinsokuLines(text, 28).length, text).toBeLessThanOrEqual(2);
      }
    }
    // 文言はデータで差し替えられる（表示層は params を埋めるだけ）
    expect(formatMessage("{rarity}/{gold}", identifiedValueParams(s, data, sword))).toBe("伝説/125");
  });

  test("TW-17 M18（3-3）/ M21（B-1）確認の段の前後の 1 文 upgradePreviewText「成功すれば +{before} → +{after} になる。」は core の upgradePreview の level / resultLevel・kind・before / after を埋めるだけ（装飾・preview なしは null）。どのベースの Lv20 → Lv99 でも 28 字 × 2 行以内", () => {
    expect(S["town.upgrade.preview"]).toBe("成功すれば +{before} → +{after} になる。");
    expect([S["town.upgrade.kind.attack"], S["town.upgrade.kind.ac"], S["town.upgrade.kind.magic"]]).toEqual(["攻撃", "AC", "魔法攻撃力"]);
    const s = town({}, 0);
    const c1 = s.party[0]!;
    s.items[c1.equipment.weapon!]!.level = 1;
    expect(upgradePreviewText(upgradePreview(s, data, "c1", "weapon", []), S)).toBe("成功すれば +1 → +2 になる。");
    // M21（B-1）: 触媒の Lv の最小値が上なら結果の Lv はそこまで（Lv1 + 触媒 Lv5 → +5）
    const cat5 = createItemInstance(s, { itemId: "long_sword", level: 5, identified: true });
    c1.inventory.push(cat5);
    expect(upgradePreviewText(upgradePreview(s, data, "c1", "weapon", [{ memberId: "c1", instanceId: cat5 }]), S)).toBe("成功すれば +1 → +5 になる。");
    s.items[c1.equipment.armor!]!.level = 1;
    expect(upgradePreviewText(upgradePreview(s, data, "c1", "armor", []), S)).toBe("成功すれば +1 → +2 になる。");
    const staff = createItemInstance(s, { itemId: "oak_staff", level: 2, identified: true });
    c1.equipment.weapon = staff;
    expect(upgradePreviewText(upgradePreview(s, data, "c1", "weapon", []), S)).toBe("成功すれば +2 → +3 になる。");
    const charm = createItemInstance(s, { itemId: "charm", level: 0, identified: true });
    c1.equipment.accessory = charm;
    expect(upgradePreviewText(upgradePreview(s, data, "c1", "accessory", []), S)).toBeNull();
    expect(upgradePreviewText(null, S)).toBeNull();
    // 最悪の値: どのベースも Lv20 に触媒 Lv99 で +20 → +99（装飾は語らない）
    let n = 0;
    const cat99 = createItemInstance(s, { itemId: "long_sword", level: 99, identified: true });
    c1.inventory.push(cat99);
    for (const b of data.equipmentBases) {
      const id = createItemInstance(s, { itemId: b.id, level: 20, rarity: "legendary", identified: true });
      c1.equipment[b.slot] = id;
      const text = upgradePreviewText(upgradePreview(s, data, "c1", b.slot, [{ memberId: "c1", instanceId: cat99 }]), S);
      if (b.slot === "accessory") {
        expect(text, b.id).toBeNull();
        continue;
      }
      n++;
      expect(text, b.id).not.toBeNull();
      expect(text!, text!).not.toMatch(/\{/);
      expect(kinsokuLines(text!, 28).length, text!).toBeLessThanOrEqual(2);
    }
    expect(n).toBeGreaterThan(0);
  });

  test("TW-17 M22（D-4）確認の段の箱は予告と問いを 1 回の語り（upgradeConfirmSay）で続けて出す。見出しは問いのまま。どのベースの Lv0〜20 でも 28 字 × 2 行以内", () => {
    const s = town({}, 0);
    const c1 = s.party[0]!;
    const m = menuOf(s);
    const sel = { slot: "weapon" as const, memberId: "c1", picked: [] };
    const p = upgradePreview(s, data, "c1", "weapon", [])!;
    const say = upgradeConfirmSay({ upConfirm: sel }, p, m, S)!;
    expect(say).toBe(upgradePreviewText(p, S)! + townHeadingText({ upConfirm: sel }, m, S, p));
    expect(say).toMatch(/^成功すれば \+\d+ → \+\d+ になる。/);
    expect(say).toContain("料金");
    expect(upgradeConfirmSay({ upConfirm: sel }, null, m, S)).toBeNull();
    for (const b of data.equipmentBases) {
      if (b.slot === "accessory") continue;
      for (let lv = 0; lv <= 20; lv++) {
        c1.equipment[b.slot] = createItemInstance(s, { itemId: b.id, level: lv, rarity: "legendary", identified: true });
        const pp = upgradePreview(s, data, "c1", b.slot, [])!;
        const text = upgradeConfirmSay({ upConfirm: { ...sel, slot: b.slot as typeof sel.slot } }, pp, m, S)!;
        expect(kinsokuLines(text, 28).length, text).toBeLessThanOrEqual(2);
      }
    }
  });

  test("TW-17 M18（5-13）/ M21（B-1）前後が同じ値のときは upgradePreviewText が town.upgrade.previewSame「成功すれば +{before} → +{after} になる。{kind}は変わらない（+{n} で {next}）。」（core の level / resultLevel と nextChangeAt の level・value を埋めるだけ）。どのベースの Lv0〜20 でも 28 字 × 2 行以内", () => {
    expect(S["town.upgrade.previewSame"]).toBe("成功すれば +{before} → +{after} になる。{kind}は変わらない（+{n} で {next}）。");
    const s = town({}, 0);
    const c1 = s.party[0]!;
    s.items[c1.equipment.armor!]!.level = 0;
    expect(upgradePreviewText(upgradePreview(s, data, "c1", "armor", []), S)).toBe("成功すれば +0 → +1 になる。ACは変わらない（+2 で -3）。");
    s.items[c1.equipment.armor!]!.level = 1;
    expect(upgradePreviewText(upgradePreview(s, data, "c1", "armor", []), S)).toBe("成功すれば +1 → +2 になる。");
    // 表示層は値を比べない: nextChangeAt があればその値で語る（除数 3 の Lv0 → +3）
    const d3 = { ...data, config: { ...data.config, items: { ...data.config.items, armorLvPerAc: 3 } } };
    s.items[c1.equipment.armor!]!.level = 0;
    expect(upgradePreviewText(upgradePreview(s, d3, "c1", "armor", []), S)).toBe("成功すれば +0 → +1 になる。ACは変わらない（+3 で -3）。");
    // n は次に値が変わる Lv（nextChangeAt.level）。Lv1 の革鎧（除数 3）も +3 で -3
    s.items[c1.equipment.armor!]!.level = 1;
    expect(upgradePreviewText(upgradePreview(s, d3, "c1", "armor", []), S)).toBe("成功すれば +1 → +2 になる。ACは変わらない（+3 で -3）。");
    // 最悪の値: どのベースの Lv0〜20 でも、同じ値のときは previewSame、28 字 × 2 行以内（大きい除数 9 も見る）
    const d9 = { ...data, config: { ...data.config, items: { ...data.config.items, weaponLvPerDamage: 9, armorLvPerAc: 9, casterLvPerPower: 9 } } };
    let same = 0;
    for (const dd of [data, d9]) {
      for (const b of data.equipmentBases) {
        if (b.slot === "accessory") continue;
        for (let lv = 0; lv <= 20; lv++) {
          const id = createItemInstance(s, { itemId: b.id, level: lv, rarity: "legendary", identified: true });
          c1.equipment[b.slot] = id;
          const p = upgradePreview(s, dd, "c1", b.slot, [])!;
          const text = upgradePreviewText(p, S)!;
          expect(text, b.id).not.toBeNull();
          expect(text, text).not.toMatch(/\{/);
          if (p.nextChangeAt !== null) {
            same++;
            expect(text).toMatch(/は変わらない（\+\d+ で /);
          }
          expect(kinsokuLines(text, 28).length, text).toBeLessThanOrEqual(2);
        }
      }
    }
    expect(same).toBeGreaterThan(0);
  });

  test("TW-05/UI-52 装備できない理由の 1 文 shopCannotEquipText は core の preview.classes をつなぐだけ（誰でも・消耗品は null）。名前 6 字・どの品・職業 6 つでも 28 字 × 2 行以内（M16 追補 H-4）", () => {
    const s = town({}, 0);
    expect(S["town.shop.cannotEquipWhy"]).toBe("{name}は{item}を装備できない。{classes}向けの品だ。");
    expect(shopCannotEquipText("long_sword", "ドナ", menuOf(s), S)).toBe("ドナは長剣を装備できない。WAR・SAM・LOR向けの品だ。");
    expect(shopCannotEquipText("leather_armor", "ドナ", menuOf(s), S)).toBeNull();
    expect(shopCannotEquipText("herb", "ドナ", menuOf(s), S)).toBeNull();
    // strings を差し替えれば文も変わる（表示層に文を書かない）
    expect(shopCannotEquipText("long_sword", "ドナ", menuOf(s), { ...S, "town.shop.cannotEquipWhy": "{classes}/{item}/{name}", "town.shop.classSep": "," })).toBe("WAR,SAM,LOR/長剣/ドナ");
    // 職業の最悪（誰でもでない最大の 6 つ = 7 職業 - 1）
    const worst = data.classes.slice(0, data.classes.length - 1).map((c) => c.abbr).join(S["town.shop.classSep"]!);
    for (let lv = 0; lv <= 6; lv++) {
      s.progress.shopLevel = lv;
      const m = menuOf(s);
      for (const e of m.shop.equipment) {
        const text = shopCannotEquipText(e.itemId, "ああああああ", m, S);
        if (text !== null) expect(kinsokuLines(text, 28).length, text).toBeLessThanOrEqual(2);
        const worstText = formatMessage(S["town.shop.cannotEquipWhy"]!, { name: "ああああああ", item: e.name, classes: worst });
        expect(kinsokuLines(worstText, 28).length, worstText).toBeLessThanOrEqual(2);
      }
    }
  });

  // M18（5-2）: 売る者の行に売値の計（「計 {gold}G」）を足した。品の行を押すと確認の段（{ sellAsk }）へ（下の M18 の describe）
  test("UI-52/IT-61 売るは全員（life を問わない）の行（名前と売れる品の数と売値の計。無ければ disabled）→ その者の売れる品（名前と売値）", () => {
    // 初期の所持品: c1 薬草・c2 なし・c3 薬草・c4 解毒草・c5 帰還の糸・c6 薬草（どれも鑑定済み）。c3 を dead にしても行は出る
    const s = town({ c3: { life: "dead", hp: 0 } });
    // c2 に 上質な長剣 +2（力 +1 の段階 1）と未鑑定の長剣（2026-10-05 から見た目の売値で売れるので数える）を持たせる
    const fine = createItemInstance(s, { itemId: "long_sword", level: 2, rarity: "fine", options: [{ optionId: "str", tier: 1, value: 1 }], identified: true });
    const unk = createItemInstance(s, { itemId: "long_sword", identified: false });
    s.party[1]!.inventory.push(fine, unk);
    const m = menuOf(s);
    expect(townEntries("shopSell", m, S)).toEqual([
      { kind: "pick", to: { sell: "c1" }, label: "アルド　1品　計 5G", disabled: false },
      { kind: "pick", to: { sell: "c2" }, label: "ベルク　2品　計 170G", disabled: false },
      { kind: "pick", to: { sell: "c3" }, label: "キリ　1品　計 5G", disabled: false },
      { kind: "pick", to: { sell: "c4" }, label: "ドナ　1品　計 7G", disabled: false },
      { kind: "pick", to: { sell: "c5" }, label: "エル　1品　計 25G", disabled: false },
      { kind: "pick", to: { sell: "c6" }, label: "フィン　1品　計 5G", disabled: false },
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
    expect(townEntries("shopSell", menuOf(bare), S)[1]).toEqual({ kind: "pick", to: { sell: "c2" }, label: "ベルク　0品　計 0G", disabled: true });
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
      { kind: "buyback", memberId: "c1", instanceId: twin, label: "アルド　空き 5 枠", disabled: false },
      { kind: "buyback", memberId: "c2", instanceId: twin, label: "ベルク　空き 7 枠", disabled: false },
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

  test("UI-52/TW-10/TW-16/TW-16b（M17）銀行は 金を預ける・金を引き出す・品を預ける・品を引き出す（数と容量）・すべて預ける・戻る。語りは town.bank.intro、戻るは施設メニュー", () => {
    const s = town({}, 300);
    const kept = createItemInstance(s, { itemId: "long_sword", identified: false });
    s.warehouse.push(kept);
    const m = menuOf(s);
    const cap = data.config.items.warehouseSlots;
    expect(townEntries("bank", m, S)).toEqual([
      { kind: "page", to: "bankDeposit", label: "金を預ける" },
      { kind: "page", to: "bankWithdraw", label: "金を引き出す" },
      { kind: "page", to: "storageDeposit", label: "品を預ける" },
      { kind: "page", to: "storageWithdraw", label: `品を引き出す　1/${cap}` },
      { kind: "depositAll", memberId: null, label: "すべて預ける", disabled: false },
      { kind: "camp", open: "status", host: "bank", label: "状態（倉庫から装備）" }, // TW-16c（M21 A-2）
      back,
    ]);
    expect(townPageIntro("bank", m)).toEqual(["town.bank.intro"]);
    expect(S["town.bank.intro"]).toBe("帳場の奥に金庫と倉庫。預けた物は一行が倒れても残る。");
    expect(townParent("bank")).toBe("menu");
    for (const p of ["bankDeposit", "bankWithdraw", "storageDeposit", "storageWithdraw"] as const) expect(townParent(p)).toBe("bank");
    // すべて預ける（全員）の dim は core の depositAllOk: 誰も品を持たない・倉庫が満杯なら dim
    const none = town();
    for (const c of none.party) c.inventory = [];
    expect(menuOf(none).storage.depositAllOk).toBe(false);
    expect(townEntries("bank", menuOf(none), S).find((e) => e.kind === "depositAll")).toEqual({ kind: "depositAll", memberId: null, label: "すべて預ける", disabled: true });
    const full = cloneState(s);
    for (let i = full.warehouse.length; i < cap; i++) full.warehouse.push(createItemInstance(full, { itemId: "herb", identified: true }));
    expect(townEntries("bank", menuOf(full), S).find((e) => e.kind === "depositAll")).toMatchObject({ disabled: true });
  });

  test("UI-52/TW-10（M17）金の額の段: core の townMenu.bank の行（全額 → 半分 → config.bank.amounts）。town.bank に送る額は預入が正・引出が負。ok でなければ dim", () => {
    expect(data.config.bank.amounts).toEqual([100, 1000]);
    const s = town({}, 301);
    s.bank = 1500;
    const m = menuOf(s);
    expect(townEntries("bankDeposit", m, S)).toEqual([
      { kind: "bank", amount: 301, label: "全額（301G）", disabled: false },
      { kind: "bank", amount: 150, label: "半分（150G）", disabled: false },
      { kind: "bank", amount: 100, label: "100G", disabled: false },
      { kind: "bank", amount: 1000, label: "1000G", disabled: true },
      back,
    ]);
    expect(townEntries("bankWithdraw", m, S)).toEqual([
      { kind: "bank", amount: -1500, label: "全額（1500G）", disabled: false },
      { kind: "bank", amount: -750, label: "半分（750G）", disabled: false },
      { kind: "bank", amount: -100, label: "100G", disabled: false },
      { kind: "bank", amount: -1000, label: "1000G", disabled: false },
      back,
    ]);
    // 預金 0 なら引き出しの行は全部 dim（全額・半分は 0G）
    const poor = menuOf(town({}, 0));
    expect(townEntries("bankWithdraw", poor, S).map((e) => (e.kind === "bank" ? [e.label, e.disabled] : e.kind))).toEqual([
      ["全額（0G）", true],
      ["半分（0G）", true],
      ["100G", true],
      ["1000G", true],
      "back",
    ]);
    expect(townEntries("bankDeposit", poor, S).every((e) => e.kind !== "bank" || e.disabled)).toBe(true);
    // 送った額は core がそのまま受け付ける（dim でない行の amount は checkBank を通る）
    for (const e of townEntries("bankDeposit", m, S)) if (e.kind === "bank" && !e.disabled) expect(execute(s, { type: "town.bank", amount: e.amount }, data).events[0]).toMatchObject({ key: "town.bank.deposited" });
    for (const e of townEntries("bankWithdraw", m, S)) if (e.kind === "bank" && !e.disabled) expect(execute(s, { type: "town.bank", amount: e.amount }, data).events[0]).toMatchObject({ key: "town.bank.withdrawn" });
    expect(townPageIntro("bankDeposit", m)).toEqual([]);
    // 行は一覧の行の文字の幅（39 単位）に収まる（7 桁の額でも）
    for (const k of ["town.bank.all", "town.bank.half", "town.bank.amountRow"]) expect(textUnits(formatMessage(S[k]!, { amount: 9999999 })), k).toBeLessThanOrEqual(39);
  });

  test("CH-71b/TW-10/TW-16b（M17 レビュー）新しい語りは最悪の値（6 字の名前・最も長い品名・7 桁の額・3 桁の数）でも会話の箱の 2 行（全角 28 字）に収まり、銀行の一覧の行は行の幅（39 単位）に収まる", () => {
    const longest = (xs: string[]): string => [...xs].sort((a, b) => textUnits(b) - textUnits(a))[0]!;
    const rarities = ["fine", "rare", "legendary"].map((r) => S[`item.rarity.${r}`]!);
    const prefix = longest(rarities);
    const item = longest([
      ...data.items.flatMap((it) => [it.name, it.unidentifiedName ?? it.name]),
      ...data.equipmentBases.flatMap((b) => [b.unidentifiedName, `${prefix}${b.name}${formatMessage(S["item.plus"]!, { n: 12 })}`]),
      ...data.uniques.map((u) => `${prefix}${u.name}`),
    ]);
    const name = "ろくもじのな";
    const said: [string, Record<string, string | number>][] = [
      ["town.storage.autoDeposited", { name, item }],
      ["inventory.overflow", { name, over: 999 }],
      ["town.storage.depositedAll", { name, count: 999 }],
      ["town.storage.fullStopped", { left: 999 }],
      ["town.bank.deposited", { amount: 9999999, bank: 9999999 }],
      ["town.bank.withdrawn", { amount: 9999999, gold: 9999999 }],
    ];
    for (const [k, p] of said) {
      const text = formatMessage(S[k]!, p);
      expect(text, k).not.toContain("{");
      expect(kinsokuLines(text, 28).length, `${k}: ${text}`).toBeLessThanOrEqual(2);
    }
    expect(kinsokuLines(S["town.bank.intro"]!, 28).length).toBeLessThanOrEqual(2);
    const rows = [
      formatMessage(S["town.storage.depositAllOne"]!, { count: 999 }),
      formatMessage(S["town.storage.menu.withdraw"]!, { count: 999, capacity: 999 }),
      S["town.bank.menu.deposit"]!,
      S["town.bank.menu.withdraw"]!,
      S["town.storage.menu.depositAll"]!,
    ];
    for (const r of rows) {
      expect(r).not.toContain("{");
      expect(textUnits(r), r).toBeLessThanOrEqual(39);
    }
  });

  test("UI-52/TW-16/TW-16b 品を預けるは者（品の無い者は disabled）→ 品（先頭に「この者の物をすべて預ける」）。品を引き出すは品 → 受け取る者（空きが無ければ disabled）", () => {
    const s = town({ c3: { life: "dead", hp: 0 } });
    const kept = createItemInstance(s, { itemId: "long_sword", identified: false });
    s.warehouse.push(kept);
    for (let i = 0; i < 5; i++) s.party[5]!.inventory.push(createItemInstance(s, { itemId: "herb", identified: true }));
    const m = menuOf(s);
    const cap = data.config.items.warehouseSlots;
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
    expect(townEntries({ deposit: "c1" }, m, S)).toEqual([
      { kind: "depositAll", memberId: "c1", label: "この者の物をすべて預ける（1品）", disabled: false },
      { kind: "deposit", memberId: "c1", instanceId: herb, label: "薬草", disabled: false },
      back,
    ]);
    expect(townEntries({ deposit: "c6" }, m, S)[0]).toEqual({ kind: "depositAll", memberId: "c6", label: "この者の物をすべて預ける（6品）", disabled: false });
    expect(townEntries({ deposit: "c2" }, m, S)).toEqual([
      { kind: "depositAll", memberId: "c2", label: "この者の物をすべて預ける（0品）", disabled: true },
      { kind: "empty", label: "預ける物がない", disabled: true },
      back,
    ]);
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
    expect(townEntries({ deposit: "c1" }, menuOf(full), S)).toEqual([
      { kind: "depositAll", memberId: "c1", label: "この者の物をすべて預ける（1品）", disabled: true },
      { kind: "deposit", memberId: "c1", instanceId: herb, label: "薬草", disabled: true },
      back,
    ]);
    expect(townEntries("storageWithdraw", menuOf(town()), S)).toEqual([{ kind: "empty", label: "倉庫は空だ", disabled: true }, back]);
    expect(townParent("storageDeposit")).toBe("bank");
    expect(townParent({ deposit: "c1" })).toBe("storageDeposit");
    expect(townParent({ withdraw: kept })).toBe("storageWithdraw");
    expect(townPageIntro({ withdraw: kept }, m)).toEqual([]);
  });

  test("UI-52/TW-05/TW-16/CH-71 店と倉庫の「空き n 枠」は slotsMaxOf に追従する（M17。力 11 → 8、12 → 9、16 → 10）", () => {
    const bare = { weapon: null, armor: null, shield: null, helm: null, gauntlet: null, accessory: null };
    const s = town({}, 300);
    for (const [i, str] of [11, 12, 16, 16, 18, 3].entries()) {
      const ch = s.party[i]!;
      s.party[i] = { ...ch, stats: { ...ch.stats, str }, equipment: { ...bare }, inventory: [] };
    }
    // c4（力 16）に 10 品を持たせて満杯にする
    for (let i = 0; i < 10; i++) s.party[3]!.inventory.push(createItemInstance(s, { itemId: "herb", identified: true }));
    const kept = createItemInstance(s, { itemId: "herb", identified: true });
    s.warehouse.push(kept);
    const m = menuOf(s);
    const free = [
      ["c1", "アルド　空き 8 枠", false],
      ["c2", "ベルク　空き 9 枠", false],
      ["c3", "キリ　空き 10 枠", false],
      ["c4", "ドナ　空き 0 枠", true],
      ["c5", "エル　空き 10 枠", false],
      ["c6", "フィン　空き 8 枠", false],
    ] as const;
    expect(townEntries({ shop: "herb" }, m, S).flatMap((e) => (e.kind === "buy" ? [[e.memberId, e.label, e.disabled]] : []))).toEqual(free);
    expect(townEntries({ withdraw: kept }, m, S).flatMap((e) => (e.kind === "withdraw" ? [[e.memberId, e.label, e.disabled]] : []))).toEqual(free);
    // 空きの数のとおりに買える: c2（力 12）は 9 品目まで受け付け、10 品目は inventory full
    let t = cloneState(s);
    t.gold = 1000;
    for (let i = 0; i < 9; i++) {
      const r = execute(t, { type: "town.shop", action: { kind: "buy", itemId: "herb", memberId: "c2" } }, data);
      expect(r.events.some((e) => e.kind === "rejected"), `buy ${i}`).toBe(false);
      t = r.state;
    }
    expect(townEntries({ shop: "herb" }, menuOf(t), S).find((e) => e.kind === "buy" && e.memberId === "c2")).toMatchObject({ label: "ベルク　空き 0 枠", disabled: true });
    expect(execute(t, { type: "town.shop", action: { kind: "buy", itemId: "herb", memberId: "c2" } }, data).events[0]).toMatchObject({ kind: "rejected" });
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
    for (const p of ["tavern", "inn", "temple", "dark", "gate", "shop", "bank"] as const) expect(townParent(p)).toBe("menu");
    for (const p of ["shopBuy", "shopSell", "shopBuyback", "shopIdentify"] as const) expect(townParent(p)).toBe("shop");
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

  test("TW-09/CH-22 職業の段: classes.json の順。core の ok が偽なら dim で、押したときの理由（要る能力値は requirements をそのまま並べる）。今の職業は「（今）」。M18: 条件の足りない行は条件を添える", () => {
    // エル（魔術師。力 7・知恵 16・信仰心 10・素早さ 11）: 盗賊（素早さ 11）だけ条件を満たす
    const s = town();
    const e = townEntries({ ccClass: "c5" }, menuOf(s), S, null, ccOf(s, "c5"));
    const to = (classId: string): TownPage => ({ ccConfirm: { memberId: "c5", classId } });
    expect(e).toEqual([
      { kind: "ccClass", to: to("fighter"), label: "戦士　力 11", disabled: true, reason: "戦士には 力 11 が要る。" },
      { kind: "ccClass", to: to("thief"), label: "盗賊", disabled: false, reason: null },
      { kind: "ccClass", to: to("priest"), label: "僧侶　信仰心 11", disabled: true, reason: "僧侶には 信仰心 11 が要る。" },
      { kind: "ccClass", to: to("mage"), label: "魔術師（今）", disabled: true, reason: "エルはすでに魔術師だ。" },
      { kind: "ccClass", to: to("samurai"), label: "侍　力15 知11 信10 生14 速10", disabled: true, reason: "侍には 力 15・知恵 11・信仰心 10・生命力 14・素早さ 10 が要る。" },
      { kind: "ccClass", to: to("lord"), label: "君主　力15 知12 信12 生15 速14 運15", disabled: true, reason: "君主には 力 15・知恵 12・信仰心 12・生命力 15・素早さ 14・運 15 が要る。" },
      { kind: "ccClass", to: to("bishop"), label: "司教　知恵 12・信仰心 12", disabled: true, reason: "司教には 知恵 12・信仰心 12 が要る。" },
      back,
    ]);
    // 死亡の者はどの職業も dim（core の not alive）。行は職業名だけ（条件は添えない）
    const d = town({ c5: { life: "dead", hp: 0 } });
    const de = townEntries({ ccClass: "c5" }, menuOf(d), S, null, ccOf(d, "c5"));
    for (const x of de.slice(0, -1)) expect(x).toMatchObject({ kind: "ccClass", disabled: true, reason: "エルは今、転職を申し出られない。" });
    expect(de.slice(0, -1).map((x) => x.label)).toEqual(["戦士", "盗賊", "僧侶", "魔術師（今）", "侍", "君主", "司教"]);
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

  test("TW-09/CH-22（M18 設計 5-6）classChangeRowLabel: rowNeed「{cls}　{stats}」は requirements not met の行だけ。どの職業の条件でも一覧の行（39 単位）に収まり、収まらない行は能力値を 1 字の略にする", () => {
    expect(S["town.classChange.rowNeed"]).toBe("{cls}　{stats}");
    const opt = (classId: string, reason: string | null, current = false): ClassChangeOption => {
      const c = data.classes.find((x) => x.id === classId)!;
      return { classId, name: c.name, ok: reason === null, reason, requirements: { ...c.requirements }, current };
    };
    expect(classChangeRowLabel(opt("thief", "requirements not met"), S)).toBe("盗賊　素早さ 11");
    expect(classChangeRowLabel(opt("thief", null), S)).toBe("盗賊");
    expect(classChangeRowLabel(opt("thief", "not alive"), S)).toBe("盗賊");
    expect(classChangeRowLabel(opt("thief", "not enough gold"), S)).toBe("盗賊");
    expect(classChangeRowLabel(opt("thief", "same class", true), S)).toBe("盗賊（今）");
    // 全職業・全能力値が 2 桁の最悪の値（requirements を 18 に差し替え）でも収まる
    for (const c of data.classes) {
      const worst: ClassChangeOption = { ...opt(c.id, "requirements not met"), requirements: { str: 18, iq: 18, pie: 18, vit: 18, agi: 18, luk: 18 } };
      for (const o of [opt(c.id, "requirements not met"), worst]) {
        const label = classChangeRowLabel(o, S);
        expect(label.startsWith(`${c.name}　`), label).toBe(true);
        expect(textUnits(label), label).toBeLessThanOrEqual(39);
      }
    }
    // 収まる行は略さない（全部の能力値の名前が出る）
    expect(classChangeRowLabel(opt("bishop", "requirements not met"), S)).toBe("司教　知恵 12・信仰心 12");
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

describe("UI-77 用語の一覧（M16。views/rules.ts と酒場の「用語」）", () => {
  const lines = formatRules(S);
  const body = lines.slice(1);
  const terms = body.filter((l): l is WipeTermLine => typeof l !== "string");
  const head = (term: string): string | undefined => terms.find((l) => l.term === term)?.desc;
  const SP = String.fromCharCode(0x3000);

  test("UI-77 formatRules: 見出し rules.title → rules.line.1..N（続き番号のある限り。途切れた先は使わない）。値は strings だけ", () => {
    expect(lines[0]).toBe("用語");
    expect(S["rules.line.1"]).toBeDefined();
    let n = 0;
    while (S[`rules.line.${n + 1}`] !== undefined) n++;
    expect(n).toBeGreaterThanOrEqual(10);
    expect(body).toEqual(Array.from({ length: n }, (_, i) => splitRuleEntry(S[`rules.line.${i + 1}`]!)).flat());
    // 続き番号が途切れた先のキーは使わない
    expect(formatRules({ "rules.title": "t", "rules.line.1": "a", "rules.line.3": "c" })).toEqual(["t", "a"]);
  });

  test("UI-77（M16 追補 H-3）行の切り分け: 最初の全角空白の前が 3 字以内で空白なしなら用語、全角空白で始まる行は用語なしの続きの行、ほかは文字列のまま", () => {
    expect(RULE_TERM_MAX).toBe(3);
    expect(splitRuleLine(`HP${SP}体力`)).toEqual({ term: "HP", desc: "体力" });
    expect(splitRuleLine(`未鑑定${SP}拾った品`)).toEqual({ term: "未鑑定", desc: "拾った品" });
    expect(splitRuleLine(`${SP}続き`)).toEqual({ term: "", desc: "続き" });
    expect(splitRuleLine(`WAR 戦士${SP}THI 盗賊`)).toBe(`WAR 戦士${SP}THI 盗賊`); // 空白を含む = 一覧の行
    expect(splitRuleLine(`四文字語${SP}説明`)).toBe(`四文字語${SP}説明`); // 4 字は用語にしない
    expect(splitRuleLine("区切りなし")).toBe("区切りなし");
    // 実データ: 分類の見出し（「■ 」で始まる。M19 D-4）と職業の略称の一覧（2・3）は文字列、続きの行（8・13・45・46・50・54。M18 で用語を足して番号が動き、
    // M19 で毒の治し方の 13、D-4 で見出しと名品の続きの 54 を足した）は用語なし、ほかは用語あり
    expect([body[1], body[2]].map((l) => typeof l)).toEqual(["string", "string"]);
    const raws = Array.from({ length: body.length }, (_, i) => S[`rules.line.${i + 1}`]).filter((x): x is string => x !== undefined);
    for (const raw of raws) {
      const got = splitRuleEntry(raw);
      const l = got[0]!;
      if (got.length === 2) continue; // 長い用語（M22 D-6。下のテスト）
      if (typeof l === "string") expect(raw.startsWith("■ ") || raws.indexOf(raw) === 1 || raws.indexOf(raw) === 2, raw).toBe(true);
      else if (raw.startsWith(SP)) expect(l.term, raw).toBe("");
      else expect(l.term.length, raw).toBeGreaterThan(0);
    }
    const contNums = raws.flatMap((r, i) => (r.startsWith(SP) ? [i + 1] : []));
    expect(contNums).toHaveLength(13);
    // 用語なしの行 = 続きの行 13 + 長い用語の説明 6（M22 D-6）
    expect(terms.filter((l) => l.term === "")).toHaveLength(contNums.length + 6);
    for (const n of contNums) expect(terms.some((l) => l.term === "" && l.desc === S[`rules.line.${n}`]!.slice(1)), String(n)).toBe(true);
  });

  test("UI-77（M22 D-6）長い用語（RULE_TERM_MAX 字を超える）は用語を 1 行に置き、説明を次の行から続きの行（用語なし）で出す。6 語の説明は 1 本 27 字以内・説明の列に収まる", () => {
    expect(splitRuleEntry(`取り乱さなかった${SP}説明`)).toEqual(["取り乱さなかった", { term: "", desc: "説明" }]);
    expect(splitRuleEntry(`HP${SP}体力`)).toEqual([{ term: "HP", desc: "体力" }]);
    expect(splitRuleEntry(`${SP}続き`)).toEqual([{ term: "", desc: "続き" }]);
    expect(splitRuleEntry(`WAR 戦士${SP}THI 盗賊`)).toEqual([`WAR 戦士${SP}THI 盗賊`]);
    expect(splitRuleEntry("■ 職業")).toEqual(["■ 職業"]);
    const long = ["取り乱さなかった", "恐怖に動じない", "不意を突かれた", "回り込まれた", "張り合い", "制止判定"];
    for (const w of long) {
      const i = body.indexOf(w);
      expect(i, w).toBeGreaterThan(0);
      const next = body[i + 1] as WipeTermLine;
      expect(next.term, w).toBe("");
      expect(next.desc.length, w).toBeGreaterThan(0);
      expect([...w].length, w).toBeGreaterThan(RULE_TERM_MAX);
    }
    // 説明の要点（仕様: EV-44 / CB-04 / CB-50 / EV-75 / EV-21）
    const desc = (w: string): string => {
      let i = body.indexOf(w) + 1;
      let s = "";
      while (i < body.length && typeof body[i] !== "string" && (body[i] as WipeTermLine).term === "") s += (body[i++] as WipeTermLine).desc;
      return s;
    };
    expect(desc("取り乱さなかった")).toContain("慎重");
    expect(desc("恐怖に動じない")).toContain("無鉄砲");
    expect(desc("不意を突かれた")).toContain("敵だけが動く");
    expect(desc("回り込まれた")).toContain("逃走に失敗");
    expect(desc("張り合い")).toContain("+10");
    expect(desc("制止判定")).toContain("知恵");
    // 並び: 能力と状態の末尾・戦闘の先手の後・迷宮の見立ての後。名品・加護は足していない（既にある）
    expect(body.filter((l) => l === "名品" || l === "加護")).toHaveLength(0);
  });

  test("UI-77（M16 追補 H-3）用語の列は 32px（全角 4 字。最長の用語 3 字 + 区切り）。説明はどの行も列の右の同じ x から（続きの行も字下げ）", () => {
    expect(TERM_COL_W).toBe(32);
    for (const l of terms) expect(textUnits(l.term) * 4, l.term).toBeLessThan(TERM_COL_W);
  });

  test("UI-77 どの行も 1 行に収まる: 会話の箱の 1 行（全角 28 字）と、戦績と同じ部品の窓の幅（枠 1×2・左の余白 4・右の余白 4 と続きの印 8 を除く 222px。用語の行は列 32px + 説明。折り返さず切れる）", () => {
    const w = dungeonLayout(regions(data.config.ui.layout, data.config.stage.width), data.config.party.size).wipe;
    const inner = w.w - 2 - 4 - 4 - 8;
    expect(inner).toBe(222);
    for (let n = 1; S[`rules.line.${n}`] !== undefined; n++) expect(kinsokuLines(S[`rules.line.${n}`]!, 28), `${n}`).toHaveLength(1);
    for (const l of lines) {
      const px = typeof l === "string" ? textUnits(l) * 4 : TERM_COL_W + textUnits(l.desc) * 4;
      expect(px, JSON.stringify(l)).toBeLessThanOrEqual(inner);
    }
  });

  test("UI-77（M16 追補 H-3）窓の部品: 用語の行は用語の span（幅 32px の inline-block）と説明の span の 2 つ。文字列の行は今までどおり textContent", () => {
    const made: Array<Record<string, unknown>> = [];
    const el = (): Record<string, unknown> => {
      const e: Record<string, unknown> = { style: {}, className: "", textContent: "", children: [] as unknown[], scrollTop: 0, scrollHeight: 0, clientHeight: 0 };
      e["appendChild"] = (c: unknown) => ((e["children"] as unknown[]).push(c), c);
      e["append"] = (...c: unknown[]) => (e["children"] as unknown[]).push(...c);
      e["replaceChildren"] = (...c: unknown[]) => (e["children"] = c);
      e["addEventListener"] = () => {};
      e["setAttribute"] = () => {};
      e["removeAttribute"] = () => {};
      made.push(e);
      return e;
    };
    vi.stubGlobal("document", { createElement: el, createElementNS: el });
    try {
      const L = dungeonLayout(regions(data.config.ui.layout, data.config.stage.width), data.config.party.size);
      const v = createWipeView(L.wipe, S);
      v.render(["用語", "WAR 戦士", { term: "HP", desc: "体力" }, { term: "", desc: "続き" }]);
      const view = made.find((e) => e["className"] === "wipe-view")!;
      const rows = view["children"] as Array<Record<string, unknown>>;
      expect(rows.map((r) => r["className"])).toEqual(["wipe-title", "wipe-line", "wipe-line", "wipe-line"]);
      expect(rows[1]!["textContent"]).toBe("WAR 戦士");
      for (const [i, r] of [rows[2]!, rows[3]!].entries()) {
        const [t, d] = r["children"] as Array<Record<string, unknown>>;
        expect([t!["className"], d!["className"]]).toEqual(["wipe-term", "wipe-desc"]);
        expect(t!["style"]).toMatchObject({ display: "inline-block", width: "32px", overflow: "hidden" });
        expect([t!["textContent"], d!["textContent"]]).toEqual(i === 0 ? ["HP", "体力"] : ["", "続き"]);
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("UI-77/UI-57（M19 D-3）用語の窓の層: ステージ全面の層（自身は押せない）に、窓（rules-frame。layout の wipe の矩形）・幕・「閉じる」（ending.dismiss。layout の mapClose = 操作領域の close モードの位置）。タイトルでは幕と「閉じる」も出し、遊んでいる途中は窓だけ。「閉じる」で onClose、hide で層ごと隠す", () => {
    const made: Array<Record<string, unknown>> = [];
    const el = (tag: string): Record<string, unknown> => {
      const e: Record<string, unknown> = { tagName: tag.toUpperCase(), style: {}, className: "", textContent: "", children: [] as unknown[], scrollTop: 0, scrollHeight: 0, clientHeight: 0 };
      e["appendChild"] = (c: unknown) => ((e["children"] as unknown[]).push(c), c);
      e["append"] = (...c: unknown[]) => (e["children"] as unknown[]).push(...c);
      e["replaceChildren"] = (...c: unknown[]) => (e["children"] = c);
      e["addEventListener"] = () => {};
      e["setAttribute"] = () => {};
      e["removeAttribute"] = () => {};
      made.push(e);
      return e;
    };
    vi.stubGlobal("document", { createElement: el, createElementNS: (_ns: string, tag: string) => el(tag) });
    try {
      const L = dungeonLayout(regions(data.config.ui.layout, data.config.stage.width), data.config.party.size);
      let closed = 0;
      const o = createRulesOverlay({ rect: L.wipe, close: L.mapClose, strings: S, onClose: () => closed++ });
      const root = o.el as unknown as Record<string, unknown>;
      const style = (e: Record<string, unknown>): Record<string, string> => e["style"] as Record<string, string>;
      expect(root["className"]).toBe("rules-layer");
      expect(style(root)).toMatchObject({ position: "absolute", left: "0px", top: "0px", width: "100%", height: "100%", pointerEvents: "none", display: "none" });
      const [backdrop, frame, close] = root["children"] as Array<Record<string, unknown>>;
      expect([backdrop!["className"], frame!["className"], close!["className"]]).toEqual(["rules-backdrop", "rules-frame", "ui-button"]);
      expect(style(backdrop!)).toMatchObject({ width: "100%", height: "100%", background: "var(--c-bg)", pointerEvents: "auto" });
      // 窓は戦績・全滅の内訳と同じ矩形
      expect(style(frame!)).toMatchObject({ left: `${L.wipe.x}px`, top: `${L.wipe.y}px`, width: `${L.wipe.w}px`, height: `${L.wipe.h}px`, pointerEvents: "auto" });
      // 「閉じる」は操作領域の close モードの「閉じる」と同じ位置・同じ字
      expect(close!["textContent"]).toBe(S["ending.dismiss"]);
      expect(style(close!)).toMatchObject({ left: `${L.mapClose.x}px`, top: `${L.mapClose.y}px`, width: `${L.mapClose.w}px`, height: `${L.mapClose.h}px`, pointerEvents: "auto" });
      // タイトル: 幕と「閉じる」も出す。行は formatRules のまま
      o.show(formatRules(S), true);
      expect([style(root)["display"], style(backdrop!)["display"], style(close!)["display"]]).toEqual(["", "", ""]);
      const view = made.find((e) => e["className"] === "wipe-view")!;
      const rows = view["children"] as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(formatRules(S).length);
      expect(rows[0]!["textContent"]).toBe(S["rules.title"]);
      tapSpecOf(close as unknown as Element)!.onTap({ lx: 0, ly: 0 });
      expect(closed).toBe(1);
      o.hide();
      expect(style(root)["display"]).toBe("none");
      // 遊んでいる途中: 窓だけ（幕と「閉じる」は隠す。操作領域の「閉じる」を使う）
      o.show(formatRules(S), false);
      expect([style(root)["display"], style(backdrop!)["display"], style(close!)["display"]]).toEqual(["", "none", "none"]);
      // 「閉じる」の字はボタンの幅に収まる（8px の字、枠 2）
      expect([...S["ending.dismiss"]!].length * 8).toBeLessThanOrEqual(L.mapClose.w - 2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("UI-77/UI-11（M19 実機の気づき (a)）用語の窓は開くたびに先頭から: 3 頁目まで送って閉じ、もう一度 show しても scrollTop は 0（隠れている間の scrollTop の設定は捨てる偽の DOM で、窓を出してから先頭へ戻すことを見る）", () => {
    const made: Array<Record<string, unknown>> = [];
    const hidden = (e: Record<string, unknown> | undefined): boolean => {
      for (let p = e; p; p = p["parent"] as Record<string, unknown> | undefined) if ((p["style"] as Record<string, string>)["display"] === "none") return true;
      return false;
    };
    const el = (tag: string): Record<string, unknown> => {
      let top = 0;
      const e: Record<string, unknown> = { tagName: tag.toUpperCase(), style: {}, className: "", textContent: "", children: [] as unknown[], scrollHeight: 0, clientHeight: 0 };
      // 実機と同じく、祖先が display:none の間は scrollTop の設定が効かない
      Object.defineProperty(e, "scrollTop", {
        get: () => top,
        set: (v: number) => {
          if (!hidden(e)) top = v;
        },
      });
      const adopt = (c: unknown): void => void ((c as Record<string, unknown>)["parent"] = e);
      e["appendChild"] = (c: unknown) => (adopt(c), (e["children"] as unknown[]).push(c), c);
      e["append"] = (...c: unknown[]) => (c.forEach(adopt), (e["children"] as unknown[]).push(...c));
      e["replaceChildren"] = (...c: unknown[]) => (c.forEach(adopt), (e["children"] = c));
      e["addEventListener"] = () => {};
      e["setAttribute"] = () => {};
      e["removeAttribute"] = () => {};
      made.push(e);
      return e;
    };
    vi.stubGlobal("document", { createElement: el, createElementNS: (_ns: string, tag: string) => el(tag) });
    try {
      const L = dungeonLayout(regions(data.config.ui.layout, data.config.stage.width), data.config.party.size);
      const o = createRulesOverlay({ rect: L.wipe, close: L.mapClose, strings: S, onClose: () => {} });
      const view = made.find((e) => e["className"] === "wipe-view")!;
      o.show(formatRules(S), true);
      expect(view["scrollTop"]).toBe(0);
      view["scrollTop"] = 370; // 3 頁目まで送った
      expect(view["scrollTop"]).toBe(370);
      o.hide();
      o.show(formatRules(S), false);
      expect(view["scrollTop"]).toBe(0);
      view["scrollTop"] = 370;
      o.hide();
      o.show(formatRules(S), true);
      expect(view["scrollTop"]).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("UI-77 中身: 職業の略称と名前（classes.json と同じ）、HP / MP / SAN（party.*）、SAN の段と状態の略称（party.san.* / party.status.*）、↑（town.band.mark.levelUp）、G、AC、灰、士気、未鑑定、触媒", () => {
    for (const c of data.classes) expect(body.some((l) => typeof l === "string" && l.includes(`${c.abbr} ${c.name}`)), c.id).toBe(true);
    for (const k of ["party.hp", "party.mp", "party.san"]) expect(head(S[k]!), k).toBeDefined();
    for (const st of ["uneasy", "confused", "broken"]) expect(head(S[`party.san.${st}`]!), st).toBeDefined();
    for (const st of ["poison", "paralysis", "sleep", "stone"]) expect(head(S[`party.status.${st}`]!), st).toBeDefined();
    expect(head(S["town.band.mark.levelUp"]!)).toContain("宿");
    expect(S["town.header"]).toContain("{gold}G");
    expect(head("G")).toContain("所持金");
    expect(head("AC")).toContain("小さいほど");
    for (const term of ["灰", "士気", "未鑑定", "触媒"]) expect(head(term), term).toBeDefined();
  });

  test("UI-77/UI-59（M18）+N の行: 用語「+N」は鍛えた段数（IT-11 の名前の「 +N」）で、武器は攻撃・防具は AC に効く。並びは未鑑定・鑑定の後・触媒の前", () => {
    expect(head("+N")).toBe("鍛えた段数。武器は攻撃・魔法、防具は AC に効く");
    const terms = body.flatMap((l) => (typeof l === "string" || l.term === "" ? [] : [l.term]));
    expect(terms.indexOf("鑑定")).toBe(terms.indexOf("未鑑定") + 1);
    expect(terms.indexOf("+N")).toBe(terms.indexOf("鑑定") + 1);
    expect(terms.indexOf("触媒")).toBe(terms.indexOf("+N") + 1);
  });

  test("UI-77（M18 設計 4-3）用語の追加: 前衛・後衛・判定・識別・蘇生・解呪・レベル・潜行・鑑定・呪文・加護の 11 語が用語の行として立つ。並びは M19 D-4 の分類のとおり（職業 → 能力と状態（士気まで）→ 卓と判定 → 戦闘 → 迷宮 → 街 → 品 → 呪文）。どの用語も 3 字以内", () => {
    const termsOf = body.flatMap((l) => (typeof l === "string" || l.term === "" ? [] : [l.term]));
    const added = ["前衛", "後衛", "判定", "識別", "蘇生", "解呪", "レベル", "潜行", "鑑定", "呪文", "加護"];
    for (const w of added) {
      expect(head(w), w).toBeDefined();
      expect([...w].length, w).toBeLessThanOrEqual(RULE_TERM_MAX);
    }
    // 並び（設計 4-3 を M19 D-4 で分類した後）
    const order = ["士気", "GM", "d", "判定", "大当り", "ターン", "先手", "前衛", "後衛", "識別", "潜行", "主", "糸", "見立て", "蘇生", "解呪", "経験", "レベル", "未鑑定", "鑑定", "+N", "触媒", "大成功", "希少度", "名品", "呪文", "加護"];
    expect(order.map((w) => termsOf.indexOf(w))).toEqual(order.map((w) => termsOf.indexOf("士気") + order.indexOf(w)));
    expect(termsOf.at(-1)).toBe("加護");
    // 語は画面・データの名前と同じ（前衛・後衛は並び順の画面、解呪は寺院、識別・加護・蘇生は呪文の名前）
    expect([S["camp.order.front"], S["camp.order.back"], S["town.temple.uncurse"]]).toEqual(["前衛", "後衛", "解呪"]);
    const spell = (id: string): string | undefined => data.spells.find((x) => x.id === id)?.name;
    expect([spell("identify"), spell("blessing"), spell("resurrect")]).toEqual(["識別", "加護", "蘇生"]);
    // 中身の要点（説明は用語の中で閉じる: 説明に出る AC・SAN・MP・HP・灰・蘇生・呪文・レベル・判定・潜行・鑑定は用語にある）
    expect(head("後衛")).toContain("弓・投擲・長柄");
    expect(head("識別")).toContain("正体");
    expect(head("識別")).not.toContain("鑑定");
    expect(head("蘇生")).toContain("灰");
    expect(head("解呪")).toContain("寺院");
    expect(head("加護")).toContain("AC");
    for (const w of ["AC", "SAN", "MP", "HP", "灰", "蘇生", "呪文", "レベル", "判定", "潜行", "鑑定"]) expect(head(w), w).toBeDefined();
  });

  test("UI-77（M19 D-4）用語の追加と分類: 12 語（GM・経験・d・大成功・見立て・帰還の糸（用語は「糸」）・希少度・主・ターン・先手・大当り・名品）が用語の行として立つ。分類の見出しは「■ 」で始まる文字列の行（用語の列は無い）で、直後は用語の行。行は見出しを入れて 58（1 頁 21 行の 3 頁）", () => {
    const termsOf = body.flatMap((l) => (typeof l === "string" || l.term === "" ? [] : [l.term]));
    const added = ["GM", "経験", "d", "大成功", "見立て", "糸", "希少度", "主", "ターン", "先手", "大当り", "名品"];
    for (const w of added) {
      expect(head(w), w).toBeDefined();
      expect([...w].length, w).toBeLessThanOrEqual(RULE_TERM_MAX);
    }
    expect(new Set(termsOf).size).toBe(termsOf.length); // 用語は重ならない
    // 分類の見出し: 「■ 」+ 分類名の文字列の行（全角空白を含まず、splitRuleLine で用語にならない）。直後の行は用語の行か職業の略称の一覧
    const heads = body.flatMap((l, i) => (typeof l === "string" && l.startsWith("■ ") ? [i] : []));
    expect(heads.map((i) => body[i])).toEqual(["■ 職業", "■ 能力と状態", "■ 卓と判定", "■ 戦闘", "■ 迷宮", "■ 街", "■ 品", "■ 呪文"]);
    expect(heads[0]).toBe(0);
    for (const i of heads) {
      expect((body[i] as string).includes(SP), String(i)).toBe(false);
      const next = body[i + 1]!;
      if (i === 0) expect(typeof next).toBe("string");
      else expect(typeof next !== "string" && next.term !== "", JSON.stringify(next)).toBe(true);
    }
    // 分類ごとの用語（見出しから次の見出しまで）
    const section = (h: string): string[] => {
      const a = body.indexOf(h);
      const b = heads.find((i) => i > a) ?? body.length;
      return body.slice(a + 1, b).flatMap((l) => (typeof l === "string" || l.term === "" ? [] : [l.term]));
    };
    expect(section("■ 卓と判定")).toEqual(["GM", "d", "判定", "大当り"]);
    expect(section("■ 戦闘")).toEqual(["ターン", "先手", "前衛", "後衛", "識別"]); // 長い用語は用語の行が文字列なので数えない
    expect(section("■ 迷宮")).toEqual(["潜行", "主", "糸", "見立て"]);
    expect(section("■ 街")).toEqual(["蘇生", "解呪", "経験", "レベル"]);
    expect(section("■ 品")).toEqual(["未鑑定", "鑑定", "+N", "触媒", "大成功", "希少度", "名品"]);
    expect(lines).toHaveLength(77); // 見出し 1 + strings 70 + 長い用語 6 語の説明（M22 D-6）
    expect(Math.ceil(lines.length / 21)).toBe(4);
    // 語は画面・データの名前と同じ
    expect(S["gm.name"]).toBe("GM");
    expect(S["battle.exp"]).toContain("経験");
    expect(S["custom.bonusDetailBig"]).toContain("大当り");
    expect(S["dice.upgrade.great"]).toBe("大成功");
    expect(S["chest.menu.found"]).toBe("{name}（見立て）");
    expect(S["camp.book"]).toBe("名品の図鑑");
    expect(S["battle.turn"]).toBe("第{n}ターン");
    expect(S["dice.initiative.party"]).toBe("先手");
    expect(S["item.detail.rarity"]).toBe("希少度 {rarity}");
    const thread = data.items.find((x) => x.id === "return_thread")!;
    expect(head("糸")!.startsWith(`${thread.name}。`)).toBe(true);
    // 中身の要点（数値の設定を書かない言い方。説明は用語の中で閉じる）
    expect(head("d")).toContain("2d10");
    expect(head("先手")).toContain(S["dice.initiative.enemy"]!);
    // M20（D-7）: 希少度の行は語（book.rarity.*）とオプションの個数（config.items.rarities の options）。通常（0 個）は書かない
    expect(head("希少度")).toContain(
      data.config.items.rarities.filter((r) => r.options > 0).map((r) => `${S[`book.rarity.${r.id}`]!} ${r.options}`).join("・"),
    );
    expect(head("大成功")).toContain("+N");
    expect(head("名品")).toContain("図鑑");
    const meihin = body.indexOf(body.find((l) => typeof l !== "string" && l.term === "名品")!);
    expect(body[meihin + 1]).toEqual({ term: "", desc: "名品は鍛えられず、触媒にもできない" });
    expect(head("経験")).toContain("レベル");
    expect(head("主")).toContain("最下層");
    expect(head("主")).toContain("門番"); // 画面の呼び名（d01 の description の「門番」）から引ける
    expect(data.dungeons.find((x) => x.id === "d01")!.description).toContain("門番");
  });

  test("UI-77/UI-52/TW-03 酒場の「用語」は戦績の有無によらず出る。転職（と戦績）の後・救済の行と戻るの前。閉じるのキーは戦績と同じ（endingKeyAction）", () => {
    const off = townEntries("tavern", menuOf(town()), S);
    const i = off.findIndex((e) => e.kind === "page" && e.to === "classChange");
    expect(off[i + 1]).toEqual({ kind: "rules", label: "用語" });
    const s = town();
    s.progress = { ...s.progress, conquered: true };
    const on = townEntries("tavern", menuOf(s), S);
    const j = on.findIndex((e) => e.kind === "record");
    expect(on[j + 1]).toEqual({ kind: "rules", label: "用語" });
    expect(on.at(-1)).toEqual(back);
    for (const a of ["back", "confirm", { menu: 0 }] as const) expect(endingKeyAction(a, false)).toBe("close");
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

describe("TW-05/UI-52/IT-61（M18 5-2）店の確認と売値", () => {
  const cancel: TownEntry = { kind: "back", label: S["common.cancel"]! };

  test("TW-05/UI-52（M18 5-2）買うの確認 { buyAsk }: 見出しは「{name}に{item}を持たせる。{cost}G で買うか？」、答えは 買う（持たせる者の段のその者の行と同じ条件で dim）/ やめる（持たせる者の段へ）", () => {
    const m = menuOf(town());
    const herb: TownPage = { buyAsk: { itemId: "herb", memberId: "c1" } };
    expect(townHeadingText(herb, m, S)).toBe("アルドに薬草を持たせる。10G で買うか？");
    expect(townEntries(herb, m, S)).toEqual([{ kind: "buyYes", itemId: "herb", memberId: "c1", label: "買う", disabled: false }, cancel]);
    expect(S["common.cancel"]).toBe("やめる");
    expect(townParent(herb)).toEqual({ shop: "herb" });
    expect(townHeading(herb)).toBe("town.ask.buyConfirm");
    expect(townPageIntro(herb, m)).toEqual([]);
    // 装備の品は core の表示名と買値（流通レベル 0 の長剣 100G）
    const sword: TownPage = { buyAsk: { itemId: "long_sword", memberId: "c2" } };
    expect(townHeadingText(sword, m, S)).toBe("ベルクに長剣を持たせる。100G で買うか？");
    expect(townEntries(sword, m, S)[0]).toEqual({ kind: "buyYes", itemId: "long_sword", memberId: "c2", label: "買う", disabled: false });
    // 装備できない者（ドナ）・所持枠の空きが無い者・払えないときの「買う」は dim（持たせる者の段の行と同じ）
    expect(townEntries({ buyAsk: { itemId: "long_sword", memberId: "c4" } }, m, S)[0]).toMatchObject({ kind: "buyYes", disabled: true });
    const full = town();
    for (let i = 0; i < 5; i++) full.party[5]!.inventory.push(createItemInstance(full, { itemId: "herb", identified: true }));
    expect(menuOf(full).shop.members.find((x) => x.memberId === "c6")!.slotsFree).toBe(0);
    expect(townEntries({ buyAsk: { itemId: "herb", memberId: "c6" } }, menuOf(full), S)[0]).toMatchObject({ kind: "buyYes", disabled: true });
    expect(townEntries({ buyAsk: { itemId: "herb", memberId: "c1" } }, menuOf(town({}, 5)), S)[0]).toMatchObject({ kind: "buyYes", disabled: true });
  });

  test("IT-61/UI-52（M18 5-2）売るの確認 { sellAsk }: 見出しは「{item}を {gold}G で売る。売るか？」（core の売値）、答えは 売る / やめる（その者の品の段へ）", () => {
    const s = town();
    const fine = createItemInstance(s, { itemId: "long_sword", level: 2, rarity: "fine", options: [{ optionId: "str", tier: 1, value: 1 }], identified: true });
    s.party[1]!.inventory.push(fine);
    const m = menuOf(s);
    const page: TownPage = { sellAsk: { memberId: "c2", instanceId: fine } };
    expect(townHeadingText(page, m, S)).toBe("上質な長剣 +2を 120G で売る。売るか？");
    expect(townEntries(page, m, S)).toEqual([{ kind: "sellYes", memberId: "c2", instanceId: fine, label: "売る", disabled: false }, cancel]);
    expect(townParent(page)).toEqual({ sell: "c2" });
    expect(townHeading(page)).toBe("town.ask.sellConfirm");
    expect(townPageIntro(page, m)).toEqual([]);
    expect(townFacility(page)).toBe("shop");
    expect(townPlace(page)).toBe("town.place.shop");
  });

  test("TW-05/IT-61/UI-52（M18 5-2）確認の段の直し（townRepair）と、品や者が見つからないときの見出し（town.ask.buyConfirm / sellConfirm）", () => {
    const s = town({ c3: { life: "dead", hp: 0 } });
    const m = menuOf(s);
    const ok: TownPage = { buyAsk: { itemId: "herb", memberId: "c1" } };
    expect(townRepair(ok, m)).toBe(ok);
    // 売り物に無い品 → 売り物の一覧、持たせる者にいない（死んだ）者 → 持たせる者の段
    expect(townRepair({ buyAsk: { itemId: "no_such", memberId: "c1" } }, m)).toBe("shopBuy");
    expect(townRepair({ buyAsk: { itemId: "herb", memberId: "c3" } }, m)).toEqual({ shop: "herb" });
    expect(townHeadingText({ buyAsk: { itemId: "herb", memberId: "c3" } }, m, S)).toBe(S["town.ask.buyConfirm"]);
    const herbOf1 = s.party[0]!.inventory[0]!;
    const sell: TownPage = { sellAsk: { memberId: "c1", instanceId: herbOf1 } };
    expect(townRepair(sell, m)).toBe(sell);
    // 売った品が手元から消えた → その者の品の段、者がいない → 売る者の段
    expect(townRepair({ sellAsk: { memberId: "c1", instanceId: "i999" } }, m)).toEqual({ sell: "c1" });
    expect(townRepair({ sellAsk: { memberId: "zz", instanceId: herbOf1 } }, m)).toBe("shopSell");
    expect(townHeadingText({ sellAsk: { memberId: "c1", instanceId: "i999" } }, m, S)).toBe(S["town.ask.sellConfirm"]);
    expect(samePage(ok, { buyAsk: { itemId: "herb", memberId: "c1" } })).toBe(true);
    expect(samePage(ok, { buyAsk: { itemId: "herb", memberId: "c2" } })).toBe(false);
  });

  test("TW-05/IT-61/UI-52（M18 5-2）最悪の値（6 字の名前・最も長い品名・5 桁の額・2 桁の数）でも、確認の問いは見出しの 1 行（全角 28 字）、売る者の行は一覧の行の幅（39 単位）、答えのラベルは全角 4 字に収まる", () => {
    const name = "ろくもじのな";
    const longest = (xs: string[]): string => [...xs].sort((a, b) => textUnits(b) - textUnits(a))[0]!;
    // 買う: 店の売り物は消耗品と、流通レベル（最大は dungeons の onClear.shopLevel の最大）の汎用装備（通常・Lv 付きの表示名）
    const maxLevel = Math.max(...data.dungeons.map((d) => d.onClear.shopLevel));
    const plus = formatMessage(S["item.plus"]!, { n: maxLevel });
    const shopName = longest([...data.items.map((it) => it.name), ...data.equipmentBases.map((b) => `${b.name}${plus}`)]);
    const maxCost = Math.max(
      ...data.items.map((it) => it.price ?? 0),
      ...data.equipmentBases.map((b) => shopPrice(b, maxLevel, data)),
    );
    expect(String(maxCost).length).toBeLessThanOrEqual(5);
    const buy = formatMessage(S["town.shop.buyAsk"]!, { name, item: shopName, cost: 99999 });
    expect(buy).not.toContain("{");
    expect(kinsokuLines(buy, 28), buy).toHaveLength(1);
    // 売る: 手元の品は未鑑定の名前、希少度の接頭辞 + ベース + 2 桁の Lv、希少度の接頭辞 + ユニークの名前
    const prefix = longest(["fine", "rare", "legendary"].map((r) => S[`item.rarity.${r}`]!));
    const item = longest([
      ...data.items.flatMap((it) => [it.name, it.unidentifiedName ?? it.name]),
      ...data.equipmentBases.flatMap((b) => [b.unidentifiedName, `${prefix}${b.name}${formatMessage(S["item.plus"]!, { n: 12 })}`]),
      ...data.uniques.map((u) => `${prefix}${u.name}`),
    ]);
    const sell = formatMessage(S["town.shop.sellAsk"]!, { item, gold: 99999 });
    expect(sell).not.toContain("{");
    expect(kinsokuLines(sell, 28), sell).toHaveLength(1);
    const row = formatMessage(S["town.shop.sellWho"]!, { name, count: 99, gold: 99999 });
    expect(row).not.toContain("{");
    expect(textUnits(row), row).toBeLessThanOrEqual(39);
    for (const k of ["town.shop.buyYes", "town.shop.sellYes", "common.cancel", "town.ask.buyConfirm", "town.ask.sellConfirm"]) {
      expect(Array.from(S[k]!).length, k).toBeLessThanOrEqual(k.startsWith("town.ask") ? 28 : 4);
    }
    // 預けるの行（銀行。M17）は計の無い文のまま
    expect(formatMessage(S["town.storage.depositWho"]!, { name: "アルド", count: 1 })).toBe("アルド　1品");
  });
});

describe("TW-04/UI-52（M18 5-3）宿屋の見出しの 2 行目と泊まった後の一言", () => {
  test("TW-04/UI-52 宿屋の段だけ見出しの 2 行目 town.inn.partyHp「HP {hp}/{hpMax} MP {mp}/{mpMax} ↑{n}人（{name}あと{exp}）」（値は core の townMenu.innParty。M20 D-6 で最短の者）。ほかの段は null", () => {
    const s = town({ c1: { hp: 1 }, c2: { exp: 100000 }, c4: { mp: 0 } });
    const m = menuOf(s);
    const p = m.innParty;
    expect(p.nearest).not.toBeNull();
    expect(townHeadingSub("inn", m, S)).toBe(`HP ${p.hp}/${p.hpMax} MP ${p.mp}/${p.mpMax} ↑${p.levelUpReady}人（${p.nearest!.name}あと${p.nearest!.expToNext}）`);
    expect(p.levelUpReady).toBe(1);
    // 見出しの 1 行目は今までどおりの問い
    expect(townHeadingText("inn", m, S)).toBe(S["town.ask.inn"]);
    for (const page of ALL_PAGES.filter((x) => x !== "inn")) expect(townHeadingSub(page, m, S), JSON.stringify(page)).toBeNull();
    // strings を差し替えれば文も変わる（表示層は値を入れるだけ）
    expect(townHeadingSub("inn", m, { ...S, "town.inn.partyHp": "{hp}-{hpMax}-{mp}-{mpMax}-{n}-{name}-{exp}" })).toBe(
      `${p.hp}-${p.hpMax}-${p.mp}-${p.mpMax}-${p.levelUpReady}-${p.nearest!.name}-${p.nearest!.expToNext}`,
    );
  });

  test("TW-04/UI-52（M20 D-6）全員が宿で上がるなら town.inn.partyHpAll「…↑{n}人（全員）」、生きている者がいなければ town.inn.partyHpNone（人数だけ）", () => {
    const m = menuOf(town());
    const all = { ...m, innParty: { hp: 60, hpMax: 60, mp: 10, mpMax: 10, levelUpReady: 6, nearest: null } };
    expect(townHeadingSub("inn", all, S)).toBe("HP 60/60 MP 10/10 ↑6人（全員）");
    const none = { ...m, innParty: { hp: 0, hpMax: 0, mp: 0, mpMax: 0, levelUpReady: 0, nearest: null } };
    expect(townHeadingSub("inn", none, S)).toBe("HP 0/0 MP 0/0 ↑0人");
  });

  test("TW-15（M20 D-5）town.inn.gossipHeard は会話の箱の 1 行（28 字）に収まる", () => {
    expect(S["town.inn.gossipHeard"]).toBe("主人から迷宮の噂を聞いた。");
    expect(kinsokuLines(S["town.inn.gossipHeard"]!, 28)).toHaveLength(1);
  });

  test("TW-04/UI-52 見出しの 2 行目は最悪の値（HP・MP とも 9999/9999、6人。M20 D-6: 名前 6 字・残り 5 桁）でも見出しの 1 行（全角 28 字 = 56 単位）に収まる。宿の行は最悪の料金（M22 D-7: 実際の料金は 0 / 20 / 60 なので 4 桁 9999）でも一覧の 21 字（39 単位）に収まる", () => {
    const hm = { hp: 9999, hpMax: 9999, mp: 9999, mpMax: 9999 };
    const worst = formatMessage(S["town.inn.partyHp"]!, { ...hm, n: 5, name: "アアアアアア", exp: 99999 });
    expect(textUnits(worst), worst).toBeLessThanOrEqual(56);
    for (const k of ["town.inn.partyHpAll", "town.inn.partyHpNone"]) {
      const w = formatMessage(S[k]!, { ...hm, n: 6 });
      expect(textUnits(w), w).toBeLessThanOrEqual(56);
    }
    for (const r of data.config.town.innRanks) {
      const label = formatMessage(S["town.inn.rank"]!, { name: r.name, cost: 9999, effect: S[`town.inn.effect.${r.id}`]! });
      expect(textUnits(label), label).toBeLessThanOrEqual(39);
    }
  });

  test("TW-04 泊まった後の一言 town.inn.restored / restoredMp は会話の箱の 1 行（28 字）に収まる", () => {
    expect(S["town.inn.restored"]).toBe("生きている者の HP と MP が戻った。");
    expect(S["town.inn.restoredMp"]).toBe("生きている者の MP が戻った。");
    for (const k of ["town.inn.restored", "town.inn.restoredMp"]) expect(kinsokuLines(S[k]!, 28), k).toHaveLength(1);
  });

  test("TW-04/CH-43/UI-52/UI-77（M19）毒と宿の文: town.inn.curedPoison は会話の箱の 1 行。毒を治すランク（curePoison）の効果の文だけに「毒」。用語の毒の続きの行に宿・寺院・解毒。寺院の治療の行は治す状態を並べる", () => {
    expect(S["town.inn.curedPoison"]).toBe("毒も抜けた。");
    expect(kinsokuLines(S["town.inn.curedPoison"]!, 28)).toHaveLength(1);
    for (const r of data.config.town.innRanks) expect(S[`town.inn.effect.${r.id}`]!.includes("毒"), r.id).toBe(r.curePoison);
    expect([S["town.inn.effect.cheap"], S["town.inn.effect.good"]]).toEqual(["全回復・毒も治る", "全回復＋士気・毒も治る"]);
    // 用語: 毒の行の直後が用語なしの続きの行で、治し方を書く（宿は相部屋以上）
    const body = formatRules(S).slice(1);
    const at = body.findIndex((l) => typeof l !== "string" && l.term === S["party.status.poison"]);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(body[at + 1]).toEqual({ term: "", desc: "宿（相部屋以上）・寺院・解毒で治る" });
    expect(S["town.temple.cureRow"]).toBe("治療（麻痺・石化・毒）　{cost}G〜");
  });
});

describe("TW-07/UI-52（M18 5-4）寺院の最初の段の料金の目安", () => {
  test("TW-07 townMenu.temple.pricing は config の templeCostPerLevel・cureCost の最小値・uncurseCost（対象がいなくても出る）。行は town.temple.<sv>Row に値を入れるだけ", () => {
    const m = menuOf(town());
    const e = data.config.economy;
    expect(m.temple.pricing).toEqual({ perLevel: e.templeCostPerLevel, cureFrom: Math.min(...Object.values(e.cureCost)), uncurse: e.uncurseCost });
    expect(m.temple.pricing).toEqual({ perLevel: 100, cureFrom: 50, uncurse: 200 });
    expect(m.temple.resurrect).toEqual([]);
    // 表示層は config を読まず menu の値を入れる（menu を差し替えれば行も変わる）
    const m2: TownMenu = { ...m, temple: { ...m.temple, pricing: { perLevel: 7, cureFrom: 8, uncurse: 9 } } };
    expect(townEntries("temple", m2, S).map((x) => x.label)).toEqual(["蘇生　Lv×7G", "治療（麻痺・石化・毒）　8G〜", "解呪　9G", S["common.back"]]);
  });

  test("TW-07 料金の目安の行は最悪の値（6 桁）でも一覧の 21 字（39 単位）に収まる。説明 town.menu.note.temple は「蘇生・治療・解呪」", () => {
    for (const k of ["town.temple.resurrectRow", "town.temple.cureRow", "town.temple.uncurseRow"]) {
      const label = formatMessage(S[k]!, { perLevel: 999999, cost: 999999 });
      expect(label, k).not.toContain("{");
      expect(textUnits(label), label).toBeLessThanOrEqual(39);
    }
    expect(S["town.menu.note.temple"]).toBe("蘇生・治療・解呪");
  });
});
