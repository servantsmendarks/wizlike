// UI-11 / UI-46 / UI-47（M10.5 追補。2026-10-07 ユーザーの指示「下、上に続きがある旨を示してください。（他のスワイプできるウィンドウにも同様の仕組みを入れてほしいです）」。未定-24）:
// 指でスクロールする窓の続きの印。純粋な判定と、各窓（操作領域の一覧・履歴・全滅の内訳・タイトルの一覧）の印の位置と出入り。
// 会話の箱の印は tests/talk.test.ts。DOM は最小の偽物に差し替える（node 環境）。
import { afterEach, describe, expect, test, vi } from "vitest";
import { dungeonLayout, regions, TITLE_ROW_AREA, townLayout } from "../src/presenter/layout";
import { createControls } from "../src/presenter/views/controls";
import { createHistoryView } from "../src/presenter/views/history";
import { attachScrollMarks, marksAt, marksLeftOf, scrolledToEnd, scrollMarkState } from "../src/presenter/views/scroll-marks";
import { createTitleScreen } from "../src/presenter/views/title";
import { createWipeView } from "../src/presenter/views/wipe";
import { data } from "./helpers/core";

class FakeEl {
  style: Record<string, string> = {};
  className = "";
  textContent = "";
  children: FakeEl[] = [];
  scrollTop = 0;
  /** 偽の寸法（テストが決める）。clientHeight は display:none なら 0 */
  contentH = 0;
  viewH = 0;
  listeners = new Map<string, Array<() => void>>();
  [k: string]: unknown;
  get scrollHeight(): number {
    return this.contentH;
  }
  get clientHeight(): number {
    return this.style["display"] === "none" ? 0 : this.viewH;
  }
  setAttribute(): void {}
  removeAttribute(): void {}
  appendChild(c: FakeEl): FakeEl {
    this.children.push(c);
    return c;
  }
  append(...c: FakeEl[]): void {
    this.children.push(...c);
  }
  replaceChildren(...c: FakeEl[]): void {
    this.children = c;
  }
  addEventListener(type: string, f: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), f]);
  }
  emit(type: string): void {
    for (const f of this.listeners.get(type) ?? []) f();
  }
  scrollTo(): void {}
}

