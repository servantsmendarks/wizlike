import { describe, expect, test } from "vitest";
import config from "../data/config.json";
import races from "../data/races.json";
import classes from "../data/classes.json";
import spells from "../data/spells.json";
import monsters from "../data/monsters.json";
import items from "../data/items.json";
import personalities from "../data/personalities.json";
import penaltyTable from "../data/penalty-table.json";
import dungeons from "../data/dungeons.json";
import events from "../data/events.json";
import strings from "../data/strings.json";
import {
  DATA_FILES,
  GameDataError,
  loadGameData,
  type RawGameData,
} from "../src/core/data";
import { createRng, isDiceExpr, rollDice } from "../src/core/rng";

// 生データを書き換えるテスト用。JSON なので any で自由に壊す。
type Mutable = { [K in keyof RawGameData]: any };

function rawData(): Mutable {
  return structuredClone({
    config,
    races,
    classes,
    spells,
    monsters,
    items,
    personalities,
    penaltyTable,
    dungeons,
    events,
    strings,
  }) as Mutable;
}

function issuesOf(mutate: (r: Mutable) => void): string[] {
  const r = rawData();
  mutate(r);
  try {
    loadGameData(r);
    return [];
  } catch (e) {
    if (e instanceof GameDataError) return [...e.issues];
    throw e;
  }
}

/** mutate の結果、file の issue に fragment を含むものがある。 */
function expectIssue(mutate: (r: Mutable) => void, file: string, fragment: string): string[] {
  const issues = issuesOf(mutate);
  const hit = issues.filter((s) => s.startsWith(`${file}: `) && s.includes(fragment));
  expect(hit, `issues were:\n${issues.join("\n")}`).not.toHaveLength(0);
  return issues;
}

describe("data: 実データ", () => {
  test("data: 実データが loadGameData を通る", () => {
    const data = loadGameData(rawData());
    expect(data.races).toHaveLength(5);
    expect(data.classes).toHaveLength(7);
    expect(data.spells).toHaveLength(10);
    expect(data.monsters).toHaveLength(6);
    expect(data.items).toHaveLength(16);
    expect(data.personalities.map((p) => p.id).sort()).toEqual(["cautious", "greedy", "normal", "reckless"]);
    expect(data.penaltyTable.bands).toHaveLength(7);
    expect(data.dungeons.map((d) => d.id)).toEqual(["d01", "d02"]);
    expect(data.events).toHaveLength(3);
    expect(data.config.prototypeParty.members).toHaveLength(6);
    expect(data.config.prototypeParty.members[0]?.isLeader).toBe(true);
    expect(data.strings["dungeon.trap.pit"]).toBeTypeOf("string");
  });

  test("data: DATA_FILES がファイル名と対応する", () => {
    expect(DATA_FILES.penaltyTable).toBe("penalty-table.json");
    expect(DATA_FILES.config).toBe("config.json");
    expect(Object.keys(DATA_FILES)).toHaveLength(11);
  });

  test("data: 実データの定数形ダイス（gold \"0\"、groupSize \"1\"）が通る", () => {
    const raw = rawData();
    expect(raw.monsters.filter((m: any) => m.gold === "0").length).toBeGreaterThanOrEqual(1);
    expect(raw.monsters.filter((m: any) => m.groupSize === "1").length).toBeGreaterThanOrEqual(1);
    expect(() => loadGameData(raw)).not.toThrow();
    // 定数形は rng の isDiceExpr / parseDice / rollDice にそのまま渡せる
    for (const m of raw.monsters as { gold: string; groupSize: string }[]) {
      expect(isDiceExpr(m.gold)).toBe(true);
      expect(isDiceExpr(m.groupSize)).toBe(true);
    }
    expect(rollDice(createRng(1), "0").total).toBe(0);
    expect(rollDice(createRng(1), "1").total).toBe(1);
  });
});

