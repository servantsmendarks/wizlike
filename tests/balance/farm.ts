// M13 ハクスラの計測（2026-10-09 ユーザー指示。設計書 §2）: 農夫ボット（tests/balance/bot.ts の route "farm"）。
// debug.levels で Lv3・5・8 にした既定の編成で、d01 の 1 階・2 階、d02 の 1 階（d02 は d01 を踏破済みの state にする）を
// 「所持枠が埋まるか推定 20 分」まで稼いで糸で帰り、街で鑑定・装備の更新・売却・寺院・宿・補充、を FARM_DIVES 回繰り返す。
// 9 通りは tests/balance/farm-{d01f1,d01f2,d02f1}-lv{3,5,8}.sim.ts（1 ファイル 1 通り。npm run balance で並列に回る）。
// ボットの値（FARM_MINUTES・FARM_DIVES・NEAR）はテストの定数で、ゲームの調整値ではない（docs/balance.md のコンテンツの数値）。
// 合否は不変条件だけで、数字は console.log に出す（farmReport。後で docs/balance.md に写す）。
import { describe, expect, test } from "vitest";
import { upgradeFee } from "../../src/core/rules/upgrade";
import { slotsUsed } from "../../src/core/state";
import { data } from "../helpers/core";
import {
  fmt,
  mean,
  median,
  NEAR,
  pct,
  percentile,
  returnOnDeath,
  returnOnFrontHp,
  runCampaigns,
  sum,
  type BotKind,
  type Campaign,
  type CampaignResult,
  type DiveRecord,
} from "./bot";

/** 【仮】推定の実時間（迷宮の分。UI-75 の config.measure で数えた値）がこの分に達したら帰る（テストの定数） */
export const FARM_MINUTES = 20;
/** 【仮】1 シードあたりの潜行の回数（テストの定数） */
export const FARM_DIVES = 5;
/** 9 通りの Lv とダンジョン・階 */
export const FARM_LEVELS = [3, 5, 8] as const;
export const FARM_PLACES = [
  { dungeonId: "d01", floor: 1 },
  { dungeonId: "d01", floor: 2 },
  { dungeonId: "d02", floor: 1 },
] as const;

/**
 * M13（設計書 §2-2）: 農夫ボットの帰る条件。この順に見て、理由を c.farmEnd に残す。
 * 1. full: 全員（生死を問わない。IT-54）の所持枠が満杯（slotsUsed ≥ config.inventory.slotsPerCharacter）
 * 2. time: 推定の実時間（迷宮の分）≥ FARM_MINUTES 分
 * 3. death: 潜行の開始時に alive だった者が dead / ash（セオリーと同じ）
 * 4. hp: CB-14 の前衛の alive の者の HP の合計 × 2 < 最大 HP の合計（セオリーと同じ）
 * セオリーの 8 戦の上限は使わない
 */
export function farmShouldReturn(c: Campaign): boolean {
  const slots = data.config.inventory.slotsPerCharacter;
  if (c.state.party.every((x) => slotsUsed(x) >= slots)) c.farmEnd = "full";
  else if (c.estDungeonMs() >= FARM_MINUTES * 60_000) c.farmEnd = "time";
  else if (returnOnDeath(c)) c.farmEnd = "death";
  else if (returnOnFrontHp(c)) c.farmEnd = "hp";
  else return false;
  return true;
}

/** M13（設計書 §2-1）: 農夫ボット（outfit は無し。店の装備は買わない） */
export function farmBot(level: number, dungeonId: string, floor: number): BotKind {
  return { label: `農夫 Lv${level} ${dungeonId} ${floor}F`, shouldReturn: farmShouldReturn, route: "farm", farm: { level, dungeonId, floor } };
}

const MIN = 60_000;
/** 平均 / 中央値 / p10 / p90 */
function dist(xs: readonly number[]): string {
  return `${fmt(mean(xs))} / ${fmt(median(xs))} / ${fmt(percentile(xs, 10))} / ${fmt(percentile(xs, 90))}`;
}
const totalMs = (d: DiveRecord) => d.estDungeonMs + d.estTownMs;
const RARITIES = ["normal", "fine", "rare", "legendary"] as const;
const RARITY_LABEL: Record<string, string> = { normal: "通常", fine: "上質", rare: "希少", legendary: "伝説" };

/** 拾った汎用装備のうち Lv ≥ lv の数 */
function genericAtLeast(d: DiveRecord, lv: number): number {
  return sum(Object.entries(d.foundGenericByLevel).filter(([k]) => Number(k) >= lv).map(([, n]) => n));
}

