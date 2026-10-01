// H9 バランスのボット（ユーザー決定）: 「潜行 → 街（救済 → 寺院 → 闇魔術 → 相部屋 1 泊 → 店で補充）→ 潜行」を繰り返す。
// 200 シードの計測は tests/balance/campaign.sim.ts（npm run balance）、既定の npm test には tests/balance.test.ts の煙テスト（5 シード）だけを置く。
// ボットは 2 つ: (a) 4 戦固定ボット（4 戦で帰る）、(b) セオリーボット（戦い続け、この潜行の開始時に alive だった者が dead / ash になった時点か、前衛の HP の合計が半分を切った時点で帰る）。
// ボットはテストの中だけにあり、core の execute と問い合わせ（floorOf、fieldItemMenu、townMenu）だけを使う。
// 合否は不変条件だけで、数字のしきい値では落とさない（数字は console.log に出し、decisions に転記する）。
// 店: alive の者が帰還の糸を持っていなければ 1 本、その後パーティ全体の手持ちの薬草が 6 個【仮】になるまで薬草（払える範囲で。ユーザー決定）。
// 累積の評価は資産 = 所持金 + 手持ちの消耗品（パーティ全員の inventory の consumable）の購入価格の合計で、初期の資産からの差（所持金だけの差も参考に出す）。
// ボットの値（BFS 距離 6、戦闘数、上限 3000 歩、潜行の回数、薬草の目標 6 個）はテストの定数で、ゲームの調整値ではない。
import { expect } from "vitest";
import { execute } from "../../src/core/engine";
import { createRng, randInt, type RngState } from "../../src/core/rng";
import { cellAt, edgeOf, FACINGS, isPassable, opposite, step, turnLeft, turnRight } from "../../src/core/rules/dungeon-gen";
import { floorOf } from "../../src/core/rules/dungeon";
import { fieldItemMenu } from "../../src/core/rules/items";
import { townMenu } from "../../src/core/rules/town";
import { itemOf } from "../../src/core/state";
import type { Command, Facing, Floor, GameEvent, GameState, PenaltyResult, Pos } from "../../src/core/types";
import { data, expectKnownStringKeys, expectStateInvariants, newGame } from "../helpers/core";

const NEAR = 6; // 上り階段からの BFS 距離
const STEP_CAP = 3000; // 1 回の潜行の歩数の上限
const BATTLE_ROUND_CAP = 300;
const FRONT = 3; // セオリーボットの前衛（並び順の前 3 人）
const HERB_TARGET = 6; // 【仮】店の後のパーティ全体の手持ちの薬草の数（ユーザー決定）
const INN_RANK = data.config.town.innRanks.findIndex((r) => r.id === "cheap"); // 相部屋
const START_GOLD = data.config.prototypeParty.startingGold;
const HERB = "herb";
const THREAD = "return_thread";
const HERB_PRICE = itemOf(data, HERB).price;
const THREAD_PRICE = itemOf(data, THREAD).price;

export type BotKind = { label: string; shouldReturn: (c: Campaign) => boolean };
export const BOTS: BotKind[] = [
  { label: "4 戦固定", shouldReturn: (c) => c.battles >= 4 },
  {
    label: "セオリー",
    shouldReturn: (c) => {
      const s = c.state;
      if (s.party.some((x) => c.aliveAtStart.includes(x.id) && x.life !== "alive")) return true; // 潜行の開始時に alive だった者が dead / ash になった（ユーザー決定）
      const front = s.party.slice(0, FRONT);
      const hp = front.reduce((a, x) => a + x.hp, 0);
      const max = front.reduce((a, x) => a + x.hpMax, 0);
      return hp * 2 < max;
    },
  },
];

type Method = "thread" | "walk" | "cap" | "wipe";

