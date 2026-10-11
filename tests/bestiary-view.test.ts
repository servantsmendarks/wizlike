// UI-79（M18。設計 5-5）: 酒場の敵の図鑑（views/camp.ts の bestiary の段・formatBestiary・パネルの DOM）。
// 値は core の bestiaryView（tests/item-view.test.ts で数えた値）だけ。絵は戦闘と同じ chooseSprite（UI-60）で、一覧（GameAssets.sprites）に無ければ塗るだけ。
import { afterEach, describe, expect, test, vi } from "vitest";
import { campMenu } from "../src/core/rules/camp";
import { fieldItemMenu } from "../src/core/rules/items";
import { bestiaryView } from "../src/core/rules/item-view";
import { cloneState } from "../src/core/state";
import type { GameState } from "../src/core/types";
import { PALETTE } from "../src/presenter/palette";
import {
  BESTIARY_LAYOUT,
  bestiaryWindowStart,
  campCharacterOpen,
  campEntries,
  campFirstPage,
  campHeader,
  campPanel,
  campRepair,
  campRows,
  campStep,
  createCampView,
  formatBestiary,
  type CampInput,
} from "../src/presenter/views/camp";
import { enemyFill } from "../src/presenter/views/battle";
import { formatMessage } from "../src/presenter/views/message";
import { data, newGame } from "./helpers/core";
import { kinsokuLines } from "./helpers/wrap";

const S = data.strings;
const town = (): GameState => cloneState(newGame(1));
const nameOf = (id: string): string => data.monsters.find((m) => m.id === id)!.name;
function input(s: GameState): CampInput {
  const menu = campMenu(s, data);
  if (menu === null) throw new Error("camp closed");
  return { menu, items: fieldItemMenu(s, data), summary: null, identifyMpCost: data.config.identify.mpCost, bestiary: bestiaryView(s, data) };
}
/** kobold（7 体）・giant_rat（0 体）を識別済み、giant_spider は遭遇しただけ */
function known(): GameState {
  const s = town();
  s.bestiary["kobold"] = { kills: 7, identified: true };
  s.bestiary["giant_rat"] = { kills: 0, identified: true };
  s.bestiary["giant_spider"] = { kills: 3, identified: false };
  return s;
}

describe("UI-79 酒場の敵の図鑑の段（純粋な状態機械）", () => {
  test("UI-79 酒場の「敵の図鑑」は bestiary の段（focus 0）: 問いは「敵の図鑑」、パネルは bestiary、キャラクター画面ではない。やめるで酒場の一覧へ閉じる", () => {
    const m = input(known());
    const page = campFirstPage("tavern", "bestiary", m.menu);
    expect(page).toEqual({ kind: "bestiary", focus: 0 });
    expect(campHeader(page, m, S)).toBe("敵の図鑑");
    expect(campPanel(page, m, S)).toEqual({ kind: "bestiary", focus: 0 });
    expect(campCharacterOpen(page)).toBe(false);
    expect(campStep("tavern", page, m, { kind: "cancel" })).toEqual({ kind: "close" });
    expect(campRepair("tavern", page, m)).toEqual(page);
  });

  test("UI-79 2 体以上なら [次の敵][前の敵]（最後・最初で dim）とやめる。pageTurn で focus を動かし、範囲の外へは動かない", () => {
    const m = input(known());
    const cancel = { label: "やめる", disabled: false, choice: { kind: "cancel" } };
    const at = (focus: number) => campEntries("tavern", { kind: "bestiary", focus }, m, S);
    expect(at(0)).toEqual({
      layout: "list",
      rows: [
        { label: "次の敵", disabled: false, choice: { kind: "pageTurn", delta: 1 } },
        { label: "前の敵", disabled: true, choice: { kind: "pageTurn", delta: -1 } },
        cancel,
      ],
    });
    expect(campRows(at(1)).map((r) => r?.disabled)).toEqual([true, false, false]);
    const step = (focus: number, delta: 1 | -1) => campStep("tavern", { kind: "bestiary", focus }, m, { kind: "pageTurn", delta });
    expect(step(0, 1)).toEqual({ kind: "page", page: { kind: "bestiary", focus: 1 } });
    expect(step(1, -1)).toEqual({ kind: "page", page: { kind: "bestiary", focus: 0 } });
    expect(step(1, 1)).toEqual({ kind: "page", page: { kind: "bestiary", focus: 1 } }); // 最後の敵より先は無い
    expect(step(0, -1)).toEqual({ kind: "page", page: { kind: "bestiary", focus: 0 } });
    // 範囲の外の focus は端へ寄せる
    expect(campRepair("tavern", { kind: "bestiary", focus: 5 }, m)).toEqual({ kind: "bestiary", focus: 1 });
  });

  test("UI-79 1 体以下ならやめるだけ（頁送りの行は出さない）", () => {
    const one = town();
    one.bestiary["kobold"] = { kills: 1, identified: true };
    const cancel = { label: "やめる", disabled: false, choice: { kind: "cancel" } };
    expect(campEntries("tavern", { kind: "bestiary", focus: 0 }, input(one), S)).toEqual({ layout: "list", rows: [cancel] });
    expect(campEntries("tavern", { kind: "bestiary", focus: 0 }, input(town()), S)).toEqual({ layout: "list", rows: [cancel] });
    expect(campRepair("tavern", { kind: "bestiary", focus: 0 }, input(town()))).toEqual({ kind: "bestiary", focus: 0 });
  });
});

