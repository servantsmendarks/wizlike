// UI-54 / CB-10〜12: 戦闘の入力の段階（src/presenter/battle-input.ts）。BattleMenu は手組み（core の battleMenu の戻り値の形）。
import { describe, expect, test } from "vitest";
import type { BattleMenu, BattleMenuMember } from "../src/core/types";
import { back, entries, firstCursor, nextCursor, step, targetNumber, type Choice, type InputCursor } from "../src/presenter/battle-input";
import { formatMessage } from "../src/presenter/views/message";
import { data } from "./helpers/core";

const S = data.strings;
/** 期待値の文言。キーが strings に無ければその場で落とす */
const t = (k: string, p?: Record<string, string | number>): string => {
  const tpl = S[k];
  if (tpl === undefined) throw new Error(`unknown string key: ${k}`);
  return formatMessage(tpl, p);
};

function member(id: string, o: Partial<BattleMenuMember> = {}): BattleMenuMember {
  return { id, name: `N${id}`, canAct: true, input: null, canStrike: true, spells: [], items: [], ...o };
}

/** 6 人。c3 は麻痺（canAct 偽）、c5 は呪文、c6 は道具を持つ。グループ 0 は全滅、1 と 2 が生存 */
function menu(o: Partial<BattleMenu> = {}): BattleMenu {
  const members = [
    member("c1"),
    member("c2"),
    member("c3", { canAct: false }),
    member("c4", { canStrike: false }),
    member("c5", {
      canStrike: false,
      spells: [
        { spellId: "fire_arrow", name: "火矢", mp: 2, target: "enemy", usable: true },
        { spellId: "flame_burst", name: "炎", mp: 5, target: "enemyGroup", usable: false },
        { spellId: "heal", name: "癒し", mp: 2, target: "ally", usable: true },
        { spellId: "blessing", name: "加護", mp: 3, target: "party", usable: true },
        { spellId: "identify", name: "看破", mp: 4, target: "allEnemies", usable: true },
      ],
    }),
    member("c6", {
      canStrike: false,
      items: [
        { instanceId: "i1", itemId: "herb", name: "薬草", target: "ally" },
        { instanceId: "i2", itemId: "x", name: "煙玉", target: "none" },
      ],
    }),
  ];
  return {
    round: 1,
    auto: false,
    canFlee: true,
    ready: false,
    pending: ["c1", "c2", "c4", "c5", "c6"],
    groups: [
      { index: 0, monsterId: "giant_rat", name: "小さな獣", identified: false, count: 0 },
      { index: 1, monsterId: "kobold", name: "コボルド", identified: true, count: 3 },
      { index: 2, monsterId: "giant_spider", name: "多脚の影", identified: false, count: 1 },
    ],
    members,
    allies: [
      { id: "c1", name: "Nc1", hp: 7, hpMax: 9 },
      { id: "c2", name: "Nc2", hp: 4, hpMax: 8 },
    ],
    ...o,
  };
}

const cur = (memberId: string, stage: InputCursor["stage"] = "command", pick: InputCursor["pick"] = null): InputCursor => ({
  memberId,
  stage,
  pick,
});
const cmd = (c: Extract<Choice, { kind: "cmd" }>["cmd"]): Choice => ({ kind: "cmd", cmd: c });


