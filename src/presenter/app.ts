// 画面遷移の親。state を持ち、入力を Command にして execute へ送り（UI-35）、返ったイベントを playback で再生する。
// - 判定・計算・分岐（前進できるか、入場できるか、名前が正しいか）は core が行う。ここは結果を描くだけ（§3-4）。
// - 入力はステージ 1 か所（input/tap.ts の attachStageInput）で受ける。押せるものは onTap で登録し、動かずに離したときだけ反応する（UI-36）。
// - 再生中（busy）の入力はすべて捨てる。ステージのどこかのタップ（オート解除を除く）と Enter / Space だけは受け、player.tap() に渡す
//   （拍のタップ待ちを解く・拍の残りを即時にする・拍の外は 1 回目で今の文、2 回目で残りを即表示。UI-44 / UI-45 / UI-43）。
// - 再生の外のメッセージ窓のタップは、文字送り中なら即表示、それ以外なら履歴の画面（UI-46）を開く。
// - 街（UI-47。M8.5）の語りは会話の箱（narrator が route で振り分ける）。再生の外の箱と施設の絵のタップで次へ・閉じる。
//   一覧・戻る・帯・数字・Esc は会話を打ち切ってから動き、Enter は箱が開いていれば箱のタップ。
// - 迷宮のキャンプと酒場の状態・並び順（UI-53 / TW-03）とキャラクター画面（UI-59。M10）は views/camp.ts の段で進める（overlay 'camp'）。
//   キャンプはビュー領域だけを覆い、キャラクター画面はビューの上端から操作領域の上端まで広げてパーティ欄とメッセージ窓を隠す（setCharacter）。
// - 地図のタップ（UI-25）は 2 段階。探索済みのセルに吸着したら core の planRoute で経路を確かめてそのセルを選び（点滅）、同じセルの
//   再タップか「移動」で、holdRepeatMs おきに 1 手ずつ送る（自動歩行）。続けるかは core の
//   routeStepOk が決める。歩いている間に触れる・キーを押すと止まり、その入力は捨てる。
// - 状態を変えるコマンドの後、再生を始める前にオートセーブを await する（§3-8。SV-02: 再生中にリロードされても結果は確定している）。
//   保存の失敗は SV-23 の帯とメッセージ窓で知らせ、state は巻き戻さない。
// - タイトル（UI-50）は保存先の一覧を読み、続きから（SV-50）は読み込んだ state を resume で直接描く。
// - 画面の切り替えは各画面のルート要素の表示と非表示だけで行う。迷宮の DOM は 1 回だけ作る。
// モジュールのトップレベルでは DOM に触れない。
import type { GameData } from "../core/data/index";
import type { GameAssets } from "../build/asset-types";
import { execute, createInitialState } from "../core/engine";
import { createRng, type RngState } from "../core/rng";
import { battleMenu } from "../core/rules/combat";
import { mapView, visibleCells, visibleKnownTraps } from "../core/rules/dungeon";
import { campMenu, campSummary } from "../core/rules/camp";
import { SAN_OVER_DEBUG } from "../core/rules/debug";
import { planRoute, routeStepOk } from "../core/rules/pathfind";
import { STAY_CHOICE_ID } from "../core/rules/choices";
import { equipPreview, itemDetail, memberSheet, spellInfo, uniqueBookView } from "../core/rules/item-view";
import { sanStage } from "../core/rules/san";
import { fieldItemMenu } from "../core/rules/items";
import { townMenu } from "../core/rules/town";
import { upgradePreview } from "../core/rules/upgrade";
import { dungeonOf, itemDisplayName } from "../core/state";
import type { BattleMenu, Command, GameState, PenaltyResult, Pos, Screen, UpgradePreview, ViewPoint } from "../core/types";
import type { GameListEntry, ImportPlan, SaveService } from "../save/types";
import { downloadText, exportFileName } from "./file-io";
import { closesInput, runChain, type ChainDeps } from "./auto-chain";
import { createAutosaver, createCommandExec, createSaveBannerState, type CommandExecOptions, type CommandResult, type SaveStatus } from "./autosave";
import {
  entries,
  firstCursor,
  focusedChoice,
  focusedGroup,
  isBackChoice,
  moveFocus,
  nextCursor,
  setFocus,
  spellNote,
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
import { attachPointerLog, createPointerLog } from "./input/pointer-log";
import { attachSaveOnHide } from "./lifecycle";
import { attachStageInput, onTap } from "./input/tap";
import { dungeonLayout, layoutWarnings, regions, saveBannerRect, settingsLayout, townLayout } from "./layout";
import { createPlayer } from "./playback";
import type { AudioPlayer } from "./audio";
import {
  campSong,
  INITIAL_SOUND_CONTEXT,
  nextSoundContext,
  resumeSoundContext,
  songAt,
  soundsFor,
  startSoundPlayback,
  townSong,
  type SoundContext,
  type SoundOrder,
} from "./sound-cues";
import { resumePlan, routeOfScreen } from "./resume";
import { createRunGate } from "./run-gate";
import { defaultSettings, type SettingsStore } from "./settings";
import type { StageLayout, StageLayoutInput } from "./stage";
import type { ControlItem, DpadAction, UiSound } from "./views/controls";
import { createCreationScreen } from "./views/creation";
import {
  createCustomCreationScreen,
  customKeyChoice,
  customStep,
  customView,
  initialDraft,
  type CustomChoice,
  type CustomDraft,
} from "./views/custom-creation";
import { createDebugPanel } from "./views/debug-panel";
import { createSettingsScreen, settingsItems, settingsKeyIndex, type SettingsContext } from "./views/settings";
import { isStandalone, type StandaloneEnv } from "./pwa-env";
import {
  campCharacterOpen,
  campCycle,
  campEntries,
  campFirstPage,
  campHeader,
  campKeyIndex,
  campPanel,
  campRepair,
  campStep,
  type CampChoice,
  type CampOpen,
  type CampEntry,
  type CampHost,
  type CampInput,
  type CampPage,
  type CampPanelView,
} from "./views/camp";
import { formatCharacter, SLOT_ORDER } from "./views/detail";
import { chunkDescription, formatBook, formatEquipPreview, formatItemDetail } from "./views/item-detail";
import { formatSpellInfo } from "./views/spell-info";
import { createDungeonScreen } from "./views/dungeon";
import { mapTapAction } from "./views/map";
import { slotsFor } from "./views/dungeon-geometry";
import { battleTurnText, headerText } from "./views/header";
import { formatMessage } from "./views/message";
import { createSaveBanner } from "./views/save-banner";
import { createUpdateNotice } from "./views/update-notice";
import { createTitleScreen, titleEntries, titleHint, titleItems, titleKeyIndex, titleNotice, titleStep, type TitlePage } from "./views/title";
import { formatWipeSummary } from "./views/wipe";
import { createNarrator } from "./views/talk";
import {
  TOWN_INTRO_DEDUP,
  townEntries,
  townFacility,
  townFreshIntro,
  townHeader,
  townHeading,
  townLowersInput,
  townPageIntro,
  townParent,
  townRepair,
  upgradeConfirmLines,
  type TownEntry,
  type TownPage,
} from "./views/town";

export type Route = "title" | "creation" | "custom" | "town" | "dungeon" | "battle";
export type Overlay = null | "map" | "debug" | "camp" | "wipe" | "history" | "settings";

export type App = {
  onLayout(layout: StageLayout, input: StageLayoutInput): void;
  start(): void;
  /** SV-42: 新しい版の案内を出す。「読み込み直す」で apply を呼ぶ */
  showUpdate(apply: () => void): void;
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

/** SV-31〜33: 読み込みの失敗理由ごとの文言 */
const IMPORT_FAILED: Readonly<Record<"format" | "broken" | "tooNew" | "checksum" | "unavailable" | "full" | "failed" | "existingTooNew", string>> = {
  format: "title.importFormat",
  broken: "title.importBroken",
  tooNew: "title.importTooNew",
  checksum: "title.importChecksum",
  unavailable: "title.importUnavailable",
  full: "title.importFull",
  failed: "title.importFailed",
  existingTooNew: "title.importExistingTooNew",
};

type DispatchResult = CommandResult;

export function createApp(o: {
  stage: HTMLElement;
  data: GameData;
  settings: SettingsStore;
  saves: SaveService;
  seed?: number;
  /** UI-63 / UI-65 / UI-60（M8）: ビルド時に検証した素材（virtual:wizlike-assets）。省略時（テスト）は素材なし = 無音・矩形 */
  assets?: GameAssets;
  /** UI-06 / UI-66（M8）: 音の再生機。省略時（テスト）は無音 */
  audio?: AudioPlayer;
}): App {
  const { data, stage } = o;
  const audio = o.audio ?? null;
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
  /** debug パネルの下に残している overlay（全滅の内訳か設定画面。閉じたら戻す） */
  let underDebug: Overlay = null;
  /** UI-57: 設定画面の下に残している overlay（全滅の内訳だけ。閉じたら戻す） */
  let underSettings: Overlay = null;
  /** UI-57: 設定画面の案内の欄の上書き（書き出しの結果）。null なら settingsFileHint */
  let settingsNotice: string | null = null;
  /** UI-57: 設定画面の書き出しを待っている間（二重押しを捨てる） */
  let settingsBusy = false;
  /** UI-53 / TW-03: キャンプを開いた場所（迷宮のキャンプか酒場か）と今の段（overlay が camp の間だけ使う） */
  let campHost: CampHost = "camp";
  let campPage: CampPage = { kind: "top" };
  /** UI-59（M10）: キャラクター画面（とその下の段）を開いている間か（迷宮でも語りを会話の箱に出す。setCharacter） */
  let characterOpen = false;
  /** UI-25: 地図のタップ移動の自動歩行（歩いている間だけ非 null。SV-50 の再開では戻さない） */
  let walking: RouteWalk | null = null;
  /** UI-25: 地図で選んだセル（地図を開いている間だけ。表示層だけの値で保存しない） */
  let mapPick: Pos | null = null;
  /** UI-25: 地図の題（経路が無いときの「道が分からない。」から戻すため） */
  let mapTitle = "";

  const scale = (): number => layout?.scale ?? 1;

  // ---------------------------------------------------------------- 音（UI-63 / UI-65 / UI-66。M8）
  /** 決定・取り消しの音を鳴らした回数（キーの back で二重に鳴らさないため） */
  let uiSounds = 0;
  const playUi = (k: UiSound): void => {
    uiSounds++;
    audio?.playSfx(data.audio.ui[k]);
  };
  /** UI-63 / UI-66（2026-10-06）: 戦闘の曲の順とボス戦か（表示層だけの値。保存しない） */
  let soundCtx: SoundContext = INITIAL_SOUND_CONTEXT;
  /** UI-63: いまの場面の曲（迷宮のキャンプの曲を除く。キャンプを閉じたらこれに戻す） */
  let sceneSongName: string | null = null;
  const setScene = (name: string | null): void => {
    sceneSongName = name;
    audio?.setSong(name);
  };
  const playOrder = (x: SoundOrder): void => {
    if (audio === null) return;
    if (x.type === "song") setScene(x.name);
    else if (x.type === "jingle") audio.playJingle(x.name);
    else audio.playSfx(x.name);
  };
  /** UI-63 / SV-50: screen イベントの来ない場面（タイトル・続きから）の曲と、音の状態（続きからの戦闘は 1 つ目の遭遇） */
  const setSceneSong = (screen: Screen, monsterIds: readonly string[], dungeonId: string | null): void => {
    soundCtx = resumeSoundContext(screen, monsterIds, data);
    const name = songAt(screen, data, { monsterIds, dungeonId });
    if (name !== undefined) setScene(name);
  };

  // ---------------------------------------------------------------- 画面
  // SV-31: 読み込みのファイルはタップで透明の input が直接受ける（guard を通らないので importFromFile が route と titleBusy を見る）
  // UI-50（2026-10-06 ユーザー決定）: public/town/title.png があればタイトルに出す
  const title = createTitleScreen({
    strings,
    onSelect: (i) => guard(() => selectTitle(i)),
    onFile: (f) => importFromFile(f),
    pictures: o.assets?.town ?? {},
    base: import.meta.env.BASE_URL,
  });
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
  /** SV-32: 古いファイルの読み込みの確認を待っている計画（importConfirm のページの間だけ） */
  let pendingImport: ImportPlan | null = null;

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

  // UI-62（M5.5）: 自分で作る。下書きと作成中の乱数は表示層だけの値で保存しない（SV-50。リロードするとタイトルから）
  const custom = createCustomCreationScreen({ onChoice: (c) => guard(() => chooseCustom(c)) });
  let customDraft: CustomDraft = initialDraft(data);
  /** CH-06: 作成中の乱数（CH-11 のボーナス）。goCustom のたびに crypto.getRandomValues の種で作り直す */
  let customRng: RngState = createRng(1);
  /** 誤りの欄の文（null なら隠す） */
  let customError: string | null = null;

  // ui §2 の区切りは【仮】。操作領域などに中身が収まらない layout は起動を止めず、console.warn で知らせる
  const playRegions = regions(data.config.ui.layout, data.config.stage.width);
  const playLayout = dungeonLayout(playRegions, data.config.party.size);
  for (const w of layoutWarnings(playRegions, playLayout)) console.warn(w);

  const play = createDungeonScreen({
    data,
    strings,
    regions: playRegions,
    layout: playLayout,
    // UI-13（M8.5）: 街の画面の配置
    town: townLayout(playRegions, data.config.party.size),
    textSpeed: () => store.get().textSpeed,
    // UI-47 / UI-41: 会話の箱の ▼ は演出スキップでは点滅しない（タップ待ちは残す）
    talkBlink: () => !store.get().skipAnimations,
    historyMax: data.config.ui.messageHistory,
    stageOf: (san, sanMax) => sanStage(san, sanMax, data.config),
    maxOf: (ch) => memberSheet(state, data, ch), // CH-14 / UI-12（M7）: 実効の hpMax / mpMax / sanMax（core の memberSheet）
    onSettings: () => guard(() => openSettings()),
    // UI-46 / UI-13（M8.5）: 街のヘッダーのログ（他の overlay があるとき・再生中は捨てる）
    onLog: () => guard(() => openHistory()),
    // UI-13 / UI-59（M8.5）: 街の帯のタップでその人の状態
    onBand: (id) =>
      guard(() => {
        // UI-47: 帯のタップは会話を打ち切ってから開く（他の overlay があるときは開かないので打ち切らない）
        if (overlay !== null) return;
        play.talk.flush();
        openCamp("tavern", "status", id);
      }),
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
    onMapGo: () => guard(() => goMapPick()),
    onSound: (k) => playUi(k),
    // UI-66（2026-10-06）: 会話の箱の送り
    talkAdvanced: () => playUi("talk"),
    // UI-60（M8）: public/sprites に実在する絵の一覧だけ読む（素材が無い間は空 = 矩形）
    sprites: o.assets?.sprites ?? {},
    // UI-61（M8.5）: public/town に実在する施設の絵の一覧だけ読む（素材が無い間は空 = 黒）
    townPictures: o.assets?.town ?? {},
  });

  /**
   * UI-47（M8.5）: 語りの表示先。route が街なら会話の箱、それ以外（迷宮・戦闘）は今のメッセージ窓。
   * UI-59（M10）: キャラクター画面の間は迷宮でも会話の箱（メッセージ窓は隠れている。hold もこの条件に従い、文ごとにタップを待つ）。
   * ログ（UI-46）はどちらもメッセージ窓の 1 本の配列。再生（PlayerDeps.message）・save.failed・再開の語りはここを通す
   */
  const narrator = createNarrator({ town: () => route === "town" || characterOpen, talk: play.talk, window: play.message });

  // UI-57: debug パネルの「ポインタ」に出す直近 20 件のポインタイベント（表示層だけ。保存しない）
  const pointerLog = createPointerLog();
  const debug = createDebugPanel({
    strings,
    store,
    defaults: defaultSettings(data.config),
    onClose: () => closeDebug(),
    onHpOne: () => guard(() => hpOneFromDebug()),
    onSanDown: () => guard(() => debugCommand({ type: "debug.sanDown" })),
    onWarp: (to) => guard(() => debugCommand({ type: "debug.warp", to })),
    onAddTurns: () => guard(() => addTurnsFromDebug()),
    addTurns: data.config.town.tavernEventTurns,
    onSanOver: () => guard(() => sanOverFromDebug()),
    sanOver: SAN_OVER_DEBUG,
    pointers: () => pointerLog.entries(),
  });

  // SV-23: 保存できないことを知らせる帯（最前面。押せない）
  const banner = createSaveBanner({ strings, rect: saveBannerRect(playRegions, data.config.ui.saveBannerHeight) });
  const bannerState = createSaveBannerState(o.saves.available);
  banner.setVisible(bannerState.visible());

  // UI-57: 設定画面（debug パネルの下。「開発用」で debug パネルを上に開き、閉じると設定画面へ戻る）
  const settingsView = createSettingsScreen({
    strings,
    store,
    layout: settingsLayout(playRegions),
    onExport: () => guard(() => exportFromSettings()),
    // SV-31: タップは透明の input が直接受ける（guard を通らない）。読み込めるのはタイトルだけ（importFromFile が route と titleBusy を見る）
    onImportFile: (f) => {
      if (overlay !== "settings" || route !== "title") return;
      closeSettings();
      importFromFile(f);
    },
    onDebug: () => guard(() => openDebug()),
    onClose: () => guard(() => closeSettings()),
  });

  // SV-42: 新しい版の案内（最前面。閉じても遊べる）
  const updateNotice = createUpdateNotice({ strings });

  stage.replaceChildren(title.el, creation.el, custom.el, play.el, settingsView.el, debug.el, banner.el, updateNotice.el);

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
      // UI-20: 察知した罠（visibleKnownTraps）は床の印。壁・階段と同じ視点で描く
      showAt: (st, at) => play.view.show(slotsFor(visibleCells(st, data, at), visibleKnownTraps(st, data, at))),
      shake: (ms) => play.shake(ms),
    },
    header: { showAt: showHeaderAt },
    message: narrator,
    party: play.party,
    battle: play.battle,
    dice: play.dice,
    screens: {
      show: (to: Screen, _st, carry) => onScreen(to, carry ?? []),
      sync: (st) => sync(st),
    },
    wipe: { show: (p) => openWipe(p) },
    penaltyTable: play.penaltyTable,
    battleEnded: () => onBattleEnded(),
    inputClosed: () => lowerInput(),
    // UI-55: イベントの再生の間は十字ボタン（迷宮の操作）を下げる。再生の最後の sync で出し直す
    eventStarted: () => play.controls.setMode("none"),
    // UI-66: 出来事と曲・効果音の対応（data/audio.json）。screen と encounter は場面の曲
    sound: (ev) => {
      for (const x of soundsFor(ev, data, soundCtx)) playOrder(x);
      soundCtx = nextSoundContext(ev, data, soundCtx);
    },
    // UI-66（2026-10-07）: 同じ拍の中で同じ効果音は 1 回だけ。再生の開始（と beat）で記録を空にする
    soundStart: () => {
      soundCtx = startSoundPlayback(soundCtx);
    },
  });

  /**
   * UI-44: コマンドを送ってから再生が終わるまでは、そのコマンドで閉じた入力の UI を出さない。
   * ヘッダーを空にし、操作領域のボタン・入力中の名前・注目の枠を下げる。cursor は変えない
   * （rejected なら runBattle の後の描き直しで戻り、受け付けられたら再生の最後の sync で作り直す）
   */
  const lowerInput = (): void => {
    play.party.setActive(null);
    clearFocus();
    play.message.hideNote(); // UI-68: 呪文の説明を下げて、前の行に戻す
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
    // UI-54: battleEnd の後はターン表示を出さない
    play.header.setTurn(null);
  };

  /**
   * core の screen イベント。route は routeOfScreen で決める（event は迷宮の画面の上の状態。UI-55）。
   * UI-47: 街を出るときは会話の箱を打ち切り、迷宮の窓の表示を空にし（どちらもログには入っている）、街に入るときは迷宮の窓で語った carry（townCarry）を会話の箱に出し直す
   */
  const onScreen = (to: Screen, carry: readonly string[] = []): void => {
    const r = to === "title" ? "title" : routeOfScreen(to);
    if (r === null) return;
    const from = route;
    if (r === "town") townPage = "menu";
    if (from === "town" && r !== "town") {
      play.talk.flush();
      // 前に街へ入ったときに窓で語った文（帰還・救済の申し出など）を迷宮の窓に残さない（ログには入っている）
      play.message.clearView();
    }
    // 画面が変わったら、キャンプ・地図・履歴を閉じる（帰還の呪文で街へ、など）
    if (route !== r) {
      if (overlay === "camp") closeCamp(false);
      if (overlay === "map") closeMap();
      if (overlay === "history") closeHistory();
    }
    if (r === "battle") {
      // 新しい戦闘。入力の段階は再生の最後の sync で battleMenu から作り直す
      cursor = null;
      advanceFrom = null;
      stopRequested = false;
      // UI-54: 遭遇の再生の間は 第1ターン（round は 0 から始まり、遭遇の直後のラウンドが 1 番目）
      play.header.setTurn(battleTurnText(strings, 1));
    }
    showRoute(r);
    if (r === "town" && from !== "town" && carry.length > 0) void play.talk.replay(carry, store.get().skipAnimations);
    // 操作は再生の最後の sync で出し直す
    if (r !== "title") play.controls.setMode("none");
  };

  /** state を描く（再生の最後に 1 回） */
  const sync = (st: GameState): void => {
    if (route !== "town" && route !== "dungeon" && route !== "battle") return;
    play.party.render(st.party);
    if (route === "battle") {
      play.setMode("battle");
      const menu = battleMenu(st, data);
      // UI-54: 次に入力・解決するラウンド（battleMenu.round + 1）。オートの再生の間はこの値のまま = 再生中のラウンド
      play.header.setTurn(menu === null ? null : battleTurnText(strings, menu.round + 1));
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
    // UI-54: 迷宮・街ではターン表示を出さない
    play.header.setTurn(null);
    if (route === "town") {
      play.setMode("town");
      // UI-52: ヘッダーに所持金（再生中は前の額のまま。ここで最終の額に描き直す）
      const menu = townMenu(st, data);
      if (menu !== null) play.header.setText(townHeader(menu, strings, townPage));
    } else {
      play.setMode("dungeon");
      const d = st.dive;
      if (d !== null) {
        showHeaderAt(st, { floor: d.floor, pos: d.pos, facing: d.facing });
        play.view.show(slotsFor(visibleCells(st, data), visibleKnownTraps(st, data)));
      }
    }
    syncControls();
  };

  const listItem = (label: string, onSelect: () => void): ControlItem => ({ label, onSelect: () => guard(onSelect) });

  /** TW-17: 確認の段（{ upConfirm }）なら core の upgradePreview の値（成功率・大成功・料金・可否）。他のページは null */
  const previewOf = (page: TownPage): UpgradePreview | null =>
    typeof page === "object" && "upConfirm" in page
      ? upgradePreview(state, data, page.upConfirm.memberId, page.upConfirm.slot, page.upConfirm.picked)
      : null;

  /** UI-52: 街のページを移る。入ったページの語り（宿・寺院・闇魔術・迷宮の入口、酒場は救済の申し出も）は再生の外で出す */
  const goTownPage = (page: TownPage): void => {
    townPage = page;
    syncControls();
    const menu = townMenu(state, data);
    if (menu === null) return;
    // UI-47: 会話の箱に 1 文ずつ語る（どの文も文字送り。2 文目からはタップで次へ。演出スキップは文字送りだけ省く）
    // 履歴の末尾 2 件と同じ語りは重ねて出さない（段を戻ってまた進んだとき。UI-52 / TW-17）
    const texts = townFreshIntro(
      [...townPageIntro(page, menu).map(t), ...upgradeConfirmLines(page, menu, previewOf(page), strings)],
      play.message.history().slice(-TOWN_INTRO_DEDUP),
    );
    const skip = store.get().skipAnimations;
    texts.forEach((x) => void narrator.say(x, skip));
  };

  /** Esc・戻る: 1 つ上のページへ（menu では何もしない） */
  const townBack = (): void => {
    const up = townParent(townPage);
    if (up === null) return;
    townPage = up;
    syncControls();
  };

  /**
   * 街の項目 → ページの移動か Command（料金・可否は core が決める。UI-35）。
   * UI-47: 一覧・戻る（と数字キー）は、先に会話の箱を打ち切ってから動く（残りの文はログに入っている）
   */
  const notReadyReason = (e: TownEntry): Pick<ControlItem, "onDisabled"> => {
    const reason = e.kind === "enter" ? e.notReady : null;
    if (reason === null) return {};
    return {
      onDisabled: () =>
        guard(() => {
          play.talk.flush();
          void narrator.say(reason, store.get().skipAnimations);
        }),
    };
  };
  const townItem = (e: TownEntry): ControlItem => ({
    label: e.label,
    // UI-66（2026-10-06）: 施設メニューから施設に入る行は ok の代わりに施設に入る音
    ...(townPage === "menu" && e.kind === "page" ? { sound: "facility" as const } : {}),
    disabled: "disabled" in e ? e.disabled : false,
    // UI-66（2026-10-07）: 戻るは位置によらず取り消しの音
    back: e.kind === "back",
    // UI-52 / TW-11（M9）: 準備中の迷宮の dim の行を押したら、会話の箱に理由の 1 文（準備中かは core の notReady）
    ...notReadyReason(e),
    onSelect: () =>
      guard(() => {
        play.talk.flush();
        switch (e.kind) {
          case "page":
            goTownPage(e.to);
            return;
          case "back":
            townBack();
            return;
          case "templeNone":
            void narrator.say(t("town.temple.none"), store.get().skipAnimations);
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
          case "look":
            // TW-13: 見回す。screen イベントは来ないので酒場のページのまま（再生の最後の sync で一覧を描き直す）
            void run({ type: "town.lookAround" });
            return;
          case "camp":
            // TW-03: 酒場の状態（キャラクター画面）・並び順・図鑑はキャンプと同じ部品で開く（戻る・やめるで酒場の一覧へ戻る）
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
          case "pick":
            goTownPage(e.to);
            return;
          case "empty":
            return;
          case "upPick":
            // TW-17: 触媒の印の付け外し。同じ段なので語りは出さない
            townPage = e.to;
            syncControls();
            return;
          case "upgrade":
            // TW-17: 送った後は部位の段に戻る（判定の箱は playback が続く語りの後でタップを 1 回待つ）。
            // UI-44（M7）: 待ちの間は所持金・一覧・戻るを出さない（再生の最後の sync で出し直す。rejected なら再生が無いのでここで描き直す）
            townPage = { upSlot: e.memberId };
            if (townLowersInput(e)) lowerInput();
            void run({ type: "town.upgrade", memberId: e.memberId, slot: e.slot, catalysts: e.catalysts }).then((r) => {
              if (r === null || r.rejected) sync(state);
            });
            return;
          // M7: 売る・買い戻す・鑑定・預ける・引き出すの後も同じページにとどまる（品が消えたページは sync の townRepair で 1 つ上へ）
          case "sell":
            void run({ type: "town.shop", action: { kind: "sell", memberId: e.memberId, instanceId: e.instanceId } });
            return;
          case "buyback":
            void run({ type: "town.shop", action: { kind: "buyback", memberId: e.memberId, instanceId: e.instanceId } });
            return;
          case "identify":
            void run({ type: "town.shop", action: { kind: "identify", memberId: e.memberId, instanceId: e.instanceId } });
            return;
          case "deposit":
            void run({ type: "town.storage", action: "deposit", memberId: e.memberId, instanceId: e.instanceId });
            return;
          case "withdraw":
            void run({ type: "town.storage", action: "withdraw", memberId: e.memberId, instanceId: e.instanceId });
            return;
        }
      }),
  });

  /** UI-55: 迷宮を歩ける状態か（core の screen が dungeon で、保留中の選択が無い。イベントの選択を待つ間・罠の察知・階段の確認では偽） */
  const fieldFree = (): boolean => state.screen === "dungeon" && state.pendingChoice === null;

  /**
   * UI-30: ステージ全体でスワイプを受けるか（迷宮で、overlay も保留も無く、inputMode が buttons でなく、自動歩行中でなく、
   * SV-42 の更新の案内が出ていない）
   */
  const swipeEnabled = (): boolean =>
    route === "dungeon" &&
    overlay === null &&
    fieldFree() &&
    store.get().inputMode !== "buttons" &&
    walking === null &&
    !updateNotice.isOpen();

  /** 操作領域とスワイプの可否を、route / overlay / pendingChoice / inputMode から決める */
  const syncControls = (): void => {
    const s = store.get();
    play.setSwipeOn(swipeEnabled());
    const c = play.controls;
    // UI-31: 十字ボタンを出さない間は長押しを離したものとする（shouldReleaseHold）
    if (shouldReleaseHold(route, overlay, !fieldFree())) repeater.release();
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
      townPage = townRepair(townPage, menu);
      const ents = townEntries(townPage, menu, strings, previewOf(townPage));
      const items = ents.map(townItem);
      // UI-52 / UI-61（M8.5）: ヘッダーは場所と所持金、ビューは施設の絵
      play.header.setText(townHeader(menu, strings, townPage));
      play.setTownPicture(townFacility(townPage));
      // UI-63（2026-10-06）: 施設の曲（無い施設と施設メニューは街の曲）
      const song = townSong(townFacility(townPage), data);
      if (song !== undefined) setScene(song);
      // UI-13: 見出し（段の問い。ログに残さない）と一覧。施設メニューも 6 行の一覧。UI-11: 末尾の戻るは一覧の外に固定する
      c.setList(items, { fixedLast: ents[ents.length - 1]?.kind === "back", town: { heading: t(townHeading(townPage)) } });
      c.setMode("list");
      return;
    }
    if (route === "battle") {
      syncBattleControls();
      return;
    }
    if (route !== "dungeon") return;
    if (overlay === "map") {
      // UI-25: 閉じると移動（選んでいないときの移動は dim）
      c.setMapGo(mapPick !== null);
      c.setMode("map");
      return;
    }
    const pc = state.pendingChoice;
    if (pc !== null) {
      // UI-66（2026-10-07）: 階段・出口・テレポーターの確認の「やめる」（STAY）は位置に関わらず cancel の音。罠の「引き返す」は対象外
      c.setList(pc.options.map((op) => ({ ...listItem(t(op.labelKey), () => void run({ type: "event.choose", optionId: op.id })), back: op.id === STAY_CHOICE_ID })));
      c.setMode("list");
      return;
    }
    // 壊れた state（screen event で保留が無い、など）でも十字ボタンを出さない守り
    if (state.screen !== "dungeon") {
      c.setMode("none");
      return;
    }
    // UI-53: [キャンプ][地図]
    // UI-66（2026-10-06）: キャンプを開く項目は ok の代わりにキャンプの音
    c.setMenu([{ ...listItem(t("dungeon.menu.camp"), () => openCamp("camp")), sound: "camp" }, listItem(t("dungeon.menu.map"), () => openMap())]);
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
    // UI-59（M10）: キャラクター画面の間はパーティ欄とメッセージ窓を隠し、判定の箱を上の層へ（パネルより先に切り替える）
    setCharacter(campCharacterOpen(campPage));
    play.header.setText(campHeader(campPage, m, strings));
    play.camp.render(campPanelView(campPage, m));
    const c = play.controls;
    const e = campEntries(campHost, campPage, m, strings);
    // UI-66（2026-10-07）: 戻る・やめる（choice の cancel）は 8 枠の中でも一覧の外でも取り消しの音
    // UI-59（M10）: 押せない項目に理由（core の値から作った reason）があれば、会話の箱を打ち切ってから理由を語る
    const item = (x: CampEntry): ControlItem => ({
      label: x.label,
      disabled: x.disabled,
      back: x.choice.kind === "cancel",
      // UI-68（M10）: peek の行は dim でも選べる（唱えられない呪文の説明を見る）
      ...(x.peek === true ? { onDisabled: () => guard(() => chooseCamp(x.choice)) } : campReason(x)),
      onSelect: () => guard(() => chooseCamp(x.choice)),
    });
    if (e.layout === "grid") {
      c.setBattleMenu(e.slots.map((x) => (x === null ? null : item(x))), "camp");
      c.setMode("battle");
    } else {
      // UI-11: 末尾のやめるは一覧の外に固定する
      c.setList(e.rows.map(item), { fixedLast: e.rows[e.rows.length - 1]?.choice.kind === "cancel" });
      c.setMode("list");
    }
  };

  /** UI-59（M10）: 押せない項目の理由を語る（理由が無ければ何もしない） */
  const campReason = (x: CampEntry): Pick<ControlItem, "onDisabled"> => {
    const reason = x.reason;
    if (reason === undefined) return {};
    return {
      onDisabled: () =>
        guard(() => {
          play.talk.flush();
          void narrator.say(reason, store.get().skipAnimations);
        }),
    };
  };

  /** UI-59（M10）: キャラクター画面の開閉を表示に反映する。閉じるとき街でなければ会話の箱を打ち切る（残りの文はログに入っている） */
  const setCharacter = (on: boolean): void => {
    if (characterOpen === on) return;
    characterOpen = on;
    if (!on && route !== "town") play.talk.flush();
    play.setCharacterOpen(on);
  };

  /** campPanel の値を描くもの（UI-59 のキャラクター画面は state の Character と campMenu の members[] から formatCharacter で作る） */
  const campPanelView = (page: CampPage, m: CampInput): CampPanelView => {
    const p = campPanel(page, m, strings);
    if (p.kind === "text") return p;
    if (p.kind === "order") {
      return {
        kind: "order",
        lines: p.rows.map((r) => ({ label: formatMessage(t("camp.order.row"), { n: r.n, name: r.name }), row: r.row, picked: r.picked })),
      };
    }
    if (p.kind === "item") {
      // UI-59（M7）: 品の詳細は core の itemDetail の値を描く（実体が消えていれば見出しだけ。sync の campRepair で段を直す）。
      // M10: キャラクター画面の下の段なので、同じ広さ（layout.character）に出す
      const d = itemDetail(state, data, p.instanceId);
      if (d === null) return { kind: "text", title: "" };
      const panel = formatItemDetail(d, strings);
      // UI-67（M10）: 装備の段の品の詳細の下に、core の equipPreview の差分（装備できない・外せないなら null で出さない）
      const pv = p.preview === undefined ? null : equipPreview(state, data, p.preview.memberId, p.preview.slot, p.preview.instanceId);
      const lines = pv === null ? panel.lines : [...panel.lines, ...formatEquipPreview(pv, strings)];
      return { kind: "lines", title: panel.title, lines, tall: true };
    }
    if (p.kind === "book") return { kind: "lines", ...formatBook(uniqueBookView(state, data), strings), tall: true }; // IT-66 / UI-11（M7）: 図鑑はビューとメッセージの領域に広げる
    const ch = state.party.find((x) => x.id === p.memberId);
    const member = m.menu.members.find((x) => x.id === p.memberId);
    if (ch === undefined || member === undefined) return { kind: "text", title: "" };
    const view = { ...(p.inventoryPage !== undefined ? { inventoryPage: p.inventoryPage } : {}), ...(p.spellPage !== undefined ? { spellPage: p.spellPage } : {}) };
    const detail = formatCharacter(ch, data, strings, (iid) => itemDisplayName(state, data, iid), memberSheet(state, data, ch), member, view);
    // UI-68（M10）: 呪文の説明の段と対象の段は、呪文の枠（行 20〜26）を core の spellInfo の説明に置き換える
    const info = p.spellInfo === undefined ? null : spellInfo(state, data, p.memberId, p.spellInfo);
    if (info !== null) {
      const [head, target, scene, description] = formatSpellInfo(info, strings);
      detail.spellNote = [head, target, scene, ...chunkDescription(description)];
    }
    return {
      kind: "character",
      detail,
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
    // UI-68（M10）: 呪文の説明は確認の段と呪文の対象の段だけ窓に出す（履歴に残さない）。それ以外の段・オート・入力なしでは前の行に戻す
    const note = menu === null || menu.auto || cursor === null ? null : spellNote(cursor);
    const info = note === null ? null : spellInfo(state, data, note.memberId, note.spellId);
    if (info === null) play.message.hideNote();
    else play.message.showNote(formatSpellInfo(info, strings));
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
    const ents = entries(menu, cur, strings);
    const items = ents.map(
      (e, i): ControlItem => ({
        label: e.label,
        disabled: e.disabled,
        // UI-66（2026-10-07）: 戻るは枠の中でも一覧の外でも取り消しの音
        back: isBackChoice(e.choice),
        onSelect: () => guard(() => chooseBattle(e.choice)),
        ...(targeting ? { onFocus: () => guard(() => focusTo(i, false)) } : {}),
      }),
    );
    if (cur.stage === "party" || cur.stage === "member") {
      c.setBattleMenu(items, cur.stage);
      c.setMode("battle");
    } else {
      // UI-11: 末尾の戻るは一覧の外に固定する（添字は変わらないので focus の末尾は戻る）
      c.setList(items, { fixedLast: ents[ents.length - 1]?.choice.kind === "back" });
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
    // UI-63: タイトルと作成の画面は core の screen が title のまま（screen イベントは来ない）
    if (r === "title" || r === "creation" || r === "custom") setSceneSong("title", [], null);
    title.el.style.display = r === "title" ? "" : "none";
    creation.el.style.display = r === "creation" ? "" : "none";
    custom.el.style.display = r === "custom" ? "" : "none";
    play.el.style.display = r === "town" || r === "dungeon" || r === "battle" ? "" : "none";
    if (r === "town" || r === "dungeon" || r === "battle") play.setMode(r);
  };

  // ---------------------------------------------------------------- コマンド
  /**
   * UI-35 / UI-44: Command を execute に送り、イベントを再生する。再生中なら捨てて null。
   * rejected（イベントがちょうど 1 件の rejected）は再生せず、console.debug に出す。
   */
  /** SV-02 / SV-41: オートセーブ（コマンドの直後と、ページが隠れたときの flush） */
  const autosaver = createAutosaver({ saves: o.saves, onStatus: (s) => onSaveStatus(s) });
  const gate = createRunGate<Command, DispatchResult, CommandExecOptions>({
    onError: (e) => console.error(e),
    // SV-02: execute → state の差し替え → 保存を await → 再生（順は createCommandExec が固定する）
    exec: createCommandExec({
      execute: (st, cmd) => execute(st, cmd, data),
      getState: () => state,
      setState: (st) => {
        state = st;
      },
      autosaver,
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
    play.message.hideNote(); // UI-68: 入力を確定したら呪文の説明を下げる（rejected なら描き直しで出し直す）
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
    if (r.announce) void narrator.say(t("save.failed"), true);
  };

  /** UI-31: 前進の長押し。1 歩ごとに再生の終わりを待ち、[moved] の後が hpChanged だけのときに続ける（canRepeat） */
  const repeater = createHoldRepeater({
    ms: () => store.get().holdRepeatMs,
    fire: () =>
      forwardStep({
        ready: () => route === "dungeon" && overlay === null && fieldFree(),
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
        ready: () => route === "dungeon" && overlay === null && fieldFree(),
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

  /** UI-25: 地図の選択を変え、枠（演出スキップでは点滅しない）と「移動」の押せる・押せないを合わせる */
  const setMapPick = (p: Pos | null): void => {
    mapPick = p;
    play.map.setPick(p, !store.get().skipAnimations);
    if (overlay === "map") syncControls();
  };

  /**
   * UI-25: 地図のタップ（探索済みのセルに吸着済み。範囲外のタップでは呼ばれない）。
   * - 選んでいるセルと同じなら歩き出す（goMapPick）。
   * - 経路（core の planRoute）が null なら題の行を「道が分からない。」にして選択を解く（地図は開いたまま）。
   * - [] （現在位置）なら何もしない（選択も変えない）。
   * - それ以外はそのセルを選んで点滅させ、題を元に戻す。
   */
  const tapMapCell = (p: Pos): void => {
    if (overlay !== "map" || walking !== null) return;
    const same = mapPick !== null && mapPick.x === p.x && mapPick.y === p.y;
    const act = mapTapAction(mapPick, p, same ? [] : planRoute(state, data, p));
    if (act === "go") goMapPick();
    else if (act === "noRoute") {
      play.map.setTitle(t("map.noRoute"));
      setMapPick(null);
    } else if (act === "pick") {
      play.map.setTitle(mapTitle);
      setMapPick({ x: p.x, y: p.y });
    }
  };

  /** UI-25: 選んだセルへ歩き出す（地図の「移動」・同じセルの再タップ・キー）。経路は引き直す。選んでいなければ何もしない */
  const goMapPick = (): void => {
    if (overlay !== "map" || walking !== null || mapPick === null) return;
    const steps = planRoute(state, data, mapPick);
    if (steps === null || steps.length === 0) return;
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
    // SV-40: ホーム画面から起動していなければ下に案内（表示のための判定）
    const hint = titleHint(isStandalone(globalThis as StandaloneEnv), strings);
    if (titleList === null) {
      title.render([], titleMessage ?? "", hint);
      return;
    }
    title.render(titleItems(titlePage, titleList, size, strings), titleMessage ?? titleNotice(titlePage, titleList, size, strings), hint);
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
    pendingImport = null;
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

  /** SV-30: gameId のレコードを書き出す（ファイルを保存させる）。結果を返すだけ（文はそれぞれの画面が出す） */
  const exportGameFile = async (gameId: string): Promise<boolean> => {
    const r = await o.saves.exportGame(gameId);
    if (!r.ok) {
      console.debug("export failed", r.reason);
      return false;
    }
    downloadText(exportFileName(r.gameId, r.exportedAt), r.text);
    return true;
  };

  /** SV-31: 計画を書いて結果を案内の欄に出し、一覧を読み直す */
  const applyImportPlan = async (plan: ImportPlan): Promise<void> => {
    pendingImport = null;
    const r = await o.saves.applyImport(plan);
    if (route !== "title") return;
    titlePage = { kind: "list" };
    await refreshTitle();
    if (route !== "title") return;
    const leader = plan.summary.leaderName;
    titleMessage = r.ok
      ? formatMessage(t(r.kind === "restore" ? "title.importRestored" : "title.importDone"), { leader })
      : t(IMPORT_FAILED[r.reason]);
    renderTitle();
  };

  /** SV-31〜33: 選んだファイルを読み込む。タイトルのときだけ（titleTask で二重の操作を捨てる） */
  const importFromFile = (file: File): void => {
    if (route !== "title" || titleBusy) return;
    titleTask(async () => {
      let text: string;
      try {
        text = await file.text();
      } catch {
        if (route !== "title") return;
        titleMessage = t("title.importReadFailed");
        renderTitle();
        return;
      }
      const c = await o.saves.prepareImport(text);
      if (route !== "title") return;
      if (!c.ok) {
        titleMessage = t(IMPORT_FAILED[c.reason]);
        renderTitle();
        return;
      }
      const plan = c.plan;
      if (plan.kind === "older" && plan.existingTurn !== null) {
        // SV-32: 既存より古いファイルは確認のページへ（先頭は「やめる」）
        pendingImport = plan;
        titlePage = { kind: "importConfirm", gameId: plan.gameId, leader: plan.summary.leaderName, turn: plan.turn, existingTurn: plan.existingTurn };
        titleMessage = null;
        renderTitle();
        return;
      }
      await applyImportPlan(plan);
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
        // SV-32: 確認のページから離れたら待っている計画を捨てる（page の遷移で importConfirm へは行かない）
        pendingImport = null;
        titlePage = st.page;
        titleMessage = null;
        renderTitle();
        return;
      case "settings":
        openSettings();
        return;
      case "newGame":
        // SV-11: 上限は押した時点の件数（読めない記録も数える）。保存先を使えないときは作成を許す
        titleTask(async () => {
          const c = await o.saves.canCreate();
          if (route !== "title") return;
          if (c === "full") {
            titleMessage = t("title.maxGames");
          } else {
            // UI-50（M5.5）: おすすめで始める / 自分で作る / やめる
            titlePage = { kind: "newMode" };
            titleMessage = null;
          }
          renderTitle();
        });
        return;
      case "quick":
        goCreation();
        return;
      case "custom":
        goCustom();
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
      case "import":
        // SV-31: キーボードの数字キーのときだけここに来る（タップは透明の input が直接受ける）
        title.openFilePicker();
        return;
      case "export":
        titleTask(async () => {
          const ok = await exportGameFile(st.gameId);
          if (route !== "title") return;
          titleMessage = t(ok ? "title.exportDone" : "title.exportFailed");
          renderTitle();
        });
        return;
      case "applyImport": {
        const plan = pendingImport;
        if (plan === null) {
          titlePage = { kind: "list" };
          renderTitle();
          return;
        }
        titleTask(() => applyImportPlan(plan));
        return;
      }
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
    // SV-41: 読み込んだ state は保存済み（続きからの直後にページが隠れても書かない）
    autosaver.markSaved(st);
    overlay = null;
    play.showMap(false);
    play.showCamp(false);
    play.showWipe(false);
    play.showHistory(false);
    // 読み込みを待つ間に F2 で開いた debug パネルも閉じる（overlay を null にするので、残すと閉じられなくなる）
    debug.el.style.display = "none";
    underDebug = null;
    // 設定画面も同じ（タイトルから開いたまま続きからに進んだときなど）
    settingsView.el.style.display = "none";
    underSettings = null;
    settingsNotice = null;
    campHost = "camp";
    campPage = { kind: "top" };
    characterOpen = false;
    play.setCharacterOpen(false);
    walking = null;
    walker.release();
    mapPick = null;
    play.map.setPick(null, false);
    townPage = "menu";
    cursor = null;
    advanceFrom = null;
    stopRequested = false;
    chaining = false;
    play.message.clear();
    // UI-47: 会話の箱も閉じる（救済の申し出は下で街なら会話の箱に出し直す）
    play.talk.clear();
    play.battle.clear();
    play.dice.hide();
    play.penaltyTable.hide();
    showRoute(plan.route);
    // UI-63 / SV-50: 保存した画面の曲（最初の操作で AudioContext を作ったときに始まる）
    setSceneSong(state.screen, state.battle?.groups.map((g) => g.monsterId) ?? [], state.dive?.dungeonId ?? null);
    sync(state);
    const instant = true;
    for (const k of plan.prompts) void narrator.say(t(k), instant);
    if (plan.route === "battle") kickBattle();
  };

  // ---------------------------------------------------------------- overlay
  const goCreation = (): void => {
    creation.reset();
    showRoute("creation");
  };

  const renderCustom = (): void => {
    custom.render(customView(customDraft, data, strings), customError);
  };

  /** UI-62: 自分で作るを最初から始める（作成中の乱数の種は crypto.getRandomValues） */
  const goCustom = (): void => {
    customRng = createRng(crypto.getRandomValues(new Uint32Array(1))[0] ?? 1);
    customDraft = initialDraft(data);
    customError = null;
    renderCustom();
    showRoute("custom");
  };

  /** UI-62: 1 つ選ぶ（何が起きるかは customStep が決める） */
  const chooseCustom = (c: CustomChoice): void => {
    if (route !== "custom") return;
    const r = customStep(customDraft, c, data, customRng);
    switch (r.kind) {
      case "draft":
        customDraft = r.draft;
        customError = null;
        renderCustom();
        return;
      case "invalidName":
        customDraft = r.draft;
        customError = formatMessage(t("creation.invalid"), { max: data.config.creation.nameMaxLength });
        renderCustom();
        return;
      case "exit":
        // タイトルの作り方の選択へ戻る
        showRoute("title");
        titlePage = { kind: "newMode" };
        renderTitle();
        return;
      case "start":
        blurActive();
        customError = null;
        renderCustom();
        void run({ type: "game.new", party: r.setup }).then((res) => {
          if (res !== null && res.rejected) {
            customError = t("custom.rejected");
            renderCustom();
          }
        });
        return;
    }
  };

  const openDebug = (): void => {
    if (overlay === "debug") return;
    if (overlay === "camp") closeCamp(false);
    if (overlay === "map") closeMap();
    if (overlay === "history") closeHistory();
    // 全滅の内訳と設定画面は閉じずに debug パネルの下に残す（閉じたら戻す。UI-57 の「開発用」）
    underDebug = overlay === "wipe" || overlay === "settings" ? overlay : null;
    repeater.release();
    overlay = "debug";
    debug.showSettings();
    debug.refresh();
    debug.el.style.display = "";
  };

  /** UI-57: 設定画面の書き出し・読み込みの可否（表示のための判定。読み込みはタイトルだけ。SV-31） */
  const settingsCtx = (): SettingsContext => {
    const where: SettingsContext["where"] = !o.saves.available ? "none" : route === "title" ? "title" : route === "town" || route === "dungeon" || route === "battle" ? "play" : "none";
    return {
      canExport: where === "play" && o.saves.current() !== null,
      canImport: where === "title",
      where,
      standalone: isStandalone(globalThis as StandaloneEnv),
    };
  };

  const renderSettings = (): void => {
    settingsView.render(settingsCtx(), settingsNotice);
  };

  /**
   * UI-57: 設定画面を開く（タイトルの「設定」とヘッダーの設定ボタン）。キャンプ・地図・履歴は閉じ、全滅の内訳は下に残す（閉じたら戻す）
   */
  const openSettings = (): void => {
    if (overlay === "settings" || overlay === "debug") return;
    if (overlay === "camp") closeCamp(false);
    if (overlay === "map") closeMap();
    if (overlay === "history") closeHistory();
    underSettings = overlay === "wipe" ? "wipe" : null;
    repeater.release();
    overlay = "settings";
    settingsNotice = null;
    renderSettings();
    settingsView.el.style.display = "";
  };

  const closeSettings = (): void => {
    if (overlay !== "settings") return;
    overlay = underSettings;
    underSettings = null;
    settingsNotice = null;
    settingsView.el.style.display = "none";
    syncControls();
  };

  /**
   * UI-57 / SV-30: 遊んでいる途中の書き出し。SV-41 の flush（進行中の保存を待ち、最新の state を保存し直す）を待ってから、
   * 保存先のレコードを書き出す。結果は設定画面の案内の欄に出す
   */
  const exportFromSettings = (): void => {
    if (overlay !== "settings" || settingsBusy) return;
    const ctx = settingsCtx();
    if (!ctx.canExport) return;
    const cur = o.saves.current();
    if (cur === null) return;
    settingsBusy = true;
    void (async () => {
      let ok = false;
      try {
        await autosaver.flush(state);
        ok = await exportGameFile(cur.gameId);
      } catch (e) {
        console.error(e);
      } finally {
        settingsBusy = false;
      }
      if (overlay !== "settings") return;
      settingsNotice = t(ok ? "settings.exportDone" : "settings.exportFailed");
      renderSettings();
    })();
  };

  /** UI-57（開発用）: debug のコマンドを送る前に、debug パネルと、その下の設定画面を閉じる（結果の再生を見えるようにする） */
  const closeDebugForCommand = (): void => {
    closeDebug();
    closeSettings();
  };

  /**
   * UI-57（開発用）: 「全員HP1」。街・迷宮・戦闘のときだけ、パネルを閉じてから debug.hpOne を送る（受け付けるかは core が決める）。
   * 全滅の流れ（UI-56）を実機で確かめるためのもの
   */
  const hpOneFromDebug = (): void => {
    if (route !== "town" && route !== "dungeon" && route !== "battle") return;
    closeDebugForCommand();
    void run({ type: "debug.hpOne" });
  };

  /**
   * UI-57（開発用、M5.5）: 「ターン+」。街・迷宮・戦闘のときだけ、パネルを閉じてから debug.addTurns を送る（受け付けるかは core が決める）。
   * 酒場のイベント（TW-14）を実機で確かめるためのもの
   */
  const addTurnsFromDebug = (): void => {
    if (route !== "town" && route !== "dungeon" && route !== "battle") return;
    closeDebugForCommand();
    void run({ type: "debug.addTurns" });
  };

  /**
   * UI-57（開発用、M7）: 「SAN+10」。街・迷宮・戦闘のときだけ、パネルを閉じてから debug.sanOver を送る（受け付けるかは core が決める）。
   * 士気中の制止判定の成功で SAN が超過分を超えて増えないことを実機で確かめるためのもの
   */
  const sanOverFromDebug = (): void => {
    if (route !== "town" && route !== "dungeon" && route !== "battle") return;
    closeDebugForCommand();
    void run({ type: "debug.sanOver" });
  };

  /**
   * UI-57（開発用、M5）: 「SAN段↓」「イベント」「罠の前」「階段前」。迷宮のときだけ、パネルを閉じてから送る
   * （受け付けるかは core が決める。選択を待つ間の debug.warp は rejected になり、何も起きない）
   */
  const debugCommand = (cmd: Command): void => {
    if (route !== "dungeon") return;
    closeDebugForCommand();
    void run(cmd);
  };

  const closeDebug = (): void => {
    if (overlay !== "debug") return;
    overlay = underDebug;
    underDebug = null;
    debug.el.style.display = "none";
    syncControls();
  };

  const openMap = (): void => {
    if (route !== "dungeon" || overlay !== null || !fieldFree()) return;
    const v = mapView(state, data);
    if (v === null) return;
    repeater.release();
    overlay = "map";
    mapPick = null;
    mapTitle = formatMessage(t("map.title"), { dungeon: dungeonName(state), floor: v.floor });
    play.map.render(v, mapTitle);
    play.showMap(true);
    syncControls();
  };

  /**
   * UI-53 / TW-03: キャンプを開く。迷宮のキャンプ（host camp）は迷宮で、酒場（host tavern）は街で、
   * 他の overlay が無く、campMenu が非 null のとき（戦闘・保留中は開かない）。open は酒場の項目（状態・並び順・図鑑）、memberId は状態で開く人（帯のタップ）
   */
  const openCamp = (host: CampHost, open?: CampOpen, memberId?: string): void => {
    if (overlay !== null) return;
    if (host === "camp" ? route !== "dungeon" : route !== "town") return;
    const menu = campMenu(state, data);
    if (menu === null) return;
    repeater.release();
    overlay = "camp";
    campHost = host;
    // UI-13（M8.5）: 帯のタップはその人のキャラクター画面から（戻るで元の街のページへ）
    campPage = campFirstPage(host, open, menu, memberId);
    play.showCamp(true);
    // UI-63（2026-10-06）: 迷宮のキャンプの間はキャンプの曲（酒場のキャンプでは変えない）。場面の曲（sceneSongName）は変えない
    if (host === "camp") audio?.setSong(campSong(data));
    syncControls();
  };

  /** キャンプを閉じ、ヘッダーを迷宮か街の表示に戻す（resync が偽なら操作領域は描き直さない） */
  const closeCamp = (resync: boolean): void => {
    if (overlay !== "camp") return;
    overlay = null;
    campPage = { kind: "top" };
    setCharacter(false);
    play.showCamp(false);
    // UI-63: 迷宮のキャンプを閉じたら場面の曲（迷宮の曲。キャンプの間に場面が変わっていればその曲）に戻す
    if (campHost === "camp") audio?.setSong(sceneSongName);
    const d = state.dive;
    if (route === "town") {
      const menu = townMenu(state, data);
      if (menu !== null) play.header.setText(townHeader(menu, strings, townPage));
    } else if (d !== null) showHeaderAt(state, { floor: d.floor, pos: d.pos, facing: d.facing });
    if (resync) syncControls();
  };

  const closeMap = (): void => {
    if (overlay !== "map") return;
    overlay = null;
    // UI-25: 閉じると選択は消える
    mapPick = null;
    play.map.setPick(null, false);
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
  /**
   * UI-66: キーの back で実際に何かを閉じた・戻った（route・overlay・街のページ・キャンプの段・戦闘の入力の段階が変わった）ときだけ取り消しの音。
   * 操作領域のボタンを選んだ（controls が鳴らした）ときは二重に鳴らさない。タイトル・作成・設定画面・debug パネルは対象外
   */
  const handleAction = (a: Action): void => {
    const watch = a === "back" && audio !== null && (route === "town" || route === "dungeon" || route === "battle") && overlay !== "settings" && overlay !== "debug";
    const sig = (): string => JSON.stringify([route, overlay, townPage, campPage, cursor]);
    const before = watch ? sig() : "";
    const n = uiSounds;
    handleActionCore(a);
    if (watch && uiSounds === n && sig() !== before) playUi("cancel");
  };

  const handleActionCore = (a: Action): void => {
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
    if (overlay === "settings") {
      // UI-33: 数字 n → n 番目の項目（dim は無視）、Esc / Enter → 閉じる。F2 は上の debug のトグル
      const k = settingsKeyIndex(a, settingsItems(settingsCtx()));
      if (k !== null) settingsView.select(k);
      return;
    }
    if (overlay === "map") {
      // UI-33: Esc / m / 1 で閉じる、2 で移動、Enter は選んでいれば移動・いなければ閉じる
      if (a === "confirm") {
        if (mapPick !== null) goMapPick();
        else closeMap();
      } else if (typeof a === "object" && a.menu === 1) goMapPick();
      else if (a === "back" || a === "map" || (typeof a === "object" && a.menu === 0)) closeMap();
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
      // UI-47: 街（酒場）のキャンプとキャラクター画面（UI-59。M10。迷宮でも）の上に会話の箱が見えている間は、Enter / Space は箱のタップ（次へ・閉じる）
      if (a === "confirm" && (route === "town" || characterOpen) && play.talk.isOpen()) {
        play.talk.tap();
        return;
      }
      // UI-33: 数字 n → n 番目の枠・行（空き枠は無視）、Enter → 先頭の押せる項目、Esc → やめる（top では戻る）
      const m = campInput();
      if (m === null) return;
      // UI-59（M10）: キャラクター画面の ← / → は前後の人
      if (a === "left" || a === "right") {
        const next = campCycle(campPage, m, a === "right" ? 1 : -1);
        if (next !== null) {
          campPage = next;
          syncControls();
        }
        return;
      }
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
      case "custom": {
        // UI-33 / UI-62: 数字 n → n 番目の行、Enter → 先頭の選べる行（能力値は 次へ、名前は今の入力で次へ、確認は 始める）、Esc → 戻る
        const ch = customKeyChoice(a, customView(customDraft, data, strings), customDraft.step, custom.nameValue());
        if (ch !== null) chooseCustom(ch);
        return;
      }
      case "town":
        // UI-33 / UI-47: Enter は会話の箱が開いていれば箱のタップ（次へ・閉じる）、閉じていれば先頭。
        // 数字は n 番目の行（townItem が会話を打ち切る）、Esc は会話を打ち切ってから 1 つ上
        if (a === "confirm") {
          if (play.talk.isOpen()) play.talk.tap();
          else play.controls.select(0);
        } else if (typeof a === "object") play.controls.select(a.menu);
        else if (a === "back") {
          play.talk.flush();
          townBack();
        }
        return;
      case "dungeon": {
        if (!fieldFree()) {
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

  /**
   * UI-47: 再生の外の会話の箱・施設の絵のタップ（再生中のタップはステージが player.tap() に回す）。
   * 文字送り中なら即表示、タップ待ちなら次の文、最後の文なら閉じる。キャンプ（酒場）は箱がパネルの上に描かれるので受ける。
   * それ以外の overlay（履歴・設定など）があるときは何もしない
   */
  const tapTalk = (): void => {
    if (isBusy() || chaining) return;
    // UI-59（M10）: キャラクター画面の間は迷宮でも箱に語る
    if ((route !== "town" && !characterOpen) || (overlay !== null && overlay !== "camp")) return;
    play.talk.tap();
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
      settingsView.el.style.display = "none";
      // UI-63: タイトルの曲は showRoute が求める（最初の操作で AudioContext を作ったときに始まる）
      showRoute("title");
      onTap(play.message.el, () => tapMessage());
      // UI-47: 街の会話の箱と施設の絵のタップで会話を進める
      onTap(play.talk.el, () => tapTalk());
      onTap(play.picture, () => tapTalk());
      // UI-57: ポインタの記録（capture なので attachStageInput の処理より先に走る）。debug パネルを開いている間は記録しない
      attachPointerLog(stage, { log: pointerLog, scale, now: () => performance.now(), enabled: () => overlay !== "debug" });
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
      // SV-41: ページが隠れたら、進行中の保存を待ってから最新の state を保存し直す（保存済みなら書かない）。遊んでいる間だけ
      attachSaveOnHide(document, window, () => {
        if (route !== "town" && route !== "dungeon" && route !== "battle") return;
        void autosaver.flush(state).then((r) => console.debug("autosave: flush", r));
      });
      store.subscribe(() => {
        // UI-57（M8）: 音量の段の変化を再生機に知らせる（GainNode の値。0 なら止め、0 から上げたら場面の曲を頭から）
        audio?.refreshVolumes();
        debug.refresh();
        settingsView.refresh();
        if (!isBusy()) syncControls();
      });
    },
    showUpdate(apply: () => void): void {
      updateNotice.show(apply);
    },
  };
}