describe("UI-79 formatBestiary", () => {
  test("UI-79 見出しは「敵の図鑑　{known}/{total}」（分母は正体の分からない敵を含む全種類）。行は名前だけで focus の行に印、絵の下は名前と倒した数", () => {
    const p = formatBestiary(bestiaryView(known(), data), 1, S);
    expect(p).toEqual({
      kind: "bestiary",
      title: `敵の図鑑　2/${data.monsters.length}`,
      rows: [
        { text: nameOf("giant_rat"), focused: false },
        { text: nameOf("kobold"), focused: true },
      ],
      empty: null,
      pick: { monsterId: "kobold", name: nameOf("kobold"), kills: "倒した数 7" },
    });
    // 正体の分からない敵（giant_spider）の名前は出ない
    expect(JSON.stringify(p)).not.toContain(nameOf("giant_spider"));
  });

  test("UI-79 1 体もいなければ bestiary.none の 1 行（dim で描く）と見出しだけ。絵は無い", () => {
    const p = formatBestiary(bestiaryView(town(), data), 0, S);
    expect(p.title).toBe(`敵の図鑑　0/${data.monsters.length}`);
    expect(p.rows).toEqual([]);
    expect(p.empty).toBe(S["bestiary.none"]);
    expect(p.pick).toBeNull();
  });

  test("UI-79 文の長さ: 見出し（3 桁/3 桁）は 28 字、名前の列（128px）は最長の敵の名前が全角 16 字以内、絵の下（100px）は名前と倒した数（5 桁）が全角 12 字以内、ボタンは 4 字以内", () => {
    expect(kinsokuLines(formatMessage(S["bestiary.title"]!, { known: 999, total: 999 }), 28)).toHaveLength(1);
    expect(kinsokuLines(S["bestiary.none"]!, 28)).toHaveLength(1);
    const longest = Math.max(...data.monsters.map((m) => Array.from(m.name).length));
    expect(longest * 8).toBeLessThanOrEqual(BESTIARY_LAYOUT.list.width);
    expect(longest * 8).toBeLessThanOrEqual(BESTIARY_LAYOUT.caption.width);
    // 倒した数: 全角 4 字 + 半角（空白 1 + 数字 5）= 8×4 + 4×6 = 56px
    const kills = formatMessage(S["bestiary.kills"]!, { kills: 99999 });
    const px = Array.from(kills).reduce((n, c) => n + (c.charCodeAt(0) < 0x80 ? 4 : 8), 0);
    expect(px).toBeLessThanOrEqual(BESTIARY_LAYOUT.caption.width);
    for (const k of ["bestiary.next", "bestiary.prev", "camp.bestiary", "camp.book"]) expect(Array.from(S[k]!).length, k).toBeLessThanOrEqual(5);
    // 酒場の一覧の行（21 字）と問いの見出し（28 字）
    for (const k of ["camp.bestiary", "camp.book"]) expect(kinsokuLines(S[k]!, 21)).toHaveLength(1);
    expect(kinsokuLines(S["camp.prompt.bestiary"]!, 28)).toHaveLength(1);
  });

  test("UI-79 全種類を識別しても名前の一覧は layout.character（240×284）の見出しの下に収まる（今の 20 種。越えたら focus が見える範囲へずらす）", () => {
    const visible = Math.floor((284 - 4) / 10) - 1;
    expect(data.monsters.length).toBeLessThanOrEqual(visible);
    expect(bestiaryWindowStart(20, 19, 27)).toBe(0);
    expect(bestiaryWindowStart(30, 0, 27)).toBe(0);
    expect(bestiaryWindowStart(30, 26, 27)).toBe(0);
    expect(bestiaryWindowStart(30, 27, 27)).toBe(1);
    expect(bestiaryWindowStart(30, 29, 27)).toBe(3);
  });
});

