// UI-13（M8.5）: 街のパーティの帯（views/party-band.ts の純粋な部分）
import { afterEach, describe, expect, test, vi } from "vitest";
import { sanStage } from "../src/core/rules/san";
import type { Character } from "../src/core/types";
import { tapSpecOf } from "../src/presenter/input/tap";
import { dungeonLayout, regions, townLayout } from "../src/presenter/layout";
import { createHeader } from "../src/presenter/views/header";
import { bandCell, BAND_CELL_UNITS, createPartyBand, fitName, textUnits } from "../src/presenter/views/party-band";
import { createTownPicture, townPictureUrl } from "../src/presenter/views/town-picture";
import { data, newGame } from "./helpers/core";

const S = data.strings;
const ch = (name: string, p: Partial<Pick<Character, "life" | "status">> = {}): Pick<Character, "name" | "life" | "status"> => ({
  name,
  life: p.life ?? "alive",
  status: p.status ?? [],
});

describe("UI-13 bandCell", () => {
  test("UI-13 bandCell: 正常は印なしの text。全角 5 字までは全文、6 字は 4 字＋…（10 単位）。半角（ASCII・半角カナ）は 1 単位", () => {
    expect(bandCell(ch("アルド"), "normal", S)).toEqual({ label: "アルド", mark: "", role: "text" });
    expect(bandCell(ch("アルドリン"), "normal", S).label).toBe("アルドリン");
    expect(bandCell(ch("アルドリンド"), "normal", S).label).toBe("アルドリ…");
    expect(bandCell(ch("Aldorin"), "normal", S).label).toBe("Aldorin");
    expect(bandCell(ch("Aldorinson"), "normal", S).label).toBe("Aldorinson");
    expect(bandCell(ch("Aldorinsons"), "normal", S).label).toBe("Aldorins…");
    expect(bandCell(ch("ｱﾙﾄﾞﾘﾝﾄﾞ"), "normal", S).label).toBe("ｱﾙﾄﾞﾘﾝﾄﾞ");
    for (const n of ["アルドリンド", "Aldorinsons", "アルドABCDEF"]) expect(textUnits(bandCell(ch(n), "normal", S).label), n).toBeLessThanOrEqual(BAND_CELL_UNITS);
    expect(fitName("あいうえおか", 10)).toBe("あいうえ…");
    expect(fitName("あいうえお", 10)).toBe("あいうえお");
  });

  test("UI-13 bandCell: 印は 1 人に 1 つで、優先順は 灰 > 死亡 > 石 > 痺 > 眠 > 毒 > 虚脱 > 錯乱 > 不安。印があれば 6 字の名前は 3 字＋…＋印", () => {
    expect(bandCell(ch("アルド", { life: "ash", status: ["poison"] }), "broken", S)).toEqual({ label: "アルド灰", mark: "灰", role: "dim" });
    expect(bandCell(ch("アルド", { life: "dead", status: ["stone"] }), "broken", S)).toEqual({ label: "アルド死", mark: "死", role: "danger" });
    expect(bandCell(ch("アルド", { status: ["poison", "sleep", "paralysis", "stone"] }), "broken", S)).toMatchObject({ mark: "石", role: "status" });
    expect(bandCell(ch("アルド", { status: ["poison", "sleep", "paralysis"] }), "normal", S)).toMatchObject({ mark: "痺", role: "status" });
    expect(bandCell(ch("アルド", { status: ["poison", "sleep"] }), "normal", S)).toMatchObject({ mark: "眠", role: "status" });
    expect(bandCell(ch("アルド", { status: ["poison"] }), "uneasy", S)).toMatchObject({ mark: "毒", role: "status" });
    expect(bandCell(ch("アルド"), "broken", S)).toEqual({ label: "アルド虚", mark: "虚", role: "san" });
    expect(bandCell(ch("アルド"), "confused", S)).toMatchObject({ mark: "錯", role: "san" });
    expect(bandCell(ch("アルド"), "uneasy", S)).toMatchObject({ mark: "不", role: "san" });
    expect(bandCell(ch("アルドリンド", { life: "dead" }), "normal", S).label).toBe("アルド…死");
    expect(bandCell(ch("アルドリン", { status: ["poison"] }), "normal", S).label).toBe("アルド…毒");
    expect(bandCell(ch("アルドリ", { status: ["poison"] }), "normal", S).label).toBe("アルドリ毒");
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
    createElement(): FakeEl {
      const e = new FakeEl();
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

  test("UI-13 createHeader: 街ではログのボタン（header.log の位置）を出し文字領域を 152 に縮め、隠すと 192 に戻す。ログのタップは onLog", () => {
    fakeDocument();
    const g = regions(data.config.ui.layout, data.config.stage.width);
    const L = dungeonLayout(g, data.config.party.size);
    let logs = 0;
    const h = createHeader({ strings: S, region: g.header, layout: L.header, town: T.header, onSettings: () => {}, onLog: () => logs++ });
    const [text, , settings, log] = fake(h.el).children;
    expect(settings!.className).toBe("header-settings");
    expect(log!.className).toBe("header-log");
    expect(log!.textContent).toBe("ログ");
    expect([log!.style["left"], log!.style["width"], log!.style["height"], log!.style["display"]]).toEqual(["160px", "40px", "16px", "none"]);
    h.setLogVisible(true);
    expect(log!.style["display"]).toBe("");
    expect(text!.style["width"]).toBe("152px");
    tapSpecOf(log!)!.onTap({ lx: 0, ly: 0 });
    expect(logs).toBe(1);
    h.setLogVisible(false);
    expect(text!.style["width"]).toBe("192px");
    expect(log!.style["display"]).toBe("none");
  });
});
