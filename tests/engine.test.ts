import { describe, expect, test } from "vitest";
import { createInitialState, execute } from "../src/core/engine";
import { createRng } from "../src/core/rng";
import {
  baseOf,
  classOf,
  cloneState,
  createItemInstance,
  destroyItemInstance,
  dropTableOf,
  dungeonOf,
  itemDisplayName,
  makeContext,
  memberById,
  monsterOf,
  optionOf,
  slotsUsed as slotsUsedOf,
  uniqueOf,
} from "../src/core/state";
import { floorOf, visibleCellsOf, warpTarget } from "../src/core/rules/dungeon";
import { cellAt, idx, isPassable, step } from "../src/core/rules/dungeon-gen";
import { gainSan, loseSan, sanJustBelow, sanStage } from "../src/core/rules/san";
import type { Cell, Character, Command, Floor, GameEvent, GameState } from "../src/core/types";
import {
  data,
  deepFreeze,
  defaultMembers,
  expectKnownStringKeys,
  expectStateInvariants,
  gameNewEvents,
  loadFreshData,
  newGame,
  stringKeysOf,
  withChar,
} from "./helpers/core";
import { dataWith, dived, withBattle } from "./helpers/battle";
import { approaches, findSituation, placeAt } from "./helpers/dungeon";
import { cursedDagger } from "./helpers/items";
import { DEBUG_LEVEL_MAX, DEBUG_LEVELS } from "../src/core/rules/debug";
import { expFor, levelUpOnce } from "../src/core/rules/growth";

const gameNew = (members = defaultMembers()): Command => ({ type: "game.new", party: { members } });

/** "random" を含む setup（リーダー以外すべて random）。 */
function randomMembers() {
  return defaultMembers().map((m, i) => (i === 0 ? m : { ...m, personality: "random" as const }));
}

