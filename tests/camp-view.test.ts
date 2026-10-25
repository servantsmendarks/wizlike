// UI-53 / UI-59 / TW-03 キャンプ・キャラクター画面・酒場の段（views/camp.ts の純粋な状態機械。M4 の field-items.test を移した）。
// 値は core の campMenu と fieldItemMenu だけ（UI-35）。送る Command は core が受け付けることも確かめる。
// 既定のパーティ（dived(1)）: c1 アルド 戦士（inv i4 薬草）、c2 ベルク 戦士（inv なし）、c3 キリ 盗賊（inv i10 薬草）、c4 ドナ 僧侶（inv i13 解毒草、呪文 heal）、
// c5 エル 魔術師（inv i15 帰還の糸、呪文 fire_arrow / sleep_mist は battle 専用）、c6 フィン 盗賊（inv i18 薬草）。使用枠の上限は c1・c2 が 9（M17。素の力 14・15）、ほかは 8。
// M10（2026-10-07）: キャンプの top を 状態（メンバー一覧）・並び順・戻る に減らし、呪文・道具・装備・鑑定の段はキャラクター画面（UI-59）の下に移した。
// 旧い段（唱える者・使う人・誰の装備・鑑定する者の名前の枠）のテストは消し、同じ中身をキャラクター画面の下の段で確かめる形に書き直した。
import { afterEach, describe, expect, test, vi } from "vitest";
import { execute } from "../src/core/engine";
import { campMenu, campSummary, identifyChance } from "../src/core/rules/camp";
import { bestiaryView } from "../src/core/rules/item-view";
import { fieldItemMenu } from "../src/core/rules/items";
import { itemActions } from "../src/core/rules/item-actions";
import { cloneState, createItemInstance, itemDisplayName } from "../src/core/state";
import type { Character, Command, GameState } from "../src/core/types";
import {
  CAMP_GRID_SLOTS,
  campCanCycle,
  campCharacterOpen,
  campItemActions,
  campCycle,
  campEntries,
  campFirstPage,
  campHeader,
  campKeyIndex,
  characterItemKey,
  campPanel,
  campRepair,
  campRows,
  campStep,
  campSwipeDir,
  createCampView,
  type CampEntries,
  type CampEntry,
  type CampInput,
  type CampPage,
  warehouseRowLabel,
} from "../src/presenter/views/camp";
import { CHARACTER_INVENTORY_CELLS, formatCharacter } from "../src/presenter/views/detail";
import { formatMessage } from "../src/presenter/views/message";
import { kinsokuLines } from "./helpers/wrap";
import { dived } from "./helpers/battle";
import { data, expectKnownStringKeys, newGame } from "./helpers/core";
import { cursedDagger } from "./helpers/items";

const S = data.strings;

function patched(base: GameState, patches: Record<string, Partial<Character>> = {}): GameState {
  const s = cloneState(base);
  for (const [id, p] of Object.entries(patches)) {
    const i = s.party.findIndex((c) => c.id === id);
    s.party[i] = { ...s.party[i]!, ...structuredClone(p) };
  }
  return s;
}
const inDungeon = (patches: Record<string, Partial<Character>> = {}) => patched(dived(1), patches);
const inTown = (patches: Record<string, Partial<Character>> = {}) => patched(newGame(1), patches);

function input(s: GameState): CampInput {
  const menu = campMenu(s, data);
  if (menu === null) throw new Error("no camp menu");
  return {
    menu,
    items: fieldItemMenu(s, data),
    summary: campSummary(s, data),
    identifyMpCost: data.config.identify.mpCost,
    bestiary: bestiaryView(s, data),
    itemActions: campItemActions(menu, (memberId, instanceId) => itemActions(s, data, memberId, instanceId)), // UI-80（M20）
  };
}

/** 送った Command を core が受け付けること */
function accepted(s: GameState, cmd: Command): GameState {
  const r = execute(s, cmd, data);
  expect(r.events.some((e) => e.kind === "rejected"), JSON.stringify(r.events)).toBe(false);
  expectKnownStringKeys(r.events);
  return r.state;
}

const cancel = { label: S["common.cancel"]!, disabled: false, choice: { kind: "cancel" } } satisfies CampEntry;
const back = { label: S["common.back"]!, disabled: false, choice: { kind: "cancel" } } satisfies CampEntry;

function grid(e: CampEntries): (CampEntry | null)[] {
  if (e.layout !== "grid") throw new Error("not grid");
  return e.slots;
}
function rows(e: CampEntries): CampEntry[] {
  if (e.layout !== "list") throw new Error("not list");
  return e.rows;
}
const labels = (xs: readonly (CampEntry | null)[]) => xs.map((x) => (x === null ? null : x.label));
const character = (memberId: string): CampPage => ({ kind: "character", memberId });
/** UI-80（M20）: 品の段 */
const itemPage = (memberId: string, instanceId: string): CampPage => ({ kind: "item", memberId, instanceId });

describe("UI-53 キャンプの top（M10）", () => {
  test("UI-53 top は 8 枠: 状態・並び順・空き・敵を待つ / 呪文・空き 2 つ・戻る（帰還の糸を使えなければ 3 つ目は空き。M18 で 4 つ目に辺りを探る（M19 で「敵を待つ」に改名）、5 つ目に呪文）。見出しは camp.prompt.top。状態はメンバー一覧へ", () => {
    const m = input(inDungeon({ c5: { classId: "bishop", inventory: [] } }));
    const e = grid(campEntries("camp", { kind: "top" }, m, S));
    expect(e).toHaveLength(CAMP_GRID_SLOTS);
    expect(labels(e)).toEqual(["状態", "並び順", "糸で帰る", "敵を待つ", "呪文", null, null, "戻る"]); // M22 D-2: 使えなくても dim で置く
    expect(e[7]!.choice).toEqual({ kind: "cancel" });
    expect(campHeader({ kind: "top" }, m, S)).toBe("キャンプ　どうする？");
    expect(campStep("camp", { kind: "top" }, m, { kind: "cancel" })).toEqual({ kind: "close" });
    expect(campStep("camp", { kind: "top" }, m, e[0]!.choice)).toEqual({ kind: "page", page: { kind: "members" } });
    expect(campStep("camp", { kind: "top" }, m, e[1]!.choice)).toEqual({ kind: "page", page: { kind: "order", picked: null } });
    expect(campFirstPage("camp")).toEqual({ kind: "top" });
  });

  test("UI-53 メンバー一覧: 名前の 6 枠と [7] 戻る。人を選ぶとキャラクター画面、戻るで top。パネルは場所の見出しだけ", () => {
    const m = input(inDungeon());
    const p: CampPage = { kind: "members" };
    const e = grid(campEntries("camp", p, m, S));
    expect(labels(e)).toEqual(["アルド", "ベルク", "キリ", "ドナ", "エル", "フィン", null, "戻る"]);
    expect(e[7]).toEqual(back);
    expect(campHeader(p, m, S)).toBe("誰を見る？");
    expect(campStep("camp", p, m, e[3]!.choice)).toEqual({ kind: "page", page: character("c4") });
    expect(campStep("camp", p, m, { kind: "cancel" })).toEqual({ kind: "page", page: { kind: "top" } });
    expect(campPanel(p, m, S)).toEqual({ kind: "text", title: "キャンプ" });
    expect(campCharacterOpen(p)).toBe(false);
  });

  test("UI-53/UI-59 キャラクター画面の下の段のやめるは同じ人のキャラクター画面（酒場でも閉じない）。キャラクター画面の戻るはキャンプならメンバー一覧、酒場なら閉じる", () => {
    const m = input(inDungeon({ c5: { classId: "bishop" } }));
    const toCharacter: CampPage[] = [
      { kind: "equip", stage: "slot", memberId: "c1" },
      { kind: "use", stage: "item", memberId: "c1" },
      { kind: "give", stage: "item", memberId: "c1", page: 0 },
      { kind: "drop", stage: "item", memberId: "c1", page: 0 },
      { kind: "spell", stage: "spell", memberId: "c1", page: 0 },
      { kind: "identify", memberId: "c1" },
    ];
    for (const p of toCharacter) {
      const e = campEntries("camp", p, m, S);
      const k = campKeyIndex("back", e);
      expect(k, JSON.stringify(p)).not.toBeNull();
      expect(campRows(e)[k!], JSON.stringify(p)).toEqual(cancel);
      for (const host of ["camp", "tavern"] as const) {
        expect(campStep(host, p, m, { kind: "cancel" }), `${host} ${JSON.stringify(p)}`).toEqual({ kind: "page", page: character("c1") });
      }
      expect(campHeader(p, m, S)).not.toMatch(/[{}]/);
    }
    // 2 段目以下のやめるは 1 つ上の段
    const up: [CampPage, CampPage][] = [
      [{ kind: "equip", stage: "item", memberId: "c1", slot: "weapon" }, { kind: "equip", stage: "slot", memberId: "c1" }],
      [{ kind: "use", stage: "target", memberId: "c1", instanceId: "i4" }, { kind: "use", stage: "item", memberId: "c1" }],
      [{ kind: "give", stage: "to", memberId: "c1", instanceId: "i4" }, { kind: "give", stage: "item", memberId: "c1", page: 0 }],
      [{ kind: "drop", stage: "confirm", memberId: "c1", instanceId: "i4" }, { kind: "drop", stage: "item", memberId: "c1", page: 0 }],
      // UI-68（M10）: 呪文は 一覧 → 説明 → 対象。対象のやめるは説明、説明のやめるは一覧
      [{ kind: "spell", stage: "target", memberId: "c4", spellId: "heal" }, { kind: "spell", stage: "info", memberId: "c4", spellId: "heal" }],
      [{ kind: "spell", stage: "info", memberId: "c4", spellId: "heal" }, { kind: "spell", stage: "spell", memberId: "c4", page: 0 }],
    ];
    for (const [p, to] of up) {
      for (const host of ["camp", "tavern"] as const) expect(campStep(host, p, m, { kind: "cancel" }), JSON.stringify(p)).toEqual({ kind: "page", page: to });
    }
    expect(campStep("camp", character("c1"), m, { kind: "cancel" })).toEqual({ kind: "page", page: { kind: "members" } });
    expect(campStep("tavern", character("c1"), m, { kind: "cancel" })).toEqual({ kind: "close" });
    expect(campKeyIndex("back", campEntries("camp", character("c1"), m, S))).toBe(7);
  });
});

describe("UI-59 キャラクター画面（M10）", () => {
  test("UI-59/UI-80（M20）操作の枠は [呪文][次の人] / [空き]…[戻る]（装備・使う・渡す・捨てる・鑑定はパネルの品を押して品の段から。M21 から司教だけ 3 つ目に鑑定）。見出しは {name}の状態", () => {
    const m = input(inDungeon({ c5: { classId: "bishop" } }));
    const e = grid(campEntries("camp", character("c1"), m, S));
    expect(labels(e)).toEqual(["呪文", "次の人", null, null, null, null, null, "戻る"]);
    // アルドは呪文を知らないので呪文は dim。M21（A-1）: 鑑定の枠は司教（エル）だけ
    expect(e.map((x) => x?.disabled ?? null)).toEqual([true, false, null, null, null, null, null, false]);
    expect(labels(grid(campEntries("camp", character("c5"), m, S)))).toEqual(["呪文", "次の人", "鑑定", null, null, null, null, "戻る"]);
    expect(campHeader(character("c1"), m, S)).toBe("アルドの状態");
    // ドナ（治癒）は呪文が押せる。UI-68（M10）: エル（戦闘専用の呪文だけ）も、説明を見るために呪文が押せる（M10 の UI-59 では dim だった）
    expect(grid(campEntries("camp", character("c4"), m, S))[0]!.disabled).toBe(false);
    expect(grid(campEntries("camp", character("c5"), m, S))[0]!.disabled).toBe(false);
    // キーは 1・2・8
    const ce = campEntries("camp", character("c1"), m, S);
    expect([campKeyIndex({ menu: 0 }, ce), campKeyIndex({ menu: 1 }, ce), campKeyIndex({ menu: 2 }, ce), campKeyIndex("back", ce)]).toEqual([0, 1, null, 7]);
    const go = (i: number) => campStep("camp", character("c1"), m, e[i]!.choice);
    expect(go(0)).toEqual({ kind: "page", page: { kind: "spell", stage: "spell", memberId: "c1", page: 0 } });
    expect(go(1)).toEqual({ kind: "page", page: character("c2") });
  });

  test("UI-80/CH-44/U6（M20）品の段の使うは行動できない者で dim（core の itemActions の cannotAct。押すと理由）。死亡の者でも渡す・捨てるは押せる", () => {
    const m = input(inDungeon({ c1: { status: ["sleep"] }, c3: { life: "dead", hp: 0 } }));
    const sleep = grid(campEntries("camp", itemPage("c1", "i4"), m, S));
    expect(sleep.slice(1, 4).map((x) => x!.disabled)).toEqual([true, false, false]);
    expect(sleep[1]!.reason).toBe("アルドは動けない。");
    const dead = grid(campEntries("camp", itemPage("c3", "i10"), m, S));
    expect(dead.slice(1, 4).map((x) => x!.disabled)).toEqual([true, false, false]);
  });

  test("UI-80/CH-77（M20）品の段の鑑定は未鑑定の品で、パーティに鑑定できる者がいるときだけ（core の itemActions）。「鑑定 {rate}%」で、送れなければ dim と理由", () => {
    const s = inDungeon({ c5: { classId: "bishop", mp: 5 } });
    const dag = cursedDagger(s, false);
    s.party[0]!.inventory.push(dag);
    const m = input(s);
    const rate = identifyChance(s, data, "c5", dag)!.rate;
    const ok = grid(campEntries("camp", itemPage("c1", dag), m, S))[4]!;
    expect(ok).toEqual({ label: `鑑定 ${rate}%`, disabled: false, choice: { kind: "itemAction", action: "identify" } });
    // 送るのは鑑定する者（司教 c5）の party.identify。送った後も同じ品の段
    const r = campStep("camp", itemPage("c1", dag), m, ok.choice);
    expect(r).toEqual({ kind: "send", command: { type: "party.identify", memberId: "c5", instanceId: dag }, after: itemPage("c1", dag) });
    if (r.kind === "send") accepted(s, r.command);
    const noMp = grid(campEntries("camp", itemPage("c1", dag), input(patched(s, { c5: { mp: 0 } })), S))[4]!;
    expect([noMp.disabled, noMp.reason]).toEqual([true, "エルは MP が足りない。"]);
    const asleep = grid(campEntries("camp", itemPage("c1", dag), input(patched(s, { c5: { status: ["sleep"] } })), S))[4]!;
    expect([asleep.disabled, asleep.reason]).toEqual([true, "エルは動けない。"]);
    // 鑑定済みの品・鑑定できる者がいないときは空き枠
    expect(grid(campEntries("camp", itemPage("c1", "i4"), m, S))[4]).toBeNull();
    expect(grid(campEntries("camp", itemPage("c1", dag), input(patched(s, { c5: { classId: "mage" } })), S))[4]).toBeNull();
  });

  test("UI-59 次の人・← / → は並び順で巡回する（campCycle。キャラクター画面のときだけ）", () => {
    const m = input(inDungeon());
    expect(campCycle(character("c6"), m, 1)).toEqual(character("c1"));
    expect(campCycle(character("c1"), m, -1)).toEqual(character("c6"));
    expect(campCycle(character("c3"), m, 1)).toEqual(character("c4"));
    expect(campStep("camp", character("c6"), m, { kind: "nextMember" })).toEqual({ kind: "page", page: character("c1") });
    expect(campCycle({ kind: "members" }, m, 1)).toBeNull();
    expect(campCycle({ kind: "equip", stage: "slot", memberId: "c1" }, m, 1)).toBeNull();
  });

  test("UI-59/UI-33/UI-30（M16）前後の人は campCanCycle（キャラクター画面そのもので 2 人以上）の間だけ。スワイプは指を左へで次（+1）、右へで前（−1）、上下は null", () => {
    const m = input(inDungeon());
    expect(campCanCycle(character("c1"), m)).toBe(true);
    for (const p of [{ kind: "top" }, { kind: "members" }, { kind: "equip", stage: "slot", memberId: "c1" }, { kind: "use", stage: "item", memberId: "c1" }, { kind: "order", picked: null }] satisfies CampPage[]) {
      expect(campCanCycle(p, m), JSON.stringify(p)).toBe(false);
    }
    // 1 人だけなら出さない（「次の人」の枠の dim と同じ）
    const one: CampInput = { ...m, menu: { ...m.menu, members: m.menu.members.slice(0, 1) } };
    expect(campCanCycle(character("c1"), one)).toBe(false);
    expect(grid(campEntries("camp", character("c1"), one, S))[1]!.disabled).toBe(true); // M20（UI-80）: 次の人は 2 つ目の枠
    expect([campSwipeDir("left"), campSwipeDir("right"), campSwipeDir("forward"), campSwipeDir("around"), campSwipeDir("confirm")]).toEqual([1, -1, null, null, null]);
    // スワイプの向きを campCycle に渡すと: c3 で指を左へ → c4、右へ → c2
    expect(campCycle(character("c3"), m, campSwipeDir("left")!)).toEqual(character("c4"));
    expect(campCycle(character("c3"), m, campSwipeDir("right")!)).toEqual(character("c2"));
  });

  test("UI-59 パネルはキャラクター画面（装備の品の段だけ focusSlot、呪文・渡す・捨てるの品の段は頁）。キャラクター画面の間は campCharacterOpen が真", () => {
    const m = input(inDungeon());
    // UI-80（M20）: キャラクター画面そのものは品を押せる（tappable と畳んだ所持品の頁）
    expect(campPanel(character("c1"), m, S)).toEqual({ kind: "character", memberId: "c1", focusSlot: null, tappable: true, inventoryFold: 0 });
    expect(campPanel({ kind: "equip", stage: "slot", memberId: "c1" }, m, S)).toEqual({ kind: "character", memberId: "c1", focusSlot: null });
    expect(campPanel({ kind: "equip", stage: "item", memberId: "c1", slot: "helm" }, m, S)).toEqual({ kind: "character", memberId: "c1", focusSlot: "helm" });
    // UI-67（M10）: 品の詳細には装備の差分の引数（装備中の品は外すときの null）
    expect(campPanel({ kind: "equip", stage: "detail", memberId: "c1", slot: "weapon", instanceId: "i1" }, m, S)).toEqual({
      kind: "item",
      instanceId: "i1",
      preview: { memberId: "c1", slot: "weapon", instanceId: null },
    });
    expect(campPanel({ kind: "spell", stage: "spell", memberId: "c4", page: 0 }, m, S)).toEqual({ kind: "character", memberId: "c4", focusSlot: null, spellPage: 0 });
    // UI-68（M10）: 説明の段と対象の段は呪文の枠をその呪文の説明に置き換える
    expect(campPanel({ kind: "spell", stage: "info", memberId: "c4", spellId: "heal" }, m, S)).toEqual({
      kind: "character",
      memberId: "c4",
      focusSlot: null,
      spellPage: 0,
      spellInfo: "heal",
    });
    expect(campPanel({ kind: "spell", stage: "target", memberId: "c4", spellId: "heal" }, m, S)).toEqual({
      kind: "character",
      memberId: "c4",
      focusSlot: null,
      spellPage: 0,
      spellInfo: "heal",
    });
    expect(campPanel({ kind: "give", stage: "item", memberId: "c1", page: 0 }, m, S)).toEqual({ kind: "character", memberId: "c1", focusSlot: null, inventoryPage: 0 });
    expect(campPanel({ kind: "drop", stage: "confirm", memberId: "c1", instanceId: "i4" }, m, S)).toEqual({ kind: "character", memberId: "c1", focusSlot: null });
    const open: CampPage[] = [
      character("c1"),
      { kind: "equip", stage: "detail", memberId: "c1", slot: "weapon", instanceId: "i1" },
      { kind: "use", stage: "confirmReturn", memberId: "c5", instanceId: "i15" },
      { kind: "give", stage: "to", memberId: "c1", instanceId: "i4" },
      { kind: "identify", memberId: "c1" },
    ];
    for (const p of open) expect(campCharacterOpen(p), JSON.stringify(p)).toBe(true);
    for (const p of [{ kind: "top" }, { kind: "members" }, { kind: "order", picked: null }, { kind: "book" }] satisfies CampPage[]) {
      expect(campCharacterOpen(p), JSON.stringify(p)).toBe(false);
    }
  });
});

