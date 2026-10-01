// 画面（タイトル以外）の純粋な部分: 簡易作成（UI-51）の性格の巡回と PartySetup、街（UI-52）のリスト。
import { describe, expect, test } from "vitest";
import { createInitialState, execute } from "../src/core/engine";
import { validatePartySetup } from "../src/core/rules/creation";
import {
  buildPartySetup,
  defaultPersonalities,
  nextPersonality,
  personalityLabel,
  randomizePersonalities,
} from "../src/presenter/views/creation";
import { townEntries, townEntryLabel } from "../src/presenter/views/town";
import { formatPartyRow, PARTY_COLUMNS } from "../src/presenter/views/party";
import { createRunGate } from "../src/presenter/run-gate";
import type { Command, GameEvent } from "../src/core/types";
import { data, newGame } from "./helpers/core";

const ids = data.personalities.map((p) => p.id);

describe("簡易作成", () => {
  test("UI-51 既定の性格: リーダー（行 0）は null、残りは personalities の配列順に巡回", () => {
    expect(ids).toEqual(["cautious", "reckless", "greedy", "normal"]);
    expect(defaultPersonalities(ids, 6)).toEqual([null, "cautious", "reckless", "greedy", "normal", "cautious"]);
  });

  test("UI-51/CH-30 性格のボタンは 配列順 → おまかせ(random) → 先頭 と巡回し、リーダーは null のまま", () => {
    expect(nextPersonality("cautious", ids)).toBe("reckless");
    expect(nextPersonality("greedy", ids)).toBe("normal");
    expect(nextPersonality("normal", ids)).toBe("random");
    expect(nextPersonality("random", ids)).toBe("cautious");
    expect(nextPersonality(null, ids)).toBe(null);
  });

  test("UI-51 「ランダム」はリーダー以外を random にする", () => {
    expect(randomizePersonalities([null, "cautious", "normal", "random", "greedy", "reckless"])).toEqual([null, "random", "random", "random", "random", "random"]);
  });

  test("UI-51 性格の表示名は personalities[].name、random は creation.personality.random、リーダーは creation.leader", () => {
    expect(personalityLabel("reckless", data, data.strings)).toBe(data.personalities[1]?.name);
    expect(personalityLabel("random", data, data.strings)).toBe(data.strings["creation.personality.random"]);
    expect(personalityLabel(null, data, data.strings)).toBe(data.strings["creation.leader"]);
  });

  test("UI-51/CH-05 既定名と既定の性格で作った PartySetup を core が受け付け、空の名前は rejected（表示層は検査しない）", () => {
    const names = data.config.prototypeParty.members.map((m) => m.defaultName);
    const setup = buildPartySetup(names, defaultPersonalities(ids, names.length));
    expect(setup.members[0]).toEqual({ name: names[0], personality: null });
    expect(validatePartySetup(setup, data)).toBeNull();
    const s0 = createInitialState(7, data);
    const ok = execute(s0, { type: "game.new", party: setup }, data);
    expect(ok.state.screen).toBe("town");
    const bad = execute(s0, { type: "game.new", party: buildPartySetup(["", ...names.slice(1)], defaultPersonalities(ids, 6)) }, data);
    expect(bad.events).toEqual([{ kind: "rejected", command: "game.new", reason: "invalid name at 0" }]);
  });
});

