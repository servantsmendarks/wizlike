// UI-66 / UI-63: 出来事と曲・効果音の対応（src/presenter/sound-cues.ts。純粋）。data/audio.json の cues と screenSongs を使う。
import { describe, expect, it } from "vitest";
import type { EnemyGroupView, GameEvent } from "../src/core/types";
import { sceneSong, songAt, soundsFor } from "../src/presenter/sound-cues";
import { data } from "./helpers/core";

const group = (monsterId: string, index = 0): EnemyGroupView => ({ index, monsterId, name: monsterId, identified: true, count: 1 });
const bossId = data.monsters.find((m) => m.special.boss === true)?.id ?? "";
const normalId = data.monsters.find((m) => m.special.boss !== true)?.id ?? "";

describe("UI-66 soundsFor", () => {
  const cases: [string, GameEvent, ReturnType<typeof soundsFor>][] = [
    ["勝利で victory", { kind: "battleEnd", result: "win" }, [{ type: "jingle", name: "victory" }]],
    ["逃走では鳴らない", { kind: "battleEnd", result: "flee" }, []],
    ["全滅の battleEnd では鳴らない（wipe で鳴る）", { kind: "battleEnd", result: "wipe" }, []],
    [
      "levelUp で levelup",
      { kind: "levelUp", id: "m1", level: 2, hpMax: 10, mpMax: 0, hp: 10, mp: 0 } as unknown as GameEvent,
      [{ type: "jingle", name: "levelup" }],
    ],
    ["wipe で wipe", { kind: "wipe", penalty: {} } as unknown as GameEvent, [{ type: "jingle", name: "wipe" }]],
    ["宿（town.inn.stay）で inn", { kind: "message", key: "town.inn.stay" }, [{ type: "jingle", name: "inn" }]],
    ["敵への命中で hit", { kind: "attack", actorId: "m1", targetId: "e0-1", hit: true, damage: 3 }, [{ type: "sfx", name: "hit" }]],
    ["敵への外れは無し", { kind: "attack", actorId: "m1", targetId: "e0-1", hit: false, damage: 0 }, []],
    ["味方への攻撃は無し", { kind: "attack", actorId: "e0-0", targetId: "m1", hit: true, damage: 3 }, []],
    ["味方の hpChanged の減少で damage", { kind: "hpChanged", id: "m1", delta: -3, hp: 5 }, [{ type: "sfx", name: "damage" }]],
    ["味方の回復は無し", { kind: "hpChanged", id: "m1", delta: 3, hp: 8 }, []],
    ["敵の減少は無し", { kind: "hpChanged", id: "e1-0", delta: -3, hp: 2 }, []],
    ["spell で spell", { kind: "spell", actorId: "m1", spellId: "x", targets: [] }, [{ type: "sfx", name: "spell" }]],
    ["dungeon.door で door", { kind: "message", key: "dungeon.door" }, [{ type: "sfx", name: "door" }]],
    [
      "floorChanged で stairs",
      { kind: "floorChanged", floor: 2, pos: { x: 0, y: 0 }, facing: "N" } as unknown as GameEvent,
      [{ type: "sfx", name: "stairs" }],
    ],
    ["落とし穴で trap", { kind: "message", key: "dungeon.trap.pit" }, [{ type: "sfx", name: "trap" }]],
    ["回転床で trap", { kind: "message", key: "dungeon.trap.spinner" }, [{ type: "sfx", name: "trap" }]],
    ["転移で trap", { kind: "message", key: "dungeon.trap.teleport" }, [{ type: "sfx", name: "trap" }]],
    ["ほかの message は無し", { kind: "message", key: "town.inn.title" }, []],
    ["blocked は無し", { kind: "blocked" }, []],
  ];
  for (const [name, ev, want] of cases) {
    it(`UI-66 soundsFor: ${name}`, () => {
      expect(soundsFor(ev, data)).toEqual(want);
    });
  }

  it("UI-66 audio.json の罠の 3 キーは strings.json にある（core の dungeon.trap.<id>）", () => {
    for (const k of ["dungeon.trap.pit", "dungeon.trap.spinner", "dungeon.trap.teleport", "dungeon.door", "town.inn.stay"]) {
      expect(data.strings[k]).toBeTypeOf("string");
    }
  });

  it("UI-66 screen battle → battle、encounter にボス（special.boss）がいれば boss、いなければ battle", () => {
    expect(soundsFor({ kind: "screen", to: "battle" }, data)).toEqual([{ type: "song", name: "battle" }]);
    expect(soundsFor({ kind: "encounter", groups: [group(normalId), group(bossId, 1)] }, data)).toEqual([{ type: "song", name: "boss" }]);
    expect(soundsFor({ kind: "encounter", groups: [group(normalId)] }, data)).toEqual([{ type: "song", name: "battle" }]);
  });

  it("UI-66 screen town / dungeon / title は場面の曲、event は何もしない（今の曲のまま）", () => {
    expect(soundsFor({ kind: "screen", to: "town" }, data)).toEqual([{ type: "song", name: "town" }]);
    expect(soundsFor({ kind: "screen", to: "dungeon" }, data)).toEqual([{ type: "song", name: "dungeon" }]);
    expect(soundsFor({ kind: "screen", to: "title" }, data)).toEqual([{ type: "song", name: "title" }]);
    expect(soundsFor({ kind: "screen", to: "event" }, data)).toEqual([]);
  });

  it("UI-66 1 つの出来事に当たる cue はすべて返す（上から順）", () => {
    const d = {
      ...data,
      audio: {
        ...data.audio,
        cues: [...data.audio.cues, { event: "spell" as const, sfx: "ok" }],
      },
    };
    expect(soundsFor({ kind: "spell", actorId: "m1", spellId: "x", targets: [] }, d)).toEqual([
      { type: "sfx", name: "spell" },
      { type: "sfx", name: "ok" },
    ]);
  });
});

describe("UI-63 sceneSong", () => {
  it("UI-63 sceneSong: title/town/dungeon/battle は screenSongs、event は undefined、boss の敵がいれば bossSong", () => {
    expect(bossId).not.toBe("");
    expect(sceneSong("title", [], data)).toBe("title");
    expect(sceneSong("town", [], data)).toBe("town");
    expect(sceneSong("dungeon", [], data)).toBe("dungeon");
    expect(sceneSong("battle", [normalId], data)).toBe("battle");
    expect(sceneSong("battle", [normalId, bossId], data)).toBe("boss");
    expect(sceneSong("event", [], data)).toBeUndefined();
    // battle 以外の画面ではボスを見ない
    expect(sceneSong("dungeon", [bossId], data)).toBe("dungeon");
    // 未知の monsterId は無視
    expect(sceneSong("battle", ["no_such_monster"], data)).toBe("battle");
  });
});

describe("UI-63 / SV-50 songAt（screen イベントの来ない場面: 続きから・タイトル）", () => {
  it("UI-63 songAt: 保存した画面の曲。event は迷宮の画面の上なので dungeon の曲、battle はボスを見る", () => {
    expect(songAt("town", [], data)).toBe("town");
    expect(songAt("dungeon", [], data)).toBe("dungeon");
    expect(songAt("event", [], data)).toBe("dungeon");
    expect(songAt("battle", [normalId], data)).toBe("battle");
    expect(songAt("battle", [bossId], data)).toBe("boss");
    expect(songAt("title", [], data)).toBe("title");
  });
});
