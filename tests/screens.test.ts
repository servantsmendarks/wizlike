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
  "rules/dungeon": ["visibleCells", "visibleCellsOf", "mapView", "floorOf"],
  state: ["dungeonOf"],
};

describe("入力と Command", () => {
  test("UI-35 表示層が core から値で import するのは execute と状態を変えない問い合わせだけ", () => {
    const re = /import\s+(type\s+)?\{([^}]*)\}\s+from\s+"(?:\.\.\/)+core\/([^"]+)"/g;
    let checked = 0;
    for (const [file, src] of Object.entries(presenterRaw)) {
      for (const m of src.matchAll(re)) {
        if (m[1]) continue; // import type
        const mod = m[3] ?? "";
        const names = (m[2] ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s !== "" && !s.startsWith("type "));
        for (const name of names) {
          checked++;
          expect(ALLOWED_CORE_VALUES[mod] ?? [], `${file}: ${name} from core/${mod}`).toContain(name);
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
