// 自分で作る（UI-62 / CH-06。M5.5）の純粋な部分: 下書きの状態機械、描く内容、キー。
// 作成中の乱数は固定の種の RngState を渡し、鏡の rng（cloneRng して rollBonus を同じ順に引く）で期待値を作る。
import { afterEach, describe, expect, test, vi } from "vitest";
import { STAT_KEYS, type StatKey } from "../src/core/data";
import { execute, createInitialState } from "../src/core/engine";
import { cloneRng, createRng, randInt, type RngState } from "../src/core/rng";
import { classOptions, pickAutoRace, pickPersonality, rollBonus, rollBonusParts, statAllocation } from "../src/core/rules/creation";
import {
  CUSTOM_BUTTONS,
  CUSTOM_ERROR,
  CUSTOM_NAME,
  CUSTOM_REMAINING,
  CUSTOM_STAT_DESC,
  customStatRow,
  TOUCH_MIN_LOGICAL,
  type Rect,
} from "../src/presenter/layout";
import {
  buildCustomSetup,
  customButtonRects,
  customKeyChoice,
  customStep,
  customView,
  initialDraft,
  resolveDraftPersonality,
  sameChildren,
  statHoldSpec,
  type CustomChoice,
  type CustomDraft,
  type CustomResult,
} from "../src/presenter/views/custom-creation";
import { data, gameNewEvents } from "./helpers/core";
import { kinsokuLines } from "./helpers/wrap";
import { textUnits } from "../src/presenter/views/party-band";

