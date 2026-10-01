// SV-24: 表示の設定。localStorage のキー wizlike.settings に JSON で置く（ゲームの状態ではない）。
// 既定値は config から取り、壊れた欄だけ既定値に戻す。範囲外は丸める。未知のキーは捨てる。
// モジュールのトップレベルでは DOM / Web API に触れない（node 環境のテストから import するため）。
import type { Config } from "../core/data/index";

export type InputMode = "swipe" | "buttons" | "both";
export const INPUT_MODES: readonly InputMode[] = ["swipe", "buttons", "both"];

export type Settings = {
  /** §3-9 / UI-41 */
  skipAnimations: boolean;
  /** UI-43: 1 文字あたりの ms。0 で即時 */
  textSpeed: number;
  /** UI-32 */
  inputMode: InputMode;
  /** UI-30: 論理 px */
  swipeThreshold: number;
  /** UI-31: ms */
  holdRepeatMs: number;
};

export const SETTINGS_KEY = "wizlike.settings";

/** debug パネルの仮 UI の範囲と刻み（調整値ではなく入力欄の範囲なのでコードの定数） */
export const SETTING_RANGES = {
  swipeThreshold: { min: 8, max: 80, step: 2 },
  holdRepeatMs: { min: 100, max: 1000, step: 25 },
  textSpeed: { min: 0, max: 100, step: 10 },
} as const;

export type NumericSettingKey = keyof typeof SETTING_RANGES;

function clampTo(key: NumericSettingKey, v: number): number {
  const r = SETTING_RANGES[key];
  return Math.min(r.max, Math.max(r.min, Math.round(v)));
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 欄ごとに検査し、壊れていれば fallback の値を使う */
function normalize(src: Record<string, unknown>, fallback: Settings): Settings {
  const num = (key: NumericSettingKey): number => {
    const v = src[key];
    return typeof v === "number" && Number.isFinite(v) ? clampTo(key, v) : fallback[key];
  };
  const mode = src.inputMode;
  return {
    skipAnimations: typeof src.skipAnimations === "boolean" ? src.skipAnimations : fallback.skipAnimations,
    textSpeed: num("textSpeed"),
    inputMode: typeof mode === "string" && (INPUT_MODES as readonly string[]).includes(mode) ? (mode as InputMode) : fallback.inputMode,
    swipeThreshold: num("swipeThreshold"),
    holdRepeatMs: num("holdRepeatMs"),
  };
}

/** config の値を範囲に丸めたもの。inputMode は both、skipAnimations は false */
export function defaultSettings(config: Config): Settings {
  return {
    skipAnimations: false,
    textSpeed: clampTo("textSpeed", config.ui.textSpeedMs),
    inputMode: "both",
    swipeThreshold: clampTo("swipeThreshold", config.input.swipeThresholdPx),
    holdRepeatMs: clampTo("holdRepeatMs", config.input.holdRepeatMs),
  };
}

/** 保存された JSON を読む。null・壊れた JSON・オブジェクトでない値は defaults。欄ごとに壊れていれば既定値 */
export function parseSettings(json: string | null, defaults: Settings): Settings {
  if (json === null) return { ...defaults };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ...defaults };
  }
  if (!isPlainObject(raw)) return { ...defaults };
  return normalize(raw, defaults);
}

/** 欄の順を固定した JSON */
export function serializeSettings(s: Settings): string {
  return JSON.stringify({
    skipAnimations: s.skipAnimations,
    textSpeed: s.textSpeed,
    inputMode: s.inputMode,
    swipeThreshold: s.swipeThreshold,
    holdRepeatMs: s.holdRepeatMs,
  });
}

/** 数値の設定を 1 刻み増減する（範囲で止まる） */
export function stepSetting(s: Settings, key: NumericSettingKey, dir: 1 | -1): Settings {
  return { ...s, [key]: clampTo(key, s[key] + dir * SETTING_RANGES[key].step) };
}

/** swipe → buttons → both → swipe */
export function nextInputMode(m: InputMode): InputMode {
  const i = INPUT_MODES.indexOf(m);
  return INPUT_MODES[(i + 1) % INPUT_MODES.length] ?? "both";
}

/** localStorage から読む。使えない・壊れているときは既定値 */
export function loadSettings(config: Config): Settings {
  let json: string | null = null;
  try {
    json = globalThis.localStorage.getItem(SETTINGS_KEY);
  } catch {
    json = null;
  }
  return parseSettings(json, defaultSettings(config));
}

/** localStorage に書く。失敗しても止めない（console.warn だけ） */
export function saveSettings(s: Settings): void {
  try {
    globalThis.localStorage.setItem(SETTINGS_KEY, serializeSettings(s));
  } catch (e) {
    console.warn("settings: save failed", e);
  }
}

export type SettingsStore = {
  get(): Settings;
  set(patch: Partial<Settings>): void;
  subscribe(fn: (s: Settings) => void): () => void;
};

/** 現在の設定を持ち、set のたびに persist と購読者を呼ぶ。patch の壊れた欄は今の値のまま */
export function createSettingsStore(initial: Settings, persist: (s: Settings) => void): SettingsStore {
  let cur: Settings = { ...initial };
  const subs: ((s: Settings) => void)[] = [];
  return {
    get: () => ({ ...cur }),
    set(patch) {
      cur = normalize({ ...cur, ...patch }, cur);
      persist({ ...cur });
      for (const fn of [...subs]) fn({ ...cur });
    },
    subscribe(fn) {
      subs.push(fn);
      return () => {
        const i = subs.indexOf(fn);
        if (i >= 0) subs.splice(i, 1);
      };
    },
  };
}
