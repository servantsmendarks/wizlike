// H9 バランス: 「1 階の階段付近で 6〜8 戦して帰還の糸で帰る」× 200 シード（ユーザー決定）。
// ボットはこのテストの中だけにあり、core の execute と問い合わせ（floorOf、fieldItemMenu）だけを使う。
// 合否は不変条件だけで、数字のしきい値では落とさない（数字は console.log に出し、decisions に転記する）。
// ボットの値（BFS 距離 6、6〜8 戦、上限 3000 歩、100 泊）はテストの定数で、ゲームの調整値ではない。
import { describe, expect, test } from "vitest";
import { execute } from "../src/core/engine";
import { createRng, randInt, type RngState } from "../src/core/rng";
import { cellAt, edgeOf, FACINGS, isPassable, opposite, step, turnLeft, turnRight } from "../src/core/rules/dungeon-gen";
import { floorOf } from "../src/core/rules/dungeon";
import { fieldItemMenu } from "../src/core/rules/items";
import { itemOf } from "../src/core/state";
import type { Command, Facing, Floor, GameEvent, GameState, PenaltyResult, Pos } from "../src/core/types";
import { data, expectKnownStringKeys, expectStateInvariants, newGame } from "./helpers/core";

const SEEDS = 200;
const NEAR = 6; // 上り階段からの BFS 距離
const STEP_CAP = 3000;
const BATTLE_ROUND_CAP = 300;
const INN_NIGHTS_CAP = 100;
const START_GOLD = data.config.prototypeParty.startingGold;

type Method = "thread" | "walk" | "cap" | "wipe";

type SeedResult = {
  seed: number;
  method: Method;
  battles: number;
  steps: number;
  herbs: number;
  threads: number;
  deaths: number;
  goldAfter: number;
  innMin: number;
  innPrivate: number;
};

const key = (p: Pos) => `${p.x},${p.y}`;

/** 消耗品・魔法書の effect.type（武器・防具は null） */
function effectType(itemId: string): string | null {
  const it = itemOf(data, itemId);
  return "effect" in it ? it.effect.type : null;
}

/** 上り階段からの BFS 距離（open / door の辺を通る。下り階段のセルは通らない） */
function distancesFrom(f: Floor, from: Pos): Map<string, number> {
  const dist = new Map<string, number>([[key(from), 0]]);
  const queue: Pos[] = [from];
  while (queue.length > 0) {
    const p = queue.shift()!;
    const d = dist.get(key(p))!;
    const c = cellAt(f, p.x, p.y);
    for (const dir of FACINGS) {
      if (!isPassable(edgeOf(c, dir))) continue;
      const q = step(p, dir);
      if (dist.has(key(q)) || cellAt(f, q.x, q.y).kind === "stairsDown") continue;
      dist.set(key(q), d + 1);
      queue.push(q);
    }
  }
  return dist;
}

/** facing から dir へ向くための旋回（不要なら null） */
function turnFor(facing: Facing, dir: Facing): "left" | "right" | "around" | null {
  if (facing === dir) return null;
  if (turnLeft(facing) === dir) return "left";
  if (turnRight(facing) === dir) return "right";
  if (opposite(facing) === dir) return "around";
  throw new Error("turnFor: unreachable");
}

function median(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
/** 最近傍順位の百分位（p は 0〜100） */
function percentile(xs: readonly number[], p: number): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]!;
}
function mean(xs: readonly number[]): number {
  return xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length;
}
function fmt(x: number): string {
  return Number.isNaN(x) ? "-" : Number.isInteger(x) ? String(x) : x.toFixed(1);
}
function stats(label: string, xs: readonly number[]): string {
  return `${label}（n=${xs.length}）: 平均 ${fmt(mean(xs))} / 中央値 ${fmt(median(xs))} / p10 ${fmt(percentile(xs, 10))} / p90 ${fmt(percentile(xs, 90))}`;
}

/** 1 シード分のボット */
class Bot {
  state: GameState;
  readonly bot: RngState;
  readonly floor: Floor;
  readonly near: Set<string>;
  readonly keys = new Set<string>();
  battles = 0;
  steps = 0;
  herbs = 0;
  threads = 0;
  wiped: PenaltyResult | null = null;

