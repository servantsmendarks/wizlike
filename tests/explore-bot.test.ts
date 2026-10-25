// M25 計測の道具: 探索ボット（tests/balance/explore.ts）の単体テスト。ボットが知識の決まり（自分の位置と向き、explored、explored のマスの中身だけ）を
// 守ること、「見つけた」と未踏の口の数がゲームの規則（DG-46 / UI-78 / DG-13）と一致すること、決定的であること、歩き切れることを確かめる。
import { describe, expect, test } from "vitest";
import { generateDive, idx } from "../src/core/rules/dungeon-gen";
import { mapView } from "../src/core/rules/dungeon";
import { chestGenOf, floorOf } from "../src/core/rules/floor";
import { createRng } from "../src/core/rng";
import type { Command, Floor, GameState } from "../src/core/types";
import {
  enterFacing,
  exploreFloorWalk,
  measureExplore,
  POLICIES,
  type Policy,
  type WalkMove,
  type WalkObservation,
  type WalkOptions,
  walkSeed,
} from "./balance/explore";
import { data, newGame } from "./helpers/core";
import { dataWithRate, ENTER_D01, run } from "./helpers/dungeon";

const CFG = data.config.dungeon;
const D01 = data.dungeons.find((d) => d.id === "d01")!;
const diveOf = (seed: number): Floor[] => generateDive(D01, CFG, seed, chestGenOf(data, "d01"));
const optsFor = (f: Floor, policy: Policy, seed: number, extra: Partial<WalkOptions> = {}): WalkOptions => ({
  goal: f.floor === D01.floors ? "boss" : "stairsDown",
  policy,
  depth: CFG.viewDepth,
  hintSteps: CFG.lostHintSteps,
  rng: policy === "random" ? createRng(walkSeed("test", "d01", seed, f.floor)) : undefined,
  ...extra,
});

