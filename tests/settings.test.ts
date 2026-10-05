import { afterEach, describe, expect, test, vi } from "vitest";
import {
  AUTO_BEAT_CHOICES,
  createSettingsStore,
  defaultSettings,
  loadSettings,
  nextAutoBeat,
  nextInputMode,
  parseSettings,
  saveSettings,
  serializeSettings,
  SETTING_RANGES,
  SETTINGS_KEY,
  snapAutoBeat,
  stepSetting,
  TEXT_SPEED_CHOICES,
  nextTextSpeed,
  nextVolume,
  VOLUME_CHOICES,
  type Settings,
} from "../src/presenter/settings";
import { data } from "./helpers/core";

const D: Settings = defaultSettings(data.config);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("settings", () => {
  test("SV-24 defaultSettings は config から取る（28/250/30/both/false/400）", () => {
    expect(D).toEqual({ skipAnimations: false, textSpeed: 30, inputMode: "both", swipeThreshold: 28, holdRepeatMs: 250, autoBeatMs: 400, musicVolume: 7, sfxVolume: 7 });
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
    expect(Object.keys(p).sort()).toEqual(["autoBeatMs", "holdRepeatMs", "inputMode", "musicVolume", "sfxVolume", "skipAnimations", "swipeThreshold", "textSpeed"]);
    // 往復
    const s: Settings = { skipAnimations: true, textSpeed: 0, inputMode: "swipe", swipeThreshold: 40, holdRepeatMs: 500, autoBeatMs: 600, musicVolume: 0, sfxVolume: 10 };
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

describe("UI-45 オートの拍の速さ", () => {
  test("SV-24/UI-45 snapAutoBeat は最も近い選択肢（同じ距離なら小さい方）、nextAutoBeat は 200 → 400 → 600 → 200", () => {
    expect([...AUTO_BEAT_CHOICES]).toEqual([200, 400, 600]);
    expect(snapAutoBeat(500)).toBe(400);
    expect(snapAutoBeat(501)).toBe(600);
    expect(snapAutoBeat(700)).toBe(600);
    expect(snapAutoBeat(1)).toBe(200);
    expect(snapAutoBeat(300)).toBe(200);
    expect(snapAutoBeat(400)).toBe(400);
    expect(snapAutoBeat(Number.NaN)).toBe(200);
    expect(nextAutoBeat(200)).toBe(400);
    expect(nextAutoBeat(400)).toBe(600);
    expect(nextAutoBeat(600)).toBe(200);
    // 選択肢に無い値は寄せてから次へ
    expect(nextAutoBeat(450)).toBe(600);
  });

  test("SV-24 autoBeatMs: 既定値は config.ui.autoBeatMs を選択肢に寄せた値。無い・選択肢に無い・文字列なら既定値。serialize では inputMode の直後に置く", () => {
    expect(D.autoBeatMs).toBe(400);
    const cfg = structuredClone(data.config);
    cfg.ui.autoBeatMs = 700;
    expect(defaultSettings(cfg).autoBeatMs).toBe(600);
    cfg.ui.autoBeatMs = 250;
    expect(defaultSettings(cfg).autoBeatMs).toBe(200);
    // M4 までの保存（autoBeatMs が無い）
    const { autoBeatMs: _omit, ...old } = { ...D, holdRepeatMs: 300 };
    expect(parseSettings(JSON.stringify(old), D)).toEqual({ ...D, holdRepeatMs: 300 });
    for (const bad of [500, 0, -200, "200", null, 400.5]) {
      expect(parseSettings(JSON.stringify({ ...D, autoBeatMs: bad }), D).autoBeatMs, String(bad)).toBe(400);
    }
    expect(parseSettings(JSON.stringify({ ...D, autoBeatMs: 200 }), D).autoBeatMs).toBe(200);
    expect(Object.keys(JSON.parse(serializeSettings(D)) as object)).toEqual([
      "skipAnimations",
      "textSpeed",
      "inputMode",
      "autoBeatMs",
      "swipeThreshold",
      "holdRepeatMs",
      "musicVolume",
      "sfxVolume",
    ]);
    // store の set でも選択肢に無い値は今の値のまま
    const st = createSettingsStore(D, () => {});
    st.set({ autoBeatMs: 450 });
    expect(st.get().autoBeatMs).toBe(400);
    st.set({ autoBeatMs: nextAutoBeat(st.get().autoBeatMs) });
    expect(st.get().autoBeatMs).toBe(600);
  });
});

describe("UI-57 設定画面の文字速度の選択肢", () => {
  test("UI-57 nextTextSpeed: 0 → 15 → 30 → 60 → 0。選択肢に無い 50 は 60、100 は 0（ms より大きい最小の選択肢、無ければ先頭）", () => {
    expect([...TEXT_SPEED_CHOICES]).toEqual([0, 15, 30, 60]);
    expect(nextTextSpeed(0)).toBe(15);
    expect(nextTextSpeed(15)).toBe(30);
    expect(nextTextSpeed(30)).toBe(60);
    expect(nextTextSpeed(60)).toBe(0);
    expect(nextTextSpeed(50)).toBe(60);
    expect(nextTextSpeed(10)).toBe(15);
    expect(nextTextSpeed(100)).toBe(0);
    expect(nextTextSpeed(Number.NaN)).toBe(0);
    // どの選択肢も SETTING_RANGES.textSpeed（store の丸め）の中にある
    for (const c of TEXT_SPEED_CHOICES) {
      expect(c).toBeGreaterThanOrEqual(SETTING_RANGES.textSpeed.min);
      expect(c).toBeLessThanOrEqual(SETTING_RANGES.textSpeed.max);
    }
    const st = createSettingsStore({ ...D, textSpeed: 30 }, () => {});
    st.set({ textSpeed: nextTextSpeed(st.get().textSpeed) });
    expect(st.get().textSpeed).toBe(60);
  });

  test("SV-24 musicVolume・sfxVolume: 既定は config.ui.musicVolume / sfxVolume。範囲外・非整数・型違いは既定（store の set では今の値のまま）。serialize の末尾。欄の無い古い保存は既定", () => {
    expect(D.musicVolume).toBe(data.config.ui.musicVolume);
    expect(D.sfxVolume).toBe(data.config.ui.sfxVolume);
    const cfg = structuredClone(data.config);
    cfg.ui.musicVolume = 3;
    cfg.ui.sfxVolume = 0;
    expect(defaultSettings(cfg)).toMatchObject({ musicVolume: 3, sfxVolume: 0 });
    for (const bad of [-1, 11, 2.5, "5", null, true]) {
      const p = parseSettings(JSON.stringify({ ...D, musicVolume: bad, sfxVolume: bad }), D);
      expect([p.musicVolume, p.sfxVolume], String(bad)).toEqual([D.musicVolume, D.sfxVolume]);
    }
    expect(parseSettings(JSON.stringify({ ...D, musicVolume: 0, sfxVolume: 10 }), D)).toMatchObject({ musicVolume: 0, sfxVolume: 10 });
    const { musicVolume: _m, sfxVolume: _s, ...old } = { ...D, holdRepeatMs: 300 };
    expect(parseSettings(JSON.stringify(old), D)).toEqual({ ...D, holdRepeatMs: 300 });
    const keys = Object.keys(JSON.parse(serializeSettings(D)) as object);
    expect(keys.slice(-2)).toEqual(["musicVolume", "sfxVolume"]);
    const st = createSettingsStore({ ...D, musicVolume: 4 }, () => {});
    st.set({ musicVolume: 12 });
    expect(st.get().musicVolume).toBe(4);
    st.set({ sfxVolume: 0 });
    expect(st.get().sfxVolume).toBe(0);
  });

  test("UI-57 nextVolume: 0 → 1 → … → 9 → 10 → 0。範囲外・非整数は 0 に寄せてから", () => {
    expect([...VOLUME_CHOICES]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(VOLUME_CHOICES.map((v) => nextVolume(v))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 0]);
    for (const bad of [-1, 11, 2.5, Number.NaN]) expect(nextVolume(bad), String(bad)).toBe(1);
  });
});
