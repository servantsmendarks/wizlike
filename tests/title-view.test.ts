// タイトル（UI-50 / SV-11 / SV-12 / SV-14）の純粋な部分: 項目の並び、ラベル、選んだ結果、キー、案内の文。
// 一覧の値は src/save の createSaveService（メモリ実装の保存先）が返すものを使う。
import { describe, expect, test } from "vitest";
import { buildRecord } from "../src/save/record";
import { createSaveService } from "../src/save/saves";
import type { GameListEntry } from "../src/save/types";
import {
  formatUpdatedAt,
  titleEntries,
  titleItems,
  titleKeyIndex,
  titleNotice,
  titleRowLabels,
  titleStep,
  type TitleEntry,
  type TitlePage,
} from "../src/presenter/views/title";
import { data, newGame, withChar } from "./helpers/core";
import { createMemoryBackend } from "./helpers/save";

const S = data.strings;
const SIZE = data.config.party.size;
const SCHEMA = data.config.save.schemaVersion;
const LEADER = data.config.prototypeParty.members[0]!.defaultName;
const LIST: TitlePage = { kind: "list" };

/** ローカル時刻の 2026-01-05 03:07 と 2026-12-31 23:59 */
const T1 = new Date(2026, 0, 5, 3, 7, 30).getTime();
const T2 = new Date(2026, 11, 31, 23, 59, 0).getTime();

/** 保存先に ok（2 件）・新しすぎる版・壊れた記録を置いて、サービスの list の結果を返す */
async function sampleList(): Promise<GameListEntry[]> {
  const mem = createMemoryBackend();
  const twoDead = withChar(withChar(newGame(1), 1, { life: "dead", hp: 0 }), 2, { life: "ash", hp: 0 });
  twoDead.progress.clearedDungeons = ["d01"];
  await mem.put(buildRecord("a", 3, T1, SCHEMA, newGame(1)));
  await mem.put(buildRecord("b", 7, T2, SCHEMA, twoDead));
  await mem.put(buildRecord("c", 2, T1 - 1000, SCHEMA + 1, newGame(2)));
  mem.raw("d", { gameId: "d", schemaVersion: "x" });
  const saves = createSaveService({ backend: mem, now: () => 0, newId: () => "z", schemaVersion: SCHEMA, maxGames: data.config.save.maxGames });
  const r = await saves.list();
  if (!r.ok) throw new Error("list failed");
  return r.entries;
}

