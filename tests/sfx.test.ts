import { describe, expect, test } from "vitest";
import { checkSfx } from "../src/build/sfx";
import { data } from "./helpers/core";

const FILE = "assets/sfx/hit.json";
const run = (text: string, stem = "hit") => checkSfx(FILE, stem, text, data.audio);
const ids = (text: string, stem = "hit"): string[] => run(text, stem).errors.map((e) => e.id);

describe("UI-65 効果音 JSON の検証（工房の sfx_render.validate_sfx_json / validate_params と同じ）", () => {
  test("UI-65 規約どおりの効果音は SfxData に。null と末尾の省略はそのまま残す（null → undefined は再生側）", () => {
    const r = run('{ "name": "hit", "params": [null, 0.05, 220, null, null, 0.1] }');
    expect(r.errors).toEqual([]);
    expect(r.sfx).toEqual({ name: "hit", params: [null, 0.05, 220, null, null, 0.1] });
    expect(run('{ "name": "hit", "params": [] }').sfx).toEqual({ name: "hit", params: [] });
  });
  test("UI-65/S01 JSON として読めなければ止める", () => {
    expect(ids("{ name: hit }")).toEqual(["S01"]);
    expect(run("{").sfx).toBeNull();
  });
  test("UI-65/S02 中身がオブジェクトでなければ止める", () => {
    expect(ids("[1, 2]")).toEqual(["S02"]);
    expect(ids("null")).toEqual(["S02"]);
    expect(ids('"hit"')).toEqual(["S02"]);
  });
  test("UI-65/S03 name がファイル名と違えば止める", () => {
    expect(ids('{ "name": "hits", "params": [] }')).toEqual(["S03"]);
    expect(ids('{ "params": [] }')).toEqual(["S03"]);
  });
  test("UI-65/S04 名前が audio.json の sfx.names に無ければ止める", () => {
    expect(ids('{ "name": "boom", "params": [] }', "boom")).toEqual(["S04"]);
  });
  test("UI-65/S05 params が無ければ止める", () => {
    expect(ids('{ "name": "hit" }')).toEqual(["S05"]);
  });
  test("UI-65/S06 params が配列でなければ止める", () => {
    expect(ids('{ "name": "hit", "params": { "0": 1 } }')).toEqual(["S06"]);
    expect(ids('{ "name": "hit", "params": null }')).toEqual(["S06"]);
  });
  test("UI-65/S07 params が 21 個を超えれば止める（21 個は通る）", () => {
    expect(ids(JSON.stringify({ name: "hit", params: Array(22).fill(0) }))).toEqual(["S07"]);
    expect(ids(JSON.stringify({ name: "hit", params: Array(21).fill(0) }))).toEqual([]);
  });
  test("UI-65/S08 params の要素が数値でも null でもなければ止める（真偽値も不可）", () => {
    expect(ids('{ "name": "hit", "params": [1, true] }')).toEqual(["S08"]);
    expect(ids('{ "name": "hit", "params": ["1"] }')).toEqual(["S08"]);
    expect(ids('{ "name": "hit", "params": [[1]] }')).toEqual(["S08"]);
  });
  test("UI-65/S09 params の要素が有限でなければ止める（JSON では書けないが同じく見る）", () => {
    // JSON の 1e999 は Infinity になる
    expect(ids('{ "name": "hit", "params": [1e999] }')).toEqual(["S09"]);
  });
  test("UI-65 止めるものはファイル名を持ち、複数あれば全部返す", () => {
    const r = run('{ "name": "hits", "params": [false, 1, "x"] }');
    expect(r.errors.map((e) => [e.file, e.id])).toEqual([
      [FILE, "S03"],
      [FILE, "S08"],
      [FILE, "S08"],
    ]);
    expect(r.errors[1]!.message).toContain("params[0]");
  });
});
