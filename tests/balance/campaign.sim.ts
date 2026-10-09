// H9 バランスの計測（npm run balance。既定の npm test には含めない）: 2 つのボットで 潜行 → 街 を 5 回 × 200 シード。
// 数字は console.log に出すだけで、合否は不変条件。
// 環境変数 BALANCE_PERSONALITIES=normal で、リーダー以外の 5 人を「普通」にした編成で回す（性格の有無の比較用。
// 名前・種族・職業・能力値・装備は既定の編成と同じ。リーダーは CH-31 で性格なし）。未設定なら既定の編成（DEFAULT_PERSONALITIES）。
// 例（Git Bash）: BALANCE_PERSONALITIES=normal npm run balance
// M9: 進行ボット（d01 の 2 階とボス、d01 の踏破の後の d02。tests/balance/bot.ts の PROGRESS_BOT）を足した。
// 環境変数 BALANCE_BOTS=f1 で旧ルート（4 戦固定・セオリー）だけ、BALANCE_BOTS=progress で進行ボットだけを回す。未設定なら両方。
// BALANCE_DESCEND_LEVEL=<正の整数> で進行ボットの降りる条件の level を替える（既定は bot.ts の DESCEND_LEVEL = 3 で、これを公式の数字とする。
// 1 なら d01 の 1 階で必ず降りる。その数字は参考として残す比較用）。M12 から d02・d03 の level は bot.ts の DESCEND_LEVELS / BOSS_LEVELS のまま（替えるのは d01 だけ）。
// M13: 農夫ボット（tests/balance/farm-*.sim.ts の 9 通り）は別ファイル。BALANCE_BOTS=farm で農夫だけ（このファイルの 3 ボットは回さない）。未設定なら全部。
// M12: 進行ボットは d01 → d02 → d03 の順に踏破し、d03 に D03_DIVES 回潜ったら終える（最大 PROGRESS_DIVES 潜行）。BALANCE_SEEDS でシード数を替えられる。
import { describe, expect, test } from "vitest";
import type { PartySetupMember } from "../../src/core/types";
import { defaultMembers } from "../helpers/core";
import { BOTS, D03_DIVES, PROGRESS_BOT, PROGRESS_DIVES, progressReport, report, runCampaigns, type BotKind } from "./bot";

// M12（設計書 §4-2）: BALANCE_SEEDS=<正の整数> でシード数を替える（既定 200。目安の境目で 400 に増やして取り直す用）
const seedsEnv: unknown = import.meta.env["BALANCE_SEEDS"];
if (seedsEnv !== undefined && seedsEnv !== "" && !/^[1-9][0-9]*$/.test(String(seedsEnv))) throw new Error(`BALANCE_SEEDS: expected a positive integer, got ${String(seedsEnv)}`);
const SEEDS = seedsEnv === undefined || seedsEnv === "" ? 200 : Number(seedsEnv);
const DIVES = 5;

const mode: unknown = import.meta.env["BALANCE_PERSONALITIES"];
if (mode !== undefined && mode !== "" && mode !== "normal") throw new Error(`BALANCE_PERSONALITIES: unknown value ${String(mode)}（normal だけ）`);
const allNormal = mode === "normal";
const members: PartySetupMember[] | undefined = allNormal
  ? defaultMembers().map((m) => ({ ...m, personality: m.personality === null ? null : "normal" }))
  : undefined;

const bots: unknown = import.meta.env["BALANCE_BOTS"];
if (bots !== undefined && bots !== "" && bots !== "f1" && bots !== "progress" && bots !== "farm") throw new Error(`BALANCE_BOTS: unknown value ${String(bots)}（f1 / progress / farm）`);
const runF1 = bots !== "progress" && bots !== "farm";
const runProgress = bots !== "f1" && bots !== "farm"; // M13: BALANCE_BOTS=farm は農夫（tests/balance/farm-*.sim.ts）だけ
const descend: unknown = import.meta.env["BALANCE_DESCEND_LEVEL"];
if (descend !== undefined && descend !== "" && !/^[1-9][0-9]*$/.test(String(descend))) throw new Error(`BALANCE_DESCEND_LEVEL: expected a positive integer, got ${String(descend)}`);
const progressBot: BotKind =
  descend === undefined || descend === "" ? PROGRESS_BOT : { ...PROGRESS_BOT, label: `${PROGRESS_BOT.label}（d01 の降りる L${String(descend)}）`, descendLevel: { d01: Number(descend) } };

describe("バランス（H9 計測）", () => {
  // M13: BALANCE_BOTS=farm ではこのファイルの 3 ボットを回さない（空の describe は vitest が失敗にするので skip を 1 本置く）
  if (!runF1 && !runProgress) test.skip("H9 バランス: BALANCE_BOTS=farm では回さない（農夫は tests/balance/farm-*.sim.ts）", () => {});
  for (const kind of runF1 ? BOTS : []) {
    test(`H9 バランス: ${kind.label}ボットで 潜行 → 救済・寺院・闇魔術 → 相部屋 → 店 を ${DIVES} 回 × ${SEEDS} シード（数字は出力するだけで、合否は不変条件）`, () => {
      const { results, keys } = runCampaigns(kind, SEEDS, DIVES, members);
      for (const k of ["battle.encounter", "battle.win", "town.enter", "town.inn.stay", "town.shop.bought"]) expect(keys.has(k), k).toBe(true);
      if (members !== undefined) console.log(`編成: リーダー以外の 5 人が普通（BALANCE_PERSONALITIES=normal。性格: ${members.map((m) => m.personality ?? "なし").join(", ")}）`);
      console.log(report(kind, results, SEEDS, DIVES));
    }, 600_000);
  }
  if (runProgress) {
    test(`H9/M9/M12 バランス: ${progressBot.label}ボットで d01・d02・d03 を順に踏破し、d03 に ${D03_DIVES} 潜行（最大 ${PROGRESS_DIVES} 潜行 × ${SEEDS} シード。数字は出力するだけで、合否は不変条件）`, () => {
      const { results, keys } = runCampaigns(progressBot, SEEDS, PROGRESS_DIVES, members);
      for (const k of ["battle.encounter", "battle.win", "town.enter", "dungeon.descend"]) expect(keys.has(k), k).toBe(true);
      if (members !== undefined) console.log(`編成: リーダー以外の 5 人が普通（BALANCE_PERSONALITIES=normal）`);
      console.log(progressReport(results, progressBot));
    }, 3_600_000);
  }
});
