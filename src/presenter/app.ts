// 画面遷移の親。state を持ち、入力を Command にして execute へ送り（UI-35）、返ったイベントを playback で再生する。
// - 判定・計算・分岐（前進できるか、入場できるか、名前が正しいか）は core が行う。ここは結果を描くだけ（§3-4）。
// - 再生中（busy）の入力はすべて捨てる。メッセージ窓のタップだけは受け、1 回目で今の文、2 回目で残りを即表示する（UI-44 / UI-43）。
// - 状態を変えるコマンドの後、再生を始める前にオートセーブを await する（§3-8。SV-02: 再生中にリロードされても結果は確定している）。
//   保存の失敗は SV-23 の帯とメッセージ窓で知らせ、state は巻き戻さない。
// - タイトル（UI-50）は保存先の一覧を読み、続きから（SV-50）は読み込んだ state を resume で直接描く。
// - 画面の切り替えは各画面のルート要素の表示と非表示だけで行う。迷宮の DOM は 1 回だけ作る。
// モジュールのトップレベルでは DOM に触れない。
import type { GameData } from "../core/data/index";
import { execute, createInitialState } from "../core/engine";
import { battleMenu } from "../core/rules/combat";
import { mapView, visibleCells } from "../core/rules/dungeon";
import { fieldItemMenu } from "../core/rules/items";
import { townMenu } from "../core/rules/town";
import { dungeonOf, itemDisplayName } from "../core/state";
import type { BattleMenu, Command, GameState, PenaltyResult, Screen, ViewPoint } from "../core/types";
import type { GameListEntry, SaveService } from "../save/types";
import { runChain, type ChainDeps } from "./auto-chain";
import { createAutosaver, createCommandExec, createSaveBannerState, type CommandResult, type SaveStatus } from "./autosave";
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
  attachSwipe,
  battleKeyChoice,
  createHoldRepeater,
  forwardStep,
  type Action,
} from "./input/swipe";
import { dungeonLayout, layoutWarnings, regions, SAVE_BANNER } from "./layout";
import { createPlayer } from "./playback";
import { resumePlan } from "./resume";
import { createRunGate } from "./run-gate";
import { defaultSettings, type SettingsStore } from "./settings";
import type { StageLayout, StageLayoutInput } from "./stage";
import type { ControlItem, DpadAction } from "./views/controls";
import { createCreationScreen } from "./views/creation";
import { createDebugPanel } from "./views/debug-panel";
import { formatDetail } from "./views/detail";
import { createDungeonScreen } from "./views/dungeon";
import { slotsFor } from "./views/dungeon-geometry";
import { headerText } from "./views/header";
import { formatMessage } from "./views/message";
import { createSaveBanner } from "./views/save-banner";
import { createTitleScreen, titleEntries, titleItems, titleKeyIndex, titleNotice, titleStep, type TitlePage } from "./views/title";
import { formatWipeSummary } from "./views/wipe";
import { itemEntries, itemHeader, itemKeyIndex, itemStep, type ItemChoice, type ItemCursor } from "./views/field-items";
import { townEntries, townHeader, townPageIntro, townParent, type TownEntry, type TownPage } from "./views/town";

export type Route = "title" | "creation" | "town" | "dungeon" | "battle";
export type Overlay = null | "map" | "debug" | "detail" | "items" | "wipe";

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