/**
 * M13（設計書 §2-5 の 9）: ボス撃破 1 回あたりのユニークの期待値（drops.json の boss の表から。計測ではなく表の値）
 * = rolls × itemChance / 100 × ユニークの重みの和 ÷ 重みの合計
 */
export function bossUniqueExpectation(dungeonId: string): number {
  const t = data.drops.tables.find((x) => x.id === data.drops.boss[dungeonId])!;
  const total = sum(t.entries.map((e) => e.weight));
  const uniq = sum(t.entries.filter((e) => "unique" in e).map((e) => e.weight));
  return (t.rolls * t.itemChance * uniq) / (100 * total);
}

/** 1 回の console.log で出す Markdown（設計書 §2-5 の 1〜9） */
export function farmReport(results: CampaignResult[], kind: BotKind): string {
  const f = kind.farm!;
  const seeds = results.length;
  const all = results.flatMap((r) => r.dives);
  const n = all.length;
  const dives = Math.max(0, ...results.map((r) => r.dives.length));
  const rows: [string, string][] = [];
  const row = (k: string, v: string) => rows.push([k, v]);
  const per = (xs: readonly number[]) => fmt(mean(xs));
  // 1. 潜行の数と終わり方
  const endOf = (d: DiveRecord) => (d.method === "wipe" || d.method === "cap" ? d.method : (d.farmEnd ?? "other"));
  const ends = ["full", "time", "death", "hp", "cap", "wipe"];
  const other = all.filter((d) => !ends.includes(endOf(d))).length;
  row("潜行の数", `${n}（打ち切り ${results.filter((r) => r.aborted).length} シード）`);
  row("終わり方", ends.map((e) => `${e} ${pct(all.filter((d) => endOf(d) === e).length, n)}`).join("・") + (other > 0 ? `・その他 ${other}` : ""));
  row("全滅率", pct(all.filter((d) => d.method === "wipe").length, n));
  row("1 潜行あたりの死者", per(all.map((d) => d.deaths.length)));
  // レビュー A 中-1: 目標の階に着かない潜行・HP が戻らないまま入ってすぐ帰る潜行を見えるようにする
  row(`目標の階（${f.floor}F）に着いた潜行`, pct(all.filter((d) => d.deepestFloor >= f.floor).length, n));
  row("潜行の後の宿が馬小屋に落ちた潜行（相部屋が払えない。次の潜行は HP が戻らないまま入る）", pct(all.filter((d) => d.innFallback).length, n));
  row("0 戦で帰った潜行", `${all.filter((d) => d.battles === 0).length}（${pct(all.filter((d) => d.battles === 0).length, n)}）`);
  // 2. 推定の実時間と拍
  row("推定の実時間 迷宮（分。平均 / 中央値 / p10 / p90）", dist(all.map((d) => d.estDungeonMs / MIN)));
  row("推定の実時間 街（分）", dist(all.map((d) => d.estTownMs / MIN)));
  row("推定の実時間 計（分）", dist(all.map((d) => totalMs(d) / MIN)));
  row("戦闘数・歩数・declare の数（平均）", `${per(all.map((d) => d.battles))}・${per(all.map((d) => d.beats.steps))}・${per(all.map((d) => d.beats.declares))}`);
  // 3. 拾った品
  const found = (k: keyof DiveRecord["found"]) => all.map((d) => d.found[k]);
  row("拾った品 1 潜行あたり（汎用 / ユニーク / 消耗品 / 魔法書）", `${per(found("generic"))} / ${per(found("unique"))} / ${per(found("consumable"))} / ${per(found("book"))}`);
  const rar = (r: string) => sum(all.map((d) => d.foundRarity[r] ?? 0));
  const rarTotal = sum(RARITIES.map(rar));
  row("希少度（汎用 + ユニーク）", RARITIES.map((r) => `${RARITY_LABEL[r]} ${pct(rar(r), rarTotal)}`).join("・"));
  const gen = sum(found("generic"));
  const lvCount = (lv: number, plus = false) => sum(all.map((d) => sum(Object.entries(d.foundGenericByLevel).filter(([k]) => (plus ? Number(k) >= lv : Number(k) === lv)).map(([, x]) => x))));
  row("汎用の Lv", [1, 2, 3, 4].map((lv) => `Lv${lv} ${pct(lvCount(lv), gen)}`).join("・") + `・Lv5+ ${pct(lvCount(5, true), gen)}`);
  row("呪い", `${pct(sum(all.map((d) => d.foundCursed)), sum(all.map((d) => sum(Object.values(d.found)))))}（拾った品のうち）`);
  // 4. 触媒
  const lv3 = all.map((d) => genericAtLeast(d, 3));
  const lv4 = all.map((d) => genericAtLeast(d, 4));
  row("触媒 1 潜行あたり（汎用装備 / うち Lv3 以上 / Lv4 以上）", `${per(found("generic"))} / ${per(lv3)} / ${per(lv4)}`);
  // 5. 純益と内訳
  row("純益 1 潜行（売却の直後の所持金 − 潜行の前。平均 / 中央値）", `${fmt(mean(all.map((d) => d.netProfit)))} / ${fmt(median(all.map((d) => d.netProfit)))}`);
  row(
    "内訳 1 潜行あたり（箱の金 / 戦闘などの金（純益 − 箱の金 − 売却 + 鑑定料。戦闘の金のほかに全滅で失う金と救済の金も入る）/ 売却 / 鑑定料。純益の外: 宿 + 補充 / 寺院・闇魔術・治療）",
    `${per(all.map((d) => d.chestGold))} / ${per(all.map((d) => d.netProfit - d.chestGold - d.soldGold + d.identifyCost))} / ${per(all.map((d) => d.soldGold))} / ${per(all.map((d) => d.identifyCost))}。${per(all.map((d) => d.innCost + d.shopCost))} / ${per(all.map((d) => d.templeCost + d.darkCost + d.cureCost))}`,
  );
  row("鑑定・売却（全潜行）", `鑑定 ${sum(all.map((d) => d.identifyCount))} 品・売却 ${sum(all.map((d) => d.soldCount))} 品（未鑑定のまま ${sum(all.map((d) => d.soldUnidCount))} 品・${sum(all.map((d) => d.soldUnidGold))}G）・ユニークの売却 ${sum(all.map((d) => d.soldUnique))} 品・${sum(all.map((d) => d.soldUniqueGold))}G`);
  row("置いていった品（満杯）", `計 ${sum(all.map((d) => d.chestLeft))}・1 潜行あたり ${per(all.map((d) => d.chestLeft))}`);
  // 6. 1 時間あたり
  const hours = sum(all.map(totalMs)) / 3_600_000;
  row("1 時間あたり（推定の計の時間で割る）上質 / 希少 / 伝説", ["fine", "rare", "legendary"].map((r) => fmt(rar(r) / hours)).join(" / ") + `（計 ${fmt(hours)} 時間）`);
  // 7. 逆算（Lv3 → Lv5。触媒 Lv3 以上 3 個 + Lv4 以上 3 個で成功 100%、料金 upgradeFee(3) + upgradeFee(4)）。
  // 1 段目と 2 段目の触媒は別々の 6 個で、Lv3 以上の数には Lv4 以上も入るので、1 項目は Lv3 以上 6 個（レビューの指摘 L-1）
  const fee = upgradeFee(3, data.config.economy) + upgradeFee(4, data.config.economy);
  const a3 = mean(lv3);
  const a4 = mean(lv4);
  const ag = mean(found("generic"));
  const p = mean(all.map((d) => d.netProfit));
  const minPer = mean(all.map(totalMs)) / MIN;
  const need = (parts: number[]) => (parts.some((x) => !Number.isFinite(x)) ? null : Math.max(...parts));
  const ceilDiv = (a: number, b: number) => (b > 0 ? Math.ceil(a / b) : Infinity);
  const show = (k: number | null) => (k === null || p <= 0 ? "—" : `${k} 潜行・推定 ${fmt(k * minPer)} 分（1 時間以内 ${k * minPer <= 60 ? "はい" : "いいえ"}）`);
  row(`逆算 Lv3 → Lv5（触媒 Lv3 以上 6（うち Lv4 以上 3）・料金 ${fee}G）`, show(need([ceilDiv(6, a3), ceilDiv(3, a4), ceilDiv(fee, p)])));
  row(`（参考）Lv を問わない触媒 6 個・料金 ${fee}G`, show(need([ceilDiv(6, ag), ceilDiv(fee, p)])));
  row("目安", "1 時間の農作業で +2 段【仮】（上の逆算が 60 分以内か）");
  // 8. 装備の追従
  const k1 = results.flatMap((r) => (r.dives[0] === undefined ? [] : [r.dives[0]]));
  const kl = results.flatMap((r) => (r.dives[FARM_DIVES - 1] === undefined ? [] : [r.dives[FARM_DIVES - 1]!]));
  const fin = (xs: number[]) => xs.filter((x) => Number.isFinite(x));
  const g1 = mean(fin(k1.map((d) => d.gearLvStart)));
  const gl = mean(fin(kl.map((d) => d.gearLvStart)));
  const e1 = mean(fin(k1.map((d) => d.enemyLvMean)));
  const el = mean(fin(kl.map((d) => d.enemyLvMean)));
  row(`装備の追従（潜行 1 / 潜行 ${FARM_DIVES} の開始時の装備の平均 Lv。ユニークを除く。潜行 1 は初期装備の Lv0 なのでいつも 0）`, `${fmt(g1)} / ${fmt(gl)}（装備中のユニーク 潜行 ${FARM_DIVES} の開始時 計 ${sum(kl.map((d) => d.gearUniques))}）`);
  row(`敵の Lv（体数で重み付けした平均。潜行 1 / 潜行 ${FARM_DIVES}）・差（装備 − 敵。潜行 1 / 潜行 ${FARM_DIVES}）`, `${fmt(e1)} / ${fmt(el)}・${fmt(g1 - e1)} / ${fmt(gl - el)}`);
  row("拾った品を装備した数（全潜行）", String(sum(all.map((d) => d.lootEquipped))));
  // 9. ボスのユニーク（表の値。d01 1F Lv3 のレポートだけ）
  if (f.level === 3 && f.dungeonId === "d01" && f.floor === 1) {
    row("ボス撃破あたりのユニーク（drops.json の表の期待値。計測ではない）", Object.keys(data.drops.boss).map((id) => `${id} ${bossUniqueExpectation(id).toFixed(2)}`).join("・"));
  }
  return [
    `## 農夫 Lv${f.level} ${f.dungeonId} ${f.floor}F（${seeds} シード × ${dives} 潜行）`,
    "",
    `帰る条件: 所持枠が満杯（full）・推定 ${FARM_MINUTES} 分（time）・開始時に alive の者の死亡（death）・前衛の HP 半分（hp）。目標の階は上り階段から BFS ${NEAR} 以内。街: 救済 → 鑑定（見た目の売値の高い順に払える限り）→ 装備の更新 → 売却（鑑定しない）→ 寺院 → 相部屋 → 補充。`,
    "",
    "| 項目 | 値 |",
    "|---|---|",
    ...rows.map(([k, v]) => `| ${k} | ${v} |`),
  ].join("\n");
}

