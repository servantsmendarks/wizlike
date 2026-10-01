// H9 バランス（Z6 / Z7、ユーザー決定）: 「潜行（4 戦 / 6〜8 戦）→ 街（死者は寺院で蘇生、灰は闇魔術、払える限り）→ 相部屋に 1 泊 → 潜行」
// を 5 回繰り返す × 200 シード。2 つの形（1 回の潜行で 4 戦 / 6〜8 戦）をそれぞれ回す。
// ボットはこのテストの中だけにあり、core の execute と問い合わせ（floorOf、fieldItemMenu、townMenu）だけを使う。
// 合否は不変条件だけで、数字のしきい値では落とさない（数字は console.log に出し、decisions に転記する）。
// ボットの値（BFS 距離 6、戦闘数、上限 3000 歩、5 回）はテストの定数で、ゲームの調整値ではない。
import { describe, expect, test } from "vitest";
import { execute } from "../src/core/engine";
import { createRng, randInt, type RngState } from "../src/core/rng";
import { cellAt, edgeOf, FACINGS, isPassable, opposite, step, turnLeft, turnRight } from "../src/core/rules/dungeon-gen";
import { floorOf } from "../src/core/rules/dungeon";
import { fieldItemMenu } from "../src/core/rules/items";
import { townMenu } from "../src/core/rules/town";
import { itemOf } from "../src/core/state";
import type { Command, Facing, Floor, GameEvent, GameState, PenaltyResult, Pos } from "../src/core/types";
import { data, expectKnownStringKeys, expectStateInvariants, newGame } from "./helpers/core";

const SEEDS = 200;
const DIVES = 5;
const NEAR = 6; // 上り階段からの BFS 距離
const STEP_CAP = 3000; // 1 回の潜行の歩数の上限
const BATTLE_ROUND_CAP = 300;
const INN_RANK = data.config.town.innRanks.findIndex((r) => r.id === "cheap"); // 相部屋
const START_GOLD = data.config.prototypeParty.startingGold;
const HERB_PRICE = itemOf(data, "herb").price;

type Shape = { label: string; battles: (bot: RngState) => number };
const SHAPES: Shape[] = [
  { label: "4 戦", battles: () => 4 },
  { label: "6〜8 戦", battles: (bot) => 6 + randInt(bot, 0, 2) },
];

type Method = "thread" | "walk" | "cap" | "wipe";

/** 潜行 1 回分（潜行 → 街の寺院・闇魔術 → 宿）の記録 */
type DiveRecord = {
  method: Method;
  battles: number;
  steps: number;
  herbs: number;
  threads: number;
  homeBattles: number; // n 戦に達した後（または歩数の上限の後）の徒歩の帰り道での戦闘数（battles に含む）
  homeWipe: boolean; // 徒歩の帰り道で全滅した（method は wipe）
  goldBefore: number; // 潜行の前の所持金
  goldAfter: number; // 宿の後の所持金
  templeTries: number;
  templeOk: number;
  templeCost: number;
  darkCount: number;
  darkCost: number;
  innCost: number;
  innFallback: boolean; // 相部屋が払えず馬小屋に泊まった
  mercyOffered: boolean;
  unrevived: number; // 宿の後に alive でない人数
  anyL2: boolean; // 宿の後に誰かが L2 以上
  allL2: boolean; // 宿の後に alive の全員が L2 以上
};

type CampaignResult = { seed: number; dives: DiveRecord[]; aborted: boolean; goldTrail: number[] };

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
  if (Number.isNaN(x)) return "-";
  const r = Math.round(x * 10) / 10; // 浮動小数の誤差（110/200*100 = 55.00000000000001）で「55.0」にしない
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}
function pct(n: number, d: number): string {
  return d === 0 ? "-" : `${fmt((n / d) * 100)}%（${n}/${d}）`;
}
function stats(label: string, xs: readonly number[]): string {
  return `${label}（n=${xs.length}）: 平均 ${fmt(mean(xs))} / 中央値 ${fmt(median(xs))} / p10 ${fmt(percentile(xs, 10))} / p90 ${fmt(percentile(xs, 90))}`;
}

