// セーブのテスト用のメモリ実装（IndexedDB の代わり。依存パッケージは足さない）。
// - put は JSON 往復した複製を Map に置く（構造化複製の代わり。呼び出し側の参照を共有しない）。
// - raw(key, value) は検査を通さずに任意の値を置く（壊れたレコードを作る）。
// - setFail で操作ごとに失敗（reject）させる。
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
