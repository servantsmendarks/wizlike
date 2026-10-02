// UI-53 / UI-59 / TW-03 キャンプと酒場の段（views/camp.ts の純粋な状態機械。M4 の field-items.test を移した）。
// 値は core の campMenu と fieldItemMenu だけ（UI-35）。送る Command は core が受け付けることも確かめる。
// 既定のパーティ（dived(1)）: c1 アルド 戦士（inv i4 薬草）、c2 ベルク 戦士、c3 キリ 盗賊（inv i10 薬草）、c4 ドナ 僧侶（inv i13 解毒草、呪文 heal）、
// c5 エル 魔術師（inv i15 帰還の糸、呪文 fire_arrow / sleep_mist は battle 専用）、c6 フィン 盗賊（inv i18 薬草）。
import { afterEach, describe, expect, test, vi } from "vitest";
import { execute } from "../src/core/engine";
import { campMenu, campSummary } from "../src/core/rules/camp";
import { fieldItemMenu } from "../src/core/rules/items";
import { cloneState, createItemInstance } from "../src/core/state";
import type { Character, Command, GameState } from "../src/core/types";
import {
  CAMP_GRID_SLOTS,
  campEntries,
  campFirstPage,
  campHeader,
  campKeyIndex,
  campPanel,
  campRepair,
  campRows,
  campStep,
  createCampView,
  type CampEntries,
  type CampEntry,
  type CampInput,
  type CampPage,
} from "../src/presenter/views/camp";
import { dived } from "./helpers/battle";
import { data, expectKnownStringKeys, newGame } from "./helpers/core";

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
  return { menu, items: fieldItemMenu(s, data), summary: campSummary(s, data) };
}

/** 送った Command を core が受け付けること */
function accepted(s: GameState, cmd: Command): GameState {
  const r = execute(s, cmd, data);
  expect(r.events.some((e) => e.kind === "rejected"), JSON.stringify(r.events)).toBe(false);
  expectKnownStringKeys(r.events);
  return r.state;
}

const cancel = { label: S["common.cancel"]!, disabled: false, choice: { kind: "cancel" } } satisfies CampEntry;

function grid(e: CampEntries): (CampEntry | null)[] {
  if (e.layout !== "grid") throw new Error("not grid");
  return e.slots;
}
function rows(e: CampEntries): CampEntry[] {
  if (e.layout !== "list") throw new Error("not list");
  return e.rows;
}
const labels = (xs: readonly (CampEntry | null)[]) => xs.map((x) => (x === null ? null : x.label));

