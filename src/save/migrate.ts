// SV-04: schemaVersion の移行（純粋）。MIGRATIONS[i] は版 i+1 → i+2。
// 長さは config.save.schemaVersion − 1（テストで固定）。移行したレコードは書き戻さず、次のオートセーブで上書きする。
import type { GameState } from "../core/types";
import { isPlainObject } from "./record";
import type { MigrateResult, Migration } from "./types";

export const MIGRATIONS: readonly Migration[] = [];

const RESUMABLE_SCREENS: readonly unknown[] = ["town", "dungeon", "battle"];

function isObjectOrNull(x: unknown): boolean {
  return x === null || isPlainObject(x);
}

/**
 * GameState の最小限の形の検査（深い検証はしない）。
 * screen は town / dungeon / battle、party は 1 件以上の配列、rng / items はオブジェクト、gold は数、
 * dive / pendingChoice / battle / townVisit はオブジェクトか null、screen battle ⇔ battle 非 null、screen town ⇔ townVisit 非 null。
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
  if ((x["screen"] === "battle") !== (x["battle"] !== null)) return false;
  if ((x["screen"] === "town") !== (x["townVisit"] !== null)) return false;
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
