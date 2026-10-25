// M25 計測の道具: 探索ボット（tests/balance/explore.ts）の単体テスト。ボットが知識の決まり（自分の位置と向き、explored、explored のマスの中身だけ）を
// 守ること、「見つけた」と未踏の口の数がゲームの規則（DG-46 / UI-78 / DG-13）と一致すること、決定的であること、歩き切れることを確かめる。
import { describe, expect, test } from "vitest";
import { generateDive, idx } from "../src/core/rules/dungeon-gen";
import { mapView, octant } from "../src/core/rules/dungeon";
import { chestGenOf, floorOf } from "../src/core/rules/floor";
import { createRng } from "../src/core/rng";
import type { Octant } from "../src/core/data/index";
import type { Cell, Command, Floor, GameState } from "../src/core/types";
import {
  enterFacing,
  exitsOf,
  exploreFloorWalk,
  failuresOf,
  hintCandidate,
  type Known,
  nearestHintExit,
  randomHintExit,
  isHintPolicy,
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
const BASE_POLICIES: readonly Policy[] = ["nearest", "random"];
const HINT_POLICIES: readonly Policy[] = POLICIES.filter(isHintPolicy);
const diveOf = (seed: number): Floor[] => generateDive(D01, CFG, seed, chestGenOf(data, "d01"));
const optsFor = (f: Floor, policy: Policy, seed: number, extra: Partial<WalkOptions> = {}): WalkOptions => ({
  goal: f.floor === D01.floors ? "boss" : "stairsDown",
  policy,
  depth: CFG.viewDepth,
  hintSteps: CFG.lostHintSteps,
  rng: policy === "random" || policy === "random-hint" ? createRng(walkSeed("test", "d01", seed, f.floor)) : undefined,
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
        for (const policy of BASE_POLICIES) {
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

  test("計測の道具（M25）UI-78 / DG-13: 実際の state で、道具の explored と未踏の口の数が dive.explored と mapView の unexploredExits に一致する（d01 の 1 階をゲームの execute で同じ手順に歩かせ、保留・宝箱・戦闘・イベントが起きるまで比べ、位置・向きのずれは失敗にする）", () => {
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
        const r = run(state, cmd, d0);
        state = r.state;
        // 保留（階段・罠・宝箱）と戦闘は道具が扱わない盤の外の出来事なので、そこで止める。それ以外のずれは落とす。
        // M25: イベント（EV。衝動で保留なしに解決し、光る石板の revealFloor で地図が明かされることがある。16×16 の d01 で起きた）も盤の外の出来事として止める
        if (r.events.some((e) => e.kind === "eventStarted")) break;
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

  test("計測の道具（M25）DG-46 / DG-46b: 一言を聞く前の手は、同じシードの nearest / random と完全に同じ（聞かなかった階は歩き全体が同じ）。d01 の 30 シード・全階", () => {
    let withHint = 0;
    let without = 0;
    let changedAfter = 0;
    for (let seed = 1; seed <= 30; seed++) {
      for (const f of diveOf(seed)) {
        for (const [base, hp] of [
          ["nearest", "nearest-hint"],
          ["random", "random-hint"],
        ] as const) {
          const rngSeed = 1000 + seed * 10 + f.floor;
          const walk = (p: Policy): { trace: WalkMove[]; w: ReturnType<typeof exploreFloorWalk> } => {
            const trace: WalkMove[] = [];
            const w = exploreFloorWalk(f, f.stairsUp, enterFacing(f), { ...optsFor(f, p, seed, { trace }), rng: createRng(rngSeed) });
            return { trace, w };
          };
          const a = walk(base);
          const b = walk(hp);
          expect(a.w.hintOctant).toBeNull();
          if (b.w.hintStep === null) {
            without += 1;
            expect(b.trace).toEqual(a.trace);
          } else {
            withHint += 1;
            // hintStep 回目の前進（その手を含む）までが一言の前の手
            let moves = 0;
            let cut = 0;
            while (moves < b.w.hintStep) if (b.trace[cut++]!.command === "move") moves += 1;
            expect(b.trace.slice(0, cut)).toEqual(a.trace.slice(0, cut));
            if (JSON.stringify(b.trace.slice(cut)) !== JSON.stringify(a.trace.slice(cut))) changedAfter += 1;
          }
        }
      }
    }
    expect(withHint).toBeGreaterThan(5);
    expect(without).toBeGreaterThan(5);
    // 一言の後は方針が効いて手が変わる（hintCandidate が常に真なら 0 になる）
    expect(changedAfter).toBeGreaterThan(5);
  });

  test("計測の道具（M25）DG-05 / DG-46b: hint 方針も決定的（同じ入力から同じ結果）で、d01 の 40 シードで失敗せず、一言が出るのは降り口の階だけ（hintOnBossFloor 既定 false）", () => {
    const v = { label: "hint", dungeonIds: ["d01"], seeds: 40, policies: HINT_POLICIES };
    const a = measureExplore(data, v);
    expect(measureExplore(data, v).dungeons).toEqual(a.dungeons);
    expect(failuresOf(a)).toBe(0);
    let told = 0;
    for (const fr of a.dungeons[0]!.floorRecords) {
      for (const { list } of fr.walks) {
        for (const w of list) {
          expect(w.found).not.toBeNull();
          expect(w.found!).toBeLessThanOrEqual(w.reached!);
          if (fr.goal === "boss") expect([w.hintFired, w.hintOctant, w.hintStep]).toEqual([null, null, null]);
          else if (w.hintOctant !== null) {
            told += 1;
            expect(w.hintFired).toBe(true);
            expect(w.hintStep!).toBeGreaterThanOrEqual(CFG.lostHintSteps);
          } else expect(w.hintFired).toBe(false);
        }
      }
    }
    expect(told).toBeGreaterThan(5);
  });

  test("計測の道具（M25）DG-46b: hintOnBossFloor が真なら最下層でもボスのマスを目標に一言が出る（偽なら出ない）", () => {
    const base = { label: "boss", dungeonIds: ["d01"], seeds: 30, policies: HINT_POLICIES };
    const off = measureExplore(data, base);
    const on = measureExplore(data, { ...base, hintOnBossFloor: true });
    const last = (r: typeof on) => r.dungeons[0]!.floorRecords.at(-1)!;
    expect(last(off).walks.every(({ list }) => list.every((w) => w.hintOctant === null && w.hintFired === null))).toBe(true);
    expect(last(on).walks.every(({ list }) => list.every((w) => w.hintFired !== null))).toBe(true);
    expect(last(on).walks.some(({ list }) => list.some((w) => w.hintOctant !== null))).toBe(true);
    expect(failuresOf(on)).toBe(0);
  });

  test("計測の道具（M25）DG-46b: 道具の語った方角は、ゲームの方角の一言のキー hint.lostExitsDir.<方角>（d01 は lostHintDirection）と一致する（罠などを片付けた 1 階・40 シード・両 hint 方針。一言が出たシードが 1 つ以上）", () => {
    const d0 = dataWithRate(0, 0);
    let told = 0;
    for (const policy of HINT_POLICIES) {
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
        const w = exploreFloorWalk(f, state.dive!.pos, state.dive!.facing, { ...optsFor(f, policy, seed, { trace }), depth: d0.config.dungeon.viewDepth });
        let key: string | null = null;
        let gameSteps: number | null = null;
        let stoppedAt = 0;
        for (const m of trace) {
          const r = run(state, m.command === "move" ? { type: "dungeon.move" } : { type: "dungeon.turn", dir: m.command }, d0);
          state = r.state;
          stoppedAt = state.dive!.floorSteps;
          const e = r.events.find((x) => x.kind === "message" && x.key.startsWith("hint.lostExits"));
          if (e !== undefined && e.kind === "message") {
            key = e.key;
            gameSteps = state.dive!.floorSteps;
            break;
          }
          if (state.pendingChoice?.promptKey === "dungeon.stairsUp") state = run(state, { type: "event.choose", optionId: "stay" }, d0).state;
          if (state.pendingChoice !== null || state.battle !== null || state.dive!.chest !== null) break;
        }
        if (w.hintOctant === null) expect(key, `seed ${seed} ${policy}`).toBeNull();
        else if (key === null) {
          // 一言の前に再生が止まった（保留・戦闘・宝箱）ときだけ許す: 止まった歩数は一言の歩数より前
          expect(stoppedAt, `seed ${seed} ${policy} stopped`).toBeLessThan(w.hintStep!);
        } else {
          expect(key, `seed ${seed} ${policy}`).toBe(`hint.lostExitsDir.${w.hintOctant}`);
          expect(gameSteps).toBe(w.hintStep);
          told += 1;
        }
      }
    }
    expect(told).toBeGreaterThan(5);
  });

  test("計測の道具（M25）DG-46b: 一言の後に目標の座標を使っていない。語られた方角が変わらない別の座標に目標を替え、歩いたことのないマスの中身を替えても、歩きは同じ（d01 の 30 シード・両 hint 方針）。口の候補の規則 hintCandidate は Known・hintPos・方角だけを受け取る", () => {
    let swapped = 0;
    for (let seed = 1; seed <= 30; seed++) {
      for (const f of diveOf(seed)) {
        if (f.stairsDown === null) continue;
        for (const policy of HINT_POLICIES) {
          let finalSeen: number[] = [];
          const trace: WalkMove[] = [];
          const w = exploreFloorWalk(f, f.stairsUp, enterFacing(f), optsFor(f, policy, seed, { trace, observe: (o) => (finalSeen = [...o.explored]) }));
          if (w.hintOctant === null || w.hintPos === null) continue;
          const seen = new Set<number>(finalSeen);
          // 同じ方角になる別の座標（歩いたことのないマス）に目標を移し、歩いたことのないマスは全部 4 辺 open の降り口にする
          let alt: { x: number; y: number } | null = null;
          for (let y = 0; y < f.height && alt === null; y++) {
            for (let x = 0; x < f.width; x++) {
              if (seen.has(idx(f, x, y)) || (x === f.stairsDown.x && y === f.stairsDown.y)) continue;
              if (octant(w.hintPos, { x, y }) === w.hintOctant) {
                alt = { x, y };
                break;
              }
            }
          }
          if (alt === null) continue;
          const lie: Floor = structuredClone(f);
          lie.cells.forEach((c, i) => {
            if (seen.has(i)) return;
            c.kind = "stairsDown";
            c.n = c.e = c.s = c.w = "open";
            c.roomId = null;
          });
          lie.stairsDown = alt;
          const trace2: WalkMove[] = [];
          const w2 = exploreFloorWalk(lie, f.stairsUp, enterFacing(f), optsFor(lie, policy, seed, { trace: trace2 }));
          expect(trace2, `seed ${seed} floor ${f.floor} ${policy}`).toEqual(trace);
          expect([w2.hintOctant, w2.hintStep, w2.found]).toEqual([w.hintOctant, w.hintStep, w.found]);
          swapped += 1;
        }
      }
    }
    expect(swapped).toBeGreaterThan(5);
  });

  test("計測の道具（M25）DG-46b: 口の候補の規則 hintCandidate は、語られた方角と両隣の口だけを通し、2 つ以上離れた口は通さず、候補が 0 なら全部の口を通す", () => {
    const at = { x: 4, y: 4 };
    const known = (cell: Partial<Cell>): Known => {
      const cells: Cell[] = [];
      for (let i = 0; i < 81; i++) cells.push({ kind: "rock", n: "wall", e: "wall", s: "wall", w: "wall", roomId: null, eventId: null, trapId: null, chestTrapId: null });
      cells[4 * 9 + 4] = { ...cells[0]!, kind: "corridor", ...cell };
      const fog: Floor = { floor: 0, width: 9, height: 9, cells, rooms: [], stairsUp: at, stairsDown: null, boss: null };
      return { fog, explored: new Set([40]), list: [40], goalKind: "stairsDown", exits: 0, goal: null };
    };
    const ok = (k: Known, told: Octant): string =>
      exitsOf(k).filter((e) => hintCandidate(k, at, told)(e)).map((e) => e.d).join("").toLowerCase();
    const four = known({ n: "open", e: "open", s: "open", w: "open" });
    expect(ok(four, "N")).toBe("n");
    expect(ok(four, "NE")).toBe("ne");
    expect(ok(four, "SE")).toBe("es");
    expect(ok(four, "SW")).toBe("sw");
    expect(ok(four, "W")).toBe("w");
    // 南北だけに口がある盤で E が語られると、候補は 0 なので全部の口を通す
    const ns = known({ n: "open", s: "open" });
    expect(ok(ns, "E")).toBe("ns");
    expect(ok(ns, "N")).toBe("n");
  });

  test("計測の道具（M25）DG-46b: nearestHintExit は候補のうち BFS で最初の口を返し、randomHintExit は候補だけから選ぶ（東西に口がある 3 マスの廊下）", () => {
    const corridor: Cell = { kind: "corridor", n: "wall", e: "open", s: "wall", w: "open", roomId: null, eventId: null, trapId: null, chestTrapId: null };
    const cells: Cell[] = [];
    for (let i = 0; i < 81; i++) cells.push({ ...corridor, kind: "rock", e: "wall", w: "wall" });
    for (const x of [3, 4, 5]) cells[4 * 9 + x] = { ...corridor };
    const fog: Floor = { floor: 0, width: 9, height: 9, cells, rooms: [], stairsUp: { x: 4, y: 4 }, stairsDown: null, boss: null };
    const k: Known = { fog, explored: new Set([39, 40, 41]), list: [39, 40, 41], goalKind: "stairsDown", exits: 2, goal: null };
    const at = { x: 4, y: 4 };
    expect(nearestHintExit(k, at, at, "E")).toEqual({ pos: { x: 5, y: 4 }, d: "E" });
    expect(nearestHintExit(k, at, at, "W")).toEqual({ pos: { x: 3, y: 4 }, d: "W" });
    const rng = createRng(7);
    for (let i = 0; i < 20; i++) {
      expect(randomHintExit(k, rng, at, "E")).toEqual({ pos: { x: 5, y: 4 }, d: "E" });
      expect(randomHintExit(k, rng, at, "W")).toEqual({ pos: { x: 3, y: 4 }, d: "W" });
    }
    // 南が語られると候補は 0（東西の口は 2 つ以上離れている）なので全部の口から選ぶ
    const seenDirs = new Set<string>();
    for (let i = 0; i < 40; i++) seenDirs.add(randomHintExit(k, rng, at, "S")!.d);
    expect([...seenDirs].sort()).toEqual(["E", "W"]);
    expect(nearestHintExit(k, at, at, "S")).not.toBeNull();
  });
});