  constructor(readonly seed: number) {
    this.state = this.run({ type: "dungeon.enter", dungeonId: "d01" }, newGame(seed));
    this.bot = createRng(seed + 20_000);
    // 1 階の構造はこの潜行の間変わらない（罠の発動は kind だけを変え、辺は変えない）ので、ボットの側でキャッシュする
    this.floor = floorOf(this.state.dive!, data, 1);
    const dist = distancesFrom(this.floor, this.floor.stairsUp);
    this.near = new Set([...dist].filter(([, d]) => d <= NEAR).map(([k]) => k));
  }

  /** execute して、rejected なら例外。state の不変条件（battle.input・dungeon.turn 以外）と文字列キーを検査し、全滅なら PenaltyResult の内訳 = 差分を確かめる */
  run(cmd: Command, from: GameState = this.state): GameState {
    const r = execute(from, cmd, data);
    if (r.events[0]?.kind === "rejected") throw new Error(`seed ${this.seed}: ${JSON.stringify(cmd)} rejected: ${JSON.stringify(r.events[0])}`);
    // 潜行中・戦闘中の不変条件（台帳 ⊆ 所持品、screen battle ⇔ battle など）も、実際の execute の結果で確かめる。
    // 入力を積むだけの battle.input と向きを変えるだけの dungeon.turn は時間の都合で省く（検査なしで約 7 秒、全コマンドで約 17 秒、省いて約 13 秒。2026-10-01 の手元の実測）
    if (cmd.type !== "battle.input" && cmd.type !== "dungeon.turn") expectStateInvariants(r.state);
    expectKnownStringKeys(r.events);
    for (const e of r.events) if (e.kind === "message") this.keys.add(e.key);
    const w = r.events.find((e): e is Extract<GameEvent, { kind: "wipe" }> => e.kind === "wipe");
    if (w !== undefined) {
      this.wiped = w.penalty;
      this.checkPenalty(from, r.state, w.penalty);
    }
    this.state = r.state;
    return r.state;
  }

  /** wipe では PenaltyResult の内訳 = state の差分（金、失った実体、EXP） */
  checkPenalty(before: GameState, after: GameState, p: PenaltyResult): void {
    expect(before.gold - after.gold).toBe(p.ledgerGold + p.goldLost);
    for (const it of p.itemsLost) expect(after.items[it.instanceId]).toBeUndefined();
    for (const id of before.dive!.ledger.items) expect(after.items[id]).toBeUndefined();
    const sum = (s: GameState) => s.party.reduce((a, c) => a + c.exp, 0);
    expect(sum(before) - sum(after)).toBe(p.expLost.reduce((a, e) => a + e.lost, 0));
  }

  get inDungeon(): boolean {
    return this.state.screen === "dungeon" || this.state.screen === "battle";
  }

  /** 戦闘をオートで終わらせる（CB-43 でオートが切れたら入れ直す） */
  fight(): void {
    this.battles += 1;
    let n = 0;
    while (this.state.battle !== null) {
      if (n++ > BATTLE_ROUND_CAP) throw new Error(`seed ${this.seed}: battle did not end`);
      this.run(this.state.battle.auto ? { type: "battle.resolve" } : { type: "battle.auto", on: true });
    }
  }

  /** 前進 1 歩（向きを変えてから）。保留中の選択は stay（帰り道の exit は呼び出し側）、遭遇したら戦う */
  moveTo(dir: Facing): void {
    const t = turnFor(this.state.dive!.facing, dir);
    if (t !== null) this.run({ type: "dungeon.turn", dir: t });
    if (!this.inDungeon) return; // 旋回でも全滅しうる（行動不能のまま歩いていた場合）
    this.run({ type: "dungeon.move" });
    this.steps += 1;
    if (this.state.battle !== null) this.fight();
  }