describe("パーティ欄", () => {
  test("UI-54/CH-44 formatPartyRow の状態の列: 生存なら状態異常の短い名前を空白区切り、死亡・灰はそれだけ", () => {
    const ch = newGame(1).party[0]!;
    const st = (k: string): string => data.strings[`party.status.${k}`]!;
    expect(formatPartyRow(ch, data.strings, data.classes).life).toBe("");
    expect(formatPartyRow({ ...ch, status: ["poison", "sleep"] }, data.strings, data.classes).life).toBe(`${st("poison")} ${st("sleep")}`);
    expect(formatPartyRow({ ...ch, status: ["poison", "sleep"] }, data.strings, data.classes).life).toBe("毒 眠");
    expect(formatPartyRow({ ...ch, status: ["stone"] }, data.strings, data.classes).life).toBe(st("stone"));
    // 死亡・灰は状態異常を出さない
    expect(formatPartyRow({ ...ch, life: "dead", hp: 0, status: ["poison"] }, data.strings, data.classes).life).toBe(data.strings["party.life.dead"]);
    expect(formatPartyRow({ ...ch, life: "ash", hp: 0, status: ["paralysis"] }, data.strings, data.classes).life).toBe(data.strings["party.life.ash"]);
  });

  test("ui §2 X1/X2 formatPartyRow の略称は classes[].abbr（fighter → WAR …）。知らない職業は空", () => {
    const party = newGame(1).party;
    expect(party.map((ch) => formatPartyRow(ch, data.strings, data.classes).abbr)).toEqual(["WAR", "WAR", "THI", "PRI", "MAG", "THI"]);
    const want: Record<string, string> = { fighter: "WAR", thief: "THI", priest: "PRI", mage: "MAG", samurai: "SAM", lord: "LOR", bishop: "BIS" };
    for (const c of data.classes) expect(formatPartyRow({ ...party[0]!, classId: c.id }, data.strings, data.classes).abbr, c.id).toBe(want[c.id]);
    expect(formatPartyRow({ ...party[0]!, classId: "nope" }, data.strings, data.classes).abbr).toBe("");
  });

  test("ui §2 X2 mpMax が 0 のメンバー（戦士・盗賊）は MP の値とラベルを空欄にする。mpMax が 1 以上なら mp/mpMax とラベル", () => {
    const party = newGame(1).party;
    const c1 = formatPartyRow(party[0]!, data.strings, data.classes); // アルド（fighter、MP 0/0）
    expect(party[0]!.mpMax).toBe(0);
    expect([c1.mp, c1.mpLabel]).toEqual(["", ""]);
    const c4 = formatPartyRow(party[3]!, data.strings, data.classes); // ドナ（priest、MP 5/5）
    expect([c4.mp, c4.mpLabel]).toEqual(["5/5", data.strings["party.mp"]]);
    // 現在値が 0 でも mpMax があれば空欄にしない
    expect(formatPartyRow({ ...party[3]!, mp: 0 }, data.strings, data.classes).mp).toBe("0/5");
  });

  test("ui §2 X2 パーティの行の列は 名前 / 略称 / HP / MP / SAN / 状態 の順で、重ならず、右端は 240 以内。幅は美咲（半角 4px・全角 8px）で中身が入る", () => {
    const order = ["name", "abbr", "hpLabel", "hp", "mpLabel", "mp", "sanLabel", "san", "status"] as const;
    expect(Object.keys(PARTY_COLUMNS)).toEqual([...order]);
    for (let i = 1; i < order.length; i++) {
      const a = PARTY_COLUMNS[order[i - 1]!];
      expect(a.left + a.width, order[i]).toBeLessThanOrEqual(PARTY_COLUMNS[order[i]!].left);
    }
    const last = PARTY_COLUMNS.status;
    expect(last.left + last.width).toBeLessThanOrEqual(240);
    expect(PARTY_COLUMNS.name.width).toBeGreaterThanOrEqual(6 * 8); // 全角 6 文字
    expect(PARTY_COLUMNS.abbr.width).toBeGreaterThanOrEqual(3 * 4); // ASCII 3 文字
    expect(PARTY_COLUMNS.hp.width).toBeGreaterThanOrEqual("999/999".length * 4);
    expect(PARTY_COLUMNS.mp.width).toBeGreaterThanOrEqual("999/999".length * 4);
    expect(PARTY_COLUMNS.san.width).toBeGreaterThanOrEqual("100".length * 4);
    // 状態の列: 4 つの状態異常の短い名前を空白区切り（全角 4 + 半角 3）
    expect(PARTY_COLUMNS.status.width).toBeGreaterThanOrEqual(4 * 8 + 3 * 4);
    for (const k of ["hp", "mp", "san"] as const) expect(PARTY_COLUMNS[k].right, k).toBe(true);
  });
});

