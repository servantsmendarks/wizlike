// UI-62（M5.5）: 自分で作るキャラ作成（CH-06）。6 人（1 人目がリーダー）を 1 人ずつ、
// 種族 → 能力値 → 職業 → 性格（リーダーは飛ばす）→ 名前 の順に決め、6 人そろったら確認して game.new を送る。
// - 判定（配分の可否・残り・職業の条件・名前の長さ）は core の関数（statAllocation / adjustStat / classOptions /
//   validCreationName）の値だけで決める（UI-35）。ボーナスの振り（rollBonus）も core の関数。
// - 作成中の乱数（RngState）は呼び出し側（app）が持ち、customStep に渡す（作成中はまだ GameState が無い。CH-06 の例外）。
// - 下書き（CustomDraft）は表示層だけの値で保存しない（リロードするとタイトルから。SV-50）。
// 純粋な部分（initialDraft / customStep / customKeyChoice / customView）は DOM に触れないので node でテストできる。
// モジュールのトップレベルでは DOM に触れない。
import type { GameData, StatBlock, StatKey, Strings } from "../../core/data/index";
import { STAT_KEYS } from "../../core/data/index";
import type { RngState } from "../../core/rng";
import { adjustStat, classOptions, rollBonus, statAllocation, validCreationName } from "../../core/rules/creation";
import type { CustomPartySetup } from "../../core/types";
import type { Action } from "../input/swipe";
import { onTap } from "../input/tap";
import {
  CUSTOM_BUTTONS,
  CUSTOM_ERROR,
  CUSTOM_HEADING,
  CUSTOM_NAME,
  CUSTOM_REMAINING,
  CUSTOM_SUMMARY,
  customRow,
  customStatRow,
  type Rect,
} from "../layout";
import { defaultPersonalities, personalityLabel, type PersonalityChoice } from "./creation";
import { formatMessage } from "./message";

export type CustomStepId = "race" | "stats" | "class" | "personality" | "name" | "confirm";

export type CustomMemberDraft = {
  raceId: string | null;
  /** CH-11 のボーナス（種族を選んだ・振り直したときに rollBonus） */
  bonus: number;
  stats: StatBlock | null;
  classId: string | null;
  /** リーダー（添字 0）は null のまま */
  personality: PersonalityChoice;
  name: string;
};

export type CustomDraft = { index: number; step: CustomStepId; members: CustomMemberDraft[] };

export type CustomChoice =
  | { kind: "race"; raceId: string }
  | { kind: "inc"; key: StatKey }
  | { kind: "dec"; key: StatKey }
  | { kind: "reroll" }
  | { kind: "class"; classId: string }
  | { kind: "personality"; value: PersonalityChoice }
  | { kind: "name"; name: string }
  | { kind: "next" }
  | { kind: "start" }
  | { kind: "back" };

/** draft: 次の下書き。exit: タイトルの作り方の選択へ戻る。invalidName: 名前が長さの条件を満たさない。start: game.new を送る */
export type CustomResult =
  | { kind: "draft"; draft: CustomDraft }
  | { kind: "exit" }
  | { kind: "invalidName"; draft: CustomDraft }
  | { kind: "start"; setup: CustomPartySetup };

/** 最初の下書き。名前の既定は prototypeParty の defaultName、性格の既定は簡易作成と同じ（defaultPersonalities） */
export function initialDraft(data: GameData): CustomDraft {
  const size = data.config.party.size;
  const pers = defaultPersonalities(
    data.personalities.map((p) => p.id),
    size,
  );
  const members: CustomMemberDraft[] = [];
  for (let i = 0; i < size; i++) {
    members.push({
      raceId: null,
      bonus: 0,
      stats: null,
      classId: null,
      personality: i === 0 ? null : (pers[i] ?? "random"),
      name: data.config.prototypeParty.members[i]?.defaultName ?? "",
    });
  }
  return { index: 0, step: "race", members };
}

const raceBase = (data: GameData, raceId: string): StatBlock | null => data.races.find((r) => r.id === raceId)?.baseStats ?? null;

function withMember(d: CustomDraft, patch: Partial<CustomMemberDraft>, step: CustomStepId, index = d.index): CustomDraft {
  const members = d.members.map((m, i) => (i === d.index ? { ...m, ...patch } : m));
  return { index, step, members };
}

