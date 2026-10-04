// 自分で作る（UI-62 / CH-06。M5.5）の純粋な部分: 下書きの状態機械、描く内容、キー。
// 作成中の乱数は固定の種の RngState を渡し、鏡の rng（cloneRng して rollBonus を同じ順に引く）で期待値を作る。
import { describe, expect, test } from "vitest";
import { STAT_KEYS, type StatKey } from "../src/core/data";
import { execute, createInitialState } from "../src/core/engine";
import { cloneRng, createRng, type RngState } from "../src/core/rng";
import { rollBonus, statAllocation } from "../src/core/rules/creation";
import {
  buildCustomSetup,
  customKeyChoice,
  customStep,
  customView,
  initialDraft,
  type CustomChoice,
  type CustomDraft,
  type CustomResult,
} from "../src/presenter/views/custom-creation";
import { data } from "./helpers/core";

const S = data.strings;

function draftOf(r: CustomResult): CustomDraft {
  if (r.kind !== "draft") throw new Error(`expected draft, got ${r.kind}`);
  return r.draft;
}

function step(d: CustomDraft, c: CustomChoice, rng: RngState): CustomDraft {
  return draftOf(customStep(d, c, data, rng));
}

/** 能力値の段で、keys の順に増やせるだけ増やして残りを 0 にする（可否は statAllocation の値で見る） */
function spendAll(d: CustomDraft, rng: RngState, keys: readonly StatKey[] = STAT_KEYS): CustomDraft {
  let cur = d;
  for (const k of keys) {
    for (;;) {
      const m = cur.members[cur.index]!;
      const row = statAllocation(m.raceId!, m.stats!, m.bonus, data).rows.find((r) => r.key === k)!;
      if (!row.canInc) break;
      cur = step(cur, { kind: "inc", key: k }, rng);
    }
  }
  return cur;
}

/** 1 人分: 人間 → 力から配分 → 戦士 →（リーダー以外は 慎重）→ 名前 */
function makeOne(d: CustomDraft, rng: RngState, name: string): CustomDraft {
  let cur = step(d, { kind: "race", raceId: "human" }, rng);
  cur = spendAll(cur, rng);
  cur = step(cur, { kind: "next" }, rng);
  cur = step(cur, { kind: "class", classId: "fighter" }, rng);
  if (cur.step === "personality") cur = step(cur, { kind: "personality", value: "cautious" }, rng);
  return step(cur, { kind: "name", name }, rng);
}

