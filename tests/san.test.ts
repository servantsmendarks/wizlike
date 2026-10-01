import { describe, expect, test } from "vitest";
import {
  applySanValue,
  gainSan,
  loseSan,
  restoreSan,
  sanLossAmount,
  sanLossMultiplier,
  sanStage,
  stageRank,
} from "../src/core/rules/san";
import { personalityOf } from "../src/core/state";
import type { GameState } from "../src/core/types";
import { ctxFor, data, expectKnownStringKeys, newGame, withChar } from "./helpers/core";

// 既定のパーティ: [0] リーダー(null) [1] cautious [2] reckless [3] greedy [4] normal [5] cautious
const LEADER = 0;
const CAUTIOUS = 1;
const RECKLESS = 2;
const NORMAL = 4;
const cfg = data.config;
const P = {
  cautious: personalityOf(data, "cautious"),
  reckless: personalityOf(data, "reckless"),
  greedy: personalityOf(data, "greedy"),
  normal: personalityOf(data, "normal"),
};

/** シード 1 の新規ゲームで、idx のメンバーの san を設定した state。 */
function stateWith(idx: number, san: number, sanMax = 100): GameState {
  return withChar(newGame(1), idx, { san, sanMax });
}

describe("san: 閾値", () => {
  test("CH-53 sanStage の境界（sanMax 100 と 80）", () => {
    for (let s = 50; s <= 100; s++) expect(sanStage(s, 100, cfg)).toBe("normal");
    for (let s = 25; s <= 49; s++) expect(sanStage(s, 100, cfg)).toBe("uneasy");
    for (let s = 1; s <= 24; s++) expect(sanStage(s, 100, cfg)).toBe("confused");
    expect(sanStage(0, 100, cfg)).toBe("broken");
    expect(sanStage(40, 80, cfg)).toBe("normal");
    expect(sanStage(39, 80, cfg)).toBe("uneasy");
    expect(sanStage(20, 80, cfg)).toBe("uneasy");
    expect(sanStage(19, 80, cfg)).toBe("confused");
    expect(sanStage(1, 80, cfg)).toBe("confused");
    expect(sanStage(0, 80, cfg)).toBe("broken");
    expect(["normal", "uneasy", "confused", "broken"].map((s) => stageRank(s as never))).toEqual([0, 1, 2, 3]);
  });
});

describe("san: 耐性（CH-54）", () => {
  test("CH-54 fear: reckless は 4 → 2、1 → 0。cautious、normal、リーダー（null）は 4", () => {
    expect(sanLossAmount(4, P.reckless, ["fear"])).toBe(2);
    expect(sanLossAmount(1, P.reckless, ["fear"])).toBe(0);
    expect(sanLossAmount(4, P.cautious, ["fear"])).toBe(4);
    expect(sanLossAmount(4, P.normal, ["fear"])).toBe(4);
    expect(sanLossAmount(4, null, ["fear"])).toBe(4);

    // loseSan 経由でも同じ（reckless は 100 → 98、リーダーは 100 → 96）
    const s = newGame(1);
    const ctx = ctxFor(s);
    const r = loseSan(ctx, ctx.state.party[RECKLESS]!, 4, ["fear"]);
    expect(r).toMatchObject({ from: 100, to: 98, delta: -2 });
    const l = loseSan(ctx, ctx.state.party[LEADER]!, 4, ["fear"]);
    expect(l).toMatchObject({ from: 100, to: 96, delta: -4 });
    // reckless の fear 1 は 0 になり、イベントは出ない
    const before = ctx.events.length;
    const z = loseSan(ctx, ctx.state.party[RECKLESS]!, 1, ["fear"]);
    expect(z.delta).toBe(0);
    expect(ctx.events.length).toBe(before);
  });

  test("CH-54/EV-43 allyInjury: cautious は 10 → 5", () => {
    expect(sanLossAmount(10, P.cautious, ["allyInjury"])).toBe(5);
    expect(sanLossAmount(10, P.reckless, ["allyInjury"])).toBe(10);
    const ctx = ctxFor(newGame(1));
    const r = loseSan(ctx, ctx.state.party[CAUTIOUS]!, cfg.san.allyDeath, ["allyInjury"]);
    expect(r).toMatchObject({ from: 100, to: 95, delta: -5 });
  });

  test("CH-54 trap: cautious は 5 → 2", () => {
    expect(sanLossAmount(5, P.cautious, ["trap"])).toBe(2);
    expect(sanLossAmount(5, P.normal, ["trap"])).toBe(5);
  });

  test("CH-54 複数のタグは掛け合わせてから 1 回だけ切り捨てる", () => {
    // 実データ: cautious は allyInjury 0.5 × trap 0.5 = 0.25。9 × 0.25 = 2.25 → 2。未知のタグは無視する
    expect(sanLossMultiplier(P.cautious, ["allyInjury", "trap"])).toBe(0.25);
    expect(sanLossAmount(9, P.cautious, ["allyInjury", "trap", "unknown"])).toBe(2);
    expect(sanLossMultiplier(P.cautious, ["unknown"])).toBe(1);
    expect(sanLossMultiplier(null, ["fear", "allyInjury", "trap"])).toBe(1);
    // 0.5 × 0.5 では切り捨ての回数で差が出ないので、合成の性格で確かめる。
    // fear 0.5 × trap 1.5 = 0.75。3 × 0.75 = 2.25 → 2（タグごとに切り捨てると floor(floor(1.5) × 1.5) = 1）
    const base = P.normal!;
    const synthetic = { ...base, san: { ...base.san, fearLossMul: 0.5, trapLossMul: 1.5 } };
    expect(sanLossMultiplier(synthetic, ["fear", "trap"])).toBe(0.75);
    expect(sanLossAmount(3, synthetic, ["fear", "trap"])).toBe(2);
  });

  test("CH-51 タグなしの減少は誰でも同じ量", () => {
    for (const p of [null, P.cautious, P.reckless, P.greedy, P.normal]) {
      expect(sanLossAmount(5, p, [])).toBe(5);
    }
    const ctx = ctxFor(newGame(1));
    const deltas = ctx.state.party.map((ch) => loseSan(ctx, ch, cfg.san.floorDescend).delta);
    expect(deltas).toEqual([-5, -5, -5, -5, -5, -5]);
  });
});