describe("UI-53 キャンプの top", () => {
  test("UI-53 top は 8 枠: 状態・呪文・道具・装備 / 並び順・鑑定（identifiers が空なら空き枠）・空き・戻る。見出しは camp.prompt.top", () => {
    const m = input(inDungeon());
    const e = grid(campEntries("camp", { kind: "top" }, m, S));
    expect(e).toHaveLength(CAMP_GRID_SLOTS);
    expect(labels(e)).toEqual(["状態", "呪文", "道具", "装備", "並び順", null, null, "戻る"]);
    expect(e[7]!.choice).toEqual({ kind: "cancel" });
    expect(campHeader({ kind: "top" }, m, S)).toBe("キャンプ　どうする？");
    // 戻るで閉じる
    expect(campStep("camp", { kind: "top" }, m, { kind: "cancel" })).toEqual({ kind: "close" });
    expect(campStep("camp", { kind: "top" }, m, e[0]!.choice)).toEqual({ kind: "page", page: { kind: "status", memberId: "c1" } });
    expect(campFirstPage("camp")).toEqual({ kind: "top" });
  });

  test("UI-53/CH-77 鑑定は identifiers（司教が行動可能）がいるときだけ [5] に出る。1 人なら鑑定する者の段を飛ばす", () => {
    const s = inDungeon({ c5: { classId: "bishop" } });
    const m = input(s);
    const e = grid(campEntries("camp", { kind: "top" }, m, S));
    expect(e[5]!.label).toBe("鑑定");
    expect(campStep("camp", { kind: "top" }, m, e[5]!.choice)).toEqual({ kind: "page", page: { kind: "identify", stage: "item", appraiserId: "c5" } });
    // 2 人なら鑑定する者の段から
    const m2 = input(inDungeon({ c5: { classId: "bishop" }, c4: { classId: "bishop" } }));
    expect(campStep("camp", { kind: "top" }, m2, e[5]!.choice)).toEqual({ kind: "page", page: { kind: "identify", stage: "appraiser" } });
    expect(labels(grid(campEntries("camp", { kind: "identify", stage: "appraiser" }, m2, S)))).toEqual(["ドナ", "エル", null, null, null, null, null, "やめる"]);
  });

  test("UI-53 どの段のやめるも top へ戻る（酒場では閉じる）。Esc は campKeyIndex でやめるの位置", () => {
    const m = input(inDungeon({ c5: { classId: "bishop" } }));
    const pages: CampPage[] = [
      { kind: "status", memberId: "c2" },
      { kind: "spell", stage: "caster" },
      { kind: "spell", stage: "spell", casterId: "c4" },
      { kind: "spell", stage: "target", casterId: "c4", spellId: "heal" },
      { kind: "item", stage: "member" },
      { kind: "item", stage: "item", memberId: "c1" },
      { kind: "item", stage: "target", memberId: "c1", instanceId: "i4" },
      { kind: "equip", stage: "member" },
      { kind: "equip", stage: "slot", memberId: "c1" },
      { kind: "equip", stage: "item", memberId: "c1", slot: "weapon" },
      { kind: "order", picked: "c2" },
      { kind: "identify", stage: "item", appraiserId: "c5" },
    ];
    for (const p of pages) {
      const e = campEntries("camp", p, m, S);
      const k = campKeyIndex("back", e);
      expect(k, JSON.stringify(p)).not.toBeNull();
      const c = campRows(e)[k!]!;
      expect(c, JSON.stringify(p)).toEqual(cancel);
      expect(campStep("camp", p, m, c.choice)).toEqual({ kind: "page", page: { kind: "top" } });
      expect(campStep("tavern", p, m, c.choice)).toEqual({ kind: "close" });
      expect(campHeader(p, m, S)).not.toMatch(/[{}]/);
    }
  });
});

describe("UI-59 状態", () => {
  test("UI-59 状態は名前の 6 枠と [7] やめる。名前の枠で人を切り替え、パネルはその人の詳細（focusSlot なし）", () => {
    const m = input(inDungeon());
    const p: CampPage = { kind: "status", memberId: "c1" };
    const e = grid(campEntries("camp", p, m, S));
    expect(labels(e)).toEqual(["アルド", "ベルク", "キリ", "ドナ", "エル", "フィン", null, "やめる"]);
    expect(campStep("camp", p, m, e[3]!.choice)).toEqual({ kind: "page", page: { kind: "status", memberId: "c4" } });
    expect(campPanel(p, m, S)).toEqual({ kind: "detail", memberId: "c1", focusSlot: null });
    expect(campHeader({ kind: "status", memberId: "c4" }, m, S)).toBe("ドナの状態");
  });
});

