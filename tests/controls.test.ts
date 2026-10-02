// UI-31 / UI-36 / UI-54: 操作領域のボタン。どのボタンも input/tap.ts の onTap で登録し（click は使わない）、
// 前進ボタンだけが長押し（hold）を持ち、オート解除だけが再生中も反応する（whileBusy）。
// app が十字ボタンを出さない間に長押しを離したものとする判定（shouldReleaseHold）も確かめる。
// createControls は node 環境なので、document を最小の偽物に差し替える。
import { afterEach, describe, expect, test, vi } from "vitest";
import { shouldReleaseHold, type Overlay, type Route } from "../src/presenter/app";
import { tapSpecOf } from "../src/presenter/input/tap";
import { dungeonLayout, regions } from "../src/presenter/layout";
import { createControls } from "../src/presenter/views/controls";
import { data } from "./helpers/core";

class FakeEl {
  style: Record<string, string> = {};
  className = "";
  children: FakeEl[] = [];
  listeners = new Map<string, Array<(e: unknown) => void>>();
  [k: string]: unknown;
  setAttribute(): void {}
  appendChild(c: FakeEl): FakeEl {
    this.children.push(c);
    return c;
  }
  replaceChildren(...c: FakeEl[]): void {
    this.children = c;
  }
  addEventListener(type: string, f: (e: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), f]);
  }
  dispatch(type: string, extra: Record<string, unknown> = {}): void {
    for (const f of this.listeners.get(type) ?? []) f({ type, preventDefault() {}, ...extra });
  }
  /** onTap で登録した spec の onTap を呼ぶ（動かずに離した） */
  tap(): void {
    const s = tapSpecOf(this);
    if (s === null) throw new Error(`not tappable: ${this.className}`);
    s.onTap({ lx: 0, ly: 0 });
  }
}

const HOLD = { ms: () => 250, onHoldStart: () => {}, onHoldEnd: () => {} };