describe("UI-54 入力の段階", () => {
  test("UI-54 入力の段階で使う文言のキーがすべて strings にある", () => {
    for (const k of [
      ...["attack", "spell", "defend", "item", "flee", "auto", "autoStop"].map((c) => `battle.cmd.${c}`),
      ...["command", "spell", "item", "enemy", "ally"].map((p) => `battle.prompt.${p}`),
      "battle.targetGroup",
      "battle.targetAlly",
      "battle.spellRow",
      "battle.autoOn",
      "battle.autoStopping",
      "common.back",
    ]) {
      expect(Object.prototype.hasOwnProperty.call(S, k), k).toBe(true);
    }
  });

  test("UI-54 firstCursor は pending の先頭の command、オート中・pending 空は null", () => {
    expect(firstCursor(menu())).toEqual(cur("c1"));
    expect(firstCursor(menu({ auto: true }))).toBeNull();
    expect(firstCursor(menu({ pending: [] }))).toBeNull();
  });

  test("UI-54 nextCursor は並び順で prev の後ろの pending、無ければ pending の先頭、それも無ければ null", () => {
    const m = menu({ pending: ["c2", "c5"] });
    expect(nextCursor(m, "c1")).toEqual(cur("c2"));
    expect(nextCursor(m, "c2")).toEqual(cur("c5"));
    expect(nextCursor(m, "c4")).toEqual(cur("c5"));
    // 末尾の後ろは先頭に戻る（取りこぼしの入力）
    expect(nextCursor(m, "c6")).toEqual(cur("c2"));
    expect(nextCursor(menu({ pending: [] }), "c1")).toBeNull();
    expect(nextCursor(menu({ auto: true }), "c1")).toBeNull();
  });

  test("UI-54/CB-12 ready（flee の入力で揃った）なら pending が残っていても firstCursor / nextCursor は null（解決の再生中に次のメンバーの枠を出さない）", () => {
    const m = menu({ ready: true, pending: ["c2", "c4", "c5", "c6"] });
    expect(firstCursor(m)).toBeNull();
    expect(nextCursor(m, "c1")).toBeNull();
    expect(nextCursor(m, "c6")).toBeNull();
  });

  test("UI-54 command の 7 枠: 攻撃・呪文・防御・道具・逃走・オート・戻る。disabled は spells 空・items 空・canFlee 偽・先頭", () => {
    const m = menu();
    const e1 = entries(m, cur("c1"), S);
    expect(e1.map((e) => e.label)).toEqual([
      t("battle.cmd.attack"),
      t("battle.cmd.spell"),
      t("battle.cmd.defend"),
      t("battle.cmd.item"),
      t("battle.cmd.flee"),
      t("battle.cmd.auto"),
      t("common.back"),
    ]);
    expect(e1.map((e) => e.disabled)).toEqual([false, true, false, true, false, false, true]);
    // c5 は呪文あり・道具なし、先頭ではない
    expect(entries(m, cur("c5"), S).map((e) => e.disabled)).toEqual([false, false, false, true, false, false, false]);
    // c6 は道具あり。ボス戦（canFlee 偽）では逃走が押せない
    expect(entries(menu({ canFlee: false }), cur("c6"), S).map((e) => e.disabled)).toEqual([false, true, false, false, true, false, false]);
    // 知らないメンバーは []
    expect(entries(m, cur("c9"), S)).toEqual([]);
  });

  test("UI-54/CB-12 攻撃 → 敵の一覧（体数 0 は出さない、番号は生存グループの順）→ battle.input attack", () => {
    const m = menu();
    const a = step(m, cur("c1"), cmd("attack"));
    expect(a).toEqual({ cursor: cur("c1", "enemy", { kind: "attack" }), send: null });
    const list = entries(m, a.cursor, S);
    expect(list.map((e) => e.label)).toEqual([
      t("battle.targetGroup", { n: 1, name: "コボルド", count: 3 }),
      t("battle.targetGroup", { n: 2, name: "多脚の影", count: 1 }),
      t("common.back"),
    ]);
    expect(list.map((e) => e.choice)).toEqual([{ kind: "group", index: 1 }, { kind: "group", index: 2 }, { kind: "back" }]);
    const r = step(m, a.cursor, { kind: "group", index: 2 });
    expect(r.send).toEqual({ type: "battle.input", memberId: "c1", action: { type: "attack", group: 2 } });
    // 送るときの cursor は元のまま（rejected なら描き直すだけ）
    expect(r.cursor).toEqual(a.cursor);
    // 体数 0 のグループは選べない
    expect(step(m, a.cursor, { kind: "group", index: 0 })).toEqual({ cursor: a.cursor, send: null });
    expect(targetNumber(m.groups, 0)).toBeNull();
    expect(targetNumber(m.groups, 1)).toBe(1);
    expect(targetNumber(m.groups, 2)).toBe(2);
  });

  test("UI-54/CB-12 呪文: fire_arrow（enemy）→ 敵、heal（ally）→ 味方、blessing・identify（対象なし）は即 send。usable 偽は送らない", () => {
    const m = menu();
    const sp = step(m, cur("c5"), cmd("spell"));
    expect(sp.cursor).toEqual(cur("c5", "spell"));
    const rows = entries(m, sp.cursor, S);
    expect(rows.map((e) => e.label)).toEqual([
      t("battle.spellRow", { name: "火矢", mp: 2 }),
      t("battle.spellRow", { name: "炎", mp: 5 }),
      t("battle.spellRow", { name: "癒し", mp: 2 }),
      t("battle.spellRow", { name: "加護", mp: 3 }),
      t("battle.spellRow", { name: "看破", mp: 4 }),
      t("common.back"),
    ]);
    expect(rows.map((e) => e.disabled)).toEqual([false, true, false, false, false, false]);

    const fa = step(m, sp.cursor, { kind: "spell", spellId: "fire_arrow" });
    expect(fa).toEqual({ cursor: cur("c5", "enemy", { kind: "cast", spellId: "fire_arrow" }), send: null });
    expect(step(m, fa.cursor, { kind: "group", index: 1 }).send).toEqual({
      type: "battle.input",
      memberId: "c5",
      action: { type: "cast", spellId: "fire_arrow", target: { side: "enemy", group: 1 } },
    });

    const he = step(m, sp.cursor, { kind: "spell", spellId: "heal" });
    expect(he).toEqual({ cursor: cur("c5", "ally", { kind: "cast", spellId: "heal" }), send: null });
    expect(entries(m, he.cursor, S).map((e) => e.label)).toEqual([
      t("battle.targetAlly", { name: "Nc1", hp: 7, hpMax: 9 }),
      t("battle.targetAlly", { name: "Nc2", hp: 4, hpMax: 8 }),
      t("common.back"),
    ]);
    expect(step(m, he.cursor, { kind: "ally", id: "c2" }).send).toEqual({
      type: "battle.input",
      memberId: "c5",
      action: { type: "cast", spellId: "heal", target: { side: "ally", memberId: "c2" } },
    });
    // allies に居ない味方（死亡など）は選べない
    expect(step(m, he.cursor, { kind: "ally", id: "c3" }).send).toBeNull();

    for (const spellId of ["blessing", "identify"]) {
      expect(step(m, sp.cursor, { kind: "spell", spellId })).toEqual({
        cursor: sp.cursor,
        send: { type: "battle.input", memberId: "c5", action: { type: "cast", spellId, target: { side: "none" } } },
      });
    }
    // usable 偽（MP 不足）と知らない呪文は送らず、cursor も不変
    expect(step(m, sp.cursor, { kind: "spell", spellId: "flame_burst" })).toEqual({ cursor: sp.cursor, send: null });
    expect(step(m, sp.cursor, { kind: "spell", spellId: "nope" })).toEqual({ cursor: sp.cursor, send: null });
  });

  test("UI-54/CB-12 道具: ally の道具 → 味方 → send、対象を選ばない道具は即 send", () => {
    const m = menu();
    const it = step(m, cur("c6"), cmd("item"));
    expect(it.cursor).toEqual(cur("c6", "item"));
    expect(entries(m, it.cursor, S).map((e) => e.label)).toEqual(["薬草", "煙玉", t("common.back")]);
    const herb = step(m, it.cursor, { kind: "item", instanceId: "i1" });
    expect(herb.cursor).toEqual(cur("c6", "ally", { kind: "item", instanceId: "i1" }));
    expect(step(m, herb.cursor, { kind: "ally", id: "c1" }).send).toEqual({
      type: "battle.input",
      memberId: "c6",
      action: { type: "item", instanceId: "i1", target: { side: "ally", memberId: "c1" } },
    });
    expect(step(m, it.cursor, { kind: "item", instanceId: "i2" }).send).toEqual({
      type: "battle.input",
      memberId: "c6",
      action: { type: "item", instanceId: "i2", target: { side: "none" } },
    });
  });

  test("UI-54/F2 防御・逃走は即 send、オートは battle.auto on。disabled（呪文なしの呪文、道具なしの道具、逃走不可の逃走）は送らない", () => {
    const m = menu();
    expect(step(m, cur("c2"), cmd("defend"))).toEqual({ cursor: cur("c2"), send: { type: "battle.input", memberId: "c2", action: { type: "defend" } } });
    expect(step(m, cur("c2"), cmd("flee")).send).toEqual({ type: "battle.input", memberId: "c2", action: { type: "flee" } });
    expect(step(m, cur("c2"), cmd("auto")).send).toEqual({ type: "battle.auto", on: true });
    expect(step(m, cur("c2"), cmd("spell"))).toEqual({ cursor: cur("c2"), send: null });
    expect(step(m, cur("c2"), cmd("item"))).toEqual({ cursor: cur("c2"), send: null });
    expect(step(menu({ canFlee: false }), cur("c2"), cmd("flee"))).toEqual({ cursor: cur("c2"), send: null });
    // 段階に合わない選択は無視
    expect(step(m, cur("c2"), { kind: "group", index: 1 })).toEqual({ cursor: cur("c2"), send: null });
    expect(step(m, cur("c2", "enemy", { kind: "attack" }), cmd("defend"))).toEqual({ cursor: cur("c2", "enemy", { kind: "attack" }), send: null });
  });

  test("UI-54 戻る: 対象 → 親（攻撃は command、呪文は spell、道具は item）、spell/item → command、command → 前の行動可能なメンバー（先頭は不変）", () => {
    const m = menu();
    expect(back(m, cur("c1", "enemy", { kind: "attack" }))).toEqual(cur("c1"));
    expect(back(m, cur("c5", "enemy", { kind: "cast", spellId: "fire_arrow" }))).toEqual(cur("c5", "spell"));
    expect(back(m, cur("c5", "ally", { kind: "cast", spellId: "heal" }))).toEqual(cur("c5", "spell"));
    expect(back(m, cur("c6", "ally", { kind: "item", instanceId: "i1" }))).toEqual(cur("c6", "item"));
    expect(back(m, cur("c5", "spell"))).toEqual(cur("c5"));
    expect(back(m, cur("c6", "item"))).toEqual(cur("c6"));
    // c4 の前は c3（麻痺）を飛ばして c2。入力済みでも戻れる
    const m2 = menu({ members: m.members.map((x) => (x.id === "c2" ? { ...x, input: { type: "defend" } } : x)) });
    expect(back(m2, cur("c4"))).toEqual(cur("c2"));
    expect(back(m, cur("c1"))).toEqual(cur("c1"));
    // step 経由でも同じ（一覧の末尾の「戻る」、command の「戻る」）
    expect(step(m, cur("c5", "spell"), { kind: "back" })).toEqual({ cursor: cur("c5"), send: null });
    expect(step(m, cur("c4"), cmd("back"))).toEqual({ cursor: cur("c2"), send: null });
    expect(step(m, cur("c1"), cmd("back"))).toEqual({ cursor: cur("c1"), send: null });
  });
});
