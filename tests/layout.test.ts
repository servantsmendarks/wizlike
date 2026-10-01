import { describe, expect, test } from "vitest";
import {
  CREATION_BUTTONS,
  CREATION_ERROR,
  creationRow,
  DEBUG_BUTTONS,
  debugRow,
  DPAD,
  HEADER_SETTINGS,
  LIST_ROWS,
  MAP_CLOSE,
  MENU_SLOTS,
  regions,
  TITLE_BUTTONS,
  TOUCH_EXCEPTIONS,
  TOUCH_MIN_LOGICAL,
  type Rect,
} from "../src/presenter/layout";
import { data } from "./helpers/core";

const W = data.config.stage.width;
const H = data.config.stage.height;

/** 画面ごとの押せる矩形（名前 → 矩形） */
const SCREENS: Record<string, Record<string, Rect>> = {
  title: { "TITLE_BUTTONS.newGame": TITLE_BUTTONS.newGame, "TITLE_BUTTONS.settings": TITLE_BUTTONS.settings },
  creation: {
    ...Object.fromEntries(
      [0, 1, 2, 3, 4, 5].flatMap((i) => [
        [`creationRow(${i}).name`, creationRow(i).name],
        [`creationRow(${i}).personality`, creationRow(i).personality],
      ]),
    ),
    "CREATION_BUTTONS.random": CREATION_BUTTONS.random,
    "CREATION_BUTTONS.start": CREATION_BUTTONS.start,
    "CREATION_BUTTONS.back": CREATION_BUTTONS.back,
  },
  town: { HEADER_SETTINGS, ...Object.fromEntries(LIST_ROWS.map((r, i) => [`LIST_ROWS[${i}]`, r])) },
  dungeon: {
    HEADER_SETTINGS,
    ...Object.fromEntries(Object.entries(DPAD).map(([k, r]) => [`DPAD.${k}`, r])),
    ...Object.fromEntries(MENU_SLOTS.map((r, i) => [`MENU_SLOTS[${i}]`, r])),
  },
  // 選択肢（階段の確認）は迷宮の上で十字ボタンの代わりに LIST_ROWS を出す
  choice: { HEADER_SETTINGS, ...Object.fromEntries(LIST_ROWS.map((r, i) => [`LIST_ROWS[${i}]`, r])) },
  map: { MAP_CLOSE },
  // debug パネルは [-] [+] の行と toggle の行が別なので、それぞれの組で検査する
  debugStepper: {
    ...Object.fromEntries(
      [0, 1, 2, 3, 4].flatMap((i) => [
        [`debugRow(${i}).minus`, debugRow(i).minus],
        [`debugRow(${i}).plus`, debugRow(i).plus],
      ]),
    ),
    "DEBUG_BUTTONS.reset": DEBUG_BUTTONS.reset,
    "DEBUG_BUTTONS.close": DEBUG_BUTTONS.close,
  },
  debugToggle: {
    ...Object.fromEntries([0, 1, 2, 3, 4].map((i) => [`debugRow(${i}).toggle`, debugRow(i).toggle])),
    "DEBUG_BUTTONS.reset": DEBUG_BUTTONS.reset,
    "DEBUG_BUTTONS.close": DEBUG_BUTTONS.close,
  },
};

function inside(r: Rect, outer: Rect): boolean {
  return r.x >= outer.x && r.y >= outer.y && r.x + r.w <= outer.x + outer.w && r.y + r.h <= outer.y + outer.h;
}
function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

const STAGE: Rect = { x: 0, y: 0, w: W, h: H };

describe("layout", () => {
  test("ui §2 regions の top は 0/16/166/236/300 で、合計は stage.height", () => {
    const g = regions(data.config.ui.layout, W);
    expect([g.header.y, g.view.y, g.message.y, g.party.y, g.controls.y]).toEqual([0, 16, 166, 236, 300]);
    expect([g.header.h, g.view.h, g.message.h, g.party.h, g.controls.h]).toEqual([16, 150, 70, 64, 100]);
    expect(g.controls.y + g.controls.h).toBe(H);
    for (const r of Object.values(g)) expect(r).toMatchObject({ x: 0, w: W });
    // 区切りを変えると累積も変わる
    const g2 = regions({ header: 20, view: 140, message: 76, party: 64, controls: 100 }, W);
    expect([g2.view.y, g2.message.y, g2.party.y, g2.controls.y]).toEqual([20, 160, 236, 300]);
  });

  test("UI-10 全ボタンの矩形が 240×400 の内側にあり、例外以外は一辺 TOUCH_MIN_LOGICAL 以上、同じ画面のボタンは重ならない", () => {
    for (const [screen, rects] of Object.entries(SCREENS)) {
      const entries = Object.entries(rects);
      expect(entries.length, screen).toBeGreaterThan(0);
      for (const [name, r] of entries) {
        expect(inside(r, STAGE), `${screen} ${name}`).toBe(true);
        for (const v of [r.x, r.y, r.w, r.h]) expect(Number.isInteger(v), `${screen} ${name}`).toBe(true);
        if (TOUCH_EXCEPTIONS.includes(name)) continue;
        expect(Math.min(r.w, r.h), `${screen} ${name}`).toBeGreaterThanOrEqual(TOUCH_MIN_LOGICAL);
      }
      for (let i = 0; i < entries.length; i++)
        for (let j = i + 1; j < entries.length; j++)
          expect(overlaps(entries[i]![1], entries[j]![1]), `${screen} ${entries[i]![0]} / ${entries[j]![0]}`).toBe(false);
    }
    // 例外はヘッダーの設定ボタンだけで、ヘッダーの中に収まる
    expect(TOUCH_EXCEPTIONS).toEqual(["HEADER_SETTINGS"]);
    expect(inside(HEADER_SETTINGS, regions(data.config.ui.layout, W).header)).toBe(true);
    // 押せない欄も画面の内側
    expect(inside(CREATION_ERROR, STAGE)).toBe(true);
    for (let i = 0; i < 6; i++) expect(inside(creationRow(i).label, STAGE)).toBe(true);
    for (let i = 0; i < 5; i++) {
      expect(inside(debugRow(i).label, STAGE)).toBe(true);
      expect(inside(debugRow(i).value, STAGE)).toBe(true);
    }
    // 作成のエラー欄は行とボタンに重ならない
    for (const r of Object.values(SCREENS.creation!)) expect(overlaps(CREATION_ERROR, r)).toBe(false);
  });

  test("UI-10 DPAD/MENU/LIST が操作領域の内側", () => {
    const controls = regions(data.config.ui.layout, W).controls;
    for (const r of [...Object.values(DPAD), ...MENU_SLOTS, ...LIST_ROWS, MAP_CLOSE]) expect(inside(r, controls)).toBe(true);
    // 十字ボタンとメニューは重ならない
    for (const d of Object.values(DPAD)) for (const m of MENU_SLOTS) expect(overlaps(d, m)).toBe(false);
  });

  test("UI-10 scale 4/3 で 30 論理 px が 40 CSS px 以上", () => {
    expect(TOUCH_MIN_LOGICAL).toBe(30);
    expect(TOUCH_MIN_LOGICAL * (4 / 3)).toBeGreaterThanOrEqual(40);
    // scale 1（320 CSS px 幅）では満たさない（decisions に記録した既知の制約）
    expect(TOUCH_MIN_LOGICAL * 1).toBeLessThan(40);
  });
});
