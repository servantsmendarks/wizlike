// M26 計測の道具（群 E。設計 §6-8）: d01 のボス（門番）との 1 戦だけを、Lv 3・4・5 × seed 1..BALANCE_SEEDS（既定 200）で回し、表を console.log に出す。
// 条件（ユーザーの判断 9）: createInitialState(seed) → game.new（既定の編成・既定の性格）→ debug.levels（装備は Lv1 の初期装備のまま）→ dungeon.enter d01
// → 1 階に入った直後の state で startBossEncounter（HP / MP は満タン）→ battle.auto on（呪文あり）→ battle.resolve を戦闘が終わるまで。
// 実戦（2 階を歩いた後で消耗がある）より楽な条件なので、ここの勝率は上限の目安（docs/balance.md の「ボス戦の計測(M26-基準)」）。
// 合否は不変条件だけ（毎手の expectStateInvariants と expectKnownStringKeys、上限のラウンドで終わる、逃走は起きない）。数字のしきい値では落とさない。
// data は共有の data をそのまま使う（調整案の比較は scratchpad の試作で済ませた。差し替えの仕組みは持たない）。
// BALANCE_BOTS が未設定か boss のときだけ走る（f1 / progress / farm / explore のときは skip）。BALANCE_BOTS=boss ではほかのボットは走らない。
// 例（Git Bash）: BALANCE_SEEDS=200 BALANCE_BOTS=boss npm run balance
import { describe, expect, test } from "vitest";
import { createInitialState, execute } from "../../src/core/engine";
import { startBossEncounter } from "../../src/core/rules/combat";
import { cloneState, makeContext } from "../../src/core/state";
import type { Command, GameEvent, GameState } from "../../src/core/types";
import { data, defaultMembers, expectKnownStringKeys, expectStateInvariants } from "../helpers/core";
import { BATTLE_ROUND_CAP, fmt, pct } from "./bot";
import { seedsFromEnv } from "./farm";

const bots: unknown = import.meta.env["BALANCE_BOTS"];
if (bots !== undefined && bots !== "" && bots !== "f1" && bots !== "progress" && bots !== "farm" && bots !== "explore" && bots !== "boss") {
  throw new Error(`BALANCE_BOTS: unknown value ${String(bots)}（f1 / progress / farm / explore / boss）`);
}
const skip = bots === "f1" || bots === "progress" || bots === "farm" || bots === "explore";
const SEEDS = seedsFromEnv();
const LEVELS = [3, 4, 5] as const;

type BossRecord = { result: "win" | "wipe"; deaths: number; rounds: number };

function run(state: GameState, cmd: Command, seed: number): { state: GameState; events: GameEvent[] } {
  const r = execute(state, cmd, data);
  if (r.events[0]?.kind === "rejected") throw new Error(`seed ${seed}: ${JSON.stringify(cmd)} rejected: ${JSON.stringify(r.events[0])}`);
  return r;
}

/**
 * battleEnd までの味方の lifeChanged（dead / ash）を延べで数える（敵の lifeChanged は数えない）。全滅処理（TW-23 / TW-24）の後の life は数えない。
 * 戦闘が終わったら result を返す
 */
function scan(events: readonly GameEvent[], acc: { deaths: number; party: ReadonlySet<string> }): "win" | "flee" | "wipe" | null {
  for (const e of events) {
    if (e.kind === "battleEnd") return e.result;
    if (e.kind === "lifeChanged" && acc.party.has(e.id) && (e.life === "dead" || e.life === "ash")) acc.deaths += 1;
  }
  return null;
}

function fightBoss(seed: number, level: number): BossRecord {
  let s = run(createInitialState(seed, data), { type: "game.new", party: { members: defaultMembers() } }, seed).state;
  s = run(s, { type: "debug.levels", level }, seed).state;
  s = run(s, { type: "dungeon.enter", dungeonId: "d01" }, seed).state;
  const ctx = makeContext(cloneState(s), data);
  startBossEncounter(ctx);
  s = ctx.state;
  expectStateInvariants(s);
  expectKnownStringKeys(ctx.events);
  const acc = { deaths: 0, party: new Set(s.party.map((c) => c.id)) };
  let result = scan(ctx.events, acc);
  let rounds = 0;
  while (s.battle !== null) {
    if (rounds > BATTLE_ROUND_CAP) throw new Error(`seed ${seed} Lv${level}: the boss battle did not end within ${BATTLE_ROUND_CAP} rounds`);
    const cmd: Command = s.battle.auto ? { type: "battle.resolve" } : { type: "battle.auto", on: true };
    if (cmd.type === "battle.resolve") rounds += 1;
    const r = run(s, cmd, seed);
    expectStateInvariants(r.state);
    expectKnownStringKeys(r.events);
    result ??= scan(r.events, acc);
    s = r.state;
  }
  if (result !== "win" && result !== "wipe") throw new Error(`seed ${seed} Lv${level}: unexpected battle result ${String(result)}`);
  return { result, deaths: acc.deaths, rounds };
}

function bossReport(rows: { level: number; records: BossRecord[]; ms: number }[]): string {
  const lines = [
    `### ボス戦（d01 の門番。${SEEDS} シード。HP / MP 満タン・Lv1 の初期装備・オート〔呪文あり〕・既定の性格・1 階に入った直後から）`,
    "",
    "| Lv | 戦闘 | 勝率 | 全滅 | 死者/戦（延べ） | 死者が出た戦闘 | 平均ラウンド | 所要（秒） |",
    "|---|---|---|---|---|---|---|---|",
  ];
  for (const { level, records, ms } of rows) {
    const n = records.length;
    const deaths = records.reduce((a, r) => a + r.deaths, 0);
    const rounds = records.reduce((a, r) => a + r.rounds, 0);
    lines.push(
      `| ${level} | ${n} | ${pct(records.filter((r) => r.result === "win").length, n)} | ${pct(records.filter((r) => r.result === "wipe").length, n)} | ${(deaths / n).toFixed(2)}（${deaths}） | ${pct(records.filter((r) => r.deaths > 0).length, n)} | ${fmt(rounds / n)} | ${(ms / 1000).toFixed(2)} |`,
    );
  }
  return lines.join("\n");
}

describe("バランス（M26 ボス戦）", () => {
  (skip ? test.skip : test)(
    `M26 計測: d01 の門番との 1 戦を Lv ${LEVELS.join("・")} × ${SEEDS} シード（勝率・全滅・死者・平均ラウンド。数字は出力するだけで、合否は不変条件）`,
    () => {
      const rows: { level: number; records: BossRecord[]; ms: number }[] = [];
      for (const level of LEVELS) {
        const t0 = performance.now();
        const records: BossRecord[] = [];
        for (let seed = 1; seed <= SEEDS; seed++) records.push(fightBoss(seed, level));
        rows.push({ level, records, ms: performance.now() - t0 });
      }
      console.log(bossReport(rows));
      for (const { records } of rows) expect(records).toHaveLength(SEEDS);
    },
    600_000,
  );
});