describe("data: config.json", () => {
  test("data: 必須フィールドの欠落", () => {
    expectIssue((r) => delete r.config.combat.hitMin, "config.json", "combat.hitMin: missing required field");
  });
  test("data: 未知のキー（打ち間違い）", () => {
    expectIssue((r) => (r.config.combat.hitMaxx = 90), "config.json", "combat.hitMaxx: unknown field");
  });
  test("data: 型違い", () => {
    expectIssue((r) => (r.config.save.maxGames = "5"), "config.json", "save.maxGames: expected integer >= 1, got string");
  });
  test("data: CB-21 hitMin <= hitMax、百分率の範囲", () => {
    expectIssue((r) => (r.config.combat.hitMin = 96), "config.json", "CB-21");
    expectIssue((r) => (r.config.combat.hitMax = 101), "config.json", "combat.hitMax: expected integer in 0..100, got 101");
  });
  test("data: CB-20 acMin は acBase 以下", () => {
    expectIssue((r) => (r.config.combat.acMin = r.config.combat.acBase + 1), "config.json", "combat.acMin: CB-20");
    expect(issuesOf((r) => (r.config.combat.acMin = r.config.combat.acBase))).toEqual([]);
  });
  test("data: DG-05 dungeon.defaultRooms は 1 以上の整数の [min, max]", () => {
    const p = "dungeon.defaultRooms";
    expectIssue((r) => (r.config.dungeon.defaultRooms = [6, 3]), "config.json", `${p}: min 6 > max 3`);
    expectIssue((r) => (r.config.dungeon.defaultRooms = [0, 6]), "config.json", `${p}[0]: expected integer >= 1, got 0`);
    expectIssue((r) => (r.config.dungeon.defaultRooms = [3, 6.5]), "config.json", `${p}[1]: expected integer`);
    expectIssue((r) => (r.config.dungeon.defaultRooms = [3]), "config.json", `${p}: expected [min, max] (2 elements), got 1 element(s)`);
    expectIssue((r) => (r.config.dungeon.defaultRooms = [3, 4, 6]), "config.json", `${p}: expected [min, max] (2 elements), got 3 element(s)`);
    expectIssue((r) => delete r.config.dungeon.defaultRooms, "config.json", `${p}: missing required field`);
  });
  test("data: CH-53 confusedRatio < uneasyRatio", () => {
    expectIssue((r) => (r.config.san.confusedRatio = 0.6), "config.json", "CH-53");
  });
  test("data: CH-01 パーティは 6 人", () => {
    expectIssue((r) => r.config.prototypeParty.members.pop(), "config.json", "CH-01");
  });
  test("data: CH-02 リーダーは先頭の 1 人だけ", () => {
    expectIssue((r) => (r.config.prototypeParty.members[1].isLeader = true), "config.json", "CH-02");
    expectIssue((r) => (r.config.prototypeParty.members[0].isLeader = false), "config.json", "CH-02");
  });
  test("data: prototypeParty のぶら下がり参照", () => {
    const issues = issuesOf((r) => {
      r.config.prototypeParty.members[0].raceId = "orc";
      r.config.prototypeParty.members[1].inventory = ["herbb"];
    });
    expect(issues).toContain('config.json: prototypeParty.members[0].raceId: unknown race id "orc"');
    expect(issues).toContain('config.json: prototypeParty.members[1].inventory[0]: unknown item id "herbb"');
  });
  test("data: CH-70 CH-75 装備のスロットと職業", () => {
    expectIssue(
      (r) => (r.config.prototypeParty.members[0].equipment.helm = "leather_armor"),
      "config.json",
      "prototypeParty.members[0].equipment.helm: CH-70",
    );
    // エル（mage）は長剣を装備できない
    expectIssue(
      (r) => (r.config.prototypeParty.members[4].equipment.weapon = "long_sword"),
      "config.json",
      "prototypeParty.members[4].equipment.weapon: CH-75",
    );
  });
  test("data: CH-21 職業の能力値条件を満たす", () => {
    expectIssue((r) => (r.config.prototypeParty.members[0].stats.str = 10), "config.json", "CH-21");
  });
  test("data: CH-71 所持枠を超えない", () => {
    expectIssue((r) => (r.config.prototypeParty.members[0].inventory = Array(6).fill("herb")), "config.json", "CH-71");
  });
  test("data: MG-11 使えない系統の呪文を初期呪文に持たない", () => {
    expectIssue((r) => r.config.prototypeParty.members[4].knownSpells.push("heal"), "config.json", "MG-11");
  });
});