describe("MG-44/UI-59 呪文（キャラクター画面の下）", () => {
  test("MG-44/UI-59 習得呪文の一覧「{name}  MP{mp}」（戦闘外で唱えられない呪文は dim）→ 対象。送ったら同じ者の呪文の段へ", () => {
    const s = inDungeon({ c1: { hp: 1 } });
    const m = input(s);
    const sp: CampPage = { kind: "spell", stage: "spell", memberId: "c4", page: 0 };
    expect(rows(campEntries("camp", sp, m, S))).toEqual([{ label: "治癒  MP2", disabled: false, choice: { kind: "spell", spellId: "heal" }, peek: true }, cancel]);
    expect(campHeader(sp, m, S)).toBe("ドナの呪文");
    // UI-68（M10）: 呪文を選ぶと説明の段（[唱える][やめる]）、唱えるで対象の段
    const info: CampPage = { kind: "spell", stage: "info", memberId: "c4", spellId: "heal" };
    const tgt: CampPage = { kind: "spell", stage: "target", memberId: "c4", spellId: "heal" };
    expect(campStep("camp", sp, m, { kind: "spell", spellId: "heal" })).toEqual({ kind: "page", page: info });
    expect(rows(campEntries("camp", info, m, S))).toEqual([{ label: "唱える", disabled: false, choice: { kind: "confirm" } }, cancel]);
    expect(campHeader(info, m, S)).toBe("ドナの呪文");
    expect(campStep("camp", info, m, { kind: "confirm" })).toEqual({ kind: "page", page: tgt });
    expect(campHeader(tgt, m, S)).toBe("誰に唱える？");
    const tr = rows(campEntries("camp", tgt, m, S));
    expect(tr.map((x) => x.choice)).toEqual([...["c1", "c2", "c3", "c4", "c5", "c6"].map((id) => ({ kind: "target", targetId: id })), { kind: "cancel" }]);
    expect(tr[0]!.label).toBe(`アルド　1/${s.party[0]!.hpMax}`);
    const r2 = campStep("camp", tgt, m, { kind: "target", targetId: "c1" });
    expect(r2).toEqual({ kind: "send", command: { type: "dungeon.cast", memberId: "c4", spellId: "heal", targetId: "c1" }, after: sp });
    if (r2.kind !== "send") throw new Error("not send");
    accepted(s, r2.command);
    // 戦闘専用の呪文（エルの火矢・眠りの霧）は一覧に出るが dim。UI-68（M10）: dim でも選べて（peek）説明の段へ進み、唱えるは dim で送らない
    const el: CampPage = { kind: "spell", stage: "spell", memberId: "c5", page: 0 };
    expect(rows(campEntries("camp", el, m, S)).map((x) => [x.label, x.disabled, x.peek ?? false])).toEqual([
      ["火矢  MP2", true, true],
      ["眠りの霧  MP3", true, true],
      ["やめる", false, false],
    ]);
    const elInfo: CampPage = { kind: "spell", stage: "info", memberId: "c5", spellId: "fire_arrow" };
    expect(campStep("camp", el, m, { kind: "spell", spellId: "fire_arrow" })).toEqual({ kind: "page", page: elInfo });
    expect(rows(campEntries("camp", elInfo, m, S))[0]).toEqual({ label: "唱える", disabled: true, choice: { kind: "confirm" } });
    expect(campStep("camp", elInfo, m, { kind: "confirm" })).toEqual({ kind: "page", page: elInfo });
    // 覚えていない呪文は説明の段へ進まない
    expect(campStep("camp", el, m, { kind: "spell", spellId: "heal" })).toEqual({ kind: "page", page: el });
  });

  test("UI-68 説明の段の campRepair: 覚えている間は成り立ち（唱えられなくても）、忘れたら一覧へ。対象の段で唱えられなくなったら一覧へ", () => {
    const s = inDungeon();
    const info: CampPage = { kind: "spell", stage: "info", memberId: "c4", spellId: "heal" };
    expect(campRepair("camp", info, input(patched(s, { c4: { mp: 0 } })))).toBe(info);
    expect(campRepair("camp", info, input(patched(s, { c4: { knownSpells: [] } })))).toEqual({ kind: "spell", stage: "spell", memberId: "c4", page: 0 });
    const tgt: CampPage = { kind: "spell", stage: "target", memberId: "c4", spellId: "heal" };
    expect(campRepair("camp", tgt, input(patched(s, { c4: { mp: 0 } })))).toEqual({ kind: "spell", stage: "spell", memberId: "c4", page: 0 });
  });

  test("MG-40/MG-42/UI-59 帰還（対象なし）は呪文の段で送る。蘇生は対象の段で死者（camp.prompt.spellDead）を選ぶ", () => {
    const s = inDungeon({ c4: { knownSpells: ["heal", "return", "resurrect"], mp: 30 }, c2: { life: "dead", hp: 0 } });
    const m = input(s);
    const sp: CampPage = { kind: "spell", stage: "spell", memberId: "c4", page: 0 };
    // UI-68（M10）: 対象なしの呪文も説明の段を通り、唱えるで送る
    const retInfo: CampPage = { kind: "spell", stage: "info", memberId: "c4", spellId: "return" };
    expect(campStep("camp", sp, m, { kind: "spell", spellId: "return" })).toEqual({ kind: "page", page: retInfo });
    const r = campStep("camp", retInfo, m, { kind: "confirm" });
    expect(r).toEqual({ kind: "send", command: { type: "dungeon.cast", memberId: "c4", spellId: "return" }, after: sp });
    if (r.kind !== "send") throw new Error("not send");
    expect(accepted(s, r.command).screen).toBe("town");
    const resInfo: CampPage = { kind: "spell", stage: "info", memberId: "c4", spellId: "resurrect" };
    const tgt: CampPage = { kind: "spell", stage: "target", memberId: "c4", spellId: "resurrect" };
    expect(campStep("camp", sp, m, { kind: "spell", spellId: "resurrect" })).toEqual({ kind: "page", page: resInfo });
    expect(campStep("camp", resInfo, m, { kind: "confirm" })).toEqual({ kind: "page", page: tgt });
    expect(campHeader(tgt, m, S)).toBe("誰を蘇らせる？");
    expect(rows(campEntries("camp", tgt, m, S))).toEqual([{ label: "ベルク", disabled: false, choice: { kind: "target", targetId: "c2" } }, cancel]);
    const r2 = campStep("camp", tgt, m, { kind: "target", targetId: "c2" });
    if (r2.kind !== "send") throw new Error("not send");
    accepted(s, r2.command);
  });

  test("UI-53/MG-44 回復の対象の段: HP 満タンの者は dim で「（傷はない）」を付ける（core の targets の block。治癒・薬草とも）。解毒の対象は dim にしない", () => {
    const s = inDungeon({ c1: { hp: 1 }, c4: { knownSpells: ["heal", "cure_poison"], mp: 30 } });
    const m = input(s);
    const heal = rows(campEntries("camp", { kind: "spell", stage: "target", memberId: "c4", spellId: "heal" }, m, S));
    expect(heal[0]).toEqual({ label: `アルド　1/${s.party[0]!.hpMax}`, disabled: false, choice: { kind: "target", targetId: "c1" } });
    expect(heal[1]).toEqual({ label: `ベルク　${s.party[1]!.hp}/${s.party[1]!.hpMax}（傷はない）`, disabled: true, choice: { kind: "target", targetId: "c2" } });
    expect(heal.slice(1, 6).every((r) => r.disabled)).toBe(true);
    const cure = rows(campEntries("camp", { kind: "spell", stage: "target", memberId: "c4", spellId: "cure_poison" }, m, S));
    expect(cure.slice(0, 6).every((r) => !r.disabled)).toBe(true);
    const herb = rows(campEntries("camp", { kind: "use", stage: "target", memberId: "c1", instanceId: "i4" }, m, S));
    expect(herb.slice(0, 6).map((r) => r.disabled)).toEqual([false, true, true, true, true, true]);
    expect(herb[2]!.label).toBe(`キリ　${s.party[2]!.hp}/${s.party[2]!.hpMax}（傷はない）`);
  });

  test("UI-59 呪文が 15 件以上なら 14 件ずつの頁と [次の頁][前の頁]（端は dim）。頁送りでパネルの spellPage も同じ頁", () => {
    const m = input(inDungeon());
    const many = structuredClone(m);
    const c4 = many.menu.members.find((x) => x.id === "c4")!;
    c4.knownSpells = Array.from({ length: 16 }, (_, i) => ({ spellId: `sp${i}`, name: `呪${i}`, mp: 1, castable: false }));
    const p0: CampPage = { kind: "spell", stage: "spell", memberId: "c4", page: 0 };
    const r0 = rows(campEntries("camp", p0, many, S));
    expect(r0).toHaveLength(14 + 2 + 1);
    expect(r0.slice(14).map((x) => [x.label, x.disabled])).toEqual([
      ["次の頁", false],
      ["前の頁", true],
      ["やめる", false],
    ]);
    const p1 = campStep("camp", p0, many, { kind: "pageTurn", delta: 1 });
    expect(p1).toEqual({ kind: "page", page: { ...p0, page: 1 } });
    const r1 = rows(campEntries("camp", { ...p0, page: 1 }, many, S));
    expect(r1.map((x) => x.label)).toEqual(["呪14  MP1", "呪15  MP1", "次の頁", "前の頁", "やめる"]);
    expect(r1.slice(2, 4).map((x) => x.disabled)).toEqual([true, false]);
    expect(campStep("camp", { ...p0, page: 1 }, many, { kind: "pageTurn", delta: 1 })).toEqual({ kind: "page", page: { ...p0, page: 1 } });
    expect(campPanel({ ...p0, page: 1 }, many, S)).toEqual({ kind: "character", memberId: "c4", focusSlot: null, spellPage: 1 });
    // 14 件以下なら頁送りの行は無い
    expect(rows(campEntries("camp", p0, m, S)).map((x) => x.label)).toEqual(["治癒  MP2", "やめる"]);
  });
});

