import { describe, expect, test } from "vitest";
import {
  CREATION_BUTTONS,
  CREATION_ERROR,
  creationRow,
  CONTROLS_MIN_HEIGHT,
  DEBUG_BUTTONS,
  DEBUG_BUTTONS_M5,
  DEBUG_SWIPE_Y,
  debugRow,
  dungeonLayout,
  HEADER_TURN_GAP,
  HEADER_TURN_W,
  layoutWarnings,
  regions,
  saveBannerRect,
  TITLE_BUTTONS,
  TITLE_HEADING_Y,
  TITLE_HINT,
  TITLE_NOTICE,
  TITLE_ROW_AREA,
  TITLE_ROW_PITCH,
  TITLE_ROWS,
  TOUCH_EXCEPTIONS,
  TOUCH_MIN_LOGICAL,
  UPDATE_NOTICE,
  type Rect,
} from "../src/presenter/layout";
import { data } from "./helpers/core";

const W = data.config.stage.width;
const H = data.config.stage.height;
const N = data.config.party.size;
/** 既定の config.ui.layout（16/150/70/64/100）での迷宮の画面の矩形 */
const L = dungeonLayout(regions(data.config.ui.layout, W), N);
const HEADER_SETTINGS = L.header.settings;
/** 既定の config での SV-23 の帯 */
const SAVE_BANNER = saveBannerRect(regions(data.config.ui.layout, W), data.config.ui.saveBannerHeight);

