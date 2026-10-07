// エントリポイント。データを読み込んで検証し、不正なら起動を止める（CLAUDE.md §3-5）。
// 起動順: load → fonts.load → applyPalette → 設定の store → IndexedDB を開く → セーブのサービス → createApp → mountStage → app.start → Service Worker（SV-42）。
// IndexedDB を開けなくても起動は続ける（SV-23: 保存できない旨の帯を出し続ける）。
import "./presenter/style.css";
import config from "../data/config.json";
import races from "../data/races.json";
import classes from "../data/classes.json";
import spells from "../data/spells.json";
import monsters from "../data/monsters.json";
import unknownKinds from "../data/unknown-kinds.json";
import items from "../data/items.json";
import equipmentBases from "../data/equipment-bases.json";
import itemOptions from "../data/item-options.json";
import uniques from "../data/uniques.json";
import drops from "../data/drops.json";
import personalities from "../data/personalities.json";
import penaltyTable from "../data/penalty-table.json";
import dungeons from "../data/dungeons.json";
import events from "../data/events.json";
import tavern from "../data/tavern.json";
import chestTraps from "../data/chest-traps.json";
import rivalries from "../data/rivalries.json";
import strings from "../data/strings.json";
import wavetables from "../data/wavetables.json";
import audio from "../data/audio.json";
// UI-63 / UI-65 / UI-60（M8）: ビルド時に検証した曲・効果音・絵の一覧（vite.config.ts の wizlike-assets）
import assets from "virtual:wizlike-assets";
import { GameDataError, loadGameData, type GameData, type RawGameData } from "./core/data";
import { mountStage } from "./presenter/stage";
import { createApp } from "./presenter/app";
import { applyPalette } from "./presenter/palette";
import { attachAudio, createAudioPlayer, createMessageChannelYield, createWorkerRenderer } from "./presenter/audio";
import { createSettingsStore, loadSettings, saveSettings } from "./presenter/settings";
import { renderDataError, STARTUP_ERROR_HEADING } from "./presenter/views/data-error";
import { openIdbBackend } from "./save/db";
import { newGameId } from "./save/id";
import { createMigrations } from "./save/migrate";
import { createSaveService } from "./save/saves";
import { setupServiceWorker } from "./pwa/register";

// style.css の @font-face と同じ名前。
const FONT_FAMILY = "Misaki";

const raw: RawGameData = {
  config,
  races,
  classes,
  spells,
  monsters,
  unknownKinds,
  items,
  equipmentBases,
  itemOptions,
  uniques,
  drops,
  personalities,
  penaltyTable,
  dungeons,
  events,
  tavern,
  chestTraps,
  rivalries,
  strings,
  wavetables,
  audio,
};

function fail(e: unknown): never {
  const issues =
    e instanceof GameDataError ? e.issues : [e instanceof Error ? `${e.name}: ${e.message}` : String(e)];
  console.error(issues.join("\n"));
  renderDataError(document.body, issues);
  throw e;
}

/** load より後の起動時の例外。データ検証とは別の見出しでエラー画面に出す。 */
function failStartup(e: unknown): void {
  console.error(e);
  renderDataError(document.body, [e instanceof Error ? `${e.name}: ${e.message}` : String(e)], STARTUP_ERROR_HEADING);
}

let loadFailed = false;

function load(): GameData {
  try {
    return loadGameData(raw);
  } catch (e) {
    loadFailed = true;
    return fail(e);
  }
}

async function start(): Promise<void> {
  const data = load();
  const stageEl = document.getElementById("stage");
  if (!stageEl) throw new Error("#stage not found");

  // フォントが読めなくても起動は続ける（見本がフォールバックで出るので実機確認で気付ける）。
  try {
    await document.fonts.load(`8px "${FONT_FAMILY}"`);
  } catch (e) {
    console.warn(e);
  }

  applyPalette(document.documentElement);
  const settings = createSettingsStore(loadSettings(data.config), saveSettings);
  // SV-20 / SV-23: プライベートブラウズなどで開けなければ backend なし（全操作が失敗を返す）で続ける。
  const backend = await openIdbBackend(globalThis.indexedDB).catch((e: unknown) => {
    console.warn(e);
    return null;
  });
  const saves = createSaveService({
    backend,
    now: () => Date.now(),
    newId: () => newGameId(globalThis.crypto),
    schemaVersion: data.config.save.schemaVersion,
    maxGames: data.config.save.maxGames,
    // SV-04 / IT-80: v3 → v4 の移行で progress.shopLevel を dungeons[].onClear.shopLevel から計算する
    migrations: createMigrations(data.dungeons),
  });
  // UI-06 / UI-63 / UI-65: 音の再生機。AudioContext は最初のユーザー操作で作る（attachAudio）。
  // ZzFX は評価時に AudioContext を作るので、静的に import せず、再生機が unlock の後に動的 import する。
  const audioPlayer = createAudioPlayer({
    createContext: () => (typeof AudioContext === "function" ? new AudioContext() : null),
    loadZzfx: () => import("./vendor/zzfx-1.3.2/ZzFX.js"),
    data,
    assets,
    // UI-57: 設定画面の音量の段（0〜10。既定は config.ui.musicVolume / sfxVolume）。変わったら app が refreshVolumes を呼ぶ
    volumes: () => ({ music: settings.get().musicVolume, sfx: settings.get().sfxVolume }),
    // UI-63（M9.5）: 曲は区間ごとに Web Worker で合成し（worker はここ＝読み込み時に起動する。作れなければ主スレッド）、先読みは 1 区間ごとに MessageChannel でイベントループへ戻す
    renderer: createWorkerRenderer(() => new Worker(new URL("./presenter/synth.worker.ts", import.meta.url), { type: "module" })),
    yieldTask: createMessageChannelYield(),
  });
  attachAudio(document, audioPlayer);
  // mountStage は同期で 1 回 onLayout を呼ぶので、app を先に作る。
  const app = createApp({ stage: stageEl, data, settings, saves, assets, audio: audioPlayer });
  mountStage(stageEl, data.config.stage, app.onLayout);
  app.start();
  // SV-42: 本番ビルドでだけ Service Worker を登録する（開発では残っている登録を解除する）。失敗しても起動は止めない。
  // 新しい版が待機に入ったら案内を出し、「読み込み直す」で有効にして読み込み直す。
  void setupServiceWorker({
    prod: import.meta.env.PROD,
    base: import.meta.env.BASE_URL,
    container: navigator.serviceWorker,
    onUpdate: (apply) => app.showUpdate(apply),
    reload: () => location.reload(),
  }).then((r) => console.debug("sw:", r));
}

// load 内の失敗は fail が描画済み（再 throw されてここに来る）なので二重に描かない。
// それ以外の起動時の例外も、黒い画面のまま止まらないようにエラー画面に出す。
start().catch((e: unknown) => {
  if (!loadFailed) failStartup(e);
});