// 配線の文字列検査は node の fs で読む（@types/node は入れていないので型は手で書く。tap.test と同じ）
const FS_MODULE = "node:fs";
const fs = (await import(/* @vite-ignore */ FS_MODULE)) as { readFileSync(p: URL, enc: "utf8"): string };

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
    expect(g.events).toEqual(gameNewEvents()); // TW-36（M12.5）: screen{town} の後に開始の語り
    expect(g.state.party.map((c) => c.name)).toEqual(names);
    expect(bonuses.every((b) => b >= 8)).toBe(true);
  });

  test("UI-62/UI-51 1 人目（リーダー）の種族の段は、要約の行（見出しの下）に creation.leaderNote を出し、2 人目の種族の段と 1 人目の能力値の段には出さない（M16。B1）", () => {
    const rng = createRng(5);
    const d0 = initialDraft(data);
    const v0 = customView(d0, data, S);
    expect(S["creation.leaderNote"]).toBe("プレイヤーの分身。全滅しても必ず生き返る");
    expect(v0.summary).toBe(S["creation.leaderNote"]);
    // 要約の行は 1 行（幅 232 = 全角 29 字）
    expect(kinsokuLines(v0.summary, 29)).toHaveLength(1);
    // 種族を選んで戻っても、リーダーの種族の段は一行のまま
    const st = step(d0, { kind: "race", raceId: "human" }, rng);
    expect(customView(st, data, S).summary).toBe("人間");
    expect(customView(step(st, { kind: "back" }, rng), data, S).summary).toBe(S["creation.leaderNote"]);
    const d2 = makeOne(initialDraft(data), rng, "アキ");
    expect(d2.index).toBe(1);
    expect(d2.step).toBe("race");
    expect(customView(d2, data, S).summary).not.toBe(S["creation.leaderNote"]);
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
    const bp = st.members[0]!.bonusParts!;
    expect(vs.stats!.remaining).toBe(`残り ${bp.total}　ボーナス ${bp.total}（基本${bp.base}+ダイス${bp.die}${bp.big > 0 ? `+大当り${bp.big}` : ""}）`);
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

  test("UI-62/CH-11 能力値の段の残りの行にボーナスの内訳を出す: 外れは「ボーナス 9（基本7+ダイス2）」、当たりは「ボーナス 19（基本7+ダイス2+大当り10）」（M18 で項の名前）。値は core の rollBonusParts（鏡の rng）", () => {
    const rng = createRng(4);
    const mirror = cloneRng(rng);
    const st = step(initialDraft(data), { kind: "race", raceId: "human" }, rng);
    const p = rollBonusParts(mirror, data.config.creation);
    expect(rng).toEqual(mirror);
    expect(st.members[0]!.bonusParts).toEqual(p);
    expect(st.members[0]!.bonus).toBe(p.total);
    expect(p.big).toBe(0);
    expect(customView(st, data, S).stats!.remaining).toBe(`残り ${p.total}　ボーナス ${p.total}（基本${p.base}+ダイス${p.die}）`);
    // 振り直しも内訳を引き直す（rollBonus と同じ順）
    const re = step(st, { kind: "reroll" }, rng);
    const q = rollBonusParts(mirror, data.config.creation);
    expect(re.members[0]!.bonusParts).toEqual(q);
    expect(re.members[0]!.bonus).toBe(q.total);
    // 当たり（big > 0）は 3 つ目の項を足す。配分した分だけ残りが減る
    const big = { base: 7, die: 2, big: 10, total: 19 };
    const hit: CustomDraft = { ...st, members: st.members.map((m, i) => (i === 0 ? { ...m, bonus: 19, bonusParts: big } : m)) };
    expect(customView(hit, data, S).stats!.remaining).toBe("残り 19　ボーナス 19（基本7+ダイス2+大当り10）");
    const spent = step(hit, { kind: "inc", key: "str" }, rng);
    expect(customView(spent, data, S).stats!.remaining).toBe("残り 18　ボーナス 19（基本7+ダイス2+大当り10）");
    expect(customView({ ...st, members: st.members.map((m, i) => (i === 0 ? { ...m, bonus: 9, bonusParts: { base: 7, die: 2, big: 0, total: 9 } } : m)) }, data, S).stats!.remaining).toBe(
      "残り 9　ボーナス 9（基本7+ダイス2）",
    );
  });

  test("UI-62/CH-11 残りの行は最大の値（残り 21・基本7+ダイス4+大当り10）でも行の幅 224px（全角 28 字。半角 4px・全角 8px で数える）に収まる（M18 で項の名前を足した）", () => {
    const rng = createRng(4);
    const st = step(initialDraft(data), { kind: "race", raceId: "human" }, rng);
    const c = data.config.creation;
    const max = c.bonusBase + c.bonusDie + c.bonusBig;
    const parts = { base: c.bonusBase, die: c.bonusDie, big: c.bonusBig, total: max };
    const v = customView({ ...st, members: st.members.map((m, i) => (i === 0 ? { ...m, bonus: max, bonusParts: parts } : m)) }, data, S);
    expect(v.stats!.remaining).toBe("残り 21　ボーナス 21（基本7+ダイス4+大当り10）");
    // 字の数は 29 だが半角が 12 あり、幅は全角 8px × 17 + 半角 4px × 12 = 184px
    expect(textUnits(v.stats!.remaining) * 4).toBeLessThanOrEqual(CUSTOM_REMAINING.w);
    expect(CUSTOM_REMAINING.w).toBe(224);
    // 外れの最大（残り 11・基本7+ダイス4）も同じ
    const small = { base: c.bonusBase, die: c.bonusDie, big: 0, total: c.bonusBase + c.bonusDie };
    const vs = customView({ ...st, members: st.members.map((m, i) => (i === 0 ? { ...m, bonus: small.total, bonusParts: small } : m)) }, data, S);
    expect(textUnits(vs.stats!.remaining) * 4).toBeLessThanOrEqual(CUSTOM_REMAINING.w);
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
    // UI-74（M12.5）: 能力値の段の数字 1〜6 はその行の選択（M5.5 では null だった）
    expect(customKeyChoice({ menu: 0 }, customView(d, data, S), "stats", "")).toEqual({ kind: "select", key: "str" });
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

  test("UI-62 職業の段で条件を満たす職業が 1 つも無いと案内（custom.noClass）を出す。1 つでも選べれば出さない。ほかの段は null（M6）", () => {
    const rng = createRng(3);
    const d0 = initialDraft(data);
    expect(customView(d0, data, S).notice).toBeNull();
    let d = step(d0, { kind: "race", raceId: "human" }, rng);
    // ボーナスを 10 にして生命力だけに振る（人間の基礎値は 力8 知恵8 信仰心5 素早さ8 で、どの職業の条件にも届かない）
    d = { ...d, members: d.members.map((m, i) => (i === 0 ? { ...m, bonus: 10 } : m)) };
    d = spendAll(d, rng, ["vit"]);
    d = step(d, { kind: "next" }, rng);
    expect(d.step).toBe("class");
    const none = customView(d, data, S);
    expect(none.rows.length).toBe(data.classes.length);
    expect(none.rows.every((r) => r.dim)).toBe(true);
    expect(none.notice).toBe(S["custom.noClass"]);
    expect(none.notice).toBe("能力値が足りず、選べる職業が無い。戻って配分し直そう。");
    // 戻って力に振り直せば戦士が選べ、案内は出ない
    let back = step(d, { kind: "back" }, rng);
    while (back.members[0]!.stats!.vit > 8) back = step(back, { kind: "dec", key: "vit" }, rng);
    back = spendAll(back, rng, ["str"]);
    const ok = customView(step(back, { kind: "next" }, rng), data, S);
    expect(ok.rows.some((r) => !r.dim)).toBe(true);
    expect(ok.notice).toBeNull();
  });

  test("UI-62 名前の段の 次へ・戻る と誤りの欄は入力欄（y34..66）のすぐ下で、ステージの上 1/3 に収まる（ソフトキーボードで隠れない）。重ならず一辺 30 以上。ほかの段は下のボタン（M6）", () => {
    const n = customButtonRects(true);
    const ov = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    for (const r of [n.b, n.c, n.error]) {
      expect(r.y).toBeGreaterThanOrEqual(CUSTOM_NAME.y + CUSTOM_NAME.h);
      expect(r.y + r.h).toBeLessThanOrEqual(Math.floor(data.config.stage.height / 3));
      expect(ov(r, CUSTOM_NAME)).toBe(false);
    }
    for (const r of [n.b, n.c]) expect(Math.min(r.w, r.h)).toBeGreaterThanOrEqual(TOUCH_MIN_LOGICAL);
    expect(ov(n.b, n.c)).toBe(false);
    expect(ov(n.b, n.error) || ov(n.c, n.error)).toBe(false);
    expect(customButtonRects(false)).toEqual({ a: CUSTOM_BUTTONS.a, b: CUSTOM_BUTTONS.b, c: CUSTOM_BUTTONS.c, d: CUSTOM_BUTTONS.d, error: CUSTOM_ERROR });
    // UI-62（M20）: 残りはおまかせ（d）はどの段も右下の空き枠（名前の段もキーボードの下の同じ枠）
    expect(n.d).toEqual(CUSTOM_BUTTONS.d);
    expect(CUSTOM_BUTTONS.d).toEqual({ x: 124, y: 340, w: 108, h: 32 });
    for (const r of [CUSTOM_BUTTONS.a, CUSTOM_BUTTONS.b, CUSTOM_BUTTONS.c, n.b, n.c, n.error, CUSTOM_ERROR, CUSTOM_STAT_DESC, CUSTOM_REMAINING]) expect(ov(CUSTOM_BUTTONS.d, r)).toBe(false);
    expect(CUSTOM_BUTTONS.d.y + CUSTOM_BUTTONS.d.h).toBeLessThanOrEqual(data.config.stage.height);
  });

  test("CH-30（M20）おまかせの性格は名前の段を終えるときに作成中の乱数で具体的に決まる（鏡の rng の randInt(0,3) の配列順）。確認の行に出て、game.new は state.rng を引かない", () => {
    const rng = createRng(11);
    let d = makeOne(initialDraft(data), rng, "アキ");
    let e = step(d, { kind: "race", raceId: "human" }, rng);
    e = spendAll(e, rng);
    e = step(e, { kind: "next" }, rng);
    e = step(e, { kind: "class", classId: "fighter" }, rng);
    e = step(e, { kind: "personality", value: "random" }, rng);
    // 名前の段ではまだおまかせ（要約の行もおまかせ）
    expect(e.members[1]!.personality).toBe("random");
    expect(customView(e, data, S).summary).toContain(S["creation.personality.random"]);
    // 不正な名前では決めない（乱数も引かない）
    const before = cloneRng(rng);
    expect(customStep(e, { kind: "name", name: "" }, data, rng).kind).toBe("invalidName");
    expect(rng).toEqual(before);
    const mirror = cloneRng(rng);
    const want = data.personalities[randInt(mirror, 0, data.personalities.length - 1)]!.id;
    d = step(e, { kind: "name", name: "イサ" }, rng);
    expect(d.members[1]!.personality).toBe(want);
    expect(rng).toEqual(mirror);
    // 具体的な性格・リーダーは引かない
    const r2 = createRng(4);
    expect(resolveDraftPersonality("normal", data, r2)).toBe("normal");
    expect(resolveDraftPersonality(null, data, r2)).toBeNull();
    expect(r2).toEqual(createRng(4));
    // 残りを作って確認へ: 2 人目の行は具体的な性格。setup に random は無く、game.new は state.rng を引かない
    for (let i = 2; i < 6; i++) d = makeOne(d, rng, `ウ${i}`);
    expect(d.step).toBe("confirm");
    const name = data.personalities.find((p) => p.id === want)!.name;
    expect(customView(d, data, S).confirm[1]).toContain(name);
    const setup = buildCustomSetup(d)!;
    expect(setup.members.some((m) => m.personality === "random")).toBe(false);
    const r = execute(createInitialState(1, data), { type: "game.new", party: setup }, data);
    expect(r.state.rng).toEqual(createRng(1));
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
      "custom.bonusDetail",
      "custom.bonusDetailBig",
      "custom.reroll",
      "custom.next",
      "custom.autoRest",
      "custom.start",
      "custom.reqNone",
      "custom.noClass",
      "custom.confirmRow",
      "custom.leader",
      "custom.rejected",
    ]) {
      expect(S[k], k).toBeTypeOf("string");
    }
  });
});

