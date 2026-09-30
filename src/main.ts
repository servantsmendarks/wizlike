// エントリポイント。データを読み込んで検証し、不正なら起動を止める（CLAUDE.md §3-5）。
// M0 ではステージの実機確認画面を出すだけ。
import "./presenter/style.css";
import config from "../data/config.json";
import races from "../data/races.json";
import classes from "../data/classes.json";
import spells from "../data/spells.json";
import monsters from "../data/monsters.json";
import items from "../data/items.json";
import personalities from "../data/personalities.json";
import penaltyTable from "../data/penalty-table.json";
import dungeons from "../data/dungeons.json";
import events from "../data/events.json";
import strings from "../data/strings.json";
import { GameDataError, loadGameData, type GameData, type RawGameData } from "./core/data";
import { mountStage } from "./presenter/stage";
import { renderStageCheck } from "./presenter/views/stage-check";
import { renderDataError, STARTUP_ERROR_HEADING } from "./presenter/views/data-error";

// style.css の @font-face と同じ名前。
const FONT_FAMILY = "Misaki";

const raw: RawGameData = {
  config,
  races,
  classes,
  spells,
  monsters,
  items,
  personalities,
  penaltyTable,
  dungeons,
  events,
  strings,
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

  // mountStage は同期で 1 回 onLayout を呼ぶので、確認画面を先に作る。
  const check = renderStageCheck(stageEl, data.strings);
  mountStage(stageEl, data.config.stage, (layout, input) => check.update(layout, input));
}

// load 内の失敗は fail が描画済み（再 throw されてここに来る）なので二重に描かない。
// それ以外の起動時の例外も、黒い画面のまま止まらないようにエラー画面に出す。
start().catch((e: unknown) => {
  if (!loadFailed) failStartup(e);
});
