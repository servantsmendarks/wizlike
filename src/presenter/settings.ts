// SV-24: 表示の設定。localStorage のキー wizlike.settings に JSON で置く（ゲームの状態ではない）。
// 既定値は config から取り、壊れた欄だけ既定値に戻す。範囲外は丸める。未知のキーは捨てる。
// モジュールのトップレベルでは DOM / Web API に触れない（node 環境のテストから import するため）。
import type { Config } from "../core/data/index";

export type InputMode = "swipe" | "buttons" | "both";
export const INPUT_MODES: readonly InputMode[] = ["swipe", "buttons", "both"];

/** UI-57 / UI-45（M16）: 再生の進め方。tap = 拍の手動の待ちはタップで送る、timed = 拍の手動の待ちも autoBeatMs で自動に流す */
export type BeatAdvance = "tap" | "timed";
export const BEAT_ADVANCES: readonly BeatAdvance[] = ["tap", "timed"];

export type Settings = {
  /**
   * UI-41: 省くのは文字送り・ダイスの動き・点滅・被弾のフラッシュ・揺れ・撃破のフェード・ビューのフェードだけ。
   * 戦闘の拍の待ち（UI-45）とタップ待ちは省かない（CLAUDE.md §3-9）
   */
  skipAnimations: boolean;
  /** UI-43: 1 文字あたりの ms。0 で即時 */
  textSpeed: number;
  /** UI-32 */
  inputMode: InputMode;
  /** UI-30: 論理 px */
  swipeThreshold: number;
  /** UI-31: ms */
  holdRepeatMs: number;
  /** UI-45: オートの拍の待ち（ms）。AUTO_BEAT_CHOICES のどれか */
  autoBeatMs: number;
  /** UI-57 / UI-45（M16）: 再生の進め方（既定 tap） */
  beatAdvance: BeatAdvance;
  /** UI-57 / UI-63（M8）: 曲の音量の段（VOLUME_CHOICES。0 なら鳴らさない） */
  musicVolume: number;
  /** UI-57 / UI-65（M8）: 効果音の音量の段（VOLUME_CHOICES。0 なら鳴らさない） */
  sfxVolume: number;
};

export const SETTINGS_KEY = "wizlike.settings";

/** debug パネルの仮 UI の範囲と刻み（調整値ではなく入力欄の範囲なのでコードの定数） */
export const SETTING_RANGES = {
  swipeThreshold: { min: 8, max: 80, step: 2 },
  holdRepeatMs: { min: 100, max: 1000, step: 25 },
  textSpeed: { min: 0, max: 100, step: 10 },
} as const;

export type NumericSettingKey = keyof typeof SETTING_RANGES;

/** UI-45: オートの拍の待ちの選択肢（ms）。debug パネルの toggle で巡回する（入力欄の選択肢なのでコードの定数） */
export const AUTO_BEAT_CHOICES = [200, 400, 600] as const;

/** 200 → 400 → 600 → 200。選択肢に無い値は最も近い選択肢の次 */
export function nextAutoBeat(ms: number): number {
  const i = AUTO_BEAT_CHOICES.indexOf(snapAutoBeat(ms) as (typeof AUTO_BEAT_CHOICES)[number]);
  return AUTO_BEAT_CHOICES[(i + 1) % AUTO_BEAT_CHOICES.length] ?? AUTO_BEAT_CHOICES[0];
}

/** 最も近い選択肢に寄せる（距離が同じなら小さい方）。有限の数でなければ先頭 */
export function snapAutoBeat(ms: number): number {
  let best: number = AUTO_BEAT_CHOICES[0];
  if (!Number.isFinite(ms)) return best;
  for (const c of AUTO_BEAT_CHOICES) if (Math.abs(c - ms) < Math.abs(best - ms)) best = c;
  return best;
}

/** UI-57: 設定画面の文字速度の選択肢（ms/字。0 = 即時。入力欄の選択肢なのでコードの定数。debug パネルの -/+ は SETTING_RANGES のまま） */
export const TEXT_SPEED_CHOICES = [0, 15, 30, 60] as const;

/** UI-57: ms より大きい最小の選択肢、無ければ先頭（0）。0 → 15 → 30 → 60 → 0 */
export function nextTextSpeed(ms: number): number {
  for (const c of TEXT_SPEED_CHOICES) if (c > ms) return c;
  return TEXT_SPEED_CHOICES[0];
}

/** UI-57（M8）: 音量の段の選択肢（0〜10。入力欄の選択肢なのでコードの定数。既定値は config.ui.musicVolume / sfxVolume） */
export const VOLUME_CHOICES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
const VOLUME_MAX = 10;

function isVolume(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= VOLUME_MAX;
}

/** UI-57: 0 → 1 → … → 10 → 0。範囲外・非整数は 0 に寄せてから 1 つ進める */
export function nextVolume(v: number): number {
  const cur = isVolume(v) ? v : 0;
  return cur >= VOLUME_MAX ? 0 : cur + 1;
}

/** config の音量を 0〜10 の整数に丸める（validateConfig で整数 0〜10 は保証されている） */
function clampVolume(v: number): number {
  return Number.isFinite(v) ? Math.min(VOLUME_MAX, Math.max(0, Math.round(v))) : 0;
}

function isAutoBeat(v: unknown): v is number {
  return typeof v === "number" && (AUTO_BEAT_CHOICES as readonly number[]).includes(v);
}

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
    autoBeatMs: isAutoBeat(src.autoBeatMs) ? src.autoBeatMs : fallback.autoBeatMs,
    beatAdvance: typeof src.beatAdvance === "string" && (BEAT_ADVANCES as readonly string[]).includes(src.beatAdvance) ? (src.beatAdvance as BeatAdvance) : fallback.beatAdvance,
    musicVolume: isVolume(src.musicVolume) ? src.musicVolume : fallback.musicVolume,
    sfxVolume: isVolume(src.sfxVolume) ? src.sfxVolume : fallback.sfxVolume,
  };
}

/** config の値を範囲に丸めたもの。inputMode は both、skipAnimations は false、beatAdvance は tap、autoBeatMs は config.ui.autoBeatMs を選択肢に寄せたもの */
export function defaultSettings(config: Config): Settings {
  return {
    skipAnimations: false,
    textSpeed: clampTo("textSpeed", config.ui.textSpeedMs),
    inputMode: "both",
    swipeThreshold: clampTo("swipeThreshold", config.input.swipeThresholdPx),
    holdRepeatMs: clampTo("holdRepeatMs", config.input.holdRepeatMs),
    autoBeatMs: snapAutoBeat(config.ui.autoBeatMs),
    beatAdvance: "tap",
    musicVolume: clampVolume(config.ui.musicVolume),
    sfxVolume: clampVolume(config.ui.sfxVolume),
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
    autoBeatMs: s.autoBeatMs,
    beatAdvance: s.beatAdvance,
    swipeThreshold: s.swipeThreshold,
    holdRepeatMs: s.holdRepeatMs,
    musicVolume: s.musicVolume,
    sfxVolume: s.sfxVolume,
  });
}

/** 数値の設定を 1 刻み増減する（範囲で止まる） */
export function stepSetting(s: Settings, key: NumericSettingKey, dir: 1 | -1): Settings {
  return { ...s, [key]: clampTo(key, s[key] + dir * SETTING_RANGES[key].step) };
}

/** UI-57（M16）: tap → timed → tap */
export function nextBeatAdvance(b: BeatAdvance): BeatAdvance {
  return b === "tap" ? "timed" : "tap";
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