const same = (d: CustomDraft): CustomResult => ({ kind: "draft", draft: d });

/**
 * UI-62 / CH-06: 1 つ選んだ結果（純粋。rng だけは rollBonus で進む）。今の段に合わない選択・選べない選択は同じ下書きのまま。
 * 戻る: 0 人目の種族 → exit、k 人目の種族 → k−1 人目の名前、能力値 → 種族、職業 → 能力値（配分は残す）、
 * 性格 → 職業、名前 → 性格（リーダーは職業）、確認 → 6 人目の名前
 */
export function customStep(d: CustomDraft, c: CustomChoice, data: GameData, rng: RngState): CustomResult {
  const m = d.members[d.index];
  if (m === undefined) return same(d);
  const last = d.members.length - 1;
  const isLeader = d.index === 0;

  if (c.kind === "back") {
    switch (d.step) {
      case "race":
        return d.index === 0 ? { kind: "exit" } : { kind: "draft", draft: { ...d, index: d.index - 1, step: "name" } };
      case "stats":
        return { kind: "draft", draft: { ...d, step: "race" } };
      case "class":
        return { kind: "draft", draft: { ...d, step: "stats" } };
      case "personality":
        return { kind: "draft", draft: { ...d, step: "class" } };
      case "name":
        return { kind: "draft", draft: { ...d, step: isLeader ? "class" : "personality" } };
      case "confirm":
        return { kind: "draft", draft: { ...d, index: last, step: "name" } };
    }
  }

  switch (d.step) {
    case "race": {
      if (c.kind !== "race") return same(d);
      const base = raceBase(data, c.raceId);
      if (base === null) return same(d);
      // 同じ種族を選び直したら配分と職業を残す（戻ってきてそのまま進むため）。違う種族なら基礎値から振り直す（CH-11）
      if (m.raceId === c.raceId && m.stats !== null) return { kind: "draft", draft: { ...d, step: "stats" } };
      return { kind: "draft", draft: withMember(d, { raceId: c.raceId, stats: { ...base }, bonus: rollBonus(rng, data.config.creation), classId: null }, "stats") };
    }
    case "stats": {
      if (m.raceId === null || m.stats === null) return same(d);
      if (c.kind === "inc" || c.kind === "dec") {
        const next = adjustStat(m.raceId, m.stats, m.bonus, c.key, c.kind === "inc" ? 1 : -1, data);
        return next === m.stats ? same(d) : { kind: "draft", draft: withMember(d, { stats: next }, "stats") };
      }
      if (c.kind === "reroll") {
        const base = raceBase(data, m.raceId);
        if (base === null) return same(d);
        return { kind: "draft", draft: withMember(d, { stats: { ...base }, bonus: rollBonus(rng, data.config.creation) }, "stats") };
      }
      if (c.kind === "next") {
        if (!statAllocation(m.raceId, m.stats, m.bonus, data).complete) return same(d);
        // 配分を変えて条件を満たさなくなった職業は消す
        const ok = m.classId !== null && classOptions(m.stats, data).some((o) => o.classId === m.classId && o.ok);
        return { kind: "draft", draft: withMember(d, { classId: ok ? m.classId : null }, "class") };
      }
      return same(d);
    }
    case "class": {
      if (c.kind !== "class" || m.stats === null) return same(d);
      const opt = classOptions(m.stats, data).find((o) => o.classId === c.classId);
      if (opt === undefined || !opt.ok) return same(d);
      return { kind: "draft", draft: withMember(d, { classId: c.classId }, isLeader ? "name" : "personality") };
    }
    case "personality": {
      if (c.kind !== "personality" || isLeader || c.value === null) return same(d);
      if (c.value !== "random" && !data.personalities.some((p) => p.id === c.value)) return same(d);
      return { kind: "draft", draft: withMember(d, { personality: c.value }, "name") };
    }
    case "name": {
      if (c.kind !== "name") return same(d);
      const named = withMember(d, { name: c.name }, "name");
      if (!validCreationName(c.name, data)) return { kind: "invalidName", draft: named };
      if (d.index < last) return { kind: "draft", draft: { ...named, index: d.index + 1, step: "race" } };
      return { kind: "draft", draft: { ...named, step: "confirm" } };
    }
    case "confirm": {
      if (c.kind !== "start") return same(d);
      const setup = buildCustomSetup(d);
      return setup === null ? same(d) : { kind: "start", setup };
    }
  }
}

