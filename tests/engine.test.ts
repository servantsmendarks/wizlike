import { describe, expect, test } from "vitest";
import { createInitialState, execute } from "../src/core/engine";
import { createRng } from "../src/core/rng";
import { cloneState, createItemInstance, destroyItemInstance, dungeonOf, itemDisplayName, memberById, monsterOf } from "../src/core/state";
import type { Command, GameEvent, GameState } from "../src/core/types";
import {
  data,
  deepFreeze,
  defaultMembers,
  expectKnownStringKeys,
  loadFreshData,
  newGame,
  stringKeysOf,
  withChar,
} from "./helpers/core";
import { dataWith, dived, withBattle } from "./helpers/battle";

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
    expect(r.events).toEqual([{ kind: "screen", to: "town" }]);
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

  test("D3 createInitialState: screen title、party []、rng は createRng(seed) と同じ、gold 0、bank 0、nextItemSeq 1、dive と pendingChoice と battle は null、bestiary は {}、townVisit は null", () => {
    const s = createInitialState(42, data);
    expect(s).toEqual({
      screen: "title",
      rng: createRng(42),
      party: [],
      items: {},
      nextItemSeq: 1,
      gold: 0,
      bank: 0,
      progress: { unlockedDungeons: [], clearedDungeons: [] },
      dive: null,
      pendingChoice: null,
      battle: null,
      bestiary: {},
      townVisit: null,
    });
    expect(() => createInitialState(1.5, data)).toThrow(RangeError);
  });

  test("DG-03/E3 game.new の後も dive と pendingChoice は null で、JSON 往復で変わらない", () => {
    const s = execute(createInitialState(1, data), gameNew(), data).state;
    expect(s.dive).toBeNull();
    expect(s.pendingChoice).toBeNull();
    expect(cloneState(s)).toEqual(s);
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

  test("DG-41 destroyItemInstance は潜行中なら dive.ledger.items からも外す（他の台帳の品と持ち込みの品は残る）", () => {
    const entered = execute(execute(createInitialState(1, data), gameNew(), data).state, { type: "dungeon.enter", dungeonId: "d01" }, data);
    expectKnownStringKeys(entered.events);
    const s = cloneState(entered.state);
    const ch = memberById(s, "c1")!;
    const carried = ch.inventory[0]!; // 持ち込みの herb（台帳には無い）
    const gotA = createItemInstance(s, "herb", true);
    const gotB = createItemInstance(s, "herb", true);
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

  test("CH-72 itemDisplayName: 鑑定済みは name、未鑑定は unidentifiedName、unidentifiedName が無ければ name。実体が無ければ Error", () => {
    const s = cloneState(execute(createInitialState(1, data), gameNew(), data).state);
    const knownDagger = createItemInstance(s, "cursed_dagger", true);
    const unknownDagger = createItemInstance(s, "cursed_dagger", false);
    const unknownHerb = createItemInstance(s, "herb", false); // herb は unidentifiedName を持たない
    expect(itemDisplayName(s, data, knownDagger)).toBe("血濡れの短剣");
    expect(itemDisplayName(s, data, unknownDagger)).toBe("短剣？");
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

  test("D3 game.new で screen は town、events は [{kind:\"screen\",to:\"town\"}] だけ", () => {
    const r = execute(createInitialState(1, data), gameNew(), data);
    expect(r.state.screen).toBe("town");
    expect(r.events).toEqual([{ kind: "screen", to: "town" }]);
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
    { type: "town.shop", action: { kind: "sell", memberId: "c1", instanceId: "i4" } },
    { type: "town.shop", action: { kind: "identify", memberId: "c1", instanceId: "i4" } },
    { type: "town.bank", amount: 10 },
    { type: "dungeon.cast", memberId: "c4", spellId: "heal" },
    { type: "party.reorder", order: ["c1", "c2", "c3", "c4", "c5", "c6"] },
  ])("D2 M4 で未実装のコマンドは not implemented: $type", (cmd) => {
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
