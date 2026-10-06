import { describe, expect, test } from "vitest";
import { collectAssets, formatIssue, formatIssues, type AssetFiles } from "../src/build/assets";
import { pngSize } from "../src/build/png";
import { data } from "./helpers/core";
import { conformingSong, songParts, buildSong } from "./helpers/midi";

const EMPTY: AssetFiles = { music: [], sfx: [], sprites: [], town: [] };

/** 署名と IHDR だけの PNG（CRC と画素は見ないので 0 で埋める） */
function png(w: number, h: number): Uint8Array {
  const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...u32(13), 0x49, 0x48, 0x44, 0x52, ...u32(w), ...u32(h), 8, 3, 0, 0, 0, 0, 0, 0, 0,
    ...u32(0), 0x49, 0x45, 0x4e, 0x44, 0, 0, 0, 0,
  ]);
}

describe("UI-60 pngSize", () => {
  test("UI-60 pngSize: 署名と IHDR の幅・高さ。不正なら null", () => {
    expect(pngSize(png(48, 48))).toEqual({ w: 48, h: 48 });
    expect(pngSize(png(96, 64))).toEqual({ w: 96, h: 64 });
    expect(pngSize(new Uint8Array())).toBeNull();
    expect(pngSize(png(48, 48).slice(0, 20))).toBeNull();
    const badSig = png(48, 48);
    badSig[1] = 0;
    expect(pngSize(badSig)).toBeNull();
    const notIhdr = png(48, 48);
    notIhdr[12] = 0x58;
    expect(pngSize(notIhdr)).toBeNull();
    expect(pngSize(png(0, 48))).toBeNull();
  });
});