describe("engine: execute", () => {
  test("§3-2 execute は引数の state を書き換えない（deepFreeze しても例外なし、前後の JSON が一致）", () => {
    const frozenData = deepFreeze(loadFreshData());
    // 受け付けた場合（random を含むので rng も進む経路）
    const s0 = deepFreeze(createInitialState(1, frozenData));
    const before = JSON.stringify(s0);
    const r = execute(s0, gameNew(randomMembers()), frozenData);
    expect(r.events).toEqual(gameNewEvents(frozenData)); // TW-36（M12.5）: screen{town} の後に開始の語り
    expect(JSON.stringify(s0)).toBe(before);
    expect(r.state).not.toBe(s0);
    // rejected の場合
    const s1 = deepFreeze(r.state);
    const before1 = JSON.stringify(s1);
    const r1 = execute(s1, gameNew(), frozenData);
    expect(r1.events[0]?.kind).toBe("rejected");
    expect(JSON.stringify(s1)).toBe(before1);
  });

  test("§3-2 同じ state と command から同じ結果（random を含む setup、seed 1）", () => {
    const s0 = createInitialState(1, data);
    const a = execute(s0, gameNew(randomMembers()), data);
    const b = execute(s0, gameNew(randomMembers()), data);
    expect(a.state).toEqual(b.state);
    expect(a.events).toEqual(b.events);
  });

  test("§3-2 返る state は入力と参照を共有しない", () => {
    const s0 = createInitialState(1, data);
    const r = execute(s0, gameNew(), data);
    const protoStr = data.config.prototypeParty.members[0]!.stats.str;
    const ch = r.state.party[0]!;
    ch.stats.str = 99;
    ch.knownSpells.push("x");
    r.state.rng.s[0] = 12345;
    expect(data.config.prototypeParty.members[0]!.stats.str).toBe(protoStr);
    expect(data.config.prototypeParty.members[0]!.knownSpells).toEqual([]);
    expect(s0.rng).toEqual(createRng(1));
    expect(s0.party).toEqual([]);
  });

  test("§3-11 返る state は JSON 往復で toEqual のまま", () => {
    const s = newGame(1, randomMembers());
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    const s0 = createInitialState(1, data);
    expect(JSON.parse(JSON.stringify(s0))).toEqual(s0);
  });

  test("D3 createInitialState: screen title、party []、rng は createRng(seed) と同じ、gold 0、bank 0、nextItemSeq 1、dive と pendingChoice と battle は null、bestiary は {}、townVisit は null、adventureTurns・tavernEventMark は 0（TW-12）、morale は null（TW-15）、IT-10 warehouse / buyback は []・uniqueBook は {}・progress.shopLevel は 0（M7）、TW-35 tally は全部 0・progress の enteredDungeons []・conquered / endingPending false（M12）、UI-76 progress.hints []（M16）", () => {
    const s = createInitialState(42, data);
    expect(s).toEqual({
      screen: "title",
      rng: createRng(42),
      party: [],
      items: {},
      nextItemSeq: 1,
      gold: 0,
      bank: 0,
      progress: { unlockedDungeons: [], clearedDungeons: [], shopLevel: 0, enteredDungeons: [], conquered: false, endingPending: false, hints: [] }, // IT-62（M7）、DG-37 / DG-36 / TW-34（M12）、UI-76（M16）
      dive: null,
      pendingChoice: null,
      battle: null,
      bestiary: {},
      townVisit: null,
      adventureTurns: 0,
      tavernEventMark: 0,
      morale: null,
      warehouse: [], // TW-16 / IT-64（M7）
      buyback: [], // IT-63（M7）
      uniqueBook: {}, // IT-66（M7）
      tally: { dives: 0, battles: 0, deaths: 0, ashes: 0, wipes: 0 }, // TW-35（M12）
    });
    expect(() => createInitialState(1.5, data)).toThrow(RangeError);
  });

  test("DG-03/E3 game.new の後も dive と pendingChoice は null で、JSON 往復で変わらない", () => {
    const s = execute(createInitialState(1, data), gameNew(), data).state;
    expect(s.dive).toBeNull();
    expect(s.pendingChoice).toBeNull();
    expect(cloneState(s)).toEqual(s);
  });

  test("TW-12 createInitialState と game.new で adventureTurns 0・tavernEventMark 0。全滅・帰還（徒歩の出口）で変わらない", () => {
    const init = createInitialState(1, data);
    expect([init.adventureTurns, init.tavernEventMark]).toEqual([0, 0]);
    const s = execute(init, gameNew(), data).state;
    expect([s.adventureTurns, s.tavernEventMark]).toEqual([0, 0]);
    // 帰還: 1 階の上り階段の確認で exit
    const d = cloneState(dived(1));
    d.adventureTurns = 37;
    d.tavernEventMark = 12;
    d.pendingChoice = { kind: "stairs", promptKey: "dungeon.stairsUp", options: [{ id: "exit", labelKey: "dungeon.choice.exit" }] };
    const back = execute(d, { type: "event.choose", optionId: "exit" }, data).state;
    expect(back.screen).toBe("town");
    expect([back.adventureTurns, back.tavernEventMark]).toEqual([37, 12]);
    // 全滅: 迷宮で行動可能な者がいなくなった旋回の後処理（TW-20）
    const w = cloneState(d);
    w.pendingChoice = null;
    for (const c of w.party) {
      c.life = "dead";
      c.hp = 0;
    }
    const wiped = execute(w, { type: "dungeon.turn", dir: "left" }, data);
    expect(wiped.events.some((e) => e.kind === "wipe")).toBe(true);
    expect(wiped.state.screen).toBe("town");
    expect([wiped.state.adventureTurns, wiped.state.tavernEventMark]).toEqual([37, 12]);
  });

  test("DG-01 dungeonOf は id で dungeons.json の定義を返し、未知の id は Error", () => {
    expect(dungeonOf(data, "d01")).toBe(data.dungeons[0]);
    expect(dungeonOf(data, "d02").floors).toBe(3);
    expect(() => dungeonOf(data, "d99")).toThrow("unknown dungeon id: d99");
  });

  test("CB-03 monsterOf は id で monsters.json の定義を返し、未知の id は Error", () => {
    expect(monsterOf(data, data.monsters[0]!.id)).toBe(data.monsters[0]);
    expect(() => monsterOf(data, "m99")).toThrow("unknown monster id: m99");
  });

  test("IT-02/IT-03/IT-33/IT-51 baseOf・uniqueOf・optionOf・dropTableOf は id で定義を返し、未知の id は Error（M7）", () => {
    expect(baseOf(data, "mace")).toBe(data.equipmentBases[2]);
    expect(uniqueOf(data, "twin_tongue_dagger").base).toBe("dagger");
    expect(optionOf(data, "hp_max").values).toEqual([3, 6, 10]);
    expect(dropTableOf(data, "d02_boss").rolls).toBe(2);
    expect(() => baseOf(data, "herb")).toThrow("unknown equipment base id: herb");
    expect(() => uniqueOf(data, "dagger")).toThrow("unknown unique id: dagger");
    expect(() => optionOf(data, "x")).toThrow("unknown item option id: x");
    expect(() => dropTableOf(data, "x")).toThrow("unknown drop table id: x");
  });

  test("DG-41 destroyItemInstance は潜行中なら dive.ledger.items からも外す（他の台帳の品と持ち込みの品は残る）", () => {
    const entered = execute(execute(createInitialState(1, data), gameNew(), data).state, { type: "dungeon.enter", dungeonId: "d01" }, data);
    expectKnownStringKeys(entered.events);
    const s = cloneState(entered.state);
    const ch = memberById(s, "c1")!;
    const carried = ch.inventory[0]!; // 持ち込みの herb（台帳には無い）
    const gotA = createItemInstance(s, { itemId: "herb", identified: true });
    const gotB = createItemInstance(s, { itemId: "herb", identified: true });
    ch.inventory.push(gotA, gotB);
    s.dive!.ledger.items.push(gotA, gotB);

    destroyItemInstance(s, ch, gotA);
    expect(ch.inventory).toEqual([carried, gotB]);
    expect(s.items[gotA]).toBeUndefined();
    expect(s.dive!.ledger.items).toEqual([gotB]);

    destroyItemInstance(s, ch, carried);
    expect(ch.inventory).toEqual([gotB]);
    expect(s.dive!.ledger.items).toEqual([gotB]);
  });

  test("IT-10 createItemInstance(state, spec): 既定は Lv0・通常・オプションなし・ユニークでない・呪いなし・foundIn null。指定した欄はそのまま入り、options は複製する（M7）", () => {
    const s = cloneState(execute(createInitialState(1, data), gameNew(), data).state);
    const seq = s.nextItemSeq;
    const a = createItemInstance(s, { itemId: "herb", identified: false });
    expect(a).toBe(`i${seq}`);
    expect(s.items[a]).toEqual({
      id: a,
      itemId: "herb",
      level: 0,
      rarity: "normal",
      options: [],
      uniqueId: null,
      identified: false,
      cursed: false,
      foundIn: null,
    });
    const options = [{ optionId: "hit", tier: 2 as const, value: 10 }];
    const b = createItemInstance(s, {
      itemId: "dagger",
      identified: true,
      level: 5,
      rarity: "fine",
      options,
      uniqueId: "twin_tongue_dagger",
      cursed: true,
      foundIn: "d01",
    });
    expect(b).toBe(`i${seq + 1}`);
    expect(s.nextItemSeq).toBe(seq + 2);
    expect(s.items[b]).toEqual({
      id: b,
      itemId: "dagger",
      level: 5,
      rarity: "fine",
      options: [{ optionId: "hit", tier: 2, value: 10 }],
      uniqueId: "twin_tongue_dagger",
      identified: true,
      cursed: true,
      foundIn: "d01",
    });
    expect(s.items[b]!.options).not.toBe(options);
    expect(s.items[b]!.options[0]).not.toBe(options[0]);
    expect(JSON.parse(JSON.stringify(s))).toStrictEqual(s); // §3-11
  });

  test("IT-10/IT-63 expectStateInvariants（M7）: 倉庫・買い戻しの実体も参照に数える。どこからも参照されない実体・二重参照・ユニークでない買い戻しは落ちる", () => {
    const s = cloneState(execute(createInitialState(1, data), gameNew(), data).state);
    const w = createItemInstance(s, { itemId: "dagger", identified: true });
    s.warehouse.push(w);
    const u = createItemInstance(s, { itemId: "dagger", identified: true, uniqueId: "twin_tongue_dagger" });
    s.buyback.push(u);
    expectStateInvariants(s);
    const orphan = cloneState(s);
    createItemInstance(orphan, { itemId: "herb", identified: true });
    expect(() => expectStateInvariants(orphan)).toThrow();
    const twice = cloneState(s);
    twice.buyback.push(w);
    expect(() => expectStateInvariants(twice)).toThrow();
    const notUnique = cloneState(s);
    notUnique.items[u]!.uniqueId = null;
    expect(() => expectStateInvariants(notUnique)).toThrow();
    const unidentified = cloneState(s);
    unidentified.items[u]!.identified = false;
    expect(() => expectStateInvariants(unidentified)).toThrow();
  });

  test("CH-72 itemDisplayName: 鑑定済みは name、未鑑定は unidentifiedName、unidentifiedName が無ければ name。実体が無ければ Error", () => {
    const s = cloneState(execute(createInitialState(1, data), gameNew(), data).state);
    const knownDagger = cursedDagger(s, true);
    const unknownDagger = cursedDagger(s, false);
    const unknownHerb = createItemInstance(s, { itemId: "herb", identified: false }); // herb は unidentifiedName を持たない
    expect(itemDisplayName(s, data, knownDagger)).toBe("短剣");
    expect(itemDisplayName(s, data, unknownDagger)).toBe("短い刃？");
    expect(itemDisplayName(s, data, unknownHerb)).toBe("薬草");
    expect(() => itemDisplayName(s, data, "i999")).toThrow("unknown item instance: i999");
  });

  test("DG-41 destroyItemInstance は潜行していなければ台帳に触れない（dive null のまま）", () => {
    const s = cloneState(execute(createInitialState(1, data), gameNew(), data).state);
    const ch = memberById(s, "c1")!;
    const carried = ch.inventory[0]!;
    destroyItemInstance(s, ch, carried);
    expect(ch.inventory).toEqual([]);
    expect(s.items[carried]).toBeUndefined();
    expect(s.dive).toBeNull();
  });

  test("D3/TW-36 game.new で screen は town、events は [{kind:\"screen\",to:\"town\"}] と、その後の開始の語り（opening.speech.N）だけ（town.enter は出さない）", () => {
    const r = execute(createInitialState(1, data), gameNew(), data);
    expect(r.state.screen).toBe("town");
    expect(r.events).toEqual(gameNewEvents());
    expect(r.events.length).toBeGreaterThan(1);
  });

  test("TW-30 game.new は townVisit を {mercyOffered:false} にし（town.enter と救済の判定はしない）、dungeon.enter で null に戻す", () => {
    const s = execute(createInitialState(1, data), gameNew(), data).state;
    expect(s.townVisit).toEqual({ mercyOffered: false });
    const d = execute(s, { type: "dungeon.enter", dungeonId: "d01" }, data).state;
    expect(d.screen).toBe("dungeon");
    expect(d.townVisit).toBeNull();
  });

  test("UI-40/§3-10 game.new が出す message の key と dice の各 TextRef の key はすべて data.strings に実在する", () => {
    const r = execute(createInitialState(1, data), gameNew(randomMembers()), data);
    expectKnownStringKeys(r.events);
    // 検査関数自体が未知のキーを検出できること（dice は label → rows[].label → rule → result の順に集める）
    const dice: GameEvent = {
      kind: "dice",
      label: { key: "dice.learn", params: { spell: "x" } },
      rows: [{ label: { key: "dice.row.roll" }, base: null, dice: [1], total: 1 }],
      rule: { key: "dice.rule.rate", params: { rate: 5 } },
      result: { key: "dice.learn.ok" },
    };
    expect(stringKeysOf([{ kind: "message", key: "no.such.key" }, dice])).toEqual([
      "no.such.key",
      "dice.learn",
      "dice.row.roll",
      "dice.rule.rate",
      "dice.learn.ok",
    ]);
    expect(() => expectKnownStringKeys([{ kind: "message", key: "no.such.key" }])).toThrow();
    expect(() => expectKnownStringKeys([{ ...dice, result: { key: "dice.no.such" } }])).toThrow();
    expectKnownStringKeys([dice]);
  });

  test("D2 party がある state での game.new は、同じ参照（toBe）と [{kind:\"rejected\",command:\"game.new\",reason:\"game already started\"}]", () => {
    // screen を title に戻しても、party があれば受け付けない
    const s: GameState = { ...newGame(1), screen: "title" };
    const r = execute(s, gameNew(), data);
    expect(r.state).toBe(s);
    expect(r.events).toEqual([{ kind: "rejected", command: "game.new", reason: "game already started" }]);
  });

  test("D2 town の state での game.new は wrong screen", () => {
    const s = newGame(1);
    const r = execute(s, gameNew(), data);
    expect(r.state).toBe(s);
    expect(r.events).toEqual([{ kind: "rejected", command: "game.new", reason: "wrong screen" }]);
  });

  test("TW-02/TW-26 town.enter は街でも迷宮でも internal command（同じ参照）。街に入る処理は帰還と全滅だけが内部で行う", () => {
    const town = newGame(1);
    const dungeon = execute(town, { type: "dungeon.enter", dungeonId: "d01" }, data).state;
    for (const s of [createInitialState(1, data), town, dungeon]) {
      const r = execute(s, { type: "town.enter" }, data);
      expect(r.state).toBe(s);
      expect(r.events).toEqual([{ kind: "rejected", command: "town.enter", reason: "internal command" }]);
    }
  });

  test.each<Command>([
    { type: "town.bank", amount: 10 },
  ])("D2 未実装のコマンドは not implemented: $type（dungeon.cast と party.reorder は M4.5、town.shop の sell は M7 の B7 で実装した）", (cmd) => {
    const s = newGame(1);
    const r = execute(s, cmd, data);
    expect(r.state).toBe(s);
    expect(r.events).toEqual([{ kind: "rejected", command: cmd.type, reason: "not implemented" }]);
  });

  test.each<Command>([
    { type: "battle.input", memberId: "c1", action: { type: "defend" } },
    { type: "battle.resolve" },
    { type: "battle.auto", on: true },
    { type: "battle.flee" },
    { type: "battle.repeat" },
  ])("D2/F1 戦闘外（title・town・dungeon、screen が battle でも battle が null）の $type は not in battle で、同じ参照を返し乱数を消費しない", (cmd) => {
    const town = newGame(1);
    const dungeon = execute(town, { type: "dungeon.enter", dungeonId: "d01" }, data).state;
    const broken: GameState = { ...cloneState(dungeon), screen: "battle" };
    for (const s of [createInitialState(1, data), town, dungeon, broken]) {
      const r = execute(s, cmd, data);
      expect(r.state).toBe(s);
      expect(r.events).toEqual([{ kind: "rejected", command: cmd.type, reason: "not in battle" }]);
    }
  });

  test("F2 battle.auto の on が真偽値でなければ bad on、今と同じ値なら no change（同じ参照）", () => {
    const dungeon = execute(newGame(1), { type: "dungeon.enter", dungeonId: "d01" }, data).state;
    const s = cloneState(dungeon);
    s.screen = "battle";
    s.battle = { origin: { kind: "random", inRoom: false }, round: 0, partySurprise: false, groups: [{ monsterId: "giant_rat", units: [{ hp: 3, hpMax: 3, status: [] }] }], inputs: {}, auto: false, acBonus: {} };
    for (const [on, reason] of [["true", "bad on"], [1, "bad on"], [undefined, "bad on"], [false, "no change"]] as const) {
      const r = execute(s, { type: "battle.auto", on } as unknown as Command, data);
      expect(r.state).toBe(s);
      expect(r.events).toEqual([{ kind: "rejected", command: "battle.auto", reason }]);
    }
    const ok = execute(s, { type: "battle.auto", on: true }, data);
    expectKnownStringKeys(ok.events);
    expect(ok.events).toEqual([]);
    expect(ok.state.battle!.auto).toBe(true);
    expect(s.battle.auto).toBe(false);
  });

  test("D2 未知の type は unknown command。null や type の無い command は command \"unknown\"、malformed command で、例外を投げない", () => {
    const s = createInitialState(1, data);
    const cases: [unknown, string, string][] = [
      [{ type: "no.such" }, "no.such", "unknown command"],
      [null, "unknown", "malformed command"],
      [undefined, "unknown", "malformed command"],
      [42, "unknown", "malformed command"],
      ["game.new", "unknown", "malformed command"],
      [{}, "unknown", "malformed command"],
      [{ type: 1 }, "unknown", "malformed command"],
    ];
    for (const [cmd, command, reason] of cases) {
      const r = execute(s, cmd as Command, data);
      expect(r.state).toBe(s);
      expect(r.events).toEqual([{ kind: "rejected", command, reason }]);
    }
    // party が無い / 壊れた game.new も例外ではなく rejected
    const r2 = execute(s, { type: "game.new" } as unknown as Command, data);
    expect(r2.events).toEqual([{ kind: "rejected", command: "game.new", reason: "invalid party setup" }]);
  });

  test("D2 rejected では rng を消費しない", () => {
    const s = createInitialState(1, data);
    // 6 人目が不正な名前なので rejected。random のメンバーがいても乱数は引かない
    const members = randomMembers();
    members[5] = { name: "", personality: "random" };
    const r = execute(s, gameNew(members), data);
    expect(r.events).toEqual([{ kind: "rejected", command: "game.new", reason: "invalid name at 5" }]);
    expect(r.state).toBe(s);
    expect(r.state.rng).toEqual(createRng(1));
  });
});

