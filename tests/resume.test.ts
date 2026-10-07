// 続きから（SV-50）の計画 resumePlan（src/presenter/resume.ts。DOM なし）と、保存→読み込みの往復で計画と戦闘の入力の段階が変わらないこと。
import { describe, expect, test } from "vitest";
import { execute } from "../src/core/engine";
import { battleMenu } from "../src/core/rules/combat";
import { offerExit, offerStairs, offerTeleporter, offerTrap } from "../src/core/rules/choices";
import { returnToTown } from "../src/core/rules/town";
import { cloneState } from "../src/core/state";
import type { GameState } from "../src/core/types";
import { firstCursor } from "../src/presenter/battle-input";
import { resumePlan, routeOfScreen } from "../src/presenter/resume";
import { createSaveService } from "../src/save/saves";
import { dived, withBattle } from "./helpers/battle";
import { ctxFor, data, loadFreshData, newGame } from "./helpers/core";
import { atEvent } from "./helpers/events";
import { createMemoryBackend } from "./helpers/save";

/** 保存先（メモリ）へ begin で書き、別のサービス（リロード後に相当）で load した state */
async function roundTrip(st: GameState): Promise<GameState> {
  const mem = createMemoryBackend();
  const deps = { backend: mem, now: () => 1, schemaVersion: data.config.save.schemaVersion, maxGames: data.config.save.maxGames };
  const a = createSaveService({ ...deps, newId: () => "g1" });
  expect((await a.begin(st)).ok).toBe(true);
  const b = createSaveService({ ...deps, newId: () => "unused" });
  const r = await b.load("g1");
  if (!r.ok) throw new Error(`load failed: ${r.reason}`);
  return r.state;
}

/** dived(1) で、ctx に選択を立てたもの */
function pending(offer: (ctx: ReturnType<typeof ctxFor>) => void): GameState {
  const ctx = ctxFor(dived(1));
  offer(ctx);
  return ctx.state;
}

/** 救済の申し出がある街（リーダーだけ alive、所持金 0 で迷宮から帰った） */
function mercyTown(): GameState {
  const s = cloneState(dived(1));
  for (const ch of s.party.slice(1)) {
    ch.life = "dead";
    ch.hp = 0;
  }
  s.gold = 0;
  s.bank = 0;
  const ctx = ctxFor(s);
  returnToTown(ctx, "dungeon.return");
  return ctx.state;
}