describe("UI-63 / UI-65 / UI-60 collectAssets", () => {
  test("UI-63/UI-65/UI-60 collectAssets: 空なら空の GameAssets でエラーも警告も無い（ファイルが無い間は無音で動く）", () => {
    expect(collectAssets(EMPTY, data)).toEqual({ assets: { music: {}, sfx: {}, sprites: {}, town: {} }, errors: [], warnings: [] });
  });
  test("UI-63 collectAssets: 規約どおりの曲と効果音と絵を名前で引けるようにする（拡張子は大文字でもよい）", () => {
    const r = collectAssets(
      {
        music: [
          { name: "town.mid", bytes: conformingSong() },
          { name: "victory.MID", bytes: conformingSong({ kind: "jingle" }) },
        ],
        sfx: [{ name: "hit.json", text: '{ "name": "hit", "params": [null, 0.05, 220] }' }],
        sprites: [
          { name: "giant_rat.png", bytes: png(48, 48) },
          { name: "gatekeeper_armor.png", bytes: png(96, 96) },
        ],
        town: [{ name: "inn.png", bytes: png(240, 150) }],
      },
      data,
    );
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(Object.keys(r.assets.music).sort()).toEqual(["town", "victory"]);
    expect(r.assets.music.town).toMatchObject({ name: "town", kind: "song", bars: 2 });
    expect(r.assets.music.victory).toMatchObject({ name: "victory", kind: "jingle", loop: null });
    expect(r.assets.sfx).toEqual({ hit: { name: "hit", params: [null, 0.05, 220] } });
    expect(r.assets.sprites).toEqual({ giant_rat: { w: 48, h: 48 }, gatekeeper_armor: { w: 96, h: 96 } });
    expect(r.assets.town).toEqual({ inn: { w: 240, h: 150 } });
  });
  test("UI-64 collectAssets: 止めるものがあればそのファイルは assets に入れない（E02 読めない MIDI、E01 名前が無い曲）", () => {
    const p = songParts();
    p.format = 0;
    const r = collectAssets(
      {
        ...EMPTY,
        music: [
          { name: "town.mid", bytes: new Uint8Array([1, 2, 3]) },
          { name: "credits.mid", bytes: conformingSong() },
          { name: "battle1.mid", bytes: buildSong(p) },
          { name: "dungeon1.mid", bytes: conformingSong() },
        ],
      },
      data,
    );
    expect(r.errors.map((e) => [e.file, e.id])).toEqual([
      ["assets/music/battle1.mid", "L01"],
      ["assets/music/credits.mid", "E01"],
      ["assets/music/town.mid", "E02"],
    ]);
    expect(Object.keys(r.assets.music)).toEqual(["dungeon1"]);
  });
  test("UI-65 collectAssets: 効果音の止めるもの（S01〜S09）はそのファイルを入れない", () => {
    const r = collectAssets({ ...EMPTY, sfx: [{ name: "door.json", text: "{" }, { name: "ok.json", text: '{ "name": "ok", "params": [] }' }] }, data);
    expect(r.errors.map((e) => [e.file, e.id])).toEqual([["assets/sfx/door.json", "S01"]]);
    expect(Object.keys(r.assets.sfx)).toEqual(["ok"]);
  });
  test("UI-64/W07 assets/music の .mid 以外、assets/sfx の .json 以外のファイルは警告して無視する", () => {
    const r = collectAssets(
      { music: [{ name: "town.txt", bytes: new Uint8Array() }], sfx: [{ name: "hit.wav", text: "" }], sprites: [], town: [] },
      data,
    );
    expect(r.errors).toEqual([]);
    expect(r.warnings.map((w) => [w.file, w.id])).toEqual([
      ["assets/music/town.txt", "W07"],
      ["assets/sfx/hit.wav", "W07"],
    ]);
    expect(r.assets).toEqual({ music: {}, sfx: {}, sprites: {}, town: {} });
  });
  test("UI-60 collectAssets: png の一覧は名前と大きさ。P01 不正な PNG は止める、P02 正方形でないのは警告（一覧には入れる）、P03 名前が [a-z0-9_] でない .png は一覧に入れない", () => {
    const r = collectAssets(
      {
        ...EMPTY,
        sprites: [
          { name: "kobold.png", bytes: png(48, 48) },
          { name: "broken.png", bytes: new Uint8Array([0x89, 0x50]) },
          { name: "wide.png", bytes: png(64, 48) },
          { name: "Kobold-2.png", bytes: png(48, 48) },
          { name: "readme.txt", bytes: new Uint8Array() },
        ],
      },
      data,
    );
    expect(r.errors.map((e) => [e.file, e.id])).toEqual([["public/sprites/broken.png", "P01"]]);
    expect(r.warnings.map((e) => [e.file, e.id])).toEqual([
      ["public/sprites/Kobold-2.png", "P03"],
      ["public/sprites/wide.png", "P02"],
    ]);
    expect(r.assets.sprites).toEqual({ kobold: { w: 48, h: 48 }, wide: { w: 64, h: 48 } });
  });
  test("UI-61 collectAssets: public/town は 240×150 の PNG だけ一覧に入る。P01 は止める、P03（名前）・P04（240×150 でない）は警告して一覧に入れない、PNG 以外は見ない", () => {
    const r = collectAssets(
      {
        ...EMPTY,
        town: [
          { name: "inn.png", bytes: png(240, 150) },
          { name: "temple.PNG", bytes: png(240, 150) },
          { name: "broken.png", bytes: new Uint8Array([0x89, 0x50]) },
          { name: "shop.png", bytes: png(240, 160) },
          { name: "Gate-1.png", bytes: png(240, 150) },
          { name: "notes.txt", bytes: new Uint8Array() },
        ],
      },
      data,
    );
    expect(r.errors.map((e) => [e.file, e.id])).toEqual([["public/town/broken.png", "P01"]]);
    expect(r.warnings.map((e) => [e.file, e.id])).toEqual([
      ["public/town/Gate-1.png", "P03"],
      ["public/town/shop.png", "P04"],
    ]);
    expect(r.assets.town).toEqual({ inn: { w: 240, h: 150 }, temple: { w: 240, h: 150 } });
    expect(r.assets.sprites).toEqual({});
    expect(formatIssues(r)).toContain("warning: public/town/shop.png: UI-61/P04 town picture must be 240x150 (240x160, not listed)");
  });
  test("UI-64 formatIssues の形: 「ファイル: UI-64/L11 理由」、警告は先頭に warning:", () => {
    const p = songParts();
    p.tracks[1]!.evs.push({ t: 0, bytes: [0xb0, 7, 1] });
    const r = collectAssets(
      {
        music: [
          { name: "town.mid", bytes: new Uint8Array([0]) },
          { name: "title.mid", bytes: buildSong(p) },
        ],
        sfx: [{ name: "x.json", text: "[]" }],
        sprites: [{ name: "a.png", bytes: new Uint8Array() }],
        town: [{ name: "inn.png", bytes: new Uint8Array() }],
      },
      data,
    );
    const lines = formatIssues(r);
    expect(lines[0]).toMatch(/^assets\/music\/town\.mid: UI-64\/E02 /);
    expect(lines).toContain("assets/sfx/x.json: UI-65/S02 content must be an object, got array");
    expect(lines.some((l) => l.startsWith("public/sprites/a.png: UI-60/P01 "))).toBe(true);
    expect(lines.some((l) => l.startsWith("public/town/inn.png: UI-61/P01 "))).toBe(true);
    expect(lines.at(-1)).toBe("warning: assets/music/title.mid: UI-64/W03 ignored events: controlChange x 1");
    expect(formatIssue({ file: "f", id: "G01", message: "m" })).toBe("f: UI-64/G01 m");
  });
  test("UI-64 collectAssets: 同じ入力から同じ結果（ファイルの順に依らない）", () => {
    const files: AssetFiles = {
      music: [
        { name: "town.mid", bytes: conformingSong() },
        { name: "battle1.mid", bytes: conformingSong() },
      ],
      sfx: [],
      sprites: [{ name: "b.png", bytes: png(48, 48) }, { name: "a.png", bytes: png(48, 48) }],
      town: [{ name: "shop.png", bytes: png(240, 150) }, { name: "inn.png", bytes: png(240, 150) }],
    };
    const rev: AssetFiles = {
      music: [...files.music].reverse(),
      sfx: [],
      sprites: [...files.sprites].reverse(),
      town: [...files.town].reverse(),
    };
    expect(JSON.stringify(collectAssets(rev, data))).toBe(JSON.stringify(collectAssets(files, data)));
  });
});