  /** 戦闘の合間の回復: HP が半分未満の alive の者がいて、行動可能な誰かが heal の品を持つ間、HP 割合が最小の者に使う */
  healBetweenBattles(): void {
    for (;;) {
      if (this.state.screen !== "dungeon" || this.state.pendingChoice !== null) return;
      const alive = this.state.party.filter((c) => c.life === "alive");
      if (!alive.some((c) => c.hp * 2 < c.hpMax)) return;
      const menu = fieldItemMenu(this.state, data);
      if (menu === null) return;
      let use: { memberId: string; instanceId: string } | null = null;
      for (const m of menu.members) {
        if (!m.canAct) continue;
        const it = m.items.find((x) => x.usable && effectType(x.itemId) === "heal");
        if (it !== undefined) {
          use = { memberId: m.id, instanceId: it.instanceId };
          break;
        }
      }
      if (use === null) return;
      let target = alive[0]!;
      for (const c of alive) if (c.hp / c.hpMax < target.hp / target.hpMax) target = c;
      this.run({ type: "dungeon.useItem", memberId: use.memberId, itemId: use.instanceId, targetId: target.id });
      this.herbs += 1;
    }
  }

  /** 階段付近の歩行: 今のセルから、近傍（near）のセルへ通れる方向を bot で選ぶ */
  wanderStep(): void {
    const dive = this.state.dive!;
    const c = cellAt(this.floor, dive.pos.x, dive.pos.y);
    const dirs = FACINGS.filter((d) => isPassable(edgeOf(c, d)) && this.near.has(key(step(dive.pos, d))));
    if (dirs.length === 0) throw new Error(`seed ${this.seed}: no way from ${key(dive.pos)}`);
    this.moveTo(dirs[randInt(this.bot, 0, dirs.length - 1)]!);
    if (this.state.pendingChoice !== null) this.run({ type: "event.choose", optionId: "stay" });
  }

  /** 帰還: 行動可能な者が帰還の品を持っていれば使う。無ければ BFS の最短で上り階段へ歩いて exit */
  goHome(): "thread" | "walk" {
    const menu = fieldItemMenu(this.state, data);
    if (menu !== null) {
      for (const m of menu.members) {
        if (!m.canAct) continue;
        const it = m.items.find((x) => x.usable && effectType(x.itemId) === "return");
        if (it === undefined) continue;
        const goldBefore = this.state.gold;
        this.run({ type: "dungeon.useItem", memberId: m.id, itemId: it.instanceId });
        this.threads += 1;
        expect(this.state.gold).toBe(goldBefore); // DG-43
        return "thread";
      }
    }
    let guard = 0;
    while (this.inDungeon) {
      if (guard++ > 1000) throw new Error(`seed ${this.seed}: walk home did not finish`);
      if (this.state.pendingChoice !== null) {
        const exit = this.state.pendingChoice.options.some((o) => o.id === "exit");
        const goldBefore = this.state.gold;
        this.run({ type: "event.choose", optionId: exit ? "exit" : "stay" });
        if (exit) expect(this.state.gold).toBe(goldBefore); // DG-43
        continue;
      }
      const dive = this.state.dive!;
      const dist = distancesFrom(this.floor, this.floor.stairsUp);
      const c = cellAt(this.floor, dive.pos.x, dive.pos.y);
      const here = dist.get(key(dive.pos));
      let best: Facing | null = null;
      for (const d of FACINGS) {
        if (!isPassable(edgeOf(c, d))) continue;
        const nd = dist.get(key(step(dive.pos, d)));
        if (nd !== undefined && (here === undefined || nd < here) && (best === null || nd < dist.get(key(step(dive.pos, best)))!)) best = d;
      }
      if (best === null) throw new Error(`seed ${this.seed}: no way home from ${key(dive.pos)}`);
      this.moveTo(best);
    }
    return "walk";
  }

  play(): Method {
    const n = 6 + randInt(this.bot, 0, 2);
    let capped = false;
    while (this.inDungeon && this.battles < n) {
      if (this.steps >= STEP_CAP) {
        capped = true;
        break;
      }
      this.healBetweenBattles();
      if (!this.inDungeon) break;
      this.wanderStep();
    }
    if (this.inDungeon) {
      this.healBetweenBattles();
      if (this.inDungeon) {
        const m = this.goHome();
        if (this.wiped === null) return capped ? "cap" : m;
      }
    }
    if (this.wiped !== null) return "wipe";
    throw new Error(`seed ${this.seed}: left the dungeon without returning or wiping`);
  }
}