describe("san: 増減とクランプ", () => {
  test("CH-51 0 で止まる（3 から 5 減らすと delta −3）", () => {
    const ctx = ctxFor(stateWith(NORMAL, 3));
    const ch = ctx.state.party[NORMAL]!;
    const r = loseSan(ctx, ch, 5);
    expect(r).toMatchObject({ from: 3, to: 0, delta: -3, stageBefore: "confused", stageAfter: "broken", dropped: true });
    expect(ch.san).toBe(0);
    expect(ctx.events).toEqual([
      { kind: "sanChanged", id: ch.id, delta: -3, san: 0 },
      { kind: "message", key: "san.broken", params: { name: ch.name } },
    ]);
    expectKnownStringKeys(ctx.events);
  });

  test("CH-52 増加は sanMax で止まる。変化が 0 ならイベントを出さない", () => {
    const ctx = ctxFor(stateWith(NORMAL, 98));
    const ch = ctx.state.party[NORMAL]!;
    const r = gainSan(ctx, ch, 5);
    expect(r).toMatchObject({ from: 98, to: 100, delta: 2, dropped: false });
    expect(ctx.events).toEqual([{ kind: "sanChanged", id: ch.id, delta: 2, san: 100 }]);
    const r2 = gainSan(ctx, ch, 5);
    expect(r2).toMatchObject({ from: 100, to: 100, delta: 0, dropped: false });
    expect(ctx.events.length).toBe(1);
  });

  test("CH-53 虚脱（0）中は gainSan で増えない", () => {
    const ctx = ctxFor(stateWith(NORMAL, 0));
    const ch = ctx.state.party[NORMAL]!;
    const r = gainSan(ctx, ch, 10);
    expect(r).toMatchObject({ from: 0, to: 0, delta: 0, stageBefore: "broken", stageAfter: "broken", dropped: false });
    expect(applySanValue(ctx, ch, 4).delta).toBe(0);
    expect(ch.san).toBe(0);
    expect(ctx.events).toEqual([]);
  });

  test("CH-53 loseSan と gainSan は負や非有限の amount で Error を投げ、san もイベントも変えない", () => {
    const ctx = ctxFor(stateWith(NORMAL, 0));
    const ch = ctx.state.party[NORMAL]!;
    // 負の減少で虚脱から増える、という迂回を許さない
    expect(() => loseSan(ctx, ch, -5)).toThrow(Error);
    expect(() => loseSan(ctx, ch, Number.NaN)).toThrow(Error);
    expect(() => loseSan(ctx, ch, Number.POSITIVE_INFINITY)).toThrow(Error);
    ch.san = 50;
    // 負の増加で耐性なしに減る、という迂回も許さない
    expect(() => gainSan(ctx, ch, -5)).toThrow(Error);
    expect(() => gainSan(ctx, ch, Number.NaN)).toThrow(Error);
    expect(ch.san).toBe(50);
    expect(ctx.events).toEqual([]);
    // 0 は受け付ける（変化なし）
    expect(loseSan(ctx, ch, 0).delta).toBe(0);
    expect(gainSan(ctx, ch, 0).delta).toBe(0);
  });

  test("TW-02/CH-52 restoreSan は 0 からでも sanMax に戻す", () => {
    const ctx = ctxFor(stateWith(NORMAL, 0, 80));
    const ch = ctx.state.party[NORMAL]!;
    const r = restoreSan(ctx, ch);
    expect(r).toMatchObject({ from: 0, to: 80, delta: 80, stageBefore: "broken", stageAfter: "normal", dropped: false });
    expect(ctx.events).toEqual([{ kind: "sanChanged", id: ch.id, delta: 80, san: 80 }]);
    // 満タンなら何も出ない
    expect(restoreSan(ctx, ch).delta).toBe(0);
    expect(ctx.events.length).toBe(1);
  });

  test("CH-53 段階が下がったときだけ message san.*", () => {
    const ctx = ctxFor(stateWith(NORMAL, 50));
    const ch = ctx.state.party[NORMAL]!;
    // 50 → 20: normal から confused へ（uneasy を飛ばす）。message は san.confused の 1 件だけ
    const down = loseSan(ctx, ch, 30);
    expect(down).toMatchObject({ stageBefore: "normal", stageAfter: "confused", dropped: true });
    expect(ctx.events).toEqual([
      { kind: "sanChanged", id: ch.id, delta: -30, san: 20 },
      { kind: "message", key: "san.confused", params: { name: ch.name } },
    ]);
    // 同じ段階の中での減少（20 → 18）は message なし
    ctx.events.length = 0;
    expect(loseSan(ctx, ch, 2).dropped).toBe(false);
    expect(ctx.events.map((e) => e.kind)).toEqual(["sanChanged"]);
    // 上がったとき（18 → 30: confused → uneasy）は message を出さない
    ctx.events.length = 0;
    const up = gainSan(ctx, ch, 12);
    expect(up).toMatchObject({ stageBefore: "confused", stageAfter: "uneasy", dropped: false });
    expect(ctx.events.map((e) => e.kind)).toEqual(["sanChanged"]);
    // normal → uneasy は san.uneasy
    const ctx2 = ctxFor(stateWith(NORMAL, 50));
    loseSan(ctx2, ctx2.state.party[NORMAL]!, 1);
    expect(ctx2.events.filter((e) => e.kind === "message").map((e) => (e.kind === "message" ? e.key : ""))).toEqual([
      "san.uneasy",
    ]);
    expectKnownStringKeys([...ctx.events, ...ctx2.events]);
    expect(["san.uneasy", "san.confused", "san.broken"].every((k) => k in data.strings)).toBe(true);
  });

  test("CH-51 applySanValue: −5 は耐性なしで 5 減る。+4 は増える", () => {
    const ctx = ctxFor(stateWith(CAUTIOUS, 60));
    const ch = ctx.state.party[CAUTIOUS]!;
    // cautious でも耐性は掛からない（trap 0.5 / allyInjury 0.5 があっても 5 減る）
    expect(applySanValue(ctx, ch, -5)).toMatchObject({ from: 60, to: 55, delta: -5 });
    expect(applySanValue(ctx, ch, 4)).toMatchObject({ from: 55, to: 59, delta: 4 });
    expect(applySanValue(ctx, ch, 0)).toMatchObject({ from: 59, to: 59, delta: 0 });
    expect(ctx.events).toEqual([
      { kind: "sanChanged", id: ch.id, delta: -5, san: 55 },
      { kind: "sanChanged", id: ch.id, delta: 4, san: 59 },
    ]);
  });

  test("CH-50 san.ts は rng を消費しない", () => {
    const ctx = ctxFor(stateWith(RECKLESS, 60));
    const rng0 = JSON.stringify(ctx.state.rng);
    const ch = ctx.state.party[RECKLESS]!;
    loseSan(ctx, ch, 4, ["fear"]);
    loseSan(ctx, ch, 50, ["trap", "allyInjury"]);
    gainSan(ctx, ch, 3);
    applySanValue(ctx, ch, -2);
    applySanValue(ctx, ch, 2);
    restoreSan(ctx, ch);
    expect(JSON.stringify(ctx.state.rng)).toBe(rng0);
  });
});