describe("UI-57 debug.hpOne（開発用）", () => {
  const HP_ONE: Command = { type: "debug.hpOne" };

  /** 期待する hpChanged（並び順に、alive で hp が 1 でない者だけ）と最後の message */
  function expected(s: GameState): GameEvent[] {
    const out: GameEvent[] = [];
    for (const ch of s.party) if (ch.life === "alive" && ch.hp !== 1) out.push({ kind: "hpChanged", id: ch.id, delta: 1 - ch.hp, hp: 1 });
    out.push({ kind: "message", key: "debug.hpOne" });
    return out;
  }

  test("UI-57 街・迷宮・戦闘中・保留中で受け付け、alive の全員の hp を 1 にする（hpChanged は変わった者だけ、最後に message）。dead / ash は変えない。乱数は動かさない", () => {
    const town = newGame(1);
    const dungeon = dived(1);
    const battle = withBattle(dived(1), [{ monsterId: "giant_rat", hps: [3] }]);
    const pending: GameState = {
      ...dived(1),
      pendingChoice: { kind: "stairs", promptKey: "dungeon.stairsDown", options: [{ id: "stay", labelKey: "dungeon.choice.stay" }] },
    };
    // 2 人目は hp 1 のまま（hpChanged を出さない）、3 人目は死亡、4 人目は灰
    let mixed = withChar(dived(1), 1, { hp: 1 });
    mixed = withChar(mixed, 2, { life: "dead", hp: 0 });
    mixed = withChar(mixed, 3, { life: "ash", hp: 0 });
    for (const s of [town, dungeon, battle, pending, mixed]) {
      const before = JSON.stringify(s);
      const r = execute(s, HP_ONE, data);
      expect(JSON.stringify(s)).toBe(before);
      expect(r.events).toEqual(expected(s));
      expectKnownStringKeys(r.events);
      for (const [i, ch] of r.state.party.entries()) {
        const was = s.party[i]!;
        expect(ch.hp, ch.id).toBe(was.life === "alive" ? 1 : was.hp);
        expect(ch.life, ch.id).toBe(was.life);
      }
      expect(r.state.rng).toEqual(s.rng);
      // 画面・戦闘・保留はそのまま（hp 1 で行動不能になる者はいないので全滅処理も起きない）
      expect(r.state.screen).toBe(s.screen);
      expect(r.state.battle).toEqual(s.battle);
      expect(r.state.pendingChoice).toEqual(s.pendingChoice);
      expect(r.state.dive).toEqual(s.dive);
    }
    // 手計算: プロトタイプの 6 人の初期 hpMax は 15/16/10/12/8/10（CH-65）。mixed では c1・c5・c6 だけが変わる
    expect(execute(mixed, HP_ONE, data).events).toEqual([
      { kind: "hpChanged", id: "c1", delta: -14, hp: 1 },
      { kind: "hpChanged", id: "c5", delta: -7, hp: 1 },
      { kind: "hpChanged", id: "c6", delta: -9, hp: 1 },
      { kind: "message", key: "debug.hpOne" },
    ]);
    // もう一度送っても message だけ（変化が無くても出す）
    const again = execute(execute(town, HP_ONE, data).state, HP_ONE, data);
    expect(again.events).toEqual([{ kind: "message", key: "debug.hpOne" }]);
  });

  test("UI-57/D2 title（party が空）では rejected no party（同じ参照）", () => {
    const s = createInitialState(1, data);
    const r = execute(s, HP_ONE, data);
    expect(r.state).toBe(s);
    expect(r.events).toEqual([{ kind: "rejected", command: "debug.hpOne", reason: "no party" }]);
  });

  test("UI-57/TW-20 全員 HP1 の後、戦闘で全員が倒れると戦闘の中の全滅処理になる（全滅の流れを実機で確かめる経路）", () => {
    const d = dataWith({ combat: { hitMin: 100, hitMax: 100 } });
    const s0 = withBattle(dived(1), [{ monsterId: "kobold", hps: [999] }, { monsterId: "kobold", hps: [999] }, { monsterId: "kobold", hps: [999] }]);
    let s = execute(s0, HP_ONE, d).state;
    expect(s.party.every((c) => c.hp === 1)).toBe(true);
    let wiped = false;
    // 「前回と同じ」（オート入力の規則で 1 ラウンド解決）を戦闘が終わるまで送る
    for (let i = 0; i < 30 && s.battle !== null; i++) {
      const r = execute(s, { type: "battle.repeat" }, d);
      expect(r.events[0]?.kind).not.toBe("rejected");
      if (r.events.some((e) => e.kind === "wipe")) wiped = true;
      s = r.state;
    }
    expect(wiped).toBe(true);
    expect(s.screen).toBe("town");
  });
});

