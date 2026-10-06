// 画面（タイトル以外）の純粋な部分: 簡易作成（UI-51）の性格の巡回と PartySetup、パーティ欄。街（UI-52）は town-view.test.ts。
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
import { formatPartyRow, PARTY_COLUMNS } from "../src/presenter/views/party";
import { sanStage } from "../src/core/rules/san";
import { createRunGate } from "../src/presenter/run-gate";
import type { Command, GameEvent } from "../src/core/types";
import { data, newGame } from "./helpers/core";

const ids = data.personalities.map((p) => p.id);
/** UI-12: app と同じく core の sanStage で段を決める */
const stageOf = (san: number, sanMax: number) => sanStage(san, sanMax, data.config);

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
    expect(formatPartyRow(ch, data.strings, data.classes, stageOf).life).toBe("");
    expect(formatPartyRow({ ...ch, status: ["poison", "sleep"] }, data.strings, data.classes, stageOf).life).toBe(`${st("poison")} ${st("sleep")}`);
    expect(formatPartyRow({ ...ch, status: ["poison", "sleep"] }, data.strings, data.classes, stageOf).life).toBe("毒 眠");
    expect(formatPartyRow({ ...ch, status: ["stone"] }, data.strings, data.classes, stageOf).life).toBe(st("stone"));
    // 死亡・灰は状態異常を出さない
    expect(formatPartyRow({ ...ch, life: "dead", hp: 0, status: ["poison"] }, data.strings, data.classes, stageOf).life).toBe(data.strings["party.life.dead"]);
    expect(formatPartyRow({ ...ch, life: "ash", hp: 0, status: ["paralysis"] }, data.strings, data.classes, stageOf).life).toBe(data.strings["party.life.ash"]);
  });

  test("UI-12/CH-53 formatPartyRow の状態の列に SAN の段（sanMax 100 で 50 / 49 / 25 / 24 / 0 の境界）。normal・死亡・灰は段を出さない", () => {
    const ch = { ...newGame(1).party[1]!, sanMax: 100 };
    const sanOf = (k: string): string => data.strings[`party.san.${k}`]!;
    const life = (patch: Partial<typeof ch>): string => formatPartyRow({ ...ch, ...patch }, data.strings, data.classes, stageOf).life;
    // 手計算: uneasyRatio 0.5 → 50 未満で不安、confusedRatio 0.25 → 25 未満で錯乱、0 で虚脱（CH-53）
    expect(life({ san: 100 })).toBe("");
    expect(life({ san: 50 })).toBe("");
    expect(life({ san: 49 })).toBe(sanOf("uneasy"));
    expect(life({ san: 25 })).toBe(sanOf("uneasy"));
    expect(life({ san: 24 })).toBe(sanOf("confused"));
    expect(life({ san: 0 })).toBe(sanOf("broken"));
    expect([sanOf("uneasy"), sanOf("confused"), sanOf("broken")]).toEqual(["不安", "錯乱", "虚脱"]);
    // 状態異常の後ろに空白区切りで足す
    expect(life({ san: 24, status: ["poison"] })).toBe(`${data.strings["party.status.poison"]} ${sanOf("confused")}`);
    // 死亡・灰はそれだけ
    expect(life({ san: 0, life: "dead", hp: 0 })).toBe(data.strings["party.life.dead"]);
    expect(life({ san: 10, life: "ash", hp: 0 })).toBe(data.strings["party.life.ash"]);
  });

  test("UI-12 パーティ欄の段は core の sanStage を app から渡す（表示層で境を計算しない）。setSan は状態の列も描き直す（ソースの検査）", () => {
    const app = stripComments(presenterRaw["../src/presenter/app.ts"]!);
    expect(app).toMatch(/stageOf: \(san, sanMax\) => sanStage\(san, sanMax, data\.config\)/);
    const party = stripComments(presenterRaw["../src/presenter/views/party.ts"]!);
    expect(party).not.toMatch(/uneasyRatio|confusedRatio/);
    expect(party).toMatch(/setSan\(id: string, san: number\): void \{[\s\S]*?showCondition\(row\);[\s\S]*?\},/);
  });

  test("ui §2 X1/X2 formatPartyRow の略称は classes[].abbr（fighter → WAR …）。知らない職業は空", () => {
    const party = newGame(1).party;
    expect(party.map((ch) => formatPartyRow(ch, data.strings, data.classes, stageOf).abbr)).toEqual(["WAR", "WAR", "THI", "PRI", "MAG", "THI"]);
    const want: Record<string, string> = { fighter: "WAR", thief: "THI", priest: "PRI", mage: "MAG", samurai: "SAM", lord: "LOR", bishop: "BIS" };
    for (const c of data.classes) expect(formatPartyRow({ ...party[0]!, classId: c.id }, data.strings, data.classes, stageOf).abbr, c.id).toBe(want[c.id]);
    expect(formatPartyRow({ ...party[0]!, classId: "nope" }, data.strings, data.classes, stageOf).abbr).toBe("");
  });

  test("ui §2 X2 mpMax が 0 のメンバー（戦士・盗賊）は MP の値とラベルを空欄にする。mpMax が 1 以上なら mp/mpMax とラベル", () => {
    const party = newGame(1).party;
    const c1 = formatPartyRow(party[0]!, data.strings, data.classes, stageOf); // アルド（fighter、MP 0/0）
    expect(party[0]!.mpMax).toBe(0);
    expect([c1.mp, c1.mpLabel]).toEqual(["", ""]);
    const c4 = formatPartyRow(party[3]!, data.strings, data.classes, stageOf); // ドナ（priest、MP 5/5）
    expect([c4.mp, c4.mpLabel]).toEqual(["5/5", data.strings["party.mp"]]);
    // 現在値が 0 でも mpMax があれば空欄にしない
    expect(formatPartyRow({ ...party[3]!, mp: 0 }, data.strings, data.classes, stageOf).mp).toBe("0/5");
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
  // M5.5 UI-20: 察知した罠の印は visibleKnownTraps（視野の中の knownTraps の {depth, lane}）
  "rules/dungeon": ["visibleCells", "mapView", "visibleKnownTraps"],
  // UI-59: キャンプの状態の装備名（鑑定を反映した表示名。CH-72）
  state: ["dungeonOf", "itemDisplayName"],
  // M3: 戦闘の入力の段階・オートの連鎖は battleMenu の値だけで決める（行動できるか・使えるか・揃ったかを core が返す）
  "rules/combat": ["battleMenu"],
  // M4 SV-50 / UI-52: 続きからの救済の申し出（resume.ts）と街のページ。料金・可否・候補は townMenu の値だけで決める
  "rules/town": ["townMenu"],
  // M4 UI-53: 迷宮の道具の候補・押せるか・対象の要否は fieldItemMenu の値だけで決める
  "rules/items": ["fieldItemMenu"],
  // M4.5 UI-53 / TW-03: キャンプと酒場の候補・押せるか・対象の要否は campMenu の値だけで決める。キャンプの top の要約は campSummary
  "rules/camp": ["campMenu", "campSummary"],
  // M4.5 UI-25 / DG-15: 地図のタップ移動の経路と、自動歩行を続けてよいかは core が決める
  "rules/pathfind": ["planRoute", "routeStepOk"],
  // M5 UI-12: パーティ欄の SAN の段は core の sanStage で決める（境の比率を表示層で持たない）
  // M7 UI-12 / UI-59 / TW-15: SAN の最大として描く値と、士気の超過の色の基準は core の sanCapOf（B で実効の sanMax になる）
  "rules/san": ["sanStage", "sanCapOf"],
  // M7 UI-59 / UI-12 / IT-66: 品の詳細・状態とパーティ欄の実効の値（能力値・最大値・AC・魔法攻撃力）・図鑑は core の問い合わせの値を描く（IT-35）
  "rules/item-view": ["itemDetail", "memberSheet", "uniqueBookView"],
  // M5.5 UI-62 / CH-06: 自分で作るの配分の可否・残り・職業の条件・名前の長さは core の関数の値だけで決める。
  // 作成中はまだ GameState が無いので、ボーナスの振り（rollBonus）は表示層が持つ RngState（createRng。種は crypto）で引く（決定 5 の例外）
  "rules/creation": ["rollBonus", "statAllocation", "adjustStat", "classOptions", "validCreationName"],
  // M7 UI-57: debug パネルの「SAN+{n}」のラベルの n（core が足す量の定数。値を表示に使うだけ）
  "rules/debug": ["SAN_OVER_DEBUG"],
  // M7 TW-17: 強化の確認の段の成功率・大成功・料金・可否は core の upgradePreview の値を描く
  "rules/upgrade": ["upgradePreview"],
  rng: ["createRng"],
  // 能力値の並び（CH-10）。列挙の定数
  "data/index": ["STAT_KEYS"],
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
  test("UI-36 表示層で click のリスナーを付けるのは input/tap.ts だけ（押せるものは onTap で登録する）。ゴーストクリックの抑止と .play-swipe の層は無い", () => {
    const files = Object.keys(presenterRaw);
    expect(files.length).toBeGreaterThan(10);
    const withClick = Object.entries(presenterRaw)
      .filter(([, src]) => /addEventListener\(\s*["'`]click["'`]/.test(stripComments(src)))
      .map(([file]) => file);
    expect(withClick).toEqual(["../src/presenter/input/tap.ts"]);
    for (const [file, src] of Object.entries(presenterRaw)) {
      const code = stripComments(src);
      expect(code, file).not.toMatch(/createGhostClickGuard|GHOST_CLICK_MS|play-swipe|setSwipeEnabled/);
      // 押せるものを pointerdown で直接反応させない（ステージ 1 か所で受ける）。一覧の注目（onFocus）だけは例外
      if (file !== "../src/presenter/input/tap.ts" && file !== "../src/presenter/views/controls.ts") {
        expect(code, file).not.toMatch(/addEventListener\(\s*["'`]pointer(?:down|up)["'`]/);
      }
    }
  });

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

  test("UI-50/UI-62/SV-50 新しく始めるは上限を見てから作り方の選択へ。自分で作るは goCustom のたびに crypto の種で乱数を作り直し、下書きは保存しない（ソースの検査）", () => {
    const app = stripComments(presenterRaw["../src/presenter/app.ts"]!);
    const goCustom = /const goCustom = \(\): void => \{([\s\S]*?)\n {2}\};/.exec(app)?.[1] ?? "";
    expect(goCustom).toMatch(/customRng = createRng\(crypto\.getRandomValues\(new Uint32Array\(1\)\)\[0\] \?\? 1\);/);
    expect(goCustom).toMatch(/customDraft = initialDraft\(data\);/);
    expect(goCustom).toMatch(/showRoute\("custom"\)/);
    expect(app).toMatch(/titlePage = \{ kind: "newMode" \};/);
    expect(app).toMatch(/custom\.el\.style\.display = r === "custom" \? "" : "none";/);
    // 自分で作るの値は game.new の setup で渡すだけで、run 以外で保存先に触れない
    const choose = /const chooseCustom = \(c: CustomChoice\): void => \{([\s\S]*?)\n {2}\};/.exec(app)?.[1] ?? "";
    expect(choose).toMatch(/run\(\{ type: "game\.new", party: r\.setup \}\)/);
    expect(choose).not.toMatch(/saves\./);
  });

  test("UI-46 履歴の画面は表示してから描く（display:none の間は scrollHeight が 0 で、末尾へ送れない）", () => {
    const app = stripComments(presenterRaw["../src/presenter/app.ts"]!);
    const body = /const openHistory = \(\): void => \{([\s\S]*?)\n {2}\};/.exec(app)?.[1] ?? "";
    const show = body.indexOf("play.showHistory(true)");
    const render = body.indexOf("play.history.render(");
    expect(show).toBeGreaterThanOrEqual(0);
    expect(render).toBeGreaterThan(show);
  });

  test("UI-31/UI-36 ページが隠れたら（attachReleaseOnHide）ステージの押下も片付ける（stageInput.reset）", () => {
    const app = stripComments(presenterRaw["../src/presenter/app.ts"]!);
    const body = /attachReleaseOnHide\(\(\) => \{([\s\S]*?)\n {6}\}\);/.exec(app)?.[1] ?? "";
    expect(body).toContain("stageInput.reset()");
    expect(app).toMatch(/const stageInput = attachStageInput\(/);
  });

  test("UI-55 onScreen は routeOfScreen を通し、swipeEnabled / repeater / walker / openMap / handleAction / 長押しの解除は fieldFree（screen dungeon かつ保留なし）を見る（ソースの検査）", () => {
    const app = stripComments(presenterRaw["../src/presenter/app.ts"]!);
    expect(app).toMatch(/const fieldFree = \(\): boolean => state\.screen === "dungeon" && state\.pendingChoice === null;/);
    const onScreen = /const onScreen = \(to: Screen, carry: readonly string\[\] = \[\]\): void => \{([\s\S]*?)\n {2}\};/.exec(app)?.[1] ?? "";
    expect(onScreen).toMatch(/const r = to === "title" \? "title" : routeOfScreen\(to\);/);
    expect(onScreen).toMatch(/showRoute\(r\)/);
    expect(onScreen).not.toMatch(/showRoute\(to\)/);
    const swipe = /const swipeEnabled = \(\): boolean =>([\s\S]*?);\n/.exec(app)?.[1] ?? "";
    expect(swipe).toMatch(/fieldFree\(\)/);
    const repeater = /const repeater = createHoldRepeater\(\{([\s\S]*?)\n {2}\}\);/.exec(app)?.[1] ?? "";
    expect(repeater).toMatch(/ready: \(\) => route === "dungeon" && overlay === null && fieldFree\(\)/);
    const walker = /const walker = createHoldRepeater\(\{([\s\S]*?)\n {2}\}\);/.exec(app)?.[1] ?? "";
    expect(walker).toMatch(/ready: \(\) => route === "dungeon" && overlay === null && fieldFree\(\)/);
    const openMap = /const openMap = \(\): void => \{([\s\S]*?)\n {2}\};/.exec(app)?.[1] ?? "";
    expect(openMap).toMatch(/if \(route !== "dungeon" \|\| overlay !== null \|\| !fieldFree\(\)\) return;/);
    expect(app).toMatch(/case "dungeon": \{\s*if \(!fieldFree\(\)\) \{/);
    expect(app).toMatch(/shouldReleaseHold\(route, overlay, !fieldFree\(\)\)/);
    // 保留の有無だけで迷宮の入力を決める古い条件が残っていない
    expect(app).not.toMatch(/route === "dungeon" && overlay === null && state\.pendingChoice === null/);
  });

  test("SV-42 更新の案内が出ている間はスワイプを受けない（swipeEnabled が updateNotice.isOpen を見る。ソースの検査）", () => {
    const app = stripComments(presenterRaw["../src/presenter/app.ts"]!);
    const swipe = /const swipeEnabled = \(\): boolean =>([\s\S]*?);\n/.exec(app)?.[1] ?? "";
    expect(swipe).toMatch(/&&\s*!updateNotice\.isOpen\(\)/);
  });

  test("UI-57 debug パネルの SAN段↓・イベント・罠の前・階段前は、迷宮のときだけパネルを閉じてから debug.sanDown / debug.warp を送る（ソースの検査）", () => {
    const app = stripComments(presenterRaw["../src/presenter/app.ts"]!);
    expect(app).toMatch(/onSanDown: \(\) => guard\(\(\) => debugCommand\(\{ type: "debug\.sanDown" \}\)\)/);
    expect(app).toMatch(/onWarp: \(to\) => guard\(\(\) => debugCommand\(\{ type: "debug\.warp", to \}\)\)/);
    const body = /const debugCommand = \(cmd: Command\): void => \{([\s\S]*?)\n {2}\};/.exec(app)?.[1] ?? "";
    // M6: 設定画面の上から開いた debug パネルなら、設定画面も閉じてから送る（closeDebugForCommand。UI-57）
    expect(body).toMatch(/if \(route !== "dungeon"\) return;\s*closeDebugForCommand\(\);\s*void run\(cmd\);/);
  });

  test("UI-57 debug パネルのターン+（M5.5）は、街・迷宮・戦闘のときだけパネルを閉じてから debug.addTurns を送る。ラベルの n は config.town.tavernEventTurns（ソースの検査）", () => {
    const app = stripComments(presenterRaw["../src/presenter/app.ts"]!);
    expect(app).toMatch(/onAddTurns: \(\) => guard\(\(\) => addTurnsFromDebug\(\)\)/);
    expect(app).toContain("addTurns: data.config.town.tavernEventTurns,");
    const body = /const addTurnsFromDebug = \(\): void => \{([\s\S]*?)\n {2}\};/.exec(app)?.[1] ?? "";
    expect(body).toMatch(/if \(route !== "town" && route !== "dungeon" && route !== "battle"\) return;\s*closeDebugForCommand\(\);\s*void run\(\{ type: "debug\.addTurns" \}\);/);
  });

  test("UI-57（M7）debug パネルの SAN+10 は、街・迷宮・戦闘のときだけパネルを閉じてから debug.sanOver を送る。ラベルの n は core の SAN_OVER_DEBUG（ソースの検査）", () => {
    const app = stripComments(presenterRaw["../src/presenter/app.ts"]!);
    expect(app).toMatch(/onSanOver: \(\) => guard\(\(\) => sanOverFromDebug\(\)\)/);
    expect(app).toContain("sanOver: SAN_OVER_DEBUG,");
    const body = /const sanOverFromDebug = \(\): void => \{([\s\S]*?)\n {2}\};/.exec(app)?.[1] ?? "";
    expect(body).toMatch(/if \(route !== "town" && route !== "dungeon" && route !== "battle"\) return;\s*closeDebugForCommand\(\);\s*void run\(\{ type: "debug\.sanOver" \}\);/);
  });

  test("UI-57（M6）設定画面の導線: タイトルの「設定」とヘッダーの設定ボタンは openSettings、F2 は debug パネルのトグル、debug パネルは設定画面を下に残し、debug のコマンドは両方を閉じてから送る（ソースの検査）", () => {
    const app = stripComments(presenterRaw["../src/presenter/app.ts"]!);
    expect(app).toMatch(/onSettings: \(\) => guard\(\(\) => openSettings\(\)\)/);
    expect(app).toMatch(/case "settings":\s*openSettings\(\);\s*return;/);
    expect(app).not.toMatch(/onSettings: \(\) => guard\(\(\) => openDebug\(\)\)/);
    expect(app).toMatch(/if \(a === "debug"\) \{\s*if \(overlay === "debug"\) closeDebug\(\);\s*else openDebug\(\);/);
    const openDebug = /const openDebug = \(\): void => \{([\s\S]*?)\n {2}\};/.exec(app)?.[1] ?? "";
    expect(openDebug).toMatch(/underDebug = overlay === "wipe" \|\| overlay === "settings" \? overlay : null;/);
    const closeDebug = /const closeDebug = \(\): void => \{([\s\S]*?)\n {2}\};/.exec(app)?.[1] ?? "";
    expect(closeDebug).toMatch(/overlay = underDebug;/);
    const forCmd = /const closeDebugForCommand = \(\): void => \{([\s\S]*?)\n {2}\};/.exec(app)?.[1] ?? "";
    expect(forCmd).toMatch(/closeDebug\(\);\s*closeSettings\(\);/);
    const hpOne = /const hpOneFromDebug = \(\): void => \{([\s\S]*?)\n {2}\};/.exec(app)?.[1] ?? "";
    expect(hpOne).toMatch(/closeDebugForCommand\(\);\s*void run\(\{ type: "debug\.hpOne" \}\);/);
    // 設定画面のキー（UI-33）は debug の判定の後
    expect(app).toMatch(/if \(overlay === "settings"\) \{\s*const k = settingsKeyIndex\(a, settingsItems\(settingsCtx\(\)\)\);\s*if \(k !== null\) settingsView\.select\(k\);\s*return;/);
    // 設定画面は debug パネルの下、帯はその上、最前面は SV-42 の更新の案内
    expect(app).toMatch(/stage\.replaceChildren\(title\.el, creation\.el, custom\.el, play\.el, settingsView\.el, debug\.el, banner\.el, updateNotice\.el\)/);
    // 遊んでいる途中の書き出しは flush を待ってから
    const exp = /const exportFromSettings = \(\): void => \{([\s\S]*?)\n {2}\};/.exec(app)?.[1] ?? "";
    expect(exp).toMatch(/await autosaver\.flush\(state\);\s*ok = await exportGameFile\(cur\.gameId\);/);
    // 続きから（resume）は設定画面も隠す
    const resume = /const resume = \(st: GameState\): void => \{([\s\S]*?)\n {2}\};/.exec(app)?.[1] ?? "";
    expect(resume).toMatch(/settingsView\.el\.style\.display = "none";\s*underSettings = null;/);
  });

  test("UI-25 自動歩行の walkStep は beforePlay を run に渡し、finish で endWalk する（止まる手は再生の前に歩行を終える）", () => {
    const app = stripComments(presenterRaw["../src/presenter/app.ts"]!);
    const body = /const walker = createHoldRepeater\(\{([\s\S]*?)\n {2}\}\);/.exec(app)?.[1] ?? "";
    expect(body).toMatch(/send: \(cmd, beforePlay\) =>\s*run\(cmd, \{ beforePlay \}\)/);
    expect(body).toMatch(/finish: \(\) => endWalk\(\)/);
  });

  test("UI-44 再生中・連鎖の途中のオート解除は、core の状態に関係なく予約の表示（battle.autoStopping）にし、予約はオート中のときだけ立てる。連鎖の外はオート中のときだけ battle.auto off を送る", () => {
    const app = stripComments(presenterRaw["../src/presenter/app.ts"]!);
    const body = /const requestAutoStop = \(\): void => \{([\s\S]*?)\n {2}\};/.exec(app)?.[1] ?? "";
    expect(body).toMatch(
      /if \(chaining \|\| isBusy\(\)\) \{\s*if \(menu !== null && menu\.auto\) stopRequested = true;\s*play\.controls\.setAutoStop\(t\("battle\.autoStopping"\), \(\) => requestAutoStop\(\)\);\s*return;\s*\}/,
    );
    expect(body).toMatch(/if \(menu === null \|\| !menu\.auto\) return;/);
    // 戦闘が終わった後の再生に押せるボタンは残らないので、拍のタップに回す経路は無い
    expect(body).not.toContain("player.tap()");
  });

  test("UI-44/UI-54 battleEnd の再生の後（playback の battleEnded）は、戦闘の入力の UI を下げる（操作領域は none、ヘッダーは空、入力中の名前と注目の枠を消す）", () => {
    const app = stripComments(presenterRaw["../src/presenter/app.ts"]!);
    expect(app).toMatch(/battleEnded: \(\) => onBattleEnded\(\)/);
    const body = /const onBattleEnded = \(\): void => \{([\s\S]*?)\n {2}\};/.exec(app)?.[1] ?? "";
    expect(body).toContain("cursor = null;");
    expect(body).toContain("lowerInput();");
    const lower = /const lowerInput = \(\): void => \{([\s\S]*?)\n {2}\};/.exec(app)?.[1] ?? "";
    expect(lower).toContain("play.party.setActive(null);");
    expect(lower).toContain("clearFocus();");
    expect(lower).toContain('play.header.setText("");');
    expect(lower).toContain('play.controls.setMode("none");');
  });

  test("TW-13 酒場の見回すは town.lookAround を送り、ページを変えない（screen イベントは来ないので townPage は tavern のまま、再生の最後の sync で一覧を描き直す。ソースの検査）", () => {
    const app = stripComments(presenterRaw["../src/presenter/app.ts"]!);
    const body = /const townItem = \(e: TownEntry\): ControlItem => \(\{([\s\S]*?)\n {2}\}\);/.exec(app)?.[1] ?? "";
    expect(body).toMatch(/case "look":\s*void run\(\{ type: "town\.lookAround" \}\);\s*return;/);
    // 酒場の項目はキャンプと同じ部品をその段で開く
    expect(body).toMatch(/case "camp":\s*openCamp\("tavern", e\.open\);/);
    expect(app).toMatch(/const openCamp = \(host: CampHost, open\?: CampOpen, memberId\?: string\): void =>/);
  });

  test("UI-52/TW-05/TW-16（M7）店の売る・買い戻す・鑑定と倉庫の行は town.shop / town.storage を送り、ページを変えない。sync は townRepair で消えたページを 1 つ上へ直す（ソースの検査）", () => {
    const app = stripComments(presenterRaw["../src/presenter/app.ts"]!);
    const body = /const townItem = \(e: TownEntry\): ControlItem => \(\{([\s\S]*?)\n {2}\}\);/.exec(app)?.[1] ?? "";
    expect(body).toMatch(/case "pick":\s*goTownPage\(e\.to\);\s*return;/);
    for (const kind of ["sell", "buyback", "identify"]) {
      expect(body).toMatch(
        new RegExp(`case "${kind}":\\s*void run\\(\\{ type: "town\\.shop", action: \\{ kind: "${kind}", memberId: e\\.memberId, instanceId: e\\.instanceId \\} \\}\\);\\s*return;`),
      );
    }
    for (const action of ["deposit", "withdraw"]) {
      expect(body).toMatch(
        new RegExp(`case "${action}":\\s*void run\\(\\{ type: "town\\.storage", action: "${action}", memberId: e\\.memberId, instanceId: e\\.instanceId \\}\\);\\s*return;`),
      );
    }
    expect(app).toMatch(/townPage = townRepair\(townPage, menu\);\s*const ents = townEntries\(townPage, menu, strings, previewOf\(townPage\)\);/);
  });

  // M8.5: M7 の広げた一覧（townListTall・setList の tall・listTall.backdrop）は UI-13 の街の配置に置き換えた
  test("UI-13/UI-52/IT-66（M8.5）街の一覧は見出し（townHeading）付きの setList の town で、施設メニューも同じ一覧。ヘッダーは場所と所持金、ビューは施設の絵。図鑑のパネルは townLayout の book に広げる（ソースの検査）", () => {
    const app = stripComments(presenterRaw["../src/presenter/app.ts"]!);
    expect(app).toContain('c.setList(items, { fixedLast: ents[ents.length - 1]?.kind === "back", town: { heading: t(townHeading(townPage)) } });');
    expect(app).not.toContain('setBattleMenu(items, "town")');
    expect(app).toContain("play.header.setText(townHeader(menu, strings, townPage));");
    expect(app).toContain("play.setTownPicture(townFacility(townPage));");
    expect(app).toMatch(/if \(p\.kind === "book"\) return \{ kind: "lines", \.\.\.formatBook\(uniqueBookView\(state, data\), strings\), tall: true \};/);
    expect(app).toContain("town: townLayout(playRegions, data.config.party.size),");
    expect(app).toContain("townPictures: o.assets?.town ?? {},");
    // UI-50（2026-10-06 ユーザー決定）: タイトルの絵も同じ一覧（GameAssets.town）の title を読む
    expect(app).toMatch(/createTitleScreen\(\{[\s\S]*?pictures: o\.assets\?\.town \?\? \{\},\s*base: import\.meta\.env\.BASE_URL,/);
    const dungeon = stripComments(presenterRaw["../src/presenter/views/dungeon.ts"]!);
    expect(dungeon).toContain("const camp = createCampView(lay.camp, tl.book);");
    // 帯は窓の後・キャンプのパネルの前（図鑑のパネルが帯を覆う）、会話の箱（UI-47）はキャンプの後、パーティ欄はその後
    expect(dungeon).toContain(
      "el.append(viewBox, header.el, message.el, band.el, camp.el, talk.el, panel.el, controls.el, map.el, wipe.el, history.el);",
    );
    // 街ではメッセージ窓と 64 のパーティ欄を隠し、帯とヘッダーのログを出す
    expect(dungeon).toContain('message.el.style.display = town ? "none" : "";');
    expect(dungeon).toContain('panel.el.style.display = town ? "none" : "";');
    expect(dungeon).toContain('band.el.style.display = town ? "" : "none";');
    expect(dungeon).toContain("header.setLogVisible(town);");
  });

  test("UI-13/UI-46/UI-59（M8.5）ヘッダーのログは履歴の画面（openHistory）を開き、帯のタップはその人の状態（酒場の状態と同じ部品）を開く。どちらも guard を通す（再生中・自動歩行中は捨てる。ソースの検査）", () => {
    const app = stripComments(presenterRaw["../src/presenter/app.ts"]!);
    expect(app).toContain("onLog: () => guard(() => openHistory()),");
    // UI-47: 開く前に会話の箱を打ち切る（overlay があれば開かないので打ち切らない）
    expect(app).toMatch(/onBand: \(id\) =>\s*guard\(\(\) => \{\s*if \(overlay !== null\) return;\s*play\.talk\.flush\(\);\s*openCamp\("tavern", "status", id\);\s*\}\),/);
    const open = /const openCamp = \(host: CampHost, open\?: CampOpen, memberId\?: string\): void => \{([\s\S]*?)\n {2}\};/.exec(app)?.[1] ?? "";
    // overlay があれば開かない、街でだけ開く（host tavern）
    expect(open).toContain("if (overlay !== null) return;");
    expect(open).toContain('if (memberId !== undefined && campPage.kind === "status") campPage = { kind: "status", memberId };');
    // 状態を閉じると元の街のページ（townPage は変えない）
    expect(open).not.toContain("townPage");
  });

  // M7（2026-10-05）: 鍛えるは送る前に lowerInput（UI-44）し、rejected なら sync で戻すようにしたので、upgrade の分岐の期待を改めた
  test("UI-52/TW-17/UI-44（M7）強化: 触媒の行は語りなしで段を替え、鍛えるは部位の段に戻して入力の UI を下げてから town.upgrade を送り、rejected なら sync で戻す。確認の段は upgradePreview の値で語る（ソースの検査）", () => {
    const app = stripComments(presenterRaw["../src/presenter/app.ts"]!);
    const body = /const townItem = \(e: TownEntry\): ControlItem => \(\{([\s\S]*?)\n {2}\}\);/.exec(app)?.[1] ?? "";
    expect(body).toMatch(/case "upPick":\s*townPage = e\.to;\s*syncControls\(\);\s*return;/);
    expect(body).toMatch(
      /case "upgrade":\s*townPage = \{ upSlot: e\.memberId \};\s*if \(townLowersInput\(e\)\) lowerInput\(\);\s*void run\(\{ type: "town\.upgrade", memberId: e\.memberId, slot: e\.slot, catalysts: e\.catalysts \}\)\.then\(\(r\) => \{\s*if \(r === null \|\| r\.rejected\) sync\(state\);\s*\}\);\s*return;/,
    );
    expect(app).toMatch(/upgradePreview\(state, data, page\.upConfirm\.memberId, page\.upConfirm\.slot, page\.upConfirm\.picked\)/);
    expect(app).toMatch(/upgradeConfirmLines\(page, menu, previewOf\(page\), strings\)/);
  });

  test("UI-52/TW-17（M7・M8.5）ページに入ったときの語りは、全文の履歴の末尾 TOWN_INTRO_DEDUP 件に同じ文があれば重ねて出さない（townFreshIntro。ソースの検査）", () => {
    const app = stripComments(presenterRaw["../src/presenter/app.ts"]!);
    const body = /const goTownPage = \(page: TownPage\): void => \{([\s\S]*?)\n {2}\};/.exec(app)?.[1] ?? "";
    expect(body).toMatch(
      /const texts = townFreshIntro\(\s*\[\.\.\.townPageIntro\(page, menu\)\.map\(t\), \.\.\.upgradeConfirmLines\(page, menu, previewOf\(page\), strings\)\],\s*play\.message\.history\(\)\.slice\(-TOWN_INTRO_DEDUP\),\s*\);/,
    );
  });

  test("UI-47（M8.5）語りは narrator が route で振り分け（街は会話の箱）、再生・save.failed・再開・街の語りはそこを通す。ページに入ったときの語りは全部 say(x, skip)（ソースの検査）", () => {
    const app = stripComments(presenterRaw["../src/presenter/app.ts"]!);
    expect(app).toContain('const narrator = createNarrator({ town: () => route === "town", talk: play.talk, window: play.message });');
    const deps = /const player = createPlayer\(\{([\s\S]*?)\n {2}\}\);/.exec(app)?.[1] ?? "";
    expect(deps).toContain("message: narrator,");
    expect(deps).not.toContain("message: play.message");
    // 街の語りの say は narrator だけ（メッセージ窓に直接は語らない）
    expect(app).not.toMatch(/play\.message\.say\(/);
    expect(app).toContain('if (r.announce) void narrator.say(t("save.failed"), true);');
    expect(app).toContain("for (const k of plan.prompts) void narrator.say(t(k), instant);");
    const body = /const goTownPage = \(page: TownPage\): void => \{([\s\S]*?)\n {2}\};/.exec(app)?.[1] ?? "";
    expect(body).toContain("texts.forEach((x) => void narrator.say(x, skip));");
    // 箱の ▼ は演出スキップでは点滅しない
    expect(app).toContain("talkBlink: () => !store.get().skipAnimations,");
  });

  test("UI-63/UI-66（2026-10-06）音の拡充の配線: 出来事の音は表示層だけの SoundContext を通す、街は施設の曲、迷宮のキャンプの間はキャンプの曲で閉じたら場面の曲、続きからは潜っているダンジョンの曲、施設に入る・キャンプを開く・会話の送りの音（ソースの検査）", () => {
    const app = stripComments(presenterRaw["../src/presenter/app.ts"]!);
    expect(app).toMatch(/sound: \(ev\) => \{\s*for \(const x of soundsFor\(ev, data, soundCtx\)\) playOrder\(x\);\s*soundCtx = nextSoundContext\(ev, data, soundCtx\);\s*\},/);
    expect(app).toMatch(/if \(x\.type === "song"\) setScene\(x\.name\);/);
    expect(app).toMatch(/play\.setTownPicture\(townFacility\(townPage\)\);\s*const song = townSong\(townFacility\(townPage\), data\);\s*if \(song !== undefined\) setScene\(song\);/);
    const open = /const openCamp = \([\s\S]*?\n {2}\};/.exec(app)?.[0] ?? "";
    expect(open).toContain('if (host === "camp") audio?.setSong(campSong(data));');
    const close = /const closeCamp = \([\s\S]*?\n {2}\};/.exec(app)?.[0] ?? "";
    expect(close).toContain('if (campHost === "camp") audio?.setSong(sceneSongName);');
    expect(app).toContain("setSceneSong(state.screen, state.battle?.groups.map((g) => g.monsterId) ?? [], state.dive?.dungeonId ?? null);");
    expect(app).toMatch(/soundCtx = resumeSoundContext\(screen, monsterIds, data\);/);
    expect(app).toContain('{ ...listItem(t("dungeon.menu.camp"), () => openCamp("camp")), sound: "camp" }');
    expect(app).toContain('...(townPage === "menu" && e.kind === "page" ? { sound: "facility" as const } : {}),');
    expect(app).toContain('talkAdvanced: () => playUi("talk"),');
  });

  test("UI-52/TW-11（M9 実機 B2）準備中の迷宮の行（townEntries の notReady）を押すと、会話の箱を打ち切ってから理由の文を会話の箱に出す（ソースの検査）", () => {
    const app = stripComments(presenterRaw["../src/presenter/app.ts"]!);
    const item = /const townItem = \(e: TownEntry\): ControlItem => \(\{([\s\S]*?)\n {2}\}\);/.exec(app)?.[1] ?? "";
    expect(item).toContain("...notReadyReason(e),");
    const fn = /const notReadyReason = \(e: TownEntry\): Pick<ControlItem, "onDisabled"> => \{([\s\S]*?)\n {2}\};/.exec(app)?.[1] ?? "";
    expect(fn).toContain('const reason = e.kind === "enter" ? e.notReady : null;');
    expect(fn).toMatch(/onDisabled: \(\) =>\s*guard\(\(\) => \{\s*play\.talk\.flush\(\);\s*void narrator\.say\(reason, store\.get\(\)\.skipAnimations\);\s*\}\),/);
  });

  test("UI-47（M8.5）一覧・戻る・数字（townItem）と Esc は会話を打ち切ってから動き、Enter は会話の箱が開いていれば箱のタップ。箱と施設の絵のタップは再生の外・overlay なし（キャンプは除く）の街で talk.tap（ソースの検査）", () => {
    const app = stripComments(presenterRaw["../src/presenter/app.ts"]!);
    const item = /const townItem = \(e: TownEntry\): ControlItem => \(\{([\s\S]*?)\n {2}\}\);/.exec(app)?.[1] ?? "";
    expect(item).toMatch(/onSelect: \(\) =>\s*guard\(\(\) => \{\s*play\.talk\.flush\(\);\s*switch \(e\.kind\) \{/);
    const core = /const handleActionCore = \(a: Action\): void => \{([\s\S]*?)\n {2}\};/.exec(app)?.[1] ?? "";
    expect(core).toMatch(
      /case "town":\s*if \(a === "confirm"\) \{\s*if \(play\.talk\.isOpen\(\)\) play\.talk\.tap\(\);\s*else play\.controls\.select\(0\);\s*\} else if \(typeof a === "object"\) play\.controls\.select\(a\.menu\);\s*else if \(a === "back"\) \{\s*play\.talk\.flush\(\);\s*townBack\(\);\s*\}\s*return;/,
    );
    const tap = /const tapTalk = \(\): void => \{([\s\S]*?)\n {2}\};/.exec(app)?.[1] ?? "";
    expect(tap).toContain("if (isBusy() || chaining) return;");
    expect(tap).toContain('if (route !== "town" || (overlay !== null && overlay !== "camp")) return;');
    expect(tap).toContain("play.talk.tap();");
    expect(app).toContain("onTap(play.talk.el, () => tapTalk());");
    expect(app).toContain("onTap(play.picture, () => tapTalk());");
  });

  test("UI-47（M8.5）キャンプ（酒場）の上に見えている会話の箱は、タップと Enter / Space で進める・閉じる。箱が閉じていれば Enter はキャンプへ（ソースの検査）", () => {
    const app = stripComments(presenterRaw["../src/presenter/app.ts"]!);
    const core = /const handleActionCore = \(a: Action\): void => \{([\s\S]*?)\n {2}\};/.exec(app)?.[1] ?? "";
    expect(core).toMatch(
      /if \(overlay === "camp"\) \{\s*if \(a === "confirm" && route === "town" && play\.talk\.isOpen\(\)\) \{\s*play\.talk\.tap\(\);\s*return;\s*\}\s*const m = campInput\(\);/,
    );
  });

  test("UI-47/SV-50（M8.5）街を出るときは会話の箱を打ち切り、街に入るときは迷宮の窓で語った carry を出し直す（ログには入れない）。再開では箱を閉じる（ソースの検査）", () => {
    const app = stripComments(presenterRaw["../src/presenter/app.ts"]!);
    const onScreen = /const onScreen = \(to: Screen, carry: readonly string\[\] = \[\]\): void => \{([\s\S]*?)\n {2}\};/.exec(app)?.[1] ?? "";
    expect(onScreen).toContain("const from = route;");
    expect(onScreen).toMatch(/if \(from === "town" && r !== "town"\) \{\s*play\.talk\.flush\(\);\s*play\.message\.clearView\(\);\s*\}/);
    expect(onScreen).toContain('if (r === "town" && from !== "town" && carry.length > 0) void play.talk.replay(carry, store.get().skipAnimations);');
    // flush は showRoute の前（route が変わる前）、replay は後
    expect(onScreen.indexOf("play.talk.flush()")).toBeLessThan(onScreen.indexOf("showRoute(r)"));
    expect(onScreen.indexOf("play.talk.replay(")).toBeGreaterThan(onScreen.indexOf("showRoute(r)"));
    expect(app).toContain("show: (to: Screen, _st, carry) => onScreen(to, carry ?? []),");
    const resume = /const resume = \(st: GameState\): void => \{([\s\S]*?)\n {2}\};/.exec(app)?.[1] ?? "";
    expect(resume).toContain("play.talk.clear();");
    // 再開の語りは showRoute の後（route が決まってから振り分ける）
    expect(resume.indexOf("narrator.say(")).toBeGreaterThan(resume.indexOf("showRoute(plan.route)"));
    // 判定の箱の下端は街だけ会話の箱の上
    const dungeon = stripComments(presenterRaw["../src/presenter/views/dungeon.ts"]!);
    expect(dungeon).toContain("dice.setBottom(town ? tl.diceBottom : DICE_BOX_BOTTOM);");
    expect(dungeon).toContain("const talk = createTalkBox({ layout: tl.talk, speed: o.textSpeed, blink: o.talkBlink, log: (t) => message.log(t), advanced: () => o.talkAdvanced?.() });");
  });

  test("UI-54 戦闘中はヘッダーに 第{round+1}ターン を出す。遭遇の再生（onScreen battle）は 1、sync の戦闘は battleMenu.round + 1、battleEnd の後と迷宮・街の sync では隠す。lowerInput はターンを消さない（ソースの検査）", () => {
    const app = stripComments(presenterRaw["../src/presenter/app.ts"]!);
    const onScreen = /const onScreen = \(to: Screen, carry: readonly string\[\] = \[\]\): void => \{([\s\S]*?)\n {2}\};/.exec(app)?.[1] ?? "";
    expect(onScreen).toMatch(/if \(r === "battle"\) \{[^}]*play\.header\.setTurn\(battleTurnText\(strings, 1\)\);/);
    const sync = /const sync = \(st: GameState\): void => \{([\s\S]*?)\n {2}\};/.exec(app)?.[1] ?? "";
    expect(sync).toContain("play.header.setTurn(menu === null ? null : battleTurnText(strings, menu.round + 1));");
    // 戦闘の分岐（return まで）の後の迷宮・街は null
    const afterBattle = sync.slice(sync.indexOf("syncControls();\n      return;"));
    expect(afterBattle).toContain("play.header.setTurn(null);");
    const ended = /const onBattleEnded = \(\): void => \{([\s\S]*?)\n {2}\};/.exec(app)?.[1] ?? "";
    expect(ended).toContain("play.header.setTurn(null);");
    const lower = /const lowerInput = \(\): void => \{([\s\S]*?)\n {2}\};/.exec(app)?.[1] ?? "";
    expect(lower).not.toContain("setTurn");
  });

  test("UI-56 出目の表は迷宮の画面のビューの中の層（play.penaltyTable）を playback に渡し、続きからの再開では消す（ソースの検査）", () => {
    const app = stripComments(presenterRaw["../src/presenter/app.ts"]!);
    expect(app).toContain("penaltyTable: play.penaltyTable,");
    const resume = /const resume = \(st: GameState\): void => \{([\s\S]*?)\n {2}\};/.exec(app)?.[1] ?? "";
    expect(resume).toContain("play.dice.hide();");
    expect(resume).toContain("play.penaltyTable.hide();");
    const dungeon = stripComments(presenterRaw["../src/presenter/views/dungeon.ts"]!);
    expect(dungeon).toContain("viewBox.appendChild(penaltyTable.el);");
  });

  test("UI-44/UI-56 全滅の 2d10 を出したとき（playback の inputClosed。戦闘の外の全滅も）は、battleEnd と同じ下げ方（lowerInput）で迷宮のヘッダーと操作を下げる", () => {
    const app = stripComments(presenterRaw["../src/presenter/app.ts"]!);
    expect(app).toMatch(/inputClosed: \(\) => lowerInput\(\)/);
  });

  test("UI-44 連鎖が Command を送る前に、閉じる Command（逃走・前回と同じ・手動の resolve。closesInput）なら入力の UI を下げてから run する", () => {
    const app = stripComments(presenterRaw["../src/presenter/app.ts"]!);
    const body = /const chainDeps: ChainDeps = \{([\s\S]*?)\n {2}\};/.exec(app)?.[1] ?? "";
    expect(body).toMatch(/run: \(cmd\) => \{\s*if \(closesInput\(cmd, battleMenu\(state, data\)\)\) lowerInput\(\);\s*return run\(cmd\);\s*\}/);
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