describe("data: races.json / classes.json", () => {
  test("data: CH-10 能力値は 18 以下", () => {
    expectIssue((r) => (r.races[0].baseStats.str = 19), "races.json", "[0].baseStats.str: expected integer in 1..18, got 19");
  });
  test("data: 重複 id", () => {
    expectIssue((r) => (r.races[1].id = "human"), "races.json", '[1].id: duplicate id "human"');
  });
  test("data: classes の列挙と未知の系統キー", () => {
    const issues = expectIssue((r) => (r.classes[0].tier = "elite"), "classes.json", "[0].tier: expected one of basic|advanced");
    expect(issues).toHaveLength(1);
    expectIssue((r) => (r.classes[2].spells.druid = 1), "classes.json", "[2].spells.druid: unknown field");
  });
});

describe("data: spells.json", () => {
  test("data: MG-10 呪文レベルは 1..7", () => {
    expectIssue((r) => (r.spells[0].level = 8), "spells.json", "[0].level: expected integer in 1..7, got 8");
  });
  test("data: 効果の判別共用体", () => {
    expectIssue((r) => (r.spells[0].effect = { type: "explode" }), "spells.json", "[0].effect.type: expected one of");
    expectIssue((r) => delete r.spells[1].effect.chance, "spells.json", "[1].effect.chance: missing required field");
    expectIssue((r) => (r.spells[0].effect.status = "sleep"), "spells.json", "[0].effect.status: unknown field");
  });
  test("data: MG-12 習得レベルは 1 以上", () => {
    expectIssue((r) => (r.spells[0].learnLevel = 0), "spells.json", "[0].learnLevel: expected integer >= 1, got 0");
  });
  test("data: MG spells の tags は省略可（magic.md §6）", () => {
    expect(issuesOf((r) => delete r.spells[0].tags)).toEqual([]);
    expect(issuesOf((r) => r.spells.forEach((sp: { tags?: string[] }) => delete sp.tags))).toEqual([]);
    expectIssue((r) => (r.spells[0].tags = [""]), "spells.json", "[0].tags[0]: expected non-empty string");
  });
  test("data: 不正なダイス文字列", () => {
    expectIssue((r) => (r.spells[0].effect.dice = "d8"), "spells.json", '[0].effect.dice: invalid dice expression "d8"');
  });
});

