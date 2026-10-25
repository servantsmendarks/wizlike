// M25 計測の道具: 探索ボット（tests/balance/explore.ts）で、各ダンジョンの各階の「降り口を見つけるまでの歩数」と「未踏の口の数」を
// diveSeed 1..BALANCE_SEEDS（既定 200）で測り、表を console.log に出す。基準（今のデータ）と、M25 前の d01（20×20・一言 100 歩）の比較の 2 通り。
// 合否は不変条件だけ（基準の生成の Error が 0、ボットの失敗が 0、見つけた ≤ 着いた）。数字のしきい値では落とさない。
// BALANCE_BOTS が未設定か explore のときだけ走る（f1 / progress / farm のときは skip）。BALANCE_BOTS=explore では campaign と農夫は走らない。
// 例（Git Bash）: BALANCE_SEEDS=200 BALANCE_BOTS=explore npm run balance
import { describe, expect, test } from "vitest";
import { data } from "../helpers/core";
import { type ExploreVariant, failuresOf, formatExploreReport, measureExplore } from "./explore";

const seedsEnv: unknown = import.meta.env["BALANCE_SEEDS"];
if (seedsEnv !== undefined && seedsEnv !== "" && !/^[1-9][0-9]*$/.test(String(seedsEnv))) throw new Error(`BALANCE_SEEDS: expected a positive integer, got ${String(seedsEnv)}`);
const SEEDS = seedsEnv === undefined || seedsEnv === "" ? 200 : Number(seedsEnv);

const bots: unknown = import.meta.env["BALANCE_BOTS"];
if (bots !== undefined && bots !== "" && bots !== "f1" && bots !== "progress" && bots !== "farm" && bots !== "explore") {
  throw new Error(`BALANCE_BOTS: unknown value ${String(bots)}（f1 / progress / farm / explore）`);
}
const skip = bots === "f1" || bots === "progress" || bots === "farm";

const BASE: ExploreVariant = { label: "基準（今のデータ）", dungeonIds: ["d01", "d02", "d03"], seeds: SEEDS };
// M25 の群 A-1 で d01 は 16×16 になったので、比較の変形は M25 前の d01 の盤と一言の閾値（最下層の一言は基準と同じく出す）
const D01_M24: ExploreVariant = { label: "M25 前の d01（20×20・一言 100 歩）", dungeonIds: ["d01"], seeds: SEEDS, defOverride: { d01: { width: 20, height: 20, lostHintSteps: 100 } } };

describe("バランス（M25 探索ボット）", () => {
  (skip ? test.skip : test)(
    `M25 計測: 探索ボット（nearest / random / nearest-hint / random-hint）で各階の降り口を見つけるまでの歩数と未踏の口を ${SEEDS} シード（基準と M25 前の d01。数字は出力するだけで、合否は不変条件）`,
    () => {
      for (const v of [BASE, D01_M24]) {
        const t0 = performance.now();
        const r = measureExplore(data, v);
        console.log(formatExploreReport(r, `探索ボット: ${v.label}`));
        console.log(`（${v.label} の所要 ${((performance.now() - t0) / 1000).toFixed(2)} 秒）`);
        if (v === BASE) for (const d of r.dungeons) expect(d.genErrors, `${d.id} の生成の Error`).toBe(0);
        expect(failuresOf(r), "ボットの失敗").toBe(0);
        for (const d of r.dungeons) {
          for (const fr of d.floorRecords) {
            for (const { list } of fr.walks) {
              for (const w of list) {
                expect(w.found).not.toBeNull();
                expect(w.reached).not.toBeNull();
                expect(w.found!).toBeLessThanOrEqual(w.reached!);
              }
            }
          }
        }
      }
    },
    600_000,
  );
});
