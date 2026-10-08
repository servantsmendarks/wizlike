// セーブのテスト用のメモリ実装（IndexedDB の代わり。依存パッケージは足さない）。
// - put は JSON 往復した複製を Map に置く（構造化複製の代わり。呼び出し側の参照を共有しない）。
// - raw(key, value) は検査を通さずに任意の値を置く（壊れたレコードを作る）。
// - setFail で操作ごとに失敗（reject）させる。
import type { GameState } from "../../src/core/types";
import type { GameRecord, GameStoreBackend } from "../../src/save/types";

export type FailSpec = { getAll?: boolean; get?: boolean; put?: boolean; delete?: boolean };

export type MemoryBackend = GameStoreBackend & {
  /** 検査なしで値を置く（壊れたレコード用） */
  raw(key: string, value: unknown): void;
  setFail(fail: FailSpec): void;
  /** 置いてある値の複製（キーの昇順） */
  dump(): Map<string, unknown>;
  /** 成功した put の回数 */
  readonly putCount: number;
};

export function createMemoryBackend(opts: { fail?: FailSpec } = {}): MemoryBackend {
  const store = new Map<string, unknown>();
  let fail: FailSpec = { ...(opts.fail ?? {}) };
  let putCount = 0;
  const copy = <T>(x: T): T => (x === undefined ? x : (JSON.parse(JSON.stringify(x)) as T));
  return {
    async getAll() {
      if (fail.getAll === true) throw new Error("memory backend: getAll failed");
      return [...store.values()].map(copy);
    },
    async get(gameId: string) {
      if (fail.get === true) throw new Error("memory backend: get failed");
      return copy(store.get(gameId));
    },
    async put(record: GameRecord) {
      if (fail.put === true) throw new Error("memory backend: put failed");
      store.set(record.gameId, copy(record));
      putCount++;
    },
    async delete(gameId: string) {
      if (fail.delete === true) throw new Error("memory backend: delete failed");
      store.delete(gameId);
    },
    raw(key: string, value: unknown) {
      store.set(key, value);
    },
    setFail(f: FailSpec) {
      fail = { ...f };
    },
    dump() {
      return new Map([...store.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => [k, copy(v)]));
    },
    get putCount() {
      return putCount;
    },
  };
}

/**
 * 今の state（schemaVersion 7）から M12 の欄（TW-35 の tally、progress の enteredDungeons / conquered / endingPending）を消した v6 の形
 * （JSON の複製。引数は書き換えない）
 */
export function toV6(s: GameState): Record<string, unknown> {
  const v6 = JSON.parse(JSON.stringify(s)) as Record<string, unknown>;
  delete v6["tally"];
  const progress = v6["progress"] as Record<string, unknown>;
  delete progress["enteredDungeons"];
  delete progress["conquered"];
  delete progress["endingPending"];
  return v6;
}

/**
 * SV-04 v6 → v7（M12）の移行で s から作った古い版の保存が行き着く state（JSON の複製）: tally は全部 0（過去の数は復元しない）、
 * conquered / endingPending は false、enteredDungeons は clearedDungeons と潜行中の dive.dungeonId（重複なし）。ほかの欄は s のまま
 */
export function asMigratedToV7(s: GameState): GameState {
  const m = JSON.parse(JSON.stringify(s)) as GameState;
  m.tally = { dives: 0, battles: 0, deaths: 0, ashes: 0, wipes: 0 };
  const entered = [...new Set([...s.progress.clearedDungeons, ...(s.dive === null ? [] : [s.dive.dungeonId])])];
  m.progress = { ...m.progress, enteredDungeons: entered, conquered: false, endingPending: false };
  return m;
}

/**
 * 今の state から M11 の欄（CB-60: dive.chest と dive.disarmedChests）と M12 の欄も消した v5 の形（toV6 を通した JSON の複製。引数は書き換えない）
 */
export function toV5(s: GameState): Record<string, unknown> {
  const v5 = toV6(s);
  const dive = v5["dive"] as Record<string, unknown> | null;
  if (dive !== null) {
    delete dive["chest"];
    delete dive["disarmedChests"];
  }
  return v5;
}

/**
 * 今の state から M10 の欄（CH-63: 職業ごとの maxLevelReached）を v4 の形（今の職業の値の数）に戻し、M11 の欄も消した複製
 * （toV5 を通した JSON の複製。引数は書き換えない）
 */
export function toV4(s: GameState): Record<string, unknown> {
  const v4 = toV5(s);
  for (const ch of v4["party"] as Array<Record<string, unknown>>) {
    ch["maxLevelReached"] = (ch["maxLevelReached"] as Record<string, number>)[ch["classId"] as string];
  }
  return v4;
}

/**
 * 今の state（schemaVersion 5）から M7 の B の欄（IT-80: 各実体の level / rarity / options / uniqueId / cursed / foundIn、
 * warehouse、buyback、uniqueBook、progress.shopLevel）を消した v3 の形（toV4 を通した複製。引数は書き換えない）
 */
export function toV3(s: GameState): Record<string, unknown> {
  const v3 = toV4(s);
  delete v3["warehouse"];
  delete v3["buyback"];
  delete v3["uniqueBook"];
  delete (v3["progress"] as Record<string, unknown>)["shopLevel"];
  for (const inst of Object.values(v3["items"] as Record<string, Record<string, unknown>>)) {
    for (const k of ["level", "rarity", "options", "uniqueId", "cursed", "foundIn"]) delete inst[k];
  }
  return v3;
}
