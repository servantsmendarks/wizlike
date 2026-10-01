// UI-31: 壁で止まった長押しの続き（createHoldRepeater の stopped）を解除する経路のうち、
// 十字ボタンの lostpointercapture と、app が十字ボタンを出さない間に離したものとする判定（shouldReleaseHold）を確かめる。
// createControls は node 環境なので、document を最小の偽物に差し替える。
import { afterEach, describe, expect, test, vi } from "vitest";
import { shouldReleaseHold, type Overlay, type Route } from "../src/presenter/app";
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
  dispatch(type: string): void {
    for (const f of this.listeners.get(type) ?? []) f({ type, preventDefault() {} });
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
    const routes: Route[] = ["title", "creation", "town", "dungeon"];
    const overlays: Overlay[] = [null, "map", "debug"];
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
    expect(shouldReleaseHold("dungeon", "map", false)).toBe(true);
    expect(shouldReleaseHold("dungeon", null, true)).toBe(true);
  });
});