/** BALANCE_SEEDS（既定 200） */
function seedsFromEnv(): number {
  const v: unknown = import.meta.env["BALANCE_SEEDS"];
  if (v !== undefined && v !== "" && !/^[1-9][0-9]*$/.test(String(v))) throw new Error(`BALANCE_SEEDS: expected a positive integer, got ${String(v)}`);
  return v === undefined || v === "" ? 200 : Number(v);
}

/**
 * 1 通り分の計測（farm-*.sim.ts から呼ぶ）。BALANCE_BOTS が f1 / progress なら skip。FARM_DIVES 回 × BALANCE_SEEDS シードで runCampaigns
 * （不変条件はその中）→ キーの検査 → farmReport を console.log に出す
 */
export function runFarm(level: number, dungeonId: string, floor: number): void {
  const bots: unknown = import.meta.env["BALANCE_BOTS"];
  if (bots !== undefined && bots !== "" && bots !== "f1" && bots !== "progress" && bots !== "farm") throw new Error(`BALANCE_BOTS: unknown value ${String(bots)}（f1 / progress / farm）`);
  const skip = bots === "f1" || bots === "progress";
  const seeds = seedsFromEnv();
  const kind = farmBot(level, dungeonId, floor);
  describe("バランス（M13 農夫）", () => {
    (skip ? test.skip : test)(
      `M13 バランス: ${kind.label}で 潜行 → 鑑定・装備・売却・寺院・宿・補充 を ${FARM_DIVES} 回 × ${seeds} シード（数字は出力するだけで、合否は不変条件）`,
      () => {
        const { results, keys } = runCampaigns(kind, seeds, FARM_DIVES);
        console.log(farmReport(results, kind)); // キーの検査で落ちても数字は残す
        expect(keys.has("battle.encounter"), "battle.encounter").toBe(true);
        // 拾った品が 1 つも無ければ（少ないシードの d02 の Lv3 など）店の鑑定・売却は起きないので、そのときは見ない
        const found = sum(results.flatMap((r) => r.dives).map((d) => sum(Object.values(d.found))));
        if (found > 0) expect(keys.has("town.shop.identified") || keys.has("town.shop.sold"), "town.shop.identified / sold").toBe(true);
        expect(keys.has("town.inn.stay"), "town.inn.stay").toBe(true);
      },
      3_600_000,
    );
  });
}
