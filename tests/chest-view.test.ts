// UI-70（M11 作業 8）宝箱の操作の段（views/chest.ts の純粋な状態機械）。値は core の chestView だけ（UI-35）。
// 送る Command は core が受け付けることも確かめる。箱は debug.chest（衝動・掛け合いなし）で置く。
// 既定のパーティ（dived(1)）: c1 アルド、c2 ベルク、c3 キリ（盗賊）、c4 ドナ、c5 エル、c6 フィン（盗賊）。
import { describe, expect, test } from "vitest";
import { execute } from "../src/core/engine";
import { chestView } from "../src/core/rules/chest";
import type { ChestView, Command, GameState } from "../src/core/types";
import { CHEST_MENU, chestEntries, chestHeading, chestParent, chestRepair, type ChestChoice, type ChestEntry, type ChestPage } from "../src/presenter/views/chest";
import { dived, exec } from "./helpers/battle";
import { data, withChar } from "./helpers/core";

const S = data.strings;

function withChest(trapId: string | null): GameState {
  return exec(dived(1), { type: "debug.chest", trapId }).state;
}

const viewOf = (s: GameState): ChestView => {
  const v = chestView(s, data);
  if (v === null) throw new Error("no chestView");
  return v;
};

const labels = (es: ChestEntry[]): string[] => es.map((e) => e.label);
const sent = (c: ChestChoice): Command => {
  if (c.kind !== "send") throw new Error(`not send: ${JSON.stringify(c)}`);
  return c.command;
};