describe("data: monsters.json", () => {
  test("data: 型違いのメッセージにファイル名とパスが入る", () => {
    const issues = issuesOf((r) => (r.monsters[3].hp = 12));
    expect(issues).toEqual(["monsters.json: [3].hp: expected string, got integer"]);
  });
  test("data: 不正なダイス文字列", () => {
    expectIssue((r) => (r.monsters[0].gold = "1d4+"), "monsters.json", "[0].gold: invalid dice expression");
    for (const bad of ["0d6", "-1", "+5", "05", "10000", " 1", "1 ", "2x6"]) {
      expectIssue((r) => (r.monsters[0].gold = bad), "monsters.json", `[0].gold: invalid dice expression ${JSON.stringify(bad)}`);
    }
  });
  test("data: CB-03 グループの体数は maxPerGroup 以下", () => {
    expectIssue((r) => (r.monsters[0].groupSize = "3d4"), "monsters.json", "[0].groupSize: CB-03");
    expectIssue((r) => (r.monsters[0].groupSize = "0"), "monsters.json", "[0].groupSize: CB-03");
    expectIssue((r) => (r.monsters[0].groupSize = "1d4-1"), "monsters.json", "[0].groupSize: CB-03");
    expect(issuesOf((r) => (r.monsters[0].groupSize = "1"))).toEqual([]);
  });
  test("data: CB-24 status と chance は組", () => {
    expectIssue((r) => delete r.monsters[2].attacks[0].chance, "monsters.json", "[2].attacks[0]: CB-24");
  });
  test("data: CB-31 SAN 攻撃の sanDrain は 1 以上", () => {
    expectIssue((r) => (r.monsters[4].attacks[0].sanDrain = 0), "monsters.json", "[4].attacks[0].sanDrain: expected integer >= 1, got 0");
  });
  test("data: CB-03 出現場所は encounterTable のみが正で、monsters は floors を持たない", () => {
    expectIssue((r) => (r.monsters[0].floors = [1, 2]), "monsters.json", "[0].floors: unknown field");
  });
  test("data: attacks は 1 つ以上", () => {
    expectIssue((r) => (r.monsters[0].attacks = []), "monsters.json", "[0].attacks: expected at least 1");
  });
});

describe("data: items.json", () => {
  test("data: MG-25 魔法書は bookOnly の呪文を教える", () => {
    expectIssue(
      (r) => (r.items.find((i: { id: string }) => i.id === "tome_lightning").effect.spell = "fire_arrow"),
      "items.json",
      "MG-25",
    );
  });
  test("data: CB-20 防具の ac は整数（正の ac も可。呪いの装備など）", () => {
    expect(issuesOf((r) => {
      r.items[5].cursed = true;
      r.items[5].ac = 2;
    })).toEqual([]);
    expectIssue((r) => (r.items[5].ac = 1.5), "items.json", "[5].ac: expected integer, got number");
  });
  test("data: 種類ごとの必須と不要なフィールド", () => {
    expectIssue((r) => delete r.items[0].damage, "items.json", "[0].damage: missing required field");
    expectIssue((r) => (r.items[5].ranged = false), "items.json", "[5].ranged: unknown field");
  });
  test("data: ぶら下がり参照（職業）", () => {
    expectIssue((r) => r.items[1].classes.push("ninja"), "items.json", '[1].classes[3]: unknown class id "ninja"');
  });
  test("data: CH-70 装備の slot は type と一致", () => {
    expectIssue((r) => (r.items[5].slot = "helm"), "items.json", "[5].slot: CH-70");
  });
});

describe("data: personalities.json", () => {
  test("data: CH-30 4 つの性格がそろう", () => {
    expectIssue((r) => r.personalities.pop(), "personalities.json", 'CH-30: personality "normal" is missing');
  });
  test("data: EV-03 誘いの重みは 0..3", () => {
    expectIssue((r) => (r.personalities[1].lure.unknown = 4), "personalities.json", "[1].lure.unknown: expected integer in 0..3");
  });
  test("data: EV-14 普通の lure は 0", () => {
    expectIssue(
      (r) => (r.personalities.find((x: { id: string }) => x.id === "normal").lure.weak = 1),
      "personalities.json",
      "[3].lure.weak: EV-14: normal must have lure 0, got 1",
    );
  });
  test("data: EV-41 普通は恩恵も耐性も持たない", () => {
    expectIssue((r) => (r.personalities[3].benefits.damage = 1), "personalities.json", "EV-41");
    expectIssue((r) => (r.personalities[3].san.fearLossMul = 0.5), "personalities.json", "EV-41");
  });
});

