// 画面遷移の親。state を持ち、入力を Command にして execute へ送り（UI-35）、返ったイベントを playback で再生する。
// - 判定・計算・分岐（前進できるか、入場できるか、名前が正しいか）は core が行う。ここは結果を描くだけ（§3-4）。
// - 入力はステージ 1 か所（input/tap.ts の attachStageInput）で受ける。押せるものは onTap で登録し、動かずに離したときだけ反応する（UI-36）。
// - 再生中（busy）の入力はすべて捨てる。ステージのどこかのタップ（オート解除を除く）と Enter / Space だけは受け、player.tap() に渡す
//   （拍のタップ待ちを解く・拍の残りを即時にする・拍の外は 1 回目で今の文、2 回目で残りを即表示。UI-44 / UI-45 / UI-43）。
// - 再生の外のメッセージ窓のタップは、文字送り中なら即表示、それ以外なら履歴の画面（UI-46）を開く。
// - 迷宮のキャンプと酒場の状態・装備・並び順（UI-53 / UI-59 / TW-03）は views/camp.ts の段で進め、ビュー領域だけを覆う（overlay 'camp'）。
// - 地図のセルのタップ（UI-25）は core の planRoute で経路を探し、holdRepeatMs おきに 1 手ずつ送る（自動歩行）。続けるかは core の
//   routeStepOk が決める。歩いている間に触れる・キーを押すと止まり、その入力は捨てる。
// - 状態を変えるコマンドの後、再生を始める前にオートセーブを await する（§3-8。SV-02: 再生中にリロードされても結果は確定している）。
//   保存の失敗は SV-23 の帯とメッセージ窓で知らせ、state は巻き戻さない。
// - タイトル（UI-50）は保存先の一覧を読み、続きから（SV-50）は読み込んだ state を resume で直接描く。
// - 画面の切り替えは各画面のルート要素の表示と非表示だけで行う。迷宮の DOM は 1 回だけ作る。
// モジュールのトップレベルでは DOM に触れない。
import type { GameData } from "../core/data/index";
import { execute, createInitialState } from "../core/engine";
import { battleMenu } from "../core/rules/combat";
import { mapView, visibleCells } from "../core/rules/dungeon";
import { campMenu, campSummary } from "../core/rules/camp";
import { planRoute, routeStepOk } from "../core/rules/pathfind";
import { fieldItemMenu } from "../core/rules/items";
import { townMenu } from "../core/rules/town";
import { dungeonOf, itemDisplayName } from "../core/state";
import type { BattleMenu, Command, GameState, PenaltyResult, Pos, Screen, ViewPoint } from "../core/types";
import type { GameListEntry, SaveService } from "../save/types";
import { closesInput, runChain, type ChainDeps } from "./auto-chain";
import { createAutosaver, createCommandExec, createSaveBannerState, type CommandExecOptions, type CommandResult, type SaveStatus } from "./autosave";
import {
  entries,
  firstCursor,
  focusedChoice,
  focusedGroup,
  moveFocus,
  nextCursor,
  setFocus,
  step,
  type Choice,
  type InputCursor,
} from "./battle-input";
import {
  attachKeyboard,
  attachReleaseOnHide,
  battleKeyChoice,
  createHoldRepeater,
  forwardStep,
  walkStep,
  type RouteWalk,
  type Action,
} from "./input/swipe";
import { attachStageInput, onTap } from "./input/tap";
import { dungeonLayout, layoutWarnings, regions, saveBannerRect } from "./layout";
import { createPlayer } from "./playback";
import { resumePlan } from "./resume";
import { createRunGate } from "./run-gate";
import { defaultSettings, type SettingsStore } from "./settings";
import type { StageLayout, StageLayoutInput } from "./stage";
import type { ControlItem, DpadAction } from "./views/controls";
import { createCreationScreen } from "./views/creation";
import { createDebugPanel } from "./views/debug-panel";
import {
  campEntries,
  campFirstPage,
  campHeader,
  campKeyIndex,
  campPanel,
  campRepair,
  campStep,
  type CampChoice,
  type CampEntry,
  type CampHost,
  type CampInput,
  type CampPage,
  type CampPanelView,
} from "./views/camp";
import { formatDetail, SLOT_ORDER } from "./views/detail";
import { createDungeonScreen } from "./views/dungeon";
import { slotsFor } from "./views/dungeon-geometry";
import { headerText } from "./views/header";
import { formatMessage } from "./views/message";
import { createSaveBanner } from "./views/save-banner";
import { createTitleScreen, titleEntries, titleItems, titleKeyIndex, titleNotice, titleStep, type TitlePage } from "./views/title";
import { formatWipeSummary } from "./views/wipe";
import { townEntries, townHeader, townPageIntro, townParent, type TownEntry, type TownPage } from "./views/town";

export type Route = "title" | "creation" | "town" | "dungeon" | "battle";
export type Overlay = null | "map" | "debug" | "camp" | "wipe" | "history";

export type App = {
  onLayout(layout: StageLayout, input: StageLayoutInput): void;
  start(): void;
};

/**
 * UI-31: 十字ボタンを出さない間（迷宮以外・地図などの overlay・選択の保留）は長押しを離したものとするか。
 * 押したまま十字ボタンが隠れると pointerup が届かず、壁で止まった長押しの続き（createHoldRepeater の stopped）が
 * 残って次の前進を無視してしまうため。
 */
export function shouldReleaseHold(route: Route, overlay: Overlay, hasPendingChoice: boolean): boolean {
  return route !== "dungeon" || overlay !== null || hasPendingChoice;
}

/** UI-46: 履歴の画面のキーの ↑↓ で動かす行数 */
const HISTORY_KEY_LINES = 3;

/** SV-50: 続きからの読み込みの失敗理由ごとの文言（決定記録の load の 4 つの理由） */
const LOAD_FAILED: Readonly<Record<"unavailable" | "missing" | "tooNew" | "broken", string>> = {
  unavailable: "title.loadUnavailable",
  missing: "title.loadMissing",
  tooNew: "title.loadTooNew",
  broken: "title.loadBroken",
};

type DispatchResult = CommandResult;