describe("UI-57 debug.sanDown / debug.warp（開発用、M5）", () => {
  const SAN_DOWN: Command = { type: "debug.sanDown" };
  const eventPending = (s: GameState): GameState => ({
    ...s,
    screen: "event",
    pendingChoice: {
      kind: "event",
      promptKey: "event.glowing_tablet.intro",
      options: [{ id: "examine", labelKey: "event.glowing_tablet.choice.examine" }],
      eventId: "glowing_tablet",
    },
  });

  test("UI-57/CH-53 debug.sanDown: リーダー以外の alive の SAN を 1 段ずつ（100 → 49 → 24 → 0）、段の message、最後に debug.sanDown。乱数なし", () => {
    let s = dived(1);
    s = withChar(s, 4, { life: "dead", hp: 0 }); // c5 は死亡（変えない）
    const names = s.party.map((c) => c.name);
    const live = [1, 2, 3, 5]; // c2・c3・c4・c6（リーダー c1 と死亡の c5 は対象外）
    // 手計算: sanMax 100、uneasyRatio 0.5 → ceil(50)−1 = 49、confusedRatio 0.25 → ceil(25)−1 = 24、その次は 0
    const steps: [number, number, "uneasy" | "confused" | "broken"][] = [
      [-51, 49, "uneasy"],
      [-25, 24, "confused"],
      [-24, 0, "broken"],
    ];
    for (const [delta, san, stage] of steps) {
      const before = JSON.stringify(s);
      const r = execute(s, SAN_DOWN, data);
      expect(JSON.stringify(s)).toBe(before);
      const want: GameEvent[] = [];
      for (const i of live) {
        want.push({ kind: "sanChanged", id: `c${i + 1}`, delta, san });
        want.push({ kind: "message", key: `san.${stage}`, params: { name: names[i]! } });
      }
      want.push({ kind: "message", key: "debug.sanDown" });
      expect(r.events).toEqual(want);
      expectKnownStringKeys(r.events);
      expect(r.state.rng).toEqual(s.rng);
      expect(r.state.party[0]!.san).toBe(100);
      expect(r.state.party[4]!.san).toBe(s.party[4]!.san);
      // リーダーが行動可能なので全滅しない（SAN 0 の者は行動不能のまま迷宮にいる）
      expect(r.state.screen).toBe("dungeon");
      expectStateInvariants(r.state);
      s = r.state;
    }
    // 虚脱の後は変化が無く message だけ
    expect(execute(s, SAN_DOWN, data).events).toEqual([{ kind: "message", key: "debug.sanDown" }]);
  });

  test("UI-57/CH-53 sanJustBelow は段の境の 1 つ下（sanMax 100 で 49 / 24 / 0、sanMax 7 で ceil(3.5)−1 = 3 / ceil(1.75)−1 = 1）", () => {
    const cfg = data.config;
    expect([sanJustBelow("uneasy", 100, cfg), sanJustBelow("confused", 100, cfg), sanJustBelow("broken", 100, cfg)]).toEqual([49, 24, 0]);
    expect([sanJustBelow("uneasy", 7, cfg), sanJustBelow("confused", 7, cfg)]).toEqual([3, 1]);
    expect(sanStage(3, 7, cfg)).toBe("uneasy");
    expect(sanStage(4, 7, cfg)).toBe("normal");
    expect(sanStage(1, 7, cfg)).toBe("confused");
    expect(sanStage(2, 7, cfg)).toBe("uneasy");
  });

  test("UI-57/E3 debug.sanDown は選択を待つ間（stairs・screen event）も受け付け、保留はそのまま", () => {
    const stairs: GameState = {
      ...dived(1),
      pendingChoice: { kind: "stairs", promptKey: "dungeon.stairsDown", options: [{ id: "stay", labelKey: "dungeon.choice.stay" }] },
    };
    for (const s of [stairs, eventPending(dived(1))]) {
      const r = execute(s, SAN_DOWN, data);
      expect(r.events[0]?.kind).toBe("sanChanged");
      expect(r.events.at(-1)).toEqual({ kind: "message", key: "debug.sanDown" });
      expect(r.state.pendingChoice).toEqual(s.pendingChoice);
      expect(r.state.screen).toBe(s.screen);
      expectStateInvariants(r.state);
    }
  });

  test("UI-57/TW-20/A4 リーダーが行動不能なら、3 回目の sanDown で行動可能な者がいなくなり全滅処理（screen event でも pendingChoice を下ろして街へ）", () => {
    const base = eventPending(withChar(dived(1), 0, { life: "dead", hp: 0 }));
    let s = execute(base, SAN_DOWN, data).state;
    s = execute(s, SAN_DOWN, data).state;
    expect(s.screen).toBe("event");
    const r = execute(s, SAN_DOWN, data);
    expect(r.events.some((e) => e.kind === "wipe")).toBe(true);
    expect(r.state.screen).toBe("town");
    expect(r.state.pendingChoice).toBeNull();
    expect(r.state.dive).toBeNull();
    expectStateInvariants(r.state);
  });

  test("UI-57/D2 debug.sanDown は迷宮の外（title・街）と戦闘中は rejected not in dungeon（同じ参照）", () => {
    const title = createInitialState(1, data);
    const town = newGame(1);
    const battle = withBattle(dived(1), [{ monsterId: "giant_rat", hps: [3] }]);
    for (const s of [title, town, battle]) {
      const r = execute(s, SAN_DOWN, data);
      expect(r.state).toBe(s);
      expect(r.events).toEqual([{ kind: "rejected", command: "debug.sanDown", reason: "not in dungeon" }]);
    }
  });

  const TARGETS = ["event", "trap", "stairsDown"] as const;
  type To = (typeof TARGETS)[number];
  const isTarget =
    (f: Floor, to: To) =>
    (c: Cell, x: number, y: number): boolean =>
      to === "event"
        ? c.kind === "event" && c.eventId !== null
        : to === "trap"
          ? c.kind === "trap" && (c.trapId === "pit" || c.trapId === "spinner")
          : f.stairsDown !== null
            ? f.stairsDown.x === x && f.stairsDown.y === y
            : f.boss !== null && f.boss.x === x && f.boss.y === y; // M9: 最下層はボスのセル
  /** 期待の行き先: approaches（目標の添字順 → FACINGS の順に隣から入る立ち位置）のうち、立ち位置が corridor / room の最初のもの */
  const expectedWarp = (f: Floor, to: To) =>
    approaches(f, isTarget(f, to), isPassable).find((a) => {
      const k = cellAt(f, a.pos.x, a.pos.y).kind;
      return k === "corridor" || k === "room";
    }) ?? null;

  test("UI-57 debug.warp: event / trap / stairsDown の手前（corridor / room の隣、目標を向く）へ移り、視野を explored に足して moved と debug.warp.<to>。乱数なし", () => {
    const found = new Set<To>();
    for (let seed = 1; seed <= 20; seed++) {
      const d0 = dived(seed);
      for (const floorNo of [1, 2]) {
        const s = placeAt(d0, d0.dive!.pos, d0.dive!.facing, floorNo);
        const f = floorOf(s.dive!, data);
        for (const to of TARGETS) {
          const want = expectedWarp(f, to);
          expect(warpTarget(s, data, to)).toEqual(want === null ? null : { pos: want.pos, facing: want.facing });
          const before = JSON.stringify(s);
          const r = execute(s, { type: "debug.warp", to }, data);
          expect(JSON.stringify(s)).toBe(before);
          expectKnownStringKeys(r.events);
          expect(r.state.rng).toEqual(s.rng);
          if (want === null) {
            expect(r.events).toEqual([{ kind: "message", key: "debug.warp.none" }]);
            expect(r.state).toEqual(s);
            continue;
          }
          found.add(to);
          expect(r.events).toEqual([
            { kind: "moved", pos: want.pos, facing: want.facing },
            { kind: "message", key: `debug.warp.${to === "stairsDown" && f.stairsDown === null ? "boss" : to}` },
          ]);
          const d = r.state.dive!;
          expect(d.pos).toEqual(want.pos);
          expect(d.facing).toBe(want.facing);
          expect(step(d.pos, d.facing)).toEqual(want.target); // 1 歩先が目標のセル
          const seen = visibleCellsOf(f, d.pos, d.facing, data.config.dungeon.viewDepth).map((v) => idx(f, v.x, v.y));
          for (const i of seen) expect(d.explored[floorNo], `explored ${i}`).toContain(i);
          expect(r.state.screen).toBe("dungeon");
          expect(r.state.pendingChoice).toBeNull();
          expectStateInvariants(r.state);
        }
      }
    }
    // d01 の 20 シード × 2 階で、3 つの行き先のどれも少なくとも 1 回は見つかる（テストが空回りしていないこと）
    expect([...found].sort()).toEqual(["event", "stairsDown", "trap"]);
  });

  test("UI-57 debug.warp: 処理済みのイベントは行き先が無く debug.warp.none（state 不変）。最下層の「階段前」はボスの手前へ（debug.warp.boss。M9）", () => {
    const s0 = findSituation((c) => c.kind === "event" && c.eventId !== null).state;
    const f = floorOf(s0.dive!, data);
    const cleared = cloneState(s0);
    for (let y = 0; y < f.height; y++) {
      for (let x = 0; x < f.width; x++) {
        if (cellAt(f, x, y).kind === "event") cleared.dive!.clearedCells.push({ floor: cleared.dive!.floor, x, y });
      }
    }
    const r = execute(cleared, { type: "debug.warp", to: "event" }, data);
    expect(r.events).toEqual([{ kind: "message", key: "debug.warp.none" }]);
    expect(r.state).toEqual(cleared);
    // d01 は 2 階が最下層（stairsDown null）: ボスのセルの隣へ移ってボスを向く。乱数は使わない
    const last = placeAt(s0, s0.dive!.pos, s0.dive!.facing, 2);
    const f2 = floorOf(last.dive!, data);
    expect(f2.stairsDown).toBeNull();
    const r2 = execute(last, { type: "debug.warp", to: "stairsDown" }, data);
    expect(r2.events.map((e) => (e.kind === "message" ? e.key : e.kind))).toEqual(["moved", "debug.warp.boss"]);
    expect(r2.state.rng).toEqual(last.rng);
    const p = r2.state.dive!.pos;
    const v = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] }[r2.state.dive!.facing]!;
    expect({ x: p.x + v[0]!, y: p.y + v[1]! }).toEqual(f2.boss);
    // 前進でボスの固定遭遇（DG-31）
    const r3 = execute(r2.state, { type: "dungeon.move" }, data);
    expect(r3.state.battle?.origin).toEqual({ kind: "boss" });
  });

  test("UI-57/E3/D2 debug.warp: 保留中は choice pending、迷宮の外・戦闘中は not in dungeon、知らない行き先は bad target（同じ参照）", () => {
    const pending = eventPending(dived(1));
    const r0 = execute(pending, { type: "debug.warp", to: "event" }, data);
    expect(r0.state).toBe(pending);
    expect(r0.events).toEqual([{ kind: "rejected", command: "debug.warp", reason: "choice pending" }]);
    for (const s of [createInitialState(1, data), newGame(1), withBattle(dived(1), [{ monsterId: "giant_rat", hps: [3] }])]) {
      const r = execute(s, { type: "debug.warp", to: "trap" }, data);
      expect(r.state).toBe(s);
      expect(r.events).toEqual([{ kind: "rejected", command: "debug.warp", reason: "not in dungeon" }]);
    }
    const s = dived(1);
    const bad = execute(s, { type: "debug.warp", to: "boss" } as unknown as Command, data);
    expect(bad.state).toBe(s);
    expect(bad.events).toEqual([{ kind: "rejected", command: "debug.warp", reason: "bad target" }]);
  });

  test("§3-2 debug.sanDown / debug.warp は決定的で引数を書き換えない（JSON 往復で等しい）", () => {
    const frozen = deepFreeze(loadFreshData());
    const s = dived(1);
    const cases: [GameState, Command][] = [
      [s, SAN_DOWN],
      [eventPending(s), SAN_DOWN],
      ...TARGETS.map((to): [GameState, Command] => [s, { type: "debug.warp", to }]),
    ];
    for (const [st, cmd] of cases) {
      const fz = deepFreeze(cloneState(st));
      const before = JSON.stringify(fz);
      const a = execute(fz, cmd, frozen);
      const b = execute(fz, cmd, frozen);
      expect(a.events[0]?.kind).not.toBe("rejected");
      expect(a).toEqual(b);
      expect(JSON.stringify(fz)).toBe(before);
      expect(JSON.parse(JSON.stringify(a.state))).toStrictEqual(a.state);
    }
  });
});