describe("data: penalty-table.json", () => {
  test("data: TW-22 ペナルティ表が 2..20 を網羅（隙間）", () => {
    expectIssue((r) => (r.penaltyTable.bands[1].max = 5), "penalty-table.json", "TW-22: rolls 6..6 are not covered");
  });
  test("data: TW-22 ペナルティ表の帯が重ならない", () => {
    expectIssue((r) => (r.penaltyTable.bands[1].min = 3), "penalty-table.json", "TW-22");
  });
  test("data: TW-22 ダイスは 2d10、比率は 0..1", () => {
    expectIssue((r) => (r.penaltyTable.dice = "3d6"), "penalty-table.json", "dice: TW-22");
    expectIssue((r) => (r.penaltyTable.bands[0].goldLossRatio = 1.5), "penalty-table.json", "bands[0].goldLossRatio: expected number in 0..1");
  });
  test("data: 帯の文言キーが strings.json にある", () => {
    expectIssue((r) => (r.penaltyTable.bands[0].text = "wipe.band.nope"), "penalty-table.json", 'unknown strings.json key "wipe.band.nope"');
  });
});

describe("data: dungeons.json", () => {
  test("data: ぶら下がり参照（敵・アイテム・イベント）", () => {
    const issues = issuesOf((r) => {
      r.dungeons[0].encounterTable["1"][0].monster = "dragon";
      r.dungeons[0].onClear.shopStock.push("excalibur");
      r.dungeons[1].events.push("no_such_event");
      r.dungeons[0].boss.monster = "boss_x";
    });
    expect(issues).toEqual(
      expect.arrayContaining([
        'dungeons.json: [0].encounterTable.1[0].monster: unknown monster id "dragon"',
        'dungeons.json: [0].onClear.shopStock[2]: unknown item id "excalibur"',
        'dungeons.json: [1].events[3]: unknown event id "no_such_event"',
        'dungeons.json: [0].boss.monster: unknown monster id "boss_x"',
      ]),
    );
  });
  test("data: DG-02 階ごとの表のキーは 1..floors", () => {
    expectIssue((r) => (r.dungeons[0].encounterTable["3"] = [{ monster: "kobold", weight: 1 }]), "dungeons.json", "[0].encounterTable.3: DG-02");
    expectIssue((r) => delete r.dungeons[1].groupCountWeights["3"], "dungeons.json", "[1].groupCountWeights.3: missing required field");
  });
  test("data: CB-03 グループ数の重みは maxEnemyGroups 個", () => {
    expectIssue((r) => (r.dungeons[0].groupCountWeights["1"] = [70, 30]), "dungeons.json", "[0].groupCountWeights.1: CB-03");
    expectIssue((r) => (r.dungeons[0].groupCountWeights["1"] = [0, 0, 0, 0]), "dungeons.json", "CB-03: weights must sum to > 0");
  });
  test("data: DG-01 配列の順に開放する", () => {
    expectIssue((r) => (r.dungeons[1].unlock = null), "dungeons.json", "[1].unlock: DG-01");
    expectIssue((r) => (r.dungeons[0].onClear.unlockDungeon = null), "dungeons.json", "[0].onClear.unlockDungeon: DG-01");
  });
  test("data: DG-01 ダンジョンは 1 件以上", () => {
    expectIssue((r) => (r.dungeons = []), "dungeons.json", "(root): expected at least 1 element(s), got 0");
  });
  test("data: DG-34 テレポーター階は floors 以下", () => {
    expectIssue((r) => (r.dungeons[0].teleporterFloors = [3]), "dungeons.json", "[0].teleporterFloors[0]: DG-34: floor 3 exceeds floors 2");
    expect(issuesOf((r) => (r.dungeons[0].teleporterFloors = [2]))).toEqual([]);
  });
  test("data: DG-22 イベントは重複しない", () => {
    expectIssue((r) => r.dungeons[0].events.push("glowing_tablet"), "dungeons.json", "DG-22");
  });
  test("data: DG-20 罠の種類", () => {
    expectIssue((r) => r.dungeons[0].traps.push("arrow"), "dungeons.json", "[0].traps[2]: expected one of pit|spinner|teleport");
  });
  test("data: DG-05 rooms は [min, max]", () => {
    expectIssue((r) => (r.dungeons[0].rooms = [6, 3]), "dungeons.json", "[0].rooms: min 6 > max 3");
  });
  test("data: DG-05 rooms は省略でき、既定値（config.dungeon.defaultRooms）を超える rooms も通る", () => {
    expect(issuesOf((r) => delete r.dungeons[0].rooms)).toEqual([]);
    expect(issuesOf((r) => (r.dungeons[0].rooms = [4, 7]))).toEqual([]);
  });
});

