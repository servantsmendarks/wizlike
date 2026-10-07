// 宝箱（combat.md §6b。M11 の作業 4: 箱の状態と開封の流れ、ドロップの経路）。CB-60〜66、CB-61 / CB-62、IT-56 は loot.test.ts、SV は save.test.ts。
// 箱は debug.chest（UI-57。罠を指定して今の位置にドロップの箱を置く）で出し、乱数は鏡の rng で固定する。
import { describe, expect, test } from "vitest";
import type { GameData } from "../src/core/data";
import { chance, cloneRng, createRng, randInt, rollDice, rollDie, weightedIndex, type RngState } from "../src/core/rng";
import { statusPercent } from "../src/core/rules/combat-calc";
import { chestRate, chestView, presentChest, rollChestTrap } from "../src/core/rules/chest";
import { battleMenu, startAlarmEncounter } from "../src/core/rules/combat";
import { floorOf, mapView, visibleCellsOf } from "../src/core/rules/dungeon";
import { cellAt, idx } from "../src/core/rules/dungeon-gen";
import { effectiveStats, equipStats } from "../src/core/rules/equip-stats";
import { impulseChance } from "../src/core/rules/events";
import { routeStepOk } from "../src/core/rules/pathfind";
import { cloneState, makeContext, memberById } from "../src/core/state";
import type { Character, ChestState, Command, GameEvent, GameState } from "../src/core/types";
import { allInputs, dataWith, dived, eventsOf, exec, expectRejected, kindsOf, withBattle } from "./helpers/battle";
import { data, expectKnownStringKeys, expectStateInvariants, loadFreshData, withChar } from "./helpers/core";
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
});

describe("CB-67 警報の戦闘", () => {
  const D = chestData();

  test("CB-62/CB-67 開けて警報: chestTrap（actorId null）→ chest.trap.alarm → 遭遇（startTableEncounter と同じ乱数と events）。origin alarm（inRoom は箱の値）、箱は罠なしで残り、中身・chestEnd・chest.prompt は無い", () => {
    for (const inRoom of [false, true]) {
      const s = withChest("alarm", 5, 1, D);
      s.dive!.chest!.inRoom = inRoom;
      const m = cloneState(s);
      m.dive!.chest!.trapId = null;
      const ctx = makeContext(m, D);
      startAlarmEncounter(ctx, inRoom);
      const r = exec(s, OPEN, D);
      expect(r.state.rng).toEqual(m.rng);
      expect(r.events).toEqual([{ kind: "chestTrap", trapId: "alarm", actorId: null }, { kind: "message", key: "chest.trap.alarm" }, ...ctx.events]);
      expect(r.events[2]).toEqual({ kind: "screen", to: "battle" });
      expect(r.state.battle).toEqual(m.battle);
      expect(r.state.battle!.origin).toEqual({ kind: "alarm", inRoom });
      expect(chestOf(r.state)).toMatchObject({ trapId: null, danger: 3 });
      const ks = kindsOf(r.events);
      for (const k of ["message:chest.open.gold", "message:chest.prompt", "chestEnd"]) expect(ks).not.toContain(k);
      expectStateInvariants(r.state);
      // 戦闘中は chest.* を断り（in battle）、逃走できる（CB-02）
      expectRejected(r.state, OPEN, "in battle");
      expect(battleMenu(r.state, D)!.canFlee).toBe(true);
      expect(chestView(r.state, D)).toBeNull();
    }
  });

  test("CB-64/CB-67 解除の名前違いでも警報（作動させた人は解除した人）→ 遭遇", () => {
    const r = exec(withChest("alarm", 5, 1, D), disarm("c3", "bomb"), D);
    expect(kindsOf(r.events).slice(0, 4)).toEqual(["message:chest.disarm.wrong", "chestTrap", "message:chest.trap.alarm", "screen"]);
    expect(r.events[1]).toEqual({ kind: "chestTrap", trapId: "alarm", actorId: "c3" });
    expect(r.state.battle!.origin).toEqual({ kind: "alarm", inRoom: false });
    expect(kindsOf(r.events)).not.toContain("message:chest.prompt");
  });

  test("CB-67/CB-51/A2 警報の戦闘に勝つと新しい宝箱を判定せず（chance を振らない）、screen{dungeon, at} → chestFound → chest.afterAlarm → chest.prompt で同じ箱に戻る。その後は開けて中身を得る", () => {
    const d = chestData((x) => {
      x.config.combat.hitMin = x.config.combat.hitMax = 100;
      x.config.combat.chestChance = x.config.combat.chestChanceCorridor = 0;
    });
    const s0 = exec(withChest("alarm", 5, 1, d), OPEN, d).state;
    const s = withBattle(s0, [{ monsterId: "giant_rat", hps: [1], status: [["paralysis"]] }], {
      origin: { kind: "alarm", inRoom: true },
      identified: ["giant_rat"],
      inputs: allInputs(s0, { type: "defend" }, { c1: { type: "attack", group: 0 } }),
    });
    const r = exec(s, { type: "battle.resolve" }, d);
    expect(eventsOf(r.events, "battleEnd")).toEqual([{ kind: "battleEnd", result: "win" }]);
    // 同じ戦闘を origin random（箱なし）で解くと、宝箱の chance の 1 回だけ多く引く
    const sr = cloneState(s);
    sr.battle!.origin = { kind: "random", inRoom: true };
    sr.dive!.chest = null;
    const rr = exec(sr, { type: "battle.resolve" }, d);
    const m = cloneRng(r.state.rng);
    chance(m, 0);
    expect(rr.state.rng).toEqual(m);
    // 再生の並び: 戦闘の終わりの screen{dungeon}（戦った位置）の後に同じ箱へ戻る
    const iScreen = r.events.findIndex((e) => e.kind === "screen");
    expect(r.events.slice(iScreen)).toEqual([
      { kind: "screen", to: "dungeon", dungeonId: "d01", at: { pos: s.dive!.pos, facing: s.dive!.facing } },
      { kind: "chestFound", source: "drop" },
      { kind: "message", key: "chest.afterAlarm" },
      { kind: "message", key: "chest.prompt" },
    ]);
    expect(r.state.battle).toBeNull();
    expect(chestOf(r.state)).toEqual({ ...chestOf(s0)!, trapId: null });
    expect(chestView(r.state, d)).not.toBeNull();
    expectStateInvariants(r.state);
    // 罠は作動して消えているので、開ければ中身だけ
    const o = exec(r.state, OPEN, d);
    expect(kindsOf(o.events)[0]).toBe("message:chest.open.gold");
    expect(o.events.at(-1)).toEqual({ kind: "chestEnd", result: "opened" });
  });

  test("CB-67/CB-02 警報の戦闘は逃走でき、逃げると箱を失う: screen{dungeon, at} → chest.fled → chestEnd lost（ドロップ）。宝箱のセルは chestEnd left（罠なしで残り、clearedCells に入れない）", () => {
    const dF = chestData((x) => (x.config.combat.fleeBase = 1000));
    const s = exec(withChest("alarm", 5, 1, D), OPEN, D).state;
    const r = exec(s, { type: "battle.flee" }, dF);
    const iScreen = r.events.findIndex((e) => e.kind === "screen");
    expect(r.events.slice(iScreen)).toEqual([
      { kind: "screen", to: "dungeon", dungeonId: "d01", at: { pos: s.dive!.pos, facing: s.dive!.facing } },
      { kind: "message", key: "chest.fled" },
      { kind: "chestEnd", result: "lost" },
    ]);
    expect(chestOf(r.state)).toBeNull();
    expectStateInvariants(r.state);
    // 宝箱のセル
    const sc = cloneState(s);
    const cell = { floor: 1, x: sc.dive!.pos.x, y: sc.dive!.pos.y };
    sc.dive!.chest = { ...sc.dive!.chest!, source: "cell", cell };
    sc.dive!.disarmedChests = [{ ...cell }];
    const rc = exec(sc, { type: "battle.flee" }, dF);
    expect(rc.events.at(-1)).toEqual({ kind: "chestEnd", result: "left" });
    expect(rc.state.dive!.clearedCells).toEqual(sc.dive!.clearedCells);
    expect(rc.state.dive!.disarmedChests).toEqual([cell]);
  });
});