describe("タイトルの一覧（UI-50 / SV-12）", () => {
  test("UI-50/SV-12 list は一覧の行（updatedAt の降順）→ 新しく始める → 設定 の 1 本のリスト", async () => {
    const list = await sampleList();
    expect(list.map((e) => [e.gameId, e.status])).toEqual([
      ["b", "ok"],
      ["a", "ok"],
      ["c", "tooNew"],
      ["d", "broken"],
    ]);
    const es = titleEntries(LIST, list);
    expect(es.map((e) => (e.kind === "game" ? `game:${e.entry.gameId}` : e.kind))).toEqual(["game:b", "game:a", "game:c", "game:d", "newGame", "settings"]);
    expect(titleEntries(LIST, [])).toEqual([{ kind: "newGame" }, { kind: "settings" }]);
  });

  test("SV-12 行の 2 行: リーダー名・生存 aliveCount/party.size・踏破数 / 最終更新日時（ローカル時刻、月日時分は 0 詰め）", async () => {
    const list = await sampleList();
    const [b, a, c, d] = list;
    expect(SIZE).toBe(6);
    // b は 2 人（dead と ash）が倒れ、d01 を踏破済み
    expect(titleRowLabels(b!, SIZE, S)).toEqual([`${LEADER}　生存4/6　踏破1`, "2026/12/31 23:59"]);
    expect(titleRowLabels(a!, SIZE, S)).toEqual([`${LEADER}　生存6/6　踏破0`, "2026/01/05 03:07"]);
    // 新しすぎる版は 2 行目を差し替え、壊れた記録は summary が空の仮の値なので 1 行目を差し替える
    expect(titleRowLabels(c!, SIZE, S)).toEqual([`${LEADER}　生存6/6　踏破0`, S["title.rowTooNew"]]);
    expect(titleRowLabels(d!, SIZE, S)).toEqual([S["title.rowBroken"], ""]);
    // 読めない記録は dim（押せる）
    const items = titleItems(LIST, list, SIZE, S);
    expect(items.map((it) => [it.dim, it.disabled])).toEqual([
      [false, false],
      [false, false],
      [true, false],
      [true, false],
      [false, false],
      [false, false],
    ]);
    expect(items[4]!.lines).toEqual([S["title.newGame"]]);
    expect(items[5]!.lines).toEqual([S["title.settings"]]);
  });

  test("SV-12 formatUpdatedAt は 1 桁の月日時分を 0 詰めにし、年は 4 桁のまま", () => {
    expect(formatUpdatedAt(T1)).toEqual({ y: "2026", mo: "01", d: "05", hh: "03", mm: "07" });
    expect(formatUpdatedAt(T2)).toEqual({ y: "2026", mo: "12", d: "31", hh: "23", mm: "59" });
    expect(formatUpdatedAt(new Date(2027, 8, 9, 0, 0).getTime())).toEqual({ y: "2027", mo: "09", d: "09", hh: "00", mm: "00" });
  });

  test("UI-50 案内の欄: 一覧が空なら title.empty、行があれば空、game は行の 1 行目", async () => {
    const list = await sampleList();
    expect(titleNotice(LIST, [], SIZE, S)).toBe(S["title.empty"]);
    expect(titleNotice(LIST, list, SIZE, S)).toBe("");
    expect(titleNotice({ kind: "game", gameId: "b" }, list, SIZE, S)).toBe(`${LEADER}　生存4/6　踏破1`);
    expect(titleNotice({ kind: "game", gameId: "d" }, list, SIZE, S)).toBe(S["title.rowBroken"]);
  });
});