describe("data: events.json", () => {
  test("data: EV-34 文言キーが strings.json にある", () => {
    expectIssue((r) => (r.events[0].text.intro = "event.nope"), "events.json", '[0].text.intro: unknown strings.json key "event.nope"');
    expectIssue((r) => (r.events[1].choices[0].text = "event.nope2"), "events.json", "[1].choices[0].text: unknown strings.json key");
  });
  test("data: EV-32 効果の型と参照", () => {
    expectIssue((r) => (r.events[2].choices[0].effects[0].itemId = "herbx"), "events.json", '[2].choices[0].effects[0].itemId: unknown item id "herbx"');
    expectIssue((r) => (r.events[0].impulseOutcomes[2].effects[0].target = "enemy"), "events.json", "[0].impulseOutcomes[2].effects[0].target: expected one of actor|party|others");
    expectIssue((r) => (r.events[0].impulseOutcomes[0].impulseBonus[0].type = "fly"), "events.json", "[0].impulseOutcomes[0].impulseBonus[0].type");
  });
  test("data: EV-32 item 効果は itemId と table のどちらか一方", () => {
    const msg = "[0].choices[0].effects[0]: EV-32: item effect needs exactly one of itemId or table";
    expectIssue((r) => (r.events[0].choices[0].effects[0] = { type: "item", itemId: "herb", table: "t1" }), "events.json", msg);
    expectIssue((r) => (r.events[0].choices[0].effects[0] = { type: "item" }), "events.json", msg);
    expect(issuesOf((r) => (r.events[0].choices[0].effects[0] = { type: "item", itemId: "herb" }))).toEqual([]);
    expect(issuesOf((r) => (r.events[0].choices[0].effects[0] = { type: "item", table: "t1" }))).toEqual([]);
  });
  test("data: EV-30 EV-31 衝動の結果", () => {
    expectIssue((r) => (r.events[0].impulseOutcomes[0].weight = 0), "events.json", "[0].impulseOutcomes[0].weight: expected integer >= 1");
    expectIssue((r) => (r.events[0].impulseOutcomes[0].requires = "choice"), "events.json", "[0].impulseOutcomes[0].requires");
  });
  test("data: 選択肢の id はイベント内で一意", () => {
    expectIssue((r) => (r.events[0].choices[1].id = "examine"), "events.json", '[0].choices[1].id: duplicate id "examine"');
  });
  test("data: EV-01 mixed には選択肢が要る", () => {
    expectIssue((r) => (r.events[0].choices = []), "events.json", "EV-01");
  });
  test("data: EV-01 impulse と mixed には衝動の結果が要り、choice は空でよい", () => {
    expect(issuesOf((r) => {
      r.events[0].kind = "choice";
      r.events[0].impulseOutcomes = [];
    })).toEqual([]);
    expectIssue(
      (r) => {
        r.events[0].kind = "impulse";
        r.events[0].impulseOutcomes = [];
      },
      "events.json",
      '[0].impulseOutcomes: EV-01: kind "impulse" needs at least 1 impulse outcome',
    );
    expectIssue((r) => (r.events[0].impulseOutcomes = []), "events.json", '[0].impulseOutcomes: EV-01: kind "mixed" needs at least 1 impulse outcome');
    // choice でも impulseOutcomes 自体は必須（空配列を書く）
    expectIssue((r) => {
      r.events[0].kind = "choice";
      delete r.events[0].impulseOutcomes;
    }, "events.json", "[0].impulseOutcomes: missing required field");
  });
});

