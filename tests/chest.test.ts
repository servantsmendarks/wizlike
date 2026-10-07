// 宝箱（combat.md §6b。M11 の作業 4: 箱の状態と開封の流れ、ドロップの経路）。CB-60〜66、CB-61 / CB-62、IT-56 は loot.test.ts、SV は save.test.ts。
// 箱は debug.chest（UI-57。罠を指定して今の位置にドロップの箱を置く）で出し、乱数は鏡の rng で固定する。
import { describe, expect, test } from "vitest";
import type { GameData } from "../src/core/data";
import { chance, cloneRng, createRng, randInt, rollDice, weightedIndex } from "../src/core/rng";
import { statusPercent } from "../src/core/rules/combat-calc";
import { chestRate, chestView, rollChestTrap } from "../src/core/rules/chest";
import { equipStats } from "../src/core/rules/equip-stats";
import { routeStepOk } from "../src/core/rules/pathfind";
import { cloneState, memberById } from "../src/core/state";
import type { Character, ChestState, Command, GameEvent, GameState } from "../src/core/types";
import { dataWith, dived, eventsOf, exec, expectRejected, kindsOf, withBattle } from "./helpers/battle";
import { data, expectStateInvariants, loadFreshData, withChar } from "./helpers/core";
import { withRng } from "./helpers/dungeon";

const OPEN: Command = { type: "chest.open" };
const LEAVE: Command = { type: "chest.leave" };
const inspect = (memberId: string): Command => ({ type: "chest.inspect", memberId });
const disarm = (memberId: string, trapId: string): Command => ({ type: "chest.disarm", memberId, trapId });
const member = (s: GameState, id: string): Character => memberById(s, id)!;

/** 品を引かない（表の itemChance 0。chance は 1 回消費する）データ。mut でさらに書き換える */
function chestData(mut?: (d: GameData) => void): GameData {
  const d = loadFreshData();
  for (const t of d.drops.tables) t.itemChance = 0;
  mut?.(d);
  return d;
}

/** dived(seed) の今の位置に debug.chest で箱を置き、rng を createRng(k) にした state */
function withChest(trapId: string | null, k = 1, seed = 1, d: GameData = data): GameState {
  const r = exec(dived(seed), { type: "debug.chest", trapId }, d);
  return withRng(r.state, k);
}

const chestOf = (s: GameState): ChestState | null => s.dive!.chest;

/** d01 1 階の中身（金 chestGoldDice → 表 d01_f1 の rolls 1 回の chance(itemChance 0)）の鏡。金を返す */
function mirrorContents(m: ReturnType<typeof createRng>, d: GameData): number {
  const g = Math.max(0, rollDice(m, d.config.combat.chestGoldDice).total);
  chance(m, 0);
  return g;
}