/** 宿代: 各ランクを単独で「alive 全員の HP / MP が満タン」まで繰り返した費用の最小（払えないランクは除外） */
function innCosts(s0: GameState): { min: number; private: number } {
  const ranks = data.config.town.innRanks;
  let best = Infinity;
  ranks.forEach((r, rank) => {
    let s = s0;
    let cost = 0;
    for (let n = 0; n <= INN_NIGHTS_CAP; n++) {
      const full = s.party.every((c) => c.life !== "alive" || (c.hp === c.hpMax && c.mp === c.mpMax));
      if (full) {
        best = Math.min(best, cost);
        return;
      }
      if (n === INN_NIGHTS_CAP || s.gold < r.cost) return;
      const res = execute(s, { type: "town.inn", rank }, data);
      if (res.events[0]?.kind === "rejected") throw new Error(`inn rejected: ${JSON.stringify(res.events[0])}`);
      expectKnownStringKeys(res.events);
      s = res.state;
      cost += r.cost;
    }
  });
  return { min: best === Infinity ? NaN : best, private: Math.max(...ranks.map((r) => r.cost)) };
}

describe("バランス（H9）", () => {
  test("H9 バランス: 1 階の階段付近で 6〜8 戦して帰還の糸で帰る × 200 シード（数字は出力するだけで、合否は不変条件）", () => {
    const results: SeedResult[] = [];
    const keys = new Set<string>();
    const herbPrice = itemOf(data, "herb").price;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const b = new Bot(seed);
      const method = b.play();
      const s = b.state;
      expect(s.screen).toBe("town");
      expectStateInvariants(s);
      for (const k of b.keys) keys.add(k);
      const inn = innCosts(s);
      results.push({
        seed,
        method,
        battles: b.battles,
        steps: b.steps,
        herbs: b.herbs,
        threads: b.threads,
        deaths: s.party.filter((c) => c.life !== "alive").length,
        goldAfter: s.gold,
        innMin: inn.min,
        innPrivate: inn.private,
      });
    }
    for (const k of ["battle.encounter", "battle.win", "dungeon.return", "town.enter"]) expect(keys.has(k), k).toBe(true);

    const net = (r: SeedResult, inn: number) => r.goldAfter - START_GOLD - r.herbs * herbPrice - inn;
    const groups: [string, SeedResult[]][] = [
      ["全体", results],
      ["帰還だけ", results.filter((r) => r.method !== "wipe")],
      ["全滅だけ", results.filter((r) => r.method === "wipe")],
    ];
    const count = (m: Method) => results.filter((r) => r.method === m).length;
    const deathsDist = [0, 1, 2, 3, 4, 5, 6].map((d) => `${d}人 ${results.filter((r) => r.deaths === d).length}`).join(" / ");
    const battlesDist = [...new Set(results.map((r) => r.battles))]
      .sort((a, b) => a - b)
      .map((n) => `${n}戦 ${results.filter((r) => r.battles === n).length}`)
      .join(" / ");
    const lines = [
      `H9 バランス（${SEEDS} シード、d01 の 1 階の上り階段から BFS 距離 ${NEAR} 以内、6〜8 戦して帰る。所持金の初期値 ${START_GOLD}）`,
      `全滅率: ${fmt((count("wipe") / SEEDS) * 100)}%（${count("wipe")}/${SEEDS}）`,
      `帰還の方法: 糸 ${count("thread")} / 徒歩 ${count("walk")} / 上限 ${count("cap")} / 全滅 ${count("wipe")}`,
      `糸の消費: ${results.reduce((a, r) => a + r.threads, 0)} 本`,
      `死者数（街に戻った時点で alive でない人数）: ${deathsDist}`,
      ...groups.flatMap(([label, rs]) => [
        stats(`純益・宿代最小（${label}）`, rs.map((r) => net(r, r.innMin))),
        stats(`純益・個室 1 泊（${label}）`, rs.map((r) => net(r, r.innPrivate))),
      ]),
      stats("宿代の最小", results.map((r) => r.innMin)),
      stats("戦闘数", results.map((r) => r.battles)),
      `戦闘数の分布: ${battlesDist}`,
      stats("薬草の使用数", results.map((r) => r.herbs)),
      stats("歩数", results.map((r) => r.steps)),
    ];
    console.log(lines.join("\n"));
  }, 180_000);
});