describe("計測の道具（M25）探索ボット", () => {
  test("計測の道具（M25）DG-13 / UI-78: 前進の先のマスは前進の前に explored に入っている。例外は口から入る 1 歩だけで、その先は口を選んだ時点で未探索（d01 の 20 シード・全階・両方針）", () => {
    let enters = 0;
    let others = 0;
    for (let seed = 1; seed <= 20; seed++) {
      for (const f of diveOf(seed)) {
        for (const policy of POLICIES) {
          const trace: WalkMove[] = [];
          const w = exploreFloorWalk(f, f.stairsUp, enterFacing(f), optsFor(f, policy, seed, { trace }));
          expect(w.failed).toBe(false);
          for (const m of trace.filter((x) => x.command === "move")) {
            if (m.phase === "enter") {
              enters += 1;
              // 口の定義の確認（口は隣が未探索のものだけ）。意味のある検査は下の targetKnownBefore の方
              expect(m.targetKnownAtChoice).toBe(false);
            } else {
              others += 1;
              expect(m.targetKnownBefore).toBe(true);
            }
          }
        }
      }
    }
    expect(enters).toBeGreaterThan(100);
    expect(others).toBeGreaterThan(100);
  });

  test("計測の道具（M25）DG-13: 盤の未探索のマス（見つけた時点で explored に無いマス）の中身と降り口・ボスの座標を書き換えても、歩きはまったく同じ（判断に盤の全体を使っていない。d01 の 20 シード・全階・両方針）", () => {
    for (let seed = 1; seed <= 20; seed++) {
      for (const f of diveOf(seed)) {
        for (const policy of POLICIES) {
          let atFound: number[] | null = null;
          const trace: WalkMove[] = [];
          const w = exploreFloorWalk(
            f,
            f.stairsUp,
            enterFacing(f),
            optsFor(f, policy, seed, {
              trace,
              observe: (o) => {
                if (o.found && atFound === null) atFound = [...o.explored];
              },
            }),
          );
          expect(atFound).not.toBeNull();
          const seen = new Set<number>(atFound!);
          // 未探索のマスを、どれも降り口（最下層はボス）にして 4 辺を open に。盤の座標の降り口・ボスは上り階段に向ける
          const g = f.stairsDown === null ? "boss" : "stairsDown";
          const lie: Floor = structuredClone(f);
          lie.cells.forEach((c, i) => {
            if (seen.has(i)) return;
            c.kind = g;
            c.n = c.e = c.s = c.w = "open";
            c.roomId = null;
          });
          lie.stairsDown = f.stairsDown === null ? null : { ...f.stairsUp };
          lie.boss = f.boss === null ? null : { ...f.stairsUp };
          lie.rooms = [];
          const trace2: WalkMove[] = [];
          const w2 = exploreFloorWalk(lie, f.stairsUp, enterFacing(f), optsFor(f, policy, seed, { trace: trace2 }));
          expect(trace2).toEqual(trace);
          expect([w2.found, w2.reached, w2.hintFired, w2.exitsMean, w2.exitsAtFound]).toEqual([w.found, w.reached, w.hintFired, w.exitsMean, w.exitsAtFound]);
        }
      }
    }
  });

  test("計測の道具（M25）DG-46 / UI-78: 「見つけた」（explored のマスの kind）は、f.stairsDown（最下層は f.boss）の添字が explored に入った時点と一致する（d01 の 200 シード・全階・両方針）", () => {
    for (let seed = 1; seed <= 200; seed++) {
      for (const f of diveOf(seed)) {
        const goal = f.stairsDown ?? f.boss!;
        const gi = idx(f, goal.x, goal.y);
        for (const policy of POLICIES) {
          let byIndex: { actions: number; steps: number } | null = null;
          let byKind: boolean | null = null;
          const w = exploreFloorWalk(
            f,
            f.stairsUp,
            enterFacing(f),
            optsFor(f, policy, seed, {
              observe: (o: WalkObservation) => {
                if (byIndex === null && o.explored.has(gi)) {
                  byIndex = { actions: o.actions, steps: o.steps };
                  byKind = o.found;
                }
                if (byIndex === null) expect(o.found).toBe(false);
              },
            }),
          );
          expect(byIndex, `seed ${seed} floor ${f.floor} ${policy}`).not.toBeNull();
          expect(byKind).toBe(true);
          expect({ actions: w.foundActions, steps: w.found }).toEqual(byIndex);
        }
      }
    }
  });

  test("計測の道具（M25）UI-78 / DG-13: 実際の state で、道具の explored と未踏の口の数が dive.explored と mapView の unexploredExits に一致する（d01 の 1 階をゲームの execute で同じ手順に歩かせ、保留・宝箱・戦闘が起きるまで比べ、位置・向きのずれは失敗にする）", () => {
    const d0 = dataWithRate(0, 0);
    let compared = 0;
    for (let seed = 1; seed <= 12; seed++) {
      let state: GameState = run(newGame(seed), ENTER_D01, d0).state;
      const dive = state.dive!;
      const f = floorOf(dive, d0);
      const obs: { pos: { x: number; y: number }; facing: string; explored: number[]; exits: number }[] = [];
      const trace: WalkMove[] = [];
      exploreFloorWalk(f, dive.pos, dive.facing, {
        goal: "stairsDown",
        policy: "nearest",
        depth: d0.config.dungeon.viewDepth,
        hintSteps: d0.config.dungeon.lostHintSteps,
        trace,
        observe: (o) => obs.push({ pos: o.pos, facing: o.facing, explored: [...o.explored].sort((a, b) => a - b), exits: o.exits }),
      });
      const check = (s: GameState, o: (typeof obs)[number]): void => {
        const dv = s.dive!;
        expect({ floor: dv.floor, pos: dv.pos, facing: dv.facing }, `seed ${seed}`).toEqual({ floor: 1, pos: o.pos, facing: o.facing });
        expect(dv.explored["1"]).toEqual(o.explored);
        expect(mapView(s, d0)!.unexploredExits).toBe(o.exits);
        compared += 1;
      };
      check(state, obs[0]!);
      for (let i = 0; i < trace.length; i++) {
        const m = trace[i]!;
        const cmd: Command = m.command === "move" ? { type: "dungeon.move" } : { type: "dungeon.turn", dir: m.command };
        state = run(state, cmd, d0).state;
        // 保留（階段・罠・宝箱）と戦闘は道具が扱わない盤の外の出来事なので、そこで止める。それ以外のずれは落とす
        if (state.pendingChoice !== null || state.battle !== null || state.screen !== "dungeon" || state.dive!.chest !== null) break;
        check(state, obs[i + 1]!);
      }
    }
    expect(compared).toBeGreaterThan(200);
  });

  test("計測の道具（M25）DG-46: 罠・宝箱・イベントを片付けた d01 の 1 階を 100 歩を超えて歩かせると、道具の hintFired とゲームの hint.lostExits の有無が一致する（40 シード）", () => {
    const d0 = dataWithRate(0, 0);
    let fired = 0;
    for (let seed = 1; seed <= 40; seed++) {
      let state: GameState = run(newGame(seed), ENTER_D01, d0).state;
      const base = floorOf(state.dive!, d0);
      const cleared = base.cells
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => c.kind === "trap" || c.kind === "chest" || c.kind === "event" || c.kind === "teleporter")
        .map(({ i }) => ({ floor: 1, x: i % base.width, y: Math.floor(i / base.width) }));
      state = { ...state, dive: { ...state.dive!, clearedCells: [...state.dive!.clearedCells, ...cleared] } };
      const f = floorOf(state.dive!, d0);
      const trace: WalkMove[] = [];
      const w = exploreFloorWalk(f, state.dive!.pos, state.dive!.facing, {
        goal: "stairsDown",
        policy: "nearest",
        depth: d0.config.dungeon.viewDepth,
        hintSteps: d0.config.dungeon.lostHintSteps,
        trace,
      });
      let hintGame = false;
      for (const m of trace) {
        const r = run(state, m.command === "move" ? { type: "dungeon.move" } : { type: "dungeon.turn", dir: m.command }, d0);
        state = r.state;
        if (r.events.some((e) => e.kind === "message" && e.key.startsWith("hint.lostExits"))) hintGame = true;
        // 上り階段の上を通るときの尋ねは「そのまま」で閉じる（降り口の尋ねで終わる）
        if (state.pendingChoice?.promptKey === "dungeon.stairsUp") state = run(state, { type: "event.choose", optionId: "stay" }, d0).state;
        if (state.pendingChoice !== null || state.battle !== null || state.dive!.chest !== null) break;
      }
      expect(hintGame, `seed ${seed}`).toBe(w.hintFired);
      if (w.hintFired) fired += 1;
    }
    expect(fired).toBeGreaterThan(0);
  });

  test("計測の道具（M25）DG-05 / DG-46: 同じ入力から同じ結果（決定的）。random の方針も同じシードなら同じで、シードが違えば歩きが変わる", () => {
    const v = { label: "決定性", dungeonIds: ["d01"], seeds: 20 };
    const a = measureExplore(data, v);
    const b = measureExplore(data, v);
    expect(b.dungeons).toEqual(a.dungeons);
    const f = diveOf(3)[0]!;
    const walk = (k: number): WalkMove[] => {
      const trace: WalkMove[] = [];
      exploreFloorWalk(f, f.stairsUp, enterFacing(f), { ...optsFor(f, "random", 3, { trace }), rng: createRng(k) });
      return trace;
    };
    expect(walk(7)).toEqual(walk(7));
    const differs = [8, 9, 10, 11, 12].some((k) => JSON.stringify(walk(k)) !== JSON.stringify(walk(7)));
    expect(differs).toBe(true);
  });

  test("計測の道具（M25）DG-05 / DG-46: d01 の数シードで、両方針とも失敗せずに各階の降り口（最下層はボス）に着く。見つけた ≤ 着いた、一言は降り口の階だけ", () => {
    const r = measureExplore(data, { label: "d01", dungeonIds: ["d01"], seeds: 10 });
    const d = r.dungeons[0]!;
    expect(d.genErrors).toBe(0);
    expect(d.dives).toBe(10);
    for (const fr of d.floorRecords) {
      for (const { list } of fr.walks) {
        expect(list).toHaveLength(10);
        for (const w of list) {
          expect(w.failed).toBe(false);
          expect(w.found).not.toBeNull();
          expect(w.reached).not.toBeNull();
          expect(w.found!).toBeLessThanOrEqual(w.reached!);
          expect(w.hintFired === null).toBe(fr.goal === "boss");
          expect(w.exitsMean).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});
