// UI-53 迷宮の道具の 3 段（views/field-items.ts の純粋な状態機械）。値は core の fieldItemMenu だけ（UI-35）。
// 既定のパーティの所持品（dived(1)）: c1 アルド i4 薬草、c2 ベルク なし、c3 キリ i10 薬草、c4 ドナ i13 解毒草、
// c5 エル i15 帰還の糸、c6 フィン i18 薬草。薬草・解毒草は対象 ally、帰還の糸・魔法書は対象なし。
import { describe, expect, test } from "vitest";
import { execute } from "../src/core/engine";
import { fieldItemMenu } from "../src/core/rules/items";
import { cloneState, createItemInstance } from "../src/core/state";
import type { Character, FieldItemMenu, GameState } from "../src/core/types";
import { itemEntries, itemHeader, itemKeyIndex, itemStep, type ItemEntry } from "../src/presenter/views/field-items";
import { dived } from "./helpers/battle";
import { data, expectKnownStringKeys } from "./helpers/core";

const S = data.strings;

function inDungeon(patches: Record<string, Partial<Character>> = {}): GameState {
  const s = cloneState(dived(1));
  for (const [id, p] of Object.entries(patches)) {
    const i = s.party.findIndex((c) => c.id === id);
    s.party[i] = { ...s.party[i]!, ...structuredClone(p) };
  }
  return s;
}

function menuOf(s: GameState): FieldItemMenu {
  const m = fieldItemMenu(s, data);
  if (m === null) throw new Error("no field item menu");
  return m;
}

const back: ItemEntry = { label: S["common.back"]!, disabled: false, choice: { kind: "back" } };

