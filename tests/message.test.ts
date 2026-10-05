import { afterEach, describe, expect, test, vi } from "vitest";
import { dungeonLayout, MESSAGE_LINE_H, regions } from "../src/presenter/layout";
import { createMessageWindow, formatMessage, trimHistory, typewriterSteps } from "../src/presenter/views/message";
import { createHistoryView, HISTORY_LINE_H } from "../src/presenter/views/history";
import { battleTurnText, headerText } from "../src/presenter/views/header";
import { formatPartyRow } from "../src/presenter/views/party";
import { sanStage } from "../src/core/rules/san";
import { WRAP_STYLE } from "../src/presenter/views/wrap";
import { data, newGame } from "./helpers/core";
import { kinsokuLines } from "./helpers/wrap";

/** UI-12: app と同じく core の sanStage で段を決める */
const stageOf = (san: number, sanMax: number) => sanStage(san, sanMax, data.config);

describe("message.ts（純粋な部分）", () => {
  test("UI-43 formatMessage の置き換えと、params に無いものの残し方", () => {
    expect(formatMessage("{a}と{b}", { a: "X", b: 3 })).toBe("Xと3");
    // 同じ名前が 2 回あれば両方置き換える
    expect(formatMessage("{a}{a}", { a: 1 })).toBe("11");
    // params に無いものは {k} のまま
    expect(formatMessage("{a} {missing}", { a: "x" })).toBe("x {missing}");
    // params 省略ならそのまま
    expect(formatMessage("{a}")).toBe("{a}");
    // 0 と空文字も値として置き換える
    expect(formatMessage("[{n}][{s}]", { n: 0, s: "" })).toBe("[0][]");
    // 識別子の形でない波括弧は触らない。プロトタイプのキーは値として扱わない
    expect(formatMessage("{ a } {1x} {toString}", { a: "x" })).toBe("{ a } {1x} {toString}");
    // 実データの文言
    expect(formatMessage(data.strings["dungeon.enter"]!, { dungeon: "D" })).not.toContain("{dungeon}");
  });

  test("UI-43 typewriterSteps はコードポイント単位（サロゲートペアを分けない）で、空文字は [\"\"]", () => {
    expect(typewriterSteps("")).toEqual([""]);
    expect(typewriterSteps("abc")).toEqual(["a", "ab", "abc"]);
    expect(typewriterSteps("迷宮")).toEqual(["迷", "迷宮"]);
    // U+20BB7（𠮷）は UTF-16 で 2 単位。途中で切らない
    const s = "a\u{20BB7}b";
    expect(s.length).toBe(4);
    const steps = typewriterSteps(s);
    expect(steps).toEqual(["a", "a\u{20BB7}", s]);
    for (const st of steps) expect(st).not.toMatch(/[\uD800-\uDBFF]$/);
  });

  test("UI-46 trimHistory は末尾の max 件を残し、元の配列を変えない（既定の messageHistory は 200）", () => {
    const xs = [1, 2, 3, 4, 5];
    expect(trimHistory(xs, 3)).toEqual([3, 4, 5]);
    expect(trimHistory(xs, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(trimHistory(xs, 10)).toEqual([1, 2, 3, 4, 5]);
    expect(trimHistory(xs, 0)).toEqual([]);
    expect(trimHistory(xs, 3)).not.toBe(xs);
    expect(xs).toEqual([1, 2, 3, 4, 5]);
    expect(data.config.ui.messageHistory).toBe(200);
    const kept = trimHistory(Array.from({ length: 260 }, (_, i) => i), data.config.ui.messageHistory);
    expect(kept).toHaveLength(200);
    // 古い順に残す（先頭は 60 番目）
    expect(kept[0]).toBe(60);
    expect(kept[199]).toBe(259);
  });
});

describe("header.ts / party.ts（純粋な部分）", () => {
  test("UI-53 headerText は header.dungeon と dir.* から作る", () => {
    // header.dungeon = "{dungeon} {floor}F {dir}"、dir.E = "東"
    const tpl = data.strings["header.dungeon"]!;
    const expected = tpl.replace("{dungeon}", "D").replace("{floor}", "2").replace("{dir}", data.strings["dir.E"]!);
    expect(headerText(data.strings, "D", 2, "E")).toBe(expected);
    for (const f of ["N", "E", "S", "W"] as const) {
      expect(headerText(data.strings, "D", 1, f)).toContain(data.strings[`dir.${f}`]!);
      expect(headerText(data.strings, "D", 1, f)).not.toMatch(/\{/);
    }
  });

  test("UI-54 battleTurnText は battle.turn（第{n}ターン）に n を入れる", () => {
    expect(data.strings["battle.turn"]).toBe("第{n}ターン");
    expect(battleTurnText(data.strings, 1)).toBe("第1ターン");
    expect(battleTurnText(data.strings, 12)).toBe("第12ターン");
    // strings に無ければキーのまま（他の文言と同じ扱い）
    expect(battleTurnText({}, 3)).toBe("battle.turn");
  });

  test("UI-53/ui §2 formatPartyRow は名前・略称・HP を hp/hpMax・MP を mp/mpMax・SAN、状態を party.life.* で出し、生存は空", () => {
    const s = newGame(1);
    // c5 エル（mage、MP 7/7）
    const ch = s.party[4]!;
    expect(ch.classId).toBe("mage");
    const row = formatPartyRow(ch, data.strings, data.classes, stageOf);
    expect(row).toEqual({
      name: ch.name,
      abbr: "MAG",
      hp: `${ch.hp}/${ch.hpMax}`,
      mp: `${ch.mp}/${ch.mpMax}`,
      mpLabel: data.strings["party.mp"],
      san: String(ch.san),
      life: "",
    });
    expect(row.mp).toBe("7/7");
    expect(formatPartyRow({ ...ch, life: "dead", hp: 0 }, data.strings, data.classes, stageOf).life).toBe(data.strings["party.life.dead"]);
    expect(formatPartyRow({ ...ch, life: "ash", hp: 0 }, data.strings, data.classes, stageOf).life).toBe(data.strings["party.life.ash"]);
  });
});

// ---------------------------------------------------------------- MessageWindow（偽の document）
class FakeEl {
  style: Record<string, string> = {};
  className = "";
  textContent = "";
  children: FakeEl[] = [];
  parent: FakeEl | null = null;
  scrollTop = 0;
  scrollHeight = 0;
  setAttribute(): void {}
  appendChild(c: FakeEl): FakeEl {
    c.parent = this;
    this.children.push(c);
    return c;
  }
  append(...c: FakeEl[]): void {
    for (const x of c) this.appendChild(x);
  }
  replaceChildren(...c: FakeEl[]): void {
    this.children = c;
  }
  get childElementCount(): number {
    return this.children.length;
  }
  get firstElementChild(): FakeEl | null {
    return this.children[0] ?? null;
  }
  remove(): void {
    if (this.parent !== null) this.parent.children = this.parent.children.filter((x) => x !== this);
  }
  animate(): { finished: Promise<void>; cancel(): void } {
    return { finished: Promise.resolve(), cancel() {} };
  }
}

describe("MessageWindow", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("UI-11/UI-43/UI-46 窓は指でスクロールしない（overflow hidden）。窓の DOM には直近の lines × 2 文だけを残し、全文は history() に messageHistory 件まで古い順に持つ。log は窓に出さず履歴にだけ足す", async () => {
    const created: FakeEl[] = [];
    vi.stubGlobal("document", {
      createElement: () => {
        const e = new FakeEl();
        created.push(e);
        return e;
      },
      createElementNS: () => new FakeEl(),
    });
    const g = regions(data.config.ui.layout, data.config.stage.width);
    const L = dungeonLayout(g, data.config.party.size);
    expect(L.message.lines).toBe(6);
    const w = createMessageWindow({ speed: () => 0, historyMax: 15, region: g.message, layout: L.message });
    const box = created.find((e) => e.className === "message-history")!;
    // 指ではスクロールしない
    expect(box.style["overflow"]).toBe("hidden");
    expect(box.style["touchAction"]).toBe("none");
    for (let i = 0; i < 20; i++) await w.say(`s${i}`, true);
    w.log("dice");
    expect(box.children.map((c) => c.textContent)).toEqual(Array.from({ length: 12 }, (_, i) => `s${i + 8}`));
    expect(w.history()).toEqual([...Array.from({ length: 14 }, (_, i) => `s${i + 6}`), "dice"]);
    expect(w.typing()).toBe(false);
    // waitMs は 0 以下なら即座に解決する（animate も呼ばない）。正なら finished を待つ
    await w.waitMs(0);
    await w.waitMs(400);
    w.clear();
    expect(w.history()).toEqual([]);
    expect(box.children).toEqual([]);
  });

  test("UI-11/UI-43 文字領域の見える高さは行の高さの整数倍（lines × MESSAGE_LINE_H）で、余りは上の余白にする（末尾を見せたときに最上段が切れない）", () => {
    const created: FakeEl[] = [];
    vi.stubGlobal("document", {
      createElement: () => {
        const e = new FakeEl();
        created.push(e);
        return e;
      },
      createElementNS: () => new FakeEl(),
    });
    const g = regions(data.config.ui.layout, data.config.stage.width);
    const L = dungeonLayout(g, data.config.party.size);
    createMessageWindow({ speed: () => 0, historyMax: 15, region: g.message, layout: L.message });
    const box = created.find((e) => e.className === "message-history")!;
    const top = Number.parseFloat(box.style["top"]!);
    const height = Number.parseFloat(box.style["height"]!);
    expect(height).toBe(L.message.lines * MESSAGE_LINE_H);
    // 下端は文字領域の下端のまま（枠 1px の内側が原点）
    expect(top + height).toBe(L.message.text.y - g.message.y - 1 + L.message.text.h);
    // 既定（70px の窓、文字領域 66px）では 6 行 60px、上の余白 6px
    expect({ top, height }).toEqual({ top: 7, height: 60 });
  });

  test("UI-43/UI-11/UI-52 窓の文字は常に下詰め（最新の行が窓の下端）。行が窓に満たないうちも上を空け、あふれた分は上で切る（広げた一覧で窓の下 2 行に語りが見える）", async () => {
    const created: FakeEl[] = [];
    vi.stubGlobal("document", {
      createElement: () => {
        const e = new FakeEl();
        created.push(e);
        return e;
      },
      createElementNS: () => new FakeEl(),
    });
    const g = regions(data.config.ui.layout, data.config.stage.width);
    const L = dungeonLayout(g, data.config.party.size);
    const w = createMessageWindow({ speed: () => 0, historyMax: 15, region: g.message, layout: L.message });
    const box = created.find((e) => e.className === "message-history")!;
    expect({ display: box.style["display"], flexDirection: box.style["flexDirection"], justifyContent: box.style["justifyContent"] }).toEqual({
      display: "flex",
      flexDirection: "column",
      justifyContent: "flex-end",
    });
    // 1 文だけでも下端に置く（行は縮めない）
    await w.say("何を買う？", true);
    expect(box.children).toHaveLength(1);
    expect(box.children[0]!.style["flexShrink"]).toBe("0");
  });

  test("UI-46/UI-11 履歴の画面の一覧（history-list）の見える高さは行の高さの整数倍で、余りは上（題との間）の余白にする（末尾まで送ったときに最上段の行が切れない）", () => {
    const created: FakeEl[] = [];
    vi.stubGlobal("document", {
      createElement: () => {
        const e = new FakeEl();
        created.push(e);
        return e;
      },
      createElementNS: () => new FakeEl(),
    });
    const g = regions(data.config.ui.layout, data.config.stage.width);
    const L = dungeonLayout(g, data.config.party.size);
    createHistoryView(L.history);
    const list = created.find((e) => e.className === "history-list")!;
    const top = Number.parseFloat(list.style["top"]!);
    const height = Number.parseFloat(list.style["height"]!);
    expect(height % HISTORY_LINE_H).toBe(0);
    // 下端は従来の一覧の下端のまま（一覧の領域から枠の 2 を引いた高さ）、余りは行の高さ未満
    const space = L.history.list.h - 2;
    expect(top + height).toBe(L.history.list.y - L.history.overlay.y + space);
    expect(space - height).toBeGreaterThanOrEqual(0);
    expect(space - height).toBeLessThan(HISTORY_LINE_H);
    // 既定（一覧の領域 240×208）では 20 行 200px、題（12px）の下に 6px の余白
    expect({ top, height }).toEqual({ top: 18, height: 200 });
  });

  test("UI-43 文字送りの途中は typing() が真で、rush で即座に全文になる", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("document", { createElement: () => new FakeEl(), createElementNS: () => new FakeEl() });
    const g = regions(data.config.ui.layout, data.config.stage.width);
    const L = dungeonLayout(g, data.config.party.size);
    const w = createMessageWindow({ speed: () => 30, historyMax: 200, region: g.message, layout: L.message });
    const p = w.say("abc", false);
    expect(w.typing()).toBe(true);
    w.rush();
    await p;
    expect(w.typing()).toBe(false);
    expect(w.history()).toEqual(["abc"]);
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------- 禁則（M7）
// vitest は CSS の import を空にするので、node の fs で読む（@types/node は入れていないので型は手で書く。tap.test.ts と同じ）
const FS_MODULE = "node:fs";
const fs = (await import(/* @vite-ignore */ FS_MODULE)) as {
  readFileSync(p: URL, enc: "utf8"): string;
  readdirSync(p: URL): string[];
};

describe("UI-43/UI-46 折り返しの禁則（M7）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("UI-43/UI-46 WRAP_STYLE は pre-wrap・word-break normal・line-break strict・overflow-wrap anywhere（anywhere の line-break は禁則を切るので使わない）", () => {
    expect(WRAP_STYLE).toEqual({ whiteSpace: "pre-wrap", wordBreak: "normal", lineBreak: "strict", overflowWrap: "anywhere" });
  });

  test("UI-43/UI-46 メッセージ窓（message-history）と履歴の画面の一覧（history-list）は WRAP_STYLE で折り返す", () => {
    const created: FakeEl[] = [];
    vi.stubGlobal("document", {
      createElement: () => {
        const e = new FakeEl();
        created.push(e);
        return e;
      },
      createElementNS: () => new FakeEl(),
    });
    const g = regions(data.config.ui.layout, data.config.stage.width);
    const L = dungeonLayout(g, data.config.party.size);
    createMessageWindow({ speed: () => 0, historyMax: 15, region: g.message, layout: L.message });
    createHistoryView(L.history);
    for (const cls of ["message-history", "history-list"]) {
      const el = created.find((e) => e.className === cls)!;
      for (const [k, v] of Object.entries(WRAP_STYLE)) expect(el.style[k], `${cls}.${k}`).toBe(v);
    }
  });

  test("UI-43/UI-46 表示層の style.css と views/*.ts に line-break: anywhere と word-break: break-all が残っていない（開発用のデータの誤りの画面を除く）", () => {
    const css = fs.readFileSync(new URL("../src/presenter/style.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).not.toMatch(/line-break:\s*anywhere/);
    const breakAll = Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g))
      .filter((m) => /word-break:\s*break-all/.test(m[2]!))
      .map((m) => m[1]!.trim());
    expect(breakAll).toEqual([".data-error-list"]);
    const dir = new URL("../src/presenter/views/", import.meta.url);
    for (const name of fs.readdirSync(dir).filter((n) => n.endsWith(".ts"))) {
      const src = fs.readFileSync(new URL(name, dir), "utf8");
      expect(src, name).not.toMatch(/lineBreak:\s*"anywhere"/);
      expect(src, name).not.toMatch(/wordBreak:\s*"break-all"/);
    }
  });

  test("UI-43 禁則の近似（helpers/wrap.ts）: 29 字ちょうどの後の「。」は行頭に来ず、前の字ごと次の行へ送られる（実機の報告の town.look.gm）", () => {
    const gm = data.strings["town.look.gm"]!;
    expect(kinsokuLines(gm, 29)).toEqual(["GMがサイコロを指先で転がしながら、卓の様子をうかがってい", "る。"]);
    for (const c of ["。", "、", "」", "）", "！", "？", "…", "ー", "ゃ", ")"]) {
      const lines = kinsokuLines("あ".repeat(29) + c + "次", 29);
      expect(lines, c).toEqual(["あ".repeat(28), "あ" + c + "次"]);
    }
    // 開き括弧は行末に残さない
    expect(kinsokuLines("あ".repeat(28) + "「次」", 29)).toEqual(["あ".repeat(28), "「次」"]);
  });
});
