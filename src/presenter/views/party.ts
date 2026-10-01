// UI-53 のパーティ欄（ui §2 の party 領域 240×64）。見出し行は置かず、各行に HP / MP / SAN の短いラベルを付ける。
// 行 i は領域内の y2+10i..11+10i。列（x）: 名前 2..49、HP 52..59、値 60..91（右寄せ）、MP 96..103、値 104..127、
// SAN 132..143、値 144..155（右寄せ）、状態 160..237。
// el の配置（left / top）は呼び出し側が決める。モジュールのトップレベルでは DOM に触れない。
import type { Strings } from "../../core/data/index";
import type { Character, Life } from "../../core/types";

export type PartyRowText = { name: string; hp: string; mp: string; san: string; life: string };

function lifeText(life: Life, strings: Strings): string {
  if (life === "alive") return "";
  const key = `party.life.${life}`;
  return strings[key] ?? key;
}

function hpText(hp: number, hpMax: number): string {
  return `${hp}/${hpMax}`;
}

function mpText(mp: number, mpMax: number): string {
  return `${mp}/${mpMax}`;
}

/** 1 行分の表示文字列（純粋） */
export function formatPartyRow(ch: Character, strings: Strings): PartyRowText {
  return {
    name: ch.name,
    hp: hpText(ch.hp, ch.hpMax),
    mp: mpText(ch.mp, ch.mpMax),
    san: String(ch.san),
    life: lifeText(ch.life, strings),
  };
}

const ROW_TOP = 2;
const ROW_H = 10;

type Col = { left: number; width: number; right?: boolean };
const COLS = {
  name: { left: 2, width: 48 },
  hpLabel: { left: 52, width: 8 },
  hp: { left: 60, width: 32, right: true },
  mpLabel: { left: 96, width: 8 },
  mp: { left: 104, width: 24 },
  sanLabel: { left: 132, width: 12 },
  san: { left: 144, width: 12, right: true },
  life: { left: 160, width: 78 },
} as const satisfies Record<string, Col>;
type ColKey = keyof typeof COLS;

type Row = { cells: Record<ColKey, HTMLElement>; hpMax: number };

export type PartyPanel = {
  el: HTMLElement;
  render(party: readonly Character[]): void;
  setHp(id: string, hp: number): void;
  setSan(id: string, san: number): void;
  setLife(id: string, life: Life): void;
};

export function createPartyPanel(strings: Strings): PartyPanel {
  const el = document.createElement("div");
  el.className = "party-panel";
  Object.assign(el.style, { position: "absolute", width: "240px", height: "64px", color: "var(--c-text)" });

  const rows = new Map<string, Row>();

  const makeRow = (i: number): Row => {
    const line = document.createElement("div");
    line.className = "party-row";
    Object.assign(line.style, {
      position: "absolute",
      left: "0px",
      top: `${ROW_TOP + ROW_H * i}px`,
      width: "240px",
      height: `${ROW_H}px`,
      lineHeight: `${ROW_H}px`,
    });
    const cells = {} as Record<ColKey, HTMLElement>;
    for (const k of Object.keys(COLS) as ColKey[]) {
      const c: Col = COLS[k];
      const span = document.createElement("span");
      Object.assign(span.style, {
        position: "absolute",
        left: `${c.left}px`,
        top: "0px",
        width: `${c.width}px`,
        height: `${ROW_H}px`,
        overflow: "hidden",
        whiteSpace: "nowrap",
        textAlign: c.right === true ? "right" : "left",
      });
      line.appendChild(span);
      cells[k] = span;
    }
    cells.hpLabel.textContent = strings["party.hp"] ?? "party.hp";
    cells.mpLabel.textContent = strings["party.mp"] ?? "party.mp";
    cells.sanLabel.textContent = strings["party.san"] ?? "party.san";
    cells.life.style.color = "var(--c-danger)";
    el.appendChild(line);
    return { cells, hpMax: 0 };
  };

  return {
    el,
    render(party: readonly Character[]): void {
      el.replaceChildren();
      rows.clear();
      party.forEach((ch, i) => {
        const row = makeRow(i);
        const t = formatPartyRow(ch, strings);
        row.cells.name.textContent = t.name;
        row.cells.hp.textContent = t.hp;
        row.cells.mp.textContent = t.mp;
        row.cells.san.textContent = t.san;
        row.cells.life.textContent = t.life;
        row.hpMax = ch.hpMax;
        rows.set(ch.id, row);
      });
    },
    setHp(id: string, hp: number): void {
      const row = rows.get(id);
      if (row !== undefined) row.cells.hp.textContent = hpText(hp, row.hpMax);
    },
    setSan(id: string, san: number): void {
      const row = rows.get(id);
      if (row !== undefined) row.cells.san.textContent = String(san);
    },
    setLife(id: string, life: Life): void {
      const row = rows.get(id);
      if (row !== undefined) row.cells.life.textContent = lifeText(life, strings);
    },
  };
}
