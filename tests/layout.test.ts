import { describe, expect, test } from "vitest";
import {
  CREATION_BUTTONS,
  CREATION_ERROR,
  creationRow,
  CONTROLS_MIN_HEIGHT,
  DEBUG_BUTTONS,
  DEBUG_BUTTONS_M5,
  DEBUG_BUTTONS_M7,
  DEBUG_SWIPE_Y,
  debugRow,
  dungeonLayout,
  HEADER_TURN_GAP,
  HEADER_TURN_W,
  layoutWarnings,
  LIST_WIDE_ROW_H,
  regions,
  saveBannerRect,
  isTouchException,
  TITLE_BUTTONS,
  TITLE_HEADING_Y,
  TITLE_HINT,
  TITLE_NOTICE,
  TITLE_ROW_AREA,
  TITLE_ROW_PITCH,
  TITLE_ROWS,
  TOUCH_EXCEPTIONS,
  TOUCH_MIN_LOGICAL,
  TOWN_NOTE_LINE_H,
  TOWN_NOTE_LINES,
  TOWN_ROW_H,
  townLayout,
  UPDATE_NOTICE,
  type Rect,
} from "../src/presenter/layout";
import { characterHitRects, type CharacterDetail } from "../src/presenter/views/detail";
import { headerText } from "../src/presenter/views/header";
import { formatMessage } from "../src/presenter/views/message";
import { data } from "./helpers/core";