/** 1 シード分のボット（潜行 × DIVES） */
class Campaign {
  state: GameState;
  readonly bot: RngState;
  readonly keys = new Set<string>();
  // 潜行ごとにリセットする
  floor: Floor | null = null;
  near = new Set<string>();
  homeDist = new Map<string, number>();
  battles = 0;
  steps = 0;
  herbs = 0;
  threads = 0;
  homeBattles = 0;
  homeWipe = false;
  wiped: PenaltyResult | null = null;

  constructor(readonly seed: number, readonly shape: Shape) {
    this.state = newGame(seed);
    this.bot = createRng(seed + 20_000);
  }

  /** execute して、rejected なら例外。state の不変条件（battle.input・dungeon.turn 以外）と文字列キーを検査し、全滅なら PenaltyResult の内訳 = 差分を確かめる */
  run(cmd: Command): GameState {
    const from = this.state;
    const r = execute(from, cmd, data);
    if (r.events[0]?.kind === "rejected") throw new Error(`seed ${this.seed}: ${JSON.stringify(cmd)} rejected: ${JSON.stringify(r.events[0])}`);
    // 入力を積むだけの battle.input と向きを変えるだけの dungeon.turn は時間の都合で省く（decisions の H9 の行）
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

  /** 前進 1 歩（向きを変えてから）。遭遇したら戦う */
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
    const c = cellAt(this.floor!, dive.pos.x, dive.pos.y);
    const dirs = FACINGS.filter((d) => isPassable(edgeOf(c, d)) && this.near.has(key(step(dive.pos, d))));
    if (dirs.length === 0) throw new Error(`seed ${this.seed}: no way from ${key(dive.pos)}`);
    this.moveTo(dirs[randInt(this.bot, 0, dirs.length - 1)]!);
    if (this.state.pendingChoice !== null) this.run({ type: "event.choose", optionId: "stay" });
  }

  /** 帰還: 行動可能な者が帰還の品を持っていれば使う。無ければ BFS の最短で上り階段へ歩いて exit（途中の遭遇も戦う） */
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
      if (this.state.screen === "battle") {
        this.fight();
        continue;
      }
      const dive = this.state.dive!;
      const dist = this.homeDist;
      const c = cellAt(this.floor!, dive.pos.x, dive.pos.y);
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