describe("UI-59/UI-53 使う（M4 の道具の段をキャラクター画面の下へ）", () => {
  test("UI-59/MG-25 使うの段: 消耗品と魔法書（usable 偽は dim）とやめる。見出しは {name}の道具", () => {
    const s = inDungeon();
    const book = createItemInstance(s, { itemId: "tome_lightning", identified: true });
    s.party[0]!.inventory.push(book);
    const m = input(s);
    const p: CampPage = { kind: "use", stage: "item", memberId: "c1" };
    expect(rows(campEntries("camp", p, m, S))).toEqual([
      { label: "薬草", disabled: false, choice: { kind: "item", instanceId: "i4" } },
      { label: "雷光の魔法書", disabled: true, choice: { kind: "item", instanceId: book } },
      cancel,
    ]);
    expect(campHeader(p, m, S)).toBe("アルドの道具");
  });

  test("UI-53/DG-30 帰還の糸は確認の段の「戻る」で送る。薬草は対象の段から targetId 付きで送る。送った後は同じ人の使うの段", () => {
    const s = inDungeon({ c2: { hp: 5 } });
    const m = input(s);
    const itemPage: CampPage = { kind: "use", stage: "item", memberId: "c5" };
    const confirm: CampPage = { kind: "use", stage: "confirmReturn", memberId: "c5", instanceId: "i15" };
    for (const host of ["camp", "tavern"] as const) {
      expect(campStep(host, itemPage, m, { kind: "item", instanceId: "i15" })).toEqual({ kind: "page", page: confirm });
      expect(campStep(host, confirm, m, { kind: "cancel" })).toEqual({ kind: "page", page: itemPage });
      expect(campStep(host, confirm, m, { kind: "item", instanceId: "i15" })).toEqual({ kind: "page", page: confirm });
    }
    expect(rows(campEntries("camp", confirm, m, S))).toEqual([{ label: "糸を使う", disabled: false, choice: { kind: "confirm" } }, cancel]);
    expect(campHeader(confirm, m, S)).toBe("帰還の糸で街へ戻る？");
    const r = campStep("camp", confirm, m, { kind: "confirm" });
    expect(r).toEqual({ kind: "send", command: { type: "dungeon.useItem", memberId: "c5", itemId: "i15" }, after: itemPage });
    if (r.kind !== "send") throw new Error("not send");
    expect(accepted(s, r.command).screen).toBe("town");
    const c1: CampPage = { kind: "use", stage: "item", memberId: "c1" };
    const tgt: CampPage = { kind: "use", stage: "target", memberId: "c1", instanceId: "i4" };
    expect(campStep("camp", c1, m, { kind: "item", instanceId: "i4" })).toEqual({ kind: "page", page: tgt });
    expect(campHeader(tgt, m, S)).toBe("誰に使う？");
    const r2 = campStep("camp", tgt, m, { kind: "target", targetId: "c2" });
    expect(r2).toEqual({ kind: "send", command: { type: "dungeon.useItem", memberId: "c1", itemId: "i4", targetId: "c2" }, after: c1 });
    if (r2.kind !== "send") throw new Error("not send");
    accepted(s, r2.command);
    expect(campRepair("camp", confirm, m)).toBe(confirm);
  });

  test("UI-53 帰還の糸でない対象なしの品は使うの段ですぐ送る", () => {
    const m = input(inDungeon());
    const items = structuredClone(m.items!);
    const it = items.members.find((x) => x.id === "c1")!.items.find((x) => x.instanceId === "i4")!;
    Object.assign(it, { target: "none", isReturn: false, usable: true });
    const p: CampPage = { kind: "use", stage: "item", memberId: "c1" };
    expect(campStep("camp", p, { ...m, items }, { kind: "item", instanceId: "i4" })).toEqual({
      kind: "send",
      command: { type: "dungeon.useItem", memberId: "c1", itemId: "i4" },
      after: p,
    });
  });

  test("UI-53 使うの段の直し: 品が消えた・使えなくなったら同じ者の使うの段、使う者が行動できなければキャラクター画面", () => {
    const confirm: CampPage = { kind: "use", stage: "confirmReturn", memberId: "c5", instanceId: "i15" };
    const gone = inDungeon();
    gone.party[4]!.inventory = gone.party[4]!.inventory.filter((x) => x !== "i15");
    expect(campRepair("camp", confirm, input(gone))).toEqual({ kind: "use", stage: "item", memberId: "c5" });
    // 街では帰還の糸は usable false
    expect(campRepair("tavern", confirm, input(inTown()))).toEqual({ kind: "use", stage: "item", memberId: "c5" });
    expect(campRepair("camp", confirm, input(inDungeon({ c5: { status: ["sleep"] } })))).toEqual(character("c5"));
    expect(campRepair("tavern", { kind: "use", stage: "item", memberId: "c5" }, input(inTown({ c5: { status: ["sleep"] } })))).toEqual(character("c5"));
  });

  test("UI-53/DG-30 酒場の使うの段: 薬草は対象の段から送れて core が受け付ける。帰還の糸は dim（街では usable false）", () => {
    const s = inTown({ c2: { hp: 2 } });
    const m = input(s);
    const elItems = rows(campEntries("tavern", { kind: "use", stage: "item", memberId: "c5" }, m, S));
    expect(elItems.find((x) => x.choice.kind === "item" && x.choice.instanceId === "i15")!.disabled).toBe(true);
    const p: CampPage = { kind: "use", stage: "item", memberId: "c1" };
    const r1 = campStep("tavern", p, m, { kind: "item", instanceId: "i4" });
    if (r1.kind !== "page") throw new Error("not page");
    const r2 = campStep("tavern", r1.page, m, { kind: "target", targetId: "c2" });
    expect(r2).toEqual({ kind: "send", command: { type: "dungeon.useItem", memberId: "c1", itemId: "i4", targetId: "c2" }, after: p });
    if (r2.kind !== "send") throw new Error("not send");
    accepted(s, r2.command);
  });
});

describe("CH-76/UI-59 装備（キャラクター画面の下）", () => {
  test("CH-76/UI-59 枠（6 枠。パネルはキャラクター画面）→ 品（外す・候補・やめる。パネルはその枠を focus）→ 詳細", () => {
    const s = inDungeon();
    const cap = createItemInstance(s, { itemId: "leather_cap", identified: true });
    const sword = createItemInstance(s, { itemId: "long_sword", identified: true });
    s.party[4]!.inventory.push(cap, sword); // c5 エル（魔術師）
    const m = input(s);
    const slotPage: CampPage = { kind: "equip", stage: "slot", memberId: "c5" };
    expect(labels(grid(campEntries("camp", slotPage, m, S)))).toEqual(["武器", "防具", "盾", "兜", "小手", "装飾", null, "やめる"]);
    expect(campHeader(slotPage, m, S)).toBe("エルのどこを？");
    const weapon: CampPage = { kind: "equip", stage: "item", memberId: "c5", slot: "weapon" };
    const staff = m.menu.members.find((x) => x.id === "c5")!.slots.find((x) => x.slot === "weapon")!.instanceId!;
    expect(campStep("camp", slotPage, m, { kind: "slot", slot: "weapon" })).toEqual({ kind: "page", page: weapon });
    expect(campHeader(weapon, m, S)).toBe("エルの武器");
    expect(rows(campEntries("camp", weapon, m, S))).toEqual([
      { label: "外す", disabled: false, choice: { kind: "unequip" } },
      { label: "杖（装備中）", disabled: false, choice: { kind: "detail", instanceId: staff } },
      { label: "長剣（装備できない）", disabled: false, choice: { kind: "detail", instanceId: sword } },
      cancel,
    ]);
    const un = campStep("camp", weapon, m, { kind: "unequip" });
    expect(un).toEqual({ kind: "send", command: { type: "party.unequip", memberId: "c5", slot: "weapon" }, after: slotPage });
    if (un.kind !== "send") throw new Error("not send");
    const swordDetail: CampPage = { kind: "equip", stage: "detail", memberId: "c5", slot: "weapon", instanceId: sword };
    expect(campStep("camp", weapon, m, { kind: "detail", instanceId: sword })).toEqual({ kind: "page", page: swordDetail });
    expect(rows(campEntries("camp", swordDetail, m, S))).toEqual([
      { label: "装備する（装備できない）", disabled: true, choice: { kind: "equip", instanceId: sword }, reason: "エルは長剣を装備できない。" },
      cancel,
    ]);
    expect(campStep("tavern", swordDetail, m, { kind: "cancel" })).toEqual({ kind: "page", page: weapon }); // 酒場でも閉じない
    const staffDetail: CampPage = { kind: "equip", stage: "detail", memberId: "c5", slot: "weapon", instanceId: staff };
    expect(rows(campEntries("camp", staffDetail, m, S))).toEqual([{ label: "外す", disabled: false, choice: { kind: "unequip" } }, cancel]);
    expect(campStep("camp", staffDetail, m, { kind: "unequip" })).toEqual(un);
    accepted(s, un.command);
    const helm: CampPage = { kind: "equip", stage: "item", memberId: "c5", slot: "helm" };
    expect(rows(campEntries("camp", helm, m, S))).toEqual([{ label: "革兜", disabled: false, choice: { kind: "detail", instanceId: cap } }, cancel]);
    const capDetail: CampPage = { kind: "equip", stage: "detail", memberId: "c5", slot: "helm", instanceId: cap };
    const eq = campStep("camp", capDetail, m, { kind: "equip", instanceId: cap });
    expect(eq).toEqual({ kind: "send", command: { type: "party.equip", memberId: "c5", instanceId: cap }, after: slotPage });
    if (eq.kind !== "send") throw new Error("not send");
    const after = accepted(s, eq.command);
    expect(campRepair("camp", capDetail, input(after))).toEqual(capDetail);
    expect(campRepair("camp", { ...capDetail, instanceId: sword }, input(after))).toEqual(helm);
    expect(rows(campEntries("camp", { kind: "equip", stage: "item", memberId: "c5", slot: "shield" }, m, S))).toEqual([
      { label: "装備できる物がない", disabled: true, choice: { kind: "none" } },
      cancel,
    ]);
  });

  test("CH-73/UI-53 呪われた品を装備していると「外す」は dim、候補は「呪いで外せない」で、その詳細の「装備する」が dim", () => {
    let s = inDungeon();
    const cursed = cursedDagger(s, true);
    s.party[2]!.inventory.push(cursed);
    s = accepted(s, { type: "party.equip", memberId: "c3", instanceId: cursed });
    const m = input(s);
    expect(rows(campEntries("camp", { kind: "equip", stage: "item", memberId: "c3", slot: "weapon" }, m, S))).toEqual([
      { label: "外す", disabled: true, choice: { kind: "unequip" } },
      { label: "短剣（装備中）", disabled: false, choice: { kind: "detail", instanceId: cursed }, tone: "danger" }, // M24 B-1: 鑑定済みの呪われた品
      { label: "短剣（呪いで外せない）", disabled: false, choice: { kind: "detail", instanceId: "i7" } },
      cancel,
    ]);
    // UI-59（M10）: dim の「装備する（{why}）」は押すと理由を語る
    expect(rows(campEntries("camp", { kind: "equip", stage: "detail", memberId: "c3", slot: "weapon", instanceId: "i7" }, m, S))[0]).toEqual({
      label: "装備する（呪いで外せない）",
      disabled: true,
      choice: { kind: "equip", instanceId: "i7" },
      reason: `${m.menu.members.find((x) => x.id === "c3")!.name}の今の装備は呪われていて、外せない。`,
    });
  });

  test("CH-76/U6 死亡の者の装備の段も成り立ち、呪われていない品は外せる（core が受け付ける）。装備するは「動けない」で dim", () => {
    const s = inDungeon({ c1: { life: "dead", hp: 0 } });
    const cap = createItemInstance(s, { itemId: "leather_cap", identified: true });
    s.party[0]!.inventory.push(cap);
    const m = input(s);
    const weapon: CampPage = { kind: "equip", stage: "item", memberId: "c1", slot: "weapon" };
    expect(campRepair("camp", weapon, m)).toBe(weapon);
    const un = rows(campEntries("camp", weapon, m, S))[0]!;
    expect(un).toEqual({ label: "外す", disabled: false, choice: { kind: "unequip" } });
    const r = campStep("camp", weapon, m, un.choice);
    if (r.kind !== "send") throw new Error("not send");
    const after = accepted(s, r.command);
    expect(after.party[0]!.equipment.weapon).toBeNull();
    const helm = rows(campEntries("camp", { kind: "equip", stage: "item", memberId: "c1", slot: "helm" }, m, S));
    expect(helm[0]!.label).toBe("革兜（動けない）");
    expect(rows(campEntries("camp", { kind: "equip", stage: "detail", memberId: "c1", slot: "helm", instanceId: cap }, m, S))[0]).toEqual({
      label: "装備する（動けない）",
      disabled: true,
      choice: { kind: "equip", instanceId: cap },
      reason: "アルドは動けない。",
    });
  });

  test("UI-59/CH-76 未鑑定の品の「装備する（未鑑定）」は dim で、押すと理由「{item}は未鑑定で、装備できない。」を語る", () => {
    const s = inDungeon();
    const id = cursedDagger(s, false);
    s.party[0]!.inventory.push(id);
    const m = input(s);
    const c = m.menu.members.find((x) => x.id === "c1")!.equipCandidates.find((x) => x.instanceId === id)!;
    expect(c.block).toBe("unidentified");
    expect(rows(campEntries("camp", { kind: "equip", stage: "detail", memberId: "c1", slot: c.slot, instanceId: id }, m, S))).toEqual([
      { label: "装備する（未鑑定）", disabled: true, choice: { kind: "equip", instanceId: id }, reason: `${c.name}は未鑑定で、装備できない。` },
      cancel,
    ]);
  });
});

describe("CH-78/UI-59 渡す", () => {
  test("CH-78/UI-59 品（所持品の順）→ 相手（自分以外。使用枠が満杯の者は「（持てない）」で dim）→ party.give。送った後は同じ者の品の段", () => {
    const s = inDungeon();
    // ベルクの使用枠を満杯にする（装備 2 + 所持品 7 = 9。素の力 15 で上限 9: CH-71 M17）
    for (let i = 0; i < 7; i++) s.party[1]!.inventory.push(createItemInstance(s, { itemId: "herb", identified: true }));
    const m = input(s);
    const p: CampPage = { kind: "give", stage: "item", memberId: "c1", page: 0 };
    expect(rows(campEntries("camp", p, m, S))).toEqual([{ label: "薬草", disabled: false, choice: { kind: "item", instanceId: "i4" } }, cancel]);
    expect(campHeader(p, m, S)).toBe("アルドは何を渡す？");
    const to: CampPage = { kind: "give", stage: "to", memberId: "c1", instanceId: "i4" };
    expect(campStep("camp", p, m, { kind: "item", instanceId: "i4" })).toEqual({ kind: "page", page: to });
    expect(campStep("camp", p, m, { kind: "item", instanceId: "nope" })).toEqual({ kind: "page", page: p });
    expect(campHeader(to, m, S)).toBe("誰に渡す？");
    expect(rows(campEntries("camp", to, m, S)).map((x) => [x.label, x.disabled])).toEqual([
      ["ベルク（持てない）", true],
      ["キリ", false],
      ["ドナ", false],
      ["エル", false],
      ["フィン", false],
      ["やめる", false],
    ]);
    const r = campStep("camp", to, m, { kind: "target", targetId: "c4" });
    expect(r).toEqual({ kind: "send", command: { type: "party.give", memberId: "c1", instanceId: "i4", toId: "c4" }, after: p });
    if (r.kind !== "send") throw new Error("not send");
    const after = accepted(s, r.command);
    expect(after.party[3]!.inventory).toContain("i4");
    // 渡した後は品が手元に無いので、相手の段は品の段へ直す
    expect(campRepair("camp", to, input(after))).toEqual(p);
    // 自分には渡さない
    expect(campStep("camp", to, m, { kind: "target", targetId: "c1" })).toEqual({ kind: "page", page: to });
  });

  test("CH-78/U6 死亡・灰の者の品も渡せる（core が受け付ける）", () => {
    const s = inDungeon({ c1: { life: "ash", hp: 0 } });
    const m = input(s);
    expect(grid(campEntries("camp", itemPage("c1", "i4"), m, S))[2]!.disabled).toBe(false); // M20（UI-80）: 品の段の渡す
    const r = campStep("camp", { kind: "give", stage: "to", memberId: "c1", instanceId: "i4" }, m, { kind: "target", targetId: "c2" });
    if (r.kind !== "send") throw new Error("not send");
    expect(accepted(s, r.command).party[1]!.inventory).toEqual(["i4"]);
  });

  test("UI-59 所持品が 9 件以上なら 8 件ずつの頁と [次の頁][前の頁]。頁はパネルの inventoryPage と同じ。頁が減ったら campRepair で最後の頁へ", () => {
    const m = input(inDungeon());
    const many = structuredClone(m);
    const c1 = many.menu.members.find((x) => x.id === "c1")!;
    c1.inventory = Array.from({ length: 10 }, (_, i) => ({ instanceId: `x${i}`, name: `品${i}`, identified: true, kind: "consumable" as const, cursed: false }));
    const p0: CampPage = { kind: "drop", stage: "item", memberId: "c1", page: 0 };
    expect(rows(campEntries("camp", p0, many, S)).map((x) => x.label)).toEqual([...Array.from({ length: 8 }, (_, i) => `品${i}`), "次の頁", "前の頁", "やめる"]);
    expect(campStep("camp", p0, many, { kind: "pageTurn", delta: 1 })).toEqual({ kind: "page", page: { ...p0, page: 1 } });
    expect(rows(campEntries("camp", { ...p0, page: 1 }, many, S)).map((x) => x.label)).toEqual(["品8", "品9", "次の頁", "前の頁", "やめる"]);
    expect(campPanel({ ...p0, page: 1 }, many, S)).toEqual({ kind: "character", memberId: "c1", focusSlot: null, inventoryPage: 1 });
    // 確認の段のやめるは品が載る頁へ戻る
    expect(campStep("camp", { kind: "drop", stage: "confirm", memberId: "c1", instanceId: "x9" }, many, { kind: "cancel" })).toEqual({ kind: "page", page: { ...p0, page: 1 } });
    expect(campRepair("camp", { ...p0, page: 1 }, m)).toEqual(p0);
  });
});

describe("CH-79/UI-59 捨てる", () => {
  test("CH-79/UI-59 品 → 確認（問いは「{item}を捨てる。よいか。」、一覧は 捨てる / やめる）→ party.drop。やめるは品の段", () => {
    const s = inDungeon();
    const m = input(s);
    const p: CampPage = { kind: "drop", stage: "item", memberId: "c1", page: 0 };
    expect(campHeader(p, m, S)).toBe("アルドは何を捨てる？");
    const confirm: CampPage = { kind: "drop", stage: "confirm", memberId: "c1", instanceId: "i4" };
    expect(campStep("camp", p, m, { kind: "item", instanceId: "i4" })).toEqual({ kind: "page", page: confirm });
    expect(campHeader(confirm, m, S)).toBe("薬草を捨てる。よいか。");
    const e = campEntries("camp", confirm, m, S);
    expect(rows(e)).toEqual([{ label: "捨てる", disabled: false, choice: { kind: "confirm" } }, cancel]);
    expect(campKeyIndex("confirm", e)).toBe(0);
    expect(campKeyIndex("back", e)).toBe(1);
    expect(campStep("camp", confirm, m, { kind: "cancel" })).toEqual({ kind: "page", page: p });
    const r = campStep("camp", confirm, m, { kind: "confirm" });
    expect(r).toEqual({ kind: "send", command: { type: "party.drop", memberId: "c1", instanceId: "i4" }, after: p });
    if (r.kind !== "send") throw new Error("not send");
    const after = accepted(s, r.command);
    expect(after.party[0]!.inventory).toEqual([]);
    expect(campRepair("camp", confirm, input(after))).toEqual(p);
  });
});

