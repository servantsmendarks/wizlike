// セーブの型（SV-20〜23）。core からは import type だけ。DOM の型は使ってよい。
import type { GameState } from "../core/types";

/** SV-21 */
export type SaveSummary = { leaderName: string; clearedCount: number; aliveCount: number };

/** SV-21。games ストアの 1 レコード（キー gameId） */
export type GameRecord = {
  gameId: string;
  schemaVersion: number;
  /** 保存が成功するたびに +1。game.new 直後の最初の保存が 1 */
  turn: number;
  /** 保存時点の epoch ミリ秒 */
  updatedAt: number;
  summary: SaveSummary;
  state: GameState;
};

/** checkStoredRecord を通った保存済みレコード（state の中身はまだ検査していない） */
export type StoredRecord = Omit<GameRecord, "state"> & { state: unknown };

/** 保存先。本番は db.ts の IndexedDB、テストは tests/helpers/save.ts のメモリ実装 */
export interface GameStoreBackend {
  getAll(): Promise<unknown[]>;
  /** 無ければ undefined */
  get(gameId: string): Promise<unknown>;
  /** SV-22: readwrite のトランザクションで丸ごと置換。complete で解決、error / abort / 同期例外で reject */
  put(record: GameRecord): Promise<void>;
  delete(gameId: string): Promise<void>;
}

export type ListStatus = "ok" | "tooNew" | "broken";
export type GameListEntry = { gameId: string; turn: number; updatedAt: number; summary: SaveSummary; status: ListStatus };
export type ListResult = { ok: true; entries: GameListEntry[] } | { ok: false };
export type CreateCheck = "ok" | "full" | "unavailable";
export type SaveResult = { ok: true; turn: number } | { ok: false };
export type LoadResult =
  | { ok: true; state: GameState; gameId: string; turn: number }
  | { ok: false; reason: "unavailable" | "missing" | "tooNew" | "broken" };

/** SV-04: 版 v の state を v+1 にする。引数を書き換えない */
export type Migration = (state: unknown) => unknown;
export type MigrateResult = { ok: true; state: GameState; fromVersion: number } | { ok: false; reason: "tooNew" | "broken" };

export type ExportResult =
  | { ok: true; gameId: string; turn: number; exportedAt: number; text: string }
  | { ok: false; reason: "unavailable" | "missing" | "tooNew" | "broken" };

export type ImportPlan = {
  /** restore = 記録が無い（SV-31 の復元）、overwrite = 既存の turn 以上か既存が読めない、older = 既存より turn が小さい（SV-32 の確認が要る） */
  kind: "restore" | "overwrite" | "older";
  gameId: string;
  turn: number;
  /** 既存のレコードの turn。無い・読めないときは null */
  existingTurn: number | null;
  summary: SaveSummary;
  /** 今の版に移行した state */
  state: GameState;
};
export type ImportCheck =
  | { ok: true; plan: ImportPlan }
  | { ok: false; reason: "format" | "broken" | "tooNew" | "checksum" | "unavailable" | "full" };
export type ImportResult = { ok: true; kind: ImportPlan["kind"] } | { ok: false; reason: "unavailable" | "full" | "failed" };

export type SaveDeps = {
  /** null = IndexedDB を開けなかった。全操作が失敗を返す */
  backend: GameStoreBackend | null;
  now(): number;
  newId(): string;
  schemaVersion: number;
  maxGames: number;
  /** 既定は migrate.ts の MIGRATIONS */
  migrations?: readonly Migration[];
};

export type SaveService = {
  /** backend が null でない（IndexedDB を開けた） */
  readonly available: boolean;
  list(): Promise<ListResult>;
  canCreate(): Promise<CreateCheck>;
  /** game.new の直後。新しい gameId を作って turn 1 で保存する */
  begin(state: GameState): Promise<SaveResult>;
  save(state: GameState): Promise<SaveResult>;
  load(gameId: string): Promise<LoadResult>;
  remove(gameId: string): Promise<boolean>;
  current(): { gameId: string; turn: number } | null;
  /** SV-30: 保存先のレコードを書き出しの JSON にする。書き込みの鎖に並べる（保存中の書き込みが終わってから読む） */
  exportGame(gameId: string): Promise<ExportResult>;
  /** SV-31〜33: ファイルの文字列を検査し、既存のレコードと比べた計画を返す（書かない） */
  prepareImport(text: string): Promise<ImportCheck>;
  /** SV-31: 計画どおりに書く。restore は書く直前に件数を数え直す（maxGames 以上なら full）。書き込みの鎖に並べる */
  applyImport(plan: ImportPlan): Promise<ImportResult>;
};