  /** 1 回の潜行（入場から街に戻るまで）。入れなければ null */
  dive(): Method | null {
    if (townMenu(this.state, data)!.dungeons.find((d) => d.id === "d01")?.canEnter !== true) return null;
    this.battles = 0;
    this.steps = 0;
    this.herbs = 0;
    this.threads = 0;
    this.homeBattles = 0;
    this.homeWipe = false;
    this.wiped = null;
    this.run({ type: "dungeon.enter", dungeonId: "d01" });
    // 1 階の構造はこの潜行の間変わらない（罠の発動は kind だけを変え、辺は変えない）ので、潜行ごとにキャッシュする
    this.floor = floorOf(this.state.dive!, data, 1);
    this.homeDist = distancesFrom(this.floor, this.floor.stairsUp);
    this.near = new Set([...this.homeDist].filter(([, d]) => d <= NEAR).map(([k]) => k));
    const n = this.shape.battles(this.bot);
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
        const b0 = this.battles;
        const m = this.goHome();
        this.homeBattles = this.battles - b0;
        this.homeWipe = this.wiped !== null;
        if (this.wiped === null) return capped ? "cap" : m;
      }
    }
    if (this.wiped !== null) return "wipe";
    throw new Error(`seed ${this.seed}: left the dungeon without returning or wiping`);
  }

  /** Z7: 並び順に、dead は寺院で蘇生（払えるなら）、失敗して灰、または元から灰なら闇魔術（払えるなら） */
  revive(rec: DiveRecord): void {
    for (const id of this.state.party.map((c) => c.id)) {
      const life = () => this.state.party.find((c) => c.id === id)!.life;
      if (life() === "dead") {
        const row = townMenu(this.state, data)!.temple.resurrect.find((r) => r.memberId === id)!;
        if (row.affordable) {
          const g = this.state.gold;
          this.run({ type: "town.temple", memberId: id, service: "resurrect" });
          expect(g - this.state.gold).toBe(row.cost);
          rec.templeTries += 1;
          rec.templeCost += row.cost;
          if (life() === "alive") rec.templeOk += 1;
        }
      }
      if (life() === "ash") {
        const row = townMenu(this.state, data)!.dark.find((r) => r.memberId === id)!;
        if (row.affordable) {
          const g = this.state.gold;
          this.run({ type: "town.dark", memberId: id });
          expect(g - this.state.gold).toBe(row.cost);
          expect(life()).toBe("alive");
          rec.darkCount += 1;
          rec.darkCost += row.cost;
        }
      }
    }
  }

  campaign(): CampaignResult {
    const dives: DiveRecord[] = [];
    const goldTrail = [this.state.gold];
    for (let k = 0; k < DIVES; k++) {
      const goldBefore = this.state.gold;
      const method = this.dive();
      if (method === null) return { seed: this.seed, dives, aborted: true, goldTrail };
      expect(this.state.screen).toBe("town");
      const rec: DiveRecord = {
        method,
        battles: this.battles,
        steps: this.steps,
        herbs: this.herbs,
        threads: this.threads,
        homeBattles: this.homeBattles,
        homeWipe: this.homeWipe,
        goldBefore,
        goldAfter: 0,
        templeTries: 0,
        templeOk: 0,
        templeCost: 0,
        darkCount: 0,
        darkCost: 0,
        innCost: 0,
        innFallback: false,
        mercyOffered: this.state.townVisit!.mercyOffered,
        unrevived: 0,
        anyL2: false,
        allL2: false,
      };
      this.revive(rec);
      const inn = townMenu(this.state, data)!.inn;
      const rank = inn[INN_RANK]!.affordable ? INN_RANK : inn.findIndex((r) => r.cost === 0);
      rec.innFallback = rank !== INN_RANK;
      const g = this.state.gold;
      this.run({ type: "town.inn", rank });
      rec.innCost = g - this.state.gold;
      expect(rec.innCost).toBe(inn[rank]!.cost);
      const alive = this.state.party.filter((c) => c.life === "alive");
      rec.unrevived = this.state.party.length - alive.length;
      rec.anyL2 = this.state.party.some((c) => c.level >= 2);
      rec.allL2 = alive.length > 0 && alive.every((c) => c.level >= 2);
      rec.goldAfter = this.state.gold;
      goldTrail.push(this.state.gold);
      dives.push(rec);
    }
    return { seed: this.seed, dives, aborted: false, goldTrail };
  }
}

