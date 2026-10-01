import { describe, expect, test } from "vitest";
import { cssVar, cssVars, PALETTE, ROLES, type Role } from "../src/presenter/palette";

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
});