describe("CB-60 箱の状態と受け付け", () => {
  test("CB-60/UI-57 debug.chest: 今の位置にドロップの箱（危険度は罠の値、Lv はその階の遭遇表の最大、inRoom は今のセル）。chestFound → chest.found.drop → chest.prompt。乱数は使わない", () => {
    const s0 = dived(1);
    const r = exec(s0, { type: "debug.chest", trapId: "bomb" });
    expect(r.state.rng).toEqual(s0.rng);
    const lv = Math.max(...data.dungeons[0]!.encounterTable["1"]!.map((e) => data.monsters.find((m) => m.id === e.monster)!.level));
    expect(chestOf(r.state)).toEqual({ source: "drop", cell: null, inRoom: false, trapId: "bomb", danger: 2, level: lv, finding: null, rivalry: null });
    expect(r.events).toEqual([
      { kind: "chestFound", source: "drop" },
      { kind: "message", key: "chest.found.drop" },
      { kind: "message", key: "chest.prompt" },
    ]);
    expect(chestOf(exec(s0, { type: "debug.chest", trapId: null }).state)).toMatchObject({ trapId: null, danger: 0 });
    expectStateInvariants(r.state);
    // 迷宮外・戦闘中・未知の罠は断る
    expectRejected(withBattle(s0, [{ monsterId: "giant_rat", hps: [3] }]), { type: "debug.chest", trapId: null }, "not in dungeon");
    expectRejected(s0, { type: "debug.chest", trapId: "nope" }, "unknown trap");
    expectRejected(s0, { type: "debug.chest", trapId: "pit" } as Command, "unknown trap"); // 床の罠の id 空間とは別
  });

  test("CB-60 箱がある間は chest.* 以外を rejected chest pending（debug.warp / debug.chest も）。E3 より前の debug（hpOne / sanDown）は通る。箱が無ければ chest.* は no chest", () => {
    const s = withChest("crossbow");
    for (const cmd of [
      { type: "dungeon.move" },
      { type: "dungeon.turn", dir: "left" },
      { type: "party.reorder", order: s.party.map((c) => c.id) },
      { type: "debug.warp", to: "trap" },
      { type: "debug.chest", trapId: null },
    ] as Command[]) {
      expectRejected(s, cmd, "chest pending");
    }
    expect(exec(s, { type: "debug.hpOne" }).state.dive!.chest).not.toBeNull();
    expect(exec(s, { type: "debug.sanDown" }).state.dive!.chest).not.toBeNull();
    const none = dived(1);
    for (const cmd of [OPEN, LEAVE, inspect("c3"), disarm("c3", "bomb")]) expectRejected(none, cmd, "no chest");
  });

  test("CB-63/CB-64 検査: 人はパーティの行動可能な者（リーダーも可）、罠は chest-traps.json の id", () => {
    const s = withChest("crossbow");
    expectRejected(s, inspect("c9"), "unknown member");
    expectRejected(withChar(s, 2, { status: ["paralysis"] }), inspect("c3"), "cannot act");
    expectRejected(withChar(s, 2, { life: "dead", hp: 0 }), disarm("c3", "bomb"), "cannot act");
    expectRejected(s, disarm("c3", "pit"), "unknown trap");
    expectRejected(s, { type: "chest.disarm", memberId: "c3" } as unknown as Command, "unknown trap");
    expect(exec(s, inspect("c1")).events[0]!.kind).toBe("dice"); // リーダー
  });

  test("CB-60/A2 逃走の screen dungeon にも at（戦った位置と向き）が載る", () => {
    const s = withBattle(dived(1), [{ monsterId: "giant_rat", hps: [9] }]);
    const r = exec(s, { type: "battle.flee" }, dataWith({ combat: { fleeBase: 1000 } }));
    expect(eventsOf(r.events, "screen")).toEqual([{ kind: "screen", to: "dungeon", dungeonId: "d01", at: { pos: s.dive!.pos, facing: s.dive!.facing } }]);
  });

  test("CB-60/DG-15 routeStepOk は箱を見つけたら偽（B6）", () => {
    const s = dived(1);
    const step = { command: { type: "dungeon.move" as const }, pos: s.dive!.pos, facing: s.dive!.facing };
    const moved: GameEvent[] = [{ kind: "moved", pos: s.dive!.pos, facing: s.dive!.facing }];
    expect(routeStepOk(step, moved, s)).toBe(true);
    expect(routeStepOk(step, moved, withChest(null))).toBe(false);
  });

  test("CB-60/UI-70 chestView: 箱があり戦闘・保留なしのときだけ。members は全員と canAct、trapNames は全 8 種の表示名（データの順）、finding は告げられた名前", () => {
    expect(chestView(dived(1), data)).toBeNull();
    const s = withChar(withChest("crossbow"), 4, { status: ["paralysis"] });
    const v = chestView(s, data)!;
    expect(v.source).toBe("drop");
    expect(v.members.map((m) => [m.id, m.canAct])).toEqual(s.party.map((c) => [c.id, c.id !== "c5"]));
    expect(v.trapNames).toEqual(data.chestTraps.map((t) => ({ id: t.id, name: data.strings[t.name] })));
    expect(v.trapNames.map((t) => t.name)).toEqual(["毒針", "石弓", "爆弾", "毒ガス", "麻痺ガス", "警報", "転移", "呪詛"]);
    expect(v.finding).toBeNull();
    const d = chestData((x) => (x.config.chest.inspect.min = x.config.chest.inspect.max = 100));
    expect(chestView(exec(s, inspect("c3"), d).state, data)!.finding).toEqual({ trapId: "crossbow", name: "石弓" });
    // 判定の成否・罠の有無は載せない
    expect(Object.keys(v).sort()).toEqual(["finding", "members", "source", "trapNames"]);
  });
});