describe("DG-25 転移", () => {
  const D = chestData();
  /** 今の階の実効の構造で、corridor かつ roomId null の、今の位置以外のセル（添字の昇順） */
  const candidates = (s: GameState, d: GameData = D) => {
    const f = floorOf(s.dive!, d);
    const here = idx(f, s.dive!.pos.x, s.dive!.pos.y);
    return f.cells.flatMap((c, i) => (c.kind === "corridor" && c.roomId === null && i !== here ? [{ x: i % f.width, y: Math.floor(i / f.width) }] : []));
  };

  test("DG-25/CB-62 開けて転移: chestTrap → chest.trap.teleport → chestEnd lost → moved{pos, facing}。行き先は同じ階の通路（roomId null・今の位置以外。添字の昇順）から randInt、向きはそのまま。中身なし（シード 1〜20）", () => {
    const seen = new Set<string>();
    for (let k = 1; k <= 20; k++) {
      const s = withChest("teleport", k, 1, D);
      const cands = candidates(s);
      const m = cloneRng(s.rng);
      const to = cands[randInt(m, 0, cands.length - 1)]!;
      const r = exec(s, OPEN, D);
      expect(r.state.rng).toEqual(m);
      expect(r.events).toEqual([
        { kind: "chestTrap", trapId: "teleport", actorId: null },
        { kind: "message", key: "chest.trap.teleport" },
        { kind: "chestEnd", result: "lost" },
        { kind: "moved", pos: to, facing: s.dive!.facing },
      ]);
      expect(r.state.dive!.pos).toEqual(to);
      expect(r.state.dive!.facing).toBe(s.dive!.facing);
      expect(r.state.dive!.floor).toBe(s.dive!.floor);
      expect(chestOf(r.state)).toBeNull();
      const f = floorOf(r.state.dive!, D);
      expect(cellAt(f, to.x, to.y)).toMatchObject({ kind: "corridor", roomId: null });
      expectStateInvariants(r.state);
      seen.add(`${to.x},${to.y}`);
    }
    expect(seen.size).toBeGreaterThan(5);
  });

  test("DG-25/DG-13 転移の前後で explored は続く（前の区画を保ち、行き先の視野を足す）。mapView は両方の区画を返し、着地では遭遇も歩の続きも起きず、次のコマンドを受け付ける", () => {
    const s = withChest("teleport", 3, 1, D);
    const r = exec(s, OPEN, D);
    expect(r.state.dive!.pos).not.toEqual(s.dive!.pos);
    const fl = String(s.dive!.floor);
    const before = s.dive!.explored[fl]!;
    const after = r.state.dive!.explored[fl]!;
    for (const i of before) expect(after).toContain(i);
    const f = floorOf(r.state.dive!, D);
    const to = r.state.dive!.pos;
    for (const v of visibleCellsOf(f, to, r.state.dive!.facing, D.config.dungeon.viewDepth)) expect(after).toContain(idx(f, v.x, v.y));
    expect([...after].sort((a, b) => a - b)).toEqual(after);
    const cells = mapView(r.state, D)!.cells.map((c) => `${c.x},${c.y}`);
    expect(cells).toContain(`${s.dive!.pos.x},${s.dive!.pos.y}`);
    expect(cells).toContain(`${to.x},${to.y}`);
    expect(r.state.screen).toBe("dungeon");
    expect(r.state.pendingChoice).toBeNull();
    expect(exec(r.state, { type: "dungeon.turn", dir: "left" }, D).events[0]!.kind).not.toBe("rejected");
  });

  test("DG-25/CB-63 調べるの失敗で作動した転移も移る（作動させた人は調べた人。chest.prompt は出さない）。宝箱のセルは clearedCells に入る", () => {
    const d = chestData((x) => {
      x.config.chest.inspect.min = x.config.chest.inspect.max = 0;
      x.config.chest.triggerChance = 100;
    });
    const s = withChest("teleport", 4, 1, d);
    const cell = { floor: 1, x: s.dive!.pos.x, y: s.dive!.pos.y };
    s.dive!.chest = { ...s.dive!.chest!, source: "cell", cell };
    const m = cloneRng(s.rng);
    randInt(m, 1, 100);
    randInt(m, 1, 100);
    // 今の位置（入場の上り階段）は clearedCells に入っても候補から外れるので、入れる前の構造で数えてよい
    const cands = candidates(s, d);
    const to = cands[randInt(m, 0, cands.length - 1)]!;
    const r = exec(s, inspect("c3"), d);
    expect(r.state.rng).toEqual(m);
    expect(kindsOf(r.events)).toEqual(["dice", "chestTrap", "message:chest.trap.teleport", "chestEnd", "moved"]);
    expect(r.events[1]).toEqual({ kind: "chestTrap", trapId: "teleport", actorId: "c3" });
    expect(r.state.dive!.pos).toEqual(to);
    expect(r.state.dive!.clearedCells).toContainEqual(cell);
    expect(r.state.dive!.disarmedChests).toContainEqual(cell);
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

// ---------------------------------------------------------------------------
// M11 の作業 6: 宝箱の衝動と制止（EV-16 / EV-25）と職業の掛け合い（EV-70〜76）。
// 見つけたときの処理（presentChest、impulse あり）は勝利の後に呼ばれる。単体は makeContext で直接呼び、乱数は鏡の rng で固定する。
// 既定の一行: c1 アルド（リーダー・戦士）、c2 ベルク（慎重・戦士 iq 7）、c3 キリ（無鉄砲・盗賊 agi 15 luk 15）、c4 ドナ（強欲・僧侶 agi 10）、
// c5 エル（普通・魔術師）、c6 フィン（慎重・盗賊 iq 9 agi 14 luk 11）

/** debug.chest で置いた箱（rng は createRng(k)）に、勝利の後と同じ「見つけた」処理（衝動・制止・掛け合い）を行う */
function present(s: GameState, d: GameData) {
  const ctx = makeContext(cloneState(s), d);
  presentChest(ctx, { impulse: true, startAlarm: startAlarmEncounter });
  expectKnownStringKeys(ctx.events, d);
  return { state: ctx.state, events: ctx.events };
}

/** pred を満たす最小の k（1〜2000。鏡の rng で出目の条件を選ぶ。決定的） */
function findK(pred: (m: RngState) => boolean): number {
  for (let k = 1; k <= 2000; k++) if (pred(createRng(k))) return k;
  throw new Error("findK: not found");
}

const P_KIRI = 29; // EV-16: キリの衝動確率 = (無鉄砲の危険 2 × 宝箱の危険 1) × 12 + (agi 15 − 10)

describe("EV-16 / EV-25 宝箱の衝動と制止", () => {
  /** 品を引かず、職業の掛け合いを止めた（定義なし）データ */
  const D = chestData((x) => (x.rivalries = []));

  test("EV-16/EV-04/EV-11 宝箱の spec は宝 2・危険 1・agi・盗賊だけ。既定の一行ではキリ（p 29）の d100 を 1 回だけ振る（フィンは慎重で誘いの積 0、ドナは盗賊でない、リーダーは対象外）。impulseClasses を外すとドナ（強欲 宝 3×2 = 6 → p 60 で頭打ち）も振る", () => {
    expect(data.config.chest.impulse).toEqual({ lure: { treasure: 2, unknown: 0, danger: 1, weak: 0 }, stat: "agi", impulseClasses: ["thief"] });
    const s0 = dived(1);
    expect(impulseChance(2, effectiveStats(s0, D, member(s0, "c3")).agi, D.config)).toBe(P_KIRI);
    // 衝動なし（d100 > 29）: chestFound → chest.found.drop → chest.prompt。乱数は d100 の 1 回
    const k = findK((m) => rollDie(m, 100) > P_KIRI);
    const s = withChest("crossbow", k, 1, D);
    const m = cloneRng(s.rng);
    rollDie(m, 100);
    const r = present(s, D);
    expect(r.state.rng).toEqual(m);
    expect(r.events).toEqual([
      { kind: "chestFound", source: "drop" },
      { kind: "message", key: "chest.found.drop" },
      { kind: "message", key: "chest.prompt" },
    ]);
    expect(chestOf(r.state)).toEqual(chestOf(s));
    // impulseClasses を外す: キリ → ドナの順に d100（ドナ p = min(60, 6×12 + 0)）
    const dAll = chestData((x) => {
      x.rivalries = [];
      delete x.config.chest.impulse.impulseClasses;
    });
    expect(impulseChance(6, effectiveStats(s0, dAll, member(s0, "c4")).agi, dAll.config)).toBe(60);
    const k2 = findK((mm) => rollDie(mm, 100) > P_KIRI && rollDie(mm, 100) > 60);
    const s2 = withChest("crossbow", k2, 1, dAll);
    const m2 = cloneRng(s2.rng);
    rollDie(m2, 100);
    rollDie(m2, 100);
    const r2 = present(s2, dAll);
    expect(r2.state.rng).toEqual(m2);
    expect(kindsOf(r2.events)).toEqual(["chestFound", "message:chest.found.drop", "message:chest.prompt"]);
  });

  test("EV-16/EV-25/EV-23 衝動で調べずに開ける（制止の失敗）: chestImpulse → chest.impulse.actor → 制止（フィン iq 9 + 1d10 ≥ キリ agi 15 + 1d10 に失敗）→ chest.impulse.open → 罠は行動者に作動 → 中身 → chestEnd opened → told（制止者 SAN +3）。chest.prompt は無い", () => {
    const kiriHp = member(dived(1), "c3").hp;
    const k = findK((m) => {
      if (rollDie(m, 100) > P_KIRI) return false;
      if (9 + rollDie(m, 10) >= 15 + rollDie(m, 10)) return false;
      return rollDice(m, "2d4").total < kiriHp; // キリが生き残る出目
    });
    const s = withChar(withChest("crossbow", k, 1, D), 5, { san: 50 });
    const m = cloneRng(s.rng);
    rollDie(m, 100);
    const rS = rollDie(m, 10);
    const rA = rollDie(m, 10);
    const dmg = rollDice(m, "2d4").total;
    const gold = mirrorContents(m, D);
    const r = present(s, D);
    expect(r.state.rng).toEqual(m);
    const iGold = kindsOf(r.events).indexOf("message:chest.open.gold");
    expect(r.events.slice(0, iGold + 1)).toEqual([
      { kind: "chestFound", source: "drop" },
      { kind: "message", key: "chest.found.drop" },
      { kind: "chestImpulse", actorId: "c3" },
      { kind: "message", key: "chest.impulse.actor", params: { actor: "キリ" } },
      { kind: "message", key: "event.stop.roll", params: { stopper: "フィン" } },
      {
        kind: "dice",
        label: { key: "dice.restrain" },
        rows: [
          { label: { key: "dice.restrain.stopper", params: { name: "フィン" } }, base: 9, dice: [rS], total: 9 + rS },
          { label: { key: "dice.restrain.actor", params: { name: "キリ" } }, base: 15, dice: [rA], total: 15 + rA },
        ],
        rule: { key: "dice.restrain.rule", params: { diff: 9 + rS - (15 + rA) } },
        result: { key: "dice.restrain.ng" },
      },
      { kind: "message", key: "event.stop.fail", params: { stopper: "フィン" } },
      { kind: "message", key: "chest.impulse.open", params: { actor: "キリ" } },
      { kind: "chestTrap", trapId: "crossbow", actorId: "c3" },
      { kind: "message", key: "chest.trap.crossbow", params: { actor: "キリ" } },
      { kind: "hpChanged", id: "c3", delta: -dmg, hp: kiriHp - dmg },
      { kind: "message", key: "chest.open.gold", params: { gold } },
    ]);
    // 強欲の treasureGain（金 > 0 で SAN 上限なら出ない）の後に chestEnd → told
    expect(r.events.slice(-3)).toEqual([
      { kind: "chestEnd", result: "opened" },
      { kind: "message", key: "event.stop.told", params: { stopper: "フィン" } },
      { kind: "sanChanged", id: "c6", delta: 3, san: 53 },
    ]);
    expect(kindsOf(r.events)).not.toContain("message:chest.prompt");
    expect(chestOf(r.state)).toBeNull();
    expectStateInvariants(r.state);
  });

  test("EV-25/EV-22 制止に成功: event.stop.success → 制止者 → 行動者の順に SAN +3。箱は罠も残り、開封の選択（chest.prompt）へ", () => {
    const k = findK((m) => rollDie(m, 100) <= P_KIRI && 9 + rollDie(m, 10) >= 15 + rollDie(m, 10));
    const s = withChar(withChar(withChest("crossbow", k, 1, D), 5, { san: 50 }), 2, { san: 60 });
    const m = cloneRng(s.rng);
    rollDie(m, 100);
    rollDie(m, 10);
    rollDie(m, 10);
    const r = present(s, D);
    expect(r.state.rng).toEqual(m);
    expect(kindsOf(r.events)).toEqual([
      "chestFound",
      "message:chest.found.drop",
      "chestImpulse",
      "message:chest.impulse.actor",
      "message:event.stop.roll",
      "dice",
      "message:event.stop.success",
      "sanChanged",
      "sanChanged",
      "message:chest.prompt",
    ]);
    expect(eventsOf(r.events, "sanChanged")).toEqual([
      { kind: "sanChanged", id: "c6", delta: 3, san: 53 },
      { kind: "sanChanged", id: "c3", delta: 3, san: 63 },
    ]);
    expect(r.events[6]).toEqual({ kind: "message", key: "event.stop.success", params: { stopper: "フィン", actor: "キリ" } });
    expect(chestOf(r.state)).toEqual(chestOf(s));
    expect(chestView(r.state, D)).not.toBeNull();
  });

  test("EV-23 罠なしの箱を衝動で開けたら told は無い（good 扱い。impulseBonus も無い）。制止者がいなければ（ベルク・フィンが行動不能）制止の判定なしで開ける", () => {
    const k = findK((m) => rollDie(m, 100) <= P_KIRI && 9 + rollDie(m, 10) < 15 + rollDie(m, 10));
    const r = present(withChest(null, k, 1, D), D);
    expect(kindsOf(r.events)).toContain("message:event.stop.fail");
    expect(kindsOf(r.events)).not.toContain("message:event.stop.told");
    expect(r.events.at(-1)).toEqual({ kind: "chestEnd", result: "opened" });
    // 制止者なし
    const k2 = findK((m) => rollDie(m, 100) <= P_KIRI);
    const s2 = withChar(withChar(withChest("crossbow", k2, 1, D), 1, { status: ["paralysis"] }), 5, { status: ["paralysis"] });
    const m2 = cloneRng(s2.rng);
    rollDie(m2, 100);
    const dmg = rollDice(m2, "2d4").total;
    mirrorContents(m2, D);
    const r2 = present(s2, D);
    expect(r2.state.rng).toEqual(m2);
    const ks = kindsOf(r2.events);
    expect(ks.slice(0, 6)).toEqual([
      "chestFound",
      "message:chest.found.drop",
      "chestImpulse",
      "message:chest.impulse.actor",
      "message:chest.impulse.open",
      "chestTrap",
    ]);
    expect(eventsOf(r2.events, "hpChanged")[0]).toMatchObject({ id: "c3", delta: -Math.min(dmg, member(s2, "c3").hp) });
    expect(ks).not.toContain("message:event.stop.told");
  });

  test("EV-14/EV-04 錯乱しても盗賊でない者（エル）は対象外で randInt も引かない。錯乱した慎重の盗賊（フィン）は randInt(0,3) でタグを選び、宝（積 4）か危険（積 2）なら d100", () => {
    const confused = (s: GameState) => withChar(withChar(s, 4, { san: 20 }), 5, { san: 20 });
    const s0 = dived(1);
    const finAgi = effectiveStats(s0, D, member(s0, "c6")).agi;
    const seen = new Set<number>();
    for (let k = 1; k <= 60; k++) {
      const s = confused(withChest("crossbow", k, 1, D));
      const m = cloneRng(s.rng);
      const kiri = rollDie(m, 100);
      const tag = randInt(m, 0, 3);
      const prod = [4, 0, 2, 0][tag]!;
      const finRoll = prod > 0 ? rollDie(m, 100) : null;
      const finP = prod > 0 ? impulseChance(prod, finAgi, D.config) : 0;
      if (kiri <= P_KIRI || (finRoll !== null && finRoll <= finP)) continue; // 衝動したら制止の乱数が続くので、ここでは見ない
      const r = present(s, D);
      expect(r.state.rng, `k ${k}`).toEqual(m);
      expect(kindsOf(r.events)).not.toContain("chestImpulse");
      seen.add(tag);
    }
    expect(seen.size).toBe(4);
  });

  /** 勝利の後に必ずその罠（危険度 1 にした 1 種だけ）の箱が出て、キリが必ず衝動するデータ */
  const forced = (trapId: string) =>
    chestData((x) => {
      x.config.combat.hitMin = x.config.combat.hitMax = 100;
      x.config.combat.chestChance = 100;
      x.config.chest.noTrapChance = 0;
      x.config.events.floor = x.config.events.cap = 100;
      x.chestTraps = x.chestTraps.filter((t) => t.danger !== 1 && t.id !== trapId).concat(x.chestTraps.filter((t) => t.id === trapId).map((t) => ({ ...t, danger: 1 })));
      x.dungeons.find((y) => y.id === "d01")!.chestTrapDangerWeights = [1, 0];
    });
  /** 制止者（ベルク・フィン）を行動不能にし、麻痺した大ネズミ 1 匹をアルドが倒す勝利の直前 */
  const winning = () => {
    const base = withChar(withChar(dived(1), 1, { status: ["paralysis"] }), 5, { status: ["paralysis"] });
    return withBattle(base, [{ monsterId: "giant_rat", hps: [1], status: [["paralysis"]] }], {
      origin: { kind: "random", inRoom: true },
      identified: ["giant_rat"],
      inputs: allInputs(base, { type: "defend" }, { c1: { type: "attack", group: 0 } }),
    });
  };

  test("EV-16/A2 勝利 → 衝動 → 警報: screen{dungeon, at} → chestFound → 衝動 → chest.impulse.open → chestTrap（行動者）→ chest.trap.alarm → 2 回目の screen{battle} → beat（CB-55 の system）→ encounter。箱は罠なしで残り、掛け合いと chest.prompt は無い", () => {
    const d = forced("alarm");
    const s = winning();
    const r = exec(s, { type: "battle.resolve" }, d);
    const iScreen = r.events.findIndex((e) => e.kind === "screen");
    expect(r.events[iScreen]).toEqual({ kind: "screen", to: "dungeon", dungeonId: "d01", at: { pos: s.dive!.pos, facing: s.dive!.facing } });
    expect(kindsOf(r.events.slice(iScreen + 1, iScreen + 11))).toEqual([
      "chestFound",
      "message:chest.found.drop",
      "chestImpulse",
      "message:chest.impulse.actor",
      "message:chest.impulse.open",
      "chestTrap",
      "message:chest.trap.alarm",
      "screen",
      "beat",
      "encounter",
    ]);
    expect(r.events[iScreen + 6]).toEqual({ kind: "chestTrap", trapId: "alarm", actorId: "c3" });
    expect(r.events[iScreen + 8]).toEqual({ kind: "screen", to: "battle" });
    expect(r.state.battle!.origin).toEqual({ kind: "alarm", inRoom: true });
    expect(chestOf(r.state)).toMatchObject({ trapId: null, rivalry: null });
    const ks = kindsOf(r.events);
    expect(ks).not.toContain("message:chest.prompt");
    expect(ks.some((x) => x.startsWith("message:rivalry."))).toBe(false);
    expectStateInvariants(r.state);
  });

  test("EV-16/A2/DG-25 勝利 → 衝動 → 転移: screen{dungeon, at（戦った位置）} → … → chestTrap → chest.trap.teleport → chestEnd lost → moved（別のセル）", () => {
    const d = forced("teleport");
    const s = winning();
    const r = exec(s, { type: "battle.resolve" }, d);
    const iScreen = r.events.findIndex((e) => e.kind === "screen");
    const at = { pos: s.dive!.pos, facing: s.dive!.facing };
    expect(r.events[iScreen]).toEqual({ kind: "screen", to: "dungeon", dungeonId: "d01", at });
    expect(kindsOf(r.events.slice(iScreen + 1))).toEqual([
      "chestFound",
      "message:chest.found.drop",
      "chestImpulse",
      "message:chest.impulse.actor",
      "message:chest.impulse.open",
      "chestTrap",
      "message:chest.trap.teleport",
      "chestEnd",
      "moved",
    ]);
    const mv = r.events.at(-1) as Extract<GameEvent, { kind: "moved" }>;
    expect(mv.pos).not.toEqual(at.pos);
    expect(r.state.dive!.pos).toEqual(mv.pos);
    expect(chestOf(r.state)).toBeNull();
    expectStateInvariants(r.state);
  });
});

describe("EV-70〜76 職業の掛け合い", () => {
  /** 品を引かず、衝動を止めた（cap 0。d100 を振らない）データ */
  const D = chestData((x) => (x.config.events.cap = 0));

  test("EV-70 rivalries.json の thief_chest（宝箱・盗賊・50%・agi + luk + 1d6・調べる +10・負け SAN −1・失敗 SAN −3）", () => {
    expect(data.rivalries[0]).toMatchObject({
      id: "thief_chest",
      trigger: "chest",
      classId: "thief",
      chance: 50,
      contest: { stats: ["agi", "luk"], dice: "1d6" },
      bonus: { inspect: 10 },
      loserSan: 1,
      failSan: 3,
    });
  });

  test("EV-71/EV-72/EV-73/EV-74 盗賊 2 人で chance(50) → 発生すれば並び順に agi + luk + 1d6。キリ（30）が担当、フィン（25）は SAN −1。語り start → 判定の箱（対象者ごとの行）→ win。chest.rivalry に担当", () => {
    const k = findK((m) => chance(m, 50));
    const s = withChest("crossbow", k, 1, D);
    const m = cloneRng(s.rng);
    chance(m, 50);
    const dK = rollDie(m, 6);
    const dF = rollDie(m, 6);
    const r = present(s, D);
    expect(r.state.rng).toEqual(m);
    expect(r.events).toEqual([
      { kind: "chestFound", source: "drop" },
      { kind: "message", key: "chest.found.drop" },
      { kind: "message", key: "rivalry.thief_chest.start", params: { a: "キリ", b: "フィン" } },
      {
        kind: "dice",
        label: { key: "dice.rivalry" },
        rows: [
          { label: { key: "dice.rivalry.member", params: { name: "キリ", agi: 15, luk: 15 } }, base: 30, dice: [dK], total: 30 + dK },
          { label: { key: "dice.rivalry.member", params: { name: "フィン", agi: 14, luk: 11 } }, base: 25, dice: [dF], total: 25 + dF },
        ],
        rule: { key: "dice.rivalry.rule" },
        result: { key: "dice.rivalry.win", params: { winner: "キリ" } },
      },
      { kind: "message", key: "rivalry.thief_chest.win", params: { winner: "キリ", loser: "フィン" } },
      { kind: "sanChanged", id: "c6", delta: -1, san: 99 },
      { kind: "message", key: "chest.prompt" },
    ]);
    expect(chestOf(r.state)!.rivalry).toEqual({ id: "thief_chest", ownerId: "c3" });
    expectStateInvariants(r.state);
    // 発生しなければ d100 の 1 回だけ
    const k2 = findK((mm) => !chance(mm, 50));
    const s2 = withChest("crossbow", k2, 1, D);
    const m2 = cloneRng(s2.rng);
    chance(m2, 50);
    const r2 = present(s2, D);
    expect(r2.state.rng).toEqual(m2);
    expect(kindsOf(r2.events)).toEqual(["chestFound", "message:chest.found.drop", "message:chest.prompt"]);
    expect(chestOf(r2.state)!.rivalry).toBeNull();
  });

  test("EV-72 同点は並び順が前の者。3 人なら勝者以外の全員が負け（並び順に SAN −1）、win の loser は先頭の負け", () => {
    // エルを盗賊にし、3 人とも agi 12 luk 12 にそろえる
    const prep = (k: number) => {
      let s = withChest("crossbow", k, 1, D);
      for (const i of [2, 4, 5]) s = withChar(s, i, { classId: "thief", stats: { ...s.party[i]!.stats, agi: 12, luk: 12 } });
      return s;
    };
    const k = findK((m) => {
      if (!chance(m, 50)) return false;
      const a = rollDie(m, 6);
      const b = rollDie(m, 6);
      const c = rollDie(m, 6);
      return a === b && c < b; // キリ（c3）とエル（c5）が同点の最大
    });
    const r = present(prep(k), D);
    expect(chestOf(r.state)!.rivalry).toEqual({ id: "thief_chest", ownerId: "c3" });
    expect(r.events).toContainEqual({ kind: "message", key: "rivalry.thief_chest.start", params: { a: "キリ", b: "エル" } });
    expect(r.events).toContainEqual({ kind: "message", key: "rivalry.thief_chest.win", params: { winner: "キリ", loser: "エル" } });
    expect(eventsOf(r.events, "sanChanged").map((e) => [e.id, e.delta])).toEqual([
      ["c5", -1],
      ["c6", -1],
    ]);
    expect(eventsOf(r.events, "dice")[0]!.rows).toHaveLength(3);
  });

  test("EV-71 対象は行動可能な盗賊（リーダーを含む）。1 人だけなら判定しない（乱数なし）", () => {
    const s = withChar(withChest("crossbow", 3, 1, D), 5, { status: ["paralysis"] });
    const r = present(s, D);
    expect(r.state.rng).toEqual(s.rng);
    expect(kindsOf(r.events)).toEqual(["chestFound", "message:chest.found.drop", "message:chest.prompt"]);
    // リーダーを盗賊にすると、アルドとキリの 2 人で判定する
    const k = findK((m) => chance(m, 50));
    const s2 = withChar(withChar(withChest("crossbow", k, 1, D), 5, { status: ["paralysis"] }), 0, { classId: "thief" });
    const m2 = cloneRng(s2.rng);
    chance(m2, 50);
    rollDie(m2, 6);
    rollDie(m2, 6);
    const r2 = present(s2, D);
    expect(r2.state.rng).toEqual(m2);
    expect(r2.events).toContainEqual({ kind: "message", key: "rivalry.thief_chest.start", params: { a: "アルド", b: "キリ" } });
  });

  test("EV-71 衝動を制止した後も判定する（衝動 → 制止 → 掛け合い → chest.prompt の順）。debug.chest（衝動なし）では判定しない", () => {
    const dI = chestData();
    const k = findK((m) => rollDie(m, 100) <= P_KIRI && 9 + rollDie(m, 10) >= 15 + rollDie(m, 10) && chance(m, 50));
    const r = present(withChest("crossbow", k, 1, dI), dI);
    const ks = kindsOf(r.events);
    expect(ks).toContain("message:event.stop.success");
    expect(ks.indexOf("message:event.stop.success")).toBeLessThan(ks.indexOf("message:rivalry.thief_chest.start"));
    expect(ks.at(-1)).toBe("message:chest.prompt");
    const s0 = dived(1);
    expect(exec(s0, { type: "debug.chest", trapId: "bomb" }, dI).state.rng).toEqual(s0.rng);
  });

  test("EV-75 担当がその箱を調べるときだけ +10（行 chest.row.rivalry は罠の勘の後、計に含む。clamp の前）。ほかの人・解除には効かない", () => {
    const s = withChest("crossbow", 1, 1, D);
    s.dive!.chest!.rivalry = { id: "thief_chest", ownerId: "c3" };
    const rowsOf = (r: { events: GameEvent[] }) => eventsOf(r.events, "dice")[0]!.rows.map((x) => x.label.key);
    const kiri = exec(s, inspect("c3"), D);
    const base = chestRate(s, D, "inspect", member(s, "c3"), 0);
    expect(rowsOf(kiri)).toEqual(["chest.row.base", "chest.row.thief", "chest.row.agi", "chest.row.luk", "chest.row.rivalry", "chest.row.subtotal"]);
    expect(eventsOf(kiri.events, "dice")[0]!.rows.at(-1)!.total).toBe(base.power + 10);
    expect(chestRate(s, D, "inspect", member(s, "c3"), 2, 10).rate).toBe(Math.min(95, base.power + 10 - 20));
    expect(rowsOf(exec(s, inspect("c6"), D))).not.toContain("chest.row.rivalry");
    expect(rowsOf(exec(s, disarm("c3", "crossbow"), D))).not.toContain("chest.row.rivalry");
  });

  test("EV-76 担当が調べるに失敗するたびに、その語りの後に text.fail{name} と SAN −3（乱数なし）。成功・担当でない人は無し。作動で担当が死んだら無し", () => {
    const fail = chestData((x) => {
      x.config.events.cap = 0;
      x.config.chest.inspect.min = x.config.chest.inspect.max = 0;
      x.config.chest.triggerChance = 0;
      x.config.chest.wrongNameChance = 0;
    });
    const s = withChest("crossbow", 2, 1, fail);
    s.dive!.chest!.rivalry = { id: "thief_chest", ownerId: "c3" };
    const m = cloneRng(s.rng);
    randInt(m, 1, 100);
    randInt(m, 1, 100);
    const r = exec(s, inspect("c3"), fail);
    expect(r.state.rng).toEqual(m);
    expect(r.events.slice(1)).toEqual([
      { kind: "message", key: "chest.inspect.unknown" },
      { kind: "message", key: "rivalry.thief_chest.fail", params: { name: "キリ" } },
      { kind: "sanChanged", id: "c3", delta: -3, san: 97 },
      { kind: "message", key: "chest.prompt" },
    ]);
    // 2 回目の失敗でも
    expect(eventsOf(exec(r.state, inspect("c3"), fail).events, "sanChanged")).toEqual([{ kind: "sanChanged", id: "c3", delta: -3, san: 94 }]);
    // 担当でない人
    expect(kindsOf(exec(s, inspect("c6"), fail).events)).not.toContain("message:rivalry.thief_chest.fail");
    // 成功
    const ok = chestData((x) => (x.config.chest.inspect.min = x.config.chest.inspect.max = 100));
    expect(kindsOf(exec(s, inspect("c3"), ok).events)).not.toContain("message:rivalry.thief_chest.fail");
    // 作動（石弓を 50 点にする）で担当が死ぬ
    const trig = chestData((x) => {
      x.config.chest.inspect.min = x.config.chest.inspect.max = 0;
      x.config.chest.triggerChance = 100;
      x.chestTraps.find((t) => t.id === "crossbow")!.effect = { kind: "damage", target: "one", dice: "50" };
    });
    const rd = exec(s, inspect("c3"), trig);
    expect(member(rd.state, "c3").life).toBe("dead");
    expect(kindsOf(rd.events)).not.toContain("message:rivalry.thief_chest.fail");
  });
});