/** 6 人とも種族・能力値・職業が決まっていれば CustomPartySetup。名前・配分などの検査は core（game.new）が行う */
export function buildCustomSetup(d: CustomDraft): CustomPartySetup | null {
  const members: CustomPartySetup["members"] = [];
  for (let i = 0; i < d.members.length; i++) {
    const m = d.members[i];
    if (m === undefined || m.raceId === null || m.stats === null || m.classId === null) return null;
    members.push({
      name: m.name,
      personality: i === 0 ? null : m.personality,
      raceId: m.raceId,
      classId: m.classId,
      stats: { ...m.stats },
    });
  }
  return { kind: "custom", members };
}

// ---------------------------------------------------------------- 描く内容（純粋）

/** 一覧の 1 行（種族・職業・性格）。2 行（名前と説明・基礎値・条件）。dim は選べない（押しても何もしない）、selected は今の値 */
export type CustomRowView = { lines: [string, string]; choice: CustomChoice; dim: boolean; selected: boolean };

export type CustomStatView = { label: string; value: number; canInc: boolean; canDec: boolean; key: StatKey };

export type CustomButton = { label: string; choice: CustomChoice; dim: boolean };

export type CustomView = {
  heading: string;
  summary: string;
  /** 種族・職業・性格の段の行（それ以外の段は []） */
  rows: CustomRowView[];
  /** 能力値の段の 6 行（それ以外は null） */
  stats: { rows: CustomStatView[]; remaining: string } | null;
  /** 名前の段の入力欄の値（それ以外は null） */
  name: string | null;
  /** 確認の段の 6 行（それ以外は []） */
  confirm: string[];
  /** 下のボタン a（左上）・b（右上）・c（左下 = 戻る）。無い枠は null */
  buttons: { a: CustomButton | null; b: CustomButton | null; c: CustomButton };
};

const tr = (strings: Strings, k: string): string => strings[k] ?? k;

function statPairs(stats: Partial<StatBlock>, strings: Strings): string {
  return STAT_KEYS.flatMap((k) => {
    const v = stats[k];
    return v === undefined ? [] : [formatMessage(tr(strings, "custom.statPair"), { label: tr(strings, `stat.${k}`), value: v })];
  }).join(" ");
}

const raceName = (data: GameData, id: string | null): string => (id === null ? "" : (data.races.find((r) => r.id === id)?.name ?? id));
const className = (data: GameData, id: string | null): string => (id === null ? "" : (data.classes.find((c) => c.id === id)?.name ?? id));