describe("能力値の説明（UI-74。M12.5）", () => {
  const ov = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const stats = (seed = 5) => step(initialDraft(data), { kind: "race", raceId: "human" }, createRng(seed));

  test("UI-74 選択の初期値は力（statKey str）。種族を選んで能力値の段に入るときも力に戻る（同じ種族の選び直しでも）。職業から戻ったときは残す", () => {
    const rng = createRng(2);
    expect(initialDraft(data).statKey).toBe("str");
    let d = stats();
    expect(d.statKey).toBe("str");
    d = step(d, { kind: "select", key: "agi" }, rng);
    expect(d.statKey).toBe("agi");
    // 種族へ戻って別の種族 → 力
    expect(step(step(d, { kind: "back" }, rng), { kind: "race", raceId: "elf" }, rng).statKey).toBe("str");
    // 種族へ戻って同じ種族（配分は残る）→ 力
    const same = step(step(d, { kind: "back" }, rng), { kind: "race", raceId: "human" }, rng);
    expect(same.step).toBe("stats");
    expect(same.statKey).toBe("str");
    // 職業から戻ったときは残す
    let e = spendAll(stats(), rng);
    e = step(e, { kind: "select", key: "pie" }, rng);
    e = step(e, { kind: "next" }, rng);
    expect(e.step).toBe("class");
    expect(step(e, { kind: "back" }, rng).statKey).toBe("pie");
  });

  test("UI-74 [+]/[-]（inc / dec）を押した能力値が選択になる（増減できなかったときも）。select はその能力値を選ぶ。能力値の段以外の select は何もしない", () => {
    const rng = createRng(3);
    let d = stats();
    d = step(d, { kind: "inc", key: "vit" }, rng);
    expect(d.statKey).toBe("vit");
    expect(d.members[0]!.stats!.vit).toBe(data.races.find((r) => r.id === "human")!.baseStats.vit + 1);
    d = step(d, { kind: "dec", key: "luk" }, rng); // 基礎値より下げられない → 値は変わらず選択だけ移る
    expect(d.statKey).toBe("luk");
    expect(d.members[0]!.stats).toEqual({ ...data.races.find((r) => r.id === "human")!.baseStats, vit: data.races.find((r) => r.id === "human")!.baseStats.vit + 1 });
    for (const k of STAT_KEYS) expect(step(d, { kind: "select", key: k }, rng).statKey).toBe(k);
    // 能力値の段以外（種族の段）は同じ下書き
    const d0 = initialDraft(data);
    expect(customStep(d0, { kind: "select", key: "agi" }, data, rng)).toEqual({ kind: "draft", draft: d0 });
  });

  test("UI-74 キー: 能力値の段の数字 1〜6 はその行の選択（select）。7 以上は null。Enter は次へ・Esc は戻るのまま", () => {
    const d = stats();
    const v = customView(d, data, S);
    STAT_KEYS.forEach((k, i) => expect(customKeyChoice({ menu: i }, v, "stats", "")).toEqual({ kind: "select", key: k }));
    expect(customKeyChoice({ menu: 6 }, v, "stats", "")).toBeNull();
    expect(customKeyChoice("back", v, "stats", "")).toEqual({ kind: "back" });
    expect(customKeyChoice("confirm", v, "stats", "")).toBeNull(); // 残りがあるので 次へ は dim
  });

  test("UI-74 customView の能力値の行に短い説明（stat.short.<k>）と選択中の印。説明の欄は選択中の stat.desc.<k> と職業の条件（classes.json の順、custom.classReq を半角空白でつなぐ）", () => {
    const d = step(stats(), { kind: "select", key: "iq" }, createRng(1));
    const v = customView(d, data, S);
    expect(v.stats!.rows.map((r) => r.short)).toEqual(STAT_KEYS.map((k) => S[`stat.short.${k}`]));
    expect(v.stats!.rows.map((r) => r.selected)).toEqual([false, true, false, false, false, false]);
    expect(v.stats!.desc).toBe(S["stat.desc.iq"]);
    expect(v.stats!.req).toBe("職業の条件　魔術師11 侍11 君主12 司教12");
    expect(customView(stats(), data, S).stats!.req).toBe("職業の条件　戦士11 侍15 君主15");
    expect(customView(step(stats(), { kind: "select", key: "luk" }, createRng(1)), data, S).stats!.req).toBe("職業の条件　君主15");
    // ほかの段は stats が null（説明の欄は出ない）
    expect(customView(initialDraft(data), data, S).stats).toBeNull();
  });

  test("UI-74 その能力値を要求する職業が無いときは custom.statReqNone（合成データ: 君主の運の条件を外す）。判定はしない（満たしているかは比べない）", () => {
    const syn = {
      ...data,
      classes: data.classes.map((c) => {
        if (c.id !== "lord") return c;
        const { luk: _luk, ...rest } = c.requirements;
        return { ...c, requirements: rest };
      }),
    };
    const d = draftOf(customStep(stats(), { kind: "select", key: "luk" }, syn, createRng(1)));
    expect(customView(d, syn, S).stats!.req).toBe(S["custom.statReqNone"]);
    expect(S["custom.statReqNone"]).toBe("職業の条件は無い");
    // 力 8 の人間でも戦士11 をそのまま並べる（足りているかで文は変わらない）
    expect(customView(stats(), syn, S).stats!.req).toBe("職業の条件　戦士11 侍15 君主15");
  });

  test("UI-74 実データの 6 能力値で、説明の欄（232px = 全角 29 字）の desc は 2 行以内、職業の条件は 2 行以内、合わせて 4 行以内（禁則の折り返し）。札の短い説明は 12 字以内", () => {
    for (const k of STAT_KEYS) {
      const v = customView(step(stats(), { kind: "select", key: k }, createRng(1)), data, S).stats!;
      const dl = kinsokuLines(v.desc, 29).length;
      const rl = kinsokuLines(v.req, 29).length;
      expect(dl, k).toBeLessThanOrEqual(2);
      expect(rl, k).toBeLessThanOrEqual(2);
      expect(dl + rl, k).toBeLessThanOrEqual(Math.floor(CUSTOM_STAT_DESC.h / 10));
      expect([...v.rows.find((r) => r.key === k)!.short].length, k).toBeLessThanOrEqual(12);
    }
  });

  test("UI-74 矩形: 札（名前の欄）は押せる大きさ（一辺 30 以上）。残りの行は高さ 12。説明の欄 y254..295 は 6 行・残りの行・下のボタンと重ならず、ステージの中", () => {
    for (let i = 0; i < 6; i++) {
      const r = customStatRow(i);
      expect(Math.min(r.label.w, r.label.h)).toBeGreaterThanOrEqual(TOUCH_MIN_LOGICAL);
      for (const x of [r.label, r.minus, r.value, r.plus]) {
        expect(ov(x, CUSTOM_STAT_DESC)).toBe(false);
        expect(ov(x, CUSTOM_REMAINING)).toBe(false);
      }
    }
    expect(CUSTOM_REMAINING.h).toBe(12);
    expect(CUSTOM_STAT_DESC).toEqual({ x: 4, y: 254, w: 232, h: 42 });
    expect(ov(CUSTOM_REMAINING, CUSTOM_STAT_DESC)).toBe(false);
    for (const b of [CUSTOM_BUTTONS.a, CUSTOM_BUTTONS.b, CUSTOM_BUTTONS.c]) {
      expect(ov(b, CUSTOM_STAT_DESC)).toBe(false);
      expect(ov(b, CUSTOM_REMAINING)).toBe(false);
    }
    expect(CUSTOM_STAT_DESC.x + CUSTOM_STAT_DESC.w).toBeLessThanOrEqual(data.config.stage.width);
  });

  test("UI-74 能力値の説明の文言が strings にある", () => {
    for (const k of STAT_KEYS) {
      expect(S[`stat.short.${k}`], k).toBeTypeOf("string");
      expect(S[`stat.desc.${k}`], k).toBeTypeOf("string");
    }
    for (const k of ["custom.statReq", "custom.statReqNone", "custom.classReq"]) expect(S[k], k).toBeTypeOf("string");
  });
});

