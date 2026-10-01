import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createSettingsStore,
  defaultSettings,
  loadSettings,
  nextInputMode,
  parseSettings,
  saveSettings,
  serializeSettings,
  SETTING_RANGES,
  SETTINGS_KEY,
  stepSetting,
  type Settings,
} from "../src/presenter/settings";
import { data } from "./helpers/core";

const D: Settings = defaultSettings(data.config);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("settings", () => {
  test("SV-24 defaultSettings は config から取る（28/250/30/both/false）", () => {
    expect(D).toEqual({ skipAnimations: false, textSpeed: 30, inputMode: "both", swipeThreshold: 28, holdRepeatMs: 250 });
    expect(D.swipeThreshold).toBe(data.config.input.swipeThresholdPx);
    expect(D.holdRepeatMs).toBe(data.config.input.holdRepeatMs);
    expect(D.textSpeed).toBe(data.config.ui.textSpeedMs);
    // config が範囲外でも丸める
    const cfg = structuredClone(data.config);
    cfg.input.swipeThresholdPx = 200;
    cfg.input.holdRepeatMs = 1;
    cfg.ui.textSpeedMs = 500;
    expect(defaultSettings(cfg)).toMatchObject({ swipeThreshold: 80, holdRepeatMs: 100, textSpeed: 100 });
  });

  test("SV-24 parseSettings: null、壊れた JSON、配列、型違い、NaN を項目ごとに既定値へ戻す。範囲外は丸め、未知のキーは捨てる。serialize→parse で元に戻る", () => {
    expect(parseSettings(null, D)).toEqual(D);
    expect(parseSettings("{", D)).toEqual(D);
    expect(parseSettings("[1,2]", D)).toEqual(D);
    expect(parseSettings("null", D)).toEqual(D);
    expect(parseSettings("42", D)).toEqual(D);
    // 型違いの欄だけが既定値に戻り、正しい欄は残る
    expect(
      parseSettings(JSON.stringify({ skipAnimations: "yes", textSpeed: 50, inputMode: "mouse", swipeThreshold: "40", holdRepeatMs: 400 }), D),
    ).toEqual({ ...D, textSpeed: 50, holdRepeatMs: 400 });
    // NaN / Infinity は JSON に書けず null になる → 既定値
    expect(parseSettings(JSON.stringify({ textSpeed: Number.NaN, swipeThreshold: Number.POSITIVE_INFINITY }), D)).toEqual(D);
    // 範囲外は丸め、小数は整数に
    expect(parseSettings(JSON.stringify({ textSpeed: -5, swipeThreshold: 1000, holdRepeatMs: 99.6 }), D)).toEqual({
      ...D,
      textSpeed: SETTING_RANGES.textSpeed.min,
      swipeThreshold: SETTING_RANGES.swipeThreshold.max,
      holdRepeatMs: 100,
    });
    // 未知のキーは捨てる
    const p = parseSettings(JSON.stringify({ ...D, volume: 3, extra: true }), D);
    expect(Object.keys(p).sort()).toEqual(["holdRepeatMs", "inputMode", "skipAnimations", "swipeThreshold", "textSpeed"]);
    // 往復
    const s: Settings = { skipAnimations: true, textSpeed: 0, inputMode: "swipe", swipeThreshold: 40, holdRepeatMs: 500 };
    expect(parseSettings(serializeSettings(s), D)).toEqual(s);
    // 返り値は defaults と別のオブジェクト
    expect(parseSettings(null, D)).not.toBe(D);
  });

  test("UI-31/SV-24 holdRepeatMs が保存の対象に入る", () => {
    const json = serializeSettings({ ...D, holdRepeatMs: 325 });
    expect(JSON.parse(json)).toEqual({ ...D, holdRepeatMs: 325 });
    expect(parseSettings(json, D).holdRepeatMs).toBe(325);
  });

  test("SV-24 stepSetting は刻みと範囲を守る", () => {
    expect(stepSetting(D, "swipeThreshold", 1).swipeThreshold).toBe(30);
    expect(stepSetting(D, "swipeThreshold", -1).swipeThreshold).toBe(26);
    expect(stepSetting(D, "holdRepeatMs", 1).holdRepeatMs).toBe(275);
    expect(stepSetting(D, "textSpeed", -1).textSpeed).toBe(20);
    // 端で止まる
    const lo: Settings = { ...D, swipeThreshold: 8, holdRepeatMs: 100, textSpeed: 0 };
    expect(stepSetting(lo, "swipeThreshold", -1).swipeThreshold).toBe(8);
    expect(stepSetting(lo, "holdRepeatMs", -1).holdRepeatMs).toBe(100);
    expect(stepSetting(lo, "textSpeed", -1).textSpeed).toBe(0);
    const hi: Settings = { ...D, swipeThreshold: 80, holdRepeatMs: 1000, textSpeed: 100 };
    expect(stepSetting(hi, "swipeThreshold", 1).swipeThreshold).toBe(80);
    expect(stepSetting(hi, "holdRepeatMs", 1).holdRepeatMs).toBe(1000);
    expect(stepSetting(hi, "textSpeed", 1).textSpeed).toBe(100);
    // 他の欄は変えず、元を書き換えない
    const before = { ...D };
    expect(stepSetting(D, "textSpeed", 1)).toEqual({ ...D, textSpeed: 40 });
    expect(D).toEqual(before);
  });

  test("UI-32 nextInputMode は swipe → buttons → both → swipe", () => {
    expect(nextInputMode("swipe")).toBe("buttons");
    expect(nextInputMode("buttons")).toBe("both");
    expect(nextInputMode("both")).toBe("swipe");
  });

  test("SV-24 loadSettings / saveSettings は localStorage の wizlike.settings を使い、使えなければ既定値・warn だけ", () => {
    expect(SETTINGS_KEY).toBe("wizlike.settings");
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    expect(loadSettings(data.config)).toEqual(D);
    const s: Settings = { ...D, holdRepeatMs: 500, inputMode: "buttons" };
    saveSettings(s);
    expect(store.get("wizlike.settings")).toBe(serializeSettings(s));
    expect(loadSettings(data.config)).toEqual(s);
    store.set("wizlike.settings", "not json");
    expect(loadSettings(data.config)).toEqual(D);

    // localStorage が例外を投げる（プライベートモードなど）
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(loadSettings(data.config)).toEqual(D);
    expect(() => saveSettings(D)).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test("SV-24 createSettingsStore: set で persist と購読者を呼び、壊れた欄は今の値のまま、範囲外は丸める。解除後は呼ばれない", () => {
    const persisted: Settings[] = [];
    const st = createSettingsStore(D, (s) => persisted.push(s));
    const seen: Settings[] = [];
    const off = st.subscribe((s) => seen.push(s));
    st.set({ holdRepeatMs: 400 });
    expect(st.get()).toEqual({ ...D, holdRepeatMs: 400 });
    expect(persisted).toEqual([{ ...D, holdRepeatMs: 400 }]);
    expect(seen).toEqual([{ ...D, holdRepeatMs: 400 }]);
    st.set({ swipeThreshold: 999, inputMode: "nope" as never, textSpeed: Number.NaN });
    expect(st.get()).toEqual({ ...D, holdRepeatMs: 400, swipeThreshold: 80 });
    off();
    st.set({ skipAnimations: true });
    expect(seen).toHaveLength(2);
    expect(persisted).toHaveLength(3);
    // get の結果を書き換えても内部は変わらない
    const g = st.get();
    g.textSpeed = 0;
    expect(st.get().textSpeed).toBe(30);
  });
});
