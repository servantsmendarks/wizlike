// SV-20/22: IndexedDB の保存先（GameStoreBackend の本番の実装）。
// node のテストでは動かせない（fake-indexeddb は入れない）。実機で確かめる。
// トップレベルでは indexedDB に触れない（呼び出し側が factory を渡す）。
import type { GameRecord, GameStoreBackend } from "./types";

export const DB_NAME = "wizlike";
/** IndexedDB のストア形の版。GameState の schemaVersion とは無関係 */
export const DB_VERSION = 1;
/** SV-20: キーは gameId（keyPath） */
export const STORE_GAMES = "games";
/** SV-20: 作るだけ。SV-24 のとおり設定は localStorage に置く */
export const STORE_SETTINGS = "settings";

function errorOf(x: { error?: DOMException | null } | null, fallback: string): Error {
  return x?.error ?? new Error(fallback);
}

/** 開いた接続が閉じられたとき（onclose / onversionchange）に呼ばれる */
function openDb(factory: IDBFactory, onLost: () => void = () => {}): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      req = factory.open(DB_NAME, DB_VERSION);
    } catch (e) {
      // プライベートブラウズなどで同期に SecurityError を投げる環境がある
      reject(e);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_GAMES)) db.createObjectStore(STORE_GAMES, { keyPath: "gameId" });
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) db.createObjectStore(STORE_SETTINGS);
    };
    req.onsuccess = () => {
      const db = req.result;
      // 別タブが新しい版で開こうとしたら閉じて譲る。次の読み書きで開き直す
      db.onversionchange = () => {
        db.close();
        onLost();
      };
      // ブラウザ側が接続を切ったとき（iOS Safari でバックグラウンドから戻った直後など）
      db.onclose = () => onLost();
      resolve(db);
    };
    req.onerror = () => reject(errorOf(req, "indexedDB open failed"));
  });
}

/** readonly の読み取り 1 回 */
function read<T>(db: IDBDatabase, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_GAMES, "readonly");
      const req = run(tx.objectStore(STORE_GAMES));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(errorOf(req, "indexedDB read failed"));
      tx.onabort = () => reject(errorOf(tx, "indexedDB read aborted"));
    } catch (e) {
      reject(e);
    }
  });
}

/** SV-22: readwrite のトランザクション。complete で解決、error / abort（QuotaExceeded など）/ 同期例外（DataCloneError など）で reject */
function write(db: IDBDatabase, run: (store: IDBObjectStore) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_GAMES, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(errorOf(tx, "indexedDB write failed"));
      tx.onabort = () => reject(errorOf(tx, "indexedDB write aborted"));
      try {
        run(tx.objectStore(STORE_GAMES));
      } catch (e) {
        try {
          tx.abort();
        } catch {
          // すでに終わったトランザクション
        }
        reject(e);
      }
    } catch (e) {
      reject(e);
    }
  });
}

/** 接続が使えなくなったことを示す失敗か（InvalidStateError は閉じた接続の transaction、UnknownError は接続の喪失） */
function isConnectionLost(e: unknown): boolean {
  const name = (e as { name?: unknown } | null)?.name;
  return name === "InvalidStateError" || name === "UnknownError";
}

/**
 * IndexedDB を開いて保存先を返す。factory が undefined（IndexedDB の無い環境）や開けないときは reject。
 * SV-23: 接続が閉じられたら捨て、次の読み書きで開き直す（自動の再試行はしない。次のコマンドの保存が再試行になる）。
 * 開き直しに失敗したら、その読み書きは今までどおり reject する。
 */
export async function openIdbBackend(factory: IDBFactory | undefined): Promise<GameStoreBackend> {
  if (factory === undefined) throw new Error("indexedDB is not available");
  const f = factory;
  let held: IDBDatabase | null = null;
  const open = async (): Promise<IDBDatabase> => {
    const db = await openDb(f, () => {
      if (held === db) held = null;
    });
    held = db;
    return db;
  };
  await open();
  const use = async <T>(op: (db: IDBDatabase) => Promise<T>): Promise<T> => {
    const db = held ?? (await open());
    try {
      return await op(db);
    } catch (e) {
      if (isConnectionLost(e) && held === db) held = null;
      throw e;
    }
  };
  return {
    getAll: () => use((db) => read<unknown[]>(db, (s) => s.getAll())),
    get: (gameId: string) => use((db) => read<unknown>(db, (s) => s.get(gameId))),
    put: (record: GameRecord) => use((db) => write(db, (s) => void s.put(record))),
    delete: (gameId: string) => use((db) => write(db, (s) => void s.delete(gameId))),
  };
}