describe("CH-77/UI-59 鑑定（キャラクター画面の下）", () => {
  // M10 §6: 行に成功率（core の identifyRates）、見出しに 1 回の MP（config.identify.mpCost）を足した（旧「{owner}: {name}」・「何を鑑定する？」）
  test("CH-77/UI-59 品の一覧は「{owner}: {name}　{rate}%」（パーティ全員の未鑑定品。rate は core の identifyChance）。見出しは 1 回の MP。送ったら同じ段。品が無ければ「鑑定する物がない」（dim）", () => {
    const s = inDungeon({ c5: { classId: "bishop", mp: 5 } });
    const p: CampPage = { kind: "identify", memberId: "c5" };
    expect(rows(campEntries("camp", p, input(s), S))).toEqual([{ label: "鑑定する物がない", disabled: true, choice: { kind: "none" } }, cancel]);
    const id = cursedDagger(s, false);
    s.party[0]!.inventory.push(id);
    const m = input(s);
    expect(campHeader(p, m, S)).toBe(`何を鑑定する？（1 回 MP ${data.config.identify.mpCost}）`);
    // エル（知恵 16・Lv1）: 基本 60 + (16 − 10) × 3 = 78。品は通常の希少度で補正なし
    expect(identifyChance(s, data, "c5", id)?.rate).toBe(78);
    expect(rows(campEntries("camp", p, m, S))).toEqual([{ label: "アルド: 短い刃？　78%", disabled: false, choice: { kind: "identifyItem", instanceId: id } }, cancel]);
    const r = campStep("camp", p, m, { kind: "identifyItem", instanceId: id });
    expect(r).toEqual({ kind: "send", command: { type: "party.identify", memberId: "c5", instanceId: id }, after: p });
    if (r.kind !== "send") throw new Error("not send");
    accepted(s, r.command);
    // 鑑定できない職業の者の鑑定の段はキャラクター画面へ直す
    expect(campRepair("camp", { kind: "identify", memberId: "c1" }, m)).toEqual(character("c1"));
    expect(campRepair("camp", p, m)).toBe(p);
  });

  test("CH-77/UI-59 MP が足りない間・動けない間は品の行が dim で、押すと core の identifyBlock の理由を語る（可否は canIdentifyNow だけ）。段はそのまま", () => {
    const s = inDungeon({ c5: { classId: "bishop", mp: 0 } });
    const id = cursedDagger(s, false);
    s.party[0]!.inventory.push(id);
    const p: CampPage = { kind: "identify", memberId: "c5" };
    const m = input(s);
    const x = m.menu.members.find((y) => y.id === "c5")!;
    expect([x.canIdentifyNow, x.identifyBlock]).toEqual([false, "noMp"]);
    expect(rows(campEntries("camp", p, m, S))).toEqual([
      { label: "アルド: 短い刃？　78%", disabled: true, choice: { kind: "identifyItem", instanceId: id }, reason: "エルは MP が足りない。" },
      cancel,
    ]);
    expect(campRepair("camp", p, m)).toBe(p);
    // 1 回鑑定して MP が尽きたら、取り直した値で dim になる
    const t = inDungeon({ c5: { classId: "bishop", mp: data.config.identify.mpCost } });
    const a = cursedDagger(t, false);
    const b = cursedDagger(t, false);
    t.party[0]!.inventory.push(a, b);
    const after = accepted(t, { type: "party.identify", memberId: "c5", instanceId: a });
    const left = rows(campEntries("camp", p, input(after), S)).filter((r) => r?.choice.kind === "identifyItem");
    expect(left.length).toBeGreaterThan(0);
    for (const r of left) expect(r).toMatchObject({ disabled: true, reason: "エルは MP が足りない。" });
  });
});

describe("UI-59/UI-80/CH-77 キャラクター画面の鑑定の入口（M21 A-1）", () => {
  const units = (x: string): number => Array.from(x).reduce((n, c) => n + ((c.codePointAt(0) ?? 0) < 0x80 ? 0.5 : 1), 0);

  test("UI-59/UI-80（M21）鑑定の枠は鑑定できる職業の者（identifyBlock が cannotIdentify でない）だけ 3 つ目（キー 3）。ほかの人では空き枠。酒場でも同じ", () => {
    const s = inDungeon({ c5: { classId: "bishop", mp: 5 } });
    s.party[0]!.inventory.push(cursedDagger(s, false));
    const m = input(s);
    for (const host of ["camp", "tavern"] as const) {
      const e = grid(campEntries(host, character("c5"), m, S));
      expect(e[2]).toEqual({ label: "鑑定", disabled: false, choice: { kind: "action", action: "identify" } });
      expect(campKeyIndex({ menu: 2 }, campEntries(host, character("c5"), m, S))).toBe(2);
      for (const id of ["c1", "c2", "c3", "c4", "c6"]) {
        expect(m.menu.members.find((x) => x.id === id)!.identifyBlock).toBe("cannotIdentify");
        expect(grid(campEntries(host, character(id), m, S))[2], id).toBeNull();
      }
    }
    // 街（酒場の状態）でも出る
    const t = inTown({ c5: { classId: "bishop", mp: 5 } });
    t.party[0]!.inventory.push(cursedDagger(t, false));
    expect(grid(campEntries("tavern", character("c5"), input(t), S))[2]).toMatchObject({ label: "鑑定", disabled: false });
  });

  test("UI-59/CH-77（M21）送れない間（MP 不足・動けない・未鑑定品なし）は dim で、押すと core の identifyBlock の理由", () => {
    const s = inDungeon({ c5: { classId: "bishop", mp: 5 } });
    s.party[0]!.inventory.push(cursedDagger(s, false));
    const slot = (t: GameState) => grid(campEntries("camp", character("c5"), input(t), S))[2]!;
    const noMp = slot(patched(s, { c5: { mp: 0 } }));
    expect([noMp.disabled, noMp.reason]).toEqual([true, "エルは MP が足りない。"]);
    const asleep = slot(patched(s, { c5: { status: ["sleep"] } }));
    expect([asleep.disabled, asleep.reason]).toEqual([true, "エルは動けない。"]);
    const none = slot(inDungeon({ c5: { classId: "bishop", mp: 5 } }));
    expect(none).toMatchObject({ label: "鑑定", disabled: true, reason: "鑑定する品が無い。" });
    // 送れる間は dim でなく理由も無い
    expect([slot(s).disabled, slot(s).reason]).toEqual([false, undefined]);
  });

  test("UI-59/CH-77（M21）段の流れ: キャラクター画面の鑑定 → 鑑定の一覧（memberId はその者）→ 送った後も一覧 → 品が尽きれば「鑑定する物がない」。やめるでキャラクター画面", () => {
    const s = inDungeon({ c5: { classId: "bishop", mp: 5 } });
    const a = cursedDagger(s, false);
    const b = cursedDagger(s, false);
    s.party[0]!.inventory.push(a);
    s.party[2]!.inventory.push(b);
    const m = input(s);
    const list: CampPage = { kind: "identify", memberId: "c5" };
    const e = grid(campEntries("camp", character("c5"), m, S));
    expect(campStep("camp", character("c5"), m, e[2]!.choice)).toEqual({ kind: "page", page: list });
    expect(campHeader(list, m, S)).toBe(`何を鑑定する？（1 回 MP ${data.config.identify.mpCost}）`);
    const r1 = rows(campEntries("camp", list, m, S));
    expect(r1.map((x) => x.choice)).toEqual([{ kind: "identifyItem", instanceId: a }, { kind: "identifyItem", instanceId: b }, { kind: "cancel" }]);
    expect(r1[1]!.label).toMatch(/^キリ: /);
    const step = campStep("camp", list, m, r1[0]!.choice);
    expect(step).toEqual({ kind: "send", command: { type: "party.identify", memberId: "c5", instanceId: a }, after: list });
    if (step.kind !== "send") throw new Error("not send");
    const s1 = accepted(s, step.command);
    // 結果の後も一覧（成功なら a は一覧から消え、失敗なら残る。b は残る）
    const m1 = input(s1);
    expect(campRepair("camp", list, m1)).toBe(list);
    const left = rows(campEntries("camp", list, m1, S)).filter((x) => x.choice.kind === "identifyItem");
    expect(left.map((x) => x.choice)).toContainEqual({ kind: "identifyItem", instanceId: b });
    // 未鑑定品を全部鑑定済みにすると「鑑定する物がない」（dim）と やめる
    const done = cloneState(s1);
    for (const id of [a, b]) done.items[id]!.identified = true;
    expect(rows(campEntries("camp", list, input(done), S))).toEqual([{ label: "鑑定する物がない", disabled: true, choice: { kind: "none" } }, cancel]);
    for (const host of ["camp", "tavern"] as const) expect(campStep(host, list, m, { kind: "cancel" })).toEqual({ kind: "page", page: character("c5") });
    // 品の段からの鑑定（identifier）はそのまま
    expect(campStep("camp", itemPage("c1", a), m, { kind: "itemAction", action: "identify" })).toEqual({
      kind: "send",
      command: { type: "party.identify", memberId: "c5", instanceId: a },
      after: itemPage("c1", a),
    });
  });

  test("UI-59/CH-77（M21）文の長さ: 枠のラベルは枠の幅 48px、一覧の見出しは 28 字、行は 21 字（6 字の名前・最も長い未鑑定名・95%）、理由は 28 字 × 2 行", () => {
    expect(units(S["character.identify"]!) * 8).toBeLessThanOrEqual(48);
    expect(units(formatMessage(S["camp.prompt.identifyWhich"]!, { cost: 99 }))).toBeLessThanOrEqual(28);
    const name = "あ".repeat(data.config.creation.nameMaxLength);
    const unidentified = [...data.items.map((it) => it.unidentifiedName ?? it.name), ...data.equipmentBases.map((b) => b.unidentifiedName)];
    for (const item of unidentified) {
      const row = formatMessage(S["camp.identifyRow"]!, { owner: name, name: item, rate: data.config.identify.max });
      expect(units(row), row).toBeLessThanOrEqual(21);
    }
    expect(units(S["camp.identify.none"]!)).toBeLessThanOrEqual(21);
    for (const b of ["cannotAct", "noMp", "noUnidentified"]) {
      const text = formatMessage(S[`camp.identifyBlock.${b}`]!, { name });
      expect(kinsokuLines(text, 28).length, text).toBeLessThanOrEqual(2);
    }
  });
});

describe("CH-03/UI-53 並び順", () => {
  test("CH-03/UI-53 1 人目を選ぶと picked、同じ人で解除、2 人目で 2 人を入れ替えた全員の order を送る。パネルは順の表", () => {
    const s = inDungeon();
    const m = input(s);
    const p0: CampPage = { kind: "order", picked: null };
    expect(campHeader(p0, m, S)).toBe("入れ替える者を選ぶ");
    const p1: CampPage = { kind: "order", picked: "c1" };
    expect(campStep("camp", p0, m, { kind: "member", memberId: "c1" })).toEqual({ kind: "page", page: p1 });
    expect(campHeader(p1, m, S)).toBe("アルドと入れ替える者は？");
    expect(campStep("camp", p1, m, { kind: "member", memberId: "c1" })).toEqual({ kind: "page", page: p0 });
    expect(campPanel(p1, m, S)).toEqual({
      kind: "order",
      rows: [
        { n: 1, name: "アルド", row: "前衛", picked: true },
        { n: 2, name: "ベルク", row: "前衛", picked: false },
        { n: 3, name: "キリ", row: "前衛", picked: false },
        { n: 4, name: "ドナ", row: "後衛", picked: false },
        { n: 5, name: "エル", row: "後衛", picked: false },
        { n: 6, name: "フィン", row: "後衛", picked: false },
      ],
    });
    const r2 = campStep("camp", p1, m, { kind: "member", memberId: "c5" });
    expect(r2).toEqual({ kind: "send", command: { type: "party.reorder", order: ["c5", "c2", "c3", "c4", "c1", "c6"] }, after: p0 });
    if (r2.kind !== "send") throw new Error("not send");
    expect(accepted(s, r2.command).party.map((c) => c.id)).toEqual(["c5", "c2", "c3", "c4", "c1", "c6"]);
    // やめるはキャンプなら top、酒場なら閉じる
    expect(campStep("camp", p0, m, { kind: "cancel" })).toEqual({ kind: "page", page: { kind: "top" } });
    expect(campStep("tavern", p0, m, { kind: "cancel" })).toEqual({ kind: "close" });
  });
});

describe("TW-03/UI-52 酒場とキャンプの共有（M10）", () => {
  test("TW-03 酒場の最初のページ: 状態は先頭の者（帯のタップならその人）のキャラクター画面、並び順は未選択、図鑑。パネルの見出しは「酒場」", () => {
    const m = input(inTown());
    expect(m.items).not.toBeNull();
    expect(campFirstPage("tavern", "status", m.menu)).toEqual(character("c1"));
    expect(campFirstPage("tavern", "status", m.menu, "c3")).toEqual(character("c3"));
    expect(campFirstPage("tavern", "order", m.menu)).toEqual({ kind: "order", picked: null });
    expect(campFirstPage("tavern", "book", m.menu)).toEqual({ kind: "book" });
    expect(campPanel({ kind: "members" }, m, S)).toEqual({ kind: "text", title: "酒場" });
  });

  test("UI-53/MG-44 酒場のキャラクター画面から治癒を唱えられ（core が街で受け付ける）、送った後の段は成り立つ。帰還は dim", () => {
    const s = inTown({ c4: { knownSpells: ["heal", "return"], mp: 30 }, c1: { hp: 3 } });
    const m = input(s);
    const sp: CampPage = { kind: "spell", stage: "spell", memberId: "c4", page: 0 };
    const list = rows(campEntries("tavern", sp, m, S));
    expect(list.find((x) => x.choice.kind === "spell" && x.choice.spellId === "heal")!.disabled).toBe(false);
    expect(list.find((x) => x.choice.kind === "spell" && x.choice.spellId === "return")!.disabled).toBe(true);
    const r0 = campStep("tavern", sp, m, { kind: "spell", spellId: "heal" });
    if (r0.kind !== "page") throw new Error("not page");
    // UI-68（M10）: 説明の段 → 唱える → 対象
    const r1 = campStep("tavern", r0.page, m, { kind: "confirm" });
    if (r1.kind !== "page") throw new Error("not page");
    const r2 = campStep("tavern", r1.page, m, { kind: "target", targetId: "c1" });
    expect(r2).toEqual({ kind: "send", command: { type: "dungeon.cast", memberId: "c4", spellId: "heal", targetId: "c1" }, after: sp });
    if (r2.kind !== "send") throw new Error("not send");
    const after = accepted(s, r2.command);
    expect(after.screen).toBe("town");
    expect(campRepair("tavern", sp, input(after))).toBe(sp);
  });

  test("UI-53 迷宮のキャンプの top だけ、見出しの下に campSummary の 4 行（迷宮名と階・所持金・今回の収穫・帰還の糸）。他の段と酒場には出さない", () => {
    const s = inDungeon();
    s.gold = 230;
    s.dive!.floor = 2;
    s.dive!.ledger = { items: ["i15"], gold: 30 };
    expect(campPanel({ kind: "top" }, input(s), S)).toEqual({
      kind: "text",
      title: "キャンプ",
      lines: ["試しの坑道　2F", "所持金　230 G", "今回の収穫　30 G・1品", "帰還の糸　1本（エル）"],
    });
    expect(campPanel({ kind: "members" }, input(s), S)).toEqual({ kind: "text", title: "キャンプ" });
    const town = input(inTown());
    expect(town.summary).toBeNull();
    expect(campPanel({ kind: "top" }, town, S)).toEqual({ kind: "text", title: "酒場" });
  });

  test("UI-53/TW-15 宿の士気がある間は、迷宮のキャンプの top の要約に 5 行目「宿の士気　あり」を足す", () => {
    const s = inDungeon();
    s.morale = { rankId: "good" };
    const p = campPanel({ kind: "top" }, input(s), S);
    expect(p.kind === "text" && p.lines).toHaveLength(5);
    expect(p.kind === "text" && p.lines?.[4]).toBe("宿の士気　あり");
  });
});