describe("CB-61 罠の抽選", () => {
  test("CB-61 chance(noTrapChance) → weightedIndex(危険度の重み) → randInt(その危険度の罠。データの順)。鏡の rng（シード 1〜40）", () => {
    const def = data.dungeons.find((x) => x.id === "d02")!;
    const seen = new Set<string>();
    for (let k = 1; k <= 40; k++) {
      const rng = createRng(k);
      const m = cloneRng(rng);
      let want: { trapId: string | null; danger: number };
      if (chance(m, 30)) want = { trapId: null, danger: 0 };
      else {
        const danger = weightedIndex(m, def.chestTrapDangerWeights) + 1;
        const list = data.chestTraps.filter((t) => t.danger === danger);
        want = { trapId: list[randInt(m, 0, list.length - 1)]!.id, danger };
      }
      expect(rollChestTrap(rng, data, "d02"), `k ${k}`).toEqual(want);
      expect(rng).toEqual(m);
      seen.add(String(want.trapId));
    }
    expect(seen.has("null")).toBe(true);
    expect(seen.size).toBeGreaterThan(4);
  });

  test("CB-61 ダンジョンの上限より上の危険度は出ない（d01 は 2 まで、d02 は 3 まで。シード 1〜500）", () => {
    for (const [id, max] of [["d01", 2], ["d02", 3]] as const) {
      const dangers = new Set<number>();
      for (let k = 1; k <= 500; k++) dangers.add(rollChestTrap(createRng(k), data, id).danger);
      expect(Math.max(...dangers), id).toBe(max);
      expect(dangers.has(0), id).toBe(true);
    }
  });
});

