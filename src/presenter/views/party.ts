// UI-53 のパーティ欄（ui §2 の party 領域。既定 240×64）。見出し行は置かず、各行に HP / MP / SAN の短いラベルを付ける。
// 行の矩形は layout.ts の dungeonLayout（partyRows）。既定では行 i は領域内の y2+10i..11+10i。
// 列（x、閉区間。美咲は半角 4px・全角 8px）は PARTY_COLUMNS: 名前 2..49（全角 6 文字）、職業の略称 52..63（classes[].abbr。ASCII 3 文字）、
// HP 68..75、値 76..103（右寄せ。「999/999」）、MP 108..115、値 116..143（右寄せ）、SAN 148..159、値 160..171（右寄せ）、状態 176..237。
// MP は mpMax が 0 のメンバーではラベルごと空欄にする。
// 状態の列は、life が alive でなければ party.life.*、alive なら status の短い名前（party.status.<id>）を空白区切りで出し、
// その後ろに SAN の段の短い名前（UI-12。party.san.<stage>、normal は出さない。段は引数の stageOf = core の sanStage）。
// 戦闘の再生用に setMp / setMax（レベルの変化）/ setStatus / flash（UI-42 の被弾。opacity 2 往復）/ setActive（入力中の名前を accent 色）を持つ。
// UI-55: markActor（衝動の行動者の名前を accent 色、行を点滅。render で消える）。
// el は region の位置と大きさに自分で置く。モジュールのトップレベルでは DOM に触れない。
import type { ClassDef, StatusId, Strings } from "../../core/data/index";
import type { SanStage } from "../../core/rules/san";
import type { Character, Life } from "../../core/types";
import { PARTY_ROW_H, type Rect } from "../layout";

/**
 * abbr は職業の略称（classes[].abbr）。mp と mpLabel は mpMax が 0 なら空。
 * life は状態の列（死亡・灰、生存なら状態異常の短い名前。M2 からの欄名を保つ）
 */
export type PartyRowText = { name: string; abbr: string; hp: string; mp: string; mpLabel: string; san: string; life: string };

/** UI-12: SAN の段を決める関数（app が core の sanStage を渡す。表示層は段の境を計算しない） */
export type StageOf = (san: number, sanMax: number) => SanStage;

/**
 * 状態の列の文字列（純粋）。死亡・灰はそれだけ、生存なら状態異常の短い名前を status の順に空白区切りし、
 * その後ろに SAN の段の短い名前（UI-12。party.san.<stage>、normal は出さない）。stage の省略は normal（UI-59 の状態は段を出さない）
 */
export function conditionText(life: Life, status: readonly StatusId[], strings: Strings, stage: SanStage = "normal"): string {
  if (life !== "alive") {
    const key = `party.life.${life}`;
    return strings[key] ?? key;
  }
  const parts = status.map((st) => {
    const key = `party.status.${st}`;
    return strings[key] ?? key;
  });
  if (stage !== "normal") {
    const key = `party.san.${stage}`;
    parts.push(strings[key] ?? key);
  }
  return parts.join(" ");
}

function hpText(hp: number, hpMax: number): string {
  return `${hp}/${hpMax}`;
}

/** mpMax が 0 なら空欄（呪文を使わない職業） */
function mpText(mp: number, mpMax: number): string {
  return mpMax > 0 ? `${mp}/${mpMax}` : "";
}

/** 1 行分の表示文字列（純粋）。略称は classes[].abbr（表示のための参照。知らない職業は空）。段は stageOf（UI-12） */
export function formatPartyRow(ch: Character, strings: Strings, classes: readonly ClassDef[], stageOf: StageOf): PartyRowText {
  return {
    name: ch.name,
    abbr: classes.find((c) => c.id === ch.classId)?.abbr ?? "",
    hp: hpText(ch.hp, ch.hpMax),
    mp: mpText(ch.mp, ch.mpMax),
    mpLabel: ch.mpMax > 0 ? (strings["party.mp"] ?? "party.mp") : "",
    san: String(ch.san),
    life: conditionText(ch.life, ch.status, strings, stageOf(ch.san, ch.sanMax)),
  };
}

const ROW_H = PARTY_ROW_H;

export type PartyColumn = { left: number; width: number; right?: boolean };
/** ui §2 のパーティの行の列（行内の x と幅。並びは 名前 / 略称 / HP / MP / SAN / 状態） */
export const PARTY_COLUMNS = {
  name: { left: 2, width: 48 },
  abbr: { left: 52, width: 12 },
  hpLabel: { left: 68, width: 8 },
  hp: { left: 76, width: 28, right: true },
  mpLabel: { left: 108, width: 8 },
  mp: { left: 116, width: 28, right: true },
  sanLabel: { left: 148, width: 12 },
  san: { left: 160, width: 12, right: true },
  status: { left: 176, width: 62 },
} as const satisfies Record<string, PartyColumn>;
type ColKey = keyof typeof PARTY_COLUMNS;
const COLS: Readonly<Record<ColKey, PartyColumn>> = PARTY_COLUMNS;

type Row = {
  line: HTMLElement;
  cells: Record<ColKey, HTMLElement>;
  hp: number;
  hpMax: number;
  mp: number;
  mpMax: number;
  life: Life;
  status: StatusId[];
  san: number;
  sanMax: number;
};