export function createApp(o: { stage: HTMLElement; data: GameData; settings: SettingsStore; saves: SaveService; seed?: number }): App {
  const { data, stage } = o;
  const strings = data.strings;
  const store = o.settings;
  const t = (k: string): string => strings[k] ?? k;

  const seed = o.seed ?? crypto.getRandomValues(new Uint32Array(1))[0] ?? 1;
  let state: GameState = createInitialState(seed, data);
  let route: Route = "title";
  let overlay: Overlay = null;
  let layout: StageLayout | null = null;
  let townPage: TownPage = "menu";
  /** 再生中か（UI-44）。run の門が持つ */
  const isBusy = (): boolean => gate.busy();
  /** UI-54: 戦闘の入力の段階（手動で入力待ちのメンバーがいるときだけ非 null） */
  let cursor: InputCursor | null = null;
  /** 受け付けを待っている battle.input のメンバー。次の sync で nextCursor の起点にする */
  let advanceFrom: string | null = null;
  /** UI-44 の例外: オート中の「オート解除」の予約。連鎖の次の段で battle.auto off を送る */
  let stopRequested = false;
  /** オートの連鎖（runChain）の途中か。段の間（1 フレーム譲る間）は門が空くので別に持つ */
  let chaining = false;
  /** debug パネルの下に残している overlay（全滅の内訳だけ。閉じたら戻す） */
  let underDebug: Overlay = null;
  /** UI-53 / TW-03: キャンプを開いた場所（迷宮のキャンプか酒場か）と今の段（overlay が camp の間だけ使う） */
  let campHost: CampHost = "camp";
  let campPage: CampPage = { kind: "top" };
  /** UI-25: 地図のタップ移動の自動歩行（歩いている間だけ非 null。SV-50 の再開では戻さない） */
  let walking: RouteWalk | null = null;

  const scale = (): number => layout?.scale ?? 1;

  // ---------------------------------------------------------------- 画面
  const title = createTitleScreen({ strings, onSelect: (i) => guard(() => selectTitle(i)) });
  /** UI-50: タイトルのページ */
  let titlePage: TitlePage = { kind: "list" };
  /** 保存先の一覧。読み終えるまで null（行を出さない） */
  let titleList: GameListEntry[] | null = null;
  /** 案内の欄の上書き（上限・読み込みの失敗・削除の結果）。null ならページの既定の文 */
  let titleMessage: string | null = null;
  /** 保存先の読み書きを待っている間（二重の操作を捨てる） */
  let titleBusy = false;
  /** 古い一覧の読み込みの結果を捨てるための番号 */
  let titleSeq = 0;

  const creation = createCreationScreen({
    data,
    strings,
    onStart: (setup) =>
      guard(() => {
        blurActive();
        creation.showError(false);
        void run({ type: "game.new", party: setup }).then((r) => {
          if (r !== null && r.rejected) creation.showError(true);
        });
      }),
    onBack: () => guard(() => showRoute("title")),
  });

  // ui §2 の区切りは【仮】。操作領域などに中身が収まらない layout は起動を止めず、console.warn で知らせる
  const playRegions = regions(data.config.ui.layout, data.config.stage.width);
  const playLayout = dungeonLayout(playRegions, data.config.party.size);
  for (const w of layoutWarnings(playRegions, playLayout)) console.warn(w);

  const play = createDungeonScreen({
    data,
    strings,
    regions: playRegions,
    layout: playLayout,
    textSpeed: () => store.get().textSpeed,
    historyMax: data.config.ui.messageHistory,
    onSettings: () => guard(() => openDebug()),
    onAction: (a: DpadAction) => tapDpad(a),
    // UI-31: 前進ボタンを動かずに holdRepeatMs 押し続けたら連打を始め、離したら止める
    hold: {
      ms: () => store.get().holdRepeatMs,
      onHoldStart: () => handleAction("forward"),
      onHoldEnd: () => repeater.release(),
    },
    onClose: () => guard(() => closeOverlay()),
    onPick: (g) => guard(() => chooseBattle({ kind: "group", index: g })),
    onMapCell: (p) => guard(() => tapMapCell(p)),
  });

  const debug = createDebugPanel({
    strings,
    store,
    defaults: defaultSettings(data.config),
    onClose: () => closeDebug(),
    onHpOne: () => guard(() => hpOneFromDebug()),
  });

  // SV-23: 保存できないことを知らせる帯（最前面。押せない）
  const banner = createSaveBanner({ strings, rect: saveBannerRect(playRegions, data.config.ui.saveBannerHeight) });
  const bannerState = createSaveBannerState(o.saves.available);
  banner.setVisible(bannerState.visible());

  stage.replaceChildren(title.el, creation.el, play.el, debug.el, banner.el);

  // ---------------------------------------------------------------- 再生
  const dungeonName = (st: GameState): string => (st.dive === null ? "" : dungeonOf(data, st.dive.dungeonId).name);

  const showHeaderAt = (st: GameState, at: ViewPoint): void => {
    if (st.dive === null) return;
    play.header.setText(headerText(strings, dungeonName(st), at.floor, at.facing));
  };

  const player = createPlayer({
    data,
    strings,
    settings: () => store.get(),
    view: {
      fade: (ms, apply) => play.view.fade(ms, apply),
      showAt: (st, at) => play.view.show(slotsFor(visibleCells(st, data, at))),
      shake: (ms) => play.shake(ms),
    },
    header: { showAt: showHeaderAt },
    message: play.message,
    party: play.party,
    battle: play.battle,
    dice: play.dice,
    screens: {
      show: (to: Screen) => onScreen(to),
      sync: (st) => sync(st),
    },
    wipe: { show: (p) => openWipe(p) },
    battleEnded: () => onBattleEnded(),
    inputClosed: () => lowerInput(),
  });

  /**
   * UI-44: コマンドを送ってから再生が終わるまでは、そのコマンドで閉じた入力の UI を出さない。
   * ヘッダーを空にし、操作領域のボタン・入力中の名前・注目の枠を下げる。cursor は変えない
   * （rejected なら runBattle の後の描き直しで戻り、受け付けられたら再生の最後の sync で作り直す）
   */
  const lowerInput = (): void => {
    play.party.setActive(null);
    clearFocus();
    play.header.setText("");
    play.controls.setMode("none");
  };

  /**
   * UI-44 / UI-54: battleEnd の再生の後は、戦闘の入力の UI（ヘッダーの問い・オート解除・パーティの選択）を下げる。
   * 続きの再生（全滅の内訳を開く前の待ち、勝利・逃走の screen dungeon まで）では出さない。ヘッダーは空にする
   * （戦闘の外への screen と再生の最後の sync で、場面のヘッダーに描き直す）
   */
  const onBattleEnded = (): void => {
    cursor = null;
    stopRequested = false;
    lowerInput();
  };

  /** core の screen イベント。M3 の画面は title / town / dungeon / battle */
  const onScreen = (to: Screen): void => {
    if (to === "title" || to === "town" || to === "dungeon" || to === "battle") {
      if (to === "town") townPage = "menu";
      // 画面が変わったら、キャンプ・地図・履歴を閉じる（帰還の呪文で街へ、など）
      if (route !== to) {
        if (overlay === "camp") closeCamp(false);
        if (overlay === "map") closeMap();
        if (overlay === "history") closeHistory();
      }
      if (to === "battle") {
        // 新しい戦闘。入力の段階は再生の最後の sync で battleMenu から作り直す
        cursor = null;
        advanceFrom = null;
        stopRequested = false;
      }
      showRoute(to);
      // 操作は再生の最後の sync で出し直す
      if (to !== "title") play.controls.setMode("none");
    }
  };

  /** state を描く（再生の最後に 1 回） */
  const sync = (st: GameState): void => {
    if (route !== "town" && route !== "dungeon" && route !== "battle") return;
    play.party.render(st.party);
    if (route === "battle") {
      play.setMode("battle");
      const menu = battleMenu(st, data);
      if (menu !== null) {
        play.battle.setGroups(menu.groups);
        // 受け付けた直後は並び順で次の入力待ちへ、それ以外（新しいラウンド・オートの段）は先頭の入力待ちから
        cursor = advanceFrom !== null ? nextCursor(menu, advanceFrom) : firstCursor(menu);
      } else {
        cursor = null;
      }
      advanceFrom = null;
      syncControls();
      return;
    }
    play.party.setActive(null);
    clearFocus();
    if (route === "town") {
      play.setMode("town");
      // UI-52: ヘッダーに所持金（再生中は前の額のまま。ここで最終の額に描き直す）
      const menu = townMenu(st, data);
      if (menu !== null) play.header.setText(townHeader(menu, strings));
    } else {
      play.setMode("dungeon");
      const d = st.dive;
      if (d !== null) {
        showHeaderAt(st, { floor: d.floor, pos: d.pos, facing: d.facing });
        play.view.show(slotsFor(visibleCells(st, data)));
      }
    }
    syncControls();
  };

  const listItem = (label: string, onSelect: () => void): ControlItem => ({ label, onSelect: () => guard(onSelect) });

  /** UI-52: 街のページを移る。入ったページの語り（宿・寺院・闇魔術・迷宮の入口、酒場は救済の申し出も）は再生の外で出す */
  const goTownPage = (page: TownPage): void => {
    townPage = page;
    syncControls();
    const menu = townMenu(state, data);
    if (menu === null) return;
    // 続けて出す文は、最後の 1 文だけを文字送りにする（say は送り途中の前の文を完了させるため、前の文は即時で出す）
    const keys = townPageIntro(page, menu);
    const skip = store.get().skipAnimations;
    keys.forEach((k, i) => void play.message.say(t(k), skip || i < keys.length - 1));
  };

  /** Esc・戻る: 1 つ上のページへ（menu では何もしない） */
  const townBack = (): void => {
    const up = townParent(townPage);
    if (up === null) return;
    townPage = up;
    syncControls();
  };

  /** 街の項目 → ページの移動か Command（料金・可否は core が決める。UI-35） */
  const townItem = (e: TownEntry): ControlItem => ({
    label: e.label,
    disabled: "disabled" in e ? e.disabled : false,
    onSelect: () =>
      guard(() => {
        switch (e.kind) {
          case "page":
            goTownPage(e.to);
            return;
          case "back":
            townBack();
            return;
          case "templeNone":
            void play.message.say(t("town.temple.none"), store.get().skipAnimations);
            return;
          case "inn":
            // 泊まった後も宿のページにとどまる（再生の最後の sync で townMenu を取り直す）
            void run({ type: "town.inn", rank: e.rank });
            return;
          case "temple":
            void run({ type: "town.temple", memberId: e.memberId, service: e.service });
            return;
          case "dark":
            // TW-08: 戻した後も闇魔術のページにとどまる（再生の最後の sync で townMenu を取り直す）
            void run({ type: "town.dark", memberId: e.memberId });
            return;
          case "mercy":
            void run({ type: "town.mercy", memberId: e.memberId });
            return;
          case "camp":
            // TW-03: 酒場の状態・装備・並び順はキャンプと同じ部品で開く（やめるで酒場の一覧へ戻る）
            openCamp("tavern", e.open);
            return;
          case "enter":
            void run({ type: "dungeon.enter", dungeonId: e.dungeonId });
            return;
          case "shopItem":
            goTownPage({ shop: e.itemId });
            return;
          case "buy":
            // TW-05: 買った後も持たせる者の一覧にとどまる（再生の最後の sync で townMenu を取り直す）
            void run({ type: "town.shop", action: { kind: "buy", memberId: e.memberId, itemId: e.itemId } });
            return;
        }
      }),
  });

  /** UI-30: ステージ全体でスワイプを受けるか（迷宮で、overlay も保留も無く、inputMode が buttons でなく、自動歩行中でない） */
  const swipeEnabled = (): boolean =>
    route === "dungeon" && overlay === null && state.pendingChoice === null && store.get().inputMode !== "buttons" && walking === null;

  /** 操作領域とスワイプの可否を、route / overlay / pendingChoice / inputMode から決める */
  const syncControls = (): void => {
    const s = store.get();
    play.setSwipeOn(swipeEnabled());
    const c = play.controls;
    // UI-31: 十字ボタンを出さない間は長押しを離したものとする（shouldReleaseHold）
    if (shouldReleaseHold(route, overlay, state.pendingChoice !== null)) repeater.release();
    if (overlay === "wipe") {
      // UI-56: 全滅の内訳の間は操作領域に「街へ」だけ（route の判定より先に見る）
      clearFocus();
      c.setCloseLabel(t("wipe.toTown"));
      c.setMode("close");
      return;
    }
    c.setCloseLabel(t("common.close"));
    if (overlay === "history") {
      // UI-46: 履歴の間は操作領域に「閉じる」だけ（街・迷宮・戦闘のどれでも）
      clearFocus();
      c.setMode("close");
      return;
    }
    if (overlay === "camp") {
      // UI-53 / TW-03: キャンプと酒場の状態・装備・並び順（街でも迷宮でも同じ）
      syncCampControls();
      return;
    }
    if (route === "town") {
      const menu = townMenu(state, data);
      if (menu === null) {
        c.setMode("none");
        return;
      }
      const items = townEntries(townPage, menu, strings).map(townItem);
      if (townPage === "menu") {
        // UI-52: 施設メニューは 3 列 × 2 段の 6 枠
        c.setBattleMenu(items, "town");
        c.setMode("battle");
      } else {
        c.setList(items);
        c.setMode("list");
      }
      return;
    }
    if (route === "battle") {
      syncBattleControls();
      return;
    }
    if (route !== "dungeon") return;
    if (overlay === "map") {
      c.setMode("close");
      return;
    }
    const pc = state.pendingChoice;
    if (pc !== null) {
      c.setList(pc.options.map((op) => listItem(t(op.labelKey), () => void run({ type: "event.choose", optionId: op.id }))));
      c.setMode("list");
      return;
    }
    // UI-53: [キャンプ][地図]
    c.setMenu([listItem(t("dungeon.menu.camp"), () => openCamp("camp")), listItem(t("dungeon.menu.map"), () => openMap())]);
    c.setDpadVisible(s.inputMode !== "swipe");
    c.setMode("dpad");
  };

  /** キャンプの値（campMenu と、迷宮なら fieldItemMenu・campSummary）。キャンプを開けない状態なら null */
  const campInput = (): CampInput | null => {
    const menu = campMenu(state, data);
    if (menu === null) return null;
    return { menu, items: fieldItemMenu(state, data), summary: campSummary(state, data) };
  };

  /**
   * UI-53 / UI-59: キャンプの段の問い（ヘッダー）・パネル・操作領域を描く。campMenu を取り直し、成り立たない段は campRepair で直す。
   * キャンプを開けない状態（戦闘・保留・title）になっていれば閉じる
   */
  const syncCampControls = (): void => {
    const m = campInput();
    if (m === null) {
      closeCamp(true);
      return;
    }
    campPage = campRepair(campHost, campPage, m);
    play.header.setText(campHeader(campPage, m, strings));
    play.camp.render(campPanelView(campPage, m));
    const c = play.controls;
    const e = campEntries(campHost, campPage, m, strings);
    const item = (x: CampEntry): ControlItem => ({ label: x.label, disabled: x.disabled, onSelect: () => guard(() => chooseCamp(x.choice)) });
    if (e.layout === "grid") {
      c.setBattleMenu(e.slots.map((x) => (x === null ? null : item(x))), "camp");
      c.setMode("battle");
    } else {
      c.setList(e.rows.map(item));
      c.setMode("list");
    }
  };

  /** campPanel の値を描くもの（UI-59 の状態は state の Character から formatDetail で作る） */
  const campPanelView = (page: CampPage, m: CampInput): CampPanelView => {
    const p = campPanel(page, m, strings);
    if (p.kind === "text") return p;
    if (p.kind === "order") {
      return {
        kind: "order",
        lines: p.rows.map((r) => ({ label: formatMessage(t("camp.order.row"), { n: r.n, name: r.name }), row: r.row, picked: r.picked })),
      };
    }
    const ch = state.party.find((x) => x.id === p.memberId);
    if (ch === undefined) return { kind: "text", title: "" };
    return {
      kind: "detail",
      detail: formatDetail(ch, data, strings, (iid) => itemDisplayName(state, data, iid)),
      focusSlot: p.focusSlot === null ? null : SLOT_ORDER.indexOf(p.focusSlot),
    };
  };

  /** UI-53: キャンプの段で 1 つ選ぶ。送るときは閉じずに after の段にしてから送る（使えるかは core が決める。UI-35） */
  const chooseCamp = (choice: CampChoice): void => {
    if (overlay !== "camp") return;
    const m = campInput();
    if (m === null) {
      closeCamp(true);
      return;
    }
    const r = campStep(campHost, campPage, m, choice);
    if (r.kind === "page") {
      campPage = r.page;
      syncControls();
      return;
    }
    if (r.kind === "close") {
      closeCamp(true);
      return;
    }
    campPage = r.after;
    void run(r.command).then((res) => {
      // rejected は再生も sync も無いので、ここで描き直す
      if (res !== null && res.rejected && !isBusy()) syncControls();
    });
  };

  /**
   * UI-54: 戦闘の header・操作領域・入力中の名前・対象の枠を、battleMenu と cursor から描く。
   * オート中は「オート解除」だけ（予約後は文言を変える）。手動は入力の段階の選択肢（party は 4 枠、member は 5 枠、
   * それ以外は一覧。enemy / ally の一覧は注目の行に枠を付け、触れた行に注目を移す）。
   */
  const syncBattleControls = (): void => {
    const c = play.controls;
    const menu = battleMenu(state, data);
    if (menu === null) {
      c.setMode("none");
      return;
    }
    if (menu.auto) {
      play.party.setActive(null);
      clearFocus();
      play.header.setText(t("battle.autoOn"));
      c.setAutoStop(t(stopRequested ? "battle.autoStopping" : "battle.cmd.autoStop"), () => requestAutoStop());
      c.setMode("autoStop");
      return;
    }
    const cur = cursor;
    if (cur === null) {
      // 入力待ちがいない（揃って resolve を待つ間など）
      play.party.setActive(null);
      clearFocus();
      c.setMode("none");
      return;
    }
    const memberId = cur.stage === "party" ? null : cur.memberId;
    const member = memberId === null ? undefined : menu.members.find((m) => m.id === memberId);
    play.header.setText(formatMessage(t(`battle.prompt.${cur.stage}`), { name: member?.name ?? "" }));
    play.party.setActive(memberId);
    const targeting = cur.stage === "enemy" || cur.stage === "ally";
    const items = entries(menu, cur, strings).map(
      (e, i): ControlItem => ({
        label: e.label,
        disabled: e.disabled,
        onSelect: () => guard(() => chooseBattle(e.choice)),
        ...(targeting ? { onFocus: () => guard(() => focusTo(i, false)) } : {}),
      }),
    );
    if (cur.stage === "party" || cur.stage === "member") {
      c.setBattleMenu(items, cur.stage);
      c.setMode("battle");
    } else {
      c.setList(items);
      c.setMode("list");
      c.setListFocus(targeting ? cur.focus : null);
    }
    paintFocus();
  };

  /**
   * UI-54: 注目している敵グループの絵に枠を付けて点滅させ（演出スキップでは枠だけ）、enemy の段の間だけ絵のタップを受ける。
   * 点滅は再生とは関係なく、sync のたびに作り直す
   */
  const paintFocus = (): void => {
    const menu = battleMenu(state, data);
    const cur = cursor;
    if (menu === null || cur === null) {
      clearFocus();
      return;
    }
    play.battle.focus(focusedGroup(menu, cur), !store.get().skipAnimations);
    play.battle.setPickable(cur.stage === "enemy");
  };

  const clearFocus = (): void => {
    play.battle.focus(null, false);
    play.battle.setPickable(false);
  };

  /**
   * UI-54: 対象の一覧の注目を i に移す（一覧は作り直さない。作り直すと click が消える）。
   * scroll はキーで動かしたときだけ真（ポインタで触れた行はタッチの途中で一覧を動かさない）。注目が変わらなければ何もしない
   */
  const focusTo = (i: number, scroll: boolean): void => {
    const menu = battleMenu(state, data);
    const cur = cursor;
    if (menu === null || cur === null) return;
    const next = setFocus(menu, cur, i);
    if (next === cur) return;
    if ((cur.stage === "enemy" || cur.stage === "ally") && next.stage === cur.stage && next.focus === cur.focus) return;
    cursor = next;
    if (next.stage === "enemy" || next.stage === "ally") play.controls.setListFocus(next.focus, { scroll });
    paintFocus();
  };

  const showRoute = (r: Route): void => {
    route = r;
    if (r === "title") enterTitle();
    title.el.style.display = r === "title" ? "" : "none";
    creation.el.style.display = r === "creation" ? "" : "none";
    play.el.style.display = r === "town" || r === "dungeon" || r === "battle" ? "" : "none";
    if (r === "town" || r === "dungeon" || r === "battle") play.setMode(r);
  };

  // ---------------------------------------------------------------- コマンド
  /**
   * UI-35 / UI-44: Command を execute に送り、イベントを再生する。再生中なら捨てて null。
   * rejected（イベントがちょうど 1 件の rejected）は再生せず、console.debug に出す。
   */
  const gate = createRunGate<Command, DispatchResult, CommandExecOptions>({
    onError: (e) => console.error(e),
    // SV-02: execute → state の差し替え → 保存を await → 再生（順は createCommandExec が固定する）
    exec: createCommandExec({
      execute: (st, cmd) => execute(st, cmd, data),
      getState: () => state,
      setState: (st) => {
        state = st;
      },
      autosaver: createAutosaver({ saves: o.saves, onStatus: (s) => onSaveStatus(s) }),
      play: (events, before, after) => player.play(events, before, after),
      onRejected: (ev) => console.debug("rejected", ev.command, ev.reason),
    }),
  });
  const run = (cmd: Command, opt?: CommandExecOptions): Promise<DispatchResult | null> => gate.run(cmd, opt);

  // ---------------------------------------------------------------- 戦闘
  /** 段の間で 1 フレーム譲る（1 回だけの requestAnimationFrame。常駐のループではない） */
  const nextFrame = (): Promise<void> =>
    new Promise((resolve) => {
      requestAnimationFrame(() => resolve());
    });

  const chainDeps: ChainDeps = {
    run: (cmd) => {
      // UI-44: 逃走・前回と同じ・手動のラウンドの解決は、送ったら再生の間は入力の UI（ヘッダーの問い・選択肢）を下げる
      if (closesInput(cmd, battleMenu(state, data))) lowerInput();
      return run(cmd);
    },
    menu: (): BattleMenu | null => battleMenu(state, data),
    stopRequested: () => stopRequested,
    clearStop: () => {
      stopRequested = false;
    },
    yieldFrame: nextFrame,
  };

  /** UI-54 / CB-43: first を送り、chainDecision が stop を返すまで battle.resolve / battle.auto off を送り続ける */
  const runBattle = async (first: Command): Promise<void> => {
    if (chaining) return;
    chaining = true;
    try {
      await runChain(first, chainDeps);
    } finally {
      chaining = false;
      // rejected のときは再生も sync も無いので cursor のまま描き直す（受け付けられたときは sync 済みで、描き直しても同じ）
      advanceFrom = null;
      if (!isBusy()) syncControls();
    }
  };

  /** 遭遇の直後など、入力を待たずに進める状態（オート中・入力が揃っている）なら連鎖を始める */
  const kickBattle = (): void => {
    if (chaining || isBusy()) return;
    const menu = battleMenu(state, data);
    if (menu === null) return;
    if (menu.auto) void runBattle(stopRequested ? { type: "battle.auto", on: false } : { type: "battle.resolve" });
    else if (menu.ready) void runBattle({ type: "battle.resolve" });
  };

  /** 入力の段階で 1 つ選ぶ。送る Command があれば連鎖で送る（UI-35。使えるか・揃ったかは core が決める） */
  const chooseBattle = (choice: Choice): void => {
    const menu = battleMenu(state, data);
    const cur = cursor;
    if (menu === null || cur === null || menu.auto) return;
    const r = step(menu, cur, choice);
    if (r.send === null) {
      cursor = r.cursor;
      syncBattleControls();
      return;
    }
    if (r.send.type === "battle.input") advanceFrom = r.send.memberId;
    // 再生の間は注目の枠の点滅と絵のタップを止める（rejected なら runBattle の後の描き直しで戻る）
    clearFocus();
    void runBattle(r.send);
  };

  /**
   * UI-44 の例外: オート中の「オート解除」。連鎖・再生の途中なら、core の状態に関係なくボタンを予約の表示にする（表示のためだけ）。
   * 予約（連鎖の次の段で battle.auto off）を立てるのは、今の state がオート中のときだけ（CB-43 で既に解けた・戦闘が終わったなら何も送らない）。
   * 連鎖の外なら、オート中のときだけ battle.auto off をそのまま送る。
   */
  const requestAutoStop = (): void => {
    const menu = battleMenu(state, data);
    if (chaining || isBusy()) {
      if (menu !== null && menu.auto) stopRequested = true;
      play.controls.setAutoStop(t("battle.autoStopping"), () => requestAutoStop());
      return;
    }
    if (menu === null || !menu.auto) return;
    stopRequested = false;
    void runBattle({ type: "battle.auto", on: false });
  };

  /**
   * SV-23: 保存の結果で帯を出し入れする。失敗に変わった最初の 1 回だけ、メッセージ窓に save.failed を出す
   * （再生の外。続く再生の文より前に即時で出す）
   */
  const onSaveStatus = (s: SaveStatus): void => {
    const r = bannerState.update(s);
    banner.setVisible(r.visible);
    if (r.announce) void play.message.say(t("save.failed"), true);
  };

  /** UI-31: 前進の長押し。1 歩ごとに再生の終わりを待ち、[moved] の後が hpChanged だけのときに続ける（canRepeat） */
  const repeater = createHoldRepeater({
    ms: () => store.get().holdRepeatMs,
    fire: () =>
      forwardStep({
        ready: () => route === "dungeon" && overlay === null && state.pendingChoice === null,
        move: () =>
          run({ type: "dungeon.move" }).then((r) => {
            // CB-01 の遭遇。敵の奇襲の後などで入力が要らない状態なら、そのまま連鎖で進める
            if (r !== null && !r.rejected && route === "battle") kickBattle();
            return r;
          }),
        pending: () => state.pendingChoice,
        overlayOpen: () => overlay !== null,
      }),
  });

  /**
   * UI-25: 地図のタップ移動の自動歩行。1 手ごとに再生の終わりを待ち、holdRepeatMs おいて次の手を送る（長押しの連打と同じ仕組み）。
   * 続けてよいかは core の routeStepOk が決める（遭遇・罠・階段の確認・壁・回転床・rejected で止まる。扉では止まらない）
   */
  const walker = createHoldRepeater({
    ms: () => store.get().holdRepeatMs,
    fire: async () => {
      const w = walking;
      const go = await walkStep({
        walk: () => walking,
        ready: () => route === "dungeon" && overlay === null && state.pendingChoice === null,
        // beforePlay: 止まる手（routeStepOk が偽・最後の手）は再生の前に歩行を終える（walkStep が finish を呼ぶ）
        send: (cmd, beforePlay) =>
          run(cmd, { beforePlay }).then((r) => {
            // CB-01 の遭遇。入力が要らない状態なら、そのまま連鎖で進める（長押しの前進と同じ）
            if (r !== null && !r.rejected && route === "battle") kickBattle();
            return r;
          }),
        ok: (s, events) => routeStepOk(s, events, state),
        finish: () => endWalk(),
      });
      // 止められた（stopWalk 済み）なら何もしない。歩き終えた・止まったなら片付ける
      if (!go && walking === w) endWalk();
      return go;
    },
  });

  /** 自動歩行を終える（swipe-on などを戻す） */
  const endWalk = (): void => {
    if (walking === null) return;
    walking = null;
    walker.release();
    if (!isBusy() && !chaining) syncControls();
  };

  /**
   * UI-25: 歩いている間に触れる・キーを押すと止まる。その入力は捨てる（true を返す）。歩いていなければ false。
   * 送っている途中の 1 手はそのまま再生し、次の手を送らない
   */
  const stopWalk = (): boolean => {
    if (walking === null) return false;
    endWalk();
    return true;
  };

  /**
   * UI-25: 地図のセルのタップ。経路（core の planRoute）があれば地図を閉じて歩き始める。
   * 経路が無ければ地図の題の行を「道が分からない。」にする（地図は開いたまま）。現在位置なら何もしない
   */
  const tapMapCell = (p: Pos): void => {
    if (overlay !== "map" || walking !== null) return;
    const steps = planRoute(state, data, p);
    if (steps === null) {
      play.map.setTitle(t("map.noRoute"));
      return;
    }
    if (steps.length === 0) return;
    closeMap();
    walking = { steps, i: 0 };
    syncControls();
    walker.press();
  };

  /** 再生中のボタンは何もしない（UI-44）。自動歩行中も同じ（UI-25） */
  const guard = (fn: () => void): void => {
    if (isBusy() || chaining || walking !== null) return;
    fn();
  };

  // ---------------------------------------------------------------- タイトル（UI-50）と続きから（SV-50）
  const renderTitle = (): void => {
    const size = data.config.party.size;
    if (titleList === null) {
      title.render([], titleMessage ?? "");
      return;
    }
    title.render(titleItems(titlePage, titleList, size, strings), titleMessage ?? titleNotice(titlePage, titleList, size, strings));
  };

  /** 保存先の一覧を読み直して描く（SV-12）。読めなければ空の一覧 */
  const refreshTitle = async (): Promise<void> => {
    const seq = ++titleSeq;
    const r = await o.saves.list();
    if (seq !== titleSeq) return;
    titleList = r.ok ? r.entries : [];
    renderTitle();
  };

  /** タイトルに入るたびに一覧のページへ戻し、一覧を読み直す */
  const enterTitle = (): void => {
    titlePage = { kind: "list" };
    titleMessage = null;
    titleList = null;
    renderTitle();
    void refreshTitle();
  };

  /** 保存先を待つ操作。待っている間の操作は捨てる */
  const titleTask = (job: () => Promise<void>): void => {
    if (titleBusy) return;
    titleBusy = true;
    void job()
      .catch((e: unknown) => console.error(e))
      .finally(() => {
        titleBusy = false;
      });
  };

  /** タイトルの i 番目の項目を選ぶ（何が起きるかは titleStep が決める） */
  const selectTitle = (i: number): void => {
    if (route !== "title" || titleBusy || titleList === null) return;
    const e = titleEntries(titlePage, titleList)[i];
    if (e === undefined) return;
    const st = titleStep(titlePage, e);
    switch (st.kind) {
      case "none":
        return;
      case "page":
        titlePage = st.page;
        titleMessage = null;
        renderTitle();
        return;
      case "settings":
        openDebug();
        return;
      case "newGame":
        // SV-11: 上限は押した時点の件数（読めない記録も数える）。保存先を使えないときは作成を許す
        titleTask(async () => {
          const c = await o.saves.canCreate();
          if (route !== "title") return;
          if (c === "full") {
            titleMessage = t("title.maxGames");
            renderTitle();
          } else goCreation();
        });
        return;
      case "continue":
        titleTask(async () => {
          const r = await o.saves.load(st.gameId);
          if (route !== "title") return;
          if (!r.ok) {
            // 一時的な読み取りの失敗や別タブでの削除を「壊れている」と言わない（無事な記録を消させない）
            if (r.reason === "missing") {
              titlePage = { kind: "list" };
              await refreshTitle();
              if (route !== "title") return;
            }
            titleMessage = t(LOAD_FAILED[r.reason]);
            renderTitle();
            return;
          }
          resume(r.state);
        });
        return;
      case "remove":
        // SV-14: 確認 2 段階の後だけ消す
        titleTask(async () => {
          const ok = await o.saves.remove(st.gameId);
          titlePage = { kind: "list" };
          await refreshTitle();
          titleMessage = t(ok ? "title.deleted" : "title.deleteFailed");
          renderTitle();
        });
        return;
    }
  };

  /**
   * SV-50: 読み込んだ state から再開する。表示層だけの状態（overlay、街のページ、メッセージ履歴、入力の段階）は作り直し、
   * 保存した screen へ直接描く。保留中の選択の問いと救済の申し出は再生の外で出し直し、戦闘はオート中・ready なら連鎖を再開する
   */
  const resume = (st: GameState): void => {
    const plan = resumePlan(st, data);
    state = st;
    overlay = null;
    play.showMap(false);
    play.showCamp(false);
    play.showWipe(false);
    play.showHistory(false);
    // 読み込みを待つ間に F2 で開いた debug パネルも閉じる（overlay を null にするので、残すと閉じられなくなる）
    debug.el.style.display = "none";
    underDebug = null;
    campHost = "camp";
    campPage = { kind: "top" };
    walking = null;
    walker.release();
    townPage = "menu";
    cursor = null;
    advanceFrom = null;
    stopRequested = false;
    chaining = false;
    play.message.clear();
    play.battle.clear();
    play.dice.hide();
    showRoute(plan.route);
    sync(state);
    const instant = true;
    for (const k of plan.prompts) void play.message.say(t(k), instant);
    if (plan.route === "battle") kickBattle();
  };

  // ---------------------------------------------------------------- overlay
  const goCreation = (): void => {
    creation.reset();
    showRoute("creation");
  };

  const openDebug = (): void => {
    if (overlay === "debug") return;
    if (overlay === "camp") closeCamp(false);
    if (overlay === "map") closeMap();
    if (overlay === "history") closeHistory();
    // 全滅の内訳は閉じずに debug パネルの下に残す（閉じたら戻す）
    underDebug = overlay === "wipe" ? "wipe" : null;
    repeater.release();
    overlay = "debug";
    debug.refresh();
    debug.el.style.display = "";
  };

  /**
   * UI-57（開発用）: 「全員HP1」。街・迷宮・戦闘のときだけ、パネルを閉じてから debug.hpOne を送る（受け付けるかは core が決める）。
   * 全滅の流れ（UI-56）を実機で確かめるためのもの
   */
  const hpOneFromDebug = (): void => {
    if (route !== "town" && route !== "dungeon" && route !== "battle") return;
    closeDebug();
    void run({ type: "debug.hpOne" });
  };

  const closeDebug = (): void => {
    if (overlay !== "debug") return;
    overlay = underDebug;
    underDebug = null;
    debug.el.style.display = "none";
    syncControls();
  };

  const openMap = (): void => {
    if (route !== "dungeon" || overlay !== null || state.pendingChoice !== null) return;
    const v = mapView(state, data);
    if (v === null) return;
    repeater.release();
    overlay = "map";
    play.map.render(v, formatMessage(t("map.title"), { dungeon: dungeonName(state), floor: v.floor }));
    play.showMap(true);
    syncControls();
  };

  /**
   * UI-53 / TW-03: キャンプを開く。迷宮のキャンプ（host camp）は迷宮で、酒場（host tavern）は街で、
   * 他の overlay が無く、campMenu が非 null のとき（戦闘・保留中は開かない）。open は酒場の項目（状態・装備・並び順）
   */
  const openCamp = (host: CampHost, open?: "status" | "equip" | "order"): void => {
    if (overlay !== null) return;
    if (host === "camp" ? route !== "dungeon" : route !== "town") return;
    const menu = campMenu(state, data);
    if (menu === null) return;
    repeater.release();
    overlay = "camp";
    campHost = host;
    campPage = campFirstPage(host, open, menu);
    play.showCamp(true);
    syncControls();
  };

  /** キャンプを閉じ、ヘッダーを迷宮か街の表示に戻す（resync が偽なら操作領域は描き直さない） */
  const closeCamp = (resync: boolean): void => {
    if (overlay !== "camp") return;
    overlay = null;
    campPage = { kind: "top" };
    play.showCamp(false);
    const d = state.dive;
    if (route === "town") {
      const menu = townMenu(state, data);
      if (menu !== null) play.header.setText(townHeader(menu, strings));
    } else if (d !== null) showHeaderAt(state, { floor: d.floor, pos: d.pos, facing: d.facing });
    if (resync) syncControls();
  };

  const closeMap = (): void => {
    if (overlay !== "map") return;
    overlay = null;
    play.showMap(false);
    syncControls();
  };

  /**
   * UI-56: 全滅の内訳を開く（再生の中から。入力は待たない）。後続の街に入る処理は overlay の下で再生し、
   * 再生の最後の sync で操作領域を「街へ」にする
   */
  const openWipe = (p: PenaltyResult): void => {
    if (overlay === "map") closeMap();
    if (overlay === "camp") closeCamp(false);
    if (overlay === "history") closeHistory();
    repeater.release();
    overlay = "wipe";
    play.wipe.render(formatWipeSummary(p, data, strings));
    play.showWipe(true);
  };

  /** 「街へ」: 内訳を閉じて街のメニューを出す */
  const closeWipe = (): void => {
    if (overlay !== "wipe") return;
    overlay = null;
    play.showWipe(false);
    syncControls();
  };

  /**
   * UI-46: 履歴の画面を開く（街・迷宮・戦闘で、他の overlay が無いとき）。全文を古い順に並べ、末尾を見せる。
   * SV-50 により再開時には開かない
   */
  const openHistory = (): void => {
    if (route !== "town" && route !== "dungeon" && route !== "battle") return;
    if (overlay !== null) return;
    repeater.release();
    overlay = "history";
    // 先に表示する。display:none の間は scrollHeight が 0 で、render の末尾へ送る scrollTop が効かない
    play.showHistory(true);
    play.history.render(play.message.history(), t("history.title"));
    syncControls();
  };

  const closeHistory = (): void => {
    if (overlay !== "history") return;
    overlay = null;
    play.showHistory(false);
    syncControls();
  };

  /** 操作領域の「閉じる」: 地図か全滅の内訳か履歴を閉じる */
  const closeOverlay = (): void => {
    if (overlay === "map") closeMap();
    else if (overlay === "wipe") closeWipe();
    else if (overlay === "history") closeHistory();
  };

  // ---------------------------------------------------------------- 入力
  /** Action → Command / 画面の操作。変換は app だけが行う */
  const handleAction = (a: Action): void => {
    // UI-25: 自動歩行中のキーは歩行を止めるだけ（その入力は捨てる）
    if (stopWalk()) return;
    // UI-44 の例外: オート中の「オート解除」（Esc / Enter / 1）は再生中も予約として受ける
    if (route === "battle" && overlay === null && battleMenu(state, data)?.auto === true) {
      if (battleKeyChoice(a, "autoStop") === "stop") requestAutoStop();
      if (a !== "debug") return;
    }
    // UI-45: 再生中の Enter は拍のタップと同じ（タップ待ちを解く。拍の外では UI-43 の即表示）
    if (isBusy() && a === "confirm") {
      player.tap();
      return;
    }
    if (isBusy() || chaining) return; // UI-44
    if (a === "debug") {
      if (overlay === "debug") closeDebug();
      else openDebug();
      return;
    }
    if (overlay === "debug") {
      if (a === "back") closeDebug();
      return;
    }
    if (overlay === "map") {
      if (a === "back" || a === "map" || a === "confirm" || (typeof a === "object" && a.menu === 0)) closeMap();
      return;
    }
    if (overlay === "wipe") {
      if (a === "back" || a === "confirm" || (typeof a === "object" && a.menu === 0)) closeWipe();
      return;
    }
    if (overlay === "history") {
      // UI-33: Esc / Enter / 1 で閉じる。↑↓ で 3 行ずつ
      if (a === "back" || a === "confirm" || (typeof a === "object" && a.menu === 0)) closeHistory();
      else if (a === "forward") play.history.scrollBy(-HISTORY_KEY_LINES);
      else if (a === "around") play.history.scrollBy(HISTORY_KEY_LINES);
      return;
    }
    if (overlay === "camp") {
      // UI-33: 数字 n → n 番目の枠・行（空き枠は無視）、Enter → 先頭の押せる項目、Esc → やめる（top では戻る）
      const m = campInput();
      if (m === null) return;
      const k = campKeyIndex(a, campEntries(campHost, campPage, m, strings));
      if (k !== null) play.controls.select(k);
      return;
    }
    switch (route) {
      case "title": {
        if (titleList === null) return;
        const k = titleKeyIndex(a, titleEntries(titlePage, titleList));
        if (k !== null) selectTitle(k);
        return;
      }
      case "creation":
        if (a === "back") showRoute("title");
        return;
      case "town":
        if (a === "confirm") play.controls.select(0);
        else if (typeof a === "object") play.controls.select(a.menu);
        else if (a === "back") townBack();
        return;
      case "dungeon": {
        if (state.pendingChoice !== null) {
          if (a === "confirm") play.controls.select(0);
          else if (typeof a === "object") play.controls.select(a.menu);
          return;
        }
        if (a === "forward") repeater.press();
        else if (a === "left" || a === "right" || a === "around") void run({ type: "dungeon.turn", dir: a });
        else if (a === "map") openMap();
        else if (typeof a === "object") play.controls.select(a.menu);
        return;
      }
      case "battle": {
        const cur = cursor;
        const menu = battleMenu(state, data);
        if (cur === null || menu === null) return;
        const mode =
          cur.stage === "party" || cur.stage === "member" ? "grid" : cur.stage === "enemy" || cur.stage === "ally" ? "target" : "list";
        const k = battleKeyChoice(a, mode);
        if (k === "back") chooseBattle({ kind: "back" });
        else if (k === "up" || k === "down") {
          const next = moveFocus(menu, cur, k === "up" ? -1 : 1);
          if (next.stage === "enemy" || next.stage === "ally") focusTo(next.focus, true);
        } else if (k === "focused") {
          const ch = focusedChoice(menu, cur);
          if (ch !== null) chooseBattle(ch);
        } else if (typeof k === "number") play.controls.select(k);
        return;
      }
    }
  };

  /** UI-31: 十字ボタンのタップ。前進は短く離したら 1 歩（連打は始めない） */
  const tapDpad = (a: DpadAction): void => {
    handleAction(a);
    if (a === "forward") repeater.release();
  };

  /**
   * UI-43 / UI-46: 再生の外のメッセージ窓のタップ（再生中のタップはステージが player.tap() に回す）。
   * 文字送り中（街の「迷宮へ」の語りなど、run を通さない文）なら即表示、それ以外で overlay が無ければ履歴の画面を開く
   */
  const tapMessage = (): void => {
    if (isBusy() || chaining) return;
    if (play.message.typing()) {
      play.message.rush();
      return;
    }
    if (overlay === null) openHistory();
  };

  const blurActive = (): void => {
    const a = document.activeElement;
    if (a instanceof HTMLElement) a.blur();
  };

  return {
    onLayout(l: StageLayout, input: StageLayoutInput): void {
      layout = l;
      debug.update(l, input);
    },
    start(): void {
      debug.el.style.display = "none";
      showRoute("title");
      onTap(play.message.el, () => tapMessage());
      const stageInput = attachStageInput(stage, {
        scale,
        threshold: () => store.get().swipeThreshold,
        deadZone: data.config.input.edgeDeadZonePx,
        width: data.config.stage.width,
        swipeEnabled,
        busy: () => isBusy() || chaining,
        onBusyTap: () => player.tap(),
        // UI-25: 自動歩行中にどこかを押したら止め、その押下は捨てる
        onAnyPress: () => stopWalk(),
        onSwipe: (a) => handleAction(a),
        onSwipeRelease: () => repeater.release(),
        onDebugSwipe: (dx, dy, d) => debug.setSwipe(dx, dy, d),
      });
      attachKeyboard({
        onAction: (a) => handleAction(a),
        onRelease: (a) => {
          if (a === "forward") repeater.release();
        },
      });
      // UI-31: ポインタ（十字ボタン・スワイプ）の長押しも、窓のフォーカスが外れた・ページが隠れたら離したものとして扱う
      attachReleaseOnHide(() => {
        // 追っている押下と長押しのタイマーも片付ける（隠れた後に長押しが始まって裏で前進しないように）
        stageInput.reset();
        repeater.release();
        // UI-25: 窓のフォーカスが外れた・ページが隠れたら自動歩行も止める
        stopWalk();
      });
      store.subscribe(() => {
        debug.refresh();
        if (!isBusy()) syncControls();
      });
    },
  };
}