describe("能力値の「+」「−」の長押し（UI-62。M19 D-6）", () => {
  afterEach(() => vi.useRealTimers());
  const rowOf = (d: CustomDraft, k: StatKey) => {
    const m = d.members[d.index]!;
    return statAllocation(m.raceId!, m.stats!, m.bonus, data).rows.find((r) => r.key === k)!;
  };
  const remainingOf = (d: CustomDraft) => {
    const m = d.members[d.index]!;
    return statAllocation(m.raceId!, m.stats!, m.bonus, data).remaining;
  };

  test("UI-62 statHoldSpec の「+」: 短く離すと 1 回。長押しは始めにすぐ 1 回、以後 ms おきに 1 回、増やせなくなったら止まる。離した後のタップは何もしない", async () => {
    vi.useFakeTimers();
    const rng = createRng(1);
    let d = step(initialDraft(data), { kind: "race", raceId: "human" }, createRng(5));
    const limit = Math.min(remainingOf(d), 18 - rowOf(d, "str").value);
    expect(limit).toBeGreaterThanOrEqual(4);
    let n = 0;
    const spec = statHoldSpec({
      ms: () => 250,
      can: () => rowOf(d, "str").canInc,
      step: () => {
        n++;
        d = step(d, { kind: "inc", key: "str" }, rng);
      },
    });
    spec.onTap({ lx: 0, ly: 0 });
    expect(n).toBe(1);
    spec.hold!.onHoldStart();
    expect(n).toBe(2);
    await vi.advanceTimersByTimeAsync(249);
    expect(n).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(n).toBe(3);
    await vi.advanceTimersByTimeAsync(250 * 40);
    expect(n).toBe(limit);
    expect(rowOf(d, "str").canInc).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    spec.hold!.onHoldEnd();
    spec.onTap({ lx: 0, ly: 0 });
    expect(n).toBe(limit);
  });

  test("UI-62 statHoldSpec の「−」: 離すとその場で止まる。押し直すと新しい長押し。基礎値まで戻したら止まる", async () => {
    vi.useFakeTimers();
    const rng = createRng(1);
    let d = step(initialDraft(data), { kind: "race", raceId: "human" }, createRng(5));
    for (let i = 0; i < 4; i++) d = step(d, { kind: "inc", key: "str" }, rng);
    const base = data.races.find((r) => r.id === "human")!.baseStats.str;
    expect(rowOf(d, "str").value).toBe(base + 4);
    const spec = statHoldSpec({
      ms: () => 250,
      can: () => rowOf(d, "str").canDec,
      step: () => {
        d = step(d, { kind: "dec", key: "str" }, rng);
      },
    });
    spec.hold!.onHoldStart();
    await vi.advanceTimersByTimeAsync(250);
    expect(rowOf(d, "str").value).toBe(base + 2);
    spec.hold!.onHoldEnd();
    await vi.advanceTimersByTimeAsync(1000);
    expect(rowOf(d, "str").value).toBe(base + 2);
    spec.hold!.onHoldStart();
    await vi.advanceTimersByTimeAsync(1000);
    expect(rowOf(d, "str").value).toBe(base);
    expect(rowOf(d, "str").canDec).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    spec.hold!.onHoldEnd();
  });

  test("UI-62 sameChildren: 同じ要素が同じ順なら真（描き直しで入れ替えない）。数・順・要素が違えば偽", () => {
    const a = {};
    const b = {};
    expect(sameChildren([a, b], [a, b])).toBe(true);
    expect(sameChildren([], [])).toBe(true);
    expect(sameChildren([a, b], [b, a])).toBe(false);
    expect(sameChildren([a], [a, b])).toBe(false);
    expect(sameChildren([a, b], [a, {}])).toBe(false);
  });

  test("UI-62 配線: 「+」「−」は statHoldSpec（能力値ごとに使い回す要素）、能力値の段の描き直しは sameChildren で入れ替えを省く。app は holdRepeatMs を渡す", () => {
    const src = fs.readFileSync(new URL("../src/presenter/views/custom-creation.ts", import.meta.url), "utf8");
    expect(src).toMatch(/onTap\(minus, statHoldSpec\(\{[^\n]*canDec[^\n]*kind: "dec"/);
    expect(src).toMatch(/onTap\(plus, statHoldSpec\(\{[^\n]*canInc[^\n]*kind: "inc"/);
    expect(src).toMatch(/if \(!sameChildren\(body\.children, kids\)\) body\.replaceChildren\(\.\.\.kids\);/);
    const app = fs.readFileSync(new URL("../src/presenter/app.ts", import.meta.url), "utf8");
    expect(app).toMatch(/createCustomCreationScreen\(\{[^\n]*holdMs: \(\) => store\.get\(\)\.holdRepeatMs/);
  });
});

describe("残りはおまかせ（UI-62 / CH-06。M20）", () => {
  const proto = data.config.prototypeParty.members;
  /** 人 i を鏡の rng で埋めたときの期待値（種族 → ボーナス → 性格の順に引く） */
  const mirrorFill = (mirror: RngState, i: number, withRace: boolean, withPersonality: boolean) => {
    const cls = proto[i]!.classId;
    const raceId = withRace ? pickAutoRace(mirror, cls, data) : null;
    const bonus = withRace ? rollBonusParts(mirror, data.config.creation).total : null;
    const personality = i === 0 ? null : withPersonality ? pickPersonality(mirror, data) : null;
    return { raceId, bonus, personality };
  };
  const expectComplete = (d: CustomDraft) => {
    for (const m of d.members) {
      expect(statAllocation(m.raceId!, m.stats!, m.bonus, data).complete).toBe(true);
      expect(classOptions(m.stats!, data).find((o) => o.classId === m.classId)?.ok).toBe(true);
    }
  };

  test("UI-62 1 人目の種族の段で押すと 6 人を埋めて確認へ: 職業はおすすめの一行の型、種族は pickAutoRace、配分し終え、性格は具体的（鏡の rng）、名前は既定。game.new が受け付け、並びはおすすめと同じ（CH-07）", () => {
    const rng = createRng(21);
    const mirror = cloneRng(rng);
    const d = step(initialDraft(data), { kind: "autoRest" }, rng);
    expect(d.step).toBe("confirm");
    expect(d.index).toBe(5);
    d.members.forEach((m, i) => {
      const want = mirrorFill(mirror, i, true, true);
      expect(m.classId, `${i}`).toBe(proto[i]!.classId);
      expect(m.raceId, `${i}`).toBe(want.raceId);
      expect(m.bonus, `${i}`).toBe(want.bonus);
      expect(m.personality, `${i}`).toBe(want.personality);
      expect(m.name).toBe(proto[i]!.defaultName);
    });
    expect(rng).toEqual(mirror);
    expectComplete(d);
    const setup = buildCustomSetup(d)!;
    const r = execute(createInitialState(1, data), { type: "game.new", party: setup }, data);
    expect(r.events[0]).toEqual({ kind: "screen", to: "town" });
    expect(r.state.party.map((c) => c.classId)).toEqual(proto.map((m) => m.classId));
    // 確認の行は具体的な性格（おまかせは出ない）
    for (const line of customView(d, data, S).confirm.slice(1)) expect(line).not.toContain(S["creation.personality.random"]);
  });

  test("UI-62 決めた段は保つ: 前の人は変えない。今の人の種族・振ったボーナス・配った分は残し、残りを職業の型の不足分から配る。性格の段より前なら性格は引き直す", () => {
    const rng = createRng(8);
    const leader = makeOne(initialDraft(data), rng, "アキ");
    let d = step(leader, { kind: "race", raceId: "dwarf" }, rng);
    d = step(d, { kind: "inc", key: "luk" }, rng);
    const m1 = d.members[1]!;
    const mirror = cloneRng(rng);
    const r = step(d, { kind: "autoRest" }, rng);
    expect(r.step).toBe("confirm");
    expect(r.members[0]).toEqual(leader.members[0]);
    const a = r.members[1]!;
    expect(a.raceId).toBe("dwarf");
    expect(a.bonus).toBe(m1.bonus);
    expect(a.bonusParts).toEqual(m1.bonusParts);
    expect(a.stats!.luk).toBeGreaterThanOrEqual(m1.stats!.luk);
    expect(a.classId).toBe(proto[1]!.classId);
    expect(a.personality).toBe(mirrorFill(mirror, 1, false, true).personality);
    for (let i = 2; i < 6; i++) mirrorFill(mirror, i, true, true);
    expect(rng).toEqual(mirror);
    expectComplete(r);
  });

  test("UI-62 職業の段で押すと、決めた職業（型と違っても）を保つ。名前の段で押すと入力の名前で（正しくなければ invalidName）、選んだ性格を保つ", () => {
    const rng = createRng(5);
    let d = makeOne(initialDraft(data), rng, "アキ");
    d = step(d, { kind: "race", raceId: "human" }, rng);
    // 素早さ 11（盗賊）にしてから残りを力へ（戦士も選べる）
    for (let k = 0; k < 3; k++) d = step(d, { kind: "inc", key: "agi" }, rng);
    d = spendAll(d, rng, ["str"]);
    d = step(d, { kind: "next" }, rng);
    expect(d.step).toBe("class");
    expect(classOptions(d.members[1]!.stats!, data).filter((o) => o.ok).map((o) => o.classId)).toEqual(expect.arrayContaining(["fighter", "thief"]));
    const atClass = draftOf(customStep(d, { kind: "autoRest" }, data, cloneRng(rng)));
    expect(atClass.members[1]!.classId).toBe(proto[1]!.classId);
    d = step(d, { kind: "class", classId: "thief" }, rng);
    const kept = draftOf(customStep(d, { kind: "autoRest" }, data, cloneRng(rng)));
    expect(kept.members[1]!.classId).toBe("thief");
    d = step(d, { kind: "personality", value: "greedy" }, rng);
    expect(d.step).toBe("name");
    const bad = customStep(d, { kind: "autoRest", name: "" }, data, rng);
    expect(bad.kind).toBe("invalidName");
    const r = step(d, { kind: "autoRest", name: "イサ" }, rng);
    expect(r.step).toBe("confirm");
    expect(r.members[1]!.name).toBe("イサ");
    expect(r.members[1]!.personality).toBe("greedy");
    expect(r.members[1]!.classId).toBe("thief");
  });

  test("UI-62/CH-30 名前の段で名前が正しくないとき、残りはおまかせは乱数を引かずに invalidName（おまかせの性格も決めない）", () => {
    const rng = createRng(5);
    let d = makeOne(initialDraft(data), rng, "アキ");
    d = step(d, { kind: "race", raceId: "human" }, rng);
    d = spendAll(d, rng, ["str"]);
    d = step(d, { kind: "next" }, rng);
    d = step(d, { kind: "class", classId: "fighter" }, rng);
    d = step(d, { kind: "personality", value: "random" }, rng);
    expect(d.step).toBe("name");
    const mirror = cloneRng(rng);
    const bad = customStep(d, { kind: "autoRest", name: "" }, data, rng);
    expect(bad.kind).toBe("invalidName");
    if (bad.kind !== "invalidName") return;
    expect(bad.draft.members[1]!.personality).toBe("random");
    expect(rng).toEqual(mirror);
  });

  test("UI-62 職業がどれも届かない人がいれば、その人の職業の段で止める（custom.noClass が出る）。確認の段では何もしない", () => {
    const rng = createRng(2);
    let d = step(initialDraft(data), { kind: "race", raceId: "human" }, rng);
    d = spendAll(d, rng, ["luk", "vit"]);
    const r = step(d, { kind: "autoRest" }, rng);
    expect(r.index).toBe(0);
    expect(r.step).toBe("class");
    expect(customView(r, data, S).notice).toBe(S["custom.noClass"]);
    const full = step(initialDraft(data), { kind: "autoRest" }, createRng(3));
    expect(customStep(full, { kind: "autoRest" }, data, createRng(3))).toEqual({ kind: "draft", draft: full });
  });

  test("UI-62 ボタン d（残りはおまかせ）は種族・能力値・職業・性格・名前の段にあり、確認の段には無い。ラベルは枠（108px）に収まる", () => {
    const rng = createRng(4);
    let d = makeOne(initialDraft(data), rng, "アキ");
    const steps: CustomDraft[] = [d];
    d = step(d, { kind: "race", raceId: "human" }, rng);
    steps.push(d);
    d = spendAll(d, rng);
    d = step(d, { kind: "next" }, rng);
    steps.push(d);
    d = step(d, { kind: "class", classId: "fighter" }, rng);
    steps.push(d);
    d = step(d, { kind: "personality", value: "normal" }, rng);
    steps.push(d);
    expect(steps.map((x) => x.step)).toEqual(["race", "stats", "class", "personality", "name"]);
    for (const x of steps) {
      const b = customView(x, data, S).buttons.d;
      expect(b, x.step).toEqual({ label: S["custom.autoRest"], choice: { kind: "autoRest" }, dim: false });
    }
    const conf = step(d, { kind: "autoRest", name: "イサ" }, rng);
    expect(customView(conf, data, S).buttons.d).toBeNull();
    expect(textUnits(S["custom.autoRest"]!) * 4 + 8).toBeLessThanOrEqual(CUSTOM_BUTTONS.d.w);
  });

  test("UI-62 名前の段の d は入力欄の値を添えて送る（ソースの検査）", () => {
    const src = fs.readFileSync(new URL("../src/presenter/views/custom-creation.ts", import.meta.url), "utf8");
    expect(src).toContain('{ kind: "autoRest", name: input.value }');
  });
});