describe("街", () => {
  test("UI-52 施設メニューは「迷宮へ」だけ。迷宮の入口は unlockedDungeons の順と「戻る」", () => {
    const s = newGame(1);
    expect(townEntries("menu", s)).toEqual([{ kind: "gate" }]);
    expect(townEntries("gate", s)).toEqual([{ kind: "enter", dungeonId: "d01" }, { kind: "back" }]);
    expect(townEntryLabel({ kind: "gate" }, data, data.strings)).toBe(data.strings["town.menu.dungeon"]);
    expect(townEntryLabel({ kind: "enter", dungeonId: "d01" }, data, data.strings)).toBe(data.dungeons[0]?.name);
    expect(townEntryLabel({ kind: "back" }, data, data.strings)).toBe(data.strings["common.back"]);
  });
});

// UI-35: 表示層は入力を Command にして execute へ渡すだけ。core のルール関数（moveForward、turn、
// enterDungeon、chooseOption、markExplored など状態を変えるもの）を直接呼ばない。
// core から値として import してよいのは、execute / createInitialState と、状態を変えない問い合わせだけ。
const presenterRaw = import.meta.glob("../src/presenter/**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const ALLOWED_CORE_VALUES: Record<string, readonly string[]> = {
  engine: ["execute", "createInitialState"],
  // decisions の UI-35 の行のとおり。floorOf / visibleCellsOf は Floor（kind・trapId・eventId）に触れるので許さない
  "rules/dungeon": ["visibleCells", "mapView"],
  state: ["dungeonOf"],
  // M3: 戦闘の入力の段階・オートの連鎖は battleMenu の値だけで決める（行動できるか・使えるか・揃ったかを core が返す）
  "rules/combat": ["battleMenu"],
};

/** コメントを除いた本文（文字列の中の // や /* は考えない最小限の除去。presenter に該当する文字列は無い） */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

type CoreRef = { file: string; text: string; mod: string; typeOnly: boolean; names: string[] | null };

/**
 * 表示層のソースから core を参照する import / export 文と動的 import() を形を問わず拾う。
 * names は名前付き（{ ... }）のときだけ値の名前の一覧、それ以外（名前空間・default・export *・動的）は null。
 */