describe("data: strings.json", () => {
  test("data: 値は空でない文字列", () => {
    expectIssue((r) => (r.strings["gm.test"] = 3), "strings.json", "gm.test: expected string, got integer");
  });
  test("data: プレースホルダの書式", () => {
    expectIssue((r) => (r.strings["gm.test"] = "{name さん"), "strings.json", "gm.test: malformed placeholder");
  });
  test("data: battle.status.<StatusId> がそろう", () => {
    expectIssue((r) => delete r.strings["battle.status.stone"], "strings.json", "battle.status.stone");
  });
});

describe("data: エラー報告", () => {
  test("data: 複数ファイルの問題が一度にすべて報告される", () => {
    const issues = issuesOf((r) => {
      r.config.ui.flashMs = -1;
      r.races[0].name = 1;
      r.spells[0].mp = 1.5;
      r.monsters[0].hp = "zz";
      r.items[0].price = -1;
      r.dungeons[0].floors = "2";
      r.events[0].stat = "wis";
    });
    for (const file of ["config.json", "races.json", "spells.json", "monsters.json", "items.json", "dungeons.json", "events.json"]) {
      expect(issues.some((s) => s.startsWith(`${file}: `)), file).toBe(true);
    }
    expect(issues.length).toBeGreaterThanOrEqual(7);
  });

  test("data: GameDataError のメッセージに件数と先頭の問題が入る", () => {
    const r = rawData();
    r.monsters[3].hp = 12;
    r.spells[0].mp = -1;
    let err: unknown;
    try {
      loadGameData(r);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(GameDataError);
    const ge = err as GameDataError;
    expect(ge.name).toBe("GameDataError");
    expect(ge.issues).toHaveLength(2);
    expect(ge.message).toContain("2 issue(s)");
    expect(ge.message).toContain("monsters.json: [3].hp");
  });

  test("data: 問題が多いときメッセージは先頭だけで、issues は全件", () => {
    // 6 体 × 2 フィールド = 12 件
    const r = rawData();
    for (const m of r.monsters) {
      m.hp = 0;
      m.gold = 0;
    }
    let err: GameDataError | undefined;
    try {
      loadGameData(r);
    } catch (e) {
      err = e as GameDataError;
    }
    expect(err?.issues).toHaveLength(12);
    expect(err?.message).toContain("12 issue(s)");
    expect(err?.message).toContain("... and 2 more");
    expect(err?.message).not.toContain("monsters.json: [5].gold");
  });

  test("data: トップレベルが壊れていても GameDataError になる", () => {
    const nulls = Object.fromEntries(Object.keys(DATA_FILES).map((k) => [k, null])) as unknown as RawGameData;
    expect(() => loadGameData(nulls)).toThrow(GameDataError);
    const wrong = { ...rawData(), config: [], races: {}, penaltyTable: [], strings: [] as unknown[], dungeons: "x" };
    const issues = issuesOf((r) => Object.assign(r, wrong));
    expect(issues).toEqual(
      expect.arrayContaining([
        "config.json: (root): expected object, got array",
        "races.json: (root): expected array, got object",
        "penalty-table.json: (root): expected object, got array",
        "strings.json: (root): expected object, got array",
        "dungeons.json: (root): expected array, got string",
      ]),
    );
    expect(() => loadGameData(null as unknown as RawGameData)).toThrow(GameDataError);
    // 要素が null や配列でも落ちない
    expect(() => loadGameData({ ...rawData(), items: [null, [], 1], events: [null], monsters: [{}] })).toThrow(GameDataError);
  });
});

// ---------------------------------------------------------------------------
// 検証の網羅性（恒久テスト）。実データのすべての値（葉と、配列・オブジェクト自身）を別の JSON 型に
// 差し替えると検出されること、すべてのオブジェクトに未知のキーを足すと検出されることを機械的に確かめる。

type Path = (string | number)[];

/** v 以下のすべての値のパス（v 自身の [] を含む）。 */
function allPaths(v: unknown, base: Path = []): Path[] {
  const out: Path[] = [base];
  if (Array.isArray(v)) v.forEach((e, i) => out.push(...allPaths(e, [...base, i])));
  else if (typeof v === "object" && v !== null) for (const [k, e] of Object.entries(v)) out.push(...allPaths(e, [...base, k]));
  return out;
}

function getAt(v: any, path: Path): any {
  return path.reduce((cur, k) => cur[k], v);
}

/** 別の JSON 型の値。数値→"x"、文字列→123、真偽→"x"、null→123、配列→"x"、オブジェクト→"x"。 */
function otherType(v: unknown): unknown {
  if (typeof v === "string" || v === null) return 123;
  return "x";
}

function showPath(file: string, path: Path): string {
  return file + path.map((k) => (typeof k === "number" ? `[${k}]` : `.${k}`)).join("");
}

/** 型を変えても正当なままの値。キーは showPath() の形。除外は最小限にし、理由を書く。 */
const TYPE_SWAP_EXEMPT: ReadonlyMap<string, string> = new Map<string, string>([]);

describe("data: 検証の網羅性", () => {
  const files = Object.keys(DATA_FILES) as (keyof RawGameData)[];

  test("data: 実データの全ての値を別の JSON 型に差し替えると、そのファイルの issue になる", () => {
    const missed: string[] = [];
    let checked = 0;
    for (const key of files) {
      const file = DATA_FILES[key];
      const src = rawData();
      for (const path of allPaths(src[key])) {
        const name = showPath(file, path);
        if (TYPE_SWAP_EXEMPT.has(name)) continue;
        const before = getAt(src[key], path);
        const after = otherType(before);
        const issues = issuesOf((r) => {
          if (path.length === 0) r[key] = after;
          else getAt(r[key], path.slice(0, -1))[path[path.length - 1]!] = after;
        });
        checked++;
        if (!issues.some((s) => s.startsWith(`${file}: `)))
          missed.push(`${name} (${JSON.stringify(before)} -> ${JSON.stringify(after)})`);
      }
    }
    expect(checked).toBeGreaterThan(1000);
    expect(missed, `not detected:\n${missed.join("\n")}`).toEqual([]);
  });

  test("data: 実データの全てのオブジェクトに未知のキーを足すと、そのファイルの issue になる", () => {
    const missed: string[] = [];
    let checked = 0;
    for (const key of files) {
      const file = DATA_FILES[key];
      const src = rawData();
      for (const path of allPaths(src[key])) {
        const v = getAt(src[key], path);
        if (typeof v !== "object" || v === null || Array.isArray(v)) continue;
        // strings.json のトップレベルは任意のキーを持てる（キー自体が文言の id）
        if (key === "strings" && path.length === 0) continue;
        const issues = issuesOf((r) => {
          getAt(r[key], path).__unknownKey__ = 1;
        });
        checked++;
        if (!issues.some((s) => s.startsWith(`${file}: `) && s.includes("__unknownKey__")))
          missed.push(showPath(file, path));
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect(missed, `not detected:\n${missed.join("\n")}`).toEqual([]);
  });

  test("data: 網羅性テストの除外リストは実データに存在するパスだけを指す", () => {
    const all = new Set<string>();
    const raw = rawData();
    for (const key of Object.keys(DATA_FILES) as (keyof RawGameData)[])
      for (const path of allPaths(raw[key])) all.add(showPath(DATA_FILES[key], path));
    expect([...TYPE_SWAP_EXEMPT.keys()].filter((k) => !all.has(k))).toEqual([]);
  });
});