describe("DG-30/UI-53（M16）top の「糸で帰る」", () => {
  test("DG-30/UI-53 3 つ目の枠「糸で帰る」は core の returnItem の品の確認の段（from top）へ。やめるで top、確認で useItem を送って街へ。キャラクター画面は開かない", () => {
    const s = inDungeon();
    const m = input(s);
    const e = grid(campEntries("camp", { kind: "top" }, m, S));
    expect(labels(e)).toEqual(["状態", "並び順", "糸で帰る", "敵を待つ", "呪文", null, null, "戻る"]);
    const confirm: CampPage = { kind: "use", stage: "confirmReturn", memberId: "c5", instanceId: "i15", from: "top" };
    expect(e[2]).toEqual({ label: "糸で帰る", disabled: false, choice: { kind: "open", page: confirm } });
    expect(campStep("camp", { kind: "top" }, m, e[2]!.choice)).toEqual({ kind: "page", page: confirm });
    expect(campCharacterOpen(confirm)).toBe(false);
    expect(campPanel(confirm, m, S)).toEqual({ kind: "text", title: "キャンプ" });
    expect(campHeader(confirm, m, S)).toBe("帰還の糸で街へ戻る？");
    expect(rows(campEntries("camp", confirm, m, S))).toEqual([{ label: "糸を使う", disabled: false, choice: { kind: "confirm" } }, cancel]);
    expect(campStep("camp", confirm, m, { kind: "cancel" })).toEqual({ kind: "page", page: { kind: "top" } });
    const r = campStep("camp", confirm, m, { kind: "confirm" });
    expect(r).toEqual({ kind: "send", command: { type: "dungeon.useItem", memberId: "c5", itemId: "i15" }, after: { kind: "top" } });
    if (r.kind !== "send") throw new Error("not send");
    expect(accepted(s, r.command).screen).toBe("town");
    expect(campRepair("camp", confirm, m)).toBe(confirm);
    // 持ち主が動けなくなった・品が消えたら top へ（キャラクター画面には行かない）
    expect(campRepair("camp", confirm, input(inDungeon({ c5: { status: ["sleep"] } })))).toEqual({ kind: "top" });
    expect(campRepair("camp", confirm, input(inDungeon({ c5: { inventory: [] } })))).toEqual({ kind: "top" });
  });

  test("DG-30/UI-53 使える帰還の品が無ければ 3 つ目は dim の「糸で帰る」で（M22 D-2）、要約の行は持ち主なしの「帰還の糸　n本」（持ち主が動けない 1 本も数える）", () => {
    const s = inDungeon({ c5: { status: ["sleep"] } });
    const m = input(s);
    expect(m.summary!.returnItem).toBeNull();
    const dim = grid(campEntries("camp", { kind: "top" }, m, S))[2]!;
    expect(dim.label).toBe("糸で帰る");
    expect(dim.disabled).toBe(true);
    expect(dim.reason).toBe("糸を持つ者が動けない。"); // 本数はあるが使える者がいない
    const p = campPanel({ kind: "top" }, m, S);
    expect(p.kind === "text" && p.lines?.[3]).toBe("帰還の糸　1本");
    const none = input(inDungeon({ c5: { inventory: [] } }));
    const noneDim = grid(campEntries("camp", { kind: "top" }, none, S))[2]!;
    expect(noneDim.disabled).toBe(true);
    expect(noneDim.reason).toBe("糸が無い。上り階段から帰れる。"); // 本数 0
    for (const r of [dim.reason!, noneDim.reason!]) expect(kinsokuLines(r, 28).length).toBeLessThanOrEqual(2);
    const q = campPanel({ kind: "top" }, none, S);
    expect(q.kind === "text" && q.lines?.[3]).toBe("帰還の糸　0本");
    // 要約の行は名前 6 字でも 29 字以内（パネルの幅 232 = 全角 29 字）
    expect(S["camp.summary.return"]!.replace("{count}", "12").replace("{owner}", "アルドリンド").length).toBeLessThanOrEqual(29);
  });
});

describe("DG-45/UI-53（M18。M19 で改名）top の「敵を待つ」", () => {
  test("DG-45/UI-53 迷宮のキャンプの top の 4 つ目の枠は「敵を待つ」（M19。糸の有無で位置は動かない）。押すとキャンプを閉じて dungeon.search を送り（確認なし）、core が受け付ける", () => {
    for (const s of [inDungeon(), inDungeon({ c5: { inventory: [] } })]) {
      const m = input(s);
      const e = grid(campEntries("camp", { kind: "top" }, m, S));
      expect(e[3]).toEqual({ label: "敵を待つ", disabled: false, choice: { kind: "search" } });
      const r = campStep("camp", { kind: "top" }, m, e[3]!.choice);
      expect(r).toEqual({ kind: "closeSend", command: { type: "dungeon.search" } });
      if (r.kind !== "closeSend") throw new Error("not closeSend");
      const after = accepted(s, r.command);
      expect(after.adventureTurns).toBe(s.adventureTurns + 1);
    }
    // ラベルは 56×40 の枠に収まる（美咲の全角 8px × 5 字 = 40px）
    expect([...S["camp.search"]!].length * 8).toBeLessThanOrEqual(56 - 4);
  });

  test("DG-45/UI-53 迷宮の外（campSummary が null）の top には出さない", () => {
    const m = input(inTown());
    expect(m.summary).toBeNull();
    expect(grid(campEntries("camp", { kind: "top" }, m, S))[3]).toBeNull();
  });
});

describe("UI-53/MG-44（M18）top の「呪文」", () => {
  test("UI-53/MG-44 top の 5 つ目の枠は「呪文」で術者の段へ。術者の段は名前の 6 枠と [7] やめる（いま唱えられる呪文（castable）の無い者は dim で、押しても進まない）。見出しは camp.prompt.spellWho。やめるで top", () => {
    const s = inDungeon({ c1: { hp: 1 } });
    const m = input(s);
    const e = grid(campEntries("camp", { kind: "top" }, m, S));
    expect(e[4]).toEqual({ label: "呪文", disabled: false, choice: { kind: "open", page: { kind: "spellWho" } } });
    const who: CampPage = { kind: "spellWho" };
    expect(campStep("camp", { kind: "top" }, m, e[4]!.choice)).toEqual({ kind: "page", page: who });
    // ドナ（治癒）だけ押せる。エルの呪文は戦闘専用で dim、戦士・盗賊は呪文が無く dim
    const g = grid(campEntries("camp", who, m, S));
    expect(g.map((x) => (x === null ? null : [x.label, x.disabled]))).toEqual([
      ["アルド", true],
      ["ベルク", true],
      ["キリ", true],
      ["ドナ", false],
      ["エル", true],
      ["フィン", true],
      null,
      ["やめる", false],
    ]);
    expect(g[7]).toEqual(cancel);
    expect(campHeader(who, m, S)).toBe("誰が唱える？");
    expect(campPanel(who, m, S)).toEqual({ kind: "text", title: "キャンプ" });
    expect(campCharacterOpen(who)).toBe(false);
    expect(campStep("camp", who, m, { kind: "cancel" })).toEqual({ kind: "page", page: { kind: "top" } });
    expect(campStep("camp", who, m, g[4]!.choice)).toEqual({ kind: "page", page: who });
    expect(campStep("camp", who, m, g[3]!.choice)).toEqual({ kind: "page", page: { kind: "spell", stage: "spell", memberId: "c4", page: 0, from: "top" } });
    // MP が足りなければ（castable 偽）ドナも dim
    const m0 = input(patched(s, { c4: { mp: 0 } }));
    expect(grid(campEntries("camp", who, m0, S))[3]!.disabled).toBe(true);
    expect(campStep("camp", who, m0, { kind: "member", memberId: "c4" })).toEqual({ kind: "page", page: who });
    // ラベルは 56×40 の枠に収まる
    expect([...S["camp.spell"]!].length * 8).toBeLessThanOrEqual(56 - 4);
    expect([...S["camp.prompt.spellWho"]!].length).toBeLessThanOrEqual(28);
  });

  test("UI-53/MG-44 術者の後は既存の呪文の段（from top）: 一覧 → 説明 → 対象 → dungeon.cast を送って top へ。やめるは 対象 → 説明 → 一覧 → 術者。パネルはキャラクター画面", () => {
    const s = inDungeon({ c1: { hp: 1 } });
    const m = input(s);
    const sp: CampPage = { kind: "spell", stage: "spell", memberId: "c4", page: 0, from: "top" };
    const info: CampPage = { kind: "spell", stage: "info", memberId: "c4", spellId: "heal", from: "top" };
    const tgt: CampPage = { kind: "spell", stage: "target", memberId: "c4", spellId: "heal", from: "top" };
    expect(rows(campEntries("camp", sp, m, S))).toEqual([{ label: "治癒  MP2", disabled: false, choice: { kind: "spell", spellId: "heal" }, peek: true }, cancel]);
    expect(campHeader(sp, m, S)).toBe("ドナの呪文");
    expect(campCharacterOpen(sp)).toBe(true);
    expect(campPanel(sp, m, S)).toEqual({ kind: "character", memberId: "c4", focusSlot: null, spellPage: 0 });
    expect(campStep("camp", sp, m, { kind: "spell", spellId: "heal" })).toEqual({ kind: "page", page: info });
    expect(campStep("camp", info, m, { kind: "confirm" })).toEqual({ kind: "page", page: tgt });
    expect(campHeader(tgt, m, S)).toBe("誰に唱える？");
    const r = campStep("camp", tgt, m, { kind: "target", targetId: "c1" });
    expect(r).toEqual({ kind: "send", command: { type: "dungeon.cast", memberId: "c4", spellId: "heal", targetId: "c1" }, after: { kind: "top" } });
    if (r.kind !== "send") throw new Error("not send");
    const after = accepted(s, r.command);
    expect(after.party[0]!.hp).toBeGreaterThan(1);
    expect(campCharacterOpen(r.after)).toBe(false);
    // やめるの行き先
    expect(campStep("camp", tgt, m, { kind: "cancel" })).toEqual({ kind: "page", page: info });
    expect(campStep("camp", info, m, { kind: "cancel" })).toEqual({ kind: "page", page: sp });
    expect(campStep("camp", sp, m, { kind: "cancel" })).toEqual({ kind: "page", page: { kind: "spellWho" } });
  });

  test("MG-40/UI-53 top の「呪文」から帰還（対象なし）は説明の段の唱えるで送り、送った後は top（core が受け付けて街へ）", () => {
    const s = inDungeon({ c4: { knownSpells: ["heal", "return"], mp: 30 } });
    const m = input(s);
    const info: CampPage = { kind: "spell", stage: "info", memberId: "c4", spellId: "return", from: "top" };
    const r = campStep("camp", info, m, { kind: "confirm" });
    expect(r).toEqual({ kind: "send", command: { type: "dungeon.cast", memberId: "c4", spellId: "return" }, after: { kind: "top" } });
    if (r.kind !== "send") throw new Error("not send");
    expect(accepted(s, r.command).screen).toBe("town");
  });

  test("UI-53 from top の段の campRepair: 唱えられなくなったら同じ者の一覧（from top のまま）、人がいなくなったら術者の段。術者の段はキャンプではそのまま", () => {
    const s = inDungeon();
    const tgt: CampPage = { kind: "spell", stage: "target", memberId: "c4", spellId: "heal", from: "top" };
    expect(campRepair("camp", tgt, input(patched(s, { c4: { mp: 0 } })))).toEqual({ kind: "spell", stage: "spell", memberId: "c4", page: 0, from: "top" });
    const info: CampPage = { kind: "spell", stage: "info", memberId: "c4", spellId: "heal", from: "top" };
    expect(campRepair("camp", info, input(patched(s, { c4: { knownSpells: [] } })))).toEqual({ kind: "spell", stage: "spell", memberId: "c4", page: 0, from: "top" });
    expect(campRepair("camp", { kind: "spell", stage: "spell", memberId: "zz", page: 0, from: "top" }, input(s))).toEqual({ kind: "spellWho" });
    expect(campRepair("camp", { kind: "spellWho" }, input(s))).toEqual({ kind: "spellWho" });
  });
});

describe("UI-53 campRepair", () => {
  test("UI-53/UI-59 人がいなくなった段はキャンプならメンバー一覧、酒場なら先頭の者のキャラクター画面。行動できなくなっても装備の段はそのまま（U6）", () => {
    const m = input(inDungeon());
    for (const p of [character("c9"), { kind: "equip", stage: "slot", memberId: "c9" }, { kind: "give", stage: "item", memberId: "c9", page: 0 }] satisfies CampPage[]) {
      expect(campRepair("camp", p, m), JSON.stringify(p)).toEqual({ kind: "members" });
      expect(campRepair("tavern", p, m), JSON.stringify(p)).toEqual(character("c1"));
    }
    const asleep = input(inDungeon({ c4: { status: ["sleep"] } }));
    expect(campRepair("camp", { kind: "equip", stage: "slot", memberId: "c4" }, asleep)).toEqual({ kind: "equip", stage: "slot", memberId: "c4" });
    // 呪文の対象の段で、その呪文が使えなくなった（MP 切れ・行動不能）→ 同じ者の呪文の一覧
    const sp: CampPage = { kind: "spell", stage: "spell", memberId: "c4", page: 0 };
    expect(campRepair("camp", { kind: "spell", stage: "target", memberId: "c4", spellId: "heal" }, input(inDungeon({ c4: { mp: 0 } })))).toEqual(sp);
    expect(campRepair("camp", { kind: "spell", stage: "target", memberId: "c4", spellId: "heal" }, asleep)).toEqual(sp);
    expect(campRepair("camp", sp, asleep)).toBe(sp);
    expect(campRepair("tavern", { kind: "order", picked: "c9" }, input(inTown()))).toEqual({ kind: "order", picked: null });
    expect(campRepair("camp", { kind: "members" }, m)).toEqual({ kind: "members" });
  });
});

describe("UI-33 campKeyIndex", () => {
  test("UI-33 数字 n → n 番目の枠・行（空き枠は null）、Enter → 先頭の押せる項目、Esc → やめる / 戻る", () => {
    const m = input(inDungeon());
    const top = campEntries("camp", { kind: "top" }, m, S);
    expect(campKeyIndex({ menu: 0 }, top)).toBe(0);
    expect(campKeyIndex({ menu: 2 }, top)).toBe(2); // M16: 糸で帰る（c5 の帰還の糸）
    expect(campKeyIndex({ menu: 3 }, top)).toBe(3); // M18: 敵を待つ（M19 で改名。キー 4）
    expect(campKeyIndex({ menu: 4 }, top)).toBe(4); // M18: 呪文（キー 5）
    expect(campKeyIndex({ menu: 5 }, top)).toBeNull();
    expect(campKeyIndex({ menu: 7 }, top)).toBe(7);
    expect(campKeyIndex({ menu: 8 }, top)).toBeNull();
    expect(campKeyIndex("confirm", top)).toBe(0);
    expect(campKeyIndex("back", top)).toBe(7);
    expect(campKeyIndex("forward", top)).toBeNull();
    const ch = campEntries("camp", character("c5"), m, S);
    expect(campKeyIndex({ menu: 5 }, ch)).toBeNull(); // 鑑定の空き枠
    const list = campEntries("camp", { kind: "spell", stage: "spell", memberId: "c4", page: 0 }, m, S);
    expect(campKeyIndex("back", list)).toBe(1);
  });

  test("UI-53/UI-59 使う文言のキーがすべて strings にあり、廃止した段の鍵は消した", () => {
    for (const k of [
      "dungeon.menu.camp",
      "common.cancel",
      "common.back",
      "camp.status",
      "camp.order",
      "camp.book",
      "camp.spell",
      ...["top", "members", "spellWho", "status", "spellWhich", "spellTarget", "spellDead", "equipSlot", "equipItem", "order", "orderSecond", "identifyWhich", "giveWhich", "giveTo", "dropWhich"].map(
        (x) => `camp.prompt.${x}`,
      ),
      ...["use", "give", "drop", "spell", "next", "pageNext", "pagePrev"].map((x) => `character.${x}`),
      "camp.spellRow",
      "camp.equip.unequip",
      "camp.equip.none",
      "camp.equip.blocked",
      "camp.identifyRow",
      "camp.identify.none",
      "camp.returnConfirm.prompt",
      "camp.returnConfirm.yes",
      "camp.useReturn",
      "camp.search",
      "camp.summary.return",
      "camp.summary.returnNoOwner",
      "character.prev",
      "camp.dropConfirm",
      "camp.dropYes",
      "camp.giveBlock.full",
      ...["cannotAct", "noMp", "noUnidentified"].map((x) => `camp.identifyBlock.${x}`),
      "camp.order.row",
      "camp.order.front",
      "camp.order.back",
      ...["cannotAct", "unidentified", "class", "cursedSlot"].flatMap((x) => [`camp.equipBlock.${x}`, `camp.equipReason.${x}`]),
      "dungeon.items.which",
      "dungeon.items.target",
      "dungeon.items.allyRow",
    ]) {
      expect(Object.prototype.hasOwnProperty.call(S, k), k).toBe(true);
    }
    // M18（設計 5-1）: camp.spell と camp.prompt.spellWho は top の「呪文」で戻した。M20（UI-80）: キャラクター画面の枠の「装備」「鑑定」は品の段（camp.equip.do / camp.item.identify）に替えて消した。
    // M21（A-1）: 司教の「鑑定」（character.identify）はキャラクター画面の 3 つ目の枠に戻した
    for (const k of ["camp.item", "camp.equip", "camp.identify", "character.equip", "camp.prompt.equipWho", "camp.prompt.identifyWho", "dungeon.items.who", "dungeon.menu.items"]) {
      expect(Object.prototype.hasOwnProperty.call(S, k), k).toBe(false);
    }
  });
});