describe("CB-62 罠の効果（開けて作動させる）", () => {
  const D = chestData();

  test("CB-62/CB-65 毒針: 行動可能な者から randInt で 1 人に 1d4 と毒（判定なし）。その後に中身を得る。石弓は 2d4", () => {
    for (const [trapId, dice] of [["poison_needle", "1d4"], ["crossbow", "2d4"]] as const) {
      const s = withChest(trapId, 7, 1, D);
      const m = cloneRng(s.rng);
      const actor = s.party[randInt(m, 0, 5)]!;
      const dmg = rollDice(m, dice).total;
      const gold = mirrorContents(m, D);
      const r = exec(s, OPEN, D);
      expect(r.state.rng).toEqual(m);
      const hp = Math.max(0, actor.hp - dmg);
      const head: GameEvent[] = [
        { kind: "chestTrap", trapId, actorId: actor.id },
        { kind: "message", key: `chest.trap.${trapId}`, params: { actor: actor.name } },
        { kind: "hpChanged", id: actor.id, delta: hp - actor.hp, hp },
      ];
      expect(r.events.slice(0, 3), trapId).toEqual(head);
      if (trapId === "poison_needle" && hp > 0) {
        expect(r.events.slice(3, 5)).toEqual([
          { kind: "statusChanged", id: actor.id, status: "poison", on: true },
          { kind: "message", key: "battle.status.poison", params: { target: actor.name } },
        ]);
        expect(member(r.state, actor.id).status).toEqual(["poison"]);
      }
      if (trapId === "crossbow") expect(member(r.state, actor.id).status).toEqual([]);
      expect(r.events).toContainEqual({ kind: "message", key: "chest.open.gold", params: { gold } });
      expect(r.events.at(-1)).toEqual({ kind: "chestEnd", result: "opened" });
      expect(chestOf(r.state)).toBeNull();
      expectStateInvariants(r.state);
    }
  });

  test("CB-62 爆弾: 生存者全員に 1d6（並び順に 1 人 1 回。死者は振らない）。actorId は null（開けるで target one でない罠）", () => {
    const s = withChar(withChest("bomb", 3, 1, D), 1, { life: "dead", hp: 0 });
    const m = cloneRng(s.rng);
    const alive = s.party.filter((c) => c.life === "alive");
    const dmg = alive.map(() => rollDice(m, "1d6").total);
    mirrorContents(m, D);
    const r = exec(s, OPEN, D);
    expect(r.state.rng).toEqual(m);
    expect(r.events.slice(0, 2)).toEqual([
      { kind: "chestTrap", trapId: "bomb", actorId: null },
      { kind: "message", key: "chest.trap.bomb" },
    ]);
    expect(eventsOf(r.events, "hpChanged")).toEqual(
      alive.map((c, i) => ({ kind: "hpChanged", id: c.id, delta: Math.max(0, c.hp - dmg[i]!) - c.hp, hp: Math.max(0, c.hp - dmg[i]!) })),
    );
  });

  test("CB-62/CB-30 毒ガス・麻痺ガス: 生存者それぞれに chance(statusPercent(基礎, 実効の luk) − statusResist)。既にかかっている者は振らない", () => {
    for (const trapId of ["poison_gas", "paralysis_gas"] as const) {
      const eff = data.chestTraps.find((t) => t.id === trapId)!.effect as { kind: "status"; status: "poison" | "paralysis"; chance: number };
      const s = withChar(withChest(trapId, 11, 1, D), 0, { status: [eff.status] });
      const m = cloneRng(s.rng);
      const got: string[] = [];
      for (const c of s.party) {
        if (c.status.includes(eff.status)) continue;
        const es = equipStats(s, D, c);
        if (chance(m, statusPercent(D.config, eff.chance, es.stats.luk) - es.statusResist[eff.status])) got.push(c.id);
      }
      const r = exec(s, OPEN, D);
      // 全員が麻痺すれば全滅（このシードでは起きない前提を確かめる）
      expect(r.state.screen, trapId).toBe("dungeon");
      mirrorContents(m, D);
      expect(r.state.rng, trapId).toEqual(m);
      expect(eventsOf(r.events, "statusChanged").map((e) => e.id), trapId).toEqual(got);
      for (const id of got) expect(r.events).toContainEqual({ kind: "message", key: `battle.status.${eff.status}`, params: { target: member(s, id).name } });
    }
  });

  test("CB-62 呪詛: 生存者全員の SAN −8（trap の耐性: 慎重は −4）。乱数なし", () => {
    const s = withChest("curse", 5, 1, D);
    const m = cloneRng(s.rng);
    mirrorContents(m, D);
    const r = exec(s, OPEN, D);
    expect(r.state.rng).toEqual(m);
    const iGold = kindsOf(r.events).indexOf("message:chest.open.gold");
    expect(eventsOf(r.events.slice(0, iGold), "sanChanged").map((e) => [e.id, e.delta])).toEqual([
      ["c1", -8],
      ["c2", -4],
      ["c3", -8],
      ["c4", -8],
      ["c5", -8],
      ["c6", -4],
    ]);
    // 中身の金で強欲（ドナ）の treasureGain +2（呪詛の後なので上限の下）
    expect(r.events[iGold + 1]).toEqual({ kind: "sanChanged", id: "c4", delta: 2, san: 94 });
  });

  test("CB-62/TW-20 罠で全員が行動不能になると中身を得ずに全滅処理（finish の wipeIfNoneCanAct）", () => {
    const d = chestData((x) => {
      const t = x.chestTraps.find((y) => y.id === "paralysis_gas")!;
      (t.effect as { chance: number }).chance = 1000;
    });
    const r = exec(withChest("paralysis_gas", 1, 1, d), OPEN, d);
    const ks = kindsOf(r.events);
    expect(ks).not.toContain("message:chest.open.gold");
    expect(ks).toContain("wipe");
    expect(ks.indexOf("chestEnd")).toBeLessThan(ks.indexOf("wipe"));
    expect(ks).not.toContain("message:chest.prompt");
    expect(r.state.dive).toBeNull();
    expect(r.state.screen).toBe("town");
  });

  test("CB-62（作業 5 までの仮）警報は語りだけで罠が消え、箱は残る（中身なし・chest.prompt）。転移は箱を失う（chestEnd lost）", () => {
    const a = exec(withChest("alarm", 1, 1, D), OPEN, D);
    expect(kindsOf(a.events)).toEqual(["chestTrap", "message:chest.trap.alarm", "message:chest.prompt"]);
    expect(chestOf(a.state)).toMatchObject({ trapId: null, danger: 3 });
    const t = exec(withChest("teleport", 1, 1, D), OPEN, D);
    expect(kindsOf(t.events)).toEqual(["chestTrap", "message:chest.trap.teleport", "chestEnd"]);
    expect(t.events.at(-1)).toEqual({ kind: "chestEnd", result: "lost" });
    expect(chestOf(t.state)).toBeNull();
  });
});