describe("自分で作る（UI-62 / CH-06）", () => {
  test("UI-62 initialDraft: 1 人目の種族から。名前は prototypeParty の defaultName、性格はリーダー null・以降は配列順に巡回", () => {
    const d = initialDraft(data);
    expect(d.index).toBe(0);
    expect(d.step).toBe("race");
    expect(d.members.map((m) => m.name)).toEqual(data.config.prototypeParty.members.map((m) => m.defaultName));
    expect(d.members.map((m) => m.personality)).toEqual([null, "cautious", "reckless", "greedy", "normal", "cautious"]);
    expect(d.members.every((m) => m.raceId === null && m.stats === null && m.classId === null)).toBe(true);
  });

  test("UI-62 種族 → 能力値 → 職業 → 性格 → 名前 を 6 人繰り返し、確認の 始める で CustomPartySetup を返す（固定の種の rng。game.new が受け付ける）", () => {
    const rng = createRng(7);
    const mirror = cloneRng(rng);
    let d = initialDraft(data);
    const names = ["一", "二", "三", "四", "五", "六"];
    const bonuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      expect(d.index).toBe(i);
      expect(d.step).toBe("race");
      // 種族を選ぶと rollBonus を 1 回引き、能力値は基礎値から（鏡の rng と同じ値）
      const after = step(d, { kind: "race", raceId: "human" }, rng);
      const want = rollBonus(mirror, data.config.creation);
      expect(after.members[i]!.bonus).toBe(want);
      expect(after.members[i]!.stats).toEqual(data.races.find((r) => r.id === "human")!.baseStats);
      expect(after.step).toBe("stats");
      bonuses.push(want);
      d = makeOne(d, createRng(999), names[i]!); // makeOne の種族の選択は別の rng（ここでは値を見ない）
    }
    expect(d.step).toBe("confirm");
    expect(d.index).toBe(5);
    expect(rng).toEqual(mirror);
    const r = customStep(d, { kind: "start" }, data, rng);
    expect(r.kind).toBe("start");
    if (r.kind !== "start") return;
    expect(r.setup.kind).toBe("custom");
    expect(r.setup.members.map((m) => m.name)).toEqual(names);
    expect(r.setup.members.map((m) => m.personality)).toEqual([null, "cautious", "cautious", "cautious", "cautious", "cautious"]);
    expect(r.setup.members.every((m) => m.raceId === "human" && m.classId === "fighter")).toBe(true);
    const g = execute(createInitialState(1, data), { type: "game.new", party: r.setup }, data);
    expect(g.events).toEqual([{ kind: "screen", to: "town" }]);
    expect(g.state.party.map((c) => c.name)).toEqual(names);
    expect(bonuses.every((b) => b >= 8)).toBe(true);
  });

  test("UI-62 リーダー（1 人目）は性格の段を飛ばす。戻るは名前 → 職業", () => {
    const rng = createRng(1);
    let d = step(initialDraft(data), { kind: "race", raceId: "human" }, rng);
    d = spendAll(d, rng);
    d = step(d, { kind: "next" }, rng);
    d = step(d, { kind: "class", classId: "fighter" }, rng);
    expect(d.step).toBe("name");
    expect(customStep(d, { kind: "personality", value: "normal" }, data, rng)).toEqual({ kind: "draft", draft: d });
    expect(step(d, { kind: "back" }, rng).step).toBe("class");
    // 2 人目は性格の段がある
    const d2 = makeOne(initialDraft(data), rng, "アキ");
    let e = step(d2, { kind: "race", raceId: "human" }, rng);
    e = spendAll(e, rng);
    e = step(e, { kind: "next" }, rng);
    e = step(e, { kind: "class", classId: "fighter" }, rng);
    expect(e.step).toBe("personality");
    expect(customStep(e, { kind: "personality", value: null }, data, rng)).toEqual({ kind: "draft", draft: e });
    e = step(e, { kind: "personality", value: "random" }, rng);
    expect(e.step).toBe("name");
    expect(e.members[1]!.personality).toBe("random");
    expect(step(e, { kind: "back" }, rng).step).toBe("personality");
  });

  test("UI-62 戻るは 1 つ前の段へ（0 人目の種族では exit、k 人目の種族では k−1 人目の名前、能力値 → 種族、職業 → 能力値（配分は残す）、確認 → 6 人目の名前）", () => {
    const rng = createRng(3);
    const d0 = initialDraft(data);
    expect(customStep(d0, { kind: "back" }, data, rng)).toEqual({ kind: "exit" });
    let d = step(d0, { kind: "race", raceId: "elf" }, rng);
    expect(step(d, { kind: "back" }, rng)).toMatchObject({ index: 0, step: "race" });
    d = spendAll(d, rng, ["iq", "agi", "str", "pie", "vit", "luk"]);
    d = step(d, { kind: "next" }, rng);
    expect(d.step).toBe("class");
    const stats = d.members[0]!.stats;
    const back = step(d, { kind: "back" }, rng);
    expect(back.step).toBe("stats");
    expect(back.members[0]!.stats).toEqual(stats);
    // 1 人目を作り終えると 2 人目の種族。戻ると 1 人目の名前
    const one = makeOne(initialDraft(data), rng, "アキ");
    expect(one).toMatchObject({ index: 1, step: "race" });
    expect(step(one, { kind: "back" }, rng)).toMatchObject({ index: 0, step: "name" });
    // 確認から戻ると 6 人目の名前
    let all = initialDraft(data);
    for (let i = 0; i < 6; i++) all = makeOne(all, rng, `N${i}`);
    expect(all.step).toBe("confirm");
    expect(step(all, { kind: "back" }, rng)).toMatchObject({ index: 5, step: "name" });
  });

  test("UI-62/CH-11 振り直しは bonus を引き直し能力値を基礎値に戻す。complete でなければ次へは進まない", () => {
    const rng = createRng(11);
    const mirror = cloneRng(rng);
    let d = step(initialDraft(data), { kind: "race", raceId: "dwarf" }, rng);
    rollBonus(mirror, data.config.creation);
    d = step(d, { kind: "inc", key: "str" }, rng);
    expect(d.members[0]!.stats!.str).toBe(11);
    // 残りがあるうちは 次へ は同じ下書き
    expect(customStep(d, { kind: "next" }, data, rng)).toEqual({ kind: "draft", draft: d });
    const view = customView(d, data, S);
    expect(view.buttons.b).toMatchObject({ dim: true });
    const re = step(d, { kind: "reroll" }, rng);
    expect(re.members[0]!.bonus).toBe(rollBonus(mirror, data.config.creation));
    expect(re.members[0]!.stats).toEqual(data.races.find((r) => r.id === "dwarf")!.baseStats);
    expect(rng).toEqual(mirror);
    // 基礎値未満には下げられない（同じ下書き）
    expect(customStep(re, { kind: "dec", key: "str" }, data, rng)).toEqual({ kind: "draft", draft: re });
    const done = spendAll(re, rng);
    expect(customView(done, data, S).buttons.b).toMatchObject({ dim: false });
    expect(step(done, { kind: "next" }, rng).step).toBe("class");
  });

  test("UI-62/CH-21 条件を満たさない職業は選べず（dim）、配分を変えて条件を外れた職業は 次へ で消える", () => {
    const rng = createRng(5);
    let d = step(initialDraft(data), { kind: "race", raceId: "human" }, rng);
    d = spendAll(d, rng, ["str", "vit", "iq", "pie", "agi", "luk"]);
    d = step(d, { kind: "next" }, rng);
    const view = customView(d, data, S);
    const lord = view.rows.find((r) => r.choice.kind === "class" && r.choice.classId === "lord")!;
    expect(lord.dim).toBe(true);
    expect(customStep(d, { kind: "class", classId: "lord" }, data, rng)).toEqual({ kind: "draft", draft: d });
    const fighterRow = view.rows.find((r) => r.choice.kind === "class" && r.choice.classId === "fighter")!;
    expect(fighterRow.dim).toBe(false);
    expect(fighterRow.lines).toEqual(["戦士", "力11"]);
    d = step(d, { kind: "class", classId: "fighter" }, rng);
    expect(d.members[0]!.classId).toBe("fighter");
    expect(d.step).toBe("name"); // リーダーは性格を飛ばす
    // 名前 → 職業 → 能力値に戻って str を 10 まで下げ、iq に回すと戦士の条件（str 11）を外れ、次へ で職業が消える
    let s = step(step(d, { kind: "back" }, rng), { kind: "back" }, rng);
    expect(s.step).toBe("stats");
    expect(customView(s, data, S).rows).toEqual([]); // 能力値の段（一覧の行は無い）
    while (s.members[0]!.stats!.str > 10) s = step(s, { kind: "dec", key: "str" }, rng);
    s = spendAll(s, rng, ["iq", "pie", "agi", "luk"]);
    const c = step(s, { kind: "next" }, rng);
    expect(c.step).toBe("class");
    expect(c.members[0]!.classId).toBeNull();
  });

  test("UI-62 同じ種族を選び直すと配分と職業を残し（乱数も引かない）、違う種族なら基礎値から振り直して職業を消す", () => {
    const rng = createRng(9);
    let d = step(initialDraft(data), { kind: "race", raceId: "human" }, rng);
    d = spendAll(d, rng);
    d = step(d, { kind: "next" }, rng);
    d = step(d, { kind: "class", classId: "fighter" }, rng);
    const atRace = step(step(step(d, { kind: "back" }, rng), { kind: "back" }, rng), { kind: "back" }, rng);
    expect(atRace.step).toBe("race");
    const before = cloneRng(rng);
    const same = step(atRace, { kind: "race", raceId: "human" }, rng);
    expect(rng).toEqual(before);
    expect(same.step).toBe("stats");
    expect(same.members[0]).toEqual(d.members[0]);
    const other = step(atRace, { kind: "race", raceId: "gnome" }, rng);
    expect(other.members[0]!.stats).toEqual(data.races.find((r) => r.id === "gnome")!.baseStats);
    expect(other.members[0]!.classId).toBeNull();
    expect(rng).not.toEqual(before);
  });

  test("UI-62/CH-05 名前が 1〜6 文字でなければ invalidName（打った名前は下書きに残す）。正しければ次へ", () => {
    const rng = createRng(2);
    let d = step(initialDraft(data), { kind: "race", raceId: "human" }, rng);
    d = spendAll(d, rng);
    d = step(d, { kind: "next" }, rng);
    d = step(d, { kind: "class", classId: "fighter" }, rng);
    const bad = customStep(d, { kind: "name", name: "あいうえおかき" }, data, rng);
    expect(bad.kind).toBe("invalidName");
    if (bad.kind !== "invalidName") return;
    expect(bad.draft.step).toBe("name");
    expect(bad.draft.members[0]!.name).toBe("あいうえおかき");
    expect(customStep(d, { kind: "name", name: "   " }, data, rng).kind).toBe("invalidName");
    const ok = step(d, { kind: "name", name: " アキ " }, rng);
    expect(ok).toMatchObject({ index: 1, step: "race" });
    expect(ok.members[0]!.name).toBe(" アキ "); // trim は core（game.new）
  });

  test("UI-62 customView: 見出し（リーダー・n 人目・確認）、種族の基礎値、能力値の残り、性格は 4 つ＋おまかせ、確認の 6 行", () => {
    const rng = createRng(4);
    const d0 = initialDraft(data);
    const v0 = customView(d0, data, S);
    expect(v0.heading).toBe("1人目（リーダー）　種族");
    expect(v0.rows.map((r) => r.lines[0])).toEqual(data.races.map((r) => r.name));
    expect(v0.rows[0]!.lines[1]).toBe("力8 知恵8 信仰心5 生命力8 素早さ8 運9");
    expect(v0.buttons).toMatchObject({ a: null, b: null, c: { label: "戻る", choice: { kind: "back" } } });
    const st = step(d0, { kind: "race", raceId: "human" }, rng);
    const vs = customView(st, data, S);
    expect(vs.heading).toBe("1人目（リーダー）　能力値");
    expect(vs.summary).toBe("人間");
    expect(vs.stats!.rows.map((r) => r.label)).toEqual(["力", "知恵", "信仰心", "生命力", "素早さ", "運"]);
    expect(vs.stats!.remaining).toBe(`残り ${st.members[0]!.bonus}　ボーナス ${st.members[0]!.bonus}`);
    expect(vs.buttons.a).toMatchObject({ label: "振り直す", choice: { kind: "reroll" } });
    expect(vs.buttons.b).toMatchObject({ label: "次へ", dim: true });
    const second = makeOne(d0, rng, "アキ");
    let p = step(second, { kind: "race", raceId: "human" }, rng);
    p = spendAll(p, rng);
    p = step(p, { kind: "next" }, rng);
    p = step(p, { kind: "class", classId: "fighter" }, rng);
    const vp = customView(p, data, S);
    expect(vp.heading).toBe("2人目　性格");
    expect(vp.summary).toBe("人間 戦士");
    expect(vp.rows.map((r) => r.lines[0])).toEqual([...data.personalities.map((x) => x.name), "おまかせ"]);
    expect(vp.rows.filter((r) => r.selected).map((r) => r.lines[0])).toEqual(["慎重"]);
    let all = d0;
    for (let i = 0; i < 6; i++) all = makeOne(all, rng, `N${i}`);
    const vc = customView(all, data, S);
    expect(vc.heading).toBe("この六人で始める？");
    expect(vc.confirm).toHaveLength(6);
    expect(vc.confirm[0]).toBe("1 N0 人間 戦士 リーダー");
    expect(vc.confirm[1]).toBe("2 N1 人間 戦士 慎重");
    expect(vc.buttons.b).toMatchObject({ label: "始める", choice: { kind: "start" } });
  });

  test("UI-33/UI-62 キー: Esc は戻る、数字 n は n 番目の行（dim は null）、Enter は先頭の選べる行・能力値は次へ・名前は入力で次へ・確認は始める", () => {
    const rng = createRng(6);
    const d0 = initialDraft(data);
    const v0 = customView(d0, data, S);
    expect(customKeyChoice("back", v0, "race", "")).toEqual({ kind: "back" });
    expect(customKeyChoice("confirm", v0, "race", "")).toEqual({ kind: "race", raceId: "human" });
    expect(customKeyChoice({ menu: 2 }, v0, "race", "")).toEqual({ kind: "race", raceId: "dwarf" });
    expect(customKeyChoice({ menu: 8 }, v0, "race", "")).toBeNull();
    expect(customKeyChoice("forward", v0, "race", "")).toBeNull();
    let d = step(d0, { kind: "race", raceId: "human" }, rng);
    expect(customKeyChoice("confirm", customView(d, data, S), "stats", "")).toBeNull(); // 次へが dim
    expect(customKeyChoice({ menu: 0 }, customView(d, data, S), "stats", "")).toBeNull();
    d = spendAll(d, rng, ["str", "vit", "iq", "pie", "agi", "luk"]);
    expect(customKeyChoice("confirm", customView(d, data, S), "stats", "")).toEqual({ kind: "next" });
    d = step(d, { kind: "next" }, rng);
    const vc = customView(d, data, S);
    // 先頭の選べる職業（戦士）。君主（6 番目 = menu 5）は dim
    expect(customKeyChoice("confirm", vc, "class", "")).toEqual({ kind: "class", classId: "fighter" });
    expect(customKeyChoice({ menu: 5 }, vc, "class", "")).toBeNull();
    d = step(d, { kind: "class", classId: "fighter" }, rng);
    expect(customKeyChoice("confirm", customView(d, data, S), "name", "アキ")).toEqual({ kind: "name", name: "アキ" });
    expect(customKeyChoice({ menu: 0 }, customView(d, data, S), "name", "アキ")).toBeNull();
    let all = d0;
    for (let i = 0; i < 6; i++) all = makeOne(all, rng, `N${i}`);
    expect(customKeyChoice("confirm", customView(all, data, S), "confirm", "")).toEqual({ kind: "start" });
  });

  test("UI-62 性格の段の行は各行が 27 字以内（行の中身 224 − 枠 2 − 左余白 4 = 218px ÷ 全角 8px）。2 行目は personalities.json の shortDescription", () => {
    const rng = createRng(4);
    let p = makeOne(initialDraft(data), rng, "アキ");
    p = step(p, { kind: "race", raceId: "human" }, rng);
    p = spendAll(p, rng);
    p = step(p, { kind: "next" }, rng);
    p = step(p, { kind: "class", classId: "fighter" }, rng);
    expect(p.step).toBe("personality");
    const v = customView(p, data, S);
    expect(v.rows.slice(0, data.personalities.length).map((r) => r.lines[1])).toEqual(data.personalities.map((x) => x.shortDescription));
    for (const r of v.rows) for (const line of r.lines) expect([...line].length, line).toBeLessThanOrEqual(27);
  });

  test("UI-62 buildCustomSetup は決まっていない人がいれば null", () => {
    expect(buildCustomSetup(initialDraft(data))).toBeNull();
  });

  test("UI-62 自分で作るの文言が strings にある", () => {
    for (const k of [
      "custom.heading",
      "custom.headingLeader",
      "custom.step.race",
      "custom.step.stats",
      "custom.step.class",
      "custom.step.personality",
      "custom.step.name",
      "custom.step.confirm",
      "custom.statPair",
      "custom.remaining",
      "custom.reroll",
      "custom.next",
      "custom.start",
      "custom.reqNone",
      "custom.confirmRow",
      "custom.leader",
      "custom.rejected",
    ]) {
      expect(S[k], k).toBeTypeOf("string");
    }
  });
});
