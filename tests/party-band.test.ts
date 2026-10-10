// UI-13（M8.5）: 街のパーティの帯（views/party-band.ts の純粋な部分）
import { afterEach, describe, expect, test, vi } from "vitest";
import { sanStage } from "../src/core/rules/san";
import type { Character } from "../src/core/types";
import { tapSpecOf } from "../src/presenter/input/tap";
import { dungeonLayout, regions, townLayout } from "../src/presenter/layout";
import { createHeader, navTrianglePath } from "../src/presenter/views/header";
import { bandCell, BAND_CELL_UNITS, createPartyBand, fitName, textUnits } from "../src/presenter/views/party-band";
import { createTownPicture, townPictureUrl } from "../src/presenter/views/town-picture";
import { data, newGame } from "./helpers/core";

const S = data.strings;
// @types/node は入れていないので node の fs は文字列の動的 import で読み、型は手で書く（message.test.ts と同じ）
const FS_MODULE = "node:fs";
const fs = (await import(/* @vite-ignore */ FS_MODULE)) as { readFileSync(p: URL, enc: "utf8"): string };
type Box = { x: number; y: number; w: number; h: number };
const overlap = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const ch = (name: string, p: Partial<Pick<Character, "life" | "status">> = {}): Pick<Character, "name" | "life" | "status"> => ({
  name,
  life: p.life ?? "alive",
  status: p.status ?? [],
});