describe("MG-44/UI-53 呪文", () => {
  test("MG-44/UI-53 唱える者（行動できない・使える呪文が無い者は dim）→ 呪文の一覧「{name}  MP{mp}」→ 対象。送ったら同じ者の呪文の段へ", () => {
    const s = inDungeon({ c1: { hp: 1 } });
    const m = input(s);
    const who = grid(campEntries("camp", { kind: "spell", stage: "caster" }, m, S));
    expect(who.slice(0, 6).map((x) => x!.disabled)).toEqual([true, true, true, false, true, true]);
    expect(campHeader({ kind: "spell", stage: "caster" }, m, S)).toBe("誰が唱える？");
    const sp: CampPage = { kind: "spell", stage: "spell", casterId: "c4" };
    expect(rows(campEntries("camp", sp, m, S))).toEqual([{ label: "治癒  MP2", disabled: false, choice: { kind: "spell", spellId: "heal" } }, cancel]);
    expect(campHeader(sp, m, S)).toBe("ドナの呪文");
    const r1 = campStep("camp", sp, m, { kind: "spell", spellId: "heal" });
    const tgt: CampPage = { kind: "spell", stage: "target", casterId: "c4", spellId: "heal" };
    expect(r1).toEqual({ kind: "page", page: tgt });
    expect(campHeader(tgt, m, S)).toBe("誰に唱える？");
    const tr = rows(campEntries("camp", tgt, m, S));
    expect(tr.map((x) => x.choice)).toEqual([...["c1", "c2", "c3", "c4", "c5", "c6"].map((id) => ({ kind: "target", targetId: id })), { kind: "cancel" }]);
    expect(tr[0]!.label).toBe(`アルド　1/${s.party[0]!.hpMax}`);
    const r2 = campStep("camp", tgt, m, { kind: "target", targetId: "c1" });
    expect(r2).toEqual({ kind: "send", command: { type: "dungeon.cast", memberId: "c4", spellId: "heal", targetId: "c1" }, after: sp });
    if (r2.kind !== "send") throw new Error("not send");
    accepted(s, r2.command);
  });

  test("MG-40/MG-42/UI-53 帰還（対象なし）は呪文の段で送る。蘇生は対象の段で死者（camp.prompt.spellDead）を選ぶ", () => {
    const s = inDungeon({ c4: { knownSpells: ["heal", "return", "resurrect"], mp: 30 }, c2: { life: "dead", hp: 0 } });
    const m = input(s);
    const sp: CampPage = { kind: "spell", stage: "spell", casterId: "c4" };
    const r = campStep("camp", sp, m, { kind: "spell", spellId: "return" });
    expect(r).toEqual({ kind: "send", command: { type: "dungeon.cast", memberId: "c4", spellId: "return" }, after: sp });
    if (r.kind !== "send") throw new Error("not send");
    expect(accepted(s, r.command).screen).toBe("town");
    const tgt: CampPage = { kind: "spell", stage: "target", casterId: "c4", spellId: "resurrect" };
    expect(campStep("camp", sp, m, { kind: "spell", spellId: "resurrect" })).toEqual({ kind: "page", page: tgt });
    expect(campHeader(tgt, m, S)).toBe("誰を蘇らせる？");
    expect(rows(campEntries("camp", tgt, m, S))).toEqual([{ label: "ベルク", disabled: false, choice: { kind: "target", targetId: "c2" } }, cancel]);
    const r2 = campStep("camp", tgt, m, { kind: "target", targetId: "c2" });
    if (r2.kind !== "send") throw new Error("not send");
    accepted(s, r2.command);
  });

  test("UI-53 使えない呪文（MP 不足）は dim。dim の行を選んでも campStep は段を進める（押せないのは操作領域の側）", () => {
    const m = input(inDungeon({ c4: { mp: 1 } }));
    expect(rows(campEntries("camp", { kind: "spell", stage: "spell", casterId: "c4" }, m, S))[0]!.disabled).toBe(true);
  });
});

