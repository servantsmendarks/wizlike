// H9 バランスの煙テスト（既定の npm test）: 200 シードの計測（npm run balance、tests/balance/campaign.sim.ts）と同じボットを
// 5 シード × 潜行 2 回だけ回し、不変条件（rejected が出ない、state の不変条件、全滅の内訳 = 差分、DG-43 など）だけを確かめる。
// M9: 進行ボット（d01 の 2 階とボス、d01 の踏破の後の d02）の煙テストを足した（数字は見ない）。M12: 進行ボットは d01 → d02 → d03 の順に最下層のボスまで潜る。
import { describe, expect, test } from "vitest";
import { execute } from "../src/core/engine";
import { townMenu } from "../src/core/rules/town";
import { data, expectStateInvariants } from "./helpers/core";
import { chestRate } from "../src/core/rules/chest";
import type { Command, GameState } from "../src/core/types";
import { farmBot, farmReport } from "./balance/farm";
import { BOTS, BOSS_LEVELS, Campaign, D03_DIVES, DESCEND_LEVELS, DISARM_TRIES, levelFor, PROGRESS_BOT, PROGRESS_DIVES, progressReport, report, runCampaigns } from "./balance/bot";

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

const SEEDS = 5;
const DIVES = 2;

describe("バランス（H9 煙テスト）", () => {
  for (const kind of BOTS) {
    test(`H9 バランス煙テスト: ${kind.label}ボットで 潜行 → 街 を ${DIVES} 回 × ${SEEDS} シード、不変条件が崩れない`, () => {
      const { results, keys } = runCampaigns(kind, SEEDS, DIVES);
      expect(results).toHaveLength(SEEDS);
      for (const k of ["battle.encounter", "town.enter", "town.inn.stay"]) expect(keys.has(k), k).toBe(true);
      expect(report(kind, results, SEEDS, DIVES)).toContain(kind.label);
      expect(report(kind, results, SEEDS, DIVES)).toContain("M7-死因"); // M7-死因の集計が後ろに足されている
      // M11（U-5 / EV-16 / EV-71）: 宝箱あたりの衝動と掛け合いの行。見つけた箱 ≥ 衝動 ≥ 制止
      expect(report(kind, results, SEEDS, DIVES)).toContain("宝箱: 衝動");
      for (const d of results.flatMap((r) => r.dives)) {
        const c = d.chestImpulse;
        expect(c.found).toBeGreaterThanOrEqual(c.impulses);
        expect(c.impulses).toBeGreaterThanOrEqual(c.stopped);
        expect(c.found).toBeGreaterThanOrEqual(c.rivalries);
      }
      expect(sum(results.flatMap((r) => r.dives).map((d) => d.chestImpulse.found))).toBeGreaterThan(0);
    }, 60_000);
  }

  test("H9/M9 進行ボットの煙テスト: 3 シード × 3 潜行で不変条件が崩れず、集計に M9-進行の節が出る", () => {
    const { results } = runCampaigns(PROGRESS_BOT, 3, 3);
    expect(results).toHaveLength(3);
    for (const r of results) for (const d of r.dives) expect(d.dungeonId).toBe("d01");
    expect(progressReport(results)).toContain("M9-進行");
  }, 60_000);

  test("H9/M9 進行ボットの煙テスト: 降りる・ボスの条件の level を 1 にすると、d01 の 1 階で下り階段へ歩いて 2 階に降り、ボスへ向かう（3 シード × 2 潜行）", () => {
    const kind = { ...PROGRESS_BOT, label: "進行（L1）", descendLevel: { d01: 1 }, bossLevel: { d01: 1 } };
    const { results, keys } = runCampaigns(kind, 3, 2);
    expect(keys.has("dungeon.descend")).toBe(true);
    const ds = results.flatMap((r) => r.dives);
    expect(ds.some((d) => d.deepestFloor === 2)).toBe(true);
    for (const d of ds) {
      if (d.bossWin) expect(d.method).toBe("teleport");
      if (d.method === "teleport") expect(d.bossWin).toBe(true);
    }
  }, 60_000);

  // ユーザーの判断 2（2026-10-06）で逃走をやめたらシード 4 が 15 潜行で踏破しなくなったので、踏破するシード 2 に替えた。
  // M11 の作業 6（宝箱の衝動 EV-16 と職業の掛け合い EV-71 で勝利の後の乱数の消費が変わった）でシード 2 が踏破しなくなったので、踏破するシード 4 に戻した
  // M12: 進行ボットが d03 まで潜るようになった（設計書 §4-1）。シード 4 は 40 潜行の上限の中で d01・d02 を踏破して d03 に 3 回潜る（実行して確かめた）
  test("H9/M9/M12 進行ボットの煙テスト: シード 4 は d01 のボスを倒してテレポーターで帰り、d02 を最下層 3 階のボスまで踏破し、その後は d03 に D03_DIVES 回潜って終わる（ボスへの経路の煙。データが変わってシード 4 が踏破しなくなったら、踏破するシードに替える）", () => {
    const c = new Campaign(4, PROGRESS_BOT);
    const r = c.campaign(PROGRESS_DIVES);
    const k = r.dives.findIndex((d) => d.bossWin);
    expect(k).toBeGreaterThanOrEqual(0);
    expect(r.dives[k]!.method).toBe("teleport");
    expect(r.dives[k]!.bossFight).toBe(true);
    expect(r.dives[k]!.deepestFloor).toBe(2);
    expect(r.dives.slice(0, k + 1).every((d) => d.dungeonId === "d01")).toBe(true);
    // d01 の踏破の後は d02 の踏破まで d02、その後は d03 に D03_DIVES 回
    const k2 = r.dives.findIndex((d) => d.dungeonId === "d02" && d.bossWin);
    expect(k2).toBeGreaterThan(k);
    expect(r.dives[k2]!.method).toBe("teleport");
    expect(r.dives[k2]!.deepestFloor).toBe(3);
    expect(r.dives.slice(k + 1, k2 + 1).every((d) => d.dungeonId === "d02")).toBe(true);
    expect(r.dives.slice(k2 + 1).map((d) => d.dungeonId)).toEqual(Array.from({ length: D03_DIVES }, () => "d03"));
    expect(c.state.progress.clearedDungeons).toEqual(expect.arrayContaining(["d01", "d02"]));
    expect(c.state.progress.shopLevel).toBe(4);
    expect(progressReport([r])).toContain("d03 の潜行 1:");
    expect(progressReport([r])).toContain("d03 に届いたシード: 1/1");
    expectStateInvariants(c.state);
    // M9-装備: d01 の踏破で流通レベル 2 になり、その帰還の街で後衛の魔術師（エル）に投げナイフを買い与える
    expect(r.dives[k]!.rangedBought).toBe(1);
    expect(c.state.items[c.state.party[4]!.equipment.weapon!]!.itemId).toBe("throwing_knives");
    // ユーザーの判断 2（2026-10-06）: 飛行だけの遭遇で逃走する規則は廃止。ボットは逃げない（逃走の判定の文が出ず、記録と集計に逃走の欄が無い）
    expect(c.keys.has("battle.fleeOk") || c.keys.has("battle.fleeFail")).toBe(false);
    for (const d of r.dives) for (const f of ["fleeTries", "fleeBattles", "fleeOk"]) expect(f in d, f).toBe(false);
    expect(progressReport([r])).not.toContain("逃走");
    expect(sum(r.dives.map((d) => d.battles))).toBeGreaterThan(0);
  }, 60_000);

  test("H9/M9 M9-装備: 防具の更新の予備費は、並び 6 人全員（生死を問わない）の平均 level × templeCostPerLevel（1 人分の蘇生費。小数のまま掛けて切り捨て。ユーザーの判断 1）", () => {
    const c = new Campaign(1, PROGRESS_BOT);
    const per = data.config.economy.templeCostPerLevel;
    const setLevels = (ls: number[]) => ls.forEach((l, i) => (c.state.party[i]!.level = l));
    setLevels([1, 1, 1, 1, 1, 1]);
    expect(c.reviveCost()).toBe(per);
    setLevels([1, 2, 3, 4, 5, 6]);
    expect(c.reviveCost()).toBe(Math.floor(per * 3.5));
    setLevels([1, 1, 1, 1, 1, 2]);
    expect(c.reviveCost()).toBe(Math.floor((per * 7) / 6));
    c.state.party[5]!.life = "dead"; // 死者も数える
    expect(c.reviveCost()).toBe(Math.floor((per * 7) / 6));
  });

  test("H9/M9 M9-装備: 所持金が「投げナイフ + 予備費 + 鎖帷子」ちょうどなら、エルに投げナイフを買った後、アルドの鎧を鎖帷子に替えられる（予備費を超える分を装備に回す。ユーザーの判断 1）", () => {
    const c = new Campaign(1, PROGRESS_BOT);
    c.state.progress.shopLevel = 2;
    const shop = townMenu(c.state, data)!.shop.equipment;
    const knives = shop.find((x) => x.itemId === "throwing_knives")!.price;
    const mail = shop.find((x) => x.itemId === "chain_mail")!.price;
    c.state.gold = knives + c.reviveCost() + mail;
    const rec = { rangedBought: 0, armorBought: 0, armorBoughtByLevel: {}, outfitCost: 0, outfitSoldGold: 0 } as unknown as Parameters<Campaign["outfit"]>[0];
    c.outfit(rec);
    expect(rec.rangedBought).toBe(1);
    expect(c.state.items[c.state.party[0]!.equipment.armor!]!.itemId).toBe("chain_mail");
    expect(rec.armorBought).toBeGreaterThanOrEqual(1);
    expect(rec.armorBoughtByLevel[2]).toBe(rec.armorBought); // 流通レベル 2 の品の数として集計される
    expect(c.state.gold).toBeGreaterThanOrEqual(c.reviveCost());
    expectStateInvariants(c.state);
  });

  test("H9/M9 M9-装備: 所持金 5000・流通レベル 2 で 1 潜行すると、街で前衛の防具を流通レベルの品に替え（実効の AC が下がるものだけ）、後衛に ranged を買い、予備費（平均 level の 1 人分の蘇生費）を残す", () => {
    const c = new Campaign(1, PROGRESS_BOT);
    c.state.gold = 5000;
    c.state.progress.shopLevel = 2;
    const r = c.campaign(1);
    const d = r.dives[0]!;
    expect(d.method).not.toBe("wipe");
    const eq = (i: number, slot: "weapon" | "armor" | "shield" | "helm" | "gauntlet") => {
      const id = c.state.party[i]!.equipment[slot];
      return id === null ? null : `${c.state.items[id]!.itemId}+${c.state.items[id]!.level}`;
    };
    // アルド（戦士）: 革鎧 → 鎖帷子、木の盾 → 鉄の盾、空の兜 → 鉄兜、空の小手 → 革小手（鉄の小手は流通レベル 4）
    expect([eq(0, "armor"), eq(0, "shield"), eq(0, "helm"), eq(0, "gauntlet")]).toEqual(["chain_mail+2", "iron_shield+2", "iron_helm+2", "leather_gloves+2"]);
    // ベルク（戦士）: 鎖帷子 +0 は AC が同じなので替えない
    expect(eq(1, "armor")).toBe("chain_mail+0");
    // キリ（盗賊）: 革鎧 → 鋲打ち革鎧、革兜 → 鎖頭巾、盾は使えない
    expect([eq(2, "armor"), eq(2, "shield"), eq(2, "helm")]).toEqual(["studded_leather+2", null, "chain_coif+2"]);
    // 後衛: 僧侶（ドナ）は投げナイフも短弓も使えない、魔術師（エル）は投げナイフ、短弓のフィンはそのまま
    expect([eq(3, "weapon"), eq(4, "weapon"), eq(5, "weapon")]).toEqual(["staff+0", "throwing_knives+2", "short_bow+0"]);
    expect(d.rangedBought).toBe(1);
    // アルド 4・ベルク 3（盾・兜・小手）・キリ 3（鎧・兜・小手）。予備費を判断 1 の平均 level の 1 人分に替えても 10 のまま
    // （所持金 5000 なら旧予備費（最大 level × 2 人分）でも 10 品すべて払えていたので、予備費を下げても買う品は増えない）
    expect(d.armorBought).toBe(10);
    expect(d.armorBoughtByLevel).toEqual({ 2: 10 }); // すべて流通レベル 2 の品
    expect(d.unsold).toBe(0); // 外した品は売った
    expect(c.state.gold).toBeGreaterThanOrEqual(c.reviveCost());
    expectStateInvariants(c.state);
  }, 60_000);

  test("H9/M9 進行ボットの煙テスト: d01 を踏破済み（clearedDungeons・unlockedDungeons に d02）の state からは d02 の 1 階に 1 潜行する", () => {
    const c = new Campaign(1, PROGRESS_BOT);
    c.state.progress.clearedDungeons.push("d01");
    c.state.progress.unlockedDungeons.push("d02");
    const r = c.campaign(1);
    expect(r.dives).toHaveLength(1);
    expect(r.dives[0]!.dungeonId).toBe("d02");
    expect(r.dives[0]!.deepestFloor).toBe(1);
    expect(c.state.screen).toBe("town");
    expectStateInvariants(c.state);
  }, 60_000);

  test("H9/M12 進行ボット: d01・d02 を踏破済みの state からは d03 に潜り、d03 に D03_DIVES 回潜ったら（上限が残っていても）終える", () => {
    const c = new Campaign(1, PROGRESS_BOT);
    c.state.progress.clearedDungeons.push("d01", "d02");
    c.state.progress.unlockedDungeons.push("d02", "d03");
    c.run({ type: "debug.levels", level: 9 }); // d03 の 1 階で全滅し続けないように（降りる L8・ボス L9 も満たす）
    c.state.gold = 20000;
    const r = c.campaign(10);
    expect(r.aborted).toBe(false);
    expect(r.dives.map((d) => d.dungeonId)).toEqual(Array.from({ length: D03_DIVES }, () => "d03"));
    expect(r.dives[0]!.startMinLevel).toBe(9);
    expect(Math.max(...r.dives.map((d) => d.deepestFloor))).toBeGreaterThanOrEqual(2); // 条件を満たすので下り階段へ向かう
    expect(c.state.screen).toBe("town");
    expectStateInvariants(c.state);
  }, 60_000);

  test("H9/M12 進行ボット: 降りる・ボスに挑む条件の level はダンジョンごと（DESCEND_LEVELS / BOSS_LEVELS。BotKind の上書きは書いたダンジョンだけ）", () => {
    expect(DESCEND_LEVELS).toEqual({ d01: 3, d02: 6, d03: 8 });
    expect(BOSS_LEVELS).toEqual({ d01: 4, d02: 7, d03: 9 });
    const l1 = { ...PROGRESS_BOT, descendLevel: { d01: 1 } };
    expect(levelFor(l1, "descend", "d01")).toBe(1);
    expect(levelFor(l1, "descend", "d03")).toBe(8);
    expect(levelFor(l1, "boss", "d01")).toBe(4);
    expect(() => levelFor(PROGRESS_BOT, "descend", "d99")).toThrow();
    const c = new Campaign(1, PROGRESS_BOT);
    c.dungeonId = "d03";
    c.state.party.forEach((x) => (x.level = 7));
    expect(c.descendReady()).toBe(false);
    expect(c.levelsOk("descend")).toBe(false);
    c.state.party.forEach((x) => (x.level = 8));
    expect(c.descendReady()).toBe(true);
    expect(c.bossReady()).toBe(false); // ボスは L9
    c.dungeonId = "d01";
    expect(c.bossReady()).toBe(true); // d01 のボスは L4（HP は満タン）
  });
  test("H9/M11 CB-67 ボットは警報の箱を開けると警報の戦闘を戦い、勝って同じ箱に戻ったらもう一度開けて中身を得る（resolveChest → fight → resolveChest のループ）", () => {
    const c = new Campaign(1, PROGRESS_BOT);
    c.state = execute(c.state, { type: "dungeon.enter", dungeonId: "d01" }, data).state;
    c.state = execute(c.state, { type: "debug.chest", trapId: "alarm" }, data).state;
    expect(c.state.dive!.chest).not.toBeNull();
    // M11 作業 9: ボットは盗賊がいれば先に調べ・解除するので、盗賊を麻痺させて「開ける」だけの経路にする（作業 5 の最小版のボットは常に開けていた）
    for (const ch of c.state.party) if (ch.classId === "thief") ch.status.push("paralysis");
    c.resolveChest();
    expect(c.battles).toBe(1);
    expect(c.state.battle).toBeNull();
    expect(c.state.screen).toBe("dungeon");
    expect(c.state.dive!.chest).toBeNull();
    expect(c.chests).toBe(1); // 2 回目の開けるで中身（chest.open.gold）を得た
    expectStateInvariants(c.state);
  }, 60_000);

  // ---- M11 作業 9: ボットの本番の方針（設計書 §8）と集計 ----

  /** 送ったコマンドと、その直前に告げられていた結果（chestView の finding）を記録するボット */
  class Spy extends Campaign {
    log: { cmd: Command; finding: { trapId: string | null } | null }[] = [];
    override run(cmd: Command): GameState {
      if (cmd.type.startsWith("chest.")) this.log.push({ cmd, finding: this.state.dive?.chest?.finding ?? null });
      return super.run(cmd);
    }
  }
  const THIEVES = (s: GameState) => s.party.filter((c) => c.classId === "thief").map((c) => c.id);
  /** d01 に入り、debug.chest で trapId の箱を置いた Spy（setFloor 済み） */
  function spyAtChest(seed: number, trapId: string | null): Spy {
    const c = new Spy(seed, PROGRESS_BOT);
    c.state = execute(c.state, { type: "dungeon.enter", dungeonId: "d01" }, data).state;
    c.setFloor();
    c.state = execute(c.state, { type: "debug.chest", trapId }, data).state;
    expect(c.state.dive!.chest).not.toBeNull();
    return c;
  }
  const paralyzeThieves = (c: Campaign) => {
    for (const ch of c.state.party) if (ch.classId === "thief") ch.status.push("paralysis");
  };

  test("H9/M11 CB-63/CB-64 ボットの方針: 行動可能な盗賊がいれば調べる力の最大の盗賊で調べ、告げられた名前を同じ盗賊で解除してから開ける（finding だけを見る）", () => {
    let disarmed = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const c = spyAtChest(seed, "crossbow");
      const s0 = c.state;
      const thieves = s0.party.filter((x) => x.classId === "thief");
      const power = (id: string) => chestRate(s0, data, "inspect", s0.party.find((x) => x.id === id)!, 0).power;
      const top = Math.max(...thieves.map((x) => power(x.id)));
      c.resolveChest();
      expect(c.state.dive!.chest).toBeNull();
      expect(c.chestMemo).toBeNull();
      const first = c.log[0]!.cmd;
      expect(first.type).toBe("chest.inspect");
      const inspector = (first as Extract<Command, { type: "chest.inspect" }>).memberId;
      expect(THIEVES(s0)).toContain(inspector);
      expect(power(inspector)).toBe(top);
      for (const { cmd, finding } of c.log.slice(1)) {
        expect(cmd.type).not.toBe("chest.inspect"); // 調べるのは 1 回だけ
        if (cmd.type === "chest.disarm") {
          expect(cmd.trapId).toBe(finding!.trapId); // 告げられた名前（偽りもありうる）をそのまま解除する
          expect(cmd.memberId).toBe(inspector);
          disarmed += 1;
        }
      }
      expect(c.log.length).toBeLessThanOrEqual(2 + DISARM_TRIES);
      expectStateInvariants(c.state);
    }
    expect(disarmed).toBeGreaterThan(0); // 解除の経路を通った
  }, 60_000);

  test("H9/M11 EV-75 ボットの方針: 職業の掛け合いの担当がいれば、調べる力が低くても担当が調べる", () => {
    const c = spyAtChest(3, null);
    const s0 = c.state;
    const [a, b] = s0.party.filter((x) => x.classId === "thief");
    const pw = (x: typeof a) => chestRate(s0, data, "inspect", x!, 0).power;
    const low = pw(a) <= pw(b) ? a! : b!;
    c.state.dive!.chest!.rivalry = { id: "thief_chest", ownerId: low.id };
    c.resolveChest();
    expect(c.log[0]!.cmd).toEqual({ type: "chest.inspect", memberId: low.id });
  });

  test("H9/M11 CB-65 ボットの方針: 行動可能な盗賊がいなければ調べずに開ける", () => {
    const c = spyAtChest(1, "crossbow");
    paralyzeThieves(c);
    c.resolveChest();
    expect(c.log.map((x) => x.cmd.type)).toEqual(["chest.open"]);
    expect(c.chestFlow.traps).toEqual({ crossbow: 1 });
    expect(c.chestFlow.trapsBy).toEqual({ open: 1 });
    expect(c.chestFlow.ends.opened).toBe(1);
  });

  test("H9/M11 CB-62 集計: 宝箱の罠で死んだ者の死因は chestTrap:<罠の id>", () => {
    const c = spyAtChest(1, "bomb");
    paralyzeThieves(c);
    c.state.party[0]!.hp = 1; // 爆弾（全員 1d6）で必ず死ぬ
    c.resolveChest();
    expect(c.deaths.some((d) => d.cause === "chestTrap:bomb" && !d.monster)).toBe(true);
    expect(c.chestFlow.traps["bomb"]).toBe(1);
  });

  test("H9/M11 DG-25 ボットは転移の罠で上り階段の近傍の外に移ったら、上り階段への最短で近傍に戻ってから歩き回る", () => {
    let c: Spy | null = null;
    for (let seed = 1; seed <= 30 && c === null; seed++) {
      const x = spyAtChest(seed, "teleport");
      paralyzeThieves(x);
      x.resolveChest();
      expect(x.chestFlow.ends.lost).toBe(1);
      expect(x.chestFlow.traps).toEqual({ teleport: 1 });
      if (!x.near.has(`${x.state.dive!.pos.x},${x.state.dive!.pos.y}`)) c = x;
    }
    expect(c).not.toBeNull();
    const k = () => `${c!.state.dive!.pos.x},${c!.state.dive!.pos.y}`;
    for (let n = 0; n < 200 && c!.inDungeon && !c!.near.has(k()); n++) c!.wanderStep();
    expect(c!.inDungeon).toBe(true);
    expect(c!.near.has(k())).toBe(true);
    c!.wanderStep(); // 近傍に戻った後は今までどおり歩ける
    expectStateInvariants(c!.state);
  }, 60_000);

  test("H9/M11 TW-07 ボットは寺院で麻痺の者も治す（宝箱の麻痺ガス）", () => {
    const c = new Campaign(1, PROGRESS_BOT);
    c.state.gold = 5000;
    c.state.party[1]!.status.push("paralysis");
    const rec = { cureCount: 0, cureCost: 0, cureUnpaid: 0 } as unknown as Parameters<Campaign["cureAtTemple"]>[0];
    c.cureAtTemple(rec);
    expect(c.state.party[1]!.status).not.toContain("paralysis");
    expect(rec.cureCount).toBe(1);
  });

  test("H9/M11 集計: 宝箱の経路別の数（ドロップ + セル = 衝動判定をした箱）と、report / progressReport の M11-宝箱の行", () => {
    const { results } = runCampaigns(BOTS[1]!, 3, 2);
    const ds = results.flatMap((r) => r.dives);
    for (const d of ds) {
      expect(d.chestFlow.found.drop + d.chestFlow.found.cell).toBe(d.chestImpulse.found);
      expect(d.chestFlow.cellContents).toBeLessThanOrEqual(d.chests);
      expect(d.chestFlow.disarmOk + d.chestFlow.disarmWrong).toBeLessThanOrEqual(d.chestFlow.disarms);
    }
    expect(sum(ds.map((d) => d.chestFlow.inspects))).toBeGreaterThan(0);
    expect(report(BOTS[1]!, results, 3, 2)).toContain("M11-宝箱【全潜行】");
    expect(progressReport(results)).toContain("M11-宝箱【d01 の潜行（踏破まで）】");
  }, 60_000);

  test("M13 農夫ボットの煙テスト: 農夫 Lv5 d01 1F を 2 シード × 1 潜行。開始時の最小 level 5、帰った理由（farmEnd）か method が決まり、推定の実時間 > 0、拾った品の合計 = 宝箱の品、不変条件が崩れない", () => {
    const kind = farmBot(5, "d01", 1);
    const { results, keys } = runCampaigns(kind, 2, 1);
    expect(results).toHaveLength(2);
    for (const d of results.flatMap((r) => r.dives)) {
      expect(d.startMinLevel).toBe(5);
      expect(d.dungeonId).toBe("d01");
      expect(d.farmEnd !== null || d.method === "wipe" || d.method === "cap").toBe(true);
      expect(d.estDungeonMs).toBeGreaterThan(0);
      expect(d.estTownMs).toBeGreaterThan(0); // 少なくとも宿
      expect(d.beats.steps).toBe(d.steps);
      expect(sum(Object.values(d.found))).toBe(d.chestItems); // 農夫はボスと戦わないので、拾った品はすべて宝箱の品
      expect(d.netProfit).toBe(d.goldAfterSell - d.goldBefore);
    }
    expect(keys.has("battle.encounter")).toBe(true);
    expect(farmReport(results, kind)).toContain("## 農夫 Lv5 d01 1F（2 シード × 1 潜行）");
  }, 60_000);

  test("M13 農夫ボットの煙テスト: 農夫 Lv8 d02 1F は d01 を踏破済みの state（clearedDungeons・unlockedDungeons・shopLevel 2）にして d02 の 1 階だけを 1 潜行する", () => {
    const c = new Campaign(1, farmBot(8, "d02", 1));
    c.prepareFarm();
    expect(c.state.progress.clearedDungeons).toEqual(["d01"]);
    expect(c.state.progress.unlockedDungeons).toContain("d02");
    expect(c.state.progress.shopLevel).toBe(2);
    expect(c.state.party.every((x) => x.level === 8)).toBe(true);
    const r = c.campaign(1);
    expect(r.aborted).toBe(false);
    expect(r.dives).toHaveLength(1);
    expect(r.dives[0]!.dungeonId).toBe("d02");
    expect(r.dives[0]!.deepestFloor).toBe(1);
    expect(c.state.screen).toBe("town");
    expectStateInvariants(c.state);
  }, 60_000);
});
