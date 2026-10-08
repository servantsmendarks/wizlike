// SV-04: schemaVersion の移行（純粋）。MIGRATIONS[i] は版 i+1 → i+2。
// 長さは config.save.schemaVersion − 1（テストで固定）。移行したレコードは書き戻さず、次のオートセーブで上書きする。
import type { DungeonDef } from "../core/data";
import type { GameState } from "../core/types";
import { isPlainObject } from "./record";
import type { MigrateResult, Migration } from "./types";

/**
 * SV-04 v1 → v2（M5.5）: adventureTurns 0・tavernEventMark 0 を足し、dive がオブジェクトなら knownTraps {} を足す。
 * 引数は書き換えない（浅い複製。dive も複製する）。オブジェクトでなければそのまま返す（形の検査で broken）
 */
export function migrateV1toV2(x: unknown): unknown {
  if (!isPlainObject(x)) return x;
  const out: Record<string, unknown> = { ...x, adventureTurns: 0, tavernEventMark: 0 };
  const dive = x["dive"];
  if (isPlainObject(dive)) out["dive"] = { ...dive, knownTraps: {} };
  return out;
}

/**
 * SV-04 v2 → v3（M7 の A）: morale null を足す（TW-15。士気の無い状態）。引数は書き換えない（浅い複製）。
 * オブジェクトでなければそのまま返す（形の検査で broken）
 */
export function migrateV2toV3(x: unknown): unknown {
  if (!isPlainObject(x)) return x;
  return { ...x, morale: null };
}

/** IT-80: ダンジョン id → 初回クリアで上がる流通レベル（dungeons[].onClear.shopLevel）。v3 → v4 の progress.shopLevel の計算に使う */
export type ShopLevelTable = Readonly<Record<string, number>>;

const V4_ITEM_DEFAULTS = { level: 0, rarity: "normal", options: [], uniqueId: null, cursed: false, foundIn: null } as const;

/**
 * SV-04 v3 → v4（M7 の B。IT-80）: 各アイテム実体に level 0・rarity normal・options []・uniqueId null・cursed false・foundIn null を足し
 * （identified は今の値のまま。v3 までの遊びに呪われた品を手に入れる経路は無い）、warehouse []・buyback []・uniqueBook {} を足し、
 * progress.shopLevel を clearedDungeons の各 shopLevels の最大（無ければ 0。表に無い id は 0）にする。
 * 引数は書き換えない（浅い複製。items の各実体と progress も複製する）。オブジェクトでなければそのまま返す（形の検査で broken）
 */
export function migrateV3toV4(x: unknown, shopLevels: ShopLevelTable = {}): unknown {
  if (!isPlainObject(x)) return x;
  const out: Record<string, unknown> = { ...x, warehouse: [], buyback: [], uniqueBook: {} };
  const items = x["items"];
  if (isPlainObject(items)) {
    out["items"] = Object.fromEntries(
      Object.entries(items).map(([k, inst]) => [k, isPlainObject(inst) ? { ...inst, ...V4_ITEM_DEFAULTS, options: [] } : inst]),
    );
  }
  const progress = x["progress"];
  if (isPlainObject(progress)) {
    const cleared = progress["clearedDungeons"];
    let shopLevel = 0;
    if (Array.isArray(cleared)) {
      for (const id of cleared) {
        if (typeof id !== "string" || !Object.prototype.hasOwnProperty.call(shopLevels, id)) continue;
        shopLevel = Math.max(shopLevel, shopLevels[id] ?? 0);
      }
    }
    out["progress"] = { ...progress, shopLevel };
  }
  return out;
}

/**
 * SV-04 v4 → v5（M10。CH-63）: party の各人の maxLevelReached（数）を、今の職業の記録 { [classId]: n } にする。
 * 全体の最高到達レベル（U5）は記録の最大なので、移行の後も n のまま。数でない maxLevelReached と classId が文字列でない人はそのまま（形の検査で broken）。
 * 引数は書き換えない（浅い複製。party と各人も複製する）。オブジェクトでなければそのまま返す（形の検査で broken）
 */
