// 画面遷移の親。state を持ち、入力を Command にして execute へ送り（UI-35）、返ったイベントを playback で再生する。
// - 判定・計算・分岐（前進できるか、入場できるか、名前が正しいか）は core が行う。ここは結果を描くだけ（§3-4）。
// - 再生中（busy）の入力はすべて捨てる。メッセージ窓のタップだけは受け、1 回目で今の文、2 回目で残りを即表示する（UI-44 / UI-43）。
// - 状態を変えるコマンドの後、再生を始める前に afterCommand を呼ぶ。M2 では空で、M4 のオートセーブをここに差し込む
//   （§3-8。SV-02: 再生を始める前に保存する。再生中にリロードされても結果は確定している）。
// - 画面の切り替えは各画面のルート要素の表示と非表示だけで行う。迷宮の DOM は 1 回だけ作る。
// モジュールのトップレベルでは DOM に触れない。
import type { GameData } from "../core/data/index";
import { execute, createInitialState } from "../core/engine";
import { battleMenu } from "../core/rules/combat";
import { mapView, visibleCells } from "../core/rules/dungeon";
import { dungeonOf, itemDisplayName } from "../core/state";
import type { BattleMenu, Command, GameEvent, GameState, Screen, ViewPoint } from "../core/types";
import { runChain, type ChainDeps } from "./auto-chain";
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
import { dungeonLayout, layoutWarnings, regions } from "./layout";
import { createPlayer } from "./playback";
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
import { createTitleScreen } from "./views/title";
import { townEntries, townEntryLabel, type TownEntry, type TownPage } from "./views/town";

export type Route = "title" | "creation" | "town" | "dungeon" | "battle";
export type Overlay = null | "map" | "debug" | "detail";

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

type DispatchResult = { events: readonly GameEvent[]; rejected: boolean };

export function createApp(o: { stage: HTMLElement; data: GameData; settings: SettingsStore; seed?: number }): App {
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

  const scale = (): number => layout?.scale ?? 1;

  // ---------------------------------------------------------------- 画面
  const title = createTitleScreen({
    strings,
    onNewGame: () => guard(() => goCreation()),
    onSettings: () => guard(() => openDebug()),
  });

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

  stage.replaceChildren(title.el, creation.el, play.el, debug.el);

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
      play.header.setText(t("town.title"));
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

  const townItem = (e: TownEntry): ControlItem =>
    listItem(townEntryLabel(e, data, strings), () => {
      if (e.kind === "gate") {
        townPage = "gate";
        syncControls();
        void play.message.say(t("town.dungeonGate.intro"), store.get().skipAnimations);
      } else if (e.kind === "back") {
        townPage = "menu";
        syncControls();
      } else {
        void run({ type: "dungeon.enter", dungeonId: e.dungeonId });
      }
    });

  /** 操作領域とスワイプの可否を、route / overlay / pendingChoice / inputMode から決める */
  const syncControls = (): void => {
    const s = store.get();
    play.setSwipeEnabled(s.inputMode !== "buttons");
    const c = play.controls;
    // UI-31: 十字ボタンを出さない間は長押しを離したものとする（shouldReleaseHold）
    if (shouldReleaseHold(route, overlay, state.pendingChoice !== null)) repeater.release();
    if (overlay === "detail") {
      // UI-58: 詳細の間は操作領域に「閉じる」だけ（街・迷宮・戦闘のどれでも）
      clearFocus();
      c.setMode("close");
      return;
    }
    if (route === "town") {
      c.setList(townEntries(townPage, state).map(townItem));
      c.setMode("list");
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
    c.setMenu([listItem(t("dungeon.menu.map"), () => openMap())]);
    c.setDpadVisible(s.inputMode !== "swipe");
    c.setMode("dpad");
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
        ...(targeting ? { onFocus: () => guard(() => focusTo(i)) } : {}),
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

  /** UI-54: 対象の一覧の注目を i に移す（一覧は作り直さない。作り直すと click が消える） */
  const focusTo = (i: number): void => {
    const menu = battleMenu(state, data);
    const cur = cursor;
    if (menu === null || cur === null) return;
    const next = setFocus(menu, cur, i);
    if (next === cur) return;
    cursor = next;
    if (next.stage === "enemy" || next.stage === "ally") play.controls.setListFocus(next.focus);
    paintFocus();
  };

  const showRoute = (r: Route): void => {
    route = r;
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
    exec: async (cmd) => {
      const r = execute(state, cmd, data);
      const only = r.events.length === 1 ? r.events[0] : undefined;
      if (only !== undefined && only.kind === "rejected") {
        console.debug("rejected", only.command, only.reason);
        return { events: r.events, rejected: true };
      }
      const before = state;
      state = r.state;
      afterCommand(state, r.events); // SV-02: 再生を始める前
      await player.play(r.events, before, state);
      return { events: r.events, rejected: false };
    },
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

  /** 状態を変えるコマンドの直後、再生を始める前の差し込み口（M4 のオートセーブ。§3-8、SV-02） */
  const afterCommand = (_st: GameState, _events: readonly GameEvent[]): void => {};

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

  // ---------------------------------------------------------------- overlay
  const goCreation = (): void => {
    creation.reset();
    showRoute("creation");
  };

  const openDebug = (): void => {
    if (overlay === "map") closeMap();
    if (overlay === "detail") closeDetail();
    repeater.release();
    overlay = "debug";
    debug.refresh();
    debug.el.style.display = "";
  };

  const closeDebug = (): void => {
    if (overlay !== "debug") return;
    overlay = null;
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

  /** 操作領域の「閉じる」: 地図か詳細を閉じる */
  const closeOverlay = (): void => {
    if (overlay === "map") closeMap();
    else if (overlay === "detail") closeDetail();
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
    switch (route) {
      case "title":
        if (a === "confirm" || (typeof a === "object" && a.menu === 0)) goCreation();
        else if (typeof a === "object" && a.menu === 1) openDebug();
        return;
      case "creation":
        if (a === "back") showRoute("title");
        return;
      case "town":
        if (a === "confirm") play.controls.select(0);
        else if (typeof a === "object") play.controls.select(a.menu);
        else if (a === "back" && townPage === "gate") {
          townPage = "menu";
          syncControls();
        }
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
          if (next.stage === "enemy" || next.stage === "ally") focusTo(next.focus);
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
