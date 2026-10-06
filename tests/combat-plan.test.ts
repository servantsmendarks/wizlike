// rules/combat-plan.ts（オート入力・行動計画・行動順・敵の対象・オート解除）のテスト。純粋。
import { describe, expect, test } from "vitest";
import { autoInput, autoInterruptReason, enemyTargetIds, orderActors, richestGroup, snapMembers, toPlan } from "../src/core/rules/combat-plan";
import { memberById } from "../src/core/state";
import type { BattleAction, Character, GameState } from "../src/core/types";
import { dataWith, dived, withBattle } from "./helpers/battle";
import { data, withChar } from "./helpers/core";

const twoGroups = (): GameState =>
  withBattle(dived(1), [
    { monsterId: "giant_rat", hps: [0, 0] },
    { monsterId: "kobold", hps: [3, 3] },
    { monsterId: "giant_rat", hps: [2] },
  ]);
const ch = (s: GameState, id: string): Character => memberById(s, id)!;
const withLast = (s: GameState, idx: number, a: BattleAction | null): GameState => withChar(s, idx, { lastBattleInput: a });

/** 前衛 3 人を麻痺させた state（CB-14 で後衛が前衛扱い） */
function frontParalyzed(s: GameState): GameState {
  let x = s;
  for (const i of [0, 1, 2]) x = withChar(x, i, { status: ["paralysis"] });
  return x;
}

describe("CB-40/42 autoInput", () => {
  test("CB-40 lastBattleInput が null: 前衛とフィン（ranged）は最小の生存グループへ攻撃、ドナ・エルは防御", () => {
    const s = twoGroups();
    expect(s.party.map((c) => autoInput(s, data, c))).toEqual([
      { type: "attack", group: 1 },
      { type: "attack", group: 1 },
      { type: "attack", group: 1 },
      { type: "defend" },
      { type: "defend" },
      { type: "attack", group: 1 },
    ]);
  });

  test("CB-40 前回の入力を繰り返す（攻撃・防御・呪文・道具）。無い（null）・使えないもの・手元に無い道具は既定に落とす", () => {
    let s = twoGroups();
    s = withLast(s, 0, { type: "attack", group: 2 });
    s = withLast(s, 1, { type: "defend" });
    s = withLast(s, 4, { type: "cast", spellId: "fire_arrow", target: { side: "enemy", group: 2 } });
    s = withLast(s, 3, { type: "item", instanceId: "i13", target: { side: "ally", memberId: "c4" } }); // ドナの解毒草
    expect(ch(s, "c3").lastBattleInput).toBeNull();
    s = withLast(s, 5, { type: "item", instanceId: "i4", target: { side: "ally", memberId: "c1" } }); // アルドの薬草（フィンの手元に無い）
    expect(autoInput(s, data, ch(s, "c1"))).toEqual({ type: "attack", group: 2 });
    expect(autoInput(s, data, ch(s, "c2"))).toEqual({ type: "defend" });
    expect(autoInput(s, data, ch(s, "c3"))).toEqual({ type: "attack", group: 1 });
    expect(autoInput(s, data, ch(s, "c4"))).toEqual({ type: "item", instanceId: "i13", target: { side: "ally", memberId: "c4" } });
    expect(autoInput(s, data, ch(s, "c5"))).toEqual({ type: "cast", spellId: "fire_arrow", target: { side: "enemy", group: 2 } });
    expect(autoInput(s, data, ch(s, "c6"))).toEqual({ type: "attack", group: 1 });
    // 知らない呪文（忘れた）は既定
    const s2 = withChar(s, 4, { knownSpells: ["sleep_mist"] });
    expect(autoInput(s2, data, ch(s2, "c5"))).toEqual({ type: "defend" });
  });

  test("CB-42 対象グループが全滅していれば最小の生存グループへ、味方の対象が死んでいれば HP 割合が最小の生存者（同率は並び順）へ振り替える", () => {
    let s = twoGroups();
    s = withLast(s, 0, { type: "attack", group: 0 });
    s = withLast(s, 4, { type: "cast", spellId: "sleep_mist", target: { side: "enemy", group: 0 } });
    s = withChar(s, 3, { knownSpells: ["heal"], lastBattleInput: { type: "cast", spellId: "heal", target: { side: "ally", memberId: "c6" } } });
    s = withChar(s, 5, { life: "dead", hp: 0 });
    s = withChar(s, 1, { hp: 8 }); // 8/16 = 0.5
    s = withChar(s, 2, { hp: 2 }); // 2/10 = 0.2
    expect(autoInput(s, data, ch(s, "c1"))).toEqual({ type: "attack", group: 1 });
    expect(autoInput(s, data, ch(s, "c5"))).toEqual({ type: "cast", spellId: "sleep_mist", target: { side: "enemy", group: 1 } });
    expect(autoInput(s, data, ch(s, "c4"))).toEqual({ type: "cast", spellId: "heal", target: { side: "ally", memberId: "c3" } });
    // 同率は並び順
    const tie = withChar(s, 2, { hp: 6 }); // 6/10 = 0.6、ベルクとドナ（6/12 は下で作る）
    const tie2 = withChar(tie, 3, { hp: 6 }); // ドナ 6/12 = 0.5 = ベルク 8/16
    expect(autoInput(tie2, data, ch(tie2, "c4"))).toEqual({ type: "cast", spellId: "heal", target: { side: "ally", memberId: "c2" } });
  });
});