describe("UI-57 debug.sanOver（開発用、M7）", () => {
  const OVER: Command = { type: "debug.sanOver" };

  test("UI-57/TW-15 debug.sanOver は alive の全員の SAN を sanCapOf + 10 にする（士気なしでも・虚脱からでも。今の方が高ければ変えない、dead は触らない）。最後に message debug.sanOver{n: 10}。乱数は変えない", () => {
    const s = cloneState(dived(1));
    expect(s.morale).toBeNull();
    // sanMax は全員 100（装備に最大 SAN のオプションは無い）→ 目標は 110
    expect(s.party.map((c) => c.sanMax)).toEqual([100, 100, 100, 100, 100, 100]);
    const [c1, c2, c3, c4, c5, c6] = s.party as [Character, Character, Character, Character, Character, Character];
    c1.san = 100;
    c2.san = 30;
    c3.life = "dead";
    c3.hp = 0;
    c3.san = 40;
    c4.san = 0;
    c5.san = 115; // 既に目標より高い → 変えない
    c6.san = 110; // ちょうど目標 → 変えない
    const before = JSON.stringify(s);
    const r = execute(s, OVER, data);
    expect(JSON.stringify(s)).toBe(before);
    expect(r.events).toEqual([
      { kind: "sanChanged", id: "c1", delta: 10, san: 110 },
      { kind: "sanChanged", id: "c2", delta: 80, san: 110 },
      { kind: "sanChanged", id: "c4", delta: 110, san: 110 },
      { kind: "message", key: "debug.sanOver", params: { n: 10 } },
    ]);
    expectKnownStringKeys(r.events);
    expect(r.state.party.map((c) => c.san)).toEqual([110, 110, 40, 110, 115, 110]);
    expect(r.state.rng).toEqual(s.rng);
    // 超過の後は san.ts の規則のまま: 増加は止まり（gainSan は sanCapOf 以上なら変化なし）、減少は超過分から引く
    const ctx = makeContext(cloneState(r.state), data);
    expect(gainSan(ctx, memberById(ctx.state, "c1")!, 5).delta).toBe(0);
    expect(loseSan(ctx, memberById(ctx.state, "c1")!, 3, []).to).toBe(107);
  });

  test("UI-57 debug.sanOver は保留中・戦闘中・街も受け付け、title は rejected no party（同じ参照）", () => {
    const town = cloneState(newGame(1));
    const battle = withBattle(dived(1), [{ monsterId: "giant_rat", hps: [3] }]);
    const pending: GameState = {
      ...dived(1),
      pendingChoice: { kind: "stairs", promptKey: "dungeon.stairsDown", options: [{ id: "stay", labelKey: "dungeon.choice.stay" }] },
    };
    for (const s of [town, battle, pending]) {
      const r = execute(s, OVER, data);
      expect(r.events.at(-1)).toEqual({ kind: "message", key: "debug.sanOver", params: { n: 10 } });
      expect(r.state.party.filter((c) => c.life === "alive").map((c) => c.san)).toEqual(s.party.filter((c) => c.life === "alive").map(() => 110));
      expect(r.state.screen).toBe(s.screen);
      expect(r.state.pendingChoice).toEqual(s.pendingChoice);
    }
    const t = createInitialState(1, data);
    const r = execute(t, OVER, data);
    expect(r.state).toBe(t);
    expect(r.events).toEqual([{ kind: "rejected", command: "debug.sanOver", reason: "no party" }]);
  });
});