describe("UI-53 道具（M4 の field-items から移した）", () => {
  test("UI-53 使う人の段: 名前の 6 枠（行動できない者・使える品の無い者は dim）と [7] やめる。見出しは dungeon.items.who", () => {
    const m = input(inDungeon({ c3: { status: ["paralysis"] } }));
    const e = grid(campEntries("camp", { kind: "item", stage: "member" }, m, S));
    expect(e.slice(0, 6).map((x) => [x!.label, x!.disabled])).toEqual([
      ["アルド", false],
      ["ベルク", true],
      ["キリ", true],
      ["ドナ", false],
      ["エル", false],
      ["フィン", false],
    ]);
    expect(e[7]).toEqual(cancel);
    expect(campHeader({ kind: "item", stage: "member" }, m, S)).toBe("誰が使う？");
    expect(campStep("camp", { kind: "item", stage: "member" }, m, e[0]!.choice)).toEqual({ kind: "page", page: { kind: "item", stage: "item", memberId: "c1" } });
  });

  test("UI-53/MG-25 道具の段: 消耗品と魔法書（usable 偽は dim）とやめる。見出しは {name}の道具", () => {
    const s = inDungeon();
    const book = createItemInstance(s, "tome_lightning", true);
    s.party[0]!.inventory.push(book);
    const m = input(s);
    expect(rows(campEntries("camp", { kind: "item", stage: "item", memberId: "c1" }, m, S))).toEqual([
      { label: "薬草", disabled: false, choice: { kind: "item", instanceId: "i4" } },
      { label: "雷光の魔法書", disabled: true, choice: { kind: "item", instanceId: book } },
      cancel,
    ]);
    expect(campHeader({ kind: "item", stage: "item", memberId: "c1" }, m, S)).toBe("アルドの道具");
  });

  test("UI-53/DG-30 帰還の糸（対象なし）は道具の段で送る。薬草は対象の段から targetId 付きで送る。送った後は同じ人の道具の段", () => {
    const s = inDungeon({ c2: { hp: 5 } });
    const m = input(s);
    const itemPage: CampPage = { kind: "item", stage: "item", memberId: "c5" };
    const r = campStep("camp", itemPage, m, { kind: "item", instanceId: "i15" });
    expect(r).toEqual({ kind: "send", command: { type: "dungeon.useItem", memberId: "c5", itemId: "i15" }, after: itemPage });
    if (r.kind !== "send") throw new Error("not send");
    expect(accepted(s, r.command).screen).toBe("town");
    const c1: CampPage = { kind: "item", stage: "item", memberId: "c1" };
    const tgt: CampPage = { kind: "item", stage: "target", memberId: "c1", instanceId: "i4" };
    expect(campStep("camp", c1, m, { kind: "item", instanceId: "i4" })).toEqual({ kind: "page", page: tgt });
    expect(campHeader(tgt, m, S)).toBe("誰に使う？");
    const r2 = campStep("camp", tgt, m, { kind: "target", targetId: "c2" });
    expect(r2).toEqual({ kind: "send", command: { type: "dungeon.useItem", memberId: "c1", itemId: "i4", targetId: "c2" }, after: c1 });
    if (r2.kind !== "send") throw new Error("not send");
    accepted(s, r2.command);
  });

  test("UI-53 段に合わない選択と none は同じ段のまま", () => {
    const m = input(inDungeon());
    const p: CampPage = { kind: "item", stage: "member" };
    expect(campStep("camp", p, m, { kind: "target", targetId: "c1" })).toEqual({ kind: "page", page: p });
    expect(campStep("camp", { kind: "item", stage: "item", memberId: "c1" }, m, { kind: "item", instanceId: "nope" })).toEqual({
      kind: "page",
      page: { kind: "item", stage: "item", memberId: "c1" },
    });
    expect(campStep("camp", { kind: "equip", stage: "item", memberId: "c1", slot: "helm" }, m, { kind: "none" })).toEqual({
      kind: "page",
      page: { kind: "equip", stage: "item", memberId: "c1", slot: "helm" },
    });
  });
});