export function migrateV4toV5(x: unknown): unknown {
  if (!isPlainObject(x)) return x;
  const party = x["party"];
  if (!Array.isArray(party)) return { ...x };
  return {
    ...x,
    party: party.map((ch: unknown) => {
      if (!isPlainObject(ch)) return ch;
      const n = ch["maxLevelReached"];
      const classId = ch["classId"];
      if (typeof n !== "number" || typeof classId !== "string") return { ...ch };
      return { ...ch, maxLevelReached: { [classId]: n } };
    }),
  };
}

/**
 * SV-04 v5 → v6（M11。CB-60）: dive がオブジェクトなら chest null と disarmedChests [] を足す（宝箱の保留なし）。
 * 引数は書き換えない（浅い複製。dive も複製する）。オブジェクトでなければそのまま返す（形の検査で broken）
 */
export function migrateV5toV6(x: unknown): unknown {
  if (!isPlainObject(x)) return x;
  const out: Record<string, unknown> = { ...x };
  const dive = x["dive"];
  if (isPlainObject(dive)) out["dive"] = { ...dive, chest: null, disarmedChests: [] };
  return out;
}

/**
 * 移行関数の列（MIGRATIONS[i] は版 i+1 → i+2）。v3 → v4 の流通レベルは dungeons の onClear.shopLevel から計算する（IT-80）。
 * アプリ（main.ts）は検証済みの data.dungeons を渡して SaveDeps.migrations にする
 */
export function createMigrations(dungeons: readonly Pick<DungeonDef, "id" | "onClear">[]): readonly Migration[] {
  const table: ShopLevelTable = Object.fromEntries(dungeons.map((d) => [d.id, d.onClear.shopLevel]));
  return [migrateV1toV2, migrateV2toV3, (x) => migrateV3toV4(x, table), migrateV4toV5, migrateV5toV6];
}

/** 既定の移行関数の列（流通レベルの表が空なので v3 → v4 の shopLevel は 0）。アプリは createMigrations(data.dungeons) を使う */
export const MIGRATIONS: readonly Migration[] = createMigrations([]);

const RESUMABLE_SCREENS: readonly unknown[] = ["town", "dungeon", "battle", "event"];

function isObjectOrNull(x: unknown): boolean {
  return x === null || isPlainObject(x);
}

function isMoraleShape(x: unknown): boolean {
  return x === null || (isPlainObject(x) && typeof x["rankId"] === "string");
}

function isTurnCount(x: unknown): boolean {
  return typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
}

const RARITIES: readonly unknown[] = ["normal", "fine", "rare", "legendary"];

function isStringOrNull(x: unknown): boolean {
  return x === null || typeof x === "string";
}

function isStringArray(x: unknown): boolean {
  return Array.isArray(x) && x.every((e) => typeof e === "string");
}

/** IT-33: { optionId: 文字列, tier: 1..3, value: 整数（符号付き） } */
function isOptionRollShape(x: unknown): boolean {
  return (
    isPlainObject(x) &&
    typeof x["optionId"] === "string" &&
    (x["tier"] === 1 || x["tier"] === 2 || x["tier"] === 3) &&
    typeof x["value"] === "number" &&
    Number.isSafeInteger(x["value"])
  );
}

/** IT-10（schemaVersion 4）: アイテム実体の欄の型 */
function isItemInstanceShape(x: unknown): boolean {
  return (
    isPlainObject(x) &&
    typeof x["id"] === "string" &&
    typeof x["itemId"] === "string" &&
    isTurnCount(x["level"]) &&
    RARITIES.includes(x["rarity"]) &&
    Array.isArray(x["options"]) &&
    x["options"].every(isOptionRollShape) &&
    isStringOrNull(x["uniqueId"]) &&
    typeof x["identified"] === "boolean" &&
    typeof x["cursed"] === "boolean" &&
    isStringOrNull(x["foundIn"])
  );
}