/** 画面ごとの押せる矩形（名前 → 矩形） */
const SCREENS: Record<string, Record<string, Rect>> = {
  // UI-50: 一覧の行 5 つとボタンの 4 枠（ページによって使う枠は違うが、同時に置いても重ならない）
  title: {
    ...Object.fromEntries(TITLE_ROWS.map((r, i) => [`TITLE_ROWS[${i}]`, r])),
    ...Object.fromEntries(TITLE_BUTTONS.map((r, i) => [`TITLE_BUTTONS[${i}]`, r])),
  },
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
  town: { "header.settings": HEADER_SETTINGS, ...Object.fromEntries(L.list.map((r, i) => [`list[${i}]`, r])) },
  // UI-11 末尾が戻る / やめるの一覧（街の各施設・キャンプと酒場の一覧の段・戦闘の呪文・道具・対象）: 幅 168 の行と、一覧の外の戻る
  listFixed: {
    "header.settings": HEADER_SETTINGS,
    ...Object.fromEntries(L.listNarrow.map((r, i) => [`listNarrow[${i}]`, r])),
    listBack: L.listBack,
  },
  // UI-52 街の施設メニューの 3 列 × 2 段の 5 枠
  townMenu: { "header.settings": HEADER_SETTINGS, ...Object.fromEntries(L.townMenu.map((r, i) => [`townMenu[${i}]`, r])) },
  dungeon: {
    "header.settings": HEADER_SETTINGS,
    ...Object.fromEntries(Object.entries(L.dpad).map(([k, r]) => [`dpad.${k}`, r])),
    ...Object.fromEntries(L.menu.map((r, i) => [`menu[${i}]`, r])),
  },
  // 選択肢（階段の確認）は迷宮の上で十字ボタンの代わりに list を出す
  choice: { "header.settings": HEADER_SETTINGS, ...Object.fromEntries(L.list.map((r, i) => [`list[${i}]`, r])) },
  // UI-25 地図: 閉じると移動
  map: { mapClose: L.mapClose, mapGo: L.mapGo },
  // UI-54 戦闘: パーティの選択の 4 枠、メンバーの 5 枠（対象などの一覧は list と同じ）、オート中は「オート解除」だけ
  battleParty: { "header.settings": HEADER_SETTINGS, ...Object.fromEntries(L.battleParty.map((r, i) => [`battleParty[${i}]`, r])) },
  battleMember: { "header.settings": HEADER_SETTINGS, ...Object.fromEntries(L.battleMember.map((r, i) => [`battleMember[${i}]`, r])) },
  battleList: { "header.settings": HEADER_SETTINGS, ...Object.fromEntries(L.list.map((r, i) => [`list[${i}]`, r])) },
  autoStop: { "header.settings": HEADER_SETTINGS, autoStop: L.autoStop },
  // SV-42 更新の案内（どの画面の上にも出る）
  updateNotice: { "UPDATE_NOTICE.reload": UPDATE_NOTICE.reload, "UPDATE_NOTICE.close": UPDATE_NOTICE.close },
  // debug パネルは [-] [+] の行と toggle の行が別なので、それぞれの組で検査する
  debugStepper: {
    ...Object.fromEntries(
      [0, 1, 2, 3, 4, 5].flatMap((i) => [
        [`debugRow(${i}).minus`, debugRow(i).minus],
        [`debugRow(${i}).plus`, debugRow(i).plus],
      ]),
    ),
    "DEBUG_BUTTONS.hpOne": DEBUG_BUTTONS.hpOne,
    "DEBUG_BUTTONS.reset": DEBUG_BUTTONS.reset,
    "DEBUG_BUTTONS.close": DEBUG_BUTTONS.close,
  },
  debugToggle: {
    ...Object.fromEntries([0, 1, 2, 3, 4, 5].map((i) => [`debugRow(${i}).toggle`, debugRow(i).toggle])),
    "DEBUG_BUTTONS.hpOne": DEBUG_BUTTONS.hpOne,
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
    expect(TOUCH_EXCEPTIONS).toEqual(["header.settings"]);
    expect(inside(HEADER_SETTINGS, regions(data.config.ui.layout, W).header)).toBe(true);
    // 押せない欄も画面の内側
    expect(inside(CREATION_ERROR, STAGE)).toBe(true);
    for (let i = 0; i < 6; i++) expect(inside(creationRow(i).label, STAGE)).toBe(true);
    for (let i = 0; i < 6; i++) {
      expect(inside(debugRow(i).label, STAGE)).toBe(true);
      expect(inside(debugRow(i).value, STAGE)).toBe(true);
    }
    // UI-57: 行 5 の下端（y325）の下にスワイプの表示（10px）、その下にボタンの段（y342）
    expect(debugRow(5).toggle.y).toBe(294);
    expect(DEBUG_SWIPE_Y).toBeGreaterThanOrEqual(debugRow(5).toggle.y + debugRow(5).toggle.h);
    for (const b of Object.values(DEBUG_BUTTONS)) expect(b.y).toBeGreaterThanOrEqual(DEBUG_SWIPE_Y + 10);
    // UI-57: ボタンは y342 の 56×32 を 全員HP1・既定に戻す・ポインタ・閉じる の順に左から 4 つ（間 2。UI-10 の一辺 30 以上）
    expect(Object.keys(DEBUG_BUTTONS)).toEqual(["hpOne", "reset", "pointers", "close"]);
    expect(Object.values(DEBUG_BUTTONS)).toEqual([4, 62, 120, 178].map((x) => ({ x, y: 342, w: 56, h: 32 })));
    for (const b of Object.values(DEBUG_BUTTONS)) expect(inside(b, STAGE)).toBe(true);
    // 作成のエラー欄は行とボタンに重ならない
    for (const r of Object.values(SCREENS.creation!)) expect(overlaps(CREATION_ERROR, r)).toBe(false);
  });

  // M5.5 でターン+ を足し、幅 56 の 4 つ（x 4 / 62 / 120 / 178）から幅 44 の 5 つに詰めた
  test("UI-57/UI-10 debug パネルの 2 段目（M5・M5.5）: y376 の 44×22 を x 4 / 50 / 96 / 142 / 188 に 5 つ（SAN段↓・イベント・罠の前・階段前・ターン+）。1 段目・設定の行・スワイプの表示と重ならず、パネル（240×400）に収まる。開発用の例外として TOUCH_MIN_LOGICAL ではなく UI-10 の 12 論理 px 以上", () => {
    expect(Object.keys(DEBUG_BUTTONS_M5)).toEqual(["sanDown", "warpEvent", "warpTrap", "warpStairs", "addTurns"]);
    expect(Object.values(DEBUG_BUTTONS_M5)).toEqual([4, 50, 96, 142, 188].map((x) => ({ x, y: 376, w: 44, h: 22 })));
    expect(DEBUG_BUTTONS_M5.addTurns.x + DEBUG_BUTTONS_M5.addTurns.w).toBeLessThanOrEqual(W);
    const others: Rect[] = [
      ...Object.values(DEBUG_BUTTONS),
      ...[0, 1, 2, 3, 4, 5].flatMap((i) => Object.values(debugRow(i))),
      { x: 0, y: DEBUG_SWIPE_Y, w: W, h: 10 },
    ];
    const m5 = Object.values(DEBUG_BUTTONS_M5);
    for (const [i, b] of m5.entries()) {
      expect(inside(b, STAGE)).toBe(true);
      expect(b.y + b.h).toBeLessThanOrEqual(H);
      expect(Math.min(b.w, b.h)).toBeGreaterThanOrEqual(12);
      for (const o of others) expect(overlaps(b, o)).toBe(false);
      for (const c of m5.slice(i + 1)) expect(overlaps(b, c)).toBe(false);
    }
    // 1 段目の下端（374）の下
    for (const b of m5) for (const a of Object.values(DEBUG_BUTTONS)) expect(b.y).toBeGreaterThanOrEqual(a.y + a.h);
  });

  test("UI-10/UI-54/UI-52 dpad/menu/list/mapClose/battleParty/battleMember/autoStop/townMenu が操作領域の内側", () => {
    const controls = regions(data.config.ui.layout, W).controls;
    for (const r of [...Object.values(L.dpad), ...L.menu, ...L.list, L.mapClose, ...L.battleParty, ...L.battleMember, L.autoStop, ...L.townMenu]) {
      expect(inside(r, controls)).toBe(true);
    }
    // UI-54 戦闘の枠は TOUCH_MIN_LOGICAL 以上で、下端の最大（94）は CONTROLS_MIN_HEIGHT（98）以内
    for (const r of [...L.battleParty, ...L.battleMember, L.autoStop, ...L.townMenu]) expect(Math.min(r.w, r.h)).toBeGreaterThanOrEqual(TOUCH_MIN_LOGICAL);
    // UI-52 街の施設メニューは 3 列 × 2 段の 76×40 の 6 枠（酒場・宿屋・寺院 / 闇魔術・迷宮へ・店）。段は戦闘のパーティの選択と同じ y 6 / 54
    expect(L.townMenu).toEqual([
      { x: 4, y: 306, w: 76, h: 40 },
      { x: 82, y: 306, w: 76, h: 40 },
      { x: 160, y: 306, w: 76, h: 40 },
      { x: 4, y: 354, w: 76, h: 40 },
      { x: 82, y: 354, w: 76, h: 40 },
      { x: 160, y: 354, w: 76, h: 40 },
    ]);
    for (const [i, a] of L.townMenu.entries()) for (const b of L.townMenu.slice(i + 1)) expect(overlaps(a, b)).toBe(false);
    // 下端の最大は 94 のまま（CONTROLS_MIN_HEIGHT は変わらない）
    expect(Math.max(...[...L.battleParty, ...L.battleMember, ...L.townMenu].map((r) => r.y + r.h)) - controls.y).toBe(94);
    expect(L.autoStop.y + L.autoStop.h - controls.y).toBeLessThanOrEqual(CONTROLS_MIN_HEIGHT);
    // 十字ボタンとメニューは重ならない
    for (const d of Object.values(L.dpad)) for (const m of L.menu) expect(overlaps(d, m)).toBe(false);
  });

  test("UI-54 オート解除の矩形は、オートが解けた後に出るパーティの選択のうちコマンドを送る枠（前回と同じ・逃げる・オート = battleParty[1..3]）と重ならず、戦う（battleParty[0]）と同じ矩形", () => {
    for (const r of L.battleParty.slice(1)) expect(overlaps(L.autoStop, r)).toBe(false);
    expect(L.autoStop).toEqual(L.battleParty[0]);
    // 区切りを変えても同じ（操作領域の原点に付いてくる）
    const g2 = regions({ ...data.config.ui.layout, view: 150, message: 60, party: 74, controls: 100 }, W);
    const L2 = dungeonLayout(g2, N);
    for (const r of L2.battleParty.slice(1)) expect(overlaps(L2.autoStop, r)).toBe(false);
  });

  test("UI-10/UI-53 キャンプの枠は 4 列 × 2 段の 56×40 の 8 枠（x 4 / 62 / 120 / 178、y 6 / 54）。操作領域の内側で重ならず、一辺は TOUCH_MIN_LOGICAL 以上", () => {
    const controls = regions(data.config.ui.layout, W).controls;
    expect(L.campGrid).toEqual([306, 354].flatMap((y) => [4, 62, 120, 178].map((x) => ({ x, y, w: 56, h: 40 }))));
    for (const r of L.campGrid) {
      expect(inside(r, controls)).toBe(true);
      expect(Math.min(r.w, r.h)).toBeGreaterThanOrEqual(TOUCH_MIN_LOGICAL);
    }
    for (const [i, a] of L.campGrid.entries()) for (const b of L.campGrid.slice(i + 1)) expect(overlaps(a, b)).toBe(false);
    expect(CONTROLS_MIN_HEIGHT).toBe(98);
  });

  test("UI-54 header.turn は header の文字領域の右端（幅 HEADER_TURN_W）で、設定ボタンと重ならない。縮めた問いの領域とも重ならない", () => {
    for (const lay of [data.config.ui.layout, { header: 20, view: 150, message: 66, party: 64, controls: 100 }]) {
      const g = regions(lay, W);
      const d = dungeonLayout(g, N);
      const tu = d.header.turn;
      expect(tu.w).toBe(HEADER_TURN_W);
      expect(inside(tu, g.header)).toBe(true);
      expect(inside(tu, d.header.text)).toBe(true);
      expect(tu.x + tu.w).toBe(d.header.text.x + d.header.text.w);
      expect(overlaps(tu, d.header.settings)).toBe(false);
      // ターン表示の間の問いの領域（text.w − HEADER_TURN_W − HEADER_TURN_GAP）は turn の左に HEADER_TURN_GAP 空く
      const shrunk = { ...d.header.text, w: d.header.text.w - HEADER_TURN_W - HEADER_TURN_GAP };
      expect(overlaps(shrunk, tu)).toBe(false);
      expect(tu.x - (shrunk.x + shrunk.w)).toBe(HEADER_TURN_GAP);
    }
    // 既定の問いの最長（「{name}はどうする？」の 6 文字の名前で 12 字 = 96px）は縮めた 132px に収まる
    expect(L.header.text.w - HEADER_TURN_W - HEADER_TURN_GAP).toBeGreaterThanOrEqual(96);
  });

  test("ui §2 既定の layout（16/150/70/64/100）での迷宮の画面の座標は M2 の定数と同じ", () => {
    // turn は M5.5（UI-54）で足した（text の右端 x140..195 に右寄せ）
    expect(L.header).toEqual({
      text: { x: 4, y: 0, w: 192, h: 16 },
      settings: { x: 200, y: 0, w: 40, h: 16 },
      turn: { x: 140, y: 0, w: 56, h: 16 },
    });
    expect(L.dpad).toEqual({
      forward: { x: 40, y: 300, w: 32, h: 32 },
      left: { x: 6, y: 333, w: 32, h: 32 },
      right: { x: 74, y: 333, w: 32, h: 32 },
      around: { x: 40, y: 366, w: 32, h: 32 },
    });
    expect(L.menu).toEqual([
      { x: 124, y: 300, w: 56, h: 32 },
      { x: 182, y: 300, w: 56, h: 32 },
      { x: 124, y: 333, w: 56, h: 32 },
      { x: 182, y: 333, w: 56, h: 32 },
    ]);
    expect(L.list).toEqual([
      { x: 8, y: 302, w: 224, h: 32 },
      { x: 8, y: 334, w: 224, h: 32 },
      { x: 8, y: 366, w: 224, h: 32 },
    ]);
    expect(L.mapClose).toEqual({ x: 60, y: 334, w: 120, h: 32 });
    // UI-25 地図の「移動」は閉じるの真下で同じ幅（下端 397 は操作領域の内側）
    expect(L.mapGo).toEqual({ x: 60, y: 366, w: 120, h: 32 });
    expect(inside(L.mapGo, regions(data.config.ui.layout, W).controls)).toBe(true);
    // UI-11 一覧の外の戻るは戦闘のメンバーの戻る（battleMember[4]）・キャンプの [7] と同じ 56×40（x178..233・y354..393）。
    // 行は list と同じ 3 行で幅 168（x8..175。戻るとの間 2）
    expect(L.listBack).toEqual({ x: 178, y: 354, w: 56, h: 40 });
    expect(L.listBack).toEqual(L.battleMember[4]);
    expect(L.listBack).toEqual(L.campGrid[7]);
    expect(L.listNarrow).toEqual(L.list.map((r) => ({ ...r, w: 168 })));
    for (const r of [...L.listNarrow, L.listBack]) expect(inside(r, regions(data.config.ui.layout, W).controls)).toBe(true);
    // UI-54 戦闘: パーティの選択は 2 列 × 2 段の 114×40（x 4/122、y 306/354）、メンバーは上段 4 つの 56×40
    // （x 4/62/120/178、y 306）と下段の右端の戻る（x 178、y 354）、オート解除
    expect(L.battleParty).toEqual([306, 354].flatMap((y) => [4, 122].map((x) => ({ x, y, w: 114, h: 40 }))));
    expect(L.battleMember).toEqual([...[4, 62, 120, 178].map((x) => ({ x, y: 306, w: 56, h: 40 })), { x: 178, y: 354, w: 56, h: 40 }]);
    // オート解除はパーティの選択の「戦う」と同じ矩形（送る枠に重ねない）
    expect(L.autoStop).toEqual({ x: 4, y: 306, w: 114, h: 40 });
    // メッセージ窓（y166..235）: 文字領域 x4..235・y168..233 の 6 行、続きの三角 x228..235・y226..233
    expect(L.message).toEqual({ text: { x: 4, y: 168, w: 232, h: 66 }, lines: 6, more: { x: 228, y: 226, w: 8, h: 8 } });
    // パーティ欄（y236..299）: 行 i は y238+10i
    expect(L.partyRows).toEqual([0, 1, 2, 3, 4, 5].map((i) => ({ x: 0, y: 238 + 10 * i, w: 240, h: 10 })));
    // 地図: ビューとメッセージを合わせた 240×220。題 12、本体 240×208
    expect(L.map).toEqual({
      overlay: { x: 0, y: 16, w: 240, h: 220 },
      title: { x: 0, y: 16, w: 240, h: 12 },
      area: { x: 0, y: 28, w: 240, h: 208 },
    });
    // UI-53 キャンプのパネル: ビュー領域（240×150）だけ。UI-56 全滅の内訳: 地図と同じ 240×220
    expect(L.camp).toEqual({ x: 0, y: 16, w: 240, h: 150 });
    expect(L.wipe).toEqual({ x: 0, y: 16, w: 240, h: 220 });
    // UI-46 履歴の画面: 地図と同じ 240×220（y16..235）。題 12、一覧 240×208
    expect(L.history).toEqual({
      overlay: { x: 0, y: 16, w: 240, h: 220 },
      title: { x: 0, y: 16, w: 240, h: 12 },
      list: { x: 0, y: 28, w: 240, h: 208 },
    });
    expect(CONTROLS_MIN_HEIGHT).toBe(98);
    expect(layoutWarnings(regions(data.config.ui.layout, W), L)).toEqual([]);
  });

  test("ui §2 区切りを変えると、迷宮の画面の矩形は対応する領域の内側に収まり、領域の移動に追従する", () => {
    const base = regions(data.config.ui.layout, W);
    const rel = (r: Rect, o: Rect): Rect => ({ x: r.x - o.x, y: r.y - o.y, w: r.w, h: r.h });
    for (const l of [
      { header: 16, view: 150, message: 64, party: 70, controls: 100 }, // party 70・message 64
      { header: 16, view: 150, message: 74, party: 60, controls: 100 }, // party ちょうど 6 行
      { header: 20, view: 150, message: 80, party: 64, controls: 86 }, // 操作領域が足りない（下で warn を確かめる）
      { header: 12, view: 150, message: 78, party: 62, controls: 98 }, // 操作領域がちょうど下限
    ]) {
      const g = regions(l, W);
      const d = dungeonLayout(g, N);
      const tag = JSON.stringify(l);
      // ヘッダー
      expect(inside(d.header.settings, g.header), tag).toBe(true);
      expect(inside(d.header.text, g.header), tag).toBe(true);
      expect(d.header.settings.h, tag).toBe(l.header);
      // 操作領域: 原点からの相対は既定と同じ
      for (const k of Object.keys(L.dpad) as Array<keyof typeof L.dpad>) expect(rel(d.dpad[k], g.controls), tag).toEqual(rel(L.dpad[k], base.controls));
      d.menu.forEach((r, i) => expect(rel(r, g.controls), tag).toEqual(rel(L.menu[i]!, base.controls)));
      d.list.forEach((r, i) => expect(rel(r, g.controls), tag).toEqual(rel(L.list[i]!, base.controls)));
      d.listNarrow.forEach((r, i) => expect(rel(r, g.controls), tag).toEqual(rel(L.listNarrow[i]!, base.controls)));
      expect(rel(d.listBack, g.controls), tag).toEqual(rel(L.listBack, base.controls));
      expect(rel(d.mapClose, g.controls), tag).toEqual(rel(L.mapClose, base.controls));
      expect(rel(d.mapGo, g.controls), tag).toEqual(rel(L.mapGo, base.controls));
      d.battleParty.forEach((r, i) => expect(rel(r, g.controls), tag).toEqual(rel(L.battleParty[i]!, base.controls)));
      d.battleMember.forEach((r, i) => expect(rel(r, g.controls), tag).toEqual(rel(L.battleMember[i]!, base.controls)));
      expect(rel(d.autoStop, g.controls), tag).toEqual(rel(L.autoStop, base.controls));
      d.townMenu.forEach((r, i) => expect(rel(r, g.controls), tag).toEqual(rel(L.townMenu[i]!, base.controls)));
      const fits = l.controls >= CONTROLS_MIN_HEIGHT;
      for (const r of [...Object.values(d.dpad), ...d.menu, ...d.list, d.mapClose, d.mapGo, ...d.battleParty, ...d.battleMember, d.autoStop, ...d.townMenu])
        if (fits) expect(inside(r, g.controls), tag).toBe(true);
      // メッセージ: 文字領域と三角は窓の内側、行数は (高さ - 4) / 10 の切り捨て
      expect(inside(d.message.text, g.message), tag).toBe(true);
      expect(inside(d.message.more, d.message.text), tag).toBe(true);
      expect(d.message.lines, tag).toBe(Math.floor((l.message - 4) / 10));
      expect(d.message.more.y + d.message.more.h, tag).toBe(g.message.y + g.message.h - 2);
      // パーティ: 6 行が領域の内側で、10px 間隔
      expect(d.partyRows.length, tag).toBe(N);
      d.partyRows.forEach((r, i) => {
        expect(inside(r, g.party), tag).toBe(true);
        expect(r.y - d.partyRows[0]!.y, tag).toBe(10 * i);
      });
      // 地図: ビューの上端からメッセージの下端まで
      expect(d.map.overlay, tag).toEqual({ x: 0, y: g.view.y, w: W, h: l.view + l.message });
      expect(d.map.area.y + d.map.area.h, tag).toBe(g.message.y + g.message.h);
      expect(inside(d.map.area, d.map.overlay) && inside(d.map.title, d.map.overlay), tag).toBe(true);
      // 全滅の内訳（UI-56）は地図の overlay と同じ範囲、キャンプ（UI-53）はビュー領域
      expect(d.wipe, tag).toEqual(d.map.overlay);
      expect(d.camp, tag).toEqual(g.view);
      d.campGrid.forEach((r, i) => expect(rel(r, g.controls), tag).toEqual(rel(L.campGrid[i]!, base.controls)));
      // 収まらないのは操作領域が下限より低いときだけで、その分だけ warn の文が出る
      const warns = layoutWarnings(g, d);
      if (fits) expect(warns, tag).toEqual([]);
      else expect(warns, tag).toEqual([
        "ui.layout: dpad.around does not fit in the controls region (height 86)",
        "ui.layout: list[2] does not fit in the controls region (height 86)",
        "ui.layout: listNarrow[2] does not fit in the controls region (height 86)",
        "ui.layout: listBack does not fit in the controls region (height 86)",
        "ui.layout: mapGo does not fit in the controls region (height 86)",
        "ui.layout: battleParty[2] does not fit in the controls region (height 86)",
        "ui.layout: battleParty[3] does not fit in the controls region (height 86)",
        "ui.layout: battleMember[4] does not fit in the controls region (height 86)",
        "ui.layout: townMenu[3] does not fit in the controls region (height 86)",
        "ui.layout: townMenu[4] does not fit in the controls region (height 86)",
        "ui.layout: townMenu[5] does not fit in the controls region (height 86)",
        "ui.layout: campGrid[4] does not fit in the controls region (height 86)",
        "ui.layout: campGrid[5] does not fit in the controls region (height 86)",
        "ui.layout: campGrid[6] does not fit in the controls region (height 86)",
        "ui.layout: campGrid[7] does not fit in the controls region (height 86)",
      ]);
    }
  });

  test("ui §2 パーティ欄がちょうど party.size × 10 なら上の余白を詰める。メッセージに 1 行も入らなければ warn", () => {
    const g = regions({ header: 16, view: 150, message: 74, party: 60, controls: 100 }, W);
    expect(dungeonLayout(g, N).partyRows[0]).toEqual({ x: 0, y: g.party.y, w: W, h: 10 });
    const g2 = regions({ header: 16, view: 150, message: 13, party: 64, controls: 157 }, W);
    expect(layoutWarnings(g2, dungeonLayout(g2, N))).toEqual(["ui.layout: message region (height 13) has no text line"]);
  });

  test("UI-50 タイトル: 題字 y32、行 i は y52+34i の 224×32、行の欄は 5 行ちょうど、案内の欄・ボタン 4 枠は行と重ならない", () => {
    expect(TITLE_HEADING_Y).toBe(32);
    expect(TITLE_ROWS).toEqual([0, 1, 2, 3, 4].map((i) => ({ x: 8, y: 52 + 34 * i, w: 224, h: 32 })));
    expect(TITLE_ROW_PITCH).toBe(34);
    expect(TITLE_ROW_AREA).toEqual({ x: 8, y: 52, w: 224, h: 168 });
    for (const r of TITLE_ROWS) expect(inside(r, TITLE_ROW_AREA)).toBe(true);
    expect(TITLE_NOTICE).toEqual({ x: 8, y: 226, w: 224, h: 22 });
    expect(TITLE_BUTTONS).toEqual([
      { x: 8, y: 256, w: 108, h: 32 },
      { x: 124, y: 256, w: 108, h: 32 },
      { x: 8, y: 296, w: 108, h: 32 },
      { x: 124, y: 296, w: 108, h: 32 },
    ]);
    // 題字（1 行 8px）は行の欄より上
    expect(TITLE_HEADING_Y + 8).toBeLessThanOrEqual(TITLE_ROW_AREA.y);
    expect(inside(TITLE_NOTICE, STAGE)).toBe(true);
    for (const r of [TITLE_ROW_AREA, ...TITLE_BUTTONS]) expect(overlaps(TITLE_NOTICE, r)).toBe(false);
    for (const b of TITLE_BUTTONS) expect(overlaps(b, TITLE_ROW_AREA)).toBe(false);
    // SV-23 の帯（既定 y16..27）は題字（1 行 8px）・行・ボタンに重ならない
    expect(SAVE_BANNER.y + SAVE_BANNER.h).toBeLessThanOrEqual(TITLE_HEADING_Y);
    for (const r of [TITLE_ROW_AREA, ...TITLE_BUTTONS]) expect(overlaps(SAVE_BANNER, r)).toBe(false);
  });

  test("SV-40 TITLE_HINT は TITLE_BUTTONS の下でステージに収まる（2 行 = 高さ 20。押せない）", () => {
    expect(TITLE_HINT).toEqual({ x: 8, y: 336, w: 224, h: 20 });
    expect(inside(TITLE_HINT, STAGE)).toBe(true);
    for (const b of TITLE_BUTTONS) expect(TITLE_HINT.y).toBeGreaterThanOrEqual(b.y + b.h);
    for (const r of [TITLE_ROW_AREA, TITLE_NOTICE, ...TITLE_BUTTONS, SAVE_BANNER]) expect(overlaps(TITLE_HINT, r)).toBe(false);
  });

  test("SV-23 保存できない帯はヘッダーの直下で高さ config.ui.saveBannerHeight（既定 12 で y16..27）。ヘッダーの設定ボタンと重ならず、ステージの内側", () => {
    const g = regions(data.config.ui.layout, W);
    expect(data.config.ui.saveBannerHeight).toBe(12);
    expect(SAVE_BANNER).toEqual({ x: 0, y: 16, w: 240, h: 12 });
    expect(inside(SAVE_BANNER, STAGE)).toBe(true);
    expect(overlaps(SAVE_BANNER, g.header)).toBe(false);
    expect(overlaps(SAVE_BANNER, HEADER_SETTINGS)).toBe(false);
    expect(SAVE_BANNER.y).toBe(g.header.y + g.header.h);
    // header の高さを変えたら帯も付いてくる
    const g2 = regions({ header: 20, view: 146, message: 70, party: 64, controls: 100 }, W);
    expect(saveBannerRect(g2, 10)).toEqual({ x: 0, y: 20, w: 240, h: 10 });
  });

  test("UI-10 scale 4/3 で 30 論理 px が 40 CSS px 以上", () => {
    expect(TOUCH_MIN_LOGICAL).toBe(30);
    expect(TOUCH_MIN_LOGICAL * (4 / 3)).toBeGreaterThanOrEqual(40);
    // scale 1（320 CSS px 幅）では満たさない（decisions に記録した既知の制約）
    expect(TOUCH_MIN_LOGICAL * 1).toBeLessThan(40);
  });
});

describe("SV-42 更新の案内の配置", () => {
  test("SV-42 更新の案内: 文言の欄とボタン 2 つは枠の中で重ならず、枠はヘッダー（設定ボタン）と既定の SV-23 の帯にかからない", () => {
    const { box, text, reload, close } = UPDATE_NOTICE;
    for (const r of [text, reload, close]) expect(inside(r, box)).toBe(true);
    expect(inside(box, STAGE)).toBe(true);
    expect(overlaps(text, reload) || overlaps(text, close) || overlaps(reload, close)).toBe(false);
    expect(overlaps(box, HEADER_SETTINGS)).toBe(false);
    expect(overlaps(box, SAVE_BANNER)).toBe(false);
  });

  test("SV-42 更新の案内: 「閉じる」が左、「読み込み直す」が右（隠れた一覧の行の左寄りのタップが読み込み直しにならない）", () => {
    const { reload, close } = UPDATE_NOTICE;
    expect(close.x + close.w).toBeLessThanOrEqual(reload.x);
    expect(close.y).toBe(reload.y);
  });
});