/** 潜行 1 回分（潜行 → 街の手順）の記録 */
type DiveRecord = {
  method: Method;
  battles: number;
  steps: number;
  herbs: number;
  threads: number;
  homeBattles: number; // 帰ると決めた後（徒歩の帰り道）の戦闘数（battles に含む）
  homeWipe: boolean;
  frontDownAtStart: boolean; // 潜行の開始時に前衛（並び順の前 3 人）に alive でない者がいた
  down: number; // 潜行の終わり（街に着いた時点、救済・蘇生の前）に alive でない人数
  mercyOffered: boolean;
  mercyUsed: boolean;
  templeTries: number;
  templeOk: number;
  templeCost: number;
  darkCount: number;
  darkCost: number;
  innCost: number;
  innFallback: boolean; // 相部屋が払えず馬小屋に泊まった
  shopThreads: number;
  shopHerbs: number;
  shopCost: number;
  goldBefore: number; // 潜行の前の所持金
  goldAfter: number; // 街の手順をすべて終えた後の所持金
  assetsAfter: number; // 街の手順をすべて終えた後の資産（所持金 + 手持ちの消耗品の購入価格）
  allL2: boolean; // 宿の後に全員が alive かつ L2 以上
  anyL2: boolean; // 宿の後に誰かが L2 以上
};

