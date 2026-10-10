// UI-53 / UI-59 / TW-03 キャンプ・キャラクター画面・酒場の段（views/camp.ts の純粋な状態機械。M4 の field-items.test を移した）。
// 値は core の campMenu と fieldItemMenu だけ（UI-35）。送る Command は core が受け付けることも確かめる。
// 既定のパーティ（dived(1)）: c1 アルド 戦士（inv i4 薬草）、c2 ベルク 戦士（inv なし）、c3 キリ 盗賊（inv i10 薬草）、c4 ドナ 僧侶（inv i13 解毒草、呪文 heal）、
// c5 エル 魔術師（inv i15 帰還の糸、呪文 fire_arrow / sleep_mist は battle 専用）、c6 フィン 盗賊（inv i18 薬草）。使用枠の上限は 8。
// M10（2026-10-07）: キャンプの top を 状態（メンバー一覧）・並び順・戻る に減らし、呪文・道具・装備・鑑定の段はキャラクター画面（UI-59）の下に移した。
// 旧い段（唱える者・使う人・誰の装備・鑑定する者の名前の枠）のテストは消し、同じ中身をキャラクター画面の下の段で確かめる形に書き直した。
import { afterEach, describe, expect, test, vi } from "vitest";
import { execute } from "../src/core/engine";
import { campMenu, campSummary, identifyChance } from "../src/core/rules/camp";
import { fieldItemMenu } from "../src/core/rules/items";
import { cloneState, createItemInstance } from "../src/core/state";
import type { Character, Command, GameState } from "../src/core/types";
import {
  CAMP_GRID_SLOTS,
  campCanCycle,
  campCharacterOpen,
  campCycle,
  campEntries,
  campFirstPage,
  campHeader,
  campKeyIndex,
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
} from "../src/presenter/views/camp";
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
  return { menu, items: fieldItemMenu(s, data), summary: campSummary(s, data), identifyMpCost: data.config.identify.mpCost };
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

