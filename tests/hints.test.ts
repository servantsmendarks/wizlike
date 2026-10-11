// UI-76（M16）: 一度きりの GM の一言（progress.hints と tellHintOnce）と、その契機 3 つ（DG-37・CB-06・CH-80）。
import { describe, expect, test } from "vitest";
import { HINT_IDS } from "../src/core/data";
import { cloneRng, nextUint32 } from "../src/core/rng";
import { startBattle } from "../src/core/rules/combat";
import { expFor } from "../src/core/rules/growth";
import { tellHintOnce } from "../src/core/rules/hints";
import { returnToTown } from "../src/core/rules/town";
import { classOf, cloneState, makeContext } from "../src/core/state";
import type { Command, GameEvent, GameState } from "../src/core/types";
import { dataWith, dived, exec, withBattle } from "./helpers/battle";
import { data, expectKnownStringKeys, newGame } from "./helpers/core";
import { kinsokuLines } from "./helpers/wrap";

const S = data.strings;
const ENTER_D01: Command = { type: "dungeon.enter", dungeonId: "d01" };
const keysOf = (events: readonly GameEvent[]): string[] => events.map((e) => (e.kind === "message" ? `message:${e.key}` : e.kind));
const hintKeys = (events: readonly GameEvent[]): string[] =>
  events.flatMap((e) => (e.kind === "message" && e.key.startsWith("hint.") ? [e.key] : []));

describe("UI-76 一度きりの GM の一言（M16）", () => {
  test("UI-76/UI-20/UI-78/DG-46/DG-45/CB-06 HINT_IDS は dungeonFirst / sanUnknown / levelUpMark / lostExits / dungeonTerms（M18）/ waitEnemy（M19）。文は strings の hint.<id> にあり、会話の箱の 1 行 28 字で 2 行以内（禁則つき）、差し込みなし", () => {
    expect([...HINT_IDS]).toEqual(["dungeonFirst", "sanUnknown", "levelUpMark", "lostExits", "dungeonTerms", "waitEnemy"]);
    for (const id of HINT_IDS) {
      const t = S[`hint.${id}`];
      expect(t, id).toBeDefined();
      expect(kinsokuLines(t!, 28).length, `${id}: ${t}`).toBeLessThanOrEqual(2);
      expect(t!).not.toMatch(/\{\w+\}/);
    }
    // M20（UI-20 / UI-76。テストプレイ v4 の C-4 #5）: 線画の下の印の □（扉）も説明する。会話の箱の 2 行
    expect(S["hint.dungeonFirst"]).toBe("奥へ伸びる線が道、正面の四角は壁。下の三角は口、□は扉。");
    expect(kinsokuLines(S["hint.dungeonFirst"]!, 28)).toEqual(["奥へ伸びる線が道、正面の四角は壁。下の三角は口、□は扉。"]); // M20 レビュー: ▷ は同梱フォント（美咲ゴシック第2）に無いので「三角」と書く
    expect(S["hint.dungeonTerms"]).toBe("分からない言葉は、設定の「用語」で引ける。");
    expect(S["hint.sanUnknown"]).toBe("正体の分からない敵に会うと正気が削れる。何度か戦ううちに正体が分かる。");
    // M19（D-7。CB-06）: 1 回の戦闘ではなく何度か戦ううちに分かること（識別は毎ラウンドの判定と通算の撃破数）。会話の箱の 2 行
    expect(kinsokuLines(S["hint.sanUnknown"]!, 28)).toEqual(["正体の分からない敵に会うと正気が削れる。何度か戦ううちに", "正体が分かる。"]);
    // M18（CB-05 / CB-06）: 敵に「鑑定」の語を使わない（品の鑑定と分ける）
    expect(S["hint.sanUnknown"]!).not.toContain("鑑定");
    expect(S["hint.levelUpMark"]).toBe("名前の横の↑は、宿で上がれる印だ。");
    // M20（UI-78 / UI-25 / DG-46。テストプレイ v4 の B-4 #11）: 未踏の口の印を押せば歩けることを語る。1 行に収まる
    expect(S["hint.lostExits"]).toBe("地図の未踏の口を押せば、そこまで歩く。");
    expect(kinsokuLines(S["hint.lostExits"]!, 28)).toHaveLength(1);
    // DG-45 / UI-53（M19）: 「敵を待つ」が何をする操作か（SAN が減ることも）を初回に語る
    expect(S["hint.waitEnemy"]).toBe("その場で一巡り待ち、敵を呼び寄せる。正気が少し削れる。");
  });

  test("UI-76 tellHintOnce: hints に無ければ message hint.<id>（params なし）を出して積み真。2 回目は何も出さず偽。乱数は使わない", () => {
    const ctx = makeContext(cloneState(newGame(1)), data);
    const rng = cloneRng(ctx.state.rng);
    expect(ctx.state.progress.hints).toEqual([]);
    expect(tellHintOnce(ctx, "sanUnknown")).toBe(true);
    expect(ctx.events).toEqual([{ kind: "message", key: "hint.sanUnknown" }]);
    expect(ctx.state.progress.hints).toEqual(["sanUnknown"]);
    expect(tellHintOnce(ctx, "sanUnknown")).toBe(false);
    expect(tellHintOnce(ctx, "levelUpMark")).toBe(true);
    expect(ctx.events).toHaveLength(2);
    expect(ctx.state.progress.hints).toEqual(["sanUnknown", "levelUpMark"]);
    expect(ctx.state.rng).toEqual(rng);
    expectKnownStringKeys(ctx.events);
  });
});