describe("CB-63 調べる", () => {
  test("CB-63 成功率 = clamp(5, 95, 40 + 盗賊 30 + (agi−10)×2 + (luk−10)×2 + trapDetect（性格 + オプション）− 危険度×10)。解除は基本 50", () => {
    const s = dived(1);
    // 既定の一行（実効の能力値）: ベルク 慎重・戦士 agi6 luk6、キリ 無鉄砲・盗賊 agi15 luk15、フィン 慎重・盗賊 agi14 luk11
    expect(chestRate(s, data, "inspect", member(s, "c2"), 0).rate).toBe(40 - 8 - 8 + 30);
    expect(chestRate(s, data, "inspect", member(s, "c3"), 0).rate).toBe(40 + 30 + 10 + 10);
    expect(chestRate(s, data, "inspect", member(s, "c3"), 2).rate).toBe(70);
    expect(chestRate(s, data, "inspect", member(s, "c6"), 0).rate).toBe(95); // 110 → 上限
    expect(chestRate(s, data, "disarm", member(s, "c3"), 2).rate).toBe(80);
    expect(chestRate(s, data, "disarm", member(s, "c3"), 4).rate).toBe(60);
    // 下限 5
    const weak = withChar(s, 1, { stats: { ...member(s, "c2").stats, agi: 3, luk: 3 } });
    expect(chestRate(weak, data, "inspect", member(weak, "c2"), 4).rate).toBe(5);
    // 行: 基本は常に、0 の行は出さない。危険度と上下限は riskRows
    const r = chestRate(s, data, "inspect", member(s, "c6"), 1);
    expect(r.powerRows.map((x) => [x.label.key, x.total])).toEqual([
      ["chest.row.base", 40],
      ["chest.row.thief", 30],
      ["chest.row.agi", 8],
      ["chest.row.luk", 2],
      ["chest.row.trapDetect", 30],
    ]);
    expect(r.power).toBe(110);
    expect(r.riskRows.map((x) => [x.label.key, x.total])).toEqual([
      ["chest.row.danger", -10],
      ["chest.row.clamp", -5],
    ]);
    const leader = chestRate(s, data, "inspect", member(s, "c1"), 0); // 戦士 agi9 luk9、性格なし
    expect(leader.powerRows.map((x) => x.label.key)).toEqual(["chest.row.base", "chest.row.agi", "chest.row.luk"]);
    expect(leader.riskRows).toEqual([]);
  });

  test("CB-63/UI-71（U-2）判定の箱は内訳と計だけ（危険度・上下限・出目の行が無く hidden）。成功なら本当の名前（罠なしは none）を箱の後に語り、finding に入れる", () => {
    const d = chestData((x) => (x.config.chest.inspect.min = x.config.chest.inspect.max = 100));
    const s = withChest("bomb", 2);
    const m = cloneRng(s.rng);
    randInt(m, 1, 100);
    const r = exec(s, inspect("c6"), d);
    expect(r.state.rng).toEqual(m);
    const box = r.events[0]!;
    expect(box).toEqual({
      kind: "dice",
      label: { key: "dice.chestInspect", params: { name: "フィン" } },
      rows: [
        { label: { key: "chest.row.base", params: { v: "40" } }, base: 40, dice: [], total: 40 },
        { label: { key: "chest.row.thief", params: { v: "+30" } }, base: 30, dice: [], total: 30 },
        { label: { key: "chest.row.agi", params: { v: "+8" } }, base: 8, dice: [], total: 8 },
        { label: { key: "chest.row.luk", params: { v: "+2" } }, base: 2, dice: [], total: 2 },
        { label: { key: "chest.row.trapDetect", params: { v: "+30" } }, base: 30, dice: [], total: 30 },
        { label: { key: "chest.row.subtotal", params: { v: "110" } }, base: 110, dice: [], total: 110 },
      ],
      rule: { key: "chest.ruleHidden", params: { mul: 10 } },
      result: { key: "dice.chestInspect.hidden" },
      hidden: true,
    });
    expect(r.events.slice(1)).toEqual([
      { kind: "message", key: "chest.inspect.found", params: { trap: "爆弾" } },
      { kind: "message", key: "chest.prompt" },
    ]);
    expect(chestOf(r.state)!.finding).toEqual({ trapId: "bomb" });
    expect(chestOf(r.state)!.trapId).toBe("bomb"); // 調べても罠は変わらない
    const n = exec(withChest(null), inspect("c6"), d);
    expect(kindsOf(n.events)).toEqual(["dice", "message:chest.inspect.none", "message:chest.prompt"]);
    expect(chestOf(n.state)!.finding).toEqual({ trapId: null });
  });

  test("CB-63 失敗の 2 回目の d100: 1〜triggerChance は作動（作動させた人は調べた人）、続く wrongNameChance の幅は別の名前（本当の罠以外から randInt）、残りは不明", () => {
    const fail = (mut: (x: GameData) => void) =>
      chestData((x) => {
        x.config.chest.inspect.min = x.config.chest.inspect.max = 0;
        mut(x);
      });
    // 作動（石弓。調べた人キリに 2d4）
    const dT = fail((x) => (x.config.chest.triggerChance = 100));
    const s = withChest("crossbow", 4);
    let m = cloneRng(s.rng);
    randInt(m, 1, 100);
    randInt(m, 1, 100);
    const dmg = rollDice(m, "2d4").total;
    const t = exec(s, inspect("c3"), dT);
    expect(t.state.rng).toEqual(m);
    expect(t.events.slice(1, 3)).toEqual([
      { kind: "chestTrap", trapId: "crossbow", actorId: "c3" },
      { kind: "message", key: "chest.trap.crossbow", params: { actor: "キリ" } },
    ]);
    expect(eventsOf(t.events, "hpChanged")[0]).toMatchObject({ id: "c3", delta: -Math.min(dmg, member(s, "c3").hp) });
    expect(chestOf(t.state)).toMatchObject({ trapId: null, danger: 1, finding: null }); // 作動した罠は消える。箱は残る
    expect(kindsOf(t.events).at(-1)).toBe("message:chest.prompt");
    // 罠なしの箱で作動の段なら何も起きず「分からない」
    const n = exec(withChest(null, 4), inspect("c3"), dT);
    expect(kindsOf(n.events)).toEqual(["dice", "message:chest.inspect.unknown", "message:chest.prompt"]);
    // 別の名前（成功と同じ文）。本当の名前とは違う（シード 1〜30 で毎回）
    const dW = fail((x) => {
      x.config.chest.triggerChance = 0;
      x.config.chest.wrongNameChance = 100;
    });
    const others = data.chestTraps.filter((x) => x.id !== "crossbow");
    for (let k = 1; k <= 30; k++) {
      const sk = withChest("crossbow", k);
      m = cloneRng(sk.rng);
      randInt(m, 1, 100);
      randInt(m, 1, 100);
      const told = others[randInt(m, 0, others.length - 1)]!;
      const w = exec(sk, inspect("c3"), dW);
      expect(w.state.rng).toEqual(m);
      expect(w.events[1]).toEqual({ kind: "message", key: "chest.inspect.found", params: { trap: data.strings[told.name] } });
      expect(chestOf(w.state)!.finding).toEqual({ trapId: told.id });
      expect(told.id).not.toBe("crossbow");
    }
    // 罠なしの箱なら全 8 種から
    const sn = withChest(null, 9);
    m = cloneRng(sn.rng);
    randInt(m, 1, 100);
    randInt(m, 1, 100);
    const told = data.chestTraps[randInt(m, 0, 7)]!;
    expect(chestOf(exec(sn, inspect("c3"), dW).state)!.finding).toEqual({ trapId: told.id });
    // 不明
    const dU = fail((x) => {
      x.config.chest.triggerChance = 0;
      x.config.chest.wrongNameChance = 0;
    });
    const told0 = withChest("crossbow", 4);
    told0.dive!.chest!.finding = { trapId: "bomb" }; // 前に告げられた名前は不明で消える
    const u = exec(told0, inspect("c3"), dU);
    expect(kindsOf(u.events)).toEqual(["dice", "message:chest.inspect.unknown", "message:chest.prompt"]);
    expect(chestOf(u.state)!.finding).toBeNull();
  });

  test("CB-63 既定の 2 回目の d100 の幅は 1〜10 作動・11〜60 別の名前・61〜100 不明（鏡の rng。シード 1〜200 で 3 つとも通る）", () => {
    expect([data.config.chest.triggerChance, data.config.chest.wrongNameChance]).toEqual([10, 50]);
    const d = chestData((x) => (x.config.chest.inspect.min = x.config.chest.inspect.max = 0));
    const seen = new Set<string>();
    for (let k = 1; k <= 200 && seen.size < 3; k++) {
      const s = withChest("bomb", k);
      const m = cloneRng(s.rng);
      randInt(m, 1, 100);
      const r2 = randInt(m, 1, 100);
      const want = r2 <= 10 ? "trigger" : r2 <= 60 ? "wrong" : "unknown";
      const ks = kindsOf(exec(s, inspect("c2"), d).events);
      const got = ks[1] === "chestTrap" ? "trigger" : ks[1] === "message:chest.inspect.found" ? "wrong" : "unknown";
      expect(got, `k ${k}`).toBe(want);
      seen.add(got);
    }
    expect(seen.size).toBe(3);
  });

  test("CB-63（B1）危険度は今の trapId から引く: 解除した後は 0 として判定する", () => {
    // ベルク（c2）の調べるの危険度を引く前の値は 40 − 16 + 30 = 54。base をずらして、最初の d100 の出目 = 危険度 0 の成功率にする
    const k = 3;
    const roll = randInt(createRng(k), 1, 100);
    const d = chestData((x) => {
      x.config.chest.inspect.base = roll - 14;
      x.config.chest.inspect.min = 0;
      x.config.chest.inspect.max = 100;
      x.config.chest.disarm.min = x.config.chest.disarm.max = 100;
    });
    const armed = withChest("crossbow", k);
    expect(kindsOf(exec(armed, inspect("c2"), d).events)[1]).not.toBe("message:chest.inspect.none"); // 危険度 1 で 1 足りず失敗
    const disarmed = withRng(exec(armed, disarm("c2", "crossbow"), d).state, k);
    expect(chestOf(disarmed)).toMatchObject({ trapId: null, danger: 1 });
    expect(kindsOf(exec(disarmed, inspect("c2"), d).events)[1]).toBe("message:chest.inspect.none");
  });
});

