// タイトル（UI-50 / SV-11 / SV-12 / SV-14）の純粋な部分: 項目の並び、ラベル、選んだ結果、キー、案内の文。
// 一覧の値は src/save の createSaveService（メモリ実装の保存先）が返すものを使う。
import { afterEach, describe, expect, test, vi } from "vitest";
import { createFileButton, downloadText, exportFileName } from "../src/presenter/file-io";
import { tapSpecOf } from "../src/presenter/input/tap";
import { TITLE_HINT } from "../src/presenter/layout";
import { buildRecord } from "../src/save/record";
import { createSaveService } from "../src/save/saves";
import type { GameListEntry } from "../src/save/types";
import {
  createTitleScreen,
  formatUpdatedAt,
  titleHint,
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
  test("UI-50/SV-12 list は一覧の行（updatedAt の降順）→ 新しく始める → 設定 → 読み込み の 1 本のリスト", async () => {
    const list = await sampleList();
    expect(list.map((e) => [e.gameId, e.status])).toEqual([
      ["b", "ok"],
      ["a", "ok"],
      ["c", "tooNew"],
      ["d", "broken"],
    ]);
    const es = titleEntries(LIST, list);
    expect(es.map((e) => (e.kind === "game" ? `game:${e.entry.gameId}` : e.kind))).toEqual(["game:b", "game:a", "game:c", "game:d", "newGame", "settings", "import"]);
    expect(titleEntries(LIST, [])).toEqual([{ kind: "newGame" }, { kind: "settings" }, { kind: "import" }]);
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
      [false, false],
    ]);
    expect(items[4]!.lines).toEqual([S["title.newGame"]]);
    expect(items[5]!.lines).toEqual([S["title.settings"]]);
    expect(items[6]!.lines).toEqual([S["title.import"]]);
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
  test("UI-50/SV-12 行を選ぶと 続きから / 書き出し / 削除 / やめる。やめるで一覧へ", async () => {
    const list = await sampleList();
    const row = titleEntries(LIST, list)[1]!;
    expect(titleStep(LIST, row)).toEqual({ kind: "page", page: { kind: "game", gameId: "a" } });
    const page: TitlePage = { kind: "game", gameId: "a" };
    const es = titleEntries(page, list);
    expect(es).toEqual([
      { kind: "continue", gameId: "a", disabled: false },
      { kind: "export", gameId: "a", disabled: false },
      { kind: "delete", gameId: "a" },
      { kind: "cancel" },
    ]);
    expect(titleStep(page, es[0]!)).toEqual({ kind: "continue", gameId: "a" });
    expect(titleStep(page, es[2]!)).toEqual({ kind: "page", page: { kind: "confirm1", gameId: "a" } });
    expect(titleStep(page, es[3]!)).toEqual({ kind: "page", page: LIST });
    expect(titleItems(page, list, SIZE, S).map((it) => it.lines)).toEqual([[S["title.continue"]], [S["title.export"]], [S["title.delete"]], [S["title.cancel"]]]);
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
      expect(titleStep(page, es[2]!)).toEqual({ kind: "page", page: { kind: "confirm1", gameId: id } });
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
    expect(es[titleKeyIndex({ menu: 6 }, es)!]).toEqual({ kind: "import" }); // 読み込み（M6）
    expect(titleKeyIndex({ menu: 7 }, es)).toBeNull();
    expect(titleKeyIndex("back", es)).toBeNull();
    expect(titleKeyIndex("forward", es)).toBeNull();
    // 一覧が空なら Enter は「新しく始める」、2 は「設定」
    const empty = titleEntries(LIST, []);
    expect(empty[titleKeyIndex("confirm", empty)!]).toEqual({ kind: "newGame" });
    expect(empty[titleKeyIndex({ menu: 1 }, empty)!]).toEqual({ kind: "settings" });
    // 行のページの Esc は やめる
    const game: TitleEntry[] = titleEntries({ kind: "game", gameId: "a" }, list);
    expect(titleKeyIndex("back", game)).toBe(3);
    expect(titleKeyIndex("back", titleEntries({ kind: "confirm1", gameId: "a" }, list))).toBe(0);
  });

  test("UI-50 新しく始める → おすすめで始める / 自分で作る / やめる（M5.5）。Enter はおすすめ、Esc はやめるで一覧へ", async () => {
    const list = await sampleList();
    // 一覧の 新しく始める は newGame（上限を見てから newMode のページへ進むのは app）
    const top = titleEntries(LIST, list);
    expect(titleStep(LIST, top.find((e) => e.kind === "newGame")!)).toEqual({ kind: "newGame" });
    const mode: TitlePage = { kind: "newMode" };
    const entries = titleEntries(mode, list);
    expect(entries.map((e) => e.kind)).toEqual(["quick", "custom", "cancel"]);
    expect(titleItems(mode, list, SIZE, S).map((it) => it.lines)).toEqual([["おすすめで始める"], ["自分で作る"], ["やめる"]]);
    expect(titleItems(mode, list, SIZE, S).every((it) => !it.dim && !it.disabled)).toBe(true);
    expect(titleStep(mode, entries[0]!)).toEqual({ kind: "quick" });
    expect(titleStep(mode, entries[1]!)).toEqual({ kind: "custom" });
    expect(titleStep(mode, entries[2]!)).toEqual({ kind: "page", page: { kind: "list" } });
    expect(titleKeyIndex("confirm", entries)).toBe(0);
    expect(titleKeyIndex("back", entries)).toBe(2);
    expect(titleKeyIndex({ menu: 1 }, entries)).toBe(1);
    expect(titleNotice(mode, list, SIZE, S)).toBe(S["title.mode.notice"]);
    // 一覧が空でも同じ
    expect(titleEntries(mode, []).map((e) => e.kind)).toEqual(["quick", "custom", "cancel"]);
  });

  test("UI-50 タイトルの文言が strings にある", () => {
    for (const k of [
      "title.mode.quick",
      "title.mode.custom",
      "title.mode.notice",
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
      "title.loadUnavailable",
      "title.loadMissing",
      "title.maxGames",
    ]) {
      expect(S[k], k).toBeTypeOf("string");
    }
  });
});

