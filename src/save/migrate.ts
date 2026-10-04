// SV-04: schemaVersion の移行（純粋）。MIGRATIONS[i] は版 i+1 → i+2。
// 長さは config.save.schemaVersion − 1（テストで固定）。移行したレコードは書き戻さず、次のオートセーブで上書きする。
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

export const MIGRATIONS: readonly Migration[] = [migrateV1toV2, migrateV2toV3];

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

/**
 * GameState の最小限の形の検査（深い検証はしない）。
 * screen は town / dungeon / battle / event、party は 1 件以上の配列、rng / items はオブジェクト、gold は数、
 * dive / pendingChoice / battle / townVisit はオブジェクトか null、screen battle ⇔ battle 非 null、screen town ⇔ townVisit 非 null。
 * screen event（M5。イベントの選択を待つ間）⇒ dive がオブジェクト・battle が null・pendingChoice の kind が event で eventId が文字列、
 * pendingChoice の kind が event ⇒ screen event（M5 は欄を足さず値の種類を増やしただけなので schemaVersion 1 のままだった）。
 * schemaVersion 2（M5.5）: adventureTurns と tavernEventMark が 0 以上の安全な整数、dive がオブジェクトなら knownTraps がプレーンなオブジェクト。
 * schemaVersion 3（M7 の A）: morale は null か、rankId が文字列のプレーンなオブジェクト。
 */
export function isGameStateShape(x: unknown): x is GameState {
  if (!isPlainObject(x)) return false;
  if (!RESUMABLE_SCREENS.includes(x["screen"])) return false;
  const party = x["party"];
  if (!Array.isArray(party) || party.length === 0) return false;
  if (!isPlainObject(x["rng"]) || !isPlainObject(x["items"])) return false;
  if (typeof x["gold"] !== "number") return false;
  for (const k of ["dive", "pendingChoice", "battle", "townVisit"]) {
    if (!isObjectOrNull(x[k])) return false;
  }
  if (!isTurnCount(x["adventureTurns"]) || !isTurnCount(x["tavernEventMark"])) return false;
  const dive = x["dive"];
  if (isPlainObject(dive) && !isPlainObject(dive["knownTraps"])) return false;
  if (!isMoraleShape(x["morale"])) return false;
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
