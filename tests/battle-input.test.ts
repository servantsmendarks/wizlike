// UI-54 / CB-10〜12: 戦闘の入力の段階（src/presenter/battle-input.ts）。BattleMenu は手組み（core の battleMenu の戻り値の形）。
import { describe, expect, test } from "vitest";
import type { BattleAction, BattleMenu, BattleMenuMember } from "../src/core/types";
import {
  back,
  entries,
  firstCursor,
  focusedChoice,
  focusedGroup,
  isBackChoice,
  moveFocus,
  nextCursor,
  setFocus,
  spellNote,
  step,
  targetNumber,
  type Choice,
  type InputCursor,
  type MemberCmd,
  type PartyCmd,
  type Pick,
} from "../src/presenter/battle-input";
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
      { index: 0, monsterId: "giant_rat", name: "何かの獣", identified: false, count: 0 },
      { index: 1, monsterId: "kobold", name: "コボルド", identified: true, count: 3 },
      { index: 2, monsterId: "giant_spider", name: "何かの獣", identified: false, count: 1 },
    ],
    members,
    allies: [
      { id: "c1", name: "Nc1", hp: 7, hpMax: 9 },
      { id: "c2", name: "Nc2", hp: 4, hpMax: 8 },
    ],
    ...o,
  };
}

/** members のうち id の入力だけを差し替えた menu */
function withInput(m: BattleMenu, inputs: Record<string, BattleAction>): BattleMenu {
  return { ...m, members: m.members.map((x) => (inputs[x.id] === undefined ? x : { ...x, input: inputs[x.id]! })) };
}

/** グループ 1 だけが生存（W5 の 1 グループ） */
const ONE_GROUP: BattleMenu["groups"] = [
  { index: 0, monsterId: "giant_rat", name: "何かの獣", identified: false, count: 0 },
  { index: 1, monsterId: "kobold", name: "コボルド", identified: true, count: 2 },
];

const PARTY: InputCursor = { stage: "party" };
const mem = (memberId: string): InputCursor => ({ stage: "member", memberId });
const list = (stage: "spell" | "item", memberId: string): InputCursor => ({ stage, memberId });
const tgt = (stage: "enemy" | "ally", memberId: string, pick: Pick, focus = 0): InputCursor => ({ stage, memberId, pick, focus });
const pc = (cmd: PartyCmd): Choice => ({ kind: "party", cmd });
const mc = (cmd: MemberCmd): Choice => ({ kind: "member", cmd });