// ---------------------------------------------------------------- パネルの DOM（偽の document）
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

describe("CH-03/UI-53 並び順の表の列", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("CH-03/UI-53 前衛 / 後衛の列の x は名前の長さによらず同じ（名前の列は全角 6 文字ぶんの幅で切る）", () => {
    vi.stubGlobal("document", { createElement: (): FakeEl => new FakeEl() });
    const v = createCampView({ x: 0, y: 16, w: 240, h: 150 });
    v.render({
      kind: "order",
      lines: [
        { label: "1 Alder", row: "前衛", picked: false },
        { label: "2 ベルク", row: "前衛", picked: true },
        { label: "3 キリ", row: "前衛", picked: false },
        { label: "4 ろくもじのな", row: "後衛", picked: false },
      ],
    });
    const el = v.el as unknown as FakeEl;
    const rowCells = el.children.filter((c) => c.className === "camp-order-col");
    const nameCells = el.children.filter((c) => c.className === "camp-order-name");
    expect(rowCells.map((c) => c.textContent)).toEqual(["前衛", "前衛", "前衛", "後衛"]);
    expect(new Set(rowCells.map((c) => c.style["left"])).size).toBe(1);
    const px = (s: string | undefined): number => Number((s ?? "").replace("px", ""));
    for (const n of nameCells) expect(px(n.style["left"]) + px(n.style["width"])).toBeLessThanOrEqual(px(rowCells[0]!.style["left"]));
    expect(px(nameCells[0]!.style["width"])).toBeGreaterThanOrEqual(4 + 4 + 8 * 6);
    expect(nameCells[1]!.style["color"]).toBe("var(--c-accent)");
    expect(rowCells[1]!.style["color"]).toBe("var(--c-accent)");
    expect(rowCells[0]!.style["color"]).toBeUndefined();
  });

  test("UI-53 文字のパネルの lines は見出しの下の行 1.. に通常色で描く", () => {
    vi.stubGlobal("document", { createElement: (): FakeEl => new FakeEl() });
    const v = createCampView({ x: 0, y: 16, w: 240, h: 150 });
    v.render({ kind: "text", title: "キャンプ", lines: ["a", "b"] });
    const el = v.el as unknown as FakeEl;
    expect(el.children.map((c) => [c.className, c.textContent, c.style["top"], c.style["color"]])).toEqual([
      ["camp-title", "キャンプ", "4px", "var(--c-accent)"],
      ["camp-summary", "a", "14px", undefined],
      ["camp-summary", "b", "24px", undefined],
    ]);
  });

  test("UI-59（M10）キャラクター画面と tall の品の詳細はパネルを tallRect（240×284）に広げ、文字のパネルはビュー領域に戻す", () => {
    vi.stubGlobal("document", { createElement: (): FakeEl => new FakeEl() });
    const v = createCampView({ x: 0, y: 16, w: 240, h: 150 }, { x: 0, y: 16, w: 240, h: 284 });
    const el = v.el as unknown as FakeEl;
    const detail = {
      name: "a",
      raceClass: "",
      level: "",
      exp: "",
      next: { text: "", ready: false },
      hp: "",
      mp: "",
      san: "",
      sanOver: false,
      status: "",
      stats: [],
      attack: "",
      ac: "",
      magicPower: "",
      equipment: [],
      inventoryHeading: "",
      tapHint: "",
      inventory: [],
      spellHeading: "",
      spells: [],
    };
    v.render({ kind: "character", detail, focusSlot: null });
    expect(el.style["height"]).toBe("284px");
    expect(el.children).toHaveLength(1);
    expect(el.children[0]!.style["height"]).toBe("284px");
    v.render({ kind: "text", title: "キャンプ" });
    expect(el.style["height"]).toBe("150px");
    v.render({ kind: "lines", title: "杖", lines: [], tall: true });
    expect(el.style["height"]).toBe("284px");
  });
});

describe("CH-71/UI-59 所持枠 9・10 枠のキャラクター画面（M17）", () => {
  const bare = { weapon: null, armor: null, shield: null, helm: null, gauntlet: null, accessory: null };
  /** c1 の素の力を str にし、装備を外して所持品を n 個の薬草にした迷宮の state */
  function holding(str: number, n: number): GameState {
    const s = inDungeon();
    const c1 = s.party[0]!;
    c1.stats = { ...c1.stats, str };
    c1.equipment = { ...bare };
    c1.inventory = Array.from({ length: n }, () => createItemInstance(s, { itemId: "herb", identified: true }));
    return s;
  }

  test("CH-71/UI-59 見出しの上限は slotsMaxOf（力 11 → 8、12 → 9、16 → 10）", () => {
    for (const [str, max] of [[11, 8], [12, 9], [15, 9], [16, 10], [18, 10]] as const) {
      const s = holding(str, 0);
      const c1 = input(s).menu.members[0]!;
      expect(c1.slotsMax, `str ${str}`).toBe(max);
      expect(formatCharacter(s.party[0]!, data, S, (iid) => itemDisplayName(s, data, iid), undefined, c1).inventoryHeading).toBe(`所持品 0/${max}（装備 0 を含む）`);
    }
  });

  test("CH-71/UI-59 力 16 で 10 品: 頁の無い画面は 7 品と「ほか 3」、頁の段は 8 品と 2 品。11 品目は受け取れない", () => {
    const s = holding(16, 10);
    const m = input(s);
    const c1 = m.menu.members[0]!;
    expect([c1.slotsUsed, c1.slotsMax]).toEqual([10, 10]);
    const name = (iid: string) => itemDisplayName(s, data, iid);
    const d = formatCharacter(s.party[0]!, data, S, name, undefined, c1);
    expect(d.inventoryHeading).toBe("所持品 10/10（装備 0 を含む）");
    expect(d.inventory.map((x) => x.text)).toEqual([...Array.from({ length: 7 }, () => "薬草"), "ほか 3"]);
    expect(formatCharacter(s.party[0]!, data, S, name, undefined, c1, { inventoryPage: 0 }).inventory).toHaveLength(CHARACTER_INVENTORY_CELLS);
    expect(formatCharacter(s.party[0]!, data, S, name, undefined, c1, { inventoryPage: 1 }).inventory).toHaveLength(2);
    // 捨てるの段: 1 頁目は 8 品 + [次の頁][前の頁]、2 頁目は 2 品。3 頁目へは進まない
    const p0: CampPage = { kind: "drop", stage: "item", memberId: "c1", page: 0 };
    const r0 = rows(campEntries("camp", p0, m, S));
    expect(r0.slice(CHARACTER_INVENTORY_CELLS).map((x) => [x.label, x.disabled])).toEqual([
      ["次の頁", false],
      ["前の頁", true],
      ["やめる", false],
    ]);
    const p1 = { ...p0, page: 1 };
    expect(campStep("camp", p0, m, { kind: "pageTurn", delta: 1 })).toEqual({ kind: "page", page: p1 });
    const r1 = rows(campEntries("camp", p1, m, S));
    expect(r1.map((x) => x.label)).toEqual(["薬草", "薬草", "次の頁", "前の頁", "やめる"]);
    expect(campStep("camp", p1, m, { kind: "pageTurn", delta: 1 })).toEqual({ kind: "page", page: p1 });
    expect(campPanel(p1, m, S)).toEqual({ kind: "character", memberId: "c1", focusSlot: null, inventoryPage: 1 });
    // 2 頁目の最後の品（10 品目）を捨てられる（core が受け付ける）
    const last = r1[1]!.choice;
    if (last.kind !== "item") throw new Error("not item");
    expect(last.instanceId).toBe(s.party[0]!.inventory[9]);
    const after = accepted(s, { type: "party.drop", memberId: "c1", instanceId: last.instanceId });
    expect(after.party[0]!.inventory).toHaveLength(9);
    // 9 品になれば頁の段は 8 品 + 1 品（2 頁目のまま）。頁が 1 つになれば campRepair で 1 頁目へ
    expect(rows(campEntries("camp", p1, input(after), S)).map((x) => x.label)).toEqual(["薬草", "次の頁", "前の頁", "やめる"]);
    expect(campRepair("camp", p1, input(holding(16, 8)))).toEqual(p0);
    // 渡す: 満杯（10/10）の c1 は受け取れない。力 11 の者は 8 で満杯
    expect(input(s).menu.members.find((x) => x.id === "c1")!.canReceive).toBe(false);
    expect(input(holding(16, 9)).menu.members.find((x) => x.id === "c1")!.canReceive).toBe(true);
    expect(input(holding(11, 8)).menu.members.find((x) => x.id === "c1")!.canReceive).toBe(false);
  });
});

describe("UI-80（M20）品を押して詳細と操作", () => {
  test("UI-80 キャラクター画面でその人の品（装備・所持品）を押すと品の段。他人の品・無い品は同じ段のまま。品の段の戻るはキャラクター画面", () => {
    const m = input(inDungeon());
    expect(campStep("camp", character("c1"), m, { kind: "openItem", instanceId: "i1" })).toEqual({ kind: "page", page: itemPage("c1", "i1") });
    expect(campStep("camp", character("c1"), m, { kind: "openItem", instanceId: "i4" })).toEqual({ kind: "page", page: itemPage("c1", "i4") });
    expect(campStep("camp", character("c1"), m, { kind: "openItem", instanceId: "i10" })).toEqual({ kind: "page", page: character("c1") });
    expect(campStep("camp", character("c1"), m, { kind: "openItem", instanceId: "zz" })).toEqual({ kind: "page", page: character("c1") });
    // 品の段は下の段（パネルは広いまま）。前後の人へは移らない
    expect(campCharacterOpen(itemPage("c1", "i1"))).toBe(true);
    expect(campCanCycle(itemPage("c1", "i1"), m)).toBe(false);
    for (const host of ["camp", "tavern"] as const) expect(campStep(host, itemPage("c1", "i1"), m, { kind: "cancel" })).toEqual({ kind: "page", page: character("c1") });
    expect(campKeyIndex("back", campEntries("camp", itemPage("c1", "i1"), m, S))).toBe(7);
    expect(campHeader(itemPage("c1", "i1"), m, S)).toBe("長剣をどうする？");
  });

  test("UI-80/UI-67 品の段のパネルは品の詳細（装備中は外すときの差分、所持品の装備品は装備するときの差分、消耗品は差分なし）", () => {
    const s = inDungeon();
    const id = createItemInstance(s, { itemId: "iron_shield", identified: true });
    s.party[0]!.inventory.push(id);
    const m = input(s);
    expect(campPanel(itemPage("c1", "i1"), m, S)).toEqual({ kind: "item", instanceId: "i1", preview: { memberId: "c1", slot: "weapon", instanceId: null } });
    expect(campPanel(itemPage("c1", id), m, S)).toEqual({ kind: "item", instanceId: id, preview: { memberId: "c1", slot: "shield", instanceId: id } });
    expect(campPanel(itemPage("c1", "i4"), m, S)).toEqual({ kind: "item", instanceId: "i4" });
  });

  test("UI-80/CH-76 装備中の品は [外す] だけ（ほかは空き枠）。外すと party.unequip を送り、送った後も同じ品の段（品は所持品へ移り [装備する] になる）", () => {
    const s = inDungeon();
    const m = input(s);
    const e = grid(campEntries("camp", itemPage("c1", "i1"), m, S));
    expect(labels(e)).toEqual(["外す", null, null, null, null, null, null, "戻る"]);
    const r = campStep("camp", itemPage("c1", "i1"), m, e[0]!.choice);
    expect(r).toEqual({ kind: "send", command: { type: "party.unequip", memberId: "c1", slot: "weapon" }, after: itemPage("c1", "i1") });
    if (r.kind !== "send") throw new Error("not send");
    const t = accepted(s, r.command);
    const m2 = input(t);
    expect(campRepair("camp", itemPage("c1", "i1"), m2)).toEqual(itemPage("c1", "i1"));
    const e2 = grid(campEntries("camp", itemPage("c1", "i1"), m2, S));
    expect(labels(e2)).toEqual(["装備する", null, "渡す", "捨てる", null, null, null, "戻る"]);
    const r2 = campStep("camp", itemPage("c1", "i1"), m2, e2[0]!.choice);
    expect(r2).toEqual({ kind: "send", command: { type: "party.equip", memberId: "c1", instanceId: "i1" }, after: itemPage("c1", "i1") });
    if (r2.kind === "send") accepted(t, r2.command);
  });

  test("UI-80 送れない操作は dim で、押すと理由（camp.itemReason.{block}）。呪われた装備は外せない・職業が装備できない", () => {
    let s = inDungeon();
    const g = cursedDagger(s, true);
    s.party[2]!.inventory.push(g);
    s = accepted(s, { type: "party.equip", memberId: "c3", instanceId: g });
    const sword = createItemInstance(s, { itemId: "long_sword", identified: true });
    s.party[4]!.inventory.push(sword);
    const m = input(s);
    const cursed = grid(campEntries("camp", itemPage("c3", g), m, S))[0]!;
    expect(cursed).toEqual({ label: "外す", disabled: true, choice: { kind: "itemAction", action: "unequip" }, reason: "短剣は呪われていて、外せない。" });
    expect(campStep("camp", itemPage("c3", g), m, cursed.choice)).toEqual({ kind: "page", page: itemPage("c3", g) });
    const cls = grid(campEntries("camp", itemPage("c5", sword), m, S))[0]!;
    expect([cls.label, cls.disabled, cls.reason]).toEqual(["装備する", true, "エルは長剣を装備できない。"]);
  });

  test("UI-80/MG-44 使う: 対象の要る品は対象の段（from item。やめるで品の段、送った後はキャラクター画面）。帰還の糸は確認の段", () => {
    const s = inDungeon({ c2: { hp: 1 } });
    const m = input(s);
    const e = grid(campEntries("camp", itemPage("c1", "i4"), m, S));
    expect(labels(e)).toEqual([null, "使う", "渡す", "捨てる", null, null, null, "戻る"]);
    const target: CampPage = { kind: "use", stage: "target", memberId: "c1", instanceId: "i4", from: "item" };
    expect(campStep("camp", itemPage("c1", "i4"), m, e[1]!.choice)).toEqual({ kind: "page", page: target });
    expect(campStep("camp", target, m, { kind: "cancel" })).toEqual({ kind: "page", page: itemPage("c1", "i4") });
    const r = campStep("camp", target, m, { kind: "target", targetId: "c2" });
    expect(r).toEqual({ kind: "send", command: { type: "dungeon.useItem", memberId: "c1", itemId: "i4", targetId: "c2" }, after: character("c1") });
    if (r.kind === "send") accepted(s, r.command);
    // 帰還の糸
    const ret = grid(campEntries("camp", itemPage("c5", "i15"), m, S))[1]!;
    const confirm: CampPage = { kind: "use", stage: "confirmReturn", memberId: "c5", instanceId: "i15", from: "item" };
    expect(campStep("camp", itemPage("c5", "i15"), m, ret.choice)).toEqual({ kind: "page", page: confirm });
    expect(campStep("camp", confirm, m, { kind: "cancel" })).toEqual({ kind: "page", page: itemPage("c5", "i15") });
    expect(campStep("camp", confirm, m, { kind: "confirm" })).toEqual({
      kind: "send",
      command: { type: "dungeon.useItem", memberId: "c5", itemId: "i15" },
      after: character("c5"),
    });
    expect(campHeader(confirm, m, S)).not.toMatch(/[{}]/);
    // 使えなくなったら（眠った）品の段へ、品が消えたらキャラクター画面へ
    expect(campRepair("camp", target, input(patched(s, { c1: { status: ["sleep"] } })))).toEqual(itemPage("c1", "i4"));
    expect(campRepair("camp", target, input(patched(s, { c1: { inventory: [] } })))).toEqual(character("c1"));
  });

  test("UI-80/CH-78/CH-79 渡す・捨てる: 相手の段・確認の段（from item。やめるで品の段）→ 送った後はキャラクター画面。品が消えた品の段はキャラクター画面へ直す", () => {
    const s = inDungeon();
    const m = input(s);
    const e = grid(campEntries("camp", itemPage("c1", "i4"), m, S));
    const to: CampPage = { kind: "give", stage: "to", memberId: "c1", instanceId: "i4", from: "item" };
    expect(campStep("camp", itemPage("c1", "i4"), m, e[2]!.choice)).toEqual({ kind: "page", page: to });
    expect(campStep("camp", to, m, { kind: "cancel" })).toEqual({ kind: "page", page: itemPage("c1", "i4") });
    const r = campStep("camp", to, m, { kind: "target", targetId: "c2" });
    expect(r).toEqual({ kind: "send", command: { type: "party.give", memberId: "c1", instanceId: "i4", toId: "c2" }, after: character("c1") });
    if (r.kind !== "send") throw new Error("not send");
    const t = accepted(s, r.command);
    expect(campRepair("camp", itemPage("c1", "i4"), input(t))).toEqual(character("c1"));
    expect(campRepair("camp", to, input(t))).toEqual(character("c1"));
    const confirm: CampPage = { kind: "drop", stage: "confirm", memberId: "c1", instanceId: "i4", from: "item" };
    expect(campStep("camp", itemPage("c1", "i4"), m, e[3]!.choice)).toEqual({ kind: "page", page: confirm });
    expect(campStep("camp", confirm, m, { kind: "cancel" })).toEqual({ kind: "page", page: itemPage("c1", "i4") });
    const d = campStep("camp", confirm, m, { kind: "confirm" });
    expect(d).toEqual({ kind: "send", command: { type: "party.drop", memberId: "c1", instanceId: "i4" }, after: character("c1") });
    if (d.kind === "send") accepted(s, d.command);
    expect(campHeader(confirm, m, S)).toBe("薬草を捨てる。よいか。");
  });

  test("UI-80 所持品が 9 件以上なら、キャラクター画面は 7 件と「ほか {n}」で畳み、押す（pageTurn）と次の分（最後の次は最初）。頁が減れば campRepair で最初へ", () => {
    const m = input(inDungeon());
    const many = structuredClone(m);
    const c1 = many.menu.members.find((x) => x.id === "c1")!;
    c1.inventory = Array.from({ length: 10 }, (_, i) => ({ instanceId: `x${i}`, name: `品${i}`, identified: true, kind: "consumable" as const, cursed: false }));
    const p1 = campStep("camp", character("c1"), many, { kind: "pageTurn", delta: 1 });
    expect(p1).toEqual({ kind: "page", page: { kind: "character", memberId: "c1", fold: 1 } });
    expect(campPanel({ kind: "character", memberId: "c1", fold: 1 }, many, S)).toMatchObject({ tappable: true, inventoryFold: 1 });
    expect(campStep("camp", { kind: "character", memberId: "c1", fold: 1 }, many, { kind: "pageTurn", delta: 1 })).toEqual({ kind: "page", page: character("c1") });
    // 8 件以下は畳まないので同じ段のまま
    expect(campStep("camp", character("c1"), m, { kind: "pageTurn", delta: 1 })).toEqual({ kind: "page", page: character("c1") });
    expect(campRepair("camp", { kind: "character", memberId: "c1", fold: 1 }, m)).toEqual(character("c1"));
    expect(campRepair("camp", { kind: "character", memberId: "c1", fold: 1 }, many)).toEqual({ kind: "character", memberId: "c1", fold: 1 });
  });

  test("UI-80 新しい文は最悪の値でも収まる: 理由は会話の箱の 28 字 × 2 行（6 字の名前・最も長い品名）、品の段の問いは見出しの 28 字、鑑定の枠のラベルは枠の幅", () => {
    const units = (x: string): number => Array.from(x).reduce((n, c) => n + ((c.codePointAt(0) ?? 0) < 0x80 ? 0.5 : 1), 0);
    const longest = (xs: string[]): string => [...xs].sort((a, b) => units(b) - units(a))[0]!;
    const prefix = longest(["fine", "rare", "legendary"].map((r) => S[`item.rarity.${r}`]!));
    const item = longest([
      ...data.items.flatMap((it) => [it.name, it.unidentifiedName ?? it.name]),
      ...data.equipmentBases.flatMap((b) => [b.unidentifiedName, `${prefix}${b.name}${formatMessage(S["item.plus"]!, { n: 12 })}`]),
      ...data.uniques.map((u) => `${prefix}${u.name}`),
    ]);
    const name = "あ".repeat(data.config.creation.nameMaxLength);
    const blocks = ["cannotAct", "unidentified", "class", "cursedSlot", "cursed", "notHere", "cannotLearn", "known", "noTarget", "noReceiver", "noMp"];
    for (const b of blocks) {
      const text = formatMessage(S[`camp.itemReason.${b}`]!, { name, item });
      expect(text, b).not.toContain("{");
      expect(kinsokuLines(text, 28).length, `${b}: ${text}`).toBeLessThanOrEqual(2);
    }
    expect(units(formatMessage(S["camp.prompt.item"]!, { item }))).toBeLessThanOrEqual(28);
    // 鑑定の枠のラベル（成功率は 3 桁まで）は枠の幅 56 から左右の余白を除いた 48px に収まる（全角 8px・半角 4px）
    expect(units(formatMessage(S["camp.item.identify"]!, { rate: 100 })) * 8).toBeLessThanOrEqual(48);
  });

  test("UI-80 campItemActions はパーティ全員の装備と所持品の instanceId ごとの core の itemActions。持ち主の違う段では使わない", () => {
    const s = inDungeon();
    const m = input(s);
    expect(Object.keys(m.itemActions!).sort()).toEqual(
      s.party.flatMap((c) => [...Object.values(c.equipment).filter((x): x is string => x !== null), ...c.inventory]).sort(),
    );
    for (const [id, a] of Object.entries(m.itemActions!)) expect(a).toEqual(itemActions(s, data, a.memberId, id));
    // c2 の段で c1 の品を指しても操作は出ない（戻るだけ）
    expect(labels(grid(campEntries("camp", itemPage("c2", "i4"), m, S)))).toEqual([null, null, null, null, null, null, null, "戻る"]);
  });
});