describe("CB-13/41 toPlan", () => {
  test("CB-13 ドナの attack は防御（backRow）。CB-14 で前衛扱いならドナの attack は攻撃", () => {
    const s = twoGroups();
    expect(toPlan(s, data, ch(s, "c4"), { type: "attack", group: 1 })).toEqual({ kind: "defend", memberId: "c4", why: "backRow" });
    expect(toPlan(s, data, ch(s, "c6"), { type: "attack", group: 1 })).toEqual({ kind: "attack", memberId: "c6", group: 1, noMp: false });
    expect(toPlan(s, data, ch(s, "c1"), { type: "defend" })).toEqual({ kind: "defend", memberId: "c1", why: "chosen" });
    const f = frontParalyzed(s);
    expect(toPlan(f, data, ch(f, "c4"), { type: "attack", group: 1 })).toEqual({ kind: "attack", memberId: "c4", group: 1, noMp: false });
  });

  test("CB-41 エル MP 1 で fire_arrow: 後衛なら防御（noMp）、前衛扱いなら最小の生存グループへ攻撃（noMp）。MP が足りれば cast のまま", () => {
    const fire: BattleAction = { type: "cast", spellId: "fire_arrow", target: { side: "enemy", group: 2 } };
    const s = withChar(twoGroups(), 4, { mp: 1 });
    expect(toPlan(s, data, ch(s, "c5"), fire)).toEqual({ kind: "defend", memberId: "c5", why: "noMp" });
    const f = frontParalyzed(s);
    expect(toPlan(f, data, ch(f, "c5"), fire)).toEqual({ kind: "attack", memberId: "c5", group: 1, noMp: true });
    const ok = withChar(s, 4, { mp: 2 });
    expect(toPlan(ok, data, ch(ok, "c5"), fire)).toEqual({
      kind: "cast",
      memberId: "c5",
      spellId: "fire_arrow",
      target: { side: "enemy", group: 2 },
    });
  });
});

describe("CB-11 orderActors", () => {
  test("CB-11 init の降順。同値は入力の並び（味方 → 敵）、味方同士は並び順、敵同士は g→u（安定）", () => {
    const entries = [
      { actor: "c1", init: 12 },
      { actor: "c2", init: 15 },
      { actor: "c3", init: 12 },
      { actor: "e0-0", init: 15 },
      { actor: "e0-1", init: 12 },
      { actor: "e1-0", init: 20 },
    ];
    expect(orderActors(entries).map((e) => e.actor)).toEqual(["e1-0", "c2", "e0-0", "c1", "c3", "e0-1"]);
    expect(entries[0]!.actor).toBe("c1"); // 入力を変えない
  });
});