describe("UI-57 debug.giveCursed（開発用、M10）", () => {
  const WEAR: Command = { type: "debug.giveCursed", wearable: true };
  const OTHER: Command = { type: "debug.giveCursed", wearable: false };

  test("UI-57/CH-77 debug.giveCursed{wearable: true} は司教が装備できる最初のベース（dagger）の呪われた未鑑定品（Lv0・通常・負のオプション 1 つ）を、並び順で最初に使用枠の空いた者の末尾に入れる。街では台帳なし・foundIn null。message debug.giveCursed{name, item}。乱数は変えない", () => {
    const s = cloneState(newGame(1));
    s.party[0]!.inventory.push(...Array.from({ length: 8 }, () => createItemInstance(s, { itemId: "herb", identified: true })));
    expect(slotsUsedOf(s.party[0]!)).toBeGreaterThanOrEqual(data.config.inventory.slotsPerCharacter);
    const before = JSON.stringify(s);
    const r = execute(s, WEAR, data);
    expect(JSON.stringify(s)).toBe(before);
    const id = `i${s.nextItemSeq}`;
    const c2 = r.state.party[1]!;
    expect(c2.inventory.at(-1)).toBe(id);
    expect(r.state.items[id]).toEqual({ id, itemId: "dagger", level: 0, rarity: "normal", options: [{ optionId: "str", tier: 1, value: -1 }], uniqueId: null, identified: false, cursed: true, foundIn: null });
    expect(r.state.nextItemSeq).toBe(s.nextItemSeq + 1);
    expect(r.events).toEqual([{ kind: "message", key: "debug.giveCursed", params: { name: c2.name, item: "短い刃？" } }]);
    expectKnownStringKeys(r.events);
    expect(r.state.rng).toEqual(s.rng);
    expect(r.state.screen).toBe("town");
    // 司教が装備できる（取り憑きの強制装備を試せる）
    const bishop = data.classes.find((c) => c.abilities.includes("identify"))!;
    const dagger = baseOf(data, "dagger");
    expect(dagger.classes.length === 0 || dagger.classes.includes(bishop.id)).toBe(true);
  });

  test("UI-57/CH-77 debug.giveCursed{wearable: false} は司教が装備できない最初のベース（long_sword）。迷宮では台帳に入り foundIn はそのダンジョン", () => {
    const s = dived(1);
    const r = execute(s, OTHER, data);
    const id = `i${s.nextItemSeq}`;
    const inst = r.state.items[id]!;
    expect(inst.itemId).toBe("long_sword");
    expect(baseOf(data, "long_sword").classes.includes("bishop")).toBe(false);
    expect([inst.cursed, inst.identified, inst.level, inst.rarity, inst.foundIn]).toEqual([true, false, 0, "normal", s.dive!.dungeonId]);
    expect(inst.options).toHaveLength(1);
    expect(inst.options[0]!.value).toBeLessThan(0);
    expect(r.state.dive!.ledger.items).toEqual([...s.dive!.ledger.items, id]);
    expect(r.state.party[0]!.inventory.at(-1)).toBe(id);
    expect(r.events).toEqual([{ kind: "message", key: "debug.giveCursed", params: { name: r.state.party[0]!.name, item: itemDisplayName(r.state, data, id) } }]);
    expect(r.state.rng).toEqual(s.rng);
  });

  test("UI-57 debug.giveCursed は誰の使用枠も空いていなければ実体を作らず message debug.giveCursed.full。保留中・戦闘中も受け付け、title は rejected no party", () => {
    const s = cloneState(newGame(1));
    for (const ch of s.party) while (slotsUsedOf(ch) < data.config.inventory.slotsPerCharacter) ch.inventory.push(createItemInstance(s, { itemId: "herb", identified: true }));
    const full = execute(s, WEAR, data);
    expect(full.events).toEqual([{ kind: "message", key: "debug.giveCursed.full" }]);
    expectKnownStringKeys(full.events);
    expect(full.state).toEqual(s);
    const battle = withBattle(dived(1), [{ monsterId: "giant_rat", hps: [3] }]);
    const pending: GameState = {
      ...dived(1),
      pendingChoice: { kind: "stairs", promptKey: "dungeon.stairsDown", options: [{ id: "stay", labelKey: "dungeon.choice.stay" }] },
    };
    for (const st of [battle, pending]) {
      const r = execute(st, WEAR, data);
      expect(r.events.at(-1)?.kind).toBe("message");
      expect(r.state.items[`i${st.nextItemSeq}`]?.cursed).toBe(true);
      expect(r.state.pendingChoice).toEqual(st.pendingChoice);
    }
    const t = createInitialState(1, data);
    const r = execute(t, WEAR, data);
    expect(r.state).toBe(t);
    expect(r.events).toEqual([{ kind: "rejected", command: "debug.giveCursed", reason: "no party" }]);
  });
});