function fakeDocument(): FakeEl[] {
  const created: FakeEl[] = [];
  vi.stubGlobal("document", {
    createElement(): FakeEl {
      const e = new FakeEl();
      created.push(e);
      return e;
    },
    createElementNS(): FakeEl {
      return new FakeEl();
    },
  });
  return created;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("controls", () => {
  test("UI-31/UI-36 十字ボタンは動かずに離したら onAction。前進だけが長押し（hold）を持つ。どのボタンにも click / pointerdown のリスナーは無い", () => {
    const created = fakeDocument();
    const g = regions(data.config.ui.layout, data.config.stage.width);
    const L = dungeonLayout(g, data.config.party.size);
    const actions: string[] = [];
    const hold = { ms: () => 250, onHoldStart: () => actions.push("holdStart"), onHoldEnd: () => actions.push("holdEnd") };
    createControls({ region: g.controls, layout: L, strings: data.strings, onAction: (a) => actions.push(a), hold, onClose: () => {} });
    for (const a of ["forward", "left", "right", "around"]) {
      const b = created.find((e) => e.className === `controls-dpad-${a}`)!;
      b.tap();
      expect(tapSpecOf(b)?.hold, a).toBe(a === "forward" ? hold : undefined);
      expect(tapSpecOf(b)?.whileBusy, a).toBeUndefined();
    }
    expect(actions).toEqual(["forward", "left", "right", "around"]);
    for (const e of created) {
      expect(e.listeners.has("click"), e.className).toBe(false);
      expect(e.listeners.has("pointerdown"), e.className).toBe(false);
    }
  });

  test("UI-31 shouldReleaseHold: 迷宮以外・overlay あり・選択の保留ありのどれかなら離したものとする。迷宮で何も出ていなければ離さない", () => {
    const routes: Route[] = ["title", "creation", "town", "dungeon", "battle"];
    const overlays: Overlay[] = [null, "map", "debug", "camp", "history", "wipe"];
    for (const r of routes) {
      for (const o of overlays) {
        for (const p of [false, true]) {
          const want = r !== "dungeon" || o !== null || p;
          expect(shouldReleaseHold(r, o, p), `${r} ${String(o)} ${p}`).toBe(want);
        }
      }
    }
    expect(shouldReleaseHold("dungeon", null, false)).toBe(false);
    expect(shouldReleaseHold("town", null, false)).toBe(true);
    expect(shouldReleaseHold("battle", null, false)).toBe(true);
    expect(shouldReleaseHold("dungeon", "map", false)).toBe(true);
    expect(shouldReleaseHold("dungeon", "camp", false)).toBe(true);
    expect(shouldReleaseHold("dungeon", "history", false)).toBe(true);
    expect(shouldReleaseHold("dungeon", null, true)).toBe(true);
  });

  test("UI-54/UI-36 戦闘の枠（member の配置）: disabled は dim 色で、タップでも select でも onSelect を呼ばない。select は battle モードの枠を選ぶ", () => {
    const created = fakeDocument();
    const g = regions(data.config.ui.layout, data.config.stage.width);
    const L = dungeonLayout(g, data.config.party.size);
    const c = createControls({ region: g.controls, layout: L, strings: data.strings, onAction: () => {}, hold: HOLD, onClose: () => {} });
    const picked: string[] = [];
    c.setBattleMenu([
      { label: "a", onSelect: () => picked.push("a") },
      { label: "b", onSelect: () => picked.push("b"), disabled: true },
      { label: "c", onSelect: () => picked.push("c") },
    ], "member");
    c.setMode("battle");
    const items = created.filter((e) => e.className === "controls-battle-item");
    expect(items.map((e) => e["textContent"])).toEqual(["a", "b", "c"]);
    expect(items[1]!.style["color"]).toBe("var(--c-dim)");
    expect(items[0]!.style["color"]).not.toBe("var(--c-dim)");
    for (const b of items) b.tap();
    expect(picked).toEqual(["a", "c"]);
    c.select(1);
    c.select(2);
    c.select(7); // 範囲外は何もしない
    expect(picked).toEqual(["a", "c", "c"]);
    // battle 以外のモードでは戦闘の枠を選ばない
    c.setMode("none");
    c.select(0);
    expect(picked).toEqual(["a", "c", "c"]);
  });

  test("UI-53 キャンプの枠（camp の配置）: campGrid の 8 枠に置き、null は空き枠（何も置かず、select でも何もしない）", () => {
    const created = fakeDocument();
    const g = regions(data.config.ui.layout, data.config.stage.width);
    const L = dungeonLayout(g, data.config.party.size);
    const c = createControls({ region: g.controls, layout: L, strings: data.strings, onAction: () => {}, hold: HOLD, onClose: () => {} });
    const picked: number[] = [];
    const it = (i: number) => ({ label: `s${i}`, onSelect: () => picked.push(i) });
    c.setBattleMenu([it(0), it(1), it(2), it(3), it(4), null, null, it(7), it(8)], "camp");
    c.setMode("battle");
    const items = created.filter((e) => e.className === "controls-battle-item");
    expect(items.map((e) => e["textContent"])).toEqual(["s0", "s1", "s2", "s3", "s4", "s7"]);
    const at = (i: number) => ({ left: `${L.campGrid[i]!.x - g.controls.x}px`, top: `${L.campGrid[i]!.y - g.controls.y}px` });
    expect(items.map((e) => ({ left: e.style["left"], top: e.style["top"] }))).toEqual([0, 1, 2, 3, 4, 7].map(at));
    c.select(5);
    c.select(6);
    c.select(8); // 枠数を超える分は捨てた
    c.select(7);
    items[0]!.tap();
    expect(picked).toEqual([7, 0]);
  });

  test("UI-54/UI-52 setBattleMenu の配置: party は battleParty の 4 枠、member は battleMember の 5 枠、town は townMenu の 6 枠に置き、枠数を超える分は捨てる", () => {
    const created = fakeDocument();
    const g = regions(data.config.ui.layout, data.config.stage.width);
    const L = dungeonLayout(g, data.config.party.size);
    const c = createControls({ region: g.controls, layout: L, strings: data.strings, onAction: () => {}, hold: HOLD, onClose: () => {} });
    const picked: number[] = [];
    const items = Array.from({ length: 6 }, (_, i) => ({ label: `x${i}`, onSelect: () => picked.push(i) }));
    const pos = (): Array<[string, string, string, string]> =>
      created
        .filter((e) => e.className === "controls-battle-item")
        .slice(-100)
        .map((e) => [e.style["left"]!, e.style["top"]!, e.style["width"]!, e.style["height"]!]);
    const rel = (r: { x: number; y: number; w: number; h: number }): [string, string, string, string] => [
      `${r.x - g.controls.x}px`,
      `${r.y - g.controls.y}px`,
      `${r.w}px`,
      `${r.h}px`,
    ];
    c.setBattleMenu(items, "party");
    c.setMode("battle");
    expect(pos()).toEqual(L.battleParty.map(rel));
    c.select(3);
    c.select(4); // 5 件目は捨てた
    expect(picked).toEqual([3]);
    const before = created.length;
    c.setBattleMenu(items, "member");
    expect(created.slice(before).filter((e) => e.className === "controls-battle-item").map((e) => [e.style["left"], e.style["top"], e.style["width"], e.style["height"]])).toEqual(
      L.battleMember.map(rel),
    );
    c.select(4);
    c.select(5);
    expect(picked).toEqual([3, 4]);
    // UI-52 town は townMenu の 6 枠（7 件目は捨てる）
    const before2 = created.length;
    c.setBattleMenu([...items, { label: "x6", onSelect: () => picked.push(6) }], "town");
    expect(created.slice(before2).filter((e) => e.className === "controls-battle-item").map((e) => [e.style["left"], e.style["top"], e.style["width"], e.style["height"]])).toEqual(
      L.townMenu.map(rel),
    );
    c.select(0);
    c.select(5);
    c.select(6);
    expect(picked).toEqual([3, 4, 0, 5]);
  });

  test("UI-54 一覧の onFocus は pointerenter / pointerdown で呼ばれ（選ぶのは離したとき）、一覧を作り直さない。setListFocus は注目の行の枠を accent にする（dim の行は dim のまま）", () => {
    const created = fakeDocument();
    const g = regions(data.config.ui.layout, data.config.stage.width);
    const L = dungeonLayout(g, data.config.party.size);
    const c = createControls({ region: g.controls, layout: L, strings: data.strings, onAction: () => {}, hold: HOLD, onClose: () => {} });
    const focused: number[] = [];
    const picked: number[] = [];
    c.setList([
      { label: "a", onSelect: () => picked.push(0), onFocus: () => focused.push(0) },
      { label: "b", onSelect: () => picked.push(1), onFocus: () => focused.push(1) },
      { label: "c", onSelect: () => picked.push(2), disabled: true },
      { label: "d", onSelect: () => picked.push(3) },
    ]);
    c.setMode("list");
    const rows = created.filter((e) => e.className === "controls-list-item");
    expect(rows).toHaveLength(4);
    rows[1]!.dispatch("pointerenter");
    rows[0]!.dispatch("pointerdown");
    rows[3]!.dispatch("pointerenter"); // onFocus なしの行は何もしない
    expect(focused).toEqual([1, 0]);
    // 作り直していない（同じ要素のタップが効く）
    expect(created.filter((e) => e.className === "controls-list-item")).toHaveLength(4);
    expect(picked).toEqual([]);
    rows[1]!.tap();
    rows[2]!.tap(); // dim は選ばない
    expect(picked).toEqual([1]);
    let scrolled: unknown = null;
    rows[1]!["scrollIntoView"] = (o: unknown) => {
      scrolled = o;
    };
    c.setListFocus(1);
    expect(rows.map((r) => r.style["borderColor"])).toEqual(["var(--c-frame)", "var(--c-accent)", "var(--c-dim)", "var(--c-frame)"]);
    expect(scrolled).toEqual({ block: "nearest" });
    c.setListFocus(2);
    expect(rows[2]!.style["borderColor"]).toBe("var(--c-dim)");
    expect(rows[1]!.style["borderColor"]).toBe("var(--c-frame)");
    c.setListFocus(null);
    expect(rows.map((r) => r.style["borderColor"])).toEqual(["var(--c-frame)", "var(--c-frame)", "var(--c-dim)", "var(--c-frame)"]);
  });

  test("UI-54/UI-33 setListFocus の scroll: false は scrollIntoView を呼ばない（枠だけ動かす）。onFocus のある行（対象の一覧）は tabIndex -1 で、Enter が注目の行の選択になる", () => {
    const created = fakeDocument();
    const g = regions(data.config.ui.layout, data.config.stage.width);
    const L = dungeonLayout(g, data.config.party.size);
    const c = createControls({ region: g.controls, layout: L, strings: data.strings, onAction: () => {}, hold: HOLD, onClose: () => {} });
    c.setList([
      { label: "a", onSelect: () => {}, onFocus: () => {} },
      { label: "b", onSelect: () => {}, onFocus: () => {} },
      { label: "back", onSelect: () => {} },
    ]);
    c.setMode("list");
    const rows = created.filter((e) => e.className === "controls-list-item");
    expect(rows.map((r) => r["tabIndex"])).toEqual([-1, -1, undefined]);
    let scrolled = 0;
    for (const r of rows) r["scrollIntoView"] = () => scrolled++;
    c.setListFocus(1, { scroll: false });
    expect(rows.map((r) => r.style["borderColor"])).toEqual(["var(--c-frame)", "var(--c-accent)", "var(--c-frame)"]);
    expect(scrolled).toBe(0);
    c.setListFocus(0, { scroll: true });
    c.setListFocus(1);
    expect(scrolled).toBe(2);
  });

  test("UI-11 setList(fixedLast) は末尾を一覧の外の controls-list-back（layout.listBack）に置き、残りを幅 168 の一覧に置く。select(n) と setListFocus(末尾) は戻るを指す", () => {
    const created = fakeDocument();
    const g = regions(data.config.ui.layout, data.config.stage.width);
    const L = dungeonLayout(g, data.config.party.size);
    const c = createControls({ region: g.controls, layout: L, strings: data.strings, onAction: () => {}, hold: HOLD, onClose: () => {} });
    const picked: number[] = [];
    const it = (i: number) => ({ label: `r${i}`, onSelect: () => picked.push(i), onFocus: () => {} });
    c.setList([it(0), it(1), it(2), it(3), { label: "back", onSelect: () => picked.push(4) }], { fixedLast: true });
    c.setMode("list");
    const list = created.find((e) => e.className === "controls-list")!;
    const holder = created.find((e) => e.className === "controls-list-back")!;
    // 行は一覧の中に 4 つ（幅 168）、戻るは一覧の外
    expect(list.children.map((e) => e["textContent"])).toEqual(["r0", "r1", "r2", "r3"]);
    expect(list.style["width"]).toBe("168px");
    expect(list.children.map((e) => e.style["width"])).toEqual(["168px", "168px", "168px", "168px"]);
    expect(holder.children.map((e) => e["textContent"])).toEqual(["back"]);
    expect(holder.style["display"]).toBe("");
    const back = holder.children[0]!;
    const rel = L.listBack;
    expect([back.style["left"], back.style["top"], back.style["width"], back.style["height"]]).toEqual([
      `${rel.x - g.controls.x}px`,
      `${rel.y - g.controls.y}px`,
      "56px",
      "40px",
    ]);
    // 添字は変わらない: select(4) は戻る、select(0) は先頭の行
    c.select(4);
    c.select(0);
    back.tap();
    expect(picked).toEqual([4, 0, 4]);
    // setListFocus(末尾) は戻るの枠を accent にし、一覧の外なので scrollIntoView は呼ばない
    let scrolled = 0;
    for (const e of [...list.children, back]) e["scrollIntoView"] = () => scrolled++;
    c.setListFocus(4);
    expect(back.style["borderColor"]).toBe("var(--c-accent)");
    expect(scrolled).toBe(0);
    c.setListFocus(1);
    expect(back.style["borderColor"]).toBe("var(--c-frame)");
    expect(scrolled).toBe(1);
    // list 以外のモードでは戻るも隠す
    c.setMode("none");
    expect(holder.style["display"]).toBe("none");
  });

  test("UI-11 fixedLast なしは今どおり幅 224 の一覧に末尾まで置き、固定の戻るは出さない", () => {
    const created = fakeDocument();
    const g = regions(data.config.ui.layout, data.config.stage.width);
    const L = dungeonLayout(g, data.config.party.size);
    const c = createControls({ region: g.controls, layout: L, strings: data.strings, onAction: () => {}, hold: HOLD, onClose: () => {} });
    c.setList([{ label: "a", onSelect: () => {} }, { label: "back", onSelect: () => {} }], { fixedLast: true });
    c.setList([{ label: "x", onSelect: () => {} }, { label: "y", onSelect: () => {} }]);
    c.setMode("list");
    const list = created.find((e) => e.className === "controls-list")!;
    const holder = created.find((e) => e.className === "controls-list-back")!;
    expect(list.children.map((e) => e["textContent"])).toEqual(["x", "y"]);
    expect(list.style["width"]).toBe("224px");
    expect(list.children.map((e) => e.style["width"])).toEqual(["224px", "224px"]);
    expect(holder.children).toEqual([]);
    expect(holder.style["display"]).toBe("none");
  });

  test("UI-11 一覧は出すたびに先頭から: setMode(\"list\") で一覧の scrollTop を 0 にする（表示した後にも戻す）", () => {
    const created = fakeDocument();
    const g = regions(data.config.ui.layout, data.config.stage.width);
    const L = dungeonLayout(g, data.config.party.size);
    const c = createControls({ region: g.controls, layout: L, strings: data.strings, onAction: () => {}, hold: HOLD, onClose: () => {} });
    const list = created.find((e) => e.className === "controls-list")!;
    c.setList([{ label: "a", onSelect: () => {} }]);
    // display:none の間の代入が効かず、前の位置が残った場合を模す
    list["scrollTop"] = 50;
    c.setMode("list");
    expect(list["scrollTop"]).toBe(0);
    list["scrollTop"] = 30;
    c.setMode("battle");
    expect(list["scrollTop"]).toBe(30);
  });

  test("UI-44/UI-54 オート解除: タップ（再生中も反応する whileBusy）と、autoStop モードの select(0) で onPress を呼ぶ。ラベルは setAutoStop で差し替わる。close は onClose", () => {
    const created = fakeDocument();
    const g = regions(data.config.ui.layout, data.config.stage.width);
    const L = dungeonLayout(g, data.config.party.size);
    const c = createControls({ region: g.controls, layout: L, strings: data.strings, onAction: () => {}, hold: HOLD, onClose: () => {} });
    let pressed = 0;
    c.setAutoStop(data.strings["battle.cmd.autoStop"]!, () => pressed++);
    c.setMode("autoStop");
    const btn = created.find((e) => e.className === "controls-auto-stop")!;
    expect(btn["textContent"]).toBe(data.strings["battle.cmd.autoStop"]);
    expect(tapSpecOf(btn)?.whileBusy).toBe(true);
    btn.tap();
    expect(pressed).toBe(1);
    c.select(0);
    expect(pressed).toBe(2);
    c.select(1);
    expect(pressed).toBe(2);
    c.setAutoStop(data.strings["battle.autoStopping"]!, () => pressed++);
    expect(btn["textContent"]).toBe(data.strings["battle.autoStopping"]);
    // close（地図・履歴の「閉じる」、全滅の「街へ」）は whileBusy ではない
    const close = created.find((e) => e.className === "controls-close")!;
    expect(tapSpecOf(close)?.whileBusy).toBeUndefined();
  });
});
