// UI-51 の簡易作成（プロトタイプ）。6 行の名前と性格、「ランダム」「始める」「戻る」。
// - 名前の既定値は config.prototypeParty.members[i].defaultName。行 0 がリーダーで性格は持たない（D4）。
// - 性格のボタンは personalities の配列順 → "random"（おまかせ）→ 先頭、と巡回する。
// - 「ランダム」はリーダー以外の性格を "random" にする（名前は変えない。乱数は core が引く。CH-30）。
// - 名前の検査は core（validatePartySetup）が行う。表示層は rejected を受けて creation.invalid を出すだけ。
// - 入力欄は iOS の自動ズームを避けるため、font-size 16px の 2 倍の大きさで作り、scale(0.5) で 112×32 に見せる。
// 純粋な部分（性格の巡回、PartySetup の組み立て）を export する。モジュールのトップレベルでは DOM に触れない。
import type { GameData, PersonalityId, Strings } from "../../core/data/index";
import type { PartySetup } from "../../core/types";
import { formatMessage } from "./message";
import { CREATION_BUTTONS, CREATION_ERROR, creationRow, type Rect } from "../layout";

export type PersonalityChoice = PersonalityId | "random" | null;

/** 行 i の既定の性格。リーダー（行 0）は null、それ以外は personalities を配列順に巡回して割り当てる */
export function defaultPersonalities(ids: readonly PersonalityId[], size: number): PersonalityChoice[] {
  const out: PersonalityChoice[] = [];
  for (let i = 0; i < size; i++) out.push(i === 0 ? null : (ids[(i - 1) % ids.length] ?? "random"));
  return out;
}

/** 性格のボタンを押したときの次の値。配列順 → "random" → 先頭。null（リーダー）は null のまま */
export function nextPersonality(cur: PersonalityChoice, ids: readonly PersonalityId[]): PersonalityChoice {
  if (cur === null) return null;
  if (cur === "random") return ids[0] ?? "random";
  const i = ids.indexOf(cur);
  return i < 0 || i + 1 >= ids.length ? "random" : (ids[i + 1] ?? "random");
}

/** 「ランダム」: リーダー以外を "random" にする */
export function randomizePersonalities(cur: readonly PersonalityChoice[]): PersonalityChoice[] {
  return cur.map((_p, i) => (i === 0 ? null : "random"));
}

/** 性格のボタンの表示名 */
export function personalityLabel(choice: PersonalityChoice, data: GameData, strings: Strings): string {
  if (choice === null) return strings["creation.leader"] ?? "creation.leader";
  if (choice === "random") return strings["creation.personality.random"] ?? "creation.personality.random";
  return data.personalities.find((p) => p.id === choice)?.name ?? choice;
}

/** game.new に渡す PartySetup。名前の検査は core が行うので、そのまま詰める */
export function buildPartySetup(names: readonly string[], personalities: readonly PersonalityChoice[]): PartySetup {
  return { members: names.map((name, i) => ({ name, personality: i === 0 ? null : (personalities[i] ?? "random") })) };
}

export type CreationScreen = {
  el: HTMLElement;
  /** 既定の名前と性格に戻し、エラー表示を消す */
  reset(): void;
  /** 今の入力から PartySetup を作る */
  setup(): PartySetup;
  /** creation.invalid の表示 */
  showError(on: boolean): void;
};

function place(el: HTMLElement, r: Rect): void {
  Object.assign(el.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
}

function button(text: string, r: Rect, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "ui-button";
  b.textContent = text;
  place(b, r);
  b.addEventListener("click", onClick);
  return b;
}

export function createCreationScreen(o: {
  data: GameData;
  strings: Strings;
  onStart(setup: PartySetup): void;
  onBack(): void;
}): CreationScreen {
  const t = (k: string): string => o.strings[k] ?? k;
  const members = o.data.config.prototypeParty.members;
  const size = members.length;
  const ids = o.data.personalities.map((p) => p.id);

  let choices: PersonalityChoice[] = defaultPersonalities(ids, size);

  const el = document.createElement("div");
  el.className = "screen screen-creation";

  const intro = document.createElement("div");
  intro.className = "creation-intro";
  intro.textContent = t("creation.intro");
  el.appendChild(intro);

  const inputs: HTMLInputElement[] = [];
  const persButtons: Array<HTMLButtonElement | null> = [];

  for (let i = 0; i < size; i++) {
    const r = creationRow(i);
    const num = document.createElement("div");
    num.className = "creation-num";
    num.textContent = String(i + 1);
    place(num, r.label);
    el.appendChild(num);

    // 入力欄は 2 倍の大きさで作り、scale(0.5) で r.name に見せる
    const input = document.createElement("input");
    input.type = "text";
    input.className = "creation-name";
    input.setAttribute("autocomplete", "off");
    input.setAttribute("autocapitalize", "off");
    input.setAttribute("autocorrect", "off");
    input.setAttribute("spellcheck", "false");
    input.setAttribute("enterkeyhint", i === size - 1 ? "done" : "next");
    input.maxLength = 12;
    Object.assign(input.style, { left: `${r.name.x}px`, top: `${r.name.y}px`, width: `${r.name.w * 2}px`, height: `${r.name.h * 2}px` });
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.isComposing) return;
      e.preventDefault();
      const next = inputs[i + 1];
      if (next !== undefined) next.focus();
      else input.blur();
    });
    // iOS がキーボードのためにページをずらしたままにしないよう、フォーカスが外れたら戻す
    input.addEventListener("focusout", () => window.scrollTo(0, 0));
    el.appendChild(input);
    inputs.push(input);

    if (i === 0) {
      const lab = document.createElement("div");
      lab.className = "creation-leader";
      place(lab, r.personality);
      lab.textContent = t("creation.leader");
      el.appendChild(lab);
      persButtons.push(null);
    } else {
      const b = button("", r.personality, () => {
        choices[i] = nextPersonality(choices[i] ?? "random", ids);
        renderChoices();
      });
      el.appendChild(b);
      persButtons.push(b);
    }
  }

  const error = document.createElement("div");
  error.className = "creation-error";
  place(error, CREATION_ERROR);
  error.textContent = formatMessage(t("creation.invalid"), { max: o.data.config.creation.nameMaxLength });
  el.appendChild(error);

  const renderChoices = (): void => {
    persButtons.forEach((b, i) => {
      if (b !== null) b.textContent = personalityLabel(choices[i] ?? "random", o.data, o.strings);
    });
  };

  const setup = (): PartySetup => buildPartySetup(inputs.map((x) => x.value), choices);

  el.appendChild(
    button(t("creation.random"), CREATION_BUTTONS.random, () => {
      choices = randomizePersonalities(choices);
      renderChoices();
    }),
  );
  el.appendChild(button(t("creation.start"), CREATION_BUTTONS.start, () => o.onStart(setup())));
  el.appendChild(button(t("common.back"), CREATION_BUTTONS.back, () => o.onBack()));

  const showError = (on: boolean): void => {
    error.style.visibility = on ? "visible" : "hidden";
  };

  const reset = (): void => {
    inputs.forEach((x, i) => {
      x.value = members[i]?.defaultName ?? "";
    });
    choices = defaultPersonalities(ids, size);
    renderChoices();
    showError(false);
  };
  reset();

  return { el, reset, setup, showError };
}