describe("行を選んだ後（SV-04 / SV-14）", () => {
  test("UI-50 行を選ぶと 続きから / 削除 / やめる。やめるで一覧へ", async () => {
    const list = await sampleList();
    const row = titleEntries(LIST, list)[1]!;
    expect(titleStep(LIST, row)).toEqual({ kind: "page", page: { kind: "game", gameId: "a" } });
    const page: TitlePage = { kind: "game", gameId: "a" };
    const es = titleEntries(page, list);
    expect(es).toEqual([{ kind: "continue", gameId: "a", disabled: false }, { kind: "delete", gameId: "a" }, { kind: "cancel" }]);
    expect(titleStep(page, es[0]!)).toEqual({ kind: "continue", gameId: "a" });
    expect(titleStep(page, es[1]!)).toEqual({ kind: "page", page: { kind: "confirm1", gameId: "a" } });
    expect(titleStep(page, es[2]!)).toEqual({ kind: "page", page: LIST });
    expect(titleItems(page, list, SIZE, S).map((it) => it.lines)).toEqual([[S["title.continue"]], [S["title.delete"]], [S["title.cancel"]]]);
    expect(titleStep(LIST, { kind: "newGame" })).toEqual({ kind: "newGame" });
    expect(titleStep(LIST, { kind: "settings" })).toEqual({ kind: "settings" });
  });

  test("SV-04/SV-12 新しすぎる版・壊れた記録は 続きから を disabled（押しても何もしない）にし、削除はできる", async () => {
    const list = await sampleList();
    for (const id of ["c", "d"]) {
      const page: TitlePage = { kind: "game", gameId: id };
      const es = titleEntries(page, list);
      expect(es[0]).toEqual({ kind: "continue", gameId: id, disabled: true });
      expect(titleStep(page, es[0]!)).toEqual({ kind: "none" });
      const items = titleItems(page, list, SIZE, S);
      expect([items[0]!.dim, items[0]!.disabled]).toEqual([true, true]);
      expect(titleStep(page, es[1]!)).toEqual({ kind: "page", page: { kind: "confirm1", gameId: id } });
    }
  });

  test("SV-14 削除は確認 2 段階: confirm1 の 消す は confirm2 へ進むだけで remove しない。confirm2 の 消す だけが remove。確認の先頭は やめる", async () => {
    const list = await sampleList();
    const c1: TitlePage = { kind: "confirm1", gameId: "b" };
    const c2: TitlePage = { kind: "confirm2", gameId: "b" };
    for (const p of [c1, c2]) {
      expect(titleEntries(p, list)).toEqual([{ kind: "cancel" }, { kind: "deleteYes", gameId: "b" }]);
      // やめるは行のページへ戻る
      expect(titleStep(p, { kind: "cancel" })).toEqual({ kind: "page", page: { kind: "game", gameId: "b" } });
    }
    expect(titleStep(c1, { kind: "deleteYes", gameId: "b" })).toEqual({ kind: "page", page: c2 });
    expect(titleStep(c2, { kind: "deleteYes", gameId: "b" })).toEqual({ kind: "remove", gameId: "b" });
    // 確認の文
    expect(titleNotice(c1, list, SIZE, S)).toBe(`${LEADER}の記録を削除する？`);
    expect(titleNotice(c2, list, SIZE, S)).toBe(S["title.deleteConfirm2"]);
    expect(titleItems(c1, list, SIZE, S).map((it) => it.lines)).toEqual([[S["title.cancel"]], [S["title.deleteYes"]]]);
    // Enter（先頭）では消えない
    expect(titleKeyIndex("confirm", titleEntries(c2, list))).toBe(0);
  });

  test("SV-14 消えた gameId のページは やめる だけ（一覧へ戻る）", async () => {
    const list = await sampleList();
    const p: TitlePage = { kind: "game", gameId: "nope" };
    expect(titleEntries(p, list)).toEqual([{ kind: "cancel" }]);
    expect(titleStep(p, { kind: "cancel" })).toEqual({ kind: "page", page: LIST });
    expect(titleNotice(p, list, SIZE, S)).toBe("");
  });
});

describe("タイトルのキー（UI-33）", () => {
  test("UI-33 数字 n → n 番目、Enter → 先頭、Esc → やめる（list では無視）。範囲外・他のキーは null", async () => {
    const list = await sampleList();
    const es = titleEntries(LIST, list);
    expect(titleKeyIndex("confirm", es)).toBe(0); // 一覧の先頭の行
    expect(titleKeyIndex({ menu: 4 }, es)).toBe(4); // 新しく始める
    expect(es[4]).toEqual({ kind: "newGame" });
    expect(titleKeyIndex({ menu: 6 }, es)).toBeNull();
    expect(titleKeyIndex("back", es)).toBeNull();
    expect(titleKeyIndex("forward", es)).toBeNull();
    // 一覧が空なら Enter は「新しく始める」、2 は「設定」
    const empty = titleEntries(LIST, []);
    expect(empty[titleKeyIndex("confirm", empty)!]).toEqual({ kind: "newGame" });
    expect(empty[titleKeyIndex({ menu: 1 }, empty)!]).toEqual({ kind: "settings" });
    // 行のページの Esc は やめる
    const game: TitleEntry[] = titleEntries({ kind: "game", gameId: "a" }, list);
    expect(titleKeyIndex("back", game)).toBe(2);
    expect(titleKeyIndex("back", titleEntries({ kind: "confirm1", gameId: "a" }, list))).toBe(0);
  });

  test("UI-50 タイトルの文言が strings にある", () => {
    for (const k of [
      "title.row",
      "title.rowDate",
      "title.rowBroken",
      "title.rowTooNew",
      "title.empty",
      "title.deleteConfirm1",
      "title.deleteConfirm2",
      "title.deleteYes",
      "title.cancel",
      "title.deleted",
      "title.deleteFailed",
      "title.loadBroken",
      "title.loadTooNew",
      "title.maxGames",
    ]) {
      expect(S[k], k).toBeTypeOf("string");
    }
  });
});