describe("書き出し・読み込み（SV-30〜33）", () => {
  test("SV-12/SV-30 読めない記録（broken / tooNew）は 書き出し も disabled（titleStep は none）", async () => {
    const list = await sampleList();
    for (const id of ["c", "d"]) {
      const page: TitlePage = { kind: "game", gameId: id };
      const es = titleEntries(page, list);
      expect(es[1]).toEqual({ kind: "export", gameId: id, disabled: true });
      expect(titleStep(page, es[1]!)).toEqual({ kind: "none" });
      const it = titleItems(page, list, SIZE, S)[1]!;
      expect([it.lines, it.dim, it.disabled]).toEqual([[S["title.export"]], true, true]);
    }
  });

  test("SV-30/SV-31 書き出しの titleStep は export（gameId つき）、読み込みは import", async () => {
    const list = await sampleList();
    const page: TitlePage = { kind: "game", gameId: "b" };
    expect(titleStep(page, titleEntries(page, list)[1]!)).toEqual({ kind: "export", gameId: "b" });
    const top = titleEntries(LIST, list);
    const imp = top[top.length - 1]!;
    expect(imp).toEqual({ kind: "import" });
    expect(titleStep(LIST, imp)).toEqual({ kind: "import" });
    const it = titleItems(LIST, list, SIZE, S).at(-1)!;
    expect([it.lines, it.dim, it.disabled]).toEqual([[S["title.import"]], false, false]);
  });

  test("SV-32 importConfirm は やめる / 読み込む で、先頭（Enter・1）は やめる。やめるで list、読み込むは applyImport。案内は save.importOld と title.importOldDetail の 2 行", async () => {
    const list = await sampleList();
    const page: TitlePage = { kind: "importConfirm", gameId: "a", leader: LEADER, turn: 2, existingTurn: 3 };
    // 一覧に無い gameId（計画は app が持つ）でも同じ
    for (const l of [list, []]) {
      const es = titleEntries(page, l);
      expect(es).toEqual([{ kind: "cancel" }, { kind: "importYes" }]);
      expect(titleKeyIndex("confirm", es)).toBe(0);
      expect(titleKeyIndex({ menu: 0 }, es)).toBe(0);
      expect(titleKeyIndex("back", es)).toBe(0);
      expect(titleStep(page, es[0]!)).toEqual({ kind: "page", page: LIST });
      expect(titleStep(page, es[1]!)).toEqual({ kind: "applyImport" });
      expect(titleItems(page, l, SIZE, S).map((it) => it.lines)).toEqual([[S["title.cancel"]], [S["title.importYes"]]]);
    }
    // importConfirm 以外のページの importYes は何もしない
    expect(titleStep(LIST, { kind: "importYes" })).toEqual({ kind: "none" });
    expect(titleNotice(page, list, SIZE, S)).toBe(`古いデータです。進行が巻き戻ります。\n${LEADER}：2回目の記録（今は3回目）`);
  });

  test("SV-30 exportFileName: wizlike-{先頭 8 字}-{YYYYMMDD}-{HHmm}.json（ローカル時刻、0 詰め）", () => {
    const ms = new Date(2026, 0, 2, 3, 4).getTime();
    expect(exportFileName("12345678-aaaa-4bbb-8ccc-dddddddddddd", ms)).toBe("wizlike-12345678-20260102-0304.json");
    expect(exportFileName("ab", new Date(2026, 11, 31, 23, 59).getTime())).toBe("wizlike-ab-20261231-2359.json");
  });

  test("UI-50/SV-30〜33 書き出し・読み込みの文言が strings にある", () => {
    for (const k of [
      "title.export",
      "title.import",
      "title.importYes",
      "save.importOld",
      "title.importOldDetail",
      "title.importDone",
      "title.importRestored",
      "title.importFull",
      "title.importFormat",
      "title.importBroken",
      "title.importTooNew",
      "title.importChecksum",
      "title.importUnavailable",
      "title.importFailed",
      "title.importReadFailed",
      "title.exportDone",
      "title.exportFailed",
    ]) {
      expect(S[k], k).toBeTypeOf("string");
    }
    // 案内の欄は 2 行（全角 28 字 × 2）。差し込みのない文は 56 字以内
    for (const k of ["title.importFull", "title.importFormat", "title.importBroken", "title.importTooNew", "title.importChecksum", "title.importUnavailable", "title.exportDone"]) {
      expect([...S[k]!].length, k).toBeLessThanOrEqual(56);
    }
  });
});