describe("UI-13 bandCell", () => {
  test("UI-13 bandCell: 正常は印なしの text。全角 5 字までは全文、6 字は 4 字＋…（10 単位）。半角（ASCII・半角カナ）は 1 単位", () => {
    expect(bandCell(ch("アルド"), "normal", S)).toEqual({ label: "アルド", mark: "", levelMark: "", role: "text" });
    expect(bandCell(ch("アルドリン"), "normal", S).label).toBe("アルドリン");
    expect(bandCell(ch("アルドリンド"), "normal", S).label).toBe("アルドリ…");
    expect(bandCell(ch("Aldorin"), "normal", S).label).toBe("Aldorin");
    expect(bandCell(ch("Aldorinson"), "normal", S).label).toBe("Aldorinson");
    expect(bandCell(ch("Aldorinsons"), "normal", S).label).toBe("Aldorins…");
    expect(bandCell(ch("ｱﾙﾄﾞﾘﾝﾄﾞ"), "normal", S).label).toBe("ｱﾙﾄﾞﾘﾝﾄﾞ");
    for (const n of ["アルドリンド", "Aldorinsons", "アルドABCDEF"]) expect(textUnits(bandCell(ch(n), "normal", S).label), n).toBeLessThanOrEqual(BAND_CELL_UNITS);
    expect(S["town.band.ellipsis"]).toBe("…");
    expect(fitName("あいうえおか", 10, S["town.band.ellipsis"]!)).toBe("あいうえ…");
    expect(fitName("あいうえお", 10, S["town.band.ellipsis"]!)).toBe("あいうえお");
    expect(fitName("あいうえおか", 10, "~")).toBe("あいうえ~");
  });

  test("UI-13 bandCell: 印は 1 人に 1 つで、優先順は 灰 > 死亡 > 石 > 痺 > 眠 > 毒 > 虚脱 > 錯乱 > 不安。印があれば 6 字の名前は 3 字＋…＋印", () => {
    expect(bandCell(ch("アルド", { life: "ash", status: ["poison"] }), "broken", S)).toEqual({ label: "アルド灰", mark: "灰", levelMark: "", role: "dim" });
    expect(bandCell(ch("アルド", { life: "dead", status: ["stone"] }), "broken", S)).toEqual({ label: "アルド死", mark: "死", levelMark: "", role: "danger" });
    expect(bandCell(ch("アルド", { status: ["poison", "sleep", "paralysis", "stone"] }), "broken", S)).toMatchObject({ mark: "石", role: "status" });
    expect(bandCell(ch("アルド", { status: ["poison", "sleep", "paralysis"] }), "normal", S)).toMatchObject({ mark: "痺", role: "status" });
    expect(bandCell(ch("アルド", { status: ["poison", "sleep"] }), "normal", S)).toMatchObject({ mark: "眠", role: "status" });
    expect(bandCell(ch("アルド", { status: ["poison"] }), "uneasy", S)).toMatchObject({ mark: "毒", role: "status" });
    expect(bandCell(ch("アルド"), "broken", S)).toEqual({ label: "アルド虚", mark: "虚", levelMark: "", role: "san" });
    expect(bandCell(ch("アルド"), "confused", S)).toMatchObject({ mark: "錯", role: "san" });
    expect(bandCell(ch("アルド"), "uneasy", S)).toMatchObject({ mark: "不", role: "san" });
    expect(bandCell(ch("アルドリンド", { life: "dead" }), "normal", S).label).toBe("アルド…死");
    expect(bandCell(ch("アルドリン", { status: ["poison"] }), "normal", S).label).toBe("アルド…毒");
    expect(bandCell(ch("アルドリ", { status: ["poison"] }), "normal", S).label).toBe("アルドリ毒");
  });

  test("UI-69 bandCell: Lv UP 可（levelUp）の者は名前の後ろに↑。状態の印と別枠で「名前…＋状態の印＋↑」。6 字は ↑だけなら 3 字＋…＋↑、状態の印もあれば 2 字＋…＋印＋↑", () => {
    const up = S["town.band.mark.levelUp"]!;
    expect(up).toBe("↑");
    expect(textUnits(up)).toBe(2);
    expect(bandCell(ch("アルドリンド"), "normal", S, true)).toEqual({ label: "アルド…↑", mark: "", levelMark: "↑", role: "text" });
    expect(bandCell(ch("アルドリンド", { status: ["poison"] }), "normal", S, true)).toEqual({ label: "アル…毒↑", mark: "毒", levelMark: "↑", role: "status" });
    expect(bandCell(ch("アルドリンド"), "uneasy", S, true)).toEqual({ label: "アル…不↑", mark: "不", levelMark: "↑", role: "san" });
    // 短い名前は切らない
    expect(bandCell(ch("アルド", { status: ["poison"] }), "normal", S, true).label).toBe("アルド毒↑");
    expect(bandCell(ch("アルドリ"), "normal", S, true).label).toBe("アルドリ↑");
    for (const n of ["アルドリンド", "Aldorinsons", "アルドABCDEF"])
      for (const st of [[], ["poison"]] as const) expect(textUnits(bandCell(ch(n, { status: [...st] }), "normal", S, true).label), n).toBeLessThanOrEqual(BAND_CELL_UNITS);
    // levelUp の省略・false は今の出力と同じ
    for (const n of ["アルド", "アルドリンド"]) {
      expect(bandCell(ch(n), "normal", S, false)).toEqual(bandCell(ch(n), "normal", S));
      expect(bandCell(ch(n), "normal", S).levelMark).toBe("");
    }
  });

  test("UI-13 帯の印の文言は strings にある 1 字（死亡・灰・SAN の段は town.band.mark.*、状態異常は party.status.*）", () => {
    for (const k of ["town.band.mark.ash", "town.band.mark.dead", "town.band.mark.uneasy", "town.band.mark.confused", "town.band.mark.broken"]) {
      expect(S[k], k).toBeDefined();
      expect(textUnits(S[k]!), k).toBe(2);
    }
    for (const st of ["poison", "paralysis", "sleep", "stone"]) expect(textUnits(S[`party.status.${st}`]!), st).toBe(2);
  });
});

// ---- DOM（node 環境なので document を最小の偽物に差し替える。controls.test.ts と同じ形）
class FakeEl {
  style: Record<string, string> = {};
  className = "";
  textContent = "";
  children: FakeEl[] = [];
  listeners = new Map<string, Array<() => void>>();
  [k: string]: unknown;
  setAttribute(): void {}
  appendChild(c: FakeEl): FakeEl {
    this.children.push(c);
    return c;
  }
  replaceChildren(...c: FakeEl[]): void {
    this.children = c;
  }
  remove(): void {}
  addEventListener(type: string, f: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), f]);
  }
  fire(type: string): void {
    for (const f of this.listeners.get(type) ?? []) f();
  }
}