describe("CB-64 解除", () => {
  test("CB-64 名前が違えば判定せずに chest.disarm.wrong → 作動（作動させた人は解除した人。乱数は効果だけ）", () => {
    const s = withChest("crossbow", 6);
    const m = cloneRng(s.rng);
    rollDice(m, "2d4");
    const r = exec(s, disarm("c6", "bomb"));
    expect(r.state.rng).toEqual(m);
    expect(kindsOf(r.events).slice(0, 3)).toEqual(["message:chest.disarm.wrong", "chestTrap", "message:chest.trap.crossbow"]);
    expect(r.events[1]).toEqual({ kind: "chestTrap", trapId: "crossbow", actorId: "c6" });
    expect(kindsOf(r.events)).not.toContain("dice");
    expect(chestOf(r.state)!.trapId).toBeNull();
  });

  test("CB-64/UI-71 名前が合えば d100（判定の箱は全行: 内訳・危険度・上下限・出目、基準 chest.rule{rate}）。成功で罠なし（finding は罠なし）→ chest.disarm.ok", () => {
    // 最初の d100 が 20〜90 のシードを選び、キリ（盗賊 +30・agi +10・luk +10）の爆弾（危険度 2: −20）の成功率がちょうど出目になる base にする
    let k = 1;
    while (((x) => x < 20 || x > 90)(randInt(createRng(k), 1, 100))) k++;
    const roll = randInt(createRng(k), 1, 100);
    const base = roll - 30;
    const d = chestData((x) => (x.config.chest.disarm.base = base));
    const s = withChest("bomb", k);
    const m = cloneRng(s.rng);
    randInt(m, 1, 100);
    const r = exec(s, disarm("c3", "bomb"), d);
    expect(r.state.rng).toEqual(m);
    expect(r.events[0]).toEqual({
      kind: "dice",
      label: { key: "dice.chestDisarm", params: { name: "キリ", trap: "爆弾" } },
      rows: [
        { label: { key: "chest.row.base", params: { v: String(base) } }, base, dice: [], total: base },
        { label: { key: "chest.row.thief", params: { v: "+30" } }, base: 30, dice: [], total: 30 },
        { label: { key: "chest.row.agi", params: { v: "+10" } }, base: 10, dice: [], total: 10 },
        { label: { key: "chest.row.luk", params: { v: "+10" } }, base: 10, dice: [], total: 10 },
        { label: { key: "chest.row.danger", params: { v: "-20" } }, base: -20, dice: [], total: -20 },
        { label: { key: "chest.row.roll" }, base: null, dice: [roll], total: roll },
      ],
      rule: { key: "chest.rule", params: { rate: roll } },
      result: { key: "dice.chestDisarm.ok" },
    });
    expect(r.events.slice(1)).toEqual([
      { kind: "message", key: "chest.disarm.ok" },
      { kind: "message", key: "chest.prompt" },
    ]);
    expect(chestOf(r.state)).toMatchObject({ trapId: null, danger: 2, finding: { trapId: null } });
    // 上下限の行: 成功率が上限 95 を超えると、その差を出す
    const hi = exec(s, disarm("c3", "bomb"), chestData((x) => (x.config.chest.disarm.base = 200)));
    const rows = (hi.events[0] as Extract<GameEvent, { kind: "dice" }>).rows.map((x) => [x.label.key, x.total]);
    expect(rows.slice(4, 6)).toEqual([
      ["chest.row.danger", -20],
      ["chest.row.clamp", 95 - 230],
    ]);
    // 罠を外した箱を開けると作動せずに中身（危険度は IT-56 の上振れに残る）
    expect(kindsOf(exec(r.state, OPEN, d).events)).not.toContain("chestTrap");
  });

  test("CB-64（U-4）名前が合って失敗: chance(disarmFailTrigger) が当たれば作動、外れれば chest.disarm.fail で箱も罠も残り、再挑戦できる", () => {
    expect(data.config.chest.disarmFailTrigger).toBe(50);
    const never = (t: number) =>
      chestData((x) => {
        x.config.chest.disarm.min = x.config.chest.disarm.max = 0;
        x.config.chest.disarmFailTrigger = t;
      });
    const s = withChest("bomb", 2);
    let m = cloneRng(s.rng);
    randInt(m, 1, 100);
    chance(m, 0);
    const f = exec(s, disarm("c3", "bomb"), never(0));
    expect(f.state.rng).toEqual(m);
    expect(kindsOf(f.events)).toEqual(["dice", "message:chest.disarm.fail", "message:chest.prompt"]);
    expect((f.events[0] as Extract<GameEvent, { kind: "dice" }>).result.key).toBe("dice.chestDisarm.ng");
    expect(chestOf(f.state)!.trapId).toBe("bomb");
    expect(exec(f.state, disarm("c3", "bomb"), never(0)).events[0]!.kind).toBe("dice"); // 再挑戦できる
    m = cloneRng(s.rng);
    randInt(m, 1, 100);
    chance(m, 100);
    for (const c of s.party) if (c.life === "alive") rollDice(m, "1d6");
    const t = exec(s, disarm("c3", "bomb"), never(100));
    expect(t.state.rng).toEqual(m);
    expect(kindsOf(t.events).slice(0, 3)).toEqual(["dice", "chestTrap", "message:chest.trap.bomb"]);
    expect(t.events[1]).toEqual({ kind: "chestTrap", trapId: "bomb", actorId: "c3" });
    expect(chestOf(t.state)!.trapId).toBeNull();
  });

  test("CB-64 罠なしの箱は判定せずに chest.disarm.nothing（乱数なし。箱は罠なしのまま）", () => {
    const s = withChest(null, 2);
    const r = exec(s, disarm("c3", "bomb"));
    expect(r.state.rng).toEqual(s.rng);
    expect(kindsOf(r.events)).toEqual(["message:chest.disarm.nothing", "message:chest.prompt"]);
    expect(chestOf(r.state)).toEqual(chestOf(s));
  });
});

