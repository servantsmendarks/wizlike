// UI-59 詳細（src/presenter/views/detail.ts）。純粋な formatCharacter と、document を最小の偽物に差し替えた配置の確認。
import { afterEach, describe, expect, test, vi } from "vitest";
import { EQUIP_SLOTS, STAT_KEYS } from "../src/core/data/index";
import { createItemInstance, itemDisplayName } from "../src/core/state";
import type { GameState } from "../src/core/types";
import { campMenu } from "../src/core/rules/camp";
import { CHARACTER_LINES, CHARACTER_MIN_HEIGHT, dungeonLayout, layoutWarnings, regions } from "../src/presenter/layout";
import { characterCells, createDetailView, formatCharacter, LEVEL_COLUMNS, SLOT_ORDER, STAT_ORDER } from "../src/presenter/views/detail";
import { textUnits } from "../src/presenter/views/party-band";
import { formatMessage } from "../src/presenter/views/message";
import { createPartyPanel } from "../src/presenter/views/party";
import { memberSheet } from "../src/core/rules/item-view";
import { sanStage } from "../src/core/rules/san";
import { data, newGame } from "./helpers/core";
import { cursedDagger } from "./helpers/items";

const S = data.strings;
const t = (k: string, p?: Record<string, string | number>): string => {
  const tpl = S[k];
  if (tpl === undefined) throw new Error(`unknown string key: ${k}`);
  return formatMessage(tpl, p);
};
const nameOf = (st: GameState) => (iid: string): string => itemDisplayName(st, data, iid);

describe("UI-59 詳細", () => {
  test("UI-59 使う文言のキーがすべて strings にある", () => {
    for (const k of [
      "detail.raceClass",
      "detail.level",
      "detail.exp",
      "detail.hp",
      "detail.mp",
      "detail.san",
      "detail.status",
      "detail.statusOk",
      "detail.stat",
      "detail.attack",
      "detail.equipNone",
      "detail.ac",
      "detail.magicPower",
      ...SLOT_ORDER.map((s) => `detail.slot.${s}`),
      ...STAT_ORDER.map((s) => `stat.${s}`),
      "common.close",
    ]) {
      expect(Object.prototype.hasOwnProperty.call(S, k), k).toBe(true);
    }
  });

  test("UI-59 STAT_ORDER / SLOT_ORDER は core の STAT_KEYS / EQUIP_SLOTS（CH-10 / CH-70）と同じ並び", () => {
    expect([...STAT_ORDER]).toEqual([...STAT_KEYS]);
    expect([...SLOT_ORDER]).toEqual([...EQUIP_SLOTS]);
  });

  test("UI-59 X3 プロトタイプのアルド: 種族「人間」・職業は正式名「戦士」（略称 WAR ではない）、レベル・経験値・HP/MP/SAN・状態・能力値 6 つ・装備 6 枠", () => {
    const s = newGame(1);
    const ch = s.party[0]!;
    const d = formatCharacter(ch, data, S, nameOf(s));
    expect(d.name).toBe("アルド");
    expect(d.raceClass).toBe(t("detail.raceClass", { race: "人間", class: "戦士" }));
    expect(d.raceClass).toBe("人間 戦士");
    expect(d.raceClass).not.toContain("WAR");
    expect(d.level).toBe(t("detail.level", { level: 1 }));
    expect(d.exp).toBe(t("detail.exp", { exp: 0 }));
    expect(d.hp).toBe(t("detail.hp", { hp: ch.hp, hpMax: ch.hpMax }));
    // mpMax 0 でも詳細では MP 0/0 を出す
    expect(d.mp).toBe("MP 0/0");
    expect(d.san).toBe("SAN 100/100");
    expect(d.status).toBe(t("detail.status", { status: t("detail.statusOk") }));
    expect(d.stats.map((x) => [x.label, x.value])).toEqual([
      ["力", 14],
      ["知恵", 8],
      ["信仰心", 6],
      ["生命力", 12],
      ["素早さ", 9],
      ["運", 9],
    ]);
    expect(d.stats[0]!.text).toBe(t("detail.stat", { label: "力", value: 14 }));
    // M7: 7 行目の「装備」の見出しは攻撃の行に譲った（2026-10-05）。sheet が無ければ攻撃は空
    expect(d.attack).toBe("");
    expect(d.equipment).toEqual([
      { slot: "武器", item: "長剣" },
      { slot: "防具", item: "革鎧" },
      { slot: "盾", item: "木の盾" },
      { slot: "兜", item: t("detail.equipNone") },
      { slot: "小手", item: t("detail.equipNone") },
      { slot: "装飾", item: t("detail.equipNone") },
    ]);
  });

  test("UI-59/CH-72 装備の名前は鑑定を反映した表示名（未鑑定は unidentifiedName）。状態は死亡・状態異常をパーティの行と同じ短い名前で出す", () => {
    const s = structuredClone(newGame(1));
    const iid = cursedDagger(s, false);
    s.party[0]!.equipment.weapon = iid;
    const d = formatCharacter(s.party[0]!, data, S, nameOf(s));
    expect(d.equipment[0]).toEqual({ slot: "武器", item: "短い刃？" });
    s.items[iid]!.identified = true;
    expect(formatCharacter(s.party[0]!, data, S, nameOf(s)).equipment[0]!.item).toBe("短剣");
    const dead = formatCharacter({ ...s.party[0]!, life: "dead", hp: 0, status: ["poison"] }, data, S, nameOf(s));
    expect(dead.status).toBe(t("detail.status", { status: t("party.life.dead") }));
    const poisoned = formatCharacter({ ...s.party[0]!, status: ["poison", "sleep"] }, data, S, nameOf(s));
    expect(poisoned.status).toBe(t("detail.status", { status: "毒 眠" }));
    // 呪文を使う職業は MP 現在/最大（ドナ、priest）
    const priest = formatCharacter(s.party[3]!, data, S, nameOf(s));
    expect(priest.raceClass).toBe("ノーム 僧侶");
    expect(priest.mp).toBe("MP 5/5");
  });
});

