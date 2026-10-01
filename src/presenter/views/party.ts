// UI-53 のパーティ欄（ui §2 の party 領域。既定 240×64）。見出し行は置かず、各行に HP / MP / SAN の短いラベルを付ける。
// 行の矩形は layout.ts の dungeonLayout（partyRows）。既定では行 i は領域内の y2+10i..11+10i。列（x）: 名前 2..49、HP 52..59、値 60..91（右寄せ）、MP 96..103、値 104..127、
// SAN 132..143、値 144..155（右寄せ）、状態 160..237。
// 状態の列は、life が alive でなければ party.life.*、alive なら status の短い名前（party.status.<id>）を空白区切りで出す。
// 戦闘の再生用に setMp / setStatus / flash（UI-42 の被弾。opacity 2 往復）/ setActive（入力中の名前を accent 色）を持つ。
// el は region の位置と大きさに自分で置く。モジュールのトップレベルでは DOM に触れない。
import type { StatusId, Strings } from "../../core/data/index";
import type { Character, Life } from "../../core/types";
import { PARTY_ROW_H, type Rect } from "../layout";

/** life は状態の列（死亡・灰、生存なら状態異常の短い名前。M2 からの欄名を保つ） */
export type PartyRowText = { name: string; hp: string; mp: string; san: string; life: string };

/** 状態の列の文字列（純粋）。死亡・灰はそれだけ、生存なら状態異常の短い名前を status の順に空白区切り */
function conditionText(life: Life, status: readonly StatusId[], strings: Strings): string {
  if (life !== "alive") {
    const key = `party.life.${life}`;
    return strings[key] ?? key;
  }
  return status
    .map((st) => {
      const key = `party.status.${st}`;
      return strings[key] ?? key;
    })
    .join(" ");
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
    life: conditionText(ch.life, ch.status, strings),
  };
}

const ROW_H = PARTY_ROW_H;

type Col = { left: number; width: number; right?: boolean };
const COLS = {
  name: { left: 2, width: 48 },
  hpLabel: { left: 52, width: 8 },
  hp: { left: 60, width: 32, right: true },
  mpLabel: { left: 96, width: 8 },
  mp: { left: 104, width: 24 },
  sanLabel: { left: 132, width: 12 },
  san: { left: 144, width: 12, right: true },
  status: { left: 160, width: 78 },
} as const satisfies Record<string, Col>;
type ColKey = keyof typeof COLS;

type Row = { line: HTMLElement; cells: Record<ColKey, HTMLElement>; hpMax: number; mpMax: number; life: Life; status: StatusId[] };

export type PartyPanel = {
  el: HTMLElement;
  render(party: readonly Character[]): void;
  setHp(id: string, hp: number): void;
  setSan(id: string, san: number): void;
  setLife(id: string, life: Life): void;
  setMp(id: string, mp: number): void;
  /** 状態異常を 1 つ付ける（on）か外す。life が alive でない間は列に死亡・灰を出したまま */
  setStatus(id: string, status: StatusId, on: boolean): void;
  /** UI-42 の被弾: その行の opacity を 2 往復（ms が 0 以下なら何もせずに解決） */
  flash(id: string, ms: number): Promise<void>;
  /** 入力中のメンバーの名前を accent 色にする（null で解除） */
  setActive(id: string | null): void;
};

/** region は ui §2 の party 領域、rows は行 0..party.size-1 の矩形（どちらもステージ座標） */
export function createPartyPanel(strings: Strings, region: Rect, rows: readonly Rect[]): PartyPanel {
  const el = document.createElement("div");
  el.className = "party-panel";
  Object.assign(el.style, {
    position: "absolute",
    left: `${region.x}px`,
    top: `${region.y}px`,
    width: `${region.w}px`,
    height: `${region.h}px`,
    color: "var(--c-text)",
  });
  /** 行 i の領域内の top。rows より多い行（CH-01 で起きない）は 10px ずつ下へ */
  const rowTop = (i: number): number => {
    const r = rows[i];
    if (r !== undefined) return r.y - region.y;
    return (rows[0] === undefined ? 0 : rows[0].y - region.y) + ROW_H * i;
  };

  const byId = new Map<string, Row>();

  const makeRow = (i: number): Row => {
    const line = document.createElement("div");
    line.className = "party-row";
    Object.assign(line.style, {
      position: "absolute",
      left: "0px",
      top: `${rowTop(i)}px`,
      width: `${region.w}px`,
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
    cells.status.style.color = "var(--c-danger)";
    el.appendChild(line);
    return { line, cells, hpMax: 0, mpMax: 0, life: "alive", status: [] };
  };

  const showCondition = (row: Row): void => {
    row.cells.status.textContent = conditionText(row.life, row.status, strings);
  };

  let active: string | null = null;
  const paintActive = (): void => {
    for (const [id, row] of byId) row.cells.name.style.color = id === active ? "var(--c-accent)" : "";
  };

  return {
    el,
    render(party: readonly Character[]): void {
      el.replaceChildren();
      byId.clear();
      party.forEach((ch, i) => {
        const row = makeRow(i);
        const t = formatPartyRow(ch, strings);
        row.cells.name.textContent = t.name;
        row.cells.hp.textContent = t.hp;
        row.cells.mp.textContent = t.mp;
        row.cells.san.textContent = t.san;
        row.cells.status.textContent = t.life;
        row.hpMax = ch.hpMax;
        row.mpMax = ch.mpMax;
        row.life = ch.life;
        row.status = ch.status.slice();
        byId.set(ch.id, row);
      });
      paintActive();
    },
    setHp(id: string, hp: number): void {
      const row = byId.get(id);
      if (row !== undefined) row.cells.hp.textContent = hpText(hp, row.hpMax);
    },
    setSan(id: string, san: number): void {
      const row = byId.get(id);
      if (row !== undefined) row.cells.san.textContent = String(san);
    },
    setLife(id: string, life: Life): void {
      const row = byId.get(id);
      if (row === undefined) return;
      row.life = life;
      showCondition(row);
    },
    setMp(id: string, mp: number): void {
      const row = byId.get(id);
      if (row !== undefined) row.cells.mp.textContent = mpText(mp, row.mpMax);
    },
    setStatus(id: string, status: StatusId, on: boolean): void {
      const row = byId.get(id);
      if (row === undefined) return;
      const has = row.status.includes(status);
      if (on && !has) row.status = [...row.status, status];
      else if (!on && has) row.status = row.status.filter((st) => st !== status);
      showCondition(row);
    },
    async flash(id: string, ms: number): Promise<void> {
      const row = byId.get(id);
      if (row === undefined || !(ms > 0)) return;
      const a = row.line.animate([{ opacity: 1 }, { opacity: 0 }, { opacity: 1 }, { opacity: 0 }, { opacity: 1 }], {
        duration: ms,
        easing: "steps(4, end)",
      });
      try {
        await a.finished;
      } catch {
        // cancel（要素の作り直しなど）。そのまま先へ進む
      }
    },
    setActive(id: string | null): void {
      active = id;
      paintActive();
    },
  };
}