// ---------------------------------------------------------------- DOM（偽の document）
class FakeEl {
  style: Record<string, string> = {};
  className = "";
  textContent = "";
  type = "";
  accept = "";
  disabled = false;
  value = "";
  href = "";
  download = "";
  rel = "";
  files: unknown[] | null = null;
  clicks = 0;
  removed = false;
  readonly attrs = new Map<string, string>();
  readonly listeners = new Map<string, Array<() => void>>();
  children: FakeEl[] = [];
  constructor(public tagName: string) {}
  setAttribute(k: string, v: string): void {
    this.attrs.set(k, v);
  }
  removeAttribute(k: string): void {
    this.attrs.delete(k);
  }
  replaceChildren(...cs: FakeEl[]): void {
    this.children = [...cs];
  }
  appendChild(c: FakeEl): FakeEl {
    this.children.push(c);
    return c;
  }
  addEventListener(t: string, f: () => void): void {
    this.listeners.set(t, [...(this.listeners.get(t) ?? []), f]);
  }
  emit(t: string): void {
    for (const f of this.listeners.get(t) ?? []) f();
  }
  click(): void {
    this.clicks++;
  }
  remove(): void {
    this.removed = true;
  }
}

function stubDocument(): { created: FakeEl[]; body: FakeEl } {
  const created: FakeEl[] = [];
  const body = new FakeEl("BODY");
  vi.stubGlobal("document", {
    createElement: (tag: string) => {
      const e = new FakeEl(tag.toUpperCase());
      created.push(e);
      return e;
    },
    body,
  });
  return { created, body };
}