describe("DG-37/UI-76 ゲームで最初の入場の一言（M16）", () => {
  test("DG-37/UI-76 ゲームで最初の入場（enteredDungeons が空）だけ dungeon.enter の直後に hint.dungeonFirst、続けて hint.dungeonTerms（M18）。2 回目の入場・別のダンジョンへの初回入場では出さない。乱数は増やさない", () => {
    const s0 = cloneState(newGame(1));
    s0.progress.unlockedDungeons = ["d01", "d02"];
    const m = cloneRng(s0.rng);
    nextUint32(m);
    const r = exec(s0, ENTER_D01);
    expect(keysOf(r.events)).toEqual(["screen", "message:dungeon.enter", "message:hint.dungeonFirst", "message:hint.dungeonTerms"]);
    expect(r.state.progress.hints).toEqual(["dungeonFirst", "dungeonTerms"]);
    expect(r.state.rng).toEqual(m);
    // 街へ戻って d01 にもう一度、d02 に初めて: どちらも出さない
    const back = makeContext(cloneState(r.state), data);
    returnToTown(back, "dungeon.return");
    expect(hintKeys(exec(back.state, ENTER_D01).events)).toEqual([]);
    expect(hintKeys(exec(back.state, { type: "dungeon.enter", dungeonId: "d02" }).events)).toEqual([]);
  });

  test("DG-37/UI-76 enteredDungeons が空でも hints に dungeonFirst・dungeonTerms があれば出さない（dungeonFirst だけなら dungeonTerms だけ。M18）。hints が空でも enteredDungeons があれば（v7 からの移行など）出さない", () => {
    const s = cloneState(newGame(1));
    s.progress.hints = ["dungeonFirst", "dungeonTerms"];
    expect(hintKeys(exec(s, ENTER_D01).events)).toEqual([]);
    // M18 より前の保存（dungeonFirst だけ積んである）で最初の入場をまだしていなければ、dungeonTerms だけ出る
    const old = cloneState(newGame(1));
    old.progress.hints = ["dungeonFirst"];
    expect(hintKeys(exec(old, ENTER_D01).events)).toEqual(["hint.dungeonTerms"]);
    const migrated = cloneState(newGame(1));
    migrated.progress.enteredDungeons = ["d01"];
    const r = exec(migrated, ENTER_D01);
    expect(hintKeys(r.events)).toEqual([]);
    expect(r.state.progress.hints).toEqual([]);
  });
});

