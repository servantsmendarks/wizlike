// SV-40: ホーム画面から起動しているか（standalone）の判定。表示のための判定なので表示層に置く（§3-4 の「表示のためだけの計算」）。
// モジュールのトップレベルでは DOM / Web API に触れない（node 環境のテストから import するため）。

export type StandaloneEnv = {
  matchMedia?: (q: string) => { matches: boolean };
  navigator?: { standalone?: unknown };
};

/**
 * SV-40: ホーム画面から起動しているか。iOS の navigator.standalone === true か、(display-mode: standalone) の matchMedia が真。
 * matchMedia が無い・例外なら偽。呼び出しは isStandalone(globalThis as StandaloneEnv)（起動中は変わらないので描くたびに呼んでよい）
 */
export function isStandalone(env: StandaloneEnv): boolean {
  if (env.navigator?.standalone === true) return true;
  const mm = env.matchMedia;
  if (typeof mm !== "function") return false;
  try {
    return mm.call(env, "(display-mode: standalone)").matches === true;
  } catch {
    return false;
  }
}