function coreRefs(file: string, src: string): CoreRef[] {
  const code = stripComments(src);
  const out: CoreRef[] = [];
  const coreSpec = /^(?:\.\.?\/)+(?:.*\/)?core\/(.+)$/;
  const stmt = /^[ \t]*(?:import|export)\b([^;]*?)\bfrom\s*(["'])([^"'\n]+)\2/gm;
  for (const m of code.matchAll(stmt)) {
    const core = coreSpec.exec(m[3]!);
    if (core === null) continue;
    const clause = m[1]!.trim();
    const typeOnly = /^type\b/.test(clause);
    const braces = /^(?:type\s+)?\{([^}]*)\}$/.exec(clause);
    const names =
      braces === null
        ? null
        : braces[1]!
            .split(",")
            .map((x) => x.trim())
            .filter((x) => x !== "" && !x.startsWith("type "))
            .map((x) => x.split(/\s+as\s+/)[0]!.trim());
    out.push({ file, text: m[0].trim(), mod: core[1]!.replace(/\.(?:ts|js)$/, ""), typeOnly, names });
  }
  const bare = /^[ \t]*import\s*(["'])([^"'\n]+)\1/gm;
  for (const m of code.matchAll(bare)) {
    const core = coreSpec.exec(m[2]!);
    if (core !== null) out.push({ file, text: m[0].trim(), mod: core[1]!, typeOnly: false, names: null });
  }
  for (const m of code.matchAll(/\bimport\s*\(\s*(["'`])([^"'`]*)\1/g)) {
    if (/core\//.test(m[2]!)) out.push({ file, text: m[0], mod: m[2]!, typeOnly: false, names: null });
  }
  return out;
}

/** coreRefs から出た違反の一覧（空なら合格） */
function coreViolations(refs: readonly CoreRef[]): string[] {
  const bad: string[] = [];
  for (const r of refs) {
    if (r.typeOnly) continue;
    if (r.names === null) {
      bad.push(`${r.file}: ${r.text}（名前付き以外の値の import / export は不可）`);
      continue;
    }
    for (const name of r.names) {
      if (!(ALLOWED_CORE_VALUES[r.mod] ?? []).includes(name)) bad.push(`${r.file}: ${name} from core/${r.mod}`);
    }
  }
  return bad;
}

describe("入力と Command", () => {
  test("UI-35 表示層が core から値で import するのは execute と状態を変えない問い合わせだけ（形を問わず拾う）", () => {
    const refs = Object.entries(presenterRaw).flatMap(([file, src]) => coreRefs(file, src));
    expect(coreViolations(refs)).toEqual([]);
    // 実際に値の import を照合している（app.ts の execute など）
    expect(refs.filter((r) => !r.typeOnly && r.names !== null).flatMap((r) => r.names!)).toContain("execute");
  });

  test("UI-35 検査は名前空間・default・export from・export *・動的 import()・許可外の名前を違反として拾い、import type は通す", () => {
    const src = [
      'import * as d from "../core/rules/dungeon";',
      'import eng from "../../core/engine";',
      'export { floorOf } from "../core/rules/dungeon";',
      'export * from "../core/state";',
      'const m = await import("../core/rules/dungeon");',
      'import { floorOf, visibleCells } from "../core/rules/dungeon";',
      'import { execute as ex } from "../core/engine";',
      'import type { Floor } from "../core/types";',
      'import { type Cell } from "../core/types";',
      '// import { moveForward } from "../core/rules/dungeon";',
    ].join("\n");
    const bad = coreViolations(coreRefs("x.ts", src));
    expect(bad).toHaveLength(6);
    expect(bad.some((b) => b.includes("import * as d"))).toBe(true);
    expect(bad.some((b) => b.includes("import eng"))).toBe(true);
    expect(bad.some((b) => b.includes("floorOf from core/rules/dungeon"))).toBe(true); // export { floorOf } と import { floorOf } の 2 件
    expect(bad.some((b) => b.includes("export * from"))).toBe(true);
    expect(bad.some((b) => b.includes("import("))).toBe(true);
    expect(bad.filter((b) => b.includes("floorOf"))).toHaveLength(2);
  });
});

describe("再生中の入力（UI-44）", () => {
  test("UI-44 再生中に送ったコマンドは捨てられ（null）、execute は 1 回だけ呼ばれる。再生が終われば次を受け付け、例外の後も門は開く", async () => {
    let state = execute(newGame(3), { type: "dungeon.enter", dungeonId: "d01" }, data).state;
    let calls = 0;
    let finishPlay: () => void = () => {};
    let starts = 0;
    const gate = createRunGate<Command, readonly GameEvent[]>({
      onStart: () => starts++,
      exec: async (cmd) => {
        calls++;
        const r = execute(state, cmd, data);
        state = r.state;
        // 再生（player.play）の代わり。finishPlay を呼ぶまで終わらない
        await new Promise<void>((resolve) => {
          finishPlay = resolve;
        });
        return r.events;
      },
    });
    const turn: Command = { type: "dungeon.turn", dir: "right" };
    const first = gate.run(turn);
    expect(gate.busy()).toBe(true);
    expect(await gate.run(turn)).toBeNull();
    expect(await gate.run({ type: "dungeon.move" })).toBeNull();
    expect(calls).toBe(1);
    expect(starts).toBe(1);
    finishPlay();
    expect((await first)?.[0]?.kind).toBe("turned");
    expect(gate.busy()).toBe(false);
    // 次のコマンドは受け付ける
    const second = gate.run(turn);
    expect(calls).toBe(2);
    finishPlay();
    expect(await second).not.toBeNull();

    // exec が例外を投げても null を返し、門は閉じたままにならない
    const errors: unknown[] = [];
    const failing = createRunGate<number, number>({
      exec: async () => {
        throw new Error("boom");
      },
      onError: (e) => errors.push(e),
    });
    expect(await failing.run(1)).toBeNull();
    expect(errors).toHaveLength(1);
    expect(failing.busy()).toBe(false);
  });
});
