// H9 バランスの計測（npm run balance。既定の npm test には含めない）: 2 つのボットで 潜行 → 街 を 5 回 × 200 シード。
// 数字は console.log に出すだけで、合否は不変条件。
// 環境変数 BALANCE_PERSONALITIES=normal で、リーダー以外の 5 人を「普通」にした編成で回す（性格の有無の比較用。
// 名前・種族・職業・能力値・装備は既定の編成と同じ。リーダーは CH-31 で性格なし）。未設定なら既定の編成（DEFAULT_PERSONALITIES）。
// 例（Git Bash）: BALANCE_PERSONALITIES=normal npm run balance
import { describe, expect, test } from "vitest";
import type { PartySetupMember } from "../../src/core/types";
import { defaultMembers } from "../helpers/core";
import { BOTS, report, runCampaigns } from "./bot";

const SEEDS = 200;
const DIVES = 5;

const mode: unknown = import.meta.env["BALANCE_PERSONALITIES"];
if (mode !== undefined && mode !== "" && mode !== "normal") throw new Error(`BALANCE_PERSONALITIES: unknown value ${String(mode)}（normal だけ）`);
const allNormal = mode === "normal";
const members: PartySetupMember[] | undefined = allNormal
  ? defaultMembers().map((m) => ({ ...m, personality: m.personality === null ? null : "normal" }))
  : undefined;

describe("バランス（H9 計測）", () => {
  for (const kind of BOTS) {
    test(`H9 バランス: ${kind.label}ボットで 潜行 → 救済・寺院・闇魔術 → 相部屋 → 店 を ${DIVES} 回 × ${SEEDS} シード（数字は出力するだけで、合否は不変条件）`, () => {
      const { results, keys } = runCampaigns(kind, SEEDS, DIVES, members);
      for (const k of ["battle.encounter", "battle.win", "town.enter", "town.inn.stay", "town.shop.bought"]) expect(keys.has(k), k).toBe(true);
      if (members !== undefined) console.log(`編成: リーダー以外の 5 人が普通（BALANCE_PERSONALITIES=normal。性格: ${members.map((m) => m.personality ?? "なし").join(", ")}）`);
      console.log(report(kind, results, SEEDS, DIVES));
    }, 600_000);
  }
});
