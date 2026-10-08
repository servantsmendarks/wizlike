// SV-21 のレコードを作る・読む（純粋）。
import type { GameState } from "../core/types";
import type { GameRecord, SaveSummary, StoredRecord } from "./types";

/** SV-21: 一覧表示用の要約。leaderName は isLeader の者の名前（いなければ ""）。conquered は progress.conquered（M12。DG-36） */
export function summarize(state: GameState): SaveSummary {
  return {
    leaderName: state.party.find((c) => c.isLeader)?.name ?? "",
    clearedCount: state.progress.clearedDungeons.length,
    aliveCount: state.party.filter((c) => c.life === "alive").length,
    conquered: state.progress.conquered,
  };
}

/** SV-21: 保存するレコード。state は複製しない（IndexedDB の put が構造化複製する） */
export function buildRecord(
  gameId: string,
  turn: number,
  updatedAt: number,
  schemaVersion: number,
  state: GameState,
): GameRecord {
  return { gameId, schemaVersion, turn, updatedAt, summary: summarize(state), state };
}

/** 配列でない、プロトタイプが Object.prototype か null のオブジェクト */
export function isPlainObject(x: unknown): x is Record<string, unknown> {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return false;
  const proto: unknown = Object.getPrototypeOf(x);
  return proto === Object.prototype || proto === null;
}

function isCount(x: unknown): x is number {
  return typeof x === "number" && Number.isInteger(x) && x >= 0;
}

function isPositiveInt(x: unknown): x is number {
  return typeof x === "number" && Number.isInteger(x) && x >= 1;
}

/**
 * 保存先から読んだ値がレコードの形か（state の中身は見ない）。違えば null。
 * summary.conquered（SV-21。M12）: 欄が無い（M12 より前の記録）は false、真偽値はそのまま、それ以外の型は壊れた記録（null）
 */
export function checkStoredRecord(raw: unknown): StoredRecord | null {
  if (!isPlainObject(raw)) return null;
  const { gameId, schemaVersion, turn, updatedAt, summary, state } = raw;
  if (typeof gameId !== "string" || gameId === "") return null;
  if (!isPositiveInt(schemaVersion) || !isPositiveInt(turn)) return null;
  if (typeof updatedAt !== "number" || !Number.isFinite(updatedAt)) return null;
  if (!isPlainObject(summary)) return null;
  const { leaderName, clearedCount, aliveCount } = summary;
  if (typeof leaderName !== "string" || !isCount(clearedCount) || !isCount(aliveCount)) return null;
  const conquered = summary["conquered"] === undefined ? false : summary["conquered"];
  if (typeof conquered !== "boolean") return null;
  if (!isPlainObject(state)) return null;
  return { gameId, schemaVersion, turn, updatedAt, summary: { leaderName, clearedCount, aliveCount, conquered }, state };
}