/** UI-62: 今の段の描く内容。可否は core の関数の値をそのまま写す */
export function customView(d: CustomDraft, data: GameData, strings: Strings): CustomView {
  const m = d.members[d.index];
  const back: CustomButton = { label: tr(strings, "common.back"), choice: { kind: "back" }, dim: false };
  const stepLabel = tr(strings, `custom.step.${d.step}`);
  const heading =
    d.step === "confirm"
      ? stepLabel
      : formatMessage(tr(strings, d.index === 0 ? "custom.headingLeader" : "custom.heading"), { n: d.index + 1, step: stepLabel });
  const view: CustomView = {
    heading,
    summary: "",
    rows: [],
    stats: null,
    name: null,
    confirm: [],
    buttons: { a: null, b: null, c: back },
  };
  if (m === undefined) return view;
  if (d.step !== "confirm") {
    const parts = [raceName(data, m.raceId), d.step === "race" || d.step === "stats" ? "" : className(data, m.classId)];
    if (d.index !== 0 && d.step === "name") parts.push(personalityLabel(m.personality, data, strings));
    view.summary = parts.filter((s) => s !== "").join(" ");
  }

  switch (d.step) {
    case "race":
      view.rows = data.races.map((r) => ({
        lines: [r.name, statPairs(r.baseStats, strings)],
        choice: { kind: "race", raceId: r.id },
        dim: false,
        selected: r.id === m.raceId,
      }));
      break;
    case "stats": {
      if (m.raceId === null || m.stats === null) break;
      const a = statAllocation(m.raceId, m.stats, m.bonus, data);
      view.stats = {
        rows: a.rows.map((r) => ({ key: r.key, label: tr(strings, `stat.${r.key}`), value: r.value, canInc: r.canInc, canDec: r.canDec })),
        remaining: formatMessage(tr(strings, "custom.remaining"), { remaining: a.remaining, bonus: a.bonus }),
      };
      view.buttons.a = { label: tr(strings, "custom.reroll"), choice: { kind: "reroll" }, dim: false };
      view.buttons.b = { label: tr(strings, "custom.next"), choice: { kind: "next" }, dim: !a.complete };
      break;
    }
    case "class":
      if (m.stats === null) break;
      view.rows = classOptions(m.stats, data).map((o) => {
        const req = statPairs(o.requirements, strings);
        return {
          lines: [o.name, req === "" ? tr(strings, "custom.reqNone") : req],
          choice: { kind: "class", classId: o.classId },
          dim: !o.ok,
          selected: o.classId === m.classId,
        };
      });
      break;
    case "personality": {
      view.rows = [
        ...data.personalities.map(
          (p): CustomRowView => ({
            lines: [p.name, p.shortDescription],
            choice: { kind: "personality", value: p.id },
            dim: false,
            selected: m.personality === p.id,
          }),
        ),
        {
          lines: [personalityLabel("random", data, strings), ""],
          choice: { kind: "personality", value: "random" },
          dim: false,
          selected: m.personality === "random",
        },
      ];
      break;
    }
    case "name":
      view.name = m.name;
      view.buttons.b = { label: tr(strings, "custom.next"), choice: { kind: "next" }, dim: false };
      break;
    case "confirm":
      view.confirm = d.members.map((x, i) =>
        formatMessage(tr(strings, "custom.confirmRow"), {
          n: i + 1,
          name: x.name.trim(),
          race: raceName(data, x.raceId),
          class: className(data, x.classId),
          personality: i === 0 ? tr(strings, "custom.leader") : personalityLabel(x.personality, data, strings),
        }),
      );
      view.buttons.b = { label: tr(strings, "custom.start"), choice: { kind: "start" }, dim: false };
      break;
  }
  return view;
}

/**
 * UI-33 / UI-62: キー（Action）→ 選ぶもの。Esc → 戻る。数字 n → 一覧の段の n 番目の行（選べない行は null）。
 * Enter → 一覧の段は先頭の選べる行、能力値の段は 次へ、名前の段は今の入力（name）で次へ、確認の段は 始める。該当なしは null
 */
export function customKeyChoice(a: Action, view: CustomView, step: CustomStepId, name: string): CustomChoice | null {
  if (a === "back") return { kind: "back" };
  if (step === "name") return a === "confirm" ? { kind: "name", name } : null;
  if (typeof a === "object") {
    const r = view.rows[a.menu];
    return r === undefined || r.dim ? null : r.choice;
  }
  if (a !== "confirm") return null;
  if (view.rows.length > 0) return view.rows.find((r) => !r.dim)?.choice ?? null;
  if (view.buttons.b !== null) return view.buttons.b.dim ? null : view.buttons.b.choice;
  return null;
}

// ---------------------------------------------------------------- DOM

export type CustomCreationScreen = {
  el: HTMLElement;
  /** 下書きを描き直す。error は誤りの欄の文（null なら隠す） */
  render(view: CustomView, error: string | null): void;
  /** 名前の入力欄の今の値 */
  nameValue(): string;
};