/** IT-66（schemaVersion 4）: uniqueBook の 1 件 { foundIn: 文字列か null, bestRarity: 希少度 } */
function isUniqueBookEntryShape(x: unknown): boolean {
  return isPlainObject(x) && isStringOrNull(x["foundIn"]) && RARITIES.includes(x["bestRarity"]);
}

/** CH-63（schemaVersion 5）: classId が文字列で、maxLevelReached がプレーンなオブジェクト、各値が 1 以上の安全な整数、今の職業の欄がある */
function isCharacterShape(x: unknown): boolean {
  if (!isPlainObject(x) || typeof x["classId"] !== "string") return false;
  const m = x["maxLevelReached"];
  if (!isPlainObject(m)) return false;
  if (!Object.values(m).every((v) => typeof v === "number" && Number.isSafeInteger(v) && v >= 1)) return false;
  return Object.prototype.hasOwnProperty.call(m, x["classId"]);
}

function isCellRefShape(x: unknown): boolean {
  return isPlainObject(x) && [x["floor"], x["x"], x["y"]].every(isTurnCount);
}

/**
 * CB-60（schemaVersion 6）: dive.chest は null か ChestState の形（source drop / cell、cell は CellRef か null で source cell なら CellRef、
 * inRoom 真偽、trapId 文字列か null、danger / level 0 以上の整数、finding は null か { trapId: 文字列か null }、rivalry は null か { id, ownerId } の文字列）
 */
function isChestShape(x: unknown): boolean {
  if (x === null) return true;
  if (!isPlainObject(x)) return false;
  if (x["source"] !== "drop" && x["source"] !== "cell") return false;
  if (x["cell"] !== null && !isCellRefShape(x["cell"])) return false;
  if (x["source"] === "cell" && x["cell"] === null) return false;
  if (typeof x["inRoom"] !== "boolean" || !isStringOrNull(x["trapId"])) return false;
  if (!isTurnCount(x["danger"]) || !isTurnCount(x["level"])) return false;
  const f = x["finding"];
  if (f !== null && !(isPlainObject(f) && isStringOrNull(f["trapId"]))) return false;
  const r = x["rivalry"];
  if (r !== null && !(isPlainObject(r) && typeof r["id"] === "string" && typeof r["ownerId"] === "string")) return false;
  // 同じ版に後から足した省略可能な欄（U-7 (b)）: rivalryFails は無いか 0 以上の整数
  if (x["rivalryFails"] !== undefined && !isTurnCount(x["rivalryFails"])) return false;
  return true;
}

/**
 * GameState の最小限の形の検査（深い検証はしない）。
 * screen は town / dungeon / battle / event、party は 1 件以上の配列、rng / items はオブジェクト、gold は数、
 * dive / pendingChoice / battle / townVisit はオブジェクトか null、screen battle ⇔ battle 非 null、screen town ⇔ townVisit 非 null。
 * screen event（M5。イベントの選択を待つ間）⇒ dive がオブジェクト・battle が null・pendingChoice の kind が event で eventId が文字列、
 * pendingChoice の kind が event ⇒ screen event（M5 は欄を足さず値の種類を増やしただけなので schemaVersion 1 のままだった）。
 * schemaVersion 2（M5.5）: adventureTurns と tavernEventMark が 0 以上の安全な整数、dive がオブジェクトなら knownTraps がプレーンなオブジェクト。
 * schemaVersion 3（M7 の A）: morale は null か、rankId が文字列のプレーンなオブジェクト。
 * schemaVersion 4（M7 の B。IT-80）: items の各実体の欄の型（isItemInstanceShape）、warehouse / buyback は文字列の配列、
 * uniqueBook は各値が { foundIn, bestRarity } のプレーンなオブジェクト、progress はプレーンなオブジェクトで shopLevel が 0 以上の安全な整数。
 * schemaVersion 5（M10。CH-63）: party の各要素の classId が文字列、maxLevelReached がプレーンなオブジェクトで各値が 1 以上の安全な整数、
 * 今の職業の欄がある（isCharacterShape。Character の欄の最初の検査）。
 * schemaVersion 6（M11。CB-60）: dive がオブジェクトなら chest が null か ChestState の形（isChestShape）、disarmedChests が CellRef の配列。
 * dive.chest が非 null なら pendingChoice は null。
 * 同じ版に後から足した省略可能な欄（M11。D-2 / U-7）: dive.judgedChests は無いか CellRef の配列、dive.chest.rivalryFails は無いか 0 以上の整数。
 */