describe("CB-15 enemyTargetIds", () => {
  test("CB-15 前衛の生存者すべて（眠った前衛・麻痺の前衛も含む。行動可能かどうかは問わない）", () => {
    expect(enemyTargetIds(withChar(twoGroups(), 1, { status: ["sleep"] }), data)).toEqual(["c1", "c2", "c3"]);
    expect(enemyTargetIds(withChar(twoGroups(), 2, { status: ["paralysis"] }), data)).toEqual(["c1", "c2", "c3"]);
  });

  test("CB-15 dead・ash・stone の前衛は除く", () => {
    let s = withChar(twoGroups(), 0, { status: ["stone"] });
    s = withChar(s, 2, { status: ["sleep"] });
    expect(enemyTargetIds(s, data)).toEqual(["c2", "c3"]);
    let t = withChar(twoGroups(), 0, { life: "dead", hp: 0 });
    t = withChar(t, 2, { life: "ash", hp: 0 });
    expect(enemyTargetIds(t, data)).toEqual(["c2"]);
  });

  test("CB-15/CB-14 前衛扱いが後衛に移ったら後衛の生存者（全員睡眠でも）。それも空なら空（前衛の麻痺の者へは戻らない）", () => {
    // 前衛は死亡と麻痺 → 行動可能な前衛 0 → 前衛扱いは後衛（CB-14）。後衛は全員睡眠でも対象
    let s = twoGroups();
    s = withChar(s, 0, { life: "dead", hp: 0 });
    s = withChar(s, 1, { status: ["paralysis"] });
    s = withChar(s, 2, { life: "dead", hp: 0 });
    for (const i of [3, 4, 5]) s = withChar(s, i, { status: ["sleep"] });
    expect(enemyTargetIds(s, data)).toEqual(["c4", "c5", "c6"]);
    // 後衛の 1 人が石化なら除く
    expect(enemyTargetIds(withChar(s, 4, { status: ["stone"] }), data)).toEqual(["c4", "c6"]);
    // 後衛が全員死んでいれば候補は空（麻痺のベルクは前衛扱いではないので選ばない）
    let t = s;
    for (const i of [3, 4, 5]) t = withChar(t, i, { life: "dead", hp: 0, status: [] });
    expect(enemyTargetIds(t, data)).toEqual([]);
  });
});