describe("UI-57 debug.levels（開発用、M12。U-6）", () => {
  const LV = (level: number): Command => ({ type: "debug.levels", level });

  test("UI-57/CH-61/CH-63 debug.levels{5} は alive の全員の exp を expFor(5) にして Lv5 まで上げる（HP のダイス・能力値の成長 CH-61（M14）・初到達の習得判定は宿と同じ順で state.rng）。dead は触らない。変わった者ごとに levelUp 1 件（合計の増分・statGains は段ごとにつないだもの）と debug.levels.member、最後に debug.levels{level}", () => {
    const s = withChar(newGame(3), 2, { life: "dead", hp: 0 });
    const before = JSON.stringify(s);
    const r = execute(s, LV(5), data);
    expect(JSON.stringify(s)).toBe(before);
    expectStateInvariants(r.state);
    expectKnownStringKeys(r.events);
    // 鏡: 同じ state から levelUpOnce を並び順に 1 段ずつ回したものと一致する（乱数の順も同じ。M14 から能力値の成長も含む）
    const mirror = makeContext(cloneState(s), data);
    const mirrorGains: Record<string, (keyof Character["stats"])[]> = {};
    for (const ch of mirror.state.party) {
      if (ch.life !== "alive") continue;
      ch.exp = expFor(5, classOf(data, ch.classId), data.config);
      const mark = mirror.events.length;
      while (ch.level < 5) levelUpOnce(mirror, ch);
      mirrorGains[ch.id] = mirror.events.slice(mark).flatMap((e) => (e.kind === "levelUp" ? e.statGains : []));
    }
    expect(r.state.party).toEqual(mirror.state.party);
    expect(r.state.rng).toEqual(mirror.state.rng);
    expect(r.state.rng).not.toEqual(s.rng);
    const expected: GameEvent[] = [];
    s.party.forEach((b, i) => {
      const a = r.state.party[i]!;
      if (b.life !== "alive") {
        expect(a).toEqual(b);
        return;
      }
      expect(a.level).toBe(5);
      expect(a.exp).toBe(expFor(5, classOf(data, a.classId), data.config));
      const gains = mirrorGains[a.id]!;
      for (const k of Object.keys(b.stats) as (keyof typeof b.stats)[]) expect(a.stats[k]).toBe(b.stats[k] + gains.filter((g) => g === k).length); // CH-61（M14）
      expect(a.levelHistory.map((h) => h.level)).toEqual([2, 3, 4, 5]);
      expect(a.maxLevelReached[a.classId]).toBe(5);
      const hpGain = a.levelHistory.reduce((n, h) => n + h.hpGain, 0);
      const mpGain = a.levelHistory.reduce((n, h) => n + h.mpGain, 0);
      expect(a.hpMax).toBe(b.hpMax + hpGain);
      expect(a.mpMax).toBe(b.mpMax + mpGain);
      expect(a.knownSpells.slice(0, b.knownSpells.length)).toEqual(b.knownSpells);
      expected.push({ kind: "levelUp", id: a.id, level: 5, hpGain, mpGain, hpMax: a.hpMax, mpMax: a.mpMax, hp: a.hp, mp: a.mp, statGains: gains });
      expected.push({ kind: "message", key: "debug.levels.member", params: { name: a.name, from: 1, to: 5, learned: a.knownSpells.length - b.knownSpells.length } });
    });
    expected.push({ kind: "message", key: "debug.levels", params: { level: 5 } });
    expect(r.events).toEqual(expected);
    // 呪文を使う職業の誰かは覚えている（習得判定が走った）
    expect(r.state.party.some((c, i) => c.knownSpells.length > s.party[i]!.knownSpells.length)).toBe(true);
  });

  test("UI-57/CH-62/CH-63 debug.levels で下げるときは exp を expFor(level) にして levelDownWhileBelow（乱数なし、levelDown 1 件、maxLevelReached は残る）。同じ Lv なら exp だけ揃えて events は debug.levels だけ。上げ直しでは習得判定をしない", () => {
    const up = execute(newGame(3), LV(5), data).state;
    const down = execute(up, LV(2), data);
    expectStateInvariants(down.state);
    expect(down.state.rng).toEqual(up.rng);
    const ev: GameEvent[] = [];
    up.party.forEach((b, i) => {
      const a = down.state.party[i]!;
      expect(a.level).toBe(2);
      expect(a.exp).toBe(expFor(2, classOf(data, a.classId), data.config));
      expect(a.levelHistory).toEqual(b.levelHistory.slice(0, 1));
      expect(a.maxLevelReached).toEqual(b.maxLevelReached);
      expect(a.knownSpells).toEqual(b.knownSpells);
      ev.push({ kind: "levelDown", id: a.id, level: 2, hpMax: a.hpMax, mpMax: a.mpMax, hp: a.hp, mp: a.mp });
      ev.push({ kind: "message", key: "debug.levels.member", params: { name: a.name, from: 5, to: 2, learned: 0 } });
    });
    ev.push({ kind: "message", key: "debug.levels", params: { level: 2 } });
    expect(down.events).toEqual(ev);

    const same = execute(down.state, LV(2), data);
    expect(same.events).toEqual([{ kind: "message", key: "debug.levels", params: { level: 2 } }]);
    expect(same.state.party).toEqual(down.state.party);

    const again = execute(down.state, LV(5), data);
    expect(again.state.party.map((c) => c.knownSpells)).toEqual(down.state.party.map((c) => c.knownSpells));
    expect(again.state.party.map((c) => c.level)).toEqual([5, 5, 5, 5, 5, 5]);
  });

  test("UI-57 debug.levels は迷宮の戦闘外も受け付け、title は no party・戦闘中は in battle・Lv が 1〜DEBUG_LEVEL_MAX の整数でなければ bad level・保留中は choice pending（どれも同じ参照）", () => {
    const d = execute(dived(1), LV(DEBUG_LEVEL_MAX), data);
    expect(d.events.at(-1)).toEqual({ kind: "message", key: "debug.levels", params: { level: DEBUG_LEVEL_MAX } });
    expect(d.state.party.every((c) => c.level === DEBUG_LEVEL_MAX)).toBe(true);
    expect(d.state.screen).toBe("dungeon");
    expect(DEBUG_LEVELS.every((n) => Number.isInteger(n) && n >= 1 && n <= DEBUG_LEVEL_MAX)).toBe(true);

    const t = createInitialState(1, data);
    const battle = withBattle(dived(1), [{ monsterId: "giant_rat", hps: [3] }]);
    const pending: GameState = {
      ...dived(1),
      pendingChoice: { kind: "stairs", promptKey: "dungeon.stairsDown", options: [{ id: "stay", labelKey: "dungeon.choice.stay" }] },
    };
    const town = newGame(1);
    const cases: [GameState, Command, string][] = [
      [t, LV(5), "no party"],
      [battle, LV(5), "in battle"],
      [pending, LV(5), "choice pending"],
      [town, LV(0), "bad level"],
      [town, LV(DEBUG_LEVEL_MAX + 1), "bad level"],
      [town, LV(2.5), "bad level"],
      [town, { type: "debug.levels", level: "5" } as unknown as Command, "bad level"],
    ];
    for (const [s, cmd, reason] of cases) {
      const r = execute(s, cmd, data);
      expect(r.state, reason).toBe(s);
      expect(r.events, reason).toEqual([{ kind: "rejected", command: "debug.levels", reason }]);
    }
  });
});