describe("file-io の DOM（SV-30 / SV-31）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("SV-31 createFileButton: input[type=file] を重ね、onTap（data-tap）を付けない。change で onFile にファイルを 1 つ渡し value を空に戻す。open() は input.click()、disabled では何もしない", () => {
    stubDocument();
    const got: unknown[] = [];
    const rect = { x: 8, y: 296, w: 108, h: 32 };
    const fb = createFileButton({ label: S["title.import"]!, rect, onFile: (f) => got.push(f) });
    const el = fb.el as unknown as FakeEl;
    expect(el.className).toBe("ui-button");
    expect([el.style["left"], el.style["top"], el.style["width"], el.style["height"]]).toEqual(["8px", "296px", "108px", "32px"]);
    const input = el.children.find((c) => c.tagName === "INPUT")!;
    expect(input).toBeDefined();
    expect(input.type).toBe("file");
    expect(input.accept).toBe("application/json,.json");
    // 全面に重ねた透明の input（display:none にしない）
    expect([input.style["position"], input.style["width"], input.style["height"], input.style["opacity"]]).toEqual(["absolute", "100%", "100%", "0"]);
    expect(input.style["display"]).toBeUndefined();
    // tap.ts の onTap を付けない（data-tap があると押下を追ってしまう）
    for (const e of [el, input, ...el.children]) {
      expect(tapSpecOf(e)).toBeNull();
      expect(e.attrs.has("data-tap")).toBe(false);
    }
    expect(el.children.some((c) => c.textContent === S["title.import"])).toBe(true);
    // change: 1 つ目のファイルを渡し、value を空に戻す
    const file = { name: "x.json" };
    input.files = [file];
    input.value = "C:\\fakepath\\x.json";
    input.emit("change");
    expect(got).toEqual([file]);
    expect(input.value).toBe("");
    // ファイルが無い change（取り消し）は何もしない
    input.files = [];
    input.emit("change");
    expect(got).toHaveLength(1);
    // open() は click、disabled なら何もしない
    fb.open();
    expect(input.clicks).toBe(1);
    fb.setDisabled(true);
    expect(input.disabled).toBe(true);
    expect(el.attrs.get("aria-disabled")).toBe("true");
    expect(el.style["color"]).toBe("var(--c-dim)");
    fb.open();
    expect(input.clicks).toBe(1);
    fb.setDisabled(false);
    expect(input.disabled).toBe(false);
    expect(el.attrs.has("aria-disabled")).toBe(false);
  });

  test("SV-30 downloadText: a の download と href（createObjectURL の値）を付けて click し、2 回目で 1 回目の URL を revoke", () => {
    const { created, body } = stubDocument();
    const blobs: Blob[] = [];
    const revoked: string[] = [];
    let n = 0;
    vi.stubGlobal("URL", {
      createObjectURL: (b: Blob) => {
        blobs.push(b);
        return `blob:${++n}`;
      },
      revokeObjectURL: (u: string) => revoked.push(u),
    });
    downloadText("wizlike-a-20260102-0304.json", JSON.stringify({ a: 1 }));
    const a1 = created.filter((e) => e.tagName === "A")[0]!;
    expect([a1.href, a1.download, a1.clicks, a1.removed]).toEqual(["blob:1", "wizlike-a-20260102-0304.json", 1, true]);
    expect(body.children).toContain(a1);
    expect(blobs[0]!.type).toBe("application/json");
    expect(tapSpecOf(a1)).toBeNull();
    expect(revoked).toEqual([]);
    downloadText("b.json", "{}");
    const a2 = created.filter((e) => e.tagName === "A")[1]!;
    expect([a2.href, a2.download, a2.clicks]).toEqual(["blob:2", "b.json", 1]);
    expect(revoked).toEqual(["blob:1"]);
  });
});

describe("タイトルの SV-40 の案内（DOM）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("SV-40 タイトルの案内: standalone でなければ TITLE_HINT に title.storageHint、standalone なら空（render の第 3 引数）", () => {
    stubDocument();
    const screen = createTitleScreen({ strings: S, onSelect: () => {}, onFile: () => {} });
    const root = screen.el as unknown as FakeEl;
    const hint = root.children.find((c) => c.className === "title-hint")!;
    expect(hint).toBeDefined();
    expect([hint.style["left"], hint.style["top"], hint.style["width"], hint.style["height"]]).toEqual([
      `${TITLE_HINT.x}px`,
      `${TITLE_HINT.y}px`,
      `${TITLE_HINT.w}px`,
      `${TITLE_HINT.h}px`,
    ]);
    // 押せない（onTap を付けない）
    expect(tapSpecOf(hint)).toBeNull();
    const items = titleItems(LIST, [], SIZE, S);
    screen.render(items, titleNotice(LIST, [], SIZE, S), titleHint(false, S));
    expect(hint.textContent).toBe(S["title.storageHint"]);
    screen.render(items, "", titleHint(true, S));
    expect(hint.textContent).toBe("");
    // 案内は 2 行（全角 28 字 × 2 = 56 字）に収まる
    expect([...S["title.storageHint"]!].length).toBeLessThanOrEqual(56);
  });
});