describe("CB-65 / CB-66 開ける・放っておく", () => {
  test("CB-65 罠なしの箱を開けると中身（金 → 品）だけ。chestEnd opened の後は箱なしで、ほかのコマンドを受け付ける", () => {
    const D = chestData();
    const s = withChest(null, 4, 1, D);
    const m = cloneRng(s.rng);
    const gold = mirrorContents(m, D);
    const r = exec(s, OPEN, D);
    expect(r.state.rng).toEqual(m);
    // 強欲（ドナ）の treasureGain は SAN 100（上限）なので sanChanged は出ない
    expect(r.events).toEqual([
      { kind: "message", key: "chest.open.gold", params: { gold } },
      { kind: "chestEnd", result: "opened" },
    ]);
    expect(r.state.gold).toBe(s.gold + gold);
    expect(chestOf(r.state)).toBeNull();
    expect(exec(r.state, { type: "dungeon.turn", dir: "left" }).events[0]!.kind).toBe("turned");
  });

  test("CB-66 放っておく: chest.left → chestEnd left。ドロップの箱は失う（乱数なし）", () => {
    const s = withChest("bomb", 4);
    const r = exec(s, LEAVE);
    expect(r.state.rng).toEqual(s.rng);
    expect(r.events).toEqual([
      { kind: "message", key: "chest.left" },
      { kind: "chestEnd", result: "left" },
    ]);
    expect(chestOf(r.state)).toBeNull();
    expect(r.state.dive!.clearedCells).toEqual(s.dive!.clearedCells);
    expectStateInvariants(r.state);
  });

  test("CB-60 JSON 往復と execute の非破壊: 箱のある state を複製しても同じ結果", () => {
    const s = withChest("poison_gas", 12);
    const a = exec(s, OPEN);
    const b = exec(cloneState(s), OPEN);
    expect(a.state).toEqual(b.state);
    expect(a.events).toEqual(b.events);
    expect(chestOf(s)!.trapId).toBe("poison_gas"); // 引数は書き換えない
  });
});
