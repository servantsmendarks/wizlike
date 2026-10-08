import { describe, expect, test } from "vitest";
import { cssVar, cssVars, PALETTE, ROLES, type Role } from "../src/presenter/palette";
import { PLACEHOLDER_COLORS } from "../src/core/data";

describe("palette", () => {
  test("UI-04 54 色以内、#RRGGBB、重複なし、ROLES がすべて PALETTE を指す", () => {
    const values = Object.values(PALETTE);
    expect(values.length).toBeLessThanOrEqual(54);
    for (const v of values) expect(v).toMatch(/^#[0-9A-F]{6}$/);
    expect(new Set(values).size).toBe(values.length);
    for (const name of Object.values(ROLES)) expect(Object.keys(PALETTE)).toContain(name);
  });

  test("UI-04 cssVars は用途ごとに --c-<用途> とパレットの値を返す", () => {
    const v = cssVars();
    const roles = Object.keys(ROLES) as Role[];
    expect(Object.keys(v).sort()).toEqual(roles.map((r) => `--c-${r}`).sort());
    expect(v["--c-bg"]).toBe("#000000");
    expect(v["--c-line"]).toBe("#B8F8B8"); // 線画は淡緑【仮】
    expect(v["--c-text"]).toBe("#FCFCFC");
    expect(cssVar("stairs")).toBe("--c-stairs");
    for (const r of roles) expect(v[cssVar(r)]).toBe(PALETTE[ROLES[r]]);
  });

  test("UI-04/UI-60 violet / teal は FC の 54 色（工房の fc54 の #9878F8 / #008888）・PLACEHOLDER_COLORS が PALETTE の black 以外と一致（M9）", () => {
    expect(PALETTE.violet).toBe("#9878F8");
    expect(PALETTE.teal).toBe("#008888");
    expect([...PLACEHOLDER_COLORS].sort()).toEqual(Object.keys(PALETTE).filter((k) => k !== "black").sort());
  });

  test("UI-04/UI-60 bone（M12。U-4）は薄い黄土 #FCE0A8（工房の fc54 の色）で、spirit の darkGreen・construct の white・線画の lightGreen と違う", () => {
    expect(PALETTE.bone).toBe("#FCE0A8");
    expect(new Set([PALETTE.bone, PALETTE.darkGreen, PALETTE.white, PALETTE.lightGreen]).size).toBe(4);
  });

  test("UI-13（M8.5）帯の役 status / san はパレットの既存の色（orange / sky）で、死亡 danger・灰 dim・正常 text と互いに違う", () => {
    expect(ROLES.status).toBe("orange");
    expect(ROLES.san).toBe("sky");
    const band = (["text", "dim", "danger", "status", "san"] as const).map((r) => PALETTE[ROLES[r]]);
    expect(new Set(band).size).toBe(band.length);
  });
});
