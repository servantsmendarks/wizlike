// UI-59 詳細（src/presenter/views/detail.ts）。純粋な formatDetail と、document を最小の偽物に差し替えた配置の確認。
import { afterEach, describe, expect, test, vi } from "vitest";
import { EQUIP_SLOTS, STAT_KEYS } from "../src/core/data/index";
import { createItemInstance, itemDisplayName } from "../src/core/state";
import type { GameState } from "../src/core/types";
import { createDetailView, formatDetail, SLOT_ORDER, STAT_ORDER } from "../src/presenter/views/detail";
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
    const d = formatDetail(ch, data, S, nameOf(s));
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
    const d = formatDetail(s.party[0]!, data, S, nameOf(s));
    expect(d.equipment[0]).toEqual({ slot: "武器", item: "短い刃？" });
    s.items[iid]!.identified = true;
    expect(formatDetail(s.party[0]!, data, S, nameOf(s)).equipment[0]!.item).toBe("短剣");
    const dead = formatDetail({ ...s.party[0]!, life: "dead", hp: 0, status: ["poison"] }, data, S, nameOf(s));
    expect(dead.status).toBe(t("detail.status", { status: t("party.life.dead") }));
    const poisoned = formatDetail({ ...s.party[0]!, status: ["poison", "sleep"] }, data, S, nameOf(s));
    expect(poisoned.status).toBe(t("detail.status", { status: "毒 眠" }));
    // 呪文を使う職業は MP 現在/最大（ドナ、priest）
    const priest = formatDetail(s.party[3]!, data, S, nameOf(s));
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
  test("UI-59/TW-15 formatDetail: SAN は「SAN 110/100」（最大は core の memberSheet の sanMax）で sanOver が真。100/100 は偽。sheet の省略は sanMax", () => {
    const s = newGame(1);
    const over = { ...s.party[0]!, san: 110 };
    const d = formatDetail(over, data, S, nameOf(s), memberSheet(s, data, over));
    expect(d.san).toBe("SAN 110/100");
    expect(d.sanOver).toBe(true);
    expect(formatDetail(over, data, S, nameOf(s)).san).toBe("SAN 110/100");
    const normal = formatDetail(s.party[0]!, data, S, nameOf(s), memberSheet(s, data, s.party[0]!));
    expect([normal.san, normal.sanOver]).toEqual(["SAN 100/100", false]);
  });

  test("UI-59/TW-15 render: sanOver なら SAN の行を accent 色、そうでなければ色を付けない", () => {
    vi.stubGlobal("document", { createElement: (): FakeEl => new FakeEl() });
    const v = createDetailView({ x: 0, y: 16, w: 240, h: 150 });
    const s = newGame(1);
    const sanEl = (): FakeEl => (v.el as unknown as FakeEl).children.find((c) => c.className === "detail-san")!;
    v.render(formatDetail({ ...s.party[0]!, san: 110 }, data, S, nameOf(s)));
    expect(sanEl().textContent).toBe("SAN 110/100");
    expect(sanEl().style["color"]).toBe("var(--c-accent)");
    v.render(formatDetail(s.party[0]!, data, S, nameOf(s)));
    expect(sanEl().style["color"]).toBeUndefined();
  });

  test("UI-12/TW-15 パーティ欄: SAN が上限（maxOf の sanMax）を超えている行は SAN の値が accent 色。setSan で上限以下に戻ると色を外す", () => {
    vi.stubGlobal("document", { createElement: (): FakeEl => new FakeEl() });
    const panel = createPartyPanel({
      strings: S,
      classes: data.classes,
      region: { x: 0, y: 0, w: 240, h: 64 },
      rows: [],
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
  test("UI-59/CH-13/CH-14/CB-20/MG-33 formatDetail は core の memberSheet の値を出す: 能力値（力 16）・HP の最大 21・SAN の最大 110・AC 4・魔法攻撃力 2。sheet が無ければ素の値で AC と魔法攻撃力は空", () => {
    const s = equippedAld();
    const ch = s.party[0]!;
    const d = formatDetail(ch, data, S, nameOf(s), memberSheet(s, data, ch));
    expect(d.stats[0]).toEqual({ label: "力", value: 16, text: "力 16" });
    expect(d.hp).toBe(`HP ${ch.hp}/21`);
    expect(d.san).toBe(`SAN ${ch.san}/110`);
    // AC = acBase 10 − 3 − 2 − 1 = 4
    expect(d.ac).toBe("AC 4");
    expect(d.magicPower).toBe("魔法攻撃力 2");
    // CB-22: 杖 1d4（術者用なので Lv の効果は足さない）+ 力 16 の補正 3 + リーダーの性格恩恵 0 → 攻撃 1d4+3
    expect(d.attack).toBe("攻撃 1d4+3");
    const raw = formatDetail(ch, data, S, nameOf(s));
    expect([raw.stats[0]!.value, raw.hp, raw.ac, raw.magicPower, raw.attack]).toEqual([14, `HP ${ch.hp}/15`, "", "", ""]);
    // 装備名は IT-11 の表示名（ユニークはユニークの名前、汎用は +Lv）
    expect(d.equipment.map((e) => e.item)).toEqual(["杖 +5", "革鎧 +3", t("detail.equipNone"), "早鐘の兜", t("detail.equipNone"), "護符"]);
  });

  test("UI-59/CB-22 formatDetail の攻撃: 足し分が 0 なら「攻撃 1d8」、負なら「攻撃 1d2-1」（memberSheet の attackDice / attackBonus）", () => {
    const s = structuredClone(newGame(1));
    const ch = s.party[0]!;
    ch.stats.str = 10; // 長剣 Lv0・力 10（補正 0）・リーダー（恩恵 0）→ 足し分 0
    expect(formatDetail(ch, data, S, nameOf(s), memberSheet(s, data, ch)).attack).toBe("攻撃 1d8");
    ch.equipment.weapon = null;
    ch.stats.str = 9; // 素手 1d2・力 9 の補正 −1
    expect(formatDetail(ch, data, S, nameOf(s), memberSheet(s, data, ch)).attack).toBe("攻撃 1d2-1");
  });

  // 2026-10-06（ユーザーの指示）: 攻撃の行はオプションまで合算した実効値。ダイスの記法の定数と足し分を 1 つの定数にする（品の詳細とは役割が違う）
  test("UI-59/CB-22 formatDetail の攻撃: ダイスの定数・Lv の分・オプション damage・力補正を 1 つの定数に合算する（「1d4+1+4」にしない）", () => {
    const s = structuredClone(newGame(1));
    const ch = s.party[0]!;
    ch.stats.str = 14; // 力補正 2、リーダー（恩恵 0）
    ch.equipment.weapon = createItemInstance(s, { itemId: "throwing_knives", level: 2, options: [{ optionId: "damage", tier: 1, value: 1 }], identified: true });
    // 投げナイフ 1d4+1 + 力 2 + Lv2 の 1 + オプション 1 → 1d4+5
    expect(formatDetail(ch, data, S, nameOf(s), memberSheet(s, data, ch)).attack).toBe("攻撃 1d4+5");
    ch.stats.str = 6; // 力補正 −2 → 1d4+1 − 2 + 1 + 1 = 1d4+1
    expect(formatDetail(ch, data, S, nameOf(s), memberSheet(s, data, ch)).attack).toBe("攻撃 1d4+1");
    ch.stats.str = 2; // 力補正 −4 → 合計 −1
    expect(formatDetail(ch, data, S, nameOf(s), memberSheet(s, data, ch)).attack).toBe("攻撃 1d4-1");
  });

  // M7（2026-10-05）: 7 行目の「装備」の見出しを攻撃の行（x4）に替えた
  test("UI-59 render: 7 行目は 攻撃（x4）・AC（x84）・魔法攻撃力（x164）。14 行のまま", () => {
    vi.stubGlobal("document", { createElement: (): FakeEl => new FakeEl() });
    const v = createDetailView({ x: 0, y: 16, w: 240, h: 150 });
    const s = equippedAld();
    v.render(formatDetail(s.party[0]!, data, S, nameOf(s), memberSheet(s, data, s.party[0]!)));
    const el = v.el as unknown as FakeEl;
    const px = (x: string | undefined): number => Number((x ?? "").replace("px", ""));
    const at = (cls: string): [number, number, string] => {
      const c = el.children.find((x) => x.className === cls)!;
      return [px(c.style["left"]) + 1, px(c.style["top"]) + 1, c.textContent];
    };
    expect(at("detail-attack")).toEqual([4, 74, "攻撃 1d4+3"]);
    expect(at("detail-ac")).toEqual([84, 74, "AC 4"]);
    expect(at("detail-magic-power")).toEqual([164, 74, "魔法攻撃力 2"]);
    expect(new Set(el.children.map((c) => c.style["top"])).size).toBe(14);
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

describe("UI-59 詳細の配置", () => {
  test("UI-59 render の 14 行はキャンプのパネル（ビュー領域 240×150）の内側に収まり、行の下端は 144。名前は accent 色。focusSlot の枠は accent 色", () => {
    vi.stubGlobal("document", { createElement: (): FakeEl => new FakeEl() });
    const rect = { x: 0, y: 16, w: 240, h: 150 };
    const v = createDetailView(rect);
    const s = newGame(1);
    v.render(formatDetail(s.party[0]!, data, S, nameOf(s)));
    const el = v.el as unknown as FakeEl;
    expect(el.style["left"]).toBe("0px");
    expect(el.style["top"]).toBe("16px");
    const px = (v: string | undefined): number => Number((v ?? "").replace("px", ""));
    expect(el.children.length).toBeGreaterThan(0);
    expect(el.style["border"]).toBe("1px solid var(--c-frame)");
    // 子の absolute は枠 1px の内側が原点（#stage * は border-box）。外形の座標に直して確かめる
    let bottom = 0;
    for (const c of el.children) {
      const x = px(c.style["left"]) + 1;
      const y = px(c.style["top"]) + 1;
      const w = px(c.style["width"]);
      const h = px(c.style["height"]);
      expect(x >= 0 && y >= 0 && x + w <= rect.w && y + h <= rect.h, `${c.className} ${c.textContent}`).toBe(true);
      bottom = Math.max(bottom, y + h);
    }
    expect(bottom).toBe(144);
    // 名前の行は外形の (4, 4)
    const nameEl = el.children.find((c) => c.className === "detail-name")!;
    expect([px(nameEl.style["left"]) + 1, px(nameEl.style["top"]) + 1]).toEqual([4, 4]);
    expect(new Set(el.children.map((c) => c.style["top"])).size).toBe(14);
    // focusSlot（SLOT_ORDER の添字）の行だけ accent 色
    v.render(formatDetail(s.party[0]!, data, S, nameOf(s)), 2);
    const items = (v.el as unknown as FakeEl).children.filter((c) => c.className === "detail-item" || c.className === "detail-slot");
    expect(items.filter((c) => c.style["color"] === "var(--c-accent)").map((c) => c.textContent)).toEqual(["盾", "木の盾"]);
    expect(el.children.find((c) => c.className === "detail-name")!.style["color"]).toBe("var(--c-accent)");
    expect(el.children.find((c) => c.className === "detail-race-class")!.textContent).toBe("人間 戦士");
    expect(el.children.filter((c) => c.className === "detail-item").map((c) => c.textContent)).toEqual([
      "長剣",
      "革鎧",
      "木の盾",
      t("detail.equipNone"),
      t("detail.equipNone"),
      t("detail.equipNone"),
    ]);
  });
});
