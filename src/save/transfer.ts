// SV-30 / SV-33: 書き出しファイルの組み立てと読み込むファイルの検査（純粋。DOM・時計に触れない）。
import type { GameState } from "../core/types";
import { migrateState, MIGRATIONS } from "./migrate";
import { isPlainObject } from "./record";
import { sha256Hex } from "./sha256";
import type { Migration } from "./types";

export const EXPORT_FORMAT = "wizlike-save";

/** SV-30。欄の順はこの順で JSON にする */
export type ExportFile = {
  format: typeof EXPORT_FORMAT;
  gameId: string;
  schemaVersion: number;
  turn: number;
  exportedAt: number;
  state: GameState;
  checksum: string;
};

/** SV-30: checksum = sha256Hex(JSON.stringify(state)) */
export function stateChecksum(state: unknown): string {
  return sha256Hex(JSON.stringify(state));
}

/** SV-30: ファイルの中身を組む（state は複製しない） */
export function buildExportFile(
  x: { gameId: string; schemaVersion: number; turn: number; state: GameState },
  exportedAt: number,
): ExportFile {
  return {
    format: EXPORT_FORMAT,
    gameId: x.gameId,
    schemaVersion: x.schemaVersion,
    turn: x.turn,
    exportedAt,
    state: x.state,
    checksum: stateChecksum(x.state),
  };
}

/** SV-30: 欄の順を固定した JSON（字下げなし） */
export function serializeExportFile(f: ExportFile): string {
  const ordered: ExportFile = {
    format: f.format,
    gameId: f.gameId,
    schemaVersion: f.schemaVersion,
    turn: f.turn,
    exportedAt: f.exportedAt,
    state: f.state,
    checksum: f.checksum,
  };
  return JSON.stringify(ordered);
}

export type ParsedImport = { ok: true; gameId: string; turn: number; exportedAt: number; state: GameState; fromVersion: number };
export type ImportRejectReason = "format" | "broken" | "tooNew" | "checksum";

const isPositiveSafeInt = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x) && x >= 1;
const CHECKSUM_RE = /^[0-9a-f]{64}$/;

/**
 * SV-33: 読み込むファイルの文字列を検査し、state を今の版へ移行する。
 * 順: JSON / オブジェクト / format → 欄の型 → schemaVersion が新しすぎる → checksum → migrateState（形の検査を含む）。
 * checksum はファイルから読んだ state を JSON にし直して比べる（整形しただけのファイルは通る）
 */
export function parseExportFile(
  text: string,
  current: number,
  migrations: readonly Migration[] = MIGRATIONS,
): ParsedImport | { ok: false; reason: ImportRejectReason } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: "format" };
  }
  if (!isPlainObject(raw) || raw["format"] !== EXPORT_FORMAT) return { ok: false, reason: "format" };
  const { gameId, schemaVersion, turn, exportedAt, state, checksum } = raw;
  if (typeof gameId !== "string" || gameId.length < 1 || gameId.length > 64) return { ok: false, reason: "broken" };
  if (!isPositiveSafeInt(schemaVersion) || !isPositiveSafeInt(turn)) return { ok: false, reason: "broken" };
  if (typeof exportedAt !== "number" || !Number.isFinite(exportedAt)) return { ok: false, reason: "broken" };
  if (!isPlainObject(state)) return { ok: false, reason: "broken" };
  if (typeof checksum !== "string" || !CHECKSUM_RE.test(checksum)) return { ok: false, reason: "broken" };
  if (schemaVersion > current) return { ok: false, reason: "tooNew" };
  if (stateChecksum(state) !== checksum) return { ok: false, reason: "checksum" };
  const m = migrateState(state, schemaVersion, current, migrations);
  if (!m.ok) return { ok: false, reason: m.reason };
  return { ok: true, gameId, turn, exportedAt, state: m.state, fromVersion: m.fromVersion };
}