function fakeDocument(): FakeEl[] {
  const created: FakeEl[] = [];
  vi.stubGlobal("document", {
    createElement(tag: string): FakeEl {
      const e = new FakeEl();
      e["tagName"] = tag.toUpperCase();
      created.push(e);
      return e;
    },
    // M16（UI-59）: ヘッダーの ◀ ▶ の三角は SVG
    createElementNS(_ns: string, tag: string): FakeEl {
      const e = new FakeEl();
      e["tagName"] = tag;
      created.push(e);
      return e;
    },
  });
  return created;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 偽の document で作った要素（HTMLElement の型で返ってくるもの） */
const fake = (el: HTMLElement): FakeEl => el as unknown as FakeEl;

describe("UI-13 帯の DOM・UI-61 施設の絵・ヘッダーのログ", () => {
  const T = townLayout(regions(data.config.ui.layout, data.config.stage.width), data.config.party.size);

  test("UI-13 createPartyBand: 6 セルを帯の位置（押せる範囲 40×22）に置き、名前と印を役の色で出す。タップでその人の id、再生中の setStatus / setLife / setSan も反映する", () => {
    fakeDocument();
    const picked: string[] = [];
    const band = createPartyBand({
      strings: S,
      row: T.band.row,
      cells: T.band.cells,
      hits: T.band.hits,
      stageOf: (san, max) => sanStage(san, max, data.config),
      sanMaxOf: (ch) => ch.sanMax,
      onPick: (id) => picked.push(id),
    });
    const party = newGame(1).party;
    band.render(party);
    expect(band.el.style["top"]).toBe("166px");
    const cells = fake(band.el).children;
    expect(cells.map((c) => [c.style["left"], c.style["top"], c.style["width"], c.style["height"]])).toEqual(
      [0, 1, 2, 3, 4, 5].map((i) => [`${40 * i}px`, "0px", "40px", "22px"]),
    );
    const label = (i: number): FakeEl => cells[i]!.children[0]!;
    expect(label(0).textContent).toBe(party[0]!.name);
    expect(label(0).style["color"]).toBe("var(--c-text)");
    expect(label(0).style["height"]).toBe("10px");
    band.setStatus(party[1]!.id, "poison", true);
    expect(label(1).textContent).toBe(`${party[1]!.name}毒`);
    expect(label(1).style["color"]).toBe("var(--c-status)");
    band.setLife(party[1]!.id, "dead");
    expect(label(1).textContent).toBe(`${party[1]!.name}死`);
    expect(label(1).style["color"]).toBe("var(--c-danger)");
    band.setSan(party[2]!.id, 0);
    expect(label(2).style["color"]).toBe("var(--c-san)");
    tapSpecOf(cells[3]!)!.onTap({ lx: 0, ly: 0 });
    expect(picked).toEqual([party[3]!.id]);
  });

  test("UI-69 createPartyBand: levelUpOf が真の者に↑。setLife / setStatus / setSan は Lv の印に触れない（sync の render まで古いまま）。levelUpOf の省略は印なし", () => {
    fakeDocument();
    const party = newGame(1).party;
    const up = new Set([party[0]!.id, party[1]!.id]);
    const band = createPartyBand({
      strings: S,
      row: T.band.row,
      cells: T.band.cells,
      hits: T.band.hits,
      stageOf: (san, max) => sanStage(san, max, data.config),
      sanMaxOf: (c) => c.sanMax,
      levelUpOf: (c) => up.has(c.id),
      onPick: () => {},
    });
    band.render(party);
    const cells = fake(band.el).children;
    const label = (i: number): FakeEl => cells[i]!.children[0]!;
    expect(label(0).textContent).toBe(`${party[0]!.name}↑`);
    expect(label(2).textContent).toBe(party[2]!.name);
    band.setStatus(party[1]!.id, "poison", true);
    expect(label(1).textContent).toBe(`${party[1]!.name}毒↑`);
    expect(label(1).style["color"]).toBe("var(--c-status)");
    // 再生中に死んでも sync までは↑が残る（表示層は life で印を消さない。UI-35）
    band.setLife(party[0]!.id, "dead");
    expect(label(0).textContent).toBe(`${party[0]!.name}死↑`);
    band.setSan(party[0]!.id, 0);
    expect(label(0).textContent).toBe(`${party[0]!.name}死↑`);
    // sync の render で今の levelUpOf に揃う
    up.clear();
    band.render(party);
    expect(label(0).textContent).toBe(party[0]!.name);
    // levelUpOf の省略は印なし
    fakeDocument();
    const plain = createPartyBand({
      strings: S,
      row: T.band.row,
      cells: T.band.cells,
      hits: T.band.hits,
      stageOf: (san, max) => sanStage(san, max, data.config),
      sanMaxOf: (c) => c.sanMax,
      onPick: () => {},
    });
    plain.render(party);
    expect(fake(plain.el).children[0]!.children[0]!.textContent).toBe(party[0]!.name);
  });

  test("UI-13 帯の押せる範囲は見出しの行を含み、一覧の行と重ならない。帯のセルは button（Chrome のタッチ位置の補正で下の一覧の行に押下を取られない。B1）", () => {
    // 押せる範囲（y166..187）は見出しの行（y178..187）を縦に含み、一覧（y190..）とは重ならない
    const lo = Math.min(...T.band.hits.map((r) => r.y));
    const hi = Math.max(...T.band.hits.map((r) => r.y + r.h));
    expect(lo).toBeLessThanOrEqual(T.heading.y);
    expect(hi).toBeGreaterThanOrEqual(T.heading.y + T.heading.h);
    expect(hi).toBeLessThanOrEqual(T.list.area.y);
    for (const r of [...T.list.rows, T.back]) for (const h of T.band.hits) expect(overlap(h, r)).toBe(false);
    // 帯のセルは押せるものとして Chrome に見える要素（button）。div だと、指の範囲に入った一覧の行（button）に押下が補正される
    fakeDocument();
    const band = createPartyBand({
      strings: S,
      row: T.band.row,
      cells: T.band.cells,
      hits: T.band.hits,
      stageOf: (san, max) => sanStage(san, max, data.config),
      sanMaxOf: (c) => c.sanMax,
      onPick: () => {},
    });
    band.render(newGame(1).party);
    const cells = fake(band.el).children;
    expect(cells.map((c) => [c["tagName"], c["type"], c.className])).toEqual(cells.map(() => ["BUTTON", "button", "party-band-cell"]));
    // 見出し（controls の中）は帯より後に DOM に入る（上に描かれる）ので、押下を下の帯のセルへ通す pointer-events none が要る
    const src = fs.readFileSync(new URL("../src/presenter/views/dungeon.ts", import.meta.url), "utf8");
    const append = /el\.append\(([^)]*)\)/.exec(src)?.[1] ?? "";
    expect(append.indexOf("band.el")).toBeGreaterThanOrEqual(0);
    expect(append.indexOf("band.el")).toBeLessThan(append.indexOf("controls.el"));
    const ctl = fs.readFileSync(new URL("../src/presenter/views/controls.ts", import.meta.url), "utf8");
    expect(ctl).toMatch(/heading\.className = "controls-list-heading";[\s\S]*?pointerEvents: "none"[\s\S]*?el\.appendChild\(heading\)/);
  });

  test("UI-61 createTownPicture: 一覧に無い施設は img を作らず黒、一覧にある施設は base/town/<id>.png を読む。読めなかった URL は覚えて読み直さない", () => {
    fakeDocument();
    const pic = createTownPicture({ w: 240, h: 150, available: { inn: { w: 240, h: 150 } }, base: "/wizlike/" });
    expect(pic.el.style["background"]).toBe("var(--c-bg)");
    pic.show("town");
    expect(fake(pic.el).children).toEqual([]);
    pic.show("inn");
    const img = fake(pic.el).children[0]!;
    expect(img["src"]).toBe("/wizlike/town/inn.png");
    expect(townPictureUrl("inn", "/")).toBe("/town/inn.png");
    expect(img.style["imageRendering"]).toBe("pixelated");
    img.fire("error");
    pic.show("town");
    pic.show("inn");
    expect(fake(pic.el).children).toEqual([]);
  });

  // M16（UI-46）: 以前は「街ではログのボタンを出し文字領域を 152 に縮め、隠すと 192 に戻す」（setLogVisible）。ログは街・迷宮・戦闘で常に出す
  test("UI-13 / UI-46（M16）createHeader: ログのボタン（header.log の位置）を常に出し、文字領域はその左までの 152。ログのタップは onLog", () => {
    fakeDocument();
    const g = regions(data.config.ui.layout, data.config.stage.width);
    const L = dungeonLayout(g, data.config.party.size);
    let logs = 0;
    const h = createHeader({ strings: S, region: g.header, layout: L.header, onSettings: () => {}, onLog: () => logs++ });
    const [text, , settings, log] = fake(h.el).children;
    expect(settings!.className).toBe("header-settings");
    expect(log!.className).toBe("header-log");
    expect(log!.textContent).toBe("ログ");
    expect([log!.style["left"], log!.style["width"], log!.style["height"], log!.style["display"]]).toEqual(["160px", "40px", "16px", undefined]);
    expect(text!.style["width"]).toBe("152px");
    // 街のヘッダーと同じ位置（迷宮・戦闘・街で同じボタン）
    expect(L.header.log).toEqual(T.header.log);
    expect(L.header.text).toEqual(T.header.text);
    tapSpecOf(log!)!.onTap({ lx: 0, ly: 0 });
    expect(logs).toBe(1);
  });

  test("UI-46 / UI-54（M16）createHeader: 戦闘のターン表示はログの左（x108..155 の 48px）で、その間の問いは 100px。ログは隠れない", () => {
    fakeDocument();
    const g = regions(data.config.ui.layout, data.config.stage.width);
    const L = dungeonLayout(g, data.config.party.size);
    const h = createHeader({ strings: S, region: g.header, layout: L.header, onSettings: () => {} });
    const [text, turn, , log] = fake(h.el).children;
    expect(turn!.className).toBe("header-turn");
    expect([turn!.style["left"], turn!.style["width"]]).toEqual(["108px", "48px"]);
    h.setTurn("第12ターン");
    expect(turn!.style["display"]).toBe("");
    expect(text!.style["width"]).toBe("100px");
    expect(log!.style["display"]).toBe(undefined);
    h.setTurn(null);
    expect(turn!.style["display"]).toBe("none");
    expect(text!.style["width"]).toBe("152px");
  });

  test("UI-59/UI-33（M16）createHeader: キャラクター画面の ◀（x0..23）▶（x136..159。ログの左）は setNav の間だけ出し、問いはその間（x28..131 の 104px）に中央寄せ。タップは onCycle(−1 / +1)", () => {
    fakeDocument();
    const g = regions(data.config.ui.layout, data.config.stage.width);
    const L = dungeonLayout(g, data.config.party.size);
    const dirs: number[] = [];
    const h = createHeader({ strings: S, region: g.header, layout: L.header, onSettings: () => {}, onCycle: (d) => dirs.push(d) });
    const kids = fake(h.el).children;
    const text = kids[0]!;
    const prev = kids.find((c) => c.className === "header-prev")!;
    const next = kids.find((c) => c.className === "header-next")!;
    expect(L.header.prev).toEqual({ x: 0, y: 0, w: 24, h: 16 });
    expect(L.header.next).toEqual({ x: 136, y: 0, w: 24, h: 16 });
    expect(L.header.navText).toEqual({ x: 28, y: 0, w: 104, h: 16 });
    expect([prev.style["left"], prev.style["width"], prev.style["display"]]).toEqual(["0px", "24px", "none"]);
    expect([next.style["left"], next.style["width"], next.style["display"]]).toEqual(["136px", "24px", "none"]);
    // 三角は SVG の path（美咲フォントに ◀ ▶ が無い）
    expect(prev.children[0]!["tagName"]).toBe("svg");
    expect(prev.children[0]!.children[0]!["tagName"]).toBe("path");
    h.setNav(true);
    expect([prev.style["display"], next.style["display"]]).toEqual(["", ""]);
    expect([text.style["left"], text.style["width"], text.style["textAlign"]]).toEqual(["28px", "104px", "center"]);
    tapSpecOf(prev)!.onTap({ lx: 0, ly: 0 });
    tapSpecOf(next)!.onTap({ lx: 0, ly: 0 });
    expect(dirs).toEqual([-1, 1]);
    h.setNav(false);
    expect([prev.style["display"], next.style["display"]]).toEqual(["none", "none"]);
    expect([text.style["left"], text.style["width"], text.style["textAlign"]]).toEqual(["4px", "152px", ""]);
    // 「{name}の状態」は名前 6 字でも問いの幅に入る（全角 9 字 = 72px）
    expect(textUnits(S["camp.prompt.status"]!.replace("{name}", "アルドリンド")) * 4).toBeLessThanOrEqual(L.header.navText.w);
    expect(S["character.prev"]).toBe("前の人");
  });

  test("UI-59（M16）navTrianglePath: 22×14 の中央に 6×8 の三角。−1 は左向き、+1 は右向き", () => {
    expect(navTrianglePath(22, 14, -1)).toBe("M14 3L8 7L14 11Z");
    expect(navTrianglePath(22, 14, 1)).toBe("M8 3L14 7L8 11Z");
  });
});
