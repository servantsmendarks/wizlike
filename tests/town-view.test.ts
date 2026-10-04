// UI-52 街のページ（views/town.ts の純粋な部分）。値は core の townMenu だけから作る（UI-35）。
// 既定のパーティ（newGame(1)）: c1 アルド（リーダー）、c2 ベルク、c3 キリ、c4 ドナ、c5 エル、c6 フィン。全員レベル 1。所持金 300。
// 宿: 馬小屋 0G / 相部屋 20G / 個室 60G。寺院: 蘇生 level × 100、治療 毒 50 + 麻痺 150、解呪 200。闇魔術: level × darkCostPerLevel。
// 店（TW-05）: 薬草 10G / 解毒草 15G / 帰還の糸 50G。初期の所持枠の空き（townMenu.shop.members）は c1 4 / c2 6 / c3 4 / c4 5 / c5 6 / c6 5。
import { describe, expect, test } from "vitest";
import { townMenu } from "../src/core/rules/town";
import { cloneState, createItemInstance } from "../src/core/state";
import type { Character, GameState, TownMenu } from "../src/core/types";
import { samePage, townEntries, townHeader, townPageIntro, townParent, townRepair, type TownEntry } from "../src/presenter/views/town";
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
  test("TW-01/TW-03/TW-13/UI-52/TW-31/IT-66 酒場: 見回す → 状態・呪文・道具・装備・並び順 → 図鑑 → 救済の行（申し出の間だけ。dead / ash の者、リーダーも）→ 戻る", () => {
    const camp: TownEntry[] = [
      { kind: "look", label: "見回す" },
      { kind: "camp", open: "status", label: "状態" },
      { kind: "camp", open: "spell", label: "呪文" },
      { kind: "camp", open: "item", label: "道具" },
      { kind: "camp", open: "equip", label: "装備" },
      { kind: "camp", open: "order", label: "並び順" },
      { kind: "camp", open: "book", label: "図鑑" }, // IT-66（M7）: 図鑑は酒場の一覧（並び順・鑑定の後）
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
    // IT-66（M7）: 鑑定の後に図鑑
    expect(e.map((x) => x.kind)).toEqual(["look", "camp", "camp", "camp", "camp", "camp", "camp", "camp", "mercy", "back"]);
    expect(e[6]).toEqual({ kind: "camp", open: "identify", label: "鑑定" });
    expect(e[7]).toEqual({ kind: "camp", open: "book", label: "図鑑" });
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
    // shopLevel 2: shopMinLevel 2 のベース（鎚矛・鎖帷子・鉄兜・護符）も並び、Lv2（買値 = price × (1 + 0.5 × 2) = price × 2、名前は「 +2」）
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
      "革鎧 +2　100G",
      "鎖帷子 +2　600G",
      "木の盾 +2　80G",
      "革兜 +2　60G",
      "鉄兜 +2　240G",
      "革小手 +2　60G",
      "護符 +2　400G",
    ]);
    // 50G で払えないのは 長剣 100G と 短弓 80G だけ（帰還の糸 50G・革鎧 50G はちょうど払える）
    expect(townEntries("shopBuy", menuOf(town({}, 50)), S).flatMap((e) => (e.kind === "shopItem" && e.disabled ? [e.itemId] : []))).toEqual([
      "long_sword",
      "short_bow",
    ]);
    expect(townPageIntro("shopBuy", menuOf(town()))).toEqual(["town.shop.buyIntro"]);
    expect(townParent("shopBuy")).toBe("shop");
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
    // 払えない品（10G で帰還の糸 50G・長剣 100G）は全員 disabled。杖（10G）は空きのある 4 人が押せる
    expect(townEntries({ shop: "return_thread" }, m, S).filter((e) => e.kind === "buy").every((e) => e.kind === "buy" && e.disabled)).toBe(true);
    expect(townEntries({ shop: "long_sword" }, m, S).filter((e) => e.kind === "buy").every((e) => e.kind === "buy" && e.disabled)).toBe(true);
    expect(townEntries({ shop: "staff" }, m, S).filter((e) => e.kind === "buy" && !e.disabled).length).toBe(4);
    expect(townPageIntro({ shop: "herb" }, m)).toEqual(["town.shop.whom"]);
    for (const k of ["town.shop.intro", "town.shop.whom", "town.shop.buyIntro", "town.shop.sellIntro", "town.shop.buybackIntro", "town.shop.identifyIntro", "town.storage.intro", "town.storage.whom"]) {
      expect(S[k], k).toBeDefined();
      expect(S[k], k).not.toContain("{");
    }
  });

  test("UI-52/IT-61 売るは全員（life を問わない）の行（名前と売れる品の数。無ければ disabled）→ その者の売れる品（名前と売値）。押すと sell", () => {
    // 初期の所持品: c1 薬草・c2 なし・c3 薬草・c4 解毒草・c5 帰還の糸・c6 薬草（どれも鑑定済み）。c3 を dead にしても行は出る
    const s = town({ c3: { life: "dead", hp: 0 } });
    // c2 に 上質な長剣 +2（力 +1 の段階 1）と未鑑定の長剣（売れないので数えない）を持たせる
    const fine = createItemInstance(s, { itemId: "long_sword", level: 2, rarity: "fine", options: [{ optionId: "str", tier: 1, value: 1 }], identified: true });
    const unk = createItemInstance(s, { itemId: "long_sword", identified: false });
    s.party[1]!.inventory.push(fine, unk);
    const m = menuOf(s);
    expect(townEntries("shopSell", m, S)).toEqual([
      { kind: "pick", to: { sell: "c1" }, label: "アルド　1品", disabled: false },
      { kind: "pick", to: { sell: "c2" }, label: "ベルク　1品", disabled: false },
      { kind: "pick", to: { sell: "c3" }, label: "キリ　1品", disabled: false },
      { kind: "pick", to: { sell: "c4" }, label: "ドナ　1品", disabled: false },
      { kind: "pick", to: { sell: "c5" }, label: "エル　1品", disabled: false },
      { kind: "pick", to: { sell: "c6" }, label: "フィン　1品", disabled: false },
      back,
    ]);
    // IT-61: floor(100 × 0.5 × (1 + 0.5 × 2)) = 100 + 正のオプション 段階 1 の 20 = 120
    expect(townEntries({ sell: "c2" }, m, S)).toEqual([{ kind: "sell", memberId: "c2", instanceId: fine, label: "上質な長剣 +2　120G", disabled: false }, back]);
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
      { kind: "buyback", memberId: "c1", instanceId: twin, label: "アルド　空き4", disabled: false },
      { kind: "buyback", memberId: "c2", instanceId: twin, label: "ベルク　空き6", disabled: false },
      { kind: "buyback", memberId: "c4", instanceId: twin, label: "ドナ　空き5", disabled: false },
      { kind: "buyback", memberId: "c5", instanceId: twin, label: "エル　空き6", disabled: false },
      { kind: "buyback", memberId: "c6", instanceId: twin, label: "フィン　空き5", disabled: false },
      back,
    ]);
    expect(townEntries({ buyback: sword }, m, S).filter((e) => e.kind === "buyback").every((e) => e.kind === "buyback" && e.disabled)).toBe(true);
    expect(townEntries("shopBuyback", menuOf(town()), S)).toEqual([{ kind: "empty", label: "買い戻せる品はない", disabled: true }, back]);
    expect(townParent({ buyback: twin })).toBe("shopBuyback");
    expect(townPageIntro({ buyback: twin }, m)).toEqual(["town.shop.whom"]);
  });

  test("UI-52/IT-65 鑑定は全員の未鑑定の品（持ち主・未鑑定の名前・鑑定料 identifyFee）。払えなければ disabled。押すと identify", () => {
    const fee = data.config.economy.identifyFee;
    const s = town({ c3: { life: "dead", hp: 0 } }, fee);
    const a = createItemInstance(s, { itemId: "long_sword", identified: false });
    const b = createItemInstance(s, { itemId: "charm", identified: false });
    s.party[2]!.inventory.push(a);
    s.party[0]!.inventory.push(b);
    expect(townEntries("shopIdentify", menuOf(s), S)).toEqual([
      { kind: "identify", memberId: "c1", instanceId: b, label: `アルド: 飾り？　${fee}G`, disabled: false },
      { kind: "identify", memberId: "c3", instanceId: a, label: `キリ: 剣？　${fee}G`, disabled: false },
      back,
    ]);
    s.gold = fee - 1;
    expect(townEntries("shopIdentify", menuOf(s), S).filter((e) => e.kind === "identify").every((e) => e.kind === "identify" && e.disabled)).toBe(true);
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
    expect(townPageIntro({ withdraw: kept }, m)).toEqual(["town.storage.whom"]);
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
