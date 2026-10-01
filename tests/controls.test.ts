// UI-31: 壁で止まった長押しの続き（createHoldRepeater の stopped）を解除する経路のうち、
// 十字ボタンの lostpointercapture と、app が十字ボタンを出さない間に離したものとする判定（shouldReleaseHold）を確かめる。
// createControls は node 環境なので、document を最小の偽物に差し替える。
import { afterEach, describe, expect, test, vi } from "vitest";
import { shouldReleaseHold, type Overlay, type Route } from "../src/presenter/app";
import { dungeonLayout, regions } from "../src/presenter/layout";
import { createControls, createGhostClickGuard, GHOST_CLICK_MS } from "../src/presenter/views/controls";
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
      return new FakeEl();
    },
  });
  return created;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("controls", () => {
  test("UI-31 十字ボタンで lostpointercapture が届いたら onRelease を呼ぶ（pointerup が届かなくても長押しの続きが残らない）", () => {
    const created = fakeDocument();
    const g = regions(data.config.ui.layout, data.config.stage.width);
    const L = dungeonLayout(g, data.config.party.size);
    const actions: string[] = [];
    let released = 0;
    createControls({
      region: g.controls,
      layout: L,
      strings: data.strings,
      onAction: (a) => actions.push(a),
      onRelease: () => released++,
      onClose: () => {},
    });
    const fwd = created.find((e) => e.className === "controls-dpad-forward");
    expect(fwd).toBeDefined();
    fwd!.dispatch("pointerdown");
    expect(actions).toEqual(["forward"]);
    expect(released).toBe(0);
    fwd!.dispatch("lostpointercapture");
    expect(released).toBe(1);
    // ほかの十字ボタンも同じ
    for (const a of ["left", "right", "around"]) {
      created.find((e) => e.className === `controls-dpad-${a}`)!.dispatch("lostpointercapture");
    }
    expect(released).toBe(4);
  });

  test("UI-31 shouldReleaseHold: 迷宮以外・overlay あり・選択の保留ありのどれかなら離したものとする。迷宮で何も出ていなければ離さない", () => {
    const routes: Route[] = ["title", "creation", "town", "dungeon", "battle"];
    const overlays: Overlay[] = [null, "map", "debug", "detail"];
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
    expect(shouldReleaseHold("dungeon", "detail", false)).toBe(true);
    expect(shouldReleaseHold("dungeon", null, true)).toBe(true);
  });

  test("UI-54 戦闘の枠（member の配置）: disabled は dim 色で、click でも select でも onSelect を呼ばない。select は battle モードの枠を選ぶ", () => {
    const created = fakeDocument();
    const g = regions(data.config.ui.layout, data.config.stage.width);
    const L = dungeonLayout(g, data.config.party.size);
    const c = createControls({ region: g.controls, layout: L, strings: data.strings, onAction: () => {}, onRelease: () => {}, onClose: () => {} });
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
    for (const b of items) b.dispatch("click");
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

  test("UI-44/UI-54 createGhostClickGuard: arm から離して GHOST_CLICK_MS 未満の click は捨てる。新しい pointerdown で解く。arm していなければ捨てない", () => {
    const g = createGhostClickGuard();
    expect(g.blocks(0)).toBe(false);
    g.down();
    g.arm();
    expect(g.blocks(10)).toBe(true); // 押している間
    g.up(100);
    expect(g.blocks(100)).toBe(true);
    expect(g.blocks(100 + GHOST_CLICK_MS - 1)).toBe(true);
    expect(g.blocks(100 + GHOST_CLICK_MS)).toBe(false);
    // 離したあとに新しい操作が始まれば、その click は捨てない
    g.arm();
    g.up(1000);
    g.down();
    expect(g.blocks(1050)).toBe(false);
    // arm していない操作の up は窓を作らない
    g.down();
    g.up(2000);
    expect(g.blocks(2010)).toBe(false);
  });

  test("UI-44/UI-54 ゴーストクリック: オート解除・十字ボタンの pointerdown の直後に出た戦闘の 8 枠と一覧は、離して GHOST_CLICK_MS までの click で onSelect を呼ばない", () => {
    const created = fakeDocument();
    const g = regions(data.config.ui.layout, data.config.stage.width);
    const L = dungeonLayout(g, data.config.party.size);
    const c = createControls({ region: g.controls, layout: L, strings: data.strings, onAction: () => {}, onRelease: () => {}, onClose: () => {} });
    const root = created.find((e) => e.className === "controls")!;
    const picked: string[] = [];
    let pressed = 0;
    c.setAutoStop("stop", () => {
      pressed++;
      // 押した瞬間に解除が通って 8 枠が出る（演出スキップ）
      c.setBattleMenu([{ label: "a", onSelect: () => picked.push("a") }], "party");
      c.setMode("battle");
    });
    c.setMode("autoStop");
    const stop = created.find((e) => e.className === "controls-auto-stop")!;
    root.dispatch("pointerdown", { timeStamp: 0 });
    stop.dispatch("pointerdown", { timeStamp: 0 });
    expect(pressed).toBe(1);
    const item = () => created.filter((e) => e.className === "controls-battle-item").at(-1)!;
    item().dispatch("click", { timeStamp: 5 });
    root.dispatch("pointerup", { timeStamp: 100 });
    item().dispatch("click", { timeStamp: 101 });
    expect(picked).toEqual([]);
    // 窓を過ぎた click と、新しい操作の click は受ける
    item().dispatch("click", { timeStamp: 100 + GHOST_CLICK_MS });
    expect(picked).toEqual(["a"]);
    // 十字ボタンでも同じ。一覧も対象
    const fwd = created.find((e) => e.className === "controls-dpad-forward")!;
    c.setMode("dpad");
    root.dispatch("pointerdown", { timeStamp: 1000 });
    fwd.dispatch("pointerdown", { timeStamp: 1000 });
    c.setList([{ label: "x", onSelect: () => picked.push("x") }]);
    c.setMode("list");
    const row = () => created.filter((e) => e.className === "controls-list-item").at(-1)!;
    root.dispatch("pointercancel", { timeStamp: 1010 });
    row().dispatch("click", { timeStamp: 1020 });
    expect(picked).toEqual(["a"]);
    root.dispatch("pointerdown", { timeStamp: 1030 });
    root.dispatch("pointerup", { timeStamp: 1040 });
    row().dispatch("click", { timeStamp: 1041 });
    expect(picked).toEqual(["a", "x"]);
    // select（キー）は抑止しない
    root.dispatch("pointerdown", { timeStamp: 2000 });
    fwd.dispatch("pointerdown", { timeStamp: 2000 });
    c.select(0);
    expect(picked).toEqual(["a", "x", "x"]);
  });

  test("UI-44/UI-56 ゴーストクリック: オート解除の pointerdown の直後に同じ矩形へ出た close（全滅の「街へ」）は、離して GHOST_CLICK_MS までの click で onClose を呼ばない", () => {
    const created = fakeDocument();
    const g = regions(data.config.ui.layout, data.config.stage.width);
    const L = dungeonLayout(g, data.config.party.size);
    let closed = 0;
    const c = createControls({ region: g.controls, layout: L, strings: data.strings, onAction: () => {}, onRelease: () => {}, onClose: () => closed++ });
    const root = created.find((e) => e.className === "controls")!;
    c.setAutoStop("stop", () => {
      // 全滅のラウンドの再生が指を離す前に終わり、内訳の「街へ」が出る（演出スキップ）
      c.setCloseLabel(data.strings["wipe.toTown"]!);
      c.setMode("close");
    });
    c.setMode("autoStop");
    const stop = created.find((e) => e.className === "controls-auto-stop")!;
    const close = created.find((e) => e.className === "controls-close")!;
    root.dispatch("pointerdown", { timeStamp: 0 });
    stop.dispatch("pointerdown", { timeStamp: 0 });
    root.dispatch("pointerup", { timeStamp: 80 });
    close.dispatch("click", { timeStamp: 81 });
    expect(closed).toBe(0);
    // 新しい pointerdown の後の click は受ける
    root.dispatch("pointerdown", { timeStamp: 200 });
    root.dispatch("pointerup", { timeStamp: 260 });
    close.dispatch("click", { timeStamp: 261 });
    expect(closed).toBe(1);
  });

  test("UI-54/UI-52 setBattleMenu の配置: party は battleParty の 4 枠、member は battleMember の 5 枠、town は townMenu の 6 枠に置き、枠数を超える分は捨てる", () => {
    const created = fakeDocument();
    const g = regions(data.config.ui.layout, data.config.stage.width);
    const L = dungeonLayout(g, data.config.party.size);
    const c = createControls({ region: g.controls, layout: L, strings: data.strings, onAction: () => {}, onRelease: () => {}, onClose: () => {} });
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

  test("UI-54 一覧の onFocus は pointerenter / pointerdown で呼ばれ、一覧を作り直さない。setListFocus は注目の行の枠を accent にする（dim の行は dim のまま）", () => {
    const created = fakeDocument();
    const g = regions(data.config.ui.layout, data.config.stage.width);
    const L = dungeonLayout(g, data.config.party.size);
    const c = createControls({ region: g.controls, layout: L, strings: data.strings, onAction: () => {}, onRelease: () => {}, onClose: () => {} });
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
    // 作り直していない（同じ要素の click が効く）
    expect(created.filter((e) => e.className === "controls-list-item")).toHaveLength(4);
    rows[1]!.dispatch("click", { timeStamp: 10_000 });
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
    const c = createControls({ region: g.controls, layout: L, strings: data.strings, onAction: () => {}, onRelease: () => {}, onClose: () => {} });
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

  test("UI-44/UI-54 オート解除: pointerdown と、autoStop モードの select(0) で onPress を呼ぶ。ラベルは setAutoStop で差し替わる", () => {
    const created = fakeDocument();
    const g = regions(data.config.ui.layout, data.config.stage.width);
    const L = dungeonLayout(g, data.config.party.size);
    const c = createControls({ region: g.controls, layout: L, strings: data.strings, onAction: () => {}, onRelease: () => {}, onClose: () => {} });
    let pressed = 0;
    c.setAutoStop(data.strings["battle.cmd.autoStop"]!, () => pressed++);
    c.setMode("autoStop");
    const btn = created.find((e) => e.className === "controls-auto-stop")!;
    expect(btn["textContent"]).toBe(data.strings["battle.cmd.autoStop"]);
    btn.dispatch("pointerdown");
    expect(pressed).toBe(1);
    c.select(0);
    expect(pressed).toBe(2);
    c.select(1);
    expect(pressed).toBe(2);
    c.setAutoStop(data.strings["battle.autoStopping"]!, () => pressed++);
    expect(btn["textContent"]).toBe(data.strings["battle.autoStopping"]);
  });
});