describe("UI-53 迷宮の道具", () => {
  test("UI-53 使う人の段: 全員（行動できない者・使える品の無い者は disabled）＋戻る。見出しは dungeon.items.who", () => {
    const s = inDungeon({ c3: { status: ["paralysis"] } });
    const m = menuOf(s);
    expect(itemEntries(m, { stage: "member" }, S)).toEqual([
      { label: "アルド", disabled: false, choice: { kind: "member", memberId: "c1" } },
      { label: "ベルク", disabled: true, choice: { kind: "member", memberId: "c2" } },
      { label: "キリ", disabled: true, choice: { kind: "member", memberId: "c3" } },
      { label: "ドナ", disabled: false, choice: { kind: "member", memberId: "c4" } },
      { label: "エル", disabled: false, choice: { kind: "member", memberId: "c5" } },
      { label: "フィン", disabled: false, choice: { kind: "member", memberId: "c6" } },
      back,
    ]);
    expect(itemHeader(m, { stage: "member" }, S)).toBe("誰が使う？");
    // 戻るで閉じる
    expect(itemStep(m, { stage: "member" }, { kind: "back" })).toEqual({ kind: "close" });
    expect(itemStep(m, { stage: "member" }, { kind: "member", memberId: "c1" })).toEqual({ kind: "cursor", cursor: { stage: "item", memberId: "c1" } });
  });

  test("UI-53/MG-25 道具の段: その人の消耗品と魔法書（usable 偽は disabled）＋戻る。見出しは {name}の道具", () => {
    const s = inDungeon();
    const book = createItemInstance(s, "tome_lightning", true);
    s.party[0]!.inventory.push(book);
    const m = menuOf(s);
    // 戦士は雷光の魔法書を覚えられない（core の usable が偽）
    expect(itemEntries(m, { stage: "item", memberId: "c1" }, S)).toEqual([
      { label: "薬草", disabled: false, choice: { kind: "item", instanceId: "i4" } },
      { label: "雷光の魔法書", disabled: true, choice: { kind: "item", instanceId: book } },
      back,
    ]);
    expect(itemHeader(m, { stage: "item", memberId: "c1" }, S)).toBe("アルドの道具");
    expect(itemStep(m, { stage: "item", memberId: "c1" }, { kind: "back" })).toEqual({ kind: "cursor", cursor: { stage: "member" } });
  });

  test("UI-53/DG-30 帰還の糸（対象なし）は道具の段で targetId なしの dungeon.useItem を送り、core が受け付けて街へ戻る", () => {
    const s = inDungeon();
    const m = menuOf(s);
    const r = itemStep(m, { stage: "item", memberId: "c5" }, { kind: "item", instanceId: "i15" });
    expect(r).toEqual({ kind: "send", command: { type: "dungeon.useItem", memberId: "c5", itemId: "i15" } });
    if (r.kind !== "send") throw new Error("not send");
    const out = execute(s, r.command, data);
    expect(out.events.some((e) => e.kind === "rejected")).toBe(false);
    expectKnownStringKeys(out.events);
    expect(out.state.screen).toBe("town");
  });

  test("UI-53/H5 薬草（対象 ally）は対象の段へ進み、生きている味方の行（名前と HP）から選ぶと targetId 付きで送る", () => {
    const s = inDungeon({ c2: { hp: 5 }, c6: { life: "dead", hp: 0 } });
    const m = menuOf(s);
    const r1 = itemStep(m, { stage: "item", memberId: "c1" }, { kind: "item", instanceId: "i4" });
    expect(r1).toEqual({ kind: "cursor", cursor: { stage: "target", memberId: "c1", instanceId: "i4" } });
    const cur = { stage: "target" as const, memberId: "c1", instanceId: "i4" };
    expect(itemHeader(m, cur, S)).toBe("誰に使う？");
    const rows = itemEntries(m, cur, S);
    // dead の c6 は候補に出ない
    expect(rows.map((e) => e.choice)).toEqual([
      { kind: "target", targetId: "c1" },
      { kind: "target", targetId: "c2" },
      { kind: "target", targetId: "c3" },
      { kind: "target", targetId: "c4" },
      { kind: "target", targetId: "c5" },
      { kind: "back" },
    ]);
    expect(rows[1]!.label).toBe(`ベルク　5/${s.party[1]!.hpMax}`);
    const r2 = itemStep(m, cur, { kind: "target", targetId: "c2" });
    expect(r2).toEqual({ kind: "send", command: { type: "dungeon.useItem", memberId: "c1", itemId: "i4", targetId: "c2" } });
    if (r2.kind !== "send") throw new Error("not send");
    const out = execute(s, r2.command, data);
    expect(out.events.some((e) => e.kind === "rejected")).toBe(false);
    expectKnownStringKeys(out.events);
    // 戻るは道具の段へ
    expect(itemStep(m, cur, { kind: "back" })).toEqual({ kind: "cursor", cursor: { stage: "item", memberId: "c1" } });
  });

  test("UI-53 段に合わない選択は何もしない（同じ段のまま）", () => {
    const m = menuOf(inDungeon());
    expect(itemStep(m, { stage: "member" }, { kind: "target", targetId: "c1" })).toEqual({ kind: "cursor", cursor: { stage: "member" } });
    expect(itemStep(m, { stage: "item", memberId: "c1" }, { kind: "item", instanceId: "nope" })).toEqual({
      kind: "cursor",
      cursor: { stage: "item", memberId: "c1" },
    });
  });

  test("UI-33 キー: 数字 n → n 番目、Enter → 先頭の押せる行、Esc → 末尾（戻る）", () => {
    const e: ItemEntry[] = [
      { label: "a", disabled: true, choice: { kind: "member", memberId: "c1" } },
      { label: "b", disabled: false, choice: { kind: "member", memberId: "c2" } },
      back,
    ];
    expect(itemKeyIndex({ menu: 0 }, e)).toBe(0);
    expect(itemKeyIndex({ menu: 2 }, e)).toBe(2);
    expect(itemKeyIndex({ menu: 3 }, e)).toBeNull();
    expect(itemKeyIndex("confirm", e)).toBe(1);
    expect(itemKeyIndex("back", e)).toBe(2);
    expect(itemKeyIndex("forward", e)).toBeNull();
  });

  test("UI-53 文言のキーが strings にある（行のキーは params 付き、見出しの who / target は params なし）", () => {
    for (const k of ["dungeon.menu.items", "dungeon.items.who", "dungeon.items.which", "dungeon.items.target", "dungeon.items.allyRow"]) expect(S[k], k).toBeDefined();
    expect(S["dungeon.items.who"]).not.toContain("{");
    expect(S["dungeon.items.target"]).not.toContain("{");
  });
});