describe("UI-70 宝箱の段（views/chest）", () => {
  test("UI-70 menu は [調べる][解除][開ける][放っておく]。調べる・解除は人の段へ、開ける・放っておくは chest.open / chest.leave を送る。ヘッダーの問いは無い（場所のまま）", () => {
    const v = viewOf(withChest("bomb"));
    const es = chestEntries(CHEST_MENU, v, S);
    expect(labels(es)).toEqual(["調べる", "解除", "開ける", "放っておく"]);
    expect(es.every((e) => !e.disabled)).toBe(true);
    expect(es.map((e) => e.choice)).toEqual([
      { kind: "page", page: { kind: "inspect" } },
      { kind: "page", page: { kind: "disarmWho" } },
      { kind: "send", command: { type: "chest.open" } },
      { kind: "send", command: { type: "chest.leave" } },
    ]);
    expect(chestHeading(CHEST_MENU, v, S)).toBeNull();
    expect(chestParent(CHEST_MENU)).toBeNull();
  });

  test("UI-70/CB-63 調べるの段: chestView の members（並び順）と末尾の [戻る]。canAct でない者は dim で理由 chest.menu.cannotAct。選ぶと chest.inspect{memberId}（core が受け付ける）", () => {
    const s = withChar(withChest("bomb"), 4, { status: ["paralysis"] });
    const v = viewOf(s);
    const page: ChestPage = { kind: "inspect" };
    const es = chestEntries(page, v, S);
    expect(labels(es)).toEqual(["アルド", "ベルク", "キリ", "ドナ", "エル", "フィン", "戻る"]);
    expect(es.map((e) => e.disabled)).toEqual([false, false, false, false, true, false, false]);
    expect(es[4]!.reason).toBe("エルは動けない。");
    expect(es.filter((e) => e.reason !== undefined)).toHaveLength(1);
    expect(es.at(-1)!.choice).toEqual({ kind: "back" });
    expect(sent(es[2]!.choice)).toEqual({ type: "chest.inspect", memberId: "c3" });
    const r = execute(s, sent(es[2]!.choice), data);
    expect(r.events[0]?.kind).not.toBe("rejected");
    expect(r.events.some((e) => e.kind === "dice" && e.label.key === "dice.chestInspect")).toBe(true);
    // 動けない者の inspect は core も断る（dim の判断は core の canAct と同じ）
    expect(execute(s, { type: "chest.inspect", memberId: "c5" }, data).events[0]?.kind).toBe("rejected");
    expect(chestHeading(page, v, S)).toBe("誰が箱を調べる？");
    expect(chestParent(page)).toEqual(CHEST_MENU);
  });

  test("UI-70/EV-73 掛け合いの担当（chestView.ownerId）は人の段で印 chest.menu.owner（調べる・解除の両方）", () => {
    const s = withChest("bomb");
    s.dive!.chest!.rivalry = { id: "thief_chest", ownerId: "c3" };
    const v = viewOf(s);
    for (const kind of ["inspect", "disarmWho"] as const) {
      expect(labels(chestEntries({ kind }, v, S)).slice(0, 6)).toEqual(["アルド", "ベルク", "キリ（担当）", "ドナ", "エル", "フィン"]);
    }
  });

  test("UI-70/CB-64 解除の段: 人を選ぶと罠の名前の段（chest-traps の全 8 種、データの順と [戻る]）。ヘッダーは「{name}が外す罠は？」。選ぶと chest.disarm{memberId, trapId}（core が受け付ける）", () => {
    const s = withChest("bomb");
    const v = viewOf(s);
    const who = chestEntries({ kind: "disarmWho" }, v, S);
    expect(who[5]!.choice).toEqual({ kind: "page", page: { kind: "disarmTrap", memberId: "c6" } });
    expect(chestHeading({ kind: "disarmWho" }, v, S)).toBe("誰が罠を外す？");
    const page: ChestPage = { kind: "disarmTrap", memberId: "c6" };
    const es = chestEntries(page, v, S);
    expect(labels(es)).toEqual(["毒針", "石弓", "爆弾", "毒ガス", "麻痺ガス", "警報", "転移", "呪詛", "戻る"]);
    expect(es.every((e) => !e.disabled)).toBe(true);
    expect(sent(es[2]!.choice)).toEqual({ type: "chest.disarm", memberId: "c6", trapId: "bomb" });
    const r = execute(s, sent(es[2]!.choice), data);
    expect(r.events[0]?.kind).not.toBe("rejected");
    expect(r.events.some((e) => e.kind === "dice" && e.label.key === "dice.chestDisarm")).toBe(true);
    expect(chestHeading(page, v, S)).toBe("フィンが外す罠は？");
    expect(chestParent(page)).toEqual({ kind: "disarmWho" });
  });

  test("UI-70/CB-63 告げられた名前（chestView.finding）は罠の名前の段で印 chest.menu.found。並びは変えない。「罠は無さそう」（trapId null）は印なし", () => {
    const s = withChest("bomb");
    s.dive!.chest!.finding = { trapId: "crossbow" };
    const es = chestEntries({ kind: "disarmTrap", memberId: "c3" }, viewOf(s), S);
    expect(labels(es).slice(0, 3)).toEqual(["毒針", "石弓（見立て）", "爆弾"]);
    s.dive!.chest!.finding = { trapId: null };
    expect(labels(chestEntries({ kind: "disarmTrap", memberId: "c3" }, viewOf(s), S)).slice(0, 8)).toEqual(["毒針", "石弓", "爆弾", "毒ガス", "麻痺ガス", "警報", "転移", "呪詛"]);
  });

  test("UI-70 chestRepair: 罠の段の人が動けなくなった・いなければ人の段へ。ほかの段はそのまま", () => {
    const s = withChest("bomb");
    const page: ChestPage = { kind: "disarmTrap", memberId: "c6" };
    expect(chestRepair(page, viewOf(s))).toEqual(page);
    expect(chestRepair(page, viewOf(withChar(s, 5, { status: ["paralysis"] })))).toEqual({ kind: "disarmWho" });
    expect(chestRepair({ kind: "disarmTrap", memberId: "zz" }, viewOf(s))).toEqual({ kind: "disarmWho" });
    for (const p of [CHEST_MENU, { kind: "inspect" }, { kind: "disarmWho" }] as ChestPage[]) expect(chestRepair(p, viewOf(s))).toEqual(p);
  });

  test("UI-70 段の文言の鍵は strings.json にある", () => {
    for (const k of ["chest.menu.inspect", "chest.menu.disarm", "chest.menu.open", "chest.menu.leave", "chest.menu.whoInspect", "chest.menu.whoDisarm", "chest.menu.which", "chest.menu.owner", "chest.menu.found", "chest.menu.cannotAct", "common.back"]) {
      expect(S[k], k).toBeTypeOf("string");
    }
  });
});
