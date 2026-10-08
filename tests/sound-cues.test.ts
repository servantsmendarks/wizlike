// UI-66 / UI-63: 出来事と曲・効果音の対応（src/presenter/sound-cues.ts。純粋）。data/audio.json の cues・screenSongs・battleSongs・
// bossSong・facilitySongs・campSong と dungeons[].song を使う。
import { describe, expect, it } from "vitest";
import { AUDIO_FACILITIES } from "../src/core/data/index";
import type { EnemyGroupView, GameEvent } from "../src/core/types";
import {
  battleSong,
  campSong,
  dungeonSong,
  INITIAL_SOUND_CONTEXT,
  nextSoundContext,
  resumeSoundContext,
  sceneSong,
  songAt,
  soundsFor,
  startSoundPlayback,
  townSong,
  type SoundContext,
} from "../src/presenter/sound-cues";
import { TOWN_PICTURE_IDS } from "../src/presenter/views/town-picture";
import { data, loadFreshData } from "./helpers/core";

const group = (monsterId: string, index = 0): EnemyGroupView => ({ index, monsterId, name: monsterId, identified: true, count: 1 });
const bossId = data.monsters.find((m) => m.special.boss === true)?.id ?? "";
const normalId = data.monsters.find((m) => m.special.boss !== true)?.id ?? "";
const BOSS_CTX: SoundContext = { boss: true, encounters: 0, beatSfx: [] };