describe("CB-44 オートの性格傾向", () => {
  // 既定の一行: c1 アルド（リーダー）/ c2 ベルク（慎重）/ c3 キリ（無鉄砲）/ c4 ドナ（強欲）/ c5 エル（普通）/ c6 フィン（慎重）
  test("CB-44 defendBelowHalf（慎重）: hp < hpMax × 0.5【仮】で防御、ちょうど 0.5 は元のまま", () => {
    const s = twoGroups(); // 生存グループは 1（kobold ×2）と 2（rat ×1）
    expect(data.config.combat.autoDefendHpRatio).toBe(0.5);
    const below = withChar(s, 1, { hp: 9, hpMax: 20 });
    expect(autoInput(below, data, ch(below, "c2"))).toEqual({ type: "defend" });
    const half = withChar(s, 1, { hp: 10, hpMax: 20 });
    expect(autoInput(half, data, ch(half, "c2"))).toEqual({ type: "attack", group: 1 }); // 基本の入力（最小の生存グループ）
    // 呪文の前回でも、HP が半分未満なら防御
    const caster = withLast(withChar(s, 1, { hp: 9, hpMax: 20, knownSpells: ["fire_arrow"], mp: 10 }), 1, {
      type: "cast",
      spellId: "fire_arrow",
      target: { side: "enemy", group: 2 },
    });
    expect(autoInput(caster, data, ch(caster, "c2"))).toEqual({ type: "defend" });
  });

  test("CB-44 alwaysAttack（無鉄砲）: 基本の入力が防御なら攻撃（最小の生存グループ）に置き換える。呪文・攻撃はそのまま。生存グループが無ければ防御のまま", () => {
    const s = twoGroups();
    const def = withLast(s, 2, { type: "defend" });
    expect(autoInput(def, data, ch(def, "c3"))).toEqual({ type: "attack", group: 1 });
    // HP が低くても攻撃（慎重のような防御はしない）
    const low = withChar(def, 2, { hp: 1 });
    expect(autoInput(low, data, ch(low, "c3"))).toEqual({ type: "attack", group: 1 });
    // 攻撃の前回はそのまま（対象は CB-42 の振り替え）
    const atk2 = withLast(s, 2, { type: "attack", group: 2 });
    expect(autoInput(atk2, data, ch(atk2, "c3"))).toEqual({ type: "attack", group: 2 });
    // 呪文の前回はそのまま（オーケストレーターの決定: 防御のときだけ置き換える）
    const cast = withLast(withChar(s, 2, { knownSpells: ["fire_arrow"] }), 2, {
      type: "cast",
      spellId: "fire_arrow",
      target: { side: "enemy", group: 2 },
    });
    expect(autoInput(cast, data, ch(cast, "c3"))).toEqual({ type: "cast", spellId: "fire_arrow", target: { side: "enemy", group: 2 } });
    // 後衛の無鉄砲（エルを無鉄砲に）: 既定の防御 → 攻撃。toPlan で後衛の防御（backRow。CB-13）
    const back = withChar(s, 4, { personality: "reckless" });
    const a = autoInput(back, data, ch(back, "c5"));
    expect(a).toEqual({ type: "attack", group: 1 });
    expect(toPlan(back, data, ch(back, "c5"), a)).toEqual({ kind: "defend", memberId: "c5", why: "backRow" });
    // 生存グループが無い: 防御のまま
    const empty = withBattle(withLast(dived(1), 2, { type: "defend" }), [{ monsterId: "giant_rat", hps: [0] }]);
    expect(autoInput(empty, data, ch(empty, "c3"))).toEqual({ type: "defend" });
  });

  test("CB-44 targetRichest（強欲）: 攻撃の対象は gold の期待値×生存数の最大、同値は添字の小さい方。呪文・防御は変えない", () => {
    // 期待値の 2 倍: giant_rat 1d4+1 → 1×5+2 = 7、kobold 3d6 → 3×7 = 21、rotting_corpse "0" → 0
    const b = (groups: { monsterId: string; hps: number[] }[]) => withBattle(dived(1), groups).battle!;
    expect(richestGroup(b([{ monsterId: "giant_rat", hps: [1, 1] }, { monsterId: "kobold", hps: [1] }]), data)).toBe(1); // 14 < 21
    expect(richestGroup(b([{ monsterId: "giant_rat", hps: [1, 1, 1] }, { monsterId: "kobold", hps: [1] }]), data)).toBe(0); // 21 = 21 は添字の小さい方
    expect(richestGroup(b([{ monsterId: "giant_rat", hps: [1, 1, 1, 1] }, { monsterId: "kobold", hps: [0, 1] }]), data)).toBe(0); // 28 > 21（死んだ個体は数えない）
    expect(richestGroup(b([{ monsterId: "kobold", hps: [0] }, { monsterId: "rotting_corpse", hps: [1] }]), data)).toBe(1); // 生存は腐った死体だけ（gold "0" で 0）
    expect(richestGroup(b([{ monsterId: "kobold", hps: [0] }]), data)).toBeNull();

    const s = withBattle(dived(1), [
      { monsterId: "giant_rat", hps: [1] },
      { monsterId: "kobold", hps: [1, 1] },
    ]);
    // ドナ（後衛・杖）の前回の攻撃 group 0 → 攻撃のまま対象だけ 1 へ
    const atk0 = withLast(s, 3, { type: "attack", group: 0 });
    expect(autoInput(atk0, data, ch(atk0, "c4"))).toEqual({ type: "attack", group: 1 });
    // 呪文の対象は変えない
    const cast = withLast(withChar(s, 3, { knownSpells: ["fire_arrow"] }), 3, {
      type: "cast",
      spellId: "fire_arrow",
      target: { side: "enemy", group: 0 },
    });
    expect(autoInput(cast, data, ch(cast, "c4"))).toEqual({ type: "cast", spellId: "fire_arrow", target: { side: "enemy", group: 0 } });
    // 防御（既定）は変えない
    expect(autoInput(s, data, ch(s, "c4"))).toEqual({ type: "defend" });
  });

  test("CB-44 none（普通）とリーダーは傾向なし（HP が低くても・防御の前回でもそのまま）", () => {
    let s = twoGroups();
    s = withLast(withChar(s, 0, { hp: 1 }), 0, { type: "defend" });
    s = withLast(withChar(s, 4, { hp: 1 }), 4, { type: "defend" });
    expect(autoInput(s, data, ch(s, "c1"))).toEqual({ type: "defend" });
    expect(autoInput(s, data, ch(s, "c5"))).toEqual({ type: "defend" });
    const a = withLast(withChar(twoGroups(), 0, { hp: 1 }), 0, { type: "attack", group: 2 });
    expect(autoInput(a, data, ch(a, "c1"))).toEqual({ type: "attack", group: 2 });
  });
});

