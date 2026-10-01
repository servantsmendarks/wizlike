// SV-02/10〜14/21〜23: ゲームの保存・一覧・読み込み・削除（純粋。保存先・時計・ID は注入）。
// gameId と turn はこのサービスのメモリが持ち、GameState には入れない。例外は外に出さない。
import type { GameState } from "../core/types";
import { migrateState, MIGRATIONS } from "./migrate";
import { buildRecord, checkStoredRecord, isPlainObject } from "./record";
import type { GameListEntry, ListResult, SaveDeps, SaveResult, SaveService } from "./types";

/** updatedAt の降順、同値は gameId の昇順 */
function compareEntries(a: GameListEntry, b: GameListEntry): number {
  if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
  return a.gameId < b.gameId ? -1 : a.gameId > b.gameId ? 1 : 0;
}

export function createSaveService(deps: SaveDeps): SaveService {
  const backend = deps.backend;
  const migrations = deps.migrations ?? MIGRATIONS;
  let current: { gameId: string; turn: number } | null = null;
  /** 書き込み（begin / save / remove）を 1 本に直列化する鎖 */
  let chain: Promise<unknown> = Promise.resolve();

  const enqueue = <T>(job: () => Promise<T>): Promise<T> => {
    const p = chain.then(job, job);
    chain = p.catch(() => undefined);
    return p;
  };

  const writeCurrent = async (state: GameState): Promise<SaveResult> => {
    if (backend === null || current === null) return { ok: false };
    const target = current;
    const next = target.turn + 1;
    try {
      await backend.put(buildRecord(target.gameId, next, deps.now(), deps.schemaVersion, state));
    } catch {
      return { ok: false };
    }
    // 書いている間に別のゲームへ切り替わっていなければ turn を進める
    if (current === target) current = { gameId: target.gameId, turn: next };
    return { ok: true, turn: next };
  };

  const list = async (): Promise<ListResult> => {
    if (backend === null) return { ok: false };
    let raws: unknown;
    try {
      raws = await backend.getAll();
    } catch {
      return { ok: false };
    }
    if (!Array.isArray(raws)) return { ok: false };
    const entries: GameListEntry[] = [];
    for (const raw of raws) {
      const rec = checkStoredRecord(raw);
      if (rec === null) {
        const id = isPlainObject(raw) ? raw["gameId"] : undefined;
        if (typeof id === "string" && id !== "") {
          entries.push({
            gameId: id,
            turn: 0,
            updatedAt: 0,
            summary: { leaderName: "", clearedCount: 0, aliveCount: 0 },
            status: "broken",
          });
        }
        continue;
      }
      entries.push({
        gameId: rec.gameId,
        turn: rec.turn,
        updatedAt: rec.updatedAt,
        summary: rec.summary,
        status: rec.schemaVersion > deps.schemaVersion ? "tooNew" : "ok",
      });
    }
    entries.sort(compareEntries);
    return { ok: true, entries };
  };

  return {
    available: backend !== null,
    list,
    async canCreate() {
      if (backend === null) return "unavailable";
      const r = await list();
      if (!r.ok) return "unavailable";
      return r.entries.length >= deps.maxGames ? "full" : "ok";
    },
    begin(state) {
      return enqueue(async () => {
        try {
          current = { gameId: deps.newId(), turn: 0 };
        } catch {
          current = null;
          return { ok: false };
        }
        // 失敗しても current は残す（次のコマンドで turn 1 を再試行する）
        return writeCurrent(state);
      });
    },
    save(state) {
      return enqueue(() => writeCurrent(state));
    },
    async load(gameId) {
      if (backend === null) return { ok: false, reason: "unavailable" };
      let raw: unknown;
      try {
        raw = await backend.get(gameId);
      } catch {
        return { ok: false, reason: "unavailable" };
      }
      if (raw === undefined) return { ok: false, reason: "missing" };
      const rec = checkStoredRecord(raw);
      if (rec === null || rec.gameId !== gameId) return { ok: false, reason: "broken" };
      const m = migrateState(rec.state, rec.schemaVersion, deps.schemaVersion, migrations);
      if (!m.ok) return { ok: false, reason: m.reason };
      current = { gameId: rec.gameId, turn: rec.turn };
      return { ok: true, state: m.state, gameId: rec.gameId, turn: rec.turn };
    },
    remove(gameId) {
      return enqueue(async () => {
        if (backend === null) return false;
        try {
          await backend.delete(gameId);
        } catch {
          return false;
        }
        if (current !== null && current.gameId === gameId) current = null;
        return true;
      });
    },
    current() {
      return current === null ? null : { ...current };
    },
  };
}