describe("UI-66 soundsFor", () => {
  const cases: [string, GameEvent, ReturnType<typeof soundsFor>][] = [
    ["勝利（ボスでない戦闘）で victory", { kind: "battleEnd", result: "win" }, [{ type: "jingle", name: "victory" }]],
    ["逃走で flee", { kind: "battleEnd", result: "flee" }, [{ type: "sfx", name: "flee" }]],
    ["全滅の battleEnd では鳴らない（wipe で鳴る）", { kind: "battleEnd", result: "wipe" }, []],
    [
      "levelUp で levelup",
      { kind: "levelUp", id: "m1", level: 2, hpMax: 10, mpMax: 0, hp: 10, mp: 0 } as unknown as GameEvent,
      [{ type: "jingle", name: "levelup" }],
    ],
    ["wipe で wipe", { kind: "wipe", penalty: {} } as unknown as GameEvent, [{ type: "jingle", name: "wipe" }]],
    ["宿（town.inn.stay）で inn", { kind: "message", key: "town.inn.stay" }, [{ type: "jingle", name: "inn" }]],
    ["敵への命中で hit", { kind: "attack", actorId: "m1", targetId: "e0-1", hit: true, damage: 3 }, [{ type: "sfx", name: "hit" }]],
    ["敵への外れで miss", { kind: "attack", actorId: "m1", targetId: "e0-1", hit: false, damage: 0 }, [{ type: "sfx", name: "miss" }]],
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
    ["blocked（壁）で wall", { kind: "blocked" }, [{ type: "sfx", name: "wall" }]],
    ["ボス撃破の語りで clear", { kind: "message", key: "battle.bossDefeated", params: { boss: "x" } }, [{ type: "jingle", name: "clear" }]],
    ["UI-63/TW-34 結末の締めの語りの 1 行目で clear（M12）", { kind: "message", key: "ending.speech.1" }, [{ type: "jingle", name: "clear" }]],
    ["TW-34 締めの語りの 2 行目以降は無し", { kind: "message", key: "ending.speech.2" }, []],
    [
      "TW-34 戦績の出来事（ending）は無し",
      {
        kind: "ending",
        record: { dives: 1, battles: 1, deaths: 0, ashes: 0, wipes: 0, turns: 1, bestiary: { known: 0, total: 1 }, uniques: { known: 0, total: 1 } },
      },
      [],
    ],
    [
      "司教の鑑定で identify",
      { kind: "message", key: "camp.identified", params: { name: "a", old: "b", item: "c", rarity: "rare" } },
      [{ type: "sfx", name: "identify" }],
    ],
    [
      "司教の鑑定で伝説の品なら rare と identify",
      { kind: "message", key: "camp.identified", params: { name: "a", old: "b", item: "c", rarity: "legendary" } },
      [
        { type: "jingle", name: "rare" },
        { type: "sfx", name: "identify" },
      ],
    ],
    [
      "店の鑑定で伝説の品なら rare と identify",
      { kind: "message", key: "town.shop.identified", params: { name: "a", old: "b", item: "c", cost: 10, rarity: "legendary" } },
      [
        { type: "jingle", name: "rare" },
        { type: "sfx", name: "identify" },
      ],
    ],
    [
      "店の鑑定で通常の品は identify だけ",
      { kind: "message", key: "town.shop.identified", params: { name: "a", old: "b", item: "c", cost: 10, rarity: "normal" } },
      [{ type: "sfx", name: "identify" }],
    ],
    // M11（CB-60）: 宝箱の契機は見つけたとき（chestFound。ドロップの箱と宝箱のセル）。中身の語り chest.open.gold では鳴らさない
    ["宝箱（ドロップ）を見つけて chest", { kind: "chestFound", source: "drop" }, [{ type: "sfx", name: "chest" }]],
    ["宝箱（セル）を見つけて chest", { kind: "chestFound", source: "cell" }, [{ type: "sfx", name: "chest" }]],
    ["宝箱の中身の語りは無し", { kind: "message", key: "chest.open.gold", params: { gold: 3 } }, []],
    ["買うで gold", { kind: "message", key: "town.shop.bought" }, [{ type: "sfx", name: "gold" }]],
    ["売るで gold", { kind: "message", key: "town.shop.sold" }, [{ type: "sfx", name: "gold" }]],
    ["買い戻すで gold", { kind: "message", key: "town.shop.boughtBack" }, [{ type: "sfx", name: "gold" }]],
    [
      "全滅の 2d10 で dice",
      { kind: "dice", label: { key: "dice.wipe" }, rows: [], rule: { key: "x" }, result: { key: "y" } },
      [{ type: "sfx", name: "dice" }],
    ],
    ["ほかの判定の箱は無し", { kind: "dice", label: { key: "dice.restrain" }, rows: [], rule: { key: "x" }, result: { key: "y" } }, []],
    ["味方の SAN の減少で san", { kind: "sanChanged", id: "m1", delta: -3, san: 40 }, [{ type: "sfx", name: "san" }]],
    ["SAN の回復は無し", { kind: "sanChanged", id: "m1", delta: 2, san: 42 }, []],
    ["味方が毒を受けて ailment", { kind: "statusChanged", id: "m1", status: "poison", on: true }, [{ type: "sfx", name: "ailment" }]],
    ["味方が麻痺を受けて ailment", { kind: "statusChanged", id: "m1", status: "paralysis", on: true }, [{ type: "sfx", name: "ailment" }]],
    ["味方が眠って ailment", { kind: "statusChanged", id: "m1", status: "sleep", on: true }, [{ type: "sfx", name: "ailment" }]],
    ["味方が石化して ailment", { kind: "statusChanged", id: "m1", status: "stone", on: true }, [{ type: "sfx", name: "ailment" }]],
    ["状態が外れるのは無し", { kind: "statusChanged", id: "m1", status: "sleep", on: false }, []],
    ["敵の状態は無し", { kind: "statusChanged", id: "e0-0", status: "sleep", on: true }, []],
    ["味方の死亡で death", { kind: "lifeChanged", id: "m1", life: "dead" }, [{ type: "sfx", name: "death" }]],
    ["敵の死亡は無し", { kind: "lifeChanged", id: "e0-0", life: "dead" }, []],
    ["呪文の習得で learn", { kind: "spellLearned", id: "m1", spellId: "x", via: "roll" }, [{ type: "sfx", name: "learn" }]],
    ["テレポーターで teleport", { kind: "message", key: "dungeon.teleport" }, [{ type: "sfx", name: "teleport" }]],
    ["強化の成功で upgrade_ok", { kind: "message", key: "town.upgrade.ok" }, [{ type: "sfx", name: "upgrade_ok" }]],
    ["強化の大成功で upgrade_ok", { kind: "message", key: "town.upgrade.great" }, [{ type: "sfx", name: "upgrade_ok" }]],
    ["強化の失敗で upgrade_fail", { kind: "message", key: "town.upgrade.ng" }, [{ type: "sfx", name: "upgrade_fail" }]],
    ["制止の成功で stop", { kind: "message", key: "event.stop.success" }, [{ type: "sfx", name: "stop" }]],
    ["寺院の治療で heal", { kind: "message", key: "town.temple.cured" }, [{ type: "sfx", name: "heal" }]],
    ["寺院の蘇生で heal", { kind: "message", key: "town.temple.resurrectOk" }, [{ type: "sfx", name: "heal" }]],
  ];
  for (const [name, ev, want] of cases) {
    it(`UI-66 soundsFor: ${name}`, () => {
      expect(soundsFor(ev, data)).toEqual(want);
    });
  }

  it("UI-66 audio.json の message と dice の cue のキーは strings.json にある", () => {
    for (const c of data.audio.cues) if (c.key !== undefined) expect(data.strings[c.key], c.key).toBeTypeOf("string");
  });

  it("UI-66 ボス戦の勝利は victory を鳴らさない（clear はボス撃破の語りで鳴る）。逃走はボスかを問わない", () => {
    expect(soundsFor({ kind: "battleEnd", result: "win" }, data, BOSS_CTX)).toEqual([]);
    expect(soundsFor({ kind: "battleEnd", result: "win" }, data, INITIAL_SOUND_CONTEXT)).toEqual([{ type: "jingle", name: "victory" }]);
    expect(soundsFor({ kind: "battleEnd", result: "flee" }, data, BOSS_CTX)).toEqual([{ type: "sfx", name: "flee" }]);
  });

  it("UI-63/UI-66 screen battle は何も求めない。encounter は encounter のジングルの後に戦闘の曲（battleSongs を遭遇の数で巡回 = 今は battle1 だけ、ボスは bossSong = battle2）", () => {
    expect(soundsFor({ kind: "screen", to: "battle" }, data)).toEqual([]);
    const enc = (groups: EnemyGroupView[]): GameEvent => ({ kind: "encounter", groups });
    const jingle = { type: "jingle", name: "encounter" };
    expect(soundsFor(enc([group(normalId)]), data, { boss: false, encounters: 0, beatSfx: [] })).toEqual([jingle, { type: "song", name: "battle1" }]);
    expect(soundsFor(enc([group(normalId)]), data, { boss: false, encounters: 1, beatSfx: [] })).toEqual([jingle, { type: "song", name: "battle1" }]);
    expect(soundsFor(enc([group(normalId)]), data, { boss: false, encounters: 2, beatSfx: [] })).toEqual([jingle, { type: "song", name: "battle1" }]);
    expect(soundsFor(enc([group(normalId), group(bossId, 1)]), data, { boss: false, encounters: 1, beatSfx: [] })).toEqual([jingle, { type: "song", name: "battle2" }]);
  });

  it("UI-63 nextSoundContext: ボスのいない遭遇を数え、ボスかを覚える。ほかの出来事では変えない", () => {
    const enc = (ids: string[]): GameEvent => ({ kind: "encounter", groups: ids.map((id, i) => group(id, i)) });
    let ctx = INITIAL_SOUND_CONTEXT;
    const songs: string[] = [];
    for (const ids of [[normalId], [normalId], [bossId], [normalId]]) {
      const song = soundsFor(enc(ids), data, ctx).find((x) => x.type === "song");
      songs.push(song?.type === "song" ? (song.name ?? "") : "");
      ctx = nextSoundContext(enc(ids), data, ctx);
      expect(ctx.boss).toBe(ids.includes(bossId));
    }
    // 巡回（今の battleSongs は battle1 だけ。ボス戦は battle2 で、数えない）
    expect(songs).toEqual(["battle1", "battle1", "battle2", "battle1"]);
    expect(ctx).toEqual({ boss: false, encounters: 3, beatSfx: [] });
    expect(nextSoundContext({ kind: "battleEnd", result: "win" }, data, ctx)).toBe(ctx);
  });

  it("UI-63 screen town / title は場面の曲、dungeon はダンジョンの song（無ければ screenSongs.dungeon）、event は何もしない（今の曲のまま）", () => {
    expect(soundsFor({ kind: "screen", to: "town" }, data)).toEqual([{ type: "song", name: "town" }]);
    expect(soundsFor({ kind: "screen", to: "dungeon", dungeonId: "d01" }, data)).toEqual([{ type: "song", name: "dungeon1" }]);
    expect(soundsFor({ kind: "screen", to: "dungeon", dungeonId: "d02" }, data)).toEqual([{ type: "song", name: "dungeon2" }]);
    // M12（U-3）: d03 は工房に dungeon3 が来るまで dungeon2
    expect(soundsFor({ kind: "screen", to: "dungeon", dungeonId: "d03" }, data)).toEqual([{ type: "song", name: "dungeon2" }]);
    // song の無いダンジョンは screenSongs.dungeon（M9 までは準備中の d03 で確かめていた。M12 から song を消した合成データ）
    const noSong = loadFreshData();
    delete noSong.dungeons.find((x) => x.id === "d03")!.song;
    expect(soundsFor({ kind: "screen", to: "dungeon", dungeonId: "d03" }, noSong)).toEqual([{ type: "song", name: "dungeon1" }]);
    expect(soundsFor({ kind: "screen", to: "dungeon" }, data)).toEqual([{ type: "song", name: "dungeon1" }]);
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

describe("UI-63 sceneSong ほか", () => {
  it("UI-63 sceneSong: title/town は screenSongs、dungeon はダンジョンの曲、battle は battleSongs（ボスは bossSong）、event は undefined", () => {
    expect(bossId).not.toBe("");
    expect(sceneSong("title", data)).toBe("title");
    expect(sceneSong("town", data)).toBe("town");
    expect(sceneSong("dungeon", data)).toBe("dungeon1");
    expect(sceneSong("dungeon", data, { dungeonId: "d02" })).toBe("dungeon2");
    expect(sceneSong("battle", data, { monsterIds: [normalId] })).toBe("battle1");
    expect(sceneSong("battle", data, { monsterIds: [normalId], battleIndex: 1 })).toBe("battle1");
    expect(sceneSong("battle", data, { monsterIds: [normalId, bossId] })).toBe("battle2");
    expect(sceneSong("event", data)).toBeUndefined();
    // battle 以外の画面ではボスを見ない。未知の monsterId は無視
    expect(sceneSong("dungeon", data, { monsterIds: [bossId] })).toBe("dungeon1");
    expect(sceneSong("battle", data, { monsterIds: ["no_such_monster"] })).toBe("battle1");
  });

  it("UI-63 battleSong / dungeonSong / townSong / campSong", () => {
    expect(battleSong([normalId], 0, data)).toBe("battle1");
    expect(battleSong([normalId], 3, data)).toBe("battle1");
    expect(battleSong([bossId], 1, data)).toBe("battle2");
    expect(battleSong([normalId], 0, { ...data, audio: { ...data.audio, battleSongs: [] } })).toBeUndefined();
    // 2 曲以上なら先頭から巡回する（battleSongs を替えたデータ）
    const two = { ...data, audio: { ...data.audio, battleSongs: ["battle1", "camp"] } };
    expect([0, 1, 2, 3].map((i) => battleSong([normalId], i, two))).toEqual(["battle1", "camp", "battle1", "camp"]);
    expect(dungeonSong("d01", data)).toBe("dungeon1");
    expect(dungeonSong("d02", data)).toBe("dungeon2");
    expect(dungeonSong("no_such", data)).toBe("dungeon1");
    expect(dungeonSong(null, data)).toBe("dungeon1");
    expect(townSong("town", data)).toBe("town");
    expect(townSong("tavern", data)).toBe("tavern");
    expect(townSong("shop", data)).toBe("shop");
    expect(townSong("temple", data)).toBe("temple");
    expect(townSong("dark", data)).toBe("dark");
    // 宿屋は曲を持たない（宿のジングル inn だけ）。入口も街の曲
    expect(townSong("inn", data)).toBe("town");
    expect(townSong("gate", data)).toBe("town");
    expect(campSong(data)).toBe("camp");
  });

  it("UI-63（2026-10-06 判断 4）実データの battleSongs は battle1 の 1 件で、ボスのいない遭遇は何番目でも battle1。ボス戦は battle2", () => {
    expect(data.audio.battleSongs).toEqual(["battle1"]);
    expect(data.audio.bossSong).toBe("battle2");
    for (let i = 0; i < 10; i++) expect(battleSong([normalId], i, data)).toBe("battle1");
    expect(battleSong([normalId, bossId], 0, data)).toBe("battle2");
    let ctx = INITIAL_SOUND_CONTEXT;
    for (let i = 0; i < 5; i++) {
      const ev: GameEvent = { kind: "encounter", groups: [group(normalId)] };
      expect(soundsFor(ev, data, ctx)).toContainEqual({ type: "song", name: "battle1" });
      ctx = nextSoundContext(ev, data, ctx);
    }
    expect(data.audio.music.songs).not.toContain("boss");
  });

  it("UI-63 AUDIO_FACILITIES は表示層の施設の id（townFacility。施設の絵の名前から town と title を除いたもの）と同じ", () => {
    expect([...AUDIO_FACILITIES].sort()).toEqual(TOWN_PICTURE_IDS.filter((x) => x !== "town" && x !== "title").sort());
  });
});

describe("UI-63 / SV-50 songAt と resumeSoundContext（screen イベントの来ない場面: 続きから・タイトル）", () => {
  it("UI-63 songAt: 保存した画面の曲。event は迷宮の画面の上なので迷宮の曲、battle は先頭の battle1（ボスは bossSong = battle2）", () => {
    expect(songAt("town", data)).toBe("town");
    expect(songAt("dungeon", data, { dungeonId: "d02" })).toBe("dungeon2");
    expect(songAt("event", data, { dungeonId: "d02" })).toBe("dungeon2");
    expect(songAt("event", data)).toBe("dungeon1");
    expect(songAt("battle", data, { monsterIds: [normalId], battleIndex: 1 })).toBe("battle1");
    expect(songAt("battle", data, { monsterIds: [bossId] })).toBe("battle2");
    expect(songAt("title", data)).toBe("title");
  });

  it("UI-63 resumeSoundContext: 戦闘中の続きからはその戦闘を 1 つ目の遭遇として数える（次は battleSongs の 2 番目。今は 1 曲なので battle1）。ボス戦は数えずボスを覚える", () => {
    expect(resumeSoundContext("battle", [normalId], data)).toEqual({ boss: false, encounters: 1, beatSfx: [] });
    expect(resumeSoundContext("battle", [bossId], data)).toEqual({ boss: true, encounters: 0, beatSfx: [] });
    expect(resumeSoundContext("dungeon", [], data)).toEqual(INITIAL_SOUND_CONTEXT);
    const next = soundsFor({ kind: "encounter", groups: [group(normalId)] }, data, resumeSoundContext("battle", [normalId], data));
    expect(next).toContainEqual({ type: "song", name: "battle1" });
  });
});

describe("UI-66（2026-10-07）同じ拍の中で同じ効果音は 1 回だけ", () => {
  /** app の sound と同じ回し方で、出来事の列から鳴らすもの（効果音の名前と、ジングルは "jingle:名前"）を集める */
  const run = (events: GameEvent[], start: SoundContext = INITIAL_SOUND_CONTEXT): { heard: string[]; ctx: SoundContext } => {
    let ctx = startSoundPlayback(start);
    const heard: string[] = [];
    for (const ev of events) {
      for (const x of soundsFor(ev, data, ctx)) {
        if (x.type === "sfx") heard.push(x.name);
        else if (x.type === "jingle") heard.push(`jingle:${x.name}`);
      }
      ctx = nextSoundContext(ev, data, ctx);
    }
    return { heard, ctx };
  };
  const ids = ["c1", "c2", "c3", "c4", "c5", "c6"];
  const beat: GameEvent = { kind: "beat", phase: "system", auto: false };

  it("UI-66 全員の sanChanged が 1 拍に 6 つ → san は 1 回", () => {
    const evs: GameEvent[] = ids.map((id) => ({ kind: "sanChanged", id, delta: -2, san: 40 }));
    expect(run(evs).heard).toEqual(["san"]);
    expect(run([beat, ...evs]).heard).toEqual(["san"]);
  });

  it("UI-66 味方の hpChanged の減少が 1 拍に 6 つ → damage は 1 回", () => {
    const evs: GameEvent[] = ids.map((id) => ({ kind: "hpChanged", id, delta: -3, hp: 5 }));
    expect(run([beat, ...evs]).heard).toEqual(["damage"]);
  });

  it("UI-66 拍をまたげばまた鳴る。別の名前は同じ拍でも鳴る", () => {
    const san = (id: string): GameEvent => ({ kind: "sanChanged", id, delta: -1, san: 30 });
    const dmg = (id: string): GameEvent => ({ kind: "hpChanged", id, delta: -1, hp: 3 });
    expect(run([beat, san("c1"), dmg("c1"), san("c2"), dmg("c2"), beat, san("c3"), dmg("c3")]).heard).toEqual([
      "san",
      "damage",
      "san",
      "damage",
    ]);
  });

  it("UI-66 再生の開始（startSoundPlayback）で空にする: 前の再生で鳴った名前も次の再生ではまた鳴る", () => {
    const wall: GameEvent = { kind: "blocked" };
    const first = run([wall, wall]);
    expect(first.heard).toEqual(["wall"]);
    expect(first.ctx.beatSfx).toEqual(["wall"]);
    expect(run([wall], first.ctx).heard).toEqual(["wall"]);
  });

  it("UI-66 ジングルと曲はまとめない（同じ拍の 2 つの levelUp でジングルは 2 回）。戦闘の曲の数え方も変えない", () => {
    const lv = { kind: "levelUp", id: "m1", level: 2, hpMax: 10, mpMax: 0, hp: 10, mp: 0 } as unknown as GameEvent;
    expect(run([beat, lv, lv]).heard).toEqual(["jingle:levelup", "jingle:levelup"]);
    const enc: GameEvent = { kind: "encounter", groups: [group(normalId)] };
    const r = run([enc, beat, enc]);
    expect(r.ctx.encounters).toBe(2);
    expect(r.ctx.boss).toBe(false);
  });
});