function fakeDocument(): FakeEl[] {
  const created: FakeEl[] = [];
  vi.stubGlobal("document", {
    createElement(): FakeEl {
      const e = new FakeEl();
      created.push(e);
      return e;
    },
    createElementNS(): FakeEl {
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

const marksOf = (created: FakeEl[]) => {
  const ups = created.filter((e) => e.className === "scroll-mark scroll-mark-up");
  const downs = created.filter((e) => e.className === "scroll-mark scroll-mark-down");
  return { ups, downs };
};
const at = (e: FakeEl) => [e.style["left"], e.style["top"]];
const vis = (up: FakeEl, down: FakeEl) => ({ up: up.style["visibility"], down: down.style["visibility"] });

describe("UI-11（M10.5 追補）続きの印（純粋）", () => {
  test("UI-11 scrollMarkState: 中身が窓に収まれば両方偽。先頭なら下だけ、途中なら両方、末尾なら上だけ。端数（1px 以内）は端とみなす。見える高さが 0（隠れている）なら両方偽", () => {
    expect(scrollMarkState({ scrollTop: 0, scrollHeight: 96, clientHeight: 96 })).toEqual({ up: false, down: false });
    expect(scrollMarkState({ scrollTop: 0, scrollHeight: 97, clientHeight: 96 })).toEqual({ up: false, down: false });
    expect(scrollMarkState({ scrollTop: 0, scrollHeight: 320, clientHeight: 96 })).toEqual({ up: false, down: true });
    expect(scrollMarkState({ scrollTop: 100, scrollHeight: 320, clientHeight: 96 })).toEqual({ up: true, down: true });
    expect(scrollMarkState({ scrollTop: 224, scrollHeight: 320, clientHeight: 96 })).toEqual({ up: true, down: false });
    expect(scrollMarkState({ scrollTop: 223.5, scrollHeight: 320, clientHeight: 96 })).toEqual({ up: true, down: false });
    expect(scrollMarkState({ scrollTop: 0.5, scrollHeight: 320, clientHeight: 96 })).toEqual({ up: false, down: true });
    expect(scrollMarkState({ scrollTop: 0, scrollHeight: 0, clientHeight: 0 })).toEqual({ up: false, down: false });
    expect(scrollMarkState({ scrollTop: 0, scrollHeight: 320, clientHeight: 0 })).toEqual({ up: false, down: false });
    expect(scrolledToEnd({ scrollTop: 224, scrollHeight: 320, clientHeight: 96 })).toBe(true);
    expect(scrolledToEnd({ scrollTop: 0, scrollHeight: 320, clientHeight: 96 })).toBe(false);
  });

  test("UI-11 marksLeftOf は窓の左の 8px の列（上端の行の左・下端の行の左）、marksAt は指定の列に窓の上端と下端を揃える", () => {
    expect(marksLeftOf({ x: 8, y: 2, h: 96 })).toEqual({ up: { x: 0, y: 2 }, down: { x: 0, y: 90 } });
    expect(marksAt(227, { y: 18, h: 200 })).toEqual({ up: { x: 227, y: 18 }, down: { x: 227, y: 210 } });
  });

  test("UI-11 attachScrollMarks: 字は strings の scroll.up / scroll.down、accent 色・押せない・8×8。窓の scroll で出し直し、onScroll はその後に呼ぶ。最初は隠れている", () => {
    fakeDocument();
    const scroller = new FakeEl();
    const host = new FakeEl();
    const seen: string[] = [];
    const m = attachScrollMarks({
      scroller: scroller as unknown as HTMLElement,
      host: host as unknown as HTMLElement,
      strings: data.strings,
      pos: { up: { x: 1, y: 2 }, down: { x: 3, y: 4 } },
      onScroll: () => seen.push(String(m.down.style.visibility)),
    });
    const up = m.up as unknown as FakeEl;
    const down = m.down as unknown as FakeEl;
    expect(host.children).toEqual([up, down]);
    expect([up.textContent, down.textContent]).toEqual(["▲", "▼"]);
    expect([data.strings["scroll.up"], data.strings["scroll.down"]]).toEqual(["▲", "▼"]);
    for (const e of [up, down])
      expect([e.style["color"], e.style["pointerEvents"], e.style["width"], e.style["height"], e.style["position"]]).toEqual(["var(--c-accent)", "none", "8px", "8px", "absolute"]);
    expect([at(up), at(down)]).toEqual([
      ["1px", "2px"],
      ["3px", "4px"],
    ]);
    expect(vis(up, down)).toEqual({ up: "hidden", down: "hidden" });
    scroller.viewH = 100;
    scroller.contentH = 300;
    m.refresh();
    expect(vis(up, down)).toEqual({ up: "hidden", down: "visible" });
    scroller.scrollTop = 200;
    scroller.emit("scroll");
    expect(vis(up, down)).toEqual({ up: "visible", down: "hidden" });
    expect(seen).toEqual(["hidden"]);
    m.place({ up: { x: 5, y: 6 }, down: { x: 7, y: 8 } });
    expect([at(up), at(down)]).toEqual([
      ["5px", "6px"],
      ["7px", "8px"],
    ]);
  });
});

describe("UI-11（M10.5 追補）各窓の続きの印", () => {
  const g = regions(data.config.ui.layout, data.config.stage.width);
  const L = dungeonLayout(g, data.config.party.size);
  const TL = townLayout(g, data.config.party.size);
  const HOLD = { ms: () => 250, onHoldStart: () => {}, onHoldEnd: () => {} };

  test("UI-11 操作領域の一覧（迷宮・戦闘・キャンプ・街）: 一覧の左の 8px の列（x0）に印。迷宮は y302 と y389、街は y190 と y380。行が収まれば出さず、スクロールで出入りし、一覧を隠すと消える", () => {
    const created = fakeDocument();
    const c = createControls({
      region: g.controls,
      layout: { ...L, townList: { heading: TL.heading, area: TL.list.area, rows: TL.list.rows, grid: TL.grid } },
      strings: data.strings,
      onAction: () => {},
      hold: HOLD,
      onClose: () => {},
    });
    const list = created.find((e) => e.className === "controls-list")!;
    const { ups, downs } = marksOf(created);
    expect([ups.length, downs.length]).toEqual([1, 1]);
    const up = ups[0]!;
    const down = downs[0]!;
    // 操作領域の原点 y300 からの座標。迷宮の一覧 x8・y302・高さ 96 → 印 x0・y302 / y389
    expect([at(up), at(down)]).toEqual([
      ["0px", "2px"],
      ["0px", "90px"],
    ]);
    // 3 行に収まる一覧には出さない
    list.viewH = 96;
    list.contentH = 96;
    c.setList([1, 2, 3].map((i) => ({ label: `r${i}`, onSelect: () => {} })));
    c.setMode("list");
    expect(vis(up, down)).toEqual({ up: "hidden", down: "hidden" });
    // 10 行（320px）: 先頭では下だけ、末尾では上だけ
    list.contentH = 320;
    c.setList(Array.from({ length: 10 }, (_, i) => ({ label: `r${i}`, onSelect: () => {} })));
    expect(vis(up, down)).toEqual({ up: "hidden", down: "visible" });
    list.scrollTop = 224;
    list.emit("scroll");
    expect(vis(up, down)).toEqual({ up: "visible", down: "hidden" });
    // 一覧を出し直すと先頭から（下だけ）
    c.setMode("list");
    expect(vis(up, down)).toEqual({ up: "hidden", down: "visible" });
    // 一覧を隠すと消える
    c.setMode("dpad");
    expect(vis(up, down)).toEqual({ up: "hidden", down: "hidden" });
    // 街の一覧（x8・y190・高さ 198）→ 印 x0・y190 / y380（原点 y300 から −110 / 80）
    list.viewH = 198;
    list.contentH = 22 * 12;
    c.setList(
      Array.from({ length: 12 }, (_, i) => ({ label: `t${i}`, onSelect: () => {} })),
      { town: { heading: "h" } },
    );
    c.setMode("list");
    expect([at(up), at(down)]).toEqual([
      ["0px", "-110px"],
      ["0px", "80px"],
    ]);
    expect(vis(up, down)).toEqual({ up: "hidden", down: "visible" });
  });

  test("UI-46 履歴の画面: 一覧の幅は文字 224（メッセージ窓と同じ）にし、右の 8px の列（x227・y18 と y210。overlay の内側の座標）に印。開いたら末尾なので上だけ、先頭へ戻すと下だけ", () => {
    const created = fakeDocument();
    const h = createHistoryView(L.history, data.strings);
    const list = created.find((e) => e.className === "history-list")!;
    const { ups, downs } = marksOf(created);
    const up = ups[0]!;
    const down = downs[0]!;
    expect(list.style["width"]).toBe("224px");
    expect([at(up), at(down)]).toEqual([
      ["227px", "18px"],
      ["227px", "210px"],
    ]);
    list.viewH = 200;
    list.contentH = 500;
    // 開いたら末尾（偽物は scrollHeight を入れるので最大を超えるが、末尾として扱う）
    h.render(["a", "b"], "t");
    expect(vis(up, down)).toEqual({ up: "visible", down: "hidden" });
    list.scrollTop = 0;
    list.emit("scroll");
    expect(vis(up, down)).toEqual({ up: "hidden", down: "visible" });
    h.scrollBy(3);
    expect(vis(up, down)).toEqual({ up: "visible", down: "visible" });
    // 収まる量なら出さない
    list.contentH = 100;
    h.render(["a"], "t");
    expect(vis(up, down)).toEqual({ up: "hidden", down: "hidden" });
  });

  test("UI-56 全滅の内訳: 枠（wipe-frame）の中にスクロールする窓（wipe-view。pan-y）を置き、右の 8px の列（x226・y4 と y206。枠の内側の座標）に印。行は右の余白に印の列を空ける", () => {
    const created = fakeDocument();
    const w = createWipeView(L.wipe, data.strings);
    const frame = w.el as unknown as FakeEl;
    expect(frame.className).toBe("wipe-frame");
    const view = created.find((e) => e.className === "wipe-view")!;
    expect(frame.children[0]).toBe(view);
    expect([view.style["overflowY"], view.style["padding"], view.style["width"], view.style["height"]]).toEqual(["auto", "4px 12px 4px 4px", "238px", "218px"]);
    const { ups, downs } = marksOf(created);
    const up = ups[0]!;
    const down = downs[0]!;
    expect([at(up), at(down)]).toEqual([
      ["226px", "4px"],
      ["226px", "206px"],
    ]);
    view.viewH = 218;
    view.contentH = 300;
    w.render(["題", "行"]);
    expect(vis(up, down)).toEqual({ up: "hidden", down: "visible" });
    // 表示した後の出し直し（隠れている間は寸法が 0）
    frame.style["display"] = "none";
    view.style["display"] = "none";
    w.refresh();
    expect(vis(up, down)).toEqual({ up: "hidden", down: "hidden" });
    view.style["display"] = "";
    w.refresh();
    expect(vis(up, down)).toEqual({ up: "hidden", down: "visible" });
  });

  test("UI-50 タイトルの一覧: 一覧の左の 8px の列（x0・y52 と y212）に印。印は題字・一覧より後ろの子（一覧は 3 番目のまま）", () => {
    const created = fakeDocument();
    const t = createTitleScreen({ strings: data.strings, onSelect: () => {}, onFile: () => {} });
    const root = t.el as unknown as FakeEl;
    const rows = created.find((e) => e.className === "title-rows")!;
    expect(root.children[1]).toBe(rows);
    const { ups, downs } = marksOf(created);
    const up = ups[0]!;
    const down = downs[0]!;
    expect(root.children.slice(-2)).toEqual([up, down]);
    expect(TITLE_ROW_AREA).toEqual({ x: 8, y: 52, w: 224, h: 168 });
    expect([at(up), at(down)]).toEqual([
      ["0px", "52px"],
      ["0px", "212px"],
    ]);
    rows.viewH = 168;
    rows.contentH = 300;
    t.render([], "", "");
    expect(vis(up, down)).toEqual({ up: "hidden", down: "visible" });
  });
});