function report(shape: Shape, results: CampaignResult[]): string {
  const lines: string[] = [];
  const all = results.flatMap((r) => r.dives);
  lines.push(
    `H9 バランス【${shape.label}】（${SEEDS} シード × 潜行 ${DIVES} 回。d01 の 1 階の上り階段から BFS 距離 ${NEAR} 以内。潜行 → 寺院・闇魔術 → 相部屋 1 泊。所持金の初期値 ${START_GOLD}、薬草 ${HERB_PRICE}G）`,
  );
  lines.push(`打ち切り（行動可能な者がいなくて入れない）: ${results.filter((r) => r.aborted).length} シード`);
  for (let k = 0; k < DIVES; k++) {
    const ds = results.flatMap((r) => (r.dives[k] === undefined ? [] : [r.dives[k]!]));
    const wipes = ds.filter((d) => d.method === "wipe").length;
    const m = (x: Method) => ds.filter((d) => d.method === x).length;
    lines.push(
      `潜行 ${k + 1}: 全滅率 ${pct(wipes, ds.length)} / 帰還 糸 ${m("thread")}・徒歩 ${m("walk")}・上限 ${m("cap")} / 戦闘数 平均 ${fmt(mean(ds.map((d) => d.battles)))}・最大 ${Math.max(...ds.map((d) => d.battles))} / 徒歩の帰り道で戦闘 ${ds.filter((d) => d.homeBattles > 0).length}・そこで全滅 ${ds.filter((d) => d.homeWipe).length} / 薬草 平均 ${fmt(mean(ds.map((d) => d.herbs)))}`,
    );
    lines.push(`  ${stats("純益（所持金の変化）", ds.map((d) => d.goldAfter - d.goldBefore))}`);
    lines.push(`  ${stats("純益（薬草代も引く）", ds.map((d) => d.goldAfter - d.goldBefore - d.herbs * HERB_PRICE))}`);
    lines.push(
      `  蘇生: 寺院 ${ds.reduce((a, d) => a + d.templeTries, 0)} 回（成功 ${ds.reduce((a, d) => a + d.templeOk, 0)}、費用計 ${ds.reduce((a, d) => a + d.templeCost, 0)}）/ 闇魔術 ${ds.reduce((a, d) => a + d.darkCount, 0)} 回（費用計 ${ds.reduce((a, d) => a + d.darkCost, 0)}）/ 宿の後に alive でない者がいる ${ds.filter((d) => d.unrevived > 0).length}（計 ${ds.reduce((a, d) => a + d.unrevived, 0)} 人）/ 救済の申し出 ${ds.filter((d) => d.mercyOffered).length}（使わない）/ 相部屋が払えず馬小屋 ${ds.filter((d) => d.innFallback).length}`,
    );
  }
  const totalWipes = all.filter((d) => d.method === "wipe").length;
  lines.push(`全潜行の全滅率: ${pct(totalWipes, all.length)}`);
  lines.push(stats("全潜行の純益（所持金の変化）", all.map((d) => d.goldAfter - d.goldBefore)));
  lines.push(stats("全潜行の純益（薬草代も引く）", all.map((d) => d.goldAfter - d.goldBefore - d.herbs * HERB_PRICE)));
  lines.push(stats("帰還した潜行の純益（所持金の変化）", all.filter((d) => d.method !== "wipe").map((d) => d.goldAfter - d.goldBefore)));
  lines.push(
    stats(
      "帰還した潜行の稼ぎ（純益に寺院・闇魔術・宿の費用を足し戻す）",
      all.filter((d) => d.method !== "wipe").map((d) => d.goldAfter - d.goldBefore + d.templeCost + d.darkCost + d.innCost),
    ),
  );
  lines.push(stats("全滅した潜行の純益（所持金の変化）", all.filter((d) => d.method === "wipe").map((d) => d.goldAfter - d.goldBefore)));
  const firstOf = (r: CampaignResult, f: (d: DiveRecord) => boolean) => r.dives.findIndex(f);
  const l2Dist = (f: (d: DiveRecord) => boolean) => {
    const idx = results.map((r) => firstOf(r, f));
    const parts = Array.from({ length: DIVES }, (_, k) => `${k + 1} 回目 ${idx.filter((i) => i === k).length}`);
    parts.push(`未到達 ${idx.filter((i) => i < 0).length}`);
    return parts.join(" / ");
  };
  lines.push(`レベル 2 到達（誰か 1 人、宿の後で判定）: ${l2Dist((d) => d.anyL2)}`);
  lines.push(`レベル 2 到達（生存者全員、宿の後で判定）: ${l2Dist((d) => d.allL2)}`);
  for (let k = 0; k <= DIVES; k++) {
    const g = results.flatMap((r) => (r.goldTrail[k] === undefined ? [] : [r.goldTrail[k]!]));
    lines.push(stats(k === 0 ? "所持金（開始時）" : `所持金（潜行 ${k} の宿の後）`, g));
  }
  const cum = results.filter((r) => !r.aborted).map((r) => r.goldTrail[DIVES]! - START_GOLD);
  lines.push(stats(`5 回を通した所持金の増減（打ち切りを除く）`, cum));
  return lines.join("\n");
}

describe("バランス（H9）", () => {
  for (const shape of SHAPES) {
    test(`H9 バランス: 潜行（${shape.label}）→ 寺院・闇魔術 → 相部屋 を ${DIVES} 回 × ${SEEDS} シード（数字は出力するだけで、合否は不変条件）`, () => {
      const results: CampaignResult[] = [];
      const keys = new Set<string>();
      for (let seed = 1; seed <= SEEDS; seed++) {
        const c = new Campaign(seed, shape);
        const r = c.campaign();
        expect(c.state.screen).toBe("town");
        expectStateInvariants(c.state);
        for (const k of c.keys) keys.add(k);
        results.push(r);
      }
      for (const k of ["battle.encounter", "battle.win", "town.enter", "town.inn.stay"]) expect(keys.has(k), k).toBe(true);
      console.log(report(shape, results));
    }, 180_000);
  }
});