/** メッセージ窓のタップとみなす移動の上限（論理 px） */
const TAP_SLOP_LOGICAL = 4;

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
  /** 同じ再生の中のメッセージ窓のタップ回数 */
  let taps = 0;
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
  /** UI-53: 迷宮の道具の段（overlay が items の間だけ使う） */
  let itemCursor: ItemCursor = { stage: "member" };

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
    onAction: (a: DpadAction) => handleAction(a),
    onRelease: () => repeater.release(),
    onClose: () => guard(() => closeOverlay()),
    onPick: (g) => guard(() => chooseBattle({ kind: "group", index: g })),
    onRowTap: (id) => guard(() => openDetail(id)),
  });

  const debug = createDebugPanel({
    strings,
    store,
    defaults: defaultSettings(data.config),
    onClose: () => closeDebug(),
  });

  // SV-23: 保存できないことを知らせる帯（最前面。押せない）
  const banner = createSaveBanner({ strings, rect: SAVE_BANNER });
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
  });

  /** core の screen イベント。M3 の画面は title / town / dungeon / battle */
  const onScreen = (to: Screen): void => {
    if (to === "title" || to === "town" || to === "dungeon" || to === "battle") {
      if (to === "town") townPage = "menu";
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

  /** UI-52: 街のページを移る。入ったページの語り（宿・寺院・迷宮の入口、酒場は救済の申し出も）は再生の外で出す */
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
          case "mercy":
            void run({ type: "town.mercy", memberId: e.memberId });
            return;
          case "enter":
            void run({ type: "dungeon.enter", dungeonId: e.dungeonId });
            return;
        }
      }),
  });

  /** 操作領域とスワイプの可否を、route / overlay / pendingChoice / inputMode から決める */
  const syncControls = (): void => {
    const s = store.get();
    play.setSwipeEnabled(s.inputMode !== "buttons");
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
    if (overlay === "detail") {
      // UI-58: 詳細の間は操作領域に「閉じる」だけ（街・迷宮・戦闘のどれでも）
      clearFocus();
      c.setMode("close");
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
        // UI-52: 施設メニューは 2×2 の 4 枠
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
    if (overlay === "items") {
      syncItemControls();
      return;
    }
    const pc = state.pendingChoice;
    if (pc !== null) {
      c.setList(pc.options.map((op) => listItem(t(op.labelKey), () => void run({ type: "event.choose", optionId: op.id }))));
      c.setMode("list");
      return;
    }
    // UI-53: [道具][地図]（呪文・並びは dungeon.cast / party.reorder と同時に足す）
    c.setMenu([listItem(t("dungeon.menu.items"), () => openItems()), listItem(t("dungeon.menu.map"), () => openMap())]);
    c.setDpadVisible(s.inputMode !== "swipe");
    c.setMode("dpad");
  };

  /** UI-53: 道具の段の見出しと一覧（候補・押せるかは fieldItemMenu の値だけ） */
  const syncItemControls = (): void => {
    const c = play.controls;
    const menu = fieldItemMenu(state, data);
    if (menu === null) {
      closeItems();
      return;
    }
    play.header.setText(itemHeader(menu, itemCursor, strings));
    c.setList(
      itemEntries(menu, itemCursor, strings).map(
        (e): ControlItem => ({ label: e.label, disabled: e.disabled, onSelect: () => guard(() => chooseItem(e.choice)) }),
      ),
    );
    c.setMode("list");
  };

  /** UI-53: 道具の段で 1 つ選ぶ。送るときは overlay を閉じてから dungeon.useItem を送る（使えるかは core が決める） */
  const chooseItem = (choice: ItemChoice): void => {
    if (overlay !== "items") return;
    const menu = fieldItemMenu(state, data);
    if (menu === null) {
      closeItems();
      return;
    }
    const r = itemStep(menu, itemCursor, choice);
    if (r.kind === "cursor") {
      itemCursor = r.cursor;
      syncControls();
      return;
    }
    closeItems();
    if (r.kind === "send") void run(r.command);
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
  const gate = createRunGate<Command, DispatchResult>({
    onStart: () => {
      taps = 0;
    },
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
  const run = (cmd: Command): Promise<DispatchResult | null> => gate.run(cmd);

  // ---------------------------------------------------------------- 戦闘
  /** 段の間で 1 フレーム譲る（1 回だけの requestAnimationFrame。常駐のループではない） */
  const nextFrame = (): Promise<void> =>
    new Promise((resolve) => {
      requestAnimationFrame(() => resolve());
    });

  const chainDeps: ChainDeps = {
    run: (cmd) => run(cmd),
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
   * UI-44 の例外: オート中の「オート解除」。連鎖・再生の途中なら予約だけ立てて文言を変える（連鎖の次の段で battle.auto off）。
   * 連鎖の外なら battle.auto off をそのまま送る。
   */
  const requestAutoStop = (): void => {
    const menu = battleMenu(state, data);
    if (menu === null || !menu.auto) return;
    if (chaining || isBusy()) {
      if (stopRequested) return;
      stopRequested = true;
      play.controls.setAutoStop(t("battle.autoStopping"), () => requestAutoStop());
      return;
    }
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

  /** 再生中のボタンは何もしない（UI-44） */
  const guard = (fn: () => void): void => {
    if (isBusy() || chaining) return;
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
            titleMessage = t(r.reason === "tooNew" ? "title.loadTooNew" : "title.loadBroken");
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
    play.showDetail(false);
    play.showWipe(false);
    underDebug = null;
    itemCursor = { stage: "member" };
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
    if (overlay === "items") closeItems();
    if (overlay === "map") closeMap();
    if (overlay === "detail") closeDetail();
    // 全滅の内訳は閉じずに debug パネルの下に残す（閉じたら戻す）
    underDebug = overlay === "wipe" ? "wipe" : null;
    repeater.release();
    overlay = "debug";
    debug.refresh();
    debug.el.style.display = "";
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

  /** UI-53: 迷宮の道具を開く（迷宮で、他の overlay も保留中の選択も無いとき） */
  const openItems = (): void => {
    if (route !== "dungeon" || overlay !== null || state.pendingChoice !== null) return;
    if (fieldItemMenu(state, data) === null) return;
    repeater.release();
    overlay = "items";
    itemCursor = { stage: "member" };
    syncControls();
  };

  /** 道具を閉じ、ヘッダーを迷宮の表示に戻す */
  const closeItems = (): void => {
    if (overlay !== "items") return;
    overlay = null;
    itemCursor = { stage: "member" };
    const d = state.dive;
    if (d !== null) showHeaderAt(state, { floor: d.floor, pos: d.pos, facing: d.facing });
    syncControls();
  };

  const closeMap = (): void => {
    if (overlay !== "map") return;
    overlay = null;
    play.showMap(false);
    syncControls();
  };

  /**
   * UI-58: パーティの行のタップで詳細を開く。街・迷宮・戦闘で、他の overlay が無いとき（詳細が開いていればその人に切り替える）。
   * 再生中・連鎖の途中は guard で捨てる（UI-44）
   */
  const openDetail = (id: string): void => {
    if (route !== "town" && route !== "dungeon" && route !== "battle") return;
    if (overlay !== null && overlay !== "detail") return;
    const ch = state.party.find((m) => m.id === id);
    if (ch === undefined) return;
    repeater.release();
    overlay = "detail";
    play.detail.render(formatDetail(ch, data, strings, (iid) => itemDisplayName(state, data, iid)));
    play.showDetail(true);
    syncControls();
  };

  const closeDetail = (): void => {
    if (overlay !== "detail") return;
    overlay = null;
    play.showDetail(false);
    syncControls();
  };

  /**
   * UI-56: 全滅の内訳を開く（再生の中から。入力は待たない）。後続の街に入る処理は overlay の下で再生し、
   * 再生の最後の sync で操作領域を「街へ」にする
   */
  const openWipe = (p: PenaltyResult): void => {
    if (overlay === "map") closeMap();
    if (overlay === "detail") closeDetail();
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

  /** 操作領域の「閉じる」: 地図か詳細か全滅の内訳を閉じる */
  const closeOverlay = (): void => {
    if (overlay === "map") closeMap();
    else if (overlay === "detail") closeDetail();
    else if (overlay === "wipe") closeWipe();
  };

  // ---------------------------------------------------------------- 入力
  /** Action → Command / 画面の操作。変換は app だけが行う */
  const handleAction = (a: Action): void => {
    // UI-44 の例外: オート中の「オート解除」（Esc / Enter / 1）は再生中も予約として受ける
    if (route === "battle" && overlay === null && battleMenu(state, data)?.auto === true) {
      if (battleKeyChoice(a, "autoStop") === "stop") requestAutoStop();
      if (a !== "debug") return;
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
    if (overlay === "detail") {
      if (a === "back" || a === "confirm" || (typeof a === "object" && a.menu === 0)) closeDetail();
      return;
    }
    if (overlay === "wipe") {
      if (a === "back" || a === "confirm" || (typeof a === "object" && a.menu === 0)) closeWipe();
      return;
    }
    if (overlay === "items") {
      // UI-33: 数字 n → n 番目、Enter → 先頭の押せる行、Esc → 戻る
      const menu = fieldItemMenu(state, data);
      if (menu === null) return;
      const k = itemKeyIndex(a, itemEntries(menu, itemCursor, strings));
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

  /**
   * UI-43 / UI-44: メッセージ窓のタップ。再生中は 1 回目で今の文、2 回目以降で残りを即表示する。
   * 再生の外（街の「迷宮へ」の語りなど、run を通さない文）でも、今の文の即表示だけは効かせる。
   */
  const attachMessageTap = (): void => {
    let down: { id: number; x: number; y: number } | null = null;
    play.message.el.addEventListener("pointerdown", (e) => {
      down = { id: e.pointerId, x: e.clientX, y: e.clientY };
    });
    play.message.el.addEventListener("pointerup", (e) => {
      const d = down;
      down = null;
      if (d === null || d.id !== e.pointerId) return;
      const slop = TAP_SLOP_LOGICAL * scale();
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) >= slop) return;
      if (!isBusy()) {
        play.message.rush();
        return;
      }
      taps++;
      if (taps >= 2) player.rushAll();
      play.message.rush();
    });
    play.message.el.addEventListener("pointercancel", () => {
      down = null;
    });
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
      attachSwipe(play.swipeLayer, {
        scale,
        threshold: () => store.get().swipeThreshold,
        deadZone: data.config.input.edgeDeadZonePx,
        width: data.config.stage.width,
        enabled: () => route === "dungeon" && overlay === null && state.pendingChoice === null && store.get().inputMode !== "buttons",
        onAction: (a) => handleAction(a),
        onRelease: () => repeater.release(),
        onDebug: (dx, dy, d) => debug.setSwipe(dx, dy, d),
      });
      attachKeyboard({
        onAction: (a) => handleAction(a),
        onRelease: (a) => {
          if (a === "forward") repeater.release();
        },
      });
      attachMessageTap();
      // UI-31: ポインタ（十字ボタン・スワイプ）の長押しも、窓のフォーカスが外れた・ページが隠れたら離したものとして扱う
      attachReleaseOnHide(() => repeater.release());
      store.subscribe(() => {
        debug.refresh();
        if (!isBusy()) syncControls();
      });
    },
  };
}