describe("UI-54 入力の段階", () => {
  test("UI-54/CB-12 入力の段階で使う文言のキーがすべて strings にある", () => {
    for (const k of [
      ...["fight", "repeat", "flee", "auto", "attack", "spell", "defend", "item", "autoStop"].map((c) => `battle.cmd.${c}`),
      ...["party", "member", "spell", "item", "enemy", "ally", "spellConfirm"].map((p) => `battle.prompt.${p}`),
      "spell.info.cast",
      "battle.targetGroup",
      "battle.targetAlly",
      "battle.spellRow",
      "battle.autoOn",
      "battle.autoStopping",
      "common.back",
    ]) {
      expect(Object.prototype.hasOwnProperty.call(S, k), k).toBe(true);
    }
    // 旧 7 枠の見出しは削除済み
    expect(Object.prototype.hasOwnProperty.call(S, "battle.prompt.command")).toBe(false);
  });

  test("UI-54 firstCursor はパーティの選択。オート中・ready・pending 空は null", () => {
    expect(firstCursor(menu())).toEqual(PARTY);
    expect(firstCursor(menu({ auto: true }))).toBeNull();
    expect(firstCursor(menu({ pending: [] }))).toBeNull();
    expect(firstCursor(menu({ ready: true }))).toBeNull();
  });

  test("UI-54 nextCursor は並び順で prev の後ろの pending の member、無ければ pending の先頭、それも無ければ null", () => {
    const m = menu({ pending: ["c2", "c5"] });
    expect(nextCursor(m, "c1")).toEqual(mem("c2"));
    expect(nextCursor(m, "c2")).toEqual(mem("c5"));
    expect(nextCursor(m, "c4")).toEqual(mem("c5"));
    // 末尾の後ろは先頭に戻る（取りこぼしの入力）
    expect(nextCursor(m, "c6")).toEqual(mem("c2"));
    expect(nextCursor(menu({ pending: [] }), "c1")).toBeNull();
    expect(nextCursor(menu({ auto: true }), "c1")).toBeNull();
  });

  test("UI-54/CB-12 ready なら pending が残っていても firstCursor / nextCursor は null（解決の再生中に次のメンバーの枠を出さない）", () => {
    const m = menu({ ready: true, pending: ["c2", "c4", "c5", "c6"] });
    expect(firstCursor(m)).toBeNull();
    expect(nextCursor(m, "c1")).toBeNull();
    expect(nextCursor(m, "c6")).toBeNull();
  });

  test("UI-54/CB-12 パーティの選択の 4 件: 戦う・前回と同じ・逃げる・オート。逃げられない戦闘（canFlee 偽）では逃げるが dim", () => {
    expect(entries(menu(), PARTY, S).map((e) => e.label)).toEqual([
      t("battle.cmd.fight"),
      t("battle.cmd.repeat"),
      t("battle.cmd.flee"),
      t("battle.cmd.auto"),
    ]);
    expect(entries(menu(), PARTY, S).map((e) => e.disabled)).toEqual([false, false, false, false]);
    expect(entries(menu({ canFlee: false }), PARTY, S).map((e) => e.disabled)).toEqual([false, false, true, false]);
    expect(entries(menu(), PARTY, S).map((e) => e.choice)).toEqual([pc("fight"), pc("repeat"), pc("flee"), pc("auto")]);
  });

  test("UI-54/CB-12/CB-50 戦う → 先頭の行動可能なメンバーの member。前回と同じ → battle.repeat、逃げる → battle.flee、オート → battle.auto on", () => {
    const m = menu();
    expect(step(m, PARTY, pc("fight"))).toEqual({ cursor: mem("c1"), send: null });
    // 先頭が行動不能なら次の行動可能な者
    const m2 = { ...m, members: m.members.map((x) => (x.id === "c1" ? { ...x, canAct: false } : x)) };
    expect(step(m2, PARTY, pc("fight"))).toEqual({ cursor: mem("c2"), send: null });
    // 行動可能な者が居なければそのまま
    expect(step({ ...m, members: m.members.map((x) => ({ ...x, canAct: false })) }, PARTY, pc("fight"))).toEqual({ cursor: PARTY, send: null });
    expect(step(m, PARTY, pc("repeat"))).toEqual({ cursor: PARTY, send: { type: "battle.repeat" } });
    expect(step(m, PARTY, pc("flee"))).toEqual({ cursor: PARTY, send: { type: "battle.flee" } });
    expect(step(m, PARTY, pc("auto"))).toEqual({ cursor: PARTY, send: { type: "battle.auto", on: true } });
    // 逃げられない戦闘の逃げるは送らない
    expect(step(menu({ canFlee: false }), PARTY, pc("flee"))).toEqual({ cursor: PARTY, send: null });
    // パーティの選択の戻る・段階に合わない選択は何もしない
    expect(step(m, PARTY, { kind: "back" })).toEqual({ cursor: PARTY, send: null });
    expect(back(m, PARTY)).toEqual(PARTY);
    expect(step(m, PARTY, mc("attack"))).toEqual({ cursor: PARTY, send: null });
    expect(step(m, PARTY, { kind: "group", index: 1 })).toEqual({ cursor: PARTY, send: null });
  });

  test("UI-54/CB-12 メンバーの 5 枠: 攻撃・呪文・防御・道具・戻る。dim は spells 空・items 空で、戻るは常に押せる", () => {
    const m = menu();
    const e1 = entries(m, mem("c1"), S);
    expect(e1.map((e) => e.label)).toEqual([
      t("battle.cmd.attack"),
      t("battle.cmd.spell"),
      t("battle.cmd.defend"),
      t("battle.cmd.item"),
      t("common.back"),
    ]);
    expect(e1.map((e) => e.disabled)).toEqual([false, true, false, true, false]);
    expect(entries(m, mem("c5"), S).map((e) => e.disabled)).toEqual([false, false, false, true, false]);
    expect(entries(m, mem("c6"), S).map((e) => e.disabled)).toEqual([false, true, false, false, false]);
    // 知らないメンバーは []
    expect(entries(m, mem("c9"), S)).toEqual([]);
    expect(step(m, mem("c9"), mc("attack"))).toEqual({ cursor: mem("c9"), send: null });
  });

  test("UI-54/CB-12 攻撃 → 敵の一覧（体数 0 は出さない、番号は生存グループの順）→ battle.input attack", () => {
    const m = menu();
    const a = step(m, mem("c1"), mc("attack"));
    expect(a).toEqual({ cursor: tgt("enemy", "c1", { kind: "attack" }), send: null });
    const rows = entries(m, a.cursor, S);
    expect(rows.map((e) => e.label)).toEqual([
      t("battle.targetGroup", { n: 1, name: "コボルド", count: 3 }),
      t("battle.targetGroup", { n: 2, name: "何かの獣", count: 1 }),
      t("common.back"),
    ]);
    expect(rows.map((e) => e.choice)).toEqual([{ kind: "group", index: 1 }, { kind: "group", index: 2 }, { kind: "back" }]);
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
    const sp = step(m, mem("c5"), mc("spell"));
    expect(sp.cursor).toEqual(list("spell", "c5"));
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
    expect(fa).toEqual({ cursor: tgt("enemy", "c5", { kind: "cast", spellId: "fire_arrow" }), send: null });
    expect(step(m, fa.cursor, { kind: "group", index: 1 }).send).toEqual({
      type: "battle.input",
      memberId: "c5",
      action: { type: "cast", spellId: "fire_arrow", target: { side: "enemy", group: 1 } },
    });

    const he = step(m, sp.cursor, { kind: "spell", spellId: "heal" });
    expect(he).toEqual({ cursor: tgt("ally", "c5", { kind: "cast", spellId: "heal" }), send: null });
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

    // UI-68（M10）/ U4: 対象を選ばない呪文は確認の段（説明を窓に出す）を挟み、唱えるで送る（M3 では即 send だった）
    for (const spellId of ["blessing", "identify"]) {
      const cf = step(m, sp.cursor, { kind: "spell", spellId });
      expect(cf).toEqual({ cursor: { stage: "spellConfirm", memberId: "c5", spellId }, send: null });
      expect(step(m, cf.cursor, { kind: "castConfirm" })).toEqual({
        cursor: cf.cursor,
        send: { type: "battle.input", memberId: "c5", action: { type: "cast", spellId, target: { side: "none" } } },
      });
    }
    // 2026-10-07（A-A3）: usable 偽（MP 不足）の呪文は送らず、確認の段で説明だけ見せる（キャンプの peek と揃えた。M10 の初めは cursor 不変だった）。
    // 知らない呪文は送らず、cursor も不変
    expect(step(m, sp.cursor, { kind: "spell", spellId: "flame_burst" })).toEqual({ cursor: { stage: "spellConfirm", memberId: "c5", spellId: "flame_burst" }, send: null });
    expect(step(m, sp.cursor, { kind: "spell", spellId: "nope" })).toEqual({ cursor: sp.cursor, send: null });
  });

  test("UI-54/CB-12 道具: ally の道具 → 味方 → send、対象を選ばない道具は即 send", () => {
    const m = menu();
    const it = step(m, mem("c6"), mc("item"));
    expect(it.cursor).toEqual(list("item", "c6"));
    expect(entries(m, it.cursor, S).map((e) => e.label)).toEqual(["薬草", "煙玉", t("common.back")]);
    const herb = step(m, it.cursor, { kind: "item", instanceId: "i1" });
    expect(herb.cursor).toEqual(tgt("ally", "c6", { kind: "item", instanceId: "i1" }));
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

  test("UI-54/CB-12 防御は即 send。disabled（呪文なしの呪文、道具なしの道具）と段階に合わない選択は送らない", () => {
    const m = menu();
    expect(step(m, mem("c2"), mc("defend"))).toEqual({ cursor: mem("c2"), send: { type: "battle.input", memberId: "c2", action: { type: "defend" } } });
    expect(step(m, mem("c2"), mc("spell"))).toEqual({ cursor: mem("c2"), send: null });
    expect(step(m, mem("c2"), mc("item"))).toEqual({ cursor: mem("c2"), send: null });
    expect(step(m, mem("c2"), { kind: "group", index: 1 })).toEqual({ cursor: mem("c2"), send: null });
    expect(step(m, mem("c2"), pc("flee"))).toEqual({ cursor: mem("c2"), send: null });
    const e = tgt("enemy", "c2", { kind: "attack" });
    expect(step(m, e, mc("defend"))).toEqual({ cursor: e, send: null });
    // 対象の段で member の「戻る」は受けない（一覧の戻るは { kind: "back" }）
    expect(step(m, e, mc("back"))).toEqual({ cursor: e, send: null });
  });

  test("UI-54 W2 戻る: member → 並び順で前の行動可能なメンバー（c4 → c2、麻痺の c3 を飛ばす。入力済みでも戻れる）、先頭（c1）→ パーティの選択", () => {
    const m = menu();
    expect(back(m, mem("c4"))).toEqual(mem("c2"));
    const m2 = withInput(m, { c2: { type: "defend" } });
    expect(back(m2, mem("c4"))).toEqual(mem("c2"));
    expect(back(m, mem("c2"))).toEqual(mem("c1"));
    expect(back(m, mem("c1"))).toEqual(PARTY);
    // 先頭が行動不能なら、最初の行動可能な者が先頭扱い
    const m3 = { ...m, members: m.members.map((x) => (x.id === "c1" ? { ...x, canAct: false } : x)) };
    expect(back(m3, mem("c2"))).toEqual(PARTY);
    // step 経由（メンバーの枠の「戻る」と Esc の { kind: "back" }）でも同じ
    expect(step(m, mem("c4"), mc("back"))).toEqual({ cursor: mem("c2"), send: null });
    expect(step(m, mem("c1"), mc("back"))).toEqual({ cursor: PARTY, send: null });
    expect(step(m, mem("c1"), { kind: "back" })).toEqual({ cursor: PARTY, send: null });
  });

  test("UI-54 戻る: 対象 → 親（攻撃は member、呪文は spell、道具は item）、spell / item → member", () => {
    const m = menu();
    expect(back(m, tgt("enemy", "c1", { kind: "attack" }, 1))).toEqual(mem("c1"));
    expect(back(m, tgt("enemy", "c5", { kind: "cast", spellId: "fire_arrow" }))).toEqual(list("spell", "c5"));
    expect(back(m, tgt("ally", "c5", { kind: "cast", spellId: "heal" }))).toEqual(list("spell", "c5"));
    expect(back(m, tgt("ally", "c6", { kind: "item", instanceId: "i1" }))).toEqual(list("item", "c6"));
    expect(back(m, list("spell", "c5"))).toEqual(mem("c5"));
    expect(back(m, list("item", "c6"))).toEqual(mem("c6"));
    expect(step(m, list("spell", "c5"), { kind: "back" })).toEqual({ cursor: mem("c5"), send: null });
    expect(step(m, tgt("enemy", "c1", { kind: "attack" }), { kind: "back" })).toEqual({ cursor: mem("c1"), send: null });
  });

  // UI-68（M10）/ U4: 敵の呪文は、対象の一覧を飛ばす代わりに確認の段（説明）を挟み、唱えるでそのグループへ送る（M3 では即 send だった）
  test("UI-54 W5 体数 1 以上の敵グループが 1 つだけなら、攻撃と敵の呪文は対象の一覧を飛ばす（呪文は UI-68 の確認の段の後に送る）。味方の対象は飛ばさない", () => {
    const m = menu({ groups: ONE_GROUP });
    expect(step(m, mem("c1"), mc("attack"))).toEqual({
      cursor: mem("c1"),
      send: { type: "battle.input", memberId: "c1", action: { type: "attack", group: 1 } },
    });
    const sp = list("spell", "c5");
    const cf = step(m, sp, { kind: "spell", spellId: "fire_arrow" });
    expect(cf).toEqual({ cursor: { stage: "spellConfirm", memberId: "c5", spellId: "fire_arrow" }, send: null });
    expect(step(m, cf.cursor, { kind: "castConfirm" })).toEqual({
      cursor: cf.cursor,
      send: { type: "battle.input", memberId: "c5", action: { type: "cast", spellId: "fire_arrow", target: { side: "enemy", group: 1 } } },
    });
    expect(step(m, sp, { kind: "spell", spellId: "heal" })).toEqual({
      cursor: tgt("ally", "c5", { kind: "cast", spellId: "heal" }),
      send: null,
    });
    // 2 グループなら飛ばさない
    expect(step(menu(), mem("c1"), mc("attack")).send).toBeNull();
  });

  test("UI-54 W5 対象の一覧の初期の注目は、1 つ前の行動可能なメンバーの入力の対象（今も選べるとき）。無ければ 0", () => {
    const m = menu();
    const atk: Pick = { kind: "attack" };
    // c1 が attack(2) → c2 の敵の一覧はグループ 2（一覧の添字 1）
    expect(step(withInput(m, { c1: { type: "attack", group: 2 } }), mem("c2"), mc("attack")).cursor).toEqual(tgt("enemy", "c2", atk, 1));
    expect(step(withInput(m, { c1: { type: "attack", group: 1 } }), mem("c2"), mc("attack")).cursor).toEqual(tgt("enemy", "c2", atk, 0));
    // 対象のグループが全滅していれば 0
    const dead = { ...m, groups: m.groups.map((g) => (g.index === 2 ? { ...g, count: 0 } : g)), pending: m.pending };
    const deadPlus = { ...dead, groups: [...dead.groups, { index: 3, monsterId: "kobold", name: "K", identified: true, count: 2 }] };
    expect(step(withInput(deadPlus, { c1: { type: "attack", group: 2 } }), mem("c2"), mc("attack")).cursor).toEqual(tgt("enemy", "c2", atk, 0));
    // 前が防御・未入力なら 0
    expect(step(withInput(m, { c1: { type: "defend" } }), mem("c2"), mc("attack")).cursor).toEqual(tgt("enemy", "c2", atk, 0));
    expect(step(m, mem("c2"), mc("attack")).cursor).toEqual(tgt("enemy", "c2", atk, 0));
    // c4 の前は麻痺の c3 を飛ばして c2
    expect(step(withInput(m, { c2: { type: "attack", group: 2 } }), mem("c4"), mc("attack")).cursor).toEqual(tgt("enemy", "c4", atk, 1));
    // 呪文の敵の対象も同じ（c5 の前は c4。cast の target の group）
    const m5 = withInput(m, { c4: { type: "cast", spellId: "x", target: { side: "enemy", group: 2 } } });
    expect(step(m5, list("spell", "c5"), { kind: "spell", spellId: "fire_arrow" }).cursor).toEqual(
      tgt("enemy", "c5", { kind: "cast", spellId: "fire_arrow" }, 1),
    );
    // 味方: c6 の前は c5。heal を c2 に → c6 の薬草の味方の一覧は c2（添字 1）
    const herb: Pick = { kind: "item", instanceId: "i1" };
    const m6 = withInput(m, { c5: { type: "cast", spellId: "heal", target: { side: "ally", memberId: "c2" } } });
    expect(step(m6, list("item", "c6"), { kind: "item", instanceId: "i1" }).cursor).toEqual(tgt("ally", "c6", herb, 1));
    // 味方の対象が allies に居なければ 0
    const m6b = { ...m6, allies: m6.allies.filter((a) => a.id !== "c2") };
    expect(step(m6b, list("item", "c6"), { kind: "item", instanceId: "i1" }).cursor).toEqual(tgt("ally", "c6", herb, 0));
    // 側が違えば 0（前が敵を狙っていても味方の一覧は 0）
    const m6c = withInput(m, { c5: { type: "cast", spellId: "fire_arrow", target: { side: "enemy", group: 2 } } });
    expect(step(m6c, list("item", "c6"), { kind: "item", instanceId: "i1" }).cursor).toEqual(tgt("ally", "c6", herb, 0));
  });

  test("UI-54/UI-33 moveFocus は 0..末尾（戻る）でクランプ。focusedChoice は注目の選択肢、focusedGroup は enemy の段のグループだけ", () => {
    const m = menu();
    const c0 = tgt("enemy", "c1", { kind: "attack" }, 0);
    expect(moveFocus(m, c0, -1)).toEqual(c0);
    const c1 = moveFocus(m, c0, 1);
    expect(c1).toEqual(tgt("enemy", "c1", { kind: "attack" }, 1));
    const c2 = moveFocus(m, c1, 1);
    expect(c2).toEqual(tgt("enemy", "c1", { kind: "attack" }, 2));
    expect(moveFocus(m, c2, 1)).toEqual(c2);
    expect(focusedChoice(m, c0)).toEqual({ kind: "group", index: 1 });
    expect(focusedChoice(m, c1)).toEqual({ kind: "group", index: 2 });
    expect(focusedChoice(m, c2)).toEqual({ kind: "back" });
    expect(focusedGroup(m, c0)).toBe(1);
    expect(focusedGroup(m, c1)).toBe(2);
    expect(focusedGroup(m, c2)).toBeNull();
    expect(setFocus(m, c0, 9)).toEqual(c2);
    expect(setFocus(m, c2, -3)).toEqual(c0);
    // 味方の一覧（2 人 + 戻る）
    const a = tgt("ally", "c5", { kind: "cast", spellId: "heal" }, 1);
    expect(focusedChoice(m, a)).toEqual({ kind: "ally", id: "c2" });
    expect(focusedGroup(m, a)).toBeNull();
    expect(moveFocus(m, a, 1)).toEqual({ ...a, focus: 2 });
    // 対象以外の段は不変・null
    for (const c of [PARTY, mem("c1"), list("spell", "c5")]) {
      expect(moveFocus(m, c, 1)).toEqual(c);
      expect(setFocus(m, c, 1)).toEqual(c);
      expect(focusedChoice(m, c)).toBeNull();
      expect(focusedGroup(m, c)).toBeNull();
    }
    // 注目の選択肢を step に渡すと、その対象で送る（Enter = 注目を選ぶ）
    expect(step(m, c1, focusedChoice(m, c1)!).send).toEqual({ type: "battle.input", memberId: "c1", action: { type: "attack", group: 2 } });
    expect(step(m, c2, focusedChoice(m, c2)!).cursor).toEqual(mem("c1"));
  });
});

describe("UI-66（2026-10-07）戻るの選択肢", () => {
  test("UI-66 isBackChoice はメンバーの枠の戻る（member の back）と一覧の末尾の戻る（back）だけ真。各段の entries で戻るの行だけが真", () => {
    expect(isBackChoice(mc("back"))).toBe(true);
    expect(isBackChoice({ kind: "back" })).toBe(true);
    for (const c of ["attack", "spell", "defend", "item"] as const) expect(isBackChoice(mc(c))).toBe(false);
    for (const c of ["fight", "repeat", "flee", "auto"] as const) expect(isBackChoice(pc(c))).toBe(false);
    const m = menu();
    const backs = (cur: InputCursor): boolean[] => entries(m, cur, S).map((e) => isBackChoice(e.choice));
    expect(backs(PARTY)).toEqual([false, false, false, false]);
    expect(backs(mem("c1"))).toEqual([false, false, false, false, true]);
    const spell = backs(list("spell", "c5"));
    expect(spell[spell.length - 1]).toBe(true);
    expect(spell.slice(0, -1).every((x) => !x)).toBe(true);
    const enemy = backs(tgt("enemy", "c1", { kind: "attack" }));
    expect(enemy).toEqual([false, false, true]);
  });
});

// M10（2026-10-07）: UI-68 呪文の説明。対象を選ぶ呪文は対象の段、対象を選ばない呪文（と敵が 1 グループの敵の呪文）は確認の段 spellConfirm（U4）
describe("UI-68 呪文の確認の段と説明（M10）", () => {
  const confirm = (memberId: string, spellId: string): InputCursor => ({ stage: "spellConfirm", memberId, spellId });

  test("UI-68 確認の段は [唱える][戻る]（末尾が戻る）。戻るは呪文の一覧。段に合わない選択と usable 偽は送らない", () => {
    const m = menu();
    const cf = confirm("c5", "blessing");
    expect(entries(m, cf, S)).toEqual([
      { label: t("spell.info.cast"), disabled: false, choice: { kind: "castConfirm" } },
      { label: t("common.back"), disabled: false, choice: { kind: "back" } },
    ]);
    expect(back(m, cf)).toEqual({ stage: "spell", memberId: "c5" });
    expect(step(m, cf, { kind: "back" })).toEqual({ cursor: { stage: "spell", memberId: "c5" }, send: null });
    expect(step(m, cf, { kind: "group", index: 1 })).toEqual({ cursor: cf, send: null });
    expect(step(m, cf, mc("back"))).toEqual({ cursor: cf, send: null });
    // MP 不足（usable 偽）の呪文の確認の段は送らない
    expect(step(m, confirm("c5", "flame_burst"), { kind: "castConfirm" })).toEqual({ cursor: confirm("c5", "flame_burst"), send: null });
    // 一覧の段では castConfirm を受けない
    expect(step(m, { stage: "spell", memberId: "c5" }, { kind: "castConfirm" })).toEqual({ cursor: { stage: "spell", memberId: "c5" }, send: null });
  });

  test("UI-68（2026-10-07 A-A3）唱えられない（MP 不足で dim の）呪文も押せば確認の段で説明を見られ、[唱える] は dim で送らない。dim の行だけ peek（キャンプと同じ）", () => {
    const m = menu();
    const sp: InputCursor = { stage: "spell", memberId: "c5" };
    const rows = entries(m, sp, S);
    // dim の行は peek（押せば選ぶ）。押せる行と戻るには付けない
    expect(rows.map((e) => e.peek === true)).toEqual([false, true, false, false, false, false]);
    const fb = step(m, sp, { kind: "spell", spellId: "flame_burst" });
    expect(fb).toEqual({ cursor: confirm("c5", "flame_burst"), send: null });
    expect(spellNote(fb.cursor)).toEqual({ memberId: "c5", spellId: "flame_burst" });
    expect(entries(m, fb.cursor, S)).toEqual([
      { label: t("spell.info.cast"), disabled: true, choice: { kind: "castConfirm" } },
      { label: t("common.back"), disabled: false, choice: { kind: "back" } },
    ]);
    expect(step(m, fb.cursor, { kind: "castConfirm" })).toEqual({ cursor: fb.cursor, send: null });
    expect(step(m, fb.cursor, { kind: "back" })).toEqual({ cursor: sp, send: null });
  });

  test("UI-68/U4 手数: 対象を選ぶ呪文（火矢・治癒）は一覧 → 対象 → 送る、対象を選ばない呪文（加護）は一覧 → 確認 → 送る。どちらも一覧の後 2 タップ", () => {
    const m = menu();
    const sp: InputCursor = { stage: "spell", memberId: "c5" };
    const fa = step(m, sp, { kind: "spell", spellId: "fire_arrow" });
    expect(fa.cursor.stage).toBe("enemy");
    expect(step(m, fa.cursor, { kind: "group", index: 1 }).send).not.toBeNull();
    const bl = step(m, sp, { kind: "spell", spellId: "blessing" });
    expect(bl.cursor.stage).toBe("spellConfirm");
    expect(step(m, bl.cursor, { kind: "castConfirm" }).send).not.toBeNull();
  });

  test("UI-68 spellNote: 説明を出すのは確認の段と、呪文の対象の段だけ（攻撃・道具の対象、一覧、メンバーの枠、パーティの選択は null）", () => {
    expect(spellNote(confirm("c5", "blessing"))).toEqual({ memberId: "c5", spellId: "blessing" });
    expect(spellNote(tgt("enemy", "c5", { kind: "cast", spellId: "fire_arrow" }))).toEqual({ memberId: "c5", spellId: "fire_arrow" });
    expect(spellNote(tgt("ally", "c5", { kind: "cast", spellId: "heal" }))).toEqual({ memberId: "c5", spellId: "heal" });
    expect(spellNote(tgt("enemy", "c1", { kind: "attack" }))).toBeNull();
    expect(spellNote(tgt("ally", "c6", { kind: "item", instanceId: "i1" }))).toBeNull();
    expect(spellNote({ stage: "spell", memberId: "c5" })).toBeNull();
    expect(spellNote(mem("c5"))).toBeNull();
    expect(spellNote({ stage: "party" })).toBeNull();
  });
});