const W = data.config.stage.width;
const H = data.config.stage.height;
const N = data.config.party.size;
/** 既定の config.ui.layout（16/150/70/64/100）での迷宮の画面の矩形 */
const L = dungeonLayout(regions(data.config.ui.layout, W), N);
const HEADER_SETTINGS = L.header.settings;
/** UI-46（M16）: 迷宮・戦闘のヘッダーのログ（街と同じ位置） */
const HEADER_LOG = L.header.log;
/** UI-82（M23）: ヘッダーの「？」（ログの左。街・迷宮・戦闘で同じ位置） */
const HEADER_HELP = L.header.help;
/** UI-13（M8.5）: 既定の config での街の画面の矩形 */
const T = townLayout(regions(data.config.ui.layout, W), N);
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
        // M20（D-8。UI-51）: 職業の略称は押せる（説明の欄に職業の説明）
        [`creationRow(${i}).abbr`, creationRow(i).abbr],
      ]),
    ),
    "CREATION_BUTTONS.random": CREATION_BUTTONS.random,
    "CREATION_BUTTONS.start": CREATION_BUTTONS.start,
    "CREATION_BUTTONS.back": CREATION_BUTTONS.back,
  },
  // UI-13（M8.5）新しい街の画面: ヘッダーのログと設定、帯の 6 セル（押せる範囲 40×22）、一覧の 9 行、固定の戻る
  townScreen: {
    "header.help": T.header.help,
    "header.log": T.header.log,
    "header.settings": T.header.settings,
    ...Object.fromEntries(T.band.hits.map((r, i) => [`town.band[${i}]`, r])),
    ...Object.fromEntries(T.list.rows.map((r, i) => [`town.list[${i}]`, r])),
    back: T.back,
  },
  // UI-13 / UI-52（M10）街の施設メニュー: ヘッダーのログと設定、帯の 6 セル、48×48 の 6 枠（一覧の行と戻るは出さない）
  townMenu: {
    "header.help": T.header.help,
    "header.log": T.header.log,
    "header.settings": T.header.settings,
    ...Object.fromEntries(T.band.hits.map((r, i) => [`town.band[${i}]`, r])),
    ...Object.fromEntries(T.grid.map((r, i) => [`town.grid[${i}]`, r])),
  },
  // UI-11 末尾が戻る / やめるの一覧（街の各施設・キャンプと酒場の一覧の段・戦闘の呪文・道具・対象）: 幅 168 の行と、一覧の外の戻る
  listFixed: {
    "header.help": HEADER_HELP, "header.log": HEADER_LOG,
    "header.settings": HEADER_SETTINGS,
    ...Object.fromEntries(L.listNarrow.map((r, i) => [`listNarrow[${i}]`, r])),
    listBack: L.listBack,
  },
  dungeon: {
    "header.help": HEADER_HELP, "header.log": HEADER_LOG,
    "header.settings": HEADER_SETTINGS,
    ...Object.fromEntries(Object.entries(L.dpad).map(([k, r]) => [`dpad.${k}`, r])),
    ...Object.fromEntries(L.menu.map((r, i) => [`menu[${i}]`, r])),
  },
  // UI-11 / UI-13（M16）迷宮・戦闘の広い一覧: 末尾を固定する一覧（戦闘の呪文・道具・確認・対象、宝箱の段）は幅 168 の 22px の行と固定の戻る、
  // 固定しない一覧（保留中の選択）は幅 224 の行。行は UI-10 の例外 listWide
  listWideFixed: {
    "header.help": HEADER_HELP, "header.log": HEADER_LOG,
    "header.settings": HEADER_SETTINGS,
    ...Object.fromEntries(L.listWide.rows.map((r, i) => [`listWide[${i}]`, { ...r, w: L.listNarrow[0]!.w }])),
    listBack: L.listBack,
  },
  listWideChoice: { "header.help": HEADER_HELP, "header.log": HEADER_LOG, "header.settings": HEADER_SETTINGS, ...Object.fromEntries(L.listWide.rows.map((r, i) => [`listWide[${i}]`, r])) },
  // 選択肢（階段の確認）は迷宮の上で十字ボタンの代わりに list を出す（M16 からは listWideChoice の位置）
  choice: { "header.help": HEADER_HELP, "header.log": HEADER_LOG, "header.settings": HEADER_SETTINGS, ...Object.fromEntries(L.list.map((r, i) => [`list[${i}]`, r])) },
  // UI-25 地図: 閉じると移動。UI-24（M19）: 閉じるの右隣に凡例
  map: { mapClose: L.mapClose, mapGo: L.mapGo, mapLegend: L.mapLegend },
  // UI-54 戦闘: パーティの選択の 4 枠、メンバーの 5 枠（対象などの一覧は list と同じ）、オート中は「オート解除」だけ
  battleParty: { "header.help": HEADER_HELP, "header.log": HEADER_LOG, "header.settings": HEADER_SETTINGS, ...Object.fromEntries(L.battleParty.map((r, i) => [`battleParty[${i}]`, r])) },
  battleMember: { "header.help": HEADER_HELP, "header.log": HEADER_LOG, "header.settings": HEADER_SETTINGS, ...Object.fromEntries(L.battleMember.map((r, i) => [`battleMember[${i}]`, r])) },
  battleList: { "header.help": HEADER_HELP, "header.log": HEADER_LOG, "header.settings": HEADER_SETTINGS, ...Object.fromEntries(L.list.map((r, i) => [`list[${i}]`, r])) },
  autoStop: { "header.help": HEADER_HELP, "header.log": HEADER_LOG, "header.settings": HEADER_SETTINGS, autoStop: L.autoStop },
  // UI-59（M16）キャラクター画面: ヘッダーの ◀ ▶・ログ・設定と、操作の 4×2 の枠
  character: {
    // UI-82（M23）: キャラクター画面（overlay camp）の間は「？」を隠すので入れない
    "header.prev": L.header.prev,
    "header.next": L.header.next,
    "header.log": HEADER_LOG,
    "header.settings": HEADER_SETTINGS,
    ...Object.fromEntries(L.campGrid.map((r, i) => [`campGrid[${i}]`, r])),
  },
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
        if (isTouchException(name)) continue;
        expect(Math.min(r.w, r.h), `${screen} ${name}`).toBeGreaterThanOrEqual(TOUCH_MIN_LOGICAL);
      }
      for (let i = 0; i < entries.length; i++)
        for (let j = i + 1; j < entries.length; j++)
          expect(overlaps(entries[i]![1], entries[j]![1]), `${screen} ${entries[i]![0]} / ${entries[j]![0]}`).toBe(false);
    }
    // 例外はヘッダーの設定ボタン、M8.5 の街のログ・帯・一覧の行、M16 の迷宮・戦闘の広い一覧の行だけで、ヘッダーの 2 つはヘッダーの中に収まる
    // M16（UI-59）: キャラクター画面のヘッダーの ◀ ▶（header.prev / header.next）を足した。追補 H-2 から押せる矩形は 24×32（幅 24 < 30 なので例外のまま）で、
    // 見た目の枠（prevMark / nextMark）がヘッダーの中に収まる
    // M20（UI-80）: キャラクター画面の品の行 character.item（高さ 12。SCREENS には入れず、下の UI-80 のテストで確かめる）
    // M21（B-3）: 設定画面の 7 行の値のトグル settings.row（高さ 26。SCREENS には入れず、settings-view.test の settingsLayout のテストで確かめる）
    expect(TOUCH_EXCEPTIONS).toEqual(["header.settings", "header.log", "header.help", "header.prev", "header.next", "town.band", "town.list", "listWide", "character.item", "settings.row"]);
    for (const k of ["prevMark", "nextMark"] as const) expect(inside(L.header[k], regions(data.config.ui.layout, W).header), k).toBe(true);
    expect(inside(T.header.log, regions(data.config.ui.layout, W).header)).toBe(true);
    // M23（UI-82）: ヘッダーの「？」header.help（28×16）を足した。ヘッダーの中に収まる
    expect(inside(HEADER_HELP, regions(data.config.ui.layout, W).header)).toBe(true);
    expect(inside(T.header.help, regions(data.config.ui.layout, W).header)).toBe(true);
    expect(inside(HEADER_SETTINGS, regions(data.config.ui.layout, W).header)).toBe(true);
    // 押せない欄も画面の内側
    expect(inside(CREATION_ERROR, STAGE)).toBe(true);
    for (let i = 0; i < 6; i++) expect(inside(creationRow(i).label, STAGE)).toBe(true);
    // UI-51（M16）: 職業の略称も画面の内側。M20（D-8）から押せるので SCREENS.creation に入れ、一辺 30 以上と重ならないことは上のテストで見る
    for (let i = 0; i < 6; i++) expect(inside(creationRow(i).abbr, STAGE)).toBe(true);
    expect(creationRow(0).abbr).toEqual({ x: 94, y: 34, w: 32, h: 32 });
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

  test("UI-57/UI-10（M7）debug パネルの SAN+10 は計測値の 0〜2 行目（y42..71）の右（x188・44×30）。ステージに収まり、設定の行・1 段目・2 段目・スワイプの表示と重ならない。TOUCH_MIN_LOGICAL（30）以上", () => {
    const b = DEBUG_BUTTONS_M7.sanOver;
    expect(b).toEqual({ x: 188, y: 42, w: 44, h: 30 });
    expect(inside(b, STAGE)).toBe(true);
    expect(Math.min(b.w, b.h)).toBeGreaterThanOrEqual(TOUCH_MIN_LOGICAL);
    // 計測値は y42 から 1 行 10px。0〜2 行目（scale / deviceScale / integer）の中に収める
    expect(b.y).toBeGreaterThanOrEqual(42);
    expect(b.y + b.h).toBeLessThanOrEqual(72);
    // 0〜2 行目は「deviceScale 12.3456」でも 19 字（半角 4px で 76px、x4 から 80）なので、その右に置く
    expect(b.x).toBeGreaterThanOrEqual(4 + 4 * 19);
    for (const o of [
      ...Object.values(DEBUG_BUTTONS),
      ...Object.values(DEBUG_BUTTONS_M5),
      ...[0, 1, 2, 3, 4, 5].flatMap((i) => Object.values(debugRow(i))),
      { x: 0, y: DEBUG_SWIPE_Y, w: W, h: 10 },
    ]) {
      expect(overlaps(b, o)).toBe(false);
    }
  });

  // M8.5: 街の施設メニュー（3 列 × 2 段の townMenu）は UI-13 の 6 行の一覧に置き換えたので外した
  test("UI-10/UI-54 dpad/menu/list/mapClose/battleParty/battleMember/autoStop が操作領域の内側", () => {
    const controls = regions(data.config.ui.layout, W).controls;
    for (const r of [...Object.values(L.dpad), ...L.menu, ...L.list, L.mapClose, ...L.battleParty, ...L.battleMember, L.autoStop]) {
      expect(inside(r, controls)).toBe(true);
    }
    // UI-54 戦闘の枠は TOUCH_MIN_LOGICAL 以上で、下端の最大（94）は CONTROLS_MIN_HEIGHT（98）以内
    for (const r of [...L.battleParty, ...L.battleMember, L.autoStop]) expect(Math.min(r.w, r.h)).toBeGreaterThanOrEqual(TOUCH_MIN_LOGICAL);
    expect(Math.max(...[...L.battleParty, ...L.battleMember].map((r) => r.y + r.h)) - controls.y).toBe(94);
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
      // UI-46（M16）: ログのボタンとも重ならない
      expect(overlaps(tu, d.header.log)).toBe(false);
      // UI-82（M23）: 「？」とも重ならない
      expect(overlaps(tu, d.header.help)).toBe(false);
      // ターン表示の間の問いの領域（text.w − HEADER_TURN_W − HEADER_TURN_GAP）は turn の左に HEADER_TURN_GAP 空く
      const shrunk = { ...d.header.text, w: d.header.text.w - HEADER_TURN_W - HEADER_TURN_GAP };
      expect(overlaps(shrunk, tu)).toBe(false);
      expect(tu.x - (shrunk.x + shrunk.w)).toBe(HEADER_TURN_GAP);
    }
    // 既定の問いの最長（M18: 「{name}（後衛）は？」の 6 文字の名前で 12 字 = 96px。M17 までは「{name}はどうする？」で同じ 96px）は縮めた 96px にちょうど収まる
    //（M16 でログと並べて 100px。以前は 132px。M23（UI-82）で「？」を足して 96px）
    expect(HEADER_TURN_W).toBe(48);
    expect(L.header.text.w - HEADER_TURN_W - HEADER_TURN_GAP).toBe(96);
    expect(L.header.text.w - HEADER_TURN_W - HEADER_TURN_GAP).toBeGreaterThanOrEqual(96);
    // 「第12ターン」（全角 5 字 = 40px）はターン表示に収まる
    expect(HEADER_TURN_W).toBeGreaterThanOrEqual(40);
  });

  test("ui §2 既定の layout（16/150/70/64/100）での迷宮の画面の座標は M2 の定数と同じ", () => {
    // turn は M5.5（UI-54）で足した。M16（UI-46）でログ x160..199 を足し、text は x4..155（152）、turn は 56 → 48 で x108..155
    //（以前は text w192・turn x140 w56、log なし）。M23（UI-82）: 「？」x156..183・ログ x184..211・設定 x212..239（各 28）、text x4..151（148）、turn x104..151
    expect(L.header).toEqual({
      text: { x: 4, y: 0, w: 148, h: 16 },
      help: { x: 156, y: 0, w: 28, h: 16 },
      log: { x: 184, y: 0, w: 28, h: 16 },
      settings: { x: 212, y: 0, w: 28, h: 16 },
      turn: { x: 104, y: 0, w: 48, h: 16 },
      // UI-59（M16）: キャラクター画面の ◀ ▶ と、その間の問い。追補 H-2 から押せる矩形は 24×32、見た目の枠は 24×16。M23: ▶ は「？」の左（x132..155）
      prev: { x: 0, y: 0, w: 24, h: 32 },
      next: { x: 132, y: 0, w: 24, h: 32 },
      prevMark: { x: 0, y: 0, w: 24, h: 16 },
      nextMark: { x: 132, y: 0, w: 24, h: 16 },
      navText: { x: 28, y: 0, w: 100, h: 16 },
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
    // UI-24（M19）: 地図の「凡例」は閉じるの右隣（x184..235・y334..365）。操作領域の内側で、閉じる・移動と重ならない
    expect(L.mapLegend).toEqual({ x: 184, y: 334, w: 52, h: 32 });
    expect(inside(L.mapLegend, regions(data.config.ui.layout, W).controls)).toBe(true);
    expect(overlaps(L.mapLegend, L.mapClose) || overlaps(L.mapLegend, L.mapGo)).toBe(false);
    // UI-11 一覧の外の戻るは戦闘のメンバーの戻る（battleMember[4]）・キャンプの [7] と同じ 56×40（x178..233・y354..393）。
    // 行は list と同じ 3 行で幅 168（x8..175。戻るとの間 2）
    expect(L.listBack).toEqual({ x: 178, y: 354, w: 56, h: 40 });
    expect(L.listBack).toEqual(L.battleMember[4]);
    expect(L.listBack).toEqual(L.campGrid[7]);
    expect(L.listNarrow).toEqual(L.list.map((r) => ({ ...r, w: 168 })));
    // UI-11/UI-52（M24 C-2）: 固定の「決める」は戻るの真上（x178..233・y306..345。間 8）。戦闘のメンバー [3]・キャンプの [3] と同じ 56×40
    expect(L.listDecide).toEqual({ x: 178, y: 306, w: 56, h: 40 });
    expect(L.listDecide).toEqual(L.battleMember[3]);
    expect(L.listDecide).toEqual(L.campGrid[3]);
    expect(L.listBack.y - (L.listDecide.y + L.listDecide.h)).toBe(8);
    expect(overlaps(L.listDecide, L.listBack)).toBe(false);
    for (const r of L.listNarrow) expect(overlaps(L.listDecide, r)).toBe(false);
    expect(inside(L.listDecide, regions(data.config.ui.layout, W).controls)).toBe(true);
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
    // UI-24 / UI-13（M19）地図: ビュー・メッセージ・パーティ欄を合わせた 240×284（y16..299）。題 12、注記の行 10、本体 240×262
    expect(L.map).toEqual({
      overlay: { x: 0, y: 16, w: 240, h: 284 },
      title: { x: 0, y: 16, w: 240, h: 12 },
      note: { x: 0, y: 28, w: 240, h: 10 },
      area: { x: 0, y: 38, w: 240, h: 262 },
    });
    // UI-53 キャンプのパネル: ビュー領域（240×150）だけ。UI-56 全滅の内訳: ビューとメッセージの 240×220（M18 までの地図と同じ）
    expect(L.camp).toEqual({ x: 0, y: 16, w: 240, h: 150 });
    expect(L.wipe).toEqual({ x: 0, y: 16, w: 240, h: 220 });
    // UI-46 履歴の画面: 全滅の内訳と同じ 240×220（y16..235）。題 12、一覧 240×208
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
      expect(inside(d.header.log, g.header), tag).toBe(true);
      expect(d.header.settings.h, tag).toBe(l.header);
      // 操作領域: 原点からの相対は既定と同じ
      for (const k of Object.keys(L.dpad) as Array<keyof typeof L.dpad>) expect(rel(d.dpad[k], g.controls), tag).toEqual(rel(L.dpad[k], base.controls));
      d.menu.forEach((r, i) => expect(rel(r, g.controls), tag).toEqual(rel(L.menu[i]!, base.controls)));
      d.list.forEach((r, i) => expect(rel(r, g.controls), tag).toEqual(rel(L.list[i]!, base.controls)));
      d.listNarrow.forEach((r, i) => expect(rel(r, g.controls), tag).toEqual(rel(L.listNarrow[i]!, base.controls)));
      expect(rel(d.listBack, g.controls), tag).toEqual(rel(L.listBack, base.controls));
      expect(rel(d.mapClose, g.controls), tag).toEqual(rel(L.mapClose, base.controls));
      expect(rel(d.mapGo, g.controls), tag).toEqual(rel(L.mapGo, base.controls));
      expect(rel(d.mapLegend, g.controls), tag).toEqual(rel(L.mapLegend, base.controls));
      d.battleParty.forEach((r, i) => expect(rel(r, g.controls), tag).toEqual(rel(L.battleParty[i]!, base.controls)));
      d.battleMember.forEach((r, i) => expect(rel(r, g.controls), tag).toEqual(rel(L.battleMember[i]!, base.controls)));
      expect(rel(d.autoStop, g.controls), tag).toEqual(rel(L.autoStop, base.controls));
      const fits = l.controls >= CONTROLS_MIN_HEIGHT;
      for (const r of [...Object.values(d.dpad), ...d.menu, ...d.list, d.mapClose, d.mapGo, d.mapLegend, ...d.battleParty, ...d.battleMember, d.autoStop])
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
      // 地図（M19）: ビューの上端からパーティ欄の下端（操作領域の上端）まで。題・注記の行・本体の順に隙間なく並ぶ
      expect(d.map.overlay, tag).toEqual({ x: 0, y: g.view.y, w: W, h: l.view + l.message + l.party });
      expect(d.map.area.y + d.map.area.h, tag).toBe(g.controls.y);
      expect(inside(d.map.area, d.map.overlay) && inside(d.map.title, d.map.overlay) && inside(d.map.note, d.map.overlay), tag).toBe(true);
      expect([d.map.note.y, d.map.area.y], tag).toEqual([d.map.title.y + d.map.title.h, d.map.note.y + d.map.note.h]);
      // 全滅の内訳（UI-56）はビューとメッセージを合わせた範囲、キャンプ（UI-53）はビュー領域
      expect(d.wipe, tag).toEqual({ x: 0, y: g.view.y, w: W, h: l.view + l.message });
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
        "ui.layout: campGrid[4] does not fit in the controls region (height 86)",
        "ui.layout: campGrid[5] does not fit in the controls region (height 86)",
        "ui.layout: campGrid[6] does not fit in the controls region (height 86)",
        "ui.layout: campGrid[7] does not fit in the controls region (height 86)",
      ]);
    }
  });

  // M8.5: M7 の広げた一覧（listTall）は UI-13 の街の配置（townLayout）に置き換えた
  test("UI-13（M8.5）/ UI-82（M23）townLayout: ヘッダー（文字 x4..151・「？」x156..183・ログ x184..211・設定 x212..239）、絵 240×150、会話の箱、帯 6 セル、見出し、一覧 9 行×22・幅 168、戻る x178 y354。重ならずステージに収まる", () => {
    expect(T.header).toEqual({
      text: { x: 4, y: 0, w: 148, h: 16 },
      help: { x: 156, y: 0, w: 28, h: 16 },
      log: { x: 184, y: 0, w: 28, h: 16 },
      settings: { x: 212, y: 0, w: 28, h: 16 },
    });
    expect(T.picture).toEqual({ x: 0, y: 16, w: 240, h: 150 });
    // UI-47（M10.5）会話の箱: 絵の下端からステージの下端まで（枠 x0..239・y166..399、文字 x5..228・y169..388 の 22 行 × 56 単位、▼ x221..228・y381..388）。
    // 以前の期待値は絵の下端に重なる 3 行（枠 x2..237・y128..163）で、迷宮のキャラクター画面の talkCompact に残した
    expect(T.talk).toEqual({
      box: { x: 0, y: 166, w: 240, h: 234 },
      text: { x: 5, y: 169, w: 224, h: 220 },
      lines: 22,
      cols: 56,
      more: { x: 221, y: 381, w: 8, h: 8 },
    });
    expect(T.talkCompact).toEqual({
      box: { x: 2, y: 128, w: 236, h: 36 },
      text: { x: 7, y: 131, w: 220, h: 30 },
      lines: 3,
      cols: 55,
      more: { x: 219, y: 153, w: 8, h: 8 },
    });
    expect(inside(T.talk.box, STAGE)).toBe(true);
    expect(overlaps(T.talk.box, T.picture)).toBe(false);
    expect(overlaps(T.talk.box, T.header.text)).toBe(false);
    expect(inside(T.talk.text, T.talk.box)).toBe(true);
    expect(inside(T.talk.more, T.talk.text)).toBe(true);
    // 帯・見出し・一覧・施設メニュー・戻るは、会話の箱の下に入る（被せる）
    for (const r of [T.band.row, T.heading, T.list.area, ...T.grid, ...T.notes, T.back]) expect(inside(r, T.talk.box), JSON.stringify(r)).toBe(true);
    expect(inside(T.talkCompact.box, T.picture)).toBe(true);
    // UI-40（M10.5）街の判定の箱の下端はビューの y148（ステージ y164。会話の箱の上 2 = 絵の下端の 2 上）。迷宮のキャラクター画面は y110
    expect(T.diceBottom).toBe(148);
    expect(T.diceBottomCompact).toBe(110);
    expect(T.band.row).toEqual({ x: 0, y: 166, w: 240, h: 10 });
    expect(T.band.cells).toEqual([0, 1, 2, 3, 4, 5].map((i) => ({ x: 40 * i, y: 166, w: 40, h: 10 })));
    expect(T.band.hits).toEqual([0, 1, 2, 3, 4, 5].map((i) => ({ x: 40 * i, y: 166, w: 40, h: 22 })));
    expect(T.heading).toEqual({ x: 8, y: 178, w: 224, h: 10 });
    expect(T.list.area).toEqual({ x: 8, y: 190, w: 168, h: 198 });
    expect(T.list.rows).toEqual(Array.from({ length: 9 }, (_, i) => ({ x: 8, y: 190 + 22 * i, w: 168, h: 22 })));
    expect(T.back).toEqual({ x: 178, y: 354, w: 56, h: 40 });
    expect(T.back).toEqual(L.listBack);
    expect(T.decide).toEqual(L.listDecide); // M24 C-2
    expect(overlaps(T.decide, T.back) || overlaps(T.decide, T.list.area)).toBe(false);
    // 2026-10-07（B-B-4）: 図鑑の範囲は townLayout の book を消し、layout.character（キャラクター画面と同じ）に寄せた
    expect(L.character).toEqual({ x: 0, y: 16, w: 240, h: 284 });
    // 押せないもの（文字・絵・見出し・一覧の欄）と押せるもの（ログ・設定・帯・戻る）の重なり
    const parts: [string, Rect][] = [
      ["header.text", T.header.text],
      ["header.log", T.header.log],
      ["header.settings", T.header.settings],
      ["picture", T.picture],
      ["band", T.band.row],
      ["list", T.list.area],
      ["back", T.back],
    ];
    for (const [n, r] of parts) expect(inside(r, STAGE), n).toBe(true);
    for (let i = 0; i < parts.length; i++)
      for (let j = i + 1; j < parts.length; j++) expect(overlaps(parts[i]![1], parts[j]![1]), `${parts[i]![0]} / ${parts[j]![0]}`).toBe(false);
    expect(overlaps(T.heading, T.band.row)).toBe(false);
    expect(overlaps(T.heading, T.list.area)).toBe(false);
    for (const r of T.list.rows) expect(inside(r, T.list.area)).toBe(true);
    // 行は UI-10 の 12 論理 px 以上（TOUCH_MIN_LOGICAL の例外 town.list）
    expect(Math.min(...T.list.rows.map((r) => r.h))).toBeGreaterThanOrEqual(12);
  });

  test("UI-11/UI-13/UI-10（M16）迷宮・戦闘の広い一覧 listWide: パーティ欄の上端 + 2 から操作領域の下端まで（x8..231・y238..391）に 22px × 7 行。幅は list と同じ 224（固定の戻るは listBack のまま、行を 168 にすると重ならない）。線画・メッセージ窓と重ならない", () => {
    const g = regions(data.config.ui.layout, W);
    expect(LIST_WIDE_ROW_H).toBe(22);
    expect(L.listWide.area).toEqual({ x: 8, y: 238, w: 224, h: 154 });
    expect(L.listWide.rows).toHaveLength(7);
    expect(L.listWide.rows).toEqual(Array.from({ length: 7 }, (_, i) => ({ x: 8, y: 238 + 22 * i, w: 224, h: 22 })));
    for (const r of L.listWide.rows) expect(inside(r, L.listWide.area)).toBe(true);
    // パーティ欄と操作領域を合わせた範囲に収まり、ビュー（線画・敵の絵）とメッセージ窓（呪文の説明 UI-68）には掛からない
    expect(L.listWide.area.y).toBeGreaterThanOrEqual(g.party.y);
    expect(L.listWide.area.y + L.listWide.area.h).toBeLessThanOrEqual(g.controls.y + g.controls.h);
    expect(overlaps(L.listWide.area, g.view)).toBe(false);
    expect(overlaps(L.listWide.area, g.message)).toBe(false);
    // 幅 168（固定の戻るがある一覧）の欄は固定の戻る（x178..233・y354..393）と重ならない。幅 224 は戻るの無い一覧だけ
    expect(overlaps({ ...L.listWide.area, w: L.listNarrow[0]!.w }, L.listBack)).toBe(false);
    expect(L.listWide.area.x).toBe(L.list[0]!.x);
    expect(L.listWide.area.w).toBe(L.list[0]!.w);
    // UI-10: 行は 12 論理 px 以上（TOUCH_MIN_LOGICAL を満たさない例外 listWide。街の一覧 town.list と同じ 22）
    expect(isTouchException("listWide[0]")).toBe(true);
    expect(Math.min(...L.listWide.rows.map((r) => r.h))).toBeGreaterThanOrEqual(12);
    expect(LIST_WIDE_ROW_H).toBe(TOWN_ROW_H);
    // 既定の layout では警告なし
    expect(layoutWarnings(g, L)).toEqual([]);
  });

  // 2026-10-07 未定-25: 全滅の内訳の間は、広い箱（y166..399）が内訳の下からはみ出して「街へ」を覆い、タッチで抜けられなかった
  test("UI-47/UI-56（M10.5 追補 2・未定-25）全滅の内訳の間の会話の箱 talkWipe は内訳の下・「街へ」の上（枠 x2..237・y238..273 の 3 行）。内訳・「街へ」と重ならない", () => {
    expect(T.talkWipe).toEqual({
      box: { x: 2, y: 238, w: 236, h: 36 },
      text: { x: 7, y: 241, w: 220, h: 30 },
      lines: 3,
      cols: 55,
      more: { x: 219, y: 263, w: 8, h: 8 },
    });
    expect(inside(T.talkWipe.box, STAGE)).toBe(true);
    expect(overlaps(T.talkWipe.box, L.wipe)).toBe(false);
    // 内訳の間の操作の欄は「街へ」（setMode("close")。地図の閉じると同じ矩形 x60..179・y334..365）だけ
    expect(L.mapClose).toEqual({ x: 60, y: 334, w: 120, h: 32 });
    expect(overlaps(T.talkWipe.box, L.mapClose)).toBe(false);
    expect(T.talkWipe.box.y + T.talkWipe.box.h).toBeLessThanOrEqual(L.mapClose.y);
  });

  // M10.5: 会話の箱を施設メニューに被せるようにしたので、重ならない相手から会話の箱を外した（被さることは townLayout の試験で確かめる）
  test("UI-13/UI-52（M10。M17）townLayout の grid: 施設メニューの 40×40 を 3 列 × 3 段（x54/100/146・y190/236/282、間 6）でステージの中央寄せ。一覧の行の y 範囲（y190..387）に収まり、見出し・帯・絵と重ならない", () => {
    expect(T.grid).toEqual([190, 236, 282].flatMap((y) => [54, 100, 146].map((x) => ({ x, y, w: 40, h: 40 }))));
    const left = Math.min(...T.grid.map((r) => r.x));
    const right = Math.max(...T.grid.map((r) => r.x + r.w));
    expect(left).toBe(W - right);
    const rows: Rect = { x: T.heading.x, y: T.list.area.y, w: T.heading.w, h: T.list.area.h };
    for (const r of T.grid) {
      expect(r.w).toBe(r.h);
      expect(inside(r, rows), JSON.stringify(r)).toBe(true);
      for (const o of [T.heading, T.band.row, ...T.band.hits, T.picture, T.header.text]) expect(overlaps(r, o), JSON.stringify([r, o])).toBe(false);
    }
  });

  test("UI-13/UI-52/UI-10（M16。M17）townLayout の notes: 施設メニューの下の説明の 7 行を x8..231・y328..397（1 行 10）。グリッド・見出し・帯・絵と重ならず、ステージに収まる（押せない文字の行なので UI-10 の対象外）", () => {
    expect(TOWN_NOTE_LINES).toBe(7);
    expect(TOWN_NOTE_LINE_H).toBe(10);
    expect(T.notes).toEqual(Array.from({ length: 7 }, (_, i) => ({ x: 8, y: 328 + 10 * i, w: 224, h: 10 })));
    for (const r of T.notes) {
      expect(inside(r, STAGE), JSON.stringify(r)).toBe(true);
      for (const o of [...T.grid, T.heading, T.band.row, ...T.band.hits, T.picture, T.header.text]) expect(overlaps(r, o), JSON.stringify([r, o])).toBe(false);
    }
  });

  test("ui §2 パーティ欄がちょうど party.size × 10 なら上の余白を詰める。メッセージに 1 行も入らなければ warn", () => {
    const g = regions({ header: 16, view: 150, message: 74, party: 60, controls: 100 }, W);
    expect(dungeonLayout(g, N).partyRows[0]).toEqual({ x: 0, y: g.party.y, w: W, h: 10 });
    const g2 = regions({ header: 16, view: 150, message: 13, party: 64, controls: 157 }, W);
    // M10（UI-59）: キャラクター画面（ビューの上端から操作領域の上端まで = 227）にも 27 行（274）が入らないので、その警告も出る
    expect(layoutWarnings(g2, dungeonLayout(g2, N))).toEqual([
      "ui.layout: character panel (height 227) is lower than 274",
      "ui.layout: message region (height 13) has no text line",
    ]);
  });

  test("UI-80 / UI-10（M20）キャラクター画面の品の行（character.item）は UI-10 の例外で高さ 12（12 論理 px 以上）。装備 6 行と所持品 8 枠を埋めても layout.character の内側で、◀ ▶・操作の枠に重ならない", () => {
    expect(isTouchException("character.item")).toBe(true);
    expect(isTouchException("character.item[13]")).toBe(true);
    const full = {
      equipment: Array.from({ length: 6 }, (_, i) => ({ slot: "", item: "", instanceId: `e${i}` })),
      inventory: Array.from({ length: 8 }, (_, i) => ({ text: "", dim: false, instanceId: `i${i}` })),
    } as unknown as CharacterDetail;
    const rects = characterHitRects(full, L.character.w);
    expect(rects).toHaveLength(14);
    for (const r of rects) {
      const st: Rect = { x: L.character.x + r.x, y: L.character.y + r.y, w: r.w, h: r.h };
      expect(Math.min(st.w, st.h)).toBeGreaterThanOrEqual(12);
      expect(inside(st, L.character), JSON.stringify(st)).toBe(true);
      for (const o of [L.header.prev, L.header.next, ...L.campGrid]) expect(overlaps(st, o), `${JSON.stringify(st)} ${JSON.stringify(o)}`).toBe(false);
    }
  });

  test("UI-59 / UI-10（M16 追補 H-2）キャラクター画面の ◀ ▶ の押せる矩形は 24×32（y0..31）で、見た目の枠はヘッダーの帯の 24×16。y16..31 は押せない名前の行だけ", () => {
    const g = regions(data.config.ui.layout, W);
    for (const k of ["prev", "next"] as const) {
      const hit = L.header[k];
      const mark = L.header[k === "prev" ? "prevMark" : "nextMark"];
      expect([hit.w, hit.h], k).toEqual([24, 32]);
      expect(hit.y, k).toBe(0);
      expect(inside(hit, STAGE), k).toBe(true);
      // 見た目の枠は押せる矩形の上 16（x と幅は同じ）で、ヘッダーの帯の中
      expect(mark, k).toEqual({ x: hit.x, y: hit.y, w: 24, h: g.header.h });
      expect(inside(mark, hit) && inside(mark, g.header), k).toBe(true);
      // はみ出した下 16 はキャラクター画面のパネル（layout.character）の上端の行（行 0 の名前。押せない文字）で、操作の枠・会話の 3 行の箱に重ならない
      const below: Rect = { x: hit.x, y: g.header.y + g.header.h, w: hit.w, h: hit.h - g.header.h };
      expect(inside(below, L.character), k).toBe(true);
      for (const r of [...L.campGrid, ...L.list, L.listBack, T.talkCompact.box]) expect(overlaps(hit, r), `${k} ${JSON.stringify(r)}`).toBe(false);
      // ヘッダーの文字（問い）・ログ・設定にも重ならない
      for (const r of [L.header.navText, L.header.log, L.header.settings]) expect(overlaps(hit, r), `${k} ${JSON.stringify(r)}`).toBe(false);
    }
    expect(overlaps(L.header.prev, L.header.next)).toBe(false);
    // ヘッダーとキャラクター画面に収まらなければ layoutWarnings（押せる矩形は header の領域ではなく、操作領域の上端までで見る）
    expect(layoutWarnings(g, L)).toEqual([]);
    expect(layoutWarnings(g, { ...L, header: { ...L.header, next: { ...L.header.next, y: 280 } } })).toEqual([
      "ui.layout: header.next does not fit in the header and character regions",
    ]);
  });

  test("UI-82（M23）ヘッダーの「？」header.help: ログの左の 28×16（x156..183）。ログ・設定も 28 に詰め、文字・ターン表示・◀ ▶ と重ならない。UI-10 の例外で、はみ出せば layoutWarnings", () => {
    for (const lay of [data.config.ui.layout, { header: 20, view: 150, message: 66, party: 64, controls: 100 }]) {
      const g = regions(lay, W);
      for (const hd of [dungeonLayout(g, N).header, townLayout(g, N).header]) {
        expect([hd.help.w, hd.log.w, hd.settings.w]).toEqual([28, 28, 28]);
        expect(hd.help.h).toBe(g.header.h);
        // 右から 設定・ログ・「？」が隙間なく並び、文字領域は「？」の左（余白 4）まで
        expect(hd.settings.x + hd.settings.w).toBe(g.header.x + g.header.w);
        expect(hd.log.x + hd.log.w).toBe(hd.settings.x);
        expect(hd.help.x + hd.help.w).toBe(hd.log.x);
        expect(hd.text.x + hd.text.w + 4).toBe(hd.help.x);
        expect(overlaps(hd.help, hd.text)).toBe(false);
        expect(inside(hd.help, g.header)).toBe(true);
      }
      const d = dungeonLayout(g, N);
      expect(overlaps(d.header.help, d.header.turn)).toBe(false);
      expect(d.header.turn.x + d.header.turn.w).toBe(d.header.text.x + d.header.text.w);
      // ◀ ▶ の見た目と押せる矩形も「？」に重ならない（キャラクター画面の間は「？」を隠すが、位置でも分けておく）
      for (const r of [d.header.prev, d.header.next, d.header.prevMark, d.header.nextMark, d.header.navText]) expect(overlaps(r, d.header.help)).toBe(false);
      expect(d.header.nextMark.x + d.header.nextMark.w).toBe(d.header.help.x);
    }
    expect(L.header.help).toEqual({ x: 156, y: 0, w: 28, h: 16 });
    expect(isTouchException("header.help")).toBe(true);
    const g = regions(data.config.ui.layout, W);
    expect(layoutWarnings(g, { ...L, header: { ...L.header, help: { ...L.header.help, y: 4 } } })).toEqual([
      "ui.layout: header.help does not fit in the header region (height 16)",
    ]);
  });

  test("UI-82 / UI-54 / UI-13（M23）ヘッダーの文字の長さ: ターンの間の問いの最悪値（12 字）は 96px、街の見出し「闇魔術　999999 G」と迷宮の見出し（最長の名前 10F）は 148px に収まる", () => {
    // 美咲フォント: 全角 8px・半角 4px（金額の NBSP も半角）
    const px = (t: string): number => Array.from(t).reduce((a, c) => a + ((c.codePointAt(0) ?? 0) < 0x80 || c === " " ? 4 : 8), 0);
    const st = data.strings;
    const turnTextW = L.header.text.w - HEADER_TURN_W - HEADER_TURN_GAP;
    expect(turnTextW).toBe(96);
    for (const row of ["battle.row.front", "battle.row.back"]) {
      const q = formatMessage(st["battle.prompt.member"]!, { name: "アアアアアア", row: st[row]! });
      expect(q).toBe(`アアアアアア（${st[row]}）は？`);
      expect(px(q), q).toBeLessThanOrEqual(turnTextW);
    }
    expect(px(formatMessage(st["battle.prompt.member"]!, { name: "アアアアアア", row: st["battle.row.front"]! }))).toBe(96);
    expect(px(formatMessage(st["battle.prompt.party"]!, {}))).toBeLessThanOrEqual(turnTextW);
    // 街: 施設の名前の最長（迷宮の入口・闇魔術ほか）と 6 桁の所持金
    for (const k of Object.keys(st).filter((k) => k.startsWith("town.place."))) {
      const h = formatMessage(st["town.header"]!, { place: st[k]!, gold: 999999 });
      expect(px(h), h).toBeLessThanOrEqual(T.header.text.w);
    }
    expect(formatMessage(st["town.header"]!, { place: st["town.place.dark"]!, gold: 999999 }).replace(/ /g, " ")).toBe("闇魔術　999999 G");
    expect(T.header.text.w).toBe(148);
    // 迷宮: どの迷宮の名前でも 10F・どの向きでも
    for (const dg of data.dungeons)
      for (const f of ["N", "E", "S", "W"] as const) {
        const h = headerText(st, dg.name, 10, f);
        expect(px(h), h).toBeLessThanOrEqual(L.header.text.w);
      }
    expect(headerText(st, "灰の地下墓所", 10, "N")).toBe("灰の地下墓所 10F 北");
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