class FakeEl {
  style: Record<string, string> = {};
  className = "";
  textContent = "";
  alt = "";
  draggable = true;
  src = "";
  children: FakeEl[] = [];
  listeners: Record<string, () => void> = {};
  appendChild(c: FakeEl): FakeEl {
    this.children.push(c);
    return c;
  }
  replaceChildren(...c: FakeEl[]): void {
    this.children = c;
  }
  addEventListener(type: string, f: () => void): void {
    this.listeners[type] = f;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("UI-79 敵の図鑑のパネルの DOM", () => {
  const RECT = { x: 0, y: 16, w: 240, h: 150 };
  const TALL = { x: 0, y: 16, w: 240, h: 284 };
  const art = (sprites: Record<string, { w: number; h: number }>) => ({ data, sprites });

  test("UI-79/UI-60 tallRect に広げ、見出し・名前の一覧（focus は accent）・絵の枠（96 角。48 の絵は 2 倍で中央）・名前と倒した数を置く", () => {
    vi.stubGlobal("document", { createElement: (): FakeEl => new FakeEl() });
    const v = createCampView(RECT, TALL, art({ kobold: { w: 48, h: 48 } }));
    v.render(formatBestiary(bestiaryView(known(), data), 1, S));
    const el = v.el as unknown as FakeEl;
    expect([el.style["top"], el.style["height"]]).toEqual(["16px", "284px"]);
    const texts = el.children.filter((c) => c.className !== "camp-bestiary-picture").map((c) => [c.className, c.textContent, c.style["top"], c.style["left"], c.style["color"]]);
    expect(texts).toEqual([
      ["camp-title", `敵の図鑑　2/${data.monsters.length}`, "4px", "4px", "var(--c-accent)"],
      ["camp-bestiary-row", nameOf("giant_rat"), "14px", "4px", undefined],
      ["camp-bestiary-row", nameOf("kobold"), "24px", "4px", "var(--c-accent)"],
      ["camp-bestiary-name", nameOf("kobold"), "114px", "136px", "var(--c-accent)"],
      ["camp-bestiary-kills", "倒した数 7", "124px", "136px", undefined],
    ]);
    const box = el.children.find((c) => c.className === "camp-bestiary-picture")!;
    expect([box.style["left"], box.style["top"], box.style["width"], box.style["height"]]).toEqual(["136px", "14px", "96px", "96px"]);
    const img = box.children[0]!;
    expect(img.src).toMatch(/sprites\/kobold\.png$/);
    expect([img.style["left"], img.style["top"], img.style["width"], img.style["height"], img.style["imageRendering"]]).toEqual(["0px", "0px", "96px", "96px", "pixelated"]);
    // 読めなければ戦闘と同じ塗り
    img.listeners["error"]!();
    expect(img.style["display"]).toBe("none");
    expect(box.style["background"]).toBe(PALETTE[enemyFill(data, "kobold", true)]);
    // 名前の列と絵の枠は重ならない
    expect(BESTIARY_LAYOUT.list.left + BESTIARY_LAYOUT.list.width).toBeLessThanOrEqual(BESTIARY_LAYOUT.picture.x);
    expect(BESTIARY_LAYOUT.picture.x + BESTIARY_LAYOUT.picture.size).toBeLessThanOrEqual(240);
    expect(BESTIARY_LAYOUT.caption.left + BESTIARY_LAYOUT.caption.width).toBeLessThanOrEqual(240);
    expect(BESTIARY_LAYOUT.picture.y + BESTIARY_LAYOUT.picture.size).toBeLessThanOrEqual(4 + 10 * BESTIARY_LAYOUT.caption.row);
  });

  test("UI-79/UI-60 96 角の絵（ボス）は等倍。絵の一覧に無い敵は読みに行かず塗るだけ。見出しだけの空の図鑑は dim の 1 行", () => {
    vi.stubGlobal("document", { createElement: (): FakeEl => new FakeEl() });
    const boss = data.monsters.find((m) => m.special.boss === true)!;
    const s = town();
    s.bestiary[boss.id] = { kills: 1, identified: true };
    s.bestiary["kobold"] = { kills: 2, identified: true };
    const v = createCampView(RECT, TALL, art({ [boss.sprite]: { w: 96, h: 96 } }));
    const view = bestiaryView(s, data);
    const bi = view.rows.findIndex((r) => r.monsterId === boss.id);
    v.render(formatBestiary(view, bi, S));
    const el = v.el as unknown as FakeEl;
    const pic = () => el.children.find((c) => c.className === "camp-bestiary-picture")!;
    expect(pic().children[0]!.style["width"]).toBe("96px");
    expect(pic().children[0]!.src).toMatch(new RegExp(`sprites/${boss.sprite}\\.png$`));
    v.render(formatBestiary(view, view.rows.findIndex((r) => r.monsterId === "kobold"), S));
    expect(pic().children).toEqual([]);
    expect(pic().style["background"]).toBe(PALETTE[enemyFill(data, "kobold", true)]);
    v.render(formatBestiary(bestiaryView(town(), data), 0, S));
    expect(el.children.map((c) => [c.textContent, c.style["color"]])).toEqual([
      [`敵の図鑑　0/${data.monsters.length}`, "var(--c-accent)"],
      [S["bestiary.none"], "var(--c-dim)"],
    ]);
  });
});