export type CampaignResult = { seed: number; startAssets: number; dives: DiveRecord[]; aborted: boolean };

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
function sum(xs: readonly number[]): number {
  return xs.reduce((a, b) => a + b, 0);
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

/** 資産 = 所持金 + パーティ全員の手持ち（inventory）の消耗品の購入価格（items.json の price）の合計 */
function assetsOf(s: GameState): number {
  let v = s.gold;
  for (const c of s.party)
    for (const id of c.inventory) {
      const it = itemOf(data, s.items[id]!.itemId);
      if (it.type === "consumable") v += it.price;
    }
  return v;
}

/** 1 シード分のボット（潜行 × dives） */
export class Campaign {
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
  aliveAtStart: string[] = [];
  frontDownAtStart = false;
  wiped: PenaltyResult | null = null;
  readonly startAssets: number;

  constructor(readonly seed: number, readonly kind: BotKind) {
    this.state = newGame(seed);
    this.bot = createRng(seed + 20_000);
    this.startAssets = assetsOf(this.state);
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
    const s = (st: GameState) => st.party.reduce((a, c) => a + c.exp, 0);
    expect(s(before) - s(after)).toBe(p.expLost.reduce((a, e) => a + e.lost, 0));
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

  /** 行動可能な者が持つ、使える帰還の品（無ければ null） */
  threadInHand(): { memberId: string; instanceId: string } | null {
    const menu = fieldItemMenu(this.state, data);
    if (menu === null) return null;
    for (const m of menu.members) {
      if (!m.canAct) continue;
      const it = m.items.find((x) => x.usable && effectType(x.itemId) === "return");
      if (it !== undefined) return { memberId: m.id, instanceId: it.instanceId };
    }
    return null;
  }

  /** 帰還: 上り階段の上でなく、帰還の品があれば使う。無ければ合間の回復をしてから BFS の最短で上り階段へ歩いて exit（途中の遭遇も戦う） */
  goHome(): "thread" | "walk" {
    const onStairs = this.homeDist.get(key(this.state.dive!.pos)) === 0;
    const t = onStairs ? null : this.threadInHand(); // 上り階段の上なら糸を使わず、1 歩出て戻って exit
    if (t !== null) {
      const goldBefore = this.state.gold;
      this.run({ type: "dungeon.useItem", memberId: t.memberId, itemId: t.instanceId });
      this.threads += 1;
      expect(this.state.gold).toBe(goldBefore); // DG-43
      return "thread";
    }
    this.healBetweenBattles();
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
      if (best === null && here === 0) {
        for (const d of FACINGS) if (best === null && isPassable(edgeOf(c, d)) && dist.get(key(step(dive.pos, d))) !== undefined) best = d;
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
    this.aliveAtStart = this.state.party.filter((c) => c.life === "alive").map((c) => c.id);
    this.frontDownAtStart = this.state.party.slice(0, FRONT).some((c) => c.life !== "alive");
    this.run({ type: "dungeon.enter", dungeonId: "d01" });
    // 1 階の構造はこの潜行の間変わらない（罠の発動は kind だけを変え、辺は変えない）ので、潜行ごとにキャッシュする
    this.floor = floorOf(this.state.dive!, data, 1);
    this.homeDist = distancesFrom(this.floor, this.floor.stairsUp);
    this.near = new Set([...this.homeDist].filter(([, d]) => d <= NEAR).map(([k]) => k));
    let capped = false;
    // 帰る判定は各歩（戦闘・罠を含む）の直後、合間の回復より前
    while (this.inDungeon && !this.kind.shouldReturn(this)) {
      if (this.steps >= STEP_CAP) {
        capped = true;
        break;
      }
      this.healBetweenBattles();
      if (!this.inDungeon) break;
      this.wanderStep();
    }
    if (this.inDungeon) {
      const b0 = this.battles;
      const m = this.goHome();
      this.homeBattles = this.battles - b0;
      this.homeWipe = this.wiped !== null;
      if (this.wiped === null) return capped ? "cap" : m;
    }
    if (this.wiped !== null) return "wipe";
    throw new Error(`seed ${this.seed}: left the dungeon without returning or wiping`);
  }

  life(id: string): "alive" | "dead" | "ash" {
    return this.state.party.find((c) => c.id === id)!.life;
  }

  /** 救済の申し出があれば受ける（対象は並び順で最初の dead / ash） */
  mercy(rec: DiveRecord): void {
    const m = townMenu(this.state, data)!.mercy;
    if (m === null || m.length === 0) return;
    const id = m[0]!.memberId;
    const g = this.state.gold;
    this.run({ type: "town.mercy", memberId: id });
    expect(this.state.gold).toBe(g);
    expect(this.life(id)).toBe("alive");
    rec.mercyUsed = true;
  }

  darkIfAffordable(id: string, rec: DiveRecord): void {
    const row = townMenu(this.state, data)!.dark.find((r) => r.memberId === id)!;
    if (!row.affordable) return;
    const g = this.state.gold;
    this.run({ type: "town.dark", memberId: id });
    expect(g - this.state.gold).toBe(row.cost);
    expect(this.life(id)).toBe("alive");
    rec.darkCount += 1;
    rec.darkCost += row.cost;
  }

  /** 寺院: dead を並び順に蘇生（払えるなら。失敗して灰なら払えるなら闇魔術）→ 灰の者を並び順に闇魔術（払えるなら） */
  revive(rec: DiveRecord): void {
    const ids = this.state.party.map((c) => c.id);
    for (const id of ids) {
      if (this.life(id) !== "dead") continue;
      const row = townMenu(this.state, data)!.temple.resurrect.find((r) => r.memberId === id)!;
      if (!row.affordable) continue;
      const g = this.state.gold;
      this.run({ type: "town.temple", memberId: id, service: "resurrect" });
      expect(g - this.state.gold).toBe(row.cost);
      rec.templeTries += 1;
      rec.templeCost += row.cost;
      if (this.life(id) === "alive") rec.templeOk += 1;
      else this.darkIfAffordable(id, rec);
    }
    for (const id of ids) if (this.life(id) === "ash") this.darkIfAffordable(id, rec);
  }

  inn(rec: DiveRecord): void {
    const inn = townMenu(this.state, data)!.inn;
    const rank = inn[INN_RANK]!.affordable ? INN_RANK : inn.findIndex((r) => r.cost === 0);
    rec.innFallback = rank !== INN_RANK;
    const g = this.state.gold;
    this.run({ type: "town.inn", rank });
    rec.innCost = g - this.state.gold;
    expect(rec.innCost).toBe(inn[rank]!.cost);
  }

  /** 1 個買う。持たせるのは空き枠が最も多い alive の者（同数なら並び順）。買えなければ false */
  buy(itemId: string, rec: DiveRecord): boolean {
    const shop = townMenu(this.state, data)!.shop;
    const row = shop.items.find((x) => x.itemId === itemId)!;
    if (!row.affordable) return false;
    let to: { memberId: string; slotsFree: number } | null = null;
    for (const m of shop.members) if (m.slotsFree > 0 && (to === null || m.slotsFree > to.slotsFree)) to = m;
    if (to === null) return false;
    const g = this.state.gold;
    const invBefore = this.state.party.find((c) => c.id === to!.memberId)!.inventory.length;
    this.run({ type: "town.shop", action: { kind: "buy", memberId: to.memberId, itemId } });
    expect(g - this.state.gold).toBe(row.price);
    const inv = this.state.party.find((c) => c.id === to!.memberId)!.inventory;
    expect(inv.length).toBe(invBefore + 1);
    expect(this.state.items[inv[inv.length - 1]!]!.itemId).toBe(itemId);
    rec.shopCost += row.price;
    return true;
  }

  /** パーティ全体（死者・灰を含む）の手持ちの薬草の数 */
  herbsInHand(): number {
    return sum(this.state.party.map((c) => c.inventory.filter((id) => this.state.items[id]!.itemId === HERB).length));
  }

  /** 店: alive の者が帰還の糸を持っていなければ 1 本（死者・灰の糸は使えないので数えない）、その後パーティ全体の手持ちの薬草が HERB_TARGET になるまで薬草を（払える範囲で） */
  shop(rec: DiveRecord): void {
    const hasThread = this.state.party.some((c) => c.life === "alive" && c.inventory.some((id) => this.state.items[id]!.itemId === THREAD));
    if (!hasThread && this.buy(THREAD, rec)) rec.shopThreads += 1;
    while (this.herbsInHand() < HERB_TARGET && this.buy(HERB, rec)) rec.shopHerbs += 1;
  }

  campaign(count: number): CampaignResult {
    const dives: DiveRecord[] = [];
    for (let k = 0; k < count; k++) {
      const goldBefore = this.state.gold;
      const method = this.dive();
      if (method === null) return { seed: this.seed, startAssets: this.startAssets, dives, aborted: true };
      expect(this.state.screen).toBe("town");
      const rec: DiveRecord = {
        method,
        battles: this.battles,
        steps: this.steps,
        herbs: this.herbs,
        threads: this.threads,
        homeBattles: this.homeBattles,
        homeWipe: this.homeWipe,
        frontDownAtStart: this.frontDownAtStart,
        down: this.state.party.filter((c) => c.life !== "alive").length,
        mercyOffered: this.state.townVisit!.mercyOffered,
        mercyUsed: false,
        templeTries: 0,
        templeOk: 0,
        templeCost: 0,
        darkCount: 0,
        darkCost: 0,
        innCost: 0,
        innFallback: false,
        shopThreads: 0,
        shopHerbs: 0,
        shopCost: 0,
        goldBefore,
        goldAfter: 0,
        assetsAfter: 0,
        allL2: false,
        anyL2: false,
      };
      this.mercy(rec);
      this.revive(rec);
      this.inn(rec);
      rec.allL2 = this.state.party.every((c) => c.life === "alive" && c.level >= 2);
      rec.anyL2 = this.state.party.some((c) => c.level >= 2);
      this.shop(rec);
      rec.goldAfter = this.state.gold;
      rec.assetsAfter = assetsOf(this.state);
      dives.push(rec);
    }
    return { seed: this.seed, startAssets: this.startAssets, dives, aborted: false };
  }
}

export function report(kind: BotKind, results: CampaignResult[], seeds: number, dives: number): string {
  const lines: string[] = [];
  const all = results.flatMap((r) => r.dives);
  lines.push(
    `H9 再計測【${kind.label}】（${seeds} シード × 潜行 ${dives} 回。d01 の 1 階の上り階段から BFS 距離 ${NEAR} 以内。街: 救済 → 寺院 → 闇魔術 → 相部屋 1 泊 → 店（糸が無ければ 1 本 ${THREAD_PRICE}G、薬草 ${HERB_PRICE}G を手持ち ${HERB_TARGET} 個まで）。所持金の初期値 ${START_GOLD}、資産の初期値 ${results[0]?.startAssets ?? "-"}（所持金 + 手持ちの消耗品の購入価格））`,
  );
  lines.push(`打ち切り（行動可能な者がいなくて入れない）: ${results.filter((r) => r.aborted).length} シード`);
  for (let k = 0; k < dives; k++) {
    const ds = results.flatMap((r) => (r.dives[k] === undefined ? [] : [r.dives[k]!]));
    const wipes = ds.filter((d) => d.method === "wipe").length;
    const m = (x: Method) => ds.filter((d) => d.method === x).length;
    const downDist = Array.from({ length: 7 }, (_, n) => `${n}:${ds.filter((d) => d.down === n).length}`).join(" ");
    lines.push(
      `潜行 ${k + 1}: 全滅率 ${pct(wipes, ds.length)} / 帰還 糸 ${m("thread")}・徒歩 ${m("walk")}・上限 ${m("cap")}・全滅 ${wipes} / 戦闘数 平均 ${fmt(mean(ds.map((d) => d.battles)))}・中央値 ${fmt(median(ds.map((d) => d.battles)))}・最大 ${Math.max(...ds.map((d) => d.battles))}・戦闘 0 で帰還 ${ds.filter((d) => d.battles === 0 && d.method !== "wipe").length}（うち開始時に前衛に alive でない者 ${ds.filter((d) => d.battles === 0 && d.method !== "wipe" && d.frontDownAtStart).length}）/ 徒歩の帰り道で戦闘 ${ds.filter((d) => d.homeBattles > 0).length}・そこで全滅 ${ds.filter((d) => d.homeWipe).length} / 薬草 平均 ${fmt(mean(ds.map((d) => d.herbs)))}・糸 ${sum(ds.map((d) => d.threads))} 本`,
    );
    lines.push(`  死者数（潜行の終わり、救済・蘇生の前に alive でない人数）: 平均 ${fmt(mean(ds.map((d) => d.down)))} / 分布 ${downDist}`);
    lines.push(
      `  救済: 申し出 ${ds.filter((d) => d.mercyOffered).length}・受けた ${ds.filter((d) => d.mercyUsed).length} / 寺院 ${sum(ds.map((d) => d.templeTries))} 回（成功 ${sum(ds.map((d) => d.templeOk))}、費用計 ${sum(ds.map((d) => d.templeCost))}）/ 闇魔術 ${sum(ds.map((d) => d.darkCount))} 回（費用計 ${sum(ds.map((d) => d.darkCost))}）/ 宿 費用計 ${sum(ds.map((d) => d.innCost))}・馬小屋 ${ds.filter((d) => d.innFallback).length} / 店 糸 ${sum(ds.map((d) => d.shopThreads))}・薬草 ${sum(ds.map((d) => d.shopHerbs))}・費用計 ${sum(ds.map((d) => d.shopCost))}`,
    );
    lines.push(`  ${stats("この潜行の所持金の変化（街の手順の後）", ds.map((d) => d.goldAfter - d.goldBefore))}`);
    // 打ち切られたシードは最後の潜行の後の値で据え置く
    const cumA = results.map((r) => (r.dives[Math.min(k, r.dives.length - 1)]?.assetsAfter ?? r.startAssets) - r.startAssets);
    lines.push(`  ${stats(`潜行 1〜${k + 1} の累積（資産。初期の資産からの差）`, cumA)}・黒字 ${cumA.filter((x) => x > 0).length}`);
    const cum = results.map((r) => (r.dives[Math.min(k, r.dives.length - 1)]?.goldAfter ?? START_GOLD) - START_GOLD);
    lines.push(`  （参考）${stats(`潜行 1〜${k + 1} の累積所持金（初期値 ${START_GOLD} からの差）`, cum)}・黒字 ${cum.filter((x) => x > 0).length}`);
  }
  lines.push(`全潜行の全滅率: ${pct(all.filter((d) => d.method === "wipe").length, all.length)}`);
  const idx = results.map((r) => r.dives.findIndex((d) => d.allL2));
  const parts = Array.from({ length: dives }, (_, k) => `${k + 1} 回目 ${idx.filter((i) => i === k).length}`);
  parts.push(`未到達 ${idx.filter((i) => i < 0).length}`);
  lines.push(`全員 L2 到達（宿の後、全員 alive かつ L2 以上）の最初の潜行: ${parts.join(" / ")}（3 回目までに ${idx.filter((i) => i >= 0 && i < 3).length}）`);
  const idxAny = results.map((r) => r.dives.findIndex((d) => d.anyL2));
  const partsAny = Array.from({ length: dives }, (_, k) => `${k + 1} 回目 ${idxAny.filter((i) => i === k).length}`);
  partsAny.push(`未到達 ${idxAny.filter((i) => i < 0).length}`);
  lines.push(`（参考）誰か 1 人が L2 の最初の潜行: ${partsAny.join(" / ")}`);
  return lines.join("\n");
}

/** seeds 個のシード（1 から）で kind のボットを count 回ずつ潜らせ、各シードの最後の state の不変条件を確かめる。出たメッセージのキーの和集合も返す */
export function runCampaigns(kind: BotKind, seeds: number, count: number): { results: CampaignResult[]; keys: Set<string> } {
  const results: CampaignResult[] = [];
  const keys = new Set<string>();
  for (let seed = 1; seed <= seeds; seed++) {
    const c = new Campaign(seed, kind);
    const r = c.campaign(count);
    expect(c.state.screen).toBe("town");
    expectStateInvariants(c.state);
    for (const k of c.keys) keys.add(k);
    results.push(r);
  }
  return { results, keys };
}