describe("CH-76/UI-53 装備", () => {
  test("CH-76/UI-53 誰（行動できない者は dim）→ 枠（6 枠。パネルは詳細）→ 品（外す・候補・やめる。パネルはその枠を focus）", () => {
    const s = inDungeon({ c2: { status: ["sleep"] } });
    const cap = createItemInstance(s, "leather_cap", true);
    const sword = createItemInstance(s, "long_sword", true);
    s.party[4]!.inventory.push(cap, sword); // c5 エル（魔術師）
    const m = input(s);
    const who = grid(campEntries("camp", { kind: "equip", stage: "member" }, m, S));
    expect(who.slice(0, 6).map((x) => x!.disabled)).toEqual([false, true, false, false, false, false]);
    const slotPage: CampPage = { kind: "equip", stage: "slot", memberId: "c5" };
    expect(campStep("camp", { kind: "equip", stage: "member" }, m, who[4]!.choice)).toEqual({ kind: "page", page: slotPage });
    expect(labels(grid(campEntries("camp", slotPage, m, S)))).toEqual(["武器", "防具", "盾", "兜", "小手", "装飾", null, "やめる"]);
    expect(campHeader(slotPage, m, S)).toBe("エルのどこを？");
    expect(campPanel(slotPage, m, S)).toEqual({ kind: "detail", memberId: "c5", focusSlot: null });
    // 武器: 装備中の杖を外せる。長剣は職業で装備できない（dim、理由付き）
    const weapon: CampPage = { kind: "equip", stage: "item", memberId: "c5", slot: "weapon" };
    expect(campStep("camp", slotPage, m, { kind: "slot", slot: "weapon" })).toEqual({ kind: "page", page: weapon });
    expect(campHeader(weapon, m, S)).toBe("エルの武器");
    expect(campPanel(weapon, m, S)).toEqual({ kind: "detail", memberId: "c5", focusSlot: "weapon" });
    expect(rows(campEntries("camp", weapon, m, S))).toEqual([
      { label: "外す", disabled: false, choice: { kind: "unequip" } },
      { label: "長剣（装備できない）", disabled: true, choice: { kind: "equip", instanceId: sword } },
      cancel,
    ]);
    const un = campStep("camp", weapon, m, { kind: "unequip" });
    expect(un).toEqual({ kind: "send", command: { type: "party.unequip", memberId: "c5", slot: "weapon" }, after: slotPage });
    if (un.kind !== "send") throw new Error("not send");
    accepted(s, un.command);
    // 兜: 空き枠なので「外す」は無く、革兜を装備できる
    const helm: CampPage = { kind: "equip", stage: "item", memberId: "c5", slot: "helm" };
    expect(rows(campEntries("camp", helm, m, S))).toEqual([{ label: "革兜", disabled: false, choice: { kind: "equip", instanceId: cap } }, cancel]);
    const eq = campStep("camp", helm, m, { kind: "equip", instanceId: cap });
    expect(eq).toEqual({ kind: "send", command: { type: "party.equip", memberId: "c5", instanceId: cap }, after: slotPage });
    if (eq.kind !== "send") throw new Error("not send");
    accepted(s, eq.command);
    // 盾: 候補が無く、空き → 「装備できる物がない」（dim）
    expect(rows(campEntries("camp", { kind: "equip", stage: "item", memberId: "c5", slot: "shield" }, m, S))).toEqual([
      { label: "装備できる物がない", disabled: true, choice: { kind: "none" } },
      cancel,
    ]);
  });

  test("CH-73/UI-53 呪われた品を装備していると「外す」は dim、候補は「呪いで外せない」で dim", () => {
    let s = inDungeon();
    const cursed = createItemInstance(s, "cursed_dagger", true);
    s.party[2]!.inventory.push(cursed);
    s = accepted(s, { type: "party.equip", memberId: "c3", instanceId: cursed });
    const m = input(s);
    expect(rows(campEntries("camp", { kind: "equip", stage: "item", memberId: "c3", slot: "weapon" }, m, S))).toEqual([
      { label: "外す", disabled: true, choice: { kind: "unequip" } },
      { label: "短剣（呪いで外せない）", disabled: true, choice: { kind: "equip", instanceId: "i7" } },
      cancel,
    ]);
  });
});