describe("UI-80（M20）キャンプのパネルの characterTarget", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("UI-80 最後に描いたのが品を押せるキャラクター画面（tappable）のときだけ、押した所の行き先を返す（矩形は detail の characterHitRects）。ほかの画面では null", () => {
    vi.stubGlobal("document", { createElement: (): FakeEl => new FakeEl() });
    const v = createCampView({ x: 0, y: 16, w: 240, h: 150 }, { x: 0, y: 16, w: 240, h: 284 });
    const s = inDungeon();
    const m = input(s);
    const ch = s.party[0]!;
    const detail = formatCharacter(ch, data, S, (iid) => itemDisplayName(s, data, iid), undefined, m.menu.members[0]!, { tappable: true, inventoryFold: 0 });
    v.render({ kind: "character", detail, focusSlot: null, tappable: true });
    expect(v.characterTarget(10, 88)).toEqual({ kind: "item", instanceId: "i1" });
    expect(v.characterTarget(10, 158)).toEqual({ kind: "item", instanceId: "i4" });
    expect(v.characterTarget(10, 40)).toBeNull();
    v.render({ kind: "character", detail, focusSlot: null });
    expect(v.characterTarget(10, 88)).toBeNull();
    v.render({ kind: "character", detail, focusSlot: null, tappable: true });
    v.render({ kind: "lines", title: "長剣", lines: [], tall: true });
    expect(v.characterTarget(10, 88)).toBeNull();
  });
});

describe("TW-16c/UI-59 銀行の状態で倉庫から装備（M21 A-2。host bank）", () => {
  const units = (x: string): number => Array.from(x).reduce((n, c) => n + ((c.codePointAt(0) ?? 0) < 0x80 ? 0.5 : 1), 0);
  /** 倉庫の末尾に itemId の実体を足した state と、その実体 id */
  function stash(base: GameState, itemId: string, identified = true): { s: GameState; id: string } {
    const s = cloneState(base);
    const id = createItemInstance(s, { itemId, identified });
    s.warehouse.push(id);
    return { s, id };
  }
  const equipItemPage = (memberId: string, slot: "weapon" | "helm" | "shield"): CampPage => ({ kind: "equip", stage: "item", memberId, slot });
  const who = (s: GameState, id: string): Character => s.party.find((c) => c.id === id)!;
  const fillWarehouse = (base: GameState): GameState => {
    const s = cloneState(base);
    while (s.warehouse.length < data.config.items.warehouseSlots) s.warehouse.push(createItemInstance(s, { itemId: "herb", identified: true }));
    return s;
  };

  test("TW-16c/UI-59 host bank のキャラクター画面だけ 4 つ目の枠（キー 4）に「倉庫から」（装備の段へ）。酒場・キャンプでは空き枠。最初の頁と戻るは酒場と同じ", () => {
    const m = input(inTown());
    const e = campEntries("bank", character("c1"), m, S);
    expect(grid(e)[3]).toEqual({ label: "倉庫から", disabled: false, choice: { kind: "action", action: "equip" } });
    expect(campKeyIndex({ menu: 3 }, e)).toBe(3);
    expect(labels(grid(e))).toEqual(["呪文", "次の人", null, "倉庫から", null, null, null, "戻る"]);
    for (const host of ["tavern", "camp"] as const) expect(grid(campEntries(host, character("c1"), m, S))[3], host).toBeNull();
    expect(campStep("bank", character("c1"), m, { kind: "action", action: "equip" })).toEqual({ kind: "page", page: { kind: "equip", stage: "slot", memberId: "c1" } });
    expect(campFirstPage("bank", "status", m.menu)).toEqual(character("c1"));
    expect(campStep("bank", character("c1"), m, { kind: "cancel" })).toEqual({ kind: "close" });
    expect(campStep("bank", { kind: "equip", stage: "slot", memberId: "c1" }, m, { kind: "cancel" })).toEqual({ kind: "page", page: character("c1") });
  });

  test("TW-16c 品の一覧: 外して倉庫へ → 装備中 → 手元の候補 → 倉庫の候補「{name}（倉庫）」。倉庫の候補を選ぶと from warehouse の詳細 → 装備する → party.equip の from / to warehouse（core が受け付け、旧品は倉庫へ）", () => {
    let s = inTown();
    const own = createItemInstance(s, { itemId: "dagger", identified: true });
    who(s, "c3").inventory.push(own); // c3 の手元の短剣
    const bow = stash(s, "short_bow");
    s = bow.s;
    const m = input(s);
    const list = rows(campEntries("bank", equipItemPage("c3", "weapon"), m, S));
    expect(labels(list)).toEqual(["外して倉庫へ", "短剣（装備中）", "短剣", "短弓（倉庫）", "やめる"]);
    expect(list[3]!.choice).toEqual({ kind: "detail", instanceId: bow.id, from: "warehouse" });
    const step = campStep("bank", equipItemPage("c3", "weapon"), m, list[3]!.choice);
    const detail: CampPage = { kind: "equip", stage: "detail", memberId: "c3", slot: "weapon", instanceId: bow.id, from: "warehouse" };
    expect(step).toEqual({ kind: "page", page: detail });
    expect(campPanel(detail, m, S)).toEqual({ kind: "item", instanceId: bow.id, preview: { memberId: "c3", slot: "weapon", instanceId: bow.id, from: "warehouse" } });
    const de = rows(campEntries("bank", detail, m, S));
    expect(de[0]).toEqual({ label: "装備する", disabled: false, choice: { kind: "equip", instanceId: bow.id } });
    const sent = campStep("bank", detail, m, de[0]!.choice);
    expect(sent).toEqual({
      kind: "send",
      command: { type: "party.equip", memberId: "c3", instanceId: bow.id, from: "warehouse", to: "warehouse" },
      after: { kind: "equip", stage: "slot", memberId: "c3" },
    });
    const t = accepted(s, (sent as { command: Command }).command);
    expect(who(t, "c3").equipment.weapon).toBe(bow.id);
    expect(t.warehouse).toEqual(["i7"]);
    // 送った後の段で、倉庫に戻った旧品（短剣）が倉庫の候補に出る。詳細の段の品は装備中になったので段はそのまま（外して倉庫へ）
    const m2 = input(t);
    expect(labels(rows(campEntries("bank", equipItemPage("c3", "weapon"), m2, S)))).toEqual(["外して倉庫へ", "短弓（装備中）", "短剣", "短剣（倉庫）", "やめる"]);
    expect(campRepair("bank", detail, m2)).toEqual(detail);
    expect(labels(rows(campEntries("bank", detail, m2, S)))).toEqual(["外して倉庫へ", "やめる"]);
    // 倉庫の候補でも装備中でもなくなった品の詳細（ほかの者が引き出した等）は品の一覧へ
    const gone = cloneState(s);
    gone.warehouse = [];
    expect(campRepair("bank", detail, input(gone))).toEqual(equipItemPage("c3", "weapon"));
    // 手元の候補は to warehouse（旧品は倉庫へ。from なし）。酒場の状態では from / to なし
    const ownDetail: CampPage = { kind: "equip", stage: "detail", memberId: "c3", slot: "weapon", instanceId: own };
    const ownStep = campStep("bank", ownDetail, m, { kind: "equip", instanceId: own });
    expect(ownStep).toMatchObject({ kind: "send", command: { type: "party.equip", memberId: "c3", instanceId: own, to: "warehouse" } });
    expect((ownStep as { command: Command }).command).not.toHaveProperty("from");
    const tavernStep = campStep("tavern", ownDetail, m, { kind: "equip", instanceId: own });
    expect((tavernStep as { command: Command }).command).not.toHaveProperty("from");
    expect((tavernStep as { command: Command }).command).not.toHaveProperty("to");
  });

  test("TW-16c 外して倉庫へ: party.unequip の to warehouse（core が受け付ける）。倉庫が満杯なら dim（core の canUnequipToWarehouse）。詳細の段の外すも同じ", () => {
    const s = inTown();
    const m = input(s);
    const list = rows(campEntries("bank", equipItemPage("c1", "shield"), m, S));
    expect(list[0]).toEqual({ label: "外して倉庫へ", disabled: false, choice: { kind: "unequip" } });
    const sent = campStep("bank", equipItemPage("c1", "shield"), m, { kind: "unequip" });
    expect(sent).toEqual({
      kind: "send",
      command: { type: "party.unequip", memberId: "c1", slot: "shield", to: "warehouse" },
      after: { kind: "equip", stage: "slot", memberId: "c1" },
    });
    const t = accepted(s, (sent as { command: Command }).command);
    expect(t.warehouse).toEqual(["i3"]);
    expect(who(t, "c1").inventory).toEqual(["i4"]);
    const full = input(fillWarehouse(s));
    expect(rows(campEntries("bank", equipItemPage("c1", "shield"), full, S))[0]).toMatchObject({ label: "外して倉庫へ", disabled: true });
    const cur: CampPage = { kind: "equip", stage: "detail", memberId: "c1", slot: "shield", instanceId: "i3" };
    expect(rows(campEntries("bank", cur, m, S))[0]).toEqual({ label: "外して倉庫へ", disabled: false, choice: { kind: "unequip" } });
    expect(rows(campEntries("bank", cur, full, S))[0]!.disabled).toBe(true);
  });

  test("TW-16c/UI-80 銀行の状態の手元の候補の入れ替えと品の段: 旧品・外した品は倉庫へ（to warehouse。core が受け付ける）。倉庫が満杯なら dim で、押すと理由（warehouseFull）", () => {
    // app の campInput と同じ（銀行の状態は itemActions に to "warehouse"）
    const bankInput = (s: GameState): CampInput => ({
      ...input(s),
      itemActions: campItemActions(campMenu(s, data)!, (memberId, instanceId) => itemActions(s, data, memberId, instanceId, "warehouse")),
    });
    const s = inTown();
    const own = createItemInstance(s, { itemId: "dagger", identified: true });
    who(s, "c3").inventory.push(own);
    const old = who(s, "c3").equipment.weapon!;
    // 装備の段の手元の候補: 詳細の装備する → to warehouse → 旧品（短剣）は倉庫へ
    const ownDetail: CampPage = { kind: "equip", stage: "detail", memberId: "c3", slot: "weapon", instanceId: own };
    const sent = campStep("bank", ownDetail, bankInput(s), rows(campEntries("bank", ownDetail, bankInput(s), S))[0]!.choice);
    expect((sent as { command: Command }).command).toEqual({ type: "party.equip", memberId: "c3", instanceId: own, to: "warehouse" });
    const t = accepted(s, (sent as { command: Command }).command);
    expect(t.warehouse).toEqual([old]);
    expect(who(t, "c3").inventory).not.toContain(old);
    // 倉庫が満杯なら手元の候補は「{name}（倉庫が一杯）」で、詳細の装備するは dim・理由
    const full = fillWarehouse(s);
    const fm = bankInput(full);
    expect(fm.menu.members.find((x) => x.id === "c3")!.equipCandidates.find((c) => c.instanceId === own)).toMatchObject({ block: null, toWarehouseBlock: "warehouseFull" });
    expect(labels(rows(campEntries("bank", equipItemPage("c3", "weapon"), fm, S)))).toContain("短剣（倉庫が一杯）");
    expect(labels(rows(campEntries("tavern", equipItemPage("c3", "weapon"), fm, S)))).toContain("短剣"); // 酒場は今どおり
    expect(rows(campEntries("bank", ownDetail, fm, S))[0]).toMatchObject({
      label: "装備する（倉庫が一杯）",
      disabled: true,
      reason: S["camp.equipReason.warehouseFull"],
    });
    // 品の段（UI-80）: 装備中の品は「外して倉庫へ」→ party.unequip の to warehouse。所持品の装備は to warehouse
    const eq = itemPage("c3", old);
    const g = grid(campEntries("bank", eq, bankInput(s), S));
    expect(g[0]).toEqual({ label: "外して倉庫へ", disabled: false, choice: { kind: "itemAction", action: "unequip" } });
    const un = campStep("bank", eq, bankInput(s), g[0]!.choice);
    expect((un as { command: Command }).command).toEqual({ type: "party.unequip", memberId: "c3", slot: "weapon", to: "warehouse" });
    expect(accepted(s, (un as { command: Command }).command).warehouse).toEqual([old]);
    const eqOwn = campStep("bank", itemPage("c3", own), bankInput(s), { kind: "itemAction", action: "equip" });
    expect((eqOwn as { command: Command }).command).toEqual({ type: "party.equip", memberId: "c3", instanceId: own, to: "warehouse" });
    // 満杯なら品の段の外す・装備するは dim で、押すと理由
    expect(grid(campEntries("bank", eq, fm, S))[0]).toMatchObject({ label: "外して倉庫へ", disabled: true, reason: S["camp.itemReason.warehouseFull"] });
    expect(grid(campEntries("bank", itemPage("c3", own), fm, S))[0]).toMatchObject({ disabled: true, reason: S["camp.itemReason.warehouseFull"] });
    expect(campStep("bank", eq, fm, { kind: "itemAction", action: "unequip" })).toEqual({ kind: "page", page: eq });
    // 酒場の状態の品の段は今どおり（外す・to なし）
    const tg = grid(campEntries("tavern", eq, input(s), S));
    expect(tg[0]!.label).toBe("外す");
    expect((campStep("tavern", eq, input(s), tg[0]!.choice) as { command: Command }).command).not.toHaveProperty("to");
  });

  test("TW-16c 酒場の状態（host tavern）は今どおり: 倉庫の候補を出さず、外すは手元へ（to なし）。倉庫の品だけなら「装備できる物がない」は bank で出ない", () => {
    const { s, id } = stash(inTown(), "leather_cap");
    const m = input(s);
    expect(labels(rows(campEntries("tavern", equipItemPage("c5", "helm"), m, S)))).toEqual(["装備できる物がない", "やめる"]);
    expect(labels(rows(campEntries("bank", equipItemPage("c5", "helm"), m, S)))).toEqual([`${itemDisplayName(s, data, id)}（倉庫）`, "やめる"]);
    expect(campStep("tavern", equipItemPage("c1", "shield"), m, { kind: "unequip" })).toMatchObject({ command: { type: "party.unequip", memberId: "c1", slot: "shield" } });
    expect((campStep("tavern", equipItemPage("c1", "shield"), m, { kind: "unequip" }) as { command: Command }).command).not.toHaveProperty("to");
    // tavern では倉庫の候補の行（from warehouse）を選んでも from は付かない（詳細は手元の候補を探すので出ない）
    expect(campStep("tavern", equipItemPage("c5", "helm"), m, { kind: "detail", instanceId: id, from: "warehouse" })).toEqual({
      kind: "page",
      page: { kind: "equip", stage: "detail", memberId: "c5", slot: "helm", instanceId: id },
    });
  });

  test("TW-16c 送れない倉庫の候補: 行は「{name}（倉庫）（{why}）」、詳細の装備するは dim で押すと理由（使用枠が一杯 = full・動けない）", () => {
    const s = inTown();
    while (who(s, "c5").inventory.length + 1 < 8) who(s, "c5").inventory.push(createItemInstance(s, { itemId: "herb", identified: true }));
    const cap = stash(s, "leather_cap");
    const m = input(cap.s);
    expect(m.menu.members.find((x) => x.id === "c5")!.warehouseCandidates![0]!.block).toBe("full");
    const name = itemDisplayName(cap.s, data, cap.id);
    expect(labels(rows(campEntries("bank", equipItemPage("c5", "helm"), m, S)))).toEqual([`${name}（倉庫）（持てない）`, "やめる"]);
    const detail: CampPage = { kind: "equip", stage: "detail", memberId: "c5", slot: "helm", instanceId: cap.id, from: "warehouse" };
    expect(rows(campEntries("bank", detail, m, S))[0]).toEqual({
      label: "装備する（持てない）",
      disabled: true,
      choice: { kind: "equip", instanceId: cap.id },
      reason: `エルは持ち物が一杯で、${name}を持てない。`,
    });
    const sleep = stash(patched(inTown(), { c5: { status: ["sleep"] } }), "leather_cap");
    const ds: CampPage = { ...detail, instanceId: sleep.id };
    expect(rows(campEntries("bank", ds, input(sleep.s), S))[0]).toMatchObject({ disabled: true, reason: "エルは動けない。" });
  });

  test("TW-16c 新しい文は最悪の値でも収まる: 倉庫の候補の行は一覧の行の幅（39 単位。長ければ名前の末尾を「…」）、銀行の行・外して倉庫へも一覧の行、倉庫からの枠は 48px", () => {
    const prefix = [...["fine", "rare", "legendary"].map((r) => S[`item.rarity.${r}`]!)].sort((a, b) => units(b) - units(a))[0]!;
    const names = [
      ...data.equipmentBases.map((b) => `${prefix}${b.name}${formatMessage(S["item.plus"]!, { n: 12 })}`),
      ...data.uniques.map((u) => `${prefix}${u.name}${formatMessage(S["item.plus"]!, { n: 12 })}`),
    ];
    const whys = [null, ...["cannotAct", "cursedSlot", "full"].map((b) => S[`camp.equipBlock.${b}`]!)];
    for (const n of names) for (const w of whys) expect(units(warehouseRowLabel(n, w, S)) * 2, `${n} ${w}`).toBeLessThanOrEqual(39);
    // 収まる名前はそのまま、収まらない名前は「…」で切って（倉庫）を残す
    expect(warehouseRowLabel("短弓", null, S)).toBe("短弓（倉庫）");
    const cut = warehouseRowLabel("あ".repeat(30), "持てない", S);
    expect(cut.endsWith("…（倉庫）（持てない）")).toBe(true);
    expect(units(cut) * 2).toBeLessThanOrEqual(39);
    for (const k of ["town.bank.menu.status", "camp.equip.unequipToWarehouse"]) expect(units(S[k]!) * 2, k).toBeLessThanOrEqual(39);
    expect(units(S["character.fromWarehouse"]!) * 8).toBeLessThanOrEqual(48);
  });
});