// ---------------------------------------------------------------- DOM（偽の document）
class FakeEl {
  style: Record<string, string> = {};
  className = "";
  textContent = "";
  children: FakeEl[] = [];
  appendChild(c: FakeEl): FakeEl {
    this.children.push(c);
    return c;
  }
  replaceChildren(...c: FakeEl[]): void {
    this.children = c;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("UI-59/UI-12 士気の SAN の超過（TW-15。M7）", () => {
  // M7 の B10 で 5 番目の引数を sanCap（core の sanCapOf）から sheet（core の memberSheet。sanMax は sanCapOf と同じ値）に替えた
  test("UI-59/TW-15 formatCharacter: SAN は「SAN 110/100」（最大は core の memberSheet の sanMax）で sanOver が真。100/100 は偽。sheet の省略は sanMax", () => {
    const s = newGame(1);
    const over = { ...s.party[0]!, san: 110 };
    const d = formatCharacter(over, data, S, nameOf(s), memberSheet(s, data, over));
    expect(d.san).toBe("SAN 110/100");
    expect(d.sanOver).toBe(true);
    expect(formatCharacter(over, data, S, nameOf(s)).san).toBe("SAN 110/100");
    const normal = formatCharacter(s.party[0]!, data, S, nameOf(s), memberSheet(s, data, s.party[0]!));
    expect([normal.san, normal.sanOver]).toEqual(["SAN 100/100", false]);
  });

  test("UI-59/TW-15 render: sanOver なら SAN の行を accent 色、そうでなければ色を付けない", () => {
    vi.stubGlobal("document", { createElement: (): FakeEl => new FakeEl() });
    const v = createDetailView({ x: 0, y: 16, w: 240, h: 150 });
    const s = newGame(1);
    const sanEl = (): FakeEl => (v.el as unknown as FakeEl).children.find((c) => c.className === "detail-san")!;
    v.render(formatCharacter({ ...s.party[0]!, san: 110 }, data, S, nameOf(s)));
    expect(sanEl().textContent).toBe("SAN 110/100");
    expect(sanEl().style["color"]).toBe("var(--c-accent)");
    v.render(formatCharacter(s.party[0]!, data, S, nameOf(s)));
    expect(sanEl().style["color"]).toBeUndefined();
  });

  test("UI-12/TW-15 パーティ欄: SAN が上限（maxOf の sanMax）を超えている行は SAN の値が accent 色。setSan で上限以下に戻ると色を外す", () => {
    vi.stubGlobal("document", { createElement: (): FakeEl => new FakeEl() });
    const panel = createPartyPanel({
      strings: S,
      classes: data.classes,
      region: { x: 0, y: 0, w: 240, h: 64 },
      rows: [],
      frontRow: data.config.party.frontRow,
      stageOf: (san, sanMax) => sanStage(san, sanMax, data.config),
      maxOf: (ch) => memberSheet(s, data, ch), // CH-14: core の memberSheet（M7 の B10 で sanCapOf から替えた。sanMax は同じ値）
    });
    const s = newGame(1);
    const party = s.party.map((c, i) => ({ ...c, san: i === 0 ? 110 : 100 }));
    panel.render(party);
    // 行の子は 名前 / 略称 / HP ラベル / HP / MP ラベル / MP / SAN ラベル / SAN / 状態 の順（PARTY_COLUMNS）。SAN の値は textContent で探す
    const sanCell = (i: number): FakeEl => {
      const line = (panel.el as unknown as FakeEl).children[i]!;
      return line.children.find((c) => c.textContent === String(party[i]!.san) || c.textContent === "99")!;
    };
    expect(sanCell(0).style["color"]).toBe("var(--c-accent)");
    expect(sanCell(1).style["color"]).toBe("");
    panel.setSan("c1", 99);
    const line0 = (panel.el as unknown as FakeEl).children[0]!;
    const cell = line0.children.find((c) => c.textContent === "99")!;
    expect(cell.style["color"]).toBe("");
  });
});

describe("UI-54/CB-14 パーティ欄の前衛と後衛の区切り線（M16）", () => {
  const mk = (rows: readonly { x: number; y: number; w: number; h: number }[], region = { x: 0, y: 0, w: 240, h: 64 }) =>
    createPartyPanel({
      strings: S,
      classes: data.classes,
      region,
      rows,
      frontRow: data.config.party.frontRow,
      stageOf: (san, sanMax) => sanStage(san, sanMax, data.config),
    });

  test("UI-54/CB-14 行 frontRow（3）の上に 1px の dim 色の線。行の後ろに足すので children[0..5] は行のまま。既定の配置では領域内の y31（行 2 の下端の余白）", () => {
    vi.stubGlobal("document", { createElement: (): FakeEl => new FakeEl() });
    const g = regions(data.config.ui.layout, data.config.stage.width);
    const l = dungeonLayout(g, data.config.party.size);
    const panel = mk(l.partyRows, g.party);
    const s = newGame(1);
    panel.render(s.party);
    const kids = (panel.el as unknown as FakeEl).children;
    expect(data.config.party.frontRow).toBe(3);
    expect(kids.length).toBe(s.party.length + 1);
    expect(kids.slice(0, 6).every((k) => k.className === "party-row")).toBe(true);
    const div = kids[6]!;
    expect(div.className).toBe("party-divider");
    // 行 3 の top（領域内）− 1。既定の行は y2+10i なので 31
    expect(l.partyRows[3]!.y - g.party.y).toBe(32);
    expect([div.style["top"], div.style["height"], div.style["width"], div.style["background"]]).toEqual(["31px", "1px", "240px", "var(--c-dim)"]);
    // 線は行 2（y22..31）の文字の下の余白に重なり、行 3 の上端（y32）には掛からない
    expect(Number(kids[2]!.style["top"]!.replace("px", "")) + 10 - 1).toBe(31);
    expect(kids[3]!.style["top"]).toBe("32px");
  });

  test("UI-54/CB-14 線は並び順で固定（前衛 3 人が全員行動不能で後衛が繰り上がっても位置は変わらない）。後衛の行が無ければ引かない。render のたびに 1 本だけ", () => {
    vi.stubGlobal("document", { createElement: (): FakeEl => new FakeEl() });
    const g = regions(data.config.ui.layout, data.config.stage.width);
    const panel = mk(dungeonLayout(g, data.config.party.size).partyRows, g.party);
    const s = newGame(1);
    const downed = s.party.map((c, i) => (i < 3 ? { ...c, life: "dead" as const } : c));
    panel.render(downed);
    panel.render(downed);
    const dividers = (panel.el as unknown as FakeEl).children.filter((k) => k.className === "party-divider");
    expect(dividers.map((d) => d.style["top"])).toEqual(["31px"]);
    panel.render(s.party.slice(0, 3));
    expect((panel.el as unknown as FakeEl).children.filter((k) => k.className === "party-divider")).toEqual([]);
  });
});

/** アルド（力 14・hpMax 15・sanMax 100）に、杖 Lv5（魔法攻撃力 floor(5/2) = 2）・革鎧 Lv3（−2 − 1）・早鐘の兜（−2）・護符（力 +2・最大HP +6・最大SAN +10・AC 1）を付けた状態 */
function equippedAld(): GameState {
  const s = structuredClone(newGame(1));
  const c1 = s.party[0]!;
  c1.equipment = { weapon: null, armor: null, shield: null, helm: null, gauntlet: null, accessory: null };
  c1.equipment.weapon = createItemInstance(s, { itemId: "staff", level: 5, identified: true });
  c1.equipment.armor = createItemInstance(s, { itemId: "leather_armor", level: 3, identified: true });
  c1.equipment.helm = createItemInstance(s, { itemId: "leather_cap", uniqueId: "alarm_bell_helm", identified: true });
  c1.equipment.accessory = createItemInstance(s, {
    itemId: "charm",
    options: [
      { optionId: "str", tier: 2, value: 2 },
      { optionId: "hp_max", tier: 2, value: 6 },
      { optionId: "san_max", tier: 2, value: 10 },
      { optionId: "ac", tier: 1, value: 1 },
    ],
    identified: true,
  });
  return s;
}

describe("UI-59/CH-13/CH-14/CB-20/MG-33 状態の実効の値（M7）", () => {
  test("UI-59/CH-13/CH-14/CB-20/MG-33 formatCharacter は core の memberSheet の値を出す: 能力値（力 16）・HP の最大 21・SAN の最大 110・AC 4・魔法攻撃力 2。sheet が無ければ素の値で AC と魔法攻撃力は空", () => {
    const s = equippedAld();
    const ch = s.party[0]!;
    const d = formatCharacter(ch, data, S, nameOf(s), memberSheet(s, data, ch));
    expect(d.stats[0]).toEqual({ label: "力", value: 16, text: "力 16" });
    expect(d.hp).toBe(`HP ${ch.hp}/21`);
    expect(d.san).toBe(`SAN ${ch.san}/110`);
    // AC = acBase 10 − 3 − 2 − 1 = 4
    expect(d.ac).toBe("AC 4");
    expect(d.magicPower).toBe("魔法攻撃力 2");
    // CB-22: 杖 1d4（術者用なので Lv の効果は足さない）+ 力 16 の補正 3 + リーダーの性格恩恵 0 → 攻撃 1d4+3
    expect(d.attack).toBe("攻撃 1d4+3");
    const raw = formatCharacter(ch, data, S, nameOf(s));
    expect([raw.stats[0]!.value, raw.hp, raw.ac, raw.magicPower, raw.attack]).toEqual([14, `HP ${ch.hp}/15`, "", "", ""]);
    // 装備名は IT-11 の表示名（ユニークはユニークの名前、汎用は +Lv）
    expect(d.equipment.map((e) => e.item)).toEqual(["杖 +5", "革鎧 +3", t("detail.equipNone"), "早鐘の兜", t("detail.equipNone"), "護符"]);
  });

  test("UI-59/CB-22 formatCharacter の攻撃: 足し分が 0 なら「攻撃 1d8」、負なら「攻撃 1d2-1」（memberSheet の attackDice / attackBonus）", () => {
    const s = structuredClone(newGame(1));
    const ch = s.party[0]!;
    ch.stats.str = 10; // 長剣 Lv0・力 10（補正 0）・リーダー（恩恵 0）→ 足し分 0
    expect(formatCharacter(ch, data, S, nameOf(s), memberSheet(s, data, ch)).attack).toBe("攻撃 1d8");
    ch.equipment.weapon = null;
    ch.stats.str = 9; // 素手 1d2・力 9 の補正 −1
    expect(formatCharacter(ch, data, S, nameOf(s), memberSheet(s, data, ch)).attack).toBe("攻撃 1d2-1");
  });

  // 2026-10-06（ユーザーの指示）: 攻撃の行はオプションまで合算した実効値。ダイスの記法の定数と足し分を 1 つの定数にする（品の詳細とは役割が違う）
  test("UI-59/CB-22 formatCharacter の攻撃: ダイスの定数・Lv の分・オプション damage・力補正を 1 つの定数に合算する（「1d4+1+4」にしない）", () => {
    const s = structuredClone(newGame(1));
    const ch = s.party[0]!;
    ch.stats.str = 14; // 力補正 2、リーダー（恩恵 0）
    ch.equipment.weapon = createItemInstance(s, { itemId: "throwing_knives", level: 2, options: [{ optionId: "damage", tier: 1, value: 1 }], identified: true });
    // 投げナイフ 1d4+1 + 力 2 + Lv2 の 1 + オプション 1 → 1d4+5
    expect(formatCharacter(ch, data, S, nameOf(s), memberSheet(s, data, ch)).attack).toBe("攻撃 1d4+5");
    ch.stats.str = 6; // 力補正 −2 → 1d4+1 − 2 + 1 + 1 = 1d4+1
    expect(formatCharacter(ch, data, S, nameOf(s), memberSheet(s, data, ch)).attack).toBe("攻撃 1d4+1");
    ch.stats.str = 2; // 力補正 −4 → 合計 −1
    expect(formatCharacter(ch, data, S, nameOf(s), memberSheet(s, data, ch)).attack).toBe("攻撃 1d4-1");
  });

  // M7（2026-10-05）: 7 行目の「装備」の見出しを攻撃の行（x4）に替えた。
  // M10（2026-10-07）: キャラクター画面を 27 行（240×284）にしたので「14 行のまま」の検査は外した（行の数は「UI-59 キャラクター画面の配置」で確かめる）
  test("UI-59 render: 7 行目は 攻撃（x4）・AC（x84）・魔法攻撃力（x164）", () => {
    vi.stubGlobal("document", { createElement: (): FakeEl => new FakeEl() });
    const v = createDetailView({ x: 0, y: 16, w: 240, h: 284 });
    const s = equippedAld();
    v.render(formatCharacter(s.party[0]!, data, S, nameOf(s), memberSheet(s, data, s.party[0]!)));
    const el = v.el as unknown as FakeEl;
    const px = (x: string | undefined): number => Number((x ?? "").replace("px", ""));
    const at = (cls: string): [number, number, string] => {
      const c = el.children.find((x) => x.className === cls)!;
      return [px(c.style["left"]) + 1, px(c.style["top"]) + 1, c.textContent];
    };
    expect(at("detail-attack")).toEqual([4, 74, "攻撃 1d4+3"]);
    expect(at("detail-ac")).toEqual([84, 74, "AC 4"]);
    expect(at("detail-magic-power")).toEqual([164, 74, "魔法攻撃力 2"]);
  });

  test("UI-12/CH-14/CH-53 パーティ欄: HP / MP / SAN の最大と SAN の段は maxOf（core の memberSheet）の値。最大SAN +10 で SAN 54 は 110 の半分未満なので不安", () => {
    vi.stubGlobal("document", { createElement: (): FakeEl => new FakeEl() });
    const s = equippedAld();
    s.party[0]!.san = 54; // 素の sanMax 100 なら 54 ≥ 50 で正常、実効の 110 なら 54 < 55 で不安
    const panel = createPartyPanel({
      strings: S,
      classes: data.classes,
      region: { x: 0, y: 0, w: 240, h: 64 },
      rows: [],
      frontRow: data.config.party.frontRow,
      stageOf: (san, sanMax) => sanStage(san, sanMax, data.config),
      maxOf: (ch) => memberSheet(s, data, ch),
    });
    panel.render(s.party);
    const line0 = (panel.el as unknown as FakeEl).children[0]!;
    const texts = line0.children.map((c) => c.textContent);
    expect(texts).toContain(`${s.party[0]!.hp}/21`);
    expect(texts).toContain(S["party.san.uneasy"]);
    // 現在値を描き直しても最大は実効の値のまま
    panel.setHp("c1", 20);
    expect(line0.children.map((c) => c.textContent)).toContain("20/21");
  });
});

// M10（2026-10-07）: キャンプの「状態」（14 行・240×150）をキャラクター画面（27 行・240×284）に改めたので、配置の検査を書き直した
describe("UI-59 キャラクター画面の配置（M10）", () => {
  const RECT = { x: 0, y: 16, w: 240, h: 284 };
  const px = (v: string | undefined): number => Number((v ?? "").replace("px", ""));

  test("UI-59 layout.character は 240×284（ビューの上端から操作領域の上端まで。酒場の図鑑も同じ範囲）で、27 行（CHARACTER_MIN_HEIGHT 274）が入る。足りなければ layoutWarnings", () => {
    const g = regions(data.config.ui.layout, data.config.stage.width);
    const l = dungeonLayout(g, data.config.party.size);
    expect(l.character).toEqual(RECT);
    expect(CHARACTER_LINES).toBe(27);
    expect(CHARACTER_MIN_HEIGHT).toBe(274);
    expect(layoutWarnings(g, l)).toEqual([]);
    expect(layoutWarnings(g, { ...l, character: { ...l.character, h: 273 } })).toEqual(["ui.layout: character panel (height 273) is lower than 274"]);
  });

  test("UI-59 render の 27 行は 240×284 の内側に収まり、行の下端は 274。名前は accent 色。focusSlot の枠は accent 色。所持品は 14〜18 行、呪文は 19〜26 行の 2 列（x4 / x122）", () => {
    vi.stubGlobal("document", { createElement: (): FakeEl => new FakeEl() });
    const v = createDetailView(RECT);
    const s = structuredClone(newGame(1));
    // ドナ（僧侶。装備 2 と解毒草）に薬草 5 つを持たせて使用枠を 8/8 にし、所持品の枠 6 個を出す。呪文は campMenu の値を 14 件に差し替える
    const ch = s.party[3]!;
    for (let i = 0; i < 5; i++) ch.inventory.push(createItemInstance(s, { itemId: "herb", identified: true }));
    const menu = campMenu(s, data)!;
    const member = structuredClone(menu.members[3]!);
    member.knownSpells = Array.from({ length: 14 }, (_, i) => ({ spellId: `s${i}`, name: `呪${i}`, mp: 2, castable: i === 0 }));
    v.render(formatCharacter(ch, data, S, nameOf(s), memberSheet(s, data, ch), member), 2);
    const el = v.el as unknown as FakeEl;
    expect([el.style["left"], el.style["top"], el.style["height"]]).toEqual(["0px", "16px", "284px"]);
    let bottom = 0;
    for (const c of el.children) {
      const x = px(c.style["left"]) + 1;
      const y = px(c.style["top"]) + 1;
      const w = px(c.style["width"]);
      const h = px(c.style["height"]);
      expect(x >= 0 && y >= 0 && x + w <= RECT.w && y + h <= RECT.h, `${c.className} ${c.textContent}`).toBe(true);
      bottom = Math.max(bottom, y + h);
    }
    expect(bottom).toBe(274);
    // 所持品の 6 件で行 18 は空く（行 0〜26 のうち 18 だけ要素が無い）
    expect(new Set(el.children.map((c) => c.style["top"])).size).toBe(26);
    const at = (cls: string): [number, number, string][] =>
      el.children.filter((c) => c.className === cls).map((c) => [px(c.style["left"]) + 1, px(c.style["top"]) + 1, c.textContent]);
    expect(at("detail-name")).toEqual([[4, 4, "ドナ"]]);
    expect(el.children.find((c) => c.className === "detail-name")!.style["color"]).toBe("var(--c-accent)");
    // CH-71（M16）: 見出しに装備の数（ドナは装備 2）
    expect(at("detail-inventory-head")).toEqual([[4, 144, "所持品 8/8（装備 2 を含む）"]]);
    const inv = at("detail-inventory");
    expect(inv).toHaveLength(6);
    expect(inv[0]).toEqual([4, 154, "解毒草"]);
    expect(inv[1]).toEqual([122, 154, "薬草"]);
    expect(inv[5]).toEqual([122, 174, "薬草"]);
    expect(at("detail-spell-head")).toEqual([[4, 194, "呪文"]]);
    const sp = at("detail-spell");
    expect(sp).toHaveLength(14);
    expect(sp[0]).toEqual([4, 204, "呪0 MP2"]);
    expect(sp[13]).toEqual([122, 264, "呪13 MP2"]);
    // 戦闘外で唱えられない呪文は dim
    const spEls = el.children.filter((c) => c.className === "detail-spell");
    expect(spEls[0]!.style["color"]).toBeUndefined();
    expect(spEls[1]!.style["color"]).toBe("var(--c-dim)");
    // focusSlot（SLOT_ORDER の添字）の行だけ accent 色
    const slots = el.children.filter((c) => c.className === "detail-item" || c.className === "detail-slot");
    expect(slots.filter((c) => c.style["color"] === "var(--c-accent)").map((c) => c.textContent)).toEqual(["盾", t("detail.equipNone")]);
  });

  test("UI-59 所持品は 9 件以上、呪文は 15 件以上なら最後の枠を「ほか {n}」（n は出していない件数）。頁を渡すとその頁をそのまま出す", () => {
    const cell = (x: number) => ({ text: String(x), dim: false });
    const more = (n: number) => t("character.more", { n });
    const nine = Array.from({ length: 9 }, (_, i) => i);
    expect(characterCells(nine, 8, cell, more).map((c) => c.text)).toEqual(["0", "1", "2", "3", "4", "5", "6", "ほか 2"]);
    expect(characterCells(nine.slice(0, 8), 8, cell, more).map((c) => c.text)).toEqual(["0", "1", "2", "3", "4", "5", "6", "7"]);
    expect(characterCells(nine, 8, cell, more, 1).map((c) => c.text)).toEqual(["8"]);
    expect(characterCells(nine, 8, cell, more, 0)).toHaveLength(8);
    const s = newGame(1);
    const member = structuredClone(campMenu(s, data)!.members[3]!);
    member.knownSpells = Array.from({ length: 15 }, (_, i) => ({ spellId: `s${i}`, name: `呪${i}`, mp: 1, castable: true }));
    const d = formatCharacter(s.party[3]!, data, S, nameOf(s), memberSheet(s, data, s.party[3]!), member);
    expect(d.spells).toHaveLength(14);
    expect(d.spells[13]).toEqual({ text: "ほか 2", dim: false });
    const p1 = formatCharacter(s.party[3]!, data, S, nameOf(s), memberSheet(s, data, s.party[3]!), member, { spellPage: 1 });
    expect(p1.spells.map((c) => c.text)).toEqual(["呪14 MP1"]);
    // member が無ければ所持品と呪文の行は空
    const none = formatCharacter(s.party[3]!, data, S, nameOf(s));
    expect([none.inventoryHeading, none.inventory, none.spellHeading, none.spells]).toEqual(["", [], "", []]);
  });
});

describe("UI-69 キャラクター画面の行 2（M10）", () => {
  const px = (v: string | undefined): number => Number((v ?? "").replace("px", ""));
  test("UI-69 levelUpView で 3 通り: ready は「Lv UP 可（宿で処理）」（accent）、next は「次の Lv まで あと n」、blocked は空欄。sheet が無ければ空", () => {
    const s = structuredClone(newGame(1));
    const ch = s.party[0]!; // 戦士 L1。L2 は 50
    const next = (c: typeof ch) => formatCharacter(c, data, S, nameOf(s), memberSheet(s, data, c)).next;
    expect(next({ ...ch, exp: 49 })).toEqual({ text: "次の Lv まで あと 1", ready: false });
    expect(next({ ...ch, exp: 50 })).toEqual({ text: "Lv UP 可（宿で処理）", ready: true });
    expect(next({ ...ch, exp: 50, life: "dead", hp: 0 })).toEqual({ text: "", ready: false });
    expect(next({ ...ch, exp: 10, life: "ash", hp: 0 })).toEqual({ text: "次の Lv まで あと 40", ready: false });
    expect(formatCharacter({ ...ch, exp: 50 }, data, S, nameOf(s)).next).toEqual({ text: "", ready: false });
    vi.stubGlobal("document", { createElement: (): FakeEl => new FakeEl() });
    const v = createDetailView({ x: 0, y: 16, w: 240, h: 284 });
    const nextEl = (): FakeEl => (v.el as unknown as FakeEl).children.find((c) => c.className === "detail-next")!;
    v.render(formatCharacter({ ...ch, exp: 50 }, data, S, nameOf(s), memberSheet(s, data, { ...ch, exp: 50 })));
    expect([nextEl().textContent, nextEl().style["color"]]).toEqual(["Lv UP 可（宿で処理）", "var(--c-accent)"]);
    v.render(formatCharacter({ ...ch, exp: 49 }, data, S, nameOf(s), memberSheet(s, data, { ...ch, exp: 49 })));
    expect([nextEl().textContent, nextEl().style["color"]]).toEqual(["次の Lv まで あと 1", undefined]);
  });

  test("UI-69 行 2 の 3 列: レベル x4・経験値 x56・次 x120（幅 116）。各列の文字は次の列の x を越えず、数字はレベル 6 桁・経験値 9 桁・あと 11 桁まで入る", () => {
    vi.stubGlobal("document", { createElement: (): FakeEl => new FakeEl() });
    expect(LEVEL_COLUMNS).toEqual({ level: { x: 4, w: 52 }, exp: { x: 56, w: 64 }, next: { x: 120, w: 116 } });
    const fits = (text: string, col: { x: number; w: number }): boolean => textUnits(text) * 4 <= col.w;
    expect(fits(t("detail.level", { level: 999999 }), LEVEL_COLUMNS.level)).toBe(true);
    expect(fits(t("detail.exp", { exp: 999999999 }), LEVEL_COLUMNS.exp)).toBe(true);
    expect(fits(t("detail.nextLevel", { n: 99999999999 }), LEVEL_COLUMNS.next)).toBe(true);
    expect(fits(t("detail.levelUpReady"), LEVEL_COLUMNS.next)).toBe(true);
    expect(LEVEL_COLUMNS.level.x + LEVEL_COLUMNS.level.w).toBeLessThanOrEqual(LEVEL_COLUMNS.exp.x);
    expect(LEVEL_COLUMNS.exp.x + LEVEL_COLUMNS.exp.w).toBeLessThanOrEqual(LEVEL_COLUMNS.next.x);
    expect(LEVEL_COLUMNS.next.x + LEVEL_COLUMNS.next.w).toBeLessThanOrEqual(240 - 4);
    const v = createDetailView({ x: 0, y: 16, w: 240, h: 284 });
    const s = newGame(1);
    v.render(formatCharacter(s.party[0]!, data, S, nameOf(s), memberSheet(s, data, s.party[0]!)));
    const el = v.el as unknown as FakeEl;
    const at = (cls: string) => {
      const c = el.children.find((x) => x.className === cls)!;
      return [px(c.style["left"]) + 1, px(c.style["top"]) + 1, px(c.style["width"])];
    };
    expect([at("detail-level"), at("detail-exp"), at("detail-next")]).toEqual([
      [4, 24, 52],
      [56, 24, 64],
      [120, 24, 116],
    ]);
  });

  test("UI-69 使う文言のキーがすべて strings にある", () => {
    for (const k of ["detail.levelUpReady", "detail.nextLevel", "character.inventoryHeading", "character.spellHeading", "character.spellCell", "character.more"]) {
      expect(Object.prototype.hasOwnProperty.call(S, k), k).toBe(true);
    }
  });
});

describe("UI-68 キャラクター画面の呪文の説明（M10）", () => {
  const px = (v: string | undefined): number => Number((v ?? "").replace("px", ""));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("UI-68 spellNote があれば呪文の枠（行 20〜26）の代わりに説明を 1 行ずつ出す（見出しは accent、7 行まで）。無ければ今までどおり呪文の枠", () => {
    vi.stubGlobal("document", { createElement: (): FakeEl => new FakeEl() });
    const v = createDetailView({ x: 0, y: 16, w: 240, h: 284 });
    const s = newGame(1);
    const ch = s.party[3]!;
    const member = campMenu(s, data)!.members[3]!;
    const d = formatCharacter(ch, data, S, nameOf(s), memberSheet(s, data, ch), member);
    v.render({ ...d, spellNote: ["治癒　MP 2", "対象 味方 1 人", "場面 いつでも", "a", "b", "c", "d", "あふれる行"] });
    const el = v.el as unknown as FakeEl;
    expect(el.children.filter((c) => c.className === "detail-spell")).toEqual([]);
    const note = el.children.filter((c) => c.className === "detail-spell-note");
    expect(note.map((c) => [px(c.style["left"]) + 1, px(c.style["top"]) + 1, c.textContent])).toEqual([
      [4, 204, "治癒　MP 2"],
      [4, 214, "対象 味方 1 人"],
      [4, 224, "場面 いつでも"],
      [4, 234, "a"],
      [4, 244, "b"],
      [4, 254, "c"],
      [4, 264, "d"],
    ]);
    expect(note.map((c) => c.style["color"])).toEqual(["var(--c-accent)", undefined, undefined, undefined, undefined, undefined, undefined]);
    // 見出し「呪文」は残す
    expect(el.children.filter((c) => c.className === "detail-spell-head").map((c) => c.textContent)).toEqual([t("character.spellHeading")]);
    v.render(d);
    expect(el.children.filter((c) => c.className === "detail-spell-note")).toEqual([]);
    expect(el.children.filter((c) => c.className === "detail-spell").length).toBe(member.knownSpells.length);
  });
});