export type PartyPanel = {
  el: HTMLElement;
  render(party: readonly Character[]): void;
  setHp(id: string, hp: number): void;
  setSan(id: string, san: number): void;
  setLife(id: string, life: Life): void;
  setMp(id: string, mp: number): void;
  /** levelUp / levelDown（CH-61 / CH-62）: 最大値を変えて HP / MP の列を描き直す（MP のラベルも mpMax に合わせる） */
  setMax(id: string, hpMax: number, mpMax: number): void;
  /** 状態異常を 1 つ付ける（on）か外す。life が alive でない間は列に死亡・灰を出したまま */
  setStatus(id: string, status: StatusId, on: boolean): void;
  /** UI-42 の被弾: その行の opacity を 2 往復（ms が 0 以下なら何もせずに解決） */
  flash(id: string, ms: number): Promise<void>;
  /** 入力中のメンバーの名前を accent 色にする（null で解除） */
  setActive(id: string | null): void;
  /**
   * UI-55: 衝動の行動者の名前を accent 色にし、blink なら行を点滅させる（ACTOR_BLINK_MS の矩形波、iterations Infinity）。
   * null で点滅を止めて色を戻す。setActive と共存する（どちらかに当たれば accent）
   */
  markActor(id: string | null, blink: boolean): void;
};

/** UI-55: 衝動の行動者の行の点滅の周期（ms） */
export const ACTOR_BLINK_MS = 400;

/** region は ui §2 の party 領域、rows は行 0..party.size-1 の矩形（どちらもステージ座標）。classes は略称（abbr）の参照 */
export function createPartyPanel(o: {
  strings: Strings;
  classes: readonly ClassDef[];
  region: Rect;
  rows: readonly Rect[];
  /** UI-12: SAN の段（app が core の sanStage を渡す） */
  stageOf: StageOf;
}): PartyPanel {
  const { strings, classes, region, rows, stageOf } = o;
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
      const c = COLS[k];
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
    cells.sanLabel.textContent = strings["party.san"] ?? "party.san";
    cells.status.style.color = "var(--c-danger)";
    el.appendChild(line);
    return { line, cells, hp: 0, hpMax: 0, mp: 0, mpMax: 0, life: "alive", status: [], san: 0, sanMax: 0 };
  };

  const showCondition = (row: Row): void => {
    row.cells.status.textContent = conditionText(row.life, row.status, strings, stageOf(row.san, row.sanMax));
  };

  let active: string | null = null;
  /** UI-55: 衝動の行動者（null なら無し）と、その行の点滅 */
  let marked: string | null = null;
  let blinkAnim: Animation | null = null;
  const stopBlink = (): void => {
    if (blinkAnim !== null) blinkAnim.cancel();
    blinkAnim = null;
  };
  const paintActive = (): void => {
    for (const [id, row] of byId) row.cells.name.style.color = id === active || id === marked ? "var(--c-accent)" : "";
  };

  return {
    el,
    render(party: readonly Character[]): void {
      // 行を作り直すので、行動者の印と点滅も消す
      stopBlink();
      marked = null;
      el.replaceChildren();
      byId.clear();
      party.forEach((ch, i) => {
        const row = makeRow(i);
        const t = formatPartyRow(ch, strings, classes, stageOf);
        row.cells.name.textContent = t.name;
        row.cells.abbr.textContent = t.abbr;
        row.cells.hp.textContent = t.hp;
        row.cells.mpLabel.textContent = t.mpLabel;
        row.cells.mp.textContent = t.mp;
        row.cells.san.textContent = t.san;
        row.cells.status.textContent = t.life;
        row.hp = ch.hp;
        row.hpMax = ch.hpMax;
        row.mp = ch.mp;
        row.mpMax = ch.mpMax;
        row.life = ch.life;
        row.status = ch.status.slice();
        row.san = ch.san;
        row.sanMax = ch.sanMax;
        byId.set(ch.id, row);
      });
      paintActive();
    },
    setHp(id: string, hp: number): void {
      const row = byId.get(id);
      if (row === undefined) return;
      row.hp = hp;
      row.cells.hp.textContent = hpText(hp, row.hpMax);
    },
    setSan(id: string, san: number): void {
      const row = byId.get(id);
      if (row === undefined) return;
      row.san = san;
      row.cells.san.textContent = String(san);
      // UI-12: 段が変わりうるので状態の列も描き直す
      showCondition(row);
    },
    setLife(id: string, life: Life): void {
      const row = byId.get(id);
      if (row === undefined) return;
      row.life = life;
      showCondition(row);
    },
    setMp(id: string, mp: number): void {
      const row = byId.get(id);
      if (row === undefined) return;
      row.mp = mp;
      row.cells.mp.textContent = mpText(mp, row.mpMax);
    },
    setMax(id: string, hpMax: number, mpMax: number): void {
      const row = byId.get(id);
      if (row === undefined) return;
      row.hpMax = hpMax;
      row.mpMax = mpMax;
      row.cells.hp.textContent = hpText(row.hp, hpMax);
      row.cells.mp.textContent = mpText(row.mp, mpMax);
      row.cells.mpLabel.textContent = mpMax > 0 ? (strings["party.mp"] ?? "party.mp") : "";
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
    markActor(id: string | null, blink: boolean): void {
      stopBlink();
      marked = id;
      paintActive();
      const row = id === null ? undefined : byId.get(id);
      if (row === undefined || !blink) return;
      blinkAnim = row.line.animate(
        [
          { opacity: 1, offset: 0 },
          { opacity: 1, offset: 0.5 },
          { opacity: 0, offset: 0.5 },
          { opacity: 0, offset: 1 },
        ],
        { duration: ACTOR_BLINK_MS, iterations: Infinity },
      );
    },
  };
}