describe("UI-33/UI-80（M21 A-4）キャラクター画面の品のキー操作", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const item = (instanceId: string) => ({ kind: "item" as const, instanceId });
  // アルド（c1）: 装備 長剣 i1・革鎧 i2・木の盾 i3、所持品 薬草 i4 → characterHitRects の順は i1, i2, i3, i4
  const taps = [item("i1"), item("i2"), item("i3"), item("i4")];

  test("UI-33/UI-80 ↑↓（forward / around）は注目を 1 つ動かす。注目なしからはどちらも先頭、端で止まる。注目はキャラクター画面の段の focus", () => {
    const c1: Extract<CampPage, { kind: "character" }> = { kind: "character", memberId: "c1" };
    expect(characterItemKey("around", c1, taps)).toEqual({ kind: "focus", page: { ...c1, focus: 0 } });
    expect(characterItemKey("forward", c1, taps)).toEqual({ kind: "focus", page: { ...c1, focus: 0 } });
    expect(characterItemKey("around", { ...c1, focus: 0 }, taps)).toEqual({ kind: "focus", page: { ...c1, focus: 1 } });
    expect(characterItemKey("around", { ...c1, focus: 3 }, taps)).toEqual({ kind: "focus", page: { ...c1, focus: 3 } });
    expect(characterItemKey("forward", { ...c1, focus: 2 }, taps)).toEqual({ kind: "focus", page: { ...c1, focus: 1 } });
    expect(characterItemKey("forward", { ...c1, focus: 0 }, taps)).toEqual({ kind: "focus", page: { ...c1, focus: 0 } });
    // 品が減って注目が範囲の外なら、次のキーで末尾に詰める
    expect(characterItemKey("around", { ...c1, focus: 7 }, taps)).toEqual({ kind: "focus", page: { ...c1, focus: 3 } });
    // fold は保つ
    expect(characterItemKey("around", { ...c1, fold: 1 }, taps)).toEqual({ kind: "focus", page: { ...c1, fold: 1, focus: 0 } });
  });

  test("UI-33/UI-80 Enter は注目している所を押したのと同じ（品は openItem、「ほか」は pageTurn）。注目なし・範囲の外の Enter と、数字・Esc・←→ は null（campKeyIndex のまま）", () => {
    const c1: Extract<CampPage, { kind: "character" }> = { kind: "character", memberId: "c1" };
    expect(characterItemKey("confirm", { ...c1, focus: 1 }, taps)).toEqual({ kind: "choose", choice: { kind: "openItem", instanceId: "i2" } });
    expect(characterItemKey("confirm", { ...c1, focus: 0 }, [{ kind: "more" }])).toEqual({ kind: "choose", choice: { kind: "pageTurn", delta: 1 } });
    expect(characterItemKey("confirm", c1, taps)).toBeNull();
    expect(characterItemKey("confirm", { ...c1, focus: 4 }, taps)).toBeNull();
    for (const a of [{ menu: 0 }, { menu: 2 }, "back", "left", "right"] as const) expect(characterItemKey(a, { ...c1, focus: 1 }, taps)).toBeNull();
    // 押せる所が無い・キャラクター画面そのものでない段（品の段・装備の段）は何もしない
    expect(characterItemKey("around", c1, [])).toBeNull();
    expect(characterItemKey("around", itemPage("c1", "i1"), taps)).toBeNull();
    expect(characterItemKey("around", { kind: "equip", stage: "item", memberId: "c1", slot: "weapon" }, taps)).toBeNull();
    // 注目なしの Enter は今どおり先頭の押せる項目（戦士のアルドは呪文が dim なので 2 つ目の次の人）
    const m = input(inDungeon());
    expect(campKeyIndex("confirm", campEntries("camp", c1, m, S))).toBe(1);
    // 選んだ品の段は campStep で開く（タップと同じ）
    const r = characterItemKey("confirm", { ...c1, focus: 3 }, taps);
    if (r === null || r.kind !== "choose") throw new Error("not choose");
    expect(campStep("camp", { ...c1, focus: 3 }, m, r.choice)).toEqual({ kind: "page", page: itemPage("c1", "i4") });
  });

  test("UI-33/UI-80 campPanel は注目を itemFocus で渡す（注目なしは欄なし）。「ほか」で頁をめくっても注目は同じ添字のまま。品の段の戻る・次の人では注目なし", () => {
    const s = inDungeon();
    for (let i = 0; i < 9; i++) s.party[0]!.inventory.push(createItemInstance(s, { itemId: "herb", identified: true })); // 計 10 件で畳む
    const m = input(s);
    const c1: Extract<CampPage, { kind: "character" }> = { kind: "character", memberId: "c1" };
    expect(campPanel({ ...c1, focus: 2 }, m, S)).toEqual({ kind: "character", memberId: "c1", focusSlot: null, tappable: true, inventoryFold: 0, itemFocus: 2 });
    expect(campPanel(c1, m, S)).toEqual({ kind: "character", memberId: "c1", focusSlot: null, tappable: true, inventoryFold: 0 });
    expect(campStep("camp", { ...c1, focus: 10 }, m, { kind: "pageTurn", delta: 1 })).toEqual({ kind: "page", page: { ...c1, fold: 1, focus: 10 } });
    expect(campStep("camp", { ...c1, focus: 10, fold: 1 }, m, { kind: "pageTurn", delta: 1 })).toEqual({ kind: "page", page: { ...c1, focus: 10 } });
    expect(campStep("camp", itemPage("c1", "i1"), m, { kind: "cancel" })).toEqual({ kind: "page", page: c1 });
    expect(campStep("camp", { ...c1, focus: 1 }, m, { kind: "nextMember" })).toEqual({ kind: "page", page: character("c2") });
  });

  test("UI-33/UI-80 ビューの characterTaps は最後に描いた品を押せるキャラクター画面の押せる所（characterHitRects の順）。itemFocus の所を accent で描く。ほかの画面では空", () => {
    vi.stubGlobal("document", { createElement: (): FakeEl => new FakeEl() });
    const v = createCampView({ x: 0, y: 16, w: 240, h: 150 }, { x: 0, y: 16, w: 240, h: 284 });
    const s = inDungeon();
    const ch = s.party[0]!;
    const member = campMenu(s, data)!.members[0]!;
    const detail = formatCharacter(ch, data, S, (iid) => itemDisplayName(s, data, iid), undefined, member, { tappable: true, inventoryFold: 0 });
    v.render({ kind: "character", detail, focusSlot: null, tappable: true, itemFocus: 3 });
    expect(v.characterTaps()).toEqual(taps);
    const el = v.el as unknown as FakeEl;
    const all = el.children.flatMap((c) => [c, ...c.children]);
    const herb = all.find((c) => c.className === "detail-inventory" && c.textContent === "薬草")!;
    expect(herb.style["color"]).toBe("var(--c-accent)");
    v.render({ kind: "character", detail, focusSlot: null, tappable: false });
    expect(v.characterTaps()).toEqual([]);
    v.render({ kind: "text", title: "キャンプ" });
    expect(v.characterTaps()).toEqual([]);
  });
});

describe("UI-59（M24 B-1）キャンプの品の行の色（鑑定済みの呪われた品は tone danger）", () => {
  test("UI-59/IT-32 渡すの品の行・装備の候補・銀行の状態の倉庫の候補は core の cursed が真なら tone danger（label は変えない）。未鑑定の呪いは付かない", () => {
    const s = inTown();
    const c3 = s.party[2]!;
    const known = cursedDagger(s, true);
    const hidden = cursedDagger(s, false);
    c3.inventory.push(known, hidden);
    const stored = cursedDagger(s, true);
    s.warehouse.push(stored);
    const m = input(s);
    const give = rows(campEntries("camp", { kind: "give", stage: "item", memberId: "c3", page: 0 }, m, S)).filter((e) => e.choice.kind === "item");
    const tone = (e: CampEntry | undefined): string | undefined => e?.tone;
    expect(tone(give.find((e) => e.choice.kind === "item" && e.choice.instanceId === known))).toBe("danger");
    expect(tone(give.find((e) => e.choice.kind === "item" && e.choice.instanceId === hidden))).toBeUndefined();
    const eq = rows(campEntries("bank", { kind: "equip", stage: "item", memberId: "c3", slot: "weapon" }, m, S));
    const byId = (id: string): CampEntry | undefined => eq.find((e) => e.choice.kind === "detail" && e.choice.instanceId === id);
    expect(byId(known)!.label).toBe("短剣");
    expect(tone(byId(known))).toBe("danger");
    expect(tone(byId(hidden))).toBeUndefined();
    expect(tone(byId(stored))).toBe("danger");
    expect(tone(byId(c3.equipment.weapon!))).toBeUndefined(); // 普通の装備中の品
  });
});