describe("CH-03/UI-53 並び順", () => {
  test("CH-03/UI-53 1 人目を選ぶと picked、同じ人で解除、2 人目で 2 人を入れ替えた全員の order を送る。パネルは順の表", () => {
    const s = inDungeon();
    const m = input(s);
    const p0: CampPage = { kind: "order", picked: null };
    expect(campHeader(p0, m, S)).toBe("入れ替える者を選ぶ");
    const r1 = campStep("camp", p0, m, { kind: "member", memberId: "c1" });
    const p1: CampPage = { kind: "order", picked: "c1" };
    expect(r1).toEqual({ kind: "page", page: p1 });
    expect(campHeader(p1, m, S)).toBe("アルドと入れ替える者は？");
    expect(campStep("camp", p1, m, { kind: "member", memberId: "c1" })).toEqual({ kind: "page", page: p0 });
    const panel = campPanel(p1, m, S);
    expect(panel).toEqual({
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
  });
});

describe("CH-77/UI-53 鑑定", () => {
  test("CH-77/UI-53 品の一覧は「{owner}: {name}」。送ったら同じ段。品が無ければ「鑑定する物がない」（dim）", () => {
    const s = inDungeon({ c5: { classId: "bishop" } });
    const p: CampPage = { kind: "identify", stage: "item", appraiserId: "c5" };
    expect(rows(campEntries("camp", p, input(s), S))).toEqual([{ label: "鑑定する物がない", disabled: true, choice: { kind: "none" } }, cancel]);
    const id = createItemInstance(s, "cursed_dagger", false);
    s.party[0]!.inventory.push(id);
    const m = input(s);
    expect(campHeader(p, m, S)).toBe("何を鑑定する？");
    expect(rows(campEntries("camp", p, m, S))).toEqual([{ label: "アルド: 短剣？", disabled: false, choice: { kind: "identifyItem", instanceId: id } }, cancel]);
    const r = campStep("camp", p, m, { kind: "identifyItem", instanceId: id });
    expect(r).toEqual({ kind: "send", command: { type: "party.identify", memberId: "c5", instanceId: id }, after: p });
    if (r.kind !== "send") throw new Error("not send");
    accepted(s, r.command);
  });
});

describe("TW-03/UI-52 酒場とキャンプの共有", () => {
  test("TW-03 酒場の最初のページ: 状態は先頭の者、装備は人の段、並び順は未選択。街の campMenu には呪文が無い", () => {
    const s = inTown();
    const m = input(s);
    expect(m.items).toBeNull();
    expect(campFirstPage("tavern", "status", m.menu)).toEqual({ kind: "status", memberId: "c1" });
    expect(campFirstPage("tavern", "equip", m.menu)).toEqual({ kind: "equip", stage: "member" });
    expect(campFirstPage("tavern", "order", m.menu)).toEqual({ kind: "order", picked: null });
    expect(campPanel({ kind: "equip", stage: "member" }, m, S)).toEqual({ kind: "text", title: "酒場" });
  });

  test("UI-53 迷宮のキャンプの top だけ、見出しの下に campSummary の 4 行（迷宮名と階・所持金・今回の収穫・帰還の糸）。他の段と酒場には出さない", () => {
    const s = inDungeon();
    s.gold = 230;
    s.dive!.floor = 2;
    s.dive!.ledger = { items: ["i15"], gold: 30 };
    // 帰還の糸は c5 の i15 の 1 本だけ
    expect(campPanel({ kind: "top" }, input(s), S)).toEqual({
      kind: "text",
      title: "キャンプ",
      lines: ["試しの坑道　2F", "所持金　230G", "今回の収穫　30G・1品", "帰還の糸　1本"],
    });
    expect(campPanel({ kind: "spell", stage: "caster" }, input(s), S)).toEqual({ kind: "text", title: "キャンプ" });
    const town = input(inTown());
    expect(town.summary).toBeNull();
    expect(campPanel({ kind: "top" }, town, S)).toEqual({ kind: "text", title: "酒場" });
  });

  test("UI-53 段の問いはヘッダーにだけ出す。文字のパネルは場所の見出し（キャンプ / 酒場）だけで、問いを繰り返さない", () => {
    const pages: CampPage[] = [
      { kind: "top" },
      { kind: "spell", stage: "caster" },
      { kind: "item", stage: "member" },
      { kind: "equip", stage: "member" },
      { kind: "identify", stage: "appraiser" },
    ];
    for (const [host, s] of [["camp", inDungeon()], ["tavern", inTown()]] as const) {
      const m = input(s);
      for (const p of pages) {
        const panel = campPanel(p, m, S);
        if (panel.kind !== "text") continue;
        expect(Object.values(panel), `${host} ${p.kind}`).not.toContain(campHeader(p, m, S));
      }
    }
  });
});

describe("UI-53 campRepair", () => {
  test("UI-53 成り立たなくなった段は最初のページへ（camp は top、酒場は開いた項目の最初）。成り立てばそのまま", () => {
    const m = input(inDungeon());
    const ok: CampPage = { kind: "spell", stage: "spell", casterId: "c4" };
    expect(campRepair("camp", ok, m)).toBe(ok);
    // 唱える者が行動できなくなった
    const asleep = input(inDungeon({ c4: { status: ["sleep"] } }));
    expect(campRepair("camp", ok, asleep)).toEqual({ kind: "top" });
    // 対象の段で、その呪文が使えなくなった（MP 切れ）→ 同じ者の呪文の段
    const nomp = input(inDungeon({ c4: { mp: 0 } }));
    expect(campRepair("camp", { kind: "spell", stage: "target", casterId: "c4", spellId: "heal" }, nomp)).toEqual(ok);
    // 鑑定する者がいない
    expect(campRepair("camp", { kind: "identify", stage: "item", appraiserId: "c5" }, m)).toEqual({ kind: "top" });
    // 酒場（街）では道具・呪文の段は成り立たない。酒場の装備の段で行動できない者は人の段へ
    const town = input(inTown({ c2: { status: ["sleep"] } }));
    expect(campRepair("camp", { kind: "item", stage: "member" }, town)).toEqual({ kind: "top" });
    expect(campRepair("tavern", { kind: "equip", stage: "slot", memberId: "c2" }, town)).toEqual({ kind: "equip", stage: "member" });
    expect(campRepair("tavern", { kind: "order", picked: "c9" }, town)).toEqual({ kind: "order", picked: null });
  });
});

describe("UI-33 campKeyIndex", () => {
  test("UI-33 数字 n → n 番目の枠・行（空き枠は null）、Enter → 先頭の押せる項目、Esc → やめる / 戻る", () => {
    const m = input(inDungeon());
    const top = campEntries("camp", { kind: "top" }, m, S);
    expect(campKeyIndex({ menu: 0 }, top)).toBe(0);
    expect(campKeyIndex({ menu: 5 }, top)).toBeNull(); // 鑑定の空き枠
    expect(campKeyIndex({ menu: 7 }, top)).toBe(7);
    expect(campKeyIndex({ menu: 8 }, top)).toBeNull();
    expect(campKeyIndex("confirm", top)).toBe(0);
    expect(campKeyIndex("back", top)).toBe(7);
    expect(campKeyIndex("forward", top)).toBeNull();
    const caster = campEntries("camp", { kind: "spell", stage: "caster" }, m, S);
    expect(campKeyIndex("confirm", caster)).toBe(3); // ドナだけが唱えられる
    const list = campEntries("camp", { kind: "spell", stage: "spell", casterId: "c4" }, m, S);
    expect(campKeyIndex("back", list)).toBe(1);
  });

  test("UI-53 使う文言のキーがすべて strings にある", () => {
    for (const k of [
      "dungeon.menu.camp",
      "common.cancel",
      "common.back",
      ...["status", "spell", "item", "equip", "order", "identify"].map((x) => `camp.${x}`),
      ...["top", "status", "spellWho", "spellWhich", "spellTarget", "spellDead", "equipWho", "equipSlot", "equipItem", "order", "orderSecond", "identifyWho", "identifyWhich"].map(
        (x) => `camp.prompt.${x}`,
      ),
      "camp.spellRow",
      "camp.equip.unequip",
      "camp.equip.none",
      "camp.equip.blocked",
      "camp.identifyRow",
      "camp.identify.none",
      "camp.order.row",
      "camp.order.front",
      "camp.order.back",
      ...["cannotAct", "unidentified", "class", "cursedSlot"].map((x) => `camp.equipBlock.${x}`),
      "town.tavern.status",
      "town.tavern.equip",
      "town.tavern.order",
      "dungeon.items.who",
      "dungeon.items.which",
      "dungeon.items.target",
      "dungeon.items.allyRow",
    ]) {
      expect(Object.prototype.hasOwnProperty.call(S, k), k).toBe(true);
    }
    expect(Object.prototype.hasOwnProperty.call(S, "dungeon.menu.items")).toBe(false);
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
    // 番号（半角 1 字）+ 空白 + 名前（全角 6 文字 = 48px）が列の手前に収まる
    for (const n of nameCells) expect(px(n.style["left"]) + px(n.style["width"])).toBeLessThanOrEqual(px(rowCells[0]!.style["left"]));
    expect(px(nameCells[0]!.style["width"])).toBeGreaterThanOrEqual(4 + 4 + 8 * 6);
    // 選んだ行は両方の列を accent 色
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
});