describe("続きから（SV-50）", () => {
  test("SV-50 保存した screen へ直接戻る（town / dungeon / battle）。問いが無ければ prompts は空", () => {
    expect(resumePlan(newGame(1), data)).toEqual({ route: "town", prompts: [] });
    expect(resumePlan(dived(1), data)).toEqual({ route: "dungeon", prompts: [] });
    const b = withBattle(dived(1), [{ monsterId: data.monsters[0]!.id, hps: [3] }]);
    expect(resumePlan(b, data)).toEqual({ route: "battle", prompts: [] });
  });

  test("SV-50/DG-06/DG-14/DG-32 保留中の選択があれば、その promptKey（params なし）をメッセージ窓に出し直す", () => {
    expect(resumePlan(pending(offerExit), data)).toEqual({ route: "dungeon", prompts: ["dungeon.stairsUp"] });
    expect(resumePlan(pending((c) => offerStairs(c, "down")), data)).toEqual({ route: "dungeon", prompts: ["dungeon.stairsDown"] });
    expect(resumePlan(pending((c) => offerStairs(c, "up")), data)).toEqual({ route: "dungeon", prompts: ["dungeon.stairsUpFloor"] });
    expect(resumePlan(pending(offerTeleporter), data)).toEqual({ route: "dungeon", prompts: ["dungeon.teleporter"] });
    for (const k of ["dungeon.stairsUp", "dungeon.stairsDown", "dungeon.stairsUpFloor", "dungeon.teleporter"]) expect(data.strings[k], k).toBeTypeOf("string");
  });

  test("SV-50/TW-30 救済の申し出がある街なら town.mercy.offer を出し直し、受けた後は出さない", () => {
    const s = mercyTown();
    expect(s.townVisit).toEqual({ mercyOffered: true });
    expect(resumePlan(s, data)).toEqual({ route: "town", prompts: ["town.mercy.offer"] });
    const r = execute(s, { type: "town.mercy", memberId: "c2" }, data);
    expect(r.state.townVisit).toEqual({ mercyOffered: false });
    expect(resumePlan(r.state, data)).toEqual({ route: "town", prompts: [] });
    expect(data.strings["town.mercy.offer"]).toBeTypeOf("string");
  });

  test("UI-55 routeOfScreen: event → dungeon、town / dungeon / battle はそのまま、title → null", () => {
    expect(routeOfScreen("event")).toBe("dungeon");
    expect(routeOfScreen("town")).toBe("town");
    expect(routeOfScreen("dungeon")).toBe("dungeon");
    expect(routeOfScreen("battle")).toBe("battle");
    expect(routeOfScreen("title")).toBeNull();
  });

  test("SV-50/UI-55 screen event は route dungeon、prompts は [intro]（保存と読み込みの往復でも）", async () => {
    const d = loadFreshData();
    d.config.events.cap = 0; // 衝動を起こさず選択を待たせる
    for (const def of d.dungeons) def.encounterRate = { room: 0, corridor: 0 };
    const ev = execute(atEvent("glowing_tablet").state, { type: "dungeon.move" }, d).state;
    expect(ev.screen).toBe("event");
    expect(resumePlan(ev, data)).toEqual({ route: "dungeon", prompts: ["event.glowing_tablet.intro"] });
    const back = await roundTrip(ev);
    expect(back).toEqual(JSON.parse(JSON.stringify(ev)));
    expect(resumePlan(back, data)).toEqual({ route: "dungeon", prompts: ["event.glowing_tablet.intro"] });
  });

  test("SV-50/DG-21 察知の保留は route dungeon、prompts は [dungeon.trap.prompt]（往復でも）", async () => {
    const s = pending(offerTrap);
    expect(resumePlan(s, data)).toEqual({ route: "dungeon", prompts: ["dungeon.trap.prompt"] });
    expect(resumePlan(await roundTrip(s), data)).toEqual({ route: "dungeon", prompts: ["dungeon.trap.prompt"] });
  });

  test("SV-50 title など復帰できない screen は例外（読み込みの形の検査で弾かれている前提）", () => {
    const s = { ...newGame(1), screen: "title" as const, townVisit: null };
    expect(() => resumePlan(s, data)).toThrow(/unexpected screen/);
  });

  test("SV-03/SV-50 保存先との往復の後も計画は同じ（選択・救済）", async () => {
    for (const s of [newGame(1), dived(1), pending(offerExit), pending(offerTeleporter), mercyTown()]) {
      const back = await roundTrip(s);
      expect(back).toEqual(JSON.parse(JSON.stringify(s)));
      expect(resumePlan(back, data)).toEqual(resumePlan(s, data));
    }
  });

  test("SV-50/UI-54 戦闘の入力途中で往復しても battleMenu と入力の段階は同じ（パーティの選択から。入力済みは inputs に残る）", async () => {
    const m = data.monsters[0]!.id;
    const s = withBattle(dived(1), [{ monsterId: m, hps: [3, 3] }], { inputs: { c1: { type: "defend" } } });
    const back = await roundTrip(s);
    const before = battleMenu(s, data);
    const after = battleMenu(back, data);
    expect(after).toEqual(before);
    expect(before).not.toBeNull();
    expect(firstCursor(after!)).toEqual({ stage: "party" });
    expect(firstCursor(after!)).toEqual(firstCursor(before!));
    expect(back.battle?.inputs).toEqual({ c1: { type: "defend" } });
    expect(resumePlan(back, data)).toEqual({ route: "battle", prompts: [] });
    // オート中の戦闘は入力の段階を持たない（app は kickBattle で連鎖を再開する）
    const auto = await roundTrip(withBattle(dived(1), [{ monsterId: m, hps: [3] }], { auto: true }));
    expect(battleMenu(auto, data)?.auto).toBe(true);
    expect(firstCursor(battleMenu(auto, data)!)).toBeNull();
  });
});