describe("CB-43 autoInterruptReason", () => {
  const ratioCase = (hpBefore: number, hpAfter: number, hpMax = 100) => {
    const s0 = withChar(twoGroups(), 0, { hp: hpBefore, hpMax });
    const before = snapMembers(s0, data);
    return autoInterruptReason(before, withChar(s0, 0, { hp: hpAfter }), data);
  };

  test("CB-43 HP 割合が 0.3 を下回った遷移で hp。0.31→0.29 は hp、0.30→0.29 も hp、0.25→0.2 は null（遷移でない）、0.31→0.30 は null", () => {
    expect(ratioCase(31, 29)).toBe("hp");
    expect(ratioCase(30, 29)).toBe("hp");
    expect(ratioCase(25, 20)).toBeNull();
    expect(ratioCase(31, 30)).toBeNull();
  });

  test("CB-43 毒が付くと status、死亡は dead、SAN の段階の下降で san、変化なしで null、hp と status が同時なら hp", () => {
    const s0 = twoGroups();
    const before = snapMembers(s0, data);
    expect(autoInterruptReason(before, s0, data)).toBeNull();
    expect(autoInterruptReason(before, withChar(s0, 2, { status: ["poison"] }), data)).toBe("status");
    expect(autoInterruptReason(before, withChar(s0, 2, { hp: 0, life: "dead" }), data)).toBe("dead");
    expect(autoInterruptReason(before, withChar(s0, 2, { san: 49 }), data)).toBe("san"); // 50% 未満で uneasy
    expect(autoInterruptReason(before, withChar(s0, 2, { san: 50 }), data)).toBeNull();
    const both = withChar(withChar(s0, 0, { hp: 1 }), 1, { status: ["paralysis"] });
    expect(autoInterruptReason(before, both, data)).toBe("hp");
    // 前から持っていた状態は数えない。死者の状態も数えない
    const poisoned = withChar(s0, 2, { status: ["poison"] });
    expect(autoInterruptReason(snapMembers(poisoned, data), poisoned, data)).toBeNull();
    const deadBefore = withChar(s0, 2, { hp: 0, life: "dead" });
    expect(autoInterruptReason(snapMembers(deadBefore, data), withChar(deadBefore, 2, { status: ["poison"] }), data)).toBeNull();
  });

  test("CB-43 優先順 dead > hp > status > san: 同じラウンドで別のメンバーに条件が重なったときに効く（死亡だけでは hp は立たない）", () => {
    const s0 = withChar(twoGroups(), 0, { hp: 31, hpMax: 100 });
    const before = snapMembers(s0, data);
    const c3dead = (s: GameState) => withChar(s, 2, { hp: 0, life: "dead" });
    // 死亡だけ: hp は前後とも alive のときだけなので立たない
    expect(autoInterruptReason(before, c3dead(s0), data)).toBe("dead");
    // c1 の HP 0.31→0.29 と c3 の死亡が同時 → dead（hp より優先）
    expect(autoInterruptReason(before, withChar(c3dead(s0), 0, { hp: 29 }), data)).toBe("dead");
    // c3 の死亡と c2 の毒が同時 → dead（status より優先）
    expect(autoInterruptReason(before, withChar(c3dead(s0), 1, { status: ["poison"] }), data)).toBe("dead");
    // c1 の毒と c3 の SAN の段階の悪化（49 で uneasy）が同時 → status（san より優先）
    expect(autoInterruptReason(before, withChar(withChar(s0, 0, { status: ["poison"] }), 2, { san: 49 }), data)).toBe("status");
  });
});