describe("UI-57 debug.addTurns（開発用、M5.5）", () => {
  const ADD: Command = { type: "debug.addTurns" };

  test("UI-57 debug.addTurns は adventureTurns を tavernEventTurns 増やし message debug.addTurns{n, total}。title は rejected no party。保留中・戦闘中も受け付け、乱数は変えない", () => {
    expect(data.config.town.tavernEventTurns).toBe(200);
    const town = cloneState(newGame(1));
    town.adventureTurns = 15;
    const dungeon = dived(1);
    const battle = withBattle(dived(1), [{ monsterId: "giant_rat", hps: [3] }]);
    const pending: GameState = {
      ...dived(1),
      pendingChoice: { kind: "stairs", promptKey: "dungeon.stairsDown", options: [{ id: "stay", labelKey: "dungeon.choice.stay" }] },
    };
    for (const s of [town, dungeon, battle, pending]) {
      const before = JSON.stringify(s);
      const r = execute(s, ADD, data);
      expect(JSON.stringify(s)).toBe(before);
      const total = s.adventureTurns + 200;
      expect(r.events).toEqual([{ kind: "message", key: "debug.addTurns", params: { n: 200, total } }]);
      expectKnownStringKeys(r.events);
      expect(r.state.adventureTurns).toBe(total);
      expect(r.state.tavernEventMark).toBe(s.tavernEventMark);
      expect(r.state.rng).toEqual(s.rng);
      expect(r.state.screen).toBe(s.screen);
      expect(r.state.pendingChoice).toEqual(s.pendingChoice);
      expect(r.state.battle).toEqual(s.battle);
    }
    expect(execute(town, ADD, data).events).toEqual([{ kind: "message", key: "debug.addTurns", params: { n: 200, total: 215 } }]);
    // title（party が空）は rejected（同じ参照）
    const t = createInitialState(1, data);
    const r = execute(t, ADD, data);
    expect(r.state).toBe(t);
    expect(r.events).toEqual([{ kind: "rejected", command: "debug.addTurns", reason: "no party" }]);
    // config の値を足す
    const d = loadFreshData();
    d.config.town.tavernEventTurns = 7;
    expect(execute(town, ADD, d).state.adventureTurns).toBe(22);
  });
});