describe("CB-06/UI-76 正体不明の敵の SAN の一言（M16）", () => {
  const start = (s: GameState, identified: boolean) => {
    const st = cloneState(s);
    if (identified) st.bestiary["giant_rat"] = { kills: 0, identified: true };
    const ctx = makeContext(st, dataWith());
    startBattle(ctx, { kind: "random", inRoom: false }, [{ monsterId: "giant_rat", count: 2 }]);
    return ctx;
  };

  test("CB-06/UI-76 初めて未鑑定のグループと会うとき、battle.unidentified の直後・sanChanged の前に hint.sanUnknown。2 回目の戦闘では出さない", () => {
    const first = start(dived(1), false);
    const ks = keysOf(first.events);
    const i = ks.indexOf("message:battle.unidentified");
    expect(ks.slice(i, i + 3)).toEqual(["message:battle.unidentified", "message:hint.sanUnknown", "sanChanged"]);
    expect(first.state.progress.hints).toEqual(["dungeonFirst", "dungeonTerms", "sanUnknown"]);
    // 2 回目（同じ hints を持つ state）では battle.unidentified と SAN は出るが、一言は出ない
    const again = cloneState(dived(1));
    again.progress.hints = [...first.state.progress.hints];
    const second = start(again, false);
    expect(keysOf(second.events)).toContain("message:battle.unidentified");
    expect(keysOf(second.events)).toContain("sanChanged");
    expect(hintKeys(second.events)).toEqual([]);
  });

  test("CB-06/UI-76 鑑定済み（k = 0）の遭遇では出さず、hints にも積まない", () => {
    const ctx = start(dived(1), true);
    expect(keysOf(ctx.events)).not.toContain("message:battle.unidentified");
    expect(hintKeys(ctx.events)).toEqual([]);
    expect(ctx.state.progress.hints).toEqual(["dungeonFirst", "dungeonTerms"]);
  });
});

describe("CH-80/UI-76 ↑（レベルアップ可）の一言（M16）", () => {
  const AUTO_ON: Command = { type: "battle.auto", on: true };
  const RESOLVE: Command = { type: "battle.resolve" };
  /** 麻痺した大ネズミ 1 体（HP 1）にオートで勝つまで回す。exps は c1.. の exp（無い者は 0） */
  function win(s0: GameState, exps: number[]): { state: GameState; events: GameEvent[] } {
    const d = dataWith({ combat: { hitMin: 100, hitMax: 100 } });
    const s1 = withBattle(s0, [{ monsterId: "giant_rat", hps: [1], status: [["paralysis"]] }], { identified: ["giant_rat"] });
    s1.party.forEach((c, i) => (c.exp = exps[i] ?? 0));
    let s = exec(s1, AUTO_ON, d).state;
    const events: GameEvent[] = [];
    for (let n = 0; s.battle !== null && n < 20; n++) {
      if (!s.battle.auto) s = exec(s, AUTO_ON, d).state;
      const r = exec(s, RESOLVE, d);
      events.push(...r.events);
      s = r.state;
    }
    expect(s.battle).toBeNull();
    return { state: s, events };
  }
  const need = (s: GameState, i: number): number => expFor(2, classOf(data, s.party[i]!.classId), data.config);

  test("CH-80/UI-76 勝利の経験値で↑が偽 → 真になった者がいれば、battle.exp と levelUpReady（M20 D-8。UI-69）の後に hint.levelUpMark（一度だけ）", () => {
    const s0 = dived(1);
    const { state, events } = win(s0, [need(s0, 0) - 1]);
    expect(state.party[0]!.exp).toBeGreaterThanOrEqual(need(s0, 0));
    const ks = keysOf(events);
    const i = ks.indexOf("message:battle.exp");
    expect(ks[i + 1]).toBe("levelUpReady");
    expect(ks[i + 2]).toBe("message:hint.levelUpMark");
    expect(state.progress.hints).toContain("levelUpMark");
    expectKnownStringKeys(events);
    // 2 回目: 別の者が↑になっても出さない
    const again = win(state, [state.party[0]!.exp, need(state, 1) - 1]);
    expect(again.state.party[1]!.exp).toBeGreaterThanOrEqual(need(state, 1));
    expect(hintKeys(again.events)).toEqual([]);
  });

  test("CH-80/UI-76 もともと↑の者しか真にならない（偽 → 真が無い）勝利、誰も↑にならない勝利では出さない", () => {
    const s0 = dived(1);
    const already = win(s0, [need(s0, 0) + 10]);
    expect(hintKeys(already.events)).toEqual([]);
    expect(already.state.progress.hints).not.toContain("levelUpMark");
    const none = win(s0, []);
    expect(hintKeys(none.events)).toEqual([]);
    expect(none.state.progress.hints).not.toContain("levelUpMark");
  });
});