describe("CB-26 飛行とオートの対象", () => {
  // twoGroups: 0 = 大ネズミ（全滅）、1 = コボルド ×2、2 = 大ネズミ ×1。アルド c1 は前衛の近接、フィン c6 は後衛の short_bow（reach ranged）
  // 2026-10-06: 飛行の相手にも近接は届く（命中の補正だけ。CB-21）ので、オートは飛行を避けず、防御にも置き換えない
  const flying = (...ids: string[]) =>
    dataWith({}, (d) => {
      for (const m of d.monsters) if (ids.includes(m.id)) m.special.flying = true;
    });
  const dK = flying("kobold");
  const dKR = flying("kobold", "giant_rat");

  test("CB-26/CB-40 オートの既定の入力は飛行に関係なく最小の生存グループへの攻撃（飛行だけの相手でも防御にしない）", () => {
    const s = twoGroups();
    expect(autoInput(s, dK, ch(s, "c1"))).toEqual({ type: "attack", group: 1 });
    expect(autoInput(s, dK, ch(s, "c6"))).toEqual({ type: "attack", group: 1 });
    expect(autoInput(s, dKR, ch(s, "c1"))).toEqual({ type: "attack", group: 1 });
    expect(autoInput(s, dKR, ch(s, "c6"))).toEqual({ type: "attack", group: 1 });
    expect(autoInput(s, data, ch(s, "c1"))).toEqual({ type: "attack", group: 1 });
  });

  test("CB-26/CB-40 前回の攻撃のグループが飛行でも生きていればそのまま", () => {
    let s = withLast(twoGroups(), 0, { type: "attack", group: 1 });
    s = withLast(s, 5, { type: "attack", group: 1 });
    expect(autoInput(s, dK, ch(s, "c1"))).toEqual({ type: "attack", group: 1 });
    expect(autoInput(s, dKR, ch(s, "c1"))).toEqual({ type: "attack", group: 1 });
    expect(autoInput(s, dKR, ch(s, "c6"))).toEqual({ type: "attack", group: 1 });
    const t = withLast(s, 0, { type: "attack", group: 2 });
    expect(autoInput(t, dKR, ch(t, "c1"))).toEqual({ type: "attack", group: 2 });
  });

  test("CB-26/CB-41 MP 不足の置き換えも飛行に関係なく最小の生存グループへの攻撃", () => {
    const fire: BattleAction = { type: "cast", spellId: "fire_arrow", target: { side: "enemy", group: 1 } };
    const f = frontParalyzed(withChar(twoGroups(), 4, { mp: 1 })); // エルは前衛扱い
    expect(toPlan(f, dK, ch(f, "c5"), fire)).toEqual({ kind: "attack", memberId: "c5", group: 1, noMp: true });
    expect(toPlan(f, dKR, ch(f, "c5"), fire)).toEqual({ kind: "attack", memberId: "c5", group: 1, noMp: true });
  });

  test("CB-26/CB-44 無鉄砲・強欲の傾向は今どおり（飛行も狙う）", () => {
    const r = withLast(twoGroups(), 2, { type: "defend" });
    expect(autoInput(r, dKR, ch(r, "c3"))).toEqual({ type: "attack", group: 1 });
    const g = withChar(twoGroups(), 0, { personality: "greedy" });
    expect(autoInput(g, dK, ch(g, "c1"))).toEqual({ type: "attack", group: 1 });
  });
});
