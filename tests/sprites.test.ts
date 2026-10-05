// UI-60（M8）: 絵の選び方と大きさ（src/presenter/sprites.ts。純粋）
import { describe, expect, test } from "vitest";
import { chooseSprite, isBossMonster, townPicture } from "../src/presenter/sprites";
import { data } from "./helpers/core";

const ALL = {
  giant_rat: { w: 48, h: 48 },
  kobold: { w: 48, h: 48 },
  gatekeeper_armor: { w: 96, h: 96 },
  unknown_beast: { w: 48, h: 48 },
  unknown_construct: { w: 48, h: 48 },
  unknown_humanoid: { w: 48, h: 40 },
};

describe("UI-60 chooseSprite", () => {
  test("UI-60 鑑定済みは monsters[].sprite、未鑑定は系統の unknown_<kind>（<id>_silhouette は使わない）", () => {
    expect(chooseSprite(data, "giant_rat", true, ALL, 48)).toEqual({ name: "giant_rat", w: 48, h: 48, scale: 1 });
    expect(chooseSprite(data, "giant_rat", false, ALL, 48)).toEqual({ name: "unknown_beast", w: 48, h: 48, scale: 1 });
    expect(chooseSprite(data, "gatekeeper_armor", false, ALL, 96)).toEqual({ name: "unknown_construct", w: 48, h: 48, scale: 2 });
  });

  test("UI-60 一覧に無ければ null（読みに行かない）。一覧が空なら全員 null。未知の monsterId も null", () => {
    expect(chooseSprite(data, "giant_spider", true, ALL, 48)).toBeNull();
    expect(chooseSprite(data, "whispering_shadow", false, ALL, 48)).toBeNull();
    for (const m of data.monsters) {
      for (const id of [true, false]) for (const f of [48, 64, 96]) expect(chooseSprite(data, m.id, id, {}, f), `${m.id} ${id} ${f}`).toBeNull();
    }
    expect(chooseSprite(data, "no_such_monster", true, { no_such_monster: { w: 48, h: 48 } }, 48)).toBeNull();
  });

  test("UI-60 scale は枠に入る最大の整数倍（縮小しない）: 枠 48 に 48 は 1、枠 64 に 48 は 1、枠 96 に 48 は 2、枠 96 に 96 は 1、枠 48・64 に 96 は null", () => {
    expect(chooseSprite(data, "kobold", true, ALL, 48)?.scale).toBe(1);
    expect(chooseSprite(data, "kobold", true, ALL, 64)?.scale).toBe(1);
    expect(chooseSprite(data, "kobold", true, ALL, 96)?.scale).toBe(2);
    expect(chooseSprite(data, "gatekeeper_armor", true, ALL, 96)?.scale).toBe(1);
    expect(chooseSprite(data, "gatekeeper_armor", true, ALL, 48)).toBeNull();
    expect(chooseSprite(data, "gatekeeper_armor", true, ALL, 64)).toBeNull();
  });

  test("UI-60 正方形でない・大きさが正の整数でない絵は null", () => {
    expect(chooseSprite(data, "kobold", false, ALL, 64)).toBeNull();
    expect(chooseSprite(data, "kobold", true, { kobold: { w: 0, h: 0 } }, 64)).toBeNull();
    expect(chooseSprite(data, "kobold", true, { kobold: { w: 1.5, h: 1.5 } }, 64)).toBeNull();
  });

  test("UI-60 isBossMonster は monsters の special.boss（未知の id は偽）", () => {
    expect(isBossMonster(data, "gatekeeper_armor")).toBe(true);
    expect(isBossMonster(data, "kobold")).toBe(false);
    expect(isBossMonster(data, "no_such_monster")).toBe(false);
  });
});

describe("UI-61 townPicture", () => {
  test("UI-61 townPicture: 一覧（GameAssets.town）にある施設だけ名前を返し、無ければ null（読みに行かない）", () => {
    const town = { inn: { w: 240, h: 150 } };
    expect(townPicture("inn", town)).toBe("inn");
    expect(townPicture("shop", town)).toBeNull();
    expect(townPicture("toString", town)).toBeNull();
    expect(townPicture("inn", {})).toBeNull();
  });
});