describe("UI-53 キャンプの top（M10）", () => {
  test("UI-53 top は 8 枠: 状態・並び順 / 空き 5 つ・戻る（帰還の糸を使えなければ 3 つ目も空き）。見出しは camp.prompt.top。状態はメンバー一覧へ", () => {
    const m = input(inDungeon({ c5: { classId: "bishop", inventory: [] } }));
    const e = grid(campEntries("camp", { kind: "top" }, m, S));
    expect(e).toHaveLength(CAMP_GRID_SLOTS);
    expect(labels(e)).toEqual(["状態", "並び順", null, null, null, null, null, "戻る"]);
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
  test("UI-59 操作の 4×2: 装備・使う・渡す・捨てる / 呪文・鑑定（鑑定できる職業の者だけ。ほかは空き枠）・次の人・戻る。見出しは {name}の状態", () => {
    const m = input(inDungeon());
    const e = grid(campEntries("camp", character("c1"), m, S));
    expect(labels(e)).toEqual(["装備", "使う", "渡す", "捨てる", "呪文", null, "次の人", "戻る"]);
    // アルド: 薬草を持つので使う・渡す・捨てるは押せる。呪文を知らないので呪文は dim
    expect(e.map((x) => x?.disabled ?? null)).toEqual([false, false, false, false, true, null, false, false]);
    expect(campHeader(character("c1"), m, S)).toBe("アルドの状態");
    // ドナ（治癒）は呪文が押せる。UI-68（M10）: エル（戦闘専用の呪文だけ）も、説明を見るために呪文が押せる（M10 の UI-59 では dim だった）
    expect(grid(campEntries("camp", character("c4"), m, S))[4]!.disabled).toBe(false);
    expect(grid(campEntries("camp", character("c5"), m, S))[4]!.disabled).toBe(false);
    // ベルク: 所持品が無いので 使う・渡す・捨てる は dim
    expect(grid(campEntries("camp", character("c2"), m, S)).slice(1, 4).map((x) => x!.disabled)).toEqual([true, true, true]);
    // 各操作の行き先
    const go = (i: number) => campStep("camp", character("c1"), m, e[i]!.choice);
    expect(go(0)).toEqual({ kind: "page", page: { kind: "equip", stage: "slot", memberId: "c1" } });
    expect(go(1)).toEqual({ kind: "page", page: { kind: "use", stage: "item", memberId: "c1" } });
    expect(go(2)).toEqual({ kind: "page", page: { kind: "give", stage: "item", memberId: "c1", page: 0 } });
    expect(go(3)).toEqual({ kind: "page", page: { kind: "drop", stage: "item", memberId: "c1", page: 0 } });
    expect(go(4)).toEqual({ kind: "page", page: { kind: "spell", stage: "spell", memberId: "c1", page: 0 } });
    expect(go(6)).toEqual({ kind: "page", page: character("c2") });
  });

  test("UI-59 行動できない者は使うが dim（core の fieldItemMenu の canAct）。死亡の者でも装備・渡す・捨てるは押せる（U6）", () => {
    const m = input(inDungeon({ c1: { status: ["sleep"] }, c3: { life: "dead", hp: 0 } }));
    const sleep = grid(campEntries("camp", character("c1"), m, S));
    expect(sleep.slice(0, 4).map((x) => x!.disabled)).toEqual([false, true, false, false]);
    const dead = grid(campEntries("camp", character("c3"), m, S));
    expect(dead.slice(0, 4).map((x) => x!.disabled)).toEqual([false, true, false, false]);
  });

  test("UI-59/CH-77 鑑定の枠は鑑定できる職業の者（identifyBlock が cannotIdentify でない）だけ。送れなければ dim で、押すと core の identifyBlock の理由を語る", () => {
    const s = inDungeon({ c5: { classId: "bishop", mp: 5 } });
    const none = grid(campEntries("camp", character("c5"), input(s), S))[5]!;
    expect(none).toEqual({ label: "鑑定", disabled: true, choice: { kind: "action", action: "identify" }, reason: "鑑定する品が無い。" });
    s.party[0]!.inventory.push(cursedDagger(s, false));
    const ok = grid(campEntries("camp", character("c5"), input(s), S))[5]!;
    expect(ok).toEqual({ label: "鑑定", disabled: false, choice: { kind: "action", action: "identify" } });
    expect(campStep("camp", character("c5"), input(s), ok.choice)).toEqual({ kind: "page", page: { kind: "identify", memberId: "c5" } });
    const noMp = grid(campEntries("camp", character("c5"), input(patched(s, { c5: { mp: 0 } })), S))[5]!;
    expect([noMp.disabled, noMp.reason]).toEqual([true, "エルは MP が足りない。"]);
    const asleep = grid(campEntries("camp", character("c5"), input(patched(s, { c5: { status: ["sleep"] } })), S))[5]!;
    expect([asleep.disabled, asleep.reason]).toEqual([true, "エルは動けない。"]);
    // 鑑定できない職業の者は空き枠
    expect(grid(campEntries("camp", character("c1"), input(s), S))[5]).toBeNull();
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
    expect(grid(campEntries("camp", character("c1"), one, S))[6]!.disabled).toBe(true);
    expect([campSwipeDir("left"), campSwipeDir("right"), campSwipeDir("forward"), campSwipeDir("around"), campSwipeDir("confirm")]).toEqual([1, -1, null, null, null]);
    // スワイプの向きを campCycle に渡すと: c3 で指を左へ → c4、右へ → c2
    expect(campCycle(character("c3"), m, campSwipeDir("left")!)).toEqual(character("c4"));
    expect(campCycle(character("c3"), m, campSwipeDir("right")!)).toEqual(character("c2"));
  });

  test("UI-59 パネルはキャラクター画面（装備の品の段だけ focusSlot、呪文・渡す・捨てるの品の段は頁）。キャラクター画面の間は campCharacterOpen が真", () => {
    const m = input(inDungeon());
    expect(campPanel(character("c1"), m, S)).toEqual({ kind: "character", memberId: "c1", focusSlot: null });
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
      { label: "短剣（装備中）", disabled: false, choice: { kind: "detail", instanceId: cursed } },
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
    // ベルクの使用枠を満杯にする（装備 2 + 所持品 6 = 8）
    for (let i = 0; i < 6; i++) s.party[1]!.inventory.push(createItemInstance(s, { itemId: "herb", identified: true }));
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
    expect(grid(campEntries("camp", character("c1"), m, S))[2]!.disabled).toBe(false);
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
      lines: ["試しの坑道　2F", "所持金　230G", "今回の収穫　30G・1品", "帰還の糸　1本（エル）"],
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
    expect(labels(e)).toEqual(["状態", "並び順", "糸で帰る", null, null, null, null, "戻る"]);
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

  test("DG-30/UI-53 使える帰還の品が無ければ 3 つ目は空き枠で、要約の行は持ち主なしの「帰還の糸　n本」（持ち主が動けない 1 本も数える）", () => {
    const s = inDungeon({ c5: { status: ["sleep"] } });
    const m = input(s);
    expect(m.summary!.returnItem).toBeNull();
    expect(grid(campEntries("camp", { kind: "top" }, m, S))[2]).toBeNull();
    const p = campPanel({ kind: "top" }, m, S);
    expect(p.kind === "text" && p.lines?.[3]).toBe("帰還の糸　1本");
    const none = input(inDungeon({ c5: { inventory: [] } }));
    const q = campPanel({ kind: "top" }, none, S);
    expect(q.kind === "text" && q.lines?.[3]).toBe("帰還の糸　0本");
    // 要約の行は名前 6 字でも 29 字以内（パネルの幅 232 = 全角 29 字）
    expect(S["camp.summary.return"]!.replace("{count}", "12").replace("{owner}", "アルドリンド").length).toBeLessThanOrEqual(29);
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
    expect(campKeyIndex({ menu: 3 }, top)).toBeNull();
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
      ...["top", "members", "status", "spellWhich", "spellTarget", "spellDead", "equipSlot", "equipItem", "order", "orderSecond", "identifyWhich", "giveWhich", "giveTo", "dropWhich"].map(
        (x) => `camp.prompt.${x}`,
      ),
      ...["equip", "use", "give", "drop", "spell", "identify", "next", "pageNext", "pagePrev"].map((x) => `character.${x}`),
      "camp.spellRow",
      "camp.equip.unequip",
      "camp.equip.none",
      "camp.equip.blocked",
      "camp.identifyRow",
      "camp.identify.none",
      "camp.returnConfirm.prompt",
      "camp.returnConfirm.yes",
      "camp.useReturn",
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
    for (const k of ["camp.spell", "camp.item", "camp.equip", "camp.identify", "camp.prompt.spellWho", "camp.prompt.equipWho", "camp.prompt.identifyWho", "dungeon.items.who", "dungeon.menu.items"]) {
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