function place(el: HTMLElement, r: Rect): void {
  Object.assign(el.style, { position: "absolute", left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
}

function dimStyle(b: HTMLElement, dim: boolean): void {
  b.style.color = dim ? "var(--c-dim)" : "";
  b.style.borderColor = dim ? "var(--c-dim)" : "";
}

export function createCustomCreationScreen(o: { onChoice(c: CustomChoice): void }): CustomCreationScreen {
  const el = document.createElement("div");
  el.className = "screen screen-custom";

  const heading = document.createElement("div");
  heading.className = "custom-heading";
  place(heading, CUSTOM_HEADING);
  el.appendChild(heading);

  const summary = document.createElement("div");
  summary.className = "custom-summary";
  place(summary, CUSTOM_SUMMARY);
  el.appendChild(summary);

  const body = document.createElement("div");
  el.appendChild(body);

  // 名前の入力欄は簡易作成（UI-51）と同じく 2 倍の大きさで作り、scale(0.5) で見せる（iOS の自動ズーム対策）
  const input = document.createElement("input");
  input.type = "text";
  input.className = "creation-name";
  input.setAttribute("autocomplete", "off");
  input.setAttribute("autocapitalize", "off");
  input.setAttribute("autocorrect", "off");
  input.setAttribute("spellcheck", "false");
  input.setAttribute("enterkeyhint", "next");
  input.maxLength = 12;
  Object.assign(input.style, {
    left: `${CUSTOM_NAME.x}px`,
    top: `${CUSTOM_NAME.y}px`,
    width: `${CUSTOM_NAME.w * 2}px`,
    height: `${CUSTOM_NAME.h * 2}px`,
  });
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.isComposing) return;
    e.preventDefault();
    o.onChoice({ kind: "name", name: input.value });
  });
  input.addEventListener("focusout", () => window.scrollTo(0, 0));
  el.appendChild(input);

  const remaining = document.createElement("div");
  remaining.className = "custom-remaining";
  place(remaining, CUSTOM_REMAINING);
  el.appendChild(remaining);

  const error = document.createElement("div");
  error.className = "creation-error";
  place(error, CUSTOM_ERROR);
  el.appendChild(error);

  const buttons = document.createElement("div");
  el.appendChild(buttons);

  const button = (text: string, r: Rect, dim: boolean, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ui-button";
    b.textContent = text;
    place(b, r);
    dimStyle(b, dim);
    if (dim) b.setAttribute("aria-disabled", "true");
    onTap(b, () => {
      if (!dim) onClick();
    });
    return b;
  };

  let lastStepHadName = false;

  return {
    el,
    nameValue: () => input.value,
    render(view, err) {
      heading.textContent = view.heading;
      summary.textContent = view.summary;

      const kids: HTMLElement[] = [];
      view.rows.forEach((row, i) => {
        const b = button(row.lines.join("\n"), customRow(i), row.dim, () => o.onChoice(row.choice));
        Object.assign(b.style, { whiteSpace: "pre", textAlign: "left", lineHeight: "14px", paddingLeft: "4px", boxSizing: "border-box", overflow: "hidden" });
        if (row.selected && !row.dim) {
          b.style.color = "var(--c-accent)";
          b.style.borderColor = "var(--c-accent)";
        }
        kids.push(b);
      });
      if (view.stats !== null) {
        view.stats.rows.forEach((s, i) => {
          const r = customStatRow(i);
          const lab = document.createElement("div");
          lab.className = "custom-stat-label";
          lab.textContent = s.label;
          place(lab, r.label);
          kids.push(lab);
          kids.push(button("-", r.minus, !s.canDec, () => o.onChoice({ kind: "dec", key: s.key })));
          const v = document.createElement("div");
          v.className = "custom-stat-value";
          v.textContent = String(s.value);
          place(v, r.value);
          kids.push(v);
          kids.push(button("+", r.plus, !s.canInc, () => o.onChoice({ kind: "inc", key: s.key })));
        });
      }
      view.confirm.forEach((line, i) => {
        const d = document.createElement("div");
        d.className = "custom-confirm-row";
        d.textContent = line;
        place(d, customRow(i));
        kids.push(d);
      });
      body.replaceChildren(...kids);

      remaining.textContent = view.stats?.remaining ?? "";
      remaining.style.display = view.stats === null ? "none" : "";

      if (view.name !== null) {
        // 名前の段に入ったときだけ下書きの名前を入れる（打っている途中の値を描き直しで消さない）
        if (!lastStepHadName) input.value = view.name;
        input.style.display = "";
      } else {
        input.style.display = "none";
        if (document.activeElement === input) input.blur();
      }
      lastStepHadName = view.name !== null;

      const bs: HTMLElement[] = [];
      const { a, b, c } = view.buttons;
      if (a !== null) bs.push(button(a.label, CUSTOM_BUTTONS.a, a.dim, () => o.onChoice(a.choice)));
      if (b !== null)
        bs.push(
          button(b.label, CUSTOM_BUTTONS.b, b.dim, () =>
            // 名前の段の 次へ は入力欄の値で進む
            o.onChoice(view.name !== null ? { kind: "name", name: input.value } : b.choice),
          ),
        );
      bs.push(button(c.label, CUSTOM_BUTTONS.c, c.dim, () => o.onChoice(c.choice)));
      buttons.replaceChildren(...bs);

      error.textContent = err ?? "";
      error.style.visibility = err === null ? "hidden" : "visible";
    },
  };
}