export function isGameStateShape(x: unknown): x is GameState {
  if (!isPlainObject(x)) return false;
  if (!RESUMABLE_SCREENS.includes(x["screen"])) return false;
  const party = x["party"];
  if (!Array.isArray(party) || party.length === 0) return false;
  if (!party.every(isCharacterShape)) return false;
  if (!isPlainObject(x["rng"]) || !isPlainObject(x["items"])) return false;
  if (typeof x["gold"] !== "number") return false;
  for (const k of ["dive", "pendingChoice", "battle", "townVisit"]) {
    if (!isObjectOrNull(x[k])) return false;
  }
  if (!isTurnCount(x["adventureTurns"]) || !isTurnCount(x["tavernEventMark"])) return false;
  const dive = x["dive"];
  if (isPlainObject(dive) && !isPlainObject(dive["knownTraps"])) return false;
  if (isPlainObject(dive)) {
    if (!isChestShape(dive["chest"])) return false;
    const dc = dive["disarmedChests"];
    if (!Array.isArray(dc) || !dc.every(isCellRefShape)) return false;
    const jc = dive["judgedChests"];
    if (jc !== undefined && !(Array.isArray(jc) && jc.every(isCellRefShape))) return false;
    if (dive["chest"] !== null && x["pendingChoice"] !== null) return false;
  }
  if (!isMoraleShape(x["morale"])) return false;
  if (!Object.values(x["items"] as Record<string, unknown>).every(isItemInstanceShape)) return false;
  if (!isStringArray(x["warehouse"]) || !isStringArray(x["buyback"])) return false;
  const book = x["uniqueBook"];
  if (!isPlainObject(book) || !Object.values(book).every(isUniqueBookEntryShape)) return false;
  const progress = x["progress"];
  if (!isPlainObject(progress) || !isTurnCount(progress["shopLevel"])) return false;
  if ((x["screen"] === "battle") !== (x["battle"] !== null)) return false;
  if ((x["screen"] === "town") !== (x["townVisit"] !== null)) return false;
  const pc = x["pendingChoice"];
  const eventChoice = isPlainObject(pc) && pc["kind"] === "event";
  if ((x["screen"] === "event") !== eventChoice) return false;
  if (eventChoice) {
    if (!isPlainObject(x["dive"]) || x["battle"] !== null) return false;
    if (typeof (pc as Record<string, unknown>)["eventId"] !== "string") return false;
  }
  return true;
}

/** fromVersion の state を current まで順に移行し、形を検査する */
export function migrateState(
  state: unknown,
  fromVersion: unknown,
  current: number,
  migrations: readonly Migration[] = MIGRATIONS,
): MigrateResult {
  if (typeof fromVersion !== "number" || !Number.isInteger(fromVersion) || fromVersion < 1) {
    return { ok: false, reason: "broken" };
  }
  if (fromVersion > current) return { ok: false, reason: "tooNew" };
  let s = state;
  for (let v = fromVersion; v < current; v++) {
    const m = migrations[v - 1];
    if (m === undefined) return { ok: false, reason: "broken" };
    try {
      s = m(s);
    } catch {
      return { ok: false, reason: "broken" };
    }
  }
  if (!isGameStateShape(s)) return { ok: false, reason: "broken" };
  return { ok: true, state: s, fromVersion };
}
